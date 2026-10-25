import type { Vec3 } from "../physics";
import { forestKindTable, forestSeason } from "./forest";
import { SceneryContact } from "./scenery-contact";
import { cartToGeodetic, WGS84_A, WGS84_F } from "./ellipsoid";
import { geoidN } from "./geoid-grid";
import {
  D,
  sceneryBudget,
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
        "fn sceneryImage(q:vec3f)->SurfaceImage{return SurfaceImage(vec3f(0.0),0.0,0u);}\nfn worldScenery(d:vec3f,t:f32,r:f32)->f32{return t;}\nfn sceneryShadow(l:vec3f,n:vec3f)->f32{return 1.0;}\nfn sceneryMirror(r:vec3f,l:vec3f,e:vec3f,s:vec3f)->vec4f{return vec4f(0.0,0.0,0.0,-1.0);}\nstruct ScenerySurface {color:vec3f,cover:f32,kind:f32};\nfn scenerySurface(f:f32)->ScenerySurface{return ScenerySurface(vec3f(0.0),0.0,0.0);}\nfn sceneryWaterAt(p:vec3f,f:f32,d:f32)->f32{return 0.0;}\nfn sceneryTreeLite(d:vec3f,i:u32,t:f32)->f32{return -1.0;}",
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
  /** bumped whenever the buffer's contents change (a new upload, the season's trees): what is drawn from it — the trees'
   *  shadow map — drawn again */
  revision = 0;
  private camera: Vec3 | null = null;
  private allocated = false;
  /** the drawn buffer's size (the placeholder's 64 bytes, else a scene's budget) */
  private bufferBytes = 64;
  /** the detail's reach (DETAIL_REACH: 1, 1.5, 2): the box, its raster, its rays this many times the normal ones */
  private reach = 1;
  private requested = "";
  private id = 0;
  private mode: SceneryMode = "off";
  private satellite = false;
  private terrain = false;
  shadows = true;
  /** the IGN's survey over France for the trees and the buildings' ground (settings.earthIgnRelief — I4) */
  ign = false;
  /** Overture Maps' buildings near the centre, outside France (settings.earthOverture — B7) */
  overture = true;
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
  /** the scene wanted here is neither drawn nor given up on for now (pending: the settled frame waits for it) */
  private wanted = false;
  /** the key of the scene drawn (centre, mode, satellite) */
  private applied = "";
  /** the drawn scene's forest section (vec4 index, 0: none), and the season its kinds' table was written for */
  private forestAt = 0;
  private seasonKey = "";
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
  /** the bytes a scene of this reach may take: its budget, within the device's largest storage binding */
  private budget() {
    return Math.min(sceneryBudget(this.reach), this.device.limits.maxStorageBufferBindingSize ?? Number.POSITIVE_INFINITY);
  }
  private clear() {
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.requested = "";
    this.requestedCentre = null;
    // (a new place: its scene asked at once, not after the throttle)
    this.attempted = -Infinity;
    this.failures = 0;
    this.lastError = null;
    this.id++;
    this.data = null;
    this.applied = "";
    this.contact = null;
    if (this.allocated) {
      const old = this.buffer;
      this.allocated = false;
      this.buffer = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.retire(old, this.bufferBytes);
      this.bufferBytes = 64;
      this.onChange?.();
    }
    this.stamp++;
  }
  /** A buffer the bind groups still hold, destroyed once the work submitted with them is done (as clear()
   *  had it; the placeholder was destroyed at once: a frame encoded before the rebinding would use it) */
  private retire(old: GPUBuffer, bytes: number) {
    this.retiredBytes += bytes;
    void this.device.queue
      .onSubmittedWorkDone()
      .catch(() => {})
      .then(() => {
        old.destroy();
        this.retiredBytes -= bytes;
        if (bytes > 0) this.onContent?.();
      });
  }

  /**
   * camera: the tracer's eye on the Earth's axes [its equatorial radii] — the rays' origin in worldScenery
   * (params: P.scenery[3]) and the 12 km gate; priority: where the scene is centred (the eye led by its motion).
   */
  update(
    camera: Vec3 | null,
    mode: SceneryMode,
    satellite: boolean,
    terrain: boolean,
    exclusions: SceneryRequest["exclusions"] = [],
    priority: Vec3 | null = null,
    reach = 1,
  ) {
    if (this.disposed) return;
    const changed = this.mode !== mode || this.satellite !== satellite || this.reach !== reach;
    this.reach = reach;
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
      this.wanted = false;
      if (this.data || this.busy) this.clear();
      return;
    }
    if (!geo) return;
    const wanted = priority ? cartToGeodetic(1, WGS84_F, priority) : geo;
    const c = sceneryCentre(wanted.lat / D, wanted.lon / D);
    const distance = (v: { lat: number; lon: number }) =>
      Math.hypot((c.lat - v.lat) * 111320, wrapLon(c.lon - v.lon) * 111320 * Math.cos(c.lat * D));
    const dist = this.data ? distance(this.data) : Infinity;
    if (dist > 8000 * reach && this.data) {
      this.clear();
      this.onContent?.();
    }
    if ((changed || (this.requestedCentre && distance(this.requestedCentre) > 8000 * reach)) && this.busy) {
      this.worker?.terminate();
      this.worker = null;
      this.busy = false;
      this.requested = "";
      this.id++;
      // (the camera moved on: its new scene asked at once, not after the throttle)
      this.attempted = -Infinity;
    }
    const key = `${c.key}:${mode}:${satellite}:${reach}:${this.ign}:${this.overture}`;
    // (waited for — the settled frame, an offline render — until drawn, or failed and waiting to be tried again)
    this.wanted = key !== this.applied && !(key === this.requested && this.lastError);
    if (
      this.busy ||
      this.retiredBytes ||
      (key === this.requested && (!this.lastError || performance.now() < this.retryAt)) ||
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
        // (drawn, or failed and waiting to be tried again: no longer waited for)
        this.wanted = false;
        this.worker?.terminate();
        this.worker = null;
        const r = e.data;
        if (r.error || !r.buffer || r.buffer.byteLength > this.budget()) {
          this.lastError = r.error ?? "invalid scene size";
          this.failures++;
          this.retryAt = performance.now() + this.backoff();
          this.reason = "degraded";
          this.onContent?.();
          return;
        }
        // (a scene rebuilt with a source missing — the land cover's raster, a tile — while one is drawn here: the
        // drawn one kept, its trees and its contacts, the rebuild tried again later — before the buffer is made again
        // for a new reach: the drawn scene stays in the buffer the shader reads)
        if (r.errors?.length && this.data) {
          this.lastError = r.errors[0]!;
          this.failures++;
          this.retryAt = performance.now() + this.backoff();
          this.onContent?.();
          return;
        }
        // (the buffer the scene's budget, made again when a farther reach's scene needs more — or comes back to less)
        const size = this.budget();
        if (!this.allocated || this.bufferBytes !== size) {
          const old = this.buffer;
          const oldBytes = this.allocated ? this.bufferBytes : 0;
          this.allocated = true;
          this.bufferBytes = size;
          this.buffer = this.device.createBuffer({
            size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: "world forests and OSM scenery",
          });
          this.retire(old, oldBytes); // (the placeholder: not counted — the next scene is not held back for it)
          this.onChange?.();
        }
        const t = performance.now();
        this.device.queue.writeBuffer(this.buffer, 0, r.buffer);
        this.revision++;
        this.forestAt = new Float32Array(r.buffer, 0, 16)[8] ?? 0;
        this.seasonKey = "";
        this.contact = new SceneryContact(r, r.buffer);
        this.uploaded += performance.now() - t;
        this.data = { ...r, buffer: undefined };
        this.applied = key;
        this.started = performance.now();
        this.lastError = r.errors?.[0] ?? null;
        if (this.lastError) {
          this.failures++;
          this.retryAt = performance.now() + this.backoff();
        }
        this.stamp++;
        this.onContent?.();
      };
      this.worker.onerror = () => {
        this.wanted = false;
        this.lastError = "scenery worker unavailable";
        this.failures++;
        this.retryAt = performance.now() + this.backoff();
        this.reason = "degraded";
        this.busy = false;
        this.worker?.terminate();
        this.worker = null;
        this.onContent?.();
      };
      this.worker.postMessage({
        id,
        lat: c.lat,
        lon: c.lon,
        mode,
        satellite,
        exclusions,
        reach,
        budget: this.budget(),
        geoid: geoidPlane(c.lat, c.lon),
        ign: this.ign,
        overture: this.overture,
      } satisfies SceneryRequest);
    } catch (e) {
      this.lastError = String(e);
      this.failures++;
      this.retryAt = performance.now() + this.backoff();
      this.reason = "degraded";
      this.busy = false;
    }
  }
  /** The forest's season at the sim's date (UTC ms): the kinds' table rewritten when it moves two days. */
  season(utcMs: number) {
    if (!this.data || !this.forestAt || !this.allocated) return;
    const key = `${Math.round(utcMs / 172800000)}:${Math.round(this.data.lat)}`;
    if (key === this.seasonKey) return;
    this.seasonKey = key;
    this.device.queue.writeBuffer(this.buffer, (this.forestAt + 7) * 16, forestKindTable(forestSeason(utcMs, this.data.lat)));
    this.revision++;
  }
  /** the wait before trying again after a failure [ms]: 30 s, doubled each time, 5 min at most (never given up) */
  private backoff() {
    return Math.min(300000, 30000 * 2 ** Math.max(0, this.failures - 1));
  }
  /** the drawn scene's forest grid: its cells (w × h, one tree at most each; 0: none) — the raster's cull walks them */
  get forestCells() {
    return this.data?.forestCells ?? 0;
  }
  /** the tracer's params (P.scenery), one array written again each frame (none allocated per frame) */
  private paramsOut = new Float32Array(SCENERY_VEC4S * 4);
  params() {
    const o = this.paramsOut;
    const r = this.data;
    if (!r || !this.camera || this.mode === "off") return o.fill(0);
    const frame = sceneryFrame(r.lat, r.lon);
    const c = this.camera;
    const dx = c[0] * WGS84_A - frame.origin[0]!,
      dy = c[1] * WGS84_A - frame.origin[1]!,
      dz = c[2] * WGS84_A - frame.origin[2]!;
    const b = r.bounds!;
    const axes = [frame.east, frame.north, frame.up];
    for (let i = 0; i < 3; i++) {
      const v = axes[i]!;
      o[4 * i] = v[0];
      o[4 * i + 1] = v[1];
      o[4 * i + 2] = v[2];
      o[12 + i] = v[0] * dx + v[1] * dy + v[2] * dz;
    }
    o[3] = this.terrain ? 1 : 0;
    o[7] = (this.mode === "high" ? 3500 : 2500) * this.reach;
    o[11] = 1;
    o[15] = Math.min(1, (performance.now() - this.started) / 600);
    o[16] = b[0] * D;
    o[17] = b[3] * D;
    o[18] = 1 / ((b[2] - b[0]) * D);
    o[19] = 1 / ((b[3] - b[1]) * D);
    o[20] = this.mode === "high" ? 1 : 0;
    o[21] = this.satellite ? 1 : 0;
    o[22] = r.rgbPixels ? 1 : 0;
    o[23] = this.shadows ? 1 : 0;
    return o;
  }
  /** the scene's buildings Overture Maps' (B7: credited while drawn) */
  get overtureBuildings() {
    return this.data?.overtureBuildings ?? 0;
  }
  get active() {
    return !!this.data && this.mode !== "off";
  }
  get pending() {
    return this.busy || this.wanted || (!!this.data && performance.now() - this.started < 600);
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
      /** of them, placed and sized by the IGN's canopy over France (I4), and the survey's requests */
      surveyedTrees: d?.surveyedTrees ?? 0,
      surveyRequests: d?.surveyRequests ?? 0,
      surveyError: d?.surveyError ?? null,
      /** of the buildings, the IGN's BD TOPO's (I5), and its tiles */
      bdtopoBuildings: d?.bdtopoBuildings ?? 0,
      bdtopoTiles: d?.bdtopoTiles ?? 0,
      /** of the buildings, Overture Maps' (B7), and its tiles */
      overtureBuildings: d?.overtureBuildings ?? 0,
      overtureTiles: d?.overtureTiles ?? 0,
      /** the procedural forest's grid: its cells (one tree at most each), a cell's side [m] */
      forestCells: d?.forestCells ?? 0,
      forestCellM: d?.forestCellM ?? 0,
      buildings: d?.buildings ?? 0,
      footprintEdges: d?.vertices ?? 0,
      /** the roofs by shape (roofs.ts), the buildings with triangles for the raster and their bytes */
      roofShapes: d?.roofShapes ?? {},
      meshedBuildings: d?.meshedBuildings ?? 0,
      lidarRoofs: d?.lidarRoofs ?? 0,
      stacks: d?.stacks ?? 0,
      meshBytes: d?.meshBytes ?? 0,
      bytes: d?.bytes ?? null,
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
      gpuBytes: this.bufferBytes,
      reach: this.reach,
      retiringGpuBytes: this.retiredBytes,
      coverPixels: d?.coverPixels ?? 0,
      rgbPixels: d?.rgbPixels ?? 0,
      workerMs: d?.workerMs ?? 0,
      tileNetworkBytes: d?.networkBytes ?? 0,
      /** the scene's responses from an offline zone, and from elsewhere (I8a) */
      zoneResponses: d?.zoneResponses ?? 0,
      otherResponses: d?.otherResponses ?? 0,
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

/** The geoid round a scenery's centre [°] as a plane (SceneryRequest.geoid): N and its slopes per degree. */
export function geoidPlane(lat: number, lon: number): [number, number, number] {
  const n = (a: number, b: number) => geoidN(a * D, b * D);
  const e = 0.05;
  return [n(lat, lon), (n(lat + e, lon) - n(lat - e, lon)) / (2 * e), (n(lat, lon + e) - n(lat, lon - e)) / (2 * e)];
}
