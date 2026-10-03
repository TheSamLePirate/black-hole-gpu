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
  thermal: { scene: string; firstMraysPerS: number; lastMraysPerS: number; driftPct: number } | null;
  peakVramMiB: number | null;
  errors: { gpu: number; caught: Record<string, number>; deviceLost: string | null };
  score: { kerrScore: number | null; reference: string; recommendedQuality: string | null };
  durationS: number;
}

/**
 * The reference machine's fixed-setting throughput per scene [Mrays/s] (an Apple M-series laptop,
 * Chrome, 2026-10): the Kerr Score is 1000 times the geometric mean of a run's ratios to these.
 */
export const REFERENCE: { label: string; mraysPerS: Record<string, number> } = {
  label: "Apple M-series laptop, Chrome (2026-10) = 1000",
  mraysPerS: {},
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
