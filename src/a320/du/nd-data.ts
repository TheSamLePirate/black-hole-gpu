// What the A320's NDs show beyond the flight's figures (docs/PLAN-A320.md, A7): the flight plan (its points, the active
// one — the "to" of the leg flown —, the distance, bearing and time to it), the airfields about (OurAirports' world:
// world/runways.ts — their runways' thresholds), the traffic its TCAS hears (the picture's transponders: radar/picture.ts,
// radar/tcas.ts — east, north of us, its height over us, climbing or descending, its grading). Gathered four times a
// second at most: the displays refresh at ten.

import type { CameraController } from "../../controls";
import { gcCourse, gcDist } from "../../game/flightplan";
import { SENSOR } from "../../radar/picture";
import { fieldsNearCached } from "../../world/runways";

const NM = 1852;
const FT = 3.28084;

export interface NdWaypoint {
  name: string;
  lat: number;
  lon: number;
  /** its altitude constraint [ft] */
  alt?: number;
  /** an airfield's point */
  field: boolean;
}

export interface NdField {
  icao: string;
  lat: number;
  lon: number;
  /** a large or medium airfield (shown first, and farther) */
  major: boolean;
  /** its runways' thresholds [°] */
  rwys: [number, number, number, number][];
}

export interface NdTraffic {
  /** east, north of us [NM]; its height over us [ft]; its vertical speed's sense (+1 climbing, −1 descending, 0) */
  e: number;
  n: number;
  dz: number;
  vs: number;
  level: "other" | "proximate" | "TA" | "RA";
}

export interface NdExtra {
  route: NdWaypoint[];
  /** the active waypoint's index in route (−1: none), its distance [NM], its true bearing [°], the time there [s] */
  active: number;
  dist: number;
  brg: number;
  ete: number;
  /** the route flown (LNAV engaged: its legs drawn green, else dashed) */
  nav: boolean;
  fields: NdField[];
  traffic: NdTraffic[];
}

let cache: { at: number; v: NdExtra | null } = { at: -1, v: null };

/** The ND's extra data now (null: away from the Earth). */
export function ndExtra(c: CameraController): NdExtra | null {
  const now = performance.now();
  if (now - cache.at < 250) return cache.v;
  cache = { at: now, v: build(c) };
  return cache.v;
}

function build(c: CameraController): NdExtra | null {
  const g = c.geoNow();
  if (!g) return null;
  const N = c.nav;
  const W = N.route.wps;
  const route: NdWaypoint[] = W.map((w) => ({
    name: w.name,
    lat: w.lat,
    lon: w.lon,
    ...(w.alt !== undefined ? { alt: w.alt * FT } : {}),
    field: !!w.field,
  }));
  const L = N.last.l;
  let active = W.length ? Math.min(Math.max(N.lnav?.active ?? (W.length > 1 ? 1 : 0), 0), W.length - 1) : -1;
  if (L && !L.done && L.active >= 0 && L.active < W.length) active = L.active;
  let dist = 0,
    brg = 0,
    ete = Number.NaN;
  if (active >= 0) {
    const w = W[active]!;
    dist = gcDist(g, w) / NM;
    brg = ((((gcCourse(g, w) * 180) / Math.PI) % 360) + 360) % 360;
    ete = g.gs > 1 ? (dist * NM) / g.gs : Number.NaN;
  }
  // (the airfields within 400 km: the large and medium ones, the small within 60 km)
  const fields: NdField[] = fieldsNearCached("a320-nd", g.lat, g.lon, 400_000, undefined, 2000)
    .filter(
      (f) =>
        f.kind === "large" ||
        f.kind === "medium" ||
        (f.kind === "small" && Math.abs(f.lat - g.lat) < 0.55 && Math.abs(f.lon - g.lon) < 0.8),
    )
    .slice(0, 300)
    .map((f) => ({
      icao: f.icao || f.ident,
      lat: f.lat,
      lon: f.lon,
      major: f.kind === "large" || f.kind === "medium",
      rwys: f.runways.map((r) => [r.lat1, r.lon1, r.lat2, r.lon2] as [number, number, number, number]),
    }));
  // (the transponders heard: the aircraft, not the ships)
  const traffic: NdTraffic[] = (c.picture?.tracks ?? [])
    .filter((T) => T.sensors & SENSOR.TCAS && T.kind === "air" && T.side !== "dead")
    .map((T) => ({
      e: T.r[0] / NM,
      n: T.r[1] / NM,
      dz: T.r[2] * FT,
      vs: T.v[2] > 2.5 ? 1 : T.v[2] < -2.5 ? -1 : 0,
      level: T.tcas ?? "other",
    }))
    .filter((t) => Math.hypot(t.e, t.n) < 40 && Math.abs(t.dz) < 9900);
  return { route, active, dist, brg, ete, nav: N.on.l, fields, traffic };
}
