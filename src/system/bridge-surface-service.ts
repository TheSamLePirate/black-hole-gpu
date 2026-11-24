// Bridge & Road AAA — the deck's canonical surface and the support service (PLAN-PONT-ROUTES-AAA.md PR2, revised 24 Nov 2026).
//
// One owner: a bridge's long profile is decided here, once, by the scene's worker (scenery-worker.ts deckBridge); the drawn mesh
// (bridge-mesh.ts), the contact (each slice's plane — scenery-contact.ts topAt), the cars, the lamps and the guardrails all read the
// same piecewise-linear surface through its stations (`deckAt`). Nothing else lifts a deck.
//
// The profile (review A7, 24 Nov 2026 — the old one divided the lift it needed by a parabola's envelope, 0 at the abutments: a 600 m
// bridge over a 5 m dip rose 18 m, 1 200 m 36 m, its ends at 10–15 %): a vertical curve of bounded grade —
//   z(s) = baseline(s) + H · r(s / Lr) · r((T − s) / Lr) + eA(s) + eB(s)
// where baseline is the straight line between the two end heights, r the smoothstep (3u² − 2u³, 1 past u = 1) — a ramp of length Lr
// up to a crest plateau H over the baseline, C1 —, and eA, eB two Hermite terms that bring the deck's grade at each end to the
// approach road's (its value 0 and its slope (gApproach − gBaseline) at the end, both 0 at L_end). H is the clearance the plateau's
// samples need (ground + clearance + thickness over the baseline); the ramp's steepest grade 1.5 H / Lr plus the baseline's stays
// within the class's maxGrade (5 % a fast road, 8 % a minor one, 3.5 % a railway): Lr grows to keep it, H is capped where even
// Lr = T / 2 cannot (a short bridge stays nearly flat — its clearance is then what it is; piers, not humps, carry it). A long bridge
// gets a drainage crest of 0.2 % of its length (≤ 1 m).
// An open end (BridgeFlag.OpenA/OpenB: the tile's edge cut the bridge and its other half was not found — bridge-ports.ts
// joinBridgeHalves joins them when both cells are read) is mid-span, not an abutment: its height the clearance over the ground there,
// its approach grade 0 (level with the half beyond) — never the ground.

/** a support's identity: its asset, its surface, its revision (the scene's) */
export interface SupportRef {
  readonly assetId: string;
  readonly surfaceId: string;
  readonly revision: string;
}

export interface SupportSampleResult {
  readonly found: boolean;
  readonly supportRef?: SupportRef;
  readonly point: [number, number, number];
  readonly elevation: number;
  readonly normal: [number, number, number];
  readonly tangent: [number, number, number];
  readonly crossTangent: [number, number, number];
  readonly surfaceRole: "carriageway" | "sidewalk" | "parapet" | "ground";
  readonly distanceToAxis: number;
  readonly sM: number;
  readonly uM: number;
}

export interface BridgeProfileParams {
  /** the axis on the ground: x, y in the scene's frame [m], z the ground there (the frame's local height) */
  readonly points: readonly [number, number, number][];
  readonly width: number;
  readonly thickness?: number;
  /** the least clearance under the intrados over the ground [m] */
  readonly clearance?: number;
  /** BridgeFlag bits (OpenA / OpenB: that end mid-span) */
  readonly flags?: number;
  /** the approach road's grade beyond each end, along A → B (dz/ds) — the deck's grade there */
  readonly approachSlopeA?: number;
  readonly approachSlopeB?: number;
  /** the steepest grade the deck may take (0.05 default) */
  readonly maxGrade?: number;
  /** an end's height given (a joined bridge's, a measured one) — else its ground's (its clearance's, open) */
  readonly endZA?: number;
  readonly endZB?: number;
  /** the parapet's band at each edge: its width and height over the deck [m] — the drawn rails' (bridge-mesh.ts) */
  readonly railW?: number;
  readonly railH?: number;
  /** the stations' spacing [m]: the drawn slices' length (≤ 10 m near) */
  readonly sliceM?: number;
  /** (street cells' format 6, 25 Nov 2026) the deck's surveyed top at each point [the frame's z] — the BD TOPO's Z: the profile follows
   *  it (piecewise linear), brought to each closed end's height (its ground, or `endZA`/`endZB`) over a ramp of grade ≤ 4 % — refused
   *  (the clearance's curve then) where it lies more than MEASURED_UNDER_M under the ground 20 m or more from the ends */
  readonly measured?: readonly number[];
}

/** a surveyed deck this far under the ground under it is no deck's (a section's Z taken from the ground model): refused [m] */
export const MEASURED_UNDER_M = 1;
/** the steepest grade the surveyed deck's ramp to an end's height takes [dz/ds], its shortest [m] */
const MEASURED_RAMP_GRADE = 0.04,
  MEASURED_RAMP_MIN_M = 30;

/**
 * Whether a surveyed deck can be the profile: one finite height a point, none more than MEASURED_UNDER_M under the ground (`points`'
 * z) 20 m or more from the ends.
 */
export function measuredDeckUsable(points: readonly [number, number, number][], measured: readonly number[] | undefined): boolean {
  if (!measured || measured.length !== points.length || points.length < 2 || !measured.every(Number.isFinite)) return false;
  let s = 0;
  const span = [0];
  for (let i = 1; i < points.length; i++)
    span.push((s += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])));
  for (let i = 0; i < points.length; i++)
    if (span[i]! >= 20 && s - span[i]! >= 20 && measured[i]! < points[i]![2] - MEASURED_UNDER_M) return false;
  return true;
}

/** OpenA / OpenB (street-cells.ts BridgeFlag): not imported to keep this module free of the cells' format */
const OPEN_A = 4,
  OPEN_B = 8;
const ramp = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const rampD = (u: number) => (u <= 0 || u >= 1 ? 0 : 6 * u * (1 - u));

export class BridgeContinuousProfile {
  readonly totalLength: number;
  /** the axis's cumulative lengths at its points [m] */
  readonly spans: number[];
  readonly zA: number;
  readonly zB: number;
  /** the crest plateau over the baseline [m] and its ramps' length [m] */
  readonly lift: number;
  readonly rampM: number;
  readonly width: number;
  readonly thickness: number;
  readonly clearance: number;
  readonly flags: number;
  readonly maxGrade: number;
  readonly railW: number;
  readonly railH: number;
  /** the stations [m along the axis]: the drawn slices' ends, the polyline's vertices among them */
  readonly stations: number[];
  private readonly points: readonly [number, number, number][];
  private readonly gA: number;
  private readonly gB: number;
  private readonly endA: number;
  private readonly endB: number;
  private readonly stationZ: number[];
  /** (format 6) the surveyed deck followed (measuredDeckUsable), its two ends' corrections [m] and their ramps' lengths [m] */
  readonly measuredUsed: boolean;
  private readonly measured: readonly number[] | null;
  private readonly corrA: number;
  private readonly corrB: number;
  private readonly corrLA: number;
  private readonly corrLB: number;

  constructor(params: BridgeProfileParams) {
    this.points = params.points;
    this.width = params.width;
    this.thickness = params.thickness ?? 1.5;
    this.clearance = params.clearance ?? 5.5;
    this.flags = params.flags ?? 0;
    this.maxGrade = params.maxGrade ?? 0.05;
    this.railW = params.railW ?? 0.3;
    this.railH = params.railH ?? 1.0;
    const pts = this.points;
    const span: number[] = [0];
    for (let i = 1; i < pts.length; i++) span.push(span[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    this.spans = span;
    const T = span[span.length - 1] ?? 0;
    this.totalLength = T;
    const above = this.clearance + this.thickness;
    const z0 = pts[0]?.[2] ?? 0,
      z1 = pts[pts.length - 1]?.[2] ?? z0;
    const openA = !!(this.flags & OPEN_A),
      openB = !!(this.flags & OPEN_B);
    this.zA = params.endZA ?? (openA ? z0 + above : z0);
    this.zB = params.endZB ?? (openB ? z1 + above : z1);
    const g = this.maxGrade;
    const clampG = (v: number | undefined, open: boolean) => (open ? 0 : Math.max(-g, Math.min(g, v ?? 0)));
    this.gA = params.endZA !== undefined ? clampG(params.approachSlopeA, false) : clampG(params.approachSlopeA, openA);
    this.gB = params.endZB !== undefined ? clampG(params.approachSlopeB, false) : clampG(params.approachSlopeB, openB);
    // (format 6: the surveyed deck — its ends brought to the abutments' heights, an open end left at its survey: mid-span, its other
    // half's the same survey)
    this.measuredUsed = T >= 0.5 && measuredDeckUsable(pts, params.measured);
    this.measured = this.measuredUsed ? params.measured! : null;
    if (this.measured) {
      const m = this.measured;
      this.zA = params.endZA ?? (openA ? m[0]! : z0);
      this.zB = params.endZB ?? (openB ? m[m.length - 1]! : z1);
      this.corrA = this.zA - m[0]!;
      this.corrB = this.zB - m[m.length - 1]!;
      const len = (c: number) => Math.min(T / 2, Math.max(MEASURED_RAMP_MIN_M, (1.5 * Math.abs(c)) / MEASURED_RAMP_GRADE));
      this.corrLA = len(this.corrA);
      this.corrLB = len(this.corrB);
    } else this.corrA = this.corrB = this.corrLA = this.corrLB = 0;
    if (T < 0.5) {
      this.lift = 0;
      this.rampM = 0;
      this.endA = this.endB = 0;
      this.stations = [0, T];
      this.stationZ = [this.zA, this.zB];
      return;
    }
    const gBase = (this.zB - this.zA) / T;
    const room = g - Math.abs(gBase);
    // (the ramps' least length: a tenth of the bridge, 15–120 m — a short crest is not a kink)
    const minRamp = Math.min(T / 2, Math.max(15, Math.min(120, 0.1 * T)));
    let Lr = minRamp,
      H = 0;
    for (let it = 0; it < 5; it++) {
      let need = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = Math.min(span[i]!, T - span[i]!);
        if (d < Lr) continue;
        need = Math.max(need, pts[i]![2] + above - (this.zA + gBase * span[i]!));
      }
      H = need;
      const want = room > 1e-4 ? (1.5 * H) / room : T / 2;
      const next = Math.min(T / 2, Math.max(minRamp, want));
      if (next <= Lr + 1e-6) break;
      Lr = next;
    }
    // (the grade's bound: the plateau no higher than the longest ramps allow)
    const hMax = room > 0 ? (room * Lr) / 1.5 : 0;
    H = Math.min(Math.max(H, 0), hMax);
    // (a long bridge's drainage crest)
    if (T > 60) H = Math.max(H, Math.min(0.002 * T, 1, hMax));
    this.lift = H;
    this.rampM = Lr;
    this.endA = Math.min(Lr, T / 2, 60);
    this.endB = Math.min(Lr, T / 2, 60);
    // (the stations: every polyline vertex, and between them every sliceM at most)
    const slice = Math.max(1, params.sliceM ?? 10);
    const st: number[] = [0];
    for (let i = 1; i < span.length; i++) {
      const a = span[i - 1]!,
        b = span[i]!;
      if (b - a < 1e-3) continue;
      const n = Math.max(1, Math.ceil((b - a) / slice));
      for (let k = 1; k <= n; k++) st.push(a + ((b - a) * k) / n);
    }
    this.stations = st;
    this.stationZ = st.map((s) => this.elevationAt(s));
  }

  /** the vertical curve, analytic (C1): exactly zA at s = 0, zB at s = totalLength */
  elevationAt(s: number): number {
    const T = this.totalLength;
    if (T <= 0) return this.zA;
    const x = Math.max(0, Math.min(T, s));
    if (this.measured) return this.measuredAt(x);
    const gBase = (this.zB - this.zA) / T;
    let z = this.zA + gBase * x;
    if (this.rampM > 0) z += this.lift * ramp(x / this.rampM) * ramp((T - x) / this.rampM);
    if (this.endA > 0 && x < this.endA) z += (this.gA - gBase) * x * (1 - x / this.endA) ** 2;
    const y = T - x;
    if (this.endB > 0 && y < this.endB) z -= (this.gB - gBase) * y * (1 - y / this.endB) ** 2;
    return z;
  }

  /** (format 6) the surveyed deck at x: its points' heights, linear between them, each end's correction faded over its ramp (1 − a
   *  smoothstep: C1 at the abutment's approach and at the survey) */
  private measuredAt(x: number): number {
    const m = this.measured!,
      span = this.spans,
      T = this.totalLength;
    let k = 1;
    while (k < span.length - 1 && span[k]! < x) k++;
    const L = span[k]! - span[k - 1]!;
    const f = L > 1e-6 ? (x - span[k - 1]!) / L : 0;
    let z = m[k - 1]! + (m[k]! - m[k - 1]!) * f;
    if (this.corrLA > 0) z += this.corrA * (1 - ramp(x / this.corrLA));
    if (this.corrLB > 0) z += this.corrB * (1 - ramp((T - x) / this.corrLB));
    return z;
  }

  /** its grade dz/ds, analytic (the surveyed deck's by a central difference over 0.5 m) */
  slopeAt(s: number): number {
    const T = this.totalLength;
    if (T <= 0) return 0;
    const x = Math.max(0, Math.min(T, s));
    if (this.measured) {
      const a = Math.max(0, x - 0.25),
        b = Math.min(T, x + 0.25);
      return b > a ? (this.measuredAt(b) - this.measuredAt(a)) / (b - a) : 0;
    }
    const gBase = (this.zB - this.zA) / T;
    let d = gBase;
    if (this.rampM > 0) {
      const L = this.rampM;
      d += this.lift * ((rampD(x / L) / L) * ramp((T - x) / L) - ramp(x / L) * (rampD((T - x) / L) / L));
    }
    if (this.endA > 0 && x < this.endA) {
      const u = x / this.endA;
      d += (this.gA - gBase) * (1 - u) * (1 - 3 * u);
    }
    const y = T - x;
    if (this.endB > 0 && y < this.endB) {
      const u = y / this.endB;
      d += (this.gB - gBase) * (1 - u) * (1 - 3 * u);
    }
    return d;
  }

  /** the drawn deck's top at s: the stations' heights, linear between them — the mesh's and the contact's surface */
  deckAt(s: number): number {
    const st = this.stations;
    const x = Math.max(0, Math.min(this.totalLength, s));
    let lo = 0,
      hi = st.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (st[m]! <= x) lo = m;
      else hi = m;
    }
    const a = st[lo]!,
      b = st[hi]!;
    const f = b > a ? (x - a) / (b - a) : 0;
    return this.stationZ[lo]! + (this.stationZ[hi]! - this.stationZ[lo]!) * f;
  }

  /** the intrados (the deck's underside) at s, drawn */
  intradosAt(s: number): number {
    return this.deckAt(s) - this.thickness;
  }

  /** the axis point at s [the scene's frame] and its unit direction */
  axisAt(s: number): { x: number; y: number; tx: number; ty: number } {
    const span = this.spans,
      pts = this.points;
    const x = Math.max(0, Math.min(this.totalLength, s));
    let k = 1;
    while (k < span.length - 1 && span[k]! < x) k++;
    const p0 = pts[k - 1]!,
      p1 = pts[k]!;
    const L = span[k]! - span[k - 1]!;
    const f = L > 1e-6 ? (x - span[k - 1]!) / L : 0;
    const l2 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    return { x: p0[0] + (p1[0] - p0[0]) * f, y: p0[1] + (p1[1] - p0[1]) * f, tx: (p1[0] - p0[0]) / l2, ty: (p1[1] - p0[1]) / l2 };
  }

  /** the ground under the axis at s (the points' heights, linear) */
  groundAt(s: number): number {
    const span = this.spans,
      pts = this.points;
    const x = Math.max(0, Math.min(this.totalLength, s));
    let k = 1;
    while (k < span.length - 1 && span[k]! < x) k++;
    const L = span[k]! - span[k - 1]!;
    const f = L > 1e-6 ? (x - span[k - 1]!) / L : 0;
    return pts[k - 1]![2] + (pts[k]![2] - pts[k - 1]![2]) * f;
  }

  /**
   * The drawn surface at (s, u): u across the axis [m, + to the left of A → B]. The deck's top across its whole width — its carriageway
   * and its pavements are one flat top in the mesh —; within the parapets' band (railW at each edge) their top, railH over it (the drawn
   * rails'); `role` names the band.
   */
  sample(
    s: number,
    u: number,
  ): {
    position: [number, number, number];
    normal: [number, number, number];
    tangent: [number, number, number];
    crossTangent: [number, number, number];
    role: "carriageway" | "sidewalk" | "parapet";
  } {
    const x = Math.max(0, Math.min(this.totalLength, s));
    const a = this.axisAt(x);
    const nx = -a.ty,
      ny = a.tx;
    // (the drawn slice's grade: its two stations')
    const st = this.stations;
    let k = 1;
    while (k < st.length - 1 && st[k]! < x) k++;
    const ds = st[k]! - st[k - 1]!;
    const dz = ds > 1e-6 ? (this.deckAt(st[k]!) - this.deckAt(st[k - 1]!)) / ds : 0;
    const tl = Math.hypot(1, dz);
    const half = this.width / 2;
    const au = Math.abs(u);
    const role: "carriageway" | "sidewalk" | "parapet" =
      au > half - this.railW ? "parapet" : au > half - 2 && this.width >= 10 ? "sidewalk" : "carriageway";
    const z = this.deckAt(x) + (role === "parapet" ? this.railH : 0);
    const n = [-dz * a.tx, -dz * a.ty, 1];
    const nl = Math.hypot(n[0]!, n[1]!, n[2]!);
    return {
      position: [a.x + nx * u, a.y + ny * u, z],
      normal: [n[0]! / nl, n[1]! / nl, n[2]! / nl],
      tangent: [a.tx / tl, a.ty / tl, dz / tl],
      crossTangent: [nx, ny, 0],
      role,
    };
  }

  /** the nearest point of the axis to (x, y): its abscissa, its signed offset (+ left), its distance */
  project(x: number, y: number): { s: number; u: number; distance: number } {
    let best = Infinity,
      bestS = 0,
      bestU = 0;
    const pts = this.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]!,
        p1 = pts[i + 1]!;
      const dx = p1[0] - p0[0],
        dy = p1[1] - p0[1];
      const L2 = dx * dx + dy * dy;
      if (L2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - p0[0]) * dx + (y - p0[1]) * dy) / L2));
      const px = p0[0] + dx * t,
        py = p0[1] + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d < best) {
        best = d;
        bestS = this.spans[i]! + (this.spans[i + 1]! - this.spans[i]!) * t;
        bestU = (dx * (y - py) - dy * (x - px)) / Math.sqrt(L2);
      }
    }
    return { s: bestS, u: bestU, distance: best };
  }

  /** the axis's box [min x, min y, max x, max y] widened by `pad` */
  bounds(pad = 0): [number, number, number, number] {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of this.points) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
}

/** the registry's grid [m]: each deck listed in the cells its axis's box (widened by its half-width) touches */
const GRID_M = 64;

interface Entry {
  readonly ref: SupportRef;
  readonly profile: BridgeContinuousProfile;
  readonly level: number;
}

/**
 * The decks a scene holds (the world's: the scene worker registers each deck it builds), queried by place and level — the cars, the
 * lamps and the guardrails on a bridge —, independent of the view. A grid index (64 m) keeps a query to the decks near it (review A4:
 * a guardrail's piece scanned every bridge and every point).
 */
export class SupportSurfaceRegistry {
  private readonly bridges = new Map<string, Entry>();
  private readonly grid = new Map<number, Entry[]>();
  private static key(i: number, j: number) {
    return (i + 32768) * 65536 + (j + 32768);
  }

  registerBridge(ref: SupportRef, profile: BridgeContinuousProfile, level = 1): void {
    if (this.bridges.has(ref.surfaceId)) this.unregisterBridge(ref.surfaceId);
    const e: Entry = { ref, profile, level };
    this.bridges.set(ref.surfaceId, e);
    const [x0, y0, x1, y1] = profile.bounds(profile.width / 2 + 1);
    for (let j = Math.floor(y0 / GRID_M); j <= Math.floor(y1 / GRID_M); j++)
      for (let i = Math.floor(x0 / GRID_M); i <= Math.floor(x1 / GRID_M); i++) {
        const k = SupportSurfaceRegistry.key(i, j);
        (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(e);
      }
  }

  unregisterBridge(surfaceId: string): void {
    const e = this.bridges.get(surfaceId);
    if (!e) return;
    this.bridges.delete(surfaceId);
    for (const [k, list] of this.grid) {
      const i = list.indexOf(e);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) this.grid.delete(k);
    }
  }

  get size() {
    return this.bridges.size;
  }

  private near(x: number, y: number): readonly Entry[] {
    return this.grid.get(SupportSurfaceRegistry.key(Math.floor(x / GRID_M), Math.floor(y / GRID_M))) ?? [];
  }

  private result(e: Entry, s: number, u: number): SupportSampleResult {
    const v = e.profile.sample(s, u);
    return {
      found: true,
      supportRef: e.ref,
      point: v.position,
      elevation: v.position[2],
      normal: v.normal,
      tangent: v.tangent,
      crossTangent: v.crossTangent,
      surfaceRole: v.role,
      distanceToAxis: Math.abs(u),
      sM: s,
      uM: u,
    };
  }

  /**
   * The deck over (x, y) — within its drawn width (`margin` past it: 0 by default) —: with `expectedZ`, the one whose surface there is
   * nearest that height within `maxDeltaZ` (2.5 m); else the one of `expectedLevel` first (the source's layer), then the one whose
   * axis is nearest (no longer the first registered). `role: false` reads the deck's top even in the parapets' band (what stands
   * on the deck at its edge — a lamp's foot, a guardrail's post).
   */
  queryBridgeAt(
    x: number,
    y: number,
    options?: {
      readonly expectedZ?: number;
      readonly expectedLevel?: number;
      readonly maxDeltaZ?: number;
      readonly margin?: number;
      readonly deckTop?: boolean;
      /** (25 Nov 2026) the decks of `expectedLevel` alone (not merely preferred) */
      readonly sameLevel?: boolean;
    },
  ): SupportSampleResult | null {
    let best: { e: Entry; s: number; u: number; score: number } | null = null;
    const margin = options?.margin ?? 0;
    for (const e of this.near(x, y)) {
      if (options?.sameLevel && options.expectedLevel !== undefined && e.level !== options.expectedLevel) continue;
      const p = e.profile.project(x, y);
      if (p.distance > e.profile.width / 2 + margin) continue;
      // (past an end: off the deck)
      if (p.s <= 1e-6 && e.profile.totalLength > 0) {
        const a = e.profile.axisAt(0);
        if ((x - a.x) * a.tx + (y - a.y) * a.ty < -0.01) continue;
      }
      if (p.s >= e.profile.totalLength - 1e-6) {
        const a = e.profile.axisAt(e.profile.totalLength);
        if ((x - a.x) * a.tx + (y - a.y) * a.ty > 0.01) continue;
      }
      let score: number;
      if (options?.expectedZ !== undefined) {
        const dz = Math.abs(options.expectedZ - e.profile.deckAt(p.s));
        if (dz > (options.maxDeltaZ ?? 2.5)) continue;
        score = dz;
      } else {
        score = Math.abs(p.u) + (options?.expectedLevel !== undefined && e.level !== options.expectedLevel ? 1e6 : 0);
      }
      if (!best || score < best.score) best = { e, s: p.s, u: p.u, score };
    }
    if (!best) return null;
    if (options?.deckTop) {
      const r = this.result(best.e, best.s, 0);
      const a = best.e.profile.axisAt(best.s);
      return { ...r, point: [a.x - a.ty * best.u, a.y + a.tx * best.u, r.elevation], uM: best.u, distanceToAxis: Math.abs(best.u) };
    }
    return this.result(best.e, best.s, best.u);
  }

  /**
   * Something that stands on a deck near (x, y) — a lamp's foot, set beside a carriageway, often past the deck's edge (review A9) —
   * brought onto it: its offset across clamped inside the parapets by `inset` [m], on the deck's top there. Null: no deck within
   * `margin` of its edge.
   */
  snapOnDeck(
    x: number,
    y: number,
    options?: { readonly expectedLevel?: number; readonly margin?: number; readonly inset?: number },
  ): [number, number, number] | null {
    const r = this.queryBridgeAt(x, y, { expectedLevel: options?.expectedLevel, margin: options?.margin ?? 3 });
    if (!r?.supportRef) return null;
    const e = this.bridges.get(r.supportRef.surfaceId)!;
    const half = Math.max(0, e.profile.width / 2 - e.profile.railW - (options?.inset ?? 0.4));
    const u = Math.max(-half, Math.min(half, r.uM));
    const a = e.profile.axisAt(r.sM);
    return [a.x - a.ty * u, a.y + a.tx * u, e.profile.deckAt(r.sM)];
  }

  sample(ref: SupportRef, sM: number, uM: number): SupportSampleResult | null {
    const e = this.bridges.get(ref.surfaceId);
    return e ? this.result(e, sM, uM) : null;
  }

  /**
   * Multi-level support at (x, y, z) among the ground (groundZ) and the decks: the previous support kept while the actor stays on it
   * (hysteresis), else the deck nearest its height when nearer than the ground.
   */
  query(position: [number, number, number], groundZ: number, volumeRadius = 2.0, previousSupport?: SupportRef): SupportSampleResult {
    const [x, y, z] = position;
    if (previousSupport) {
      const prev = this.bridges.get(previousSupport.surfaceId);
      if (prev) {
        const p = prev.profile.project(x, y);
        if (p.distance <= prev.profile.width / 2 + 1) {
          const r = this.result(prev, p.s, p.u);
          if (Math.abs(z - r.elevation) <= Math.max(volumeRadius, 2.5)) return r;
        }
      }
    }
    let best: { e: Entry; s: number; u: number; d: number } | null = null;
    for (const e of this.near(x, y)) {
      const p = e.profile.project(x, y);
      if (p.distance > e.profile.width / 2 + 0.5) continue;
      const d = Math.abs(z - e.profile.sample(p.s, p.u).position[2]);
      if (d < Math.abs(z - groundZ) && d <= Math.max(volumeRadius * 2, 3.5) && (!best || d < best.d)) best = { e, s: p.s, u: p.u, d };
    }
    if (best) return this.result(best.e, best.s, best.u);
    return {
      found: true,
      point: [x, y, groundZ],
      elevation: groundZ,
      normal: [0, 0, 1],
      tangent: [1, 0, 0],
      crossTangent: [0, 1, 0],
      surfaceRole: "ground",
      distanceToAxis: 0,
      sM: 0,
      uM: 0,
    };
  }
}
