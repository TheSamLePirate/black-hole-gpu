// Validates every WGSL shader with the browser's own WebGPU compiler (headless Chrome over the DevTools
// protocol): getCompilationInfo on each module — an error here is a black screen for a player.
//
//   bun scripts/check-wgsl.ts        (CHROME=/path/to/chrome to choose the browser)
//
// Exit 1 on a compile error. Without a WebGPU adapter (a machine with neither GPU nor SwiftShader) it
// says so and exits 0: nothing could be checked, nothing is known to be broken.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Glob } from "bun";
import { chromeLock } from "./lib/chrome-lock";

const linux = process.platform === "linux";
const CHROME =
  process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const port = 9500 + Math.floor(Math.random() * 300);
// (its own profile, removed on exit)
const profile = `${tmpdir()}/kerr-wgsl-${port}`;
const shaders: Record<string, string> = {};
for await (const f of new Glob("src/shaders/*.wgsl").scan(".")) shaders[f.split("/").pop()!] = await Bun.file(f).text();

// (a page from localhost: WebGPU wants a secure context)
const server = Bun.serve({
  port: 0,
  fetch: () => new Response("<!doctype html><title>wgsl</title>", { headers: { "content-type": "text/html" } }),
});
// (one Chrome at a time on this machine: scripts/lib/chrome-lock.ts — waits its turn here, let go at exit)
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
    "about:blank",
  ],
  { stdout: "ignore", stderr: "pipe" },
);
const done = (code: number) => {
  chrome.kill();
  server.stop(true);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(code);
};
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
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok) => (ws.onopen = ok));
  let id = 0;
  const pending = new Map<number, (v: { result?: { result?: { value?: unknown } }; exceptionDetails?: unknown }) => void>();
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    pending.get(d.id)?.(d.result ?? d);
  };
  const cdp = (method: string, params: object = {}) =>
    new Promise<any>((ok) => {
      pending.set(++id, ok);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await cdp("Page.enable");
  await cdp("Page.navigate", { url: `http://localhost:${server.port}/` });
  await Bun.sleep(500);
  const r = await cdp("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const shaders = ${JSON.stringify(shaders)};
      if (!navigator.gpu) return { adapter: null };
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { adapter: null };
      const device = await adapter.requestDevice();
      const out = {};
      for (const [name, code] of Object.entries(shaders)) {
        const info = await device.createShaderModule({ code }).getCompilationInfo();
        out[name] = info.messages.filter((m) => m.type === "error").map((m) => m.lineNum + ":" + m.linePos + " " + m.message);
      }
      return { adapter: adapter.info?.description || adapter.info?.vendor || "an adapter", out };
    })()`,
  });
  const v = r?.result?.value as { adapter: string | null; out?: Record<string, string[]> } | undefined;
  if (!v?.adapter) {
    console.warn("check-wgsl: no WebGPU adapter in this browser — nothing checked");
    done(0);
  }
  let bad = 0;
  for (const [name, errs] of Object.entries(v!.out!)) {
    if (errs.length) {
      bad++;
      console.error(`✗ ${name}\n  ${errs.join("\n  ")}`);
    } else console.log(`✓ ${name}`);
  }
  console.log(`${Object.keys(v!.out!).length - bad} / ${Object.keys(v!.out!).length} shaders compile (${v!.adapter})`);
  done(bad ? 1 : 0);
} catch (e) {
  console.error("check-wgsl:", (e as Error).message);
  done(1);
}
