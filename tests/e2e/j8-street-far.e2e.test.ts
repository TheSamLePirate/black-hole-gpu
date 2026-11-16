import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-L — the far street layer (street-far.ts) against the near scene's own lamps and cars: the far ones left out within the
// scene's kept reach round its centre (lampReachM, trafficReachM — until 16 Nov 2026 1.5 km round the eye: a gap under the camera and a
// double ahead when the scene was centred off it), the far cars drawn by day as their bodies. Toulon from 2.5 km, 350 m up, the free
// camera, the world frozen (FC_LAT, FC_LON, FC_ALT, FC_HDG, FC_PITCH another view); by day and by night the layer on and off: the GPU
// time (median of 5 s), a shot. Not a pass/fail on the image; it fails on a GPU error.
// Duration: ~5 min on kerr-mini.
// Done when: day and night shot on and off.
afterAll(stopServer);
const MACHINE = process.env.FC_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const OUT = `${process.env.FC_OUT ?? `remote-results/j8-street-far/${MACHINE}`}${process.env.AB_SIDE ? `-${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : ""}`;
const V = {
  lat: Number(process.env.FC_LAT ?? 43.124),
  lon: Number(process.env.FC_LON ?? 5.958),
  altM: Number(process.env.FC_ALT ?? 350),
  heading: Number(process.env.FC_HDG ?? 270),
  pitch: Number(process.env.FC_PITCH ?? -6),
};
test.skipIf(!E2E)(
  "J8-L: the far cars by day, the masks round the scene's centre",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1920, height: 1080, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(`(() => { Object.assign(__bh.settings, { ship: false, earthPipeline: "raster", earthClouds: 0, weather: "fair", dof: false, motionBlur: 0 });
      __bh.renderer.debugSkipShip = true; __bh.game.setDate("2026-07-10T13:30:00Z"); return 1; })()`);
      await app.js(
        `(() => { __bh.freeze(true); __bh.viewAt(${V.lat}, ${V.lon}, { altM: ${V.altM}, heading: ${V.heading}, pitch: ${V.pitch}, fov: 50 }); __bh.touch(); return 1; })()`,
      );
      await app
        .waitProgress(
          `(() => { const sc = __bh.renderer.earthScenery.stats(); __bh.touch(); return sc.status === "ready" && !sc.quick && !sc.pending; })()`,
          "the scene whole",
          { stallMs: 60_000, maxMs: 180_000 },
        )
        .catch((e) => console.log(`  (${String(e).slice(0, 200)})`));
      for (let s = 0; s < 18; s++) {
        const l = await app.js<{ missing: number; cells: number; cars: number } | null>(
          `(() => { __bh.touch(); return __bh.renderer.farLamps(); })()`,
        );
        if (l && l.cells > 0 && l.missing === 0) break;
        if (s % 2 === 1) console.log(`  … the street cells: ${JSON.stringify(l)}`);
        await app.js(`new Promise((q) => setTimeout(q, 5000))`);
      }
      const sc = await app.js(
        `(() => { const s = __bh.renderer.earthScenery.stats(); return { lamps: s.lamps, lampReachM: Math.round(s.lampReachM), cars: s.cars, trafficReachM: Math.round(s.trafficReachM), centre: [s.lat, s.lon] }; })()`,
      );
      console.log(`  the scene: ${JSON.stringify(sc)}; the far street layer: ${JSON.stringify(await app.js("__bh.renderer.farLamps()"))}`);
      const measure = async (tag: string, on: boolean) => {
        await app.js(`(() => { __bh.renderer.farLampsOn = ${on}; __bh.touch(); return 1; })()`);
        await app.settled(30_000);
        const m = await app.js(`(async () => {
        const R = __bh.renderer; for (let i = 0; i < 20; i++) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch(); }
        const g = []; let done = R.completedFrames; const t0 = performance.now();
        while (performance.now() - t0 < 5000) { await new Promise((q) => requestAnimationFrame(q)); __bh.touch();
          if (R.completedFrames !== done) { done = R.completedFrames; g.push(R.lastGpuMs ?? 0); } }
        g.sort((a, b) => a - b); return { p50: +(g[g.length >> 1] ?? 0).toFixed(2), images: g.length, errors: R.gpuErrors }; })()`);
        await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
        await app.shot(`${OUT}/${tag}.png`);
        await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
        console.log(`  ${tag}: ${JSON.stringify(m)}`);
        expect((m as { errors: number }).errors).toBe(0);
      };
      await app.scenario("de jour : la couche des rues, avec et sans");
      await measure("jour-avec", true);
      await measure("jour-sans", false);
      await measure("jour-avec-2", true);
      await app.scenario("de nuit : avec et sans");
      await app.js(`(() => { __bh.game.setDate("2026-07-10T21:00:00Z"); __bh.touch(); return 1; })()`);
      await measure("nuit-avec", true);
      await measure("nuit-sans", false);
    } finally {
      app.close();
    }
  },
  900_000,
);
