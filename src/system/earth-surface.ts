// Regional Sentinel-2 + WorldCover pilot. A single bounded pack, never decoded on the main thread.
// Colour and cover do not participate in heightAt, contacts, runway grading or the altimeter.
import manifest from "../../assets/earth-surface/manifest.json";
import type { Vec3 } from "../physics";
import { cartToGeodetic, WGS84_F } from "./ellipsoid";
import type { CoverReply, CoverRequest } from "./earth-surface-worker";
import { ktxFormat, ktxLevels, ktxTarget, writeLevels } from "./ktx2";
import type { KtxTarget } from "./ktx-worker";

const regions = manifest.regions;
export type SurfaceMode = "off" | "satellite" | "materials";
export type SurfaceRegion = (typeof regions)[number];
export const SURFACE_VEC4S = 7;
export const SURFACE_SIZE = 1024;
export const SURFACE_GUTTER = 2;
export const SURFACE_LEVELS = 11;
export const SURFACE_YEAR = 2021;
/** The existing tracer + far-field LUT uses 16 sampled textures; this optional path adds two. */
export const SURFACE_TEXTURE_LIMIT = 18;
export function surfaceShader(code: string, supported: boolean): string {
  if (supported) return code;
  return code
    .replace(/^@group\(0\) @binding\((29|30|31)\).*\n/gm, "")
    .replace(
      /fn surfaceImage\([\s\S]*?(?=fn surfaceMaterial\()/,
      "fn surfaceImage(q: vec3f, fx: vec3f, fy: vec3f) -> SurfaceImage { return sceneryImage(q); }\n\n",
    );
}
const DEG = 180 / Math.PI;
const MAX_INFLIGHT = 2;
const CORE = SURFACE_SIZE - 2 * SURFACE_GUTTER;

/** Margin for preload and hysteresis, in degrees. Prepared pages themselves keep exact bounds. */
export function surfaceRegion(lon: number, lat: number, margin = 0): SurfaceRegion | null {
  return (
    regions.find(
      (r) =>
        lon >= r.west - margin &&
        lon < r.west + r.columns * r.step + margin &&
        lat <= r.north + margin &&
        lat > r.north - r.rows * r.step - margin,
    ) ?? null
  );
}

/** Colour includes every block-rounded mip; WorldCover is R8Uint without lossy compression/mips. */
export function surfaceBytes(target: KtxTarget, pages: number): number {
  let colour = 0;
  for (let l = 0; l < SURFACE_LEVELS; l++) {
    const s = SURFACE_SIZE >> l;
    colour += target === "rgba" ? s * s * 4 : Math.ceil(s / 4) ** 2 * 16;
  }
  return pages * (colour + SURFACE_SIZE ** 2);
}

type Colour = Awaited<ReturnType<typeof ktxLevels>>;
export interface SurfaceLoader {
  colour(url: string, target: KtxTarget): Promise<Colour>;
  cover(url: string): Promise<Uint8Array>;
  dispose(): void;
}

function workerLoader(): SurfaceLoader {
  let worker: Worker | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let next = 1;
  const pending = new Map<number, (r: CoverReply) => void>();
  const dispose = () => {
    clearTimeout(idle);
    worker?.terminate();
    worker = null;
    for (const [id, f] of pending) f({ id, error: "surface worker released" });
    pending.clear();
  };
  return {
    colour: ktxLevels,
    cover: (url) =>
      new Promise((resolve, reject) => {
        clearTimeout(idle);
        if (!worker) {
          worker = new Worker(new URL("earth-surface-worker.js", location.href), { type: "module" });
          worker.onmessage = (e: MessageEvent<CoverReply>) => {
            const f = pending.get(e.data.id);
            pending.delete(e.data.id);
            f?.(e.data);
            if (!pending.size) idle = setTimeout(dispose, 3000);
          };
          worker.onerror = dispose;
        }
        const id = next++;
        pending.set(id, (r) => (r.error ? reject(new Error(r.error)) : resolve(r.bytes!)));
        worker.postMessage({ id, url, size: SURFACE_SIZE } satisfies CoverRequest);
      }),
    dispose,
  };
}

export class EarthSurface {
  color: GPUTexture;
  cover: GPUTexture;
  /** Allocation changes require rebinding; page changes only invalidate accumulation. */
  onChange: (() => void) | null = null;
  onContent: (() => void) | null = null;
  stamp = 0;
  private region: SurfaceRegion | null = null;
  private mode: SurfaceMode = "off";
  private target: KtxTarget;
  private epoch = 0;
  private valid = 0;
  private attempts: number[] = [];
  private loadedAt = new Float32Array(16);
  private started = performance.now();
  private jobs = new Set<number>();
  private failed = new Set<number>();
  private queue: number[] = [];
  private inflight = 0;
  private retiredBytes = 0;
  private uploadedBytes = 0;
  private uploadMs = 0;
  private centre = -1;
  private disposed = false;
  private reason = "off";
  private lastError: string | null = null;
  private lastArrival = -Infinity;

  constructor(
    private device: GPUDevice,
    private loader: SurfaceLoader = workerLoader(),
    readonly supported = true,
  ) {
    this.target = ktxTarget(device);
    this.color = this.texture(false, true);
    this.cover = this.texture(true, true);
  }

  colorView(): GPUTextureView {
    return this.color.createView({
      dimension: "2d-array",
      ...(this.target === "rgba" && this.region ? { format: "rgba8unorm-srgb" as const } : {}),
    });
  }

  private texture(cover: boolean, placeholder = false): GPUTexture {
    const format = cover ? "r8uint" : placeholder ? "rgba8unorm-srgb" : ktxFormat(this.target);
    return this.device.createTexture({
      label: cover ? "WorldCover classes" : "Sentinel-2 colour",
      size: placeholder ? [1, 1, 1] : [SURFACE_SIZE, SURFACE_SIZE, this.region!.rows * this.region!.columns],
      mipLevelCount: cover || placeholder ? 1 : SURFACE_LEVELS,
      format,
      ...(format === "rgba8unorm" ? { viewFormats: ["rgba8unorm-srgb" as const] } : {}),
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
  }

  private select(region: SurfaceRegion | null) {
    const old = [this.color, this.cover];
    const bytes = this.region ? surfaceBytes(this.target, this.region.rows * this.region.columns) : 5;
    this.region = region;
    this.epoch++;
    this.valid = 0;
    this.jobs.clear();
    this.failed.clear();
    this.queue = [];
    this.attempts = [];
    this.loadedAt.fill(0);
    this.started = performance.now();
    this.lastError = null;
    this.centre = -1;
    this.color = this.texture(false, !region);
    this.cover = this.texture(true, !region);
    this.retiredBytes += bytes;
    void this.device.queue
      .onSubmittedWorkDone()
      .catch(() => {})
      .then(() => {
        for (const tex of old) tex.destroy();
        this.retiredBytes -= bytes;
        if (!this.disposed) this.onContent?.();
      });
    this.stamp++;
    this.onChange?.();
  }

  /** Camera on the physical Earth axes [equatorial radii]. Enter below 20 km; release above 30 km. */
  update(c: Vec3 | null, mode: SurfaceMode, lead: Vec3 = [0, 0, 0]) {
    if (this.disposed) return;
    this.mode = mode;
    const geo = c ? cartToGeodetic(1, WGS84_F, c) : null;
    const lon = geo ? geo.lon * DEG : 0,
      lat = geo ? geo.lat * DEG : 0;
    const height = geo ? geo.h * 6378137 : Infinity;
    const r =
      this.supported && mode !== "off" && height < (this.region ? 30_000 : 20_000)
        ? surfaceRegion(lon, lat, this.region ? 0.025 : 0.01)
        : null;
    this.reason = !this.supported
      ? "unsupported-texture-limit"
      : mode === "off"
        ? "off"
        : !geo
          ? "away-from-earth"
          : height >= 20_000
            ? "altitude"
            : !r
              ? "outside-pilots"
              : "loading";
    if (r?.id !== this.region?.id) {
      // Fast teleports must not stack allocations behind a busy GPU queue.
      if (this.retiredBytes > 5) return;
      this.select(r);
    }
    if (!r) return;
    const ahead = c ? cartToGeodetic(1, WGS84_F, c.map((v, i) => v + lead[i]!) as Vec3) : geo;
    const aheadLon = ahead ? ahead.lon * DEG : lon,
      aheadLat = ahead ? ahead.lat * DEG : lat;
    const x = Math.max(0, Math.min(r.columns - 1, Math.floor((aheadLon - r.west) / r.step)));
    const y = Math.max(0, Math.min(r.rows - 1, Math.floor((r.north - aheadLat) / r.step)));
    const centre = y * r.columns + x;
    if (centre !== this.centre) {
      this.centre = centre;
      this.queue = Array.from({ length: r.rows * r.columns }, (_, i) => i).filter(
        (i) => !(this.valid & (1 << i)) && !this.jobs.has(i) && !this.failed.has(i),
      );
      this.queue.sort(
        (a, b) =>
          ((a % r.columns) - x) ** 2 +
          (Math.floor(a / r.columns) - y) ** 2 -
          (((b % r.columns) - x) ** 2 + (Math.floor(b / r.columns) - y) ** 2),
      );
    }
    this.pump();
  }

  private pump() {
    while (!this.disposed && this.region && this.inflight < MAX_INFLIGHT && this.queue.length) {
      const page = this.queue.shift()!;
      const region = this.region,
        epoch = this.epoch;
      const entry = region.pages[page]!;
      const root = new URL(`earth-surface/v1/${region.id}/`, location.href);
      this.inflight++;
      this.jobs.add(page);
      this.attempts[page] = (this.attempts[page] ?? 0) + 1;
      // Both promises must settle before a slot is reused, including a failed/stale job.
      void Promise.allSettled([
        this.loader.colour(new URL(entry.color, root).href, this.target),
        this.loader.cover(new URL(entry.cover, root).href),
      ])
        .then((results) => {
          if (this.disposed || epoch !== this.epoch) return;
          this.jobs.delete(page);
          try {
            const [col, cov] = results;
            if (col.status === "rejected") throw col.reason;
            if (cov.status === "rejected") throw cov.reason;
            if (
              col.value.width !== SURFACE_SIZE ||
              col.value.height !== SURFACE_SIZE ||
              col.value.levels.length !== SURFACE_LEVELS ||
              cov.value.length !== SURFACE_SIZE ** 2
            )
              throw new Error("surface page dimensions mismatch");
            for (let l = 0; l < SURFACE_LEVELS; l++) {
              const s = SURFACE_SIZE >> l;
              const bytes = this.target === "rgba" ? s * s * 4 : Math.ceil(s / 4) ** 2 * 16;
              if (col.value.levels[l]!.byteLength !== bytes) throw new Error("surface mip size mismatch");
            }
            const start = performance.now();
            writeLevels(this.device, this.color, col.value.levels, SURFACE_SIZE, SURFACE_SIZE, this.target, page);
            this.device.queue.writeTexture(
              { texture: this.cover, origin: [0, 0, page] },
              cov.value as Uint8Array<ArrayBuffer>,
              { bytesPerRow: SURFACE_SIZE },
              [SURFACE_SIZE, SURFACE_SIZE, 1],
            );
            this.uploadMs += performance.now() - start;
            this.uploadedBytes += cov.value.byteLength + col.value.levels.reduce((s, l) => s + l.byteLength, 0);
            this.valid |= 1 << page;
            this.loadedAt[page] = (performance.now() - this.started) / 1000;
            this.lastArrival = performance.now();
            this.stamp++;
            this.onContent?.();
          } catch (err) {
            this.lastError = String(err).slice(0, 240);
            if (this.attempts[page]! < 2) this.queue.push(page);
            else this.failed.add(page);
          }
        })
        .finally(() => {
          this.inflight--;
          this.pump();
        });
    }
  }

  params(): Float32Array {
    const r = this.region;
    if (!r || !this.valid || this.mode === "off") return new Float32Array(SURFACE_VEC4S * 4);
    return new Float32Array([
      r.west / DEG,
      r.north / DEG,
      DEG / r.step,
      this.valid,
      r.columns,
      r.rows,
      SURFACE_GUTTER / SURFACE_SIZE,
      CORE / SURFACE_SIZE,
      SURFACE_SIZE,
      this.mode === "materials" ? 1 : 0,
      (r.step * 111320) / CORE,
      (performance.now() - this.started) / 1000 + 1,
      ...this.loadedAt,
    ]);
  }

  get active() {
    return !!this.region && !!this.valid && this.mode !== "off";
  }
  get pending() {
    return (
      !!this.region && (this.jobs.size > 0 || this.queue.length > 0 || (this.valid !== 0 && performance.now() - this.lastArrival < 350))
    );
  }

  stats() {
    const pages = this.region ? this.region.rows * this.region.columns : 0;
    let loaded = 0;
    for (let i = 0; i < pages; i++) if (this.valid & (1 << i)) loaded++;
    return {
      mode: this.mode,
      supported: this.supported,
      region: this.region?.id ?? null,
      label: this.region?.label ?? null,
      year: SURFACE_YEAR,
      sourceResolutionM: 10,
      format: this.target,
      loaded,
      pages,
      pending: this.pending,
      inflight: this.inflight,
      failed: this.failed.size,
      lastError: this.lastError,
      status: !this.region ? this.reason : this.pending ? "loading" : this.failed.size ? "degraded" : "ready",
      gpuBytes: (pages ? surfaceBytes(this.target, pages) : 5) + this.retiredBytes,
      uploadedBytes: this.uploadedBytes,
      uploadCpuMs: Math.round(this.uploadMs * 100) / 100,
      credit:
        "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021), processed by ESA WorldCover consortium (CC BY 4.0)",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://esa-worldcover.org/en/data-access",
    };
  }

  dispose() {
    this.disposed = true;
    this.epoch++;
    this.loader.dispose();
    this.color.destroy();
    this.cover.destroy();
    this.queue = [];
  }
}
