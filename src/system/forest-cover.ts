// PLAN-J8 J8-8b lot (1) — the land cover for a forest cell (forest-prep.ts), as the scene reads it (scenery-worker.ts `raster`): ESA
// WorldCover's fixed cells (scenery-sources.ts coverCells, coverUrl — Terrascope's WMS, colour-rendered, held by the zones), each
// decoded and its pixels' colours matched to the classes' palette (the nearest within a squared distance of 1 600; else 0, unknown), a
// place's class its pixel's. In a worker (OffscreenCanvas, createImageBitmap) — the cells' workers'.
import { COVER_CELL, COVER_ROWS, coverCells, coverUrl, coverWidth } from "./scenery-sources";

/** WorldCover's classes and their colours as Terrascope renders them (the scene's palette) */
export const COVER_PALETTE: readonly (readonly [number, number, number, number])[] = [
  [10, 0, 100, 0],
  [20, 255, 187, 34],
  [30, 255, 255, 76],
  [40, 240, 150, 255],
  [50, 250, 0, 0],
  [60, 180, 180, 180],
  [70, 240, 240, 240],
  [80, 0, 100, 200],
  [90, 0, 150, 160],
  [95, 0, 207, 117],
  [100, 250, 230, 160],
];
/** a colour's class (0: none within the palette's reach, or transparent) */
export function coverClass(r: number, g: number, b: number, a = 255): number {
  if (a < 200) return 0;
  let distance = Infinity,
    cls = 0;
  for (const c of COVER_PALETTE) {
    const d = (r - c[1]) ** 2 + (g - c[2]) ** 2 + (b - c[3]) ** 2;
    if (d < distance) {
      distance = d;
      cls = c[0];
    }
  }
  return distance < 1600 ? cls : 0;
}

/**
 * The land cover over a box [west, south, east, north] (°): its cells fetched (`fetchBytes`), decoded, classed; (lat, lon) → class.
 * A cell failed: its places 0 (no tree drawn by the cover; the canopy's where measured). Its failures counted.
 */
export async function loadCover(
  bounds: readonly [number, number, number, number],
  fetchBytes: (url: string) => Promise<ArrayBuffer>,
): Promise<{ at: (lat: number, lon: number) => number; failed: number }> {
  const cells = new Map<string, { west: number; south: number; w: number; classes: Uint8Array }>();
  let failed = 0;
  await Promise.all(
    coverCells(bounds).map(async (c) => {
      try {
        const bytes = await fetchBytes(coverUrl(false, c.col, c.row));
        const image = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        const w = coverWidth(c.row);
        if (image.width !== w || image.height !== COVER_ROWS) throw new Error(`cell ${image.width}×${image.height}`);
        const canvas = new OffscreenCanvas(w, COVER_ROWS);
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(image, 0, 0);
        image.close();
        const data = ctx.getImageData(0, 0, w, COVER_ROWS).data;
        const classes = new Uint8Array(w * COVER_ROWS);
        for (let i = 0; i < classes.length; i++)
          classes[i] = coverClass(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!, data[i * 4 + 3]!);
        cells.set(`${c.col}/${c.row}`, { west: c.west, south: c.south, w, classes });
      } catch {
        failed++;
      }
    }),
  );
  return {
    failed,
    at: (lat, lon) => {
      const col = Math.floor((lon + 180) / COVER_CELL),
        row = Math.floor(lat / COVER_CELL);
      const c = cells.get(`${col}/${row}`);
      if (!c) return 0;
      const px = Math.min(c.w - 1, Math.max(0, Math.floor(((lon - c.west) / COVER_CELL) * c.w))),
        py = Math.min(COVER_ROWS - 1, Math.max(0, Math.floor(((c.south + COVER_CELL - lat) / COVER_CELL) * COVER_ROWS)));
      return c.classes[py * c.w + px]!;
    },
  };
}
