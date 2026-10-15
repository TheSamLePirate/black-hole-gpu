// The CameraController — the F-35B's recovery on a carrier's deck (game/deckland.ts): engaged, its guidance flies the
// jet's holds to the gate astern and up the port side, converts to STOVL and slows; the hover law then flies its
// velocity — alongside, across over the spot, down —; the LSO ("Paddles") calls it by radio and grades the
// touchdown. The stick or the throttle keys take it back.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { CARRIER, type CarrierId } from "../game/carrier";
import { type DeckOut, type DeckPhase, type DeckRun, deckStep, newDeckRun, VL_SPOT } from "../game/deckland";
import { fleet } from "../fleet";
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

/** The run's guidance this frame, worked out once (the jet's holds and the hover law both ask). */
const memo = new WeakMap<DeckRun, { at: number; out: DeckOut | null }>();

/**
 * The recovery engaged on a carrier (`kind`, else the nearest within 30 km): the F-35B only, its deck's map in.
 * What to say; null: none near (the runway's landing then).
 */
function deckLand(this: CameraController, kind?: CarrierId): string | null {
  if (fleet.active !== "f35") return t("Deck landing: the F-35B's");
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
  const mass = fleet.massProps().mass;
  const thrust = this.thrustMax() * ((C_MPS * C_MPS) / (1476.625 * this.s.massSolar)) * mass * STOVL.boost;
  const most = (0.95 * thrust) / G0_MS2;
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
  Object.assign(C.prototype, { deckLand, deckOff, deckJet, deckHover, deckGuide });
}

/** The last touchdown on a deck (its grade): the controller's. */
declare module "../controls" {
  interface CameraController {
    deckLast?: { dx: number; dz: number; sink: number; grade: string; kind: CarrierId } | null;
  }
}
export { VL_SPOT };
