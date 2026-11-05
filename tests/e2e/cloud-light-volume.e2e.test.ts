import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q5 — the clouds' light volume (trace.wgsl cloudLightVolume, clvTau; renderer.cloudLightVolumeOn): the cloud pass's samples
// read the sunlight's optical depth past their first 180 m from a volume about the camera, computed once a frame, rather than
// marching six densities and the shadow map each. The F-35's cockpit, frozen, the exposure locked at the first shot's:
// La Mancha "overcast" from 7 000 m 4° down at 13:00 UTC, a "storm" from 3 000 m at 17:30 UTC. At each: the volume, the march
// (cloudLightVolumeOn false: as before), the reference (TUNE_GSKIP 4194304: every cloud on the sunbeam marched out to 120 km),
// the volume again (the measure's noise); a shot and the passes' cost (2 s) each, the error to the reference (rms, 8-bit
// levels, the upper three quarters). CV_OUT: the shots (remote-results/cloud-light-volume).
// Duration: ~5 min on this Mac.
// Done when: the eight shots taken, each mode's pass costs and error logged, no GPU error.
const OUT = process.env.CV_OUT ?? "remote-results/cloud-light-volume";
afterAll(stopServer);
test.skipIf(!E2E)(
  "the clouds' light volume: its cost and its error against the reference, beside the march",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster" }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      for (const [place, wx, iso, alt, hdg, pitch] of [
        ["overcast", "overcast", "2026-07-10T13:00:00Z", 7000, 90, -4],
        ["storm", "storm", "2026-07-10T17:30:00Z", 3000, 90, 1],
      ] as const) {
        await app.js(
          `(() => { __bh.game.setDate("${iso}"); __bh.settings.autoExposure = true; __bh.settings.exposure = 0; __bh.game.set("weather", "${wx}"); __bh.game.set("earthClouds", 1); __bh.game.flyAt(39.42, -3.05, ${alt}, ${hdg}, 140); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
        );
        await app.js(
          `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, ${pitch}); __bh.game.setDate("${iso}"); __bh.freeze(true); q(1); }, 800))`,
        );
        let locked = false;
        const shots: Record<string, { data: Uint8Array; w: number; h: number; c: number }> = {};
        for (const [k, js] of [
          ["vol", "__bh.renderer.tune = {}; __bh.renderer.cloudLightVolumeOn = true;"],
          ["march", "__bh.renderer.tune = {}; __bh.renderer.cloudLightVolumeOn = false;"],
          ["ref", "__bh.renderer.tune = { TUNE_GSKIP: 4194304 }; __bh.renderer.cloudLightVolumeOn = true;"],
          ["vol2", "__bh.renderer.tune = {}; __bh.renderer.cloudLightVolumeOn = true;"],
        ] as const) {
          await app.js(`(() => { ${js} return 1; })()`);
          await app.settled(120_000);
          // (frozen: the raster's shading round every pixel, the clouds' history converged)
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 120; i++) { __bh.touch(); await f(); } return 1; })()`,
          );
          // (the exposure locked at the meter's reading after the first: the four shots exposed alike)
          if (!locked) {
            const ev = await app.js<number>(
              `(() => { const ev = __bh.renderer.autoEV; __bh.settings.autoExposure = false; __bh.settings.exposure = ev; return ev; })()`,
            );
            await app.js(
              `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 30; i++) { __bh.touch(); await f(); } return 1; })()`,
            );
            console.log(`  ${place}: exposure locked at ${ev.toFixed(2)} EV`);
            locked = true;
          }
          const m = await app.js<{ clouds: number; csm: number; clv: number; total: number }>(`(async () => {
            const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
            r.prof.enabled = true; r.prof.reset(); const t0 = performance.now();
            while (performance.now() - t0 < 2000) { __bh.touch(); await f(); }
            const rows = r.prof.table(); const g = (re) => +rows.filter((p) => re.test(p.label)).reduce((s, p) => s + p.ms, 0).toFixed(3);
            const total = +r.prof.frameMs.toFixed(2); r.prof.enabled = false;
            return { clouds: g(/^clouds \\(half\\)/), csm: g(/clouds' shadow map/), clv: g(/clouds' light volume/), total }; })()`);
          const pipe = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
          const mount = await app.js<string>(`__bh.settings.shipMount`);
          out[`${place}-${k}`] = { ...m, pipe, mount };
          await app.shot(`${OUT}/${place}-${k}.png`);
          const img = readPng(new Uint8Array(await Bun.file(`${OUT}/${place}-${k}.png`).arrayBuffer()));
          shots[k] = { data: img.data, w: img.width, h: img.height, c: img.channels };
          console.log(
            `  ${place} ${k}: clouds ${m.clouds} ms, light volume ${m.clv} ms, shadow map ${m.csm} ms, GPU ${m.total} ms (${pipe}, ${mount})`,
          );
        }
        // (each against the reference: rms over the upper three quarters, 8-bit levels)
        const rms = (a: string, b: string) => {
          const A = shots[a]!;
          const B = shots[b]!;
          let se = 0;
          let n = 0;
          for (let y = 0; y < 0.75 * A.h; y++)
            for (let x = 0; x < A.w; x++) {
              const o = (y * A.w + x) * A.c;
              for (let c = 0; c < 3; c++) {
                const d = A.data[o + c]! - B.data[o + c]!;
                se += d * d;
                n++;
              }
            }
          return Math.sqrt(se / n);
        };
        const errs = { vol: rms("vol", "ref"), march: rms("march", "ref"), noise: rms("vol", "vol2") };
        out[`${place}-rms`] = errs;
        console.log(
          `  ${place}: rms to the reference — volume ${errs.vol.toFixed(2)}, march ${errs.march.toFixed(2)}; volume vs volume ${errs.noise.toFixed(2)}`,
        );
      }
      await app.js(
        `(() => { __bh.renderer.tune = {}; __bh.renderer.cloudLightVolumeOn = true; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      console.log(`  GPU errors ${out.gpuErrors}`);
      if (out.gpuErrors) console.log(`  the first: ${JSON.stringify((app.cdp.errors ?? []).slice(0, 3)).slice(0, 1500)}`);
    } finally {
      await Bun.write(`${OUT}/volume.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect(out.gpuErrors).toBe(0);
  },
  12 * 60_000,
);
