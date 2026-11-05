import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T7 — the cost of the sea's tests reading the data's height where the mesh stands over the sea on a low coast (the
// coast-loading fix, trace.wgsl shadeLite): the F-35 held at 300 m over the Camargue's coast looking inland (a low coast
// of the global map everywhere: every ground pixel the mesh puts over the sea's level reads the tiles once), the world
// frozen once all is in; the raster's passes timed by the profiler over 6 s (earth lite, earth water), the frame's GPU.
// For scripts/ab-e2e.ts (AB_SIDE, AB_RUN name the line). Done when: the times printed and written. Duration: ~1.5 min.
afterAll(stopServer);
const OUT = process.env.CC_OUT ?? "remote-results/coast-cost";

test.skipIf(!E2E)(
  "T7: the sea's tests' cost on a low coast (Camargue)",
  async () => {
    const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    let r: Record<string, number> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", f35Invulnerable: true, f35AutoProtect: true, motionBlur: 0, dof: false }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.setDate("2026-11-05T12:00:00Z"); __bh.game.set("weather", "fair");
        __bh.game.flyAt(43.43, 4.43, 300, 20, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`);
      await app.js(`new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, -8); __bh.freeze(true); q(1); }, 400))`);
      await app.settled(60_000).catch(() => console.log("  not settled in 60 s"));
      await app.js(`(__bh.renderer.prof.enabled = true, __bh.renderer.prof.reset(), 1)`);
      await app.js(
        `new Promise((q) => { const t = performance.now(); const f = () => { __bh.touch(); if (performance.now() - t < 6000) requestAnimationFrame(f); else q(1); }; f(); })`,
      );
      r = await app.js<Record<string, number>>(`(() => { const st = __bh.renderer.prof.stats, g = (l) => +(st.get(l)?.ms ?? 0).toFixed(3);
        return { lite: g("earth lite (raster)"), water: g("earth water (raster)"), gpu: +(__bh.renderer.prof.frameMs ?? 0).toFixed(2) }; })()`);
      await app.shot(`${OUT}/camargue-${process.env.AB_SIDE ?? "x"}${process.env.AB_RUN ?? ""}.png`);
      console.log(
        `  ${process.env.AB_SIDE ?? "-"} ${process.env.AB_RUN ?? ""}: earth lite ${r.lite} ms, earth water ${r.water} ms, frame GPU ${r.gpu} ms`,
      );
      await Bun.write(`${OUT}/cost-${process.env.AB_SIDE ?? "x"}${process.env.AB_RUN ?? ""}.json`, JSON.stringify(r));
    } finally {
      await app.close();
    }
    expect(r.lite).toBeGreaterThan(0);
  },
  5 * 60_000,
);
