// What the graphics settings cost the GPU (PLAN-TITRE-AAA E9b), measured by scripts/settings-cost.ts — written by
// it (--ts, or --from a measure kept), not by hand. For each setting its worst view: the whole frame's GPU time with
// its light value and with its heavy one, at the Kerr Bench's fixed frame (~1.44 Mpx, subsampling 4, the clock held), on kerr-mini (Apple M1, 8 GPU cores), 2026-10-20.
// A setting not here was not measured, or not reliably: the player's screen shows no cost for it.
// Set aside (the heavy value cheaper beyond the noise, unexplained): earthTerrain (Cévennes: 122.97 → 35.39 ms); earthScenery (Cévennes: 86.42 → 36.02 ms); earthGrass (Cévennes: 81.39 → 35.16 ms).
// Not published at all: earthTerrain, earthGrass.

import type { Settings } from "../../settings";

export interface SettingCost {
  /** the view where it costs the most */
  view: string;
  /** the values compared */
  light: number | boolean | string;
  heavy: number | boolean | string;
  /** the whole frame's GPU time with each [ms] */
  lightMs: number;
  heavyMs: number;
  /** the difference's noise: twice its standard error over the repetitions [ms] */
  noise: number;
}

export const COSTS_MEASURED = {
  date: "2026-10-20",
  machine: "kerr-mini (Apple M1, 8 GPU cores)",
  frame: "~1.44 Mpx, subsampling 4, the clock held",
};

export const SETTING_COSTS: Partial<Record<keyof Settings, SettingCost>> = {
  earthSurface: { view: "Cévennes", light: "off", heavy: "materials", lightMs: 34.98, heavyMs: 35.22, noise: 0.29 },
  detailReach: { view: "Cévennes", light: "normal", heavy: "veryFar", lightMs: 35.34, heavyMs: 37.22, noise: 0.24 },
  earthSceneryShadows: { view: "Cévennes", light: false, heavy: true, lightMs: 32.08, heavyMs: 35.1, noise: 0.15 },
  earthGrassDensity: { view: "Cévennes", light: 0.25, heavy: 1, lightMs: 35.34, heavyMs: 35.16, noise: 0.21 },
  volumetricClouds: { view: "Cévennes", light: false, heavy: true, lightMs: 35.19, heavyMs: 35.3, noise: 0.27 },
  earthClouds: { view: "Reine", light: 0, heavy: 1, lightMs: 97.52, heavyMs: 99.58, noise: 0.68 },
  refraction: { view: "Cévennes", light: false, heavy: true, lightMs: 35.26, heavyMs: 35.36, noise: 0.29 },
  pixelRatio: { view: "Reine", light: 0.75, heavy: 1.25, lightMs: 50.23, heavyMs: 163.06, noise: 1.36 },
  bloom: { view: "Cévennes", light: 0, heavy: 0.5, lightMs: 33.18, heavyMs: 35.26, noise: 0.6 },
  lensFlare: { view: "Cévennes", light: 0, heavy: 1, lightMs: 35.2, heavyMs: 35.57, noise: 0.24 },
  sharpen: { view: "Reine", light: 0, heavy: 1, lightMs: 97.43, heavyMs: 98.01, noise: 0.49 },
  motionBlur: { view: "Reine", light: 0, heavy: 1, lightMs: 96.18, heavyMs: 98.4, noise: 0.73 },
  temporalReprojection: { view: "Gargantua", light: false, heavy: true, lightMs: 84.22, heavyMs: 117.47, noise: 7.6 },
  seaFft: { view: "Reine", light: false, heavy: true, lightMs: 95.84, heavyMs: 97.13, noise: 1.12 },
  earthScenery: { view: "Reine", light: "off", heavy: "high", lightMs: 90.22, heavyMs: 113.6, noise: 1.12 },
};
