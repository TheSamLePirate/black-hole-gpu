// TARS's tools sent by context (audit 2026-11-10, TA-04): every step sends his prompt and his tools (72, ≈ 77 000 characters);
// three groups seldom needed together — the aircraft's own, the sky and photography's, the wider world's — are sent only when
// the context asks them (an aircraft flown, on foot, the photo mode) or when he asks for them himself (`more_tools`). Measured
// (13 Nov 2026, GLM, cached, in session): 44 tools against 72 — the first token 1 303 against 1 735 ms (median), a step
// 0.00066 against 0.00098 $. A group sent stays sent for the session: the tools' list then changes seldom, and the provider's
// cache of it (TA-04 lot 1: a list changed is a step at full price) holds.

import type { Tool } from "./agent";

export const TOOL_GROUPS = {
  aircraft: {
    tools: ["f35", "flight_lead", "traffic", "weapons", "jet_autopilot", "jet_mode", "approach", "carrier", "flight_plan", "lesson", "pcd"],
    about:
      "the F-35's and the A320's own: their flights and flight school, the flight lead and wingmen, the traffic about us, the weapons and radar, the jet autopilot and its modes, approaches, the carriers, the flight plan, lessons, the panoramic display",
  },
  sky: {
    tools: [
      "multiple_exposure",
      "find_eclipses",
      "go_see_eclipse",
      "eclipse_local",
      "iss_passes",
      "observe",
      "sky_events",
      "video",
      "capture",
    ],
    about:
      "the sky and photography: multiple exposures (analemma, star trails…), eclipses found and gone to, the ISS's passes, the observatory, sky events, videos and captures",
  },
  world: {
    // (his sub-agents and skills are his own ways of working: always sent — the e2e of his console found them missing)
    tools: ["character", "offline_zones", "room", "mission", "weather_at"],
    about:
      "on foot (the explorer), the offline zones, the network room and its fleet, missions (listed, created, flown), the real weather anywhere at any date",
  },
} as const;
export type ToolGroup = keyof typeof TOOL_GROUPS;
export const GROUP_NAMES = Object.keys(TOOL_GROUPS) as ToolGroup[];

/** the group a tool belongs to (none: always sent) */
export function groupOf(name: string): ToolGroup | null {
  for (const g of GROUP_NAMES) if ((TOOL_GROUPS[g].tools as readonly string[]).includes(name)) return g;
  return null;
}

/** The tools sent: those of no group, and those of the groups loaded — in their own order (the cache's prefix the same). */
export function loadedTools(all: Tool[], loaded: ReadonlySet<ToolGroup>): Tool[] {
  return all.filter((t) => {
    const g = groupOf(t.name);
    return !g || loaded.has(g);
  });
}

/** The tool that loads a group for the rest of the session — his own way to every tool. */
export function moreTools(loaded: Set<ToolGroup>): Tool {
  return {
    name: "more_tools",
    description: `More of your tools, for the rest of the session: a group loaded — ${GROUP_NAMES.map((g) => `${g} (${TOOL_GROUPS[g].about})`).join("; ")}. Call it when the tool you need is not in your list; its tools come with your next step.`,
    params: { group: { type: "string", enum: [...GROUP_NAMES] } },
    required: ["group"],
    run: (a) => {
      const g = a.group as ToolGroup;
      if (loaded.has(g)) return `${g}: already loaded`;
      loaded.add(g);
      return `${g} loaded: ${TOOL_GROUPS[g].tools.join(", ")} — in your next step`;
    },
  };
}
