// The world's airfields and runways (docs/PLAN-RADAR-AAA.md RD10): OurAirports' (public domain), built by
// scripts/build-runways.ts into 5° × 5° tiles (assets/runways/v1/, served at runways/v1/), read here on demand and
// kept (the least recently used dropped), the same module for the game and the crew's console (pure: no import of the
// simulator — the crew's bundle takes it; each fetches the tiles from its own site). Each airfield its codes, name, kind,
// place, elevation, town, scheduled service, runways; each runway its two thresholds (exact over the ellipsoid, or
// rebuilt from its number: `approx`), its true heading, length, width, surface, lights, its ends' names and elevations.

import { geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";

export type FieldKind = "large" | "medium" | "small" | "seaplane" | "heliport";
export type Surface = "paved" | "grass" | "dirt" | "water" | "snow" | "unknown";
const KINDS: FieldKind[] = ["large", "medium", "small", "seaplane", "heliport"];
const SURFACES: Surface[] = ["paved", "grass", "dirt", "water", "snow", "unknown"];

export interface Runway {
  /** the ends' names (09L, 27R) */
  le: string;
  he: string;
  /** the thresholds [°] (le, then he) */
  lat1: number;
  lon1: number;
  lat2: number;
  lon2: number;
  /** the true heading from le to he [°] */
  hdg: number;
  /** [m] */
  len: number;
  wid: number;
  surface: Surface;
  lit: boolean;
  /** the ends' elevations [m over the sea] */
  elev1: number;
  elev2: number;
  /** rebuilt from the runway's number and length about the airfield's point (OurAirports gave no thresholds) */
  approx: boolean;
}

export interface Airfield {
  ident: string;
  icao: string;
  iata: string;
  name: string;
  kind: FieldKind;
  lat: number;
  lon: number;
  /** [m over the sea] */
  elev: number;
  city: string;
  scheduled: boolean;
  runways: Runway[];
}

let base = "runways/v1/";
/** Where the tiles are fetched (relative to the page: the game's root, the crew's ../). */
export function setRunwaysBase(url: string) {
  base = url.endsWith("/") ? url : `${url}/`;
}

type Raw = [string, string, string, string, number, number, number, number, string, number, number[][], string[]];

/** A tile's airfields from its JSON. */
/**
 * A runway's true heading [°] and length [m] from its two thresholds, on the WGS84 ellipsoid (the chord between them, its
 * direction on the le end's north and east). OurAirports' published heading is off by a degree and more on some runways —
 * Le Bourget's 07/25: 69.0° against its thresholds' 67.8° —, which put a far threshold rebuilt from it ~60 m to the side: the
 * ILS's runway beside the one drawn, the F-35 landed in the grass (Sam, 6 Nov 2026). Null when the ends are too close to tell.
 */
export function runwayAxis(lat1: number, lon1: number, lat2: number, lon2: number): { hdg: number; len: number } | null {
  const D = Math.PI / 180;
  const a = geodeticToCart(WGS84_A, WGS84_F, lat1 * D, lon1 * D, 0),
    b = geodeticToCart(WGS84_A, WGS84_F, lat2 * D, lon2 * D, 0);
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0]!, d[1]!, d[2]!);
  if (!(len > 200)) return null;
  const la = lat1 * D,
    lo = lon1 * D;
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const hdg = Math.atan2(dot(d, east), dot(d, north)) / D;
  return { hdg: ((hdg % 360) + 360) % 360, len };
}

export function decodeTile(json: { v: number; a: Raw[] }): Airfield[] {
  return json.a.map((r) => ({
    ident: r[0],
    icao: r[1] || r[0],
    iata: r[2],
    name: r[3],
    kind: KINDS[r[4]] ?? "small",
    lat: r[5] / 1e5,
    lon: r[6] / 1e5,
    elev: r[7],
    city: r[8],
    scheduled: r[9] === 1,
    runways: r[10].map((w, k) => {
      const [le = "", he = ""] = (r[11][k] ?? "/").split("/");
      // (its heading and length from its thresholds when it has both — runwayAxis —, the published ones else)
      const ax = w[11] === 1 ? null : runwayAxis(w[0]! / 1e5, w[1]! / 1e5, w[2]! / 1e5, w[3]! / 1e5);
      return {
        le,
        he,
        lat1: w[0]! / 1e5,
        lon1: w[1]! / 1e5,
        lat2: w[2]! / 1e5,
        lon2: w[3]! / 1e5,
        hdg: ax ? Math.round(ax.hdg * 100) / 100 : w[4]! / 10,
        len: ax ? Math.round(ax.len) : w[5]!,
        wid: w[6]!,
        surface: SURFACES[w[7]!] ?? "unknown",
        lit: w[8] === 1,
        elev1: w[9]!,
        elev2: w[10]!,
        approx: w[11] === 1,
      };
    }),
  }));
}

/** The tile holding a place (its square's south-west corner over 5). */
export const tileKey = (lat: number, lon: number) =>
  `${Math.floor(lat / 5)}_${Math.floor((((((lon + 180) % 360) + 360) % 360) - 180) / 5)}`;

let index: Record<string, [number, number]> | null = null;
let indexP: Promise<Record<string, [number, number]> | null> | null = null;
const tiles = new Map<string, { fields: Airfield[]; used: number }>();
const pending = new Map<string, Promise<Airfield[]>>();
let clock = 0;
/** a tile arrived: the maps redraw */
export const runwaysEvents = { onLoad: (_key: string) => {} };

/** a fetch that failed (offline, the network down): not asked again before RETRY_MS — the maps ask every frame; offline, 445
 *  requests in a minute on four files (zones-usa-night, 10 Nov 2026) */
const RETRY_MS = 30_000;
const failedAt = new Map<string, number>();
const resting = (key: string) => {
  const t = failedAt.get(key);
  return t !== undefined && performance.now() - t < RETRY_MS;
};

async function getIndex() {
  if (index) return index;
  // (failed: none for now, asked again after a while — it had stayed empty for the session)
  if (resting("index")) return null;
  indexP ??= fetch(`${base}index.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { tiles: Record<string, [number, number]> } | null) => (index = j?.tiles ?? {}))
    .catch(() => {
      failedAt.set("index", performance.now());
      indexP = null;
      return null;
    });
  return indexP;
}

/** A tile's airfields (fetched once, kept; an empty square: none, nothing fetched). */
export async function loadTile(key: string): Promise<Airfield[]> {
  const t = tiles.get(key);
  if (t) {
    t.used = ++clock;
    return t.fields;
  }
  const I = await getIndex();
  if (!I?.[key] || resting(key)) return [];
  let p = pending.get(key);
  if (!p) {
    p = fetch(`${base}t${key}.json`)
      .then((r) => (r.ok ? r.json() : { v: 1, a: [] }))
      .then((j) => {
        const fields = decodeTile(j);
        tiles.set(key, { fields, used: ++clock });
        pending.delete(key);
        // (some 40 tiles kept: the least recently used dropped)
        if (tiles.size > 40) {
          const old = [...tiles.entries()].sort((a, b) => a[1].used - b[1].used)[0]!;
          tiles.delete(old[0]);
        }
        loadedCount++;
        runwaysEvents.onLoad(key);
        return fields;
      })
      .catch(() => {
        pending.delete(key);
        failedAt.set(key, performance.now());
        return [];
      });
    pending.set(key, p);
  }
  return p;
}

/** The tiles' keys about a place within r [m]. */
export function tilesAround(lat: number, lon: number, r: number): string[] {
  const dLat = r / 111_000 + 0.01,
    dLon = r / (111_000 * Math.max(Math.cos((lat * Math.PI) / 180), 0.02)) + 0.01;
  const keys = new Set<string>();
  for (let la = Math.floor((lat - dLat) / 5); la <= Math.floor(Math.min(lat + dLat, 89.99) / 5); la++)
    for (let lo = Math.floor((lon - dLon) / 5); lo <= Math.floor((lon + dLon) / 5); lo++) {
      const L = ((((lo * 5 + 180) % 360) + 360) % 360) - 180;
      keys.add(`${la}_${Math.floor(L / 5)}`);
    }
  return [...keys];
}

/** The equirectangular distance [m] (short ranges: the maps' culling, the nearest). */
function near(lat0: number, lon0: number, lat: number, lon: number) {
  let dl = lon - lon0;
  if (dl > 180) dl -= 360;
  if (dl < -180) dl += 360;
  const x = dl * 111_195 * Math.cos(((lat0 + lat) * Math.PI) / 360),
    y = (lat - lat0) * 111_195;
  return Math.hypot(x, y);
}

/**
 * The airfields within r [m] of a place among the tiles already in — asked for those not yet (they come later:
 * runwaysEvents.onLoad) —, the nearest first; `filter` leaves some out (a map's level of detail).
 */
export function fieldsNear(lat: number, lon: number, r: number, filter?: (f: Airfield) => boolean): Airfield[] {
  const out: { f: Airfield; d: number }[] = [];
  for (const k of tilesAround(lat, lon, r)) {
    const t = tiles.get(k);
    if (!t) {
      void loadTile(k);
      continue;
    }
    t.used = ++clock;
    for (const f of t.fields) {
      if (filter && !filter(f)) continue;
      const d = near(lat, lon, f.lat, f.lon);
      if (d <= r) out.push({ f, d });
    }
  }
  return out.sort((a, b) => a.d - b.d).map((x) => x.f);
}

/** The answers kept a moment (fieldsNearCached): by the caller's key, the place to 0.01°, the reach. */
const answers = new Map<string, { at: number; fields: Airfield[]; loaded: number }>();
let loadedCount = 0;
/**
 * fieldsNear for a screen drawn often (the HUD's scope every frame, the maps, the panoramic display): the answer kept
 * `ms` [ms] while the place moves less than 0.01° and no tile came — a search through thousands of strips a frame
 * cost the frame rate (PLAN-RADAR-AAA RD13). `key` names the caller (its filter).
 */
export function fieldsNearCached(
  key: string,
  lat: number,
  lon: number,
  r: number,
  filter?: (f: Airfield) => boolean,
  ms = 500,
): Airfield[] {
  const k = `${key}|${lat.toFixed(2)}|${lon.toFixed(2)}|${Math.round(r)}`;
  const now = performance.now();
  const hit = answers.get(k);
  if (hit && now - hit.at < ms && hit.loaded === loadedCount) return hit.fields;
  const fields = fieldsNear(lat, lon, r, filter);
  if (answers.size > 64) answers.clear();
  answers.set(k, { at: now, fields, loaded: loadedCount });
  return fields;
}

/** The same, awaited: every tile in first (tests, a search). */
export async function fieldsNearAsync(lat: number, lon: number, r: number, filter?: (f: Airfield) => boolean): Promise<Airfield[]> {
  await Promise.all(tilesAround(lat, lon, r).map(loadTile));
  return fieldsNear(lat, lon, r, filter);
}

/** An airfield by its code among the tiles already in (null: not there — fieldByCode fetches it). */
export function fieldCached(code: string): Airfield | null {
  const c = code.trim().toUpperCase();
  for (const t of tiles.values()) {
    const f = t.fields.find((x) => x.icao === c || x.ident === c || x.iata === c);
    if (f) return f;
  }
  return null;
}

let idents: Record<string, [number, number]> | null = null;
/** An airfield by any of its codes (ICAO, the local ident, IATA) anywhere in the world; null: none. */
export async function fieldByCode(code: string): Promise<Airfield | null> {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  idents ??= await fetch(`${base}idents.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  const p = idents?.[c];
  if (!p) return null;
  const fields = await loadTile(tileKey(p[0] / 1e4, p[1] / 1e4));
  return fields.find((f) => f.ident === c || f.icao === c || f.iata === c) ?? null;
}

/** A map's level of detail (PLAN-RADAR-AAA §5): what it draws at a range shown [m]. */
export function fieldShown(f: Airfield, range: number): boolean {
  const paved = f.runways.some((w) => w.surface === "paved");
  const longest = f.runways.reduce((m, w) => Math.max(m, w.len), 0);
  if (range > 300_000) return f.kind === "large";
  if (range > 80_000) return f.kind === "large" || (f.kind === "medium" && longest >= 1800) || (paved && longest >= 1800);
  if (range > 20_000) return f.kind !== "heliport" && f.kind !== "seaplane" && (paved || longest >= 600);
  return true;
}

/** A surface's colour on the maps: paved light cyan, grass green, dirt ochre, water blue, snow white. */
export const SURFACE_COLOUR: Record<Surface, string> = {
  paved: "#9fe6ff",
  grass: "#6fd27a",
  dirt: "#d6a65a",
  water: "#4aa3ff",
  snow: "#eef6ff",
  unknown: "#a9b6c2",
};

/** The credit to show where they are drawn. */
export const RUNWAYS_CREDIT = "OurAirports";
