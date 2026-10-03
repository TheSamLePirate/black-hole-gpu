// Contact between rigid meshes, swept over a frame: a bounding volume hierarchy of triangles (median
// split on the longest axis, four triangles a leaf), segments cast against it — the first crossing,
// either face — and the vertices it holds within a sphere. The Ranger and the space station use it: the
// ship's hull points' paths against the station's parts, the station's vertices' paths against the hull
// (controls.ts: stationContact) — so that neither a beam through a wing nor a corner into a panel
// passes unseen.

import type { Vec3 } from "../physics";

export interface Hit {
  /** the crossing's fraction of the segment, and the triangle's unit normal (either side) */
  t: number;
  n: Vec3;
}

export class TriBVH {
  /** the vertices (x, y, z each) and the triangles (three vertex indices each) */
  readonly pos: Float32Array;
  readonly tri: Uint32Array;
  /** nodes: box (min xyz, max xyz); left child or first triangle; −count for leaves, else right child */
  private box: Float32Array;
  private link: Int32Array;
  private order: Uint32Array;
  private nNodes = 0;

  constructor(pos: Float32Array, tri: Uint32Array) {
    this.pos = pos;
    this.tri = tri;
    const nt = tri.length / 3;
    this.order = new Uint32Array(nt);
    for (let i = 0; i < nt; i++) this.order[i] = i;
    const cap = Math.max(1, 2 * nt);
    this.box = new Float32Array(cap * 6);
    this.link = new Int32Array(cap * 2);
    // the triangles' centres, for the splits
    const cen = new Float32Array(nt * 3);
    for (let i = 0; i < nt; i++) {
      for (let k = 0; k < 3; k++)
        cen[3 * i + k] = (pos[3 * tri[3 * i]! + k]! + pos[3 * tri[3 * i + 1]! + k]! + pos[3 * tri[3 * i + 2]! + k]!) / 3;
    }
    if (nt) this.build(0, nt, cen);
  }

  /** the whole mesh's box: min, max */
  bounds(): [Vec3, Vec3] {
    const b = this.box;
    return [
      [b[0]!, b[1]!, b[2]!],
      [b[3]!, b[4]!, b[5]!],
    ];
  }

  private build(a: number, b: number, cen: Float32Array): number {
    const node = this.nNodes++;
    const bx = this.box,
      p = this.pos,
      t = this.tri,
      o = this.order;
    let x0 = Infinity,
      y0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity,
      z1 = -Infinity;
    for (let i = a; i < b; i++) {
      for (let c = 0; c < 3; c++) {
        const v = 3 * t[3 * o[i]! + c]!;
        const x = p[v]!,
          y = p[v + 1]!,
          z = p[v + 2]!;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
    bx.set([x0, y0, z0, x1, y1, z1], node * 6);
    if (b - a <= 4) {
      this.link[2 * node] = a;
      this.link[2 * node + 1] = -(b - a);
      return node;
    }
    const ax = x1 - x0 >= y1 - y0 && x1 - x0 >= z1 - z0 ? 0 : y1 - y0 >= z1 - z0 ? 1 : 2;
    // (median split: a partial sort by the centres along that axis)
    const m = (a + b) >> 1;
    const sel = (lo: number, hi: number, k: number) => {
      while (hi > lo) {
        const pv = cen[3 * o[(lo + hi) >> 1]! + ax]!;
        let i = lo,
          j = hi;
        while (i <= j) {
          while (cen[3 * o[i]! + ax]! < pv) i++;
          while (cen[3 * o[j]! + ax]! > pv) j--;
          if (i <= j) {
            const s = o[i]!;
            o[i] = o[j]!;
            o[j] = s;
            i++;
            j--;
          }
        }
        if (k <= j) hi = j;
        else if (k >= i) lo = i;
        else return;
      }
    };
    sel(a, b - 1, m);
    const left = this.build(a, m, cen);
    const right = this.build(m, b, cen);
    this.link[2 * node] = left;
    this.link[2 * node + 1] = right;
    return node;
  }

  /** The first crossing of the segment o → e with a triangle (either face), or null. */
  segment(o: Vec3, e: Vec3): Hit | null {
    if (!this.nNodes) return null;
    const d: Vec3 = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
    const inv: Vec3 = [1 / (d[0] || 1e-30), 1 / (d[1] || 1e-30), 1 / (d[2] || 1e-30)];
    let best: Hit | null = null;
    let tMax = 1;
    const stack = [0];
    const bx = this.box,
      ln = this.link,
      p = this.pos,
      t = this.tri,
      ord = this.order;
    while (stack.length) {
      const n = stack.pop()!;
      // (the segment against the node's box: slabs)
      let t0 = 0,
        t1 = tMax;
      for (let k = 0; k < 3; k++) {
        let a = (bx[6 * n + k]! - o[k]!) * inv[k]!,
          b = (bx[6 * n + 3 + k]! - o[k]!) * inv[k]!;
        if (a > b) {
          const s = a;
          a = b;
          b = s;
        }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) break;
      }
      if (t0 > t1) continue;
      const c = ln[2 * n + 1]!;
      if (c >= 0) {
        stack.push(ln[2 * n]!, c);
        continue;
      }
      const first = ln[2 * n]!;
      for (let i = first; i < first - c; i++) {
        const q = ord[i]!;
        const A = 3 * t[3 * q]!,
          B = 3 * t[3 * q + 1]!,
          C = 3 * t[3 * q + 2]!;
        // (Möller–Trumbore)
        const e1x = p[B]! - p[A]!,
          e1y = p[B + 1]! - p[A + 1]!,
          e1z = p[B + 2]! - p[A + 2]!;
        const e2x = p[C]! - p[A]!,
          e2y = p[C + 1]! - p[A + 1]!,
          e2z = p[C + 2]! - p[A + 2]!;
        const hx = d[1] * e2z - d[2] * e2y,
          hy = d[2] * e2x - d[0] * e2z,
          hz = d[0] * e2y - d[1] * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-14) continue;
        const f = 1 / det;
        const sx = o[0] - p[A]!,
          sy = o[1] - p[A + 1]!,
          sz = o[2] - p[A + 2]!;
        const u = f * (sx * hx + sy * hy + sz * hz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y,
          qy = sz * e1x - sx * e1z,
          qz = sx * e1y - sy * e1x;
        const v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
        if (v < 0 || u + v > 1) continue;
        const tt = f * (e2x * qx + e2y * qy + e2z * qz);
        if (tt < 0 || tt > tMax) continue;
        let nx = e1y * e2z - e1z * e2y,
          ny = e1z * e2x - e1x * e2z,
          nz = e1x * e2y - e1y * e2x;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        tMax = tt;
        best = { t: tt, n: [nx, ny, nz] };
      }
    }
    return best;
  }

  /** The vertices of the triangles within the sphere's box (centre c, radius r): their indices. */
  verticesNear(c: Vec3, r: number): Set<number> {
    const out = new Set<number>();
    if (!this.nNodes) return out;
    const stack = [0];
    const bx = this.box,
      ln = this.link,
      t = this.tri,
      ord = this.order;
    while (stack.length) {
      const n = stack.pop()!;
      let away = false;
      for (let k = 0; k < 3; k++) if (c[k]! + r < bx[6 * n + k]! || c[k]! - r > bx[6 * n + 3 + k]!) away = true;
      if (away) continue;
      const ch = ln[2 * n + 1]!;
      if (ch >= 0) {
        stack.push(ln[2 * n]!, ch);
        continue;
      }
      const first = ln[2 * n]!;
      for (let i = first; i < first - ch; i++) for (let k = 0; k < 3; k++) out.add(t[3 * ord[i]! + k]!);
    }
    return out;
  }
}

/** A mesh's vertices thinned to one a cell of `cell` metres (the cell's first), as points. */
export function samplePoints(pos: Float32Array, stride: number, count: number, cell: number): Vec3[] {
  const seen = new Set<string>();
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const x = pos[i * stride]!,
      y = pos[i * stride + 1]!,
      z = pos[i * stride + 2]!;
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([x, y, z]);
  }
  return out;
}

/** A craft's hull for contacts (ship frame, metres): points a half metre apart (on the larger craft,
 *  coarser), its triangles, the sphere about its origin that holds it, its box. */
export interface Hull {
  points: Vec3[];
  bvh: TriBVH | null;
  radius: number;
  lo: Vec3;
  hi: Vec3;
}
const emptyHull = (): Hull => ({ points: [], bvh: null, radius: 0, lo: [0, 0, 0], hi: [0, 0, 0] });
/** The craft's hulls (vessels.ts), filled as their meshes load (ship.ts). */
export const vesselHulls: Record<"ranger" | "lander" | "endurance", Hull> = {
  ranger: emptyHull(),
  lander: emptyHull(),
  endurance: emptyHull(),
};
/** The Ranger's. */
export const rangerHull = vesselHulls.ranger;
/** The Ranger's cabin (ship frame, metres): its triangles — what the camera moving about it meets — and its box. */
export const cockpitHull: { bvh: TriBVH | null; lo: Vec3; hi: Vec3 } = { bvh: null, lo: [0, 0, 0], hi: [0, 0, 0] };

/** The space station's parts for contacts (their rest frame, metres): one hierarchy each (0: the
 *  station itself, k + 1: joint k's). */
export const stationHulls: (TriBVH | null)[] = [];
