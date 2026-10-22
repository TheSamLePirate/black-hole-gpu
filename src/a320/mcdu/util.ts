// The A320's MCDU's helpers (docs/PLAN-A320.md, A9): its entries read as the MCDU reads them — a lat/lon in Airbus's
// "4851.0N/00230.0E", a place/bearing/distance "LFPG/090/25", numbers in their ranges, an airfield made a waypoint
// (its longest runway's heading) — and the predictions it shows: the legs' courses and distances, the distance and
// the time and the fuel to the destination (the FMGC's own figures are A10's: a cruise burn of 2.4 t/h here). Pure.

import { gcCourse, gcDest, gcDist, type FlightPlan, type Waypoint } from "../../game/flightplan";
import type { Airfield } from "../../world/runways";

const D = Math.PI / 180;
const NM = 1852;

/** An airfield as a waypoint of the plan: its code, its place, its field (its level, its longest runway's heading). */
export function fieldWp(f: Airfield): Waypoint {
  const longest = [...f.runways].sort((a, b) => b.len - a.len)[0];
  return {
    name: f.icao || f.ident,
    lat: f.lat,
    lon: f.lon,
    field: { icao: f.icao || f.ident, elev: f.elev, rwy: longest?.hdg },
  };
}

/** Airbus's lat/lon entry: "4851.0N/00230.0E" (degrees and minutes; the minutes' decimals optional) → [°] */
export function parseLatLon(s: string): { lat: number; lon: number } | null {
  const m = /^(\d{2})(\d{2}(?:\.\d)?)([NS])\/(\d{3})(\d{2}(?:\.\d)?)([EW])$/.exec(s);
  if (!m) return null;
  const lat = (Number(m[1]) + Number(m[2]) / 60) * (m[3] === "S" ? -1 : 1);
  const lon = (Number(m[4]) + Number(m[5]) / 60) * (m[6] === "W" ? -1 : 1);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || Number(m[2]) >= 60 || Number(m[5]) >= 60) return null;
  return { lat, lon };
}

/** A place, a bearing and a distance: "LFPG/090/25" → its point [°] (the place found by `place`) */
export function parsePbd(
  s: string,
  place: (name: string) => { lat: number; lon: number } | null,
): { lat: number; lon: number; name: string } | null {
  const m = /^([A-Z0-9]{2,7})\/(\d{1,3})\/(\d{1,3}(?:\.\d)?)$/.exec(s);
  if (!m) return null;
  const p = place(m[1]!);
  const brg = Number(m[2]),
    dist = Number(m[3]);
  if (!p || brg > 360) return null;
  const q = gcDest(p, brg * D, dist * NM);
  return { ...q, name: `${m[1]!.slice(0, 3)}${String(brg).padStart(3, "0")}` };
}

/** A number in [lo, hi] (its decimals as given), null: not one */
export function num(s: string, lo: number, hi: number): number | null {
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const x = Number(s);
  return x >= lo && x <= hi ? x : null;
}

/** A leg's course [° true] and distance [NM] into waypoint i (from i − 1; the first: none) */
export function legInto(R: FlightPlan, i: number): { crs: number; nm: number } | null {
  const a = R.wps[i - 1],
    b = R.wps[i];
  if (!a || !b) return null;
  return { crs: Math.round(gcCourse(a, b) / D) % 360 || 360, nm: gcDist(a, b) / NM };
}

/** The distance [NM] along the plan from a place through the active waypoint to waypoint `to` (the destination:
 *  the last) */
export function distAlong(R: FlightPlan, from: { lat: number; lon: number } | null, active: number, to = R.wps.length - 1): number {
  const W = R.wps;
  if (!W.length) return 0;
  const a = Math.min(Math.max(active, 0), W.length - 1);
  let d = from ? gcDist(from, W[a]!) : 0;
  for (let i = a + 1; i <= to; i++) d += gcDist(W[i - 1]!, W[i]!);
  return d / NM;
}

/** The time [h] and the fuel [t] a distance [NM] takes: a cruise of 450 kt and 2.4 t/h, the climb's and the
 *  descent's 0.25 h and 0.6 t more when a flight is still to make (from the ground) */
export function trip(nm: number, fromGround: boolean): { h: number; t: number } {
  const h = nm / 450 + (fromGround ? 0.25 : 0);
  return { h, t: 2.4 * (nm / 450) + (fromGround ? 0.6 : 0) };
}

/** A time of the day "HHMM" (UTC) */
export const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
/** A duration [h] "HHMM" */
export const dur = (h: number) => {
  const m = Math.max(Math.round(h * 60), 0);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}`;
};
/** a weight [t] "12.3" */
export const tons = (t: number) => (Math.round(t * 10) / 10).toFixed(1);
