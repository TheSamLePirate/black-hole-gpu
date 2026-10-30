import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Does the walker shake? (the user saw it on kerr-mini, PLAN-PLANETES-AAA P5.) The astronaut standing on Mann, the Moon — then
// Edmunds — the scene's clock running: three seconds of every frame shown (the DevTools screencast, as the eye sees them), the
// helmet's shift from one frame to the next [px] (block matching in the page) and the ground's beside it, with the body raster
// on, then off (the tracer's march). A shake shows as the helmet jumping while the ground holds; the idle clip's breathing
// (~1.5 cm over 2 s) moves it well under a pixel a frame. Its placement read through the rig's own coordinates lost millimetres a
// frame — a pixel at the camera's 4.5 m: character.ts `placed`. A dark view (night where he stands) is said and skipped.
// Duration: ~4 min on kerr-mini.
// Done when: each world measured both ways, the helmet within a pixel from frame to frame.

afterAll(stopServer);

test.skipIf(!E2E)(
  "the walker held still: the helmet within a pixel from one frame to the next, body raster on and off",
  async () => {
    const app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Mann: the ice world")}` });
    const worst: Record<string, number> = {};
    try {
      for (const body of (process.env.ONLY ?? "mann,moon,edmunds").split(",")) {
        const scene = { edmunds: "Edmunds: the desert world", mann: "Mann: the ice world", moon: "Mars: from orbit" }[body]!;
        for (const on of [true, false]) {
          await app.js(`(() => { __bh.renderer.bodyRasterOn = ${on}; __bh.game.preset(${JSON.stringify(scene)});
            Object.assign(__bh.settings, { animate: false, damage: false, showFps: true });
            __bh.camera.character.start(${JSON.stringify(body)}, 10, 0); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return 1; })()`);
          await app.js(`(async () => { const r = __bh.renderer, t0 = performance.now();
            for (let i = 0; i < 4; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
            while ((!r.kernelsSettled || r.compilesPending > 0) && performance.now() - t0 < 600000) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); }
            for (let i = 0; i < 90; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`);
          await app.settled();
          const cast: string[] = [];
          const off = app.cdp.on("Page.screencastFrame", (p) => {
            cast.push(p.data as string);
            void app.cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId });
          });
          await app.cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
          await Bun.sleep(3000);
          await app.cdp.send("Page.stopScreencast", {});
          off();
          // (SAVE=dir: the frames kept)
          if (process.env.SAVE) {
            mkdirSync(process.env.SAVE, { recursive: true });
            for (const [k, d] of cast.entries())
              await Bun.write(`${process.env.SAVE}/${body}-${on ? "raster" : "traced"}-cast-${k}.jpg`, Buffer.from(d, "base64"));
          }
          // (each frame's grey over the helmet's box and the ground's, a 4 px margin round them; then the shift between two
          // frames that matches them best, ±4 px)
          // (frame by frame: a few hundred kilobytes each over DevTools)
          await app.js(`(() => { window.__wj = []; return 1; })()`);
          for (const d of cast)
            await app.js(`(async () => {
              const R = 4, i = await createImageBitmap(await (await fetch("data:image/jpeg;base64,${d}")).blob());
              const c = new OffscreenCanvas(i.width, i.height), g = c.getContext("2d"); g.drawImage(i, 0, 0);
              const cut = (x0, y0, x1, y1) => {
                const X = Math.round(x0 * i.width) - R, Y = Math.round(y0 * i.height) - R, w = Math.round((x1 - x0) * i.width) + 2 * R, h = Math.round((y1 - y0) * i.height) + 2 * R;
                const p = g.getImageData(X, Y, w, h).data, o = new Float32Array(w * h);
                for (let k = 0; k < w * h; k++) o[k] = 0.3 * p[4 * k] + 0.59 * p[4 * k + 1] + 0.11 * p[4 * k + 2];
                return { o, w, h };
              };
              window.__wj.push([cut(0.43, 0.3, 0.55, 0.45), cut(0.1, 0.62, 0.3, 0.8)]); return 1; })()`);
          const m = await app.js<{ helmet: number[][]; ground: number[][]; light: number }>(`(() => {
            const R = 4, g = window.__wj;
            const shift = (a, b) => {
              let best = [Infinity, 0, 0];
              for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
                let e = 0;
                for (let y = R; y < a.h - R; y++) for (let x = R; x < a.w - R; x++) { const d = a.o[y * a.w + x] - b.o[(y + dy) * a.w + x + dx]; e += d * d; }
                if (e < best[0]) best = [e, dx, dy];
              }
              return [best[1], best[2]];
            };
            let light = 0; for (const v of g[0][0].o) light += v; light /= g[0][0].o.length;
            const helmet = [], ground = [];
            for (let k = 1; k < g.length; k++) { helmet.push(shift(g[k - 1][0], g[k][0])); ground.push(shift(g[k - 1][1], g[k][1])); }
            window.__wj = null;
            return { helmet, ground, light }; })()`);
          const jump = (s: number[][]) => Math.max(0, ...s.map(([x, y]) => Math.hypot(x!, y!)));
          const moved = (s: number[][]) => s.filter(([x, y]) => x || y).length;
          const st = await app.js<Record<string, unknown>>(
            `(() => ({ raster: __bh.renderer.bodyRasterNow, walking: __bh.camera.character.active, rate: __bh.renderer.rasterRate, pipeline: __bh.renderer.earthPipelineNow?.(__bh.settings) }))()`,
          );
          const key = `${body} raster ${on ? "on " : "off"}`;
          if (m.light < 12) console.log(`  ${key}: the view dark (night where he stands, grey ${m.light.toFixed(0)}) — not measured`);
          else {
            worst[key] = jump(m.helmet);
            console.log(
              `  ${key}: ${cast.length} frames in 3 s; helmet's jump frame to frame ≤ ${jump(m.helmet).toFixed(1)} px (${moved(m.helmet)} moved), ground's ≤ ${jump(m.ground).toFixed(1)} px (${moved(m.ground)}) ${JSON.stringify(st)}`,
            );
          }
          await app.js(`(() => { __bh.camera.character.stop(); return 1; })()`);
        }
      }
    } finally {
      app.close();
    }
    for (const [key, px] of Object.entries(worst)) expect(px, key).toBeLessThanOrEqual(1.5);
  },
  1_800_000,
);
