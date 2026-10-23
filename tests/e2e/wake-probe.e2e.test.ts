// (a probe — no assertion, a measure to read —, not in `bun run e2e`: E2E_PROBE=1 to run it)
// A probe of the craft's own wake on the sea (docs/PLAN-NUAGES-AAA.md N6b): what the renderer is given low over the water.
// Not a pass/fail test.
import { afterAll, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

afterAll(stopServer);

test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "the craft's wake on the sea",
  async () => {
    const app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 600, tiles: true });
    try {
      await app.js(`(() => { window.__t = true; const tick = () => { if (!window.__t) return; __bh.touch(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.flyAt(35.99, -5.52, 15, 190, 15); return 1; })()`);
      for (let i = 0; i < 3; i++) {
        await Bun.sleep(4000);
        const info = await app.js(`(() => { const g = __bh.camera.geoNow(); const r = __bh.renderer;
          return { g: g && { alt: +g.alt.toFixed(1), gs: +g.gs.toFixed(1) }, wakes: r.seaWakes.slice(0, 2).map((w) => ({ len: w.len, U: +w.U.toFixed(1), beam: w.beam })),
            animate: __bh.settings.animate }; })()`);
        console.log(JSON.stringify(info));
      }
    } finally {
      await app.close();
    }
  },
  300_000,
);
