// (a diagnosis, not in `bun run e2e`: STORM_DIAG=1) The storm's sky from the F-35's cockpit at 300 m, the same frozen view drawn
// with one part at a time switched off — the white squares seen in it (docs/PLAN-PLUIE.md P7): which pass draws them.
// Shots remote-results/storm-diag/<mode>.png.
import { afterAll, beforeAll, describe, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

const MODES: Record<string, string> = {
  all: `__bh.renderer.tune = {}; Object.assign(__bh.renderer, { cloudPassOn: true, cloudHistoryOn: true });`,
  norain: `__bh.renderer.tune = { TUNE_GSKIP: 65536 };`,
  nocsm: `__bh.renderer.tune = { TUNE_GSKIP: 8192 };`,
  nopass: `__bh.renderer.tune = {}; __bh.renderer.cloudPassOn = false;`,
  nohist: `__bh.renderer.tune = {}; Object.assign(__bh.renderer, { cloudPassOn: true, cloudHistoryOn: false });`,
  nolight: `__bh.renderer.tune = { TUNE_CLOUD_LIGHT: 0 }; Object.assign(__bh.renderer, { cloudPassOn: true, cloudHistoryOn: true });`,
  ref: `__bh.renderer.tune = {}; __bh.settings.earthPipeline = "trace"; __bh.settings.targetSpp = 64;`,
  nobolt: `__bh.renderer.tune = {}; Object.assign(__bh.renderer, { cloudPassOn: true, cloudHistoryOn: true }); __bh.renderer.lightning && (__bh.renderer.lightning.enabled = false);`,
};
const modes = (process.env.MODES ?? Object.keys(MODES).join(",")).split(",");

describe.skipIf(!E2E || process.env.STORM_DIAG !== "1")("the storm's white squares", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, lang: "fr", hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, showFps: true, autosave: false, f35AutoProtect: true, f35Invulnerable: true }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.quality("realtime"); Object.assign(__bh.settings, { dynamicResolution: false, targetSpp: 0,
      earthPipeline: "raster", shipMount: "cockpit" }); __bh.game.setDate("2026-07-10T11:00:00Z"); __bh.game.set("earthClouds", 1);
      __bh.game.set("weather", "storm"); __bh.game.flyAt(36.08, -5.6, 300, 20, 220);
      const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); return 1; })()`);
    // (frozen at once — the same view however long the kernels take —, then the kernels and the tiles waited for)
    await app.js(`(async () => { const frame = () => new Promise((q) => requestAnimationFrame(q));
      for (let i = 0; i < 10; i++) await frame(); __bh.freeze(true); return 1; })()`);
    await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
    await app.js(`(async () => { const r = __bh.renderer, frame = () => new Promise((q) => requestAnimationFrame(q));
      const t0 = performance.now(); let calm = 0;
      while (performance.now() - t0 < 60000) { const ok = r.earthTiles.pending === 0; calm = ok ? calm || performance.now() : 0;
        if (calm && performance.now() - calm > 3000) break; __bh.touch(); await frame(); }
      return 1; })()`);
    await Bun.$`mkdir -p remote-results/storm-diag`;
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  test("each part off in turn", async () => {
    for (const m of modes) {
      await app.js(`(() => { ${MODES[m]} __bh.touch(); return 1; })()`);
      await app.waitFor(`!!__bh.renderer.variantReady`, 300_000).catch(() => {});
      // (every kernel the mode asks for compiled: no shot of the last one's image)
      await app.js(
        `(async () => { const frame = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 30; i++) await frame(); return 1; })()`,
      );
      await app.waitFor(`__bh.renderer.compilingNow.length === 0`, 600_000).catch(() => console.log("  (still compiling)"));
      await app.js(`(async () => { const frame = () => new Promise((q) => requestAnimationFrame(q));
        if (${m === "ref"}) { for (let i = 0; i < 600 && __bh.renderer.lastPhase !== "converged"; i++) await frame(); return 1; }
        for (let i = 0; i < 90; i++) { __bh.touch(); await frame(); } return 1; })()`);
      await app.shot(`remote-results/storm-diag/${m}.png`);
      // (the cloud pass's textures read back: this frame's march, the history's result — where they differ most)
      const st = await app.js(`(async () => { const r = __bh.renderer, t = r.live, d = r.device;
        const read = async (tex) => { const w = tex.width, h = tex.height, bpr = Math.ceil(w * 16 / 256) * 256;
          const b = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          const e = d.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: b, bytesPerRow: bpr }, [w, h]);
          d.queue.submit([e.finish()]); await b.mapAsync(GPUMapMode.READ); const f = new Float32Array(b.getMappedRange().slice(0)); b.unmap();
          return { f, w, h, row: bpr / 4 }; };
        const C = await read(t.cloudCurA), A = await read(t.cloudA), B = await read(t.cloudCurB);
        const L = (x, i) => 0.2126 * x.f[i] + 0.7152 * x.f[i + 1] + 0.0722 * x.f[i + 2];
        let worst = [], nf = 0, maxC = 0;
        for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) { const i = y * C.row + x * 4;
          if (!Number.isFinite(C.f[i]) || !Number.isFinite(A.f[i])) nf++;
          const lc = L(C, i), la = L(A, i); if (C.f[i + 3] > 0.25) maxC = Math.max(maxC, lc);
          worst.push([C.f[i + 3] > 0.9 && A.f[i + 3] > 0.9 ? la - lc : -1, x, y, lc, C.f[i + 3], la, A.f[i + 3], B.f[i], B.f[i + 1], B.f[i + 2]]); }
        worst.sort((a, b) => b[0] - a[0]);
        const [, wx, wy] = worst[0]; const nb = [];
        for (let j = -2; j <= 2; j++) { const row = []; for (let i = -2; i <= 2; i++) { const k = (wy + j) * C.row + (wx + i) * 4;
          row.push((L(C, k) * 1e6).toFixed(1) + "/" + (L(A, k) * 1e6).toFixed(1)); } nb.push(row.join(" ")); }
        return { nb, nf, maxC, w: C.w, h: C.h, worst: worst.slice(0, 8).map((r) => r.map((v) => +(+v).toPrecision(4))) }; })()`);
      console.log(`  ${m}`, JSON.stringify(st));
    }
  }, 1_200_000);
});
