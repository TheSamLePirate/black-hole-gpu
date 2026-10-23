// FlightGear's A320 Nasal systems ported (docs/PLAN-A320.md, A10), in the order its core.systemsInit starts them: the
// electrical's, the pneumatics', the hydraulics', the fuel's switches, the ADIRS, (the engines, their ignition and
// FADEC: the FADEC's own — ENGINE-START.md), the APU, the fire protection. Each a NasalModule on the systems' bag
// (../types.ts); the fire's knows the APU (its fire button, a fire on the ground stop it).

import type { NasalModule } from "../types";
import { Adirs } from "./adirs";
import { Apu } from "./apu";
import { Electrical } from "./electrical";
import { Fire } from "./fire";
import { Fuel } from "./fuel";
import { Hydraulics } from "./hydraulics";
import { Pneumatics } from "./pneumatics";

export { Adirs, calcAlignTime } from "./adirs";
export { APU_STATE, Apu } from "./apu";
export { Fire } from "./fire";

export interface NasalOptions {
  /** the APU turned by its module (engine[2]'s N1) — false if something else spools it */
  apuSpool?: boolean;
  /** the dice (the IRs' 20–25 s to the PFD, the fire loops burnt, the fires out): Math.random by default */
  rand?: () => number;
}

/** The Nasal systems, in FlightGear's order. */
export function nasalModules(o: NasalOptions = {}): NasalModule[] {
  const rand = o.rand ?? Math.random;
  const apu = new Apu(o.apuSpool ?? true);
  return [new Electrical(), new Pneumatics(), new Hydraulics(), new Fuel(), new Adirs(rand), apu, new Fire(apu, rand)];
}
