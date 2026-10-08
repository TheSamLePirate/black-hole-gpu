// Every scenario of the flight lab, by family (one file each: scripts/flightlab.ts list shows them all).
import { AIRPORTS } from "./airports";
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
  ...VERTICAL,
  ...ORBIT,
  ...MISSIONS_FC,
  ...DOCK,
  ...GARGANTUA,
];
