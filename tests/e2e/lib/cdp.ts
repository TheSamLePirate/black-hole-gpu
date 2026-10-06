// A headless Chrome over the DevTools protocol, no dependency (WebSocket is Bun's): launched with
// WebGPU on (SwiftShader on Linux), the page's exceptions and console errors collected.
// E2E_HEADED=1: on the screen instead, full screen (kiosk: no tabs, no address bar) — to watch a test, not
// to measure one (its frames follow the display's); the viewport is the emulated one either way. A machine
// may choose its own way once (~/.kerr-lab/config.json {"chrome": "window" | "kiosk" | "headless"}:
// scripts/lib/chrome-lock.ts, labConfig) — a window, to watch beside one's work.
// E2E_HOLD=<s>: each Chrome left open <s> seconds at its close, to see where the test left it.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromeLock, labConfig } from "../../../scripts/lib/chrome-lock";

export interface Cdp {
  /** a DevTools call: its answer, or an error once Chrome is gone or `timeoutS` passed (E2E_CDP_TIMEOUT, 300 s) */
  send<T = Record<string, unknown>>(method: string, params?: object, timeoutS?: number): Promise<T>;
  errors: string[];
  close(): void;
}

const CHROME =
  process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const SHOW = process.env.E2E_HEADED === "1" ? "kiosk" : (labConfig().chrome ?? "headless");
const HOLD = Number(process.env.E2E_HOLD || 0);
const CDP_TIMEOUT_S = Number(process.env.E2E_CDP_TIMEOUT || 300);
const GPU =
  process.platform === "linux"
    ? ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"]
    : ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist"];

export async function launch(o: { width?: number; height?: number; dpr?: number } = {}): Promise<Cdp> {
  const W = o.width ?? 1440,
    H = o.height ?? 900;
  // (one Chrome at a time on this machine: scripts/lib/chrome-lock.ts — waits its turn here)
  const release = await chromeLock();
  const port = 9600 + Math.floor(Math.random() * 300);
  // (its own profile, removed on close: a run leaves nothing behind — they were 300 MB each)
  const profile = `${tmpdir()}/kerr-e2e-${port}`;
  const proc = Bun.spawn(
    [
      CHROME,
      // (a window asks the login keychain for its profile's key — a dialog that blocks it; headless never does.
      // Not --app=…: with it Chrome opens a second, ordinary window too — the one the tests then drove)
      ...(SHOW === "kiosk"
        ? ["--kiosk", "--use-mock-keychain"]
        : SHOW === "window"
          ? ["--use-mock-keychain", "--window-position=60,40"]
          : ["--headless=new"]),
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      ...GPU,
      `--window-size=${W},${H}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--mute-audio",
      "--hide-scrollbars",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  let page: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 300 && !page; i++) {
    page = await fetch(`http://127.0.0.1:${port}/json`)
      .then((r) => r.json() as Promise<{ type: string; webSocketDebuggerUrl: string }[]>)
      .then((l) => l.find((t) => t.type === "page"))
      .catch(() => undefined);
    if (!page) await Bun.sleep(100);
  }
  if (!page) {
    proc.kill();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    release();
    throw new Error(`Chrome did not start (${CHROME})`);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok) => (ws.onopen = ok));
  let id = 0;
  // (every call answered, failed or timed out — a page that hangs, a Chrome that dies, never a test or a
  // campaign waiting for ever: E2E_CDP_TIMEOUT [s], 300 by default; a call may ask for more)
  const pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: Timer }>();
  const failAll = (why: string) => {
    for (const [k, p] of pending) {
      clearTimeout(p.timer);
      p.fail(new Error(why));
      pending.delete(k);
    }
  };
  let gone: string | null = null;
  ws.onclose = () => failAll((gone ??= "Chrome's DevTools connection closed"));
  void proc.exited.then((code) => failAll((gone ??= `Chrome exited (code ${code})`)));
  const errors: string[] = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id) {
      const p = pending.get(d.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(d.id);
        p.ok(d.result ?? d);
      }
    } else if (d.method === "Runtime.exceptionThrown")
      errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error")
      errors.push(d.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" "));
  };
  const send = <T>(method: string, params: object = {}, timeoutS = CDP_TIMEOUT_S) =>
    new Promise<T>((ok, fail) => {
      if (gone) return fail(new Error(gone));
      const k = ++id;
      const timer = setTimeout(() => {
        pending.delete(k);
        fail(new Error(`DevTools ${method} unanswered after ${timeoutS} s (the page hung?)`));
      }, timeoutS * 1000);
      pending.set(k, { ok: ok as (v: unknown) => void, fail, timer });
      ws.send(JSON.stringify({ id: k, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: o.dpr ?? 1, mobile: false });
  return {
    send,
    errors,
    close: () => {
      if (HOLD) Bun.sleepSync(HOLD * 1000);
      gone ??= "closed";
      ws.close();
      proc.kill();
      Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      release();
    },
  };
}
