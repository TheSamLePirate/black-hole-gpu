import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The IGN's relief over France (docs/ANALYSE-IGN-LIDAR.md I2, src/system/earth-tiles.ts): RGE ALTI and the LiDAR HD's
// terrain on the terrain tiles, three levels finer near the ground (z 15 … 17), the drawn detail left out where the survey
// says better. At Étretat — chalk cliffs some 80 m high, rounded by the satellite radar's 30 m —, the same ground with
// the survey and without (settings.earthIgnRelief): its steepest slope over a 600 m square, the data's resolution there,
// and a held view of the cliffs in the raster pipeline. (E2E_SHOTS=<dir>: the views, ign-relief-etretat-on / -off.)
// Duration: ~6 min on kerr-mini.
// Done when: with the survey the cliffs stand steeper than without, its levels to z 16 or finer, the craft never lost.

// (the cliffs' square, and a point inland on the plateau — the survey's own there; the sea under the cliffs has none)
const SITE = { lat: 49.7085, lon: 0.1995 };
const LAND = { lat: 49.7, lon: 0.215 };

describe.skipIf(!E2E)("the IGN's relief", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: true }); return 1; })()`,
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
        90_000,
      )
      .catch(() => console.log(`  (${what}: still loading after 90 s)`));
  // (the ground over a 600 m square round the cliffs, every 5 m: its steepest slope between neighbours, and the data's
  // resolution at the middle as the ground has it — earth-tiles heightAt)
  const relief = () =>
    app.js<{ slope: number; res: number; finest: number }>(`(() => {
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
      return { slope, res: __bh.renderer.earthTiles.heightAt(q, 1).res, finest: __bh.renderer.earthTiles.finest };
    })()`);

  test("at Étretat: the cliffs steeper with the survey, its finer levels in, the data's resolution its own", async () => {
    // (the date set, a second for the clock to take it, then the jump — never in the same tick)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    // (over the plateau behind the cliffs, out to sea, in the chase view — the cliffs ahead below —, then held there: the
    // tiles stream in all the same, the craft stays over the place)
    const arrive = async (what: string) => {
      await app.js(
        `(() => { __bh.freeze(false); __bh.game.flyAt(49.698, 0.214, 250, 315, 120); __bh.settings.shipMount = "chase"; return 1; })()`,
      );
      await Bun.sleep(1500);
      await app.js(`(__bh.freeze(true), 1)`);
      await loaded(what);
      await app.waitFor(`__bh.renderer.earthTiles.finest >= ${what === "with the survey" ? 16 : 14}`, 60_000).catch(() => {});
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
        await app.shot(`${shots}/ign-relief-etretat-${name}.png`);
      }
      await app.js(
        `(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true, motionBlur: 0.5 }); return 1; })()`,
      );
    };
    const say = (what: string, r: { slope: number; res: number; finest: number }) =>
      console.log(
        `  ${what}: steepest slope ${r.slope.toFixed(2)} (${((Math.atan(r.slope) * 180) / Math.PI).toFixed(0)}°), resolution ${r.res.toFixed(1)} m, levels to z ${r.finest}`,
      );
    await arrive("with the survey");
    const on = await relief();
    say("with the survey", on);
    await shot("on");
    // (without: the global data's — every tile taken again)
    await app.js(`(() => { __bh.settings.earthIgnRelief = false; return 1; })()`);
    await Bun.sleep(1000);
    await arrive("without the survey");
    const off = await relief();
    say("without", off);
    await shot("off");
    expect(await lost()).toBeNull();
    expect(on.finest).toBeGreaterThanOrEqual(16);
    expect(off.finest).toBeLessThanOrEqual(14);
    expect(on.res).toBeLessThan(10);
    expect(off.res).toBeGreaterThan(20);
    expect(on.slope).toBeGreaterThan(1.3 * off.slope);
    expect(app.cdp.errors).toEqual([]);
  }, 600_000);
});
