// The CameraController — formation flight (game/formation.ts): the jet's systems flying a slot on another
// craft — the leader given by the network (ui/netsession.ts) as a function of the frame. Engaged, it flies the
// plane law's bank and flight path and sets the autothrottle's speed; the stick, the throttle keys or lever, an
// autopilot of the computer's, the leader lost: off, the altitude, heading and speed then held.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import type { FormCraft, FormOut, FormSlot } from "../game/formation";
import { ICPT, type IcptPhase, interceptStep } from "../game/intercept";
import { FORMATIONS, type FormationId, formationSlot, type Spacing } from "../game/formations";
import { t, tf, tr } from "../i18n";
import type { PilotInput } from "../pilot";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    formStep: typeof formStep;
    formOff: typeof formOff;
  }
}

/** A formation engaged: the leader's name and slot, his craft now (null: lost), the last frame's errors. */
export interface FormState {
  slot: number;
  name: string;
  at: FormSlot;
  lead: () => FormCraft | null;
  /** engaged at [s, performance's]: a placing's first frames out of the air forgiven */
  since: number;
  /** the autothrottle taken by the formation (its speed set: let go by another hand — off) */
  armed: boolean;
  last: FormOut | null;
  /** the air brake set by the formation (put back in at its end) */
  braked?: boolean;
  /** the formation flown (game/formations.ts — none: a slot asked as such), our place, its spacing; the close
   *  slots' widening for the two craft's spans (1: two F-35s) */
  shape?: FormationId;
  pos?: number;
  spacing?: Spacing;
  kspan?: number;
  /** the law's integrals near the slot (game/formation.ts) */
  mem?: { iA: number; iU: number };
  /** far off (beyond 3 km): the intercept's run to the slot first (game/intercept.ts), then the formation law */
  phase?: IcptPhase;
}

/** A place in a formation, its close slots widened by `kspan` (the two craft's spans over two F-35s'). */
export function formSlotFor(shape: FormationId, pos: number, spacing: Spacing, kspan = 1): FormSlot {
  const s = formationSlot(shape, pos, spacing);
  return FORMATIONS[shape].close ? { right: s.right * kspan, back: s.back * Math.max(kspan, 1), up: s.up } : s;
}

/** A formation's name in the language shown. */
export const formationLabel = (id: FormationId) => tr(FORMATIONS[id]);

/** The formation flown changed (an order, the settings): its shape, spacing or our place — the slot moved to it.
 *  What to say (null: not in one of the table's). */
export function formReshape(F: FormState | null, o: { shape?: FormationId; spacing?: Spacing; pos?: number }): string | null {
  if (!F || !F.shape) return null;
  F.shape = o.shape ?? F.shape;
  F.spacing = o.spacing ?? F.spacing ?? "normal";
  F.pos = o.pos ?? F.pos ?? 2;
  F.at = formSlotFor(F.shape, F.pos, F.spacing, F.kspan ?? 1);
  return formationLabel(F.shape);
}

const now = () => performance.now() / 1000;

/** the farthest a formation is flown from its slot [m] (beyond: Beside first) */
export const FORM_RANGE = 30_000;

/**
 * A frame of the formation, in the jet's step (its figures `f`): the plane law's flight path and bank, the
 * autothrottle's speed set — null when none is engaged or it just went off.
 */
function formStep(
  this: CameraController,
  inp: PilotInput,
  f: { h: number; hdg: number; V: number },
  dt = 0,
): { gamma: number; bank: number; spd: number; acc: number } | null {
  const F = this.form;
  if (!F) return null;
  const m = this.jetModes;
  if (inp.pitch !== 0 || inp.roll !== 0) return this.formOff(t("Formation off — the stick")), null;
  if (inp.throttle !== 0 || (F.armed && m.spd === null)) return this.formOff(t("Formation off — the throttle")), null;
  // (the formation chosen changed meanwhile — the settings, a leader's order —: our slot moved to it)
  const S = this.s;
  if (F.shape && (F.shape !== S.formShape || F.spacing !== S.formSpacing || F.pos !== S.formPos))
    formReshape(F, { shape: S.formShape, spacing: S.formSpacing, pos: S.formPos });
  const L = F.lead();
  const o = this.netOwn();
  if (!L || !o) return this.formOff(tf("Formation off — {0} lost", F.name)), null;
  // (the slot far off — a rejoin, after a break —: the intercept's run to it, its turn onto his track; within 3 km
  // and on his way, the formation law)
  const slotAt = [0, 1, 2].map((k) => L.p[k]!);
  F.phase ??= Math.hypot(...[0, 1, 2].map((k) => slotAt[k]! - o.p[k]!)) > ICPT.joinDist ? "run" : "join";
  const I = interceptStep(o, f.V, f.h, L, F.phase, F.at, (F.mem ??= { iA: 0, iU: 0 }), dt, true);
  F.phase = I.phase === "shadow" ? "join" : I.phase;
  const r: FormOut = I.form ?? {
    bank: I.bank,
    gamma: I.gamma,
    spd: I.spd,
    brake: I.brake,
    acc: I.acc,
    along: 0,
    cross: 0,
    up: 0,
    dist: I.dist,
    closing: 0,
  };
  // (placed elsewhere meanwhile, or he far beyond a rejoin)
  if (r.dist > FORM_RANGE) return this.formOff(tf("Formation off — {0} too far", F.name)), null;
  F.last = r;
  F.armed = true;
  // (the holds shown — and kept when it goes off: the height of the slot, our heading)
  m.alt = f.h + r.up;
  m.hdg = Number.isFinite(f.hdg) ? f.hdg : null;
  m.spd = r.spd;
  m.form = F.name;
  m.formDist = r.dist;
  // (the air brake: what idle cannot slow — in with the formation's end)
  if (r.brake > 0 || F.braked) {
    this.airBrake = r.brake;
    F.braked = r.brake > 0;
  }
  return { gamma: r.gamma, bank: r.bank, spd: r.spd, acc: r.acc };
}

/** The formation let go (said when `why`): the jet's holds left on the altitude, heading and speed now. */
function formOff(this: CameraController, why?: string) {
  if (!this.form) return;
  if (this.form.braked) this.airBrake = 0;
  this.form = null;
  const m = this.jetModes;
  m.form = undefined;
  m.formDist = undefined;
  // (its afterburner out with it: the holds dry)
  m.ab = false;
  const f = this.jetFigures();
  if (f && m.alt !== null) m.alt = Math.round(f.h / 10) * 10;
  if (f && m.spd !== null) m.spd = Math.round(f.V);
  if (why) this.onPilotMessage?.(why);
}

/** Whether a formation just engaged may still wait for the craft to fly (a placing's first frames) [s]. */
export const formGrace = (F: FormState | null) => !!F && now() - F.since < 3;

export function installFormation(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { formStep, formOff });
}
