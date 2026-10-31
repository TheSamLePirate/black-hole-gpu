// The Earth's refraction drawn on WGS84 (PLAN-REFRACTION-HORIZONS R2, the frame): the Sun setting to the north-west from
// over the sea off La Hague (49.7° N, 21 June 2026) at a 1.5° field, the stabilised telescope aimed by the CPU — figureUp's
// geodetic vertical, refraction.ts — at the Sun's refracted centre. The drawn disc's centroid against the image's centre:
// trace.wgsl airBend once took the true look against the squashed vertical (the sky's elevations 5.8′ off at 45° of
// latitude, to the north and south), the disc drawn ~0.5′ off the CPU's aim here. Prints the offset [px, ′] and writes
// $AB_OUT/refraction-wgs84.json and .png. Duration: ~4 min cold on this Mac's headless Chrome.
// Done when: the disc's edges' midpoint within 0.2′ of where the CPU's own model puts it (its aim from h = 0, the limbs
// refracted at the camera's height).
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { apparentAltitude } from "../../src/system/refraction";
import { App, E2E, stopServer } from "./lib/app";

const OUT = process.env.AB_OUT ?? "remote-results";
const FOV = 1.5;

// The Sun's elevation [°] (NOAA's low-precision formulae): the moment it stands ~0.4° up
function sunEl(ms: number, lat: number, lon: number) {
  const n = ms / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const eps = (23.439 - 4e-7 * n) * (Math.PI / 180);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const ha = ((((18.697374558 + 24.06570982441908 * n) % 24) * 15 + lon) * Math.PI) / 180 - ra;
  const la = (lat * Math.PI) / 180;
  return (Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) * 180) / Math.PI;
}

afterAll(stopServer);

test.skipIf(!E2E)(
  "the setting Sun to the north-west at 49.7° N: drawn where the CPU aims (WGS84 vertical)",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const [lat, lon] = [49.75, -2.1];
    let t = Date.parse("2026-06-21T19:30:00Z");
    while (sunEl(t, lat, lon) > 0.4) t += 30_000;
    const iso = new Date(t).toISOString();
    const app = await App.boot({ width: 1600, height: 1200, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, weather: "fair", earthClouds: 0,
      dof: false, earthPipeline: "raster", dynamicResolution: false, autoGear: false, f35AutoProtect: false, refraction: true }); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
    await app.js(`(() => { __bh.game.setDate("${iso}"); __bh.game.flyAt(${lat}, ${lon}, 200, 305, 140);
      __bh.settings.shipMount = "cockpit"; __bh.settings.target = "sun"; return 1; })()`);
    await Bun.sleep(1500);
    await app
      .waitFor(`__bh.renderer.rasterLiteActive && __bh.renderer.variantQueue.pending === 0`, 600_000)
      .catch(() => console.warn("  raster kernels not all in"));
    if (!(await app.js<boolean>(`__bh.settings.lookAt`))) await app.press("KeyC");
    await Bun.sleep(1500);
    await app.press("KeyY");
    await app.js(`(__bh.camera.setFov(${FOV}), 1)`);
    // (the lens eased to its field before the freeze — frozen, it would stay where it was)
    await app.waitFor(`Math.abs(__bh.settings.fov - ${FOV}) < 0.002`, 30_000);
    // (the clock and the craft put back where they were — the kernels' compiling took minutes, the Sun went down meanwhile —,
    // then held still: frozen, the image settled)
    await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q));
      __bh.game.setDate("${iso}"); __bh.game.flyAt(${lat}, ${lon}, 200, 305, 140);
      for (let i = 0; i < 20; i++) await f(); __bh.game.setDate("${iso}"); __bh.freeze(true);
      for (let i = 0; i < 120; i++) { __bh.touch(); await f(); } return 1; })()`);
    expect(Math.abs((await app.js<number>(`__bh.settings.fov`)) - FOV)).toBeLessThan(0.002);
    await app.waitFor(`__bh.renderer.variantQueue.pending === 0 && __bh.renderer.compilingNow.length === 0`, 300_000).catch(() => {});
    await Bun.sleep(2000);
    // (the disc: the pixels over 60 % of the brightest, their centroid; the canvas read as shown)
    // (until the disc shows: a frame read while the kernel still compiles is black)
    const m = await app.js<{
      w: number;
      h: number;
      cx: number;
      cy: number;
      n: number;
      top: number;
      bottom: number;
      max: number;
      et: number;
      eb: number;
    }>(`(async () => {
      const cv = document.querySelector("canvas");
      let b, o, g, d, max = 0;
      for (const t0 = performance.now(); performance.now() - t0 < 240000; ) {
        __bh.touch();
        b = await new Promise((r) => requestAnimationFrame(() => r(createImageBitmap(cv))));
        o = new OffscreenCanvas(b.width, b.height); g = o.getContext("2d"); g.drawImage(b, 0, 0);
        d = g.getImageData(0, 0, b.width, b.height).data;
        max = 0; for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722);
        if (max > 60) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      // (a few frames more once it shows: the image settled)
      for (let i = 0; i < 60; i++) { __bh.touch(); await new Promise((r) => requestAnimationFrame(r)); }
      b = await new Promise((r) => requestAnimationFrame(() => r(createImageBitmap(cv))));
      o = new OffscreenCanvas(b.width, b.height); g = o.getContext("2d"); g.drawImage(b, 0, 0);
      d = g.getImageData(0, 0, b.width, b.height).data;
      max = 0; for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722);
      let n = 0, sx = 0, sy = 0, top = 1e9, bottom = -1, et = 1e9, eb = -1;
      for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) { const i = 4 * (y * b.width + x);
        const lum = d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
        if (lum > 0.15 * max) { et = Math.min(et, y); eb = Math.max(eb, y); }
        if (lum > 0.6 * max) { n++; sx += x; sy += y; top = Math.min(top, y); bottom = Math.max(bottom, y); } }
      const u8 = new Uint8Array(await (await o.convertToBlob({ type: "image/png" })).arrayBuffer());
      let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
      window.__shot = btoa(s);
      return { w: b.width, h: b.height, cx: sx / n, cy: sy / n, n, top, bottom, max, et, eb }; })()`);
    writeFileSync(`${OUT}/refraction-wgs84.png`, Buffer.from(await app.js<string>(`window.__shot`), "base64"));
    const fov = await app.js<number>(`__bh.settings.fov`);
    const perPx = (fov * 60) / m.h;
    const dy = m.cy - m.h / 2;
    // (what the CPU's own model expects: the limbs drawn at the camera's height — the tracer's —, their midpoint against the
    // aim, which refractDirection raises as from the sea, h = 0; the Sun's radius 15.74′ on 21 June)
    const sky = await app.js<{ heightM: number; refraction: { refractivity: number }; sun: { altDeg: number } }>(`__bh.camera.skyInfo()`);
    const D = Math.PI / 180,
      r = (15.74 / 60) * D,
      e = sky.sun.altDeg * D,
      h = sky.heightM,
      n0 = sky.refraction.refractivity;
    const expectArcmin = ((apparentAltitude(e + r, h, n0) + apparentAltitude(e - r, h, n0)) / 2 - apparentAltitude(e, 0, n0)) / (D / 60);
    // (the edges' midpoint above the image's centre [′]: up is positive)
    const midArcmin = -((m.et + m.eb) / 2 - m.h / 2) * perPx;
    const row = {
      iso,
      lat,
      lon,
      fov,
      ...m,
      heightM: h,
      sunAltDeg: sky.sun.altDeg,
      midArcmin: +midArcmin.toFixed(3),
      expectArcmin: +expectArcmin.toFixed(3),
      offArcmin: +(midArcmin - expectArcmin).toFixed(3),
      dyPx: +dy.toFixed(2),
      dyArcmin: +(dy * perPx).toFixed(3),
      dxPx: +(m.cx - m.w / 2).toFixed(2),
      flattening: +(((m.bottom - m.top) * perPx) / 31.5).toFixed(3),
      errors: app.cdp.errors.length,
    };
    writeFileSync(`${OUT}/refraction-wgs84.json`, JSON.stringify(row, null, 2));
    console.log(`  ${iso}: disc centroid ${row.dyPx} px (${row.dyArcmin}′) below the aim, ${row.dxPx} px across; ${m.n} px lit`);
    console.log(
      `  edges' midpoint ${row.midArcmin}′ up, the CPU's model ${row.expectArcmin}′ (camera ${h} m, Sun ${sky.sun.altDeg}°): off by ${row.offArcmin}′`,
    );
    app.close();
    expect(m.max).toBeGreaterThan(60);
    // (one disc, whole in the image: not the frame's edges)
    expect(m.top).toBeGreaterThan(0);
    expect(m.bottom).toBeLessThan(m.h - 1);
    expect(m.n).toBeGreaterThan(1000);
    expect(Math.abs(row.offArcmin)).toBeLessThan(0.2);
  },
  900_000,
);
