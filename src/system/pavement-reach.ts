// A town street's pavements out to its façades (25 Nov 2026; PROBLEMES « Ponts et routes, campagne e2e 2 »: the relief's grass and
// photograph showed between a kerbed road's pavement — PAVEMENT_M by its class, 2–3 m — and the buildings along it, a green strip
// against the façades of Paris). The street cells carry a carriageway's width and a class's pavement, not where the buildings stand;
// the scene holds both (scenery-worker.ts: its cell roads, its footprints' grids): each kerbed segment's record is widened to the
// façades beside it — the median, over points along it, of the nearest footprint edge met across it on either side —, within a
// bound (a square, a park, a forecourt stays the ground's). Pure: the worker gives the segments and a footprint lookup.
import type { Primitive } from "./scenery-data";

/** the widest pavement a façade draws out [m] beyond the carriageway (a boulevard's ~6–8 m) */
export const PAVEMENT_REACH_MAX_M = 8;
/** points along a segment, at most, and their spacing [m] at least */
const SAMPLES = 9;
const STEP_M = 1.5;

/** Where a ray from p along u (unit) first crosses one of a polygon primitive's edges, within `limit` [m]; Infinity none. */
function rayToEdges(p: [number, number], u: [number, number], poly: Primitive, limit: number): number {
  const v = poly.data;
  const end = Math.min(v.length, 12 + 4 * v[2]!);
  let best = Infinity;
  for (let i = 12; i < end; i += 4) {
    const ax = v[i]!,
      ay = v[i + 1]!,
      ex = v[i + 2]! - ax,
      ey = v[i + 3]! - ay;
    const den = u[0] * ey - u[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const wx = ax - p[0],
      wy = ay - p[1];
    const t = (wx * ey - wy * ex) / den;
    const s = (wx * u[1] - wy * u[0]) / den;
    if (t > 0 && t < limit && t < best && s >= 0 && s <= 1) best = t;
  }
  return best;
}

/**
 * The half-width a kerbed segment's record should take to meet the façades beside it [m], or null to keep its own: its axis a → b,
 * its carriageway's half-width `r` and its record's `R` (r + the class's pavement); `near(x0, y0, x1, y1)` the footprints about a box.
 * Each point along it casts across, both ways, to the nearest footprint edge within r + PAVEMENT_REACH_MAX_M; with half its points or
 * more meeting one, their median — widened only (a façade nearer than R keeps R), at most r + PAVEMENT_REACH_MAX_M.
 */
export function facadeReach(
  a: readonly [number, number],
  b: readonly [number, number],
  r: number,
  R: number,
  near: (x0: number, y0: number, x1: number, y1: number) => readonly Primitive[],
): number | null {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 0.5) return null;
  const u: [number, number] = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: [number, number] = [-u[1], u[0]];
  const limit = r + PAVEMENT_REACH_MAX_M;
  const polys = near(
    Math.min(a[0], b[0]) - limit,
    Math.min(a[1], b[1]) - limit,
    Math.max(a[0], b[0]) + limit,
    Math.max(a[1], b[1]) + limit,
  );
  if (!polys.length) return null;
  const k = Math.max(2, Math.min(SAMPLES, Math.floor(L / STEP_M) + 1));
  const hits: number[] = [];
  for (let i = 0; i < k; i++) {
    // (inside the segment, off its ends: a junction's corner building is the cross street's)
    const f = (i + 0.5) / k;
    const p: [number, number] = [a[0] + u[0] * L * f, a[1] + u[1] * L * f];
    let d = Infinity;
    for (const poly of polys) {
      d = Math.min(d, rayToEdges(p, n, poly, limit), rayToEdges(p, [-n[0], -n[1]], poly, limit));
    }
    if (d < Infinity) hits.push(d);
  }
  if (hits.length * 2 < k) return null;
  hits.sort((x, y) => x - y);
  const m = hits[Math.floor(hits.length / 2)]!;
  if (m <= R + 0.05) return null;
  return Math.min(m, limit);
}

/** A kerbed segment record (cell-roads.ts cellRoadSurfaces: data[6] its word — 8 the kerb, 32768 a bridge's —, data[7] ± its
 *  carriageway's half-width) widened to `R` [m]: its half-width and its box. */
export function widenRecord(p: Primitive, R: number) {
  const d = p.data;
  d[4] = R;
  p.min[0] = Math.min(d[0]!, d[2]!) - R;
  p.min[1] = Math.min(d[1]!, d[3]!) - R;
  p.max[0] = Math.max(d[0]!, d[2]!) + R;
  p.max[1] = Math.max(d[1]!, d[3]!) + R;
}

/** Whether a scene surface is a kerbed road off any bridge — its pavements drawn (trace.wgsl scenerySurface: kind 1, flag 8). */
export function kerbedRoad(p: Primitive): boolean {
  const d = p.data;
  if (d[5] !== 1 || d.length !== 12) return false;
  const word = d[6]! | 0;
  return (word & 8) !== 0 && (word & 32768) === 0 && d[7] !== 0;
}
