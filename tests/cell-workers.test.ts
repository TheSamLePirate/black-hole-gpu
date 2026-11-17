import { afterAll, beforeAll, expect, test } from "bun:test";

// The cell workers' executor (src/system/cell-workers.ts CellWorkers): disposed with a call under way, that call fails at once — never
// left pending (a zone's preparation stopped mid-way waits on no worker gone). A stand-in Worker that never answers.

class SilentWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  terminated = false;
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
}
const g = globalThis as unknown as { Worker?: unknown; location?: unknown };
const saved = { Worker: g.Worker, location: g.location };
beforeAll(() => {
  g.Worker = SilentWorker;
  g.location ??= { href: "http://localhost/" };
});
afterAll(() => {
  g.Worker = saved.Worker;
  g.location = saved.location;
});

test("a call under way fails when its workers are disposed", async () => {
  const { CellWorkers } = await import("../src/system/cell-workers");
  const w = new CellWorkers(1);
  const run = w.run(1, 2, new AbortController().signal);
  w.dispose();
  await expect(run).rejects.toThrow("disposed");
});
