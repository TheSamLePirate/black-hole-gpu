import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// T7 — the sea's repeated pattern (docs/PLAN-REFRACTION-HORIZONS.md T7: "no pattern of 2 to 20 km"; sea/spectrum.ts: three
// cascades of 1 024, 128 and 16 m): the open Mediterranean seen from above — the F-35 at H m, the camera over it looking nearly
// straight down (the "around" mount, pitch 85°), frozen, the Sun high and then low (its glint, where a tiling shows most). The
// shots are analysed afterwards (their autocorrelation: a peak at the 1 024 m tile's period on the image is the repetition).
// Output: remote-results/sea-repeat/<sun>-<H>.png, sea-repeat.json (SR_OUT) — the metres a pixel at the image's centre with each.
// Done when: the shots taken (the camera's height over the sea checked), no GPU error (its text said). Duration: ~2 min.
const OUT = process.env.SR_OUT ?? "remote-results/sea-repeat";
afterAll(stopServer);
const HEIGHTS = (process.env.SR_H ?? "6000,12000").split(",").map(Number);
const SUNS = [
  { name: "noon", date: "2026-07-10T11:30:00Z" },
  { name: "low", date: "2026-07-10T18:40:00Z" },
];

test.skipIf(!E2E)(
  "T7: the open sea from above, high and low Sun — shots for the tile's repetition",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0, lookProfile: "neutral", traffic: false, f35Invulnerable: true }); __bh.game.set("weather", "fair"); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const sun of SUNS)
        for (const H of HEIGHTS) {
          const name = `${sun.name}-${H}`;
          // (placed, the view about it set while the world runs, then frozen)
          await app.js(`(() => { __bh.freeze(false); __bh.game.setDate(${JSON.stringify(sun.date)}); __bh.game.flyAt(38.2, 5.4, ${H}, 270, 200);
            __bh.settings.shipMount = "around"; document.body.classList.add("hide-ui"); return 1; })()`);
          await Bun.sleep(600);
          await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 0, pitch: 85, dist: 300 }); return 1; })()`);
          await Bun.sleep(1500);
          await app.js(`(() => { __bh.freeze(true); return 1; })()`);
          await app.settled(60_000);
          await app.exposureSettled();
          await app.js(
            `new Promise((q) => { let k = 0; const f = () => { __bh.touch(); if (++k < 40) requestAnimationFrame(f); else q(1); }; f(); })`,
          );
          await app.shot(`${OUT}/${name}.png`);
          const st = await app.js<{ alt: number; fov: number; mount: string; pitch: number }>(`(() => { const g = __bh.camera.geoNow();
            return { alt: Math.round(g?.alt ?? 0), fov: __bh.settings.fov, mount: __bh.settings.shipMount, pitch: __bh.camera.outside.pitch }; })()`);
          // (the metres a pixel at the image's centre: the camera ~ the craft's height, looking down — fov the vertical field)
          out[name] = { ...st, mPerPx: +((2 * st.alt * Math.tan((st.fov * Math.PI) / 360)) / 800).toFixed(2) };
          console.log(`  ${name}: ${JSON.stringify(out[name])}`);
        }
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      out.gpuMessages = app.cdp.errors.filter((e) => /WebGPU/i.test(e)).slice(0, 3);
    } finally {
      await Bun.write(`${OUT}/sea-repeat.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  6 * 60_000,
);
