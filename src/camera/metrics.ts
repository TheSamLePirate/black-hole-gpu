// The camera's smoothness sensor (docs/PLAN-CAMERA-AAA.md CAM0): where the view was each drawn frame — its place
// relative to the body it is nearest (so a planet's orbit, a time warp, do not count as motion of the view), its look,
// its field — kept in a ring while running; analyse() finds what a viewer sees as a fault:
//
// - a jump      a frame's move far larger than its neighbours' (3×, and a sensible share of the height over the
//               ground: a jump at 10 m over the Alps is not one at 10 au) — a teleport, a re-anchoring, a reset;
// - a turn jump a frame's turn of the look far larger than its neighbours' (and over 1°) — a snap of the aim;
// - a fov jump  the field changing by more than its neighbours' rate (and over 0.5°) — a lens fought over;
// - a speed break the view's speed (in heights a second, scale-free) changing by more than half in one frame while
//               neither frame is at rest — a motion handed from one system to another without its velocity.
//
// Cuts made on purpose (a scene's change, a director's cut) are marked by mark("cut") and forgiven within a frame.
// Free when stopped: main.ts asks `active` before gathering anything. analyse() is pure.

export type V3 = [number, number, number];

/** One drawn frame. Places in metres. */
export interface CamSample {
  /** the rAF stamp [ms] */
  t: number;
  /** the body the place is taken from (its id; "" none — the place then the frame's own origin) */
  ref: string;
  /** the view's place relative to that body's centre [m], its height over the body's surface [m] (∞: no body) */
  P: V3;
  h: number;
  /** the look and the up (world axes, unit) */
  fwd: V3;
  up: V3;
  /** the vertical field [deg] */
  fov: number;
  /** the simulation advanced this frame (false: paused, frozen) */
  moving: boolean;
}

export interface CamMark {
  at: number;
  label: string;
}

export interface CamFault {
  kind: "jump" | "turn" | "fov" | "speed";
  /** the frame's index, its stamp [ms], the stretch's label */
  i: number;
  t: number;
  label: string;
  /** how far over its neighbours (the ratio), the size of the fault (m, deg, deg, ratio) */
  score: number;
  size: number;
  /** the height over the ground there [m] */
  h: number;
}

export interface CamReport {
  frames: number;
  seconds: number;
  faults: CamFault[];
  counts: { jump: number; turn: number; fov: number; speed: number };
  /** the worst move ratio to the neighbours' (1 smooth), its 95th percentile */
  worstJump: number;
  p95Jump: number;
  /** the worst turn in a frame [deg] */
  worstTurn: number;
}

export class CamProbe {
  active = false;
  private ring: CamSample[] = [];
  private max = 20_000;
  marks: CamMark[] = [];

  start(max = 20_000) {
    this.max = max;
    this.ring = [];
    this.marks = [];
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  /** a label from now on ("cut": the next frame's move is meant — forgiven) */
  mark(label: string) {
    this.marks.push({ at: this.ring.length, label });
  }

  record(s: CamSample) {
    if (!this.active) return;
    this.ring.push(s);
    if (this.ring.length > this.max) {
      const n = this.ring.length - this.max;
      this.ring.splice(0, n);
      for (const m of this.marks) m.at -= n;
      this.marks = this.marks.filter((m) => m.at >= 0 || m.label !== "cut");
    }
  }

  get recorded() {
    return this.ring.length;
  }

  samples(): CamSample[] {
    return this.ring.slice();
  }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const angle = (a: V3, b: V3) => (Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

function median(v: number[]) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : 0.5 * (s[m - 1]! + s[m]!);
}

/** the neighbours' values of a per-step series around step i (two each side, the step itself left out) */
function around(v: (number | null)[], i: number) {
  const out: number[] = [];
  for (const j of [i - 2, i - 1, i + 1, i + 2]) {
    const x = v[j];
    if (x !== null && x !== undefined && Number.isFinite(x)) out.push(x);
  }
  return out;
}

export interface CamAnalyseOptions {
  /** the stretch [ms stamps] */
  from?: number;
  to?: number;
}

/** The faults in a run of samples (marks: the labels and cuts, by sample index). */
export function analyse(all: CamSample[], marks: CamMark[] = [], o: CamAnalyseOptions = {}): CamReport {
  const idx: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const t = all[i]!.t;
    if ((o.from === undefined || t >= o.from) && (o.to === undefined || t <= o.to)) idx.push(i);
  }
  const S = idx.map((i) => all[i]!);
  const labelAt = (k: number) => {
    let l = "";
    for (const m of marks) if (m.at <= idx[k]! && m.label !== "cut") l = m.label;
    return l;
  };
  const cut = new Set<number>();
  for (const m of marks) if (m.label === "cut") for (const d of [0, 1]) cut.add(m.at + d);
  // per step k (from k-1 to k): the move [m], its rate in heights a second, the turn [deg], the field's change
  const move: (number | null)[] = [null],
    rate: (number | null)[] = [null],
    turn: (number | null)[] = [null],
    dfov: (number | null)[] = [null];
  for (let k = 1; k < S.length; k++) {
    const a = S[k - 1]!,
      b = S[k]!;
    const dt = Math.max(1e-3, (b.t - a.t) / 1000);
    const same = a.ref === b.ref;
    const d = same ? len(sub(b.P, a.P)) : null;
    move.push(d);
    const h = Math.max(1, Math.min(a.h, b.h));
    rate.push(d === null || !Number.isFinite(h) ? null : d / dt / h);
    turn.push(angle(a.fwd, b.fwd));
    dfov.push(Math.abs(b.fov - a.fov));
  }
  const faults: CamFault[] = [];
  const ratios: number[] = [];
  for (let k = 1; k < S.length; k++) {
    const s = S[k]!;
    if (cut.has(idx[k]!)) continue;
    const h = Number.isFinite(s.h) ? Math.max(0, s.h) : 1e12;
    const d = move[k];
    if (d !== null && d !== undefined) {
      const e = median(around(move, k));
      const r = d / (e + 1e-3 + 1e-6 * h);
      ratios.push(r);
      // (a sensible share of the height, at least a metre: what the eye takes for a jump at that scale)
      if (r > 3 && d > Math.max(1, 0.02 * Math.max(h, 50)))
        faults.push({ kind: "jump", i: idx[k]!, t: s.t, label: labelAt(k), score: r, size: d, h });
    }
    const th = turn[k]!;
    const et = median(around(turn, k));
    if (th > 1 && th > 3 * et + 0.2)
      faults.push({ kind: "turn", i: idx[k]!, t: s.t, label: labelAt(k), score: th / (et + 0.05), size: th, h });
    const df = dfov[k]!;
    const ef = median(around(dfov, k));
    if (df > 0.5 && df > 3 * ef + 0.1)
      faults.push({ kind: "fov", i: idx[k]!, t: s.t, label: labelAt(k), score: df / (ef + 0.05), size: df, h });
    const u0 = rate[k - 1],
      u1 = rate[k];
    if (k > 1 && u0 != null && u1 != null && s.moving && S[k - 1]!.moving) {
      const hi = Math.max(u0, u1),
        lo = Math.min(u0, u1);
      // (both frames moving at a speed one sees — over 2 % of the height a second — and one under half the other)
      if (lo > 0.02 && hi > 2 * lo && hi - lo > 0.2 && !cut.has(idx[k - 1]!))
        faults.push({ kind: "speed", i: idx[k]!, t: s.t, label: labelAt(k), score: hi / lo, size: hi / lo, h });
    }
  }
  const counts = { jump: 0, turn: 0, fov: 0, speed: 0 };
  for (const f of faults) counts[f.kind]++;
  ratios.sort((a, b) => a - b);
  return {
    frames: S.length,
    seconds: S.length > 1 ? (S[S.length - 1]!.t - S[0]!.t) / 1000 : 0,
    faults,
    counts,
    worstJump: ratios.length ? ratios[ratios.length - 1]! : 1,
    p95Jump: ratios.length ? ratios[Math.floor(0.95 * (ratios.length - 1))]! : 1,
    worstTurn: turn.reduce<number>((m, x) => Math.max(m, x ?? 0), 0),
  };
}
