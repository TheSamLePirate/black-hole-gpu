// The jitter seen in a video (scripts/jitter-lab.ts — docs/progress/JITTER-VOL.md): grey frames cut into tiles, each
// tile's move from one frame to the next by phase correlation (sub-pixel), then — as the probe's analysis does for the
// camera (src/jitter/analyze.ts) — each move against the local trend of its speed over the frames' own intervals: what is
// left is what trembles. A tile rigid with the camera (the cockpit's panel) trembles with the view's shakes; a tile of the
// world with the camera's and the flight's; any tile with the renderer's own (its history, its sparse shading, a change of
// scale) — that one alone with the flight held (a frozen stretch: nothing should move at all). Pure but for the buffers.

import { residuals } from "../../src/jitter/analyze";

/** An in-place radix-2 FFT of n complex numbers (re, im), n a power of two; inverse: conjugate in and out, /n by the caller. */
export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang),
      wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k,
          b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci,
          xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** A 2-D FFT of an n × n block (rows then columns). */
export function fft2(re: Float64Array, im: Float64Array, n: number, inverse = false) {
  const r = new Float64Array(n),
    i = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    r.set(re.subarray(y * n, y * n + n));
    i.set(im.subarray(y * n, y * n + n));
    fft(r, i, inverse);
    re.set(r, y * n);
    im.set(i, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      r[y] = re[y * n + x]!;
      i[y] = im[y * n + x]!;
    }
    fft(r, i, inverse);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = r[y]!;
      im[y * n + x] = i[y]!;
    }
  }
}

const hannCache = new Map<number, Float64Array>();
function hann(n: number) {
  let h = hannCache.get(n);
  if (!h) {
    h = new Float64Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        h[y * n + x] = (0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (n - 1))) * (0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (n - 1)));
    hannCache.set(n, h);
  }
  return h;
}

/** A tile's spectrum (windowed, its mean out) and its contrast (the pixels' standard deviation). */
export function tileSpectrum(img: Uint8Array, w: number, x0: number, y0: number, n: number) {
  const re = new Float64Array(n * n),
    im = new Float64Array(n * n);
  let m = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) m += img[(y0 + y) * w + x0 + x]!;
  m /= n * n;
  let v = 0;
  const h = hann(n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = img[(y0 + y) * w + x0 + x]! - m;
      v += d * d;
      re[y * n + x] = d * h[y * n + x]!;
    }
  fft2(re, im, n);
  return { re, im, contrast: Math.sqrt(v / (n * n)) };
}

/** The shift from a to b [px] (b ≈ a moved by dx, dy), by phase correlation, and the peak's height (0 … 1: its confidence). */
export function phaseShift(
  a: { re: Float64Array; im: Float64Array },
  b: { re: Float64Array; im: Float64Array },
  n: number,
  /** a shift already known [px]: taken out of b first (a phase ramp), the rest measured */
  pre: [number, number] = [0, 0],
) {
  const re = new Float64Array(n * n),
    im = new Float64Array(n * n);
  let top = 0;
  for (let k = 0; k < n * n; k++) {
    // (B · conj(A), the known shift undone)
    let r = b.re[k]! * a.re[k]! + b.im[k]! * a.im[k]!;
    let i = b.im[k]! * a.re[k]! - b.re[k]! * a.im[k]!;
    if (pre[0] || pre[1]) {
      const kx = k % n,
        ky = Math.floor(k / n);
      const fx = (kx > n / 2 ? kx - n : kx) / n,
        fy = (ky > n / 2 ? ky - n : ky) / n;
      const ph = 2 * Math.PI * (fx * pre[0] + fy * pre[1]);
      const c = Math.cos(ph),
        sn = Math.sin(ph);
      [r, i] = [r * c - i * sn, r * sn + i * c];
    }
    re[k] = r;
    im[k] = i;
    top = Math.max(top, Math.hypot(r, i));
  }
  for (let k = 0; k < n * n; k++) {
    // (normalised — its inverse peaks at the shift —, but the faint frequencies, the quantisation's noise, not raised to
    // the strong ones' weight, and the highest damped: a peak that stays one, a fractional shift's too)
    const fx = Math.min(k % n, n - (k % n)) / n,
      fy = Math.min(Math.floor(k / n), n - Math.floor(k / n)) / n;
    const m = Math.hypot(re[k]!, im[k]!) + 0.02 * top;
    const g = Math.exp(-(fx * fx + fy * fy) / (2 * 0.18 * 0.18));
    re[k] = (re[k]! / m) * g;
    im[k] = (im[k]! / m) * g;
  }
  fft2(re, im, n, true);
  let best = 0,
    bv = -Infinity;
  for (let k = 0; k < n * n; k++)
    if (re[k]! > bv) {
      bv = re[k]!;
      best = k;
    }
  const px = best % n,
    py = Math.floor(best / n);
  const at = (x: number, y: number) => re[((y + n) % n) * n + ((x + n) % n)]!;
  // (sub-pixel: a Gaussian through the peak and its neighbours, each axis — the damped spectrum's peak is one)
  const sub = (l: number, c: number, r: number) => {
    const L = Math.log(Math.max(l, 1e-6 * c)),
      C = Math.log(Math.max(c, 1e-30)),
      R = Math.log(Math.max(r, 1e-6 * c));
    const d = L - 2 * C + R;
    return Math.abs(d) > 1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (L - R)) / d)) : 0;
  };
  let dx = px + sub(at(px - 1, py), bv, at(px + 1, py));
  let dy = py + sub(at(px, py - 1), bv, at(px, py + 1));
  if (dx > n / 2) dx -= n;
  if (dy > n / 2) dy -= n;
  // (the confidence: the peak against the strongest value away from it — 1 for a clean shift, near 0 for a doubt)
  let side = 0;
  for (let k = 0; k < n * n; k++) {
    const x = k % n,
      y = Math.floor(k / n);
    const ddx = Math.min(Math.abs(x - px), n - Math.abs(x - px)),
      ddy = Math.min(Math.abs(y - py), n - Math.abs(y - py));
    if (ddx > 4 || ddy > 4) side = Math.max(side, re[k]!);
  }
  return { dx, dy, peak: bv > 0 ? Math.max(0, 1 - side / bv) : 0 };
}

/**
 * The shift of the tile at (x0, y0) from frame a to frame b [px]: a first estimate, then again with b's tile taken at the
 * whole-pixel shift found — the window's own pull towards no shift (some 12 % of it) left on the fraction alone.
 */
export function tileShift(
  a: Uint8Array,
  b: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  n: number,
  sa = tileSpectrum(a, w, x0, y0, n),
) {
  // (b's tile moved by the whole pixels found until none is left — the window's own pull towards no shift, some 12 % of
  // it, then on less than half a pixel)
  let bx = x0,
    by = y0;
  let sb = tileSpectrum(b, w, bx, by, n);
  let m = phaseShift(sa, sb, n);
  for (let it = 0; it < 4; it++) {
    const nx = Math.min(Math.max(bx + Math.round(m.dx), 0), w - n),
      ny = Math.min(Math.max(by + Math.round(m.dy), 0), h - n);
    if (nx === bx && ny === by) break;
    bx = nx;
    by = ny;
    sb = tileSpectrum(b, w, bx, by, n);
    m = phaseShift(sa, sb, n);
  }
  // (the fraction by gradients — Lucas–Kanade, b sampled bilinearly where the shift puts it, three times): the correlation's
  // peak finds the whole pixels, the gradients the tenths
  let dx = bx - x0 + m.dx,
    dy = by - y0 + m.dy;
  const win = hann(n);
  const A = (x: number, y: number) => a[(y0 + y) * w + x0 + x]!;
  const B = (x: number, y: number) => {
    const fx = Math.min(Math.max(x, 0), w - 1.001),
      fy = Math.min(Math.max(y, 0), h - 1.001);
    const ix = Math.floor(fx),
      iy = Math.floor(fy);
    const u = fx - ix,
      v = fy - iy;
    const k = iy * w + ix;
    return (b[k]! * (1 - u) + b[k + 1]! * u) * (1 - v) + (b[k + w]! * (1 - u) + b[k + w + 1]! * u) * v;
  };
  for (let it = 0; it < 3; it++) {
    let sxx = 0,
      sxy = 0,
      syy = 0,
      sxt = 0,
      syt = 0;
    for (let y = 1; y < n - 1; y++)
      for (let x = 1; x < n - 1; x++) {
        const wt = win[y * n + x]!;
        const gx = 0.5 * (A(x + 1, y) - A(x - 1, y)),
          gy = 0.5 * (A(x, y + 1) - A(x, y - 1));
        const dt = B(x0 + x + dx, y0 + y + dy) - A(x, y);
        sxx += wt * gx * gx;
        sxy += wt * gx * gy;
        syy += wt * gy * gy;
        sxt += wt * gx * dt;
        syt += wt * gy * dt;
      }
    const det = sxx * syy - sxy * sxy;
    if (!(det > 1e-9 * (sxx + syy) ** 2)) break;
    // (b = a moved by s: b(x + d) − a(x) ≈ ∇a · (d − s) — the excess u solved for, taken off)
    const ux = (syy * sxt - sxy * syt) / det,
      uy = (sxx * syt - sxy * sxt) / det;
    dx -= ux;
    dy -= uy;
    if (Math.abs(ux) + Math.abs(uy) < 1e-3) break;
  }
  return { dx, dy, peak: m.peak };
}

export interface TileTrack {
  /** the tile's place (its column, row) and its centre in the frame's fraction */
  col: number;
  row: number;
  cx: number;
  cy: number;
  /** each frame's move from the previous [px of the analysed frames]; NaN where not trusted */
  dx: number[];
  dy: number[];
  peak: number[];
  contrast: number;
}

/** Every tile's moves over the frames (n × n tiles on a grid; frames: grey, w × h). */
export function trackTiles(frames: Uint8Array[], w: number, h: number, n = 64): TileTrack[] {
  const cols = Math.floor(w / n),
    rows = Math.floor(h / n);
  const ox = Math.floor((w - cols * n) / 2),
    oy = Math.floor((h - rows * n) / 2);
  const tracks: TileTrack[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      tracks.push({ col: c, row: r, cx: (ox + (c + 0.5) * n) / w, cy: (oy + (r + 0.5) * n) / h, dx: [], dy: [], peak: [], contrast: 0 });
  let prev: ReturnType<typeof tileSpectrum>[] | null = null;
  let prevFrame: Uint8Array | null = null;
  for (const f of frames) {
    const cur = tracks.map((t) => tileSpectrum(f, w, ox + t.col * n, oy + t.row * n, n));
    if (prev)
      cur.forEach((s, i) => {
        const t = tracks[i]!;
        const ok = s.contrast > 3 && prev![i]!.contrast > 3;
        const m = ok
          ? tileShift(prevFrame!, f, w, h, ox + t.col * n, oy + t.row * n, n, prev![i]!)
          : { dx: Number.NaN, dy: Number.NaN, peak: 0 };
        // (a weak peak — a flat sky, a tile half new — not trusted)
        const trust = m.peak > 0.3;
        t.dx.push(trust ? m.dx : Number.NaN);
        t.dy.push(trust ? m.dy : Number.NaN);
        t.peak.push(m.peak);
      });
    cur.forEach((s, i) => (tracks[i]!.contrast += s.contrast / frames.length));
    prev = cur;
    prevFrame = f;
  }
  return tracks;
}

export interface TileJitter {
  col: number;
  row: number;
  cx: number;
  cy: number;
  /** the share of frames trusted */
  trusted: number;
  /** the move's median [px a frame], the jitter's root mean square [px a frame] (the move less its trend), its largest */
  move: number;
  rms: number;
  max: number;
}

/**
 * Each tile's jitter: its moves against their speed's local trend over the frames' intervals (`times` [s], one per frame).
 * `scale`: output pixels per analysed pixel. `still`: the flight held — the moves themselves are the jitter (nothing
 * should move).
 */
export function tileJitter(tracks: TileTrack[], times: number[], scale: number, still = false, sigma = 0.1): TileJitter[] {
  const tau = times.slice(1).map((t, i) => t - times[i]!);
  const tm = times.slice(1);
  return tracks.map((t) => {
    const okIdx = t.dx.map((x, i) => (Number.isFinite(x) && Number.isFinite(t.dy[i]!) ? i : -1)).filter((i) => i >= 0);
    const pick = (a: number[]) => okIdx.map((i) => a[i]!);
    const dx = pick(t.dx),
      dy = pick(t.dy),
      ta = pick(tau),
      ti = pick(tm);
    const rx = still ? dx : residuals(dx, ta, ti, sigma);
    const ry = still ? dy : residuals(dy, ta, ti, sigma);
    const mag = rx.map((x, i) => Math.hypot(x, ry[i]!) * scale);
    const moves = dx.map((x, i) => Math.hypot(x, dy[i]!) * scale).sort((a, b) => a - b);
    return {
      col: t.col,
      row: t.row,
      cx: t.cx,
      cy: t.cy,
      trusted: t.dx.length ? okIdx.length / t.dx.length : 0,
      move: moves[moves.length >> 1] ?? 0,
      rms: mag.length ? Math.sqrt(mag.reduce((a, b) => a + b * b, 0) / mag.length) : Number.NaN,
      max: mag.length ? Math.max(...mag) : Number.NaN,
    };
  });
}

/** The frames' mean absolute change [grey levels] — a held view's flicker (the renderer's noise, its history settling). */
export function flicker(frames: Uint8Array[]): number {
  let s = 0,
    n = 0;
  for (let k = 1; k < frames.length; k++) {
    const a = frames[k - 1]!,
      b = frames[k]!;
    for (let i = 0; i < a.length; i += 4) {
      s += Math.abs(a[i]! - b[i]!);
      n++;
    }
  }
  return n ? s / n : 0;
}

// ---------------------------------------------------------------------------------------------------------------- flicker
// The image's flicker (docs/progress/HORIZON-FLICKER.md): not a move but a change of brightness that comes and goes — a cell
// lit one frame, dark the next. On a fine grid of cells, each cell's mean luminance over the frames and how far each frame's
// stands from its neighbours' mean (|m_k − (m_{k−1} + m_{k+1}) / 2| — a slide or a slow change of light gives none, a blink
// all of it); and each pixel's own (the same second difference, a cell's mean — a fast slide of texture gives some too: read
// it on the far ground, or with the flight held). The blink's strongest frequency says which cycle it follows.

export interface FlickerCell {
  col: number;
  row: number;
  cx: number;
  cy: number;
  /** the cell's mean luminance [grey levels] */
  mean: number;
  /** the cell mean's blink: the root mean square of its second difference [grey levels] */
  blink: number;
  /** its 95th percentile */
  blinkP95: number;
  /** the pixels' own: the mean of |second difference| [grey levels] */
  pix: number;
  /** the blink's strongest frequency [Hz] and its share of the power */
  freqHz: number;
  share: number;
}

/** The cells' flicker over the frames (grey, w × h; `fps` their rate). */
export function flickerCells(frames: Uint8Array[], w: number, h: number, fps: number, cell = 32): FlickerCell[] {
  const cols = Math.floor(w / cell),
    rows = Math.floor(h / cell);
  const n = frames.length;
  const means = Array.from({ length: cols * rows }, () => new Float64Array(n));
  const pix = new Float64Array(cols * rows);
  for (let k = 0; k < n; k++) {
    const f = frames[k]!;
    const a = k > 0 && k < n - 1 ? frames[k - 1]! : null,
      b = a ? frames[k + 1]! : null;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let s = 0,
          d = 0;
        for (let y = r * cell; y < (r + 1) * cell; y++) {
          const row = y * w;
          for (let x = c * cell; x < (c + 1) * cell; x++) {
            const v = f[row + x]!;
            s += v;
            if (a) d += Math.abs(v - 0.5 * (a[row + x]! + b![row + x]!));
          }
        }
        means[r * cols + c]![k] = s / (cell * cell);
        if (a) pix[r * cols + c]! += d / (cell * cell) / (n - 2);
      }
  }
  return means.map((m, i) => {
    const sd: number[] = [];
    for (let k = 1; k < n - 1; k++) sd.push(m[k]! - 0.5 * (m[k - 1]! + m[k + 1]!));
    const abs = sd.map(Math.abs).sort((x, y) => x - y);
    const pk = sd.length >= 8 ? spectrumPeak(sd, fps) : { freqHz: Number.NaN, share: 0 };
    return {
      col: i % cols,
      row: Math.floor(i / cols),
      cx: ((i % cols) + 0.5) / cols,
      cy: (Math.floor(i / cols) + 0.5) / rows,
      mean: m.reduce((x, y) => x + y, 0) / n,
      blink: Math.sqrt(sd.reduce((x, y) => x + y * y, 0) / Math.max(sd.length, 1)),
      blinkP95: abs[Math.floor(0.95 * (abs.length - 1))] ?? 0,
      pix: pix[i]!,
      freqHz: pk.freqHz,
      share: pk.share,
    };
  });
}

/** A series' strongest frequency [Hz] (a plain DFT at the frames' mean rate, up to Nyquist) and its share of the power. */
export function spectrumPeak(r: number[], fps: number) {
  const n = r.length;
  const m = r.reduce((a, b) => a + b, 0) / n;
  const bins = Math.min(128, n >> 1);
  let best = 0,
    bestP = 0,
    total = 0;
  for (let b = 1; b <= bins; b++) {
    const f = (0.5 * b) / bins;
    let re = 0,
      im = 0;
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * f * i;
      re += (r[i]! - m) * Math.cos(a);
      im += (r[i]! - m) * Math.sin(a);
    }
    const p = re * re + im * im;
    total += p;
    if (p > bestP) {
      bestP = p;
      best = f;
    }
  }
  return { freqHz: best * fps, share: total > 0 ? bestP / total : 0 };
}

/** The flicker made visible: each frame's |second difference| per pixel, amplified (grey frames, the first and last black). */
export function flickerFrames(frames: Uint8Array[], gain = 8): Uint8Array[] {
  return frames.map((f, k) => {
    const o = new Uint8Array(f.length);
    if (k === 0 || k === frames.length - 1) return o;
    const a = frames[k - 1]!,
      b = frames[k + 1]!;
    for (let i = 0; i < f.length; i++) o[i] = Math.min(255, Math.abs(f[i]! - 0.5 * (a[i]! + b[i]!)) * gain);
    return o;
  });
}

/** A grid of one figure per cell, rows top to bottom (for the reports). */
export function cellGrid(cells: FlickerCell[], pick: (c: FlickerCell) => number, digits = 1) {
  const rows = Math.max(...cells.map((c) => c.row)) + 1;
  return Array.from({ length: rows }, (_, r) =>
    cells
      .filter((c) => c.row === r)
      .sort((a, b) => a.col - b.col)
      .map((c) => {
        const v = pick(c);
        return Number.isFinite(v) ? v.toFixed(digits).padStart(4) : "   ·";
      })
      .join(""),
  );
}

export interface RowFlicker {
  /** the row [analysed px], its mean luminance, its mean's blink (rms of the second difference), the blink's lag-1
   *  autocorrelation (−2/3: a fresh random change each frame; near −1: every other frame; > 0: slow) */
  y: number;
  lum: number;
  blink: number;
  ac1: number;
}

/**
 * Each row's flicker over its middle columns (x0 … x1 as fractions of the width): a band whose brightness or edge jumps
 * coherently along the whole row — what a cell's mean averages away less than a row's.
 */
export function rowFlicker(frames: Uint8Array[], w: number, h: number, x0 = 0.15, x1 = 0.85): RowFlicker[] {
  const a = Math.round(x0 * w),
    b = Math.round(x1 * w);
  const n = frames.length;
  const out: RowFlicker[] = [];
  for (let y = 0; y < h; y++) {
    const m: number[] = [];
    for (let k = 0; k < n; k++) {
      let s = 0;
      const f = frames[k]!;
      for (let x = a; x < b; x++) s += f[y * w + x]!;
      m.push(s / (b - a));
    }
    const sd = m.slice(1, -1).map((v, i) => v - 0.5 * (m[i]! + m[i + 2]!));
    const e = sd.reduce((p, q) => p + q * q, 0);
    out.push({
      y,
      lum: m.reduce((p, q) => p + q, 0) / Math.max(n, 1),
      blink: Math.sqrt(e / Math.max(sd.length, 1)),
      ac1: e > 0 ? sd.slice(1).reduce((p, q, i) => p + q * sd[i]!, 0) / e : 0,
    });
  }
  return out;
}

/** The rows' strongest band: its rows (from, to, peak — over 3 × the rows' median blink), the peak's blink and ac1. */
export function rowBand(rows: RowFlicker[]) {
  const med = [...rows].map((r) => r.blink).sort((p, q) => p - q)[rows.length >> 1] ?? 0;
  const peak = rows.reduce((p, r) => (r.blink > p.blink ? r : p), rows[0]!);
  let from = peak.y,
    to = peak.y;
  while (from > 0 && rows[from - 1]!.blink > 3 * med) from--;
  while (to < rows.length - 1 && rows[to + 1]!.blink > 3 * med) to++;
  return { from, to, peak: peak.y, blink: peak.blink, ac1: peak.ac1, median: med };
}
