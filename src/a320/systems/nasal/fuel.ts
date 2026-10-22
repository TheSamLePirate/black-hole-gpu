// The A320's fuel system's Nasal (docs/PLAN-A320.md, A10 — Nasal/Systems/fuel.nas): the tanks, the pumps, the valves
// and the transfers are JSBSim's (Systems/a320-fuel.xml, jsbsys.ts); the Nasal clears the pumps' failures, runs the
// centre tank's pumps for 2 minutes once an engine is running (ctr-pump-cmd-on-eng-start: the CTR TK's pumps fed at
// the start whatever the mode), and keeps each side's fuel used at an engine's start (offset-left / -right, the
// ECAM's FU). The pumps' switches by start: off cold and dark, on from FlightGear's "before start".

import type { Props } from "../../rig";
import type { NasalModule, StartState } from "../types";
import { assign, Clock, Listen, num } from "./util";

const FAIL = [
  "left-tank-pump-1",
  "left-tank-pump-2",
  "center-tank-pump-1",
  "center-tank-pump-2",
  "right-tank-pump-1",
  "right-tank-pump-2",
].map((f) => `systems/failures/fuel/${f}`);
const SW = "controls/fuel/switches/";
const PUMPS = ["pump-left-1", "pump-left-2", "pump-center-1", "pump-center-2", "pump-right-1", "pump-right-2"].map((p) => SW + p);
const K = {
  ctrOn: "systems/fuel/ctr-pump-cmd-on-eng-start",
  state: ["engines/engine/state", "engines/engine[1]/state"],
  used: ["fdm/jsbsim/propulsion/engine/fuel-used-lbs", "fdm/jsbsim/propulsion/engine[1]/fuel-used-lbs"],
  offset: ["systems/fuel/offset-left", "systems/fuel/offset-right"],
};

export class Fuel implements NasalModule {
  readonly name = "FUEL";
  private clock = new Clock();
  private L = new Listen();
  private timeEngStart = 0;
  private ctrTimer = false;

  step(P: Props, dt: number) {
    this.clock.tick(dt);
    for (let i = 0; i < 2; i++) {
      if (!this.L.edge(P, K.state[i]!)) continue;
      const s = num(P, K.state[i]!);
      if (s === 3) {
        this.timeEngStart = this.clock.t;
        P[K.ctrOn] = 1;
        this.ctrTimer = true;
      } else if (s === 2) P[K.offset[i]!] = num(P, K.offset[i]!) - num(P, K.used[i]!);
    }
    if (this.ctrTimer && this.clock.t > this.timeEngStart + 120) {
      P[K.ctrOn] = 0;
      this.ctrTimer = false;
    }
  }

  reset(P: Props, s: StartState) {
    this.clock.clear();
    this.ctrTimer = false;
    for (const f of FAIL) P[f] = 0;
    const on = s === "cold" ? 0 : 1;
    for (const p of PUMPS) P[p] = on;
    assign(P, {
      [`${SW}center-mode`]: 1,
      [`${SW}crossfeed`]: 0,
      [K.ctrOn]: 0,
      [K.offset[0]!]: num(P, K.offset[0]!),
      [K.offset[1]!]: num(P, K.offset[1]!),
    });
    this.L.prime(P, K.state);
  }
}
