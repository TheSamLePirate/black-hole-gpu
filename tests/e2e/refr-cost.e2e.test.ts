import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// R2 — the layered air's tables' GPU cost (renderer.refrTablesOn): a sunset over the sea seen from 300 m, lots of sky, frozen;
// the frame's GPU time and its passes over 3 s with the tables on, off, on, off (alternated: the drift both sides).
// Done when: the four runs measured, no GPU error. Duration: ~3 min.
afterAll(stopServer);
test.skipIf(!E2E)(
  "R2: the refraction tables' GPU cost, A/B",
  async () => {
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, refraction: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(
        `(() => { __bh.game.setDate("2026-07-10T19:50:00Z"); __bh.game.flyAt(47.5, -7.0, 300, 300, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(`new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, 2); __bh.freeze(true); q(1); }, 500))`);
      await app.waitFor(`__bh.renderer.refrPublished !== ""`, 60_000);
      await app.settled(120_000);
      const run = (on: boolean) =>
        app.js<{
          total: number;
          rows: [string, number][];
        }>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
        r.refrTablesOn = ${on}; for (let i = 0; i < 60; i++) { __bh.touch(); await frame(); }
        if (${on} && !r.refrPublished) for (let i = 0; i < 600 && !r.refrPublished; i++) { __bh.touch(); await frame(); }
        r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
        while (performance.now() - t0 < 3000) { __bh.touch(); await frame(); }
        const rows = r.prof.table().filter((p) => p.ms > 0.3).map((p) => [p.label, +p.ms.toFixed(3)]);
        const total = +r.prof.frameMs.toFixed(2); r.prof.enabled = false; return { total, rows }; })()`);
      const out: Record<string, unknown> = {};
      for (const [k, on] of [
        ["on", true],
        ["off", false],
        ["on2", true],
        ["off2", false],
      ] as const) {
        out[k] = await run(on);
        console.log(`  ${k}: ${JSON.stringify(out[k])}`);
      }
      await app.js(`(() => { __bh.renderer.refrTablesOn = true; __bh.freeze(false); return 1; })()`);
      expect(await app.js<number>(`__bh.renderer.gpuErrors`)).toBe(0);
    } finally {
      await app.close();
    }
  },
  600_000,
);
