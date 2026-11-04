import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 C5 — the real weather's model on a grid about the camera (system/weather-grid.ts; renderer.weatherGridOn,
// weatherGridEnabled; trace.wgsl wxGridCover): the real weather now over Brittany (48.2° N, 3.5° W) from 3 000 m, the F-35's
// cockpit then the view round it (north, east, south, west), frozen — the grid on, then off (the camera's cover carried round
// it): shots, the sky's upper third. The 25 points' covers and visibilities printed (their spread: the weather's variety within
// 250 km — the haze read on the grid too, wxHazeExt).
// WG_AT=lat,lon: another place. WG_OUT: where the shots go (remote-results/weather-grid).
// Done when: the grid in (or said missing after 30 s), the four headings shot both ways, no GPU error. Duration: ~3 min.
const OUT = process.env.WG_OUT ?? "remote-results/weather-grid";
afterAll(stopServer);
test.skipIf(!E2E)(
  "Q5 C5: the real weather's clouds where the model has them about the camera, not the camera's cover carried round it",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const [lat, lon] = (process.env.WG_AT ?? "48.2,-3.5").split(",").map(Number) as [number, number];
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, weather: "real" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = `${new Date().toISOString().slice(0, 13)}:00:00Z`;
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.flyAt(${lat}, ${lon}, 3000, 0, 160); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      out.grid = await app.waitFor(`__bh.renderer.weatherGridOn`, 30_000).then(
        () => "in",
        () => "the grid not in after 30 s",
      );
      out.covers = await app.js(
        `(() => { const r = __bh.renderer; const g = r.weatherGrid.peek(${lat}, ${lon}, Date.parse("${iso}")); return g ? { centre: g.centre, low: Array.from({ length: 25 }, (_, k) => +g.v[4 * k].toFixed(2)), mid: Array.from({ length: 25 }, (_, k) => +g.v[4 * k + 1].toFixed(2)), high: Array.from({ length: 25 }, (_, k) => +g.v[4 * k + 2].toFixed(2)), vis: Array.from({ length: 25 }, (_, k) => Math.round(g.v[4 * k + 3])) } : null; })()`,
      );
      console.log(`  grid ${out.grid}: ${JSON.stringify(out.covers)}`);
      await app.js(`new Promise((q) => setTimeout(() => { __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 500))`);
      await app.settled(120_000);
      for (const [k, on] of [
        ["on", true],
        ["off", false],
      ] as const) {
        for (const yaw of [0, 90, 180, 270]) {
          const m = await app.js<number[]>(`(async () => {
            const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
            r.weatherGridEnabled = ${on}; __bh.camera.setLook(${yaw}, 4);
            for (let i = 0; i < 120; i++) { __bh.touch(); await frame(); }
            const cv = document.querySelector("canvas"); let b, d, mx = 0;
            for (let k = 0; k < 20 && mx === 0; k++) { __bh.touch(); await frame(); __bh.touch();
              b = await new Promise((q) => requestAnimationFrame(() => q(createImageBitmap(cv))));
              const o = new OffscreenCanvas(b.width, b.height), g = o.getContext("2d"); g.drawImage(b, 0, 0);
              d = g.getImageData(0, 0, b.width, b.height).data; for (let i = 0; i < d.length; i += 64) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]); }
            const s = [0, 0, 0]; let n = 0; for (let y = Math.round(0.05 * b.height); y < Math.round(0.45 * b.height); y += 2) for (let x = 0; x < b.width; x += 2) { const i = 4 * (y * b.width + x); s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; }
            return s.map((v) => +(v / n).toFixed(1)); })()`);
          await app.shot(`${OUT}/${k}-${yaw}.png`);
          out[`${k}-${yaw}`] = m;
          console.log(`  ${k} heading ${yaw}°: sky ${JSON.stringify(m)}`);
        }
      }
      await app.js(`(() => { __bh.renderer.weatherGridEnabled = true; return 1; })()`);
      out.pipeline = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  pipeline ${out.pipeline}, GPU errors ${out.gpuErrors}`);
    } finally {
      await Bun.write(`${OUT}/grid.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
    expect(out.grid).toBe("in");
  },
  8 * 60_000,
);
