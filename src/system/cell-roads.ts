// PLAN-J8 J8-RP RP2 — the near scene's roads in France from the street cells (kerr-street-v5, street-cells.ts roadRuns — the approaches
// session's: the BD TOPO's axis, measured width, lanes, way, town) instead of OpenMapTiles' lines (their width the class's, their axis
// not the BD TOPO's): each run's segments as the scene's surface segments (scenery-geometry.ts surfaceSegment, kind 1), their markings,
// kerb and pavement packed from the cell's own surfaces (street-cells.ts readSurface — VB2's rules applied at the preparation) as
// road-markings.ts packs them; none in a tunnel. Pure but for `toLocal`.
//
// PLAN-PONT-ROUTES-AAA B1/B2 (24 Nov 2026), prepared here in the scene's worker — nothing of it decided in the frame:
//  - its surface material (road-surface.ts: the cell's, else inferred) in the word's bits 16–18 and its colour;
//  - its abscissa along its road (data[11] = −s): the dashes run on from one segment to the next, not restarted at each;
//  - its curves: at a run's bend of 3–60° between two segments of the same marking, 6 m long at least, the corner replaced by a
//    quadratic curve through three pieces (its control the bend, its ends up to 3 m back along each segment) — no kink at near range;
//  - its markings at a junction (street-detail-prep.ts armRoles): an arm that gives way loses its centre and lane lines over the last
//    J.width / 2 + STOP_BACK_M before the junction — they end at its yield or stop line —; between equal arms (no through road)
//    they end at the junction's mouth (J.width / 2); the through road's lines run on. Its kerb, pavement and material stay.
import type { Primitive } from "./scenery-data";
import { surfaceSegment } from "./scenery-geometry";
import { ROAD_ON_BRIDGE } from "./road-markings";
import { cellSurfaceOf, inferRoadSurface, ROAD_SURFACE_UNIT, roadSurfaceColour } from "./road-surface";
import {
  JUNCTION_M,
  PAVEMENT_M,
  readJunction,
  readSegment,
  readStreetHeader,
  readSurface,
  type RoadSegmentRecord,
  roadRuns,
  SegmentFlag,
  STOP_BACK_M,
  SurfaceFlag,
} from "./street-cells";
import { armRoles } from "./street-detail-prep";

/** a road's markings' bits a junction's approach clears: its edge lines kept, its centre and lane lines cleared */
const LINES = 2 | 4 | (15 << 5);

/** how far back from each end of a segment its centre and lane lines end (B2): 0 none, by its junction's arms' roles */
function junctionTrims(buf: ArrayBuffer, segs: readonly RoadSegmentRecord[]): Map<number, number> {
  const h = readStreetHeader(buf)!;
  const out = new Map<number, number>();
  const at = (e: number, n: number) => (Math.floor(e / 4) + 32768) * 65536 + (Math.floor(n / 4) + 32768);
  const ends = new Map<number, [number, 0 | 1][]>();
  segs.forEach((s, i) => {
    for (const end of [0, 1] as const) {
      const p = end ? s.b : s.a;
      const k = at(p[0], p[1]);
      (ends.get(k) ?? ends.set(k, []).get(k)!).push([i, end]);
    }
  });
  for (let j = 0; j < h.junctionCount; j++) {
    const J = readJunction(buf, j);
    const arms: [number, 0 | 1][] = [];
    const gi = Math.floor(J.east / 4),
      gj = Math.floor(J.north / 4);
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const [i, end] of ends.get((gi + a + 32768) * 65536 + (gj + b + 32768)) ?? []) {
          const s = segs[i]!;
          const p = end ? s.b : s.a;
          if (s.cls !== "rail" && Math.hypot(p[0] - J.east, p[1] - J.north) <= 1.5 * JUNCTION_M) arms.push([i, end]);
        }
    if (arms.length < 3) continue;
    const roles = armRoles(arms.map(([i]) => segs[i]!));
    arms.forEach(([i, end], k) => {
      const role = roles[k]!;
      if (role === "major") return;
      out.set(i * 2 + end, role === "minor" ? J.width / 2 + STOP_BACK_M : J.width / 2);
    });
  }
  return out;
}

/** a piece of road to emit: its ends in the cell's frame, its segment's index, its abscissa at a, the trims at its two ends */
interface Piece {
  a: [number, number];
  b: [number, number];
  i: number;
  s: number;
  trimA: number;
  trimB: number;
}

/** a run's pieces: its segments, their bends rounded (quadratic, three pieces) where both sides mark alike */
function runPieces(
  run: { segments: number[]; s: number[] },
  segs: readonly RoadSegmentRecord[],
  word: (i: number) => number,
  trims: Map<number, number>,
  smooth: boolean,
): Piece[] {
  const n = run.segments.length;
  const starts: [number, number][] = [],
    stops: [number, number][] = [];
  const corners: ([number, number][] | null)[] = [];
  for (let k = 0; k < n; k++) {
    const g = segs[run.segments[k]!]!;
    starts.push([...g.a]);
    stops.push([...g.b]);
  }
  for (let k = 1; k < n; k++) {
    corners.push(null);
    if (!smooth) continue;
    const g0 = segs[run.segments[k - 1]!]!,
      g1 = segs[run.segments[k]!]!;
    if (word(run.segments[k - 1]!) !== word(run.segments[k]!) || (g0.flags & SegmentFlag.Bridge) !== (g1.flags & SegmentFlag.Bridge))
      continue;
    const V = g0.b;
    const l0 = Math.hypot(V[0] - g0.a[0], V[1] - g0.a[1]),
      l1 = Math.hypot(g1.b[0] - V[0], g1.b[1] - V[1]);
    if (l0 < 6 || l1 < 6 || Math.hypot(g1.a[0] - V[0], g1.a[1] - V[1]) > 0.05) continue;
    const d0 = [(V[0] - g0.a[0]) / l0, (V[1] - g0.a[1]) / l0],
      d1 = [(g1.b[0] - V[0]) / l1, (g1.b[1] - V[1]) / l1];
    const turn = Math.acos(Math.max(-1, Math.min(1, d0[0]! * d1[0]! + d0[1]! * d1[1]!)));
    if (turn < (3 * Math.PI) / 180 || turn > Math.PI / 3) continue;
    const c = Math.min(3, 0.25 * Math.min(l0, l1));
    const A: [number, number] = [V[0] - d0[0]! * c, V[1] - d0[1]! * c],
      B: [number, number] = [V[0] + d1[0]! * c, V[1] + d1[1]! * c];
    const q = (t: number): [number, number] => [
      (1 - t) * (1 - t) * A[0] + 2 * (1 - t) * t * V[0] + t * t * B[0],
      (1 - t) * (1 - t) * A[1] + 2 * (1 - t) * t * V[1] + t * t * B[1],
    ];
    stops[k - 1] = A;
    starts[k] = B;
    corners[k - 1] = [A, q(1 / 3), q(2 / 3), B];
  }
  const out: Piece[] = [];
  let s = run.s[0] ?? 0;
  const push = (a: [number, number], b: [number, number], i: number, trimA = 0, trimB = 0) => {
    out.push({ a, b, i, s, trimA, trimB });
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  for (let k = 0; k < n; k++) {
    const i = run.segments[k]!;
    push(starts[k]!, stops[k]!, i, k === 0 ? (trims.get(i * 2) ?? 0) : 0, k === n - 1 ? (trims.get(i * 2 + 1) ?? 0) : 0);
    const c = k < n - 1 ? corners[k] : null;
    if (c) for (let m = 0; m < 3; m++) push(c[m]!, c[m + 1]!, run.segments[k + 1]!);
  }
  return out;
}

/**
 * A street cell's roads as the scene's surface segments: `toLocal(east, north)` the cell's frame [m] to the scene's (z 0 — the surfaces
 * are flat, the ground's relief theirs). Each segment's record packed as road-markings.ts packs one: data[6] the flags (SurfaceFlag)
 * + 16 one way + 32 lane lines + 512 the pavement [dm] + ROAD_ON_BRIDGE on a deck + ROAD_SURFACE_UNIT × its material. data[7] is the
 * carriageway's half-width, negative for surveyed widths away from fords; data[11] minus its abscissa along its road. The segment is
 * widened by its pavements when kerbed. `smooth` (default on): its bends rounded (B2).
 */
export function cellRoadSurfaces(
  buf: ArrayBuffer,
  toLocal: (east: number, north: number) => [number, number, number],
  includeBridges = false,
  smooth = true,
): Primitive[] {
  const h = readStreetHeader(buf);
  if (!h) return [];
  const out: Primitive[] = [];
  const segs = Array.from({ length: h.segmentCount }, (_, i) => readSegment(buf, i));
  const surf = segs.map((_, i) => readSurface(buf, i));
  const trims = junctionTrims(buf, segs);
  /** a segment's packed word and its half-widths (its carriageway's, its record's with the pavements), null: not drawn */
  const packed = new Map<number, { word: number; r: number; R: number; colour: number[]; surveyed: boolean }>();
  const wordOf = (i: number) => {
    const known = packed.get(i);
    if (known) return known;
    const s = segs[i]!,
      sf = surf[i]!;
    const isBridge = !!(s.flags & SegmentFlag.Bridge);
    const oneway = !!(s.flags & (SegmentFlag.OnewayAlong | SegmentFlag.OnewayAgainst));
    const urbanBridgePave = isBridge && s.flags & SegmentFlag.Urban ? (PAVEMENT_M[s.cls] ?? 0) : 0;
    const hasKerb = !!(sf.flags & SurfaceFlag.Kerb) || urbanBridgePave > 0;
    const flags = (sf.flags & 15) | (urbanBridgePave > 0 ? SurfaceFlag.Kerb : 0);
    const pave = hasKerb ? (sf.pavement > 0 ? sf.pavement : urbanBridgePave) : 0;
    const material = cellSurfaceOf(sf.flags) ?? inferRoadSurface({ cls: s.cls, urban: !!(s.flags & SegmentFlag.Urban) });
    const r = Math.max(1, s.width) / 2;
    const v = {
      word:
        flags +
        (oneway ? 16 : 0) +
        32 * Math.min(15, sf.laneLines) +
        512 * Math.round(pave * 10) +
        (isBridge ? ROAD_ON_BRIDGE : 0) +
        material * ROAD_SURFACE_UNIT,
      r,
      R: r + pave,
      colour: roadSurfaceColour(material),
      surveyed: !(s.flags & (SegmentFlag.InferredWidth | SegmentFlag.Ford)),
    };
    packed.set(i, v);
    return v;
  };
  const emit = (a2: [number, number], b2: [number, number], i: number, s0: number, word: number) => {
    const a = toLocal(a2[0], a2[1]),
      b = toLocal(b2[0], b2[1]);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.1) return;
    const w = wordOf(i);
    const p = surfaceSegment(a, b, 2 * w.R, 1, w.colour);
    p.data[6] = word;
    p.data[7] = w.surveyed ? -w.r : w.r;
    p.data[11] = -s0;
    out.push(p);
  };
  for (const run of roadRuns(buf)) {
    const first = segs[run.segments[0]!];
    if (!first || first.flags & SegmentFlag.Tunnel) continue;
    // (J8-RP RP9, KSC5: a railway's segment — its tracks as the scene's rails (kind 2: their rails and sleepers painted), one strip
    // of 3 m a track, 4.5 m apart across its axis; no marking)
    if (first.cls === "rail") {
      for (const i of run.segments) {
        const s = segs[i]!;
        const isBridge = !!(s.flags & SegmentFlag.Bridge);
        if (isBridge && !includeBridges) continue;
        const a = toLocal(s.a[0], s.a[1]),
          b = toLocal(s.b[0], s.b[1]);
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.1) continue;
        const n = Math.max(1, s.lanes);
        const nx = -(b[1] - a[1]) / L,
          ny = (b[0] - a[0]) / L;
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * 4.5;
          const rp = surfaceSegment([a[0] + nx * off, a[1] + ny * off, 0], [b[0] + nx * off, b[1] + ny * off, 0], 3, 2, [0.1, 0.085, 0.06]);
          rp.data[6] = isBridge ? ROAD_ON_BRIDGE : 0;
          out.push(rp);
        }
      }
      continue;
    }
    for (const pc of runPieces(run, segs, (i) => wordOf(i).word, trims, smooth)) {
      const s = segs[pc.i]!;
      if (s.flags & SegmentFlag.Tunnel) continue;
      if (s.flags & SegmentFlag.Bridge && !includeBridges) continue;
      const word = wordOf(pc.i).word;
      const L = Math.hypot(pc.b[0] - pc.a[0], pc.b[1] - pc.a[1]);
      if (L < 0.05) continue;
      const tA = Math.min(pc.trimA, L),
        tB = Math.min(pc.trimB, L - tA);
      if (tA <= 0 && tB <= 0) {
        emit(pc.a, pc.b, pc.i, pc.s, word);
        continue;
      }
      // (B2: its approach to a junction without its centre and lane lines)
      const at = (d: number): [number, number] => [pc.a[0] + ((pc.b[0] - pc.a[0]) * d) / L, pc.a[1] + ((pc.b[1] - pc.a[1]) * d) / L];
      const quiet = word & ~LINES;
      if (tA > 0) emit(pc.a, at(tA), pc.i, pc.s, quiet);
      if (L - tA - tB > 0.05) emit(at(tA), at(L - tB), pc.i, pc.s + tA, word);
      if (tB > 0) emit(at(L - tB), pc.b, pc.i, pc.s + L - tB, quiet);
    }
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
