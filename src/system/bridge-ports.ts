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
  /** (street cells' format 6) each point's surveyed deck height over the sea [m] (NaN none); absent: none */
  readonly heights?: readonly number[];
}

/** OpenA / OpenB (street-cells.ts BridgeFlag) */
const OPEN_A = 4,
  OPEN_B = 8;
const KIND_NAME = ["road", "road", "rail", "foot"] as const;
/** the mean of two heights, either NaN or absent left out (NaN: neither) */
const meanOf = (a: number | undefined, b: number | undefined) => {
  const fa = a !== undefined && Number.isFinite(a),
    fb = b !== undefined && Number.isFinite(b);
  return fa && fb ? (a! + b!) / 2 : fa ? a! : fb ? b! : Number.NaN;
};

const reversed = (b: GeoBridge): GeoBridge => ({
  ...b,
  points: [...b.points].reverse(),
  ...(b.heights ? { heights: [...b.heights].reverse() } : {}),
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
        // (the surveyed heights joined as the points — the shared point's the mean of those given)
        ...(a.heights || b.heights
          ? {
              heights: [
                ...(a.heights ?? a.points.map(() => Number.NaN)).slice(0, -1),
                meanOf(a.heights?.[a.points.length - 1], b.heights?.[0]),
                ...(b.heights ?? b.points.map(() => Number.NaN)).slice(1),
              ],
            }
          : {}),
      });
    }
    if (!used.size) {
      // (none met within maxDistM: the halves that overlap or fall short past the edge — each tile's line clipped with its own
      // margin, its segments kept by their middles —, spliced; none either: done)
      const spliced = spliceOpenHalves(out);
      if (!spliced) return out;
      out = spliced;
      continue;
    }
    out.forEach((b, i) => {
      if (!used.has(i)) next.push(b);
    });
    out = next;
  }
  return out;
}

/**
 * (street cells' format 6, 25 Nov 2026) A bridge's surveyed heights with their gaps filled along its axis — linear between two given,
 * the nearest given at either end — or null where fewer than two are given (its profile then its clearance's).
 */
export function fillHeights(points: readonly Wgs84Point[], heights: readonly number[] | undefined): number[] | null {
  if (!heights || heights.length !== points.length) return null;
  const known = heights.map((h, i) => (Number.isFinite(h) ? i : -1)).filter((i) => i >= 0);
  if (known.length < 2) return null;
  const s: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    s.push(s[i - 1]! + Math.hypot((b.lat - a.lat) * 111_132, (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180)));
  }
  return heights.map((h, i) => {
    if (Number.isFinite(h)) return h;
    const a = [...known].reverse().find((k) => k < i),
      b = known.find((k) => k > i);
    if (a === undefined) return heights[b!]!;
    if (b === undefined) return heights[a]!;
    return heights[a]! + ((heights[b]! - heights[a]!) * (s[i]! - s[a]!)) / Math.max(1e-6, s[b]! - s[a]!);
  });
}

/** (25 Nov 2026) two ends turning more than this from a straight line are a fork's, not one structure's [°] (street-detail-prep.ts
 *  BRIDGE_FORK_DEG's) */
const FORK_DEG = 40;

/** a deck piece after joinDeckPieces: an end met mid-way by another deck of its kind and layer (a branch: its height that deck's) */
export interface JoinedDeck {
  readonly bridge: GeoBridge;
  readonly branchA: boolean;
  readonly branchB: boolean;
}

/**
 * (25 Nov 2026 — Pont de Cheviré, campaign 2: a viaduct drawn in four pieces, 1.5–11 m steps between them) Decks that meet join in
 * height, generically — as joinBridgeHalves joins a tile edge's halves —: (1) two closed ends (abutments, as each piece was written)
 * within `maxDistM` of each other, of the same kind and layer, are not abutments but one structure's middle: both made open and joined
 * into one axis (joinBridgeHalves); (2) a closed end within `maxDistM` of another deck's axis of its kind and layer, away from that
 * deck's ends (a branch — a ramp off a viaduct —) is flagged: the scene builds it after the others, its end at that deck's drawn top
 * (the registry's). Ends meeting nothing stay abutments.
 */
export function joinDeckPieces(list: readonly GeoBridge[], maxDistM = 3): JoinedDeck[] {
  const cosL = Math.cos(((list[0]?.points[0]?.lat ?? 0) * Math.PI) / 180);
  const xy = (p: Wgs84Point): [number, number] => [p.lon * 111_320 * cosL, p.lat * 111_132];
  const cell = maxDistM * 2;
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  // (1) the ends' grid — a closed end paired with its nearest partner once: another closed end, or an open one (a tile edge's half
  // whose other half ended on an abutment there — Grenelle's, 25 Nov 2026); the two in line (their ways out within 180° ± BRIDGE_FORK
  // — a fork's ramp is not the bridge going on)
  type End = { i: number; end: 0 | 1; x: number; y: number; dx: number; dy: number; open: boolean };
  const ends: End[] = [];
  const grid = new Map<string, End[]>();
  list.forEach((b, i) => {
    for (const end of [0, 1] as const) {
      if (b.points.length < 2) continue;
      const [x, y] = xy(end ? b.points[b.points.length - 1]! : b.points[0]!);
      const [qx, qy] = xy(end ? b.points[b.points.length - 2]! : b.points[1]!);
      const L = Math.hypot(x - qx, y - qy) || 1;
      const e = { i, end, x, y, dx: (x - qx) / L, dy: (y - qy) / L, open: !!(b.flags & (end ? OPEN_B : OPEN_A)) };
      ends.push(e);
      const k = key(x, y);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(e);
    }
  });
  const inLine = -Math.cos((FORK_DEG * Math.PI) / 180);
  const open = list.map(() => [false, false]);
  const paired = new Set<End>();
  for (const e of ends) {
    if (e.open || paired.has(e)) continue;
    let best: End | null = null,
      bestD = maxDistM;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const f of grid.get(`${Math.floor(e.x / cell) + dx},${Math.floor(e.y / cell) + dy}`) ?? []) {
          if (f.i === e.i || paired.has(f)) continue;
          const a = list[e.i]!,
            b = list[f.i]!;
          if (a.kind !== b.kind || a.layer !== b.layer) continue;
          if (e.dx * f.dx + e.dy * f.dy > inLine) continue;
          const d = Math.hypot(f.x - e.x, f.y - e.y);
          if (d <= bestD) {
            bestD = d;
            best = f;
          }
        }
    if (!best) continue;
    paired.add(e);
    paired.add(best);
    open[e.i]![e.end] = true;
    open[best.i]![best.end] = true;
  }
  const flagged = list.map((b, i) =>
    open[i]![0] || open[i]![1] ? { ...b, flags: b.flags | (open[i]![0] ? OPEN_A : 0) | (open[i]![1] ? OPEN_B : 0) } : b,
  );
  // (the paired ends' flags as written: a pair joinBridgeHalves did not join — a third end nearer — goes back to an abutment)
  // (a bridge joinBridgeHalves left alone comes back with its own points' array — the original's)
  const byPoints = new Map(list.map((b) => [b.points, b] as const));
  const joined = joinBridgeHalves(flagged, maxDistM).map((b) => {
    const orig = byPoints.get(b.points);
    return orig ? { ...b, flags: orig.flags } : b;
  });
  // (2) the branches: a closed end on another deck's axis (its segments' grid), away from that deck's own ends
  const segCell = 40;
  const segs = new Map<string, { j: number; a: [number, number]; b: [number, number] }[]>();
  joined.forEach((b, j) => {
    for (let k = 1; k < b.points.length; k++) {
      const a = xy(b.points[k - 1]!),
        c = xy(b.points[k]!);
      const x0 = Math.floor((Math.min(a[0], c[0]) - maxDistM) / segCell),
        x1 = Math.floor((Math.max(a[0], c[0]) + maxDistM) / segCell),
        y0 = Math.floor((Math.min(a[1], c[1]) - maxDistM) / segCell),
        y1 = Math.floor((Math.max(a[1], c[1]) + maxDistM) / segCell);
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++) {
          const kk = `${gx},${gy}`;
          (segs.get(kk) ?? segs.set(kk, []).get(kk)!).push({ j, a, b: c });
        }
    }
  });
  const onAxis = (i: number, p: Wgs84Point) => {
    const [x, y] = xy(p);
    for (const s of segs.get(`${Math.floor(x / segCell)},${Math.floor(y / segCell)}`) ?? []) {
      if (s.j === i) continue;
      const o = joined[s.j]!,
        me = joined[i]!;
      if (o.kind !== me.kind || o.layer !== me.layer) continue;
      const dx = s.b[0] - s.a[0],
        dy = s.b[1] - s.a[1];
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (y - s.a[1]) * dy) / Math.max(dx * dx + dy * dy, 1e-9)));
      if (Math.hypot(x - s.a[0] - t * dx, y - s.a[1] - t * dy) > maxDistM) continue;
      // (not at that deck's own end — two ends that met are (1)'s; an end near another's end is its abutment's neighbour, not a branch)
      const [ex0, ey0] = xy(o.points[0]!),
        [ex1, ey1] = xy(o.points[o.points.length - 1]!);
      if (Math.hypot(x - ex0, y - ey0) <= maxDistM || Math.hypot(x - ex1, y - ey1) <= maxDistM) continue;
      return true;
    }
    return false;
  };
  return joined.map((b, i) => ({
    bridge: b,
    branchA: !(b.flags & OPEN_A) && b.points.length >= 2 && onAxis(i, b.points[0]!),
    branchB: !(b.flags & OPEN_B) && b.points.length >= 2 && onAxis(i, b.points[b.points.length - 1]!),
  }));
}

/** (25 Nov 2026) an open end's partner past the edge: along its way within this [m], this far across it at most [m] */
export const HALF_GAP_M = 80;
export const HALF_SIDE_M = 2.5;

/**
 * (25 Nov 2026 — Pont de Cheviré, campaign 2: its halves 30 m apart along the deck at the z 14 edge, never joined within 3 m) Two halves
 * of a bridge whose open ends do not meet: each tile's line is clipped with its own margin and its segments kept by their middles, so
 * one half runs past the edge over the other (an overlap) or stops short of it (a gap) by up to a segment. An open end B of one (its way
 * out `d`) and an open end A of another — the same kind and layer, the second's way out against the first's, its point within
 * HALF_SIDE_M of the first's line and HALF_GAP_M along it either way — are spliced: the first's points past the second's open point
 * dropped (an overlap), then the second's. The pairs nearest along first, each bridge in one a call (joinBridgeHalves calls again:
 * a viaduct over three tiles). Null: none.
 */
export function spliceOpenHalves(list: readonly GeoBridge[]): GeoBridge[] | null {
  const lat0 = list[0]?.points[0]?.lat ?? 0;
  const cosL = Math.cos((lat0 * Math.PI) / 180);
  const xy = (p: Wgs84Point): [number, number] => [p.lon * 111_320 * cosL, p.lat * 111_132];
  // (each open end oriented as an end B: its point, its way out)
  type End = { i: number; end: 0 | 1; p: [number, number]; d: [number, number] };
  const ends: End[] = [];
  list.forEach((b, i) => {
    if (b.points.length < 2) return;
    for (const end of [0, 1] as const) {
      if (!(b.flags & (end ? OPEN_B : OPEN_A))) continue;
      const p = xy(end ? b.points[b.points.length - 1]! : b.points[0]!),
        q = xy(end ? b.points[b.points.length - 2]! : b.points[1]!);
      const L = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
      ends.push({ i, end, p, d: [(p[0] - q[0]) / L, (p[1] - q[1]) / L] });
    }
  });
  const pairs: { a: End; b: End; along: number }[] = [];
  for (const a of ends)
    for (const b of ends) {
      if (a.i === b.i) continue;
      const A = list[a.i]!,
        B = list[b.i]!;
      if (A.kind !== B.kind || A.layer !== B.layer) continue;
      if (a.d[0] * b.d[0] + a.d[1] * b.d[1] > -0.8) continue;
      const along = (b.p[0] - a.p[0]) * a.d[0] + (b.p[1] - a.p[1]) * a.d[1],
        side = Math.abs((b.p[0] - a.p[0]) * a.d[1] - (b.p[1] - a.p[1]) * a.d[0]);
      if (Math.abs(along) > HALF_GAP_M || side > HALF_SIDE_M) continue;
      pairs.push({ a, b, along });
    }
  if (!pairs.length) return null;
  // (the nearest along first, each bridge in one pair at most this call)
  pairs.sort((x, y) => Math.abs(x.along) - Math.abs(y.along));
  const taken = new Set<number>();
  const out: GeoBridge[] = [];
  for (const { a, b } of pairs) {
    if (taken.has(a.i) || taken.has(b.i)) continue;
    taken.add(a.i);
    taken.add(b.i);
    // (the first oriented to end at its open B, the second to start at its open A)
    const A = a.end === 1 ? list[a.i]! : reversed(list[a.i]!);
    const B = b.end === 0 ? list[b.i]! : reversed(list[b.i]!);
    const q = xy(B.points[0]!);
    // (the first's points past the second's open point — along the first's way out — dropped: the overlap)
    let keep = A.points.length;
    while (keep > 1) {
      const p = xy(A.points[keep - 1]!);
      if ((p[0] - q[0]) * a.d[0] + (p[1] - q[1]) * a.d[1] <= 0) break;
      keep--;
    }
    const hA = A.heights ?? A.points.map(() => Number.NaN),
      hB = B.heights ?? B.points.map(() => Number.NaN);
    out.push({
      id: Math.min(A.id >>> 0, B.id >>> 0),
      kind: A.kind,
      flags: ((A.flags | B.flags) & ~(OPEN_A | OPEN_B)) | (A.flags & OPEN_A) | (B.flags & OPEN_B),
      width: Math.max(A.width, B.width),
      layer: A.layer,
      crossed: A.crossed | B.crossed,
      clearance: Math.max(A.clearance, B.clearance),
      points: [...A.points.slice(0, keep), ...B.points],
      ...(A.heights || B.heights ? { heights: [...hA.slice(0, keep), ...hB] } : {}),
    });
  }
  return [...list.filter((_, i) => !taken.has(i)), ...out];
}

/**
 * (25 Nov 2026 — Pont de Cheviré's two carriageways, kerr-mini: two decks 10.6 m apart, 15.5 m wide — overlapping by 5 m —, each on
 * its own surveyed Z, 0.3–0.4 m apart: a ridge along the overlap) Twin decks — surveyed, of the same kind and layer, parallel (their
 * axes within 18°), overlapping across (their axes nearer than their half-widths' sum) — take the mean of their two surveys wherever
 * they overlap: one surface across them (the real bridge's one deck), the carriageways' cross-fall (≤ a few decimetres) left out.
 * Outside the overlap each keeps its own. The surveyed heights read as `heights` (NaN none); a deck without them is left alone.
 */
export function levelTwinDecks(list: readonly GeoBridge[]): GeoBridge[] {
  const lat0 = list[0]?.points[0]?.lat ?? 0;
  const cosL = Math.cos((lat0 * Math.PI) / 180);
  const xy = (p: Wgs84Point): [number, number] => [p.lon * 111_320 * cosL, p.lat * 111_132];
  const P = list.map((b) => b.points.map(xy));
  const box = P.map((pts) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return [x0, y0, x1, y1] as const;
  });
  const out = list.map((b) => (b.heights ? [...b.heights] : null));
  /** B's surveyed height under A's point k, where they overlap and run parallel (NaN: not there) */
  const under = (i: number, k: number, j: number): number => {
    const A = list[i]!,
      B = list[j]!,
      pa = P[i]![k]!,
      pb = P[j]!;
    const reach = (A.width + B.width) / 2 - 0.5;
    const ka = Math.min(k, P[i]!.length - 2);
    const tax = P[i]![ka + 1]![0] - P[i]![ka]![0],
      tay = P[i]![ka + 1]![1] - P[i]![ka]![1];
    const la = Math.hypot(tax, tay) || 1;
    let best = reach,
      h = Number.NaN;
    for (let s = 1; s < pb.length; s++) {
      const a = pb[s - 1]!,
        c = pb[s]!;
      const dx = c[0] - a[0],
        dy = c[1] - a[1];
      const L2 = dx * dx + dy * dy;
      if (L2 < 1e-6) continue;
      const t = ((pa[0] - a[0]) * dx + (pa[1] - a[1]) * dy) / L2;
      if (t < 0 || t > 1) continue;
      const d = Math.abs((pa[0] - a[0]) * dy - (pa[1] - a[1]) * dx) / Math.sqrt(L2);
      if (d >= best) continue;
      if (Math.abs((tax * dx + tay * dy) / (la * Math.sqrt(L2))) < 0.95) continue;
      const ha = B.heights![s - 1]!,
        hc = B.heights![s]!;
      if (!Number.isFinite(ha) || !Number.isFinite(hc)) continue;
      best = d;
      h = ha + (hc - ha) * t;
    }
    return h;
  };
  for (let i = 0; i < list.length; i++)
    for (let j = 0; j < list.length; j++) {
      if (i === j || !list[i]!.heights || !list[j]!.heights) continue;
      const A = list[i]!,
        B = list[j]!;
      if (A.kind !== B.kind || A.layer !== B.layer) continue;
      const m = (A.width + B.width) / 2,
        a = box[i]!,
        b = box[j]!;
      if (a[0] > b[2] + m || b[0] > a[2] + m || a[1] > b[3] + m || b[1] > a[3] + m) continue;
      for (let k = 0; k < A.points.length; k++) {
        const own = A.heights![k]!;
        if (!Number.isFinite(own)) continue;
        const h = under(i, k, j);
        if (Number.isFinite(h)) out[i]![k] = (own + h) / 2;
      }
    }
  return list.map((b, i) => (out[i] ? { ...b, heights: out[i]! } : b));
}
