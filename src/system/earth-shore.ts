// T7 — the shore's distance (docs/progress/refraction-horizons/T7.md, the wash's sixth lot; PLAN-MER-WEBGPU L4): on the relief
// cache's levels 3 to 6 (6.1, 24, 97 and 390 m nodes: ±780 m, ±3.1, ±12.5 and ±50 km round the camera), each sea node's distance
// to the nearest land node [m] — land: the cache's height over SHORE_LAND m above the sea —, over the whole window by jump
// flooding (Rong & Tan 2006: the nearest land seed passed between nodes at steps 128 … 1, then 1 again); baked on the GPU from the
// cache's own heights when a level is baked again (its window moved, newer tiles), a level at a time, whole. Read by the raster's
// water (trace.wgsl seaShoreDist): the waves' wash at the foot of the coasts, and the bed by Dean's profile where the tiles have no
// depth (seaDepthAt) — one table read a pixel where the relief's own walk round each sea pixel cost 1.7–3.2 ms on kerr-mini.
// No new binding: the distances go in the tracer's table (gpu-tables.ts TABLE_SHORE), after the sea's water.
import { TABLE_SHORE, TABLE_SWELL, TABLE_TERRAIN } from "../gpu-tables";
import { WGS84_A } from "./ellipsoid";
import {
  TERRAIN_CACHE_HEADER,
  TERRAIN_CACHE_N,
  TERRAIN_CACHE_NODE_VEC4S,
  TERRAIN_CACHE_ROUNDS,
  type TerrainWindow,
  terrainWindowParams,
} from "./terrain-cache-layout";
import { SHORE_HEADER_VEC4S, SHORE_LEVELS, SHORE_NODE_VEC4S, SWELL_HEADER_VEC4S, SWELL_NODE_VEC4S } from "./earth-shore-layout";
import { earthSwellShader, SWELL_SWEEPS, SWELL_SWEEPS_A_FRAME, SWELL_TILE } from "./earth-swell";

export { SHORE_HEADER_VEC4S, SHORE_LEVELS, SHORE_NODE_VEC4S, SHORE_VEC4S } from "./earth-shore-layout";
/** a node's height over the sea [m] from which it is land */
export const SHORE_LAND = 0.6;
/** a sea node with no land in its window: its distance [m] */
export const SHORE_FAR = 1e5;
/** the waves a group of the coastal swell holds (trace.wgsl seaShade: the groups' clock) */
export const GROUP_WAVES = 7;
/** a level's newer tiles baked again at most this often [ms] (its window moved: at once) */
export const SHORE_REGEN_MS = 2000;
/** the jump flood's steps (nodes): halving from half the window, then 1 again (JFA+1: its few misses mended) */
export const SHORE_STEPS = [128, 64, 32, 16, 8, 4, 2, 1, 1] as const;

/** The distance to the nearest land node of an n × n grid of spacing [m] — exact, by search (the CPU's: the tests' reference).
 *  cx: the east–west spacing's share at the node's row (the cache's grid is equirectangular: cos φ — 0.73 at 43° N). */
export function shoreDistance(
  heights: (i: number, j: number) => number,
  i: number,
  j: number,
  spacing: number,
  n: number,
  cx: (j: number) => number = () => 1,
): number {
  if (heights(i, j) > SHORE_LAND) return 0;
  let best = SHORE_FAR;
  const c = cx(j);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (heights(x, y) > SHORE_LAND) best = Math.min(best, Math.hypot((x - i) * c, y - j) * spacing);
  return best;
}

/** The jump flood on the CPU — the bake's own algorithm, its steps and its seeds — for the tests: the distances of an n × n grid. */
export function shoreDistancesJfa(
  heights: (i: number, j: number) => number,
  n: number,
  spacing: number,
  cx: (j: number) => number = () => 1,
): Float64Array {
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
        const c = cx(y);
        let bx = seed[2 * (y * n + x)]!,
          by = seed[2 * (y * n + x) + 1]!;
        let bd = bx < 0 ? Infinity : ((bx - x) * c) ** 2 + (by - y) ** 2;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx * k,
              ny = y + dy * k;
            if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
            const sx = seed[2 * (ny * n + nx)]!,
              sy = seed[2 * (ny * n + nx) + 1]!;
            if (sx < 0) continue;
            const d = ((sx - x) * c) ** 2 + (sy - y) ** 2;
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
    const y = Math.floor(q / n);
    d[q] = sx < 0 ? SHORE_FAR : Math.hypot((sx - (q % n)) * cx(y), seed[2 * q + 1]! - y) * spacing;
  }
  return d;
}

export function earthShoreShader(): string {
  return /* wgsl */ `
// level, spacing [m], step [nodes]; geo: the window's first node's latitude [rad], its nodes a radian — the grid equirectangular,
// its east–west spacing cos φ of the north–south one (the distances measured so: 27 % too long east–west at 43° N before, L1)
struct BakeU { level: vec4f, geo: vec4f };
@group(0) @binding(0) var<uniform> U: BakeU;
@group(0) @binding(1) var<storage, read> table: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outNodes: array<vec4f>;
@group(0) @binding(3) var<storage, read> seedIn: array<vec2i>;
@group(0) @binding(4) var<storage, read_write> seedOut: array<vec2i>;
const TC_OFF = ${TABLE_TERRAIN}u;
const TC_N = ${TERRAIN_CACHE_N}u;
const TC_NODE_VEC4S = ${TERRAIN_CACHE_NODE_VEC4S}u;
fn cx(j: i32) -> f32 { return cos(U.geo.x + f32(j) / U.geo.y); }
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
  let c = cx(ij.y);
  var best = seedIn[n];
  let d0 = vec2f(best - ij) * vec2f(c, 1.0);
  var bd = select(1e30, dot(d0, d0), best.x >= 0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = ij + vec2i(dx, dy) * k;
      if (q.x < 0 || q.y < 0 || q.x >= i32(TC_N) || q.y >= i32(TC_N)) { continue; }
      let s = seedIn[u32(q.y) * TC_N + u32(q.x)];
      if (s.x < 0) { continue; }
      let dv = vec2f(s - ij) * vec2f(c, 1.0);
      let d = dot(dv, dv);
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
    if (s.x >= 0) { o[c] = length(vec2f(s - ij) * vec2f(cx(ij.y), 1.0)) * U.level.y; }
  }
  outNodes[gid.x] = o;
}`;
}

// (the tracer's reader: trace.wgsl seaShoreDist — its offsets checked against these by tests/gpu-tables.test.ts)

/** the swell the field is baked for: its way [rad, compass — 0 going north], its period [s], its height [m], the sea's clock [s] */
export interface SwellInput {
  to: number;
  tp: number;
  hs: number;
  timeS: number;
  /** an A/B's ablations (trace.wgsl seaShade: 1 no crests on the normal, 2 no groups, 4 not in the open sea's kernel, 8 no surf) */
  ablate?: number;
}

/** the field's key: its way to 5°, its period to half a second, its anchor (a level's phases are only joined to another's of the
 *  same key) */
export function swellKey(to: number, tp: number, anchor: { lon: number; lat: number }): string {
  const deg = ((((to * 180) / Math.PI) % 360) + 360) % 360;
  return `${Math.round(deg / 5) % 72}|${Math.round(tp * 2)}|${anchor.lon.toFixed(5)},${anchor.lat.toFixed(5)}`;
}

const wrapPi = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * The shore's distances on the GPU: a level at a time, whole — its land seeded, the nearest seed flooded across the window
 * (SHORE_STEPS), the distances written four nodes a thread — into its staging buffer, then copied into the table with its header.
 * A level is baked again when the cache baked it again. With a swell (L1), the same level's swell field after its distances —
 * its eikonal over three frames (SWELL_SWEEPS), published whole at the last —; the levels the coarsest first, a finer level's
 * edges taking the coarser's phases. One level's job at a time.
 */
export class EarthShore {
  private pipes: { seeds: GPUComputePipeline; flood: GPUComputePipeline; finish: GPUComputePipeline } | null = null;
  private swellPipes: { init: GPUComputePipeline; sweep: GPUComputePipeline; finish: GPUComputePipeline } | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private swellLayout: GPUBindGroupLayout | null = null;
  private error: string | null = null;
  private staging: GPUBuffer | null = null;
  private seedBufs: [GPUBuffer, GPUBuffer] | null = null;
  /** one a dispatch: the seeds' and the distances' (step 0), then each flood step's */
  private uniforms: GPUBuffer[] = [];
  private groups: { seeds: GPUBindGroup; flood: GPUBindGroup[]; finish: GPUBindGroup } | null = null;
  private swellBufs: { uniform: GPUBuffer; phi: [GPUBuffer, GPUBuffer]; slow: GPUBuffer; out: GPUBuffer } | null = null;
  private swellGroups: { init: GPUBindGroup; ab: GPUBindGroup; ba: GPUBindGroup; finish: GPUBindGroup } | null = null;
  private table: GPUBuffer | null = null;
  private published: ({ window: TerrainWindow; gen: number } | null)[] = SHORE_LEVELS.map(() => null);
  /** each level's published field: the window and key it was baked for, and whether its edges took the coarser level's phases */
  private fieldPub: ({ window: TerrainWindow; key: string; coarse: boolean } | null)[] = SHORE_LEVELS.map(() => null);
  /** the level's job under way: its window, generation, key, the sweeps done */
  private job: { slot: number; window: TerrainWindow; gen: number; key: string; coarse: boolean; sweeps: number } | null = null;
  private anchor: { lon: number; lat: number } | null = null;
  private header = new Float32Array(SHORE_HEADER_VEC4S * 4);
  private headerWritten = new Float32Array(SHORE_HEADER_VEC4S * 4).fill(Number.NaN);
  private swellHeader = new Float32Array(SWELL_HEADER_VEC4S * 4);
  private swellHeaderWritten = new Float32Array(SWELL_HEADER_VEC4S * 4).fill(Number.NaN);
  bakes: number[] = SHORE_LEVELS.map(() => 0);
  /** each level's last bake [ms, the frame's clock] */
  private bakedAt: number[] = SHORE_LEVELS.map(() => -1e9);
  fieldBakes: number[] = SHORE_LEVELS.map(() => 0);
  /** the swell's key now ("" none) */
  key = "";
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
    try {
      const d = this.device;
      const module = d.createShaderModule({
        code: earthSwellShader(TERRAIN_CACHE_N, WGS84_A, SWELL_NODE_VEC4S),
        label: "earth swell bake",
      });
      const S = GPUShaderStage.COMPUTE;
      const st = (type: GPUBufferBindingType, binding: number) => ({ binding, visibility: S, buffer: { type } });
      this.swellLayout = d.createBindGroupLayout({
        entries: [
          st("uniform", 0),
          st("read-only-storage", 1),
          st("read-only-storage", 2),
          st("read-only-storage", 3),
          st("storage", 4),
          st("storage", 5),
          st("storage", 6),
        ],
      });
      const layout = d.createPipelineLayout({ bindGroupLayouts: [this.swellLayout] });
      const mk = (entryPoint: string) => d.createComputePipelineAsync({ layout, compute: { module, entryPoint } });
      const [init, sweep, finish] = await Promise.all([mk("swellInit"), mk("swellSweep"), mk("swellFinish")]);
      if (!this.disposed) this.swellPipes = { init, sweep, finish };
    } catch (e) {
      this.error = `${this.error ?? ""} swell: ${e}`;
      console.warn("The swell field unavailable:", e);
    }
  }

  /**
   * A frame: a level whose window or heights changed — or whose field is of another swell — baked (its distances this frame, its
   * field over three), the headers written. on: wanted at all; swell: the swell to bake the field for (null: none).
   */
  encode(
    enc: GPUCommandEncoder,
    table: GPUBuffer,
    on: boolean,
    window: (level: number) => TerrainWindow | null,
    generation: (level: number) => number,
    timestamp?: () => GPUComputePassDescriptor,
    swell: SwellInput | null = null,
    nowMs = 0,
  ) {
    if (!on || !this.pipes) {
      this.published = this.published.map(() => null);
      this.fieldPub = this.fieldPub.map(() => null);
      this.job = null;
      this.header.fill(0);
      this.swellHeader.fill(0);
      this.writeHeader(table);
      return;
    }
    // (the swell's key: its anchor the coarsest level's window's middle — moved, and every level's field baked again, when the
    // camera is 300 km from it)
    let key = "";
    const coarsest = [...SHORE_LEVELS].reverse().find((lv) => window(lv));
    if (swell && this.swellPipes && swell.hs > 0.05 && swell.tp > 1 && coarsest !== undefined) {
      const w = window(coarsest)!;
      const round = TERRAIN_CACHE_ROUNDS[coarsest]!;
      const mid = { lon: wrapPi(((w.i + 128) / round) * 2 * Math.PI), lat: ((w.j + 128) / round) * 2 * Math.PI };
      const a = this.anchor;
      if (!a || Math.hypot(wrapPi(mid.lon - a.lon) * Math.cos(a.lat), mid.lat - a.lat) * WGS84_A > 3e5) this.anchor = mid;
      key = swellKey(swell.to, swell.tp, this.anchor!);
    }
    this.key = key;
    SHORE_LEVELS.forEach((lv, slot) => {
      if (!window(lv)) {
        this.published[slot] = null;
        this.header[8 * slot + 6] = 0;
        this.fieldPub[slot] = null;
      }
    });
    if (!key) this.fieldPub = this.fieldPub.map(() => null);
    // (the job under way dropped if its level's window moved or the swell changed: started again, with the new)
    if (this.job) {
      const lv = SHORE_LEVELS[this.job.slot]!;
      const w = window(lv);
      if (!w || w.i !== this.job.window.i || w.j !== this.job.window.j || this.job.key !== key) this.job = null;
    }
    let pass: GPUComputePassEncoder | null = null;
    const begin = () => {
      pass ??= enc.beginComputePass(timestamp?.() ?? { label: "earth shore bake" });
      return pass;
    };
    const copies: (() => void)[] = [];
    if (!this.job) {
      const n = SHORE_LEVELS.length;
      let pick = -1;
      for (let slot = n - 1; slot >= 0 && pick < 0; slot--) {
        const lv = SHORE_LEVELS[slot]!;
        const w = window(lv);
        if (!w) continue;
        const p = this.published[slot];
        const f = this.fieldPub[slot];
        const coarseNow = slot + 1 < n && this.fieldPub[slot + 1]?.key === key;
        // (newer tiles alone — the window where it was —: baked again at most every SHORE_REGEN_MS — a coast's line moves by a node
        // at most as its tiles refine, and the tiles land for minutes after a jump: rebaked each frame, the distances and the
        // field kept the bake's pass at ~1 ms on kerr-mini for nothing)
        const moved = !p || p.window.i !== w.i || p.window.j !== w.j;
        const newer = !!p && p.gen !== generation(lv) && nowMs - this.bakedAt[slot]! >= SHORE_REGEN_MS;
        if (moved || newer || (key && (!f || f.key !== key || (!f.coarse && coarseNow)))) pick = slot;
      }
      if (pick >= 0) {
        const lv = SHORE_LEVELS[pick]!;
        const w = window(lv)!;
        const gen = generation(lv);
        this.bake(enc, begin(), table, pick, w, copies);
        this.published[pick] = { window: w, gen };
        this.bakedAt[pick] = nowMs;
        if (key && swell) this.startField(begin(), table, pick, w, gen, key, swell);
      }
    } else {
      this.sweeps(begin());
    }
    // (the job's last sweeps done: its field written, published)
    const job = this.job;
    if (job && job.sweeps >= SWELL_SWEEPS) {
      const p = begin();
      p.setPipeline(this.swellPipes!.finish);
      p.setBindGroup(0, this.swellGroups!.finish);
      p.dispatchWorkgroups(Math.ceil(SWELL_NODE_VEC4S / 64));
      const slot = job.slot;
      copies.push(() =>
        enc.copyBufferToBuffer(
          this.swellBufs!.out,
          0,
          table,
          (TABLE_SWELL + SWELL_HEADER_VEC4S + slot * SWELL_NODE_VEC4S) * 16,
          SWELL_NODE_VEC4S * 16,
        ),
      );
      const lv = SHORE_LEVELS[slot]!;
      const round = TERRAIN_CACHE_ROUNDS[lv]!;
      const params = terrainWindowParams(job.window, round, true);
      this.swellHeader.set(params.subarray(0, 4), 4 * (2 + 2 * slot));
      this.swellHeader.set([params[4]!, (2 * Math.PI * WGS84_A) / round, 1, lv], 4 * (3 + 2 * slot));
      this.fieldPub[slot] = { window: job.window, key: job.key, coarse: job.coarse };
      this.fieldBakes[slot]!++;
      this.job = null;
    }
    if (pass) (pass as GPUComputePassEncoder).end();
    for (const c of copies) c();
    // (the swell's own header: on, its period, height and clock — the crests' phase ωt/2π, fractional, from the clock in float64)
    if (key && swell) {
      const turns = swell.timeS / swell.tp;
      this.swellHeader.set([1 + 2 * (swell.ablate ?? 0), swell.tp, swell.hs, turns - Math.floor(turns)], 0);
      const groups = turns / GROUP_WAVES;
      this.swellHeader[4] = groups - Math.floor(groups);
    } else this.swellHeader[0] = 0;
    SHORE_LEVELS.forEach((_, slot) => {
      if (!this.fieldPub[slot]) this.swellHeader[4 * (3 + 2 * slot) + 2] = 0;
    });
    this.writeHeader(table);
  }

  /** the distances of a level (its JFA in the pass; their copy into the table queued) */
  private bake(
    enc: GPUCommandEncoder,
    pass: GPUComputePassEncoder,
    table: GPUBuffer,
    slot: number,
    win: TerrainWindow,
    copies: (() => void)[],
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
        d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      );
    }
    if (this.table !== table || !this.groups) {
      this.table = table;
      this.swellGroups = null;
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
    const lat0 = (win.j / round) * 2 * Math.PI;
    const per = round / (2 * Math.PI);
    d.queue.writeBuffer(this.uniforms[0]!, 0, new Float32Array([lv, spacing, 0, 0, lat0, per, 0, 0]));
    SHORE_STEPS.forEach((k, i) => d.queue.writeBuffer(this.uniforms[i + 1]!, 0, new Float32Array([lv, spacing, k, 0, lat0, per, 0, 0])));
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
    const staging = this.staging!;
    copies.push(() =>
      enc.copyBufferToBuffer(staging, 0, table, (TABLE_SHORE + SHORE_HEADER_VEC4S + slot * SHORE_NODE_VEC4S) * 16, SHORE_NODE_VEC4S * 16),
    );
    const params = terrainWindowParams(win, round, true);
    this.header.set(params.subarray(0, 4), 8 * slot);
    this.header.set([params[4]!, spacing, 1, lv], 8 * slot + 4);
    this.bakes[slot]!++;
  }

  /** a level's field started: its uniform, its boundary (the coarser level's phases if it has this key's, else the plane wave),
   *  its first sweeps — after the distances, in the same pass */
  private startField(
    pass: GPUComputePassEncoder,
    table: GPUBuffer,
    slot: number,
    win: TerrainWindow,
    gen: number,
    key: string,
    swell: SwellInput,
  ) {
    const d = this.device;
    const nodes = TERRAIN_CACHE_N * TERRAIN_CACHE_N;
    if (!this.swellBufs) {
      const buf = (label: string, size: number, usage: number) => d.createBuffer({ label, size, usage });
      const S = GPUBufferUsage.STORAGE;
      this.swellBufs = {
        uniform: buf("earth swell uniform", 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
        phi: [buf("earth swell phase A", nodes * 4, S), buf("earth swell phase B", nodes * 4, S)],
        slow: buf("earth swell slowness", nodes * 4, S),
        out: buf("earth swell staging", SWELL_NODE_VEC4S * 16, S | GPUBufferUsage.COPY_SRC),
      };
    }
    if (!this.swellGroups) {
      const b = this.swellBufs;
      const group = (from: GPUBuffer, to: GPUBuffer) =>
        d.createBindGroup({
          layout: this.swellLayout!,
          entries: [
            { binding: 0, resource: { buffer: b.uniform } },
            { binding: 1, resource: { buffer: table } },
            { binding: 2, resource: { buffer: this.staging! } },
            { binding: 3, resource: { buffer: from } },
            { binding: 4, resource: { buffer: to } },
            { binding: 5, resource: { buffer: b.slow } },
            { binding: 6, resource: { buffer: b.out } },
          ],
        });
      const [A, B] = b.phi;
      // (init into A; sweeps A → B, B → A; SWELL_SWEEPS even: the last into A, the finish reading A)
      this.swellGroups = { init: group(B, A), ab: group(A, B), ba: group(B, A), finish: group(A, B) };
    }
    const lv = SHORE_LEVELS[slot]!;
    const round = TERRAIN_CACHE_ROUNDS[lv]!;
    const spacing = (2 * Math.PI * WGS84_A) / round;
    const per = round / (2 * Math.PI);
    const lon0 = (win.i / round) * 2 * Math.PI;
    const lat0 = (win.j / round) * 2 * Math.PI;
    const T = swell.tp;
    const k0 = (2 * Math.PI) ** 2 / (9.81 * T * T);
    const a = this.anchor!;
    const c = this.fieldPub[slot + 1];
    const coarse = !!c && c.key === key;
    const u = new Float32Array(16);
    u.set([lv, spacing, lat0, per], 0);
    u.set([Math.sin(swell.to), Math.cos(swell.to), T, k0], 4);
    u.set([wrapPi(lon0 - a.lon), lat0 - a.lat, Math.cos(a.lat), coarse ? 1 : 0], 8);
    if (coarse) {
      const lvc = SHORE_LEVELS[slot + 1]!;
      const rc = TERRAIN_CACHE_ROUNDS[lvc]!;
      const perc = rc / (2 * Math.PI);
      const lonc = (c!.window.i / rc) * 2 * Math.PI;
      const latc = (c!.window.j / rc) * 2 * Math.PI;
      u.set(
        [wrapPi(lon0 - lonc) * perc, (lat0 - latc) * perc, perc / per, TABLE_SWELL + SWELL_HEADER_VEC4S + (slot + 1) * SWELL_NODE_VEC4S],
        12,
      );
    }
    d.queue.writeBuffer(this.swellBufs.uniform, 0, u);
    pass.setPipeline(this.swellPipes!.init);
    pass.setBindGroup(0, this.swellGroups.init);
    pass.dispatchWorkgroups(Math.ceil(nodes / 64));
    this.job = { slot, window: win, gen, key, coarse, sweeps: 0 };
    this.sweeps(pass);
  }

  /** a frame's sweeps of the job's eikonal */
  private sweeps(pass: GPUComputePassEncoder) {
    const job = this.job;
    if (!job || !this.swellGroups) return;
    const tiles = Math.ceil(TERRAIN_CACHE_N / SWELL_TILE);
    pass.setPipeline(this.swellPipes!.sweep);
    for (let i = 0; i < SWELL_SWEEPS_A_FRAME && job.sweeps < SWELL_SWEEPS; i++, job.sweeps++) {
      pass.setBindGroup(0, job.sweeps % 2 === 0 ? this.swellGroups.ab : this.swellGroups.ba);
      pass.dispatchWorkgroups(tiles, tiles);
    }
  }

  private writeHeader(table: GPUBuffer) {
    if (!this.header.every((v, i) => v === this.headerWritten[i])) {
      this.headerWritten.set(this.header);
      this.device.queue.writeBuffer(table, TABLE_SHORE * 16, this.header);
    }
    if (!this.swellHeader.every((v, i) => v === this.swellHeaderWritten[i])) {
      this.swellHeaderWritten.set(this.swellHeader);
      this.device.queue.writeBuffer(table, TABLE_SWELL * 16, this.swellHeader);
    }
  }

  stats() {
    return {
      compiled: this.pipes !== null,
      swellCompiled: this.swellPipes !== null,
      error: this.error,
      key: this.key,
      job: this.job ? { level: SHORE_LEVELS[this.job.slot], sweeps: this.job.sweeps } : null,
      levels: SHORE_LEVELS.map((lv, slot) => ({
        level: lv,
        published: !!this.published[slot],
        bakes: this.bakes[slot]!,
        field: !!this.fieldPub[slot],
        fieldBakes: this.fieldBakes[slot]!,
        fromCoarse: !!this.fieldPub[slot]?.coarse,
      })),
    };
  }

  dispose() {
    this.disposed = true;
    this.staging?.destroy();
    for (const b of this.seedBufs ?? []) b.destroy();
    for (const u of this.uniforms) u.destroy();
    if (this.swellBufs) {
      this.swellBufs.uniform.destroy();
      this.swellBufs.slow.destroy();
      this.swellBufs.out.destroy();
      for (const b of this.swellBufs.phi) b.destroy();
    }
    this.staging = null;
    this.seedBufs = null;
    this.uniforms = [];
    this.groups = null;
    this.swellBufs = null;
    this.swellGroups = null;
  }
}
