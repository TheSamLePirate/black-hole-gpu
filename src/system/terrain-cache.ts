import { TABLE_TERRAIN } from "../gpu-tables";
import type { TileChange } from "./earth-tiles";
import { wgslFunction } from "./warp-grid";
import {
  TERRAIN_CACHE_HEADER,
  TERRAIN_CACHE_LEVELS,
  TERRAIN_CACHE_N,
  TERRAIN_CACHE_NODE_VEC4S,
  TERRAIN_CACHE_ROUNDS,
  type TerrainWindow,
  terrainWindow,
  terrainWindowParams,
} from "./terrain-cache-layout";

/** a data resolution [m] under which the node's ground is a survey's (earth-tiles.ts TILE_RES_FINE: its texel's; the
 *  global data's never under TILE_RES_MIN, 25 m) — there, the cache baked on the tiles the pixels read (I6) */
export const SURVEY_RES = 20;

/** Read-only lookup, injected in place of the tracer's standalone stub. No new binding or optical path. */
export function withTerrainCache(trace: string): string {
  const marker = /\/\/ BEGIN_TERRAIN_CACHE[\s\S]*?\/\/ END_TERRAIN_CACHE/;
  if (!marker.test(trace)) throw new Error("terrain-cache: missing tracer stub");
  return trace.replace(
    marker,
    `
const TC_OFF = ${TABLE_TERRAIN}u;
const TC_N = ${TERRAIN_CACHE_N}u;
const TC_NODE_VEC4S = ${TERRAIN_CACHE_NODE_VEC4S}u;
fn terrainCacheNode(k: u32, i: vec2u) -> f32 {
  let n = i.y * TC_N + i.x;
  return bodies[TC_OFF + ${TERRAIN_CACHE_HEADER}u + k * TC_NODE_VEC4S + n / 4u][n % 4u];
}
fn terrainCachedHeight(q: vec3f, foot: f32) -> f32 {
  // Never used by probes, offline/quality frames or the walking contact patch (the CPU remains exact).
  if (P.mouthList[1].w < 0.5 || P.walk[0].w > 0.5) { return -1.0; }
  var sum = 0.0;
  var rem = 1.0;
  for (var k = 0u; k < ${TERRAIN_CACHE_LEVELS}u; k++) {
    let r = bodies[TC_OFF + 2u * k];
    let s = bodies[TC_OFF + 2u * k + 1u];
    if (s.z < 0.5 || foot < s.y) { continue; }
    let dl = atan2(-q.x * r.y + q.y * r.x, q.x * r.x + q.y * r.y);
    let sz = clamp(q.z, -1.0, 1.0);
    let da = asin(clamp(sz * r.w - sqrt(max(1.0 - sz * sz, 0.0)) * r.z, -1.0, 1.0));
    let uv = vec2f(dl, da) * s.x;
    let edge = min(min(uv.x, uv.y), min(f32(TC_N - 1u) - uv.x, f32(TC_N - 1u) - uv.y));
    if (edge <= 0.0) { continue; }
    // Fade both ends of the footprint interval: crossing a source's threshold must not pop.
    // Exact evaluation fills all remainder; this is an approximation pending visual/error validation.
    let octave = log2(max(foot / s.y, 1.0));
    let band = smoothstep(0.0, 0.5, octave) * (1.0 - smoothstep(1.0, 2.0, octave));
    let w = smoothstep(0.0, 12.0, edge) * band;
    if (w <= 0.0) { continue; }
    let i = vec2u(floor(uv));
    let f = fract(uv);
    let a = mix(terrainCacheNode(k, i), terrainCacheNode(k, i + vec2u(1, 0)), f.x);
    let b = mix(terrainCacheNode(k, i + vec2u(0, 1)), terrainCacheNode(k, i + vec2u(1, 1)), f.x);
    sum += rem * w * mix(a, b, f.y);
    rem *= 1.0 - w;
    if (rem < 1e-4) { return sum / (1.0 - rem); }
  }
  if (rem >= 1.0) { return -1.0; }
  return sum + rem * earthHeightExactG(q, foot);
}`,
  );
}

/**
 * Bake natural terrain from the tracer's own height function and DEM filtering. Select its
 * transitive function/constant dependencies, not a hand-maintained second terrain implementation.
 * Evaluate the warp field directly so nodes do not depend on the camera's moving warp windows.
 * Default: natural terrain for caching. The raster variant enables the original runway grading.
 */
export function terrainHeightLibrary(trace: string, runways = false, group = 0): string {
  const functions = new Map<string, string>();
  for (const [, name] of trace.matchAll(/^fn (\w+)\(/gm)) functions.set(name!, wgslFunction(trace, name!));
  functions.set("earthWarp", "fn earthWarp(q: vec3f) -> vec3f { return earthWarpExact(q); }");
  // (the heights' place on the tiles: the anchored one — the bake sets each node's, terrainCacheShader)
  functions.set(
    "tileHeightCoord",
    "var<private> TILE_GQ: vec3f;\nfn tileHeightCoord(q: vec3f) -> vec2f { if (TILE_AT_ON && all(q == TILE_GQ)) { return TILE_AT; } return tilePlace(q); }",
  );
  const selected = new Map<string, string>();
  const add = (name: string) => {
    if (name === "cost" || selected.has(name)) return;
    const body = functions.get(name);
    if (!body) throw new Error(`terrain-cache: missing ${name}`);
    selected.set(name, body);
    for (const [, callee] of body.matchAll(/\b(\w+)\s*\(/g)) if (functions.has(callee!)) add(callee!);
  };
  add("earthHeightExactG");
  const declarations = new Map<string, string>();
  // (and the private variables they read — tileCoord's anchor, set by the bake for each node)
  for (const [line, name] of trace.matchAll(/^(?:const|override|var<private>)\s+(\w+)\b[^;]*;/gm)) declarations.set(name!, line!);
  let source = [...selected.values()].join("\n");
  const constants = new Map<string, string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, declaration] of declarations) {
      if (!constants.has(name) && new RegExp(`\\b${name}\\b`).test(source)) {
        constants.set(name, declaration);
        source += `\n${declaration}`;
        grew = true;
      }
    }
  }
  const params = /struct Params\s*\{[\s\S]*?\};/.exec(trace)?.[0];
  if (!params) throw new Error("terrain-cache: missing Params");
  constants.set("HAS_RWY", `override HAS_RWY: bool = ${runways};`);
  return `${params}
${[...constants.values()].join("\n")}
@group(${group}) @binding(0) var<uniform> P: Params;
@group(${group}) @binding(4) var bgSamp: sampler;
@group(${group}) @binding(21) var earthElev: texture_2d<f32>;
@group(${group}) @binding(28) var earthTiles: texture_2d_array<u32>;
fn cost(k: u32) {}
${[...selected.values()].join("\n")}`;
}

/**
 * The tracer's geoid (trace.wgsl geoidN, geoidNode) for a shader beside it: its constants the library lacks, the
 * table read through that shader's own binding of the same buffer (gpu-tables.ts TABLE_GEOID).
 */
export function geoidLibrary(trace: string, library: string, buffer: string): string {
  const consts = ["GEOID_OFF", "GEOID_W", "GEOID_H", "PI", "TAU"]
    .filter((name) => !new RegExp(`^const ${name}\\b`, "m").test(library))
    .map((name) => {
      const line = new RegExp(`^const ${name}\\b[^;]*;`, "m").exec(trace)?.[0];
      if (!line) throw new Error(`terrain-cache: missing ${name}`);
      return line;
    });
  const fns = ["geoidNode", "geoidN"].map((name) => wgslFunction(trace, name).replace(/\bbodies\[/g, `${buffer}[`));
  return [...consts, ...fns].join("\n");
}

export function terrainCacheShader(trace: string): string {
  return `${terrainHeightLibrary(trace)}
struct CacheU { reference: vec4f, scale: vec4f, tiles: vec4f };
@group(1) @binding(0) var<uniform> U: CacheU;
@group(1) @binding(1) var<storage, read_write> outHeights: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= vec2u(${TERRAIN_CACHE_N}u))) { return; }
  let d = vec2f(gid.xy) / U.scale.x;
  let cl = U.reference.x * cos(d.x) - U.reference.y * sin(d.x);
  let sl = U.reference.y * cos(d.x) + U.reference.x * sin(d.x);
  let sa = U.reference.z * cos(d.y) + U.reference.w * sin(d.y);
  let ca = U.reference.w * cos(d.y) - U.reference.z * sin(d.y);
  let q = vec3f(ca * cl, ca * sl, sa);
  // (the node's place on the tiles from the window's reference — float64 on the CPU: U.tiles, terrainCacheTiles —, exact: its
  // unit-sphere point in float32 is good to ~0.4 m only, its sine of the latitude a step of 6e-8 — each row of nodes read off
  // its place by a step that changed from one row to the next, the ground drawn as a stair of bands across)
  if (U.tiles.w > 0.5) {
    let ds = U.reference.w * sin(d.y) - 2.0 * U.reference.z * sin(0.5 * d.y) * sin(0.5 * d.y);
    TILE_GQ = q;
    TILE_AT_ON = true;
    TILE_AT = vec2f(U.tiles.x + d.x, U.tiles.y + atanh(ds / (1.0 - (U.reference.z + ds) * U.reference.z)));
  }
  var h = earthHeightExactG(q, U.scale.y);
  // (over a survey — France —: its tiles as the pixels read them, the finest held at the node, not at the node's footprint.
  // A coarse node's footprint reads the far levels (z 11 … 13), their overground on them — I6 —, where the camera's pixels see
  // the bare ground of the windows z 14 and finer: the 9.5 and 38 m rings stood a forest's height over the ground drawn, the
  // hint's bracket missed it, the whole march redone (+10 % of the raster's shading low over the woods). Beyond those windows
  // the finest held is a far level itself: its overground kept, as drawn)
  let fine = earthH(q, 1.0, false);
  if (fine.y < ${SURVEY_RES}) { h = max(h + fine.x - earthH(q, U.scale.y, false).x, 0.0); }
  outHeights[gid.y * ${TERRAIN_CACHE_N}u + gid.x] = h;
}`;
}

export interface TerrainCacheSources {
  params: GPUBuffer;
  table: GPUBuffer;
  elevation: GPUTexture;
  tiles: GPUTexture;
  sampler: GPUSampler;
}

/**
 * Where a change of the tiles falls for a level (T4): outside its window, nothing; within the part it draws — its ring: its
 * window less the finer level's, that one's geomorph band (16 nodes) and the ring's overlap (4 nodes and a coarse cell) kept —,
 * visible; else hidden under the finer levels (a finer level not ready: visible).
 */
export function changeInRing(
  k: number,
  c: TileChange,
  windows: readonly (TerrainWindow | null)[],
  ready: readonly boolean[],
): "none" | "visible" | "hidden" {
  if (c.z < 0) return "visible";
  const box = (w: TerrainWindow, round: number, shrink = 0) => {
    const per = round / (2 * Math.PI);
    return {
      lon0: (w.i + shrink) / per,
      lon1: (w.i + TERRAIN_CACHE_N - 1 - shrink) / per,
      lat0: (w.j + shrink) / per,
      lat1: (w.j + TERRAIN_CACHE_N - 1 - shrink) / per,
    };
  };
  const w = windows[k];
  if (!w) return "none";
  const b = box(w, TERRAIN_CACHE_ROUNDS[k]!);
  // (the change's longitudes brought next to the window's)
  const mid = 0.5 * (b.lon0 + b.lon1),
    cm = 0.5 * (c.lon0 + c.lon1);
  const shift = Number.isFinite(cm) ? Math.round((mid - cm) / (2 * Math.PI)) * 2 * Math.PI : 0;
  const lon0 = c.lon0 + shift,
    lon1 = c.lon1 + shift;
  if (lon1 < b.lon0 || lon0 > b.lon1 || c.lat1 < b.lat0 || c.lat0 > b.lat1) return "none";
  const inner = k > 0 ? windows[k - 1] : null;
  if (!inner || !ready[k - 1]) return "visible";
  const i = box(inner, TERRAIN_CACHE_ROUNDS[k - 1]!, 17);
  return lon0 >= i.lon0 && lon1 <= i.lon1 && c.lat0 >= i.lat0 && c.lat1 <= i.lat1 ? "hidden" : "visible";
}

/** Every moved level baked in its frame, then one stale level a frame; exact fallback until ready. No CPU terrain sampling or readback. */
export class TerrainCache {
  private pipeline: GPUComputePipeline | null = null;
  private error: string | null = null;
  private disposed = false;
  private sources: TerrainCacheSources | null = null;
  private input: GPUBindGroup | null = null;
  private staging: GPUBuffer | null = null;
  private uniforms: GPUBuffer[] = [];
  private outputs: GPUBindGroup[] = [];
  private windows: (TerrainWindow | null)[] = Array(TERRAIN_CACHE_LEVELS).fill(null);
  private ready = Array<boolean>(TERRAIN_CACHE_LEVELS).fill(false);
  /** a level baked from tiles since replaced (a finer one streamed in): still drawn, baked again in turn — not dropped, or
   *  the far rings went back to the camera's marches for frames at every tile (a cost spike, a pop) */
  private dirty = Array<boolean>(TERRAIN_CACHE_LEVELS).fill(false);
  private metadata = new Float32Array(TERRAIN_CACHE_HEADER * 4);
  private revision = "";
  private builds = 0;
  private invalidations = 0;
  /** (T4) the tiles' changes each level has seen (their last order), and since when a level holds one hidden from its ring
   *  (0: none) — baked again at last after HIDDEN_MS, coalesced */
  private seen = Array<number>(TERRAIN_CACHE_LEVELS).fill(0);
  private hiddenSince = Array<number>(TERRAIN_CACHE_LEVELS).fill(0);
  static readonly HIDDEN_MS = 10_000;
  /** a visible change's bake held until the changes calm (QUIET_MS without one), MAX_MS at most: several tiles' completions
   *  in a row — a level's window whole, then the next's — one bake (T4: the updates coalesced) */
  private visibleFirst = Array<number>(TERRAIN_CACHE_LEVELS).fill(0);
  private visibleLast = Array<number>(TERRAIN_CACHE_LEVELS).fill(0);
  static readonly QUIET_MS = 150;
  /** (T4) the camera's motion on the lattice (longitude, latitude [rad/s], smoothed): the windows placed ahead along it */
  private lastAt: { lon: number; lat: number; t: number } | null = null;
  private motion: [number, number] = [0, 0];
  static readonly MAX_MS = 500;
  /** the changes seen by where they fell: in a level's ring (baked again at once), or hidden under the finer levels */
  changesVisible = 0;
  changesHidden = 0;
  /** (T4) the bakes by level and by cause: the window moved (or never baked), or newer tiles (dirty) */
  private bakesMoved = Array<number>(TERRAIN_CACHE_LEVELS).fill(0);
  private bakesDirty = Array<number>(TERRAIN_CACHE_LEVELS).fill(0);
  private constructor(private device: GPUDevice) {}

  static create(device: GPUDevice, trace: string): TerrainCache {
    const cache = new TerrainCache(device);
    void cache.compile(trace);
    return cache;
  }

  private async compile(trace: string) {
    try {
      const module = this.device.createShaderModule({ code: terrainCacheShader(trace), label: "terrain surface cache" });
      const pipeline = await this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
      if (!this.disposed) this.pipeline = pipeline;
    } catch (e) {
      if (this.disposed) return;
      this.error = String(e);
      console.warn("Terrain cache unavailable; reference terrain retained:", e);
    }
  }

  setSources(sources: TerrainCacheSources) {
    const old = this.sources;
    if (old && (Object.keys(sources) as (keyof TerrainCacheSources)[]).every((k) => old[k] === sources[k])) return;
    this.sources = sources;
    this.input = null;
    this.revision = "";
    this.ready.fill(false);
    this.dirty.fill(false);
  }

  encode(
    enc: GPUCommandEncoder,
    at: { lon: number; lat: number } | null,
    revision: string,
    timestamp?: () => GPUComputePassDescriptor,
    preferredLevel = -1,
    tilesRef: readonly [number, number, number] | null = null,
    changes: readonly TileChange[] = [],
  ): boolean {
    const { pipeline, sources } = this;
    if (this.disposed || !pipeline || !sources) return false;
    const metadata = this.metadata;
    metadata.fill(0);
    if (revision !== this.revision) {
      // (new tiles: every level baked again in turn, the old bake drawn meanwhile)
      this.dirty.fill(true);
      this.revision = revision;
      this.invalidations++;
    }
    // (the motion: its direction on the lattice past 1e-7 rad/s — 0.6 m/s on the Earth —;
    // a camera at rest or turning on itself: centred)
    const t = performance.now();
    if (at && this.lastAt && t > this.lastAt.t) {
      let dl = at.lon - this.lastAt.lon;
      dl -= Math.round(dl / (2 * Math.PI)) * 2 * Math.PI;
      const dt = (t - this.lastAt.t) / 1000,
        a = Math.min(1, dt / 0.5);
      this.motion = [
        this.motion[0] + a * (dl / dt - this.motion[0]),
        this.motion[1] + a * ((at.lat - this.lastAt.lat) / dt - this.motion[1]),
      ];
    }
    this.lastAt = at ? { lon: at.lon, lat: at.lat, t } : null;
    const speed = Math.hypot(this.motion[0], this.motion[1]);
    const dir: [number, number] | null = speed > 1e-7 ? [this.motion[0] / speed, this.motion[1] / speed] : null;
    for (let k = 0; k < TERRAIN_CACHE_LEVELS; k++) {
      const previous = this.windows[k]!;
      const w = at ? terrainWindow(previous, at.lon, at.lat, TERRAIN_CACHE_ROUNDS[k]!, dir) : null;
      // (a window moved: its bake elsewhere — not drawn until baked again)
      if (w !== previous) this.ready[k] = false;
      this.windows[k] = w;
      if (w) metadata.set(terrainWindowParams(w, TERRAIN_CACHE_ROUNDS[k]!, this.ready[k]!), 8 * k);
    }
    // (T4: the tiles' changes not yet seen — a level baked again at once where one shows in its ring, after HIDDEN_MS where all
    // fell under the finer levels; every change at most once a level)
    const now = performance.now();
    const last = changes.length ? changes[changes.length - 1]!.seq : 0;
    for (let k = 0; k < TERRAIN_CACHE_LEVELS; k++) {
      if (!this.windows[k] || !this.ready[k]) {
        this.seen[k] = last;
        continue;
      }
      for (const c of changes) {
        if (c.seq <= this.seen[k]!) continue;
        const w = changeInRing(k, c, this.windows, this.ready);
        if (w === "visible") {
          this.changesVisible++;
          if (!this.visibleFirst[k]) this.visibleFirst[k] = now;
          this.visibleLast[k] = now;
        } else if (w === "hidden") {
          this.changesHidden++;
          if (!this.hiddenSince[k]) this.hiddenSince[k] = now;
        }
      }
      this.seen[k] = last;
      if (this.hiddenSince[k] && now - this.hiddenSince[k]! >= TerrainCache.HIDDEN_MS) this.dirty[k] = true;
      const first = this.visibleFirst[k]!;
      if (first && (now - this.visibleLast[k]! >= TerrainCache.QUIET_MS || now - first >= TerrainCache.MAX_MS)) this.dirty[k] = true;
    }
    // (which level to bake: the patch's first, then its far rings' — the two coarser —, then the rest; a missing one before
    // a dirty one)
    const order =
      preferredLevel >= 0
        ? [preferredLevel, preferredLevel + 1, preferredLevel + 2, ...this.windows.map((_, i) => i)].filter((i) => i < TERRAIN_CACHE_LEVELS)
        : this.windows.map((_, i) => i);
    const wants = (i: number) => this.windows[i] !== null;
    // (every level whose window moved this frame, baked in it: one a frame, the far rings past a moved one were not drawn
    // for the frames it waited — the whole landscape beyond the patch's 150 m traced in blocks for one to three frames, a
    // mush every second in flight. Then the levels due again from newer tiles, all in one frame — T4: a generation, the
    // neighbours published together, never one drawn against the other's older tiles —, the old bakes drawn until then)
    const bake = order.filter((i, n) => wants(i) && !this.ready[i] && order.indexOf(i) === n);
    if (!bake.length) for (const d of order) if (wants(d) && this.dirty[d] && !bake.includes(d)) bake.push(d);
    if (bake.length) {
      if (!this.staging) {
        this.staging = this.device.createBuffer({
          size: TERRAIN_CACHE_NODE_VEC4S * 16,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        // (a uniform a level: several baked in one submission, each its own window)
        for (let l = 0; l < TERRAIN_CACHE_LEVELS; l++) {
          const uniform = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          this.uniforms.push(uniform);
          this.outputs.push(
            this.device.createBindGroup({
              layout: pipeline.getBindGroupLayout(1),
              entries: [
                { binding: 0, resource: { buffer: uniform } },
                { binding: 1, resource: { buffer: this.staging } },
              ],
            }),
          );
        }
      }
      this.input ??= this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: sources.params } },
          { binding: 4, resource: sources.sampler },
          { binding: 21, resource: sources.elevation.createView() },
          { binding: 28, resource: sources.tiles.createView({ dimension: "2d-array" }) },
        ],
      });
      for (const k of bake) {
        this.device.queue.writeBuffer(this.uniforms[k]!, 0, metadata.subarray(8 * k, 8 * k + 8));
        this.device.queue.writeBuffer(this.uniforms[k]!, 32, terrainCacheTiles(this.windows[k]!, TERRAIN_CACHE_ROUNDS[k]!, tilesRef));
        const pass = enc.beginComputePass(timestamp?.());
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, this.input);
        pass.setBindGroup(1, this.outputs[k]!);
        pass.dispatchWorkgroups(Math.ceil(TERRAIN_CACHE_N / 8), Math.ceil(TERRAIN_CACHE_N / 8));
        pass.end();
        // Only publish a level after its bake; the tracer reads the table in a later pass.
        enc.copyBufferToBuffer(
          this.staging!,
          0,
          sources.table,
          (TABLE_TERRAIN + TERRAIN_CACHE_HEADER + k * TERRAIN_CACHE_NODE_VEC4S) * 16,
          TERRAIN_CACHE_NODE_VEC4S * 16,
        );
        if (this.ready[k]) this.bakesDirty[k]!++;
        else this.bakesMoved[k]!++;
        this.ready[k] = true;
        this.dirty[k] = false;
        this.hiddenSince[k] = 0;
        this.visibleFirst[k] = 0;
        metadata[8 * k + 6] = 1;
        this.builds++;
      }
    }
    this.device.queue.writeBuffer(sources.table, TABLE_TERRAIN * 16, metadata);
    return bake.length > 0;
  }

  /** Ready in the current submission, including any bake/copy encoded before the pilot's draw. */
  levelWindow(level: number): TerrainWindow | null {
    const window = this.windows[level];
    return this.ready[level] && window ? { ...window } : null;
  }

  stats() {
    return {
      compiled: this.pipeline !== null,
      error: this.error,
      levelsReady: this.ready.filter(Boolean).length,
      builds: this.builds,
      bakesMoved: [...this.bakesMoved],
      changesVisible: this.changesVisible,
      changesHidden: this.changesHidden,
      bakesDirty: [...this.bakesDirty],
      invalidations: this.invalidations,
      stagingBytes: this.staging?.size ?? 0,
      uniformBytes: this.uniforms.length * 32,
    };
  }

  dispose() {
    this.disposed = true;
    this.staging?.destroy();
    for (const u of this.uniforms) u.destroy();
    this.staging = null;
    this.uniforms = [];
    this.input = null;
    this.outputs = [];
  }
}

/**
 * A cache window's reference — its node (0, 0) — on the tiles (trace.wgsl tileCoord: longitude, Mercator's y from the tiles'
 * reference, as the tracer has it: cos, sin of its longitude, sine of its latitude in float32), in float64; w: on (none: the
 * bake reads its nodes as unit-sphere points in float32).
 */
export function terrainCacheTiles(window: TerrainWindow, round: number, ref: readonly [number, number, number] | null) {
  if (!ref) return new Float32Array(4);
  const lon = (window.i / round) * 2 * Math.PI;
  const lat = (window.j / round) * 2 * Math.PI;
  let dl = lon - Math.atan2(ref[1], ref[0]);
  dl -= 2 * Math.PI * Math.round(dl / (2 * Math.PI));
  return new Float32Array([dl, Math.atanh(Math.sin(lat)) - Math.atanh(ref[2]), 0, 1]);
}
