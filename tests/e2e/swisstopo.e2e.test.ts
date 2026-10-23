import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// swisstopo over Switzerland (docs/ANALYSE-IGN-LIDAR.md I7, src/system/national.ts): the national sources' interface's
// second — SWISSIMAGE's orthophotos (z 15 … 18) and swissALTI3D's relief through the terrain service's meshes (z 11 … 17),
// the scenery's trees and buildings on that ground —, with the national surveys on and off (settings.earthOrtho,
// earthIgnRelief). In the Lauterbrunnen valley — its walls 500 m of rock, the Jungfrau (4 158 m) ahead —, held, in the
// raster pipeline: the walls' steepest slope over a 600 m square, the data's resolution, the levels, the orthophotos, the
// credit, the Jungfrau's summit against its surveyed height, the scenery's ground requests; a held view of each.
// (E2E_SHOTS=<dir>: swisstopo-lauterbrunnen-on / -off.)
// Duration: ~8 min on kerr-mini.
// Done when: with the surveys the walls steeper, the data's resolution a survey's, levels to z 16 or finer, SWISSIMAGE in and
// credited, the summit within 15 m of 4 158 m; without, the global data's.

const SITE = { lat: 46.595, lon: 7.912 };
const LAND = { lat: 46.5935, lon: 7.9085 };
const JUNGFRAU = { lat: 46.5367, lon: 7.9625, h: 4158 };

describe.skipIf(!E2E)("swisstopo over Switzerland", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: true, f35AutoProtect: false }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const lost = () => app.js<string | null>(`document.querySelector(".craft-lost .cl-why")?.textContent ?? null`);
  const loaded = (what: string) =>
    app
      .waitFor(
        `(() => { const t = __bh.renderer.earthTiles, s = __bh.renderer.earthScenery.stats(); return t.pending === 0 && t.orthoPending === 0 && !s.pending; })()`,
        150_000,
      )
      .catch(async () =>
        console.log(
          `  (${what}: still loading after 150 s — ${await app.js<string>(`JSON.stringify({ tiles: __bh.renderer.earthTiles.pending, ortho: __bh.renderer.earthTiles.orthoPending, scenery: __bh.renderer.earthScenery.stats().status })`)})`,
        ),
      );
  // (the ground over a 600 m square round the walls, every 5 m: its steepest slope; the data's resolution at a point of the
  // valley's floor; the Jungfrau's summit — the top within 60 m, over the sea —; what the tiles and the scenery hold)
  const survey = () =>
    app.js<{
      slope: number;
      res: number;
      finest: number;
      ortho: number;
      summit: number;
      national: string | null;
      credit: boolean;
      creditIgn: boolean;
      sceneryRequests: number;
    }>(`(() => {
      const n = 121, step = 5, la0 = ${SITE.lat}, lo0 = ${SITE.lon}, D = Math.PI / 180;
      const dLat = step / 111_195, dLon = step / (111_195 * Math.cos(la0 * D));
      const h = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h.push(__bh.sys.groundAt(la0 + (j - 60) * dLat, lo0 + (i - 60) * dLon));
      let slope = 0;
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        const a = h[j * n + i];
        slope = Math.max(slope, Math.abs(h[j * n + i + 1] - a) / step, Math.abs(h[(j + 1) * n + i] - a) / step);
      }
      const lq = ${LAND.lat} * D, lo = ${LAND.lon} * D;
      const q = [Math.cos(lq) * Math.cos(lo), Math.cos(lq) * Math.sin(lo), Math.sin(lq)];
      let summit = -1e9;
      for (let j = -12; j <= 12; j++) for (let i = -12; i <= 12; i++) {
        const la = ${JUNGFRAU.lat} + (j * 5) / 111_195, lon = ${JUNGFRAU.lon} + (i * 5) / (111_195 * Math.cos(${JUNGFRAU.lat} * D));
        summit = Math.max(summit, __bh.sys.groundAt(la, lon) - __bh.sys.geoid(la, lon));
      }
      const t = __bh.renderer.earthTiles, shown = (id) => { const e = document.querySelector('[data-testid="' + id + '"]'); return !!e && !e.hidden; };
      return { slope, res: t.heightAt(q, 1).res, finest: t.finest, ortho: t.orthoFinest, summit, national: t.nationalAt,
        credit: shown("swiss-credit"), creditIgn: shown("ortho-credit"), sceneryRequests: __bh.renderer.earthScenery.stats().surveyRequests };
    })()`);

  test("Lauterbrunnen: swisstopo's walls, orthophotos and summit with the surveys, the global data's without", async () => {
    // (the date set, a second for the clock to take it, then the jump — never in the same tick)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    // (over the valley's mouth, heading for the Jungfrau, the chase view; held there: the tiles stream in all the same)
    const arrive = async (what: string) => {
      await app.js(
        `(() => { __bh.freeze(false); __bh.game.flyAt(46.615, 7.895, 900, 150, 120); __bh.settings.shipMount = "chase"; return 1; })()`,
      );
      await Bun.sleep(1500);
      await app.js(`(__bh.freeze(true), 1)`);
      await loaded(what);
      await app.waitFor(`__bh.renderer.earthTiles.finest >= ${what === "with" ? 16 : 14}`, 60_000).catch(() => {});
      const pitch = await app.js<number>(`((__bh.camera.attitudeNow().pitch ?? 0) * 180) / Math.PI`);
      expect(Math.abs(pitch)).toBeLessThan(15);
    };
    // (the held view, every pixel shaded at the full scale — the raster armed again: a small GPU's governor may have given it up)
    const shot = async (name: string) => {
      await app.js(
        `(() => { Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, motionBlur: 0 }); __bh.renderer.rasterFellBack = false; return 1; })()`,
      );
      await app.settled();
      await Bun.sleep(3000);
      const pipe = await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`);
      console.log(`  ${name}: ${pipe}, view ${await app.js<string>(`__bh.settings.shipMount`)}`);
      expect(pipe).toBe("raster");
      if (shots) {
        await Bun.$`mkdir -p ${shots}`;
        await app.shot(`${shots}/swisstopo-lauterbrunnen-${name}.png`);
      }
      await app.js(
        `(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true, earthRasterScale: 0.75, motionBlur: 0.5 }); return 1; })()`,
      );
    };
    const say = (what: string, r: Awaited<ReturnType<typeof survey>>) =>
      console.log(
        `  ${what}: steepest slope ${r.slope.toFixed(2)} (${((Math.atan(r.slope) * 180) / Math.PI).toFixed(0)}°), resolution ${r.res.toFixed(1)} m, levels to z ${r.finest}, orthophotos to z ${r.ortho}, the Jungfrau ${r.summit.toFixed(0)} m (${JUNGFRAU.h}), source ${r.national}, swisstopo credited ${r.credit} (IGN ${r.creditIgn}), scenery's ground requests ${r.sceneryRequests}`,
      );
    await arrive("with");
    const on = await survey();
    say("with the surveys", on);
    await shot("on");
    // (without: the global data's — every tile taken again)
    await app.js(`(() => { Object.assign(__bh.settings, { earthIgnRelief: false, earthOrtho: false }); return 1; })()`);
    await Bun.sleep(1000);
    await arrive("without");
    const off = await survey();
    say("without", off);
    await shot("off");
    expect(await lost()).toBeNull();
    expect(on.national).toBe("swisstopo");
    expect(on.credit).toBe(true);
    expect(on.creditIgn).toBe(false);
    expect(on.finest).toBeGreaterThanOrEqual(16);
    // (to z 16 at 900 m over the valley: the orthophotos' levels as the pixels' footprint asks them)
    expect(on.ortho).toBeGreaterThanOrEqual(16);
    expect(on.res).toBeLessThan(10);
    expect(off.res).toBeGreaterThan(20);
    expect(on.slope).toBeGreaterThan(1.2 * off.slope);
    expect(Math.abs(on.summit - JUNGFRAU.h)).toBeLessThan(15);
    expect(on.sceneryRequests).toBeGreaterThan(0);
    expect(off.credit).toBe(false);
    expect(app.cdp.errors).toEqual([]);
  }, 720_000);
});
