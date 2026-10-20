// The CameraController — the air-to-air refuelling (game/aar.ts) behind the tanker the rendezvous joined
// (controller/jetmodes.ts: TEXACO 11, an A330 MRTT's pods under its wings): the probe out, the hose's basket flown
// into, the fuel taken, the tanker's calls on the radio, the pods' lights. Three ways to fly it:
// - auto: the jet's systems fly it all — from the observation slot to pre-contact, the contact at a walking pace, the
//   hose held in its range until the tanks are full, back out, cleared to leave;
// - assisted: they hold the probe on the basket's line (across, up — the basket's own wander, the bow wave's push
//   followed) and bring it to pre-contact; the throttle is the pilot's closing speed (forward: in, back: out — let go:
//   held where it is), the stick nudges the line;
// - manual: the pilot flies; the HUD's cues (the basket, the probe, the gap, the closing speed, the hose's range) and
//   the lights tell him.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import {
  AAR,
  type AarEvent,
  type AarLights,
  type AarSide,
  type AarState,
  aarNew,
  aarStep,
  gapOf,
  hoseDir,
  lightsOf,
  podExit,
  probeTipAt,
  trailPoint,
} from "../game/aar";
import type { Player } from "../game/combat";
import { enuToCam } from "./combat";
import { bankAccel, type FormCraft, formationBank, formationStep } from "../game/formation";
import { fleet } from "../fleet";
import { t, tf } from "../i18n";
import { mountPose, type Mount } from "../mounts";
import type { PilotInput } from "../pilot";
import type { F35Pose } from "../f35/model";
import type { ShipMeshId } from "../ship";
import type { Settings } from "../settings";
import { VESSELS } from "../vessels";
import type { CameraController } from "../controls";

type V3 = [number, number, number];
type Vec = readonly number[];
const add = (a: Vec, b: Vec): number[] => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
const sub = (a: Vec, b: Vec): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const mul = (a: Vec, k: number): number[] => [a[0]! * k, a[1]! * k, a[2]! * k];
const dot = (a: Vec, b: Vec) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: Vec, b: Vec): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const unit = (a: Vec): number[] => mul(a, 1 / (Math.hypot(a[0]!, a[1]!, a[2]!) || 1));
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);

/** the fight's flat frame lifted onto a sphere's top for the formation law (its "up": the position's way) [m] */
const LIFT = 6_371_008.8;

export type AarMode = Exclude<Settings["f35AarMode"], "level">;

/** The refuelling: its tanker (the fight's target), the stage — the rendezvous still flying, or the hose's — and the
 *  hose's state, the way it is flown, the autopilot's aim (`d`: the probe this far behind the basket [m]) and its
 *  nudges, the probe out (0…1). */
export interface AarCtl {
  tanker: number;
  name: string;
  side: AarSide;
  stage: "join" | "hose";
  mode: AarMode;
  s: AarState;
  d: number;
  nudge: [number, number];
  /** the pod in the slot's frame last frame, its rate eased (right, up [m/s]) */
  lastSlot?: { right: number; up: number };
  slotRate?: number[];
  /** the tanker in a turn (told) */
  turning?: boolean;
  /** an attempt at the basket under way (auto); how far the tip is off the basket's line now [m] */
  going?: boolean;
  offLine: number;
  /** the last metres' throttle: its integral (the tanker's pace) */
  thrI?: number;
  /** our pitch against the tanker's [rad], eased */
  pitch?: number;
  /** our last place in the fight's frame, our velocity from it */
  lastP?: number[];
  vel?: number[];
  /** the last metres' trim (across, up [m]): the bias between the tip and the basket taken away */
  trim: [number, number];
  mem: { iA: number; iU: number };
  probe: number;
  /** the fuel in the tanks when it began [kg]; the practice's (the tanks not taking it) */
  fuel0: number;
  practice: boolean;
  /** after a miss: the autopilot's next try when [s of the stage] */
  retryAt: number;
  /** the stage's time [s]; when it left (cleared to depart) */
  t: number;
  leftAt: number | null;
}

declare module "../controls" {
  interface CameraController {
    aar?: AarCtl | null;
    aarBegin: typeof aarBegin;
    aarJet: typeof aarJet;
    aarOff: typeof aarOff;
    aarModeSet: typeof aarModeSet;
    aarHud: typeof aarHud;
    aarShips: typeof aarShips;
  }
}

/** The tanker's frame (the fight's): its place, velocity, axes (right, nose, up). */
function tankerOf(c: CameraController, A: AarCtl) {
  const q = c.combat?.world.targets.find((x) => x.id === A.tanker);
  if (!q || !q.alive) return null;
  const f = unit(q.fwd);
  const u = unit(q.up);
  const r = unit(cross(f, u));
  return { q, p: q.p, v: q.v, r, f, u };
}

/** A point of the tanker's frame (right, fwd, up) in the fight's. */
const tToW = (T: NonNullable<ReturnType<typeof tankerOf>>, x: Vec) => add(T.p, add(add(mul(T.r, x[0]!), mul(T.f, x[1]!)), mul(T.u, x[2]!)));
/** A point of the fight's in the tanker's frame. */
const wToT = (T: NonNullable<ReturnType<typeof tankerOf>>, w: Vec) => {
  const d = sub(w, T.p);
  return [dot(d, T.r), dot(d, T.f), dot(d, T.u)];
};
/** Our probe's tip in the fight's frame: our place, our axes (right, nose, up), the tip on our mesh (x its left). */
function tipOf(P: Player, ext: number): number[] {
  const f = unit(P.fwd),
    u = unit(P.up);
  const r = cross(f, u);
  const m = probeTipAt(ext);
  return add(P.p, add(add(mul(r, -m[0]!), mul(f, m[2]!)), mul(u, m[1]!)));
}

/** The way it is flown by default: the setting's, else the assistance level's (the beginner's: auto). */
function modeFor(c: CameraController): AarMode {
  const m = c.s.f35AarMode;
  if (m && m !== "level") return m;
  return c.assistLevel() === "beginner" ? "auto" : "assisted";
}

/** The refuelling begun on a tanker the rendezvous goes to (its fight's id, its name, the hose's side). */
function aarBegin(this: CameraController, tanker: number, name: string, side: AarSide = "right") {
  const full = VESSELS.f35.fuelKg ?? 6125;
  const now = fleet.fuel.f35 ?? full;
  const room = full - now;
  const practice = !!this.s.f35InfiniteFuel || room < 200;
  this.aar = {
    tanker,
    name,
    side,
    stage: "join",
    mode: modeFor(this),
    s: aarNew(side, practice ? AAR.practice : room),
    d: 45,
    nudge: [0, 0],
    trim: [0, 0],
    mem: { iA: 0, iU: 0 },
    probe: 0,
    fuel0: now,
    practice,
    retryAt: 0,
    offLine: 0,
    t: 0,
    leftAt: null,
  };
}

/** The refuelling let go (said when `why`): the probe in, the holds left as they are. */
function aarOff(this: CameraController, why?: string) {
  const A = this.aar;
  if (!A) return;
  this.aar = null;
  // (its racetrack taken up again)
  const q = this.combat?.world.targets.find((x) => x.id === A.tanker);
  if (q?.ai) q.ai.straight = false;
  const m = this.jetModes;
  m.icpt = undefined;
  m.formDist = undefined;
  if (this.airBrake > 0) this.airBrake = 0;
  const f = this.jetFigures();
  if (f && m.alt !== null) m.alt = Math.round(f.h / 10) * 10;
  if (f && m.spd !== null) m.spd = Math.round(f.V);
  if (why) this.onPilotMessage?.(why);
}

/** The way it is flown set (auto, assisted, manual; none: the next). What to say. */
function aarModeSet(this: CameraController, mode?: AarMode): string {
  const A = this.aar;
  const order: AarMode[] = ["auto", "assisted", "manual"];
  const cur = A?.mode ?? modeFor(this);
  const next = mode ?? order[(order.indexOf(cur) + 1) % order.length]!;
  this.s.f35AarMode = next;
  if (A) {
    A.mode = next;
    A.nudge = [0, 0];
  }
  return tf("Refuelling: {0}", modeName(next));
}

const modeName = (m: AarMode) => (m === "auto" ? t("automatic") : m === "assisted" ? t("assisted") : t("manual"));

/** The tanker's line on the radio (its role's voice); the pilot's own messages for the rest. */
function call(c: CameraController, A: AarCtl, text: string) {
  c.onRadio?.(`${A.name}: ${text}`, "tanker");
}

function said(c: CameraController, A: AarCtl, e: AarEvent) {
  const hose = A.side === "left" ? t("left hose") : t("right hose");
  switch (e) {
    case "cleared":
      return call(c, A, tf("cleared contact, {0}", hose));
    case "contact":
      return call(c, A, t("contact"));
    case "flow":
      return call(c, A, t("fuel flowing"));
    case "toofast":
      return call(c, A, t("too fast — back to pre-contact"));
    case "rim":
      return call(c, A, t("missed the basket — back to pre-contact"));
    case "missed":
      return call(c, A, t("missed — back to pre-contact"));
    case "disconnect":
      return call(c, A, t("disconnect"));
    case "pulledout":
      return call(c, A, t("disconnect — off the hose's line"));
    case "full":
      return call(
        c,
        A,
        A.practice
          ? tf("transfer complete — {0} kg, a practice offload", Math.round(A.s.given))
          : tf("transfer complete — {0} kg", Math.round(A.s.given)),
      );
    case "breakaway":
      return call(c, A, t("breakaway, breakaway, breakaway!"));
    case "recleared":
      return call(c, A, t("back in pre-contact — cleared to try again"));
    case "depart":
      return call(c, A, t("cleared to depart — good day"));
  }
}

/**
 * A frame of the refuelling (the jet's step, before the intercept): the hose's state stepped from where our probe is;
 * auto and assisted, the flight path, bank and speed that put the probe where it should be — null when the pilot flies
 * (manual), the rendezvous still flies (join), or none is engaged.
 */
function aarJet(
  this: CameraController,
  inp: PilotInput,
  f: { h: number; hdg: number; V: number },
  dt: number,
): { gamma: number; bank: number; spd: number; acc: number; thr?: number } | null {
  const A = this.aar;
  if (!A || !(dt >= 0)) return null;
  const T = tankerOf(this, A);
  if (!T) return this.aarOff(tf("Refuelling off — {0} lost", A.name)), null;
  if (fleet.active !== "f35") return this.aarOff(), null;
  const P = this.combatPlayer();
  if (!P) return null;
  A.t += dt;
  // (our velocity in the fight's frame from our places there — the one the frame is given, the air's through the
  // geodetic projection, is off by a few tenths of a percent: a metre a second at 200 m/s, the hose's whole range in a
  // few seconds)
  if (A.lastP && dt > 0) {
    const raw = mul(sub(P.p, A.lastP), 1 / dt);
    A.vel = A.vel ? add(A.vel, mul(sub(raw, A.vel), Math.min(1, dt / 0.3))) : raw;
  }
  A.lastP = [...P.p];
  const vP = A.vel ?? P.v;
  // (the probe out — in again once cleared to depart)
  A.probe = clamp(A.probe + ((A.leftAt === null ? 1 : -1) * dt) / AAR.probeTime, 0, 1);
  const tip = wToT(T, tipOf(P, A.probe));
  const m = this.jetModes;
  if (A.stage === "join") {
    // (the rendezvous: the intercept's, or the pilot's; the hose's stage once behind it, near the observation slot)
    const g = gapOf(tip, trailPoint(A.side));
    if (g.along > 0 && g.along < 70 && g.off < 25) {
      A.stage = "hose";
      A.t = 0;
      A.d = Math.max(g.along, AAR.astern);
      A.mem = { iA: 0, iU: 0 };
      if (this.icpt) this.icptOff();
      this.onPilotMessage?.(
        tf("Refuelling: behind {0}'s {1} — {2}", A.name, A.side === "left" ? t("left hose") : t("right hose"), modeName(A.mode)),
      );
    } else return null;
  }
  const S = A.s;
  const was = S.given;
  for (const e of aarStep(S, tip, this.combat!.t, dt)) {
    said(this, A, e);
    if (e === "toofast" || e === "rim" || e === "missed") A.retryAt = A.t + 4;
    if (e === "breakaway") A.retryAt = A.t + AAR.backTime + 2;
    if (e === "depart") A.leftAt = A.t;
  }
  A.offLine = gapOf(tip, S.basket).off;
  // (the tanker flies straight and level while it refuels us — behind its hose until cleared to depart —: its
  // racetrack's turn put off, rolled out of if it was in one)
  if (T.q.ai) T.q.ai.straight = A.stage === "hose" && A.leftAt === null;
  // (its turns told as it rolls into them — and out)
  const tb = formationBank([0, 0, 1], T.u, T.r);
  if (Math.abs(tb) > 2 * (Math.PI / 180) && !A.turning) {
    A.turning = true;
    call(this, A, tb < 0 ? t("turning left") : t("turning right"));
  } else if (Math.abs(tb) < 1 * (Math.PI / 180) && A.turning) {
    A.turning = false;
    call(this, A, t("rolling out"));
  }
  // (the fuel given into the tanks — a practice's into none)
  if (S.given > was && !A.practice) {
    const full = VESSELS.f35.fuelKg ?? 6125;
    fleet.fuel.f35 = Math.min(full, (fleet.fuel.f35 ?? full) + (S.given - was));
  }
  // (cleared to depart, the probe in: the refuelling over — the holds left on, a little below and behind it)
  if (A.leftAt !== null && A.t - A.leftAt > AAR.probeTime + 4) {
    const msg = A.practice
      ? tf("Refuelling done — {0} kg (practice)", Math.round(S.given))
      : tf("Refuelling done — {0} kg taken, {1} kg aboard", Math.round(S.given), Math.round(fleet.fuel.f35 ?? 0));
    this.aarOff(msg);
    return null;
  }
  // the HUD's annunciator
  m.icpt = `AAR ${annunciator(S, A)}`;
  m.formDist = Math.max(0, gapOf(tip, S.basket).along);
  if (A.mode === "manual") {
    if (this.airBrake > 0 && A.stage === "hose" && S.phase !== "breakaway") this.airBrake = 0;
    return null;
  }
  // the autopilot's aim: the probe `d` behind the basket on its line (locked: behind its trail point — takeup −d)
  const want = aimDistance(A);
  if (A.mode === "auto") {
    // (the pilot's hands: the throttle makes it assisted — his closing speed —, the stick hard over manual)
    if (Math.abs(inp.pitch) > 0.5 || Math.abs(inp.roll) > 0.5) {
      A.mode = "manual";
      this.onPilotMessage?.(t("Refuelling: manual — the stick"));
      return null;
    }
    if (inp.throttle !== 0) {
      A.mode = "assisted";
      this.onPilotMessage?.(t("Refuelling: assisted — the throttle is yours"));
    } else {
      const rate = Math.abs(A.d) < 8 ? 0.9 : 3;
      A.d += clamp(want - A.d, -rate * dt, rate * dt);
    }
  }
  // (free, the aim never more than 3 m ahead of the tip: arriving from afar, its lag not turned into an overshoot
  // through the basket)
  if (S.phase !== "contact") A.d = Math.max(A.d, gapOf(tip, S.basket).along - 3);
  if (A.mode === "assisted") {
    // (the throttle: the closing speed — forward in, back out; the pre-contact reached by the systems from afar)
    if (A.d > AAR.astern + 1 && inp.throttle <= 0) A.d = Math.max(AAR.astern, A.d - 3 * dt);
    // (its aim a metre and a half at most ahead of or behind where the tip is: held, the throttle closes at a pace)
    const now = S.phase === "contact" ? -S.takeup : gapOf(tip, S.basket).along;
    A.d = clamp(A.d - inp.throttle * 1.2 * dt, Math.max(-(AAR.whip + 1), now - 1.5), Math.min(60, now + 1.5));
    // (after a breakaway: back out whatever is asked)
    if (S.phase === "breakaway") A.d = Math.max(A.d, AAR.backOff + 3);
    // (the stick: the line nudged — let go, back on it)
    A.nudge[0] = clamp(A.nudge[0] + inp.roll * 0.8 * dt, -2, 2) * (inp.roll === 0 ? 1 - Math.min(0.4 * dt, 1) : 1);
    A.nudge[1] = clamp(A.nudge[1] + inp.pitch * 0.6 * dt, -2, 2) * (inp.pitch === 0 ? 1 - Math.min(0.4 * dt, 1) : 1);
  }
  inp.pitch = inp.roll = inp.yaw = inp.throttle = 0;
  // the probe's aim (the tanker's frame), our place for it, the slot that is in the formation law's frame
  const axis = mul(hoseDir(), -1);
  const ref = S.phase === "contact" ? S.ref : S.basket;
  const aim = add(add(ref, mul(axis, -A.d)), [A.nudge[0], 0, A.nudge[1]]);
  // (our tip's offset on our nose's pitch against the tanker's — our incidence raises the tip by tenths of a metre —,
  // eased over some 8 s: a pull to climb raises the tip before the craft, an aim moved by it would push back down;
  // and on the tanker's up: not our own bank nor yaw, which the turbulence swings — the aim would swing with them)
  const pf = unit(P.fwd);
  const th = Math.atan2(dot(pf, T.u), Math.max(dot(pf, T.f), 0.3));
  A.pitch = A.pitch === undefined ? th : A.pitch + (th - A.pitch) * Math.min(1, dt / 8);
  const tm = probeTipAt(A.probe);
  const nf = unit(add(mul(T.f, Math.cos(A.pitch)), mul(T.u, Math.sin(A.pitch))));
  const nu = unit(sub(T.u, mul(nf, dot(T.u, nf))));
  const nr = cross(nf, nu);
  const ours = add(add(mul(nr, -tm[0]!), mul(nf, tm[2]!)), mul(nu, tm[1]!));
  // (the last metres: what is left between the tip and its aim off the hose's line — across, up — trimmed away
  // slowly; free only — locked, the hose holds it —, near its aim along the line)
  const K = AAR_LAW;
  const miss = sub(aim, tip);
  const onLine = dot(miss, axis);
  const off = sub(miss, mul(axis, onLine));
  if (Math.abs(A.d) < 12 && S.phase === "astern" && Math.abs(onLine) < 3) {
    A.trim[0] = clamp(A.trim[0] + K.kT * off[0]! * dt, -1.5, 1.5);
    A.trim[1] = clamp(A.trim[1] + K.kT * off[2]! * dt, -1.5, 1.5);
  }
  const O = sub(tToW(T, add(aim, [A.trim[0], 0, A.trim[1]])), ours);
  // (centred on the tanker: its up the sphere's exactly — off-centre, the lift would tilt it by e / R, a bias of tenths
  // of a metre a second in the vertical speed asked)
  const lift = (p: Vec) => [p[0]! - T.p[0]!, p[1]! - T.p[1]!, p[2]! + LIFT];
  const L: FormCraft = { p: lift(T.p), v: T.v, fwd: T.f };
  L.aLat = bankAccel(formationBank(L.p, T.u, T.r));
  const o: FormCraft = { p: lift(P.p), v: vP };
  const vh = [T.v[0]!, T.v[1]!, 0];
  const fw = unit(Math.hypot(vh[0]!, vh[1]!) > 20 ? vh : [T.f[0]!, T.f[1]!, 0]);
  const rt = cross(fw, [0, 0, 1]);
  const rel = sub(O, T.p);
  const slot = { right: dot(rel, rt), back: -dot(rel, fw), up: rel[2]! };
  // (the pod's own motion in the slot's frame — rising and falling as the tanker rolls into its turns, 0.6 m/s 11 m
  // out —, eased, led by what the loops would lag it by: its rate over their gains)
  const pe = sub(tToW(T, podExit(A.side)), T.p);
  const pod = { right: dot(pe, rt), up: pe[2]! };
  if (A.lastSlot && dt > 0) {
    const r = [(pod.right - A.lastSlot.right) / dt, (pod.up - A.lastSlot.up) / dt];
    A.slotRate = A.slotRate ? A.slotRate.map((x, k) => x + (r[k]! - x) * Math.min(1, dt / 0.5)) : r;
  }
  A.lastSlot = pod;
  const lead = A.slotRate ?? [0, 0];
  // close in — the last tens of metres —: the formation's law across and up with its own gains, without its
  // integrators (wound up over metres, they swing the height by metres for tens of seconds — the tip's trim above takes
  // away what is left; the height's loop slow enough for the plane law's flight path, its phase margin some 60°); the
  // closing on the throttle itself, on the speed over the ground — a PI on the closing speed asked, its integral the
  // tanker's pace: the autothrottle, on the air's speed, would chase every gust —, a walking pace the last metres, no
  // air brake (out, it pitches the craft and drops it by metres)
  const close = Math.abs(A.d) < 15;
  const led = close
    ? { ...slot, right: slot.right + clamp(lead[0]!, -2, 2) * (1.8 / K.wC), up: slot.up + clamp(lead[1]!, -2, 2) / K.wU }
    : slot;
  const F = formationStep(o, f.V, L, led, close ? undefined : A.mem, dt, close ? { wC: K.wC, vC: 3, wU: K.wU, vU: K.vU } : { vA: 12 });
  let { spd, brake, acc } = F;
  let thr: number | undefined;
  if (close) {
    const vRel = dot(sub(vP, T.v), fw);
    const vMax = Math.abs(A.d) < 8 ? K.vNear : K.vA;
    const ev = clamp(K.kA * F.along, -vMax, vMax) - vRel;
    A.thrI = clamp((A.thrI ?? this.pilot.throttle) + K.kTi * ev * dt, 0.05, 0.98);
    thr = clamp(A.thrI + K.kTp * ev, 0, 1);
    acc = 0;
    spd = f.V;
    brake = 0;
  } else A.thrI = undefined;
  this.airBrake = brake;
  m.alt = Math.round(f.h);
  m.hdg = Number.isFinite(f.hdg) ? f.hdg : null;
  m.spd = spd;
  return { gamma: F.gamma, bank: F.bank, spd, acc, thr };
}

/** The last metres' laws (aarJet): across, the formation's natural frequency [rad/s]; up, its closing rate [1/s] and
 *  at most [m/s]; along, the closing speed asked per metre off [1/s] and at most — the last metres' [m/s] —, the
 *  throttle per m/s of its error and its integral's [1/s]; the tip's trim's rate [1/s]. */
export const AAR_LAW = { wC: 0.55, wU: 0.4, vU: 2, kA: 0.25, vA: 2.5, vNear: 1.2, kTp: 0.25, kTi: 0.035, kT: 0.15 };

/** Where the autopilot wants the probe (auto): pre-contact, then through the basket, then the hose held in its range;
 *  backed out once full, after a miss, a breakaway. */
function aimDistance(A: AarCtl): number {
  const S = A.s;
  if (S.phase === "breakaway") return AAR.backOff + 4;
  if (S.phase === "done" || A.leftAt !== null) return AAR.astern + 25;
  if (S.full) return AAR.astern + 1;
  if (S.phase === "contact") return -2.7;
  if (!S.cleared || A.t < A.retryAt) return (A.going = false), AAR.astern;
  // (an attempt begun once held steady at pre-contact a moment; given up — back to pre-contact — once the tip strays
  // off the basket's line by more than a metre on the way)
  // (not into a turn: a contact begun on a straight leg — the tanker's roll moves the basket by metres)
  if (!A.going && S.steady > 1.5 && !A.turning) A.going = true;
  if (A.going && A.offLine > 1.2) {
    A.going = false;
    A.retryAt = A.t + 3;
  }
  return A.going ? -1.5 : AAR.astern;
}

/** The HUD's word for where it is. */
function annunciator(S: AarState, A: AarCtl): string {
  if (S.phase === "breakaway") return "BREAKAWAY";
  if (S.phase === "done" || A.leftAt !== null) return "DEPART";
  if (S.phase === "contact") return S.flowing ? "FUEL FLOW" : S.full ? "FULL" : "CONTACT";
  return S.cleared ? "CLEARED" : "PRE-CONTACT";
}

/** What the HUD draws of the refuelling: the basket and the probe's tip (the camera's axes, from the eye), the gap, the
 *  closing speed, the hose's range, the lights, the fuel. */
function aarHud(this: CameraController, Cm: (v: V3 | null) => V3 | null) {
  const A = this.aar;
  const P = this.combat?.last;
  if (!A || A.stage !== "hose" || !P) return null;
  const T = tankerOf(this, A);
  if (!T) return null;
  const S = A.s;
  // (the eye on our craft: the mount's — the HUD's directions from it, not from the craft's origin metres away)
  const f = unit(P.fwd),
    u = unit(P.up);
  const r = cross(f, u);
  const e = mountPose((this.s.shipMount as Mount) ?? "cockpit").eye;
  const eye = add(P.p, add(add(mul(r, -e[0]), mul(f, e[2])), mul(u, e[1])));
  const M = enuToCam(this, Cm);
  if (!M) return null;
  const toCam = (w: Vec): V3 => M(sub(w, eye) as V3);
  const tipW = tipOf(P, A.probe);
  const basketW = tToW(T, S.basket);
  // (the gap in our own frame: the basket to the right, above, ahead of the probe's tip)
  const g = sub(basketW, tipW);
  return {
    phase: annunciator(S, A),
    mode: A.mode,
    lights: lightsOf(S) as AarLights,
    basket: toCam(basketW),
    tip: toCam(tipW),
    rim: AAR.basket.r,
    gap: [dot(g, r), dot(g, u), dot(g, f)] as V3,
    closure: S.closure,
    takeup: S.phase === "contact" ? S.takeup : null,
    flow: AAR.flow,
    whip: AAR.whip,
    given: S.given,
    want: S.want,
    practice: A.practice,
  };
}

/** The tanker's hoses and lights, our probe, for the renderer (controller/combat.ts combatShips): each from the flown
 *  craft's origin on the camera's axes (M), its axes. */
function aarShips(
  this: CameraController,
  P: Player,
  M: (v: V3) => V3,
): { id: ShipMeshId; rel: V3; axes: [V3, V3, V3]; jet: F35Pose; hidden: boolean }[] {
  const A = this.aar;
  const out: { id: ShipMeshId; rel: V3; axes: [V3, V3, V3]; jet: F35Pose; hidden: boolean }[] = [];
  if (!A) return out;
  const T = tankerOf(this, A);
  if (!T) return out;
  const pose = { gear: 0, canopy: 0 } as F35Pose;
  const ax = (left: Vec, up: Vec, fwd: Vec): [V3, V3, V3] => [M(left as V3), M(up as V3), M(fwd as V3)];
  const left = mul(T.r, -1);
  for (const side of ["left", "right"] as AarSide[]) {
    // (the hose: from the pod's tail to the basket — ours where it is, the other hanging —, the reel taking it in)
    const exit = tToW(T, podExit(side));
    const b = tToW(T, side === A.side ? A.s.basket : trailPoint(side));
    const z = unit(sub(exit, b));
    const y = unit(sub(T.u, mul(z, dot(T.u, z))));
    const x = cross(y, z);
    const root = add(b, mul(z, AAR.hose + AAR.throat));
    out.push({ id: "drogue", rel: M(sub(root, P.p) as V3), axes: ax(x, y, z), jet: pose, hidden: false });
    // (its pod's light: ours as its state, the other's amber — trailed, ready)
    const L = side === A.side ? lightsOf(A.s) : "amber";
    if (L !== "off")
      out.push({ id: `lamp-${L}` as ShipMeshId, rel: M(sub(exit, P.p) as V3), axes: ax(left, T.u, T.f), jet: pose, hidden: false });
  }
  // our probe: out of its door, sliding back in along its own line
  if (A.probe > 0.02) {
    const f = unit(P.fwd),
      u = unit(P.up);
    const r = cross(f, u);
    const { base, tip } = AAR.probe;
    const sh = mul(sub(base, tip), 1.1 * (1 - A.probe));
    const off = add(add(mul(r, -sh[0]!), mul(f, sh[2]!)), mul(u, sh[1]!));
    out.push({ id: "probe", rel: M(off as V3), axes: ax(mul(r, -1), u, f), jet: pose, hidden: false });
  }
  return out;
}

export function installAar(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { aarBegin, aarJet, aarOff, aarModeSet, aarHud, aarShips });
}
