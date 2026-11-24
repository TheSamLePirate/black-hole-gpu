import index from "./index.html";
import crew from "./crew/index.html";
import { EAR_LIMITS, earClosed, earOpened, earRelayRefusal, foreignOrigin, queueFits } from "./server/ear-relay";
import { createMoonTiles } from "./server/moon-tiles";
import { createRooms, type Peer } from "./server/rooms";
import { createTraffic } from "./server/traffic";
import { pinnedDistroPath } from "./scripts/obc-distro";
import { coiWanted, withCoi } from "./src/obc/isolation";
import { type WispSession, wispClose, wispDrain, wispMessage, wispOpen, wispPolicyFromEnv, wispUpgrade } from "./server/wisp-relay";

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
const wispPolicy = wispPolicyFromEnv();
let debianDistroPathPromise: Promise<string> | null = null;
// TARS's ear (dev): the page's microphone relayed to Deepgram with the key of .env — the key never leaves this
// server (a temporary token needs a key of a member's rights; a relay needs none)
// (and in a test's run — KERR_EAR_RELAY=1 —: its server runs as production)
const DEEPGRAM = dev || process.env.KERR_EAR_RELAY === "1" ? process.env.DEEPGRAM_API_KEY : undefined;
type Relay = {
  path: "listen" | "speak";
  query: string;
  up?: WebSocket;
  queue: (string | ArrayBuffer | Uint8Array)[];
  timer?: ReturnType<typeof setTimeout>;
};
/** The relay to Deepgram's listen (TARS's ear) or speak (his voice, the radio's: Aura-2): the page's own
 *  settings passed on — these names only, each value a word —, nothing else. */
function deepgramRelay(path: "listen" | "speak", names: string[]) {
  return (req: Request, srv: { upgrade(r: Request, o: { data: unknown }): boolean }) => {
    if (!DEEPGRAM) return new Response("disabled", { status: 404 });
    const url = new URL(req.url);
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return Response.json({ ok: true });
    // (this server's own pages only, a few at once — server/ear-relay.ts, audit TA-14)
    const refused = earRelayRefusal(req);
    if (refused) return refused;
    const q = new URLSearchParams();
    for (const k of names) for (const v of url.searchParams.getAll(k).slice(0, 12)) if (/^[\w.-]{1,32}$/.test(v)) q.append(k, v);
    return srv.upgrade(req, { data: { path, query: q.toString(), queue: [] } })
      ? undefined
      : new Response("upgrade failed", { status: 400 });
  };
}

// the network's rooms (docs/PLAN-RESEAU.md) on this server's /net: dev and the tests fly against them here;
// kept in a file in dev, in memory otherwise (production's rooms live at stream.samlepirate.org)
// (ignored by Git: absent in a fresh clone/worktree; SQLite creates the file, not its parent directory)
if (dev) await Bun.$`mkdir -p snapshots`.quiet();
const rooms = createRooms({ db: dev ? "snapshots/rooms-dev.sqlite" : ":memory:", build: "local" });

const traffic = createTraffic({
  aisKey: process.env.AISSTREAM_API_KEY,
  openskyId: process.env.OPENSKY_CLIENT_ID,
  openskySecret: process.env.OPENSKY_CLIENT_SECRET,
  log: (m) => console.log(m),
});
const moonTiles = createMoonTiles("data/moon/lola");
const marsTiles = createMoonTiles("data/mars/dem", "mars/dem");
const mercuryTiles = createMoonTiles("data/mercury/dem", "mercury/dem");
const ceresTiles = createMoonTiles("data/ceres/dem", "ceres/dem");
// (the pages cross-origin isolated — COOP same-origin + COEP credentialless: SharedArrayBuffer for the Linux OBC's
// multi-CPU — only for a player who asked for it, its kerr_coi cookie, as nginx does (src/obc/isolation.ts); KERR_COI=1 / =0
// forces it on / off, KERR_NO_COI=1 off as before)
const coiForce: "1" | "0" | null =
  process.env.KERR_COI === "1" ? "1" : process.env.KERR_COI === "0" || process.env.KERR_NO_COI === "1" ? "0" : null;
function withCoiHeaders(req: Request, res: Response): Response {
  return withCoi(res, coiWanted(req.headers.get("cookie"), coiForce));
}

const server = Bun.serve({
  port,
  routes: {
    "/__app": index,
    "/__crew": crew,
    "/": async (req: Request): Promise<Response> => withCoiHeaders(req, await fetch(new URL("/__app", req.url))),
    "/crew": () => Response.redirect("/crew/", 302),
    "/crew/": async (req: Request): Promise<Response> => withCoiHeaders(req, await fetch(new URL("/__crew", req.url))),
    "/crew/index.html": async (req: Request): Promise<Response> => withCoiHeaders(req, await fetch(new URL("/__crew", req.url))),
    // Dev only: the page can POST a rendered PNG here (window.__bh.snapshot()) for offline inspection.
    "/__snapshot": {
      POST: async (req) => {
        if (!dev) return new Response("disabled", { status: 404 });
        // (this server's own pages only — audit QA-20: a script of the local network or the Tailscale wrote files here)
        if (foreignOrigin(req)) return new Response("forbidden", { status: 403 });
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
    // The CPU worker — the hulls' collision trees, the sea's spectrum (src/system/cpu-worker.ts — PLAN-J7 J7-7)
    "/cpu-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/cpu-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    // The building cells' workers — a BD TOPO tile decoded into the far buildings' records (src/system/cell-worker.ts — PLAN-J8 J8-3)
    "/cell-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/cell-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    // The mirages' tables' worker (src/system/mirage-worker.ts — R6a-ciel)
    "/mirage-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/mirage-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    // The intro's Worker (src/intro/worker.ts: its background and its loading orb, PLAN-TITRE-AAA E1)
    "/intro-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/intro/worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    // The network, loaded when the player asks for it (src/net/load.ts)
    "/net.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/net/index.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    // (the real traffic — server/traffic.ts, T1 —: the keys of .env, here as on the room server)
    "/traffic/*": ((req: Request, srv: { requestIP(r: Request): { address: string } | null }) =>
      traffic.handle(req, srv.requestIP(req)?.address)) as never,
    // (the Moon's relief tiles — server/moon-tiles.ts, P6 —: a box built locally into data/, as the room server serves them)
    "/svc/v1/moon/*": async (req: Request) => (await moonTiles.handle(new URL(req.url))) ?? new Response(null, { status: 404 }),
    "/svc/v1/mars/*": async (req: Request) => (await marsTiles.handle(new URL(req.url))) ?? new Response(null, { status: 404 }),
    "/svc/v1/mercury/*": async (req: Request) => (await mercuryTiles.handle(new URL(req.url))) ?? new Response(null, { status: 404 }),
    "/svc/v1/ceres/*": async (req: Request) => (await ceresTiles.handle(new URL(req.url))) ?? new Response(null, { status: 404 }),
    "/net": ((req: Request, srv: Parameters<typeof rooms.upgrade>[1]) =>
      req.headers.get("upgrade")?.toLowerCase() === "websocket" ? rooms.upgrade(req, srv) : Response.json(rooms.health())) as never,
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
    "/earth-surface-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/earth-surface-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    "/wgsl-specialise-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/wgsl-specialise-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    "/tile-decode-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/tile-decode-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    "/tree-asset-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/vegetation/tree-asset-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    "/terrain-mesh-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/terrain-mesh-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      return new Response(await r.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    },
    "/scenery-worker.js": async () => {
      const r = await Bun.build({ entrypoints: ["./src/system/scenery-worker.ts"], target: "browser", minify: !dev });
      if (!r.success) return new Response(r.logs.join("\n"), { status: 500 });
      const license = await Bun.file("vendor/scenery-LICENSE.txt").text();
      return new Response("/*!\n" + license + "\n*/\n" + (await r.outputs[0]!.text()), { headers: { "content-type": "text/javascript" } });
    },
    "/earth-surface/*": async (req) => {
      const path = new URL(req.url).pathname.slice("/earth-surface/".length);
      if (!/^v1\/[a-z]+\/[0-3]-[0-3]-[a-f0-9]{8}\.(ktx2|classes\.gz)$/.test(path)) return new Response("not found", { status: 404 });
      const file = Bun.file(`assets/earth-surface/${path}`);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "content-type": path.endsWith(".ktx2") ? "image/ktx2" : "application/gzip" } });
    },
    // the game's pages beside it (docs/kerr.html — the presentation —, how to play, discover) and their images, as Pages
    // publishes them under docs/
    "/kerr": () => Response.redirect("/docs/kerr.html", 302),
    "/docs/*": async (req) => {
      const path = decodeURIComponent(new URL(req.url).pathname.replace(/^\/docs\//, ""));
      if (!/^((kerr|decouvrir|comment-jouer)\.html|img\/[\w./-]+\.(webp|jpg|png|svg))$/.test(path) || path.includes(".."))
        return new Response("not found", { status: 404 });
      const file = Bun.file(`docs/${path}`);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file);
    },
    // the world's airfields and runways (scripts/build-runways.ts — PLAN-RADAR-AAA RD10): their tiles, index, codes
    "/runways/*": async (req) => {
      const path = new URL(req.url).pathname.replace(/^.*\/runways\//, "");
      if (!/^v1\/(t-?\d+_-?\d+|index|idents|names)\.json$/.test(path)) return new Response("not found", { status: 404 });
      const file = Bun.file(`assets/runways/${path}`);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "content-type": "application/json", "cache-control": "max-age=86400" } });
    },
    // the approaches' real data (scripts/build-approaches.ts — PLAN-APPROCHES AP0): their tiles, index, report
    "/approaches/*": async (req) => {
      const path = new URL(req.url).pathname.replace(/^.*\/approaches\//, "");
      if (!/^v1\/(t-?\d+_-?\d+|index|report)\.json$/.test(path)) return new Response("not found", { status: 404 });
      const file = Bun.file(`assets/approaches/${path}`);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "content-type": "application/json", "cache-control": "max-age=86400" } });
    },
    // the build's version (the benchmark's report names it); the pages build writes the same file
    "/version.json": async () => Response.json({ sha: (await Bun.$`git rev-parse --short HEAD`.nothrow().text()).trim() || "dev" }),
    // the Service Worker (src/sw.ts), the manifest and the icons (pwa/), the precache list
    "/sw.js": async () => {
      const r = await Bun.build({
        entrypoints: ["./src/sw.ts"],
        target: "browser",
        minify: !dev,
        // (a new build at each ask in development — and under KERR_SW_FRESH: the update e2e's « new version », audit QA-16)
        define: { __BUILD__: JSON.stringify(dev || process.env.KERR_SW_FRESH ? `dev-${Date.now()}` : "local") },
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
    // (the precache list: the workers and the WASM this server builds at the top level, as the pages build lists its top-level
    // js and wasm — the page and its bundle are warmed by the page itself (src/pwa.ts warmShell), a worker's script is not: an
    // empty list left the e2e's offline reload with no earth-surface or terrain-mesh worker, the ground never asked for)
    "/precache.json": () =>
      Response.json([
        "plan-worker.js",
        "mirage-worker.js",
        "intro-worker.js",
        "net.js",
        "audio-worklet.js",
        "ktx-worker.js",
        "earth-surface-worker.js",
        "wgsl-specialise-worker.js",
        "tile-decode-worker.js",
        "tree-asset-worker.js",
        "terrain-mesh-worker.js",
        "scenery-worker.js",
        "cell-worker.js",
        "basis_transcoder.wasm",
      ]),
    // (the OAuth callback of "Sign in with OpenRouter" — PLAN-TARS T6)
    "/openrouter.html": () => new Response(Bun.file("pwa/openrouter.html"), { headers: { "content-type": "text/html; charset=utf-8" } }),
    "/basis_transcoder.wasm": () =>
      new Response(Bun.file("vendor/basis/basis_transcoder.wasm"), { headers: { "content-type": "application/wasm" } }),
    // Embedded Linux OBC assets (docs/PLAN-LINUX-OBC.md): kernel WASM, Alpine EROFS (with Range support), and live scripts
    "/obc/unkernel.wasm": async (req) => {
      const file = Bun.file("node_modules/unkernel/dist/unkernel.wasm");
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return serveRangeFile(req, file, "application/wasm");
    },
    "/obc/alpine.erofs": async (req) => {
      const file = Bun.file("assets/obc/alpine.erofs");
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return serveRangeFile(req, file, "application/octet-stream");
    },
    "/obc/debian.erofs": async (req) => {
      const local = Bun.file("assets/obc/debian.erofs");
      if (await local.exists()) return serveRangeFile(req, local, "application/octet-stream");
      try {
        // (the pinned release's image, size and sha256 checked — scripts/obc-distro.ts)
        debianDistroPathPromise ??= pinnedDistroPath("debian", "assets/obc/debian.erofs", false);
        const p = await debianDistroPathPromise;
        const file = Bun.file(p);
        if (!(await file.exists())) return new Response("not found", { status: 404 });
        return serveRangeFile(req, file, "application/octet-stream");
      } catch (err) {
        debianDistroPathPromise = null;
        return new Response(`debian.erofs unavailable: ${err instanceof Error ? err.message : String(err)}`, { status: 503 });
      }
    },
    "/obc/distros.json": async () => {
      const file = Bun.file("assets/obc/distros.json");
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "content-type": "application/json" } });
    },
    "/obc/obc-rs": async (req) => {
      const file = Bun.file("assets/obc/obc-rs");
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return serveRangeFile(req, file, "application/octet-stream");
    },
    "/obc/scripts/*": async (req) => {
      const rel = new URL(req.url).pathname.slice("/obc/scripts/".length);
      if (!/^(lib\/)?[a-zA-Z0-9._-]+$/.test(rel) || rel.includes("..")) return new Response("not found", { status: 404 });
      const file = Bun.file(`scripts/obc/${rel}`);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    },
    "/obc/pilot-kit/*": async (req) => {
      const rel = new URL(req.url).pathname.slice("/obc/pilot-kit/".length);
      if (!/^[a-zA-Z0-9._/-]+$/.test(rel) || rel.includes("..") || rel.startsWith("/")) return new Response("not found", { status: 404 });
      const file = Bun.file(`scripts/obc/pilot-kit/${rel}`);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
    },
    // Dev-only Wisp v1 WebSocket-to-TCP relay for OBC internet access (docs/PLAN-LINUX-OBC.md §6)
    // (the page's own Origin required — foreignOrigin —, the same ports, address guard and caps as production, counted by the
    // socket's address: the dev server has no proxy in front)
    "/__wisp": ((
      req: Request,
      srv: { upgrade(r: Request, o: { data: unknown }): boolean; requestIP(r: Request): { address: string } | null },
    ) =>
      wispUpgrade(req, srv, {
        enabled: dev || process.env.KERR_WISP_RELAY === "1",
        clientIp: srv.requestIP(req)?.address,
        policy: wispPolicy,
      })) as never,
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
      if ((ws.data as unknown as Peer).kind === "rooms") return;
      if ((ws.data as unknown as WispSession).kind === "wisp") return wispOpen(ws);
      const r = ws.data as unknown as Relay;
      earOpened();
      // (a relay's life bounded — the ear's minutes, the voice's line —: closed after it, the key not spent for ever)
      r.timer = setTimeout(() => ws.close(1008, "time"), 1000 * (r.path === "speak" ? EAR_LIMITS.speakS : EAR_LIMITS.listenS));
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
      if ((ws.data as unknown as Peer).kind === "rooms") return rooms.websocket.message(ws as never, m as never);
      if ((ws.data as unknown as WispSession).kind === "wisp") return wispMessage(ws, m as string | ArrayBuffer | Uint8Array);
      const r = ws.data as unknown as Relay;
      if (r.up?.readyState === WebSocket.OPEN) r.up.send(m);
      // (the queue before Deepgram's side opens: bounded)
      else if (queueFits(r.queue, m)) r.queue.push(m);
      else ws.close(1009, "queue");
    },
    drain(ws) {
      if ((ws.data as unknown as WispSession).kind === "wisp") return wispDrain(ws);
    },
    close(ws) {
      if ((ws.data as unknown as Peer).kind === "rooms") return rooms.websocket.close(ws as never);
      if ((ws.data as unknown as WispSession).kind === "wisp") return wispClose(ws);
      const r = ws.data as unknown as Relay;
      earClosed();
      if (r.timer) clearTimeout(r.timer);
      if (r.up && r.up.readyState <= WebSocket.OPEN) r.up.close();
    },
    backpressureLimit: 8 * 1024 * 1024,
    closeOnBackpressureLimit: false,
  },
});

/** Serve a static binary file with full HTTP Range (206 Partial Content) & HEAD support (needed by Unkernel HttpBase). */
async function serveRangeFile(req: Request, file: ReturnType<typeof Bun.file>, contentType: string): Promise<Response> {
  const size = file.size;
  const etag = `"${size}-${file.lastModified}"`;
  const baseHeaders: Record<string, string> = {
    "content-type": contentType,
    "accept-ranges": "bytes",
    etag,
    "cache-control": "public, max-age=3600",
  };
  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers: { ...baseHeaders, "content-length": String(size) } });
  }
  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] ? Number.parseInt(m[1], 10) : 0;
      let end = m[2] ? Number.parseInt(m[2], 10) : size - 1;
      if (!m[1] && m[2]) {
        const suffix = Number.parseInt(m[2], 10);
        start = Math.max(0, size - suffix);
        end = size - 1;
      }
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      }
      end = Math.min(end, size - 1);
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: {
          ...baseHeaders,
          "content-range": `bytes ${start}-${end}/${size}`,
          "content-length": String(end - start + 1),
        },
      });
    }
  }
  return new Response(file, { status: 200, headers: { ...baseHeaders, "content-length": String(size) } });
}

console.log(`Black hole simulator → ${server.url}`);
