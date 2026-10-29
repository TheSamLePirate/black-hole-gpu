import { afterAll, beforeAll, describe, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

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

type View = "orbit" | "low" | "foot" | "cine";
/** set: the view's setup, or several — the brightest image kept (a world's sunlit side) */
type Spot = { body: string; view: View; set: string | string[]; foot?: [number, number] };

const OUT = process.env.OUT ?? "remote-results/planets-baseline";
const FRAMES = Number(process.env.FRAMES ?? 90);
const ONLY = process.env.ONLY?.split(",");
const VIEWS = (process.env.VIEWS?.split(",") ?? ["orbit", "low", "foot", "cine"]) as View[];

/** a scene made at runtime from a preset of the same kind, its pose replaced */
// (the Ranger kept, as the scenes have it: without it the Earth's surface does not load near the camera, and Miller and Mann
// are drawn black — their light probe in or not: P0 findings; Gargantua's low views from its cockpit, the look level — its
// hull filled them from outside, ahead of a level craft)
const scene = (name: string, base: string, patch: string) =>
  `__bh.presets[${JSON.stringify(name)}] = { ...__bh.presets[${JSON.stringify(base)}], ${patch} }; __bh.game.preset(${JSON.stringify(name)}); ${HOLD}`;
const NUS = [0, 90, 180, 270];
// (the clock held at once, the craft unbreakable: the Ranger 3 km over Mann fell and crashed while a view was chosen, its
// "craft lost" card then over every view after)
const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9 });`;
// (the game's start [M], a day [M]: settings.ts T0, DAY at 10⁸ M☉)
const T0 = 109.6;
const DAY = 86400 / (4.925490947e-6 * 1e8);

// our solid worlds: radius [km] (the orbit's height ~1.2 radii: the whole disc), a ground they walk on
const OURS: [string, number][] = [
  ["moon", 1737],
  ["mars", 3390],
  ["mercury", 2440],
  ["venus", 6052],
  ["io", 1822],
  ["europa", 1561],
  ["titan", 2575],
  ["ceres", 470],
  ["pluto", 1188],
];
const GIANTS = ["jupiter", "saturn", "uranus", "neptune"];
const SHOWCASE: Record<string, string> = {
  // (the Earth at its best: IGN's relief, imagery and buildings — Yosemite, on the global tiles, is far softer)
  earth: "Earth: Saint-Jean-de-Valériscle, the Cévennes",
  moon: "Moon: Earthrise",
  mars: "Mars: the blue sunset",
  mercury: "Mercury: the cratered plains",
  venus: "Venus: above the clouds",
  io: "Io: Jupiter in the sky",
  europa: "Europa: Jupiter over the ice",
  titan: "Titan: the orange haze",
  pluto: "Pluto: the heart",
  jupiter: "Jupiter: from orbit",
  saturn: "Saturn: backlit",
  uranus: "Uranus: from orbit",
  neptune: "Neptune: from orbit",
  miller: "Miller: Gargantua over the sea",
  mann: "Mann: Gargantua over the ice",
  edmunds: "Edmunds: Gargantua at dusk",
};
const preset = (name: string) => `__bh.game.preset(${JSON.stringify(name)}); ${HOLD}`;

const SPOTS = (
  [
    // the Earth first — the budget, and the sound image the rest is judged against (the Alps, its tiles in)
    {
      body: "earth",
      view: "low",
      // (over the Mont Blanc's massif, 3 km up, a July morning — 10:30 UTC, the Sun ~55° up)
      set: scene(
        "P0 earth low",
        "Earth: low orbit over the Amazon",
        `time: ${T0 + 181 * DAY - (4.5 / 24) * DAY}, earthClouds: 0, pose: { at: [45.85, 6.75], altKm: 3, look: "earth", off: [0, 80] }`,
      ),
    },
    {
      body: "earth",
      view: "orbit",
      set: scene(
        "P0 earth orbit",
        "Earth: low orbit over the Amazon",
        `pose: { tilt: 60, body: "earth", altKm: 7600, phase: 40, look: "earth" }`,
      ),
    },
    { body: "earth", view: "foot", set: "", foot: [45.92, 6.87] },
    { body: "earth", view: "cine", set: preset(SHOWCASE.earth!) },
    // Gargantua's worlds
    ...(["miller", "mann", "edmunds"] as const).flatMap((b): Spot[] => [
      // (on an orbit about the world, 25 000 km up, and 3 km over its ground looking at its horizon: four places round
      // it, its sunlit side kept — Gargantua's disk lights it)
      {
        body: b,
        view: "orbit",
        set: NUS.map((nu) =>
          scene(
            `P0 ${b} orbit ${nu}`,
            "Miller: the water world",
            `target: "${b}", pose: { tilt: 60, body: "${b}", altKm: 25000, nu: ${nu} }`,
          ),
        ),
      },
      {
        body: b,
        view: "low",
        set: NUS.map((nu) =>
          scene(
            `P0 ${b} low ${nu}`,
            "Miller: the shallow sea",
            `target: "${b}", fov: 60, shipMount: "cockpit", pose: { body: "${b}", altKm: 3, nu: ${nu}, off: [0, 92] }`,
          ),
        ),
      },
      { body: b, view: "foot", set: "", foot: [0, 0] },
      { body: b, view: "cine", set: preset(SHOWCASE[b]!) },
    ]),
    // the solar system's solid worlds
    ...OURS.flatMap(([b, rKm]): Spot[] => [
      {
        body: b,
        view: "orbit",
        set: scene(
          `P0 ${b} orbit`,
          "Mars: from orbit",
          `target: "${b}", pose: { tilt: 60, body: "${b}", altKm: ${Math.round(1.2 * rKm)}, phase: 40, look: "${b}" }`,
        ),
      },
      {
        body: b,
        view: "low",
        set: scene(
          `P0 ${b} low`,
          "Mars: from orbit",
          `target: "${b}", fov: 60, pose: { body: "${b}", altKm: 3, phase: 50, look: "${b}", off: [0, 80] }`,
        ),
      },
      // (Venus: no walking under its 90 bar — character.start refuses it)
      ...(b === "venus" ? [] : [{ body: b, view: "foot" as View, set: "", foot: [10, 0] as [number, number] }]),
      { body: b, view: "cine", set: preset(SHOWCASE[b]!) },
    ]),
    // the giants: from orbit, and their showcase
    ...GIANTS.flatMap((b): Spot[] => [
      { body: b, view: "orbit", set: preset(`${b[0]!.toUpperCase()}${b.slice(1)}: from orbit`) },
      ...(SHOWCASE[b] !== `${b[0]!.toUpperCase()}${b.slice(1)}: from orbit`
        ? [{ body: b, view: "cine" as View, set: preset(SHOWCASE[b]!) }]
        : []),
    ]),
  ] as Spot[]
).filter((s) => (!ONLY || ONLY.includes(s.body)) && VIEWS.includes(s.view));

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
