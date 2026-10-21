// The world's trees drawn as raster instances (docs/PLAN-RENDU-RASTER-AAA.md étape 1b): not their look — the instance
// only says which tree a pixel sees, and the tracer's kernel shade tests that tree alone, exactly, with the forest's own
// shapes (trace.wgsl worldScenery: forestCandidate) instead of walking the grid of cells along every camera ray.
//
// A compute pass reads the forest's section of the scenery buffer (forest.wgsl: the cells' words, the hashes), rebuilds
// each tree's crown and trunk as forestCandidate has them, keeps those in the field of view and sorts them into four
// lists: near or far (NEAR_M), a round crown (an ellipsoid) or a conifer's (a cone). Four indirect draws then put a
// proxy round each — wider than the shape it stands for, never narrower (a polyhedron circumscribed: a proxy too wide
// costs a missed exact test, never a lost tree) — in the terrain raster's pass, against its depth, their id in the
// visibility target's g (the cell + 1, exact in a float below 2²⁴), the proxy's distance in its b.

import { TERRAIN_RASTER_FORMAT } from "./terrain-raster";
import { TERRAIN_RASTER_UNIFORM_BYTES } from "./terrain-raster-frame";

/** The proxies' detail: trees nearer than `nearM` [m] get the near ones (with their trunk), the rest the far ones — a
 *  round crown's icosahedron of 80 or 20 faces, or an octahedron of 8. Measured (Tarifa, the scenery high and very far,
 *  docs/progress/raster-aaa/ETAPE-1.md): the far octahedra halve the visibility pass (8.4 → 4.6 ms) for 1.2 ms more
 *  of exact tests missed in shade, the image alike; a quad turned to the camera was worse on both counts. */
export interface SceneryRasterLod {
  nearM: number;
  near: "ico80" | "ico20";
  far: "ico20" | "octa";
}
export const SCENERY_RASTER_LOD: SceneryRasterLod = { nearM: 300, near: "ico80", far: "octa" };
/** Instances a list holds at most (four lists, 4 bytes each: 16 MiB). */
export const SCENERY_RASTER_CAP = 1 << 20;
const LISTS = 4;

// ---- the proxies (unit shapes; xyz and the part in w: 0 a round crown, 1 a cone, 2 the trunk)

type Tri = [number, number, number][];
/** an icosahedron (subdivided `levels` times), circumscribed about the unit sphere: every face outside it */
function icosphere(levels: number): Tri {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: [number, number, number][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  let f = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const norm = (p: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(...p);
    return [p[0] / l, p[1] / l, p[2] / l];
  };
  v = v.map(norm);
  for (let l = 0; l < levels; l++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = mid.get(key);
      if (i === undefined) {
        const p = v[a]!,
          q = v[b]!;
        i = v.push(norm([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2])) - 1;
        mid.set(key, i);
      }
      return i;
    };
    const g: number[][] = [];
    for (const [a, b, c] of f) {
      const ab = m(a!, b!),
        bc = m(b!, c!),
        ca = m(c!, a!);
      g.push([a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]);
    }
    f = g;
  }
  // (the vertices on the sphere, the faces inside it: scaled by the nearest face's distance from the centre)
  let inr = 1;
  for (const [a, b, c] of f) {
    const p = v[a!]!,
      q = v[b!]!,
      r = v[c!]!;
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]],
      w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
    const ln = Math.hypot(...n);
    inr = Math.min(inr, Math.abs(n[0]! * p[0] + n[1]! * p[1] + n[2]! * p[2]) / ln);
  }
  const k = 1.02 / inr;
  return f.flatMap((tri) => tri.map((i) => [v[i]![0] * k, v[i]![1] * k, v[i]![2] * k] as [number, number, number]));
}
/** an octahedron circumscribed about the unit sphere (its faces √3 × nearer than its corners) */
function octahedron(): Tri {
  const a = Math.sqrt(3) * 1.02;
  const P: [number, number, number][] = [
    [a, 0, 0],
    [-a, 0, 0],
    [0, a, 0],
    [0, -a, 0],
    [0, 0, a],
    [0, 0, -a],
  ];
  const f = [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ];
  return f.flatMap((t) => t.map((i) => P[i]!));
}
/** an n-sided pyramid circumscribed about the unit cone (apex at 0, base disc of radius 1 at z = −1), with its base */
function pyramid(n: number): Tri {
  const k = 1.02 / Math.cos(Math.PI / n);
  const ring = (i: number): [number, number, number] => [k * Math.cos((2 * Math.PI * i) / n), k * Math.sin((2 * Math.PI * i) / n), -1.02];
  const out: Tri = [];
  for (let i = 0; i < n; i++) out.push([0, 0, 0.02], ring(i), ring(i + 1), [0, 0, -1.02], ring(i + 1), ring(i));
  return out;
}
/** an n-sided prism circumscribed about the unit cylinder (radius 1, z 0 … 1), capped */
function prism(n: number): Tri {
  const k = 1.02 / Math.cos(Math.PI / n);
  const at = (i: number, z: number): [number, number, number] => [
    k * Math.cos((2 * Math.PI * i) / n),
    k * Math.sin((2 * Math.PI * i) / n),
    z,
  ];
  const out: Tri = [];
  for (let i = 0; i < n; i++) {
    out.push(at(i, 0), at(i + 1, 0), at(i + 1, 1), at(i, 0), at(i + 1, 1), at(i, 1));
    out.push([0, 0, 1], at(i, 1), at(i + 1, 1), [0, 0, 0], at(i + 1, 0), at(i, 0));
  }
  return out;
}
function pack(parts: [Tri, number][]): Float32Array<ArrayBuffer> {
  const n = parts.reduce((s, [t]) => s + t.length, 0);
  const a = new Float32Array(n * 4);
  let o = 0;
  for (const [t, part] of parts)
    for (const p of t) {
      a.set([p[0], p[1], p[2], part], o);
      o += 4;
    }
  return a;
}
/** the four lists' proxies: near round (+ trunk), near cone (+ trunk), far round, far cone — at the detail asked */
export function sceneryRasterMeshes(lod: SceneryRasterLod = SCENERY_RASTER_LOD): Float32Array<ArrayBuffer>[] {
  const nearRound = lod.near === "ico80" ? icosphere(1) : icosphere(0);
  const farRound = lod.far === "ico20" ? icosphere(0) : octahedron();
  return [
    pack([
      [nearRound, 0],
      [prism(6), 2],
    ]),
    pack([
      [pyramid(lod.near === "ico80" ? 12 : 6), 1],
      [prism(6), 2],
    ]),
    pack([[farRound, 0]]),
    pack([[pyramid(lod.far === "ico20" ? 6 : 4), 1]]),
  ];
}

export function sceneryRasterShader(forest: string): string {
  return `
struct U {
  origin: vec4f, reference: vec4f, figure: vec4f,
  right: vec4f, up: vec4f, forward: vec4f,
  image: vec4f, output: vec4f,
};
@group(0) @binding(0) var<uniform> u: U;
// the scenery's frame (P.scenery): its east, north, up axes on the Earth's, the camera in it [m] (w: the near proxies' reach [m])
struct S { east: vec4f, north: vec4f, up: vec4f, cam: vec4f };
@group(0) @binding(1) var<uniform> sc: S;
@group(0) @binding(2) var<storage, read> scenery: array<vec4f>;
fn forestData(i: u32) -> vec4f { return scenery[i]; }
${forest}
const CAP = ${SCENERY_RASTER_CAP}u;
struct Draw { vertices: u32, instances: atomic<u32>, first: u32, base: u32 };
@group(0) @binding(3) var<storage, read_write> draws: array<Draw, ${LISTS}>;
@group(0) @binding(4) var<storage, read_write> listsOut: array<u32>;
@group(0) @binding(5) var<storage, read> listsIn: array<u32>;

// A cell's tree as forestCandidate shapes it, its plain crown unshrunk (the carving, the twigs, a far crown's shrinking
// all lie within it); none where the cell has no tree.
struct Tree { ok: bool, kind: u32, foot: vec3f, cone: bool, c: vec3f, r: vec3f, trunk: bool, trunkR: f32, trunkTop: f32 };
fn treeOf(k: u32, hd: ForestHead) -> Tree {
  var o: Tree;
  o.ok = false;
  let i = i32(k) % hd.w; let j = i32(k) / hd.w;
  let word = bitcast<u32>(forestData(hd.cellsAt + k / 4u)[k % 4u]);
  let kind = (word >> 22u) & 15u;
  if (kind == 0u) { return o; }
  let z = f32(word & 0x3fffffu) / 100.0 - 20000.0;
  let height = 2.0 + f32(word >> 26u) * 0.5;
  let gi = u32(((hd.i0 + i) % hd.columns + hd.columns) % hd.columns); let gj = bitcast<u32>(hd.j0 + j);
  let uu = f32(i) + 0.12 + 0.76 * forestUnit(forestHash(gi, gj, 1u));
  let vv = f32(j) + 0.12 + 0.76 * forestUnit(forestHash(gi, gj, 2u));
  let r = hd.cell * (0.3 + 0.17 * forestUnit(forestHash(gi, gj, 3u)));
  o.foot = vec3f(hd.C.x + hd.C.y * uu + hd.C.z * vv, hd.Dm.x + hd.Dm.y * uu + hd.Dm.z * vv, z);
  let kA = forestData(hd.F + 7u + 4u * kind); let kB = forestData(hd.F + 8u + 4u * kind); let kD = forestData(hd.F + 10u + 4u * kind);
  o.kind = kind;
  o.cone = kA.x > 0.5;
  if (o.cone) {
    o.c = o.foot + vec3f(0.0, 0.0, height);
    o.r = vec3f(kA.z * r, height * (1.0 - kA.y), 0.0);
  } else {
    o.c = o.foot + vec3f(0.0, 0.0, kA.y * height);
    o.r = vec3f(kA.z * r, kA.z * r, kA.w * height);
  }
  let bare = kD.w * forestData(hd.F + 7u).z;
  o.trunk = kB.x > 0.0;
  o.trunkR = kB.y + kB.z * height;
  o.trunkTop = z + mix(kB.x, 0.8, bare) * height;
  o.ok = true;
  return o;
}
// a scenery-frame point, camera-relative on the raster's axes (right, up, forward)
fn view(p: vec3f) -> vec3f {
  let rel = p - sc.cam.xyz;
  let e = sc.east.xyz * rel.x + sc.north.xyz * rel.y + sc.up.xyz * rel.z;
  return vec3f(dot(e, u.right.xyz), dot(e, u.up.xyz), dot(e, u.forward.xyz));
}

@compute @workgroup_size(64)
fn cull(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let F = u32(forestData(2u).x);
  if (F == 0u) { return; }
  let hd = forestHead(F);
  let k = g.y * n.x * 64u + g.x;
  if (k >= u32(hd.w * hd.h)) { return; }
  let t = treeOf(k, hd);
  if (!t.ok) { return; }
  // (the tree's bounding sphere: from its trunk's foot, sunk a metre, to its crown's top)
  let top = select(t.c.z + t.r.z, t.c.z, t.cone);
  let lo = t.foot.z - 1.0;
  let centre = vec3f(t.foot.xy, 0.5 * (lo + top));
  let R = length(vec2f(max(t.r.x, t.trunkR) * 1.5, 0.5 * (top - lo))) + 0.5;
  let v = view(centre);
  // (the field of view's four sides, each with the sphere's radius across it)
  let tx = u.right.w; let ty = u.up.w;
  if (v.z < -R) { return; }
  if (abs(v.x) - tx * v.z > R * sqrt(1.0 + tx * tx)) { return; }
  if (abs(v.y) - ty * v.z > R * sqrt(1.0 + ty * ty)) { return; }
  let list = select(0u, 1u, t.cone) + select(2u, 0u, length(v) < sc.cam.w);
  let at = atomicAdd(&draws[list].instances, 1u);
  if (at < CAP) { listsOut[list * CAP + at] = k; }
}
// the counts kept within the lists' room (the draws read them as they are)
@compute @workgroup_size(${LISTS})
fn clampDraws(@builtin(local_invocation_index) i: u32) {
  atomicStore(&draws[i].instances, min(atomicLoad(&draws[i].instances), CAP));
}

override LIST: u32 = 0u;
struct V { @builtin(position) clip: vec4f, @location(0) @interpolate(flat) id: f32, @location(1) p: vec3f };
@vertex fn proxyVs(@location(0) m: vec4f, @builtin(instance_index) ii: u32) -> V {
  var o: V;
  let k = listsIn[LIST * CAP + ii];
  let hd = forestHead(u32(forestData(2u).x));
  let t = treeOf(k, hd);
  let part = u32(m.w);
  var p: vec3f;
  // (a part this tree has not — a cone's list draws no round crown, a shrub no trunk —: every corner at one point)
  var none = !t.ok;
  if (part == 0u) {
    none = none || t.cone;
    p = t.c + m.xyz * t.r;
  } else if (part == 1u) {
    none = none || !t.cone;
    p = t.c + vec3f(m.xy * t.r.x, m.z * t.r.y);
  } else {
    none = none || !t.trunk;
    let lo = t.foot.z - 1.0;
    p = vec3f(t.foot.xy + m.xy * t.trunkR, lo + m.z * (t.trunkTop - lo));
  }
  let v = view(p);
  // (the terrain's projection: infinite reversed-Z, its near plane)
  o.clip = select(vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z), vec4f(2.0, 2.0, 0.5, 1.0), none);
  o.id = f32(k + 1u);
  o.p = v;
  return o;
}
// (g the tree's id, b its proxy's distance — the ground's in r stays)
@fragment fn proxyFs(v: V) -> @location(0) vec4f { return vec4f(0.0, v.id, length(v.p), 0.0); }
`;
}

/** the forest's module out of the tracer's source, set in already (forest-shader.ts withForest's markers) */
export function forestModuleOf(traceSource: string): string {
  const m = /\/\/ ---- forest\.wgsl\n([\s\S]*?)\n\/\/ ---- end of forest\.wgsl/.exec(traceSource);
  if (!m) throw new Error("scenery-raster: the tracer's source has no forest module");
  return m[1]!;
}

export class SceneryRaster {
  private module: GPUShaderModule;
  private cullPipe: GPUComputePipeline | null = null;
  private clampPipe: GPUComputePipeline | null = null;
  private drawPipes: (GPURenderPipeline | null)[] = [null, null, null, null];
  private meshes: GPUBuffer[] = [];
  private meshCounts: number[] = [];
  private frameU: GPUBuffer;
  private sceneryU: GPUBuffer;
  private draws: GPUBuffer;
  private lists: GPUBuffer;
  private reset = new Uint32Array(LISTS * 4);
  private sceneryBuf: GPUBuffer | null = null;
  private cullLayout: GPUBindGroupLayout;
  private drawLayout: GPUBindGroupLayout;
  private cullBind: GPUBindGroup | null = null;
  private drawBind: GPUBindGroup | null = null;
  private cells = 0;
  error: string | null = null;
  /** the last frame culled and drew the trees */
  active = false;
  encodedFrames = 0;

  constructor(
    private device: GPUDevice,
    traceSource: string,
  ) {
    this.module = device.createShaderModule({ label: "scenery raster", code: sceneryRasterShader(forestModuleOf(traceSource)) });
    const S = GPUBufferUsage.STORAGE;
    this.frameU = device.createBuffer({ size: TERRAIN_RASTER_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sceneryU = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.draws = device.createBuffer({
      size: LISTS * 16,
      usage: S | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      label: "scenery raster draws",
    });
    this.lists = device.createBuffer({ size: LISTS * SCENERY_RASTER_CAP * 4, usage: S, label: "scenery raster instances" });
    this.setLod(SCENERY_RASTER_LOD);
    const fail = (e: unknown) => (this.error ??= String(e));
    // (one layout for the two compute entries, one for the four draws: a bind group made on a pipeline's "auto" layout is
    // that pipeline's alone — the others' submissions failed whole, the frame black)
    const C = GPUShaderStage.COMPUTE,
      Vx = GPUShaderStage.VERTEX;
    this.cullLayout = device.createBindGroupLayout({
      label: "scenery raster cull",
      entries: [
        { binding: 0, visibility: C, buffer: { type: "uniform" } },
        { binding: 1, visibility: C, buffer: { type: "uniform" } },
        { binding: 2, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: C, buffer: { type: "storage" } },
        { binding: 4, visibility: C, buffer: { type: "storage" } },
      ],
    });
    this.drawLayout = device.createBindGroupLayout({
      label: "scenery raster draws",
      entries: [
        { binding: 0, visibility: Vx, buffer: { type: "uniform" } },
        { binding: 1, visibility: Vx, buffer: { type: "uniform" } },
        { binding: 2, visibility: Vx, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: Vx, buffer: { type: "read-only-storage" } },
      ],
    });
    const cullPipeLayout = device.createPipelineLayout({ bindGroupLayouts: [this.cullLayout] });
    const drawPipeLayout = device.createPipelineLayout({ bindGroupLayouts: [this.drawLayout] });
    void device
      .createComputePipelineAsync({ layout: cullPipeLayout, compute: { module: this.module, entryPoint: "cull" } })
      .then((p) => (this.cullPipe = p), fail);
    void device
      .createComputePipelineAsync({ layout: cullPipeLayout, compute: { module: this.module, entryPoint: "clampDraws" } })
      .then((p) => (this.clampPipe = p), fail);
    for (let l = 0; l < LISTS; l++)
      void device
        .createRenderPipelineAsync({
          layout: drawPipeLayout,
          vertex: {
            module: this.module,
            entryPoint: "proxyVs",
            constants: { LIST: l },
            buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] }],
          },
          // (the ground's distance in r stays the terrain's: the instance writes its id alone)
          fragment: {
            module: this.module,
            entryPoint: "proxyFs",
            targets: [{ format: TERRAIN_RASTER_FORMAT, writeMask: GPUColorWrite.GREEN | GPUColorWrite.BLUE }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
        })
        .then((p) => (this.drawPipes[l] = p), fail);
  }

  private lod: SceneryRasterLod = SCENERY_RASTER_LOD;
  private sceneryOut = new Float32Array(16);
  /** the proxies' detail (a switch for comparisons — renderer.sceneryRasterLod) */
  setLod(lod: SceneryRasterLod) {
    for (const b of this.meshes) b.destroy();
    this.meshes = [];
    this.meshCounts = [];
    for (const m of sceneryRasterMeshes(lod)) {
      const b = this.device.createBuffer({ size: m.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(b, 0, m);
      this.meshes.push(b);
      this.meshCounts.push(m.length / 4);
    }
    for (let l = 0; l < LISTS; l++) this.reset[l * 4] = this.meshCounts[l]!;
    this.lod = { ...lod };
  }
  getLod(): SceneryRasterLod {
    return { ...this.lod };
  }

  get ready() {
    return !this.error && !!this.cullPipe && !!this.clampPipe && this.drawPipes.every((p) => !!p);
  }

  /**
   * The trees culled for this frame, before the terrain's pass: `frame` the terrain raster's uniform (its camera and
   * projection), `scenery` P.scenery's first four vec4s (the frame's axes, the camera in it), `buffer` the scenery's.
   * False: nothing to draw (compiling, no forest) — the tracer then walks its grid as before.
   */
  encodeCull(
    enc: GPUCommandEncoder,
    descriptor: GPUComputePassDescriptor,
    frame: Float32Array,
    scenery: Float32Array,
    buffer: GPUBuffer,
    forestCells: number,
  ): boolean {
    this.active = false;
    if (!this.ready || forestCells <= 0) return false;
    if (buffer !== this.sceneryBuf) {
      this.sceneryBuf = buffer;
      this.cullBind = this.device.createBindGroup({
        layout: this.cullLayout,
        entries: [
          { binding: 0, resource: { buffer: this.frameU } },
          { binding: 1, resource: { buffer: this.sceneryU } },
          { binding: 2, resource: { buffer } },
          { binding: 3, resource: { buffer: this.draws } },
          { binding: 4, resource: { buffer: this.lists } },
        ],
      });
      this.drawBind = this.device.createBindGroup({
        layout: this.drawLayout,
        entries: [
          { binding: 0, resource: { buffer: this.frameU } },
          { binding: 1, resource: { buffer: this.sceneryU } },
          { binding: 2, resource: { buffer } },
          { binding: 5, resource: { buffer: this.lists } },
        ],
      });
    }
    const q = this.device.queue;
    q.writeBuffer(this.frameU, 0, frame as Float32Array<ArrayBuffer>);
    this.sceneryOut.set(scenery.subarray(0, 16));
    this.sceneryOut[15] = this.lod.nearM;
    q.writeBuffer(this.sceneryU, 0, this.sceneryOut);
    q.writeBuffer(this.draws, 0, this.reset);
    const groups = Math.ceil(forestCells / 64);
    const gx = Math.min(groups, 65535);
    const pass = enc.beginComputePass(descriptor);
    pass.setPipeline(this.cullPipe!);
    pass.setBindGroup(0, this.cullBind!);
    pass.dispatchWorkgroups(gx, Math.ceil(groups / gx));
    pass.setPipeline(this.clampPipe!);
    pass.dispatchWorkgroups(1);
    pass.end();
    this.cells = forestCells;
    this.active = true;
    this.encodedFrames++;
    return true;
  }

  /** The culled trees' proxies, in the terrain raster's pass (after the ground: its depth already there). */
  draw(pass: GPURenderPassEncoder) {
    if (!this.active || !this.drawBind) return;
    for (let l = 0; l < LISTS; l++) {
      pass.setPipeline(this.drawPipes[l]!);
      pass.setBindGroup(0, this.drawBind);
      pass.setVertexBuffer(0, this.meshes[l]!);
      pass.drawIndirect(this.draws, l * 16);
    }
  }

  stats() {
    return { ready: this.ready, error: this.error, active: this.active, encodedFrames: this.encodedFrames, cells: this.cells };
  }

  dispose() {
    for (const b of [this.frameU, this.sceneryU, this.draws, this.lists, ...this.meshes]) b.destroy();
  }
}
