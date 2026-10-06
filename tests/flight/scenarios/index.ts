// Every scenario of the flight lab, by family (one file each: scripts/flightlab.ts list shows them all).
import type { Scenario } from "./helpers";
import { SMOKE } from "./smoke";

export type { Scenario, Verdict } from "./helpers";
export const SCENARIOS: Scenario[] = [...SMOKE];
