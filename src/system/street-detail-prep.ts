// PLAN-J8 J8-VB (VB2, VB5a, VB6's data, VB7) — a street cell's details prepared from its segments and junctions (street-cells.ts KSC3 —
// its rules in its header): each segment's surface (the markings, the kerb and pavements its class, width, lanes, way and place call
// for), its continuations (the next segment driven at each end: its own road first, else through a junction the straightest way the
// one ways allow), and the furniture of its junctions and fast roads (stop and yield lines, crossings, signals, guardrails). Every piece
// inferred: the BD TOPO and OpenMapTiles give the roads' widths and lanes, not their markings, crossings or signals. Pure, in the cell's
// frame (east, north metres): street-prep.ts runs it for each cell, the tests too.
import type { Primitive } from "./scenery-data";
import { withCellSurface } from "./road-surface";
import { surfaceContains } from "./scenery-geometry";
import {
  type BridgeRecord,
  BridgeFlag,
  BridgeKind,
  ruleClearance,
  Crossed,
  CROSSING_BEYOND_M,
  FURNITURE_ARM_MIN_M,
  FurnitureFlag,
  FurnitureKind,
  type FurnitureRecord,
  GUARDRAIL_OFF_M,
  VIADUCT_M,
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

/** A segment's carriageway (VB2): its markings, its kerb and pavements (street-cells.ts's rules); (B1) its material in the flags' bits
 *  5–7 when the segment names it (road-surface.ts withCellSurface). */
export function segmentSurface(s: RoadSegmentRecord): SegmentSurface {
  const out = segmentMarkings(s);
  if (s.material !== undefined && s.cls !== "rail") out.flags = withCellSurface(out.flags, s.material);
  return out;
}

function segmentMarkings(s: RoadSegmentRecord): SegmentSurface {
  const out: SegmentSurface = { flags: 0, laneLines: 0, pavement: 0 };
  // (a railway's track: no road's markings; under a catenary or not — J8-RP RP9)
  if (s.cls === "rail") return { ...out, flags: s.electric ? SurfaceFlag.Electrified : 0 };
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
          // (entered at its end e: driven away from it — allowed by its way —, on the same level; a track to a track, a road to a road)
          if (!may(t, e) || t.level !== s.level || (t.cls === "rail") !== (s.cls === "rail")) continue;
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

/** (B2) a class's rank at a junction: the higher the road the junction's through road */
export const RANK: Record<string, number> = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, minor: 2, service: 1 };
const rankOf = (s: { cls: string }) => RANK[s.cls] ?? 0;
const roleTop = (arms: readonly { cls: string }[]) => arms.reduce((m, s) => Math.max(m, rankOf(s)), 0);
/**
 * (B2, 24 Nov 2026) Each arm's role at a junction: « major » — the through road: its class the junction's highest, two arms of it at
 * least —, « minor » — below that road: it gives way —, « equal » — no through road (the arms' highest class on one arm only, or every
 * arm the same): nothing marked, the priority to the right. Inferred: neither source gives the junctions' priorities.
 */
export function armRoles(arms: readonly { cls: string }[]): ("major" | "minor" | "equal")[] {
  const top = roleTop(arms);
  const tops = arms.filter((s) => rankOf(s) === top).length;
  const through = tops >= 2 && tops < arms.length;
  return arms.map((s) => (!through ? "equal" : rankOf(s) === top ? "major" : "minor"));
}

/**
 * The furniture (VB7, B2): at each junction of three arms or more, none a bridge or a tunnel, its lines by its arms' roles (armRoles: a
 * yield or stop line on an arm that gives way, a stop line at signals, a yield entering a roundabout, none between equals), and in a
 * town its crossings and signals; along the fast roads outside the towns and the bridges, their guardrails. `leftHand`: the traffic's
 * side.
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
          // (a railway's track no arm: no stop line nor crossing on it)
          if (s.cls !== "rail" && Math.hypot(p[0] - J.east, p[1] - J.north) <= 1.5 * JUNCTION_M) arms.push({ s, end });
        }
    if (arms.length < 3) return;
    const urban = arms.some((x) => x.s.flags & SegmentFlag.Urban);
    if (arms.some((x) => x.s.flags & (SegmentFlag.Bridge | SegmentFlag.Tunnel)) || J.flags & JunctionFlag.Levels) return;
    const round = !!(J.flags & JunctionFlag.Roundabout);
    const signals =
      urban && !round && (J.width >= SIGNAL_WIDE_M || (arms.length >= 4 && arms.filter((x) => MAJOR.has(x.s.cls)).length >= 2));
    const roles = armRoles(arms.map((x) => x.s));
    for (const [ai, { s, end }] of arms.entries()) {
      if (round && s.flags & SegmentFlag.Roundabout) continue;
      if (s.cls === "track" || s.cls === "path" || s.cls === "steps") continue;
      // (B2: the line an arm gets — at signals a stop line; entering a roundabout a yield; an arm below the junction's through road a
      // yield (a stop where that road is a trunk or above); arms of equal rank none — the priority to the right where nothing is
      // marked —; outside a town only the minor arms' and the roundabouts' lines, no crossing)
      const role = roles[ai]!;
      const line = signals || round || role === "minor";
      if (!urban && !line) continue;
      const yieldLine = round || (role === "minor" && !signals && roleTop(arms.map((x) => x.s)) < RANK.trunk!);
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
      if (inbound && line) {
        // (a two-way's line across its incoming half — on −r's side —, a one way's across it all)
        const half = oneway ? 0 : s.width / 4;
        out.push({
          east: cx - rx * half,
          north: cy - ry * half,
          heading,
          length: oneway ? s.width : s.width / 2,
          kind: FurnitureKind.StopLine,
          flags: FurnitureFlag.Inferred | (yieldLine ? FurnitureFlag.Yield : 0),
          junction: ji,
        });
      }
      if (inbound) {
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
      if (urban && !NO_CROSSING.has(s.cls))
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
  // (J8-RP RP8: the tunnels' mouths — a tunnel segment's end met by a segment out of it, on the ground: heading into the tunnel)
  for (const s of segs) {
    if (!(s.flags & SegmentFlag.Tunnel)) continue;
    for (const end of [0, 1] as const) {
      const p = end ? s.b : s.a,
        q = end ? s.a : s.b;
      const gi = Math.floor(p[0] / 4),
        gj = Math.floor(p[1] / 4);
      let open = false;
      for (let a = -1; a <= 1 && !open; a++)
        for (let b = -1; b <= 1 && !open; b++)
          for (const [i, e] of ends.get((gi + a + 32768) * 65536 + (gj + b + 32768)) ?? []) {
            const t = segs[i]!;
            const m = e ? t.b : t.a;
            if (
              t !== s &&
              !(t.flags & SegmentFlag.Tunnel) &&
              t.level >= 0 &&
              (t.cls === "rail") === (s.cls === "rail") &&
              Math.hypot(m[0] - p[0], m[1] - p[1]) <= JUNCTION_M
            )
              open = true;
          }
      if (open)
        out.push({
          east: p[0],
          north: p[1],
          heading: Math.atan2(q[1] - p[1], q[0] - p[0]),
          length: s.width,
          kind: FurnitureKind.TunnelPortal,
          flags: 0,
          junction: 0xffff,
        });
    }
  }
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
        flags: FurnitureFlag.Inferred | (s.flags & SegmentFlag.Bridge ? FurnitureFlag.OnBridge : 0),
        junction: 0xffff,
      });
  }
  return out;
}

/** a bridge's segment as the tile's chaining sees it: its cell (0–3) and index there, its ends in the tile's frame */
export interface BridgePiece {
  cell: number;
  index: number;
  a: [number, number];
  b: [number, number];
  seg: RoadSegmentRecord;
}

/** a bridge chained over a tile: its record (points in the tile's frame) and the pieces it holds */
export interface ChainedBridge {
  bridge: BridgeRecord;
  pieces: BridgePiece[];
}

/** (25 Nov 2026) a bridge's section met past a cell's edge: the tip this near its line (overlap), or its next piece this far ahead
 *  of the tip at most (gap) [m] — the z 15 tiles' margins leave up to a segment either way */
export const BRIDGE_OVERLAP_SIDE_M = 1.5;
export const BRIDGE_GAP_M = 80;
/** a bridge confirmed by the BD TOPO's own: within this of a « Pont » construction [m] */
export const BRIDGE_CONFIRM_M = 15;
/** a deck's side beyond its carriageway outside the towns (parapets) [m]; in the towns, its pavements (PAVEMENT_M) */
const PARAPET_SIDE_M = 0.75;

const kindOf = (p: Primitive) => {
  const v = p.data;
  return v.length === 12 && v[5]! < 4 ? v[5]! : v[3]!;
};

/**
 * J8-RP RP4 — a tile's bridges: its bridge segments (BridgePiece, from its four cells) chained by their ends (within JUNCTION_M, on the
 * same level) into decks, whichever their roads (a viaduct cut into several of the BD TOPO's sections is one deck: its middle no
 * abutment). Each: its axis (the chain's points, its ends its abutments — OpenA/OpenB where `atEdge` says the chain is cut by the
 * tile), its width (the widest carriageway and its sides), its layer, what it crosses (`surfaces`: OpenMapTiles' water, rails and roads
 * in the tile's frame — water kinds 3/4, rail 2, road 1 —, sampled every 5 m away from its ends), its least clearance, BD TOPO's
 * confirmation (`ponts`: the « Pont » constructions' segments in the tile's frame), its kind (a path's or steps' a footbridge).
 */
export function chainBridges(
  pieces: readonly BridgePiece[],
  surfaces: readonly Primitive[],
  ponts: readonly [[number, number], [number, number]][],
  atEdge: (p: [number, number]) => boolean,
): ChainedBridge[] {
  const key = (p: [number, number]) => `${Math.round(p[0] / JUNCTION_M)},${Math.round(p[1] / JUNCTION_M)}`;
  const near = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= JUNCTION_M;
  const isRail = (cls: string) => cls === "rail";
  const isFoot = (cls: string) => cls === "path" || cls === "steps" || cls === "track";
  const at = new Map<string, number[]>();
  const add = (p: [number, number], i: number) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const k = `${Math.round(p[0] / JUNCTION_M) + dx},${Math.round(p[1] / JUNCTION_M) + dy}`;
        (at.get(k) ?? at.set(k, []).get(k)!).push(i);
      }
  };
  pieces.forEach((pc, i) => {
    add(pc.a, i);
    add(pc.b, i);
  });
  const others = (p: [number, number], i: number, level = pieces[i]!.seg.level, cls = pieces[i]!.seg.cls) =>
    [...new Set(at.get(key(p)) ?? [])].filter(
      (j) =>
        j !== i &&
        pieces[j]!.seg.level === level &&
        isRail(pieces[j]!.seg.cls) === isRail(cls) &&
        isFoot(pieces[j]!.seg.cls) === isFoot(cls) &&
        (near(pieces[j]!.a, p) || near(pieces[j]!.b, p)),
    );
  const used = new Uint8Array(pieces.length);
  const out: ChainedBridge[] = [];
  // (start at a chain's end: a piece with an end met by no other; loops last)
  const order = pieces.map((pc, i) => ({
    i,
    end: others(pc.a, i, pc.seg.level, pc.seg.cls).length === 0 || others(pc.b, i, pc.seg.level, pc.seg.cls).length === 0,
  }));
  order.sort((x, y) => {
    if (x.end !== y.end) return Number(y.end) - Number(x.end);
    return (pieces[x.i]!.seg.roadId >>> 0) - (pieces[y.i]!.seg.roadId >>> 0) || x.i - y.i;
  });
  for (const { i: start } of order) {
    if (used[start]) continue;
    const s0 = pieces[start]!;
    // (oriented from its free end)
    let tip: [number, number] = others(s0.a, start, s0.seg.level, s0.seg.cls).length === 0 ? s0.b : s0.a;
    const points: [number, number][] = [tip === s0.b ? s0.a : s0.b, tip];
    // (format 6: each point's surveyed deck height — its pieces' ends', the mean of those given where two pieces meet)
    const zEnd = (pc: BridgePiece, p: [number, number]) => (p === pc.b ? (pc.seg.zb ?? Number.NaN) : (pc.seg.za ?? Number.NaN));
    const heights: number[] = [zEnd(s0, points[0]!), zEnd(s0, tip)];
    const chain: BridgePiece[] = [s0];
    used[start] = 1;
    // (25 Nov 2026 — Pont de Cheviré's four pieces: a section cut by two z 15 cells is each cell's from its own tile, the BD TOPO's
    // vector tiles clipped with a margin — the two cells' segments overlap past their edge, or leave a gap, by up to a segment, never
    // meeting within JUNCTION_M —: past the pieces met end to end, the same section's next piece where the tip lies on it (overlap:
    // on to its far end) or ahead of it, in line, within BRIDGE_GAP_M (a gap: across to it); then the chain's other way the same)
    const step = (): boolean => {
      const next = others(tip, -1, s0.seg.level, s0.seg.cls).filter((j) => !used[j]);
      if (!next.length) return across();
      if (next.length > 1) {
        const prev = points[points.length - 2] ?? points[0]!;
        const dx = tip[0] - prev[0];
        const dy = tip[1] - prev[1];
        const L = Math.hypot(dx, dy) || 1;
        const ux = dx / L,
          uy = dy / L;
        next.sort((ja, jb) => {
          const pa = pieces[ja]!,
            pb = pieces[jb]!;
          const sameA = pa.seg.roadId === s0.seg.roadId ? 1 : 0;
          const sameB = pb.seg.roadId === s0.seg.roadId ? 1 : 0;
          if (sameA !== sameB) return sameB - sameA;
          const otherEndA = near(pa.a, tip) ? pa.b : pa.a;
          const otherEndB = near(pb.a, tip) ? pb.b : pb.a;
          const dotA = (otherEndA[0] - tip[0]) * ux + (otherEndA[1] - tip[1]) * uy;
          const dotB = (otherEndB[0] - tip[0]) * ux + (otherEndB[1] - tip[1]) * uy;
          if (Math.abs(dotA - dotB) > 1e-4) return dotB - dotA;
          return (pa.seg.roadId >>> 0) - (pb.seg.roadId >>> 0) || ja - jb;
        });
      }
      const j = next[0]!;
      used[j] = 1;
      const pc = pieces[j]!;
      const enter = near(pc.a, tip) ? pc.a : pc.b;
      const zIn = zEnd(pc, enter),
        zPrev = heights[heights.length - 1]!;
      heights[heights.length - 1] = Number.isFinite(zPrev) && Number.isFinite(zIn) ? (zPrev + zIn) / 2 : Number.isFinite(zIn) ? zIn : zPrev;
      tip = enter === pc.a ? pc.b : pc.a;
      points.push(tip);
      heights.push(zEnd(pc, tip));
      chain.push(pc);
      return true;
    };
    const across = (): boolean => {
      const prev = points[points.length - 2] ?? points[0]!;
      const L0 = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) || 1;
      const ux = (tip[0] - prev[0]) / L0,
        uy = (tip[1] - prev[1]) / L0;
      let best: { j: number; near: [number, number] | null; far: [number, number]; score: number; zTip: number } | null = null;
      pieces.forEach((pc, j) => {
        if (used[j] || pc.seg.roadId !== s0.seg.roadId || pc.seg.level !== s0.seg.level) return;
        const L = Math.hypot(pc.b[0] - pc.a[0], pc.b[1] - pc.a[1]);
        if (L < 0.1) return;
        const vx = (pc.b[0] - pc.a[0]) / L,
          vy = (pc.b[1] - pc.a[1]) / L;
        const dot = vx * ux + vy * uy;
        if (Math.abs(dot) < 0.9) return;
        const far = dot > 0 ? pc.b : pc.a,
          nearEnd = dot > 0 ? pc.a : pc.b;
        // (on it: the tip within BRIDGE_OVERLAP_SIDE_M of its line, between its ends, its far end ahead)
        const t = (tip[0] - pc.a[0]) * vx + (tip[1] - pc.a[1]) * vy,
          side = Math.abs((tip[0] - pc.a[0]) * vy - (tip[1] - pc.a[1]) * vx);
        const ahead = (far[0] - tip[0]) * ux + (far[1] - tip[1]) * uy;
        if (t > -0.5 && t < L + 0.5 && side <= BRIDGE_OVERLAP_SIDE_M && ahead > 0.5) {
          const za = pc.seg.za ?? Number.NaN,
            zb = pc.seg.zb ?? Number.NaN;
          const zt = za + (zb - za) * Math.max(0, Math.min(1, t / L));
          if (!best || best.score > 0) best = { j, near: null, far, score: 0, zTip: zt };
          return;
        }
        // (ahead of it, in line: its near end within BRIDGE_GAP_M along, BRIDGE_OVERLAP_SIDE_M + 0.5 across)
        const along = (nearEnd[0] - tip[0]) * ux + (nearEnd[1] - tip[1]) * uy,
          off = Math.abs((nearEnd[0] - tip[0]) * uy - (nearEnd[1] - tip[1]) * ux);
        if (along > 0 && along <= BRIDGE_GAP_M && off <= BRIDGE_OVERLAP_SIDE_M + 0.5 && (!best || along < best.score))
          best = { j, near: nearEnd, far, score: along, zTip: Number.NaN };
      });
      if (!best) return false;
      const { j, near: nearEnd, far, zTip } = best;
      used[j] = 1;
      const pc = pieces[j]!;
      const zPrev = heights[heights.length - 1]!;
      if (Number.isFinite(zTip)) heights[heights.length - 1] = Number.isFinite(zPrev) ? (zPrev + zTip) / 2 : zTip;
      if (nearEnd) {
        points.push(nearEnd);
        heights.push(zEnd(pc, nearEnd));
      }
      tip = far;
      points.push(tip);
      heights.push(zEnd(pc, tip));
      chain.push(pc);
      return true;
    };
    while (step());
    // (and from its start, the other way)
    points.reverse();
    heights.reverse();
    chain.reverse();
    tip = points[points.length - 1]!;
    while (step());
    let length = 0;
    for (let k = 1; k < points.length; k++) length += Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]);
    const widest = chain.reduce((w, pc) => Math.max(w, pc.seg.width), 0);
    const lead = chain.reduce((w, pc) => (pc.seg.width > w.seg.width ? pc : w), chain[0]!).seg;
    const side = lead.flags & SegmentFlag.Urban ? (PAVEMENT_M[lead.cls] ?? PARAPET_SIDE_M) || PARAPET_SIDE_M : PARAPET_SIDE_M;
    const foot = chain.every((pc) => pc.seg.cls === "path" || pc.seg.cls === "steps" || pc.seg.cls === "track");
    const rail = chain.every((pc) => pc.seg.cls === "rail");
    // (what it crosses: its axis every 5 m, its ends' approaches left out — the roads that lead onto it)
    let crossed = 0;
    // (its length over the water [m]: the water's samples — every 5 m — the clearance's rule's width)
    let waterM = 0;
    const keep = widest / 2 + 5;
    let walked = 0;
    for (let k = 1; k < points.length; k++) {
      const p = points[k - 1]!,
        q = points[k]!;
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      for (let d = 0; d < L; d += 5) {
        const s = walked + d;
        if (s < keep || s > length - keep) continue;
        const f = d / L;
        const x: [number, number, number] = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, 0];
        let wet = false;
        for (const prim of surfaces) {
          if (!surfaceContains(x, prim)) continue;
          const k2 = kindOf(prim);
          crossed |= k2 >= 3 ? Crossed.Water : k2 === 2 ? Crossed.Rail : Crossed.Road;
          wet ||= k2 >= 3;
        }
        if (wet) waterM += 5;
      }
      walked += L;
    }
    // (the BD TOPO's own bridge near its axis: confirmed)
    const confirmed = points.some((p) =>
      ponts.some(([a, b]) => {
        const x = b[0] - a[0],
          y = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / Math.max(x * x + y * y, 1e-8)));
        return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * y) <= BRIDGE_CONFIRM_M;
      }),
    );
    let flags = 0;
    if (confirmed) flags |= BridgeFlag.Confirmed;
    if (length > VIADUCT_M) flags |= BridgeFlag.Viaduct;
    if (atEdge(points[0]!)) flags |= BridgeFlag.OpenA;
    if (atEdge(points[points.length - 1]!)) flags |= BridgeFlag.OpenB;
    const surveyed = heights.filter(Number.isFinite).length;
    if (surveyed >= 2) flags |= BridgeFlag.Measured;
    out.push({
      bridge: {
        id: Math.min(...chain.map((pc) => pc.seg.roadId >>> 0)),
        kind: rail ? BridgeKind.Rail : foot ? BridgeKind.Foot : BridgeKind.Road,
        flags,
        width: widest + 2 * side,
        layer: lead.level,
        crossed,
        clearance: ruleClearance(crossed, waterM),
        length,
        points,
        ...(surveyed ? { heights } : {}),
      },
      pieces: chain,
    });
  }
  return out;
}

/**
 * J8-RP RP3 — a road's long profile outside France (where the relief is coarse — the IGN's 1 m / 0.5 m models carry the real
 * embankments in France: nothing more flattened there): by class, the window it is smoothed over [m] and its steepest grade (the
 * design rules' order: a motorway's 6 %, a main road's 8 %, a street's 12 %, a track's 20 %).
 */
export const ROAD_PROFILE: Partial<Record<RoadClass, { window: number; grade: number }>> = {
  motorway: { window: 240, grade: 0.06 },
  trunk: { window: 200, grade: 0.07 },
  primary: { window: 150, grade: 0.08 },
  secondary: { window: 120, grade: 0.09 },
  tertiary: { window: 90, grade: 0.1 },
  minor: { window: 60, grade: 0.12 },
  service: { window: 40, grade: 0.14 },
  track: { window: 30, grade: 0.2 },
  rail: { window: 300, grade: 0.035 },
};

/**
 * RP3 — a road's profile from its ground sampled along it (`s` its abscissas, rising; `h` the relief there, from the drawing's own):
 * smoothed over its class's window (a mean weighted by a tent), then held within its class's steepest grade (a forward and a backward
 * pass, each sample no farther from its neighbour than the grade allows — the profile nearest the smoothed one that a road can take),
 * its two ends kept on the ground (the road leaves and meets the rest of the network there). Returns the profile's heights and each
 * sample's cut (< 0) or fill (> 0) — what the drawing flattens the ground by under the carriageway and its shoulders. A class without a
 * profile (a path, steps): the ground itself.
 */
export function roadProfile(s: readonly number[], h: readonly number[], cls: RoadClass): { heights: number[]; fill: number[] } {
  const p = ROAD_PROFILE[cls];
  if (!p || s.length < 3) return { heights: [...h], fill: h.map(() => 0) };
  const n = s.length;
  const half = p.window / 2;
  const smooth = s.map((si, i) => {
    let w = 0,
      sum = 0;
    for (let j = 0; j < n; j++) {
      const d = Math.abs(s[j]! - si);
      if (d >= half) continue;
      const k = 1 - d / half;
      w += k;
      sum += k * h[j]!;
    }
    return w > 0 ? sum / w : h[i]!;
  });
  // (its ends on the ground: the smoothed profile led back to them over a window)
  smooth[0] = h[0]!;
  smooth[n - 1] = h[n - 1]!;
  const out = [...smooth];
  for (let i = 1; i < n; i++) {
    const g = p.grade * (s[i]! - s[i - 1]!);
    out[i] = Math.min(Math.max(out[i]!, out[i - 1]! - g), out[i - 1]! + g);
  }
  out[n - 1] = h[n - 1]!;
  for (let i = n - 2; i >= 0; i--) {
    const g = p.grade * (s[i + 1]! - s[i]!);
    out[i] = Math.min(Math.max(out[i]!, out[i + 1]! - g), out[i + 1]! + g);
  }
  // (a slope steeper than the grade allows end to end: its ends kept on the ground all the same)
  out[0] = h[0]!;
  return { heights: out, fill: out.map((v, i) => v - h[i]!) };
}

/** RP3 — a class's design speed [m/s] and its steepest banking (the rules' order: 7 % on the fast roads, 5 % on the others) */
export const ROAD_BANK: Partial<Record<RoadClass, { speed: number; max: number }>> = {
  motorway: { speed: 36, max: 0.07 },
  trunk: { speed: 30, max: 0.07 },
  primary: { speed: 25, max: 0.06 },
  secondary: { speed: 22, max: 0.05 },
  tertiary: { speed: 18, max: 0.05 },
};

/**
 * RP3 — a road's banking along its run (its points, in order): at each point, the curve's radius from it and its neighbours (the circle
 * through the three), the cross-slope a car at the class's design speed needs on it — v² / (g R), half carried by the tyres —, held
 * within the class's steepest; signed: > 0 its right edge higher than its left (in the run's direction — a left-hand curve), < 0 the
 * reverse; 0 on a straight, at the ends, in a town (its streets drained, not banked) and for a class without one. Outside France the
 * drawing tilts its flattened ground by it (roadProfile its height).
 */
export function roadBank(points: readonly (readonly [number, number])[], cls: RoadClass, urban = false): number[] {
  const b = ROAD_BANK[cls];
  const out = points.map(() => 0);
  if (!b || urban) return out;
  for (let i = 1; i + 1 < points.length; i++) {
    const [ax, ay] = points[i - 1]!,
      [px, py] = points[i]!,
      [cx, cy] = points[i + 1]!;
    const cross = (px - ax) * (cy - py) - (py - ay) * (cx - px);
    const la = Math.hypot(px - ax, py - ay),
      lb = Math.hypot(cx - px, cy - py),
      lc = Math.hypot(cx - ax, cy - ay);
    if (cross === 0 || la * lb * lc === 0) continue;
    // (the circumradius: |ab|·|bc|·|ca| / (2 |cross|))
    const R = (la * lb * lc) / (2 * Math.abs(cross));
    const e = Math.min(b.max, (0.5 * b.speed * b.speed) / (9.81 * R));
    out[i] = Math.sign(cross) * e;
  }
  return out;
}
