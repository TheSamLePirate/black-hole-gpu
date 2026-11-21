// Continuous 3D bridge deck mesh, abutments and piers (PLAN-PONT-ROUTES-AAA PR3).
// Replaces legacy flat horizontal slabs with a continuous triangulated extruded strip
// following BridgeContinuousProfile: sloped vertices, zero vertical step at junctions,
// real closed/open abutments, and firmly anchored piers.

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
}

export interface PierParams {
  p: [number, number, number];
  width: number;
  pierWidth: number;
  groundFooting: number;
  intradosTop: number;
}

/**
 * Builds a continuous 3D triangulated prism slice for a bridge deck between two centerline stations.
 * The top and bottom vertices match the continuous profile at both ends (top0 and top1).
 * When slices are placed end-to-end, the shared boundary vertices are mathematically identical,
 * eliminating the legacy vertical cliff steps between adjacent slices.
 */
export function buildContinuousSliceMesh(params: DeckSliceParams): BridgeMeshOutput {
  const { pa, pb, width, top0, top1, thick, isStart = false, isEnd = false, flags = 0 } = params;
  const dx = pb[0] - pa[0],
    dy = pb[1] - pa[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    return { positions: [], triangles: [] };
  }

  const nx = -dy / length,
    ny = dx / length;
  const hw = width / 2;
  const ox = nx * hw,
    oy = ny * hw;

  const bot0 = top0 - thick;
  const bot1 = top1 - thick;

  // 8 vertices of the 3D deck slice:
  // 0: Top-Left Start
  // 1: Top-Right Start
  // 2: Top-Right End
  // 3: Top-Left End
  // 4: Bottom-Left Start
  // 5: Bottom-Right Start
  // 6: Bottom-Right End
  // 7: Bottom-Left End
  const positions: number[] = [
    pa[0] - ox,
    pa[1] - oy,
    top0, // 0
    pa[0] + ox,
    pa[1] + oy,
    top0, // 1
    pb[0] + ox,
    pb[1] + oy,
    top1, // 2
    pb[0] - ox,
    pb[1] - oy,
    top1, // 3
    pa[0] - ox,
    pa[1] - oy,
    bot0, // 4
    pa[0] + ox,
    pa[1] + oy,
    bot0, // 5
    pb[0] + ox,
    pb[1] + oy,
    bot1, // 6
    pb[0] - ox,
    pb[1] - oy,
    bot1, // 7
  ];

  const triangles: number[] = [
    // Top face (carriageway / surface de roulement)
    0, 1, 2, 0, 2, 3,
    // Bottom face (intrados)
    4, 6, 5, 4, 7, 6,
    // Left fascia
    4, 0, 3, 4, 3, 7,
    // Right fascia
    5, 2, 1, 5, 6, 2,
  ];

  // Abutment End A (start)
  if (isStart && !(flags & BridgeFlag.OpenA)) {
    triangles.push(4, 5, 1, 4, 1, 0);
  }

  // Abutment End B (end)
  if (isEnd && !(flags & BridgeFlag.OpenB)) {
    triangles.push(6, 7, 3, 6, 3, 2);
  }

  return { positions, triangles };
}

/**
 * Builds a continuous 3D guardrail / parapet slice along one edge of the deck.
 */
export function buildContinuousRailMesh(params: RailSliceParams): BridgeMeshOutput {
  const { pa, pb, width, railW, railH, side, top0, top1, isStart = false, isEnd = false, flags = 0 } = params;
  const dx = pb[0] - pa[0],
    dy = pb[1] - pa[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    return { positions: [], triangles: [] };
  }

  const nx = -dy / length,
    ny = dx / length;
  const offset = side * (width / 2 - railW / 2);
  const cx0 = pa[0] + nx * offset,
    cy0 = pa[1] + ny * offset;
  const cx1 = pb[0] + nx * offset,
    cy1 = pb[1] + ny * offset;

  const hr = railW / 2;
  const rox = nx * hr,
    roy = ny * hr;

  const rTop0 = top0 + railH;
  const rTop1 = top1 + railH;

  // 8 vertices of the guardrail box
  const positions: number[] = [
    cx0 - rox,
    cy0 - roy,
    rTop0, // 0: Top-Left Start
    cx0 + rox,
    cy0 + roy,
    rTop0, // 1: Top-Right Start
    cx1 + rox,
    cy1 + roy,
    rTop1, // 2: Top-Right End
    cx1 - rox,
    cy1 - roy,
    rTop1, // 3: Top-Left End
    cx0 - rox,
    cy0 - roy,
    top0, // 4: Base-Left Start
    cx0 + rox,
    cy0 + roy,
    top0, // 5: Base-Right Start
    cx1 + rox,
    cy1 + roy,
    top1, // 6: Base-Right End
    cx1 - rox,
    cy1 - roy,
    top1, // 7: Base-Left End
  ];

  const triangles: number[] = [
    // Top face
    0, 1, 2, 0, 2, 3,
    // Outer side
    4, 0, 3, 4, 3, 7,
    // Inner side
    5, 2, 1, 5, 6, 2,
  ];

  if (isStart && !(flags & BridgeFlag.OpenA)) {
    triangles.push(4, 5, 1, 4, 1, 0);
  }

  if (isEnd && !(flags & BridgeFlag.OpenB)) {
    triangles.push(6, 7, 3, 6, 3, 2);
  }

  return { positions, triangles };
}

/**
 * Builds a firmly anchored pier column connecting the ground to the bridge intrados.
 */
export function buildContinuousPierMesh(params: PierParams): BridgeMeshOutput {
  const { p, pierWidth, groundFooting, intradosTop } = params;
  if (intradosTop <= groundFooting) {
    return { positions: [], triangles: [] };
  }

  const hp = pierWidth / 2;
  const x0 = p[0] - hp,
    x1 = p[0] + hp;
  const y0 = p[1] - hp,
    y1 = p[1] + hp;

  // 8 vertices: 4 at top, 4 at base
  const positions: number[] = [
    x0,
    y0,
    intradosTop, // 0: Top NW
    x1,
    y0,
    intradosTop, // 1: Top NE
    x1,
    y1,
    intradosTop, // 2: Top SE
    x0,
    y1,
    intradosTop, // 3: Top SW
    x0,
    y0,
    groundFooting, // 4: Base NW
    x1,
    y0,
    groundFooting, // 5: Base NE
    x1,
    y1,
    groundFooting, // 6: Base SE
    x0,
    y1,
    groundFooting, // 7: Base SW
  ];

  const triangles: number[] = [
    // 4 vertical sides
    4, 0, 1, 4, 1, 5, 5, 1, 2, 5, 2, 6, 6, 2, 3, 6, 3, 7, 7, 3, 0, 7, 0, 4,
    // Top cap (mating to intrados)
    0, 2, 1, 0, 3, 2,
    // Base cap (in ground)
    4, 5, 6, 4, 6, 7,
  ];

  return { positions, triangles };
}

/**
 * Computes the exact plane equation z = A*x + B*y + C for a linearly sloped rectangular deck slice.
 */
export function computeSlicePlane(
  pa: [number, number, number],
  pb: [number, number, number],
  top0: number,
  top1: number,
): [number, number, number] {
  const dx = pb[0] - pa[0],
    dy = pb[1] - pa[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-8) {
    return [0, 0, top0];
  }
  const dz = top1 - top0;
  const a = (dz * dx) / L2;
  const b = (dz * dy) / L2;
  const c = top0 - (a * pa[0] + b * pa[1]);
  return [a, b, c];
}
