// The others' craft read at a time (docs/PLAN-RESEAU.md, « Afficher les autres »): each shown now — carried
// from its last sample by its motion (velocity, acceleration, spin): a wingman 25 m off flies 25 m off, not
// the 50 m behind a fifth of a second's delay would put him at 250 m/s —, a Hermite spline between two
// samples when read in the past, a ghost once its samples stopped; a new sample that disagrees with what was
// shown taken in smoothly, never a jump.

import type { CraftSample, Visual } from "./proto";

type V3 = [number, number, number];
type Q = [number, number, number, number];

export interface CraftState {
  slot: number;
  t: number;
  frame: number;
  body: number;
  kind: number;
  flags: number;
  p: V3;
  v: V3;
  q: Q;
  w: V3;
  vis: Visual;
  /** carried past its last sample [s] (0: between two samples) */
  ahead: number;
  /** too long without a sample: drawn as a ghost */
  ghost: boolean;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

function slerp(a: Q, b: Q, u: number): Q {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d *= s;
  if (d > 0.9995) {
    const r = a.map((x, k) => x + (s * b[k]! - x) * u) as Q;
    const n = Math.hypot(...r);
    return r.map((x) => x / n) as Q;
  }
  const th = Math.acos(d);
  const sa = Math.sin((1 - u) * th) / Math.sin(th),
    sb = (s * Math.sin(u * th)) / Math.sin(th);
  return a.map((x, k) => sa * x + sb * b[k]!) as Q;
}

/** q turned by the world-frame spin w over dt */
function spin(q: Q, w: V3, dt: number): Q {
  const ang = Math.hypot(...w) * dt;
  if (ang < 1e-12) return q;
  const k = Math.sin(ang / 2) / (ang / dt);
  const r: Q = [w[0] * k, w[1] * k, w[2] * k, Math.cos(ang / 2)];
  // r ⊗ q
  return [
    r[3] * q[0] + r[0] * q[3] + r[1] * q[2] - r[2] * q[1],
    r[3] * q[1] - r[0] * q[2] + r[1] * q[3] + r[2] * q[0],
    r[3] * q[2] + r[0] * q[1] - r[1] * q[0] + r[2] * q[3],
    r[3] * q[3] - r[0] * q[0] - r[1] * q[1] - r[2] * q[2],
  ];
}

function mixVisual(a: Visual, b: Visual, u: number): Visual {
  const o = { ...a };
  for (const k of Object.keys(a) as (keyof Visual)[]) o[k] = lerp(a[k], b[k], u);
  return o;
}

export interface TrackOptions {
  /** carried past the last sample at most [s of real time], then a ghost */
  maxAhead?: number;
  /** a disagreement taken in over [s of real time] */
  smooth?: number;
}

/** a sample's flag: coasting — no thrust, out of the air: its orbit alone carries it (R6) */
export const FLAG_COAST = 16;

/** what the registry lends its tracks: the room's pace, the orbits' propagation */
interface TrackEnv {
  /** the scene's seconds per real second (the room's warp; 1 at ×1) */
  pace: number;
  /** a coasting craft carried along its orbit about a body (inertial frame, m and m/s) by dt [s]; null: none */
  kepler: ((body: number, p: V3, v: V3, dt: number) => { p: V3; v: V3 } | null) | null;
}

/** One craft's samples and their reading. */
export class RemoteTrack {
  readonly samples: CraftSample[] = [];
  /** a craft left in the world by one away (R7): never a ghost — it stays where he left it, or on its orbit */
  persist = false;
  /** the error being taken in (shown − true), and the time it was measured */
  private corr: V3 = [0, 0, 0];
  private corrAt = 0;
  private last: { t: number; p: V3 } | null = null;
  private maxAhead: number;
  private smooth: number;

  constructor(
    readonly slot: number,
    o: TrackOptions = {},
    private env: TrackEnv = { pace: 1, kepler: null },
  ) {
    this.maxAhead = o.maxAhead ?? 1;
    this.smooth = o.smooth ?? 0.15;
  }

  push(s: CraftSample) {
    const S = this.samples;
    // (late or repeated: dropped — the samples ride an unordered channel)
    if (S.length && s.t <= S[S.length - 1]!.t) {
      if (S.some((x) => x.t === s.t)) return;
      S.push(s);
      S.sort((a, b) => a.t - b.t);
    } else S.push(s);
    // (2 s of history are enough to read behind — of real time: the room's warp stretches them)
    while (S.length > 2 && S[0]!.t < s.t - 2 * Math.max(1, this.env.pace)) S.shift();
    // the shown position measured against the new truth: the gap taken in smoothly from here (not across a change
    // of frame: a craft gone out of the air, into another's sphere)
    const prev = S.length > 1 ? S[S.length - 2]! : null;
    if (prev && (prev.frame !== s.frame || prev.body !== s.body)) this.corr = [0, 0, 0];
    else if (this.last) {
      const raw = this.raw(this.last.t);
      if (raw) {
        const e: V3 = [this.last.p[0] - raw.p[0], this.last.p[1] - raw.p[1], this.last.p[2] - raw.p[2]];
        // (a jump of a kilometre is a placing, not an error: taken at once)
        if (Math.hypot(...e) < 1000) {
          this.corr = e;
          this.corrAt = this.last.t;
        } else this.corr = [0, 0, 0];
      }
    }
  }

  get latest() {
    return this.samples[this.samples.length - 1] ?? null;
  }

  /** the craft at t, without the smoothing */
  raw(t: number): CraftState | null {
    const S = this.samples;
    if (!S.length) return null;
    let i = S.length - 1;
    while (i > 0 && S[i]!.t > t) i--;
    const a = S[i]!;
    const b0 = S[i + 1];
    // (between two samples of different frames — out of the air, another's sphere —: no curve across them)
    const b = b0 && b0.frame === a.frame && b0.body === a.body ? b0 : undefined;
    const P = Math.max(1, this.env.pace);
    // a coasting craft (no thrust, out of the air): carried along its orbit — exact at any warp
    const K = a.frame === 1 && a.flags & FLAG_COAST && t >= a.t ? this.env.kepler?.(a.body, a.p, a.v, t - a.t) : null;
    if (K) {
      const dt = t - a.t;
      // (its orbit's other pulls — the body's flattening, the Moon, the Sun —, as its pilot measured them)
      const g = a.a;
      return {
        slot: this.slot,
        t,
        frame: a.frame,
        body: a.body,
        kind: a.kind,
        flags: a.flags,
        p: [0, 1, 2].map((k) => K.p[k]! + 0.5 * g[k]! * dt * dt) as V3,
        v: [0, 1, 2].map((k) => K.v[k]! + g[k]! * dt) as V3,
        q: spin(a.q, a.w, Math.min(dt, this.maxAhead * P)),
        w: a.w,
        vis: a.vis,
        ahead: b ? 0 : Math.max(0, dt),
        // (its samples a second apart: a ghost once 5 s of real time passed without one)
        ghost: !this.persist && !b && dt > 5 * P,
      };
    }
    if (b && t >= a.t) {
      // between two samples: the cubic Hermite on the positions and velocities, the attitude slerped
      const h = b.t - a.t;
      const u = h > 0 ? (t - a.t) / h : 0;
      const u2 = u * u,
        u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1,
        h10 = u3 - 2 * u2 + u,
        h01 = -2 * u3 + 3 * u2,
        h11 = u3 - u2;
      const p = [0, 1, 2].map((k) => h00 * a.p[k]! + h10 * h * a.v[k]! + h01 * b.p[k]! + h11 * h * b.v[k]!) as V3;
      const dh00 = (6 * u2 - 6 * u) / h,
        dh10 = 3 * u2 - 4 * u + 1,
        dh01 = (-6 * u2 + 6 * u) / h,
        dh11 = 3 * u2 - 2 * u;
      const v = [0, 1, 2].map((k) => dh00 * a.p[k]! + dh10 * a.v[k]! + dh01 * b.p[k]! + dh11 * b.v[k]!) as V3;
      return {
        slot: this.slot,
        t,
        frame: b.frame,
        body: b.body,
        kind: b.kind,
        flags: u < 0.5 ? a.flags : b.flags,
        p,
        v,
        q: slerp(a.q, b.q, u),
        w: [0, 1, 2].map((k) => lerp(a.w[k]!, b.w[k]!, u)) as V3,
        vis: mixVisual(a.vis, b.vis, u),
        ahead: 0,
        ghost: false,
      };
    }
    // beyond the last sample (or before the first): carried by its motion, a while
    const dt = t - a.t;
    const c = Math.max(-this.maxAhead * P, Math.min(this.maxAhead * P, dt));
    const p = [0, 1, 2].map((k) => a.p[k]! + a.v[k]! * c + 0.5 * a.a[k]! * c * c) as V3;
    const v = [0, 1, 2].map((k) => a.v[k]! + a.a[k]! * c) as V3;
    return {
      slot: this.slot,
      t,
      frame: a.frame,
      body: a.body,
      kind: a.kind,
      flags: a.flags,
      p,
      v,
      q: spin(a.q, a.w, c),
      w: a.w,
      vis: a.vis,
      ahead: Math.max(0, dt),
      ghost: !this.persist && dt > this.maxAhead * 4 * P,
    };
  }

  /** the craft at t, as shown: the disagreements taken in smoothly */
  at(t: number): CraftState | null {
    const r = this.raw(t);
    if (!r) return null;
    const k = Math.exp(-Math.max(0, t - this.corrAt) / (this.smooth * Math.max(1, this.env.pace)));
    const p: V3 = [r.p[0] + this.corr[0] * k, r.p[1] + this.corr[1] * k, r.p[2] + this.corr[2] * k];
    this.last = { t, p };
    return { ...r, p };
  }
}

/** a track's key: a player's craft, his walker beside it */
export const trackKey = (slot: number, walker = false) => slot * 8 + (walker ? 1 : 0);

/**
 * The room's others: a track per slot, read at the room's time (`lead` 0: predicted to now) or a delay
 * behind it (`lead` "delay": late enough for the next sample, interpolated). The delay follows how late the
 * samples come (their lateness and their spacing, the slowest of the recent ones) — measured either way.
 */
export class RemoteRegistry {
  readonly tracks = new Map<number, RemoteTrack>();
  /** the delay the others are shown with [s] */
  delay = 0.1;
  /** shown predicted to now (0), or interpolated behind by the delay */
  lead: 0 | "delay" = 0;
  /** how late the samples come [s]: median and 95th percentile of the recent ones */
  late50 = 0;
  late95 = 0;
  private late: number[] = [];
  /** the room's pace and the orbits' propagation, lent to every track (R6) */
  readonly env: TrackEnv = { pace: 1, kepler: null };

  constructor(private o: TrackOptions & { minDelay?: number; maxDelay?: number } = {}) {}

  /** a sample, and how late it came [s] (its arrival's room time − its own time) */
  push(s: CraftSample, lateness: number) {
    const key = trackKey(s.slot, s.kind === 4);
    let tr = this.tracks.get(key);
    if (!tr) this.tracks.set(key, (tr = new RemoteTrack(s.slot, this.o, this.env)));
    const prev = tr.latest;
    tr.push(s);
    // (a duplicate — the same sample come both ways, direct and through the server — or a late one: no news)
    if (prev && s.t <= prev.t) return;
    // (the delay: late enough for the next sample — its lateness plus the spacing between two)
    const gap = prev && s.t > prev.t ? s.t - prev.t : 0;
    if (Number.isFinite(lateness)) {
      this.late.push(lateness + gap);
      if (this.late.length > 60) this.late.shift();
      const sorted = [...this.late].sort((a, b) => a - b);
      this.late50 = sorted[Math.floor(sorted.length / 2)]! - gap;
      this.late95 = sorted[Math.floor(sorted.length * 0.95)]! - gap;
      const want = Math.min(this.o.maxDelay ?? 0.25, Math.max(this.o.minDelay ?? 0.03, sorted[Math.floor(sorted.length * 0.95)]! + 0.01));
      // (eased: a change of delay is a change of the others' pace — 5 % a sample at most)
      this.delay += Math.max(-0.05 * this.delay, Math.min(0.05 * this.delay, want - this.delay));
    }
  }

  /** a player's tracks gone (his craft's, his walker's) */
  drop(slot: number) {
    this.tracks.delete(trackKey(slot));
    this.tracks.delete(trackKey(slot, true));
  }

  /** a craft left by one away (R7): its track at a slot of its own, its last sample, never a ghost */
  setAway(slot: number, s: CraftSample) {
    const key = trackKey(slot);
    const tr = new RemoteTrack(slot, this.o, this.env);
    tr.persist = true;
    tr.push({ ...s, slot });
    this.tracks.set(key, tr);
  }

  /** a sample's craft at scene time t — carried along its orbit, or where it stood — (R7: our craft as we left it) */
  stateOf(s: CraftSample, t: number): CraftState | null {
    const tr = new RemoteTrack(s.slot, this.o, this.env);
    tr.persist = true;
    tr.push(s);
    return tr.raw(t);
  }

  /** a player's craft's track (or his walker's) */
  track(slot: number, walker = false) {
    return this.tracks.get(trackKey(slot, walker));
  }

  clear() {
    this.tracks.clear();
    this.late = [];
  }

  /** every other craft as shown at the room's time `now` */
  states(now: number): CraftState[] {
    const out: CraftState[] = [];
    for (const tr of this.tracks.values()) {
      const s = tr.at(this.lead === 0 ? now : now - this.delay);
      if (s) out.push(s);
    }
    return out;
  }
}
