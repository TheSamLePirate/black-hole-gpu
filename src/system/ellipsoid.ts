// The Earth's figure: the WGS84 ellipsoid (phase 2, audit: "la Terre est une sphère de 6 371 km") —
// a = 6 378,137 km at the equator, flattened by 1/298,257 (the poles 21 km nearer the centre). The
// other worlds stay spheres (flattening 0: every function here then is the sphere's).
//
// Two ways to measure a height:
//  · geodetic (latitude, longitude, height along the ellipsoid's normal — the maps', the sites', the
//    altimeter's): geodeticToCart / cartToGeodetic, exact (Bowring's start, two Newton steps);
//  · the tracer's "squashed space" — the body's axes with z stretched by a/b, the ellipsoid there the
//    sphere of radius a — where the relief is marched as over a sphere: a point's height is its radius
//    there over a, less one, times sq (squashedScale: the metres a radial step there is, along the
//    ground's normal) — what the ground is drawn by and the gear touches (the two must agree to the
//    millimetre), equal to the geodetic height on the ground, to 5 cm 10 km up (2 m in low orbit).

import type { Vec3 } from "../math/vec3";

/** WGS84: the semi-major axis [m] and the flattening. */
export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;

/** A body's flattening (the Earth's; the other worlds are drawn and flown as spheres). */
export function flatteningOf(id: string): number {
  return id === "earth" ? WGS84_F : 0;
}

/** Geodetic latitude, longitude [rad], height → body-fixed coordinates (the units of a). */
export function geodeticToCart(a: number, f: number, lat: number, lon: number, h: number): Vec3 {
  const e2 = f * (2 - f);
  const s = Math.sin(lat),
    c = Math.cos(lat);
  const N = a / Math.sqrt(1 - e2 * s * s);
  return [(N + h) * c * Math.cos(lon), (N + h) * c * Math.sin(lon), (N * (1 - e2) + h) * s];
}

/** Body-fixed coordinates → geodetic latitude, longitude [rad], height (the units of a). */
export function cartToGeodetic(a: number, f: number, p: Vec3): { lat: number; lon: number; h: number } {
  const lon = Math.atan2(p[1], p[0]);
  const rho = Math.hypot(p[0], p[1]);
  if (f === 0) {
    const r = Math.hypot(rho, p[2]);
    return { lat: Math.atan2(p[2], rho), lon, h: r - a };
  }
  const e2 = f * (2 - f);
  const b = a * (1 - f);
  // (Bowring's start, then Newton on the latitude: sub-millimetre anywhere above the core)
  const ep2 = e2 / (1 - e2);
  const u = Math.atan2(p[2] * a, rho * b);
  let lat = Math.atan2(p[2] + ep2 * b * Math.sin(u) ** 3, rho - e2 * a * Math.cos(u) ** 3);
  let h = 0;
  for (let i = 0; i < 2; i++) {
    const s = Math.sin(lat),
      c = Math.cos(lat);
    const N = a / Math.sqrt(1 - e2 * s * s);
    h = Math.abs(c) > 1e-9 ? rho / c - N : Math.abs(p[2]) / Math.abs(s) - N * (1 - e2);
    lat = Math.atan2(p[2], rho * (1 - (e2 * N) / (N + h)));
  }
  return { lat, lon, h };
}

/** The squashed space's point of a body-fixed one [units of a: the ellipsoid there the unit sphere]. */
export function squash(p: Vec3, a: number, f: number): Vec3 {
  return [p[0] / a, p[1] / a, p[2] / (a * (1 - f))];
}

/** The metres a radial step of the squashed space is along the ground's normal, per metre of a, at a unit direction q there. */
export function squashedScale(q: Vec3, f: number): number {
  const ba = 1 - f;
  return Math.sqrt(1 - (1 - ba * ba) * q[2] * q[2]);
}

/** The geodetic direction (the ellipsoid's normal) at a unit direction q of the squashed space: the maps' latitude. */
export function geodeticDir(q: Vec3, f: number): Vec3 {
  if (f === 0) return q;
  const z = q[2] / (1 - f);
  const l = Math.hypot(q[0], q[1], z);
  return [q[0] / l, q[1] / l, z / l];
}

/**
 * A body-fixed point's height over the ellipsoid as the tracer draws the ground (the units of a): its
 * squashed radius less one, times the scale there — and the unit direction there (q) and its geodetic
 * direction (g: where the relief is read).
 */
export function squashedHeight(p: Vec3, a: number, f: number): { h: number; q: Vec3; g: Vec3 } {
  const s = squash(p, a, f);
  const r = Math.hypot(s[0], s[1], s[2]) || 1;
  const q: Vec3 = [s[0] / r, s[1] / r, s[2] / r];
  return { h: (r - 1) * a * squashedScale(q, f), q, g: geodeticDir(q, f) };
}

/** Whether a point at r² from the centre, z along the pole, is within the figure (a, f). */
export function withinFigure(r2: number, z: number, a: number, f: number): boolean {
  const k = 1 / (1 - f);
  return r2 - z * z + z * z * k * k < a * a;
}
