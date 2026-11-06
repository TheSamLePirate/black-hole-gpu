// The Earth's tiles decoded (T8 — docs/PLAN-REFRACTION-HORIZONS.md: "the decoding in a worker"): a PNG's or JPEG's pixels,
// Terrarium's heights, the imagery's colours brought into the Blue Marble's (EOX's fit, the orthophotos'), the night's lights
// packed with the day — pure functions, the same in the decode worker (tile-decode-worker.ts) and, where there is none (the
// tests), in the page. No allocation a pixel: the colours' loops write their tile's words straight.
import type { OrthoFit } from "./national";
import { type DelightIn, type DelightStats, delightTile } from "./ortho-delight";

/** a tile's side [px] (earth-tiles.ts TILE) */
const TILE = 256;

/**
 * The orthophotos' colours (an aerial survey's, graded bright: 2.7 times the ground's on average) into the Blue
 * Marble's, which the tracer's ground and the coarser levels have — a tone curve on the luminance L′ = a·L^b and the
 * colours' gains, fitted on twelve places' z 14 tiles against EOX's own brought there (fields, forests, vineyards,
 * marshes, towns, the Alps; their distributions matched — the surveys' dates and seasons differ, no pixel's twin):
 * means within 4 %, a white kept white. The gains fade out over the bright ground (snow, roofs, roads), as EOX's
 * fit; sRGB 8-bit in and out.
 */
export const ORTHO_FIT = { tone: [0.8112, 1.4753], chroma: [0.8232, 1.0999, 0.3872] } as const;
/**
 * EOX's colours (a mosaic graded for the eye: hazier, bluer) into the Blue Marble's, whose colours the
 * tracer's ground and the coarser levels have — per channel in linear light, b = g · e^k, fitted on nine
 * places' z 8 tiles (forests, farmland, desert, tundra, cities: R² 0.96, 0.94, 0.86), where it was measured:
 * the darker ground. Bright ground (snow, sand, rock, towns) is left as it is — the fit's extrapolation would
 * tint it cyan —, the two blended by the pixel's luminance (no hue moved by a channel's own weight).
 * sRGB 8-bit in, out.
 */
export const EOX_FIT = { gain: [0.894, 1.548, 3.877], power: [0.959, 1.205, 1.487] } as const;
const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const LIN = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
const FIT = [0, 1, 2].map((c) => Float32Array.from(LIN, (v) => Math.min(1, EOX_FIT.gain[c]! * v ** EOX_FIT.power[c]!)));
const [FIT_R, FIT_G, FIT_B] = FIT as [Float32Array, Float32Array, Float32Array];
const TO_SRGB = Uint8Array.from({ length: 4096 }, (_, i) => Math.round(255 * linearToSrgb(i / 4095)));
/** the luminance's tone curve a·L^b, tabulated over L (4096 steps: the curve's error under 0.1 %) — a fit's own */
const toneTables = new Map<OrthoFit, Float32Array>();
function toneOf(fit: OrthoFit): Float32Array {
  let t = toneTables.get(fit);
  if (!t) {
    t = Float32Array.from({ length: 4097 }, (_, i) => fit.tone[0] * (i / 4096) ** fit.tone[1]);
    toneTables.set(fit, t);
  }
  return t;
}
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const srgb = (v: number) => TO_SRGB[Math.round(4095 * (v < 1 ? v : 1))]!;

export function orthoColour(r: number, g: number, b: number, fit: OrthoFit = ORTHO_FIT): [number, number, number] {
  const w = orthoWord(r, g, b, fit, toneOf(fit));
  return [w & 255, (w >> 8) & 255, (w >> 16) & 255];
}
/** an orthophoto's pixel's colour, packed (r | g << 8 | b << 16), r at least 1 (0: no image) */
function orthoWord(r: number, g: number, b: number, fit: OrthoFit, tone: Float32Array): number {
  const er = LIN[r]!,
    eg = LIN[g]!,
    eb = LIN[b]!;
  const L = 0.2126 * er + 0.7152 * eg + 0.0722 * eb;
  if (L <= 0) return 0;
  const f = L * 4096,
    i = Math.min(Math.floor(f), 4095);
  const Lo = tone[i]! + (tone[i + 1]! - tone[i]!) * (f - i);
  const t = smooth((Lo - 0.06) / 0.29);
  const k = Lo / L;
  return (
    srgb(er * k * (fit.chroma[0] * (1 - t) + t)) |
    (srgb(eg * k * (fit.chroma[1] * (1 - t) + t)) << 8) |
    (srgb(eb * k * (fit.chroma[2] * (1 - t) + t)) << 16)
  );
}
export function eoxColour(r: number, g: number, b: number): [number, number, number] {
  const w = eoxWord(r, g, b);
  return [w & 255, (w >> 8) & 255, (w >> 16) & 255];
}
function eoxWord(r: number, g: number, b: number): number {
  const er = LIN[r]!,
    eg = LIN[g]!,
    eb = LIN[b]!;
  const t = smooth((0.2126 * er + 0.7152 * eg + 0.0722 * eb - 0.06) / 0.29);
  return srgb(FIT_R[r]! * (1 - t) + er * t) | (srgb(FIT_G[g]! * (1 - t) + eg * t) << 8) | (srgb(FIT_B[b]! * (1 - t) + eb * t) << 16);
}

/** A tile's pixels (rgba, row by row), as they are in its file — or a square of it (x, y, side [px]) enlarged. */
export async function pixels(blob: Blob, crop?: readonly [number, number, number] | null): Promise<Uint8ClampedArray> {
  const o = { colorSpaceConversion: "none", premultiplyAlpha: "none" } as const;
  const img = crop
    ? await createImageBitmap(blob, crop[0], crop[1], crop[2], crop[2], {
        ...o,
        resizeWidth: TILE,
        resizeHeight: TILE,
        resizeQuality: "medium",
      })
    : await createImageBitmap(blob, o);
  const cv = new OffscreenCanvas(TILE, TILE);
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  img.close();
  return ctx.getImageData(0, 0, TILE, TILE).data;
}

/** Terrarium's heights from a tile's pixels (height = R·256 + G + B/256 − 32 768 m) */
export function terrariumHeights(px: Uint8ClampedArray): Float32Array {
  const h = new Float32Array(TILE * TILE);
  for (let i = 0; i < h.length; i++) h[i] = px[4 * i]! * 256 + px[4 * i + 1]! + px[4 * i + 2]! / 256 - 32768;
  return h;
}

/**
 * A relief tile's imagery: the day's pixels brought into the Blue Marble's colours — an orthophoto's by its source's fit (`fit`),
 * EOX's finer tiles by theirs (`fine`), GIBS's as they are — and the night's lights (its pixels' luminance × alpha, a square
 * root, a floor of 0.07 where any) in alpha: the packed words the GPU takes (0: none).
 */
export function imageryWords(day: Uint8ClampedArray, night: Uint8ClampedArray, fit: OrthoFit | null, fine: boolean): Uint32Array {
  const out = new Uint32Array(TILE * TILE);
  const tone = fit ? toneOf(fit) : null;
  for (let i = 0; i < out.length; i++) {
    const v = (night[4 * i]! * night[4 * i + 3]!) / (255 * 255);
    const lights = v > 0 ? Math.round(255 * (0.07 + 0.93 * Math.min(1.06 * Math.sqrt(v), 1))) : 0;
    const r = day[4 * i]!,
      g = day[4 * i + 1]!,
      b = day[4 * i + 2]!;
    const w = fit ? orthoWord(r, g, b, fit, tone!) : fine ? eoxWord(r, g, b) : r | (g << 8) | (b << 16);
    out[i] = (Math.max(w & 255, 1) | (w & 0xffff00) | (lights << 24)) >>> 0;
  }
  return out;
}

/** An orthophotos' level's tile (imagery alone): its pixels by its source's fit, alpha 255 (0: no image) */
export function orthoWords(px: Uint8ClampedArray, fit: OrthoFit): Uint32Array {
  const col = new Uint32Array(TILE * TILE);
  const tone = toneOf(fit);
  for (let i = 0; i < col.length; i++) {
    const w = orthoWord(px[4 * i]!, px[4 * i + 1]!, px[4 * i + 2]!, fit, tone);
    col[i] = (Math.max(w & 255, 1) | (w & 0xffff00) | (255 << 24)) >>> 0;
  }
  return col;
}

/** What the decode worker is asked: a Terrarium tile's heights, a relief tile's imagery, an orthophoto's colours */
export type DecodeRequest =
  | { id: number; op: "terrarium"; blob: Blob }
  /** (Mapterhorn's 512² WebP Terrarium tiles — the USA's 3DEP relief, earth-tiles.ts USA) its whole grid, 512² */
  | { id: number; op: "terrarium512"; blob: Blob }
  | {
      id: number;
      op: "imagery";
      day: Blob;
      dayCrop: readonly [number, number, number] | null;
      night: Blob;
      nightCrop: readonly [number, number, number] | null;
      fit: OrthoFit | null;
      fine: boolean;
    }
  /** (L7b's prototype — ortho-delight.ts) `delight`: the canopy under it, its cast shadows lifted before its colours */
  | { id: number; op: "ortho"; blob: Blob; fit: OrthoFit; delight?: DelightIn };
export type DecodeReply = {
  id: number;
  ms: number;
  heights?: Float32Array;
  words?: Uint32Array;
  delight?: DelightStats;
  error?: string;
};

/** The request's work, wherever it runs: the arrays it gives (to be handed over, not copied) */
export async function decodeTile(q: DecodeRequest): Promise<{ heights?: Float32Array; words?: Uint32Array; delight?: DelightStats }> {
  if (q.op === "terrarium") return { heights: terrariumHeights(await pixels(q.blob)) };
  if (q.op === "terrarium512") {
    // (read whole at its size, no scaling: an interpolated Terrarium byte is a wrong height)
    const img = await createImageBitmap(q.blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const side = img.width;
    const cv = new OffscreenCanvas(side, side);
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    img.close();
    const px = ctx.getImageData(0, 0, side, side).data;
    const h = new Float32Array(side * side);
    for (let i = 0; i < h.length; i++) h[i] = px[4 * i]! * 256 + px[4 * i + 1]! + px[4 * i + 2]! / 256 - 32768;
    return { heights: h };
  }
  if (q.op === "ortho") {
    const px = await pixels(q.blob);
    const delight = q.delight ? delightTile(px, q.delight) : undefined;
    return { words: orthoWords(px, q.fit), ...(delight ? { delight } : {}) };
  }
  const [d, n] = await Promise.all([pixels(q.day, q.dayCrop), pixels(q.night, q.nightCrop)]);
  return { words: imageryWords(d, n, q.fit, q.fine) };
}
