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
  /** with the meter's: a compensation [EV] (−: darker) */
  comp?: number;
  /** base: the image under the others (as it is); lighten: laid over, each pixel the brightest */
  blend: "base" | "lighten";
  /** what it is (the progress line) */
  label: string;
  /** lighten: only round a disc of the image [px] (the Sun, the Moon — a filter's frame: its sky left out), softly to `r` */
  mask?: { x: number; y: number; r: number };
  /** the moment it shows [ms UTC] (its disc's mask found by it) */
  ms?: number;
  /** lighten: its light scaled first (a star trail's comet tail: the older frames dimmer) */
  gain?: number;
  /** after it is laid: more drawn from it into the image (a star trail's arcs run on to the next frame) */
  after?: (out: Uint8ClampedArray, px: Uint8Array, W: number, H: number) => void;
  /**
   * a disc's frame taken close — a telephoto's: its own field `fov` [°] on the Sun or the Moon, its own
   * meter (a wide view's would not open for a red Moon) — then laid at its place in the image: its disc of
   * `r` px at (x, y), within `k` radii, softly
   */
  inset?: { x: number; y: number; r: number; k: number; fov: number };
}

/** the discs' angular radius the marks are drawn with [°] (the Sun's and the Moon's, near enough) */
export const DISC_DEG = 0.266;

/** A close frame's size [px] for its disc of `r` px within `k` radii in the image (its field holds 1.6 at
 *  least: the sky's ring about the disc): three samples a pixel. */
export function insetSize(i: { r: number; k: number }) {
  return Math.min(Math.max(Math.ceil(2 * Math.max(i.k, 1.6) * 1.15 * i.r * 3), 48), 720);
}

/**
 * A close frame (N × N, its field `fov`) laid at its place: each pixel of the image within `k` disc radii
 * of (x, y) the mean of the close frame's pixels under it (its disc of `r` px), lightened into the image,
 * softly in the outer third.
 */
export function placeInset(
  out: Uint8ClampedArray,
  px: Uint8Array,
  W: number,
  H: number,
  N: number,
  i: NonNullable<Exposure["inset"]>,
): boolean {
  const D = Math.PI / 180;
  const rr = ((N / 2) * Math.tan(DISC_DEG * D)) / Math.tan((i.fov / 2) * D);
  if (!discSeen(px, N, rr)) return false;
  const s = i.r / rr;
  const R = i.k * i.r;
  for (let oy = Math.max(0, Math.floor(i.y - R)); oy <= Math.min(H - 1, Math.ceil(i.y + R)); oy++)
    for (let ox = Math.max(0, Math.floor(i.x - R)); ox <= Math.min(W - 1, Math.ceil(i.x + R)); ox++) {
      const d = Math.hypot(ox + 0.5 - i.x, oy + 0.5 - i.y) / R;
      if (d >= 1) continue;
      const w = d < 2 / 3 ? 1 : (1 - d) * 3;
      const u0 = Math.max(0, Math.floor((ox - i.x) / s + N / 2)),
        u1 = Math.min(N - 1, Math.max(u0, Math.ceil((ox + 1 - i.x) / s + N / 2) - 1));
      const v0 = Math.max(0, Math.floor((oy - i.y) / s + N / 2)),
        v1 = Math.min(N - 1, Math.max(v0, Math.ceil((oy + 1 - i.y) / s + N / 2) - 1));
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let v = v0; v <= v1; v++)
        for (let u = u0; u <= u1; u++) {
          const k = (v * N + u) * 4;
          r += px[k]!;
          g += px[k + 1]!;
          b += px[k + 2]!;
          n++;
        }
      if (!n) continue;
      const k = (oy * W + ox) * 4;
      const c = [r / n, g / n, b / n];
      for (let j = 0; j < 3; j++) if (c[j]! > out[k + j]!) out[k + j] = out[k + j]! + (c[j]! - out[k + j]!) * w;
    }
  return true;
}

/**
 * Whether a close frame shows its disc (N × N, the disc of `rr` px at its middle): its brightest inside
 * brighter than the sky's ring about it — a disc behind the ground or the hills is not laid (its frame would
 * lay a disc of sky).
 */
export function discSeen(px: Uint8Array, N: number, rr: number): boolean {
  const lum = (k: number) => 0.2126 * px[k]! + 0.7152 * px[k + 1]! + 0.0722 * px[k + 2]!;
  let inMax = 0,
    ring = 0,
    n = 0;
  const c = N / 2;
  for (let v = 0; v < N; v++)
    for (let u = 0; u < N; u++) {
      const d = Math.hypot(u + 0.5 - c, v + 0.5 - c) / rr;
      const k = (v * N + u) * 4;
      if (d < 0.85) inMax = Math.max(inMax, lum(k));
      else if (d > 1.25 && d < 1.6) {
        ring += lum(k);
        n++;
      }
    }
  return !n || inMax > ring / n + 10;
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
  /** the scene's data in (the Earth's maps and tiles near the camera) and the meter come to rest, waited for
   *  — the series' first at length (its ground's tiles come in waves) */
  settle(first?: boolean): Promise<void>;
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

/**
 * Lighten: each channel the brightest of the two — within a disc, softly to its edge (its outer third), when
 * one is given; the alpha kept opaque.
 */
export function lighten(
  out: Uint8ClampedArray,
  px: Uint8Array | Uint8ClampedArray,
  W: number,
  H: number,
  mask?: { x: number; y: number; r: number },
) {
  const x0 = mask ? Math.max(0, Math.floor(mask.x - mask.r)) : 0,
    x1 = mask ? Math.min(W - 1, Math.ceil(mask.x + mask.r)) : W - 1;
  const y0 = mask ? Math.max(0, Math.floor(mask.y - mask.r)) : 0,
    y1 = mask ? Math.min(H - 1, Math.ceil(mask.y + mask.r)) : H - 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      let w = 1;
      if (mask) {
        const d = Math.hypot(x + 0.5 - mask.x, y + 0.5 - mask.y) / mask.r;
        if (d >= 1) continue;
        w = d < 2 / 3 ? 1 : (1 - d) * 3;
      }
      const k = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = px[k + c]!,
          u = out[k + c]!;
        if (v > u) out[k + c] = u + (v - u) * w;
      }
      out[k + 3] = 255;
    }
}

/** A series rendered and blended: the composite (RGBA), its size; stopped early, the blend so far. */
export async function runExposures(
  host: MxHost,
  frames: Exposure[],
  o: MxOptions,
  progress: (p: MxProgress) => void,
  signal: { stop: boolean },
): Promise<{ data: Uint8ClampedArray; width: number; height: number; rendered: number; hidden: number[] }> {
  // (opaque black: what a frame laid by its disc alone leaves round it)
  const out = new Uint8ClampedArray(o.width * o.height * 4);
  for (let k = 3; k < out.length; k += 4) out[k] = 255;
  const before = host.snapshot();
  host.active(true);
  let rendered = 0;
  const hidden: number[] = [];
  try {
    for (const [i, f] of frames.entries()) {
      if (signal.stop) break;
      progress({ done: i, total: frames.length, label: f.label });
      host.apply({ ...f.preset, animate: false });
      const s = host.settings;
      if (f.exposure === "auto") {
        s.autoExposure = true;
        s.exposure = f.comp ?? 0;
      } else {
        s.autoExposure = false;
        s.exposure = f.exposure;
      }
      await host.settle(i === 0);
      if (f.inset) {
        const N = insetSize(f.inset);
        if (!placeInset(out, await host.render({ width: N, height: N, spp: o.spp }), o.width, o.height, N, f.inset) && f.ms !== undefined)
          hidden.push(f.ms);
        rendered++;
        continue;
      }
      const px = await host.render({ width: o.width, height: o.height, spp: f.blend === "base" ? (o.baseSpp ?? o.spp) : o.spp });
      // (the base under what is laid: lighten keeps the brightest whatever the order — the base may come
      // last, its ground's finer tiles in by then; a frame of no mask and no base: as it is)
      if (f.blend === "base") {
        const under = Uint8ClampedArray.from(px.subarray(0, out.length));
        lighten(under, out, o.width, o.height);
        out.set(under);
      } else {
        if (f.gain !== undefined && f.gain !== 1) for (let k = 0; k < px.length; k++) if ((k & 3) !== 3) px[k] = px[k]! * f.gain;
        lighten(out, px, o.width, o.height, f.mask);
        f.after?.(out, px, o.width, o.height);
      }
      rendered++;
    }
    progress({ done: rendered, total: frames.length, label: "" });
  } finally {
    host.active(false);
    host.restore(before);
  }
  return { data: out, width: o.width, height: o.height, rendered, hidden };
}
