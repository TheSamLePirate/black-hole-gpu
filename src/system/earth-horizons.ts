// H5 — the Earth's horizons in 8 directions (docs/PLAN-REFRACTION-HORIZONS.md H5, decision 17): on the relief cache's levels
// 4 to 6 (153 m, 611 m, 2.4 km nodes: ±20, ±78, ±313 km round the camera), each node's horizon in 8 sectors — the highest
// elevation of the ground from 2 nodes out to 150 km, three rays a sector —, baked on the GPU from the cache's own heights
// when a level is baked again (its window moved, newer tiles) — never when the Sun turns. Read by the raster's ground
// (trace.wgsl liteSun) and the tracer's (earthTerrainShadow) past the relief's shadow cascades (T6, ±10 km), in min with
// them: the Alps' shadows at sunset, 50–150 km long, for any azimuth.
// No new binding: the horizons go in the tracer's table (gpu-tables.ts TABLE_EARTH_HORIZON) beside the cache's heights.
// Level 3 (38 m, ±4.9 km) is left out: its whole window is inside the cascades' reach, and the 153 m nodes' horizon, seen
// again from the point's own height (option (d)), resolves the far ridges' shadows there.
import { TABLE_EARTH_HORIZON, TABLE_TERRAIN } from "../gpu-tables";
import { WGS84_A, WGS84_F } from "./ellipsoid";
import {
  EARTH_HORIZON_LEVELS,
  EH_HEADER_VEC4S,
  EH_NODE_VEC4S,
  EH_REACH,
  EH_SIN_MAX,
  EH_STEP,
  EARTH_HORIZON_VEC4S,
  TERRAIN_CACHE_HEADER,
  TERRAIN_CACHE_LEVELS,
  TERRAIN_CACHE_N,
  TERRAIN_CACHE_NODE_VEC4S,
  TERRAIN_CACHE_ROUNDS,
  type TerrainWindow,
  terrainWindowParams,
} from "./terrain-cache-layout";

export { EARTH_HORIZON_LEVELS, EH_SECTORS } from "./terrain-cache-layout";

const E2 = WGS84_F * (2 - WGS84_F);

/** encoded sine → byte (H1's signed root) and back */
export function ehEncode(s: number): number {
  const x = Math.max(-1, Math.min(1, s / EH_SIN_MAX));
  return Math.round(255 * (0.5 + 0.5 * Math.sign(x) * Math.sqrt(Math.abs(x))));
}
export function ehDecode(b: number): number {
  const u = (2 * b) / 255 - 1;
  return Math.sign(u) * u * u * EH_SIN_MAX;
}

/**
 * The elevation's sine of a blocker at height h [m] an arc th [rad] away along a unit tangent t, seen from a receiver of
 * geodetic normal g at h0 — the local sphere of the prime vertical's radius N, the vertical the geodetic one (as the bake).
 */
export function ehElevationSin(lat: number, h0: number, h: number, th: number): number {
  const N = WGS84_A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  // ΔX = N (g' − g) + h g' − h0 g, with g' = g cos th + t sin th: its vertical and horizontal parts
  const s2 = 2 * Math.sin(0.5 * th) ** 2;
  const vert = -N * s2 + h * (1 - s2) - h0;
  const horiz = (N + h) * Math.sin(th);
  return vert / Math.hypot(vert, horiz);
}

/** The bake: a band of rows of one level's nodes, each its 8 sectors' horizon from the cache's heights (the whole table). */
export function earthHorizonShader(): string {
  const L = TERRAIN_CACHE_LEVELS;
  return /* wgsl */ `
struct BakeU {
  // the receivers' window: its reference (cos, sin lon0, sin, cos lat0)
  reference: vec4f,
  // its nodes a radian, D_bake [m], the band's first row, its rows
  scale: vec4f,
};
@group(0) @binding(0) var<uniform> U: BakeU;
@group(0) @binding(1) var<storage, read> table: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outNodes: array<vec4f>;
const TC_OFF = ${TABLE_TERRAIN}u;
const TC_N = ${TERRAIN_CACHE_N}u;
const TC_NODE_VEC4S = ${TERRAIN_CACHE_NODE_VEC4S}u;
const A = ${WGS84_A.toFixed(1)};
const E2 = ${E2};
const TAU = 6.28318530717959;
const STEP = ${EH_STEP};
const REACH = ${EH_REACH.toFixed(1)};
const SIN_MAX = ${EH_SIN_MAX};
fn node(k: u32, i: vec2u) -> f32 {
  let n = i.y * TC_N + i.x;
  return table[TC_OFF + ${TERRAIN_CACHE_HEADER}u + k * TC_NODE_VEC4S + n / 4u][n % 4u];
}
// The cache's height at a geodetic normal g [m above the sea] (trace.wgsl terrainCachedHeight's lattice): the finest level from
// 4 whose nodes are no finer than \`spacing\` [m] and whose window holds g, bilinear; −1e9 where none does
fn cacheHeight(g: vec3f, spacing: f32) -> f32 {
  for (var k = 4u; k < ${L}u; k++) {
    let r = table[TC_OFF + 2u * k];
    let s = table[TC_OFF + 2u * k + 1u];
    if (s.z < 0.5 || 2.0 * s.y < spacing) { continue; }
    let dl = atan2(-g.x * r.y + g.y * r.x, g.x * r.x + g.y * r.y);
    let sz = clamp(g.z, -1.0, 1.0);
    let da = asin(clamp(sz * r.w - sqrt(max(1.0 - sz * sz, 0.0)) * r.z, -1.0, 1.0));
    let uv = vec2f(dl, da) * s.x;
    if (min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) >= f32(TC_N - 1u)) { continue; }
    let i = vec2u(floor(uv));
    let f = fract(uv);
    let a = mix(node(k, i), node(k, i + vec2u(1u, 0u)), f.x);
    let b = mix(node(k, i + vec2u(0u, 1u)), node(k, i + vec2u(1u, 1u)), f.x);
    return mix(a, b, f.y);
  }
  return -1e9;
}
fn encodeSin(v: f32) -> f32 {
  let x = clamp(v / SIN_MAX, -1.0, 1.0);
  return round(255.0 * (0.5 + 0.5 * sign(x) * sqrt(abs(x))));
}
@compute @workgroup_size(8, 8)
fn bake(@builtin(global_invocation_id) gid: vec3u) {
  let ij = vec2u(gid.x, gid.y + u32(U.scale.z));
  if (ij.x >= TC_N || ij.y >= TC_N || gid.y >= u32(U.scale.w)) { return; }
  // (the node's geodetic normal: the window's reference turned by its longitude and latitude steps — terrain-cache.ts)
  let d = vec2f(ij) / U.scale.x;
  let cl = U.reference.x * cos(d.x) - U.reference.y * sin(d.x);
  let sl = U.reference.y * cos(d.x) + U.reference.x * sin(d.x);
  let sa = U.reference.z * cos(d.y) + U.reference.w * sin(d.y);
  let ca = U.reference.w * cos(d.y) - U.reference.z * sin(d.y);
  let g = vec3f(ca * cl, ca * sl, sa);
  let east = vec3f(-sl, cl, 0.0);
  let north = vec3f(-sa * cl, -sa * sl, ca);
  let N = A / sqrt(1.0 - E2 * sa * sa);
  let n = TC_N * ij.y + ij.x;
  // (the receiver: its node's own height; no data — the window past 70° — none)
  let h0 = cacheHeight(g, 0.0);
  var sines = array<f32, 8>();
  var steps = array<f32, 8>();
  let D0 = U.scale.y;
  for (var k = 0u; k < 8u; k++) {
    var best = -1.0;
    var bestStep = 0u;
    for (var r = 0; r < 3; r++) {
      let ang = (f32(k) + f32(r - 1) / 3.0) * TAU / 8.0;
      let t = cos(ang) * north + sin(ang) * east;
      var dist = D0;
      for (var m = 0u; m < 40u && dist <= REACH; m++) {
        let th = dist / N;
        let s2 = 2.0 * sin(0.5 * th) * sin(0.5 * th);
        let q = g * (1.0 - s2) + t * sin(th);
        // (the level read: its nodes no coarser than a fiftieth of the distance — a step's fifth)
        let h = cacheHeight(q, 0.02 * dist);
        if (h > -1e8) {
          let vert = -N * s2 + h * (1.0 - s2) - h0;
          let horiz = (N + h) * sin(th);
          let e = vert / sqrt(vert * vert + horiz * horiz);
          if (e > best) {
            best = e;
            bestStep = m;
          }
        }
        dist *= STEP;
      }
    }
    sines[k] = encodeSin(best);
    steps[k] = f32(bestStep);
  }
  outNodes[2u * n] = vec4f(sines[0] * 256.0 + sines[1], sines[2] * 256.0 + sines[3], sines[4] * 256.0 + sines[5],
    sines[6] * 256.0 + sines[7]);
  outNodes[2u * n + 1u] = vec4f(steps[0] * 4096.0 + steps[1] * 64.0 + steps[2], steps[3] * 4096.0 + steps[4] * 64.0 + steps[5],
    steps[6] * 64.0 + steps[7], select(-1e9, h0, h0 > -1e8));
}`;
}

/** Q4 L2b — the valleys' sky (earthSkyOpen): compiled out by default — its ~90 inlined lines put shadeLite over the kernels'
 *  budgets (tests/kernel-budget.test.ts) for an effect measured in the noise (docs/progress/refraction-horizons/Q4.md); true: the
 *  reader below, read where renderer.skyOpen */
export const EARTH_SKY_OPEN = false;
const SKY_OPEN_STUB = "fn earthSkyOpen(gq: vec3f, h: f32, n: vec3f) -> f32 { return 1.0; }";
function earthSkyOpenSource(): string {
  const levels = EARTH_HORIZON_LEVELS.length;
  return /* wgsl */ `
// Q4 L2b — the share of the sky's light a ground point (gq, h) still receives over the relief round it: in each of the 8 sectors
// the light under its horizon lost — on a flat ground, from the elevations 0…e of a sector of π/4, a share sin² e of its light —,
// each sector weighed by the clear sky's radiance low in its direction (skyMirror: the bright side towards the Sun, the horizon's
// band) over their mean; only what rises above the face's own plane (n its normal) — its tilt is skyOnFace's. The same horizons as
// the Sun's (H5), the 4 nodes blended in tan e, 1/d, h0/d, then seen from h. 1 where no level holds the point.
struct EhNode8 { t: array<f32, 8>, inv: array<f32, 8>, h0: f32, ok: f32 };
fn earthHorizonNode8(l: u32, i: vec2u, D0: f32) -> EhNode8 {
  let n = i.y * ${TERRAIN_CACHE_N}u + i.x;
  let base = EH_OFF + ${EH_HEADER_VEC4S}u + l * EH_NODES + 2u * n;
  let S = bodies[base];
  let T = bodies[base + 1u];
  var o: EhNode8;
  if (T.w < -1e8) { return o; }
  for (var k = 0u; k < 8u; k++) {
    let pair = S[k / 2u];
    let hi = floor(pair / 256.0);
    let b = select(hi, pair - 256.0 * hi, (k & 1u) == 1u);
    let u = 2.0 * b / 255.0 - 1.0;
    let sn = sign(u) * u * u * ${EH_SIN_MAX};
    let w = T[min(k / 3u, 2u)];
    let p = select(k % 3u, k - 5u, k >= 6u);
    let d64 = floor(w / 64.0);
    let st = select(select(w - 64.0 * d64, d64 - 64.0 * floor(w / 4096.0), p == 1u), floor(w / 4096.0), p == 0u);
    o.t[k] = sn * inverseSqrt(max(1.0 - sn * sn, 1e-6));
    o.inv[k] = exp2(-st * ${Math.log2(1.25).toFixed(9)}) / D0;
  }
  o.h0 = T.w;
  o.ok = 1.0;
  return o;
}
fn earthSkyOpen(gq: vec3f, h: f32, n: vec3f) -> f32 {
  var east = vec3f(-gq.y, gq.x, 0.0);
  east = select(normalize(east), vec3f(0.0, 1.0, 0.0), dot(east, east) < 1e-12);
  let north = cross(gq, east);
  var s2 = array<f32, 8>();
  var rem = 1.0;
  for (var l = 0u; l < ${levels}u; l++) {
    let r = bodies[EH_OFF + 2u * l];
    let s = bodies[EH_OFF + 2u * l + 1u];
    if (s.z <= 0.0) { continue; }
    let dl = atan2(-gq.x * r.y + gq.y * r.x, gq.x * r.x + gq.y * r.y);
    let sz = clamp(gq.z, -1.0, 1.0);
    let da = asin(clamp(sz * r.w - sqrt(max(1.0 - sz * sz, 0.0)) * r.z, -1.0, 1.0));
    let uv = vec2f(dl, da) * s.x;
    let edge = min(min(uv.x, uv.y), min(${TERRAIN_CACHE_N - 1}.0 - uv.x, ${TERRAIN_CACHE_N - 1}.0 - uv.y));
    if (edge <= 1.0) { continue; }
    let w = smoothstep(1.0, 12.0, edge) * s.z;
    let i = vec2u(floor(uv));
    let f = fract(uv);
    var t = array<f32, 8>();
    var inv = array<f32, 8>();
    var hd = array<f32, 8>();
    var known = true;
    for (var c = 0u; c < 4u; c++) {
      let o = vec2u(c & 1u, c >> 1u);
      let nd = earthHorizonNode8(l, i + o, s.y);
      known = known && nd.ok > 0.0;
      let bw = select(1.0 - f.x, f.x, o.x == 1u) * select(1.0 - f.y, f.y, o.y == 1u);
      for (var k = 0u; k < 8u; k++) {
        t[k] += bw * nd.t[k];
        inv[k] += bw * nd.inv[k];
        hd[k] += bw * nd.h0 * nd.inv[k];
      }
    }
    if (!known) { continue; }
    for (var k = 0u; k < 8u; k++) {
      let tn = max(t[k] + hd[k] - h * inv[k], 0.0);
      s2[k] += rem * w * (tn * tn / (1.0 + tn * tn));
    }
    rem *= 1.0 - w;
    if (rem < 1e-3) { break; }
  }
  if (rem >= 1.0) { return 1.0; }
  // (each sector's weight: the clear sky low in its direction — 10° up —, over the mean; even when the sky's table is off)
  var lk = array<f32, 8>();
  var mean = 0.0;
  for (var k = 0u; k < 8u; k++) {
    let a = f32(k) * 0.785398163;
    let d = normalize(0.98481 * (sin(a) * east + cos(a) * north) + 0.17365 * gq);
    let m = skyMirror(d);
    lk[k] = select(1.0, dot(m, vec3f(0.2126, 0.7152, 0.0722)), m.x >= 0.0);
    mean += lk[k];
  }
  mean = max(mean / 8.0, 1e-30);
  // (only the relief above the face's own plane: a slope's own rise is its tilt — the sky's light on a tilted face, skyOnFace —,
  // not a horizon; counted twice, every slope lost a fifth of its sky)
  var lost = 0.0;
  let nz = max(dot(n, gq), 0.05);
  for (var k = 0u; k < 8u; k++) {
    let a = f32(k) * 0.785398163;
    let u = sin(a) * east + cos(a) * north;
    let tp = max(-dot(n, u) / nz, 0.0);
    let sp = tp * tp / (1.0 + tp * tp);
    lost += lk[k] / mean * max(s2[k] / (1.0 - rem) - sp, 0.0);
  }
  return clamp(1.0 - lost / 8.0, 0.0, 1.0);
}
`;
}

/**
 * The tracer's reader (injected in place of trace.wgsl's stub — withTerrainCache): earthHorizonSin(gq, h, L, foot) — the
 * horizon's sine towards L (physical, unit) at a ground point of geodetic normal gq and height h [m above the sea], seen
 * from that height (tan e' = tan e + (h0 − h)/d, option (d)), and the blockers' distance [m]; x −2 where no level holds it.
 */
export function earthHorizonReader(): string {
  const levels = EARTH_HORIZON_LEVELS.length;
  return /* wgsl */ `
const EH_OFF = ${TABLE_EARTH_HORIZON}u;
const EH_NODES = ${EH_NODE_VEC4S}u;
// one node's two sectors round the sector position a (0…8), as the linear quantities the bilinear blend may mix: their baked
// tangents, the inverses of their blockers' distances [1/m], the node's height over them (h0/d); w 0: no data
struct EhNode { t: vec2f, inv: vec2f, hd: vec2f, ok: f32 };
fn earthHorizonNode(l: u32, i: vec2u, a: f32, D0: f32) -> EhNode {
  let n = i.y * ${TERRAIN_CACHE_N}u + i.x;
  let base = EH_OFF + ${EH_HEADER_VEC4S}u + l * EH_NODES + 2u * n;
  let S = bodies[base];
  let T = bodies[base + 1u];
  var o: EhNode;
  if (T.w < -1e8) { return o; }
  let k0 = u32(floor(a)) % 8u;
  for (var j = 0u; j < 2u; j++) {
    let k = (k0 + j) % 8u;
    // (the sine's byte: two in a float — 256, 1)
    let pair = S[k / 2u];
    let hi = floor(pair / 256.0);
    let b = select(hi, pair - 256.0 * hi, (k & 1u) == 1u);
    let u = 2.0 * b / 255.0 - 1.0;
    let sn = sign(u) * u * u * ${EH_SIN_MAX};
    // (the blocker's step: three in a float — 4096, 64, 1 —, the last pair two — 64, 1)
    let w = T[min(k / 3u, 2u)];
    let p = select(k % 3u, k - 5u, k >= 6u);
    let d64 = floor(w / 64.0);
    let st = select(select(w - 64.0 * d64, d64 - 64.0 * floor(w / 4096.0), p == 1u), floor(w / 4096.0), p == 0u);
    o.t[j] = sn * inverseSqrt(max(1.0 - sn * sn, 1e-6));
    o.inv[j] = exp2(-st * ${Math.log2(1.25).toFixed(9)}) / D0;
    o.hd[j] = T.w * o.inv[j];
  }
  o.ok = 1.0;
  return o;
}
// The horizon towards the Sun at a ground point (gq its geodetic normal, h its height above the sea [m], L towards the Sun):
// x its sine, y its blockers' distance [m] (x −2: none known). The four nodes round the point blended in what is linear —
// tan e, 1/d, h0/d —, then seen again from h once a sector (option (d): tan e' = tan e + (h0 − h)/d — the blend of the
// nodes' own re-seeings, one square root a sector, not four)
fn earthHorizonSin(gq: vec3f, h: f32, L: vec3f) -> vec2f {
  var east = vec3f(-gq.y, gq.x, 0.0);
  east = select(normalize(east), vec3f(0.0, 1.0, 0.0), dot(east, east) < 1e-12);
  let north = cross(gq, east);
  // (the Sun's azimuth in sectors, from the north clockwise)
  let a = (atan2(dot(L, east), dot(L, north)) / 6.28318530717959 + 1.0) * 8.0;
  var sum = vec2f(0.0);
  var rem = 1.0;
  for (var l = 0u; l < ${levels}u; l++) {
    let r = bodies[EH_OFF + 2u * l];
    let s = bodies[EH_OFF + 2u * l + 1u];
    if (s.z <= 0.0) { continue; }
    let dl = atan2(-gq.x * r.y + gq.y * r.x, gq.x * r.x + gq.y * r.y);
    let sz = clamp(gq.z, -1.0, 1.0);
    let da = asin(clamp(sz * r.w - sqrt(max(1.0 - sz * sz, 0.0)) * r.z, -1.0, 1.0));
    let uv = vec2f(dl, da) * s.x;
    let edge = min(min(uv.x, uv.y), min(${TERRAIN_CACHE_N - 1}.0 - uv.x, ${TERRAIN_CACHE_N - 1}.0 - uv.y));
    if (edge <= 1.0) { continue; }
    // (faded into the next, coarser level over its last 12 nodes, and in over 1.5 s after it is first published)
    let w = smoothstep(1.0, 12.0, edge) * s.z;
    let i = vec2u(floor(uv));
    let f = fract(uv);
    // (the four nodes round it, bilinear — one copy of the read: each call is inlined)
    var t = vec2f(0.0);
    var inv = vec2f(0.0);
    var hd = vec2f(0.0);
    var known = true;
    for (var c = 0u; c < 4u; c++) {
      let o = vec2u(c & 1u, c >> 1u);
      let nd = earthHorizonNode(l, i + o, a, s.y);
      known = known && nd.ok > 0.0;
      let bw = select(1.0 - f.x, f.x, o.x == 1u) * select(1.0 - f.y, f.y, o.y == 1u);
      t += bw * nd.t;
      inv += bw * nd.inv;
      hd += bw * nd.hd;
    }
    if (!known) { continue; }
    let tn = t + hd - h * inv;
    let e2 = tn * inverseSqrt(1.0 + tn * tn);
    let v = vec2f(mix(e2.x, e2.y, fract(a)), 1.0 / max(mix(inv.x, inv.y, fract(a)), 1e-9));
    sum += rem * w * v;
    rem *= 1.0 - w;
    if (rem < 1e-3) { break; }
  }
  if (rem >= 1.0) { return vec2f(-2.0, 0.0); }
  // (a coarser level missing under a finer one's fade: the finer one alone)
  return sum / (1.0 - rem);
}
${EARTH_SKY_OPEN ? earthSkyOpenSource() : SKY_OPEN_STUB}`;
}

type Job = { slot: number; window: TerrainWindow; gen: number; row: number };

/**
 * The Earth's horizons on the GPU: one level at a time, a band of rows a frame into its staging buffer, the whole level copied
 * into the tracer's table at once with its header — a level's horizons never half old, half new. A level is baked again
 * when the cache baked it again (its window moved: at once; newer tiles: at most every REBAKE_MS).
 */
export class EarthHorizons {
  private pipeline: GPUComputePipeline | null = null;
  private error: string | null = null;
  private staging: GPUBuffer | null = null;
  private uniform: GPUBuffer | null = null;
  private group: GPUBindGroup | null = null;
  private table: GPUBuffer | null = null;
  private job: Job | null = null;
  /** each level's published window and cache generation (null: none), when published, when first shown (its fade) */
  private published: ({ window: TerrainWindow; gen: number; at: number } | null)[] = EARTH_HORIZON_LEVELS.map(() => null);
  private shownAt: number[] = EARTH_HORIZON_LEVELS.map(() => 0);
  private header = new Float32Array(EH_HEADER_VEC4S * 4);
  private headerWritten = new Float32Array(EH_HEADER_VEC4S * 4).fill(Number.NaN);
  /** the rows a band, the band's budget [ms], its last measure [ms] */
  rows = 24;
  budgetMs = 1.5;
  lastMs = 0;
  bands = 0;
  bakes: number[] = EARTH_HORIZON_LEVELS.map(() => 0);
  /** the last whole level's bake: from its first band to its publication [ms] */
  lastBakeMs = 0;
  private jobStart = 0;
  static readonly REBAKE_MS = 5000;
  static readonly FADE_MS = 1500;
  private disposed = false;

  constructor(private device: GPUDevice) {
    void this.compile();
  }

  private async compile() {
    try {
      const module = this.device.createShaderModule({ code: earthHorizonShader(), label: "earth horizons bake" });
      const p = await this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "bake" } });
      if (!this.disposed) this.pipeline = p;
    } catch (e) {
      this.error = String(e);
      console.warn("Earth horizons unavailable:", e);
    }
  }

  /**
   * A frame: the cache's ready windows and their generations (TerrainCache.levelWindow, levelGeneration) — on: whether the
   * horizons are wanted (the setting, the cache read) —, a band encoded, a finished level published.
   */
  encode(
    enc: GPUCommandEncoder,
    table: GPUBuffer,
    on: boolean,
    window: (level: number) => TerrainWindow | null,
    generation: (level: number) => number,
    timestamp?: () => GPUComputePassDescriptor,
    measuredMs?: number,
  ) {
    const now = performance.now();
    if (!on || !this.pipeline) {
      this.job = null;
      this.published = this.published.map(() => null);
      this.shownAt.fill(0);
      this.writeHeader(table);
      return;
    }
    if (measuredMs && measuredMs > 0 && measuredMs !== this.lastMs) {
      this.lastMs = measuredMs;
      this.rows = Math.max(4, Math.min(TERRAIN_CACHE_N, Math.round(this.rows * Math.min(2, Math.max(0.5, this.budgetMs / measuredMs)))));
    }
    // (a level dropped by the cache — out of its latitudes, the camera too high —: its horizons dropped)
    EARTH_HORIZON_LEVELS.forEach((lv, slot) => {
      if (!window(lv)) {
        this.published[slot] = null;
        this.shownAt[slot] = 0;
      }
    });
    // (the job's level moved again meanwhile: started anew on its new window)
    if (this.job) {
      const w = window(EARTH_HORIZON_LEVELS[this.job.slot]!);
      if (!w || w.i !== this.job.window.i || w.j !== this.job.window.j) this.job = null;
    }
    if (!this.job) {
      // (the next: a level whose window differs from its published one — the finest first —, else one whose heights were
      // baked again since, not sooner than REBAKE_MS after its last)
      let pick = -1;
      for (let slot = 0; slot < EARTH_HORIZON_LEVELS.length && pick < 0; slot++) {
        const w = window(EARTH_HORIZON_LEVELS[slot]!);
        const p = this.published[slot];
        if (w && (!p || p.window.i !== w.i || p.window.j !== w.j)) pick = slot;
      }
      for (let slot = 0; slot < EARTH_HORIZON_LEVELS.length && pick < 0; slot++) {
        const lv = EARTH_HORIZON_LEVELS[slot]!;
        const p = this.published[slot];
        if (window(lv) && p && p.gen !== generation(lv) && now - p.at >= EarthHorizons.REBAKE_MS) pick = slot;
      }
      if (pick >= 0) {
        const lv = EARTH_HORIZON_LEVELS[pick]!;
        this.job = { slot: pick, window: window(lv)!, gen: generation(lv), row: 0 };
        this.jobStart = now;
      }
    }
    if (this.job) this.band(enc, table, this.job, timestamp);
    // (the weights: a level faded in over FADE_MS after it is first shown)
    EARTH_HORIZON_LEVELS.forEach((_, slot) => {
      if (this.published[slot] && !this.shownAt[slot]) this.shownAt[slot] = now;
      this.header[8 * slot + 6] = this.published[slot] ? Math.min(1, (now - this.shownAt[slot]!) / EarthHorizons.FADE_MS) : 0;
    });
    this.writeHeader(table);
  }

  private band(enc: GPUCommandEncoder, table: GPUBuffer, job: Job, timestamp?: () => GPUComputePassDescriptor) {
    const pipeline = this.pipeline!;
    if (!this.staging) {
      this.staging = this.device.createBuffer({
        label: "earth horizons staging",
        size: EH_NODE_VEC4S * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      this.uniform = this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    }
    if (this.table !== table || !this.group) {
      this.table = table;
      this.group = this.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniform! } },
          { binding: 1, resource: { buffer: table } },
          { binding: 2, resource: { buffer: this.staging } },
        ],
      });
    }
    const lv = EARTH_HORIZON_LEVELS[job.slot]!;
    const round = TERRAIN_CACHE_ROUNDS[lv]!;
    const params = terrainWindowParams(job.window, round, true);
    const rows = Math.min(this.rows, TERRAIN_CACHE_N - job.row);
    const D0 = (2 * 2 * Math.PI * WGS84_A) / round;
    const u = new Float32Array(8);
    u.set(params.subarray(0, 4));
    u.set([params[4]!, D0, job.row, rows], 4);
    this.device.queue.writeBuffer(this.uniform!, 0, u);
    const pass = enc.beginComputePass(timestamp?.() ?? { label: "earth horizons bake" });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.group);
    pass.dispatchWorkgroups(Math.ceil(TERRAIN_CACHE_N / 8), Math.ceil(rows / 8));
    pass.end();
    this.bands++;
    job.row += rows;
    if (job.row < TERRAIN_CACHE_N) return;
    // (the whole level: copied into the table, its header with it)
    enc.copyBufferToBuffer(
      this.staging!,
      0,
      table,
      (TABLE_EARTH_HORIZON + EH_HEADER_VEC4S + job.slot * EH_NODE_VEC4S) * 16,
      EH_NODE_VEC4S * 16,
    );
    this.header.set(params.subarray(0, 4), 8 * job.slot);
    this.header.set([params[4]!, D0, this.header[8 * job.slot + 6]!, lv], 8 * job.slot + 4);
    this.published[job.slot] = { window: job.window, gen: job.gen, at: performance.now() };
    this.bakes[job.slot]!++;
    this.lastBakeMs = performance.now() - this.jobStart;
    this.job = null;
  }

  private writeHeader(table: GPUBuffer) {
    if (this.header.every((v, i) => v === this.headerWritten[i])) return;
    this.headerWritten.set(this.header);
    this.device.queue.writeBuffer(table, TABLE_EARTH_HORIZON * 16, this.header);
  }

  stats() {
    return {
      compiled: this.pipeline !== null,
      error: this.error,
      levels: EARTH_HORIZON_LEVELS.map((lv, slot) => ({
        level: lv,
        published: this.published[slot] ? { ...this.published[slot]!.window, gen: this.published[slot]!.gen } : null,
        weight: this.header[8 * slot + 6]!,
        bakes: this.bakes[slot]!,
      })),
      baking: this.job ? { level: EARTH_HORIZON_LEVELS[this.job.slot]!, row: this.job.row } : null,
      rows: this.rows,
      lastMs: this.lastMs,
      bands: this.bands,
      lastBakeMs: this.lastBakeMs,
      bytes: (this.staging?.size ?? 0) + EARTH_HORIZON_VEC4S * 16,
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
