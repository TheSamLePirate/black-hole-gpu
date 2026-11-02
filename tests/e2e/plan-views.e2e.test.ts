import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS, EARTH_VIEWS, WORLD_VIEWS } from "./lib/plan-views";

// The common plan's shared suite of views (docs/PLAN-REFRACTION-HORIZONS.md — M0a, M0b, then every phase: decision 36):
// each view held still in the game's own settings (its governor on), measured the same way — the frame time over 120
// completed frames, the profiler off (median, 95th and 99th percentiles), the render scale, the raster's shading rate and
// the realtime block in force, then the GPU's passes (the profiler on for a few seconds), the GPU memory (#vram: the page's
// allocations summed, src/bench/vram.ts) and the time the Earth's tiles took to come (the first visit's: a cold Chrome
// profile); a shot of each. Then a 30 s flight over Chamonix: every completed frame's time and, each second, the tiles still
// pending and the relief cache's bakes. One build (its own server), or two A/B in one Chrome (AB_A_URL, AB_B_URL — rounds
// A B B A, AB_ROUNDS pairs: scripts/ab-commit.ts with AB_CMD). ONLY=name,name: some views; PV_FLIGHT=0: no flight;
// PV_WORLDS=0: no rocky worlds. Figures in $PV_OUT/plan-views.json (remote-results/plan-views else), shots <side><round>-<view>.png.
// Duration: ~25 min on kerr-mini (one side, its shaders cached; the first compile more).
// Done when: every view measured on every side, plan-views.json written.

const SIDES = [
  ["A", process.env.AB_A_URL],
  ["B", process.env.AB_B_URL],
].filter((s): s is [string, string] => !!s[1]);
const ROUNDS = Number(process.env.AB_ROUNDS ?? 1);
const OUT = process.env.PV_OUT ?? process.env.AB_OUT ?? "remote-results/plan-views";
const ONLY = process.env.ONLY?.split(",");
const FLIGHT = process.env.PV_FLIGHT !== "0";
const WORLDS = process.env.PV_WORLDS !== "0";
const earth = EARTH_VIEWS.filter((v) => !ONLY || ONLY.includes(v.name));
const worlds = WORLDS ? WORLD_VIEWS.filter((v) => !ONLY || ONLY.includes(`${v.body}-${v.view}`)) : [];

// (a view held, measured: 120 completed frames with the profiler off, then its passes with it on)
const MEASURE = `(async () => {
  const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => q(null)));
  r.prof.enabled = false;
  for (let i = 0; i < 40; i++) { __bh.touch(); await frame(); }
  const g = []; let done = r.completedFrames; const t1 = performance.now();
  while (g.length < 120 && performance.now() - t1 < 60000) { __bh.touch(); await frame();
    if (r.completedFrames !== done) { done = r.completedFrames; g.push(r.completedDurations[r.completedDurations.length - 1]); } }
  g.sort((a, b) => a - b);
  const q = (f) => +(g[Math.min(g.length - 1, Math.floor(f * g.length))] ?? 0).toFixed(2);
  const p0 = __bh.game.perf({ gpu: false });
  const state = { scale: +p0.renderScale.toFixed(3), block: p0.block, rate: p0.terrainRaster?.rate ?? null, primary: p0.terrainRaster?.primary ?? null,
    rings: p0.terrainRaster?.rings ?? null, image: p0.image, budgetMs: p0.budgetMs, quality: p0.quality };
  __bh.game.perf();
  r.prof.enabled = true;
  const t2 = performance.now();
  while (performance.now() - t2 < 4000) { __bh.touch(); await frame(); }
  const p = __bh.game.perf();
  const passes = p.gpu.filter((x) => x.ms > 0.05).sort((a, b) => b.ms - a.ms).slice(0, 16).map((x) => ({ pass: x.pass, ms: +x.ms.toFixed(2) }));
  r.prof.enabled = false;
  const v = __bh.bench?.vram?.() ?? null;
  return { frames: g.length, median: q(0.5), p95: q(0.95), p99: q(0.99), ...state, gpuFrameMs: p.gpuFrameMs, passes,
    vramMiB: v ? Math.round(v.mib) : null, peakMiB: v ? Math.round(v.peakMiB) : null }; })()`;

afterAll(stopServer);

test.skipIf(!E2E)(
  "the common plan's views: frame time, passes, memory, tiles (decision 36)",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis&vram", tiles: true });
    if (!SIDES.length) SIDES.push(["H", app.url]);
    const results: Record<string, unknown>[] = [];
    const save = () => writeFileSync(`${OUT}/plan-views.json`, JSON.stringify(results, null, 1));
    const shot = async (file: string) => {
      const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      await Bun.write(file, Buffer.from(data, "base64"));
    };
    const tiles = (cond: string, ms: number) =>
      app.waitFor(`(() => { const t = __bh.renderer.earthTiles; return ${cond}; })()`, ms).then(
        () => true,
        () => false,
      );
    // (two builds: A B B A, ROUNDS times — each side twice a round, in both orders; one build: ROUNDS times)
    const sequence =
      SIDES.length > 1 ? Array.from({ length: ROUNDS }, () => ["A", "B", "B", "A"]).flat() : Array(ROUNDS).fill(SIDES[0]![0]);

    for (const [n, side] of sequence.entries()) {
      const url = SIDES.find(([s]) => s === side)![1];
      const round = SIDES.length > 1 ? n >> 2 : n;
      const label = `${side}${round}`;
      (app as unknown as { url: string }).url = url;

      for (const v of earth) {
        await app.load("scene=game:artemis&vram");
        await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}); return 1; })()`);
        await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
        await app.js(`(() => { __bh.game.setDate(${JSON.stringify(v.date)}); return 1; })()`);
        await Bun.sleep(1000);
        // (the cockpit, then the look reset: the scene's own look would stay — docs/BH-API.md shipMount)
        const place = `__bh.game.flyAt(${v.at.join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
        const t0 = Date.now();
        await app.js(`(() => { ${place} __bh.freeze(true); return 1; })()`);
        const relief = await tiles("t.finest >= 14 && t.pending === 0", 180_000);
        const reliefS = (Date.now() - t0) / 1000;
        await app.js(`(() => { ${place} return 1; })()`);
        let orthoS: number | null = null;
        if (v.ortho) {
          const ok = await tiles("t.orthoFinest >= 17 && t.orthoPending === 0 && t.pending === 0", 180_000);
          orthoS = ok ? (Date.now() - t0) / 1000 : null;
        }
        await app.settled();
        const m = await app.js<Record<string, unknown>>(MEASURE);
        const t = await app.js<Record<string, unknown>>(
          `(() => { const t = __bh.renderer.earthTiles; return { finest: t.finest, orthoFinest: t.orthoFinest, loaded: t.loaded, failed: t.failed, kept: t.kept }; })()`,
        );
        await shot(`${OUT}/${label}-${v.name}.png`);
        const row = { side, round, view: v.name, what: v.what, reliefReady: relief, reliefS, orthoS, tiles: t, ...m };
        results.push(row);
        save();
        console.log(
          `  ${label} ${v.name}: ${m.median} ms (p95 ${m.p95}), scale ${m.scale}, rate ${m.rate}, relief ${reliefS.toFixed(0)} s`,
        );
      }

      if (FLIGHT && earth.some((v) => v.name === "chamonix-low-sun")) {
        // (the same place flown: the autopilot on, 30 s — every completed frame's time, the tiles and the cache each second)
        await app.js(`(__bh.freeze(false), 1)`);
        await Bun.sleep(1200);
        await app.js(`(() => { const c = __bh.camera;
          if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          if (c.jetModes.spd !== null) c.jetModes.spd = 120; return 1; })()`);
        const flight = await app.js<Record<string, unknown>>(`(async () => {
          const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => q(null)));
          r.prof.enabled = false;
          const g = [], log = []; let done = r.completedFrames; const t0 = performance.now(); let next = 0;
          const builds0 = __bh.game.perf({ gpu: false }).terrainCache?.builds ?? 0;
          while (performance.now() - t0 < 30000) { await frame();
            if (r.completedFrames !== done) { done = r.completedFrames; g.push(r.completedDurations[r.completedDurations.length - 1]); }
            if (performance.now() - t0 >= next) { next += 1000; const t = r.earthTiles, p = __bh.game.perf({ gpu: false });
              log.push({ s: +((performance.now() - t0) / 1000).toFixed(1), pending: t.pending, orthoPending: t.orthoPending, finest: t.finest,
                orthoFinest: t.orthoFinest, builds: (p.terrainCache?.builds ?? 0) - builds0, scale: +p.renderScale.toFixed(3), rate: p.terrainRaster?.rate ?? null }); } }
          const s = [...g].sort((a, b) => a - b), q = (f) => +(s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0).toFixed(2);
          return { frames: g.length, median: q(0.5), p95: q(0.95), p99: q(0.99), max: +(s[s.length - 1] ?? 0).toFixed(1), durations: g.map((x) => +x.toFixed(1)), log }; })()`);
        await shot(`${OUT}/${label}-chamonix-flight.png`);
        results.push({ side, round, view: "chamonix-flight", what: "Chamonix, 30 s of flight at 120 m/s", ...flight });
        save();
        console.log(`  ${label} chamonix-flight: ${flight.median} ms (p95 ${flight.p95}, max ${flight.max}) over ${flight.frames} frames`);
      }

      for (const v of worlds) {
        await app.load(`scene=${encodeURIComponent("Earth: the Blue Marble")}&vram`);
        const set = Array.isArray(v.set) ? v.set[0]! : v.set;
        await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(() => q(null)));
          ${set}
          const t0 = performance.now();
          for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
          while ((!r.kernelsSettled || r.compilesPending > 0 || r.compilingNow.length > 0) && performance.now() - t0 < 600000) { __bh.touch(); await frame(); }
          while (r.earthTiles.pending > 0 && performance.now() - t0 < 600000) { __bh.touch(); await frame(); }
          return 1; })()`);
        const m = await app.js<Record<string, unknown>>(MEASURE);
        const name = `${v.body}-${v.view}`;
        await shot(`${OUT}/${label}-${name}.png`);
        results.push({ side, round, view: name, what: name, ...m });
        save();
        console.log(`  ${label} ${name}: ${m.median} ms (p95 ${m.p95}), scale ${m.scale}`);
      }
    }
    save();
    const errors = app.cdp.errors.filter((e) => !/net::|Failed to load resource|ERR_/.test(e));
    if (errors.length) console.log(`  page errors: ${errors.slice(0, 5).join(" | ")}`);
    app.close();
    expect(results.length).toBeGreaterThan(0);
  },
  4 * 60 * 60_000,
);
