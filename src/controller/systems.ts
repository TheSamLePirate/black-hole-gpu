// The CameraController — a spacecraft's systems (docs/PLAN-VAISSEAUX-AAA.md, X3; game/systems.ts): each craft's
// consumables and failures stepped with the flight's time, their effects on it (the engine, the thrusters, a stuck
// thruster, an IMU drifting, the battery flat), the fixes the checklists end with, the HUD's figures.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { timeRate } from "../clock";
import { fleet } from "../fleet";
import {
  CHECKLISTS,
  effectsOf,
  type FailureKind,
  type FailureRate,
  failNow,
  freshSystems,
  O2_PER_DAY,
  SYSTEMS,
  type SystemsEffects,
  type SystemsState,
  startFix,
  stepSystems,
} from "../game/systems";
import { t, tf } from "../i18n";
import type { PilotInput } from "../pilot";
import type { VesselId } from "../vessels";
import type { CameraController } from "../controls";

/** The systems' figures for the HUD and the tablet. */
export interface SystemsInfo {
  vessel: VesselId;
  battery: number;
  batteryKWh: number;
  /** the battery's balance [kW]: + charging */
  balanceKW: number;
  o2Kg: number;
  o2Hours: number;
  scrubDays: number;
  crew: number;
  failures: { kind: FailureKind; fixing: boolean; at: number }[];
  engine: number;
  rcs: number;
}

declare module "../controls" {
  interface CameraController {
    systemsStep: typeof systemsStep;
    systemsEffects: typeof systemsEffects;
    systemsFix: typeof systemsFix;
    systemsFail: typeof systemsFail;
    systemsInfo: typeof systemsInfo;
    systemsOf: typeof systemsOf;
  }
}

const NONE: SystemsEffects = { engine: 1, rcs: 1, push: [0, 0, 0], drift: [0, 0, 0], powerOut: false };
type SpaceId = keyof typeof SYSTEMS;
const isSpace = (v: VesselId): v is SpaceId => v in SYSTEMS;

/** A craft's systems, made at its first use (its seed the scene's time: a flight replayed fails alike). */
function systemsOf(this: CameraController, v: VesselId): SystemsState | null {
  if (!isSpace(v)) return null;
  fleet.systems[v] ??= freshSystems(SYSTEMS[v], Math.floor(Math.abs(this.nowTime()) * 1e3) + v.length * 7919);
  return fleet.systems[v]!;
}

/** The effects now on the flown craft (none for an aircraft, or consumables and failures off). */
function systemsEffects(this: CameraController): SystemsEffects {
  const S = this.systemsOf(fleet.active);
  return S ? effectsOf(S) : NONE;
}

/** The level's failure rate: off for a beginner, as set otherwise. */
function rateNow(c: CameraController): FailureRate {
  const lv = c.assistLevel();
  return lv === "beginner" ? "off" : ((c.s.spaceFailures ?? "off") as FailureRate);
}

/**
 * A frame of the flown craft's systems (before the flight computer's step): stepped with the flight's seconds (the
 * warp's), a failure said as it comes; a stuck thruster's push added to the translation keys.
 */
function systemsStep(this: CameraController, inp: PilotInput, dt: number) {
  const v = fleet.active;
  const S = this.systemsOf(v);
  if (!S) return;
  const s = this.s;
  const sec = s.animate ? timeRate(s) * dt * 4.925490947e-6 * s.massSolar : 0;
  const effort = Math.max(this.pilot.fired.rcs, this.pilot.fired.turn);
  const f = stepSystems(SYSTEMS[v as SpaceId], S, sec, { effort }, { consumables: s.spaceConsumables !== false, rate: rateNow(this) });
  if (f) this.onPilotMessage?.(tf("Master caution: {0} — its checklist on the HUD and the tablet (Systems)", t(CHECKLISTS[f.kind].title)));
  const e = effectsOf(S);
  if (e.push.some((x) => x !== 0) && !e.powerOut) {
    inp.tx = Math.max(-1, Math.min(1, inp.tx + e.push[0]));
    inp.ty = Math.max(-1, Math.min(1, inp.ty + e.push[1]));
    inp.tz = Math.max(-1, Math.min(1, inp.tz + e.push[2]));
  }
}

/** A failure's checklist's last step taken: its fix under way. What to say. */
function systemsFix(this: CameraController, kind: FailureKind): string {
  const S = this.systemsOf(fleet.active);
  if (!S || !startFix(S, kind)) return t("Nothing to fix");
  return tf("{0}: under way", t(CHECKLISTS[kind].action));
}

/** A failure now (a scenario's, a test's, the crew's drill). */
function systemsFail(this: CameraController, kind: FailureKind): string {
  const S = this.systemsOf(fleet.active);
  if (!S) return t("Systems: a spacecraft's");
  failNow(S, kind);
  return tf("Master caution: {0} — its checklist on the HUD and the tablet (Systems)", t(CHECKLISTS[kind].title));
}

/** The flown craft's systems' figures (null: an aircraft). */
function systemsInfo(this: CameraController): SystemsInfo | null {
  const v = fleet.active;
  const S = this.systemsOf(v);
  if (!S) return null;
  const spec = SYSTEMS[v as SpaceId];
  const e = effectsOf(S);
  const bus = S.failures.some((f) => f.kind === "bus" && !f.fixed);
  const draw = spec.baseKW * (bus ? 3 : 1) + spec.effortKW * Math.max(this.pilot.fired.rcs, this.pilot.fired.turn);
  const leak = S.failures.some((f) => f.kind === "o2Leak" && !f.fixed);
  const perH = (spec.crew * O2_PER_DAY) / 24 + (leak ? spec.o2Kg / 6 : 0);
  return {
    vessel: v,
    battery: S.battery,
    batteryKWh: spec.batteryKWh,
    balanceKW: spec.genKW - draw,
    o2Kg: S.o2,
    o2Hours: perH > 0 ? S.o2 / perH : Number.POSITIVE_INFINITY,
    scrubDays: S.scrub,
    crew: spec.crew,
    failures: S.failures.filter((f) => !f.fixed).map((f) => ({ kind: f.kind, fixing: f.fixAt !== undefined, at: f.at })),
    engine: e.engine,
    rcs: e.rcs,
  };
}

export function installSystems(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { systemsStep, systemsEffects, systemsFix, systemsFail, systemsInfo, systemsOf });
}
