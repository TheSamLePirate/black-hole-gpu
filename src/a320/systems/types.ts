// The A320's systems' contract (docs/PLAN-A320.md, A10): FlightGear's property tree as one bag (src/a320/rig.ts Props —
// the deck's: its switches, its lights, its displays read it; paths without a leading "/" nor an index [0], JSBSim's
// relative ones under "fdm/jsbsim/"), the game's figures put into it each frame under FlightGear's names (sysinputs.ts),
// then FlightGear's systems run on it — its JSBSim system files interpreted (jsbsys.ts) and its Nasal ported
// (nasal/*.ts) —, the game reading back what they decide (the buses, the engines' fuel and starters, the hydraulics).

import type { Props } from "../rig";

/** The flight's state the systems start from: cold and dark (everything off, on the stand), before the engines' start
 *  (the batteries, the APU, the ADIRS aligned), ready for take-off (the engines running: the game's default placing), in
 *  flight. */
export type StartState = "cold" | "apu" | "ready" | "air";

/** A Nasal system of FlightGear's ported (nasal/*.ts): its frame on the bag, the deck's calls it answers (its buttons'
 *  bindings: "systems.ADIRSControlPanel.irModeSw" …), its state set for a start. */
export interface NasalModule {
  readonly name: string;
  /** a frame [s] (its timers, its listeners: what changed since the last frame) */
  step(P: Props, dt: number): void;
  /** a Nasal call of the deck's (its function's path, its arguments): true if this module answers it */
  call?(fn: string, args: (number | string)[], P: Props): boolean;
  /** the bag set as FlightGear's state would be for this start */
  reset?(P: Props, state: StartState): void;
}
