// The page's side of the flight planner's worker (plan-worker.ts): requests answered as promises;
// without a worker (tests, an old browser), the same work done here, at once.

import { runPlan, type PlanRequest } from "./plan-worker";
import { ephemerisUrls } from "./ephemeris-files";
import { t } from "../i18n";

type Req = PlanRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;
type Answer = (r: unknown) => void;

let worker: Worker | null = null;
let failed = false;
let next = 1;
const waiting = new Map<number, Answer>();

/**
 * Requests the worker runs one at a time, latest first: a job cannot be interrupted there, so while one
 * runs — even past its time limit, already answered with an error — the requests made meanwhile are
 * not queued behind it: only the latest waits, the ones it replaces are answered at once.
 */
export class LatestOnly<J extends { answer: Answer }> {
  private running = false;
  private next: J | null = null;
  constructor(
    private readonly start: (job: J) => void,
    private readonly replaced: () => unknown,
  ) {}
  submit(job: J) {
    if (!this.running) {
      this.running = true;
      return this.start(job);
    }
    this.next?.answer(this.replaced());
    this.next = job;
  }
  /** the running job came back (in time or not): the latest request starts */
  done() {
    const job = this.next;
    this.next = null;
    this.running = job !== null;
    if (job) this.start(job);
  }
  /** no worker any more: the waiting request answered with `r` */
  fail(r: unknown) {
    this.next?.answer(r);
    this.next = null;
    this.running = false;
  }
}

/** the wormhole's segmented prediction (predictPath asks it twice a second): its running job's id */
let wormholeJob: number | null = null;
const wormhole = new LatestOnly<{ q: Req; id: number; answer: Answer }>(
  (job) => {
    wormholeJob = job.id;
    // (an answer within 15 s, else an error — the worker's job runs on, the next one after it)
    const timeout = setTimeout(() => {
      waiting.delete(job.id);
      job.answer({ error: t("Wormhole prediction timed out") });
    }, 15000);
    waiting.set(job.id, (r) => {
      clearTimeout(timeout);
      job.answer(r);
    });
    worker?.postMessage({ ...job.q, id: job.id });
  },
  () => ({ error: t("Wormhole prediction replaced by a newer one") }),
);

function getWorker(): Worker | null {
  if (worker || failed || typeof Worker === "undefined" || typeof location === "undefined") return worker;
  try {
    worker = new Worker(new URL("plan-worker.js", location.href), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; result: unknown }>) => {
      const f = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      f?.(e.data.result);
      if (e.data.id === wormholeJob) {
        wormholeJob = null;
        wormhole.done();
      }
    };
    // (the ephemerides first: the worker answers once they are in — the page's files)
    worker.postMessage({ kind: "ephemeris", urls: ephemerisUrls() });
    worker.onerror = () => {
      // (no worker there: answer what waits here, and from now on)
      failed = true;
      worker = null;
      for (const [id, f] of waiting) f({ error: `Planner worker unavailable (${id})` });
      waiting.clear();
      wormholeJob = null;
      wormhole.fail({ error: "Planner worker unavailable" });
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
    const answer = resolve as Answer;
    if (q.kind === "wormholePath") return wormhole.submit({ q, id, answer });
    waiting.set(id, answer);
    w.postMessage({ ...q, id });
  });
}
