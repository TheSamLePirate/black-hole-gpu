import { afterEach, beforeEach, expect, test } from "bun:test";
import { withGpuStubs } from "./lib/gpu-stubs";
import type { Vec3 } from "../src/physics";
import { EarthTiles, enlarge, RETRY_MAX_MS, retryDelay, TILE, tileImagery } from "../src/system/earth-tiles";
import { geodeticToCart, WGS84_F } from "../src/system/ellipsoid";

// CM1 (docs/PLAN-CHARGEMENT-MONDE.md): no hole for good. A relief tile that will not load is never given the global map's
// 4.9 km heights as its level's (ST-03): its parent's real heights stand in while it is asked again, its failures bounded and
// forgotten on a success or the network's return; the day's imagery drawn without the night's lights (ST-05).

(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= { TEXTURE_BINDING: 4, COPY_DST: 2 };
const fakeDevice = () =>
  ({
    createTexture: (d: { size: number[] }) => ({ size: d.size, destroy() {} }),
    queue: { writeTexture() {}, onSubmittedWorkDone: () => Promise.resolve() },
  }) as unknown as GPUDevice;
const deg = Math.PI / 180;
const camAt = (lat: number, lon: number, h: number): Vec3 => geodeticToCart(1, WGS84_F, lat * deg, lon * deg, h / 6378137);
type Lv = {
  z: number;
  n: number;
  want: { x0: number; y0: number; x1: number; y1: number } | null;
  key: (string | null)[];
  data: (Float32Array | null)[];
};
type Inside = {
  levels: Lv[];
  slotOf(L: Lv, x: number, y: number): number;
  keyOf(L: Lv, x: number, y: number): string;
  failures: Map<string, { n: number; at: number }>;
};

// (the decoding without a browser: every image a flat 100 m — R 128, G 100 — or, for the imagery, a grey day)
const g = globalThis as unknown as Record<string, unknown>;
const saved = { fetch: globalThis.fetch, cib: g.createImageBitmap, oc: g.OffscreenCanvas };
beforeEach(() => {
  g.createImageBitmap = async () => ({ width: TILE, height: TILE, close() {} });
  g.OffscreenCanvas = class {
    getContext() {
      return {
        drawImage() {},
        getImageData: () => {
          const d = new Uint8ClampedArray(4 * TILE * TILE);
          for (let i = 0; i < d.length; i += 4) (d[i] = 128), (d[i + 1] = 100), (d[i + 3] = 255);
          return { data: d };
        },
      };
    }
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  g.createImageBitmap = saved.cib;
  g.OffscreenCanvas = saved.oc;
});

test("CM1: the retries' delay doubles from 2 s, 30 s at most", () => {
  expect([1, 2, 3, 4, 5, 6, 9].map(retryDelay)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  expect(RETRY_MAX_MS).toBe(30000);
});

test("CM1: a tile's square of its parent enlarged — a ramp stays the ramp", () => {
  const h = new Float32Array(TILE * TILE);
  for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) h[j * TILE + i] = i;
  // (the parent's east half, its child x = 1 at k = 1: columns 128 … 255 spread over the tile)
  const c = enlarge(h, 1, 1, 0);
  expect(c[0]).toBeCloseTo(127.75, 1);
  expect(c[TILE - 1]).toBeCloseTo(255, 0);
  expect(c[130 * TILE + 128]! - c[130 * TILE + 127]!).toBeCloseTo(0.5, 2);
});

test("CM1: Terrarium refused — the finer tiles stand in from their parent's real heights, never the global map's; asked again", async () => {
  // (over the Sahara — no national source —, Terrarium refusing z 13 and z 14 — the coarser ones never answer: put by hand)
  const asked = new Map<string, number>();
  globalThis.fetch = ((url: string) => {
    const m = /terrarium\/(\d+)\//.exec(String(url));
    if (m) asked.set(String(url), (asked.get(String(url)) ?? 0) + 1);
    if (m && Number(m[1]) >= 13) return Promise.reject(new TypeError("Failed to fetch"));
    return new Promise(() => {});
  }) as unknown as typeof fetch;
  const t = new EarthTiles(withGpuStubs(fakeDevice()));
  t.fallback = () => -999;
  const T = t as unknown as Inside;
  t.update(camAt(25, 10, 2), 1e-3);
  // (the coarser levels in: a gentle ramp eastwards, 500 m + 1 m a texel of z 12)
  for (const [z, x, y] of t.wanted()) {
    if (z >= 13) continue;
    const h = new Float32Array(TILE * TILE);
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) h[j * TILE + i] = 500 + ((x + i / TILE) * 2 ** (12 - z) * TILE) / 4096;
    t.put(z, x, y, h);
  }
  t.update(camAt(25, 10, 2), 1e-3);
  for (let k = 0; k < 50 && t.standIns < 32; k++) await Bun.sleep(5);
  expect(t.standIns).toBe(32);
  expect(t.pending).toBe(0);
  for (const L of T.levels.filter((l) => l.z >= 13 && l.want)) {
    const w = L.want!;
    for (let y = w.y0; y < w.y1; y++)
      for (let x = w.x0; x < w.x1; x++) {
        const s = T.slotOf(L, x, y);
        expect(L.key[s]).toBe(T.keyOf(L, x, y));
        const d = L.data[s]!;
        // (its parent's ramp — never the global map's −999)
        expect(Math.min(...d.subarray(0, 4096))).toBeGreaterThan(400);
      }
  }
  // (failed once, asked again within 2 s; the network back: forgotten at once, asked again now)
  const f = [...T.failures.values()];
  expect(f.length).toBeGreaterThan(0);
  expect(Math.max(...f.map((e) => e.at - performance.now()))).toBeLessThanOrEqual(2000);
  const before = [...asked.entries()].filter(([u]) => /terrarium\/1[34]\//.test(u)).reduce((a, [, n]) => a + n, 0);
  globalThis.dispatchEvent(new Event("online"));
  await Bun.sleep(20);
  const after = [...asked.entries()].filter(([u]) => /terrarium\/1[34]\//.test(u)).reduce((a, [, n]) => a + n, 0);
  expect(after).toBeGreaterThan(before);
  expect(t.standIns).toBe(32);
});

test("CM1: a stand-in's own heights in at last — no longer a stand-in, its failures forgotten", async () => {
  let refuse = true;
  globalThis.fetch = ((url: string) => {
    const m = /terrarium\/(\d+)\//.exec(String(url));
    if (m && Number(m[1]) >= 13)
      return refuse ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(new Response(new Blob([new Uint8Array(8)])));
    return new Promise(() => {});
  }) as unknown as typeof fetch;
  const t = new EarthTiles(withGpuStubs(fakeDevice()));
  const T = t as unknown as Inside;
  t.update(camAt(25, 10, 2), 1e-3);
  for (const [z, x, y] of t.wanted()) if (z < 13) t.put(z, x, y, new Float32Array(TILE * TILE).fill(500));
  t.update(camAt(25, 10, 2), 1e-3);
  for (let k = 0; k < 50 && t.standIns < 32; k++) await Bun.sleep(5);
  expect(t.standIns).toBe(32);
  refuse = false;
  globalThis.dispatchEvent(new Event("online"));
  for (let k = 0; k < 100 && t.standIns > 0; k++) await Bun.sleep(5);
  expect(t.standIns).toBe(0);
  expect(T.failures.size).toBe(0);
  // (Terrarium's flat 100 m now)
  const L = T.levels.find((l) => l.z === 13)!;
  expect(L.data[T.slotOf(L, L.want!.x0, L.want!.y0)]![0]).toBeCloseTo(100, 3);
});

test("CM1: the night's lights refused — the day's imagery drawn alone, its lights 0", async () => {
  globalThis.fetch = ((url: string) =>
    /VIIRS|Black_Marble|night/i.test(String(url))
      ? Promise.reject(new TypeError("Failed to fetch"))
      : Promise.resolve(new Response(new Blob([new Uint8Array(8)])))) as unknown as typeof fetch;
  const words = await tileImagery(10, 530, 380, new AbortController().signal);
  expect(words).toBeInstanceOf(Uint32Array);
  expect(words![0]! >>> 24).toBe(0);
  expect(words![0]! & 0xffffff).toBeGreaterThan(0);
});
