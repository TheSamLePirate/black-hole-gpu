// Bridge & Road AAA — Ports, Global Identity and Multi-Tile Continuity (PLAN-PONT-ROUTES-AAA.md PR1)
// Provides canonical global identity, inter-cell border ports, and mode-safe corridor resolution.

export interface Wgs84Point {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Generates a stable, global canonical identity key for a bridge across any number
 * of cell local frames or tile boundaries.
 * 1e5 degrees ≈ 1.1 metres precision, immune to local cell offset discrepancies.
 */
export function bridgeCanonicalKey(id: number, firstPointWgs84: Wgs84Point): string {
  const lat1e5 = Math.round(firstPointWgs84.lat * 1e5);
  const lon1e5 = Math.round(firstPointWgs84.lon * 1e5);
  return `bridge:${id >>> 0}:${lat1e5}:${lon1e5}`;
}

export interface InterCellPort {
  readonly id: string;
  readonly bridgeId: number;
  readonly kind: "road" | "rail" | "foot";
  readonly level: number;
  readonly pointWgs84: Wgs84Point;
  readonly headingRad: number;
  readonly width: number;
  readonly isOpen: boolean;
}

/**
 * Matches open ports across tile/cell boundaries within tolerance.
 * Pairs matching open ports that have identical level and mode, and opposite headings.
 */
export function matchInterCellPorts(ports: readonly InterCellPort[], maxDistM = 5.0): Map<string, string> {
  const matches = new Map<string, string>();
  const open = ports.filter((p) => p.isOpen);

  for (let i = 0; i < open.length; i++) {
    const p1 = open[i]!;
    if (matches.has(p1.id)) continue;

    let bestDist = maxDistM;
    let bestMatch: InterCellPort | null = null;

    for (let j = i + 1; j < open.length; j++) {
      const p2 = open[j]!;
      if (matches.has(p2.id) || p1.kind !== p2.kind || p1.level !== p2.level) continue;

      // Approximate WGS84 distance in metres
      const dLat = (p2.pointWgs84.lat - p1.pointWgs84.lat) * 111139;
      const cosLat = Math.cos((p1.pointWgs84.lat * Math.PI) / 180);
      const dLon = (p2.pointWgs84.lon - p1.pointWgs84.lon) * 111139 * cosLat;
      const dist = Math.hypot(dLat, dLon);

      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = p2;
      }
    }

    if (bestMatch) {
      matches.set(p1.id, bestMatch.id);
      matches.set(bestMatch.id, p1.id);
    }
  }

  return matches;
}

/**
 * A vector tile's line clipped to its own square [0, e)² (its buffer's overhang left to the neighbour, which holds that part): the
 * pieces inside, each with its ends flagged open where the square's edge cut it — OpenMapTiles' bridges abroad, whose halves
 * joinBridgeHalves joins as the street cells' (review A1: the tile's owner by its midpoint took the line with its overhang, its ends
 * treated as abutments wherever the tiles cut it).
 */
export function clipLineToTile(
  line: readonly { x: number; y: number }[],
  e: number,
): { points: { x: number; y: number }[]; openA: boolean; openB: boolean }[] {
  const out: { points: { x: number; y: number }[]; openA: boolean; openB: boolean }[] = [];
  let cur: { points: { x: number; y: number }[]; openA: boolean; openB: boolean } | null = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!,
      b = line[i + 1]!;
    // (Liang–Barsky over the segment)
    let t0 = 0,
      t1 = 1;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    let ok = true;
    for (const [p, q] of [
      [-dx, a.x],
      [dx, e - a.x],
      [-dy, a.y],
      [dy, e - a.y],
    ] as const) {
      if (p === 0) {
        if (q < 0) ok = false;
        continue;
      }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
    if (!ok || t0 > t1) {
      if (cur) {
        out.push(cur);
        cur = null;
      }
      continue;
    }
    const pa = t0 > 0 ? { x: a.x + dx * t0, y: a.y + dy * t0 } : a,
      pb = t1 < 1 ? { x: a.x + dx * t1, y: a.y + dy * t1 } : b;
    if (!cur) cur = { points: [pa], openA: t0 > 0, openB: false };
    cur.points.push(pb);
    if (t1 < 1) {
      cur.openB = true;
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.filter((c) => c.points.length >= 2);
}

/** a bridge as the scene reads it from a street cell: its record's attributes and its axis in WGS84 (its ends its abutments, or its
 *  open ends — OpenA / OpenB — where a z 14 tile's edge cut it) */
export interface GeoBridge {
  readonly id: number;
  /** BridgeKind (1 road, 2 rail, 3 foot) */
  readonly kind: number;
  /** BridgeFlag bits */
  readonly flags: number;
  readonly width: number;
  readonly layer: number;
  readonly crossed: number;
  readonly clearance: number;
  readonly points: readonly Wgs84Point[];
}

/** OpenA / OpenB (street-cells.ts BridgeFlag) */
const OPEN_A = 4,
  OPEN_B = 8;
const KIND_NAME = ["road", "road", "rail", "foot"] as const;

const reversed = (b: GeoBridge): GeoBridge => ({
  ...b,
  points: [...b.points].reverse(),
  flags: (b.flags & ~(OPEN_A | OPEN_B)) | (b.flags & OPEN_A ? OPEN_B : 0) | (b.flags & OPEN_B ? OPEN_A : 0),
});

/**
 * Review A1 (24 Nov 2026) — a bridge cut by a z 14 tile's edge is written as two halves, one in each tile's cells, each its open end at
 * the same point of the edge (street-detail-prep.ts chainBridges: OpenA / OpenB). Each half was built on its own, its open end set on
 * the ground there — a deck that dropped to the river mid-span. Here the halves whose open ends meet (matchInterCellPorts: the same
 * kind, the same layer, within `maxDistM`) are joined into one axis — the first's points then the second's (their shared point once) —,
 * repeatedly (a viaduct over three tiles), before any profile is built: one bridge, one continuous profile. An open end with no partner
 * (its other half in a cell not read) stays open — BridgeContinuousProfile keeps it mid-span, never on the ground.
 */
export function joinBridgeHalves(list: readonly GeoBridge[], maxDistM = 3): GeoBridge[] {
  let out = [...list];
  for (let guard = 0; guard < 16; guard++) {
    const ports: InterCellPort[] = [];
    out.forEach((b, i) => {
      for (const end of [0, 1] as const) {
        if (!(b.flags & (end ? OPEN_B : OPEN_A))) continue;
        const p = end ? b.points[b.points.length - 1]! : b.points[0]!;
        ports.push({
          id: `${i}:${end}`,
          bridgeId: b.id,
          kind: KIND_NAME[b.kind] ?? "road",
          level: b.layer,
          pointWgs84: p,
          headingRad: 0,
          width: b.width,
          isOpen: true,
        });
      }
    });
    const m = matchInterCellPorts(ports, maxDistM);
    const used = new Set<number>();
    const next: GeoBridge[] = [];
    for (const [pa, pb] of m) {
      const [ia, ea] = pa.split(":").map(Number) as [number, number];
      const [ib, eb] = pb.split(":").map(Number) as [number, number];
      if (ia >= ib || used.has(ia) || used.has(ib)) continue;
      // (the first ends at its open B, the second starts at its open A)
      const a = ea === 1 ? out[ia]! : reversed(out[ia]!);
      const b = eb === 0 ? out[ib]! : reversed(out[ib]!);
      used.add(ia);
      used.add(ib);
      next.push({
        id: Math.min(a.id >>> 0, b.id >>> 0),
        kind: a.kind,
        flags: ((a.flags | b.flags) & ~(OPEN_A | OPEN_B)) | (a.flags & OPEN_A) | (b.flags & OPEN_B),
        width: Math.max(a.width, b.width),
        layer: a.layer,
        crossed: a.crossed | b.crossed,
        clearance: Math.max(a.clearance, b.clearance),
        points: [...a.points, ...b.points.slice(1)],
      });
    }
    if (!used.size) return out;
    out.forEach((b, i) => {
      if (!used.has(i)) next.push(b);
    });
    out = next;
  }
  return out;
}
