// PLAN-J8 J8-8b lot (1) — a forest cell prepared (forest-cells.ts, kerr-forest-v1): the forest's world-fixed grid cells whose centres lie
// in a z 15 cell, each decided as growForest decides it before the ground (forest.ts: the same hashes — its draw, its jitter —, the land
// cover's density, the canopy where measured — CANOPY_MIN within its crown's reach, CANOPY_FILL, the water's class bare —, then the
// exclusions): a candidate's word its class and its canopy, the rest 0. The ground, the cliffs, the kind and the height stay the scene's,
// at the assembly (its relief, its frame), and the live exclusions (sceneryExcluded). Pure: the sources given as functions — the cells'
// workers bring the land cover, the canopy, the data's exclusions (forest-exclusions.ts).
import { cellBounds, CELL_Z } from "./building-cells";
import {
  CANOPY_FILL,
  CANOPY_MIN,
  FOREST_BAND,
  FOREST_MAX_LAT,
  FOREST_UNDERSTORY,
  forestCellOf,
  forestColumns,
  forestDensity,
  forestHash,
  forestJitter,
  forestPlaceOf,
  forestUnit,
} from "./forest";
import { encodeForestCell, type ForestWindow, forestWord } from "./forest-cells";

const R = 6378137;
const D = Math.PI / 180;

export interface ForestCellSources {
  /** the land cover's class at a place (ESA WorldCover: 10 … 100; 0 unknown) */
  cover(lat: number, lon: number): number;
  /** the survey's canopy [m]: its top within `r` metres of a place, NaN where it has none (ign-canopy.ts canopyNear) — none: the
   *  cover's draw everywhere */
  canopy?(lat: number, lon: number, r: number): number;
  /** a place no tree may stand on (the data's: a road, a river, a building — forest-exclusions.ts) */
  excluded(lat: number, lon: number): boolean;
}

export interface PreparedForestCell {
  buf: ArrayBuffer;
  stats: { cells: number; candidates: number; measured: number; excluded: number; ms: number };
}

/** the windows of the forest's grid a z 15 cell covers: one a band it meets (its rows within the band, its columns over the cell) */
export function forestWindows(x: number, y: number): ForestWindow[] {
  const b = cellBounds(x, y, CELL_Z);
  const lon0 = (b.west + b.east) / 2;
  const out: ForestWindow[] = [];
  // (the bands' boundaries within the cell: the multiples of FOREST_BAND between its south and north)
  const cuts = [b.south];
  for (let k = Math.ceil(b.south / FOREST_BAND); k * FOREST_BAND < b.north; k++) if (k * FOREST_BAND > b.south) cuts.push(k * FOREST_BAND);
  cuts.push(b.north);
  for (let k = 0; k + 1 < cuts.length; k++) {
    const s = cuts[k]!,
      n = cuts[k + 1]!;
    const columns = forestColumns((s + n) / 2);
    const [xw, ys] = forestCellOf(s, b.west, columns, lon0),
      [xe, yn] = forestCellOf(n, b.east, columns, lon0);
    const gi0 = Math.floor(xw),
      gj0 = Math.floor(ys);
    out.push({ columns, gi0, gj0, w: Math.ceil(xe) - gi0, h: Math.ceil(yn) - gj0 });
  }
  return out;
}

/**
 * A z 15 cell's forest: its windows' cells — those whose centres lie in the cell (and in the window's band) —, each a candidate's
 * word or 0. `generation` its sources'; `canopyRead` whether the canopy served it (the cell's flag, its key).
 */
export function prepareForestCell(
  x: number,
  y: number,
  io: ForestCellSources,
  generation: number,
  canopyRead: boolean,
): PreparedForestCell {
  const t0 = performance.now();
  const b = cellBounds(x, y, CELL_Z);
  const windows = forestWindows(x, y);
  const total = windows.reduce((s, w) => s + w.w * w.h, 0);
  const words = new Uint16Array(total);
  const stats = { cells: 0, candidates: 0, measured: 0, excluded: 0, ms: 0 };
  let at = 0;
  for (const w of windows) {
    // (the window's band: its rows' latitudes within it — a cell across a boundary owns each row once)
    const bandS = Math.floor(forestPlaceOf(w.gi0, w.gj0 + 0.5, w.columns)[0] / FOREST_BAND) * FOREST_BAND;
    // (a crown's reach is a share of the cell's ground side: forest.ts forestFrame's `cell` — here at the cell's latitude)
    const side = ((2 * Math.PI * R) / w.columns) * Math.cos(((b.north + b.south) / 2) * D);
    for (let j = 0; j < w.h; j++)
      for (let i = 0; i < w.w; i++, at++) {
        const gi = w.gi0 + i,
          gj = w.gj0 + j;
        // (its owner: the z 15 cell — and the band — holding its centre, unjittered)
        const [clat, clon] = forestPlaceOf(gi + 0.5, gj + 0.5, w.columns);
        const lonW = ((((clon + 180) % 360) + 360) % 360) - 180;
        if (clat < b.south || clat >= b.north || lonW < b.west || lonW >= b.east) continue;
        if (clat < bandS || clat >= bandS + FOREST_BAND) continue;
        if (Math.abs(clat) > FOREST_MAX_LAT) continue;
        stats.cells++;
        // (growForest's own: the global column wrapped for the hashes, the jittered place for the sources)
        const giw = ((gi % w.columns) + w.columns) % w.columns;
        const [jx, jy, size] = forestJitter(giw, gj);
        const [lat, lonU] = forestPlaceOf(gi + jx, gj + jy, w.columns);
        const lon = ((((lonU + 180) % 360) + 360) % 360) - 180;
        const cls = io.cover(lat, lon),
          draw = forestUnit(forestHash(giw, gj, 5));
        const mnh = io.canopy ? io.canopy(lat, lon, side * (0.3 + 0.17 * size)) : Number.NaN;
        if (
          Number.isFinite(mnh)
            ? mnh < CANOPY_MIN || draw >= CANOPY_FILL || cls === 80
            : draw >= (cls === 10 ? FOREST_UNDERSTORY : forestDensity(cls))
        )
          continue;
        if (io.excluded(lat, lon)) {
          stats.excluded++;
          continue;
        }
        words[at] = forestWord(cls, mnh);
        stats.candidates++;
        if (Number.isFinite(mnh)) stats.measured++;
      }
  }
  const buf = encodeForestCell({ z: CELL_Z, x, y, flags: canopyRead ? 1 : 0, generation, windows }, words);
  stats.ms = performance.now() - t0;
  return { buf, stats };
}
