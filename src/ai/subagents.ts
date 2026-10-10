// TARS's sub-agents (PLAN-TARS-AGENT B5): copies of him run in parallel, each on its own question — "the
// fuel to Mars and back", "the next window to the station", "is the entry corridor met" — with the tools that
// READ and COMPUTE only (the owner's decision: they analyse, TARS alone acts). The flight computer's planning
// tools run with nothing executed, one at a time (they share the planner). Their conclusions go back to
// TARS, who decides; the console shows each as it works.

import { Agent, type Action, type AgentMessage, type Complete, type Tool } from "./agent";

/** the tools a sub-agent may call: reading, and the planners computing without executing */
export const READ_TOOLS = new Set([
  "get_state",
  "get_telemetry",
  "list_places",
  "list_bodies",
  "get_weather",
  "weather_at",
  "find_eclipses",
  "eclipse_local",
  "iss_passes",
  "find_settings",
  "list_saves_and_scenes",
  "get_log",
  "get_flight_report",
  "list_keys",
  "plan_maneuver",
  "plan_mission",
]);
const PLANNERS = new Set(["plan_maneuver", "plan_mission"]);

export const SUBAGENTS_MAX = 4;
/** a sub-agent's steps at most */
const SUB_STEPS = 8;

export interface SubTask {
  name: string;
  question: string;
}

export interface SubResult {
  name: string;
  ok: boolean;
  text: string;
  actions: Action[];
}

export interface SubUpdate {
  name: string;
  state: "running" | "done" | "failed";
  /** its last action, or its conclusion */
  line: string;
}

export function subPrompt(lang: "fr" | "en"): string {
  return [
    "You are a sub-agent of TARS, the robot copilot of a space-flight game: an analyst, not a pilot.",
    "Answer the one question you are given with the tools: you may only read the game and work out figures (plan_maneuver and plan_mission compute without executing — always pass execute: false). You never act on the ship or the interface.",
    "Give your conclusion with its figures, in a few short lines; say what you could not determine.",
    `Write in ${lang === "fr" ? "French" : "English"}.`,
  ].join(" ");
}

/** The read-only copies of the tools: the planners forced to compute only, one at a time. */
export function readOnlyTools(tools: Tool[]): Tool[] {
  let chain: Promise<unknown> = Promise.resolve();
  return tools
    .filter((t) => READ_TOOLS.has(t.name))
    .map((t) =>
      PLANNERS.has(t.name)
        ? {
            ...t,
            run: (a, signal) => {
              const go = chain.then(() => t.run({ ...a, execute: false }, signal));
              chain = go.catch(() => {});
              return go;
            },
          }
        : t,
    );
}

/** The tasks run together: each sub-agent's conclusion. */
export async function runSubagents(
  tasks: SubTask[],
  complete: Complete,
  tools: Tool[],
  o: { lang: "fr" | "en"; context?: AgentMessage[]; signal?: AbortSignal; onUpdate?: (u: SubUpdate) => void },
): Promise<SubResult[]> {
  const ro = readOnlyTools(tools);
  return Promise.all(
    tasks.slice(0, SUBAGENTS_MAX).map(async (task): Promise<SubResult> => {
      o.onUpdate?.({ name: task.name, state: "running", line: "…" });
      const agent = new Agent(complete, () => ro);
      try {
        const r = await agent.turn([{ role: "system", content: subPrompt(o.lang) }, ...(o.context ?? [])], task.question, {
          signal: o.signal,
          maxSteps: SUB_STEPS,
          onCall: (tool) => o.onUpdate?.({ name: task.name, state: "running", line: tool }),
        });
        const text = r.text ?? (r.cut ? `(cut: ${r.cut})` : "(no conclusion)");
        o.onUpdate?.({ name: task.name, state: r.text ? "done" : "failed", line: text });
        return { name: task.name, ok: !!r.text, text, actions: r.actions };
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        o.onUpdate?.({ name: task.name, state: "failed", line: text });
        return { name: task.name, ok: false, text, actions: [] };
      }
    }),
  );
}
