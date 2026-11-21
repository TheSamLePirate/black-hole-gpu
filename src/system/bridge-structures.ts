// Bridge & Road AAA — Structural Families and Notable Bridge Silhouettes (PLAN-PONT-ROUTES-AAA.md PR6)
// Provides span-based structural classification, architectural rules for notable structures
// (Pont Alexandre III single low-rise arch & monumental pylons, viaducts with 130m piers),
// and accurate pier placement.

import { PIER_SPACING_M, VIADUCT_PIER_SPACING_M } from "./street-cells";

export type BridgeStructureFamily = "girder" | "viaduct" | "arch" | "monumental_alexandre_iii";

export interface BridgeClassificationParams {
  readonly length: number;
  readonly width: number;
  readonly geoStart?: { lat: number; lon: number };
  readonly geoEnd?: { lat: number; lon: number };
  readonly name?: string;
  readonly clearance?: number;
}

/**
 * Classifies a bridge into its structural family based on notable coordinates,
 * dimensions and civil engineering characteristics.
 */
export function classifyBridgeStructure(params: BridgeClassificationParams): BridgeStructureFamily {
  const { length, geoStart, geoEnd, name } = params;

  // 1. Pont Alexandre III detection:
  // Famous location: Paris Seine (lat: 48.8637, lon: 2.3135), ~150-160m length, single steel arch
  if (name?.toLowerCase().includes("alexandre") || name?.toLowerCase().includes("alexandre iii")) {
    return "monumental_alexandre_iii";
  }

  if (geoStart && geoEnd) {
    const midLat = (geoStart.lat + geoEnd.lat) / 2;
    const midLon = (geoStart.lon + geoEnd.lon) / 2;
    const dLat = (midLat - 48.8637) * 111320;
    const dLon = (midLon - 2.3135) * 111320 * Math.cos((48.8637 * Math.PI) / 180);
    const distToAlexandreIII = Math.hypot(dLat, dLon);

    if (distToAlexandreIII < 110 && length >= 100 && length <= 220 && params.width >= 10) {
      return "monumental_alexandre_iii";
    }
  }

  // 2. Viaducts: long structures over 400m
  if (length > 400) {
    return "viaduct";
  }

  // 3. Medium spans with high clearance: arch
  if (length > 80 && length <= 400 && (params.clearance ?? 5.5) > 15.0) {
    return "arch";
  }

  return "girder";
}

/**
 * Returns the abscissas [m] of piers along the bridge axis according to its structural family.
 * - Alexandre III: single arch span across the Seine -> ZERO piers in the river!
 * - Viaduct: piers every 130 m (VIADUCT_PIER_SPACING_M)
 * - Girder: piers every 34 m (PIER_SPACING_M)
 */
export function computeStructurePierLocations(totalLength: number, family: BridgeStructureFamily): number[] {
  if (family === "monumental_alexandre_iii") {
    // Single arch span across the Seine: no piers in the river channel!
    return [];
  }

  const spacing = family === "viaduct" ? VIADUCT_PIER_SPACING_M : PIER_SPACING_M;
  const n = Math.max(0, Math.round(totalLength / spacing) - 1);
  return Array.from({ length: n }, (_, i) => (totalLength * (i + 1)) / (n + 1));
}

/**
 * Mesh generator for Pont Alexandre III's four monumental corner pylons.
 * Four 17m-high stone pylons (width 3.6m x 3.6m) at the abutments, topped by gilded Fame statues.
 */
export function buildAlexandreIIIPylonsMesh(params: {
  readonly pStart: [number, number, number];
  readonly pEnd: [number, number, number];
  readonly width: number;
  readonly deckZ0: number;
  readonly deckZ1: number;
  readonly bankZ0?: number;
  readonly bankZ1?: number;
}): { positions: number[]; triangles: number[]; normals: number[] } {
  const { pStart, pEnd, width, deckZ0, deckZ1 } = params;
  const positions: number[] = [];
  const triangles: number[] = [];
  const normals: number[] = [];

  const dx = pEnd[0] - pStart[0];
  const dy = pEnd[1] - pStart[1];
  const L = Math.hypot(dx, dy) || 1;
  const dirX = dx / L;
  const dirY = dy / L;

  // Transverse across vector
  const acX = -dirY;
  const acY = dirX;

  const pylonHalfW = 1.8; // 3.6m wide square pylon
  const pylonHeightAboveDeck = 14.0; // 14m above deck

  // Four corners: [start-left, start-right, end-left, end-right]
  const corners: {
    cx: number;
    cy: number;
    deckZ: number;
    bottomZ: number;
  }[] = [
    {
      cx: pStart[0] - acX * (width / 2 + pylonHalfW * 0.8),
      cy: pStart[1] - acY * (width / 2 + pylonHalfW * 0.8),
      deckZ: deckZ0,
      bottomZ: (params.bankZ0 ?? deckZ0 - 8.0) - 1.0,
    },
    {
      cx: pStart[0] + acX * (width / 2 + pylonHalfW * 0.8),
      cy: pStart[1] + acY * (width / 2 + pylonHalfW * 0.8),
      deckZ: deckZ0,
      bottomZ: (params.bankZ0 ?? deckZ0 - 8.0) - 1.0,
    },
    {
      cx: pEnd[0] - acX * (width / 2 + pylonHalfW * 0.8),
      cy: pEnd[1] - acY * (width / 2 + pylonHalfW * 0.8),
      deckZ: deckZ1,
      bottomZ: (params.bankZ1 ?? deckZ1 - 8.0) - 1.0,
    },
    {
      cx: pEnd[0] + acX * (width / 2 + pylonHalfW * 0.8),
      cy: pEnd[1] + acY * (width / 2 + pylonHalfW * 0.8),
      deckZ: deckZ1,
      bottomZ: (params.bankZ1 ?? deckZ1 - 8.0) - 1.0,
    },
  ];

  for (const c of corners) {
    const topZ = c.deckZ + pylonHeightAboveDeck;
    const botZ = c.bottomZ;

    // 4 corners of the pylon footprint in XY
    const p0: [number, number] = [c.cx - dirX * pylonHalfW - acX * pylonHalfW, c.cy - dirY * pylonHalfW - acY * pylonHalfW];
    const p1: [number, number] = [c.cx + dirX * pylonHalfW - acX * pylonHalfW, c.cy + dirY * pylonHalfW - acY * pylonHalfW];
    const p2: [number, number] = [c.cx + dirX * pylonHalfW + acX * pylonHalfW, c.cy + dirY * pylonHalfW + acY * pylonHalfW];
    const p3: [number, number] = [c.cx - dirX * pylonHalfW + acX * pylonHalfW, c.cy - dirY * pylonHalfW + acY * pylonHalfW];

    const footprint = [p0, p1, p2, p3];

    // Extrude 4 vertical walls for the shaft
    for (let i = 0; i < 4; i++) {
      const a = footprint[i]!;
      const b = footprint[(i + 1) % 4]!;
      const baseIdx = positions.length / 3;

      const wallDx = b[0] - a[0];
      const wallDy = b[1] - a[1];
      const wallLen = Math.hypot(wallDx, wallDy) || 1;
      const nx = wallDy / wallLen;
      const ny = -wallDx / wallLen;

      // 4 vertices of the wall quad: a-bottom, b-bottom, b-top, a-top
      positions.push(a[0], a[1], botZ, b[0], b[1], botZ, b[0], b[1], topZ, a[0], a[1], topZ);

      for (let k = 0; k < 4; k++) normals.push(nx, ny, 0);

      triangles.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    }

    // Top cap
    const capBaseIdx = positions.length / 3;
    for (const pt of footprint) {
      positions.push(pt[0], pt[1], topZ);
      normals.push(0, 0, 1);
    }
    triangles.push(capBaseIdx, capBaseIdx + 1, capBaseIdx + 2, capBaseIdx, capBaseIdx + 2, capBaseIdx + 3);
  }

  return { positions, triangles, normals };
}

/**
 * Mesh generator for low-rise steel arch ribs underneath the deck.
 * Used for Pont Alexandre III and arch family bridges to recreate the iconic curved silhouette.
 */
export function buildArchRibsMesh(params: {
  readonly pStart: [number, number, number];
  readonly pEnd: [number, number, number];
  readonly width: number;
  readonly deckZ0: number;
  readonly deckZ1: number;
  readonly riseM: number;
  readonly ribWidthM?: number;
  readonly ribThicknessM?: number;
}): { positions: number[]; triangles: number[]; normals: number[] } {
  const { pStart, pEnd, width, deckZ0, deckZ1, riseM } = params;
  const positions: number[] = [];
  const triangles: number[] = [];
  const normals: number[] = [];

  const dx = pEnd[0] - pStart[0];
  const dy = pEnd[1] - pStart[1];
  const totalL = Math.hypot(dx, dy) || 1;
  const dirX = dx / totalL;
  const dirY = dy / totalL;
  const acX = -dirY;
  const acY = dirX;

  const ribW = params.ribWidthM ?? 1.2;
  const ribThick = params.ribThicknessM ?? 1.0;

  // We generate 3 parallel steel arch ribs: left, center, right
  const ribOffsets = [-width * 0.42, 0, width * 0.42];
  const slices = 16;

  for (const offset of ribOffsets) {
    for (let s = 0; s < slices; s++) {
      const t0 = s / slices;
      const t1 = (s + 1) / slices;

      // Parabolic arch profile: baseline minus arch drop from deck
      // In Pont Alexandre III: springing at abutments is near water line (deckZ - clearance), rising up near deck at center
      const archEnv0 = 4 * t0 * (1 - t0);
      const archEnv1 = 4 * t1 * (1 - t1);

      const baselineZ0 = deckZ0 + (deckZ1 - deckZ0) * t0 - riseM;
      const baselineZ1 = deckZ0 + (deckZ1 - deckZ0) * t1 - riseM;

      const topZ0 = baselineZ0 + riseM * archEnv0;
      const topZ1 = baselineZ1 + riseM * archEnv1;
      const botZ0 = topZ0 - ribThick;
      const botZ1 = topZ1 - ribThick;

      const cx0 = pStart[0] + dx * t0 + acX * offset;
      const cy0 = pStart[1] + dy * t0 + acY * offset;
      const cx1 = pStart[0] + dx * t1 + acX * offset;
      const cy1 = pStart[1] + dy * t1 + acY * offset;

      // Segment quad vertices
      const pL0: [number, number] = [cx0 - acX * (ribW / 2), cy0 - acY * (ribW / 2)];
      const pR0: [number, number] = [cx0 + acX * (ribW / 2), cy0 + acY * (ribW / 2)];
      const pL1: [number, number] = [cx1 - acX * (ribW / 2), cy1 - acY * (ribW / 2)];
      const pR1: [number, number] = [cx1 + acX * (ribW / 2), cy1 + acY * (ribW / 2)];

      // Intrados bottom face
      const baseIdx = positions.length / 3;
      positions.push(pL0[0], pL0[1], botZ0, pR0[0], pR0[1], botZ0, pR1[0], pR1[1], botZ1, pL1[0], pL1[1], botZ1);
      for (let k = 0; k < 4; k++) normals.push(0, 0, -1);
      triangles.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);

      // Sides
      for (const side of [-1, 1]) {
        const sideIdx = positions.length / 3;
        const ptA = side === -1 ? pL0 : pR0;
        const ptB = side === -1 ? pL1 : pR1;
        const sideNormX = acX * side;
        const sideNormY = acY * side;

        positions.push(ptA[0], ptA[1], botZ0, ptB[0], ptB[1], botZ1, ptB[0], ptB[1], topZ1, ptA[0], ptA[1], topZ0);
        for (let k = 0; k < 4; k++) normals.push(sideNormX, sideNormY, 0);
        triangles.push(sideIdx, sideIdx + 1, sideIdx + 2, sideIdx, sideIdx + 2, sideIdx + 3);
      }
    }
  }

  return { positions, triangles, normals };
}
