import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { $ } from "bun";
import { App, E2E, stopServer } from "./lib/app";
import { J0_FIXED } from "./lib/j0-scene";

// PLAN-J2, step A of J2-1 (docs/PLAN-J2-PAGES-RECONSTRUCTION.md §9 ter; PROBLEMES-A-REGLER, 12 Nov 2026): the leak probe's first
// version froze the page when a fine relief level stayed published without the tile under the camera. In play a window not whole
// is published over the largest rectangle of its tiles in round the loads' centre — the camera led along its motion
// (`loadedRect`, `priorityLon`) —, not round the camera's own tile: this flies the case. The F-35 at 300 m over the Beauce (flat,
// France: the IGN's relief z 15–17 and its orthophotos wanted), 140 m/s east, autopilot + autothrottle + gear down held (E2E-VOLS
// §5.4), the tiles loading as it flies; four views of ~15 s each — the cockpit looking ahead, outside 60 m ahead of the craft looking
// back (the cockpit's look is held ahead by the F-35's pad), outside 1.5 km behind the craft, outside 1.5 km ahead looking back at it —
// and every image: which levels' published rectangles hold the tile under the camera and the one under the craft
// (earthTiles.coverAt). A "hole": a level published without the camera's tile (the ground under it drawn by a coarser one). Shots at
// each view and at a hole's first image; the rAF gaps (a frozen page: no answer within 20 s — said, the test failed); the tiles'
// publication per view (earthTiles.pubProbe — J2-1's budget).
// Phases (J2PC_PHASES, default flight): still — J2-1's image A/B: a still view over the Gapeau's plain (J2-0's leak view, 300 m,
// frozen, everything in, 120 images held), its scene colour (renderer.sceneColor, tone-mapped) and the screen written as
// still-<AB_SIDE><AB_RUN> (scripts/ab-e2e.ts); flight — the four views above.
// Not a pass/fail on the holes: what they are is the result (docs/progress/j2/). It fails on a frozen page, a GPU error, the
// autopilot not engaged.
// Duration: ~4 min on kerr-mini for the flight, ~3 min for the still (cold boot and the tiles included).
// Done when: the phases asked done — the still's images written; the four views flown and read —, j2-page-camera.json written, no GPU error, the page never frozen.

const MACHINE = process.env.J2_MACHINE ?? (await $`hostname -s`.quiet().text()).trim();
const SIDE = process.env.AB_SIDE ? `${process.env.AB_SIDE}${process.env.AB_RUN ?? ""}` : "";
const OUT = process.env.J2_OUT ?? `remote-results/j2-page-camera/${MACHINE}${SIDE ? `-ab/${SIDE}` : ""}`;
const PHASES = (process.env.J2PC_PHASES ?? "flight").split(",");
const W = 1920,
  H = 1080;
/** the place: lat, lon [°], height over the ground [m], heading [°], speed [m/s] — the Beauce's farmland, east of Chartres */
const AT = [48.36, 1.62, 300, 90, 140] as const;
const PHASE_S = Number(process.env.J2_PHASE_S ?? 15);
const VIEWS: { name: string; set: string }[] = [
  { name: "cockpit-ahead", set: `__bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();` },
  {
    name: "outside-ahead-60m",
    set: `__bh.settings.shipMount = "around"; __bh.refresh(); __bh.camera.viewReset(); Object.assign(__bh.camera.outside, { yaw: 180, pitch: 8, dist: 60 });`,
  },
  {
    name: "outside-behind-1500m",
    set: `__bh.settings.shipMount = "around"; __bh.refresh(); __bh.camera.viewReset(); Object.assign(__bh.camera.outside, { yaw: 0, pitch: 8, dist: 1500 });`,
  },
  {
    name: "outside-ahead-1500m",
    set: `__bh.settings.shipMount = "around"; __bh.refresh(); __bh.camera.viewReset(); Object.assign(__bh.camera.outside, { yaw: 180, pitch: 8, dist: 1500 });`,
  },
];
const out: Record<string, unknown> = { machine: MACHINE, output: `${W}×${H}`, at: AT, startedAt: new Date().toISOString() };

/** a page call that must answer: a frozen page said, not waited on for ever */
async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`the page did not answer in ${ms / 1000} s (${what}) — frozen?`)), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    clearTimeout(timer);
  }
}

/** in the page: `ms` of images, each one's cover read (the camera's tile, the craft's), the rAF gaps */
const chunkJs = (ms: number) => `(async () => {
  const t = __bh.renderer.earthTiles, c = __bh.camera, frame = () => new Promise((q) => requestAnimationFrame(q));
  const rows = []; const t0 = performance.now(); let last = t0, gapMax = 0;
  while (performance.now() - t0 < ${ms}) {
    const now = await frame(); gapMax = Math.max(gapMax, now - last); last = now;
    const g = c.geoNow();
    const v = t.coverAt(g ? { lat: g.lat, lon: g.lon } : undefined);
    rows.push([+(now).toFixed(1), v.camZ, v.atZ, v.finest, v.wantZ, v.holes.join(" "), v.atHoles.join(" "), t.pending, t.orthoPending ?? 0]);
  }
  const g = c.geoNow(), last1 = t.coverAt(g ? { lat: g.lat, lon: g.lon } : undefined);
  return { rows, gapMax: +gapMax.toFixed(1), last: last1, alt: Math.round(g?.alt ?? -1), gs: Math.round(g?.gs ?? 0),
    hdg: Math.round(((g?.track ?? 0) * 180 / Math.PI + 360) % 360), ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null,
    mount: __bh.settings.shipMount, camKm: (() => { const R = __bh.renderer; return R.liveEyeHM ?? null; })() };
})()`;

type Row = [number, number, number, number, number, string, string, number, number];

describe.skipIf(!E2E)("J2-1 step A: the tile under the camera while a fine level loads (camera away from the craft)", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ width: W, height: H, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { Object.assign(__bh.settings, ${J0_FIXED}); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
  }, 300_000);
  afterAll(async () => {
    out.finishedAt = new Date().toISOString();
    await Bun.write(`${OUT}/j2-page-camera.json`, JSON.stringify(out, null, 1));
    console.log(`  ${OUT}/j2-page-camera.json`);
    await app?.close();
    stopServer();
  });

  /** in the page: the scene's colour tone-mapped (x / (1 + x), sRGB) to a PNG, base64 (as j2-probes) */
  const scenePngJs = `(async () => {
    const c = await __bh.renderer.sceneColor(__bh.settings); const W = c.width, H = c.height, d = c.data, e = c.exposure, img = new Uint8ClampedArray(W * H * 4);
    const s = (v) => { const x = Math.max(0, v * e); const t = x / (1 + x); return 255 * (t <= 0.0031308 ? 12.92 * t : 1.055 * Math.pow(t, 1 / 2.4) - 0.055); };
    let lum = 0; for (let i = 0; i < W * H * 4; i += 4) { img[i] = s(d[i]); img[i + 1] = s(d[i + 1]); img[i + 2] = s(d[i + 2]); img[i + 3] = 255; lum += e * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); }
    const cv = new OffscreenCanvas(W, H); cv.getContext("2d").putImageData(new ImageData(img, W, H), 0, 0);
    const b = new Uint8Array(await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer());
    let bin = ""; for (let i = 0; i < b.length; i += 32768) bin += String.fromCharCode(...b.subarray(i, i + 32768));
    return { png: btoa(bin), width: W, height: H, source: c.source, meanLum: lum / (W * H) }; })()`;

  test.skipIf(!PHASES.includes("still"))(
    "still: the Gapeau's plain held, its scene colour for the A/B of J2-1",
    async () => {
      // (J2-0's leak view: plaine du Gapeau, 300 m, heading 20°, 10:00 UTC; realtime, fixed settings — the same image every run.
      // J2, the peaks (12 Nov 2026): the clock frozen as soon as the craft is placed — before, 40 images of free flight then frozen: the
      // craft's place depended on those images' pace, and an A/B's sides froze 100 m apart (LFTH 2.9 against 3.0 km), two views compared)
      const go = `(async () => { __bh.freeze(false); __bh.game.quality("realtime");
      Object.assign(__bh.settings, { dynamicResolution: false, animate: true, targetSpp: 64, motionBlur: 0, lookProfile: "neutral" });
      __bh.game.setDate("2026-07-10T10:00:00Z"); __bh.game.set("weather", "fair"); __bh.game.set("earthClouds", 0);
      __bh.game.flyAt(43.12, 6.13, 300, 20, 140); __bh.freeze(true); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();
      for (let i = 0; i < 40; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`;
      await app.js(go);
      await app.settled(180_000);
      await app.js(`(async () => { const t = __bh.renderer.earthTiles, f = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < 60000) { const ok = t.pending === 0 && t.finest >= 12; calm = ok ? calm || performance.now() : 0;
        if (calm && performance.now() - calm > 3000) break; __bh.touch(); await f(); } return 1; })()`);
      await app.js(go);
      await app.dataSettled("the Gapeau", { maxMs: 90_000 }).catch((e) => console.log(`  ${String(e).slice(0, 160)}`));
      await app.settled(60_000);
      // (held: 120 images drawn — a held raster view stays a realtime one, its history averaging them — or converged)
      const held = await app.js(`(async () => { const R = __bh.renderer, f = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(), n0 = R.completedFrames ?? 0;
      while (performance.now() - t0 < 60000) { if (R.lastPhase === "converged" || (R.completedFrames ?? 0) - n0 >= 120) break; __bh.touch(); await f(); }
      const g = __bh.camera.geoNow();
      return { phase: R.lastPhase, images: (R.completedFrames ?? 0) - n0, pending: R.earthTiles.pending, ortho: R.earthTiles.orthoPending,
        at: g ? { lat: +g.lat.toFixed(6), lon: +g.lon.toFixed(6), alt: +g.alt.toFixed(2) } : null,
        cover: R.earthTiles.coverAt?.() ?? null, version: R.earthTiles.pages?.version ?? R.earthTiles.imagery }; })()`);
      console.log(`  still held: ${JSON.stringify(held)}`);
      const sc = await app.js<{ png: string; width: number; height: number; source: string; meanLum: number }>(scenePngJs);
      await Bun.write(`${OUT}/still-scene.png`, Buffer.from(sc.png, "base64"));
      await app.shot(`${OUT}/still-screen.png`);
      out.still = { held, scene: { width: sc.width, height: sc.height, source: sc.source, meanLum: sc.meanLum } };
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      expect(out.gpuErrors).toBe(0);
    },
    400_000,
  );

  test.skipIf(!PHASES.includes("flight"))(
    "four views, each image's cover of the camera's and the craft's tiles",
    async () => {
      const [lat, lon, agl, hdg, spd] = AT;
      // (placed, the clock running for the cockpit mount, frozen; the relief in for 3 s; placed again on it — E2E-VOLS rule 5)
      const go = `(async () => { __bh.freeze(false); __bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("weather", "fair");
      __bh.game.set("earthClouds", 0); __bh.game.flyAt(${lat}, ${lon}, ${agl}, ${hdg}, ${spd}); __bh.settings.shipMount = "cockpit";
      __bh.refresh(); __bh.camera.viewReset(); for (let i = 0; i < 40; i++) await new Promise((q) => requestAnimationFrame(q));
      __bh.freeze(true); return __bh.settings.shipMount; })()`;
      await app.js(go);
      await app.settled(180_000);
      const relief = await app.js<{ ok: boolean; finest: number; pending: number }>(`(async () => {
      const t = __bh.renderer.earthTiles, frame = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < 60000) {
        const ok = t.pending === 0 && t.finest >= 14; calm = ok ? calm || performance.now() : 0;
        if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
      return { ok: calm > 0, finest: t.finest, pending: t.pending }; })()`);
      console.log(`  relief: ${JSON.stringify(relief)}`);
      await app.js(go);
      await app.dataSettled("the Beauce", { maxMs: 60_000 }).catch((e) => console.log(`  ${String(e).slice(0, 160)}`));
      await app.settled(60_000);
      out.placed = { relief, cover: await app.js(`__bh.renderer.earthTiles.coverAt()`) };
      // (the autopilot, the autothrottle and the gear held until they hold — the stable flight's protocol)
      const ap = await app.js<{ ap: boolean; athr: boolean }>(`(async () => { __bh.freeze(false);
      const c = __bh.camera, f = () => new Promise((q) => requestAnimationFrame(q));
      for (let i = 0; i < 90; i++) { await f(); __bh.settings.autoGear = false; c.gearDown = true; c.gearExt = 1; c.gearInit = true;
        if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        if (c.jetModes.alt !== null && c.jetModes.spd !== null && i > 10) break; }
      const g = c.geoNow(); if (g && c.jetModes.alt !== null) { c.jetModes.alt = g.alt; c.jetModes.hdg = ${hdg} * Math.PI / 180; }
      c.jetModes.spd = ${spd}; return { ap: c.jetModes.alt !== null, athr: c.jetModes.spd !== null }; })()`);
      if (!ap.ap || !ap.athr) throw new Error(`the autopilot ${ap.ap} / autothrottle ${ap.athr} not engaged`);
      const views: Record<string, unknown>[] = [];
      for (const v of VIEWS) {
        await within(
          app.js(`(async () => { ${v.set} for (let i = 0; i < 20; i++) await new Promise((q) => requestAnimationFrame(q)); return 1; })()`),
          20_000,
          `${v.name}: view set`,
        );
        const rows: Row[] = [];
        const chunks: Record<string, unknown>[] = [];
        let shots = 0,
          gapMax = 0;
        await app.shot(`${OUT}/${v.name}-start.png`);
        // (the tiles' publication counted over the view: J2-1's budget)
        const p0 = await app.js<number>(`(() => { __bh.renderer.earthTiles.pubProbe = true; return performance.now(); })()`);
        for (let k = 0; k < PHASE_S; k++) {
          const r = await within(
            app.js<{ rows: Row[]; gapMax: number; last: { holes: number[]; camZ: number; finest: number }; [k: string]: unknown }>(
              chunkJs(1000),
            ),
            20_000,
            `${v.name} at ${k} s`,
          );
          rows.push(...r.rows);
          gapMax = Math.max(gapMax, r.gapMax);
          const { rows: _r, ...rest } = r;
          chunks.push(rest);
          if (r.last.holes.length && shots < 2) {
            shots++;
            await app.shot(`${OUT}/${v.name}-hole-${shots}.png`);
            console.log(`  ${v.name} ${k} s: hole under the camera — ${JSON.stringify(r.last)}`);
          }
        }
        await app.shot(`${OUT}/${v.name}-end.png`);
        const publication = await app.js(`__bh.renderer.earthTiles.pubStats(${p0})`);
        // (each image: a hole under the camera — a level published without its tile —, under the craft; their streaks)
        const t0 = rows[0]?.[0] ?? 0;
        const holeRows = rows.filter((r) => r[5] !== "");
        const atRows = rows.filter((r) => r[6] !== "");
        const coarser = rows.filter((r) => r[1] < r[3]);
        let best = 0,
          from = -1;
        for (const r of rows) {
          if (r[5] !== "") {
            if (from < 0) from = r[0];
            best = Math.max(best, r[0] - from);
          } else from = -1;
        }
        const levels: Record<string, number> = {};
        for (const r of holeRows) for (const z of r[5].split(" ")) levels[z] = (levels[z] ?? 0) + 1;
        const summary = {
          view: v.name,
          images: rows.length,
          camHoleImages: holeRows.length,
          craftHoleImages: atRows.length,
          camCoarserImages: coarser.length,
          longestCamHoleMs: Math.round(best),
          holeLevels: levels,
          camZ: [Math.min(...rows.map((r) => r[1])), Math.max(...rows.map((r) => r[1]))],
          finest: [Math.min(...rows.map((r) => r[3])), Math.max(...rows.map((r) => r[3]))],
          wantZ: [Math.min(...rows.map((r) => r[4])), Math.max(...rows.map((r) => r[4]))],
          gapMaxMs: gapMax,
          publication,
          first: chunks[0],
          lastChunk: chunks[chunks.length - 1],
        };
        console.log(`  ${v.name}: ${JSON.stringify(summary)}`);
        views.push({ ...summary, rows: rows.map((r) => [+(r[0] - t0).toFixed(0), ...r.slice(1)]) });
      }
      out.views = views;
      out.gpuErrors = await app.js<number>(`__bh.renderer.gpuErrors`);
      expect(out.gpuErrors).toBe(0);
    },
    600_000,
  );
});
