// The A320's hydraulics' Nasal (docs/PLAN-A320.md, A10 — Nasal/Systems/hydraulics.nas): the three circuits' pumps,
// the PTU, the RAT, the pressures and quantities are JSBSim's (Systems/a320-hydraulic.xml, jsbsys.ts); the Nasal sets
// the overhead's pumps (ENG 1 and 2 PUMP, BLUE and YELLOW ELEC PUMP, PTU, the RAT's MAN ON), the reservoirs' fill and
// the brakes' accumulator, and clears the failures (HYD.init). Its loop is the brakes' (their pressures by the
// braking mode, the accumulator spent): left to the brakes' step.

import type { Props } from "../../rig";
import type { NasalModule, StartState } from "../types";
import { assign } from "./util";

const FAIL = [
  "blue-elec",
  "blue-elec-ovht",
  "blue-leak",
  "blue-reservoir-air-press-lo",
  "blue-reservoir-ovht",
  "green-edp",
  "green-leak",
  "green-reservoir-air-press-lo",
  "green-reservoir-ovht",
  "ptu",
  "yellow-edp",
  "yellow-elec",
  "yellow-elec-ovht",
  "yellow-leak",
  "yellow-reservoir-air-press-lo",
  "yellow-reservoir-ovht",
].map((f) => `systems/failures/hydraulic/${f}`);

const SW = "controls/hydraulic/switches/";

export class Hydraulics implements NasalModule {
  readonly name = "HYD";
  step(_P: Props, _dt: number) {
    // (FlightGear's loop: the brakes' — not here)
  }
  reset(P: Props, _s: StartState) {
    for (const f of FAIL) P[f] = 0;
    assign(P, {
      // (the reservoirs [l]: blue 8, green 16, yellow 15)
      "systems/hydraulic/blue-qty-input": 8,
      "systems/hydraulic/green-qty-input": 16,
      "systems/hydraulic/yellow-qty-input": 15,
      [`${SW}blue-elec`]: 1,
      [`${SW}blue-elec-ovrd`]: 0,
      [`${SW}green-edp`]: 1,
      [`${SW}ptu`]: 1,
      [`${SW}rat-man`]: 0,
      [`${SW}yellow-edp`]: 1,
      [`${SW}yellow-elec`]: 0,
      "systems/hydraulic/yellow-accumulator-psi-cmd": 3000,
      "systems/hydraulic/brakes/pressure-left-psi": 0,
      "systems/hydraulic/brakes/pressure-right-psi": 0,
      "systems/hydraulic/brakes/mode": 0,
      "systems/hydraulic/brakes/nose-rubber": 0,
    });
  }
}
