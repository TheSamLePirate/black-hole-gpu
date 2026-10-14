// A QR code (ISO/IEC 18004) of a room's link, for a phone or a tablet to join by its camera (docs/PLAN-RESEAU.md
// R4): byte mode, error correction M, versions 1 to 10 (up to 213 bytes), the mask of least penalty. Small and
// ours — in the network's module, loaded on demand.

const EC_M: Record<number, { ec: number; groups: [number, number][] }> = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: {
    ec: 22,
    groups: [
      [2, 38],
      [2, 39],
    ],
  },
  9: {
    ec: 22,
    groups: [
      [3, 36],
      [2, 37],
    ],
  },
  10: {
    ec: 26,
    groups: [
      [4, 43],
      [1, 44],
    ],
  },
};
const ALIGN: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// GF(256), the polynomial 0x11d
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a]! + LOG[b]!]! : 0);

/** The Reed–Solomon error-correction codewords of a block. */
function rsEc(data: number[], n: number): number[] {
  // the generator: Π (x − α^i), i < n
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j]!;
      next[j + 1] ^= mul(g[j]!, EXP[i]!);
    }
    g = next;
  }
  const r = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ r[0]!;
    r.shift();
    r.push(0);
    for (let j = 0; j < n; j++) r[j] ^= mul(g[j + 1]!, f);
  }
  return r;
}

const capacity = (v: number) => EC_M[v]!.groups.reduce((a, [n, k]) => a + n * k, 0);

/** The codewords of a text in a version: the data blocks interleaved, then their error correction. */
function codewords(bytes: Uint8Array, v: number): number[] {
  const bits: number[] = [];
  const put = (x: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((x >> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = capacity(v) * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let p = 0; data.length < capacity(v); p++) data.push(p % 2 ? 0x11 : 0xec);
  const { ec, groups } = EC_M[v]!;
  const blocks: number[][] = [];
  let k = 0;
  for (const [n, size] of groups)
    for (let i = 0; i < n; i++) {
      blocks.push(data.slice(k, k + size));
      k += size;
    }
  const ecs = blocks.map((b) => rsEc(b, ec));
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ec; i++) for (const e of ecs) out.push(e[i]!);
  return out;
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** BCH remainder of x · 2^(deg g) by g */
function bch(x: number, g: number) {
  const deg = (n: number) => 31 - Math.clz32(n);
  let r = x << deg(g);
  while (deg(r) >= deg(g)) r ^= g << (deg(r) - deg(g));
  return r;
}

/** A matrix (true: dark) of a text: version chosen (or given), mask of least penalty (or given). */
export function qr(text: string, o: { version?: number; mask?: number } = {}): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let v = o.version ?? 1;
  if (o.version === undefined) while (v <= 10 && capacity(v) < bytes.length + (v < 10 ? 2 : 3)) v++;
  if (v > 10 || capacity(v) < bytes.length + 2) throw new Error("qr: too long");
  const n = 17 + 4 * v;
  const M: (boolean | null)[][] = Array.from({ length: n }, () => new Array(n).fill(null));
  const fixed: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  const set = (r: number, c: number, d: boolean) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    M[r]![c] = d;
    fixed[r]![c] = true;
  };
  // the finders and their separators
  for (const [r0, c0] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ] as const)
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(r0 + r, c0 + c, ring !== 2 && ring !== 4);
      }
  // the timing patterns
  for (let i = 8; i < n - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // the alignment patterns
  const A = ALIGN[v]!;
  for (const r of A)
    for (const c of A) {
      if ((r === 6 && c === 6) || (r === 6 && c === A[A.length - 1]) || (r === A[A.length - 1] && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  // the dark module; the format's and the version's places reserved
  set(4 * v + 9, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!fixed[8]![i]) set(8, i, false);
    if (!fixed[i]![8]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(8, n - 1 - i, false);
    if (!fixed[n - 1 - i]![8]) set(n - 1 - i, 8, false);
  }
  if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) set(i, n - 11 + j, false), set(n - 11 + j, i, false);
  // the data, in pairs of columns from the right, up then down
  const cw = codewords(bytes, v);
  const bits: boolean[] = [];
  for (const b of cw) for (let i = 7; i >= 0; i--) bits.push(((b >> i) & 1) === 1);
  let k = 0;
  let up = true;
  for (let c = n - 1; c > 0; c -= 2) {
    if (c === 6) c--;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (const cc of [c, c - 1]) {
        if (fixed[r]![cc]) continue;
        M[r]![cc] = k < bits.length ? bits[k]! : false;
        k++;
      }
    }
    up = !up;
  }
  const withMask = (m: number) => {
    const X = M.map((row, r) => row.map((d, c) => (fixed[r]![c] ? !!d : !!d !== MASKS[m]!(r, c))));
    // the format: M (00) and the mask, BCH(15,5), its mask 0x5412 — twice
    const f5 = (0b00 << 3) | m;
    const fmt = ((f5 << 10) | bch(f5, 0x537)) ^ 0x5412;
    const bit = (i: number) => ((fmt >> i) & 1) === 1;
    // the first copy round the top-left finder; the second split under the top-right and beside the bottom-left
    for (let i = 0; i <= 5; i++) X[i]![8] = bit(i);
    X[7]![8] = bit(6);
    X[8]![8] = bit(7);
    X[8]![7] = bit(8);
    for (let i = 9; i < 15; i++) X[8]![14 - i] = bit(i);
    for (let i = 0; i < 8; i++) X[8]![n - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) X[n - 15 + i]![8] = bit(i);
    X[n - 8]![8] = true;
    // the version (7 and up): BCH(18,6), in two 6 × 3 blocks
    if (v >= 7) {
      const ver = (v << 12) | bch(v, 0x1f25);
      for (let i = 0; i < 18; i++) {
        const d = ((ver >> i) & 1) === 1;
        const a = Math.floor(i / 3),
          b = (i % 3) + n - 11;
        X[a]![b] = d;
        X[b]![a] = d;
      }
    }
    return X;
  };
  if (o.mask !== undefined) return withMask(o.mask);
  let best: boolean[][] | null = null;
  let bp = Infinity;
  for (let m = 0; m < 8; m++) {
    const X = withMask(m);
    const p = penalty(X);
    if (p < bp) (bp = p), (best = X);
  }
  return best!;
}

/** The standard's four penalties: runs of five and more, 2 × 2 blocks, finder-like runs, the balance. */
function penalty(X: boolean[][]): number {
  const n = X.length;
  let p = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i < n; i++) {
      if (get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) p += run - 2;
        run = 1;
      }
    }
    if (run >= 5) p += run - 2;
    const pat = [true, false, true, true, true, false, true];
    for (let i = 0; i + 10 < n; i++) {
      const at = (j: number) => get(i + j);
      const core = pat.every((b, j) => at(j) === b);
      const core2 = pat.every((b, j) => at(j + 4) === b);
      if (core && !at(7) && !at(8) && !at(9) && !at(10)) p += 40;
      if (core2 && !at(0) && !at(1) && !at(2) && !at(3)) p += 40;
    }
  };
  for (let r = 0; r < n; r++) line((i) => X[r]![i]!);
  for (let c = 0; c < n; c++) line((i) => X[i]![c]!);
  for (let r = 0; r + 1 < n; r++)
    for (let c = 0; c + 1 < n; c++) {
      const d = X[r]![c];
      if (X[r]![c + 1] === d && X[r + 1]![c] === d && X[r + 1]![c + 1] === d) p += 3;
    }
  let dark = 0;
  for (const row of X) for (const d of row) if (d) dark++;
  p += Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10;
  return p;
}

/** The QR code as an SVG (dark modules, a quiet zone of 4). */
export function qrSvg(text: string, px = 4): string {
  const X = qr(text);
  const n = X.length;
  const q = 4;
  let d = "";
  X.forEach((row, r) => row.forEach((on, c) => on && (d += `M${c + q} ${r + q}h1v1h-1z`)));
  const s = (n + 2 * q) * px;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
