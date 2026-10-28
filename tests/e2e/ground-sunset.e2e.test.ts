// Low flight at sunset over loaded relief, to look at the ground's shading and colour: the F-35 from its cockpit a few hundred
// metres over the ground, the Sun a few degrees up — lit faces and long shadows looking away from it, the contre-jour looking
// into it —, the scenery at its most (trees, buildings, satellite surface), every tile and kernel in before a shot. The raster
// pipeline, the FPS shown. E2E_SHOTS=<dir> (ground-sunset-<place>-<side>.png); remote-results/ground-sunset.json: each view's
// GPU time and the tiles left. PLACES=porto,tarifa,alps,seine (default all); GS_TUNE: the tracer's tune (a debug view, JSON).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The Sun's azimuth and elevation [°] (NOAA's low-precision formulae)
function sunAzEl(iso: string, lat: number, lon: number) {
  const n = new Date(iso).getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const eps = (23.439 - 4e-7 * n) * (Math.PI / 180);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ha = ((((18.697374558 + 24.06570982441908 * n) % 24) * 15 + lon) * Math.PI) / 180 - ra;
  const la = (lat * Math.PI) / 180;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { az: ((az * 180) / Math.PI + 360) % 360, el: (el * 180) / Math.PI };
}

// (each place: where, how high over the sea [m], when — the Sun ~4–8° up)
const PLACES: Record<string, { lat: number; lon: number; alt: number; date: string; heading?: number; pitch?: number }> = {
  // (the Gulf of Porto, Corsica: red granite ridges falling into the sea, maquis)
  porto: { lat: 42.27, lon: 8.62, alt: 450, date: "2026-07-10T18:35:00Z" },
  // (the hills behind Tarifa: cork oaks, pastures, wind farms, white villages)
  tarifa: { lat: 36.1, lon: -5.62, alt: 400, date: "2026-07-10T19:05:00Z" },
  // (the Chamonix valley under Mont Blanc: forests, meadows, rock and ice above)
  alps: { lat: 45.9, lon: 6.83, alt: 1700, date: "2026-07-10T18:40:00Z" },
  // (the Seine through Paris: its bridges over the water, the quays)
  seine: { lat: 48.858, lon: 2.29, alt: 250, date: "2026-07-10T19:15:00Z" },
  // (the same by day, low and close: from the Pont Mirabeau up the Seine, its bridges near — heading set by "lit": 50°)
  bridges: { lat: 48.8452, lon: 2.2735, alt: 150, date: "2026-07-10T11:30:00Z", heading: 45, pitch: -14 },
};
const places = (process.env.PLACES ?? Object.keys(PLACES).join(",")).split(",");

describe.skipIf(!E2E)("low flight at sunset: the ground's shading and colour", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS ?? "remote-results/ground-sunset";
  const rows: unknown[] = [];
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: true, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, targetSpp: 0,
      earthPipeline: "raster", shipMount: "cockpit", earthScenery: "high", detailReach: "veryFar", earthSceneryShadows: true,
      earthSurface: "satellite" }); __bh.renderer.tune = ${process.env.GS_TUNE ?? "{}"}; return 1; })()`);
    await Bun.$`mkdir -p ${shots}`;
  }, 300_000);
  afterAll(async () => {
    await Bun.write("remote-results/ground-sunset.json", JSON.stringify(rows, null, 2));
    app?.close();
    stopServer();
  });

  for (const pl of places)
    test(`${pl}: away from the Sun, then into it`, async () => {
      const P = PLACES[pl]!;
      const sun = sunAzEl(P.date, P.lat, P.lon);
      console.log(`  ${pl}: Sun azimuth ${sun.az.toFixed(1)}°, elevation ${sun.el.toFixed(1)}°`);
      for (const [side, heading] of [
        ["lit", P.heading ?? (sun.az + 150) % 360],
        ["contre-jour", P.heading !== undefined ? (P.heading + 180) % 360 : sun.az],
      ] as const) {
        // (put there, flown a moment, frozen — the same view however long the tiles and kernels take —, then every tile,
        // the scenery and every kernel waited for, the view touched: fresh frames timed, then left to settle)
        await app.js(`(async () => { __bh.freeze(false); __bh.game.setDate("${P.date}"); __bh.game.set("weather", "fair");
          __bh.game.set("earthClouds", 0.15); __bh.game.flyAt(${P.lat}, ${P.lon}, ${P.alt}, ${heading.toFixed(1)}, 160);
          const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          const frame = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 10; i++) await frame();
          __bh.freeze(true); __bh.camera.setLook(0, ${P.pitch ?? -6}); return 1; })()`);
        await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
        const left =
          await app.js<number>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          const t0 = performance.now(); let calm = 0;
          while (performance.now() - t0 < 180000) { const sc = r.earthScenery?.stats?.(); const ok = r.earthTiles.pending === 0 && r.compilingNow.length === 0 && !(sc && (sc.pending || sc.status === "loading"));
            calm = ok ? calm || performance.now() : 0; if (calm && performance.now() - calm > 5000) break; __bh.touch(); await frame(); }
          return r.earthTiles.pending; })()`);
        const gpuMs =
          await app.js<number>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          let done = 0, last = r.lastDoneAt, gpu = 0;
          while (done < 60) { __bh.touch(); await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; gpu += r.lastGpuMs; } }
          for (let i = 0; i < 120; i++) await frame();
          return +(gpu / done).toFixed(2); })()`);
        const agl = await app.js<number>(`Math.round(__bh.camera.last?.agl ?? __bh.game.geoNow?.()?.agl ?? -1)`).catch(() => -1);
        const sc = await app.js<Record<string, unknown> | null>(
          `(() => { const s = __bh.renderer.earthScenery?.stats?.(); const r = __bh.renderer.terrainRasterStats?.scenery; return s && { status: s.status, buildings: s.buildings, bridges: s.bridges, rasterError: r?.error ?? null }; })()`,
        );
        console.log(`  scenery: ${JSON.stringify(sc)}`);
        const file = `${shots}/ground-sunset-${pl}-${side}.png`;
        await app.shot(file);
        rows.push({ place: pl, side, heading: +heading.toFixed(1), sun, gpuMs, tilesLeft: left, agl, file });
        console.log(`  ${pl} ${side}: ${gpuMs} ms GPU, tiles left ${left}, AGL ${agl} m`);
      }
      expect(rows.length).toBeGreaterThan(0);
    }, 900_000);
});
