import { TABLE_TERRAIN } from "../gpu-tables";
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
 * Runway grading is excluded here: every graded query stays on the reference function in the tracer.
 */
export function terrainCacheShader(trace: string): string {
  const functions = new Map<string, string>();
  for (const [, name] of trace.matchAll(/^fn (\w+)\(/gm)) functions.set(name!, wgslFunction(trace, name!));
  functions.set("earthWarp", "fn earthWarp(q: vec3f) -> vec3f { return earthWarpExact(q); }");
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
  for (const [line, name] of trace.matchAll(/^(?:const|override)\s+(\w+)\b[^;]*;/gm)) declarations.set(name!, line!);
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
  constants.set("HAS_RWY", "override HAS_RWY: bool = false;");
  return `${params}
${[...constants.values()].join("\n")}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(4) var bgSamp: sampler;
@group(0) @binding(21) var earthElev: texture_2d<f32>;
@group(0) @binding(28) var earthTiles: texture_2d_array<u32>;
struct CacheU { reference: vec4f, scale: vec4f };
@group(1) @binding(0) var<uniform> U: CacheU;
@group(1) @binding(1) var<storage, read_write> outHeights: array<f32>;
fn cost(k: u32) {}
${[...selected.values()].join("\n")}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid.xy >= vec2u(${TERRAIN_CACHE_N}u))) { return; }
  let d = vec2f(gid.xy) / U.scale.x;
  let cl = U.reference.x * cos(d.x) - U.reference.y * sin(d.x);
  let sl = U.reference.y * cos(d.x) + U.reference.x * sin(d.x);
  let sa = U.reference.z * cos(d.y) + U.reference.w * sin(d.y);
  let ca = U.reference.w * cos(d.y) - U.reference.z * sin(d.y);
  outHeights[gid.y * ${TERRAIN_CACHE_N}u + gid.x] = earthHeightExactG(vec3f(ca * cl, ca * sl, sa), U.scale.y);
}`;
}

export interface TerrainCacheSources {
  params: GPUBuffer;
  table: GPUBuffer;
  elevation: GPUTexture;
  tiles: GPUTexture;
  sampler: GPUSampler;
}

/** One level baked per realtime frame; exact fallback until ready. No CPU terrain sampling or readback. */
export class TerrainCache {
  private pipeline: GPUComputePipeline | null = null;
  private error: string | null = null;
  private disposed = false;
  private sources: TerrainCacheSources | null = null;
  private input: GPUBindGroup | null = null;
  private output: GPUBindGroup | null = null;
  private staging: GPUBuffer | null = null;
  private uniform: GPUBuffer | null = null;
  private windows: (TerrainWindow | null)[] = Array(TERRAIN_CACHE_LEVELS).fill(null);
  private ready = Array<boolean>(TERRAIN_CACHE_LEVELS).fill(false);
  private revision = "";
  private builds = 0;
  private invalidations = 0;
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
  }

  encode(
    enc: GPUCommandEncoder,
    at: { lon: number; lat: number } | null,
    revision: string,
    timestamp?: () => GPUComputePassDescriptor,
    preferredLevel = -1,
  ): boolean {
    const { pipeline, sources } = this;
    if (this.disposed || !pipeline || !sources) return false;
    const metadata = new Float32Array(TERRAIN_CACHE_HEADER * 4);
    if (revision !== this.revision) {
      this.ready.fill(false);
      this.revision = revision;
      this.invalidations++;
    }
    for (let k = 0; k < TERRAIN_CACHE_LEVELS; k++) {
      const previous = this.windows[k]!;
      const w = at ? terrainWindow(previous, at.lon, at.lat, TERRAIN_CACHE_ROUNDS[k]!) : null;
      if (w !== previous) this.ready[k] = false;
      this.windows[k] = w;
      if (w) metadata.set(terrainWindowParams(w, TERRAIN_CACHE_ROUNDS[k]!, this.ready[k]!), 8 * k);
    }
    const k =
      this.windows[preferredLevel] && !this.ready[preferredLevel]
        ? preferredLevel
        : this.windows.findIndex((w, i) => w !== null && !this.ready[i]);
    if (k >= 0) {
      if (!this.staging) {
        this.staging = this.device.createBuffer({
          size: TERRAIN_CACHE_NODE_VEC4S * 16,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        this.uniform = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.output = this.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: { buffer: this.uniform } },
            { binding: 1, resource: { buffer: this.staging } },
          ],
        });
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
      this.device.queue.writeBuffer(this.uniform!, 0, metadata.subarray(8 * k, 8 * k + 8));
      const pass = enc.beginComputePass(timestamp?.());
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.input);
      pass.setBindGroup(1, this.output!);
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
      this.ready[k] = true;
      metadata[8 * k + 6] = 1;
      this.builds++;
    }
    this.device.queue.writeBuffer(sources.table, TABLE_TERRAIN * 16, metadata);
    return k >= 0;
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
      invalidations: this.invalidations,
      stagingBytes: this.staging?.size ?? 0,
      uniformBytes: this.uniform?.size ?? 0,
    };
  }

  dispose() {
    this.disposed = true;
    this.staging?.destroy();
    this.uniform?.destroy();
    this.staging = null;
    this.uniform = null;
    this.input = null;
    this.output = null;
  }
}
