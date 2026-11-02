// The lab's last hours, machine by machine, for the Monitor's timeline: the runs and remote jobs (their verdicts,
// runs.ts's history), every e2e test recorded (its summary: tests/e2e/lib/telemetry.ts — here in
// remote-results/e2e-reports/, the mini's and the PC's in their jobs' fetched artifacts) and the machine's heat
// over the same span (lab.ts's heat()). What ran when, and how hot it was meanwhile.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ThermalSeries } from "../lib/thermal";
import { heat } from "./lab";
import { history, RESULTS } from "./runs";

export type Machine = "here" | "mini" | "pc";
export interface TimelineRun {
  id: string;
  title: string;
  source: string;
  from: number;
  to: number | null;
  state: string;
  /** passed (true), failed (false), unknown (null: cancelled, no tests) */
  ok: boolean | null;
  pass: number;
  fail: number;
}
export interface TimelineTest {
  file: string;
  k: number;
  from: number;
  to: number;
  fps: number | null;
  /** the worst thermal pressure during it (null: no thermal service then) */
  worst: string | null;
  gpuPct: number | null;
  /** its report folder (the dashboard's report page) */
  dir: string;
}
export interface Timeline {
  from: number;
  to: number;
  lanes: Record<Machine, { runs: TimelineRun[]; tests: TimelineTest[]; heat: ThermalSeries | null }>;
}

const machineOf = (where: string): Machine => (/pc|win/i.test(where) ? "pc" : /mini/i.test(where) ? "mini" : "here");

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Every test recorded under a report root's runs newer than t0: <root>/<run>/<file>/<NN>/summary.json. */
function testsUnder(base: string, t0: number, t1: number, machine: Machine | null, out: Record<Machine, TimelineTest[]>) {
  if (!existsSync(base)) return;
  for (const run of readdirSync(base)) {
    const rd = join(base, run);
    try {
      if (statSync(rd).mtimeMs < t0) continue;
    } catch {
      continue;
    }
    let files: string[] = [];
    try {
      files = readdirSync(rd);
    } catch {
      continue;
    }
    for (const f of files) {
      let ks: string[] = [];
      try {
        ks = readdirSync(join(rd, f)).filter((k) => /^\d\d$/.test(k));
      } catch {
        continue;
      }
      for (const k of ks) {
        const dir = join(rd, f, k);
        const s = readJson<{
          file?: string;
          k?: number;
          host?: string;
          start?: number;
          end?: number;
          fps?: { median?: number } | null;
          thermal?: { worstPressure?: string | null; gpuOfMaxPct?: { median?: number } | null } | null;
        }>(join(dir, "summary.json"));
        if (!s?.start || !s.end || s.end < t0 || s.start > t1) continue;
        // (setup records — k 0 — kept: a file's boot is time spent too)
        const m = machine ?? machineOf(s.host ?? "");
        out[m].push({
          file: (s.file ?? f).replace(/^.*\//, "").replace(/\.e2e\.test\.ts$/, ""),
          k: s.k ?? Number(k),
          from: s.start,
          to: s.end,
          fps: s.fps?.median ?? null,
          worst: s.thermal?.worstPressure ?? null,
          gpuPct: s.thermal?.gpuOfMaxPct?.median ?? null,
          dir,
        });
      }
    }
  }
}

/** The last `hours` of the lab (at most 24). The tests read from disk at each call: cheap — only the run folders
 *  touched within the window are opened. */
export async function timeline(hours: number): Promise<Timeline> {
  const to = Date.now();
  const from = to - Math.min(24, Math.max(0.5, hours || 6)) * 3600_000;
  const runs: Record<Machine, TimelineRun[]> = { here: [], mini: [], pc: [] };
  const tests: Record<Machine, TimelineTest[]> = { here: [], mini: [], pc: [] };
  for (const r of history()) {
    if (r.source === "flightlab") continue;
    const end = r.ended ?? (r.state === "running" ? to : r.started);
    if (end < from || r.started > to) continue;
    const m = machineOf(r.where);
    const n = r.counts.pass + r.counts.fail;
    runs[m].push({
      id: r.id,
      title: r.title,
      source: r.source,
      from: r.started,
      to: r.ended ?? null,
      state: r.state,
      ok:
        r.state === "running" || r.state === "queued"
          ? null
          : n
            ? r.counts.fail === 0 && (r.exit ?? 0) === 0
            : r.exit === 0
              ? true
              : r.exit
                ? false
                : null,
      pass: r.counts.pass,
      fail: r.counts.fail,
    });
    // (a remote job's tests: in its fetched artifacts)
    if (r.source === "remote") {
      const art = join(RESULTS, r.id, "artifacts", RESULTS, "e2e-reports");
      testsUnder(art, from, to, m, tests);
    }
  }
  testsUnder(join(RESULTS, "e2e-reports"), from, to, null, tests);
  const minutes = Math.ceil((to - from) / 60_000);
  const [hHere, hMini] = await Promise.all([heat("here", minutes).catch(() => null), heat("mini", minutes).catch(() => null)]);
  const sort = <T extends { from: number }>(a: T[]) => a.sort((x, y) => x.from - y.from);
  return {
    from,
    to,
    lanes: {
      here: { runs: sort(runs.here), tests: sort(tests.here).slice(-1500), heat: hHere },
      mini: { runs: sort(runs.mini), tests: sort(tests.mini).slice(-1500), heat: hMini },
      pc: { runs: sort(runs.pc), tests: sort(tests.pc).slice(-1500), heat: null },
    },
  };
}
