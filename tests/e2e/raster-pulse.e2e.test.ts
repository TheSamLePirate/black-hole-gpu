import { afterAll, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The raster image's sharpness over time in low flight over Paris — does it pulse (a blur every second or so as the tiles
// land and the terrain cache bakes its levels again)? The F-35 at 300 m over the city, 120 m/s (level, the nose on the horizon), gear down (the autopilot holds
// the height, the autothrottle the speed), the cockpit view, the game's own settings (quality "game") but every pixel shaded at the native scale (the raster's
// aim — docs/progress/raster-aaa/TERRE-UNREAL.md), real tiles streaming.
// The ground's detail (the mean luminance step between neighbouring pixels over the city ahead) read from a screenshot ~4
// times a second for 40 s: its median, its 10th percentile and its dips (under 0.8 × the median); the cache's bakes and the
// frame rate over the same span. A/B between two builds in one Chrome (scripts/ab-commit.ts: AB_A_URL, AB_B_URL), rounds
// A B B A (AB_ROUNDS pairs); else this build alone. Figures in $AB_OUT/pulse.json, shots pulse-<side><round>.png.
// Duration: ~3 min a side on kerr-mini, its shaders cached.
// Done when: every side flown, its figures written.

const PARIS = { lat: 48.8566, lon: 2.3022 };
const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthRasterShading: "every", earthRasterScale: 1, dynamicResolution: false, autoGear: false, f35AutoProtect: false }`;
const SIDES = [
  ["A", process.env.AB_A_URL],
  ["B", process.env.AB_B_URL],
].filter((s): s is [string, string] => !!s[1]);
const ROUNDS = Number(process.env.AB_ROUNDS ?? 1);
const OUT = process.env.AB_OUT ?? "remote-results";

afterAll(stopServer);

test.skipIf(!E2E)(
  "low flight over Paris: the raster image's sharpness over time, per build",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    if (!SIDES.length) SIDES.push(["H", app.url]);
    const results: Record<string, unknown>[] = [];
    // (the city ahead, just under the horizon (level flight: ~0.72 of the height), left of the HUD's centre, over the canopy's frame)
    const detail = async () => {
      const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 92 });
      return app.js<number>(`(async () => {
        const b = await (await fetch("data:image/jpeg;base64,${data}")).blob(), i = await createImageBitmap(b);
        const c = new OffscreenCanvas(i.width, i.height), g = c.getContext("2d"); g.drawImage(i, 0, 0);
        const x0 = Math.round(0.3 * i.width), x1 = Math.round(0.46 * i.width), y0 = Math.round(0.735 * i.height), y1 = Math.round(0.79 * i.height);
        const px = g.getImageData(x0, y0, x1 - x0, y1 - y0).data, w = x1 - x0;
        const L = (k) => 0.2126 * px[4 * k] + 0.7152 * px[4 * k + 1] + 0.0722 * px[4 * k + 2];
        let sum = 0, n = 0;
        for (let y = 0; y < y1 - y0; y++) for (let x = 1; x < w; x++) { sum += Math.abs(L(y * w + x) - L(y * w + x - 1)); n++; }
        return +(sum / n).toFixed(2); })()`);
    };
    const place = `__bh.game.flyAt(${PARIS.lat}, ${PARIS.lon}, 300, 90, 120); __bh.settings.shipMount = "cockpit";
      { const c = __bh.camera; c.gearDown = true; c.gearExt = 1; c.gearInit = true; }`;
    const STATE = `(() => { const r = __bh.renderer, p = __bh.game.perf({ gpu: false });
      return { builds: r.terrainSurfaceCache?.builds ?? 0, fps: p.renderFps, rate: p.terrainRaster?.rate ?? null, scale: +p.renderScale.toFixed(3),
        block: p.block, pipe: r.earthPipelineNow(__bh.settings), gear: __bh.camera.gearDown, frames: r.completedFrames }; })()`;
    const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))] ?? NaN;

    for (let round = 0; round < ROUNDS; round++) {
      const order = round % 2 ? [...SIDES].reverse() : SIDES;
      for (const [side, url] of order) {
        const label = `${side}${round}`;
        (app as unknown as { url: string }).url = url;
        await app.load("scene=game:artemis");
        await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
        await app.js(`(() => { __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`);
        await Bun.sleep(1000);
        // (placed, held while the city's tiles come in, placed again over the ground they give)
        await app.js(`(() => { ${place} __bh.freeze(true); return 1; })()`);
        const ground = (cond: string) =>
          app.waitFor(`(() => { const t = __bh.renderer.earthTiles; return ${cond}; })()`, 120_000).catch(() => {});
        await ground("t.finest >= 14 && t.pending === 0");
        await app.js(`(() => { ${place} return 1; })()`);
        await ground("t.pending === 0");
        await app.settled();
        await app.js(`(__bh.freeze(false), 1)`);
        await Bun.sleep(1200);
        await app.js(`(() => { const c = __bh.camera;
          if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          if (c.jetModes.spd !== null) c.jetModes.spd = 120; return 1; })()`);
        await Bun.sleep(5000);
        // (the raster's kernels for the scene with its buildings — minutes of compiles on an M1: measured before them, the near
        // Earth was the traced blocks' fallback)
        await app
          .waitFor(
            `__bh.renderer.rasterLiteActive && (__bh.renderer.featureKey & 8192) !== 0 && __bh.renderer.variantQueue.pending === 0`,
            600_000,
          )
          .catch(() => console.warn("  raster kernels not all in"));
        if (process.env.PULSE_LEVERS) {
          // (PULSE_LEVERS="name=js;name=js…": in the same flight, each lever's image 2.5 s after it is set — then undone —, its
          // detail and a shot; twice round)
          const levers = process.env.PULSE_LEVERS.split(";").map((x) => x.split("=") as [string, string]);
          for (let k = 0; k < 2; k++)
            for (const [name, js] of levers) {
              await app.js(`(() => { ${js}; return 1; })()`);
              // (a held view — name "freeze" — refines for a few seconds: ~3 s a full pass on an M1)
              await Bun.sleep(name.startsWith("freeze") ? 9000 : 2500);
              const d = await detail();
              await app.shot(`${OUT}/pulse-${label}-${name}${k}.png`);
              const st = await app.js<Record<string, unknown>>(STATE);
              // (the GPU's passes this lever — the compute passes' timestamps are sound on Apple, the render passes' overlap)
              const passes =
                await app.js<string>(`(async () => { const r = __bh.renderer; r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
                await new Promise((q) => setTimeout(q, 1500));
                return r.prof.table().filter((p) => p.last > 0.5).sort((a, b) => b.last - a.last).slice(0, 12).map((p) => p.label + " " + p.last.toFixed(1)).join(", "); })()`);
              console.log(`  ${label}: ${name} #${k} — detail ${d}, ${JSON.stringify(st)}\n    passes: ${passes}`);
              results.push({ side, round, lever: name, k, d, st });
            }
          writeFileSync(`${OUT}/pulse.json`, JSON.stringify(results, null, 1));
          continue;
        }
        const s0 = await app.js<Record<string, number>>(STATE);
        const t0 = Date.now();
        // (40 s: past the raster's fallback, 12 s over its budget at its floor — main.ts —, and the 6 s it is then measured)
        const series: { t: number; d: number; pipe: string; tiles: string }[] = [];
        while (Date.now() - t0 < 40_000)
          series.push({
            t: +((Date.now() - t0) / 1000).toFixed(2),
            d: await detail(),
            pipe: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`),
            // (the tiles under it: the finest relief and orthophotos drawn, those still coming)
            tiles: await app.js<string>(
              `(() => { const t = __bh.renderer.earthTiles; return [t.finest, t.orthoFinest, t.pending, t.orthoPending].join("/"); })()`,
            ),
          });
        const s1 = await app.js<Record<string, unknown>>(STATE);
        await app.shot(`${OUT}/pulse-${label}.png`);
        const ds = series.map((x) => x.d);
        const med = pct(ds, 0.5);
        const r = {
          side,
          round,
          samples: ds.length,
          median: med,
          p10: pct(ds, 0.1),
          dips: ds.filter((d) => d < 0.8 * med).length,
          traced: series.filter((x) => x.pipe === "trace").length,
          bakes: (s1.builds as number) - s0.builds!,
          fps: +((1000 * ((s1.frames as number) - s0.frames!)) / (Date.now() - t0)).toFixed(1),
          end: s1,
          series,
        };
        console.log(
          `  ${label}: detail median ${r.median}, p10 ${r.p10}, dips ${r.dips}/${r.samples}, traced ${r.traced}, bakes ${r.bakes}, fps ${r.fps}, ${JSON.stringify(s1)}`,
        );
        results.push(r);
        writeFileSync(`${OUT}/pulse.json`, JSON.stringify(results, null, 1));
      }
    }
  },
  1_800_000,
);
