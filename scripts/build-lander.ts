// Prepares Interstellar's Lander for the web: OBJ (Blender export, n-gons, normals and UVs) and its
// textures → assets/lander/lander.bin and three WebP maps.
//
//   bun scripts/build-lander.ts ["assets/Lander Exterior Interstellar Model"]
//
//  1. the OBJ's n-gons triangulated by ear clipping in their own plane; its normals and UVs kept (a
//     vertex per position / UV / normal triple);
//  2. turned into the ship's frame (x to its left, y up, z towards the nose — the model's nose is its −z)
//     and scaled to LENGTH metres; the belly at y = 0, centred across and along;
//  3. ambient occlusion baked per vertex: AO_RAYS cosine-distributed rays against a BVH of the mesh,
//     occlusion weighted by (1 − t/AO_RANGE);
//  4. the textures (2048²: colour, tangent-space normals, the lights' emission) re-encoded as WebP.
// Binary layout (little endian): "LNDR", u32 version (1), u32 vertex count, u32 index count,
// 6 × f32 bounds (min xyz, max xyz), then vertices (10 × f32: position 3, normal 3, material, AO, UV 2)
// and u32 indices. Material 10: the textured hull.
import { $ } from "bun";

const src = process.argv[2] ?? "assets/Lander Exterior Interstellar Model";
const out = "assets/lander";
/** the Lander's length, nose to nozzles [m] (the film's: about 1.6 Rangers) */
const LENGTH = 24;
const AO_RAYS = 96;
const AO_RANGE = 5;

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
await $`mkdir -p /tmp/lander-src && unzip -o -q ${`${src}/source/lander exterior 2.zip`} -d /tmp/lander-src`;
const text = await Bun.file("/tmp/lander-src/lander exterior 2.obj").text();
const P0: V3[] = [], UV: [number, number][] = [], N0: V3[] = [];
const faces: [number, number, number][][] = [];
for (const line of text.split("\n")) {
  const w = line.trim().split(/\s+/);
  if (w[0] === "v") P0.push([+w[1]!, +w[2]!, +w[3]!]);
  else if (w[0] === "vt") UV.push([+w[1]!, +w[2]!]);
  else if (w[0] === "vn") N0.push([+w[1]!, +w[2]!, +w[3]!]);
  else if (w[0] === "f") faces.push(w.slice(1).map((c) => c.split("/").map((x) => Number(x) - 1) as [number, number, number]));
}
// the ship's frame: (x, y, z) → (−x, y, −z) (a half turn about y: the nose to +z), scaled, the belly at 0
let lo0: V3 = [Infinity, Infinity, Infinity], hi0: V3 = [-Infinity, -Infinity, -Infinity];
for (const p of P0) for (let k = 0; k < 3; k++) (lo0[k] = Math.min(lo0[k]!, p[k]!)), (hi0[k] = Math.max(hi0[k]!, p[k]!));
const S = LENGTH / (hi0[2] - lo0[2]);
const cx = (lo0[0] + hi0[0]) / 2, cz = (lo0[2] + hi0[2]) / 2;
const P = P0.map((p) => [-(p[0] - cx) * S, (p[1] - lo0[1]) * S, -(p[2] - cz) * S] as V3);
const N = N0.map((n) => norm([-n[0], n[1], -n[2]]));

// ------------------------------------------------------------------------------------ triangulate
/** Ear clipping of a planar polygon (indices into its own corner list). */
function earClip(pts: V3[]): [number, number, number][] {
  const n = pts.length;
  if (n === 3) return [[0, 1, 2]];
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
      if (area2(a, b, c) <= 1e-14) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      tris.push([a, b, c]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  for (let k = 1; k + 1 < idx.length; k++) tris.push([idx[0]!, idx[k]!, idx[k + 1]!]);
  return tris;
}

// ------------------------------------------------------------------------------------ vertices
// (the half turn keeps the winding: a rotation; a vertex per position / UV / normal)
const verts: number[][] = [];
const key = new Map<string, number>();
const indices: number[] = [];
const T: [V3, V3, V3][] = [];
for (const f of faces) {
  for (const tri of earClip(f.map((c) => P[c[0]]!))) {
    const cs = tri.map((k) => f[k]!);
    const A = P[cs[0]![0]]!, B = P[cs[1]![0]]!, C = P[cs[2]![0]]!;
    if (Math.hypot(...cross(sub(B, A), sub(C, A))) < 1e-10) continue;
    T.push([A, B, C]);
    for (const c of cs) {
      const id = c.join("/");
      let vi = key.get(id);
      if (vi === undefined) {
        vi = verts.length;
        key.set(id, vi);
        const uv = UV[c[1]] ?? [0, 0];
        const n = N[c[2]] ?? [0, 1, 0];
        // (the OBJ's v grows upwards, the image's rows downwards)
        verts.push([...P[c[0]]!, ...n, 10, 1, uv[0], 1 - uv[1]]);
      }
      indices.push(vi);
    }
  }
}

// ------------------------------------------------------------------------------------ AO bake
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
const dirs: V3[] = [];
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
  const o = add(p, scale(n, 0.01));
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

// ------------------------------------------------------------------------------------ the dorsal hatch
// (the docking port: the round hatch on the back, amidships — its rim's highest vertices near the axis)
let top = -Infinity, tz = 0, tn = 0;
for (const p of P) if (Math.abs(p[0]) < 1.2 && Math.abs(p[2]) < 1.2) top = Math.max(top, p[1]);
for (const p of P) if (Math.abs(p[0]) < 1.2 && Math.abs(p[2]) < 1.2 && p[1] > top - 0.05) (tz += p[2]), tn++;
console.log(`dorsal hatch: y ${top.toFixed(3)} m, z ${(tz / Math.max(tn, 1)).toFixed(3)} m (${tn} vertices)`);

// ------------------------------------------------------------------------------------ write
const lo: V3 = [Infinity, Infinity, Infinity];
const hi: V3 = [-Infinity, -Infinity, -Infinity];
for (const p of P) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
const head = new ArrayBuffer(16 + 24);
new Uint8Array(head, 0, 4).set(new TextEncoder().encode("LNDR"));
new Uint32Array(head, 4, 3).set([1, verts.length, indices.length]);
new Float32Array(head, 16, 6).set([...lo, ...hi]);
await $`mkdir -p ${out}`;
await Bun.write(`${out}/lander.bin`, new Blob([head, new Float32Array(verts.flat()), new Uint32Array(indices)]));
// the maps: WebP (Pillow)
const maps: [string, string, number][] = [["lander.png", "lander-albedo.webp", 88], ["lander_NORM.png", "lander-normal.webp", 92], ["lander_lights.png", "lander-lights.webp", 85]];
for (const [from, to, q] of maps) {
  await $`python3 -c ${`from PIL import Image; Image.open(${JSON.stringify(`${src}/textures/${from}`)}).convert("RGB").save(${JSON.stringify(`${out}/${to}`)}, "WEBP", quality=${q}, method=6)`}`;
}
console.log(`mesh: ${faces.length} faces → ${T.length} triangles, ${verts.length} vertices; ${(hi[0] - lo[0]).toFixed(1)} × ${(hi[1] - lo[1]).toFixed(1)} × ${(hi[2] - lo[2]).toFixed(1)} m; AO ${AO_RAYS} rays/vertex in ${(bakeMs / 1000).toFixed(1)} s`);
console.log((await $`ls -la ${out}`.text()).trim());
