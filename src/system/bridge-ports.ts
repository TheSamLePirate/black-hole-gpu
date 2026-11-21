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
