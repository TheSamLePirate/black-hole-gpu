import { TERRAIN_CACHE_N } from "./terrain-cache-layout";

/** The relief's shadow map's side [texels] (system/terrain-raster.ts encodeSunShadow, trace.wgsl sunShadowFar). */
export const TERRAIN_SUN_N = 2048;
/** The visibility target: r the ground's distance [m], g the scenery's instance drawn nearest (system/scenery-raster.ts),
 *  b the nearest surface's distance [m] (the ground's, or the instance's proxy in front of it). */
export const TERRAIN_RASTER_FORMAT: GPUTextureFormat = "rgba32float";
import { terrainHeightLibrary, type TerrainCacheSources } from "./terrain-cache";
import { TERRAIN_RASTER_MAX_PIXELS, TERRAIN_RASTER_UNIFORM_BYTES } from "./terrain-raster-frame";
import { RASTER_MESH_INDEX_BYTES, RASTER_MESH_VERTEX_BYTES, runwayMeshKey, terrainRasterMesh } from "./terrain-raster-mesh";
import type { TerrainWindow } from "./terrain-cache-layout";

/** The pilot's geometry and inspector, deliberately separate from radiance and the reference tracer. */
export function terrainRasterShader(trace: string): string {
  return `
${terrainHeightLibrary(trace, true, 1)}
const GRID_N = ${TERRAIN_CACHE_N}u;
struct U {
  origin: vec4f, reference: vec4f, figure: vec4f,
  right: vec4f, up: vec4f, forward: vec4f,
  image: vec4f, output: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> table: array<vec4f>;
@group(0) @binding(2) var distanceImage: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> referenceDepth: array<f32>;
struct Vertex { @builtin(position) clip: vec4f, @location(0) p: vec3f };

// A grid vertex's point, camera-relative on the Earth's axes [m]
fn terrainPoint(vertex: vec3f) -> vec3f {
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
  let cell = min(vec2u(floor(ij)), vec2u(GRID_N - 2u));
  let blend = ij - vec2f(cell);
  var heights: array<f32,4>;
  for (var j=0u; j<4u; j++) {
    let node = (cell.y + j / 2u) * GRID_N + cell.x + j % 2u;
    heights[j] = table[u32(u.origin.w) + node / 4u][node % 4u];
  }
  var h = mix(mix(heights[0], heights[1], blend.x), mix(heights[2], heights[3], blend.x), blend.y);
  let normal = vec3f(ca * cl, ca * sl, sa);
  // The exact grading and detail suppression, not a second approximation of runway flattening.
  if (runwayGrade(normal).x > 0.0) {
    h = earthHeightExactG(normal, vertex.z);
  }
  let delta = vec3f(x * u.reference.x - y * u.reference.y, x * u.reference.y + y * u.reference.x, z);
  return u.origin.xyz + delta + vec3f(ca * cl, ca * sl, sa) * h;
}
@vertex fn terrainVs(@location(0) vertex: vec3f) -> Vertex {
  let p = terrainPoint(vertex);
  var v: Vertex;
  v.p = vec3f(dot(p, u.right.xyz), dot(p, u.up.xyz), dot(p, u.forward.xyz));
  // Infinite reversed-Z, near plane in metres, WebGPU clip depth [0,1].
  // (the frame's sub-pixel jitter in NDC — output.zw, renderer.rasterJitter — the rays' own)
  v.clip = vec4f(v.p.x / u.right.w + u.output.z * v.p.z, v.p.y / u.up.w + u.output.w * v.p.z, u.forward.w, v.p.z);
  return v;
}
// The relief seen from the Sun (its shadow map — trace.wgsl sunShadowFar): an orthographic view along its direction,
// right and up over half-widths [m], the depth the distance towards the Sun over twice its half-range, nearer the Sun less
struct Sun { right: vec4f, up: vec4f, toward: vec4f };
@group(0) @binding(5) var<uniform> sun: Sun;
@vertex fn terrainSunVs(@location(0) vertex: vec3f) -> @builtin(position) vec4f {
  let p = terrainPoint(vertex);
  let z = clamp(0.5 - dot(p, sun.toward.xyz) / (2.0 * sun.toward.w), 0.0, 1.0);
  return vec4f(dot(p, sun.right.xyz) / sun.right.w, dot(p, sun.up.xyz) / sun.up.w, z, 1.0);
}
// (r: the ground's distance [m]; g: the scenery's instance drawn there — none here, the scenery's draw writes it alone, and
// its proxy's distance over b)
@fragment fn terrainFs(v: Vertex) -> @location(0) vec4f { let d = length(v.p); return vec4f(d, 0.0, d, 1.0); }

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
  private sunBind: GPUBindGroup | null = null;
  private sunHeightBind: GPUBindGroup | null = null;
  private sunSources: TerrainCacheSources | null = null;
  sunFrames = 0;

  constructor(
    private device: GPUDevice,
    trace: string,
  ) {
    this.module = device.createShaderModule({ code: terrainRasterShader(trace), label: "terrain raster pilot" });
    this.sunDepth = device.createTexture({
      label: "relief seen from the Sun",
      size: [TERRAIN_SUN_N, TERRAIN_SUN_N],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.sunUniform = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
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
      const mesh = terrainRasterMesh(window, level, runways);
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
   * The patch seen from the Sun, after this frame's visibility (its mesh and heights): `sun` its orthographic view —
   * right, up over their half-widths, the Sun's direction over the depth's half-range (vec4s; the Earth's axes, camera-
   * relative metres). False: not drawn (compiling, nothing drawn this frame) — the shadows then marched as before.
   */
  encodeSunShadow(
    enc: GPUCommandEncoder,
    sources: TerrainCacheSources,
    sun: Float32Array,
    profile: (label: string, descriptor: GPURenderPassDescriptor) => GPURenderPassDescriptor,
  ): boolean {
    if (!this.active || !this.sunPipe || !this.uniform || !this.table || this.disposed) return false;
    const old = this.sunSources;
    if (!this.sunBind || !old || !(Object.keys(sources) as (keyof TerrainCacheSources)[]).every((k) => old[k] === sources[k])) {
      this.sunBind = this.device.createBindGroup({
        layout: this.sunPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: { buffer: this.table } },
          { binding: 5, resource: { buffer: this.sunUniform } },
        ],
      });
      this.sunHeightBind = this.device.createBindGroup({
        layout: this.sunPipe.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: { buffer: sources.params } },
          { binding: 4, resource: sources.sampler },
          { binding: 21, resource: sources.elevation.createView() },
          { binding: 28, resource: sources.tiles.createView({ dimension: "2d-array" }) },
        ],
      });
      this.sunSources = sources;
    }
    this.device.queue.writeBuffer(this.sunUniform, 0, sun as Float32Array<ArrayBuffer>);
    const pass = enc.beginRenderPass(
      profile("terrain from the Sun", {
        colorAttachments: [],
        depthStencilAttachment: { view: this.sunDepth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
      }),
    );
    pass.setPipeline(this.sunPipe);
    pass.setBindGroup(0, this.sunBind);
    pass.setBindGroup(1, this.sunHeightBind!);
    pass.setIndexBuffer(this.index!, "uint32");
    pass.setVertexBuffer(0, this.vertex!);
    pass.drawIndexed(this.indexCount);
    pass.end();
    this.sunFrames++;
    return true;
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
      triangles: this.indexCount / 3,
      columns: this.columns,
      rows: this.rows,
      meshBuilds: this.meshBuilds,
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
    this.idle("disposed");
    this.uniform?.destroy();
    this.sunDepth.destroy();
    this.sunUniform.destroy();
    this.index?.destroy();
    this.vertex?.destroy();
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
