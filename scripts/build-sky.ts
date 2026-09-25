/**
 * Builds the real-sky data used by the renderer from two public sources:
 *
 *   - NASA/GSFC SVS "Deep Star Maps 2020" Milky Way background (celestial coordinates, Gaia DR2
 *     stars fainter than Hipparcos/Tycho, linear half float): milkyway_2020_8k.exr
 *     https://svs.gsfc.nasa.gov/4851 — credit NASA/Goddard SVS, Gaia DR2: ESA/Gaia/DPAC
 *   - HYG star database v4.4 (Hipparcos, Yale Bright Star, Gliese; CC BY-SA 4.0): hyg_v44.csv.gz
 *     https://codeberg.org/astronexus/hyg
 *
 * Outputs (gzip-compressed binaries in assets/sky/):
 *   milkyway.webp  4096×2048 equirectangular map, log-encoded (8 bits per channel over 16 stops:
 *                  v = 2^(16·c − 16)); decoded to linear half floats + mips on the GPU
 *   stars.bin      point-source catalogue on a cube-map grid (direction, V magnitude, temperature)
 *   starlod.bin    2048×1024 map of the catalogue's radiance + mips (used when a pixel's lensed
 *                  footprint covers many stars)
 *
 * Map convention (checked against the catalogue): u = 0.5 − RA/360°, v = (90° − Dec)/180°.
 * Photometric scale: map value 0.1 ≈ 20 mag/arcsec² (bright Milky Way star clouds, V band), so a
 * star of magnitude m has flux 10^(−0.4 m) / 4250 in map-value·sr units.
 *
 * usage: bun scripts/build-sky.ts <dir with milkyway_2020_8k.exr and hyg_v44.csv.gz>
 */
import { $ } from "bun";
import { gunzipSync, gzipSync } from "node:zlib";
import { blackbodyXYZ, xyzToLinearSRGB } from "../src/physics";

const SRC = process.argv[2];
if (!SRC) throw new Error("usage: bun scripts/build-sky.ts <source dir>");
const OUT = new URL("../assets/sky/", import.meta.url).pathname;
await $`mkdir -p ${OUT}`;

export const STAR_FLUX_SCALE = 1 / 4250;
const MAP_W = 4096;
const MAP_H = 2048;
const LOD_W = 2048;
const LOD_H = 1024;
const GRID = 128; // cube-map cells per face edge

// ------------------------------------------------------------------------------------ helpers
function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** Shared-exponent packing (WebGPU rgb9e5ufloat, EXT_texture_shared_exponent). */
function packRGB9E5(r: number, g: number, b: number): number {
  const MAX = (511 / 512) * 65536;
  const rc = Math.min(Math.max(r, 0), MAX);
  const gc = Math.min(Math.max(g, 0), MAX);
  const bc = Math.min(Math.max(b, 0), MAX);
  const maxc = Math.max(rc, gc, bc);
  let e = Math.max(-16, Math.floor(Math.log2(Math.max(maxc, 1e-30)))) + 1 + 15;
  if (Math.floor(maxc / 2 ** (e - 24) + 0.5) === 512) e++;
  const d = 2 ** (e - 24);
  const q = (v: number) => Math.min(511, Math.floor(v / d + 0.5));
  return (q(rc) | (q(gc) << 9) | (q(bc) << 18) | (e << 27)) >>> 0;
}

/** Mip chain of an RGB float image (2×2 box filter), each level packed as rgb9e5. */
function mipChain(img: Float32Array, w: number, h: number): { data: Uint32Array; levels: number } {
  const levels: Float32Array[] = [img];
  const dims: [number, number][] = [[w, h]];
  while (dims.at(-1)![0] > 1 || dims.at(-1)![1] > 1) {
    const [pw, ph] = dims.at(-1)!;
    const src = levels.at(-1)!;
    const nw = Math.max(1, pw >> 1);
    const nh = Math.max(1, ph >> 1);
    const dst = new Float32Array(nw * nh * 3);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++)
        for (let c = 0; c < 3; c++) {
          let s = 0;
          let n = 0;
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
              const sx = Math.min(pw - 1, 2 * x + dx);
              const sy = Math.min(ph - 1, 2 * y + dy);
              s += src[(sy * pw + sx) * 3 + c]!;
              n++;
            }
          dst[(y * nw + x) * 3 + c] = s / n;
        }
    levels.push(dst);
    dims.push([nw, nh]);
  }
  const total = dims.reduce((a, [lw, lh]) => a + lw * lh, 0);
  const data = new Uint32Array(total);
  let o = 0;
  for (const lv of levels) for (let i = 0; i < lv.length / 3; i++) data[o++] = packRGB9E5(lv[i * 3]!, lv[i * 3 + 1]!, lv[i * 3 + 2]!);
  return { data, levels: levels.length };
}

/** File: "SKY1", u32 width, height, mip levels, then the packed texels; gzip-compressed. */
async function writeTexture(name: string, img: Float32Array, w: number, h: number) {
  const { data, levels } = mipChain(img, w, h);
  const head = new Uint32Array([0x31594b53, w, h, levels]);
  const buf = new Uint8Array(16 + data.byteLength);
  buf.set(new Uint8Array(head.buffer), 0);
  buf.set(new Uint8Array(data.buffer), 16);
  const gz = gzipSync(buf, { level: 9 });
  await Bun.write(OUT + name, gz);
  console.log(`${name}: ${w}×${h}, ${levels} levels, ${(gz.byteLength / 1e6).toFixed(1)} MB`);
}

// ------------------------------------------------------------------------------------ Milky Way
async function milkyWay() {
  const tmp = `${OUT}.mw_raw.exr`;
  await $`oiiotool ${SRC}/milkyway_2020_8k.exr --ch R,G,B -d half --compression none -o ${tmp}`.quiet();
  const b = new Uint8Array(await Bun.file(tmp).arrayBuffer());
  await $`rm ${tmp}`;
  const dv = new DataView(b.buffer);
  let i = 8;
  const attrs: Record<string, Uint8Array> = {};
  const cstr = () => {
    const j = b.indexOf(0, i);
    const s = new TextDecoder().decode(b.subarray(i, j));
    i = j + 1;
    return s;
  };
  while (b[i] !== 0) {
    const name = cstr();
    cstr();
    const size = dv.getInt32(i, true);
    i += 4;
    attrs[name] = b.subarray(i, i + size);
    i += size;
  }
  i++;
  const win = new DataView(attrs.dataWindow!.buffer, attrs.dataWindow!.byteOffset);
  const W = win.getInt32(8, true) - win.getInt32(0, true) + 1;
  const H = win.getInt32(12, true) - win.getInt32(4, true) + 1;
  // channel names in file order
  const names: string[] = [];
  const ch = attrs.channels!;
  for (let k = 0; ch[k] !== 0; ) {
    const j = ch.indexOf(0, k);
    names.push(new TextDecoder().decode(ch.subarray(k, j)));
    k = j + 1 + 16;
  }
  const order = ["R", "G", "B"].map((n) => names.indexOf(n));
  const full = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const off = Number(dv.getBigUint64(i + y * 8, true));
    const row = dv.getInt32(off, true);
    const base = off + 8;
    for (let c = 0; c < 3; c++) {
      const cOff = base + order[c]! * W * 2;
      for (let x = 0; x < W; x++) full[(row * W + x) * 3 + c] = halfToFloat(dv.getUint16(cOff + x * 2, true));
    }
  }
  // box-downsample to MAP_W × MAP_H
  const fx = W / MAP_W;
  const fy = H / MAP_H;
  const img = new Float32Array(MAP_W * MAP_H * 3);
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let dy = 0; dy < fy; dy++) for (let dx = 0; dx < fx; dx++) s += full[((y * fy + dy) * W + x * fx + dx) * 3 + c]!;
        img[(y * MAP_W + x) * 3 + c] = s / (fx * fy);
      }
  // log encoding c = (log2 v + 16) / 16, 0 → black; WebP (lossy, high quality): the map's own grain of
  // faint Gaia stars hides the ±2 % quantisation, and the file is ~10× smaller than a float format.
  const ppm = new Uint8Array(MAP_W * MAP_H * 3 + 32);
  const header = new TextEncoder().encode(`P6\n${MAP_W} ${MAP_H}\n255\n`);
  ppm.set(header, 0);
  for (let k = 0; k < MAP_W * MAP_H * 3; k++) {
    const v = img[k]!;
    ppm[header.length + k] = v <= 2 ** -16 ? 0 : Math.min(255, Math.max(1, Math.round(((Math.log2(v) + 16) / 16) * 255)));
  }
  const tmpPpm = `${OUT}.mw.ppm`;
  await Bun.write(tmpPpm, ppm.subarray(0, header.length + MAP_W * MAP_H * 3));
  await $`magick ${tmpPpm} -quality 92 -define webp:method=6 ${OUT}milkyway.webp`.quiet();
  await $`rm ${tmpPpm}`;
  console.log(`milkyway.webp: ${MAP_W}×${MAP_H}, ${(Bun.file(OUT + "milkyway.webp").size / 1e6).toFixed(1)} MB`);
}

// ------------------------------------------------------------------------------------ stars
/** Effective temperature from the B−V colour index (Ballesteros 2012). */
export function bvToTemperature(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/** Cube-map cell of a unit vector — must match faceUV() in trace.wgsl. */
function cubeCell(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face: number;
  let u: number;
  let v: number;
  if (ax >= ay && ax >= az) {
    face = x < 0 ? 1 : 0;
    u = y / ax;
    v = z / ax;
  } else if (ay >= az) {
    face = y < 0 ? 3 : 2;
    u = x / ay;
    v = z / ay;
  } else {
    face = z < 0 ? 5 : 4;
    u = x / az;
    v = y / az;
  }
  const cx = Math.min(GRID - 1, Math.floor((u * 0.5 + 0.5) * GRID));
  const cy = Math.min(GRID - 1, Math.floor((v * 0.5 + 0.5) * GRID));
  return (face * GRID + cy) * GRID + cx;
}

function f16(v: number): number {
  const f = new Float32Array([v]);
  const x = new Uint32Array(f.buffer)[0]!;
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  const m = x & 0x7fffff;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7c00;
  const r = m & 0x1fff;
  let hm = m >>> 13;
  if (r > 0x1000 || (r === 0x1000 && hm & 1)) hm++;
  if (hm === 0x400) {
    hm = 0;
    e++;
  }
  return sign | (e << 10) | hm;
}

async function stars() {
  const csv = new TextDecoder().decode(gunzipSync(new Uint8Array(await Bun.file(`${SRC}/hyg_v44.csv.gz`).arrayBuffer())));
  const lines = csv.split("\n");
  const head = lines[0]!.split(",").map((s) => s.replace(/"/g, ""));
  const col = (n: string) => head.indexOf(n);
  const [iId, iRa, iDec, iMag, iCi] = ["id", "ra", "dec", "mag", "ci"].map(col) as number[];
  type Star = { x: number; y: number; z: number; mag: number; T: number; cell: number };
  const list: Star[] = [];
  for (let k = 1; k < lines.length; k++) {
    const line = lines[k]!;
    if (!line) continue;
    // fields may be quoted but never contain commas in the columns used here
    const f = line.split(",");
    if (f[iId!] === "0") continue; // the Sun
    const mag = parseFloat(f[iMag!]!);
    if (!Number.isFinite(mag)) continue;
    const ra = (parseFloat(f[iRa!]!) * 15 * Math.PI) / 180;
    const dec = (parseFloat(f[iDec!]!) * Math.PI) / 180;
    const bv = parseFloat(f[iCi!]!);
    const T = Math.min(40000, Math.max(2000, bvToTemperature(Number.isFinite(bv) ? bv : 0.65)));
    const x = Math.cos(dec) * Math.cos(ra);
    const y = Math.cos(dec) * Math.sin(ra);
    const z = Math.sin(dec);
    list.push({ x, y, z, mag, T, cell: cubeCell(x, y, z) });
  }
  list.sort((a, b) => a.cell - b.cell || a.mag - b.mag);
  const cells = 6 * GRID * GRID;
  const start = new Uint32Array(cells + 1);
  for (const s of list) start[s.cell + 1]!++;
  for (let c = 0; c < cells; c++) start[c + 1]! += start[c]!;
  const recs = new Uint32Array(list.length * 4);
  const fv = new Float32Array(recs.buffer);
  list.forEach((s, k) => {
    fv[k * 4] = s.x;
    fv[k * 4 + 1] = s.y;
    fv[k * 4 + 2] = s.z;
    recs[k * 4 + 3] = (f16(s.mag) | (f16(s.T / 1000) << 16)) >>> 0;
  });
  const headU = new Uint32Array([0x31525453, GRID, list.length, 0]);
  const buf = new Uint8Array(16 + start.byteLength + recs.byteLength);
  buf.set(new Uint8Array(headU.buffer), 0);
  buf.set(new Uint8Array(start.buffer), 16);
  buf.set(new Uint8Array(recs.buffer), 16 + start.byteLength);
  const gz = gzipSync(buf, { level: 9 });
  await Bun.write(OUT + "stars.bin", gz);
  let maxPer = 0;
  for (let c = 0; c < cells; c++) maxPer = Math.max(maxPer, start[c + 1]! - start[c]!);
  console.log(`stars.bin: ${list.length} stars, ${GRID}² cells/face, max ${maxPer} per cell, ${(gz.byteLength / 1e6).toFixed(1)} MB`);

  // Radiance map of the catalogue for large footprints (flux conserved per texel)
  const lod = new Float32Array(LOD_W * LOD_H * 3);
  const colour = new Map<number, number[]>();
  for (const s of list) {
    const key = Math.round(s.T / 50) * 50;
    let rgb = colour.get(key);
    if (!rgb) {
      const xyz = blackbodyXYZ(key);
      rgb = xyzToLinearSRGB([xyz[0] / xyz[1], 1, xyz[2] / xyz[1]]).map((v) => Math.max(v, 0));
      colour.set(key, rgb);
    }
    const ra = Math.atan2(s.y, s.x);
    const dec = Math.asin(s.z);
    const u = (((0.5 - ra / (2 * Math.PI)) % 1) + 1) % 1;
    const v = (Math.PI / 2 - dec) / Math.PI;
    const px = Math.min(LOD_W - 1, Math.floor(u * LOD_W));
    const py = Math.min(LOD_H - 1, Math.floor(v * LOD_H));
    const omega = ((2 * Math.PI) / LOD_W) * (Math.PI / LOD_H) * Math.max(Math.sin(((py + 0.5) / LOD_H) * Math.PI), 1e-4);
    const flux = 10 ** (-0.4 * s.mag) * STAR_FLUX_SCALE;
    for (let c = 0; c < 3; c++) lod[(py * LOD_W + px) * 3 + c]! += (flux * rgb[c]!) / omega;
  }
  await writeTexture("starlod.bin", lod, LOD_W, LOD_H);
}

await stars();
await milkyWay();
