// Every e2e test's telemetry (docs/E2E.md §4): the flight lab's sampler (tests/flight/lib/sampler.ts) installed
// in each page the harness loads, fed by the tests themselves — a sample every half second of stepped time
// (`__bh.step` is wrapped: a whole flight flown in one page call is sampled through), and every half second of
// the page's own frames otherwise — with the frame rate each second, the moments (autopilot, hold, assistant,
// the hub's card, the entry's phase, docking, landing…), the pilot's messages and the game's log.
//
// Written as the flight lab writes a scenario, one folder per test, so the same reports read both:
//   <E2E_REPORT_ROOT>/<file>/<NN>/  telemetry.jsonl · events.jsonl · fps.jsonl · graphs.json · summary.json · shots/
// NN: the test's place in its file (00: the file's setup, its beforeAll); the test's name and verdict come
// from bun test's output (the dashboard matches them in order). On only through the preload
// (tests/e2e/lib/preload.ts, which `bun run e2e` passes); E2E_TELEMETRY=0, or App.boot({ telemetry: false }),
// leaves a page without it.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { LAB_PAGE } from "../../flight/lib/sampler";

/** The page side, over the flight lab's: when to sample, the frame rate, the moments, the drain. */
export const E2E_PAGE = `(() => {
  if (window.__e2e) return true;
  const L = window.__lab;
  const S = [], E = [], F = [];
  const simS = () => __bh.sim.time * 4.925490947e-6 * __bh.settings.massSolar;
  let stepped = 0, lastWall = 0, logI = __bh.game?.log?.events?.length ?? 0, fpsNow = null, prev = {};
  const MOM = [["auto", (T) => T.auto], ["hold", (T) => T.hold], ["assist", (T) => T.assist], ["hub", (T) => T.hub?.title],
    ["entry", (T) => T.entry?.ph], ["profile", (T) => T.entry?.prof], ["dock", (T) => T.dock], ["label", (T) => T.label],
    ["side", (T) => T.side], ["soi", (T) => T.soi], ["mission", (T) => T.mission], ["landed", (T) => T.landed],
    ["docked", (T) => T.docked], ["vessel", (T) => T.vessel], ["mode", (T) => T.mode]];
  const take = (why) => {
    let T;
    try { T = L.sample(true); } catch { return null; }
    T.why = why;
    T.fps = fpsNow;
    for (const [k, f] of MOM) {
      const v = f(T) ?? null;
      if (k in prev && prev[k] !== v) E.push({ t: T.t, wall: T.wall, kind: "phase", text: k + ": " + prev[k] + " → " + v });
      prev[k] = v;
    }
    S.push(T);
    if (S.length > 40000) S.splice(0, 10000);
    lastWall = performance.now();
    return T;
  };
  // (a stepped flight: a sample each half second of steps — a whole glide flown in one call comes out whole)
  const step0 = __bh.step;
  __bh.step = (dt) => {
    const r = step0(dt);
    stepped += dt;
    if (stepped >= 0.5) { stepped = 0; take("step"); }
    return r;
  };
  // (the page's own frames: the frame rate each second; a sample each half second while they move the
  // world, every two seconds while it is held — a menu, a click on the cockpit still change the state)
  let frames = 0, t0 = performance.now(), worst = 0, prevF = t0;
  const frame = () => {
    const now = performance.now();
    frames++;
    worst = Math.max(worst, now - prevF);
    prevF = now;
    if (now - t0 >= 1000) {
      fpsNow = Math.round((frames * 1000) / (now - t0));
      F.push([Math.round(now), fpsNow, Math.round(worst * 10) / 10]);
      frames = 0; t0 = now; worst = 0;
    }
    const held = __bh.frozen || !__bh.settings.animate;
    if (now - lastWall >= (held ? 2000 : 500)) take(held ? "held" : "live");
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const drain = () => {
    const ev = __bh.game?.log?.events ?? [];
    if (logI > ev.length) logI = ev.length;
    const log = ev.slice(logI).map((e) => ({ kind: e.kind, text: e.text }));
    logI = ev.length;
    return { S: S.splice(0), E: E.splice(0), F: F.splice(0), msgs: L.msgs.splice(0), log, t: simS(), wall: Math.round(performance.now()) };
  };
  // (a new test: the assistants' graphs started again — each test's own)
  const fresh = () => { for (const k in L.graphs) delete L.graphs[k]; for (const k in L.onGraph) delete L.onGraph[k]; take("start"); return true; };
  window.__e2e = { drain, take, fresh, graphs: () => ({ graphs: L.graphs, on: L.onGraph }) };
  return true;
})()`;

/** What the harness needs of a page (App, without importing it: no cycle). */
export interface Recordable {
  js<T = unknown>(expr: string): Promise<T>;
  cdp: { send<T = Record<string, unknown>>(method: string, params?: object, timeoutS?: number): Promise<T>; errors: string[] };
}

interface Drained {
  S: Record<string, unknown>[];
  E: { t: number; wall: number; kind: string; text: string }[];
  F: [number, number, number][];
  msgs: { t: number; text: string }[];
  log: { kind: string; text: string }[];
  t: number;
  wall: number;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/** The run's root: E2E_REPORT_ROOT, else remote-results/e2e-reports/<time>-<host> (said once on stderr). */
export function reportRoot(): string {
  if (!process.env.E2E_REPORT_ROOT)
    process.env.E2E_REPORT_ROOT = `remote-results/e2e-reports/${stamp()}-${hostname().replace(/\.local$/, "")}`;
  return process.env.E2E_REPORT_ROOT;
}

/** This process's recorder: the page being watched, the test being recorded, its folder. */
class Recorder {
  enabled = false;
  private page: Recordable | null = null;
  private file = "";
  private k = 0;
  private dir = "";
  private wall0 = Date.now();
  private sim0: number | null = null;
  private fps: number[] = [];
  private samples = 0;
  private timer: Timer | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private said = new Set<string>();

  /** The preload's: on for this process. */
  enable() {
    if (process.env.E2E_TELEMETRY === "0") return;
    this.enabled = true;
    console.error(`e2e reports: ${reportRoot()}`);
  }

  /** A page loaded (App.load): its sampler installed, watched from now. `file`: the test file it serves. */
  async attach(page: Recordable, file: string) {
    if (!this.enabled) return;
    await page.js(LAB_PAGE);
    await page.js(E2E_PAGE);
    this.page = page;
    if (file !== this.file) {
      this.file = file;
      this.k = 0;
      this.open();
    }
    this.timer ??= setInterval(() => this.pull(), 1500);
  }

  /** The page closed: what it had, kept. */
  detach(page: Recordable) {
    if (this.page !== page) return;
    this.page = null;
  }

  private open() {
    this.dir = join(reportRoot(), this.file.replace(/\.e2e\.test\.ts$/, ""), String(this.k).padStart(2, "0"));
    mkdirSync(join(this.dir, "shots"), { recursive: true });
    this.wall0 = Date.now();
    this.sim0 = null;
    this.fps = [];
    this.samples = 0;
    this.said.clear();
  }

  /** A test begins (preload's beforeEach): the setup's (or the previous test's) record closed, a new one opened. */
  async begin() {
    if (!this.enabled) return;
    await this.pull();
    if (this.k === 0 && this.dir) this.summary();
    this.k++;
    this.open();
    await this.page?.js("window.__e2e?.fresh()").catch(() => {});
  }

  /** A test ends (preload's afterEach): its last samples, its graphs, a picture, its summary. */
  async end() {
    if (!this.enabled || !this.dir) return;
    await this.pull();
    const page = this.page;
    if (page) {
      const g = await page.js("window.__e2e?.graphs()").catch(() => null);
      if (g) writeFileSync(join(this.dir, "graphs.json"), JSON.stringify(g));
      const shot = await page.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 72 }, 20).catch(() => null);
      if (shot) writeFileSync(join(this.dir, "shots", "end.jpg"), Buffer.from(shot.data, "base64"));
    }
    this.summary();
  }

  private summary() {
    const f = [...this.fps].sort((a, b) => a - b);
    const pct = (p: number) => (f.length ? f[Math.min(f.length - 1, Math.floor((p / 100) * f.length))] : null);
    writeFileSync(
      join(this.dir, "summary.json"),
      JSON.stringify({
        file: this.file,
        k: this.k,
        host: hostname().replace(/\.local$/, ""),
        start: this.wall0,
        end: Date.now(),
        wallS: Math.round((Date.now() - this.wall0) / 100) / 10,
        samples: this.samples,
        fps: f.length
          ? { min: f[0], p5: pct(5), median: pct(50), max: f[f.length - 1], mean: Math.round(f.reduce((a, b) => a + b, 0) / f.length) }
          : null,
      }),
    );
  }

  /** What the page gathered since, appended to the current test's files. Serialized: never two at once. */
  pull(): Promise<unknown> {
    this.chain = this.chain.then(async () => {
      const page = this.page;
      if (!page || !this.dir) return;
      const d = await page.js<Drained | null>("window.__e2e ? window.__e2e.drain() : null").catch(() => null);
      if (!d) return;
      const app = (f: string, rows: unknown[]) =>
        rows.length && appendFileSync(join(this.dir, f), rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
      this.sim0 ??= (d.S[0]?.t as number) ?? d.t;
      app("telemetry.jsonl", d.S);
      this.samples += d.S.length;
      app(
        "fps.jsonl",
        d.F.map(([wall, fps, worstMs]) => ({ wall: Date.now() - this.wall0 - (d.wall - wall), fps, worstMs })),
      );
      for (const [, fps] of d.F) this.fps.push(fps);
      const events: { t: number; kind: string; text: string; wall?: number }[] = [];
      for (const m of d.msgs) {
        events.push({ t: m.t, kind: "pilot", text: m.text });
        this.said.add(m.text);
      }
      for (const l of d.log)
        if (l.kind !== "pilot" && !(l.kind === "info" && this.said.has(l.text)))
          events.push({ t: d.t, kind: `log:${l.kind}`, text: l.text });
      for (const e of d.E) events.push({ t: e.t, kind: e.kind, text: e.text });
      for (const err of page.cdp.errors.slice(-20))
        if (!this.said.has(`err:${err}`)) {
          this.said.add(`err:${err}`);
          events.push({ t: d.t, kind: "page-error", text: err.slice(0, 2000) });
        }
      app(
        "events.jsonl",
        events.map((e) => ({ ...e, wall: Date.now() - this.wall0 })),
      );
    });
    return this.chain;
  }

  /** The process ends: the last record closed (a file whose last test had no afterEach, a crash). */
  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.dir && existsSync(this.dir)) this.summary();
  }
}

export const recorder = new Recorder();
