// Bridge & Road AAA — Structural Families and Notable Bridge Silhouettes (PLAN-PONT-ROUTES-AAA.md PR6)
// Provides span-based structural classification, architectural rules for notable structures
// (Pont Alexandre III single low-rise arch & monumental pylons, viaducts with 130m piers),
// and accurate pier placement.

import { PIER_SPACING_M, VIADUCT_PIER_SPACING_M } from "./street-cells";
import type { Vec3 } from "../physics";
import { BridgePaint, prism } from "./bridge-notable";

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

/** a painted solid of a notable structure: its mesh (CCW outward), its footprint's corners (its collision's), its bottom and top [the
 *  frame's z], its paint (bridge-notable.ts BridgePaint: the raster's palette — scenery-worker.ts tags it BRIDGE_PAINT | paint) */
export interface PaintedSolid {
  positions: number[];
  triangles: number[];
  footprint: [number, number][];
  bottom: number;
  top: number;
  paint: BridgePaint;
}

/**
 * Pont Alexandre III's figures (the Monuments historiques' record; 25 Nov 2026 — campaign 2: « ses quatre pylônes sont des pavés unis,
 * l'arc à peine visible depuis la Seine »): four masonry pylons on their bases at the bridge's corners, 17 m of column and pedestal
 * over the quay, each crowned by a gilded bronze group (a Fame restraining a Pegasus, ~5 m); one steel arch of 107.5 m span and 6.28 m
 * rise — fifteen ribs, the two outer ones dressed and seen from the river, open spandrels of slender posts up to the deck. Drawn as
 * simple shapes: what reads at 100 m and more, not the sculpture.
 */
export const ALEXANDRE_III = {
  span: 107.5,
  rise: 6.28,
  /** the pylon's parts over the deck at its end [m]: base, pedestal, column (to its capital), capital, the group's plinth, the group */
  baseTop: 3,
  pedestalTop: 5,
  columnTop: 15,
  capitalTop: 16.4,
  plinthTop: 17.6,
  groupTop: 21.4,
  wingTop: 22.6,
  /** their sections [m] */
  base: 7,
  pedestal: 5.4,
  columnFoot: 3.4,
  columnHead: 3,
  capital: 4.4,
  plinth: 2.6,
} as const;

/**
 * Pont Alexandre III's four pylons, each in its parts — its base (from the bank under the deck, `bankZ`, else 9 m under the deck),
 * pedestal, tapered column and capital in granite, its group's plinth, and the gilded group (a tapered body, two wings spread across
 * the bridge) — each part its own painted solid (its collision its own footprint: the column's, not the base's). `positions` /
 * `triangles` / `normals` (per vertex, the faces' — flat) all the parts together.
 */
export function buildAlexandreIIIPylonsMesh(params: {
  readonly pStart: [number, number, number];
  readonly pEnd: [number, number, number];
  readonly width: number;
  readonly deckZ0: number;
  readonly deckZ1: number;
  readonly bankZ0?: number;
  readonly bankZ1?: number;
}): { positions: number[]; triangles: number[]; normals: number[]; pylons: PaintedSolid[] } {
  const { pStart, pEnd, width, deckZ0, deckZ1 } = params;
  const A = ALEXANDRE_III;
  const dx = pEnd[0] - pStart[0],
    dy = pEnd[1] - pStart[1];
  const L = Math.hypot(dx, dy) || 1;
  const t: [number, number] = [dx / L, dy / L],
    n: [number, number] = [-t[1], t[0]];
  const parts: PaintedSolid[] = [];
  const box = (c: [number, number], z0: number, z1: number, s0: number, s1: number, paint: BridgePaint, foot = s0) => {
    const m = prism([c[0], c[1], z0], [c[0], c[1], z1], s0, s0, s1, s1, [t[0], t[1], 0]);
    const h = foot / 2;
    parts.push({
      ...m,
      footprint: [
        [c[0] - t[0] * h - n[0] * h, c[1] - t[1] * h - n[1] * h],
        [c[0] + t[0] * h - n[0] * h, c[1] + t[1] * h - n[1] * h],
        [c[0] + t[0] * h + n[0] * h, c[1] + t[1] * h + n[1] * h],
        [c[0] - t[0] * h + n[0] * h, c[1] - t[1] * h + n[1] * h],
      ],
      bottom: z0,
      top: z1,
      paint,
    });
  };
  for (const [end, side] of [
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    const p = end ? pEnd : pStart;
    const D = end ? deckZ1 : deckZ0;
    const bank = (end ? params.bankZ1 : params.bankZ0) ?? D - 9;
    const off = width / 2 + A.base / 2 + 0.5;
    const c: [number, number] = [p[0] + n[0] * side * off, p[1] + n[1] * side * off];
    box(c, bank - 1, D + A.baseTop, A.base, A.base, BridgePaint.Granite);
    box(c, D + A.baseTop, D + A.pedestalTop, A.pedestal, A.pedestal, BridgePaint.Granite);
    box(c, D + A.pedestalTop, D + A.columnTop, A.columnFoot, A.columnHead, BridgePaint.Granite);
    box(c, D + A.columnTop, D + A.capitalTop, A.capital, A.capital, BridgePaint.Granite, A.columnHead);
    box(c, D + A.capitalTop, D + A.plinthTop, A.plinth, A.plinth, BridgePaint.Granite);
    // (the group: its body tapering up, its wings spread across the bridge from its shoulders — gilded)
    box(c, D + A.plinthTop, D + A.groupTop, 1.9, 0.7, BridgePaint.Gilded, 1.9);
    for (const w of [-1, 1]) {
      // (spread along the bridge — their broad side to the river —, thin across it)
      const sh: Vec3 = [c[0] + t[0] * w * 0.35, c[1] + t[1] * w * 0.35, D + A.plinthTop + 2];
      const tip: Vec3 = [c[0] + t[0] * w * 1.9, c[1] + t[1] * w * 1.9, D + A.wingTop];
      const m = prism(sh, tip, 1.4, 0.18, 0.9, 0.12, [n[0], n[1], 0]);
      parts.push({
        ...m,
        footprint: [
          [sh[0] - n[0] * 0.3, sh[1] - n[1] * 0.3],
          [tip[0] - n[0] * 0.3, tip[1] - n[1] * 0.3],
          [tip[0] + n[0] * 0.3, tip[1] + n[1] * 0.3],
          [sh[0] + n[0] * 0.3, sh[1] + n[1] * 0.3],
        ],
        bottom: sh[2],
        top: tip[2],
        paint: BridgePaint.Gilded,
      });
    }
  }
  return { ...merged(parts), pylons: parts };
}

/**
 * The arch under a deck (Pont Alexandre III's — its 107.5 m span and 6.28 m rise by default — or an arch family's): five steel ribs
 * across the deck's width (the two outer ones deeper, the ones seen from the river), their springings at the span's ends `rise` under
 * the crown, the crown at the deck's intrados (`deckZMid − thick`), and the open spandrels — a slender post every ~7 m on each outer rib
 * up to the intrados. In `segments` pieces along the span, each its own painted solid: its collision box from its lowest rib to the
 * intrados there — the river under the arch kept open, not a slab under the whole deck.
 */
export function buildArchRibsMesh(params: {
  readonly pStart: [number, number, number];
  readonly pEnd: [number, number, number];
  readonly width: number;
  readonly deckZ0: number;
  readonly deckZ1: number;
  readonly riseM: number;
  /** the deck's top at the span's middle and its thickness [m]: the crown under its intrados (default the ends' mean, 1.2 m) */
  readonly deckZMid?: number;
  readonly thick?: number;
  /** the span between the springings [m] (default min(107.5, 0.8 × the length)) */
  readonly spanM?: number;
  readonly ribWidthM?: number;
  readonly ribThicknessM?: number;
  readonly segments?: number;
}): { positions: number[]; triangles: number[]; normals: number[]; parts: PaintedSolid[] } {
  const { pStart, pEnd, width, deckZ0, deckZ1, riseM } = params;
  const dx = pEnd[0] - pStart[0],
    dy = pEnd[1] - pStart[1];
  const totalL = Math.hypot(dx, dy) || 1;
  const t: [number, number] = [dx / totalL, dy / totalL],
    n: [number, number] = [-t[1], t[0]];
  const span = Math.min(params.spanM ?? ALEXANDRE_III.span, 0.8 * totalL);
  const s0 = (totalL - span) / 2;
  const deckAt = (s: number) => deckZ0 + ((deckZ1 - deckZ0) * s) / totalL;
  const intrados = (params.deckZMid ?? (deckZ0 + deckZ1) / 2) - (params.thick ?? 1.2);
  const crownTilt = (s: number) => deckAt(s) - deckAt(totalL / 2);
  // (the rib's top along the span: a parabola, the springings riseM under the crown)
  const archTop = (u: number) => intrados + crownTilt(s0 + u * span) - riseM * (1 - 4 * u * (1 - u));
  const ribW = params.ribWidthM ?? 0.9;
  const depth0 = params.ribThicknessM ?? 1.5;
  const ribs = [-1, -0.5, 0, 0.5, 1].map((k) => k * (width / 2 - 0.6));
  const nSeg = params.segments ?? 12;
  const steps = 4;
  const parts: PaintedSolid[] = [];
  const at = (s: number, off: number, z: number): Vec3 => [pStart[0] + t[0] * s + n[0] * off, pStart[1] + t[1] * s + n[1] * off, z];
  for (let g = 0; g < nSeg; g++) {
    const positions: number[] = [],
      triangles: number[] = [];
    const add = (m: { positions: number[]; triangles: number[] }) => {
      const b = positions.length / 3;
      positions.push(...m.positions);
      for (const k of m.triangles) triangles.push(k + b);
    };
    let lo = Infinity;
    for (let k = 0; k < steps; k++) {
      const u0 = (g * steps + k) / (nSeg * steps),
        u1 = (g * steps + k + 1) / (nSeg * steps);
      for (const [r, off] of ribs.entries()) {
        const outer = r === 0 || r === ribs.length - 1;
        // (deeper at the springings, slimmer at the crown; the outer ribs a third deeper)
        const dep = (u: number) => (outer ? 1.35 : 1) * depth0 * (0.6 + 0.4 * Math.abs(2 * u - 1));
        const z0 = archTop(u0),
          z1 = archTop(u1);
        const a = at(s0 + u0 * span, off, z0 - dep(u0) / 2),
          b = at(s0 + u1 * span, off, z1 - dep(u1) / 2);
        add(prism(a, b, outer ? ribW * 1.2 : ribW, dep(u0), outer ? ribW * 1.2 : ribW, dep(u1)));
        lo = Math.min(lo, z0 - dep(u0), z1 - dep(u1));
      }
    }
    // (the spandrels' posts on the outer ribs: at the segment's start, from the rib's top to the intrados)
    const um = g / nSeg;
    const s = s0 + um * span;
    const top = intrados + crownTilt(s);
    if (top - archTop(um) > 0.6)
      for (const off of [ribs[0]!, ribs[ribs.length - 1]!])
        add(prism(at(s, off, archTop(um)), at(s, off, top), 0.4, 0.4, 0.35, 0.35, [t[0], t[1], 0]));
    const sa = s0 + (g / nSeg) * span,
      sb = s0 + ((g + 1) / nSeg) * span;
    const h = width / 2;
    parts.push({
      positions,
      triangles,
      footprint: [
        [pStart[0] + t[0] * sa - n[0] * h, pStart[1] + t[1] * sa - n[1] * h],
        [pStart[0] + t[0] * sb - n[0] * h, pStart[1] + t[1] * sb - n[1] * h],
        [pStart[0] + t[0] * sb + n[0] * h, pStart[1] + t[1] * sb + n[1] * h],
        [pStart[0] + t[0] * sa + n[0] * h, pStart[1] + t[1] * sa + n[1] * h],
      ],
      bottom: lo,
      top: Math.max(intrados + crownTilt(sa), intrados + crownTilt(sb)),
      paint: BridgePaint.Silver,
    });
  }
  return { ...merged(parts), parts };
}

/** parts' meshes as one, with flat per-vertex normals (each vertex's first face's) */
function merged(parts: readonly { positions: number[]; triangles: number[] }[]): {
  positions: number[];
  triangles: number[];
  normals: number[];
} {
  const positions: number[] = [],
    triangles: number[] = [];
  for (const m of parts) {
    const b = positions.length / 3;
    positions.push(...m.positions);
    for (const k of m.triangles) triangles.push(k + b);
  }
  const normals = new Array<number>(positions.length).fill(0);
  for (let k = 0; k < triangles.length; k += 3) {
    const [i, j, l] = [triangles[k]!, triangles[k + 1]!, triangles[k + 2]!];
    const e1 = [0, 1, 2].map((c) => positions[j * 3 + c]! - positions[i * 3 + c]!),
      e2 = [0, 1, 2].map((c) => positions[l * 3 + c]! - positions[i * 3 + c]!);
    const nn = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const ln = Math.hypot(nn[0]!, nn[1]!, nn[2]!) || 1;
    for (const v of [i, j, l])
      if (normals[v * 3] === 0 && normals[v * 3 + 1] === 0 && normals[v * 3 + 2] === 0)
        for (let c = 0; c < 3; c++) normals[v * 3 + c] = nn[c]! / ln;
  }
  return { positions, triangles, normals };
}

/**
 * A data bridge lying under another source's deck — its double, left out (scenery-worker): its middle vertex on that deck, or `share`
 * of its length — sampled every `stepM` — (campaign 2, 24 Nov 2026: the middle vertex alone missed the Golden Gate's street-cell double,
 * its vertices crowded on an approach; a second deck was drawn at the sea's clearance, 60 m under the notable one, its piers in the
 * water). A road crossing under it — a fraction of its length — is kept. `line`: frame points [east, north] [m].
 */
export function lineUnderDeck(
  line: readonly (readonly [number, number] | readonly number[])[],
  onDeck: (x: number, y: number) => boolean,
  stepM = 15,
  share = 0.5,
): boolean {
  if (line.length === 0) return false;
  const m = line[Math.floor(line.length / 2)]!;
  if (onDeck(m[0]!, m[1]!)) return true;
  let n = 0,
    hit = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const k = Math.max(1, Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / stepM));
    for (let j = 0; j < k; j++) {
      const t = (j + 0.5) / k;
      n++;
      if (onDeck(a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t)) hit++;
    }
  }
  return n > 0 && hit >= share * n;
}

/**
 * (review A9; 25 Nov 2026 — PROBLEMES « L'eau sous Cheviré ») Whether an OpenStreetMap bridge area lies under a deck already built: its
 * centre, its outline (16 points at most) or its inside — 7 × 7 over its box, within its outline (`contains`) — on a deck (`onDeck`, the
 * registry's, in plan). Cheviré's area, wider than its two surveyed carriageways, its centre between them, its outline off both, was
 * drawn as a slab a few metres over the Loire — the light band 60 m under the real deck. `ring`: its outline in the frame (z unused).
 */
export function areaUnderDeck(
  ring: readonly (readonly number[])[],
  contains: (at: Vec3) => boolean,
  onDeck: (x: number, y: number) => boolean,
): boolean {
  if (!ring.length) return false;
  const cx = ring.reduce((s, p) => s + p[0]!, 0) / ring.length,
    cy = ring.reduce((s, p) => s + p[1]!, 0) / ring.length;
  if (onDeck(cx, cy)) return true;
  const step = Math.max(1, Math.floor(ring.length / 16));
  let x0 = Number.POSITIVE_INFINITY,
    y0 = Number.POSITIVE_INFINITY,
    x1 = Number.NEGATIVE_INFINITY,
    y1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < ring.length; i += step) {
    const p = ring[i]!;
    if (onDeck(p[0]!, p[1]!)) return true;
  }
  for (const p of ring) {
    x0 = Math.min(x0, p[0]!);
    y0 = Math.min(y0, p[1]!);
    x1 = Math.max(x1, p[0]!);
    y1 = Math.max(y1, p[1]!);
  }
  for (let j = 0; j < 7; j++)
    for (let i = 0; i < 7; i++) {
      const at: Vec3 = [x0 + ((x1 - x0) * (i + 0.5)) / 7, y0 + ((y1 - y0) * (j + 0.5)) / 7, 0];
      if (contains(at) && onDeck(at[0], at[1])) return true;
    }
  return false;
}
