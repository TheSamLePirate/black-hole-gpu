import { afterAll, expect, test } from "bun:test";
import { writeFileSync, mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The twilight sky's brightness (Q2's night; renderer twilightK): over Paris on 10 July 2026, the Sun from +7° to −19°
// (geometric), the clear sky's light on a level ground read from the tracer's own harmonics (renderer.skyTable — sky ambient),
// its fall from the sunset against the tabulated twilight (renderer.ts TWILIGHT: 400 lux at sunset, 3.4 at −6°, 0.008 at −12°).
// The simple air's own twilight fell far too slowly — 17 × too bright at −6.6°, 140–160 × at −11…−14° —: the dusk's glow burnt
// over the night's lit towns, orange (Sam). TW_OFF=1: the raw air (no calibration) for a measure.
// Done when: the samples from 19:00 to 23:30 UTC are read and the fall stays within 2.5 × the table's at −6.6, −10.9 and −12.8°.
// Duration: ~1 min (this Mac).
const OUT = "remote-results/twilight-sky";
afterAll(stopServer);

test.skipIf(!E2E)(
  "the twilight sky: its light's fall from the sunset as the tabulated twilight's",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 960, height: 600, hash: "scene=game:artemis", tiles: false });
    try {
      await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.earthClouds = 0; return 1; })()`);
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(
        `(() => { __bh.game.flyAt(48.85, 2.3, 300, 300, 120); __bh.freeze(true); __bh.renderer.twilightOn = ${process.env.TW_OFF ? "false" : "true"}; return 1; })()`,
      );
      const rows: { utc: string; el: number; irr: number }[] = [];
      for (let m = 19 * 60; m <= 23 * 60 + 30; m += 10) {
        const utc = `2026-07-10T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00Z`;
        const r = await app.js<{ el: number; irr: number }>(`(async () => {
          __bh.game.setDate(${JSON.stringify(utc)}); __bh.freeze(true);
          const frame = () => new Promise((q) => requestAnimationFrame(() => q(1)));
          for (let i = 0; i < 12; i++) { __bh.touch(); await frame(); }
          const v = await __bh.renderer.skyTable();
          // (a level ground's irradiance from the harmonics' first two bands at the camera's height — skyIrradianceLow, n = up)
          const k = 0.488603 * 2.0943951, c = (i) => [v[(4 + i) * 4], v[(4 + i) * 4 + 1], v[(4 + i) * 4 + 2]];
          const irr = [0, 1, 2].map((ch) => 0.282095 * Math.PI * c(0)[ch] + k * c(2)[ch]);
          const lum = 0.2126 * irr[0] + 0.7152 * irr[1] + 0.0722 * irr[2];
          return { el: +(__bh.camera.skyInfo?.().sun?.altDeg ?? NaN).toFixed(2), irr: lum, valid: v[3], k: +__bh.renderer.twilightK.toFixed(4) };
        })()`);
        rows.push({ utc, ...r });
        console.log(`  ${utc.slice(11, 16)} Sun ${r.el}°: sky on the ground ${r.irr.toExponential(3)} (k ${(r as { k?: number }).k})`);
      }
      writeFileSync(`${OUT}/twilight.json`, JSON.stringify(rows, null, 1));
      // (the fall from the sunset — the sample nearest 0° — against the table's, at three depressions: within 2.5 ×)
      const table = (el: number) => {
        const T: [number, number][] = [
          [0, 400],
          [-1, 250],
          [-2, 150],
          [-3, 80],
          [-4, 35],
          [-5, 12],
          [-6, 3.4],
          [-8, 0.4],
          [-10, 0.04],
          [-12, 0.008],
          [-15, 0.002],
          [-18, 0.0007],
        ];
        for (let i = 1; i < T.length; i++)
          if (el >= T[i]![0]) {
            const f = (el - T[i - 1]![0]) / (T[i]![0] - T[i - 1]![0]);
            return 10 ** (Math.log10(T[i - 1]![1]) + f * (Math.log10(T[i]![1]) - Math.log10(T[i - 1]![1])));
          }
        return 0.0007;
      };
      const near = (el: number) => rows.reduce((a, b) => (Math.abs(b.el - el) < Math.abs(a.el - el) ? b : a));
      const s0 = near(0);
      for (const el of [-6.6, -10.9, -12.8]) {
        const r = near(el);
        const ratio = r.irr / s0.irr / (table(r.el) / table(s0.el));
        console.log(
          `  Sun ${r.el}°: the fall ${(r.irr / s0.irr).toExponential(2)}, the table's ${(table(r.el) / table(s0.el)).toExponential(2)} — ×${ratio.toFixed(2)}`,
        );
        if (!process.env.TW_OFF) {
          expect(ratio).toBeLessThan(2.5);
          expect(ratio).toBeGreaterThan(1 / 2.5);
        }
      }
    } finally {
      app.close();
    }
  },
  5 * 60_000,
);
