// The flight's jitter lab (docs/progress/JITTER-VOL.md, docs/progress/HORIZON-FLICKER.md): a craft flown in a real Chrome,
// its image filmed frame by frame (the DevTools screencast: each frame the compositor makes, with its time) while the
// page's jitter probe (src/jitter) records what placed each image; stretches with one cause taken out at a time (the
// levers); then each stretch analysed:
// - its tremble by cause — from the probe (the craft's motion, the rig, the camera shake, the display shake, the pacing)
//   and from the video (what the screen really showed: every tile's tremble, the renderer's own with the flight held);
// - its flicker — a 32 px cell's brightness coming and going from one frame to the next (scripts/lib/jitter-video.ts
//   flickerCells): where (a map, a profile by row), how strong, at what frequency.
// Each stretch leaves video.mp4 (to watch, each frame its own duration), flicker.mp4 (the frames' second difference ×8:
// what blinks shows white), the figures in report.json and report.md.
//
//   bun scripts/jitter-lab.ts [--craft f35|ranger|a320] [--view cockpit|chase] [--seconds 6] [--speed 230] [--agl 300]
//        [--at lat,lon] [--tiles] [--width 1440 --height 900] [--segments base,noDisplay,noShakes,fixedStep,frozen]
//        [--out dir] [--settings '{…}'] [--date 2026-07-10T10:30:00Z] [--levers 'name::js|name::js'] [--clean]
//
// Level flight, the height and the speed held: the tremble and the flicker show in any flight, no manoeuvre is needed.
// --levers adds stretches of its own after the named ones: each its page code (renderer switches, settings), the shakes
// out; every shader compiled before any stretch is filmed (5 s with none pending).
//
// On kerr-mini (full screen, the real display's pacing): bun scripts/remote.ts run -- bun scripts/jitter-lab.ts …
// Takes the Mac's Chrome lock (tests/e2e/lib/app.ts).

import { mkdirSync, writeFileSync } from "node:fs";
import type { JitterReport } from "../src/jitter/analyze";
import { App, stopServer } from "../tests/e2e/lib/app";
import {
  cellGrid,
  type FlickerCell,
  flicker,
  flickerCells,
  flickerFrames,
  rowBand,
  rowFlicker,
  type TileJitter,
  tileJitter,
  trackTiles,
} from "./lib/jitter-video";

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : (process.argv[i + 1] ?? d);
};
const flag = (k: string) => process.argv.includes(`--${k}`);
const CRAFT = arg("craft", "f35")!;
const VIEW = arg("view", "cockpit")!;
const SECONDS = Number(arg("seconds", "6"));
const SPEED = Number(arg("speed", "230"));
const AGL = Number(arg("agl", "300"));
const [LAT, LON] = (arg("at", "48.30,1.60") ?? "").split(",").map(Number) as [number, number];
// (the page's size: asked, or the screen's in a full-screen Chrome — read once booted)
let W = Number(arg("width", "1440")),
  H = Number(arg("height", "900"));
const OUT = arg("out", `remote-results/jitter/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${CRAFT}-${VIEW}`)!;
const EXTRA = arg("settings", "{}")!;
const DATE = arg("date", "2026-07-10T10:30:00Z")!;
/** --clean: only the 3D image filmed — every other element of the page hidden (the HUD's lines, its figures: a DOM line moving
 *  a pixel blinks a whole row as much as the image would) */
const CLEAN = flag("clean");
// (name::page code, separated by |: the code may hold ; and =)
const LEVERS = (arg("levers", "") ?? "")
  .split("|")
  .filter((x) => x.includes("::"))
  .map((x) => [x.slice(0, x.indexOf("::")).trim(), x.slice(x.indexOf("::") + 2)] as [string, string]);
/** the analysed frames' width [px] (the tiles' 128 px each, the flicker's cells 32) */
const AW = 960;

/** The stretches: each its levers (js run in the page), held still or not. */
const SEGMENTS: Record<string, { js: string; still?: boolean; what: string }> = {
  base: { js: `__bh.jitter.levers({ airShake: 1, step: null }); __bh.settings.flightShake = SHAKE;`, what: "as played" },
  noDisplay: {
    js: `__bh.jitter.levers({ airShake: 0, step: null }); __bh.settings.flightShake = SHAKE;`,
    what: "the display shake out",
  },
  noShakes: {
    js: `__bh.jitter.levers({ airShake: 0, step: null }); __bh.settings.flightShake = 0;`,
    what: "the display and camera shakes out",
  },
  fixedStep: {
    js: `__bh.jitter.levers({ airShake: 0, step: STEP }); __bh.settings.flightShake = 0;`,
    what: "no shakes, the flight stepped by a fixed step each frame (the pacing out)",
  },
  frozen: {
    js: `__bh.jitter.levers({ airShake: 0, step: null }); __bh.settings.flightShake = 0; __bh.freeze(true);`,
    still: true,
    what: "the flight held: only the renderer can move the image",
  },
};
for (const [name, js] of LEVERS)
  SEGMENTS[name] = { js: `__bh.jitter.levers({ airShake: 0, step: null }); __bh.settings.flightShake = 0; ${js};`, what: js };
const ORDER = [
  ...(arg("segments", "base,noDisplay,noShakes,fixedStep,frozen") ?? "").split(",").filter((s) => SEGMENTS[s]),
  ...LEVERS.map(([n]) => n),
];

const sh = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const code = await p.exited;
  if (code) throw new Error(`${cmd[0]} failed (${code}): ${(await new Response(p.stderr).text()).slice(-600)}`);
  return new Response(p.stdout).arrayBuffer();
};

/** Every shader in — the scene's, the raster's, a lever's own variant (minutes on an M1) —: 5 s with none pending. */
async function settle(app: App, what: string) {
  const t0 = Date.now();
  let quiet = 0;
  while (Date.now() - t0 < 900_000) {
    const pend = await app.js<number>(`__bh.renderer.compilesPending`);
    quiet = pend === 0 ? quiet + 1 : 0;
    if (quiet >= 10) return;
    await Bun.sleep(500);
  }
  console.warn(`  ${what}: shaders still compiling after 15 min`);
}

interface Frame {
  t: number;
  file: string;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`jitter lab: ${CRAFT}, ${VIEW}, ${SPEED} m/s at ${AGL} m over ${LAT},${LON} — ${ORDER.join(", ")} — ${OUT}`);
  const app = await App.boot({ width: W, height: H, hash: "scene=game:artemis", tiles: flag("tiles"), telemetry: false });
  try {
    [W, H] = await app.js<[number, number]>(`[innerWidth, innerHeight]`);
    await app.js(
      `(() => { __bh.settings.vessel = "${CRAFT}"; Object.assign(__bh.settings, { traffic: false, dof: false, autoGear: false, f35AutoProtect: false, ...${EXTRA} }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "${CRAFT}"`, 60_000);
    await app.js(`(() => { __bh.game.setDate("${DATE}"); return 1; })()`);
    await Bun.sleep(800);
    const place = `__bh.game.flyAt(${LAT}, ${LON}, ${AGL}, 90, ${SPEED}); __bh.settings.shipMount = "${VIEW}";
      { const c = __bh.camera; c.gearDown = false; c.gearExt = 0; c.gearInit = true; }`;
    await app.js(`(() => { ${place} __bh.freeze(true); return 1; })()`);
    if (flag("tiles"))
      await app
        .waitFor(`(() => { const t = __bh.renderer.earthTiles; return t.finest >= 13 && t.pending === 0; })()`, 120_000)
        .catch(() => console.warn("  tiles not all in"));
    await app.js(`(() => { ${place} return 1; })()`);
    await app.settled();
    await app.js(`(__bh.freeze(false), __bh.settings.showFps = false, 1)`);
    if (CLEAN)
      await app.js(`(() => { const st = document.createElement("style");
        st.textContent = "body.jitter-clean * { visibility: hidden !important; } body.jitter-clean #view { visibility: visible !important; }";
        document.head.append(st); document.body.classList.add("jitter-clean"); return 1; })()`);
    await Bun.sleep(1000);
    // (the height and the speed held: the jet's autopilot and autothrottle, where the craft has them)
    await app
      .js(`(() => { const c = __bh.camera; c.pilot.throttle = 0.8; try { if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");
        if (c.jetModes.spd !== null) c.jetModes.spd = ${SPEED}; } catch (e) { return String(e); } return 1; })()`)
      .then((r) => r !== 1 && console.warn(`  holds: ${r}`));
    // (the kernels of what is in view compiled — a compile's stall is no tremble, a stand-in kernel's look no flicker)
    await settle(app, "the flight");
    await Bun.sleep(2000);
    // (flying — not crashed, at speed: else the figures would be a wreck's)
    const state = await app.js<{
      lost: boolean;
      speed: number;
      q: number;
      eng: number;
    }>(`(() => ({ lost: !!document.querySelector(".craft-lost"),
      speed: __bh.camera.airFlight.last?.speed ?? 0, q: __bh.camera.airFlight.last?.out.q ?? 0, eng: __bh.camera.pilot.engineNow }))()`);
    console.log(`  flying: ${JSON.stringify(state)}`);
    if (state.lost || state.speed < 0.5 * SPEED) throw new Error(`not flying as asked: ${JSON.stringify(state)}`);
    const shake = await app.js<number>(`__bh.settings.flightShake`);
    await app.js(`(__bh.jitter.start(40000), 1)`);
    const results: Record<string, unknown>[] = [];
    for (const name of ORDER) {
      const seg = SEGMENTS[name]!;
      // (the fixed step: the loop's median interval — the same flight speed as played)
      const step = await app.js<number>(`(__bh.renderer.refreshMs || 16.7) / 1000`);
      const fpsNow = await app.js<number>(`__bh.game.perf({ gpu: false }).renderFps`);
      const fixed = fpsNow > 0 ? 1 / fpsNow : step;
      await app.js(`(() => { ${seg.js.replace("SHAKE", String(shake)).replace("STEP", String(fixed))} return 1; })()`);
      await Bun.sleep(1500);
      await settle(app, name);
      const dir = `${OUT}/${name}`;
      mkdirSync(`${dir}/frames`, { recursive: true });
      const frames: Frame[] = [];
      const off = app.cdp.on("Page.screencastFrame", (p) => {
        const m = p.metadata as { timestamp: number };
        const file = `${dir}/frames/${String(frames.length).padStart(6, "0")}.jpg`;
        frames.push({ t: m.timestamp, file });
        void Bun.write(file, Buffer.from(p.data as string, "base64"));
        void app.cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
      });
      const from = await app.js<number>(`(__bh.jitter.mark("${name}"), performance.now())`);
      await app.cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
      await Bun.sleep(SECONDS * 1000);
      await app.cdp.send("Page.stopScreencast");
      const to = await app.js<number>(`performance.now()`);
      off();
      if (seg.still) await app.js(`(__bh.freeze(false), 1)`);
      await Bun.sleep(300);
      // (the raster's visibility down the middle column: where each ring begins, where it ends — the tracer's beyond —, in
      // output px from the top)
      const seams = await app.js<{ y: number; d: number; from: number; to: number }[] | null>(`(async () => {
        const c = await __bh.renderer.rasterColumn(0.5); if (!c) return null;
        const k = ${H} / c.height, out = [];
        for (let y = 1; y < c.rows.length; y++) { const a = c.rows[y - 1], b = c.rows[y];
          if (a.step !== b.step) out.push({ y: Math.round(y * k), d: Math.round(b.d || a.d), from: a.step, to: b.step }); }
        return out; })()`);
      const probe = await app.js<JitterReport>(`__bh.jitter.report({ from: ${from}, to: ${to} })`);
      const samples = await app.js<{ rate: number; scale: number }[]>(`__bh.jitter.samples(${from}).filter((s) => s.t <= ${to})`);
      writeFileSync(`${dir}/samples.json`, JSON.stringify(samples));
      // (the video: each frame its own duration — the screen's rhythm kept)
      const video = await film(dir, frames);
      const vid = await analyseVideo(dir, frames, !!seg.still);
      // (the raster's shading rates and render scales seen: rate@scale)
      const block = await app.js<number>(`__bh.renderer.realtimeBlockNow`);
      const rates = [...new Set(samples.map((x) => `${x.rate}@${x.scale}`)), `block ${block}`];
      const r = { segment: name, what: seg.what, frames: frames.length, rates, seams, video: { file: video, ...vid.summary }, probe };
      results.push(r);
      writeFileSync(`${dir}/tiles.json`, JSON.stringify(vid.tiles, null, 1));
      console.log(line(r));
      if (seams)
        console.log(`             seams (row: step from→to, at m): ${seams.map((x) => `${x.y}: ${x.from}→${x.to} ${x.d} m`).join(" · ")}`);
    }
    await app.js(`(__bh.jitter.stop(), __bh.jitter.levers({ airShake: 1, step: null }), 1)`);
    writeFileSync(
      `${OUT}/report.json`,
      JSON.stringify({ craft: CRAFT, view: VIEW, speed: SPEED, agl: AGL, at: [LAT, LON], W, H, results }, null, 1),
    );
    writeFileSync(`${OUT}/report.md`, markdown(results));
    console.log(`\nreport: ${OUT}/report.md`);
  } finally {
    app.close();
    stopServer();
  }
}

async function film(dir: string, frames: Frame[]) {
  if (frames.length < 2) return "";
  await Bun.sleep(300); // (the last frames' writes)
  const list = frames
    .map((f, i) => `file '${f.file.split("/").pop()}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? f.t + 1 / 30) - f.t).toFixed(5)}`)
    .join("\n");
  writeFileSync(`${dir}/frames/list.txt`, `${list}\nfile '${frames[frames.length - 1]!.file.split("/").pop()}'\n`);
  const out = `${dir}/video.mp4`;
  await sh(
    `ffmpeg -y -loglevel error -f concat -safe 0 -i ${dir}/frames/list.txt -vf pad=ceil(iw/2)*2:ceil(ih/2)*2 -fps_mode vfr -c:v libx264 -crf 16 -pix_fmt yuv420p ${out}`.split(
      " ",
    ),
  );
  return out;
}

/** Grey frames to an MP4 (the flicker made visible). */
async function filmGray(out: string, frames: Uint8Array[], w: number, h: number, fps: number) {
  const p = Bun.spawn(
    `ffmpeg -y -loglevel error -f rawvideo -pix_fmt gray -s ${w}x${h} -r ${fps.toFixed(3)} -i - -c:v libx264 -crf 18 -pix_fmt yuv420p ${out}`.split(
      " ",
    ),
    { stdin: "pipe", stdout: "ignore", stderr: "ignore" },
  );
  for (const f of frames) p.stdin.write(f);
  await p.stdin.end();
  await p.exited;
}

async function analyseVideo(dir: string, frames: Frame[], still: boolean) {
  if (frames.length < 8) return { summary: { error: "too few frames" }, tiles: [] as TileJitter[] };
  const ah = Math.round((AW * H) / W / 2) * 2;
  const raw = new Uint8Array(
    await sh(
      `ffmpeg -loglevel error -start_number 0 -i ${dir}/frames/%06d.jpg -vf scale=${AW}:${ah}:flags=area,format=gray -f rawvideo -`.split(
        " ",
      ),
    ),
  );
  const n = Math.floor(raw.length / (AW * ah));
  const gray = Array.from({ length: n }, (_, i) => raw.subarray(i * AW * ah, (i + 1) * AW * ah));
  const times = frames.slice(0, n).map((f) => f.t - frames[0]!.t);
  const vfps = times.length > 1 ? (times.length - 1) / times[times.length - 1]! : 30;
  // (the flicker: each cell's blink, its map, the second difference made visible)
  const cells = flickerCells(gray, AW, ah, vfps, 32);
  writeFileSync(`${dir}/flicker.json`, JSON.stringify(cells));
  // (by row: a band whose edge or brightness jumps along the whole row — the horizon's)
  const rows = rowFlicker(gray, AW, ah);
  writeFileSync(`${dir}/rows.json`, JSON.stringify(rows));
  const band = rowBand(rows);
  const toOut = H / ah;
  await filmGray(`${dir}/flicker.mp4`, flickerFrames(gray), AW, ah, vfps);
  const tracks = trackTiles(gray, AW, ah, 128);
  const tiles = tileJitter(tracks, times, W / AW, still);
  const ok = tiles.filter((t) => t.trusted > 0.6 && Number.isFinite(t.rms)).sort((a, b) => a.rms - b.rms);
  const iv = times.slice(1).map((t, i) => (t - times[i]!) * 1000);
  const ivs = [...iv].sort((a, b) => a - b);
  const med = ivs[ivs.length >> 1] ?? 0;
  const q = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1)))] ?? Number.NaN;
  return {
    tiles,
    summary: {
      fps: vfps,
      intervalMs: {
        median: med,
        p95: q(ivs, 0.95),
        max: ivs[ivs.length - 1] ?? 0,
        irregular: iv.filter((x) => Math.abs(x - med) > 0.25 * med).length / (iv.length || 1),
      },
      tilesTrusted: ok.length,
      tilesTotal: tiles.length,
      /** the tiles' jitter [output px a frame]: median, 90th percentile (the worst parts of the image) */
      jitterMedian: q(
        ok.map((t) => t.rms),
        0.5,
      ),
      jitterP90: q(
        ok.map((t) => t.rms),
        0.9,
      ),
      /** the tiles' median move [px a frame] (the image's speed) */
      moveMedian: q(
        ok.map((t) => t.move).sort((a, b) => a - b),
        0.5,
      ),
      meanChange: flicker(gray),
      /** a map of the image: each tile's jitter (rows top to bottom; "·" untrusted) */
      grid: gridOf(tiles),
      flicker: flickerSummary(cells),
      /** the strongest band of rows [output px, from the top]: its rows, its peak, the peak row mean's blink [grey], its ac1 */
      band: {
        from: Math.round(band.from * toOut),
        to: Math.round(band.to * toOut),
        peak: Math.round(band.peak * toOut),
        blink: +band.blink.toFixed(2),
        ac1: +band.ac1.toFixed(2),
        median: +band.median.toFixed(2),
      },
    },
  };
}

/** The flicker's figures: by row (the cells' mean blink, its strongest), the worst cells (their place, size, frequency). */
function flickerSummary(cells: FlickerCell[]) {
  const rows = Math.max(...cells.map((c) => c.row)) + 1;
  const byRow = Array.from({ length: rows }, (_, r) => {
    const rc = cells.filter((c) => c.row === r);
    const bl = rc.map((c) => c.blink).sort((a, b) => a - b);
    return {
      row: r,
      y: +rc[0]!.cy.toFixed(3),
      lum: +(rc.reduce((a, c) => a + c.mean, 0) / rc.length).toFixed(1),
      blink: +(bl.reduce((a, b) => a + b, 0) / bl.length).toFixed(3),
      blinkMax: +(bl[bl.length - 1] ?? 0).toFixed(3),
      pix: +(rc.reduce((a, c) => a + c.pix, 0) / rc.length).toFixed(3),
    };
  });
  const worst = [...cells]
    .sort((a, b) => b.blink - a.blink)
    .slice(0, 12)
    .map((c) => ({
      col: c.col,
      row: c.row,
      x: +c.cx.toFixed(2),
      y: +c.cy.toFixed(2),
      blink: +c.blink.toFixed(2),
      p95: +c.blinkP95.toFixed(2),
      pix: +c.pix.toFixed(2),
      freqHz: +c.freqHz.toFixed(2),
      share: +c.share.toFixed(2),
      lum: +c.mean.toFixed(0),
    }));
  const all = cells.map((c) => c.blink).sort((a, b) => a - b);
  return {
    blinkMedian: all[all.length >> 1] ?? 0,
    blinkP99: all[Math.floor(0.99 * (all.length - 1))] ?? 0,
    byRow,
    worst,
    grid: cellGrid(cells, (c) => c.blink),
    pixGrid: cellGrid(cells, (c) => c.pix),
  };
}

function gridOf(tiles: TileJitter[]) {
  const rows = Math.max(...tiles.map((t) => t.row)) + 1;
  return Array.from({ length: rows }, (_, r) =>
    tiles
      .filter((t) => t.row === r)
      .sort((a, b) => a.col - b.col)
      .map((t) => (t.trusted > 0.6 && Number.isFinite(t.rms) ? t.rms.toFixed(1).padStart(5) : "    ·"))
      .join(" "),
  );
}

const bd = (v: Record<string, unknown>) =>
  (v.band ?? { from: 0, to: 0, peak: 0, blink: Number.NaN, ac1: Number.NaN, median: Number.NaN }) as {
    from: number;
    to: number;
    peak: number;
    blink: number;
    ac1: number;
    median: number;
  };
const f = (x: unknown, d = 2) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(d) : "—");
const fl = (v: Record<string, unknown>) =>
  (v.flicker ?? { blinkMedian: Number.NaN, blinkP99: Number.NaN, worst: [], grid: [], pixGrid: [], byRow: [] }) as ReturnType<
    typeof flickerSummary
  >;

function line(r: Record<string, unknown>) {
  const v = r.video as Record<string, number>;
  const p = r.probe as JitterReport;
  const F = fl(v as unknown as Record<string, unknown>);
  return (
    `  ${String(r.segment).padEnd(10)} video ${f(v.fps, 1)} i/s, tremble ${f(v.jitterMedian)} px (p90 ${f(v.jitterP90)}), move ${f(v.moveMedian, 1)} px/frame` +
    ` · probe ${f(p.fps, 1)} i/s, dt cov ${f(p.dt.cov)}; flight ${f(p.channels.flight.rms)}, mount ${f(p.channels.mount.rms)}, camShake ${f(p.channels.camShake.rms)},` +
    ` display ${f(p.channels.display.rms)} (${f(p.channels.display.freqHz, 1)} Hz), pacing ${f(p.channels.pacing.rms)} px` +
    `\n             band: rows ${bd(v).from}–${bd(v).to} (peak ${bd(v).peak}) blink ${f(bd(v).blink)} grey (rows' median ${f(bd(v).median)}), ac1 ${f(bd(v).ac1)}` +
    `\n             flicker: median ${f(F.blinkMedian)}, p99 ${f(F.blinkP99)} grey; worst ${F.worst
      .slice(0, 4)
      .map((c) => `(${c.x},${c.y}) ${c.blink} @${c.freqHz} Hz`)
      .join(" · ")} · rates ${(r.rates as string[]).join(" ")}`
  );
}

function markdown(results: Record<string, unknown>[]) {
  const rows = results.map((r) => {
    const v = r.video as Record<string, number>;
    const p = r.probe as JitterReport;
    const F = fl(v as unknown as Record<string, unknown>);
    return `| ${r.segment} | ${r.what} | ${f(v.fps, 1)} | ${f(v.intervalMs && (v.intervalMs as unknown as { median: number }).median, 1)} | ${f(v.jitterMedian)} | ${f(v.jitterP90)} | ${f(F.blinkMedian)} | ${f(F.blinkP99)} | ${bd(v as unknown as Record<string, unknown>).from}–${bd(v as unknown as Record<string, unknown>).to} (${bd(v as unknown as Record<string, unknown>).peak}) | ${f(bd(v as unknown as Record<string, unknown>).blink)} | ${f(bd(v as unknown as Record<string, unknown>).ac1)} | ${f(p.channels.flight.rms)} | ${f(p.channels.mount.rms)} | ${f(p.channels.camShake.rms)} | ${f(p.channels.display.rms)} | ${f(p.channels.pacing.rms)} | ${f(p.dt.cov)} | ${(r.rates as string[]).join(" ")} |`;
  });
  const grids = results.map((r) => {
    const F = fl(r.video as Record<string, unknown>);
    return (
      `### ${r.segment}\n\nTremble (each 128 px tile, px a frame):\n\n\`\`\`\n${((r.video as { grid?: string[] }).grid ?? []).join("\n")}\n\`\`\`\n\n` +
      `${(r.probe as JitterReport).verdict}\n\nFlicker (each 32 px cell's blink, grey levels, rows top to bottom):\n\n\`\`\`\n${F.grid.join("\n")}\n\`\`\`\n\n` +
      `Worst cells: ${F.worst.map((c) => `(${c.x}, ${c.y}) ${c.blink} grey @ ${c.freqHz} Hz (${Math.round(c.share * 100)} %)`).join(" · ")}\n`
    );
  });
  return `# Jitter lab — ${CRAFT}, ${VIEW}, ${SPEED} m/s at ${AGL} m

Output pixels (${W}×${H}). Video: what the screen showed (screencast). Tremble: each tile's move less its speed's local trend
(with the flight held: its move), px a frame. Flicker: each 32 px cell's mean brightness against its neighbouring frames'
(|m_k − (m_{k−1} + m_{k+1}) / 2|, rms, grey levels of 255). Probe: the tremble measure on each layer that places the image.

| stretch | what | video i/s | interval ms | tremble (median) | p90 | flicker (median) | flicker p99 | band rows (peak) | band blink | band ac1 | flight | mount | camShake | display | pacing | dt cov | rate@scale |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

## The image's maps

${grids.join("\n")}
`;
}

await main();
