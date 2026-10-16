import { afterAll, beforeAll, describe, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The realtime render's costs, one thing at a time, by alternation (Apple's render passes' timestamps overlap: the
// whole frame's interval tells — snapped to the display's refresh, 20 ms on kerr-mini's 50 Hz —, and the trace
// pass's own, a compute pass): a steady low flight over the hills north of Tarifa from the cockpit — the real traffic in the
// strait below, clouds —, at ×4 then ×6; each pair A/B alternated 3 times, 3 s each, the interval between frames
// done kept (the GPU's time per frame while it limits: renderer.lastGpuMs counts a queued frame's wait), the
// medians compared. First the Alps as ever.

type Pair = { name: string; a: string; b: string };
const sk = (part: string) => ({
  name: `the craft's raster: ${part}`,
  a: `__bh.renderer.ship.debugSkip.delete("${part}")`,
  b: `__bh.renderer.ship.debugSkip.add("${part}")`,
});
/** SET=ship: the craft's raster, part by part (ship.ts debugSkip) */
const SHIP: Pair[] = [
  { name: "the craft's raster (cockpit, the others)", a: "__bh.renderer.debugSkipShip = false", b: "__bh.renderer.debugSkipShip = true" },
  sk("glass"),
  sk("glass-sr"),
  sk("glass-flat"),
  sk("plume"),
];
/** SET=trace: what each ray costs in the trace pass (its timestamps, every frame profiled — a compute pass: its own
 *  time, unlike the render passes'), at ×2 where the trace is most of the frame — the cost that keeps ×1 away */
const TRACE: Pair[] = [
  { name: "render scale 1 → 0.5 (a quarter of the rays)", a: "__bh.forceScale(null)", b: "__bh.forceScale(0.5)" },
  { name: "the head ahead → up at the sky (+35°)", a: "__bh.settings.shipLookPitch = 0", b: "__bh.settings.shipLookPitch = 35" },
  { name: "the head ahead → down at the ground (−30°)", a: "__bh.settings.shipLookPitch = 0", b: "__bh.settings.shipLookPitch = -30" },
  { name: "scenery balanced → off", a: `__bh.game.set("earthScenery", "balanced")`, b: `__bh.game.set("earthScenery", "off")` },
  { name: "scenery's shadows → off", a: `__bh.game.set("earthSceneryShadows", true)`, b: `__bh.game.set("earthSceneryShadows", false)` },
  { name: "real ground tiles → the global map", a: `__bh.game.set("earthTerrain", true)`, b: `__bh.game.set("earthTerrain", false)` },
  { name: "Sentinel surface → off", a: `__bh.game.set("earthSurface", "satellite")`, b: `__bh.game.set("earthSurface", "off")` },
  { name: "volumetric clouds → flat", a: `__bh.game.set("volumetricClouds", true)`, b: `__bh.game.set("volumetricClouds", false)` },
  { name: "the clouds 0.3 → none", a: `__bh.game.set("earthClouds", 0.3)`, b: `__bh.game.set("earthClouds", 0)` },
  { name: "sea FFT → wave trains", a: `__bh.game.set("seaFft", true)`, b: `__bh.game.set("seaFft", false)` },
  { name: "weather cloudy → fair (HAS_WX)", a: `__bh.game.set("weather", "cloudy")`, b: `__bh.game.set("weather", "fair")` },
];
const ALL: Pair[] = [
  { name: "the craft's raster (cockpit, the others)", a: "__bh.renderer.debugSkipShip = false", b: "__bh.renderer.debugSkipShip = true" },
  { name: "the real traffic", a: `__bh.game.set("traffic", true)`, b: `__bh.game.set("traffic", false)` },
  { name: "cockpit → chase", a: `__bh.settings.shipMount = "cockpit"`, b: `__bh.settings.shipMount = "chase"` },
  { name: "scenery balanced → off", a: `__bh.game.set("earthScenery", "balanced")`, b: `__bh.game.set("earthScenery", "off")` },
  { name: "volumetric clouds → flat", a: `__bh.game.set("volumetricClouds", true)`, b: `__bh.game.set("volumetricClouds", false)` },
  { name: "motion blur 0.5 → 0", a: `__bh.game.set("motionBlur", 0.5)`, b: `__bh.game.set("motionBlur", 0)` },
  { name: "render scale 1 → 0.75", a: "__bh.forceScale(null)", b: "__bh.forceScale(0.75)" },
  { name: "gaze-led streaming on → off", a: "__bh.renderer.gazeStreaming = true", b: "__bh.renderer.gazeStreaming = false" },
  { name: "reprojection 0.5 px → 64 px", a: "__bh.renderer.taParallaxPx = 0.5", b: "__bh.renderer.taParallaxPx = 64" },
];

describe.skipIf(!E2E)("the realtime render's costs, one thing at a time", () => {
  let app: App;
  const rows: string[] = [];
  beforeAll(async () => {
    // (NOVSYNC=disable-gpu-vsync[,disable-frame-rate-limit]: Chrome unthrottled — the frames back to back, the GPU's clock up: its time per frame unquantized
    // by the display's refresh; else the intervals snap to 16.7 ms steps and Apple's GPU idles down between)
    app = await App.boot({
      width: 1600,
      height: 1000,
      lang: "fr",
      hash: "scene=game:artemis",
      tiles: true,
      args: process.env.NOVSYNC ? process.env.NOVSYNC.split(",").map((f) => `--${f}`) : [],
    });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: true, f35AutoProtect: true, showFps: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    console.log(`\n${rows.join("\n")}`);
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 2500, 110, 200); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
    await Bun.sleep(2500);
  }, 240_000);

  for (const sub of (process.env.SUBS ?? "4,6").split(",").map(Number))
    test(`×${sub}: each pair alternated`, async () => {
      // (the hills north of Tarifa, 900 m up, northwards — re-placed before each pair: the same ground)
      const place = () =>
        app.js(`(() => { __bh.game.quality("realtime"); __bh.game.set("realtimeSubsampling", ${sub}); __bh.game.set("weather", "cloudy"); __bh.game.setDate("2026-07-10T10:00:00Z");
          __bh.game.set("earthClouds", 0.3); __bh.settings.shipLookPitch = 0; __bh.forceScale(null); __bh.renderer.prof.enabled = true; __bh.renderer.prof.every = 1;
          __bh.game.flyAt(36.1, -5.55, 900, 0, 210); __bh.settings.shipMount = "cockpit"; const c = __bh.camera;
          if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); c.jetModes.alt = 900; c.jetModes.spd = 210; c.jetModes.hdg = 0; return 1; })()`);
      const set = process.env.SET === "ship" ? SHIP : process.env.SET === "trace" ? TRACE : ALL;
      // (ONLY=0,3: those pairs alone)
      const only = process.env.ONLY?.split(",").map(Number);
      for (const P of only ? set.filter((_, i) => only.includes(i)) : set) {
        await place();
        await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 180_000).catch(() => {});
        await Bun.sleep(3000);
        const med: Record<"a" | "b", number[]> = { a: [], b: [] };
        const trace: Record<"a" | "b", number[]> = { a: [], b: [] };
        const cpu: Record<"a" | "b", string> = { a: "", b: "" };
        for (let k = 0; k < 6; k++) {
          const side = k % 2 ? "b" : "a";
          await app.js(`(() => { ${side === "a" ? P.a : P.b}; return 1; })()`);
          await Bun.sleep(1200);
          await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 60_000).catch(() => {});
          // (each frame done: the interval since the last; each frame profiled: the trace pass's own time)
          const v = await app.js<{
            iv: number[];
            tr: number[];
          }>(`new Promise((res) => { const r = __bh.renderer, iv = [], tr = []; let last = r.completedFrames, pf = r.prof.frames; const t0 = performance.now();
            let tl = t0; const f = () => { const now = performance.now(); if (r.completedFrames !== last) { iv.push((now - tl) / (r.completedFrames - last)); last = r.completedFrames; tl = now; }
              if (r.prof.frames !== pf) { pf = r.prof.frames; const t = r.prof.table().find((x) => x.label === "trace"); if (t) tr.push(t.last); }
              if (now - t0 < 3000) requestAnimationFrame(f); else res({ iv: iv.slice(1), tr: tr.slice(1) }); }; requestAnimationFrame(f); })`);
          const mid = (x: number[]) => [...x].sort((p, q) => p - q)[x.length >> 1] ?? Number.NaN;
          med[side].push(mid(v.iv));
          trace[side].push(mid(v.tr));
          // (the main thread's share: its sections per loop, the loop's rate — what limits when the GPU does not)
          if (k >= 4)
            cpu[side] = await app.js<string>(`(() => { const p = __bh.game.perf(); const c = p.cpu.reduce((a, x) => a + x.ms, 0);
              const tr = p.gpu.find((g) => g.pass === "trace");
              return "CPU " + c.toFixed(1) + " ms (" + p.cpu.slice(0, 3).map((x) => x.section + " " + x.ms.toFixed(1)).join(", ") + "), loop " + p.loopFps.toFixed(0) + "/s, trace " + (tr ? tr.ms.toFixed(1) : "?") + " ms"; })()`);
        }
        await app.js(`(() => { ${P.a}; return 1; })()`);
        const m = (x: number[]) => [...x].sort((p, q) => p - q)[x.length >> 1]!;
        const A = m(med.a),
          B = m(med.b);
        const TA = m(trace.a),
          TB = m(trace.b);
        const row = `×${sub}  ${P.name.padEnd(46)} frame A ${A.toFixed(1).padStart(5)} B ${B.toFixed(1).padStart(5)} ms (Δ ${(B - A).toFixed(1)})   trace A ${TA.toFixed(1).padStart(5)} B ${TB.toFixed(1).padStart(5)} ms  Δ ${(TB - TA).toFixed(1).padStart(6)} ms (${(((TB - TA) / TA) * 100).toFixed(0)} %)   ${trace.a.map((x) => x.toFixed(0)).join("/")} | ${trace.b.map((x) => x.toFixed(0)).join("/")}`;
        rows.push(row);
        console.log(`  ${row}\n      A: ${cpu.a}\n      B: ${cpu.b}`);
      }
    }, 900_000);
});
