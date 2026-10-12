import type { Vec3 } from "../physics";
import { SceneryContact } from "./scenery-contact";
import { cartToGeodetic, WGS84_A, WGS84_F } from "./ellipsoid";
import {
  D,
  SCENERY_BYTES,
  SCENERY_STORAGE_LIMIT,
  SCENERY_VEC4S,
  sceneryCentre,
  sceneryFrame,
  wrapLon,
  type SceneryMode,
  type SceneryReply,
  type SceneryRequest,
} from "./scenery-data";

export function sceneryShader(code: string, supported: boolean) {
  return supported
    ? code
    : code.replace(
        /\/\/ BEGIN_WORLD_SCENERY[\s\S]*?\/\/ END_WORLD_SCENERY/,
        "fn sceneryImage(q:vec3f)->SurfaceImage{return SurfaceImage(vec3f(0.0),0.0,0u);}\nfn worldScenery(d:vec3f,t:f32,r:f32)->f32{return t;}\nfn sceneryShadow(l:vec3f,n:vec3f)->f32{return 1.0;}\nstruct ScenerySurface {color:vec3f,cover:f32,kind:f32};\nfn scenerySurface(f:f32)->ScenerySurface{return ScenerySurface(vec3f(0.0),0.0,0.0);}",
      );
}

export class EarthScenery {
  contact: SceneryContact | null = null;
  buffer: GPUBuffer;
  onChange: (() => void) | null = null;
  onContent: (() => void) | null = null;
  stamp = 0;
  readonly supported: boolean;
  private worker: Worker | null = null;
  private data: SceneryReply | null = null;
  private camera: Vec3 | null = null;
  private allocated = false;
  private requested = "";
  private id = 0;
  private mode: SceneryMode = "off";
  private satellite = false;
  private terrain = false;
  shadows = true;
  private started = 0;
  private attempted = -Infinity;
  private busy = false;
  private reason = "off";
  private lastError: string | null = null;
  private disposed = false;
  private uploaded = 0;
  private retiredBytes = 0;
  private requestedCentre: { lat: number; lon: number } | null = null;
  private failures = 0;
  private retryAt = 0;
  constructor(
    private device: GPUDevice,
    private makeWorker: () => Worker = () => new Worker(new URL("scenery-worker.js", location.href), { type: "module" }),
  ) {
    this.supported = device.limits.maxStorageBuffersPerShaderStage >= SCENERY_STORAGE_LIMIT;
    this.buffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: "world scenery placeholder",
    });
  }
  private clear() {
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.requested = "";
    this.requestedCentre = null;
    this.failures = 0;
    this.lastError = null;
    this.id++;
    this.data = null;
    this.contact = null;
    if (this.allocated) {
      const old = this.buffer;
      this.allocated = false;
      this.buffer = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.retiredBytes += SCENERY_BYTES;
      void this.device.queue
        .onSubmittedWorkDone()
        .catch(() => {})
        .then(() => {
          old.destroy();
          this.retiredBytes -= SCENERY_BYTES;
          this.onContent?.();
        });
      this.onChange?.();
    }
    this.stamp++;
  }
  update(
    camera: Vec3 | null,
    mode: SceneryMode,
    satellite: boolean,
    terrain: boolean,
    exclusions: SceneryRequest["exclusions"] = [],
    priority: Vec3 | null = null,
  ) {
    if (this.disposed) return;
    const changed = this.mode !== mode || this.satellite !== satellite;
    this.mode = mode;
    this.satellite = satellite;
    this.terrain = terrain;
    this.camera = camera;
    const geo = camera ? cartToGeodetic(1, WGS84_F, camera) : null;
    this.reason = !this.supported
      ? "unsupported-storage-limit"
      : mode === "off"
        ? "off"
        : !geo
          ? "away-from-earth"
          : geo.h * WGS84_A > 12000
            ? "altitude"
            : Math.abs(geo.lat / D) > 84
              ? "polar-limit"
              : "loading";
    if (this.reason !== "loading") {
      if (this.data || this.busy) this.clear();
      return;
    }
    if (!geo) return;
    const wanted = priority ? cartToGeodetic(1, WGS84_F, priority) : geo;
    const c = sceneryCentre(wanted.lat / D, wanted.lon / D);
    const distance = (v: { lat: number; lon: number }) =>
      Math.hypot((c.lat - v.lat) * 111320, wrapLon(c.lon - v.lon) * 111320 * Math.cos(c.lat * D));
    const dist = this.data ? distance(this.data) : Infinity;
    if (dist > 8000 && this.data) {
      this.clear();
      this.onContent?.();
    }
    if ((changed || (this.requestedCentre && distance(this.requestedCentre) > 8000)) && this.busy) {
      this.worker?.terminate();
      this.worker = null;
      this.busy = false;
      this.requested = "";
      this.id++;
    }
    const key = `${c.key}:${mode}:${satellite}`;
    if (
      this.busy ||
      this.retiredBytes ||
      (key === this.requested && (!this.lastError || this.failures >= 2 || performance.now() < this.retryAt)) ||
      performance.now() - this.attempted < 3000
    )
      return;
    if (key !== this.requested) this.failures = 0;
    this.requested = key;
    this.requestedCentre = c;
    this.busy = true;
    this.attempted = performance.now();
    const id = ++this.id;
    try {
      this.worker ??= this.makeWorker();
      this.worker.onmessage = (e: MessageEvent<SceneryReply>) => {
        if (this.disposed || e.data.id !== this.id) return;
        this.busy = false;
        this.worker?.terminate();
        this.worker = null;
        const r = e.data;
        if (r.error || !r.buffer || r.buffer.byteLength > SCENERY_BYTES) {
          this.lastError = r.error ?? "invalid scene size";
          this.failures++;
          this.retryAt = performance.now() + 30000;
          this.reason = "degraded";
          this.onContent?.();
          return;
        }
        if (!this.allocated) {
          const old = this.buffer;
          this.allocated = true;
          this.buffer = this.device.createBuffer({
            size: SCENERY_BYTES,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: "world forests and OSM scenery",
          });
          old.destroy();
          this.onChange?.();
        }
        const t = performance.now();
        this.device.queue.writeBuffer(this.buffer, 0, r.buffer);
        this.contact = new SceneryContact(r, r.buffer);
        this.uploaded += performance.now() - t;
        this.data = { ...r, buffer: undefined };
        this.started = performance.now();
        this.lastError = r.errors?.[0] ?? null;
        if (this.lastError) {
          this.failures++;
          this.retryAt = performance.now() + 30000;
        }
        this.stamp++;
        this.onContent?.();
      };
      this.worker.onerror = () => {
        this.lastError = "scenery worker unavailable";
        this.failures++;
        this.retryAt = performance.now() + 30000;
        this.reason = "degraded";
        this.busy = false;
        this.worker?.terminate();
        this.worker = null;
        this.onContent?.();
      };
      this.worker.postMessage({ id, lat: c.lat, lon: c.lon, mode, satellite, exclusions } satisfies SceneryRequest);
    } catch (e) {
      this.lastError = String(e);
      this.failures++;
      this.retryAt = performance.now() + 30000;
      this.reason = "degraded";
      this.busy = false;
    }
  }
  params() {
    const r = this.data;
    if (!r || !this.camera || this.mode === "off") return new Float32Array(SCENERY_VEC4S * 4);
    const frame = sceneryFrame(r.lat, r.lon);
    const delta = this.camera.map((v, i) => v * WGS84_A - frame.origin[i]!) as Vec3;
    const cam = [frame.east, frame.north, frame.up].map((v) => v[0] * delta[0] + v[1] * delta[1] + v[2] * delta[2]);
    const b = r.bounds!;
    return new Float32Array([
      ...frame.east,
      this.terrain ? 1 : 0,
      ...frame.north,
      this.mode === "high" ? 3500 : 2500,
      ...frame.up,
      1,
      ...cam,
      Math.min(1, (performance.now() - this.started) / 600),
      b[0] * D,
      b[3] * D,
      1 / ((b[2] - b[0]) * D),
      1 / ((b[3] - b[1]) * D),
      this.mode === "high" ? 1 : 0,
      this.satellite ? 1 : 0,
      r.rgbPixels ? 1 : 0,
      this.shadows ? 1 : 0,
    ]);
  }
  get active() {
    return !!this.data && this.mode !== "off";
  }
  get pending() {
    return this.busy || (!!this.data && performance.now() - this.started < 600);
  }
  stats() {
    const d = this.data;
    return {
      mode: this.mode,
      contactBytes: this.contact?.bytes ?? 0,
      supported: this.supported,
      status: d
        ? this.pending
          ? "refreshing"
          : this.lastError
            ? "degraded"
            : "ready"
        : this.busy
          ? "loading"
          : this.lastError
            ? "degraded"
            : this.reason,
      pending: this.pending,
      budgetLimited: d?.budgetLimited ?? false,
      lat: d?.lat ?? null,
      lon: d?.lon ?? null,
      trees: d?.trees ?? 0,
      buildings: d?.buildings ?? 0,
      footprintEdges: d?.vertices ?? 0,
      roads: d?.roads ?? 0,
      railways: d?.railways ?? 0,
      waterways: d?.waterways ?? 0,
      waterPolygons: d?.waterPolygons ?? 0,
      pavedPolygons: d?.pavedPolygons ?? 0,
      bridges: d?.bridges ?? 0,
      bridgePiers: d?.bridgePiers ?? 0,
      osmLayers: d?.osmLayers ?? {},
      shadows: this.shadows,
      shadowReceiverRangeM: this.mode === "high" ? 2000 : 1200,
      shadowRayRangeM: this.mode === "high" ? 900 : 500,
      gpuBytes: this.allocated ? SCENERY_BYTES : 64,
      retiringGpuBytes: this.retiredBytes,
      coverPixels: d?.coverPixels ?? 0,
      rgbPixels: d?.rgbPixels ?? 0,
      workerMs: d?.workerMs ?? 0,
      tileNetworkBytes: d?.networkBytes ?? 0,
      uploadCpuMs: Math.round(this.uploaded * 100) / 100,
      lastError: this.lastError,
      coverage:
        "WorldCover 2021 land; OSM buildings, roads, railways, water and estimated bridges through OpenMapTiles; |latitude| ≤ 84°; coverage varies with source data",
      credit:
        "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021), CC BY 4.0; © OpenMapTiles, Data from OpenStreetMap (ODbL), served by OpenFreeMap",
      sources: [
        "https://esa-worldcover.org/en/data-access",
        "https://docs.terrascope.be/Developers/WebServices/OGC/MapProxy.html",
        "https://openfreemap.org",
        "https://www.openstreetmap.org/copyright",
      ],
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.id++;
    this.buffer.destroy();
    this.data = null;
    this.busy = false;
  }
}
