import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5, VIPER C1 — the jitters' noise (trace.wgsl blueDraws: every jitter a channel of the blue noise, the interleaved gradient
// noise gone): the Alps from Chamonix at 2 500 m, cloudy, the Sun ~10° up, the F-35's cockpit looking west, frozen, the realtime
// image as drawn (its temporal filter on). 30 frames in a row: the flicker — the mean gap between a frame and the next in the
// upper half (sky, clouds) [8-bit levels] — and the grain — the mean of the frames' fine residue (each pixel against its 3 × 3
// neighbours' mean) [levels]. Run on two builds for an A/B (GR_OUT). Done when: the 30 frames read. Duration: ~2 min.
const OUT = process.env.GR_OUT ?? "remote-results/air-grain";
afterAll(stopServer);
test.skipIf(!E2E)(
  "VIPER C1: the flicker and the grain of the sky and the clouds, the realtime image frozen",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, weather: "cloudy" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(
        `(() => { __bh.game.setDate("2026-07-10T17:55:00Z"); __bh.game.flyAt(45.92, 6.87, 2500, 270, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(
        `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, 8); __bh.game.setDate("2026-07-10T17:55:00Z"); __bh.freeze(true); q(1); }, 500))`,
      );
      await app.settled(120_000);
      await app.exposureSettled();
      const m = await app.js<{ flicker: number; grain: number; frames: number }>(`(async () => {
        const f = () => new Promise((q) => requestAnimationFrame(q)), cv = document.querySelector("canvas");
        for (let i = 0; i < 90; i++) { __bh.touch(); await f(); }
        let prev = null, flick = 0, n = 0, sum = null, W = 0, H = 0, got = 0;
        for (let k = 0; k < 40 && got < 30; k++) {
          __bh.touch(); await f(); __bh.touch();
          const b = await new Promise((q) => requestAnimationFrame(() => q(createImageBitmap(cv))));
          W = b.width; H = Math.floor(b.height / 2);
          const o = new OffscreenCanvas(W, H), g = o.getContext("2d"); g.drawImage(b, 0, 0);
          const d = g.getImageData(0, 0, W, H).data;
          let mx = 0; for (let i = 0; i < d.length; i += 97) mx = Math.max(mx, d[i]);
          if (mx === 0) continue;
          const y = new Float32Array(W * H); for (let i = 0; i < W * H; i++) y[i] = 0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2];
          if (prev) { let s = 0; for (let i = 0; i < y.length; i++) s += Math.abs(y[i] - prev[i]); flick += s / y.length; n++; }
          prev = y; sum = sum ? sum.map((v, i) => v + y[i]) : y.slice(); got++;
        }
        let grain = 0, c = 0;
        for (let yy = 1; yy < H - 1; yy++) for (let x = 1; x < W - 1; x++) { const i = yy * W + x; let a = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += sum[i + dy * W + dx];
          grain += Math.abs(sum[i] - a / 9) / got; c++; }
        return { flicker: +(flick / Math.max(n, 1)).toFixed(3), grain: +(grain / c).toFixed(3), frames: got }; })()`);
      console.log(`  flicker ${m.flicker} levels, grain ${m.grain} levels, ${m.frames} frames`);
      await app.shot(`${OUT}/view.png`);
      writeFileSync(`${OUT}/grain.json`, JSON.stringify(m));
      expect(m.frames).toBeGreaterThan(20);
      expect(await app.js<number>(`__bh.renderer.gpuErrors`)).toBe(0);
    } finally {
      await app.close();
    }
  },
  5 * 60_000,
);
