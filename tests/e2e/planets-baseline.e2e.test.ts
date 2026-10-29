import { afterAll, beforeAll, describe, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { SPOTS as ALL, preset, SHOWCASE } from "./lib/planet-views";

// PLAN-PLANETES-AAA P0 (docs/PLAN-PLANETES-AAA.md): every world's cost and look in the same four views — from orbit, in
// low flight (3 km up, looking at the horizon), on foot (the walker, third person), and its showcase scene — measured
// the same way, the Earth's figures the budget no other world may pass in the same view.
// The viewer's scenes (no craft, no cockpit: the world's own cost), the game's settings but a fixed scale (no dynamic
// resolution, no frame cap), the clock held and the view marked changed each frame (__bh.touch: the realtime pass, the
// same rays each frame). Each view: the GPU's own time a frame with the profiler off (renderer.completedDurations, the
// median of FRAMES — the timestamps cost ~10 ms a frame on Apple), the frame's interval, then the passes' split with the
// profiler on (trace, probes, LUT, reconstruction), and a screenshot.
//   ONLY=earth,miller (bodies), VIEWS=orbit,low,foot,cine, FRAMES=90, OUT=remote-results/planets-baseline
// Duration: ~1 min a view once its kernels are compiled (first ones: several minutes) — ~45–70 min for all on an M1 Max.
// Done when: every view measured, baseline.json and the shots written.

type View = import("./lib/planet-views").View;
const OUT = process.env.OUT ?? "remote-results/planets-baseline";
const FRAMES = Number(process.env.FRAMES ?? 90);
const ONLY = process.env.ONLY?.split(",");
const VIEWS = (process.env.VIEWS?.split(",") ?? ["orbit", "low", "foot", "cine"]) as View[];
const SPOTS = ALL.filter((s) => (!ONLY || ONLY.includes(s.body)) && VIEWS.includes(s.view));

type Cost = {
  /** the GPU's own time a frame [ms], profiler off: median, 90th percentile */
  gpu: number;
  gpu90: number;
  /** the frames' interval [ms] */
  frame: number;
  block: number;
  scale: number;
  raster: boolean;
  /** the raster's shading rate (1 every pixel, 4 one in 2 × 2 …), null traced */
  rate: number | null;
  /** at a fixed quality — the tracer's blocks 4 × 4, the raster's one pixel in 2 × 2 —: the GPU's time [ms] (the game's governors
   *  trade sharpness for time: the same work compared) */
  gpuFixed: number;
  blockFixed: number;
  /** with the profiler on: the compute passes [ms] */
  trace: number;
  probes: number;
  lut: number;
  post: number;
  passes: [string, number][];
};

describe.skipIf(!E2E)("P0: every world's cost and look in the same four views", () => {
  let app: App;
  const out: Record<string, Cost & { body: string; view: View; date: string }> = {};

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({
      width: 1600,
      height: 1000,
      lang: "fr",
      hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`,
      tiles: true,
    });
    await app.js(`(() => { Object.assign(__bh.settings, { showFps: true, autosave: false }); return 1; })()`);
  }, 300_000);

  afterAll(() => {
    writeFileSync(`${OUT}/baseline.json`, JSON.stringify(out, null, 1));
    const f = (x: number) => x.toFixed(1).padStart(6);
    const earth = (v: View) => out[`earth-${v}`]?.gpu;
    const lines = Object.entries(out).map(([k, c]) => {
      const e = earth(c.view);
      const vs = e ? `${((c.gpu / e) * 100).toFixed(0).padStart(4)} % of the Earth` : "";
      const ef = out[`earth-${c.view}`]?.gpuFixed;
      const vf = ef ? ` · fixed ${f(c.gpuFixed)} ${((c.gpuFixed / ef) * 100).toFixed(0).padStart(4)} %` : "";
      return `${k.padEnd(18)} gpu ${f(c.gpu)} (p90 ${f(c.gpu90)})  frame ${f(c.frame)}  trace ${f(c.trace)}  probes ${f(c.probes)}  post ${f(c.post)}  ×${c.block} s${c.scale} ${c.raster ? `raster 1/${c.rate}` : "traced"}  ${vs}${vf}`;
    });
    console.log(`\nP0 baseline (ms)\n${lines.join("\n")}`);
    app?.close();
    stopServer();
  });

  /** the scene's kernels compiled, its tiles and maps in, still for 1.5 s; Gargantua's worlds lit (their light probe in —
   *  renderer.planetProbes, one world every 2 s: until it comes, the world is drawn black — a P0 finding) */
  const settle = (body?: string) =>
    app.js(`(async () => {
      const r = __bh.renderer, frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
      while (!r.kernelsSettled && performance.now() - t0 < 300000) { __bh.touch(); await frame(); }
      while (r.aerialWanted && !r.aerialPipe && performance.now() - t0 < 300000) { __bh.touch(); await frame(); }
      // (the variants queued behind the first image — the raster's, the scenery's — compiled too)
      while ((r.variantQueue?.pending ?? 0) > 0 && performance.now() - t0 < 600000) { __bh.touch(); await frame(); }
      let calm = 0;
      while (performance.now() - t0 < 600000) {
        const ready = r.earthTiles.pending === 0 && !r.hdLoading;
        calm = ready ? calm || performance.now() : 0;
        if (calm && performance.now() - calm > 1500) break;
        __bh.touch(); await frame();
      }
      for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
      while (!r.kernelsSettled && performance.now() - t0 < 600000) { __bh.touch(); await frame(); }
      // (nothing compiling any more — the pill's "the ground's rays (scenery)" and the background's general tracer: a compile
      // shares the machine with the frames measured)
      while ((r.compilesPending > 0 || r.compilingNow.length > 0) && performance.now() - t0 < 900000) { __bh.touch(); await frame(); }
      ${body && ["miller", "mann"].includes(body) ? `while (!r.planetProbes.has(${JSON.stringify(body)}) && performance.now() - t0 < 960000) { __bh.touch(); await frame(); }` : ""}
      for (let i = 0; i < 10; i++) { __bh.touch(); await frame(); }
      return Math.round(performance.now() - t0); })()`);

  const measure = () =>
    app.js<Cost>(`(async () => {
      const r = __bh.renderer, frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
      const med = (a, q = 0.5) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(q * (b.length - 1))] : 0; };
      r.prof.enabled = false;
      for (let i = 0; i < 30; i++) { __bh.touch(); await frame(); }
      // (the GPU's own time between completions, the profiler off; the frames' interval)
      const gpu = [], iv = [];
      let done = r.completedFrames, tl = performance.now(), seen = r.completedDurations.length;
      const t0 = performance.now();
      while (gpu.length < ${FRAMES} && performance.now() - t0 < 40000) {
        __bh.touch(); await frame();
        const now = performance.now();
        if (r.completedFrames !== done) {
          iv.push((now - tl) / (r.completedFrames - done)); done = r.completedFrames; tl = now;
          gpu.push(r.completedDurations[r.completedDurations.length - 1]);
        }
      }
      // (the passes' split, the profiler on)
      r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
      for (let i = 0; i < 6; i++) { __bh.touch(); await frame(); }
      const tr = [], pr = [], lu = [], po = [], all = {};
      let pf = r.prof.frames;
      const t1 = performance.now();
      while (tr.length < 40 && performance.now() - t1 < 30000) {
        __bh.touch(); await frame();
        if (r.prof.frames === pf) continue;
        pf = r.prof.frames;
        const t = r.prof.table(), get = (f) => t.filter(f).reduce((a, p) => a + p.last, 0);
        tr.push(get((p) => p.label === "trace"));
        pr.push(get((p) => p.label.includes("probe")));
        lu.push(get((p) => p.label === "far-field LUT"));
        po.push(get((p) => p.label === "resolve" || p.label === "gather" || p.label === "temporal"));
        for (const p of t) (all[p.label] ??= []).push(p.last);
      }
      r.prof.enabled = false; r.prof.every = 8;
      const passes = Object.entries(all).map(([k, v]) => [k, +med(v).toFixed(2)]).filter((x) => x[1] >= 0.3).sort((a, b) => b[1] - a[1]).slice(0, 12);
      const p = __bh.game.perf({ gpu: false });
      return { gpu: med(gpu), gpu90: med(gpu, 0.9), frame: med(iv.slice(2)), block: r.realtimeBlockNow, scale: +p.renderScale.toFixed(2),
        raster: !!r.rasterPrimaryOn, rate: p.terrainRaster?.rate ?? null, trace: med(tr), probes: med(pr), lut: med(lu), post: med(po), passes };
    })()`);
  /** the GPU's time a frame [ms] (median) and the block, the profiler off */
  const gpuOnly = () =>
    app.js<{ gpu: number; block: number }>(`(async () => {
      const r = __bh.renderer, frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
      r.prof.enabled = false;
      for (let i = 0; i < 30; i++) { __bh.touch(); await frame(); }
      const gpu = []; let done = r.completedFrames; const t0 = performance.now();
      while (gpu.length < ${FRAMES} && performance.now() - t0 < 40000) {
        __bh.touch(); await frame();
        if (r.completedFrames !== done) { done = r.completedFrames; gpu.push(r.completedDurations[r.completedDurations.length - 1]); }
      }
      const b = gpu.sort((x, y) => x - y);
      return { gpu: b[b.length >> 1] ?? 0, block: r.realtimeBlockNow }; })()`);
  /** the image's mean brightness (0…255) over where the world is — the centre from orbit, the lower half else —, from a
   *  small screenshot (the whole image's mean followed the Milky Way behind a dark world) */
  const brightness = async (view: View) => {
    const [x0, y0, x1, y1] = view === "orbit" ? [50, 30, 110, 70] : [0, 55, 160, 100];
    const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 60 });
    return app.js<number>(`(async () => {
      const i = await createImageBitmap(await (await fetch("data:image/jpeg;base64,${data}")).blob());
      const c = new OffscreenCanvas(160, 100), g = c.getContext("2d"); g.drawImage(i, 0, 0, 160, 100);
      const d = g.getImageData(${x0}, ${y0}, ${x1 - x0}, ${y1 - y0}).data; let s = 0; for (let k = 0; k < d.length; k += 4) s += d[k] + d[k + 1] + d[k + 2];
      return s / (d.length / 4) / 3; })()`);
  };

  /** on foot: the walker on the body, on its sunlit side (the brightest of eight longitudes — the Earth: a July morning) */
  const walk = async (body: string, lat: number, lon: number) => {
    const start = (l: number) =>
      app.js(
        `(() => { const e = __bh.camera.character.start(${JSON.stringify(body)}, ${lat}, ${l}); for (let i = 0; i < 30; i++) __bh.step(1 / 60); __bh.touch(); return e; })()`,
      );
    if (body === "earth") {
      await app.js(
        `(() => { __bh.game.setDate("2067-07-01T08:30:00Z"); __bh.game.walk("earth", ${lat}, ${lon}); for (let i = 0; i < 30; i++) __bh.step(1 / 60); return 1; })()`,
      );
      return;
    }
    let best = lon;
    let lum = -1;
    for (let k = 0; k < 8; k++) {
      const l = lon + 45 * k;
      const e = await start(l);
      if (e) throw new Error(`walk ${body}: ${e}`);
      await settle(body);
      const L = await brightness("foot");
      if (L > lum) [lum, best] = [L, l];
      await app.js(`(() => { __bh.camera.character.stop(); return 1; })()`);
    }
    await start(best);
  };

  for (const s of SPOTS)
    test(`${s.body} — ${s.view}`, async () => {
      const id = `${s.body}-${s.view}`;
      if (s.view === "foot") {
        // (from the world's orbit scene: its system loaded)
        const o = SPOTS.find((x) => x.body === s.body && x.view === "orbit")?.set;
        const from = (Array.isArray(o) ? o[0] : o) ?? preset(SHOWCASE[s.body]!);
        await app.js(`(() => { ${from} return 1; })()`);
        await settle(s.body);
        await walk(s.body, s.foot![0], s.foot![1]);
      } else {
        const sets = Array.isArray(s.set) ? s.set : [s.set];
        let best = sets[0]!;
        if (sets.length > 1) {
          let lum = -1;
          for (const set of sets) {
            await app.js(
              `(() => { if (__bh.camera.character.active) __bh.camera.character.stop(); ${set} __bh.settings.animate = false; return 1; })()`,
            );
            await settle(s.body);
            const L = await brightness(s.view);
            if (L > lum) [lum, best] = [L, set];
          }
        }
        await app.js(`(() => { if (__bh.camera.character.active) __bh.camera.character.stop(); ${best} return 1; })()`);
      }
      await app.js(
        `(() => { Object.assign(__bh.settings, { dynamicResolution: false, fpsCap: 0, animate: false, autosave: false, showFps: true }); return 1; })()`,
      );
      const ms = await settle(s.body);
      // (no "craft lost" card over the view: its veil and card were in every view after a crash — measured and shot through)
      const lost = await app.js<string>(`document.querySelector(".craft-lost")?.textContent ?? ""`);
      if (lost) throw new Error(`${id}: the craft was lost — ${lost}`);
      const m = await measure();
      // (the same view at a fixed quality, then the game's again for the shot)
      await app.js(`(() => { Object.assign(__bh.settings, { realtimeSubsampling: 4, earthRasterShading: "quarter" }); return 1; })()`);
      await settle(s.body);
      const fx = await gpuOnly();
      await app.js(`(() => { Object.assign(__bh.settings, { realtimeSubsampling: "auto", earthRasterShading: "auto" }); return 1; })()`);
      await settle(s.body);
      const c: Cost = { ...m, gpuFixed: fx.gpu, blockFixed: fx.block };
      // (the image alone: the interface hidden for the shot — H —, back after)
      await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
      await app.shot(`${OUT}/${id}.png`);
      await app.js(`(() => { document.body.classList.remove("hide-ui"); return 1; })()`);
      const date = await app.js<string>("__bh.game.date()");
      out[id] = { ...c, body: s.body, view: s.view, date };
      writeFileSync(`${OUT}/baseline.json`, JSON.stringify(out, null, 1));
      console.log(
        `  ${id}: gpu ${c.gpu.toFixed(1)} ms (p90 ${c.gpu90.toFixed(1)}), frame ${c.frame.toFixed(1)}, trace ${c.trace.toFixed(1)}, ×${c.block}, scale ${c.scale}, ${c.raster ? `raster 1/${c.rate}` : "traced"}, fixed ${c.gpuFixed.toFixed(1)} ms ×${c.blockFixed}, settled in ${(ms / 1000).toFixed(0)} s, ${date}\n    ${c.passes.map(([l, v]) => `${l} ${v}`).join(" · ")}`,
      );
    }, 1_800_000);
});
