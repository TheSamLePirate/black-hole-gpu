// The e2e dashboard's page (scripts/dashboard/server.ts serves it): one socket for everything live (the lab,
// runs' lines and results, the live page's frames), the rest asked of /api. Views by the URL's hash.
import { renderMarkdown, slug } from "../markdown";
import type { FileResult, LogEvent, LogSummary, TestResult } from "../parse-log";

// ------------------------------------------------------------------------------------------- types

interface Run {
  id: string;
  source: "dash" | "remote" | "summary" | "flightlab";
  title: string;
  where: string;
  cmd: string;
  state: "running" | "done" | "cancelled" | "queued";
  started: number;
  ended?: number;
  exit?: number | null;
  remoteJob?: string;
  counts: { pass: number; fail: number; skip: number; files: number };
  hasLog: boolean;
  report?: string;
}
interface Mac {
  host: string;
  ok: boolean;
  error?: string;
  at: number;
  chrome: string;
  lock: { pid: number; label: string; since: number } | null;
  waiting: { pid: number; label: string; since: number }[];
  chromes: { pid: number; elapsed: string; headless: boolean }[];
  jobs: { id: string; state: string; cmd: string; started?: number }[];
  campaigns: { pid: number; out: string }[];
  tests: { pid: number; elapsed: string; cmd: string }[];
  orphans: { pid: number; elapsed: string; what: string }[];
}
interface FileInfo {
  file: string;
  name: string;
  tests: number;
  comment: string;
  group: string;
  /** its place in the catalogue (the themes shown in its order) */
  order: number;
  what: string;
  scenes: string;
  seconds: string;
  needs: string;
  runs: number;
  passed: number;
  last: { status: "pass" | "fail"; at: number; where: string; run: string } | null;
  /** the last six results, newest first */
  recent: ("pass" | "fail")[];
  medianS: number | null;
}
interface Shot {
  url: string;
  root: string;
  run: string;
  name: string;
  path: string;
  mtime: number;
  size: number;
}
interface BhEntry {
  path: string;
  heading: string;
  section: string;
  body: string;
}
interface Probe {
  state: "off" | "starting" | "on" | "stopping";
  scene?: string;
  width: number;
  height: number;
  since?: number;
  error?: string;
}
interface LiveRun {
  run: Run;
  lines: string[];
  files: Map<string, { file: string; tests: TestResult[] }>;
  current?: string;
}

// ------------------------------------------------------------------------------------------- state

const S = {
  lab: { here: null as Mac | null, mini: null as Mac | null },
  live: new Map<string, LiveRun>(),
  probe: { state: "off", width: 1280, height: 800 } as Probe,
  history: null as Run[] | null,
  files: null as FileInfo[] | null,
  shots: null as Shot[] | null,
  bh: null as BhEntry[] | null,
  meta: { host: "", commit: "", dirty: false },
  connected: false,
  // the run picker's choices (kept across views)
  pick: new Set<string>(),
  where: "mini" as "here" | "mini",
  each: true,
  headless: false,
  hold: 0,
  testName: "",
  update: false,
  filter: "",
  // the live page's console
  repl: [] as { q: string; ok: boolean; v: string; ms?: number; kind?: string }[],
  pconsole: [] as { level: string; text: string; at: number }[],
  replHist: JSON.parse(localStorageGet("dash.replHist") ?? "[]") as string[],
  frame: null as string | null,
  frameSize: { w: 1280, h: 800 },
  fps: 0,
};

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* (private mode) */
  }
}

// ------------------------------------------------------------------------------------------- dom

type Child = Node | string | number | null | undefined | false | Child[];
function h(tag: string, attrs: Record<string, unknown> = {}, ...kids: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    // (handlers as properties, not listeners: a repaint's morph hands the new ones to the nodes it keeps)
    if (k.startsWith("on") && typeof v === "function") (el as unknown as Record<string, unknown>)[k] = v;
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    // (booleans as attributes — disabled, open — so a morph carries them; a field's state as properties)
    else if (typeof v === "boolean" && k !== "checked" && k !== "selected") el.setAttribute(k, "");
    else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  const add = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}
const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement | null;

function toast(msg: string, kind: "ok" | "bad" | "" = "") {
  const t = h("div", { class: `toast ${kind}` }, msg);
  $("#toasts")!.append(t);
  setTimeout(() => t.remove(), 4500);
}

// ------------------------------------------------------------------------------------------- formatting

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const dur = (s: number | null | undefined) => {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
};
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const runDur = (r: Run) => ((r.ended ?? Date.now()) - r.started) / 1000;
const verdict = (r: Run): "run" | "ok" | "bad" | "none" =>
  r.state === "running" || r.state === "queued"
    ? "run"
    : r.source === "flightlab"
      ? "none"
      : r.counts.fail > 0 || (r.exit !== undefined && r.exit !== null && r.exit !== 0)
        ? "bad"
        : r.counts.pass > 0 || r.exit === 0
          ? "ok"
          : "none";
const vBadge = (r: Run) => {
  const v = verdict(r);
  if (v === "run") return h("span", { class: "badge acc" }, h("span", { class: "dot run" }), r.state);
  if (r.state === "cancelled") return h("span", { class: "badge warn" }, "cancelled");
  if (v === "ok") return h("span", { class: "badge ok" }, "✓ passed");
  if (v === "bad") return h("span", { class: "badge bad" }, "✗ failed");
  return h("span", { class: "badge" }, r.source === "flightlab" ? "campaign" : "—");
};

/** JSON indented, but a short array of plain values on one line ([x, y, z], a list of numbers) */
function pretty(v: unknown, ind = ""): string {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? String(v);
  const inner = `${ind}  `;
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    if (v.every((x) => x === null || typeof x !== "object")) {
      const one = `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
      if (one.length <= 160) return one;
      // (long lists of values wrapped, several a line)
      const rows: string[] = [];
      let row = "";
      for (const x of v.map((y) => JSON.stringify(y))) {
        if (row && row.length + x.length > 100) {
          rows.push(row);
          row = "";
        }
        row += (row ? ", " : "") + x;
      }
      if (row) rows.push(row);
      return `[\n${rows.map((r) => inner + r).join(",\n")}\n${ind}]`;
    }
    return `[\n${v.map((x) => inner + pretty(x, inner)).join(",\n")}\n${ind}]`;
  }
  const ks = Object.keys(v);
  if (!ks.length) return "{}";
  return `{\n${ks.map((k) => `${inner}${JSON.stringify(k)}: ${pretty((v as Record<string, unknown>)[k], inner)}`).join(",\n")}\n${ind}}`;
}

function jsonView(v: unknown): HTMLElement {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let text: string;
  try {
    text = typeof v === "string" ? v : pretty(v);
  } catch {
    text = String(v);
  }
  if (typeof v === "string") return h("div", { class: "jv" }, text);
  const html = esc(text.length > 60000 ? `${text.slice(0, 60000)}\n… (${text.length} chars)` : text)
    .replace(/("(?:\\.|[^"\\])*")(\s*:)/g, '<span class="k">$1</span>$2')
    .replace(/: ("(?:\\.|[^"\\])*")/g, ': <span class="s">$1</span>')
    .replace(/\b(-?\d+\.?\d*(?:e[+-]?\d+)?)\b/g, '<span class="n">$1</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="b">$1</span>');
  return h("div", { class: "jv", html });
}

// ------------------------------------------------------------------------------------------- api

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    path,
    body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || (j && typeof j === "object" && "error" in j && Object.keys(j).length === 1)) throw new Error((j as { error: string }).error);
  return j as T;
}
const load = {
  history: async () => (S.history = await api<Run[]>("/api/history")),
  files: async () => (S.files = await api<FileInfo[]>("/api/files")),
  shots: async () => (S.shots = await api<Shot[]>("/api/shots")),
  bh: async () => (S.bh = await api<BhEntry[]>("/api/bh")),
};

// ------------------------------------------------------------------------------------------- socket

let ws: WebSocket | null = null;
let framesOn = false;
function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => {
    S.connected = true;
    paintSide();
    setFrames(framesOn);
  };
  ws.onclose = () => {
    S.connected = false;
    paintSide();
    setTimeout(connect, 1500);
  };
  ws.onmessage = (m) => onMsg(JSON.parse(String(m.data)));
}
function setFrames(on: boolean) {
  framesOn = on;
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "frames", on }));
}

let frameCount = 0;
setInterval(() => {
  S.fps = frameCount;
  frameCount = 0;
  const f = $("#fps");
  if (f) f.textContent = `${S.fps} fps`;
}, 1000);

function liveOf(run: Run): LiveRun {
  let l = S.live.get(run.id);
  if (!l) {
    l = { run, lines: [], files: new Map() };
    S.live.set(run.id, l);
  }
  l.run = run;
  return l;
}

function onMsg(m: Record<string, unknown>) {
  switch (m.t) {
    case "hello":
      S.lab = m.lab as typeof S.lab;
      S.probe = m.probe as Probe;
      for (const r of m.live as Run[]) {
        const l = liveOf(r);
        // (a page opened mid-run: the lines so far)
        api<string[]>(`/api/runs/${r.id}/lines`).then((lines) => {
          l.lines = [];
          l.files.clear();
          for (const line of lines) ingest(l, line);
          schedule();
        });
      }
      schedule();
      break;
    case "lab":
      S.lab = m.lab as typeof S.lab;
      paintSide();
      if (view() === "overview") schedule();
      break;
    case "run": {
      const r = m.run as Run;
      const l = liveOf(r);
      const was = l.run.state;
      if (r.state !== "running" && was === "running") {
        const v = verdict(r);
        toast(
          `${r.title} — ${v === "ok" ? "passed" : r.state === "cancelled" ? "cancelled" : "failed"} (${r.counts.pass} ✓ ${r.counts.fail} ✗)`,
          v === "ok" ? "ok" : "bad",
        );
        S.files = null;
      }
      schedule();
      break;
    }
    case "line": {
      const l = S.live.get(m.id as string);
      if (l) {
        l.lines.push(m.line as string);
        appendLogLine(m.id as string, m.line as string);
      }
      break;
    }
    case "ev": {
      const l = S.live.get(m.id as string);
      if (l) applyEv(l, m.ev as LogEvent);
      schedule();
      break;
    }
    case "history":
      S.history = null;
      S.shots = null;
      if (["overview", "history", "captures", "run"].includes(view())) schedule();
      break;
    case "probe":
      S.probe = (m.state ?? m.probe) as Probe;
      if (S.probe.state === "off") S.frame = null;
      if (view() === "page") paintProbeBar();
      paintSide();
      break;
    case "frame": {
      frameCount++;
      S.frame = m.data as string;
      S.frameSize = { w: m.w as number, h: m.h as number };
      const img = $("#screen-img") as HTMLImageElement | null;
      if (img) {
        img.src = `data:image/jpeg;base64,${S.frame}`;
        img.style.display = "block";
      }
      $("#screen-ov")?.remove();
      break;
    }
    case "pconsole":
      S.pconsole.push(m as unknown as { level: string; text: string; at: number });
      if (S.pconsole.length > 300) S.pconsole.shift();
      if (view() === "page") paintPconsole();
      break;
  }
}

// (a live run's lines replayed through the same parsing the server does, light: files and tests)
function ingest(l: LiveRun, line: string) {
  l.lines.push(line);
  const fm = line.match(/^(tests\/\S+\.test\.ts):$/);
  if (fm) applyEv(l, { type: "file", file: fm[1]! });
  const tm = line.match(/^\((pass|fail|skip|todo)\) (.*?)(?: \[([\d.]+)(ms|s)\])?$/);
  if (tm && l.current)
    applyEv(l, {
      type: "test",
      file: l.current,
      test: { name: tm[2]!, status: tm[1] as TestResult["status"], ms: tm[3] ? Number(tm[3]) * (tm[4] === "s" ? 1000 : 1) : undefined },
    });
}
function applyEv(l: LiveRun, ev: LogEvent) {
  if (ev.type === "file") {
    l.current = ev.file;
    if (!l.files.has(ev.file)) l.files.set(ev.file, { file: ev.file, tests: [] });
  } else if (ev.type === "test") {
    const f = l.files.get(ev.file) ?? { file: ev.file, tests: [] };
    f.tests.push(ev.test);
    l.files.set(ev.file, f);
  }
}

// ------------------------------------------------------------------------------------------- routing

const VIEWS: [string, string, string][] = [
  ["overview", "◉", "Overview"],
  ["run", "▶", "Run tests"],
  ["live", "≋", "Live"],
  ["history", "☰", "History"],
  ["captures", "▣", "Captures"],
  ["page", "◈", "Live page · __bh"],
  ["api", "ƒ", "__bh API"],
  ["doc", "¶", "Docs"],
];
const view = () => (location.hash.slice(1).split("/")[0] || "overview") as string;
const arg = () => decodeURIComponent(location.hash.slice(1).split("/").slice(1).join("/"));

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    paint(false);
  }, 180);
}

let lastView = "";
function paint(fresh = true) {
  paintSide();
  const v = view();
  const main = $("#main")!;
  // (the live page is painted once: frames and its console update in place, the REPL keeps its text)
  if (v === "page" && lastView === "page" && !fresh) return;
  const sameView = v === lastView && `${v}/${arg()}` === lastKey;
  const page = (PAGES[v] ?? PAGES.overview!)();
  if (sameView && main.firstElementChild) {
    // (the same view repainted: the nodes kept, only what changed changed — a click, a hover, a scroll, a
    // focused field survive the lab's updates)
    const follows = [...main.querySelectorAll<HTMLElement>("[data-follow='1']")].map(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 30,
    );
    morph(main.firstElementChild, page);
    main.querySelectorAll<HTMLElement>("[data-follow='1']").forEach((el, i) => {
      if (follows[i] ?? true) el.scrollTop = el.scrollHeight;
    });
  } else {
    main.replaceChildren(page);
    main.scrollTop = 0;
    for (const el of main.querySelectorAll<HTMLElement>("[data-follow='1']")) el.scrollTop = el.scrollHeight;
  }
  lastView = v;
  lastKey = `${v}/${arg()}`;
  setFrames(v === "page");
}
let lastKey = "";

const HANDLERS = ["onclick", "oninput", "onchange", "onmousedown", "oncontextmenu", "onkeydown", "onfocus", "onblur"] as const;
/** `old` made like `next` in place: same tags kept and patched (attributes, handlers, text), the rest replaced. */
function morph(old: Node, next: Node): Node {
  if (old.nodeType !== next.nodeType || old.nodeName !== next.nodeName) {
    old.parentNode?.replaceChild(next, old);
    return next;
  }
  if (old.nodeType === Node.TEXT_NODE) {
    if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue;
    return old;
  }
  if (!(old instanceof HTMLElement) || !(next instanceof HTMLElement)) return old;
  // (a <details>' open or closed is the user's once shown)
  const mine = (name: string) => name === "open" && old instanceof HTMLDetailsElement;
  for (const a of [...old.attributes]) if (!next.hasAttribute(a.name) && !mine(a.name)) old.removeAttribute(a.name);
  for (const a of [...next.attributes]) if (old.getAttribute(a.name) !== a.value && !mine(a.name)) old.setAttribute(a.name, a.value);
  const o = old as unknown as Record<string, unknown>,
    n = next as unknown as Record<string, unknown>;
  for (const k of HANDLERS) if (o[k] !== n[k]) o[k] = n[k];
  // (a field's own state: its text kept while it has the focus)
  if (old instanceof HTMLInputElement || old instanceof HTMLTextAreaElement || old instanceof HTMLSelectElement) {
    if (document.activeElement !== old && old.value !== (next as HTMLInputElement).value) old.value = (next as HTMLInputElement).value;
    if (old instanceof HTMLInputElement) old.checked = (next as HTMLInputElement).checked;
  }
  const oc = [...old.childNodes],
    nc = [...next.childNodes];
  for (let i = 0; i < nc.length; i++) {
    if (i < oc.length) morph(oc[i]!, nc[i]!);
    else old.append(nc[i]!);
  }
  for (let i = nc.length; i < oc.length; i++) oc[i]!.remove();
  // (a select's value once its options are there)
  if (old instanceof HTMLSelectElement && document.activeElement !== old) old.value = (next as HTMLSelectElement).value;
  return old;
}
window.addEventListener("hashchange", () => paint(true));

function paintSide() {
  const liveN = [...S.live.values()].filter((l) => l.run.state === "running").length;
  $("#nav")!.replaceChildren(
    ...VIEWS.map(([k, ico, label]) =>
      h(
        "a",
        { href: `#${k}`, class: view() === k ? "on" : "" },
        h("span", { class: "ico" }, ico),
        label,
        k === "live" && liveN ? h("span", { class: "count live" }, liveN) : null,
        k === "page" && S.probe.state === "on" ? h("span", { class: "count live" }, "on") : null,
      ),
    ),
  );
  const mac = (name: string, m: Mac | null) =>
    h(
      "div",
      { class: "mac", title: m?.error ?? "" },
      h("span", { class: `dot ${!m ? "" : !m.ok ? "bad" : m.lock ? "run" : "ok"}` }),
      h("b", {}, name),
      h("span", { class: "grow" }),
      m?.ok ? (m.lock ? "busy" : "idle") : m ? "down" : "…",
      m?.ok ? h("span", { class: "badge" }, m.chrome) : null,
    );
  $("#side-macs")!.replaceChildren(mac("This Mac", S.lab.here), mac("kerr-mini", S.lab.mini));
  const c = $("#conn")!;
  c.innerHTML = "";
  c.append(h("span", { class: `dot ${S.connected ? "ok" : "bad"}` }), ` ${S.connected ? "live" : "offline"}`);
}

// ------------------------------------------------------------------------------------------- overview

function macCard(name: string, m: Mac | null) {
  const lock = m?.lock;
  return h(
    "div",
    { class: "card mac-card" },
    h(
      "div",
      { class: "title" },
      h("span", { class: `dot ${!m ? "" : !m.ok ? "bad" : lock ? "run" : "ok"}` }),
      h("b", {}, name),
      m?.ok ? h("span", { class: "badge acc" }, `Chrome: ${m.chrome}`) : null,
      h("span", { class: "grow" }),
      h("span", { class: "faint" }, m ? `updated ${ago(m.at)}` : "…"),
    ),
    !m
      ? h("div", { class: "muted" }, h("span", { class: "spinner" }), " reaching it…")
      : !m.ok
        ? h("div", { class: "bad-t" }, m.error ?? "unreachable")
        : h(
            "div",
            { class: "kv" },
            "Chrome lock",
            lock
              ? h(
                  "span",
                  {},
                  h("b", {}, lock.label),
                  h("span", { class: "faint" }, ` · pid ${lock.pid} · ${dur((Date.now() - lock.since) / 1000)}`),
                )
              : h("span", { class: "ok-t" }, "free"),
            "Waiting",
            m.waiting.length ? h("span", {}, m.waiting.map((w) => w.label).join(" · ")) : h("span", { class: "faint" }, "nobody"),
            "Test Chromes",
            h(
              "span",
              { class: m.chromes.length > 1 ? "bad-t" : "" },
              `${m.chromes.length}${m.chromes.length > 1 ? " ⚠ more than one" : ""}`,
              m.chromes.length
                ? h(
                    "span",
                    { class: "faint" },
                    ` · ${m.chromes.map((c) => `${c.headless ? "headless" : "on screen"} ${c.elapsed}`).join(", ")}`,
                  )
                : null,
            ),
            "Remote jobs",
            m.jobs.length
              ? h(
                  "span",
                  { class: "col", style: { gap: "4px" } },
                  m.jobs.map((j) =>
                    h(
                      "span",
                      { class: "row", style: { gap: "6px" } },
                      h("span", { class: `dot ${j.state === "running" ? "run" : ""}` }),
                      h("span", { class: "mono", title: j.cmd }, j.id),
                      h("span", { class: "faint" }, j.state),
                      followed(j.id)
                        ? h("a", { class: "btn sm", href: `#live/${followed(j.id)}` }, "Watch ▸")
                        : h("button", { class: "btn sm", onclick: () => follow(j.id) }, "Follow live ▸"),
                    ),
                  ),
                )
              : h("span", { class: "faint" }, "none"),
            "Campaigns",
            m.campaigns.length ? h("span", {}, m.campaigns.map((c) => c.out).join(" · ")) : h("span", { class: "faint" }, "none"),
            "Orphans",
            m.orphans.length
              ? h("span", { class: "warn-t" }, m.orphans.map((o) => `${o.what} (${o.elapsed})`).join(", "))
              : h("span", { class: "faint" }, "none"),
          ),
  );
}

const followed = (job: string) => [...S.live.values()].find((l) => l.run.remoteJob === job && l.run.state === "running")?.run.id;
async function follow(job: string) {
  try {
    const r = await api<Run>(`/api/attach/${encodeURIComponent(job)}`, {});
    liveOf(r);
    location.hash = `live/${r.id}`;
  } catch (e) {
    toast(String(e), "bad");
  }
}

function sparkline(vals: number[], w = 280, hgt = 44) {
  if (vals.length < 2) return h("span", { class: "faint" }, "not enough runs yet");
  const max = Math.max(...vals, 1);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${hgt - (v / max) * (hgt - 4) - 2}`).join(" ");
  const svg = `<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/></svg>`;
  return h("span", { html: svg });
}

function overview() {
  if (!S.history) load.history().then(schedule);
  if (!S.files) load.files().then(schedule);
  const hist = (S.history ?? []).filter((r) => r.source !== "flightlab");
  const done = hist.filter((r) => r.state === "done" && r.counts.pass + r.counts.fail > 0);
  const last = done[0];
  const files = S.files ?? [];
  const flaky = files.filter((f) => f.last?.status === "pass" && f.recent.includes("fail"));
  const failingNow = files.filter((f) => f.last?.status === "fail");
  const live = [...S.live.values()].filter((l) => l.run.state === "running");
  const passRates = done
    .slice(0, 30)
    .reverse()
    .map((r) => (100 * r.counts.pass) / Math.max(1, r.counts.pass + r.counts.fail));
  return h(
    "div",
    { class: "page" },
    h(
      "div",
      { class: "head" },
      h(
        "div",
        {},
        h("h1", {}, "The test lab"),
        h(
          "div",
          { class: "sub" },
          `${S.meta.host} · ${S.meta.commit}${S.meta.dirty ? " + uncommitted changes" : ""} — one test Chrome per Mac, headless here, full screen on kerr-mini`,
        ),
      ),
      h("span", { class: "grow" }),
      h("button", { class: "btn", onclick: () => api("/api/lab/refresh", {}).then(() => toast("Lab refreshed", "ok")) }, "↻ Refresh lab"),
      h(
        "button",
        {
          class: "btn",
          onclick: async (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.disabled = true;
            b.textContent = "Checking the mini…";
            try {
              const d = await api<{ code: number; text: string }>("/api/lab/doctor", {});
              showModal("kerr-mini — doctor", h("pre", { class: "log", style: { maxHeight: "70vh" } }, d.text));
            } catch (err) {
              toast(String(err), "bad");
            }
            b.disabled = false;
            b.textContent = "⚕ Doctor (mini)";
          },
        },
        "⚕ Doctor (mini)",
      ),
      h("a", { class: "btn primary", href: "#run" }, "▶ Run tests"),
    ),
    h("div", { class: "grid g2", style: { marginBottom: "16px" } }, macCard("This Mac", S.lab.here), macCard("kerr-mini", S.lab.mini)),
    h(
      "div",
      { class: "grid g4", style: { marginBottom: "16px" } },
      kpi(live.length ? String(live.length) : "0", "runs going now", live.length ? "acc" : ""),
      kpi(
        last ? `${last.counts.pass}/${last.counts.pass + last.counts.fail}` : "—",
        last ? `last run · ${ago(last.ended ?? last.started)}` : "no run yet",
        last ? (verdict(last) === "ok" ? "ok" : "bad") : "",
      ),
      kpi(String(failingNow.length), "files failing at their last run", failingNow.length ? "bad" : "ok"),
      kpi(String(flaky.length), "flaky lately (a fail in their last 6)", flaky.length ? "warn" : "ok"),
    ),
    h(
      "div",
      { class: "grid g2" },
      h(
        "div",
        { class: "card" },
        h(
          "h3",
          {},
          "Recent runs",
          h("span", { class: "grow" }),
          h("a", { href: "#history", class: "muted", style: { textTransform: "none", letterSpacing: 0 } }, "all →"),
        ),
        h(
          "div",
          { class: "strip", style: { marginBottom: "12px" } },
          hist
            .slice(0, 40)
            .reverse()
            .map((r) =>
              h("a", {
                href: `#history/${r.id}`,
                class: verdict(r),
                title: `${r.title} — ${when(r.started)} — ${r.counts.pass} ✓ ${r.counts.fail} ✗`,
                style: { height: `${30 + Math.min(70, r.counts.pass + r.counts.fail)}%` },
              }),
            ),
        ),
        runTable(hist.slice(0, 8)),
      ),
      h(
        "div",
        { class: "col" },
        h("div", { class: "card" }, h("h3", {}, "Pass rate, last 30 runs"), sparkline(passRates)),
        h(
          "div",
          { class: "card" },
          h("h3", {}, "Needs attention"),
          !failingNow.length && !flaky.length
            ? h("div", { class: "ok-t" }, "✓ every file passed its last run")
            : h(
                "div",
                { class: "col", style: { gap: "4px" } },
                failingNow.map((f) =>
                  h(
                    "a",
                    { href: f.last ? `#history/${f.last.run}` : "#run", class: "row" },
                    h("span", { class: "dot bad" }),
                    h("span", { class: "mono" }, f.name),
                    h("span", { class: "faint" }, `failed ${f.last ? ago(f.last.at) : ""} on ${f.last?.where}`),
                  ),
                ),
                flaky.map((f) =>
                  h(
                    "div",
                    { class: "row" },
                    h("span", { class: "dot warn" }),
                    h("span", { class: "mono" }, f.name),
                    h(
                      "span",
                      { class: "faint" },
                      `passed last, but ${f.recent.filter((x) => x === "fail").length} of its last ${f.recent.length} failed`,
                    ),
                    recentDots(f.recent),
                  ),
                ),
              ),
        ),
        live.length
          ? h(
              "div",
              { class: "card" },
              h("h3", {}, "Going now"),
              live.map((l) =>
                h(
                  "a",
                  { href: `#live/${l.run.id}`, class: "row" },
                  h("span", { class: "dot run" }),
                  h("b", {}, l.run.title),
                  h("span", { class: "faint" }, `${l.run.where} · ${dur(runDur(l.run))} · ${l.run.counts.pass} ✓ ${l.run.counts.fail} ✗`),
                ),
              ),
            )
          : null,
      ),
    ),
  );
}
const recentDots = (r: ("pass" | "fail")[]) =>
  h(
    "span",
    { class: "row", style: { gap: "3px" }, title: "last results, newest on the left" },
    r.map((x) => h("span", { class: `dot ${x === "pass" ? "ok" : "bad"}`, style: { boxShadow: "none", width: "6px", height: "6px" } })),
  );
const kpi = (v: string, l: string, kind = "") =>
  h(
    "div",
    { class: "card kpi" },
    h("div", { class: `v ${kind === "ok" ? "ok-t" : kind === "bad" ? "bad-t" : kind === "warn" ? "warn-t" : ""}` }, v),
    h("div", { class: "l" }, l),
  );

function runTable(runs: Run[]) {
  if (!runs.length) return h("div", { class: "empty" }, "No run yet — start one from Run tests.");
  return h(
    "div",
    { style: { overflowX: "auto" } },
    h(
      "table",
      { class: "t" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}, ""),
          h("th", {}, "When"),
          h("th", {}, "What"),
          h("th", {}, "Where"),
          h("th", { class: "num" }, "✓"),
          h("th", { class: "num" }, "✗"),
          h("th", { class: "num" }, "Time"),
        ),
      ),
      h(
        "tbody",
        {},
        runs.map((r) =>
          h(
            "tr",
            {
              class: "click",
              onclick: () => (location.hash = r.state === "running" && r.source === "dash" ? `live/${r.id}` : `history/${r.id}`),
            },
            h("td", {}, vBadge(r)),
            h("td", { class: "muted", title: new Date(r.started).toString(), style: { whiteSpace: "nowrap" } }, when(r.started)),
            h(
              "td",
              {},
              h(
                "div",
                { style: { maxWidth: "380px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: r.cmd },
                r.title,
              ),
              h("div", { class: "faint", style: { fontSize: "11.5px" } }, r.source),
            ),
            h("td", {}, h("span", { class: "badge" }, r.where)),
            h("td", { class: "num ok-t" }, r.counts.pass || ""),
            h("td", { class: "num bad-t" }, r.counts.fail || ""),
            h("td", { class: "num muted" }, dur(runDur(r))),
          ),
        ),
      ),
    ),
  );
}

// ------------------------------------------------------------------------------------------- run picker

// (what a file cannot run without: a paid key, the user's own)
const NEEDS_KEY = /OPENROUTER|DEEPGRAM|TARS_LIVE/;
function runPage() {
  if (!S.files) {
    load.files().then(schedule);
    return h("div", { class: "page" }, h("div", { class: "empty" }, h("span", { class: "spinner" }), " Loading the e2e files…"));
  }
  const q = S.filter.toLowerCase();
  const shown = S.files
    .filter((f) => !q || `${f.name} ${f.what} ${f.group} ${f.scenes} ${f.comment}`.toLowerCase().includes(q))
    .sort((a, b) => a.order - b.order);
  const groups = new Map<string, FileInfo[]>();
  for (const f of shown) groups.set(f.group, [...(groups.get(f.group) ?? []), f]);
  const sel = S.files.filter((f) => S.pick.has(f.name));
  const est = sel.reduce((a, f) => a + (f.medianS ?? 20) + (S.each ? 8 : 0), 0) + (S.where === "mini" ? 15 : 0);
  const toggle = (f: FileInfo) => {
    S.pick.has(f.name) ? S.pick.delete(f.name) : S.pick.add(f.name);
    paint(false);
  };
  const quick = (label: string, fn: () => FileInfo[]) =>
    h(
      "button",
      {
        class: "btn sm",
        onclick: () => {
          S.pick = new Set(fn().map((f) => f.name));
          paint(false);
        },
      },
      label,
    );
  const launch = async () => {
    try {
      const r = await api<Run>("/api/runs", {
        files: [...S.pick].map((n) => `${n}.e2e.test.ts`),
        where: S.where,
        each: S.each,
        headless: S.headless,
        hold: S.hold || undefined,
        testName: S.testName || undefined,
        env: S.update ? { UPDATE: "1" } : undefined,
      });
      liveOf(r);
      toast(`Started on ${r.where}: ${r.title}`, "ok");
      location.hash = `live/${r.id}`;
    } catch (e) {
      toast(String(e), "bad");
    }
  };
  return h(
    "div",
    { class: "page" },
    h(
      "div",
      { class: "head" },
      h(
        "div",
        {},
        h("h1", {}, "Run tests"),
        h("div", { class: "sub" }, `${S.files.length} e2e files · pick some (or none for all), choose the Mac, launch`),
      ),
      h("span", { class: "grow" }),
      h("input", {
        class: "input",
        placeholder: "Filter: name, theme, scene…  (/)",
        value: S.filter,
        id: "filter",
        style: { width: "320px" },
        oninput: (e: Event) => {
          S.filter = (e.target as HTMLInputElement).value;
          paint(false);
          const f = $("#filter") as HTMLInputElement;
          f.focus();
          f.setSelectionRange(f.value.length, f.value.length);
        },
      }),
    ),
    h(
      "div",
      { class: "row", style: { marginBottom: "14px" } },
      h("span", { class: "muted" }, "Quick:"),
      quick("Smoke", () => S.files!.filter((f) => ["smoke", "harness", "title", "bh-api"].includes(f.name))),
      quick("Failed last time", () => S.files!.filter((f) => f.last?.status === "fail")),
      quick("Flaky lately", () => S.files!.filter((f) => f.last?.status === "pass" && f.recent.includes("fail"))),
      quick("Never run", () => S.files!.filter((f) => !f.runs && !NEEDS_KEY.test(f.needs))),
      quick("Shown", () => shown),
      quick("Clear", () => []),
    ),
    h(
      "div",
      { class: "picker" },
      h(
        "div",
        { class: "card", style: { padding: "10px" } },
        [...groups].map(([g, fs]) =>
          h(
            "div",
            { class: "group" },
            h(
              "div",
              {
                class: "gh",
                onclick: () => {
                  const all = fs.every((f) => S.pick.has(f.name));
                  for (const f of fs) all ? S.pick.delete(f.name) : S.pick.add(f.name);
                  paint(false);
                },
              },
              g,
              h("span", { class: "faint" }, `${fs.length}`),
              h(
                "span",
                { class: "faint", style: { textTransform: "none", letterSpacing: 0, fontWeight: 400 } },
                "· click to toggle the group",
              ),
            ),
            fs.map((f) =>
              h(
                "div",
                { class: `file ${S.pick.has(f.name) ? "sel" : ""}`, onclick: () => toggle(f), title: f.comment },
                h("input", {
                  type: "checkbox",
                  checked: S.pick.has(f.name),
                  onclick: (e: Event) => e.stopPropagation(),
                  onchange: () => toggle(f),
                }),
                h("span", {
                  class: `dot ${f.last ? (f.last.status === "pass" ? "ok" : "bad") : ""}`,
                  title: f.last ? `${f.last.status} ${ago(f.last.at)} on ${f.last.where}` : "never run",
                }),
                h("span", { class: "n" }, f.name),
                h("span", { class: "w" }, f.what || f.comment),
                h(
                  "span",
                  { class: "row", style: { gap: "4px" } },
                  f.needs && f.needs !== "—" && NEEDS_KEY.test(f.needs)
                    ? h("span", { class: "badge warn", title: f.needs }, "needs")
                    : null,
                  f.runs ? h("span", { class: "badge", title: "passed / runs in history" }, `${f.passed}/${f.runs}`) : null,
                ),
                h("span", { class: "s" }, f.medianS ? dur(f.medianS) : "?"),
              ),
            ),
          ),
        ),
        !shown.length ? h("div", { class: "empty" }, "No file matches.") : null,
      ),
      h(
        "div",
        { class: "card launch" },
        h("h3", {}, "Launch"),
        h("div", { class: "total" }, sel.length ? `${sel.length} file${sel.length > 1 ? "s" : ""}` : `All ${S.files.length}`),
        h(
          "div",
          { class: "muted" },
          `≈ ${dur(sel.length ? est : S.files.reduce((a, f) => a + (f.medianS ?? 20) + 8, 0))} on the M1${S.where === "here" ? " (faster here)" : ""}`,
        ),
        h(
          "div",
          { class: "opt" },
          h("label", { class: "l" }, "Where"),
          h(
            "div",
            { class: "seg" },
            ...(["here", "mini"] as const).map((w) =>
              h(
                "button",
                {
                  class: S.where === w ? "on" : "",
                  onclick: () => {
                    S.where = w;
                    paint(false);
                  },
                },
                w === "here" ? "This Mac · headless" : "kerr-mini · full screen",
              ),
            ),
          ),
          h("div", { class: "faint", style: { fontSize: "12px" } }, macLine(S.where === "here" ? S.lab.here : S.lab.mini)),
        ),
        h(
          "div",
          { class: "opt" },
          h("label", { class: "l" }, "Options"),
          chk("One process per file (--each): a timed table at the end", S.each, (v) => (S.each = v)),
          S.where === "mini"
            ? chk("Headless on the mini (only if asked: full screen is the lab's choice)", S.headless, (v) => (S.headless = v))
            : null,
          chk("Re-record goldens (UPDATE=1)", S.update, (v) => (S.update = v)),
          S.where === "mini"
            ? h(
                "label",
                { class: "check" },
                "Keep each Chrome open",
                h("input", {
                  class: "input",
                  type: "number",
                  min: 0,
                  max: 600,
                  value: S.hold,
                  style: { width: "70px" },
                  onchange: (e: Event) => (S.hold = Number((e.target as HTMLInputElement).value)),
                }),
                "s",
              )
            : null,
          h("input", {
            class: "input",
            placeholder: "Only tests named… (bun test -t)",
            value: S.testName,
            onchange: (e: Event) => (S.testName = (e.target as HTMLInputElement).value),
          }),
        ),
        h(
          "div",
          { style: { marginTop: "18px" } },
          h(
            "button",
            { class: "btn primary", style: { width: "100%", justifyContent: "center", padding: "11px" }, onclick: launch },
            `▶ Launch on ${S.where === "here" ? "this Mac" : "kerr-mini"}`,
          ),
        ),
        h(
          "div",
          { class: "faint", style: { fontSize: "12px", marginTop: "10px" } },
          "Runs on one Mac queue for its Chrome. Run on both Macs at once to go twice as fast.",
        ),
      ),
    ),
  );
}
const macLine = (m: Mac | null) =>
  !m
    ? "…"
    : !m.ok
      ? `⚠ ${m.error}`
      : m.lock
        ? `busy — ${m.lock.label} (${dur((Date.now() - m.lock.since) / 1000)}); a new run waits its turn`
        : `idle · Chrome ${m.chrome}`;
const chk = (label: string, on: boolean, set: (v: boolean) => void) =>
  h(
    "label",
    { class: "check" },
    h("input", {
      type: "checkbox",
      checked: on,
      onchange: (e: Event) => {
        set((e.target as HTMLInputElement).checked);
        paint(false);
      },
    }),
    label,
  );

// ------------------------------------------------------------------------------------------- live runs

function logLineEl(line: string, q = "") {
  const cls = /^\(pass\)/.test(line)
    ? "p"
    : /^\(fail\)|error:|✗/.test(line)
      ? "f"
      : /^\(skip\)|chrome-lock: waiting|WARNING/.test(line)
        ? "s"
        : /^tests\/.*:$|^bun test/.test(line)
          ? "h"
          : /^remote:|^e2e:/.test(line)
            ? "r"
            : "";
  const el = h("div", { class: cls });
  if (q && line.toLowerCase().includes(q)) {
    const i = line.toLowerCase().indexOf(q);
    el.append(line.slice(0, i), h("mark", {}, line.slice(i, i + q.length)), line.slice(i + q.length));
  } else el.textContent = line || " ";
  return el;
}
function appendLogLine(id: string, line: string) {
  const box = document.querySelector<HTMLElement>(`[data-log="${CSS.escape(id)}"]`);
  if (!box) return;
  const follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  box.append(logLineEl(line));
  if (follow) box.scrollTop = box.scrollHeight;
}

function liveFiles(l: LiveRun) {
  return [...l.files.values()].map((f) => {
    const fail = f.tests.filter((t) => t.status === "fail").length;
    const cur = l.current === f.file && l.run.state === "running";
    return h(
      "div",
      { class: `tf ${cur ? "cur" : fail ? "bad" : f.tests.length ? "ok" : ""}` },
      h(
        "div",
        { class: "fn" },
        cur ? h("span", { class: "spinner" }) : h("span", { class: fail ? "bad-t" : "ok-t" }, fail ? "✗" : "✓"),
        f.file.replace(/^tests\/e2e\//, ""),
      ),
      f.tests.map((t) =>
        h(
          "div",
          { class: "tl" },
          h(
            "span",
            { class: `ic ${t.status === "pass" ? "ok-t" : t.status === "fail" ? "bad-t" : "warn-t"}` },
            t.status === "pass" ? "✓" : t.status === "fail" ? "✗" : "○",
          ),
          h("span", {}, t.name),
          h("span", { class: "ms" }, t.ms !== undefined ? dur(t.ms / 1000) : ""),
        ),
      ),
    );
  });
}

function livePage() {
  const id = arg();
  const runs = [...S.live.values()].sort((a, b) => b.run.started - a.run.started);
  const cur = (id && S.live.get(id)) || runs.find((l) => l.run.state === "running") || runs[0];
  if (!cur)
    return h(
      "div",
      { class: "page" },
      h("div", { class: "head" }, h("h1", {}, "Live")),
      h("div", { class: "card empty" }, "Nothing is running. ", h("a", { href: "#run" }, "Start a run →")),
    );
  const r = cur.run;
  const total =
    r.request && (r.request as { files: string[] }).files.length ? (r.request as { files: string[] }).files.length : S.files?.length;
  const filesDone = [...cur.files.values()].length - (r.state === "running" ? 1 : 0);
  const pct = total ? Math.min(100, (100 * Math.max(0, filesDone)) / total) : r.state === "running" ? 30 : 100;
  return h(
    "div",
    { class: "page wide" },
    h(
      "div",
      { class: "head" },
      h("div", {}, h("h1", {}, r.title), h("div", { class: "sub mono" }, r.cmd)),
      h("span", { class: "grow" }),
      vBadge(r),
      h("span", { class: "badge" }, r.where),
      r.remoteJob ? h("span", { class: "badge", title: "the remote runner's job" }, r.remoteJob) : null,
      r.state === "running"
        ? h(
            "button",
            { class: "btn danger", onclick: () => api(`/api/runs/${r.id}/cancel`, {}).then(() => toast("Cancelling…")) },
            "■ Cancel",
          )
        : h("a", { class: "btn", href: `#history/${r.id}` }, "Open in history →"),
    ),
    h(
      "div",
      { class: "grid g4", style: { marginBottom: "14px" } },
      kpi(`${r.counts.pass}`, "passed", "ok"),
      kpi(`${r.counts.fail}`, "failed", r.counts.fail ? "bad" : ""),
      kpi(`${Math.max(0, filesDone)}${total ? ` / ${total}` : ""}`, "files done"),
      kpi(dur(runDur(r)), r.state === "running" ? "elapsed" : "took"),
    ),
    h("div", { class: `prog ${r.counts.fail ? "bad" : ""}`, style: { marginBottom: "16px" } }, h("i", { style: { width: `${pct}%` } })),
    h(
      "div",
      { class: "live-wrap" },
      h(
        "div",
        { class: "card left", "data-keep": "lf" },
        runs.length > 1
          ? h(
              "div",
              { class: "row", style: { marginBottom: "8px" } },
              runs.map((l) =>
                h(
                  "a",
                  { class: `badge ${l === cur ? "acc" : ""}`, href: `#live/${l.run.id}` },
                  h("span", { class: `dot ${verdict(l.run)}` }),
                  l.run.where,
                  " · ",
                  l.run.title.slice(0, 24),
                ),
              ),
            )
          : null,
        cur.files.size
          ? liveFiles(cur)
          : h("div", { class: "muted" }, h("span", { class: "spinner" }), " starting… (the Chrome lock, the server, the first scene)"),
      ),
      h(
        "div",
        { class: "log", "data-keep": "log", "data-follow": "1", "data-log": r.id, style: { height: "100%" } },
        cur.lines.map((l) => logLineEl(l)),
      ),
    ),
  );
}

// ------------------------------------------------------------------------------------------- history

const histFilter = { q: "", where: "", status: "", source: "" };
let detailCache: { id: string; d: Detail } | null = null;
interface Detail {
  run: Run;
  log: string;
  parsed: LogSummary | null;
  summary: {
    rows?: { file: string; code: number; pass: number; fail: number; skip: number; seconds: number; failures: string[] }[];
  } | null;
  shots: Shot[];
}

function historyPage() {
  const id = arg();
  if (id) return runDetailPage(id);
  if (!S.history) {
    load.history().then(schedule);
    return h("div", { class: "page" }, h("div", { class: "empty" }, h("span", { class: "spinner" }), " Loading the history…"));
  }
  const f = histFilter;
  const list = S.history.filter(
    (r) =>
      (!f.q || `${r.title} ${r.cmd} ${r.id}`.toLowerCase().includes(f.q.toLowerCase())) &&
      (!f.where || (f.where === "here" ? r.where !== "kerr-mini" : r.where === "kerr-mini")) &&
      (!f.status || verdict(r) === f.status) &&
      (!f.source || r.source === f.source),
  );
  const sel = (k: keyof typeof f, opts: [string, string][]) =>
    h(
      "select",
      {
        class: "input",
        onchange: (e: Event) => {
          f[k] = (e.target as HTMLSelectElement).value;
          paint(false);
        },
      },
      opts.map(([v, l]) => h("option", { value: v, selected: f[k] === v }, l)),
    );
  return h(
    "div",
    { class: "page" },
    h(
      "div",
      { class: "head" },
      h(
        "div",
        {},
        h("h1", {}, "History"),
        h(
          "div",
          { class: "sub" },
          `${S.history.length} runs — the dashboard's, the remote runner's jobs, the --each summaries, the flight-lab campaigns`,
        ),
      ),
      h("span", { class: "grow" }),
      h("input", {
        class: "input",
        placeholder: "Search…",
        value: f.q,
        id: "hq",
        oninput: (e: Event) => {
          f.q = (e.target as HTMLInputElement).value;
          paint(false);
          const i = $("#hq") as HTMLInputElement;
          i.focus();
          i.setSelectionRange(i.value.length, i.value.length);
        },
      }),
      sel("where", [
        ["", "Both Macs"],
        ["here", "This Mac"],
        ["mini", "kerr-mini"],
      ]),
      sel("status", [
        ["", "Any result"],
        ["ok", "Passed"],
        ["bad", "Failed"],
        ["run", "Running"],
      ]),
      sel("source", [
        ["", "Any source"],
        ["dash", "Dashboard"],
        ["remote", "Remote jobs"],
        ["summary", "--each summaries"],
        ["flightlab", "Flight lab"],
      ]),
    ),
    h("div", { class: "card", style: { padding: "4px 8px" } }, runTable(list)),
  );
}

function runDetailPage(id: string) {
  if (id.startsWith("flight:")) {
    const r = S.history?.find((x) => x.id === id);
    return h(
      "div",
      { class: "page" },
      h("div", { class: "head" }, h("a", { href: "#history", class: "btn ghost" }, "←"), h("h1", {}, r?.title ?? id)),
      r?.report
        ? h("iframe", {
            src: r.report,
            style: { width: "100%", height: "80vh", border: "1px solid var(--line)", borderRadius: "10px", background: "#fff" },
          })
        : h("div", { class: "card empty" }, "No report.html in this campaign."),
      shotsGrid((S.shots ?? []).filter((s) => `flight:${s.run}` === id && s.root === "flight-results")),
    );
  }
  if (!detailCache || detailCache.id !== id || S.live.get(id)?.run.state === "running") {
    api<Detail>(`/api/runs/${encodeURIComponent(id)}`)
      .then((d) => {
        const changed =
          !detailCache || detailCache.id !== id || detailCache.d.log.length !== d.log.length || detailCache.d.run.state !== d.run.state;
        detailCache = { id, d };
        if (changed) schedule();
      })
      .catch((e) => toast(String(e), "bad"));
    if (!detailCache || detailCache.id !== id)
      return h("div", { class: "page" }, h("div", { class: "empty" }, h("span", { class: "spinner" }), " Loading the run…"));
  }
  const d = detailCache.d;
  const r = d.run;
  const files: FileResult[] = d.parsed?.files ?? [];
  const failures = files.flatMap((f) => f.tests.filter((t) => t.status === "fail").map((t) => ({ f, t })));
  const rows = d.summary?.rows;
  return h(
    "div",
    { class: "page" },
    h(
      "div",
      { class: "head" },
      h("a", { href: "#history", class: "btn ghost" }, "←"),
      h("div", {}, h("h1", {}, r.title), h("div", { class: "sub mono" }, r.cmd)),
      h("span", { class: "grow" }),
      vBadge(r),
      h("span", { class: "badge" }, r.where),
      h("span", { class: "badge" }, r.source),
      r.request
        ? h(
            "button",
            {
              class: "btn",
              onclick: async () => {
                const nr = await api<Run>("/api/runs", r.request);
                liveOf(nr);
                location.hash = `live/${nr.id}`;
              },
            },
            "↻ Run again",
          )
        : null,
      failures.length && r.request
        ? h(
            "button",
            {
              class: "btn",
              onclick: async () => {
                const req = { ...(r.request as object), files: [...new Set(failures.map((x) => x.f.file.replace(/^.*\//, "")))] };
                const nr = await api<Run>("/api/runs", req);
                liveOf(nr);
                location.hash = `live/${nr.id}`;
              },
            },
            "↻ Rerun the failed files",
          )
        : null,
      r.hasLog
        ? h(
            "a",
            {
              class: "btn",
              href: r.source === "dash" ? `/files/remote-results/dash/${r.id}/log` : `/files/remote-results/${r.id}/log`,
              target: "_blank",
            },
            "Raw log",
          )
        : null,
    ),
    h(
      "div",
      { class: "grid g4", style: { marginBottom: "16px" } },
      kpi(String(r.counts.pass), "passed", "ok"),
      kpi(String(r.counts.fail), "failed", r.counts.fail ? "bad" : ""),
      kpi(String(r.counts.skip), "skipped"),
      kpi(dur(runDur(r)), `${when(r.started)}${r.exit !== undefined && r.exit !== null ? ` · exit ${r.exit}` : ""}`),
    ),
    failures.length
      ? h(
          "div",
          { class: "card", style: { marginBottom: "16px", borderColor: "var(--bad)" } },
          h("h3", {}, h("span", { class: "bad-t" }, "✗"), `Failures (${failures.length})`),
          failures.map(({ f, t }) =>
            h(
              "div",
              {},
              h("div", { class: "row" }, h("b", { class: "mono" }, f.file.replace(/^tests\/e2e\//, "")), h("span", {}, t.name)),
              t.error ? h("div", { class: "err" }, t.error) : null,
            ),
          ),
        )
      : null,
    rows
      ? h(
          "div",
          { class: "card", style: { marginBottom: "16px" } },
          h("h3", {}, "Files (--each, wall time)"),
          h(
            "table",
            { class: "t" },
            h(
              "thead",
              {},
              h(
                "tr",
                {},
                h("th", {}, ""),
                h("th", {}, "File"),
                h("th", { class: "num" }, "✓"),
                h("th", { class: "num" }, "✗"),
                h("th", { class: "num" }, "skip"),
                h("th", { class: "num" }, "Time"),
              ),
            ),
            h(
              "tbody",
              {},
              rows.map((x) =>
                h(
                  "tr",
                  {},
                  h("td", {}, h("span", { class: `dot ${x.code ? "bad" : "ok"}` })),
                  h("td", { class: "mono" }, x.file),
                  h("td", { class: "num ok-t" }, x.pass),
                  h("td", { class: "num bad-t" }, x.fail || ""),
                  h("td", { class: "num faint" }, x.skip || ""),
                  h("td", { class: "num muted" }, dur(x.seconds)),
                ),
              ),
            ),
          ),
        )
      : null,
    files.length
      ? h(
          "div",
          { class: "card", style: { marginBottom: "16px" } },
          h("h3", {}, `Tests (${files.reduce((a, f) => a + f.tests.length, 0)} in ${files.length} files)`),
          files.map((f) =>
            h(
              "details",
              { open: f.fail > 0 },
              h(
                "summary",
                { style: { cursor: "pointer", padding: "4px 0" } },
                h("span", { class: f.fail ? "bad-t" : "ok-t" }, f.fail ? "✗ " : "✓ "),
                h("b", { class: "mono" }, f.file.replace(/^tests\/e2e\//, "")),
                h(
                  "span",
                  { class: "faint" },
                  `  ${f.pass} ✓ ${f.fail ? `${f.fail} ✗ ` : ""}${f.skip ? `${f.skip} skip ` : ""}· ${dur(f.ms / 1000)}`,
                ),
              ),
              h(
                "div",
                { style: { paddingLeft: "18px" } },
                f.tests.map((t) =>
                  h(
                    "div",
                    { class: "tl" },
                    h(
                      "span",
                      { class: `ic ${t.status === "pass" ? "ok-t" : t.status === "fail" ? "bad-t" : "warn-t"}` },
                      t.status === "pass" ? "✓" : t.status === "fail" ? "✗" : "○",
                    ),
                    h("span", {}, t.name),
                    h("span", { class: "ms" }, t.ms !== undefined ? dur(t.ms / 1000) : ""),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,
    d.shots.length
      ? h("div", { class: "card", style: { marginBottom: "16px" } }, h("h3", {}, `Pictures (${d.shots.length})`), shotsGrid(d.shots))
      : null,
    d.log ? logViewer(d.log, r.id) : null,
  );
}

let logQ = "";
let logOnlyFail = false;
function logViewer(text: string, key: string) {
  const lines = text.split("\n");
  const q = logQ.toLowerCase();
  const shown = lines.filter((l) => (!q || l.toLowerCase().includes(q)) && (!logOnlyFail || /\(fail\)|error|✗|Error/.test(l)));
  return h(
    "div",
    { class: "card" },
    h(
      "div",
      { class: "log-tools" },
      h("h3", { style: { margin: 0 } }, "Log"),
      h("span", { class: "faint" }, `${shown.length} / ${lines.length} lines`),
      h("span", { class: "grow" }),
      h("input", {
        class: "input",
        placeholder: "Find in the log…",
        value: logQ,
        id: "logq",
        onchange: (e: Event) => {
          logQ = (e.target as HTMLInputElement).value;
          paint(false);
        },
      }),
      chk("Errors only", logOnlyFail, (v) => (logOnlyFail = v)),
    ),
    h(
      "div",
      { class: "log", "data-keep": `log-${key}`, style: { maxHeight: "70vh" } },
      shown.slice(-6000).map((l) => logLineEl(l, q)),
    ),
  );
}

// ------------------------------------------------------------------------------------------- captures

let shotQ = "";
let lightbox: { list: Shot[]; i: number } | null = null;
function shotsGrid(list: Shot[]) {
  if (!list.length) return h("div", { class: "empty" }, "No pictures.");
  return h(
    "div",
    { class: "shots" },
    list
      .slice(0, 400)
      .map((s, i) =>
        h(
          "div",
          { class: "shot", onclick: () => openLightbox(list, i), title: s.path },
          h("img", { src: s.url, loading: "lazy", alt: s.name }),
          h("div", { class: "cap" }, h("b", {}, s.name), h("br"), `${s.run} · ${ago(s.mtime)}`),
        ),
      ),
  );
}
function openLightbox(list: Shot[], i: number) {
  lightbox = { list, i };
  paintLightbox();
}
function paintLightbox() {
  document.querySelector(".lightbox")?.remove();
  if (!lightbox) return;
  const s = lightbox.list[lightbox.i]!;
  const close = () => {
    lightbox = null;
    paintLightbox();
  };
  const step = (k: number) => {
    lightbox!.i = (lightbox!.i + k + lightbox!.list.length) % lightbox!.list.length;
    paintLightbox();
  };
  document.body.append(
    h(
      "div",
      { class: "lightbox", onclick: (e: Event) => e.target === e.currentTarget && close() },
      h("button", { class: "nav-l", onclick: () => step(-1) }, "‹"),
      h("img", { src: s.url, alt: s.name }),
      h("button", { class: "nav-r", onclick: () => step(1) }, "›"),
      h(
        "div",
        { class: "bar" },
        h("b", {}, s.name),
        h(
          "span",
          { class: "faint" },
          `${s.path} · ${when(s.mtime)} · ${Math.round(s.size / 1024)} KB · ${lightbox.i + 1}/${lightbox.list.length}`,
        ),
        h("a", { class: "btn sm", href: s.url, target: "_blank" }, "Open"),
        h("button", { class: "btn sm", onclick: close }, "Close  Esc"),
      ),
    ),
  );
}
function capturesPage() {
  if (!S.shots) {
    load.shots().then(schedule);
    return h("div", { class: "page" }, h("div", { class: "empty" }, h("span", { class: "spinner" }), " Loading the pictures…"));
  }
  const q = shotQ.toLowerCase();
  const list = S.shots.filter((s) => !q || s.path.toLowerCase().includes(q));
  const runs = [...new Set(list.map((s) => s.run))];
  return h(
    "div",
    { class: "page wide" },
    h(
      "div",
      { class: "head" },
      h(
        "div",
        {},
        h("h1", {}, "Captures"),
        h(
          "div",
          { class: "sub" },
          `${S.shots.length} pictures from every run (remote-results/, flight-results/, the live page's) — ${runs.length} runs shown`,
        ),
      ),
      h("span", { class: "grow" }),
      h("input", {
        class: "input",
        placeholder: "Filter by run, name, path…",
        value: shotQ,
        id: "sq",
        style: { width: "320px" },
        oninput: (e: Event) => {
          shotQ = (e.target as HTMLInputElement).value;
          paint(false);
          const i = $("#sq") as HTMLInputElement;
          i.focus();
          i.setSelectionRange(i.value.length, i.value.length);
        },
      }),
    ),
    runs.slice(0, 60).map((run) => {
      const ss = list.filter((s) => s.run === run);
      return h(
        "div",
        { style: { marginBottom: "22px" } },
        h(
          "div",
          { class: "row", style: { marginBottom: "8px" } },
          h("b", { class: "mono" }, run),
          h("span", { class: "faint" }, `${ss.length} · ${ago(ss[0]!.mtime)}`),
        ),
        shotsGrid(ss),
      );
    }),
  );
}

// ------------------------------------------------------------------------------------------- live page (__bh)

const SNIPPETS: [string, string][] = [
  ["status", "__bh.game.status()"],
  ["phase", "__bh.phase()"],
  ["freeze + 1 s", "__bh.freeze(true); for (let i = 0; i < 30; i++) __bh.step(1/30); __bh.game.status()"],
  ["unfreeze", "__bh.freeze(false)"],
  ["orbit 400 km", '__bh.game.orbit("earth", { altKm: 400, inc: 51.6 })'],
  ["glide Edwards", '__bh.game.glideTo("Edwards")'],
  ["pilot", "({ auto: __bh.camera.pilot.auto, hold: __bh.camera.pilot.hold, throttle: __bh.camera.pilot.throttle })"],
  ["geodetic", "__bh.sys.geodetic()"],
  ["scenes", "__bh.scenes()"],
  ["GPU", "({ generation: __bh.gpu.generation(), lost: __bh.gpu.lost(), frames: __bh.gpu.frames() })"],
  ["errors", "__bh.game.errors"],
  ["help", "__bh.game.help()"],
];

function probePage() {
  if (!S.bh) load.bh();
  const screen = h(
    "div",
    { class: "screen", id: "screen", tabindex: 0 },
    h("img", { id: "screen-img", src: S.frame ? `data:image/jpeg;base64,${S.frame}` : "", style: { display: S.frame ? "block" : "none" } }),
    !S.frame ? h("div", { class: "ov", id: "screen-ov" }, probeOverlay()) : null,
    h(
      "div",
      { class: "hud" },
      h("span", { class: "badge", id: "fps" }, `${S.fps} fps`),
      h("span", { class: "badge", id: "keys-badge" }, "click the picture to send keys"),
    ),
  );
  wireScreen(screen);
  const ta = h("textarea", {
    class: "input",
    id: "repl-in",
    placeholder: "__bh.game.status()   ⏎ run · ⇧⏎ new line · ↑↓ history · Tab complete",
    spellcheck: false,
  }) as HTMLTextAreaElement;
  wireRepl(ta);
  const page = h(
    "div",
    { class: "page wide probe-page" },
    h(
      "div",
      { class: "head" },
      h(
        "div",
        {},
        h("h1", {}, "Live page · __bh"),
        h(
          "div",
          { class: "sub" },
          "The app in this Mac's test Chrome (headless, the lock taken like any e2e): its picture streamed, real keys and clicks, page code on __bh",
        ),
      ),
      h("span", { class: "grow" }),
      h("div", { id: "probe-bar", class: "row" }),
    ),
    h(
      "div",
      { class: "probe" },
      screen,
      h(
        "div",
        { class: "repl" },
        h(
          "div",
          { class: "snips" },
          SNIPPETS.map(([l, code]) => h("button", { class: "btn sm", title: code, onclick: () => runExpr(code) }, l)),
        ),
        h("div", { class: "out", id: "repl-out", "data-keep": "repl" }),
        h("div", { style: { position: "relative" } }, ta, h("div", { id: "acs" })),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn primary sm", onclick: () => runExpr(ta.value) }, "Run ⏎"),
          h("button", { class: "btn sm", onclick: () => ((S.repl = []), paintRepl()) }, "Clear"),
          h("span", { class: "grow" }),
          h("a", { class: "muted", href: "#api" }, "__bh reference →"),
        ),
        h(
          "details",
          {},
          h(
            "summary",
            { class: "muted", style: { cursor: "pointer" } },
            "Page console ",
            h("span", { class: "faint", id: "pc-count" }, `(${S.pconsole.length})`),
          ),
          h("div", { class: "log", id: "pconsole", style: { maxHeight: "180px", marginTop: "6px" } }),
        ),
      ),
    ),
  );
  queueMicrotask(() => {
    paintProbeBar();
    paintRepl();
    paintPconsole();
  });
  return page;
}

function probeOverlay() {
  const p = S.probe;
  if (p.state === "starting")
    return [h("span", { class: "spinner" }), h("div", {}, `Booting ${p.scene} — waits for this Mac's Chrome if a run holds it…`)];
  if (p.state === "on") return [h("span", { class: "spinner" }), h("div", {}, "Waiting for the first frame…")];
  return [
    h("div", { style: { fontSize: "40px" } }, "◈"),
    h("div", {}, "The live page is off."),
    p.error ? h("div", { class: "bad-t" }, p.error) : null,
    h("button", { class: "btn primary", onclick: () => startProbe() }, "▶ Start the live page"),
  ];
}

let scenes: string[] = [];
function paintProbeBar() {
  const bar = $("#probe-bar");
  if (!bar) return;
  const p = S.probe;
  const on = p.state === "on";
  const sceneSel = h(
    "select",
    {
      class: "input",
      disabled: !on,
      onchange: (e: Event) =>
        api("/api/probe/scene", { scene: (e.target as HTMLSelectElement).value }).catch((er) => toast(String(er), "bad")),
    },
    (scenes.length ? scenes : [p.scene ?? "game:artemis"]).map((s) => h("option", { value: s, selected: s === p.scene }, s)),
  );
  bar.replaceChildren(
    h(
      "span",
      { class: `badge ${on ? "ok" : p.state === "off" ? "" : "acc"}` },
      h("span", { class: `dot ${on ? "ok" : p.state === "off" ? "" : "run"}` }),
      p.state,
    ),
    sceneSel,
    on
      ? h(
          "button",
          {
            class: "btn",
            onclick: async () => {
              const r = await api<{ url: string }>("/api/probe/shot", {});
              toast("Screenshot kept", "ok");
              S.shots = null;
              openLightbox(
                [
                  {
                    url: r.url,
                    root: "remote-results",
                    run: "dash",
                    name: r.url.split("/").pop()!,
                    path: r.url.slice(7),
                    mtime: Date.now(),
                    size: 0,
                  },
                ],
                0,
              );
            },
          },
          "📷 Screenshot",
        )
      : null,
    p.state === "off"
      ? h("button", { class: "btn primary", onclick: () => startProbe() }, "▶ Start")
      : h("button", { class: "btn danger", disabled: p.state !== "on", onclick: () => api("/api/probe/stop", {}) }, "■ Stop"),
  );
  if (on && !scenes.length)
    api<{ ok: boolean; value: string[] }>("/api/probe/eval", { expr: "__bh.scenes()" }).then((r) => {
      if (r.ok) {
        scenes = r.value;
        paintProbeBar();
      }
    });
  const ov = $("#screen-ov");
  if (ov) ov.replaceChildren(...(probeOverlay().filter(Boolean) as Node[]));
  else if (!S.frame && $("#screen")) $("#screen")!.append(h("div", { class: "ov", id: "screen-ov" }, probeOverlay()));
  const img = $("#screen-img");
  if (img) img.style.display = S.frame ? "block" : "none";
}

async function startProbe() {
  try {
    const main = $("#screen");
    const w = Math.round(Math.min(1600, Math.max(960, (main?.clientWidth ?? 1280) * 1)));
    await api("/api/probe/start", { scene: S.probe.scene ?? "game:artemis", width: w, height: Math.round((w * 10) / 16) });
  } catch (e) {
    toast(String(e), "bad");
  }
}

// (the picture's coordinates → the page's CSS px)
function pagePoint(img: HTMLImageElement, e: MouseEvent) {
  const b = img.getBoundingClientRect();
  return {
    x: Math.round(((e.clientX - b.left) / b.width) * S.probe.width),
    y: Math.round(((e.clientY - b.top) / b.height) * S.probe.height),
  };
}
function wireScreen(screen: HTMLElement) {
  const img = screen.querySelector("img") as HTMLImageElement;
  const send = (i: Record<string, unknown>) => api("/api/probe/input", i).catch((e) => toast(String(e), "bad"));
  img.addEventListener("click", (e) => {
    screen.focus();
    send({ kind: "click", ...pagePoint(img, e) });
  });
  img.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    send({ kind: "click", button: "right", ...pagePoint(img, e) });
  });
  img.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      send({ kind: "wheel", deltaY: e.deltaY, ...pagePoint(img, e) });
    },
    { passive: false },
  );
  screen.addEventListener("focus", () => {
    screen.classList.add("keys");
    const b = $("#keys-badge");
    if (b) b.textContent = "keys go to the page — Esc twice to leave";
  });
  screen.addEventListener("blur", () => {
    screen.classList.remove("keys");
    const b = $("#keys-badge");
    if (b) b.textContent = "click the picture to send keys";
  });
  let lastEsc = 0;
  screen.addEventListener("keydown", (e) => {
    if (S.probe.state !== "on") return;
    e.preventDefault();
    if (e.code === "Escape") {
      if (Date.now() - lastEsc < 600) return screen.blur();
      lastEsc = Date.now();
    }
    send({ kind: "key", code: e.code, shift: e.shiftKey });
  });
}

let histI = -1;
function wireRepl(ta: HTMLTextAreaElement) {
  let acIdx = 0;
  let acList: BhEntry[] = [];
  const acBox = () => $("#acs");
  const closeAc = () => {
    acList = [];
    acBox()?.replaceChildren();
  };
  const word = () => {
    const before = ta.value.slice(0, ta.selectionStart);
    return before.match(/__bh[\w.$]*$/)?.[0] ?? null;
  };
  const showAc = () => {
    const w = word();
    if (!w || !S.bh) return closeAc();
    acList = S.bh.filter((e) => e.path.startsWith(w) && e.path !== w).slice(0, 12);
    acIdx = 0;
    const box = acBox();
    if (!box) return;
    box.replaceChildren(
      acList.length
        ? h(
            "div",
            { class: "acs", style: { bottom: "100%", left: 0 } },
            acList.map((e, i) =>
              h(
                "div",
                { class: i === acIdx ? "on" : "", onmousedown: (ev: Event) => (ev.preventDefault(), pick(e)) },
                e.path,
                h("span", {}, e.section.replace(/ —.*$/, "")),
              ),
            ),
          )
        : null,
    );
  };
  const pick = (e: BhEntry) => {
    const w = word() ?? "";
    const s = ta.selectionStart;
    ta.value = ta.value.slice(0, s - w.length) + e.path + ta.value.slice(s);
    ta.selectionStart = ta.selectionEnd = s - w.length + e.path.length;
    closeAc();
    ta.focus();
  };
  ta.addEventListener("input", showAc);
  ta.addEventListener("blur", () => setTimeout(closeAc, 100));
  ta.addEventListener("keydown", (e) => {
    if (acList.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      acIdx = (acIdx + (e.key === "ArrowDown" ? 1 : -1) + acList.length) % acList.length;
      acBox()
        ?.querySelectorAll(".acs div")
        .forEach((d, i) => d.classList.toggle("on", i === acIdx));
      return;
    }
    if (acList.length && (e.key === "Tab" || e.key === "Enter")) {
      e.preventDefault();
      pick(acList[acIdx]!);
      return;
    }
    if (e.key === "Escape") return closeAc();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runExpr(ta.value);
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !ta.value.includes("\n")) {
      if (!S.replHist.length) return;
      e.preventDefault();
      histI = e.key === "ArrowUp" ? Math.min(S.replHist.length - 1, histI + 1) : Math.max(-1, histI - 1);
      ta.value = histI < 0 ? "" : S.replHist[histI]!;
    }
  });
}

async function runExpr(expr: string) {
  expr = expr.trim();
  if (!expr) return;
  if (S.probe.state !== "on") {
    toast("Start the live page first", "bad");
    return;
  }
  S.replHist = [expr, ...S.replHist.filter((x) => x !== expr)].slice(0, 100);
  localStorageSet("dash.replHist", JSON.stringify(S.replHist));
  histI = -1;
  const ta = $("#repl-in") as HTMLTextAreaElement | null;
  if (ta) ta.value = "";
  const entry = { q: expr, ok: true, v: "…" } as (typeof S.repl)[number];
  S.repl.push(entry);
  paintRepl();
  try {
    const r = await api<{ ok: boolean; value?: unknown; error?: string; ms: number; kind?: string }>("/api/probe/eval", { expr });
    entry.ok = r.ok;
    entry.v = r.ok ? (r.value === undefined ? "undefined" : JSON.stringify(r.value)) : (r.error ?? "error");
    entry.ms = r.ms;
    entry.kind = r.kind;
  } catch (e) {
    entry.ok = false;
    entry.v = String((e as Error).message);
  }
  paintRepl();
}

function paintRepl() {
  const out = $("#repl-out");
  if (!out) return;
  out.replaceChildren(
    ...(S.repl.length
      ? S.repl.map((e) =>
          h(
            "div",
            { class: "entry" },
            h("div", { class: "q", title: "click to edit", onclick: () => (($("#repl-in") as HTMLTextAreaElement).value = e.q) }, e.q),
            h(
              "div",
              { class: `a ${e.ok ? (e.kind === "description" ? "c" : "") : "e"}` },
              e.v === "…" ? h("span", { class: "spinner" }) : e.ok ? jsonView(safeParse(e.v)) : e.v,
            ),
            e.ms !== undefined ? h("div", { class: "meta" }, `${e.ms} ms${e.kind ? ` · ${e.kind}` : ""}`) : null,
          ),
        )
      : [
          h(
            "div",
            { class: "faint" },
            "Results show here. Statements work (let, for, await); the last expression's value comes back as JSON.",
          ),
        ]),
  );
  out.scrollTop = out.scrollHeight;
}
const safeParse = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
function paintPconsole() {
  const box = $("#pconsole");
  if (!box) return;
  box.replaceChildren(
    ...S.pconsole
      .slice(-200)
      .map((c) =>
        h(
          "div",
          { class: c.level === "error" ? "f" : c.level === "warning" ? "s" : "" },
          `${new Date(c.at).toLocaleTimeString()} ${c.level}  ${c.text}`,
        ),
      ),
  );
  box.scrollTop = box.scrollHeight;
  const n = $("#pc-count");
  if (n) n.textContent = `(${S.pconsole.length})`;
}

// ------------------------------------------------------------------------------------------- __bh reference

let apiQ = "";
function apiPage() {
  if (!S.bh) {
    load.bh().then(schedule);
    return h("div", { class: "page" }, h("div", { class: "empty" }, h("span", { class: "spinner" }), " Loading the reference…"));
  }
  const focus = arg();
  const q = apiQ.toLowerCase();
  const list = S.bh.filter((e) => !q || `${e.path} ${e.heading} ${e.body}`.toLowerCase().includes(q));
  const sections = [...new Set(S.bh.map((e) => e.section))];
  const page = h(
    "div",
    { class: "page wide" },
    h(
      "div",
      { class: "head" },
      h(
        "div",
        {},
        h("h1", {}, "__bh API"),
        h(
          "div",
          { class: "sub" },
          `${S.bh.length} entries from docs/BH-API.md — every member of the page's automation handle. Try one on the live page.`,
        ),
      ),
      h("span", { class: "grow" }),
      h("input", {
        class: "input",
        placeholder: "Search paths and text…  (/)",
        value: apiQ,
        id: "aq",
        style: { width: "360px" },
        oninput: (e: Event) => {
          apiQ = (e.target as HTMLInputElement).value;
          paint(false);
          const i = $("#aq") as HTMLInputElement;
          i.focus();
          i.setSelectionRange(i.value.length, i.value.length);
        },
      }),
      h("a", { class: "btn", href: "#doc/BH-API.md" }, "Full page"),
    ),
    h(
      "div",
      { class: "docs" },
      h(
        "nav",
        { class: "toc card", style: { padding: "10px 4px" } },
        sections.map((s) => [
          h(
            "a",
            {
              href: `#api/${encodeURIComponent(S.bh!.find((e) => e.section === s)!.path)}`,
              style: { fontWeight: 600, color: "var(--text)" },
            },
            s.replace(/`/g, ""),
          ),
          ...list
            .filter((e) => e.section === s)
            .map((e) =>
              h(
                "a",
                { class: `l3 ${e.path === focus ? "on" : ""}`, href: `#api/${encodeURIComponent(e.path)}` },
                e.path.replace(/^__bh\./, ""),
              ),
            ),
        ]),
      ),
      h(
        "div",
        {},
        list.map((e) => {
          const code = e.body.match(/```(?:js|ts|javascript)?\n([\s\S]*?)```/)?.[1]?.trim();
          return h(
            "div",
            { class: `api-entry ${e.path === focus ? "hit" : ""}`, id: `e-${slug(e.path)}` },
            h("div", { class: "md", html: renderMarkdown(`### ${e.heading}\n${e.body}`) }),
            h(
              "div",
              { class: "acts" },
              code
                ? h(
                    "button",
                    {
                      class: "btn sm",
                      onclick: () => {
                        location.hash = "page";
                        setTimeout(() => {
                          const ta = $("#repl-in") as HTMLTextAreaElement | null;
                          if (ta) {
                            ta.value = code;
                            ta.focus();
                          }
                        }, 50);
                      },
                    },
                    "Try the example ▸",
                  )
                : null,
              h(
                "button",
                {
                  class: "btn sm",
                  onclick: () => {
                    location.hash = "page";
                    setTimeout(() => {
                      const ta = $("#repl-in") as HTMLTextAreaElement | null;
                      if (ta) {
                        ta.value = e.path;
                        ta.focus();
                      }
                    }, 50);
                  },
                },
                "Inspect ▸",
              ),
              h(
                "button",
                { class: "btn sm ghost", onclick: () => navigator.clipboard.writeText(e.path).then(() => toast("Copied", "ok")) },
                "Copy path",
              ),
            ),
          );
        }),
        !list.length ? h("div", { class: "empty" }, "Nothing matches.") : null,
      ),
    ),
  );
  if (focus) queueMicrotask(() => document.getElementById(`e-${slug(focus)}`)?.scrollIntoView({ block: "start" }));
  return page;
}

// ------------------------------------------------------------------------------------------- docs

const DOC_LIST: [string, string][] = [
  ["E2E.md", "The e2e guide"],
  ["E2E-CATALOGUE.md", "The catalogue"],
  ["BH-API.md", "__bh reference"],
  ["REMOTE-TESTS.md", "Remote tests (FR)"],
  ["FLIGHTLAB.md", "Flight lab (FR)"],
  ["IPAD-TESTS.md", "The iPad"],
];
const docCache = new Map<string, string>();
function docPage() {
  const [name, anchor] = (arg() || "E2E.md").split("#");
  const md = docCache.get(name!);
  if (md === undefined) {
    fetch(`/api/docs/${name}`)
      .then((r) => (r.ok ? r.text() : `# Not found\n\n${name}`))
      .then((t) => {
        docCache.set(name!, t);
        schedule();
      });
    return h("div", { class: "page" }, h("div", { class: "empty" }, h("span", { class: "spinner" }), " Loading…"));
  }
  const html = renderMarkdown(md, { headingIds: true });
  const toc = [...md.matchAll(/^(##|###) (.*)$/gm)].filter((m) => !m[2]!.includes("`__bh") || m[1] === "##").slice(0, 120);
  const body = h("div", { class: "md", html });
  // (code blocks get a copy button; in-page anchors stay within the doc's route)
  for (const pre of body.querySelectorAll("pre"))
    pre.append(
      h(
        "button",
        {
          class: "btn sm copy",
          onclick: () => navigator.clipboard.writeText(pre.querySelector("code")?.textContent ?? "").then(() => toast("Copied", "ok")),
        },
        "Copy",
      ),
    );
  for (const a of body.querySelectorAll<HTMLAnchorElement>("a[href^='#']")) {
    const href = a.getAttribute("href")!;
    if (!href.startsWith("#doc/")) a.setAttribute("href", `#doc/${name}${href}`);
  }
  if (anchor) queueMicrotask(() => document.getElementById(anchor)?.scrollIntoView());
  return h(
    "div",
    { class: "page wide" },
    h(
      "div",
      { class: "head" },
      h(
        "div",
        { class: "seg" },
        DOC_LIST.map(([n, l]) => h("button", { class: n === name ? "on" : "", onclick: () => (location.hash = `doc/${n}`) }, l)),
      ),
    ),
    h(
      "div",
      { class: "docs" },
      h(
        "nav",
        { class: "toc" },
        toc.map((m) => h("a", { class: m[1] === "###" ? "l3" : "", href: `#doc/${name}#${slug(m[2]!)}` }, m[2]!.replace(/`/g, ""))),
      ),
      body,
    ),
  );
}

// ------------------------------------------------------------------------------------------- modal

function showModal(title: string, content: Node) {
  const close = () => box.remove();
  const box = h(
    "div",
    { class: "lightbox", onclick: (e: Event) => e.target === e.currentTarget && close() },
    h(
      "div",
      { class: "card", style: { maxWidth: "900px", width: "100%" } },
      h(
        "div",
        { class: "row", style: { marginBottom: "10px" } },
        h("b", {}, title),
        h("span", { class: "grow" }),
        h("button", { class: "btn sm", onclick: close }, "Close"),
      ),
      content,
    ),
  );
  document.body.append(box);
}

// ------------------------------------------------------------------------------------------- boot

const PAGES: Record<string, () => HTMLElement> = {
  overview,
  run: runPage,
  live: livePage,
  history: historyPage,
  captures: capturesPage,
  page: probePage,
  api: apiPage,
  doc: docPage,
};

document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.id === "screen";
  if (lightbox) {
    if (e.key === "Escape") {
      lightbox = null;
      paintLightbox();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      lightbox.i = (lightbox.i + (e.key === "ArrowRight" ? 1 : -1) + lightbox.list.length) % lightbox.list.length;
      paintLightbox();
    }
    return;
  }
  if (typing) return;
  if (e.key === "/") {
    const f = $("#filter") ?? $("#aq") ?? $("#hq") ?? $("#sq");
    if (f) {
      e.preventDefault();
      f.focus();
    }
  }
  const n = Number(e.key);
  if (n >= 1 && n <= VIEWS.length && !e.metaKey && !e.ctrlKey) location.hash = VIEWS[n - 1]![0];
});

$("#theme")!.addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === "light" ? "dark" : cur === "dark" ? "" : matchMedia("(prefers-color-scheme: light)").matches ? "dark" : "light";
  if (next) document.documentElement.dataset.theme = next;
  else delete document.documentElement.dataset.theme;
  localStorageSet("dash.theme", next);
});
const savedTheme = localStorageGet("dash.theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

api<{ host: string; commit: string; dirty: boolean; live: Run[] }>("/api/state").then((s) => {
  S.meta = s;
  schedule();
});
connect();
paint(true);
// (times like "3 min ago" and elapsed counters move on)
setInterval(() => {
  if (["overview", "live", "history"].includes(view()) && !document.querySelector("input:focus, select:focus")) schedule();
}, 5000);
