// The start's gate, before anything heavy is downloaded or compiled: what the browser and the adapter
// say is read against a theoretical minimum — the machine that cannot run the tracer is told why, in
// words, rather than left to a black image or a driver that dies mid-compile; the machine whose last
// start never reached its first image is started lighter (the same crash on every reload otherwise).
// Pure: no browser object is touched here (main.ts reads them), so every case is a unit test.

/** What the tracer needs at the very least: WebGPU's own default limits (every conforming adapter has them). */
export const MINIMUM = {
  maxStorageBuffersPerShaderStage: 8,
  maxStorageBufferBindingSize: 128 * 1024 * 1024,
  maxBufferSize: 256 * 1024 * 1024,
  maxTextureDimension2D: 8192,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupStorageSize: 16384,
} as const;

/**
 * The GPU's work per image [ms] at the very floor — the lowest tier's pixel budget, the smallest scale, the
 * coarsest block, the compiles done — above which the game is not playable (under 10 images a second with
 * nothing left to take away). The governor (main.ts) closes the way in then: measured, not guessed from a name
 * — 10 to 15 images a second at the floor just passes, below it nothing could be done for the machine anyway.
 */
export const TOO_SLOW_MS = 100;
export const tooSlow = (floorMs: number) => Number.isFinite(floorMs) && floorMs > TOO_SLOW_MS;

/** The stages of a start in which the driver compiles shaders: a session that ended in one of them crashed or hung there. */
const COMPILE_STAGES = new Set(["pipeline-creation", "shader-download", "device-request", "canvas-configuration"]);

export interface PreflightInput {
  webgpu: boolean;
  secureContext: boolean;
  /** null: the browser gave no adapter */
  adapter: {
    fallback: boolean;
    limits: Record<string, number>;
  } | null;
  /** the diagnostic of the previous session, if it did not end well (gpu-diagnostics.ts `previous`) */
  previous: { status?: string; stage?: string } | null;
  /** a software adapter accepted anyway (the headless tests, a deliberate choice: #software) */
  allowSoftware?: boolean;
}

export type Verdict =
  | { kind: "refuse"; reasons: string[] }
  | { kind: "run" /** started lighter: the last start did not reach its first image */; safe: boolean; reasons: string[] };

export function preflight(i: PreflightInput): Verdict {
  if (!i.webgpu)
    return {
      kind: "refuse",
      reasons: [
        i.secureContext
          ? "This browser has no WebGPU (or it is switched off)."
          : "WebGPU only works on a secure page: open this site over https:// (or from localhost).",
      ],
    };
  if (!i.adapter)
    return { kind: "refuse", reasons: ["The browser found no graphics adapter for WebGPU (outdated driver, or the GPU is blocked)."] };
  const short = Object.entries(MINIMUM)
    .filter(([key, need]) => (i.adapter!.limits[key] ?? 0) < need)
    .map(([key, need]) => `${key}: ${i.adapter!.limits[key] ?? 0} < ${need}`);
  if (short.length)
    return { kind: "refuse", reasons: [`This graphics card is below the minimum the ray tracer needs (${short.join(", ")}).`] };
  if (i.adapter.fallback && !i.allowSoftware)
    return {
      kind: "refuse",
      reasons: [
        "Only a software renderer is available (no usable GPU): the ray tracer would take minutes per image. Update the graphics driver, or use another browser.",
      ],
    };
  const crashed = !!i.previous && i.previous.status !== "running" && COMPILE_STAGES.has(i.previous.stage ?? "");
  return {
    kind: "run",
    safe: crashed,
    reasons: crashed ? [`The last start stopped while compiling the shaders (${i.previous!.stage}): starting in the lightest mode.`] : [],
  };
}
