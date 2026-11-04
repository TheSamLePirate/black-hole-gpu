// T7 — the sea's water by region (docs/PLAN-REFRACTION-HORIZONS.md T7; the coast survey of 4 Nov 2026: the Channel and the
// Mont-Saint-Michel's bay drawn as a clear tropical lagoon): the diffuse attenuation of the light at 490 nm, Kd490 [1/m], a
// climatology from ESA's Ocean Colour CCI v6 (monthly, 4 km; served by NOAA PIFSC's ERDDAP, esa-cci-kd-monthly-v6-0) — the
// geometric mean of the months of YEARS at 1/12°; the cells without a value (land, the coasts' flagged pixels, the ice) given
// their nearest sea's, by rings, so that a coast reads its own water; stored as the log of Kd over [KD_MIN, KD_MAX] on 8 bits,
// 4 320 × 2 160, west to east from −180°, north to south from 90° (trace.wgsl seaKd490).
//   bun scripts/build-water-kd.ts [--years 2020,2021] [--cache /tmp/kd]   → assets/earth/water-kd490.png
// Data: ESA Ocean Colour CCI (Sathyendranath et al. 2019, doi:10.3390/s19194285), CC BY 4.0 — credited in assets/earth/README.md.
import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";

import { KD_MAX, KD_MIN, WATER_H as H, WATER_W as W } from "../src/system/water-kd-grid";
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1]! : d;
};
const YEARS = arg("--years", "2020,2021").split(",").map(Number);
const CACHE = arg("--cache", "/tmp/kd");
mkdirSync(CACHE, { recursive: true });
const URL =
  "https://oceanwatch.pifsc.noaa.gov/erddap/griddap/esa-cci-kd-monthly-v6-0.dods?kd_490%5B(DATE):1:(DATE)%5D%5B(89.97916666666667):2:(-89.97916666666666)%5D%5B(0.020833333333314386):2:(359.97916666666663)%5D";

/** one month's grid (OPeNDAP binary: the header, "Data:\n", then the array's two counts and its big-endian floats) */
async function month(y: number, m: number): Promise<Float32Array> {
  const date = `${y}-${String(m).padStart(2, "0")}-01`;
  const f = `${CACHE}/${date}.dods`;
  if (!existsSync(f)) {
    for (let k = 0; ; k++) {
      const r = await fetch(URL.replaceAll("DATE", date));
      if (r.ok) {
        await Bun.write(f, await r.arrayBuffer());
        break;
      }
      if (k >= 3) throw new Error(`${date}: HTTP ${r.status}`);
      await Bun.sleep(5000 * (k + 1));
    }
  }
  const b = new Uint8Array(await Bun.file(f).arrayBuffer());
  const mark = new TextEncoder().encode("\nData:\n");
  let at = -1;
  for (let i = 0; i < 4096 && at < 0; i++) if (mark.every((c, j) => b[i + j] === c)) at = i + mark.length;
  if (at < 0) throw new Error(`${date}: no data section`);
  const v = new DataView(b.buffer, b.byteOffset + at);
  const n = v.getUint32(0);
  if (n !== W * H) throw new Error(`${date}: ${n} values, ${W * H} expected`);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getFloat32(8 + 4 * i);
  return out;
}

const sum = new Float64Array(W * H);
const cnt = new Uint16Array(W * H);
for (const y of YEARS)
  for (let m = 1; m <= 12; m++) {
    const g = await month(y, m);
    let valid = 0;
    for (let i = 0; i < g.length; i++) {
      const k = g[i]!;
      if (Number.isFinite(k) && k > 0) {
        sum[i] += Math.log(Math.min(Math.max(k, KD_MIN), KD_MAX));
        cnt[i]++;
        valid++;
      }
    }
    console.log(`${y}-${m}: ${valid} cells`);
  }

// (the grid from 0° east → from −180°: the source's column c at lon 0.0417 + c/12)
const lnK = new Float32Array(W * H).fill(Number.NaN);
for (let r = 0; r < H; r++)
  for (let c = 0; c < W; c++) {
    const s = r * W + ((c + W / 2) % W);
    if (cnt[s]) lnK[r * W + c] = sum[s] / cnt[s];
  }
// (the cells without a value: their known neighbours' mean, ring after ring — the east–west wrap kept)
let todo = 0;
for (let i = 0; i < lnK.length; i++) if (Number.isNaN(lnK[i]!)) todo++;
console.log(`filling ${todo} cells`);
// (3 rings — ~25 km: the coasts', the lakes' far inland left to the open sea's mean below)
for (let ring = 0; todo > 0 && ring < 3; ring++) {
  const next = lnK.slice();
  let filled = 0;
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (!Number.isNaN(lnK[i]!)) continue;
      let s = 0,
        n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= H) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const v = lnK[rr * W + ((c + dc + W) % W)]!;
          if (!Number.isNaN(v)) {
            s += v;
            n++;
          }
        }
      }
      if (n) {
        next[i] = s / n;
        filled++;
      }
    }
  lnK.set(next);
  todo -= filled;
  if (!filled) break;
}
const a = Math.log(KD_MIN);
for (let i = 0; i < lnK.length; i++) if (Number.isNaN(lnK[i]!)) lnK[i] = Math.log(0.05);
const span = Math.log(KD_MAX) - a;
const gray = new Uint8Array(W * H);
for (let i = 0; i < gray.length; i++) {
  const v = lnK[i]!;
  gray[i] = Number.isNaN(v) ? 0 : Math.round(Math.min(Math.max((v - a) / span, 0), 1) * 255);
}
await Bun.write(`${CACHE}/kd.gray`, gray);
const out = "assets/earth/water-kd490.png";
// (a 3 × 3 median: the months' speckle out — the plumes' edges kept —, the file a quarter lighter)
await $`magick -size ${W}x${H} -depth 8 gray:${CACHE}/kd.gray -statistic median 3x3 -define png:compression-level=9 ${out}`;
console.log(`${out}: ${(Bun.file(out).size / 1e6).toFixed(2)} MB`);
