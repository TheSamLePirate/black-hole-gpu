import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";
import { EARTH_SETTINGS } from "./lib/plan-views";

// L7b's prototype in the game (decision 42; system/ortho-delight.ts, settings.orthoDelight): the IGN orthophotos' cast shadows
// lifted on z 17–18 from the LiDAR's canopy — each photo's Sun found from the shadows the canopy would cast, the shaded ground
// relit by material-matched k. Over Versailles (OD_SITE "lat,lon", the study's place by default), the F-35 200 m over the
// ground, the cockpit looking 50° down, the craft hidden and the world's scenery off
// (the photographs alone judged), 17:00 UTC in July (the game's Sun in the west, the photo's near noon: the double
// shadows), frozen, the exposure locked: shots as they come, relit, as they come again (the PSNRs: relit against as they
// come, beside the two as they come); the tiles relit or left (why), the Suns and k found, the worker's time.
// OD_ISO: the time (the sunset's double shadows: "2026-07-10T18:45:00Z"); OD_SCENERY: the world's scenery ("off" — the
// photographs alone —, "high": the game's own trees and buildings and their shadows beside the photo's).
// OD_ALT, OD_PITCH, OD_HDG: the height over the ground [m], the look's pitch and the heading [°] (200, −50, 0).
// OD_OUT: the shots (remote-results/ortho-delight).
// Duration: ~3 min on this Mac.
// Done when: the three shots taken, some tiles relit, no GPU error.
const OUT = process.env.OD_OUT ?? "remote-results/ortho-delight";
const [LAT, LON] = (process.env.OD_SITE ?? "48.8053,2.1300").split(",").map(Number) as [number, number];
const ISO = process.env.OD_ISO ?? "2026-07-10T17:00:00Z";
const SCENERY = process.env.OD_SCENERY ?? "off";
const ALT = Number(process.env.OD_ALT ?? 200);
const PITCH = Number(process.env.OD_PITCH ?? -50);
const HDG = Number(process.env.OD_HDG ?? 0);
afterAll(stopServer);
test.skipIf(!E2E)(
  "L7b prototype: the orthophotos' shadows lifted in the game — tiles relit, shots before and after",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const out: Record<string, unknown> = {};
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { lookProfile: "neutral", f35Invulnerable: true, motionBlur: 0, dof: false, earthPipeline: "raster", weather: "fair", orthoDelight: false, earthScenery: "${SCENERY}" }); __bh.game.set("earthClouds", 0); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      const iso = ISO;
      await app.js(
        `(() => { __bh.game.setDate("${iso}"); __bh.game.flyAt(${LAT}, ${LON}, ${ALT}, ${HDG}, 0); __bh.settings.shipMount = "cockpit"; document.body.classList.add("hide-ui"); return 1; })()`,
      );
      await app.js(`new Promise((q) => setTimeout(() => { __bh.camera.setLook(0, ${PITCH}); q(1); }, 800))`);
      await app.js(
        `(() => { __bh.camera.setLook(0, ${PITCH}); __bh.settings.ship = false; __bh.game.setDate("${iso}"); __bh.freeze(true); return 1; })()`,
      );
      const frames = (n: number) =>
        app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${n}; i++) { __bh.touch(); await f(); } return 1; })()`,
        );
      // (the photographs in — and, relit, their de-lighting done —, said if not within 60 s)
      const loaded = async (k: string) => {
        await app
          .waitFor(
            `(() => { __bh.touch(); const t = __bh.renderer.earthTiles; const sc = __bh.renderer.earthScenery.stats(); return t.orthoPending === 0 && t.delightPending === 0 && t.orthoLoaded > 0 && (__bh.settings.earthScenery === "off" || (sc.status === "ready" && !sc.pending)); })()`,
            60_000,
          )
          .catch(async () =>
            console.warn(
              `  ${k}: still loading after 60 s — ${await app.js<string>(`JSON.stringify({ ortho: __bh.renderer.earthTiles.orthoPending, delight: __bh.renderer.earthTiles.delightPending })`)}`,
            ),
          );
        await app.settled(120_000);
        await frames(120);
      };
      await loaded("warm");
      await app.js(`(() => { __bh.settings.autoExposure = false; __bh.settings.exposure = __bh.renderer.autoEV; return 1; })()`);
      const shots: Record<string, Uint8Array> = {};
      for (const [k, on] of [
        ["plain", false],
        ["delit", true],
        ["plain2", false],
      ] as const) {
        await app.js(`(() => { __bh.settings.orthoDelight = ${on}; __bh.refresh?.(); __bh.touch(); return 1; })()`);
        await frames(10);
        await loaded(k);
        const st = await app.js<Record<string, unknown>>(
          `(() => { const t = __bh.renderer.earthTiles, s = t.delightStats; return { on: t.delightOn, done: s.done, left: s.left, ms: +s.ms.toFixed(0), last: s.last, loaded: t.orthoLoaded, pipe: __bh.renderer.earthPipelineNow(__bh.settings), mount: __bh.settings.shipMount }; })()`,
        );
        await app.shot(`${OUT}/${k}.png`);
        shots[k] = readPng(new Uint8Array(await Bun.file(`${OUT}/${k}.png`).arrayBuffer())).data;
        out[k] = st;
        console.log(`  ${k}: ${JSON.stringify(st)}`);
      }
      const psnr = (a: Uint8Array, b: Uint8Array) => {
        let se = 0;
        for (let i = 0; i < a.length; i++) se += (a[i]! - b[i]!) ** 2;
        return +(10 * Math.log10((255 * 255) / Math.max(se / a.length, 1e-9))).toFixed(2);
      };
      out.psnr = { delitVsPlain: psnr(shots.delit!, shots.plain!), plainVsPlain2: psnr(shots.plain!, shots.plain2!) };
      console.log(`  PSNR relit vs as they come ${JSON.stringify(out.psnr)}`);
      await app.js(`(() => { __bh.settings.ship = true; __bh.settings.autoExposure = true; __bh.settings.exposure = 0; return 1; })()`);
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
    } finally {
      await Bun.write(`${OUT}/delight.json`, JSON.stringify(out, null, 1));
      await app.close();
    }
    expect((out.delit as { done: number } | undefined)?.done ?? 0).toBeGreaterThan(0);
    expect(out.gpuErrors).toBe(0);
  },
  8 * 60_000,
);
