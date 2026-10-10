// The night sky's multiple exposures (PLAN-CIEL C10): what they render — the moments, the fixed view framing
// them, each exposure — for the runner (photo/multiexposure.ts), as photo/plans.ts does the analemma's and
// the eclipses'.
//  · The star trails: the tripod's frames over hours of a night, laid by lighten — each star an arc about
//    the celestial pole; the frames close enough that the arcs run on (a frame every half minute: a star on
//    the celestial equator moves a degree in four minutes); the ground the same in each.
//  · The Moon's way: the Moon over a night (a frame each hour), or at the same clock time day after day (its
//    phases marching east), or every lunar day (24 h 50 min: the lunar analemma, its loop) — each disc taken
//    close (a telephoto's frame, its own meter) and laid at its place over the landscape.

import { posKm, tOf } from "../eclipse/core";
import { azAltAt } from "../eclipse/earth-moon";
import { dot, len, sub } from "../math/vec3";
import type { Preset } from "../settings";
import type { Exposure } from "./multiexposure";
import { baseLast, closeFrame, type Framing, frame } from "./plans";

const D = Math.PI / 180;
const MIN = 60e3;
const HOUR = 3600e3;
const DAY = 86400e3;
/** the mean lunar day: the Moon back on the meridian [ms] */
export const LUNAR_DAY = (24 * 60 + 50) * MIN + 28e3;

/** The Moon's lit share seen from the Earth at a UTC time (0 new, 1 full). */
export function moonLit(ms: number): number {
  const e = posKm("earth", ms);
  const m = sub(posKm("moon", ms), e),
    s = sub(posKm("sun", ms), e);
  // (the phase angle at the Moon: the Sun's and the Earth's directions from it)
  const ms_ = sub(s, m),
    me = [-m[0], -m[1], -m[2]] as [number, number, number];
  const i = Math.acos(Math.max(-1, Math.min(1, dot(ms_, me) / (len(ms_) * len(me)))));
  return (1 + Math.cos(i)) / 2;
}

/** A night's span at a place [°]: the Sun under `alt` [°] from the evening of a date to the morning after [ms UTC]. */
export function nightOf(lat: number, lon: number, date: number, alt = -12): { from: number; to: number } | null {
  // (from the local noon of that day, ten-minute steps, then refined to a minute)
  const noon = Math.floor(date / DAY) * DAY + (12 - lon / 15) * HOUR;
  const sun = (t: number) => azAltAt("sun", lat * D, lon * D, 0, t).alt;
  let from = Number.NaN,
    to = Number.NaN;
  for (let t = noon; t < noon + DAY; t += 10 * MIN) {
    const a = sun(t) < alt,
      b = sun(t + 10 * MIN) < alt;
    if (!a && b && Number.isNaN(from)) from = refine(sun, t, alt);
    if (a && !b && !Number.isNaN(from)) {
      to = refine(sun, t, alt);
      break;
    }
  }
  if (Number.isNaN(from)) return sun(noon + 12 * HOUR) < alt ? { from: noon, to: noon + DAY } : null;
  return { from, to: Number.isNaN(to) ? noon + DAY : to };
}
function refine(f: (t: number) => number, t: number, v: number) {
  let lo = t,
    hi = t + 10 * MIN;
  const up = f(lo) < v;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (f(m) < v === up) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export interface TrailsOptions {
  lat: number;
  lon: number;
  /** the night's date (its evening) [ms UTC] */
  date: number;
  /** how long [h] (the night's dark hours at most), from the dark's start */
  hours: number;
  /** frames over it (more: the arcs run on) */
  count: number;
  /** where the tripod looks: the celestial pole (the arcs round it), or a quarter of the sky */
  toward: "pole" | "east" | "south" | "west" | "north";
  /** the vertical field [°] */
  fov: number;
  aspect: number;
  template: Preset;
  /** the meter's compensation [EV] (−: a darker sky, the stars standing out) */
  comp: number;
  /** a comet's tail: the older frames dimmer, each arc brightening to its head */
  comet: boolean;
}

/** The star trails' frames and view (null: no dark night there then — a summer near the poles). */
export function trailsPlan(o: TrailsOptions): { frames: Exposure[]; view: Framing; from: number; to: number } | null {
  // (the dark night: the Sun 16° under — the twilight's glow off the ground, the stars all out)
  const night = nightOf(o.lat, o.lon, o.date, -16);
  if (!night) return null;
  const to = Math.min(night.to, night.from + o.hours * HOUR);
  const pole = Math.abs(o.lat);
  const az = { pole: o.lat >= 0 ? 0 : 180, north: 0, east: 90, south: 180, west: 270 }[o.toward];
  // (the horizon a little over the frame's foot; toward the pole, the pole in it if the field allows)
  let alt = o.fov / 2 - 4;
  if (o.toward === "pole") alt = Math.min(Math.max(alt, pole + 8 - o.fov / 2), Math.max(pole, alt));
  const view: Framing = { az, alt, fov: o.fov };
  const n = Math.max(2, Math.round(o.count));
  const frames: Exposure[] = [];
  for (let i = 0; i < n; i++) {
    const ms = night.from + ((to - night.from) * i) / (n - 1);
    frames.push({
      preset: {
        ...o.template,
        ship: false,
        target: "earth",
        fov: o.fov,
        bloom: 0,
        lensFlare: 0,
        time: tOf(ms),
        pose: { at: [o.lat, o.lon], heading: az, off: [0, alt] },
      },
      exposure: "auto",
      comp: o.comp,
      blend: "lighten",
      // (a comet's tail: from a third of the light to the whole)
      gain: o.comet ? 0.3 + (0.7 * i) / (n - 1) : undefined,
      // (each star run on along its arc to where the next frame finds it)
      after: i < n - 1 ? starArcs(view, o.lat, (to - night.from) / (n - 1)) : undefined,
      label: `${new Date(ms).toISOString().slice(11, 16)} UTC`,
      ms,
    });
  }
  return { frames, view, from: night.from, to };
}

export interface MoonPathOptions {
  /** a night (a frame every `step` minutes), the same clock time each day, every lunar day (its loop) */
  mode: "night" | "daily" | "lunar";
  lat: number;
  lon: number;
  /** the night's date (its evening), or the first day [ms UTC] */
  date: number;
  /** night: minutes between frames (default 60), the hours about its highest (default 6) */
  step?: number;
  span?: number;
  /** daily, lunar: days (default 30) */
  days?: number;
  /** daily: the clock time [minutes after 00:00 UTC] */
  minutesUtc?: number;
  framing: "landscape" | "sky";
  /** under the Moons: the landscape at the middle moment (moonlit, a stop under the meter), at dusk, or black */
  base: "middle" | "dusk" | "none";
  aspect: number;
  template: Preset;
  /** the Moons' compensation [EV] on their meter */
  comp: number;
}

/** A moment of the Moon's way: when, its place (geometric) [°], its lit share. */
export interface MoonMoment {
  ms: number;
  az: number;
  alt: number;
  lit: number;
}

/** The Moon's moments: over the night (up, the Sun under −6°), or each day at that time, or each lunar day — those up. */
export function moonMoments(
  o: Pick<MoonPathOptions, "mode" | "lat" | "lon" | "date" | "step" | "span" | "days" | "minutesUtc">,
): MoonMoment[] {
  const at = (ms: number): MoonMoment => ({ ms, ...azAltAt("moon", o.lat * D, o.lon * D, 0, ms), lit: moonLit(ms) });
  const out: MoonMoment[] = [];
  if (o.mode === "night") {
    const night = nightOf(o.lat, o.lon, o.date, -6);
    if (!night) return out;
    // (the hours about its highest in the night: a whole night's arc from east to west would not fit a frame)
    let top = night.from,
      best = -90;
    for (let t = night.from; t <= night.to; t += 10 * MIN) {
      const a = at(t).alt;
      if (a > best) [best, top] = [a, t];
    }
    const half = ((o.span ?? 6) * HOUR) / 2;
    const from = Math.max(night.from, top - half),
      to = Math.min(night.to, top + half);
    const step = Math.max(5, o.step ?? 60) * MIN;
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
      const m = at(t);
      if (m.alt > 1) out.push(m);
    }
    return out;
  }
  const days = Math.max(2, Math.min(o.days ?? 30, 60));
  if (o.mode === "daily") {
    const day0 = Math.floor(o.date / DAY) * DAY + (o.minutesUtc ?? 21 * 60) * MIN;
    for (let i = 0; i < days; i++) {
      const m = at(day0 + i * DAY);
      if (m.alt > 1) out.push(m);
    }
    return out;
  }
  // (the lunar day's: from the Moon's first transit after the date, each 24 h 50 min)
  let t0 = o.date;
  let best = -90;
  for (let t = o.date; t < o.date + LUNAR_DAY; t += 10 * MIN) {
    const a = at(t).alt;
    if (a > best) [best, t0] = [a, t];
  }
  for (let i = 0; i < days; i++) {
    const m = at(t0 + i * LUNAR_DAY);
    if (m.alt > 1) out.push(m);
  }
  return out;
}

/** The Moon's way: its frames and the view framing them (null: the Moon not up then). */
export function moonPathPlan(o: MoonPathOptions): { frames: Exposure[]; view: Framing; moments: MoonMoment[] } | null {
  const moments = moonMoments(o);
  if (!moments.length) return null;
  const pts = moments.map((m) => ({ az: m.az, alt: m.alt }));
  const az0 = frame(pts, o.aspect).az;
  const view = o.framing === "landscape" ? frame([...pts, { az: az0, alt: -3 }], o.aspect, 5) : frame(pts, o.aspect, 4);
  const scene = (ms: number): Preset => ({
    ...o.template,
    ship: false,
    target: "moon",
    fov: view.fov,
    bloom: 0,
    lensFlare: 0,
    time: tOf(ms),
    pose: { at: [o.lat, o.lon], heading: view.az, off: [0, view.alt] },
  });
  const label = (ms: number) =>
    o.mode === "night" ? `${new Date(ms).toISOString().slice(11, 16)} UTC` : new Date(ms).toISOString().slice(0, 10);
  const frames: Exposure[] = moments.map((m) => ({
    ...closeFrame(scene(m.ms), m, o.lat, o.lon, 1.12),
    exposure: "auto",
    comp: o.comp,
    blend: "lighten",
    label: label(m.ms),
    ms: m.ms,
  }));
  if (o.base !== "none") {
    const mid = moments[Math.floor(moments.length / 2)]!.ms;
    const t = o.base === "middle" ? mid : duskOf(o.lat, o.lon, moments[0]!.ms);
    frames.push({
      preset: { ...scene(t), bloom: o.template.bloom ?? 0.1 },
      exposure: "auto",
      comp: o.base === "middle" ? -1 : 0,
      blend: "base",
      label: new Date(t).toISOString().slice(0, 16).replace("T", " "),
    });
  }
  return { frames: baseLast(frames), view, moments };
}

/** The dusk (the Sun at −4°, going down) of a moment's day at a place [°]. */
function duskOf(lat: number, lon: number, ms: number): number {
  const noon = Math.floor(ms / DAY) * DAY + (12 - lon / 15) * HOUR;
  const sun = (t: number) => azAltAt("sun", lat * D, lon * D, 0, t).alt;
  for (let t = noon; t < noon + 14 * HOUR; t += 10 * MIN) if (sun(t) > -4 && sun(t + 10 * MIN) <= -4) return refine(sun, t, -4);
  return noon + 9 * HOUR;
}

/** the Earth's turn against the stars [rad/ms] (a sidereal day) */
const SIDEREAL = (2 * Math.PI) / 86164090.5;

/**
 * A frame's stars run on along their arcs for `dt` [ms]: each point of light of the sky above the horizon
 * (brighter than its neighbourhood by a step — the ground, the sky's glow, smooth, never are) drawn along the
 * arc the sky's turn about the celestial pole carries it on — the exact one, the view's pinhole (its centre
 * at az, alt; its vertical field fov) — in half-pixel steps, lightened into the image.
 */
export function starArcs(view: Framing, lat: number, dt: number) {
  return (out: Uint8ClampedArray, px: Uint8Array, W: number, H: number) => {
    // (the view's axes in the local east, north, up)
    const dir = (a: number, e: number): [number, number, number] => [
      Math.cos(e * D) * Math.sin(a * D),
      Math.cos(e * D) * Math.cos(a * D),
      Math.sin(e * D),
    ];
    const f = dir(view.az, view.alt);
    const r: [number, number, number] = [Math.cos(view.az * D), -Math.sin(view.az * D), 0];
    const u: [number, number, number] = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const ty = Math.tan((view.fov * D) / 2),
      tx = (ty * W) / H;
    // (the pole's axis: the northern one, the sky turning westward about it — a turn of −ω t)
    const P: [number, number, number] = [0, Math.cos(lat * D), Math.sin(lat * D)];
    const ang = SIDEREAL * dt;
    const pxPerRad = H / 2 / ty;
    const lum = (k: number) => 0.2126 * px[k]! + 0.7152 * px[k + 1]! + 0.0722 * px[k + 2]!;
    for (let y = 3; y < H - 3; y++)
      for (let x = 3; x < W - 3; x++) {
        const k = (y * W + x) * 4;
        const L = lum(k);
        if (L < 24) continue;
        // (a point: the brightest of its 3×3, its ring 3 px out darker by a step on every side)
        let peak = true,
          ring = 0;
        for (let dy = -1; dy <= 1 && peak; dy++)
          for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && lum(k + (dy * W + dx) * 4) > L) peak = false;
        if (!peak) continue;
        // (every side of it darker — an edge between a glowing sky and a dark hill has a bright side)
        let ringMax = 0;
        for (const [dx, dy] of [
          [3, 0],
          [-3, 0],
          [0, 3],
          [0, -3],
          [2, 2],
          [-2, 2],
          [2, -2],
          [-2, -2],
        ] as const) {
          const v = lum(k + (dy * W + dx) * 4);
          ring += v;
          ringMax = Math.max(ringMax, v);
        }
        // (a bright star's own halo reaches its ring: then half again as bright as it will do)
        if (L < ring / 8 + 18 || (L < ringMax + 10 && L < ringMax * 1.5)) continue;
        // (its direction; above the horizon only — a lamp on the ground does not turn)
        const sx = ((2 * (x + 0.5)) / W - 1) * tx,
          sy = (1 - (2 * (y + 0.5)) / H) * ty;
        let d: [number, number, number] = [f[0] + r[0] * sx + u[0] * sy, f[1] + r[1] * sx + u[1] * sy, f[2] + r[2] * sx + u[2] * sy];
        const l = Math.hypot(...d);
        d = [d[0] / l, d[1] / l, d[2] / l];
        if (d[2] < 0.005) continue;
        // (steps: half a pixel of its arc — its distance from the pole's axis sets its pace)
        const pd = d[0] * P[0] + d[1] * P[1] + d[2] * P[2];
        const radial = Math.sqrt(Math.max(1 - pd * pd, 0));
        const steps = Math.min(Math.ceil((ang * radial * pxPerRad) / 0.5), 4000);
        if (steps < 1) continue;
        const c = [px[k]!, px[k + 1]!, px[k + 2]!];
        for (let i = 1; i <= steps; i++) {
          const a = (-ang * i) / steps;
          // (Rodrigues: d turned by a about P)
          const ca = Math.cos(a),
            sa = Math.sin(a);
          const cx = P[1] * d[2] - P[2] * d[1],
            cy = P[2] * d[0] - P[0] * d[2],
            cz = P[0] * d[1] - P[1] * d[0];
          const q = [
            d[0] * ca + cx * sa + P[0] * pd * (1 - ca),
            d[1] * ca + cy * sa + P[1] * pd * (1 - ca),
            d[2] * ca + cz * sa + P[2] * pd * (1 - ca),
          ];
          const z = q[0]! * f[0] + q[1]! * f[1] + q[2]! * f[2];
          if (z <= 0) break;
          const X = ((1 + (q[0]! * r[0] + q[1]! * r[1] + q[2]! * r[2]) / z / tx) / 2) * W,
            Y = ((1 - (q[0]! * u[0] + q[1]! * u[1] + q[2]! * u[2]) / z / ty) / 2) * H;
          const ix = Math.floor(X),
            iy = Math.floor(Y);
          if (ix < 0 || iy < 0 || ix >= W || iy >= H) break;
          const o = (iy * W + ix) * 4;
          for (let j = 0; j < 3; j++) if (c[j]! > out[o + j]!) out[o + j] = c[j]!;
        }
      }
  };
}
