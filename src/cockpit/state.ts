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
    gear: { pos: on(!!cfg.gear) },
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
    sas: { pos: 0, lit: on(P.sas) },
    chrono: { pos: 0, lit: on(!!chrono?.running) },
    apOff: { pos: 0, lit: on(P.auto !== "none" || P.hold !== "none") * 0.25 },
  };
  if (ptr.hover && st[ptr.hover]) st[ptr.hover]!.hover = true;
  if (ptr.pressed && st[ptr.pressed]) st[ptr.pressed]!.pressed = true;
  return st;
}
