// The dashboard's reports: one recorded flight — an e2e test's (tests/e2e/lib/telemetry.ts) or a flight-lab
// scenario's (tests/flight/lib/lab.ts), the same folder either way — read whole and turned into what the
// report page draws: the charts by section (the flight lab's own builder, tests/flight/lib/charts.ts: the
// assistants' corridors, commanded against flown, the approach, the docking, the telemetry), the frame rate,
// the hub's cards as they changed, the quality measures, the events, the pictures. And around them: the
// flight lab's scenarios and campaigns, every test's past durations (the estimate).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { buildCharts, type Chart, type Pt, timeAxis } from "../../tests/flight/lib/charts";
import { quality } from "../../tests/flight/lib/quality";
import { SCENARIOS } from "../../tests/flight/scenarios/index";
import { FLIGHTS, RESULTS } from "./runs";

// biome-ignore lint/suspicious/noExplicitAny: the recorded samples, read loosely
type Row = Record<string, any>;

const jsonl = (f: string): Row[] => {
  if (!existsSync(f)) return [];
  const out: Row[] = [];
  for (const l of readFileSync(f, "utf8").split("\n"))
    if (l)
      try {
        out.push(JSON.parse(l));
      } catch {
        /* (a line cut by a crash) */
      }
  return out;
};
const json = (f: string) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};

/** A report's folder, only under the results' roots. */
export function safeDir(p: string): string | null {
  const d = normalize(decodeURIComponent(p)).replace(/\/+$/, "");
  if (d.includes("..") || !(d.startsWith(`${RESULTS}/`) || d.startsWith(`${FLIGHTS}/`))) return null;
  return existsSync(d) && statSync(d).isDirectory() ? d : null;
}

const fileUrl = (path: string) => `/files/${path.split("/").map(encodeURIComponent).join("/")}`;

// (a flight's samples, read once while its file does not change: the report, then each channel asked)
const telCache = new Map<string, { mtime: number; T: Row[] }>();
function samples(dir: string): Row[] {
  const f = join(dir, "telemetry.jsonl");
  if (!existsSync(f)) return [];
  const mtime = statSync(f).mtimeMs;
  const c = telCache.get(dir);
  if (c && c.mtime === mtime) return c.T;
  const T = jsonl(f);
  telCache.set(dir, { mtime, T });
  if (telCache.size > 12) telCache.delete(telCache.keys().next().value!);
  return T;
}

/** Every numeric figure of a sample, by its path (state.status.altKm, tel.air.mach, perf.gpuFrameMs…). */
function flatten(o: unknown, path: string, out: Map<string, number>, depth = 0) {
  if (depth > 6 || o === null || o === undefined) return;
  if (typeof o === "number") {
    if (Number.isFinite(o)) out.set(path, o);
  } else if (typeof o === "boolean") out.set(path, o ? 1 : 0);
  else if (Array.isArray(o)) {
    // (short vectors only — a position, a rate —: their components)
    if (o.length <= 4 && o.every((x) => typeof x === "number")) o.forEach((x, i) => flatten(x, `${path}[${i}]`, out, depth + 1));
  } else if (typeof o === "object") for (const [k, v] of Object.entries(o)) flatten(v, path ? `${path}.${k}` : k, out, depth + 1);
}
const SKIP = /^(t|tM|wall|why)$|^hub\.rows|^state\.alerts|^tel\.hub\.rows/;

// (a channel's group: TARS's readers by their own group — tel.air, state.status —, the machine's by theirs,
// the flight lab's own top-level figures together as the craft's)
const groupOf = (path: string) => {
  const p = path.split(".");
  if (p[0] === "state" || p[0] === "tel") return p.slice(0, 2).join(".");
  return p.length === 1 ? "craft" : p[0]!;
};

/** The channels: every path that took a number, with its count and range — the explorer's list. */
function channels(T: Row[]) {
  const acc = new Map<string, { n: number; min: number; max: number }>();
  for (const S of T) {
    const m = new Map<string, number>();
    flatten(S, "", m);
    for (const [k, v] of m) {
      if (SKIP.test(k)) continue;
      const a = acc.get(k) ?? { n: 0, min: Infinity, max: -Infinity };
      a.n++;
      if (v < a.min) a.min = v;
      if (v > a.max) a.max = v;
      acc.set(k, a);
    }
  }
  return [...acc]
    .filter(([, a]) => a.n > 1)
    .map(([path, a]) => ({
      path,
      group: groupOf(path),
      ...a,
      flat: a.min === a.max,
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.path.localeCompare(b.path));
}

/** Channels' series on the flight's own time axis (the other charts'): the explorer's charts. */
export function series(dir: string, paths: string[]) {
  const T = samples(dir);
  const ax = timeAxis(T);
  const step = Math.max(1, Math.ceil(T.length / 4000));
  const get = (S: Row, p: string) => {
    let v: unknown = S;
    for (const k of p.replace(/\[(\d+)\]/g, ".$1").split(".")) v = v === null || v === undefined ? undefined : (v as Row)[k];
    return typeof v === "boolean" ? (v ? 1 : 0) : v;
  };
  return {
    xLabel: ax.label,
    series: paths.slice(0, 24).map((p) => ({
      path: p,
      pts: T.filter((_, i) => i % step === 0 || i === T.length - 1)
        .map((S) => [ax.x(S), get(S, p)] as [number, unknown])
        .filter((q): q is Pt => typeof q[1] === "number" && Number.isFinite(q[1])),
    })),
  };
}

/** What the craft was doing, as bands over time: autopilot, hold, assist, the hub's card, the entry, status. */
function timeline(T: Row[]) {
  const ax = timeAxis(T);
  const KEYS: [string, (S: Row) => unknown][] = [
    ["status", (S) => S.label],
    ["autopilot", (S) => S.auto],
    ["hold", (S) => S.hold],
    ["assisted", (S) => (S.assist ? "assisted" : null)],
    ["hub", (S) => S.hub?.title],
    ["step", (S) => S.hub?.phase],
    ["entry", (S) => S.entry?.ph],
    ["profile", (S) => S.entry?.prof],
    ["docking", (S) => S.dock],
    ["warp", (S) => (S.warp > 1.5 ? `×${S.warp >= 100 ? Math.round(S.warp) : S.warp}` : null)],
    ["soi", (S) => S.soi],
  ];
  const rows: { key: string; segs: { x0: number; x1: number; v: string }[] }[] = [];
  for (const [key, f] of KEYS) {
    const segs: { x0: number; x1: number; v: string }[] = [];
    for (const S of T) {
      const v = f(S);
      const x = ax.x(S);
      const last = segs[segs.length - 1];
      if (v === null || v === undefined || v === "none" || v === false) {
        if (last && last.x1 < 0) last.x1 = x;
        continue;
      }
      if (last && last.x1 < 0 && last.v === String(v)) continue;
      if (last && last.x1 < 0) last.x1 = x;
      segs.push({ x0: x, x1: -1, v: String(v) });
    }
    const end = T.length ? ax.x(T[T.length - 1]!) : 0;
    for (const sg of segs) if (sg.x1 < 0) sg.x1 = end;
    if (segs.length) rows.push({ key, segs: segs.slice(0, 400) });
  }
  return { xLabel: ax.label, x1: T.length ? ax.x(T[T.length - 1]!) : 0, rows };
}

/** One recorded flight, ready to draw. */
export function report(dir: string) {
  const T = samples(dir);
  const ev = jsonl(join(dir, "events.jsonl")) as { t: number; kind: string; text: string; wall?: number }[];
  const G = json(join(dir, "graphs.json")) ?? { graphs: {}, on: {} };
  const summary = json(join(dir, "summary.json")) ?? {};
  const fps = jsonl(join(dir, "fps.jsonl"));
  // (a long flight thinned for the charts — every sample stays in the raw file)
  const step = Math.max(1, Math.ceil(T.length / 2500));
  const Td = T.filter((_, i) => i % step === 0 || i === T.length - 1);
  const sections = buildCharts(Td, ev, G);
  // (where it went: the ground track, latitude against longitude, its start and end marked)
  const ax = timeAxis(Td);
  const geo = Td.filter((S) => S.geo && Number.isFinite(S.geo.lat) && Number.isFinite(S.geo.lon));
  const where: Chart[] = [];
  if (geo.length > 2 && new Set(geo.map((S) => `${S.geo.lat.toFixed(2)},${S.geo.lon.toFixed(2)}`)).size > 2) {
    // (a track crossing the antimeridian cut there: no line across the map)
    const pts: Pt[] = [];
    for (const S of geo) {
      const p: Pt = [S.geo.lon, S.geo.lat];
      if (pts.length && Math.abs(pts[pts.length - 1]![0] - p[0]) > 180) pts.push([Number.NaN, Number.NaN]);
      pts.push(p);
    }
    where.push({
      title: `Ground track over ${geo[0]!.geo.body}`,
      unit: "latitude [°]",
      xLabel: "longitude [°]",
      series: [{ name: "track", pts, slot: 2 }],
      states: [
        { x: geo[0]!.geo.lon, y: geo[0]!.geo.lat, s: "wait" },
        { x: geo[geo.length - 1]!.geo.lon, y: geo[geo.length - 1]!.geo.lat, s: "on" },
      ],
    });
    const alt = geo.filter((S) => Number.isFinite(S.geo.altM));
    if (alt.length > 2)
      where.push({
        title: "Height above the ellipsoid",
        unit: "km",
        xLabel: ax.label,
        series: [{ name: "height", pts: alt.map((S) => [ax.x(S), S.geo.altM / 1000] as Pt) }],
      });
  }
  // (the machine while it flew: frame rates, the GPU's frame, the worst loop, the render's scale, the heap)
  const perf: Chart[] = [];
  const pt = (f: (S: Row) => unknown): Pt[] =>
    Td.map((S) => [ax.x(S), f(S)] as [number, unknown]).filter((q): q is Pt => typeof q[1] === "number" && Number.isFinite(q[1]));
  const pc = (title: string, unit: string, ...s: [string, (S: Row) => unknown][]) => {
    const series = s.map(([name, f], k) => ({ name, pts: pt(f), slot: (k + 1) as 1 | 2 | 3 })).filter((x) => x.pts.length > 1);
    if (series.length) perf.push({ title, unit, xLabel: ax.label, series });
  };
  pc("Frame rate (the game's meter)", "fps", ["loop", (S) => S.perf?.loopFps], ["render", (S) => S.perf?.renderFps]);
  pc("GPU time", "ms", ["frame", (S) => S.perf?.gpuFrameMs], ["passes", (S) => S.perf?.gpuPassesMs]);
  pc("Worst loop", "ms", ["worst frame", (S) => S.perf?.worstLoopMs]);
  pc("Render scale", "× the canvas", ["scale", (S) => S.perf?.renderScale]);
  pc("JS heap", "MB", ["heap", (S) => S.heapMB]);
  // (the hub's card each time it changed: its rows — the commanded and the actual side by side, as the
  // pilot read them — and its severity)
  const hub: { t: number; title: string; phase: string; next: string | null; rows: unknown[]; say: string | null }[] = [];
  let last = "";
  for (const S of T) {
    if (!S.hub) continue;
    const key = JSON.stringify([S.hub.title, S.hub.phase, S.hub.rows]);
    if (key === last) continue;
    last = key;
    hub.push({ t: S.t, title: S.hub.title, phase: S.hub.phase, next: S.hub.next ?? null, rows: S.hub.rows ?? [], say: S.hub.say ?? null });
    if (hub.length > 400) break;
  }
  const shotDir = join(dir, "shots");
  const shots = existsSync(shotDir)
    ? readdirSync(shotDir)
        .filter((f) => /\.(png|jpe?g)$/i.test(f))
        .sort()
        .map((f) => ({ name: f, url: fileUrl(join(shotDir, f)) }))
    : [];
  const sc = summary.id ? SCENARIOS.find((s) => s.id === summary.id) : null;
  return {
    dir,
    kind: summary.id ? "scenario" : "test",
    summary,
    scenario: sc ? { id: sc.id, title: sc.title, tags: sc.tags, minutes: sc.minutes } : null,
    samples: T.length,
    sim: T.length ? { t0: T[0]!.t, t1: T[T.length - 1]!.t } : null,
    fps,
    events: ev.slice(0, 4000),
    sections: { ...sections, where, perf },
    channels: channels(Td),
    timeline: timeline(Td),
    hub,
    quality: T.length > 1 ? quality(dir) : {},
    shots,
    first: T[0] ?? null,
    last: T[T.length - 1] ?? null,
    raw: ["telemetry.jsonl", "events.jsonl", "fps.jsonl", "graphs.json", "summary.json"]
      .filter((f) => existsSync(join(dir, f)))
      .map((f) => ({ name: f, url: fileUrl(join(dir, f)) })),
  };
}

/** An e2e run's recorded tests: <root>/<file>/<NN>/ — by file, each test's folder and its summary. */
export function e2eReports(root: string) {
  const out: Record<string, { k: number; dir: string; summary: Row | null }[]> = {};
  if (!existsSync(root)) return out;
  for (const f of readdirSync(root)) {
    const fd = join(root, f);
    if (!statSync(fd).isDirectory()) continue;
    out[`${f}.e2e.test.ts`] = readdirSync(fd)
      .filter((k) => /^\d+$/.test(k))
      .sort()
      .map((k) => ({ k: Number(k), dir: join(fd, k), summary: json(join(fd, k, "summary.json")) }));
  }
  return out;
}

/** Where a run's recorded tests are, from its log's "e2e reports: <root>" (a remote run's: in its artifacts). */
export function reportRootOf(log: string, remoteJob?: string): string | null {
  const m = log.match(/^e2e reports: (\S+)/m);
  if (!m) return null;
  const local = m[1]!;
  const there = remoteJob ? join(RESULTS, remoteJob, "artifacts", local) : null;
  if (there && existsSync(there)) return there;
  return existsSync(local) ? local : there;
}

// ------------------------------------------------------------------------------------------- the flight lab

/** Every scenario, with its last verdicts found on disk (here and brought back from the mini). */
export function scenarios() {
  const last = new Map<string, { verdict: string; why: string; wallS: number; at: number; dir: string; machine: string }[]>();
  for (const c of campaigns())
    for (const r of c.rows) {
      const l = last.get(r.id) ?? [];
      l.push({ verdict: r.verdict, why: r.why, wallS: r.wallS, at: c.at, dir: join(c.dir, r.id), machine: r.machine ?? c.machine });
      last.set(r.id, l);
    }
  return SCENARIOS.map((s) => {
    const l = (last.get(s.id) ?? []).sort((a, b) => b.at - a.at);
    return { id: s.id, title: s.title, tags: s.tags, minutes: s.minutes, runs: l.slice(0, 8) };
  });
}

let campCache: { at: number; list: ReturnType<typeof scanCampaigns> } | null = null;
/** The campaigns on disk: flight-results/* here, and those the mini's jobs brought back. */
export function campaigns() {
  if (campCache && Date.now() - campCache.at < 5000) return campCache.list;
  campCache = { at: Date.now(), list: scanCampaigns() };
  return campCache.list;
}
function scanCampaigns() {
  const roots: string[] = [];
  if (existsSync(FLIGHTS)) for (const d of readdirSync(FLIGHTS)) roots.push(join(FLIGHTS, d));
  if (existsSync(RESULTS))
    for (const j of readdirSync(RESULTS)) {
      const a = join(RESULTS, j, "artifacts", FLIGHTS);
      if (existsSync(a)) for (const d of readdirSync(a)) roots.push(join(a, d));
    }
  return roots
    .filter((d) => statSync(d).isDirectory())
    .map((dir) => {
      const sum = json(join(dir, "summary.json"));
      // (a campaign cut short has no summary of its own: its scenarios' are read)
      const rows: Row[] =
        sum?.rows ??
        readdirSync(dir)
          .filter((s) => existsSync(join(dir, s, "summary.json")))
          .map((s) => json(join(dir, s, "summary.json")))
          .filter(Boolean);
      const name = dir.split("/").pop()!;
      return {
        id: name,
        dir,
        machine: sum?.machine ?? (name.includes("mini") ? "Mac-mini" : "here"),
        at: statSync(dir).mtimeMs,
        rows: rows.map((r) => ({
          id: r.id,
          title: r.title,
          verdict: r.verdict,
          why: r.why,
          wallS: r.wallS,
          machine: r.machine,
          tags: r.tags ?? [],
        })),
        notes: sum?.notes ?? [],
        complete: !!sum,
      };
    })
    .sort((a, b) => b.at - a.at);
}
