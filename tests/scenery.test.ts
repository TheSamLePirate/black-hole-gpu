import { expect, test } from "bun:test";
import {
  D,
  localPoint,
  packScenery,
  sceneryCentre,
  sceneryFrame,
  sceneryExcluded,
  rasterParts,
  SCENERY_BYTES,
  SCENERY_GRID,
  seed,
  worldCoverUrl,
  type Primitive,
  type SceneryRequest,
  type SceneryReply,
} from "../src/system/scenery-data";
import { EarthScenery, sceneryShader } from "../src/system/scenery";
import { geodeticToCart, WGS84_F, WGS84_A } from "../src/system/ellipsoid";
import { surfaceShader } from "../src/system/earth-surface";
import { surfaceSegment, polygonPrimitive, stripPolygon, surfaceContains, roadWidth } from "../src/system/scenery-geometry";

test("worldwide WGS84 frames stay precise in both hemispheres and on the date line", () => {
  for (const [lat, lon] of [
    [48.86, 2.35],
    [-33.9, 151.2],
    [35.68, 139.76],
    [0, 179.999],
    [75, -45],
  ]) {
    const f = sceneryFrame(lat!, lon!),
      p = localPoint(f, lat!, lon!, 125);
    expect(Math.abs(p[0])).toBeLessThan(1e-6);
    expect(Math.abs(p[1])).toBeLessThan(1e-6);
    expect(p[2]).toBeCloseTo(125, 6);
    const c = sceneryCentre(lat!, lon!);
    expect(Math.abs(c.lat - lat!)).toBeLessThan(0.003);
    expect(c.lon).toBeGreaterThanOrEqual(-180);
    expect(c.lon).toBeLessThan(180);
    expect(f.up[2]).toBeCloseTo(Math.sin(lat! * D), 8);
  }
  expect(worldCoverUrl(-3.1, -60.1)).toContain("S06W063");
  expect(worldCoverUrl(44.2, 4.15, true)).toContain("N44E004");
  expect(worldCoverUrl(0, 180)).toContain("N00W180");
});
test("date-line images split into valid WMS bounds and full-width strips; entire runways stay clear", () => {
  for (const b of [
    [179.98, -1, 180.03, 1],
    [-180.04, -1, -179.97, 1],
    [-70, -1, -69, 1],
  ] as [number, number, number, number][]) {
    const parts = rasterParts(b, 512);
    expect(parts.reduce((n, v) => n + v.width, 0)).toBe(512);
    expect(parts[0]!.x).toBe(0);
    for (const p of parts) {
      expect(p.bounds[0]).toBeGreaterThanOrEqual(-180);
      expect(p.bounds[2]).toBeLessThanOrEqual(180);
    }
  }
  const zones = [{ lat: 0, lon: 179.99, heading: 90, length: 4500, halfWidth: 340 }];
  expect(sceneryExcluded(0, -179.98, zones)).toBe(true);
  expect(sceneryExcluded(0.004, -179.98, zones)).toBe(false);
  expect(sceneryExcluded(0, -179.95, zones)).toBe(false);
});
test("world scenery cancels stale work and bounds memory while GPU submissions retire", async () => {
  (globalThis as { GPUBufferUsage?: unknown }).GPUBufferUsage ??= { STORAGE: 128, COPY_DST: 8 };
  const buffers: { destroyed: boolean; size: number; destroy(): void }[] = [],
    jobs: { request: SceneryRequest; worker: Worker }[] = [],
    releases: (() => void)[] = [];
  let writes = 0;
  const device = {
    limits: { maxStorageBuffersPerShaderStage: 9 },
    createBuffer: (v: { size: number }) => {
      const b = {
        size: v.size,
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
      };
      buffers.push(b);
      return b;
    },
    queue: {
      writeBuffer() {
        writes++;
      },
      onSubmittedWorkDone: () => new Promise<void>((r) => releases.push(r)),
    },
  } as unknown as GPUDevice;
  const factory = () => {
    const w = {
      terminated: false,
      onmessage: null,
      onerror: null,
      terminate() {
        this.terminated = true;
      },
      postMessage(request: SceneryRequest) {
        jobs.push({ request, worker: this as unknown as Worker });
      },
    };
    return w as unknown as Worker;
  };
  const scenery = new EarthScenery(device, factory),
    at = geodeticToCart(1, WGS84_F, 48.86 * D, 2.35 * D, 400 / WGS84_A);
  scenery.update(at, "balanced", true, true);
  expect(jobs).toHaveLength(1);
  const j = jobs[0]!;
  const reply = (r: SceneryReply) => j.worker.onmessage!({ data: r } as MessageEvent<SceneryReply>);
  reply({
    id: j.request.id,
    lat: j.request.lat,
    lon: j.request.lon,
    bounds: [2.3, 48.8, 2.4, 48.9],
    buffer: packScenery([], new Uint32Array(SCENERY_GRID ** 2)),
  });
  expect(writes).toBe(1);
  expect(scenery.active).toBe(true);
  expect(scenery.stats().gpuBytes).toBe(SCENERY_BYTES);
  expect(scenery.params()[23]).toBe(1);
  scenery.shadows = false;
  expect(scenery.params()[23]).toBe(0);
  scenery.update(null, "off", false, true);
  expect(scenery.stats().retiringGpuBytes).toBe(SCENERY_BYTES);
  reply({ id: j.request.id, lat: 0, lon: 0, buffer: new ArrayBuffer(64) });
  expect(writes).toBe(1);
  for (let i = 0; i < 20; i++) scenery.update(at, "balanced", true, true);
  expect(jobs).toHaveLength(1);
  expect(buffers.filter((b) => !b.destroyed && b.size === SCENERY_BYTES)).toHaveLength(1);
  releases.forEach((r) => r());
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(scenery.stats().retiringGpuBytes).toBe(0);
  expect(buffers.filter((b) => !b.destroyed && b.size === SCENERY_BYTES)).toHaveLength(0);
  scenery.dispose();
  expect(buffers.every((b) => b.destroyed)).toBe(true);
  const unsupported = new EarthScenery({ ...device, limits: { maxStorageBuffersPerShaderStage: 8 } } as GPUDevice, factory);
  unsupported.update(at, "high", true, true);
  expect(unsupported.stats().status).toBe("unsupported-storage-limit");
  expect(jobs).toHaveLength(1);
  unsupported.dispose();
});
test("BVH escapes bound traversal and preserve every geometry and packed class/colour", () => {
  const prims: Primitive[] = Array.from({ length: 31 }, (_, i) => ({
    min: [i * 20, 0, 0],
    max: [i * 20 + 8, 8, 25],
    tree: true,
    data: [i * 20, 0, 0, 0, 4, 25, seed(i, 0), 0, 0.1, 0.2, 0.05, 0],
  }));
  const pixels = new Uint32Array(SCENERY_GRID ** 2);
  pixels[123] = 0x0aabcdef;
  const b = packScenery(prims, pixels),
    f = new Float32Array(b),
    u = new Uint32Array(b);
  const nodes = f[0]!,
    geom = f[1]!,
    image = f[2]!;
  expect(nodes).toBe(61);
  expect(geom).toBe(4 + nodes * 2);
  let leaves = 0;
  for (let i = 0; i < nodes; i++) {
    const p = 16 + i * 8;
    expect(f[p + 3]).toBeGreaterThan(i);
    expect(f[p + 3]).toBeLessThanOrEqual(nodes);
    if (f[p + 7]! >= 0) {
      leaves++;
      expect(f[p + 3]).toBe(i + 1);
      expect(f[geom * 4 + f[p + 7]! * 4 + 5]).toBe(25);
    }
  }
  expect(leaves).toBe(31);
  expect(u[image * 4 + 123]).toBe(0x0aabcdef);
  expect(b.byteLength).toBeLessThan(SCENERY_BYTES);
  expect(new Float32Array(packScenery([], pixels))[0]).toBe(0);
});
test("eight-buffer and sixteen-texture fallbacks compose without scenery resource references", async () => {
  const source = await Bun.file("src/shaders/trace.wgsl").text();
  const fallback = sceneryShader(surfaceShader(source, false), false);
  expect(fallback).not.toContain("var<storage, read> scenery");
  expect(fallback).not.toContain("sceneryQuery(");
  expect(fallback).not.toContain("var surfaceColour");
  expect(fallback).toContain("return sceneryImage(q)");
  expect(sceneryShader(source, true)).toBe(source);
});
test("OSM analytic networks preserve narrow roads, lake islands and bridge widths in an independent BVH", () => {
  const a: [number, number, number] = [100, 100, 0],
    b: [number, number, number] = [200, 150, 0];
  const road = surfaceSegment(a, b, roadWidth("minor"), 1, [0.1, 0.1, 0.1]);
  expect(surfaceContains([150, 125, 0], road)).toBe(true);
  expect(surfaceContains([150, 135, 0], road)).toBe(false);
  const lake = polygonPrimitive(
    [
      [
        [0, 0, 0],
        [50, 0, 0],
        [50, 50, 0],
        [0, 50, 0],
        [0, 0, 0],
      ],
      [
        [20, 20, 0],
        [20, 30, 0],
        [30, 30, 0],
        [30, 20, 0],
        [20, 20, 0],
      ],
    ],
    0,
    0,
    4,
    [0.02, 0.05, 0.06],
  )!;
  expect(surfaceContains([10, 10, 0], lake)).toBe(true);
  expect(surfaceContains([25, 25, 0], lake)).toBe(false);
  expect(surfaceContains([60, 10, 0], lake)).toBe(false);
  expect(surfaceContains([53, 10, 0], lake, 7)).toBe(true);
  expect(surfaceContains([60, 10, 0], lake, 7)).toBe(false);
  const bridge = polygonPrimitive([stripPolygon(a, b, 12)], 8, 9.2, 2, [0.1, 0.1, 0.1])!;
  expect(surfaceContains([150, 125, 0], bridge)).toBe(true);
  const corner = stripPolygon(a, b, 12)[0]!;
  expect(Math.hypot(corner[0] - a[0], corner[1] - a[1])).toBeCloseTo(6, 8);
  const pack = packScenery([bridge], new Uint32Array(SCENERY_GRID ** 2), [road, lake]);
  const f = new Float32Array(pack);
  expect(f[0]).toBe(1);
  expect(f[5]).toBe(3);
  expect(f[7]).toBe(2);
  expect(f[4]).toBeGreaterThan(f[1]!);
  expect(f[6]).toBe(f[4]! + 6);
  expect(f[2]).toBeGreaterThan(f[6]!);
  const geom = f[6]! * 4;
  expect(f[geom + 11]).toBe(4); // Outer-ring length identifies polygons and preserves islands against river centre lines.
  expect(pack.byteLength).toBeLessThan(SCENERY_BYTES);
});

test("world scenery: pending until the wanted scene is drawn, a partial rebuild keeps the drawn one, a teleport asks at once", async () => {
  (globalThis as { GPUBufferUsage?: unknown }).GPUBufferUsage ??= { STORAGE: 128, COPY_DST: 8 };
  const jobs: { request: SceneryRequest; worker: Worker }[] = [];
  let writes = 0;
  const device = {
    limits: { maxStorageBuffersPerShaderStage: 9 },
    createBuffer: (v: { size: number }) => ({ size: v.size, destroy() {} }),
    queue: {
      writeBuffer() {
        writes++;
      },
      onSubmittedWorkDone: () => new Promise<void>((r) => releases.push(r)),
    },
  } as unknown as GPUDevice;
  const releases: (() => void)[] = [];
  const factory = () =>
    ({
      onmessage: null,
      onerror: null,
      terminate() {},
      postMessage(request: SceneryRequest) {
        jobs.push({ request, worker: this as unknown as Worker });
      },
    }) as unknown as Worker;
  const realNow = performance.now.bind(performance);
  let offset = 0;
  performance.now = () => realNow() + offset;
  try {
    const scenery = new EarthScenery(device, factory);
    const place = (lat: number, lon: number) => geodeticToCart(1, WGS84_F, lat * D, lon * D, 400 / WGS84_A);
    const reply = (k: number, errors?: string[]) => {
      const j = jobs[k]!;
      j.worker.onmessage!({
        data: {
          id: j.request.id,
          lat: j.request.lat,
          lon: j.request.lon,
          bounds: [j.request.lon - 0.05, j.request.lat - 0.05, j.request.lon + 0.05, j.request.lat + 0.05],
          buffer: packScenery([], new Uint32Array(SCENERY_GRID ** 2)),
          ...(errors ? { errors } : {}),
        },
      } as MessageEvent<SceneryReply>);
    };
    scenery.update(place(48.86, 2.35), "balanced", true, true);
    expect(scenery.pending).toBe(true);
    reply(0);
    offset += 700;
    scenery.update(place(48.86, 2.35), "balanced", true, true);
    expect(scenery.pending).toBe(false);
    const drawn = scenery.contact;
    // (a kilometre on: a new centre, rebuilt — its land cover's raster missing: the drawn scene kept)
    offset += 3100;
    scenery.update(place(48.869, 2.35), "balanced", true, true);
    expect(jobs).toHaveLength(2);
    expect(scenery.pending).toBe(true);
    reply(1, ["WorldCover raster: offline"]);
    expect(scenery.contact).toBe(drawn);
    expect(writes).toBe(1);
    expect(scenery.stats().lastError).toContain("offline");
    expect(scenery.pending).toBe(false);
    // (tried again after its wait, not given up)
    offset += 31000;
    scenery.update(place(48.869, 2.35), "balanced", true, true);
    expect(jobs).toHaveLength(3);
    reply(2);
    expect(scenery.contact).not.toBe(drawn);
    expect(writes).toBe(2);
    // (a teleport while a rebuild runs: the old one dropped, the new one asked at once — and waited for)
    offset += 3100;
    scenery.update(place(48.875, 2.35), "balanced", true, true);
    expect(jobs).toHaveLength(4);
    scenery.update(place(43.6, 1.44), "balanced", true, true);
    // (the drawn scene's buffer retiring behind the GPU's work: waited for — the frame is not settled meanwhile)
    expect(scenery.pending).toBe(true);
    releases.forEach((r) => r());
    for (let i = 0; i < 5; i++) await Promise.resolve();
    scenery.update(place(43.6, 1.44), "balanced", true, true);
    expect(jobs).toHaveLength(5);
    expect(scenery.pending).toBe(true);
    scenery.dispose();
  } finally {
    performance.now = realNow;
  }
});
