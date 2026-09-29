// Frame-time benchmark of the reference scenes (audit §17), in a headless Chrome over the DevTools
// protocol, against a running server (bun --hot server.ts):
//
//   bun scripts/bench.ts [--url http://localhost:3000/] [--label name] [--scenes a,b] [--quick]
//
// For each scene: the Game quality, its automatic subsampling and dynamic resolution — the frame
// intervals' p50/p95/p99, frames over 33 ms, the rays per displayed pixel —, then a fixed setting
// (subsampling 4, full scale) whose frame time compares commits (the controllers otherwise turn a
// faster kernel into a sharper image). The GPU memory the page allocated is summed from its
// createTexture/createBuffer calls. Writes docs/perf/bench-<label>.json.
//
// Measure alone: another page rendering (the browser pane, a second headless) shares the GPU and
// halves both. Chrome is killed on exit.
import { tmpdir } from "node:os";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const URL = arg("url", "http://localhost:3000/");
const quick = process.argv.includes("--quick");
const SCENES = arg("scenes", "")
  ? arg("scenes", "").split(",")
  : [
      "game:artemis",
      "Ranger: approaching Gargantua",
      "Interstellar: along the disk (the film's close pass)",
      "Kerr a=0.94, near edge-on",
      "Saturn: backlit",
      "Interstellar: wormhole to Gargantua",
      "Moon: an afternoon on the plains",
      "Miller: Gargantua over the sea",
    ];
const sha = (await Bun.$`git rev-parse --short HEAD`.text()).trim();
const label = arg("label", sha);
const port = 9350 + Math.floor(Math.random() * 40);
const W = 1469, H = 965, DPR = 2;

const chrome = Bun.spawn([
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${tmpdir()}/kerr-bench-profile`,
  "--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", `--window-size=${W},${H}`, "--no-first-run",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank",
], { stdout: "ignore", stderr: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kill = () => {
  chrome.kill();
  Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
};
process.on("SIGINT", () => (kill(), process.exit(1)));

// (the page's GPU allocations, summed: textures by format, size, layers and mips; buffers)
const VRAM_HOOK = `(() => {
  const B = { rgba8unorm: 4, "rgba8unorm-srgb": 4, bgra8unorm: 4, "bgra8unorm-srgb": 4, rgba16float: 8, rgba32float: 16, r32float: 4,
    rg32float: 8, r16float: 2, rg16float: 4, r8unorm: 1, rg8unorm: 2, depth32float: 4, depth24plus: 4, "depth24plus-stencil8": 4, r32uint: 4,
    rgb10a2unorm: 4, rg11b10ufloat: 4, "bc7-rgba-unorm": 1, "bc7-rgba-unorm-srgb": 1, "bc5-rg-unorm": 1, "bc4-r-unorm": 0.5,
    "bc6h-rgb-ufloat": 1, "astc-4x4-unorm": 1, "astc-4x4-unorm-srgb": 1 };
  const live = new Map(); let total = 0, peak = 0;
  const add = (o, n) => { live.set(o, n); total += n; peak = Math.max(peak, total); };
  const P = GPUDevice.prototype, ct = P.createTexture, cb = P.createBuffer;
  P.createTexture = function (d) { const t = ct.call(this, d); const s = d.size; const w = s.width ?? s[0], h = s.height ?? s[1] ?? 1, l = s.depthOrArrayLayers ?? s[2] ?? 1;
    const m = (d.mipLevelCount ?? 1) > 1 ? 4 / 3 : 1; add(t, w * h * l * (B[d.format] ?? 4) * m * Math.max(1, d.sampleCount ?? 1)); return t; };
  P.createBuffer = function (d) { const b = cb.call(this, d); add(b, d.size); return b; };
  for (const C of [GPUTexture, GPUBuffer]) { const ds = C.prototype.destroy; C.prototype.destroy = function () { const n = live.get(this); if (n !== undefined) { total -= n; live.delete(this); } return ds.call(this); }; }
  globalThis.__vram = () => ({ mib: total / 2 ** 20, peakMiB: peak / 2 ** 20 });
})();`;

interface SceneResult {
  scene: string;
  auto: { fps: number; p50: number; p95: number; p99: number; over33: number; raysPerPx: number; blocks: Record<string, number>; scales: Record<string, number> };
  fixed: { fps: number; p50: number; p95: number };
  vramMiB: number;
  gpuPasses: { pass: string; ms: number }[];
}

try {
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 200; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) pending.get(d.id)!(d.result ?? d.error);
  };
  const cdp = (method: string, params: object = {}) =>
    new Promise<any>((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const js = async (body: string) => {
    const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "page error");
    return r?.result?.value;
  };
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: VRAM_HOOK });
  await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await cdp("Page.navigate", { url: URL });
  for (let i = 0; i < 240; i++) {
    if (await js(`return typeof __bh !== "undefined" && !!__bh.renderer`).catch(() => false)) break;
    await sleep(500);
  }
  await sleep(3000);

  // a window of frames: every rAF marks the scene changed (the realtime path, as when flying); the
  // intervals between the GPU's completions, the block and scale each frame was drawn with
  const window = (ms: number) => `
    const r = __bh.renderer, dpr = devicePixelRatio;
    const iv = [], blocks = {}, scales = {}; let rays = 0, n = 0, last = r.lastDoneAt;
    const t0 = performance.now();
    while (performance.now() - t0 < ${ms}) {
      __bh.touch();
      await new Promise((q) => requestAnimationFrame(q));
      if (r.lastDoneAt !== last) {
        if (last) iv.push(r.lastDoneAt - last);
        last = r.lastDoneAt;
        const p = __bh.game.perf(), b = r.realtimeBlockNow, sc = p.renderScale;
        blocks[b] = (blocks[b] ?? 0) + 1; scales[sc] = (scales[sc] ?? 0) + 1;
        rays += (__bh.settings.pixelRatio * sc / dpr) ** 2 / (b * b); n++;
      }
    }
    iv.sort((a, b) => a - b);
    const q = (f) => iv.length ? +iv[Math.min(iv.length - 1, Math.floor(f * iv.length))].toFixed(2) : NaN;
    return { fps: +(n * 1000 / ${ms}).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), over33: iv.filter((x) => x > 33.4).length,
      raysPerPx: +(rays / Math.max(n, 1)).toFixed(4), blocks, scales };`;

  const results: SceneResult[] = [];
  const warm = quick ? 4000 : 7000, span = quick ? 5000 : 9000;
  for (const scene of SCENES) {
    const ok = await js(`if (!(${JSON.stringify(scene)} in __bh.presets)) return false; __bh.preset(${JSON.stringify(scene)});
      Object.assign(__bh.settings, { quality: "game", realtimeSubsampling: "auto", dynamicResolution: true, pixelRatio: Math.min(devicePixelRatio, 1.25) });
      __bh.resize(); __bh.refresh?.(); return true;`);
    if (!ok) {
      console.log(`(no scene "${scene}")`);
      continue;
    }
    await js(`const t0 = performance.now(); while (performance.now() - t0 < ${warm}) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 0`);
    const auto = await js(window(span));
    const gpuPasses = await js(`return __bh.game.perf().gpu.slice(0, 8).map((g) => ({ pass: g.pass, ms: +g.ms.toFixed(2) }))`);
    await js(`Object.assign(__bh.settings, { realtimeSubsampling: 4, dynamicResolution: false }); __bh.resize(); __bh.refresh?.(); return 0`);
    await js(`const t0 = performance.now(); while (performance.now() - t0 < 2500) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 0`);
    const f = await js(window(quick ? 3000 : 5000));
    const vramMiB = +(await js(`return globalThis.__vram ? __vram().mib : NaN`)).toFixed(0);
    const res: SceneResult = { scene, auto, fixed: { fps: f.fps, p50: f.p50, p95: f.p95 }, vramMiB, gpuPasses };
    results.push(res);
    console.log(
      `${scene.slice(0, 44).padEnd(44)} auto ${String(auto.fps).padStart(5)} fps  p50 ${String(auto.p50).padStart(6)}  p95 ${String(auto.p95).padStart(6)}  >33ms ${String(auto.over33).padStart(3)}  rays/px ${auto.raysPerPx.toFixed(3)}` +
        `  | fixed b4 p50 ${String(f.p50).padStart(6)} ms  | VRAM ${vramMiB} MiB`,
    );
  }
  const peak = await js(`return globalThis.__vram ? +__vram().peakMiB.toFixed(0) : NaN`);
  const out = { label, sha, date: new Date().toISOString(), viewport: [W, H, DPR], peakVramMiB: peak, results };
  await Bun.write(`docs/perf/bench-${label}.json`, JSON.stringify(out, null, 1));
  console.log(`peak VRAM ${peak} MiB → docs/perf/bench-${label}.json`);
} finally {
  kill();
}
process.exit(0);
