// The CameraController — the F-35B's recovery on a carrier's deck (game/deckland.ts): engaged, its guidance flies the
// jet's holds to the gate astern and up the port side, converts to STOVL and slows; the hover law then flies its
// velocity — alongside, across over the spot, down —; the LSO ("Paddles") calls it by radio and grades the
// touchdown. The stick or the throttle keys take it back.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { CARRIER, type CarrierId, type DeckMap, toDeck } from "../game/carrier";
import {
  bowEnd,
  type DeckOut,
  type DeckPhase,
  type DeckRun,
  deckStep,
  deckVelocity,
  enuOf,
  newDeckRun,
  STO,
  type StoRun,
  VL_SPOT,
} from "../game/deckland";
import { fleet } from "../fleet";
import { f35Variant } from "../f35/variant";
import { STOVL } from "../f35/stovl";
import { C_MPS } from "../units";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import { deckOf } from "./carriers";
import { earthView } from "./netcraft";
import type { Vec3 } from "../math/vec3";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    deckRun?: DeckRun | null;
    deckLand: typeof deckLand;
    deckOff: typeof deckOff;
    deckJet: typeof deckJet;
    deckHover: typeof deckHover;
    deckGuide: typeof deckGuide;
  }
}

const G0_MS2 = 9.80665;

/** The craft's mass and the most the hover holds [kg] (the lift fan and the nozzle: 184 kN, a 5 % margin). */
function hoverMost(c: CameraController): { mass: number; most: number } {
  const mass = fleet.massProps().mass;
  const thrust = c.thrustMax() * ((C_MPS * C_MPS) / (1476.625 * c.s.massSolar)) * mass * STOVL.boost;
  return { mass, most: (0.95 * thrust) / G0_MS2 };
}

/** The run's guidance this frame, worked out once (the jet's holds and the hover law both ask). */
const memo = new WeakMap<DeckRun, { at: number; out: DeckOut | null }>();

/**
 * The recovery engaged on a carrier (`kind`, else the nearest within 30 km): the F-35B only, its deck's map in.
 * What to say; null: none near (the runway's landing then).
 */
function deckLand(this: CameraController, kind?: CarrierId): string | null {
  if (fleet.active !== "f35") return t("Deck landing: the F-35B's");
  // (the F-35C: on the wires — controller/trap.ts)
  if (f35Variant() === "C") return this.trapLand(kind);
  const o = this.netOwn();
  const near = this.carrierNow()
    .filter((c) => !kind || c.sp.kind === kind)
    .map((c) => ({ c, d: o ? Math.hypot(...[0, 1, 2].map((k) => c.P.p[k]! - o.p[k]!)) : 0 }))
    .sort((a, b) => a.d - b.d)[0];
  if (!near || (!kind && near.d > 30_000)) return kind ? t("Deck landing: that carrier is not at sea") : null;
  const k = near.c.sp.kind;
  if (!deckOf(k)) return t("Deck landing: the deck's map still loading");
  // (heavier than the lift fan and the nozzle can hold in a hover: 184 kN — the real F-35B comes back with some
  // 2 t of fuel)
  const { mass, most } = hoverMost(this);
  if (mass > most)
    return tf(
      "Deck landing: too heavy to hover — {0} t, {1} t at most: {2} kg of fuel to burn",
      (mass / 1000).toFixed(1),
      (most / 1000).toFixed(1),
      Math.ceil(mass - most),
    );
  if (this.form) this.formOff();
  if (this.icpt) this.icptOff();
  if (this.pilot.auto !== "none") this.pilot.setAuto(this.pilot.auto);
  this.pilot.auto = "none";
  this.deckRun = newDeckRun(k);
  this.onRadio?.(tf("{0}, Mother: Charlie. Recover up the port side to the spot aft of the island.", "F-35B"));
  return tf("Deck landing on {0}", CARRIER[k].name);
}

/** The recovery let go (said when `why`): the holds left on what they fly. */
function deckOff(this: CameraController, why?: string) {
  if (!this.deckRun) return;
  this.deckRun = null;
  if (this.stovl.cmd) this.stovl.cmd.want = undefined;
  if (why) this.onPilotMessage?.(why);
}

/** What the LSO says as the run moves on. */
const CALLS: Partial<Record<DeckPhase, () => string>> = {
  decel: () => t("Paddles: contact. Slow up the port side."),
  alongside: () => t("Paddles: hovering alongside — steady."),
  cross: () => t("Paddles: stable. Cleared across."),
  descend: () => t("Paddles: over the spot. Cleared to land."),
};

/** The guidance's frame (null: none flying — the run ended, or its carrier gone). */
function deckGuide(this: CameraController): DeckOut | null {
  const R = this.deckRun;
  if (!R) return null;
  const now = this.nowTime();
  const m = memo.get(R);
  if (m && m.at === now) return m.out;
  const c = this.carrierNow().find((x) => x.sp.kind === R.kind);
  const D = deckOf(R.kind);
  const o = this.netOwn();
  if (!c || !D || !o) {
    this.deckOff(t("Deck landing off — the carrier lost"));
    return null;
  }
  const dt = m ? Math.min(Math.max((now - m.at) * 4.925490947e-6 * this.s.massSolar, 0), 0.25) : 0;
  const before = R.phase;
  const down = !!this.ourLanded || !!this.rolling;
  const out = deckStep(R, { p: o.p, v: o.v, V: this.airFlight.last?.speed ?? 0, hover: this.stovl.hover, down }, c.sp, c.P, D, dt);
  memo.set(R, { at: now, out });
  if (R.phase !== before) {
    const say = CALLS[R.phase];
    if (say) this.onRadio?.(say());
    if (R.phase === "decel") this.gearDown = true;
  }
  if (R.phase === "down" && R.touch) {
    const tc = R.touch;
    this.onRadio?.(
      tf(
        "Paddles: touchdown — {0}, {1} m off the spot, {2} m/s.",
        tc.grade === "OK" ? t("OK") : tc.grade === "Fair" ? t("Fair") : t("No grade"),
        Math.hypot(tc.dx, tc.dz).toFixed(1),
        tc.sink.toFixed(1),
      ),
    );
    this.deckLast = { ...tc, kind: R.kind };
    // (down: the engine to idle and the lift fan's mode off — the hover law held the craft still over the Earth, not
    // over the deck steaming on: it slid aft, its brakes off —, the wheels braked, the deck carrying it)
    this.stovl.on = false;
    this.pilot.throttle = 0;
    this.deckOff();
    return null;
  }
  return out;
}

/** A frame of the jet's systems with the recovery on: its holds set (the conventional legs); the stick or the
 *  throttle keys let it go. */
function deckJet(this: CameraController, inp: PilotInput) {
  if (!this.deckRun) return;
  if (inp.pitch !== 0 || inp.roll !== 0 || inp.throttle !== 0) return this.deckOff(t("Deck landing off — the stick"));
  const out = this.deckGuide();
  if (out?.kind !== "plane") return;
  const m = this.jetModes;
  if (m.spd === null) this.jetAthr.reset();
  m.alt = out.alt;
  m.hdg = out.hdg;
  m.spd = out.spd;
  m.ab = false;
  if (out.stovl && !this.stovl.on) {
    this.stovl.on = true;
    this.onPilotMessage?.(t("STOVL mode: converting — the lift fan engaging"));
  }
}

/** The hover law's velocity over the ground asked (its local frame — the home's axes —, m/s) and heading [rad], with
 *  the recovery on; null: the pilot's. */
function deckHover(this: CameraController, inp: PilotInput): { want: Vec3; heading: number } | null {
  const V = this.stoRun;
  if (V?.vto && (V.phase === "lift" || V.phase === "accel")) {
    if (inp.pitch !== 0 || inp.roll !== 0 || inp.throttle !== 0) {
      this.stoRun = null;
      this.onPilotMessage?.(t("Take-off off — the stick"));
      return null;
    }
    // (a vertical take-off: up off the deck moving with it, then forward along its heading, climbing a little)
    const c = this.carrierNow().find((x) => x.sp.kind === V.kind);
    const o = this.netOwn();
    const E = earthView(this);
    if (!c || !o || !E) return null;
    const { U, N, E: east } = enuOf(o.p);
    const vd = deckVelocity(c.P, o.p);
    const hd = [0, 1, 2].map((k) => N[k]! * Math.cos(c.sp.heading) + east[k]! * Math.sin(c.sp.heading));
    const fwd = V.phase === "accel" ? Math.min((V.t - (V.t0 ?? V.t)) * STO.accel, 75) : 0;
    const up = V.phase === "lift" ? STO.liftRate : 1;
    const want = [0, 1, 2].map((k) => vd[k]! + hd[k]! * fwd + U[k]! * up) as Vec3;
    return { want: E.toHome(want), heading: c.sp.heading };
  }
  if (!this.deckRun) return null;
  if (inp.pitch !== 0 || inp.roll !== 0 || inp.throttle !== 0) {
    this.deckOff(t("Deck landing off — the stick"));
    return null;
  }
  const out = this.deckGuide();
  if (out?.kind !== "hover") return null;
  const E = earthView(this);
  if (!E) return null;
  return { want: E.toHome(out.want), heading: out.heading };
}

export function installDeckland(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { deckLand, deckOff, deckJet, deckHover, deckGuide, deckTakeoff, stoStep });
}

/** The last touchdown on a deck (its grade): the controller's. */
declare module "../controls" {
  interface CameraController {
    deckLast?: { dx: number; dz: number; sink: number; grade: string; kind: CarrierId } | null;
  }
}
export { VL_SPOT };

declare module "../controls" {
  interface CameraController {
    stoRun?: StoRun | null;
    deckTakeoff: typeof deckTakeoff;
    stoStep: typeof stoStep;
  }
}

/** The craft's place on the carrier it stands on (within 400 m of one), its frame [m]. */
function onCarrier(c: CameraController): { kind: CarrierId; l: [number, number, number]; D: DeckMap } | null {
  const o = c.netOwn();
  if (!o) return null;
  for (const { sp, P } of c.carrierNow()) {
    const l = toDeck(P, o.p);
    const D = deckOf(sp.kind);
    if (D && Math.hypot(l[0], l[2]) < 400 && Math.abs(l[1] - CARRIER[sp.kind].deck) < 4) return { kind: sp.kind, l, D };
  }
  return null;
}

/** The F-35B's take-off from the deck it stands on (game/deckland.ts STO): short when the deck's run allows its
 *  weight, else vertical when light enough to hover (or as asked); what to say; null: not on a deck. */
function deckTakeoff(this: CameraController, mode?: "short" | "vertical"): string | null {
  if (fleet.active !== "f35") return null;
  // (the F-35C: by catapult — controller/trap.ts)
  if (f35Variant() === "C") return this.catLaunch();
  const on = onCarrier(this);
  if (!on || !(this.ourLanded || this.rolling)) return null;
  const bow = bowEnd(on.D, on.l[0], on.l[2]);
  const run = Math.max(0, bow - on.l[2] || 0);
  // (the deck's run its weight needs — else straight up, light enough to hover —, else not)
  const { mass, most } = hoverMost(this);
  const need = STO.run(mass) + 10;
  const vto = mode === "vertical" || (mode !== "short" && run < need);
  if (vto && mass > most)
    return tf(
      "Take-off: {0} m of deck clear, {1} m needed at {2} t — and too heavy to rise vertically ({3} t at most)",
      Math.round(run),
      Math.round(need),
      (mass / 1000).toFixed(1),
      (most / 1000).toFixed(1),
    );
  this.deckOff();
  this.stoRun = { kind: on.kind, phase: "convert", t: 0, bow, vto };
  this.onRadio?.(
    vto
      ? tf("{0}, Mother: cleared for a vertical take-off. Converting.", "F-35B")
      : tf("{0}, Mother: cleared for a short take-off, {1} m of deck. Converting.", "F-35B", Math.round(run)),
  );
  return vto ? tf("Vertical take-off from {0}", CARRIER[on.kind].name) : tf("Short take-off from {0}", CARRIER[on.kind].name);
}

/** A frame of the short take-off, its stick and throttle set on `inp` and the pilot's; the stick before the
 *  rotation, the brakes (the throttle closed) take it back. */
function stoStep(this: CameraController, inp: PilotInput, dt: number) {
  const R = this.stoRun;
  if (!R) return;
  const S = this.stovl;
  const end = (why: string) => {
    this.stoRun = null;
    S.hold = null;
    this.onPilotMessage?.(why);
  };
  if ((R.phase === "convert" || R.phase === "roll") && (inp.pitch !== 0 || inp.roll !== 0 || inp.throttle < 0)) {
    this.pilot.throttle = 0;
    return end(t("Short take-off off — the stick"));
  }
  R.t += dt;
  const V = this.airFlight.last?.speed ?? 0;
  const down = !!(this.ourLanded || this.rolling);
  const on = onCarrier(this);
  if (R.phase === "convert") {
    S.on = true;
    S.hold = R.vto ? null : 0;
    this.jetModes = { ...this.jetModes, ab: false };
    this.pilot.throttle = 0;
    if (S.conv >= 0.95) R.phase = R.vto ? "lift" : "roll";
    return;
  }
  // (a vertical take-off: the hover law flies it — deckHover —, up, then forward; released past 80 m/s, the climb)
  if (R.phase === "lift" || R.phase === "accel") {
    S.hold = null;
    const h = on ? on.l[1] - CARRIER[on.kind].deck : Infinity;
    if (R.phase === "lift" && !(h < STO.liftTo)) {
      R.phase = "accel";
      R.t0 = R.t;
      this.onRadio?.(t("Mother: airborne. Good launch."));
    }
    if (R.phase === "accel" && !S.hover && V > 70) {
      R.phase = "climb";
      const m = this.jetModes;
      m.alt = (this.geoNow()?.alt ?? 40) + 20;
      m.hdg = (this.jetFigures()?.hdg ?? Number.NaN) || null;
      m.spd = null;
    }
    return;
  }
  if (R.phase === "roll") {
    S.hold = 0;
    this.pilot.throttle = 1;
    const ahead = on ? R.bow - on.l[2] : 0;
    if (V > STO.vRotate || ahead < STO.bowMargin) {
      R.phase = "rotate";
      R.off = on?.l[2];
    }
    return;
  }
  if (R.phase === "rotate") {
    S.hold = STO.rotateSwivel;
    this.pilot.throttle = 1;
    if (down) inp.pitch = STO.rotatePitch;
    else {
      R.phase = "climb";
      const m = this.jetModes;
      m.alt = (this.geoNow()?.alt ?? 30) + 15;
      m.hdg = (this.jetFigures()?.hdg ?? Number.NaN) || null;
      m.spd = null;
      this.onRadio?.(t("Mother: airborne. Good launch."));
    }
    return;
  }
  // (off: the lift fan lifting half its thrust, the nozzle aft to speed up — down a little more only while it sinks
  // —, the wing taking the weight as it speeds up; a gentle climb until then, its height asked once fast; past the
  // conversion's end, the lift fan's mode off, the holds on)
  const vs = this.geoNow()?.vs ?? 0;
  S.hold = Math.min(Math.max(0.15 - 0.12 * vs + (V < 70 ? 0.1 : 0), 0), STO.rotateSwivel) * Math.min(1, Math.max(0, (STO.vClean - V) / 30));
  this.pilot.throttle = 1;
  if (V > 85) this.jetModes.alt = Math.max(this.jetModes.alt ?? 0, STO.climb);
  if (V > STO.vClean) {
    S.on = false;
    end(t("Short take-off done — STOVL mode off"));
  }
}
