// Mars's seasons (PLAN-PLANETES-AAA, after P7): its solar longitude Ls at a date, from the game's own ephemeris — the Sun's
// place seen from Mars along its orbit, from its northern spring's equinox (the Sun crossing its equator northwards) —, the
// edges of its seasonal CO₂ caps by Ls, and its dust devils' season in each hemisphere. trace.wgsl reads them in Params.mars
// (marsFrost, marsDevils).
//
// The caps' edges [° of latitude] every 30° of Ls, from the orbiters' records: the south cap's from TES (Kieffer et al. 2000,
// JGR 105, 9653; Piqueux et al. 2015, Icarus 251, 332 — eight Mars years, ±2° from one to the next): forming at Ls ~0 near
// the pole, ~52° S by Ls 90, its widest ~50° S in the southern winter, receding from Ls 180 (the "cryptic" spring), gone by
// Ls ~300 but for its residual cap (~87° S, in the map); the north cap's from MOC and TES (James & Cantor 2001, Icarus 154,
// 131; Piqueux et al. 2015): ~55–58° N in the northern winter, back to ~84° N by the summer solstice (Ls 90), none from
// Ls ~120 to ~180 (its residual water-ice cap, in the map), forming again under the polar hood from Ls ~180. 90: none.
// The dust devils (Cantor et al. 2006, JGR 111, E12002; Greeley et al. 2006, Spirit's Gusev): in each hemisphere's spring
// and summer afternoons, the southern summer's — Mars at perihelion — the busiest.

import { ourState } from "./our-side";
import { SOLAR_BODIES, spinVector } from "./solar";

const LS_STEP = 30;
/** the caps' edges [°] at Ls 0, 30, … 360 (the last the first again) */
export const NORTH_CAP = [60, 63, 71, 84, 90, 90, 88, 75, 64, 58, 55, 56, 60];
export const SOUTH_CAP = [78, 63, 56, 52, 50, 50, 54, 60, 68, 80, 90, 90, 78];

const unit = (a: number[]) => {
  const l = Math.hypot(...a) || 1;
  return a.map((x) => x / l);
};
const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Mars's solar longitude at the scene's time t [M] [°, 0 … 360): the Sun seen from Mars along its orbit's plane, from the
 *  equinox where it crosses Mars's equator northwards. */
export function marsLs(t: number): number {
  const M = ourState("mars", t),
    S = ourState("sun", t);
  const r = [0, 1, 2].map((i) => M.pos[i]! - S.pos[i]!),
    v = [0, 1, 2].map((i) => M.vel[i]! - S.vel[i]!);
  const h = unit(cross(r, v));
  const pole = unit(spinVector(SOLAR_BODIES.find((b) => b.id === "mars")!, t));
  const s = unit(r.map((x) => -x));
  const e = unit(cross(pole, h));
  const ls = (Math.atan2(dot(cross(e, s), h), dot(e, s)) * 180) / Math.PI;
  return (ls + 360) % 360;
}

const at = (table: number[], ls: number) => {
  const x = (((ls % 360) + 360) % 360) / LS_STEP;
  const i = Math.floor(x);
  const f = x - i;
  return table[i]! * (1 - f) + table[i + 1]! * f;
};
/** The seasonal caps' edges at Ls [° of latitude]: north (90: none), south (−90: none). */
export function capEdges(ls: number): { north: number; south: number } {
  return { north: at(NORTH_CAP, ls), south: -at(SOUTH_CAP, ls) };
}

/** The dust devils' season (0 … 1) in each hemisphere at Ls: their spring and summer — the northern's from Ls 0 to 180,
 *  its peak near the solstice; the southern's from Ls 180 to 360, a third busier (perihelion). */
export function devilSeason(ls: number): { north: number; south: number } {
  const s = Math.sin((ls * Math.PI) / 180);
  return { north: Math.max(0, s) ** 0.7 * 0.75, south: Math.min(1, Math.max(0, -s) ** 0.7) };
}
