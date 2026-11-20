// PLAN-J8 J8-8b lot (2) — the near scene's forest assembled from its prepared cells (kerr-forest-v1, forest-cells.ts — the approaches
// session's lot (1)) instead of decided case by case (forest.ts growForest): the z 15 cells under the scene's forest frame read (Cache
// Storage — FOREST_CACHE, any generation: the zone's or the pool's), each one's words copied into a grid aligned on the frame — only the
// cases it owns (their centre, unjittered, within its tile: no double where two windows overlap) —; growForest then takes a covered case's
// word (its land cover's class and its measured canopy — the draw, the cover, the canopy and the data's exclusions applied at its
// preparation) and decides only what hangs on the scene: the live exclusions (sceneryExcluded), the ground, the cliff, the kind, the height,
// the foot. A case no cell covers (a cell missing) is decided as before. Pure but for `read`: the worker and the tests share it.
import { CELL_Z, cellBounds, cellOf, FOREST_NEAR_M } from "./building-cells";
import { cellPriority, type EyeState } from "./building-layer";
import type { CellWant } from "./cell-pool";
import { forestColumn, type ForestFrame, forestJitter, forestPlaceOf } from "./forest";
import { ForestCellFlag, forestWords, readForestHeader } from "./forest-cells";

/** the frame's cases from prepared cells: covered (1) or not (0), and a covered one's word (0: no tree there) */
export interface PreparedForest {
  covered: Uint8Array;
  words: Uint16Array;
  /** the z 15 cells read, those missing (no prepared cell: their cases decided as before) */
  cells: number;
  missing: number;
  /** of the cells found, those left to the scene: made without the canopy while the scene has it (their cases decided as before) */
  noCanopy: number;
  /** the frame's cases covered */
  cases: number;
  /** every planting position in the scene's disc is covered */
  complete: boolean;
}

/**
 * The frame's prepared cases: the z 15 cells under it read with `read` (null: none prepared), their words in the frame's grid. Null when
 * the frame is empty. A cell's window across two bands: its window of the frame's band alone (the other band's grid is another).
 */
export async function preparedForest(
  f: ForestFrame,
  read: (x: number, y: number) => Promise<ArrayBuffer | null>,
  /** the scene has the survey's canopy (IGN): a cell made without it is left out — its town's trees are the canopy's (Paris: half
   *  the scene's trees, 17 Nov 2026 — the forest pool's cells, prepared outside a zone, have none) */
  sceneCanopy = false,
): Promise<PreparedForest | null> {
  if (f.w <= 0 || f.h <= 0) return null;
  const covered = new Uint8Array(f.w * f.h);
  const words = new Uint16Array(f.w * f.h);
  // (the frame's corners: its south-west case's corner, its north-east one's — the grid's y northwards)
  const [s, w] = forestPlaceOf(f.i0, f.j0, f.columns);
  const [n, e] = forestPlaceOf(f.i0 + f.w, f.j0 + f.h, f.columns);
  const sw = cellOf(s, w),
    ne = cellOf(n, e);
  let cells = 0,
    missing = 0,
    noCanopy = 0,
    cases = 0;
  const C = f.columns;
  for (let y = ne.y; y <= sw.y; y++)
    for (let x = sw.x; x <= ne.x; x++) {
      const buf = await read(x, y);
      const h = buf ? readForestHeader(buf) : null;
      if (!buf || !h) {
        missing++;
        continue;
      }
      if (sceneCanopy && !(h.flags & ForestCellFlag.Canopy)) {
        noCanopy++;
        continue;
      }
      cells++;
      const b = cellBounds(x, y);
      const views = forestWords(buf, h);
      for (const [k, win] of h.windows.entries()) {
        if (win.columns !== C) continue;
        const v = views[k]!;
        // (the cases this cell owns: their centre within its tile — per row its latitude, per column its longitude)
        const rowIn = new Uint8Array(win.h),
          colIn = new Uint8Array(win.w);
        for (let r = 0; r < win.h; r++) {
          const lat = forestPlaceOf(0, win.gj0 + r + 0.5, C)[0];
          rowIn[r] = lat >= b.south && lat < b.north ? 1 : 0;
        }
        for (let c = 0; c < win.w; c++) {
          let lon = forestPlaceOf(win.gi0 + c + 0.5, 0, C)[1];
          lon = ((((lon + 180) % 360) + 360) % 360) - 180;
          colIn[c] = lon >= b.west && lon < b.east ? 1 : 0;
        }
        for (let r = 0; r < win.h; r++) {
          if (!rowIn[r]) continue;
          const j = win.gj0 + r - f.j0;
          if (j < 0 || j >= f.h) continue;
          for (let c = 0; c < win.w; c++) {
            if (!colIn[c]) continue;
            const i = ((((win.gi0 + c - f.i0) % C) + C) % C) | 0;
            if (i >= f.w) continue;
            const at = j * f.w + i;
            if (!covered[at]) cases++;
            covered[at] = 1;
            words[at] = v[r * win.w + c]!;
          }
        }
      }
    }
  // The grid is rectangular, but growForest only plants inside the disc. Missing corners
  // must not trigger a new building survey for trees that the scene will never consider.
  let complete = cases > 0;
  if (complete && cases < covered.length) {
    const [x0, xu, xv] = f.c;
    const [y0, yu, yv] = f.d;
    const reach2 = f.reach * f.reach;
    scan: for (let j = 0; j < f.h; j++) {
      for (let i = 0; i < f.w; i++) {
        if (covered[j * f.w + i]) continue;
        const [jx, jy] = forestJitter(forestColumn(f, i), f.j0 + j);
        const u = i + jx;
        const v = j + jy;
        const x = x0 + xu * u + xv * v;
        const y = y0 + yu * u + yv * v;
        if (x * x + y * y <= reach2) {
          complete = false;
          break scan;
        }
      }
    }
  }
  return { covered, words, cells, missing, noCanopy, cases, complete };
}

/**
 * The forest cells the scene will want around the eye (the forest pool's want — cell-workers.ts forestPool): those within `reachM`
 * (FOREST_NEAR_M: the scene plants within its box + 250 m), in the building cells' order (building-layer.ts cellPriority).
 */
export function forestWants(eye: EyeState, reachM = FOREST_NEAR_M): CellWant[] {
  const c = cellOf(eye.lat, eye.lon);
  const side = (40075016 * Math.cos((eye.lat * Math.PI) / 180)) / 2 ** CELL_Z;
  const k = Math.ceil(reachM / side) + 1;
  const n = 2 ** CELL_Z;
  const list: CellWant[] = [];
  for (let j = -k; j <= k; j++)
    for (let i = -k; i <= k; i++) {
      const x = (((c.x + i) % n) + n) % n,
        y = c.y + j;
      if (y < 0 || y >= n) continue;
      const [priority, d] = cellPriority(x, y, eye);
      if (d <= reachM) list.push({ x, y, priority: priority as CellWant["priority"], d });
    }
  return list;
}
