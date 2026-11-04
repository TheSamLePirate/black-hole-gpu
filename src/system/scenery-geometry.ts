import type { Vec3 } from "../physics";
import type { Primitive } from "./scenery-data";

export function roadWidth(cls: string, subclass = "") {
  if (cls === "motorway") return 18;
  if (cls === "trunk") return 14;
  if (cls === "primary") return 11;
  if (cls === "secondary") return 9;
  if (cls === "tertiary") return 7;
  if (cls === "minor") return 6;
  if (cls === "service") return 4;
  if (cls === "rail") return 3;
  return subclass === "pedestrian" ? 4 : 2;
}
export function surfaceSegment(a: Vec3, b: Vec3, width: number, kind: number, color: number[]): Primitive {
  const r = width / 2;
  return {
    min: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, 0],
    max: [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, 0],
    data: [a[0], a[1], b[0], b[1], r, kind, 0, 0, ...color, 0],
  };
}
export function polygonPrimitive(rings: Vec3[][], bottom: number, top: number, kind: number, color: number[]): Primitive | null {
  const edges: number[] = [];
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const ring of rings)
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!,
        b = ring[i + 1]!;
      edges.push(a[0], a[1], b[0], b[1]);
      x0 = Math.min(x0, a[0], b[0]);
      y0 = Math.min(y0, a[1], b[1]);
      x1 = Math.max(x1, a[0], b[0]);
      y1 = Math.max(y1, a[1], b[1]);
    }
  if (!edges.length) return null;
  return {
    min: [x0, y0, bottom],
    max: [x1, y1, top],
    data: [bottom, top, edges.length / 4, kind, x0, y0, x1, y1, ...color, (rings[0]?.length ?? 1) - 1, ...edges],
  };
}
// Analytic strip footprint, shared by bridge decks and parapets; no per-frame mesh work.
export function stripPolygon(a: Vec3, b: Vec3, width: number, offset = 0): Vec3[] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = -(b[1] - a[1]) / Math.max(length, 1e-6),
    ny = (b[0] - a[0]) / Math.max(length, 1e-6);
  const p = (v: Vec3, side: number): Vec3 => [v[0] + nx * (offset + (side * width) / 2), v[1] + ny * (offset + (side * width) / 2), 0];
  return [p(a, -1), p(b, -1), p(b, 1), p(a, 1), p(a, -1)];
}
export function surfaceContains(p: Vec3, primitive: Primitive, margin = 0) {
  // (outside its box with the margin: no — a large water or paved polygon, up to 4 096 points, listed in every 64 m cell it
  // touches, was walked edge by edge for each of the forest's ~2 M cells round it; a segment's box holds its width)
  if (
    p[0] < primitive.min[0] - margin ||
    p[1] < primitive.min[1] - margin ||
    p[0] > primitive.max[0] + margin ||
    p[1] > primitive.max[1] + margin
  )
    return false;
  const v = primitive.data;
  if (v[5]! < 4 && v.length === 12) {
    const x = v[2]! - v[0]!,
      y = v[3]! - v[1]!;
    const t = Math.max(0, Math.min(1, ((p[0] - v[0]!) * x + (p[1] - v[1]!) * y) / Math.max(x * x + y * y, 1e-8)));
    return Math.hypot(p[0] - v[0]! - t * x, p[1] - v[1]! - t * y) < v[4]! + margin;
  }
  let inside = false;
  for (let i = 12; i < v.length; i += 4) {
    if (margin > 0) {
      const dx = v[i + 2]! - v[i]!,
        dy = v[i + 3]! - v[i + 1]!;
      const t = Math.max(0, Math.min(1, ((p[0] - v[i]!) * dx + (p[1] - v[i + 1]!) * dy) / Math.max(dx * dx + dy * dy, 1e-8)));
      if ((p[0] - v[i]! - t * dx) ** 2 + (p[1] - v[i + 1]! - t * dy) ** 2 < margin * margin) return true;
    }
    if (v[i + 1]! > p[1] !== v[i + 3]! > p[1] && p[0] < v[i]! + ((p[1] - v[i + 1]!) * (v[i + 2]! - v[i]!)) / (v[i + 3]! - v[i + 1]!))
      inside = !inside;
  }
  return inside;
}

/** Q3 B4 — the decals' grids (scenery-data.ts packScenery: after the land cover's raster): the near one 2 m a texel over ±800 m
 *  round the scene's centre, the far one 8 m over ±3.2 km */
export const DECAL_NEAR = { half: 800, texel: 2 } as const;
export const DECAL_FAR = { half: 3200, texel: 8 } as const;
export interface Decals {
  near: Uint8Array;
  far: Uint8Array;
  /** 256 entries, rgb and a 0 each (entry 0: none) */
  palette: Float32Array;
}

/**
 * Q3 B4 — the map's surfaces drawn once on a grid of `texel` metres over ±`half` round the scene's centre (its frame's east,
 * north): each texel the palette's index of the surface over its centre as the tracer's scenerySurface ranks them — a polygon
 * (a field, a car park) 1, a road 2, a rail 3, the highest kept — the water left to its own pass (0, none). Polygons filled by
 * rows (each row's edge crossings), segments by their box; a line narrower than half a texel drawn half a texel wide (a path
 * not lost between texels). The palette shared by the grids: `colour` returns an entry's index.
 */
export function rasterDecals(surfaces: Primitive[], half: number, texel: number, colour: (c: number[]) => number): Uint8Array {
  const N = Math.round((2 * half) / texel);
  const idx = new Uint8Array(N * N);
  const rank = new Uint8Array(N * N);
  const cell = (x: number) => (x + half) / texel - 0.5;
  const put = (i: number, j: number, r: number, c: number) => {
    const n = j * N + i;
    if (r >= rank[n]!) {
      rank[n] = r;
      idx[n] = c;
    }
  };
  for (const p of surfaces) {
    const v = p.data;
    const line = v.length === 12 && v[11]! < 0.5;
    const kind = line ? v[5]! : v[3]!;
    if (kind === 3 || kind === 4) continue;
    if (p.max[0] < -half || p.max[1] < -half || p.min[0] > half || p.min[1] > half) continue;
    const c = colour([v[8]!, v[9]!, v[10]!]);
    if (!c) continue;
    const j0 = Math.max(0, Math.ceil(cell(p.min[1]))),
      j1 = Math.min(N - 1, Math.floor(cell(p.max[1])));
    if (line) {
      const r = kind === 2 ? 3 : 2;
      const w = Math.max(v[4]!, 0.5 * texel);
      const i0 = Math.max(0, Math.ceil(cell(p.min[0]))),
        i1 = Math.min(N - 1, Math.floor(cell(p.max[0])));
      const x = v[2]! - v[0]!,
        y = v[3]! - v[1]!,
        ll = Math.max(x * x + y * y, 1e-8);
      for (let j = j0; j <= j1; j++) {
        const py = -half + (j + 0.5) * texel;
        for (let i = i0; i <= i1; i++) {
          const px = -half + (i + 0.5) * texel;
          const t = Math.max(0, Math.min(1, ((px - v[0]!) * x + (py - v[1]!) * y) / ll));
          if (Math.hypot(px - v[0]! - t * x, py - v[1]! - t * y) < w) put(i, j, r, c);
        }
      }
      continue;
    }
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const py = -half + (j + 0.5) * texel;
      xs.length = 0;
      for (let e = 12; e < v.length; e += 4)
        if (v[e + 1]! > py !== v[e + 3]! > py) xs.push(v[e]! + ((py - v[e + 1]!) * (v[e + 2]! - v[e]!)) / (v[e + 3]! - v[e + 1]!));
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(cell(xs[k]!))),
          i1 = Math.min(N - 1, Math.floor(cell(xs[k + 1]!)));
        for (let i = i0; i <= i1; i++) put(i, j, 1, c);
      }
    }
  }
  return idx;
}

/** The decals of the scene's surfaces: both grids, their palette (colours to 1/255, the nearest kept past 255 of them). */
export function makeDecals(surfaces: Primitive[]): Decals {
  const palette = new Float32Array(256 * 4);
  const seen = new Map<number, number>();
  let count = 0;
  const colour = (c: number[]) => {
    const q = c.map((x) => Math.round(Math.min(Math.max(x, 0), 1) * 255));
    const key = (q[0]! << 16) | (q[1]! << 8) | q[2]!;
    let k = seen.get(key);
    if (k !== undefined) return k;
    if (count < 255) {
      k = ++count;
      palette.set([q[0]! / 255, q[1]! / 255, q[2]! / 255, 0], 4 * k);
    } else {
      let best = Number.POSITIVE_INFINITY;
      k = 1;
      for (let e = 1; e <= 255; e++) {
        const d =
          (palette[4 * e]! * 255 - q[0]!) ** 2 + (palette[4 * e + 1]! * 255 - q[1]!) ** 2 + (palette[4 * e + 2]! * 255 - q[2]!) ** 2;
        if (d < best) [best, k] = [d, e];
      }
    }
    seen.set(key, k);
    return k;
  };
  const near = rasterDecals(surfaces, DECAL_NEAR.half, DECAL_NEAR.texel, colour);
  const far = rasterDecals(surfaces, DECAL_FAR.half, DECAL_FAR.texel, colour);
  return { near, far, palette };
}
