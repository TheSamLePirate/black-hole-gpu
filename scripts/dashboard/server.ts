// The e2e dashboard (docs/E2E.md §9): a page of its own — not the game — over the e2e harness. The lab's two
// Macs live, runs started here or on kerr-mini and streamed as they go, every past run with its tests,
// failures, log and pictures, the e2e files with their history, a live page of the app driven through __bh,
// and the docs (E2E guide, the __bh reference, the catalogue).
//
//   bun run dashboard                  → http://localhost:4700 (E2E_DASH_PORT)
//
// Local only: it listens on 127.0.0.1 — it starts processes and evaluates code in a browser.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { ServerWebSocket } from "bun";
import index from "./ui/index.html";
import { doctor, lab, pollHere, pollMini } from "./lab";
import { evalProbe, inputProbe, probeErrors, probeState, sceneProbe, shotProbe, startProbe, stopProbe } from "./probe";
import {
  attachRun,
  cancelRun,
  FLIGHTS,
  fileStats,
  history,
  liveLines,
  liveRuns,
  RESULTS,
  type RunRequest,
  runDetail,
  shots,
  startRun,
} from "./runs";

const PORT = Number(process.env.E2E_DASH_PORT || 4700);

// ------------------------------------------------------------------------------------------- clients

const clients = new Set<ServerWebSocket<{ frames: boolean }>>();
const emit = (msg: Record<string, unknown>) => {
  const s = JSON.stringify(msg);
  for (const c of clients) if (msg.t !== "frame" || c.data.frames) c.send(s);
};

// ------------------------------------------------------------------------------------------- docs

const DOCS = ["E2E.md", "BH-API.md", "E2E-CATALOGUE.md", "REMOTE-TESTS.md", "FLIGHTLAB.md", "IPAD-TESTS.md"];
const doc = (name: string) => (DOCS.includes(name) && existsSync(join("docs", name)) ? readFileSync(join("docs", name), "utf8") : null);

/** The catalogue's rows: file → its theme, what it proves, scenes, usual seconds, needs. */
function catalogue() {
  const md = doc("E2E-CATALOGUE.md") ?? "";
  const rows: Record<string, { group: string; order: number; what: string; scenes: string; seconds: string; needs: string }> = {};
  let order = 0;
  let group = "";
  for (const line of md.split("\n")) {
    const g = line.match(/^###\s+(.*)/);
    if (g) group = g[1]!.trim();
    const cells = line.match(/^\|\s*`?([\w.-]+\.e2e\.test\.ts)`?\s*\|(.*)\|\s*$/);
    if (!cells) continue;
    const [what, scenes, seconds, needs] = cells[2]!.split(/(?<!\\)\|/).map((c) => c.trim());
    rows[cells[1]!] = { group, order: order++, what: what ?? "", scenes: scenes ?? "", seconds: seconds ?? "", needs: needs ?? "" };
  }
  return rows;
}

/** The e2e files: the catalogue's word on each, and their history. */
function files() {
  const cat = catalogue();
  const stats = fileStats();
  return readdirSync("tests/e2e")
    .filter((f) => f.endsWith(".e2e.test.ts"))
    .sort()
    .map((f) => {
      const s = stats.get(f);
      const head = readFileSync(join("tests/e2e", f), "utf8").split("\n");
      const comment = head
        .filter((l) => l.startsWith("//"))
        .slice(0, 6)
        .map((l) => l.replace(/^\/\/\s?/, ""))
        .join(" ");
      const tests = head.filter((l) => /^\s*test(\.skipIf\([^)]*\))?\(\s*["'`]/.test(l)).length;
      const sorted = [...(s?.seconds ?? [])].sort((a, b) => a - b);
      return {
        file: f,
        name: f.replace(/\.e2e\.test\.ts$/, ""),
        tests,
        comment,
        ...(cat[f] ?? { group: "Uncatalogued", order: 9999, what: comment.slice(0, 140), scenes: "", seconds: "", needs: "" }),
        runs: s?.runs ?? 0,
        passed: s?.passed ?? 0,
        last: s?.last ?? null,
        recent: s?.recent ?? [],
        medianS: sorted.length ? sorted[Math.floor(sorted.length / 2)] : Number(cat[f]?.seconds) || null,
      };
    });
}

/** The __bh reference's entries: path, its heading, its section, its body (Markdown). */
function bhEntries() {
  const md = doc("BH-API.md") ?? "";
  const out: { path: string; heading: string; section: string; body: string }[] = [];
  let section = "";
  let cur: (typeof out)[number] | null = null;
  for (const line of md.split("\n")) {
    const s = line.match(/^##\s+(.*)/);
    const h = line.match(/^###\s+(.*)/);
    if (s && !h) {
      section = s[1]!.trim();
      cur = null;
    } else if (h) {
      const path = h[1]!.match(/`(__bh[\w.$]*)/)?.[1] ?? h[1]!;
      cur = { path, heading: h[1]!.trim(), section, body: "" };
      out.push(cur);
    } else if (cur) cur.body += `${line}\n`;
  }
  return out;
}

// ------------------------------------------------------------------------------------------- files

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};
function serveFile(rel: string) {
  const p = normalize(decodeURIComponent(rel));
  if (!(p.startsWith(`${RESULTS}/`) || p.startsWith(`${FLIGHTS}/`)) || p.includes("..")) return new Response("no", { status: 403 });
  if (!existsSync(p) || !statSync(p).isFile()) return new Response("not found", { status: 404 });
  const ext = extname(p).toLowerCase();
  return new Response(Bun.file(p), {
    headers: {
      "content-type": TYPES[ext] ?? (p.endsWith("/log") ? "text/plain; charset=utf-8" : "application/octet-stream"),
      "cache-control": "no-cache",
    },
  });
}

// ------------------------------------------------------------------------------------------- server

const json = (v: unknown, status = 200) => Response.json(v, { status });
const body = async <T>(req: Request) => (await req.json().catch(() => ({}))) as T;
const guard = async (fn: () => Promise<Response> | Response) => {
  try {
    return await fn();
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 400);
  }
};

const server = Bun.serve<{ frames: boolean }>({
  hostname: "127.0.0.1",
  port: PORT,
  development: process.env.NODE_ENV !== "production" ? { hmr: true, console: false } : false,
  routes: {
    "/": index,
    "/api/state": () =>
      json({
        lab,
        live: liveRuns(),
        probe: probeState(),
        host: Bun.spawnSync(["hostname", "-s"]).stdout.toString().trim(),
        commit: Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim(),
        dirty: Bun.spawnSync(["git", "status", "--porcelain"]).stdout.toString().trim() !== "",
      }),
    "/api/history": () => json(history()),
    "/api/runs/:id": (req) => {
      const d = runDetail(req.params.id);
      return d ? json(d) : json({ error: "no such run" }, 404);
    },
    "/api/runs/:id/lines": (req) => json(liveLines(req.params.id) ?? []),
    "/api/runs": { POST: (req) => guard(async () => json(startRun(await body<RunRequest>(req), emit))) },
    "/api/attach/:job": { POST: (req) => guard(() => json(attachRun(req.params.job, emit))) },
    "/api/runs/:id/cancel": { POST: (req) => guard(async () => json({ ok: await cancelRun(req.params.id) })) },
    "/api/files": () => json(files()),
    "/api/shots": () => json(shots()),
    "/api/bh": () => json(bhEntries()),
    "/api/docs/:name": (req) => {
      const d = doc(req.params.name);
      return d === null
        ? json({ error: "no such doc" }, 404)
        : new Response(d, { headers: { "content-type": "text/markdown; charset=utf-8" } });
    },
    "/api/lab/refresh": {
      POST: async () => {
        await Promise.all([pollHere(), pollMini()]);
        emit({ t: "lab", lab });
        return json(lab);
      },
    },
    "/api/lab/doctor": { POST: () => guard(async () => json(await doctor())) },
    "/api/probe/start": {
      POST: (req) =>
        guard(async () => {
          const o = await body<{ scene?: string; width?: number; height?: number }>(req);
          void startProbe(emit, o);
          return json(probeState());
        }),
    },
    "/api/probe/stop": { POST: () => guard(async () => (await stopProbe(emit), json(probeState()))) },
    "/api/probe/eval": { POST: (req) => guard(async () => json(await evalProbe((await body<{ expr: string }>(req)).expr))) },
    "/api/probe/input": { POST: (req) => guard(async () => (await inputProbe(await body(req)), json({ ok: true }))) },
    "/api/probe/scene": {
      POST: (req) => guard(async () => (await sceneProbe(emit, (await body<{ scene: string }>(req)).scene), json(probeState()))),
    },
    "/api/probe/shot": { POST: (req) => guard(async () => json({ url: await shotProbe((await body<{ name?: string }>(req)).name) })) },
    "/api/probe/errors": () => json(probeErrors()),
  },
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws")
      return srv.upgrade(req, { data: { frames: false } }) ? undefined : new Response("upgrade failed", { status: 400 });
    if (url.pathname.startsWith("/files/")) return serveFile(url.pathname.slice(7));
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      ws.send(JSON.stringify({ t: "hello", lab, live: liveRuns(), probe: probeState() }));
    },
    message(ws, m) {
      try {
        const msg = JSON.parse(String(m));
        if (msg.t === "frames") ws.data.frames = !!msg.on;
      } catch {
        /* (not ours) */
      }
    },
    close(ws) {
      clients.delete(ws);
    },
  },
});

// (the lab polled: this Mac often, the mini less — ssh costs; both at once on demand)
const loop = async (fn: () => Promise<unknown>, ms: number) => {
  for (;;) {
    await fn().catch(() => {});
    emit({ t: "lab", lab });
    await Bun.sleep(ms);
  }
};
void loop(pollHere, 4000);
void loop(pollMini, 10_000);

// (anything new on disk — a run, a remote job fetched, an --each summary, a picture, made here or from the
// command line —: the pages told to refresh their history, files and pictures)
let lastStamp = "";
setInterval(() => {
  const stamp = [RESULTS, `${RESULTS}/dash`, FLIGHTS]
    .filter((d) => existsSync(d))
    .map((d) => `${d}:${readdirSync(d).length}:${statSync(d).mtimeMs}`)
    .concat(String(shots()[0]?.mtime ?? 0))
    .join("|");
  if (lastStamp && stamp !== lastStamp) emit({ t: "history" });
  lastStamp = stamp;
}, 5000);

// (the live page's Chrome ended with the server, whatever stops it)
for (const [sig, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
] as const)
  process.on(sig, async () => {
    await stopProbe(emit).catch(() => {});
    process.exit(code);
  });

console.log(`e2e dashboard: http://localhost:${server.port}/`);
