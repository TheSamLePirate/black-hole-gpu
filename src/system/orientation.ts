// How the solar system's bodies are turned: their own axes (x their prime meridian — the maps' centre —,
// z their north pole) on the home frame's J2000 ecliptic axes.
//
// The IAU models (pck00010: iau-data.ts) — the pole's right ascension and declination and the prime
// meridian's angle W, secular and periodic (the Moon's physical librations, Jupiter's moons' wobbles).
// The Earth: better than its IAU model (a J2000 pole, 0.4° off by 2067) — the precession (IAU 1976),
// the nutation (its main terms: 0.5″), the apparent sidereal time on UT1 ≈ UTC: Greenwich where it is
// to ~15 m.

import type { Vec3 } from "../physics";
import { IAU_ANGLES, IAU_ROTATION } from "./iau-data";
import { J2000_MS } from "./timescale";

type M3 = [Vec3, Vec3, Vec3];
const D = Math.PI / 180,
  AS = D / 3600;
/** the J2000 obliquity (SPICE's ECLIPJ2000) */
export const EPS_J2000 = 84381.448 * AS;
const ce = Math.cos(EPS_J2000),
  se = Math.sin(EPS_J2000);
/** J2000 equatorial (ICRF) → J2000 ecliptic */
export const eclOf = (v: Vec3): Vec3 => [v[0], ce * v[1] + se * v[2], -se * v[1] + ce * v[2]];
/** a J2000 right ascension and declination [°] as a unit vector on the J2000 ecliptic axes */
export const eclDir = (ra: number, dec: number): Vec3 =>
  eclOf([Math.cos(dec * D) * Math.cos(ra * D), Math.cos(dec * D) * Math.sin(ra * D), Math.sin(dec * D)]);

/** a body's axes from its pole and prime meridian (ICRF): columns x (the meridian), y, z (the pole) */
function axesOf(ra: number, dec: number, W: number): M3 {
  const a = ra * D,
    d = dec * D,
    w = W * D;
  const N: Vec3 = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  // (the equator's ascending node on the ICRF equator, then 90° on along the equator)
  const Q: Vec3 = [-Math.sin(a), Math.cos(a), 0];
  const P: Vec3 = [N[1] * Q[2] - N[2] * Q[1], N[2] * Q[0] - N[0] * Q[2], N[0] * Q[1] - N[1] * Q[0]];
  const c = Math.cos(w),
    s = Math.sin(w);
  const x: Vec3 = [c * Q[0] + s * P[0], c * Q[1] + s * P[1], c * Q[2] + s * P[2]];
  const y: Vec3 = [-s * Q[0] + c * P[0], -s * Q[1] + c * P[1], -s * Q[2] + c * P[2]];
  return [eclOf(x), eclOf(y), eclOf(N)];
}

/** The IAU pole [°] and prime meridian [°] of a body at et [TDB s past J2000], or null (no model). */
export function iauAngles(id: string, et: number): { ra: number; dec: number; W: number } | null {
  const r = IAU_ROTATION[id];
  if (!r) return null;
  const d = et / 86400,
    T = d / 36525;
  let ra = r.ra[0]! + r.ra[1]! * T + (r.ra[2] ?? 0) * T * T;
  let dec = r.dec[0]! + r.dec[1]! * T + (r.dec[2] ?? 0) * T * T;
  let W = r.pm[0]! + r.pm[1]! * d + (r.pm[2] ?? 0) * d * d;
  const ang = r.sys ? IAU_ANGLES[r.sys] : undefined;
  if (ang) {
    const n = Math.max(r.nra?.length ?? 0, r.ndec?.length ?? 0, r.npm?.length ?? 0);
    for (let i = 0; i < n && 2 * i + 1 < ang.length; i++) {
      const A = (ang[2 * i]! + ang[2 * i + 1]! * T) * D;
      if (r.nra?.[i]) ra += r.nra[i]! * Math.sin(A);
      if (r.ndec?.[i]) dec += r.ndec[i]! * Math.cos(A);
      if (r.npm?.[i]) W += r.npm[i]! * Math.sin(A);
    }
  }
  return { ra, dec, W };
}

/** How fast a body's prime meridian turns at et [°/day] (IAU: W's rate, its periodic terms' too), or null. */
export function iauRate(id: string, et: number): number | null {
  const r = IAU_ROTATION[id];
  if (!r) return null;
  const d = et / 86400,
    T = d / 36525;
  let w = r.pm[1]! + 2 * (r.pm[2] ?? 0) * d;
  const ang = r.sys ? IAU_ANGLES[r.sys] : undefined;
  if (ang && r.npm)
    for (let i = 0; i < r.npm.length && 2 * i + 1 < ang.length; i++) {
      if (!r.npm[i]) continue;
      const A = (ang[2 * i]! + ang[2 * i + 1]! * T) * D;
      // npm is in degrees; only the sine argument's derivative converts °/century to rad/day.
      w += r.npm[i]! * Math.cos(A) * ang[2 * i + 1]! * (D / 36525);
    }
  return w;
}

/** A body's axes (IAU) at et, or null. */
export function iauAxes(id: string, et: number): M3 | null {
  const a = iauAngles(id, et);
  return a && axesOf(a.ra, a.dec, a.W);
}

// ------------------------------------------------------------------------------------ the Earth
const R1 = (a: number): M3 => [
  [1, 0, 0],
  [0, Math.cos(a), Math.sin(a)],
  [0, -Math.sin(a), Math.cos(a)],
];
const R2 = (a: number): M3 => [
  [Math.cos(a), 0, -Math.sin(a)],
  [0, 1, 0],
  [Math.sin(a), 0, Math.cos(a)],
];
const R3 = (a: number): M3 => [
  [Math.cos(a), Math.sin(a), 0],
  [-Math.sin(a), Math.cos(a), 0],
  [0, 0, 1],
];
const mul = (A: M3, B: M3): M3 => A.map((r) => [0, 1, 2].map((j) => r[0]! * B[0]![j]! + r[1]! * B[1]![j]! + r[2]! * B[2]![j]!)) as M3;

/** The nutation's main terms [rad] (Meeus ch. 22: ~0.5″ in longitude, 0.1″ in obliquity) and the mean obliquity. */
export function nutation(T: number) {
  const Om = (125.04452 - 1934.136261 * T) * D;
  const L = (280.4665 + 36000.7698 * T) * D,
    Lm = (218.3165 + 481267.8813 * T) * D;
  const dpsi = (-17.2 * Math.sin(Om) - 1.32 * Math.sin(2 * L) - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * Om)) * AS;
  const deps = (9.2 * Math.cos(Om) + 0.57 * Math.cos(2 * L) + 0.1 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * Om)) * AS;
  const eps = (84381.448 - 46.815 * T - 0.00059 * T * T + 0.001813 * T ** 3) * AS;
  return { dpsi, deps, eps };
}

/**
 * The Earth's axes at a UTC instant [ms] (et its TDB): Greenwich on x, the pole of date on z — the
 * ICRF turned by the precession, the nutation, the apparent sidereal time (UT1 = UTC).
 */
/** ICRS → the true equator and equinox of date (rows: the equinox, 90° east of it, the pole) at et: the
 *  precession (Lieske 1977) and the nutation; with the nutation's angles */
function precessionNutation(et: number) {
  const T = et / 86400 / 36525;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * AS;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * AS;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * AS;
  const P = mul(R3(-z), mul(R2(th), R3(-zeta)));
  const { dpsi, deps, eps } = nutation(T);
  const N = mul(R1(-(eps + deps)), mul(R3(-dpsi), R1(eps)));
  return { Q: mul(N, P), dpsi, deps, eps };
}

/** The true equator of date's axes (the equinox, 90° east of it, the pole) on the J2000 ecliptic axes at
 *  et [TDB s]: the sky's equatorial grid of the date (the pole of 2067 0.9° from J2000's). */
export function equatorOfDate(et: number): M3 {
  const Q = precessionNutation(et).Q;
  return [eclOf(Q[0]), eclOf(Q[1]), eclOf(Q[2])];
}

export function earthAxes(utcMs: number, et: number): M3 {
  const { Q, dpsi, deps, eps } = precessionNutation(et);
  // the apparent sidereal time: the mean (IAU 1982, on UT1) plus the equation of the equinoxes
  const du = (utcMs - J2000_MS) / 86400e3,
    Tu = du / 36525;
  const gmst = (280.46061837 + 360.98564736629 * du + 0.000387933 * Tu * Tu - Tu ** 3 / 38710000) * D;
  const M = mul(R3(gmst + dpsi * Math.cos(eps + deps)), Q);
  // (rows of M: the Earth's axes on the ICRF)
  return [eclOf(M[0]), eclOf(M[1]), eclOf(M[2])];
}
