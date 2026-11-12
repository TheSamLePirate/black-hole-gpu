import { expect, test } from "bun:test";
import { withGpuStubs } from "./lib/gpu-stubs";
import { MipBatch, PagePublisher } from "../src/system/earth-pages";
import { cameraOutX, cameraOutY, EarthTiles, TILE, Z0 } from "../src/system/earth-tiles";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import type { Vec3 } from "../src/physics";

// PLAN-J2 J2-1 — the publication of the Earth's tile pages (src/system/earth-pages.ts, EarthTiles.publish): a tile put is queued, written
// and published at an image's start, nearest the camera first under a budget; every page's mips in one submission; the level's
// rectangle grows over a page only once published, and never leaves out the camera's tile it held (step A).

(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
const deg = Math.PI / 180;
const camAt = (lat: number, lon: number, h: number): Vec3 => geodeticToCart(1, WGS84_F, lat * deg, lon * deg, h / WGS84_A);
/** a fake device counting its submissions and writes */
function counting() {
  const n = { submits: 0, writes: 0, passes: 0, draws: 0 };
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    setViewport() {},
    setScissorRect() {},
    draw() {
      n.draws++;
    },
    end() {},
  };
  const dev = withGpuStubs({
    createTexture: (d: { size: number[] }) => ({ size: d.size, destroy() {} }),
    queue: {
      writeTexture() {
        n.writes++;
      },
      submit() {
        n.submits++;
      },
      onSubmittedWorkDone: () => Promise.resolve(),
    },
  } as unknown as GPUDevice);
  (dev as unknown as { createCommandEncoder: () => unknown }).createCommandEncoder = () => ({
    beginRenderPass: () => {
      n.passes++;
      return pass;
    },
    finish: () => ({}),
  });
  return { dev, n };
}

test("a page's parts merge: a later write of a part replaces it, the others kept; drained nearest first under the budget, one at least", () => {
  const p = new PagePublisher();
  const ran: string[] = [];
  p.queue("14/3", 14, 5, 5, "heights", 10, () => ran.push("h1"), 0);
  p.queue("14/3", 14, 5, 5, "imagery", 20, () => ran.push("i1"), 1);
  p.queue("14/3", 14, 5, 5, "heights", 10, () => ran.push("h2"), 2);
  p.queue("14/4", 14, 9, 5, "heights", 10, () => ran.push("far"), 3);
  expect(p.size).toBe(2);
  expect(p.bytes).toBe(40);
  // (a clock that spends 1 ms a look: the budget of 0 still writes one page — the nearest)
  let t = 0;
  const done = p.drain(
    0,
    (j) => Math.abs(j.x - 5),
    () => t++,
  );
  expect(done.map((j) => j.slot)).toEqual(["14/3"]);
  expect(ran).toEqual(["h2", "i1"]);
  expect(p.size).toBe(1);
  expect(p.oldest(10)).toBe(7);
  p.drain(
    Number.POSITIVE_INFINITY,
    () => 0,
    () => 0,
  );
  expect(ran).toEqual(["h2", "i1", "far"]);
  expect(p.size).toBe(0);
});

test("the mips gathered: a region once however often written, by texture and layer", () => {
  const b = new MipBatch<string>();
  b.add("a", 3, 0, 0);
  b.add("a", 3, 0, 0);
  b.add("a", 3, 256, 0);
  b.add("a", 5, 0, 0);
  b.add("b", 1, 0, 256);
  const t = b.take();
  expect(b.empty).toBe(true);
  expect(t.length).toBe(2);
  expect(t[0]!.layers.map((l) => [l.layer, l.regions.length])).toEqual([
    [3, 2],
    [5, 1],
  ]);
});

test("the camera near its window's edge: the window recentred (step A) — never in the common case, looking ahead", () => {
  const w = { x0: 10, x1: 18, y0: 20, y1: 28 };
  expect(cameraOutX(w, 10.25, 1 << 17)).toBe(false);
  expect(cameraOutX(w, 10.1, 1 << 17)).toBe(true);
  expect(cameraOutX(w, 18.3, 1 << 17)).toBe(true);
  expect(cameraOutY(w, 27.9)).toBe(true);
  expect(cameraOutY(w, 24)).toBe(false);
  // (across the date line: the camera's x unwrapped near the window's)
  const n = 1 << 10;
  expect(cameraOutX({ x0: n - 3, x1: n + 5 }, 1.5, n)).toBe(false);
});

test("a tile put is drawn only once published: its heights, its rectangle, its generation; the mips of all in one submission", () => {
  const { dev, n } = counting();
  const t = new EarthTiles(dev, true);
  const cam = camAt(45.9, 6.87, 2);
  t.update(cam, 1e-3);
  const wanted = t.wanted().filter(([z]) => z <= 10);
  for (const [z, x, y] of wanted) t.put(z, x, y, new Float32Array(TILE * TILE).fill(500));
  // (in on the CPU, queued: nothing drawn yet, the CPU's ground not either — it is what the GPU draws)
  expect(t.finest).toBe(0);
  expect(
    t.heightAt([Math.cos(45.9 * deg) * Math.cos(6.87 * deg), Math.cos(45.9 * deg) * Math.sin(6.87 * deg), Math.sin(45.9 * deg)], 40).rem,
  ).toBe(1);
  expect(t.pages.size).toBe(wanted.length);
  expect(t.pending).toBeGreaterThanOrEqual(wanted.length);
  const v0 = t.pages.version;
  const s0 = n.submits;
  t.pubProbe = true;
  t.publish(Number.POSITIVE_INFINITY);
  t.pubFrame();
  expect(t.pages.size).toBe(0);
  expect(t.pages.version).toBe(v0 + 1);
  expect(t.finest).toBe(10);
  // (one submission for every mip of every page written; a pass a texture, a mip and a layer — not a tile's)
  expect(n.submits - s0).toBe(1);
  const row = t.pubLog.at(-1)!;
  expect(row.submits).toBe(1);
  expect(row.tiles).toBe(wanted.length);
  expect(row.mipPasses).toBeLessThan(wanted.length * 4);
  // (the CPU's ground now the tiles')
  const q: Vec3 = [Math.cos(45.9 * deg) * Math.cos(6.87 * deg), Math.cos(45.9 * deg) * Math.sin(6.87 * deg), Math.sin(45.9 * deg)];
  expect(t.heightAt(q, 40).rem).toBeLessThan(0.5);
  expect(t.heightAt(q, 40).h / (1 - t.heightAt(q, 40).rem)).toBeCloseTo(500, 0);
});

test("a published tile written again (its finer heights): the old ones drawn until the publication, the new ones after", () => {
  const { dev } = counting();
  const t = new EarthTiles(dev, true);
  t.update(camAt(45.9, 6.87, 2), 1e-3);
  for (const [z, x, y] of t.wanted().filter(([z]) => z <= 9)) t.put(z, x, y, new Float32Array(TILE * TILE).fill(500));
  t.publish(Number.POSITIVE_INFINITY);
  const q: Vec3 = [Math.cos(45.9 * deg) * Math.cos(6.87 * deg), Math.cos(45.9 * deg) * Math.sin(6.87 * deg), Math.sin(45.9 * deg)];
  const at = () => {
    const s = t.heightAt(q, 1000);
    return s.h / (1 - s.rem);
  };
  expect(at()).toBeCloseTo(500, 0);
  for (const [z, x, y] of t.wanted().filter(([z]) => z <= 9)) t.put(z, x, y, new Float32Array(TILE * TILE).fill(800));
  expect(at()).toBeCloseTo(500, 0);
  t.publish(Number.POSITIVE_INFINITY);
  expect(at()).toBeCloseTo(800, 0);
});

test("step A: a level's rectangle grows round the camera's tile — never a larger one without it", () => {
  const { dev } = counting();
  const t = new EarthTiles(dev, true);
  // (a camera moving east: the loads' centre a few tiles ahead of it at z 14)
  const lat = 45.9,
    lon = 6.87;
  const cam = camAt(lat, lon, 300);
  const east: Vec3 = [-Math.sin(lon * deg), Math.cos(lon * deg), 0];
  const lead = east.map((v) => (v * 3000) / WGS84_A) as Vec3;
  t.update(cam, 1e-3, lead);
  const L = (t as unknown as { levels: { z: number; want: { x0: number; x1: number; y0: number; y1: number } | null; valid: unknown }[] })
    .levels[14 - Z0]!;
  const w = L.want!;
  const n = 2 ** 14;
  const cx = Math.floor((lon / 360 + 0.5) * n);
  // (every tile of the window in except the camera's column's — a rectangle east of it is larger than one holding the camera)
  for (const [z, x, y] of t.wanted()) if (z === 14 && x !== cx) t.put(z, x, y, new Float32Array(TILE * TILE).fill(100));
  t.publish(Number.POSITIVE_INFINITY);
  const cover = t.coverAt();
  // (the camera's tile not in: the rectangle grows round the loads' centre — the camera's level coarser there, as before)
  expect(cover.camZ).toBeLessThan(14);
  // (the camera's tile alone in its column: the larger rectangle east of it — the one grown round the loads' centre before J2-1 —
  // not taken; one holding the camera's tile and the loads' centre's instead, smaller)
  const cy = Math.floor((0.5 - Math.atanh(Math.sin(lat * deg)) / (2 * Math.PI)) * n);
  t.put(14, cx, cy, new Float32Array(TILE * TILE).fill(100));
  t.publish(Number.POSITIVE_INFINITY);
  const c2 = t.coverAt();
  expect(c2.camZ).toBe(14);
  expect(c2.holes).not.toContain(14);
  // (the camera's column in: the rectangle holds the window whole)
  for (let y = w.y0; y < w.y1; y++) t.put(14, cx, y, new Float32Array(TILE * TILE).fill(100));
  t.publish(Number.POSITIVE_INFINITY);
  expect(t.coverAt().holes).not.toContain(14);
});
