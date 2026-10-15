// The intercept (docs/PLAN-AVIATION-AAA.md, C2): for the radar's lock, the cues a fighter pilot flies by — the
// collision course (the heading that meets it at our speed), the pursuit flown now (lead: ahead of its line of
// sight, pure: on it, lag: behind), the time to the merge, the aspect angle (from its tail: 0° behind it, 180°
// head on, its side), the heading crossing angle —; and the INTERCEPT autopilot: a stern conversion — the run
// aimed at a point displaced to the side by the turn's room (two turn radii head on, none from behind), then
// behind it —, the rejoin and the shadow then flown by the formation law (game/formation.ts) on a slot 300 m
// behind on its left, as a real interception (a police of the sky's) does to identify it by eye. Pure.

import { FORM, type FormCraft, type FormOut, type FormSlot, formationStep } from "./formation";
import { JET, altHoldGamma, wrapPi } from "./jet";

type V3 = readonly [number, number, number] | number[];
const dot = (a: V3, b: V3) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const sub = (a: V3, b: V3): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const scale = (a: V3, k: number): number[] => [a[0]! * k, a[1]! * k, a[2]! * k];
const len = (a: V3) => Math.hypot(a[0]!, a[1]!, a[2]!);
const unit = (a: V3): number[] => scale(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const G = 9.81;
const D = Math.PI / 180;

/** The time [s] a craft at `s` [m/s] from the origin meets a point at `r` moving at `v` (null: never — it
 *  outruns us). */
export function collisionTime(r: V3, v: V3, s: number): number | null {
  // |r + v t| = s t: (v² − s²) t² + 2 r·v t + r² = 0
  const a = dot(v, v) - s * s,
    b = 2 * dot(r, v),
    c = dot(r, r);
  if (Math.abs(a) < 1e-9) return b < 0 ? -c / b : null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const q = Math.sqrt(disc);
  const ts = [(-b - q) / (2 * a), (-b + q) / (2 * a)].filter((t) => t > 0);
  return ts.length ? Math.min(...ts) : null;
}

/** The cues on a target, in the local frame (east, north, up): its place relative to us `r` [m], its velocity
 *  `vt` and ours `vo` [m/s]. Headings clockwise from north [rad]. */
export interface InterceptCues {
  /** the collision course: its direction (a unit vector; null: it outruns us), its heading; the merge's time [s] */
  coll: number[] | null;
  collHdg: number | null;
  tti: number | null;
  /** the line of sight's heading (pure pursuit) */
  pureHdg: number;
  /** the pursuit flown: our track ahead of the line of sight (lead), on it (pure, within 3°), behind (lag); by [°] */
  pursuit: "LEAD" | "PURE" | "LAG";
  pursuitDeg: number;
  /** the aspect angle [°]: from its tail to us (0 behind it, 180 head on); our side of it (L: its left) */
  aspect: number;
  side: "L" | "R";
  /** the heading crossing angle [°] (between the two tracks) */
  hca: number;
  /** the closing speed [m/s] (> 0: closing) */
  closure: number;
}

const hdgOf = (v: V3) => (Math.atan2(v[0]!, v[1]!) + 2 * Math.PI) % (2 * Math.PI);

export function interceptCues(r: V3, vt: V3, vo: V3): InterceptCues {
  const d = len(r) || 1;
  const s = len(vo);
  const t = collisionTime(r, vt, Math.max(s, 1));
  const aim = t !== null ? [0, 1, 2].map((k) => r[k]! + vt[k]! * t) : null;
  const coll = aim ? unit(aim) : null;
  const pureHdg = hdgOf(r);
  // (the pursuit: our track against the line of sight, on its side — ahead of it towards where it goes: lead)
  const toh = hdgOf(vo);
  const off = wrapPi(toh - pureHdg);
  const goes = wrapPi(hdgOf(vt) - pureHdg);
  const vth = Math.hypot(vt[0]!, vt[1]!);
  const lead = vth > 1 && Math.sign(off) === Math.sign(goes);
  const deg = Math.abs(off) / D;
  // (the aspect: the line from it to us against its tail, flat)
  const back = [-vt[0]!, -vt[1]!];
  const us = [-r[0]!, -r[1]!];
  const aspect =
    vth > 1 ? Math.acos(clamp((back[0]! * us[0]! + back[1]! * us[1]!) / (vth * (Math.hypot(us[0]!, us[1]!) || 1)), -1, 1)) / D : 0;
  // (its left: to the left of its track — its track × the way to us, flat, upwards)
  const side = vt[0]! * us[1]! - vt[1]! * us[0]! > 0 ? "L" : "R";
  const voh = Math.hypot(vo[0]!, vo[1]!);
  const hca = vth > 1 && voh > 1 ? Math.abs(wrapPi(hdgOf(vt) - toh)) / D : 0;
  return {
    coll,
    collHdg: aim ? hdgOf(aim) : null,
    tti: t,
    pureHdg,
    pursuit: deg < 3 ? "PURE" : lead ? "LEAD" : "LAG",
    pursuitDeg: deg,
    aspect,
    side,
    hca,
    closure: -dot(sub(vt, vo), scale(r, 1 / d)),
  };
}

export const ICPT = {
  /** the shadow's slot: behind it, on its left, level [m] */
  slot: { right: -60, back: 300, up: 0 } as FormSlot,
  /** the run's bank at most [rad] (its turn's radius counts on it); a formation's rejoin's (2 g level) */
  bankMax: 45 * D,
  rejoinBank: 60 * D,
  /** a turn of more than `turnSlowErr` [rad] to fly: at most this speed [m/s] (a fighter's turn — its radius) */
  turnSlowErr: 45 * D,
  turnSpd: 230,
  /** the run's heading gain [bank per radian off] */
  hdgGain: 2,
  /** the run's speed: over the target's — at most, at least [m/s]; the deceleration the closing counts on [m/s²];
   *  the slowest, the fastest flown [m/s] */
  overMax: 150,
  overMin: 20,
  stopA: 0.8,
  vMin: 130,
  vMax: 320,
  /** head on (it still before us), the run's speed over its [m/s]: slow enough to turn tight behind it */
  overHead: 40,
  /** the rejoin given to the formation law: the slot within this [m], our tracks within this [°]; back to the run
   *  beyond this [m] or across its track by this [°] */
  joinDist: 3000,
  joinHca: 50,
  runDist: 8000,
  runHca: 100,
  /** the turn onto its track begun when, flown now at the run's bank, it would end this far behind it [m]; ended
   *  within this of its track [°] */
  rollout: 2000,
  turnEnd: 30,
  /** a target turning harder than this across its track [m/s²]: no turn onto its track (it has none) — the run a
   *  pursuit of the slot, joined within `joinDist` whatever the angle */
  manoeuvre: 0.6,
  /** the shadow reached: the slot within this [m] */
  shadowDist: 80,
} as const;

export type IcptPhase = "run" | "turn" | "join" | "shadow";

export interface IcptOut {
  phase: IcptPhase;
  /** the plane law's bank, flight path; the autothrottle's speed; the air brake; the acceleration asked */
  bank: number;
  gamma: number;
  spd: number;
  brake: number;
  acc: number;
  /** the slot's distance [m]; the aspect [°] */
  dist: number;
  aspect: number;
  /** the run's heading error [rad] (right > 0) */
  err: number;
  /** the formation's, once joined */
  form: FormOut | null;
}

/**
 * A frame of the INTERCEPT autopilot: our craft `o` (its speed through the air V [m/s], its height h [m]), the
 * target `T` (fixed to the Earth [m], [m/s]), the phase now. The run steered by heading, its speed set by the
 * distance; joined, the formation law.
 */
export function interceptStep(
  o: FormCraft,
  V: number,
  h: number,
  T: FormCraft,
  phase: IcptPhase,
  slot: FormSlot = ICPT.slot,
  mem?: { iA: number; iU: number },
  dt = 0,
  /** a formation's rejoin (controller/formation.ts): harder turns at a turning speed, the room to turn taken only
   *  coming towards its track, slower than it when ahead of the slot */
  rejoin = false,
): IcptOut {
  const bankMax = rejoin ? ICPT.rejoinBank : ICPT.bankMax;
  const up = unit(T.p);
  const flat = (w: V3) => sub(w, scale(up, dot(w, up)));
  const vtH = flat(T.v);
  const vT = len(vtH);
  const fwdT = vT > FORM.slowV ? unit(vtH) : T.fwd ? unit(flat(T.fwd)) : unit(flat(sub(o.p, T.p)));
  const rightT = cross(fwdT, up);
  const d = sub(o.p, T.p);
  const along = dot(d, fwdT),
    lat = dot(d, rightT);
  const aspect = Math.atan2(Math.abs(lat), -along) / D;
  const S0 = [0, 1, 2].map((k) => T.p[k]! + rightT[k]! * slot.right - fwdT[k]! * slot.back + up[k]! * slot.up);
  const dist = len(sub(S0, o.p));
  const ohV = flat(o.v);
  const hca = Math.abs(wrapPi(Math.atan2(dot(ohV, rightT), dot(ohV, fwdT)))) / D;
  // (the phase: joined behind its beam, close, our tracks alike — the formation law —; else the run)
  let ph = phase;
  const turning = Math.abs(dot(T.a ?? [0, 0, 0], rightT)) > ICPT.manoeuvre;
  if ((ph === "run" || ph === "turn") && dist < ICPT.joinDist && (hca < ICPT.joinHca || turning)) ph = "join";
  else if ((ph === "join" || ph === "shadow") && (dist > ICPT.runDist || (hca > ICPT.runHca && !turning))) ph = "run";
  if (ph === "join" || ph === "shadow") {
    const F = formationStep(o, V, T, slot, mem, dt);
    if (F.dist < ICPT.shadowDist) ph = "shadow";
    else if (ph === "shadow" && F.dist > 2 * ICPT.shadowDist) ph = "join";
    return { phase: ph, bank: F.bank, gamma: F.gamma, spd: F.spd, brake: F.brake, acc: F.acc, dist, aspect, err: 0, form: F };
  }
  // (our way, flat; the turn onto its track — across it the short way, from ahead of its beam towards its track —,
  // its angle that way, its radius at our speed)
  const ofw = len(ohV) > 1 ? unit(ohV) : fwdT;
  const orr = cross(ofw, up);
  const R = (V * V) / (G * Math.tan(bankMax));
  const ang = Math.atan2(dot(fwdT, orr), dot(fwdT, ofw));
  const turnSide = hca > 90 ? Math.sign(-Math.sign(lat) * dot(rightT, orr)) || 1 : Math.sign(ang) || 1;
  const turnAng = turnSide > 0 ? (ang >= 0 ? ang : ang + 2 * Math.PI) : ang <= 0 ? -ang : 2 * Math.PI - ang;
  if (ph === "turn" && (hca < ICPT.turnEnd || turning)) ph = "run";
  if (ph === "run" && hca > 45 && !turning) {
    // (where the turn begun now would end — on its track's heading, its radius off its centre — and where it would
    // be then: behind it by the rollout's at least, the turn begun)
    const c = [0, 1, 2].map((k) => o.p[k]! + turnSide * R * orr[k]!);
    const end = [0, 1, 2].map((k) => c[k]! - turnSide * R * rightT[k]!);
    const time = (R * turnAng) / Math.max(V, 30);
    const eAlong = dot(
      sub(
        end,
        [0, 1, 2].map((k) => T.p[k]! + vtH[k]! * time),
      ),
      fwdT,
    );
    if (eAlong < -ICPT.rollout) ph = "turn";
  }
  // the run: the room to turn onto its track — the turn's radius at our speed and the run's bank, by the angle
  // between the tracks: two radii head on, one across it, none alongside — taken to its side
  const side = Math.sign(lat) || Math.sign(slot.right) || -1;
  // (only coming towards its track: flying away from it — a break —, the turn back is room enough)
  const away = rejoin && Math.sign(lat) * dot(ohV, rightT) > 0.3 * len(ohV);
  const disp = turning || away ? Math.abs(slot.right) : Math.max(R * (1 - Math.cos(hca * D)), Math.abs(slot.right));
  const Q = [0, 1, 2].map((k) => T.p[k]! + rightT[k]! * side * disp - fwdT[k]! * slot.back + up[k]! * slot.up);
  // (its collision course: the point flies with it)
  const rq = flat(sub(Q, o.p));
  const s = Math.max(len(ohV), 1);
  const t = collisionTime(rq, vtH, s);
  const aim = t !== null ? [0, 1, 2].map((k) => rq[k]! + vtH[k]! * t) : rq;
  // (the heading's error, on our own frame — past 150° the turn towards its track, not the nearest way)
  let err = Math.atan2(dot(aim, orr), dot(aim, ofw));
  if (Math.abs(err) > 150 * D) {
    // (its track's side of us: −lat along its right — on our right, a right turn)
    const toTrack = Math.sign(-Math.sign(lat) * dot(rightT, orr));
    if (toTrack !== 0) err = toTrack * Math.abs(err);
  }
  const bank = ph === "turn" ? turnSide * bankMax : clamp(ICPT.hdgGain * err, -bankMax, bankMax);
  // (its speed: head on — before its beam — a little over its, to turn tight; behind, the closing by the
  // distance, slow enough to stop on the slot)
  // (ahead of the slot on its way — a rejoin after a break, the slot behind us —: slower than it, let it come)
  const ahead = dot(sub(o.p, S0), fwdT);
  const over =
    rejoin && ahead > 0 && hca < 90
      ? -clamp(ahead / 40, 20, 80)
      : aspect > 90
        ? ICPT.overHead
        : clamp(ICPT.overMin + Math.sqrt(2 * ICPT.stopA * Math.max(dist - ICPT.joinDist / 2, 0)), ICPT.overMin, ICPT.overMax);
  // (a big turn to fly — after a break, the run's lead turn —: at most the turning speed)
  const big = rejoin && (ph === "turn" || Math.abs(err) > ICPT.turnSlowErr);
  const spd = Math.min(clamp(vT + over, ICPT.vMin, ICPT.vMax), big ? Math.max(ICPT.turnSpd, vT) : Infinity);
  const acc = clamp(JET.spdGain * (spd - V), -JET.accMax, 3 * JET.accMax);
  // (its height: the slot's)
  const hT = h + dot(sub(Q, o.p), up);
  const gamma = altHoldGamma(h, hT, V);
  return { phase: ph, bank, gamma, spd, brake: 0, acc, dist, aspect, err, form: null };
}
