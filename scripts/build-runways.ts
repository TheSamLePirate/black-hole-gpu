// The world's airfields and runways (docs/PLAN-RADAR-AAA.md RD10) from OurAirports (public domain,
// davidmegginson.github.io/ourairports-data — airports.csv, runways.csv in assets/runways/raw/, git-ignored) to the
// game's tiles: assets/runways/v1/t<la>_<lo>.json — the airfields and runways of each 5° × 5° square (la, lo: the
// square's south-west corner over 5) —, index.json (the squares that have any, their counts), idents.json (each
// airfield's codes to its place: any ICAO in the flight plan). Kept: the airfields open (large, medium, small, seaplane
// bases, heliports); each runway its two thresholds (where missing: rebuilt from the airfield's point, the runway's
// number — magnetic taken as true, marked approximate — and its length), its true heading, length and width [m], its
// surface's class, lit or not, its ends' names and elevations. Places quantized to 1e-5° (≈ 1 m).
//
//   bun scripts/build-runways.ts            # → assets/runways/v1/

import { mkdirSync, rmSync } from "node:fs";

const RAW = "assets/runways/raw";
const OUT = "assets/runways/v1";
const FT = 0.3048;
const D = Math.PI / 180;

/** A CSV's rows (quoted fields, commas and doubled quotes inside them). */
function csv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') (f += '"'), i++;
        else q = false;
      } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(f), (f = "");
    else if (ch === "\n") row.push(f), rows.push(row), (row = []), (f = "");
    else if (ch !== "\r") f += ch;
  }
  if (f || row.length) row.push(f), rows.push(row);
  return rows;
}

/** The surface's class: 0 paved, 1 grass, 2 dirt / gravel, 3 water, 4 snow / ice, 5 unknown. */
export function surfaceClass(s: string): number {
  const u = s.toUpperCase();
  if (!u.trim() || /^(UNK|U|X|N|-)$/.test(u.trim())) return 5;
  if (/WAT/.test(u)) return 3;
  if (/SNOW|ICE/.test(u)) return 4;
  if (/ASP|CON|PEM|BIT|TAR|PAV|ASPH|MAC|CEMENT|SEAL|TRTD|PSP|METAL|STEEL|ALUM|BRICK|TAR/.test(u) || /^C(-[A-Z])?$/.test(u)) return 0;
  if (/GRAS|GRS|TURF|SOD|GREEN|^G(-[A-Z])?$|LAWN/.test(u)) return 1;
  if (/GRV|GRAV|GRE|DIRT|EARTH|SAND|CLA|LAT|COR|SOIL|LOAM|SILT|ROCK|STONE|SHALE|PIÇARRA|PICARRA|^S$|^D$|CALICHE|MAT/.test(u)) return 2;
  return 5;
}

const TYPES: Record<string, number> = { large_airport: 0, medium_airport: 1, small_airport: 2, seaplane_base: 3, heliport: 4 };

const ap = csv(await Bun.file(`${RAW}/airports.csv`).text());
const rw = csv(await Bun.file(`${RAW}/runways.csv`).text());
const AH = ap[0]!,
  RH = rw[0]!;
const ai = (k: string) => AH.indexOf(k),
  ri = (k: string) => RH.indexOf(k);

interface Field {
  id: string;
  ident: string;
  icao: string;
  iata: string;
  name: string;
  type: number;
  lat: number;
  lon: number;
  elev: number;
  city: string;
  sched: number;
  rw: number[][];
}
const fields = new Map<string, Field>();
for (const r of ap.slice(1)) {
  const type = TYPES[r[ai("type")]!];
  if (type === undefined) continue;
  const lat = Number(r[ai("latitude_deg")]),
    lon = Number(r[ai("longitude_deg")]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  fields.set(r[ai("id")]!, {
    id: r[ai("id")]!,
    ident: r[ai("ident")]!,
    icao: r[ai("icao_code")] || r[ai("gps_code")] || "",
    iata: r[ai("iata_code")] || "",
    name: r[ai("name")]!,
    type,
    lat,
    lon,
    elev: Math.round((Number(r[ai("elevation_ft")]) || 0) * FT),
    city: r[ai("municipality")] || "",
    sched: r[ai("scheduled_service")] === "yes" ? 1 : 0,
    rw: [],
  });
}

/** A place a distance along an azimuth (the local sphere — a runway's few km). */
function offset(lat: number, lon: number, az: number, d: number): [number, number] {
  const R = 6_371_008.8;
  return [lat + (Math.cos(az) * d) / (R * D), lon + (Math.sin(az) * d) / (R * D * Math.cos(lat * D))];
}

let rebuilt = 0,
  kept = 0,
  pads = 0;
for (const r of rw.slice(1)) {
  const F = fields.get(r[ri("airport_ref")]!);
  if (!F || r[ri("closed")] === "1") continue;
  const len = Math.round((Number(r[ri("length_ft")]) || 0) * FT);
  const wid = Math.round((Number(r[ri("width_ft")]) || 0) * FT);
  const le = r[ri("le_ident")] || "",
    he = r[ri("he_ident")] || "";
  let la = Number(r[ri("le_latitude_deg")]),
    lo = Number(r[ri("le_longitude_deg")]),
    hla = Number(r[ri("he_latitude_deg")]),
    hlo = Number(r[ri("he_longitude_deg")]);
  let hdg = Number(r[ri("le_heading_degT")]);
  const have = [la, lo, hla, hlo].every((x) => Number.isFinite(x) && x !== 0) && r[ri("le_latitude_deg")] !== "";
  let approx = 0;
  if (have) {
    if (!Number.isFinite(hdg) || r[ri("le_heading_degT")] === "") {
      const y = Math.sin((hlo - lo) * D) * Math.cos(hla * D),
        x = Math.cos(la * D) * Math.sin(hla * D) - Math.sin(la * D) * Math.cos(hla * D) * Math.cos((hlo - lo) * D);
      hdg = (((Math.atan2(y, x) / D) % 360) + 360) % 360;
    }
  } else {
    // (no thresholds: rebuilt about the airfield's point from the runway's number and length — a helipad, a point)
    const n = Number.parseInt(le, 10);
    if (!Number.isFinite(n) || n < 1 || n > 36 || len < 50) {
      pads++;
      continue;
    }
    hdg = Number.isFinite(hdg) && r[ri("le_heading_degT")] !== "" ? hdg : n * 10;
    [la, lo] = offset(F.lat, F.lon, (hdg + 180) * D, len / 2);
    [hla, hlo] = offset(F.lat, F.lon, hdg * D, len / 2);
    approx = 1;
    rebuilt++;
  }
  const q = (x: number) => Math.round(x * 1e5);
  const e1 = Number(r[ri("le_elevation_ft")]),
    e2 = Number(r[ri("he_elevation_ft")]);
  F.rw.push([
    q(la),
    q(lo),
    q(hla),
    q(hlo),
    Math.round(hdg * 10),
    len,
    wid,
    surfaceClass(r[ri("surface")] || ""),
    r[ri("lighted")] === "1" ? 1 : 0,
    // (the ends' elevations [m]: the airfield's where none)
    Number.isFinite(e1) && r[ri("le_elevation_ft")] !== "" ? Math.round(e1 * FT) : F.elev,
    Number.isFinite(e2) && r[ri("he_elevation_ft")] !== "" ? Math.round(e2 * FT) : F.elev,
    approx,
  ]);
  // (the ends' names after the numbers: their own string table in the field's row)
  (F as unknown as { names: string[] }).names ??= [];
  (F as unknown as { names: string[] }).names.push(`${le}/${he}`);
  kept++;
}

// ---- the tiles
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const tiles = new Map<string, Field[]>();
for (const F of fields.values()) {
  const k = `${Math.floor(F.lat / 5)}_${Math.floor(F.lon / 5)}`;
  if (!tiles.has(k)) tiles.set(k, []);
  tiles.get(k)!.push(F);
}
const index: Record<string, [number, number]> = {};
const idents: Record<string, [number, number]> = {};
let bytes = 0,
  gz = 0;
for (const [k, list] of tiles) {
  // (the bigger first: a reader that stops early keeps the airports)
  list.sort((a, b) => a.type - b.type || b.rw.length - a.rw.length);
  const a = list.map((F) => [
    F.ident,
    F.icao === F.ident ? "" : F.icao,
    F.iata,
    F.name,
    F.type,
    Math.round(F.lat * 1e5),
    Math.round(F.lon * 1e5),
    F.elev,
    F.city,
    F.sched,
    F.rw,
    (F as unknown as { names?: string[] }).names ?? [],
  ]);
  const body = JSON.stringify({ v: 1, a });
  await Bun.write(`${OUT}/t${k}.json`, body);
  bytes += body.length;
  gz += Bun.gzipSync(body).length;
  index[k] = [list.length, list.reduce((s, F) => s + F.rw.length, 0)];
  for (const F of list) {
    // (each code to its place — 1e-4°: the tile's to read; the main codes win a clash)
    const p: [number, number] = [Math.round(F.lat * 1e4), Math.round(F.lon * 1e4)];
    for (const c of [F.ident, F.icao, F.iata]) if (c && (!(c in idents) || F.type < 2)) idents[c] = p;
  }
}
await Bun.write(
  `${OUT}/index.json`,
  JSON.stringify({ v: 1, built: new Date().toISOString().slice(0, 10), credit: "OurAirports (public domain)", tiles: index }),
);
const idj = JSON.stringify(idents);
await Bun.write(`${OUT}/idents.json`, idj);
console.log(
  `runways: ${fields.size} airfields, ${kept} runways (${rebuilt} rebuilt from their number, ${pads} pads/points), ${tiles.size} tiles — ${(bytes / 1e6).toFixed(1)} MB (gzip ${(gz / 1e6).toFixed(2)} MB); idents ${Object.keys(idents).length} (${(idj.length / 1e6).toFixed(2)} MB, gzip ${(Bun.gzipSync(idj).length / 1e6).toFixed(2)} MB)`,
);
