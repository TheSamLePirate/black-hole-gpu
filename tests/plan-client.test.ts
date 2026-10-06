import { expect, test } from "bun:test";
import { LatestOnly } from "../src/system/plan-client";

// The wormhole's prediction in the planner's worker: a job there cannot be interrupted, so the requests
// made while one runs (past its time limit too) must not pile up behind it — only the latest waits.

test("while a job runs only the latest request waits; the ones it replaces are answered at once", () => {
  const started: number[] = [];
  const answers = new Map<number, unknown>();
  const q = new LatestOnly<{ id: number; answer: (r: unknown) => void }>(
    (job) => started.push(job.id),
    () => "replaced",
  );
  const job = (id: number) => ({ id, answer: (r: unknown) => answers.set(id, r) });
  q.submit(job(1));
  // (job 1 timed out on the page, still running in the worker: 2, then 3, asked meanwhile)
  q.submit(job(2));
  q.submit(job(3));
  expect(started).toEqual([1]);
  expect(answers.get(2)).toBe("replaced");
  expect(answers.has(3)).toBe(false);
  q.done();
  expect(started).toEqual([1, 3]);
  q.done();
  q.submit(job(4));
  expect(started).toEqual([1, 3, 4]);
  // (the worker lost: what waits is answered)
  q.submit(job(5));
  q.fail("gone");
  expect(answers.get(5)).toBe("gone");
  q.submit(job(6));
  expect(started).toEqual([1, 3, 4, 6]);
});
