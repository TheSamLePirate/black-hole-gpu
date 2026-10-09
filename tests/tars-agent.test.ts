import { expect, test } from "bun:test";
import { Agent, actionLine, type AgentMessage, type Complete, type Tool } from "../src/ai/agent";
import { TarsMemory, TURNS_KEPT, summaryPrompt, type MemoryData } from "../src/ai/memory";
import { checkArgs, toFunction, type ToolSpec } from "../src/ai/tool-schema";

// PLAN-TARS-AGENT TA1: TARS's agent — the tools' arguments checked against their schema, the turn's loop
// (calls run in order, their results handed back, errors said to the model, the bounds, a stop), his memory
// (kept, summarized past its budget, notes, cleared).

const AUTOPILOT: ToolSpec = {
  name: "autopilot",
  description: "Engage an autopilot",
  params: {
    mode: { type: "string", enum: ["none", "land", "takeoff"] },
    site: { type: "string" },
    altKm: { type: "number", minimum: 0, maximum: 1000 },
  },
  required: ["mode"],
};

test("arguments: parsed, checked against the schema, errors that say what is wrong", () => {
  expect(checkArgs(AUTOPILOT, '{"mode":"land","site":"Edwards"}')).toEqual({ ok: true, args: { mode: "land", site: "Edwards" } });
  expect(checkArgs(AUTOPILOT, { mode: "land", altKm: null })).toEqual({ ok: true, args: { mode: "land" } });
  const bad = (raw: unknown) => {
    const r = checkArgs(AUTOPILOT, raw);
    return r.ok ? "ok" : r.error;
  };
  expect(bad('{"mode":"fly"}')).toContain("one of none, land, takeoff");
  expect(bad("{}")).toBe("missing argument mode");
  expect(bad('{"mode":"land","speed":3}')).toContain("unknown argument speed");
  expect(bad('{"mode":"land","altKm":5000}')).toContain("≤ 1000");
  expect(bad('{"mode":"land","altKm":"high"}')).toContain("finite number");
  expect(bad("{mode: land")).toContain("not valid JSON");
  expect(bad("[1]")).toContain("JSON object");
  // (nested objects and arrays)
  const nested: ToolSpec = {
    name: "n",
    description: "",
    params: { burns: { type: "array", maxItems: 2, items: { type: "object", properties: { dv: { type: "number" } }, required: ["dv"] } } },
  };
  expect(checkArgs(nested, { burns: [{ dv: 3 }] }).ok).toBe(true);
  const r = checkArgs(nested, { burns: [{ dv: 3 }, {}] });
  expect(r.ok ? "" : r.error).toBe("missing argument burns[1].dv");
  // (the function format the chat wants)
  const f = toFunction(AUTOPILOT);
  expect(f.type).toBe("function");
  expect(f.function.parameters.required).toEqual(["mode"]);
  expect(f.function.parameters.additionalProperties).toBe(false);
});

/** A model scripted step by step; what it was sent kept. */
function scripted(steps: ((m: AgentMessage[]) => Awaited<ReturnType<Complete>>)[]) {
  const seen: AgentMessage[][] = [];
  let i = 0;
  const complete: Complete = async (m) => {
    seen.push(structuredClone(m));
    const s = steps[Math.min(i++, steps.length - 1)]!;
    return s(m);
  };
  return { complete, seen };
}

const call = (id: string, name: string, args: object) => ({
  id,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

test("a turn: the calls run in order, their results handed back, the words at the end", async () => {
  const done: string[] = [];
  const tools: Tool[] = [
    { ...AUTOPILOT, run: (a) => (done.push(`ap:${a.mode}`), { engaged: a.mode }) },
    {
      name: "gear",
      description: "Gear",
      params: { down: { type: "boolean" } },
      required: ["down"],
      run: (a) => (done.push(`gear:${a.down}`), "gear down"),
    },
    {
      name: "broken",
      description: "Always fails",
      run: () => {
        throw new Error("no runway in sight");
      },
    },
  ];
  const { complete, seen } = scripted([
    () => ({
      content: "Gear, then the autopilot.",
      tool_calls: [call("a", "gear", { down: true }), call("b", "autopilot", { mode: "land" })],
    }),
    () => ({ content: null, tool_calls: [call("c", "broken", {}), call("d", "autopilot", { mode: "fly" }), call("e", "nope", {})] }),
    () => ({ content: "Gear down, landing autopilot engaged." }),
  ]);
  const steps: string[] = [];
  const agent = new Agent(complete, () => tools);
  const r = await agent.turn([{ role: "system", content: "You are TARS" }], "land us", { onStep: (s) => steps.push(s) });
  expect(r.text).toBe("Gear down, landing autopilot engaged.");
  expect(r.cut).toBeNull();
  expect(done).toEqual(["gear:true", "ap:land"]);
  expect(steps).toEqual(["Gear, then the autopilot."]);
  expect(r.actions.map((a) => [a.tool, a.ok])).toEqual([
    ["gear", true],
    ["autopilot", true],
    ["broken", false],
    ["autopilot", false],
    ["nope", false],
  ]);
  // (the model saw each result, by its call's id, errors included)
  const last = seen[2]!;
  const toolMsgs = last.filter((m) => m.role === "tool") as { tool_call_id: string; content: string }[];
  expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["a", "b", "c", "d", "e"]);
  expect(toolMsgs[1]!.content).toBe('{"engaged":"land"}');
  expect(toolMsgs[2]!.content).toContain("no runway in sight");
  expect(toolMsgs[3]!.content).toContain("one of none, land, takeoff");
  expect(toolMsgs[4]!.content).toContain("no tool named nope");
  expect(actionLine(r.actions[1]!)).toBe('autopilot(mode=land) → {"engaged":"land"}');
});

test("a turn's bounds: its steps, a stop; a failed model is no answer", async () => {
  const tools: Tool[] = [{ name: "look", description: "", run: () => "nothing" }];
  const loop = scripted([() => ({ content: null, tool_calls: [call("x", "look", {})] })]);
  const r = await new Agent(loop.complete, () => tools).turn([], "go on", { maxSteps: 3 });
  expect(r.cut).toBe("steps");
  expect(r.actions.length).toBe(3);
  // (stopped while a tool waits)
  const ctl = new AbortController();
  const waiting: Tool[] = [
    {
      name: "wait",
      description: "",
      run: (_, signal) =>
        new Promise((res) => {
          signal.addEventListener("abort", () => res("stopped"));
          setTimeout(() => ctl.abort(), 5);
        }),
    },
  ];
  const w = scripted([() => ({ content: null, tool_calls: [call("w", "wait", {})] })]);
  const s = await new Agent(w.complete, () => waiting).turn([], "wait", { signal: ctl.signal });
  expect(s.cut).toBe("stopped");
  const failed = await new Agent(
    async () => null,
    () => tools,
  ).turn([], "hello");
  expect(failed).toEqual({ text: null, actions: [], cut: null });
});

function memStore() {
  let d: MemoryData | null = null;
  return { get: () => d, set: (x: MemoryData) => ((d = structuredClone(x)), true), clear: () => void (d = null), peek: () => d };
}

test("memory: kept across visits, notes, summarized past its budget, cleared", async () => {
  const st = memStore();
  const m = new TarsMemory(st);
  expect(m.empty).toBe(true);
  m.add({ at: 0, user: "I'm Cooper", tars: "Noted, Cooper.", did: ["remember(note=pilot is Cooper) → kept"] });
  expect(m.remember("The pilot is called Cooper")).toBe(true);
  expect(m.remember("the pilot is called cooper")).toBe(true);
  expect(m.notes.length).toBe(1);
  // (a new visit: the same memory)
  const again = new TarsMemory(st);
  expect(again.turns.length).toBe(1);
  const ctx = again.context();
  expect(ctx[0]!.content).toContain("- The pilot is called Cooper");
  expect(ctx[1]).toEqual({ role: "user", content: "I'm Cooper" });
  expect(ctx[2]).toEqual({ role: "assistant", content: "Noted, Cooper." });
  expect(again.carry()).toContain("Tools you called in your last answer: remember(");
  // (past the budget: the oldest folded into the summary)
  for (let i = 0; i < TURNS_KEPT; i++) again.add({ at: i, user: `q${i}`, tars: `a${i}` });
  // (the actions of a turn noted before the next words, not in his own)
  expect(again.context()[3]!.content).toMatch(/^\(Tools you called in your last answer: remember\(.*\)\nq0$/s);
  expect(again.full).toBe(true);
  let folded = 0;
  await again.compact(async (prev, turns) => {
    folded = turns.length;
    expect(summaryPrompt(prev, turns)[1]!.content).toContain("Pilot: I'm Cooper");
    return "Cooper flies the Ranger; asked many questions.";
  });
  expect(again.turns.length).toBe(TURNS_KEPT / 2);
  expect(folded).toBe(TURNS_KEPT + 1 - TURNS_KEPT / 2);
  expect(again.context()[0]!.content).toContain("summary): Cooper flies the Ranger");
  // (offline: the oldest simply dropped, the memory bounded)
  for (let i = 0; i < TURNS_KEPT; i++) again.add({ at: i, user: `r${i}`, tars: `b${i}` });
  await again.compact(null);
  expect(again.turns.length).toBe(TURNS_KEPT / 2);
  expect(again.forget("cooper")).toBe(1);
  again.clear();
  expect(again.empty).toBe(true);
  expect(st.peek()).toBeNull();
  expect(new TarsMemory(st).empty).toBe(true);
});
