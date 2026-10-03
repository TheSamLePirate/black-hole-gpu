// Frame-time benchmark of the reference scenes in a headless Chrome over the DevTools protocol, against
// a running server (bun --hot server.ts). The measuring itself is the app's own — the Kerr Bench
// (src/bench/runner.ts, __bh.bench) — so this, the nightly and a friend's browser measure the same thing.
//
//   bun scripts/bench.ts [--url http://localhost:3000/] [--label name] [--scenes "a|b"] [--quick]
//                        [--compare http://localhost:3012/ [--reps 2]]
//
// For each scene: phase A (the Game quality, its automatic subsampling and dynamic resolution — the
// frame intervals' p50/p95/p99, frames over 33 ms, rays per displayed pixel) and phase B (subsampling 4,
// the image ~1.44 Mpx — its throughput in Mrays/s, the figure that compares commits). Writes
// docs/perf/bench-<label>.json. Compare mode alternates a reference build scene by scene (the machine's
// drift, its clocks and heat, falls on both).
//
// Measure alone: another page rendering (the browser pane, a second headless) shares the GPU and halves
// both. Chrome is killed on exit.
import { tmpdir } from "node:os";
import type { SceneReport } from "../src/bench/report";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const URL = arg("url", "http://localhost:3000/");
const quick = process.argv.includes("--quick");
const COMPARE = arg("compare", "");
const sha = (await Bun.$`git rev-parse --short HEAD`.text()).trim();
const label = arg("label", sha);
const port = 9350 + Math.floor(Math.random() * 40);
const W = 1469,
  H = 965,
  DPR = 2;
const CHROME =
  process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");

const chrome = Bun.spawn(
  [
    CHROME,
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpdir()}/kerr-bench-profile`,
    "--enable-unsafe-webgpu",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    `--window-size=${W},${H}`,
    "--no-first-run",
    "--mute-audio",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore" },
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kill = () => {
  chrome.kill();
  Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
};
process.on("SIGINT", () => (kill(), process.exit(1)));

type Evaluated = { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string } } };

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
  const pending = new Map<number, (v: Evaluated) => void>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) pending.get(d.id)!(d.result ?? d.error);
  };
  const cdp = (method: string, params: object = {}) =>
    new Promise<Evaluated>((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = async <T>(expr: string): Promise<T> => {
    const r = await cdp("Runtime.evaluate", { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "page error");
    return r?.result?.value as T;
  };
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  const urls = COMPARE ? [COMPARE, URL] : [URL];
  let at = "";
  const open = async (url: string) => {
    if (at === url) return;
    // (#bench: the page counts its GPU memory from the first allocation)
    await cdp("Page.navigate", { url: `${url}#bench` });
    at = url;
    await sleep(1000);
    for (let i = 0; i < 240; i++) {
      if (
        await js<boolean>(`typeof __bh !== "undefined" && !!__bh.bench && !document.querySelector("#loading:not(.done)")`).catch(
          () => false,
        )
      )
        break;
      await sleep(500);
    }
  };
  await open(URL);
  const scenes: string[] = arg("scenes", "") ? arg("scenes", "").split("|") : await js<string[]>("__bh.bench.scenes");

  const mean = (a: number[]) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(a[0]! < 1 ? 4 : 1);
  const line = (tag: string, rs: SceneReport[]) =>
    `  ${tag.padEnd(4)} auto ${String(mean(rs.map((r) => r.auto?.fps ?? 0))).padStart(5)} fps  p95 ${String(mean(rs.map((r) => r.auto?.p95 ?? 0))).padStart(6)}` +
    `  >33ms ${String(mean(rs.map((r) => r.auto?.over33 ?? 0))).padStart(5)}  rays/px ${mean(rs.map((r) => r.auto?.raysPerPx ?? 0)).toFixed(4)}` +
    `  | fixed b4 p50 ${String(mean(rs.map((r) => r.fixed?.p50 ?? 0))).padStart(6)} ms ${String(mean(rs.map((r) => r.fixed?.mraysPerS ?? 0))).padStart(6)} Mrays/s` +
    `  | VRAM ${mean(rs.map((r) => r.vramMiB ?? 0))} MiB`;

  const results: Record<string, SceneReport[]> = {};
  const reps = COMPARE ? Number(arg("reps", "2")) : 1;
  for (const scene of scenes) {
    const per: SceneReport[][] = urls.map(() => []);
    for (let k = 0; k < reps; k++)
      for (const [i, url] of urls.entries()) {
        await open(url);
        const r = await js<SceneReport>(`__bh.bench.scene(${JSON.stringify(scene)}, ${quick})`);
        if (r.status === "ok") per[i]!.push(r);
        else console.log(`  (${scene}: ${r.status} ${r.error ?? ""})`);
      }
    if (!per[urls.length - 1]!.length) continue;
    console.log(scene);
    urls.forEach((_, i) => {
      if (per[i]!.length) console.log(line(COMPARE ? (i ? "new" : "ref") : "", per[i]!));
    });
    results[scene] = per[urls.length - 1]!;
    if (COMPARE) results[`${scene} (ref)`] = per[0]!;
  }
  const peak = await js<number | null>(`__bh.bench.vram()?.peakMiB ?? null`);
  const out = {
    label,
    sha,
    date: new Date().toISOString(),
    viewport: [W, H, DPR],
    compare: COMPARE || null,
    peakVramMiB: peak && Math.round(peak),
    results,
  };
  await Bun.write(`docs/perf/bench-${label}.json`, JSON.stringify(out, null, 1));
  console.log(`peak VRAM ${out.peakVramMiB} MiB → docs/perf/bench-${label}.json`);
} finally {
  kill();
}
process.exit(0);
