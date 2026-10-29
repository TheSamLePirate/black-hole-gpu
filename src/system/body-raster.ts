// The near ground of a world other than the Earth drawn by the raster (docs/PLAN-PLANETES-AAA.md P1): the worlds the tracer
// marches without the Earth's air — Gargantua's (Miller, Mann, Edmunds), the Moon, Mercury, the airless moons (trace.wgsl
// nearMarch, NEAR_KIND 3). Their relief is the tracer's own function (trace.wgsl relief: the procedural layers, the measured
// heights over them), evaluated at the vertices here; the triangles write the Earth raster's distance target (system/
// terrain-raster.ts encodeBody — r the ground's distance [m], a 1), which the tracer's kernels already read: main leaves those
// pixels, shadeLite shades each one (trace.wgsl bodyLite). The Earth's own path — its cache, runways, geoid, scenery — is
// untouched.
//
// The mesh: nested square grids on the plane tangent to the world at a reference point (gnomonic — straight lines on the plane
// are great circles), each one's cells twice the next finer one's, every one centred on the camera's ground point snapped to
// its own cells' double (a geometry clipmap: a level moves by whole cells, its heights do not swim); the coarser ones drawn
// as rings about the finer one's square, a band of cells drawn by both (the nearer kept — no crack). The finest cell follows
// the height above the ground (1/100 of it, 0.5 m … 256 m, a power of two); the levels reach the horizon and the relief's
// highest peaks beyond it.

import type { CameraFrame } from "../camera";
import { dot, type Vec3 } from "../math/vec3";
import type { LocalPatch } from "./local-patch";
import { wgslFunction } from "./warp-grid";

/** a level's grid: nodes per side (128 cells) */
export const BODY_GRID_N = 129;
/** the most levels drawn (the coarsest's cells 2^(n-1) times the finest's) */
export const BODY_LEVELS_MAX = 16;
/** the uniform: 8 vec4 + one per level */
export const BODY_RASTER_UNIFORM_BYTES = (8 + BODY_LEVELS_MAX) * 16;
/** a coarser level's hole: its cells inside ±HOLE of its centre are the finer level's (it spans ±32 of them, its centre
 *  within one of the coarser one's — two cells' band drawn by both) */
const HOLE = 30;
/** the reference point kept while the camera's ground point stays within this [rad] of it (a new one: every level's
 *  vertices move — kept rare) */
const REANCHOR = 0.02;

// The procedural surfaces' relief heights' reach [m] — trace.wgsl reliefMax, the same table (tests/body-raster.test.ts).
/** the tracer's airless worlds among our surfaces (trace.wgsl regolith, airless) */
const regolith = (m: number) => (m >= 1 && m <= 3) || (m >= 7 && m <= 18) || m === 22;
const airless = (surf: number) => surf >= 4 && regolith(surf - 4) && surf - 4 !== 2 && surf - 4 !== 22;
export function reliefMax(surf: number): number {
  if (surf === 0) return 1300;
  if (surf === 1) return 4600;
  if (surf === 2) return 1800;
  return airless(surf) ? 500 : 0;
}

/**
 * The library the vertex shader evaluates the relief with: trace.wgsl's `relief` and everything it calls, its constants and
 * private globals (the craters' `CRATER_*`), the parameters' struct; the tracer's own bindings of the parameters, the sampler
 * and the measured heights (0, 4, 23), in group 1.
 */
export function bodyReliefLibrary(trace: string): string {
  const functions = new Map<string, string>();
  for (const [, name] of trace.matchAll(/^fn (\w+)\(/gm)) functions.set(name!, wgslFunction(trace, name!));
  const selected = new Map<string, string>();
  const add = (name: string) => {
    if (name === "cost" || selected.has(name)) return;
    const body = functions.get(name);
    if (!body) throw new Error(`body-raster: missing ${name}`);
    selected.set(name, body);
    for (const [, callee] of body.matchAll(/\b(\w+)\s*\(/g)) if (functions.has(callee!)) add(callee!);
  };
  add("relief");
  const declarations = new Map<string, string>();
  for (const [line, name] of trace.matchAll(/^(?:const|override)\s+(\w+)\b[^;]*;/gm)) declarations.set(name!, line!);
  for (const [line, name] of trace.matchAll(/^var<private>\s+(\w+)\b[^;]*;/gm)) declarations.set(name!, line!);
  let source = [...selected.values()].join("\n");
  const kept = new Map<string, string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, declaration] of declarations)
      if (!kept.has(name) && new RegExp(`\\b${name}\\b`).test(source)) {
        kept.set(name, declaration);
        source += `\n${declaration}`;
        grew = true;
      }
  }
  const params = /struct Params\s*\{[\s\S]*?\};/.exec(trace)?.[0];
  if (!params) throw new Error("body-raster: missing Params");
  return `${params}
${[...kept.values()].join("\n")}
@group(1) @binding(0) var<uniform> P: Params;
@group(1) @binding(4) var bgSamp: sampler;
@group(1) @binding(23) var hdRelief: texture_2d<f32>;
fn cost(k: u32) {}
${[...selected.values()].join("\n")}`;
}

export function bodyRasterShader(trace: string): string {
  return `
${bodyReliefLibrary(trace)}
const GRID_MID = ${(BODY_GRID_N - 1) / 2}.0;
struct U {
  origin: vec4f, ref0: vec4f, east: vec4f, north: vec4f,
  right: vec4f, up: vec4f, forward: vec4f, image: vec4f,
  level: array<vec4f, ${BODY_LEVELS_MAX}>,
};
@group(0) @binding(0) var<uniform> u: U;
// the levels' heights [m], node by node (level, row, column): worked out by bodyHeights for the levels that moved — the
// mesh's nodes read them; and which levels to work out (bits of x)
@group(0) @binding(1) var<storage, read_write> heightsW: array<f32>;
@group(0) @binding(2) var<storage, read> heights: array<f32>;
@group(0) @binding(3) var<uniform> dirty: vec4u;
const GRID_N = ${BODY_GRID_N}u;
struct Node { q: vec3f, d: vec3f };
// A node's direction on the body's axes: on the tangent plane at the reference point (gnomonic), and its offset from the
// reference worked out without cancellation
fn node(ij: vec2f, level: u32) -> Node {
  let lv = u.level[level];
  let t = lv.xy + (ij - vec2f(GRID_MID)) * lv.z;
  let tv = t.x * u.east.xyz + t.y * u.north.xyz;
  let tt = dot(t, t);
  let len = sqrt(1.0 + tt);
  // (q − ref0 = (tv − ref0 (len − 1)) / len, len − 1 = tt / (1 + len))
  return Node(normalize((u.ref0.xyz + tv) / len), (tv - u.ref0.xyz * (tt / (1.0 + len))) / len);
}
// The relief at the nodes of the levels that moved (or whose ground moves: Miller's waves) — a thread a node
@compute @workgroup_size(8, 8) fn bodyHeights(@builtin(global_invocation_id) g: vec3u) {
  let level = g.z;
  if (g.x >= GRID_N || g.y >= GRID_N || level >= u32(u.ref0.w) || ((dirty.x >> level) & 1u) == 0u) { return; }
  let n = node(vec2f(g.xy), level);
  heightsW[(level * GRID_N + g.y) * GRID_N + g.x] = relief(u32(u.east.w), n.q, u.level[level].w, u.origin.w, P.time.x * P.near5.w);
}
struct Vertex { @builtin(position) clip: vec4f, @location(0) p: vec3f };

// A node's point, camera-relative on the body's axes [m], raised by its level's height
@vertex fn bodyVs(@location(0) ij: vec2f, @builtin(instance_index) level: u32) -> Vertex {
  let n = node(ij, level);
  let h = heights[(level * GRID_N + u32(ij.y)) * GRID_N + u32(ij.x)];
  let p = u.origin.xyz + n.d * u.origin.w + n.q * h;
  var v: Vertex;
  v.p = vec3f(dot(p, u.right.xyz), dot(p, u.up.xyz), dot(p, u.forward.xyz));
  // (infinite reversed Z, the near plane in metres; the frame's sub-pixel jitter in NDC — the rays' own)
  v.clip = vec4f(v.p.x / u.right.w + u.image.z * v.p.z, v.p.y / u.up.w + u.image.w * v.p.z, u.forward.w, v.p.z);
  return v;
}
// (r: the ground's distance [m]; b the same — the nearest surface —; a 1: drawn by the raster's patch)
@fragment fn bodyFs(v: Vertex) -> @location(0) vec4f { let d = length(v.p); return vec4f(d, 0.0, d, 1.0); }
`;
}

/** The grid's nodes (i, j) and its two index lists: the finest level's whole square, a coarser level's ring. */
export function bodyGridMesh(): { vertices: Float32Array<ArrayBuffer>; full: Uint32Array<ArrayBuffer>; ring: Uint32Array<ArrayBuffer> } {
  const N = BODY_GRID_N;
  const vertices = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      vertices[2 * (j * N + i)] = i;
      vertices[2 * (j * N + i) + 1] = j;
    }
  const full: number[] = [];
  const ring: number[] = [];
  const mid = (N - 1) / 2;
  for (let j = 0; j < N - 1; j++)
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      const quad = [a, a + 1, a + N, a + 1, a + N + 1, a + N];
      full.push(...quad);
      // (a cell inside ±HOLE of the centre: the finer level's)
      const inside = i >= mid - HOLE && i + 1 <= mid + HOLE && j >= mid - HOLE && j + 1 <= mid + HOLE;
      if (!inside) ring.push(...quad);
    }
  return { vertices, full: new Uint32Array(full), ring: new Uint32Array(ring) };
}

/** What a frame of the body raster needs from the renderer. */
export interface BodyRasterView {
  near: LocalPatch;
  camera: CameraFrame;
  /** the near body's surface (trace.wgsl surf) */
  surf: number;
  image: { width: number; height: number };
  fovDegrees: number;
  /** metres per M (1476.625 × the hole's mass in suns) */
  mPerM: number;
  /** the frame's jitter in NDC (the rays' own) */
  jitter: [number, number];
}

/** The reference point and its tangent axes, kept from frame to frame (BodyRaster). */
export interface BodyAnchor {
  surf: number;
  r0: Vec3;
  east: Vec3;
  north: Vec3;
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The frame's uniform (float64 here, its small camera-relative parts rounded once): the camera on the body's axes, the
 * reference point (kept unless the camera's ground point left it — `anchor`, returned), the levels' snapped centres. Null: no
 * relief to draw (the camera too high, or in it).
 */
export function bodyRasterFrame(
  v: BodyRasterView,
  anchor: BodyAnchor | null,
): { uniform: Float32Array<ArrayBuffer>; anchor: BodyAnchor; levels: number } | null {
  const { near, camera } = v;
  const R = near.radius * v.mPerM;
  const hmax = reliefMax(v.surf);
  if (!(R > 0) || hmax <= 0) return null;
  // the camera on the body's axes [m], its ground point, its height over the sphere
  const eye = near.axes.map((a) => -dot(near.centre, a) * R) as Vec3;
  const re = Math.hypot(eye[0], eye[1], eye[2]);
  const alt = re - R;
  if (!(alt > -hmax) || alt > 0.5 * R) return null;
  const sub = unit(eye);
  let a = anchor;
  if (!a || a.surf !== v.surf || dot(a.r0, sub) < Math.cos(REANCHOR)) {
    const r0 = sub;
    const east = unit(cross(Math.abs(r0[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], r0));
    a = { surf: v.surf, r0, east, north: cross(r0, east) };
  }
  // the finest cell [m]: a hundredth of the height over the relief's floor, a power of two
  const above = Math.max(alt, 1);
  const cell0 = 2 ** Math.round(Math.log2(Math.min(256, Math.max(0.5, above / 100))));
  const s0 = cell0 / R;
  // the levels to the horizon and the highest peaks beyond it (the angles from the ground point), and the reference's offset
  const horizon = Math.acos(Math.min(1, R / Math.max(re, R))) + Math.acos(R / (R + hmax));
  const reach = Math.min(1.2, horizon + Math.acos(Math.min(1, dot(a.r0, sub))) + 0.01);
  const levels = Math.max(1, Math.min(BODY_LEVELS_MAX, Math.ceil(Math.log2(Math.tan(reach) / (64 * s0))) + 1));
  // the camera's ground point on the tangent plane (gnomonic), each level's centre snapped to twice its cells
  const c = dot(sub, a.r0);
  const ct: [number, number] = [dot(sub, a.east) / c, dot(sub, a.north) / c];
  const f = new Float32Array(BODY_RASTER_UNIFORM_BYTES / 4);
  const origin = a.r0.map((x, k) => x * R - eye[k]!) as Vec3;
  const body = (w: Vec3) => near.axes.map((ax) => dot(ax, w)) as Vec3;
  const tanV = Math.tan((v.fovDegrees * Math.PI) / 360);
  f.set([...origin, R], 0);
  f.set([...a.r0, levels], 4);
  f.set([...a.east, v.surf], 8);
  f.set([...a.north, 0], 12);
  f.set([...body(camera.right), (tanV * v.image.width) / v.image.height], 16);
  f.set([...body(camera.up), tanV], 20);
  f.set([...body(camera.fwd), 0.25], 24);
  f.set([v.image.width, v.image.height, v.jitter[0], v.jitter[1]], 28);
  for (let l = 0; l < levels; l++) {
    const s = s0 * 2 ** l;
    const snap = (x: number) => Math.round(x / (2 * s)) * 2 * s;
    f.set([snap(ct[0]), snap(ct[1]), s, cell0 * 2 ** l], 32 + 4 * l);
  }
  return { uniform: f, anchor: a, levels };
}

/** The pipeline, the grid and the bindings of the body raster (drawn into the Earth raster's target: TerrainRaster.encodeBody). */
export class BodyRaster {
  private pipe: GPURenderPipeline | null = null;
  private heightPipe: GPUComputePipeline | null = null;
  private module: GPUShaderModule;
  private uniform: GPUBuffer;
  private dirtyBuf: GPUBuffer;
  private heights: GPUBuffer;
  private vertex: GPUBuffer;
  private full: GPUBuffer;
  private ring: GPUBuffer;
  private fullCount: number;
  private ringCount: number;
  private bind: GPUBindGroup | null = null;
  private heightBind: GPUBindGroup | null = null;
  private sourceBind: GPUBindGroup | null = null;
  private sources: { params: GPUBuffer; sampler: GPUSampler; relief: GPUTexture } | null = null;
  private anchor: BodyAnchor | null = null;
  /** each level's heights' key (its anchor, centre, cells, world, the measured heights' texture): worked out again when it changes */
  private levelKeys: string[] = [];
  private frames = 0;
  error: string | null = null;
  /** the last frame's levels and how many were worked out again (a diagnostic) */
  levels = 0;
  rebuilt = 0;

  constructor(
    private device: GPUDevice,
    trace: string,
  ) {
    this.module = device.createShaderModule({ code: bodyRasterShader(trace), label: "body raster" });
    const mesh = bodyGridMesh();
    this.uniform = device.createBuffer({ size: BODY_RASTER_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dirtyBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.heights = device.createBuffer({ size: BODY_LEVELS_MAX * BODY_GRID_N * BODY_GRID_N * 4, usage: GPUBufferUsage.STORAGE });
    this.vertex = device.createBuffer({ size: mesh.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.full = device.createBuffer({ size: mesh.full.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.ring = device.createBuffer({ size: mesh.ring.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.vertex, 0, mesh.vertices);
    device.queue.writeBuffer(this.full, 0, mesh.full);
    device.queue.writeBuffer(this.ring, 0, mesh.ring);
    this.fullCount = mesh.full.length;
    this.ringCount = mesh.ring.length;
    const failed = (e: unknown) => {
      this.error = String(e);
      console.warn("Body raster unavailable; the tracer's march retained:", e);
    };
    void device
      .createRenderPipelineAsync({
        layout: "auto",
        vertex: {
          module: this.module,
          entryPoint: "bodyVs",
          buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }],
        },
        fragment: { module: this.module, entryPoint: "bodyFs", targets: [{ format: "rgba32float" }] },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
      })
      .then((p) => (this.pipe = p), failed);
    void device
      .createComputePipelineAsync({ layout: "auto", compute: { module: this.module, entryPoint: "bodyHeights" } })
      .then((p) => (this.heightPipe = p), failed);
  }

  get ready() {
    return !!this.pipe && !!this.heightPipe && !this.error;
  }

  /**
   * The frame's uniform written and the levels that moved worked out again (their heights, before the pass that draws them);
   * false: nothing to draw (no pipeline yet, the camera too high).
   */
  prepare(
    enc: GPUCommandEncoder,
    v: BodyRasterView,
    sources: { params: GPUBuffer; sampler: GPUSampler; relief: GPUTexture },
    pass: GPUComputePassDescriptor = {},
  ): boolean {
    if (!this.pipe || !this.heightPipe) return false;
    const fr = bodyRasterFrame(v, this.anchor);
    if (!fr) return false;
    const reanchored = fr.anchor !== this.anchor;
    this.anchor = fr.anchor;
    this.levels = fr.levels;
    this.device.queue.writeBuffer(this.uniform, 0, fr.uniform);
    this.bind ??= this.device.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 2, resource: { buffer: this.heights } },
      ],
    });
    this.heightBind ??= this.device.createBindGroup({
      layout: this.heightPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.heights } },
        { binding: 3, resource: { buffer: this.dirtyBuf } },
      ],
    });
    const old = this.sources;
    const sourcesChanged =
      !this.sourceBind || !old || old.params !== sources.params || old.sampler !== sources.sampler || old.relief !== sources.relief;
    if (sourcesChanged) {
      this.sourceBind = this.device.createBindGroup({
        layout: this.heightPipe.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: sources.params } },
          { binding: 4, resource: sources.sampler },
          { binding: 23, resource: sources.relief.createView() },
        ],
      });
      this.sources = sources;
      this.levelKeys = [];
    }
    if (reanchored) this.levelKeys = [];
    // (the levels whose nodes moved — a centre snapped to the next cells, the cells' size, the world —; Miller's waves move the
    // ground itself: its three finest levels each frame, a coarser one in turn)
    let dirty = 0;
    const f = fr.uniform;
    const waves = v.surf === 0;
    this.frames++;
    for (let l = 0; l < fr.levels; l++) {
      const key = `${v.surf}:${f[32 + 4 * l]}:${f[33 + 4 * l]}:${f[34 + 4 * l]}`;
      const turn = waves && (l < 3 || this.frames % Math.max(1, fr.levels - 3) === l - 3);
      if (key !== this.levelKeys[l] || turn) {
        dirty |= 1 << l;
        this.levelKeys[l] = key;
      }
    }
    this.rebuilt = 0;
    for (let b = dirty; b; b &= b - 1) this.rebuilt++;
    if (dirty) {
      this.device.queue.writeBuffer(this.dirtyBuf, 0, new Uint32Array([dirty, 0, 0, 0]));
      const cp = enc.beginComputePass(pass);
      cp.setPipeline(this.heightPipe);
      cp.setBindGroup(0, this.heightBind);
      cp.setBindGroup(1, this.sourceBind!);
      const g = Math.ceil(BODY_GRID_N / 8);
      cp.dispatchWorkgroups(g, g, fr.levels);
      cp.end();
    }
    return true;
  }

  /** The levels drawn into an open pass (its target the raster's distances, its depth reversed Z): the finest whole, the rest
   *  as rings. */
  draw(pass: GPURenderPassEncoder) {
    if (!this.pipe || !this.bind) return;
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bind);
    pass.setVertexBuffer(0, this.vertex);
    pass.setIndexBuffer(this.full, "uint32");
    pass.drawIndexed(this.fullCount, 1, 0, 0, 0);
    if (this.levels > 1) {
      pass.setIndexBuffer(this.ring, "uint32");
      pass.drawIndexed(this.ringCount, this.levels - 1, 0, 0, 1);
    }
  }

  dispose() {
    for (const b of [this.uniform, this.dirtyBuf, this.heights, this.vertex, this.full, this.ring]) b.destroy();
  }
}
