// The regional surface packs (Sentinel-2 colour + WorldCover classes, assets/earth-surface/v1): the Bourget pack
// loads complete, renders in "satellite" and "materials", and costs the frame no more than its budget against "off"
// (each at blocks 1 and 2); the Cévennes pack replaces it, a low flight in the cockpit keeps it, and switching off
// releases its GPU memory. Then the fallbacks: RGBA transcoding without compressed formats, a 16-texture adapter,
// a missing classification worker. Captures and measures: remote-results/earth-surface-*.png, earth-surface-perf.json
// (SURFACE_LIVE_TERRAIN=1: with the live terrain tiles, earth-surface-perf-terrain.json).
import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

afterAll(stopServer);
const scene = async (app: App, lat = 48.95, lon = 2.45, altKm = 2) =>
  app.js(`(() => {
  __bh.freeze(true);
  __bh.game.setDate("2021-06-21T12:00:00Z");
  __bh.presets["Surface pilot"] = {...__bh.presets["Earth: the Blue Marble"], animate:false, ship:false,
    time:__bh.sim.time,
    earthClouds:0, volumetricClouds:false, earthSurface:"satellite", earthScenery:"off", dynamicResolution:false,
    realtimeSubsampling:1, pixelRatio:1, temporalReprojection:true, fpsCap:0,
    pose:{body:"earth", at:[${lat},${lon}], altKm:${altKm}, look:"earth"}};
  __bh.preset("Surface pilot"); __bh.resize();
  return true;
})()`);
const ready = (app: App, region = "bourget") =>
  app.waitFor(
    `__bh.renderer.earthSurface.stats().region === ${JSON.stringify(region)} && __bh.renderer.earthSurface.stats().loaded === 16 && !__bh.renderer.earthSurface.pending`,
    90_000,
  );
const liveTerrain = process.env.SURFACE_LIVE_TERRAIN === "1";
type Measure = { mode: string; block: number; perf: { gpuFrameMs: number }; completedDurations: number[] };

test.skipIf(!E2E)(
  "real regional packs render, switch and release; comparable GPU timings",
  async () => {
    const app = await App.boot({
      hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`,
      width: 960,
      height: 540,
      tiles: liveTerrain,
    });
    try {
      await scene(app);
      await app.js(`(() => { window.__surfaceTick = true; const tick = () => {
        if (!window.__surfaceTick) return; __bh.touch(); requestAnimationFrame(tick);
      }; requestAnimationFrame(tick); return true; })()`);
      await ready(app);
      if (liveTerrain) await app.waitFor("__bh.renderer.earthTiles.pending === 0", 90_000);
      expect(await app.js<string>("__bh.renderer.earthSurface.stats().region")).toBe("bourget");
      expect(await app.js<number>("__bh.renderer.earthSurface.stats().failed")).toBe(0);
      const measures: Measure[] = [];
      for (const block of [1, 2]) {
        await app.js(`(() => { __bh.settings.realtimeSubsampling=${block}; __bh.touch(); return true; })()`);
        for (const mode of ["off", "satellite", "materials", "off"]) {
          await app.js(`(() => { __bh.settings.earthSurface=${JSON.stringify(mode)}; __bh.touch(); return true; })()`);
          if (mode !== "off") await ready(app);
          // Warm through the shader compilation, the uploads and the page fades before timing steady state (the kernel
          // and its calibration settled, then frames drawn — the fades' own time — rather than a fixed delay)
          await app.waitFor("__bh.renderer.variantReady && __bh.renderer.calibrationReady", 120_000);
          const warm = await app.js<number>("__bh.renderer.completedFrames");
          await app.waitFor(`__bh.renderer.completedFrames >= ${warm + 30}`, 60_000);
          // (every frame profiled while measured — 2–3 % of GPU time: one in eight was ~480 frames drawn for 60, 22 s
          // at this view's 22 fps on the M1 Max — 44 ms of GPU since the Oct 12 ground work, 35 ms on Oct 11 — and
          // never within a minute on the mini, whose kiosk draws 1920×1080 whatever the test asks: 60 frames, or 12
          // after 20 s — eight measures of 45 s outran the test's time there)
          await app.js(
            "(() => { __bh.game.perf(); __bh.renderer.prof.every = 1; __bh.renderer.prof.reset();window.__profT0=performance.now(); window.__profF0=__bh.renderer.completedFrames; return true; })()",
          );
          await app.waitFor(
            "__bh.renderer.prof.frames>=60 || (__bh.renderer.prof.frames>=12 && performance.now()-window.__profT0>20000)",
            60_000,
          );
          const m =
            await app.js<Measure>(`({mode:${JSON.stringify(mode)}, block:${block}, perf:__bh.game.perf({gpu:false}), adapter:__bh.renderer.adapter,
          terrain:{enabled:${liveTerrain}, pending:__bh.renderer.earthTiles.pending, finest:__bh.renderer.earthTiles.finest},
          completedDurations:__bh.renderer.frameTelemetry.durationsMs.slice(-Math.max(1, __bh.renderer.completedFrames-window.__profF0))})`);
          measures.push(m);
          if (block === 1) await app.shot(`remote-results/earth-surface-${mode}.png`);
        }
      }
      await Bun.write(`remote-results/earth-surface-perf${liveTerrain ? "-terrain" : ""}.json`, JSON.stringify(measures, null, 2));
      // (a guard, not a budget: the GPU frame of each surface mode against the faster of the two without it, at each
      // block — the profiled GPU time of 60 frames. Measured here three times on the M1 Max, block 1: off 35–37 ms,
      // satellite 38–43, materials 27–55 — a variant compiling mid-measure, the window's own swings; a few-ms budget
      // read that noise (trace-ab measures the kernel's cost, frozen and alternated). It catches a surface costing more
      // than 60 % of the frame without it)
      for (const block of [1, 2]) {
        const at = (mode: string) => measures.filter((m) => m.block === block && m.mode === mode).map((m) => m.perf.gpuFrameMs);
        const frameOff = Math.min(...at("off"));
        for (const mode of ["satellite", "materials"]) {
          const cost = at(mode)[0]! - frameOff;
          console.log(`earth surface ${mode}, block ${block}: ${cost.toFixed(1)} ms over ${frameOff.toFixed(1)} ms`);
          expect(cost).toBeLessThan(0.6 * frameOff);
        }
      }
      await app.js("window.__surfaceTick = false");
      await scene(app, 44.2, 4.15);
      await ready(app, "cevennes");
      expect(await app.js<string>("__bh.renderer.earthSurface.stats().region")).toBe("cevennes");
      await app.js("new Promise(r => setTimeout(r, 500))");
      await app.shot("remote-results/earth-surface-cevennes.png");
      await app.js(`(() => { __bh.preset("game:artemis"); __bh.game.setDate("2021-06-21T12:00:00Z");
      __bh.game.set("flightMode","plane"); __bh.game.glideTo("Bourget",6,0.5,120); __bh.settings.earthSurface="materials";
      __bh.game.set("shipMount","cockpit"); __bh.settings.earthClouds=0; __bh.freeze(true); __bh.step(0); return true; })()`);
      await ready(app);
      expect(await app.js<string>("__bh.renderer.earthSurface.stats().region")).toBe("bourget");
      expect(await app.js<string>("__bh.game.status().soi")).toBe("earth");
      expect(await app.js<string>("__bh.settings.flightMode")).toBe("plane");
      expect(await app.js<string>("__bh.camera.flightModeNow()")).toBe("plane");
      await app.js("new Promise(r => setTimeout(r, 1000))");
      await app.shot("remote-results/earth-surface-low-flight.png");
      await app.js(`(() => { __bh.settings.earthSurface="off"; __bh.touch(); return true; })()`);
      await app.waitFor("__bh.renderer.earthSurface.stats().gpuBytes === 5", 10_000);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  600_000,
);

test.skipIf(!E2E)(
  "RGBA transcoding fallback preserves sRGB colour and complete pages",
  async () => {
    const app = await App.boot({
      hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`,
      width: 320,
      height: 240,
      initScript: `(() => { const original = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = function(descriptor) {
        return original.call(this, {...descriptor, requiredFeatures:(descriptor.requiredFeatures || []).filter(x=>!x.startsWith("texture-compression-"))});
      }; })()`,
    });
    try {
      await scene(app);
      await ready(app);
      const s = await app.js("__bh.renderer.earthSurface.stats()");
      expect(s.format).toBe("rgba");
      expect(s.gpuBytes).toBeLessThan(102 * 1024 ** 2);
      expect(await app.js<boolean>("__bh.renderer.earthSurface.colorView().label !== undefined")).toBe(true);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  180_000,
);

test.skipIf(!E2E)(
  "16-texture adapters keep the existing renderer without optional resources",
  async () => {
    const app = await App.boot({
      hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`,
      width: 320,
      height: 240,
      initScript: `Object.defineProperty(GPUSupportedLimits.prototype,"maxSampledTexturesPerShaderStage",{get(){return 16;},configurable:true});`,
    });
    try {
      await scene(app);
      await app.waitFor('__bh.renderer.earthSurface.stats().status === "unsupported-texture-limit"');
      expect(await app.js<number>("__bh.renderer.earthSurface.stats().gpuBytes")).toBe(5);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  180_000,
);

test.skipIf(!E2E)(
  "an unavailable classification worker settles on the existing landscape",
  async () => {
    const app = await App.boot({
      hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`,
      width: 320,
      height: 240,
      initScript: `(() => { const Original=Worker; window.Worker=class extends Original {
      constructor(url, options) { if(String(url).includes("earth-surface-worker")) throw new Error("test: cover unavailable"); super(url,options); }
    }; })()`,
    });
    try {
      await scene(app);
      await app.waitFor(
        '__bh.renderer.earthSurface.stats().status === "degraded" && __bh.renderer.earthSurface.stats().failed === 16',
        90_000,
      );
      expect(await app.js<boolean>("__bh.renderer.earthSurface.active")).toBe(false);
      // (failed pages are tried again — 2 s, doubled up to a minute —: pending while a retry runs, not held for good)
      await app.waitFor("!__bh.renderer.earthSurface.pending", 30_000);
      expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  },
  180_000,
);
