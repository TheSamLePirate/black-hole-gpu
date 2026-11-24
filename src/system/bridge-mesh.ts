// A bridge's drawn parts (PLAN-PONT-ROUTES-AAA PR3; review A2/A9, 24 Nov 2026): its deck's slices between two stations of its
// profile (bridge-surface-service.ts — their tops the profile's `deckAt`, the same the contact's plane reads), its parapets' slices,
// its piers. Every face wound counter-clockwise seen from outside (x east, y north, z up: a right-handed frame) — the raster draws
// them with no culling today; the winding is kept right for a culled pipeline. Consecutive slices share their corners where the
// caller gives each station's mitred across-vector (`acrossA`, `acrossB`: the half-width offset to the left of the axis) — no crack
// at the polyline's bends.

import { BridgeFlag } from "./street-cells";

export interface BridgeMeshOutput {
  positions: number[];
  triangles: number[];
}

export interface DeckSliceParams {
  pa: [number, number, number];
  pb: [number, number, number];
  width: number;
  top0: number;
  top1: number;
  thick: number;
  isStart?: boolean;
  isEnd?: boolean;
  flags?: number;
  /** the half-width's offset to the left at each end (a mitre at a bend); default the slice's own normal × width / 2 */
  acrossA?: [number, number];
  acrossB?: [number, number];
}

export interface RailSliceParams {
  pa: [number, number, number];
  pb: [number, number, number];
  width: number;
  railW: number;
  railH: number;
  side: -1 | 1;
  top0: number;
  top1: number;
  isStart?: boolean;
  isEnd?: boolean;
  flags?: number;
  acrossA?: [number, number];
  acrossB?: [number, number];
}

export interface PierParams {
  p: [number, number, number];
  width: number;
  pierWidth: number;
  groundFooting: number;
  intradosTop: number;
  /** the bridge's axis there (unit, x y): the pier's length along it, its width across — the collision strip's (scenery-worker.ts) */
  axis?: [number, number];
  /** its half-length along the axis [m] (1 m: the strip's) */
  halfLength?: number;
}

/** the box's twelve triangles' faces by name, each CCW seen from outside — vertices: 0 top-right-A, 1 top-left-A, 2 top-left-B,
 *  3 top-right-B, 4–7 the same at the bottom ("left" = + across) */
const TOP = [0, 2, 1, 0, 3, 2];
const BOTTOM = [4, 5, 6, 4, 6, 7];
const RIGHT = [4, 7, 3, 4, 3, 0];
const LEFT = [5, 1, 2, 5, 2, 6];
const END_A = [4, 0, 1, 4, 1, 5];
const END_B = [7, 6, 2, 7, 2, 3];

/** the half-width's offset to the left of a → b */
const leftOf = (pa: [number, number, number], pb: [number, number, number], half: number): [number, number] => {
  const dx = pb[0] - pa[0],
    dy = pb[1] - pa[1];
  const L = Math.hypot(dx, dy) || 1;
  return [(-dy / L) * half, (dx / L) * half];
};

/**
 * A deck's slice between two stations: a prism, its top at top0 (at a) and top1 (at b) across its whole width — a plane (its corners
 * at a both top0, at b both top1): computeSlicePlane's, the contact's —, its intrados `thick` below. Its end faces only at a closed
 * abutment (not an open end, not between slices).
 */
export function buildContinuousSliceMesh(params: DeckSliceParams): BridgeMeshOutput {
  const { pa, pb, width, top0, top1, thick, isStart = false, isEnd = false, flags = 0 } = params;
  if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < 1e-6) return { positions: [], triangles: [] };
  const oa = params.acrossA ?? leftOf(pa, pb, width / 2),
    ob = params.acrossB ?? leftOf(pa, pb, width / 2);
  const bot0 = top0 - thick,
    bot1 = top1 - thick;
  // prettier-ignore
  const positions = [
    pa[0] - oa[0],
    pa[1] - oa[1],
    top0,
    pa[0] + oa[0],
    pa[1] + oa[1],
    top0,
    pb[0] + ob[0],
    pb[1] + ob[1],
    top1,
    pb[0] - ob[0],
    pb[1] - ob[1],
    top1,
    pa[0] - oa[0],
    pa[1] - oa[1],
    bot0,
    pa[0] + oa[0],
    pa[1] + oa[1],
    bot0,
    pb[0] + ob[0],
    pb[1] + ob[1],
    bot1,
    pb[0] - ob[0],
    pb[1] - ob[1],
    bot1,
  ];
  const triangles = [...TOP, ...BOTTOM, ...RIGHT, ...LEFT];
  if (isStart && !(flags & BridgeFlag.OpenA)) triangles.push(...END_A);
  if (isEnd && !(flags & BridgeFlag.OpenB)) triangles.push(...END_B);
  return { positions, triangles };
}

/** A parapet's slice along one edge of the deck (side +1 the left, −1 the right): from the deck's top to railH over it, railW wide,
 *  its outer face flush with the deck's edge. */
export function buildContinuousRailMesh(params: RailSliceParams): BridgeMeshOutput {
  const { pa, pb, width, railW, railH, side, top0, top1, isStart = false, isEnd = false, flags = 0 } = params;
  if (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) < 1e-6) return { positions: [], triangles: [] };
  const oa = params.acrossA ?? leftOf(pa, pb, width / 2),
    ob = params.acrossB ?? leftOf(pa, pb, width / 2);
  // (its axis railW / 2 inside the edge, its half-width railW / 2 — the across-vectors scaled from the deck's half-width)
  const half = width / 2;
  const kc = (side * (half - railW / 2)) / half,
    kr = railW / 2 / half;
  const c0 = [pa[0] + oa[0] * kc, pa[1] + oa[1] * kc],
    c1 = [pb[0] + ob[0] * kc, pb[1] + ob[1] * kc];
  const r0 = [oa[0] * kr, oa[1] * kr],
    r1 = [ob[0] * kr, ob[1] * kr];
  const t0 = top0 + railH,
    t1 = top1 + railH;
  // prettier-ignore
  const positions = [
    c0[0]! - r0[0]!,
    c0[1]! - r0[1]!,
    t0,
    c0[0]! + r0[0]!,
    c0[1]! + r0[1]!,
    t0,
    c1[0]! + r1[0]!,
    c1[1]! + r1[1]!,
    t1,
    c1[0]! - r1[0]!,
    c1[1]! - r1[1]!,
    t1,
    c0[0]! - r0[0]!,
    c0[1]! - r0[1]!,
    top0,
    c0[0]! + r0[0]!,
    c0[1]! + r0[1]!,
    top0,
    c1[0]! + r1[0]!,
    c1[1]! + r1[1]!,
    top1,
    c1[0]! - r1[0]!,
    c1[1]! - r1[1]!,
    top1,
  ];
  const triangles = [...TOP, ...RIGHT, ...LEFT];
  if (isStart && !(flags & BridgeFlag.OpenA)) triangles.push(...END_A);
  if (isEnd && !(flags & BridgeFlag.OpenB)) triangles.push(...END_B);
  return { positions, triangles };
}

/** A pier from its footing (in the ground) to the intrados: `halfLength` along the bridge's axis, `pierWidth` across it — the same
 *  oriented box as its collision strip. */
export function buildContinuousPierMesh(params: PierParams): BridgeMeshOutput {
  const { p, pierWidth, groundFooting, intradosTop } = params;
  if (intradosTop <= groundFooting) return { positions: [], triangles: [] };
  const [ux, uy] = params.axis ?? [1, 0];
  const hl = params.halfLength ?? 1,
    hw = pierWidth / 2;
  const a: [number, number, number] = [p[0] - ux * hl, p[1] - uy * hl, 0],
    b: [number, number, number] = [p[0] + ux * hl, p[1] + uy * hl, 0];
  const m = buildContinuousSliceMesh({
    pa: a,
    pb: b,
    width: 2 * hw,
    top0: intradosTop,
    top1: intradosTop,
    thick: intradosTop - groundFooting,
    isStart: true,
    isEnd: true,
  });
  return m;
}

/** A slice's top as a plane z = A x + B y + C (exact for buildContinuousSliceMesh's top: level across, linear along). */
export function computeSlicePlane(
  pa: [number, number, number],
  pb: [number, number, number],
  top0: number,
  top1: number,
): [number, number, number] {
  const dx = pb[0] - pa[0],
    dy = pb[1] - pa[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-8) return [0, 0, top0];
  const dz = top1 - top0;
  const a = (dz * dx) / L2,
    b = (dz * dy) / L2;
  return [a, b, top0 - (a * pa[0] + b * pa[1])];
}

/** the mitred across-vectors at an axis's points (the half-width to the left, its length grown by 1 / cos of the half bend, at most ×2) */
export function mitres(
  points: readonly (readonly [number, number] | readonly [number, number, number])[],
  half: number,
): [number, number][] {
  const n = points.length;
  const seg = (i: number): [number, number] => {
    const a = points[i]!,
      b = points[i + 1]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(-(b[1] - a[1]) / L) as number, ((b[0] - a[0]) / L) as number];
  };
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const na = i > 0 ? seg(i - 1) : seg(0);
    const nb = i < n - 1 ? seg(i) : seg(n - 2);
    let mx = na[0] + nb[0],
      my = na[1] + nb[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) {
      mx = nb[0];
      my = nb[1];
    } else {
      mx /= ml;
      my /= ml;
    }
    const cos = Math.max(0.5, mx * nb[0] + my * nb[1]);
    out.push([(mx * half) / cos, (my * half) / cos]);
  }
  return out;
}
