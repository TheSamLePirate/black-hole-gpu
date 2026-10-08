// The approach procedures (PLAN-AEROPORTS A5): each site's chart — for a runway end, the Ranger's own
// approach as the Shuttle's (the entry, the final approach fix, the pull-up, the decision height, the
// touchdown on the steep-then-shallow profile, controller/util.ts landingProfile) and its missed approach
// (climb ahead on the engines, turn back left, out along the reciprocal 8 km to the side, climbing to 3 km,
// to a hold 20 km out — the turn onto the final from there, as the circuit's); for a pad (the Lander's
// powered descent), its high and low gates, its minima, its missed approach (climb to 500 m and hold).
// Pure: the tablet's charts draw it, the HUD marks its fixes, the autopilot goes around at its minima.

import { finalGate, LANDING, landingProfile } from "../controller/util";
import { RUNWAY_LENGTH, type Site } from "./sites";

export type FixId = "IAF" | "FAF" | "PU" | "DH" | "TD" | "MA" | "MAHF" | "HG" | "LG";

/** A fix of the chart, on the runway's (or the pad's) axis frame: along from the threshold (< 0 before it),
 *  across to the right, its height over the ground there [m]. */
export interface Fix {
  id: FixId;
  along: number;
  across: number;
  h: number;
}

export interface Procedure {
  kind: "runway" | "pad";
  /** the runway end's heading [°] (a pad: none) */
  rwy: number | null;
  fixes: Fix[];
  /** the missed approach's fixes, in order */
  missed: Fix[];
  /** the decision height [m] and the visibility asked [m] */
  minima: { dh: number; vis: number };
}

/** the decision height on a runway's final [m]: the shallow glide's, 1.1 km before the touchdown */
export const RUNWAY_DH = 60;
/** the missed approach: straight ahead to 1 500 m, a left turn back, out along the reciprocal 8 km to the left
 *  climbing to 3 km, to its hold 20 km before the threshold — the approach's turn onto the final from there */
export const MISSED_TURN_H = 1500;
export const MISSED_SIDE = -8000;
export const MISSED_HOLD = -20000;
export const MISSED_TOP_H = 3000;
/** stabilised at the minima: within 45 m of the axis (the runway's half width with its shoulder: the MLS's
 *  quarter of a dot there) and 30 m of the profile's height */
export const STABLE_AXIS = 45;
export const STABLE_H = 30;

/** Why the approach is not stabilised at the decision height (null: it is) — off the axis by `across` [m],
 *  off the profile by `dh` [m] (> 0: high). The Ranger's autoland: no visual reference asked. */
export function unstableWhy(across: number, dh: number): { what: "axis" | "high" | "low"; by: number } | null {
  if (Math.abs(across) > STABLE_AXIS) return { what: "axis", by: Math.abs(across) };
  if (Math.abs(dh) > STABLE_H) return { what: dh > 0 ? "high" : "low", by: Math.abs(dh) };
  return null;
}

/** where the profile is `h` high on its shallow glide [m along] (bisected: the profile falls monotonically there) */
function alongAt(h: number): number {
  const fix = { go: LANDING.goNom, lb: 3000 };
  let lo = -12000,
    hi = LANDING.td;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (landingProfile(mid, 0, 150, fix).h > h) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** A site's procedure (a runway: the end given — sites.ts landingEnd picks it into the wind). */
export function procedureFor(site: Site): Procedure {
  if (site.runway && site.rwy !== undefined) {
    const fix = { go: LANDING.goNom, lb: 3000 };
    const pu = landingProfile(-12000, 0, 200, fix);
    const xC = pu.aim - LANDING.hC / Math.tan(LANDING.goNom);
    return {
      kind: "runway",
      rwy: site.rwy,
      fixes: [
        { id: "IAF", along: -25000, across: 0, h: Math.round(finalGate(25e3)) },
        { id: "FAF", along: -12000, across: 0, h: Math.round(finalGate(12e3)) },
        { id: "PU", along: Math.round(xC), across: 0, h: LANDING.hC },
        { id: "DH", along: Math.round(alongAt(RUNWAY_DH)), across: 0, h: RUNWAY_DH },
        { id: "TD", along: LANDING.td, across: 0, h: 0 },
      ],
      missed: [
        { id: "MA", along: RUNWAY_LENGTH + 3000, across: 0, h: MISSED_TURN_H },
        { id: "MAHF", along: MISSED_HOLD, across: MISSED_SIDE, h: MISSED_TOP_H },
      ],
      minima: { dh: RUNWAY_DH, vis: 800 },
    };
  }
  return {
    kind: "pad",
    rwy: null,
    fixes: [
      { id: "HG", along: -2000, across: 0, h: 2000 },
      { id: "LG", along: -100, across: 0, h: 100 },
      { id: "DH", along: 0, across: 0, h: 30 },
      { id: "TD", along: 0, across: 0, h: 0 },
    ],
    missed: [{ id: "MAHF", along: 0, across: 0, h: 500 }],
    minima: { dh: 30, vis: 400 },
  };
}
