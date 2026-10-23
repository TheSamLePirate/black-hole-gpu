// An airport's ground network fetched (docs/PLAN-A320.md, A14 — game/airportnet.ts builds it): OpenStreetMap's
// elements by the Overpass API (its taxiways and taxilanes, runways, holding points, parking positions and gates
// within some 3.5 km of the airfield — © OpenStreetMap contributors, ODbL), kept in the browser's Cache Storage (an
// airport's ground changes in years, not minutes); the public servers busy, tried again a few times; none answering,
// the vector tiles' lines the scenery already reads (OpenMapTiles' aeroway layer: the taxiways with their refs, the
// runways, the gates at the large airports — no parking positions, the lines cut at the tiles' edges: their ends
// joined within a few metres) — a coarser network, but one.

import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { type AirportNet, buildNet, type OsmEl } from "./airportnet";

const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const CACHE = "kerr-airportnet-v1";
/** the box about the airfield [°]: some 3.5 km north and south, 4.5 km east and west at mid-latitudes */
const DLAT = 0.032,
  DLON = 0.06;

const memo = new Map<string, Promise<AirportNet | null>>();

/** The airport's network (its code — ICAO —, its place): the memory's, the cache's, Overpass's, else the tiles'; none:
 *  nothing anywhere (offline, or no taxiway mapped). */
export function loadAirportNet(code: string, lat: number, lon: number): Promise<AirportNet | null> {
  const key = code.toUpperCase();
  let p = memo.get(key);
  if (!p) {
    p = fetchNet(key, lat, lon).catch((e) => {
      console.warn("airport network:", key, e);
      return null;
    });
    memo.set(key, p);
    // (a failure forgotten in a minute: tried again then)
    void p.then((n) => {
      if (!n) setTimeout(() => memo.delete(key), 60_000);
    });
  }
  return p;
}

async function fetchNet(code: string, lat: number, lon: number): Promise<AirportNet | null> {
  const origin = { lat, lon };
  const cacheKey = `https://kerr.invalid/airportnet/${code}`;
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
  const hit = await cache?.match(cacheKey);
  if (hit) {
    const els = (await hit.json()) as OsmEl[];
    return buildNet(els, origin, "osm");
  }
  const els = await overpass(lat, lon);
  if (els?.some((e) => e.tags?.aeroway === "taxiway")) {
    await cache?.put(cacheKey, new Response(JSON.stringify(els), { headers: { "content-type": "application/json" } })).catch(() => {});
    return buildNet(els, origin, "osm");
  }
  const t = await fromTiles(lat, lon);
  return t.length ? buildNet(t, origin, "tiles") : null;
}

/** Overpass's elements of the box (a server busy or slow: the next, then again after 2 and 4 s). */
async function overpass(lat: number, lon: number): Promise<OsmEl[] | null> {
  const b = `${(lat - DLAT).toFixed(4)},${(lon - DLON).toFixed(4)},${(lat + DLAT).toFixed(4)},${(lon + DLON).toFixed(4)}`;
  const q = `[out:json][timeout:25];(way["aeroway"~"^(taxiway|taxilane|runway|parking_position)$"](${b});node["aeroway"~"^(parking_position|holding_position|gate)$"](${b}););out body;>;out skel qt;`;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of SERVERS) {
      try {
        const r = await fetch(url, {
          method: "POST",
          body: new URLSearchParams({ data: q }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!r.ok) continue;
        const j = (await r.json()) as { elements?: OsmEl[] };
        if (j.elements) return j.elements;
      } catch {
        /* (the next server) */
      }
    }
    await new Promise((ok) => setTimeout(ok, 2000 * 2 ** attempt));
  }
  return null;
}

/** The vector tiles' aeroway lines and gates as OSM's elements (z 14, the box's tiles). */
async function fromTiles(lat: number, lon: number): Promise<OsmEl[]> {
  const z = 14,
    n = 2 ** z;
  const tx = (lo: number) => Math.floor(((lo + 180) / 360) * n);
  const ty = (la: number) =>
    Math.floor(((1 - Math.log(Math.tan((la * Math.PI) / 180) + 1 / Math.cos((la * Math.PI) / 180)) / Math.PI) / 2) * n);
  const lines: TileLine[] = [];
  const points: TilePoint[] = [];
  for (let x = tx(lon - DLON); x <= tx(lon + DLON); x++)
    for (let y = ty(lat + DLAT); y <= ty(lat - DLAT); y++) {
      try {
        const r = await fetch(`https://tiles.openfreemap.org/planet/latest/14/${x}/${y}.pbf`, { signal: AbortSignal.timeout(15_000) });
        if (!r.ok) continue;
        const l = new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer()))).layers.aeroway;
        if (!l) continue;
        for (let i = 0; i < l.length; i++) {
          const f = l.feature(i);
          const cls = String(f.properties.class ?? "");
          const ref = f.properties.ref !== undefined ? String(f.properties.ref) : undefined;
          const geo = (v: { x: number; y: number }) => ({
            lon: ((x + v.x / f.extent) / n) * 360 - 180,
            lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v.y / f.extent)) / n))) / (Math.PI / 180),
          });
          if (f.type === 2 && (cls === "taxiway" || cls === "runway"))
            for (const ring of f.loadGeometry()) lines.push({ cls, ref, pts: ring.map(geo) });
          else if (f.type === 1 && cls === "gate")
            for (const ring of f.loadGeometry()) for (const p of ring) points.push({ ref, ...geo(p) });
        }
      } catch {
        /* (a tile missing: the others) */
      }
    }
  return tileElements(lines, points);
}

export interface TileLine {
  cls: string;
  ref?: string;
  pts: { lat: number; lon: number }[];
}
export interface TilePoint {
  ref?: string;
  lat: number;
  lon: number;
}

/** The tiles' lines and points as OSM's elements: each vertex a node — the same within 3 m one node (the lines meet
 *  at their junctions' vertices, their ends cut at the tiles' edges meet again). */
export function tileElements(lines: TileLine[], points: TilePoint[]): OsmEl[] {
  const out: OsmEl[] = [];
  const cell = new Map<string, OsmEl[]>();
  let next = -1;
  const M = 111_132.95;
  const nodeAt = (p: { lat: number; lon: number }): number => {
    const k = Math.cos((p.lat * Math.PI) / 180);
    const cx = Math.round((p.lon * M * k) / 3),
      cy = Math.round((p.lat * M) / 3);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const e of cell.get(`${cx + dx},${cy + dy}`) ?? [])
          if (Math.hypot((e.lon! - p.lon) * M * k, (e.lat! - p.lat) * M) < 3) return e.id;
    const e: OsmEl = { type: "node", id: next--, lat: p.lat, lon: p.lon };
    out.push(e);
    (cell.get(`${cx},${cy}`) ?? cell.set(`${cx},${cy}`, []).get(`${cx},${cy}`)!).push(e);
    return e.id;
  };
  for (const L of lines) {
    const ids = L.pts.map(nodeAt).filter((id, i, a) => i === 0 || id !== a[i - 1]);
    if (ids.length < 2) continue;
    out.push({ type: "way", id: next--, nodes: ids, tags: { aeroway: L.cls, ...(L.ref ? { ref: L.ref } : {}) } });
  }
  for (const p of points)
    out.push({ type: "node", id: next--, lat: p.lat, lon: p.lon, tags: { aeroway: "gate", ...(p.ref ? { ref: p.ref } : {}) } });
  return out;
}
