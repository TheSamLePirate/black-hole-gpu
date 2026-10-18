// The F-35's panoramic display's CPU cost in the running app (docs/PLAN-PCD-AAA.md, Q1): a headless Chrome, the F-35
// lined up at Edwards, the cockpit view; __bh.pcd.stats read over a few seconds (the data, the drawing, the upload).
//
//   bun scripts/pcd-perf.ts [seconds] [runs]
import { App, stopServer } from "../tests/e2e/lib/app";

const secs = Number(process.argv[2] ?? 8);
const runs = Number(process.argv[3] ?? 3);
const app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true, telemetry: false });
try {
  await app.waitFor("__bh.camera.piloting", 120_000);
  await app.js(`(() => {
    __bh.freeze(true);
    __bh.settings.vessel = "f35";
    for (let i = 0; i < 5; i++) __bh.step(1 / 30);
    __bh.game.lineUp("Edwards");
    for (let i = 0; i < 5; i++) __bh.step(1 / 30);
    __bh.settings.shipMount = "chase";
    __bh.freeze(false);
    return true;
  })()`);
  await Bun.sleep(12_000);
  await app.waitFor(`!document.body.innerText.includes("Compiling the ray tracer")`, 240_000).catch(() => {});
  // (into the cockpit: the first frames' worst — the display's first drawing)
  await app.js(`(() => { __bh.pcd.stats.reset(); __bh.settings.shipMount = "cockpit"; return true; })()`);
  await Bun.sleep(1500);
  const first = await app.js(`(() => ({ ...__bh.pcd.stats }))()`);
  console.log("entering:", JSON.stringify({ max: +first.max.toFixed(2), frames: first.frames }));
  for (let r = 0; r < runs; r++) {
    await app.js(`(() => { __bh.pcd.stats.reset(); window.__ft = []; let last = performance.now();
      const f = (t) => { window.__ft.push(t - last); last = t; if (window.__ft.length < 2000) requestAnimationFrame(f); }; requestAnimationFrame(f); return true; })()`);
    await Bun.sleep(secs * 1000);
    const s = await app.js(`(() => { const s = __bh.pcd.stats; const ft = window.__ft.slice().sort((a, b) => a - b);
      return { frames: s.frames, draws: s.draws, mean: s.ms / Math.max(s.frames, 1), up: s.up / Math.max(s.frames, 1), max: s.max,
        frameMed: ft[ft.length >> 1], frameP99: ft[Math.floor(ft.length * 0.99)] }; })()`);
    console.log(
      `run ${r + 1}: mean ${s.mean.toFixed(3)} ms/frame (upload ${s.up.toFixed(3)}) · max ${s.max.toFixed(2)} ms · ${s.draws} draws / ${s.frames} frames · frame median ${s.frameMed.toFixed(1)} ms, p99 ${s.frameP99.toFixed(1)} ms`,
    );
  }
} finally {
  app.close();
  stopServer();
}
