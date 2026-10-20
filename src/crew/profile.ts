// The console's profile (PLAN-VAISSEAUX K2): the craft followed chooses it — the F-35's tactical console or the
// spacecraft's — its views in their order, its strip's tiles, its theme. Pure: the snapshot in, the profile out.
import type { InstrumentSnapshot } from "../net/instruments";

export type CrewProfile = "jet" | "space";

export type CrewView =
  | "air"
  | "dash"
  | "pfd"
  | "nd"
  | "map"
  | "globe"
  | "radar"
  | "schematic"
  | "plan"
  | "telemetry"
  | "sdash"
  | "orbit"
  | "system"
  | "navball"
  | "dock"
  | "budget"
  | "eecom"
  | "timeline"
  | "rel"
  | "ground";

/** The craft's profile: its own word (the K1 block), else the families it opens (an older pilot's snapshot). */
export function profileOf(s: Pick<InstrumentSnapshot, "craft" | "caps" | "sys"> | null | undefined): CrewProfile {
  if (s?.craft) return s.craft.kind === "jet" ? "jet" : "space";
  if (s?.caps?.fam.includes("weapons") || s?.sys?.engine === "F135") return "jet";
  if (s?.caps?.fam.includes("space")) return "space";
  return "jet";
}

/** Each profile's views, in their order: the F-35's tactical first (its mission, its flight, its sensors), the
 *  spacecraft's its orbit and its flight computer. */
export const PROFILE_VIEWS: Record<CrewProfile, CrewView[]> = {
  jet: ["air", "pfd", "nd", "radar", "map", "globe", "dash", "plan", "schematic", "telemetry"],
  space: ["sdash", "orbit", "system", "navball", "dock", "budget", "eecom", "timeline", "rel", "ground", "globe", "telemetry"],
};

export type TileKey =
  | "alt"
  | "speed"
  | "vz"
  | "mach"
  | "g"
  | "hdg"
  | "fuel"
  | "agl"
  | "dv"
  | "prop"
  | "pe"
  | "ap"
  | "period"
  | "next"
  | "dtau"
  | "link";

export const PROFILE_TILES: Record<CrewProfile, TileKey[]> = {
  jet: ["alt", "speed", "vz", "mach", "g", "hdg", "fuel", "agl"],
  space: ["dv", "prop", "pe", "ap", "period", "next", "g", "dtau", "link"],
};

/** A view of another profile asked for (a link, a stored choice): the profile's first. */
export const viewIn = (p: CrewProfile, v: CrewView): CrewView => (PROFILE_VIEWS[p].includes(v) ? v : PROFILE_VIEWS[p][0]!);
