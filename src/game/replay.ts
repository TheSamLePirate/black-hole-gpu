// The flight's replay (docs/PLAN-AVIATION-AAA.md, S3) — pure: the tape of the last minutes flown (each frame the
// craft where it was on the WGS84 Earth, its axes, its figures, what happened — a burst, a launch, a kill, a
// touchdown —, and what the app needs to draw it again, opaque here), the replay's cameras (the chase lagging the
// turns, the orbit about the craft, the fly-by standing where it will pass and following it with a long lens, the
// cockpit), the director cutting between them by what the craft does, and the best moments found for a trailer.
//
// The cameras are poses on the craft's own axes (x its left, y its top, z its nose — mounts.ts): the eye, where it
// looks, the up (the world's: the horizon kept level), a field. The world's places are body-fixed (ECEF) metres.

import { geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";

export type V3 = [number, number, number];

/** The craft as the tape keeps it each frame. */
export interface TapeSample {
  /** where it is: body-fixed (ECEF, WGS84) [m] */
  p: V3;
  /** its axes (x its left, y its top, z its nose), each on the local east, north, up */
  ax: [V3, V3, V3];
  /** geodetic [°], height over the ellipsoid [m], over the ground [m] */
  lat: number;
  lon: number;
  alt: number;
  agl: number;
  /** its speed through the air [m/s], Mach, normal load [g] */
  speed: number;
  mach: number;
  nz: number;
}

/** What happened in a frame (bits). */
export const EV = {
  /** the gun firing */
  FIRE: 1,
  /** a missile away (ours) */
  LAUNCH: 2,
  /** an explosion within a few km (a kill, a hit) */
  BOOM: 4,
  /** a touchdown, a trap */
  TOUCH: 8,
  /** in formation: wingmen close */
  FORM: 16,
  /** the afterburner lit */
  AB: 32,
} as const;

export interface TapeFrame<R = unknown> {
  /** the tape's clock [s] (the flight's seconds as they ran: a pause not counted) */
  t: number;
  s: TapeSample;
  /** what happened (EV bits) */
  ev: number;
  /** the app's: the settings to put back, what the renderer drew */
  data: R;
}

export const REPLAY = {
  /** the tape's length [s] */
  seconds: 150,
  /** a frame at most every … [s] */
  every: 1 / 60,
  /** a trailer's moments: how many, each how long [s] */
  moments: 3,
  momentS: 8,
  /** the director's cuts: every … [s] */
  cutMin: 3.2,
  cutMax: 5,
};

/** The last minutes flown, a frame each rendered frame (at most 60 a second). */
export class FlightTape<R = unknown> {
  frames: TapeFrame<R>[] = [];
  /** the tape's clock */
  clock = 0;
  constructor(readonly seconds = REPLAY.seconds) {}

  /** The clock run on by `dt` [s] (only while the flight runs). */
  tick(dt: number) {
    this.clock += dt;
  }

  /** A frame kept (too soon after the last: skipped — its events carried onto the last). */
  push(s: TapeSample, ev: number, data: R): boolean {
    let last = this.frames.at(-1);
    // (a jump — a scene set, the craft placed elsewhere —: the tape begun afresh)
    if (last && Math.hypot(...sub(s.p, last.s.p)) > 1500 + 3 * s.speed * (this.clock - last.t)) {
      this.frames = [];
      last = undefined;
    }
    if (last && this.clock - last.t < REPLAY.every * 0.9) {
      last.ev |= ev;
      return false;
    }
    this.frames.push({ t: this.clock, s, ev, data });
    // (the oldest dropped, a hundred at a time)
    if (this.frames[0]!.t < this.clock - this.seconds - 2) {
      const k = this.frames.findIndex((f) => f.t >= this.clock - this.seconds);
      this.frames.splice(0, Math.max(k, 1));
    }
    return true;
  }

  clear() {
    this.frames = [];
  }

  get start() {
    return this.frames[0]?.t ?? 0;
  }
  get end() {
    return this.frames.at(-1)?.t ?? 0;
  }
  get length() {
    return this.end - this.start;
  }

  /** The frame at time t: the last at or before it. */
  index(t: number): number {
    const f = this.frames;
    let lo = 0,
      hi = f.length - 1;
    if (hi < 0) return -1;
    if (t <= f[0]!.t) return 0;
    if (t >= f[hi]!.t) return hi;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (f[m]!.t <= t) lo = m;
      else hi = m;
    }
    return lo;
  }
  at(t: number): TapeFrame<R> | null {
    const i = this.index(t);
    return i < 0 ? null : this.frames[i]!;
  }
}

// ---------------------------------------------------------------- the world's axes

const D = Math.PI / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 1];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The local east, north, up at a geodetic place (ECEF unit vectors). */
export function enuAt(latDeg: number, lonDeg: number): [V3, V3, V3] {
  const f = latDeg * D,
    l = lonDeg * D;
  const sf = Math.sin(f),
    cf = Math.cos(f),
    sl = Math.sin(l),
    cl = Math.cos(l);
  return [
    [-sl, cl, 0],
    [-sf * cl, -sf * sl, cf],
    [cf * cl, cf * sl, sf],
  ];
}

/** A place on the ellipsoid (ECEF [m]). */
export function ecefOf(latDeg: number, lonDeg: number, h: number): V3 {
  return geodeticToCart(WGS84_A, WGS84_F, latDeg * D, lonDeg * D, h) as V3;
}

/** The craft's axes in ECEF (x left, y top, z nose). */
export function axesOf(s: TapeSample): [V3, V3, V3] {
  const [E, N, U] = enuAt(s.lat, s.lon);
  return s.ax.map((a) => norm(add(add(scale(E, a[0]), N, a[1]), U, a[2]))) as [V3, V3, V3];
}

/** A world vector (ECEF) on the craft's axes. */
export function onCraft(s: TapeSample, v: V3, A = axesOf(s)): V3 {
  return [dot(v, A[0]), dot(v, A[1]), dot(v, A[2])];
}

// ---------------------------------------------------------------- the cameras

export type ReplayShot = "chase" | "orbit" | "flyby" | "cockpit";
export const REPLAY_SHOTS: ReplayShot[] = ["chase", "orbit", "flyby", "cockpit"];

/** A camera's pose on the craft's axes: the eye, where it looks, its up; its field [°] (none: the view's own). */
export interface ShotPose {
  eye: V3;
  aim: V3;
  up?: V3;
  fov?: number;
}

/** A shot's state from its start: when it began, the fly-by's standing place (ECEF), the orbit's start. */
export interface ShotState {
  shot: ReplayShot;
  t0: number;
  stand?: V3;
  theta0?: number;
}

/** The craft's centre on its axes [m] (the F-35's, near enough for any). */
const CENTRE: V3 = [0, 1, 0];

/** A shot begun at time t: the fly-by's place chosen ahead on the path, aside and a little under it. */
export function startShot(tape: FlightTape, shot: ReplayShot, t: number, seed = 0): ShotState {
  const st: ShotState = { shot, t0: t };
  if (shot === "orbit") st.theta0 = (((seed * 137) % 360) + 200) * D;
  if (shot === "flyby") st.stand = flybyStand(tape, t, seed);
  return st;
}

/** Where a fly-by's camera stands: on the path 2.5 s ahead (the tape's end at most), aside of it by some 50 m (more
 *  for a fast craft), below it by a quarter of its height over the ground (25 m at most, kept 3 m over it: the horizon
 *  in the frame), level with it near the ground. */
export function flybyStand(tape: FlightTape, t: number, seed = 0): V3 {
  const ahead = tape.at(Math.min(t + 2.5, tape.end)) ?? tape.at(t)!;
  const s = ahead.s;
  const U = enuAt(s.lat, s.lon)[2];
  const A = axesOf(s);
  // (the path's direction: the nose's, level)
  const fwd = norm(sub(A[2], scale(U, dot(A[2], U))));
  const right = cross(fwd, U);
  const side = seed % 2 ? -1 : 1;
  const off = 35 + 0.08 * s.speed;
  const below = Math.min(Math.max(0.25 * s.agl, 0), 25);
  const down = Math.min(below, Math.max(s.agl - 3, 0));
  return add(add(s.p, right, side * off), U, -down + (s.agl < 20 ? 1.5 : 0));
}

/**
 * The camera's pose at time t for a shot (state from startShot): on the craft's axes, the horizon level (the up the
 * world's) but in the cockpit (the craft's own seat: `cockpit`).
 */
export function shotPose(tape: FlightTape, st: ShotState, t: number, cockpit?: ShotPose): ShotPose | null {
  const f = tape.at(t);
  if (!f) return null;
  const s = f.s;
  const A = axesOf(s);
  const [, , U] = enuAt(s.lat, s.lon);
  const up = onCraft(s, U, A);
  const at = (w: V3) => onCraft(s, sub(w, s.p), A);
  if (st.shot === "cockpit") return cockpit ?? { eye: [0, 1.6, 4.7], aim: [0, 1.5, 20] };
  if (st.shot === "chase") {
    // (behind the nose as it was a little before — the turns lag —, a little above, looking a little ahead)
    let lag: V3 = [0, 0, 0];
    for (let k = 0; k <= 6; k++) lag = add(lag, axesOf(tape.at(t - k * 0.07)!.s)[2]);
    const back = norm(lag);
    const eye = at(add(add(s.p, back, -24 - 0.03 * s.speed), U, 5.5));
    return { eye, aim: [0, 1, 6], up };
  }
  if (st.shot === "orbit") {
    // (once round in 14 s, 30 m off, its height swinging)
    const u = t - st.t0;
    const th = (st.theta0 ?? 0) + (u * 2 * Math.PI) / 14;
    const [E, N] = enuAt(s.lat, s.lon);
    const h = 4 + 5 * Math.sin(u * 0.6);
    const w = add(add(add(s.p, E, 30 * Math.cos(th)), N, 30 * Math.sin(th)), U, Math.min(h, Math.max(s.agl - 4, -10)));
    return { eye: at(w), aim: CENTRE, up };
  }
  // the fly-by: standing; the lens long while it is far (the craft some 30 m across the frame), wide as it passes
  const stand = st.stand ?? flybyStand(tape, st.t0);
  const eye = at(stand);
  const dist = Math.hypot(...sub(eye, CENTRE));
  const fov = Math.min(Math.max((2 * Math.atan(16 / Math.max(dist, 1))) / D, 6), 70);
  return { eye, aim: CENTRE, up, fov };
}

// ---------------------------------------------------------------- the director, the moments

/** How much a frame is worth watching: low and fast, a hard pull, through Mach 1 low, the gun, a launch, a kill, a
 *  touchdown, a formation. */
export function interest(f: TapeFrame): number {
  const s = f.s;
  let x = 0;
  if (s.agl < 600 && s.speed > 60) x += (Math.min(s.speed, 350) / 250) * (1 - s.agl / 600) * 2.5;
  x += Math.min(Math.max(Math.abs(s.nz) - 3, 0) / 3, 2);
  if (s.mach > 0.93 && s.mach < 1.15 && s.alt < 4000) x += 1.5;
  if (f.ev & EV.FIRE) x += 1.5;
  if (f.ev & EV.LAUNCH) x += 12;
  if (f.ev & EV.BOOM) x += 18;
  if (f.ev & EV.TOUCH) x += 12;
  if (f.ev & EV.FORM) x += 1;
  if (f.ev & EV.AB) x += 0.3;
  return x;
}

export type MomentKind = "low" | "pull" | "sonic" | "gun" | "missile" | "kill" | "touch" | "form" | "flight";

/** A moment for the trailer: its span on the tape, its worth, what it is, its figures. */
export interface Moment {
  t0: number;
  t1: number;
  score: number;
  kind: MomentKind;
  /** its lowest height over the ground [m], its top speed [m/s], its top load [g] */
  agl: number;
  speed: number;
  nz: number;
}

/** What a span shows best. */
function kindOf(fr: TapeFrame[]): MomentKind {
  let ev = 0,
    agl = Infinity,
    nz = 0,
    sonic = false,
    lowFast = 0;
  for (const f of fr) {
    ev |= f.ev;
    agl = Math.min(agl, f.s.agl);
    nz = Math.max(nz, Math.abs(f.s.nz));
    if (f.s.mach > 0.93 && f.s.mach < 1.15 && f.s.alt < 4000) sonic = true;
    if (f.s.agl < 150 && f.s.speed > 120) lowFast++;
  }
  if (ev & EV.BOOM) return "kill";
  if (ev & EV.LAUNCH) return "missile";
  if (ev & EV.TOUCH) return "touch";
  if (ev & EV.FIRE) return "gun";
  if (sonic) return "sonic";
  if (lowFast > fr.length / 4) return "low";
  if (nz > 5) return "pull";
  if (ev & EV.FORM) return "form";
  return agl < 300 ? "low" : "flight";
}

/**
 * The best moments on the tape for a trailer: spans of `len` seconds with the most worth (the events counted once,
 * near the span's middle), apart from each other, the best `n` in the order flown. Always one at least (the tape's
 * last span) when the tape is long enough.
 */
export function bestMoments(tape: FlightTape, n = REPLAY.moments, len = REPLAY.momentS): Moment[] {
  const F = tape.frames;
  if (tape.length < 2) return [];
  len = Math.min(len, tape.length);
  // (the worth per frame, integrated over time — prefix sums)
  const w = F.map((f) => interest(f));
  const cum = [0];
  for (let i = 1; i < F.length; i++) cum.push(cum[i - 1]! + 0.5 * (w[i]! + w[i - 1]!) * (F[i]!.t - F[i - 1]!.t));
  // (an event's worth once, not each of its frames: a burst counted per second)
  const spans: Moment[] = [];
  const step = 0.5;
  for (let t0 = tape.start; t0 + len <= tape.end + 1e-6; t0 += step) {
    const i0 = tape.index(t0),
      i1 = tape.index(t0 + len);
    let score = cum[i1]! - cum[i0]!;
    // (the events: their bonus, the span centred on them better)
    for (let i = i0; i <= i1; i++)
      if (F[i]!.ev & (EV.LAUNCH | EV.BOOM | EV.TOUCH)) {
        const c = Math.abs(F[i]!.t - (t0 + len * 0.45)) / len;
        score += (F[i]!.ev & EV.BOOM ? 30 : 20) * (1 - c);
      }
    const fr = F.slice(i0, i1 + 1);
    spans.push({
      t0,
      t1: t0 + len,
      score,
      kind: kindOf(fr),
      agl: Math.min(...fr.map((f) => f.s.agl)),
      speed: Math.max(...fr.map((f) => f.s.speed)),
      nz: Math.max(...fr.map((f) => Math.abs(f.s.nz))),
    });
  }
  spans.sort((a, b) => b.score - a.score);
  const out: Moment[] = [];
  for (const m of spans) {
    if (out.length >= n) break;
    if (out.some((o) => m.t0 < o.t1 + 1 && o.t0 < m.t1 + 1)) continue;
    // (a moment much poorer than the best: left out — a calm cruise does not make a trailer — but the first)
    if (out.length && (m.score < 0.25 * out[0]!.score || out[0]!.score <= 0)) continue;
    out.push(m);
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

/** The director's next shot at time t (the last one `prev`): the fly-by for the craft low and fast, the chase for a
 *  burst, a launch or a kill coming, the orbit for a hard pull or a formation, else the next in turn. */
export function directorShot(tape: FlightTape, t: number, prev: ReplayShot | null, k = 0): ReplayShot {
  const f = tape.at(t);
  if (!f) return "chase";
  // (what comes in the next 3 s)
  let ev = 0,
    nz = 0;
  for (let u = t; u < Math.min(t + 3, tape.end); u += 0.1) {
    const g = tape.at(u)!;
    ev |= g.ev;
    nz = Math.max(nz, Math.abs(g.s.nz));
  }
  const s = f.s;
  let want: ReplayShot;
  if (ev & (EV.FIRE | EV.LAUNCH | EV.BOOM)) want = prev === "chase" ? "flyby" : "chase";
  else if (ev & EV.TOUCH) want = "flyby";
  else if (s.agl < 300 && s.speed > 100) want = prev === "flyby" ? "chase" : "flyby";
  else if (nz > 4.5 || ev & EV.FORM) want = prev === "orbit" ? "chase" : "orbit";
  else want = (["chase", "orbit", "flyby"] as ReplayShot[])[k % 3]!;
  if (want === prev) want = want === "chase" ? "orbit" : "chase";
  return want;
}

/** A cut's length: a little different each time. */
export function cutLength(k: number): number {
  return REPLAY.cutMin + ((((Math.sin(k * 12.9898) * 43758.5453) % 1) + 1) % 1) * (REPLAY.cutMax - REPLAY.cutMin);
}
