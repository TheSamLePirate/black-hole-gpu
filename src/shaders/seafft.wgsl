// The sea's waves by FFT (docs/PLAN-AVIATION-AAA.md, M1; Tessendorf; sea/fft-gpu.ts drives it): each frame, for
// the cascades of 256 × 256 modes in use (sea/spectrum.ts CASCADES — four, not commensurable; the finest left out when the
// nearest sea's pixels cover them whole: PLAN-MER-WEBGPU S1), the modes' amplitudes now from their initial ones
// (h̃(k,t) = h̃₀(k) e^{iωt} + conj(h̃₀(−k)) e^{−iωt}, deep water ω = √(g k)), the fields they make — the height,
// its horizontal displacement (the choppy crests: −i k/|k| λ h̃), its slopes, the displacement's derivatives (the
// surface's Jacobian: where it folds, the crests break) — two real fields to a complex array; their inverse FFT
// (rows, then columns: a radix-2 transform of 256 in a workgroup's memory); then, into a texture array, a cascade's three
// layers, 3c + j — (Dx, height, Dz, Jacobian); (slope x, slope z, their squares); (the foam lying, the foam made, the slopes'
// product, 0) — and their mips: the mips' means are the slopes' first and second moments, their full covariance (LEAN,
// the cross term with it — a swell crossing the wind's sea leans the glint). The foam the breaking crests leave (N6b): where a
// cascade's surface folds past the whitecaps' threshold the foam made, then fading over seconds where it lies.

struct FftParams {
  // time [s], choppiness λ, the cascades' count, N
  t: vec4f,
  // the cascades' periods [m]
  L: vec4f,
  // the foam: each cascade's Jacobian threshold (renderer: the whitecaps' cover at this wind)
  f: vec4f,
  // the water: its gravity [m/s²], its depth [m] (0: deep — the Earth's sea; Miller's knee-deep: sea/spectrum.ts dispersion);
  // the frame's time step [s]
  w: vec4f,
  // the world's foam (PLAN-MER-WEBGPU S4, foamWorld): the camera's cell on each level (x, y level 0; z, w level 1) — integers on
  // the sea's local axes —, the last frame's (the history valid where both windows overlap)
  fc: vec4f,
  fp: vec4f,
  // each cascade's anchor's offset (u, c), two a vec4 (renderer seaFftParams)
  fo0: vec4f,
  fo1: vec4f,
  // the camera on the sea's local axes [m]; the whitecaps' Jacobian threshold and spread
  fx: vec4f,
  // the foam's drift [m/s] (along the wind, across), its decay [1/s], the layer written this frame (0, 1)
  fy: vec4f,
  // the cascades computed, unused ×3
  fz: vec4f,
};

@group(0) @binding(0) var<uniform> F: FftParams;
// h̃₀(k), conj(h̃₀(−k)): a vec4 a mode, cascade after cascade
@group(0) @binding(1) var<storage, read> h0: array<vec4f>;
// the fields: 4 complex arrays a cascade, N² each
@group(0) @binding(2) var<storage, read_write> fld: array<vec2f>;

const N: u32 = 256u;
const LOGN: u32 = 8u;
const G: f32 = 9.81;
const TAU: f32 = 6.283185307179586;
const REPEAT: f32 = 1024.0;

fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

// the modes now and their fields: A = Dx + i Dz, B = height + i slope x, C = slope z + i ∂Dx/∂x, D = ∂Dz/∂z + i ∂Dx/∂z
@compute @workgroup_size(8, 8, 1)
fn spectrum(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= N || id.y >= N) { return; }
  let c = id.z;
  let o = id.y * N + id.x;
  let L = F.L[c];
  let mx = select(i32(id.x), i32(id.x) - i32(N), id.x >= N / 2u);
  let mz = select(i32(id.y), i32(id.y) - i32(N), id.y >= N / 2u);
  let k = vec2f(f32(mx), f32(mz)) * (TAU / L);
  let kl = length(k);
  let a = h0[c * N * N + o];
  // (each mode's pulsation a whole multiple of 2π over the sea's repeat time — 1024 s —: the clock taken modulo
  // that on the CPU, in float64, the phases exact in float32 however far the scene's clock runs)
  let w0 = TAU / REPEAT;
  let g = select(G, F.w.x, F.w.x > 0.0);
  // (tanh's argument held under 15 — 1 to float32's precision there —: Apple's tanh is a ratio of exponentials, NaN past ~44 —
  // Miller's 0.5 m under the 4.9 m cascade reached k d = 82 (PLAN-MER-WEBGPU S1), every wave NaN, its sea black)
  let w = floor(sqrt(g * kl * select(1.0, tanh(min(kl * F.w.y, 15.0)), F.w.y > 0.0)) / w0 + 0.5) * w0 * F.t.x;
  let e = vec2f(cos(w), sin(w));
  let h = cmul(a.xy, e) + cmul(a.zw, vec2f(e.x, -e.y));
  let ih = vec2f(-h.y, h.x); // i·h
  let kn = select(vec2f(0.0), k / kl, kl > 1e-6);
  let lam = F.t.y;
  // the displacement's spectrum: −i λ k/|k| h; its derivatives: λ kx²/|k| h …; the slopes: i k h
  let dx = -ih * (lam * kn.x);
  let dz = -ih * (lam * kn.y);
  let sx = ih * k.x;
  let sz = ih * k.y;
  let dxx = h * (lam * k.x * kn.x);
  let dzz = h * (lam * k.y * kn.y);
  let dxz = h * (lam * k.x * kn.y);
  // (two real fields in one complex array: X + iY's spectrum = X̃ + iỸ)
  let base = c * 4u * N * N;
  fld[base + o] = dx + vec2f(-dz.y, dz.x);
  fld[base + N * N + o] = h + vec2f(-sx.y, sx.x);
  fld[base + 2u * N * N + o] = sz + vec2f(-dxx.y, dxx.x);
  fld[base + 3u * N * N + o] = dzz + vec2f(-dxz.y, dxz.x);
}

var<workgroup> buf: array<vec2f, 256>;

fn bitrev(x: u32) -> u32 { return reverseBits(x) >> (32u - LOGN); }

// one 256-point inverse transform in the workgroup's memory (decimation in time, its input loaded bit-reversed)
fn transform(i: u32) {
  for (var s = 0u; s < LOGN; s++) {
    workgroupBarrier();
    let half = 1u << s;
    if (i < N / 2u) {
      let pos = i % half;
      let a = (i / half) * 2u * half + pos;
      let b = a + half;
      let ang = TAU * f32(pos) / f32(2u * half);
      let w = vec2f(cos(ang), sin(ang));
      let x = buf[a];
      let y = cmul(w, buf[b]);
      buf[a] = x + y;
      buf[b] = x - y;
    }
  }
  workgroupBarrier();
}

// the rows: a workgroup a row of an array (id.y the row, id.z the array)
@compute @workgroup_size(256, 1, 1)
fn rows(@builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) g: vec3u) {
  let base = g.z * N * N + g.y * N;
  buf[bitrev(l.x)] = fld[base + l.x];
  transform(l.x);
  fld[base + l.x] = buf[l.x];
}

// the columns
@compute @workgroup_size(256, 1, 1)
fn cols(@builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) g: vec3u) {
  let base = g.z * N * N + g.y;
  buf[bitrev(l.x)] = fld[base + l.x * N];
  transform(l.x);
  fld[base + l.x * N] = buf[l.x];
}

@group(0) @binding(3) var outTex: texture_storage_2d_array<rgba16float, write>;
// the foam lying on each cascade's surface (N² a cascade), kept from frame to frame
@group(0) @binding(5) var<storage, read_write> foam: array<f32>;
// (its life: a whitecap's foam thins out in a few seconds — the long cascade's, the big breakers', lasts longer)
const FOAM_LIFE = vec4f(5.0, 3.0, 1.5, 0.8);

// the fields into the texture: a cascade's (Dx, height, Dz, Jacobian), (slope x, slope z, their squares), (foam, slopes' product)
@compute @workgroup_size(8, 8, 1)
fn assemble(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= N || id.y >= N) { return; }
  let c = id.z;
  let o = id.y * N + id.x;
  let base = c * 4u * N * N;
  let A = fld[base + o];
  let B = fld[base + N * N + o];
  let C = fld[base + 2u * N * N + o];
  let D = fld[base + 3u * N * N + o];
  let J = (1.0 + C.y) * (1.0 + D.x) - D.y * D.y;
  textureStore(outTex, vec2u(id.xy), 3u * c, vec4f(A.x, B.x, A.y, J));
  textureStore(outTex, vec2u(id.xy), 3u * c + 1u, vec4f(B.y, C.x, B.y * B.y, C.x * C.x));
  // (the foam: made where it folds, faded where it lies; r what lies, g what breaks now)
  // (the band round the threshold a share of its distance below 1 — the cascade's own spread: a calm sea's long cascade
  // barely folds, a fixed band had it foaming everywhere)
  let below = max(1.0 - F.f[c], 0.0);
  let made = select(0.0, smoothstep(F.f[c] + 0.15 * below, F.f[c] - 0.35 * below, J), below > 1e-3);
  let fi = c * N * N + o;
  let lying = max(foam[fi] * exp(-F.w.z / FOAM_LIFE[c]), made);
  foam[fi] = lying;
  textureStore(outTex, vec2u(id.xy), 3u * c + 2u, vec4f(lying, made, B.y * C.x, 0.0));
}

// a mip from the one above: the 2 × 2 mean (the slopes' squares' mean: their second moment)
@group(0) @binding(4) var srcTex: texture_2d_array<f32>;
@compute @workgroup_size(8, 8, 1)
fn mip(@builtin(global_invocation_id) id: vec3u) {
  let d = textureDimensions(outTex);
  if (id.x >= d.x || id.y >= d.y) { return; }
  let p = vec2i(id.xy) * 2;
  let s = textureLoad(srcTex, p, id.z, 0) + textureLoad(srcTex, p + vec2i(1, 0), id.z, 0) + textureLoad(srcTex, p + vec2i(0, 1), id.z, 0) +
    textureLoad(srcTex, p + vec2i(1, 1), id.z, 0);
  textureStore(outTex, vec2u(id.xy), id.z, s * 0.25);
}

// The world's foam (PLAN-MER-WEBGPU S4, after web-ocean): two maps of 256² on the sea's local axes, 128 m and 1 024 m across —
// both divide the sea's kilometre anchor: a texel's world cell is the same whatever anchor the camera has —, addressed as a torus
// (texel i holds the world cell ≡ i mod 256 nearest the camera: a repeat sampler reads it as it is), each with two layers written
// in turn (3C + 2·parity + level: a frame writes one pair — its view, foamOut — and reads the other — foamPrev). Each frame, each texel: the foam left there — the last frame's map, read where the
// foam drifted from (semi-Lagrangian, downwind) — decayed; the foam made now where the whole surface folds (the Jacobian of every
// cascade computed, under the whitecaps' threshold) laid over it; and how fresh it is (a crest breaking now: dense, opaque).
// (the levels' sides [m], the maps' side [texels])
const FOAM_SIZE = vec2f(128.0, 1024.0);
const FOAM_N: i32 = 256;
@group(0) @binding(6) var foamOut: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(7) var foamPrev: texture_2d_array<f32>;
@group(0) @binding(8) var foamFft: texture_2d_array<f32>;
@group(0) @binding(9) var foamSamp: sampler;
fn wrapCell(i: i32, lo: i32) -> i32 { return lo + (((i - lo) % FOAM_N) + FOAM_N) % FOAM_N; }
fn foamUv(x: vec2f, c: u32) -> vec2f {
  let o = select(F.fo1, F.fo0, c < 2u);
  return (x + select(o.zw, o.xy, (c & 1u) == 0u)) / F.L[c];
}
@compute @workgroup_size(8, 8, 1)
fn foamWorld(@builtin(global_invocation_id) id: vec3u) {
  let lvl = id.z;
  let ts = FOAM_SIZE[lvl] / f32(FOAM_N);
  let cam = vec2i(select(F.fc.xy, F.fc.zw, lvl == 1u));
  let prv = vec2i(select(F.fp.xy, F.fp.zw, lvl == 1u));
  let lo = cam - vec2i(FOAM_N / 2);
  let g = vec2i(wrapCell(i32(id.x), lo.x), wrapCell(i32(id.y), lo.y));
  let plo = prv - vec2i(FOAM_N / 2);
  let inPrev = all(g >= plo) && all(g < plo + vec2i(FOAM_N));
  // (the cell's centre on the sea's local axes [m])
  let x = (vec2f(g) + 0.5) * ts;
  // (the whole surface's fold: each cascade's Jacobian less one, summed — at the mip the texel's size resolves)
  var J = 1.0;
  for (var c = 0u; c < u32(F.fz.x + 0.5); c++) {
    let lod = log2(max(ts * 256.0 / F.L[c], 1.0));
    if (lod < 7.5) { J += textureSampleLevel(foamFft, foamSamp, foamUv(x, c), i32(3u * c), lod).w - 1.0; }
  }
  let dt = F.w.z;
  var prev = vec4f(0.0);
  if (inPrev) {
    // (where the foam here drifted from: back along the wind, in the torus's own texels)
    let back = (vec2f(id.xy) + 0.5 - F.fy.xy * dt / ts) / f32(FOAM_N);
    prev = textureSampleLevel(foamPrev, foamSamp, back, i32(lvl), 0.0);
  }
  let inject = clamp((F.fx.z - J) / max(0.5 * F.fx.w, 1e-3), 0.0, 1.0);
  var f = max(prev.r * exp(-dt * F.fy.z), inject);
  f = min(f + inject * dt * 0.6, 1.6);
  let fresh = max(prev.g * exp(-dt * 1.6), inject);
  textureStore(foamOut, id.xy, lvl, vec4f(f, fresh, J, 1.0));
}
