// What the eclipse calculator's sheet draws of an eclipse (PLAN-CIEL C7) — computed in the planner's worker:
//  · a solar eclipse: its central path and limits, the greatest magnitude over the globe (a grid: the
//    partial zones), and seen from a place the Moon's way across the Sun (north up, east left — the sky
//    as one looks at it from the north), its contacts and heights;
//  · a lunar one: the Earth's shadow (umbra, penumbra) and the Moon's way through it in the same frame,
//    where the Moon is up at its greatest (a grid), and from a place the Moon's height at each contact;
//  · a transit: the planet's way across the Sun.

import { cross, dot, len, scale, sub, type Vec3 } from "../math/vec3";
import { bodyAxes, solarBody } from "../system/solar";
import { discsAt, earthLatLon, earthPointKm, posKm, radiusKm, shadowAt, tOf } from "./core";
import { altitudeAt, DANJON, lunarLocal, solarLocal, solarPath, type LunarEclipse, type SolarEclipse } from "./earth-moon";
import type { Transit } from "./moons";

const D = Math.PI / 180;
const MIN = 60e3;

/** The Earth's north on the home frame at a UTC time. */
const north = (ms: number): Vec3 => bodyAxes(solarBody("earth")!, tOf(ms))[2];

/** A frame across a direction u: north up (the Earth's pole projected), east to the left as seen looking along u. */
function skyFrame(u: Vec3, ms: number): { N: Vec3; E: Vec3 } {
  const n = north(ms);
  let N = sub(n, scale(u, dot(n, u)));
  N = scale(N, 1 / len(N));
  // (looking along u, north up: east is u × N's opposite — to the left)
  const E = cross(N, u);
  return { N, E };
}

export interface SkyTrack {
  /** times [ms] and the near body's centre from the far one's, in the far one's radii (x east, y north) */
  t: number[];
  x: number[];
  y: number[];
  /** the near body's radius over the far one's (at the greatest) */
  k: number;
}

/** The Moon's way across the Sun seen from a place, every `step` ms over [a, b]. */
function solarTrack(lat: number, lon: number, a: number, b: number, step: number): SkyTrack {
  const out: SkyTrack = { t: [], x: [], y: [], k: 1 };
  for (let t = a; t <= b + 1; t += step) {
    const p = earthPointKm(lat, lon, 0, t);
    const d = discsAt(p, "moon", "sun", t);
    const { N, E } = skyFrame(d.uFar, t);
    const off = sub(d.uNear, d.uFar);
    out.t.push(t);
    out.x.push(dot(off, E) / d.rFar);
    out.y.push(dot(off, N) / d.rFar);
    out.k = d.rNear / d.rFar;
  }
  return out;
}

/** The greatest magnitude of a solar eclipse over the globe (a grid of `cell`°), sampled over its course. */
export function solarMap(e: SolarEclipse, cell = 2): { w: number; h: number; mag: number[] } {
  const p1 = e.contacts.find((c) => c.name === "P1")?.t ?? e.t - 3 * 3600e3;
  const p4 = e.contacts.find((c) => c.name === "P4")?.t ?? e.t + 3 * 3600e3;
  const w = Math.round(360 / cell),
    h = Math.round(180 / cell);
  const mag = new Array<number>(w * h).fill(0);
  const RM = radiusKm("moon"),
    RS = radiusKm("sun");
  const n = Math.max(24, Math.ceil((p4 - p1) / (3 * MIN)));
  for (let s = 0; s <= n; s++) {
    const t = p1 + ((p4 - p1) * s) / n;
    const M = posKm("moon", t),
      S = posKm("sun", t);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const lat = (90 - (j + 0.5) * cell) * D,
          lon = (-180 + (i + 0.5) * cell) * D;
        const p = earthPointKm(lat, lon, 0, t);
        const m = sub(M, p),
          sv = sub(S, p);
        const dm = len(m),
          ds = len(sv);
        // (the Sun under the horizon there: not seen)
        const up = sub(p, posKm("earth", t));
        if (dot(sv, up) <= 0) continue;
        const rs = Math.asin(RS / ds),
          rm = Math.asin(RM / dm);
        const sep = Math.acos(Math.min(Math.max(dot(m, sv) / (dm * ds), -1), 1));
        const g = (rs + rm - sep) / (2 * rs);
        if (g > mag[j * w + i]!) mag[j * w + i] = Math.min(g, 1.1);
      }
  }
  return { w, h, mag };
}

/** The Moon's geometric height at a lunar eclipse's greatest over the globe (a grid of `cell`°). */
export function lunarMap(e: LunarEclipse, cell = 3): { w: number; h: number; alt: number[]; altStart: number[]; altEnd: number[] } {
  const w = Math.round(360 / cell),
    h = Math.round(180 / cell);
  const p1 = e.contacts.find((c) => c.name === "U1" || c.name === "P1")!.t;
  const p4 = [...e.contacts].reverse().find((c) => c.name === "U4" || c.name === "P4")!.t;
  const grid = (t: number) => {
    const out = new Array<number>(w * h);
    const E = posKm("earth", t),
      M = posKm("moon", t);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const lat = (90 - (j + 0.5) * cell) * D,
          lon = (-180 + (i + 0.5) * cell) * D;
        const p = earthPointKm(lat, lon, 0, t);
        const v = sub(M, p),
          up = sub(p, E);
        out[j * w + i] = Math.asin(dot(v, up) / (len(v) * len(up))) / D;
      }
    return out;
  };
  return { w, h, alt: grid(e.t), altStart: grid(p1), altEnd: grid(p4) };
}

export interface ShadowDiagram {
  /** the umbra's and the penumbra's radii at the Moon, in its radii, at the greatest */
  umbra: number;
  pen: number;
  /** the Moon's centre from the shadow's axis (x east, y north) in its radii, over the eclipse */
  t: number[];
  x: number[];
  y: number[];
}

/** The Earth's shadow and the Moon's way through it (north up, east left), every `step` ms. */
function lunarDiagram(e: LunarEclipse, step = 5 * MIN): ShadowDiagram {
  const Rm = radiusKm("moon");
  const a = e.contacts[0]!.t - 10 * MIN,
    b = e.contacts[e.contacts.length - 1]!.t + 10 * MIN;
  const g = shadowAt("earth", "moon", e.t, DANJON, 0.99834);
  const out: ShadowDiagram = { umbra: g.umbra / Rm, pen: g.pen / Rm, t: [], x: [], y: [] };
  for (let t = a; t <= b + 1; t += step) {
    const s = shadowAt("earth", "moon", t, DANJON, 0.99834);
    // (looking at the Moon from the Earth: along the axis, north up, east to the left)
    const { N, E } = skyFrame(s.axis, t);
    out.t.push(t);
    out.x.push(dot(s.off, E) / Rm);
    out.y.push(dot(s.off, N) / Rm);
  }
  return out;
}

/** A transit's way: the planet's centre from the Sun's (x east, y north) in the Sun's radii, from the Earth's centre. */
function transitTrack(e: Transit, step = 5 * MIN): SkyTrack {
  const out: SkyTrack = { t: [], x: [], y: [], k: 0 };
  for (let t = e.start - 10 * MIN; t <= e.end + 10 * MIN; t += step) {
    const p = posKm("earth", t);
    const d = discsAt(p, e.planet, "sun", t);
    const { N, E } = skyFrame(d.uFar, t);
    const off = sub(d.uNear, d.uFar);
    out.t.push(t);
    out.x.push(dot(off, E) / d.rFar);
    out.y.push(dot(off, N) / d.rFar);
    out.k = d.rNear / d.rFar;
  }
  return out;
}

export type EclipseDetail =
  | {
      kind: "solar";
      path: ReturnType<typeof solarPath>;
      map: ReturnType<typeof solarMap>;
      here: (ReturnType<typeof solarLocal> & { track: SkyTrack | null; sunAlts: { name: string; alt: number }[] }) | null;
    }
  | { kind: "lunar"; diagram: ShadowDiagram; map: ReturnType<typeof lunarMap>; here: ReturnType<typeof lunarLocal> | null }
  | { kind: "transit"; track: SkyTrack };

/** The sheet's drawings of an eclipse (`place` [°]: what is seen from there). */
export function eclipseDetail(e: SolarEclipse | LunarEclipse | Transit, place?: { lat: number; lon: number } | null): EclipseDetail {
  if (e.kind === "transit") return { kind: "transit", track: transitTrack(e) };
  if (e.kind === "lunar") {
    return {
      kind: "lunar",
      diagram: lunarDiagram(e),
      map: lunarMap(e),
      here: place ? lunarLocal(e, place.lat * D, place.lon * D, 0) : null,
    };
  }
  let here: Extract<EclipseDetail, { kind: "solar" }>["here"] = null;
  if (place) {
    const loc = solarLocal(place.lat * D, place.lon * D, 0, e.t);
    const c1 = loc.contacts.find((c) => c.name === "C1"),
      c4 = loc.contacts.find((c) => c.name === "C4");
    here = {
      ...loc,
      track: c1 && c4 ? solarTrack(place.lat * D, place.lon * D, c1.t - 5 * MIN, c4.t + 5 * MIN, (c4.t - c1.t + 10 * MIN) / 90) : null,
      sunAlts: [...loc.contacts, { name: "max", t: loc.max }].map((c) => ({
        name: c.name,
        alt: altitudeAt("sun", place.lat * D, place.lon * D, 0, c.t),
      })),
    };
  }
  return { kind: "solar", path: solarPath(e, MIN), map: solarMap(e), here };
}

/** Where an eclipse is best seen: the solar one's greatest point, the lunar one's sub-lunar point at its greatest [°]. */
export function bestPlace(e: SolarEclipse | LunarEclipse): { lat: number; lon: number } {
  if (e.kind === "solar") return { lat: e.greatest.lat, lon: e.greatest.lon };
  // (the Moon at the zenith: the ground under it, along its direction from the Earth's centre)
  const E = posKm("earth", e.t);
  const u = sub(posKm("moon", e.t), E);
  const ll = earthLatLon([E[0] + (u[0] / len(u)) * 6371, E[1] + (u[1] / len(u)) * 6371, E[2] + (u[2] / len(u)) * 6371], e.t);
  return { lat: ll.lat / D, lon: ll.lon / D };
}

export interface MoonsView {
  /** the planet's moons from its centre as seen from the Earth (x east, y north) in its radii; in front of it */
  moons: { id: string; x: number; y: number; r: number; front: boolean }[];
  /** the direction its shadow is cast across the view (unit, x east, y north), its phase angle [°] */
  shadow: { x: number; y: number };
  phase: number;
}

/** A planet and its moons as seen from the Earth at a UTC time (their light's delays in). */
export function moonsView(planet: string, ms: number, moons: string[]): MoonsView {
  const e = posKm("earth", ms);
  const pv = discsAt(e, planet, "sun", ms);
  const P = sub(posKm(planet, ms), e);
  const { N, E } = skyFrame(pv.uNear, ms);
  const R = radiusKm(planet);
  const out: MoonsView = { moons: [], shadow: { x: 0, y: 0 }, phase: 0 };
  for (const m of moons) {
    const d = discsAt(e, m, planet, ms);
    const off = sub(d.uNear, d.uFar);
    const dist = len(P);
    out.moons.push({ id: m, x: (dot(off, E) * dist) / R, y: (dot(off, N) * dist) / R, r: radiusKm(m) / R, front: d.front });
  }
  // (the Sun's light across the view: the shadow falls away from the Sun's side)
  const s = sub(posKm("sun", ms), posKm(planet, ms));
  const sx = -dot(s, E),
    sy = -dot(s, N);
  const l = Math.hypot(sx, sy) || 1;
  out.shadow = { x: sx / l, y: sy / l };
  out.phase = (Math.acos(Math.max(-1, Math.min(1, dot(s, scale(P, -1)) / (len(s) * len(P))))) * 180) / Math.PI;
  return out;
}
