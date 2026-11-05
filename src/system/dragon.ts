// Q6-ISS — a Crew Dragon docked to the station (the live streams show one at Harmony's forward port: Sen's docking camera,
// "Harmony forward port: Crew Dragon Grace · Crew-13", 4 Nov 2026): a plain procedural capsule in the station model's vertex
// format (station.ts: position 3 × f32 [m, the station's frame at rest]; normal snorm8 × 4; colour unorm8 × 4 — sRGB, alpha the
// surface kind: 0 hull, 1 solar cells —; part u8 × 4, 0 the station's), built along a port's outward axis from its ring:
//  - the docking adapter and the nose's open cone, Ø 1.6 m, 0.5 m long;
//  - the capsule's frustum, Ø 1.8 → 3.7 m over 2.8 m, white, four dark windows' band near its top;
//  - its heat shield's rim, Ø 4.0 m, a dark ring;
//  - the trunk, Ø 3.7 m, 2.8 m long, half its round in solar cells (dark blue), half white radiator; its fins left out.
// Dimensions after SpaceX's published figures (8.1 m long with the trunk, 4 m across); the shapes are a stand-in, not its model.

import type { Vec3 } from "../physics";

/** a vertex's bytes (station.ts STRIDE) */
export const DRAGON_STRIDE = 24;

interface Ring {
  /** along the axis from the port's ring [m], radius [m] */
  s: number;
  r: number;
}

/** The capsule's profile: rings along the axis, each band between two rings one material */
const PROFILE: { a: Ring; b: Ring; colour: [number, number, number]; kind: number }[] = [
  // (the docking adapter, then the nose's open cone)
  { a: { s: 0, r: 0.8 }, b: { s: 0.5, r: 0.8 }, colour: [150, 150, 152], kind: 0 },
  { a: { s: 0.5, r: 0.8 }, b: { s: 0.7, r: 0.95 }, colour: [235, 235, 232], kind: 0 },
  // (the capsule: its top white, the windows' band dark, then white down to the shield)
  { a: { s: 0.7, r: 0.95 }, b: { s: 1.2, r: 1.25 }, colour: [235, 235, 232], kind: 0 },
  { a: { s: 1.2, r: 1.25 }, b: { s: 1.45, r: 1.4 }, colour: [40, 42, 48], kind: 0 },
  { a: { s: 1.45, r: 1.4 }, b: { s: 3.5, r: 1.85 }, colour: [235, 235, 232], kind: 0 },
  // (the heat shield's rim)
  { a: { s: 3.5, r: 1.85 }, b: { s: 3.65, r: 2.0 }, colour: [60, 58, 55], kind: 0 },
  { a: { s: 3.65, r: 2.0 }, b: { s: 3.75, r: 1.85 }, colour: [60, 58, 55], kind: 0 },
  // (the trunk: drawn twice below — its solar half, its white half)
  { a: { s: 3.75, r: 1.85 }, b: { s: 6.55, r: 1.85 }, colour: [230, 230, 228], kind: 0 },
];
/** the trunk's band (its index above): half its round solar cells */
const TRUNK = PROFILE.length - 1;
const SEGMENTS = 32;

/**
 * The capsule docked at a port — its ring's centre and outward axis, the station's frame at rest —: its vertex bytes and
 * triangle indices (vertex indices from `base`, the station mesh's vertex count, the Dragon's appended after it).
 */
export function dragonMesh(
  centre: Vec3,
  axis: Vec3,
  base = 0,
): { vertices: Uint8Array<ArrayBuffer>; indices: Uint32Array<ArrayBuffer>; count: number } {
  const n = Math.hypot(...axis) || 1;
  const a: Vec3 = [axis[0] / n, axis[1] / n, axis[2] / n];
  // (two axes across: any perpendicular, then their cross)
  const ref: Vec3 = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  let u: Vec3 = [a[1] * ref[2] - a[2] * ref[1], a[2] * ref[0] - a[0] * ref[2], a[0] * ref[1] - a[1] * ref[0]];
  const ul = Math.hypot(...u);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v: Vec3 = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  const verts: number[][] = [];
  const idx: number[] = [];
  const push = (p: Vec3, nrm: Vec3, c: [number, number, number], kind: number) => {
    verts.push([...p, ...nrm, ...c, kind]);
    return verts.length - 1;
  };
  PROFILE.forEach((band, bi) => {
    const { a: r0, b: r1 } = band;
    // (the side's normal: tilted by the band's slope)
    const ds = r1.s - r0.s,
      dr = r1.r - r0.r;
    const len = Math.hypot(ds, dr) || 1;
    const na = -dr / len,
      nr = ds / len;
    const ring = (s: number, r: number, k: number) => {
      const t = (k / SEGMENTS) * 2 * Math.PI;
      const ct = Math.cos(t),
        st = Math.sin(t);
      const radial: Vec3 = [u[0] * ct + v[0] * st, u[1] * ct + v[1] * st, u[2] * ct + v[2] * st];
      const p: Vec3 = [0, 1, 2].map((i) => centre[i]! + a[i]! * s + radial[i]! * r) as Vec3;
      const nm: Vec3 = [0, 1, 2].map((i) => radial[i]! * nr + a[i]! * na) as Vec3;
      // (the trunk's half facing +u its solar cells)
      const solar = bi === TRUNK && ct > 0;
      return push(p, nm, solar ? [28, 36, 70] : band.colour, solar ? 1 : band.kind);
    };
    for (let k = 0; k < SEGMENTS; k++) {
      const i00 = ring(r0.s, r0.r, k),
        i01 = ring(r0.s, r0.r, k + 1),
        i10 = ring(r1.s, r1.r, k),
        i11 = ring(r1.s, r1.r, k + 1);
      idx.push(i00, i10, i11, i00, i11, i01);
    }
  });
  // (the trunk's open end closed: a disc, facing outward)
  const end = PROFILE[TRUNK]!.b;
  const tip = push([0, 1, 2].map((i) => centre[i]! + a[i]! * end.s) as Vec3, a, [200, 200, 198], 0);
  const rim: number[] = [];
  for (let k = 0; k <= SEGMENTS; k++) {
    const t = (k / SEGMENTS) * 2 * Math.PI;
    const p: Vec3 = [0, 1, 2].map((i) => centre[i]! + a[i]! * end.s + (u[i]! * Math.cos(t) + v[i]! * Math.sin(t)) * end.r) as Vec3;
    rim.push(push(p, a, [200, 200, 198], 0));
  }
  for (let k = 0; k < SEGMENTS; k++) idx.push(tip, rim[k + 1]!, rim[k]!);
  const vertices = new Uint8Array(verts.length * DRAGON_STRIDE);
  const dv = new DataView(vertices.buffer);
  verts.forEach((w, i) => {
    const o = i * DRAGON_STRIDE;
    for (let k = 0; k < 3; k++) dv.setFloat32(o + 4 * k, w[k]!, true);
    for (let k = 0; k < 3; k++) dv.setInt8(o + 12 + k, Math.max(-127, Math.min(127, Math.round(w[3 + k]! * 127))));
    dv.setInt8(o + 15, 0);
    for (let k = 0; k < 4; k++) dv.setUint8(o + 16 + k, w[6 + k]!);
    // (part 0: the station's own frame)
    dv.setUint8(o + 20, 0);
  });
  return { vertices, indices: Uint32Array.from(idx, (k) => k + base), count: idx.length };
}
