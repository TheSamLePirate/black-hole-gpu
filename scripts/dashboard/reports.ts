// The dashboard's reports: one recorded flight — an e2e test's (tests/e2e/lib/telemetry.ts) or a flight-lab
// scenario's (tests/flight/lib/lab.ts), the same folder either way — read whole and turned into what the
// report page draws: the charts by section (the flight lab's own builder, tests/flight/lib/charts.ts: the
// assistants' corridors, commanded against flown, the approach, the docking, the telemetry), the frame rate,
// the hub's cards as they changed, the quality measures, the events, the pictures. And around them: the
// flight lab's scenarios and campaigns, every test's past durations (the estimate).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { buildCharts } from "../../tests/flight/lib/charts";
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

/** One recorded flight, ready to draw. */
export function report(dir: string) {
  const T = jsonl(join(dir, "telemetry.jsonl"));
  const ev = jsonl(join(dir, "events.jsonl")) as { t: number; kind: string; text: string; wall?: number }[];
  const G = json(join(dir, "graphs.json")) ?? { graphs: {}, on: {} };
  const summary = json(join(dir, "summary.json")) ?? {};
  const fps = jsonl(join(dir, "fps.jsonl"));
  // (a long flight thinned for the charts — every sample stays in the raw file)
  const step = Math.max(1, Math.ceil(T.length / 2500));
  const Td = T.filter((_, i) => i % step === 0 || i === T.length - 1);
  const sections = buildCharts(Td, ev, G);
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
    sections,
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
