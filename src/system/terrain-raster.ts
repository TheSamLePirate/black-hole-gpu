import { TABLE_TERRAIN, TABLE_TERRAIN_PREV } from "../gpu-tables";
import { TERRAIN_CACHE_HEADER, TERRAIN_CACHE_N, TERRAIN_CACHE_NODE_VEC4S, TERRAIN_CACHE_RING_LAST } from "./terrain-cache-layout";

/** The relief's shadow map's side [texels] (system/terrain-raster.ts encodeSunShadow, trace.wgsl sunShadowFar). */
/** a cascade's side in the relief's shadow atlas [texels] (T6: two cascades side by side — 2N × N) */
export const TERRAIN_SUN_N = 2048;
/** the relief's shadow cascades (T6): their count in the atlas */
export const TERRAIN_SUN_CASCADES = 2;
/** the finest cache level drawn into the second cascade (9.8 m texels: the 9.5 m level and finer are the first's, which covers
 *  them — its ±1.5 km about the camera) */
const TERRAIN_CACHE_SUN_C1 = 3;
/** The visibility target: r the ground's distance [m], g the scenery's instance drawn nearest (system/scenery-raster.ts),
 *  b the nearest surface's distance [m] (the ground's, or the instance's proxy in front of it). */
export const TERRAIN_RASTER_FORMAT: GPUTextureFormat = "rgba32float";
import { geoidLibrary, terrainHeightLibrary, type TerrainCacheSources } from "./terrain-cache";
import { TERRAIN_RASTER_MAX_PIXELS, TERRAIN_RASTER_UNIFORM_BYTES } from "./terrain-raster-frame";
import { rasterGroundCode } from "./terrain-raster-hint";
import {
  RASTER_MESH_INDEX_BYTES,
  RASTER_MESH_VERTEX_BYTES,
  type RasterMesh,
  runwayMeshKey,
  terrainRasterMesh,
} from "./terrain-raster-mesh";
import type { MeshReply, MeshRequest } from "./terrain-mesh-worker";
import type { TerrainWindow } from "./terrain-cache-layout";

/** The pilot's geometry and inspector, deliberately separate from radiance and the reference tracer. */
export function terrainRasterShader(trace: string): string {
  const library = terrainHeightLibrary(trace, true, 1);
  return `
${library}
${geoidLibrary(trace, library, "table")}
const GRID_N = ${TERRAIN_CACHE_N}u;
struct U {
  origin: vec4f, reference: vec4f, figure: vec4f,
  right: vec4f, up: vec4f, forward: vec4f,
  image: vec4f, output: vec4f,
  // the next coarser level drawn about this one (T3, its geomorphose): xy this grid's nodes' offset on it (× w), z its heights'
  // place in the table, w the two grids' ratio (2 or 4; 0: none — the last ring, the rings off)
  morph: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> table: array<vec4f>;
// (T3: the band along a level's edge where its vertices slide onto the next coarser level's triangles — whole over the first
// MORPH_FULL nodes, where that level's mesh overlaps it — RING_OVERLAP and a coarse cell —, none past MORPH_BAND)
const MORPH_FULL = 8.0;
const MORPH_BAND = 16.0;
// (a level's node as drawn — T4: its last bake faded in over the one before, that one's share in its header's s.w: the level
// from its heights' place in the table)
fn cacheNode(base: u32, i: vec2u) -> f32 {
  let node = i.y * GRID_N + i.x;
  let h = table[base + node / 4u][node % 4u];
  let k = (base - ${TABLE_TERRAIN + TERRAIN_CACHE_HEADER}u) / ${TERRAIN_CACHE_NODE_VEC4S}u;
  let share = table[${TABLE_TERRAIN}u + 2u * k + 1u].w;
  if (share <= 0.0) { return h; }
  return mix(h, table[${TABLE_TERRAIN_PREV}u + k * ${TERRAIN_CACHE_NODE_VEC4S}u + node / 4u][node % 4u], share);
}
@group(0) @binding(2) var distanceImage: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> referenceDepth: array<f32>;
struct Vertex { @builtin(position) clip: vec4f, @location(0) p: vec3f, @location(1) n: vec3f };
// (T5: a level's mark and its smooth normal in the target's a — an integer below 2²⁴, exact in its float: the mark's code
// × 2¹⁸ — terrain-raster-hint.ts RASTER_CODE —, the normal's octahedron 2 × 9 bits, each 1…511 — 0: none)
fn rasterCode(code: f32, n: vec3f) -> f32 {
  if (dot(n, n) < 0.25) { return code * 262144.0; }
  let m = normalize(n);
  var o = m.xy / (abs(m.x) + abs(m.y) + abs(m.z));
  if (m.z < 0.0) { o = (1.0 - abs(o.yx)) * select(vec2f(-1.0), vec2f(1.0), o >= vec2f(0.0)); }
  let q = clamp(round((o * 0.5 + 0.5) * 510.0) + 1.0, vec2f(1.0), vec2f(511.0));
  return code * 262144.0 + q.x * 512.0 + q.y;
}

// A level's ground at a place of its grid [m over the sea]: its nodes' bilinear (its mesh's vertices are its nodes), and near
// its window's edge the geomorphose onto the next coarser level's triangles (T3)
fn levelHeight(ij: vec2f) -> f32 {
  let b0 = u32(u.origin.w);
  var h: f32;
  // (a node — the mesh's vertices, but where a runway's outline cut a cell —: its own height, one read)
  if (all(ij == floor(ij))) {
    h = cacheNode(b0, vec2u(ij));
  } else {
    let cell = min(vec2u(floor(ij)), vec2u(GRID_N - 2u));
    let blend = ij - vec2f(cell);
    h = mix(mix(cacheNode(b0, cell), cacheNode(b0, cell + vec2u(1u, 0u)), blend.x),
            mix(cacheNode(b0, cell + vec2u(0u, 1u)), cacheNode(b0, cell + vec2u(1u, 1u)), blend.x), blend.y);
  }
  if (u.morph.w > 0.5) {
    // (T3, the geomorphose: near its window's edge, the vertex onto the coarser level's surface as it is drawn — its very
    // triangle, the mesh's diagonal (1,0)–(0,1), barycentric: not the bilinear, (h00 + h11 − h10 − h01)/4 off at a cell's
    // centre, in the valleys and on the crests —; at the edge the two levels one surface, no triangle piercing the other)
    let e = min(min(ij.x, ij.y), min(f32(GRID_N - 1u) - ij.x, f32(GRID_N - 1u) - ij.y));
    let w = clamp((MORPH_BAND - e) / (MORPH_BAND - MORPH_FULL), 0.0, 1.0);
    if (w > 0.0) {
      let c = (ij + u.morph.xy) / u.morph.w;
      let cc = vec2u(clamp(floor(c), vec2f(0.0), vec2f(f32(GRID_N - 2u))));
      let f = clamp(c - vec2f(cc), vec2f(0.0), vec2f(1.0));
      let b = u32(u.morph.z);
      let h10 = cacheNode(b, cc + vec2u(1u, 0u));
      let h01 = cacheNode(b, cc + vec2u(0u, 1u));
      var hc: f32;
      if (f.x + f.y <= 1.0) {
        let h00 = cacheNode(b, cc);
        hc = h00 + f.x * (h10 - h00) + f.y * (h01 - h00);
      } else {
        let h11 = cacheNode(b, cc + vec2u(1u, 1u));
        hc = h11 + (1.0 - f.x) * (h01 - h11) + (1.0 - f.y) * (h10 - h11);
      }
      h = mix(h, hc, w);
    }
  }
  return h;
}
// (T5) A grid vertex's smooth normal on the Earth's axes: its level's slopes there (central differences of levelHeight —
// the geomorphose's included —, one-sided at the window's edge) on its geodetic east, north and up; none on a runway's graded
// ground (its triangles flat: the target's normal then the mesh's — trace.wgsl rasterNormal)
fn terrainNormal(vertex: vec3f, graded: bool) -> vec3f {
  if (graded) { return vec3f(0.0); }
  let ij = vertex.xy;
  let d = (ij - vec2f(f32(GRID_N - 1u) * 0.5)) / u.figure.w;
  let sa = u.reference.z * cos(d.y) + u.reference.w * sin(d.y);
  let ca = u.reference.w * cos(d.y) - u.reference.z * sin(d.y);
  let cl = u.reference.x * cos(d.x) - u.reference.y * sin(d.x);
  let sl = u.reference.y * cos(d.x) + u.reference.x * sin(d.x);
  let up = vec3f(ca * cl, ca * sl, sa);
  let last = f32(GRID_N - 1u);
  let x0 = max(ij.x - 1.0, 0.0); let x1 = min(ij.x + 1.0, last);
  let y0 = max(ij.y - 1.0, 0.0); let y1 = min(ij.y + 1.0, last);
  // (a node's step [m]: the figure's radius of curvature over the nodes a radian — the meridian's within 0.7 %, a slope's)
  let step = u.figure.x / u.figure.w;
  let gx = (levelHeight(vec2f(x1, ij.y)) - levelHeight(vec2f(x0, ij.y))) / ((x1 - x0) * step * max(ca, 1e-3));
  let gy = (levelHeight(vec2f(ij.x, y1)) - levelHeight(vec2f(ij.x, y0))) / ((y1 - y0) * step);
  let east = vec3f(-sl, cl, 0.0);
  let north = vec3f(-sa * cl, -sa * sl, ca);
  return normalize(up - gx * east - gy * north);
}
// A grid vertex's point, camera-relative on the Earth's axes [m]
// Whether a grid vertex stands on a runway's graded ground (its geodetic up — the window's reference turned —: runwayGrade's)
fn vertexGraded(ij: vec2f) -> bool {
  let d = (ij - vec2f(f32(GRID_N - 1u) * 0.5)) / u.figure.w;
  let sa = u.reference.z * cos(d.y) + u.reference.w * sin(d.y);
  let ca = u.reference.w * cos(d.y) - u.reference.z * sin(d.y);
  let cl = u.reference.x * cos(d.x) - u.reference.y * sin(d.x);
  let sl = u.reference.y * cos(d.x) + u.reference.x * sin(d.x);
  return runwayGrade(vec3f(ca * cl, ca * sl, sa)).x > 0.0;
}
// (graded: on a runway's graded ground — runwayGrade, read once a vertex: vertexGraded)
fn terrainPoint(vertex: vec3f, graded: bool) -> vec3f {
  let ij = vertex.xy;
  let d = (ij - vec2f(f32(GRID_N - 1u) * 0.5)) / u.figure.w;
  // Exact trigonometric sums, with cos(d)-1 evaluated without cancellation.
  let halfSin = sin(d * 0.5);
  let cm = -2.0 * halfSin.y * halfSin.y;
  let ds = u.reference.z * cm + u.reference.w * sin(d.y);
  let dc = u.reference.w * cm - u.reference.z * sin(d.y);
  let sa = u.reference.z + ds;
  let ca = u.reference.w + dc;
  let root = sqrt(1.0 - u.figure.y * sa * sa);
  let dn = u.figure.x * u.figure.y * ds * (sa + u.reference.z) / (root * (u.figure.z + root));
  let dr = dn * ca + u.figure.x * dc;
  let x = dr * cos(d.x) - 2.0 * u.figure.x * u.reference.w * halfSin.x * halfSin.x;
  let y = (u.figure.x + dn) * ca * sin(d.x);
  let z = (1.0 - u.figure.y) * (dn * sa + u.figure.x * ds);
  let cl = u.reference.x * cos(d.x) - u.reference.y * sin(d.x);
  let sl = u.reference.y * cos(d.x) + u.reference.x * sin(d.x);
  let normal = vec3f(ca * cl, ca * sl, sa);
  var h: f32;
  // The exact grading and detail suppression, not a second approximation of runway flattening.
  if (graded) { h = earthHeightExactG(normal, vertex.z); } else { h = levelHeight(ij); }
  // (above the sea, the cache's and the exact heights: over the ellipsoid by the geoid — trace.wgsl earthHeightG)
  h += geoidN(normal);
  let delta = vec3f(x * u.reference.x - y * u.reference.y, x * u.reference.y + y * u.reference.x, z);
  return u.origin.xyz + delta + vec3f(ca * cl, ca * sl, sa) * h;
}
@vertex fn terrainVs(@location(0) vertex: vec3f) -> Vertex {
  let graded = vertexGraded(vertex.xy);
  let p = terrainPoint(vertex, graded);
  var v: Vertex;
  v.n = terrainNormal(vertex, graded);
  v.p = vec3f(dot(p, u.right.xyz), dot(p, u.up.xyz), dot(p, u.forward.xyz));
  // Infinite reversed-Z, near plane in metres, WebGPU clip depth [0,1].
  // (the frame's sub-pixel jitter in NDC — output.zw, renderer.rasterJitter — the rays' own)
  v.clip = vec4f(v.p.x / u.right.w + u.output.z * v.p.z, v.p.y / u.up.w + u.output.w * v.p.z, u.forward.w, v.p.z);
  return v;
}
// The relief seen from the Sun (its shadow map — trace.wgsl sunShadowFar): an orthographic view along its direction,
// right and up over half-widths [m], the depth the distance towards the Sun over twice its half-range, nearer the Sun less
// — T6: a cascade's, its centre (xy, along right and up [m] from the camera: on its texels' grid, the shadows' edges still while
// the camera moves) —, drawn into its square of the cascades' atlas (the pass's viewport)
struct Sun { right: vec4f, up: vec4f, toward: vec4f, centre: vec4f };
@group(0) @binding(5) var<uniform> sun: Sun;
@vertex fn terrainSunVs(@location(0) vertex: vec3f) -> @builtin(position) vec4f {
  let p = terrainPoint(vertex, vertexGraded(vertex.xy));
  let z = clamp(0.5 - dot(p, sun.toward.xyz) / (2.0 * sun.toward.w), 0.0, 1.0);
  return vec4f((dot(p, sun.right.xyz) - sun.centre.x) / sun.right.w, (dot(p, sun.up.xyz) - sun.centre.y) / sun.up.w, z, 1.0);
}
// (r: the ground's distance [m]; g: the scenery's instance drawn there — none here, the scenery's draw writes it alone, and
// its proxy's distance over b; a: the patch's code, 1, and its smooth normal — T5)
@fragment fn terrainFs(v: Vertex) -> @location(0) vec4f { let d = length(v.p); return vec4f(d, 0.0, d, rasterCode(1.0, v.n)); }
// A far ring: a coarser level's grid (its cells four times the next finer one's), its triangles under that finer one left out
// of its mesh (system/terrain-raster.ts drawRing) — xy its nodes' place on the finer one's grid (×4 and this offset), z the
// overlap kept along the finer one's edge [its nodes] —; w its mark's code in a (1 + its rank from the patch + 8 × its step,
// how many levels coarser than the reference patch: the tracer's tolerance — trace.wgsl RHINT_TOL —; terrain-raster-hint.ts)
@group(0) @binding(6) var<uniform> ring: vec4f;
@fragment fn ringFs(v: Vertex) -> @location(0) vec4f {
  let d = length(v.p);
  return vec4f(d, 0.0, d, rasterCode(ring.w, v.n));
}

@vertex fn screenVs(@builtin(vertex_index) k: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  return vec4f(p[k], 0, 1);
}
fn pixelDistance(i: vec2i) -> f32 { return textureLoad(distanceImage, i, 0).r; }
fn pixelPoint(i: vec2i) -> vec3f {
  let uv = (vec2f(i) + 0.5) / u.image.xy;
  let ray = normalize(vec3f((2.0 * uv.x - 1.0) * u.right.w, (1.0 - 2.0 * uv.y) * u.up.w, 1.0));
  return ray * pixelDistance(i);
}
@fragment fn inspectFs(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
  let dims = vec2i(u.image.xy);
  let i = clamp(vec2i(pixel.xy / u.output.xy * u.image.xy), vec2i(0), dims - 1);
  let distance = pixelDistance(i);
  if (distance <= 0.0) { discard; }
  if (u.image.w < 0.5) {
    let shade = 1.0 - clamp(log2(1.0 + distance) / log2(1000001.0), 0.0, 1.0);
    return vec4f(vec3f(shade), 1);
  }
  if (u.image.w < 1.5) {
    let l = max(i - vec2i(1,0), vec2i(0)); let r = min(i + vec2i(1,0), dims - 1);
    let b = max(i - vec2i(0,1), vec2i(0)); let t = min(i + vec2i(0,1), dims - 1);
    if (min(min(pixelDistance(l), pixelDistance(r)), min(pixelDistance(b), pixelDistance(t))) <= 0.0) {
      return vec4f(1,0.5,0,1);
    }
    let n0 = cross(pixelPoint(r) - pixelPoint(l), pixelPoint(t) - pixelPoint(b));
    let n = n0 * inverseSqrt(max(dot(n0,n0), 1e-20));
    return vec4f(0.5 + 0.5 * select(n, -n, dot(n, pixelPoint(i)) > 0.0), 1);
  }
  let baseline = referenceDepth[u32(i.y) * u32(dims.x) + u32(i.x)];
  if (baseline <= 0.0 || baseline >= 1e8) { return vec4f(1,0.8,0,1); }
  let error = distance - baseline * u.image.z;
  let amount = clamp(log2(1.0 + abs(error)) / log2(101.0), 0.0, 1.0);
  let color = select(vec3f(0.05,0.25,1), vec3f(1,0.1,0.05), error > 0.0);
  return vec4f(mix(vec3f(0.05,0.7,0.1), color, amount), 1);
}
`;
}

/** the band along a finer level's edge [its nodes] a ring's triangles overlap it by: both drawn there, no crack */
const RING_OVERLAP = 4;
/** A far ring to draw about the patch: its level's frame (terrainRasterFrame), level and window, its nodes' offset on the next
 *  finer level's grid (×4 and this: its hole), how many levels coarser than the patch it is. */
export interface TerrainRing {
  frame: Float32Array<ArrayBuffer>;
  level: number;
  window: TerrainWindow;
  hole: [number, number];
  /** its nodes' spacing over the next finer level's (4, or 2 between the finest two) */
  ratio: number;
  step: number;
  /** its rank from the patch (1 the first ring): its seams' mark (T2) */
  rank: number;
}
interface RingState {
  key: string;
  indexCount: number;
  vertex: GPUBuffer;
  index: GPUBuffer;
  uniform: GPUBuffer;
  hole: GPUBuffer;
  bind: GPUBindGroup | null;
  heightBind: GPUBindGroup | null;
  table: GPUBuffer | null;
  sources: TerrainCacheSources | null;
  /** (T6) its bind groups for each cascade of the shadow atlas, and the table they were made with */
  sunBinds: (GPUBindGroup | null)[];
  sunTable: GPUBuffer | null;
}

interface Attachments {
  distance: GPUTexture;
  depth: GPUTexture;
  width: number;
  height: number;
}

/** One bounded WGS84 patch, one level at a time. Its depth is not yet authoritative for gameplay. */
export class TerrainRaster {
  private mesh: GPURenderPipeline | null = null;
  private overlays = new Map<GPUTextureFormat, GPURenderPipeline | null>();
  private module: GPUShaderModule;
  private inspectLayout: GPUBindGroupLayout;
  private uniform: GPUBuffer | null = null;
  private index: GPUBuffer | null = null;
  private vertex: GPUBuffer | null = null;
  private meshKey = "";
  private indexCount = 0;
  private columns = 0;
  private rows = 0;
  private meshBuilds = 0;
  /** the meshes made ahead in the worker (the next window's), by key; the one asked and not back yet */
  private meshWorker: Worker | null | undefined;
  private meshReady = new Map<string, RasterMesh>();
  private meshAsked = "";
  /** the patch's meshes taken ready from the worker, made in the frame (none ready), the worker's last time [ms] */
  private meshAhead = 0;
  private meshInFrame = 0;
  private meshWorkerMs = 0;
  private conforming = false;
  private cutVertices = 0;
  private cutTriangles = 0;
  private meshBind: GPUBindGroup | null = null;
  private table: GPUBuffer | null = null;
  private heightSources: TerrainCacheSources | null = null;
  private heightBind: GPUBindGroup | null = null;
  private attachments: Attachments | null = null;
  private retired = new Set<Attachments>();
  private disposed = false;
  private error: string | null = null;
  private encodedFrames = 0;
  private active = false;
  private reason = "compiling";
  private level = -1;
  // the relief seen from the Sun: its depth map (trace.wgsl sunShadowFar), its pipeline, uniform and bind groups
  readonly sunDepth: GPUTexture;
  private sunPipe: GPURenderPipeline | null = null;
  private sunUniform: GPUBuffer;
  /** (T6) each cascade's view from the Sun — the patch's and each ring's bind groups with it */
  private sunUniforms: GPUBuffer[];
  private sunBinds: (GPUBindGroup | null)[] = [];
  private sunTable: GPUBuffer | null = null;
  private sunHeightBind: GPUBindGroup | null = null;
  private sunSources: TerrainCacheSources | null = null;
  sunFrames = 0;
  // the far rings (levels coarser than the patch's, each about the next finer): their pipeline and each one's mesh and bindings
  private ringPipe: GPURenderPipeline | null = null;
  private rings: RingState[] = [];
  ringsDrawn = 0;
  /** the rings drawn this frame and their levels (T6: drawn again into the shadow cascades) */
  private ringsLast: { r: RingState; level: number }[] = [];
  /** (T6) what the cascades were last drawn from — skipped while it stays the same: a still view, a tripod */
  private sunKey = "";
  sunSkipped = 0;
  /** whether the last encodeSunShadow drew the cascades (else they were kept: the caller's frame of them unchanged) */
  sunDrewNow = false;

  constructor(
    private device: GPUDevice,
    trace: string,
  ) {
    this.module = device.createShaderModule({ code: terrainRasterShader(trace), label: "terrain raster pilot" });
    this.sunDepth = device.createTexture({
      label: "relief seen from the Sun",
      size: [TERRAIN_SUN_CASCADES * TERRAIN_SUN_N, TERRAIN_SUN_N],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.sunUniform = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sunUniforms = Array.from({ length: TERRAIN_SUN_CASCADES }, () =>
      device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    );
    void device
      .createRenderPipelineAsync({
        layout: "auto",
        vertex: {
          module: this.module,
          entryPoint: "terrainSunVs",
          buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
      })
      .then(
        (p) => {
          if (!this.disposed) this.sunPipe = p;
        },
        (e) => this.failed(e),
      );
    this.inspectLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      ],
    });
    void device
      .createRenderPipelineAsync({
        layout: "auto",
        vertex: {
          module: this.module,
          entryPoint: "terrainVs",
          buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }],
        },
        fragment: { module: this.module, entryPoint: "terrainFs", targets: [{ format: TERRAIN_RASTER_FORMAT }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
      })
      .then(
        (p) => {
          if (!this.disposed) this.mesh = p;
        },
        (e) => this.failed(e),
      );
    void device
      .createRenderPipelineAsync({
        layout: "auto",
        vertex: {
          module: this.module,
          entryPoint: "terrainVs",
          buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }],
        },
        fragment: { module: this.module, entryPoint: "ringFs", targets: [{ format: TERRAIN_RASTER_FORMAT }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
      })
      .then(
        (p) => {
          if (!this.disposed) this.ringPipe = p;
        },
        (e) => this.failed(e),
      );
  }

  private ringState(k: number): RingState {
    let r = this.rings[k];
    if (!r) {
      const d = this.device;
      r = {
        key: "",
        indexCount: 0,
        vertex: d.createBuffer({ size: RASTER_MESH_VERTEX_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
        index: d.createBuffer({ size: RASTER_MESH_INDEX_BYTES, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }),
        uniform: d.createBuffer({ size: TERRAIN_RASTER_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        hole: d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
        bind: null,
        heightBind: null,
        table: null,
        sources: null,
        sunBinds: [],
        sunTable: null,
      };
      this.rings[k] = r;
    }
    return r;
  }

  private failed(e: unknown) {
    if (this.disposed) return;
    this.error = String(e);
    this.reason = "failed";
    console.warn("Terrain raster pilot unavailable; reference view retained:", e);
  }

  get unavailable() {
    return this.disposed || this.error !== null;
  }

  idle(reason: string) {
    this.active = false;
    this.reason = this.error ? "failed" : reason;
  }

  private retire(old: Attachments) {
    this.retired.add(old);
    const release = () => {
      if (!this.retired.delete(old)) return;
      old.distance.destroy();
      old.depth.destroy();
    };
    void this.device.queue.onSubmittedWorkDone().then(release, release);
  }

  /** Return the sizeable attachments after the inspector is disabled; keep its small reusable mesh. */
  suspend() {
    this.idle("off");
    if (this.attachments) this.retire(this.attachments);
    this.attachments = null;
  }

  private overlay(format: GPUTextureFormat) {
    if (!this.overlays.has(format)) {
      this.overlays.set(format, null);
      void this.device
        .createRenderPipelineAsync({
          layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.inspectLayout] }),
          vertex: { module: this.module, entryPoint: "screenVs" },
          fragment: { module: this.module, entryPoint: "inspectFs", targets: [{ format }] },
          primitive: { topology: "triangle-list" },
        })
        .then(
          (p) => {
            if (!this.disposed) this.overlays.set(format, p);
          },
          (e) => this.failed(e),
        );
    }
    return this.overlays.get(format);
  }

  private resize(width: number, height: number): boolean {
    if (this.attachments?.width === width && this.attachments.height === height) return true;
    if (width * height > TERRAIN_RASTER_MAX_PIXELS) {
      this.idle("pixel-budget");
      return false;
    }
    if (this.retired.size) {
      this.idle("retiring-target");
      return false;
    }
    const old = this.attachments;
    const distance = this.device.createTexture({
      label: "terrain raster metric distance",
      size: [width, height],
      format: TERRAIN_RASTER_FORMAT,
      // (copied from by renderer.rasterColumn — a diagnostic)
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    const depth = this.device.createTexture({
      label: "terrain raster reversed-Z",
      size: [width, height],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.attachments = { distance, depth, width, height };
    if (old) this.retire(old);
    return true;
  }

  /**
   * The patch's mesh for the window the cache moves to next (TerrainCache.upcomingWindow), made in a worker ahead of the move;
   * taken by encodeVisibility when that window comes. Without a worker (one failed to start): nothing, the mesh made in the frame.
   */
  prepare(level: number, window: TerrainWindow | null, runways: Float32Array) {
    if (!window || this.disposed) return;
    const key = `${level}:${window.i}:${window.j}:${runwayMeshKey(runways)}`;
    if (key === this.meshKey || key === this.meshAsked || this.meshReady.has(key)) return;
    if (this.meshWorker === undefined) {
      try {
        this.meshWorker = new Worker(new URL("terrain-mesh-worker.js", location.href), { type: "module" });
        this.meshWorker.onmessage = (e: MessageEvent<MeshReply>) => {
          if (e.data.key === this.meshAsked) this.meshAsked = "";
          this.meshWorkerMs = e.data.ms;
          // (two kept at most: the next window's, and one the motion turned from)
          this.meshReady.set(e.data.key, e.data.mesh);
          while (this.meshReady.size > 2) this.meshReady.delete(this.meshReady.keys().next().value!);
        };
        this.meshWorker.onerror = () => {
          this.meshWorker?.terminate();
          this.meshWorker = null;
        };
      } catch {
        this.meshWorker = null;
      }
    }
    if (!this.meshWorker) return;
    this.meshAsked = key;
    const q: MeshRequest = { key, level, window, runways: runways.slice() };
    this.meshWorker.postMessage(q);
  }

  /**
   * The patch's visibility pass: its metric distances in a texture the tracer's ground march can start from, and
   * the inspector's. False: nothing was drawn (compiling, no room, a target retiring), the texture not to be read.
   */
  encodeVisibility(
    enc: GPUCommandEncoder,
    sources: TerrainCacheSources,
    frame: Float32Array<ArrayBuffer>,
    level: number,
    window: TerrainWindow,
    runways: Float32Array,
    profile: (label: string, descriptor: GPURenderPassDescriptor) => GPURenderPassDescriptor,
    scenery?: (pass: GPURenderPassEncoder) => void,
    rings: TerrainRing[] = [],
  ): boolean {
    this.idle("compiling");
    if (this.disposed || this.error) return false;
    if (!this.mesh) return false;
    if (!this.resize(frame[24]!, frame[25]!)) return false;
    if (!this.uniform) {
      this.uniform = this.device.createBuffer({
        size: TERRAIN_RASTER_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.index = this.device.createBuffer({ size: RASTER_MESH_INDEX_BYTES, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      this.vertex = this.device.createBuffer({ size: RASTER_MESH_VERTEX_BYTES, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    const key = `${level}:${window.i}:${window.j}:${runwayMeshKey(runways)}`;
    if (key !== this.meshKey) {
      // (made ahead in the worker for this window — none: made here, in the frame)
      const ready = this.meshReady.get(key);
      const mesh = ready ?? terrainRasterMesh(window, level, runways);
      if (ready) this.meshAhead++;
      else this.meshInFrame++;
      this.meshReady.delete(key);
      this.device.queue.writeBuffer(this.vertex!, 0, mesh.vertices);
      this.device.queue.writeBuffer(this.index!, 0, mesh.indices);
      this.indexCount = mesh.indices.length;
      this.columns = mesh.columns;
      this.rows = mesh.rows;
      this.conforming = mesh.conforming;
      this.cutVertices = mesh.cutVertices;
      this.cutTriangles = mesh.cutTriangles;
      this.meshKey = key;
      this.meshBuilds++;
    }
    const table = sources.table;
    const old = this.heightSources;
    if (!old || !(Object.keys(sources) as (keyof TerrainCacheSources)[]).every((k) => old[k] === sources[k])) {
      this.heightBind = this.device.createBindGroup({
        layout: this.mesh.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: sources.params } },
          { binding: 4, resource: sources.sampler },
          { binding: 21, resource: sources.elevation.createView() },
          { binding: 28, resource: sources.tiles.createView({ dimension: "2d-array" }) },
        ],
      });
      this.heightSources = sources;
    }
    if (this.table !== table) {
      this.table = table;
      this.meshBind = this.device.createBindGroup({
        layout: this.mesh.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: { buffer: table } },
        ],
      });
    }
    this.device.queue.writeBuffer(this.uniform, 0, frame);
    const a = this.attachments!;
    const pass = enc.beginRenderPass(
      profile("terrain raster visibility", {
        colorAttachments: [{ view: a.distance.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
        depthStencilAttachment: { view: a.depth.createView(), depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "discard" },
      }),
    );
    pass.setPipeline(this.mesh);
    pass.setBindGroup(0, this.meshBind!);
    pass.setBindGroup(1, this.heightBind!);
    pass.setIndexBuffer(this.index!, "uint32");
    pass.setVertexBuffer(0, this.vertex!);
    pass.drawIndexed(this.indexCount);
    // (the far rings beyond it: the farther ground found from them too, not marched from the camera)
    this.ringsDrawn = 0;
    this.ringsLast = [];
    if (this.ringPipe)
      for (let k = 0; k < rings.length; k++) {
        const r = this.ringState(k);
        if (this.drawRing(pass, this.ringPipe, r, rings[k]!, sources)) {
          this.ringsDrawn++;
          this.ringsLast.push({ r, level: rings[k]!.level });
        }
      }
    // (the scenery's instances after the ground, against its depth, their ids in g alone — system/scenery-raster.ts)
    scenery?.(pass);
    pass.end();
    this.active = true;
    this.reason = "pilot";
    this.level = level;
    this.encodedFrames++;
    return true;
  }

  /**
   * Another world's ground in the same target (system/body-raster.ts — PLAN-PLANETES-AAA P1): its distances where the tracer's
   * kernels read the Earth's. False: nothing drawn (no room, a target retiring, its pipeline compiling).
   */
  encodeBody(
    enc: GPUCommandEncoder,
    width: number,
    height: number,
    body: { ready: boolean; draw: (pass: GPURenderPassEncoder) => void },
    profile: (label: string, descriptor: GPURenderPassDescriptor) => GPURenderPassDescriptor,
  ): boolean {
    this.idle("compiling");
    if (this.disposed || this.error || !body.ready) return false;
    if (!this.resize(width, height)) return false;
    const a = this.attachments!;
    const pass = enc.beginRenderPass(
      profile("body raster visibility", {
        colorAttachments: [{ view: a.distance.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
        depthStencilAttachment: { view: a.depth.createView(), depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "discard" },
      }),
    );
    body.draw(pass);
    pass.end();
    this.ringsDrawn = 0;
    this.active = true;
    this.reason = "body";
    this.encodedFrames++;
    return true;
  }

  private drawRing(pass: GPURenderPassEncoder, pipe: GPURenderPipeline, r: RingState, ring: TerrainRing, sources: TerrainCacheSources) {
    const d = this.device;
    const key = `${ring.level}:${ring.window.i}:${ring.window.j}:${ring.hole[0]}:${ring.hole[1]}:${ring.ratio}`;
    if (key !== r.key) {
      // (a plain grid — the runways' cuts are the patch's, near —, its cells under the finer level left out: the triangles
      // whose corners all fall inside it, its edge's band of RING_OVERLAP nodes kept — drawn both, the nearer kept, no crack;
      // cut out of the mesh, not discarded: the depth test early, no hidden ground shaded twice)
      const mesh = terrainRasterMesh(ring.window, ring.level, new Float32Array(4));
      const v = mesh.vertices;
      const last = TERRAIN_CACHE_N - 1;
      const inside = (k: number) => {
        const x = v[3 * k]! * ring.ratio + ring.hole[0],
          y = v[3 * k + 1]! * ring.ratio + ring.hole[1];
        return x > RING_OVERLAP && x < last - RING_OVERLAP && y > RING_OVERLAP && y < last - RING_OVERLAP;
      };
      const ix = mesh.indices;
      const kept = new Uint32Array(ix.length);
      let n = 0;
      for (let i = 0; i < ix.length; i += 3)
        if (!(inside(ix[i]!) && inside(ix[i + 1]!) && inside(ix[i + 2]!))) {
          kept[n++] = ix[i]!;
          kept[n++] = ix[i + 1]!;
          kept[n++] = ix[i + 2]!;
        }
      d.queue.writeBuffer(r.vertex, 0, v);
      d.queue.writeBuffer(r.index, 0, kept, 0, n);
      r.indexCount = n;
      r.key = key;
    }
    const old = r.sources;
    if (!r.heightBind || !old || !(Object.keys(sources) as (keyof TerrainCacheSources)[]).every((k) => old[k] === sources[k])) {
      r.heightBind = d.createBindGroup({
        layout: pipe.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: sources.params } },
          { binding: 4, resource: sources.sampler },
          { binding: 21, resource: sources.elevation.createView() },
          { binding: 28, resource: sources.tiles.createView({ dimension: "2d-array" }) },
        ],
      });
      r.sources = sources;
    }
    if (r.table !== sources.table || !r.bind) {
      r.table = sources.table;
      r.bind = d.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: r.uniform } },
          { binding: 1, resource: { buffer: sources.table } },
          { binding: 6, resource: { buffer: r.hole } },
        ],
      });
    }
    d.queue.writeBuffer(r.uniform, 0, ring.frame);
    // (its mark: its rank from the patch — its seams, rasterNormal, PLAN-REFRACTION-HORIZONS T2 — and its step — the tracer's
    // tolerance, the rings' sparser shading: the rings finer than the reference patch share step 0 —, terrain-raster-hint.ts)
    d.queue.writeBuffer(r.hole, 0, new Float32Array([ring.hole[0], ring.hole[1], RING_OVERLAP, rasterGroundCode(ring.rank, ring.step)]));
    pass.setPipeline(pipe);
    pass.setBindGroup(0, r.bind);
    pass.setBindGroup(1, r.heightBind);
    pass.setIndexBuffer(r.index, "uint32");
    pass.setVertexBuffer(0, r.vertex);
    pass.drawIndexed(r.indexCount);
    return true;
  }

  /**
   * The patch seen from the Sun, after this frame's visibility (its mesh and heights): `sun` its orthographic view —
   * right, up over their half-widths, the Sun's direction over the depth's half-range (vec4s; the Earth's axes, camera-
   * relative metres). False: not drawn (compiling, nothing drawn this frame) — the shadows then marched as before.
   */
  encodeSunShadow(
    enc: GPUCommandEncoder,
    sources: TerrainCacheSources,
    suns: Float32Array[],
    profile: (label: string, descriptor: GPURenderPassDescriptor) => GPURenderPassDescriptor,
    revision = "",
  ): boolean {
    if (!this.active || !this.sunPipe || !this.uniform || !this.table || this.disposed) return false;
    // (the cascades kept while nothing they are drawn from changed: the Sun's view and the cascades' centres, the meshes' windows,
    // the heights' bakes — the caller's revision, renderer.sunRevision)
    // (the meshes' windows in it since Q6 I3: a window recentred does not draw the same relief — its geomorphose follows the
    // window's edge, a place passes from a ring to a finer level —; kept, the map stood metres above the image's ground in the
    // hollows, shadows in combs where nothing stands)
    const key = revision;
    this.sunDrewNow = false;
    if (key === this.sunKey) {
      this.sunSkipped++;
      return true;
    }
    this.sunKey = key;
    this.sunDrewNow = true;
    const d = this.device;
    const pipe = this.sunPipe;
    const old = this.sunSources;
    const table = this.table;
    if (!this.sunHeightBind || !old || !(Object.keys(sources) as (keyof TerrainCacheSources)[]).every((k) => old[k] === sources[k])) {
      this.sunHeightBind = d.createBindGroup({
        layout: pipe.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: sources.params } },
          { binding: 4, resource: sources.sampler },
          { binding: 21, resource: sources.elevation.createView() },
          { binding: 28, resource: sources.tiles.createView({ dimension: "2d-array" }) },
        ],
      });
      this.sunSources = sources;
    }
    // (each cascade's bind groups: the patch's frame, or a ring's, the table, the cascade's view — made again with a new table)
    const bind = (uniform: GPUBuffer, k: number) =>
      d.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: table } },
          { binding: 5, resource: { buffer: this.sunUniforms[k]! } },
        ],
      });
    if (this.sunTable !== table) {
      this.sunBinds = [];
      this.sunTable = table;
    }
    const pass = enc.beginRenderPass(
      profile("terrain from the Sun", {
        colorAttachments: [],
        depthStencilAttachment: { view: this.sunDepth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
      }),
    );
    pass.setPipeline(pipe);
    pass.setBindGroup(1, this.sunHeightBind!);
    // (T6: each cascade in its square of the atlas — the patch and every ring drawn this frame, their surfaces geomorphosed as the
    // image's: the ground's shadows cast by the same relief the camera sees, near and out to the cascade's edge)
    const n = Math.min(suns.length, TERRAIN_SUN_CASCADES);
    for (let k = 0; k < n; k++) {
      d.queue.writeBuffer(this.sunUniforms[k]!, 0, suns[k]! as Float32Array<ArrayBuffer>);
      pass.setViewport(k * TERRAIN_SUN_N, 0, TERRAIN_SUN_N, TERRAIN_SUN_N, 0, 1);
      pass.setScissorRect(k * TERRAIN_SUN_N, 0, TERRAIN_SUN_N, TERRAIN_SUN_N);
      this.sunBinds[k] ??= bind(this.uniform, k);
      pass.setBindGroup(0, this.sunBinds[k]!);
      pass.setIndexBuffer(this.index!, "uint32");
      pass.setVertexBuffer(0, this.vertex!);
      // (the finest levels in the first cascade alone — the second is read beyond it —; the coarsest ring, past the depth's reach,
      // in neither: its window outside the finer ones' is ±40 km away and more)
      if (k === 0) pass.drawIndexed(this.indexCount);
      for (const { r, level } of this.ringsLast) {
        if (level >= TERRAIN_CACHE_RING_LAST || (k > 0 && level < TERRAIN_CACHE_SUN_C1)) continue;
        if (r.sunTable !== table) {
          r.sunBinds = [];
          r.sunTable = table;
        }
        r.sunBinds[k] ??= bind(r.uniform, k);
        pass.setBindGroup(0, r.sunBinds[k]!);
        pass.setIndexBuffer(r.index, "uint32");
        pass.setVertexBuffer(0, r.vertex);
        pass.drawIndexed(r.indexCount);
      }
    }
    pass.end();
    this.sunFrames++;
    return true;
  }

  /**
   * Another world's ground seen from the Sun (system/body-raster.ts drawSun: its levels' mesh and heights, after this frame's
   * visibility) into the relief's shadow map — the Earth's own, read alike (trace.wgsl sunShadowFar). False: not drawn.
   */
  encodeBodySun(
    enc: GPUCommandEncoder,
    body: { drawSun: (pass: GPURenderPassEncoder, sun: GPUBuffer) => boolean },
    sun: Float32Array,
    profile: (label: string, descriptor: GPURenderPassDescriptor) => GPURenderPassDescriptor,
  ): boolean {
    if (this.disposed || this.error) return false;
    this.device.queue.writeBuffer(this.sunUniform, 0, sun as Float32Array<ArrayBuffer>);
    const pass = enc.beginRenderPass(
      profile("body from the Sun", {
        colorAttachments: [],
        depthStencilAttachment: { view: this.sunDepth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
      }),
    );
    // (another world: the first cascade's square alone — sunShadowFar reads the second only where its row says it is drawn —;
    // the Earth's cascades drawn again when it comes back)
    this.sunKey = "";
    pass.setViewport(0, 0, TERRAIN_SUN_N, TERRAIN_SUN_N, 0, 1);
    pass.setScissorRect(0, 0, TERRAIN_SUN_N, TERRAIN_SUN_N);
    const drawn = body.drawSun(pass, this.sunUniform);
    pass.end();
    if (drawn) this.sunFrames++;
    return drawn;
  }

  /** The distances drawn this frame (rgba32float: r the ground's metres from the camera, 0 where no triangle covers a pixel;
   *  g the scenery's instance; b the nearest surface's metres), else null. */
  distanceTexture(): GPUTexture | null {
    return this.active && !this.error ? (this.attachments?.distance ?? null) : null;
  }

  /** The inspector's overlay over the final image, after the patch was drawn this frame. */
  encodeInspector(
    enc: GPUCommandEncoder,
    output: GPUTexture,
    sceneDepth: GPUBuffer,
    profile: (label: string, descriptor: GPURenderPassDescriptor) => GPURenderPassDescriptor,
  ): boolean {
    const overlay = this.overlay(output.format);
    const a = this.attachments;
    if (!this.active || !overlay || !a || !this.uniform) return false;
    const bind = this.device.createBindGroup({
      layout: overlay.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 2, resource: a.distance.createView() },
        { binding: 3, resource: { buffer: sceneDepth } },
      ],
    });
    const inspect = enc.beginRenderPass(
      profile("terrain raster inspector", {
        colorAttachments: [{ view: output.createView(), loadOp: "load", storeOp: "store" }],
      }),
    );
    inspect.setPipeline(overlay);
    inspect.setBindGroup(0, bind);
    inspect.draw(3);
    inspect.end();
    return true;
  }

  stats() {
    const a = this.attachments;
    return {
      compiled: this.mesh !== null,
      error: this.error,
      active: this.active,
      reason: this.reason,
      encodedFrames: this.encodedFrames,
      level: this.level,
      rings: this.ringsDrawn,
      triangles: this.indexCount / 3,
      columns: this.columns,
      rows: this.rows,
      meshBuilds: this.meshBuilds,
      meshAhead: this.meshAhead,
      meshInFrame: this.meshInFrame,
      meshWorkerMs: +this.meshWorkerMs.toFixed(1),
      conforming: this.conforming,
      cutVertices: this.cutVertices,
      cutTriangles: this.cutTriangles,
      width: a?.width ?? 0,
      height: a?.height ?? 0,
      targetBytes: a ? a.width * a.height * 20 : 0,
      retiredBytes: [...this.retired].reduce((s, p) => s + p.width * p.height * 20, 0),
      indexBytes: this.index?.size ?? 0,
      vertexBytes: this.vertex?.size ?? 0,
      uniformBytes: this.uniform?.size ?? 0,
    };
  }

  dispose() {
    this.disposed = true;
    this.meshWorker?.terminate();
    this.meshWorker = null;
    this.meshReady.clear();
    this.idle("disposed");
    this.uniform?.destroy();
    this.sunDepth.destroy();
    this.sunUniform.destroy();
    for (const b of this.sunUniforms) b.destroy();
    this.index?.destroy();
    this.vertex?.destroy();
    for (const r of this.rings) for (const b of [r.vertex, r.index, r.uniform, r.hole]) b.destroy();
    this.rings = [];
    for (const a of [...this.retired, ...(this.attachments ? [this.attachments] : [])]) {
      a.distance.destroy();
      a.depth.destroy();
    }
    this.retired.clear();
    this.attachments = null;
    this.meshBind = null;
    this.table = null;
    this.heightBind = null;
    this.heightSources = null;
  }
}
