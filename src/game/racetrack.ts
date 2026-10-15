// A holding pattern (docs/PLAN-AVIATION-AAA.md, F2 "hold here"): the racetrack over a fix — the inbound leg to
// it, a right turn of 180°, the outbound leg alongside, a right turn back — flown by following a point a few
// seconds ahead on it (a carrot): the heading to fly from where the craft is. In the fix's flat frame (east, north
// [m]). Pure.

type V2 = [number, number];

export interface Racetrack {
  /** the inbound course [rad, clockwise from north]; the legs' length [m]; the turns' radius [m] */
  inbound: number;
  leg: number;
  radius: number;
}

/** The turns' radius [m] at a speed [m/s] and a bank [rad]. */
export const holdRadius = (v: number, bank = (30 * Math.PI) / 180) => (v * v) / (9.81 * Math.tan(bank));

/** The racetrack's point at a distance `s` along it from its start (the inbound leg's far end) [m]. */
function at(R: Racetrack, s: number): V2 {
  const d: V2 = [Math.sin(R.inbound), Math.cos(R.inbound)];
  const r: V2 = [d[1], -d[0]];
  const L = R.leg,
    a = R.radius,
    turn = Math.PI * a,
    P = 2 * L + 2 * turn;
  let x = ((s % P) + P) % P;
  const A: V2 = [-d[0] * L, -d[1] * L];
  if (x < L) return [A[0] + d[0] * x, A[1] + d[1] * x];
  x -= L;
  if (x < turn) {
    // (round the fix's end, to the right: about the fix plus a radius to its right)
    const th = x / a;
    return [r[0] * a - r[0] * a * Math.cos(th) + d[0] * a * Math.sin(th), r[1] * a - r[1] * a * Math.cos(th) + d[1] * a * Math.sin(th)];
  }
  x -= turn;
  if (x < L) return [2 * a * r[0] - d[0] * x, 2 * a * r[1] - d[1] * x];
  x -= L;
  const th = x / a;
  const C: V2 = [A[0] + r[0] * a, A[1] + r[1] * a];
  return [C[0] + r[0] * a * Math.cos(th) - d[0] * a * Math.sin(th), C[1] + r[1] * a * Math.cos(th) - d[1] * a * Math.sin(th)];
}

/** Its length [m]. */
export const racetrackLength = (R: Racetrack) => 2 * R.leg + 2 * Math.PI * R.radius;

/** The heading to fly [rad] from `p` (east, north of the fix [m]): towards the racetrack's point `ahead` [m]
 *  beyond the nearest one, the way it is flown. Also that nearest point's distance [m] (off the pattern). */
export function racetrackHeading(R: Racetrack, p: V2, ahead: number): { hdg: number; off: number } {
  const P = racetrackLength(R);
  const n = 240;
  let best = 0,
    bd = Infinity;
  for (let i = 0; i < n; i++) {
    const q = at(R, (i / n) * P);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) (bd = d), (best = (i / n) * P);
  }
  const c = at(R, best + ahead);
  return { hdg: Math.atan2(c[0] - p[0], c[1] - p[1]), off: bd };
}

export { at as racetrackPoint };
