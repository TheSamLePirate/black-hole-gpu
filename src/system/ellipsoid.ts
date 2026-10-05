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

import { add, dot, len, scale, sub, type Vec3 } from "../math/vec3";

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

/** The geodetic normal under p, in the same Cartesian frame (also the map's unit direction). */
export function geodeticNormal(a: number, f: number, p: Vec3): Vec3 {
  const g = cartToGeodetic(a, f, p);
  const c = Math.cos(g.lat);
  return [c * Math.cos(g.lon), c * Math.sin(g.lon), Math.sin(g.lat)];
}

/** Radius along a direction at a given geodetic height, in the units of a. */
export function radiusAtHeight(a: number, f: number, direction: Vec3, h: number): number {
  if (f === 0) return a + h;
  const l = Math.hypot(...direction);
  const u = direction.map((v) => v / l) as Vec3;
  let r = a / Math.sqrt(u[0] ** 2 + u[1] ** 2 + (u[2] / (1 - f)) ** 2) + h;
  for (let i = 0; i < 3; i++) {
    const p = u.map((v) => v * r) as Vec3;
    const n = geodeticNormal(a, f, p);
    r -= (cartToGeodetic(a, f, p).h - h) / (u[0] * n[0] + u[1] * n[1] + u[2] * n[2]);
  }
  return r;
}

/** First forward ray intersection with the figure; direction must be unit, result in units of a. */
export function rayFigure(origin: Vec3, direction: Vec3, a: number, f: number): number | null {
  const ro = squash(origin, a, f);
  const rs = squash(direction, a, f);
  const m = len(rs);
  const rd = scale(rs, 1 / m);
  const b = dot(ro, rd);
  const off = sub(ro, scale(rd, b));
  const h = 1 - dot(off, off);
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t / m : null;
}

/** Signed angular distance above the ellipsoid's limb, in physical body axes (radians).
 * The local tangent to the limb clips a small finite source; mirrored in trace.wgsl figureSunShare. */
export function figureSourceElevation(origin: Vec3, light: Vec3, a: number, f: number): number {
  const ro = scale(origin, 1 / a);
  const radial = scale(ro, 1 / len(ro));
  const L = scale(light, 1 / len(light));
  const cosSep = Math.max(-1, Math.min(1, -dot(radial, L)));
  const sep = Math.acos(cosSep);
  const lateral = add(L, scale(radial, cosSep));
  const ab = 1 / (1 - f);
  const stretch = (v: Vec3): Vec3 => [v[0], v[1], v[2] * ab];
  const os = stretch(ro);
  if (dot(os, os) <= 1) {
    const n = [ro[0], ro[1], ro[2] * ab * ab] as Vec3;
    return Math.asin(Math.max(-1, Math.min(1, dot(n, L) / len(n))));
  }
  if (len(lateral) < 1e-12) return cosSep > 0 ? -Math.PI / 2 : Math.PI / 2;
  const tangent = scale(lateral, 1 / len(lateral));
  const nr = stretch(radial),
    er = stretch(tangent);
  const c = dot(os, os) - 1;
  const A = dot(nr, nr),
    B = -dot(nr, er);
  const C = dot(os, er) ** 2 - c * dot(er, er);
  const limb = Math.atan2(A, Math.sqrt(Math.max(B * B - A * C, 0)) - B);
  const grazing = add(scale(radial, -Math.cos(limb)), scale(tangent, Math.sin(limb)));
  const gs = stretch(grazing);
  const grad = stretch(sub(scale(os, dot(os, gs)), scale(gs, c)));
  const angular = sub(grad, scale(grazing, dot(grad, grazing)));
  const towards = add(scale(radial, Math.sin(limb)), scale(tangent, Math.cos(limb)));
  return (sep - limb) * Math.abs(dot(angular, towards) / len(angular));
}

/** Uniform small disk above the local tangent to the limb (0 hidden, 1 fully visible). */
export function figureDiskShare(origin: Vec3, light: Vec3, angularRadius: number, a: number, f: number): number {
  const x = Math.max(-1, Math.min(1, figureSourceElevation(origin, light, a, f) / Math.max(angularRadius, 1e-8)));
  return 0.5 + (x * Math.sqrt(Math.max(1 - x * x, 0)) + Math.asin(x)) / Math.PI;
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
