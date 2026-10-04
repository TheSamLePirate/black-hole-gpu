// Our universe's grounds: the solar system's solid bodies (the Earth, the Moon, Mars, the moons…)
// turning under a ship, their air, touching down and lifting off (Newton, home frame). The same
// landing gear, crash speed and ballistic coefficient as near the hole (landing.ts).

import type { Ground } from "../gear";
import type { Vec3 } from "../physics";
import { GEAR } from "../landing";
import { TUNING } from "../game/tuning";
import { bodyAxes, M_METRES, mapIndex, SOLAR_BODIES, solarBody, solarState, spinVector } from "./solar";
import { craterRelief } from "../terrain";
import { airAt, airRaw } from "../aero";
import { C_MPS } from "../units";
import { cross, dot, sub } from "../math/vec3";
import { cartToGeodetic, flatteningOf, geodeticToCart, squashedHeight } from "./ellipsoid";
import { poleOfDate } from "./geopotential";

export { GEAR };

const C = C_MPS;

/** A body one can stand on (not a gas giant, not the Sun). */
export function solidBody(id: string) {
  const b = solarBody(id);
  return !!b && b.kind === "planet" && b.surface !== "gas";
}

/** The ground's velocity under a home-frame point (the body's motion plus its turning). */
export function groundVelocity(id: string, X: Vec3, t: number): Vec3 {
  const b = solarBody(id)!;
  const st = solarState(id, t);
  const w = spinVector(b, t);
  const r = sub(X, st.pos);
  const v = cross(w, r);
  return [st.vel[0] + v[0], st.vel[1] + v[1], st.vel[2] + v[2]];
}

/** Air density [kg/m³] at a height [m] above a body (none: 0). */
export function airDensity(id: string, hM: number) {
  return airAt(solarBody(id)?.atmosphere, Math.max(hM, 0)).rho;
}

/** The thin air's density at a height [m] above a body, with no floor: the thermosphere's drag on an
 *  orbit (the ISS's 400 km: 3·10⁻¹² kg/m³, some fifty metres a day) — beyond 2 500 km, none. */
export function thinAirDensity(id: string, hM: number) {
  const atm = solarBody(id)?.atmosphere;
  return atm && hM < 2.5e6 ? airRaw(atm, Math.max(hM, 0)).rho : 0;
}

/** The air's drag on the ship (home frame, c²/M): ½ ρ v² / B against its motion through the air — the
 *  thermosphere's too, above the flight's air (B: the ballistic coefficient, the craft's or given). */
export function dragAccel(id: string, X: Vec3, V: Vec3, t: number, B = TUNING.ballistic): Vec3 {
  const h = altitudeOver(id, X, t);
  const rho = thinAirDensity(id, h);
  if (rho <= 0) return [0, 0, 0];
  const va = sub(V, groundVelocity(id, X, t));
  const v = Math.hypot(...va);
  // (a = ½ ρ (v c)² / B in m/s², × M/c² in the code's units)
  const k = (-0.5 * rho * v * M_METRES) / B;
  return [va[0] * k, va[1] * k, va[2] * k];
}

/**
 * A near-circular orbit's decay through the thin air over dt on rails: its size shrinks at
 * da/dt = −(ρ/B) √(μ a) (the drag's mean work over a turn), its shape kept — the state scaled (r by
 * a′/a, v by √(a/a′)). An eccentric orbit, or one clear of the air, unchanged.
 */
export function railsDecay(id: string, mu: number, r: Vec3, v: Vec3, dt: number, B = TUNING.ballistic): { r: Vec3; v: Vec3 } {
  const b = solarBody(id);
  if (!b?.atmosphere) return { r, v };
  const R = Math.hypot(...r);
  const eps = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - mu / R;
  if (!(eps < 0)) return { r, v };
  const a = -mu / (2 * eps);
  if (Math.abs(R - a) > 0.05 * a) return { r, v };
  // (over a turn, the figure's mean radius under it: the Earth's ellipsoid between 6 357 and 6 378 km)
  const rho = thinAirDensity(id, (a - meanRadius(id)) * M_METRES);
  if (!(rho > 0)) return { r, v };
  // (in the code's units: a and t in M, μ = GM/c²: da/dt = −(ρ/B) M √(μ a))
  const a1 = Math.max(a - (rho / B) * M_METRES * Math.sqrt(mu * a) * dt, b.radius);
  const kr = a1 / a,
    kv = Math.sqrt(a / a1);
  return { r: [r[0] * kr, r[1] * kr, r[2] * kr], v: [v[0] * kv, v[1] * kv, v[2] * kv] };
}

/** Home-frame point ↔ the body's own coordinates (fixed on its ground), at time t. */
export function toBodyFixed(id: string, X: Vec3, t: number): Vec3 {
  const A = bodyAxes(solarBody(id)!, t);
  const d = sub(X, solarState(id, t).pos);
  return [dot(d, A[0]), dot(d, A[1]), dot(d, A[2])];
}
export function fromBodyFixed(id: string, q: Vec3, t: number): Vec3 {
  const A = bodyAxes(solarBody(id)!, t);
  const P = solarState(id, t).pos;
  return [0, 1, 2].map((i) => P[i]! + q[0] * A[0][i]! + q[1] * A[1][i]! + q[2] * A[2][i]!) as Vec3;
}

/** A body's mean radius (the Earth's ellipsoid's: (2a + b)/3, 6 371,0 km; a sphere's own). */
export function meanRadius(id: string): number {
  return solarBody(id)!.radius * (1 - flatteningOf(id) / 3);
}

/** A home-frame point's height over a body's figure [m] — the Earth's ellipsoid (geodetic), a sphere's radius. */
export function altitudeOver(id: string, X: Vec3, t: number): number {
  const b = solarBody(id)!;
  const f = flatteningOf(id);
  const d = sub(X, solarState(id, t).pos);
  if (f === 0) return (Math.hypot(...d) - b.radius) * M_METRES;
  // (a figure of revolution: its pole alone — of date, kept an hour —, not the turning axes' nutation series)
  const z = dot(d, poleOfDate(id, t));
  return cartToGeodetic(b.radius, f, [Math.sqrt(Math.max(dot(d, d) - z * z, 0)), 0, z]).h * M_METRES;
}

/** A place on a body: geodetic latitude, east longitude [°], height above its figure [m] → its own coordinates. */
export function bodyFixedOf(id: string, lat: number, lon: number, hM = GEAR): Vec3 {
  return geodeticToCart(solarBody(id)!.radius, flatteningOf(id), (lat * Math.PI) / 180, (lon * Math.PI) / 180, hM / M_METRES);
}

/**
 * A body's relief above its sphere, once known (the Earth's: its height map read back from the
 * tracer's — the ground drawn): height [m] at a unit direction on its own axes.
 */
const reliefs = new Map<string, (q: Vec3) => number>();
export function setGroundRelief(id: string, f: ((q: Vec3) => number) | null) {
  if (f) reliefs.set(id, f);
  else reliefs.delete(id);
}
// our airless worlds' ground: the tracer's craters (by their maps' indices: the Moon, Mercury, Ceres,
// Phobos … Rhea — trace.wgsl: airless)
const craters = new Map<string, (q: Vec3) => number>();
for (const b of SOLAR_BODIES) {
  const m = b.map ? mapIndex(b.map) : -1;
  if (m === 1 || m === 3 || (m >= 7 && m <= 18)) {
    const mR = b.radius * M_METRES;
    craters.set(b.id, (q) => craterRelief(m, q, mR));
  }
}
for (const [id, f] of craters) reliefs.set(id, f);

/**
 * A body's measured heights, while the tracer draws them (its finer maps in: the Moon's LOLA, Mars's
 * MOLA — hd-maps.ts): under its craters, height [m] at a unit direction on its axes; null: the craters alone.
 */
export function setGroundHeights(id: string, f: ((q: Vec3) => number) | null) {
  const c = craters.get(id);
  if (f) reliefs.set(id, c ? (q) => f(q) + c(q) : f);
  else if (c) reliefs.set(id, c);
  else reliefs.delete(id);
}

/**
 * A body-fixed point's height over the figure as the ground is drawn [m] (the tracer's squashed space —
 * ellipsoid.ts —: the Earth's to the millimetre what the shader marches), the relief's direction there
 * (geodetic: the maps'), and the figure's normal (on the body's axes).
 */
function figureAt(id: string, p: Vec3): { h: number; g: Vec3 } {
  const b = solarBody(id)!;
  const f = flatteningOf(id);
  if (f === 0) {
    const l = Math.hypot(...p) || 1;
    return { h: (l - b.radius) * M_METRES, g: [p[0] / l, p[1] / l, p[2] / l] };
  }
  const s = squashedHeight(p, b.radius, f);
  return { h: s.h * M_METRES, g: s.g };
}

/** The ground's height above the figure [m] under a body-fixed point (0: none known). */
export function groundRelief(id: string, q: Vec3): number {
  const f = reliefs.get(id);
  if (!f) return 0;
  return f(figureAt(id, q).g);
}

/** The relief's height [m] under a body-fixed point, and that point's height over the figure [m]. */
function heightOver(id: string, p: Vec3) {
  const fa = figureAt(id, p);
  const f = reliefs.get(id);
  return fa.h - (f ? f(fa.g) : 0);
}

/** A body-fixed point's height above the ground [m] (the figure, and the relief when known). */
export function heightOverGround(id: string, q: Vec3): number {
  return heightOver(id, q);
}

/**
 * The ground's height above a body's sphere of its radius [m] along a body-fixed direction — the relief,
 * and the Earth's ellipsoid below its equator's sphere (to −21 km at the poles): for the sphere-minded
 * (the camera rig's floor and heights).
 */
export function groundAboveSphere(id: string, q: Vec3): number {
  const R = solarBody(id)!.radius;
  const l = Math.hypot(...q) || 1;
  const u: Vec3 = [q[0] / l, q[1] / l, q[2] / l];
  // (the ground along u: Newton on its height there, a metre per metre to 0.3 %)
  let r = R;
  for (let i = 0; i < 3; i++) {
    const h = heightOver(id, [u[0] * r, u[1] * r, u[2] * r]);
    r -= h / M_METRES;
    if (Math.abs(h) < 0.01) break;
  }
  return (r - R) * M_METRES;
}

/**
 * A body-fixed point `above` [m] over the ground at a geodetic latitude, east longitude [°] (the relief
 * where known) — its height set as the ground is drawn (the tracer's squashed space: centimetres off the
 * geodetic one on a plateau), so a craft put there stands on its gear.
 */
export function groundPointOf(id: string, lat: number, lon: number, above = GEAR): Vec3 {
  const q = bodyFixedOf(id, lat, lon, above + groundRelief(id, bodyFixedOf(id, lat, lon, 0)));
  const k = 1 + (above - heightOver(id, q)) / M_METRES / Math.hypot(...q);
  return [q[0] * k, q[1] * k, q[2] * k];
}

/** Height of the ship's gear above the ground [m] (the figure, and the relief when known). */
export function gearHeight(id: string, X: Vec3, t: number) {
  return heightOver(id, toBodyFixed(id, X, t)) - GEAR;
}

/** The figure's normal (the Earth's: geodetic) under a home-frame point, on the home axes. */
export function figureUp(id: string, X: Vec3, t: number): Vec3 {
  const f = flatteningOf(id);
  const d = sub(X, solarState(id, t).pos);
  // (the squashed space's geodetic direction, back on the home axes: d + ((a/b)² − 1) z ẑ, z along the pole)
  const k = 1 / (1 - f) ** 2 - 1;
  const p = f === 0 ? ([0, 0, 0] as Vec3) : poleOfDate(id, t);
  const z = dot(d, p) * k;
  const n: Vec3 = [d[0] + z * p[0], d[1] + z * p[1], d[2] + z * p[2]];
  const l = Math.hypot(...n);
  return [n[0] / l, n[1] / l, n[2] / l];
}

/**
 * The ground under the points about a home-frame place X at t, for the gear (gear.ts): a point p [m,
 * home axes, from X] → its height above the ground [m], the ground's normal there (the relief's slope
 * felt over 5 m), the ground's velocity relative to X's own (none: the wheels are metres apart).
 */
export function groundUnder(id: string, X: Vec3, t: number): Ground {
  const relief = reliefs.has(id);
  // (the body's axes once: the points metres apart, the same instant)
  const A = bodyAxes(solarBody(id)!, t);
  const P = solarState(id, t).pos;
  const fixed = (Xp: Vec3): Vec3 => {
    const d = sub(Xp, P);
    return [dot(d, A[0]), dot(d, A[1]), dot(d, A[2])];
  };
  const height = (Xp: Vec3) => heightOver(id, fixed(Xp));
  return {
    at(p: Vec3) {
      const Xp: Vec3 = [X[0] + p[0] / M_METRES, X[1] + p[1] / M_METRES, X[2] + p[2] / M_METRES];
      const g = figureAt(id, fixed(Xp)).g;
      const up = [0, 1, 2].map((i) => g[0] * A[0][i]! + g[1] * A[1][i]! + g[2] * A[2][i]!) as Vec3;
      const h = height(Xp);
      if (!relief) return { h, n: up, v: [0, 0, 0] };
      // (the slope: the heights 5 m east and north of it, along the ground)
      const e = cross([0, 0, 1], up);
      const el = Math.hypot(...e) || 1;
      const e1: Vec3 = [e[0] / el, e[1] / el, e[2] / el];
      const e2 = cross(up, e1);
      const k = 5 / M_METRES;
      const h1 = height([Xp[0] + e1[0] * k, Xp[1] + e1[1] * k, Xp[2] + e1[2] * k]);
      const h2 = height([Xp[0] + e2[0] * k, Xp[1] + e2[1] * k, Xp[2] + e2[2] * k]);
      const n: Vec3 = [0, 1, 2].map((i) => up[i]! - ((h1 - h) / 5) * e1[i]! - ((h2 - h) / 5) * e2[i]!) as Vec3;
      const nl = Math.hypot(...n);
      return { h, n: [n[0] / nl, n[1] / nl, n[2] / nl], v: [0, 0, 0] };
    },
  };
}

/** Speeds relative to the ground [m/s]: vertical (> 0 up), horizontal; the local up. */
export function groundSpeeds(id: string, X: Vec3, V: Vec3, t: number) {
  const up = figureUp(id, X, t);
  const va = sub(V, groundVelocity(id, X, t));
  const vv = dot(va, up);
  const vh = Math.hypot(va[0] - vv * up[0], va[1] - vv * up[1], va[2] - vv * up[2]);
  return { vv: vv * C, vh: vh * C, up, va };
}
