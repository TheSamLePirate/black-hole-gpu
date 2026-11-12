import { detailOrigin } from "./detail-scans";
import type { Vec3 } from "../physics";
import { forestKindTable, forestSeason } from "./forest";
import { SceneryContact } from "./scenery-contact";
import { swControls } from "./earth-tiles";
import { sceneryBox, sceneryChains } from "./scenery-sources";
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
  type SceneryProgress,
  type SceneryReply,
  type SceneryRequest,
} from "./scenery-data";

export function sceneryShader(code: string, supported: boolean) {
  return supported
    ? code
    : code.replace(
        /\/\/ BEGIN_WORLD_SCENERY[\s\S]*?\/\/ END_WORLD_SCENERY/,
        "fn sceneryImage(q:vec3f)->SurfaceImage{return SurfaceImage(vec3f(0.0),0.0,0u);}\nfn worldScenery(d:vec3f,t:f32,r:f32)->f32{return t;}\nfn sceneryShadow(l:vec3f,n:vec3f)->f32{return 1.0;}\nfn sceneryMirror(r:vec3f,l:vec3f,e:vec3f,s:vec3f)->vec4f{return vec4f(0.0,0.0,0.0,-1.0);}\nstruct ScenerySurface {color:vec3f,cover:f32,kind:f32};\nfn scenerySurface(f:f32)->ScenerySurface{return ScenerySurface(vec3f(0.0),0.0,0.0);}\nfn sceneryWaterAt(p:vec3f,f:f32,d:f32)->vec2f{return vec2f(0.0);}\nfn sceneryTreeLite(d:vec3f,i:u32,t:f32,r:vec4f)->f32{return -1.0;}\nfn canopyTile(x:vec2f,f:f32,t:i32)->vec4f{return vec4f(1.0,0.0,0.0,0.0);}\nconst IMPOSTOR_BOUND=false;\nfn sceneryDeckBefore(d:vec3f,t:f32)->bool{return false;}\nfn rasterBuilding(l:u32,d:vec3f,t:f32,a:vec3f)->RasterBuilding{return RasterBuilding(a,vec3f(0.0,0.0,1.0),0.0,vec3f(0.0),1.0);}\nfn sceneryRoadLight(r:ScenerySurface,t:f32,x:vec2f)->f32{return CITY_WASH_FAR;}\nfn sceneryLampLight(x:vec2f)->vec2f{return vec2f(0.0);}\nconst STREET_POOL_GAIN=4.0;\nfn sceneryGround(d:vec3f,t:f32,f:f32)->ScenerySurface{return ScenerySurface(vec3f(0.0),0.0,0.0);}\nfn sceneryDecal(x:vec2f,f:f32,d:f32)->vec4f{return vec4f(0.0);}",
      );
}

/** the scenery's centre held while the point wanted stays this near it [m, × the detail's reach] — a box 13 km wide at the very
 *  far reach (scenery-sources.ts sceneryBox): led 3 km, the view still in it; the buildings' detail made round the camera
 *  too (SceneryRequest.eye) */
const CENTRE_HOLD_M = 1500;
/** the quick first scene's box, a share of the reach's (~2 km round its centre at the very far reach), asked while no drawn
 *  scene covers the camera — the camera past QUICK_COVER of the drawn box's radius, or none drawn: a first arrival, a jump —:
 *  the near buildings, roads and trees in a fraction of the full scene's time, the full one right after; not when a flight
 *  re-centres a scene that still covers it (each re-centring's work twice) */
const QUICK_SHARE = 0.35;
const QUICK_COVER = 0.8;

export class EarthScenery {
  contact: SceneryContact | null = null;
  buffer: GPUBuffer;
  onChange: (() => void) | null = null;
  onContent: (() => void) | null = null;
  stamp = 0;
  readonly supported: boolean;
  private worker: Worker | null = null;
  /** (T8m) the craft's speed over the ground [m/s] (the renderer's, each frame): a fast flight chains quick scenes */
  speed = 0;
  /** (T8m) the last full and quick scenes' preparation in the worker [ms] (0: none yet) */
  private lastMs = { full: 0, quick: 0 };
  private data: SceneryReply | null = null;
  /** the bridges drawn (their decks the rays' kernel's: renderer — shade — not skipped while there are) */
  get bridgeCount() {
    return this.data?.bridges ?? 0;
  }
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
  /** (Q8 L10) the streets' lamps and their light's pools (settings.earthStreetLamps) */
  lamps = true;
  private started = 0;
  private attempted = -Infinity;
  private busy = false;
  /** the worker's step under way (the loading status: the interface's data meter), null when none is preparing */
  progress: SceneryProgress | null = null;
  private reason = "off";
  private lastError: string | null = null;
  private disposed = false;
  private uploaded = 0;
  private retiredBytes = 0;
  private requestedCentre: ReturnType<typeof sceneryCentre> | null = null;
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
    let c = sceneryCentre(wanted.lat / D, wanted.lon / D);
    // (the centre asked kept while the point wanted stays within CENTRE_HOLD_M × reach of it: led along the view, that point
    // crossed a 556 m cell at each turn of the head — the camera looked down, a new scene of 35–180 s asked, the old one with
    // its boxes under the craft kept meanwhile: a scene rebuilt over and over, never the one in view)
    const held = this.requestedCentre;
    if (held && this.requested.endsWith(`:${mode}:${satellite}:${reach}:${this.ign}:${this.overture}:${this.lamps}`)) {
      const off = Math.hypot((held.lat - wanted.lat / D) * 111320, wrapLon(held.lon - wanted.lon / D) * 111320 * Math.cos(held.lat * D));
      if (off < CENTRE_HOLD_M * reach * (this.fastFlight() ? QUICK_SHARE : 1)) c = held;
    }
    const distance = (v: { lat: number; lon: number }) =>
      Math.hypot((c.lat - v.lat) * 111320, wrapLon(c.lon - v.lon) * 111320 * Math.cos(c.lat * D));
    const dist = this.data ? distance(this.data) : Infinity;
    if (dist > 8000 * reach && this.data) {
      this.clear();
      this.onContent?.();
    }
    if ((changed || (this.requestedCentre && distance(this.requestedCentre) > 8000 * reach)) && this.busy) {
      // (the scene under way given up — the worker told, which drops it at its next step —, the worker kept: its network's
      // answers and its buildings' plans with it for the next scene; terminated, a flight's every re-centring lost them)
      this.worker?.postMessage({ cancel: this.id });
      this.busy = false;
      this.requested = "";
      this.id++;
      // (the camera moved on: its new scene asked at once, not after the throttle)
      this.attempted = -Infinity;
    }
    // (no drawn scene round the camera — the first arrival, a jump —: a quick near one first)
    const eyeToDrawn = this.data
      ? Math.hypot((this.data.lat - geo.lat / D) * 111320, wrapLon(this.data.lon - geo.lon / D) * 111320 * Math.cos(geo.lat))
      : Infinity;
    // (T8m: or a flight too fast for a full scene — the craft out of its box's half before one is ready —: quick scenes one
    // after the other, each centred where the craft will be — the renderer's lead —, until it slows down)
    const quick = this.fastFlight() || (eyeToDrawn > QUICK_COVER * sceneryBox(0, 0, mode, reach).radius && !this.applied.endsWith(":q"));
    const key = `${c.key}:${mode}:${satellite}:${reach}:${this.ign}:${this.overture}:${this.lamps}${quick ? ":q" : ""}`;
    // (waited for — the settled frame, an offline render — until drawn, or failed and waiting to be tried again)
    this.wanted = key !== this.applied && !(key === this.requested && this.lastError);
    // (in flight: the next scene's data fetched ahead — the network idle otherwise until the craft leaves the hold, or while the
    // worker computes the scene under way)
    if (this.data && this.prefetchOn) this.prefetchAhead(geo.lat / D, geo.lon / D, mode, satellite, reach);
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
      this.progress = { step: "start" };
      this.worker.onmessage = (e: MessageEvent<SceneryReply>) => {
        if (this.disposed || e.data.id !== this.id) return;
        // (the worker's progress — the step under way, the buildings' tiles —: kept for the loading status, the scene not yet)
        if (e.data.progress) {
          this.progress = e.data.progress;
          return;
        }
        this.progress = null;
        this.busy = false;
        // (drawn, or failed and waiting to be tried again: no longer waited for — the worker kept for the next scene, its
        // network's answers with it: T8m)
        this.wanted = false;
        const r = e.data;
        if (r.workerMs) this.lastMs[this.requested.endsWith(":q") ? "quick" : "full"] = r.workerMs;
        if (r.error || !r.buffer || r.buffer.byteLength > this.budget()) {
          this.lastError = r.error ?? "invalid scene size";
          this.failures++;
          this.retryAt = performance.now() + this.backoff();
          this.reason = "degraded";
          this.onContent?.();
          return;
        }
        // (a scene rebuilt with a source missing — the land cover's raster, a tile — while the same one is drawn here: the
        // drawn one kept, its trees and its contacts, the rebuild tried again later — before the buffer is made again
        // for a new reach: the drawn scene stays in the buffer the shader reads. Another place's scene is taken, an error in
        // it or not — the drawn one is elsewhere, the view's not in it; tried again later the same)
        if (r.errors?.length && this.data && this.applied === key) {
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
        // (its BVH's nodes — the header's first float —: the raster's box culling dispatched over them, SceneryRaster.encodeCull)
        this.nodeCount = new Float32Array(r.buffer, 0, 16)[0] ?? 0;
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
        lamps: this.lamps,
        eye: [geo.lat / D, geo.lon / D],
        ...(quick ? { quick: QUICK_SHARE } : {}),
        swGate: swControls(),
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
  /** (the scenery's loading, Sam, 6 Nov 2026: « le voyant net passe au gris » — a scene drawn, nothing asked until the craft
   *  has flown out of its hold, ~30 s at an approach's speed, the network idle) the craft's track (two places 2 s apart at
   *  least), the last centre prefetched */
  private track: { lat: number; lon: number; t: number } | null = null;
  private heading: [number, number] | null = null;
  private prefetched = "";
  /**
   * The next scene's data fetched ahead: its centre where the craft will ask it — its hold's distance twice along its track —,
   * every fetch of it (scenery-sources.ts sceneryChains: the land cover, the vector tiles, the relief, the surveys; Overture's
   * byte ranges left to the scene) from the page, four at a time, into the browser's HTTP cache (OpenFreeMap's a day, the
   * relief's and the land cover's alike) — the worker's own fetches then answered from it —, while the worker computes the
   * scene under way: none computed here; in flight only (over 15 m/s), each new cell once, the older given up.
   */
  private prefetchAhead(lat: number, lon: number, mode: SceneryMode, satellite: boolean, reach: number) {
    const now = performance.now();
    if (!this.track || now - this.track.t > 2000) {
      if (this.track) {
        const de = wrapLon(lon - this.track.lon) * Math.cos(lat * D),
          dn = lat - this.track.lat,
          l = Math.hypot(de, dn);
        this.heading = l > 1e-6 ? [de / l, dn / l] : this.heading;
      }
      this.track = { lat, lon, t: now };
    }
    if (this.speed < 15 || !this.heading) return;
    const ahead = (2 * CENTRE_HOLD_M * reach) / 111320;
    const c = sceneryCentre(lat + this.heading[1] * ahead, lon + (this.heading[0] * ahead) / Math.cos(lat * D));
    const key = `${c.key}:${mode}:${satellite}:${reach}:${this.ign}:${this.overture}`;
    if (key === this.prefetched) return;
    this.prefetched = key;
    const gen = ++this.prefetchGen;
    const urls = sceneryChains({ lat: c.lat, lon: c.lon, mode, satellite, reach, ign: this.ign, overture: this.overture })
      .map((ch) => ch[0]!)
      .filter((u) => !u.includes("overture") && !u.includes(".pmtiles"));
    let k = 0;
    const run = async () => {
      while (k < urls.length && gen === this.prefetchGen && !this.disposed) {
        const u = urls[k++]!;
        try {
          await (await fetch(u, { signal: AbortSignal.timeout(20_000) })).arrayBuffer();
          this.prefetchedCount++;
        } catch {
          /* (a miss ahead: the scene asks it again) */
        }
      }
    };
    for (let i = 0; i < 4; i++) void run();
  }
  private prefetchGen = 0;
  /** (off by default: measured on an approach to JFK, 670 MB against 280 without it — the worker's own fetches not answered
   *  by the HTTP cache, the data asked twice —; kept for the streaming plan's measures — docs/ANALYSE-STREAMING-2026-11-06.md) */
  prefetchOn = false;
  /** the fetches made ahead since the start (a scene's data the next one finds in the HTTP cache) */
  prefetchedCount = 0;
  /** the wait before trying again after a failure [ms]: 30 s, doubled each time, 5 min at most (never given up) */
  private backoff() {
    return Math.min(300000, 30000 * 2 ** Math.max(0, this.failures - 1));
  }
  /** the drawn scene's forest grid: its cells (w × h, one tree at most each; 0: none) — the raster's cull walks them */
  /** the scenery's BVH nodes uploaded (their boxes culled for the raster — scenery-raster.ts cullBoxes) */
  nodeCount = 0;
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
    // (Q7 L8: the detail scans' world origin — the frame's centre's, modulo their period — and on)
    const dO = detailOrigin(r.lat, r.lon);
    o[24] = dO[0];
    o[25] = dO[1];
    o[26] = this.detailOn ? 1 : 0;
    o[27] = this.impostorsOn ? 1 : 0;
    // (V2e — F1: the wind the near trees sway in — towards on the frame's axes, strength, the clock; renderer.ts sets it)
    o[28] = this.sway[0];
    o[29] = this.sway[1];
    o[30] = this.sway[2];
    o[31] = this.sway[3];
    return o;
  }
  /** (Q7 L8) the ground's detail scans drawn (settings.earthDetail, their texture in) */
  detailOn = false;
  /** (PLAN-VEGETATION-V2 V2c) the far trees read from their impostors (baked, renderer.treeImpostorsOn): P.scenery[6].w */
  impostorsOn = false;
  /** (V2e — F1) the wind the near trees sway in: towards east, north (unit), strength (0 calm … 2), the game's clock [s] */
  sway: [number, number, number, number] = [0, 0, 0, 0];
  /** the scene's buildings Overture Maps' (B7: credited while drawn) */
  get overtureBuildings() {
    return this.data?.overtureBuildings ?? 0;
  }
  /** the scene's centre [°] (null: none yet) */
  get place(): { lat: number; lon: number } | null {
    return this.data ? { lat: this.data.lat, lon: this.data.lon } : null;
  }
  /** (Q8 D1) the wind turbines drawn — Overture's too (its credit shown) */
  get turbines() {
    return (this.data?.turbines ?? 0) + (this.data?.pylons ?? 0);
  }
  get active() {
    return !!this.data && this.mode !== "off";
  }
  get pending() {
    return this.busy || this.wanted || (!!this.data && performance.now() - this.started < 600);
  }
  /** (T8m) how long a scene takes to be ready here [s]: the last one's preparation in the worker, a third more for the
   *  request's throttle and the upload (35 s before any) — where a scene asked now is to be centred along the track */
  buildS() {
    const ms = this.fastFlight() ? this.lastMs.quick : this.lastMs.full || this.data?.workerMs;
    return ms ? (ms / 1000) * 1.35 + 3 : this.fastFlight() ? 15 : 35;
  }
  /** (T8m) too fast for a full scene: the craft would cross half its box's radius while one is made (120 m/s at least) */
  fastFlight() {
    const full = this.lastMs.full ? (this.lastMs.full / 1000) * 1.35 + 3 : 35;
    return this.speed > 120 && this.speed * full > 0.5 * sceneryBox(0, 0, this.mode, this.reach).radius;
  }
  /** (T8m) the box's radius the next scene will have [m] (a quick one's share in a fast flight) */
  nextRadius() {
    return sceneryBox(0, 0, this.mode, this.reach).radius * (this.fastFlight() ? QUICK_SHARE : 1);
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
      progress: this.progress,
      /** (T8m) the scene drawn is a quick first one — its box QUICK_SHARE of the reach's, its budgets as much squared —, the full
       *  one to follow: a test counting the buildings waits for `!quick` */
      quick: this.applied.endsWith(":q"),
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
      /** (Q8 D1) the wind turbines drawn */
      turbines: d?.turbines ?? 0,
      /** (Q8 D1) the high-voltage pylons drawn */
      pylons: d?.pylons ?? 0,
      /** (Q8 D1) the spans of conductors drawn */
      cables: d?.cables ?? 0,
      /** (Q8 D1) the cars on the main roads */
      cars: d?.cars ?? 0,
      /** (Q8 D1) the main roads' lines the traffic read, their pieces */
      trafficRoads: d?.trafficRoads ?? 0,
      roadPieces: d?.roadPieces ?? 0,
      /** (Q8 L10) the streets' lamps drawn */
      lamps: d?.lamps ?? 0,
      /** (Q8 D1) the vineyards' and orchards' polygons drawn as rows */
      rowCrops: d?.rowCrops ?? 0,
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
      phases: d?.phases ?? null,
      fetchCache: d?.fetchCache ?? null,
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
