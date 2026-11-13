import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE } from "./lib/j0-scene";

// PLAN-J2 J2-7, step A — what the raster's material leaves to the tracer, counted (docs/PLAN-J2-PAGES-RECONSTRUCTION.md J2-7: "la mesure
// d'abord : ce que shade et bodyLite couvrent et coûtent sur J0 et sur la Lune"). The live view's moments read back once the view is
// settled, each pixel by its mark (trace.wgsl): the raster's material (liteFinish: moments.x exactly 1e30, 4e30 its water), the tracer's
// remainder (shade: 1e30 × (1 + its albedo), 4e30 × … water), a pixel left by the partial shading this frame (RASTER_STALE, −3…−3.45),
// the cockpit's mask (−1), traced by main (≥ 0, below 1e29), else. At J0's place (the F-35's cockpit, 500 m over the Rade d'Hyères,
// frozen), over the Gapeau's plain (300 m: land) and on the Moon (Triesnecker from 4 km — moon-tiles' view —, the body raster), each with the shading rate as chosen and at
// every pixel ("every"); the raster's passes' GPU time over 60 frames (indicative only on a throttled machine). J2C_OUT.
// Duration: ~6 min (two boots, the Moon's tiles).
// Done when: both places counted at both rates, no GPU error.

const OUT = process.env.J2C_OUT ?? "remote-results/j2-cover";
afterAll(stopServer);

/** in the page: the live view's pixels by what drew them (moments.x's marks), its rate, and the raster's passes over 60 frames */
const COVER_JS = `(async () => {
  const R = __bh.renderer, t = R.live, dev = R.device;
  if (!t?.moments) return null;
  const n = t.width * t.height, buf = dev.createBuffer({ size: n * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const e = dev.createCommandEncoder(); e.copyBufferToBuffer(t.moments, 0, buf, 0, n * 8); dev.queue.submit([e.finish()]);
  await buf.mapAsync(GPUMapMode.READ); const m = new Float32Array(buf.getMappedRange().slice(0)); buf.unmap(); buf.destroy();
  const c = { lite: 0, liteWater: 0, shade: 0, shadeWater: 0, stale: 0, mask: 0, traced: 0, other: 0 };
  for (let i = 0; i < n; i++) {
    const x = m[2 * i];
    if (x === 1e30 || x === Math.fround(1e30)) c.lite++;
    else if (x === Math.fround(4e30)) c.liteWater++;
    else if (x > 1e30 && x <= 2.0001e30) c.shade++;
    else if (x > 4e30 && x <= 5.0001e30) c.shadeWater++;
    else if (x <= -2.5 && x > -3.5) c.stale++;
    else if (x < -0.5 && x > -1.5) c.mask++;
    else if (x >= 0 && x < 1e29) c.traced++;
    else c.other++;
  }
  const share = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, +(v / n).toFixed(4)]));
  R.prof.enabled = true; R.prof.every = 1; R.prof.reset();
  const f = () => new Promise((q) => requestAnimationFrame(q));
  for (let i = 0; i < 60; i++) { __bh.touch(); await f(); }
  const T = R.prof.table();
  const passes = T.filter((x) => /lite|shade|raster|trace|water/.test(x.label)).slice(0, 12).map((x) => [x.label, +x.ms.toFixed(3)]);
  return { width: t.width, height: t.height, rate: R.rasterRate, body: R.bodyRasterNow, counts: c, share, passes, gpuMs: R.lastGpuMs }; })()`;

async function count(app: App, label: string, out: Record<string, unknown>) {
  for (const shading of ["auto", "every"] as const) {
    await app.js(`(() => { __bh.settings.earthRasterShading = "${shading}"; __bh.touch(); return 1; })()`);
    await app.js(
      `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 90; i++) { __bh.touch(); await f(); } return 1; })()`,
    );
    const r = await app.js<Record<string, unknown> | null>(COVER_JS);
    out[`${label}-${shading}`] = r;
    console.log(`  ${label} ${shading}: ${JSON.stringify(r)}`);
    expect(r).not.toBeNull();
  }
  await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
  await app.shot(`${OUT}/${label}.png`);
  await app.js(`(() => { document.body.classList.remove("hide-ui"); __bh.settings.earthRasterShading = "auto"; return 1; })()`);
}

test.skipIf(!E2E)(
  "J2-7 step A: the raster's material and the tracer's remainder, counted at J0 and on the Moon",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const out: Record<string, unknown> = {};
    {
      const app = await App.boot({ width: 1440, height: 810, lang: "fr", hash: "scene=game:artemis", tiles: true });
      try {
        await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
        const [lat, lon, agl, hdg, v] = J0_SCENE.start;
        await app.js(`(async () => { __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${v});
          __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
          for (let i = 0; i < 40; i++) await new Promise((q) => requestAnimationFrame(q)); __bh.freeze(true); return 1; })()`);
        await app.settled(180_000);
        await app
          .dataSettled("J2-7: J0", { maxMs: 60_000 })
          .catch((e) => console.log(`  (J0 data not settled: ${String(e).slice(0, 120)})`));
        await count(app, "j0", out);
        // (a land view as well — J0's is mostly the sea, shaded by its own pass —: the Gapeau's plain, 300 m, cap 20° — j2-probes'
        // hyeres-low)
        await app.js(`(async () => { __bh.freeze(false); __bh.game.flyAt(43.12, 6.13, 300, 20, 140);
          __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
          for (let i = 0; i < 40; i++) await new Promise((q) => requestAnimationFrame(q)); __bh.freeze(true); return 1; })()`);
        await app.settled(180_000);
        await app
          .dataSettled("J2-7: land", { maxMs: 60_000 })
          .catch((e) => console.log(`  (land data not settled: ${String(e).slice(0, 120)})`));
        await count(app, "land", out);
        out.j0Errors = await app.js<number>(`__bh.renderer.gpuErrors`);
      } finally {
        app.close();
      }
    }
    {
      const app = await App.boot({ width: 1440, height: 810, hash: `scene=${encodeURIComponent("Moon: an afternoon on the plains")}` });
      try {
        // (moon-tiles' Triesnecker from 4 km, its tiles in)
        await app.js(`(() => { __bh.presets.j2c = { ...__bh.presets["Mars: from orbit"], target: "moon", fov: 60, ship: false,
          pose: { at: [3.45, 3.6], body: "moon", altKm: 4, look: "moon", off: [0, 66] } }; __bh.game.preset("j2c");
          Object.assign(__bh.settings, { dynamicResolution: false, dof: false, motionBlur: 0 }); return 1; })()`);
        await app.js(`(async () => { const r = __bh.renderer, m = r.moonTiles, t0 = performance.now(), f = () => new Promise((q) => requestAnimationFrame(q));
          for (let i = 0; i < 4; i++) { __bh.touch(); await f(); }
          while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0 || m.pending > 0) && performance.now() - t0 < 180000) { __bh.touch(); await f(); }
          for (let i = 0; i < 60; i++) { __bh.touch(); await f(); } return 1; })()`);
        await count(app, "moon", out);
        out.moonErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      } finally {
        app.close();
      }
    }
    await Bun.write(`${OUT}/cover.json`, JSON.stringify(out, null, 1));
    expect(out.j0Errors).toBe(0);
    expect(out.moonErrors).toBe(0);
  },
  600_000,
);
