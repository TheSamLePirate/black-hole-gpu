import { add, cross, dot, len, scale } from "../math/vec3";
// Two-body orbits for the game's tools and the Ranger's telemetry: the classical elements of a state
// around a body (relative to its equator), a state from elements, the times to the apsides, and what
// the ship is doing (landed, flying in the air, on a suborbital arc, in orbit, escaping).
//
// Units: whatever the caller uses, G = 1 (the game: M and M of time, GM in M; or metres, seconds and
// GM in m³/s² on Gargantua's side). Angles in radians.

export type V3 = [number, number, number];

const TAU = 2 * Math.PI;
const wrap2pi = (x: number) => ((x % TAU) + TAU) % TAU;

/** A reference frame for the elements: x towards the node origin, z along the pole. */
export type Axes = [V3, V3, V3];
export const ECLIPTIC: Axes = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export interface Elements {
  /** GM */
  mu: number;
  /** semi-major axis (< 0: hyperbolic, ∞: parabolic), eccentricity */
  a: number;
  e: number;
  /** inclination, longitude of the ascending node, argument of periapsis, true anomaly */
  i: number;
  raan: number;
  argPe: number;
  nu: number;
  /** periapsis, apoapsis radii (∞ when unbound) */
  rp: number;
  ra: number;
  /** period (∞ when unbound), specific energy, specific angular momentum */
  period: number;
  energy: number;
  h: V3;
  /** time to the next periapsis (< 0: past it, on an unbound orbit), to the next apoapsis (bound only) */
  tPe: number;
  tAp: number;
  /** radius and speed now */
  r: number;
  v: number;
}

/** Components of a vector in the axes */
const inAxes = (v: V3, ax: Axes): V3 => [dot(v, ax[0]), dot(v, ax[1]), dot(v, ax[2])];
const fromAxes = (v: V3, ax: Axes): V3 => add(add(scale(ax[0], v[0]), scale(ax[1], v[1])), scale(ax[2], v[2]));

/** The classical elements of the state (r, v) relative to a body of GM mu, in the given axes. */
export function elements(mu: number, rw: V3, vw: V3, axes: Axes = ECLIPTIC): Elements {
  const r = inAxes(rw, axes),
    v = inAxes(vw, axes);
  const R = len(r),
    V = len(v);
  const h = cross(r, v);
  const hl = len(h);
  const energy = (V * V) / 2 - mu / R;
  const ev = add(scale(cross(v, h), 1 / mu), scale(r, -1 / R));
  const e = len(ev);
  const a = Math.abs(1 - e) < 1e-12 ? Infinity : -mu / (2 * energy);
  const i = Math.acos(Math.min(1, Math.max(-1, h[2] / Math.max(hl, 1e-300))));
  // the node line (z × h); equatorial orbits: measured from x
  const nv: V3 = [-h[1], h[0], 0];
  const nl = len(nv);
  const raan = nl > 1e-12 * hl ? wrap2pi(Math.atan2(nv[1], nv[0])) : 0;
  const nodeDir: V3 = nl > 1e-12 * hl ? scale(nv, 1 / nl) : [1, 0, 0];
  // periapsis from the node, in the orbit's sense of motion
  const hn = scale(h, 1 / Math.max(hl, 1e-300));
  const ang = (from: V3, to: V3) => wrap2pi(Math.atan2(dot(cross(from, to), hn), dot(from, to)));
  const circular = e < 1e-9;
  const argPe = circular ? 0 : ang(nodeDir, scale(ev, 1 / e));
  const nu = circular ? ang(nodeDir, scale(r, 1 / R)) : ang(scale(ev, 1 / e), scale(r, 1 / R));
  const rp = (hl * hl) / mu / (1 + e);
  const bound = energy < 0;
  const ra = bound ? a * (1 + e) : Infinity;
  const period = bound ? TAU * Math.sqrt(a ** 3 / mu) : Infinity;
  const { tPe, tAp } = apsisTimes(mu, a, e, nu, period);
  return { mu, a, e, i, raan, argPe, nu, rp, ra, period, energy, h: fromAxes(h, axes), tPe, tAp, r: R, v: V };
}

/** Time to the next periapsis and apoapsis from the true anomaly nu. */
function apsisTimes(mu: number, a: number, e: number, nu: number, period: number) {
  if (e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    const M = wrap2pi(E - e * Math.sin(E));
    const n = TAU / period;
    const tPe = (TAU - M) / n;
    const tAp = wrap2pi(Math.PI - M) / n;
    return { tPe: tPe >= period ? tPe - period : tPe, tAp };
  }
  if (e > 1 && Number.isFinite(a)) {
    const nuS = nu > Math.PI ? nu - TAU : nu; // (−π, π]: < 0 before periapsis
    const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nuS / 2));
    const M = e * Math.sinh(F) - F;
    const n = Math.sqrt(mu / -(a ** 3));
    return { tPe: -M / n, tAp: NaN };
  }
  return { tPe: NaN, tAp: NaN };
}

export interface OrbitSpec {
  /** periapsis and apoapsis radii (from the centre); or a (with e) */
  rp?: number;
  ra?: number;
  a?: number;
  e?: number;
  /** degrees */
  i?: number;
  raan?: number;
  argPe?: number;
  nu?: number;
}

/** A state (r, v relative to the body) on the orbit described, in the given axes. */
export function stateFrom(mu: number, o: OrbitSpec, axes: Axes = ECLIPTIC): { r: V3; v: V3 } {
  const D = Math.PI / 180;
  let a: number, e: number;
  if (o.rp !== undefined) {
    const ra = o.ra ?? o.rp;
    const lo = Math.min(o.rp, ra),
      hi = Math.max(o.rp, ra);
    a = (lo + hi) / 2;
    e = (hi - lo) / (hi + lo);
  } else {
    a = o.a ?? 1;
    e = o.e ?? 0;
  }
  const p = a * (1 - e * e);
  const nu = (o.nu ?? 0) * D;
  const r = p / (1 + e * Math.cos(nu));
  // perifocal → the axes: R3(Ω) R1(i) R3(ω)
  const pos: V3 = [r * Math.cos(nu), r * Math.sin(nu), 0];
  const k = Math.sqrt(mu / p);
  const vel: V3 = [-k * Math.sin(nu), k * (e + Math.cos(nu)), 0];
  const rot = (v: V3): V3 => {
    const w = (o.argPe ?? 0) * D,
      inc = (o.i ?? 0) * D,
      W = (o.raan ?? 0) * D;
    const x1 = Math.cos(w) * v[0] - Math.sin(w) * v[1],
      y1 = Math.sin(w) * v[0] + Math.cos(w) * v[1];
    const y2 = Math.cos(inc) * y1,
      z2 = Math.sin(inc) * y1;
    return [Math.cos(W) * x1 - Math.sin(W) * y2, Math.sin(W) * x1 + Math.cos(W) * y2, z2];
  };
  return { r: fromAxes(rot(pos), axes), v: fromAxes(rot(vel), axes) };
}

export type Status = "landed" | "flight" | "suborbital" | "orbit" | "escape" | "hyperbolic";

export const STATUS_LABEL: Record<Status, string> = {
  landed: "LANDED",
  flight: "IN FLIGHT",
  suborbital: "SUBORBITAL",
  orbit: "IN ORBIT",
  escape: "ESCAPING",
  hyperbolic: "HYPERBOLIC",
};

/**
 * What the ship does around its body: landed; flying in the air (below the top of the atmosphere
 * without an orbit); on a suborbital arc (the periapsis under the ground or in the air); in orbit
 * (the whole orbit clear of the air, within the sphere of influence); escaping (the apoapsis beyond
 * the sphere of influence); hyperbolic (unbound).
 */
export function classify(el: Elements, o: { R: number; airTop?: number; soi?: number; landed?: boolean }): Status {
  if (o.landed) return "landed";
  const top = Math.max(o.airTop ?? o.R, o.R);
  if (el.energy >= 0) return "hyperbolic";
  if (el.ra > (o.soi ?? Infinity)) return "escape";
  if (el.rp >= top) return "orbit";
  // (the orbit dips into the air or the ground: slow and in the air, a flight; else an arc)
  return el.r < top && el.v < 0.5 * Math.sqrt(el.mu / el.r) ? "flight" : "suborbital";
}
