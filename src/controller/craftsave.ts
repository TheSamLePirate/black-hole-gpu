// The craft's own state in a save (audit 2026-11-10, FX-09/AR-09; wave 3.3): what a load's new flight (newFlight)
// would otherwise reset — every craft's fuel and payload, the spacecraft's consumables and failures, and the flown
// craft's configuration: the gear, the flaps, the speed brakes, the engine, the jet's holds (altitude, heading, speed,
// afterburner), the F-35B's STOVL, the skin's temperatures. Before 13 Nov 2026 a save gave back the place and the
// throttle only: F5 then F9 in an F-35 gave full tanks, the gear by the height, the flaps up, the holds off.
//
// Its own version (`v`), in a v2 save as an optional block: an older game ignores it, a malformed one is left out
// (the flight still loads). Not in it: the A320's systems bag, its FMGC and MCDU, armed failures (made anew — the A320's
// fuel comes back through the fleet's), a formation, an intercept, a refuelling, an ILS or a deck's recovery under way.

import type { Thermal } from "../aero";
import { fleet } from "../fleet";
import { t, tr } from "../i18n";
import type { SystemsState } from "../game/systems";
import { noStovl, type StovlState } from "./stovl";
import { noJetModes } from "../game/jet";
import { noNav } from "./fplan";
import { VESSEL_IDS, type VesselId } from "../vessels";
import type { CameraController } from "../controls";

export interface CraftSave {
  v: 1;
  /** every craft's fuel left [kg] and payload [kg] (none: full, none) */
  fuel: Partial<Record<VesselId, number>>;
  payload: Partial<Record<VesselId, number>>;
  /** the spacecraft's consumables and failures */
  systems?: Partial<Record<VesselId, SystemsState>>;
  /** the flown craft: the gear (down, its extension 0…1), the flaps (0…1), the brake (the A320's spoilers' lever),
   *  the air brake (0…1), the engine's thrust now (0…1) */
  gear: { down: boolean; ext: number };
  flaps: number;
  brake: number;
  airBrake: number;
  engine: number;
  /** the jet's holds: altitude over the sea [m], heading [rad], speed through the air [m/s], afterburner, bank limit */
  jet: { alt: number | null; hdg: number | null; spd: number | null; ab: boolean; bankMax?: number };
  /** the F-35B's STOVL */
  stovl?: StovlState;
  /** the skin's temperatures [K] */
  skin?: Thermal;
}

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const numOrNull = (x: unknown) => x === null || num(x);
const kgMap = (x: unknown) =>
  !!x &&
  typeof x === "object" &&
  !Array.isArray(x) &&
  Object.entries(x as Record<string, unknown>).every(([k, v]) => VESSEL_IDS.includes(k as VesselId) && num(v) && v >= 0);

/** The craft's state now. */
export function captureCraft(c: CameraController): CraftSave {
  const j = c.jetModes;
  const cfg = c.airFlight.cfg;
  return {
    v: 1,
    fuel: { ...fleet.fuel },
    payload: { ...fleet.payload },
    systems: Object.keys(fleet.systems).length ? structuredClone(fleet.systems) : undefined,
    gear: { down: c.gearDown, ext: c.gearExt },
    flaps: cfg.flaps ?? 0,
    brake: cfg.brake ?? 0,
    airBrake: c.airBrake,
    engine: c.pilot.engineNow,
    jet: { alt: j.alt, hdg: j.hdg, spd: j.spd, ab: j.ab, ...(j.bankMax !== undefined ? { bankMax: j.bankMax } : {}) },
    stovl: c.stovl.on ? structuredClone(c.stovl) : undefined,
    skin: { ...c.airFlight.skin },
  };
}

/** A block read from a save: checked, null when it is not one (told by the caller). */
export function checkCraft(x: unknown): CraftSave | null {
  if (!x || typeof x !== "object") return null;
  const b = x as CraftSave;
  if (b.v !== 1) return null;
  if (!kgMap(b.fuel) || !kgMap(b.payload)) return null;
  if (b.systems !== undefined && (!b.systems || typeof b.systems !== "object")) return null;
  if (!b.gear || typeof b.gear.down !== "boolean" || !num(b.gear.ext)) return null;
  if (![b.flaps, b.brake, b.airBrake, b.engine].every((v) => num(v) && v >= 0 && v <= 1)) return null;
  const J = b.jet;
  if (!J || !numOrNull(J.alt) || !numOrNull(J.hdg) || !numOrNull(J.spd) || typeof J.ab !== "boolean") return null;
  if (J.bankMax !== undefined && !num(J.bankMax)) return null;
  if (b.stovl !== undefined && (!b.stovl || typeof b.stovl.on !== "boolean")) return null;
  if (b.skin !== undefined && (!b.skin || !num(b.skin.shield) || !num(b.skin.hull))) return null;
  return b;
}

/** The craft as saved — after the load's new flight and its placing (which reset all of it). */
export function restoreCraft(c: CameraController, b: CraftSave) {
  fleet.fuel = { ...b.fuel };
  fleet.payload = { ...b.payload };
  // (none saved: none — not the systems of the flight flown before the load)
  fleet.systems = b.systems ? structuredClone(b.systems) : {};
  // (the gear as saved, not decided again by the height at the flight's first frame)
  c.gearInit = true;
  c.gearDown = b.gear.down;
  c.gearExt = b.gear.ext;
  c.airFlight.cfg.flaps = b.flaps;
  c.airFlight.cfg.brake = b.brake;
  c.airBrake = b.airBrake;
  c.pilot.engineNow = b.engine;
  // (the holds: taken up by the jet's law once it flies as a plane — its first frames after the placing would wipe them)
  const modes = { alt: b.jet.alt, hdg: b.jet.hdg, spd: b.jet.spd, ab: b.jet.ab, bankMax: b.jet.bankMax };
  c.jetModes = { ...c.jetModes, ...modes };
  c.jetResume = modes.alt !== null || modes.hdg !== null || modes.spd !== null || modes.ab ? { modes, frames: 90 } : null;
  if (b.stovl) c.stovl = structuredClone(b.stovl);
  if (b.skin) c.airFlight.skin = { ...c.airFlight.skin, ...b.skin };
}

/** A craft's own configuration, kept for it while another is flown (audit FX-14: one set of gear, flaps, brakes, air brake
 *  served every craft — the Ranger came in orbit with the F-35's gear and flaps, the F-35 back on its runway gear up). */
export interface CraftConfig {
  gear: { down: boolean; ext: number };
  flaps: number;
  brake: number;
  airBrake: number;
  stovl: StovlState;
}

/** The flown craft's configuration now (fleet.config keeps it while another is flown). */
export function captureConfig(c: CameraController): CraftConfig {
  const cfg = c.airFlight.cfg;
  return {
    gear: { down: c.gearDown, ext: c.gearExt },
    flaps: cfg.flaps ?? 0,
    brake: cfg.brake ?? 0,
    airBrake: c.airBrake,
    stovl: structuredClone(c.stovl),
  };
}

/** The craft now flown given its own configuration — as it was left, or, never flown, its gear decided by its height at
 *  the next frame (down on a ground, up in the air), its flaps and brakes in; the jet's holds, the NAV and the spoilers
 *  let go (they flew the craft left). */
export function applyConfig(c: CameraController, k: CraftConfig | undefined) {
  if (k) {
    c.gearInit = true;
    c.gearDown = k.gear.down;
    c.gearExt = k.gear.ext;
  } else c.gearInit = false;
  c.airFlight.cfg.flaps = k?.flaps ?? 0;
  c.airFlight.cfg.brake = k?.brake ?? 0;
  c.airBrake = k?.airBrake ?? 0;
  c.stovl = k ? structuredClone(k.stovl) : noStovl();
  c.jetModes = noJetModes();
  c.jetResume = null;
  c.nav = noNav();
  c.groundSpoilers = false;
}

/** An activity under way when the game is saved — an air mission, a fight, a challenge, a lesson: named in the save, it
 *  is not in it (its units, its gates, its timeline): the load says so rather than resume it half. */
export interface SavedActivity {
  kind: "mission" | "combat" | "challenge" | "space-mission" | "space-challenge" | "space-lesson";
  title: string;
}

/** The activity under way (null: none, or one over). */
export function activityNow(c: CameraController): SavedActivity | null {
  if (c.mission) return { kind: "mission", title: c.mission.run.spec.title };
  if (c.combat?.status === "run") return { kind: "combat", title: tr(c.combat.def.title) };
  if (c.chal?.status === "run") return { kind: "challenge", title: tr(c.chal.def.title) };
  if (c.spaceMission) return { kind: "space-mission", title: t(c.spaceMission.M.title) };
  if (c.spaceChal) return { kind: "space-challenge", title: t(c.spaceChal.C.title) };
  if (c.spaceCourse) return { kind: "space-lesson", title: t(c.spaceCourse.lesson.title) };
  return null;
}
