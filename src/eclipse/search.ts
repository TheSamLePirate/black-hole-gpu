// The eclipse calculator's one request (PLAN-CIEL C5): what to look for, over which dates — run in the
// planner's worker (plan-worker.ts: "eclipses"), or here. Each event with a stable id, sorted by time.

import { lunarEclipses, lunarLocal, solarEclipses, solarLocal, type LunarEclipse, type SolarEclipse } from "./earth-moon";
import { phenomena, shadowCasters, transits, worldEclipses, type Phenomenon, type Transit, type WorldEclipse } from "./moons";

const DAY = 86400e3;
const YEAR = 365.25 * DAY;

export type EclipseKind = "solar" | "lunar" | "transit" | "phenomena" | "world";

export interface EclipseQuery {
  /** the window [ms UTC] */
  from: number;
  to: number;
  kinds: EclipseKind[];
  /** the planets whose moons' phenomena are wanted (phenomena) */
  planets?: string[];
  /** the world the Sun's eclipses are seen from (world): its planet's and its moons' shadows on it */
  world?: string;
  /** a place on the Earth [°]: each solar and lunar eclipse's look from there (`here`) */
  place?: { lat: number; lon: number } | null;
}

/** An eclipse from the query's place, in brief: solar — its type and magnitude there, the Sun's height at
 *  the greatest; lunar — the Moon's height at the greatest and whether it is up the whole time. */
export interface Here {
  type?: string;
  magnitude?: number;
  sunAlt?: number;
  moonAlt?: number;
  /** seen at all from there (the Sun or the Moon up during it) */
  seen: boolean;
}

export type EclipseEvent = (SolarEclipse | LunarEclipse | Transit | Phenomenon | WorldEclipse) & { id: string; at: number; here?: Here };

/** The longest windows a request covers (the work's bound): decades for the Earth's eclipses, a year of phenomena. */
export const SPAN = { solar: 50 * YEAR, lunar: 50 * YEAR, transit: 150 * YEAR, phenomena: YEAR, world: 2 * YEAR } as const;

const day = (t: number) => new Date(t).toISOString().slice(0, 16);

/** The events of a request, sorted by their time; `clipped`: the kinds whose window was shortened to its bound. */
export function searchEclipses(q: EclipseQuery): { events: EclipseEvent[]; clipped: EclipseKind[] } {
  const events: EclipseEvent[] = [];
  const clipped: EclipseKind[] = [];
  const end = (k: EclipseKind) => {
    if (q.to - q.from <= SPAN[k]) return q.to;
    clipped.push(k);
    return q.from + SPAN[k];
  };
  for (const k of q.kinds) {
    if (k === "solar")
      for (const e of solarEclipses(q.from, end(k))) {
        let here: Here | undefined;
        if (q.place) {
          const l = solarLocal(q.place.lat * (Math.PI / 180), q.place.lon * (Math.PI / 180), 0, e.t);
          here = { type: l.type, magnitude: l.magnitude, sunAlt: l.sunAlt, seen: l.type !== "none" && l.sunAltMax > -0.8 };
        }
        events.push({ ...e, id: `solar:${day(e.t)}`, at: e.t, here });
      }
    if (k === "lunar")
      for (const e of lunarEclipses(q.from, end(k))) {
        let here: Here | undefined;
        if (q.place) {
          const l = lunarLocal(e, q.place.lat * (Math.PI / 180), q.place.lon * (Math.PI / 180), 0);
          const mx = l.find((c) => c.name === "max")!;
          here = { moonAlt: mx.moonAlt, seen: l.some((c) => c.moonAlt > -0.8) };
        }
        events.push({ ...e, id: `lunar:${day(e.t)}`, at: e.t, here });
      }
    if (k === "transit")
      for (const p of ["mercury", "venus"] as const)
        for (const e of transits(p, q.from, end(k))) events.push({ ...e, id: `transit:${p}:${day(e.t)}`, at: e.t });
    if (k === "phenomena")
      for (const p of q.planets ?? ["jupiter"])
        for (const e of phenomena(p, q.from, end(k))) {
          const at = Number.isNaN(e.start) ? e.end : e.start;
          events.push({ ...e, id: `${e.what}:${e.moon}:${day(at)}`, at });
        }
    if (k === "world" && q.world)
      for (const by of shadowCasters(q.world))
        for (const e of worldEclipses(q.world, by, q.from, end(k)))
          events.push({ ...e, id: `world:${q.world}:${by}:${day(e.t)}`, at: e.t });
  }
  events.sort((a, b) => a.at - b.at);
  return { events, clipped };
}

/** What an eclipse looks like from a place: the solar one (its contacts, magnitude, obscuration, the Sun's
 *  height) or the lunar one (its contacts and the Moon's and the Sun's heights at each) nearest a date. */
export function eclipseLocal(kind: "solar" | "lunar", ms: number, lat: number, lon: number, hM = 0) {
  const D = Math.PI / 180;
  if (kind === "solar") {
    const e = solarEclipses(ms - 3 * DAY, ms + 3 * DAY)[0];
    if (!e) return null;
    return { eclipse: e, here: solarLocal(lat * D, lon * D, hM, e.t) };
  }
  const e = lunarEclipses(ms - 3 * DAY, ms + 3 * DAY)[0];
  if (!e) return null;
  return { eclipse: e, here: lunarLocal(e, lat * D, lon * D, hM) };
}
