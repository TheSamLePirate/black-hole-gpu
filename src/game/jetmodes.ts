// The F-35's new autopilot modes (docs/PLAN-AVIATION-AAA.md, A3): an orbit over a point — the circle at a radius, to
// the right or the left, its heading the circle's tangent bent towards it by the gap —; the terrain following — the
// flight path that clears everything ahead by the height asked, the "ski toe" over the profile (the steepest climb
// any point within the look-ahead asks, a gentle descent after) —; the tanker's track for a rendezvous. Pure.

const D = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export const MODES = {
  /** an orbit's radius by default [m]; the bend towards the circle [rad per radius off], at most [rad] */
  orbitR: 4000,
  orbitBend: 60 * D,
  /** the orbit's bank at most [rad] (a tight circle at a fighter's speed) */
  orbitBank: 55 * D,
  /** the terrain following: the heights offered [m], the look-ahead [s], its flight path's bounds [rad] */
  tfHeights: [100, 150, 300] as const,
  tfAhead: 14,
  tfClimb: 20 * D,
  tfDive: -12 * D,
  /** the tanker: its height [m], speed [m/s], its racetrack's legs [m]; the pre-contact slot behind and below [m] */
  tankerH: 7000,
  tankerV: 210,
  tankerLeg: 30_000,
  preContact: { right: 0, back: 50, up: -10 },
};

/**
 * An orbit's heading [rad] from where we are (east, north of its centre [m]): the circle's tangent the way it is
 * flown (`dir` +1 to the right — clockwise —, −1 to the left), bent towards the circle by the gap (inwards when out,
 * outwards when in) — from far, nearly straight at it.
 */
export function orbitHeading(p: readonly [number, number], R: number, dir: 1 | -1): number {
  const r = Math.hypot(p[0], p[1]);
  const th = Math.atan2(p[0], p[1]);
  const bend = clamp(((r - R) / R) * MODES.orbitBend, -45 * D, 85 * D);
  return wrap(th + dir * (90 * D + bend));
}

/**
 * The terrain following's flight path [rad]: from our height `h` [m over the sea] at speed V, the steepest asked by
 * any point of the ground ahead (`ground(x)`: its height `x` m along the track) to pass it `agl` over — a gentle
 * descent when nothing asks (to the height over the ground under and just ahead).
 */
export function tfGamma(h: number, V: number, agl: number, ground: (x: number) => number): number {
  let want = -Infinity;
  const far = Math.max(V * MODES.tfAhead, 2000);
  for (let x = 400; x <= far; x += 200) want = Math.max(want, Math.atan2(ground(x) + agl - h, x));
  // (the ground right under: its height kept as the floor of the descent)
  const under = Math.atan2(Math.max(ground(0), ground(200)) + agl - h, 1500);
  return clamp(Math.max(want, under), MODES.tfDive, MODES.tfClimb);
}

/** The tanker's racetrack: four corners (east, north from its anchor [m]) — its legs along `hdg` [rad], 10 km apart. */
export function tankerTrack(hdg: number): [number, number][] {
  const L = MODES.tankerLeg;
  const f: [number, number] = [Math.sin(hdg), Math.cos(hdg)];
  const r: [number, number] = [Math.cos(hdg), -Math.sin(hdg)];
  const W = 10_000;
  return [
    [f[0] * L, f[1] * L],
    [f[0] * L + r[0] * W, f[1] * L + r[1] * W],
    [r[0] * W, r[1] * W],
    [0, 0],
  ];
}
