import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The IGN's canopy under the trees over France (docs/ANALYSE-IGN-LIDAR.md I4, src/system/ign-canopy.ts): the scenery's
// trees where the LiDAR's canopy height model stands 2 m or more — the bocage's hedges, the woods' edges —, as tall as it,
// against the land cover's draw without it (settings.earthIgnRelief). Over the bocage south of Saint-Lô, each held in the
// raster pipeline: the trees placed, the survey's share, the buildings, and how well they sit on the IGN's orthophoto — a
// source of its own: the trees on the photo's canopy, the photo's canopy under a tree.
// (E2E_SHOTS=<dir>: ign-canopy-saintlo-on / -ortho — the photo alone, the scene off — / -off.)
// Duration: ~7 min on kerr-mini.
// Done when: with the survey most trees placed by it, the buildings all in, far more of the photo's canopy under a tree and
// as many trees on it as without.

const SITE = { lat: 49.1065, lon: -1.024 };

describe.skipIf(!E2E)("the IGN's canopy", () => {
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
  // (the trees within 400 m of the scene's centre against the IGN's orthophoto there — its z 17 tiles, 0.8 m a pixel —, a
  // source of its own: a point is the photo's canopy where its 3 × 3 px are dark (under the area's 40th percentile) and green
  // (green over red, not a ploughed field's brown). Precision: the trees with the photo's canopy within their crown's reach
  // (the foot or 3 m round it); recall: the photo's canopy points, every 10 m, with a tree's foot within 4 m)
  const fit = () =>
    app.js<{
      trees: number;
      surveyed: number;
      requests: number;
      buildings: number;
      error: string | null;
      surveyError: string | null;
      near: number;
      precision: number;
      recall: number;
    }>(`(async () => {
      const sc = __bh.renderer.earthScenery, st = sc.stats(), D = Math.PI / 180;
      const lat0 = st.lat, lon0 = st.lon, a = 6378137, e2 = 0.00669437999014, s = Math.sin(lat0 * D);
      const M = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5, N = a / Math.sqrt(1 - e2 * s * s);
      const place = (x, y) => [lat0 + y / M / D, lon0 + x / (N * Math.cos(lat0 * D)) / D];
      const z = 17, n = 2 ** z, tiles = new Map();
      const pix = (lat, lon) => [((lon + 180) / 360) * n * 256, ((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * n * 256];
      const tile = (x, y) => {
        const k = x + "/" + y;
        if (!tiles.has(k)) tiles.set(k, (async () => {
          const r = await fetch("https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=" + z + "&TILEROW=" + y + "&TILECOL=" + x + "&FORMAT=image/jpeg");
          const im = await createImageBitmap(await r.blob()), c = new OffscreenCanvas(256, 256), g = c.getContext("2d");
          g.drawImage(im, 0, 0);
          return g.getImageData(0, 0, 256, 256).data;
        })());
        return tiles.get(k);
      };
      const colour = async (x, y) => {
        const [px, py] = pix(...place(x, y));
        let r = 0, g = 0, b = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const X = Math.floor(px) + dx, Y = Math.floor(py) + dy, d = await tile(Math.floor(X / 256), Math.floor(Y / 256)), i = ((Y & 255) * 256 + (X & 255)) * 4;
          r += d[i] / 9; g += d[i + 1] / 9; b += d[i + 2] / 9;
        }
        return [r, g, b, 0.2126 * r + 0.7152 * g + 0.0722 * b];
      };
      const grid = [];
      for (let y = -400; y <= 400; y += 10) for (let x = -400; x <= 400; x += 10) if (Math.hypot(x, y) < 400) grid.push([x, y, await colour(x, y)]);
      const lums = grid.map((p) => p[2][3]).sort((p, q) => p - q), cut = lums[Math.floor(0.4 * lums.length)];
      const canopyAt = (c) => c[3] < cut && c[1] > c[0] * 1.02;
      let hits = 0, canopy = 0;
      for (const [x, y, c] of grid) if (canopyAt(c)) { canopy++; if (sc.contact.trees([x, y, 0], 4).length) hits++; }
      const trees = sc.contact.trees([0, 0, 0], 400);
      let on = 0;
      for (const t of trees) {
        let any = canopyAt(await colour(t.x, t.y));
        for (let k = 0; k < 8 && !any; k++) any = canopyAt(await colour(t.x + 3 * Math.cos((k * Math.PI) / 4), t.y + 3 * Math.sin((k * Math.PI) / 4)));
        if (any) on++;
      }
      return { trees: st.trees, surveyed: st.surveyedTrees, surveyError: st.surveyError, requests: st.surveyRequests, buildings: st.buildings, error: st.lastError, near: trees.length,
        precision: trees.length ? on / trees.length : 0, recall: canopy ? hits / canopy : 0 };
    })()`);

  test("south of Saint-Lô: the hedges' and the woods' trees by the survey, on the photo's canopy more than the land cover's", async () => {
    // (the date set, a second for the clock to take it, then the jump — never in the same tick)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    // (over the bocage, the chase view — the fields and their hedges ahead below —, then held there: the tiles and the
    // scenery stream in all the same, the craft stays over the place)
    const arrive = async (what: string) => {
      await app.js(
        `(() => { __bh.freeze(false); __bh.game.flyAt(${SITE.lat}, ${SITE.lon}, 220, 60, 120); __bh.settings.shipMount = "chase"; return 1; })()`,
      );
      await Bun.sleep(1500);
      await app.js(`(__bh.freeze(true), 1)`);
      await app
        .waitFor(
          `(() => { const t = __bh.renderer.earthTiles, s = __bh.renderer.earthScenery.stats(); return t.pending === 0 && t.orthoPending === 0 && !s.pending && s.status === "ready" && s.trees > 0; })()`,
          150_000,
        )
        .catch(async () =>
          console.log(
            `  (${what}: still loading after 150 s — ${await app.js<string>(`(() => { const t = __bh.renderer.earthTiles, s = __bh.renderer.earthScenery.stats(); return JSON.stringify({ tiles: t.pending, ortho: t.orthoPending, scenery: s.status, pending: s.pending, trees: s.trees, error: s.lastError, ms: s.workerMs }); })()`)})`,
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
        await app.shot(`${shots}/ign-canopy-saintlo-${name}.png`);
      }
      await app.js(
        `(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true, earthRasterScale: 0.75, motionBlur: 0.5 }); return 1; })()`,
      );
    };
    const say = (what: string, r: Awaited<ReturnType<typeof fit>>) =>
      console.log(
        `  ${what}: ${r.trees} trees, ${r.surveyed} by the survey (${r.requests} requests), ${r.buildings} buildings${r.error ? ` (${r.error})` : ""}${r.surveyError ? ` (survey: ${r.surveyError.slice(0, 260)})` : ""}; within 400 m ${r.near}: ${(100 * r.precision).toFixed(0)} % on the photo's canopy, ${(100 * r.recall).toFixed(0)} % of its canopy under a tree`,
      );
    await arrive("with the survey");
    const on = await fit();
    say("with the survey", on);
    await shot("on");
    // (the photo alone under the same view: the trees' places against it — the scene taken away)
    await app.js(`(() => { window.__scn = __bh.settings.earthScenery; __bh.settings.earthScenery = "off"; return 1; })()`);
    await app.waitFor(`__bh.renderer.earthScenery.stats().trees === 0`, 30_000).catch(() => {});
    await shot("ortho");
    await app.js(`(() => { __bh.settings.earthScenery = window.__scn; return 1; })()`);
    // (without: the land cover's — the scene asked again)
    await app.js(`(() => { __bh.settings.earthIgnRelief = false; return 1; })()`);
    await Bun.sleep(1000);
    await arrive("without the survey");
    const off = await fit();
    say("without", off);
    await shot("off");
    expect(await lost()).toBeNull();
    expect(on.requests).toBeGreaterThan(0);
    expect(on.surveyed).toBeGreaterThan(0.7 * on.trees);
    expect(off.surveyed).toBe(0);
    expect(on.near).toBeGreaterThan(500);
    // (the scene whole with it: its buildings in)
    expect(on.buildings).toBeGreaterThan(0.8 * off.buildings);
    // (the survey's trees: far more of the photo's canopy under a tree — the hedges —, as many of them on it)
    expect(on.recall).toBeGreaterThan(off.recall + 0.05);
    expect(on.precision).toBeGreaterThan(off.precision - 0.05);
    expect(app.cdp.errors).toEqual([]);
  }, 720_000);
});
