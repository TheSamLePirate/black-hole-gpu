// A player shot down in a room (ui/netmatch.ts — docs/NETWORK.md, "Shot down"): his craft out of control as the
// fight's own wrecks are (game/combat.ts wreckStep) — its wings no longer lifting, falling to some 170 m/s down
// through the air's drag, its nose dropping to where it goes and rolling round it — down to the ground or the sea,
// where it explodes. In the Earth's own coordinates [m] (fixed to it: the network's — net/remote.ts), down along
// the WGS84 normal, the ground's height over the ellipsoid and its relief given (system/our-surface.ts
// heightOverGround). Pure: the caller places the craft from it each frame.

type Vec3 = [number, number, number];

const G = 9.80665;
/** a fighter's wreck's terminal speed [m/s]: nose down, its wings no longer lifting (game/combat.ts wreckStep's
 *  drones and aggressors: 170) */
export const WRECK_VT = 240;
/** a fall longer than this [s] (a high one): broken up in the air there */
export const FALL_CAP = 45;

export interface WreckFall {
  /** its place [m], velocity [m/s], nose and top: the Earth's coordinates */
  p: Vec3;
  v: Vec3;
  fwd: Vec3;
  up: Vec3;
  /** its roll about its nose [rad/s] */
  spin: number;
  /** its terminal speed [m/s] */
  vt: number;
  /** falling for [s] */
  t: number;
  /** where it ended (the Earth's coordinates [m]) — on the ground, or broken up in the air at the cap —; null: falling */
  end: Vec3 | null;
  /** ended in the air (the cap), not on the ground */
  broke: boolean;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(...a) || 1));

/** A wreck's fall begun from the craft as it was hit: its roll one way or the other, 1.2–3.2 rad/s. */
export function startFall(s: { p: Vec3; v: Vec3; fwd: Vec3; up: Vec3 }, rand = Math.random, vt = WRECK_VT): WreckFall {
  return {
    p: [...s.p],
    v: [...s.v],
    fwd: unit(s.fwd),
    up: unit(s.up),
    spin: (rand() < 0.5 ? -1 : 1) * (1.2 + 2 * rand()),
    vt,
    t: 0,
    end: null,
    broke: false,
  };
}

/**
 * The fall stepped by dt [s]: `normal` the local vertical under a place (the WGS84 normal), `height` its height over
 * the ground [m] (the relief over the ellipsoid; the sea's surface at sea). True when it ended in this step.
 */
export function fallStep(F: WreckFall, dt: number, normal: (p: Vec3) => Vec3, height: (p: Vec3) => number, cap = FALL_CAP): boolean {
  if (F.end || !(dt > 0)) return false;
  // (in small steps: a frame's hitch does not carry it through a ridge)
  const n = Math.max(1, Math.ceil(dt / 0.05));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const U = normal(F.p);
    const sp = Math.hypot(...F.v);
    F.v = add(F.v, add(mul(U, -G * h), mul(F.v, (-G * sp * h) / (F.vt * F.vt))));
    F.p = add(F.p, mul(F.v, h));
    // (the nose to the way it goes, a second's lag; the roll about it)
    const vd = unit(F.v);
    const k = Math.min(h / 1.2, 1);
    const f = unit(add(mul(F.fwd, 1 - k), mul(vd, k)));
    const right = unit(cross(f, F.up));
    const up0 = unit(cross(right, f));
    const a = F.spin * h;
    F.fwd = f;
    F.up = unit(add(mul(up0, Math.cos(a)), mul(right, Math.sin(a))));
    F.t += h;
    const hg = height(F.p);
    if (hg <= 0) {
      // (on the ground: set on it, along the vertical)
      F.p = add(F.p, mul(U, -hg));
      F.v = [0, 0, 0];
      F.end = [...F.p];
      return true;
    }
    if (F.t >= cap) {
      F.end = [...F.p];
      F.broke = true;
      return true;
    }
  }
  return false;
}

/**
 * Where to watch a crash from (the downed pilot's wait): `back` metres back along the way it came over the ground,
 * `rise` above it, the nose on it; its top the local vertical's. `height` raises it clear of a ridge between.
 */
export function crashView(
  F: WreckFall,
  normal: (p: Vec3) => Vec3,
  height: (p: Vec3) => number,
  back = 700,
  rise = 260,
): { p: Vec3; fwd: Vec3; up: Vec3 } {
  const at = F.end ?? F.p;
  const U = normal(at);
  // (the way it came: its velocity's, else its nose's, over the ground)
  const way = F.v.some((x) => x !== 0) ? F.v : F.fwd;
  let hz = add(way, mul(U, -dot(way, U)));
  if (Math.hypot(...hz) < 1e-6) hz = cross(U, [0, 0, 1]);
  hz = unit(hz);
  let p = add(add(at, mul(hz, -back)), mul(U, rise));
  // (a ridge under the eye: higher)
  for (let i = 0; i < 8 && height(p) < 120; i++) p = add(p, mul(U, 150));
  const fwd = unit(add(at, mul(p, -1)));
  const right = unit(cross(fwd, U));
  return { p, fwd, up: unit(cross(right, fwd)) };
}
