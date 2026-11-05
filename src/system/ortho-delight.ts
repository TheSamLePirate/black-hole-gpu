// L7b, the in-game prototype (decision 42, Sam 5 Nov 2026 — docs/progress/refraction-horizons/Q7.md, the study's four
// phases): an IGN orthophoto's cast shadows lifted before it is coloured and uploaded, so the game's own Sun casts the
// only shadow on the ground. The study's method, in the decode worker, on one z ≥ 17 tile at a time:
// - the occluders: the LiDAR's canopy height model (MNH — trees and buildings, their true geometry) over the tile and a margin
//   round it, at the tile's own pixels; the receivers: the ground, under 1.5 m — crowns and roofs are never relit;
// - the photo's Sun (its time is not read — sources.ts ign-ortho): the shadows those occluders would cast, for a grid of
//   azimuths and elevations, against the image's dark and bluish ground (Otsu on log L, blue/red over its median); the
//   best overlap (IoU), refined; remembered per area to search near it next time;
// - the mask: the image's dark ground near the predicted shadows, cleaned (median 3), softened (1 px), guided by the image
//   (r 3); k per colour from material-matched pairs across the edges (3 px in and out, same chromaticity once the shadow's
//   tint is taken out) — the study's error factor 1.12 —, the area's last when a tile has too few;
// - the relighting I′ = I · (1 + (k − 1) α) in linear light, sRGB in and out.
// A tile without the survey under it, without shadows, or whose Sun is not found is left as it was (said in its stats).
// Not the BD TOPO's footprints (the study's phase 2): the MNH holds the buildings too; its ground mask stands in for them.

const D = Math.PI / 180;
/** a tile's side [px] */
const W = 256;
const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const LIN = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
const TO_SRGB = Uint8Array.from({ length: 4096 }, (_, i) => Math.round(255 * linearToSrgb(i / 4095)));

/** the canopy over a tile: n² heights [m] (row 0 the north, NaN none), the tile's 256² at (m, m), metres a pixel */
export interface DelightIn {
  mnh: Float32Array;
  n: number;
  m: number;
  mpp: number;
  /** the area the found Sun and k are remembered by (a coarser tile's key) */
  area: string;
}
export interface DelightStats {
  done: boolean;
  /** why not: "survey" (none under it), "shadows" (none), "sun" (not found) */
  why?: string;
  /** the photo's Sun found: azimuth, elevation [°], its overlap with the image's shadows */
  sun?: [number, number, number];
  k?: [number, number, number];
  /** the matched pairs k came from (0: the area's or the rings') */
  pairs?: number;
  /** the share of the tile relit */
  share?: number;
  ms: number;
}

/** the tallest occluder looked for [m] */
const TALLEST = 40;
/** the ground: the canopy under this [m] */
const GROUND_H = 1.5;
/** a Sun accepted from this overlap */
const IOU_MIN = 0.2;
/** pairs a tile's own k needs */
const PAIRS_MIN = 30;
const sunMemo = new Map<string, [number, number]>();
/** each area's tiles' own k (the last 16): the area's k their median — neighbouring tiles relit alike, no seam between them */
const kMemo = new Map<string, [number, number, number][]>();
let lastSun: [number, number] | null = null;

function median(v: Float32Array, n: number): number {
  if (n === 0) return Number.NaN;
  const s = v.slice(0, n).sort();
  return s[n >> 1]!;
}
function otsu(v: Float32Array, n: number): number {
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, v[i]!);
    hi = Math.max(hi, v[i]!);
  }
  const B = 256,
    h = new Float64Array(B),
    w = (hi - lo) / B || 1;
  for (let i = 0; i < n; i++) h[Math.min(B - 1, Math.floor((v[i]! - lo) / w))]!++;
  let tot = 0,
    sum = 0;
  for (let b = 0; b < B; b++) {
    tot += h[b]!;
    sum += h[b]! * (lo + (b + 0.5) * w);
  }
  let wb = 0,
    mb = 0,
    best = -1,
    th = lo;
  for (let b = 0; b < B; b++) {
    wb += h[b]!;
    mb += h[b]! * (lo + (b + 0.5) * w);
    const wf = tot - wb;
    if (wb === 0 || wf === 0) continue;
    const d = mb / wb - (sum - mb) / wf,
      s = wb * wf * d * d;
    if (s > best) {
      best = s;
      th = lo + (b + 0.5) * w;
    }
  }
  return th;
}
/** a binary mask's max over a size² square (separable) */
function dilate(a: Uint8Array, size: number): Uint8Array {
  const r = size >> 1,
    t = new Uint8Array(W * W),
    o = new Uint8Array(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r) && !v; k++) v = a[y * W + k]!;
      t[y * W + x] = v;
    }
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(W - 1, y + r) && !v; k++) v = t[k * W + x]!;
      o[y * W + x] = v;
    }
  return o;
}
/** a field's mean over a (2r+1)² square, the edges over what is inside (separable running sums) */
function box(a: Float32Array, r: number): Float32Array {
  const t = new Float32Array(W * W),
    o = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    let s = 0;
    for (let x = 0; x <= r; x++) s += a[y * W + x]!;
    for (let x = 0; x < W; x++) {
      const x0 = x - r,
        x1 = x + r;
      t[y * W + x] = s / (Math.min(W - 1, x1) - Math.max(0, x0) + 1);
      if (x1 + 1 < W) s += a[y * W + x1 + 1]!;
      if (x0 >= 0) s -= a[y * W + x0]!;
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y <= r; y++) s += t[y * W + x]!;
    for (let y = 0; y < W; y++) {
      const y0 = y - r,
        y1 = y + r;
      o[y * W + x] = s / (Math.min(W - 1, y1) - Math.max(0, y0) + 1);
      if (y1 + 1 < W) s += t[(y1 + 1) * W + x]!;
      if (y0 >= 0) s -= t[y0 * W + x]!;
    }
  }
  return o;
}
/** a binomial blur (1 4 6 4 1)/16 — σ ≈ 1 px — (separable) */
function gauss(a: Float32Array): Float32Array {
  const K = [1, 4, 6, 4, 1],
    t = new Float32Array(W * W),
    o = new Float32Array(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      let s = 0,
        w = 0;
      for (let k = -2; k <= 2; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= W) continue;
        s += K[k + 2]! * a[y * W + xx]!;
        w += K[k + 2]!;
      }
      t[y * W + x] = s / w;
    }
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      let s = 0,
        w = 0;
      for (let k = -2; k <= 2; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= W) continue;
        s += K[k + 2]! * t[yy * W + x]!;
        w += K[k + 2]!;
      }
      o[y * W + x] = s / w;
    }
  return o;
}

/**
 * The ground the canopy would shade with the Sun at `az` (from the north, eastwards) and `el` [°], over the tile's pixels
 * every `f` (1: all, 2: a half-resolution grid), marching towards the Sun `step` pixels at a time (image x east, y south).
 */
export function predictShadow(
  q: Pick<DelightIn, "mnh" | "n" | "m" | "mpp">,
  ground: Uint8Array,
  az: number,
  el: number,
  f = 1,
  step = 1,
): Uint8Array {
  const wf = W / f,
    S = new Uint8Array(wf * wf),
    { mnh: H, n, m, mpp } = q;
  const dx = Math.sin(az * D),
    dy = -Math.cos(az * D),
    tanE = Math.tan(el * D);
  const smax = Math.min(Math.floor(TALLEST / tanE / mpp), m - 1);
  for (let s = step * f; s <= smax; s += step * f) {
    const ox = Math.round(dx * s),
      oy = Math.round(dy * s),
      hmin = s * mpp * tanE;
    for (let y = 0; y < wf; y++) {
      const row = (m + y * f + oy) * n + m + ox;
      for (let x = 0; x < wf; x++) {
        const i = y * wf + x;
        if (!S[i] && H[row + x * f]! > hmin) S[i] = 1;
      }
    }
  }
  for (let i = 0; i < S.length; i++) S[i]! &= ground[(Math.floor(i / wf) * W + (i % wf)) * f]!;
  return S;
}
function iou(S: Uint8Array, dark: Uint8Array): number {
  let a = 0,
    u = 0;
  for (let i = 0; i < S.length; i++) {
    a += S[i]! & dark[i]!;
    u += S[i]! | dark[i]!;
  }
  return u ? a / u : 0;
}

/** The tile's pixels (rgba, sRGB, 256²) relit in place where the canopy's predicted shadows and the image's agree. */
export function delightTile(px: Uint8ClampedArray | Uint8Array, q: DelightIn): DelightStats {
  const t0 = performance.now();
  const N = W * W,
    { mnh: H, n, m } = q;
  // (the receivers: the surveyed ground)
  const ground = new Uint8Array(N);
  let surveyed = 0;
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const h = H[(m + y) * n + m + x]!;
      if (Number.isFinite(h)) {
        surveyed++;
        ground[y * W + x] = h < GROUND_H ? 1 : 0;
      }
    }
  const ms = () => +(performance.now() - t0).toFixed(1);
  if (surveyed < N / 2) return { done: false, why: "survey", ms: ms() };
  // (the image's dark, bluish ground: Otsu on log L, blue/red over its median)
  const lin = new Float32Array(3 * N),
    lL = new Float32Array(N),
    vals = new Float32Array(N),
    brs = new Float32Array(N),
    br = new Float32Array(N);
  let ng = 0;
  for (let i = 0; i < N; i++) {
    const r = LIN[px[4 * i]!]!,
      g = LIN[px[4 * i + 1]!]!,
      b = LIN[px[4 * i + 2]!]!;
    lin[3 * i] = r;
    lin[3 * i + 1] = g;
    lin[3 * i + 2] = b;
    lL[i] = Math.log(0.2126 * r + 0.7152 * g + 0.0722 * b + 1e-4);
    br[i] = (b + 1e-3) / (r + 1e-3);
    if (ground[i]) {
      vals[ng] = lL[i]!;
      brs[ng++] = br[i]!;
    }
  }
  if (ng < N / 10) return { done: false, why: "shadows", ms: ms() };
  const th = otsu(vals, ng),
    brMed = median(brs, ng);
  const dark = new Uint8Array(N);
  let nd = 0;
  for (let i = 0; i < N; i++) if (ground[i] && lL[i]! < th && br[i]! > brMed) nd += dark[i] = 1;
  if (nd < N / 100) return { done: false, why: "shadows", ms: ms() };
  // (the photo's Sun: near the area's last, else over the whole sky's day — on a half-resolution grid —, then refined)
  const dark2 = new Uint8Array(N / 4);
  for (let y = 0; y < W / 2; y++) for (let x = 0; x < W / 2; x++) dark2[y * (W / 2) + x] = dark[2 * y * W + 2 * x]!;
  let best: [number, number, number] = [0, 0, -1];
  const tryAt = (az: number, el: number, f: number) => {
    if (el < 10 || el > 75) return;
    const v = iou(predictShadow(q, ground, az, el, f, f === 2 ? 1 : 2), f === 2 ? dark2 : dark);
    if (v > best[2]) best = [az, el, v];
  };
  const near = sunMemo.get(q.area) ?? lastSun;
  if (near) for (let a = -20; a <= 20; a += 10) for (let e = -10; e <= 10; e += 5) tryAt(near[0] + a, near[1] + e, 2);
  if (best[2] < IOU_MIN * 1.5) for (let az = 90; az <= 270; az += 15) for (let el = 20; el <= 65; el += 7.5) tryAt(az, el, 2);
  const [a0, e0] = best;
  best = [0, 0, -1];
  for (const a of [-4, 0, 4]) for (const e of [-2, 0, 2]) tryAt(a0 + a, e0 + e, 1);
  if (best[2] < IOU_MIN) return { done: false, why: "sun", sun: [a0, e0, +best[2].toFixed(3)], ms: ms() };
  sunMemo.set(q.area, [best[0], best[1]]);
  lastSun = [best[0], best[1]];
  // (the mask: the image's dark ground near the predicted shadows, cleaned, softened, guided by the image)
  const S = predictShadow(q, ground, best[0], best[1], 1, 1);
  const nearS = dilate(S, 7);
  const hard = new Uint8Array(N);
  for (let i = 0; i < N; i++) hard[i] = nearS[i]! & dark[i]!;
  const med = new Float32Array(N);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const yy = Math.min(W - 1, Math.max(0, y + j)),
            xx = Math.min(W - 1, Math.max(0, x + k));
          c += hard[yy * W + xx]!;
        }
      med[y * W + x] = c >= 5 ? 1 : 0;
    }
  const a = gauss(med);
  let lmin = 0;
  for (let i = 0; i < N; i++) lmin = Math.min(lmin, lL[i]!);
  const I = Float32Array.from(lL, (v) => v / lmin);
  const mI = box(I, 3),
    mp = box(a, 3),
    Ip = box(
      Float32Array.from(I, (v, i) => v * a[i]!),
      3,
    ),
    II = box(
      Float32Array.from(I, (v) => v * v),
      3,
    );
  const A = new Float32Array(N),
    B = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    A[i] = (Ip[i]! - mI[i]! * mp[i]!) / (II[i]! - mI[i]! * mI[i]! + 1e-3);
    B[i] = mp[i]! - A[i]! * mI[i]!;
  }
  const mA = box(A, 3),
    mB = box(B, 3);
  const alpha = new Float32Array(N);
  let share = 0;
  for (let i = 0; i < N; i++) {
    alpha[i] = ground[i] ? Math.min(1, Math.max(0, mA[i]! * I[i]! + mB[i]!)) : 0;
    share += alpha[i]!;
  }
  // (k per colour: the rings' — the sunlit ring out of the shadow over its relit edge — as the tint's guess, then the pairs')
  const dil = dilate(hard, 9),
    ero = dilate(
      Uint8Array.from(hard, (v) => 1 - v),
      5,
    );
  const sun3 = [new Float32Array(N), new Float32Array(N), new Float32Array(N)],
    sh3 = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  let nsu = 0,
    nsh = 0;
  for (let i = 0; i < N; i++) {
    if (!ground[i]) continue;
    if (dil[i] && !hard[i] && a[i]! < 0.1) {
      for (let c = 0; c < 3; c++) sun3[c]![nsu] = lin[3 * i + c]!;
      nsu++;
    } else if (hard[i] && !ero[i] && a[i]! > 0.9) {
      for (let c = 0; c < 3; c++) sh3[c]![nsh] = lin[3 * i + c]!;
      nsh++;
    }
  }
  const glob = [0, 1, 2].map((c) => Math.min(10, Math.max(2, median(sun3[c]!, nsu) / Math.max(median(sh3[c]!, nsh), 1e-4))));
  const kp = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  let np = 0;
  for (let y = 1; y < W - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!hard[i] || !ground[i] || (hard[i - 1] && hard[i + 1] && hard[i - W] && hard[i + W])) continue;
      const gx = (a[i + 1]! - a[i - 1]!) / 2,
        gy = (a[i + W]! - a[i - W]!) / 2,
        gn = Math.hypot(gx, gy);
      if (gn <= 0.05) continue;
      const at = (s: number) => {
        const xx = Math.min(W - 1, Math.max(0, Math.round(x + (s * gx) / gn))),
          yy = Math.min(W - 1, Math.max(0, Math.round(y + (s * gy) / gn)));
        return yy * W + xx;
      };
      const ii = at(3),
        oo = at(-3);
      if (!ground[ii] || !ground[oo] || alpha[ii]! <= 0.8 || alpha[oo]! >= 0.1) continue;
      let si = 0,
        so = 0;
      for (let c = 0; c < 3; c++) {
        si += lin[3 * ii + c]! * glob[c]!;
        so += lin[3 * oo + c]!;
      }
      let same = true,
        plaus = true;
      for (let c = 0; c < 3; c++) {
        if (Math.abs((lin[3 * ii + c]! * glob[c]!) / (si + 1e-6) - lin[3 * oo + c]! / (so + 1e-6)) >= 0.04) same = false;
        const k = lin[3 * oo + c]! / Math.max(lin[3 * ii + c]!, 1e-5);
        if (k <= 1.5 || k >= 15) plaus = false;
      }
      if (!same || !plaus) continue;
      for (let c = 0; c < 3; c++) kp[c]![np] = lin[3 * oo + c]! / Math.max(lin[3 * ii + c]!, 1e-5);
      np++;
    }
  let k: [number, number, number];
  const seen = kMemo.get(q.area) ?? [];
  if (np >= PAIRS_MIN) {
    seen.push([0, 1, 2].map((c) => median(kp[c]!, np)) as [number, number, number]);
    if (seen.length > 16) seen.shift();
    kMemo.set(q.area, seen);
  }
  if (seen.length)
    k = [0, 1, 2].map((c) =>
      median(
        Float32Array.from(seen, (v) => v[c]!),
        seen.length,
      ),
    ) as [number, number, number];
  else k = glob as [number, number, number];
  // (relit: I′ = I · (1 + (k − 1) α), linear light)
  for (let i = 0; i < N; i++) {
    const al = alpha[i]!;
    if (al <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const v = lin[3 * i + c]! * (1 + (k[c]! - 1) * al);
      px[4 * i + c] = TO_SRGB[Math.round(4095 * Math.min(v, 1))]!;
    }
  }
  return {
    done: true,
    sun: [best[0], best[1], +best[2].toFixed(3)],
    k: k.map((v) => +v.toFixed(2)) as [number, number, number],
    pairs: np >= PAIRS_MIN ? np : 0,
    share: +(share / N).toFixed(3),
    ms: ms(),
  };
}
