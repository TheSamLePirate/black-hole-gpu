// PLAN-J8 J8-7 — a building cell's source chosen and read in the cell worker (cell-worker.ts): the BD TOPO within the IGN's box, Overture
// Maps beyond it and wherever the BD TOPO has no building in the cell — the box is a rectangle (earth-tiles.ts ORTHO_BOX): Belgium,
// Luxembourg, Catalonia, Cornwall are in it, the BD TOPO empty there (Brussels' scenery drew none from it, 16 Nov 2026). Overture's
// z 14 tile (pmtiles.ts: its releases' listing, the latest answering, its byte ranges through the Service Worker) prepared into its four
// z 15 cells (cell-prep-overture.ts), the last few kept in memory: the next cell of the same tile not read again. Only the asked cell is
// handed and cached — a sibling in France is the BD TOPO's.
import { prepareOvertureCells } from "./cell-prep-overture";
import type { PreparedCell } from "./cell-prep";
import { fetchRange, OVERTURE_LIST, OVERTURE_Z, overtureReleases, overtureUrl, PmTiles } from "./pmtiles";

// (the IGN's box: bdtopo.ts — the zones read it too, without this module's decoding)
export { BDTOPO_BOX, inBdtopoBox } from "./bdtopo";
/** a fetch (the worker's own; the tests' fakes) — the archive keeps the first it is given: no cell's abort signal in it */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

let archive: Promise<{ pm: PmTiles; release: string }> | null = null;
/** the latest Overture release whose archive answers (the bucket keeps three) */
function overture(fetcher: Fetcher): Promise<{ pm: PmTiles; release: string }> {
  archive ??= (async () => {
    const list = await fetcher(OVERTURE_LIST);
    if (!list.ok) throw new Error(`HTTP ${list.status}: ${OVERTURE_LIST}`);
    let last: unknown = null;
    for (const release of overtureReleases(await list.text())) {
      const pm = new PmTiles(
        overtureUrl(release),
        fetchRange((u, i) => fetcher(u, i)),
      );
      try {
        await pm.header();
        return { pm, release };
      } catch (e) {
        last = e;
      }
    }
    throw new Error(`no Overture release answers: ${String(last).slice(0, 200)}`);
  })();
  // (a failure not kept: asked again at the next cell)
  archive.catch(() => {
    archive = null;
  });
  return archive;
}

const recent = new Map<string, Promise<PreparedCell[]>>();
const KEEP = 4;

/** an Overture z 14 tile's bytes (empty: none there) and the release they come from — PLAN-J8 J8-8: the mesh cells read it too */
export async function overtureTile(
  x14: number,
  y14: number,
  fetcher: Fetcher = (u, i) => fetch(u, i),
): Promise<{ raw: Uint8Array; release: string }> {
  const { pm, release } = await overture(fetcher);
  return { raw: (await pm.tile(OVERTURE_Z, x14, y14)) ?? new Uint8Array(0), release };
}

/** a z 15 cell from Overture (its z 14 tile's four prepared once, the last KEEP tiles kept) */
export async function overtureCell(x: number, y: number, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<PreparedCell> {
  const x14 = Math.floor(x / 2),
    y14 = Math.floor(y / 2);
  const k = `${x14}/${y14}`;
  let p = recent.get(k);
  if (!p) {
    p = (async () => {
      const { raw, release } = await overtureTile(x14, y14, fetcher);
      return prepareOvertureCells(raw, x14, y14, release);
    })();
    recent.set(k, p);
    p.catch(() => recent.delete(k));
    while (recent.size > KEEP) recent.delete(recent.keys().next().value!);
  }
  const cells = await p;
  return cells[(y % 2) * 2 + (x % 2)]!;
}
