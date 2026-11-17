// PLAN-J8 J8-VB (VB2, VB5a, VB6's data, VB7) — a street cell's details prepared from its segments and junctions (street-cells.ts KSC3 —
// its rules in its header): each segment's surface (the markings, the kerb and pavements its class, width, lanes, way and place call
// for), its continuations (the next segment driven at each end: its own road first, else through a junction the straightest way the
// one ways allow), and the furniture of its junctions and fast roads (stop and yield lines, crossings, signals, guardrails). Every piece
// inferred: the BD TOPO and OpenMapTiles give the roads' widths and lanes, not their markings, crossings or signals. Pure, in the cell's
// frame (east, north metres): street-prep.ts runs it for each cell, the tests too.
import {
  CROSSING_BEYOND_M,
  FURNITURE_ARM_MIN_M,
  FurnitureFlag,
  FurnitureKind,
  type FurnitureRecord,
  GUARDRAIL_OFF_M,
  JunctionFlag,
  type JunctionRecord,
  JUNCTION_M,
  NEXT_ELSEWHERE,
  NEXT_NONE,
  NEXT_REVERSED,
  PAVEMENT_M,
  type RoadClass,
  type RoadSegmentRecord,
  SegmentFlag,
  type SegmentNext,
  type SegmentSurface,
  SIGNAL_WIDE_M,
  STOP_BACK_M,
  SURFACE_CENTRE_MIN_M,
  SURFACE_EDGE_MIN_M,
  SURFACE_MINOR_CENTRE_M,
  SurfaceFlag,
} from "./street-cells";

/** whether each end of a segment is its road piece's own end (a: its start, b: its end) — the cut's (street-prep.ts road) */
export interface PieceEnds {
  a: boolean;
  b: boolean;
}

const MAJOR = new Set<RoadClass>(["motorway", "trunk", "primary", "secondary"]);
const NO_CROSSING = new Set<RoadClass>(["motorway", "trunk", "service", "track", "path", "steps"]);
const NO_SURFACE = new Set<RoadClass>(["track", "path", "steps", ""]);

/** A segment's carriageway (VB2): its markings, its kerb and pavements (street-cells.ts's rules). */
export function segmentSurface(s: RoadSegmentRecord): SegmentSurface {
  const out: SegmentSurface = { flags: 0, laneLines: 0, pavement: 0 };
  if (NO_SURFACE.has(s.cls) || s.flags & SegmentFlag.Ford) return out;
  const urban = !!(s.flags & SegmentFlag.Urban),
    oneway = !!(s.flags & (SegmentFlag.OnewayAlong | SegmentFlag.OnewayAgainst)),
    round = !!(s.flags & SegmentFlag.Roundabout);
  const lanes = Math.max(1, s.lanes);
  if (
    s.cls === "motorway" ||
    s.cls === "trunk" ||
    (!urban && ["primary", "secondary", "tertiary"].includes(s.cls) && s.width >= SURFACE_EDGE_MIN_M)
  )
    out.flags |= SurfaceFlag.EdgeLines;
  const centreMin = s.cls === "minor" ? SURFACE_MINOR_CENTRE_M : SURFACE_CENTRE_MIN_M;
  const centreClass = ["motorway", "trunk", "primary", "secondary", "tertiary"].includes(s.cls) || (s.cls === "minor" && urban);
  if (!oneway && !round && lanes >= 2 && centreClass && s.width >= centreMin)
    out.flags |= s.cls === "trunk" ? SurfaceFlag.CentreSolid : SurfaceFlag.CentreDashed;
  out.laneLines = oneway || round ? lanes - 1 : Math.max(0, lanes - 2);
  const pave = PAVEMENT_M[s.cls];
  if (urban && pave !== undefined && !(s.flags & (SegmentFlag.Bridge | SegmentFlag.Tunnel))) {
    out.flags |= SurfaceFlag.Kerb;
    out.pavement = pave;
  }
  return out;
}

/**
 * Each segment's continuations (VB6): at b (driving a → b) and at a (driving b → a), the next segment's index (NEXT_REVERSED set when it
 * is driven b → a). `pieces`: whether each end is its road piece's own end; `nearEdge(e, n)`: whether a place lies at the cell's edge —
 * an end with nothing met in the cell is NEXT_ELSEWHERE when its road goes on (not its piece's end) or it lies at the edge, NEXT_NONE else.
 */
export function segmentNexts(
  segs: readonly RoadSegmentRecord[],
  pieces: readonly PieceEnds[],
  nearEdge: (e: number, n: number) => boolean,
): SegmentNext[] {
  // (the ends in a grid of JUNCTION_M: [segment, 0 for a, 1 for b])
  const grid = new Map<number, [number, 0 | 1][]>();
  const key = (e: number, n: number) => (Math.floor(e / JUNCTION_M) + 32768) * 65536 + (Math.floor(n / JUNCTION_M) + 32768);
  segs.forEach((s, i) => {
    for (const end of [0, 1] as const) {
      const p = end ? s.b : s.a;
      const k = key(p[0], p[1]);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push([i, end]);
    }
  });
  const may = (s: RoadSegmentRecord, from: 0 | 1) =>
    from === 0 ? !(s.flags & SegmentFlag.OnewayAgainst) : !(s.flags & SegmentFlag.OnewayAlong);
  const next = (i: number, end: 0 | 1): number => {
    const s = segs[i]!;
    const p = end ? s.b : s.a,
      q = end ? s.a : s.b;
    const L = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
    const dx = (p[0] - q[0]) / L,
      dy = (p[1] - q[1]) / L;
    let best = -1,
      bestScore = -Infinity;
    const gi = Math.floor(p[0] / JUNCTION_M),
      gj = Math.floor(p[1] / JUNCTION_M);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const [j, e] of grid.get((gi + a + 32768) * 65536 + (gj + b + 32768)) ?? []) {
          if (j === i || j >= NEXT_REVERSED - 2) continue;
          const t = segs[j]!;
          const m = e ? t.b : t.a,
            o = e ? t.a : t.b;
          if (Math.hypot(m[0] - p[0], m[1] - p[1]) > JUNCTION_M) continue;
          // (entered at its end e: driven away from it — allowed by its way —, on the same level)
          if (!may(t, e) || t.level !== s.level) continue;
          const tl = Math.hypot(o[0] - m[0], o[1] - m[1]) || 1;
          const straight = ((o[0] - m[0]) * dx + (o[1] - m[1]) * dy) / tl;
          // (its own road first — a piece's next segment —, then the straightest; never straight back)
          const score = (t.roadId === s.roadId ? 10 : 0) + straight;
          if (straight < -0.95) continue;
          if (score > bestScore) {
            bestScore = score;
            best = j | (e ? NEXT_REVERSED : 0);
          }
        }
    if (best >= 0) return best;
    const piece = end ? pieces[i]?.b : pieces[i]?.a;
    return !piece || nearEdge(p[0], p[1]) ? NEXT_ELSEWHERE : NEXT_NONE;
  };
  // (an index past 15 bits cannot be said: none — never met, a cell holds a few thousand)
  return segs.map((_, i) => (i >= NEXT_REVERSED - 2 ? { a: NEXT_NONE, b: NEXT_NONE } : { b: next(i, 1), a: next(i, 0) }));
}

/**
 * The furniture (VB7): at each urban junction of three arms or more, none a bridge or a tunnel, its stop or yield lines, crossings and
 * signals; along the fast roads outside the towns and the bridges, their guardrails. `leftHand`: the traffic's side.
 */
export function streetFurniture(
  segs: readonly RoadSegmentRecord[],
  junctions: readonly JunctionRecord[],
  leftHand: boolean,
): FurnitureRecord[] {
  const out: FurnitureRecord[] = [];
  const at = (e: number, n: number) => (Math.floor(e / 4) + 32768) * 65536 + (Math.floor(n / 4) + 32768);
  const ends = new Map<number, [number, 0 | 1][]>();
  segs.forEach((s, i) => {
    for (const end of [0, 1] as const) {
      const p = end ? s.b : s.a;
      const k = at(p[0], p[1]);
      (ends.get(k) ?? ends.set(k, []).get(k)!).push([i, end]);
    }
  });
  const side = leftHand ? -1 : 1;
  junctions.forEach((J, ji) => {
    // (its arms: the segments' ends within JUNCTION_M of the members — the centre their mean: within 1.5 JUNCTION_M of it)
    const arms: { s: RoadSegmentRecord; end: 0 | 1 }[] = [];
    const gi = Math.floor(J.east / 4),
      gj = Math.floor(J.north / 4);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const [i, end] of ends.get((gi + a + 32768) * 65536 + (gj + b + 32768)) ?? []) {
          const s = segs[i]!;
          const p = end ? s.b : s.a;
          if (Math.hypot(p[0] - J.east, p[1] - J.north) <= 1.5 * JUNCTION_M) arms.push({ s, end });
        }
    if (arms.length < 3) return;
    if (!arms.some((x) => x.s.flags & SegmentFlag.Urban)) return;
    if (arms.some((x) => x.s.flags & (SegmentFlag.Bridge | SegmentFlag.Tunnel)) || J.flags & JunctionFlag.Levels) return;
    const round = !!(J.flags & JunctionFlag.Roundabout);
    const signals = !round && (J.width >= SIGNAL_WIDE_M || (arms.length >= 4 && arms.filter((x) => MAJOR.has(x.s.cls)).length >= 2));
    for (const { s, end } of arms) {
      if (round && s.flags & SegmentFlag.Roundabout) continue;
      if (s.cls === "track" || s.cls === "path" || s.cls === "steps") continue;
      const p = end ? s.b : s.a,
        q = end ? s.a : s.b;
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      // (u: the arm's way out of the junction; r: the right of that way out — the lanes coming in, driven along −u, lie on −r's side)
      const ux = (q[0] - p[0]) / (L || 1),
        uy = (q[1] - p[1]) / (L || 1);
      const rx = side * uy,
        ry = side * -ux;
      const back = J.width / 2 + STOP_BACK_M;
      if (L < back + CROSSING_BEYOND_M + FURNITURE_ARM_MIN_M) continue;
      // (coming in: driven from q to p — allowed unless its way says the other)
      const inbound = end ? !(s.flags & SegmentFlag.OnewayAgainst) : !(s.flags & SegmentFlag.OnewayAlong);
      const oneway = !!(s.flags & (SegmentFlag.OnewayAlong | SegmentFlag.OnewayAgainst));
      const heading = Math.atan2(uy, ux);
      const cx = p[0] + ux * back,
        cy = p[1] + uy * back;
      if (inbound) {
        // (a two-way's line across its incoming half — on −r's side —, a one way's across it all)
        const half = oneway ? 0 : s.width / 4;
        out.push({
          east: cx - rx * half,
          north: cy - ry * half,
          heading,
          length: oneway ? s.width : s.width / 2,
          kind: FurnitureKind.StopLine,
          flags: FurnitureFlag.Inferred | (round ? FurnitureFlag.Yield : 0),
          junction: ji,
        });
        if (signals)
          out.push({
            east: cx - rx * (s.width / 2 + 0.5),
            north: cy - ry * (s.width / 2 + 0.5),
            heading,
            length: 0,
            kind: FurnitureKind.Signal,
            flags: FurnitureFlag.Inferred,
            junction: ji,
          });
      }
      if (!NO_CROSSING.has(s.cls))
        out.push({
          east: p[0] + ux * (back + CROSSING_BEYOND_M),
          north: p[1] + uy * (back + CROSSING_BEYOND_M),
          heading,
          length: s.width,
          kind: FurnitureKind.Crossing,
          flags: FurnitureFlag.Inferred,
          junction: ji,
        });
    }
  });
  // (the guardrails: both sides of a fast road outside the towns, of a bridge of the tertiary class or above)
  for (const s of segs) {
    const fast = (s.cls === "motorway" || s.cls === "trunk") && !(s.flags & SegmentFlag.Urban);
    const bridge = !!(s.flags & SegmentFlag.Bridge) && ["motorway", "trunk", "primary", "secondary", "tertiary"].includes(s.cls);
    if (!(fast || bridge) || s.flags & SegmentFlag.Tunnel) continue;
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    if (L < 1) continue;
    const ux = (s.b[0] - s.a[0]) / L,
      uy = (s.b[1] - s.a[1]) / L;
    const off = s.width / 2 + GUARDRAIL_OFF_M;
    for (const k of [1, -1])
      out.push({
        east: (s.a[0] + s.b[0]) / 2 + k * uy * off,
        north: (s.a[1] + s.b[1]) / 2 - k * ux * off,
        heading: Math.atan2(uy, ux),
        length: L,
        kind: FurnitureKind.Guardrail,
        flags: FurnitureFlag.Inferred,
        junction: 0xffff,
      });
  }
  return out;
}
