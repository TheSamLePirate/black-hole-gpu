// A headless Chrome over the DevTools protocol, no dependency (WebSocket is Bun's): launched with
// WebGPU on (SwiftShader on Linux), the page's exceptions and console errors collected.
// How it shows: each Mac's own choice, once (~/.kerr-lab/config.json {"chrome": "headless" | "window" | "kiosk"}:
// scripts/lib/chrome-lock.ts, labConfig) — the lab's: headless on the main Mac, full screen (kiosk: no tabs, no
// address bar) on kerr-mini, so who sits at it sees it is in use. E2E_HEADED=1 forces kiosk, E2E_HEADED=0
// headless (the remote runner's --headless). A window is to watch a test, not to measure one (its frames
// follow the display's). In kiosk the page is the screen's size at 1:1; headless or in a window, the size
// the test asked. docs/E2E.md.
// E2E_HOLD=<s>: each Chrome left open <s> seconds at its close, to see where the test left it.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromeLock, labConfig } from "../../../scripts/lib/chrome-lock";

export interface Cdp {
  /** a DevTools call: its answer, or an error once Chrome is gone or `timeoutS` passed (E2E_CDP_TIMEOUT, 300 s) */
  send<T = Record<string, unknown>>(method: string, params?: object, timeoutS?: number): Promise<T>;
  errors: string[];
  /** a DevTools event listened to (Page.screencastFrame, Runtime.consoleAPICalled, …): the listener's removal */
  on(method: string, fn: (params: Record<string, unknown>) => void): () => void;
  close(): void;
}

const CHROME =
  process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
export const SHOW =
  process.env.E2E_HEADED === "1" ? "kiosk" : process.env.E2E_HEADED === "0" ? "headless" : (labConfig().chrome ?? "headless");
const HOLD = Number(process.env.E2E_HOLD || 0);
const CDP_TIMEOUT_S = Number(process.env.E2E_CDP_TIMEOUT || 300);
const GPU =
  process.platform === "linux"
    ? ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"]
    : ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist"];

// (every Chrome this process started and not yet closed: killed when it ends however it ends — a test that never closed
// its own, a boot that failed, a run stopped — else each stayed, headless, on the GPU for good)
const running = new Map<number, () => void>();
const killRunning = () => {
  for (const kill of running.values()) kill();
  running.clear();
};
process.on("exit", killRunning);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.on(sig, () => {
    killRunning();
    process.exit(128 + (sig === "SIGINT" ? 2 : sig === "SIGTERM" ? 15 : 1));
  });

export async function launch(o: { width?: number; height?: number; dpr?: number; args?: string[]; profile?: string } = {}): Promise<Cdp> {
  const W = o.width ?? 1440,
    H = o.height ?? 900;
  // (one Chrome at a time on this machine: scripts/lib/chrome-lock.ts — waits its turn here)
  const release = await chromeLock();
  const port = 9600 + Math.floor(Math.random() * 300);
  // (its own profile, removed on close: a run leaves nothing behind — they were 300 MB each; o.profile: that one, kept —
  // a second launch on it finds Chrome's caches as a returning player does)
  const profile = o.profile ?? `${tmpdir()}/kerr-e2e-${port}`;
  const dropProfile = () => {
    if (!o.profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
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
      // (a test's own: a fake microphone playing a file, …)
      ...(o.args ?? []),
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  running.set(port, () => {
    proc.kill();
    Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
    dropProfile();
  });
  let page: { webSocketDebuggerUrl: string } | undefined;
  for (let i = 0; i < 300 && !page; i++) {
    page = await fetch(`http://127.0.0.1:${port}/json`)
      .then((r) => r.json() as Promise<{ type: string; webSocketDebuggerUrl: string }[]>)
      .then((l) => l.find((t) => t.type === "page"))
      .catch(() => undefined);
    if (!page) await Bun.sleep(100);
  }
  if (!page) {
    running.delete(port);
    proc.kill();
    dropProfile();
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
  const listeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.method) for (const fn of listeners.get(d.method) ?? []) fn(d.params);
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
  // (full screen — kiosk —: the page is the display's own size at 1:1, whatever size the test asked — the
  // lab's choice: a test seen on the mini fills its screen; a test that resizes the page itself mid-run, to
  // try a narrow window, still does. Headless or in a window: the size asked, 1440 × 900 by default)
  let vw = W,
    vh = H;
  if (SHOW === "kiosk") {
    // (the display's size — not the window's: kiosk goes full screen a moment after the start)
    const r = await send<{ result: { value: [number, number] } }>("Runtime.evaluate", {
      expression: "[screen.width, screen.height]",
      returnByValue: true,
    });
    const [w, h] = r.result.value;
    if (w > 0 && h > 0) [vw, vh] = [w, h];
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: vw,
    height: vh,
    deviceScaleFactor: SHOW === "kiosk" ? 1 : (o.dpr ?? 1),
    mobile: false,
  });
  return {
    // (a screenshot on a Chrome one sees: the e2e's banner — lib/banner.ts — hidden for it, put back after)
    send: async <T>(method: string, params?: object, timeoutS?: number) => {
      if (method !== "Page.captureScreenshot" || SHOW === "headless") return send<T>(method, params, timeoutS);
      const vis = (v: string) =>
        send("Runtime.evaluate", {
          expression: `(() => { const b = document.getElementById("e2e-banner"); if (b) b.style.visibility = "${v}"; return 1; })()`,
        }).catch(() => {});
      await vis("hidden");
      try {
        return await send<T>(method, params, timeoutS);
      } finally {
        await vis("visible");
      }
    },
    errors,
    on: (method, fn) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method)!.add(fn);
      return () => listeners.get(method)?.delete(fn);
    },
    close: () => {
      if (HOLD) Bun.sleepSync(HOLD * 1000);
      gone ??= "closed";
      running.delete(port);
      ws.close();
      proc.kill();
      Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
      dropProfile();
      release();
    },
  };
}
