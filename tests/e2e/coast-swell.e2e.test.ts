import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
// Probe — no assertion but the field baked and no GPU error; not in `bun run e2e`: E2E_PROBE=1 — (L1/L2 — the coastal swell field, system/earth-swell.ts): off the Almanarre beach (the Giens peninsula's western tombolo),
// a 1.6 m, 10 s swell from the south-west imposed (renderer.seaOverride); the field's bake on the shore's levels, then two views
// — 250 m up looking at the beach, 12 m over the water — each with the field and without (renderer.shoreSwellOn): shots, GPU time.
// Duration: ~4 min. Done when: both views shot and measured with and without the field, the field's levels published.
afterAll(stopServer);
const OUT = process.env.SWELL_OUT ?? "remote-results/zz-swell";
test.skipIf(!E2E || process.env.E2E_PROBE !== "1")(
  "the coastal swell field, off the Almanarre",
  async () => {
    const app = await App.boot({ width: 1600, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { traffic: false, autosave: false, weather: "fair", earthClouds: 0.2, wind: 0 });
      __bh.game.setDate("2026-07-10T15:30:00Z");
      // (a south-west swell — going north-east, 45° —, a light wind sea the same way)
      __bh.renderer.seaOverride = { wind: { hs: 0.3, tp: 3.5, to: 0.785 }, swell: { hs: 1.6, tp: 10, to: 0.785 }, source: "marine" };
      return 1; })()`);
      // (the Almanarre: the tombolo runs north–south at ~6.13° E, the open sea west of it; the swell from the south-west comes in
      // oblique and turns to its normal)
      const views: Record<string, string> = {
        aerial: `__bh.viewAt(43.062, 6.095, { altM: 250, heading: 95, pitch: -16, fov: 55 })`,
        beach: `__bh.viewAt(43.062, 6.1225, { altM: 25, heading: 95, pitch: -10, fov: 55 })`,
        low: `__bh.viewAt(43.058, 6.119, { altM: 6, heading: 80, pitch: -3, fov: 55 })`,
        // (L3: over the tombolo's beach, looking south-west along it — the wet band and the swash)
        sand: `__bh.viewAt(43.066, 6.1262, { altM: 8, heading: 80, pitch: -9, fov: 55 })`,
      };
      for (const [name, v] of Object.entries(views).filter(
        ([n]) => !process.env.SWELL_VIEWS || process.env.SWELL_VIEWS.split(",").includes(n),
      )) {
        const why = await app.js(`(() => { const r = ${v}; return r ?? null; })()`);
        if (why) throw new Error(`viewAt ${name}: ${why}`);
        // (a probe: the scenery may still be coming — said, not fatal; the field and the water are what is measured)
        await app.dataSettled(`swell ${name}`, { maxMs: 90_000 }).catch((e) => console.log(`(not settled: ${String(e).slice(0, 160)})`));
        // (the field: its levels baked for this swell — three frames a level, the coarsest first)
        const t0 = Date.now();
        let st: {
          key: string;
          job: unknown;
          levels: { level: number; published: boolean; field: boolean; fieldBakes: number; fromCoarse: boolean }[];
        } | null = null;
        while (Date.now() - t0 < 30_000) {
          st = await app.js(
            `(() => { __bh.touch(); const s = __bh.renderer.earthShore?.stats(); return s ? { key: s.key, job: s.job, levels: s.levels } : null; })()`,
          );
          if (st?.key && !st.job && st.levels.every((l) => !l.published || l.field)) break;
          await Bun.sleep(500);
        }
        console.log(JSON.stringify({ name, field: st }));
        if (!st?.key) throw new Error(`no swell key — the field not baked (${JSON.stringify(st)})`);
        await app.exposureSettled?.();
        // (SWELL_ABLATE=1: the field's runtime ablations instead — renderer.shoreSwellAblate —, alternated, two passes, no shots)
        const runs: (readonly [number, boolean, number])[] = process.env.SWELL_ABLATE
          ? process.env.SWELL_ABLATE === "presence"
            ? [1, 2, 3].flatMap((p) => [[p, true, 0] as const, [p, false, 0] as const, [p, true, -1] as const])
            : process.env.SWELL_ABLATE === "sand"
              ? [1, 2, 3].flatMap((p) => [[p, true, 0] as const, [p, true, 16] as const])
              : process.env.SWELL_ABLATE === "fine"
                ? [1, 2, 3].flatMap((p) => [
                    [p, true, 0] as const,
                    [p, true, 1] as const,
                    [p, true, 2] as const,
                    [p, true, 8] as const,
                    [p, false, 0] as const,
                  ])
                : [1, 2, 3].flatMap((p) => [[p, false, 0] as const, [p, true, 0] as const, [p, true, 15] as const])
          : [
              [1, true, 0],
              [1, false, 0],
              [2, true, 0],
              [2, false, 0],
            ];
        for (const [pass, on, ablate] of runs) {
          // (ablate −1: the reading compiled out — TUNE_SWELL 0, a kernel of its own, its compile awaited)
          await app.js(
            `(() => { __bh.renderer.shoreSwellOn = ${on}; __bh.renderer.shoreSwellAblate = ${Math.max(ablate, 0)}; __bh.renderer.tune = ${ablate < 0 ? "{ TUNE_SWELL: 0 }" : "{}"}; return 1; })()`,
          );
          await Bun.sleep(2500);
          if (process.env.SWELL_ABLATE === "presence") await app.dataSettled(`swell ${name} kernel`, { maxMs: 120_000 }).catch(() => {});
          const r = await app.js<{ gpu: number[] }>(`(async () => {
          const R = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q)); const gpu = []; let last = R.completedFrames; const t0 = performance.now();
          while (performance.now() - t0 < 6000) { __bh.touch(); await f(); if (R.completedFrames !== last) { last = R.completedFrames; gpu.push(+R.lastGpuMs.toFixed(2)); } }
          return { gpu }; })()`);
          const s = [...r.gpu].sort((a, b) => a - b);
          const shore = await app.js(
            `(() => __bh.renderer.prof?.table?.().filter((p) => /earth (shore|water)|sea fft/.test(p.label)).map((p) => [p.label, +p.ms.toFixed(2)]) ?? null)()`,
          );
          console.log(
            JSON.stringify({
              name,
              pass,
              field: on,
              ablate,
              images: s.length,
              gpuP50: s[Math.floor(s.length / 2)],
              gpuP95: s[Math.floor(s.length * 0.95)],
              passes: shore,
            }),
          );
          await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
          if ((pass === 1 && !process.env.SWELL_ABLATE) || (pass === 2 && process.env.SWELL_ABLATE === "sand"))
            await app.shot(`${OUT}/${name}-${on ? "field" : "nofield"}${ablate ? `-a${ablate}` : ""}.png`);
          await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
        }
        await app.js(`(() => { __bh.renderer.shoreSwellOn = true; __bh.renderer.shoreSwellAblate = 0; return 1; })()`);
      }
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    } finally {
      app.close();
    }
  },
  600_000,
);
