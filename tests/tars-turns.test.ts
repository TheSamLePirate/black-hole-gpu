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
