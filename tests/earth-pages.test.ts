import { expect, test } from "bun:test";
import { withGpuStubs } from "./lib/gpu-stubs";
import { FrameBudget, MipBatch, PagePublisher, TILE_FRAME_IDLE_MS, TILE_START_WINDOW, TILE_STARVE_IMAGES } from "../src/system/earth-pages";
import { cameraOutX, cameraOutY, EarthTiles, TILE, Z0, Z1 } from "../src/system/earth-tiles";
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

// J2 — the main thread's peaks (docs/progress/j2/FICHE-J2-pointes-*): the tiles' work an image held to its budget.

test("the pages drained by their bytes: a larger one passed over for a smaller one after it, the nearest always first", () => {
  const p = new PagePublisher();
  const ran: string[] = [];
  // (a relief page — heights and imagery, 768 KiB — near, an orthophoto — 256 KiB — farther)
  p.queue("14/1", 14, 5, 5, "heights", 262144, () => ran.push("near-h"), 0);
  p.queue("14/1", 14, 5, 5, "imagery", 524288, () => ran.push("near-i"), 0);
  p.queue("14/2", 14, 6, 5, "heights", 262144, () => ran.push("mid-h"), 0);
  p.queue("14/2", 14, 6, 5, "imagery", 524288, () => ran.push("mid-i"), 0);
  p.queue("o0/3", 15, 9, 5, "ortho", 262144, () => ran.push("ortho"), 0);
  // (1 ms a MiB: the relief pages 0.75 ms each, the orthophoto 0.25)
  p.msPerMiB = 1;
  expect(p.estOf({ slot: "", z: 0, x: 0, y: 0, at: 0, parts: new Map([["a", { bytes: 1048576, run() {} }]]) })).toBeCloseTo(1);
  // (a clock that spends each page's estimate: 1.2 ms of budget — the near page; the mid one would pass it, passed over; the
  // orthophoto after it fits)
  let k = 0;
  const steps = [0, 0, 0.75, 0.75, 0.75, 1];
  const done = p.drain(
    1.2,
    (j) => j.x,
    () => steps[Math.min(k++, steps.length - 1)]!,
  );
  expect(done.map((j) => j.slot)).toEqual(["14/1", "o0/3"]);
  expect(ran).toEqual(["near-h", "near-i", "ortho"]);
  // (the one passed over the first of the next image — at least one, whatever its cost)
  expect(
    p
      .drain(
        0,
        (j) => j.x,
        () => 0,
      )
      .map((j) => j.slot),
  ).toEqual(["14/2"]);
});

test("the image's budget: the starts while they fit, the rest at the next image; one let go after images without; idle, a new one", () => {
  const b = new FrameBudget(2);
  b.begin(0);
  b.est = 0.6;
  b.estHi = 0.6;
  let n = 0;
  while (b.mayStart(1)) {
    b.didStart(0.6);
    n++;
  }
  // (0.6 a start in 2 ms less the margin — 1.7 —: two)
  expect(n).toBe(2);
  expect(b.refused).toBe(1);
  // (the next image: a start again)
  b.begin(16);
  expect(b.mayStart(17)).toBe(true);
  // (a publication that took the whole budget: none, image after image — then one let go)
  const starved = new FrameBudget(2);
  starved.est = 0.5;
  starved.estHi = 0.5;
  let let_go = -1;
  for (let i = 0; i < 6 && let_go < 0; i++) {
    starved.begin(16 * i);
    starved.add(2);
    if (starved.mayStart(16 * i + 1)) let_go = i;
  }
  expect(let_go).toBe(TILE_STARVE_IMAGES);
  // (judged by the high estimate — the second dearest of the last TILE_START_WINDOW starts: a single slow one does not hold the loads,
  // two do, until they leave the window)
  const hi = new FrameBudget(2);
  for (let i = 0; i < TILE_START_WINDOW; i++) hi.didStart(0.3);
  hi.didStart(1.5);
  // (not the 1.5: the mean, 0.54, at most)
  expect(hi.estHi).toBeLessThan(0.6);
  hi.didStart(0.9);
  expect(hi.estHi).toBeCloseTo(0.9);
  hi.begin(16);
  hi.add(1.4);
  expect(hi.mayStart(17)).toBe(false);
  for (let i = 0; i < TILE_START_WINDOW; i++) hi.didStart(0.2);
  // (the slow ones out of the window: back to the cheap starts — the mean, still settling, at most)
  expect(hi.estHi).toBeLessThan(0.3);
  expect(hi.estHi).toBeGreaterThanOrEqual(hi.est - 1e-9);
  // (no image for a while — a still view, frames stopped —: a new budget at the next look)
  const idle = new FrameBudget(2);
  idle.begin(0);
  idle.add(2);
  expect(idle.mayStart(1)).toBe(false);
  expect(idle.mayStart(TILE_FRAME_IDLE_MS + 1)).toBe(true);
});

test("the loads started under the image's budget: the camera's tile first, the others at the next images, none lost", () => {
  const t = new EarthTiles(withGpuStubs(counting().dev));
  const inflight = (t as unknown as { inflight: Map<string, unknown> }).inflight;
  // (a budget nothing fits in: the starts refused TILE_STARVE_IMAGES images in a row, then one let go — the camera's own tile, the
  // finest)
  t.frame.limit = 1e-9;
  const cam = camAt(43.1, 6.0, 300);
  for (let i = 0; i < TILE_STARVE_IMAGES; i++) {
    t.publish();
    t.update(cam, 1e-3);
    expect(inflight.size).toBe(0);
  }
  t.publish();
  t.update(cam, 1e-3);
  expect(inflight.size).toBe(1);
  const [key] = [...inflight.keys()];
  const [z, x, y] = key!.split("/").map(Number) as [number, number, number];
  const n = 2 ** z;
  const lon = 6.0 * deg,
    lat = 43.1 * deg;
  expect(x).toBe(Math.floor((lon / (2 * Math.PI) + 0.5) * n));
  expect(Math.abs(y - Math.floor(((1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2) * n))).toBeLessThanOrEqual(1);
  expect(z).toBeGreaterThanOrEqual(14);
  expect(z).toBeLessThanOrEqual(Z1);
  // (an ample budget: the rest of the loads go — eight in flight)
  t.frame.limit = Number.POSITIVE_INFINITY;
  t.publish();
  t.update(cam, 1e-3);
  expect(inflight.size).toBe(8);
});
