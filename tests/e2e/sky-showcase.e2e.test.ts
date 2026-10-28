// Two views to look at (docs/PLAN-NUAGES-AAA.md, PLAN-PLUIE): a sunset over the strait under broken cumulus — the Sun low behind
// them, the shafts of light and shadow in the air (crepuscular rays: the clouds' shadow map, trace.wgsl earthAir) —, and an
// evening shower with the Sun low behind the camera — the rain lit, its rainbow at 42° from the antisolar point. The F-35 from
// its cockpit, the raster pipeline, the FPS shown, every kernel compiled before a shot. E2E_SHOTS=<dir> (sunset-<n>.png,
// rainbow-<n>.png); remote-results/sky-showcase.json: each view's GPU time. RAINBOW_AT: the places' longitude offsets [°];
// RAINBOW_KIND: the weather's kind (rain); RAINBOW_DEBUG=1: all the rain in the sun (TUNE_GSKIP 262144 — the arcs whole). A
// rainbow needs a shower in the direct Sun: a storm's deck with a low base shades its own rain at a low Sun (none seen there).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

const TARIFA = { lat: 36.08, lon: -5.6 };

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
// (a weather set as the real one: the model's kind, rain, a layer of cloud)
const weather = (kind: string, rain: number, layer: { base: number; top: number; cover: number }, vis = 30000) =>
  `{ const w = { source: "model", kind: "${kind}", rain: ${rain}, dust: 0, fogTop: 0, visibility: ${vis},
    wind: { u10: 5, from: 270, gust: 2, turb: 1, shear: 2 }, layers: [${JSON.stringify(layer)}] };
    __bh.camera.weatherReal = __bh.renderer.weatherReal = w; __bh.settings.weather = "real"; __bh.game.set("earthClouds", 0.2); }`;

describe.skipIf(!E2E)("a sunset's crepuscular rays, a shower's rainbow", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS ?? "remote-results/sky-showcase";
  const rows: { view: string; gpuMs: number }[] = [];
  // (put there, frozen at once — the same view however long the kernels take —, the kernels and tiles waited for, the look
  // aimed; 60 fresh frames timed, then the image left to settle and shot)
  const view = async (name: string, setup: string, look: { yaw: number; pitch: number }) => {
    await app.js(`(async () => { __bh.freeze(false); ${setup}
      const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      const frame = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 10; i++) await frame();
      __bh.freeze(true); __bh.camera.setLook(${look.yaw}, ${look.pitch}); return 1; })()`);
    await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
    await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < 90000) { const ok = r.earthTiles.pending === 0 && r.compilingNow.length === 0;
        calm = ok ? calm || performance.now() : 0; if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
      return 1; })()`);
    const gpuMs = await app.js<number>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
      let done = 0, last = r.lastDoneAt, gpu = 0;
      while (done < 60) { __bh.touch(); await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; gpu += r.lastGpuMs; } }
      for (let i = 0; i < 90; i++) await frame();
      return +(gpu / done).toFixed(2); })()`);
    await app.shot(`${shots}/${name}.png`);
    rows.push({ view: name, gpuMs });
    console.log(`  ${name}: ${gpuMs} ms GPU`);
    return gpuMs;
  };

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: true, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, targetSpp: 0,
      earthPipeline: "raster", shipMount: "cockpit" }); __bh.renderer.tune = {}; return 1; })()`);
    await Bun.$`mkdir -p ${shots}`;
  }, 300_000);
  afterAll(async () => {
    await Bun.write("remote-results/sky-showcase.json", JSON.stringify(rows, null, 2));
    app?.close();
    stopServer();
  });

  test("a sunset over the strait under broken cumulus: the Sun behind them, the shafts in the air", async () => {
    // (the Sun ~4° up: the cumulus between 1.5 and 3 km before it, the camera under them at 700 m)
    for (const [n, date] of ["2026-07-10T19:05:00Z", "2026-07-10T19:20:00Z"].entries()) {
      const sun = sunAzEl(date, TARIFA.lat, TARIFA.lon);
      console.log(`  Sun ${date}: azimuth ${sun.az.toFixed(1)}°, elevation ${sun.el.toFixed(1)}°`);
      await view(
        `sunset-${n}`,
        `__bh.game.setDate("${date}"); ${weather("cloudy", 0, { base: 1500, top: 3200, cover: 0.55 })}
         __bh.game.flyAt(${TARIFA.lat}, ${TARIFA.lon}, 700, ${sun.az.toFixed(1)}, 180);`,
        { yaw: 0, pitch: Math.max(sun.el, 0) + 2 },
      );
    }
  }, 1_200_000);

  test("an evening shower ahead, the Sun low behind: the rain lit, its rainbow", async () => {
    const date = "2026-07-10T18:50:00Z";
    const sun = sunAzEl(date, TARIFA.lat, TARIFA.lon);
    const anti = (sun.az + 180) % 360;
    console.log(`  Sun: azimuth ${sun.az.toFixed(1)}°, elevation ${sun.el.toFixed(1)}° — the antisolar point at ${anti.toFixed(1)}°`);
    // (isolated cumulonimbus at a third of the sky: their rain ahead between them, the Sun through the gaps behind)
    // (an evening's showers from a broken deck of cumulus congestus: a high base — the low Sun passes under it, through its gaps,
    // onto the rain falling from it —, its curtains ahead)
    const wx = weather(process.env.RAINBOW_KIND ?? "rain", 0.7, { base: 2000, top: 4500, cover: 0.5 }, 40000);
    // (places along the coast a few km apart: one of them with a shower ahead at the rainbow's angle)
    const places = (process.env.RAINBOW_AT ?? "0,0.06,0.12,0.18").split(",").map(Number);
    for (const [n, dLon] of places.entries())
      await view(
        `rainbow-${n}`,
        `__bh.game.setDate("${date}"); ${wx} __bh.game.flyAt(${TARIFA.lat}, ${TARIFA.lon + dLon}, 400, ${anti.toFixed(1)}, 200);
         ${process.env.RAINBOW_DEBUG ? "__bh.renderer.tune = { TUNE_GSKIP: 262144 };" : ""}`,
        { yaw: 0, pitch: 14 },
      );
    expect(rows.length).toBeGreaterThan(0);
  }, 1_200_000);
});
