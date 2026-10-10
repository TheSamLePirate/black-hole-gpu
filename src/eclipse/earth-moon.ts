// The Earth's and the Moon's eclipses (PLAN-CIEL C5): of the Sun by the Moon (the Moon's shadow on the
// Earth — total, annular, hybrid, partial: its greatest eclipse, gamma, magnitude, the path of the
// central phase and its width, the duration there), of the Moon by the Earth (the Earth's shadow on the
// Moon — total, partial, penumbral: its contacts, its umbral and penumbral magnitudes; the umbra grown by
// the air, Danjon's 1/85), and what one sees of either from a place (its contacts, the obscuration, the
// heights of the Sun or the Moon). Their saros: 38 lunations a step, mod 223, from known ones.

import { dot, len, scale, sub, type Vec3 } from "../math/vec3";
import { diskShare, discsAt, earthLatLon, earthPointKm, intervals, minimum, posKm, radiusKm, seenKm, shadowAt, tOf } from "./core";
import { bodyAxes, solarBody } from "../system/solar";

const DAY = 86400e3;
const MIN = 60e3;
const SYNODIC = 29.530588853 * DAY;
const D = Math.PI / 180;
/** the Earth's shadow for the Moon's eclipses (Danjon's rule, NASA's): its radius at 45° of latitude, grown by its air */
export const DANJON = 1 / 85;
const DANJON_R = 0.99834;

export type SolarType = "total" | "annular" | "hybrid" | "partial";
export type LunarType = "total" | "partial" | "penumbral";

export interface Contact {
  /** P1… (lunar), C1… (local), U1…: the phase's name */
  name: string;
  t: number;
}

export interface SolarEclipse {
  kind: "solar";
  type: SolarType;
  /** the greatest eclipse [ms UTC]: the shadow's axis nearest the Earth's centre */
  t: number;
  /** the axis's least distance from the centre [Earth radii], + north */
  gamma: number;
  /** the magnitude at the greatest eclipse: the Moon's diameter over the Sun's (central), else the share of the Sun's diameter covered */
  magnitude: number;
  /** where it is greatest [° geodetic], the Sun's height there [°], the central phase's duration there [s] and the path's width [km] */
  greatest: { lat: number; lon: number; sunAlt: number; duration: number; width: number };
  /** the penumbra's first and last touch of the Earth, the central phase's (C, central only) */
  contacts: Contact[];
  saros: number;
}

export interface LunarEclipse {
  kind: "lunar";
  type: LunarType;
  /** the greatest eclipse [ms UTC]: the Moon's centre nearest the shadow's axis (as seen from the Earth) */
  t: number;
  /** the axis's least distance from the Moon's centre [Earth radii], + north */
  gamma: number;
  umbral: number;
  penumbral: number;
  /** P1, U1, U2, U3, U4, P4 (those it has) */
  contacts: Contact[];
  /** the partial and total phases' durations [s] (0: none) */
  partial: number;
  total: number;
  saros: number;
}

/** The geocentric elongation of the Moon from the Sun [rad] at a UTC time. */
function elongation(ms: number): number {
  const e = posKm("earth", ms);
  const m = sub(posKm("moon", ms), e),
    s = sub(posKm("sun", ms), e);
  return Math.acos(Math.max(-1, Math.min(1, dot(m, s) / (len(m) * len(s)))));
}

/** The new (or full) moons in [a, b]: the elongation's minima (maxima), to a minute. */
export function lunations(a: number, b: number, full = false): number[] {
  const f = (t: number) => (full ? -elongation(t) : elongation(t));
  const out: number[] = [];
  let t = a - 2 * DAY;
  let f0 = f(t - DAY),
    f1 = f(t);
  while (t < b + 2 * DAY) {
    const f2 = f(t + DAY);
    if (f1 <= f0 && f1 <= f2) {
      const m = minimum(f, t - DAY, t + DAY, MIN).t;
      if (m >= a && m < b) out.push(m);
      t += 25 * DAY;
      f0 = f(t - DAY);
      f1 = f(t);
      continue;
    }
    f0 = f1;
    f1 = f2;
    t += DAY;
  }
  return out;
}

/** The saros of an eclipse at a lunation, from a known one (`at`, of `saros`): 38 a lunation, mod 223. */
function sarosOf(t: number, at: number, saros: number): number {
  const k = Math.round((t - at) / SYNODIC);
  return ((((saros - 1 + 38 * k) % 223) + 223) % 223) + 1;
}
// (2024-04-08: saros 139; 2025-09-07's lunar eclipse: saros 128)
const SOLAR_ANCHOR = Date.UTC(2024, 3, 8, 18, 17);
const LUNAR_ANCHOR = Date.UTC(2025, 8, 7, 18, 12);

/** The Earth's north on the home frame at a UTC time. */
const northAt = (ms: number): Vec3 => bodyAxes(solarBody("earth")!, tOf(ms))[2];

/** Where a line (a point, a unit direction) first meets the Earth's ellipsoid [km, home frame], or null. */
function hitEarth(p: Vec3, u: Vec3, ms: number): Vec3 | null {
  const A = bodyAxes(solarBody("earth")!, tOf(ms));
  const c = posKm("earth", ms);
  const k = 1 / (1 - 1 / 298.257223563);
  // (on the Earth's axes, z stretched: the ellipsoid the sphere of radius a)
  const to = (v: Vec3): Vec3 => [dot(v, A[0]), dot(v, A[1]), dot(v, A[2]) * k];
  const q = to(sub(p, c)),
    w = to(u);
  const a = 6378.137;
  const ww = dot(w, w),
    b = dot(q, w),
    cc = dot(q, q) - a * a;
  const disc = b * b - ww * cc;
  if (disc < 0) return null;
  const s = (-b - Math.sqrt(disc)) / ww;
  return [p[0] + u[0] * s, p[1] + u[1] * s, p[2] + u[2] * s];
}

/** The solar eclipses in [a, b] (UTC ms), their greatest moments, types, paths' figures. */
export function solarEclipses(a: number, b: number): SolarEclipse[] {
  const out: SolarEclipse[] = [];
  const RE = radiusKm("earth");
  for (const nm of lunations(a, b)) {
    // (no eclipse unless the Moon passes within ~1.6° of the Sun)
    if (elongation(nm) > 1.65 * D) continue;
    const g = (t: number) => shadowAt("moon", "earth", t).d;
    const best = minimum(g, nm - 0.4 * DAY, nm + 0.4 * DAY, 500);
    const sh = shadowAt("moon", "earth", best.t);
    if (sh.d > sh.pen + RE * 1.0001) continue;
    const t = best.t;
    const gamma = (sh.d / RE) * Math.sign(dot(scale(sh.off, -1), northAt(t)) || 1);
    // (the penumbra's touches of the Earth, the umbra's — central when the axis meets it)
    const pen = intervals(
      (x) => shadowAt("moon", "earth", x).d - (shadowAt("moon", "earth", x).pen + RE),
      t - 0.3 * DAY,
      t + 0.3 * DAY,
      () => 4 * MIN,
      1000,
    )[0];
    const axisHit = (x: number) => {
      const s = shadowAt("moon", "earth", x);
      return hitEarth(s.occ, s.axis, x);
    };
    const central = intervals(
      (x) => (axisHit(x) ? -1 : 1),
      t - 0.15 * DAY,
      t + 0.15 * DAY,
      () => 2 * MIN,
      1000,
    )[0];
    // (the type: the umbra's radius where the axis meets the ground — positive total, negative annular; both along the path: hybrid)
    let type: SolarType = "partial";
    let gp: Vec3 | null = axisHit(t);
    if (central) {
      const umbraAt = (x: number) => {
        const s = shadowAt("moon", "earth", x);
        const p = hitEarth(s.occ, s.axis, x);
        return p ? umbraAtGround(s, p) : s.umbra;
      };
      const mid = umbraAt(t),
        e0 = umbraAt(central[0] + 30e3),
        e1 = umbraAt(central[1] - 30e3);
      type = mid > 0 ? (e0 < 0 || e1 < 0 ? "hybrid" : "total") : e0 > 0 || e1 > 0 ? "hybrid" : "annular";
    } else if (sh.d < RE + Math.abs(sh.umbra)) type = sh.umbra > 0 ? "total" : "annular";
    // (the greatest eclipse's place: where the axis meets the ground, else the ground nearest the axis)
    if (!gp) gp = sub(posKm("earth", t), scale(sh.off, RE / sh.d));
    const ll = earthLatLon(gp, t);
    const loc = solarLocal(ll.lat, ll.lon, 0, t);
    const dur = loc.contacts.find((c) => c.name === "C2") && loc.contacts.find((c) => c.name === "C3");
    const width = central ? pathWidth(t) : 0;
    const contacts: Contact[] = [];
    if (pen) contacts.push({ name: "P1", t: pen[0] }, { name: "P4", t: pen[1] });
    if (central) contacts.push({ name: "C1", t: central[0] }, { name: "C2", t: central[1] });
    contacts.sort((x, y) => x.t - y.t);
    out.push({
      kind: "solar",
      type,
      t,
      gamma,
      magnitude: central ? loc.ratio : loc.magnitude,
      greatest: {
        lat: ll.lat / D,
        lon: ll.lon / D,
        sunAlt: loc.sunAltMax,
        duration: dur ? (loc.contacts.find((c) => c.name === "C3")!.t - loc.contacts.find((c) => c.name === "C2")!.t) / 1000 : 0,
        width,
      },
      contacts,
      saros: sarosOf(t, SOLAR_ANCHOR, 139),
    });
  }
  return out;
}

/** The umbra's radius at the ground under the axis, p [km]: its radius at the Earth's centre's plane,
 *  moved along the axis to p (the cone wider nearer the Moon). */
function umbraAtGround(s: ReturnType<typeof shadowAt>, p: Vec3): number {
  return s.umbra + (s.z - dot(sub(p, s.occ), s.axis)) * s.tanU;
}

/**
 * The central line's point and its limits at a UTC time [km, home frame]: the axis's foot, and the feet of
 * the lines beside it its umbra's (antumbra's) radius away across the shadow's motion, in its own plane.
 */
function limitsAt(ms: number): { centre: Vec3; north: Vec3 | null; south: Vec3 | null } | null {
  const s = shadowAt("moon", "earth", ms);
  const p = hitEarth(s.occ, s.axis, ms);
  if (!p) return null;
  const r = Math.abs(umbraAtGround(s, p));
  const s2 = shadowAt("moon", "earth", ms + 10e3);
  const v = sub(s2.off, s.off);
  const along = sub(v, scale(s.axis, dot(v, s.axis)));
  const n = len(along) > 0 ? scale(along, 1 / len(along)) : northAt(ms);
  const perp: Vec3 = [s.axis[1] * n[2] - s.axis[2] * n[1], s.axis[2] * n[0] - s.axis[0] * n[2], s.axis[0] * n[1] - s.axis[1] * n[0]];
  const side = dot(perp, northAt(ms)) >= 0 ? 1 : -1;
  const foot = (k: number) => hitEarth([s.occ[0] + perp[0] * r * k, s.occ[1] + perp[1] * r * k, s.occ[2] + perp[2] * r * k], s.axis, ms);
  return { centre: p, north: foot(side), south: foot(-side) };
}

/** The central path's width at a UTC time [km]: between its limits on the ground. */
function pathWidth(ms: number): number {
  const l = limitsAt(ms);
  return l?.north && l.south ? len(sub(l.north, l.south)) : 0;
}

/** The central line and its limits, every `step` ms through the central phase: [lat, lon] in degrees. */
export function solarPath(
  e: SolarEclipse,
  step = 2 * MIN,
): { centre: [number, number][]; north: [number, number][]; south: [number, number][] } {
  const c0 = e.contacts.find((c) => c.name === "C1"),
    c1 = e.contacts.find((c) => c.name === "C2");
  const out = { centre: [] as [number, number][], north: [] as [number, number][], south: [] as [number, number][] };
  if (!c0 || !c1) return out;
  const deg = (p: Vec3, t: number): [number, number] => {
    const l = earthLatLon(p, t);
    return [l.lat / D, l.lon / D];
  };
  for (let t = c0.t + 1000; t <= c1.t - 1000; t += step) {
    const l = limitsAt(t);
    if (!l) continue;
    out.centre.push(deg(l.centre, t));
    if (l.north) out.north.push(deg(l.north, t));
    if (l.south) out.south.push(deg(l.south, t));
  }
  return out;
}

export interface SolarLocal {
  /** C1 (first contact), C2, C3 (the central phase's, when there is one), C4; max: the greatest */
  contacts: Contact[];
  max: number;
  /** the share of the Sun's diameter covered at the greatest, the Moon's diameter over the Sun's, the share of its disc hidden */
  magnitude: number;
  ratio: number;
  obscuration: number;
  /** total, annular, partial, or none here */
  type: "total" | "annular" | "partial" | "none";
  /** the Sun's geometric height at the greatest [°], and its highest during the eclipse */
  sunAlt: number;
  sunAltMax: number;
}

/** A place's zenith [unit, home frame] at a UTC time. */
function zenithAt(lat: number, lon: number, ms: number): Vec3 {
  const A = bodyAxes(solarBody("earth")!, tOf(ms));
  const zb: Vec3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  return [
    A[0][0] * zb[0] + A[1][0] * zb[1] + A[2][0] * zb[2],
    A[0][1] * zb[0] + A[1][1] * zb[1] + A[2][1] * zb[2],
    A[0][2] * zb[0] + A[1][2] * zb[1] + A[2][2] * zb[2],
  ];
}

/** A body's geometric height [°] seen from a place (lat, lon [rad], h [m]) at a UTC time. */
export function altitudeAt(id: string, lat: number, lon: number, hM: number, ms: number): number {
  const p = earthPointKm(lat, lon, hM, ms);
  const v = sub(seenKm(id, ms, p), p);
  return Math.asin(dot(v, zenithAt(lat, lon, ms)) / len(v)) / D;
}

/** A body's azimuth (from the north, eastwards) and geometric altitude [°] from a place (lat, lon [rad], h [m]) at a UTC time. */
export function azAltAt(id: string, lat: number, lon: number, hM: number, ms: number): { az: number; alt: number } {
  const p = earthPointKm(lat, lon, hM, ms);
  const v = sub(seenKm(id, ms, p), p);
  const A = bodyAxes(solarBody("earth")!, tOf(ms));
  const z = zenithAt(lat, lon, ms);
  // (east: the pole × up; north: up × east)
  const pole = A[2];
  let e: Vec3 = [pole[1] * z[2] - pole[2] * z[1], pole[2] * z[0] - pole[0] * z[2], pole[0] * z[1] - pole[1] * z[0]];
  e = scale(e, 1 / len(e));
  const n: Vec3 = [z[1] * e[2] - z[2] * e[1], z[2] * e[0] - z[0] * e[2], z[0] * e[1] - z[1] * e[0]];
  const l = len(v);
  return {
    az: ((((Math.atan2(dot(v, e), dot(v, n)) * 180) / Math.PI) % 360) + 360) % 360,
    alt: (Math.asin(dot(v, z) / l) * 180) / Math.PI,
  };
}

/** A solar eclipse seen from a place (lat, lon [rad], height [m]) about its greatest moment t. */
export function solarLocal(lat: number, lon: number, hM: number, t: number): SolarLocal {
  const at = (x: number) => discsAt(earthPointKm(lat, lon, hM, x), "moon", "sun", x);
  const best = minimum((x) => at(x).sep, t - 0.15 * DAY, t + 0.15 * DAY, 200);
  const d = at(best.t);
  const contacts: Contact[] = [];
  const part = intervals(
    (x) => {
      const q = at(x);
      return q.sep - (q.rNear + q.rFar);
    },
    t - 0.2 * DAY,
    t + 0.2 * DAY,
    () => 3 * MIN,
    300,
  )[0];
  let type: SolarLocal["type"] = "none";
  if (part) {
    contacts.push({ name: "C1", t: part[0] }, { name: "C4", t: part[1] });
    type = "partial";
    const cen = intervals(
      (x) => {
        const q = at(x);
        return q.sep - Math.abs(q.rFar - q.rNear);
      },
      part[0],
      part[1],
      () => 20e3,
      100,
    )[0];
    if (cen) {
      contacts.push({ name: "C2", t: cen[0] }, { name: "C3", t: cen[1] });
      type = d.rNear > d.rFar ? "total" : "annular";
    }
    contacts.sort((x, y) => x.t - y.t);
  }
  const sunAlt = altitudeAt("sun", lat, lon, hM, best.t);
  const sunAltMax = part ? Math.max(sunAlt, altitudeAt("sun", lat, lon, hM, part[0]), altitudeAt("sun", lat, lon, hM, part[1])) : sunAlt;
  return {
    contacts,
    max: best.t,
    magnitude: Math.max((d.rFar + d.rNear - d.sep) / (2 * d.rFar), 0),
    ratio: d.rNear / d.rFar,
    obscuration: 1 - diskShare(d.rFar, d.rNear, d.sep),
    type,
    sunAlt,
    sunAltMax,
  };
}

/** The share of the Sun's disc the Moon hides, seen from a place (lat, lon [rad], height [m]) at a UTC time. */
export function sunHidden(lat: number, lon: number, hM: number, ms: number): number {
  const d = discsAt(earthPointKm(lat, lon, hM, ms), "moon", "sun", ms);
  return 1 - diskShare(d.rFar, d.rNear, d.sep);
}

/** The share of the Moon's disc inside the Earth's umbra (Danjon's) at a UTC time. */
export function moonInUmbra(ms: number): number {
  const s = shadowAt("earth", "moon", ms, DANJON, DANJON_R);
  return s.umbra > 0 ? 1 - diskShare(s.R, s.umbra, s.d) : 0;
}

/** The lunar eclipses in [a, b] (UTC ms). */
export function lunarEclipses(a: number, b: number): LunarEclipse[] {
  const out: LunarEclipse[] = [];
  const RE = radiusKm("earth");
  const Rm = radiusKm("moon");
  const sh = (t: number) => shadowAt("earth", "moon", t, DANJON, DANJON_R);
  for (const fm of lunations(a, b, true)) {
    if (Math.PI - elongation(fm) > 1.8 * D) continue;
    const best = minimum((x) => sh(x).d, fm - 0.4 * DAY, fm + 0.4 * DAY, 500);
    const s = sh(best.t);
    const penumbral = (s.pen + Rm - s.d) / (2 * Rm);
    if (penumbral <= 0) continue;
    const umbral = (s.umbra + Rm - s.d) / (2 * Rm);
    // (as seen from the Earth: the Moon's light 1.3 s on its way)
    const lt = (len(sub(s.rec, posKm("earth", best.t))) / 299792.458) * 1000;
    const win = (f: (x: number) => number) => intervals(f, best.t - 0.3 * DAY, best.t + 0.3 * DAY, () => 4 * MIN, 500)[0];
    const P = win((x) => sh(x).d - (sh(x).pen + Rm));
    const U = umbral > 0 ? win((x) => sh(x).d - (sh(x).umbra + Rm)) : undefined;
    const T = umbral >= 1 ? win((x) => sh(x).d - (sh(x).umbra - Rm)) : undefined;
    const contacts: Contact[] = [];
    if (P) contacts.push({ name: "P1", t: P[0] + lt }, { name: "P4", t: P[1] + lt });
    if (U) contacts.push({ name: "U1", t: U[0] + lt }, { name: "U4", t: U[1] + lt });
    if (T) contacts.push({ name: "U2", t: T[0] + lt }, { name: "U3", t: T[1] + lt });
    contacts.sort((x, y) => x.t - y.t);
    const north = dot(scale(s.off, 1), northAt(best.t));
    out.push({
      kind: "lunar",
      type: umbral >= 1 ? "total" : umbral > 0 ? "partial" : "penumbral",
      t: best.t + lt,
      gamma: (s.d / RE) * Math.sign(north || 1),
      umbral,
      penumbral,
      contacts,
      partial: U ? (U[1] - U[0]) / 1000 : 0,
      total: T ? (T[1] - T[0]) / 1000 : 0,
      saros: sarosOf(best.t, LUNAR_ANCHOR, 128),
    });
  }
  return out;
}

/** A lunar eclipse seen from a place: the Moon's geometric height at each of its contacts and at the greatest [°]. */
export function lunarLocal(
  e: LunarEclipse,
  lat: number,
  lon: number,
  hM = 0,
): { name: string; t: number; moonAlt: number; sunAlt: number }[] {
  return [...e.contacts, { name: "max", t: e.t }]
    .sort((x, y) => x.t - y.t)
    .map((c) => ({ ...c, moonAlt: altitudeAt("moon", lat, lon, hM, c.t), sunAlt: altitudeAt("sun", lat, lon, hM, c.t) }));
}

export { earthPointKm };
