import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED, J0_SCENE, intervals } from "./lib/j0-scene";
import {
  keepSceneJs,
  LEAK_VIEWS,
  leakCompareJs,
  SEAM_JS,
  SENTINEL_A,
  SENTINEL_B,
  eventStep,
  type SharpRowT,
  scaleDips,
  stageSparklesJs,
} from "./lib/j2-probes";

// PLAN-J2 J2-0 — the instruments on the code as it is (docs/PLAN-J2-PAGES-RECONSTRUCTION.md §3 J2-0, §4, §5): the J2 reference fiche's
// numbers. Two phases (J2_PHASES=leak,flight, default both):
//   leak — at each view of LEAK_VIEWS (low over France, grazing: every imagery level's window edge in the image, their coarser mips,
//     the anisotropic filter's long footprints), the craft frozen, everything in and the still image converged: the seams between
//     the raster's levels read (C0-12, ≤ 0.25 px); then the leak probe (earthTiles.leakProbe): the windows held, every slot outside
//     their published rectangles — the wrap of a whole window, the slots not published — filled with a sentinel colour, magenta
//     then green, the image converged and read each time (renderer.sceneColor), green twice (the control: the noise); the leak is
//     the magenta signature of magenta − green (lib/j2-probes.ts leakCompareJs); its map and the shots written.
//   flight — J0's scene (the F-35, cockpit, 500 m over the Rade d'Hyères, autopilot, gear down — E2E-VOLS §5.4): the tiles'
//     publication counted from the placement (earthTiles.pubProbe: bytes, writes, submissions, mips, the page's ms, per image);
//     (B) straight over the sea, the reconstruction's stages read six times (renderer.stageProbe, sceneStages: the image entering
//     the temporal pass, its history, the temporal upsampling's) and the sea's white points counted in each; (A) a flight of
//     ~56 s with three pauses of 4 s (the clock frozen: the camera held — refined at scale 1 where the renderer does so; in raster
//     flight outside the photo mode the held view stays a realtime one, rasterHold), a turn to 340° between, then the scale forced
//     to 0.625 and let go (forceScale) — every change of scale the flight makes or is given: the sharpness of every image (renderer.sharpProbe, the Laplacian's
//     energy of the scene's colour through the canopy), the dips at each change of scale (scaleDips), each pause's moving image
//     against its refined one; the frames' GPU time.
// Motion blur off (the reconstruction's sharpness, not the shutter's). J2_OUT (remote-results/j2/<machine>; in an A/B of
// scripts/ab-e2e.ts its <AB_SIDE><AB_RUN> under it), J2_MACHINE.
// Not a pass/fail on the numbers: the fiche is written from j2.json (docs/progress/j2/). It fails on a GPU error, a craft not placed.
// Duration: ~4 min for leak (2 views), ~3 min for flight, on kerr-mini (cold boot included).
// Done when: each view's seams and leak read and its leak map written, the flight's stages, sharpness and publication logged, j2.json written, no GPU error.

const MACHINE = process.env.J2_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
// (an A/B by scripts/ab-e2e.ts — J2, the peaks —: each side's run apart, <out>/<AB_SIDE><AB_RUN>)
const SIDE = process.env.AB_SIDE ? `${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : "";
const OUT = `${process.env.J2_OUT ?? `remote-results/j2/${MACHINE}`}${SIDE ? `/${SIDE}` : ""}`;
const PHASES = (process.env.J2_PHASES ?? "leak,flight").split(",");
const VIEWS = (process.env.J2_VIEWS ?? Object.keys(LEAK_VIEWS).join(",")).split(",");
const W = 1920,
  H = 1080;
const out: Record<string, unknown> = { machine: MACHINE, output: `${W}×${H}`, startedAt: new Date().toISOString() };

async function thermal() {
  const r = await $`bun scripts/thermal.ts status --json`.quiet().nothrow();
  try {
    return JSON.parse(r.stdout.toString());
  } catch {
    return { unavailable: r.stdout.toString().trim() || r.stderr.toString().trim() };
  }
}
/** the HUD off and the page's panels hidden (the shots: the view alone) */
const CLEAN = `Object.assign(__bh.settings, { hudJet: "off", hudHorizon: false, hudHeading: false, hudBank: false, hudMarkers: false,
  hudEdge: false, hudAoA: false, hudEnergy: false, hudDirector: false, hudPath: false, hudFuture: false, hudImpact: false, hudRunway: false });`;
/** in the page: the scene's colour tone-mapped (x / (1 + x), sRGB) to a PNG, base64 — a still of the radiance the probes read */
const scenePngJs = (name: string) => `(async () => {
  const c = globalThis.__j2?.[${JSON.stringify(name)}]; if (!c) return null;
  const W = c.width, H = c.height, d = c.data, e = c.exposure, img = new Uint8ClampedArray(W * H * 4);
  const s = (v) => { const x = Math.max(0, v * e); const t = x / (1 + x); return 255 * (t <= 0.0031308 ? 12.92 * t : 1.055 * Math.pow(t, 1 / 2.4) - 0.055); };
  for (let i = 0; i < W * H * 4; i += 4) { img[i] = s(d[i]); img[i + 1] = s(d[i + 1]); img[i + 2] = s(d[i + 2]); img[i + 3] = 255; }
  const cv = new OffscreenCanvas(W, H); cv.getContext("2d").putImageData(new ImageData(img, W, H), 0, 0);
  const b = new Uint8Array(await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer());
  let bin = ""; for (let i = 0; i < b.length; i += 32768) bin += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(bin); })()`;

describe.skipIf(!E2E)("J2-0: the leak, the seams, the sharpness and the publication on the code as it is", () => {
  let app: App;
  let profile = "{}";
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    out.thermalBefore = await thermal();
    app = await App.boot({ width: W, height: H, lang: "fr", hash: "scene=game:artemis", tiles: true });
    // (the publication counted from the boot: the cold load's own)
    await app.js(`(() => { __bh.renderer.earthTiles.pubProbe = true; Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
    // (the profile's own, put back before the flight: the leak's views change them)
    profile =
      await app.js<string>(`(() => { const s = __bh.settings; return JSON.stringify({ quality: s.quality, dynamicResolution: s.dynamicResolution,
      animate: s.animate, targetSpp: s.targetSpp, lookProfile: s.lookProfile, motionBlur: s.motionBlur }); })()`);
    out.profile = JSON.parse(profile);
    out.adapter = await app.js(`__bh.game.perf({ gpu: false }).graphics`);
  }, 300_000);
  afterAll(async () => {
    out.thermalAfter = await thermal();
    out.finishedAt = new Date().toISOString();
    await Bun.write(`${OUT}/j2.json`, JSON.stringify(out, null, 1));
    console.log(`  J2: ${OUT}/j2.json`);
    await app?.close();
    stopServer();
  });

  /** placed (the clock running: the cockpit mount applied — E2E-VOLS §7), then frozen; the relief in for 3 s; placed again on it */
  async function place(set: string, label: string) {
    const go = `(async () => { __bh.freeze(false); ${set} __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
      for (let i = 0; i < 40; i++) await new Promise((q) => requestAnimationFrame(q)); __bh.freeze(true); return __bh.settings.shipMount; })()`;
    await app.js(go);
    await app.settled(180_000);
    const relief = await app.js<{ ok: boolean; finest: number; pending: number }>(`(async () => {
      const t = __bh.renderer.earthTiles, frame = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < 60000) {
        const ok = t.pending === 0 && t.finest >= 12; calm = ok ? calm || performance.now() : 0;
        if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
      return { ok: calm > 0, finest: t.finest, pending: t.pending }; })()`);
    if (!relief.ok)
      console.log(`  ${label}: the relief not in after 60 s (finest z ${relief.finest}, ${relief.pending} pending) — going on`);
    const mount = await app.js<string>(go);
    await app.dataSettled(`J2 ${label}`, { maxMs: 90_000 }).catch((e) => console.log(`  ${label}: ${String(e).slice(0, 160)}`));
    await app.settled(60_000);
    return { relief, mount };
  }
  /** the still image settled: in raster flight a held view stays a realtime one (renderer.rasterHold — the tracer refines in the photo
   *  mode alone), its history averaging the frames (rasterHeldAlpha): 120 images drawn; elsewhere the refinement converged — 60 s at
   *  most, said when not */
  async function converged(label: string) {
    const r = await app.js<{ ok: boolean; ms: number; phase: string; images: number }>(`(async () => {
      const R = __bh.renderer, t0 = performance.now(), frame = () => new Promise((q) => requestAnimationFrame(q));
      const n0 = R.completedFrames ?? 0;
      for (let i = 0; i < 4; i++) { __bh.touch(); await frame(); }
      while (performance.now() - t0 < 60000) {
        if (R.lastPhase === "converged") break;
        if (R.lastPhase === "realtime" && (R.completedFrames ?? 0) - n0 >= 120) break;
        __bh.touch(); await frame(); }
      for (let i = 0; i < 3; i++) { __bh.touch(); await frame(); }
      const images = (R.completedFrames ?? 0) - n0;
      return { ok: R.lastPhase === "converged" || images >= 120, ms: Math.round(performance.now() - t0), phase: R.lastPhase, images }; })()`);
    if (!r.ok) console.log(`  ${label}: not settled after 60 s (${r.phase}, ${r.images} images) — read anyway`);
    return r;
  }
  const writeB64 = (f: string, b64: string | null) => (b64 ? Bun.write(f, Buffer.from(b64, "base64")) : Promise.resolve(0));

  if (PHASES.includes("leak"))
    for (const v of VIEWS)
      test(`leak and seams: ${v}`, async () => {
        const view = LEAK_VIEWS[v];
        if (!view) throw new Error(`J2_VIEWS: ${v} unknown`);
        const [lat, lon, agl, hdg, spd] = view.at;
        const placed = await place(
          `__bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 64, motionBlur: 0, lookProfile: "neutral" });
          __bh.game.setDate("${view.date}"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${spd}); ${CLEAN}`,
          v,
        );
        await app.js(`(() => { document.body.classList.add("hide-ui"); return 1; })()`);
        const row: Record<string, unknown> = { view: v, what: view.what, placed };
        row.converged0 = await converged(`${v} reference`);
        row.seams = await app.js(SEAM_JS);
        console.log(`  ${v} seams: ${JSON.stringify(row.seams)}`);
        await app.shot(`${OUT}/leak-${v}-reference.png`);
        // (the probe: magenta, green, green again — each converged and read)
        const held = await app.js<{ slots: number; levels: number }>(
          `(() => __bh.renderer.earthTiles.leakProbe(${JSON.stringify(SENTINEL_A)}))()`,
        );
        row.held = held;
        row.convergedA = await converged(`${v} sentinel A`);
        row.readA = await app.js(keepSceneJs("a"));
        await app.shot(`${OUT}/leak-${v}-sentinel-a.png`);
        await writeB64(`${OUT}/leak-${v}-sentinel-a-scene.png`, await app.js<string | null>(scenePngJs("a")));
        await app.js(`(() => __bh.renderer.earthTiles.leakProbe(${JSON.stringify(SENTINEL_B)}))()`);
        row.convergedB = await converged(`${v} sentinel B`);
        row.readB = await app.js(keepSceneJs("b"));
        await app.js(`(() => __bh.renderer.earthTiles.leakProbe(${JSON.stringify(SENTINEL_B)}))()`);
        row.convergedC = await converged(`${v} sentinel B again`);
        row.readC = await app.js(keepSceneJs("c"));
        const cmp = await app.js<Record<string, unknown> & { png?: string }>(leakCompareJs("a", "b", "c"));
        await writeB64(`${OUT}/leak-${v}-map.png`, cmp.png ?? null);
        delete cmp.png;
        row.leak = cmp;
        console.log(`  ${v} leak: ${JSON.stringify(cmp)}`);
        // (the positive control: the published slots painted magenta too — the sentinel read directly wherever the imagery is; the
        // same measure against green: what the probe sees of a leak of 100 % — its proof that the sentinel reaches the image)
        await app.js(`(() => __bh.renderer.earthTiles.leakProbe(${JSON.stringify(SENTINEL_A)}, { control: true }))()`);
        row.convergedP = await converged(`${v} positive control`);
        row.readP = await app.js(keepSceneJs("p"));
        await writeB64(`${OUT}/leak-${v}-control-scene.png`, await app.js<string | null>(scenePngJs("p")));
        const pos = await app.js<Record<string, unknown> & { png?: string }>(leakCompareJs("p", "b", "c"));
        delete pos.png;
        row.positive = pos;
        console.log(`  ${v} positive control: ${JSON.stringify(pos)}`);
        // (let go: the slots' tiles asked again; the page's kept images dropped)
        await app.js(
          `(() => { __bh.renderer.earthTiles.leakProbe(null); globalThis.__j2 = {}; document.body.classList.remove("hide-ui"); return 1; })()`,
        );
        row.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
        (out.leak ??= []) as unknown[];
        (out.leak as unknown[]).push(row);
        expect(held.slots).toBeGreaterThan(0);
        expect(row.gpuErrors).toBe(0);
      }, 600_000);

  if (PHASES.includes("flight"))
    test("flight: stages, sharpness, publication (J0's scene)", async () => {
      const tPlace = await app.js<number>(`performance.now()`);
      const [lat, lon, agl, hdg, spd] = J0_SCENE.start;
      const placed = await place(
        `const pr = ${profile}; __bh.game.quality(pr.quality); Object.assign(__bh.settings, pr, ${J0_FIXED}, { motionBlur: 0 }); __bh.game.setDate("${J0_SCENE.date}"); __bh.game.set("weather", "${J0_SCENE.weather}");
        __bh.game.set("earthClouds", ${J0_SCENE.earthClouds}); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${spd});`,
        "J0",
      );
      const load = await app.js(`__bh.renderer.earthTiles.pubStats(${tPlace})`);
      // (the autopilot, the autothrottle and the gear held until they hold — the stable flight's protocol)
      const ap = await app.js<{ ap: boolean; athr: boolean }>(`(async () => { __bh.freeze(false);
        const c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
        for (let i = 0; i < 90; i++) { await f(); __bh.settings.autoGear = false; c.gearDown = true; c.gearExt = 1; c.gearInit = true;
          if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
          if (c.jetModes.alt !== null && c.jetModes.spd !== null && i > 10) break; }
        const g = c.geoNow(); if (g && c.jetModes.alt !== null) { c.jetModes.alt = g.alt; c.jetModes.hdg = ${hdg} * Math.PI / 180; }
        c.jetModes.spd = ${spd}; return { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null }; })()`);
      if (!ap.ap || !ap.athr) throw new Error(`the autopilot ${ap.ap} / autothrottle ${ap.athr} not engaged`);
      // (60 images straight: settled)
      await app.js(`new Promise((q) => { let n = 0; const f = () => (++n > 60 ? q(1) : requestAnimationFrame(f)); f(); })`);
      const state0 = await app.js(
        `(() => { const c = __bh.camera, g = c.geoNow(); return { alt: Math.round(g?.alt ?? -1), gs: Math.round(g?.gs ?? 0), hdg: Math.round(((g?.track ?? 0) * 180 / Math.PI + 360) % 360), ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null, gear: c.gearDown, mount: __bh.settings.shipMount, scale: __bh.game.perf({ gpu: false }).renderScale }; })()`,
      );
      console.log(`  flight start: ${JSON.stringify(state0)}`);
      await app.shot(`${OUT}/flight-start.png`);
      // (B) the sea's white points by stage: six reads a second or so apart, straight over the sea
      await app.js(`(() => { __bh.renderer.stageProbe = true; return 1; })()`);
      await app.js(`new Promise((q) => { let n = 0; const f = () => (++n > 10 ? q(1) : requestAnimationFrame(f)); f(); })`);
      const stages: unknown[] = [];
      for (let k = 0; k < 6; k++) {
        stages.push(await app.js(stageSparklesJs([0.35, 0.85])));
        await app.js(`new Promise((q) => { let n = 0; const f = () => (++n > 30 ? q(1) : requestAnimationFrame(f)); f(); })`);
      }
      await app.js(`(() => { __bh.renderer.stageProbe = false; return 1; })()`);
      console.log(
        `  stages: ${JSON.stringify(stages.map((s) => Object.fromEntries(Object.entries(s ?? {}).map(([k, v]) => [k, v ? [(v as { overWhite: number }).overWhite, (v as { isolated: number }).isolated] : null]))))}`,
      );
      // (A) the sharpness along a flight with three pauses (the clock frozen: the camera held, the image refined at scale 1; moving
      // again: the raster's scale), the turn between; every image's GPU time; the publication from its start
      const fl = await app.js<{
        t0: number;
        events: { t: number; what: string }[];
        frames: [number, number, number][];
        samples: Record<string, unknown>[];
        stills: Record<string, string>;
      }>(`(async () => {
        const R = __bh.renderer, c = __bh.camera, frame = () => new Promise((q) => requestAnimationFrame(q));
        R.sharpProbe = true;
        const t0 = performance.now(), events = [], frames = [], samples = [];
        let last = R.completedFrames ?? 0, nextSample = 0;
        const plan = [[8, "pause"], [12, "resume"], [20, "pause"], [24, "resume"], [27, "turn"], [36, "pause"], [40, "resume"], [46, "scale 0.625"], [50, "scale auto"], [56, "end"]];
        let k = 0, held = false;
        globalThis.__j2 ??= {};
        const keep = (name) => R.sceneColor(__bh.settings).then((c) => (globalThis.__j2[name] = c)).catch(() => {});
        while (k < plan.length) {
          const t = await frame(); const el = (t - t0) / 1000;
          const done = R.completedFrames ?? 0;
          if (done !== last) { frames.push([+(t - t0).toFixed(2), done - last, +(R.lastGpuMs ?? 0).toFixed(2)]); last = done; }
          if (el >= nextSample) { nextSample += 0.5; const g = c.geoNow(), p = __bh.game.perf({ gpu: false });
            samples.push({ t: +el.toFixed(2), scale: p.renderScale, phase: R.lastPhase, alt: Math.round(g?.alt ?? 0), hdg: Math.round(((g?.track ?? 0) * 180 / Math.PI + 360) % 360), tiles: R.earthTiles.pending, ortho: R.earthTiles.orthoPending, kept: R.earthTiles.kept }); }
          const [at, what] = plan[k];
          if (el < at) continue;
          k++;
          events.push({ t: +(t - t0).toFixed(1), what });
          if (what === "pause") { if (k === 1) keep("moving1"); __bh.freeze(true); held = true; }
          else if (what === "resume") { if (k === 2) keep("refined1"); __bh.freeze(false); held = false; }
          else if (what === "scale 0.625") __bh.forceScale(0.625);
          else if (what === "scale auto") __bh.forceScale(null);
          else if (what === "turn") c.jetModes.hdg = ${J0_SCENE.turnTo} * Math.PI / 180;
          if (what === "resume" && k === 2) { for (let i = 0; i < 3; i++) await frame(); keep("resumed1"); }
        }
        R.sharpProbe = false;
        return { t0, events, frames, samples, stills: {} }; })()`);
      for (const name of ["moving1", "refined1", "resumed1"])
        await writeB64(`${OUT}/flight-${name}.png`, await app.js<string | null>(scenePngJs(name)));
      await app.js(`(() => { globalThis.__j2 = {}; return 1; })()`);
      const rows = (await app.js<SharpRowT[]>(`__bh.renderer.sharpLog.filter((r) => r.t >= ${fl.t0})`)).map((r) => ({
        ...r,
        t: +(r.t - fl.t0).toFixed(1),
      }));
      const dips = scaleDips(rows);
      // (each event of the flight — the pauses, the resumes, the turn, the forced scales —: the same measure)
      const steps = fl.events.map((e) => ({ what: e.what, ...(eventStep(rows, e.t) ?? {}) }));
      // (each pause: its last moving images against the refined one it ends with — motion-quality's "sharpMoving", in flight)
      const pauses: Record<string, number>[] = [];
      for (let i = 0; i + 1 < fl.events.length; i++) {
        if (fl.events[i]!.what !== "pause") continue;
        const p0 = fl.events[i]!.t,
          p1 = fl.events[i + 1]!.t;
        const before = rows.filter((r) => r.t < p0 && r.t > p0 - 400).map((r) => r.sharp);
        const end = rows.filter((r) => r.t < p1 && r.t > p1 - 300).map((r) => r.sharp);
        const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? Number.NaN;
        pauses.push({
          at: p0,
          moving: +med(before).toFixed(3),
          refined: +med(end).toFixed(3),
          ratio: +(med(before) / med(end)).toFixed(3),
        });
      }
      // (the white points image by image, in the box: how many images have some, how many a second, the most in one)
      const pts = rows.map((r) => r.points ?? 0);
      const points = {
        images: pts.length,
        withPoints: pts.filter((x) => x > 0).length,
        total: pts.reduce((a, b) => a + b, 0),
        max: Math.max(0, ...pts),
        perSecond: +(pts.reduce((a, b) => a + b, 0) / Math.max(1e-3, (rows[rows.length - 1]!.t - rows[0]!.t) / 1000)).toFixed(2),
      };
      console.log(`  white points in the box: ${JSON.stringify(points)}`);
      const pub = await app.js(`__bh.renderer.earthTiles.pubStats(${fl.t0})`);
      const pubLog = await app.js(
        `__bh.renderer.earthTiles.pubLog.filter((r) => r.t >= ${fl.t0}).map((r) => ({ ...r, t: +(r.t - ${fl.t0}).toFixed(1), putMs: +r.putMs.toFixed(3), mipMs: +r.mipMs.toFixed(3) }))`,
      );
      await app.shot(`${OUT}/flight-end.png`);
      out.flight = {
        placed,
        state0,
        stages,
        events: fl.events,
        samples: fl.samples,
        frames: intervals(fl.frames),
        sharp: rows,
        sharpSkipped: await app.js<number>(`__bh.renderer.sharpSkipped`),
        dips,
        steps,
        points,
        pauses,
        publication: { load, flight: pub, log: pubLog },
        gpuErrors: await app.js<number>(`__bh.renderer.gpuErrors`),
      };
      console.log(`  dips: ${JSON.stringify(dips)}`);
      console.log(`  steps: ${JSON.stringify(steps)}`);
      console.log(`  pauses: ${JSON.stringify(pauses)}`);
      console.log(`  publication (load): ${JSON.stringify(load)}`);
      console.log(`  publication (flight): ${JSON.stringify(pub)}`);
      expect(rows.length).toBeGreaterThan(100);
      expect((out.flight as { gpuErrors: number }).gpuErrors).toBe(0);
    }, 600_000);
});
