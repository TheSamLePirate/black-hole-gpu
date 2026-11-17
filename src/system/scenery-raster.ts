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
import { LANE_M } from "./traffic";
import { TURBINE_FACING } from "./turbines";
import { NO_ID, NO_MOTION, TERRAIN_RASTER_FORMAT, TERRAIN_RASTER_ID_FORMAT, TERRAIN_RASTER_MOTION_FORMAT } from "./terrain-raster";
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
/** PLAN-J8 J8-8 lot (2): the near mesh cells' blocks — of vertices, of triangles (near-meshes.ts) */
export const NEAR_VERT_BLOCK = 4096;
export const NEAR_TRI_BLOCK = 4096;
/** the near mesh cells' records' block [vec4] (trace.wgsl nearCellFrame's 1024u) and the region's mark in the scenery buffer's last vec4 */
export const NEAR_REC_BLOCK = 1024;
export const NEAR_REGION_MARK = 7777777;
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
struct S { east: vec4f, north: vec4f, up: vec4f, cam: vec4f, lift: vec4f, misc: vec4f, pcam: vec4f, pr: vec4f, pu: vec4f, pf: vec4f, ident: vec4f };
// The surface's identity word (PLAN-J1 J1-2, system/surface-id.ts packSurfaceId): an object (its 20 low bits) of the scenery's
// publication (ident.x, its 12 low bits); 0 nothing
fn surfaceId(object: f32) -> u32 {
  let o = u32(round(max(object, 0.0)));
  return select(0u, (o & 0xFFFFFu) | ((u32(sc.ident.x) & 0xFFFu) << 20u), o > 0u);
}
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
// The trees' proxies from the Sun (their shadow map): the same shapes, the shadow lists. The proxies are circumscribed — an
// octahedron covers ~1.9 × its round crown's disc seen from above, a pyramid 1.27 × its cone's —: shadowFs keeps only the texels
// whose line to the Sun crosses the crown itself (in the crown's unit frame: the unit sphere, or the unit cone — apex at 0, its base
// disc of radius 1 at z = −1), so the shadow is the crown's, not its proxy's (PLAN-J3 J3-3, PROBLEMES « les bandes jaunes »:
// the trees' shadows nearly twice too wide). sun.c.w 2: cut (1: the proxies whole, as before — a comparison)
struct ShadowV {
  @builtin(position) clip: vec4f,
  @location(0) q: vec3f,
  @location(1) @interpolate(flat) l: vec3f,
  @location(2) @interpolate(flat) kind: u32,
};
@vertex fn shadowVs(@location(0) m: vec4f, @builtin(instance_index) ii: u32) -> ShadowV {
  let k = listsIn[LIST * CAP + ii];
  let t = treeOf(k, forestHead(u32(forestData(2u).x)));
  let p = proxyPoint(m, t);
  var o: ShadowV;
  o.clip = select(sunClip(p.xyz), vec4f(2.0, 2.0, 0.5, 1.0), p.w > 0.5);
  let part = u32(m.w);
  o.q = m.xyz;
  // (the line to the Sun in the crown's unit frame: its axes over the crown's radii)
  let L = sun.l.xyz;
  o.l = select(L / max(vec3f(t.r.x, t.r.x, t.r.z), vec3f(1e-3)), vec3f(L.xy / max(t.r.x, 1e-3), L.z / max(t.r.y, 1e-3)), part == 1u);
  o.kind = select(2u, part, part < 2u && sun.c.w > 1.5);
  return o;
}
@fragment fn shadowFs(i: ShadowV) {
  if (i.kind == 2u) { return; }
  let L = normalize(i.l);
  let q = i.q;
  if (i.kind == 0u) {
    let s = dot(q, L);
    if (dot(q, q) - s * s > 1.0) { discard; }
    return;
  }
  // (the unit cone: the base disc crossed, or its side x² + y² = z² between z −1 and 0)
  var hit = false;
  if (abs(L.z) > 1e-6) {
    let b = q.xy + ((-1.0 - q.z) / L.z) * L.xy;
    hit = dot(b, b) <= 1.0;
  }
  let a = dot(L.xy, L.xy) - L.z * L.z;
  let bq = 2.0 * (dot(q.xy, L.xy) - q.z * L.z);
  let c = dot(q.xy, q.xy) - q.z * q.z;
  if (!hit && abs(a) > 1e-6) {
    let D = bq * bq - 4.0 * a * c;
    if (D >= 0.0) {
      let r = sqrt(D);
      let z0 = q.z + ((-bq - r) / (2.0 * a)) * L.z;
      let z1 = q.z + ((-bq + r) / (2.0 * a)) * L.z;
      hit = (z0 >= -1.0 && z0 <= 0.0) || (z1 >= -1.0 && z1 <= 0.0);
    }
  } else if (!hit && abs(bq) > 1e-9) {
    let z = q.z + (-c / bq) * L.z;
    hit = z >= -1.0 && z <= 0.0;
  }
  if (!hit) { discard; }
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
  o.id = surfaceId(v.id);
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
      // (VB3: a car's glass — CAR_GLASS_BIT in its index's half — moves with it: the index below the bit)
      let r = b0 + 1u + 3u * u32(hd.x) + 2u * u32(hd.y) + 2u * (tg & 0x7fffu);
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
// (PLAN-J8 VB5b: a car's way ahead on the ground — its piece of road's direction (meshVertexAt's entry) — for its lamps' beams)
fn carAhead(vi: u32) -> vec2f {
  let t = u32(scenery[3].z) * 4u + vi;
  let tg = bitcast<u32>(scenery[(t - vi + u32(scenery[2].w) * 3u + vi / 3u) / 4u][(t - vi + u32(scenery[2].w) * 3u + vi / 3u) % 4u]);
  let b0 = u32(scenery[3].z) + u32(scenery[2].w);
  let hd = scenery[b0];
  let r = b0 + 1u + 3u * u32(hd.x) + 2u * u32(hd.y) + 2u * (tg & 0x7fffu);
  let D = scenery[r + 1u].xy - scenery[r].xy;
  return normalize(D + vec2f(1e-6, 0.0));
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
struct MO { @location(0) vis: vec4f, @location(1) mot: vec4f, @location(2) id: u32 };
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
  // (VB3: its glass 4.95 — shadeLite's dark mirror —, its body 4 + its paint)
  if (fam == 0xfff90000u) { o.leaf = select(4.0 + f32((tg & 0x7fffu) % 8u) / 8.0, 4.95, (tg & 0x8000u) != 0u); }
  if (fam == 0xfff80000u || fam == 0xfff70000u) {
    // (PLAN-J8 VB5b: each lamp seen along its beam — a headlight from ahead, its core on the axis; a tail light from behind, wider —,
    // none from the other side: its share of light in the tag's fraction (shadeLite: 1 − fraction / 0.45), the quad closed at 0)
    let head = fam == 0xfff80000u;
    let f = dot(carAhead(vi), normalize(sc.cam.xy - wp.xy)) * select(-1.0, 1.0, head);
    let vis = select(smoothstep(-0.1, 0.3, f), 0.35 * smoothstep(-0.1, 0.25, f) + 0.65 * pow(max(f, 0.0), 4.0), head);
    o.leaf = select(6.0, 5.0, head) + (1.0 - clamp(vis, 0.0, 1.0)) * 0.44;
    let t = u32(scenery[3].z) * 4u + vi;
    let id = bitcast<u32>(scenery[t / 4u][t % 4u]) & 3u;
    let px = 2.0 * u.up.w * max(v.z, 1.0) / u.image.y;
    let half = select(0.0, max(0.12, 0.75 * px), vis > 0.01);
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
  let moving = fam == 0xfff90000u || fam == 0xfff80000u || fam == 0xfff70000u || fam == 0xfffe0000u || fam == 0xfffd0000u || fam == 0xfffa0000u;
  // (the rest, still: no motion written — the history reprojects it by the camera and the depth; the rigid's analytic motion,
  // never read, retired by PLAN-J2 J2-8)
  o.mot = vec3f(0.0);
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
  // (a building's own triangles — a bridge's — carry their leaf in g, as terrainRasterLeaf reads it; a turbine, a pylon none)
  o.id = select(0u, surfaceId(o.vis.g), floor(o.vis.a / ${RASTER_CODE_SCALE}.0) >= ${RASTER_CODE.mesh}.0);
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
// ---- PLAN-J8 J8-0 (c): the envelope bench — synthetic buildings' envelopes (their oriented box, solid) culled by the GPU (the field of
// view, a pixel at least), drawn into the visibility as the far buildings' solid boxes are (boxSolidVs, meshFs: a real building's
// leaf for their material), and all into the buildings' shadow map — what the far layer of J8-4 will cost, measured before it is
// built. A measuring tool: off unless a test sets it (SceneryRaster.setBench); the image then not the scene's.
struct Env { c: vec4f, s: vec4f };
@group(1) @binding(0) var<storage, read> benchEnv: array<Env>;
@group(1) @binding(1) var<storage, read_write> benchListW: array<u32>;
// (two indirect draws: the boxes, then the quads — a far envelope under BENCH_LOD_PX drawn as one quad facing the camera)
@group(1) @binding(2) var<storage, read_write> benchDraw: array<atomic<u32>, 8>;
override BENCH_LOD_PX: f32 = 0.0;
@group(1) @binding(3) var<storage, read> benchListR: array<u32>;
// (an envelope's corner k (0/1 each axis): c — x, y, its base's z in the scene's frame, its heading —; s — half length, half width,
// height, its leaf)
fn benchCorner(e: Env, k: vec3f) -> vec3f {
  let a = (k.x * 2.0 - 1.0) * e.s.x;
  let b = (k.y * 2.0 - 1.0) * e.s.y;
  let c = cos(e.c.w);
  let s = sin(e.c.w);
  return vec3f(e.c.xy + vec2f(c, s) * a + vec2f(-s, c) * b, e.c.z + k.z * e.s.z);
}
@compute @workgroup_size(64)
fn benchCull(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let k = g.y * n.x * 64u + g.x;
  if (k >= arrayLength(&benchEnv)) { return; }
  let e = benchEnv[k];
  let R = length(vec3f(e.s.x, e.s.y, 0.5 * e.s.z)) + 0.5;
  let v = view(vec3f(e.c.xy, e.c.z + 0.5 * e.s.z));
  let tx = u.right.w;
  let ty = u.up.w;
  if (v.z < -R) { return; }
  if (abs(v.x) - tx * v.z > R * sqrt(1.0 + tx * tx)) { return; }
  if (abs(v.y) - ty * v.z > R * sqrt(1.0 + ty * ty)) { return; }
  // (a pixel across at least: its radius against a pixel's size at its distance)
  if (v.z > 0.0 && R * u.image.x < v.z * tx) { return; }
  // (its size on the image [px]: under BENCH_LOD_PX a quad, the list's other end)
  let px = R * u.image.x / max(v.z * tx, 1e-3);
  if (px < BENCH_LOD_PX) {
    let at = atomicAdd(&benchDraw[5], 1u);
    benchListW[arrayLength(&benchListW) - 1u - at] = k;
    return;
  }
  let at = atomicAdd(&benchDraw[1], 1u);
  benchListW[at] = k;
}
// a far envelope as one quad facing the camera: its centre, its widest half-side across, its height up (the view's)
@vertex fn benchQuadVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) bi: u32) -> MV {
  var o: MV;
  let e = benchEnv[benchListR[arrayLength(&benchListR) - 1u - bi]];
  let q = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = view(vec3f(e.c.xy, e.c.z));
  let top = view(vec3f(e.c.xy, e.c.z + e.s.z));
  let w = max(e.s.x, e.s.y);
  let k = q[vi];
  let v = mix(c, top, k.y) + vec3f(k.x * w, 0.0, 0.0);
  o.leaf = e.s.w + 1.0;
  o.clip = vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
  o.p = v;
  return o;
}
@vertex fn benchVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) bi: u32) -> MV {
  var o: MV;
  let e = benchEnv[benchListR[bi]];
  let c = BOX[vi];
  let v = view(benchCorner(e, vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u))));
  o.leaf = e.s.w + 1.0;
  o.clip = vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
  o.p = v;
  return o;
}
@vertex fn benchShadowVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) bi: u32) -> @builtin(position) vec4f {
  let c = BOX[vi];
  return sunClip(benchCorner(benchEnv[bi], vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u))));
}
// ---- PLAN-J8 J8-4: the far buildings' layer — the building cells (building-cells.ts: 12 words a building, in their cell's east-north
// frame, their ground over the ellipsoid) resident in a pool of blocks (building-layer.ts RecordPool), each block its cell's slot and its
// records' count, each slot its cell's frame in the scene's (4 vec4s: origin, east, north, up). Culled as the bench's envelopes are (the
// field of view, a pixel at least), those the near scene draws itself left out (within farU.y of its centre), drawn as boxes, as one
// quad under farU.z px (Sam's decision of 16 Nov 2026), all into the buildings' shadow map. Their look a building's own triangles'
// without a leaf (shadeLite, U2): the roof the orthophoto's, the walls stone with their windows.
struct FarU { blocks: u32, maskR: f32, lodPx: f32, leaf: f32, roofMark: f32, region: f32, corrA: vec2f };
@group(1) @binding(4) var<uniform> farU: FarU;
@group(1) @binding(5) var<storage, read> farRec: array<u32>;
@group(1) @binding(6) var<storage, read> farBlock: array<vec2u>;
@group(1) @binding(7) var<storage, read> farCell: array<vec4f>;
@group(1) @binding(8) var<storage, read_write> farListW: array<u32>;
@group(1) @binding(9) var<storage, read_write> farDraw: array<atomic<u32>, 8>;
@group(1) @binding(10) var<storage, read> farListR: array<u32>;
// (the near scene's measure: a place's distance to its corridor — the segment from its eye's end A through its centre to −A, the
// buildings its cap kept within maskR of it, scenery-worker capDistance; A 0: the centre's disc)
fn farMaskD(p: vec2f) -> f32 {
  let a = farU.corrA;
  let aa = dot(a, a);
  if (aa < 1.0) { return length(p); }
  let t = clamp(dot(p, a) / aa, -1.0, 1.0);
  return length(p - t * a);
}
// (a record k of the pool as the bench's envelope: its base in the scene's frame, its heading there; its half-sides, its height to its
// roof's top; w: its block's records count 0 — none)
fn farEnv(k: u32) -> Env {
  var e: Env;
  let blk = farBlock[k >> 8u];
  if ((k & 255u) >= blk.y) { e.s = vec4f(0.0); return e; }
  let o = 12u * k;
  let east = bitcast<f32>(farRec[o]);
  let north = bitcast<f32>(farRec[o + 1u]);
  let ground = bitcast<f32>(farRec[o + 2u]);
  let eave = bitcast<f32>(farRec[o + 3u]);
  let roof = bitcast<f32>(farRec[o + 4u]);
  let sides = farRec[o + 5u];
  let head = f32(farRec[o + 6u] & 0xffffu) / 65535.0 * 3.14159265;
  let c = 4u * blk.x;
  let O = farCell[c];
  let E4 = farCell[c + 1u];
  let N4 = farCell[c + 2u];
  let U4 = farCell[c + 3u];
  let E = E4.xyz;
  let N = N4.xyz;
  let U = U4.xyz;
  // (its ground the source's when it gives one — RecordFlag.GroundKnown, the BD TOPO's —; else the relief as drawn under its cell, a
  // plane through it — its height at the origin E.w, its slopes east N.w and north U.w: building-far.ts — Overture's, OSM's)
  let known = ((farRec[o + 6u] >> 24u) & 8u) != 0u;
  let g = select(E4.w + N4.w * east + U4.w * north, ground, known);
  let p = O.xyz + E * east + N * north + U * g;
  // (its long side's direction in the scene's horizontal plane)
  let d = E * cos(head) + N * sin(head);
  e.c = vec4f(p, atan2(d.y, d.x));
  e.s = vec4f(f32(sides & 0xffffu) * 0.1, f32(sides >> 16u) * 0.1, eave + roof, farU.leaf);
  return e;
}
// (PLAN-J8 J8-A: a far building's own materials for shadeLite — its roof's and its walls' (building-cells.ts bytes 28, 29), its use
// (30), a seed of its own, the region's (farU.region: roofs.ts regionOf, FAR_REGIONS) — packed in the visibility's g where a near
// building's leaf goes, negative — its bit 23 set, exact in its f32 —: the mesh's code itself whole (a fraction of it read as the
// ground's normal's bits, the night's far quads lit white — 16 Nov 2026): trace.wgsl farRoofAlbedo, farWallAlbedo — terrainRasterFarMat)
fn farMat(k: u32) -> f32 {
  let w = farRec[12u * k + 7u];
  let seed = u32(farHash(k ^ 0x9e3779b9u) * 255.0);
  let m = (w & 15u) | (((w >> 8u) & 15u) << 4u) | (((w >> 16u) & 15u) << 8u) | (seed << 12u) | ((u32(farU.region) & 7u) << 20u);
  return -f32(m | 0x800000u);
}
// (a record's walls' and roof's heights over its ground [m], its roof's shape — building-cells.ts ROOF_CODES: 0 flat, 1 gabled, 2 hipped,
// 3 mansard, 4 shed)
fn farParts(k: u32) -> vec3f {
  let o = 12u * k;
  return vec3f(bitcast<f32>(farRec[o + 3u]), bitcast<f32>(farRec[o + 4u]), f32((farRec[o + 6u] >> 16u) & 255u));
}
// A far building's vertex vi (0–53): its walls a box up to the eave (0–35), its roof (36–53) — two slopes and two ends from the eaves
// to a ridge along its long side: the whole side's for a gabled roof (and the others but a hipped one: a mansard's or a shed's drawn
// so at this distance), the half-width short of each end for a hipped one; flat: none (its triangles at the eave, degenerate)
fn farCorner(e: Env, parts: vec3f, vi: u32) -> vec3f {
  if (vi < 36u) {
    var w = e;
    w.s.z = parts.x;
    let c = BOX[vi];
    return benchCorner(w, vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u)));
  }
  let L = e.s.x;
  let W = e.s.y;
  let eave = parts.x;
  let roof = select(0.0, parts.y, parts.z > 0.5);
  let R = select(L, max(L - W, 0.0), parts.z > 1.5 && parts.z < 2.5);
  // (the roof's points: eave corners 0–3 (−L,−W) (L,−W) (L,W) (−L,W), ridge ends 4–5 (−R,0) (R,0))
  let tri = array<u32, 18>(3u, 2u, 5u, 3u, 5u, 4u, 0u, 5u, 1u, 0u, 4u, 5u, 1u, 5u, 2u, 0u, 3u, 4u);
  let i = tri[vi - 36u];
  var q = vec3f(0.0);
  if (i == 0u) { q = vec3f(-L, -W, eave); }
  else if (i == 1u) { q = vec3f(L, -W, eave); }
  else if (i == 2u) { q = vec3f(L, W, eave); }
  else if (i == 3u) { q = vec3f(-L, W, eave); }
  else if (i == 4u) { q = vec3f(-R, 0.0, eave + roof); }
  else { q = vec3f(R, 0.0, eave + roof); }
  let c = cos(e.c.w);
  let s = sin(e.c.w);
  return vec3f(e.c.xy + vec2f(c, s) * q.x + vec2f(-s, c) * q.y, e.c.z + q.z);
}
// a far building's stable hash in [0, 1) — its record's place in the pool: the same from frame to frame
fn farHash(k: u32) -> f32 {
  var x = k * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return f32((x >> 22u) ^ x) / 4294967296.0;
}
@compute @workgroup_size(64)
fn farCull(@builtin(global_invocation_id) g: vec3u, @builtin(num_workgroups) n: vec3u) {
  let k = g.y * n.x * 64u + g.x;
  if (k >= farU.blocks * 256u) { return; }
  let e = farEnv(k);
  if (e.s.z <= 0.0) { return; }
  // (PLAN-J8 J8-8: its cell drawn as the near meshes' — its share < 0, building-far.ts hidden —: none of it here)
  if (farCell[4u * farBlock[k >> 8u].x].w < 0.0) { return; }
  // (the near scene's own buildings: within its reach of its corridor — farMaskD, its cap's own measure —, not drawn twice; past it a
  // band of 300 m where each far one stands from its own distance — the edge a scatter, not a line)
  let h = farHash(k);
  if (farMaskD(e.c.xy) < farU.maskR + 300.0 * h) { return; }
  let R = length(vec3f(e.s.x, e.s.y, 0.5 * e.s.z)) + 0.5;
  let v = view(vec3f(e.c.xy, e.c.z + 0.5 * e.s.z));
  let tx = u.right.w;
  let ty = u.up.w;
  if (v.z < -R) { return; }
  if (abs(v.x) - tx * v.z > R * sqrt(1.0 + tx * tx)) { return; }
  if (abs(v.y) - ty * v.z > R * sqrt(1.0 + ty * ty)) { return; }
  if (v.z > 0.0 && R * u.image.x < v.z * tx) { return; }
  let px = R * u.image.x / max(v.z * tx, 1e-3);
  // (its own threshold, 0.75–1.25 of the quads': the boxes give way to quads over a band of distances, building by building)
  if (px < farU.lodPx * (0.75 + 0.5 * h)) {
    let at = atomicAdd(&farDraw[5], 1u);
    farListW[arrayLength(&farListW) - 1u - at] = k;
    return;
  }
  let at = atomicAdd(&farDraw[1], 1u);
  farListW[at] = k;
}
@vertex fn farVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) bi: u32) -> MV {
  var o: MV;
  let k = farListR[bi];
  let e = farEnv(k);
  let v = view(farCorner(e, farParts(k), vi));
  // (no leaf — the near scene's records are not theirs —: its own materials in its place, farMat — shadeLite's U2 look with them: its
  // roof's and its walls' colours, its windows lit at night; none with the lever off — farU.roofMark 0: g 0, a building without a leaf)
  o.leaf = select(0.0, farMat(k), farU.roofMark > 0.25);
  // (the mesh's own code: a building's triangles — its materials in g, negative: terrainRasterFar)
  o.bridge = 0.0;
  // (its cell's fade-in — 0 → 1 over a second once it is put: farFs keeps that share of its pixels, a scatter)
  o.pyl = vec4f(0.0, 0.0, 0.0, farCell[4u * farBlock[k >> 8u].x].w);
  o.clip = vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
  o.p = v;
  return o;
}
@vertex fn farQuadVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) bi: u32) -> MV {
  var o: MV;
  let rk = farListR[arrayLength(&farListR) - 1u - bi];
  let e = farEnv(rk);
  let q = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = view(e.c.xyz);
  let top = view(vec3f(e.c.xy, e.c.z + e.s.z));
  let k = q[vi];
  let v = mix(c, top, k.y) + vec3f(k.x * max(e.s.x, e.s.y), 0.0, 0.0);
  // (no leaf — the near scene's records are not theirs —: its own materials in its place, farMat — shadeLite's U2 look with them: its
  // roof's and its walls' colours, its windows lit at night; none with the lever off — farU.roofMark 0: g 0, a building without a leaf)
  o.leaf = select(0.0, farMat(rk), farU.roofMark > 0.25);
  // (the mesh's own code: a building's triangles — its materials in g, negative: terrainRasterFar)
  o.bridge = 0.0;
  // (its cell's fade-in — 0 → 1 over a second once it is put: farFs keeps that share of its pixels, a scatter)
  o.pyl = vec4f(0.0, 0.0, 0.0, farCell[4u * farBlock[rk >> 8u].x].w);
  o.clip = vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
  o.p = v;
  return o;
}
// the far buildings' fragments: their cell's fade-in a scatter of its pixels, then the meshes' own (meshFs)
@fragment fn farFs(v: MV) -> MO {
  let r = fract(sin(dot(floor(v.clip.xy), vec2f(12.9898, 78.233))) * 43758.547);
  if (r >= v.pyl.w) { discard; }
  var w = v;
  w.pyl = vec4f(0.0);
  // (meshFs's own: an entry point is not called from another)
  var o: MO;
  o.vis = meshShade(w);
  o.mot = vec4f(w.mot, 0.0);
  // (its identity a building's without a leaf: g holds its materials, not a leaf)
  o.id = select(0u, surfaceId(0.0), floor(o.vis.a / ${RASTER_CODE_SCALE}.0) >= ${RASTER_CODE.mesh}.0);
  return o;
}
// ---- PLAN-J8 J8-L: the far street lamps — the street cells' lamps (street-cells.ts) round the eye, in a pool of blocks of 256 as the
// far buildings', each cell its frame in the scene's (its drawn ground's plane in its axes' w — street-far.ts); a lamp's head drawn as the
// near ones' (meshVs: the turbines' code, its tag 7 — shadeLite lights it at night), opened towards the camera to a pixel and a half at
// least; none within maskR of the scene's centre (the near scene's own lamps: its kept reach — scenery-worker.ts lampReachM), none past
// reach, none by day (lampU.on); the far cars none within carMaskR of it (its own cars' — trafficReachM), by day drawn as their bodies
struct LampU { blocks: u32, maskR: f32, reach: f32, on: f32, carBlocks: u32, carMaskR: f32, _b: u32, _c: u32 };
@group(1) @binding(11) var<uniform> lampU: LampU;
@group(1) @binding(12) var<storage, read> lampRec: array<vec4f>;
@group(1) @binding(13) var<storage, read> lampBlock: array<vec2u>;
@group(1) @binding(14) var<storage, read> lampCell: array<vec4f>;
@group(1) @binding(15) var<storage, read_write> lampListW: array<u32>;
@group(1) @binding(16) var<storage, read_write> lampDraw: array<atomic<u32>, 4>;
@group(1) @binding(17) var<storage, read> lampListR: array<u32>;
// (a lamp k's head in the view's frame; w 0: none — an empty slot)
// (a lamp k's head in the scene's frame — its centre the near scene's —; w 0: none — an empty slot)
fn lampWorld(k: u32) -> vec4f {
  let blk = lampBlock[k >> 8u];
  if ((k & 255u) >= blk.y) { return vec4f(0.0); }
  let r = lampRec[k];
  let c = 4u * blk.x;
  let O = lampCell[c];
  let E4 = lampCell[c + 1u];
  let N4 = lampCell[c + 2u];
  let U4 = lampCell[c + 3u];
  let g = E4.w + N4.w * r.x + U4.w * r.y;
  return vec4f(O.xyz + E4.xyz * r.x + N4.xyz * r.y + U4.xyz * (g + r.z), 1.0);
}
fn lampAt(k: u32) -> vec4f {
  let w = lampWorld(k);
  return vec4f(view(w.xyz), w.w);
}
// (the lamps in view: past the near scene's own, within reach, before the camera and in its field — each listed, the draw's instances
// counted: its indirect draw)
@compute @workgroup_size(64)
fn farLampCull(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) n: vec3u) {
  let k = gid.y * n.x * 64u + gid.x;
  if (lampU.on < 0.5 || k >= lampU.blocks * 256u) { return; }
  let p = lampWorld(k);
  if (p.w < 0.5) { return; }
  let v = view(p.xyz);
  let dist = length(v);
  // (past the near scene's own lamps — round its centre, as it keeps them; their reach's last sixth a scatter — each lamp its own
  // edge, farHash: no line at 12 km where the ground's baked lights and the far buildings' glow take over)
  if (length(p.xy) < lampU.maskR || dist > lampU.reach * (0.83 + 0.17 * farHash(k ^ 0x5bd1e995u)) || v.z <= 1.0) { return; }
  let m = 2.0 * u.up.w * v.z / u.image.y;
  if (abs(v.x) - u.right.w * v.z > m || abs(v.y) - u.up.w * v.z > m) { return; }
  let at = atomicAdd(&lampDraw[1], 1u);
  lampListW[at] = k;
}
@vertex fn farLampVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) bi: u32) -> MV {
  var o: MV;
  var v = lampAt(lampListR[bi]).xyz;
  let px = 2.0 * u.up.w * max(v.z, 1.0) / u.image.y;
  let half = max(0.3, 0.75 * px);
  let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  v = v + vec3f(q[vi] * half, 0.0);
  // (its light kept to the head's own: opened to 1.5 px, its glow a share of a pixel's — the square root of its area's share, seen
  // still —, in the tag's fraction (7 + 0.45 × (1 − share): shadeLite's lamp reads it); drawn whole a pixel's glow, the far town was
  // twice the ground's lights within 12 km — 16 Nov 2026)
  o.leaf = 7.0 + 0.45 * (1.0 - sqrt(min(0.09 / (half * half), 1.0)));
  o.bridge = 2.0;
  o.pyl = vec4f(0.0, 0.0, 0.0, 1.0);
  o.clip = vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
  o.p = v;
  return o;
}
// (PLAN-J8 J8-L: the far cars — on the busy roads' segments (traffic.ts ROAD_TRAFFIC's classes) of the same cells, each a record: its
// lane's start and its run (m, the cell's frame: start.xy, run.xy), its phase and its speed [m/s]; driven by the game's clock as the near
// ones (meshVertexAt: sc.north.w), their lane LANE_M to the right; at night a point — its headlights white towards the camera, its
// tail lights red going away (shadeLite's tags 5 and 6))
@group(1) @binding(18) var<storage, read> carRec: array<vec4f>;
@group(1) @binding(19) var<storage, read> carBlock: array<vec2u>;
@group(1) @binding(20) var<storage, read_write> carListW: array<u32>;
@group(1) @binding(21) var<storage, read_write> carDraw: array<atomic<u32>, 4>;
@group(1) @binding(22) var<storage, read> carListR: array<u32>;
// (a car k: its place in the view's frame (w 1), and whether it comes towards the camera (its headlights) — x of the second)
// (a far car k: its road point under it in the scene's frame (w 0: none — an empty slot), its way ahead and the cell's up there)
struct FarCar { w: vec4f, ahead: vec3f, up: vec3f };
fn carAt(k: u32) -> FarCar {
  var o = FarCar(vec4f(0.0), vec3f(0.0), vec3f(0.0));
  let blk = carBlock[k >> 8u];
  if ((k & 255u) >= blk.y) { return o; }
  let a = carRec[2u * k];
  let b = carRec[2u * k + 1u];
  let L = max(length(a.zw), 1.0);
  let s = fract(b.x + sc.north.w * b.y / L);
  let d = a.zw / L;
  let xy = a.xy + a.zw * s + vec2f(d.y, -d.x) * ${LANE_M};
  let c = 4u * blk.x;
  let O = lampCell[c];
  let E4 = lampCell[c + 1u];
  let N4 = lampCell[c + 2u];
  let U4 = lampCell[c + 3u];
  let g = E4.w + N4.w * xy.x + U4.w * xy.y;
  o.w = vec4f(O.xyz + E4.xyz * xy.x + N4.xyz * xy.y + U4.xyz * g, 1.0);
  o.ahead = E4.xyz * d.x + N4.xyz * d.y;
  o.up = U4.xyz;
  return o;
}
@compute @workgroup_size(64)
fn farCarCull(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) n: vec3u) {
  let k = gid.y * n.x * 64u + gid.x;
  if (k >= lampU.carBlocks * 256u) { return; }
  let c = carAt(k);
  if (c.w.w < 0.5) { return; }
  let v = view(c.w.xyz + c.up * 0.8);
  let dist = length(v);
  // (past the near scene's own cars — round its centre, as it keeps them —, within reach (its last sixth a scatter); by day its body
  // under half a pixel left out — a speck the image would not hold)
  if (length(c.w.xy) < lampU.carMaskR || dist > lampU.reach * (0.83 + 0.17 * farHash(k ^ 0x27d4eb2du)) || v.z <= 1.0) { return; }
  let m = 2.0 * u.up.w * v.z / u.image.y;
  if (lampU.on < 0.5 && 4.4 < 0.5 * m) { return; }
  if (abs(v.x) - u.right.w * v.z > m + 3.0 || abs(v.y) - u.up.w * v.z > m + 3.0) { return; }
  let at = atomicAdd(&carDraw[1], 1u);
  carListW[at] = k;
}
// (a far car: at night its lamp — a point, white coming, red going (shadeLite's 5, 6), opened to a pixel and a half, its light kept to
// its own share —; by day its body as the near ones' (traffic.ts carMesh: 4.4 × 1.8 m, 0.3–1.5 m up), painted as theirs (4 + paint / 8))
@vertex fn farCarVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) bi: u32) -> MV {
  var o: MV;
  let k = carListR[bi];
  let c = carAt(k);
  o.bridge = 2.0;
  o.pyl = vec4f(0.0, 0.0, 0.0, 1.0);
  var v: vec3f;
  if (lampU.on > 0.5) {
    v = view(c.w.xyz + c.up * 0.8);
    let ahead = view(c.w.xyz + c.up * 0.8 + c.ahead) - v;
    let px = 2.0 * u.up.w * max(v.z, 1.0) / u.image.y;
    let half = max(0.4, 0.75 * px);
    let q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
    v = v + vec3f(q[min(vi, 5u)] * half, 0.0);
    // (its light kept to its lamps' own as the far lamps' — the share in the tag's fraction, 0.45 × (1 − share))
    o.leaf = select(6.0, 5.0, dot(ahead, -v) > 0.0) + 0.45 * (1.0 - sqrt(min(0.16 / (half * half), 1.0)));
    // (the body's other vertices: none at night)
    if (vi >= 6u) { v = vec3f(0.0, 0.0, -1.0); }
  } else {
    let ix = array<u32, 36>(0u, 2u, 6u, 0u, 6u, 4u, 1u, 5u, 7u, 1u, 7u, 3u, 0u, 4u, 5u, 0u, 5u, 1u, 2u, 3u, 7u, 2u, 7u, 6u, 0u, 1u, 3u, 0u, 3u,
      2u, 4u, 6u, 7u, 4u, 7u, 5u);
    let q = ix[vi];
    let side = normalize(cross(c.ahead, c.up));
    let p = c.w.xyz + c.ahead * select(-2.2, 2.2, (q & 1u) == 1u) + side * select(-0.9, 0.9, (q & 2u) == 2u) +
      c.up * select(0.3, 1.5, (q & 4u) == 4u);
    v = view(p);
    o.leaf = 4.0 + f32(u32(farHash(k ^ 0x9e3779b9u) * 8.0) % 8u) / 8.0;
  }
  o.clip = vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
  o.p = v;
  return o;
}
// ---- PLAN-J8 J8-8 lot (2): the near buildings' mesh cells (near-meshes.ts — kerr-mesh-v1, mesh-cells.ts): each resident cell's
// vertices (its east, north [m], height over the ellipsoid — its building set on the relief drawn) in blocks of NEAR_VERT_BLOCK, its
// triangles (their vertices' indices in the pool, w: its leaf's record — lot 2b) in blocks of NEAR_TRI_BLOCK, each block its cell's
// slot and its count; each slot its frame in the scene's (building-layer.ts cellFrameInScene). Drawn into the visibility as the near
// scene's own triangles (meshFs: the building mesh's code); none past a block's count
@group(1) @binding(23) var<storage, read> nmPos: array<vec4f>;
@group(1) @binding(24) var<storage, read> nmTri: array<vec4u>;
@group(1) @binding(25) var<storage, read> nmBlk: array<vec2u>;
@group(1) @binding(26) var<storage, read> nmCell: array<vec4f>;
@vertex fn nearCellVs(@builtin(vertex_index) vi: u32) -> MV {
  var o: MV;
  let tri = vi / 3u;
  let blk = nmBlk[tri / ${NEAR_TRI_BLOCK}u];
  o.pyl = vec4f(0.0, 0.0, 0.0, 1.0);
  o.mot = vec3f(0.0);
  o.bridge = 0.0;
  o.leaf = 0.0;
  if (tri % ${NEAR_TRI_BLOCK}u >= blk.y) {
    o.clip = vec4f(0.0, 0.0, 0.0, -1.0);
    o.p = vec3f(0.0);
    return o;
  }
  let t = nmTri[tri];
  let k = vi % 3u;
  let q = nmPos[select(select(t.z, t.y, k == 1u), t.x, k == 0u)];
  let c = 4u * blk.x;
  let v = view(nmCell[c].xyz + nmCell[c + 1u].xyz * q.x + nmCell[c + 2u].xyz * q.y + nmCell[c + 3u].xyz * q.z);
  // (lot 2b: its leaf — its record in the scenery buffer's region past the scene's (the buffer's last vec4: NEAR_REGION_MARK, …,
  // the records' first vec4 — near-meshes.ts), counted from the scene's geometries as the scene's own leaves: rasterBuilding reads it)
  let tail = scenery[arrayLength(&scenery) - 1u];
  if (t.w != 0xffffffffu && tail.x == ${NEAR_REGION_MARK}.0) { o.leaf = f32(u32(tail.w) + t.w - u32(scenery[0].y) + 1u); }
  o.clip = vec4f(v.x / u.right.w + u.output.z * v.z, v.y / u.up.w + u.output.w * v.z, u.forward.w, v.z);
  o.p = v;
  return o;
}
// (lot 3: the same triangles from the Sun — the buildings' shadow map and the relief's cascades, as the near scene's own: meshShadowVs)
@vertex fn nearCellShadowVs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let tri = vi / 3u;
  let blk = nmBlk[tri / ${NEAR_TRI_BLOCK}u];
  if (tri % ${NEAR_TRI_BLOCK}u >= blk.y) { return vec4f(0.0, 0.0, 0.0, -1.0); }
  let t = nmTri[tri];
  let k = vi % 3u;
  let q = nmPos[select(select(t.z, t.y, k == 1u), t.x, k == 0u)];
  let c = 4u * blk.x;
  return sunClip(nmCell[c].xyz + nmCell[c + 1u].xyz * q.x + nmCell[c + 2u].xyz * q.y + nmCell[c + 3u].xyz * q.z);
}
@vertex fn farShadowVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) bi: u32) -> @builtin(position) vec4f {
  let e = farEnv(bi);
  if (e.s.z <= 0.0 || farMaskD(e.c.xy) < farU.maskR || farCell[4u * farBlock[bi >> 8u].x].w < 0.0) { return vec4f(2.0, 2.0, 0.5, 1.0); }
  return sunClip(farCorner(e, farParts(bi), vi));
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
  private sunData = new Float32Array(16);
  private sunNone = new Float32Array(16);
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
    this.sceneryU = device.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
        // (the fragments read it too: the identity's generation, ident.x — PLAN-J1 J1-2)
        { binding: 1, visibility: Vx | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
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
              { format: TERRAIN_RASTER_ID_FORMAT },
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
          targets: [{ format: TERRAIN_RASTER_FORMAT, writeMask: GPUColorWrite.ALPHA }, NO_MOTION, NO_ID],
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
          targets: [{ format: TERRAIN_RASTER_FORMAT, writeMask: GPUColorWrite.ALPHA }, NO_MOTION, NO_ID],
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
          targets: [{ format: TERRAIN_RASTER_FORMAT }, { format: TERRAIN_RASTER_MOTION_FORMAT }, { format: TERRAIN_RASTER_ID_FORMAT }],
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
          targets: [{ format: TERRAIN_RASTER_FORMAT }, { format: TERRAIN_RASTER_MOTION_FORMAT }, { format: TERRAIN_RASTER_ID_FORMAT }],
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
          // (the crown's own silhouette from the Sun: the proxy's texels outside it discarded — shadowFs)
          fragment: { module: this.module, entryPoint: "shadowFs", targets: [] },
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

  /** PLAN-J8 J8-0 (c): the envelope bench (a measuring tool — setBench): its envelopes, list, indirect draw, pipelines; null off */
  private bench: {
    count: number;
    env: GPUBuffer;
    list: GPUBuffer;
    draw: GPUBuffer;
    cullBind: GPUBindGroup;
    drawBind: GPUBindGroup;
  } | null = null;
  private benchPipes: {
    cull: GPUComputePipeline;
    vis: GPURenderPipeline;
    shadow: GPURenderPipeline;
    quad: GPURenderPipeline;
    lodPx: number;
  } | null = null;
  /** the bench's parts left out, to measure each (1 its culling, 2 its visibility, 4 its shadow) */
  benchSkip = 0;
  /**
   * The envelope bench (PLAN-J8 J8-0 (c)): `env` 8 floats an envelope — x, y, its base's z in the scene's frame [m], its heading [rad];
   * half length, half width, height [m], a building's leaf (its material) —; null: off, its buffers let go. Its pipelines made at its
   * first use (awaited: the bench draws once they are in).
   */
  async setBench(env: Float32Array | null, lodPx = 0): Promise<void> {
    if (this.bench) {
      for (const b of [this.bench.env, this.bench.list, this.bench.draw]) b.destroy();
      this.bench = null;
    }
    if (!env || env.length < 8) return;
    const d = this.device;
    // (another LOD threshold: the culling's constant — its pipelines made again)
    if (this.benchPipes && this.benchPipes.lodPx !== lodPx) this.benchPipes = null;
    if (!this.benchPipes) {
      const C = GPUShaderStage.COMPUTE,
        V = GPUShaderStage.VERTEX;
      const cullL = d.createBindGroupLayout({
        label: "envelope bench cull",
        entries: [
          { binding: 0, visibility: C, buffer: { type: "read-only-storage" } },
          { binding: 1, visibility: C, buffer: { type: "storage" } },
          { binding: 2, visibility: C, buffer: { type: "storage" } },
        ],
      });
      const drawL = d.createBindGroupLayout({
        label: "envelope bench draw",
        entries: [
          { binding: 0, visibility: V, buffer: { type: "read-only-storage" } },
          { binding: 3, visibility: V, buffer: { type: "read-only-storage" } },
        ],
      });
      const [cull, vis, shadow, quad] = await Promise.all([
        d.createComputePipelineAsync({
          layout: d.createPipelineLayout({ bindGroupLayouts: [this.cullLayout, cullL] }),
          compute: { module: this.module, entryPoint: "benchCull", constants: { BENCH_LOD_PX: lodPx } },
        }),
        d.createRenderPipelineAsync({
          layout: d.createPipelineLayout({ bindGroupLayouts: [this.drawLayout, drawL] }),
          vertex: { module: this.module, entryPoint: "benchVs" },
          fragment: {
            module: this.module,
            entryPoint: "meshFs",
            targets: [{ format: TERRAIN_RASTER_FORMAT }, { format: TERRAIN_RASTER_MOTION_FORMAT }, { format: TERRAIN_RASTER_ID_FORMAT }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
        }),
        d.createRenderPipelineAsync({
          layout: d.createPipelineLayout({ bindGroupLayouts: [this.drawLayout, drawL] }),
          vertex: { module: this.module, entryPoint: "benchShadowVs" },
          primitive: { topology: "triangle-list", cullMode: "none" },
          depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
        }),
        d.createRenderPipelineAsync({
          layout: d.createPipelineLayout({ bindGroupLayouts: [this.drawLayout, drawL] }),
          vertex: { module: this.module, entryPoint: "benchQuadVs" },
          fragment: {
            module: this.module,
            entryPoint: "meshFs",
            targets: [{ format: TERRAIN_RASTER_FORMAT }, { format: TERRAIN_RASTER_MOTION_FORMAT }, { format: TERRAIN_RASTER_ID_FORMAT }],
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
        }),
      ]);
      this.benchPipes = { cull, vis, shadow, quad, lodPx };
      this.benchLayouts = { cull: cullL, draw: drawL };
    }
    const count = Math.floor(env.length / 8);
    const S = GPUBufferUsage.STORAGE;
    const envB = d.createBuffer({ size: count * 32, usage: S | GPUBufferUsage.COPY_DST, label: "envelope bench" });
    d.queue.writeBuffer(envB, 0, env.subarray(0, count * 8) as Float32Array<ArrayBuffer>);
    const list = d.createBuffer({ size: count * 4, usage: S, label: "envelope bench list" });
    const draw = d.createBuffer({
      size: 32,
      usage: S | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: "envelope bench draw",
    });
    this.bench = {
      count,
      env: envB,
      list,
      draw,
      cullBind: d.createBindGroup({
        layout: this.benchLayouts!.cull,
        entries: [
          { binding: 0, resource: { buffer: envB } },
          { binding: 1, resource: { buffer: list } },
          { binding: 2, resource: { buffer: draw } },
        ],
      }),
      drawBind: d.createBindGroup({
        layout: this.benchLayouts!.draw,
        entries: [
          { binding: 0, resource: { buffer: envB } },
          { binding: 3, resource: { buffer: list } },
        ],
      }),
    };
  }
  private benchLayouts: { cull: GPUBindGroupLayout; draw: GPUBindGroupLayout } | null = null;

  // ---- PLAN-J8 J8-4: the far buildings' layer (building-far.ts decides what is resident; this holds it on the GPU and draws it)
  private far: {
    blocks: number;
    slots: number;
    u: GPUBuffer;
    rec: GPUBuffer;
    block: GPUBuffer;
    cell: GPUBuffer;
    list: GPUBuffer;
    draw: GPUBuffer;
    cullBind: GPUBindGroup;
    drawBind: GPUBindGroup;
    pipes: { cull: GPUComputePipeline; vis: GPURenderPipeline; quad: GPURenderPipeline; shadow: GPURenderPipeline } | null;
  } | null = null;
  private farUData = new ArrayBuffer(32);
  /** the far layer drawing (its pipelines in, a cell resident) — and its parts left out to measure them (1 culling, 2 visibility, 4 shadow) */
  farOn = true;
  farSkip = 0;
  /**
   * The far layer's GPU pool made: `blocks` blocks of 256 records (48 bytes each), `slots` cells' frames; its pipelines compiled
   * (awaited). Made once; `farRelease` lets it go.
   */
  async farInit(blocks: number, slots: number): Promise<void> {
    if (this.far) return;
    const d = this.device;
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const C = GPUShaderStage.COMPUTE,
      V = GPUShaderStage.VERTEX;
    const cullL = d.createBindGroupLayout({
      label: "far buildings cull",
      entries: [
        { binding: 4, visibility: C, buffer: { type: "uniform" } },
        { binding: 5, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 7, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 8, visibility: C, buffer: { type: "storage" } },
        { binding: 9, visibility: C, buffer: { type: "storage" } },
      ],
    });
    const drawL = d.createBindGroupLayout({
      label: "far buildings draw",
      entries: [
        { binding: 4, visibility: V, buffer: { type: "uniform" } },
        { binding: 5, visibility: V, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: V, buffer: { type: "read-only-storage" } },
        { binding: 7, visibility: V, buffer: { type: "read-only-storage" } },
        { binding: 10, visibility: V, buffer: { type: "read-only-storage" } },
      ],
    });
    const u = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: "far buildings params" });
    const rec = d.createBuffer({ size: Math.max(16, blocks * 256 * 48), usage: S, label: "far buildings records" });
    const block = d.createBuffer({ size: Math.max(16, blocks * 8), usage: S, label: "far buildings blocks" });
    const cell = d.createBuffer({ size: Math.max(64, slots * 64), usage: S, label: "far buildings cells" });
    const list = d.createBuffer({ size: Math.max(16, blocks * 256 * 4), usage: GPUBufferUsage.STORAGE, label: "far buildings list" });
    const draw = d.createBuffer({
      size: 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: "far buildings draws",
    });
    const visTargets = [{ format: TERRAIN_RASTER_FORMAT }, { format: TERRAIN_RASTER_MOTION_FORMAT }, { format: TERRAIN_RASTER_ID_FORMAT }];
    const drawLayout = d.createPipelineLayout({ bindGroupLayouts: [this.drawLayout, drawL] });
    const [cull, vis, quad, shadow] = await Promise.all([
      d.createComputePipelineAsync({
        layout: d.createPipelineLayout({ bindGroupLayouts: [this.cullLayout, cullL] }),
        compute: { module: this.module, entryPoint: "farCull" },
      }),
      d.createRenderPipelineAsync({
        layout: drawLayout,
        vertex: { module: this.module, entryPoint: "farVs" },
        fragment: { module: this.module, entryPoint: "farFs", targets: visTargets },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
      }),
      d.createRenderPipelineAsync({
        layout: drawLayout,
        vertex: { module: this.module, entryPoint: "farQuadVs" },
        fragment: { module: this.module, entryPoint: "farFs", targets: visTargets },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
      }),
      d.createRenderPipelineAsync({
        layout: drawLayout,
        vertex: { module: this.module, entryPoint: "farShadowVs" },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
      }),
    ]);
    this.far = {
      blocks,
      slots,
      u,
      rec,
      block,
      cell,
      list,
      draw,
      pipes: { cull, vis, quad, shadow },
      cullBind: d.createBindGroup({
        layout: cullL,
        entries: [
          { binding: 4, resource: { buffer: u } },
          { binding: 5, resource: { buffer: rec } },
          { binding: 6, resource: { buffer: block } },
          { binding: 7, resource: { buffer: cell } },
          { binding: 8, resource: { buffer: list } },
          { binding: 9, resource: { buffer: draw } },
        ],
      }),
      drawBind: d.createBindGroup({
        layout: drawL,
        entries: [
          { binding: 4, resource: { buffer: u } },
          { binding: 5, resource: { buffer: rec } },
          { binding: 6, resource: { buffer: block } },
          { binding: 7, resource: { buffer: cell } },
          { binding: 10, resource: { buffer: list } },
        ],
      }),
    };
    this.farParams(0, 0, 8);
  }
  get farReady() {
    return !!this.far?.pipes;
  }
  /** a cell's records into its blocks (their words, 12 a building, in the blocks' order), each block its slot and its count */
  farUpload(blocks: readonly number[], words: Uint32Array, slot: number) {
    const F = this.far;
    if (!F) return;
    const q = this.device.queue;
    const records = words.length / 12;
    for (const [i, b] of blocks.entries()) {
      const n = Math.max(0, Math.min(256, records - i * 256));
      if (n > 0) q.writeBuffer(F.rec, b * 256 * 48, words as Uint32Array<ArrayBuffer>, i * 256 * 12, n * 12);
      q.writeBuffer(F.block, b * 8, new Uint32Array([slot, n]));
    }
  }
  /** blocks let go: their counts 0 (drawn no more) */
  farClear(blocks: readonly number[]) {
    const F = this.far;
    if (!F) return;
    for (const b of blocks) this.device.queue.writeBuffer(F.block, b * 8, new Uint32Array([0, 0]));
  }
  /** a cell's frame in the scene's (building-layer.ts cellFrameInScene: 16 floats) */
  farFrame(slot: number, frame: Float32Array) {
    if (this.far) this.device.queue.writeBuffer(this.far.cell, slot * 64, frame as Float32Array<ArrayBuffer>);
  }
  /** the near scene's reach left to it [m], a building's leaf (the material, for now), the quads' threshold [px]; the far roofs' mark
   *  (0.5: terrainRasterFar — their own materials, farMat; 0: a near building's without a leaf, generic — a lever, J8-A); the
   *  near scene's corridor's end from its centre [m east, m north] (the mask measured as its cap is, farMaskD; null: a disc); the
   *  region's index (FAR_REGIONS: its roofs' default material and its colours) */
  farParams(maskR: number, leaf: number, lodPx: number, roofMark = 0.5, corridor: readonly [number, number] | null = null, region = 0) {
    if (!this.far) return;
    const v = new DataView(this.farUData);
    v.setUint32(0, this.far.blocks, true);
    v.setFloat32(4, maskR, true);
    v.setFloat32(8, lodPx, true);
    v.setFloat32(12, Math.max(0, leaf), true);
    v.setFloat32(16, roofMark, true);
    v.setFloat32(20, region, true);
    // (vec2f at 24: the near scene's corridor's end, farMaskD)
    v.setFloat32(24, corridor?.[0] ?? 0, true);
    v.setFloat32(28, corridor?.[1] ?? 0, true);
    this.device.queue.writeBuffer(this.far.u, 0, this.farUData);
  }
  /** (the far boxes 54 vertices — their walls 36, their roof 18 —, the quads 6) */
  private farReset = new Uint32Array([54, 0, 0, 0, 6, 0, 0, 0]);
  private farActive = false;
  /** the far layer's buildings in view at the last cull (boxes, quads — read back) */
  async farInView(): Promise<{ boxes: number; quads: number }> {
    if (!this.far) return { boxes: 0, quads: 0 };
    const r = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.far.draw, 0, r, 0, 32);
    this.device.queue.submit([enc.finish()]);
    await r.mapAsync(GPUMapMode.READ);
    const w = new Uint32Array(r.getMappedRange());
    const out = { boxes: w[1]!, quads: w[5]! };
    r.unmap();
    r.destroy();
    return out;
  }
  /** PLAN-J8 J8-L: the far street lamps' GPU pool (street-far.ts): their records (east, north, head [m]), blocks, cells' frames, params */
  private lamps: {
    blocks: number;
    u: GPUBuffer;
    rec: GPUBuffer;
    block: GPUBuffer;
    cell: GPUBuffer;
    pipe: GPURenderPipeline;
    cull: GPUComputePipeline;
    bind: GPUBindGroup;
    cullBind: GPUBindGroup;
    list: GPUBuffer;
    draw: GPUBuffer;
    used: number;
    /** the far cars' (J8-L): their records (two vec4 each), blocks, list, draw, pipelines, the highest block in use + 1 */
    cars: {
      blocks: number;
      rec: GPUBuffer;
      block: GPUBuffer;
      list: GPUBuffer;
      draw: GPUBuffer;
      pipe: GPURenderPipeline;
      cull: GPUComputePipeline;
      bind: GPUBindGroup;
      cullBind: GPUBindGroup;
      used: number;
    };
  } | null = null;
  private lampReset = new Uint32Array([6, 0, 0, 0]);
  /** the far cars' draw's reset: at night their lamp's quad (6 vertices), by day their body's box (36) */
  private carResetNight = new Uint32Array([6, 0, 0, 0]);
  private carResetDay = new Uint32Array([36, 0, 0, 0]);
  /** night: the far lamps' heads drawn (lampParams' `on`) — the far cars are drawn by day too (their bodies) */
  private lampsNight = false;
  private lampUData = new ArrayBuffer(32);
  /** the far lamps drawn (their pool made, the layer on) — and the highest block in use + 1 (the draw's instances) */
  lampsOn = false;
  get lampsReady() {
    return !!this.lamps;
  }
  /** PLAN-J8 J8-8 lot (2): the near mesh cells' reserve — its vertices' and triangles' blocks, its cells' frames, its pipeline */
  private near: {
    pos: GPUBuffer;
    tri: GPUBuffer;
    blk: GPUBuffer;
    cell: GPUBuffer;
    pipe: GPURenderPipeline;
    /** lot 3: into the buildings' shadow map and the relief's cascades */
    shadow: GPURenderPipeline;
    bind: GPUBindGroup;
    /** the highest triangle block in use + 1 (the draw's extent) */
    usedTri: number;
  } | null = null;
  /** the near mesh cells drawn (near-meshes.ts: its reserve made, the lever on) */
  nearOn = false;
  get nearReady() {
    return !!this.near;
  }
  /** the near mesh cells' reserve made: `vertBlocks` blocks of NEAR_VERT_BLOCK vertices (16 bytes each), `triBlocks` of NEAR_TRI_BLOCK
   *  triangles (16 bytes each), `slots` cells' frames; its pipeline compiled */
  async nearInit(vertBlocks: number, triBlocks: number, slots: number): Promise<void> {
    if (this.near) return;
    const d = this.device;
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const V = GPUShaderStage.VERTEX;
    const L = d.createBindGroupLayout({
      label: "near mesh cells draw",
      entries: [23, 24, 25, 26].map((binding) => ({ binding, visibility: V, buffer: { type: "read-only-storage" as const } })),
    });
    const pos = d.createBuffer({ size: Math.max(16, vertBlocks * NEAR_VERT_BLOCK * 16), usage: S, label: "near mesh cells vertices" });
    const tri = d.createBuffer({ size: Math.max(16, triBlocks * NEAR_TRI_BLOCK * 16), usage: S, label: "near mesh cells triangles" });
    const blk = d.createBuffer({ size: Math.max(16, triBlocks * 8), usage: S, label: "near mesh cells blocks" });
    const cell = d.createBuffer({ size: Math.max(64, slots * 64), usage: S, label: "near mesh cells frames" });
    const layout = d.createPipelineLayout({ bindGroupLayouts: [this.drawLayout, L] });
    const shadow = await d.createRenderPipelineAsync({
      layout,
      vertex: { module: this.module, entryPoint: "nearCellShadowVs" },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });
    const pipe = await d.createRenderPipelineAsync({
      layout,
      vertex: { module: this.module, entryPoint: "nearCellVs" },
      fragment: {
        module: this.module,
        entryPoint: "meshFs",
        targets: [{ format: TERRAIN_RASTER_FORMAT }, { format: TERRAIN_RASTER_MOTION_FORMAT }, { format: TERRAIN_RASTER_ID_FORMAT }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
    });
    this.near = {
      pos,
      tri,
      blk,
      cell,
      pipe,
      shadow,
      usedTri: 0,
      bind: d.createBindGroup({
        layout: L,
        entries: [
          { binding: 23, resource: { buffer: pos } },
          { binding: 24, resource: { buffer: tri } },
          { binding: 25, resource: { buffer: blk } },
          { binding: 26, resource: { buffer: cell } },
        ],
      }),
    };
  }
  /** a cell's vertices (4 floats each) into its vertex blocks, its triangles (4 u32 each: the pool's vertex indices — the caller's,
   *  from its vertex blocks —, its record) into its triangle blocks, each told its cell's slot and its count */
  nearUpload(vertBlocks: readonly number[], pos: Float32Array, triBlocks: readonly number[], tris: Uint32Array, slot: number) {
    const N = this.near;
    if (!N) return;
    const q = this.device.queue;
    const nv = pos.length / 4,
      nt = tris.length / 4;
    for (let b = 0; b < vertBlocks.length; b++) {
      const lo = b * NEAR_VERT_BLOCK,
        cnt = Math.min(NEAR_VERT_BLOCK, nv - lo);
      q.writeBuffer(N.pos, vertBlocks[b]! * NEAR_VERT_BLOCK * 16, pos.subarray(lo * 4, (lo + cnt) * 4) as Float32Array<ArrayBuffer>);
    }
    for (let b = 0; b < triBlocks.length; b++) {
      const lo = b * NEAR_TRI_BLOCK,
        cnt = Math.min(NEAR_TRI_BLOCK, nt - lo);
      q.writeBuffer(N.tri, triBlocks[b]! * NEAR_TRI_BLOCK * 16, tris.subarray(lo * 4, (lo + cnt) * 4) as Uint32Array<ArrayBuffer>);
      q.writeBuffer(N.blk, triBlocks[b]! * 8, new Uint32Array([slot, cnt]));
      N.usedTri = Math.max(N.usedTri, triBlocks[b]! + 1);
    }
  }
  /** a cell's frame in the scene's (16 floats: building-layer.ts cellFrameInScene) */
  nearFrame(slot: number, frame: Float32Array) {
    if (this.near) this.device.queue.writeBuffer(this.near.cell, slot * 64, frame as Float32Array<ArrayBuffer>);
  }
  /** triangle blocks let go: their counts 0 */
  nearClear(triBlocks: readonly number[]) {
    const N = this.near;
    if (!N) return;
    for (const b of triBlocks) this.device.queue.writeBuffer(N.blk, b * 8, new Uint32Array([0, 0]));
  }
  nearRelease() {
    const N = this.near;
    if (!N) return;
    for (const b of [N.pos, N.tri, N.blk, N.cell]) b.destroy();
    this.near = null;
    this.nearOn = false;
  }
  /** the far lamps' pool made: `blocks` blocks of 256 lamps (16 bytes each), `slots` cells' frames; its pipeline compiled */
  async lampInit(blocks: number, slots: number, carBlocks = 512): Promise<void> {
    if (this.lamps) return;
    const d = this.device;
    const S = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const V = GPUShaderStage.VERTEX;
    const C = GPUShaderStage.COMPUTE;
    const lampL = d.createBindGroupLayout({
      label: "far lamps draw",
      entries: [
        { binding: 11, visibility: V, buffer: { type: "uniform" } },
        { binding: 12, visibility: V, buffer: { type: "read-only-storage" } },
        { binding: 13, visibility: V, buffer: { type: "read-only-storage" } },
        { binding: 14, visibility: V, buffer: { type: "read-only-storage" } },
        { binding: 17, visibility: V, buffer: { type: "read-only-storage" } },
      ],
    });
    const lampCullL = d.createBindGroupLayout({
      label: "far lamps cull",
      entries: [
        { binding: 11, visibility: C, buffer: { type: "uniform" } },
        { binding: 12, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 13, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 14, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 15, visibility: C, buffer: { type: "storage" } },
        { binding: 16, visibility: C, buffer: { type: "storage" } },
      ],
    });
    const u = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: "far lamps params" });
    const carL = d.createBindGroupLayout({
      label: "far cars draw",
      entries: [
        { binding: 11, visibility: V, buffer: { type: "uniform" } },
        { binding: 14, visibility: V, buffer: { type: "read-only-storage" } },
        { binding: 18, visibility: V, buffer: { type: "read-only-storage" } },
        { binding: 19, visibility: V, buffer: { type: "read-only-storage" } },
        { binding: 22, visibility: V, buffer: { type: "read-only-storage" } },
      ],
    });
    const carCullL = d.createBindGroupLayout({
      label: "far cars cull",
      entries: [
        { binding: 11, visibility: C, buffer: { type: "uniform" } },
        { binding: 14, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 18, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 19, visibility: C, buffer: { type: "read-only-storage" } },
        { binding: 20, visibility: C, buffer: { type: "storage" } },
        { binding: 21, visibility: C, buffer: { type: "storage" } },
      ],
    });
    const carRec = d.createBuffer({ size: Math.max(32, carBlocks * 256 * 32), usage: S, label: "far cars records" });
    const carBlock = d.createBuffer({ size: Math.max(16, carBlocks * 8), usage: S, label: "far cars blocks" });
    const carList = d.createBuffer({ size: Math.max(16, carBlocks * 256 * 4), usage: GPUBufferUsage.STORAGE, label: "far cars list" });
    const carDraw = d.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      label: "far cars draws",
    });
    const rec = d.createBuffer({ size: Math.max(16, blocks * 256 * 16), usage: S, label: "far lamps records" });
    const block = d.createBuffer({ size: Math.max(16, blocks * 8), usage: S, label: "far lamps blocks" });
    const cell = d.createBuffer({ size: Math.max(64, slots * 64), usage: S, label: "far lamps cells" });
    const list = d.createBuffer({ size: Math.max(16, blocks * 256 * 4), usage: GPUBufferUsage.STORAGE, label: "far lamps list" });
    const draw = d.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      label: "far lamps draws",
    });
    const visTargets = [{ format: TERRAIN_RASTER_FORMAT }, { format: TERRAIN_RASTER_MOTION_FORMAT }, { format: TERRAIN_RASTER_ID_FORMAT }];
    const [pipe, cull, carPipe, carCull] = await Promise.all([
      d.createRenderPipelineAsync({
        layout: d.createPipelineLayout({ bindGroupLayouts: [this.drawLayout, lampL] }),
        vertex: { module: this.module, entryPoint: "farLampVs" },
        fragment: { module: this.module, entryPoint: "farFs", targets: visTargets },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
      }),
      d.createComputePipelineAsync({
        layout: d.createPipelineLayout({ bindGroupLayouts: [this.cullLayout, lampCullL] }),
        compute: { module: this.module, entryPoint: "farLampCull" },
      }),
      d.createRenderPipelineAsync({
        layout: d.createPipelineLayout({ bindGroupLayouts: [this.drawLayout, carL] }),
        vertex: { module: this.module, entryPoint: "farCarVs" },
        fragment: { module: this.module, entryPoint: "farFs", targets: visTargets },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "greater" },
      }),
      d.createComputePipelineAsync({
        layout: d.createPipelineLayout({ bindGroupLayouts: [this.cullLayout, carCullL] }),
        compute: { module: this.module, entryPoint: "farCarCull" },
      }),
    ]);
    this.lamps = {
      blocks,
      u,
      rec,
      block,
      cell,
      pipe,
      cull,
      list,
      draw,
      used: 0,
      bind: d.createBindGroup({
        layout: lampL,
        entries: [
          { binding: 11, resource: { buffer: u } },
          { binding: 12, resource: { buffer: rec } },
          { binding: 13, resource: { buffer: block } },
          { binding: 14, resource: { buffer: cell } },
          { binding: 17, resource: { buffer: list } },
        ],
      }),
      cars: {
        blocks: carBlocks,
        rec: carRec,
        block: carBlock,
        list: carList,
        draw: carDraw,
        pipe: carPipe,
        cull: carCull,
        used: 0,
        bind: d.createBindGroup({
          layout: carL,
          entries: [
            { binding: 11, resource: { buffer: u } },
            { binding: 14, resource: { buffer: cell } },
            { binding: 18, resource: { buffer: carRec } },
            { binding: 19, resource: { buffer: carBlock } },
            { binding: 22, resource: { buffer: carList } },
          ],
        }),
        cullBind: d.createBindGroup({
          layout: carCullL,
          entries: [
            { binding: 11, resource: { buffer: u } },
            { binding: 14, resource: { buffer: cell } },
            { binding: 18, resource: { buffer: carRec } },
            { binding: 19, resource: { buffer: carBlock } },
            { binding: 20, resource: { buffer: carList } },
            { binding: 21, resource: { buffer: carDraw } },
          ],
        }),
      },
      cullBind: d.createBindGroup({
        layout: lampCullL,
        entries: [
          { binding: 11, resource: { buffer: u } },
          { binding: 12, resource: { buffer: rec } },
          { binding: 13, resource: { buffer: block } },
          { binding: 14, resource: { buffer: cell } },
          { binding: 15, resource: { buffer: list } },
          { binding: 16, resource: { buffer: draw } },
        ],
      }),
    };
    this.lampParams(0, 0, false);
  }
  /** a cell's lamps (4 floats each: east, north, head [m], 0) into its blocks; each block told its cell's slot and its count */
  lampUpload(blocks: number[], lamps: Float32Array, slot: number) {
    const L = this.lamps;
    if (!L) return;
    const n = lamps.length / 4;
    const q = this.device.queue;
    for (let b = 0; b < blocks.length; b++) {
      const lo = b * 256,
        cnt = Math.min(256, n - lo);
      q.writeBuffer(L.rec, blocks[b]! * 256 * 16, lamps.subarray(lo * 4, (lo + cnt) * 4) as Float32Array<ArrayBuffer>);
      q.writeBuffer(L.block, blocks[b]! * 8, new Uint32Array([slot, cnt]));
      L.used = Math.max(L.used, blocks[b]! + 1);
    }
  }
  /** blocks let go: their counts 0 */
  lampClear(blocks: number[]) {
    const L = this.lamps;
    if (!L) return;
    for (const b of blocks) this.device.queue.writeBuffer(L.block, b * 8, new Uint32Array([0, 0]));
  }
  /** a cell's far cars (8 floats each: the lane's start xy, its run xy [m], its phase, its speed [m/s], 0, 0) into its blocks */
  carUpload(blocks: number[], cars: Float32Array, slot: number) {
    const L = this.lamps;
    if (!L) return;
    const C = L.cars;
    const n = cars.length / 8;
    const q = this.device.queue;
    for (let b = 0; b < blocks.length; b++) {
      const lo = b * 256,
        cnt = Math.min(256, n - lo);
      q.writeBuffer(C.rec, blocks[b]! * 256 * 32, cars.subarray(lo * 8, (lo + cnt) * 8) as Float32Array<ArrayBuffer>);
      q.writeBuffer(C.block, blocks[b]! * 8, new Uint32Array([slot, cnt]));
      C.used = Math.max(C.used, blocks[b]! + 1);
    }
  }
  carClear(blocks: number[]) {
    const L = this.lamps;
    if (!L) return;
    for (const b of blocks) this.device.queue.writeBuffer(L.cars.block, b * 8, new Uint32Array([0, 0]));
  }
  /** a cell slot's frame in the scene's (16 floats: building-layer.ts cellFrameInScene, its ground's plane in the axes' w) */
  lampFrame(slot: number, frame: Float32Array) {
    if (this.lamps) this.device.queue.writeBuffer(this.lamps.cell, slot * 64, frame as Float32Array<ArrayBuffer>);
  }
  /** the near scene's own lamps' reach round its centre [m] (none drawn within), the layer's reach [m], at night (the lamps drawn at
   *  all, the cars as their lamps — by day as their bodies), the near scene's own cars' reach round its centre [m] */
  lampParams(maskR: number, reach: number, on: boolean, carMaskR = maskR) {
    const L = this.lamps;
    if (!L) return;
    const v = new DataView(this.lampUData);
    v.setUint32(0, L.used, true);
    v.setFloat32(4, maskR, true);
    v.setFloat32(8, reach, true);
    v.setFloat32(12, on ? 1 : 0, true);
    v.setUint32(16, L.cars.used, true);
    v.setFloat32(20, carMaskR, true);
    this.lampsNight = on;
    this.device.queue.writeBuffer(L.u, 0, this.lampUData);
  }
  lampRelease() {
    if (!this.lamps) return;
    const L = this.lamps;
    for (const b of [L.u, L.rec, L.block, L.cell, L.list, L.draw, L.cars.rec, L.cars.block, L.cars.list, L.cars.draw]) b.destroy();
    this.lamps = null;
  }
  farRelease() {
    if (!this.far) return;
    for (const b of [this.far.u, this.far.rec, this.far.block, this.far.cell, this.far.list, this.far.draw]) b.destroy();
    this.far = null;
  }
  private benchReset = new Uint32Array([36, 0, 0, 0, 6, 0, 0, 0]);
  /** of the last read's envelopes in view, those drawn as quads (under the LOD threshold) */
  benchQuads = 0;
  /** the bench's envelopes in view at the last cull (its indirect draws' instances, read back: boxes and quads) */
  async benchInView(): Promise<number> {
    if (!this.bench) return 0;
    const r = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.bench.draw, 0, r, 0, 32);
    this.device.queue.submit([enc.finish()]);
    await r.mapAsync(GPUMapMode.READ);
    const w = new Uint32Array(r.getMappedRange());
    const n = w[1]! + w[5]!;
    this.benchQuads = w[5]!;
    r.unmap();
    r.destroy();
    return n;
  }

  private lod: SceneryRasterLod = SCENERY_RASTER_LOD;
  private sceneryOut = new Float32Array(44);
  /** the scenery's publication the instances belong to (earthScenery.revision; PLAN-J1 J1-2): their identity's generation */
  generation = 0;
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
    // (ident.x: the identity's generation, its 12 low bits — PLAN-J1 J1-2)
    this.sceneryOut[40] = this.generation % 4096;
    q.writeBuffer(this.sceneryU, 0, this.sceneryOut);
    q.writeBuffer(this.draws, 0, this.reset);
    if (this.bench && !(this.benchSkip & 1)) q.writeBuffer(this.bench.draw, 0, this.benchReset);
    this.farActive = !!this.far?.pipes && this.farOn;
    if (this.farActive && !(this.farSkip & 1)) q.writeBuffer(this.far!.draw, 0, this.farReset);
    if (this.lamps && this.lampsOn && this.lampsNight && this.lamps.used > 0) q.writeBuffer(this.lamps.draw, 0, this.lampReset);
    if (this.lamps && this.lampsOn && this.lamps.cars.used > 0)
      q.writeBuffer(this.lamps.cars.draw, 0, this.lampsNight ? this.carResetNight : this.carResetDay);
    // (the Sun's view: its trees culled into the shadow lists when it is to be drawn — encodeShadow —; else none)
    this.sunOn = !!sun && sun[15]! > 0.5 && this.shadowReady;
    if (sun) {
      // (c.w: 2 on, the trees' proxies cut to their crowns — shadowFs; the proxies whole, its lever treeShadowCut, retired at J5-R)
      this.sunData.set(this.sunOn ? sun : this.sunNone);
      if (this.sunOn) this.sunData[15] = 2;
      q.writeBuffer(this.sunU, 0, this.sunData);
    }
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
    // (PLAN-J8 J8-4: the far buildings' culling — over every record of the pool)
    if (this.farActive && !(this.farSkip & 1)) {
      const F = this.far!;
      const g = Math.ceil((F.blocks * 256) / 64);
      pass.setPipeline(F.pipes!.cull);
      pass.setBindGroup(0, this.cullBind!);
      pass.setBindGroup(1, F.cullBind);
      pass.dispatchWorkgroups(Math.min(g, 65535), Math.ceil(g / 65535));
    }
    // (PLAN-J8 J8-L: the far lamps in view listed — their draw's instances reset before the pass)
    if (this.lamps && this.lampsOn && this.lampsNight && this.lamps.used > 0) {
      const L = this.lamps;
      const g = Math.ceil((L.used * 256) / 64);
      pass.setPipeline(L.cull);
      pass.setBindGroup(0, this.cullBind!);
      pass.setBindGroup(1, L.cullBind);
      pass.dispatchWorkgroups(Math.min(g, 65535), Math.ceil(g / 65535));
    }
    if (this.lamps && this.lampsOn && this.lamps.cars.used > 0) {
      const C = this.lamps.cars;
      const g = Math.ceil((C.used * 256) / 64);
      pass.setPipeline(C.cull);
      pass.setBindGroup(0, this.cullBind!);
      pass.setBindGroup(1, C.cullBind);
      pass.dispatchWorkgroups(Math.min(g, 65535), Math.ceil(g / 65535));
    }
    // (PLAN-J8 J8-0 (c): the envelope bench's culling — its list and its draw's instances, reset before the pass)
    if (this.bench && this.benchPipes && !(this.benchSkip & 1)) {
      const g = Math.ceil(this.bench.count / 64);
      pass.setPipeline(this.benchPipes.cull);
      pass.setBindGroup(0, this.cullBind!);
      pass.setBindGroup(1, this.bench.cullBind);
      pass.dispatchWorkgroups(Math.min(g, 65535), Math.ceil(g / 65535));
    }
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
    // (PLAN-J8 J8-4: the far buildings in view — boxes, then the quads under the threshold)
    if (this.farActive && !(this.farSkip & 2)) {
      const F = this.far!;
      pass.setBindGroup(0, this.drawBind);
      pass.setBindGroup(1, F.drawBind);
      pass.setPipeline(F.pipes!.vis);
      pass.drawIndirect(F.draw, 0);
      pass.setPipeline(F.pipes!.quad);
      pass.drawIndirect(F.draw, 16);
    }
    // (PLAN-J8 J8-L: the far street lamps' heads — at night, their used blocks' lamps, each its quad)
    if (this.lamps && this.lampsOn && this.lampsNight && this.lamps.used > 0) {
      const L = this.lamps;
      pass.setBindGroup(0, this.drawBind);
      pass.setBindGroup(1, L.bind);
      pass.setPipeline(L.pipe);
      pass.drawIndirect(L.draw, 0);
    }
    if (this.lamps && this.lampsOn && this.lamps.cars.used > 0) {
      const C = this.lamps.cars;
      pass.setBindGroup(0, this.drawBind);
      pass.setBindGroup(1, C.bind);
      pass.setPipeline(C.pipe);
      pass.drawIndirect(C.draw, 0);
    }
    // (PLAN-J8 J8-8 lot (2): the near mesh cells' triangles — every used block's, the rest of a block degenerate)
    if (this.near && this.nearOn && this.near.usedTri > 0) {
      const N = this.near;
      pass.setBindGroup(0, this.drawBind);
      pass.setBindGroup(1, N.bind);
      pass.setPipeline(N.pipe);
      pass.draw(N.usedTri * NEAR_TRI_BLOCK * 3);
    }
    // (PLAN-J8 J8-0 (c): the envelope bench's envelopes in view, solid, a real building's material)
    if (this.bench && this.benchPipes && !(this.benchSkip & 2)) {
      pass.setPipeline(this.benchPipes.vis);
      pass.setBindGroup(0, this.drawBind);
      pass.setBindGroup(1, this.bench.drawBind);
      pass.drawIndirect(this.bench.draw, 0);
      if (this.benchPipes.lodPx > 0) {
        pass.setPipeline(this.benchPipes.quad);
        pass.drawIndirect(this.bench.draw, 16);
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
    // (PLAN-J8 J8-4: the far buildings', all those resident — those the near scene draws left out)
    if (this.farActive && !(this.farSkip & 4)) {
      const F = this.far!;
      buildings.setPipeline(F.pipes!.shadow);
      buildings.setBindGroup(0, this.drawBind);
      buildings.setBindGroup(1, F.drawBind);
      buildings.draw(54, F.blocks * 256);
    }
    // (PLAN-J8 J8-8 lot 3: the near mesh cells' triangles)
    if (this.near && this.nearOn && this.near.usedTri > 0) {
      buildings.setPipeline(this.near.shadow);
      buildings.setBindGroup(0, this.drawBind);
      buildings.setBindGroup(1, this.near.bind);
      buildings.draw(this.near.usedTri * NEAR_TRI_BLOCK * 3);
    }
    // (PLAN-J8 J8-0 (c): the envelope bench's, all of them — as the buildings' boxes, uncut by the Sun's view)
    if (this.bench && this.benchPipes && !(this.benchSkip & 4)) {
      buildings.setPipeline(this.benchPipes.shadow);
      buildings.setBindGroup(0, this.drawBind);
      buildings.setBindGroup(1, this.bench.drawBind);
      buildings.draw(36, this.bench.count);
    }
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
    // (PLAN-J8 J8-8 lot 3: the near mesh cells' triangles, in this cascade too)
    if (this.near && this.nearOn && this.near.usedTri > 0) {
      pass.setPipeline(this.near.shadow);
      pass.setBindGroup(1, this.near.bind);
      pass.draw(this.near.usedTri * NEAR_TRI_BLOCK * 3);
    }
    return true;
  }

  stats() {
    return { ready: this.ready, error: this.error, active: this.active, encodedFrames: this.encodedFrames, cells: this.cells };
  }

  dispose() {
    for (const b of [this.frameU, this.sceneryU, this.draws, this.lists, this.sunU, ...this.meshes, ...this.cascadeSunU]) b.destroy();
    if (this.bench) for (const b of [this.bench.env, this.bench.list, this.bench.draw]) b.destroy();
    this.bench = null;
    this.farRelease();
    this.lampRelease();
  }
}
