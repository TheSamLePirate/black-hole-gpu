import { afterAll, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import manifest from "../assets/earth-surface/manifest.json";
import {
  EarthSurface,
  SURFACE_LEVELS,
  SURFACE_PAGES,
  SURFACE_SIZE,
  SURFACE_VEC4S,
  surfaceBytes,
  surfaceRegion,
  surfaceShader,
  type SurfaceLoader,
} from "../src/system/earth-surface";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";

(globalThis as { GPUTextureUsage?: unknown }).GPUTextureUsage ??= { TEXTURE_BINDING: 4, COPY_DST: 2 };
// (a page's location for the pages' URLs — taken away after: other files read its absence as "not a page")
const hadLocation = "location" in globalThis;
(globalThis as { location?: unknown }).location ??= { href: "https://example.org/test/" };
afterAll(() => {
  if (!hadLocation) delete (globalThis as { location?: unknown }).location;
});
const at = (lat = 48.95, lon = 2.45, metres = 1000) =>
  geodeticToCart(1, WGS84_F, (lat * Math.PI) / 180, (lon * Math.PI) / 180, metres / WGS84_A);
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(supported = true) {
  const textures: { destroyed: boolean; descriptor: GPUTextureDescriptor }[] = [];
  const writes: number[] = [];
  const device = {
    features: new Set(["texture-compression-bc"]),
    createTexture: (descriptor: GPUTextureDescriptor) => {
      const t = {
        destroyed: false,
        descriptor,
        destroy() {
          this.destroyed = true;
        },
        mipLevelCount: descriptor.mipLevelCount ?? 1,
      };
      textures.push(t);
      return t;
    },
    queue: {
      onSubmittedWorkDone: async () => {},
      writeTexture: (dest: GPUImageCopyTexture) => {
        writes.push((dest.origin as number[] | undefined)?.[2] ?? 0);
      },
    },
  } as unknown as GPUDevice;
  const jobs: { url: string; resolve: (v: Awaited<ReturnType<SurfaceLoader["colour"]>>) => void; reject: (err: Error) => void }[] = [];
  const loader: SurfaceLoader = {
    colour: (url) => new Promise((resolve, reject) => jobs.push({ url, resolve, reject })),
    cover: async () => new Uint8Array(SURFACE_SIZE ** 2).fill(40),
    dispose() {},
  };
  const surface = new EarthSurface(device, loader, supported);
  const complete = (i: number) =>
    jobs[i]!.resolve({
      width: SURFACE_SIZE,
      height: SURFACE_SIZE,
      levels: Array.from({ length: SURFACE_LEVELS }, (_, l) => new Uint8Array(Math.ceil((SURFACE_SIZE >> l) / 4) ** 2 * 16)),
    });
  return { surface, jobs, textures, writes, complete, device };
}

test("surface bounds, altitude hysteresis, unsupported adapter and memory remain bounded", async () => {
  expect(surfaceRegion(2.45, 48.95)?.id).toBe("bourget");
  expect(surfaceRegion(4.15, 44.2)?.id).toBe("cevennes");
  expect(surfaceRegion(-117, 34)).toBeNull();
  expect(surfaceBytes("bc7", 16)).toBeLessThan(38 * 1024 ** 2);
  expect(surfaceBytes("rgba", 16)).toBeLessThan(102 * 1024 ** 2);
  const f = fixture();
  f.surface.update(at(48.95, 2.45, 25_000), "satellite");
  expect(f.jobs).toHaveLength(0);
  f.surface.update(at(), "satellite");
  expect(f.jobs).toHaveLength(2);
  f.surface.update(at(48.95, 2.45, 25_000), "satellite");
  expect(f.surface.stats().region).toBe("bourget");
  f.surface.update(at(48.95, 2.45, 31_000), "satellite");
  await settle();
  expect(f.surface.stats().region).toBeNull();
  expect(f.textures.slice(0, 4).every((t) => t.destroyed)).toBe(true);
  expect(f.surface.stats().gpuBytes).toBe(5);
  f.surface.dispose();
  const unsupported = fixture(false);
  unsupported.surface.update(at(), "materials");
  expect(unsupported.jobs).toHaveLength(0);
  expect(unsupported.surface.stats().status).toBe("unsupported-texture-limit");
  unsupported.surface.dispose();
});

test("two jobs at most, nearest first, a page becomes resident only after both resources", async () => {
  const f = fixture();
  f.surface.update(at(), "satellite");
  expect(f.surface.active).toBe(false);
  expect(f.jobs[0]!.url).toContain("/test/earth-surface/v1/bourget/1-2-");
  f.complete(0);
  await settle();
  expect(f.surface.stats().loaded).toBe(1);
  expect(f.jobs).toHaveLength(3);
  expect(f.surface.stats().inflight).toBe(2);
  expect(f.writes).toHaveLength(SURFACE_LEVELS + 1);
  expect(f.surface.params()).toHaveLength(SURFACE_VEC4S * 4);
  expect(f.surface.params()[3]).toBe(1 << 9);
  f.surface.update(at(), "materials");
  expect(f.surface.params()[9]).toBe(1);
  expect(f.jobs).toHaveLength(3);
  f.surface.dispose();
});

test("switching region or disabling rejects late uploads without increasing concurrent work", async () => {
  const f = fixture();
  f.surface.update(at(), "satellite");
  f.surface.update(at(44.2, 4.15), "satellite");
  expect(f.jobs).toHaveLength(2);
  f.complete(0);
  await settle();
  expect(f.jobs).toHaveLength(3);
  expect(f.jobs[2]!.url).toContain("/cevennes/");
  expect(f.writes).toHaveLength(0);
  f.surface.update(null, "off");
  f.complete(1);
  f.complete(2);
  await settle();
  expect(f.surface.pending).toBe(false);
  expect(f.surface.stats().inflight).toBe(0);
  expect(f.writes).toHaveLength(0);
  f.surface.dispose();
});

test("failed pages settle with fallback, then are tried again with a growing wait (a network blip is not final)", async () => {
  const f = fixture();
  const realNow = performance.now.bind(performance);
  let offset = 0;
  performance.now = () => realNow() + offset;
  try {
    f.surface.update(at(), "satellite");
    for (let i = 0; i < 16; i++) {
      f.jobs[i]!.reject(new Error("offline"));
      await settle();
    }
    // (each page tried once, then waiting: nothing pending — the settled frame does not wait on the network)
    expect(f.jobs).toHaveLength(16);
    expect(f.surface.stats()).toMatchObject({ status: "degraded", loaded: 0, failed: 16, pending: false, inflight: 0 });
    expect(f.surface.active).toBe(false);
    expect(f.writes).toHaveLength(0);
    f.surface.update(at(), "satellite");
    expect(f.jobs).toHaveLength(16);
    // (two seconds on: every page asked again; the network back, they load)
    offset += 2100;
    f.surface.update(at(), "satellite");
    await settle();
    for (let i = 16; i < 32; i++) {
      expect(f.jobs[i]).toBeDefined();
      f.complete(i);
      await settle();
    }
    offset += 400;
    expect(f.surface.stats()).toMatchObject({ status: "ready", loaded: 16, failed: 0, inflight: 0, lastError: null });
    // (a page failing twice waits twice as long: 4 s)
    const again = fixture();
    again.surface.update(at(), "satellite");
    for (let i = 0; i < 16; i++) {
      again.jobs[i]!.reject(new Error("offline"));
      await settle();
    }
    offset += 2100;
    again.surface.update(at(), "satellite");
    await settle();
    for (let i = 16; i < 32; i++) {
      again.jobs[i]!.reject(new Error("offline"));
      await settle();
    }
    offset += 2100;
    again.surface.update(at(), "satellite");
    expect(again.jobs).toHaveLength(32);
    offset += 2100;
    again.surface.update(at(), "satellite");
    await settle();
    expect(again.jobs.length).toBeGreaterThan(32);
    again.surface.dispose();
    expect(again.surface.pending).toBe(false);
  } finally {
    performance.now = realNow;
  }
  f.surface.dispose();
  const malformed = fixture();
  malformed.surface.update(at(), "satellite");
  malformed.jobs[0]!.resolve({
    width: SURFACE_SIZE,
    height: SURFACE_SIZE,
    levels: Array.from({ length: SURFACE_LEVELS }, () => new Uint8Array(1)),
  });
  await settle();
  expect(malformed.surface.stats().lastError).toContain("mip size");
  expect(malformed.writes).toHaveLength(0);
  malformed.surface.dispose();
});

test("rapid teleports cannot stack more than two packs behind an unfinished GPU submission", async () => {
  const f = fixture();
  const releases: (() => void)[] = [];
  f.device.queue.onSubmittedWorkDone = () => new Promise<undefined>((resolve) => releases.push(() => resolve(undefined)));
  f.surface.update(at(), "satellite");
  f.surface.update(at(44.2, 4.15), "satellite");
  for (let i = 0; i < 20; i++) f.surface.update(at(), "satellite");
  expect(f.textures).toHaveLength(6);
  expect(f.surface.stats().gpuBytes).toBeLessThanOrEqual(2 * surfaceBytes("bc7", 16) + 5);
  for (const release of releases) release();
  await settle();
  f.surface.update(at(), "satellite");
  expect(f.surface.stats().region).toBe("bourget");
  expect(f.textures).toHaveLength(8);
  for (const release of releases) release();
  await settle();
  f.surface.dispose();
});

test("committed packs have complete KTX2 mips, content hashes and exact categorical gutters", async () => {
  expect(manifest.size).toBe(SURFACE_SIZE);
  expect(manifest.sourceBands).toEqual(["B04", "B03", "B02", "B08"]);
  expect(manifest.reflectanceScale).toBe(0.0001);
  const classes = new Set([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]);
  for (const r of manifest.regions) {
    expect(r.pages).toHaveLength(r.columns * r.rows);
    expect(r.pages.length).toBeLessThanOrEqual(16);
    const cover: Uint8Array[] = [];
    for (const p of r.pages) {
      for (const filename of [p.color, p.cover]) {
        const bytes = await Bun.file(`assets/earth-surface/v1/${r.id}/${filename}`).bytes();
        const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 8);
        expect(filename).toContain(`-${hash}.`);
        if (filename === p.color) {
          const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          expect(Array.from(bytes.slice(0, 4))).toEqual([0xab, 0x4b, 0x54, 0x58]);
          expect(header.getUint32(20, true)).toBe(SURFACE_SIZE);
          expect(header.getUint32(24, true)).toBe(SURFACE_SIZE);
          expect(header.getUint32(40, true)).toBe(SURFACE_LEVELS);
        } else {
          const data = new Uint8Array(gunzipSync(bytes));
          expect(data.length).toBe(SURFACE_SIZE ** 2);
          expect([...new Set(data)].every((c) => classes.has(c))).toBe(true);
          cover.push(data);
        }
      }
    }
    let mismatches = 0;
    for (let y = 0; y < r.rows; y++)
      for (let x = 0; x < r.columns - 1; x++) {
        const a = cover[y * r.columns + x]!,
          b = cover[y * r.columns + x + 1]!;
        for (let row = 0; row < SURFACE_SIZE; row++)
          for (let i = 0; i < 4; i++) if (a[row * SURFACE_SIZE + SURFACE_SIZE - 4 + i] !== b[row * SURFACE_SIZE + i]) mismatches++;
      }
    for (let y = 0; y < r.rows - 1; y++)
      for (let x = 0; x < r.columns; x++) {
        const a = cover[y * r.columns + x]!,
          b = cover[(y + 1) * r.columns + x]!;
        for (let i = 0; i < 4 * SURFACE_SIZE; i++) if (a[SURFACE_SIZE ** 2 - 4 * SURFACE_SIZE + i] !== b[i]) mismatches++;
      }
    expect(mismatches).toBe(0);
  }
});

test("16-texture shader omits optional bindings and samples", async () => {
  const trace = await Bun.file("src/shaders/trace.wgsl").text();
  const fallback = surfaceShader(trace, false);
  expect(fallback).not.toContain("var surfaceColour");
  expect(fallback).not.toContain("var surfaceCover");
  expect(fallback).not.toContain("var surfaceSamp");
  expect(surfaceShader(trace, true)).toBe(trace);
});

// (the valid mask and the pages' arrival times in P.surface hold 16 pages: every region of the manifest fits)
test("every surface region has at most SURFACE_PAGES pages, and the params hold their arrival times", () => {
  for (const r of manifest.regions) expect(r.rows * r.columns).toBeLessThanOrEqual(SURFACE_PAGES);
  expect(SURFACE_VEC4S * 4).toBe(12 + SURFACE_PAGES);
});
