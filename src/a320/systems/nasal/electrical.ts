// The A320's electrical system's Nasal (docs/PLAN-A320.md, A10 — Nasal/Systems/electrical.nas): FlightGear computes
// the buses in JSBSim (Systems/a320-electrical.xml, interpreted by jsbsys.ts); its Nasal only sets the overhead's
// switches and clears the failures (ELEC.init), its loop is empty. Its listeners on the FMGCs' power (the AP and
// A/THR off as an FMGC loses it) are the flight guidance's, not here. The switches by start: cold and dark (the
// batteries off), then FlightGear's "before start" (BAT 1 and 2, APU GEN, GEN 1 and 2 on).

import type { Props } from "../../rig";
import type { NasalModule, StartState } from "../types";
import { assign } from "./util";

const FAIL = [
  "ac-ess-bus",
  "ac-1-bus",
  "ac-2-bus",
  "dc-bat-bus",
  "dc-ess-bus",
  "dc-1-bus",
  "dc-2-bus",
  "emer-gen",
  "ess-tr",
  "gen-1",
  "gen-2",
  "apu",
  "idg-1",
  "idg-2",
  "stat-inv",
  "tr-1",
  "tr-2",
].map((f) => `systems/failures/electrical/${f}`);

const SW = "controls/electrical/switches/";

export class Electrical implements NasalModule {
  readonly name = "ELEC";
  step(_P: Props, _dt: number) {
    // (FlightGear's loop: empty — the buses are a320-electrical.xml's)
  }
  reset(P: Props, s: StartState) {
    for (const f of FAIL) P[f] = 0;
    const bat = s === "cold" ? 0 : 1;
    assign(P, {
      "systems/electrical/some-electric-thingie/emer-gen-operate": 0,
      [`${SW}ac-ess-feed`]: 0,
      [`${SW}bat-1`]: bat,
      [`${SW}bat-2`]: bat,
      [`${SW}bus-tie`]: 1,
      [`${SW}emer-gen-test`]: 0,
      [`${SW}ext-pwr`]: 0,
      [`${SW}galley`]: 1,
      [`${SW}gen-1`]: 1,
      [`${SW}gen-2`]: 1,
      [`${SW}apu`]: 1,
      [`${SW}gen-1-line-contactor`]: 0,
      [`${SW}ground-cart`]: 0,
      [`${SW}idg-1-disc`]: 1,
      [`${SW}idg-2-disc`]: 1,
      [`${SW}emer-elec-man-on`]: 0,
    });
  }
}
