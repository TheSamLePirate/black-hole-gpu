// The network session's pure decisions (audit 2026-11-10, QA-10: ui/netsession.ts, 2 157 lines, was imported by no test): where a
// craft is parked (its latitude, longitude and heading over WGS84), whether another's last samples follow one another, an age said
// short, a coasting craft carried along its orbit and its body's flattening's pull. Taken out of netsession.ts as they were; tested
// in tests/netsession-pure.test.ts.

import type { Vec3 } from "../math/vec3";
import { NET_BODIES } from "../controller/netcraft";
import { tf } from "../i18n";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { zonalAccel } from "../system/geopotential";
import { keplerProp } from "../system/our-plan";
import { solarBody } from "../system/solar";
import { C_MPS, M_METRES, M_SECONDS } from "../units";

/** an Earth-fixed place [m] and nose → geodetic latitude, longitude, heading [°] */
export function parkedAt(p: Vec3, fwd: Vec3) {
  const g = cartToGeodetic(WGS84_A, WGS84_F, p);
  const north: Vec3 = [-Math.sin(g.lat) * Math.cos(g.lon), -Math.sin(g.lat) * Math.sin(g.lon), Math.cos(g.lat)];
  const east: Vec3 = [-Math.sin(g.lon), Math.cos(g.lon), 0];
  const D = 180 / Math.PI;
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { lat: g.lat * D, lon: g.lon * D, heading: (Math.atan2(dot(fwd, east), dot(fwd, north)) * D + 360) % 360 };
}

/** a body's pull at p (its inertial frame [m]) besides its centre's — its flattening: J2, J3, J4 — at scene time t
 *  [s], in m/s² (the game's own model: geopotential.ts) */
export function pertOf(body: number, p: Vec3, t: number): Vec3 {
  const id = NET_BODIES[body] ?? "";
  const b = solarBody(id);
  if (!b) return [0, 0, 0];
  const z = zonalAccel(id, b.mass, scale3(p, 1 / M_METRES), t / M_SECONDS);
  return z ? scale3(z as Vec3, (C_MPS * C_MPS) / M_METRES) : [0, 0, 0];
}

/** a coasting craft carried along its orbit about a body (the body's inertial frame, m and m/s) by dt [s] */
export function keplerOf(body: number, p: Vec3, v: Vec3, dt: number): { p: Vec3; v: Vec3 } | null {
  const b = solarBody(NET_BODIES[body] ?? "");
  if (!b || !(b.mass > 0)) return null;
  const o = keplerProp(b.mass, scale3(p, 1 / M_METRES), scale3(v, 1 / C_MPS), dt / M_SECONDS);
  return { p: scale3(o.r as Vec3, M_METRES), v: scale3(o.v as Vec3, C_MPS) };
}
const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** Another's last three samples consistent with one another (each where the one before's motion put it, within
 *  50 m): not a placement's jump. */
export function steady(S: { t: number; p: number[]; v: number[] }[] | undefined) {
  if (!S || S.length < 3) return false;
  for (let i = S.length - 2; i < S.length; i++) {
    const a = S[i - 1]!,
      b = S[i]!;
    const h = b.t - a.t;
    if (h <= 0 || h > 1) return false;
    if (Math.hypot(...b.p.map((x, k) => x - a.p[k]! - a.v[k]! * h)) > 50) return false;
  }
  return true;
}

/** an age said short: 4 min, 2 h 10, 3 d */
export function formatAge(s: number): string {
  if (s < 3600) return tf("{0} min", Math.max(1, Math.round(s / 60)));
  if (s < 86400 * 2) return tf("{0} h {1}", Math.floor(s / 3600), String(Math.floor((s % 3600) / 60)).padStart(2, "0"));
  return tf("{0} d", Math.round(s / 86400));
}
