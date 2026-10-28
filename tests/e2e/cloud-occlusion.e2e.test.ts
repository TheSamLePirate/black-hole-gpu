// The clouds before what lies beyond them (docs/PLAN-NUAGES-AAA.md): the Sun's disc behind a cumulus hidden by it — not only
// its glow —, a craft under a deck seen from above hidden by it, and the cumulus' shapes (each its own growth, rounded tops,
// a base that wavers). In the raster pipeline, from the cockpit, the FPS shown. E2E_SHOTS=<dir>: the views
// (cloud-sun-<n>, cloud-carrier, cloud-field-below, cloud-field-above, cloud-storm); remote-results/cloud-occlusion.json: the
// GPU time of each view and the Sun's pixels.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { readPng } from "./lib/png";

const TARIFA = { lat: 36.08, lon: -5.6 };
const DATE = "2026-07-10T17:30:00Z";

// The Sun's azimuth and elevation [°] at a place and time (NOAA's low-precision formulae: a fraction of a degree)
function sunAzEl(iso: string, lat: number, lon: number) {
  const d = new Date(iso);
  const jd = d.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const eps = (23.439 - 4e-7 * n) * (Math.PI / 180);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = (gmst * 15 + lon) * (Math.PI / 180) - ra;
  const la = lat * (Math.PI / 180);
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { az: ((az * 180) / Math.PI + 360) % 360, el: (el * 180) / Math.PI };
}

describe.skipIf(!E2E)("the clouds before the Sun, the Moon and the craft; their shapes", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS ?? "remote-results/cloud-occlusion";
  const rows: unknown[] = [];
  const shot = async (name: string) => {
    await Bun.$`mkdir -p ${shots}`;
    const f = `${shots}/${name}.png`;
    await app.shot(f);
    return f;
  };
  // (the raster pipeline, every bit as shipped; the place set, flown a few seconds on the autopilot, the tiles in, the GPU's
  // time of 60 fresh frames measured; then the world frozen, the image left to settle)
  const view = async (setup: string, look: { yaw: number; pitch: number }, settle = 4000, after = "") => {
    await app.js(`(() => { __bh.freeze(false); __bh.settings.animate = true; ${setup}
      const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
      c.jetModes.alt = c.last?.alt ?? c.jetModes.alt; return 1; })()`);
    await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
    await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < 60000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
        if (calm && performance.now() - calm > ${settle}) break; await frame(); }
      return 1; })()`);
    await app.js(`(__bh.camera.setLook(${look.yaw}, ${look.pitch}), 1)`);
    if (after)
      await app.js(
        `(async () => { ${after}; for (let i = 0; i < 10; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`,
      );
    const gpuMs = await app.js<number>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
      for (let i = 0; i < 20; i++) await frame();
      let done = 0, last = r.lastDoneAt, gpu = 0;
      while (done < 60) { await frame(); if (r.lastDoneAt !== last) { last = r.lastDoneAt; done++; gpu += r.lastGpuMs; } }
      return +(gpu / done).toFixed(2); })()`);
    await app.js(`(__bh.freeze(true), 1)`);
    await Bun.sleep(2500);
    return gpuMs;
  };
  // (the Sun's pixels: in a box round the image's centre — the view aimed at it —, how many are white)
  const sunPixels = (file: string) => {
    const p = readPng(new Uint8Array(require("node:fs").readFileSync(file)));
    let white = 0;
    let max = 0;
    const cx = p.width >> 1;
    const cy = p.height >> 1;
    for (let y = cy - 60; y < cy + 60; y++)
      for (let x = cx - 60; x < cx + 60; x++) {
        const i = (y * p.width + x) * p.channels;
        const l = Math.min(p.data[i]!, p.data[i + 1]!, p.data[i + 2]!);
        max = Math.max(max, l);
        if (l >= 250) white++;
      }
    return { white, max };
  };

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: true, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, targetSpp: 0,
      earthPipeline: "raster", shipMount: "cockpit" }); __bh.renderer.tune = {}; return 1; })()`);
    // (the Alps first: the relief's kernels and tiles warmed as every flight test has them)
    await view(
      `__bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
      {
        yaw: 0,
        pitch: 0,
      },
    );
    await shot("cloud-alps");
  }, 600_000);
  afterAll(async () => {
    await Bun.write("remote-results/cloud-occlusion.json", JSON.stringify(rows, null, 2));
    app?.close();
    stopServer();
  });

  test("the Sun behind a broken cumulus deck: its disc hidden where a cloud stands before it", async () => {
    const sun = sunAzEl(DATE, TARIFA.lat, TARIFA.lon);
    console.log(`  Sun: azimuth ${sun.az.toFixed(1)}°, elevation ${sun.el.toFixed(1)}°`);
    // (a deck of cumulus at 0.75: most lines of sight to the Sun through a cloud, a few through a gap)
    const wx = `const w = { source: "model", kind: "cloudy", rain: 0, dust: 0, fogTop: 0, visibility: 30000,
      wind: { u10: 4, from: 270, gust: 0, turb: 1, shear: 0 }, layers: [{ base: 1200, top: 2800, cover: 0.75 }] };
      __bh.camera.weatherReal = __bh.renderer.weatherReal = w; __bh.settings.weather = "real"; __bh.game.set("earthClouds", 0.3);`;
    for (const [n, dLon] of [0, 0.03, 0.06, 0.09].entries()) {
      // (the craft's own pitch on the autopilot ~3°: the look raised by the rest)
      const gpuMs = await view(
        `__bh.game.setDate("${DATE}"); ${wx} __bh.game.flyAt(${TARIFA.lat}, ${TARIFA.lon + dLon}, 500, ${sun.az.toFixed(1)}, 180);`,
        { yaw: 0, pitch: sun.el - 3 },
        2000,
      );
      const f = await shot(`cloud-sun-${n}`);
      const px = sunPixels(f);
      rows.push({ view: `sun-${n}`, gpuMs, ...px });
      console.log(`  sun-${n}: ${gpuMs} ms GPU, white pixels at the centre ${px.white}, max ${px.max}`);
    }
  }, 900_000);

  test("a carrier under an overcast seen from above it: hidden by the deck (fair weather first: where it lies)", async () => {
    const at = { lat: 35.97, lon: -5.52 };
    // (the F-35B slow on its jets at 3 km — the carrier stays under it —, seen from above and behind it, looking down)
    for (const wx of ["fair", "overcast"]) {
      await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
      const gpuMs = await view(
        `__bh.game.setDate("2026-07-10T12:00:00Z"); __bh.game.set("weather", "${wx}"); __bh.game.set("earthClouds", 1);
         __bh.game.flyAt(${at.lat}, ${at.lon}, 3000, 0, 15);
         __bh.camera.carrierSpawn("ford", { lat: ${at.lat}, lon: ${at.lon}, heading: 0, speed: 0 });
         __bh.settings.shipMount = "around";`,
        { yaw: 0, pitch: 0 },
        4000,
        `Object.assign(__bh.camera.outside, { yaw: 180, pitch: 70, dist: 140 })`,
      );
      const f = await shot(`cloud-carrier-${wx}`);
      rows.push({ view: `carrier-${wx}`, gpuMs, file: f });
      console.log(`  carrier, ${wx}: ${gpuMs} ms GPU`);
    }
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
  }, 600_000);

  test("the cumulus' shapes: from under the deck, from above it, a storm's towers", async () => {
    const views: [string, string, { yaw: number; pitch: number }][] = [
      [
        "cloud-field-below",
        `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1);
         __bh.game.flyAt(36.08, -5.6, 700, 20, 200);`,
        { yaw: 0, pitch: 8 },
      ],
      [
        "cloud-field-above",
        `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1);
         __bh.game.flyAt(36.08, -5.6, 3400, 20, 220);`,
        { yaw: 0, pitch: -6 },
      ],
      [
        "cloud-evening",
        `__bh.game.setDate("2026-07-10T18:20:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1);
         __bh.game.flyAt(36.08, -5.6, 1000, 250, 200);`,
        { yaw: 0, pitch: 3 },
      ],
      [
        "cloud-storm",
        `__bh.game.setDate("2026-07-10T15:00:00Z"); __bh.game.set("weather", "storm"); __bh.game.set("earthClouds", 1);
         __bh.game.flyAt(36.08, -5.6, 5500, 20, 220);`,
        { yaw: 0, pitch: 0 },
      ],
    ];
    for (const [name, setup, look] of views) {
      const gpuMs = await view(setup, look);
      await shot(name);
      rows.push({ view: name, gpuMs });
      console.log(`  ${name}: ${gpuMs} ms GPU`);
    }
    expect(rows.length).toBeGreaterThan(0);
  }, 900_000);
});
