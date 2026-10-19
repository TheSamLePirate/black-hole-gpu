// Time to the first image, and where it goes: loads the page in a headless Chrome over the DevTools
// protocol and prints the GPU diagnostic's events (src/gpu-diagnostics.ts: the start's stages and every
// pipeline's compile time) and the splash's stages.
//
//   bun scripts/startup-probe.ts [--url http://localhost:3000/] [--scene game:artemis] [--profile dir]
//                                [--runs 1] [--timeout 240] [--settle 0] [--json out.json] [--flags "--switch=value ..."]
//   --settle S: after the first image, wait up to S s for the background compiles (general kernel, LUT)
//   --cores N: the page sees N hardware threads (4: the serial compile path; 0: the machine's own)
//
// --profile: the Chrome profile directory. A new (empty) one is a cold start; the same one again is a warm
// start, where the browser's disk cache of compiled shaders may answer. Default: a new directory in tmp.
// Measure alone: another page rendering shares the GPU.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const URL = arg("url", "http://localhost:3000/");
const SCENE = arg("scene", "game:artemis");
const RUNS = Number(arg("runs", "1"));
const TIMEOUT_S = Number(arg("timeout", "240"));
const JSON_OUT = arg("json", "");
const SETTLE = Number(arg("settle", "0"));
// (--cores N: navigator.hardwareConcurrency as the page sees it; 0: the machine's own)
const CORES = Number(arg("cores", "0"));
// (more Chrome switches, space-separated: e.g. --flags "--disable-dawn-features=use_dxc")
const FLAGS = arg("flags", "").split(" ").filter(Boolean);
const profile = arg("profile", "") || mkdtempSync(join(tmpdir(), "kerr-startup-"));
mkdirSync(profile, { recursive: true });
const CHROME =
  process.env.CHROME ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : "google-chrome");
const W = 1469,
  H = 965,
  DPR = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Event = { atMs: number; stage: string; kind: string; message: string; count?: number };
type Diagnostic = { elapsedMs: number; events: Event[]; runtime?: { loading?: unknown; pipelines?: unknown } | null };

async function once(n: number) {
  const port = 9400 + Math.floor(Math.random() * 90);
  const chrome = Bun.spawn(
    [
      CHROME,
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--enable-unsafe-webgpu",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      `--window-size=${W},${H}`,
      "--no-first-run",
      "--mute-audio",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      ...FLAGS,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  const kill = () => {
    // (Windows: the pid Bun.spawn gives is not the browser's — it is found by its port, its tree ended whole
    // with the parent still alive: once it is gone taskkill /T no longer finds the children, which go on
    // holding the profile and the GPU)
    if (process.platform === "win32")
      Bun.spawnSync(
        [
          "powershell",
          "-NoProfile",
          "-Command",
          `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'remote-debugging-port=${port} ' } | ForEach-Object { taskkill /F /T /PID $_.ProcessId }`,
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
    else Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
    chrome.kill();
  };
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
    // (the page sees fewer threads: what it does for a small machine — the real ones stay with the browser)
    if (CORES > 0) await cdp("Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: CORES });
    const t0 = performance.now();
    await cdp("Page.navigate", { url: `${URL}#scene=${encodeURIComponent(SCENE)}` });
    await sleep(1000);
    let ready = false;
    while (performance.now() - t0 < TIMEOUT_S * 1000) {
      ready = await js<boolean>(`typeof __bh !== "undefined" && !document.querySelector("#loading:not(.done)")`).catch(() => false);
      if (ready) break;
      await sleep(250);
    }
    const wallMs = Math.round(performance.now() - t0);
    const readDiag = () =>
      js<Diagnostic | null>(
        `(() => { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.includes("gpu-diagnostic")) return JSON.parse(localStorage.getItem(k)); } return null; })()`,
      );
    // (--settle: on after the first image until the background compiles — the general kernel, the LUT — have landed)
    let settledAfterS = 0;
    if (SETTLE > 0) {
      const t1 = performance.now();
      while ((performance.now() - t1) / 1000 < SETTLE) {
        await sleep(2000);
        const p = (await readDiag().catch(() => null))?.runtime?.pipelines as { general?: string; lut?: string } | undefined;
        if (p?.general === "ready" && p.lut !== "pending" && p.lut !== "idle") break;
      }
      settledAfterS = Math.round((performance.now() - t1) / 100) / 10;
    }
    // (the diagnostic persists with a short delay: let the last events land)
    await sleep(1500);
    const diag = await readDiag();
    if (SETTLE > 0)
      console.log(`  background compiles settled ${settledAfterS} s after the first image (${JSON.stringify(diag?.runtime?.pipelines)})`);
    console.log(
      `\n=== run ${n}/${RUNS} — ${ready ? "first image" : "TIMEOUT"} after ${(wallMs / 1000).toFixed(1)} s (wall, page load included) — profile ${profile}`,
    );
    for (const e of diag?.events ?? []) {
      if (e.kind === "stage" || e.kind === "pipeline-compiled" || /fail|error|lost/.test(e.kind))
        console.log(
          `  ${String(e.atMs).padStart(7)} ms  ${e.kind === "stage" ? `[stage] ${e.message}` : `${e.kind}: ${e.message}`}${e.count && e.count > 1 ? ` ×${e.count}` : ""}`,
        );
    }
    if (diag?.runtime?.loading) console.log("  loading:", JSON.stringify(diag.runtime.loading));
    // (a clean close first: a killed browser may not have written its shader disk cache — what a warm start reads)
    await Promise.race([cdp("Browser.close"), sleep(5000)]);
    await sleep(3000);
    return { run: n, ready, wallMs, diag };
  } finally {
    kill();
    await sleep(1500);
  }
}

const results = [];
for (let n = 1; n <= RUNS; n++) results.push(await once(n));
if (JSON_OUT) await Bun.write(JSON_OUT, JSON.stringify(results, null, 1));
process.exit(0);
