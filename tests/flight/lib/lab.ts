// The flight lab: a scenario flown in the real app (tests/e2e/lib/app.ts — a production server, Chrome over
// the DevTools protocol), watched as it goes. Its telemetry sampled (the craft, the autopilot, the hub's card,
// the entry, the docking, the warp — `window.__lab.sample()`), the pilot's messages and the game's log kept,
// a screenshot at every change of phase (the autopilot, the hub's card, the entry's phase…) and at the end,
// and the flight driven in either of two ways:
//   - fixed steps (`fixed`): the page frozen, the simulation stepped by 1/30 s from here, in chunks of a few
//     seconds — fast (a step renders nothing), the same from run to run; the warp the autopilots ask for
//     still applies (a step's simulated time is its dt times the warp);
//   - live (`live`): the page's own frame loop, as a player sees it — the touchdown, the docking, the
//     crossing — sampled every second of wall time.
// Every chunk ends at a predicate (`until`, page-side JS over the latest sample `T`), a failure (the craft
// lost, a crash said, the page's errors, the simulation stuck) or a cap (simulated or wall time).
//
// The campaign around it: scripts/flightlab.ts (the scenarios: tests/flight/scenarios.ts; the guide:
// docs/FLIGHTLAB.md).
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { App } from "../../e2e/lib/app";
import { LAB_PAGE as PAGE } from "./sampler";

export type { Sample } from "./sampler";
import type { Sample } from "./sampler";

export interface Event {
  t: number;
  kind: string;
  text: string;
}

export interface ChunkEnd {
  /** why the phase ended: the predicate met, a failure, a cap */
  end: "until" | "fail" | "cap" | "stuck" | "skip" | "abort";
  why: string;
  T: Sample;
}

export interface LabOptions {
  /** where this scenario writes (telemetry.jsonl, events.jsonl, shots/) */
  dir: string;
  /** the boot: a scene's hash, the terrain tiles (off: a tile streamed mid-approach changes the ground) */
  hash?: string;
  tiles?: boolean;
  /** told of each sample (the campaign's live status) */
  onSample?(T: Sample): void;
  /** told of each event (a message, a phase change, a shot) */
  onEvent?(e: Event): void;
  /** the campaign's controls, asked between chunks */
  control?(): "run" | "pause" | "skip" | "abort";
}

/** The keys whose change is a moment worth a picture. */
const MOMENTS: [string, (T: Sample) => unknown][] = [
  ["auto", (T) => T.auto],
  ["hub", (T) => T.hub?.title],
  ["entry", (T) => T.entry?.ph],
  ["profile", (T) => T.entry?.prof],
  ["dock", (T) => T.dock],
  ["label", (T) => T.label],
  ["side", (T) => T.side],
  ["soi", (T) => T.soi],
  ["mission", (T) => T.mission],
  ["landed", (T) => T.landed],
  ["docked", (T) => T.docked],
];

export class Lab {
  app!: App;
  T: Sample = {};
  events: Event[] = [];
  shots: string[] = [];
  /** the moments' last values (a change: an event and a shot) */
  private seen = new Map<string, unknown>();
  private shotBudget = 40;
  private said = new Set<string>();
  private logIndex = 0;
  private wall0 = Date.now();

  private constructor(readonly o: LabOptions) {}

  static async open(o: LabOptions) {
    const lab = new Lab(o);
    mkdirSync(`${o.dir}/shots`, { recursive: true });
    lab.app = await App.boot({ hash: o.hash ?? "scene=game:artemis", tiles: o.tiles });
    await lab.app.waitFor("typeof __bh !== 'undefined' && __bh.camera", 60_000);
    await lab.app.js(PAGE);
    return lab;
  }

  close() {
    this.app?.close();
  }

  /** page-side JS (an expression; async allowed) */
  // biome-ignore lint/suspicious/noExplicitAny: what the page returns
  js<T = any>(expr: string) {
    return this.app.js<T>(expr);
  }

  /** The sampler installed again (after a reload, a new page). */
  async rearm() {
    await this.app.js(PAGE);
  }

  note(kind: string, text: string, t = this.T.t ?? 0) {
    const e = { t, kind, text };
    this.events.push(e);
    appendFileSync(`${this.o.dir}/events.jsonl`, `${JSON.stringify({ ...e, wall: Date.now() - this.wall0 })}\n`);
    this.o.onEvent?.(e);
  }

  /** A picture now: one frame drawn first (frozen or not, the page renders its state each frame). */
  async shot(label: string, force = false): Promise<string | null> {
    if (!force && this.shotBudget <= 0) return null;
    this.shotBudget--;
    await this.app.js("new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(true))))").catch(() => {});
    const n = String(this.shots.length + 1).padStart(2, "0");
    const file = `${this.o.dir}/shots/${n}-${label.replace(/[^a-z0-9.=-]+/gi, "_").slice(0, 60)}.png`;
    await this.app.shot(file);
    // (LAB_STATES=1: the game saved beside each picture — scripts/hud-gallery.ts reloads it to picture the
    // HUD again in the very same state, before and after a change)
    if (process.env.LAB_STATES)
      await this.app
        .js<string>("JSON.stringify(__bh.game.snapshot('lab'))")
        .then((json) => Bun.write(file.replace(/\.png$/, ".save.json"), json))
        .catch(() => {});
    this.shots.push(file);
    this.note("shot", file.slice(this.o.dir.length + 1));
    return file;
  }

  /** The PNG of the page now, not kept (the campaign's `shot` on demand keeps its own). */
  async png(): Promise<Uint8Array> {
    await this.app.js("new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(true))))").catch(() => {});
    const r = await this.app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
    return Buffer.from(r.data, "base64");
  }

  /** A sample taken, its moments compared, the messages and log collected. */
  private async take(): Promise<Sample> {
    const r = await this.app.js<{ T: Sample; msgs: { t: number; text: string }[]; log: { kind: string; text: string }[] }>(`(() => {
      const L = window.__lab, T = L.sample(), msgs = L.msgs.splice(0);
      const ev = __bh.game.log.events, log = ev.slice(${this.logIndex}).map((e) => ({ kind: e.kind, text: e.text }));
      return { T, msgs, log, n: ev.length };
    })()`);
    return this.absorb(r.T, r.msgs, r.log);
  }

  private async absorb(T: Sample, msgs: { t: number; text: string }[], log: { kind: string; text: string }[]) {
    this.T = T;
    this.logIndex += log.length;
    appendFileSync(`${this.o.dir}/telemetry.jsonl`, `${JSON.stringify(T)}\n`);
    for (const m of msgs) {
      this.note("pilot", m.text, m.t);
      this.said.add(m.text);
    }
    // (the log repeats the pilot's messages as "info": kept once)
    for (const l of log) if (l.kind !== "pilot" && !(l.kind === "info" && this.said.has(l.text))) this.note(`log:${l.kind}`, l.text);
    for (const err of this.app.cdp.errors.splice(0)) this.note("page-error", err);
    this.o.onSample?.(T);
    for (const [k, f] of MOMENTS) {
      const v = f(T);
      if (this.seen.has(k) && this.seen.get(k) !== v) {
        this.note("phase", `${k}: ${String(this.seen.get(k))} → ${String(v)}`);
        await this.shot(`${k}-${String(v)}`);
      }
      this.seen.set(k, v);
    }
    return T;
  }

  /** The failures every flight shares: the craft lost, a crash, the page's errors, the state gone NaN. */
  failure(T: Sample = this.T): string | null {
    if (T.air?.fail) return `craft lost: ${T.air.fail}`;
    const crash = this.events.find((e) => e.kind === "pilot" && /crash|broke up|bounced off|destroyed/i.test(e.text));
    if (crash) return `pilot: ${crash.text}`;
    const err = this.events.find((e) => e.kind === "page-error");
    if (err) return `page error: ${err.text.slice(0, 200)}`;
    if (T.side !== "throat" && T.alt !== null && typeof T.alt === "number" && !Number.isFinite(T.alt)) return "altitude not finite";
    if (typeof T.v === "number" && !Number.isFinite(T.v)) return "speed not finite";
    return null;
  }

  /**
   * Fixed steps of `dt` (1/30 s of wall time each, the warp applying) until `until` (page JS over `T`, the
   * latest sample, and `c` the camera), a failure, or a cap: `maxSim` simulated seconds, `maxWall` seconds
   * here. Sampled every `every` steps; a chunk is `chunk` steps (one page call each).
   */
  async fixed(o: {
    until: string;
    maxSim?: number;
    maxWall?: number;
    dt?: number;
    every?: number;
    chunk?: number;
    fail?: string;
  }): Promise<ChunkEnd> {
    const dt = o.dt ?? 1 / 30,
      every = o.every ?? 30,
      chunk = o.chunk ?? 150;
    const wallEnd = Date.now() + (o.maxWall ?? 600) * 1000;
    await this.app.js("(__bh.freeze(true), true)");
    const t0 = (await this.take()).t;
    let lastT = t0,
      still = 0;
    for (;;) {
      const ctl = await this.gate();
      if (ctl) return this.end(ctl, ctl);
      const r = await this.app.js<{
        samples: Sample[];
        met: boolean;
        failed: string | null;
        waited: boolean;
        msgs: { t: number; text: string }[];
        log: { kind: string; text: string }[];
      }>(`(() => {
        const L = window.__lab, c = __bh.camera, samples = [];
        let T = L.sample(), met = false, failed = null, waited = false;
        for (let k = 1; k <= ${chunk}; k++) {
          __bh.step(${dt});
          if (k % ${every} === 0 || k === ${chunk}) { T = L.sample(); samples.push(T); }
          else T = null;
          const S = T ?? L.sample();
          if (S.air && S.air.fail) { failed = "craft lost: " + S.air.fail; if (!T) samples.push(S); break; }
          ${o.fail ? `if (((T) => (${o.fail}))(S)) { failed = "scenario: " + ${JSON.stringify(o.fail)}; if (!T) samples.push(S); break; }` : ""}
          if (${o.until.includes("T.") || o.until.includes("c.") ? `((T) => (${o.until}))(S)` : o.until}) { met = true; if (!T) samples.push(S); break; }
          if (L.waiting()) { waited = true; if (!T) samples.push(S); break; }
        }
        const ev = __bh.game.log.events, log = ev.slice(${this.logIndex}).map((e) => ({ kind: e.kind, text: e.text }));
        return { samples, met, failed, waited, msgs: L.msgs.splice(0), log };
      })()`);
      // (the worker answering: a frame's wall time per step until it has)
      if (r.waited) await Bun.sleep(1000 / 30);
      // (every sample written; the messages and the moments with the last)
      for (let k = 0; k < r.samples.length - 1; k++) appendFileSync(`${this.o.dir}/telemetry.jsonl`, `${JSON.stringify(r.samples[k])}\n`);
      const T = await this.absorb(r.samples[r.samples.length - 1]!, r.msgs, r.log);
      const f = r.failed ?? this.failure(T);
      if (f) return this.end("fail", f);
      if (r.met) return this.end("until", o.until);
      if (T.t - t0 > (o.maxSim ?? Infinity)) return this.end("cap", `simulated ${Math.round(T.t - t0)} s`);
      if (Date.now() > wallEnd) return this.end("cap", `wall ${o.maxWall ?? 600} s`);
      still = T.t === lastT ? still + 1 : 0;
      lastT = T.t;
      if (still >= 5) return this.end("stuck", "the simulated time no longer moves");
    }
  }

  /** The page's own loop until `until`, a failure or `maxWall` seconds — sampled every `everyMs`. */
  async live(o: { until: string; maxWall?: number; everyMs?: number; fail?: string }): Promise<ChunkEnd> {
    const wallEnd = Date.now() + (o.maxWall ?? 600) * 1000;
    await this.app.js("(__bh.freeze(false), __bh.settings.animate = true, true)");
    let lastT = Number.NaN,
      still = 0;
    for (;;) {
      const ctl = await this.gate();
      if (ctl) return this.end(ctl, ctl);
      await Bun.sleep(o.everyMs ?? 1000);
      const T = await this.take();
      const met = await this.app.js<boolean>(`((T, c) => !!(${o.until}))(window.__lab.sample(), __bh.camera)`);
      const f =
        this.failure(T) ??
        (o.fail && (await this.app.js<boolean>(`((T, c) => !!(${o.fail}))(window.__lab.sample(), __bh.camera)`))
          ? `scenario: ${o.fail}`
          : null);
      if (f) return this.end("fail", f);
      if (met) return this.end("until", o.until);
      if (Date.now() > wallEnd) return this.end("cap", `wall ${o.maxWall ?? 600} s`);
      still = T.t === lastT ? still + 1 : 0;
      lastT = T.t;
      if (still >= 20 && !T.landed && !T.docked) return this.end("stuck", "the simulated time no longer moves");
    }
  }

  /** The campaign's controls between chunks: paused here until resumed; skip and abort end the phase. */
  private async gate(): Promise<"skip" | "abort" | null> {
    for (;;) {
      const c = this.o.control?.() ?? "run";
      if (c === "skip" || c === "abort") return c;
      if (c === "run") return null;
      await Bun.sleep(500);
    }
  }

  private async end(end: ChunkEnd["end"], why: string): Promise<ChunkEnd> {
    this.note("end", `${end}: ${why}`);
    if (end !== "until") await this.shot(`end-${end}`, true);
    return { end, why, T: this.T };
  }

  /** The summary of the flight so far, for the report. */
  digest() {
    return {
      events: this.events
        .filter((e) => e.kind === "pilot" || e.kind === "phase" || e.kind.startsWith("log:"))
        .map((e) => `${Math.round(e.t)}s ${e.kind} ${e.text}`),
      shots: this.shots,
      last: this.T,
    };
  }

  /** The assistants' graphs as last seen (corridor, optimum, flown) and the craft's points on them → graphs.json. */
  async saveGraphs() {
    const g = await this.app.js("({ graphs: window.__lab.graphs, on: window.__lab.onGraph })").catch(() => null);
    if (g) this.write("graphs.json", g);
  }

  write(name: string, data: unknown) {
    writeFileSync(`${this.o.dir}/${name}`, `${JSON.stringify(data, null, 1)}\n`);
  }
}
