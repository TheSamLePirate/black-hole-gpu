// A building as triangles (docs/PLAN-BATIMENTS-AAA.md B2): its walls from its footprint's edges up to its roof, its roof's
// faces — the footprint cut where each plane is the lowest (roofs.ts: z = min of the planes) —, for the raster (the
// buildings' visibility and their shadow map, scenery-raster.ts). The tracer tests the same solid exactly from the leaf's
// edges and planes (trace.wgsl sceneryQuery): the two agree.

import { earcut } from "./earcut";
import type { Plane, Pt } from "./roofs";

export interface BuildingMesh {
  /** x, y, z a vertex (the scenery's local metres) */
  positions: number[];
  /** three vertex indices a triangle */
  triangles: number[];
}

/** a ring (open) cut to the half-plane a·x + b·y + c ≤ 0 (Sutherland–Hodgman) */
function clipHalf(ring: Pt[], a: number, b: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!,
      q = ring[(i + 1) % ring.length]!;
    const dp = a * p[0] + b * p[1] + c,
      dq = a * q[0] + b * q[1] + c;
    if (dp <= 0) out.push(p);
    if (dp <= 0 !== dq <= 0) {
      const t = dp / (dp - dq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}
const z = (pl: Plane, x: number, y: number) => pl[0] * x + pl[1] * y + pl[2];
const area = (r: Pt[]) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i]![0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * r[i]![1];
  return s / 2;
};

/**
 * The mesh of a building: `rings` its footprint (outer then courtyards, open or closed, local metres), `bottom` its walls'
 * foot and `base` the height its planes are over (both local z), `planes` its roof's. Vertices shared where they meet
 * (to the millimetre): a wall's top corner is its roof face's.
 */
export function buildingMesh(rings: Pt[][], bottom: number, base: number, planes: Plane[]): BuildingMesh {
  const positions: number[] = [],
    triangles: number[] = [];
  const ids = new Map<string, number>();
  const vertex = (x: number, y: number, h: number) => {
    const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(h * 1000)}`;
    let i = ids.get(k);
    if (i === undefined) {
      i = positions.length / 3;
      positions.push(x, y, h);
      ids.set(k, i);
    }
    return i;
  };
  const open = rings
    .map((r) => (r.length > 1 && r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1] ? r.slice(0, -1) : r.slice()))
    .filter((r) => r.length >= 3);
  if (!open.length || !planes.length) return { positions, triangles };
  const roof = (x: number, y: number) => {
    let m = Infinity;
    for (const p of planes) m = Math.min(m, z(p, x, y));
    return base + m;
  };

  // ---- the roof's faces: each plane where it is the lowest (ties to the first), the courtyards cut out
  for (let i = 0; i < planes.length; i++) {
    const pi = planes[i]!;
    const cut = (r: Pt[]) => {
      let out = r;
      for (let j = 0; j < planes.length && out.length >= 3; j++) {
        if (j === i) continue;
        const pj = planes[j]!;
        // (pi ≤ pj, strictly below the planes before it: a shared region drawn once)
        const eps = j < i ? 1e-6 : -1e-6;
        out = clipHalf(out, pi[0] - pj[0], pi[1] - pj[1], pi[2] - pj[2] + eps);
      }
      return out;
    };
    const outer = cut(open[0]!);
    if (outer.length < 3 || Math.abs(area(outer)) < 1e-3) continue;
    const holes = open
      .slice(1)
      .map(cut)
      .filter((h) => h.length >= 3 && Math.abs(area(h)) > 1e-3);
    const t = earcut([outer, ...holes]);
    const at = t.points.map((p) => vertex(p[0], p[1], base + z(pi, p[0], p[1])));
    for (let k = 0; k < t.triangles.length; k += 3)
      triangles.push(at[t.triangles[k]!]!, at[t.triangles[k + 1]!]!, at[t.triangles[k + 2]!]!);
  }

  // ---- the walls: an edge cut where the roof above it changes plane (a gable's peak), a quad a piece
  for (const ring of open)
    for (let e = 0; e < ring.length; e++) {
      const a = ring[e]!,
        b = ring[(e + 1) % ring.length]!;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4) continue;
      // (the planes along the edge, lines in t; where two cross within it, a break — kept where the lowest changes)
      const lines = planes.map((p) => [z(p, a[0], a[1]), z(p, b[0], b[1]) - z(p, a[0], a[1])] as const);
      const ts = [0, 1];
      for (let i = 0; i < lines.length; i++)
        for (let j = i + 1; j < lines.length; j++) {
          const d = lines[i]![1] - lines[j]![1];
          if (Math.abs(d) < 1e-9) continue;
          const t = (lines[j]![0] - lines[i]![0]) / d;
          if (t > 1e-4 && t < 1 - 1e-4) ts.push(t);
        }
      ts.sort((p, q) => p - q);
      const at = (t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const lowest = (t: number) => {
        const p = at(t);
        let m = 0;
        for (let i = 1; i < planes.length; i++) if (z(planes[i]!, p[0], p[1]) < z(planes[m]!, p[0], p[1])) m = i;
        return m;
      };
      // (the breaks where the lowest plane is the same either side: not breaks)
      const kept = ts.filter((t, i) => i === 0 || i === ts.length - 1 || lowest((ts[i - 1]! + t) / 2) !== lowest((t + ts[i + 1]!) / 2));
      for (let i = 0; i + 1 < kept.length; i++) {
        const p = at(kept[i]!),
          q = at(kept[i + 1]!);
        const tp = Math.max(bottom, roof(p[0], p[1])),
          tq = Math.max(bottom, roof(q[0], q[1]));
        const p0 = vertex(p[0], p[1], bottom),
          q0 = vertex(q[0], q[1], bottom),
          q1 = vertex(q[0], q[1], tq),
          p1 = vertex(p[0], p[1], tp);
        triangles.push(p0, q0, q1, p0, q1, p1);
      }
    }
  return { positions, triangles };
}
