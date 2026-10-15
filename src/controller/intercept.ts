// The CameraController — the INTERCEPT autopilot (game/intercept.ts, docs/PLAN-AVIATION-AAA.md C2): on the
// radar's lock, the jet's systems fly the run, the rejoin and the shadow 300 m behind it on its left. The target
// read off the radar's track while it has one; out of its cone (the turn behind it) carried on from its last
// measure, and locked again once the beam finds it. The stick, the throttle, another autopilot: off, the holds
// kept as they are.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import type { FormSlot } from "../game/formation";
import type { FormCraft } from "../game/formation";
import { type IcptOut, type IcptPhase, interceptStep } from "../game/intercept";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    icptStart: typeof icptStart;
    icptStep: typeof icptStep;
    icptOff: typeof icptOff;
  }
}

/** An intercept engaged: its track's id and name, the phase, its last measure (fixed to the Earth, the radar's
 *  time), the last frame's figures. */
export interface IcptState {
  id: string;
  name: string;
  phase: IcptPhase;
  seen: { p: number[]; v: number[]; t: number } | null;
  /** its acceleration [m/s², fixed to the Earth] eased over a second, from its velocity's changes */
  acc?: { a: number[]; v: number[]; t: number };
  armed: boolean;
  last: IcptOut | null;
  braked?: boolean;
  /** the shadow said */
  said?: boolean;
  /** its slot when not the shadow's (a tanker's pre-contact — controller/jetmodes.ts), what it is called then */
  slot?: FormSlot;
  slotName?: string;
}

/** carried on without a measure at most this long [s] — then lost */
const BLIND = 150;

/** The intercept engaged on the radar's lock (or the nearest track) — again: off. What to say. */
function icptStart(this: CameraController): string {
  if (this.icpt) return this.icptOff(), t("Intercept off — altitude, heading and speed held");
  if (!this.radarFix()) return t("The radar: in the F-35, in the air");
  const R = this.radar;
  if (!R.lock) R.lockNext();
  const T = R.lock ? R.tracks.get(R.lock) : undefined;
  if (!T) return t("Intercept: no track to intercept — lock one (Tab)");
  // (its velocity measured: TWS at least)
  if (R.mode === "RWS") R.mode = "TWS";
  if (this.form) this.formOff();
  this.icpt = { id: T.id, name: T.name, phase: "run", seen: null, armed: false, last: null };
  this.s.flightMode = "plane";
  return tf("Intercept: {0} · {1} km", T.name, (Math.hypot(...T.r) / 1000).toFixed(1));
}

/** The target now, fixed to the Earth: its radar track's, or carried on from its last; null: lost. */
function target(c: CameraController, I: IcptState): FormCraft | null {
  const fix = c.radarFix();
  if (!fix) return null;
  const R = c.radar;
  const T = R.tracks.get(I.id);
  if (T && !T.datalink) {
    const w = (v: number[]) => [0, 1, 2].map((k) => fix.E[k]! * v[0]! + fix.N[k]! * v[1]! + fix.U[k]! * v[2]!);
    const r = w(T.r),
      v = w(T.v);
    I.seen = { p: [0, 1, 2].map((k) => fix.p[k]! + r[k]!), v, t: c.radarT };
    // (found again by the beam: locked again — STT once in the shadow, measured each frame)
    if (!R.lock) R.lockOn(I.id);
    if (I.phase === "shadow" && R.lock === I.id && R.mode !== "STT") R.mode = "STT";
    return { p: I.seen.p, v };
  }
  // (out of the beam: the picture shared — a briefed target's (the AWACS's), a transponder's (its ADS-B), a friend's
  // (the datalink) — else carried on from its last measure)
  const o = c.radarObjects.find((x) => x.id === I.id);
  if (o && (o.known || o.squawk || o.offboard)) {
    const w = (v: readonly number[]) => [0, 1, 2].map((k) => fix.E[k]! * v[0]! + fix.N[k]! * v[1]! + fix.U[k]! * v[2]!);
    const r = w(o.r),
      v = w(o.v);
    I.seen = { p: [0, 1, 2].map((k) => fix.p[k]! + r[k]!), v, t: c.radarT };
    return { p: I.seen.p, v };
  }
  if (!I.seen || c.radarT - I.seen.t > BLIND) return null;
  const dt = c.radarT - I.seen.t;
  return { p: I.seen.p.map((x, k) => x + I.seen!.v[k]! * dt), v: I.seen.v };
}

/**
 * A frame of the intercept, in the jet's step (its figures `f`): the plane law's flight path and bank, the
 * autothrottle's speed — null when none is engaged or it just went off.
 */
function icptStep(
  this: CameraController,
  inp: PilotInput,
  f: { h: number; hdg: number; V: number },
): { gamma: number; bank: number; spd: number; acc: number } | null {
  const I = this.icpt;
  if (!I) return null;
  const m = this.jetModes;
  if (inp.pitch !== 0 || inp.roll !== 0) return this.icptOff(t("Intercept off — the stick")), null;
  if (inp.throttle !== 0 || (I.armed && m.spd === null)) return this.icptOff(t("Intercept off — the throttle")), null;
  const L = target(this, I);
  if (L) {
    // (its turn: the velocity's change, eased — the formation's lead on it, the run's choice)
    const A = I.acc;
    const dt = A ? this.radarT - A.t : 0;
    if (!A) I.acc = { a: [0, 0, 0], v: [...L.v], t: this.radarT };
    else if (dt > 0.2) {
      const k = Math.min(1, dt / 1);
      A.a = A.a.map((x, i) => x + ((L.v[i]! - A.v[i]!) / dt - x) * k);
      A.v = [...L.v];
      A.t = this.radarT;
    }
    L.a = I.acc!.a;
  }
  const o = this.netOwn();
  if (!L || !o) return this.icptOff(tf("Intercept off — {0} lost", I.name)), null;
  const r = interceptStep(o, f.V, f.h, L, I.phase, I.slot);
  I.phase = r.phase;
  I.last = r;
  I.armed = true;
  if (r.phase === "shadow" && !I.said) {
    I.said = true;
    this.onPilotMessage?.(I.slotName ?? tf("Shadowing {0} — 300 m behind, on its left", I.name));
  }
  // (the holds shown — and kept when it goes off)
  m.alt = Math.round(f.h);
  m.hdg = Number.isFinite(f.hdg) ? f.hdg : null;
  m.spd = r.spd;
  m.icpt = `${I.phase === "run" || I.phase === "turn" ? "ICPT" : I.phase === "join" ? "JOIN" : I.slot ? "PRE-CONTACT" : "SHDW"} ${I.name.toUpperCase()}`;
  m.formDist = r.dist;
  if (r.brake > 0 || I.braked) {
    this.airBrake = r.brake;
    I.braked = r.brake > 0;
  }
  return { gamma: r.gamma, bank: r.bank, spd: r.spd, acc: r.acc };
}

/** The intercept let go (said when `why`): the jet's holds left on the altitude, heading and speed now. */
function icptOff(this: CameraController, why?: string) {
  if (!this.icpt) return;
  if (this.icpt.braked) this.airBrake = 0;
  this.icpt = null;
  const m = this.jetModes;
  m.icpt = undefined;
  m.formDist = undefined;
  m.ab = false;
  const f = this.jetFigures();
  if (f && m.alt !== null) m.alt = Math.round(f.h / 10) * 10;
  if (f && m.spd !== null) m.spd = Math.round(f.V);
  if (why) this.onPilotMessage?.(why);
}

export function installIntercept(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { icptStart, icptStep, icptOff });
}
