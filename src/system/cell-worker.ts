// PLAN-J8 J8-3 — a building cells' worker (one of the pool's — cell-pool.ts, cell-workers.ts): a cell asked {id, x, y}, its BD TOPO
// z 15 tile fetched (through the Service Worker: its tiles' cache and its zones'), decoded into the contract's records (cell-prep.ts:
// no roof planned, no mesh), the bytes put in the prepared cache (Cache Storage, CELL_CACHE — never decoded again) and handed back
// (transferred). {cancel: id}: its fetch aborted. The geoid's grid given once at the start ({geoid}): the buildings' ground over the
// ellipsoid (CLAUDE.md, WGS84 everywhere).
import { bdtopoUrl } from "./bdtopo";
import { CELL_CACHE, cellCacheUrl } from "./cell-pool";
import { prepareBdtopoCell } from "./cell-prep";
import { geoidDeg, setGeoid } from "./geoid-grid";
import type { HeightMap } from "./heights-file";

type In = { geoid: HeightMap } | { id: number; x: number; y: number } | { cancel: number };
const g = self as unknown as { onmessage: (e: MessageEvent<In>) => void; postMessage: (m: unknown, t?: Transferable[]) => void };
const aborts = new Map<number, AbortController>();
let cache: Promise<Cache> | null = null;

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
    const r = await fetch(bdtopoUrl(m.x, m.y), { signal: abort.signal });
    // (no tile there — the sea, a border —: an empty cell, cached as such)
    const bytes = r.status === 404 || r.status === 204 ? new ArrayBuffer(0) : r.ok ? await r.arrayBuffer() : null;
    if (!bytes) throw new Error(`BD TOPO ${m.x}/${m.y}: HTTP ${r.status}`);
    const fetchMs = performance.now() - t0;
    const P = prepareBdtopoCell(bytes, m.x, m.y, (lat, lon) => geoidDeg(lat, lon));
    if (abort.signal.aborted) return;
    try {
      cache ??= caches.open(CELL_CACHE);
      await (await cache).put(cellCacheUrl(self.location.origin, m.x, m.y), new Response(P.buf.slice(0)));
    } catch {
      /* (no Cache Storage — a private window —: prepared each time, nothing else lost) */
    }
    g.postMessage({ id: m.id, buf: P.buf, ms: performance.now() - t0, fetchMs, prepMs: P.stats.ms, kept: P.stats.kept }, [P.buf]);
  } catch (err) {
    if (!abort.signal.aborted) g.postMessage({ id: m.id, error: String(err).slice(0, 300) });
  } finally {
    aborts.delete(m.id);
  }
};
