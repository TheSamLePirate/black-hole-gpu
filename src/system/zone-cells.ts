// PLAN-J8 J8-6 — an offline zone carries its building cells prepared (docs/PLAN-J8-BATIMENTS.md §8): once a zone's tiles are in, each
// of its BD TOPO z 15 tiles is prepared into its cell (cell-worker.ts: the tile read through the Service Worker — the zone's own copy —,
// decoded by cell-prep.ts, put in the prepared cache, kerr-cells-v<format>) — offline, the far layer (J8-4) then reads every cell of
// the zone from that cache: no decoding in flight. The zone's own pool, apart from the game's (cell-workers.ts cellPool: its `want`
// is the whole wanted set, J8-4's — the zone's list would replace it), one worker: a download runs behind the game. The cells a
// zone holds are counted (cells, buildings, bytes) for Settings › Offline; a zone removed drops the cells no other zone holds.
import { BDTOPO_Z } from "./bdtopo";
import { readHeader } from "./building-cells";
import { CellPool, type CellExecutor, type CellStore } from "./cell-pool";
import { OVERTURE_Z, parseOvertureZoneUrl } from "./pmtiles";

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
      r.buildings += readHeader(c.buf)?.count ?? 0;
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
