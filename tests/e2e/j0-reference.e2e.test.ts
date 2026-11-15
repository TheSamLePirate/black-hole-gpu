import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { type CdpProfile, longRuns } from "./lib/cpu-profile";
import { intervals, J0_FIXED as J0_FIXED_BASE, J0_SCENE as J0_SCENE_BASE } from "./lib/j0-scene";

// (J0_FPSCAP: the frame rate bounded — settings.fpsCap, whole refreshes of the display — for the palier's judgement « borné et soutenu »,
// Sam's decision of 13 Nov 2026, J0-CONTRAT §2; 0 or unset: as the profile has it)
// (J0_START=lat,lon,agl,hdg,speed: the same flight from elsewhere — NOT the J0 contract's scene: an A/B where J0's view misses what
// is measured — a land view for the water's tiles, 13 Nov 2026 —; its results said apart, never a fiche's)
const J0_SCENE = process.env.J0_START
  ? { ...J0_SCENE_BASE, id: `${J0_SCENE_BASE.id}+start`, start: process.env.J0_START.split(",").map(Number) as typeof J0_SCENE_BASE.start }
  : J0_SCENE_BASE;
const J0_FIXED = process.env.J0_FPSCAP ? J0_FIXED_BASE.replace(/\}\s*$/, `, fpsCap: ${Number(process.env.J0_FPSCAP)} }`) : J0_FIXED_BASE;
import { readPng, writePng } from "./lib/png";
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
// J0_WEATHER=storm (PLAN-J4 J4-0: the heavy profile — the same scene under a storm, its own id; J0_CLOUDS its cover, 0.9 by default).
// Other phases, asked by name: agecheck, framing (PLAN-J3 J3-0), keylight, keyair, keysky, skyband4, coherence (J3-1), keyhaze (J3-2), waterincident (J3-7), shadows (J3-3), wetbld, cityview, materials (J3-5), seadusk, probedump, tracedview (PROBLEMES), twilightdim (J3-1), nightfloor (J3 question 7), nightbands (PROBLEMES), craftshade (J3 question 3), cloudlag (J4-1) (J3-1: the craft's key light against the incident Sun toward
// sunset, ~3 min on kerr-mini; keyair: its air two ways, march and table, ~4 min; keysky: the sky's light two ways, ~4 min; coherence: the three gaps in one read per hour, ~5 min).
// Not a pass/fail on the frame rate: the fiche is written from j0.json (docs/progress/j0/). It fails on a GPU error, a craft not
// placed, a flight not flown.
// Duration: ~10 min here (cold boot ~1–2 min, two flights of 70 s, 7 ablation flights ~40 s each).
// Done when: the way in timed, both flights measured, every ablation flown, the thermal state of each recorded, j0.json written, no GPU error.

const MACHINE = process.env.J0_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
// (an A/B's run — scripts/ab-e2e.ts: AB_RUN, AB_SIDE — its own directory, the four runs side by side)
const OUT =
  process.env.J0_OUT ??
  (process.env.AB_RUN
    ? `remote-results/j0/${MACHINE}-ab${process.env.AB_RUN}${process.env.AB_SIDE ?? ""}`
    : `remote-results/j0/${MACHINE}`);
const PHASES = (process.env.J0_PHASES ?? "flight,ablate,sustained").split(",");
const ABLATE_S = Number(process.env.ABLATE_S ?? 20);
const W = 1920,
  H = 1080;

/** the ablations: what each one takes out (set after the snapshot is loaded) */
const ABLATIONS: Record<string, { label: string; set: string }> = {
  base: { label: "référence", set: "" },
  clouds: { label: "sans nuages", set: `__bh.game.set("earthClouds", 0);` },
  scenery: { label: "sans décor (bâtiments, arbres)", set: `__bh.settings.earthScenery = "off";` },
  // (liteSkip 1: the water's material — valid since 13 Nov 2026, the word's bits carried by bitcast; before, lost under bit 26)
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
  // (PLAN-J2's levers — singleHistory, edgeFoot, earthRateOne — measured here, their old paths retired with them, lot R1, 13 Nov 2026)
  // (the sea's parts — PLAN-MER-WEBGPU —: J0_ORDER=base,seaSurface,seaFft,seaProbe,seaFoam,base to run them)
  seaSurface: { label: "mer plate (sans surface déplacée)", set: `__bh.renderer.seaSurfaceOn = false;` },
  seaFft: { label: "sans vagues FFT", set: `__bh.settings.seaFft = false; __bh.touch();` },
  seaProbe: { label: "sans sonde au-dessus de la mer", set: `__bh.renderer.seaProbeOn = false;` },
  seaFoam: { label: "sans écume en carte du monde", set: `__bh.renderer.seaFoamWorldOn = false;` },
  // (the staged water's E2 ceiling — PLAN-MER-WEBGPU §6, method rule 1 —: the sea's reflections compiled out of the water's kernels —
  // the world's mirror (seaSSR, TUNE_GSKIP 4096) and the far clouds mirrored (16384) —, their code's presence and work: what moving
  // them to their own kernel can return at most; the kernels compiled again for it)
  // (the traced pipeline for the near Earth instead of the raster — the cost of the raster's fallback, dormant on the Earth since J2-7:
  // PROBLEMES-A-REGLER, 13 Nov 2026 — its kernel compiled before the flight)
  traced: { label: "pipeline tracé au lieu du raster", set: `__bh.game.set("earthPipeline", "trace");` },
  seaRefl: { label: "sans reflets de la mer (SSR, nuages reflétés : compilés hors)", set: `__bh.renderer.tune = { TUNE_GSKIP: 20480 };` },
  // (PLAN-J3 J3-2: the craft seen through the air of its distance — ship.wgsl shipAir, two reads of the aerial table a craft pixel —: its cost)
  shipAir: { label: "sans l'air sur l'appareil (J3-2)", set: `__bh.renderer.shipAirAllowed = false;` },
  // (the output's own effects — the ≈ 10 ms the 13 Nov fiche left unattributed on kerr-mini, the display among them —: the bloom (its
  // levels and their composite), the sharpening after the temporal pass, the jet's heat haze; J0_ORDER=base,bloom,sharpen,haze,base)
  bloom: { label: "sans bloom", set: `__bh.settings.bloom = 0;` },
  sharpen: { label: "sans accentuation (RCAS)", set: `__bh.settings.sharpen = 0;` },
  haze: { label: "sans brume de chaleur", set: `__bh.settings.heatHaze = false;` },
  // (PLAN-J4 J4-0 — the weather's own share, under J0_WEATHER=storm: « sans nuages » sets earthClouds 0, the weather's layers — wxCloud,
  // the rain, the lightning — stay (storm: clouds (half) 16.5 ms, the ablation −0.6 ms, 15 Nov 2026); the weather back to fair, the cover kept)
  weather: { label: "météo beau temps (la couverture gardée)", set: `__bh.game.set("weather", "fair");` },
  // (PLAN-J4 J4-2's split of the clouds' pass — its light: the sunward march (TUNE_CLOUD_LIGHT 0: the layer's column instead), its steps
  // (CLOUD_NEAR_N 4 for 6 — Q5 C6: a storm's light +14 levels off with 4) —, recompiles, measures only)
  cloudLight: { label: "nuages sans marche vers le Soleil (colonne)", set: `__bh.renderer.tune = { TUNE_CLOUD_LIGHT: 0 };` },
  cloudNear4: { label: "marche vers le Soleil en 4 pas (6)", set: `__bh.renderer.tune = { CLOUD_NEAR_N: 4 };` },
  cloudNear1: { label: "marche vers le Soleil en 1 pas (6)", set: `__bh.renderer.tune = { CLOUD_NEAR_N: 1 };` },
  // (J4-2: the light volume's read skipped — TUNE_GSKIP 4194304: the near march to 3.8 km instead —: what the volume saves, +4.9 ms
  // under a storm without it, 15 Nov 2026; its frame made once a thread instead of at each sample was tried and dropped — ~2 ms slower,
  // the registers it held over the loop)
  clvSkip: { label: "volume de lumière non lu (la marche à sa place)", set: `__bh.renderer.tune = { TUNE_GSKIP: 4194304 };` },
  // (J4-4's ceiling on J0 — the coastal swell, PLAN-MER-WEBGPU L1–L3 —: its reading compiled out of every kernel (TUNE_SWELL 0 — the
  // water's crests, surf and wash, the shore's wet sand), its presence and its work: what a pass of its own could return at most —
  // −0.8 ms on J0, 15 Nov 2026; the pass tried, −0.4 / 0 ms on the coast's views: not kept, PLAN-J4)
  swell: { label: "sans houle côtière (lecture compilée hors)", set: `__bh.renderer.tune = { TUNE_SWELL: 0 };` },
  // (J4-5's ceiling — the far vegetation —: the scenery's reach cut to "balanced" (3–4 km for 4.5–6), the far ring's trees and buildings out)
  sceneryNear: { label: "décor à portée « balanced » (3–4 km)", set: `__bh.settings.earthScenery = "balanced";` },
};
// (13 Nov 2026, Sam's decision 1: the water's two ablations in every fiche — its material, valid since liteSkip's bits are carried by
// bitcast, and the sea's surface, the largest render pass, no owner measured before)
const ORDER = (process.env.J0_ORDER ?? "base,clouds,scenery,water,seaSurface,displays,ship,shipShadow,base").split(",");

/** PLAN-J3 J3-0 — the instruments' age over a flight's images [ms]: p50, p95, max (−1 — never uploaded — left out) */
function ageStats(ages: number[]) {
  const v = ages.filter((x) => x >= 0).sort((a, b) => a - b);
  const q = (p: number) => +(v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0).toFixed(1);
  return { n: v.length, never: ages.length - v.length, p50: q(0.5), p95: q(0.95), max: +(v[v.length - 1] ?? 0).toFixed(1) };
}

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
  const t0 = performance.now(), frames = [], samples = [], ages = []; let last = r.completedFrames ?? 0, nextSample = 0, turned = false;
  const heap0 = performance.memory?.usedJSHeapSize ?? 0;
  while (true) {
    const t = await frame(); const el = (t - t0) / 1000; if (el > ${seconds}) break;
    const done = r.completedFrames ?? 0;
    if (done !== last) { frames.push([+(t - t0).toFixed(2), done - last, +(r.lastGpuMs ?? 0).toFixed(2)]); last = done;
      // (PLAN-J3 J3-0: the craft's display's age at this image — the F-35's panoramic display since its last upload [ms])
      const ag = r.ship?.displayAges?.(t).jet; ages.push(ag == null ? -1 : +ag.toFixed(1)); }
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
  return { frames, samples, ages, passes, loopCpu: perf.loopCpu, cpu: perf.cpu, image: perf.image, pixelRatio: perf.pixelRatio, tier: perf.tier,
    budgetMs: perf.budgetMs, gpuErrors: r.gpuErrors, heap0MB: Math.round(heap0 / 1048576), flightFailure: c.airFlight?.failure ?? null,
    end: { lat: c.geoNow()?.lat, lon: c.geoNow()?.lon, hdg: ((c.geoNow()?.track ?? 0) * 180 / Math.PI + 360) % 360 } }; })()`;

type Flown = {
  frames: [number, number, number][];
  ages: number[];
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
    // (every wait on its progress, said every 10 s, failing after 60 s without any — Sam's rule, no silent wait of minutes)
    await app.settled(60_000);
    way.pilotableImage = since();
    // (the relief in: none pending for 3 s, a z 12 level at least — pending reads 0 just after a jump; 60 s at most, by 10 s
    // steps each said)
    let relief = { ok: false, finest: 0, pending: 0 };
    for (let step = 0; step < 6 && !relief.ok; step++) {
      relief = await app.js<{ ok: boolean; finest: number; pending: number }>(`(async () => {
        const t = __bh.renderer.earthTiles, frame = () => new Promise((q) => requestAnimationFrame(q));
        const t0 = performance.now(); let calm = 0;
        while (performance.now() - t0 < 10000) {
          const ok = t.pending === 0 && t.finest >= 12; calm = ok ? calm || performance.now() : 0;
          if (calm && performance.now() - calm > 3000) return { ok: true, finest: t.finest, pending: t.pending }; __bh.touch(); await frame(); }
        return { ok: false, finest: t.finest, pending: t.pending }; })()`);
      if (!relief.ok) console.log(`  … J0: the relief, ${(step + 1) * 10} s — finest z ${relief.finest}, ${relief.pending} pending`);
    }
    way.reliefIn = since() - 3;
    if (!relief.ok) console.log(`  J0: the relief not in after 60 s (finest z ${relief.finest}, ${relief.pending} pending) — going on`);
    // (placed again on the relief now in, then everything whole: imagery, scenery, kernels)
    await app.js(`(() => { __bh.freeze(false); ${place} __bh.freeze(true); return 1; })()`);
    await app.dataSettled("J0 Toulon-Hyères", { stallMs: 60_000, compileStallMs: 60_000, maxMs: 240_000 });
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
  }, 420_000);

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
    await app.js(`(() => { __bh.freeze(false); __bh.game.importSave(${JSON.stringify(save)}, false); __bh.freeze(true); __bh.renderer.liteSkip = 0; __bh.renderer.tune = {}; if (__bh.settings.earthPipeline !== "raster") __bh.game.set("earthPipeline", "raster"); __bh.renderer.debugSkipShip = false; __bh.renderer.ship.debugSkip.clear(); __bh.renderer.shipAirAllowed = true;
      Object.assign(__bh.renderer, { seaSurfaceOn: true, seaProbeOn: true, seaFoamWorldOn: true }); __bh.settings.seaFft = true;
      document.body.classList.remove("hide-ui"); Object.assign(__bh.settings, ${J0_FIXED}, ${hud}); __bh.settings.shipMount = "cockpit"; __bh.refresh();
      __bh.camera.viewReset(); ${set} return 1; })()`);
    await app.settled(60_000);
    await app.dataSettled("J0: the start's data after the snapshot", { stallMs: 60_000, compileStallMs: 60_000, maxMs: 120_000 });
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
    // (J0_CPU_PROFILE=1: Chrome's CPU profile over the second half — the main loop's long iterations, ≥ 4 ms of script in a row, and the
    // functions they were spent in (lib/cpu-profile.ts): what makes the loop's 95th percentile — 8.5 ms on kerr-mini for 4 aimed at)
    const cpuProfile = process.env.J0_CPU_PROFILE === "1" && tag === "flight";
    // (J0_RING_OLD=1: the raster's rings rebuilt at every window step, as before 14 Nov 2026 — terrainRaster.ringReuse false: the A/B)
    if (process.env.J0_RING_OLD === "1") await app.js(`(() => { __bh.renderer.terrainRaster.ringReuse = false; return 1; })()`);
    if (cpuProfile) {
      await app.cdp.send("Profiler.enable");
      await app.cdp.send("Profiler.setSamplingInterval", { interval: 200 });
      await app.cdp.send("Profiler.start");
    }
    // (J0_ALLOC_PROFILE=1: the allocations over the second half, sampled (CDP HeapProfiler, one sample every 64 KB allocated): who feeds the
    // collector — its pauses of 11–20 ms seen in the CPU profile, 14 Nov 2026 — by allocating function, its bytes a second)
    const allocProfile = process.env.J0_ALLOC_PROFILE === "1" && tag === "flight";
    if (allocProfile) {
      await app.cdp.send("HeapProfiler.enable");
      // (the collected objects counted too — by default only those still alive at the stop)
      await app.cdp.send("HeapProfiler.startSampling", {
        samplingInterval: 65536,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
    }
    // (J0_HUD_CLONE=1: what of the HUD's frame data a structuredClone would refuse, over the second half — hud/clone-probe.ts: the list to
    // make clonable before drawing the HUD in a worker)
    const hudClone = process.env.J0_HUD_CLONE === "1" && tag === "flight";
    if (hudClone) await app.js(`(() => { globalThis.__hudCloneProbe = new Set(); return 1; })()`);
    const tAlloc = Date.now();
    const b = await app.js<Flown>(flyJs(J0_SCENE.flightS - half, false));
    if (allocProfile) {
      type HNode = {
        callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
        selfSize: number;
        children: HNode[];
      };
      const { profile } = await app.cdp.send<{ profile: { head: HNode } }>("HeapProfiler.stopSampling", {}, 60);
      const secs = (Date.now() - tAlloc) / 1000;
      const by = new Map<string, number>();
      const walk = (n: HNode, path: string[]) => {
        const f = `${n.callFrame.functionName || "(anonymous)"}:${n.callFrame.lineNumber + 1}:${n.callFrame.columnNumber + 1}`;
        const p2 = [...path, f];
        if (n.selfSize > 0) {
          const key = p2.slice(-3).join(" < ");
          by.set(key, (by.get(key) ?? 0) + n.selfSize);
        }
        for (const c of n.children) walk(c, p2);
      };
      walk(profile.head, []);
      const total = [...by.values()].reduce((a, x) => a + x, 0);
      console.log(
        `  J0 allocations (sampled), ${(total / secs / 1e6).toFixed(1)} MB/s over ${secs.toFixed(0)} s; the heaviest (MB/s, the last three frames):`,
      );
      for (const [k, v] of [...by].sort((x, y) => y[1] - x[1]).slice(0, 25))
        console.log(`    ${(v / secs / 1e6).toFixed(2).padStart(6)}  ${k}`);
      await Bun.write(`${OUT}/flight-second-half.heapprofile`, JSON.stringify(profile));
    }
    if (hudClone) {
      const paths = await app.js<string[]>(
        `(() => { const p = [...globalThis.__hudCloneProbe].sort(); delete globalThis.__hudCloneProbe; return p; })()`,
      );
      out.hudUnclonable = paths;
      console.log(`  J0 the HUD's frame data a structuredClone would refuse (${paths.length}):`);
      for (const p of paths) console.log(`    ${p}`);
    }
    console.log(`  J0 the raster's rings since the start: ${JSON.stringify(await app.js(`__bh.renderer.terrainRasterStats.ringBuilds`))}`);
    if (cpuProfile) {
      const { profile: pr } = await app.cdp.send<{ profile: CdpProfile }>("Profiler.stop", {}, 60);
      await Bun.write(`${OUT}/flight-second-half.cpuprofile`, JSON.stringify(pr));
      const lr = longRuns(pr, 4, 30);
      out.cpuLongRuns = lr;
      console.log(`  J0 CPU, the loop's long runs (≥ 4 ms of script): ${lr.runs} runs, ${lr.totalMs} ms, longest ${lr.longest.join(" ")}`);
      for (const x of lr.fns) console.log(`    ${String(x.inclMs).padStart(7)} incl ${String(x.selfMs).padStart(6)} self  ${x.f}`);
    }
    await app.cdp
      .send("Page.captureScreenshot", { format: "png" })
      .then((s) => Bun.write(`${OUT}/${tag}-end.png`, Buffer.from((s as { data: string }).data, "base64")));
    const offset = half * 1000;
    const frames = [...a.frames, ...b.frames.map((f) => [f[0] + offset, f[1], f[2]] as [number, number, number])];
    out[tag] = {
      stats: { all: intervals(frames), firstHalf: intervals(a.frames), secondHalf: intervals(b.frames) },
      instrumentAge: ageStats([...a.ages, ...b.ages]),
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
    console.log(`  J0 ${tag} instruments' age: ${JSON.stringify((out[tag] as { instrumentAge: unknown }).instrumentAge)}`);
    expect(a.gpuErrors + b.gpuErrors).toBe(0);
    expect(a.flightFailure ?? b.flightFailure).toBeNull();
    expect(frames.length).toBeGreaterThan(J0_SCENE.flightS * 5);
    // (PLAN-J3 J3-4 — the instruments' age bounded, provisionally — the plan's recommendation of 15 Nov 2026, revisable by Sam: measured
    // p95 57 ms (13 Nov), 56.2 (15 Nov, kerr-mini); its probe's controls passed (J0_PHASES=agecheck): p95 under 70 ms, every image's
    // screens uploaded at least once)
    const age = (out[tag] as { instrumentAge: { never: number; p95: number } | null }).instrumentAge;
    if (age) {
      expect(age.never, "images whose screens were never uploaded").toBe(0);
      expect(age.p95, "the instruments' age p95 [ms]").toBeLessThan(70);
    }
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
        const tsm0 = await app.js<number>("__bh.renderer.tsmDraws ?? 0");
        const f = await app.js<Flown>(flyJs(ABLATE_S, false));
        const tsm1 = await app.js<number>("__bh.renderer.tsmDraws ?? 0");
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
          // (the trees' shadow map's redraws over the flight — PLAN-J4 J4-5: every frame before its centre was snapped along the Sun, 15 Nov 2026)
          tsmDraws: tsm1 - tsm0,
          // (every pass — the empty dispatches' cost too: the water's kernels launched full screen with no water marked, the screen's
          // tile classification's ceiling)
          passes: f.passes,
          gpuErrors: f.gpuErrors,
        };
        rows.push(row);
        console.log(`  J0 ablation ${key}: ${JSON.stringify({ ...row, passes: undefined })}`);
        expect(f.gpuErrors).toBe(0);
      }
      out.ablations = rows;
    },
    600_000,
  );

  // (PLAN-J3 J3-0, method rule 3 — the instruments' age probe's controls, J0_PHASES=agecheck: 10 s as it is (A), 4 s with the
  // panoramic display's uploads stopped (the injected defect: its age must reach ≥ 3.5 s), 10 s as it is again (A′: the A/A, its p95
  // like A's))
  test.skipIf(!PHASES.includes("agecheck"))(
    "the instruments' age probe: a positive control and an A/A",
    async () => {
      await start("");
      const a = await app.js<Flown>(flyJs(10, false));
      await app.js(`(() => { const s = __bh.renderer.ship; s.__upd = s.updateJetScreen; s.updateJetScreen = () => {}; return 1; })()`);
      const blocked = await app.js<Flown>(flyJs(4, false));
      await app.js(`(() => { const s = __bh.renderer.ship; s.updateJetScreen = s.__upd; delete s.updateJetScreen; return 1; })()`);
      const b = await app.js<Flown>(flyJs(10, false));
      const row = { a: ageStats(a.ages), blocked: ageStats(blocked.ages), aAgain: ageStats(b.ages) };
      out.instrumentAgeCheck = row;
      console.log(`  J0 instruments' age check: ${JSON.stringify(row)}`);
      expect(row.blocked.max).toBeGreaterThan(3500);
      expect(row.a.n).toBeGreaterThan(50);
      expect(Math.abs(row.a.p95 - row.aAgain.p95)).toBeLessThan(Math.max(50, 0.5 * row.a.p95));
    },
    300_000,
  );

  // (PLAN-J3 J3-0 — the exposure by framing, J0_PHASES=framing: the same scene, its light the same, seen from the cockpit, behind the craft
  // (chase) and from its quarter; each mount set with the clock running (a mount set frozen is not applied — E2E-VOLS), ~60 frames, then
  // frozen and the exposure settled: renderer.ev(settings). The camera profile's meter breathes ±0.5 EV by design (Sam's decision 32): the
  // neutral profile measured too. Controls (method rule 3): the cockpit twice (the A/A), +1 EV injected for the chase alone (the positive))
  test.skipIf(!PHASES.includes("framing"))(
    "J3-0: the exposure by framing — cockpit, chase, quarter; camera and neutral profiles; its controls",
    async () => {
      await start("");
      const at = async (mount: string, look: string, bias = 0) => {
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          Object.assign(__bh.settings, { shipMount: "${mount}", lookProfile: "${look}", exposure: ${bias} }); __bh.refresh();
          for (let i = 0; i < 60; i++) await f(); __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f(); return 1; })()`);
        const ev = await app.js<number>(`+__bh.renderer.ev(__bh.settings).toFixed(3)`);
        await app.cdp
          .send("Page.captureScreenshot", { format: "png" })
          .then((x) =>
            Bun.write(`${OUT}/framing-${mount}-${look}${bias ? "-bias" : ""}.png`, Buffer.from((x as { data: string }).data, "base64")),
          );
        return ev - bias;
      };
      const row: Record<string, number> = {};
      for (const look of ["camera", "neutral"]) {
        row[`cockpit_${look}`] = await at("cockpit", look);
        row[`chase_${look}`] = await at("chase", look);
        row[`quarter_${look}`] = await at("quarter", look);
        row[`cockpitAgain_${look}`] = await at("cockpit", look);
      }
      // (does the craft enter the meter? — the inventory's open point: the quarter view, the craft much of the field, drawn and not drawn
      // (debugSkipShip), the camera profile — the one whose meter reads the image)
      row.quarterCraft_camera = await at("quarter", "camera");
      await app.js(`(() => { __bh.renderer.debugSkipShip = true; return 1; })()`);
      row.quarterNoCraft_camera = await at("quarter", "camera");
      await app.js(`(() => { __bh.renderer.debugSkipShip = false; return 1; })()`);
      // (the positive control: a per-framing compensation injected — +1 EV for the chase alone —, read back as the exposure in use)
      const injected = (await at("chase", "neutral", 1)) + 1;
      const d = (a: string, b: string) => +(row[a]! - row[b]!).toFixed(3);
      const out2 = {
        ev: row,
        aa: { camera: d("cockpitAgain_camera", "cockpit_camera"), neutral: d("cockpitAgain_neutral", "cockpit_neutral") },
        byFraming: {
          camera: { chase: d("chase_camera", "cockpit_camera"), quarter: d("quarter_camera", "cockpit_camera") },
          neutral: { chase: d("chase_neutral", "cockpit_neutral"), quarter: d("quarter_neutral", "cockpit_neutral") },
        },
        positive: +(injected - row.chase_neutral!).toFixed(3),
        craftInMeter: d("quarterNoCraft_camera", "quarterCraft_camera"),
      };
      out.framing = out2;
      console.log(`  J3-0 exposure by framing: ${JSON.stringify(out2)}`);
      await app.js(`(() => { Object.assign(__bh.settings, { shipMount: "cockpit", exposure: 0 }); return 1; })()`);
      expect(Math.abs(out2.positive - 1)).toBeLessThan(0.15);
    },
    600_000,
  );

  // (PLAN-J3 J3-1 — the craft lit by the ground's Sun, J0_PHASES=keylight: towards sunset the same flight (game.setDate carries the
  // craft), the craft's key light read back from the GPU (renderer.readShipKey: its direction on the probe's axes, its irradiance) with
  // the incident Sun on (the ground's and, since J3-1, the craft's) and off (the geometric for both — the craft's light before J3-1);
  // the CPU's lift (renderer.incidentNow against the geometric) beside it. Controls (method rule 3): on read twice (the A/A, the
  // direction's noise), the turn on → off read back as the CPU's lift (the positive: the probe sees the lift it is given))
  test.skipIf(!PHASES.includes("keylight"))(
    "J3-1: the craft's key light is the incident Sun towards sunset — its direction against the CPU's lift; A/A and positive",
    async () => {
      await start("");
      const deg = (a: number[], b: number[]) => {
        const d = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
        return (Math.acos(Math.max(-1, Math.min(1, d / Math.hypot(...a) / Math.hypot(...b)))) * 180) / Math.PI;
      };
      const read = async (on: boolean) =>
        app.js<{
          dir: number[];
          e: number;
          on: boolean;
          lift: number | null;
        }>(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q));
          const r = __bh.renderer; r.incidentSunOn = ${on}; __bh.freeze(false); __bh.refresh(); for (let i = 0; i < 30; i++) await f();
          __bh.freeze(true); for (let i = 0; i < 10; i++) await f();
          const k = await r.readShipKey(), n = r.lastNear, I = r.incidentNow;
          let lift = null;
          if (n && I) { const G = n.axes.map((a) => a[0] * n.light[0] + a[1] * n.light[1] + a[2] * n.light[2]);
            const d = (G[0] * I[0] + G[1] * I[1] + G[2] * I[2]) / Math.hypot(...G) / Math.hypot(...I); lift = Math.acos(Math.min(1, d)) * 180 / Math.PI; }
          return { dir: k.dir, e: k.e, on: k.on, lift }; })()`);
      const rows: { utc: string; lift: number | null; onVsOff: number; aa: number; eOn: number; eOff: number }[] = [];
      for (const utc of ["18:30", "18:50", "19:05", "19:15", "19:25"]) {
        await app.js(`(() => { __bh.freeze(false); __bh.game.setDate("2026-07-10T${utc}:00Z"); __bh.refresh(); return 1; })()`);
        const on = await read(true);
        const onAgain = await read(true);
        const off = await read(false);
        rows.push({
          utc,
          lift: on.lift === null ? null : +on.lift.toFixed(4),
          onVsOff: +deg(on.dir, off.dir).toFixed(4),
          aa: +deg(on.dir, onAgain.dir).toFixed(4),
          eOn: +on.e.toPrecision(4),
          eOff: +off.e.toPrecision(4),
        });
        console.log(`  J3-1 key light ${utc} UTC: ${JSON.stringify(rows.at(-1))}`);
        if (utc === "19:05") {
          for (const on2 of [true, false]) {
            await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.incidentSunOn = ${on2};
              __bh.freeze(false); Object.assign(__bh.settings, { shipMount: "quarter", lookProfile: "neutral" }); __bh.refresh();
              for (let i = 0; i < 60; i++) await f(); __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f(); return 1; })()`);
            await app.cdp
              .send("Page.captureScreenshot", { format: "png" })
              .then((x) =>
                Bun.write(
                  `${OUT}/keylight-${utc.replace(":", "")}-${on2 ? "incident" : "geometric"}.png`,
                  Buffer.from((x as { data: string }).data, "base64"),
                ),
              );
          }
          await app.js(
            `(() => { __bh.renderer.incidentSunOn = true; Object.assign(__bh.settings, { shipMount: "cockpit" }); return 1; })()`,
          );
        }
      }
      out.keylight = rows;
      await app.js(
        `(() => { __bh.renderer.incidentSunOn = true; __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`,
      );
      // (the positive: where the CPU lifts the Sun by more than the A/A's noise, the craft's key turns by that lift)
      const lifted = rows.filter((r) => r.lift !== null && r.lift > 0.1);
      expect(lifted.length).toBeGreaterThan(0);
      for (const r of lifted) expect(Math.abs(r.onVsOff - r.lift!)).toBeLessThan(Math.max(0.05, 3 * r.aa));
    },
    600_000,
  );

  // (PLAN-J3 J3-1 — the key light's air, J0_PHASES=keyair: the craft's key light through the air two ways at the camera — the march along
  // its ray (earthLookNoGround, the one lighting the craft) and the ground's transmittance table (sunThrough) —, read back the same frame
  // (readShipKey().air) from a high Sun to sunset: their ratio. Controls (method rule 3): the ratio read twice (the A/A — the march alone
  // moves between reads, the craft flying on), and the march made coarse on purpose (TUNE_AIR_N 4 for 32, a kernel variant: compiled,
  // then settled — after a first tune to warm, see below): the ratio must move. A lever lighting the craft by the table (TUNE_KEY_AIR),
  // tried on 13 Nov, was the session's first tune — its readings stuck (below) — and, the two models within 0.2 %, removed)
  test.skipIf(!PHASES.includes("keyair"))(
    "J3-1: the key light's air — the march against the ground's table, high Sun to sunset; A/A and a coarse march",
    async () => {
      await start("");
      type Air = { march: number; table: number; cloud: number; h: number } | null;
      const tune = async (t: string) => {
        await app.js(`(() => { __bh.renderer.tune = ${t}; return 1; })()`);
        await app.settled(120_000);
      };
      const read = async (utc: string) =>
        app.js<{ e: number; air: Air }>(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q));
          __bh.freeze(false); __bh.game.setDate("2026-07-10T${utc}:00Z"); __bh.refresh(); for (let i = 0; i < 30; i++) await f();
          __bh.freeze(true); for (let i = 0; i < 10; i++) await f();
          const k = await __bh.renderer.readShipKey(); return { e: k.e, air: k.air }; })()`);
      const p = (x: number | undefined) => (x === undefined ? null : +x.toPrecision(4));
      const ratio = (a: { air: Air }) => (a.air ? a.air.march / a.air.table : Number.NaN);
      const times = ["15:30", "18:30", "18:50", "19:05", "19:15"];
      const rows: Record<string, Record<string, number | null>> = {};
      for (const utc of times) {
        const a = await read(utc);
        const again = await read(utc);
        rows[utc] = {
          march: p(a.air?.march),
          table: p(a.air?.table),
          ratio: p(ratio(a)),
          ratioAgain: p(ratio(again)),
          cloud: p(a.air?.cloud),
          h: p(a.air?.h),
          e: p(a.e),
        };
      }
      // (the first tune after the start leaves the craft's probe as it was — its readings those of the frame before, whatever the tune:
      // seen twice on 13 Nov, the cause not found — PROBLEMES-A-REGLER —: a first tune taken to warm, its reading kept to say whether it moved)
      await tune("{ TUNE_AIR_N: 8 }");
      const warm = await read("19:05");
      // (stuck: read at 19:05, its table not the 19:05 one — run 3 of 13 Nov: 0.0040, the 19:15 Sun's, for 0.0468)
      const at1905 = rows["19:05"]!.table!;
      const stuck = Math.abs((warm.air?.table ?? 0) - at1905) > 0.05 * at1905;
      console.log(
        `  J3-1 key air: the first tune's reading ${stuck ? "STUCK (not the 19:05 Sun's)" : "fresh"} — ${JSON.stringify(warm.air)}`,
      );
      out.keyairFirstTuneStuck = stuck;
      await tune("{ TUNE_AIR_N: 4 }");
      for (const utc of ["15:30", "19:05"]) rows[utc]!.ratioCoarse = p(ratio(await read(utc)));
      await tune("{}");
      for (const utc of times) console.log(`  J3-1 key air ${utc} UTC: ${JSON.stringify(rows[utc])}`);
      out.keyair = rows;
      await app.js(`(() => { __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`);
      // (the A/A: the ratio read twice within 0.3 %; the positive: the coarse march moves it by more than 1 % somewhere)
      for (const utc of times) expect(Math.abs(rows[utc]!.ratio! - rows[utc]!.ratioAgain!)).toBeLessThan(3e-3);
      expect(["15:30", "19:05"].some((u) => Math.abs(rows[u]!.ratioCoarse! - rows[u]!.ratio!) > 0.01)).toBe(true);
    },
    900_000,
  );

  // (PLAN-J3 J3-1 — the sky's light, J0_PHASES=keysky: on a level surface at the camera, two ways read back the same frame (readShipKey().air)
  // — the ground's (skyAmbient's clear sky, skyIrradiance) and the craft's (its probe's harmonics, the sky as traced) —, the sky cleared
  // (earthClouds 0) from midday to sunset: their ratio. Controls (method rule 3): the ratio read twice (the A/A — the craft's probe drawn
  // by parts over frames, the sky changing fast at sunset: 2.1, 1.6 then 4.8 % apart at 19:05 in three runs, 13 Nov; 6 % allowed); a deck of clouds
  // (earthClouds 0.9 — the craft's probe sees it, the ground's clear sky does not by design): the ratio must move. Beside the harmonics, the
  // probe's texels integrated exactly over the hemisphere above (readShipSky): the harmonics' own part in the gap)
  test.skipIf(!PHASES.includes("keysky"))(
    "J3-1: the sky's light on a level surface — the craft's probe against the ground's clear sky, midday to sunset; A/A and clouds",
    async () => {
      await start("");
      type Air = { skyGround: number; skyCraft: number; h: number } | null;
      type Sky = { exact: number; sh: number; ground: number; shCpu: number; shHann: number; shLanczos: number; shBand4: number } | null;
      const clouds = async (c: number) => {
        await app.js(`(() => { __bh.game.set("earthClouds", ${c}); __bh.refresh(); return 1; })()`);
        await app.settled(120_000);
      };
      const read = async (utc: string) =>
        app.js<{ air: Air; sky: Sky }>(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q));
          __bh.freeze(false); __bh.game.setDate("2026-07-10T${utc}:00Z"); __bh.refresh(); for (let i = 0; i < 60; i++) await f();
          __bh.freeze(true); for (let i = 0; i < 10; i++) await f();
          const k = await __bh.renderer.readShipKey(); const sky = await __bh.renderer.readShipSky(); return { air: k.air, sky }; })()`);
      const p = (x: number | undefined) => (x === undefined ? null : +x.toPrecision(4));
      const ratio = (a: { air: Air }) => (a.air && a.air.skyGround > 0 ? a.air.skyCraft / a.air.skyGround : Number.NaN);
      // (the probe's texels integrated exactly over the hemisphere above — no harmonics: what the craft's harmonics add or lose)
      const exact = (a: { sky: Sky }) => (a.sky && a.sky.ground > 0 ? a.sky.exact / a.sky.ground : Number.NaN);
      const times = ["12:00", "15:30", "18:30", "19:05"];
      const rows: Record<string, Record<string, number | null>> = {};
      await clouds(0);
      for (const utc of times) {
        const a = await read(utc);
        const again = await read(utc);
        rows[utc] = {
          ground: p(a.air?.skyGround),
          craft: p(a.air?.skyCraft),
          ratio: p(ratio(a)),
          ratioAgain: p(ratio(again)),
          exact: p(exact(a)),
          exactAgain: p(exact(again)),
          // (the harmonics' ringing: this projection plain — against the GPU's, its control —, Hann and Lanczos windows; over the exact)
          cpuOverGpu: a.sky && a.sky.sh > 0 ? p(a.sky.shCpu / a.sky.sh) : null,
          hannOverExact: a.sky && a.sky.exact > 0 ? p(a.sky.shHann / a.sky.exact) : null,
          lanczosOverExact: a.sky && a.sky.exact > 0 ? p(a.sky.shLanczos / a.sky.exact) : null,
          plainOverExact: a.sky && a.sky.exact > 0 ? p(a.sky.shCpu / a.sky.exact) : null,
          band4OverExact: a.sky && a.sky.exact > 0 ? p(a.sky.shBand4 / a.sky.exact) : null,
          h: p(a.air?.h),
        };
      }
      await clouds(0.9);
      for (const utc of ["12:00", "15:30"]) {
        const a = await read(utc);
        Object.assign(rows[utc]!, {
          groundClouds: p(a.air?.skyGround),
          craftClouds: p(a.air?.skyCraft),
          ratioClouds: p(ratio(a)),
          exactClouds: p(exact(a)),
        });
      }
      await clouds(J0_SCENE.earthClouds);
      for (const utc of times) console.log(`  J3-1 key sky ${utc} UTC: ${JSON.stringify(rows[utc])}`);
      out.keysky = rows;
      await app.js(`(() => { __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`);
      for (const utc of times) expect(Math.abs(rows[utc]!.ratio! - rows[utc]!.ratioAgain!)).toBeLessThan(0.06 * rows[utc]!.ratio!);
      expect(["12:00", "15:30"].some((u) => Math.abs(rows[u]!.ratioClouds! - rows[u]!.ratio!) > 0.05 * rows[u]!.ratio!)).toBe(true);
    },
    900_000,
  );

  // (PLAN-J3 J3-1 — the craft / ground coherence probe, J0_PHASES=coherence (the exit measure of PLAN-J3 §4): in one read per hour — midday,
  // 18:30, 19:05, the sky cleared — the three gaps between the light the craft gets and the ground's: (1) the key's direction — its turn when
  // the incident Sun is switched off against the CPU's lift (the refraction): 0 if the craft follows the ground's Sun —, (2) the key's air —
  // the march along its ray over the ground's table —, (3) the sky on a level surface — the craft's probe integrated exactly, and its harmonics
  // (what the hull reads), over the ground's clear sky. Bounds set on the 13 Nov measures (keylight, keyair, keysky: their A/A and controls):
  // direction within max(0.05°, 3 × its A/A), air within 0.5 %, the exact sky within 0.90–1.15 (measured 0.95–1.09, A/A up to 4.8 %), the
  // harmonics within 0.90–1.30 (measured +8–13 % over the exact — the band 4 question, Sam's). Positive controls: the incident Sun off (the
  // direction gap = the lift where it is > 0.1°), a deck of clouds (the craft's sky moves, the ground's clear sky not))
  test.skipIf(!PHASES.includes("coherence"))(
    "J3-1: the craft / ground coherence probe — direction, air, sky in one read per hour; bounds from the measures, two positive controls",
    async () => {
      await start("");
      const deg = (a: number[], b: number[]) => {
        const d = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
        return (Math.acos(Math.max(-1, Math.min(1, d / Math.hypot(...a) / Math.hypot(...b)))) * 180) / Math.PI;
      };
      type K = {
        dir: number[];
        lift: number | null;
        air: { march: number; table: number; skyGround: number; skyCraft: number } | null;
        sky: {
          exact: number;
          ground: number;
          groundTaken: number;
          groundFloor: number;
          bandsProbe: number[];
          bandsGround: number[];
          gridE: number;
          shE0: number;
        } | null;
      };
      const read = async (utc: string, incident: boolean) =>
        app.js<K>(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); const r = __bh.renderer;
          r.incidentSunOn = ${incident}; __bh.freeze(false); __bh.game.setDate("2026-07-10T${utc}:00Z"); __bh.refresh();
          for (let i = 0; i < 60; i++) await f(); __bh.freeze(true); for (let i = 0; i < 10; i++) await f();
          const k = await r.readShipKey(), sky = await r.readShipSky(), n = r.lastNear, I = r.incidentNow;
          let lift = null;
          if (n && I) { const G = n.axes.map((a) => a[0] * n.light[0] + a[1] * n.light[1] + a[2] * n.light[2]);
            const d = (G[0] * I[0] + G[1] * I[1] + G[2] * I[2]) / Math.hypot(...G) / Math.hypot(...I); lift = Math.acos(Math.min(1, d)) * 180 / Math.PI; }
          return { dir: k.dir, lift, air: k.air, sky: sky ? { exact: sky.exact, ground: sky.ground, groundTaken: sky.groundTaken, groundFloor: sky.groundFloor, bandsProbe: sky.bandsProbe, bandsGround: sky.bandsGround, gridE: sky.gridE, shE0: sky.shE0 } : null }; })()`);
      const p = (x: number) => +x.toPrecision(4);
      // (COH_OLD=1: the probe not written over when the Sun jumps — renderer.probeSunJump false —, as before 14 Nov: the A/B of that fix)
      await app.js(
        `(() => { __bh.renderer.probeSunJump = ${!process.env.COH_OLD}; __bh.game.set("earthClouds", 0); __bh.refresh(); return 1; })()`,
      );
      await app.settled(120_000);
      const rows: Record<string, Record<string, number | null>> = {};
      for (const utc of (process.env.COH_TIMES ?? "12:00,18:30,19:05,19:15,20:00,20:20").split(",")) {
        const a = await read(utc, true);
        const b = await read(utc, true);
        const off = await read(utc, false);
        const aa = deg(a.dir, b.dir);
        const turn = deg(a.dir, off.dir);
        rows[utc] = {
          lift: a.lift === null ? null : p(a.lift),
          dirGap: a.lift === null ? null : p(Math.abs(turn - a.lift)),
          dirAA: p(aa),
          // (the positive: with the incident Sun off, the craft's key is the geometric Sun — its gap to the ground's incident one, the lift)
          dirGapOff: a.lift === null ? null : p(Math.abs(0 - a.lift)),
          air: a.air ? p(a.air.march / a.air.table) : null,
          airTable: a.air ? p(a.air.table) : null,
          skyExact: a.sky && a.sky.ground > 0 ? p(a.sky.exact / a.sky.ground) : null,
          skyHarmonics: a.air && a.air.skyGround > 0 ? p(a.air.skyCraft / a.air.skyGround) : null,
          skyExactAgain: b.sky && b.sky.ground > 0 ? p(b.sky.exact / b.sky.ground) : null,
          // (the two ways' own values — luminances, the scene's units —: which one leaves the other at sunset)
          groundSky: a.sky ? p(a.sky.ground) : null,
          // (the Sun's geometric height then [°]: the twilight's depth — the sky's light against it, a reference's curve)
          sunAlt: p(await app.js<number>("__bh.camera.skyInfo({ layered: false })?.sun.altDeg ?? NaN")),
          craftSkyExact: a.sky ? p(a.sky.exact) : null,
          // (14 Nov 2026: what the ground takes — its clear sky or the night's floor, the greater (liteSky) —: the table alone has no floor, so
          // past −15° the ratio over it said nothing; over what the ground takes, the coherence at night. Read twice: its A/A)
          groundTaken: a.sky ? p(a.sky.groundTaken) : null,
          floorOverTable: a.sky && a.sky.ground > 0 ? p(a.sky.groundFloor / a.sky.ground) : null,
          takenOverTable: a.sky && a.sky.ground > 0 ? p(a.sky.groundTaken / a.sky.ground) : null,
          skyExactTaken: a.sky && a.sky.groundTaken > 0 ? p(a.sky.exact / a.sky.groundTaken) : null,
          skyExactTakenAgain: b.sky && b.sky.groundTaken > 0 ? p(b.sky.exact / b.sky.groundTaken) : null,
        };
        // (radiance by radiance: the probe's elevation bands over the ground grid's — rows at 0.9°, 6.5°, 17.6°, 61.6° —, and the ground's
        // irradiance two ways at the sea's level, its grid integrated and its harmonics: where the two ways part)
        if (a.sky)
          console.log(
            `    ${utc} bands probe/ground (0.9° 6.5° 17.6° 61.6°): ${a.sky.bandsProbe.map((x, i) => p(x / a.sky!.bandsGround[i]!)).join(" ")}; ground E grid ${p(a.sky.gridE)} harmonics ${p(a.sky.shE0)} at h ${p(a.sky.ground)}`,
          );
        console.log(`  J3-1 coherence ${utc} UTC: ${JSON.stringify(rows[utc])}`);
      }
      // (the second positive: a deck of clouds — the craft's probe sees it, the ground's clear sky does not by design —: the harmonics' ratio moves)
      await app.js(`(() => { __bh.renderer.incidentSunOn = true; __bh.game.set("earthClouds", 0.9); __bh.refresh(); return 1; })()`);
      await app.settled(120_000);
      const cl = await read("12:00", true);
      rows["12:00"]!.skyHarmonicsClouds = cl.air && cl.air.skyGround > 0 ? p(cl.air.skyCraft / cl.air.skyGround) : null;
      await app.js(
        `(() => { __bh.renderer.incidentSunOn = true; __bh.game.set("earthClouds", ${J0_SCENE.earthClouds}); __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`,
      );
      console.log(
        `  J3-1 coherence, clouds 0.9 at 12:00: harmonics ${rows["12:00"]!.skyHarmonicsClouds} (clear ${rows["12:00"]!.skyHarmonics})`,
      );
      out.coherence = rows;
      // (the taken sky's controls (rule 3): by day the floor does not bite — what the ground takes is its table, within 5 % —; in the deep
      // night (Sun under −18°, COH_TIMES) it does — over twice the table; its bounds on the craft's sky set once measured, not before)
      for (const [utc, r] of Object.entries(rows)) {
        if (r.takenOverTable !== null && r.sunAlt! > 5)
          expect(Math.abs(r.takenOverTable! - 1), `taken = table by day ${utc}`).toBeLessThan(0.05);
        if (r.takenOverTable !== null && r.sunAlt! < -18) expect(r.takenOverTable!, `the floor at night ${utc}`).toBeGreaterThan(2);
        // (PLAN-J3 §4 at dusk: the craft's sky over what the ground takes — measured 14 Nov 2026 after skyFlat's two fixes, −4.6 to −12.7°:
        // 0.87–1.08, A/A ≤ 5 % — within 0.82–1.20; under −13° the ground's night floor (EARTH_NIGHT, Q2's ×5) leaves the craft's real sky
        // at 0.24–0.56 of it, reported — PLAN-J3 question 7)
        if (r.skyExactTaken !== null && r.sunAlt! <= 0 && r.sunAlt! > -13) {
          expect(r.skyExactTaken!, `dusk: the craft's sky over the ground's ${utc}`).toBeGreaterThan(0.82);
          expect(r.skyExactTaken!, `dusk: the craft's sky over the ground's ${utc}`).toBeLessThan(1.2);
        }
      }
      for (const [utc, r] of Object.entries(rows)) {
        if (r.dirGap !== null) expect(r.dirGap!, `direction ${utc}`).toBeLessThan(Math.max(0.05, 3 * r.dirAA!));
        // (the air's bound where the Sun still comes through — the table's transmittance over 5 % —: below, a ratio of two vanishing
        // transmittances at the horizon's grazing — 0.87–0.90 at 19:20, the table 0.02 % —, reported only)
        if (r.air !== null && r.airTable! > 0.05) expect(Math.abs(r.air! - 1), `air ${utc}`).toBeLessThan(0.005);
        // (the sky's bounds over the ground's table: by day and in the civil twilight, to −5° — where they were measured (14 Nov, 20:00 at −7.5°:
        // the harmonics 1.46); below, the table falls
        // past the night's floor and the ratio over it says nothing: over what the ground takes, skyExactTaken, reported)
        if (!(r.sunAlt! > -5)) continue;
        expect(r.skyExact!, `sky exact ${utc}`).toBeGreaterThan(0.9);
        expect(r.skyExact!, `sky exact ${utc}`).toBeLessThan(1.15);
        expect(r.skyHarmonics!, `sky harmonics ${utc}`).toBeGreaterThan(0.9);
        expect(r.skyHarmonics!, `sky harmonics ${utc}`).toBeLessThan(1.3);
      }
      // (the positives seen: the incident Sun off breaks the direction bound where the lift shows; the clouds move the sky by > 5 %)
      const lifted = Object.values(rows).filter((r) => typeof r.lift === "number" && r.lift > 0.1);
      expect(lifted.length).toBeGreaterThan(0);
      for (const r of lifted) expect(r.dirGapOff!).toBeGreaterThan(Math.max(0.05, 3 * r.dirAA!));
      const c = rows["12:00"]!;
      expect(Math.abs(c.skyHarmonicsClouds! - c.skyHarmonics!)).toBeGreaterThan(0.05 * c.skyHarmonics!);
    },
    900_000,
  );

  // (PLAN-J3 J3-2 — the air on the craft, J0_PHASES=keyhaze: the flown craft seen from aside (the "around" mount — "chase" keeps its own offset) at 300 m, 3 km and 10 km (the
  // outside camera's distance; the field narrowed with it — the craft about the same size on the image), with its air (renderer
  // shipAirAllowed: ship.wgsl shipAir, the tracer's aerial table) and without (as before J3-2); each shot's centre box compared: the 99th
  // percentile of |on − off| [0–255]. Controls: off twice (the A/A); the change must grow with the distance — none to see at 300 m)
  test.skipIf(!PHASES.includes("keyhaze"))(
    "J3-2: the craft through the air of its distance — 300 m, 3 km, 10 km, with and without; A/A",
    async () => {
      await start("");
      const fov0 = await app.js<number>("__bh.settings.fov");
      const shot = async (name: string, dist: number, air: boolean) => {
        const fov = (2 * Math.atan(28 / dist) * 180) / Math.PI;
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          __bh.renderer.shipAirAllowed = ${air};
          Object.assign(__bh.settings, { shipMount: "around", fov: ${fov}, dof: false, motionBlur: 0, lookProfile: "neutral" });
          Object.assign(__bh.camera.outside, { yaw: 60, pitch: 4, dist: ${dist} }); __bh.refresh();
          for (let i = 0; i < 90; i++) await f(); __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 40; i++) await f(); return 1; })()`);
        const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
        const bytes = Buffer.from(x.data, "base64");
        await Bun.write(`${OUT}/keyhaze-${name}.png`, bytes);
        return readPng(new Uint8Array(bytes));
      };
      // (the centre box — a fifth of the image each way, where the outside camera holds the craft —: the 99th percentile of the pixels'
      // |on − off| (the channels' mean): the craft a few hundred pixels of it far off, a mean over the box drowned it — run 2, 13 Nov)
      const diff = (a: ReturnType<typeof readPng>, b: ReturnType<typeof readPng>) => {
        const w = a.width,
          h = a.height,
          c = a.channels;
        const v: number[] = [];
        for (let y = Math.floor(0.4 * h); y < Math.floor(0.6 * h); y++)
          for (let x0 = Math.floor(0.4 * w); x0 < Math.floor(0.6 * w); x0++) {
            const i = (y * w + x0) * c;
            v.push(
              (Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!)) /
                3,
            );
          }
        v.sort((x, y) => x - y);
        return +v[Math.floor(0.99 * (v.length - 1))]!.toFixed(2);
      };
      // (the mount set and held first: switched to "around", the camera starts before the craft and glides — run 2's first shot)
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
        __bh.settings.shipMount = "around"; __bh.refresh(); for (let i = 0; i < 30; i++) await f();
        Object.assign(__bh.camera.outside, { yaw: 60, pitch: 4, dist: 300 }); for (let i = 0; i < 150; i++) await f(); return 1; })()`);
      const rows: Record<string, number> = {};
      for (const dist of [300, 3000, 10000]) {
        const off = await shot(`${dist}-off`, dist, false);
        const on = await shot(`${dist}-on`, dist, true);
        rows[`d${dist}`] = diff(on, off);
        if (dist === 10000) rows.aa = diff(off, await shot(`${dist}-off2`, dist, false));
      }
      // (the flames and the lamps read the air too — their bind groups changed with it —: the afterburner lit, seen from 200 m aside,
      // the page's WebGPU errors counted — none)
      const err0 = await app.js<number>("__bh.renderer.gpuErrors");
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
        Object.assign(__bh.settings, { fov: ${fov0} }); Object.assign(__bh.camera.outside, { yaw: 150, pitch: 4, dist: 200 });
        __bh.camera.jetToggle("ab"); for (let i = 0; i < 120; i++) await f(); return 1; })()`);
      const ab = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
      await Bun.write(`${OUT}/keyhaze-afterburner.png`, Buffer.from(ab.data, "base64"));
      await app.js(`(() => { __bh.camera.jetToggle("ab"); return 1; })()`);
      rows.gpuErrors = (await app.js<number>("__bh.renderer.gpuErrors")) - err0;
      await app.js(
        `(() => { __bh.renderer.shipAirAllowed = true; Object.assign(__bh.settings, { shipMount: "cockpit", fov: ${fov0} }); return 1; })()`,
      );
      console.log(`  J3-2 the craft's air: p99 |on − off| in the centre box (0–255): ${JSON.stringify(rows)}`);
      out.keyhaze = rows;
      expect(rows.d10000!).toBeGreaterThan(rows.d300!);
      expect(rows.d10000!).toBeGreaterThan(3 * rows.aa!);
      expect(rows.gpuErrors).toBe(0);
    },
    900_000,
  );

  // (PLAN-J3 J3-3 — the shadows' owners, J0_PHASES=shadows (J0_START over a town: Paris for buildings and trees): the Sun lowered (18:00
  // UTC), the world frozen, the exposure held (autoExposure off at the EV in use), the raster shaded whole (every pixel, scale 1); the
  // ground's sun shadows taken apart by liteSkip's run-time bits — 4 the relief's cascades (the buildings in them too), 16384 the contact
  // shadows (read only within the cascades' branch), 2 the trees' and buildings' map —: none, the cascades alone, cascades + contact, the
  // scenery's map alone, all, all again (the A/A). Per 8 × 8 block (its mean luminance, the craft's centre box left out): shadowed by a source
  // where its image is under 0.85 × none's; both — the overlap —; and among them, darker with all than the darker of the two alone by
  // 15 % (a shadow counted twice). Shots keep each)
  test.skipIf(!PHASES.includes("shadows"))(
    "J3-3: the ground's sun shadows by owner — cascades, contact, the scenery's map; their overlap and double counting; A/A",
    async () => {
      await start("");
      const fov0 = await app.js<number>("__bh.settings.fov");
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
        __bh.game.setDate("2026-07-10T18:00:00Z"); __bh.settings.shipMount = "around"; __bh.refresh(); for (let i = 0; i < 30; i++) await f();
        Object.assign(__bh.camera.outside, { yaw: 30, pitch: 35, dist: 120 });
        Object.assign(__bh.settings, { dof: false, motionBlur: 0, lookProfile: "neutral", dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1 });
        for (let i = 0; i < 150; i++) await f(); __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f();
        const ev = __bh.renderer.ev(__bh.settings); Object.assign(__bh.settings, { autoExposure: false, exposure: ev }); return 1; })()`);
      await app.dataSettled("J3-3: the town's data", { stallMs: 30_000, compileStallMs: 60_000, maxMs: 90_000 });
      const shot = async (name: string, skip: number) => {
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.liteSkip = ${skip}; __bh.refresh();
          for (let i = 0; i < 45; i++) await f(); return 1; })()`);
        const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
        const bytes = Buffer.from(x.data, "base64");
        await Bun.write(`${OUT}/shadows-${name}.png`, bytes);
        return readPng(new Uint8Array(bytes));
      };
      const none = await shot("none", 2 | 4 | 16384);
      const relief = await shot("cascades", 2 | 16384);
      const reliefContact = await shot("cascades-contact", 2);
      const scenery = await shot("scenery", 4 | 16384);
      const all = await shot("all", 0);
      const allAgain = await shot("all-again", 0);
      await app.js(
        `(() => { __bh.renderer.liteSkip = 0; Object.assign(__bh.settings, { autoExposure: true, exposure: 0, shipMount: "cockpit", fov: ${fov0} }); __bh.freeze(false); return 1; })()`,
      );
      // (8 × 8 blocks, their mean luminance: the pixels' own noise — the trees' texture, the stochastic shading — set 8 % of single
      // pixels 10 % apart between two shots of the same frozen scene, run 1 of 13 Nov)
      const B = 8;
      const blocks = (p: typeof none) => {
        const bw = Math.floor(p.width / B),
          bh = Math.floor(p.height / B),
          o = new Float64Array(bw * bh);
        for (let by = 0; by < bh; by++)
          for (let bx = 0; bx < bw; bx++) {
            let t = 0;
            for (let y = 0; y < B; y++)
              for (let x0 = 0; x0 < B; x0++) {
                const i = ((by * B + y) * p.width + bx * B + x0) * p.channels;
                t += 0.2126 * p.data[i]! + 0.7152 * p.data[i + 1]! + 0.0722 * p.data[i + 2]!;
              }
            o[by * bw + bx] = t / (B * B) + 1;
          }
        return { o, bw, bh };
      };
      const [K0, Kr, Krc, Ks, Ka, Ka2] = [none, relief, reliefContact, scenery, all, allAgain].map(blocks);
      const { bw, bh } = K0!;
      const n = { px: 0, relief: 0, contact: 0, scenery: 0, overlap: 0, double: 0, aaOff: 0 };
      for (let y = Math.floor(0.08 * bh); y < Math.floor(0.92 * bh); y++)
        for (let x0 = 0; x0 < bw; x0++) {
          if (x0 > 0.4 * bw && x0 < 0.6 * bw && y > 0.35 * bh && y < 0.65 * bh) continue;
          const k = y * bw + x0;
          const L0 = K0!.o[k]!,
            Lr = Kr!.o[k]!,
            Lrc = Krc!.o[k]!,
            Ls = Ks!.o[k]!,
            La = Ka!.o[k]!;
          n.px++;
          const r = Lr < 0.85 * L0,
            sc = Ls < 0.85 * L0;
          if (r) n.relief++;
          if (Lrc < 0.85 * Lr) n.contact++;
          if (sc) n.scenery++;
          if ((r || Lrc < 0.85 * L0) && sc) {
            n.overlap++;
            if (La < 0.85 * Math.min(Lrc, Ls)) n.double++;
          }
          if (Math.abs(La - Ka2!.o[k]!) > 0.1 * La) n.aaOff++;
        }
      const pct = (k: number) => +((100 * k) / n.px).toFixed(3);
      const row = {
        px: n.px,
        reliefPct: pct(n.relief),
        contactPct: pct(n.contact),
        sceneryPct: pct(n.scenery),
        overlapPct: pct(n.overlap),
        doublePct: pct(n.double),
        doubleOfOverlapPct: n.overlap ? +((100 * n.double) / n.overlap).toFixed(2) : 0,
        aaOffPct: pct(n.aaOff),
      };
      console.log(`  J3-3 the ground's sun shadows by owner: ${JSON.stringify(row)}`);
      out.shadows = row;
      // (the A/A's floor: 2.3 % of blocks 10 % apart in run 2 of 13 Nov — the trees', the glares' noise; a double count under it is not seen)
      expect(row.aaOffPct).toBeLessThan(5);
      expect(row.reliefPct + row.sceneryPct).toBeGreaterThan(0.5);
    },
    900_000,
  );

  // (PLAN-J3 J3-5 — the buildings wet, J0_PHASES=wetbld (J0_START over a town): the rain set, the ground wet at once (renderer.wetness 1 —
  // it grows over ~200 s), the town seen from above aside, frozen, the exposure held; a shot (wetbld.png) and the centre's mean luminance —
  // an A/B between two commits by scripts/ab-e2e.ts: the box buildings' wet factor, 13 Nov)
  test.skipIf(!PHASES.includes("wetbld"))(
    "J3-5: the town in the rain — wet ground and buildings, a shot for an A/B",
    async () => {
      await start("");
      const fov0 = await app.js<number>("__bh.settings.fov");
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
        __bh.game.set("weather", "rain"); __bh.settings.wind = 0; __bh.settings.shipMount = "around"; __bh.refresh();
        for (let i = 0; i < 30; i++) await f();
        Object.assign(__bh.camera.outside, { yaw: 30, pitch: 35, dist: 120 });
        Object.assign(__bh.settings, { dof: false, motionBlur: 0, lookProfile: "neutral", dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1 });
        for (let i = 0; i < 150; i++) { __bh.renderer.wetness = 1; await f(); }
        __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 40; i++) { __bh.renderer.wetness = 1; await f(); } return 1; })()`);
      // (the view's data and its buildings in before the shot — run 1 of the A/B, 13 Nov: side A shot with most of the town's
      // buildings still loading, its mean luminance the scenery's, not the wet's; 90 s at most, said)
      await app.dataSettled("J3-5: the town's data in the rain", { stallMs: 30_000, compileStallMs: 60_000, maxMs: 90_000 });
      const sc = await sceneryReady(app, 60_000);
      if (!sc.ready) console.log(`  J3-5: the scenery not whole at the shot (${sc.status})`);
      await app.js(
        `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 40; i++) { __bh.renderer.wetness = 1; await f(); } return 1; })()`,
      );
      const st = await app.js<{ wet: number; rain: number }>(`({ wet: __bh.renderer.wetness, rain: __bh.renderer.rain?.rain ?? -1 })`);
      const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
      const bytes = Buffer.from(x.data, "base64");
      await Bun.write(`${OUT}/wetbld.png`, bytes);
      const img = readPng(new Uint8Array(bytes));
      let t = 0,
        n = 0;
      for (let y = Math.floor(0.1 * img.height); y < Math.floor(0.9 * img.height); y++)
        for (let x0 = 0; x0 < img.width; x0++) {
          const i = (y * img.width + x0) * img.channels;
          t += 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
          n++;
        }
      const row = { ...st, meanLum: +(t / n).toFixed(2), ev: await app.js<number>("+__bh.renderer.ev(__bh.settings).toFixed(3)") };
      console.log(`  J3-5 the town wet: ${JSON.stringify(row)}`);
      out.wetbld = row;
      await app.js(
        `(() => { __bh.game.set("weather", "${J0_SCENE.weather}"); Object.assign(__bh.settings, { shipMount: "cockpit", fov: ${fov0} }); __bh.freeze(false); return 1; })()`,
      );
      expect(st.rain).toBeGreaterThan(0);
    },
    600_000,
  );

  // (PROBLEMES — the first renderer.tune of a session leaves the craft's Sun at the hour before, J0_PHASES=tunestall: the date moved to
  // 19:05 and 18:30 before any tune, then after a first tune (TUNE_AIR_N 8), then after a second (TUNE_AIR_N 4); each time the CPU's Sun
  // (camera.skyInfo().sun.altDeg), the scene's date (game.date()) and the GPU's (readShipKey().air.table — the transmittance towards
  // it): where the hour sticks)
  test.skipIf(!PHASES.includes("tunestall"))(
    "the first renderer.tune and the hour — the CPU's Sun, the scene's date, the GPU's light, before and after",
    async () => {
      await start("");
      const at = async (utc: string) =>
        app.js<Record<string, unknown>>(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          __bh.game.setDate("2026-07-10T${utc}:00Z"); __bh.refresh(); for (let i = 0; i < 40; i++) await f();
          const k = await __bh.renderer.readShipKey(); const sky = __bh.camera.skyInfo?.();
          let date = null; try { date = String(__bh.game.date?.() ?? null); } catch (e) { date = "err " + e; }
          return { utc: "${utc}", cpuSunAlt: sky?.sun?.altDeg ?? null, date, gpuTable: k.air ? +k.air.table.toPrecision(4) : null, tuneKey: JSON.stringify(__bh.renderer.tune),
            envFound: !!__bh.renderer.traceVariant?.("env"), featureKey: __bh.renderer.featureKey >>> 0, tuneId: (__bh.renderer.featureKey >>> 20) & 63,
            variants: [...__bh.renderer.variants.entries()].filter(([, v]) => v.env).map(([k]) => k >>> 0) }; })()`);
      const tune = async (t: string) => {
        await app.js(`(() => { __bh.renderer.tune = ${t}; return 1; })()`);
        await app.settled(120_000);
      };
      const rows: Record<string, unknown>[] = [];
      rows.push(await at("19:05"), await at("18:30"));
      await tune("{ TUNE_AIR_N: 8 }");
      rows.push(await at("19:05"), await at("18:30"));
      await tune("{ TUNE_AIR_N: 4 }");
      rows.push(await at("19:05"), await at("18:30"));
      await tune("{}");
      for (const r of rows) console.log(`  tune stall: ${JSON.stringify(r)}`);
      out.tunestall = rows;
      await app.js(`(() => { __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`);
      expect(rows.length).toBe(6);
    },
    600_000,
  );

  // (PLAN-J3 J3-5 — the reference views where the buildings' tables count, J0_PHASES=cityview (J0_START over a town): frozen, the data and
  // scenery in, the exposure settled; two views of the town — aside at 10° (walls), from above at 35° (roofs) — shots, and a 24 × 14 grid of
  // renderer.surfaceAt samples: what the pixels are (ground, building — a meshed one —, box — a box-drawn one —, tree…), the buildings'
  // share drawn from their tables vs the photo-coloured meshes. Nothing changed)
  test.skipIf(!PHASES.includes("cityview"))(
    "J3-5: a town's reference views — aside and from above; what its pixels are (meshed buildings, boxes, ground)",
    async () => {
      await start("");
      const fov0 = await app.js<number>("__bh.settings.fov");
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
        __bh.settings.shipMount = "around"; __bh.refresh(); for (let i = 0; i < 30; i++) await f();
        Object.assign(__bh.camera.outside, { yaw: 30, pitch: 10, dist: 200 });
        Object.assign(__bh.settings, { dof: false, motionBlur: 0, lookProfile: "neutral", dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1 });
        for (let i = 0; i < 150; i++) await f(); __bh.freeze(true); return 1; })()`);
      const views: Record<string, unknown> = {};
      for (const [name, pitch] of [
        ["aside", 10],
        ["above", 35],
      ] as const) {
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          Object.assign(__bh.camera.outside, { yaw: 30, pitch: ${pitch}, dist: 200 }); for (let i = 0; i < 90; i++) await f(); __bh.freeze(true); return 1; })()`);
        await app.dataSettled(`J3-5: the town's data (${name})`, { stallMs: 30_000, compileStallMs: 60_000, maxMs: 90_000 });
        const sc = await sceneryReady(app, 60_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.settleExposure(); for (let i = 0; i < 45; i++) await f(); return 1; })()`,
        );
        const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
        await Bun.write(`${OUT}/cityview-${name}.png`, Buffer.from(x.data, "base64"));
        const kinds = await app.js<Record<string, number>>(`(async () => { const k = {};
          for (let j = 0; j < 14; j++) for (let i = 0; i < 24; i++) { const r = await __bh.renderer.surfaceAt((i + 0.5) / 24, 0.1 + 0.8 * (j + 0.5) / 14);
            const kk = r ? r.kind : "null"; k[kk] = (k[kk] ?? 0) + 1; }
          return k; })()`);
        views[name] = { scenery: sc.status, buildings: sc.buildings, meshed: sc.meshedBuildings, kinds };
        console.log(`  J3-5 city view ${name}: ${JSON.stringify(views[name])}`);
      }
      out.cityview = views;
      await app.js(`(() => { Object.assign(__bh.settings, { shipMount: "cockpit", fov: ${fov0} }); __bh.freeze(false); return 1; })()`);
      expect(Object.keys(views).length).toBe(2);
    },
    900_000,
  );

  // (PLAN-J3 J3-5 — the buildings' albedo, before / after views for Sam, J0_PHASES=materials (J0_START over a town abroad — Brussels: no
  // national orthophoto, the roofs the tables'): the town aside and from above, frozen, the data and scenery in, the exposure held; as drawn,
  // then the trial (renderer.tune TUNE_BLD_TILE 2.5, TUNE_BLD_BRICK 1.5 — the inventory's measured ranges), the roofs not pulled to the
  // photograph (TUNE_BLD_PHOTO 0) as drawn and with the trial, then as drawn again (the A/A);
  // shots and the mean luminance. Nothing changed by default)
  test.skipIf(!PHASES.includes("materials"))(
    "J3-5: the buildings' albedo — as drawn, the trial (tiles × 2.5, brick × 1.5), as drawn again; aside and from above",
    async () => {
      await start("");
      const fov0 = await app.js<number>("__bh.settings.fov");
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
        __bh.settings.shipMount = "around"; __bh.refresh(); for (let i = 0; i < 30; i++) await f();
        Object.assign(__bh.camera.outside, { yaw: 30, pitch: 10, dist: 200 });
        Object.assign(__bh.settings, { dof: false, motionBlur: 0, lookProfile: "neutral", dynamicResolution: false, earthRasterShading: "every", earthRasterScale: 1 });
        for (let i = 0; i < 150; i++) await f(); __bh.freeze(true); return 1; })()`);
      const lum = (bytes: Buffer) => {
        const img = readPng(new Uint8Array(bytes));
        let t = 0,
          n = 0;
        for (let y = Math.floor(0.1 * img.height); y < Math.floor(0.9 * img.height); y++)
          for (let x0 = 0; x0 < img.width; x0++) {
            const i = (y * img.width + x0) * img.channels;
            t += 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
            n++;
          }
        return +(t / n).toFixed(2);
      };
      const rows: Record<string, Record<string, number>> = {};
      for (const [view, pitch] of [
        ["aside", 10],
        ["above", 35],
      ] as const) {
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.tune = {}; __bh.freeze(false);
          Object.assign(__bh.camera.outside, { yaw: 30, pitch: ${pitch}, dist: 200 }); for (let i = 0; i < 90; i++) await f(); __bh.freeze(true);
          Object.assign(__bh.settings, { autoExposure: true, exposure: 0 }); return 1; })()`);
        await app.dataSettled(`J3-5: the town's data (${view})`, { stallMs: 30_000, compileStallMs: 60_000, maxMs: 90_000 });
        await sceneryReady(app, 60_000);
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f();
          const ev = __bh.renderer.ev(__bh.settings); Object.assign(__bh.settings, { autoExposure: false, exposure: ev }); return 1; })()`);
        const row: Record<string, number> = {};
        for (const [name, tune] of [
          ["asDrawn", "{}"],
          ["trial", "{ TUNE_BLD_TILE: 2.5, TUNE_BLD_BRICK: 1.5 }"],
          ["noPhoto", "{ TUNE_BLD_PHOTO: 0 }"],
          ["noPhotoTrial", "{ TUNE_BLD_PHOTO: 0, TUNE_BLD_TILE: 2.5, TUNE_BLD_BRICK: 1.5 }"],
          ["asDrawnAgain", "{}"],
        ] as const) {
          await app.js(`(() => { __bh.renderer.tune = ${tune}; __bh.refresh(); return 1; })()`);
          await app.settled(120_000);
          // (every kernel of the new key compiled — the sky's discs too: run 2 of 13 Nov shot the trial with them still compiling, the
          // trees missing; settled() waits only the main kernel)
          await app.waitFor("__bh.renderer.compiling.size === 0", 120_000);
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 45; i++) await f(); return 1; })()`,
          );
          const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
          const bytes = Buffer.from(x.data, "base64");
          await Bun.write(`${OUT}/materials-${view}-${name}.png`, bytes);
          row[name] = lum(bytes);
        }
        rows[view] = row;
        console.log(`  J3-5 the buildings' albedo trial (${view}): mean luminance ${JSON.stringify(row)}`);
      }
      out.materials = rows;
      await app.js(
        `(() => { __bh.renderer.tune = {}; Object.assign(__bh.settings, { autoExposure: true, exposure: 0, shipMount: "cockpit", fov: ${fov0} }); __bh.freeze(false); return 1; })()`,
      );
      for (const r of Object.values(rows)) expect(Math.abs(r.asDrawn! - r.asDrawnAgain!)).toBeLessThan(2);
    },
    900_000,
  );

  // (PLAN-J3 J3-1 — skyFlat's dim fallback, J0_PHASES=twilightdim (TWI_TIMES other moments): the coherence probe found the ground lit
  // 115–185 × its own clear sky at −7.5…−9° (the old bluish tenth of the Sun's, where the camera's sky is too dim to scale) while the craft
  // gets that sky; since 14 Nov the camera's sky is carried down instead (TUNE_SKYFLAT_DIM 1, the default). As drawn, the old fallback
  // (TUNE_SKYFLAT_DIM 0), as drawn again (the A/A), the exposure held at the first's; the world's data in first (the first run's A/A at
  // noon, 3.9 levels, was the tiles still arriving); the quarter view (the craft and the ground, westward); per moment: shots, the frame's
  // lower half (the ground) and centre (the craft) mean luminances, the probe's ground taken over its table, the craft's sky over it)
  test.skipIf(!PHASES.includes("twilightdim"))(
    "J3-1: skyFlat's dim fallback — the twilight's ground as drawn / the old fallback / as drawn, the exposure held; shots and the probe",
    async () => {
      await start("");
      // (the world's data in before the first shot: tiles, imagery, scenery — bounded, what is missing said)
      await app
        .waitFor(
          "(() => { const r = __bh.renderer; return r.earthTiles.pending === 0 && r.earthTiles.orthoPending === 0 && !r.earthScenery.stats().pending; })()",
          60_000,
        )
        .catch(() => console.log("  twilight dim: the world's data still arriving after 60 s — the A/A will say if it mattered"));
      const times = (process.env.TWI_TIMES ?? "12:00,19:40,20:00,20:10,20:20").split(",");
      const ev: Record<string, number> = {};
      const rows: Record<string, Record<string, number | null>> = {};
      const p = (x: number) => +x.toPrecision(4);
      const shoot = async (utc: string, name: string) => {
        const e = await app.js<number>(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          __bh.game.setDate("2026-07-10T${utc}:00Z"); Object.assign(__bh.settings, { shipMount: "quarter", lookProfile: "neutral", dof: false, motionBlur: 0, autoExposure: true, exposure: 0 });
          __bh.refresh(); for (let i = 0; i < 90; i++) await f(); __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f();
          const auto = __bh.renderer.ev(__bh.settings); Object.assign(__bh.settings, { autoExposure: false, exposure: ${ev[utc] ?? "auto"} }); for (let i = 0; i < 20; i++) await f(); return auto; })()`);
        if (ev[utc] === undefined) ev[utc] = e;
        const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
        const bytes = Buffer.from(x.data, "base64");
        await Bun.write(`${OUT}/twilightdim-${utc.replace(":", "")}-${name}.png`, bytes);
        const img = readPng(new Uint8Array(bytes));
        const mean = (x0: number, x1: number, y0: number, y1: number) => {
          let t = 0,
            n = 0;
          for (let y = Math.floor(y0 * img.height); y < Math.floor(y1 * img.height); y++)
            for (let xx = Math.floor(x0 * img.width); xx < Math.floor(x1 * img.width); xx++) {
              const i = (y * img.width + xx) * img.channels;
              t += 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
              n++;
            }
          return +(t / n).toFixed(2);
        };
        const sky = await app.js<{ exact: number; ground: number; groundTaken: number } | null>(
          "(async () => { const s = await __bh.renderer.readShipSky(); return s && { exact: s.exact, ground: s.ground, groundTaken: s.groundTaken }; })()",
        );
        const row = (rows[utc] ??= {});
        row[`${name}Ground`] = mean(0, 1, 0.6, 1);
        row[`${name}Craft`] = mean(0.35, 0.65, 0.35, 0.65);
        row[`${name}TakenOverTable`] = sky && sky.ground > 0 ? p(sky.groundTaken / sky.ground) : null;
        row[`${name}CraftOverTaken`] = sky && sky.groundTaken > 0 ? p(sky.exact / sky.groundTaken) : null;
        row[`${name}AutoEv`] = p(e);
      };
      const lever = async (on: boolean) => {
        await app.js(`(() => { __bh.renderer.tune = ${on ? "{}" : "{ TUNE_SKYFLAT_DIM: 0 }"}; __bh.refresh(); return 1; })()`);
        await app.settled(120_000);
        await app.waitFor("__bh.renderer.compiling.size === 0", 120_000);
      };
      for (const utc of times) await shoot(utc, "drawn");
      await lever(false);
      for (const utc of times) await shoot(utc, "old");
      await lever(true);
      for (const utc of times) await shoot(utc, "drawnAgain");
      for (const utc of times) console.log(`  J3-1 twilight dim (${utc}): ${JSON.stringify(rows[utc])}`);
      out.twilightdim = rows;
      await app.js(
        `(() => { __bh.renderer.tune = {}; Object.assign(__bh.settings, { autoExposure: true, exposure: 0, shipMount: "cockpit" }); __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`,
      );
      // (the probe's positive: where the old fallback lit the ground over 10 × its sky, as drawn it takes its sky — under 2 ×; the image's:
      // there the old fallback's ground differs from the drawn one by over 4 × the A/A — as drawn twice, with the world's data still
      // streaming (run 2 of 14 Nov: 7.7 levels at noon, 14 at 20:00, against 64 between the two))
      const lit = Object.values(rows).filter((r) => (r.oldTakenOverTable ?? 0) > 10);
      expect(lit.length).toBeGreaterThan(0);
      for (const r of lit) {
        expect(r.drawnTakenOverTable!).toBeLessThan(2);
        expect(Math.abs(r.drawnGround! - r.drawnAgainGround!)).toBeLessThan(0.25 * Math.abs(r.oldGround! - r.drawnGround!));
      }
    },
    1_200_000,
  );

  // (PLAN-J3 §8 question 7 — the craft's night floor, J0_PHASES=nightfloor (NF_TIMES other moments): under −15° the ground takes its
  // calibrated night floor (EARTH_NIGHT, ~0.01 lux, five times the real moonless sky) and the craft the traced sky — 0.24 × the ground at
  // −19°. renderer.ship.nightFloor gives the craft the same floor. Off (as drawn), on, off again (the A/A), the exposure held; the quarter
  // view; shots, the frame's centre (the craft) and lower half (the ground) — views for Sam)
  test.skipIf(!PHASES.includes("nightfloor"))(
    "J3 question 7: the craft's night floor — off / on / off at night, the exposure held; shots for Sam",
    async () => {
      await start("");
      const rows: Record<string, Record<string, number>> = {};
      for (const utc of (process.env.NF_TIMES ?? "20:40,21:40,22:40").split(",")) {
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          __bh.game.setDate("2026-07-10T${utc}:00Z"); Object.assign(__bh.settings, { shipMount: "quarter", lookProfile: "neutral", dof: false, motionBlur: 0, autoExposure: true, exposure: 0 });
          __bh.refresh(); for (let i = 0; i < 90; i++) await f(); __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f();
          const ev = __bh.renderer.ev(__bh.settings); Object.assign(__bh.settings, { autoExposure: false, exposure: ev }); return 1; })()`);
        const row: Record<string, number> = {};
        const ev0 = await app.js<number>("__bh.settings.exposure");
        // (at the game's exposure — the eye adapted to the night: I/(I + I_eye) — and 6 stops over it, a photograph's: whether it shows at all)
        for (const [name, on, up] of [
          ["off", false, 0],
          ["on", true, 0],
          ["offAgain", false, 0],
          ["off6", false, 6],
          ["on6", true, 6],
        ] as const) {
          await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.ship.nightFloor = ${on}; __bh.settings.exposure = ${ev0} + ${up}; __bh.refresh();
            for (let i = 0; i < 20; i++) await f(); return 1; })()`);
          const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
          const bytes = Buffer.from(x.data, "base64");
          await Bun.write(`${OUT}/nightfloor-${utc.replace(":", "")}-${name}.png`, bytes);
          const img = readPng(new Uint8Array(bytes));
          const mean = (x0: number, x1: number, y0: number, y1: number) => {
            let t = 0,
              n = 0;
            for (let y = Math.floor(y0 * img.height); y < Math.floor(y1 * img.height); y++)
              for (let xx = Math.floor(x0 * img.width); xx < Math.floor(x1 * img.width); xx++) {
                const i = (y * img.width + xx) * img.channels;
                t += 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
                n++;
              }
            return +(t / n).toFixed(2);
          };
          row[`${name}Craft`] = mean(0.45, 0.85, 0.45, 0.8);
          row[`${name}Ground`] = mean(0, 0.35, 0.75, 1);
        }
        rows[utc] = row;
        console.log(`  J3 night floor (${utc}): ${JSON.stringify(row)}`);
      }
      out.nightfloor = rows;
      await app.js(
        `(() => { __bh.renderer.ship.nightFloor = false; Object.assign(__bh.settings, { autoExposure: true, exposure: 0, shipMount: "cockpit" }); __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`,
      );
      // (the A/A: off twice within 1 level; the positive — the lever acts —: 6 stops up, in the deep night, the craft brighter with the floor
      // (run 1 of 14 Nov: at the game's exposure no difference at all — 0.77 / 0.77, the craft's lamps alone —, the ground 0.03))
      for (const r of Object.values(rows)) expect(Math.abs(r.offCraft! - r.offAgainCraft!)).toBeLessThan(1);
      const deep = rows["21:40"] ?? Object.values(rows).at(-1)!;
      expect(deep.on6Craft! - deep.off6Craft!).toBeGreaterThan(1);
    },
    900_000,
  );

  // (PROBLEMES — the night sky's horizontal bands, J0_PHASES=nightbands: at 21:40 UTC (Sun −19°) the quarter view 6 stops over the game's
  // exposure showed bands ~10–11 rows apart, 7 to 24 in green. Which part makes them: as drawn; frozen 4 s more (the history converged); every
  // ray traced (realtimeSubsampling 1); the raster shaded whole, no dynamic resolution; the traced pipeline. Per case the sky's row means
  // (rows 100–300, columns 200–600): their mean and the mean jump between neighbouring rows over it — the bands' depth — and a shot)
  test.skipIf(!PHASES.includes("nightbands"))(
    "PROBLEMES: the night sky's bands 6 stops up — as drawn, converged, every ray, the raster whole, traced; their depth per case",
    async () => {
      await start("");
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
        __bh.game.setDate("2026-07-10T${process.env.NB_UTC ?? "21:40"}:00Z"); Object.assign(__bh.settings, { shipMount: "quarter", lookProfile: "neutral", dof: false, motionBlur: 0, autoExposure: true, exposure: 0 });
        __bh.refresh(); for (let i = 0; i < 90; i++) await f(); __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f();
        const ev = __bh.renderer.ev(__bh.settings); Object.assign(__bh.settings, { autoExposure: false, exposure: ev + 6 }); return 1; })()`);
      const cases: [string, string, string, number][] = [
        ["drawn", "", "", 20],
        ["converged", "", "", 240],
        ["everyRay", "__bh.settings.realtimeSubsampling = 1;", "__bh.settings.realtimeSubsampling = 'auto';", 60],
        [
          "rasterWhole",
          "Object.assign(__bh.settings, { earthRasterShading: 'every', dynamicResolution: false });",
          "Object.assign(__bh.settings, { earthRasterShading: 'auto', dynamicResolution: true });",
          60,
        ],
        ["traced", "__bh.settings.earthPipeline = 'trace';", "__bh.settings.earthPipeline = 'raster';", 60],
      ];
      const rows: Record<string, { mean: number; depth: number; pipeline: string }> = {};
      for (const [name, set, reset, frames] of cases) {
        await app.js(`(() => { ${set} __bh.touch?.(); __bh.refresh(); return 1; })()`);
        await app.settled(120_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < ${frames}; i++) await f(); return 1; })()`,
        );
        const pipeline = await app.js<string>("__bh.renderer.earthPipelineNow(__bh.settings)");
        const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
        const bytes = Buffer.from(x.data, "base64");
        await Bun.write(`${OUT}/nightbands-${name}.png`, bytes);
        const img = readPng(new Uint8Array(bytes));
        const sx = img.width / 1920;
        const m: number[] = [];
        for (let y = Math.floor(100 * sx); y < Math.floor(300 * sx); y++) {
          let t = 0,
            n = 0;
          for (let xx = Math.floor(200 * sx); xx < Math.floor(600 * sx); xx++) {
            t += img.data[(y * img.width + xx) * img.channels + 1]!;
            n++;
          }
          m.push(t / n);
        }
        const mean = m.reduce((a, b) => a + b, 0) / m.length;
        let jump = 0;
        for (let i = 1; i < m.length; i++) jump += Math.abs(m[i]! - m[i - 1]!);
        rows[name] = { mean: +mean.toFixed(2), depth: +(jump / (m.length - 1) / Math.max(mean, 1e-3)).toFixed(3), pipeline };
        console.log(`  night bands ${name}: ${JSON.stringify(rows[name])}`);
        await app.js(`(() => { ${reset} __bh.touch?.(); __bh.refresh(); return 1; })()`);
      }
      out.nightbands = rows;
      await app.js(
        `(() => { Object.assign(__bh.settings, { autoExposure: true, exposure: 0, shipMount: "cockpit" }); __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`,
      );
      expect(Object.keys(rows).length).toBe(cases.length);
    },
    900_000,
  );

  // (PLAN-J3 §8 question 3 — the scenery's shadow on the craft, J0_PHASES=craftshade (CS_PLACE "lat,lon,aglM,heading", CS_UTC): the craft
  // held 50 m up in a La Défense tower's shadow at 18:00 UTC (the Sun west, ~25° up — Tour First 231 m, 200 m east of it); the relief's
  // shadow on the craft is there already (trace.wgsl keyRelief), the trees' and buildings' not: TUNE_SHIP_SCENERY_SHADOW 1 reads their map at
  // the craft. Read: the map's values at the craft (readShipSky().sceneryAtCraft); then off / on / off, the exposure held, the quarter view —
  // the frame's centre (the craft) — shots for Sam)
  test.skipIf(!PHASES.includes("craftshade"))(
    "J3 question 3: the scenery's shadow on the craft — its map read at the craft, as drawn / before / as drawn; shots for Sam",
    async () => {
      await start("");
      const [lat, lon, agl, hdg] = (process.env.CS_PLACE ?? "48.8922,2.2421,30,280").split(",").map(Number);
      const utc = process.env.CS_UTC ?? "18:00";
      // (the cockpit: the camera — where the map is read, P.scenery[3] — is the craft; a grid about the place, 40 m steps, until the
      // buildings' layer reads a shadow there — the first under 0.5 —, 60 s of data at most first)
      const at = (la: number, lo: number) =>
        app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          __bh.game.setDate("2026-07-10T${utc}:00Z"); __bh.game.flyAt(${la}, ${lo}, ${agl}, ${hdg}, 80);
          Object.assign(__bh.settings, { shipMount: "cockpit", lookProfile: "neutral", dof: false, motionBlur: 0, autoExposure: true, exposure: 0 });
          __bh.refresh(); for (let i = 0; i < 6; i++) await f(); __bh.freeze(true); for (let i = 0; i < 80; i++) await f();
          const s = await __bh.renderer.readShipSky(); return s ? s.sceneryAtCraft : null; })()`);
      await at(lat!, lon!);
      await app
        .waitFor(
          "(() => { const r = __bh.renderer; return r.earthTiles.pending === 0 && !r.earthScenery.stats().pending && r.earthScenery.stats().status === 'ready'; })()",
          60_000,
        )
        .catch(() => console.log("  craft shade: the place's data still arriving after 60 s"));
      let found: [number, number] = [lat!, lon!];
      let best = 2;
      search: for (let r = 0; r <= 4; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const la = lat! + (dy * 40) / 111_200;
            const lo = lon! + (dx * 40) / (111_200 * Math.cos((lat! * Math.PI) / 180));
            const m = await at(la, lo);
            if (m && m[1] >= 0 && m[1] < best) (best = m[1]), (found = [la, lo]);
            if (best < 0.5) break search;
          }
      console.log(`  craft shade: the buildings' map at the craft ${best.toFixed(3)} at ${found[0].toFixed(5)}, ${found[1].toFixed(5)}`);
      await at(found[0], found[1]);
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 60; i++) await f();
        __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f(); const ev = __bh.renderer.ev(__bh.settings);
        Object.assign(__bh.settings, { autoExposure: false, exposure: ev }); return 1; })()`);
      const rows: Record<string, number | number[]> = {};
      const one = async (name: string) => {
        await app.settled(120_000);
        await app.waitFor("__bh.renderer.compiling.size === 0 && __bh.renderer.kernelsSettled", 120_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 60; i++) await f(); return 1; })()`,
        );
        const sky = await app.js<{ sceneryAtCraft: [number, number] } | null>("__bh.renderer.readShipSky()");
        const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
        const bytes = Buffer.from(x.data, "base64");
        await Bun.write(`${OUT}/craftshade-${name}.png`, bytes);
        const img = readPng(new Uint8Array(bytes));
        let t = 0,
          n = 0;
        for (let y = Math.floor(0.4 * img.height); y < Math.floor(0.8 * img.height); y++)
          for (let xx = Math.floor(0.35 * img.width); xx < Math.floor(0.85 * img.width); xx++) {
            const i = (y * img.width + xx) * img.channels;
            t += 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
            n++;
          }
        rows[`${name}Craft`] = +(t / n).toFixed(2);
        rows[`${name}Map`] = sky ? sky.sceneryAtCraft.map((v) => +v.toFixed(3)) : [];
      };
      // (as drawn — the scenery's shadow on, since 15 Nov —, the lever off — as before —, as drawn again)
      await one("drawn");
      await app.js(`(() => { __bh.renderer.tune = { TUNE_SHIP_SCENERY_SHADOW: 0 }; __bh.refresh(); return 1; })()`);
      await one("before");
      await app.js(`(() => { __bh.renderer.tune = {}; __bh.refresh(); return 1; })()`);
      await one("drawnAgain");
      console.log(
        `  J3 craft shade (${found[0].toFixed(5)}, ${found[1].toFixed(5)}, ${agl} m, ${utc} UTC, cockpit): ${JSON.stringify(rows)}`,
      );
      out.craftshade = rows;
      await app.js(
        `(() => { __bh.renderer.tune = {}; Object.assign(__bh.settings, { autoExposure: true, exposure: 0, shipMount: "cockpit" }); __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`,
      );
      expect(Math.abs((rows.drawnCraft as number) - (rows.drawnAgainCraft as number))).toBeLessThan(2);
    },
    900_000,
  );

  // (PLAN-J4 J4-1 — the clouds' history behind their drift, J0_PHASES=cloudlag: the free camera fixed 1 900 m over Toulon facing the
  // « cloudy » cumulus — the time running, the weather's clouds drifting with its wind —; image A taken running, then the world frozen and
  // the history left to converge: image B, the same instant's reference. |A − B| over the upper frame (the clouds) — the history's lag
  // behind the drift, and the amortisation's own noise. Controls (rule 3): the time stopped — A/A: the noise alone —; the time × 30 —
  // positive: thirty times the drift a frame. Each case twice)
  test.skipIf(!PHASES.includes("cloudlag"))(
    "J4-1: the clouds' history behind their drift — running against the same instant converged; stopped (A/A), × 30 (positive)",
    async () => {
      await start("");
      const speed0 = await app.js<number>("__bh.settings.timeSpeed");
      const rows: Record<string, number[]> = {};
      const shot = async (file?: string) => {
        const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
        const bytes = Buffer.from(x.data, "base64");
        if (file) await Bun.write(file, bytes);
        return readPng(new Uint8Array(bytes));
      };
      for (const [name, k] of [
        ["stopped", 0],
        ["realtime", 1],
        ["x30", 30],
        ["stopped2", 0],
        ["realtime2", 1],
        ["x30b", 30],
      ] as const) {
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          __bh.game.set("weather", "cloudy"); __bh.game.setDate("2026-07-10T15:30:00Z");
          const why = __bh.viewAt(43.06, 6.32, { altM: 1900, heading: 270, pitch: 2, fov: 50 }); if (why) throw new Error(why);
          Object.assign(__bh.settings, { lookProfile: "neutral", dof: false, motionBlur: 0, autoExposure: true, exposure: 0 });
          document.body.classList.add("hide-ui"); __bh.refresh(); for (let i = 0; i < 30; i++) await f(); return 1; })()`);
        await app.settled(120_000);
        // (the exposure the free view settles to, then held: A and B under the same one)
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f();
          Object.assign(__bh.settings, { autoExposure: false, exposure: __bh.renderer.ev(__bh.settings) });
          __bh.settings.timeSpeed = ${speed0} * ${k}; __bh.refresh(); for (let i = 0; i < 150; i++) await f(); return 1; })()`);
        const A = await shot(`${OUT}/cloudlag-${name}-A.png`);
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(true); __bh.touch();
          for (let i = 0; i < 120; i++) await f(); return 1; })()`);
        const B = await shot(`${OUT}/cloudlag-${name}-B.png`);
        let t = 0,
          n = 0;
        const diffs: number[] = [];
        for (let y = Math.floor(0.08 * A.height); y < Math.floor(0.5 * A.height); y += 2)
          for (let xx = 0; xx < A.width; xx += 2) {
            const i = (y * A.width + xx) * A.channels;
            const la = 0.2126 * A.data[i]! + 0.7152 * A.data[i + 1]! + 0.0722 * A.data[i + 2]!;
            const lb = 0.2126 * B.data[i]! + 0.7152 * B.data[i + 1]! + 0.0722 * B.data[i + 2]!;
            const d = Math.abs(la - lb);
            t += d;
            n++;
            diffs.push(d);
          }
        diffs.sort((a, b) => a - b);
        rows[name] = [+(t / n).toFixed(3), +diffs[Math.floor(0.99 * (diffs.length - 1))]!.toFixed(2)];
        console.log(`  J4-1 cloud lag ${name}: mean |A−B| ${rows[name]![0]}, p99 ${rows[name]![1]}`);
      }
      out.cloudlag = rows;
      await app.js(
        `(() => { document.body.classList.remove("hide-ui"); __bh.settings.timeSpeed = ${speed0}; Object.assign(__bh.settings, { autoExposure: true }); __bh.game.set("weather", "${J0_SCENE.weather}"); __bh.freeze(false); return 1; })()`,
      );
      // (the positive: × 30 beyond twice the stopped noise)
      expect(rows.x30![0]!).toBeGreaterThan(2 * rows.stopped![0]!);
    },
    900_000,
  );

  // (PLAN-J3 J3-1 — the sky's light on the craft with band 4 of its probe's harmonics, J0_PHASES=skyband4: the craft from above (around,
  // 40° — its faces up, toward the sky; run 2's quarter view from behind saw a silhouette against the sunset) at
  // noon and towards sunset, the exposure held; band 4 off (as drawn), on (renderer.ship.skyBand4 — ship.wgsl irradiance), off again (the
  // A/A); shots and the centre box's mean luminance — views for Sam. 19:40: the Sun set, the craft lit by the sky alone — the positive
  // control: there band 4 must show)
  test.skipIf(!PHASES.includes("skyband4"))(
    "J3-1: the craft's sky light with band 4 — noon and sunset, off / on / off; shots for Sam",
    async () => {
      await start("");
      const rows: Record<string, Record<string, number>> = {};
      for (const utc of ["12:00", "18:50", "19:40"]) {
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          __bh.game.setDate("2026-07-10T${utc}:00Z"); Object.assign(__bh.settings, { shipMount: "around", lookProfile: "neutral", dof: false, motionBlur: 0, autoExposure: true, exposure: 0 });
          __bh.refresh(); for (let i = 0; i < 30; i++) await f(); Object.assign(__bh.camera.outside, { yaw: 160, pitch: 40, dist: 30 }); for (let i = 0; i < 90; i++) await f(); __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f();
          const ev = __bh.renderer.ev(__bh.settings); Object.assign(__bh.settings, { autoExposure: false, exposure: ev }); return 1; })()`);
        const row: Record<string, number> = {};
        for (const [name, on] of [
          ["off", false],
          ["on", true],
          ["offAgain", false],
        ] as const) {
          await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.ship.skyBand4 = ${on}; __bh.refresh();
            for (let i = 0; i < 20; i++) await f(); return 1; })()`);
          const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
          const bytes = Buffer.from(x.data, "base64");
          await Bun.write(`${OUT}/skyband4-${utc.replace(":", "")}-${name}.png`, bytes);
          const img = readPng(new Uint8Array(bytes));
          let t = 0,
            n = 0;
          for (let y = Math.floor(0.3 * img.height); y < Math.floor(0.7 * img.height); y++)
            for (let x0 = Math.floor(0.3 * img.width); x0 < Math.floor(0.7 * img.width); x0++) {
              const i = (y * img.width + x0) * img.channels;
              t += 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
              n++;
            }
          row[name] = +(t / n).toFixed(2);
        }
        rows[utc] = row;
        console.log(`  J3-1 sky band 4 (${utc}): centre mean luminance ${JSON.stringify(row)}`);
      }
      out.skyband4 = rows;
      await app.js(
        `(() => { __bh.renderer.ship.skyBand4 = false; Object.assign(__bh.settings, { autoExposure: true, exposure: 0, shipMount: "cockpit" }); __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`,
      );
      for (const r of Object.values(rows)) expect(Math.abs(r.off! - r.offAgain!)).toBeLessThan(1);
      console.log(
        `  J3-1 sky band 4: the positive (19:40, the sky alone) on − off = ${(rows["19:40"]!.on! - rows["19:40"]!.off!).toFixed(2)}`,
      );
    },
    600_000,
  );

  // (PROBLEMES — the colour blotches on the sea at dusk, J0_PHASES=seadusk (SEADUSK_DATE another moment): 19:40 UTC, the view of their first sighting (the quarter from
  // behind, toward the west, neutral), frozen, the exposure held; as drawn, then one source cut at a time — the sea's probe (seaProbeOn),
  // the water's material (liteSkip 1), the sea's reflections compiled out (TUNE_GSKIP 20480), the clouds (earthClouds 0) —; shots, which
  // one takes them away)
  test.skipIf(!PHASES.includes("seadusk"))(
    "PROBLEMES: the sea's colour blotches at dusk — as drawn, then the probe, the water, the reflections, the clouds cut one at a time",
    async () => {
      await start("");
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
        __bh.game.setDate("${process.env.SEADUSK_DATE ?? "2026-07-10T19:40:00Z"}"); Object.assign(__bh.settings, { shipMount: "quarter", lookProfile: "neutral", dof: false, motionBlur: 0 });
        __bh.refresh(); for (let i = 0; i < 90; i++) await f(); __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f();
        const ev = __bh.renderer.ev(__bh.settings); Object.assign(__bh.settings, { autoExposure: false, exposure: ev }); return 1; })()`);
      const cases: [string, string, string][] = [
        ["asDrawn", "", ""],
        ["noSeaProbe", "__bh.renderer.seaProbeOn = false;", "__bh.renderer.seaProbeOn = true;"],
        ["noWater", "__bh.renderer.liteSkip = 1;", "__bh.renderer.liteSkip = 0;"],
        ["noReflections", "__bh.renderer.tune = { TUNE_GSKIP: 20480 };", "__bh.renderer.tune = {};"],
        ["noClouds", '__bh.game.set("earthClouds", 0);', `__bh.game.set("earthClouds", ${J0_SCENE.earthClouds});`],
        // (the sea's water by region — water-kd.ts, Kd490 at 1/12° — off: the clear ocean everywhere, TUNE_GSKIP 1024)
        ["noKd", "__bh.renderer.tune = { TUNE_GSKIP: 1024 };", "__bh.renderer.tune = {};"],
        // (the sea's other parts — J0's ablations: its displaced surface, the FFT waves, the foam's world map)
        ["noSeaSurface", "__bh.renderer.seaSurfaceOn = false;", "__bh.renderer.seaSurfaceOn = true;"],
        ["noFft", "__bh.settings.seaFft = false; __bh.touch();", "__bh.settings.seaFft = true; __bh.touch();"],
        ["noFoamWorld", "__bh.renderer.seaFoamWorldOn = false;", "__bh.renderer.seaFoamWorldOn = true;"],
      ];
      for (const [name, set, reset] of cases) {
        await app.js(`(() => { ${set} __bh.refresh(); return 1; })()`);
        await app.settled(120_000);
        await app.waitFor("__bh.renderer.compiling.size === 0", 120_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 45; i++) await f(); return 1; })()`,
        );
        const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
        await Bun.write(`${OUT}/seadusk-${name}.png`, Buffer.from(x.data, "base64"));
        console.log(`  sea dusk: ${name} shot`);
        await app.js(`(() => { ${reset} __bh.refresh(); return 1; })()`);
      }
      await app.js(
        `(() => { Object.assign(__bh.settings, { autoExposure: true, exposure: 0, shipMount: "cockpit" }); __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`,
      );
      expect(cases.length).toBe(9);
    },
    900_000,
  );

  // (PROBLEMES — the sea at dusk: what the craft's probe holds, J0_PHASES=probedump: at 15:30 and 19:40, the probe read back
  // (renderer.readShipProbe) and written as a PNG (each scaled by its own 99th percentile's luminance, sRGB) — the horizon's band looked at)
  test.skipIf(!PHASES.includes("probedump"))(
    "PROBLEMES: the craft's light probe as it stands — 15:30 and 19:40, written as images",
    async () => {
      await start("");
      // (PROBE_DATES="2026-12-15T22:00:00Z,…": other moments — the night's probe, PROBLEMES « le ciel de nuit de la sonde »)
      const dates = (process.env.PROBE_DATES ?? "2026-07-10T15:30:00Z,2026-07-10T19:40:00Z").split(",");
      for (const date of dates) {
        const utc = date.slice(0, 16).replace(/[-:T]/g, "");
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          __bh.game.setDate("${date}"); __bh.refresh(); for (let i = 0; i < 120; i++) await f(); __bh.freeze(true);
          for (let i = 0; i < 30; i++) await f(); return 1; })()`);
        for (const [what, call] of [
          ["probe", "__bh.renderer.readShipProbe()"],
          ["seasky", "__bh.renderer.readSeaSky()"],
        ] as const) {
          const p = await app.js<{ w: number; h: number; rgb: number[] } | null>(call);
          if (!p) {
            console.log(`  probe dump ${utc}: ${what} none`);
            continue;
          }
          const lum: number[] = [];
          for (let i = 0; i < p.w * p.h; i++) lum.push(0.2126 * p.rgb[3 * i]! + 0.7152 * p.rgb[3 * i + 1]! + 0.0722 * p.rgb[3 * i + 2]!);
          const sorted = lum.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
          const k = 1 / Math.max(sorted[Math.floor(0.99 * (sorted.length - 1))]!, 1e-30);
          const out8 = new Uint8Array(p.w * p.h * 3);
          const srgb = (x: number) => Math.round(255 * Math.min(1, x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
          for (let i = 0; i < p.w * p.h * 3; i++) out8[i] = srgb(Math.max(0, Number.isFinite(p.rgb[i]!) ? p.rgb[i]! * k : 0));
          await Bun.write(`${OUT}/${what}-${utc}.png`, writePng(p.w, p.h, out8));
          // (the probe's rows by elevation band, their mean luminance: the sky's top, near the horizon, the ground — raw units)
          if (what === "probe") {
            const rowLum = (y0: number, y1: number) => {
              let t = 0,
                n = 0;
              for (let y = Math.floor(y0 * p.h); y < Math.floor(y1 * p.h); y++)
                for (let x = 0; x < p.w; x++) {
                  t += lum[y * p.w + x]!;
                  n++;
                }
              return (t / n).toExponential(2);
            };
            console.log(
              `  probe dump ${utc}: rows (probe axes) top ${rowLum(0, 0.25)} · upper ${rowLum(0.25, 0.5)} · lower ${rowLum(0.5, 0.75)} · bottom ${rowLum(0.75, 1)}`,
            );
          }
          console.log(`  probe dump ${utc}: ${what} written (scale 1/${(1 / k).toExponential(2)})`);
        }
      }
      await app.js(`(() => { __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`);
      expect(true).toBe(true);
    },
    600_000,
  );

  // (PLAN-J3 J3-7 — the water lit by the ground's Sun, J0_PHASES=waterincident: 19:05 UTC, the quarter view toward the west, frozen, the
  // exposure held; the incident Sun on, off (renderer.incidentSunOn: the geometric for all), on again (the A/A); the sea's band (the
  // image's lower third) and the sky's (its upper third) compared — the sea must move with it now, the sky not (the air keeps the
  // geometric))
  test.skipIf(!PHASES.includes("waterincident"))(
    "J3-7: the water lit by the incident Sun — 19:05, on / off / on; the sea's band moves, the sky's not",
    async () => {
      await start("");
      await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
        __bh.game.setDate("2026-07-10T19:05:00Z"); Object.assign(__bh.settings, { shipMount: "quarter", lookProfile: "neutral", dof: false, motionBlur: 0 });
        __bh.refresh(); for (let i = 0; i < 90; i++) await f(); __bh.freeze(true); __bh.renderer.settleExposure(); for (let i = 0; i < 30; i++) await f();
        const ev = __bh.renderer.ev(__bh.settings); Object.assign(__bh.settings, { autoExposure: false, exposure: ev }); return 1; })()`);
      const shot = async (name: string, on: boolean) => {
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.incidentSunOn = ${on}; __bh.refresh();
          for (let i = 0; i < 60; i++) await f(); return 1; })()`);
        const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
        const bytes = Buffer.from(x.data, "base64");
        await Bun.write(`${OUT}/waterincident-${name}.png`, bytes);
        return readPng(new Uint8Array(bytes));
      };
      const band = (img: ReturnType<typeof readPng>, y0: number, y1: number) => {
        let t = 0,
          n = 0;
        for (let y = Math.floor(y0 * img.height); y < Math.floor(y1 * img.height); y++)
          for (let x0 = 0; x0 < Math.floor(0.4 * img.width); x0++) {
            const i = (y * img.width + x0) * img.channels;
            t += 0.2126 * img.data[i]! + 0.7152 * img.data[i + 1]! + 0.0722 * img.data[i + 2]!;
            n++;
          }
        return +(t / n).toFixed(2);
      };
      const on = await shot("on", true);
      const off = await shot("off", false);
      const onAgain = await shot("on-again", true);
      const row = {
        seaOn: band(on, 0.62, 0.95),
        seaOff: band(off, 0.62, 0.95),
        seaOnAgain: band(onAgain, 0.62, 0.95),
        skyOn: band(on, 0.1, 0.4),
        skyOff: band(off, 0.1, 0.4),
      };
      console.log(`  J3-7 the water and the incident Sun (the left 40 %): ${JSON.stringify(row)}`);
      out.waterincident = row;
      await app.js(
        `(() => { __bh.renderer.incidentSunOn = true; Object.assign(__bh.settings, { autoExposure: true, exposure: 0, shipMount: "cockpit" }); __bh.freeze(false); __bh.game.setDate("${J0_SCENE.date}"); return 1; })()`,
      );
      expect(Math.abs(row.seaOn - row.seaOnAgain)).toBeLessThan(1);
    },
    600_000,
  );

  // (PROBLEMES — « le traceur au large de Big Sur : une nappe sombre » —, J0_PHASES=tracedview (J0_START off Big Sur, TRACED_DATE): the
  // traced pipeline for the near Earth, the cockpit's view after the data are in, the exposure settled; a shot in the raster for the
  // comparison)
  test.skipIf(!PHASES.includes("tracedview"))(
    "PROBLEMES: a view in the traced pipeline beside the raster's — the sea's far sheet looked at",
    async () => {
      await start("");
      for (const pipe of ["raster", "trace"]) {
        await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
          ${process.env.TRACED_DATE ? `__bh.game.setDate("${process.env.TRACED_DATE}");` : ""}
          __bh.game.set("earthPipeline", "${pipe}"); Object.assign(__bh.settings, { shipMount: "cockpit", lookProfile: "neutral" }); __bh.refresh();
          for (let i = 0; i < 60; i++) await f(); __bh.freeze(true); return 1; })()`);
        await app.settled(180_000);
        await app.js(
          `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.settleExposure(); for (let i = 0; i < 60; i++) await f(); return 1; })()`,
        );
        const x = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
        await Bun.write(`${OUT}/tracedview-${pipe}.png`, Buffer.from(x.data, "base64"));
        console.log(`  traced view: ${pipe} shot (${await app.js<string>("__bh.renderer.earthPipelineNow(__bh.settings)")})`);
        // (and aside — the around mount, either side, a little down: the sea in the frame whichever way it lies)
        for (const yaw of [90, -90]) {
          await app.js(`(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.freeze(false);
            __bh.settings.shipMount = "around"; __bh.refresh(); for (let i = 0; i < 20; i++) await f();
            Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: 8, dist: 60 }); for (let i = 0; i < 90; i++) await f(); __bh.freeze(true); return 1; })()`);
          await app.settled(180_000);
          await app.js(
            `(async () => { const f = () => new Promise((q) => requestAnimationFrame(q)); __bh.renderer.settleExposure(); for (let i = 0; i < 45; i++) await f(); return 1; })()`,
          );
          const y = (await app.cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
          await Bun.write(`${OUT}/tracedview-${pipe}-aside${yaw}.png`, Buffer.from(y.data, "base64"));
        }
      }
      await app.js(`(() => { __bh.game.set("earthPipeline", "raster"); __bh.freeze(false); return 1; })()`);
      expect(true).toBe(true);
    },
    900_000,
  );

  test.skipIf(!PHASES.includes("sustained"))(
    "the same flight again, the machine as long play leaves it",
    () => measureFlight("sustained"),
    300_000,
  );
});
