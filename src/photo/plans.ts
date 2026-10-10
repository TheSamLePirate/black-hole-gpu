// What a multiple exposure renders (PLAN-CIEL C8–C10): the moments, the fixed view framing them, each
// exposure — for the runner (photo/multiexposure.ts).
//  · The analemma: the Sun at the same clock time every few days for a year, from the same place, the same
//    view — its figure-of-eight (the year's declination up and down, the equation of time east and west);
//    the view aimed at its middle and wide enough for it all; each Sun a short dark exposure (the sky black,
//    its disc a dot), laid over a base: the place at dusk (or at that hour), its landscape.
//  · An eclipse's sequence: the Sun's (or the Moon's) phases from a place — some before the central phase,
//    the central one (the totality, the ring, the greatest), some after — each where the sky had it, over
//    the landscape (the totality's own, or the dusk's) or the black.

import { azAltAt, lunarEclipses, moonInUmbra, solarLocal, sunHidden, type Contact } from "../eclipse/earth-moon";
import { solarEclipses } from "../eclipse/earth-moon";
import { apparentAltitude, seaRefractivity } from "../system/refraction";
import { tOf } from "../eclipse/core";
import type { Preset } from "../settings";
import { DISC_DEG, type Exposure } from "./multiexposure";

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

/** The frames, the base last (lighten keeps the brightest whatever the order). */
const baseLast = (f: Exposure[]) => [...f.filter((x) => x.blend !== "base"), ...f.filter((x) => x.blend === "base")];

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
      preset: { ...scene(t), bloom: o.template.bloom ?? 0.1 },
      exposure: "auto",
      blend: "base",
      label: new Date(t).toISOString().slice(0, 16).replace("T", " "),
    });
  }
  for (const s of up)
    frames.push({ preset: scene(s.ms), exposure: o.sunEV, blend: "lighten", label: new Date(s.ms).toISOString().slice(0, 10), ms: s.ms });
  return { frames: baseLast(frames), view, suns };
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

/** A Sun (or a Moon) of the composite: where it falls in the image [px], its disc's radius there [px], its
 *  date [ms UTC], its place in the sky as seen (azimuth from the north eastwards, altitude raised by the
 *  air) [°]; an eclipse's: the share of its disc hidden, the central phase. */
export interface SunMark {
  x: number;
  y: number;
  r: number;
  ms: number;
  az: number;
  alt: number;
  hidden?: number;
  central?: boolean;
}

/** Discs of the sky placed in an image (as seen: raised by the air's refraction), with their dates. */
export function skyMarks<T extends { ms: number; az: number; alt: number }>(points: T[], view: Framing, W: number, H: number) {
  const out: (SunMark & { of: T })[] = [];
  for (const s of points) {
    if (s.alt <= -1) continue;
    const a = apparentAltitude(s.alt * D, 0, seaRefractivity()) / D;
    const p = projectSky(view, s.az, a, W, H);
    const q = projectSky(view, s.az, a + DISC_DEG, W, H);
    if (p) out.push({ x: p[0], y: p[1], r: q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : 0, ms: s.ms, az: s.az, alt: a, of: s });
  }
  return out;
}

/** The analemma's Suns placed in its image (as seen: raised by the air's refraction), with their dates. */
export function analemmaMarks(suns: { ms: number; az: number; alt: number }[], view: Framing, W: number, H: number): SunMark[] {
  return skyMarks(suns, view, W, H).map(({ of: _, ...m }) => m);
}

/** The exposures of a sequence's discs: the Sun's through a filter (its crescent drawn, the sky black) [EV,
 *  fixed]; the Moon's (at night the sky has its own scale under the meter: a fixed exposure whitened it) and
 *  the central phase's (the totality's corona and twilight, the red Moon) the meter's, with a compensation [EV]. */
export const MX_EV = { sun: 9, moon: 0, central: 0 };

export interface EclipseSeqOptions {
  kind: "solar" | "lunar";
  /** a moment near the eclipse (its day) [ms UTC] */
  date: number;
  /** the place [°] */
  lat: number;
  lon: number;
  /** exposures before and after the central one (photographers: 5 and 5) */
  before: number;
  after: number;
  /** under the phases: the central phase's own landscape (the meter's exposure: the totality's twilight, the
   *  night under the red Moon), the place at dusk, or the black */
  base: "central" | "dusk" | "none";
  /** the horizon in the frame (the landscape under the phases), or the phases alone, closer */
  framing: "landscape" | "sky";
  aspect: number;
  template: Preset;
  /** the phases' exposure: the Sun's fixed [EV] (through a filter, its crescent drawn), the Moon's the
   *  meter's with this compensation [EV]; the central one's compensation [EV] on the meter's (the corona and
   *  the twilight, the red Moon) */
  phaseEV: number;
  centralComp: number;
  /** each disc taken close (a telephoto's frame, its own meter) and laid at its place — default; off: the wide view's frames */
  insets?: boolean;
}

/** A moment of an eclipse's sequence: when, the body's place (geometric) [°], its disc's share hidden, the central one. */
export interface SeqMoment {
  ms: number;
  az: number;
  alt: number;
  hidden: number;
  central: boolean;
}

/** What an eclipse is from a place: its type there, its contacts, the central phase's span, its greatest. */
export interface EclipseHere {
  kind: "solar" | "lunar";
  /** total, annular, partial (solar, here) — total, partial, penumbral (lunar) */
  type: string;
  /** the greatest [ms UTC] */
  t: number;
  contacts: Contact[];
  saros: number;
  magnitude: number;
}

/** The eclipse nearest a date seen from a place [°] (null: none within three days, or not seen from there). */
export function eclipseHere(kind: "solar" | "lunar", date: number, lat: number, lon: number): EclipseHere | null {
  if (kind === "solar") {
    const e = solarEclipses(date - 3 * DAY, date + 3 * DAY)[0];
    if (!e) return null;
    const l = solarLocal(lat * D, lon * D, 0, e.t);
    if (l.type === "none") return null;
    return { kind, type: l.type, t: l.max, contacts: l.contacts, saros: e.saros, magnitude: l.magnitude };
  }
  const e = lunarEclipses(date - 3 * DAY, date + 3 * DAY)[0];
  if (!e) return null;
  return { kind, type: e.type, t: e.t, contacts: e.contacts, saros: e.saros, magnitude: e.type === "penumbral" ? e.penumbral : e.umbral };
}

/**
 * An eclipse's moments from a place: `before` evenly between the first contact and the central phase's start
 * (the partial phase's: C1→C2, U1→U2; with no central phase, up to the greatest), the central one (the
 * totality's or the ring's middle; else the greatest), `after` evenly from its end to the last contact — each
 * strictly inside (a first one already bitten, a last one still); those whose body is under the horizon left out.
 */
export function eclipseMoments(e: EclipseHere, lat: number, lon: number, before: number, after: number): SeqMoment[] {
  const at = (n: string) => e.contacts.find((c) => c.name === n)?.t;
  let a: number, b: number, c: number, d: number;
  if (e.kind === "solar") {
    a = at("C1")!;
    d = at("C4")!;
    b = at("C2") ?? e.t;
    c = at("C3") ?? e.t;
  } else {
    const U1 = at("U1"),
      U4 = at("U4");
    a = U1 ?? at("P1")!;
    d = U4 ?? at("P4")!;
    b = at("U2") ?? e.t;
    c = at("U3") ?? e.t;
  }
  const body = e.kind === "solar" ? "sun" : "moon";
  const hidden = (ms: number) => (e.kind === "solar" ? sunHidden(lat * D, lon * D, 0, ms) : moonInUmbra(ms));
  const out: SeqMoment[] = [];
  const add = (ms: number, central: boolean) => {
    const p = azAltAt(body, lat * D, lon * D, 0, ms);
    if (p.alt > -0.5) out.push({ ms, ...p, hidden: hidden(ms), central });
  };
  for (let k = 1; k <= before; k++) add(a + ((b - a) * k) / (before + 1), false);
  add((b + c) / 2, true);
  for (let k = 1; k <= after; k++) add(c + ((d - c) * k) / (after + 1), false);
  return out;
}

/** An eclipse's sequence: its exposures and the view framing them (null: not seen from the place). */
export function eclipsePlan(
  o: EclipseSeqOptions,
): { frames: Exposure[]; view: Framing; moments: SeqMoment[]; eclipse: EclipseHere } | null {
  const e = eclipseHere(o.kind, o.date, o.lat, o.lon);
  if (!e) return null;
  const moments = eclipseMoments(e, o.lat, o.lon, o.before, o.after);
  if (!moments.length) return null;
  const pts = moments.map((m) => ({ az: m.az, alt: m.alt }));
  const az0 = frame(pts, o.aspect).az;
  const view = o.framing === "landscape" ? frame([...pts, { az: az0, alt: -3 }], o.aspect, 4) : frame(pts, o.aspect, 3);
  const body = o.kind === "solar" ? "sun" : "moon";
  const scene = (ms: number): Preset => ({
    ...o.template,
    ship: false,
    target: body,
    fov: view.fov,
    bloom: 0,
    lensFlare: 0,
    time: tOf(ms),
    pose: { at: [o.lat, o.lon], heading: view.az, off: [0, view.alt] },
  });
  const when = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  const frames: Exposure[] = [];
  const central = moments.find((m) => m.central);
  // (the central phase as the base: a solar totality's own frame, the meter's — its twilight, its corona; a
  // partial Sun's at the meter's would blind the frame: the dusk's then. A lunar one's: the night's landscape
  // at that moment five stops under the meter — night —, the red Moon laid over it by its disc)
  const solarTotal = o.kind === "solar" && e.type === "total";
  const centralBase = o.base === "central" && !!central && solarTotal;
  if (centralBase)
    frames.push({
      preset: { ...scene(central.ms), bloom: o.template.bloom ?? 0.1 },
      exposure: "auto",
      comp: o.centralComp,
      blend: "base",
      label: `${when(central.ms)} UTC`,
    });
  else if (o.base === "central" && central && o.kind === "lunar")
    frames.push({
      preset: { ...scene(central.ms), bloom: o.template.bloom ?? 0.1 },
      exposure: "auto",
      comp: o.centralComp - 5,
      blend: "base",
      label: `${when(central.ms)} UTC`,
    });
  else if (o.base !== "none") {
    const t = sunDownAfter(o.lat, o.lon, e.t);
    frames.push({
      preset: { ...scene(t), bloom: o.template.bloom ?? 0.1 },
      exposure: "auto",
      blend: "base",
      label: new Date(t).toISOString().slice(0, 16).replace("T", " "),
    });
  }
  // (each disc taken close — its own field, its own meter — and laid at its place; or, `insets` off, each
  // frame the wide view's, laid by its disc)
  // (aimed where the disc is seen — raised by the air, as the marks place it: aimed at the body itself, a low
  // Moon's refraction carried it out of so close a field)
  const close = (m: SeqMoment, k: number): Pick<Exposure, "preset" | "inset"> => {
    // (its field: k radii and the sky's ring about the disc — 1.6 at least — with a margin)
    const fov = (2 * Math.atan(Math.max(k, 1.6) * Math.tan(DISC_DEG * D) * 1.15)) / D;
    const seen = apparentAltitude(m.alt * D, 0, seaRefractivity()) / D;
    return o.insets === false
      ? { preset: scene(m.ms) }
      : {
          preset: { ...scene(m.ms), fov, pose: { at: [o.lat, o.lon], heading: m.az, off: [0, seen] } },
          inset: { x: 0, y: 0, r: 0, k, fov },
        };
  };
  for (const m of moments) {
    if (m.central && centralBase) continue;
    // (a totality's — the corona, the red Moon —: the meter's; a phase: the Sun's through the filter, the Moon's the meter's)
    const totality = m.central && e.type === "total";
    const label = `${when(m.ms)} UTC`;
    if (totality)
      frames.push({ ...close(m, o.kind === "solar" ? 4 : 1.12), exposure: "auto", comp: o.centralComp, blend: "lighten", label, ms: m.ms });
    else if (o.kind === "lunar") frames.push({ ...close(m, 1.12), exposure: "auto", comp: o.phaseEV, blend: "lighten", label, ms: m.ms });
    else frames.push({ ...close(m, 1.12), exposure: o.phaseEV, blend: "lighten", label, ms: m.ms });
  }
  // (the base last: by then the ground's finer tiles are in — the same hills under every disc)
  return { frames: baseLast(frames), view, moments, eclipse: e };
}

/** The dusk (the Sun at −2°, going down) after a moment at a place [°]; the Sun already down: that moment. */
function sunDownAfter(lat: number, lon: number, t: number): number {
  return azAltAt("sun", lat * D, lon * D, 0, t).alt <= -2 ? t : sunDown(lat, lon, t, -2);
}

/**
 * The lighten frames placed by their disc (found by their moment among the marks): a close frame's inset at
 * the disc's place and size; a wide one masked to it (a filter's frame: the Sun or the Moon alone, the sky
 * left to the base) — `k` disc radii (`kCentral` for the central phase: a totality's corona), never under
 * `min` pixels.
 */
export function placeFrames(frames: Exposure[], marks: SunMark[], k = 1.6, kCentral = 5, min = 6): Exposure[] {
  return frames.map((f) => {
    if (f.blend !== "lighten" || f.ms === undefined) return f;
    const m = marks.find((x) => x.ms === f.ms);
    if (!m) return f;
    if (f.inset) return { ...f, inset: { ...f.inset, x: m.x, y: m.y, r: Math.max(m.r, 1) } };
    return { ...f, mask: { x: m.x, y: m.y, r: Math.max(m.r * (m.central ? kCentral : k), min) } };
  });
}
