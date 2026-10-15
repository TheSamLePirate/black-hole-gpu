// The sea's waves by FFT (docs/PLAN-AVIATION-AAA.md, M1; Tessendorf; sea/fft-gpu.ts drives it): each frame, for
// three cascades of 256 × 256 modes (periods 1024, 128, 16 m), the modes' amplitudes now from their initial ones
// (h̃(k,t) = h̃₀(k) e^{iωt} + conj(h̃₀(−k)) e^{−iωt}, deep water ω = √(g k)), the fields they make — the height,
// its horizontal displacement (the choppy crests: −i k/|k| λ h̃), its slopes, the displacement's derivatives (the
// surface's Jacobian: where it folds, the crests break) — two real fields to a complex array; their inverse FFT
// (rows, then columns: a radix-2 transform of 256 in a workgroup's memory); then, into a texture array, a cascade's
// two layers — (Dx, height, Dz, Jacobian) and (slope x, slope z, their squares: the mips' second moments, the
// unresolved slopes' variance) — and their mips.

struct FftParams {
  // time [s], choppiness λ, the cascades' count, N
  t: vec4f,
  // the cascades' periods [m]
  L: vec4f,
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
  let w = floor(sqrt(G * kl) / w0 + 0.5) * w0 * F.t.x;
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

// the fields into the texture: a cascade's (Dx, height, Dz, Jacobian) and (slope x, slope z, their squares)
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
  textureStore(outTex, vec2u(id.xy), 2u * c, vec4f(A.x, B.x, A.y, J));
  textureStore(outTex, vec2u(id.xy), 2u * c + 1u, vec4f(B.y, C.x, B.y * B.y, C.x * C.x));
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
