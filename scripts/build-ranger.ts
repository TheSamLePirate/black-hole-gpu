// Prepares the Interstellar Ranger model for the web: OBJ (Blender export, n-gons, no normals) →
// assets/ranger/ranger.bin. (The model's PBR textures were baked on another UV layout than the OBJ's,
// so they are not used: the hull is shaded procedurally, per part.)
//
//   bun scripts/build-ranger.ts ["assets/Interstellar Ranger One"]
//
// Mesh: n-gons triangulated by ear clipping in their own plane (some are concave), normals smoothed
// across edges sharper than 40° kept hard (Blender's auto smooth), tangents from the UVs, a material
// id per vertex from the part's name (0 hull, 1 glass, 2 nozzles, 3 window frames, 4 hatch/airlock).
// Binary layout (little endian): "RNGR", u32 version, u32 vertex count, u32 index count,
// 6 × f32 bounds (min xyz, max xyz), then vertices (14 × f32: position 3, normal 3, tangent 4
// (w = handedness), uv 2, material, unused) and u32 indices.
import { $ } from "bun";

const src = process.argv[2] ?? "assets/Interstellar Ranger One";
const out = "assets/ranger";
const PARTS: [RegExp, number][] = [[/^steklo/, 1], [/^soplo/, 2], [/^okna/, 3], [/^(stykovochniy|vorota)/, 4]];
const SMOOTH = Math.cos((40 * Math.PI) / 180);

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ------------------------------------------------------------------------------------ parse
const text = await Bun.file(`${src}/source/333.obj`).text();
const P: V3[] = [];
const T: [number, number][] = [];
interface Face { v: number[]; t: number[]; glass: number }
const faces: Face[] = [];
let glass = 0;
for (const line of text.split("\n")) {
  const w = line.trim().split(/\s+/);
  if (w[0] === "o") glass = PARTS.find(([re]) => re.test(w[1] ?? ""))?.[1] ?? 0;
  else if (w[0] === "v") P.push([+w[1]!, +w[2]!, +w[3]!]);
  else if (w[0] === "vt") T.push([+w[1]!, 1 - +w[2]!]); // OBJ v runs up, texture rows run down
  else if (w[0] === "f") {
    const f: Face = { v: [], t: [], glass };
    for (const c of w.slice(1)) {
      const [vi, ti] = c.split("/");
      f.v.push(Number(vi) - 1);
      f.t.push(ti ? Number(ti) - 1 : 0);
    }
    faces.push(f);
  }
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

interface Tri { v: [number, number, number]; t: [number, number, number]; n: V3; area: number; glass: number }
const tris: Tri[] = [];
for (const f of faces) {
  for (const [a, b, c] of earClip(f.v.map((i) => P[i]!))) {
    const v: Tri["v"] = [f.v[a]!, f.v[b]!, f.v[c]!];
    const cr = cross(sub(P[v[1]]!, P[v[0]]!), sub(P[v[2]]!, P[v[0]]!));
    const area = Math.hypot(...cr) / 2;
    if (area < 1e-10) continue;
    tris.push({ v, t: [f.t[a]!, f.t[b]!, f.t[c]!], n: norm(cr), area, glass: f.glass });
  }
}

// ------------------------------------------------------------------------------------ normals
// corner normal: area-weighted face normals around the position, within the smoothing angle
const around = new Map<number, number[]>();
tris.forEach((t, i) => t.v.forEach((v) => (around.get(v) ?? around.set(v, []).get(v)!).push(i)));
const verts: number[][] = []; // position 3, normal 3, tangent 4, uv 2, material, unused
const key = new Map<string, number>();
const indices: number[] = [];
for (const t of tris) {
  for (let k = 0; k < 3; k++) {
    let n: V3 = [0, 0, 0];
    for (const j of around.get(t.v[k]!)!) {
      const o = tris[j]!;
      if (dot(o.n, t.n) >= SMOOTH) n = [n[0] + o.n[0] * o.area, n[1] + o.n[1] * o.area, n[2] + o.n[2] * o.area];
    }
    n = norm(n);
    const uv = T[t.t[k]!] ?? [0, 0];
    const id = `${t.v[k]}/${t.t[k]}/${n.map((x) => x.toFixed(3)).join()}/${+t.glass}`;
    let vi = key.get(id);
    if (vi === undefined) {
      vi = verts.length;
      key.set(id, vi);
      verts.push([...P[t.v[k]!]!, ...n, 0, 0, 0, 0, uv[0], uv[1], t.glass, 0]);
    }
    indices.push(vi);
  }
}

// ------------------------------------------------------------------------------------ tangents
const tan = verts.map(() => [0, 0, 0]);
const bit = verts.map(() => [0, 0, 0]);
for (let i = 0; i < indices.length; i += 3) {
  const [a, b, c] = [indices[i]!, indices[i + 1]!, indices[i + 2]!].map((j) => verts[j]!);
  const e1 = sub(b!.slice(0, 3) as V3, a!.slice(0, 3) as V3);
  const e2 = sub(c!.slice(0, 3) as V3, a!.slice(0, 3) as V3);
  const du1 = b![10]! - a![10]!, dv1 = b![11]! - a![11]!, du2 = c![10]! - a![10]!, dv2 = c![11]! - a![11]!;
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-14) continue;
  const r = 1 / det;
  const sdir = [0, 1, 2].map((k) => (dv2 * e1[k]! - dv1 * e2[k]!) * r);
  const tdir = [0, 1, 2].map((k) => (du1 * e2[k]! - du2 * e1[k]!) * r);
  for (const j of [indices[i]!, indices[i + 1]!, indices[i + 2]!]) {
    for (let k = 0; k < 3; k++) {
      tan[j]![k]! += sdir[k]!;
      bit[j]![k]! += tdir[k]!;
    }
  }
}
verts.forEach((v, i) => {
  const n = v.slice(3, 6) as V3;
  let t = tan[i] as V3;
  t = sub(t, n.map((x) => x * dot(n, t)) as V3);
  if (Math.hypot(...t) < 1e-9) t = norm(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  t = norm(t);
  const w = dot(cross(n, t), bit[i] as V3) < 0 ? -1 : 1;
  v.splice(6, 4, t[0], t[1], t[2], w);
});

// ------------------------------------------------------------------------------------ write
const lo: V3 = [Infinity, Infinity, Infinity];
const hi: V3 = [-Infinity, -Infinity, -Infinity];
for (const p of P) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
const head = new ArrayBuffer(16 + 24);
new Uint8Array(head, 0, 4).set(new TextEncoder().encode("RNGR"));
new Uint32Array(head, 4, 3).set([1, verts.length, indices.length]);
new Float32Array(head, 16, 6).set([...lo, ...hi]);
await $`mkdir -p ${out}`;
await Bun.write(`${out}/ranger.bin`, new Blob([head, new Float32Array(verts.flat()), new Uint32Array(indices)]));
console.log(`mesh: ${faces.length} faces → ${indices.length / 3} triangles, ${verts.length} vertices`);

console.log((await $`ls -la ${out}`.text()).trim());
