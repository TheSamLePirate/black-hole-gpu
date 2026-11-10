import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { intervals, J0_FIXED, J0_SCENE } from "./lib/j0-scene";
import { sceneryReady } from "./lib/plan-views";

// J0 — the reference flight scene measured (docs/J0-CONTRAT.md; strategy §15 J0, §22.4 D2 Toulon-Hyères, D3 25 ms on the M1
// Max; audit 2026-11-10 priorities 1.1 and 1.2). The player's profile as shipped (quality, dynamic resolution, scenery, look:
// the defaults) at a 1920 × 1080 output, the scene's own settings fixed (tests/e2e/lib/j0-scene.ts).
//   (1) the way in, cold (a fresh Chrome profile, its caches empty): the page's first image, the F-35 put over the Rade d'Hyères
//       and its scene kernel compiled (pilotable image), the relief in (useful coverage), the imagery and scenery whole (full
//       detail) — each its seconds since the boot began;
//   (2) the measured flight: J0_SCENE.flightS seconds in real time — the autopilot, the autothrottle, the right turn over the coast
//       at turnAtS —: every animation frame, whether a new image was finished (renderer.completedFrames) and its GPU time; each
//       second the effective quality (render scale, block, shading), the tiles pending, the position; at its end the GPU passes
//       (timestamps) and the main loop's CPU time per iteration (p50/p95/p99); the JS heap and the test Chrome's memory (its
//       processes' resident size, the GPU process's footprint), the machine's thermal state before and after;
//   (4) the same flight again after the ablations ("sustained": the machine as long play leaves it — thermal throttling);
//   (3) the frame split by item, by ablation on finished images: the same start (a snapshot saved after (1)) flown again
//       ABLATE_S seconds with one item taken out — the clouds, the scenery, the water's material, the HUD and the cockpit's
//       screens, the cockpit (the outside view) — between two baseline flights (drift).
// Output: remote-results/j0/<machine>/ (J0_OUT): j0.json, shots (start, mid-turn, end; each ablation's last frame).
// J0_PHASES=flight,ablate,sustained (default all; sustained: the flight again after the ablations, the machine hot), ABLATE_S (20), J0_MACHINE (the label: "m1max", "kerr-mini"; default the host name).
// Not a pass/fail on the frame rate: the fiche is written from j0.json (docs/progress/j0/). It fails on a GPU error, a craft not
// placed, a flight not flown.
// Duration: ~10 min here (cold boot ~1–2 min, two flights of 70 s, 7 ablation flights ~40 s each).
// Done when: the way in timed, both flights measured, every ablation flown, the thermal state of each recorded, j0.json written, no GPU error.

const MACHINE = process.env.J0_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const OUT = process.env.J0_OUT ?? `remote-results/j0/${MACHINE}`;
const PHASES = (process.env.J0_PHASES ?? "flight,ablate,sustained").split(",");
const ABLATE_S = Number(process.env.ABLATE_S ?? 20);
const W = 1920,
  H = 1080;

/** the ablations: what each one takes out (set after the snapshot is loaded) */
const ABLATIONS: Record<string, { label: string; set: string }> = {
  base: { label: "référence", set: "" },
  clouds: { label: "sans nuages", set: `__bh.game.set("earthClouds", 0);` },
  scenery: { label: "sans décor (bâtiments, arbres)", set: `__bh.settings.earthScenery = "off";` },
  water: { label: "sans matériau de l'eau", set: `__bh.renderer.liteSkip = 1;` },
  displays: {
    label: "sans HUD ni écrans d'interface",
    set: `Object.assign(__bh.settings, { hudJet: "off", hudHorizon: false, hudHeading: false, hudBank: false, hudMarkers: false,
      hudEdge: false, hudAoA: false, hudEnergy: false, hudDirector: false, hudPath: false, hudFuture: false, hudImpact: false, hudRunway: false });
      document.body.classList.add("hide-ui");`,
  },
  // (the craft not drawn — renderer.debugSkipShip: its draw skipped; the cockpit mask stays, so the image keeps an older
  // frame's cockpit there and the ground under it is still not shaded — the draw's cost, not the area's —, then only its shadow map: the timestamps put
  // "ship: shading (MSAA)" and "ship: shadow map" at 18–23 ms in the first run, but render passes overlap on Apple — GP-09)
  ship: { label: "sans dessin de l'appareil (debugSkipShip ; son masque reste)", set: `__bh.renderer.debugSkipShip = true;` },
  shipShadow: { label: "sans carte d'ombre de l'appareil", set: `__bh.renderer.ship.debugSkip.add("shadow");` },
};
const ORDER = ["base", "clouds", "scenery", "water", "displays", "ship", "shipShadow", "base"];

const out: Record<string, unknown> = {
  scene: J0_SCENE,
  machine: MACHINE,
  output: `${W}×${H}`,
  startedAt: new Date().toISOString(),
};

/** the test Chrome's memory: its processes' resident size [MB] and the GPU process's physical footprint [MB] (macOS) */
async function chromeMemory() {
  const ps = await $`ps -axo pid=,rss=,command=`.quiet().nothrow().text();
  let rss = 0,
    gpuPid = 0;
  for (const l of ps.split("\n")) {
    if (!l.includes("kerr-e2e-")) continue;
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (!m) continue;
    rss += Number(m[2]) / 1024;
    if (m[3]!.includes("--type=gpu-process")) gpuPid = Number(m[1]);
  }
  let gpuFootprint: number | null = null;
  if (gpuPid && process.platform === "darwin") {
    const f = await $`footprint ${gpuPid}`.quiet().nothrow().text();
    const m = /phys_footprint:\s*([\d.]+)\s*([KMG])B/.exec(f) ?? /Footprint:\s*([\d.]+)\s*([KMG])B/.exec(f);
    if (m) gpuFootprint = Number(m[1]) * ({ K: 1 / 1024, M: 1, G: 1024 }[m[2] as "K" | "M" | "G"] ?? 1);
  }
  return { chromeRssMB: Math.round(rss), gpuFootprintMB: gpuFootprint === null ? null : Math.round(gpuFootprint) };
}
async function thermal() {
  const r = await $`bun scripts/thermal.ts status --json`.quiet().nothrow();
  try {
    return JSON.parse(r.stdout.toString());
  } catch {
    return { unavailable: r.stdout.toString().trim() || r.stderr.toString().trim() };
  }
}

/** a flight's frames, in the page: every rAF — new image or not —, each second a sample; `turn` at turnAtS (or never) */
const flyJs = (seconds: number, turn: boolean) => `(async () => {
  const r = __bh.renderer, c = __bh.camera, F = __bh.fleet, frame = () => new Promise((q) => requestAnimationFrame(q));
  r.prof.enabled = true; r.prof.every = 4; r.prof.reset();
  const t0 = performance.now(), frames = [], samples = []; let last = r.completedFrames ?? 0, nextSample = 0, turned = false;
  const heap0 = performance.memory?.usedJSHeapSize ?? 0;
  while (true) {
    const t = await frame(); const el = (t - t0) / 1000; if (el > ${seconds}) break;
    const done = r.completedFrames ?? 0;
    if (done !== last) { frames.push([+(t - t0).toFixed(2), done - last, +(r.lastGpuMs ?? 0).toFixed(2)]); last = done; }
    if (${turn} && !turned && el >= ${J0_SCENE.turnAtS}) { c.jetModes.hdg = ${J0_SCENE.turnTo} * Math.PI / 180; turned = true; }
    if (el >= nextSample) {
      nextSample += 1;
      const g = c.geoNow(), p = __bh.game.perf({ gpu: false }), pose = F.pose(F.active, __bh.sim.time);
      samples.push({ t: +el.toFixed(2), lat: +(g?.lat ?? 0).toFixed(5), lon: +(g?.lon ?? 0).toFixed(5), alt: Math.round(g?.alt ?? 0),
        agl: Math.round(__bh.sys.heightOverGround("earth", pose.X, __bh.sim.time)), hdg: Math.round(((g?.track ?? 0) * 180 / Math.PI + 360) % 360),
        gs: Math.round(g?.gs ?? 0), scale: p.renderScale, block: p.block, quality: p.quality, tilesPending: r.earthTiles.pending,
        orthoPending: r.earthTiles.orthoPending, compiling: r.compilesPending, heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576) });
    }
  }
  const perf = __bh.game.perf({ gpu: false });
  const passes = r.prof.table().map((x) => ({ pass: x.label, ms: +x.ms.toFixed(3), n: x.n }));
  return { frames, samples, passes, loopCpu: perf.loopCpu, cpu: perf.cpu, image: perf.image, pixelRatio: perf.pixelRatio, tier: perf.tier,
    budgetMs: perf.budgetMs, gpuErrors: r.gpuErrors, heap0MB: Math.round(heap0 / 1048576), flightFailure: c.airFlight?.failure ?? null,
    end: { lat: c.geoNow()?.lat, lon: c.geoNow()?.lon, hdg: ((c.geoNow()?.track ?? 0) * 180 / Math.PI + 360) % 360 } }; })()`;

type Flown = {
  frames: [number, number, number][];
  samples: Record<string, number>[];
  passes: { pass: string; ms: number }[];
  loopCpu: { n: number; p50: number; p95: number; p99: number; max: number };
  gpuErrors: number;
  flightFailure: string | null;
  image: string;
  [k: string]: unknown;
};

describe.skipIf(!E2E)("J0: the reference flight over Toulon-Hyères", () => {
  let app: App;
  let save = "";
  let hud = "{}";
  const tBoot = performance.now();
  const since = () => +((performance.now() - tBoot) / 1000).toFixed(1);

  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    out.thermalBefore = await thermal();
    // (1) the way in, cold: a fresh profile — Chrome's shader and HTTP caches empty
    app = await App.boot({ width: W, height: H, lang: "fr", hash: "scene=game:artemis", tiles: true });
    const way: Record<string, number> = { firstImage: since() };
    await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
    // (the HUD's settings as the profile ships them: the "displays" ablation turns them off, each start puts them back —
    // the first runs left them off for every flight after it)
    hud = await app.js<string>(`JSON.stringify(Object.fromEntries(Object.entries(__bh.settings).filter(([k]) => /^hud/.test(k))))`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
    way.craft = since();
    const [lat, lon, agl, hdg, spd] = J0_SCENE.start;
    const place = `__bh.game.setDate("${J0_SCENE.date}"); __bh.game.set("weather", "${J0_SCENE.weather}"); __bh.game.set("earthClouds", ${J0_SCENE.earthClouds});
      __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${spd}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
    await app.js(`(() => { __bh.freeze(false); ${place} __bh.freeze(true); return 1; })()`);
    await app.settled(180_000);
    way.pilotableImage = since();
    // (the relief in: none pending for 3 s, a z 12 level at least — pending reads 0 just after a jump)
    const relief = await app.js<{ ok: boolean; finest: number; pending: number }>(`(async () => {
      const t = __bh.renderer.earthTiles, frame = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < 90000) {
        const ok = t.pending === 0 && t.finest >= 12; calm = ok ? calm || performance.now() : 0;
        if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
      return { ok: calm > 0, finest: t.finest, pending: t.pending }; })()`);
    way.reliefIn = since() - 3;
    if (!relief.ok) console.log(`  J0: the relief not in after 90 s (finest z ${relief.finest}, ${relief.pending} pending) — going on`);
    // (placed again on the relief now in, then everything whole: imagery, scenery, kernels)
    await app.js(`(() => { __bh.freeze(false); ${place} __bh.freeze(true); return 1; })()`);
    await app.dataSettled("J0 Toulon-Hyères");
    const sc = await sceneryReady(app, 60_000);
    if (!sc.ready) console.log(`  J0: the scenery not whole after 60 s (${sc.status})`);
    way.fullDetail = since();
    out.wayIn = {
      ...way,
      relief,
      scenery: sc.ready,
      note: "seconds since App.boot began; boot on game:artemis then the craft placed (not the title's path)",
    };
    console.log(`  J0 way in: ${JSON.stringify(out.wayIn)}`);
    save = await app.js<string>(
      `(() => { __bh.freeze(false); ${place} __bh.freeze(true); return JSON.stringify(__bh.game.snapshot("J0 Toulon-Hyères")); })()`,
    );
    out.settings = await app.js(`(() => { const s = __bh.settings; return { quality: s.quality, dynamicResolution: s.dynamicResolution,
      earthPipeline: s.earthPipeline, earthScenery: s.earthScenery, earthSurface: s.earthSurface, detailReach: s.detailReach,
      lookProfile: s.lookProfile, realtimeSubsampling: s.realtimeSubsampling, earthRasterShading: s.earthRasterShading, fpsCap: s.fpsCap,
      motionBlur: s.motionBlur, dof: s.dof }; })()`);
    out.adapter = await app.js(`__bh.game.perf({ gpu: false }).graphics`);
    out.userAgent = await app.js(`navigator.userAgent`);
  }, 600_000);

  afterAll(async () => {
    out.thermalAfter = await thermal();
    out.finishedAt = new Date().toISOString();
    await Bun.write(`${OUT}/j0.json`, JSON.stringify(out, null, 1));
    console.log(`  J0: ${OUT}/j0.json`);
    await app?.close();
    stopServer();
  });

  /** the snapshot loaded and the item taken out with the clock stopped; everything in for that view — kernels, relief, imagery,
   * scenery: a jump back to the start reloads them, and the first ablations of the first run measured that reload (10 images/s)
   * —; then the clock running, the autopilot and autothrottle engaged until they hold, gear down; 3 s settling */
  async function start(set: string) {
    await app.js(`(() => { __bh.freeze(false); __bh.game.importSave(${JSON.stringify(save)}, false); __bh.freeze(true); __bh.renderer.liteSkip = 0; __bh.renderer.debugSkipShip = false; __bh.renderer.ship.debugSkip.clear();
      document.body.classList.remove("hide-ui"); Object.assign(__bh.settings, ${J0_FIXED}, ${hud}); __bh.settings.shipMount = "cockpit"; __bh.refresh();
      __bh.camera.viewReset(); ${set} return 1; })()`);
    await app.settled(120_000);
    await app.dataSettled("J0: the start's data after the snapshot", { maxMs: 120_000 });
    const sc = await sceneryReady(app, 60_000);
    if (!sc.ready && !set.includes("earthScenery")) console.log(`  J0: the scenery not whole at the start (${sc.status})`);
    await app.js(`(() => { __bh.freeze(false); return 1; })()`);
    const ap = await app.js<{ ap: boolean; athr: boolean; note: string }>(`(async () => {
      const c = __bh.camera, frame = () => new Promise((q) => requestAnimationFrame(q)); let note = "";
      for (let i = 0; i < 90; i++) { await frame();
        __bh.settings.autoGear = false; c.gearDown = true; c.gearExt = 1; c.gearInit = true;
        if (c.jetModes.alt === null) note = c.jetToggle("ap") ?? note;
        if (c.jetModes.spd === null) note = c.jetToggle("athr") ?? note;
        if (c.jetModes.alt !== null && c.jetModes.spd !== null && i >= 10) break; }
      const g = c.geoNow(); if (g && c.jetModes.alt !== null) { c.jetModes.alt = g.alt; c.jetModes.hdg = ${J0_SCENE.start[3]} * Math.PI / 180; }
      c.jetModes.spd = ${J0_SCENE.start[4]};
      return { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null, note: String(note) }; })()`);
    if (!ap.ap || !ap.athr) throw new Error(`J0: the autopilot ${ap.ap} / autothrottle ${ap.athr} not engaged — ${ap.note}`);
    await app.js(`new Promise((q) => setTimeout(() => q(1), 3000))`);
  }

  /** the measured flight, `tag` "flight" (first, the machine as the boot left it) or "sustained" (last, after the ablations: the
   * machine as long play leaves it — on the M1 Max the GPU throttled to 30 % of its clock within 2.5 min, 10 Nov) */
  async function measureFlight(tag: "flight" | "sustained") {
    await start("");
    const memoryBefore = await chromeMemory();
    const thermal0 = await thermal();
    await app.shot(`${OUT}/${tag}-start.png`);
    // (the flight in two calls: up to mid-turn, a shot, then the rest — the shot's own frame in neither half's stats)
    const half = J0_SCENE.turnAtS + 15;
    const a = await app.js<Flown>(flyJs(half, true));
    await app.cdp
      .send("Page.captureScreenshot", { format: "png" })
      .then((s) => Bun.write(`${OUT}/${tag}-turn.png`, Buffer.from((s as { data: string }).data, "base64")));
    const thermalMid = await thermal();
    const b = await app.js<Flown>(flyJs(J0_SCENE.flightS - half, false));
    await app.cdp
      .send("Page.captureScreenshot", { format: "png" })
      .then((s) => Bun.write(`${OUT}/${tag}-end.png`, Buffer.from((s as { data: string }).data, "base64")));
    const offset = half * 1000;
    const frames = [...a.frames, ...b.frames.map((f) => [f[0] + offset, f[1], f[2]] as [number, number, number])];
    out[tag] = {
      stats: { all: intervals(frames), firstHalf: intervals(a.frames), secondHalf: intervals(b.frames) },
      thermal: { start: thermal0, mid: thermalMid, end: await thermal() },
      memory: { before: memoryBefore, after: await chromeMemory() },
      frames,
      samples: [...a.samples, ...b.samples.map((s) => ({ ...s, t: +(Number(s.t) + half).toFixed(2) }))],
      passes: b.passes,
      passesFirstHalf: a.passes,
      loopCpu: b.loopCpu,
      cpu: b.cpu,
      image: b.image,
      tier: b.tier,
      budgetMs: b.budgetMs,
      pixelRatio: b.pixelRatio,
      end: b.end,
      failure: a.flightFailure ?? b.flightFailure,
    };
    console.log(`  J0 ${tag}: ${JSON.stringify((out[tag] as { stats: unknown }).stats)} — GPU ${thermal0.gpuMHz}→${thermalMid.gpuMHz} MHz`);
    expect(a.gpuErrors + b.gpuErrors).toBe(0);
    expect(a.flightFailure ?? b.flightFailure).toBeNull();
    expect(frames.length).toBeGreaterThan(J0_SCENE.flightS * 5);
  }

  test.skipIf(!PHASES.includes("flight"))("the measured flight: the coast, the turn", () => measureFlight("flight"), 300_000);

  test.skipIf(!PHASES.includes("ablate"))(
    "the frame split by item: ablations on finished images",
    async () => {
      const rows: Record<string, unknown>[] = [];
      for (const [i, key] of ORDER.entries()) {
        const ab = ABLATIONS[key]!;
        await start(ab.set);
        const th0 = await thermal();
        const f = await app.js<Flown>(flyJs(ABLATE_S, false));
        const th1 = await thermal();
        await app.cdp
          .send("Page.captureScreenshot", { format: "png" })
          .then((s) => Bun.write(`${OUT}/ablate-${i}-${key}.png`, Buffer.from((s as { data: string }).data, "base64")));
        const row = {
          key,
          label: ab.label,
          ...intervals(f.frames),
          loopCpuP95: f.loopCpu?.p95,
          gpuMHz: [th0.gpuMHz ?? null, th1.gpuMHz ?? null],
          pressure: [th0.pressure ?? null, th1.pressure ?? null],
          compilingSeen: Math.max(0, ...f.samples.map((x) => Number(x.compiling) || 0)),
          tilesPendingMax: Math.max(0, ...f.samples.map((x) => Number(x.tilesPending) || 0)),
          top: f.passes.slice(0, 10),
          gpuErrors: f.gpuErrors,
        };
        rows.push(row);
        console.log(`  J0 ablation ${key}: ${JSON.stringify({ ...row, top: undefined })}`);
        expect(f.gpuErrors).toBe(0);
      }
      out.ablations = rows;
    },
    600_000,
  );

  test.skipIf(!PHASES.includes("sustained"))(
    "the same flight again, the machine as long play leaves it",
    () => measureFlight("sustained"),
    300_000,
  );
});
