// What a multiple exposure renders (PLAN-CIEL C8–C10): the moments, the fixed view framing them, each
// exposure — for the runner (photo/multiexposure.ts).
//  · The analemma: the Sun at the same clock time every few days for a year, from the same place, the same
//    view — its figure-of-eight (the year's declination up and down, the equation of time east and west);
//    the view aimed at its middle and wide enough for it all; each Sun a short dark exposure (the sky black,
//    its disc a dot), laid over a base: the place at dusk (or at that hour), its landscape.

import { azAltAt } from "../eclipse/earth-moon";
import { apparentAltitude, seaRefractivity } from "../system/refraction";
import { tOf } from "../eclipse/core";
import type { Preset } from "../settings";
import type { Exposure } from "./multiexposure";

const DAY = 86400e3;
const D = Math.PI / 180;

export interface AnalemmaOptions {
  /** the place [°] */
  lat: number;
  lon: number;
  /** the clock time each day [minutes after 00:00 UTC] (no daylight saving: the Sun's own clock) */
  minutesUtc: number;
  /** the first day (any time in it) [ms UTC] */
  start: number;
  /** days between exposures (photographers: 7 to 10) */
  cadence: number;
  /** exposures (default: a year's) */
  count?: number;
  /** the base under the Suns: the place at dusk on the first day, at that hour, or none (black) */
  base: "dusk" | "same" | "none";
  /** the image's width over its height */
  aspect: number;
  /** a ground scene to start from (its settings: no ship, the Earth's view) */
  template: Preset;
  /** the Sun's exposures [EV, fixed]: dark — the sky black, its disc a dot */
  sunEV: number;
}

export interface Framing {
  /** the view's centre: azimuth (from the north, eastwards) and altitude [°], its vertical field [°] */
  az: number;
  alt: number;
  fov: number;
}

/** The Sun's places at the analemma's moments, from a place [°]. */
export function analemmaSuns(o: Pick<AnalemmaOptions, "lat" | "lon" | "minutesUtc" | "start" | "cadence" | "count">) {
  const day0 = Math.floor(o.start / DAY) * DAY;
  const n = o.count ?? Math.floor(365.25 / o.cadence) + 1;
  const out: { ms: number; az: number; alt: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ms = day0 + i * o.cadence * DAY + o.minutesUtc * 60e3;
    out.push({ ms, ...azAltAt("sun", o.lat * D, o.lon * D, 0, ms) });
  }
  return out;
}

/** A view framing points of the sky (their azimuth and altitude [°]): their middle, wide enough with a margin, for an image of `aspect`. */
export function frame(points: { az: number; alt: number }[], aspect: number, margin = 6): Framing {
  // (the azimuths' middle, the circle's: the mean of their unit vectors)
  const sx = points.reduce((s, p) => s + Math.sin(p.az * D), 0),
    cx = points.reduce((s, p) => s + Math.cos(p.az * D), 0);
  const az = (((Math.atan2(sx, cx) / D) % 360) + 360) % 360;
  const alts = points.map((p) => p.alt);
  const lo = Math.min(...alts),
    hi = Math.max(...alts);
  const alt = (lo + hi) / 2;
  const span = (p: { az: number }) => Math.abs(((((p.az - az) % 360) + 540) % 360) - 180);
  const wide = 2 * Math.max(...points.map((p) => span(p) * Math.cos(p.alt * D)));
  const fov = Math.min(Math.max(hi - lo + 2 * margin, (wide + 2 * margin) / aspect, 10), 120);
  return { az, alt, fov };
}

/** When the Sun stands at an altitude [°], going down, after a moment [ms] (within a day), at a place [°]. */
function sunDown(lat: number, lon: number, after: number, alt: number): number {
  const f = (t: number) => azAltAt("sun", lat * D, lon * D, 0, t).alt - alt;
  let a = after;
  // (step an hour until it crosses going down)
  for (let k = 0; k < 24; k++) {
    const b = a + 3600e3;
    if (f(a) > 0 && f(b) <= 0) {
      let lo = a,
        hi = b;
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (f(m) > 0) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    }
    a = b;
  }
  return after;
}

/** The analemma's exposures and the view framing them. */
export function analemmaPlan(o: AnalemmaOptions): { frames: Exposure[]; view: Framing; suns: { ms: number; az: number; alt: number }[] } {
  const suns = analemmaSuns(o);
  const up = suns.filter((s) => s.alt > -1);
  // (the horizon in the frame too, under the figure: the landscape the Suns stand over)
  const pts = up.length ? up : suns;
  const az0 = frame(pts, o.aspect).az;
  const view = frame([...pts, { az: az0, alt: -4 }], o.aspect, 4);
  const scene = (ms: number): Preset => ({
    ...o.template,
    ship: false,
    target: "sun",
    fov: view.fov,
    bloom: 0,
    lensFlare: 0,
    time: tOf(ms),
    pose: { at: [o.lat, o.lon], heading: view.az, off: [0, view.alt] },
  });
  const frames: Exposure[] = [];
  if (o.base !== "none") {
    const day0 = Math.floor(o.start / DAY) * DAY;
    const t = o.base === "dusk" ? sunDown(o.lat, o.lon, day0 + o.minutesUtc * 60e3, -2) : suns[0]!.ms;
    frames.push({
      preset: { ...scene(t), bloom: o.template.bloom },
      exposure: "auto",
      blend: "base",
      label: new Date(t).toISOString().slice(0, 16).replace("T", " "),
    });
  }
  for (const s of up)
    frames.push({ preset: scene(s.ms), exposure: o.sunEV, blend: "lighten", label: new Date(s.ms).toISOString().slice(0, 10) });
  return { frames, view, suns };
}

/** Where a direction of the sky (azimuth, altitude [°]) falls in the image of a view (a pinhole: its vertical
 *  field), as pixels of a W × H image; null: behind the camera. */
export function projectSky(view: Framing, az: number, alt: number, W: number, H: number): [number, number] | null {
  const dir = (a: number, e: number): [number, number, number] => [
    Math.cos(e * D) * Math.sin(a * D),
    Math.cos(e * D) * Math.cos(a * D),
    Math.sin(e * D),
  ];
  const f = dir(view.az, view.alt);
  const r: [number, number, number] = [Math.cos(view.az * D), -Math.sin(view.az * D), 0];
  // (up: the zenith less its part along the look)
  const fz = f[2];
  const ul = Math.hypot(-f[0] * fz, -f[1] * fz, 1 - fz * fz);
  const u: [number, number, number] = [(-f[0] * fz) / ul, (-f[1] * fz) / ul, (1 - fz * fz) / ul];
  const d = dir(az, alt);
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const z = dot(d, f);
  if (z <= 0) return null;
  const ty = Math.tan((view.fov * D) / 2);
  const tx = ty * (W / H);
  return [((1 + dot(d, r) / z / tx) / 2) * W, ((1 - dot(d, u) / z / ty) / 2) * H];
}

/** A Sun of the composite: where it falls in the image [px], its date [ms UTC], its place in the sky as seen
 *  (azimuth from the north eastwards, altitude raised by the air) [°]. */
export interface SunMark {
  x: number;
  y: number;
  ms: number;
  az: number;
  alt: number;
}

/** The analemma's Suns placed in its image (as seen: raised by the air's refraction), with their dates. */
export function analemmaMarks(suns: { ms: number; az: number; alt: number }[], view: Framing, W: number, H: number): SunMark[] {
  const out: SunMark[] = [];
  for (const s of suns) {
    if (s.alt <= -1) continue;
    const a = apparentAltitude(s.alt * D, 0, seaRefractivity()) / D;
    const p = projectSky(view, s.az, a, W, H);
    if (p) out.push({ x: p[0], y: p[1], ms: s.ms, az: s.az, alt: a });
  }
  return out;
}
