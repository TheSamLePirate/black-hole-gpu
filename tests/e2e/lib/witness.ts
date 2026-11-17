// A hung page dated (the approaches' session, 17 Nov 2026 — the big e2e's page went unanswering 300 s on Toulon-Hyères after Paris): a
// witness on its own clock — a call the test awaits would itself wait out a hung page — asks the page every 30 s for its JavaScript heap
// with 10 s to answer, and logs its delay and its heap, or its silence. Start it with `pageWitness(app)`, stop it with what it returns.
// Used by j8-zone-paris (J8Z_BEFORE); any long e2e may call it.
import type { App } from "./app";

/** the page's JavaScript heap [MB] (Chrome's performance.memory; null elsewhere) */
export const HEAP = `(() => { const m = performance.memory; return m ? Math.round(m.usedJSHeapSize / 1e6) : null; })()`;
/** (J8Z_BEFORE) the witness: every 30 s, on its own clock — a call the test awaits would itself wait out a hung page —, the heap asked
 *  with 10 s to answer, its delay and its heap logged, or its silence: the moment the page stops answering dated (the render session's
 *  ask, 17 Nov 2026) */
export function pageWitness(app: App): () => void {
  const t0 = Date.now();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    const at = new Date().toISOString().slice(11, 19);
    const s = Date.now();
    try {
      const r = await app.cdp.send<{ result: { value: number | null } }>("Runtime.evaluate", { expression: HEAP, returnByValue: true }, 10);
      console.log(
        `  [witness ${at} UTC, +${((s - t0) / 60_000).toFixed(1)} min] answered in ${Date.now() - s} ms · heap ${r.result?.value} MB`,
      );
    } catch {
      console.log(`  [witness ${at} UTC, +${((s - t0) / 60_000).toFixed(1)} min] NO ANSWER in 10 s`);
    } finally {
      busy = false;
    }
  }, 30_000);
  return () => clearInterval(timer);
}
