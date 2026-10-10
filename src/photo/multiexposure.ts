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
  /** false: its close frame laid without asking whether its disc shows (carried to its inset) */
  check?: boolean;
  /** lighten: its light scaled first (a star trail's comet tail: the older frames dimmer) */
  gain?: number;
  /** after it is laid: more drawn from it into the image (a star trail's arcs run on to the next frame) */
  after?: (out: Uint8ClampedArray, px: Uint8Array, W: number, H: number) => void;
  /**
   * a disc's frame taken close — a telephoto's: its own field `fov` [°] on the Sun or the Moon, its own
   * meter (a wide view's would not open for a red Moon) — then laid at its place in the image: its disc of
   * `r` px at (x, y), within `k` radii, softly
   */
  inset?: {
    x: number;
    y: number;
    r: number;
    k: number;
    fov: number;
    /** the frame turned [rad] before it is laid: its north up (the parallactic angle — the north's
     *  direction in it from its up, towards its right) */
    rot?: number;
    /** its frame's size at most [px] (a transit's Sun: Mercury a few pixels on it) */
    maxN?: number;
    /** a row's: laid once the series is done, the discs seen spread evenly across the image at this height
     *  (one behind the hills leaves no gap) */
    row?: number;
    /** laid only within this disc of the image [px] (a transit's planet: the Sun's own spots not dragged
     *  along) — centred on the darkest point within `search` px of it (the planet where the frame has it: its
     *  light's aberration and the air's bending move it by half a minute of arc from the reckoned place) */
    area?: { x: number; y: number; r: number; search?: number };
    /** false: laid without asking whether its disc shows (a totality: its Moon darker than its corona) */
    check?: boolean;
    /** how it is laid: lightened (the default), darkened (a transit's planet: the dark dot kept), set as it is
     *  (a darkened series' first) */
    mode?: "lighten" | "darken" | "set";
  };
}

/** the discs' angular radius the marks are drawn with [°] (the Sun's and the Moon's, near enough) */
export const DISC_DEG = 0.266;

/** A close frame's size [px] for its disc of `r` px within `k` radii in the image (its field holds 1.6 at
 *  least: the sky's ring about the disc): three samples a pixel. */
export function insetSize(i: { r: number; k: number; maxN?: number }) {
  return Math.min(Math.max(Math.ceil(2 * Math.max(i.k, 1.6) * 1.15 * i.r * 3), 48), i.maxN ?? 720);
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
  const mode = i.mode ?? "lighten";
  if (mode === "lighten" && i.check !== false && !discSeen(px, N, rr)) return false;
  const s = i.r / rr;
  const R = i.k * i.r;
  const c = Math.cos(i.rot ?? 0),
    sn = Math.sin(i.rot ?? 0);
  // (each pixel the mean of 3 × 3 points of it, each the close frame's pixel under it — turned, scaled)
  const at = (ox: number, oy: number, j: number) => {
    let sum = 0,
      n = 0;
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) {
        const dx = ox + (a + 0.5) / 3 - i.x,
          dy = oy + (b + 0.5) / 3 - i.y;
        const u = Math.floor((dx * c - dy * sn) / s + N / 2),
          v = Math.floor((dx * sn + dy * c) / s + N / 2);
        if (u < 0 || v < 0 || u >= N || v >= N) continue;
        sum += px[(v * N + u) * 4 + j]!;
        n++;
      }
    return n ? sum / n : -1;
  };
  let area = i.area;
  if (area?.search) {
    let best = Infinity;
    const a0 = area;
    for (let oy = Math.floor(a0.y - a0.search!); oy <= a0.y + a0.search!; oy++)
      for (let ox = Math.floor(a0.x - a0.search!); ox <= a0.x + a0.search!; ox++) {
        if (Math.hypot(ox - a0.x, oy - a0.y) > a0.search! || Math.hypot(ox + 0.5 - i.x, oy + 0.5 - i.y) > i.r * 0.97) continue;
        const L = at(ox, oy, 0) + at(ox, oy, 1) + at(ox, oy, 2);
        if (L >= 0 && L < best) [best, area] = [L, { x: ox + 0.5, y: oy + 0.5, r: a0.r }];
      }
  }
  for (let oy = Math.max(0, Math.floor(i.y - R)); oy <= Math.min(H - 1, Math.ceil(i.y + R)); oy++)
    for (let ox = Math.max(0, Math.floor(i.x - R)); ox <= Math.min(W - 1, Math.ceil(i.x + R)); ox++) {
      const d = Math.hypot(ox + 0.5 - i.x, oy + 0.5 - i.y) / R;
      if (d >= 1) continue;
      if (area && Math.hypot(ox + 0.5 - area.x, oy + 0.5 - area.y) > area.r) continue;
      // (softened in its last tenth of a disc radius — or its outer third, for a wide one: a corona's)
      const soft = Math.min(1 / 3, 0.1 / i.k);
      const w = mode !== "lighten" || d < 1 - soft ? 1 : (1 - d) / soft;
      const k = (oy * W + ox) * 4;
      for (let j = 0; j < 3; j++) {
        const v = at(ox, oy, j);
        if (v < 0) continue;
        const u = out[k + j]!;
        if (mode === "set") out[k + j] = v;
        else if (mode === "darken" ? v < u : v > u) out[k + j] = u + (v - u) * w;
      }
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
): Promise<{
  data: Uint8ClampedArray;
  width: number;
  height: number;
  rendered: number;
  hidden: number[];
  /** a row's discs where they were laid */
  placed: { ms: number; x: number; y: number }[];
}> {
  // (opaque black: what a frame laid by its disc alone leaves round it)
  const out = new Uint8ClampedArray(o.width * o.height * 4);
  for (let k = 3; k < out.length; k += 4) out[k] = 255;
  const before = host.snapshot();
  host.active(true);
  let rendered = 0;
  const hidden: number[] = [];
  const row: { img: Uint8Array; N: number; f: Exposure }[] = [];
  const placed: { ms: number; x: number; y: number }[] = [];
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
        const img = await host.render({ width: N, height: N, spp: o.spp });
        if (f.inset.row !== undefined) {
          // (a row's: kept if its disc shows, laid at the end)
          const rr = ((N / 2) * Math.tan((DISC_DEG * Math.PI) / 180)) / Math.tan((f.inset.fov / 2) * (Math.PI / 180));
          if (f.inset.check === false || discSeen(img, N, rr)) row.push({ img: Uint8Array.from(img), N, f });
          else if (f.ms !== undefined) hidden.push(f.ms);
        } else if (!placeInset(out, img, o.width, o.height, N, f.inset) && f.ms !== undefined) hidden.push(f.ms);
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
    // (the row: its discs seen spread evenly)
    for (const [j, r] of row.entries()) {
      const x = (o.width * (j + 0.5)) / row.length;
      placeInset(out, r.img, o.width, o.height, r.N, { ...r.f.inset!, x, y: r.f.inset!.row!, check: false });
      if (r.f.ms !== undefined) placed.push({ ms: r.f.ms, x, y: r.f.inset!.row! });
    }
    progress({ done: rendered, total: frames.length, label: "" });
  } finally {
    host.active(false);
    host.restore(before);
  }
  return { data: out, width: o.width, height: o.height, rendered, hidden, placed };
}
