import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The ice giants' auroras (PLAN-AURORES-MAGNETOSPHERES AM4): Uranus's — two sheets, ±3° — and Neptune's ovals from their tilted,
// offset fields (Q3, O8), the same code as Jupiter's (AM3, trace.wgsl auroraGiant; Saturn's too, from Cassini 11, but its
// shadow's dark-adapted view is left out — docs/PROBLEMES-A-REGLER.md). Each seen from one radius over its antisolar point
// (sys.subsolar), in its shadow, the eye adapted to the dark, at activity 6. AG_OUT.
// Output: remote-results/aurora-giants/*.png, stats.json. Done when: each view shot, the camera in the shadow (eyeIncident
// < 1e-3), no GPU error. Duration: ~4 min warm; the giants' near kernels compile for minutes cold (docs/PROBLEMES-A-REGLER.md).
const OUT = process.env.AG_OUT ?? "remote-results/aurora-giants";
afterAll(stopServer);

test.skipIf(!E2E)(
  "Uranus's and Neptune's auroras from their shadows",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1400, height: 900, hash: "scene=game:artemis", tiles: true });
    const stats: Record<string, unknown> = {};
    let gpuErrors = -1;
    // (over its antisolar point — Uranus's axis tilted 98°: its subsolar point near a pole —, in its shadow)
    const view = async (name: string, body: string, altR: number, R: number, heading: number, pitch: number) => {
      const why = await app.js<
        string | null
      >(`(() => { Object.assign(__bh.settings, { aurora: 6, auroraLive: false, magnetosphere: false });
        const ss = __bh.sys.subsolar("${body}");
        return __bh.viewAt(-ss[0], ss[1] + 180, { body: "${body}", altM: ${altR * R}, heading: ${heading}, pitch: ${pitch}, fov: 70 }); })()`);
      expect(why).toBeNull();
      await Bun.sleep(3000);
      for (let k = 0; k < 72 && (await app.js<number>(`__bh.renderer.compilesPending`)) > 0; k++) {
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
      // (Saturn since 13 Nov 2026: its shadow's dark-adapted view showed the tracer's faint wrong light — PROBLEMES —, looked at again)
      await view("saturn-night", "saturn", 1, 60_268e3, 0, -89);
      await view("uranus-night", "uranus", 1, 25_559e3, 0, -89);
      await view("neptune-night", "neptune", 1, 24_764e3, 0, -89);
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/stats.json`, JSON.stringify(stats, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
  },
  30 * 60_000,
);
