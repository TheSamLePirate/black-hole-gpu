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
 * + 16 one way + 32 lane lines + 512 the pavement [dm], data[7] the carriageway's half-width, a kerbed one widened by its pavements.
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
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.1) continue;
      const p = surfaceSegment(a, b, Math.max(1, s.width), 1, roadColour(s.cls));
      const sf = readSurface(buf, i);
      const oneway = !!(s.flags & (SegmentFlag.OnewayAlong | SegmentFlag.OnewayAgainst));
      const pave = sf.flags & SurfaceFlag.Kerb ? sf.pavement : 0;
      const r = p.data[4]!;
      p.data[6] = sf.flags + (oneway ? 16 : 0) + 32 * Math.min(15, sf.laneLines) + 512 * Math.round(pave * 10);
      p.data[7] = r;
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
