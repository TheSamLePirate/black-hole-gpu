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
