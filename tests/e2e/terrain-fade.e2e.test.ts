import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T4b — the relief cache's fade (docs/PLAN-REFRACTION-HORIZONS.md): Paris from 300 m, the view still, the IGN's silhouettes
// switched off then on (the far levels' overground — the towers, the woods — leaves z 11 … 13 and comes back: the cache's levels
// 3 … 5 baked again on the same windows). The heights drawn — renderer.terrainCacheLevel: the last bake faded in over the one
// before, mix(current, previous, share) — read back frame after frame (until 2 s after the last bake, 25 s at most): their largest change from one read to the next against
// the bakes' own change. With the fade (lengthened to 1 s here: the reads ~150 ms apart) a bake's change is spread over its frames; with none (fadeMs 0,
// as before T4) it is drawn whole at once. Shots of both ends. Figures in remote-results/terrain-fade. Duration: ~2 min.
const OUT = "remote-results/terrain-fade";
afterAll(stopServer);
const LEVELS = [3, 4, 5];

test.skipIf(!E2E)(
  "the relief cache's bakes faded in: no jump of the heights drawn, against a jump without the fade",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const t0 = performance.now();
    const step = (what: string) => console.log(`  [${((performance.now() - t0) / 1000).toFixed(0)} s] ${what}`);
    const app = await App.boot({ width: 960, height: 600, hash: "scene=game:artemis", tiles: true });
    // (Chrome closed whatever happens — a failed expect, a timeout —: none left on the GPU)
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, earthIgnSilhouettes: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const place = `__bh.game.flyAt(48.85, 2.27, 300, 70, 120); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
      await app.js(`(() => { __bh.game.setDate("2026-07-10T10:00:00Z"); ${place} __bh.freeze(true); return 1; })()`);
      const settle = async (what: string) => {
        const ok = await app.waitFor(`__bh.renderer.earthTiles.pending <= 2 && __bh.renderer.earthTiles.finest >= 14`, 60_000).then(
          () => true,
          () => false,
        );
        await app.js(`(() => { ${place} return 1; })()`);
        await app.settled(60_000);
        step(`${what}: tiles ${ok ? "in" : "NOT in after 60 s"}`);
      };
      await settle("Paris");
      await app.shot(`${OUT}/silhouettes-on.png`);
      // (the heights drawn read back each frame for 8 s after the switch: per level, the largest step of the drawn heights between
      // two reads, the largest change a bake brought — its new heights against those drawn just before —, the bakes seen)
      const watch = (tag: string, fadeMs: number, on: boolean) =>
        app.js<
          Record<string, unknown>
        >(`(async () => { const R = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => setTimeout(q, 0)));
          R.terrainSurfaceCache.fadeMs = ${fadeMs};
          const shown = (l) => l.current.map((h, i) => h + l.share * (l.previous[i] - h));
          const last = {}, out = {};
          for (const k of ${JSON.stringify(LEVELS)}) { const l = await R.terrainCacheLevel(k); last[k] = { cur: l.current, drawn: shown(l) }; out[k] = { reads: 0, bakes: 0, bakeChange: 0, largestStep: 0, shares: [] }; }
          __bh.settings.earthIgnSilhouettes = ${on};
          const t0 = performance.now();
          let lastBake = 0;
          // (until 2 s after the last bake once some came — the tiles taken again from the network first —, 25 s at most)
          while (performance.now() - t0 < 25000 && !(lastBake && performance.now() - lastBake > 2000)) {
            __bh.touch(); await frame();
            for (const k of ${JSON.stringify(LEVELS)}) {
              const l = await R.terrainCacheLevel(k), o = out[k], p = last[k];
              if (!l.ready) continue;
              const drawn = shown(l);
              let bake = 0, stepMax = 0;
              for (let i = 0; i < drawn.length; i++) {
                if (l.current[i] !== p.cur[i]) bake = Math.max(bake, Math.abs(l.current[i] - p.drawn[i]));
                stepMax = Math.max(stepMax, Math.abs(drawn[i] - p.drawn[i]));
              }
              if (bake > 0) { o.bakes++; o.bakeChange = Math.max(o.bakeChange, bake); lastBake = performance.now(); }
              o.largestStep = Math.max(o.largestStep, stepMax); o.reads++;
              if (l.share > 0 && o.shares.length < 12) o.shares.push(+l.share.toFixed(2));
              last[k] = { cur: l.current, drawn };
            }
          }
          const dt = (performance.now() - t0) / Math.max(1, out[${LEVELS[0]}].reads);
          for (const k in out) { out[k].bakeChange = +out[k].bakeChange.toFixed(2); out[k].largestStep = +out[k].largestStep.toFixed(2); }
          return { ...out, readMs: +dt.toFixed(0) }; })()`);
      // (the fade lengthened to 1 s: three read-backs a frame space the reads ~150 ms apart — the 250 ms fade's steps are its frames')
      const faded = await watch("faded", 1000, false);
      step(`faded (1 s), silhouettes off: ${JSON.stringify(faded)}`);
      await settle("silhouettes off");
      await app.shot(`${OUT}/silhouettes-off.png`);
      const abrupt = await watch("abrupt", 0, true);
      step(`no fade, silhouettes on: ${JSON.stringify(abrupt)}`);
      writeFileSync(`${OUT}/terrain-fade.json`, JSON.stringify({ faded, abrupt }, null, 1));
      expect(await app.js<number>(`(() => __bh.renderer.gpuErrors)()`)).toBe(0);
      // (over the levels a bake changed by a metre or more: with the fade, the drawn heights' largest step a fraction of the bake's
      // change; without, the whole of it)
      type L = { bakes: number; bakeChange: number; largestStep: number };
      const changed = (r: Record<string, unknown>) =>
        Object.values(r).filter((l): l is L => typeof l === "object" && l !== null && (l as L).bakeChange >= 1);
      expect(changed(faded).length).toBeGreaterThan(0);
      for (const l of changed(faded)) expect(l.largestStep).toBeLessThan(0.4 * l.bakeChange);
      for (const l of changed(abrupt)) expect(l.largestStep).toBeGreaterThan(0.9 * l.bakeChange);
    } finally {
      app.close();
    }
  },
  6 * 60_000,
);
