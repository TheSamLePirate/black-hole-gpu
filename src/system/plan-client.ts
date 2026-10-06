// The page's side of the flight planner's worker (plan-worker.ts): requests answered as promises;
// without a worker (tests, an old browser), the same work done here, at once.

import { runPlan, type PlanRequest } from "./plan-worker";
import { ephemerisUrls } from "./ephemeris-files";

type Req = PlanRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

let worker: Worker | null = null;
let failed = false;
let next = 1;
const waiting = new Map<number, (r: unknown) => void>();

function getWorker(): Worker | null {
  if (worker || failed || typeof Worker === "undefined" || typeof location === "undefined") return worker;
  try {
    worker = new Worker(new URL("plan-worker.js", location.href), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; result: unknown }>) => {
      const f = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      f?.(e.data.result);
    };
    // (the ephemerides first: the worker answers once they are in — the page's files)
    worker.postMessage({ kind: "ephemeris", urls: ephemerisUrls() });
    worker.onerror = () => {
      // (no worker there: answer what waits here, and from now on)
      failed = true;
      worker = null;
      for (const [id, f] of waiting) f({ error: `Planner worker unavailable (${id})` });
      waiting.clear();
    };
  } catch {
    failed = true;
    worker = null;
  }
  return worker;
}

/** Runs a planning request off the frame loop (or here, without a worker). */
export function plan<T>(q: Req): Promise<T> {
  const w = getWorker();
  const id = next++;
  if (!w) return Promise.resolve(runPlan({ ...q, id } as PlanRequest) as T);
  return new Promise<T>((resolve) => {
    const timeout =
      q.kind === "wormholePath"
        ? setTimeout(() => {
            waiting.delete(id);
            resolve({ error: "Wormhole prediction timed out" } as T);
          }, 15000)
        : null;
    waiting.set(id, (r) => {
      if (timeout !== null) clearTimeout(timeout);
      resolve(r as T);
    });
    w.postMessage({ ...q, id });
  });
}
