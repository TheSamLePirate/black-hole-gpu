// The bodies' oblateness (audit P2): the zonal harmonics J2, J3, J4 of the planets and the Moon, about
// their pole of date. The potential outside the body
//
//   Φ = −(μ/r) [1 − Σₙ Jₙ (R/r)ⁿ Pₙ(sin φ)]
//
// pulls a craft a little more at the equator than at the poles: an orbit's node regresses (the ISS,
// −5° a day), its periapsis turns (frozen at 63.4°), an orbit at 98° keeps its angle to the Sun (sun-
// synchronous). The flight (our-side.ts) and the planner's predictions (our-predict.ts) feel it; on
// rails (the time warp's Kepler orbits) its secular drift is applied (secularZonal).
//
// The coefficients are unnormalised, with their reference radius: the Earth's EGM2008, the Moon's
// GRAIL (its C22 — the Earth-facing bulge — left out), Mars's MRO, Jupiter's and Saturn's Juno and
// Cassini, Uranus's and Neptune's Voyager fits.

import type { Vec3 } from "../physics";
import { M_METRES, M_SECONDS } from "../units";
import { bodyAxes, solarBody } from "./solar";

const km = (x: number) => (x * 1e3) / M_METRES;

export interface Zonal {
  /** the coefficients' reference radius [M] */
  R: number;
  /** J2, J3, J4 */
  J: [number, number, number];
}

export const ZONAL: Record<string, Zonal> = {
  earth: { R: km(6378.137), J: [1.08262668e-3, -2.5326564853e-6, -1.6196215913e-6] },
  moon: { R: km(1738.0), J: [2.033e-4, 8.4597e-6, 0] },
  mars: { R: km(3396.19), J: [1.960454e-3, 3.145e-5, -1.5377e-5] },
  jupiter: { R: km(71492), J: [1.4696572e-2, -4.2e-8, -5.86609e-4] },
  saturn: { R: km(60330), J: [1.6290573e-2, 5.9e-8, -9.35314e-4] },
  uranus: { R: km(25559), J: [3.34129e-3, 0, -3.044e-5] },
  neptune: { R: km(25225), J: [3.4084e-3, 0, -3.34e-5] },
};

/** Beyond this many reference radii the harmonics are left out (J2 there: < 10⁻⁶ of the central pull). */
const REACH = 40;

/** The pole of date, kept an hour of time (its precession and nutation: arcseconds a day) — a few
 *  instants a body: a planner going back and forth over days emptied a single one at every call. */
const POLE_EVERY = 3600 / M_SECONDS;
const POLES_KEPT = 64;
const poles = new Map<string, { t: number; z: Vec3 }[]>();
export function poleOfDate(id: string, t: number): Vec3 {
  let cs = poles.get(id);
  if (!cs) poles.set(id, (cs = []));
  for (const c of cs) if (Math.abs(t - c.t) < POLE_EVERY) return c.z;
  const z = bodyAxes(solarBody(id)!, t)[2];
  cs.unshift({ t, z });
  if (cs.length > POLES_KEPT) cs.pop();
  return z;
}

/**
 * The harmonics' pull (beyond the central μ/r²) at d — the point from the body's centre [M] — about the
 * pole z: a = Σₙ μ Jₙ Rⁿ / r^(n+2) [((n+1) Pₙ(u) + u Pₙ′(u)) r̂ − Pₙ′(u) ẑ], u = r̂·ẑ (the gradient of
 * the potential's terms, Legendre's recursions for Pₙ and Pₙ′).
 */
export function zonalAccelAbout(mu: number, z0: Zonal, z: Vec3, d: Vec3): Vec3 {
  const r = Math.hypot(d[0], d[1], d[2]);
  if (!(r > 0)) return [0, 0, 0];
  const rh: Vec3 = [d[0] / r, d[1] / r, d[2] / r];
  const u = rh[0] * z[0] + rh[1] * z[1] + rh[2] * z[2];
  let P0 = 1,
    P1 = u,
    D0 = 0,
    D1 = 1;
  let ar = 0,
    az = 0;
  let k = (mu / (r * r)) * (z0.R / r);
  for (let n = 2; n <= 4; n++) {
    const Pn = ((2 * n - 1) * u * P1 - (n - 1) * P0) / n;
    const Dn = D0 + (2 * n - 1) * P1;
    k *= z0.R / r;
    const J = z0.J[n - 2]!;
    if (J) {
      ar += k * J * ((n + 1) * Pn + u * Dn);
      az -= k * J * Dn;
    }
    P0 = P1;
    P1 = Pn;
    D0 = D1;
    D1 = Dn;
  }
  return [ar * rh[0] + az * z[0], ar * rh[1] + az * z[1], ar * rh[2] + az * z[2]];
}

/** The pull of a body's oblateness at d from its centre [M] at time t (zero for a round one or far off). */
export function zonalAccel(id: string, mu: number, d: Vec3, t: number): Vec3 | null {
  const z0 = ZONAL[id];
  if (!z0) return null;
  const r = Math.hypot(d[0], d[1], d[2]);
  if (r > REACH * z0.R) return null;
  return zonalAccelAbout(mu, z0, poleOfDate(id, t), d);
}

/**
 * The circle through d (from the body's centre), in the plane of the motion v — circular in the mean: an
 * oblate body bends every orbit, and the point-mass circle there, √(μ/r) level, swings ~10 km in a low
 * Earth orbit (the equator pulls 0.14 % harder than the mean). To first order in J2 (Hill's equations
 * under its pulls along a circle — radial −(3/2)k (1 − 3 sin²i sin²u), along the track −(3/2)k sin²i sin 2u,
 * k = μ J2 R²/r⁴, u the argument of latitude from the ascending node), the radius swings ±X cos 2u about
 * its mean r₀, X = J2 R² sin²i / 4r (1 km in a low orbit at 51.6°): the speed there n (r + X cos 2u), the
 * radial rate −2nX sin 2u, n the mean motion under the mean pull μ [1 + (3/2) J2 (R/r₀)² (1 − (3/2) sin²i)].
 * Flown, its radius swings the 2X the J2 itself makes. Any units, consistent (j2R2: J2 R²).
 */
export function meanCircular(mu: number, j2R2: number, z: Vec3, d: Vec3, v: Vec3): { v: Vec3; r0: number; X: number } {
  const r = Math.hypot(d[0], d[1], d[2]);
  const rh: Vec3 = [d[0] / r, d[1] / r, d[2] / r];
  let h: Vec3 = [d[1] * v[2] - d[2] * v[1], d[2] * v[0] - d[0] * v[2], d[0] * v[1] - d[1] * v[0]];
  let hl = Math.hypot(...h);
  // (no motion across the radius: a plane through the pole's side)
  if (!(hl > 1e-12 * r * Math.hypot(...v))) {
    h = [rh[1] * z[2] - rh[2] * z[1], rh[2] * z[0] - rh[0] * z[2], rh[0] * z[1] - rh[1] * z[0]];
    hl = Math.hypot(...h);
    if (!(hl > 1e-9)) h = [rh[1], -rh[0], 0];
    hl = Math.hypot(...h) || 1;
  }
  const hn: Vec3 = [h[0] / hl, h[1] / hl, h[2] / hl];
  const ci = hn[0] * z[0] + hn[1] * z[1] + hn[2] * z[2];
  const s2i = Math.max(1 - ci * ci, 0);
  // the ascending node (along z × h), the argument of latitude's 2u
  let nd: Vec3 = [z[1] * hn[2] - z[2] * hn[1], z[2] * hn[0] - z[0] * hn[2], z[0] * hn[1] - z[1] * hn[0]];
  const nl = Math.hypot(...nd);
  nd = nl > 1e-9 ? [nd[0] / nl, nd[1] / nl, nd[2] / nl] : rh;
  const q: Vec3 = [hn[1] * nd[2] - hn[2] * nd[1], hn[2] * nd[0] - hn[0] * nd[2], hn[0] * nd[1] - hn[1] * nd[0]];
  const cu = rh[0] * nd[0] + rh[1] * nd[1] + rh[2] * nd[2],
    su = rh[0] * q[0] + rh[1] * q[1] + rh[2] * q[2];
  const c2 = cu * cu - su * su,
    s2 = 2 * su * cu;
  const X = (j2R2 * s2i) / (4 * r);
  const r0 = r - X * c2;
  const n = Math.sqrt((mu * (1 + ((1.5 * j2R2) / (r0 * r0)) * (1 - 1.5 * s2i))) / r0 ** 3);
  const vr = -2 * n * X * s2,
    vh = n * (r + X * c2);
  // (along the track: h × r̂)
  const th: Vec3 = [hn[1] * rh[2] - hn[2] * rh[1], hn[2] * rh[0] - hn[0] * rh[2], hn[0] * rh[1] - hn[1] * rh[0]];
  return { v: [rh[0] * vr + th[0] * vh, rh[1] * vr + th[1] * vh, rh[2] * vr + th[2] * vh], r0, X };
}

/** The mean circle's velocity through d about one of our bodies at time t [M, c] (meanCircular; a round body: √(μ/r) level). */
export function circularVelocity(id: string, mu: number, d: Vec3, v: Vec3, t: number): { v: Vec3; r0: number; X: number } {
  const z0 = ZONAL[id];
  const far = !z0 || Math.hypot(d[0], d[1], d[2]) > REACH * z0.R;
  return meanCircular(mu, far ? 0 : z0.J[0] * z0.R * z0.R, far ? [0, 0, 1] : poleOfDate(id, t), d, v);
}

/** The J2 secular rates of an orbit [rad per M of time]: its node, its periapsis, its mean anomaly's excess. */
export function secularRates(mu: number, z0: Zonal, a: number, e: number, cosI: number) {
  const n = Math.sqrt(mu / a ** 3);
  const p = a * (1 - e * e);
  const k = 1.5 * z0.J[0] * (z0.R / p) ** 2 * n;
  const s2 = 1 - cosI * cosI;
  return { node: -k * cosI, peri: k * (2 - 2.5 * s2), mean: k * Math.sqrt(1 - e * e) * (1 - 1.5 * s2) };
}

const rot = (v: Vec3, k: Vec3, a: number): Vec3 => {
  const c = Math.cos(a),
    s = Math.sin(a);
  const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x: Vec3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((i) => v[i]! * c + x[i]! * s + k[i]! * kv * (1 - c)) as Vec3;
};

/**
 * A Kepler orbit's state (r, v from the body's centre) after dt on rails, with the J2's secular drift:
 * turned in its plane by the periapsis's and the mean anomaly's excess, then about the pole by the
 * node's regression (about `pole`, the body's pole of date unless given). Unchanged for a round body.
 */
export function secularZonal(id: string, mu: number, r: Vec3, v: Vec3, dt: number, t: number, pole?: Vec3): { r: Vec3; v: Vec3 } {
  const turn = secularTurn(id, mu, r, v, dt, t, pole);
  return turn ? { r: turn(r), v: turn(v) } : { r, v };
}

/**
 * The J2 secular drift of the orbit (r, v) over dt (secularZonal's), as the rotation it is — for any
 * vector: a rendezvous's target taken back into the frame its two-body arc is solved in. Null: none
 * (a round body, an unbound path).
 */
export function secularTurn(id: string, mu: number, r: Vec3, v: Vec3, dt: number, t: number, pole?: Vec3): ((x: Vec3) => Vec3) | null {
  const z0 = ZONAL[id];
  if (!z0) return null;
  const R = Math.hypot(...r);
  const eps = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - mu / R;
  if (!(eps < 0)) return null;
  const a = -mu / (2 * eps);
  const h: Vec3 = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const hl = Math.hypot(...h);
  const e = Math.sqrt(Math.max(1 - (hl * hl) / (mu * a), 0));
  const z = pole ?? poleOfDate(id, t);
  const hn: Vec3 = [h[0] / hl, h[1] / hl, h[2] / hl];
  const cosI = hn[0] * z[0] + hn[1] * z[1] + hn[2] * z[2];
  const w = secularRates(mu, z0, a, e, cosI);
  const inPlane = (w.peri + w.mean) * dt,
    node = w.node * dt;
  return (x: Vec3) => rot(rot(x, hn, inPlane), z, node);
}

/**
 * The J2 secular drift's rate after dt (secularTurn's): the angular velocity [rad per M] the turned orbit
 * goes round at — its node about the pole, its periapsis and mean anomaly about its normal as turned. A
 * point on the drifting orbit moves at turn(v) + ω × turn(r): the derivative of the place secularZonal
 * gives, which turn(v) alone is not (some 5 m/s short in a low orbit). Null: no drift.
 */
export function secularSpin(id: string, mu: number, r: Vec3, v: Vec3, dt: number, t: number, pole?: Vec3): Vec3 | null {
  const z0 = ZONAL[id];
  if (!z0) return null;
  const R = Math.hypot(...r);
  const eps = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - mu / R;
  if (!(eps < 0)) return null;
  const a = -mu / (2 * eps);
  const h: Vec3 = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const hl = Math.hypot(...h);
  const e = Math.sqrt(Math.max(1 - (hl * hl) / (mu * a), 0));
  const z = pole ?? poleOfDate(id, t);
  const hn: Vec3 = [h[0] / hl, h[1] / hl, h[2] / hl];
  const w = secularRates(mu, z0, a, e, hn[0] * z[0] + hn[1] * z[1] + hn[2] * z[2]);
  const n = rot(hn, z, w.node * dt);
  return [0, 1, 2].map((k) => z[k]! * w.node + n[k]! * (w.peri + w.mean)) as Vec3;
}
