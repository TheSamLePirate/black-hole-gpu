// PLAN-J8 J8-3 — a building cells' worker (one of the pool's — cell-pool.ts, cell-workers.ts): a cell asked {id, x, y}, its BD TOPO
// z 15 tile fetched (through the Service Worker: its tiles' cache and its zones'), decoded into the contract's records (cell-prep.ts:
// no roof planned, no mesh), the bytes put in the prepared cache (Cache Storage, CELL_CACHE — never decoded again) and handed back
// (transferred). {cancel: id}: its fetch aborted. The geoid's grid given once at the start ({geoid}): the buildings' ground over the
// ellipsoid (CLAUDE.md, WGS84 everywhere). PLAN-J8 J8-7: outside the IGN's box, and where the BD TOPO has no building in the cell,
// Overture Maps' (cell-overture.ts: its z 14 tile prepared into its four cells, the asked one handed). PLAN-J8 J8-L: {id, x, y, kind:
// "street"} — the cell « rue » (street-prep.ts): OpenMapTiles' z 14 tile, the four building cells under it (from the prepared cache, or
// prepared now), its four street cells put in their cache (kerr-street-v<format>), the asked one handed.
import { bdtopoUrl } from "./bdtopo";
import { inBdtopoBox, overtureCell } from "./cell-overture";
import { CELL_CACHE, cellCacheUrl } from "./cell-pool";
import { prepareBdtopoCell } from "./cell-prep";
import { geoidDeg, setGeoid } from "./geoid-grid";
import type { HeightMap } from "./heights-file";
import { STREET_CACHE, streetCacheUrl, streetRoadsUrl } from "./street-cells";
import { prepareStreetCells } from "./street-prep";

type In = { geoid: HeightMap } | { id: number; x: number; y: number; kind?: "building" | "street" } | { cancel: number };
const g = self as unknown as { onmessage: (e: MessageEvent<In>) => void; postMessage: (m: unknown, t?: Transferable[]) => void };
const aborts = new Map<number, AbortController>();

g.onmessage = async (e) => {
  const m = e.data;
  if ("geoid" in m) {
    setGeoid(m.geoid);
    return;
  }
  if ("cancel" in m) {
    aborts.get(m.cancel)?.abort();
    aborts.delete(m.cancel);
    return;
  }
  const abort = new AbortController();
  aborts.set(m.id, abort);
  const t0 = performance.now();
  try {
    if (m.kind === "street") {
      const S = await streetCell(m.x, m.y, abort.signal);
      if (abort.signal.aborted) return;
      g.postMessage({ id: m.id, buf: S.buf, ms: performance.now() - t0, kept: S.kept }, [S.buf]);
      return;
    }
    const P = await buildingCell(m.x, m.y, abort.signal);
    const fetchMs = performance.now() - t0;
    if (abort.signal.aborted) return;
    await keep(CELL_CACHE, cellCacheUrl(self.location.origin, m.x, m.y), P.buf);
    g.postMessage({ id: m.id, buf: P.buf, ms: performance.now() - t0, fetchMs, prepMs: P.stats.ms, kept: P.stats.kept }, [P.buf]);
  } catch (err) {
    if (!abort.signal.aborted) g.postMessage({ id: m.id, error: String(err).slice(0, 300) });
  } finally {
    aborts.delete(m.id);
  }
};

/** a cell's building records prepared: the BD TOPO's within the IGN's box; Overture's beyond it and where the BD TOPO has none */
async function buildingCell(x: number, y: number, signal: AbortSignal) {
  let P: ReturnType<typeof prepareBdtopoCell> | null = null;
  if (inBdtopoBox(x, y)) {
    const r = await fetch(bdtopoUrl(x, y), { signal });
    // (no tile there — the sea, a border —: an empty cell, cached as such)
    const bytes = r.status === 404 || r.status === 204 ? new ArrayBuffer(0) : r.ok ? await r.arrayBuffer() : null;
    if (!bytes) throw new Error(`BD TOPO ${x}/${y}: HTTP ${r.status}`);
    P = prepareBdtopoCell(bytes, x, y, (lat, lon) => geoidDeg(lat, lon));
  }
  // (beyond the box, or none of the BD TOPO's in the cell — Belgium, Catalonia within the box —: Overture's; its archive's reads
  // shared by the cells: not aborted with one — its result dropped by the caller if this cell was)
  if (!P || P.records.length === 0) {
    const o = await overtureCell(x, y);
    if (!P || o.records.length) P = o;
  }
  return P;
}

/** bytes put in a prepared cache (none — a private window —: prepared each time, nothing else lost) */
async function keep(name: string, url: string, buf: ArrayBuffer) {
  try {
    await (await caches.open(name)).put(url, new Response(buf.slice(0)));
  } catch {
    /* no Cache Storage */
  }
}

/** a z 15 cell's building bytes: from the prepared cache, else prepared now and kept */
async function buildingBytes(x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer> {
  try {
    const hit = await (await caches.open(CELL_CACHE)).match(cellCacheUrl(self.location.origin, x, y));
    if (hit) return await hit.arrayBuffer();
  } catch {
    /* no Cache Storage */
  }
  const P = await buildingCell(x, y, signal);
  await keep(CELL_CACHE, cellCacheUrl(self.location.origin, x, y), P.buf);
  return P.buf;
}

/** a street cell: its z 14 roads' tile, the four building cells under it, its four street cells prepared and kept, the asked one */
async function streetCell(x: number, y: number, signal: AbortSignal): Promise<{ buf: ArrayBuffer; kept: number }> {
  const x14 = x >> 1,
    y14 = y >> 1;
  const r = await fetch(streetRoadsUrl(x, y), { signal });
  const roads = r.status === 404 || r.status === 204 ? new ArrayBuffer(0) : r.ok ? await r.arrayBuffer() : null;
  if (!roads) throw new Error(`roads ${x14}/${y14}: HTTP ${r.status}`);
  const quads = [0, 1, 2, 3].map((k) => [x14 * 2 + (k % 2), y14 * 2 + Math.floor(k / 2)] as const);
  const built = new Map<string, ArrayBuffer>();
  for (const [cx, cy] of quads) built.set(`${cx}/${cy}`, await buildingBytes(cx, cy, signal));
  // (the roads' revision: the response's Last-Modified day, else none)
  const lm = Date.parse(r.headers.get("last-modified") ?? "");
  const day = Number.isFinite(lm) ? Number(new Date(lm).toISOString().slice(0, 10).replaceAll("-", "")) : 0;
  const cells = prepareStreetCells(roads, x14, y14, (cx, cy) => built.get(`${cx}/${cy}`) ?? null, day);
  for (const c of cells) await keep(STREET_CACHE, streetCacheUrl(self.location.origin, c.x, c.y), c.buf);
  const mine = cells.find((c) => c.x === x && c.y === y)!;
  return { buf: mine.buf, kept: mine.lamps.length + mine.pieces.length };
}
