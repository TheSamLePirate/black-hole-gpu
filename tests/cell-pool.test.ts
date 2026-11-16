import { expect, test } from "bun:test";
import { type CellExecutor, CellPool, type CellPrepared, type CellStore, type CellWant } from "../src/system/cell-pool";

// PLAN-J8 J8-3 — the building cells' pool (src/system/cell-pool.ts), with a fake executor: the order (in view and near, the track, the
// reserve behind, the rest; the nearest first within a class), the workers' bound, the prepared cache looked in first, a want dropped
// from the queue and its work under way cancelled, the queue's bound, a cell handed once.

/** a fake executor: `size` at once, each cell's work resolved by the test (or at once) */
function fake(size: number) {
  const started: string[] = [];
  const pending = new Map<string, { ok: () => void; signal: AbortSignal }>();
  const exec: CellExecutor = {
    size,
    run: (x, y, signal) =>
      new Promise((ok, no) => {
        const k = `${x}/${y}`;
        started.push(k);
        signal.addEventListener("abort", () => no(new Error("aborted")));
        pending.set(k, { ok: () => ok({ buf: new ArrayBuffer(64), ms: 3 }), signal });
      }),
  };
  return { exec, started, pending, finish: (k: string) => pending.get(k)?.ok() };
}
const W = (x: number, priority: 0 | 1 | 2 | 3, d: number): CellWant => ({ x, y: 0, priority, d });
const tick = () => new Promise((r) => setTimeout(r, 0));

test("the order: the class first (view, track, behind, rest), the nearest within it; the workers' bound", async () => {
  const f = fake(2);
  const pool = new CellPool(f.exec);
  pool.want([W(1, 3, 10), W(2, 1, 900), W(3, 0, 500), W(4, 0, 100), W(5, 2, 50)]);
  await tick();
  // (two workers: the view's two, nearest first)
  expect(f.started).toEqual(["4/0", "3/0"]);
  f.finish("4/0");
  await tick();
  await tick();
  expect(f.started).toEqual(["4/0", "3/0", "2/0"]);
  f.finish("3/0");
  f.finish("2/0");
  await tick();
  await tick();
  expect(f.started.slice(3)).toEqual(["5/0", "1/0"]);
});

test("no longer wanted: dropped from the queue, its work under way cancelled; a cell handed once", async () => {
  const f = fake(1);
  const got: CellPrepared[] = [];
  const pool = new CellPool(f.exec);
  pool.listen((c) => got.push(c));
  pool.want([W(1, 0, 1), W(2, 0, 2), W(3, 0, 3)]);
  await tick();
  expect(f.started).toEqual(["1/0"]);
  // (the view turned: 1 and 2 no longer wanted — 1's work cancelled, 2 dropped —, 4 wanted)
  pool.want([W(3, 0, 3), W(4, 0, 1)]);
  await tick();
  await tick();
  expect(f.pending.get("1/0")!.signal.aborted).toBe(true);
  expect(pool.stats().cancelled).toBe(1);
  // (2, queued, left the wanted set: dropped once)
  expect(pool.stats().dropped).toBe(1);
  expect(f.started).toEqual(["1/0", "4/0"]);
  f.finish("4/0");
  await tick();
  await tick();
  f.finish("3/0");
  await tick();
  await tick();
  expect(got.map((c) => c.x)).toEqual([4, 3]);
  // (wanted again: handed already, not prepared again)
  pool.want([W(3, 0, 3), W(4, 0, 1)]);
  await tick();
  expect(f.started).toEqual(["1/0", "4/0", "3/0"]);
});

test("the prepared cache first: a cell found there handed without a worker", async () => {
  const f = fake(1);
  const store: CellStore = { get: async (x) => (x === 7 ? new ArrayBuffer(112) : null) };
  const got: CellPrepared[] = [];
  const pool = new CellPool(f.exec, store);
  pool.listen((c) => got.push(c));
  pool.want([W(7, 0, 1), W(8, 0, 2)]);
  for (let i = 0; i < 6; i++) await tick();
  expect(got[0]).toMatchObject({ x: 7, cached: true });
  expect(f.started).toEqual(["8/0"]);
  expect(pool.stats().cached).toBe(1);
});

test("the queue's bound: the wanted beyond it wait for the next want (a gauge, not dropped)", async () => {
  const f = fake(1);
  const pool = new CellPool(f.exec, null, { maxQueue: 3 });
  const list = Array.from({ length: 10 }, (_, i) => W(i, 0, i));
  pool.want(list);
  await tick();
  let s = pool.stats();
  expect(s.running).toBe(1);
  expect(s.queued).toBe(3);
  expect(s.beyond).toBe(6);
  expect(s.dropped).toBe(0);
  // (the same list wanted again and again — J8-4's every 2 s —: nothing dropped)
  for (let k = 0; k < 5; k++) pool.want(list);
  await tick();
  s = pool.stats();
  expect(s.dropped).toBe(0);
  expect(s.beyond).toBe(6);
});
