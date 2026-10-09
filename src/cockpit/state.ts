// The cockpit's controls as the flight has them (PLAN-COCKPIT K1): each lever where its setting is — moved
// by a key, a HOTAS, an autopilot as well as by hand —, each button lit by its mode. Read each frame for the
// cabin's drawing (cockpit/controls.ts poseData).

import type { CameraController } from "../controls";
import type { Settings } from "../settings";
import type { Chrono } from "./chrono";
import type { ControlState } from "./controls";

/** What the pointer adds: the control under it, the one held down. */
export interface PointerOn {
  hover: string | null;
  pressed: string | null;
}

export function controlStates(
  c: CameraController,
  s: Settings,
  chrono: Chrono | null = null,
  ptr: PointerOn = { hover: null, pressed: null },
): Record<string, ControlState> {
  const P = c.pilot;
  const cfg = c.airFlight.cfg;
  const on = (b: boolean) => (b ? 1 : 0);
  const st: Record<string, ControlState> = {
    // (the gear's lever where it is commanded; its wheel lit red while the gear moves, flashing with the
    // alarm — as a real one's)
    gear: {
      pos: on(c.gearDown),
      lit: c.airInfo().gearWarn ? on(Math.floor(performance.now() / 300) % 2 === 0) : c.gearExt > 0 && c.gearExt < 1 ? 1 : 0,
    },
    flaps: { pos: cfg.flaps ?? 0 },
    airBrake: { pos: Math.min(Math.max(c.airBrake, 0), 1) },
    dimmer: { pos: s.cabinLight },
    night: { pos: on(s.nightLighting) },
    navLights: { pos: on(s.navLights) },
    strobe: { pos: on(s.strobeLights) },
    landingLights: { pos: on(s.landingLights) },
    holdPrograde: { pos: 0, lit: on(P.hold === "prograde") },
    holdRetrograde: { pos: 0, lit: on(P.hold === "retrograde") },
    holdTarget: { pos: 0, lit: on(P.hold === "target") },
    assist: { pos: 0, lit: on(P.assist) },
    autoEntry: { pos: 0, lit: on(P.auto === "entry") },
    autoLand: { pos: 0, lit: on(P.auto === "land") },
    autoTakeoff: { pos: 0, lit: on(P.auto === "takeoff") },
    // (CIRC flies its burn as a node: lit while that node is CIRC's — as the hub's button)
    autoCirc: { pos: 0, lit: on(P.auto === "circularize" || (P.auto === "node" && !!c.ourCirc)) },
    autoApproach: { pos: 0, lit: on(P.auto === "approach") },
    sas: { pos: 0, lit: on(P.sas) },
    chrono: { pos: 0, lit: on(!!chrono?.running) },
    apOff: { pos: 0, lit: on(P.auto !== "none" || P.hold !== "none") * 0.25 },
  };
  if (ptr.hover && st[ptr.hover]) st[ptr.hover]!.hover = true;
  if (ptr.pressed && st[ptr.pressed]) st[ptr.pressed]!.pressed = true;
  return st;
}

/** How fast each control's moving part travels to where the flight has it [its range per second]: a lever
 *  thrown by a hand, a key, an autopilot is seen going there — the gear's swiftly, the flaps' and the air
 *  brake's as their surfaces run; a switch snaps; the knob turns. Held by the pointer: where the hand is. */
const TRAVEL: Record<string, number> = { gear: 4, flaps: 1.5, airBrake: 2.5, dimmer: 4 };
const TRAVEL_TOGGLE = 12;

export class ControlTravel {
  private shown: Record<string, number> = {};

  /** The states with each moving part where it has got to after `dt` [s]. */
  step(st: Record<string, ControlState>, dt: number): Record<string, ControlState> {
    for (const [id, s] of Object.entries(st)) {
      const want = s.pos;
      const was = this.shown[id];
      const rate = TRAVEL[id] ?? TRAVEL_TOGGLE;
      const now = was === undefined || s.pressed ? want : was + Math.min(Math.max(want - was, -rate * dt), rate * dt);
      this.shown[id] = now;
      s.pos = now;
    }
    return st;
  }
}
