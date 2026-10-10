import index from "./index.html";

const port = Number(process.env.PORT ?? 3000);
// (started by a test or the flight lab — tests/e2e/lib/app.ts — for its own run: gone with its parent, never
// an orphan holding its port once that process has died hard)
const parent = Number(process.env.KERR_PARENT_PID ?? 0);
if (parent)
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 2000);
const dev = process.env.NODE_ENV !== "production";
// TARS's ear (dev): the page's microphone relayed to Deepgram with the key of .env — the key never leaves this
// server (a temporary token needs a key of a member's rights; a relay needs none)
// (and in a test's run — KERR_EAR_RELAY=1 —: its server runs as production)
const DEEPGRAM = dev || process.env.KERR_EAR_RELAY === "1" ? process.env.DEEPGRAM_API_KEY : undefined;
type Relay = { path: "listen" | "speak"; query: string; up?: WebSocket; queue: (string | ArrayBuffer | Uint8Array)[] };
/** The relay to Deepgram's listen (TARS's ear) or speak (his voice, the radio's: Aura-2): the page's own
 *  settings passed on — these names only, each value a word —, nothing else. */
function deepgramRelay(path: "listen" | "speak", names: string[]) {
  return (req: Request, srv: { upgrade(r: Request, o: { data: unknown }): boolean }) => {
    if (!DEEPGRAM) return new Response("disabled", { status: 404 });
    const url = new URL(req.url);
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return Response.json({ ok: true });
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== url.host) return new Response("forbidden", { status: 403 });
    const q = new URLSearchParams();
    for (const k of names) for (const v of url.searchParams.getAll(k).slice(0, 12)) if (/^[\w.-]{1,32}$/.test(v)) q.append(k, v);
    return srv.upgrade(req, { data: { path, query: q.toString(), queue: [] } })
      ? undefined
      : new Response("upgrade failed", { status: 400 });
  };
}

const server = Bun.serve({
  port,
  routes: {
    "/": index,
    // Dev only: the page can POST a rendered PNG here (window.__bh.snapshot()) for offline inspection.
    "/__snapshot": {
      POST: async (req) => {
        if (!dev) return new Response("disabled", { status: 404 });
        const name = new URL(req.url).searchParams.get("name")?.replace(/[^\w.-]/g, "") || "snapshot";
        const file = /\.(png|jpg|webp|exr|json|mp4)$/.test(name) ? name : `${name}.png`;
        await Bun.write(`snapshots/${file}`, await req.arrayBuffer());
        return new Response("ok");
      },
    },
    // The flight planner's worker, bundled on its own (the pages build writes it next to the page)
    "/plan-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/plan-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    // The rocket engine's AudioWorklet (PLAN-AUDIO S2), bundled on its own
    "/audio-worklet.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/audio/engine-worklet.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    // The KTX2 transcoder's worker and its WebAssembly (vendor/basis)
    "/ktx-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/ktx-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    // the build's version (the benchmark's report names it); the pages build writes the same file
    "/version.json": async () => Response.json({ sha: (await Bun.$`git rev-parse --short HEAD`.nothrow().text()).trim() || "dev" }),
    // the Service Worker (src/sw.ts), the manifest and the icons (pwa/), the precache list (none in dev)
    "/sw.js": async () => {
      const r = await Bun.build({
        entrypoints: ["./src/sw.ts"],
        target: "browser",
        minify: !dev,
        define: { __BUILD__: JSON.stringify(dev ? `dev-${Date.now()}` : "local") },
      });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), {
        headers: { "content-type": "text/javascript", "service-worker-allowed": "/", "cache-control": "no-cache" },
      });
    },
    "/manifest.webmanifest": () =>
      new Response(Bun.file("pwa/manifest.webmanifest"), { headers: { "content-type": "application/manifest+json" } }),
    "/icons/:file": (req) => {
      const f = req.params.file.replace(/[^\w.-]/g, "");
      return new Response(Bun.file(`pwa/icons/${f}`));
    },
    "/precache.json": () => Response.json([]),
    // (the OAuth callback of "Sign in with OpenRouter" — PLAN-TARS T6)
    "/openrouter.html": () => new Response(Bun.file("pwa/openrouter.html"), { headers: { "content-type": "text/html; charset=utf-8" } }),
    "/basis_transcoder.wasm": () =>
      new Response(Bun.file("vendor/basis/basis_transcoder.wasm"), { headers: { "content-type": "application/wasm" } }),
    // Dev only: read back files from snapshots/ (e.g. reference data for the precision probe).
    // Dev only: whether the relay to Deepgram is there (GET), the relay itself (a WebSocket)
    "/__deepgram": deepgramRelay("listen", [
      "model",
      "language",
      "encoding",
      "sample_rate",
      "channels",
      "interim_results",
      "smart_format",
      "punctuate",
      "endpointing",
      "keyterm",
    ]) as never,
    "/__deepgram/speak": deepgramRelay("speak", ["model", "encoding", "sample_rate"]) as never,
    "/__snapshots/:name": {
      GET: (req) => {
        const file = Bun.file(`snapshots/${req.params.name.replace(/[^\w.-]/g, "")}`);
        return dev ? new Response(file) : new Response("disabled", { status: 404 });
      },
    },
  },
  development: dev && { hmr: true, console: true },
  websocket: {
    // the page's side opened: Deepgram's opened with the key, what came before it queued
    open(ws) {
      const r = ws.data as unknown as Relay;
      const up = new WebSocket(`wss://api.deepgram.com/v1/${r.path}?${r.query}`, {
        headers: { Authorization: `Token ${DEEPGRAM}` },
      } as never);
      up.binaryType = "arraybuffer";
      r.up = up;
      up.onopen = () => {
        for (const m of r.queue) up.send(m);
        r.queue = [];
      };
      up.onmessage = (m) => ws.send(typeof m.data === "string" ? m.data : new Uint8Array(m.data as ArrayBuffer));
      up.onclose = (e) => ws.close(e.code === 1005 ? 1000 : e.code, e.reason);
      up.onerror = () => ws.close(1011, "deepgram");
    },
    message(ws, m) {
      const r = ws.data as unknown as Relay;
      if (r.up?.readyState === WebSocket.OPEN) r.up.send(m);
      else r.queue.push(m);
    },
    close(ws) {
      const r = ws.data as unknown as Relay;
      if (r.up && r.up.readyState <= WebSocket.OPEN) r.up.close();
    },
  },
});

console.log(`Black hole simulator → ${server.url}`);
