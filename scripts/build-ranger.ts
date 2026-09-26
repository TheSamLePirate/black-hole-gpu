// Prepares the Interstellar Ranger model for the web: OBJ (Blender export, n-gons, no normals) →
// assets/ranger/ranger.bin. (The model's PBR textures were baked on another UV layout than the OBJ's,
// so they are not used: the hull is shaded procedurally, per part, with a procedural normal map.)
//
//   bun scripts/build-ranger.ts ["assets/Interstellar Ranger One"]
//
//  1. n-gons triangulated by ear clipping in their own plane (some are concave);
//  2. refined until no edge exceeds REFINE metres, crack-free: whether an edge is split depends on the
//     edge alone, so both triangles sharing it agree (red-green refinement: 1, 2 or 3 split edges);
//  3. normals smoothed across edges flatter than 40° (Blender's auto smooth), a material id per part
//     (0 hull, 1 glass, 2 nozzles, 3 window frames, 4 hatch/airlock);
//  4. ambient occlusion baked per vertex: AO_RAYS cosine-distributed rays against a BVH of the mesh,
//     occlusion weighted by (1 − t/AO_RANGE).
// Binary layout (little endian): "RNGR", u32 version (2), u32 vertex count, u32 index count,
// 6 × f32 bounds (min xyz, max xyz), then vertices (8 × f32: position 3, normal 3, material, AO) and
// u32 indices.
import { $ } from "bun";

const src = process.argv[2] ?? "assets/Interstellar Ranger One";
const out = "assets/ranger";
const PARTS: [RegExp, number][] = [[/^steklo/, 1], [/^soplo/, 2], [/^okna/, 3], [/^(stykovochniy|vorota)/, 4]];
const SMOOTH = Math.cos((40 * Math.PI) / 180);
const REFINE = 0.45;
const AO_RAYS = 96;
const AO_RANGE = 3.5;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ------------------------------------------------------------------------------------ parse
const text = await Bun.file(`${src}/source/333.obj`).text();
const P: V3[] = [];
interface Face { v: number[]; part: number }
const faces: Face[] = [];
let part = 0;
for (const line of text.split("\n")) {
  const w = line.trim().split(/\s+/);
  if (w[0] === "o") part = PARTS.find(([re]) => re.test(w[1] ?? ""))?.[1] ?? 0;
  else if (w[0] === "v") P.push([+w[1]!, +w[2]!, +w[3]!]);
  else if (w[0] === "f") faces.push({ v: w.slice(1).map((c) => Number(c.split("/")[0]) - 1), part });
}

// ------------------------------------------------------------------------------------ triangulate
/** Ear clipping of a planar polygon (indices into its own corner list). */
function earClip(pts: V3[]): [number, number, number][] {
  const n = pts.length;
  if (n === 3) return [[0, 1, 2]];
  // Newell normal → 2D projection on the dominant plane
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const [i0, i1, s] = az >= ax && az >= ay ? [0, 1, Math.sign(nz)] : ax >= ay ? [1, 2, Math.sign(nx)] : [2, 0, Math.sign(ny)];
  const q = pts.map((p) => [p[i0], p[i1]] as [number, number]);
  const area2 = (a: number, b: number, c: number) =>
    s * ((q[b]![0] - q[a]![0]) * (q[c]![1] - q[a]![1]) - (q[b]![1] - q[a]![1]) * (q[c]![0] - q[a]![0]));
  const inside = (p: number, a: number, b: number, c: number) =>
    area2(a, b, p) >= -1e-12 && area2(b, c, p) >= -1e-12 && area2(c, a, p) >= -1e-12;
  const idx = [...Array(n).keys()];
  const tris: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length]!, b = idx[k]!, c = idx[(k + 1) % idx.length]!;
      if (area2(a, b, c) <= 1e-14) continue; // reflex or degenerate
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // numerically stuck: fan the rest
  }
  for (let k = 1; k + 1 < idx.length; k++) tris.push([idx[0]!, idx[k]!, idx[k + 1]!]);
  return tris;
}

interface Tri { v: [number, number, number]; n: V3; area: number; part: number }
const faceNormal = (v: Tri["v"]) => {
  const cr = cross(sub(P[v[1]]!, P[v[0]]!), sub(P[v[2]]!, P[v[0]]!));
  return { n: norm(cr), area: Math.hypot(...cr) / 2 };
};
let tris: Tri[] = [];
for (const f of faces) {
  for (const [a, b, c] of earClip(f.v.map((i) => P[i]!))) {
    const v: Tri["v"] = [f.v[a]!, f.v[b]!, f.v[c]!];
    const { n, area } = faceNormal(v);
    if (area > 1e-10) tris.push({ v, n, area, part: f.part });
  }
}
const coarse = tris.length;

// ------------------------------------------------------------------------------------ refine
// (the face normal is inherited: children lie in the parent's plane)
const mids = new Map<string, number>();
const midpoint = (a: number, b: number) => {
  const k = a < b ? `${a},${b}` : `${b},${a}`;
  let m = mids.get(k);
  if (m === undefined) {
    m = P.length;
    P.push(scale(add(P[a]!, P[b]!), 0.5));
    mids.set(k, m);
  }
  return m;
};
const long = (a: number, b: number) => Math.hypot(...sub(P[a]!, P[b]!)) > REFINE;
for (let pass = 0; pass < 12; pass++) {
  const next: Tri[] = [];
  let split = 0;
  for (const t of tris) {
    const [a, b, c] = t.v;
    const e = [long(a, b), long(b, c), long(c, a)];
    const n = e.filter(Boolean).length;
    const mk = (v: Tri["v"]) => {
      const area = faceNormal(v).area;
      if (area > 1e-12) next.push({ v, n: t.n, area, part: t.part });
    };
    if (n === 0) next.push(t);
    else if (n === 3) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      mk([a, ab, ca]); mk([ab, b, bc]); mk([ca, bc, c]); mk([ab, bc, ca]);
    } else {
      // rotate so that the first split edge is (x, y)
      const r = e[0] ? 0 : e[1] ? 1 : 2;
      const [x, y, z] = [t.v[r]!, t.v[(r + 1) % 3]!, t.v[(r + 2) % 3]!];
      const xy = midpoint(x, y);
      if (n === 1) {
        mk([x, xy, z]); mk([xy, y, z]);
      } else if (e[(r + 1) % 3]) {
        const yz = midpoint(y, z);
        mk([x, xy, z]); mk([xy, y, yz]); mk([xy, yz, z]);
      } else {
        const zx = midpoint(z, x);
        mk([x, xy, zx]); mk([xy, y, z]); mk([xy, z, zx]);
      }
    }
    if (n) split++;
  }
  tris = next;
  if (!split) break;
}

// ------------------------------------------------------------------------------------ normals
// corner normal: area-weighted face normals around the position, within the smoothing angle
const around = new Map<number, number[]>();
tris.forEach((t, i) => t.v.forEach((v) => (around.get(v) ?? around.set(v, []).get(v)!).push(i)));
const verts: number[][] = []; // position 3, normal 3, material, AO
const key = new Map<string, number>();
const indices: number[] = [];
for (const t of tris) {
  for (let k = 0; k < 3; k++) {
    let n: V3 = [0, 0, 0];
    for (const j of around.get(t.v[k]!)!) {
      const o = tris[j]!;
      if (dot(o.n, t.n) >= SMOOTH) n = add(n, scale(o.n, o.area));
    }
    n = norm(n);
    const id = `${t.v[k]}/${n.map((x) => x.toFixed(3)).join()}/${t.part}`;
    let vi = key.get(id);
    if (vi === undefined) {
      vi = verts.length;
      key.set(id, vi);
      verts.push([...P[t.v[k]!]!, ...n, t.part, 1]);
    }
    indices.push(vi);
  }
}

// ------------------------------------------------------------------------------------ AO bake
// BVH: median split on the longest centroid axis, leaves of ≤ 4 triangles
const T = tris.map((t) => t.v.map((i) => P[i]!) as [V3, V3, V3]);
interface Node { lo: V3; hi: V3; l?: Node; r?: Node; items?: number[] }
function build(items: number[]): Node {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  const clo: V3 = [Infinity, Infinity, Infinity], chi: V3 = [-Infinity, -Infinity, -Infinity];
  const cen = (i: number, k: number) => (T[i]![0][k]! + T[i]![1][k]! + T[i]![2][k]!) / 3;
  for (const i of items) {
    for (const p of T[i]!) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
    for (let k = 0; k < 3; k++) (clo[k] = Math.min(clo[k]!, cen(i, k))), (chi[k] = Math.max(chi[k]!, cen(i, k)));
  }
  if (items.length <= 4) return { lo, hi, items };
  const ax = [0, 1, 2].reduce((m, k) => (chi[k]! - clo[k]! > chi[m]! - clo[m]! ? k : m), 0);
  items.sort((a, b) => cen(a, ax) - cen(b, ax));
  const h = items.length >> 1;
  return { lo, hi, l: build(items.slice(0, h)), r: build(items.slice(h)) };
}
const bvh = build([...T.keys()]);

function hitBox(n: Node, o: V3, inv: V3, tMax: number) {
  let t0 = 0, t1 = tMax;
  for (let k = 0; k < 3; k++) {
    let a = (n.lo[k]! - o[k]!) * inv[k]!, b = (n.hi[k]! - o[k]!) * inv[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}
/** Nearest hit distance along d from o (Möller–Trumbore), or Infinity. */
function cast(o: V3, d: V3, tMax: number): number {
  const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]];
  let best = tMax;
  const stack: Node[] = [bvh];
  while (stack.length) {
    const n = stack.pop()!;
    if (!hitBox(n, o, inv, best)) continue;
    if (n.items) {
      for (const i of n.items) {
        const [a, b, c] = T[i]!;
        const e1 = sub(b, a), e2 = sub(c, a);
        const pv = cross(d, e2);
        const det = dot(e1, pv);
        if (Math.abs(det) < 1e-12) continue;
        const id = 1 / det;
        const tv = sub(o, a);
        const u = dot(tv, pv) * id;
        if (u < 0 || u > 1) continue;
        const qv = cross(tv, e1);
        const v = dot(d, qv) * id;
        if (v < 0 || u + v > 1) continue;
        const t = dot(e2, qv) * id;
        if (t > 1e-4 && t < best) best = t;
      }
    } else stack.push(n.l!, n.r!);
  }
  return best;
}

// cosine-weighted hemisphere directions (Fibonacci spiral on the disk, Malley's method)
const dirs: [number, number, number][] = [];
for (let i = 0; i < AO_RAYS; i++) {
  const r = Math.sqrt((i + 0.5) / AO_RAYS);
  const ph = i * 2.399963229728653;
  dirs.push([r * Math.cos(ph), r * Math.sin(ph), Math.sqrt(1 - r * r)]);
}
const t0 = performance.now();
for (const v of verts) {
  const p = v.slice(0, 3) as V3;
  const n = v.slice(3, 6) as V3;
  const t1 = norm(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const t2 = cross(n, t1);
  const o = add(p, scale(n, 0.006));
  // rotate the pattern per vertex (hash) to turn banding into fine noise
  const rot = ((Math.sin(p[0] * 12.9898 + p[1] * 78.233 + p[2] * 37.719) * 43758.5453) % 1) * 2 * Math.PI;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  let occ = 0;
  for (const [x0, y0, z] of dirs) {
    const x = x0 * cr - y0 * sr, y = x0 * sr + y0 * cr;
    const d: V3 = [t1[0] * x + t2[0] * y + n[0] * z, t1[1] * x + t2[1] * y + n[1] * z, t1[2] * x + t2[2] * y + n[2] * z];
    const t = cast(o, d, AO_RANGE);
    if (t < AO_RANGE) occ += 1 - t / AO_RANGE;
  }
  v[7] = 1 - occ / AO_RAYS;
}
const bakeMs = performance.now() - t0;

// ------------------------------------------------------------------------------------ write
const lo: V3 = [Infinity, Infinity, Infinity];
const hi: V3 = [-Infinity, -Infinity, -Infinity];
for (const p of P) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
const head = new ArrayBuffer(16 + 24);
new Uint8Array(head, 0, 4).set(new TextEncoder().encode("RNGR"));
new Uint32Array(head, 4, 3).set([2, verts.length, indices.length]);
new Float32Array(head, 16, 6).set([...lo, ...hi]);
await $`mkdir -p ${out}`;
await Bun.write(`${out}/ranger.bin`, new Blob([head, new Float32Array(verts.flat()), new Uint32Array(indices)]));
console.log(
  `mesh: ${faces.length} faces → ${coarse} triangles → refined ${tris.length}, ${verts.length} vertices; AO ${AO_RAYS} rays/vertex in ${(bakeMs / 1000).toFixed(1)} s`,
);
console.log((await $`ls -la ${out}`.text()).trim());
