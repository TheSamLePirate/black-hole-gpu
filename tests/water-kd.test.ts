import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { KD_MAX, KD_MIN, kdOfByte, WATER_H, WATER_W, waterCell, waterTable } from "../src/system/water-kd-grid";

// T7 — the sea's water by region (system/water-kd-grid.ts; trace.wgsl seaKd490): the bytes packed three a float, every one read
// back the same; the map's own values where the waters are known.

test("the table: three bytes a float, exact, every cell read back the same (as waterCell reads it in the tracer)", () => {
  const bytes = new Uint8Array(WATER_W * WATER_H);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761) >>> 24;
  const t = waterTable(bytes);
  expect(t[0]).toBe(1);
  for (const n of [0, 1, 2, 3, 11, 12, 13, 4321, bytes.length - 1, bytes.length - 2]) expect(waterCell(t, n)).toBe(bytes[n]!);
  // (never a float the GPU would mangle: integers under 2²⁴)
  let most = 0;
  for (let i = 4; i < t.length; i++) most = Math.max(most, t[i]!);
  expect(most).toBeLessThan(2 ** 24);
  expect(kdOfByte(0)).toBeCloseTo(KD_MIN, 6);
  expect(kdOfByte(255)).toBeCloseTo(KD_MAX, 4);
});

test("the map: the open ocean clear, the Channel and a river's plume turbid (ESA's Ocean Colour CCI)", async () => {
  // (decoded here — an 8-bit grey PNG: its IDAT inflated, its rows' filters undone —: ImageMagick spawned came back empty
  // under bun test --parallel on the lab's Mac mini, and a CI runner has no \`magick\`)
  const raw = decodeGrayPng(new Uint8Array(await Bun.file(`${import.meta.dir}/../assets/earth/water-kd490.png`).arrayBuffer()));
  expect(raw.length).toBe(WATER_W * WATER_H);
  const kd = (lat: number, lon: number) => {
    const x = Math.floor(((lon + 180) / 360) * WATER_W),
      y = Math.floor(((90 - lat) / 180) * WATER_H);
    return kdOfByte(raw[y * WATER_W + x]!);
  };
  // (the South Pacific's gyre: among the clearest waters of the world)
  expect(kd(-25, -120)).toBeLessThan(0.03);
  // (the Sargasso Sea)
  expect(kd(28, -60)).toBeLessThan(0.04);
  // (the Channel off Étretat, the Mont-Saint-Michel's bay, the Gironde's mouth: coastal, turbid)
  expect(kd(49.9, 0.0)).toBeGreaterThan(0.1);
  expect(kd(48.75, -1.65)).toBeGreaterThan(0.2);
  expect(kd(45.6, -1.15)).toBeGreaterThan(0.3);
  // (the Rio de la Plata)
  expect(kd(-35.2, -56.5)).toBeGreaterThan(0.8);
});

/** An 8-bit greyscale, non-interlaced PNG's pixels (the map's own format) */
function decodeGrayPng(png: Uint8Array): Uint8Array {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8,
    w = 0,
    h = 0;
  const idat: Uint8Array[] = [];
  while (p < png.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    const data = png.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(p + 8);
      h = dv.getUint32(p + 12);
      if (data[8] !== 8 || data[9] !== 0 || data[12] !== 0) throw new Error("not an 8-bit grey, non-interlaced PNG");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const z = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  idat.reduce((o, d) => (z.set(d, o), o + d.length), 0);
  const f = inflateSync(z);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ft = f[y * (w + 1)]!;
    const src = f.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    const row = out.subarray(y * w, (y + 1) * w);
    const up = y ? out.subarray((y - 1) * w, y * w) : new Uint8Array(w);
    for (let x = 0; x < w; x++) {
      const a = x ? row[x - 1]! : 0,
        b = up[x]!,
        c = x ? up[x - 1]! : 0;
      let v = src[x]!;
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const q = a + b - c,
          pa = Math.abs(q - a),
          pb = Math.abs(q - b),
          pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 255;
    }
  }
  return out;
}
