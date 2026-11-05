// Q8 D1 — the high-voltage lines' pylons (docs/progress/refraction-horizons/Q8.md, "D1"): Overture's base theme (its
// infrastructure layer's power_line: OpenStreetMap's power=line, ODbL) read round the scenery's centre — an OSM line's nodes are
// its towers, but the tiles' lines are simplified —, a pylon at each of its vertices and along its segments at its voltage's usual
// span (pylonSpan: plausible places, not surveyed), as tall as its voltage's towers usually
// are, its arms across the line. Their triangles go after the turbines' in the scenery's meshes (packScenery: PYLON_TAG), the
// raster's RASTER_CODE.pylon: meshFs leaves the lattice's gaps open near, its silhouette whole once a member is under a pixel;
// shadeLite paints them galvanised steel.

/** the lines read (63 kV and up: RTE's network; Enedis's 20 kV poles left out), the pylons kept round the centre [m], at most */
export const PYLON_MIN_VOLTS = 63000;
export const PYLON_REACH_M = 5000;
export const PYLON_MAX = 400;

export interface Pylon {
  x: number;
  y: number;
  /** its height [m] and the line's bearing there [rad, from the frame's x towards its y] */
  h: number;
  along: number;
}

/** a tower's height [m] by its line's voltage [V] (France's usual: 63–90 kV ~25 m, 225 kV ~38 m, 400 kV ~50 m) */
export function pylonHeight(volts: number): number {
  if (volts >= 380000) return 50;
  if (volts >= 200000) return 38;
  return 25;
}
/** the usual span between two towers [m] by voltage — the base theme's lines are simplified at its finest level (its vertices
 *  a few of the towers), so pylons are also set along each segment at this spacing: plausible places, not the surveyed ones */
export function pylonSpan(volts: number): number {
  if (volts >= 380000) return 450;
  if (volts >= 200000) return 350;
  return 250;
}
/** a line's highest voltage from its tags ("225000", "400000;225000") — 0 when none */
export function lineVolts(tags: Record<string, unknown>): number {
  return String(tags.voltage ?? "")
    .split(/[;,]/)
    .map((v) => Number.parseFloat(v))
    .filter((v) => Number.isFinite(v))
    .reduce((a, b) => Math.max(a, b), 0);
}

/**
 * A pylon's triangles in a frame whose x is east, y north, z up [m]: at (x, y) its foot at z0. A four-sided frustum from a
 * square base (a sixth of its height a side) to a narrow top, and three arms across the line at 62, 76 and 90 % of its height,
 * the lowest the widest.
 */
export function pylonMesh(p: Pylon, z0: number) {
  const positions: number[] = [],
    triangles: number[] = [];
  const ca = Math.cos(p.along),
    sa = Math.sin(p.along);
  // (local: a along the line, c across it, up)
  const v = (a: number, c: number, up: number) => {
    positions.push(p.x + ca * a - sa * c, p.y + sa * a + ca * c, z0 + up);
    return positions.length / 3 - 1;
  };
  const quad = (q: number, r: number, s: number, t: number) => triangles.push(q, r, s, q, s, t);
  const H = p.h,
    b = H / 12,
    t = Math.max(0.8, H / 45);
  const lo = [v(-b, -b, -0.5), v(b, -b, -0.5), v(b, b, -0.5), v(-b, b, -0.5)];
  const hi = [v(-t, -t, H), v(t, -t, H), v(t, t, H), v(-t, t, H)];
  for (let i = 0; i < 4; i++) quad(lo[i]!, lo[(i + 1) % 4]!, hi[(i + 1) % 4]!, hi[i]!);
  quad(hi[0]!, hi[1]!, hi[2]!, hi[3]!);
  // arms: flat boxes across the line
  const arm = (z: number, half: number) => {
    const d = 0.6,
      k = Array.from({ length: 8 }, (_, i) => v(i & 1 ? d : -d, i & 2 ? half : -half, z + (i & 4 ? 0.8 : 0)));
    quad(k[0]!, k[1]!, k[3]!, k[2]!);
    quad(k[4]!, k[6]!, k[7]!, k[5]!);
    quad(k[0]!, k[4]!, k[5]!, k[1]!);
    quad(k[2]!, k[3]!, k[7]!, k[6]!);
    quad(k[0]!, k[2]!, k[6]!, k[4]!);
    quad(k[1]!, k[5]!, k[7]!, k[3]!);
  };
  arm(0.62 * H, 0.3 * H);
  arm(0.76 * H, 0.24 * H);
  arm(0.9 * H, 0.18 * H);
  return { positions, triangles };
}

/** the conductors drawn within this of the centre [m] (past it, under a pixel's coverage and the haze), at most this many spans */
export const CABLE_REACH_M = 2500;
export const CABLE_SPANS_MAX = 200;
/** a conductor's width [m] (a 225–400 kV bundle's wires, seen together) and its sag over its span (the middle's drop) */
export const CABLE_WIDTH_M = 0.04;
export const CABLE_SAG = 0.025;

/**
 * The conductors between two consecutive pylons (their feet z0, z1): six — each arm's two ends — as catenaries (a parabola of
 * CABLE_SAG of the span at the middle), each point a pair of vertices at the same place (scenery-raster.ts meshVs widens the pair
 * to a pixel at least, along the frame's up; the even one down, the odd one up), 8 segments a conductor.
 */
export function cableMesh(a: Pylon, z0: number, b: Pylon, z1: number) {
  const positions: number[] = [],
    triangles: number[] = [];
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const tip = (p: Pylon, z: number, level: number, side: number): [number, number, number] => {
    const [hz, half] = level === 0 ? [0.62, 0.3] : level === 1 ? [0.76, 0.24] : [0.9, 0.18];
    const c = side * (half * p.h - 0.3);
    return [p.x - Math.sin(p.along) * c, p.y + Math.cos(p.along) * c, z + hz * p.h];
  };
  const N = 8;
  for (let level = 0; level < 3; level++)
    for (const side of [-1, 1]) {
      const A = tip(a, z0, level, side),
        // (the far pylon's same side: its across turned as the line turns, not flipped)
        sameSide = Math.cos(b.along - a.along) >= 0 ? side : -side,
        B = tip(b, z1, level, sameSide);
      const first = positions.length / 3;
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const x = A[0] + (B[0] - A[0]) * s,
          y = A[1] + (B[1] - A[1]) * s,
          z = A[2] + (B[2] - A[2]) * s - CABLE_SAG * L * 4 * s * (1 - s);
        positions.push(x, y, z, x, y, z);
      }
      for (let i = 0; i < N; i++) {
        const k = first + 2 * i;
        triangles.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  return { positions, triangles };
}
