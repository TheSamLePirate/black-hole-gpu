import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { readPng, writePng } from "./lib/png";

// Q6 I3 — the history's ghosts behind what moves over the ground (docs/PLAN-REFRACTION-HORIZONS.md Q6: "no ghost on the sea,
// the aircraft, the reflections"). The craft — the flown one, the others — are drawn after the temporal passes (ship.encodeShip):
// they never enter the history. What moves within the traced image does: the flown craft's shadow on the ground (its shadow
// map, trace.wgsl shipShadow) slides over a ground the history carries rigidly (its depth), the sea's waves move under it.
// The F-35 low (GROUND m over the ground, sun high) seen from above and behind (the "around" view), the simulation frozen and
// stepped 1/30 s a frame: FRAMES frames flown, the last held and shot (moving); then its reference at once — the same frame
// refined at the canvas's full scale, the history off. Their difference: the box's PSNR, and the ghost — the moving image darker
// than the reference by more than 12 levels outside the reference's own shadow (a trail behind the craft's shadow) — counted
// in pixels; a map of the differences beside the shots. And after 30 frames with the world still (the history converged): the
// still shot, against the same reference. The trees' shadow map logged frame by frame (drawn again, read, the scenery's revision),
// and the relief's shadow cascades (drawn again, dzOff, their pass's GPU time a redraw): the cascades kept while the meshes' windows
// moved shaded the hollows in combs where nothing stands (Q6m — renderer.sunWindowsInKey false: the key before it).
// PLACES=mancha,strait,manchaclouds (mancha cloudy: its decks' shadows on the ground),clouds (cloudy, 900 m, the view nearly level); MODES=spatial75q,taau75q,native100q,trace (a mode@n: renderer.liteSkip = n — a part of the raster's
// material cut, e.g. 2097152 the craft's shadow); FRAMES (60); TURN (0°: straight; a heading change asked as the flight starts); GROUND (40 m); SPEED (140 m/s); GH_FORCE=1: the trees' shadow map
// drawn again 10 frames with the world still, shot (-forced, -forced-after). GH_COMBS=1: first a flight of FRAMES frames in the
// shadows' debug view, the relief-shadowed ground counted every COMB_EVERY (5) frames (Q6m's combs over the whole flight).
// Output: remote-results/ghost/<place>-<mode>[-still|-ref|-diff|-still-diff].png, ghost.json (GH_OUT).
// Done when: every place × mode shot and compared (the world in — maps, relief, imagery, surface, scenery — 3 s running, 120 s at
// most; the reference 30 s; what is missing said), no GPU error.
// Duration: ~1.5 min a place × mode (the first waits for the tiles).

const OUT = process.env.GH_OUT ?? "remote-results/ghost";
const GROUND = Number(process.env.GROUND ?? 40);
const SPEED = Number(process.env.SPEED ?? 140);
const FRAMES = Number(process.env.FRAMES ?? 60);
const TURN = Number(process.env.TURN ?? 0);
const PLACES: Record<string, string> = {
  // (La Mancha's plain at noon: the shadow sharp and near the craft; heading east)
  mancha: `__bh.game.setDate("2026-07-10T11:30:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(39.42, -3.05, ${GROUND}, 90, ${SPEED});`,
  // (the strait of Gibraltar: the shadow on the sea, the waves moving under it; heading west)
  strait: `__bh.game.setDate("2026-07-10T11:30:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
    __bh.game.flyAt(35.96, -5.45, ${GROUND}, 250, ${SPEED});`,
  // (La Mancha as mancha but cloudy — the weather's decks, their shadows on the ground: the relief's re-bakes and the cascades
  // measured with the clouds on, Q6n's series having had them off)
  manchaclouds: `__bh.game.setDate("2026-07-10T11:30:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(39.42, -3.05, ${GROUND}, 90, ${SPEED});`,
  // (the clouds in their own history — I3 —: La Mancha cloudy, 900 m up, heading east, the view nearly level — the clouds
  // passing across it, the ground below them)
  clouds: `__bh.game.setDate("2026-07-10T13:00:00Z"); __bh.game.set("weather", "cloudy"); __bh.game.set("earthClouds", 1);
    __bh.game.flyAt(39.42, -3.05, 900, 90, ${SPEED});`,
};
/** each place's view about the craft (the "around" mount: yaw, pitch [°], distance [m]) */
const VIEWS: Record<string, string> = { clouds: "{ yaw: 0, pitch: 6, dist: 40 }" };
const RASTER = `__bh.settings.earthPipeline = "raster"; __bh.game.set("realtimeSubsampling", 4); __bh.renderer.rasterJitter = "gauss";`;
const MODES: Record<string, string> = {
  spatial75q: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = false; __bh.forceScale(0.75);`,
  taau75q: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = true; __bh.forceScale(0.75);`,
  native100q: `${RASTER} __bh.settings.earthRasterShading = "quarter"; __bh.renderer.taauOn = false; __bh.forceScale(1);`,
  // (the traced ground — its shading the craft's shadow's reference)
  trace: `__bh.settings.earthPipeline = "trace"; __bh.renderer.taauOn = false; __bh.forceScale(1);`,
};
// (the scenery high and its shadows — the world as the game shows it)
const DETAIL = `Object.assign(__bh.settings, { earthScenery: "high", detailReach: "veryFar", earthSceneryShadows: true, earthSurface: "satellite", lookProfile: "neutral" });`;
/** everything under the view in — the maps high, the relief and imagery tiles, the surface, the scenery whole — for 3 s running,
 *  frames drawn (the clock stopped); at most `ms`: then what was still missing */
const WORLD_IN = (ms: number) => `(async () => {
  const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
  const miss = () => { const sc = r.earthScenery?.stats?.() ?? {}; const m = [];
    if (r.earthMaps.tier !== "high") m.push("maps " + r.earthMaps.tier);
    if (r.earthTiles.pending) m.push(r.earthTiles.pending + " relief tiles");
    if (r.earthTiles.orthoPending) m.push(r.earthTiles.orthoPending + " imagery tiles");
    if (r.earthSurface.pending) m.push("surface");
    if (sc.status !== "ready" || sc.pending) m.push("scenery " + sc.status + (sc.pending ? " (" + sc.pending + " pending)" : ""));
    return m; };
  const t0 = performance.now(); let calm = 0;
  while (performance.now() - t0 < ${ms}) {
    calm = miss().length === 0 ? calm || performance.now() : 0;
    if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
  const sc = r.earthScenery?.stats?.() ?? {};
  return { ok: calm > 0 && performance.now() - calm > 3000, missing: miss().join(", "), finest: r.earthTiles.finest,
    trees: sc.trees ?? 0, buildings: sc.buildings ?? 0, waitedS: +((performance.now() - t0) / 1000).toFixed(1) }; })()`;
type WorldIn = { ok: boolean; missing: string; finest: number; trees: number; buildings: number; waitedS: number };
const places = (process.env.PLACES ?? "mancha,strait").split(",");
const modes = (process.env.MODES ?? "spatial75q,taau75q,native100q").split(",");
// (the view below the page's top bar, the tactical map and credits left out — the 1600 × 1000 image)
const BOX = { x0: 0, x1: 1600, y0: 60, y1: 900 };

type Png = ReturnType<typeof readPng>;
const png = (f: string) => readPng(new Uint8Array(readFileSync(f)));
const lum = (a: Png, x: number, y: number) => {
  const i = (y * a.width + x) * a.channels;
  return 0.2126 * a.data[i]! + 0.7152 * a.data[i + 1]! + 0.0722 * a.data[i + 2]!;
};
/** the box's PSNR, the ghost's pixels (darker than the reference by 12 levels, the reference not in its own shadow — its
 *  pixel no darker than 0.6 × its 31 px neighbourhood's mean — nor the craft — identical in both), and a map of the
 *  differences (red: darker moving, green: brighter, × 4) */
function compare(m: Png, r: Png, file: string) {
  const W = m.width,
    H = m.height;
  // (the reference's luminance's box mean over 31 × 31: its integral image)
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += lum(r, x, y);
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1]! + row;
    }
  }
  const mean = (x: number, y: number) => {
    const x0 = Math.max(x - 15, 0),
      x1 = Math.min(x + 16, W),
      y0 = Math.max(y - 15, 0),
      y1 = Math.min(y + 16, H);
    return (S[y1 * (W + 1) + x1]! - S[y0 * (W + 1) + x1]! - S[y1 * (W + 1) + x0]! + S[y0 * (W + 1) + x0]!) / ((x1 - x0) * (y1 - y0));
  };
  let sq = 0,
    n = 0,
    ghost = 0,
    bright = 0;
  const map = new Uint8Array(W * H * 3);
  for (let y = BOX.y0; y < BOX.y1; y++)
    for (let x = BOX.x0; x < BOX.x1; x++) {
      const lm = lum(m, x, y),
        lr = lum(r, x, y);
      for (let c = 0; c < 3; c++) {
        const i = (y * W + x) * m.channels + c;
        const d = m.data[i]! - r.data[i]!;
        sq += d * d;
      }
      n += 3;
      const d = lm - lr;
      if (d < -12 && lr > 0.6 * mean(x, y)) ghost++;
      if (d > 12) bright++;
      const o = (y * W + x) * 3;
      map[o] = Math.min(255, Math.max(0, -d * 4));
      map[o + 1] = Math.min(255, Math.max(0, d * 4));
      map[o + 2] = Math.min(255, lr * 0.25);
    }
  writeFileSync(file, writePng(W, H, map));
  return {
    psnr: +(10 * Math.log10((255 * 255) / Math.max(sq / n, 1e-9))).toFixed(2),
    ghostPx: ghost,
    brightPx: bright,
  };
}

describe.skipIf(!E2E)("Q6 I3: the history's ghosts behind the craft's shadow and on the sea", () => {
  let app: App;
  const rows: Record<string, unknown>[] = [];
  const saves = new Map<string, string>();
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({
      width: 1600,
      height: 1000,
      hash: "scene=game:artemis",
      tiles: true,
      profile: process.env.GH_CHROME_PROFILE || undefined,
    });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: false, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(async () => {
    await Bun.write(`${OUT}/ghost.json`, JSON.stringify(rows, null, 2));
    await app?.close();
    stopServer();
  });

  for (const pl of places)
    for (const [mi, md] of modes.entries())
      test(`${pl}: ${md} — the moving frame against its reference`, async () => {
        // (a mode asked again: its files apart — "-2", "-3" —, not over the first's)
        const tag = `${pl}-${md}${modes.indexOf(md) === mi ? "" : `-${modes.slice(0, mi + 1).filter((m) => m === md).length}`}`;
        if (!saves.has(pl)) {
          // (placed, the tiles in — 3 s with none pending, a z 12 level at least —, placed again on the relief in, saved)
          await app.js(`(() => { __bh.freeze(false); __bh.game.quality("realtime");
            Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 64, dof: false, motionBlur: 0 });
            ${DETAIL} ${PLACES[pl]} __bh.freeze(true); return 1; })()`);
          const placed = await app.js<WorldIn>(WORLD_IN(120_000));
          console.log(`  ${pl}: placed — ${JSON.stringify(placed)}`);
          if (!placed.ok) console.log(`  ${pl}: the world not in after 120 s (${placed.missing}) — placed anyway`);
          saves.set(
            pl,
            await app.js<string>(`(() => { __bh.freeze(false); ${PLACES[pl]} __bh.freeze(true);
              return JSON.stringify(__bh.game.snapshot("ghost ${pl}")); })()`),
          );
        }
        await app.js(`(() => { __bh.freeze(false); __bh.game.importSave(${JSON.stringify(saves.get(pl))}, false);
          __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 64, dof: false, motionBlur: 0 });
          ${DETAIL} ${MODES[md.split("@")[0]!]} __bh.renderer.liteSkip = ${Number(md.split("@")[1] ?? 0)}; ${process.env.GH_EXTRA ?? ""} __bh.settings.shipMount = "around"; return 1; })()`);
        // (the autopilot holding height and heading, the autothrottle SPEED, engaged until they hold; the view from above and
        // behind set while the world runs — a mount set frozen is not applied)
        const ap = await app.js<{ ap: boolean; athr: boolean; mount: string }>(`(async () => {
          const c = __bh.camera, frame = () => new Promise((q) => requestAnimationFrame(q));
          for (let i = 0; i < 60; i++) {
            await frame();
            if (c.jetModes.alt === null) c.jetToggle("ap");
            if (c.jetModes.spd === null) c.jetToggle("athr");
            Object.assign(c.outside, ${VIEWS[pl] ?? "{ yaw: 0, pitch: 55, dist: 70 }"});
            if (c.jetModes.alt !== null && c.jetModes.spd !== null && i >= 30) break;
          }
          const g = c.geoNow(); if (g) { c.jetModes.alt = g.alt; c.jetModes.hdg = g.track; }
          c.jetModes.spd = ${SPEED};
          __bh.freeze(true);
          return { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null, mount: __bh.settings.shipMount }; })()`);
        if (!ap.ap || !ap.athr) console.log(`  ${pl} ${md}: the autopilot ${ap.ap} / autothrottle ${ap.athr}`);
        await app.waitOptional(`!!__bh.renderer.variantReady`, 120_000);
        await app.settled(90_000);
        // (the world in before the flight — and again before the reference: its view the same, its tiles too)
        const world = await app.js<WorldIn>(WORLD_IN(120_000));
        if (!world.ok) console.log(`  ${pl} ${md}: the world not in after 120 s (${world.missing}) — measured anyway`);
        await app.settled(60_000);
        // (GH_COMBS=1 — Q6m's combs counted over the whole flight, not on its last frame alone: FRAMES frames flown in the shadows'
        // debug view (liteSkip 8192: green the relief's sun visibility, red the scenery's, blue constant), every COMB_EVERY-th
        // shot and its relief-shadowed ground counted — green under half the blue where the blue is lit enough, the scenery's not
        // dark —; green under 0.8 of the blue: the view overexposed, its magenta pale —; on La Mancha's plain at noon nothing should be: those pixels the combs. Then the measured flight as before)
        let combs: number[] | null = null;
        let combLog: string[] = [];
        if (process.env.GH_COMBS) {
          const every = Number(process.env.COMB_EVERY ?? 5);
          combs = [];
          // (each frame: the cascades drawn again (R), a bake of the heights (B), the camera's step towards the Sun since (dzOff))
          combLog = [];
          const ls = await app.js<number>(
            `(() => { const r = __bh.renderer, v = r.liteSkip; r.liteSkip = v | 8192; __bh.touch(); return v; })()`,
          );
          await app.settled(90_000);
          for (let i = 0; i < FRAMES; i++) {
            const st = await app.js<string>(`(async () => { const r = __bh.renderer; const b0 = r.terrainSurfaceCache?.stats().builds ?? 0;
              __bh.step(1 / 30); __bh.touch(); const last = r.lastDoneAt; let k = 0;
              while (r.lastDoneAt === last && k++ < 120) await new Promise((q) => requestAnimationFrame(q));
              return [r.terrainRaster?.sunDrewNow ? "R" : "-", (r.terrainSurfaceCache?.stats().builds ?? 0) > b0 ? "B" : "-", (r.sunCascadeRows?.[3] ?? 0).toFixed(1)].join(""); })()`);
            combLog.push(st);
            if (i % every !== every - 1) continue;
            const f = `${OUT}/${tag}-combs-${String(i + 1).padStart(2, "0")}.png`;
            await app.shot(f);
            const im = png(f);
            let n = 0;
            for (let y = Math.floor(im.height * 0.3); y < im.height; y++)
              for (let x = 0; x < im.width; x++) {
                const o = im.channels * (y * im.width + x);
                const R = im.data[o]!,
                  G = im.data[o + 1]!,
                  B = im.data[o + 2]!;
                if (B > 25 && G < 0.8 * B && R > 0.75 * B) n++;
              }
            combs.push(n);
          }
          await app.js(`(() => { __bh.renderer.liteSkip = ${ls}; __bh.touch(); return 1; })()`);
          console.log(
            `  ${pl} ${md}: relief-shadowed pixels every ${every} frames: ${combs.join(" ")} (frames with more than 2 000: ${combs.filter((n) => n > 2000).length} of ${combs.length})`,
          );
          await app.settled(90_000);
        }
        // (flown: FRAMES frames each after a step of 1/30 s)
        const fl = await app.js<{ gpuMs: number; groundPx: number; tsm: unknown; state: Record<string, number> }>(`(async () => {
          const r = __bh.renderer, c = __bh.camera, frame = () => new Promise((q) => requestAnimationFrame(q));
          let gpu = 0, ground = 0;
          // (the trees' shadow map frame by frame — drawn again, read, its scenery's revision: renderer.encodeTerrainRasterVisibility)
          // (and the relief's shadow cascades — renderer.encodeSunShadow: drawn again, the camera's step towards the Sun since, dzOff)
          const tsm = { redraws: 0, read: 0, revisions: new Set(), frames: 0, last: [], sunRedraws: 0, dz: [], bakes0: r.terrainSurfaceCache?.stats().builds ?? 0, bakes: 0 };
          const note = () => { tsm.frames++; if (r.tsmRedraw) tsm.redraws++; if (r.tsmDrawn) tsm.read++; tsm.revisions.add(r.earthScenery.revision);
            if (r.terrainRaster?.sunDrewNow) tsm.sunRedraws++; tsm.dz.push(+(r.sunCascadeRows?.[3] ?? 0).toFixed(1));
            tsm.last.push([r.tsmRedraw ? 1 : 0, r.tsmDrawn ? 1 : 0, r.earthScenery.revision, ...Array.from(r.tsmFrame.slice(12, 15)).map((x) => Math.round(x))]);
            if (tsm.last.length > 4) tsm.last.shift(); };
          r.prof.enabled = true; r.prof.every = 1; r.prof.reset();
          const gate = [];
          // (TURN°: the autopilot's heading turned that much as the flight starts — the image sweeping across, the history's test)
          if (${TURN} !== 0) c.jetModes.hdg = (c.geoNow()?.track ?? 0) + ${TURN} * Math.PI / 180;
          for (let i = 0; i < ${FRAMES}; i++) {
            __bh.step(1 / 30); __bh.touch();
            const last = r.lastDoneAt; let k = 0;
            while (r.lastDoneAt === last && k++ < 120) await frame();
            note();
            gpu += r.lastGpuMs; ground += r.imageGroundPx ?? 0;
            // (Q5 VIPER C2: the clouds' amortisation's gate a frame — the image's motion [px], amortised or not)
            gate.push([+(r.frameMotionPx ?? -1).toFixed(2), r.cloudAmortizedNow ? 1 : 0]);
          }
          // (the relief's cascades' pass — drawn again or not — its GPU time a frame [ms], the profiler's mean)
          tsm.bakes = (r.terrainSurfaceCache?.stats().builds ?? 0) - tsm.bakes0;
          const T = r.prof.table(); tsm.sunPassMs = +(T.find((x) => x.label === "terrain from the Sun")?.ms ?? 0).toFixed(3);
          r.prof.enabled = false;
          const g = c.geoNow();
          return { gpuMs: +(gpu / ${FRAMES}).toFixed(1), groundPx: +(ground / ${FRAMES}).toFixed(1),
            tsm: { ...tsm, revisions: [...tsm.revisions], dz: tsm.dz.join(" ") }, gate,
            state: { agl: Math.round(c.heightOverGround?.() ?? g?.agl ?? 0), alt: Math.round(g?.alt ?? 0), gs: +(g?.gs ?? 0).toFixed(1) } }; })()`);
        await app.js(
          `(() => { __bh.settings.targetSpp = 0; document.body.classList.add("hide-ui"); document.getElementById("overlay").style.visibility = "hidden"; return 1; })()`,
        );
        const fMove = `${OUT}/${tag}.png`;
        await app.shot(fMove);
        // (after accumulation: 30 realtime frames with the camera still — the history converged at the mode's scale)
        const stillTsm = await app.js<{ redraws: number; sunRedraws: number; dz: string; revisions: number[] }>(
          `(async () => { const r = __bh.renderer; let redraws = 0, sun = 0; const revs = new Set(), dz = [];
            for (let i = 0; i < 30; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); if (r.tsmRedraw) redraws++;
              if (r.terrainRaster?.sunDrewNow) sun++; dz.push(+(r.sunCascadeRows?.[3] ?? 0).toFixed(1)); revs.add(r.earthScenery.revision); }
            return { redraws, sunRedraws: sun, dz: dz.join(" "), revisions: [...revs] }; })()`,
        );
        const fStill = `${OUT}/${tag}-still.png`;
        await app.shot(fStill);
        if (process.env.GH_FORCE) {
          // (a probe: the trees' shadow map drawn again at every frame with the world still — its redraw alone)
          await app.js(`(async () => { const r = __bh.renderer; for (let i = 0; i < 10; i++) { r.tsmValid = false; __bh.touch();
            await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`);
          await app.shot(`${OUT}/${tag}-forced.png`);
          await app.js(
            `(async () => { for (let i = 0; i < 30; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`,
          );
          await app.shot(`${OUT}/${tag}-forced-after.png`);
        }
        // (the reference: the same frame refined at the canvas's full scale, the upsampling off)
        const fRef = `${OUT}/${tag}-ref.png`;
        await app.js(
          // (the clouds marched at every texel for the reference — Q5 VIPER C2: amortised, a still reference was amortised too)
          `(() => { __bh.forceScale(null); __bh.renderer.taauOn = false; window.__amortize = __bh.renderer.cloudAmortize; __bh.renderer.cloudAmortize = false; __bh.settings.targetSpp = 64; __bh.touch(); return 1; })()`,
        );
        let converged = false;
        for (let i = 0; i < 60 && !converged; i++) {
          await Bun.sleep(500);
          converged = await app.js<boolean>(`__bh.renderer.lastPhase === "converged"`);
        }
        const phase = await app.js<string>(`__bh.renderer.lastPhase`);
        // (the raster's realtime phase is its refinement — 30 s of frames at full scale, the history off; the traced one converges)
        if (!converged && md === "trace") console.log(`  ${pl} ${md}: the reference not converged after 30 s (${phase}) — compared anyway`);
        await app.shot(fRef);
        await app.js(`(() => { __bh.renderer.cloudAmortize = window.__amortize ?? false; return 1; })()`);
        // (the world still whole at the reference: nothing arrived between the shots)
        const after = await app.js<WorldIn>(WORLD_IN(1));
        const row = {
          place: pl,
          mode: md,
          ...fl,
          ...compare(png(fMove), png(fRef), `${OUT}/${tag}-diff.png`),
          still: compare(png(fStill), png(fRef), `${OUT}/${tag}-still-diff.png`),
          mount: ap.mount,
          world: {
            before: world.missing || "all in",
            trees: world.trees,
            buildings: world.buildings,
            finest: world.finest,
            waitedS: world.waitedS,
            atRef: after.missing || "all in",
          },
          phase,
          stillTsm,
          combs,
          combLog,
          pipeline: await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`),
          converged,
          gpuErrors: await app.js<number>(`__bh.renderer.gpuErrors`),
        };
        rows.push(row);
        console.log(JSON.stringify(row));
        await app.js(
          `(() => { __bh.renderer.taauOn = true; __bh.renderer.liteSkip = 0; __bh.forceScale(null); __bh.freeze(false); document.body.classList.remove("hide-ui"); document.getElementById("overlay").style.visibility = ""; return 1; })()`,
        );
        expect(row.gpuErrors).toBe(0);
      }, 400_000);
});
