// The giants' turbulence tile (PLAN-PLANETES-AAA P9 G8a): a 2D flow on a β-plane — the planet's rotation, which makes jets
// and eddies — baked once on the GPU into the noise texture's second half (noise3d.ts: slices TILE_Z0…, its frames in time),
// then read by trace.wgsl giantFlow below the map's texel.
//
// The flow: the vorticity–streamfunction equations on a periodic square (2π, 128²), pseudo-spectral — FFTs of 128 points
// in workgroup memory, four passes a step (the pointwise work in them), the products in physical space, dealiased (2/3), Adams–Bashforth 2, an 8th-order spectral
// filter for the cascade's end —:
//   ∂ω/∂t + u·∇ω + β v = r (ω_J − ω)_zonal − μ ω,   ∇²ψ = ω,   u = −∂ψ/∂y, v = ∂ψ/∂x
// — the jets forced (U0 sin 4y, relaxed on their zonal mode), barotropically unstable (U0 n² > β): their flanks roll up into
// eddies and filaments. From a seeded noise, a spin-up, then a window of TILE_FRAMES frames over which each texel stores:
//   r, g  the integrated displacement D (x − D: where the matter at x was at the window's start; a velocity's integral, not
//         the velocity: no stretching, no pulsing — and a streamfunction's flow, without divergence), less the row's zonal
//         drift (the jets' own: the zonal winds are G1's, Cassini's), in tile periods;
//   b     a dye (a seeded pattern at the window's start, carried by the flow: x − D's), centred on 0 — the contrast under the
//         map's texel;
//   a     the eddies' streamfunction ψ′ (ψ less its row's mean — the jets' own zonal part —), over the jets' U0 / n: in
//         geostrophic balance the height of the pressure surfaces, h = f ψ / g — an anticyclone high, a cyclone hollow
//         (PLAN-PLANETES-AAA P9 G9b: the cloud tops' relief at the tile's scales; trace.wgsl takes f's sign by hemisphere).
// The same seed, the same tile (no atomics, fixed sums); a GPU's float rounding may differ from another's by a hair (the window
// short: a few eddy turnovers, it does not grow to sight).

import { TILE_FRAMES, TILE_Z0 } from "../noise3d";

const N = 128;
const N2 = N * N;

/** the flow's settings (tile units: the square 2π, time in its own units) */
export const GIANT_TILE = {
  dt: 0.01,
  /** steps before the window (the eddies grown from the seed's noise) and per frame in it */
  spin: 200,
  perFrame: 1,
  beta: 6,
  /** the jets: U0 sin(n y), relaxed at this rate on their zonal mode */
  jetU: 1.5,
  jetN: 4,
  relax: 0.3,
  /** the linear drag (the inverse cascade's end) and the spectral filter's strength a step at the dealiased edge */
  drag: 0.02,
  filter: 0.3,
  /** the seed's vorticity */
  seed: 4,
};

const WGSL = /* wgsl */ `
const N = ${N}u;
const NF = ${N}.0;
const N2 = ${N2}u;
const TAU = 6.28318530717959;
struct Cfg { dt: f32, beta: f32, jetW: f32, relax: f32, drag: f32, filt: f32, first: f32, advect: f32, jetN: f32, seed: f32, z: f32, frame: f32 };
@group(0) @binding(0) var<uniform> C: Cfg;
@group(0) @binding(1) var<storage, read> tw: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> W: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> NP: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> A: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> B: array<vec2f>;
@group(0) @binding(6) var<storage, read_write> Din: array<vec2f>;
@group(0) @binding(7) var<storage, read_write> Dout: array<vec2f>;
@group(0) @binding(8) var out: texture_storage_3d<rgba16float, write>;

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
// (a gradient noise on a lattice of P cells over the square, wrapped)
fn gnoise2(p: vec2f, P: u32, salt: u32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let b = vec2u((vec2i(i) % vec2i(i32(P)) + vec2i(i32(P))) % vec2i(i32(P)));
  let b1 = (b + 1u) % vec2u(P);
  var n: array<f32, 4>;
  for (var c = 0u; c < 4u; c++) {
    let o = vec2u(c & 1u, c >> 1u);
    let h = pcg(select(b.x, b1.x, o.x == 1u) ^ pcg(select(b.y, b1.y, o.y == 1u) ^ salt));
    let a = f32(h & 0xffffu) * (TAU / 65536.0);
    n[c] = dot(vec2f(cos(a), sin(a)), f - vec2f(o));
  }
  return 1.4 * mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y);
}
// (FFTs of F lines at once — radix 2, Stockham's: natural order in and out, ping-pong in workgroup memory, the F lines one
// after the other —: the workgroup's thread k loads element k of each line into fa, the result in fb; sign −1 forward, +1
// inverse — scaled 1/N each way)
var<workgroup> fa: array<vec2f, ${3 * N}>;
var<workgroup> fb: array<vec2f, ${3 * N}>;
fn fft(F: u32, k: u32, sign: f32) {
  workgroupBarrier();
  var ns = 1u;
  for (var s = 0u; s < ${Math.log2(N)}u; s++) {
    if (k < N / 2u) {
      let r = k % ns;
      let t = tw[r * (N / (2u * ns))];
      let w = vec2f(t.x, sign * t.y);
      let d = (k / ns) * ns * 2u + r;
      for (var f = 0u; f < F; f++) {
        let o = f * N;
        let odd = (s & 1u) == 1u;
        let a = select(fa[o + k], fb[o + k], odd);
        let b0 = select(fa[o + k + N / 2u], fb[o + k + N / 2u], odd);
        let b = vec2f(b0.x * w.x - b0.y * w.y, b0.x * w.y + b0.y * w.x);
        if (odd) { fa[o + d] = a + b; fa[o + d + ns] = a - b; } else { fb[o + d] = a + b; fb[o + d + ns] = a - b; }
      }
    }
    workgroupBarrier();
    ns *= 2u;
  }
}
fn wave(i: u32) -> vec2f {
  let x = i % N;
  let y = i / N;
  return vec2f(f32(select(i32(x), i32(x) - i32(N), x >= N / 2u)), f32(select(i32(y), i32(y) - i32(N), y >= N / 2u)));
}
fn kept(k: vec2f) -> bool { return abs(k.x) < NF / 3.0 && abs(k.y) < NF / 3.0; }

// the seed: a noise's vorticity (A's first field, real), the displacement nil
@compute @workgroup_size(8, 8) fn seed(@builtin(global_invocation_id) g: vec3u) {
  let i = g.y * N + g.x;
  let p = vec2f(g.xy) / NF;
  A[i] = vec2f(C.seed * (gnoise2(p * 8.0, 8u, 11u) + 0.5 * gnoise2(p * 16.0, 16u, 23u)), 0.0);
  Din[i] = vec2f(0.0);
  Dout[i] = vec2f(0.0);
}
// a step, 1: from the state ω̂, the fields to bring back — u + i v, ∂xω + i ∂yω, ω + i ψ —, inverse along the rows (one
// workgroup a row)
@compute @workgroup_size(${N}) fn rowsInv(@builtin(workgroup_id) g: vec3u, @builtin(local_invocation_index) k: u32) {
  let i = g.x * N + k;
  let q = wave(i);
  let k2 = max(dot(q, q), 1.0);
  let z = select(0.0, 1.0, dot(q, q) > 0.0);
  let w = W[i];
  let iw = vec2f(-w.y, w.x);
  fa[k] = z * ((q.y / k2) * iw + (q.x / k2) * w);
  fa[N + k] = q.x * iw + q.y * vec2f(-w.x, -w.y);
  fa[2u * N + k] = vec2f(w.x + z * w.y / k2, w.y - z * w.x / k2);
  fft(3u, k, 1.0);
  for (var f = 0u; f < 3u; f++) { B[f * N2 + i] = fb[f * N + k] * (1.0 / NF); }
}
// 2: inverse along the columns (one workgroup a column), then in physical space the advection's product −u·∇ω − βv (A, to
// go forward) and ω, ψ kept (A's second field: the frames'); the displacement carried along (semi-Lagrangian: D at the
// departure point, bilinear, wrapped, plus the step)
fn dAt(p: vec2f) -> vec2f {
  let i = floor(p);
  let f = p - i;
  let b = vec2u((vec2i(i) % vec2i(i32(N)) + vec2i(i32(N))) % vec2i(i32(N)));
  let b1 = (b + 1u) % vec2u(N);
  return mix(mix(Din[b.y * N + b.x], Din[b.y * N + b1.x], f.x), mix(Din[b1.y * N + b.x], Din[b1.y * N + b1.x], f.x), f.y);
}
@compute @workgroup_size(${N}) fn colsInv(@builtin(workgroup_id) g: vec3u, @builtin(local_invocation_index) k: u32) {
  let i = k * N + g.x;
  for (var f = 0u; f < 3u; f++) { fa[f * N + k] = B[f * N2 + i]; }
  fft(3u, k, 1.0);
  let uv = fb[k] * (1.0 / NF);
  let dw = fb[N + k] * (1.0 / NF);
  A[i] = vec2f(-(uv.x * dw.x + uv.y * dw.y) - C.beta * uv.y, 0.0);
  A[N2 + i] = fb[2u * N + k] * (1.0 / NF);
  if (C.advect > 0.0) { Dout[i] = dAt(vec2f(f32(g.x), f32(k)) - uv * C.dt * (NF / TAU)) + uv * C.dt; } else { Dout[i] = vec2f(0.0); }
}
// 3: forward along the rows
@compute @workgroup_size(${N}) fn rowsFwd(@builtin(workgroup_id) g: vec3u, @builtin(local_invocation_index) k: u32) {
  let i = g.x * N + k;
  fa[k] = A[i];
  fft(1u, k, -1.0);
  B[i] = fb[k];
}
// 4: forward along the columns, then the step: Adams–Bashforth 2, the jets' zonal mode relaxed, the drag, the filter (the
// seed's spectrum the state at the start)
fn colsFwd(g: u32, k: u32) -> vec2f {
  fa[k] = B[k * N + g];
  fft(1u, k, -1.0);
  return fb[k];
}
@compute @workgroup_size(${N}) fn start(@builtin(workgroup_id) g: vec3u, @builtin(local_invocation_index) k: u32) {
  let i = k * N + g.x;
  let nh = colsFwd(g.x, k);
  W[i] = select(vec2f(0.0), nh, kept(wave(i)));
  NP[i] = vec2f(0.0);
}
@compute @workgroup_size(${N}) fn update(@builtin(workgroup_id) g: vec3u, @builtin(local_invocation_index) k: u32) {
  let i = k * N + g.x;
  let nh = colsFwd(g.x, k);
  let q = wave(i);
  let w = W[i];
  let np = select(NP[i], nh, C.first > 0.0);
  // (ω_J = −U0 n cos(n y): ±n zonal modes −U0 n N²/2, forward DFT unscaled)
  var f = vec2f(0.0);
  if (q.x == 0.0 && abs(q.y) == C.jetN) { f = C.relax * (vec2f(-C.jetW * C.jetN * NF * NF * 0.5, 0.0) - w); }
  let kk = dot(q, q) / (NF * NF / 9.0);
  let filt = exp(-C.filt * kk * kk * kk * kk);
  W[i] = select(vec2f(0.0), (w + C.dt * (1.5 * nh - 0.5 * np + f - C.drag * w)) * filt, kept(q));
  NP[i] = nh;
}
// a frame: the displacement less its row's zonal drift, the dye, the eddies' streamfunction (one workgroup a row)
var<workgroup> sums: array<f32, N>;
var<workgroup> psis: array<f32, N>;
@compute @workgroup_size(${N}) fn frame(@builtin(workgroup_id) g: vec3u, @builtin(local_invocation_index) x: u32) {
  let y = g.x;
  let i = y * N + x;
  let d = Dout[i];
  sums[x] = d.x;
  psis[x] = A[N2 + i].y;
  workgroupBarrier();
  for (var s = N / 2u; s > 0u; s >>= 1u) {
    if (x < s) {
      sums[x] += sums[x + s];
      psis[x] += psis[x + s];
    }
    workgroupBarrier();
  }
  let e = d - vec2f(sums[0] / NF, 0.0);
  // (where its matter was at the window's start, in the square's units: the dye there)
  let p = (vec2f(f32(x), f32(y)) * (TAU / NF) - e) / TAU;
  let dye = 0.65 * gnoise2(p * 6.0, 6u, 37u) + 0.35 * gnoise2(p * 12.0, 12u, 41u);
  let v = vec4f(e / TAU, 0.5 * dye, (A[N2 + i].y - psis[0] / NF) / max(C.jetW / C.jetN, 1e-6));
  textureStore(out, vec3u(x, y, u32(C.z)), v);
  if (C.frame == 0.0) { textureStore(out, vec3u(x, y, u32(C.z) - 1u), v); }
  if (C.frame == ${TILE_FRAMES - 1}.0) { textureStore(out, vec3u(x, y, u32(C.z) + 1u), v); }
}
`;

/** Bakes the tile into the noise texture (noise3d.ts: its slices TILE_Z0 − 1 … TILE_Z0 + TILE_FRAMES): resolves when the GPU
 *  is done, with the time it took [ms] — on the clock, and the GPU's own (NaN: no timestamps). */
export async function bakeGiantTile(
  device: GPUDevice,
  noise: GPUTexture,
  o: Partial<typeof GIANT_TILE> = {},
): Promise<{ ms: number; gpuMs: number }> {
  const c = { ...GIANT_TILE, ...o };
  const t0 = performance.now();
  const module = device.createShaderModule({ code: WGSL, label: "giant tile" });
  const S = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: S, buffer: { type: "uniform", hasDynamicOffset: true } },
      { binding: 1, visibility: S, buffer: { type: "read-only-storage" } },
      ...[2, 3, 4, 5, 6, 7].map((binding) => ({ binding, visibility: S, buffer: { type: "storage" as const } })),
      { binding: 8, visibility: S, storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" } },
    ],
  });
  const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipe = Object.fromEntries(
    ["seed", "rowsInv", "colsInv", "rowsFwd", "start", "update", "frame"].map((e) => [
      e,
      device.createComputePipeline({ layout: pl, compute: { module, entryPoint: e } }),
    ]),
  ) as Record<string, GPUComputePipeline>;
  const buf = (size: number, usage = GPUBufferUsage.STORAGE) => device.createBuffer({ size, usage });
  const tw = buf(N * 8, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  const t = new Float32Array(2 * N);
  for (let k = 0; k < N; k++) t.set([Math.cos((2 * Math.PI * k) / N), Math.sin((2 * Math.PI * k) / N)], 2 * k);
  device.queue.writeBuffer(tw, 0, t);
  const W = buf(N2 * 8),
    NP = buf(N2 * 8),
    A = buf(2 * N2 * 8),
    B = buf(3 * N2 * 8),
    D = [buf(N2 * 8), buf(N2 * 8)];
  // (the settings: one block a frame and the spin's — dynamic offsets, 256 bytes apart)
  const blocks = TILE_FRAMES + 2;
  const cfg = device.createBuffer({ size: 256 * blocks, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(64 * blocks);
  const block = (b: number, first: number, advect: number, frame: number) =>
    data.set([c.dt, c.beta, c.jetU, c.relax, c.drag, c.filter, first, advect, c.jetN, c.seed, TILE_Z0 + Math.max(frame, 0), frame], 64 * b);
  block(0, 1, 0, -1);
  block(1, 0, 0, -1);
  for (let f = 0; f < TILE_FRAMES; f++) block(2 + f, 0, 1, f);
  device.queue.writeBuffer(cfg, 0, data);
  const view = noise.createView({ dimension: "3d" });
  const groups = [0, 1].map((p) =>
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: cfg, size: 48 } },
        { binding: 1, resource: { buffer: tw } },
        { binding: 2, resource: { buffer: W } },
        { binding: 3, resource: { buffer: NP } },
        { binding: 4, resource: { buffer: A } },
        { binding: 5, resource: { buffer: B } },
        { binding: 6, resource: { buffer: D[p]! } },
        { binding: 7, resource: { buffer: D[1 - p]! } },
        { binding: 8, resource: view },
      ],
    }),
  );
  const enc = device.createCommandEncoder({ label: "giant tile" });
  // (the GPU's own time, where it can say: the frames drawn meanwhile not counted)
  const qs = device.features.has("timestamp-query") ? device.createQuerySet({ type: "timestamp", count: 2 }) : null;
  const pass = enc.beginComputePass(qs ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } } : {});
  let parity = 0;
  const run = (e: string, b: number, x: number, y = 1) => {
    pass.setPipeline(pipe[e]!);
    pass.setBindGroup(0, groups[parity]!, [256 * b]);
    pass.dispatchWorkgroups(x, y);
  };
  const G = N / 8;
  run("seed", 0, G, G);
  run("rowsFwd", 0, N);
  run("start", 0, N);
  const steps = c.spin + TILE_FRAMES * c.perFrame;
  for (let s = 0; s < steps; s++) {
    const w = s - c.spin;
    const f = w >= 0 && (w + 1) % c.perFrame === 0 ? (w + 1) / c.perFrame - 1 : -1;
    const b = s === 0 ? 0 : f >= 0 ? 2 + f : w >= 0 ? 2 + Math.floor(w / c.perFrame) : 1;
    run("rowsInv", b, N);
    run("colsInv", b, N);
    if (f >= 0) run("frame", b, N);
    run("rowsFwd", b, N);
    run("update", b, N);
    // (the displacement written into the other buffer: they swap)
    parity = 1 - parity;
  }
  pass.end();
  const stamps = qs ? device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }) : null;
  const read = qs ? device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;
  if (qs) {
    enc.resolveQuerySet(qs, 0, 2, stamps!, 0);
    enc.copyBufferToBuffer(stamps!, 0, read!, 0, 16);
  }
  device.queue.submit([enc.finish()]);
  await device.queue.onSubmittedWorkDone();
  const ms = performance.now() - t0;
  let gpuMs = Number.NaN;
  if (read) {
    await read.mapAsync(GPUMapMode.READ);
    const t = new BigInt64Array(read.getMappedRange());
    gpuMs = Number(t[1]! - t[0]!) / 1e6;
    read.unmap();
  }
  for (const b of [tw, W, NP, A, B, ...D, cfg, stamps, read]) b?.destroy();
  qs?.destroy();
  return { ms, gpuMs };
}

/** The tile's frames read back (rgba16float as numbers, frame by frame, row by row): tests, captures. */
export async function readGiantTile(device: GPUDevice, noise: GPUTexture, first = TILE_Z0 - 1, count = TILE_FRAMES + 2) {
  const bytes = N * N * 8 * count;
  const b = device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: noise, origin: [0, 0, first] }, { buffer: b, bytesPerRow: N * 8, rowsPerImage: N }, [N, N, count]);
  device.queue.submit([enc.finish()]);
  await b.mapAsync(GPUMapMode.READ);
  const h = new Uint16Array(b.getMappedRange().slice(0));
  b.unmap();
  b.destroy();
  const f = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const v = h[i]!,
      e = (v >> 10) & 31,
      m = v & 1023,
      s = v >> 15 ? -1 : 1;
    f[i] = s * (e === 0 ? m * 2 ** -24 : e === 31 ? (m ? Number.NaN : Number.POSITIVE_INFINITY) : (1 + m / 1024) * 2 ** (e - 15));
  }
  return { size: N, frames: count, data: f };
}
