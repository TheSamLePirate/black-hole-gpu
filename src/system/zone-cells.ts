// PLAN-J8 J8-6 — an offline zone carries its building cells prepared (docs/PLAN-J8-BATIMENTS.md §8): once a zone's tiles are in, each
// of its BD TOPO z 15 tiles is prepared into its cell (cell-worker.ts: the tile read through the Service Worker — the zone's own copy —,
// decoded by cell-prep.ts, put in the prepared cache, kerr-cells-v<format>) — offline, the far layer (J8-4) then reads every cell of
// the zone from that cache: no decoding in flight. The zone's own pool, apart from the game's (cell-workers.ts cellPool: its `want`
// is the whole wanted set, J8-4's — the zone's list would replace it), one worker: a download runs behind the game. The cells a
// zone holds are counted (cells, buildings, bytes) for Settings › Offline; a zone removed drops the cells no other zone holds.
import { BDTOPO_Z } from "./bdtopo";
import { cellOrigin, FOREST_NEAR_M, MESH_NEAR_M, readHeader, readRecord, toCell } from "./building-cells";
import { tilesWithin } from "./ign-canopy";
import { CellPool, type CellExecutor, type CellStore } from "./cell-pool";
import { readForestHeader } from "./forest-cells";
import { readMeshHeader } from "./mesh-cells";
import { OVERTURE_Z, parseOvertureZoneUrl } from "./pmtiles";
import type { ZoneCorridor } from "./zones";

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

/** The z 15 cells within `reach` [m] of a track (its points [lat, lon]): the cells within reach of points every 250 m along it, by their
 *  nearest edge (ign-canopy.ts tilesWithin) — one selection for the zone's mesh cells and for `flightReady({ track })`: they disagreed by
 *  8 cells over Paris (the zone by its cells' centres, the check by points every 2 km — j8a-paris-strict, 17 Nov 2026). */
export function cellsAlong(points: readonly (readonly [number, number])[], reach: number): { x: number; y: number }[] {
  const seen = new Set<string>();
  const out: { x: number; y: number }[] = [];
  const at = (la: number, lo: number) => {
    for (const t of tilesWithin(BDTOPO_Z, la, lo, reach)) {
      const k = `${t.x}/${t.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ x: t.x, y: t.y });
    }
  };
  for (let k = 0; k < points.length; k++) {
    const a = points[k]!,
      b = points[Math.min(k + 1, points.length - 1)]!;
    const m = Math.hypot((b[0] - a[0]) * 111_320, (b[1] - a[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180));
    const n = Math.max(1, Math.ceil(m / 250));
    for (let i = 0; i < n; i++) at(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n);
  }
  if (points.length) at(points[points.length - 1]![0], points[points.length - 1]![1]);
  return out;
}

/** A zone's mesh cells (PLAN-J8 J8-8, mesh-cells.ts): those of its building cells (zoneCellTiles: the BD TOPO's, Overture's) within
 *  MESH_NEAR_M of its corridor's track (cellsAlong — `flightReady`'s selection); a zone without a corridor none (the near scene draws
 *  there as before: a disc of 12 km would be ~450 cells, ~600 MB at Paris's density). */
export function zoneMeshTiles(
  chains: readonly (readonly string[])[],
  zone: { lat: number; lon: number; corridor?: ZoneCorridor | null },
): { x: number; y: number }[] {
  const c = zone.corridor;
  if (!c) return [];
  const held = new Set(zoneCellTiles(chains).map((t) => `${t.x}/${t.y}`));
  return cellsAlong(c.points, MESH_NEAR_M).filter((t) => held.has(`${t.x}/${t.y}`));
}

/** A zone's forest cells (PLAN-J8 J8-8b, forest-cells.ts): its building cells within FOREST_NEAR_M of its corridor's track (cellsAlong —
 *  `flightReady`'s selection): the scene plants trees farther than it draws its near buildings; a zone without a corridor none. */
export function zoneForestTiles(
  chains: readonly (readonly string[])[],
  zone: { lat: number; lon: number; corridor?: ZoneCorridor | null },
): { x: number; y: number }[] {
  const c = zone.corridor;
  if (!c) return [];
  const held = new Set(zoneCellTiles(chains).map((t) => `${t.x}/${t.y}`));
  return cellsAlong(c.points, FOREST_NEAR_M).filter((t) => held.has(`${t.x}/${t.y}`));
}

/** The buildings of a census ring (censusRings). */
export interface CensusRing {
  /** its outer radius [m] (its inner the previous ring's) */
  outerM: number;
  /** the building cells' records whose centres lie in it */
  buildings: number;
  /** those 10 m or more on their long side (a pixel's at ~15 km: PLAN-J8 §0 criterion 1) */
  tenMetres: number;
}

/**
 * PLAN-J8 §0 criterion 1 (« toute la vue »), the census's side — what the prepared building cells hold round an eye, by ring of
 * horizontal distance (`ringsM`: the outer radii, rising): each ring's records and those 10 m or more long. The drawn count to set
 * against it is the render's (the far layer, the near meshes). Each cell's records placed by its origin's offset from the eye (the
 * cells' frames' small turn neglected: < 0.1 % at 20 km). Pure: `cells` the building cells' bytes (KBC1; others ignored).
 */
export function censusRings(
  cells: readonly { x: number; y: number; buf: ArrayBuffer }[],
  lat: number,
  lon: number,
  ringsM: readonly number[],
): CensusRing[] {
  const out = ringsM.map((outerM) => ({ outerM, buildings: 0, tenMetres: 0 }));
  const last = ringsM[ringsM.length - 1] ?? 0;
  for (const c of cells) {
    const h = readHeader(c.buf);
    if (!h) continue;
    const o = toCell({ lat, lon }, cellOrigin(c.x, c.y).lat, cellOrigin(c.x, c.y).lon);
    for (let i = 0; i < h.count; i++) {
      const r = readRecord(c.buf, i);
      const d = Math.hypot(o.east + r.east, o.north + r.north);
      if (d >= last) continue;
      const k = ringsM.findIndex((m) => d < m);
      out[k]!.buildings++;
      if (2 * r.halfLength >= 10) out[k]!.tenMetres++;
    }
  }
  return out;
}

/** a prepared cell's count, whichever its kind: a building cell's records (KBC1), a mesh cell's buildings (KMC1), a forest cell's
 *  candidates (KFC1) */
const buildingsIn = (buf: ArrayBuffer) =>
  readHeader(buf)?.count ?? readMeshHeader(buf)?.buildings ?? readForestHeader(buf)?.candidates ?? 0;

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
