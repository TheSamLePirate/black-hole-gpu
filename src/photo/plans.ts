// What a multiple exposure renders (PLAN-CIEL C8–C10): the moments, the fixed view framing them, each
// exposure — for the runner (photo/multiexposure.ts).
//  · The analemma: the Sun at the same clock time every few days for a year, from the same place, the same
//    view — its figure-of-eight (the year's declination up and down, the equation of time east and west);
//    the view aimed at its middle and wide enough for it all; each Sun a short dark exposure (the sky black,
//    its disc a dot), laid over a base: the place at dusk (or at that hour), its landscape.
//  · An eclipse's sequence: the Sun's (or the Moon's) phases from a place — some before the central phase,
//    the central one (the totality, the ring, the greatest), some after — each where the sky had it, over
//    the landscape (the totality's own, or the dusk's) or the black.

import { azAltAt, DANJON, lunarEclipses, moonInUmbra, solarEclipses, solarLocal, sunHidden, type Contact } from "../eclipse/earth-moon";
import { earthLatLon, earthPointKm, posKm, radiusKm, seenKm, shadowAt } from "../eclipse/core";
import { transits } from "../eclipse/moons";
import { dot, len, sub, type Vec3 } from "../math/vec3";
import { bodyAxes, solarBody } from "../system/solar";
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
  // (their directions' mean seen from above: a point near the zenith says little of where to turn)
  const sx = points.reduce((s, p) => s + Math.cos(p.alt * D) * Math.sin(p.az * D), 0),
    cx = points.reduce((s, p) => s + Math.cos(p.alt * D) * Math.cos(p.az * D), 0);
  const az = (((Math.atan2(sx, cx) / D) % 360) + 360) % 360;
  const alts = points.map((p) => p.alt);
  const lo = Math.min(...alts),
    hi = Math.max(...alts);
  const alt = (lo + hi) / 2;
  const span = (p: { az: number }) => Math.abs(((((p.az - az) % 360) + 540) % 360) - 180);
  const wide = 2 * Math.max(...points.map((p) => span(p) * Math.cos(p.alt * D)));
  let fov = Math.min(Math.max(hi - lo + 2 * margin, (wide + 2 * margin) / aspect, 10), 120);
  // (then checked through the pinhole itself: a way high in the sky spans more than its azimuths say —
  // the field widened until every point stands inside, its margin kept, to 140°)
  const inside = (f: number) =>
    points.every((p) => {
      const q = projectSky({ az, alt, fov: f }, p.az, p.alt, 1000 * aspect, 1000);
      const m = (margin / f) * 1000 * 0.5;
      return !!q && q[0] >= m && q[0] <= 1000 * aspect - m && q[1] >= m && q[1] <= 1000 - m;
    });
  while (fov < 140 && !inside(fov)) fov = Math.min(fov * 1.04, 140);
  return { az, alt, fov };
}

/** The frames, the base last (lighten keeps the brightest whatever the order). */
export const baseLast = (f: Exposure[]) => [...f.filter((x) => x.blend !== "base"), ...f.filter((x) => x.blend === "base")];

/** When the Sun stands at an altitude [°], going down, after a moment [ms] (within a day), at a place [°]. */
export function sunDown(lat: number, lon: number, after: number, alt: number): number {
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
  const close = (m: SeqMoment, k: number): Pick<Exposure, "preset" | "inset"> =>
    o.insets === false ? { preset: scene(m.ms) } : closeFrame(scene(m.ms), m, o.lat, o.lon, k);
  for (const m of moments) {
    if (m.central && centralBase) continue;
    // (a totality's — the corona, the red Moon —: the meter's; a phase: the Sun's through the filter, the Moon's the meter's)
    const totality = m.central && e.type === "total";
    const label = `${when(m.ms)} UTC`;
    if (totality)
      frames.push({
        ...close(m, o.kind === "solar" ? 4 : 1.12),
        exposure: "auto",
        comp: o.centralComp,
        blend: "lighten",
        label,
        ms: m.ms,
        check: o.kind !== "solar",
      });
    else if (o.kind === "lunar") frames.push({ ...close(m, 1.12), exposure: "auto", comp: o.phaseEV, blend: "lighten", label, ms: m.ms });
    else frames.push({ ...close(m, 1.12), exposure: o.phaseEV, blend: "lighten", label, ms: m.ms });
  }
  // (the base last: by then the ground's finer tiles are in — the same hills under every disc)
  return { frames: baseLast(frames), view, moments, eclipse: e };
}

/**
 * A disc's close frame (a telephoto's): its field `k` radii and the sky's ring about it (1.6 at least) with a
 * margin, aimed where the disc is seen — raised by the air, as the marks place it (aimed at the body itself,
 * a low Moon's refraction carried it out of so close a field); the inset to lay it at its place.
 */
export function closeFrame(
  scene: Preset,
  m: { az: number; alt: number },
  lat: number,
  lon: number,
  k: number,
): Pick<Exposure, "preset" | "inset"> {
  const fov = (2 * Math.atan(Math.max(k, 1.6) * Math.tan(DISC_DEG * D) * 1.15)) / D;
  const seen = apparentAltitude(m.alt * D, 0, seaRefractivity()) / D;
  return { preset: { ...scene, fov, pose: { at: [lat, lon], heading: m.az, off: [0, seen] } }, inset: { x: 0, y: 0, r: 0, k, fov } };
}

/** The dusk (the Sun at −2°, going down) after a moment at a place [°]; the Sun already down: that moment. */
export function sunDownAfter(lat: number, lon: number, t: number): number {
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
    if (f.inset) return { ...f, inset: { ...f.inset, x: m.x, y: m.y, r: Math.max(m.r, 1), check: f.check ?? f.inset.check } };
    return { ...f, mask: { x: m.x, y: m.y, r: Math.max(m.r * (m.central ? kCentral : k), min) } };
  });
}

/**
 * The parallactic angle of a direction (azimuth, altitude [°]) at a latitude [°]: the celestial north's
 * direction in a level camera's image of it, from its up towards its right [rad] — the turn that sets the
 * north up.
 */
export function parallactic(lat: number, az: number, alt: number): number {
  const d: [number, number, number] = [Math.cos(alt * D) * Math.sin(az * D), Math.cos(alt * D) * Math.cos(az * D), Math.sin(alt * D)];
  const along = (v: number[]) => {
    const k = v[0]! * d[0] + v[1]! * d[1] + v[2]! * d[2];
    const w = [v[0]! - k * d[0], v[1]! - k * d[1], v[2]! - k * d[2]];
    const l = Math.hypot(w[0]!, w[1]!, w[2]!) || 1;
    return [w[0]! / l, w[1]! / l, w[2]! / l];
  };
  const up = along([0, 0, 1]);
  const north = along([0, Math.cos(lat * D), Math.sin(lat * D)]);
  // (the image's right: forward × up)
  const right = [d[1] * up[2]! - d[2] * up[1]!, d[2] * up[0]! - d[0] * up[2]!, d[0] * up[1]! - d[1] * up[0]!];
  return Math.atan2(
    north[0]! * right[0]! + north[1]! * right[1]! + north[2]! * right[2]!,
    north[0]! * up[0]! + north[1]! * up[1]! + north[2]! * up[2]!,
  );
}

/** A place 25° north of the point under a body at a UTC time [°]: the body 65° up due south — its frame
 *  with the north up (on the meridian: no turn to make), the air thin before it (a tripod tilts no higher). */
function underBody(id: "sun" | "moon", ms: number) {
  const p = earthLatLon(posKm(id, ms), ms);
  return { lat: Math.min(p.lat / D + 25, 89), lon: p.lon / D };
}

export interface LayoutOptions extends Omit<EclipseSeqOptions, "kind" | "framing" | "base" | "insets"> {
  kind: "solar" | "lunar" | "transit";
  /** the phases in a row (north up, black), the Moons placed about the Earth's shadow (a lunar one's), the
   *  planet's way across the Sun (a transit's) */
  layout: "strip" | "shadow" | "transit";
  width: number;
  height: number;
  /** a transit's planet (its event found near the date) */
  planet?: "mercury" | "venus";
}

/** A layout's drawn guides (the shadow's circles), in the image's pixels. */
export interface LayoutGuide {
  x: number;
  y: number;
  r: number;
  label: string;
}

/** A layout's frames (each a close one, turned north up, laid at its place), its discs' marks, its guides. */
export function eclipseLayout(o: LayoutOptions): {
  frames: Exposure[];
  marks: SunMark[];
  guides: LayoutGuide[];
  eclipse: { kind: "solar" | "lunar" | "transit"; type: string; t: number; saros: number; magnitude: number };
} | null {
  const W = o.width,
    H = o.height;
  const scene = (ms: number, target: "sun" | "moon"): Preset => ({
    ...o.template,
    ship: false,
    target,
    bloom: 0,
    lensFlare: 0,
    time: tOf(ms),
  });
  const close = (ms: number, body: "sun" | "moon", at: { lat: number; lon: number }, k: number) => {
    const p = azAltAt(body, at.lat * D, at.lon * D, 0, ms);
    const f = closeFrame(scene(ms, body), p, at.lat, at.lon, k);
    return { ...f, inset: { ...f.inset!, rot: parallactic(at.lat, p.az, apparentAltitude(p.alt * D, 0, seaRefractivity()) / D) } };
  };
  const label = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
  if (o.layout === "transit" || o.kind === "transit") {
    const planet = o.planet ?? "venus";
    const t = transits(planet, o.date - 400 * DAY, o.date + 400 * DAY);
    const e = t.reduce<(typeof t)[number] | null>((a, b) => (!a || Math.abs(b.t - o.date) < Math.abs(a.t - o.date) ? b : a), null);
    if (!e) return null;
    const n = Math.max(3, o.before + o.after + 1);
    const r = Math.min(W, H) * 0.4;
    const frames: Exposure[] = [];
    const marks: SunMark[] = [];
    // (the Sun's centre where it is drawn; the planet's offset from it, north up, east left)
    const pxPerRad = r / (DISC_DEG * D);
    // (the Sun once — the middle frame's —, then each frame's planet alone darkened in where it is: the Sun's
    // own spots, turning with it over hours, not dragged into streaks)
    const mid = Math.floor(n / 2);
    const order = [mid, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== mid)];
    for (const i of order) {
      const ms = e.start + ((e.end - e.start) * (i + 0.5)) / n;
      const at = underBody("sun", ms);
      const f = close(ms, "sun", at, 1.06);
      const obs = earthPointKm(at.lat * D, at.lon * D, 0, ms);
      const s = sub(seenKm("sun", ms, obs), obs),
        pl = sub(seenKm(planet, ms, obs), obs);
      const { north, east } = skyAxes(s, ms);
      const sl = len(s),
        pll = len(pl);
      const dx = (dot(pl, east) / pll - dot(s, east) / sl) * pxPerRad,
        dy = (dot(pl, north) / pll - dot(s, north) / sl) * pxPerRad;
      const x = W / 2 - dx,
        y = H / 2 - dy;
      const pr = (radiusKm(planet) / pll) * pxPerRad;
      // (five stops under the filter's: the limb's darkening shows, the planet's dot black on it — Mercury's
      // a few pixels: the frame as large as the image's disc)
      frames.push({
        ...f,
        inset: {
          ...f.inset!,
          x: W / 2,
          y: H / 2,
          r,
          mode: i === mid ? "set" : "darken",
          maxN: 1800,
          area: i === mid ? undefined : { x, y, r: Math.max(6, pr * 2.5), search: Math.max(24, r * 0.08) },
        },
        exposure: o.phaseEV - 5,
        blend: "lighten",
        label: label(ms),
        ms,
      });
      marks.push({ x, y, r: Math.max(pr, 2), ms, az: 0, alt: 0 });
    }
    marks.sort((a, b) => a.ms - b.ms);
    return { frames, marks, guides: [], eclipse: { kind: "transit", type: planet, t: e.t, saros: 0, magnitude: 0 } };
  }
  const e = eclipseHere(o.kind, o.date, o.lat, o.lon);
  if (o.layout === "shadow" && o.kind === "lunar") {
    const le = lunarEclipses(o.date - 3 * DAY, o.date + 3 * DAY)[0];
    if (!le) return null;
    const at = (nm: string) => le.contacts.find((c) => c.name === nm)?.t;
    const P1 = at("P1")!,
      P4 = at("P4")!;
    const a = at("U1") !== undefined ? (P1 + at("U1")!) / 2 : P1,
      b = at("U4") !== undefined ? (P4 + at("U4")!) / 2 : P4;
    const n = Math.max(3, o.before + o.after + 1);
    const sh = (ms: number) => shadowAt("earth", "moon", ms, DANJON, 0.99834);
    const mid = sh(le.t);
    const dist = len(sub(mid.rec, posKm("earth", le.t)));
    // (the scale: the penumbra and the Moons' way within the frame)
    const reach = Math.max(mid.pen, ...[a, b].map((t) => len(sh(t).off) + sh(t).R)) / dist;
    const pxPerRad = (Math.min(W, H) * 0.46) / reach;
    const frames: Exposure[] = [];
    const marks: SunMark[] = [];
    for (let i = 0; i < n; i++) {
      const ms = a + ((b - a) * i) / (n - 1);
      const s = sh(ms);
      const { north, east } = skyAxes(s.axis, ms);
      const x = W / 2 - (dot(s.off, east) / dist) * pxPerRad,
        y = H / 2 - (dot(s.off, north) / dist) * pxPerRad;
      const f = close(ms, "moon", underBody("moon", ms), 1.12);
      const r = DISC_DEG * D * pxPerRad;
      frames.push({ ...f, inset: { ...f.inset!, x, y, r }, exposure: "auto", comp: o.phaseEV, blend: "lighten", label: label(ms), ms });
      marks.push({ x, y, r, ms, az: 0, alt: 0, hidden: moonInUmbra(ms) });
    }
    const umbra = (mid.umbra / dist) * pxPerRad,
      pen = (mid.pen / dist) * pxPerRad;
    return {
      frames,
      marks,
      guides: [
        { x: W / 2, y: H / 2, r: umbra, label: "umbra" },
        { x: W / 2, y: H / 2, r: pen, label: "penumbra" },
      ],
      eclipse: { kind: "lunar", type: le.type, t: le.t, saros: le.saros, magnitude: le.umbral },
    };
  }
  // (the strip: the phases seen from the place, in a row)
  if (!e) return null;
  const moments = eclipseMoments(e, o.lat, o.lon, o.before, o.after);
  if (!moments.length) return null;
  const n = moments.length;
  const r = Math.min(H * 0.16, W / (n * 2.5));
  const body = o.kind === "solar" ? "sun" : "moon";
  const frames: Exposure[] = [];
  const marks: SunMark[] = [];
  for (const [i, m] of moments.entries()) {
    const x = (W * (i + 0.5)) / n,
      y = H / 2;
    const totality = m.central && e.type === "total";
    const f = close(m.ms, body, { lat: o.lat, lon: o.lon }, totality && o.kind === "solar" ? 2.6 : 1.12);
    frames.push({
      ...f,
      inset: { ...f.inset!, x, y, r, check: !(totality && o.kind === "solar"), row: y },
      exposure: totality || o.kind === "lunar" ? "auto" : o.phaseEV,
      comp: totality ? o.centralComp : o.kind === "lunar" ? o.phaseEV : undefined,
      blend: "lighten",
      label: label(m.ms),
      ms: m.ms,
    });
    marks.push({ x, y, r, ms: m.ms, az: m.az, alt: m.alt, hidden: m.hidden, central: m.central });
  }
  return { frames, marks, guides: [], eclipse: e };
}

/** The sky's north and east [unit, home frame] about a direction seen from the Earth (east: north × the direction). */
function skyAxes(dir: Vec3, ms: number): { north: Vec3; east: Vec3 } {
  const l = len(dir);
  const v: Vec3 = [dir[0] / l, dir[1] / l, dir[2] / l];
  const P = bodyAxes(solarBody("earth")!, tOf(ms))[2];
  const k = dot(P, v);
  const n0: Vec3 = [P[0] - k * v[0], P[1] - k * v[1], P[2] - k * v[2]];
  const nl = len(n0);
  const north: Vec3 = [n0[0] / nl, n0[1] / nl, n0[2] / nl];
  const east: Vec3 = [north[1] * v[2] - north[2] * v[1], north[2] * v[0] - north[0] * v[2], north[0] * v[1] - north[1] * v[0]];
  return { north, east };
}
