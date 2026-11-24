// PLAN-J8 J8-VB VB2 — a near road's markings, kerb and pavements, from the scene's own line (OpenMapTiles': its class, its width by
// class, its way) and the town at its middle, by KSC3's rules (street-detail-prep.ts segmentSurface — the approaches session's): its
// lanes from its width (3.25 m each, two at least both ways); packed in the surface segment's free pair (scenery-geometry.ts
// surfaceSegment's data[6], data[7]) — data[6] the flags (SurfaceFlag) + 16 one way + 32 lane lines + 512 the pavement [dm] + 32768 on a
// deck (ROAD_ON_BRIDGE) + 65536 × its surface material (road-surface.ts, B1), data[7] the carriageway's half-width; data[11] ≤ 0 minus
// its start's abscissa along its road (B2: the dashes' phase run on) —, a kerbed one's record widened by its pavements: trace.wgsl
// scenerySurface paints them, roadPavement its material.
import type { Primitive } from "./scenery-data";
import { ROAD_CODES, type RoadClass, SegmentFlag, SurfaceFlag } from "./street-cells";
import { segmentSurface } from "./street-detail-prep";
import { ROAD_SURFACE_UNIT, RoadSurface } from "./road-surface";

/** (review A5, 24 Nov 2026) a road's or a railway's surface segment on a bridge's deck: this bit in its data[6] (cell-roads.ts sets it).
 *  The deck alone draws it (trace.wgsl scenerySurface, SC_ON_BRIDGE); every reader of the ground leaves it out — the forest's exclusion,
 *  the decals, the ground's paint: no asphalt nor markings on the river under a deck, no trees cleared under a viaduct by its road */
export const ROAD_ON_BRIDGE = 32768;
/** whether a surface segment rides a deck (ROAD_ON_BRIDGE) — not the ground's */
export const isDeckRoad = (p: Primitive): boolean => p.data.length === 12 && p.data[5]! <= 2 && (p.data[6]! & ROAD_ON_BRIDGE) !== 0;

/** a lane's width [m]: the lanes of a road from its width */
export const LANE_WIDTH_M = 3.25;

/** a road segment's class and way kept at its making (data[6] its ROAD_CODES index, data[7] OpenMapTiles' oneway: 1, −1, 0) */
export function roadClassCode(cls: string): number {
  const i = ROAD_CODES.indexOf(cls.replace("_construction", "") as RoadClass);
  return i > 0 ? i : 0;
}

/** A road segment (kind 1, its class kept) marked in place: its pair packed, a kerbed one widened by its pavements; (B1) its surface
 *  material in the word's bits 16–18 (road-surface.ts). */
export function markRoad(p: Primitive, urban: boolean, material: RoadSurface = RoadSurface.Asphalt): void {
  const d = p.data;
  if (d[5] !== 1 || !(d[6]! > 0)) return;
  const w = 2 * d[4]!,
    oneway = d[7]! !== 0;
  const sf = segmentSurface({
    a: [d[0]!, d[1]!],
    b: [d[2]!, d[3]!],
    width: w,
    lanes: Math.max(oneway ? 1 : 2, Math.round(w / LANE_WIDTH_M)),
    cls: ROAD_CODES[d[6]!]!,
    flags: (d[7]! > 0 ? SegmentFlag.OnewayAlong : d[7]! < 0 ? SegmentFlag.OnewayAgainst : 0) | (urban ? SegmentFlag.Urban : 0),
    level: 0,
    speed: 0,
    s0: 0,
    roadId: 0,
  });
  const pave = sf.flags & SurfaceFlag.Kerb ? sf.pavement : 0;
  d[6] = (sf.flags & 15) + (oneway ? 16 : 0) + 32 * Math.min(15, sf.laneLines) + 512 * Math.round(pave * 10) + material * ROAD_SURFACE_UNIT;
  d[7] = d[4]!;
  if (pave > 0) {
    d[4] = d[4]! + pave;
    p.min[0] -= pave;
    p.min[1] -= pave;
    p.max[0] += pave;
    p.max[1] += pave;
  }
}
