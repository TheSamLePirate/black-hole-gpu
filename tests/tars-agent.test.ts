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

test("an order answered with nothing done: sent back once to act", async () => {
  const done: string[] = [];
  const tools: Tool[] = [{ name: "undo", description: "", run: () => (done.push("undo"), "back") }];
  const { complete, seen } = scripted([
    () => ({ content: "Cancelled." }),
    () => ({ content: null, tool_calls: [call("u", "undo", {})] }),
    () => ({ content: "Back as before." }),
  ]);
  const r = await new Agent(complete, () => tools).turn([], "cancel that", { unacted: () => "Nothing was done: act." });
  expect(done).toEqual(["undo"]);
  expect(r.text).toBe("Back as before.");
  expect(seen[1]!.at(-1)).toEqual({ role: "user", content: "Nothing was done: act." });
  // (once only: a second empty answer stands)
  const twice = scripted([() => ({ content: "Done." })]);
  const r2 = await new Agent(twice.complete, () => tools).turn([], "cancel", { unacted: () => "act" });
  expect(r2.text).toBe("Done.");
  expect(twice.seen.length).toBe(2);
});

test("his wakings: rules on events, timed rules, reflexes kept switched off, the budget", async () => {
  const { Triggers, REFLEXES, wakeText } = await import("../src/ai/triggers");
  const { Budget } = await import("../src/ai/budget");
  let now = 1_000_000;
  let kept: import("../src/ai/triggers").Trigger[] | null = null;
  const st = { get: () => kept, set: (t: never[]) => ((kept = structuredClone(t)), true), clear: () => void (kept = null) };
  const T = new Triggers(st as never, () => now);
  expect(T.list().length).toBe(REFLEXES.length);
  // (an autopilot that ended: its reflex; another mode: none)
  expect(T.match({ kind: "autopilot", to: "none" }).map((r) => r.id)).toEqual(["reflex-autopilot-end"]);
  expect(T.match({ kind: "autopilot", to: "land" })).toEqual([]);
  const burn = T.add({ on: { kind: "hub_step" }, prompt: "Call out each hub step." });
  const tick = T.add({ on: { kind: "every", minutes: 5 }, prompt: "Fuel check." });
  const soon = T.add({ on: { kind: "in", seconds: 30 }, prompt: "Remind me." });
  expect(T.match({ kind: "hub_step", to: "coast" }).map((r) => r.id)).toEqual([burn.id]);
  expect(T.due(0)).toEqual([]);
  now += 31_000;
  expect(T.due(0).map((r) => r.id)).toEqual([soon.id]);
  T.fired(soon.id);
  expect(T.list().some((r) => r.id === soon.id)).toBe(false);
  now += 5 * 60_000;
  expect(T.due(0).map((r) => r.id)).toEqual([tick.id]);
  // (a reflex switched off stays off after a reload; a rule of his kept)
  T.remove("reflex-entry");
  const again = new Triggers(st as never, () => now);
  expect(again.list().find((r) => r.id === "reflex-entry")!.enabled).toBe(false);
  expect(again.list().some((r) => r.id === burn.id)).toBe(true);
  again.clear();
  expect(again.list().every((r) => r.reflex && r.enabled)).toBe(true);
  expect(wakeText([again.list()[0]!], { kind: "autopilot", from: "node", to: "none" })).toContain("autopilot node → none");
  // (two rules one event woke: one waking, both asked)
  const both = wakeText([again.list()[0]!, again.list()[1]!], { kind: "entry_phase", to: "glide" });
  expect(both).toContain('reflex "reflex-autopilot-end", reflex "reflex-entry"');
  expect(both).toContain("1) ");
  // (the budget: a ceiling an hour, a gap between two wakings)
  const B = new Budget(
    () => 0.01,
    () => 20_000,
    () => now,
  );
  expect(B.canWake()).toBe(true);
  B.woke();
  expect(B.why()).toBe("gap");
  now += 21_000;
  B.add(0.012);
  expect(B.why()).toBe("budget");
  now += 3_601_000;
  expect(B.canWake()).toBe(true);
});

test("sub-agents: in parallel, reading only, the planners computing without executing", async () => {
  const { runSubagents, readOnlyTools } = await import("../src/ai/subagents");
  const ran: string[] = [];
  const tools: Tool[] = [
    { name: "get_state", description: "", run: () => (ran.push("get_state"), { fuel: 0.6 }) },
    {
      name: "plan_mission",
      description: "",
      params: { target: { type: "string" }, execute: { type: "boolean" } },
      run: (a) => (ran.push(`plan:${a.execute}`), { dv: 3900 }),
    },
    { name: "autopilot", description: "", run: () => (ran.push("autopilot"), "engaged") },
  ];
  expect(readOnlyTools(tools).map((t) => t.name)).toEqual(["get_state", "plan_mission"]);
  // (each sub-agent: its calls, then its conclusion — an act it tries refused as unknown)
  const complete: Complete = async (m, fns) => {
    expect(fns.map((f) => f.function.name)).not.toContain("autopilot");
    const q = (m.at(-1)!.role === "tool" ? m.find((x) => x.role === "user") : m.at(-1))!.content as string;
    const tools = m.filter((x) => x.role === "tool").length;
    if (!tools)
      return {
        content: null,
        tool_calls: /fuel/.test(q)
          ? [{ id: "a", function: { name: "get_state", arguments: "{}" } }]
          : [
              { id: "b", function: { name: "plan_mission", arguments: '{"target":"Mars","execute":true}' } },
              { id: "c", function: { name: "autopilot", arguments: "{}" } },
            ],
      };
    return { content: /fuel/.test(q) ? "60 % left." : "3.9 km/s to Mars." };
  };
  const ups: string[] = [];
  const r = await runSubagents(
    [
      { name: "fuel", question: "How much fuel?" },
      { name: "mars", question: "Δv to Mars?" },
    ],
    complete,
    tools,
    { lang: "en", onUpdate: (u) => ups.push(`${u.name}:${u.state}`) },
  );
  expect(r.map((x) => [x.name, x.ok, x.text])).toEqual([
    ["fuel", true, "60 % left."],
    ["mars", true, "3.9 km/s to Mars."],
  ]);
  // (the planner forced to compute; the autopilot never run)
  expect(ran.sort()).toEqual(["get_state", "plan:false"]);
  expect(r[1]!.actions.find((a) => a.tool === "autopilot")!.ok).toBe(false);
  expect(ups).toContain("fuel:done");
});
