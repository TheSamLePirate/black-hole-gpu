// The traffic's plain airliners' landing gear (src/traffic/airliner-gear.ts — PROBLEMES « le train des avions dessinés sans
// gréement », 24 Nov 2026): the game's FlightGear A320's three legs (assets/a320/a320.bin, GNU GPL v2 — assets/a320/README.md),
// posed down under its weight (its rig: position 1, its oleos 0.12 m in), each triangle's finish by its material (the painted
// struts, fittings and links; the chromed sliding tubes; the wheels' tyres and hubs by their distance from the axle), welded and
// simplified (meshoptimizer), then put into each plain mesh — the A320's (assets/traffic/a320.bin) at its own place, the
// CRJ-900's (assets/traffic/crj900.bin) scaled onto its own wheels' places (those its supplied gear had, measured from the
// vertices build-airliners.ts left of it), its stubs under the belly cut out. Run again: the gear it had first taken out.
//   bun scripts/build-traffic-gear.ts            (writes assets/traffic/{a320,crj900}.bin; prints game/airtypes.ts's MESH gear)
import { MeshoptSimplifier } from "meshoptimizer";
import { A320Poser } from "../src/a320/pose";
import { parseA320, rigMatrices } from "../src/a320/rig";
import {
  type Box,
  filterTris,
  GEAR_MAT,
  type GearLeg,
  gearObject,
  isGearMat,
  legSimilar,
  applySimilar,
  readTrfc,
  type Similar,
  type Trfc,
  trianglesInBoxes,
  type V3,
  writeTrfc,
} from "../src/traffic/airliner-gear";

await MeshoptSimplifier.ready;
const OUT = "assets/traffic";

// ---- the A320's gear, posed down under its weight
const raw = new Uint8Array(await Bun.file("assets/a320/a320.bin").arrayBuffer());
const rig = parseA320((raw[0] === 0x1f ? Bun.gunzipSync(raw) : raw).slice().buffer as ArrayBuffer);
const pose = new A320Poser().step({
  dt: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  trim: 0,
  flapLever: 0,
  ias: 0,
  speedBrake: 0,
  groundSpoilers: 0,
  gear: 1,
  comp: [0.12, 0.12, 0.12],
  onGround: true,
  groundSpeed: 0,
  steer: 0,
  n1: [0, 0],
  reverser: [0, 0],
  alpha: 0,
});
const M = rigMatrices(rig, pose.props, {});
const NV = rig.verts.length / 10;
const partOf = (i: number) => Math.floor(rig.verts[10 * i + 7]!);
/** each rig part's leg: 0 the nose, 1 a main (its side by its place), −1 not the gear's */
const legOfPart = new Int8Array(rig.nodes.length + 1).fill(-1);
rig.nodes.forEach((n, k) => {
  const kinds = n.objects.map(gearObject);
  if (kinds.length && kinds.every((x) => x === "nose")) legOfPart[k + 1] = 0;
  else if (kinds.length && kinds.every((x) => x === "main" || x === "nose") && kinds.includes("main")) legOfPart[k + 1] = 1;
});
const posed = (i: number): V3 => {
  const k = 12 * partOf(i);
  const p = [rig.verts[10 * i]!, rig.verts[10 * i + 1]!, rig.verts[10 * i + 2]!];
  return [0, 1, 2].map((r) => M[k + 4 * r]! * p[0]! + M[k + 4 * r + 1]! * p[1]! + M[k + 4 * r + 2]! * p[2]! + M[k + 4 * r + 3]!) as V3;
};
const posedN = (i: number): V3 => {
  const k = 12 * partOf(i);
  const n = [rig.verts[10 * i + 3]!, rig.verts[10 * i + 4]!, rig.verts[10 * i + 5]!];
  const q = [0, 1, 2].map((r) => M[k + 4 * r]! * n[0]! + M[k + 4 * r + 1]! * n[1]! + M[k + 4 * r + 2]! * n[2]!);
  const l = Math.hypot(...q) || 1;
  return q.map((x) => x / l) as V3;
};
/** a triangle's finish: its wheel's tyre or hub (a spin node's part: by its centre's distance from the axle, at rest), the
 *  sliding tubes' chrome (the A320's material 113), the paint; null: a decal (105) left out */
function finish(t: number): number | null {
  const ids = [rig.idx[3 * t]!, rig.idx[3 * t + 1]!, rig.idx[3 * t + 2]!];
  const mat = Math.round(rig.verts[10 * ids[0]! + 6]!);
  if (mat === 105) return null;
  const node = rig.nodes[partOf(ids[0]!) - 1];
  if (node?.type === "spin") {
    const c = node.center!,
      a = node.axis!;
    const al = Math.hypot(...a);
    const ctr = [0, 1, 2].map((k) => ids.reduce((s, i) => s + rig.verts[10 * i + k]!, 0) / 3);
    const d = ctr.map((x, k) => x - c[k]!);
    const along = (d[0]! * a[0] + d[1]! * a[1] + d[2]! * a[2]) / al;
    const r = Math.sqrt(Math.max(0, d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2 - along * along));
    return r > WHEEL_R[partOf(ids[0]!)]! * 0.66 ? GEAR_MAT.tyre : GEAR_MAT.hub;
  }
  return mat === 113 ? GEAR_MAT.chrome : GEAR_MAT.paint;
}
/** each wheel part's radius (its farthest vertex from its axle) */
const WHEEL_R: Record<number, number> = {};
rig.nodes.forEach((n, k) => {
  if (n.type !== "spin" || legOfPart[k + 1]! < 0) return;
  const c = n.center!,
    a = n.axis!,
    al = Math.hypot(...a);
  let R = 0;
  for (let i = 0; i < NV; i++) {
    if (partOf(i) !== k + 1) continue;
    const d = [0, 1, 2].map((j) => rig.verts[10 * i + j]! - c[j]!);
    const along = (d[0]! * a[0] + d[1]! * a[1] + d[2]! * a[2]) / al;
    R = Math.max(R, Math.sqrt(Math.max(0, d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2 - along * along)));
  }
  WHEEL_R[k + 1] = R;
});

/** the gear's pieces: by leg (0 nose, 1 left, 2 right) and finish, their posed vertices welded, simplified */
interface Piece {
  leg: number;
  mat: number;
  pos: number[];
  nrm: number[];
  idx: number[];
}
const pieces = new Map<string, { leg: number; mat: number; tris: number[] }>();
for (let t = 0; t < rig.idx.length / 3; t++) {
  const i0 = rig.idx[3 * t]!;
  const L = legOfPart[partOf(i0)]!;
  if (L < 0) continue;
  const f = finish(t);
  if (f === null) continue;
  const leg = L === 0 ? 0 : posed(i0)[0] > 0 ? 1 : 2;
  const key = `${leg}:${f}`;
  let P = pieces.get(key);
  if (!P) pieces.set(key, (P = { leg, mat: f, tris: [] }));
  P.tris.push(t);
}
const RATIO = 0.2;
const gear: Piece[] = [];
let trisIn = 0,
  trisOut = 0;
for (const P of pieces.values()) {
  // (welded by place: the rig's vertices split at their creases and seams — the normals averaged)
  const at = new Map<string, number>();
  const pos: number[] = [],
    nsum: number[] = [],
    idx: number[] = [];
  for (const t of P.tris)
    for (let k = 0; k < 3; k++) {
      const i = rig.idx[3 * t + k]!;
      const p = posed(i);
      const key = p.map((x) => x.toFixed(4)).join(",");
      let j = at.get(key);
      if (j === undefined) {
        j = pos.length / 3;
        at.set(key, j);
        pos.push(...p);
        nsum.push(0, 0, 0);
      }
      const n = posedN(i);
      nsum[3 * j] += n[0];
      nsum[3 * j + 1] += n[1];
      nsum[3 * j + 2] += n[2];
      idx.push(j);
    }
  const target = Math.max(3, Math.floor((idx.length * RATIO) / 3) * 3);
  const [s] = MeshoptSimplifier.simplify(new Uint32Array(idx), new Float32Array(pos), 3, target, 0.02, []);
  trisIn += idx.length / 3;
  trisOut += s.length / 3;
  const map = new Map<number, number>();
  const out: Piece = { leg: P.leg, mat: P.mat, pos: [], nrm: [], idx: [] };
  for (const j of s) {
    let k = map.get(j);
    if (k === undefined) {
      k = out.pos.length / 3;
      map.set(j, k);
      out.pos.push(pos[3 * j]!, pos[3 * j + 1]!, pos[3 * j + 2]!);
      const l = Math.hypot(nsum[3 * j]!, nsum[3 * j + 1]!, nsum[3 * j + 2]!) || 1;
      out.nrm.push(nsum[3 * j]! / l, nsum[3 * j + 1]! / l, nsum[3 * j + 2]! / l);
    }
    out.idx.push(k);
  }
  gear.push(out);
}
console.log(`the A320's gear: ${trisIn} triangles → ${trisOut} (meshoptimizer, ${RATIO} asked, error 2 %)`);

/** each leg's hinge on the A320 (its rig's turn of the leg, FlightGear's: its angle at position 0, its leg up) */
const legOf = (obj: string): GearLeg => {
  const n = rig.nodes.find((x) => x.type === "rotate" && x.objects.includes(obj))!;
  const t = n.table!;
  return { at: [...n.center!] as V3, axis: [...n.axis!] as V3, up: t[0]![1] };
};
const LEGS: GearLeg[] = [legOf("NLGFitting"), legOf("MLGFittingL"), legOf("MLGFittingR")];
/** a leg's wheels' centre and radius (posed): its tyres' box */
function wheelsOf(leg: number) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const P of gear)
    if (P.leg === leg && P.mat === GEAR_MAT.tyre)
      for (let i = 0; i < P.pos.length; i += 3)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, P.pos[i + k]!);
          hi[k] = Math.max(hi[k]!, P.pos[i + k]!);
        }
  return { c: [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2) as V3, r: (hi[2]! - lo[2]!) / 2, bottom: lo[1]! };
}

/** The gear put into a plain mesh: each leg carried by its similarity; the mesh's gear baked before and the boxes' parts (its
 *  old stubs) taken out first. */
async function build(name: string, T: Similar[], cut: Box[]) {
  let m: Trfc = readTrfc(await Bun.file(`${OUT}/${name}.bin`).arrayBuffer());
  const n0 = m.idx.length / 3;
  m = filterTris(m, (t) => !isGearMat(m.verts[10 * m.idx[3 * t]! + 6]!));
  const stubs = cut.length ? trianglesInBoxes(m, cut) : new Uint8Array(m.idx.length / 3);
  const nStub = stubs.reduce((a, b) => a + b, 0);
  m = filterTris(m, (t) => !stubs[t]);
  const verts: number[] = [...m.verts];
  const idx: number[] = [...m.idx];
  for (const P of gear) {
    const S = T[P.leg]!;
    const base = verts.length / 10;
    for (let i = 0; i < P.pos.length / 3; i++) {
      const p = applySimilar(S, [P.pos[3 * i]!, P.pos[3 * i + 1]!, P.pos[3 * i + 2]!]);
      verts.push(p[0]!, p[1]!, p[2]!, P.nrm[3 * i]!, P.nrm[3 * i + 1]!, P.nrm[3 * i + 2]!, P.mat, 1 + P.leg, 0, 0);
    }
    for (const j of P.idx) idx.push(base + j);
  }
  const out: Trfc = { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
  await Bun.write(`${OUT}/${name}.bin`, writeTrfc(out));
  const legs = LEGS.map((L, k) => legSimilar(T[k]!, L));
  const W = [0, 1, 2].map((k) => {
    const w = wheelsOf(k);
    return applySimilar(T[k]!, [w.c[0], w.bottom, w.c[2]])[1];
  });
  const f = (v: readonly number[]) => `[${v.map((x) => +x.toFixed(3)).join(", ")}]`;
  console.log(
    `${name}: ${n0} triangles in, ${nStub} stub triangles cut, ${out.idx.length / 3} out (${out.verts.length / 10} vertices); wheels' bottoms ${W.map((x) => x.toFixed(3)).join(", ")} m`,
  );
  console.log(
    `  MESH.${name === "a320" ? "a320t" : name}.gear: { nose: { at: ${f(legs[0]!.at)}, axis: ${f(legs[0]!.axis)}, up: ${+legs[0]!.up.toFixed(2)} }, main: { at: ${f(legs[1]!.at)}, axis: ${f(legs[1]!.axis)}, up: ${+legs[1]!.up.toFixed(2)} } }, wheels: ${(-Math.min(...W)).toFixed(2)}`,
  );
}

/** A leg put on a mesh: its wheels' centre there and their radius (the A320's scaled to it about their centre), its hinge's height
 *  there [m] (its struts squashed above its wheels to reach it: the mesh's wing or belly about it — its fitting hidden inside) */
function place(leg: number, c: V3, r: number, hingeY: number): Similar {
  const w = wheelsOf(leg);
  const s = r / w.r;
  const top = w.c[1] + w.r;
  const H = LEGS[leg]!.at[1];
  // (the hinge's height over the wheels' top: the A320's × s × k = the mesh's)
  const k = (hingeY - (c[1] + r)) / (s * (H - top));
  return { from: w.c, to: c, s, squash: { above: top, k } };
}

// ---- the A320 (the plain mesh, 37.7 m — the rig's 37.6 m): its belly at y = −1.61 (the rig's at 0), its nose 2.32 m back; its
// mains' hinges mid-wing (its wing there 0.64…0.22 m under its origin, the rig's thicker — the fitting had stood out of it), the
// nose's as the rig's
const A = (leg: number, hingeY?: number): Similar => {
  const w = wheelsOf(leg);
  const c: V3 = [w.c[0], w.c[1] - 1.61, w.c[2] - 2.32];
  return place(leg, c, w.r, hingeY ?? LEGS[leg]!.at[1] - 1.61);
};
await build("a320", [A(0), A(1, -0.43), A(2, -0.43)], []);

// ---- the CRJ-900: its own wheels' places (its supplied gear's, cut by build-airliners.ts — its vertices measured before this
// script first ran: the mains' twin wheels about x ±2.11, z −1.675, 0.99 m across, their bottom 2.19 m under its origin; the
// nose's about z 15.59, 0.64 m across), the nose's bottom level with the mains' (the supplied model stood 0.8° nose up); the
// mains' hinges mid-wing (its wing there 0.63…0.26 m under its origin), the nose's 0.5 m inside its fuselage (its belly there
// 0.80 m under its origin)
const BOTTOM = -2.19;
const CRJ: Similar[] = [
  place(0, [0, BOTTOM + 0.32, 15.59], 0.32, -0.3),
  place(1, [2.11, BOTTOM + 0.495, -1.675], 0.495, -0.45),
  place(2, [-2.11, BOTTOM + 0.495, -1.675], 0.495, -0.45),
];
// (its stubs: what the cut left of its legs under the belly — the nose leg's top about z 15.1…15.9, the mains' about x ±1.9…3.3)
const CUT: Box[] = [
  [
    [-0.35, -1.5, 14.9],
    [0.35, -0.25, 16.0],
  ],
  [
    [1.8, -1.35, -2.2],
    [3.35, -0.3, -1.2],
  ],
  [
    [-3.35, -1.35, -2.2],
    [-1.8, -0.3, -1.2],
  ],
];
await build("crj900", CRJ, CUT);
