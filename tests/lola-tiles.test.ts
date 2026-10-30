import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import { buildLola, createMoonTiles } from "../server/moon-tiles";
import { LOLA_TILE, lolaDecode, lolaEncode, lolaParent, lolaRows } from "../src/system/lola-codec";

// PLAN-PLANETES-AAA P6: the Moon's relief tiles — their codec, their coarser levels, a build from a model served in
// ranges (a synthetic one here, laid out as the USGS's GeoTIFF), their service.

const n = LOLA_TILE;
const dir = mkdtempSync(`${tmpdir()}/lola-`);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a tile's heights come back exact, cliffs and the int16 range's ends included", () => {
  const h = new Int16Array(n * n);
  for (let i = 0; i < n * n; i++) h[i] = Math.round(8000 * Math.sin(i * 0.001) + 3000 * Math.cos(i * 0.37));
  // (a cliff from one end of the range to the other)
  h[1000] = 32767;
  h[1001] = -32768;
  h[n * 7 + 3] = -32768;
  expect(Array.from(lolaDecode(lolaEncode(h, 2)))).toEqual(Array.from(h));
  expect(() => lolaDecode(new Uint8Array(10))).toThrow();
});

test("a coarser tile: each texel the mean of the 2 × 2 under it; past the south pole the children's last rows held", () => {
  const c = (v: number) => new Int16Array(n * n).fill(v);
  const p = lolaParent(c(10), c(20), c(30), c(40));
  expect([p[0], p[n - 1], p[(n - 1) * n], p[n * n - 1]]).toEqual([10, 20, 30, 40]);
  const nw = new Int16Array(n * n).map((_, i) => Math.floor(i / n));
  const q = lolaParent(nw, nw, null, null);
  // (the southern half: the northern child's last row pair's mean, (254 + 255) / 2 rounded)
  expect(q[(n - 1) * n]).toBe(255);
  expect(q[(n / 2) * n]).toBe(255);
  expect(q[0]).toBe(1);
});

test("a build from the model's ranges, then served gzipped with CORS", async () => {
  // (the model as the GeoTIFF lays it: row y's sample x at 738233 + 2 (y·92160 + x), little-endian — a plane here)
  const W = 92160,
    DATA0 = 738233;
  const value = (y: number, x: number) => ((y * 3 + x * 5) % 20000) - 10000;
  const src = Bun.serve({
    port: 0,
    fetch(req) {
      const [a, b] = /bytes=(\d+)-(\d+)/.exec(req.headers.get("range")!)!.slice(1).map(Number) as [number, number];
      const out = new Int16Array((b - a + 1) / 2);
      for (let k = 0; k < out.length; k++) {
        const s = (a - DATA0) / 2 + k;
        out[k] = value(Math.floor(s / W), s % W);
      }
      return new Response(out.buffer, { status: 206 });
    },
  });
  try {
    // (two tile rows, two columns: z 1 gets the one tile they all make)
    await buildLola(dir, { rows: [90, 92], cols: [10, 12], src: `http://localhost:${src.port}/m.tif`, log: () => {} });
  } finally {
    src.stop(true);
  }
  const read = async (z: number, y: number, x: number) =>
    lolaDecode(gunzipSync(new Uint8Array(await Bun.file(`${dir}/${z}/${y}/${x}.bin`).arrayBuffer())));
  const t = await read(0, 91, 11);
  expect(t[5 * n + 7]).toBe(value(91 * n + 5, 11 * n + 7));
  const p = await read(1, 45, 5);
  const m = (value(90 * n, 10 * n) + value(90 * n, 10 * n + 1) + value(90 * n + 1, 10 * n) + value(90 * n + 1, 10 * n + 1)) / 4;
  expect(p[0]).toBe(Math.round(m));
  expect(await Bun.file(`${dir}/2/22/2.bin`).exists()).toBe(false);
  const status = await Bun.file(`${dir}/status.json`).json();
  expect(status.done).toBe(true);
  expect(lolaRows(3)).toBe(23);

  const svc = createMoonTiles(dir);
  const r = (await svc.handle(new URL("http://x/svc/v1/moon/lola/0/91/11.bin")))!;
  expect(r.status).toBe(200);
  expect(r.headers.get("content-encoding")).toBe("gzip");
  expect(r.headers.get("access-control-allow-origin")).toBe("*");
  expect((await svc.handle(new URL("http://x/svc/v1/moon/lola/0/1/1.bin")))!.status).toBe(404);
  expect((await (await svc.handle(new URL("http://x/svc/v1/moon/lola/status")))!.json()).done).toBe(true);
  expect(await svc.handle(new URL("http://x/other"))).toBeNull();
});

test("Mars's model resampled to 256 pixels a degree (P7): a plane comes out a plane, no-data left out, metres kept whole", async () => {
  // (a model at 296.37 pixels a degree, metres, its row y's sample x a plane — one sample of no-data in it)
  const W = 106694,
    DATA0 = 854272,
    k = 1 / 0.003374120830641 / 256;
  const value = (y: number, x: number) => Math.round(-3000 + 0.05 * y + 0.02 * x);
  const src = Bun.serve({
    port: 0,
    fetch(req) {
      const [a, b] = /bytes=(\d+)-(\d+)/.exec(req.headers.get("range")!)!.slice(1).map(Number) as [number, number];
      const out = new Int16Array((b - a + 1) / 2);
      for (let q = 0; q < out.length; q++) {
        const s = (a - DATA0) / 2 + q;
        const y = Math.floor(s / W),
          x = s % W;
        out[q] = y === 26700 && x === 50000 ? -32768 : value(y, x);
      }
      return new Response(out.buffer, { status: 206 });
    },
  });
  try {
    const { tileRow, DEM_SOURCES } = await import("../server/moon-tiles");
    const row = await tileRow({ ...DEM_SOURCES.mars!, url: `http://localhost:${src.port}/m.tif` }, 90);
    // (an output pixel's source place: ((j + 0.5) k − 0.5, (i + 0.5) k − 0.5) — the plane there, within a metre's rounding)
    for (const [jj, i] of [
      [0, 1000],
      [128, 40000],
      [255, 90000],
    ] as const) {
      const ys = (90 * 256 + jj + 0.5) * k - 0.5,
        xs = (i + 0.5) * k - 0.5;
      expect(Math.abs(row[jj * 92160 + i]! - (-3000 + 0.05 * ys + 0.02 * xs))).toBeLessThanOrEqual(1);
    }
    // (beside the no-data sample: its neighbours' weights alone, no −32 768 pulled in)
    let lowest = Infinity;
    for (const v of row) lowest = Math.min(lowest, v);
    expect(lowest).toBeGreaterThan(-4000);
  } finally {
    src.stop(true);
  }
  // (a Mars tile carries its unit: metres)
  const { lolaUnit } = await import("../src/system/lola-codec");
  expect(lolaUnit(lolaEncode(new Int16Array(n * n), 0, 1))).toBe(1);
  expect(lolaUnit(lolaEncode(new Int16Array(n * n), 0))).toBe(0.5);
});
