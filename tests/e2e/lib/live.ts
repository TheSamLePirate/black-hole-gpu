// An e2e process's live state, for whoever watches the lab (scripts/lab-monitor.ts, the dashboard's Monitor):
// ~/.kerr-lab/live/e2e-<pid>.json, written every two seconds by the recorder (telemetry.ts) — the file, the test
// running (its place, its title), the time gone against the file's usual time, the frame rate, the craft (where,
// how high, how fast, what flies it) with the test's last minutes as a series, the tests already ended, the
// latest moments. Removed when the process ends; a dead process's file is swept by the monitor.
//
// A picture on demand (a "peek"): whoever wants one creates e2e-<pid>.peek; the recorder sees it at its next
// pull, takes a small JPEG of the page and writes e2e-<pid>.jpg (then deletes the request). Nothing is taken
// unless asked — the e2e's own measures stay undisturbed.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { basename, join, resolve } from "node:path";

/** (KERR_LIVE_DIR: elsewhere — the unit tests) */
export const LIVE_DIR = process.env.KERR_LIVE_DIR ?? join(homedir(), ".kerr-lab", "live");

/** The craft as the last sample saw it (null fields where they do not apply). */
export interface LiveCraft {
  vessel: string | null;
  mode: string | null;
  label: string | null;
  body: string | null;
  /** km over the body (the sampler's), m over the ground (geodetic) */
  altKm: number | null;
  aglM: number | null;
  v: number | null;
  vz: number | null;
  auto: string | null;
  hold: string | null;
  hub: string | null;
  phase: string | null;
  entry: string | null;
  landed: boolean;
  docked: boolean;
  warp: number | null;
  pitch: number | null;
  bank: number | null;
  hdg: number | null;
  mach: number | null;
  g: number | null;
  fuel: number | null;
  lat: number | null;
  lon: number | null;
  gpuMs: number | null;
  renderScale: number | null;
  quality: string | null;
}

export interface E2eLive {
  kind: "e2e";
  pid: number;
  host: string;
  cwd: string;
  /** the e2e's report root (absolute) and the running test's folder in it */
  root: string;
  dir: string;
  file: string;
  suite: string;
  /** the test's place (0: the file's setup) among n */
  k: number;
  n: number;
  test: string;
  fileStart: number;
  testStart: number;
  at: number;
  /** when the page last answered (a long page call — a whole flight stepped — holds it) */
  pageAt: number;
  /** the file's usual seconds (tests/e2e/durations.json: this machine's median, else the other's) */
  estimateS: number | null;
  fps: number | null;
  worstMs: number | null;
  craft: LiveCraft | null;
  /** the running test's last minutes: [seconds since it began, km, m/s, fps, m over the ground] */
  series: [number, number | null, number | null, number | null, number | null][];
  /** the file's tests already ended: their place, title, seconds */
  done: { k: number; test: string; wallS: number }[];
  /** the latest moments (phase changes, pilot's messages, the game's log, page errors) */
  events: { wall: number; kind: string; text: string }[];
  errors: number;
  /** the latest picture taken on demand */
  shot: { at: number; path: string } | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** A sample (tests/flight/lib/sampler.ts) → the craft's few figures a watcher reads. */
export function craftOf(T: Record<string, unknown> | null | undefined): LiveCraft | null {
  if (!T) return null;
  // biome-ignore lint/suspicious/noExplicitAny: the sampler's sample, loosely typed
  const t = T as any;
  return {
    vessel: str(t.vessel),
    mode: str(t.mode),
    label: str(t.label),
    body: str(t.geo?.body) ?? str(t.air?.body) ?? str(t.soi),
    altKm: num(t.alt),
    aglM: num(t.air?.h) ?? num(t.entry?.app?.agl),
    v: num(t.v),
    vz: num(t.vz),
    auto: str(t.auto),
    hold: str(t.hold),
    hub: str(t.hub?.title),
    phase: str(t.hub?.phase),
    entry: str(t.entry?.ph),
    landed: !!t.landed,
    docked: !!t.docked,
    warp: num(t.warp),
    pitch: num(t.att?.pitch),
    bank: num(t.att?.bank),
    hdg: num(t.att?.hdg),
    mach: num(t.air?.mach),
    g: num(t.air?.g),
    fuel: num(t.fuel),
    lat: num(t.geo?.lat),
    lon: num(t.geo?.lon),
    gpuMs: num(t.perf?.gpuFrameMs),
    renderScale: num(t.perf?.renderScale),
    quality: str(t.perf?.quality),
  };
}

/** The file's usual seconds: this machine's median of passed runs, else the other Mac's (null: never timed). */
export function estimateOf(file: string): number | null {
  try {
    const all = JSON.parse(readFileSync("tests/e2e/durations.json", "utf8")) as Record<
      string,
      { mini: number | null; here: number | null }
    >;
    const d = all[basename(file)];
    if (!d) return null;
    return /mini/i.test(hostname()) ? (d.mini ?? d.here) : (d.here ?? d.mini);
  } catch {
    return null;
  }
}

const SERIES_MAX = 360;
const EVENTS_MAX = 12;

/** This process's live file: kept up to date by the recorder, written atomically. */
export class LiveState {
  private s: E2eLive;
  private path = join(LIVE_DIR, `e2e-${process.pid}.json`);
  private lastSeriesWall = -1;
  constructor() {
    const now = Date.now();
    this.s = {
      kind: "e2e",
      pid: process.pid,
      host: hostname().replace(/\.local$/, ""),
      cwd: process.cwd(),
      root: "",
      dir: "",
      file: "",
      suite: "",
      k: 0,
      n: 0,
      test: "",
      fileStart: now,
      testStart: now,
      at: now,
      pageAt: now,
      estimateS: null,
      fps: null,
      worstMs: null,
      craft: null,
      series: [],
      done: [],
      events: [],
      errors: 0,
      shot: null,
    };
  }

  /** A file begins (its page attached). */
  file(file: string, suite: string, n: number, root: string) {
    if (this.s.file === file) return;
    Object.assign(this.s, {
      file,
      suite,
      n,
      root: resolve(root),
      fileStart: Date.now(),
      estimateS: estimateOf(file),
      done: [],
      errors: 0,
    });
  }

  /** A test begins (k 0: the file's setup). */
  test(k: number, title: string, dir: string) {
    Object.assign(this.s, { k, test: title, dir: resolve(dir), testStart: Date.now(), series: [], craft: null });
    this.lastSeriesWall = -1;
  }

  /** A test ended: its place, title and time kept in the file's list. */
  ended(k: number, title: string, wallS: number) {
    if (k > 0 && !this.s.done.some((d) => d.k === k)) this.s.done.push({ k, test: title, wallS });
  }

  /** What a drain brought: the last sample, the frame rates, the moments. */
  drained(samples: Record<string, unknown>[], fps: [number, number, number][], events: { kind: string; text: string }[]) {
    const now = Date.now();
    this.s.pageAt = now;
    const last = fps.at(-1);
    if (last) {
      this.s.fps = last[1];
      this.s.worstMs = last[2];
    }
    if (samples.length) this.s.craft = craftOf(samples.at(-1));
    const wall = (now - this.s.testStart) / 1000;
    // (the series: a point a second at most, the test's last six minutes — started again at a jump no flight
    // makes, the page sent elsewhere (a scene loaded, a save restored), so the charts show the flight, not the leap)
    for (const T of samples) {
      const c = craftOf(T);
      const prev = this.s.series.at(-1)?.[1] ?? null;
      if (prev !== null && c?.altKm !== null && c?.altKm !== undefined && Math.abs(c.altKm - prev) > Math.max(50, prev * 0.5)) {
        this.s.series = [];
        this.lastSeriesWall = -1;
      }
      const w = Math.round(wall * 10) / 10;
      if (w - this.lastSeriesWall < 1 && samples.length > 1) continue;
      this.lastSeriesWall = w;
      this.s.series.push([w, c?.altKm ?? null, c?.v ?? null, this.s.fps, c?.aglM ?? null]);
    }
    if (!samples.length && this.s.fps !== null && wall - this.lastSeriesWall >= 1) {
      this.lastSeriesWall = wall;
      this.s.series.push([
        Math.round(wall * 10) / 10,
        this.s.craft?.altKm ?? null,
        this.s.craft?.v ?? null,
        this.s.fps,
        this.s.craft?.aglM ?? null,
      ]);
    }
    if (this.s.series.length > SERIES_MAX) this.s.series.splice(0, this.s.series.length - SERIES_MAX);
    for (const e of events) {
      if (e.kind === "page-error") this.s.errors++;
      this.s.events.push({ wall: now, kind: e.kind, text: e.text.slice(0, 240) });
    }
    if (this.s.events.length > EVENTS_MAX) this.s.events.splice(0, this.s.events.length - EVENTS_MAX);
  }

  /** A picture asked for (e2e-<pid>.peek exists)? The request consumed. */
  peekWanted(): boolean {
    const p = join(LIVE_DIR, `e2e-${process.pid}.peek`);
    if (!existsSync(p)) return false;
    rmSync(p, { force: true });
    return true;
  }

  /** The picture taken: written beside the state. */
  peeked(jpeg: Buffer) {
    const p = join(LIVE_DIR, `e2e-${process.pid}.jpg`);
    writeFileSync(`${p}.tmp`, jpeg);
    renameSync(`${p}.tmp`, p);
    this.s.shot = { at: Date.now(), path: p };
  }

  write() {
    try {
      mkdirSync(LIVE_DIR, { recursive: true });
      this.s.at = Date.now();
      writeFileSync(`${this.path}.tmp`, JSON.stringify(this.s));
      renameSync(`${this.path}.tmp`, this.path);
    } catch {
      /* (a watcher's file: never the test's failure) */
    }
  }

  remove() {
    for (const ext of ["json", "jpg", "peek"]) rmSync(join(LIVE_DIR, `e2e-${process.pid}.${ext}`), { force: true });
  }
}

/** Every live e2e of this machine (the dead processes' files swept). */
export function liveE2e(alive: (pid: number) => boolean): E2eLive[] {
  const out: E2eLive[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(LIVE_DIR);
  } catch {
    return out;
  }
  for (const f of names) {
    const m = f.match(/^e2e-(\d+)\.json$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!alive(pid)) {
      for (const ext of ["json", "jpg", "peek"]) rmSync(join(LIVE_DIR, `e2e-${pid}.${ext}`), { force: true });
      continue;
    }
    try {
      out.push(JSON.parse(readFileSync(join(LIVE_DIR, f), "utf8")) as E2eLive);
    } catch {
      /* (being renamed) */
    }
  }
  return out.sort((a, b) => a.fileStart - b.fileStart);
}
