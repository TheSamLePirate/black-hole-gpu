// The tracer's blue noise (PLAN-GEANTES-VOLUME V6 — the random numbers of a sample beyond its first, trace.wgsl blueDraws):
// a 128 × 128 tile, four independent channels, each a ranking of the pixels by Ulichney's void-and-cluster (1993) — a
// Gaussian energy (σ 1.5, toroidal: the tile wraps), the initial pattern's clusters and voids swapped until stable, then its
// points ranked by removing the tightest clusters, the rest by filling the largest voids. Each channel's ranks [0, 16384)
// as little-endian uint16, interleaved RGBA, in assets/noise/blue-noise-128.bin (128 KiB); src/noise3d.ts writes them into
// the noise texture's last slice. Deterministic (its seeds below): the file rebuilt the same.
//   bun scripts/build-blue-noise.ts

import { mkdirSync, writeFileSync } from "node:fs";

const W = 128;
const N = W * W;
const SIGMA = 1.5;
const R = 6;

// (the Gaussian's weights within R of a pixel, the tile's wrap)
const K = new Float64Array((2 * R + 1) ** 2);
for (let dy = -R; dy <= R; dy++)
  for (let dx = -R; dx <= R; dx++) K[(dy + R) * (2 * R + 1) + dx + R] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function channel(seed: number): Uint16Array {
  const rnd = mulberry(seed);
  const add = (E: Float64Array, i: number, s: number) => {
    const x = i % W,
      y = (i / W) | 0;
    for (let dy = -R; dy <= R; dy++) {
      const yy = (((y + dy) % W) + W) % W;
      for (let dx = -R; dx <= R; dx++) E[yy * W + ((((x + dx) % W) + W) % W)]! += s * K[(dy + R) * (2 * R + 1) + dx + R]!;
    }
  };
  // (the tightest cluster: the set pixel of the highest energy; the largest void: the free one of the lowest)
  const extreme = (E: Float64Array, P: Uint8Array, set: number, max: boolean) => {
    let best = -1,
      v = max ? -Infinity : Infinity;
    for (let i = 0; i < N; i++) if (P[i] === set && (max ? E[i]! > v : E[i]! < v)) (v = E[i]!), (best = i);
    return best;
  };
  // the initial pattern: a tenth of the pixels at random, swapped until no cluster's removal makes a larger void
  const P = new Uint8Array(N);
  const E = new Float64Array(N);
  const ones = Math.floor(N / 10);
  for (let n = 0; n < ones; ) {
    const i = Math.floor(rnd() * N);
    if (P[i]) continue;
    P[i] = 1;
    add(E, i, 1);
    n++;
  }
  for (let it = 0; it < 10 * N; it++) {
    const c = extreme(E, P, 1, true);
    P[c] = 0;
    add(E, c, -1);
    const v = extreme(E, P, 0, false);
    P[v] = 1;
    add(E, v, 1);
    if (v === c) break;
  }
  const rank = new Uint16Array(N);
  // phase 1: the pattern's points ranked down, the tightest cluster removed each time
  {
    const p = P.slice(),
      e = E.slice();
    for (let r = ones - 1; r >= 0; r--) {
      const c = extreme(e, p, 1, true);
      p[c] = 0;
      add(e, c, -1);
      rank[c] = r;
    }
  }
  // phases 2–3: the rest ranked up, the largest void filled each time
  for (let r = ones; r < N; r++) {
    const v = extreme(E, P, 0, false);
    P[v] = 1;
    add(E, v, 1);
    rank[v] = r;
  }
  return rank;
}

const out = new Uint16Array(N * 4);
for (let c = 0; c < 4; c++) {
  const t0 = performance.now();
  const r = channel(0x9e3779b9 + c * 7919);
  for (let i = 0; i < N; i++) out[i * 4 + c] = r[i]!;
  console.log(`channel ${c}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
mkdirSync("assets/noise", { recursive: true });
writeFileSync("assets/noise/blue-noise-128.bin", new Uint8Array(out.buffer));
console.log("assets/noise/blue-noise-128.bin");
