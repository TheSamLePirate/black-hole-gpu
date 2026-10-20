// A spacecraft's automatic protections (docs/PLAN-VAISSEAUX-AAA.md, X1b), the F-35's Auto-GCAS and Auto-ACAS made for
// the Ranger, the Lander and the Endurance — pure: what the frame's figures foretell.
//  - the ground: coming down on the engines faster than they can still stop it above it (the thrust's 90 %, the time
//    to turn and spool up, a margin) — a caution first, then the hover;
//  - the keep-out sphere: closing on the station or a craft inside 200 m faster than its limit — 0.05 m/s + 0.5 % of
//    the range (1 m/s at its edge, 0.1 m/s at 10 m, as a crew slows inside the station's sphere) — a caution at one and a
//    half times it, station keeping at twice.

export type GuardLevel = "none" | "warn" | "act";

/** The figures: the thrust's share counted, the touchdown's speed kept [m/s], the time to turn and spool [s], the
 *  margin [m]; the keep-out sphere [m], the closing's multiples of the nominal (caution, action). */
export const GUARD = { thrust: 0.9, vTouch: 1.5, react: 2, margin: 20, warnMargin: 60, warnReact: 4, kos: 200, kWarn: 1.5, kAct: 2 };

/** The keep-out sphere's closing limit at a range [m/s]. */
export const kosLimit = (range: number) => 0.05 + 0.005 * Math.max(range, 0);

/**
 * The ground: height over it [m], the descent [m/s, down positive], the thrust over the weight, the local gravity
 * [m/s²], the crash speed [m/s]. Acts only when a crash is coming (faster than 80 % of the crash speed) and the stop
 * no longer fits; the caution earlier.
 */
export function groundGuard(h: number, vDown: number, twr: number, g: number, crash: number): { level: GuardLevel; stop: number } {
  if (!(h > 0) || !(vDown > 0) || !(g > 0)) return { level: "none", stop: 0 };
  const net = (GUARD.thrust * twr - 1) * g;
  const stop = net > 0 ? Math.max(vDown * vDown - GUARD.vTouch * GUARD.vTouch, 0) / (2 * net) : Infinity;
  if (vDown < 0.8 * crash) return { level: "none", stop };
  if (h < 1.2 * stop + vDown * GUARD.react + GUARD.margin) return { level: "act", stop };
  if (h < 1.8 * stop + vDown * (GUARD.react + GUARD.warnReact) + GUARD.warnMargin) return { level: "warn", stop };
  return { level: "none", stop };
}

/** The keep-out sphere: the range [m] and the closing [m/s, closing positive]. */
export function kosGuard(range: number, closing: number): { level: GuardLevel; limit: number } {
  const limit = kosLimit(range);
  if (range > GUARD.kos || closing <= 0) return { level: "none", limit };
  if (closing > GUARD.kAct * limit) return { level: "act", limit };
  if (closing > GUARD.kWarn * limit) return { level: "warn", limit };
  return { level: "none", limit };
}
