import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { sceneryReady } from "./lib/plan-views";
import { readPng } from "./lib/png";

// Q6 — the image in motion, measured the same for every mode (docs/PLAN-REFRACTION-HORIZONS.md Q6: "the sharpness in motion
// measured at the first instant and after accumulation"). raster-motion flew in real time: a slower mode went farther a frame
// (its turn 14 to 37 px a frame from one run to the next), its PSNR not comparable. Here the simulation is frozen and stepped
// 1/30 s before each frame drawn: every mode sees the same motion a frame.
// The F-35 from its cockpit, the scenery high; before each flight everything in — the kernels compiled (nothing compiling), the
// tiles (none pending for 3 s), the scenery whole —, the aircraft steady (autopilot holding height and heading, autothrottle its
// speed, gear down; STEADY frames flown first); the clock stopped; per mode: FRAMES frames flown at 1/30 s each (a turn of TURN°
// if asked) — their GPU time —; the last held (no step, the history as it was) and captured:
// the **first instant**; then STILL frames drawn with the camera still and captured: **after accumulation**; then its reference,
// refined at the canvas's full scale (every mode starts from the place's saved state: the same flight). Each against its
// reference, in the view through the canopy (BOX): PSNR and the sharpness ratio (the
// Laplacian's energy over the reference's — 1: as sharp; under: softer; over: noisier or aliased).
// The HUD off; each mode's own reference, made at once after its still shot (the view exactly the same).
// PLACES=tarifa-low,alps (strait: the sea); MODES (below) — e.g. spatial75q,taau75q,native100q, a renderer lever after "+" (EXTRAS:
// taau75q+disocc — PLAN-J2 J2-5's disocclusion; off in the plain modes); FRAMES (90), TURN (0: straight), STEADY (60 frames before), SPEED (140 m/s), STILL (30).
// Output: remote-results/motion-quality/<place>-<mode>[-still|-ref].png, motion-quality.json (MQ_OUT).
// Done when: every place × mode measured (the tiles 120 s at most, the reference 90 s, what is missing said), no GPU error.
// Duration: ~3 min a place × mode (its reference 90 s; the first one waits for the tiles).

const OUT = process.env.MQ_OUT ?? "remote-results/motion-quality";
const PLACES: Record<string, string> = {
  "tarifa-low": `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0.1);
    __bh.game.flyAt(36.08, -5.6, 700, 20, 240);`,
  // (the sea's waves moving under the turn — the history's ghosts: the strait of Gibraltar, 300 m up, heading west)
  strait: `__bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(35.96, -5.45, 300, 250, 200);`,
  alps: `__bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(45.85, 6.75, 2500, 110, 200);`,
};
const RASTER = `__bh.settings.earthPipeline = "raster"; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.rasterJitter = "gauss";`;
const MODES: Record<string, string> = {
  // (the default path in motion: 75 % of the canvas, one pixel in four shaded, the history at that scale, the display's upscale)
  spatial75q: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = false; __bh.forceScale(0.75);`,
  // (the same, the temporal upsampling after the native history — post.wgsl taau)
  taau75q: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = true; __bh.renderer.taauSigma = 0.5; __bh.renderer.taauSigmaWater = 0.7; __bh.forceScale(0.75);`,
  // (I4: the same at a lower scale — what the TAAU keeps of the image when the governor would go below 75 %)
  taau625q: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = true; __bh.renderer.taauSigma = 0.5; __bh.renderer.taauSigmaWater = 0.7; __bh.forceScale(0.625);`,
  taau50q: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = true; __bh.renderer.taauSigma = 0.5; __bh.renderer.taauSigmaWater = 0.7; __bh.forceScale(0.5);`,
  // (the water's kernel as the land's — before Q6d)
  taau75qw5: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = true; __bh.renderer.taauSigma = 0.5; __bh.renderer.taauSigmaWater = 0.5; __bh.forceScale(0.75);`,
  // (the upsampling's samples' kernel σ [output px] — renderer.taauSigma, 0.5 by default: wider filters the sea's glints more)
  taau75qs6: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = true; __bh.renderer.taauSigma = 0.6; __bh.forceScale(0.75);`,
  taau75qs7: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = true; __bh.renderer.taauSigma = 0.7; __bh.forceScale(0.75);`,
  // (every pixel at the canvas's scale, one in four shaded: what a reconstruction from 75 % aims at)
  native100q: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = false; __bh.forceScale(1);`,
  spatial75e: `${RASTER} __bh.settings.earthRasterShading = "eighth"; __bh.renderer.taauOn = false; __bh.forceScale(0.75);`,
  taau75e: `${RASTER} __bh.settings.earthRasterShading = "eighth"; __bh.renderer.taauOn = true; __bh.forceScale(0.75);`,
};
// (the image's own: the Neutral profile — Q6g's Camera profile, auto in flight, laid a new grain each frame over the measure — and no
// motion blur)
const DETAIL = `Object.assign(__bh.settings, { earthScenery: "high", detailReach: "veryFar", earthSceneryShadows: true, earthSurface: "satellite", lookProfile: "neutral", motionBlur: 0 });`;
// (the HUD off — the helmet's symbology is drawn into the image in the cockpit: its lines, alike in every image, drowned the
// ground's measure; LOOK: the look's pitch — it eases there: a look asked moved the view between the shots, 0 by default)
const CLEAN = `Object.assign(__bh.settings, { hudJet: "off", hudHorizon: false, hudHeading: false, hudBank: false, hudMarkers: false,
  hudEdge: false, hudAoA: false, hudEnergy: false, hudDirector: false, hudPath: false, hudFuture: false, hudImpact: false, hudRunway: false });`;
const LOOK = Number(process.env.LOOK ?? 0);
// (a mode's renderer levers after a "+" — `taau75q+disocc`: PLAN-J2 J2-5's disocclusion on —; every lever named here set off
// otherwise, the same mode measured with and without in one run)
const EXTRAS: Record<string, [string, string]> = {
  disocc: ["__bh.renderer.disocclusionOn = true;", "__bh.renderer.disocclusionOn = false;"],
  // (its positive control: a tolerance of −10 — nearly every moving pixel taken as uncovered, no history: the lever acts)
  disoccall: ["__bh.renderer.disocclusionOn = true; __bh.renderer.disocclusionTol = -10;", "__bh.renderer.disocclusionTol = 0.03;"],
  // (PLAN-J2 J2-6: one long history — the native temporal pass's short while the upsampling runs)
  single: ["__bh.renderer.singleHistory = true;", "__bh.renderer.singleHistory = false;"],
  // (J2-6: a change of scale in flight — 0.625 forced 8 frames before the first instant's shot: between the two scales' own PSNR if
  // smooth, under both if it pulses)
  drop: ["globalThis.__mqDrop = 8;", "globalThis.__mqDrop = 0;"],
};
const modeExtras = (md: string) => {
  const on = new Set(md.split("+").slice(1));
  return Object.entries(EXTRAS)
    .map(([k, [yes, no]]) => (on.has(k) ? yes : no))
    .join(" ");
};
const places = (process.env.PLACES ?? "tarifa-low,alps").split(",");
const modes = (process.env.MODES ?? "spatial75q,taau75q,native100q").split(",");
const FRAMES = Number(process.env.FRAMES ?? 90);
const TURN = Number(process.env.TURN ?? 0);
const STEADY = Number(process.env.STEADY ?? 60);
// (the autothrottle's speed [m/s], gear down)
const SPEED = Number(process.env.SPEED ?? 140);
const STILL = Number(process.env.STILL ?? 30);

type Png = ReturnType<typeof readPng>;
const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
// (the view through the canopy — not the cockpit's displays, their radar sweeping, nor the HUD's panels: a box of the 1600 × 1000
// image, x 380–1220, y 120–700)
const BOX = { x0: 380, x1: 1220, y0: 120, y1: 700 };
function psnr(a: Png, b: Png) {
  let sq = 0,
    n = 0;
  for (let y = BOX.y0; y < BOX.y1; y++)
    for (let x = BOX.x0; x < BOX.x1; x++)
      for (let c = 0; c < 3; c++) {
        const i = (y * a.width + x) * a.channels + c;
        const d = a.data[i]! - b.data[i]!;
        sq += d * d;
        n++;
      }
  return +(10 * Math.log10((255 * 255) / Math.max(sq / n, 1e-9))).toFixed(2);
}
/** the Laplacian's mean energy of the luminance (in the box) */
function sharpness(a: Png) {
  const L = (x: number, y: number) => {
    const i = (y * a.width + x) * a.channels;
    return 0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!;
  };
  let e = 0,
    n = 0;
  for (let y = BOX.y0; y < BOX.y1; y++)
    for (let x = BOX.x0; x < BOX.x1; x++) {
      const l = 4 * L(x, y) - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1);
      e += l * l;
      n++;
    }
  return e / n;
}

describe.skipIf(!E2E)("Q6: the image in motion, the same motion for every mode", () => {
  let app: App;
  const rows: Record<string, unknown>[] = [];
  // (each place's saved start, made once)
  const saves = new Map<string, string>();
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    // (MQ_CHROME_PROFILE: one Chrome profile kept across runs — its HTTP cache serving the tiles once warmed: none still loading)
    app = await App.boot({
      width: 1600,
      height: 1000,
      lang: "fr",
      hash: "scene=game:artemis",
      tiles: true,
      profile: process.env.MQ_CHROME_PROFILE || undefined,
    });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(async () => {
    await Bun.write(`${OUT}/motion-quality.json`, JSON.stringify(rows, null, 2));
    await app?.close();
    stopServer();
  });

  for (const pl of places)
    for (const md of modes)
      test(`${pl}: ${md}`, async () => {
        // (the same start for every mode: the place's state saved once — the craft, its autopilot — and loaded again for each,
        // the clock stopped — the simulation moves only by step —, the tiles in)
        if (!saves.has(pl)) {
          // (placed, frozen while the place's tiles come, placed again: its height over the ground — flyAt's is over the ground
          // known when called — reckoned on the relief in, the same at every launch — 4 581 against 2 439 m before; then saved)
          await app.js(`(() => { __bh.freeze(false); __bh.game.quality("realtime");
            Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 64 });
            ${PLACES[pl]} __bh.settings.shipMount = "cockpit"; ${DETAIL} __bh.freeze(true); return 1; })()`);
          // (the windows set and filled: 3 s with nothing pending, frames drawn, a z 12 level at least — pending is 0 at once after
          // flyAt, before its windows are)
          const placed = await app.js<{ ok: boolean; finest: number }>(`(async () => {
            const t = __bh.renderer.earthTiles, frame = () => new Promise((q) => requestAnimationFrame(q));
            const t0 = performance.now(); let calm = 0;
            while (performance.now() - t0 < 120000) {
              const ok = t.pending === 0 && t.finest >= 12; calm = ok ? calm || performance.now() : 0;
              if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
            return { ok: calm > 0, finest: t.finest }; })()`);
          if (!placed.ok) console.log(`  ${pl}: the place's relief not in after 120 s (finest z ${placed.finest}) — placed anyway`);
          saves.set(
            pl,
            await app.js<string>(`(() => { __bh.freeze(false); ${PLACES[pl]} __bh.freeze(true);
              return JSON.stringify(__bh.game.snapshot("motion-quality ${pl}")); })()`),
          );
        }
        await app.js(`(() => { __bh.freeze(false); __bh.game.importSave(${JSON.stringify(saves.get(pl))}, false);
          __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 64 });
          __bh.settings.shipMount = "cockpit"; ${DETAIL} ${MODES[md.split("+")[0]!]} ${CLEAN} ${modeExtras(md)} return 1; })()`);
        // (the aircraft steady: the save applied over a few frames, then the gear down, the autopilot holding its height and
        // heading, the autothrottle SPEED — engaged again until they hold: jetToggle refuses until the craft flies as a plane)
        const ap = await app.js<{ ap: boolean; athr: boolean; note: string }>(`(async () => {
          const c = __bh.camera, frame = () => new Promise((q) => requestAnimationFrame(q));
          let note = "";
          for (let i = 0; i < 60; i++) {
            await frame();
            __bh.settings.autoGear = false; c.gearDown = true; c.gearExt = 1; c.gearInit = true;
            if (c.jetModes.alt === null) note = c.jetToggle("ap");
            if (c.jetModes.spd === null) note = c.jetToggle("athr");
            if (c.jetModes.alt !== null && c.jetModes.spd !== null && i >= 10) break;
          }
          const g = c.geoNow(); if (g) { c.jetModes.alt = g.alt; c.jetModes.hdg = g.track; }
          c.jetModes.spd = ${SPEED};
          __bh.freeze(true); __bh.refresh(); c.viewReset(); c.setLook(0, ${LOOK});
          return { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null, note }; })()`);
        if (!ap.ap || !ap.athr) console.log(`  ${pl} ${md}: the autopilot ${ap.ap} / autothrottle ${ap.athr} — ${ap.note}`);
        // (everything in before the flight: the kernels compiled — the scene's variant, nothing compiling —, the tiles in for 3 s, the
        // scenery whole; said when not)
        await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
        await app.settled(120_000);
        const calm = await app.js<{
          ok: boolean;
          pending: number;
        }>(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          const t0 = performance.now(); let calm = 0;
          while (performance.now() - t0 < 120000) {
            const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
            if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
          return { ok: calm > 0, pending: r.earthTiles.pending }; })()`);
        if (!calm.ok) console.log(`  ${pl} ${md}: the tiles still ${calm.pending} pending after 120 s — measured anyway`);
        const sc = await sceneryReady(app, 60_000);
        if (!sc.ready) console.log(`  ${pl} ${md}: the scenery not whole after 60 s (${sc.status}) — measured anyway`);
        await app.settled(60_000);
        // (the aircraft steadied: STEADY frames flown straight at 1/30 s before the measured ones — the autopilot's holds settled)
        await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
          for (let i = 0; i < ${STEADY}; i++) { __bh.step(1 / 30); __bh.touch(); const last = r.lastDoneAt; let k = 0;
            while (r.lastDoneAt === last && k++ < 120) await frame(); } return 1; })()`);
        // (flown: FRAMES frames each after a step of 1/30 s — the same motion a frame whatever the mode's speed —, straight unless
        // TURN° asked)
        const fl = await app.js<{
          gpuMs: number;
          turnPx: number;
          groundPx: number;
          passes: { temporal: number; taau: number };
          state: Record<string, number | boolean>;
        }>(`(async () => {
          const r = __bh.renderer, c = __bh.camera, frame = () => new Promise((q) => requestAnimationFrame(q));
          if (${TURN} !== 0) c.jetModes.hdg = (c.geoNow()?.track ?? 0) + ${TURN} * Math.PI / 180;
          // (the aircraft's state as the measure starts: the runs comparable only if it is the same)
          const g0 = c.geoNow();
          const state = { alt: Math.round(g0?.alt ?? 0), gs: +(g0?.gs ?? 0).toFixed(1), vs: +(g0?.vs ?? 0).toFixed(2), track: +((g0?.track ?? 0) * 180 / Math.PI).toFixed(2), gear: !!c.gearDown, ap: c.jetModes.alt !== null, holdAlt: Math.round(c.jetModes.alt ?? 0) };
          r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
          let gpu = 0, turn = 0, ground = 0;
          for (let i = 0; i < ${FRAMES}; i++) {
            if (globalThis.__mqDrop && i === ${FRAMES} - globalThis.__mqDrop) __bh.forceScale(0.625);
            __bh.step(1 / 30); __bh.touch();
            const last = r.lastDoneAt; let k = 0;
            while (r.lastDoneAt === last && k++ < 120) await frame();
            gpu += r.lastGpuMs; turn += r.imageTurnPx ?? 0; ground += r.imageGroundPx ?? 0;
          }
          // (the temporal passes' own GPU time over the flight — the native history, the upsampling —, the profiler reset as it starts;
          // the eight costliest passes)
          const T = r.prof.table(), pass = (l) => +(T.find((x) => x.label === l)?.ms ?? 0).toFixed(2);
          const passes = { temporal: pass("temporal"), taau: pass("taau"), top: T.slice(0, 8).map((x) => [x.label, +x.ms.toFixed(2)]) };
          r.prof.enabled = false;
          return { gpuMs: +(gpu / ${FRAMES}).toFixed(1), turnPx: +(turn / ${FRAMES}).toFixed(1), groundPx: +(ground / ${FRAMES}).toFixed(1), passes, state }; })()`);
        // (the first instant: the last frame flown, held — no step, no refinement —, the page's panels and the HUD's canvas hidden:
        // the view alone — the HUD's lines, alike in every image, drowned the Laplacian's measure of the ground)
        await app.js(
          `(() => { __bh.settings.targetSpp = 0; document.body.classList.add("hide-ui"); document.getElementById("overlay").style.visibility = "hidden"; return 1; })()`,
        );
        const fMove = `${OUT}/${pl}-${md}.png`;
        await app.shot(fMove);
        // (after accumulation: STILL realtime frames with the camera still — the history converging at the mode's scale)
        await app.js(
          `(async () => { for (let i = 0; i < ${STILL}; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`,
        );
        const fStill = `${OUT}/${pl}-${md}-still.png`;
        await app.shot(fStill);
        // (the reference: refined at the canvas's full scale, at once after the still shot — the view exactly the same: a reference
        // made once a place drifted from the later modes' views, a look easing, 50 px)
        const fRef = `${OUT}/${pl}-${md}-ref.png`;
        let converged = false;
        await app.js(
          `(() => { __bh.forceScale(null); __bh.renderer.taauOn = false; __bh.settings.targetSpp = 64; __bh.touch(); return 1; })()`,
        );
        for (let i = 0; i < 180 && !converged; i++) {
          await Bun.sleep(500);
          converged = await app.js<boolean>(`__bh.renderer.lastPhase === "converged"`);
        }
        if (!converged) console.log(`  ${pl} ${md}: the reference not converged after 90 s — compared anyway`);
        await app.shot(fRef);
        const [m, s, r] = [png(fMove), png(fStill), png(fRef)];
        const sr = sharpness(r);
        const row = {
          place: pl,
          mode: md,
          ...fl,
          psnrMoving: psnr(m, r),
          psnrStill: psnr(s, r),
          sharpMoving: +(sharpness(m) / sr).toFixed(3),
          sharpStill: +(sharpness(s) / sr).toFixed(3),
          converged,
          gpuErrors: await app.js<number>(`__bh.renderer.gpuErrors`),
        };
        rows.push(row);
        console.log(JSON.stringify(row));
        await app.js(
          `(() => { __bh.renderer.taauOn = true; __bh.renderer.taauSigma = 0.5; __bh.renderer.taauSigmaWater = 0.7; __bh.forceScale(null); __bh.freeze(false); document.body.classList.remove("hide-ui"); document.getElementById("overlay").style.visibility = ""; return 1; })()`,
        );
        expect(row.gpuErrors).toBe(0);
      }, 600_000);
});
