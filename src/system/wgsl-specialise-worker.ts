// The tracer's source specialised off the page's thread (T8b — docs/PLAN-REFRACTION-HORIZONS.md T8, the analysis's §8.3: "no new
// shader blocks the flight"): a features key's constants folded and the dead functions pruned (wgsl-specialise.ts) took 40 ms
// of the page's thread when a variant was asked in flight — a long task. The composed source sent once, then a request a
// variant: its code back. Built on its own (server.ts, scripts/build-pages.ts, package.json) as wgsl-specialise-worker.js.
import { WgslSpecialiser } from "./wgsl-specialise";

type Ask = { op: "source"; code: string } | { op: "specialise"; id: number; constants: Record<string, number>; entry: string };
const g = globalThis as unknown as {
  onmessage: ((e: MessageEvent<Ask>) => void) | null;
  postMessage(m: { id: number; code?: string; ms: number; error?: string }): void;
};
let specialiser: WgslSpecialiser | null = null;
g.onmessage = (e) => {
  const q = e.data;
  if (q.op === "source") {
    specialiser = new WgslSpecialiser(q.code);
    return;
  }
  const t0 = performance.now();
  try {
    if (!specialiser) throw new Error("no source");
    g.postMessage({ id: q.id, code: specialiser.specialise(q.constants, q.entry), ms: performance.now() - t0 });
  } catch (err) {
    g.postMessage({ id: q.id, ms: performance.now() - t0, error: String(err) });
  }
};
