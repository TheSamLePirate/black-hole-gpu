import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q7 VIPER B4 — the runway worn (trace.wgsl runwayShade): the main gears' rubber in streaks along their tracks over the
// touchdown zones, repair patches, the slabs' joints, the surface aged unevenly — against the touchdown zone's plain darkening
// before (TUNE_SC_SKIP 512). The F-35 lined up 120 m past a threshold (RW_SITE, Le Bourget by default), the cockpit looking
// 6° down the runway, 13:00 UTC in July, frozen, the exposure locked: shots worn, plain, worn again, and the raster material's
// cost with each (2 s).
// RW_OUT: the shots (remote-results/runway-wear).
// Duration: ~3 min on this Mac.
// Done when: the three shots taken and the costs logged, no GPU error.
const OUT = process.env.RW_OUT ?? "remote-results/runway-wear";
const SITE = process.env.RW_SITE ?? "Bourget";
afterAll(stopServer);
test.skipIf(!E2E)(
  "B4: the runway worn — rubber, patches, joints — against its plain darkening",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", weather: "fair", bloom: 0 }); __bh.game.set("earthClouds", 0); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T13:00:00Z";
      const name = await app.js<string>(
        `(() => { __bh.game.setDate("${iso}"); const n = __bh.game.lineUp("${SITE}", 120); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return n; })()`,
      );
      console.log(`  lined up: ${name}`);
      await app.js(`new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, -6); q(1); }, 800))`);
      await app.js(`(() => { __bh.camera.setLook(0, -6); __bh.game.setDate("${iso}"); __bh.freeze(true); return 1; })()`);
      await app.settled(120_000);
      const frames = (n: number) =>
        app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${n}; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
      await frames(150);
      await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
      for (const [k, tune] of [
        ["worn", "{}"],
        ["plain", "{ TUNE_SC_SKIP: 512 }"],
        ["worn2", "{}"],
      ] as const) {
        await app.js(`(() => { __bh.renderer.tune = ${tune}; __bh.touch(); return 1; })()`);
        await app.settled(120_000);
        await frames(90);
        const m = await app.js<{ lite: number; total: number }>(`(async () => {
          const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
          r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
          while (performance.now() - t0 < 2000) { __bh.touch(); await f(); }
          const rows = r.prof.table(); const g = (re) => +rows.filter((p) => re.test(p.label)).reduce((s, p) => s + p.ms, 0).toFixed(3);
          const total = +r.prof.frameMs.toFixed(2); r.prof.enabled = false;
          return { lite: g(/^earth lite/), total }; })()`);
        const pipe = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings) + " " + __bh.settings.shipMount`);
        await app.shot(`${OUT}/${k}.png`);
        out[k] = { ...m, pipe };
        console.log(`  ${k}: earth lite ${m.lite} ms, GPU ${m.total} ms (${pipe})`);
      }
      await app.js(`(() => { __bh.renderer.tune = {}; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/wear.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
