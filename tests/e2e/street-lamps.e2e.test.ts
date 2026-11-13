import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// Q8 L10 — the streets' lamps (system/streetlamps.ts: poles and heads along the town streets in the scenery's meshes, their
// light's pools baked in a 4 m grid; trace.wgsl sceneryLampLight, shadeLite's night): over a town at night (SL_SITE "lat,lon",
// Châteaudun), the F-35 SL_ALT m over the ground facing SL_HDG, the cockpit looking SL_PITCH, frozen, the exposure locked: the
// lamps on — counted, a shot, another a second later (the noise) —, then off (settings.earthStreetLamps: the scene rebuilt
// without them) — a shot; the frames' interval (the GPU's completions), the mean luminance and the PSNRs.
// SL_STRICT=1: then the lamps again, their scene rebuilt as the plain one's (the cost on two rebuilt scenes).
// SL_ISO: the time (a July night: "2026-07-10T22:30:00Z"; a day's for the poles by day). SL_OUT: the shots
// (remote-results/street-lamps).
// Duration: ~4 min on this Mac.
// Done when: the lamps counted (some), the three shots taken, no GPU error.
const OUT = process.env.SL_OUT ?? "remote-results/street-lamps";
const [LAT, LON] = (process.env.SL_SITE ?? "48.0707,1.3383").split(",").map(Number) as [number, number];
const HDG = Number(process.env.SL_HDG ?? 90);
const ALT = Number(process.env.SL_ALT ?? 60);
const PITCH = Number(process.env.SL_PITCH ?? -20);
const ISO = process.env.SL_ISO ?? "2026-07-10T22:30:00Z";
afterAll(stopServer);
test.skipIf(!E2E)(
  "L10: the streets' lamps at night — counted, their pools against the even wash, the frame",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", weather: "fair", earthStreetLamps: true }); __bh.game.set("earthClouds", 0); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(
        `(() => { __bh.game.setDate("${ISO}"); __bh.game.flyAt(${LAT}, ${LON}, ${ALT}, ${HDG}, 0); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(
        `new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, ${PITCH}); __bh.game.setDate("${ISO}"); __bh.freeze(true); q(1); }, 800))`,
      );
      const ready = (lamps: string) =>
        app
          .waitFor(
            `(() => { __bh.touch(); const r = __bh.renderer, sc = r.earthScenery.stats(); return r.earthTiles.pending === 0 && r.earthTiles.orthoPending === 0 && sc.status === "ready" && !sc.pending && ${lamps}; })()`,
            180_000,
          )
          .catch(async () =>
            console.warn(
              `  not all in after 180 s — ${await app.js<string>(`JSON.stringify((() => { const r = __bh.renderer, sc = r.earthScenery.stats(); return { tiles: r.earthTiles.pending, ortho: r.earthTiles.orthoPending, scenery: sc.status, pending: sc.pending, lamps: sc.lamps, error: sc.lastError, surveyError: sc.surveyError, budgetLimited: sc.budgetLimited }; })())`)}`,
            ),
          );
      await ready("sc.lamps > 0");
      await app.settled(120_000);
      const frames = (n: number) =>
        app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${n}; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
      await frames(150);
      await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
      const shots: Record<string, Uint8Array> = {};
      let W = 0,
        H = 0,
        C = 3;
      const take = async (k: string) => {
        await frames(120);
        const fr = await app.js<number>(`(async () => {
          const r = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
          await f(); const c0 = r.completedFrames, t0 = performance.now();
          while (performance.now() - t0 < 3000) { __bh.touch(); await f(); }
          return +((performance.now() - t0) / Math.max(1, r.completedFrames - c0)).toFixed(1); })()`);
        await app.shot(`${OUT}/${k}.png`);
        const p = readPng(new Uint8Array(await Bun.file(`${OUT}/${k}.png`).arrayBuffer()));
        shots[k] = p.data;
        W = p.width;
        H = p.height;
        C = p.channels;
        out[k] = {
          frameMs: fr,
          lamps: await app.js<number>(`__bh.renderer.earthScenery.stats().lamps`),
          scenery: await app.js<string>(
            `(() => { const sc = __bh.renderer.earthScenery.stats(); return sc.status + (sc.pending ? " pending" : "") + (sc.budgetLimited ? " budget-limited" : ""); })()`,
          ),
          pipe: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings) + " " + __bh.settings.shipMount`),
        };
      };
      await take("lamps");
      await take("lamps2");
      await app.js(`(() => { __bh.settings.earthStreetLamps = false; __bh.touch(); return 1; })()`);
      await app.waitOptional(`(() => { __bh.touch(); return __bh.renderer.earthScenery.stats().pending; })()`, 30_000);
      await ready("sc.lamps === 0");
      await app.settled(120_000);
      await take("plain");
      // (SL_STRICT=1: the lamps again — their scene rebuilt as the plain one was: the cost compared on two rebuilt scenes)
      if (process.env.SL_STRICT) {
        await app.js(`(() => { __bh.settings.earthStreetLamps = true; __bh.touch(); return 1; })()`);
        await app.waitOptional(`(() => { __bh.touch(); return __bh.renderer.earthScenery.stats().pending; })()`, 30_000);
        await ready("sc.lamps > 0");
        await app.settled(120_000);
        await take("lamps3");
      }
      const psnr = (a: Uint8Array, b: Uint8Array) => {
        let se = 0;
        for (let i = 0; i < a.length; i++) se += (a[i]! - b[i]!) ** 2;
        return +(10 * Math.log10((255 * 255) / Math.max(se / a.length, 1e-9))).toFixed(2);
      };
      // (the mean luminance [0–255] of the image's lower two thirds — the town's ground —, the HUD's bottom 60 px left out)
      const mean = (d: Uint8Array) => {
        let s = 0,
          n = 0;
        for (let y = Math.floor(H / 3); y < H - 60; y++)
          for (let x = 0; x < W; x++) {
            const i = C * (y * W + x);
            s += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
            n++;
          }
        return +(s / n).toFixed(2);
      };
      out.psnr = { lampsVsPlain: psnr(shots.lamps!, shots.plain!), lampsVsLamps2: psnr(shots.lamps!, shots.lamps2!) };
      out.mean = Object.fromEntries(Object.entries(shots).map(([k, d]) => [k, mean(d)]));
      console.log(
        `  ${JSON.stringify({ frames: ["lamps", "lamps2", "plain", "lamps3"].filter((k) => out[k]).map((k) => `${k} ${(out[k] as { frameMs: number }).frameMs} ms, ${(out[k] as { scenery: string }).scenery}`), lamps: (out.lamps as { lamps: number }).lamps, psnr: out.psnr, mean: out.mean, pipe: (out.lamps as { pipe: string }).pipe })}`,
      );
      await app.js(
        `(() => { __bh.settings.earthStreetLamps = true; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`,
      );
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/lamps.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect((out.lamps as { lamps: number }).lamps).toBeGreaterThan(0);
    expect(out.gpuErrors).toBe(0);
  },
  10 * 60_000,
);
