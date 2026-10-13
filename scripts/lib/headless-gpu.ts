// A headless Chrome with WebGPU for the scripts that check shaders on the browser's own compiler and GPU
// (scripts/check-wgsl.ts, scripts/check-forest.ts): a localhost page (WebGPU wants a secure context), the
// DevTools protocol's Runtime.evaluate, one Chrome at a time (chrome-lock.ts). On Linux without a GPU,
// SwiftShader's Vulkan stands in; on a Mac, the real GPU.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromeLock } from "./chrome-lock";

const linux = process.platform === "linux";
export const CHROME =
  process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");

/**
 * Runs `use` with a page's evaluate (an expression → its value, awaited); Chrome closed after, whatever
 * happens. `files`: more paths the page's server answers (a worker's bundle: path → body, content type by
 * extension); `args`: more Chrome flags (a proxy: --proxy-server=…).
 */
export async function withGpuPage<T>(
  use: (evaluate: <V>(expression: string) => Promise<V>, shot: (path: string, w?: number, h?: number) => Promise<void>) => Promise<T>,
  o: { files?: Record<string, string>; args?: string[] } = {},
): Promise<T> {
  const port = 9500 + Math.floor(Math.random() * 300);
  // (its own profile, removed on exit)
  const profile = `${tmpdir()}/kerr-gpu-${port}`;
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      const body = o.files?.[path];
      if (body !== undefined)
        return new Response(body, { headers: { "content-type": path.endsWith(".js") ? "text/javascript" : "application/octet-stream" } });
      return new Response("<!doctype html><title>gpu</title>", { headers: { "content-type": "text/html" } });
    },
  });
  await chromeLock();
  const chrome = Bun.spawn(
    [
      CHROME,
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--enable-unsafe-webgpu",
      "--no-first-run",
      ...(linux
        ? [
            "--no-sandbox",
            "--enable-features=Vulkan",
            "--use-vulkan=swiftshader",
            "--use-webgpu-adapter=swiftshader",
            "--disable-vulkan-surface",
          ]
        : []),
      ...(o.args ?? []),
      "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  let ws: WebSocket | null = null;
  try {
    let page: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 300 && !page; i++) {
      page = await fetch(`http://127.0.0.1:${port}/json`)
        .then((r) => r.json() as Promise<{ type: string; webSocketDebuggerUrl: string }[]>)
        .then((l) => l.find((t) => t.type === "page"))
        .catch(() => undefined);
      if (!page) await Bun.sleep(100);
    }
    if (!page) {
      chrome.kill();
      const err = await new Response(chrome.stderr).text();
      throw new Error(`Chrome did not start (${CHROME})\n${err.split("\n").slice(-15).join("\n")}`);
    }
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    ws = socket;
    await new Promise((ok) => (socket.onopen = ok));
    let id = 0;
    const pending = new Map<
      number,
      (v: { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string } } }) => void
    >();
    socket.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      pending.get(d.id)?.(d.result ?? d);
    };
    const cdp = (method: string, params: object = {}) =>
      new Promise<{ result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string } } }>((ok) => {
        pending.set(++id, ok);
        socket.send(JSON.stringify({ id, method, params }));
      });
    await cdp("Page.enable");
    await cdp("Page.navigate", { url: `http://localhost:${server.port}/` });
    await Bun.sleep(500);
    return await use(
      async <V>(expression: string) => {
        const r = await cdp("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluation failed");
        return r.result?.value as V;
      },
      // (a PNG of the page, at a size)
      async (path: string, w = 1280, h = 800) => {
        await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        const r = (await cdp("Page.captureScreenshot", { format: "png" })) as { data?: string };
        if (r.data) await Bun.write(path, Buffer.from(r.data, "base64"));
      },
    );
  } finally {
    ws?.close();
    chrome.kill();
    server.stop(true);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
