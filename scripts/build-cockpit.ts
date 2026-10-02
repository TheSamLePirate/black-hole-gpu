// The Ranger's cockpit for the web: the interior (scripts/cockpit-convert.py's plain mesh) fitted into the
// Ranger's hull, its light baked → assets/ranger/cockpit.bin (gzip).
//
//   /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
//       --python scripts/cockpit-convert.py -- "assets/Interstellar Ranger One Cockpit/endurance lander cockpit.obj" /tmp/cockpit-raw.bin
//   bun scripts/build-cockpit.ts [/tmp/cockpit-raw.bin]
//
//  1. placed in the hull's frame at its own scale (the film's proportions — from inside the cabin is drawn
//     alone): its windows' centre on the hull's, their tops level;
//  2. all of it kept: from inside the cabin is drawn alone, from outside the hull alone;
//  3. per vertex, against the interior (its glass let through): the ambient occlusion (64 cosine-
//     distributed rays, occlusion weighted by 1 − t/1.2 m) and the sky seen — the share of those rays that
//     leave the cabin (through the windows): what the outside lights it with.
// Binary (little endian, gzip): "CKPT", u32 version 2, vertex count, index count, 6 × f32 bounds, u32 stick
// count and per stick 4 × f32 (its pivot, 0) — then
// vertices (10 × f32: position 3, normal 3, material, AO, then — the screens (68): 2 × its number + its own
// u (0…1), its v; the rest: the sky seen, the part's size [cm] + a hash of it in [0, 1)) and u32 indices. Materials: 60 floor, 61 walls and
// ceiling, 62 consoles, 63 seats, 64 cryo pods, 65 bags, 66 metal (beams, handles), 67 laptops, 68 screens,
// 69 TARS's platform, 70 airlock, 71 glass, 72 the flight sticks' grips.
import { TriBVH } from "../src/system/collide";

type V3 = [number, number, number];
const src = process.argv[2] ?? "/tmp/cockpit-raw.bin";

// ---- the interior
const raw = await Bun.file(src).arrayBuffer();
if (new TextDecoder().decode(new Uint8Array(raw, 0, 4)) !== "CKP0") throw new Error("not a cockpit-convert.py output");
const [nv0, ni0] = new Uint32Array(raw, 4, 2) as unknown as [number, number];
const RV = new Float32Array(raw, 12, nv0 * 11);
const RI = new Uint32Array(raw, 12 + nv0 * 44, ni0);

// ---- the hull (assets/ranger/ranger.bin): its triangles, its glass (material 1)
const hb = await Bun.file("assets/ranger/ranger.bin").arrayBuffer();
const [hnv, hni] = [new Uint32Array(hb, 8, 2)[0]!, new Uint32Array(hb, 8, 2)[1]!];
const HV = new Float32Array(hb, 40, hnv * 8);
const HI = new Uint32Array(hb, 40 + hnv * 32, hni);
const hpos = new Float32Array(hnv * 3);
for (let i = 0; i < hnv; i++) hpos.set(HV.subarray(8 * i, 8 * i + 3), 3 * i);
const glass = (i: number) => Math.round(HV[8 * i + 6]!) === 1;
let gLo: V3 = [Infinity, Infinity, Infinity], gHi: V3 = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < hnv; i++) if (glass(i)) for (let c = 0; c < 3; c++) (gLo[c] = Math.min(gLo[c]!, hpos[3 * i + c]!)), (gHi[c] = Math.max(gHi[c]!, hpos[3 * i + c]!));
// (symmetric across: the hull's glass is ±2 cm off its axis)
const half = (gHi[0] - gLo[0]) / 2;
gLo = [-half, gLo[1], gLo[2]];
gHi = [half, gHi[1], gHi[2]];

// ---- 1. the fit: the interior's glass bounds (the OBJ's RaGlass) onto the hull's
const IG_LO: V3 = [-2.53, 1.11, -3.07], IG_HI: V3 = [2.53, 2.08, 5.06];
// (its own proportions, the film's — the cabin is never seen with the hull: from inside alone): moved only,
// its windows' centre on the hull's along and across, their tops level
const S: V3 = [1, 1, 1];
const T: V3 = [((gLo[0] + gHi[0]) - (IG_LO[0] + IG_HI[0])) / 2, gHi[1] - IG_HI[1], ((gLo[2] + gHi[2]) - (IG_LO[2] + IG_HI[2])) / 2];
console.log("fit: scale", S.map((x) => x.toFixed(3)).join(", "), "offset", T.map((x) => x.toFixed(3)).join(", "));
const P = new Float32Array(nv0 * 3), N = new Float32Array(nv0 * 3);
for (let i = 0; i < nv0; i++) {
  for (let k = 0; k < 3; k++) P[3 * i + k] = RV[11 * i + k]! * S[k]! + T[k]!;
  // (normals: the inverse transpose of the scale)
  const n = [0, 1, 2].map((k) => RV[11 * i + 3 + k]! / S[k]!);
  const l = Math.hypot(...n) || 1;
  for (let k = 0; k < 3; k++) N[3 * i + k] = n[k]! / l;
}

// ---- 2. all of it kept: drawn alone from inside (the hull from outside), nothing has to fit
const keep: number[] = Array.from(RI);
// the vertices kept, renumbered
const remap = new Int32Array(nv0).fill(-1);
const order: number[] = [];
for (const v of keep) if (remap[v]! < 0) (remap[v] = order.length), order.push(v);
const nv = order.length;
const idx = new Uint32Array(keep.map((v) => remap[v]!));

// ---- 3. the light baked: AO and the sky seen, against the hull's opaque parts and the interior
const ipos = new Float32Array(nv * 3);
order.forEach((v, i) => ipos.set(P.subarray(3 * v, 3 * v + 3), 3 * i));
// (the interior alone — drawn without the hull from inside —, its glass let through)
const occTriL: number[] = [];
for (let t = 0; t < idx.length / 3; t++) {
  const m = Math.round(RV[11 * order[idx[3 * t]!]! + 6]!);
  if (m !== 71) occTriL.push(idx[3 * t]!, idx[3 * t + 1]!, idx[3 * t + 2]!);
}
const occPos = ipos;
const occTri = new Uint32Array(occTriL);
const occ = new TriBVH(occPos, occTri);
const RAYS = 64, AO_R = 1.2, FAR = 30;
const dirs: V3[] = [];
for (let i = 0; i < RAYS; i++) {
  const r = Math.sqrt((i + 0.5) / RAYS);
  const ph = i * 2.399963229728653;
  dirs.push([r * Math.cos(ph), r * Math.sin(ph), Math.sqrt(1 - r * r)]);
}
// the screens: each its own rectangle of the (missing) texture atlas — its UVs made 0…1 on it, and a
// number (its content: horizon, telemetry, orbit, radar, systems)
const screenRect = new Map<number, { u0: number; u1: number; v0: number; v1: number; k: number }>();
for (const v of order) {
  if (Math.round(RV[11 * v + 6]!) !== 68) continue;
  const h = RV[11 * v + 8]!;
  const r = screenRect.get(h) ?? { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity, k: screenRect.size };
  r.u0 = Math.min(r.u0, RV[11 * v + 9]!); r.u1 = Math.max(r.u1, RV[11 * v + 9]!);
  r.v0 = Math.min(r.v0, RV[11 * v + 10]!); r.v1 = Math.max(r.v1, RV[11 * v + 10]!);
  screenRect.set(h, r);
}
console.log(`${screenRect.size} screens`);
const out = new Float32Array(nv * 10);
const t0 = performance.now();
let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < nv; i++) {
  const v = order[i]!;
  const p: V3 = [P[3 * v]!, P[3 * v + 1]!, P[3 * v + 2]!];
  const n: V3 = [N[3 * v]!, N[3 * v + 1]!, N[3 * v + 2]!];
  for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, p[k]!)), (hi[k] = Math.max(hi[k]!, p[k]!));
  const mat = RV[11 * v + 6]!;
  const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1: V3 = [n[1] * ax[2]! - n[2] * ax[1]!, n[2] * ax[0]! - n[0] * ax[2]!, n[0] * ax[1]! - n[1] * ax[0]!];
  const l1 = Math.hypot(...t1);
  for (let k = 0; k < 3; k++) t1[k]! /= l1;
  const t2: V3 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
  const o: V3 = [p[0] + n[0] * 0.004, p[1] + n[1] * 0.004, p[2] + n[2] * 0.004];
  // (the pattern turned per vertex: banding into fine noise)
  const rot = ((Math.sin(p[0] * 12.9898 + p[1] * 78.233 + p[2] * 37.719) * 43758.5453) % 1) * 2 * Math.PI;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  let ao = 0, sky = 0;
  for (const [x0, y0, z] of dirs) {
    const x = x0 * cr - y0 * sr, y = x0 * sr + y0 * cr;
    const d: V3 = [t1[0] * x + t2[0] * y + n[0] * z, t1[1] * x + t2[1] * y + n[1] * z, t1[2] * x + t2[2] * y + n[2] * z];
    const h = occ.segment(o, [o[0] + d[0] * FAR, o[1] + d[1] * FAR, o[2] + d[2] * FAR]);
    if (!h) sky++;
    else if (h.t * FAR < AO_R) ao += 1 - (h.t * FAR) / AO_R;
  }
  const s = RV[11 * v + 7]!, hsh = RV[11 * v + 8]!;
  out.set([...p, ...n, mat, 1 - ao / RAYS], 10 * i);
  if (Math.round(mat) === 68) {
    const r = screenRect.get(hsh)!;
    const u = (RV[11 * v + 9]! - r.u0) / Math.max(r.u1 - r.u0, 1e-6), w = (RV[11 * v + 10]! - r.v0) / Math.max(r.v1 - r.v0, 1e-6);
    out.set([2 * r.k + Math.min(Math.max(u, 0), 0.999), Math.min(Math.max(w, 0), 0.999)], 10 * i + 8);
  }
  else out.set([sky / RAYS, Math.min(Math.round(s * 100), 9999) + Math.min(hsh, 0.999)], 10 * i + 8);
}
console.log(`light baked: ${nv} vertices × ${RAYS} rays in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

// the sticks' pivots: the foot of each grip (its lowest, centred)
const piv: V3[] = [];
for (const side of [1, -1]) {
  let y0 = Infinity, sx = 0, sz = 0, n = 0;
  for (let i = 0; i < nv; i++) if (Math.round(out[10 * i + 6]!) === 72 && Math.sign(out[10 * i]!) === side) y0 = Math.min(y0, out[10 * i + 1]!);
  for (let i = 0; i < nv; i++) if (Math.round(out[10 * i + 6]!) === 72 && Math.sign(out[10 * i]!) === side) (sx += out[10 * i]!), (sz += out[10 * i + 2]!), n++;
  if (n) piv.push([sx / n, y0, sz / n]);
}
console.log("the sticks' pivots:", piv.map((p) => p.map((x) => x.toFixed(3)).join(", ")).join(" · "));
const head = new ArrayBuffer(40 + 4 + 16 * 2);
new Uint8Array(head, 0, 4).set(new TextEncoder().encode("CKPT"));
new Uint32Array(head, 4, 3).set([2, nv, idx.length]);
new Float32Array(head, 16, 6).set([...lo, ...hi]);
new Uint32Array(head, 40, 1).set([piv.length]);
piv.forEach((p, i) => new Float32Array(head, 44 + 16 * i, 4).set([...p, 0]));
const body = new Uint8Array(await new Blob([head, out, idx]).arrayBuffer());
await Bun.write("assets/ranger/cockpit.bin", Bun.gzipSync(body, { level: 9 }));
console.log(`assets/ranger/cockpit.bin: ${nv} vertices, ${idx.length / 3} triangles, ${(body.byteLength / 1e6).toFixed(1)} MB → gzip ${(Bun.file("assets/ranger/cockpit.bin").size / 1e6).toFixed(1)} MB; bounds ${lo.map((x) => x.toFixed(2))} … ${hi.map((x) => x.toFixed(2))}`);
