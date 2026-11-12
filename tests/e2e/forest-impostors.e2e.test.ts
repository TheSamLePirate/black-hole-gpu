import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
// Probe — not in `bun run e2e`: E2E_PROBE=1 — (PLAN-VEGETATION-V2 V2c): the far trees read from their hemi-octahedral impostors
// in shadeLite, against their plain shapes (renderer.treeImpostorsOn), over the Maures' forest north of Hyères: two views (500 m
// up looking over the hills, 150 m over the canopy), three passes alternated: shots (pass 1), GPU p50/p95 and `earth lite`.
// Duration: ~4 min. Done when: the impostors baked and both views shot and measured both ways.
afterAll(stopServer);
const OUT = process.env.IMPOSTOR_OUT ?? "remote-results/forest-impostors";
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "the far trees' impostors, over the Maures",
  async () => {
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { traffic: false, autosave: false, weather: "fair", earthClouds: 0.1, wind: 0 });
      __bh.game.setDate("2026-07-10T09:30:00Z"); return 1; })()`);
      // (SETTING_BOOT="key=value": a setting fixed before any view — the tiles loaded with it)
      if (process.env.SETTING_BOOT) {
        const [k, v] = process.env.SETTING_BOOT.split("=");
        await app.js(`(() => { __bh.settings.${k} = ${v}; return 1; })()`);
      }
      // (IMPOSTOR_VIEW="lat,lon,alt,heading,pitch": that view alone, named "custom")
      const cv = process.env.IMPOSTOR_VIEW?.split(",").map(Number);
      const views: Record<string, string> = cv
        ? { custom: `__bh.viewAt(${cv[0]}, ${cv[1]}, { altM: ${cv[2]}, heading: ${cv[3]}, pitch: ${cv[4]}, fov: 55 })` }
        : {
            aerial: `__bh.viewAt(43.17, 6.22, { altM: 500, heading: 35, pitch: -14, fov: 55 })`,
            canopy: `__bh.viewAt(43.19, 6.25, { altM: 150, heading: 60, pitch: -8, fov: 55 })`,
          };
      for (const [name, v] of Object.entries(views)) {
        const why = await app.js(`(() => { const r = ${v}; return r ?? null; })()`);
        if (why) throw new Error(`viewAt ${name}: ${why}`);
        await app.dataSettled(`forest ${name}`, { maxMs: 90_000 }).catch((e) => console.log(`(not settled: ${String(e).slice(0, 160)})`));
        const t0 = Date.now();
        let ready = false;
        while (Date.now() - t0 < 30_000 && !ready) {
          ready = await app.js<boolean>(`(() => { __bh.touch(); return !!__bh.renderer.treeImpostors?.ready; })()`);
          if (!ready) await Bun.sleep(500);
        }
        const info = await app.js(
          `(() => ({ ready: !!__bh.renderer.treeImpostors?.ready, failed: __bh.renderer.treeImpostors?.failed ?? null, bakeMs: Math.round(__bh.renderer.treeImpostors?.bakeMs ?? 0), bound: !!__bh.renderer.treeImpostors, stage: __bh.renderer.treeImpostors?.stage, raster: !!__bh.renderer.sceneryRaster }))()`,
        );
        console.log(JSON.stringify({ name, impostors: info }));
        if (!ready && !process.env.SETTING_BOOT && !process.env.SETTING_A_B)
          throw new Error(`the impostors not baked: ${JSON.stringify(info)}`);
        await app.exposureSettled?.();
        const tuneAB = process.env.TUNE_A_B?.split(":");
        for (const [pass, on] of [
          [1, true],
          [1, false],
          [2, true],
          [2, false],
          [3, true],
          [3, false],
        ] as const) {
          // (TUNE_A_B="KEY:value": the A/B that tuning instead — a kernel compiled without a part, the impostors on —, its compile awaited)
          // (SETTING_A_B="key": the A/B that setting instead — __bh.settings[key] true / false —, the data reloaded awaited)
          if (process.env.SETTING_A_B) {
            await app.js(`(() => { __bh.settings.${process.env.SETTING_A_B} = ${on}; return 1; })()`);
            await Bun.sleep(2500);
            await app.dataSettled(`forest ${name} ${process.env.SETTING_A_B}`, { maxMs: 120_000 }).catch(() => {});
          } else if (tuneAB) {
            await app.js(`(() => { __bh.renderer.tune = ${on ? "{}" : `{ ${tuneAB[0]}: ${Number(tuneAB[1])} }`}; return 1; })()`);
            await Bun.sleep(2500);
            await app.dataSettled(`forest ${name} kernel`, { maxMs: 120_000 }).catch(() => {});
          } else await app.js(`(() => { __bh.renderer.treeImpostorsOn = ${on}; return 1; })()`);
          await Bun.sleep(2500);
          const r = await app.js<{ gpu: number[] }>(`(async () => {
          const R = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q)); const gpu = []; let last = R.completedFrames; const t0 = performance.now();
          while (performance.now() - t0 < 6000) { __bh.touch(); await f(); if (R.completedFrames !== last) { last = R.completedFrames; gpu.push(+R.lastGpuMs.toFixed(2)); } }
          return { gpu }; })()`);
          const s = [...r.gpu].sort((a, b) => a - b);
          const passes = await app.js(
            `(() => __bh.renderer.prof?.table?.().filter((p) => /earth lite|terrain raster|scenery/.test(p.label)).map((p) => [p.label, +p.ms.toFixed(2)]) ?? null)()`,
          );
          console.log(
            JSON.stringify({
              name,
              pass,
              impostors: on,
              images: s.length,
              gpuP50: s[Math.floor(s.length / 2)],
              gpuP95: s[Math.floor(s.length * 0.95)],
              passes,
            }),
          );
          if (pass === 1) {
            await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
            // (with TUNE_A_B: the tuning's own pair — "on" the kernel as shipped, "off" the part compiled out)
            await app.shot(`${OUT}/${name}-${tuneAB ? (on ? "on" : "off") : on ? "impostors" : "shapes"}.png`);
            await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
          }
        }
        await app.js(`(() => { __bh.renderer.treeImpostorsOn = true; return 1; })()`);
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  900_000,
);
