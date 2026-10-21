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
/** the trees' and buildings' shadow map: its texels a side, its half-extent [m] (~0.9 m a texel) — trace.wgsl treeShadowAt */
export const TREE_SHADOW_N = 2048;
export const TREE_SHADOW_HALF_M = 900;
/** the map's depth half-range along the Sun [m] (renderer.treeShadowFrame) */
export const TREE_SHADOW_DEPTH_M = 3000;

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
// the Sun's view for the trees' and buildings' shadow map (encodeShadow): right, up, towards the Sun in the scenery's frame —
// each w its half-extent [m] —, the map's centre (w: 1 drawn)
struct Sun { r: vec4f, u: vec4f, l: vec4f, c: vec4f };
@group(0) @binding(6) var<uniform> sun: Sun;
@group(0) @binding(2) var<storage, read> scenery: array<vec4f>;
fn forestData(i: u32) -> vec4f { return scenery[i]; }
${forest}
const CAP = ${SCENERY_RASTER_CAP}u;
struct Draw { vertices: u32, instances: atomic<u32>, first: u32, base: u32 };
// (the four lists' draws, then the buildings' boxes': one a node of the scenery's BVH)
@group(0) @binding(3) var<storage, read_write> draws: array<Draw, ${LISTS + 3}>;
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
  // (the trees within the shadow map's reach — in view or not: one behind the camera shades the ground before it —: its two
  // lists, a round crown's or a cone's)
  if (sun.c.w > 0.5) {
    let q = centre - sun.c.xyz;
    if (abs(dot(q, sun.r.xyz)) < sun.r.w + R && abs(dot(q, sun.u.xyz)) < sun.u.w + R) {
      let ls = ${LISTS + 1}u + select(0u, 1u, t.cone);
      let at = atomicAdd(&draws[ls].instances, 1u);
      if (at < CAP) { listsOut[ls * CAP + at] = k; }
    }
  }
  let v = view(centre);
  // (the field of view's four sides, each with the sphere's radius across it)
  let tx = u.right.w; let ty = u.up.w;
  if (v.z < -R) { return; }
  if (abs(v.x) - tx * v.z > R * sqrt(1.0 + tx * tx)) { return; }
  if (abs(v.y) - ty * v.z > R * sqrt(1.0 + ty * ty)) { return; }
  // (a tree under ~1.2 px of radius — sc.east.w — not drawn: no shape at that size, the forest's colour the ground's imagery
  // there; hundreds of thousands of micro-triangles, stacked deep at a grazing view, were most of the pass)
  if (R / max(v.z, 1.0) / ty * (0.5 * u.image.y) < sc.east.w) { return; }
  let list = select(0u, 1u, t.cone) + select(2u, 0u, length(v) < sc.cam.w);
  let at = atomicAdd(&draws[list].instances, 1u);
  if (at < CAP) { listsOut[list * CAP + at] = k; }
}
// the counts kept within the lists' room (the draws read them as they are)
@compute @workgroup_size(${LISTS})
fn clampDraws(@builtin(local_invocation_index) i: u32) {
  atomicStore(&draws[i].instances, min(atomicLoad(&draws[i].instances), CAP));
  if (i == 0u) {
    atomicStore(&draws[${LISTS}].instances, u32(scenery[0].x));
    atomicStore(&draws[${LISTS + 1}].instances, min(atomicLoad(&draws[${LISTS + 1}].instances), CAP));
    atomicStore(&draws[${LISTS + 2}].instances, min(atomicLoad(&draws[${LISTS + 2}].instances), CAP));
  }
}

override LIST: u32 = 0u;
struct V { @builtin(position) clip: vec4f, @location(0) @interpolate(flat) id: f32, @location(1) p: vec3f };
// a proxy's corner m (its part in w) about tree t, in the scenery's frame; w 1: none (a part this tree has not)
fn proxyPoint(m: vec4f, t: Tree) -> vec4f {
  let part = u32(m.w);
  var p: vec3f;
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
  return vec4f(p, select(0.0, 1.0, none));
}
// a scenery-frame point in the Sun's view: x right, y up over their half-extents, depth towards the Sun over twice its
// (nearer the Sun less)
fn sunClip(p: vec3f) -> vec4f {
  let q = p - sun.c.xyz;
  return vec4f(dot(q, sun.r.xyz) / sun.r.w, dot(q, sun.u.xyz) / sun.u.w, clamp(0.5 - dot(q, sun.l.xyz) / (2.0 * sun.l.w), 0.0, 1.0), 1.0);
}
// The trees' proxies from the Sun (their shadow map): the same shapes, the shadow lists
@vertex fn shadowVs(@location(0) m: vec4f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let k = listsIn[LIST * CAP + ii];
  let p = proxyPoint(m, treeOf(k, forestHead(u32(forestData(2u).x))));
  return select(sunClip(p.xyz), vec4f(2.0, 2.0, 0.5, 1.0), p.w > 0.5);
}
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

// The buildings' boxes (a node of the scenery's BVH an instance: its leaves — a building each — drawn, its inner nodes at one
// point): where one is before the ground and the trees, the pixel's alpha 2 — the tracer's kernel shade tests the buildings
// there alone (trace.wgsl worldScenery), not along every camera ray. Depth tested, not written; a box a little wider.
const BOX = array<u32, 36>(0u, 1u, 3u, 0u, 3u, 2u, 4u, 6u, 7u, 4u, 7u, 5u, 0u, 4u, 5u, 0u, 5u, 1u, 2u, 3u, 7u, 2u, 7u, 6u,
  0u, 2u, 6u, 0u, 6u, 4u, 1u, 5u, 7u, 1u, 7u, 3u);
@vertex fn boxVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let lo = scenery[4u + ii * 2u];
  let hi = scenery[5u + ii * 2u];
  if (hi.w < 0.0) { return vec4f(2.0, 2.0, 0.5, 1.0); }
  let c = BOX[vi];
  let k = vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u));
  let v = view(mix(lo.xyz - vec3f(0.5), hi.xyz + vec3f(0.5), k));
  return vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
}
@fragment fn boxFs() -> @location(0) vec4f { return vec4f(0.0, 0.0, 0.0, 2.0); }
// the buildings' boxes from the Sun (the shadow map)
@vertex fn boxShadowVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let lo = scenery[4u + ii * 2u];
  let hi = scenery[5u + ii * 2u];
  if (hi.w < 0.0) { return vec4f(2.0, 2.0, 0.5, 1.0); }
  let c = BOX[vi];
  let k = vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u));
  return sunClip(mix(lo.xyz, hi.xyz, k));
}
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
  private boxPipe: GPURenderPipeline | null = null;
  private shadowPipes: (GPURenderPipeline | null)[] = [null, null];
  private boxShadowPipe: GPURenderPipeline | null = null;
  private sunU: GPUBuffer;
  private sunOn = false;
  private meshes: GPUBuffer[] = [];
  private meshCounts: number[] = [];
  private frameU: GPUBuffer;
  private sceneryU: GPUBuffer;
  private draws: GPUBuffer;
  private lists: GPUBuffer;
  private reset = new Uint32Array((LISTS + 3) * 4);
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
    /** the trees' and buildings' shadow map it draws (the renderer's: bound to the tracer from the start — encodeShadow) */
    private shadowMap: GPUTexture | null = null,
  ) {
    this.module = device.createShaderModule({ label: "scenery raster", code: sceneryRasterShader(forestModuleOf(traceSource)) });
    const S = GPUBufferUsage.STORAGE;
    this.frameU = device.createBuffer({ size: TERRAIN_RASTER_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sceneryU = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.draws = device.createBuffer({
      size: (LISTS + 3) * 16,
      usage: S | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      label: "scenery raster draws",
    });
    this.lists = device.createBuffer({ size: (LISTS + 2) * SCENERY_RASTER_CAP * 4, usage: S, label: "scenery raster instances" });
    this.sunU = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

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
        { binding: 6, visibility: C, buffer: { type: "uniform" } },
      ],
    });
    this.drawLayout = device.createBindGroupLayout({
      label: "scenery raster draws",
      entries: [
        { binding: 0, visibility: Vx, buffer: { type: "uniform" } },
        { binding: 1, visibility: Vx, buffer: { type: "uniform" } },
        { binding: 2, visibility: Vx, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: Vx, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: Vx, buffer: { type: "uniform" } },
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
    // (the buildings' boxes: the alpha alone, depth tested — before the ground and the trees —, not written)
    void device
      .createRenderPipelineAsync({
        layout: drawPipeLayout,
        vertex: { module: this.module, entryPoint: "boxVs" },
        fragment: {
          module: this.module,
          entryPoint: "boxFs",
          targets: [{ format: TERRAIN_RASTER_FORMAT, writeMask: GPUColorWrite.ALPHA }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" },
      })
      .then((p) => (this.boxPipe = p), fail);
    // (the shadow map: the trees' near proxies — their trunks too — and the buildings' boxes, depth only)
    const depthOnly = { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" } as const;
    for (let l = 0; l < 2; l++)
      void device
        .createRenderPipelineAsync({
          layout: drawPipeLayout,
          vertex: {
            module: this.module,
            entryPoint: "shadowVs",
            constants: { LIST: LISTS + 1 + l },
            buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }] }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          depthStencil: depthOnly,
        })
        .then((p) => (this.shadowPipes[l] = p), fail);
    void device
      .createRenderPipelineAsync({
        layout: drawPipeLayout,
        vertex: { module: this.module, entryPoint: "boxShadowVs" },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: depthOnly,
      })
      .then((p) => (this.boxShadowPipe = p), fail);
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
    this.reset[LISTS * 4] = 36;
    // (the shadow lists: the far round crown's and the far cone's meshes — an octahedron, a plain cone: the map's texels ~0.9 m,
    // a near proxy's 80 faces and trunk ten times the triangles for a shadow it cannot resolve)
    this.reset[(LISTS + 1) * 4] = this.meshCounts[2]!;
    this.reset[(LISTS + 2) * 4] = this.meshCounts[3]!;
    this.lod = { ...lod };
  }
  getLod(): SceneryRasterLod {
    return { ...this.lod };
  }

  get ready() {
    return !this.error && !!this.cullPipe && !!this.clampPipe && !!this.boxPipe && this.drawPipes.every((p) => !!p);
  }
  /** the shadow map's pipelines compiled */
  get shadowReady() {
    return this.ready && !!this.boxShadowPipe && this.shadowPipes.every((p) => !!p);
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
    sun: Float32Array | null = null,
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
          { binding: 6, resource: { buffer: this.sunU } },
        ],
      });
      this.drawBind = this.device.createBindGroup({
        layout: this.drawLayout,
        entries: [
          { binding: 0, resource: { buffer: this.frameU } },
          { binding: 1, resource: { buffer: this.sceneryU } },
          { binding: 2, resource: { buffer } },
          { binding: 5, resource: { buffer: this.lists } },
          { binding: 6, resource: { buffer: this.sunU } },
        ],
      });
    }
    const q = this.device.queue;
    q.writeBuffer(this.frameU, 0, frame as Float32Array<ArrayBuffer>);
    this.sceneryOut.set(scenery.subarray(0, 16));
    this.sceneryOut[15] = this.lod.nearM;
    // (east.w: the least projected radius drawn [px] — the raster's own copy of P.scenery, that w unread here)
    this.sceneryOut[3] = this.minPx;
    q.writeBuffer(this.sceneryU, 0, this.sceneryOut);
    q.writeBuffer(this.draws, 0, this.reset);
    // (the Sun's view: its trees culled into the shadow lists when it is to be drawn — encodeShadow —; else none)
    this.sunOn = !!sun && sun[15]! > 0.5 && this.shadowReady;
    if (sun) q.writeBuffer(this.sunU, 0, (this.sunOn ? sun : new Float32Array(16)) as Float32Array<ArrayBuffer>);
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

  /** the least projected radius of a tree drawn [px] (renderer.treeMinPx) */
  minPx = 1.2;
  /** parts left out of the visibility pass, to measure them (1 the trees, 2 the buildings' boxes) — the image then wrong */
  debugSkip = 0;
  /** The culled trees' proxies, in the terrain raster's pass (after the ground: its depth already there). */
  draw(pass: GPURenderPassEncoder) {
    if (!this.active || !this.drawBind) return;
    for (let l = 0; l < LISTS; l++) {
      if (this.debugSkip & 1) break;
      pass.setPipeline(this.drawPipes[l]!);
      pass.setBindGroup(0, this.drawBind);
      pass.setVertexBuffer(0, this.meshes[l]!);
      pass.drawIndirect(this.draws, l * 16);
    }
    if (this.debugSkip & 2) return;
    pass.setPipeline(this.boxPipe!);
    pass.setBindGroup(0, this.drawBind);
    pass.drawIndirect(this.draws, LISTS * 16);
  }

  /** The trees' and buildings' shadow map, seen from the Sun (after encodeCull, which culled its lists): false when not drawn. */
  encodeShadow(enc: GPUCommandEncoder, descriptor: GPURenderPassDescriptor["timestampWrites"]): boolean {
    if (!this.active || !this.sunOn || !this.drawBind || !this.shadowMap) return false;
    const pass = enc.beginRenderPass({
      label: "trees' shadow map",
      colorAttachments: [],
      depthStencilAttachment: { view: this.shadowMap.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
      ...(descriptor ? { timestampWrites: descriptor } : {}),
    });
    for (let l = 0; l < 2; l++) {
      pass.setPipeline(this.shadowPipes[l]!);
      pass.setBindGroup(0, this.drawBind);
      pass.setVertexBuffer(0, this.meshes[2 + l]!);
      pass.drawIndirect(this.draws, (LISTS + 1 + l) * 16);
    }
    pass.setPipeline(this.boxShadowPipe!);
    pass.setBindGroup(0, this.drawBind);
    pass.drawIndirect(this.draws, LISTS * 16);
    pass.end();
    return true;
  }

  stats() {
    return { ready: this.ready, error: this.error, active: this.active, encodedFrames: this.encodedFrames, cells: this.cells };
  }

  dispose() {
    for (const b of [this.frameU, this.sceneryU, this.draws, this.lists, this.sunU, ...this.meshes]) b.destroy();
  }
}
