// The flight lab's campaign (docs/FLIGHTLAB.md): the scenarios of tests/flight/scenarios.ts flown one after
// the other in the real app, each in a fresh page, watched while they fly — and steerable.
//
//   bun scripts/flightlab.ts list [--only <re>] [--tags a,b] [--shard i/n]
//   bun scripts/flightlab.ts run  [--only <re>] [--tags a,b] [--shard i/n] [--port 4711] [--out <dir>] [--retries n]
//   bun scripts/flightlab.ts ctl  [--host kerr-mini] [--port 4711] status | shot [label] [--to file.png] | eval <js>
//                                  | pause | resume | skip | abort | note <text>
//   bun scripts/flightlab.ts report <dir>        (the charts and the index written again from a campaign's folder)
//
// While it runs: a line every 10 s (the scenario, its phase, height, speed, autopilot, hub's card), every pilot
// message and phase change as it comes, and a control server on 127.0.0.1:<port> — `ctl` asks it (over ssh for
// the other Mac): the live status (the latest sample whole), a screenshot now, a JS expression evaluated in the
// page, pause/resume (between chunks), skip the scenario, abort the campaign, a note in the report.
// It writes flight-results/<campaign>/: <scenario>/{telemetry.jsonl, events.jsonl, graphs.json, summary.json,
// shots/, report.html}, summary.json and index.html. On the other Mac (scripts/remote.ts run … -- bun
// scripts/flightlab.ts run --shard 2/2) they come back with the job's artifacts.
// Shards: the scenarios dealt by their estimated duration (the longest first, each to the lightest shard) —
// the same deal on every machine, so `--shard 1/2` here and `--shard 2/2` there cover them all once.
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { campaignReport, scenarioReport } from "../tests/flight/lib/charts";
import { Lab, type Event, type Sample } from "../tests/flight/lib/lab";
import { quality } from "../tests/flight/lib/quality";
import { SCENARIOS, type Scenario } from "../tests/flight/scenarios/index";
import { stopServer } from "../tests/e2e/lib/app";
import { LAB_DIR } from "./lib/chrome-lock";

const argv = process.argv.slice(2);
const sub = argv[0];
const val = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const MACHINE = hostname().replace(/\.local$/, "");

function pick(): Scenario[] {
  const only = val("only") ? new RegExp(val("only")!, "i") : null;
  const tags = val("tags")?.split(",").filter(Boolean) ?? [];
  let list = SCENARIOS.filter(
    (s) => (!only || only.test(s.id) || only.test(s.title)) && (!tags.length || tags.some((t) => s.tags.includes(t))),
  );
  const shard = val("shard");
  if (shard) {
    const [i, n] = shard.split("/").map(Number) as [number, number];
    const load = new Array(n).fill(0),
      deal = new Map<string, number>();
    for (const s of [...list].sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id))) {
      const k = load.indexOf(Math.min(...load));
      load[k] += s.minutes;
      deal.set(s.id, k + 1);
    }
    list = list.filter((s) => deal.get(s.id) === i);
  }
  return list;
}

const stamp = () => {
  const d = new Date(),
    p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

if (sub === "list") {
  const list = pick();
  for (const s of list) console.log(`${s.id.padEnd(34)} ~${String(s.minutes).padStart(3)} min  [${s.tags.join(" ")}]  ${s.title}`);
  console.log(`${list.length} scenarios, ~${list.reduce((a, s) => a + s.minutes, 0)} min`);
} else if (sub === "report") {
  const dir = argv[1] ?? process.exit(2);
  const rows = readdirSync(dir)
    .filter((d) => existsSync(`${dir}/${d}/summary.json`))
    .map((d) => {
      scenarioReport(`${dir}/${d}`);
      return JSON.parse(readFileSync(`${dir}/${d}/summary.json`, "utf8"));
    });
  campaignReport(dir, rows);
  console.log(`${dir}/index.html — ${rows.length} scenarios`);
} else if (sub === "run") await run();
else if (sub === "ctl") await ctl();
else {
  console.error("list | run | ctl | report — see the header of scripts/flightlab.ts");
  process.exit(2);
}

async function run() {
  const list = pick();
  if (!list.length) {
    console.error("flightlab: no scenario matches");
    process.exit(2);
  }
  const out = val("out") ?? `flight-results/${stamp()}-${MACHINE}${val("shard") ? `-${val("shard")!.replace("/", "of")}` : ""}`;
  mkdirSync(out, { recursive: true });
  const retries = Number(val("retries") ?? 0);
  const port = Number(val("port") ?? 4711);
  const t0 = Date.now();
  const clock = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  const say = (s: string) => console.log(`[${clock()}] ${s}`);
  const rows: {
    id: string;
    title: string;
    verdict: string;
    why: string;
    wallS: number;
    machine: string;
    tags: string[];
    metrics?: unknown;
  }[] = [];
  const state: {
    control: "run" | "pause" | "skip" | "abort";
    current: Scenario | null;
    lab: Lab | null;
    T: Sample | null;
    events: Event[];
    started: number;
    notes: string[];
  } = {
    control: "run",
    current: null,
    lab: null,
    T: null,
    events: [],
    started: 0,
    notes: [],
  };
  // (the control server: asked by `ctl`, here or over ssh)
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const u = new URL(req.url);
      const json = (d: unknown) => new Response(JSON.stringify(d, null, 1), { headers: { "content-type": "application/json" } });
      switch (u.pathname) {
        case "/status":
          return json({
            machine: MACHINE,
            out,
            control: state.control,
            done: rows.map((r) => `${r.verdict} ${r.id} — ${r.why}`),
            left: list.length - rows.length,
            scenario: state.current && {
              id: state.current.id,
              title: state.current.title,
              wallS: Math.round((Date.now() - state.started) / 1000),
            },
            events: state.events.slice(-12).map((e) => `${Math.round(e.t)}s ${e.kind} ${e.text}`),
            T: state.T,
          });
        case "/shot": {
          if (!state.lab) return new Response("no flight", { status: 409 });
          const png = await state.lab.png();
          const label = (u.searchParams.get("label") ?? "ctl").replace(/[^a-z0-9-]+/gi, "_");
          writeFileSync(`${state.lab.o.dir}/shots/ctl-${Date.now()}-${label}.png`, png);
          return new Response(png, { headers: { "content-type": "image/png" } });
        }
        case "/eval": {
          if (!state.lab) return new Response("no flight", { status: 409 });
          try {
            return json({ value: await state.lab.js(await req.text()) });
          } catch (e) {
            return json({ error: String(e) });
          }
        }
        case "/pause":
        case "/resume":
        case "/skip":
        case "/abort":
          state.control = u.pathname === "/resume" ? "run" : (u.pathname.slice(1) as "pause" | "skip" | "abort");
          say(`control: ${state.control}`);
          return json({ control: state.control });
        case "/note": {
          const n = await req.text();
          state.notes.push(`${state.current?.id ?? "-"}: ${n}`);
          state.lab?.note("note", n);
          return json({ ok: true });
        }
      }
      return new Response("status | shot | eval | pause | resume | skip | abort | note", { status: 404 });
    },
  });
  // (registered for scripts/lab-monitor.ts: found, then asked through its control server)
  const reg = `${LAB_DIR}/runs/${process.pid}.json`;
  mkdirSync(`${LAB_DIR}/runs`, { recursive: true });
  writeFileSync(reg, JSON.stringify({ pid: process.pid, port: server.port, out, cwd: process.cwd(), since: Date.now() }));
  process.once("exit", () => rmSync(reg, { force: true }));
  say(
    `flightlab on ${MACHINE}: ${list.length} scenarios (~${list.reduce((a, s) => a + s.minutes, 0)} min) → ${out} · control 127.0.0.1:${server.port}`,
  );
  for (const sc of list) {
    if (state.control === "abort") break;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const dir = `${out}/${sc.id}${attempt ? `-retry${attempt}` : ""}`;
      mkdirSync(dir, { recursive: true });
      state.current = sc;
      state.started = Date.now();
      state.events = [];
      if (state.control === "skip") state.control = "run";
      say(`▶ ${sc.id} — ${sc.title}`);
      // (what this machine's Chrome lock shows while this scenario holds it)
      process.env.KERR_LAB_LABEL = `flightlab ${sc.id}`;
      let lastLine = 0;
      let lab: Lab | null = null;
      let verdict = "ERROR",
        why = "",
        metrics: Record<string, unknown> = {};
      try {
        lab = await Lab.open({
          dir,
          hash: sc.hash,
          tiles: sc.tiles,
          control: () => state.control,
          onSample: (T) => {
            state.T = T;
            if (Date.now() - lastLine > 10_000) {
              lastLine = Date.now();
              say(
                `  ${sc.id} t=${Math.round(T.t)}s ${T.label ?? ""} alt=${T.alt ?? "-"}km v=${T.v ?? "-"}m/s auto=${T.auto}${T.hub ? ` hub=${T.hub.title}/${T.hub.phase}` : ""}${T.entry ? ` entry=${T.entry.ph}${T.entry.prof ? `/${T.entry.prof}` : ""}` : ""}${T.dockInfo ? ` dock=${T.dockInfo.range}m` : ""} warp=${T.warp}`,
              );
            }
          },
          onEvent: (e) => {
            state.events.push(e);
            if (e.kind !== "shot") say(`  · ${Math.round(e.t)}s ${e.kind}: ${e.text}`);
          },
        });
        state.lab = lab;
        const r = await sc.run(lab);
        verdict = state.control === "skip" ? "SKIP" : r.ok ? "PASS" : "FAIL";
        why = r.why;
        metrics = r.metrics ?? {};
      } catch (e) {
        why = `${(e as Error).message ?? e}`.split("\n")[0]!.slice(0, 300);
        lab?.note("error", why);
        await lab?.shot("error", true).catch(() => {});
      }
      const wallS = (Date.now() - state.started) / 1000;
      if (lab) {
        await lab.saveGraphs().catch(() => {});
        // (how well it flew, whatever the scenario judged: the q_… measures)
        metrics = { ...metrics, ...quality(dir) };
        lab.write("summary.json", {
          id: sc.id,
          title: sc.title,
          tags: sc.tags,
          verdict,
          why,
          metrics,
          wallS,
          machine: MACHINE,
          attempt,
          ...lab.digest(),
        });
      }
      lab?.close();
      state.lab = null;
      try {
        scenarioReport(dir);
      } catch (e) {
        say(`  (report: ${e})`);
      }
      say(`${verdict === "PASS" ? "✓" : "✗"} ${verdict} ${sc.id} (${Math.round(wallS)} s) — ${why}`);
      const done = verdict === "PASS" || verdict === "SKIP" || attempt === retries || state.control === "abort";
      if (done) {
        rows.push({
          id: `${sc.id}${attempt ? `-retry${attempt}` : ""}`,
          title: sc.title,
          verdict: attempt && verdict === "PASS" ? "FLAKY" : verdict,
          why,
          wallS,
          machine: MACHINE,
          tags: sc.tags,
          metrics,
        });
        break;
      }
    }
    writeFileSync(`${out}/summary.json`, `${JSON.stringify({ machine: MACHINE, rows, notes: state.notes }, null, 1)}\n`);
    campaignReport(out, rows);
  }
  server.stop(true);
  stopServer();
  const pass = rows.filter((r) => r.verdict === "PASS").length;
  say(`done: ${pass}/${rows.length} pass → ${out}/index.html`);
  for (const r of rows) if (r.verdict !== "PASS") say(`  ${r.verdict} ${r.id} — ${r.why}`);
  process.exit(pass === rows.length ? 0 : 1);
}

async function ctl() {
  const host = val("host");
  const port = Number(val("port") ?? 4711);
  const verb = argv.slice(1).find((a, k, l) => !a.startsWith("--") && !["--host", "--port", "--to"].includes(l[k - 1] ?? ""));
  if (!verb) {
    console.error("ctl status | shot [label] | eval <js> | pause | resume | skip | abort | note <text>");
    process.exit(2);
  }
  const rest = argv
    .slice(argv.indexOf(verb) + 1)
    .filter((a, k, l) => !a.startsWith("--") && !["--host", "--port", "--to"].includes(l[k - 1] ?? ""));
  const path = verb === "shot" ? `/shot?label=${encodeURIComponent(rest[0] ?? "ctl")}` : `/${verb}`;
  const body = verb === "eval" || verb === "note" ? rest.join(" ") : undefined;
  const url = `http://127.0.0.1:${port}${path}`;
  let bytes: Uint8Array;
  if (host) {
    // (the other Mac: curl there, over ssh — the server listens on its loopback only)
    const p = Bun.spawn(
      [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        host,
        `curl -s --max-time 60 ${body !== undefined ? "--data-binary @-" : ""} '${url}'`,
      ],
      { stdin: body !== undefined ? new TextEncoder().encode(body) : "ignore", stdout: "pipe", stderr: "inherit" },
    );
    bytes = new Uint8Array(await new Response(p.stdout).arrayBuffer());
    if ((await p.exited) !== 0) process.exit(1);
  } else {
    const r = await fetch(url, body !== undefined ? { method: "POST", body } : undefined).catch(() => null);
    if (!r) {
      console.error(`flightlab: nothing listens on ${url}`);
      process.exit(1);
    }
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  if (verb === "shot") {
    const to = val("to") ?? `flight-results/ctl-${host ?? MACHINE}-${Date.now()}.png`;
    mkdirSync(to.replace(/\/[^/]*$/, "") || ".", { recursive: true });
    writeFileSync(to, bytes);
    console.log(to);
  } else console.log(new TextDecoder().decode(bytes));
}
