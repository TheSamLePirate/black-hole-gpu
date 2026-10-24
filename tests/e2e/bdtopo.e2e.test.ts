import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The IGN's buildings over France (docs/ANALYSE-IGN-LIDAR.md I5, src/system/bdtopo.ts): the BD TOPO's footprints and
// measured heights in the scenery instead of OpenStreetMap's (settings.earthIgnRelief). Over Paris's Front de Seine — its
// towers by the river, the 15th's Haussmann blocks round them —, held in the raster pipeline: each building of the scene
// within 300 m of its centre against the LiDAR's own measure of it, a source apart — the median of the surface less the
// ground (MNS − MNT, 0.75 m a texel) over its footprint — against the median of the scene's roof (its planes, roofs.ts) at the
// same points less the game's ground under it.
// (E2E_SHOTS=<dir>: bdtopo-paris-on / -off.)
// Duration: ~8 min on kerr-mini.
// Done when: with the BD TOPO most buildings its own, their heights far nearer the LiDAR's than OSM's (median, share within 3 m).

const SITE = { lat: 48.8487, lon: 2.2846 };

describe.skipIf(!E2E)("the IGN's buildings", () => {
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
  // (the scene's buildings within 300 m of its centre, each against the LiDAR: its footprint's interior on a 7 × 7 grid,
  // the median of MNS − MNT there; its height in the scene its roof — the frame's z, the tangent plane's rise d²/2R added —
  // less the game's ground at its middle)
  const heights = () =>
    app.js<{
      buildings: number;
      bdtopo: number;
      tiles: number;
      error: string | null;
      lat: number;
      lon: number;
      compared: number;
      median: number;
      within3: number;
    }>(`(async () => {
      const sc = __bh.renderer.earthScenery, st = sc.stats(), c = sc.contact, f = c.f, D = Math.PI / 180;
      const lat0 = st.lat, lon0 = st.lon, a = 6378137, e2 = 0.00669437999014, s = Math.sin(lat0 * D);
      const M = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5, N = a / Math.sqrt(1 - e2 * s * s);
      const place = (x, y) => [lat0 + y / M / D, lon0 + x / (N * Math.cos(lat0 * D)) / D];
      // (the LiDAR over 640 m round the centre, 0.75 m a texel, in Web Mercator)
      const R = 6378137, mx = R * lon0 * D, my = R * Math.log(Math.tan(Math.PI / 4 + (lat0 * D) / 2)), half = 320 / Math.cos(lat0 * D), W = 848;
      const box = [mx - half, my - half, mx + half, my + half].join(",");
      const grid = async (k) => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const r = await fetch("https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=IGNF_LIDAR-HD_" + k + "_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G&STYLES=&CRS=EPSG:3857&BBOX=" + box + "&WIDTH=" + W + "&HEIGHT=" + W + "&FORMAT=image/x-bil;bits=32");
          if (r.ok) return new Float32Array(await r.arrayBuffer());
          await new Promise((q) => setTimeout(q, 1000 * 2 ** attempt));
        }
        throw new Error("the LiDAR's " + k + " refused");
      };
      const mns = await grid("MNS"), mnt = await grid("MNT");
      const at = (v, lat, lon) => {
        const X = R * lon * D, Y = R * Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2));
        const i = Math.floor(((X - mx + half) / (2 * half)) * W), j = Math.floor(((my + half - Y) / (2 * half)) * W);
        return i < 0 || j < 0 || i >= W || j >= W ? NaN : v[j * W + i];
      };
      const errs = [];
      c.visit([0, 0, 0], 300, false, (b) => {
        if (f[b + 3] !== 1) return;
        const x0 = f[b + 4], y0 = f[b + 5], x1 = f[b + 6], y1 = f[b + 7], cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        if (Math.hypot(cx, cy) > 300 || (x1 - x0) * (y1 - y0) < 30) return;
        // (the LiDAR's surface less its ground and the scene's roof there — its planes: docs/PLAN-BATIMENTS-AAA.md —, at the
        // same points; their medians compared)
        const hs = [], ms = [];
        const [cla, clo] = place(cx, cy), rise = (cx * cx + cy * cy) / (2 * R), ground = __bh.sys.groundAt(cla, clo);
        for (let u = 1; u < 8; u++) for (let v = 1; v < 8; v++) {
          const p = [x0 + ((x1 - x0) * u) / 8, y0 + ((y1 - y0) * v) / 8, 0];
          if (!c.polygon(p, b)) continue;
          const [la, lo] = place(p[0], p[1]), h = at(mns, la, lo) - at(mnt, la, lo);
          if (Number.isFinite(h) && h > -20 && h < 400) { hs.push(h); ms.push(c.topAt(b, p[0], p[1]) + rise - ground); }
        }
        if (hs.length < 5) return;
        hs.sort((p, q) => p - q);
        ms.sort((p, q) => p - q);
        errs.push(Math.abs(ms[ms.length >> 1] - hs[hs.length >> 1]));
      });
      errs.sort((p, q) => p - q);
      return { buildings: st.buildings, bdtopo: st.bdtopoBuildings, tiles: st.bdtopoTiles, error: st.surveyError ?? st.lastError, lat: lat0, lon: lon0,
        compared: errs.length, median: errs.length ? errs[errs.length >> 1] : 99, within3: errs.length ? errs.filter((e) => e <= 3).length / errs.length : 0 };
    })()`);

  test("the Front de Seine: the BD TOPO's buildings, their heights the LiDAR's far nearer than OSM's", async () => {
    // (the date set, a second for the clock to take it, then the jump — never in the same tick)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    // (south-east of the towers, heading for them over the river, the chase view; held there: the tiles and the scene stream
    // in all the same)
    const arrive = async (what: string) => {
      await app.js(
        `(() => { __bh.freeze(false); __bh.game.flyAt(${SITE.lat - 0.006}, ${SITE.lon + 0.008}, 350, 315, 120); __bh.settings.shipMount = "chase"; return 1; })()`,
      );
      await Bun.sleep(1500);
      await app.js(`(__bh.freeze(true), 1)`);
      await app
        .waitFor(
          `(() => { const t = __bh.renderer.earthTiles, s = __bh.renderer.earthScenery.stats(); return t.pending === 0 && t.orthoPending === 0 && !s.pending && s.status === "ready" && s.buildings > 0; })()`,
          150_000,
        )
        .catch(async () =>
          console.log(
            `  (${what}: still loading after 150 s — ${await app.js<string>(`(() => { const t = __bh.renderer.earthTiles, s = __bh.renderer.earthScenery.stats(); return JSON.stringify({ tiles: t.pending, ortho: t.orthoPending, scenery: s.status, pending: s.pending, buildings: s.buildings, error: s.lastError, ms: s.workerMs }); })()`)})`,
          ),
        );
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
        await app.shot(`${shots}/bdtopo-paris-${name}.png`);
      }
      await app.js(
        `(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true, earthRasterScale: 0.75, motionBlur: 0.5 }); return 1; })()`,
      );
    };
    const say = (what: string, r: Awaited<ReturnType<typeof heights>>) =>
      console.log(
        `  ${what}: ${r.buildings} buildings, ${r.bdtopo} the BD TOPO's (${r.tiles} tiles)${r.error ? ` (${r.error.slice(0, 200)})` : ""}; round ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}: ${r.compared} against the LiDAR, median ${r.median.toFixed(1)} m off, ${(100 * r.within3).toFixed(0)} % within 3 m`,
      );
    await arrive("with the BD TOPO");
    const on = await heights();
    say("with the BD TOPO", on);
    await shot("on");
    // (without: OSM's — the scene asked again)
    await app.js(`(() => { __bh.settings.earthIgnRelief = false; return 1; })()`);
    await Bun.sleep(1000);
    await arrive("with OSM");
    const off = await heights();
    say("with OSM", off);
    await shot("off");
    expect(await lost()).toBeNull();
    expect(on.bdtopo).toBeGreaterThan(0.9 * on.buildings);
    expect(off.bdtopo).toBe(0);
    expect(on.compared).toBeGreaterThan(200);
    expect(off.compared).toBeGreaterThan(200);
    // (the BD TOPO's heights: nearer the LiDAR's by half, more of them within 3 m)
    expect(on.median).toBeLessThan(0.6 * off.median);
    expect(on.within3).toBeGreaterThan(off.within3 + 0.15);
    expect(app.cdp.errors).toEqual([]);
  }, 720_000);
});
