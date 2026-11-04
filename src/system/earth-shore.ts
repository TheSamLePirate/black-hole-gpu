// T7 — the shore's distance (docs/progress/refraction-horizons/T7.md, the wash's sixth lot): on the relief cache's levels 3 and 4
// (6.1 m and 24 m nodes: ±780 m and ±3.1 km round the camera), each sea node's distance to the nearest land node [m] — land: the
// cache's height over SHORE_LAND m above the sea —, searched within SHORE_REACH nodes; baked on the GPU from the cache's own
// heights when a level is baked again (its window moved, newer tiles), a level at a time, whole. Read by the raster's water
// (trace.wgsl seaShoreDist, shadeWater) for the waves' wash at the foot of the coasts: one table read a pixel where the relief's
// own walk round each sea pixel cost 1.7–3.2 ms on kerr-mini.
// No new binding: the distances go in the tracer's table (gpu-tables.ts TABLE_SHORE), after the sea's water.
import { TABLE_SHORE, TABLE_TERRAIN } from "../gpu-tables";
import { WGS84_A } from "./ellipsoid";
import {
  TERRAIN_CACHE_HEADER,
  TERRAIN_CACHE_N,
  TERRAIN_CACHE_NODE_VEC4S,
  TERRAIN_CACHE_ROUNDS,
  type TerrainWindow,
  terrainWindowParams,
} from "./terrain-cache-layout";
import { SHORE_HEADER_VEC4S, SHORE_LEVELS, SHORE_NODE_VEC4S } from "./earth-shore-layout";

export { SHORE_HEADER_VEC4S, SHORE_LEVELS, SHORE_NODE_VEC4S, SHORE_VEC4S } from "./earth-shore-layout";
/** a node's height over the sea [m] from which it is land */
export const SHORE_LAND = 0.6;
/** the nodes searched each way */
export const SHORE_REACH = 4;
/** a sea node with no land within reach: its distance */
export const SHORE_FAR = 1e4;

/** The distance to the nearest land among a node's neighbours within reach, on a grid of spacing [m] (the CPU's — the tests'). */
export function shoreDistance(heights: (i: number, j: number) => number, i: number, j: number, spacing: number): number {
  if (heights(i, j) > SHORE_LAND) return 0;
  let best = SHORE_FAR;
  for (let dj = -SHORE_REACH; dj <= SHORE_REACH; dj++)
    for (let di = -SHORE_REACH; di <= SHORE_REACH; di++)
      if (heights(i + di, j + dj) > SHORE_LAND) best = Math.min(best, Math.hypot(di, dj) * spacing);
  return best;
}

export function earthShoreShader(): string {
  return /* wgsl */ `
struct BakeU { level: vec4f };
@group(0) @binding(0) var<uniform> U: BakeU;
@group(0) @binding(1) var<storage, read> table: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outNodes: array<vec4f>;
const TC_OFF = ${TABLE_TERRAIN}u;
const TC_N = ${TERRAIN_CACHE_N}u;
const TC_NODE_VEC4S = ${TERRAIN_CACHE_NODE_VEC4S}u;
fn node(k: u32, i: vec2i) -> f32 {
  let c = vec2u(clamp(i, vec2i(0), vec2i(i32(TC_N) - 1)));
  let n = c.y * TC_N + c.x;
  return table[TC_OFF + ${TERRAIN_CACHE_HEADER}u + k * TC_NODE_VEC4S + n / 4u][n % 4u];
}
// (four nodes a thread: a vec4 of the output)
@compute @workgroup_size(64)
fn bake(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${SHORE_NODE_VEC4S}u) { return; }
  let k = u32(U.level.x);
  let spacing = U.level.y;
  var o = vec4f(${SHORE_FAR.toFixed(1)});
  for (var c = 0u; c < 4u; c++) {
    let n = gid.x * 4u + c;
    if (n >= TC_N * TC_N) { break; }
    let ij = vec2i(i32(n % TC_N), i32(n / TC_N));
    if (node(k, ij) > ${SHORE_LAND}) { o[c] = 0.0; continue; }
    var best = ${SHORE_FAR.toFixed(1)};
    for (var dj = -${SHORE_REACH}; dj <= ${SHORE_REACH}; dj++) {
      for (var di = -${SHORE_REACH}; di <= ${SHORE_REACH}; di++) {
        if (node(k, ij + vec2i(di, dj)) > ${SHORE_LAND}) { best = min(best, length(vec2f(f32(di), f32(dj))) * spacing); }
      }
    }
    o[c] = best;
  }
  outNodes[gid.x] = o;
}`;
}

// (the tracer's reader: trace.wgsl seaShoreDist — its offsets checked against these by tests/gpu-tables.test.ts)

/**
 * The shore's distances on the GPU: a level at a time, whole (its nodes four a thread, each searching SHORE_REACH nodes round),
 * into its staging buffer, then copied into the table with its header. A level is baked again when the cache baked it again.
 */
export class EarthShore {
  private pipeline: GPUComputePipeline | null = null;
  private error: string | null = null;
  private staging: GPUBuffer | null = null;
  private uniform: GPUBuffer | null = null;
  private group: GPUBindGroup | null = null;
  private table: GPUBuffer | null = null;
  private published: ({ window: TerrainWindow; gen: number } | null)[] = SHORE_LEVELS.map(() => null);
  private header = new Float32Array(SHORE_HEADER_VEC4S * 4);
  private headerWritten = new Float32Array(SHORE_HEADER_VEC4S * 4).fill(Number.NaN);
  bakes: number[] = SHORE_LEVELS.map(() => 0);
  private disposed = false;

  constructor(private device: GPUDevice) {
    void this.compile();
  }

  private async compile() {
    try {
      const module = this.device.createShaderModule({ code: earthShoreShader(), label: "earth shore bake" });
      const p = await this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "bake" } });
      if (!this.disposed) this.pipeline = p;
    } catch (e) {
      this.error = String(e);
      console.warn("The shore's distances unavailable:", e);
    }
  }

  /** A frame: a level whose window or heights changed baked whole (one a frame), the header written. on: wanted at all. */
  encode(
    enc: GPUCommandEncoder,
    table: GPUBuffer,
    on: boolean,
    window: (level: number) => TerrainWindow | null,
    generation: (level: number) => number,
    timestamp?: () => GPUComputePassDescriptor,
  ) {
    if (!on || !this.pipeline) {
      this.published = this.published.map(() => null);
      this.header.fill(0);
      this.writeHeader(table);
      return;
    }
    let pick = -1;
    SHORE_LEVELS.forEach((lv, slot) => {
      const w = window(lv);
      const p = this.published[slot];
      if (!w) {
        this.published[slot] = null;
        this.header[8 * slot + 6] = 0;
      } else if (pick < 0 && (!p || p.window.i !== w.i || p.window.j !== w.j || p.gen !== generation(lv))) pick = slot;
    });
    if (pick >= 0) this.bake(enc, table, pick, window(SHORE_LEVELS[pick]!)!, generation(SHORE_LEVELS[pick]!), timestamp);
    this.writeHeader(table);
  }

  private bake(
    enc: GPUCommandEncoder,
    table: GPUBuffer,
    slot: number,
    win: TerrainWindow,
    gen: number,
    timestamp?: () => GPUComputePassDescriptor,
  ) {
    if (!this.staging) {
      this.staging = this.device.createBuffer({
        label: "earth shore staging",
        size: SHORE_NODE_VEC4S * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      this.uniform = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    if (this.table !== table || !this.group) {
      this.table = table;
      this.group = this.device.createBindGroup({
        layout: this.pipeline!.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniform! } },
          { binding: 1, resource: { buffer: table } },
          { binding: 2, resource: { buffer: this.staging } },
        ],
      });
    }
    const lv = SHORE_LEVELS[slot]!;
    const round = TERRAIN_CACHE_ROUNDS[lv]!;
    const spacing = (2 * Math.PI * WGS84_A) / round;
    this.device.queue.writeBuffer(this.uniform!, 0, new Float32Array([lv, spacing, 0, 0]));
    const pass = enc.beginComputePass(timestamp?.() ?? { label: "earth shore bake" });
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, this.group);
    pass.dispatchWorkgroups(Math.ceil(SHORE_NODE_VEC4S / 64));
    pass.end();
    enc.copyBufferToBuffer(
      this.staging,
      0,
      table,
      (TABLE_SHORE + SHORE_HEADER_VEC4S + slot * SHORE_NODE_VEC4S) * 16,
      SHORE_NODE_VEC4S * 16,
    );
    const params = terrainWindowParams(win, round, true);
    this.header.set(params.subarray(0, 4), 8 * slot);
    this.header.set([params[4]!, spacing, 1, lv], 8 * slot + 4);
    this.published[slot] = { window: win, gen };
    this.bakes[slot]!++;
  }

  private writeHeader(table: GPUBuffer) {
    if (this.header.every((v, i) => v === this.headerWritten[i])) return;
    this.headerWritten.set(this.header);
    this.device.queue.writeBuffer(table, TABLE_SHORE * 16, this.header);
  }

  stats() {
    return {
      compiled: this.pipeline !== null,
      error: this.error,
      levels: SHORE_LEVELS.map((lv, slot) => ({ level: lv, published: !!this.published[slot], bakes: this.bakes[slot]! })),
    };
  }

  dispose() {
    this.disposed = true;
    this.staging?.destroy();
    this.uniform?.destroy();
    this.staging = null;
    this.uniform = null;
    this.group = null;
  }
}
