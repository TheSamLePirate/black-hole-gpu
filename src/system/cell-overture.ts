// PLAN-J8 J8-7 — a building cell's source chosen and read in the cell worker (cell-worker.ts): the BD TOPO within the IGN's box, Overture
// Maps beyond it and wherever the BD TOPO has no building in the cell — the box is a rectangle (earth-tiles.ts ORTHO_BOX): Belgium,
// Luxembourg, Catalonia, Cornwall are in it, the BD TOPO empty there (Brussels' scenery drew none from it, 16 Nov 2026). Overture's
// z 14 tile (pmtiles.ts: its releases' listing, the latest answering, its byte ranges through the Service Worker) prepared into its four
// z 15 cells (cell-prep-overture.ts), the last few kept in memory: the next cell of the same tile not read again. Only the asked cell is
// handed and cached — a sibling in France is the BD TOPO's.
import { prepareOvertureCells } from "./cell-prep-overture";
import type { PreparedCell } from "./cell-prep";
import { fetchRange, OVERTURE_LIST, OVERTURE_Z, overtureReleases, overtureUrl, PmTiles } from "./pmtiles";

/** the IGN's box (earth-tiles.ts ORTHO_BOX — copied: that module is the renderer's, too heavy for a worker; tests/cell-overture.test.ts
 *  holds the two equal) */
export const BDTOPO_BOX = { west: -5.6, east: 9.8, south: 41.2, north: 51.2 } as const;
const D = Math.PI / 180;
/** a fetch (the worker's own; the tests' fakes) — the archive keeps the first it is given: no cell's abort signal in it */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** whether a z 15 cell's centre is in the IGN's box (the BD TOPO asked first) */
export function inBdtopoBox(x: number, y: number, z = OVERTURE_Z + 1): boolean {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) / D;
  return lon > BDTOPO_BOX.west && lon < BDTOPO_BOX.east && lat > BDTOPO_BOX.south && lat < BDTOPO_BOX.north;
}

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

/** a z 15 cell from Overture (its z 14 tile's four prepared once, the last KEEP tiles kept) */
export async function overtureCell(x: number, y: number, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<PreparedCell> {
  const x14 = Math.floor(x / 2),
    y14 = Math.floor(y / 2);
  const k = `${x14}/${y14}`;
  let p = recent.get(k);
  if (!p) {
    p = (async () => {
      const { pm, release } = await overture(fetcher);
      const raw = await pm.tile(OVERTURE_Z, x14, y14);
      return prepareOvertureCells(raw ?? new Uint8Array(0), x14, y14, release);
    })();
    recent.set(k, p);
    p.catch(() => recent.delete(k));
    while (recent.size > KEEP) recent.delete(recent.keys().next().value!);
  }
  const cells = await p;
  return cells[(y % 2) * 2 + (x % 2)]!;
}
