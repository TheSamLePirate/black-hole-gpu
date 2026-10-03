// The Kerr Bench's runs: the reference scenes one after another, each measured as a player has it
// (phase A: the Game quality, its automatic subsampling and dynamic resolution) and at a fixed setting
// comparable between machines (phase B: subsampling 4, the image ~1.44 Mpx, its throughput in Mrays/s);
// the first scene again at the end (the machine's heat); in the complete run, the qualities swept and,
// on every scene, the realtime subsampling swept (auto, then one ray per 1×1 … 8×8 pixels: the frame
// rate, the GPU's time per frame and per pass, the rays) — with the script's captures of each setting in
// motion and of the image still (scripts/bench.ts: a JSON and its pictures).
// The measuring logic of scripts/bench.ts, in the app: a friend's browser, the nightly headless run
// and the local A/B all measure the same thing (__bh.bench).

import type { Renderer } from "../renderer";
import { QUALITY, type Quality, type Settings } from "../settings";
import { cpuProf } from "../perf";
import { caughtErrors } from "../debug";
import { gameLog } from "../game/log";
import { loading } from "../loading";
import {
  SCHEMA,
  frameStats,
  kerrScore,
  tierOfScore,
  REFERENCE,
  type BenchMode,
  type BenchReport,
  histogram,
  spread,
  SUBSAMPLINGS,
  type FrameStats,
  type QualityPoint,
  type SceneReport,
  type Subsampling,
  type SubsamplingPoint,
} from "./report";
import { systemInfo } from "./sysinfo";
import { vram } from "./vram";

/** What the benchmark drives (main.ts gives it). */
export interface BenchContext {
  settings: Settings;
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  presets: Record<string, unknown>;
  preset(name: string): void;
  resize(): void;
  refresh(): void;
  touch(): void;
  renderScale(): number;
  gpuPasses(): { pass: string; ms: number }[];
  /** the GPU profiler's means started again (one measure's passes alone), its last frame's sum [ms] */
  resetPasses(): void;
  gpuFrameMs(): number | null;
  /** the last frame drawn: realtime or converging, its samples per pixel */
  lastStats(): { phase: string; spp: number } | null;
  /** when the first image was on screen [performance.now() ms] */
  firstImageAt(): number | null;
  version: string;
}

/** The reference scenes (scripts/bench.ts's): the quick run takes the first four. */
export const BENCH_SCENES = [
  "game:artemis",
  "Ranger: approaching Gargantua",
  "Interstellar: along the disk (the film's close pass)",
  "Saturn: backlit",
  "Kerr a=0.94, near edge-on",
  "Interstellar: wormhole to Gargantua",
  "Moon: an afternoon on the plains",
  "Miller: Gargantua over the sea",
];

/** The fixed setting's image: about this many pixels, whatever the screen [px]. */
const FIXED_PIXELS = 1.44e6;

export interface BenchProgress {
  /** 0…1 */
  frac: number;
  scene: string;
  phase: string;
  fps: number;
}

interface Timing {
  warm: number;
  auto: number;
  fixedWarm: number;
  fixed: number;
}
/** The subsampling sweep's timing per setting: warmed, then measured [ms]. */
const SWEEP_TIMING: Record<BenchMode, { warm: number; ms: number }> = {
  quick: { warm: 1000, ms: 2500 },
  standard: { warm: 1500, ms: 4000 },
  complete: { warm: 2000, ms: 5000 },
};

/** A scene's name as a file's (the captures' folders). */
export const slug = (n: string) =>
  n
    .normalize("NFKD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);

const TIMING: Record<BenchMode, Timing> = {
  quick: { warm: 2500, auto: 4000, fixedWarm: 1500, fixed: 3000 },
  standard: { warm: 4000, auto: 8000, fixedWarm: 2500, fixed: 5000 },
  complete: { warm: 5000, auto: 10000, fixedWarm: 3000, fixed: 6000 },
};

class Cancelled extends Error {}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class KerrBench {
  private cancelled = false;
  /** a run under way (the HUD is not drawn meanwhile) */
  running = false;
  /** the page left the foreground during the scene: the browser slows a hidden page's frames */
  private hiddenSeen = false;
  private progressFn: (p: BenchProgress) => void = () => {};
  private liveFps = 0;

  constructor(private c: BenchContext) {}

  cancel() {
    this.cancelled = true;
  }

  /** A whole run: its report (a partial one, if the GPU was lost or the run cancelled). */
  async run(o: {
    mode: BenchMode;
    machineLabel?: string;
    scenes?: string[];
    onProgress?: (p: BenchProgress) => void;
    /** the realtime subsamplings swept on each scene (default: the complete run's all, else none) */
    subsampling?: Subsampling[];
    /**
     * A capture of the screen as it is now (the script's, over the DevTools protocol): its path, or null.
     * Called with "<scene>/<what>"; the frames keep being drawn as in the measure meanwhile.
     */
    shot?: (name: string) => Promise<string | null>;
  }): Promise<BenchReport> {
    this.cancelled = false;
    this.running = true;
    this.progressFn = o.onProgress ?? (() => {});
    const onVis = () => document.visibilityState !== "visible" && (this.hiddenSeen = true);
    document.addEventListener("visibilitychange", onVis);
    const t0 = performance.now();
    const c = this.c;
    const kept = { ...c.settings };
    const scenes = (o.scenes ?? (o.mode === "quick" ? BENCH_SCENES.slice(0, 4) : BENCH_SCENES)).filter((n) => n in c.presets);
    const T = TIMING[o.mode];
    const sweep = o.mode === "complete" ? scenes.slice(0, 2) : [];
    const subs = o.subsampling ?? (o.mode === "complete" ? SUBSAMPLINGS : []);
    const ST = SWEEP_TIMING[o.mode];
    // (a scene with its subsampling sweep weighs about twice a scene alone)
    const per = subs.length ? 1 + (subs.length * (ST.warm + ST.ms)) / (T.warm + T.auto + T.fixedWarm + T.fixed) : 1;
    const steps = scenes.length * per + 1 + sweep.length * SWEEP.length;
    let done = 0;
    const report = this.emptyReport(o.mode, o.machineLabel ?? "");
    report.run = {
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      subsamplings: subs,
      sweepWarmMs: ST.warm,
      sweepMs: ST.ms,
      shots: !!o.shot,
    };
    try {
      for (const name of scenes) {
        const sr = await this.scene(name, T, (f) => this.progress((done + f) / steps, name));
        report.scenes.push(sr);
        done++;
        if (subs.length && sr.status === "ok") {
          sr.subsampling = [];
          for (const [k, sub] of subs.entries()) {
            this.progress((done + ((per - 1) * k) / subs.length) / steps, name, `subsampling ${sub === "auto" ? "auto" : `${sub}×`}`);
            sr.subsampling.push(await this.subsamplingPoint(name, sub, ST, o.shot));
          }
          sr.still = await this.still(name, o.shot);
        }
        done += per - 1;
      }
      // the machine's heat: the first scene's fixed throughput again
      const first = report.scenes.find((s) => s.status === "ok" && s.fixed);
      if (first) {
        this.progress(done / steps, first.scene, "thermal");
        const again = await this.scene(first.scene, { ...T, auto: 0 }, () => {});
        if (again.fixed) {
          const a = first.fixed!.mraysPerS,
            b = again.fixed.mraysPerS;
          report.thermal = { scene: first.scene, firstMraysPerS: a, lastMraysPerS: b, driftPct: +((100 * (b - a)) / a).toFixed(1) };
        }
      }
      done++;
      for (const name of sweep)
        for (const q of SWEEP) {
          this.progress(done / steps, name, `quality ${q}`);
          report.quality.push(await this.qualityPoint(name, q, T));
          done++;
        }
    } catch (e) {
      if (!(e instanceof Cancelled)) report.errors.deviceLost = c.renderer.lost ?? (e as Error).message;
    } finally {
      this.running = false;
      document.removeEventListener("visibilitychange", onVis);
      Object.assign(c.settings, kept);
      c.resize();
      c.refresh();
    }
    report.peakVramMiB = vram()?.peakMiB ?? null;
    report.errors.gpu = c.renderer.gpuErrors;
    report.errors.caught = caughtErrors();
    const score = kerrScore(report.scenes);
    const t = tierOfScore(score);
    report.score = { kerrScore: score, reference: REFERENCE.label, recommendedQuality: t.quality };
    report.system.tier.measured = t.tier;
    report.durationS = Math.round((performance.now() - t0) / 1000);
    return report;
  }

  /** One scene: its tracer compiled, then phases A and B. */
  async scene(name: string, T: Timing, onFrac: (f: number) => void = () => {}): Promise<SceneReport> {
    const c = this.c;
    const was = this.running;
    this.running = true;
    const out: SceneReport = {
      scene: name,
      status: "ok",
      compileMs: 0,
      assetsMs: 0,
      gpuPasses: [],
      cpu: [],
      worstLoopMs: 0,
      longTasks: 0,
      vramMiB: null,
      errors: [],
    };
    const errs0 = gameLog.events.length;
    this.hiddenSeen = document.visibilityState !== "visible";
    let longTasks = 0;
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver((l) => (longTasks += l.getEntries().length));
      obs.observe({ type: "longtask", buffered: false });
    } catch {
      obs = null;
    }
    try {
      if (!(name in c.presets)) return { ...out, status: "skipped", error: "no such scene" };
      c.preset(name);
      this.game();
      // (the scene's specialised tracer: compiled in the background the first time)
      const tc = performance.now();
      while (!c.renderer.variantReady && performance.now() - tc < 30000) await this.frame();
      out.compileMs = Math.round(performance.now() - tc);
      if (!c.renderer.variantReady) out.errors.push("the specialised tracer did not compile within 30 s");
      // (the scene's maps and tiles in: measured while they stream in, a scene reads slow)
      const ta = performance.now();
      while (loading.pending.length && performance.now() - ta < 45000) await this.frame();
      out.assetsMs = Math.round(performance.now() - ta);
      if (loading.pending.length) out.errors.push(`assets still loading after 45 s: ${loading.pending.map((s) => s.label).join(", ")}`);
      await this.hold(T.warm, (f) => onFrac(0.3 * f));
      if (T.auto > 0) {
        out.auto = await this.window(T.auto, (f) => onFrac(0.3 + 0.35 * f), "A");
        out.gpuPasses = c.gpuPasses().slice(0, 10);
        out.cpu = cpuProf
          .table()
          .slice(0, 10)
          .map((s) => ({ label: s.label, ms: +s.ms.toFixed(2), max: +s.max.toFixed(2) }));
        out.worstLoopMs = +cpuProf.worstLoop.toFixed(1);
      }
      this.fixed();
      // (the dynamic resolution's scale back to 1 — the governor's next turn —, then warm)
      const ts = performance.now();
      while (c.renderScale() !== 1 && performance.now() - ts < 5000) await this.frame();
      await this.hold(T.fixedWarm, (f) => onFrac(0.65 + 0.1 * f));
      const f = await this.window(T.fixed, (x) => onFrac(0.75 + 0.25 * x), "B");
      out.fixed = { ...this.stats(f), mraysPerS: f.mraysPerS, width: c.canvas.width, height: c.canvas.height };
      out.vramMiB = vram() ? Math.round(vram()!.mib) : null;
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      if (c.renderer.lost) throw e;
      out.status = "error";
      out.error = (e as Error).message;
    } finally {
      obs?.disconnect();
      this.running = was;
    }
    out.longTasks = longTasks;
    if (this.hiddenSeen)
      out.errors.push("the page was not in the foreground: the browser slowed its frames — this scene's figures are low");
    out.errors.push(
      ...gameLog.events
        .slice(errs0)
        .filter((e) => e.kind === "error")
        .map((e) => e.text),
    );
    return out;
  }

  /** A quality level's frame rate on a scene (the complete run's sweep). */
  private async qualityPoint(scene: string, q: Quality, T: Timing): Promise<QualityPoint> {
    const c = this.c;
    c.preset(scene);
    Object.assign(c.settings, QUALITY[q], { quality: q, fpsCap: 0 });
    c.resize();
    c.refresh();
    await this.hold(T.fixedWarm);
    const w = await this.window(T.fixed, () => {}, q);
    return { scene, quality: q, fps: w.fps, p95: w.p95, raysPerPx: w.raysPerPx };
  }

  /**
   * One realtime subsampling on the scene loaded: the Game quality at its pixel ratio, the subsampling
   * set (the automatic one with the dynamic resolution, as in the game; a fixed one without), warmed,
   * measured, then captured in motion.
   */
  async subsamplingPoint(
    scene: string,
    sub: Subsampling,
    S: { warm: number; ms: number },
    shot?: (name: string) => Promise<string | null>,
  ): Promise<SubsamplingPoint> {
    const c = this.c;
    const pixelRatio = Math.min(devicePixelRatio, 1.25);
    Object.assign(c.settings, QUALITY.game, {
      quality: "game",
      realtimeSubsampling: sub,
      dynamicResolution: sub === "auto",
      fpsCap: 0,
      pixelRatio,
      autosave: false,
    });
    c.resize();
    c.refresh();
    // (a fixed subsampling measured at the full scale: the dynamic resolution's last scale undone)
    const ts = performance.now();
    while (sub !== "auto" && c.renderScale() !== 1 && performance.now() - ts < 5000) await this.frame();
    await this.hold(S.warm);
    c.resetPasses();
    const w = await this.window(S.ms, () => {}, sub === "auto" ? "auto" : `${sub}×`);
    const point: SubsamplingPoint = {
      subsampling: sub,
      dynamicResolution: sub === "auto",
      ...this.stats(w),
      frames: w.frames,
      windowMs: Math.round(w.spanMs),
      histogram: histogram(w.intervals),
      gpuMs: spread(w.gpu),
      gpuPassesMs: c.gpuFrameMs(),
      gpuPasses: c.gpuPasses().slice(0, 12),
      mraysPerS: w.mraysPerS,
      mraysPerFrame: +(w.raysPerFrame * 1e-6).toFixed(3),
      raysPerPx: w.raysPerPx,
      blocks: w.blocks,
      scales: w.scales,
      width: c.canvas.width,
      height: c.canvas.height,
      pixelRatio: +pixelRatio.toFixed(3),
    };
    if (shot) point.shot = await this.pose(() => shot(`${slug(scene)}/rt-${sub === "auto" ? "auto" : `x${sub}`}`));
    return point;
  }

  /**
   * The image still: the time held, nothing marked changed — the frames refine it to full resolution
   * (at most 12 s) —, then captured.
   */
  private async still(scene: string, shot?: (name: string) => Promise<string | null>): Promise<SceneReport["still"]> {
    const c = this.c;
    c.settings.animate = false;
    c.refresh();
    const t0 = performance.now();
    while (performance.now() - t0 < 12000) {
      await nextFrame();
      if (this.cancelled) throw new Cancelled();
      if (c.renderer.lost) throw new Error(`the GPU was lost: ${c.renderer.lost}`);
      if (performance.now() - t0 > 300 && c.lastStats()?.phase === "converged") break;
    }
    const convergeMs = Math.round(performance.now() - t0);
    const spp = +(c.lastStats()?.spp ?? 0).toFixed(2);
    return { shot: shot ? await shot(`${slug(scene)}/still`) : null, convergeMs, spp };
  }

  /** While `f` runs (a capture), the frames go on as in the measure (the realtime image, not refined). */
  private async pose<T>(f: () => Promise<T>): Promise<T> {
    let done = false;
    const p = f().finally(() => (done = true));
    while (!done) await this.frame();
    return p;
  }

  /** The Game quality as a player has it. */
  private game() {
    const c = this.c;
    Object.assign(c.settings, QUALITY.game, {
      quality: "game",
      realtimeSubsampling: "auto",
      dynamicResolution: true,
      fpsCap: 0,
      pixelRatio: Math.min(devicePixelRatio, 1.25),
      autosave: false,
    });
    c.resize();
    c.refresh();
  }

  /** The fixed setting: subsampling 4, the image ~1.44 Mpx whatever the screen. */
  private fixed() {
    const c = this.c;
    const area = Math.max(c.canvas.clientWidth * c.canvas.clientHeight, 1);
    Object.assign(c.settings, { realtimeSubsampling: 4, dynamicResolution: false, pixelRatio: Math.sqrt(FIXED_PIXELS / area) });
    c.resize();
    c.refresh();
  }

  private async frame() {
    this.c.touch();
    await nextFrame();
    if (this.cancelled) throw new Cancelled();
    if (this.c.renderer.lost) throw new Error(`the GPU was lost: ${this.c.renderer.lost}`);
  }

  private async hold(ms: number, onFrac: (f: number) => void = () => {}) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await this.frame();
      onFrac((performance.now() - t0) / ms);
    }
  }

  /**
   * A window of frames: every animation frame marks the view changed (the realtime path, as when
   * flying); the intervals between the GPU's completions, the block and scale each was drawn with,
   * the rays traced.
   */
  private async window(ms: number, onFrac: (f: number) => void, phase: string) {
    const c = this.c,
      r = c.renderer;
    const iv: number[] = [];
    const gpu: number[] = [];
    const blocks: Record<string, number> = {},
      scales: Record<string, number> = {};
    let rays = 0,
      raysPx = 0,
      n = 0,
      last = r.lastFrameDoneAt;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await this.frame();
      const d = r.lastFrameDoneAt;
      if (d === last) continue;
      if (last) iv.push(d - last);
      last = d;
      gpu.push(r.lastGpuMs);
      const b = r.realtimeBlockNow,
        sc = c.renderScale();
      blocks[b] = (blocks[b] ?? 0) + 1;
      scales[sc] = (scales[sc] ?? 0) + 1;
      const traced = (c.canvas.width * c.canvas.height) / (b * b);
      rays += traced;
      raysPx += traced / Math.max(c.canvas.clientWidth * c.canvas.clientHeight * devicePixelRatio ** 2, 1);
      n++;
      if (iv.length > 2) {
        const k = iv.slice(-10);
        this.liveFps = (1000 * k.length) / k.reduce((a, x) => a + x, 0);
      }
      onFrac((performance.now() - t0) / ms);
      if (n % 10 === 0) this.progressFn({ ...this.lastProgress, phase, fps: this.liveFps });
    }
    const span = performance.now() - t0;
    return {
      ...frameStats(iv, span),
      raysPerPx: +(raysPx / Math.max(n, 1)).toFixed(4),
      mraysPerS: +((rays / span) * 1e-3).toFixed(2),
      raysPerFrame: rays / Math.max(n, 1),
      blocks,
      scales,
      intervals: iv,
      gpu,
      frames: n,
      spanMs: span,
    };
  }

  private stats(w: FrameStats): FrameStats {
    return { fps: w.fps, p50: w.p50, p95: w.p95, p99: w.p99, over33: w.over33 };
  }

  private lastProgress: BenchProgress = { frac: 0, scene: "", phase: "", fps: 0 };
  private progress(frac: number, scene: string, phase = "") {
    this.lastProgress = { frac, scene, phase, fps: this.liveFps };
    this.progressFn(this.lastProgress);
  }

  private emptyReport(mode: BenchMode, machineLabel: string): BenchReport {
    const c = this.c;
    const first = c.firstImageAt();
    return {
      schema: SCHEMA,
      runId: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
      app: { version: c.version, date: new Date().toISOString(), mode, url: location.origin + location.pathname },
      machineLabel: machineLabel.slice(0, 80),
      system: systemInfo(c.renderer),
      load: {
        firstImageMs: first === null ? null : Math.round(first),
        stages: loading
          .list()
          .filter((s) => s.doneAt !== undefined)
          .map((s) => ({ id: s.id, label: s.label, ms: Math.round(s.doneAt! - s.startedAt) })),
      },
      scenes: [],
      quality: [],
      thermal: null,
      peakVramMiB: null,
      errors: { gpu: 0, caught: {}, deviceLost: null },
      score: { kerrScore: null, reference: REFERENCE.label, recommendedQuality: null },
      durationS: 0,
    };
  }
}

/** The complete run's quality sweep. */
const SWEEP: Quality[] = ["low", "medium", "high", "game", "realtime"];
