// The world's airfields as the game's sites (docs/PLAN-RADAR-AAA.md RD13): every feature that took one of the eight
// sites — the ILS and its procedures, the line-up and the glide, the returns to base, TARS's places, the flight hub, the
// panels' searches — takes any airfield of the world too: its longest paved runway of a jet's length as the site (its
// le threshold, its heading, its level — the one graded near the eye if it is, measured: src/world/runways3d.ts — its
// length).

import { SITES, type Site } from "../game/sites";
import { type Airfield, fieldCached, fieldsNear } from "./runways";
import { worldRunwaysNow } from "./runways3d";

/** A jet's runway: paved, 1 800 m at least (`min` another length). */
export const jetRunway = (f: Airfield, min = 1800) =>
  f.runways.filter((x) => x.surface === "paved" && x.len >= min).sort((a, b) => b.len - a.len)[0];

/** A world airfield's longest paved runway as a site (null: none of `min` metres). */
export function worldSite(f: Airfield, min = 1800): Site | null {
  const w = jetRunway(f, min);
  if (!w) return null;
  const code = f.icao || f.ident;
  const graded = worldRunwaysNow().find(
    (r) => r.world?.field === code && Math.abs(r.site.lat - w.lat1) < 1e-4 && Math.abs(r.site.lon - w.lon1) < 1e-4,
  );
  if (graded) return { ...graded.site, name: `${f.name} (${code})`, len: graded.len };
  return {
    body: "earth",
    name: `${f.name} (${code})`,
    lat: w.lat1,
    lon: w.lon1,
    runway: true,
    rwy: w.hdg,
    icao: code,
    elev: Math.round((w.elev1 + w.elev2) / 2),
    len: w.len,
  };
}

/** A site by its name or code: the game's own first, else a world airfield already in (its tile loaded). */
export function siteByName(name: string): Site | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const own =
    SITES.find((s) => s.icao?.toLowerCase() === n || s.name.toLowerCase() === n) ?? SITES.find((s) => s.name.toLowerCase().includes(n));
  if (own) return own;
  const f = fieldCached(name);
  return f ? worldSite(f, 600) : null;
}

/** The Earth's runway sites within r [m] of a place, the nearest first: the game's and the world's a jet lands on. */
export function runwaySitesNear(lat: number, lon: number, r: number, min = 1800): Site[] {
  const d = (s: { lat: number; lon: number }) =>
    Math.hypot((s.lat - lat) * 111_195, (s.lon - lon) * 111_195 * Math.cos((lat * Math.PI) / 180));
  const own = SITES.filter((s) => s.body === "earth" && s.runway && d(s) <= r);
  const world = fieldsNear(lat, lon, r, (f) => !!jetRunway(f, min))
    .filter((f) => !own.some((s) => s.icao === (f.icao || f.ident)))
    .map((f) => worldSite(f, min))
    .filter((s): s is Site => !!s);
  return [...own, ...world].sort((a, b) => d(a) - d(b));
}
