import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Jupiter's auroras (PLAN-AURORES-MAGNETOSPHERES AM3): the main oval from JRM33 + CON2020 (tabulated about its own centre), the
// polar emissions inside it, Io's footprint and its tail; H-α and H₂'s violet at 245 km over the 1 bar level; then the scene
// "Jupiter: the auroras from its shadow" (the first view as a gallery scene: scene.png, no interface). Seen from Jupiter's
// shadow — the camera at its midnight (sys.subsolar), the eye adapted to the dark —: from 7 000 km over 45° N looking north
// across the oval (activity 5, then 8; Jupiter turned so that the oval's low side faces midnight), from 14 000 km over 50° S
// looking south, from 36 000 km over 30° S (the oval foreshortened at the limb). AJ_OUT. AJ_SWEEP=1: the south view's neighbours too.
// Output: remote-results/aurora-jupiter/*.png, stats.json. Done when: the aurora kernel in (featureKey 16384), each view shot,
// the camera in the shadow (renderer eyeIncident < 1e-3), no GPU error. Duration: ~2 min on kerr-mini cold (the near-Jupiter kernels'
// compile: 60 s there with AJ_COLD, 13 Nov 2026 — 203 s on the M1 Max on 6 Nov), ~1 min warm.
const OUT = process.env.AJ_OUT ?? "remote-results/aurora-jupiter";
const RJ = 71_492e3;
afterAll(stopServer);

test.skipIf(!E2E)(
  "Jupiter's auroras from its shadow: the main ovals north and south, Io's footprint",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1400, height: 900, hash: "scene=game:artemis", tiles: true });
    const stats: Record<string, unknown> = {};
    // (AJ_COLD=1: a pipeline constant nudged by a random hair — TUNE_EPS_FAR, the far march's epsilon, 3 → 3.000x — so that the kernels
    // compile from nothing, the GPU driver's cache missed: the cold compile timed — PROBLEMES « La compilation du noyau de Jupiter proche »)
    if (process.env.AJ_COLD) await app.js(`(() => { __bh.renderer.tune = { TUNE_EPS_FAR: ${3 + Math.random() * 1e-3} }; return 1; })()`);
    let gpuErrors = -1;
    const view = async (name: string, act: number, lat: number, lon: number | null, alt: number, heading: number, pitch: number) => {
      const why = await app.js<string | null>(`(() => { Object.assign(__bh.settings, { aurora: ${act}, auroraLive: false });
        const ss = __bh.sys.subsolar("jupiter");
        return __bh.viewAt(${lat}, ${lon ?? "ss[1] + 180"}, { body: "jupiter", altM: ${alt}, heading: ${heading}, pitch: ${pitch}, fov: 70 }); })()`);
      expect(why).toBeNull();
      const tKey = Date.now();
      await app.waitFor(`(__bh.renderer.featureKey & 16384) === 16384`, 60_000);
      // (the near-Jupiter kernel compiled in ~200 s cold on the M1 Max, with or without the auroras — measured 6 Nov 2026: 203 s
      // without, 219 s with —; 60 s cold on kerr-mini on 13 Nov; its progress said every 30 s, 5 min at most)
      for (let k = 0; k < 60 && (await app.js<number>(`__bh.renderer.compilesPending`)) > 0; k++) {
        if (k % 6 === 0) console.log(`    compiling ${k * 5} s: ${JSON.stringify(await app.js(`__bh.renderer.compilingNow`))}`);
        await Bun.sleep(5000);
      }
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 30_000);
      // (the wait timed: the view asked → nothing compiling — PROBLEMES « La compilation du noyau de Jupiter proche »)
      console.log(`    ${name}: compiled ${((Date.now() - tKey) / 1000).toFixed(1)} s after the view was asked`);
      await Bun.sleep(2500);
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 90_000);
      await Bun.sleep(3000);
      await app.shot(`${OUT}/${name}.png`);
      stats[name] = await app.js(
        // (and the exposure in use, the scene's colour read back — non-finite values, its maximum and mean —: PROBLEMES « Jupiter vu de près
        // depuis l'hémisphère sud : l'image parfois toute noire », its pistes NaN / an exposure gone)
        `(async () => { const r = __bh.renderer; const c = await r.sceneColor(__bh.settings).catch(() => null); let bad = 0, max = 0, sum = 0, n = 0;
          if (c) for (let i = 0; i < c.data.length; i += 4) { const v = 0.2126 * c.data[i] + 0.7152 * c.data[i + 1] + 0.0722 * c.data[i + 2];
            if (!Number.isFinite(v)) bad++; else { max = Math.max(max, v); sum += v; n++; } }
          // (the frame's parameters — renderer.paramsF — their non-finite slots: a per-frame value gone NaN would blank every pixel)
          const pf = r.paramsF; const badParams = [];
          if (pf) for (let i = 0; i < pf.length && badParams.length < 12; i++) if (!Number.isFinite(pf[i])) badParams.push(i);
          // (and the bodies' table the CPU writes — renderer.bodyData —: the same check)
          const bd = r.bodyData; const badBodies = [];
          if (bd) for (let i = 0; i < bd.length && badBodies.length < 12; i++) if (!Number.isFinite(bd[i])) badBodies.push(i);
          return { eye: r.eyeIncident, ev: +r.ev(__bh.settings).toFixed(2), autoEV: +(r.autoEVDrawn ?? 0).toFixed(2), nonFinite: bad, badParams, badBodies,
            key: r.featureKey >>> 0, settled: r.tracerSettled, kernel: (() => { const v = r.variants?.get(r.featureKey); return v ? { rt: !!v.rt, failed: !!v.failed, givenUp: !!v.rtGivenUp, shadeLite: !!v.shadeLite } : null; })(),
            bodyRaster: r.bodyRasterNow ?? null, pipeline: r.earthPipelineNow?.(__bh.settings) ?? null, hd: r.hdMap ? { name: r.hdMap.name ?? null, mode: r.hdMap.mode ?? null, dem: !!r.hdMap.dem } : null, giantTile: r.giantTile?.state ?? null,
            sceneMax: +max.toPrecision(3), sceneMean: +(sum / Math.max(n, 1)).toPrecision(3), source: c?.source ?? null,
            fps: __bh.game.perf({ gpu: true }).renderFps, gpuMs: __bh.game.perf({ gpu: true }).gpuFrameMs }; })()`,
      );
      console.log(`  ${name}: ${JSON.stringify(stats[name])}`);
      expect((stats[name] as { eye: number }).eye).toBeLessThan(1e-3);
    };
    try {
      await app.waitProgress("__bh.camera.piloting", "the flight");
      // (the north oval reaches down to 54° N near −165° E — its centre is off the pole towards 180°: Jupiter turned until
      // that longitude faces midnight, 870.5° a day)
      await app.js(`(() => { __bh.game.setDate("2026-12-21T07:00:00Z"); return 1; })()`);
      const ss = await app.js<[number, number]>(`__bh.sys.subsolar("jupiter")`);
      const dLon = ((((-165 - (ss[1] + 180)) % 360) + 540) % 360) - 180;
      const at = new Date(Date.parse("2026-12-21T07:00:00Z") + (-dLon / 870.5) * 86400e3).toISOString();
      await app.js(`(() => { __bh.game.setDate(${JSON.stringify(at)}); return 1; })()`);
      // (7 000 km over 45° N at midnight, in the shadow, looking north: the oval 10–20° of arc ahead; its horizon 25° down)
      await view("north-act5", 5, 45, null, 0.1 * RJ, 0, -22);
      await view("north-act8", 8, 45, null, 0.1 * RJ, 0, -22);
      // (14 000 km over 50° S, looking south: the south oval at ~68° S, 18° ahead; its horizon 34° down)
      await view("south-act5", 5, -50, null, 0.2 * RJ, 180, -30);
      // (from 36 000 km over 30° S: the oval foreshortened at the limb)
      await view("south-far-act5", 5, -30, null, 0.5 * RJ, 180, -55);
      // (AJ_SWEEP=1 — PROBLEMES « Jupiter noir depuis le sud »: the black view's neighbours — the hemisphere, the look toward the pole, the
      // latitude, the height — each its scene colour's maximum in the log)
      if (process.env.AJ_SWEEP) {
        await view("sweep-s50-h02-north", 5, -50, null, 0.2 * RJ, 0, -30);
        await view("sweep-s50-h01-south", 5, -50, null, 0.1 * RJ, 180, -30);
        await view("sweep-s30-h02-south", 5, -30, null, 0.2 * RJ, 180, -30);
        await view("sweep-n50-h02-north", 5, 50, null, 0.2 * RJ, 0, -30);
        await view("sweep-s50-h02-south-level", 5, -50, null, 0.2 * RJ, 180, 0);
      }
      // (the scene that shows them — "Jupiter: the auroras from its shadow", settings.ts —: the first view, its date and place
      // its own; the kernel warm from the views; shot without the interface: the gallery's picture)
      await app.js(`(() => { __bh.game.preset("Jupiter: the auroras from its shadow"); return 1; })()`);
      await app.waitFor(`(__bh.renderer.featureKey & 16384) === 16384`, 60_000);
      for (let k = 0; k < 60 && (await app.js<number>(`__bh.renderer.compilesPending`)) > 0; k++) await Bun.sleep(5000);
      await app.waitFor(`__bh.renderer.compilesPending === 0`, 30_000);
      await Bun.sleep(5000);
      await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
      await app.shot(`${OUT}/scene.png`);
      await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
      stats.scene = await app.js(
        `({ eye: __bh.renderer.eyeIncident, aurora: __bh.settings.aurora, ship: __bh.settings.ship, date: __bh.game.date?.(), fps: __bh.game.perf({ gpu: true }).renderFps })`,
      );
      console.log(`  scene: ${JSON.stringify(stats.scene)}`);
      expect((stats.scene as { eye: number }).eye).toBeLessThan(1e-3);
      expect((stats.scene as { aurora: number }).aurora).toBe(5);
      gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/stats.json`, JSON.stringify(stats, null, 1));
      await app.close();
    }
    expect(gpuErrors).toBe(0);
  },
  12 * 60_000,
);
