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

import { CABLE_WIDTH_M } from "./pylons";
import { LAMP_POLE_M } from "./streetlamps";
import { TURBINE_FACING } from "./turbines";
import { NO_MOTION, TERRAIN_RASTER_FORMAT, TERRAIN_RASTER_MOTION_FORMAT } from "./terrain-raster";
import { TERRAIN_RASTER_UNIFORM_BYTES } from "./terrain-raster-frame";
import { RASTER_CODE, RASTER_CODE_SCALE } from "./terrain-raster-hint";

/** The proxies' detail: trees nearer than `nearM` [m] get the near ones (with their trunk), the rest the far ones — a
 *  round crown's icosahedron of 80 or 20 faces, or an octahedron of 8. Measured (Tarifa, the scenery high and very far,
 *  docs/progress/raster-aaa/ETAPE-1.md): the far octahedra halve the visibility pass (8.4 → 4.6 ms) for 1.2 ms more
 *  of exact tests missed in shade, the image alike; a quad turned to the camera was worse on both counts. */
export interface SceneryRasterLod {
  nearM: number;
  near: "ico320" | "ico80" | "ico20";
  far: "ico20" | "octa";
}
// (near, a round crown's 320 faces: the 80's corners 9 % out from it — a ring of what the proxy hides behind it, the next trees
// gone from it, round each crown a few metres wide up to 200 m —, the 320's 2 %)
export const SCENERY_RASTER_LOD: SceneryRasterLod = { nearM: 300, near: "ico320", far: "octa" };
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
  const nearRound = lod.near === "ico320" ? icosphere(2) : lod.near === "ico80" ? icosphere(1) : icosphere(0);
  const farRound = lod.far === "ico20" ? icosphere(0) : octahedron();
  return [
    pack([
      [nearRound, 0],
      [prism(6), 2],
    ]),
    pack([
      [pyramid(lod.near === "ico20" ? 6 : 12), 1],
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
// (lift — R4b, contract C0-3 —: the air's lift of a point at a distance d [m] from the camera, (x + y d) d² fitted to the tracer's
// table over 4–60 km — renderer.ts sceneryLift —, z the fade's angle [rad], w 1 on)
// (pcam, pr, pu, pf: the frame before's camera — its place on the scenery's local axes, the clock then (w); its axes and fields
// (w: tan of the half fields, pf.w 1 when valid) — for the moving meshes' motion, PLAN-J1 J1-2)
struct S { east: vec4f, north: vec4f, up: vec4f, cam: vec4f, lift: vec4f, misc: vec4f, pcam: vec4f, pr: vec4f, pu: vec4f, pf: vec4f };
@group(0) @binding(1) var<uniform> sc: S;
// the Sun's view for the trees' and buildings' shadow map (encodeShadow): right, up, towards the Sun in the scenery's frame —
// each w its half-extent [m] —, the map's centre (w: 1 drawn)
struct Sun { r: vec4f, u: vec4f, l: vec4f, c: vec4f };
@group(0) @binding(6) var<uniform> sun: Sun;
@group(0) @binding(2) var<storage, read> scenery: array<vec4f>;
fn forestData(i: u32) -> vec4f { return scenery[i]; }
// (V2e — F1: the wind the near trees sway in — misc.yzw: towards on the frame's axes, strength; the clock north.w — and the camera)
fn forestWind() -> vec4f { return vec4f(sc.misc.y, sc.misc.z, sc.misc.w, sc.north.w); }
fn forestEye() -> vec3f { return sc.cam.xyz; }
${forest}
const CAP = ${SCENERY_RASTER_CAP}u;
struct Draw { vertices: u32, instances: atomic<u32>, first: u32, base: u32 };
// (the four lists' draws, then the buildings' boxes': one a node of the scenery's BVH —, the two shadow lists', the
// buildings' triangles')
// (then — Q1, 2 Nov 2026 — the buildings' boxes in view, the bridges' parts in view)
@group(0) @binding(3) var<storage, read_write> draws: array<Draw, ${LISTS + 7}>;
@group(0) @binding(4) var<storage, read_write> listsOut: array<u32>;
@group(0) @binding(5) var<storage, read> listsIn: array<u32>;

// A cell's tree as forestCandidate shapes it, its plain crown unshrunk (the carving, the twigs, a far crown's shrinking
// all lie within it); none where the cell has no tree.
struct Tree { ok: bool, kind: u32, foot: vec3f, cone: bool, c: vec3f, r: vec3f, trunk: bool, trunkR: f32, trunkTop: f32, height: f32, seed: f32 };
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
  o.height = height;
  o.seed = forestUnit(forestHash(gi, gj, 4u));
  // (its plain shape: forest.wgsl forestShape, the tracer's own)
  let bare = kD.w * forestData(hd.F + 7u).z;
  let shape = forestShape(kind, o.foot, height, r, kA, kB, bare);
  o.cone = shape.cone;
  o.c = shape.c;
  o.r = shape.r;
  o.trunk = kB.x > 0.0;
  o.trunkR = kB.y + kB.z * height;
  o.trunkTop = z + shape.trunkTop;
  o.ok = true;
  return o;
}
// a scenery-frame point, camera-relative on the raster's axes (right, up, forward)
// a point in the frame before's camera's axes (view's, with that camera: the moving meshes' motion — PLAN-J1 J1-2)
fn viewPrev(p: vec3f) -> vec3f {
  var rel = p - sc.pcam.xyz;
  if (sc.lift.w > 0.5) {
    let d = length(rel);
    let L = (sc.lift.x + sc.lift.y * d) * d * d;
    let a = L / max(d, 1.0);
    rel.z += L * smoothstep(0.5 * sc.lift.z, sc.lift.z, a);
  }
  let e = sc.east.xyz * rel.x + sc.north.xyz * rel.y + sc.up.xyz * rel.z;
  return vec3f(dot(e, sc.pr.xyz), dot(e, sc.pu.xyz), dot(e, sc.pf.xyz));
}
fn view(p: vec3f) -> vec3f {
  var rel = p - sc.cam.xyz;
  // (R4b: seen where the air shows it — lifted along the frame's up by Λ(d), faded in under 0.1′; the projection's alone —
  // sunClip, the shadow maps, never)
  if (sc.lift.w > 0.5) {
    let d = length(rel);
    let L = (sc.lift.x + sc.lift.y * d) * d * d;
    let a = L / max(d, 1.0);
    rel.z += L * smoothstep(0.5 * sc.lift.z, sc.lift.z, a);
  }
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
    // (the buildings' triangles and the bridges' after them — scenery-data.ts packScenery's mesh, vec4 3; all of them in vec4 2's
    // w —: three vertices each)
    draws[${LISTS + 3}].vertices = u32(max(scenery[2].w, scenery[3].w)) * 3u;
    // (and the bridges' after them — scenery-data.ts: their count with the buildings' in vec4 2's w —: the shadow map's alone)
    draws[${LISTS + 4}].vertices = u32(max(scenery[2].w, scenery[3].w)) * 3u;

  }
}
// The scenery's nodes' boxes in view (Q1, 2 Nov 2026 — before, the visibility pass ran its box shaders over every node of
// the scenery's BVH: two pipelines × 36 vertices × ~64 000 nodes over Paris, 1.6 ms of kerr-mini's frame for the bridges' marks
// alone): a building's box into its list, a bridge's part into the marks' — the field of view's sides tested against each box's
// sphere, as the trees' (the shadow map's boxes all drawn still: the Sun's view is another)
@compute @workgroup_size(64)
fn cullBoxes(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let k = g.y * n.x * 64u + g.x;
  if (k >= u32(scenery[0].x)) { return; }
  let lo = scenery[4u + k * 2u];
  let hi = scenery[5u + k * 2u];
  if (hi.w < 0.0) { return; }
  let R = 0.5 * length(hi.xyz - lo.xyz) + 1.0;
  let v = view(0.5 * (lo.xyz + hi.xyz));
  let tx = u.right.w; let ty = u.up.w;
  if (v.z < -R) { return; }
  if (abs(v.x) - tx * v.z > R * sqrt(1.0 + tx * tx)) { return; }
  if (abs(v.y) - ty * v.z > R * sqrt(1.0 + ty * ty)) { return; }
  let b = building(hi);
  let list = select(${LISTS + 3}u, ${LISTS + 2}u, b);
  let at = atomicAdd(&draws[select(${LISTS + 6}u, ${LISTS + 5}u, b)].instances, 1u);
  if (at < CAP) { listsOut[list * CAP + at] = k; }
}
@compute @workgroup_size(1)
fn clampBoxes() {
  atomicStore(&draws[${LISTS + 5}].instances, min(atomicLoad(&draws[${LISTS + 5}].instances), CAP));
  atomicStore(&draws[${LISTS + 6}].instances, min(atomicLoad(&draws[${LISTS + 6}].instances), CAP));
}

override LIST: u32 = 0u;
struct V { @builtin(position) clip: vec4f, @location(0) @interpolate(flat) id: f32, @location(1) p: vec3f, @location(2) mot: vec3f };
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
  // (V2e — F1: the crown swayed by the wind as forest.wgsl's forestCandidate sways it — the shading's own —, its foot fixed; its
  // motion since the frame before — the sway then, through the camera then — for the history, as the moving meshes'; the shadow
  // map's proxies — shadowVs — left still)
  let crown = part < 2u;
  let sw = select(vec2f(0.0), forestSway(t.foot, t.height, t.seed), crown && !none);
  let v = view(p + vec3f(sw, 0.0));
  // (the terrain's projection: infinite reversed-Z, its near plane)
  o.clip = select(vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z), vec4f(2.0, 2.0, 0.5, 1.0), none);
  o.id = f32(k + 1u);
  o.p = v;
  o.mot = vec3f(0.0);
  if (crown && !none && any(sw != vec2f(0.0)) && sc.pf.w > 0.5 && v.z > 0.1) {
    let w = forestWind();
    let swp = forestSwayAt(t.foot, t.height, t.seed, w, sc.pcam.xyz, sc.pcam.w);
    let vp = viewPrev(p + vec3f(swp, 0.0));
    if (vp.z > 0.1) {
      let n0 = vec2f(v.x / (u.right.w * v.z), v.y / (u.up.w * v.z));
      let n1 = vec2f(vp.x / (sc.pr.w * vp.z), vp.y / (sc.pu.w * vp.z));
      o.mot = vec3f((n0 - n1) * 0.5 * vec2f(u.image.x, -u.image.y), 1.0);
    }
  }
  return o;
}
// (g the tree's id, b its proxy's distance — the ground's in r stays)
@fragment fn proxyFs(v: V) -> MO {
  var o: MO;
  o.vis = vec4f(0.0, v.id, length(v.p), 0.0);
  o.mot = vec4f(v.mot, 0.0);
  return o;
}

// The buildings' boxes (a node of the scenery's BVH an instance: its leaves — a building each — drawn, its inner nodes at one
// point): where one is before the ground and the trees, the pixel's alpha 2 — the tracer's kernel shade tests the buildings
// there alone (trace.wgsl worldScenery), not along every camera ray. Depth tested, not written; a box a little wider.
const BOX = array<u32, 36>(0u, 1u, 3u, 0u, 3u, 2u, 4u, 6u, 7u, 4u, 7u, 5u, 0u, 4u, 5u, 0u, 5u, 1u, 2u, 3u, 7u, 2u, 7u, 6u,
  0u, 2u, 6u, 0u, 6u, 4u, 1u, 5u, 7u, 1u, 7u, 3u);
// a leaf whose building has its triangles (packed word's bit 21): its shadow drawn by them, not by its box (its box still
// marks its pixels for the kernel: wider than the building, the jittered rays' exact test decides its edges)
fn meshed(hi: vec4f) -> bool {
  let g = u32(scenery[0].y + hi.w);
  let p = scenery[g];
  return p.w > 0.5 && p.w < 1.5 && ((u32(scenery[g + 2u].w) >> 21u) & 1u) == 1u;
}
// a leaf a building's (its primitive's kind 1) — not a bridge's deck, parapet or pier (polygons of kinds 2–4, strips across a
// river at any angle: their boxes along the frame's axes far wider than they are)
fn building(hi: vec4f) -> bool {
  let p = scenery[u32(scenery[0].y + hi.w)];
  return p.w > 0.5 && p.w < 1.5;
}
// (the boxes in view — cullBoxes' list: the instance its index there)
fn boxInView(ii: u32) -> u32 { return listsIn[${LISTS + 2}u * CAP + ii]; }
@vertex fn boxVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f { return boxClip(vi, boxInView(ii)); }
fn boxClip(vi: u32, ii: u32) -> vec4f {
  let lo = scenery[4u + ii * 2u];
  let hi = scenery[5u + ii * 2u];
  if (hi.w < 0.0) { return vec4f(2.0, 2.0, 0.5, 1.0); }
  let c = BOX[vi];
  let k = vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u));
  let v = view(mix(lo.xyz - vec3f(0.5), hi.xyz + vec3f(0.5), k));
  return vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
}
@fragment fn boxFs() -> @location(0) vec4f { return vec4f(0.0, 0.0, 0.0, ${RASTER_CODE.box * RASTER_CODE_SCALE}.0); }
// (with the buildings' solid boxes and triangles — the material's —: the rest's boxes — a bridge's — marking their pixels alone,
// the kernel shade's exact test deciding what of the box the deck is, the water round it the water's)
// A bridge's deck, parapet or pier — a strip, four corners: its polygon's edges' starts, in its ring's order —: the corner of its
// own prism at a box's vertex k (0/1 a side), not of its box along the axes (far wider than a strip across at an angle); w 0: not a
// strip (another shape)
// a building leaf's box corner k (0/1 each axis) — turned as the building is: its footprint's oriented box in the leaf's
// second vec4 (scenery-data.ts orientedBox: centre, angle, half-sides packed), its height the node's; the frame's box where it
// has none (a side past 409.5 m)
fn buildingCorner(lo: vec4f, hi: vec4f, k: vec3f) -> vec3f {
  let g = u32(scenery[0].y + hi.w);
  let ob = scenery[g + 1u];
  if (ob.w < 0.0) { return mix(lo.xyz, hi.xyz, k); }
  let e = u32(ob.w);
  let a = (k.x * 2.0 - 1.0) * f32(e >> 12u) * 0.1;
  let b = (k.y * 2.0 - 1.0) * f32(e & 4095u) * 0.1;
  let c = cos(ob.z);
  let s = sin(ob.z);
  return vec3f(ob.xy + vec2f(c, s) * a + vec2f(-s, c) * b, mix(lo.z, hi.z, k.z));
}
fn stripCorner(hi: vec4f, k: vec3f) -> vec4f {
  let g = u32(scenery[0].y + hi.w);
  let pr = scenery[g];
  if (pr.z != 4.0) { return vec4f(0.0); }
  let ci = select(select(0u, 1u, k.x > 0.5), select(3u, 2u, k.x > 0.5), k.y > 0.5);
  return vec4f(scenery[g + 3u + ci].xy, mix(pr.x, pr.y, k.z), 1.0);
}
// (a bridge's mark — RASTER_CODE bridgeMark; a building's box, box —: shadeLite takes its pixels, the deck tested along the ray, the water about it its)
@fragment fn bridgeMarkFs() -> @location(0) vec4f { return vec4f(0.0, 0.0, 0.0, ${RASTER_CODE.bridgeMark * RASTER_CODE_SCALE}.0); }
@vertex fn boxMarkVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) mi: u32) -> @builtin(position) vec4f {
  let ii = listsIn[${LISTS + 3}u * CAP + mi];
  let hi = scenery[5u + ii * 2u];
  if (hi.w < 0.0 || building(hi)) { return vec4f(2.0, 2.0, 0.5, 1.0); }
  // (its prism: only its own pixels to the kernel — the water about it shadeWater's, one river, not patches of the kernel's
  // shading within its box)
  let c = BOX[vi];
  let s = stripCorner(hi, vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u)));
  if (s.w < 0.5) { return boxClip(vi, ii); }
  let v = view(s.xyz);
  return vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
}
// the buildings' boxes from the Sun (the shadow map)
@vertex fn boxShadowVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let lo = scenery[4u + ii * 2u];
  let hi = scenery[5u + ii * 2u];
  if (hi.w < 0.0 || meshed(hi)) { return vec4f(2.0, 2.0, 0.5, 1.0); }
  let c = BOX[vi];
  let k = vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u));
  if (!building(hi)) {
    // (a bridge's strip: its own prism's shadow — its box's a square on the water far wider than the bridge —; another shape none)
    let s = stripCorner(hi, k);
    if (s.w < 0.5) { return vec4f(2.0, 2.0, 0.5, 1.0); }
    return sunClip(s.xyz);
  }
  return sunClip(buildingCorner(lo, hi, k));
}
// The near buildings' triangles (roof-mesh.ts: their walls up to their roofs, their roofs' faces): the exact solid the
// tracer's kernel tests, drawn from the Sun into the shadow map — their shadows their own shapes, gables and slopes, not
// boxes along the frame's axes.
fn meshVertex(vi: u32) -> vec3f { return meshVertexAt(vi, sc.north.w); }
// (a mesh's vertex at the game's clock tc — the cars' and the blades' places then)
fn meshVertexAt(vi: u32, tc: f32) -> vec3f {
  let t = u32(scenery[3].z) * 4u + vi;
  let f = u32(scenery[3].x) * 4u + bitcast<u32>(scenery[t / 4u][t % 4u]) * 3u;
  var p = vec3f(scenery[f / 4u][f % 4u], scenery[(f + 1u) / 4u][(f + 1u) % 4u], scenery[(f + 2u) / 4u][(f + 2u) % 4u]);
  // (Q8 D1: a wind turbine's blade turned about its rotor's axis — the table after the tags: (hub, rate), (axis, phase) —, by
  // the game's clock in sc.north.w: frozen with it; its shadow in the map turned the same)
  let tri = vi / 3u;
  if (tri >= u32(scenery[3].w)) {
    let tg = bitcast<u32>(scenery[(t - vi + u32(scenery[2].w) * 3u + tri) / 4u][(t - vi + u32(scenery[2].w) * 3u + tri) % 4u]);
    let hi = tg & 0xffff0000u;
    // (Q8 D1: a car — body, headlights, tail lights —: built in its own frame (x ahead, y left, z up), driven along its piece of
    // road — its entry after the pylons': (start, speed), (end, phase) — by the game's clock, starting again at its end)
    if (hi == 0xfff90000u || hi == 0xfff80000u || hi == 0xfff70000u) {
      let b0 = u32(scenery[3].z) + u32(scenery[2].w);
      let hd = scenery[b0];
      let r = b0 + 1u + 3u * u32(hd.x) + 2u * u32(hd.y) + 2u * (tg & 0xffffu);
      let st = scenery[r];
      let en = scenery[r + 1u];
      let D = en.xyz - st.xyz;
      let L = max(length(D.xy), 1.0);
      let s = fract(en.w + tc * st.w / L);
      let d = normalize(vec3f(D.xy, 0.0) + vec3f(1e-6, 0.0, 0.0));
      p = st.xyz + D * s + d * p.x + vec3f(-d.y, d.x, 0.0) * p.y + vec3f(0.0, 0.0, p.z);
    }
    if (hi == 0xfffe0000u || hi == 0xfffd0000u || hi == 0xfffa0000u) {
      let r = u32(scenery[3].z) + u32(scenery[2].w) + 1u + 3u * (tg & 0xffffu);
      if (hi == 0xfffe0000u) {
        let h = scenery[r];
        let ax = scenery[r + 1u];
        let a = tc * h.w + ax.w;
        let q = p - h.xyz;
        let k = ax.xyz;
        p = h.xyz + q * cos(a) + cross(k, q) * sin(a) + k * dot(k, q) * (1.0 - cos(a));
      }
      // (the head and its blades turned about the tower's axis — the frame's up — to face the weather's wind: sc.up.w [rad])
      let tw = scenery[r + 2u].xy;
      let y = sc.up.w;
      let d = p.xy - tw;
      p = vec3f(tw + vec2f(d.x * cos(y) - d.y * sin(y), d.x * sin(y) + d.y * cos(y)), p.z);
    }
  }
  return p;
}
@vertex fn meshShadowVs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return sunClip(meshVertex(vi));
}
// The same triangles in the camera's view (docs/progress/raster-aaa/TERRE-UNREAL.md U2): the buildings' exact solid, depth
// written — after their boxes, before nothing —, the pixel's distance in r and b as the ground's, a 3: trace.wgsl shadeLite
// draws them with its material, not the kernel shade's rays
// (bridge: a bridge's part's triangle — past the buildings' in the mesh —, coded bridgeMesh — terrainRasterBridgeMesh)
struct MV { @builtin(position) clip: vec4f, @location(0) p: vec3f, @location(1) @interpolate(flat) bridge: f32, @location(2) @interpolate(flat) leaf: f32, @location(3) pyl: vec4f, @location(4) mot: vec3f };
// (the mesh pass's outputs: its visibility, and its motion — the moving meshes' [px] since the frame before, z 1 where given)
struct MO { @location(0) vis: vec4f, @location(1) mot: vec4f };
// a building triangle's leaf (packScenery: after the triangles, its record's offset from geomOffset) + 1; 0 a bridge's
fn meshTag(tri: u32) -> u32 {
  let t = u32(scenery[3].z) * 4u + u32(scenery[2].w) * 3u + tri;
  return bitcast<u32>(scenery[t / 4u][t % 4u]);
}
fn meshLeaf(tri: u32) -> f32 {
  if (tri >= u32(scenery[3].w)) { return 0.0; }
  return f32(meshTag(tri) + 1u);
}
@vertex fn meshVs(@builtin(vertex_index) vi: u32) -> MV {
  var o: MV;
  // (bridge: 0 a building's triangle, 1 a bridge's, 2 a wind turbine's — Q8 D1, packScenery's TURBINE_TAG)
  let past = vi / 3u >= u32(scenery[3].w);
  let tg = select(0u, meshTag(vi / 3u), past);
  let fam = tg & 0xffff0000u;
  o.bridge = select(0.0, select(1.0, 2.0, tg == 0xffffffffu || fam == 0xfffe0000u || fam == 0xfffd0000u || fam == 0xfffa0000u || fam == 0xfff90000u || fam == 0xfff80000u || fam == 0xfff70000u || fam == 0xfff50000u), past);
  o.leaf = meshLeaf(vi / 3u);
  let wp = meshVertex(vi);
  // (Q8 D1: a pylon — 3 —, its point in its own axes for meshFs's lattice: along its line, across, up from its foot; w its
  // height)
  o.pyl = vec4f(0.0);
  if ((tg & 0xffff0000u) == 0xfffc0000u) {
    o.bridge = 3.0;
    let r = u32(scenery[3].z) + u32(scenery[2].w) + 1u + 3u * u32(scenery[u32(scenery[3].z) + u32(scenery[2].w)].x) + 2u * (tg & 0xffffu);
    let f = scenery[r];
    let a = scenery[r + 1u].x;
    let d = wp.xy - f.xy;
    o.pyl = vec4f(d.x * cos(a) + d.y * sin(a), -d.x * sin(a) + d.y * cos(a), wp.z - f.z, f.w);
  }
  var v = view(wp);
  // (Q8 D1: a car — its g 4 + its paint's index / 8, 5 a headlight, 6 a tail light: shadeLite's —; a lamp's quad, its four
  // vertices at its centre, opened towards the camera to a pixel and a half at least — the corner by the vertex's index mod 4)
  if (fam == 0xfff90000u) { o.leaf = 4.0 + f32((tg & 0xffffu) % 8u) / 8.0; }
  if (fam == 0xfff80000u || fam == 0xfff70000u) {
    o.leaf = select(6.0, 5.0, fam == 0xfff80000u);
    let t = u32(scenery[3].z) * 4u + vi;
    let id = bitcast<u32>(scenery[t / 4u][t % 4u]) & 3u;
    let px = 2.0 * u.up.w * max(v.z, 1.0) / u.image.y;
    let half = max(0.12, 0.75 * px);
    let corner = vec2f(select(-1.0, 1.0, id == 1u || id == 2u), select(-1.0, 1.0, id >= 2u));
    v = v + vec3f(corner * half, 0.0);
  }
  // (Q8 D1: a turbine's obstruction light — its leaf 3, shadeLite's lamp —: widened about its centre to 1.5 pixels at least)
  if ((tg & 0xffff0000u) == 0xfffa0000u) {
    o.leaf = 3.0;
    let r = u32(scenery[3].z) + u32(scenery[2].w) + 1u + 3u * (tg & 0xffffu);
    let c = vec3f(scenery[r + 2u].xy, scenery[r + 2u].z);
    let px = 2.0 * u.up.w * max(v.z, 1.0) / u.image.y;
    let k = max(1.0, 1.5 * px / 0.6);
    v = view(c + (wp - c) * k);
  }
  // (Q8 D1: a conductor — 4 —: its pair of vertices opened along the frame's up to a pixel at least — the even one down —, the
  // share of that its wire covers in pyl.x: meshFs keeps that share of its pixels, a fresh draw each frame — its seed the frame's
  // number (sc.misc.x — pyl.y), new each frame even frozen: the history's mean the wire's true faintness)
  if (tg == 0xfffb0000u) {
    o.bridge = 4.0;
    let t = u32(scenery[3].z) * 4u + vi;
    let id = bitcast<u32>(scenery[t / 4u][t % 4u]);
    let px = 2.0 * u.up.w * max(v.z, 1.0) / u.image.y;
    let half = max(${CABLE_WIDTH_M / 2}, 0.5 * px);
    o.pyl = vec4f(${CABLE_WIDTH_M} / (2.0 * half), sc.misc.x, 0.0, 0.0);
    v = view(wp + vec3f(0.0, 0.0, select(-half, half, (id & 1u) == 1u)));
  }
  // (Q8 L10: a street lamp's head — its leaf 7, shadeLite's —: its four vertices at its centre opened towards the camera to a
  // pixel and a half at least, as a car's lamps; its pole — 4, as a conductor —: each pair opened across the view to a pixel at
  // least, the even one to the left, its coverage's share kept by meshFs)
  if (fam == 0xfff50000u || fam == 0xfff60000u) {
    let t = u32(scenery[3].z) * 4u + vi;
    let id = bitcast<u32>(scenery[t / 4u][t % 4u]) & 3u;
    let px = 2.0 * u.up.w * max(v.z, 1.0) / u.image.y;
    if (fam == 0xfff50000u) {
      o.leaf = 7.0;
      let half = max(0.3, 0.75 * px);
      let corner = vec2f(select(-1.0, 1.0, id == 1u || id == 2u), select(-1.0, 1.0, id >= 2u));
      v = v + vec3f(corner * half, 0.0);
    } else {
      o.bridge = 4.0;
      let half = max(${LAMP_POLE_M / 2}, 0.5 * px);
      o.pyl = vec4f(${LAMP_POLE_M} / (2.0 * half), sc.misc.x, 0.0, 0.0);
      v = v + vec3f(select(-half, half, (id & 1u) == 1u), 0.0, 0.0);
    }
  }
  o.clip = vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
  o.p = v;
  // (PLAN-J1 J1-2: the moving meshes — the cars and their lamps, the turbines' blades — their motion on the image since the frame
  // before [px], unjittered: their point then — the clock then — through the camera then; the rest still on the scenery: none —
  // the history reprojects it by the camera and the depth)
  o.mot = vec3f(0.0);
  let moving = fam == 0xfff90000u || fam == 0xfff80000u || fam == 0xfff70000u || fam == 0xfffe0000u || fam == 0xfffd0000u || fam == 0xfffa0000u;
  if (moving && sc.pf.w > 0.5 && v.z > 0.1) {
    let vp = viewPrev(meshVertexAt(vi, sc.pcam.w));
    if (vp.z > 0.1) {
      let n0 = vec2f(v.x / (u.right.w * v.z), v.y / (u.up.w * v.z));
      let n1 = vec2f(vp.x / (sc.pr.w * vp.z), vp.y / (sc.pu.w * vp.z));
      let m = (n0 - n1) * 0.5 * vec2f(u.image.x, -u.image.y);
      // (a car its loop's wrap took back — a jump over a quarter of the image —: no history at all, z 2)
      o.mot = select(vec3f(m, 1.0), vec3f(0.0, 0.0, 2.0), length(m) > 0.25 * max(u.image.x, u.image.y));
    }
  }
  return o;
}
// (g: the building's leaf + 1 — shadeLite's material finds its walls and roof there —; 0 a bridge's part)
@fragment fn meshFs(v: MV) -> MO {
  var o: MO;
  o.vis = meshShade(v);
  o.mot = vec4f(v.mot, 0.0);
  return o;
}
fn meshShade(v: MV) -> vec4f {
  let d = length(v.p);
  // (Q8 D1: a pylon's lattice — its legs at its faces' edges, a girt every 4 m, an X in each bay, members ~0.3 m — its gaps open
  // while a member spans a pixel or more; past that its silhouette whole, no shimmer)
  let fw = max(length(dpdx(v.pyl.xyz)), length(dpdy(v.pyl.xyz)));
  if (v.bridge > 3.5) {
    let h = fract(sin(dot(floor(v.clip.xy) + vec2f(v.pyl.y * 7.31, 0.0), vec2f(12.9898, 78.233))) * 43758.547);
    if (h > v.pyl.x) { discard; }
  }
  if (v.bridge > 2.5 && v.bridge < 3.5 && fw < 0.3) {
    let H = v.pyl.w;
    let z = v.pyl.z;
    let half = mix(H / 12.0, max(0.8, H / 45.0), clamp(z / H, 0.0, 1.0));
    let aa = abs(v.pyl.x);
    let cc = abs(v.pyl.y);
    // (on the body, not an arm nor the top)
    if (max(aa, cc) < half + 0.3 && z < H - 0.2) {
      let s = select(v.pyl.y, v.pyl.x, cc > aa);
      let m = 0.15 + fw;
      let leg = half - abs(s) < 2.0 * m;
      let girt = fract(z / 4.0) * 4.0 < 2.0 * m;
      let f = fract(z / 4.0);
      let x1 = abs(s / half - (2.0 * f - 1.0)) * half < m * 1.4;
      let x2 = abs(s / half - (1.0 - 2.0 * f)) * half < m * 1.4;
      if (!(leg || girt || x1 || x2)) { discard; }
    }
  }
  let code = select(select(${RASTER_CODE.mesh}.0 + v.bridge, ${RASTER_CODE.turbine}.0, v.bridge > 1.5), ${RASTER_CODE.pylon}.0, v.bridge > 2.5);
  return vec4f(d, v.leaf, d, code * ${RASTER_CODE_SCALE}.0);
}
// The buildings without triangles — the far ones, past BUILDING_MESH_M — as their boxes, solid (no margin, the top flat), turned
// as their footprints are (buildingCorner):
// the material's buildings too, none left to the kernel shade's rays (their marking boxes, wider than they are and up to their
// roofs' tops, had sent the pixels over a pitched roof and along their margins there too)
@vertex fn boxSolidVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) bi: u32) -> MV {
  var o: MV;
  let ii = boxInView(bi);
  let lo = scenery[4u + ii * 2u];
  let hi = scenery[5u + ii * 2u];
  // (a building's alone: a bridge's box, solid, was a slab far wider than its deck, the aerial imagery drawn on it — boxMarkVs)
  if (hi.w < 0.0 || meshed(hi) || !building(hi)) {
    o.clip = vec4f(2.0, 2.0, 0.5, 1.0);
    return o;
  }
  let c = BOX[vi];
  let k = vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u));
  let v = view(buildingCorner(lo, hi, k));
  o.leaf = hi.w + 1.0;
  o.clip = vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
  o.p = v;
  return o;
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
  private cullBoxesPipe: GPUComputePipeline | null = null;
  private clampBoxesPipe: GPUComputePipeline | null = null;
  private clampPipe: GPUComputePipeline | null = null;
  private drawPipes: (GPURenderPipeline | null)[] = [null, null, null, null];
  private boxPipe: GPURenderPipeline | null = null;
  /** the buildings without triangles as their solid boxes (with meshPipe: the material's buildings) */
  private boxPipeMeshed: GPURenderPipeline | null = null;
  /** with them, the rest's boxes — a bridge's — marking their pixels for the kernel's exact test (boxMarkVs) */
  private boxMarkPipe: GPURenderPipeline | null = null;
  /** the buildings' triangles in the camera's view (U2: shadeLite's buildings) */
  private meshPipe: GPURenderPipeline | null = null;
  /** draw them (renderer.rasterLite: the material draws them — false, their boxes alone, shade's rays as before) */
  meshes3d = true;
  private shadowPipes: (GPURenderPipeline | null)[] = [null, null];
  private boxShadowPipe: GPURenderPipeline | null = null;
  private meshShadowPipe: GPURenderPipeline | null = null;
  private sunU: GPUBuffer;
  private sunOn = false;
  private meshes: GPUBuffer[] = [];
  private meshCounts: number[] = [];
  private frameU: GPUBuffer;
  private sceneryU: GPUBuffer;
  /** (Q8 D1) the game's clock [s] the turbines' blades turn by (renderer.ts: its rain clock — frozen with the world) */
  clock = 0;
  /** (Q8 D1) the renderer's frame count (the conductors' coverage draw) */
  frame = 0;
  /** (Q8 D1) where the surface wind blows from at the scenery [° from north] — the turbines face it */
  windFrom = TURBINE_FACING;
  /** (V2e — F1) the wind the near trees sway in: towards east, north (unit), strength (0 calm … 2) — renderer.ts sets it */
  sway: [number, number, number] = [0, 0, 0];
  private draws: GPUBuffer;
  private lists: GPUBuffer;
  private reset = new Uint32Array((LISTS + 7) * 4);
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
    this.sceneryU = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.draws = device.createBuffer({
      size: (LISTS + 7) * 16,
      usage: S | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      label: "scenery raster draws",
    });
    this.lists = device.createBuffer({ size: (LISTS + 4) * SCENERY_RASTER_CAP * 4, usage: S, label: "scenery raster instances" });
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
    void device
      .createComputePipelineAsync({ layout: cullPipeLayout, compute: { module: this.module, entryPoint: "cullBoxes" } })
      .then((p) => (this.cullBoxesPipe = p), fail);
    void device
      .createComputePipelineAsync({ layout: cullPipeLayout, compute: { module: this.module, entryPoint: "clampBoxes" } })
      .then((p) => (this.clampBoxesPipe = p), fail);
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
            // (V2e — F1: the swaying crowns' motion written — the ground's under them overwritten, depth tested)
            targets: [
              { format: TERRAIN_RASTER_FORMAT, writeMask: GPUColorWrite.GREEN | GPUColorWrite.BLUE },
              { format: TERRAIN_RASTER_MOTION_FORMAT },
            ],
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
          targets: [{ format: TERRAIN_RASTER_FORMAT, writeMask: GPUColorWrite.ALPHA }, NO_MOTION],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" },
      })
      .then((p) => (this.boxPipe = p), fail);
    void device
      .createRenderPipelineAsync({
        layout: drawPipeLayout,
        vertex: { module: this.module, entryPoint: "boxMarkVs" },
        fragment: {
          module: this.module,
          entryPoint: "bridgeMarkFs",
          targets: [{ format: TERRAIN_RASTER_FORMAT, writeMask: GPUColorWrite.ALPHA }, NO_MOTION],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" },
      })
      .then((p) => (this.boxMarkPipe = p), fail);
    void device
      .createRenderPipelineAsync({
        layout: drawPipeLayout,
        vertex: { module: this.module, entryPoint: "boxSolidVs" },
        fragment: {
          module: this.module,
          entryPoint: "meshFs",
          targets: [{ format: TERRAIN_RASTER_FORMAT }, { format: TERRAIN_RASTER_MOTION_FORMAT }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
      })
      .then((p) => (this.boxPipeMeshed = p), fail);
    // (the buildings' triangles: every channel, depth tested and written — the wall nearer than the box drawn before it)
    void device
      .createRenderPipelineAsync({
        layout: drawPipeLayout,
        vertex: { module: this.module, entryPoint: "meshVs" },
        fragment: {
          module: this.module,
          entryPoint: "meshFs",
          targets: [{ format: TERRAIN_RASTER_FORMAT }, { format: TERRAIN_RASTER_MOTION_FORMAT }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
      })
      .then((p) => (this.meshPipe = p), fail);
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
    void device
      .createRenderPipelineAsync({
        layout: drawPipeLayout,
        vertex: { module: this.module, entryPoint: "meshShadowVs" },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: depthOnly,
      })
      .then((p) => (this.meshShadowPipe = p), fail);
  }

  private lod: SceneryRasterLod = SCENERY_RASTER_LOD;
  private sceneryOut = new Float32Array(40);
  /** the frame before's camera for the moving meshes' motion (PLAN-J1 J1-2): its place on the scenery's axes, its clock, its axes */
  private prevCam: { frame: Float32Array; cam: [number, number, number]; axes: number[]; clock: number } | null = null;
  /** (R4b) the air's lift for the scenery's projection: (x + y d) d² [m], z the fade's angle, w 1 on — renderer.ts sceneryLift */
  lift = new Float32Array(4);
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
    // (the boxes in view, the bridges' parts in view: cullBoxes' counts)
    this.reset[(LISTS + 5) * 4] = 36;
    this.reset[(LISTS + 6) * 4] = 36;
    // (the buildings' triangles: one instance, their vertices clampDraws's)
    this.reset[(LISTS + 3) * 4 + 1] = 1;
    this.reset[(LISTS + 4) * 4 + 1] = 1;
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
    return (
      !this.error &&
      !!this.cullPipe &&
      !!this.clampPipe &&
      !!this.cullBoxesPipe &&
      !!this.clampBoxesPipe &&
      !!this.boxPipe &&
      this.drawPipes.every((p) => !!p)
    );
  }
  /** the shadow map's pipelines compiled */
  get shadowReady() {
    return this.ready && !!this.boxShadowPipe && !!this.meshShadowPipe && this.shadowPipes.every((p) => !!p);
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
    /** the scenery's BVH nodes (scenery.ts nodeCount): cullBoxes' grid */
    nodes = 0,
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
    this.sceneryOut.set(this.lift, 16);
    // (north.w — unread here as P.scenery's —: the game's clock for the turbines' blades — Q8 D1)
    this.sceneryOut[7] = this.clock;
    // (misc.x: the frame's number — the conductors' coverage draw, a fresh one each frame — Q8 D1)
    this.sceneryOut[20] = this.frame % 4096;
    // (V2e — F1: the wind the near trees sway in — towards on the frame's axes, its strength; forest.wgsl forestWind)
    this.sceneryOut[21] = this.sway[0];
    this.sceneryOut[22] = this.sway[1];
    this.sceneryOut[23] = this.sway[2];
    // (up.w — unread here too —: the turbines' heads' turn from their built facing to the weather's wind, anticlockwise [rad])
    this.sceneryOut[11] = (-(this.windFrom - TURBINE_FACING) * Math.PI) / 180;
    // (the frame before's camera — PLAN-J1 J1-2, the moving meshes' motion —: valid while the scenery's axes are the same and the
    // camera has not jumped — a new origin, a teleport: no motion that frame, the history's own reprojection)
    {
      const so = this.sceneryOut;
      const cur = {
        cam: [so[12]!, so[13]!, so[14]!] as [number, number, number],
        axes: [...so.subarray(0, 3), ...so.subarray(4, 7), ...so.subarray(8, 11)],
        frame: Float32Array.from((frame as Float32Array).subarray(12, 24)),
        clock: this.clock,
      };
      const p = this.prevCam;
      const valid =
        this.motionOn &&
        !!p &&
        p.axes.every((v, i) => Math.abs(v - cur.axes[i]!) < 1e-7) &&
        Math.hypot(cur.cam[0] - p.cam[0], cur.cam[1] - p.cam[1], cur.cam[2] - p.cam[2]) < 2000;
      if (p && valid) {
        so.set([...p.cam, p.clock], 24);
        so.set(p.frame.subarray(0, 4), 28);
        so.set(p.frame.subarray(4, 8), 32);
        so.set([p.frame[8]!, p.frame[9]!, p.frame[10]!, 1], 36);
      } else so.fill(0, 24, 40);
      this.prevCam = cur;
    }
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
    // (over every node — their count the CPU's: an indirect dispatch would read the draws' buffer while the pass writes it)
    const bg = Math.ceil(nodes / 64);
    if (bg > 0) {
      pass.setPipeline(this.cullBoxesPipe!);
      pass.dispatchWorkgroups(Math.min(bg, 65535), Math.ceil(bg / 65535));
    }
    pass.setPipeline(this.clampBoxesPipe!);
    pass.dispatchWorkgroups(1);
    pass.end();
    this.cells = forestCells;
    this.active = true;
    this.encodedFrames++;
    return true;
  }

  /** the moving meshes' motion written (PLAN-J1 J1-2; an A/B lever — off: the history reprojects them by the camera and the
   *  depth, their trails as before). On since 10 Nov: with the frame before's motion (renderer keepMotion) the history drops
   *  where a car was and no longer is — the trails gone on Toulon's motorway, still camera, kerr-mini */
  motionOn = true;
  /** the least projected radius of a tree drawn [px] (renderer.treeMinPx) — 2.5, not 1.2: the far crowns under 5 px across
   *  the orthophoto's green already, ~1.5–2.5 ms of an M1's frame over a city (TERRE-UNREAL U6) */
  minPx = 2.5;
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
    const meshes = this.meshes3d && !!this.meshPipe && !!this.boxPipeMeshed && !!this.boxMarkPipe;
    pass.setBindGroup(0, this.drawBind);
    // (debugSkip 4, 8, 16: the boxes, the bridges' marks, the buildings' triangles left out — what each costs, Q1)
    // (the boxes and the bridges' marks in view alone: cullBoxes' lists)
    if (!(this.debugSkip & 4)) {
      pass.setPipeline(meshes ? this.boxPipeMeshed! : this.boxPipe!);
      pass.drawIndirect(this.draws, (LISTS + 5) * 16);
    }
    if (meshes) {
      // (the bridges' parts their own triangles now, with the buildings' — no marks: their boxes' pixels went to the rays'
      // kernel, 6.5 ms over the Seine; debugSkip 8 draws the marks again, for comparison)
      if (this.debugSkip & 8) {
        pass.setPipeline(this.boxMarkPipe!);
        pass.drawIndirect(this.draws, (LISTS + 6) * 16);
      }
      if (!(this.debugSkip & 16)) {
        pass.setPipeline(this.meshPipe!);
        pass.drawIndirect(this.draws, (LISTS + 3) * 16);
      }
    }
  }

  /** The trees' and buildings' shadow map, seen from the Sun (after encodeCull, which culled its lists): false when not drawn. */
  encodeShadow(enc: GPUCommandEncoder, descriptor: GPURenderPassDescriptor["timestampWrites"]): boolean {
    if (!this.active || !this.sunOn || !this.drawBind || !this.shadowMap) return false;
    // (two layers: the trees', the buildings' — B8: near the camera the tracer's rays stand for the buildings' layer)
    const layer = (k: number) =>
      enc.beginRenderPass({
        label: k ? "buildings' shadow map" : "trees' shadow map",
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowMap!.createView({ dimension: "2d", baseArrayLayer: k, arrayLayerCount: 1 }),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
        ...(descriptor && k === 0 ? { timestampWrites: descriptor } : {}),
      });
    const trees = layer(0);
    for (let l = 0; l < 2; l++) {
      trees.setPipeline(this.shadowPipes[l]!);
      trees.setBindGroup(0, this.drawBind);
      trees.setVertexBuffer(0, this.meshes[2 + l]!);
      trees.drawIndirect(this.draws, (LISTS + 1 + l) * 16);
    }
    trees.end();
    const buildings = layer(1);
    buildings.setPipeline(this.boxShadowPipe!);
    buildings.setBindGroup(0, this.drawBind);
    buildings.drawIndirect(this.draws, LISTS * 16);
    buildings.setPipeline(this.meshShadowPipe!);
    buildings.drawIndirect(this.draws, (LISTS + 4) * 16);
    buildings.end();
    return true;
  }

  /** Q4 S1 — the buildings in the relief's shadow cascades (terrain-raster.ts encodeSunShadow): drawn into cascade k of its
   *  pass — its viewport set — from the Sun's view of that cascade in the scenery's frame (`sun`: right, up, towards the Sun,
   *  each with its half-extent, the centre, drawn): their boxes and their triangles, as their own shadow map draws them —
   *  the city's shadows past the scenery's map's ±900 m, out to the cascades' reach. */
  private cascadeSunU: GPUBuffer[] = [];
  private cascadeBinds: { of: GPUBindGroup; bind: GPUBindGroup }[] = [];
  encodeCascade(pass: GPURenderPassEncoder, k: number, sun: Float32Array): boolean {
    if (!this.active || !this.drawBind || !this.boxShadowPipe || !this.meshShadowPipe || !this.sceneryBuf) return false;
    this.cascadeSunU[k] ??= this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: `scenery in the relief's cascade ${k}`,
    });
    this.device.queue.writeBuffer(this.cascadeSunU[k]!, 0, sun as Float32Array<ArrayBuffer>);
    if (this.cascadeBinds[k]?.of !== this.drawBind)
      this.cascadeBinds[k] = {
        of: this.drawBind,
        bind: this.device.createBindGroup({
          layout: this.drawLayout,
          entries: [
            { binding: 0, resource: { buffer: this.frameU } },
            { binding: 1, resource: { buffer: this.sceneryU } },
            { binding: 2, resource: { buffer: this.sceneryBuf } },
            { binding: 5, resource: { buffer: this.lists } },
            { binding: 6, resource: { buffer: this.cascadeSunU[k]! } },
          ],
        }),
      };
    pass.setPipeline(this.boxShadowPipe);
    pass.setBindGroup(0, this.cascadeBinds[k]!.bind);
    pass.drawIndirect(this.draws, LISTS * 16);
    pass.setPipeline(this.meshShadowPipe);
    pass.drawIndirect(this.draws, (LISTS + 4) * 16);
    return true;
  }

  stats() {
    return { ready: this.ready, error: this.error, active: this.active, encodedFrames: this.encodedFrames, cells: this.cells };
  }

  dispose() {
    for (const b of [this.frameU, this.sceneryU, this.draws, this.lists, this.sunU, ...this.meshes, ...this.cascadeSunU]) b.destroy();
  }
}
