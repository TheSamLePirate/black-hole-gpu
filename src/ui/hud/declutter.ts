// What the HUD shows in each phase of the flight: one matrix, phase × element. In orbit the bank
// scale and the air data have nothing to say; on the final approach the orbital marks, the future and
// the burn clutter the runway; on the ground or docking the horizon and the future are noise. The
// player's switches (Settings › HUD aids) and the density key (²) still apply on top: an element is
// drawn when the phase, the switch and the data all allow it.

import type { FlightPhase, Stage } from "../../game/phase";

export type HudItem =
  | "horizon"
  | "heading"
  | "bank"
  | "markers"
  | "edge"
  | "future"
  | "path"
  | "impact"
  | "runway"
  | "hover"
  | "relativity"
  | "burn"
  | "dock"
  | "airData";

const ALL: HudItem[] = [
  "horizon",
  "heading",
  "bank",
  "markers",
  "edge",
  "future",
  "path",
  "impact",
  "runway",
  "hover",
  "relativity",
  "burn",
  "dock",
  "airData",
];

/** The elements each stage leaves out (everything else may show). */
const OUT: Record<Stage, HudItem[]> = {
  // (a craft in space about a world: no bank, no air data, no runway)
  orbit: ["bank", "airData", "runway", "hover", "relativity"],
  suborbital: ["bank", "airData", "hover", "relativity"],
  escape: ["bank", "airData", "runway", "hover", "relativity"],
  space: ["bank", "airData", "runway", "hover", "relativity"],
  // (in the air, entering it: the flight's own — the orbit's burns and the hole's clocks aside)
  air: ["relativity", "burn", "dock"],
  entry: ["relativity", "burn", "dock", "hover"],
  // (the final: the runway, the path vector, the air — nothing of the orbit)
  approach: ["markers", "future", "path", "impact", "relativity", "burn", "dock", "hover"],
  // (landed: where one is and which way one faces)
  ground: ["bank", "markers", "future", "path", "impact", "relativity", "burn", "airData", "dock"],
  // (docking: the port, the drift — no horizon, no future)
  docking: ["horizon", "heading", "bank", "future", "path", "impact", "runway", "hover", "relativity", "airData", "burn"],
  // (about the hole, in the throat: no world, so no horizon, heading, bank or air)
  kerr: ["horizon", "heading", "bank", "runway", "hover", "airData", "dock"],
  throat: ["horizon", "heading", "bank", "runway", "hover", "airData", "dock"],
};

/** Every element shown (no phase known yet: nothing withheld). */
const EVERYTHING = Object.fromEntries(ALL.map((k) => [k, true])) as Record<HudItem, boolean>;

/** The elements the phase lets the HUD draw. */
export function hudShown(p: FlightPhase | null): Record<HudItem, boolean> {
  const stage = p?.mode === "docked" ? "docking" : p?.mode === "landed" ? "ground" : p?.stage;
  if (!stage) return EVERYTHING;
  const out = new Set(OUT[stage]);
  return Object.fromEntries(ALL.map((k) => [k, !out.has(k)])) as Record<HudItem, boolean>;
}
