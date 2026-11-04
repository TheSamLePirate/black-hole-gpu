import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { SCENE_VIEWS } from "./lib/plan-views";

// Q5 — the air's tables' GPU cost where it showed (the M0b views' A B B A: Biarritz, the Sun 0.5° up in a 4° telephoto, +7 %):
// the view as plan-views sets it, frozen; the passes over 3 s with the tables on, the multiple scattering's off
// (renderer.msLutOn), the transmittance's off (tlutOn), both off — twice each, alternated. AC_VIEW: another of SCENE_VIEWS.
// Done when: the eight runs measured, no GPU error. Duration: ~3 min.
afterAll(stopServer);
test.skipIf(!E2E)(
  "Q5: which of the air's tables costs, in the view where they showed",
  async () => {
    const v = SCENE_VIEWS.find((x) => x.name === (process.env.AC_VIEW ?? "biarritz-sun05-tele"))!;
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { ${Array.isArray(v.set) ? v.set[0] : v.set} return 1; })()`);
      await app.settled(120_000);
      await app.js(`new Promise((q) => setTimeout(() => { __bh.freeze(true); q(1); }, 1500))`);
      await app.waitFor(`__bh.renderer.tlutPublished`, 30_000).catch(() => console.warn("  the tables not in"));
      const run = (tl: boolean, ms: boolean) =>
        app.js<{
          total: number;
          trace: number;
          rows: [string, number][];
        }>(`(async () => { const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
          r.tlutOn = ${tl}; r.msLutOn = ${ms}; for (let i = 0; i < 120; i++) { __bh.touch(); await f(); }
          for (let i = 0; i < 600 && ${tl} && !r.tlutPublished; i++) { __bh.touch(); await f(); }
          r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
          while (performance.now() - t0 < 3000) { __bh.touch(); await f(); }
          const rows = r.prof.table().filter((p) => p.ms > 0.3).map((p) => [p.label, +p.ms.toFixed(3)]);
          const total = +r.prof.frameMs.toFixed(2); r.prof.enabled = false;
          return { total, trace: rows.filter(([l]) => /^trace/.test(l)).reduce((s, [, m]) => s + m, 0), rows }; })()`);
      const out: Record<string, unknown> = {};
      for (const round of [0, 1])
        for (const [k, tl, ms] of [
          ["both", true, true],
          ["noMs", true, false],
          ["noTlut", false, false],
          ["noMs2", true, false],
        ] as const) {
          const m = await run(tl, ms);
          out[`${k}-${round}`] = m;
          console.log(`  ${k} (round ${round}): GPU ${m.total} ms, trace ${m.trace.toFixed(3)} ms — ${JSON.stringify(m.rows.slice(0, 6))}`);
        }
      await app.js(`(() => { __bh.renderer.tlutOn = true; __bh.renderer.msLutOn = true; return 1; })()`);
      expect(await app.js<number>(`__bh.renderer.gpuErrors`)).toBe(0);
    } finally {
      await app.close();
    }
  },
  8 * 60_000,
);
