import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5, VIPER C2 — the clouds' march amortised (renderer.cloudAmortize: a texel in four marched a frame, a 2 × 2 checker turning,
// the others rebuilt from the history — post.wgsl cloudTemporal): the Alps from Chamonix at 2 500 m, cloudy, the Sun ~10° up,
// the F-35's cockpit looking west. Frozen: the passes over 3 s, amortised and not, alternated (A B A B), a shot of each. Then
// turning — the view swung 30° a second for 2 s —: a shot mid-turn each way (the history rejected where the view is new: what
// the amortised march leaves there). CA_OUT: the shots (remote-results/cloud-amortize).
// Done when: four timings and the shots taken, no GPU error. Duration: ~3 min.
const OUT = process.env.CA_OUT ?? "remote-results/cloud-amortize";
afterAll(stopServer);
test.skipIf(!E2E)(
  "VIPER C2: the clouds' march a texel in four a frame — its cost, and the clouds still and turning",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, weather: "cloudy" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = "2026-07-10T17:55:00Z";
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.flyAt(45.92, 6.87, 2500, 270, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(
        `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, 6); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 500))`,
      );
      await app.settled(120_000);
      for (const [k, on] of [
        ["amortised", true],
        ["every", false],
        ["amortised2", true],
        ["every2", false],
      ] as const) {
        const m = await app.js<{ clouds: number; hist: number; total: number; cl: [string, number][] }>(`(async () => {
          const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
          r.cloudAmortize = ${on}; for (let i = 0; i < 90; i++) { __bh.touch(); await f(); }
          r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
          while (performance.now() - t0 < 3000) { __bh.touch(); await f(); }
          const rows = r.prof.table(); const g = (re) => +rows.filter((p) => re.test(p.label)).reduce((s, p) => s + p.ms, 0).toFixed(3);
          const total = +r.prof.frameMs.toFixed(2); r.prof.enabled = false;
          const cl = rows.filter((p) => /cloud/i.test(p.label)).map((p) => [p.label, +p.ms.toFixed(3)]);
          return { clouds: g(/^clouds (half)/), hist: g(/clouds' history/), total, cl }; })()`);
        out[k] = m;
        if (k === "amortised" || k === "every") await app.shot(`${OUT}/still-${k}.png`);
        console.log(`  ${k}: clouds ${m.clouds} ms, history ${m.hist} ms, GPU ${m.total} ms — ${JSON.stringify(m.cl)}`);
      }
      // (turning: the view swung while the world runs — the history rejected at the image's new edge)
      for (const [k, on] of [
        ["amortised", true],
        ["every", false],
      ] as const) {
        await app.js(`(async () => { const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
          r.cloudAmortize = ${on}; __bh.camera.setLook(0, 6); __bh.freeze(false); __bh.game.setDate("${iso}");
          for (let i = 0; i < 30; i++) { __bh.touch(); await f(); }
          const t0 = performance.now(); let yaw = 0;
          while (performance.now() - t0 < 1000) { yaw = 30 * (performance.now() - t0) / 1000; __bh.camera.setLook(yaw, 6); await f(); }
          return 1; })()`);
        await app.shot(`${OUT}/turn-${k}.png`);
        await app.js(`(() => { __bh.freeze(true); return 1; })()`);
      }
      await app.js(`(() => { __bh.renderer.cloudAmortize = true; return 1; })()`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  GPU errors ${out.gpuErrors}`);
    } finally {
      await Bun.write(`${OUT}/amortize.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  6 * 60_000,
);
