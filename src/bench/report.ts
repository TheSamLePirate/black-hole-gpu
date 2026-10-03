// The Kerr Bench's report (kerr-bench/1): what a run measured, on what machine — the JSON a friend sends
// back. No personal data: an anonymous run id, the machine's label only if typed. The Kerr Score, the
// quality it recommends; the report checked when it is read back (to compare two runs).

export const SCHEMA = "kerr-bench/1";

export type BenchMode = "quick" | "standard" | "complete";

export interface FrameStats {
  /** frames finished per second, their intervals' percentiles [ms], frames over 33 ms */
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  over33: number;
}

/** A realtime subsampling, as the setting has it: the automatic choice, or one ray per N×N pixels. */
export type Subsampling = "auto" | 1 | 2 | 3 | 4 | 6 | 8;

/** The subsampling sweep's settings, in order (the complete run's, the script's default). */
export const SUBSAMPLINGS: Subsampling[] = ["auto", 1, 2, 3, 4, 6, 8];

/** The frame intervals' buckets [ms]: up to 120, 60, 30, 20, 10 fps, and slower. */
export const HISTOGRAM_EDGES = [8.4, 16.7, 33.4, 50, 100];

/**
 * One subsampling measured on a scene (the sweep): the frame rate and its spread, the GPU's time per
 * frame and per pass, the rays; with the automatic one, the blocks it chose and the render scales the
 * dynamic resolution took. The manual ones at the Game quality's pixel ratio, the dynamic resolution off.
 */
export interface SubsamplingPoint extends FrameStats {
  subsampling: Subsampling;
  dynamicResolution: boolean;
  /** frames measured over the window */
  frames: number;
  windowMs: number;
  /** the frame intervals by bucket: "≤8.4", "≤16.7", "≤33.4", "≤50", "≤100", ">100" [frames] */
  histogram: Record<string, number>;
  /** the GPU's time per frame, from its start to its completion [ms] (mean, p50, p95, max) */
  gpuMs: { mean: number; p50: number; p95: number; max: number };
  /** the timestamps' sum over a profiled frame's passes [ms] (null: no timestamps here) */
  gpuPassesMs: number | null;
  gpuPasses: { pass: string; ms: number }[];
  mraysPerS: number;
  /** rays traced per frame [M] and per displayed pixel */
  mraysPerFrame: number;
  raysPerPx: number;
  /** the subsampling each frame was drawn with, the render scale [frames] */
  blocks: Record<string, number>;
  scales: Record<string, number>;
  /** the canvas [px] at the end of the window, the pixel ratio asked */
  width: number;
  height: number;
  pixelRatio: number;
  /** the image in motion at this setting (the script's capture: a path in the report's folder) */
  shot?: string | null;
}

export interface SceneReport {
  scene: string;
  status: "ok" | "timeout" | "error" | "skipped";
  error?: string;
  /** the scene's specialised tracer: how long it took to compile here [ms] (0: none needed) */
  compileMs: number;
  /** the scene's assets (maps, tiles) waited for before measuring [ms] */
  assetsMs: number;
  /** A: the Game quality as a player has it (automatic subsampling, dynamic resolution) */
  auto?: FrameStats & { raysPerPx: number; mraysPerS: number; blocks: Record<string, number>; scales: Record<string, number> };
  /** B: a fixed setting (subsampling 4, the image ~1.44 Mpx) — the figure comparable between machines */
  fixed?: FrameStats & { mraysPerS: number; width: number; height: number };
  /** the GPU passes [ms] (where timestamps exist), the main thread's sections [ms] */
  gpuPasses: { pass: string; ms: number }[];
  cpu: { label: string; ms: number; max: number }[];
  worstLoopMs: number;
  longTasks: number;
  vramMiB: number | null;
  errors: string[];
  /** the subsampling sweep (the complete run, the script) */
  subsampling?: SubsamplingPoint[];
  /** the image still, converged to full resolution (the script's capture) and how long it took [ms] */
  still?: { shot: string | null; convergeMs: number; spp: number } | null;
}

export interface QualityPoint {
  scene: string;
  quality: string;
  fps: number;
  p95: number;
  raysPerPx: number;
}

export interface BenchReport {
  schema: typeof SCHEMA;
  runId: string;
  app: { version: string; date: string; mode: BenchMode; url: string };
  machineLabel: string;
  system: {
    gpu: { vendor: string; architecture: string; device: string; description: string; fallback: boolean };
    features: string[];
    limits: Record<string, number>;
    browser: { ua: string; brands: string[]; platform: string; mobile: boolean };
    screen: { css: [number, number]; dpr: number; gamut: string; hdr: boolean };
    cpuThreads: number;
    deviceMemoryGB: number | null;
    tier: { guessed: number; label: string; measured: number | null };
  };
  load: { firstImageMs: number | null; stages: { id: string; label: string; ms: number }[] };
  scenes: SceneReport[];
  quality: QualityPoint[];
  /** the run's own settings: the viewport, the timings, the subsamplings swept */
  run?: { viewport: [number, number, number]; subsamplings: Subsampling[]; sweepWarmMs: number; sweepMs: number; shots: boolean };
  thermal: { scene: string; firstMraysPerS: number; lastMraysPerS: number; driftPct: number } | null;
  peakVramMiB: number | null;
  errors: { gpu: number; caught: Record<string, number>; deviceLost: string | null };
  score: { kerrScore: number | null; reference: string; recommendedQuality: string | null };
  durationS: number;
}

/**
 * The reference machine's fixed-setting throughput per scene [Mrays/s] (Apple M1 Max, Chrome, a standard
 * run on 2026-10-03): the Kerr Score is 1000 times the geometric mean of a run's ratios to these.
 */
export const REFERENCE: { label: string; mraysPerS: Record<string, number> } = {
  label: "Apple M1 Max, Chrome (2026-10) = 1000",
  mraysPerS: {
    "game:artemis": 5.3,
    "Ranger: approaching Gargantua": 5.35,
    "Interstellar: along the disk (the film's close pass)": 2.16,
    "Saturn: backlit": 1.67,
    "Kerr a=0.94, near edge-on": 4.92,
    "Interstellar: wormhole to Gargantua": 3.81,
    "Moon: an afternoon on the plains": 3.96,
    "Miller: Gargantua over the sea": 1.57,
  },
};

/** The Kerr Score: 1000 × the geometric mean of the fixed throughputs over the reference's (null: no scene in common). */
export function kerrScore(scenes: SceneReport[], ref = REFERENCE.mraysPerS): number | null {
  const r = scenes.filter((s) => s.status === "ok" && s.fixed && ref[s.scene]).map((s) => s.fixed!.mraysPerS / ref[s.scene]!);
  if (!r.length) return null;
  return Math.round(1000 * Math.exp(r.reduce((a, x) => a + Math.log(Math.max(x, 1e-9)), 0) / r.length));
}

/** The hardware tier the score measures (0 software … 4 high-end), and the quality it recommends. */
export function tierOfScore(score: number | null): { tier: number | null; quality: string | null } {
  if (score === null) return { tier: null, quality: null };
  const tier = score >= 1500 ? 4 : score >= 800 ? 3 : score >= 400 ? 2 : score >= 150 ? 1 : 0;
  return { tier, quality: ["low", "medium", "game", "high", "ultra"][tier]! };
}

/** Frame intervals by bucket (HISTOGRAM_EDGES). */
export function histogram(intervals: number[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(
    [...HISTOGRAM_EDGES.map((e) => `≤${e}`), `>${HISTOGRAM_EDGES.at(-1)}`].map((k) => [k, 0]),
  );
  for (const x of intervals) {
    const e = HISTOGRAM_EDGES.find((e) => x <= e);
    out[e === undefined ? `>${HISTOGRAM_EDGES.at(-1)}` : `≤${e}`]!++;
  }
  return out;
}

/** Mean, median, 95th percentile and maximum of samples. */
export function spread(xs: number[]) {
  const v = [...xs].sort((a, b) => a - b);
  const r = (x: number) => +x.toFixed(2);
  if (!v.length) return { mean: 0, p50: 0, p95: 0, max: 0 };
  return {
    mean: r(v.reduce((a, x) => a + x, 0) / v.length),
    p50: r(v[Math.floor(0.5 * v.length)]!),
    p95: r(v[Math.min(v.length - 1, Math.floor(0.95 * v.length))]!),
    max: r(v.at(-1)!),
  };
}

/** Percentiles of frame intervals [ms]. */
export function frameStats(intervals: number[], spanMs: number): FrameStats {
  const iv = [...intervals].sort((a, b) => a - b);
  const q = (f: number) => (iv.length ? +iv[Math.min(iv.length - 1, Math.floor(f * iv.length))]!.toFixed(2) : Number.NaN);
  return {
    fps: +((iv.length * 1000) / Math.max(spanMs, 1)).toFixed(1),
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    over33: iv.filter((x) => x > 33.4).length,
  };
}

/** A report read back (a file dropped to compare): checked enough to be shown. */
export function checkReport(x: unknown): BenchReport {
  const r = x as BenchReport;
  if (!r || typeof r !== "object" || r.schema !== SCHEMA) throw new Error("not a Kerr Bench report (kerr-bench/1)");
  if (!Array.isArray(r.scenes) || !r.system?.gpu) throw new Error("an incomplete report");
  return r;
}

/** The report's file name: kerr-bench-<gpu>-<date>.json */
export function reportFileName(r: BenchReport) {
  const gpu = (r.machineLabel || r.system.gpu.description || r.system.gpu.vendor || "gpu").replace(/[^\w.-]+/g, "-").slice(0, 40);
  return `kerr-bench-${gpu}-${r.app.date.slice(0, 10)}.json`;
}
