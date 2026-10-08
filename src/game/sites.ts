import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { type WeatherPreset, type WeatherState, weatherAt, windFromAt } from "../weather";
import type { WindLevel } from "../wind";

// Places to come down on: each world's runways, landing sites and the film's — latitude and east
// longitude [°] (our bodies: on their own turning axes; Gargantua's worlds: on their frames' axes, x away
// from Gargantua, z their pole). The entry autopilot flies to one (the nearest, unless chosen).

export interface Site {
  body: string;
  name: string;
  lat: number;
  lon: number;
  /** a runway (the Ranger glides onto it) or a pad */
  runway?: boolean;
  /** the runway's landing heading [° from north] (its threshold at the place) */
  rwy?: number;
  /** landed the other way (PLAN-METEO W4: into the wind): this is the far end — its threshold, its heading */
  reverse?: boolean;
  /** the airfield's weather station (its METAR: W7) — its own, or the nearest that reports */
  icao?: string;
}

export const SITES: Site[] = [
  {
    body: "earth",
    name: "Kennedy Space Center, Shuttle Landing Facility",
    lat: 28.615,
    lon: -80.695,
    runway: true,
    rwy: 150,
    icao: "KTTS",
  },
  { body: "earth", name: "Edwards Air Force Base", lat: 34.905, lon: -117.884, runway: true, rwy: 220, icao: "KEDW" },
  { body: "earth", name: "Kourou, Guiana Space Centre", lat: 5.24, lon: -52.77, runway: true, rwy: 70, icao: "SOCA" },
  { body: "earth", name: "Baikonur, Yubileyniy", lat: 46.0, lon: 63.3, runway: true, rwy: 60, icao: "UAOO" },
  { body: "earth", name: "Paris – Le Bourget", lat: 48.96, lon: 2.44, runway: true, rwy: 270, icao: "LFPB" },
  { body: "earth", name: "Tanegashima", lat: 30.4, lon: 130.97, runway: true, rwy: 340, icao: "RJFG" },
  { body: "earth", name: "Woomera", lat: -31.16, lon: 136.8, runway: true, rwy: 0, icao: "YPWR" },
  { body: "mars", name: "Jezero crater", lat: 18.44, lon: 77.45 },
  { body: "mars", name: "Gale crater", lat: -5.4, lon: 137.8 },
  { body: "mars", name: "Utopia Planitia", lat: 47.6, lon: 118.0 },
  { body: "moon", name: "Tranquility Base", lat: 0.674, lon: 23.473 },
  { body: "moon", name: "Shackleton crater's rim", lat: -89.5, lon: 0 },
  { body: "titan", name: "Huygens' landing site", lat: -10.25, lon: 192.32 },
  { body: "miller", name: "Miller's shallows (the Ranger's landing)", lat: 0, lon: 20 },
  { body: "mann", name: "Mann's camp", lat: 12, lon: -35 },
  { body: "edmunds", name: "Edmunds' plain (Brand's camp)", lat: 6, lon: 55, runway: true, rwy: 90 },
];

export const sitesOf = (body: string) => SITES.filter((s) => s.body === body);

/** A site's unit direction on its body's own axes. */
export function siteDir(s: { lat: number; lon: number }): [number, number, number] {
  const D = Math.PI / 180;
  return [Math.cos(s.lat * D) * Math.cos(s.lon * D), Math.cos(s.lat * D) * Math.sin(s.lon * D), Math.sin(s.lat * D)];
}

/**
 * How much of a runway a point of the Earth is on (0…1; geodetic unit direction on the Earth's own axes):
 * from 3 km before each runway's threshold (its approach's clear zone: no procedural hill under the final) to 4.5 km past it, 60 m either side of its axis — faded to none
 * 60 m further across and 300 m further along. There the ground is graded: the relief's base, without
 * the drawn detail (the gear rolls on a runway, not on the procedural bumps between the map's texels).
 */
export interface RunwayFrame {
  site: Site;
  /** its threshold's geodetic unit direction, the landing direction and its right (unit tangents) */
  p: [number, number, number];
  along: [number, number, number];
  across: [number, number, number];
  /** threshold on the WGS84 surface, body-fixed metres */
  origin: [number, number, number];
}
/** A runway as drawn [m] (trace.wgsl: runwayShade): the graded strip's paved middle, 4.5 km from its threshold. */
export const RUNWAY_LENGTH = 4500;
export const RUNWAY_HALF_WIDTH = 30;
export const EARTH_RUNWAYS: RunwayFrame[] = SITES.filter((s) => s.body === "earth" && s.runway).map((s) => {
  const D = Math.PI / 180;
  const la = s.lat * D,
    lo = s.lon * D;
  const p: [number, number, number] = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const north: [number, number, number] = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const east: [number, number, number] = [-Math.sin(lo), Math.cos(lo), 0];
  const h = (s.rwy ?? 0) * D;
  const along = north.map((n, i) => n * Math.cos(h) + east[i]! * Math.sin(h)) as [number, number, number];
  const across = north.map((n, i) => -n * Math.sin(h) + east[i]! * Math.cos(h)) as [number, number, number];
  return { site: s, p, along, across, origin: geodeticToCart(WGS84_A, WGS84_F, la, lo, 0) };
});
// (the shader's runwayGrade holds the same figures: change both)
export function runwayWeight(q: [number, number, number]): number {
  const point = geodeticToCart(WGS84_A, WGS84_F, Math.atan2(q[2], Math.hypot(q[0], q[1])), Math.atan2(q[1], q[0]), 0);
  let w = 0;
  for (const r of EARTH_RUNWAYS) {
    const d = point.map((v, i) => v - r.origin[i]!) as [number, number, number];
    if (Math.hypot(...d) > 8000) continue;
    const a = d[0] * r.along[0] + d[1] * r.along[1] + d[2] * r.along[2];
    const c = Math.abs(d[0] * r.across[0] + d[1] * r.across[1] + d[2] * r.across[2]);
    // (the clear zone 3 km before either threshold: a runway lands both ways — W4)
    const wa = a < -3000 ? Math.max(0, 1 + (a + 3000) / 300) : a > 7500 ? Math.max(0, 1 - (a - 7500) / 300) : 1;
    const wc = c < 60 ? 1 : Math.max(0, 1 - (c - 60) / 60);
    w = Math.max(w, wa * wc);
  }
  return w;
}

/**
 * A runway's other end (PLAN-METEO W4): its far threshold — the strip drawn RUNWAY_LENGTH along its heading
 * from the site's (sites' frames: the Earth's ellipsoid; another world's sphere) —, landed the other way:
 * the heading there back down the strip. The same name: the same runway.
 */
export function reciprocal(s: Site): Site {
  if (s.rwy === undefined) return s;
  const D = Math.PI / 180;
  const earth = s.body === "earth";
  const la = s.lat * D,
    lo = s.lon * D;
  const north: [number, number, number] = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const east: [number, number, number] = [-Math.sin(lo), Math.cos(lo), 0];
  const h = s.rwy * D;
  const along = north.map((n, i) => n * Math.cos(h) + east[i]! * Math.sin(h)) as [number, number, number];
  // (another world: a unit sphere, the strip's length in its radii — its own radius unknown here: the far
  // end at the same angle as on the Earth's, the heading's turn over 4.5 km negligible there too)
  const R = earth ? 1 : WGS84_A;
  const A = earth ? geodeticToCart(WGS84_A, WGS84_F, la, lo, 0) : geodeticToCart(R, 0, la, lo, 0);
  const B = A.map((v, i) => v + along[i]! * RUNWAY_LENGTH) as [number, number, number];
  const g = earth ? cartToGeodetic(WGS84_A, WGS84_F, B) : cartToGeodetic(R, 0, B);
  // (the heading back: the strip's direction at the far end, on its own north and east)
  const nB = [-Math.sin(g.lat) * Math.cos(g.lon), -Math.sin(g.lat) * Math.sin(g.lon), Math.cos(g.lat)];
  const eB = [-Math.sin(g.lon), Math.cos(g.lon), 0];
  const back = along.map((x) => -x);
  const hd =
    Math.atan2(back[0]! * eB[0]! + back[1]! * eB[1]! + back[2]! * eB[2]!, back[0]! * nB[0]! + back[1]! * nB[1]! + back[2]! * nB[2]!) / D;
  return { ...s, lat: g.lat / D, lon: g.lon / D, rwy: ((hd % 360) + 360) % 360, reverse: !s.reverse };
}

/**
 * The end a runway is landed at with the wind from `from` [°, null: none chosen — the fair weather's, the
 * published end as before] at `u10` [m/s]: into it — the other end once the published one would have
 * more than half a metre a second of tail wind (calm: the published one).
 */
export function intoWind(s: Site, from: number | null, u10: number): Site {
  if (!s.runway || s.rwy === undefined || from === null || s.body !== "earth") return s;
  const head = u10 * Math.cos(((from - s.rwy) * Math.PI) / 180);
  return head < -0.5 ? reciprocal(s) : s;
}

/** The wind on a runway's heading: along it (> 0: head wind) and across it (> 0: from the right) [m/s]. */
export function runwayWind(rwy: number, from: number, u10: number): { head: number; cross: number } {
  const a = ((from - rwy) * Math.PI) / 180;
  return { head: u10 * Math.cos(a), cross: u10 * Math.sin(a) };
}

/**
 * The end of a runway landed at now (PLAN-METEO W4): into the weather's wind there — the player's preset,
 * the day's draw, the airfield's report —; in fair weather the published end, as before (the flights flown
 * before, the same). `site` either end: the same runway by its name.
 */
export function landingEnd(
  site: Site,
  s: { weather: WeatherPreset; wind: WindLevel },
  days: number,
  real: WeatherState | null = null,
): Site {
  if (!site.runway || site.body !== "earth") return site;
  const base = site.reverse ? (SITES.find((x) => x.name === site.name && x.body === site.body) ?? reciprocal(site)) : site;
  if (s.weather === "fair") return base;
  const w = weatherAt(s, base, days, real);
  return intoWind(base, windFromAt(w, base, days), w.wind.u10);
}
