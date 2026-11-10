// T7 — the shore's distance (docs/progress/refraction-horizons/T7.md, the wash's sixth lot; PLAN-MER-WEBGPU L4): on the relief
// cache's levels 3 to 6 (6.1, 24, 97 and 390 m nodes: ±780 m, ±3.1, ±12.5 and ±50 km round the camera), each sea node's distance
// to the nearest land node [m] — land: the cache's height over SHORE_LAND m above the sea —, over the whole window by jump
// flooding (Rong & Tan 2006: the nearest land seed passed between nodes at steps 128 … 1, then 1 again); baked on the GPU from the
// cache's own heights when a level is baked again (its window moved, newer tiles), a level at a time, whole. Read by the raster's
// water (trace.wgsl seaShoreDist): the waves' wash at the foot of the coasts, and the bed by Dean's profile where the tiles have no
// depth (seaDepthAt) — one table read a pixel where the relief's own walk round each sea pixel cost 1.7–3.2 ms on kerr-mini.
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
/** a sea node with no land in its window: its distance [m] */
export const SHORE_FAR = 1e5;
/** the jump flood's steps (nodes): halving from half the window, then 1 again (JFA+1: its few misses mended) */
export const SHORE_STEPS = [128, 64, 32, 16, 8, 4, 2, 1, 1] as const;

/** The distance to the nearest land node of an n × n grid of spacing [m] — exact, by search (the CPU's: the tests' reference). */
export function shoreDistance(heights: (i: number, j: number) => number, i: number, j: number, spacing: number, n: number): number {
  if (heights(i, j) > SHORE_LAND) return 0;
  let best = SHORE_FAR;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (heights(x, y) > SHORE_LAND) best = Math.min(best, Math.hypot(x - i, y - j) * spacing);
  return best;
}

/** The jump flood on the CPU — the bake's own algorithm, its steps and its seeds — for the tests: the distances of an n × n grid. */
export function shoreDistancesJfa(heights: (i: number, j: number) => number, n: number, spacing: number): Float64Array {
  let seed = new Int32Array(n * n * 2).fill(-1);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (heights(x, y) > SHORE_LAND) {
        seed[2 * (y * n + x)] = x;
        seed[2 * (y * n + x) + 1] = y;
      }
  for (const k of SHORE_STEPS) {
    const out = new Int32Array(seed);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let bx = seed[2 * (y * n + x)]!,
          by = seed[2 * (y * n + x) + 1]!;
        let bd = bx < 0 ? Infinity : (bx - x) ** 2 + (by - y) ** 2;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx * k,
              ny = y + dy * k;
            if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
            const sx = seed[2 * (ny * n + nx)]!,
              sy = seed[2 * (ny * n + nx) + 1]!;
            if (sx < 0) continue;
            const d = (sx - x) ** 2 + (sy - y) ** 2;
            if (d < bd) [bd, bx, by] = [d, sx, sy];
          }
        out[2 * (y * n + x)] = bx;
        out[2 * (y * n + x) + 1] = by;
      }
    seed = out;
  }
  const d = new Float64Array(n * n);
  for (let q = 0; q < n * n; q++) {
    const sx = seed[2 * q]!;
    d[q] = sx < 0 ? SHORE_FAR : Math.hypot(sx - (q % n), seed[2 * q + 1]! - Math.floor(q / n)) * spacing;
  }
  return d;
}

export function earthShoreShader(): string {
  return /* wgsl */ `
// level, spacing [m], step [nodes]
struct BakeU { level: vec4f };
@group(0) @binding(0) var<uniform> U: BakeU;
@group(0) @binding(1) var<storage, read> table: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outNodes: array<vec4f>;
@group(0) @binding(3) var<storage, read> seedIn: array<vec2i>;
@group(0) @binding(4) var<storage, read_write> seedOut: array<vec2i>;
const TC_OFF = ${TABLE_TERRAIN}u;
const TC_N = ${TERRAIN_CACHE_N}u;
const TC_NODE_VEC4S = ${TERRAIN_CACHE_NODE_VEC4S}u;
fn node(k: u32, i: vec2i) -> f32 {
  let c = vec2u(clamp(i, vec2i(0), vec2i(i32(TC_N) - 1)));
  let n = c.y * TC_N + c.x;
  return table[TC_OFF + ${TERRAIN_CACHE_HEADER}u + k * TC_NODE_VEC4S + n / 4u][n % 4u];
}
// (the land nodes their own seeds; the sea's none — −1)
@compute @workgroup_size(64)
fn seeds(@builtin(global_invocation_id) gid: vec3u) {
  let n = gid.x;
  if (n >= TC_N * TC_N) { return; }
  let ij = vec2i(i32(n % TC_N), i32(n / TC_N));
  seedOut[n] = select(vec2i(-1), ij, node(u32(U.level.x), ij) > ${SHORE_LAND});
}
// (a step: the nearest of the seeds the node and its eight neighbours a step away hold)
@compute @workgroup_size(64)
fn flood(@builtin(global_invocation_id) gid: vec3u) {
  let n = gid.x;
  if (n >= TC_N * TC_N) { return; }
  let ij = vec2i(i32(n % TC_N), i32(n / TC_N));
  let k = i32(U.level.z);
  var best = seedIn[n];
  var bd = select(1e30, f32(dot(best - ij, best - ij)), best.x >= 0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = ij + vec2i(dx, dy) * k;
      if (q.x < 0 || q.y < 0 || q.x >= i32(TC_N) || q.y >= i32(TC_N)) { continue; }
      let s = seedIn[u32(q.y) * TC_N + u32(q.x)];
      if (s.x < 0) { continue; }
      let d = f32(dot(s - ij, s - ij));
      if (d < bd) { bd = d; best = s; }
    }
  }
  seedOut[n] = best;
}
// (the distances, four nodes a thread: a vec4 of the output)
@compute @workgroup_size(64)
fn finish(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${SHORE_NODE_VEC4S}u) { return; }
  var o = vec4f(${SHORE_FAR.toFixed(1)});
  for (var c = 0u; c < 4u; c++) {
    let n = gid.x * 4u + c;
    if (n >= TC_N * TC_N) { break; }
    let ij = vec2i(i32(n % TC_N), i32(n / TC_N));
    let s = seedIn[n];
    if (s.x >= 0) { o[c] = length(vec2f(s - ij)) * U.level.y; }
  }
  outNodes[gid.x] = o;
}`;
}

// (the tracer's reader: trace.wgsl seaShoreDist — its offsets checked against these by tests/gpu-tables.test.ts)

/**
 * The shore's distances on the GPU: a level at a time, whole — its land seeded, the nearest seed flooded across the window
 * (SHORE_STEPS), the distances written four nodes a thread — into its staging buffer, then copied into the table with its header.
 * A level is baked again when the cache baked it again.
 */
export class EarthShore {
  private pipes: { seeds: GPUComputePipeline; flood: GPUComputePipeline; finish: GPUComputePipeline } | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private error: string | null = null;
  private staging: GPUBuffer | null = null;
  private seedBufs: [GPUBuffer, GPUBuffer] | null = null;
  /** one a dispatch: the seeds' and the distances' (step 0), then each flood step's */
  private uniforms: GPUBuffer[] = [];
  private groups: { seeds: GPUBindGroup; flood: GPUBindGroup[]; finish: GPUBindGroup } | null = null;
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
      const d = this.device;
      const module = d.createShaderModule({ code: earthShoreShader(), label: "earth shore bake" });
      const S = GPUShaderStage.COMPUTE;
      this.layout = d.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: S, buffer: { type: "uniform" } },
          { binding: 1, visibility: S, buffer: { type: "read-only-storage" } },
          { binding: 2, visibility: S, buffer: { type: "storage" } },
          { binding: 3, visibility: S, buffer: { type: "read-only-storage" } },
          { binding: 4, visibility: S, buffer: { type: "storage" } },
        ],
      });
      const layout = d.createPipelineLayout({ bindGroupLayouts: [this.layout] });
      const mk = (entryPoint: string) => d.createComputePipelineAsync({ layout, compute: { module, entryPoint } });
      const [seeds, flood, finish] = await Promise.all([mk("seeds"), mk("flood"), mk("finish")]);
      if (!this.disposed) this.pipes = { seeds, flood, finish };
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
    if (!on || !this.pipes) {
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
    const d = this.device;
    const nodes = TERRAIN_CACHE_N * TERRAIN_CACHE_N;
    if (!this.staging) {
      this.staging = d.createBuffer({
        label: "earth shore staging",
        size: SHORE_NODE_VEC4S * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const seed = () => d.createBuffer({ label: "earth shore seeds", size: nodes * 8, usage: GPUBufferUsage.STORAGE });
      this.seedBufs = [seed(), seed()];
      this.uniforms = Array.from({ length: SHORE_STEPS.length + 1 }, () =>
        d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      );
    }
    if (this.table !== table || !this.groups) {
      this.table = table;
      const [A, B] = this.seedBufs!;
      const group = (u: GPUBuffer, from: GPUBuffer, to: GPUBuffer) =>
        d.createBindGroup({
          layout: this.layout!,
          entries: [
            { binding: 0, resource: { buffer: u } },
            { binding: 1, resource: { buffer: table } },
            { binding: 2, resource: { buffer: this.staging! } },
            { binding: 3, resource: { buffer: from } },
            { binding: 4, resource: { buffer: to } },
          ],
        });
      // (seeds into A; the steps from A to B, B to A …; the distances from the last step's)
      const flood = SHORE_STEPS.map((_, i) => (i % 2 === 0 ? group(this.uniforms[i + 1]!, A, B) : group(this.uniforms[i + 1]!, B, A)));
      const last = SHORE_STEPS.length % 2 === 1 ? B : A;
      this.groups = { seeds: group(this.uniforms[0]!, B, A), flood, finish: group(this.uniforms[0]!, last, last === A ? B : A) };
    }
    const lv = SHORE_LEVELS[slot]!;
    const round = TERRAIN_CACHE_ROUNDS[lv]!;
    const spacing = (2 * Math.PI * WGS84_A) / round;
    d.queue.writeBuffer(this.uniforms[0]!, 0, new Float32Array([lv, spacing, 0, 0]));
    SHORE_STEPS.forEach((k, i) => d.queue.writeBuffer(this.uniforms[i + 1]!, 0, new Float32Array([lv, spacing, k, 0])));
    const pass = enc.beginComputePass(timestamp?.() ?? { label: "earth shore bake" });
    const groups = Math.ceil(nodes / 64);
    pass.setPipeline(this.pipes!.seeds);
    pass.setBindGroup(0, this.groups.seeds);
    pass.dispatchWorkgroups(groups);
    pass.setPipeline(this.pipes!.flood);
    for (const g of this.groups.flood) {
      pass.setBindGroup(0, g);
      pass.dispatchWorkgroups(groups);
    }
    pass.setPipeline(this.pipes!.finish);
    pass.setBindGroup(0, this.groups.finish);
    pass.dispatchWorkgroups(Math.ceil(SHORE_NODE_VEC4S / 64));
    pass.end();
    enc.copyBufferToBuffer(
      this.staging!,
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
      compiled: this.pipes !== null,
      error: this.error,
      levels: SHORE_LEVELS.map((lv, slot) => ({ level: lv, published: !!this.published[slot], bakes: this.bakes[slot]! })),
    };
  }

  dispose() {
    this.disposed = true;
    this.staging?.destroy();
    for (const b of this.seedBufs ?? []) b.destroy();
    for (const u of this.uniforms) u.destroy();
    this.staging = null;
    this.seedBufs = null;
    this.uniforms = [];
    this.groups = null;
  }
}
