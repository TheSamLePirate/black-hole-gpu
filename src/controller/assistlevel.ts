// The CameraController — the F-35's levels of assistance (docs/PLAN-AVIATION-AAA.md, A1): manual (the direct law),
// realistic (the real aircraft), assisted (the throttle a speed — auto-throttle —, 20° of incidence at most, the
// ground's protection: controller/gcas.ts), beginner (aimed: the stick moves a ring — a heading and a flight path —,
// the jet banks and pulls to fly there, the throttle a speed); and in any, back to stable flight at a key — the wings
// rolled level, the nose to a gentle climb, a safe speed —, the holds then left on.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { fleet } from "../fleet";
import { t } from "../i18n";
import type { PilotInput } from "../pilot";
import type { Settings } from "../settings";
import type { CameraController } from "../controls";

const D = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The assisted levels' incidence at most [rad]; the beginner's ring's rates [rad/s] and its flight path's bounds. */
export const ASSIST = { alphaMax: 20 * D, aimTurn: 45 * D, aimPitch: 12 * D, aimGamma: 25 * D, recoverV: 200 };

export type AssistLevel = Settings["f35Assist"];

declare module "../controls" {
  interface CameraController {
    /** the beginner's ring: the heading and the flight path the jet flies to [rad] */
    aimRing?: { hdg: number; gamma: number } | null;
    /** back to stable flight: since when [s of its own], its phase */
    recovering?: { t: number; level: number } | null;
    assistLevel: typeof assistLevel;
    assistJet: typeof assistJet;
    assistThrottle: typeof assistThrottle;
    recoverStart: typeof recoverStart;
  }
}

/** The level flown now (the F-35's; any other craft: realistic — its own law). */
function assistLevel(this: CameraController): AssistLevel {
  return fleet.active === "f35" ? (this.s.f35Assist ?? "realistic") : "realistic";
}

/** The jet's flight path now [rad] (over the ground's — the air's is near it). */
function gammaNow(c: CameraController): number {
  const g = c.geoNow();
  return g ? Math.atan2(g.vs, Math.max(g.gs, 1)) : 0;
}

/** Back to stable flight (the key, TARS): the wings rolled level, the nose to a gentle climb, a safe speed; then the
 *  altitude, the heading and the speed held. What to say. */
function recoverStart(this: CameraController): string {
  if (!this.jetFigures()) return t("Recovery: in the air, flown as a plane");
  this.recovering = { t: 0, level: 0 };
  this.aimRing = null;
  return t("Recovery: wings level, climbing");
}

/**
 * A frame of the jet's systems for the levels: the recovery if asked (its flight path, bank and speed), else the
 * beginner's ring flown (the stick moving it — taken from the law). Null: the holds' and the stick's own.
 */
function assistJet(
  this: CameraController,
  inp: PilotInput,
  f: { h: number; hdg: number; V: number },
  dt: number,
  what: "recover" | "aim",
): { gamma: number; bank: number; spd: number; acc: number } | null {
  const m = this.jetModes;
  const Rv = this.recovering;
  if (what === "recover") {
    if (!Rv) return null;
    // (the stick taken back — moved hard —: the recovery let go)
    if (Math.abs(inp.pitch) > 0.5 || Math.abs(inp.roll) > 0.5) {
      this.recovering = null;
      this.onPilotMessage?.(t("Recovery: off — the stick"));
      return null;
    }
    Rv.t += dt;
    const bank = (this.attitudeNow() as { bank?: number }).bank ?? 0;
    const g = gammaNow(this);
    // (level once the wings are within 10° and the path climbs: a few seconds of it, then the holds)
    if (Math.abs(bank) < 10 * D && g > 0) Rv.level += dt;
    else Rv.level = 0;
    if (Rv.level > 3) {
      this.recovering = null;
      m.alt = Math.round(f.h / 10) * 10;
      m.hdg = f.hdg;
      m.spd = Math.max(Math.round(f.V), 150);
      m.ab = false;
      this.onPilotMessage?.(t("Recovery: stable — altitude, heading and speed held"));
      return null;
    }
    // (the wings first: the nose not pulled through a steep bank — a gentle path asked until near level)
    const gamma = Math.abs(bank) > 45 * D ? Math.max(g, -5 * D) : 6 * D;
    return { gamma, bank: 0, spd: ASSIST.recoverV, acc: f.V < 150 ? 2 : 0 };
  }
  // (the holds engaged — the autopilot, NAV —: theirs; the ring taken again from where it flies once let go)
  if (this.assistLevel() !== "beginner" || m.alt !== null || m.hdg !== null || this.nav.on.l) {
    this.aimRing = null;
    return null;
  }
  // the beginner's ring: from where it flies, moved by the stick (the roll turns it, the pitch raises it)
  const A = (this.aimRing ??= { hdg: f.hdg, gamma: gammaNow(this) });
  if (!Number.isFinite(A.hdg)) A.hdg = Number.isFinite(f.hdg) ? f.hdg : 0;
  A.hdg = wrap(A.hdg + inp.roll * ASSIST.aimTurn * dt);
  A.gamma = clamp(A.gamma + inp.pitch * ASSIST.aimPitch * dt, -ASSIST.aimGamma, ASSIST.aimGamma);
  // (the stick the ring's, not the law's)
  inp.pitch = inp.roll = inp.yaw = 0;
  // (the throttle keys: the speed)
  m.spd ??= Math.round(f.V);
  m.spd = clamp(m.spd + inp.throttle * 15 * dt, 70, 500);
  inp.throttle = 0;
  const dh = Number.isFinite(f.hdg) ? wrap(A.hdg - f.hdg) : 0;
  // (the bank that turns at half the gap a second — closed in some 2 s —, 60° at most)
  const bank = clamp(Math.atan2(f.V * 0.5 * dh, 9.80665), -60 * D, 60 * D);
  return { gamma: A.gamma, bank, spd: m.spd, acc: f.V < m.spd - 30 ? 2 : 0 };
}

/** The assisted level's auto-throttle: in the air, no speed held nor afterburner — the speed now held, the throttle
 *  keys then setting it (controller/jet.ts). */
function assistThrottle(this: CameraController, f: { V: number }) {
  if (this.assistLevel() !== "assisted") return;
  const m = this.jetModes;
  if (m.spd === null && !m.ab) {
    m.spd = Math.max(Math.round(f.V), 90);
    this.jetAthr.reset();
  }
}

export function installAssistLevel(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { assistLevel, assistJet, assistThrottle, recoverStart });
}
