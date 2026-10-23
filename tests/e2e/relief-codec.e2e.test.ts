import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { IGN_LIDAR, IGN_MNS_LIDAR, IGN_RGEALTI, ignHeightUrl } from "../../src/system/earth-tiles";
import { App, E2E, stopServer } from "./lib/app";

// The relief kept small (docs/ANALYSE-IGN-LIDAR.md §9.3, I8c; src/pwa/relief-codec.ts, src/sw.ts): the IGN's float32 grids
// packed by the Service Worker as it keeps them — in flight (the budgeted cache) and in a zone — and served again as they
// came, to the centimetre. Over Chamonix with the IGN's relief (RGE ALTI, LiDAR HD, the surface models), the raster
// pipeline: the tiles' cache emptied, the F-35 held 450 m over the valley, the grids kept measured by kind; six grids read
// back through the worker against the same fetched from the IGN here; the ground's heights under the camera before and
// after a reload (the grids then read from the cache, packed); a 1 km zone of the low flight's profile, its grids' sizes.
// (E2E_SHOTS=<dir>: relief-codec-chamonix — the ground from the packed grids.)
// Duration: ~5 min on kerr-mini.
// Done when: the grids kept ~40 KB (256²) — a sixth of their bytes —, every height read back within 5 mm and every hole
// where it was, the game's ground the same before and after (≤ 1 cm), the zone's grids packed too.

const SETTINGS = `{ traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: true, earthIgnSilhouettes: true, f35AutoProtect: false }`;
const START = { lat: 45.912, lon: 6.858 };
const D = Math.PI / 180;
const tileOf = (lat: number, lon: number, z: number) => {
  const n = 2 ** z;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan(lat * D)) / Math.PI) / 2) * n)] as const;
};
/** the grids compared: the ground's (RGE ALTI z 14, the LiDAR's z 16), the surface's (z 12, 512²) — two of each */
const GRIDS = [
  ...[0, 1].map((d) => {
    const [x, y] = tileOf(START.lat, START.lon, 14);
    return ignHeightUrl(IGN_RGEALTI, 14, x + d, y);
  }),
  ...[0, 1].map((d) => {
    const [x, y] = tileOf(START.lat, START.lon, 16);
    return ignHeightUrl(IGN_LIDAR, 16, x, y + d);
  }),
  ...[0, 1].map((d) => {
    const [x, y] = tileOf(START.lat, START.lon, 12);
    return ignHeightUrl(IGN_MNS_LIDAR, 12, x + d, y, 512);
  }),
];
/** the ground's heights sampled: a cross over the valley, 300 m apart */
const PROBES = [-2, -1, 0, 1, 2].flatMap((i) => [
  [START.lat + (i * 300) / 111_195, START.lon],
  [START.lat, START.lon + (i * 300) / (111_195 * Math.cos(START.lat * D))],
]);

describe.skipIf(!E2E)("the relief kept small", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  type Kinds = Record<string, { lru: number; lruBytes: number; zone: number; zoneBytes: number }>;
  const kinds = () => app.js<Kinds>(`__bh.pwa.stats().then((s) => s.kinds ?? {})`);
  const ground = () => app.js<number[]>(`(() => ${JSON.stringify(PROBES)}.map(([la, lo]) => __bh.sys.groundAt(la, lo)))()`);
  /** held over the valley: placed, its relief in (the finest levels), placed again on it */
  const arrive = async () => {
    const place = `__bh.game.flyAt(${START.lat}, ${START.lon}, 450, 45, 120); __bh.settings.shipMount = "cockpit";`;
    await app.js(`(() => { ${place} __bh.freeze(true); return 1; })()`);
    await Bun.sleep(1000);
    await app.waitFor(`(() => { const t = __bh.renderer.earthTiles; return t.finest >= 16 && t.pending === 0; })()`, 180_000);
    await app.js(`(() => { ${place} return 1; })()`);
    await Bun.sleep(1000);
    await app.waitFor(`(() => { const t = __bh.renderer.earthTiles; return t.pending === 0 && t.orthoPending === 0; })()`, 120_000);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", sw: true, tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    await app.waitFor("!!__bh.pwa.zones", 30_000);
  }, 300_000);
  afterAll(async () => {
    for (const z of (await app?.js<{ id: string }[]>(`__bh.pwa.zones.list()`).catch(() => [])) ?? [])
      await app.js(`__bh.pwa.zones.remove(${JSON.stringify(z.id)})`).catch(() => {});
    app?.close();
    stopServer();
  });

  let before: number[] = [];
  test("in flight: the grids kept packed, ~40 KB a 256² — measured by kind", async () => {
    await app.js(`__bh.pwa.clearTiles()`);
    await arrive();
    before = await ground();
    // (the cache's writes are the worker's, after the responses: a moment for the last)
    await Bun.sleep(3000);
    const k = await kinds();
    const mean = (x?: { lru: number; lruBytes: number }) => (x?.lru ? x.lruBytes / x.lru : 0);
    console.log(
      `  kept in flight: ${k.relief?.lru ?? 0} grids 256² at ${(mean(k.relief) / 1024).toFixed(1)} KB (of 256), ${k.relief512?.lru ?? 0} at 512² at ${(mean(k.relief512) / 1024).toFixed(1)} KB (of 1 024), ${k.terrarium?.lru ?? 0} Terrarium at ${(mean(k.terrarium) / 1024).toFixed(1)} KB, ${k.imagery?.lru ?? 0} images at ${(mean(k.imagery) / 1024).toFixed(1)} KB`,
    );
    expect(k.relief?.lru ?? 0).toBeGreaterThan(20);
    expect(mean(k.relief)).toBeLessThan(80 * 1024);
    if (k.relief512?.lru) expect(mean(k.relief512)).toBeLessThan(400 * 1024);
  }, 420_000);

  test("every grid read back through the worker as the IGN sends it: within 5 mm, its holes where they were", async () => {
    let worst = 0;
    for (const url of GRIDS) {
      // (asked twice from the page: the second from the cache, through the codec — its header says so)
      await app.js(`fetch(${JSON.stringify(url)}).then((r) => r.arrayBuffer()).then(() => 1)`);
      await Bun.sleep(1500);
      const page = await app.js<{ codec: string | null; type: string | null; v: number[] }>(
        `fetch(${JSON.stringify(url)}).then(async (r) => ({ codec: r.headers.get("x-kerr-codec"), type: r.headers.get("content-type"), v: [...new Float32Array(await r.arrayBuffer())] }))`,
      );
      const raw = new Float32Array(await (await fetch(url)).arrayBuffer());
      await Bun.sleep(300);
      expect(page.codec).toBe("krh1");
      expect(page.type).toContain("x-bil");
      expect(page.v.length).toBe(raw.length);
      let w = 0,
        holes = 0;
      for (let i = 0; i < raw.length; i++) {
        const h = raw[i]!,
          b = page.v[i]!;
        const hole = !Number.isFinite(h) || h < -100 || h > 9000;
        const bHole = !Number.isFinite(b) || b < -100 || b > 9000;
        expect(bHole).toBe(hole);
        if (hole) holes++;
        else w = Math.max(w, Math.abs(b - h));
      }
      worst = Math.max(worst, w);
      console.log(
        `  ${url.match(/LAYERS=([^&]+)/)?.[1]?.slice(0, 32)} ${url.includes("WIDTH=512") ? "512²" : "256²"}: worst ${(w * 1000).toFixed(2)} mm, holes ${holes}`,
      );
    }
    expect(worst).toBeLessThanOrEqual(0.0051);
  }, 180_000);

  test("the game's ground the same, read from the packed grids after a reload (≤ 1 cm)", async () => {
    await app.load("scene=game:artemis");
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${SETTINGS}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
    const s0 = await app.js<{ lru: number; network: number }>(`__bh.pwa.stats().then((s) => s.served)`);
    await arrive();
    const s1 = await app.js<{ lru: number; network: number }>(`__bh.pwa.stats().then((s) => s.served)`);
    const after = await ground();
    let worst = 0;
    for (let i = 0; i < after.length; i++) worst = Math.max(worst, Math.abs(after[i]! - before[i]!));
    console.log(
      `  the ground at ${after.length} points: worst ${(worst * 1000).toFixed(1)} mm (from the cache ${s1.lru - s0.lru}, the network ${s1.network - s0.network}); ${after.map((h) => h.toFixed(2)).join(" ")}`,
    );
    expect(worst).toBeLessThanOrEqual(0.01);
    expect(s1.lru - s0.lru).toBeGreaterThan(20);
    if (shots) {
      // (the ground held still, every pixel shaded — tests/e2e/zones.e2e.test.ts's recipe —, the game paused)
      await app.js(
        `(() => { Object.assign(__bh.settings, { dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1, motionBlur: 0 }); __bh.renderer.rasterFellBack = false; __bh.game.pause(true); return 1; })()`,
      );
      await app.settled();
      await Bun.sleep(12_000);
      await Bun.$`mkdir -p ${shots}`;
      await app.shot(`${shots}/relief-codec-chamonix.png`);
      await app.js(
        `(() => { Object.assign(__bh.settings, { earthRasterShading: "auto", dynamicResolution: true, earthRasterScale: 0.75, motionBlur: 0.5 }); __bh.game.pause(false); __bh.freeze(true); return 1; })()`,
      );
    }
  }, 420_000);

  test("a zone with the IGN's relief: its grids packed too, its size and its estimate", async () => {
    const zone = { name: "Chamonix relief (e2e)", lat: START.lat, lon: START.lon, radiusKm: 1, profile: "low" };
    const est = await app.js<{ chains: number; bytes: number; seconds: number }>(`__bh.pwa.zones.estimate(${JSON.stringify(zone)})`);
    const id = await app.js<string | null>(`__bh.pwa.zones.add(${JSON.stringify(zone)})`);
    expect(id).toBeTruthy();
    const t0 = Date.now();
    await app.waitFor(
      `(async () => (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)})?.state === "ready")()`,
      900_000,
    );
    const z = await app.js<{ total: number; bytes: number; failed: number }>(
      `(async () => (await __bh.pwa.zones.list()).find((z) => z.id === ${JSON.stringify(id)}))()`,
    );
    const k = await kinds();
    const mean = (n: number, b: number) => (n ? b / n / 1024 : 0);
    console.log(
      `  the zone: ${z.total} chains in ${((Date.now() - t0) / 1000).toFixed(0)} s (estimated ${est.seconds.toFixed(0)} s), ${(z.bytes / 1e6).toFixed(0)} MB (estimated ${(est.bytes / 1e6).toFixed(0)}), ${z.failed} failed; its grids ${k.relief?.zone ?? 0} at ${mean(k.relief?.zone ?? 0, k.relief?.zoneBytes ?? 0).toFixed(1)} KB, ${k.relief512?.zone ?? 0} at 512² at ${mean(k.relief512?.zone ?? 0, k.relief512?.zoneBytes ?? 0).toFixed(1)} KB`,
    );
    expect(z.failed).toBe(0);
    expect(k.relief?.zone ?? 0).toBeGreaterThan(20);
    expect(mean(k.relief?.zone ?? 0, k.relief?.zoneBytes ?? 0)).toBeLessThan(80);
    // (the estimate within a factor of two of what came)
    expect(z.bytes / est.bytes).toBeGreaterThan(0.5);
    expect(z.bytes / est.bytes).toBeLessThan(2);
  }, 960_000);
});
