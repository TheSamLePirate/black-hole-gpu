import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Mars's auroras (PLAN-AURORES-MAGNETOSPHERES AM6): oxygen's green over its crustal fields (a ring about 50° S, 180° E) and,
// in a solar storm, diffuse over the whole night side (Perseverance, 2024). Seen from 3 400 km over its antisolar point (its
// shadow, the eye adapted to the dark), at activity 4 (the crustal ring only) then 8 (the storm). AMR_OUT.
// Output: remote-results/aurora-mars/*.png, stats.json. Done when: both views shot, the camera in the shadow (eyeIncident
// < 1e-3), no GPU error. Duration: ~2 min warm.
const OUT = process.env.AMR_OUT ?? "remote-results/aurora-mars";
afterAll(stopServer);

test.skipIf(!E2E)(
  "Mars's auroras from its shadow: the crustal ring, then a storm's diffuse green",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1400, height: 900, hash: "scene=game:artemis", tiles: true });
    const stats: Record<string, unknown> = {};
    let gpuErrors = -1;
    const view = async (name: string, act: number) => {
      const why = await app.js<
        string | null
      >(`(() => { Object.assign(__bh.settings, { aurora: ${act}, auroraLive: false, magnetosphere: false });
        const ss = __bh.sys.subsolar("mars");
        return __bh.viewAt(-ss[0], ss[1] + 180, { body: "mars", altM: 3.4e6, heading: 0, pitch: -89, fov: 70 }); })()`);
      expect(why).toBeNull();
      await Bun.sleep(3000);
      for (let k = 0; k < 60 && (await app.js<number>(`__bh.renderer.compilesPending`)) > 0; k++) {
        if (k % 6 === 0) console.log(`    compiling ${k * 5} s: ${JSON.stringify(await app.js(`__bh.renderer.compilingNow`))}`);
        await Bun.sleep(5000);
      }
      await Bun.sleep(4000);
      await app.shot(`${OUT}/${name}.png`);
      stats[name] = await app.js(
        `({ eye: __bh.renderer.eyeIncident, key: __bh.renderer.featureKey & 16384, gpuMs: __bh.game.perf({ gpu: true }).gpuFrameMs })`,
      );
      console.log(`  ${name}: ${JSON.stringify(stats[name])}`);
      expect((stats[name] as { eye: number }).eye).toBeLessThan(1e-3);
    };
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      await app.js(`(() => { __bh.game.setDate("2026-12-21T07:00:00Z"); return 1; })()`);
      await view("mars-act4", 4);
      await view("mars-storm8", 8);
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/stats.json`, JSON.stringify(stats, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
  },
  15 * 60_000,
);
