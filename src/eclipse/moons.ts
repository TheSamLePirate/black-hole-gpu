// The satellites' phenomena and the eclipses seen from the other worlds (PLAN-CIEL C5).
//  · Seen from the Earth (the moments as its light brings them): a moon eclipsed by its planet's shadow
//    (ecl), hidden behind its disc (occ), passing before it (tra), its shadow on the planet (sha) — Jupiter's
//    Galilean moons, Saturn's, Neptune's Triton, Mars's two;
//  · the transits of Mercury and Venus across the Sun;
//  · from any world: the Sun hidden by another body there (its moons', its planet's shadow on it).
// Each searched by the distance (km) to the event's edge: stepped no faster than the bodies' relative
// motion could close it, refined by bisection.

import { len, sub } from "../math/vec3";
import { solarBody, SOLAR_BODIES } from "../system/solar";
import { discsAt, intervals, minimum, posKm, radiusKm, shadowAt } from "./core";

const DAY = 86400e3;

export type PhenomenonKind = "ecl" | "occ" | "tra" | "sha";

export interface Phenomenon {
  kind: "phenomenon";
  /** ecl: in the planet's shadow; occ: behind its disc; tra: before it; sha: its shadow on it */
  what: PhenomenonKind;
  planet: string;
  moon: string;
  /** its start and end as seen from the Earth [ms UTC] (start: before the window, NaN; end: after it, NaN) */
  start: number;
  end: number;
}

export interface WorldEclipse {
  kind: "world";
  /** the world it is seen from (the shadow's receiver), the body hiding the Sun */
  world: string;
  by: string;
  /** total (the umbra on it), annular (the antumbra), partial (the penumbra only) */
  type: "total" | "annular" | "partial";
  /** its start, greatest and end [ms UTC, the moments there] */
  start: number;
  t: number;
  end: number;
  /** how deep: the shadow's axis from the world's centre at the greatest [its radii] */
  gamma: number;
}

export interface Transit {
  kind: "transit";
  planet: string;
  /** contacts as seen from the Earth's centre: I (exterior ingress), II, III, IV; the greatest */
  start: number;
  t: number;
  end: number;
  /** the least separation of the centres [″] */
  sep: number;
}

/** A body's moons (the ones the game has). */
export const moonsOf = (planet: string) => SOLAR_BODIES.filter((b) => b.parent === planet).map((b) => b.id);

/** The planets whose moons' phenomena are reckoned. */
export const PHENOMENA_PLANETS = ["jupiter", "saturn", "neptune", "mars", "uranus", "pluto"] as const;

/** A moon's speed about its planet [km/ms], with a margin for the planet's and the Earth's own motions
 *  across the line of sight: how fast an event's edge may close (the search's step bound). */
function closing(moon: string): number {
  const c = solarBody(moon)?.circle;
  return c ? ((2 * Math.PI * c.a) / (Math.abs(c.period) * DAY)) * 1.5 + 4e-5 : 0.05;
}

/** The Earth's place [km] at a UTC time (the observer of the phenomena). */
const earthAt = (ms: number) => posKm("earth", ms);

/** The light's delay from a body to the Earth [ms] at a UTC time. */
const lightMs = (id: string, ms: number) => (len(sub(posKm(id, ms), earthAt(ms))) / 299792.458) * 1000;

/** How far [km] from a moon's event's edge at a UTC time (negative: within it), as seen from the Earth. */
function edge(what: PhenomenonKind, planet: string, moon: string, ms: number): number {
  const Rp = radiusKm(planet);
  switch (what) {
    case "ecl": {
      // (the moon at the moment its light now reaching the Earth left it: in the planet's umbra)
      const te = ms - lightMs(moon, ms);
      const s = shadowAt(planet, moon, te);
      return s.z > 0 ? s.d - s.umbra : Math.max(s.d, -s.z);
    }
    case "sha": {
      const te = ms - lightMs(planet, ms);
      const s = shadowAt(moon, planet, te);
      return s.z > 0 ? s.d - Rp : Math.max(s.d, -s.z);
    }
    case "occ":
    case "tra": {
      const e = earthAt(ms);
      const d = discsAt(e, what === "occ" ? planet : moon, what === "occ" ? moon : planet, ms);
      const dist = len(sub(posKm(planet, ms), e));
      // (occ: the planet in front, the moon's centre within its disc; tra: the moon in front)
      if (!d.front) return Math.max(d.sep * dist, 1000);
      return d.sep * dist - Rp;
    }
  }
}

/** The moons' phenomena of a planet seen from the Earth in [a, b] (UTC ms). */
export function phenomena(
  planet: string,
  a: number,
  b: number,
  moons = moonsOf(planet),
  kinds: PhenomenonKind[] = ["ecl", "occ", "tra", "sha"],
): Phenomenon[] {
  const out: Phenomenon[] = [];
  for (const moon of moons) {
    const v = closing(moon);
    for (const what of kinds) {
      for (const [s, e] of intervals(
        (t) => edge(what, planet, moon, t),
        a,
        b,
        (_t, d) => Math.min(Math.abs(d) / v, DAY),
        1000,
      ))
        out.push({ kind: "phenomenon", what, planet, moon, start: s === a ? Number.NaN : s, end: e === b ? Number.NaN : e });
    }
  }
  return out.sort((x, y) => (Number.isNaN(x.start) ? x.end : x.start) - (Number.isNaN(y.start) ? y.end : y.start));
}

/**
 * The Sun hidden from a world by `by` (its planet's shadow on a moon, a moon's on its planet…) in [a, b]:
 * the shadow's penumbra on the world; total where its umbra falls on it, annular its antumbra.
 */
export function worldEclipses(world: string, by: string, a: number, b: number): WorldEclipse[] {
  const out: WorldEclipse[] = [];
  const R = radiusKm(world);
  const v = closing(solarBody(by)!.parent === world ? by : world);
  const g = (t: number) => {
    const s = shadowAt(by, world, t);
    return s.z > 0 ? s.d - (s.pen + R) : Math.max(s.d, -s.z);
  };
  for (const [s, e] of intervals(g, a, b, (_t, d) => Math.min(Math.abs(d) / v, DAY), 1000)) {
    const best = minimum((t) => shadowAt(by, world, t).d, s, e, 500);
    const sh = shadowAt(by, world, best.t);
    const central = sh.d < R + Math.abs(sh.umbra);
    out.push({
      kind: "world",
      world,
      by,
      type: central ? (sh.umbra > 0 ? "total" : "annular") : "partial",
      start: s,
      t: best.t,
      end: e,
      gamma: sh.d / R,
    });
  }
  return out;
}

/** The bodies whose shadows may fall on a world: its planet (a moon's), its moons (a planet's). */
export function shadowCasters(world: string): string[] {
  const b = solarBody(world);
  if (!b) return [];
  const out = moonsOf(world);
  if (b.parent && b.parent !== "sun") out.unshift(b.parent);
  return out;
}

/** The transits of Mercury or Venus across the Sun, seen from the Earth's centre, in [a, b]. */
export function transits(planet: "mercury" | "venus", a: number, b: number): Transit[] {
  const out: Transit[] = [];
  const g = (t: number) => {
    const e = earthAt(t);
    const d = discsAt(e, planet, "sun", t);
    if (!d.front) return 1;
    return d.sep - (d.rFar + d.rNear);
  };
  // (the planet against the Sun closes at most ~4° a day: the step from the angular distance)
  for (const [s, e] of intervals(g, a, b, (_t, d) => Math.min((Math.abs(d) / (4 * (Math.PI / 180))) * DAY, 10 * DAY), 1000)) {
    const best = minimum((t) => discsAt(earthAt(t), planet, "sun", t).sep, s, e, 500);
    out.push({ kind: "transit", planet, start: s, t: best.t, end: e, sep: (best.v * 180 * 3600) / Math.PI });
  }
  return out;
}
