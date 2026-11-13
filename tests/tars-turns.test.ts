import { expect, test } from "bun:test";
import { type MemoryData, TarsMemory } from "../src/ai/memory";
import { TarsAgent } from "../src/ai/tars-agent";

// TARS's turns (audit 2026-11-10, TA-01; wave 3.6): a question cut by a new one is over — its answer is the new
// question's. Before 13 Nov 2026 the cut turn came back as "the model failed" (null), and main.ts then ran the cut
// question's orders offline: « pose-nous à Edwards » interrupted by « vise Mars » still landed at Edwards.

/** a model that answers nothing until its turn is aborted (then fails, as a fetch aborted does) */
const hanging = {
  complete: (_m: unknown, _f: unknown, o: { signal?: AbortSignal }) =>
    new Promise<null>((res) => {
      if (o.signal?.aborted) return res(null);
      o.signal?.addEventListener("abort", () => res(null));
    }),
  chat: async () => null,
};
const agent = () => {
  let data: MemoryData | null = null;
  const memory = new TarsMemory({ get: () => data, set: (d: MemoryData) => void (data = d) } as never);
  return new TarsAgent({
    or: hanging as never,
    tools: () => [],
    memory,
    personality: () => ({ humour: 0.6, honesty: 0.9 }) as never,
    lang: () => "fr",
    flight: () => ({}) as never,
    say: () => {},
    onAction: () => {},
    onBusy: () => {},
  });
};

test("a turn cut by a new question: over, nothing to say — not « the model failed »", async () => {
  const A = agent();
  const first = A.ask("pose-nous à Edwards");
  await Bun.sleep(10);
  const second = A.ask("vise Mars");
  // (main.ts reads null as « answer offline »: the cut question's orders would run)
  expect(await first).toBe("");
  A.stop();
  expect(await second).toBe("");
});

test("a waking (TA-06): a few steps at most, its budget looked at before each — not the pilot's 24, checked once", async () => {
  let calls = 0;
  let spent = 0;
  // (a model that calls a tool at every step, each step costing 0.01 $)
  const looping = {
    complete: async () => {
      calls++;
      spent += 0.01;
      return { content: null, tool_calls: [{ id: `c${calls}`, type: "function", function: { name: "look", arguments: "{}" } }] };
    },
    chat: async () => null,
    get spent() {
      return spent;
    },
  };
  let data: MemoryData | null = null;
  const memory = new TarsMemory({ get: () => data, set: (d: MemoryData) => void (data = d) } as never);
  const A = new TarsAgent({
    or: looping as never,
    tools: () => [{ name: "look", description: "", run: () => "nothing" }] as never,
    memory,
    personality: () => ({ humour: 0.6, honesty: 0.9 }) as never,
    lang: () => "en",
    flight: () => ({}) as never,
    say: () => {},
    onAction: () => {},
    onBusy: () => {},
  });
  // (a budget of 0.035 $ left for the hour: three steps' worth)
  await A.ask("the fuel check", { wake: { left: () => 0.035 - spent } });
  console.log(`  a waking ran ${calls} steps`);
  expect(calls).toBeLessThanOrEqual(4);
  calls = 0;
  spent = 0;
  // (with budget to spare: still a waking's few steps, not 24)
  await A.ask("the fuel check", { wake: { left: () => 10 } });
  console.log(`  with budget to spare: ${calls} steps`);
  expect(calls).toBeLessThanOrEqual(6);
});

test("a waking in the memory (TA-16): a silent one not kept, the others as one line — not as the pilot's 600 characters", async () => {
  const { wakeText } = await import("../src/ai/triggers");
  let answer = "—";
  const talking = {
    complete: async () => ({ content: answer, tool_calls: undefined }),
    chat: async () => null,
    spent: 0,
  };
  let data: MemoryData | null = null;
  const memory = new TarsMemory({ get: () => data, set: (d: MemoryData) => void (data = d) } as never);
  const A = new TarsAgent({
    or: talking as never,
    tools: () => [],
    memory,
    personality: () => ({ humour: 0.6, honesty: 0.9 }) as never,
    lang: () => "en",
    flight: () => ({}) as never,
    say: () => {},
    onAction: () => {},
    onBusy: () => {},
  });
  const rule = {
    id: "fuel",
    reflex: true,
    on: { kind: "fuel" },
    prompt: "Check the fuel against the plan and warn the pilot if the reserve will be short. ".repeat(7),
  };
  const q = wakeText([rule] as never, { kind: "fuel", to: "low", detail: "12 % left" } as never);
  expect(q.length).toBeGreaterThan(500);
  // three silent wakings: nothing kept
  for (let i = 0; i < 3; i++) await A.ask(q, { wake: { left: () => 10 } });
  expect(memory.turns.length).toBe(0);
  // one that speaks: kept as one short line, what woke him
  answer = "Fuel at 12 %: the reserve holds to Edwards.";
  await A.ask(q, { wake: { left: () => 10 } });
  expect(memory.turns.length).toBe(1);
  const t = memory.turns[0]!;
  expect(t.user.length).toBeLessThan(200);
  expect(t.user).toContain('reflex "fuel"');
  expect(t.user).toContain("12 % left");
  expect(t.tars).toBe(answer);
  // the pilot's own question: kept word for word, as before
  await A.ask("how much fuel?");
  expect(memory.turns.at(-1)!.user).toBe("how much fuel?");
});

test("a waking (no pilot speaking) cannot do what cannot be undone — Sam's decision of 13 Nov 2026 (TA-06, TA-11)", async () => {
  let deleted = 0;
  const tools = [
    {
      name: "saves",
      description: "",
      params: { action: { type: "string" as const }, name: { type: "string" as const }, confirm: { type: "boolean" as const } },
      guarded: (a: Record<string, unknown>) => a.action === "delete",
      run: () => (deleted++, "deleted"),
    },
  ];
  let n = 0;
  const deleting = {
    complete: async () =>
      n++ % 2 === 0
        ? {
            content: null,
            tool_calls: [
              {
                id: `d${n}`,
                type: "function",
                function: { name: "saves", arguments: '{"action":"delete","name":"Campaign","confirm":true}' },
              },
            ],
          }
        : { content: "Fait." },
    chat: async () => null,
    spent: 0,
  };
  let data: MemoryData | null = null;
  const memory = new TarsMemory({ get: () => data, set: (d: MemoryData) => void (data = d) } as never);
  const A = new TarsAgent({
    or: deleting as never,
    tools: () => tools as never,
    memory,
    personality: () => ({ humour: 0.6, honesty: 0.9 }) as never,
    lang: () => "fr",
    flight: () => ({}) as never,
    say: () => {},
    onAction: () => {},
    onBusy: () => {},
  });
  // woken by a rule: refused
  await A.ask('[Woken by your rule "tidy" — every. No pilot is speaking: this is your own initiative.] Delete old saves.', {
    wake: { left: () => 10 },
  });
  expect(deleted).toBe(0);
  expect(A.last.find((a) => a.tool === "saves")?.ok).toBe(false);
  // the pilot asking it himself: done
  await A.ask("Supprime la sauvegarde Campaign, je confirme.");
  expect(deleted).toBe(1);
});

test("his answer said as he writes it (TA-04): each whole sentence at once, the rest at the end — none when it may be sent back", async () => {
  let parts = ["[actions: none] Orbite ", "stable. Je vise", " la Lune. Le carburant", " tient."];
  let calls = 0;
  const streaming = {
    complete: async (_m: unknown, _f: unknown, o: { onText?: (t: string) => void }) => {
      calls++;
      let soFar = "";
      for (const p of parts) {
        soFar += p;
        o.onText?.(soFar);
      }
      return { content: soFar, tool_calls: undefined };
    },
    chat: async () => null,
    spent: 0,
  };
  let data: MemoryData | null = null;
  const memory = new TarsMemory({ get: () => data, set: (d: MemoryData) => void (data = d) } as never);
  const A = new TarsAgent({
    or: streaming as never,
    tools: () => [],
    memory,
    personality: () => ({ humour: 0.6, honesty: 0.9 }) as never,
    lang: () => "fr",
    flight: () => ({}) as never,
    say: () => {},
    onAction: () => {},
    onBusy: () => {},
  });
  const said: string[] = [];
  const text = await A.ask("Où en est-on ?", { sentence: (s) => said.push(s) });
  expect(said).toEqual(["Orbite stable.", "Je vise la Lune."]);
  expect(text).toBe("Orbite stable. Je vise la Lune. Le carburant tient.");
  expect(A.unspoken(text!)).toBe("Le carburant tient.");
  // a second question answered the same way: said again as it comes, not taken for the first's (found live, 13 Nov 2026)
  const again: string[] = [];
  const text2 = await A.ask("Et maintenant ?", { sentence: (s) => again.push(s) });
  expect(again).toEqual(["Orbite stable.", "Je vise la Lune."]);
  expect(A.unspoken(text2!)).toBe("Le carburant tient.");
  // an order answered with nothing done is sent back once (« nothing done »): that first answer never said; the second may be
  parts = ["J'ai visé Mars. ", "C'est fait."];
  const said2: string[] = [];
  calls = 0;
  const second = ["Je vise Mars maintenant. ", "Voilà."];
  const real = streaming.complete;
  streaming.complete = async (m, f, o) => {
    if (calls === 1) parts = second;
    return real(m, f, o);
  };
  await A.ask("Vise Mars.", { sentence: (s) => said2.push(s) });
  expect(calls).toBe(2);
  expect(said2).not.toContain("J'ai visé Mars.");
  expect(said2).toEqual(["Je vise Mars maintenant."]);
});
