// The flight lab's scenarios (scripts/flightlab.ts flies them; docs/FLIGHTLAB.md): each a flight from a set
// state to a verdict — the autopilots, the flight computer's missions, the assistants, in our solar system and
// Gargantua's. A scenario boots its scene, sets the craft up by the automation (__bh), flies in phases (fixed
// steps for the long parts, live for the moments a player watches) and judges the end: what the autopilot was
// asked, measured (a touchdown's sink rate, a runway's axis, an orbit's apsides, a docking's speed).
import type { Lab } from "../lib/lab";

export interface Verdict {
  ok: boolean;
  why: string;
  metrics?: Record<string, unknown>;
}

export interface Scenario {
  id: string;
  title: string;
  tags: string[];
  /** its estimated wall time [min] (the shards' deal) */
  minutes: number;
  hash?: string;
  tiles?: boolean;
  run(lab: Lab): Promise<Verdict>;
}

// ---------------------------------------------------------------------------------------------- helpers

/** The calendar fixed (the station's and the fleet's scenes follow the real date), the scene loaded. */
export async function scene(lab: Lab, name: string, date = Date.UTC(2026, 9, 1, 12)) {
  await lab.js(`(__bh.setDate(${date}), __bh.game.preset(${JSON.stringify(name)}), true)`);
  await Bun.sleep(1500);
  await lab.rearm();
}

/** The Earth's physics relief in (one global map): what the runways are graded on. */
export async function earthRelief(lab: Lab) {
  await lab.app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 120_000);
}

/** An autopilot engaged (setAuto toggles: from none). */
export async function engage(lab: Lab, auto: string) {
  await lab.js(`(__bh.camera.pilot.auto = "none", __bh.camera.pilot.setAuto(${JSON.stringify(auto)}), __bh.camera.pilot.auto)`);
}

export const said = (lab: Lab, re: RegExp) => lab.events.find((e) => e.kind === "pilot" && re.test(e.text))?.text ?? null;

/** Stopped on a runway: on its axis, within its length. */
export function onRunway(lab: Lab, maxAcross = 45) {
  const w = lab.T.runway;
  return !!w && Math.abs(w.across) < maxAcross && w.along > 0 && w.along < 4500;
}
