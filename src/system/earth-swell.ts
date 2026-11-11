// L1 — the coastal swell field (docs/ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md §5.3, PLAN-MER-WEBGPU L1–L2): on the shore's
// levels of the relief cache (system/earth-shore.ts — the same windows, the same bake), each sea node's swell phase φ [rad] and its
// height's gain. The phase: the eikonal |∇φ| = k(h), k the wave number the dispersion gives at the swell's period over the depth
// h (Fenton & McKee 1990), solved from the offshore swell — a plane wave on the coarsest level's upwind edges, the next coarser
// level's own phase on a finer one's edges — by a block-iterative Godunov upwind scheme on the GPU (tiles of 16 × 16 nodes, 16
// local passes each, 48 dispatches over three frames): the crests turn round the capes and come in parallel to the beaches; a
// lagoon, a basin the sea reaches by no path gets none. The gain: the shoaling Ks = √(cg₀/cg) and, the crests' turning from the
// offshore way — for straight contours Kr = √(cos θ₀ / cos θ), the local way's cosine with the offshore one near a beach —,
// √max(cos, 0): none in the lee past 90°. The depth: the tiles' bathymetry is not in the cache (its heights stop at the sea's
// level), so Dean's profile from the shore's distance h = 0.1 x^(2/3) (Sam's option a — no shoals of its own yet).
// Read by the raster's water (trace.wgsl seaSwellAt): the surf's crests where the field has them, breaking where the shoaled
// height reaches the depth's limit, the swash timed by them.

/** standard gravity [m/s²] — the dispersion's */
const G = 9.81;

/** the swell's wave number [rad/m] at depth h [m] for period T [s]: Fenton & McKee's explicit fit of ω² = g k tanh(k h) (≤ 1.7 %) */
export function swellK(h: number, T: number): number {
  const L0 = (G * T * T) / (2 * Math.PI);
  const L = L0 * Math.tanh((((2 * Math.PI) / T) * Math.sqrt(h / G)) ** 1.5) ** (2 / 3);
  return (2 * Math.PI) / Math.max(L, 1e-3);
}

/** its group speed [m/s] — cg = c · ½ (1 + 2kh / sinh 2kh) */
export function swellCg(h: number, T: number): number {
  const k = swellK(h, T);
  const c = (2 * Math.PI) / T / k;
  const x = Math.min(2 * k * h, 60);
  return 0.5 * c * (1 + (x > 1e-6 ? x / Math.sinh(x) : 1));
}

/** the eikonal's local update (Godunov, upwind): u at a node from its smallest neighbours a (east–west), b (north–south),
 *  the slowness f [rad/m] and the spacings hx, hy [m] — the 2-D solution where both neighbours are upwind, else the 1-D one */
export function godunov(a: number, b: number, f: number, hx: number, hy: number): number {
  const u1 = Math.min(a + f * hx, b + f * hy);
  if (!Number.isFinite(u1) || u1 <= Math.max(a, b)) return u1;
  // (relative to the smaller: no cancellation of large phases)
  const m = Math.min(a, b);
  const A = a - m,
    B = b - m;
  const ix = 1 / (hx * hx),
    iy = 1 / (hy * hy);
  const qa = ix + iy,
    qb = -2 * (A * ix + B * iy),
    qc = A * A * ix + B * B * iy - f * f;
  const disc = qb * qb - 4 * qa * qc;
  return disc < 0 ? u1 : m + (-qb + Math.sqrt(disc)) / (2 * qa);
}

/** Dean's equilibrium depth [m] at a distance x [m] from the shore (0: land) — the bake's, the tracer's seaDepthAt's */
export function deanDepth(x: number): number {
  return x <= 0 ? 0 : Math.max(0.1 * x ** (2 / 3), 0.3);
}

/** tiles of the block sweep, its local passes, its dispatches in all and a frame */
export const SWELL_TILE = 16;
export const SWELL_LOCAL = 16;
export const SWELL_SWEEPS = 48;
export const SWELL_SWEEPS_A_FRAME = 16;

/**
 * The field on the CPU — the bake's own scheme on an n × n grid (Jacobi between whole sweeps, to convergence): for the tests.
 * dist(i, j): the shore distance [m] (0 land); fixed(i, j): a boundary phase, or null. Returns φ (Infinity where unreached).
 */
export function swellPhaseCpu(
  n: number,
  dist: (i: number, j: number) => number,
  fixed: (i: number, j: number) => number | null,
  T: number,
  hx: (j: number) => number,
  hy: number,
  sweeps = 4 * n,
): Float64Array {
  let phi = new Float64Array(n * n).fill(Infinity);
  const k = new Float64Array(n * n);
  const fx = new Uint8Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const q = j * n + i;
      const x = dist(i, j);
      k[q] = x <= 0 ? 0 : swellK(deanDepth(x), T);
      const f = x > 0 ? fixed(i, j) : null;
      if (f !== null) {
        phi[q] = f;
        fx[q] = 1;
      }
    }
  for (let s = 0; s < sweeps; s++) {
    const out = new Float64Array(phi);
    let moved = false;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const q = j * n + i;
        if (fx[q] || k[q] === 0) continue;
        const a = Math.min(i > 0 ? phi[q - 1]! : Infinity, i < n - 1 ? phi[q + 1]! : Infinity);
        const b = Math.min(j > 0 ? phi[q - n]! : Infinity, j < n - 1 ? phi[q + n]! : Infinity);
        const u = Math.min(phi[q]!, godunov(a, b, k[q]!, hx(j), hy));
        if (u < phi[q]!) {
          out[q] = u;
          moved = true;
        }
      }
    phi = out;
    if (!moved) break;
  }
  return phi;
}

/** The bake's WGSL (its entry points: swellInit, swellSweep, swellFinish). N the cache's nodes a side; R the Earth's radius [m]. */
export function earthSwellShader(N: number, R: number, nodeVec4s: number): string {
  return /* wgsl */ `
// a: level, spacing [m], lat0 [rad] (the window's first node), its nodes a radian
// b: the swell's way (east, north), its period [s], its deep wave number k0 [rad/m]
// c: the window's first node from the anchor (Δlon, Δlat [rad]), cos(the anchor's latitude), 1: the coarser level's field in
// d: in the coarser level's nodes, this window's first node (x, y) and a node of this one; its field's first vec4 in the table
struct SwellU { a: vec4f, b: vec4f, c: vec4f, d: vec4f };
@group(0) @binding(0) var<uniform> U: SwellU;
@group(0) @binding(1) var<storage, read> table: array<vec4f>;
@group(0) @binding(2) var<storage, read> dist: array<vec4f>;
@group(0) @binding(3) var<storage, read> phiIn: array<f32>;
@group(0) @binding(4) var<storage, read_write> phiOut: array<f32>;
@group(0) @binding(5) var<storage, read_write> slow: array<f32>;
@group(0) @binding(6) var<storage, read_write> outNodes: array<vec4f>;
const N = ${N}u;
const INF = 1e30;
const TAU = 6.283185307;
fn distAt(n: u32) -> f32 { return dist[n / 4u][n % 4u]; }
fn depthOf(x: f32) -> f32 { return select(max(0.1 * pow(max(x, 0.0), 2.0 / 3.0), 0.3), 0.0, x <= 0.0); }
fn kOf(h: f32) -> f32 {
  let T = U.b.z;
  let L0 = 9.81 * T * T / TAU;
  let L = L0 * pow(tanh(pow(TAU / T * sqrt(h / 9.81), 1.5)), 2.0 / 3.0);
  return TAU / max(L, 1e-3);
}
fn hxAt(j: u32) -> f32 { return U.a.y * cos(U.a.z + f32(j) / U.a.w); }
// (the coarser level's phase at its node coordinates, bilinear over its reached nodes; x ≥ 0.5 when any)
fn coarsePhase(uv: vec2f) -> vec2f {
  if (min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) >= f32(N - 1u)) { return vec2f(0.0); }
  let i = vec2u(floor(uv));
  let f = fract(uv);
  var acc = 0.0;
  var w = 0.0;
  for (var c = 0u; c < 4u; c++) {
    let o = vec2u(c & 1u, c >> 1u);
    let n = (i.y + o.y) * N + i.x + o.x;
    let v = table[u32(U.d.w) + n / 2u];
    let e = select(v.xy, v.zw, (n & 1u) == 1u);
    let b = select(1.0 - f.x, f.x, o.x == 1u) * select(1.0 - f.y, f.y, o.y == 1u);
    if (e.y >= 0.0) { acc += b * e.x; w += b; }
  }
  return select(vec2f(0.0), vec2f(1.0, acc / w), w > 0.999);
}
// (the slowness — k, negative where the node is held: a boundary's —, and the boundary's phase: the coarser level's on the edges,
// else the offshore plane wave on the upwind edges)
@compute @workgroup_size(64)
fn swellInit(@builtin(global_invocation_id) gid: vec3u) {
  let n = gid.x;
  if (n >= N * N) { return; }
  let i = n % N;
  let j = n / N;
  let x = distAt(n);
  let h = depthOf(x);
  var k = select(kOf(h), 0.0, x <= 0.0);
  var phi = INF;
  let edge = i == 0u || j == 0u || i == N - 1u || j == N - 1u;
  if (edge && k > 0.0) {
    if (U.c.w > 0.5) {
      let c = coarsePhase(U.d.xy + vec2f(f32(i), f32(j)) * U.d.z);
      if (c.x > 0.5) { phi = c.y; k = -k; }
    } else {
      var out = vec2f(0.0);
      if (i == 0u) { out.x = -1.0; }
      if (i == N - 1u) { out.x = 1.0; }
      if (j == 0u) { out.y = -1.0; }
      if (j == N - 1u) { out.y = 1.0; }
      if (dot(out, U.b.xy) < -0.1) {
        let xe = ${R.toFixed(1)} * U.c.z * (U.c.x + f32(i) / U.a.w);
        let xn = ${R.toFixed(1)} * (U.c.y + f32(j) / U.a.w);
        phi = U.b.w * (xe * U.b.x + xn * U.b.y);
        k = -k;
      }
    }
  }
  slow[n] = k;
  phiOut[n] = phi;
}
fn godunov(a: f32, b: f32, f: f32, hx: f32, hy: f32) -> f32 {
  let u1 = min(a + f * hx, b + f * hy);
  if (u1 >= INF * 0.5 || u1 <= max(a, b)) { return u1; }
  let m = min(a, b);
  let A = a - m;
  let B = b - m;
  let ix = 1.0 / (hx * hx);
  let iy = 1.0 / (hy * hy);
  let qa = ix + iy;
  let qb = -2.0 * (A * ix + B * iy);
  let qc = A * A * ix + B * B * iy - f * f;
  let disc = qb * qb - 4.0 * qa * qc;
  return select(m + (-qb + sqrt(disc)) / (2.0 * qa), u1, disc < 0.0);
}
const T_ = ${SWELL_TILE}u;
const TH = ${SWELL_TILE + 2}u;
var<workgroup> tile: array<f32, ${(SWELL_TILE + 2) * (SWELL_TILE + 2)}>;
// (a tile and its rim from the last dispatch, ${SWELL_LOCAL} passes inside it — the phase carried ~${SWELL_TILE - 1} nodes a dispatch —, the tile written)
@compute @workgroup_size(${SWELL_TILE}, ${SWELL_TILE})
fn swellSweep(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let base = vec2i(wg.xy) * i32(T_) - 1;
  for (var t = l.y * T_ + l.x; t < TH * TH; t += T_ * T_) {
    let p = base + vec2i(i32(t % TH), i32(t / TH));
    var v = INF;
    if (p.x >= 0 && p.y >= 0 && p.x < i32(N) && p.y < i32(N)) { v = phiIn[u32(p.y) * N + u32(p.x)]; }
    tile[t] = v;
  }
  workgroupBarrier();
  let me = l.xy + 1u;
  let at = me.y * TH + me.x;
  let g = base + vec2i(me);
  let inside = g.x < i32(N) && g.y < i32(N);
  var k = 0.0;
  var hx = 1.0;
  if (inside) {
    k = slow[u32(g.y) * N + u32(g.x)];
    hx = hxAt(u32(g.y));
  }
  for (var it = 0u; it < ${SWELL_LOCAL}u; it++) {
    var u = tile[at];
    if (k > 0.0) {
      let a = min(tile[at - 1u], tile[at + 1u]);
      let b = min(tile[at - TH], tile[at + TH]);
      u = min(u, godunov(a, b, k, hx, U.a.y));
    }
    workgroupBarrier();
    tile[at] = u;
    workgroupBarrier();
  }
  if (inside) { phiOut[u32(g.y) * N + u32(g.x)] = tile[at]; }
}
fn reached(n: u32) -> bool { return slow[n] != 0.0 && phiIn[n] < INF * 0.5; }
// (two nodes a thread: φ and the gain — the shoaling × the turning's —, −1 where no swell reaches)
@compute @workgroup_size(64)
fn swellFinish(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ${nodeVec4s}u) { return; }
  var o = vec4f(0.0, -1.0, 0.0, -1.0);
  let T = U.b.z;
  let w = TAU / T;
  let cg0 = 9.81 / (2.0 * w);
  for (var c = 0u; c < 2u; c++) {
    let n = gid.x * 2u + c;
    if (n >= N * N || !reached(n)) { continue; }
    let i = n % N;
    let j = n / N;
    let p = phiIn[n];
    // (the phase's gradient: central where both neighbours are reached, else the one that is)
    var gx = 0.0;
    var gy = 0.0;
    let e = i + 1u < N && reached(n + 1u);
    let wv = i > 0u && reached(n - 1u);
    let nn = j + 1u < N && reached(n + N);
    let s = j > 0u && reached(n - N);
    if (e && wv) { gx = 0.5 * (phiIn[n + 1u] - phiIn[n - 1u]); } else if (e) { gx = phiIn[n + 1u] - p; } else if (wv) { gx = p - phiIn[n - 1u]; }
    if (nn && s) { gy = 0.5 * (phiIn[n + N] - phiIn[n - N]); } else if (nn) { gy = phiIn[n + N] - p; } else if (s) { gy = p - phiIn[n - N]; }
    var d = vec2f(gx / hxAt(j), gy / U.a.y);
    d = select(normalize(d), U.b.xy, dot(d, d) < 1e-20);
    let kr = sqrt(max(dot(d, U.b.xy), 0.0));
    let h = depthOf(distAt(n));
    let k = abs(slow[n]);
    let x = min(2.0 * k * h, 60.0);
    let cg = 0.5 * w / k * (1.0 + select(1.0, x / sinh(x), x > 1e-4));
    let ks = sqrt(cg0 / max(cg, 1e-3));
    o[2u * c] = p;
    o[2u * c + 1u] = clamp(ks * kr, 0.0, 4.0);
  }
  outNodes[gid.x] = o;
}`;
}
