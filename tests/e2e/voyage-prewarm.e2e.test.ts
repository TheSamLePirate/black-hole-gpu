import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// A voyage's goal compiled ahead (renderer.prewarmNear, ANALYSE-STRATEGIE §8 « anticiper les compilations »): from the Earth, the free
// camera's voyage G to Jupiter — the near-Jupiter kernels asked from the voyage's start, compiled while it goes (~20 s, voyageWall) —;
// the wait at the arrival timed: from the voyage's end to nothing compiling. The kernels made cold first (a pipeline constant nudged by a
// random hair — TUNE_EPS_FAR —: the GPU driver's cache missed, as on a new build). VP_OFF=1: the lever off (renderer.prewarmVoyage =
// false), the arrival's wait as before — the A/B. Logged: the key compiled ahead and the key at the arrival (the same: the guess right).
// Duration: ~3 min on kerr-mini
// Done when: the arrival's wait logged and nothing compiling by Jupiter, shot taken
const OUT = process.env.VP_OUT ?? "remote-results/voyage-prewarm";
afterAll(stopServer);

test.skipIf(!E2E)(
  "the voyage to Jupiter: its kernels compiled on the way, the arrival's wait timed",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const off = !!process.env.VP_OFF;
    const app = await App.boot({ width: 1280, height: 720, hash: "scene=Earth: the Blue Marble", tiles: false });
    try {
      await app.waitFor("__bh.renderer.completedFrames > 30", 120_000);
      await app.js(
        `(() => { __bh.renderer.tune = { TUNE_EPS_FAR: ${3 + Math.random() * 1e-3} }; __bh.renderer.prewarmVoyage = ${!off}; return 1; })()`,
      );
      // (the Earth's own kernels, cold under the nudge, compiled before the voyage: the queue empty at its start)
      await app.settled();
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 240_000);
      await app.press("F3", "F3");
      await app.waitFor(`__bh.camera.spectating`, 10_000);
      await app.js(`(() => { __bh.camera.viewController().s.target = "jupiter"; __bh.settings.target = "jupiter"; return 1; })()`);
      const t0 = Date.now();
      expect(await app.js<string | null>(`__bh.goTo("jupiter")`)).toBeNull();
      await app.waitFor(`!!__bh.camera.viewController().voyage`, 10_000);
      const ahead = await app.js<number>(`__bh.renderer.voyageKey >>> 0`);
      console.log(`  voyage begun, lever ${off ? "off" : "on"}: the key compiled ahead ${ahead === 4294967295 ? "none" : ahead}`);
      await app.waitFor(`!__bh.camera.viewController().voyage`, 120_000);
      const tArr = Date.now();
      // (a few frames by Jupiter: its key the frame's)
      await Bun.sleep(500);
      const arr = await app.js<{ key: number; pending: number; compiling: unknown }>(
        `({ key: __bh.renderer.featureKey >>> 0, pending: __bh.renderer.compilesPending, compiling: __bh.renderer.compilingNow })`,
      );
      console.log(
        `  arrived after ${((tArr - t0) / 1000).toFixed(1)} s: key ${arr.key} (${arr.key === ahead ? "the one compiled ahead" : "another"}), ${arr.pending} compiles pending ${JSON.stringify(arr.compiling)}`,
      );
      for (let k = 0; k < 200 && (await app.js<number>(`__bh.renderer.compilesPending`)) > 0; k++) {
        if (k % 5 === 4)
          console.log(
            `    ${k + 1} s after: ${JSON.stringify(await app.js(`(() => { const r = __bh.renderer, q = r.variantQueue; return { now: r.compilingNow, waiting: q.waiting.length, running: q.running.length, urgent: q.urgentPending }; })()`))}`,
          );
        await Bun.sleep(1000);
      }
      const tDone = Date.now();
      // (every compile since the voyage's start: entry, key, seconds, when it ended relative to the arrival)
      const log = await app.js<{ entry: string; key: number; seconds: number; at?: number }[]>(`__bh.renderer.compileReport().compiles`);
      console.log(`  compiles: ${JSON.stringify(log.slice(-12))}`);
      const wait = (tDone - tArr) / 1000;
      console.log(
        `  the arrival's wait (lever ${off ? "off" : "on"}): ${wait.toFixed(1)} s — the voyage ${((tArr - t0) / 1000).toFixed(1)} s`,
      );
      await Bun.write(
        `${OUT}/${off ? "off" : "on"}.json`,
        JSON.stringify({ off, ahead, arrivalKey: arr.key, voyageS: (tArr - t0) / 1000, waitS: wait }, null, 1),
      );
      expect(await app.js<number>(`__bh.renderer.compilesPending`)).toBe(0);
      await app.shot(`${OUT}/${off ? "off" : "on"}.png`);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  600_000,
);
