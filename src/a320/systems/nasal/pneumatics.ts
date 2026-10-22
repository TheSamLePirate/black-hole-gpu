// The A320's pneumatics and pressurization's Nasal (docs/PLAN-A320.md, A10 — Nasal/Systems/pneumatics.nas): the bleeds,
// the packs and the valves are JSBSim's (Systems/a320-pneumatic.xml, a320-aircond.xml: jsbsys.ts); the Nasal sets the
// overhead's switches (PNEU.init), and runs the pressurization's mode — GN on the ground, TO with both levers at MCT or
// TOGA, CL once airborne past 100 kt — and the cabin's altitude: towards its target at the vertical speed the
// controller asks in the air (AUTO), at the MAN V/S selector's otherwise. The packs and bleeds by start: off cold and
// dark, on from FlightGear's "before start" (the APU's bleed with it).

import type { Props } from "../../rig";
import type { NasalModule, StartState } from "../types";
import { assign, bool, num } from "./util";

const FAIL = [
  "apu-valve",
  "bleed-1-valve",
  "bleed-2-valve",
  "cabin-fans",
  "hot-air-valve",
  "hp-1-valve",
  "hp-2-valve",
  "pack-1-valve",
  "pack-2-valve",
  "ram-air-valve",
  "trim-valve-cockpit",
  "trim-valve-cabin-aft",
  "trim-valve-cabin-fwd",
  "x-bleed-valve",
].map((f) => `systems/failures/pneumatics/${f}`);
const SW = "controls/pneumatics/switches/";
const PR = "systems/pressurization/";
const K = {
  wow: ["gear/gear[1]/wow", "gear/gear[2]/wow"],
  detent: ["systems/fadec/control-1/detent-text", "systems/fadec/control-2/detent-text"],
  gs: "velocities/groundspeed-kt",
  pause: "sim/freeze/master",
  alt: "instrumentation/altimeter/indicated-altitude-ft",
};

export class Pneumatics implements NasalModule {
  readonly name = "PNEU";

  step(P: Props, dt: number) {
    const wowl = bool(P, K.wow[0]!),
      wowr = bool(P, K.wow[1]!);
    const cabinalt = num(P, `${PR}cabinalt`),
      targetalt = num(P, `${PR}targetalt`);
    const s1 = String(P[K.detent[0]!] ?? ""),
      s2 = String(P[K.detent[1]!] ?? "");
    const mode = String(P[`${PR}mode`] ?? "GN");
    const vs = num(P, `${PR}vs-norm`),
      manvs = num(P, `${PR}manvs-cmd`);
    const pause = bool(P, K.pause),
      auto = bool(P, `${PR}auto`);
    const targetvs = num(P, `${PR}targetvs`);
    P[`${PR}diff-to-target`] = targetalt - cabinalt;
    P[`${PR}deltap`] = num(P, `${PR}cabinpsi`) - num(P, `${PR}ambientpsi`);
    const toga = (s: string) => s === "MCT" || s === "TOGA";
    if (mode === "GN" && wowl && wowr && toga(s1) && toga(s2)) P[`${PR}mode`] = "TO";
    else if ((!wowl || !wowr) && num(P, K.gs) > 100 && mode === "TO") P[`${PR}mode`] = "CL";
    if (vs !== targetvs && !wowl && !wowr) P[`${PR}vs`] = targetvs;
    // (FlightGear's loop at 10 Hz: the cabin's altitude moved by a tenth of a second's climb each turn — kept as a rate)
    if (cabinalt !== targetalt && !wowl && !wowr && !pause && auto) P[`${PR}cabinalt`] = cabinalt + (vs / 60) * dt;
    else if (!auto && !pause) P[`${PR}cabinalt`] = cabinalt + (manvs / 60) * dt;
  }

  reset(P: Props, s: StartState) {
    for (const f of FAIL) P[f] = 0;
    const on = s === "cold" ? 0 : 1;
    const alt = num(P, K.alt);
    assign(P, {
      [`${SW}apu`]: s === "apu" ? 1 : 0,
      [`${SW}bleed-1`]: 1,
      [`${SW}bleed-2`]: 1,
      [`${SW}blower`]: 0,
      [`${SW}cabin-fans`]: 1,
      [`${SW}extract`]: 0,
      [`${SW}ground-air`]: 0,
      [`${SW}hot-air`]: 1,
      [`${SW}pack-1`]: on,
      [`${SW}pack-2`]: on,
      [`${SW}pack-flow`]: 1,
      [`${SW}ram-air`]: 0,
      [`${SW}temp-cabin-aft`]: 0.5,
      [`${SW}temp-cockpit`]: 0.5,
      [`${SW}temp-cabin-fwd`]: 0.5,
      [`${SW}x-bleed`]: 1,
      [`${PR}mode`]: s === "air" ? "CL" : "GN",
      [`${PR}vs`]: 0,
      [`${PR}targetvs`]: 0,
      [`${PR}vs-norm`]: 0,
      [`${PR}auto`]: 1,
      [`${PR}deltap`]: 0,
      [`${PR}outflowpos`]: 0,
      [`${PR}deltap-norm`]: 0,
      [`${PR}outflowpos-norm`]: 0,
      [`${PR}outflowpos-man`]: 0.5,
      [`${PR}outflowpos-man-sw`]: 0,
      [`${PR}outflowpos-norm-cmd`]: 0,
      [`${PR}cabinalt`]: alt,
      [`${PR}targetalt`]: alt,
      [`${PR}diff-to-target`]: 0,
      [`${PR}ditchingpb`]: 0,
      [`${PR}ambientpsi`]: 0,
      [`${PR}cabinpsi`]: 0,
      [`${PR}manvs-cmd`]: 0,
      [`${PR}pack-1-out-temp`]: 0,
      [`${PR}pack-2-out-temp`]: 0,
      [`${PR}pack-1-bypass`]: 0,
      [`${PR}pack-2-bypass`]: 0,
      [`${PR}pack-1-flow`]: 0,
      [`${PR}pack-2-flow`]: 0,
      [`${PR}pack-1-comp-out-temp`]: 0,
      [`${PR}pack-2-comp-out-temp`]: 0,
      [`${PR}pack-1-valve`]: 0,
      [`${PR}pack-2-valve`]: 0,
      "controls/oxygen/passenger-mask-deploy-man": 0,
      "controls/oxygen/passenger-mask-reset": 0,
    });
  }
}
