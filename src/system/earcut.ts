// A polygon's triangles by ear clipping (its holes bridged to its outer ring first): the buildings' roof faces and caps for
// the raster (roof-mesh.ts). Small polygons — a roof face, a courtyard block's cap: a few hundred corners at most —, so
// O(n²) is fine; a polygon it cannot finish (self-touching, degenerate) ends in a fan of what is left.

type Pt = [number, number];
const area2 = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function signedArea(r: Pt[]) {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!,
      b = r[(i + 1) % r.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
const inTriangle = (p: Pt, a: Pt, b: Pt, c: Pt) => area2(a, b, p) >= 0 && area2(b, c, p) >= 0 && area2(c, a, p) >= 0;
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const d1 = area2(c, d, a),
    d2 = area2(c, d, b),
    d3 = area2(a, b, c),
    d4 = area2(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * The triangles of a polygon: `rings` its outer ring then its holes (open or closed, any orientation); the result indices
 * into `points` — every ring's points in order, the outer first (a closing duplicate dropped) — three a triangle,
 * anticlockwise.
 */
export function earcut(rings: Pt[][]): { points: Pt[]; triangles: number[] } {
  const open = rings
    .map((r) => (r.length > 1 && r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1] ? r.slice(0, -1) : r.slice()))
    .filter((r) => r.length >= 3);
  const points: Pt[] = [];
  const triangles: number[] = [];
  if (!open.length) return { points, triangles };
  // (indices: the outer anticlockwise, the holes clockwise)
  const idx: number[][] = [];
  for (const [k, r] of open.entries()) {
    const at = points.length;
    points.push(...r);
    let ids = r.map((_, i) => at + i);
    const ccw = signedArea(r) > 0;
    if ((k === 0) !== ccw) ids = ids.reverse();
    idx.push(ids);
  }
  let poly = idx[0]!;
  // (each hole bridged from its rightmost corner to an outer corner it sees — the holes rightmost first)
  const holes = idx.slice(1).sort((p, q) => Math.max(...q.map((i) => points[i]![0])) - Math.max(...p.map((i) => points[i]![0])));
  for (const h of holes) {
    let m = 0;
    for (let i = 1; i < h.length; i++) if (points[h[i]!]![0] > points[h[m]!]![0]) m = i;
    const M = points[h[m]!]!;
    // (the outer corner nearest the hole's that the segment to it crosses no edge of the polygon or of the holes left)
    const blockers = [poly, ...holes.filter((o) => o !== h)];
    let best = -1,
      bestD = Infinity;
    for (let j = 0; j < poly.length; j++) {
      const P = points[poly[j]!]!;
      const d = (P[0] - M[0]) ** 2 + (P[1] - M[1]) ** 2 + (P[0] < M[0] ? 1e6 : 0);
      if (d >= bestD) continue;
      let clear = true;
      for (const ring of blockers) {
        for (let e = 0; e < ring.length && clear; e++) {
          const A = points[ring[e]!]!,
            B = points[ring[(e + 1) % ring.length]!]!;
          if (segmentsCross(M, P, A, B)) clear = false;
        }
        if (!clear) break;
      }
      for (let e = 0; e < h.length && clear; e++) {
        const A = points[h[e]!]!,
          B = points[h[(e + 1) % h.length]!]!;
        if (segmentsCross(M, P, A, B)) clear = false;
      }
      if (clear) {
        best = j;
        bestD = d;
      }
    }
    if (best < 0) continue;
    const hole = [...h.slice(m), ...h.slice(0, m + 1)];
    poly = [...poly.slice(0, best + 1), ...hole, ...poly.slice(best)];
  }
  // (the ears clipped)
  const v = poly.slice();
  let guard = 0;
  while (v.length > 3 && guard++ < 4 * poly.length * poly.length) {
    let cut = false;
    for (let i = 0; i < v.length; i++) {
      const a = v[(i + v.length - 1) % v.length]!,
        b = v[i]!,
        c = v[(i + 1) % v.length]!;
      const A = points[a]!,
        B = points[b]!,
        C = points[c]!;
      const s = area2(A, B, C);
      if (s <= 1e-12) {
        // (a straight or folded corner: dropped when it has no area)
        if (Math.abs(s) <= 1e-12) {
          v.splice(i, 1);
          cut = true;
          break;
        }
        continue;
      }
      let ear = true;
      for (const o of v) {
        if (o === a || o === b || o === c) continue;
        const P = points[o]!;
        // (a bridge's two copies of a corner are the same point: on the ear's corner, not in it)
        if ((P[0] === A[0] && P[1] === A[1]) || (P[0] === B[0] && P[1] === B[1]) || (P[0] === C[0] && P[1] === C[1])) continue;
        if (inTriangle(P, A, B, C)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      triangles.push(a, b, c);
      v.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  // (what is left: a fan — the last triangle, or a polygon the clipping could not finish)
  for (let i = 1; i + 1 < v.length; i++)
    if (area2(points[v[0]!]!, points[v[i]!]!, points[v[i + 1]!]!) > 1e-12) triangles.push(v[0]!, v[i]!, v[i + 1]!);
  return { points, triangles };
}
