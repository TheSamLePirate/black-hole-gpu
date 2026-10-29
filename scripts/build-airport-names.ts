// The airports a flight is chosen from by name (the title's By plane › Airfield picker — ui/title/plane.ts airportSearch):
// from the game's own tiles of OurAirports (assets/runways/v1/t*.json, scripts/build-runways.ts) the large and medium
// airports with a runway, each [ident, ICAO, IATA, name, city, kind (0 large, 1 medium), lat, lon, longest runway m,
// paved], sorted large first then by name — assets/runways/v1/names.json, served with the tiles. Any other airfield of the
// world is reached by its code (game/sites.ts siteByName — PLAN-RADAR-AAA RD13).
//
//   bun scripts/build-airport-names.ts       # → assets/runways/v1/names.json

import { readdirSync, readFileSync } from "node:fs";
import { decodeTile } from "../src/world/runways";

const DIR = "assets/runways/v1";
type Row = [string, string, string, string, string, number, number, number, number, number];
const rows: Row[] = [];
for (const f of readdirSync(DIR)) {
  if (!/^t-?\d+_-?\d+\.json$/.test(f)) continue;
  for (const a of decodeTile(JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")))) {
    if (a.kind !== "large" && a.kind !== "medium") continue;
    if (!a.runways.length) continue;
    const longest = a.runways.reduce((m, r) => (r.len > m.len ? r : m), a.runways[0]!);
    rows.push([
      a.ident,
      a.icao ?? "",
      a.iata ?? "",
      a.name,
      a.city ?? "",
      a.kind === "large" ? 0 : 1,
      Math.round(a.lat * 1e4) / 1e4,
      Math.round(a.lon * 1e4) / 1e4,
      Math.round(longest.len),
      longest.surface === "paved" ? 1 : 0,
    ]);
  }
}
rows.sort((a, b) => a[5] - b[5] || a[3].localeCompare(b[3]));
await Bun.write(`${DIR}/names.json`, JSON.stringify({ v: 1, credit: "OurAirports (public domain)", a: rows }));
console.log(`${rows.length} airports → ${DIR}/names.json`);
