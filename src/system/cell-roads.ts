// PLAN-J8 J8-RP RP2 — the near scene's roads in France from the street cells (kerr-street-v4, street-cells.ts roadRuns — the approaches
// session's: the BD TOPO's axis, measured width, lanes, way, town) instead of OpenMapTiles' lines (their width the class's, their axis
// not the BD TOPO's): each run's segments as the scene's surface segments (scenery-geometry.ts surfaceSegment, kind 1), their markings,
// kerb and pavement packed from the cell's own surfaces (street-cells.ts readSurface — VB2's rules applied at the preparation) as
// road-markings.ts packs them; none on a bridge (its deck is the bridge's — RP4) nor in a tunnel. Pure but for `toLocal`.
import type { Primitive } from "./scenery-data";
import { surfaceSegment } from "./scenery-geometry";
import { readSegment, readStreetHeader, roadRuns, SegmentFlag, SurfaceFlag, readSurface } from "./street-cells";

/** a road's colour by its class: asphalt, a track's or a path's earth, steps' stone */
function roadColour(cls: string): number[] {
  if (cls === "track" || cls === "path") return [0.19, 0.145, 0.095];
  if (cls === "steps") return [0.3, 0.29, 0.27];
  return [0.095, 0.098, 0.1];
}

/**
 * A street cell's roads as the scene's surface segments: `toLocal(east, north)` the cell's frame [m] to the scene's (z 0 — the surfaces
 * are flat, the ground's relief theirs). Each segment's record packed as road-markings.ts packs one: data[6] the flags (SurfaceFlag)
 * + 16 one way + 32 lane lines + 512 the pavement [dm]. data[7] is the carriageway's half-width, negative for surveyed widths
 * away from fords. The segment is widened by its pavements when kerbed.
 */
export function cellRoadSurfaces(buf: ArrayBuffer, toLocal: (east: number, north: number) => [number, number, number]): Primitive[] {
  const h = readStreetHeader(buf);
  if (!h) return [];
  const out: Primitive[] = [];
  for (const run of roadRuns(buf))
    for (const i of run.segments) {
      const s = readSegment(buf, i);
      if (s.flags & (SegmentFlag.Bridge | SegmentFlag.Tunnel)) continue;
      const a = toLocal(s.a[0], s.a[1]),
        b = toLocal(s.b[0], s.b[1]);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.1) continue;
      // (J8-RP RP9, KSC5: a railway's segment — its tracks as the scene's rails (kind 2: their rails and sleepers painted), one strip
      // of 3 m a track, 4.5 m apart across its axis; no marking)
      if (s.cls === "rail") {
        const n = Math.max(1, s.lanes);
        const nx = -(b[1] - a[1]) / L,
          ny = (b[0] - a[0]) / L;
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * 4.5;
          out.push(surfaceSegment([a[0] + nx * off, a[1] + ny * off, 0], [b[0] + nx * off, b[1] + ny * off, 0], 3, 2, [0.1, 0.085, 0.06]));
        }
        continue;
      }
      const p = surfaceSegment(a, b, Math.max(1, s.width), 1, roadColour(s.cls));
      const sf = readSurface(buf, i);
      const oneway = !!(s.flags & (SegmentFlag.OnewayAlong | SegmentFlag.OnewayAgainst));
      const pave = sf.flags & SurfaceFlag.Kerb ? sf.pavement : 0;
      const r = p.data[4]!;
      p.data[6] = sf.flags + (oneway ? 16 : 0) + 32 * Math.min(15, sf.laneLines) + 512 * Math.round(pave * 10);
      p.data[7] = s.flags & (SegmentFlag.InferredWidth | SegmentFlag.Ford) ? r : -r;
      if (pave > 0) {
        p.data[4] = r + pave;
        p.min[0] -= pave;
        p.min[1] -= pave;
        p.max[0] += pave;
        p.max[1] += pave;
      }
      out.push(p);
    }
  return out;
}

/** (J8-RP RP9) the catenary's masts along an electrified railway: one every CATENARY_SPACING_M, beside the outer track */
export const CATENARY_SPACING_M = 60;

/**
 * A street cell's catenary masts (KSC5: a railway's segment with SurfaceFlag.Electrified): each its foot in the scene's frame (z the
 * segment's ends' — `toLocal`'s — between them) and the way across to the tracks (unit, x y) and its arm's reach over them [m].
 */
export function catenaryMasts(
  buf: ArrayBuffer,
  toLocal: (east: number, north: number) => [number, number, number],
): { foot: [number, number, number]; across: [number, number]; reach: number }[] {
  const h = readStreetHeader(buf);
  if (!h) return [];
  const out: { foot: [number, number, number]; across: [number, number]; reach: number }[] = [];
  for (let i = 0; i < h.segmentCount; i++) {
    const s = readSegment(buf, i);
    if (s.cls !== "rail" || s.flags & SegmentFlag.Tunnel || !(readSurface(buf, i).flags & SurfaceFlag.Electrified)) continue;
    const a = toLocal(s.a[0], s.a[1]),
      b = toLocal(s.b[0], s.b[1]);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1) continue;
    const ux = (b[0] - a[0]) / L,
      uy = (b[1] - a[1]) / L;
    const n = Math.max(1, s.lanes);
    const side = ((n - 1) / 2) * 4.5 + 3.2;
    // (at whole multiples of the spacing along its road — a road's masts in step from one segment to the next)
    for (let d = (CATENARY_SPACING_M - (s.s0 % CATENARY_SPACING_M)) % CATENARY_SPACING_M; d < L; d += CATENARY_SPACING_M)
      out.push({
        foot: [a[0] + ux * d - uy * side, a[1] + uy * d + ux * side, a[2] + ((b[2] - a[2]) * d) / L],
        across: [uy, -ux],
        reach: side + ((n - 1) / 2) * 4.5,
      });
  }
  return out;
}
