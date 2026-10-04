/** Types du schéma « kerr-bench/1 » (ce qui est réellement exploité par l'outil). */

export interface Pass { pass: string; ms: number }

export interface CpuTask { label: string; ms: number; max: number }

export interface AutoMetrics {
  fps: number; p50: number; p95: number; p99: number;
  over33: number; raysPerPx: number; mraysPerS: number; raysPerFrame: number;
  blocks?: Record<string, number>; scales?: Record<string, number>;
  intervals?: number[]; histogram?: Record<string, number>;
}

export interface FixedMetrics {
  fps: number; p50: number; p95: number; p99: number; over33: number;
  mraysPerS: number; width: number; height: number;
}

export interface Scene {
  scene: string;
  status: string;
  compileMs: number;
  assetsMs: number;
  gpuPasses: Pass[];
  cpu: CpuTask[];
  worstLoopMs: number;
  longTasks: number;
  vramMiB: number;
  errors: any[];
  auto?: AutoMetrics;
  fixed?: FixedMetrics | number; // selon les runs : objet métrique ou valeur brute
  subsampling?: { subsampling: string; dynamicResolution?: boolean; fps: number; p50: number; p95: number; p99: number; over33: number; frames: number; windowMs: number; histogram?: Record<string, number>; gpuMs?: any; gpuPassesMs?: number; gpuPasses?: Pass[] }[];
  still?: { shot: string | null; convergeMs: number; spp: number };
}

export interface QualityPoint { scene: string; quality: string; fps: number; p95: number; raysPerPx: number }

export interface Bench {
  /** id local ajouté par l'outil (nom de fichier) */
  id: string;
  /** couleur locale ajoutée par l'outil */
  color: string;
  schema: string;
  runId: string;
  machineLabel: string;
  app: { version: string; date: string; mode: string; url?: string };
  system: {
    gpu: { vendor: string; architecture: string; device: string; description: string; fallback: boolean };
    features: string[];
    limits: Record<string, number>;
    browser: { ua: string; platform: string; mobile: boolean };
    screen?: { css: number[]; dpr: number; gamut: string; hdr: boolean };
    cpuThreads: number;
    deviceMemoryGB: number | null;
    tier?: { guessed: number; label: string; measured: number };
  };
  load: { firstImageMs: number; stages: { id: string; label: string; ms: number }[] };
  scenes: Scene[];
  quality?: QualityPoint[];
  thermal?: { scene: string; firstMraysPerS: number; lastMraysPerS: number; driftPct: number };
  peakVramMiB: number;
  errors: { gpu: number; caught: Record<string, number>; deviceLost: string | null };
  score: { kerrScore: number; reference: string; recommendedQuality: string };
  durationS: number;
  run: { viewport: number[]; subsamplings: (string | number)[]; sweepWarmMs: number; sweepMs: number; shots: boolean };
}
