// Multiple exposures (PLAN-CIEL C8–C10): a series of offline renders from one fixed camera — a tripod on
// the ground — at the series' moments, each at its own exposure, blended as a photographer blends them:
// the first (the base: the landscape) as it is, the others laid over it by "lighten" (each pixel the
// brightest of them): the Sun's dots of an analemma, an eclipse's phases, the stars' trails. The runner
// only renders and blends; what to render (the moments, the view, the exposures) is the plan's
// (photo/plans.ts).

import type { Preset, Settings } from "../settings";

export interface Exposure {
  /** the scene for this exposure: its date (time [M]), the place and the view (pose), its settings */
  preset: Preset;
  /** its exposure: "auto" (the meter's), or a fixed EV */
  exposure: number | "auto";
  /** base: the image under the others (as it is); lighten: laid over, each pixel the brightest */
  blend: "base" | "lighten";
  /** what it is (the progress line) */
  label: string;
}

export interface MxOptions {
  width: number;
  height: number;
  /** samples per pixel of each exposure (a dark sky's dots need few) */
  spp: number;
  /** the base's own samples (the landscape: more) */
  baseSpp?: number;
}

export interface MxHost {
  settings: Settings;
  /** the scene made from a preset (its date, place, view) */
  apply(p: Preset): void;
  /** the scene's data in (the Earth's maps and tiles near the camera), waited for */
  settle(): Promise<void>;
  /** one exposure rendered offline, then its tone-mapped pixels (RGBA, 8 bits) */
  render(o: { width: number; height: number; spp: number }): Promise<Uint8Array>;
  /** the game as it was before the series, and back */
  snapshot(): unknown;
  restore(s: unknown): void;
  /** the renders running: the live view held */
  active(on: boolean): void;
}

export interface MxProgress {
  done: number;
  total: number;
  label: string;
}

/** A series rendered and blended: the composite (RGBA), its size; stopped early, the blend so far. */
export async function runExposures(
  host: MxHost,
  frames: Exposure[],
  o: MxOptions,
  progress: (p: MxProgress) => void,
  signal: { stop: boolean },
): Promise<{ data: Uint8ClampedArray; width: number; height: number; rendered: number }> {
  const out = new Uint8ClampedArray(o.width * o.height * 4);
  const before = host.snapshot();
  host.active(true);
  let rendered = 0;
  try {
    for (const [i, f] of frames.entries()) {
      if (signal.stop) break;
      progress({ done: i, total: frames.length, label: f.label });
      host.apply({ ...f.preset, animate: false });
      const s = host.settings;
      if (f.exposure === "auto") s.autoExposure = true;
      else {
        s.autoExposure = false;
        s.exposure = f.exposure;
      }
      await host.settle();
      const px = await host.render({ width: o.width, height: o.height, spp: f.blend === "base" ? (o.baseSpp ?? o.spp) : o.spp });
      if (f.blend === "base" || rendered === 0) out.set(px.subarray(0, out.length));
      else
        for (let k = 0; k < out.length; k += 4) {
          // (lighten: each channel the brightest — the alpha kept opaque)
          if (px[k]! > out[k]!) out[k] = px[k]!;
          if (px[k + 1]! > out[k + 1]!) out[k + 1] = px[k + 1]!;
          if (px[k + 2]! > out[k + 2]!) out[k + 2] = px[k + 2]!;
          out[k + 3] = 255;
        }
      rendered++;
    }
    progress({ done: rendered, total: frames.length, label: "" });
  } finally {
    host.active(false);
    host.restore(before);
  }
  return { data: out, width: o.width, height: o.height, rendered };
}
