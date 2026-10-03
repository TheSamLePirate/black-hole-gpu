// A headless Chrome over the DevTools protocol, no dependency (WebSocket is Bun's): launched with
// WebGPU on (SwiftShader on Linux), the page's exceptions and console errors collected.
import { tmpdir } from "node:os";

export interface Cdp {
  send<T = Record<string, unknown>>(method: string, params?: object): Promise<T>;
  errors: string[];
  close(): void;
}

const CHROME =
  process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const GPU =
  process.platform === "linux"
    ? ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader"]
    : ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist"];

export async function launch(o: { width?: number; height?: number; dpr?: number } = {}): Promise<Cdp> {
  const W = o.width ?? 1440,
    H = o.height ?? 900;
  const port = 9600 + Math.floor(Math.random() * 300);
  const proc = Bun.spawn(
    [
      CHROME,
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${tmpdir()}/kerr-e2e-${port}`,
      ...GPU,
      `--window-size=${W},${H}`,
      "--no-first-run",
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
    throw new Error(`Chrome did not start (${CHROME})`);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok) => (ws.onopen = ok));
  let id = 0;
  const pending = new Map<number, (v: unknown) => void>();
  const errors: string[] = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id) pending.get(d.id)?.(d.result ?? d);
    else if (d.method === "Runtime.exceptionThrown")
      errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error")
      errors.push(d.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" "));
  };
  const send = <T>(method: string, params: object = {}) =>
    new Promise<T>((ok) => {
      pending.set(++id, ok as (v: unknown) => void);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: o.dpr ?? 1, mobile: false });
  return {
    send,
    errors,
    close: () => {
      ws.close();
      proc.kill();
      Bun.spawnSync(["pkill", "-f", `remote-debugging-port=${port}`]);
    },
  };
}
