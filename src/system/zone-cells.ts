// PLAN-J8 J8-6 — an offline zone carries its building cells prepared (docs/PLAN-J8-BATIMENTS.md §8): once a zone's tiles are in, each
// of its BD TOPO z 15 tiles is prepared into its cell (cell-worker.ts: the tile read through the Service Worker — the zone's own copy —,
// decoded by cell-prep.ts, put in the prepared cache, kerr-cells-v<format>) — offline, the far layer (J8-4) then reads every cell of
// the zone from that cache: no decoding in flight. The zone's own pool, apart from the game's (cell-workers.ts cellPool: its `want`
// is the whole wanted set, J8-4's — the zone's list would replace it), one worker: a download runs behind the game. The cells a
// zone holds are counted (cells, buildings, bytes) for Settings › Offline; a zone removed drops the cells no other zone holds.
import { BDTOPO_Z } from "./bdtopo";
import { cellBounds, MESH_NEAR_M, readHeader } from "./building-cells";
import { CellPool, type CellExecutor, type CellStore } from "./cell-pool";
import { readMeshHeader } from "./mesh-cells";
import { OVERTURE_Z, parseOvertureZoneUrl } from "./pmtiles";
import { corridorDistance, type ZoneCorridor } from "./zones";

export interface ZoneCells {
  /** the cells prepared or found ready */
  count: number;
  /** their buildings (the records) */
  buildings: number;
  /** their bytes in the prepared cache */
  bytes: number;
  /** those that failed (left for the game to prepare in flight) */
  failed: number;
  /** the time it took [ms] */
  ms: number;
}

const TILE = new RegExp(`/BDTOPO/${BDTOPO_Z}/(\\d+)/(\\d+)\\.pbf`);

/** A zone's cells from its chains' links (system/zones.ts zoneChains: sceneryZoneChains lists them): its BD TOPO z 15 tiles, and its
 *  Overture z 14 tiles' four z 15 cells each (PLAN-J8 J8-7: `kerr-overture:14/x/y`, outside France). */
export function zoneCellTiles(chains: readonly (readonly string[])[]): { x: number; y: number }[] {
  const seen = new Set<string>();
  const out: { x: number; y: number }[] = [];
  const add = (x: number, y: number) => {
    const k = `${x}/${y}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x, y });
  };
  for (const chain of chains)
    for (const url of chain) {
      const m = TILE.exec(url);
      if (m) add(Number(m[1]), Number(m[2]));
      const o = parseOvertureZoneUrl(url);
      if (o?.theme === "buildings" && o.z === OVERTURE_Z)
        for (const [i, j] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const)
          add(o.x * 2 + i, o.y * 2 + j);
    }
  return out;
}

const ROADS = /tiles\.openfreemap\.org\/planet\/[^/]+\/14\/(\d+)\/(\d+)\.pbf/;
/** A zone's street cells (PLAN-J8 J8-L): the four z 15 cells of each OpenMapTiles z 14 tile among its chains' links. */
export function zoneStreetTiles(chains: readonly (readonly string[])[]): { x: number; y: number }[] {
  const seen = new Set<string>();
  const out: { x: number; y: number }[] = [];
  for (const chain of chains)
    for (const url of chain) {
      const m = ROADS.exec(url);
      if (!m) continue;
      for (const [i, j] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const x = Number(m[1]) * 2 + i,
          y = Number(m[2]) * 2 + j;
        const k = `${x}/${y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x, y });
      }
    }
  return out;
}

/** A zone's mesh cells (PLAN-J8 J8-8, mesh-cells.ts): its BD TOPO z 15 tiles that reach within MESH_NEAR_M of its corridor's track —
 *  a cell's nearest point, its centre less its half-diagonal —; a zone without a corridor none (the near scene draws there as before:
 *  a disc of 12 km would be ~450 cells, ~600 MB at Paris's density). */
export function zoneMeshTiles(
  chains: readonly (readonly string[])[],
  zone: { lat: number; lon: number; corridor?: ZoneCorridor | null },
): { x: number; y: number }[] {
  const c = zone.corridor;
  if (!c) return [];
  const out: { x: number; y: number }[] = [];
  const seen = new Set<string>();
  for (const chain of chains)
    for (const url of chain) {
      const m = TILE.exec(url);
      if (!m) continue;
      const x = Number(m[1]),
        y = Number(m[2]);
      const k = `${x}/${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const b = cellBounds(x, y, BDTOPO_Z);
      const lat = (b.north + b.south) / 2,
        lon = (b.east + b.west) / 2;
      const half = 0.5 * Math.hypot((b.north - b.south) * 111320, (b.east - b.west) * 111320 * Math.cos((lat * Math.PI) / 180));
      if (corridorDistance(zone.lat, zone.lon, c, lat, lon) - half <= MESH_NEAR_M) out.push({ x, y });
    }
  return out;
}

/** a prepared cell's buildings, whichever its kind: a building cell's records (KBC1), a mesh cell's buildings (KMC1) */
const buildingsIn = (buf: ArrayBuffer) => readHeader(buf)?.count ?? readMeshHeader(buf)?.buildings ?? 0;

/**
 * A zone's cells prepared (or found ready in the prepared cache), one pool of its own; `progress` told as they come. Resolves once
 * every cell is in or failed — `signal` stops it (those in are kept).
 */
export function prepareZoneCells(
  tiles: readonly { x: number; y: number }[],
  exec: CellExecutor,
  store: CellStore | null,
  o: { progress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<ZoneCells> {
  const t0 = performance.now();
  const r: ZoneCells = { count: 0, buildings: 0, bytes: 0, failed: 0, ms: 0 };
  if (!tiles.length) return Promise.resolve(r);
  const pool = new CellPool(exec, store, { maxQueue: tiles.length });
  return new Promise<ZoneCells>((resolve) => {
    let settled = 0;
    const end = () => {
      off();
      r.ms = performance.now() - t0;
      resolve(r);
    };
    const one = () => {
      settled++;
      o.progress?.(settled, tiles.length);
      if (settled >= tiles.length) end();
    };
    const off = pool.listen((c) => {
      r.count++;
      r.bytes += c.buf.byteLength;
      r.buildings += buildingsIn(c.buf);
      one();
    });
    pool.onError = () => {
      r.failed++;
      one();
    };
    o.signal?.addEventListener("abort", () => {
      pool.want([]);
      end();
    });
    pool.want(tiles.map((t, i) => ({ x: t.x, y: t.y, priority: 3, d: i })));
  });
}

/** The cells only `zone` holds among `others` (their tiles): those a removal may drop from the prepared cache. */
export function cellsOnlyIn(
  zone: readonly { x: number; y: number }[],
  others: readonly (readonly { x: number; y: number }[])[],
): { x: number; y: number }[] {
  const kept = new Set(others.flat().map((t) => `${t.x}/${t.y}`));
  return zone.filter((t) => !kept.has(`${t.x}/${t.y}`));
}
