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
//
// Live too (lib/live.ts): ~/.kerr-lab/live/e2e-<pid>.json every two seconds — the file, the test, the craft, the
// frame rate — for the lab's monitor and the dashboard; a picture only when one asks (a "peek"). An e2e run
// without the preload (`E2E=1 bun test …`: the remote jobs, the A/B) is live too, lightly (lib/live-preload.ts,
// bunfig.toml): its file, its test, its time, a picture on demand — its page otherwise untouched.
import { type BannerProgress, bannerRef, fileInfo, showBanner } from "./banner";
import { type EmitKind, emitter } from "./emit";

/** no progress declared yet (each use spreads it with its own `done` list) */
const NO_PROGRESS: BannerProgress = {
  steps: [],
  at: -1,
  progress: null,
  done: [],
  values: null,
  estimateS: null,
  stepAt: null,
  saidAt: null,
  auto: null,
};
import { LiveState } from "./live";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { thermalWindow } from "../../../scripts/lib/thermal";
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
/** what summary.json says of the Earth data (null: the network kept — `off`, a Service Worker's boot, `// Earth data: network`) */
function earthSummary(e: Recordable["earth"]) {
  if (!e || e.mode === "off") return null;
  const c = e.counts;
  return {
    mode: e.mode,
    hits: c.hits,
    misses: c.misses,
    hitMiB: +(c.hitBytes / 2 ** 20).toFixed(2),
    missMiB: +(c.missBytes / 2 ** 20).toFixed(2),
    failed: c.failed,
    missing: c.missing.length,
  };
}

export interface Recordable {
  js<T = unknown>(expr: string): Promise<T>;
  cdp: { send<T = Record<string, unknown>>(method: string, params?: object, timeoutS?: number): Promise<T>; errors: string[] };
  /** the e2e's Earth data on disk (lib/earth-cache.ts, PLAN-J8 J8-T): its mode and counts, in the summary */
  earth?: null | {
    mode: string;
    dir: string;
    counts: { hits: number; misses: number; hitBytes: number; missBytes: number; failed: number; missing: string[] };
  };
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
  /** live only (no preload): the file and the test told, the page left alone but for a picture asked */
  light = false;
  private page: Recordable | null = null;
  private file = "";
  /** the file last said to the emitter (lib/emit.ts `suite`) */
  private saidFile = "";
  /** inside step(): its scenario is the step itself, said once (lib/emit.ts `step_started`) */
  private inStep = false;
  private k = 0;
  /** the case under way in the running test (scenario()): null until one is said */
  private scen: string | null = null;
  /** the test's declared progress (steps, the one under way, its count, the ended ones — lib/banner.ts BannerProgress): null none */
  private prog: BannerProgress | null = null;
  /** when the test last said its case (scenario) [ms] — the harness's own wait count after 10 s of silence */
  private scenAt = Date.now();
  /** a test running (begun, not ended): a page booted inside it serves that test, not the file's setup */
  private inTest = false;
  private dir = "";
  private wall0 = Date.now();
  private sim0: number | null = null;
  private fps: number[] = [];
  private samples = 0;
  private timer: Timer | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private said = new Set<string>();
  private live = new LiveState();
  private liveTimer: Timer | null = null;

  /** One fact for the readers outside (lib/emit.ts: ~/.kerr-lab/events/), stamped with the file and the test under way — on an
   *  e2e run only (recorded or live), nothing else changed by it. */
  private say(kind: EmitKind, data: Record<string, unknown> = {}) {
    if (!this.enabled && !this.light) return;
    emitter.at(this.file, this.k);
    emitter.say(kind, data);
  }

  /** The file (once, when it changes) and the test now open, said (lib/emit.ts). */
  private sayOpen(I: ReturnType<typeof fileInfo>) {
    if (!this.file) return;
    if (this.file !== this.saidFile) {
      this.saidFile = this.file;
      this.say("suite", { title: I.suite, tests: I.tests, estimateS: this.prog?.estimateS ?? null });
    }
    this.say("test_started", { title: this.k === 0 ? null : (I.tests[this.k - 1] ?? null), reportDir: this.dir || null });
  }

  /** The preload's: on for this process. */
  enable() {
    if (process.env.E2E_TELEMETRY === "0") return;
    this.enabled = true;
    console.error(`e2e reports: ${reportRoot()}`);
  }

  /** Live only (live-preload.ts): no record, no sampler — the file, the test, a picture asked for. */
  lightOn() {
    if (!this.enabled) this.light = true;
  }

  /** A page loaded (App.load): its sampler installed, watched from now. `file`: the test file it serves. */
  async attach(page: Recordable, file: string) {
    if (!this.enabled) {
      if (!this.light) return;
      this.page = page;
      if (file !== this.file) {
        this.file = file;
        this.k = this.inTest ? 1 : 0;
        this.openLight();
      }
      // (the banner on a Chrome one sees, on this path too — `E2E=1 bun test`: the remote jobs, the A/B; Sam, 16 Nov 2026)
      await showBanner(page, file, this.k, this.scen, this.prog);
      this.timer ??= setInterval(() => this.pullLight(), 1500);
      this.liveTimer ??= setInterval(() => this.live.write(), 2000);
      return;
    }
    await page.js(LAB_PAGE);
    await page.js(E2E_PAGE);
    this.page = page;
    if (file !== this.file) {
      this.file = file;
      // (booted inside the file's first test — most of them —: that test's record, not a setup's)
      this.k = this.inTest ? 1 : 0;
      this.open();
    }
    // (the banner on a Chrome one sees: the file, the test running, what it proves — lib/banner.ts)
    await showBanner(page, file, this.k, this.scen, this.prog);
    this.timer ??= setInterval(() => this.pull(), 1500);
    // (the live state written on its own clock: a page held by a long call shows as such, not as gone)
    this.liveTimer ??= setInterval(() => this.live.write(), 2000);
  }

  /** The page closed: what it had, kept. */
  detach(page: Recordable) {
    if (this.page !== page) return;
    this.page = null;
  }

  private open() {
    this.dir = join(reportRoot(), this.file.replace(/\.e2e\.test\.ts$/, ""), String(this.k).padStart(2, "0"));
    mkdirSync(join(this.dir, "shots"), { recursive: true });
    const I = fileInfo(this.file);
    this.live.file(this.file, I.suite, I.tests.length, reportRoot());
    this.live.test(this.k, this.k === 0 ? "setting up" : (I.tests[this.k - 1] ?? `test ${this.k}`), this.dir);
    this.live.write();
    this.sayOpen(I);
    this.wall0 = Date.now();
    this.sim0 = null;
    this.fps = [];
    this.samples = 0;
    this.said.clear();
  }

  /** Live only: the file's and the test's names told, nothing recorded. */
  private openLight() {
    const I = fileInfo(this.file);
    this.live.file(this.file, I.suite, I.tests.length, "", true);
    this.live.test(this.k, this.k === 0 ? "setting up" : (I.tests[this.k - 1] ?? `test ${this.k}`), "");
    this.live.write();
    this.sayOpen(I);
    this.wall0 = Date.now();
  }

  /** Live only: a picture if one was asked for, the state written. */
  private pullLight(): Promise<unknown> {
    this.chain = this.chain.then(async () => {
      const page = this.page;
      if (page && this.live.peekWanted()) {
        const shot = await page.cdp
          .send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 60, optimizeForSpeed: true }, 10)
          .catch(() => null);
        if (shot) this.live.peeked(Buffer.from(shot.data, "base64"));
      }
      this.live.write();
    });
    return this.chain;
  }

  /** A test begins (preload's beforeEach): the setup's (or the previous test's) record closed, a new one opened.
   *  `from`: whose hook — the full preload's or the live one's (live-preload.ts) — the other's ignored. */
  async begin(from: "full" | "live" = "full") {
    if (from === "live") {
      if (this.enabled || !this.light) return;
      this.inTest = true;
      this.k++;
      this.scen = null;
      this.prog = null;
      if (this.file) this.openLight();
      await showBanner(this.page, this.file, this.k);
      return;
    }
    if (!this.enabled) return;
    await this.pull();
    if (this.k === 0 && this.dir) this.summary();
    this.inTest = true;
    this.k++;
    this.scen = null;
    this.prog = null;
    this.open();
    await showBanner(this.page, this.file, this.k);
    await this.page?.js("window.__e2e?.fresh()").catch(() => {});
  }

  /** A test ends (preload's afterEach): its last samples, its graphs, a picture, its summary. */
  async end(from: "full" | "live" = "full") {
    if (from === "live") {
      if (this.enabled || !this.light) return;
      this.inTest = false;
      if (this.file && this.k > 0) {
        this.live.ended(
          this.k,
          fileInfo(this.file).tests[this.k - 1] ?? `test ${this.k}`,
          Math.round((Date.now() - this.wall0) / 100) / 10,
        );
        this.live.write();
        this.sayEnded();
      }
      return;
    }
    this.inTest = false;
    if (!this.enabled || !this.dir) return;
    await this.pull();
    this.live.ended(this.k, fileInfo(this.file).tests[this.k - 1] ?? `test ${this.k}`, Math.round((Date.now() - this.wall0) / 100) / 10);
    this.live.write();
    this.sayEnded();
    const page = this.page;
    if (page) {
      const g = await page.js("window.__e2e?.graphs()").catch(() => null);
      if (g) writeFileSync(join(this.dir, "graphs.json"), JSON.stringify(g));
      const shot = await page.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 72 }, 20).catch(() => null);
      if (shot) writeFileSync(join(this.dir, "shots", "end.jpg"), Buffer.from(shot.data, "base64"));
    }
    this.summary();
  }

  /** The test's end said (lib/emit.ts): its time — its verdict is bun's, in the log, at the same k. */
  private sayEnded() {
    if (!this.file) return;
    this.say("test_ended", { title: fileInfo(this.file).tests[this.k - 1] ?? null, durationMs: Date.now() - this.wall0 });
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
        // (the machine's heat over the test — docs/THERMAL.md; null without the thermal service)
        thermal: thermalWindow(this.wall0, Date.now()),
        // (the Earth data — from the disk, fetched and kept, failed — PLAN-J8 J8-T; null when the network was kept)
        earthData: earthSummary(this.page?.earth),
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
      this.live.drained(d.S, d.F, events);
      // (a picture asked for by a watcher — small, the page's own pixels, the banner with them)
      if (this.live.peekWanted()) {
        const shot = await page.cdp
          .send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 60, optimizeForSpeed: true }, 10)
          .catch(() => null);
        if (shot) this.live.peeked(Buffer.from(shot.data, "base64"));
      }
      this.live.write();
    });
    return this.chain;
  }

  /**
   * The case under way inside the running test (lib/app.ts `app.scenario`): on the banner (its first line the reference Sam
   * quotes — « approach-sample #3/9 · SLCB 05 F-35 · final »), in the live record, the console and the test's report (its moments).
   * Returns the reference, for the captures' names.
   */
  async scenario(label: string | null): Promise<string> {
    this.scen = label;
    this.scenAt = Date.now();
    const ref = bannerRef(this.file, this.k, label);
    console.log(`  ▶ ${ref} · ${hostname().replace(/\.local$/, "")}`);
    this.live.scenario(label);
    if (!this.inStep) this.say("scenario", { label, ref });
    if (label) this.live.note("scenario", label);
    this.live.write();
    if (this.enabled && this.dir)
      appendFileSync(
        join(this.dir, "events.jsonl"),
        `${JSON.stringify({ t: null, kind: "scenario", text: ref, wall: Date.now() - this.wall0 })}\n`,
      );
    await showBanner(this.page, this.file, this.k, label, this.prog);
    return ref;
  }

  /** The test's steps in order (lib/app.ts `app.steps`): « Étape k/n » on the banner from the first `step`. */
  steps(list: string[]) {
    this.prog = { ...NO_PROGRESS, steps: [...list], done: [], estimateS: this.prog?.estimateS ?? null };
    this.say("step_declared", { total: list.length, names: [...list] });
  }

  /** A declared step begins (lib/app.ts `app.step`; a name not declared is added at the end): said as a scenario — the banner, the
   *  live record and its events, the console, the report —, its progress cleared. */
  async step(name: string): Promise<string> {
    this.prog ??= { ...NO_PROGRESS };
    let i = this.prog.steps.indexOf(name, Math.max(0, this.prog.at));
    if (i < 0) i = this.prog.steps.indexOf(name);
    if (i < 0) i = this.prog.steps.push(name) - 1;
    this.prog.at = i;
    this.prog.progress = null;
    this.prog.stepAt = this.prog.saidAt = Date.now();
    this.prog.auto = null;
    this.say("step_started", { index: i + 1, total: this.prog.steps.length, name });
    this.inStep = true;
    try {
      return await this.scenario(`Étape ${i + 1}/${this.prog.steps.length} · ${name}`);
    } finally {
      this.inStep = false;
    }
  }

  /** A step ended, with its result (« zone 15,1 min », a failure kept shown): the banner's last ones, a live event. */
  async stepDone(text: string, ok = true): Promise<void> {
    this.prog ??= { ...NO_PROGRESS };
    this.prog.done.push({ text, ok });
    this.say("step_ended", { index: this.prog.at >= 0 ? this.prog.at + 1 : null, ok, text });
    this.live.note(ok ? "step" : "step-failed", text);
    this.live.write();
    await showBanner(this.page, this.file, this.k, this.scen, this.prog);
  }

  /**
   * A step's progress (lib/app.ts `app.progress` — the analysis session for Sam, 17 Nov 2026: j8-a's 22 min of zone and rest showed
   * nothing but its title): a count against its total, refreshed at least every 10 s, and the live values the test judges — on the
   * banner and in the live record (its case's words); no moment in the report or the live events (the step said them once).
   */
  async progress(text: string, values?: string): Promise<void> {
    this.prog ??= { ...NO_PROGRESS };
    this.prog.progress = text;
    this.prog.saidAt = Date.now();
    this.prog.auto = null;
    if (values !== undefined) this.prog.values = values;
    this.say("progress", { index: this.prog.at >= 0 ? this.prog.at + 1 : null, text, values: values ?? null });
    const step = this.prog.at >= 0 ? `Étape ${this.prog.at + 1}/${this.prog.steps.length} · ${this.prog.steps[this.prog.at]}` : null;
    this.live.scenario(step ? `${step} — ${text}` : text);
    this.live.write();
    await showBanner(this.page, this.file, this.k, this.scen, this.prog);
  }

  /**
   * A harness wait still running (lib/app.ts waitFor, waitProgress): when the test has said nothing for 10 s, the harness's own count
   * on the banner (« en attente · <what> · 23 / 90 s ») and in the live record — the rule « no wait over 10 s without a count » kept
   * for every e2e, the ones not yet brought to the steps too (the approaches session's idea, 17 Nov 2026). `null`: the wait over,
   * its count taken off.
   */
  async waiting(text: string | null): Promise<void> {
    if (text !== null) {
      const said = this.prog?.saidAt ?? this.scenAt;
      if (Date.now() - said < 10_000) return;
      this.prog ??= { ...NO_PROGRESS, done: [] };
      if (this.prog.auto === text) return;
      this.prog.auto = text;
    } else {
      if (!this.prog?.auto) return;
      this.prog.auto = null;
    }
    this.say("waiting", { text });
    const step = this.prog.at >= 0 ? `Étape ${this.prog.at + 1}/${this.prog.steps.length} · ${this.prog.steps[this.prog.at]}` : this.scen;
    this.live.scenario([step, this.prog.progress, this.prog.auto && `en attente · ${this.prog.auto}`].filter(Boolean).join(" — "));
    this.live.write();
    await showBanner(this.page, this.file, this.k, this.scen, this.prog);
  }

  /** The file's whole time estimated by the test [s] (lib/app.ts `app.estimate`): the banner's and the live record's estimate. */
  estimate(s: number) {
    this.prog ??= { ...NO_PROGRESS };
    this.prog.estimateS = Math.round(s);
    this.say("estimate", { seconds: Math.round(s) });
    this.live.estimate(s);
    this.live.write();
  }

  /** The reference of the run now (the file, the test, the case said): the words of the banner's first line. */
  ref(): string {
    return this.file ? bannerRef(this.file, this.k, this.scen) : "";
  }

  /** A picture written by the test (lib/app.ts `app.shot`), said with the reference of the run (lib/emit.ts). */
  shot(file: string) {
    this.say("shot", { path: resolve(file), ref: this.ref() });
  }

  /** The process ends: the last record closed (a file whose last test had no afterEach, a crash). */
  async close(from: "full" | "live" = "full") {
    if (from === "live" && (this.enabled || !this.light)) return;
    if (this.timer) clearInterval(this.timer);
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.timer = this.liveTimer = null;
    if (this.enabled && this.dir && existsSync(this.dir)) this.summary();
    this.live.remove();
  }
}

export const recorder = new Recorder();
