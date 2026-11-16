// How the ground is graded by the runways near a point — one calculation for the gear (terrain.ts earthHeightSampler, through
// sites.ts runwayGrade), the scenery's feet (system/scenery-worker.ts) and, by its WGSL twin (trace.wgsl runwayGrade, the same figures:
// change both), the drawn ground. Pure: the runways are handed in (no state, no DOM — the scenery's worker imports it).
//   flat  0…1 — the procedural detail taken off: the strip and its airfield, its clear zone 3 km before either threshold;
//   level 0…1 — the relief brought to the runway's level `elev`: the strip and 300 m past its ends, eased back;
//   cut   0…1 — the detail's share taken off where the ground is drawn and felt: flat, and (PLAN-J7 J7-1, Sam's decision of 16 Nov 2026:
//         the approaches judged on the data alone, carried to what the player touches) the approach funnel before either end of a real
//         airfield's runway — the detail invented there raised bumps under the final (+75 to +205 m at OIFK 11, the A320 flared on one).
//         The data (the tiles, the map) are not touched: only the made-up detail fades out.

export type V3 = [number, number, number];
export interface GradeRunway {
  origin: V3;
  along: V3;
  across: V3;
  len: number;
  halfWidth: number;
  /** trace.wgsl runwayFlags: 16 a real airfield's runway (its own width, no made-up apron) */
  flags: number;
  elev: number;
  /** a world runway whose level is being measured: left out (the relief under it read bare) */
  world?: { measuring: boolean };
}
export interface Grade {
  flat: number;
  level: number;
  /** the level's height [m] (that of the runway levelling most) */
  elev: number;
  /** the detail's share taken off: max(flat, the approach funnel's) */
  cut: number;
}
/** a runway's grading's figures [m] (the shader's runwayGrade holds the same: change both) */
export const RUNWAY_GRADE = { levelPast: 300, levelEase: 600, levelSide: 320, levelSideEase: 300 } as const;
/** the approach funnel (J7-1): from the threshold, the runway's half width and 80 m either side, widening to ±300 m 10 km out; faded over
 *  300 m along and across (trace.wgsl approachCut: the same) */
export const APPROACH_FUNNEL = { reach: 10000, half: 300, edge: 80, fade: 300 } as const;
/** how far past either end a runway grades anything [m] (the funnel, its half width and both fades): the cut of the near lists */
export const GRADE_REACH = APPROACH_FUNNEL.reach + 2 * APPROACH_FUNNEL.fade + APPROACH_FUNNEL.half;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The funnel's share at `a` along from the threshold and `c` across [m] (abs), beyond either end of a runway `L` long, `hw` half wide. */
export function approachCut(a: number, c: number, L: number, hw: number): number {
  const x = a < 0 ? -a : a > L ? a - L : 0;
  if (x <= 0) return 0;
  const F = APPROACH_FUNNEL;
  const start = hw + F.edge;
  const half = start + (Math.max(F.half, start) - start) * Math.min(x / F.reach, 1);
  return (1 - ease((x - F.reach) / F.fade)) * (1 - ease((c - half) / F.fade));
}

/** The grade at `point` (body-fixed metres on the WGS84 surface) from these runways. */
export function gradeAt(point: V3, runways: readonly GradeRunway[]): Grade {
  const g: Grade = { flat: 0, level: 0, elev: 0, cut: 0 };
  const G = RUNWAY_GRADE;
  for (const r of runways) {
    if (r.world?.measuring) continue;
    const d0 = point[0] - r.origin[0],
      d1 = point[1] - r.origin[1],
      d2 = point[2] - r.origin[2];
    const cut = r.len + GRADE_REACH;
    if (Math.abs(d0) > cut || Math.abs(d1) > cut || Math.abs(d2) > cut || d0 * d0 + d1 * d1 + d2 * d2 > cut * cut) continue;
    const a = d0 * r.along[0] + d1 * r.along[1] + d2 * r.along[2];
    const c = Math.abs(d0 * r.across[0] + d1 * r.across[1] + d2 * r.across[2]);
    // (the clear zone 3 km before either threshold: a runway lands both ways — W4)
    const wa = a < -3000 ? Math.max(0, 1 + (a + 3000) / 300) : a > r.len + 3000 ? Math.max(0, 1 - (a - r.len - 3000) / 300) : 1;
    // (the strip, the taxiway beside it, the apron and the buildings — PLAN-AEROPORTS A2, A3 —: 280 m out of
    // the axis, faded by 340; a world runway's — no made-up apron by it —: its own width and 80 m)
    const world = (r.flags & 16) !== 0;
    const side = world ? r.halfWidth + 80 : 280;
    const wc = c < side ? 1 : Math.max(0, 1 - (c - side) / 60);
    // (the level: the strip and its airfield, eased back to the relief — a world runway's its own width and 100 m,
    // eased over 200: its town, its trees kept by it)
    const out = Math.max(-G.levelPast - a, a - r.len - G.levelPast, 0);
    const la = 1 - ease(out / G.levelEase);
    const lc = 1 - ease((c - (world ? r.halfWidth + 100 : G.levelSide)) / (world ? 200 : G.levelSideEase));
    const level = la * lc;
    if (level > g.level) {
      g.level = level;
      g.elev = r.elev;
    }
    const flat = Math.max(wa * wc, level);
    g.flat = Math.max(g.flat, flat);
    // (a real airfield's runway: its approach funnel's detail off too)
    g.cut = Math.max(g.cut, flat, world ? approachCut(a, c, r.len, r.halfWidth) : 0);
  }
  return g;
}
