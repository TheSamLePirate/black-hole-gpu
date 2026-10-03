// The HUD's view-model: what the instruments show, from the frame's figures — pure, shared by the
// HUD (its tapes, its ball) and the cockpit's screens, tested on its own. The mode decides the speed's
// reference: in the air and on the ground the surface's (or the air's), in space the body's, the
// target's on demand — a craft standing on the pad no longer reads the Earth's turn as its speed.

import type { FlightInfo } from "../../controller/telemetry";
import type { FlightPhase } from "../../game/phase";
import { BODY_NAMES } from "../../targeting";
import { C_MPS } from "../../units";

/** The markers' and the speed's frame: the orbit's, the surface's, the target's, the hole's. */
export type HudMode = "ORB" | "SRF" | "TGT" | "KERR";

type ModeInput = Pick<FlightInfo, "speedMode" | "region" | "landed" | "surface" | "air">;

export function hudMode(i: ModeInput, phase?: FlightPhase | null): HudMode {
  if (i.speedMode === "target") return "TGT";
  if (i.region === "hole") return "KERR";
  if (phase) {
    if (phase.mode === "landed") return "SRF";
    if (phase.stage && (["air", "entry", "approach", "ground"] as const).includes(phase.stage as "air")) return "SRF";
    return "ORB";
  }
  // (no phase known — a cockpit screen drawn alone —: from the figures)
  return i.landed || i.surface?.landed || i.air?.inAir ? "SRF" : "ORB";
}

export interface ShownSpeed {
  /** the speed [c] */
  v: number;
  /** what it is relative to, in words */
  ref: string;
  mode: HudMode;
}

type SpeedInput = ModeInput & Pick<FlightInfo, "speed" | "target" | "ref">;

export function shownSpeed(i: SpeedInput, phase?: FlightPhase | null): ShownSpeed {
  const mode = hudMode(i, phase);
  const name = (b: string | null) => (b ? ((BODY_NAMES as Record<string, string>)[b] ?? b) : "");
  if (mode === "TGT") return { v: i.speed, ref: `rel. ${name(i.target)} (target)`, mode };
  if (mode === "SRF") {
    // (through the air while in it; over the ground on it, or below the air)
    if (i.air?.inAir && Number.isFinite(i.air.speed)) return { v: i.air.speed / C_MPS, ref: "air", mode };
    const sf = i.surface;
    if (sf && Number.isFinite(sf.vHor)) return { v: Math.hypot(sf.vHor, sf.vVert) / C_MPS, ref: "ground", mode };
  }
  return { v: i.speed, ref: i.ref ? `rel. ${name(i.ref)}` : "rel. ZAMO", mode };
}
