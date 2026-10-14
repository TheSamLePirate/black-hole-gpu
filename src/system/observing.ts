// What can be seen from a place on the Earth, and when: any of our bodies (the Sun, the Moon, the planets and
// their moons — light time and the Earth's WGS84 figure as azAltAt has them), a named star, the ISS, our mouth of
// the wormhole (Gargantua's system behind it). Above the horizon high enough, in a sky dark enough for it — the
// Sun in daylight, the Moon in any sky, Mercury and Venus in the twilight, the others at night —; its windows over
// days, each with its best moment (the highest), for the telescope to be taken there. Pure.

import { azAltAt, azAltOfKm } from "../eclipse/earth-moon";
import { earthPointKm } from "../eclipse/core";
import { issPasses, issSight } from "../photo/iss-pass";
import type { Vec3 } from "../physics";

const D = Math.PI / 180;
const MIN = 60e3;

/** What is looked for: a body of ours (its id), a named star (its direction, home frame), the ISS, the wormhole's mouth. */
export type Observable = { kind: "body"; id: string } | { kind: "star"; name: string; v: Vec3 } | { kind: "iss" } | { kind: "wormhole" };

export interface SkySpot {
  /** azimuth (from the north, eastwards) and geometric altitude [°] */
  az: number;
  alt: number;
}

/** The sky's light: the Sun up, in the twilight (to −12°), or night. */
export type SkyLight = "day" | "twilight" | "night";

export interface SeenWindow {
  /** when it is seen [ms UTC]: from, to; its best moment (the highest), its place then */
  from: number;
  to: number;
  best: number;
  alt: number;
  az: number;
  /** the sky at its best moment */
  sky: SkyLight;
}

/** When a thing is seen: how high at least [°], how dark the sky must be (the Sun under this [°]; none: any sky). */
export interface SeeingRule {
  minAlt: number;
  sunUnder: number | null;
}

/** The rule a thing is seen by: the Sun by day (a filter), the Moon in any sky, Mercury and Venus in the twilight
 *  (never far from the Sun), the rest in a dark sky, high enough out of the haze. */
export function seeingRule(o: Observable): SeeingRule {
  if (o.kind === "body" && o.id === "sun") return { minAlt: 5, sunUnder: null };
  if (o.kind === "body" && o.id === "moon") return { minAlt: 5, sunUnder: null };
  if (o.kind === "body" && (o.id === "mercury" || o.id === "venus")) return { minAlt: 5, sunUnder: -6 };
  if (o.kind === "iss") return { minAlt: 10, sunUnder: -4 };
  return { minAlt: 10, sunUnder: -12 };
}

/** Where it stands in the sky of a place [°] at a time [ms UTC]; null: not there to be seen (the ISS's orbit unknown). */
export function spotOf(o: Observable, lat: number, lon: number, ms: number): SkySpot | null {
  const la = lat * D,
    lo = lon * D;
  switch (o.kind) {
    case "body":
      return azAltAt(o.id, la, lo, 0, ms);
    case "star": {
      // (a fixed direction: a point far along it from the place)
      const p = earthPointKm(la, lo, 0, ms);
      return azAltOfKm([p[0] + o.v[0] * 1e15, p[1] + o.v[1] * 1e15, p[2] + o.v[2] * 1e15], la, lo, 0, ms);
    }
    case "iss": {
      const s = issSight(lat, lon, ms);
      return s ? { az: s.az, alt: s.alt } : null;
    }
    case "wormhole":
      // (our mouth: the home frame's origin)
      return azAltOfKm([0, 0, 0], la, lo, 0, ms);
  }
}

/** The sky's light at a place and time. */
export function skyLight(lat: number, lon: number, ms: number): SkyLight {
  const s = azAltAt("sun", lat * D, lon * D, 0, ms).alt;
  return s > -0.833 ? "day" : s > -12 ? "twilight" : "night";
}

/** Whether it is seen at that moment by its rule. */
export function seenAt(o: Observable, lat: number, lon: number, ms: number, rule = seeingRule(o)): boolean {
  const p = spotOf(o, lat, lon, ms);
  if (!p || p.alt < rule.minAlt) return false;
  return rule.sunUnder === null || azAltAt("sun", lat * D, lon * D, 0, ms).alt < rule.sunUnder;
}

/**
 * Its windows over `days` from a date: when it is seen (by its rule), each refined to the half-minute at its ends,
 * its best moment the highest within it (to the minute). The ISS: its visible passes. Scanned every `stepMin`.
 */
export function seenWindows(
  o: Observable,
  lat: number,
  lon: number,
  from: number,
  days: number,
  opt: { stepMin?: number; rule?: SeeingRule } = {},
): SeenWindow[] {
  if (o.kind === "iss")
    return issPasses(lat, lon, from, days).map((p) => {
      const s = spotOf(o, lat, lon, p.top);
      return { from: p.seenFrom, to: p.seenTo, best: p.top, alt: p.maxAlt, az: s?.az ?? 0, sky: skyLight(lat, lon, p.top) };
    });
  const rule = opt.rule ?? seeingRule(o);
  const step = (opt.stepMin ?? 10) * MIN;
  const end = from + days * 86400e3;
  const seen = (ms: number) => seenAt(o, lat, lon, ms, rule);
  // (an end between a moment seen and one not: bisected to the half-minute)
  const edge = (a: number, b: number) => {
    const sa = seen(a);
    while (b - a > 30e3) {
      const m = (a + b) / 2;
      if (seen(m) === sa) a = m;
      else b = m;
    }
    return sa ? a : b;
  };
  const out: SeenWindow[] = [];
  let prev = seen(from);
  let start = prev ? from : NaN;
  for (let t = from + step; t <= end + step; t += step) {
    const tt = Math.min(t, end);
    const now = seen(tt);
    if (now && !prev) start = edge(tt - step, tt);
    if (!now && prev) out.push(windowOf(o, lat, lon, start, edge(tt - step, tt)));
    prev = now;
    if (tt === end) break;
  }
  if (prev && Number.isFinite(start)) out.push(windowOf(o, lat, lon, start, end));
  return out;
}

/** A window's best moment: the highest within it (a golden search on its altitude, to the minute). */
function windowOf(o: Observable, lat: number, lon: number, from: number, to: number): SeenWindow {
  const alt = (ms: number) => spotOf(o, lat, lon, ms)?.alt ?? -90;
  // (sampled first: a window may hold no single bump — rising all along, setting all along)
  let best = from,
    hi = alt(from);
  const n = Math.max(2, Math.min(48, Math.ceil((to - from) / (15 * MIN))));
  for (let i = 1; i <= n; i++) {
    const t = from + ((to - from) * i) / n;
    const a = alt(t);
    if (a > hi) (hi = a), (best = t);
  }
  let a = Math.max(from, best - (to - from) / n),
    b = Math.min(to, best + (to - from) / n);
  const g = (Math.sqrt(5) - 1) / 2;
  while (b - a > MIN) {
    const c = b - g * (b - a),
      d = a + g * (b - a);
    if (alt(c) > alt(d)) b = d;
    else a = c;
  }
  best = (a + b) / 2;
  const s = spotOf(o, lat, lon, best)!;
  return { from, to, best, alt: s.alt, az: s.az, sky: skyLight(lat, lon, best) };
}

/** The next time it is seen from a date: the window holding that date, else the first after it (null: none within `days`). */
export function nextSeen(o: Observable, lat: number, lon: number, from: number, days = 30): SeenWindow | null {
  // (by chunks of a week: the near ones found without scanning the month)
  for (let d = 0; d < days; d += 7) {
    const w = seenWindows(o, lat, lon, from + d * 86400e3, Math.min(7, days - d));
    if (w.length) return w[0]!;
  }
  return null;
}
