// Every scenario of the flight lab, by family (one file each: scripts/flightlab.ts list shows them all).
import { A320 } from "./a320";
import { A320_IFR } from "./a320-ifr";
import { AIRPORTS } from "./airports";
import { APPROACHES } from "./approaches";
import { DOCK } from "./dock";
import { GARGANTUA } from "./gargantua";
import type { Scenario } from "./helpers";
import { LANDING } from "./landing";
import { MISSIONS_FC } from "./missions";
import { ORBIT } from "./orbit";
import { SMOKE } from "./smoke";
import { VERTICAL } from "./vertical";
import { WEATHER } from "./weather";

export type { Scenario, Verdict } from "./helpers";
export const SCENARIOS: Scenario[] = [
  ...SMOKE,
  ...LANDING,
  ...WEATHER,
  ...AIRPORTS,
  ...APPROACHES,
  ...A320,
  ...A320_IFR,
  ...VERTICAL,
  ...ORBIT,
  ...MISSIONS_FC,
  ...DOCK,
  ...GARGANTUA,
];
