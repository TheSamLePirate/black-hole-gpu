// General-relativistic ray tracer for a Kerr black hole (Boyer–Lindquist coordinates, G = c = M = 1).
//
// Each pixel launches a photon from the camera (a boosted ZAMO frame) and integrates its null
// geodesic backwards in affine parameter with RK4 on the Hamiltonian equations of motion.
// Emission sources:
//   * Novikov–Thorne disk (Page–Thorne flux, LTE blackbody source): either an infinitely thin grey
//     slab of optical depth τ, or a volumetric Gaussian layer of scale height H/R with
//     front-to-back absorption/emission along the geodesic
//   * relativistic synchrotron jet and optically thin hot flow (exact spectral colorimetry)
//   * the celestial sphere (blackbody stars + Milky Way, checkerboard, or a user image)
// Frequency shifts are exact: I_ν/ν³ is invariant, so a blackbody at T is seen as a blackbody at g·T.

struct Params {
  res: vec4f,      // W, H, block size (realtime subsampling), sample index
  cam: vec4f,      // r, θ, φ, tan(fov/2)
  camRight: vec4f, // camera basis in the ZAMO frame, components (r̂, θ̂, φ̂); w = aspect
  camUp: vec4f,    // w = pixel angular size
  camFwd: vec4f,   // w = unused
  zamo: vec4f,     // α, ω, ϖ, √Σ at the camera
  zamo2: vec4f,    // √(Σ/Δ), unused...
  boost: vec4f,    // observer velocity β in the ZAMO frame (r̂, θ̂, φ̂), w = γ
  bh: vec4f,       // a, r+, r_isco, r_out
  disk: vec4f,     // T_max [K], F_max, turbulence, log10 Y(T_max)
  integ: vec4f,    // ε, max steps, r_escape, capture tolerance
  time: vec4f,     // t_now [M], flow period, background intensity, star size
  vol: vec4f,      // enabled, H/R, spectral index α, intensity
  region: vec4f,   // y0, y1, accumulate (0/1), random seed
  misc: vec4f,     // limb darkening, bolometric (0/1), disk emissivity scale, disk vertical optical depth τ₀
  jet: vec4f,      // enabled, bulk speed β, width coefficient, intensity
  jet2: vec4f,     // length [M], synchrotron cutoff ν_c (in units of the green band), knot contrast, unused
  frame: vec4u,    // frame stamp, epoch (first frame of the current scene), flags, min spp (adaptive sampling)
  ext: vec4f,      // integrator tolerance, noise threshold, shutter [M], temporal blend weight
  ext2: vec4f,     // interleave offset x, y, disk scale height H/R (0 = thin slab), 1.0 (opaque one)
  volColor: vec4f, // hot-flow colour: CIE-integrated power law ν^-α (linear sRGB)
  modes: vec4u,    // render mode, shift mode, background mode, disk enabled
  skyX: vec4f,     // rows of the rotation black-hole frame → ICRS equatorial; w = catalogue flux scale
  skyY: vec4f,     // w = real sky loaded (0/1)
  skyZ: vec4f,
  pol: vec4f,      // polarization on (0/1), synchrotron fraction, hot-flow field (0 tor, 1 rad, 2 vert, 3 spiral), jet pitch
  ret: vec4f,      // returning radiation on (0/1), disk albedo, max steps of secondary rays, unused
  radio: vec4f,    // band (0 visible, 1 230 GHz, 2 86/230/345 GHz), τ₂₃₀, ν_s(4M)/230 GHz, θ_e(4M)
  radio2: vec4f,   // jet radio brightness, flow H/R, unused, unused
  spot: vec4f,     // hot spot on (0/1), orbit radius [M], size σ [M], optical depth through the centre
  spot2: vec4f,    // temperature [K], brightness, initial azimuth [rad], height above the plane [M]
  wh: vec4f,       // wormhole world on (0/1), throat radius ρ, half length a, lensing mass M (Dneg metric)
  wh2: vec4f,      // camera in the throat region (0/1), camera ℓ, gluing radius, ℓ at the gluing sphere
  whN: vec4f,      // camera n̂ (rep, see wormhole.ts), ℓ where rays leave for our sky
  whC: vec4f,      // centre of the far mouth in the black hole's frame
  whX: vec4f,      // mouth frame axes in the black hole's frame (x at the hole, z towards the spin axis)
  whY: vec4f,
  whZ: vec4f,
  star: vec4f,     // companion star on (0/1), orbital radius [M], radius [M], temperature [K]
  star2: vec4f,    // brightness, azimuth at t = 0 [rad], mass m [M], unused
  path: vec4f,     // camera free-fall path: point count, tube radius per unit ray length, fate (1 horizon, 2 escape), unused
  bary: vec4f,     // Gargantua orbits the centre of mass: q = m/(M + m) (0: no), relative orbit Ω, unused, unused
  water: vec4f,    // cinematic liquid throat: on (0/1), ripple strength, reflectance at normal incidence F0, clock [s]
  water2: vec4f,   // splash where the camera went through: centre (rep unit vector), clock at the crossing
  water3: vec4f,   // glow of the liquid, a pixel's footprint on the throat [rad], unused, unused
  water4: vec4f,   // absorption of the liquid per unit path (rgb, from its colour and density), unused
  water5: vec4f,   // colour of the glow (linear rgb), unused
  envCfg: vec4f,   // light probe: blend weight of a new frame (1: replace), unused…
};

// Pipeline specialisation: the error-controlled integrator is compiled only into the quality
// pipeline, keeping the realtime kernel small (register pressure / occupancy).
override QUALITY_PIPELINE: bool = false;

const FLAG_ADAPTIVE_RK = 1u;    // step-doubling error control + Richardson extrapolation
const FLAG_ADAPTIVE_SPP = 2u;   // skip converged pixels (progressive / offline)
const FLAG_TEMPORAL = 4u;       // temporal accumulation of realtime samples
const FLAG_INTERLEAVED = 8u;    // realtime pass: one pixel per block, rotating offset

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4f>;
@group(0) @binding(2) var<storage, read> bbLut: array<vec4f>;
@group(0) @binding(3) var bgTex: texture_2d<f32>;
@group(0) @binding(4) var bgSamp: sampler;
@group(0) @binding(5) var<storage, read_write> moments: array<f32>; // Σ luminance² per pixel
@group(0) @binding(6) var<storage, read_write> stamps: array<u32>;  // frame of the last sample
@group(0) @binding(7) var<storage, read> syncLut: array<vec4f>;     // synchrotron spectrum colours
@group(0) @binding(8) var mwTex: texture_2d<f32>;      // Gaia DR2 Milky Way (linear, mip-mapped)
@group(0) @binding(9) var starLodTex: texture_2d<f32>; // catalogue radiance map (large footprints)
// Star catalogue: [magic, grid, count, 0, cellStart[6·grid² + 1], stars (x, y, z, mag|T packed)]
@group(0) @binding(10) var<storage, read> catalogue: array<u32>;
@group(0) @binding(11) var<storage, read_write> polAcc: array<vec2f>; // Σ Stokes Q, U (luminance)
// camera path: 256 points (xyz, fraction along the path), then bounding spheres of chunks of 16 segments
@group(0) @binding(13) var<storage, read> pathPts: array<vec4f>;
// light probe around the camera (equirectangular, camera rest frame), for the Ranger's lighting
@group(0) @binding(14) var<storage, read_write> envBuf: array<vec4f>;

const PI = 3.14159265358979;
const TAU = 6.28318530717959;
const LUT_N = 1024.0;
const LUT_LOG_MIN = 2.0;
const LUT_LOG_MAX = 9.0;
const SYNC_N = 512.0;
const SYNC_LOG_MIN = -2.0;
const SYNC_LOG_MAX = 3.0;

// Render modes
const MODE_PHYSICAL = 0u;
const MODE_REDSHIFT = 1u;
const MODE_TEMPERATURE = 2u;
const MODE_ORDER = 3u;
const MODE_STEPS = 4u;
// Shift modes
const SHIFT_FULL = 0u;        // Doppler + gravitational + beaming
const SHIFT_GRAV_ONLY = 1u;   // emitter replaced by a ZAMO: no orbital Doppler
const SHIFT_NO_BEAMING = 2u;  // colour shift kept, intensity not boosted
const SHIFT_NONE = 3u;        // "Interstellar" rendering: g = 1

// ---------------------------------------------------------------------------------------------
// Random numbers / hashing
// ---------------------------------------------------------------------------------------------
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash3u(p: vec3u) -> u32 { return pcg(p.x ^ pcg(p.y ^ pcg(p.z))); }
fn isNan(x: f32) -> bool { return (bitcast<u32>(x) & 0x7fffffffu) > 0x7f800000u; }
fn u2f(u: u32) -> f32 { return f32(u >> 8u) * (1.0 / 16777216.0); }
fn hash4(p: vec3u) -> vec4f {
  let h = hash3u(p);
  let h2 = pcg(h);
  let h3 = pcg(h2);
  let h4 = pcg(h3);
  return vec4f(u2f(h), u2f(h2), u2f(h3), u2f(h4));
}
fn hash31(p: vec3f) -> f32 {
  return u2f(hash3u(bitcast<vec3u>(vec3i(floor(p)))));
}

// 3D value noise + fBm
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash31(i);
  let n100 = hash31(i + vec3f(1, 0, 0));
  let n010 = hash31(i + vec3f(0, 1, 0));
  let n110 = hash31(i + vec3f(1, 1, 0));
  let n001 = hash31(i + vec3f(0, 0, 1));
  let n101 = hash31(i + vec3f(1, 0, 1));
  let n011 = hash31(i + vec3f(0, 1, 1));
  let n111 = hash31(i + vec3f(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
fn fbm(p0: vec3f, octaves: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  var n = 0.0;
  for (var i = 0; i < octaves; i++) {
    s += a * vnoise(p);
    n += a;
    p = p * 2.03 + vec3f(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / n;
}

// ---------------------------------------------------------------------------------------------
// Blackbody colour (exact Planck × CIE 1931, precomputed LUT over log10 T)
// ---------------------------------------------------------------------------------------------
fn bbLookup(T: f32) -> vec4f {
  let lt = clamp(log2(max(T, 1.0)) * 0.30102999566, LUT_LOG_MIN, LUT_LOG_MAX);
  let x = (lt - LUT_LOG_MIN) / (LUT_LOG_MAX - LUT_LOG_MIN) * (LUT_N - 1.0);
  let i0 = u32(floor(x));
  let i1 = min(i0 + 1u, u32(LUT_N) - 1u);
  return mix(bbLut[i0], bbLut[i1], fract(x));
}
// Radiance of a blackbody at T, relative to a reference log10 luminance.
fn blackbody(T: f32, logYref: f32) -> vec3f {
  let e = bbLookup(T);
  return e.rgb * exp2((e.a - logYref) * 3.32192809489);
}
// Colour of a blackbody at g·T with the radiance ratio B(gT)/B(T) (surface brightness change).
fn blackbodyShifted(T: f32, g: f32) -> vec3f {
  let e0 = bbLookup(T);
  let e1 = bbLookup(T * g);
  return e1.rgb * exp2((e1.a - e0.a) * 3.32192809489);
}

// CIE-integrated colour of the spectrum x^{1/3} e^{−x/s} (x = ν/ν_green), s = g ν_c.
fn syncColor(sArg: f32) -> vec3f {
  let ls = clamp(log2(max(sArg, 1e-6)) * 0.30102999566, SYNC_LOG_MIN, SYNC_LOG_MAX);
  let x = (ls - SYNC_LOG_MIN) / (SYNC_LOG_MAX - SYNC_LOG_MIN) * (SYNC_N - 1.0);
  let i0 = u32(floor(x));
  let i1 = min(i0 + 1u, u32(SYNC_N) - 1u);
  return mix(syncLut[i0].rgb, syncLut[i1].rgb, fract(x));
}

// ---------------------------------------------------------------------------------------------
// Kerr geodesics — Hamiltonian H = N/(2Σ), E = 1:
//   N = Δ p_r² + p_θ² − W²/Δ + (L − a sin²θ)²/sin²θ,   W = r² + a² − aL
// x = (r, θ, φ, t), p = (p_r, p_θ)
// ---------------------------------------------------------------------------------------------
struct Deriv { dx: vec4f, dp: vec2f };

fn geodesicRHS(x: vec4f, p: vec2f, L: f32, a: f32) -> Deriv {
  let r = x.x;
  let s = max(sin(x.y), 1e-6);
  let c = cos(x.y);
  let s2 = s * s;
  let r2 = r * r;
  let a2 = a * a;
  let sig = r2 + a2 * c * c;
  let del = r2 - 2.0 * r + a2;
  let W = r2 + a2 - a * L;
  let ldel = L - a * s2;
  let isig = 1.0 / sig;
  let idel = 1.0 / del;
  let pr = p.x;
  let pth = p.y;
  let N = del * pr * pr + pth * pth - W * W * idel + ldel * ldel / s2;
  let dNdr = (2.0 * r - 2.0) * pr * pr - 4.0 * r * W * idel + W * W * (2.0 * r - 2.0) * idel * idel;
  let dNdth = -2.0 * L * L * c / (s2 * s) + 2.0 * a2 * s * c;
  let dSigdth = -2.0 * a2 * s * c;
  var d: Deriv;
  d.dx = vec4f(
    del * pr * isig,
    pth * isig,
    (a * W * idel + L / s2 - a) * isig,
    ((r2 + a2) * W * idel + a * ldel) * isig);
  d.dp = vec2f(
    -0.5 * dNdr * isig + N * r * isig * isig,
    -0.5 * dNdth * isig + 0.5 * N * dSigdth * isig * isig);
  return d;
}

struct GState { x: vec4f, p: vec2f };

fn rk4(s: GState, L: f32, a: f32, h: f32) -> GState {
  let k1 = geodesicRHS(s.x, s.p, L, a);
  let k2 = geodesicRHS(s.x + 0.5 * h * k1.dx, s.p + 0.5 * h * k1.dp, L, a);
  let k3 = geodesicRHS(s.x + 0.5 * h * k2.dx, s.p + 0.5 * h * k2.dp, L, a);
  let k4 = geodesicRHS(s.x + h * k3.dx, s.p + h * k3.dp, L, a);
  var o: GState;
  o.x = s.x + (h / 6.0) * (k1.dx + 2.0 * k2.dx + 2.0 * k3.dx + k4.dx);
  o.p = s.p + (h / 6.0) * (k1.dp + 2.0 * k2.dp + 2.0 * k3.dp + k4.dp);
  return o;
}

// RK4 increment only (the state update is applied with compensated summation).
fn rk4Delta(s: GState, L: f32, a: f32, h: f32) -> GState {
  let k1 = geodesicRHS(s.x, s.p, L, a);
  let k2 = geodesicRHS(s.x + 0.5 * h * k1.dx, s.p + 0.5 * h * k1.dp, L, a);
  let k3 = geodesicRHS(s.x + 0.5 * h * k2.dx, s.p + 0.5 * h * k2.dp, L, a);
  let k4 = geodesicRHS(s.x + h * k3.dx, s.p + h * k3.dp, L, a);
  var o: GState;
  o.x = (h / 6.0) * (k1.dx + 2.0 * k2.dx + 2.0 * k3.dx + k4.dx);
  o.p = (h / 6.0) * (k1.dp + 2.0 * k2.dp + 2.0 * k3.dp + k4.dp);
  return o;
}

// Compensated (Kahan) summation of the state, y ← y + Δ, with the rounding error of every update
// carried in c: over thousands of steps the f32 round-off stops accumulating (≈ doubles the useful
// precision of φ, t and of rays skimming the photon sphere). `one` is 1.0 read from the uniforms:
// an opaque factor that keeps fast-math compilers from simplifying (t − y) − Δ to zero.
fn kahanAdd(y: GState, d: GState, c: ptr<function, GState>, one: f32) -> GState {
  var o: GState;
  let dx = d.x - (*c).x;
  let tx = (y.x + dx) * one;
  (*c).x = (tx - y.x) * one - dx;
  o.x = tx;
  let dp = d.p - (*c).p;
  let tp = (y.p + dp) * one;
  (*c).p = (tp - y.p) * one - dp;
  o.p = tp;
  return o;
}

// Error-controlled Dormand–Prince 5(4) (the integrator of MATLAB ode45 / Hairer's DOPRI5): six new
// derivative evaluations per step, the seventh stage is the derivative at the new point and is
// reused as the first stage of the next step (FSAL). The embedded 4th-order solution gives the
// local error estimate; the 5th-order solution is propagated (local extrapolation).
struct StepOut { s: GState, d: GState, k: Deriv, h: f32, hNext: f32, evals: u32 };

// Mixed relative norm: radius relative to r, angles absolute (φ weighted by sin θ), momenta relative.
fn errorNorm(y: GState, ex: vec4f, ep: vec2f) -> f32 {
  let ePos = max(abs(ex.x) / max(y.x.x, 1e-3), max(abs(ex.y), abs(ex.z) * sin(y.x.y)));
  let eMom = max(abs(ep.x) / (abs(y.p.x) + 1.0), abs(ep.y) / (abs(y.p.y) + 1.0));
  return max(ePos, eMom);
}

fn adaptiveDOPRI(s: GState, k1: Deriv, L: f32, a: f32, hTry: f32, hMax: f32, tol: f32) -> StepOut {
  var h = min(hTry, hMax);
  var out: StepOut;
  out.evals = 0u;
  for (var it = 0; it < 12; it++) {
    let hh = -h; // backwards in affine parameter
    let k2 = geodesicRHS(s.x + hh * (0.2 * k1.dx),
                          s.p + hh * (0.2 * k1.dp), L, a);
    let k3 = geodesicRHS(s.x + hh * (0.075 * k1.dx + 0.225 * k2.dx),
                          s.p + hh * (0.075 * k1.dp + 0.225 * k2.dp), L, a);
    let k4 = geodesicRHS(s.x + hh * (0.9777777777777777 * k1.dx + -3.7333333333333334 * k2.dx + 3.5555555555555554 * k3.dx),
                          s.p + hh * (0.9777777777777777 * k1.dp + -3.7333333333333334 * k2.dp + 3.5555555555555554 * k3.dp), L, a);
    let k5 = geodesicRHS(s.x + hh * (2.9525986892242035 * k1.dx + -11.595793324188385 * k2.dx + 9.822892851699436 * k3.dx + -0.2908093278463649 * k4.dx),
                          s.p + hh * (2.9525986892242035 * k1.dp + -11.595793324188385 * k2.dp + 9.822892851699436 * k3.dp + -0.2908093278463649 * k4.dp), L, a);
    let k6 = geodesicRHS(s.x + hh * (2.8462752525252526 * k1.dx + -10.757575757575758 * k2.dx + 8.906422717743473 * k3.dx + 0.2784090909090909 * k4.dx + -0.2735313036020583 * k5.dx),
                          s.p + hh * (2.8462752525252526 * k1.dp + -10.757575757575758 * k2.dp + 8.906422717743473 * k3.dp + 0.2784090909090909 * k4.dp + -0.2735313036020583 * k5.dp), L, a);
    var d: GState;
    d.x = hh * (0.09114583333333333 * k1.dx + 0.44923629829290207 * k3.dx + 0.6510416666666666 * k4.dx + -0.322376179245283 * k5.dx + 0.13095238095238096 * k6.dx);
    d.p = hh * (0.09114583333333333 * k1.dp + 0.44923629829290207 * k3.dp + 0.6510416666666666 * k4.dp + -0.322376179245283 * k5.dp + 0.13095238095238096 * k6.dp);
    var y: GState;
    y.x = s.x + d.x;
    y.p = s.p + d.p;
    let k7 = geodesicRHS(y.x, y.p, L, a);
    out.evals += 6u;
    let ex = hh * (0.0012326388888888888 * k1.dx + -0.0042527702905061394 * k3.dx + 0.03697916666666667 * k4.dx + -0.05086379716981132 * k5.dx + 0.0419047619047619 * k6.dx + -0.025 * k7.dx);
    let ep = hh * (0.0012326388888888888 * k1.dp + -0.0042527702905061394 * k3.dp + 0.03697916666666667 * k4.dp + -0.05086379716981132 * k5.dp + 0.0419047619047619 * k6.dp + -0.025 * k7.dp);
    let err = errorNorm(y, ex, ep);
    if (err <= tol || it == 11 || h <= 1e-5) {
      out.s = y;
      out.d = d;
      out.k = k7;
      out.h = h;
      var grow = 5.0;
      if (err > 0.0) { grow = clamp(0.9 * pow(tol / err, 0.2), 0.2, 5.0); }
      out.hNext = h * grow;
      return out;
    }
    h *= clamp(0.9 * pow(tol / err, 0.2), 0.1, 0.9);
  }
  return out;
}

// Equatorial crossing inside a step s → n (affine step −h): the root of the cubic Hermite
// interpolant of θ(u) (end derivatives from the equations of motion) seeds one RK4 sub-step, then a
// Newton correction lands on θ = π/2. ~11 derivative evaluations instead of 56 for RK4 bisection.
fn equatorCrossing(s: GState, n: GState, d0: Deriv, d1: Deriv, L: f32, a: f32, h: f32) -> GState {
  let t0 = s.x.y - 0.5 * PI;
  let t1 = n.x.y - 0.5 * PI;
  let m0 = -h * d0.dx.y;
  let m1 = -h * d1.dx.y;
  var u = clamp(t0 / (t0 - t1), 0.0, 1.0);
  for (var k = 0; k < 6; k++) {
    let u2 = u * u;
    let u3 = u2 * u;
    let v = (2.0 * u3 - 3.0 * u2 + 1.0) * t0 + (u3 - 2.0 * u2 + u) * m0 + (-2.0 * u3 + 3.0 * u2) * t1 + (u3 - u2) * m1;
    let dv = (6.0 * u2 - 6.0 * u) * t0 + (3.0 * u2 - 4.0 * u + 1.0) * m0 + (-6.0 * u2 + 6.0 * u) * t1 + (3.0 * u2 - 2.0 * u) * m1;
    if (abs(dv) < 1e-12) { break; }
    u = clamp(u - v / dv, 0.0, 1.0);
  }
  var m = rk4(s, L, a, -h * u);
  let dm = geodesicRHS(m.x, m.p, L, a);
  if (abs(dm.dx.y) > 1e-9) {
    let dl = clamp((0.5 * PI - m.x.y) / dm.dx.y, -0.25 * h, 0.25 * h);
    m = rk4(m, L, a, dl);
  }
  return m;
}

// Adaptive affine step: resolves the horizon, the photon sphere (Δφ ≤ ε) and polar crossings.
fn stepSize(s: GState, L: f32, a: f32, eps: f32, rH: f32) -> f32 {
  let r = s.x.x;
  let sn = max(sin(s.x.y), 1e-6);
  let c = cos(s.x.y);
  let sig = r * r + a * a * c * c;
  var h = eps * (r - rH) * (1.0 + 0.01 * r);
  h = min(h, eps * sig * sn * sn / (abs(L) + 1e-3));
  h = min(h, eps * sig * max(sn, 0.02) / (abs(s.p.y) + 1e-3));
  let hr = P.ext2.z;
  if (hr > 0.0 && P.modes.w == 1u) {
    // volumetric disk: never jump over the layer |z| < 4H, sample it at ≲ 0.4 H
    let R = r * sn;
    if (R > P.bh.z * 0.8 && R < P.bh.w * 1.05) {
      let H = hr * R;
      let d = geodesicRHS(s.x, s.p, L, a);
      let zdot = abs(d.dx.x * c - r * sn * d.dx.y) + 1e-4;
      let dist = abs(r * c) - 4.0 * H;
      h = min(h, (max(dist, 0.0) + 0.4 * H) / zdot);
      if (dist < 0.0) { h = min(h, 0.08 * R); }
    }
  }
  if (P.jet.x > 0.5) {
    // Jet volume (R < 2.2 R_j, |z| < z_max): sample it at ≤ 0.3 R_j; outside, never step further
    // than ~the distance to its surface (coordinate speed ≈ 1 per unit affine parameter for E = 1).
    let az = abs(r * c);
    let zMax = P.jet2.x;
    let Rj = jetRadius(min(az, zMax), rH);
    let dR = r * sn - 2.2 * Rj;
    let dz = az - zMax;
    let dist = max(dR, dz);
    if (dist < 0.0) {
      h = min(h, max(0.3 * Rj, 0.05));
    } else {
      h = min(h, max(0.7 * dist, 0.3 * Rj));
    }
  }
  if (P.star.x > 0.5) {
    // never step over the star's atmosphere (3 R); sample it finely near the limb
    let pc = blCart(s.x);
    let d = length(pc - starCentre(P.time.x + s.x.w)) / P.star.z;
    let near = (0.03 + 0.12 * max(d - 1.0, 0.0)) * P.star.z;
    h = min(h, max(0.7 * (d - 4.0) * P.star.z, near));
    // a massive star bends the ray: steps small against the distance to it (kick accuracy)
    if (P.star2.z > 0.0) { h = min(h, max(0.3 * d * P.star.z, near)); }
  }
  if (P.wh.x > 0.5) {
    // the wormhole's weak field outside its gluing sphere: steps small against the distance to it
    let dm = length(blCart(s.x) - P.whC.xyz);
    h = min(h, max(0.3 * dm, 0.2 * P.wh2.z));
  }
  if (P.spot.x > 0.5) {
    // never step over the hot spot; sample it at ≤ 0.25 σ
    let dist = sqrt(spotDist2(s, P.time.x)) - 3.0 * P.spot.z - 0.5 * abs(P.ext.z);
    h = min(h, max(0.8 * dist, 0.25 * P.spot.z));
  }
  return max(h, 1e-5);
}

// Hot spot: a Gaussian blob on a circular Keplerian orbit (a flare, cf. GRAVITY's Sgr A* flares),
// positioned at the retarded time t_em = t_now + Δt along the ray, so every image of it (primary,
// secondary, photon ring) shows it where it was when that light left it.
// ---------------------------------------------------------------------------------------------
// The camera's predicted free fall, drawn as a thin glowing dashed tube around the polyline of the
// path. Tested against each step of the (curved, backward) ray, so it is lensed like everything else:
// behind the hole it shows its Einstein arcs and secondary images. Its radius grows with the distance
// travelled by the ray (constant apparent width, ~2 px); the emission of a crossing is the length of
// the chord inside the tube over its diameter (a soft profile). Not a physical emitter: no shifts.
// ---------------------------------------------------------------------------------------------
const PATH_MAX = 256u;
const PATH_CHUNK = 16u;

// Returns the glow (rgb) and, in w, the mean position of the crossings along the chord (0..1).
fn pathGlow(p0: vec3f, p1: vec3f, rayLen: f32) -> vec4f {
  let n = u32(P.path.x);
  var col = vec3f(0.0);
  var uSum = 0.0;
  var wSum = 0.0;
  let dv = p1 - p0;
  let len = length(dv);
  if (len < 1e-6) { return vec4f(0.0); }
  let R = max(P.path.y * (rayLen + 0.5 * len), 0.004);
  for (var c = 0u; c * PATH_CHUNK < n - 1u; c++) {
    // chord vs the chunk's bounding sphere (+ tube radius)
    let sph = pathPts[PATH_MAX + c];
    let w = sph.xyz - p0;
    let u = clamp(dot(w, dv) / (len * len), 0.0, 1.0);
    let dc = length(w - u * dv);
    if (dc > sph.w + R) { continue; }
    let i0 = c * PATH_CHUNK;
    let i1 = min(n - 1u, i0 + PATH_CHUNK);
    for (var i = i0; i < i1; i++) {
      let a = pathPts[i];
      let b = pathPts[i + 1u];
      let e = b.xyz - a.xyz;
      let L = length(e);
      if (L < 1e-6) { continue; }
      let eh = e / L;
      // distance to the segment's line, projected across it: |q0 + u qd|² = R²
      let w0 = p0 - a.xyz;
      let q0 = w0 - dot(w0, eh) * eh;
      let qd = dv - dot(dv, eh) * eh;
      let A = dot(qd, qd);
      if (A < 1e-12) { continue; }
      let B = dot(q0, qd);
      let C = dot(q0, q0) - R * R;
      let disc = B * B - A * C;
      if (disc <= 0.0) { continue; }
      let sq = sqrt(disc);
      let u1 = max((-B - sq) / A, 0.0);
      let u2 = min((-B + sq) / A, 1.0);
      if (u2 <= u1) { continue; }
      let along = dot(w0 + 0.5 * (u1 + u2) * dv, eh);
      if (along < 0.0 || along > L) { continue; }
      let t = mix(a.w, b.w, along / L); // fraction along the path
      let dash = select(0.25, 1.0, fract(t * 48.0) < 0.62);
      var tint = vec3f(0.25, 0.85, 1.4);
      if (P.path.z > 0.5 && P.path.z < 1.5) { tint = mix(tint, vec3f(1.6, 0.25, 0.15), smoothstep(0.8, 1.0, t)); }
      let wgt = min((u2 - u1) * len / (2.0 * R), 1.0);
      col += tint * dash * wgt * 0.9;
      uSum += 0.5 * (u1 + u2) * wgt;
      wSum += wgt;
    }
  }
  return vec4f(col, uSum / max(wSum, 1e-6));
}

// Companion star: an opaque sphere on a circular equatorial orbit (Keplerian Ω), evaluated at the
// emission time. Its photosphere is a limb-darkened blackbody with granulation; the frequency shift
// uses the orbital motion of its centre (rigid rotation Ω around the hole) at the point hit.
fn starCentre(tEm: f32) -> vec3f {
  let rs = P.star.y;
  let ph = P.star2.y + tEm * P.bary.y;
  return rs * vec3f(cos(ph), sin(ph), 0.0);
}

// First intersection of the chord p0 → p1 with a sphere (centre c, radius R), as a fraction (−1: none).
fn sphereHit(p0: vec3f, p1: vec3f, c: vec3f, R: f32) -> f32 {
  let dv = p1 - p0;
  let f = p0 - c;
  let cc = dot(f, f) - R * R;
  let A = dot(dv, dv);
  let B = dot(f, dv);
  if (cc <= 0.0) { return 0.0; } // starts inside
  let disc = B * B - A * cc;
  if (disc < 0.0 || B >= 0.0) { return -1.0; }
  let t = (-B - sqrt(disc)) / A;
  return select(-1.0, t, t <= 1.0);
}

// Surface pattern of the star, rotating with it: granulation cells, spots with penumbrae.
fn starSurface(nrm0: vec3f, tEm: f32) -> vec2f {
  let ang = tEm * 0.004;
  let cs = cos(ang);
  let sn = sin(ang);
  let nrm = vec3f(cs * nrm0.x - sn * nrm0.y, sn * nrm0.x + cs * nrm0.y, nrm0.z);
  let t = tEm * 0.01;
  // granulation: bright cells separated by dark lanes (ridged noise), two scales, slowly boiling
  let g1 = 1.0 - abs(gnoise(nrm * 22.0 + vec3f(0.0, 0.0, t)));
  let g2 = 1.0 - abs(gnoise(nrm * 60.0 + vec3f(t, 0.0, 0.0)));
  let sg = gnoise(nrm * 6.0 - vec3f(t, t, 0.0)); // supergranulation
  let gran = 0.78 + 0.2 * g1 * g1 * g1 + 0.07 * g2 + 0.06 * sg;
  // active regions at low latitudes: umbra / penumbra (cooler), faculae around them (hotter)
  let lat = 1.0 - smoothstep(0.25, 0.55, abs(nrm.z));
  let sp = (gnoise(nrm * 11.0 + vec3f(3.0, 1.0, 2.0)) + 0.35 * gnoise(nrm * 29.0)) * lat;
  let umbra = smoothstep(0.8, 0.88, sp);
  let penumbra = smoothstep(0.68, 0.8, sp);
  let fac = smoothstep(0.3, 0.48, sp) * (1.0 - penumbra);
  let tf = mix(1.0, 0.88, penumbra) * mix(1.0, 0.8, umbra) * (1.0 + 0.05 * fac);
  return vec2f(gran, tf);
}

fn starShift(n: GState, L: f32, E0: f32) -> f32 {
  let a = P.bh.x;
  let om = P.bary.y;
  if (P.modes.y == SHIFT_NONE) { return 1.0; }
  // the light also climbs out of the star's own potential: × (1 + Φ★) = 1 − m/d
  let dS = length(blCart(n.x) - starCentre(P.time.x + n.x.w));
  let gS = 1.0 - P.star2.z / max(dS, P.star.z);
  return gS * (1.0 / E0) / circularEmitterEnergy(max(n.x.x, 1.01 * P.bh.y), n.x.y, a, L, om);
}

// Mass of the star (m = P.star2.z): the linearized field of a moving mass,
// h_μν = −2Φ (η_μν + 2 u_μ u_ν) with Φ = −m/d (d measured in the star's rest frame), added to the
// Kerr metric in its flat far-field map. For a photon (p_t = −1) δH = −½ h^μν p_μ p_ν
// = 2Φ γ² (1 − v·p)²: the deflection is 4m/b (twice Newton's) × (1 − v∥) for a star moving along
// the line of sight (Pyne & Birkinshaw 1993). Returns ∂δH/∂(r, θ, φ), which kicks p_r, p_θ and L (no
// longer conserved near the star); `back`: unit direction of the backward ray (p̂ = −back).
fn starForce(x: vec4f, back: vec3f) -> vec3f {
  let st = sin(x.y);
  let ct = cos(x.y);
  let sp = sin(x.z);
  let cp = cos(x.z);
  let er = vec3f(st * cp, st * sp, ct);
  let tEm = P.time.x + x.w;
  let c = starCentre(tEm);
  let v = P.bary.y * vec3f(-c.y, c.x, 0.0);
  let g2 = 1.0 / (1.0 - dot(v, v));
  let dv = x.x * er - c;
  let dvv = dot(dv, v);
  let d2 = max(dot(dv, dv) + g2 * dvv * dvv, P.star.z * P.star.z); // rest-frame distance²
  let k = 1.0 + dot(v, back);                                      // 1 − v·p̂
  var g = (2.0 * P.star2.z * g2 * k * k) * (dv + g2 * dvv * v) / (d2 * sqrt(d2)); // ∇δH
  // The hole's frame falls towards the star (Gargantua orbits the centre of mass) with
  // a = m x★/D³: the uniform "indirect" field, g_tt = −(1 + 2a·x), δH = a·x for light.
  let D = length(c);
  g += (P.star2.z / (D * D * D)) * c;
  return vec3f(dot(g, er), x.x * dot(g, vec3f(ct * cp, ct * sp, -st)), x.x * st * dot(g, vec3f(-sp, cp, 0.0)));
}

// The wormhole's own mass seen from outside its gluing sphere: the Dneg metric (g_tt = −1) is, far
// from the throat, the spatial part of a Schwarzschild field of mass M_w (r ≈ ℓ − M_w ln ℓ, so
// dr/dℓ ≈ 1 − M_w/r): light is bent by 2M_w/b, from δH = Φ|p|² = Φ with Φ = −M_w/d (spatial
// perturbation only). Keeps the bending continuous across the gluing sphere. ∂δH/∂(r, θ, φ).
fn mouthForce(x: vec4f) -> vec3f {
  let st = sin(x.y);
  let ct = cos(x.y);
  let sp = sin(x.z);
  let cp = cos(x.z);
  let er = vec3f(st * cp, st * sp, ct);
  let dv = x.x * er - P.whC.xyz;
  let d2 = max(dot(dv, dv), P.wh2.z * P.wh2.z);
  let g = (P.wh.w / (d2 * sqrt(d2))) * dv;
  return vec3f(dot(g, er), x.x * dot(g, vec3f(ct * cp, ct * sp, -st)), x.x * st * dot(g, vec3f(-sp, cp, 0.0)));
}

// Photosphere: the emergent temperature falls towards the limb, T(μ) = T (0.2 + 0.8 μ)^¼ (steeper
// than a grey atmosphere, as the visible continuum of the Sun), which gives both the limb darkening
// and the redder limb: a white-hot centre fading to orange and red.
fn shadeStar(X: vec3f, c: vec3f, n: GState, L: f32, E0: f32, dW: vec3f, tEm: f32) -> vec3f {
  let nrm = normalize(X - c);
  let mu = clamp(-dot(nrm, dW), 0.0, 1.0);
  let surf = starSurface(nrm, tEm);
  let T = P.star.w * pow(0.2 + 0.8 * mu, 0.25) * surf.y;
  return blackbody(T * starShift(n, L, E0), P.disk.w) * P.star2.x * surf.x;
}

// Optically thin atmosphere above the photosphere (emission per unit length): the pink chromosphere
// rim, prominences (Hα loops standing on the limb) and the white K-corona with radial streamers.
fn starGlow(p: vec3f, c: vec3f, g: f32, tEm: f32) -> vec3f {
  let R = P.star.z;
  let dv = p - c;
  let d = length(dv);
  let h = d / R - 1.0; // height above the photosphere, in stellar radii
  if (h < 0.0 || h > 3.0) { return vec3f(0.0); }
  let dir = dv / d;
  let t = tEm * 0.003;
  let Is = luminance(blackbody(P.star.w * g, P.disk.w)) * P.star2.x;
  // corona: steep falloff, streamers along the field lines (angular noise, stretched radially)
  let st = gnoise(dir * 3.2 + vec3f(t, 0.0, 0.0)) + 0.5 * gnoise(dir * 9.0 - vec3f(0.0, t, 0.0));
  let streamers = 0.35 + 1.4 * smoothstep(-0.2, 0.9, st);
  let corona = pow(1.0 / (1.0 + h), 7.0) * streamers;
  // chromosphere: thin bright shell
  let chrom = exp(-h / 0.03);
  // prominences: ridged filaments on a few active longitudes, arching up to ~0.4 R
  let loopN = 1.0 - abs(gnoise(dir * 6.0 + vec3f(0.0, 0.0, h * 4.0 + t)));
  let region = smoothstep(0.15, 0.45, gnoise(dir * 1.7 + vec3f(7.0, 3.0, 1.0)));
  let prom = smoothstep(0.86, 0.97, loopN) * region * exp(-h / 0.14);
  let halpha = shiftRatio(3000.0, g) * vec3f(1.0, 0.25, 0.32);
  let white = blackbodyShifted(6500.0, g) / max(luminance(blackbodyShifted(6500.0, 1.0)), 1e-6);
  return Is / R * (white * corona * 0.12 + halpha * (chrom * 0.6 + prom * 2.0));
}

fn spotCentre(tEm: f32) -> vec3f {
  let a = P.bh.x;
  let rs = P.spot.y;
  let om = 1.0 / (pow(rs, 1.5) + a);
  let ph = P.spot2.z + om * tEm;
  let R = sqrt(rs * rs + a * a);
  return vec3f(R * cos(ph), R * sin(ph), P.spot2.w);
}

// Squared distance to the spot centre (Kerr–Schild-like Cartesian coordinates).
fn spotDist2(s: GState, tNow: f32) -> f32 {
  let r = s.x.x;
  let sn = sin(s.x.y);
  let R = sqrt(r * r + P.bh.x * P.bh.x) * sn;
  let p = vec3f(R * cos(s.x.z), R * sin(s.x.z), r * cos(s.x.y));
  let d = p - spotCentre(tNow + s.x.w);
  return dot(d, d);
}

struct SpotSample { S: vec3f, dtau: f32 };

fn spotSample(s: GState, L: f32, E0: f32, dl: f32, tNow: f32) -> SpotSample {
  var o: SpotSample;
  let sig = P.spot.z;
  let d2 = spotDist2(s, tNow);
  if (d2 > 16.0 * sig * sig) { return o; }
  let a = P.bh.x;
  // rigid rotation with the orbital angular velocity of the centre
  let om = 1.0 / (pow(P.spot.y, 1.5) + a);
  let kEm = circularEmitterEnergy(s.x.x, s.x.y, a, L, om);
  var g = (1.0 / E0) / kEm;
  if (P.modes.y == SHIFT_NONE) { g = 1.0; }
  o.dtau = P.spot.w * 0.3989423 / sig * exp(-0.5 * d2 / (sig * sig)) * kEm * dl;
  o.S = blackbody(P.spot2.x * g, P.disk.w) * P.spot2.y;
  return o;
}

// Parabolic jet boundary R_j ∝ z^0.6 anchored on the horizon (Blandford–Znajek field lines,
// cf. the M87 jet profile z ∝ R^1.7).
fn jetRadius(az: f32, rH: f32) -> f32 {
  return 0.5 * rH * P.jet.z * pow(max(az / rH, 1.0), 0.6);
}

// Keep θ in (0, π): a geodesic crossing the axis re-enters on the other side (φ + π).
fn wrapPole(s0: GState) -> GState {
  var s = s0;
  if (s.x.y < 0.0) { s.x.y = -s.x.y; s.p.y = -s.p.y; s.x.z += PI; }
  if (s.x.y > PI) { s.x.y = TAU - s.x.y; s.p.y = -s.p.y; s.x.z += PI; }
  return s;
}

// Metric pieces used for 4-velocities of emitters.
struct Metric { gtt: f32, gtp: f32, gpp: f32, sig: f32, del: f32, A: f32 };
fn kerrMetric(r: f32, th: f32, a: f32) -> Metric {
  let s = sin(th);
  let c = cos(th);
  let s2 = s * s;
  var m: Metric;
  m.sig = r * r + a * a * c * c;
  m.del = r * r - 2.0 * r + a * a;
  m.A = (r * r + a * a) * (r * r + a * a) - a * a * m.del * s2;
  m.gtt = -(1.0 - 2.0 * r / m.sig);
  m.gtp = -2.0 * a * r * s2 / m.sig;
  m.gpp = m.A * s2 / m.sig;
  return m;
}

// Photon energy measured by an emitter in circular motion with angular velocity Ω:
// −p·u = u^t (1 − Ω L), E = 1. Falls back to the ZAMO (Ω = ω) if Ω is not timelike.
fn circularEmitterEnergy(r: f32, th: f32, a: f32, L: f32, omega: f32) -> f32 {
  let m = kerrMetric(r, th, a);
  var om = omega;
  var den = -(m.gtt + 2.0 * m.gtp * om + m.gpp * om * om);
  if (den <= 1e-6) {
    om = 2.0 * a * r / m.A;
    den = -(m.gtt + 2.0 * m.gtp * om + m.gpp * om * om);
  }
  let ut = inverseSqrt(max(den, 1e-12));
  return ut * (1.0 - om * L);
}

fn zamoEnergy(r: f32, th: f32, a: f32, L: f32) -> f32 {
  let m = kerrMetric(r, th, a);
  let om = 2.0 * a * r / m.A;
  let alpha = sqrt(max(m.sig * m.del / m.A, 1e-12));
  return (1.0 - om * L) / alpha;
}

// ---------------------------------------------------------------------------------------------
// Novikov–Thorne thin disk (Page & Thorne 1974), flux up to a constant.
// ---------------------------------------------------------------------------------------------
fn ntTerm(x: f32, x0: f32, xi: f32, xj: f32, xk: f32, a: f32) -> f32 {
  if (abs(xi) < 1e-5) { return 0.0; }
  return 3.0 * (xi - a) * (xi - a) / (xi * (xi - xj) * (xi - xk)) * log((x - xi) / (x0 - xi));
}
fn ntFlux(r: f32, a: f32, rIn: f32) -> f32 {
  if (r <= rIn) { return 0.0; }
  let x = sqrt(r);
  let x0 = sqrt(rIn);
  let ac = acos(clamp(a, -1.0, 1.0));
  let x1 = 2.0 * cos((ac - PI) / 3.0);
  let x2 = 2.0 * cos((ac + PI) / 3.0);
  let x3 = -2.0 * cos(ac / 3.0);
  let br = x - x0 - 1.5 * a * log(x / x0)
    - ntTerm(x, x0, x1, x2, x3, a) - ntTerm(x, x0, x2, x1, x3, a) - ntTerm(x, x0, x3, x1, x2, a);
  return max(br, 0.0) / (x * x * x * x * (x * x * x - 3.0 * x + 2.0 * a));
}

// Gradient (Perlin) noise in [−1, 1], quintic fade: smoother and less grid-aligned than value noise.
fn gnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var n: array<f32, 8>;
  for (var c = 0u; c < 8u; c++) {
    let o = vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u));
    let h = hash3u(bitcast<vec3u>(vec3i(i + o)));
    let g = vec3f(f32(h & 0x3ffu), f32((h >> 10u) & 0x3ffu), f32((h >> 20u) & 0x3ffu)) * (2.0 / 1023.0) - 1.0;
    n[c] = dot(g, f - o);
  }
  return 1.6 * mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y),
                   mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z);
}

// MRI-like turbulence of the disk, advected with the Keplerian flow. Structures are anisotropic
// and follow trailing logarithmic spirals (pitch ≈ 25°, as the shear of differential rotation
// produces), with clumps plus thin ridged filaments. Two phases, cross-faded over the flow period,
// so the pattern shears with the differential rotation but never winds up forever (flow-map
// advection; a radius-dependent period would create radial phase bands). Evaluated at the retarded time t_em: moving structure is seen where it
// was when the light left it.
fn diskTurbulence(r: f32, phi: f32, tEm: f32, a: f32, zn: f32) -> f32 {
  let omega = 1.0 / (pow(r, 1.5) + a);
  let period = P.time.y;
  let lr = log(r);
  var acc = 0.0;
  for (var k = 0; k < 2; k++) {
    let ph = tEm / period + f32(k) * 0.5;
    let cyc = floor(ph);
    let fr = ph - cyc;
    let w = 1.0 - abs(2.0 * fr - 1.0);
    let seed = cyc * 13.37 + f32(k) * 71.3;
    let ang = phi - omega * fr * period;
    // trailing log-spiral coordinate: constant along arms that lag outward
    let sp = ang + lr * 2.1;
    let across = vec2f(cos(sp), sin(sp));
    // large patches and voids (low frequency), mid-scale clumps, thin ridged filaments along arms
    let qb = vec3f(across * 1.3, lr * 2.2 + seed * 0.7) + vec3f(zn * 0.2);
    let big = 0.5 + 0.5 * (0.62 * gnoise(qb) + 0.28 * gnoise(qb * 2.03 + vec3f(5.1)) + 0.1 * gnoise(qb * 4.1 + vec3f(1.3)));
    var clumps = 0.0;
    var amp = 0.5;
    var q = vec3f(across * 2.4, lr * 4.0 + seed) + vec3f(0.0, zn * 0.35, zn * 0.25);
    for (var o = 0; o < 4; o++) {
      clumps += amp * gnoise(q);
      q = q * vec3f(2.07, 2.07, 1.9) + vec3f(1.7, 9.2, 3.1);
      amp *= 0.5;
    }
    let rq = vec3f(across * 6.5, lr * 3.0 + seed * 1.7 + zn * 0.4);
    let ridge = 1.0 - abs(gnoise(rq) + 0.5 * gnoise(rq * 2.1 + vec3f(3.3)));
    let patches = smoothstep(0.22, 0.78, big);
    acc += w * (0.12 + 0.88 * patches) * max(0.5 + 0.5 * clumps + 0.4 * (ridge * ridge * ridge - 0.3), 0.0);
  }
  return clamp(1.7 * acc, 0.0, 1.0);
}

struct DiskHit { color: vec3f, trans: f32, g: f32, T: f32 };

fn shadeDisk(s: GState, L: f32, E0: f32, tNow: f32) -> DiskHit {
  let a = P.bh.x;
  let r = s.x.x;
  let rIn = P.bh.z;
  let rOut = P.bh.w;
  let omega = 1.0 / (pow(r, 1.5) + a);
  let kEm = circularEmitterEnergy(r, PI * 0.5, a, L, omega); // −p·u of the gas
  let gFull = (1.0 / E0) / kEm;
  var g = gFull;
  let shift = P.modes.y;
  if (shift == SHIFT_GRAV_ONLY) { g = (1.0 / E0) / zamoEnergy(r, PI * 0.5, a, L); }
  if (shift == SHIFT_NONE) { g = 1.0; }

  var T = P.disk.x * pow(max(ntFlux(r, a, rIn) / P.disk.y, 0.0), 0.25);
  // soft outer edge
  let edge = 1.0 - smoothstep(rOut * 0.8, rOut, r);
  // Vertical (grey) optical depth of the slab; turbulence modulates both the heating and the
  // column density, opening optically thin gaps between clumps.
  var tau = P.misc.w * edge;
  let turb = P.disk.z;
  if (turb > 0.0) {
    let n = diskTurbulence(r, s.x.z, tNow + s.x.w, a, 0.0);
    T *= mix(1.0, 0.6 + 0.8 * n, turb);
    tau *= mix(1.0, 0.08 + 2.4 * n * n, turb);
  }

  // Limb darkening of an electron-scattering atmosphere (Chandrasekhar): I ∝ 1 + 2.06 μ,
  // μ = cos(emission angle) in the fluid frame = |p_θ| / (√Σ · (−p·u)).
  let mu = clamp(abs(s.p.y) / (r * kEm), 1e-3, 1.0);
  let limb = mix(1.0, (1.0 + 2.06 * mu) / 2.373, P.misc.x);
  // Emergent intensity of an LTE slab crossed at angle μ: I = S (1 − e^(−τ/μ)), transmitted e^(−τ/μ).
  // Grey absorption: τ is frequency independent, hence Lorentz invariant along the ray.
  let trans = exp(-tau / mu);

  var col: vec3f;
  if (P.misc.y > 0.5) {
    // Bolometric rendering (Luminet 1979 style): I_obs = g⁴ σT⁴/π, colour of a blackbody at g·T.
    let t = T / P.disk.x;
    var boost = g * g * g * g;
    if (shift == SHIFT_NO_BEAMING) { boost = 1.0; }
    col = bbLookup(T * g).rgb * (t * t * t * t) * boost;
  } else if (shift == SHIFT_NO_BEAMING) {
    // colour of g·T, radiance of the unshifted emitter
    col = bbLookup(T * g).rgb * exp2((bbLookup(T).a - P.disk.w) * 3.32192809489);
  } else {
    col = blackbody(T * g, P.disk.w);
  }
  var hit: DiskHit;
  hit.color = col * limb * (1.0 - trans) * P.misc.z;
  hit.trans = trans;
  hit.g = g;
  hit.T = T;
  return hit;
}

// Returning radiation (Cunningham 1976): light emitted by the disk that the hole bends back onto
// the disk. At a disk hit, one incoming direction is drawn from a cosine distribution about the
// surface normal in the gas frame (Monte Carlo estimate of the Lambertian integral); the photon
// that arrives from it is traced back (no recursion: a second, simpler march) to the disk element
// that emitted it. That light is a blackbody at g₁₂T₂ in the local gas frame (g₁₂ from the two
// emitters' energies) and is re-emitted with albedo A, then seen by the camera at g·g₁₂T₂.
// Only compiled into the quality pipeline.
fn returningRadiation(m: GState, side: f32, g1: f32, tNow: f32, u: vec2f) -> vec3f {
  let a = P.bh.x;
  let rH = P.bh.y;
  let r = m.x.x;
  let mt = kerrMetric(r, PI * 0.5, a);
  let alpha = sqrt(max(mt.sig * mt.del / mt.A, 1e-12));
  let omega = 2.0 * a * r / mt.A;
  let varpi = sqrt(mt.A / mt.sig);
  let v = clamp(varpi * (1.0 / (pow(r, 1.5) + a) - omega) / alpha, -0.99, 0.99);
  let gam = inverseSqrt(1.0 - v * v);
  // incoming direction nIn (r̂, θ̂, φ̂) on the observer's side; θ̂ points to −z at the equator
  let N = vec3f(0.0, -side, 0.0);
  let ph = TAU * u.y;
  let nIn = sqrt(1.0 - u.x) * N + sqrt(u.x) * vec3f(cos(ph), 0.0, sin(ph));
  // the photon travels along −nIn with unit energy in the gas frame → ZAMO frame → BL, E = 1 units
  let kp = -nIn;
  let Ez = gam * (1.0 + v * kp.z);
  let kz = vec3f(kp.x, kp.y, gam * (kp.z + v));
  let E = alpha * Ez + omega * varpi * kz.z;
  if (E <= 1e-6) { return vec3f(0.0); }
  var s: GState;
  s.x = m.x;
  s.p = vec2f(sqrt(mt.sig / max(mt.del, 1e-9)) * kz.x / E, sqrt(mt.sig) * kz.y / E);
  let L = varpi * kz.z / E;
  let rIn = P.bh.z;
  let rOut = P.bh.w;
  let rEsc = P.integ.z;
  let maxSteps = u32(P.ret.z);
  let eps = P.integ.x * 3.0;
  for (var i = 0u; i < maxSteps; i++) {
    let h = stepSize(s, L, a, eps, rH);
    let n = wrapPole(rk4(s, L, a, -h));
    if (i > 0u && cos(s.x.y) * cos(n.x.y) < 0.0 && n.x.y == n.x.y) {
      let m2 = equatorCrossing(s, n, geodesicRHS(s.x, s.p, L, a), geodesicRHS(n.x, n.p, L, a), L, a, h);
      let rc = m2.x.x;
      if (rc >= rIn && rc <= rOut) {
        let hit = shadeDisk(m2, L, E, tNow); // blackbody at g₁₂T₂ in the frame of gas 1
        return hit.color * shiftRatio(max(hit.T * hit.g, 100.0), g1);
      }
    }
    let rn = n.x.x;
    if (rn < rH + P.integ.w || isNan(rn)) { return vec3f(0.0); }
    if (rn > rEsc && rn > s.x.x) { return vec3f(0.0); } // the sky's light is negligible
    s = n;
  }
  return vec3f(0.0);
}

// Volumetric Novikov–Thorne disk: Gaussian vertical profile of scale height H = (H/R)·R with
// vertical optical depth τ₀; LTE source B(g T(R)); gas on Keplerian orbits at cylindrical R.
// Front-to-back transfer: I += T·S·(1 − e^{−dτ}), T *= e^{−dτ}, dτ = κρ ds, ds = (−p·u) dλ.
struct DiskSample { S: vec3f, dtau: f32, g: f32, T: f32 };

fn diskVolume(s: GState, L: f32, E0: f32, dl: f32, tNow: f32) -> DiskSample {
  var o: DiskSample;
  o.dtau = 0.0;
  let a = P.bh.x;
  let r = s.x.x;
  let th = s.x.y;
  let R = r * sin(th);
  let z = r * cos(th);
  let rIn = P.bh.z;
  let rOut = P.bh.w;
  let H = P.ext2.z * R;
  if (R < rIn * 0.85 || R > rOut || abs(z) > 4.0 * H) { return o; }
  let zn = z / H;
  var rho = exp(-0.5 * zn * zn) * 0.3989423 / H;
  rho *= smoothstep(rIn * 0.85, rIn * 1.03, R) * (1.0 - smoothstep(rOut * 0.8, rOut, R));
  var T = P.disk.x * pow(max(ntFlux(max(R, rIn), a, rIn) / P.disk.y, 0.0), 0.25);
  let turb = P.disk.z;
  if (turb > 0.0) {
    let n = diskTurbulence(R, s.x.z, tNow + s.x.w, a, zn);
    T *= mix(1.0, 0.6 + 0.8 * n, turb);
    rho *= mix(1.0, 0.05 + 2.6 * n * n, turb);
  }
  if (rho < 1e-6) { return o; }
  let omega = 1.0 / (pow(max(R, 1.0), 1.5) + a);
  let kEm = circularEmitterEnergy(r, th, a, L, omega);
  var g = (1.0 / E0) / kEm;
  let shift = P.modes.y;
  if (shift == SHIFT_GRAV_ONLY) { g = (1.0 / E0) / zamoEnergy(r, th, a, L); }
  if (shift == SHIFT_NONE) { g = 1.0; }
  if (P.misc.y > 0.5) {
    let t = T / P.disk.x;
    var boost = g * g * g * g;
    if (shift == SHIFT_NO_BEAMING) { boost = 1.0; }
    o.S = bbLookup(T * g).rgb * (t * t * t * t) * boost;
  } else if (shift == SHIFT_NO_BEAMING) {
    o.S = bbLookup(T * g).rgb * exp2((bbLookup(T).a - P.disk.w) * 3.32192809489);
  } else {
    o.S = blackbody(T * g, P.disk.w);
  }
  o.S *= P.misc.z;
  o.dtau = P.misc.w * rho * kEm * dl;
  o.g = g;
  o.T = T;
  return o;
}

// Optically thin, geometrically thick hot flow: j_ν ∝ ρ ν^−α, sub-Keplerian rotation.
// Invariant transfer: dI_ν,obs = g^(3+α) ρ ν_obs^−α (−p·u) dλ, with g = ν_obs/ν_em.
fn volumeEmission(s: GState, L: f32, E0: f32, dl: f32) -> vec3f {
  let a = P.bh.x;
  let r = s.x.x;
  let th = s.x.y;
  let R = r * sin(th);
  let z = r * cos(th);
  let H = max(P.vol.y * R, 0.05);
  let rIn = P.bh.y;
  // emissivity ∝ r⁻³ (n ∝ r^-1.5, B² ∝ r^-1.5 in a radiatively inefficient flow), truncated outside rc
  let rc = max(6.0, P.bh.w * 0.4);
  let rho = 30.0 * exp(-0.5 * (z * z) / (H * H)) / (r * r * r) * smoothstep(rIn, rIn * 1.4, r)
    * exp(-(r * r) / (rc * rc));
  if (rho < 1e-7) { return vec3f(0.0); }
  let omega = 0.9 / (pow(max(R, 1.0), 1.5) + a);
  let kEm = circularEmitterEnergy(r, th, a, L, omega);
  var g = (1.0 / E0) / kEm;
  if (P.modes.y == SHIFT_NONE) { g = 1.0; }
  // colour = CIE integral of ν^-α (precomputed); I_obs = g^{3+α} j(ν_obs)
  return P.volColor.rgb * pow(g, 3.0 + P.vol.z) * rho * kEm * dl * P.vol.w;
}

// Relativistic jet: optically thin synchrotron plasma flowing outwards along the spin axis with
// bulk speed β measured by the local ZAMO. Emissivity per band j_ν ∝ n ν^{1/3} e^{−ν/ν_c} in the
// fluid frame; observed with dI = g³ j(ν_obs/g) (−p·u) dλ, so Doppler boosting of the approaching
// jet, de-boosting and reddening of the counter-jet and apparent superluminal knot motion (via the
// retarded time t_em) all follow from the geodesics.
struct JetSample { n: f32, g: f32, k: f32 }; // emitter density, g = ν_obs/ν_em, −p·u

fn jetEmission(s: GState, L: f32, E0: f32, dl: f32, tNow: f32) -> vec3f {
  let j = jetSample(s, L, E0, tNow);
  if (j.n <= 0.0) { return vec3f(0.0); }
  // I_obs = g³ j(ν/g) = g^{8/3} x^{1/3} e^{−x/(g ν_c)}: colour from the CIE-integrated LUT
  return syncColor(j.g * P.jet2.y) * pow(j.g, 8.0 / 3.0) * j.n * j.k * dl * P.jet.w;
}

fn jetSample(s: GState, L: f32, E0: f32, tNow: f32) -> JetSample {
  var o: JetSample;
  let a = P.bh.x;
  let rH = P.bh.y;
  let r = s.x.x;
  let th = s.x.y;
  let sn = sin(th);
  let z = r * cos(th);
  let az = abs(z);
  let R = r * sn;
  let zMax = P.jet2.x;
  if (az < rH * 1.05 || az > zMax) { return o; }
  let Rj = jetRadius(az, rH);
  let x = R / Rj;
  if (x > 2.2) { return o; }

  // limb-brightened sheath + fainter spine (as in VLBI images of M87), diluted ∝ R_j^-1.5
  let sheath = exp(-pow((x - 0.75) / 0.22, 2.0));
  let spine = 0.25 * exp(-3.0 * x * x);
  let base = smoothstep(rH * 1.1, rH * 3.0, az) * (1.0 - smoothstep(0.5 * zMax, zMax, az));
  var n = (sheath + spine) * base * 4.0 * pow(Rj, -1.5);

  // Structure advected with the flow — a function of (z − β t_em) so it moves at the bulk speed:
  // helical magnetic filaments along the flow + internal shocks (knots) with growing spacing.
  let beta = P.jet.y;
  let tEm = tNow + s.x.w;
  let side = select(-1.0, 1.0, z > 0.0);
  let u = az - beta * tEm;
  let twist = s.x.z - 0.8 * log(1.0 + az / rH) * side;
  let fil = fbm(vec3f(cos(twist) * x * 2.2, sin(twist) * x * 2.2, u / (6.0 + 0.8 * Rj) + side * 17.0), 4);
  let lambda = 6.0 + 0.9 * Rj;
  let shockPhase = u / lambda + 1.5 * fbm(vec3f(x * 0.7, u / (3.0 * lambda), side * 5.0), 3);
  // shocks are patchy (oblique, partially filled fronts), not clean rings
  let shock = pow(0.5 + 0.5 * sin(TAU * shockPhase), 10.0) * smoothstep(0.25, 0.75, fil);
  n *= mix(1.0, 0.15 + 1.5 * fil * fil + 2.2 * shock, P.jet2.z);
  if (n < 1e-6) { return o; }

  // Photon energy in the fluid frame: boost of the ZAMO measurement along r̂.
  let m = kerrMetric(r, th, a);
  let alpha = sqrt(max(m.sig * m.del / m.A, 1e-12));
  let omega = 2.0 * a * r / m.A;
  let Ez = (1.0 - omega * L) / alpha;
  let pr = sqrt(max(m.del / m.sig, 0.0)) * s.p.x; // p^(r̂) in the ZAMO frame
  let gam = inverseSqrt(max(1.0 - beta * beta, 1e-6));
  let k = gam * (Ez - beta * pr);
  var g = (1.0 / E0) / max(k, 1e-6);
  if (P.modes.y == SHIFT_NONE) { g = 1.0; }
  o.n = n;
  o.g = g;
  o.k = k;
  return o;
}

// ---------------------------------------------------------------------------------------------
// Radio (millimetre) band: thermal synchrotron with self-absorption, three frequencies at once
// ---------------------------------------------------------------------------------------------
// Transfer in brightness temperature at each observed frequency ν (Rayleigh–Jeans), with Kirchhoff's
// law j_ν = α_ν B_ν(T_e) in the gas frame and the invariance of I_ν/ν³:
//     dT_b/ds = α_ν(ν/g) · (g T_e − T_b),   ds = (−p·u) dλ
// so the observed brightness temperature relaxes towards the Doppler-shifted electron temperature.
// Absorption coefficient of a relativistic thermal plasma (Mahadevan+ 1996, Leung+ 2011 fit):
//     α_ν ∝ n θ_e⁻³ K(X)/ν,  K(X) = (√X + 2^{11/12} X^{1/6})² e^{−X^{1/3}},  X = ν/ν_s,  ν_s ∝ θ_e² B
// with a radiatively inefficient flow: n ∝ r^−1.1, θ_e ∝ r^−0.84, B ∝ r^−1, scale height H/R.
const RADIO_NU = vec3f(86.0 / 230.0, 1.0, 345.0 / 230.0); // observed frequencies / 230 GHz
const RADIO_R0 = 4.0; // reference radius of the normalisation [M]

fn synchK(X: f32) -> f32 {
  let x6 = pow(max(X, 1e-8), 1.0 / 6.0);
  let t = x6 * x6 * x6 + 1.8877 * x6;
  return t * t * exp(-x6 * x6);
}

struct RadioSample { alpha: vec3f, S: f32, dens: f32 };

// P.radio: mode (1 = 230 GHz, 2 = 86/230/345 GHz), τ₂₃₀ scale, ν_s(R0)/230 GHz, θ_e(R0);
// P.radio2: jet radio scale, H/R of the flow, 0, 0
fn radioFlow(s: GState, L: f32, E0: f32) -> RadioSample {
  var o: RadioSample;
  let a = P.bh.x;
  let r = s.x.x;
  let th = s.x.y;
  let R = r * sin(th);
  let z = r * cos(th);
  let H = max(P.radio2.y * R, 0.05);
  let rH = P.bh.y;
  let rc = 10.0; // outer taper of the compact flow [M]
  let q = r / RADIO_R0;
  let dens = exp(-0.5 * z * z / (H * H)) * pow(q, -1.1) * smoothstep(rH, rH * 1.25, r) * exp(-(r * r) / (rc * rc));
  if (dens < 1e-5) { return o; }
  let om = 0.9 / (pow(max(R, 1.0), 1.5) + a);
  let kEm = circularEmitterEnergy(r, th, a, L, om);
  var g = (1.0 / E0) / kEm;
  if (P.modes.y == SHIFT_NONE) { g = 1.0; }
  let thetaRel = pow(q, -0.84);                 // θ_e / θ_e(R0)
  let xs = P.radio.z * thetaRel * thetaRel / q; // ν_s / 230 GHz
  let xEm = RADIO_NU / g;
  let kRef = synchK(1.0 / P.radio.z);
  let X = xEm / xs;
  let K = vec3f(synchK(X.x), synchK(X.y), synchK(X.z));
  // normalised so that the vertical optical depth at 230 GHz through the flow at R0 is ≈ P.radio.y
  let tauScale = P.radio.y / (2.5066 * max(P.radio2.y * RADIO_R0, 0.05));
  o.alpha = tauScale * dens / (thetaRel * thetaRel * thetaRel) * (K / kRef) / xEm * kEm;
  o.S = g * P.radio.w * 0.593 * thetaRel;       // g·T_e in units of 10¹⁰ K
  o.dens = dens;
  return o;
}

// ---------------------------------------------------------------------------------------------
// Polarization: Walker–Penrose constant
// ---------------------------------------------------------------------------------------------
// For a photon k and a polarization vector f ⟂ k parallel-transported along a Kerr null geodesic,
// κ = (A − iB)(r − i a cos θ) is conserved (Walker & Penrose 1970, Chandrasekhar 1983):
//   A = (k^t f^r − k^r f^t) + a sin²θ (k^r f^φ − k^φ f^r)
//   B = [(r² + a²)(k^φ f^θ − k^θ f^φ) − a (k^t f^θ − k^θ f^t)] sin θ
// So the polarization emitted anywhere along the ray is transported to the camera for free: at the
// camera we solve κ_em = c_x κ(e_x) + c_y κ(e_y) for the screen components of f — exact for any
// observer position and motion (no distant-observer approximation). Vectors are (t, r, θ, φ).
fn wpKappa(r: f32, th: f32, a: f32, k: vec4f, f: vec4f) -> vec2f {
  let sn = sin(th);
  let cs = cos(th);
  let A = (k.x * f.y - k.y * f.x) + a * sn * sn * (k.y * f.w - k.w * f.y);
  let B = ((r * r + a * a) * (k.w * f.z - k.z * f.w) - a * (k.x * f.z - k.z * f.x)) * sn;
  return vec2f(A * r - B * a * cs, -(A * a * cs + B * r));
}

// ZAMO-frame components (t̂, r̂, θ̂, φ̂) → Boyer–Lindquist contravariant components (t, r, θ, φ).
fn zamoToBL(r: f32, th: f32, a: f32, v: vec4f) -> vec4f {
  let m = kerrMetric(r, th, a);
  let alpha = sqrt(max(m.sig * m.del / m.A, 1e-12));
  let omega = 2.0 * a * r / m.A;
  let varpi = max(sqrt(m.A / m.sig) * sin(th), 1e-6);
  return vec4f(v.x / alpha, sqrt(max(m.del / m.sig, 0.0)) * v.y, v.z / sqrt(m.sig), omega * v.x / alpha + v.w / varpi);
}

// Contravariant photon momentum (t, r, θ, φ) from the equations of motion.
fn photonK(s: GState, L: f32, a: f32) -> vec4f {
  let d = geodesicRHS(s.x, s.p, L, a);
  return vec4f(d.dx.w, d.dx.x, d.dx.y, d.dx.z);
}

// Polarization of radiation leaving gas with ZAMO-frame velocity `vel` (r̂, θ̂, φ̂): photon direction
// n' in the gas frame, E-vector f' ∝ n' × b (b: magnetic field for synchrotron, surface normal for
// electron scattering), boosted back and expressed in BL. w = |n' × b|, mu = |n'·b|.
struct PolEmit { kappa: vec2f, w: f32, mu: f32 };

fn emitterPolarization(s: GState, L: f32, a: f32, vel: vec3f, b: vec3f) -> PolEmit {
  var o: PolEmit;
  let r = s.x.x;
  let th = s.x.y;
  let m = kerrMetric(r, th, a);
  let alpha = sqrt(max(m.sig * m.del / m.A, 1e-12));
  let omega = 2.0 * a * r / m.A;
  let varpi = max(sqrt(m.A / m.sig) * sin(th), 1e-6);
  let E = (1.0 - omega * L) / alpha;
  let kz = vec3f(sqrt(max(m.del / m.sig, 0.0)) * s.p.x, s.p.y / sqrt(m.sig), L / varpi);
  let v2 = dot(vel, vel);
  var n = kz / E;
  var gam = 1.0;
  var vh = vec3f(0.0);
  if (v2 > 1e-12) {
    gam = inverseSqrt(max(1.0 - v2, 1e-6));
    vh = vel * inverseSqrt(v2);
    let Ep = gam * (E - dot(vel, kz));
    n = (kz + ((gam - 1.0) * dot(vh, kz) - gam * sqrt(v2) * E) * vh) / Ep;
  }
  n = normalize(n);
  let c = cross(n, b);
  o.w = length(c);
  o.mu = abs(dot(n, b));
  if (o.w < 1e-4) { return o; }
  let fp = c / o.w;
  // back to the ZAMO frame: (0, f') → (γ v·f', f' + (γ − 1)(v̂·f') v̂)
  let fz = vec4f(gam * dot(vel, fp), fp + (gam - 1.0) * dot(vh, fp) * vh);
  o.kappa = wpKappa(r, th, a, photonK(s, L, a), zamoToBL(r, th, a, fz));
  return o;
}

// Screen-frame Stokes direction (cos 2χ, sin 2χ) of κ_em, χ from screen-up towards screen-right.
fn stokesDir(kem: vec2f, kx: vec2f, ky: vec2f) -> vec2f {
  let det = kx.x * ky.y - ky.x * kx.y;
  if (abs(det) < 1e-30) { return vec2f(0.0); }
  let cx = (kem.x * ky.y - ky.x * kem.y) / det;
  let cy = (kx.x * kem.y - kx.y * kem.x) / det;
  let n2 = cx * cx + cy * cy;
  if (n2 < 1e-30) { return vec2f(0.0); }
  return vec2f(cy * cy - cx * cx, 2.0 * cx * cy) / n2;
}

// Degree of polarization of an electron-scattering atmosphere (Chandrasekhar 1960, Table XXIV):
// 11.7 % at grazing emission, 0 face-on (fit within 0.3 %).
fn chandrasekharPol(mu: f32) -> f32 {
  return 0.1171 * (1.0 - mu) / (1.0 + 3.4 * mu);
}

// Magnetic field direction (r̂, θ̂, φ̂) of the hot flow.
fn flowField(th: f32) -> vec3f {
  let mode = u32(P.pol.z);
  if (mode == 0u) { return vec3f(0.0, 0.0, 1.0); }
  if (mode == 1u) { return vec3f(1.0, 0.0, 0.0); }
  if (mode == 2u) { return vec3f(cos(th), -sin(th), 0.0); } // along the spin axis
  return normalize(vec3f(1.0, 0.0, 1.0));                   // trailing spiral, 45° pitch
}

// ---------------------------------------------------------------------------------------------
// Celestial sphere
// ---------------------------------------------------------------------------------------------
fn faceUV(d: vec3f) -> vec3f {
  let ad = abs(d);
  if (ad.x >= ad.y && ad.x >= ad.z) {
    return vec3f(select(0.0, 1.0, d.x < 0.0), d.y / ad.x, d.z / ad.x);
  } else if (ad.y >= ad.z) {
    return vec3f(select(2.0, 3.0, d.y < 0.0), d.x / ad.y, d.z / ad.y);
  }
  return vec3f(select(4.0, 5.0, d.z < 0.0), d.x / ad.z, d.y / ad.z);
}
fn faceDir(face: f32, u: f32, v: f32) -> vec3f {
  let f = u32(face);
  if (f == 0u) { return normalize(vec3f(1.0, u, v)); }
  if (f == 1u) { return normalize(vec3f(-1.0, u, v)); }
  if (f == 2u) { return normalize(vec3f(u, 1.0, v)); }
  if (f == 3u) { return normalize(vec3f(u, -1.0, v)); }
  if (f == 4u) { return normalize(vec3f(u, v, 1.0)); }
  return normalize(vec3f(u, v, -1.0));
}

// Band-limited fBm: octaves finer than the filter footprint fw (in units of p) are replaced by their
// mean, so the pattern is pre-filtered over the pixel's footprint on the sky instead of aliasing.
fn fbmLod(p0: vec3f, octaves: i32, fw: f32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  var n = 0.0;
  var f = 1.0;
  for (var i = 0; i < octaves; i++) {
    let keep = 1.0 - smoothstep(0.2, 0.5, f * fw);
    if (keep > 0.0) { s += a * mix(0.5, vnoise(p), keep); } else { s += a * 0.5; }
    n += a;
    p = p * 2.03 + vec3f(1.7, 9.2, 3.1);
    f *= 2.03;
    a *= 0.5;
  }
  return s / n;
}

// Stars on a jittered cube-map grid. Each star is a blackbody point source (temperature drawn
// from a cool-heavy distribution) with flux ∝ U^−1.5. Rendered through the pixel's sky filter (PSF ⊗
// lensed pixel footprint, normalised): the flux collected by a pixel is exact, including the lensing
// magnification. When the footprint grows beyond the cell size (near the critical curve, where one
// pixel sees a large patch of sky), the layer smoothly becomes its mean radiance instead of sparkling.
const STAR_MEAN_FLUX = 19.2; // E[max(U, 0.02)^−1.5], U uniform
fn starLayer(d: vec3f, cells: f32, layer: u32, g: f32, filt: SkyFilter, density: f32) -> vec3f {
  let cellAngle = 1.5708 / cells;
  let w = smoothstep(0.15, 0.35, filt.radius / cellAngle);
  var col = vec3f(0.0);
  if (w < 1.0) {
    let fuv = faceUV(d);
    let p = (fuv.yz * 0.5 + 0.5) * cells;
    let cell = floor(p);
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        let c = cell + vec2f(f32(i), f32(j));
        if (c.x < 0.0 || c.y < 0.0 || c.x >= cells || c.y >= cells) { continue; }
        let h = hash4(vec3u(u32(c.x), u32(c.y), u32(fuv.x) + layer * 8u));
        if (h.x > density) { continue; }
        let sp = (c + 0.1 + 0.8 * h.yz) / cells * 2.0 - 1.0;
        let sd = faceDir(fuv.x, sp.x, sp.y);
        let k = skyKernel(filt, d - sd); // chord ≈ angle, no cancellation in f32
        if (k < 1e-3 * filt.norm) { continue; }
        let T = 3200.0 + 26000.0 * pow(fract(h.w * 7.13), 3.0);
        let flux = 4.0e-8 * pow(max(fract(h.w * 3.71), 0.02), -1.5);
        col += blackbodyShifted(T, g) * flux * k;
      }
    }
  }
  if (w > 0.0) {
    // mean radiance: density · E[flux] · E[colour] / solid angle of a cell (4-point Gauss–Legendre in v)
    var mc = vec3f(0.0);
    let gv = array<f32, 4>(0.0694318, 0.3300095, 0.6699905, 0.9305682);
    let gw = array<f32, 4>(0.1739274, 0.3260726, 0.3260726, 0.1739274);
    for (var q = 0; q < 4; q++) {
      let v = gv[q];
      mc += gw[q] * blackbodyShifted(3200.0 + 26000.0 * v * v * v, g);
    }
    let omegaCell = (4.0 * PI / 6.0) / (cells * cells);
    col = mix(col, mc * (density * 4.0e-8 * STAR_MEAN_FLUX / omegaCell), w);
  }
  return col;
}

fn milkyWay(d: vec3f, g: f32, fw: f32) -> vec3f {
  // Galactic frame tilted with respect to the black-hole spin axis.
  // Galactic centre roughly behind the hole as seen from the default viewpoint (φ = 0),
  // band inclined ~35° to the disk plane.
  let gx = normalize(vec3f(-0.92, 0.30, 0.25));
  let gz0 = vec3f(0.25, 0.55, 0.80);
  let gz = normalize(gz0 - dot(gz0, gx) * gx);
  let gy = cross(gz, gx);
  let q = vec3f(dot(d, gx), dot(d, gy), dot(d, gz));
  let b = asin(clamp(q.z, -1.0, 1.0));
  let lc = acos(clamp(q.x, -1.0, 1.0)); // angular distance of longitude to the galactic centre
  let band = exp(-pow(b / 0.16, 2.0)) * (0.35 + 0.65 * exp(-lc * lc / 1.6));
  let bulge = exp(-(lc * lc + 4.0 * b * b) / 0.09);
  let clouds = fbmLod(q * 5.0, 5, fw * 5.0);
  let fine = fbmLod(q * 22.0 + vec3f(3.0), 4, fw * 22.0);
  let dustN = fbmLod(q * 9.0 + vec3f(11.0), 5, fw * 9.0);
  let dust = smoothstep(0.42, 0.72, dustN) * exp(-pow(b / 0.06, 2.0));
  let light = (band * (0.45 + 0.9 * clouds * clouds) * (0.6 + 0.8 * fine) * 1.6 + bulge * 1.0)
    * (1.0 - 0.85 * dust);
  let Tgal = mix(6800.0, 4300.0, clamp(bulge * 2.0 + dust, 0.0, 1.0));
  var col = blackbodyShifted(Tgal, g) * light * 0.09;
  // faint emission nebulae (H-α), Doppler-shifted like a 3000 K source
  let neb = smoothstep(0.68, 0.9, fbmLod(q * 7.0 + vec3f(5.0, 1.0, 2.0), 4, fw * 7.0)) * exp(-pow(b / 0.15, 2.0));
  col += blackbodyShifted(2500.0, g) * vec3f(1.0, 0.35, 0.45) * neb * 0.012;
  return col;
}

// Equirectangular (u, v) of a direction and its derivatives along the footprint axes.
fn equirectGrad(d: vec3f, j: vec3f) -> vec2f {
  let rxy2 = max(d.x * d.x + d.y * d.y, 1e-8);
  let du = dot(vec3f(-d.y, d.x, 0.0), j) / (TAU * rxy2);
  let dv = -j.z / (PI * sqrt(rxy2));
  return vec2f(du, dv);
}

// Spectral shift of a sky source approximated by that of a blackbody at T: per-channel ratio of the
// shifted to the unshifted colour (1 for g = 1). Stars use their own temperatures exactly.
fn shiftRatio(T: f32, g: f32) -> vec3f {
  return blackbodyShifted(T, g) / max(bbLookup(T).rgb, vec3f(1e-3));
}

fn catalogueCell(d: vec3f, grid: u32) -> u32 {
  let fuv = faceUV(d);
  let gf = f32(grid);
  let cx = min(u32(floor((fuv.y * 0.5 + 0.5) * gf)), grid - 1u);
  let cy = min(u32(floor((fuv.z * 0.5 + 0.5) * gf)), grid - 1u);
  return (u32(fuv.x) * grid + cy) * grid + cx;
}

// The real sky: NASA/Goddard SVS Deep Star Maps 2020 (Gaia DR2 stars fainter than Tycho, as a
// diffuse map) + the 119 614 HYG/Hipparcos stars as exact point sources, each a blackbody at its
// B−V temperature seen at g·T. Directions are rotated into ICRS equatorial coordinates.
fn realSky(dB: vec3f, g: f32, fpB: Footprint) -> vec3f {
  let d = vec3f(dot(P.skyX.xyz, dB), dot(P.skyY.xyz, dB), dot(P.skyZ.xyz, dB));
  var fp: Footprint;
  fp.jx = vec3f(dot(P.skyX.xyz, fpB.jx), dot(P.skyY.xyz, fpB.jx), dot(P.skyZ.xyz, fpB.jx));
  fp.jy = vec3f(dot(P.skyX.xyz, fpB.jy), dot(P.skyY.xyz, fpB.jy), dot(P.skyZ.xyz, fpB.jy));
  // Milky Way map: u = 0.5 − RA/360°, v = (90° − Dec)/180°
  let uv = vec2f(fract(0.5 - atan2(d.y, d.x) / TAU), acos(clamp(d.z, -1.0, 1.0)) / PI);
  let gx = equirectGrad(d, fp.jx) * vec2f(-1.0, 1.0);
  let gy = equirectGrad(d, fp.jy) * vec2f(-1.0, 1.0);
  var col = textureSampleGrad(mwTex, bgSamp, uv, gx, gy).rgb * shiftRatio(5000.0, g);

  // Catalogue stars through the sky filter; beyond ~cell-sized footprints, the catalogue's
  // radiance map (same flux, mip-filtered) takes over.
  let filt = skyFilter(d, fp, P.time.w);
  let grid = max(catalogue[1], 1u);
  let cellAngle = 1.5708 / f32(grid);
  let reach = 3.0 * filt.radius;
  let w = smoothstep(0.25, 0.5, reach / cellAngle);
  let fluxScale = P.skyX.w;
  if (w < 1.0) {
    let starsBase = 4u + 6u * grid * grid + 1u;
    var cells = array<u32, 4>(0xffffffffu, 0xffffffffu, 0xffffffffu, 0xffffffffu);
    var sum = vec3f(0.0);
    for (var c = 0u; c < 4u; c++) {
      let o = vec2f(select(-1.0, 1.0, (c & 1u) != 0u), select(-1.0, 1.0, (c & 2u) != 0u)) * reach;
      let cell = catalogueCell(normalize(d + o.x * filt.e1 + o.y * filt.e2), grid);
      var seen = false;
      for (var k = 0u; k < c; k++) { if (cells[k] == cell) { seen = true; } }
      cells[c] = cell;
      if (seen) { continue; }
      let s0 = catalogue[4u + cell];
      let s1 = catalogue[5u + cell];
      for (var i = s0; i < s1; i++) {
        let b = starsBase + 4u * i;
        let sd = vec3f(bitcast<f32>(catalogue[b]), bitcast<f32>(catalogue[b + 1u]), bitcast<f32>(catalogue[b + 2u]));
        let k = skyKernel(filt, d - sd);
        if (k < 1e-4 * filt.norm) { continue; }
        let mt = unpack2x16float(catalogue[b + 3u]);
        sum += blackbodyShifted(mt.y * 1000.0, g) * (exp2(-1.3287712 * mt.x) * fluxScale * k);
      }
    }
    col += (1.0 - w) * sum;
  }
  if (w > 0.0) {
    let lod = textureSampleGrad(starLodTex, bgSamp, uv, gx, gy).rgb;
    col += w * lod * (fluxScale / (1.0 / 4250.0)) * shiftRatio(5800.0, g);
  }
  // map value 0.1 (bright star clouds) → radiance 0.05: the sky stays far fainter than the inner disk
  return col * 0.5;
}

fn background(d: vec3f, g: f32, fp: Footprint, sky: f32) -> vec3f {
  var mode = P.modes.z;
  // wormhole world: the black hole's universe is the distant galaxy, ours is the chosen sky
  if (P.wh.x > 0.5 && sky < 1.5) { mode = 4u; }
  if (mode == 4u) { return alienSky(d, g, fp) * P.time.z; }
  let intensity = P.time.z;
  if (mode == 1u) {
    // lat/long checkerboard: makes the lensing map explicit
    let th = acos(clamp(d.z, -1.0, 1.0));
    let ph = atan2(d.y, d.x);
    let cu = floor(ph / TAU * 24.0);
    let cv = floor(th / PI * 12.0);
    let chk = (i32(cu + cv) & 1) == 0;
    var col = select(vec3f(0.05, 0.05, 0.08), vec3f(0.55, 0.5, 0.42), chk);
    if (d.z > 0.0) { col *= vec3f(0.6, 0.8, 1.3); }
    return col * intensity;
  }
  if (mode == 2u) {
    let u = atan2(d.y, d.x) / TAU + 0.5;
    let v = acos(clamp(d.z, -1.0, 1.0)) / PI;
    // anisotropic, mip-mapped lookup over the lensed footprint (no seam: explicit gradients)
    let tex = textureSampleGrad(bgTex, bgSamp, vec2f(u, v), equirectGrad(d, fp.jx), equirectGrad(d, fp.jy)).rgb;
    // approximate the spectral shift by that of a 6500 K spectrum
    return tex * shiftRatio(6500.0, g) * intensity;
  }
  if (mode == 3u && P.skyY.w > 0.5) {
    return realSky(d, g, fp) * intensity;
  }
  let filt = skyFilter(d, fp, P.time.w);
  var col = milkyWay(d, g, filt.radius);
  col += starLayer(d, 40.0, 0u, g, filt, 0.30) * 1.0;
  col += starLayer(d, 140.0, 1u, g, filt, 0.25) * 0.08;
  col += starLayer(d, 420.0, 2u, g, filt, 0.20) * 0.012;
  return col * intensity;
}

// ---------------------------------------------------------------------------------------------
// Interstellar's wormhole: the Dneg metric (James, von Tunzelmann, Franklin & Thorne 2015),
// ds² = −dt² + dℓ² + r(ℓ)² dΩ², ℓ > 0 the black hole's universe, ℓ < 0 ours. A ray keeps to the plane
// of its initial position and direction: dℓ/dt = p_ℓ, dp_ℓ/dt = b² r'/r³, dψ/dt = b/r² (b conserved).
// The far mouth sits in the black hole's universe; inside a gluing sphere around it rays follow the
// Dneg metric, outside it the Kerr metric (each neglects the other's gravity there). Positions and
// vectors of the Dneg region are "rep" vectors: radial component = ê_ℓ component (wormhole.ts).
// ---------------------------------------------------------------------------------------------
const SKY_NATIVE = 1.0; // the black hole's universe
const SKY_HOME = 2.0;   // ours, through the wormhole

fn dnegR(l: f32) -> vec2f {
  let rho = P.wh.y;
  let a = P.wh.z;
  let M = P.wh.w;
  let al = abs(l);
  if (al <= a) { return vec2f(rho, 0.0); }
  let x = 2.0 * (al - a) / (PI * M);
  return vec2f(rho + M * (x * atan(x) - 0.5 * log(1.0 + x * x)), sign(l) * (2.0 / PI) * atan(x));
}

struct Planar { l: f32, pl: f32, psi: f32 };

fn dnegRHS(l: f32, pl: f32, b: f32) -> Planar {
  let rr = dnegR(l);
  let ir = 1.0 / rr.x;
  return Planar(pl, b * b * rr.y * ir * ir * ir, b * ir * ir);
}

// ---------------------------------------------------------------------------------------------
// Cinematic mode: a liquid surface stretched across the throat (ℓ = 0). Artistic, not part of the
// Dneg metric: rays crossing it are refracted by its ripples, or reflected back (Fresnel), and the
// light that goes through picks up a faint aqueous tint and caustics.
// ---------------------------------------------------------------------------------------------

// The waves are tiny (wavelengths of a few hundredths of the throat radius): each one fades out once
// it spans too few pixels (P.water3.y = a pixel's footprint on the throat, in radians), like a
// mip-mapped normal map; when even the longest is unresolved the whole effect is gone, so from afar
// the wormhole is the physical one.
fn waterLod(K: f32) -> f32 { return smoothstep(8.0, 24.0, TAU / (K * P.water3.y)); }

// A ring of ripples running out from c on the throat's sphere, `age` seconds after the drop.
fn waterRing(n: vec3f, c: vec3f, age: f32, amp: f32, K: f32, speed: f32) -> vec4f {
  if (age < 0.0 || age > 6.0) { return vec4f(0.0); }
  let cc = clamp(dot(c, n), -1.0, 1.0);
  let x = acos(cc) - speed * age;          // behind (< 0) or ahead of the front
  let w2 = 0.0015 + 0.004 * age;           // the packet spreads
  let env = amp * waterLod(K) * exp(-x * x / w2 - 0.5 * age) * min(age * 8.0, 1.0);
  if (env < 1e-4) { return vec4f(0.0); }
  let ph = K * x;
  let gth = (cc * n - c) * inverseSqrt(max(1.0 - cc * cc, 1e-6)); // ∇θ
  return vec4f(env * cos(ph) * gth, -40.0 * env * sin(ph));
}

// Slope of the surface (tangential gradient of its height, per radian) and a curvature measure
// (caustics, glow on the crests).
fn waterSlope(n: vec3f) -> vec4f {
  let tc = P.water.w;
  var acc = vec4f(0.0);
  // fine swell: travelling ripples in eight directions, ω ∝ √K
  for (var i = 0u; i < 8u; i++) {
    let fi = f32(i);
    let K = WATER_K0 * pow(1.4, fi);
    let lod = waterLod(K);
    if (lod <= 0.0) { break; }
    let z = 1.0 - (2.0 * fi + 1.0) / 8.0;
    let q = sqrt(1.0 - z * z);
    let k = vec3f(q * cos(2.39996 * fi + 0.4), q * sin(2.39996 * fi + 0.4), z);
    let kn = dot(k, n);
    let ph = K * kn - 0.95 * sqrt(K) * tc + 1.7 * fi;
    // patchy: each train comes and goes across the surface (no regular cross-hatching)
    let trainAmp = vnoise(n * 7.0 + vec3f(13.1 * fi, 7.3 * fi, 0.05 * tc));
    let sl = lod * 1.4 * trainAmp * trainAmp / sqrt(K);
    acc += vec4f(sl * cos(ph) * k, -40.0 * sl * sin(ph) * (1.0 - kn * kn));
  }
  // droplets falling now and then, somewhere on the surface
  for (var j = 0u; j < 4u; j++) {
    let fj = f32(j);
    let T = 1.6 + 0.7 * fj;
    let tt = tc + 0.61 * fj;
    let cyc = floor(tt / T);
    let h = hash4(vec3u(u32(max(cyc, 0.0)), j, 911u));
    let z = 2.0 * h.x - 1.0;
    let c = vec3f(sqrt(1.0 - z * z) * vec2f(cos(TAU * h.y), sin(TAU * h.y)), z);
    acc += waterRing(n, c, tt - cyc * T, 0.06 + 0.05 * h.z, 380.0, 0.2);
  }
  // the splash left by the camera going through
  acc += waterRing(n, P.water2.xyz, tc - P.water2.w, 0.3, 260.0, 0.3);
  let g = acc.xyz - dot(acc.xyz, n) * n;
  return vec4f(g, acc.w) * P.water.y;
}
const WATER_K0 = 150.0; // longest ripples: wavelength 2π/150 of the throat radius

// len: coordinate time spent (Gargantua's clock on its side of the throat, path length beyond);
// tint: transmission picked up at the cinematic liquid surface
// glow: light scattered by the liquid towards the camera (added in front of the tint)
struct WhOut { side: f32, n: vec3f, d: vec3f, len: f32, tint: vec3f, glow: vec3f };

// Follows a ray from (l0, n0) with unit rep direction d0 until ℓ ≥ lPlus or ℓ ≤ −lMinus.
// u: a random number in [0, 1) (the liquid surface's reflect / transmit choice).
fn dnegTrace(l0: f32, n0: vec3f, d0: vec3f, lPlus: f32, lMinus: f32, u0: f32) -> WhOut {
  let rho = P.wh.y;
  let a = P.wh.z;
  let M = P.wh.w;
  var tv = d0 - dot(d0, n0) * n0;
  var tl = length(tv);
  var e2: vec3f;
  if (tl > 1e-6) {
    e2 = tv / tl;
  } else {
    e2 = normalize(cross(n0, select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(n0.x) > 0.9)));
    tl = 0.0;
  }
  var b = dnegR(l0).x * tl;
  var st = Planar(l0, dot(d0, n0), 0.0);
  var nA = n0; // plane of motion: (nA, e2); re-derived after each kick of the hole's field
  var out: WhOut;
  out.tint = vec3f(1.0);
  let waterOn = P.water.x > 0.5;
  var u = u0;
  for (var i = 0u; i < 3000u; i++) {
    if (st.l >= lPlus && st.pl > 0.0) { out.side = 1.0; break; }
    if (st.l <= -lMinus && st.pl < 0.0) { out.side = -1.0; break; }
    let r = dnegR(st.l).x;
    var h = min(min(0.05 * r * r / max(b, 1e-3 * rho), 0.25 * r), 0.08 * (max(abs(st.l) - a, 0.0) + M) + 0.006 * rho);
    // land on the mouths |ℓ| = a, where r'' jumps (keeps RK4 at full order)
    if (abs(st.pl) > 1e-9) {
      let t1 = (a - st.l) / st.pl;
      let t2 = (-a - st.l) / st.pl;
      if (t1 > 1e-7 * rho && t1 < h) { h = t1; }
      if (t2 > 1e-7 * rho && t2 < h) { h = t2; }
      // and on the liquid surface (ℓ = 0)
      let t0 = -st.l / st.pl;
      if (waterOn && t0 > 1e-7 * rho && t0 < h) { h = t0; }
      // and end exactly on the way out (gluing sphere / our far radius): no overshoot, so a ray
      // grazing the sphere spends no extra time or path in here (no seam at its rim)
      let t3 = select(-1.0, (lPlus - st.l) / st.pl, st.pl > 0.0);
      let t4 = select(-1.0, (-lMinus - st.l) / st.pl, st.pl < 0.0);
      if (t3 > 1e-7 * rho && t3 < h) { h = t3; }
      if (t4 > 1e-7 * rho && t4 < h) { h = t4; }
    }
    let lPrev = st.l;
    let k1 = dnegRHS(st.l, st.pl, b);
    let k2 = dnegRHS(st.l + 0.5 * h * k1.l, st.pl + 0.5 * h * k1.pl, b);
    let k3 = dnegRHS(st.l + 0.5 * h * k2.l, st.pl + 0.5 * h * k2.pl, b);
    let k4 = dnegRHS(st.l + h * k3.l, st.pl + h * k3.pl, b);
    st.l += h / 6.0 * (k1.l + 2.0 * k2.l + 2.0 * k3.l + k4.l);
    st.pl += h / 6.0 * (k1.pl + 2.0 * k2.pl + 2.0 * k3.pl + k4.pl);
    st.psi += h / 6.0 * (k1.psi + 2.0 * k2.psi + 2.0 * k3.psi + k4.psi);
    if (st.l <= a) { out.len += h; }
    if (waterOn && (lPrev * st.l < 0.0 || (st.l == 0.0 && lPrev != 0.0))) {
      // through the liquid surface: reflected (probability F, Schlick) or refracted by the ripples
      let r0 = dnegR(0.0).x;
      let n = cos(st.psi) * nA + sin(st.psi) * e2;
      let t = -sin(st.psi) * nA + cos(st.psi) * e2;
      let d = normalize(st.pl * n + (b / r0) * t);
      let vis = waterLod(WATER_K0); // 0 from afar: no effect at all
      let ws = waterSlope(n);
      let nw = normalize(n - ws.xyz);
      let c = dot(d, nw);
      // (Schlick; faded to nothing as the reflectance goes to 0, grazing rim included)
      let F = vis * min(P.water.z / 0.02, 1.0) * (P.water.z + (1.0 - P.water.z) * pow(1.0 - min(abs(c), 1.0), 5.0));
      u = fract(u * 7.1373 + 0.3719);
      let dr = d - 2.0 * c * nw;
      var dn = normalize(d - 0.45 * ws.xyz);
      if (u < F && dot(dr, n) * st.pl < 0.0) {
        dn = dr;
      } else {
        if (dot(dn, n) * st.pl <= 0.0) { dn = d; }
        // a thin aqueous layer (longer path at grazing incidence), caustics from the curvature
        let path = 0.35 / max(abs(dot(dn, n)), 0.2);
        let caustic = 1.0 + clamp(-0.1 * ws.w, -0.55, 1.2);
        // light scattered in the liquid: a luminous network on the crests (where the caustics focus)
        // and a sheen towards the rim (grazing incidence), so the surface shows on a dark sky too
        let crest = pow(clamp(-0.05 * ws.w, 0.0, 3.0), 2.0);
        let glow = P.water5.rgb * (0.2 * crest + 0.25 * F + 0.008);
        out.glow += out.tint * glow * (vis * P.water3.x * P.time.z);
        out.tint *= mix(vec3f(1.0), exp(-P.water4.rgb * path), vis) * caustic;
      }
      let tv2 = dn - dot(dn, n) * n;
      let tl2 = length(tv2);
      nA = n;
      if (tl2 > 1e-7) { e2 = tv2 / tl2; }
      b = r0 * tl2;
      st = Planar(0.0, dot(dn, n), 0.0);
    }
    if (st.l > a) {
      // Gargantua's side: its weak field (Φ = −1/|X|, light bends by −2∇⊥Φ per unit length) is
      // felt here too, so that nothing jumps at the gluing sphere (the Dneg metric alone ignores it)
      let rr = dnegR(st.l).x;
      let n = cos(st.psi) * nA + sin(st.psi) * e2;
      let t = -sin(st.psi) * nA + cos(st.psi) * e2;
      var d = normalize(st.pl * n + (b / rr) * t);
      let X = P.whC.xyz + whToWorld(n * rr);
      // Gargantua's coordinate time for light (weak Schwarzschild field): dt² = dr²/α⁴ + r²dΩ²/α²
      let a2 = max(1.0 - 2.0 / length(X), 1e-3);
      let ur = dot(whToWorld(d), normalize(X));
      out.len += h * sqrt(ur * ur / (a2 * a2) + (1.0 - ur * ur) / a2);
      let gR = worldToWh(X / pow(dot(X, X), 1.5));
      d = normalize(d - 2.0 * h * (gR - dot(gR, d) * d));
      let tv2 = d - dot(d, n) * n;
      let tl2 = length(tv2);
      nA = n;
      if (tl2 > 1e-7) { e2 = tv2 / tl2; }
      b = rr * tl2;
      st = Planar(st.l, dot(d, n), 0.0);
    }
  }
  if (out.side == 0.0) { out.side = sign(st.l); }
  let r = dnegR(st.l).x;
  out.n = cos(st.psi) * nA + sin(st.psi) * e2;
  let t = -sin(st.psi) * nA + cos(st.psi) * e2;
  out.d = normalize(st.pl * out.n + (b / r) * t);
  return out;
}

// Rep vector on our side → Cartesian vector of our universe (radial flip + mirror: right-handed).
fn repToHome(n: vec3f, v: vec3f) -> vec3f {
  let vl = dot(v, n);
  let u = v - 2.0 * vl * n;
  return vec3f(u.x, -u.y, u.z);
}
fn whToWorld(v: vec3f) -> vec3f { return v.x * P.whX.xyz + v.y * P.whY.xyz + v.z * P.whZ.xyz; }
fn worldToWh(v: vec3f) -> vec3f { return vec3f(dot(v, P.whX.xyz), dot(v, P.whY.xyz), dot(v, P.whZ.xyz)); }
fn blCart(x: vec4f) -> vec3f {
  let st = sin(x.y);
  return x.x * vec3f(st * cos(x.z), st * sin(x.z), cos(x.y));
}

// First intersection of the chord p0 → p1 with the gluing sphere, as a fraction of the chord (−1: none).
fn glueHit(p0: vec3f, p1: vec3f) -> f32 {
  let R = P.wh2.z;
  let dv = p1 - p0;
  let f = p0 - P.whC.xyz;
  let c = dot(f, f) - R * R;
  if (c <= 0.0) { return -1.0; } // starting on/inside it: just launched from the sphere
  let A = dot(dv, dv);
  let B = dot(f, dv);
  let disc = B * B - A * c;
  if (disc < 0.0 || B >= 0.0) { return -1.0; }
  let t = (-B - sqrt(disc)) / A;
  return select(-1.0, t, t <= 1.0);
}

// Unit direction of the backward ray in the (flat-mapped) Cartesian frame of the hole: the photon's
// momentum in the ZAMO frame, reversed. E = 1 normalisation (p_t = −1, p_φ = L).
fn backwardDir(st: GState, L: f32, a: f32) -> vec3f {
  let m = kerrMetric(st.x.x, st.x.y, a);
  let sth = sin(st.x.y);
  let cth = cos(st.x.y);
  let sp = sin(st.x.z);
  let cp = cos(st.x.z);
  let pr = sqrt(max(m.del / m.sig, 0.0)) * st.p.x;
  let pth = st.p.y / sqrt(m.sig);
  let pph = L / max(sqrt(m.A / m.sig) * sth, 1e-6);
  let v = pr * vec3f(sth * cp, sth * sp, cth) + pth * vec3f(cth * cp, cth * sp, -sth) + pph * vec3f(-sp, cp, 0.0);
  return -normalize(v);
}

struct Launch { s: GState, L: f32, E0: f32 };

// Kerr initial state of a backward ray at Cartesian X with unit direction dW, for a photon of energy
// Ez measured by the local ZAMO (the static observers of the gluing sphere, to O(a/r²)).
fn kerrLaunch(X: vec3f, dW: vec3f, Ez: f32, a: f32) -> Launch {
  let r = length(X);
  let th = acos(clamp(X.z / r, -1.0, 1.0));
  let ph = atan2(X.y, X.x);
  let sth = sin(th);
  let cth = cos(th);
  let sp = sin(ph);
  let cp = cos(ph);
  let look = vec3f(dot(dW, vec3f(sth * cp, sth * sp, cth)), dot(dW, vec3f(cth * cp, cth * sp, -sth)), dot(dW, vec3f(-sp, cp, 0.0)));
  let m = kerrMetric(r, th, a);
  let alpha = sqrt(max(m.sig * m.del / m.A, 1e-12));
  let omega = 2.0 * a * r / m.A;
  let varpi = sqrt(m.A / m.sig) * sth;
  let pz = -look * Ez;
  var o: Launch;
  o.E0 = alpha * Ez + omega * varpi * pz.z;
  o.L = varpi * pz.z / o.E0;
  o.s.x = vec4f(r, th, ph, 0.0);
  o.s.p = vec2f(sqrt(m.sig / m.del) * pz.x / o.E0, sqrt(m.sig) * pz.y / o.E0);
  return o;
}

// The distant galaxy on the far side (Interstellar: nearer its centre than the Sun is to ours: a broader,
// brighter band, a large bulge, emission and reflection nebulae in several colours, dense dust lanes
// and more stars). Procedural and pre-filtered over the pixel's lensed footprint.
fn alienSky(d: vec3f, g: f32, fp: Footprint) -> vec3f {
  let filt = skyFilter(d, fp, P.time.w);
  let fw = filt.radius;
  let gx = normalize(vec3f(0.55, -0.62, -0.25));
  let gz0 = vec3f(-0.3, 0.2, 0.93);
  let gz = normalize(gz0 - dot(gz0, gx) * gx);
  let gy = cross(gz, gx);
  let q = vec3f(dot(d, gx), dot(d, gy), dot(d, gz));
  let lc = acos(clamp(q.x, -1.0, 1.0));
  // warped band: the disk seen from inside is not a perfect great circle
  let bb = asin(clamp(q.z, -1.0, 1.0)) - 0.08 * sin(2.0 * atan2(q.y, q.x) + 0.7);
  let band = exp(-pow(bb / 0.24, 2.0)) * (0.4 + 0.6 * exp(-lc * lc / 1.2));
  let bulge = exp(-(lc * lc + 2.5 * bb * bb) / 0.22);
  let clouds = fbmLod(q * 4.0, 6, fw * 4.0);
  let fine = fbmLod(q * 16.0 + vec3f(3.0, 1.0, 7.0), 5, fw * 16.0);
  let dn = fbmLod(q * 6.5 + vec3f(11.0, 2.0, 5.0), 6, fw * 6.5);
  let ridge = 1.0 - abs(2.0 * dn - 1.0);
  let dust = clamp(smoothstep(0.62, 0.92, ridge) * exp(-pow(bb / 0.16, 2.0))
    + 0.5 * smoothstep(0.55, 0.8, dn) * exp(-pow(bb / 0.3, 2.0)), 0.0, 1.0);
  let light = (band * (0.35 + 1.1 * clouds * clouds) * (0.55 + 0.9 * fine) * 1.8 + bulge * 2.2) * (1.0 - 0.9 * dust);
  let Tg = mix(5600.0, 3900.0, clamp(bulge * 1.5 + 0.4 * dust, 0.0, 1.0));
  var col = blackbodyShifted(Tg, g) * light * 0.1;
  // large coloured clouds along and off the band: H II (Hα), O III, blue reflection nebulae
  let m1 = fbmLod(q * 2.3 + vec3f(5.0, 9.0, 1.0), 5, fw * 2.3);
  let m2 = fbmLod(q * 3.1 + vec3f(1.0, 4.0, 8.0), 5, fw * 3.1);
  let lay = exp(-pow(bb / 0.55, 2.0));
  let hii = smoothstep(0.58, 0.82, m1) * lay * (0.5 + fine);
  let oiii = smoothstep(0.6, 0.85, m2) * lay * (0.5 + clouds);
  let refl = smoothstep(0.62, 0.8, 1.0 - m1) * smoothstep(0.5, 0.7, m2) * lay;
  col += shiftRatio(3000.0, g) * vec3f(1.0, 0.28, 0.42) * hii * 0.15 * (1.0 - 0.7 * dust);
  col += shiftRatio(12000.0, g) * vec3f(0.25, 0.85, 0.8) * oiii * 0.09 * (1.0 - 0.7 * dust);
  col += shiftRatio(9000.0, g) * vec3f(0.45, 0.6, 1.0) * refl * 0.07;
  // stars: denser than ours, concentrated towards the band and the bulge
  let dens = min(0.5 + 0.5 * band + 0.6 * bulge, 1.6);
  col += starLayer(d, 44.0, 5u, g, filt, 0.35 * dens) * 1.3;
  col += starLayer(d, 150.0, 6u, g, filt, 0.3 * dens) * 0.12;
  col += starLayer(d, 460.0, 7u, g, filt, 0.3 * dens) * 0.02;
  return col;
}

// ---------------------------------------------------------------------------------------------
// Ray generation and tracing
// ---------------------------------------------------------------------------------------------
fn colormap(t0: f32) -> vec3f {
  // turbo-like
  let t = clamp(t0, 0.0, 1.0);
  let c0 = vec3f(0.1140, 0.0628, 0.2248);
  let c1 = vec3f(6.7162, 3.1822, 7.5715);
  let c2 = vec3f(-66.093, -4.9366, -10.087);
  let c3 = vec3f(228.66, 25.050, -91.883);
  let c4 = vec3f(-334.83, -69.314, 288.84);
  let c5 = vec3f(218.73, 67.531, -305.17);
  let c6 = vec3f(-52.887, -21.542, 110.53);
  return clamp(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))), vec3f(0.0), vec3f(1.0));
}

// Result of a traced ray. The celestial sphere is shaded after the ray (in main) because its filter
// footprint comes from the neighbouring rays of the workgroup: final = col + bgW · sky(dir, gBg).
struct TraceOut { col: vec3f, bgW: f32, dir: vec3f, gBg: f32, qu: vec2f, sky: f32, tint: vec3f };

fn traceOut(col: vec3f) -> TraceOut {
  var o: TraceOut;
  o.col = col;
  return o;
}

fn trace(ndc: vec2f, rnd: f32, tNow: f32) -> TraceOut {
  // Direction the camera looks at, in the camera rest frame (components along ZAMO axes).
  let tanH = P.cam.w;
  let aspect = P.camRight.w;
  return traceLook(normalize(P.camFwd.xyz + ndc.x * tanH * aspect * P.camRight.xyz + ndc.y * tanH * P.camUp.xyz), rnd, tNow);
}

fn traceLook(look: vec3f, rnd: f32, tNow: f32) -> TraceOut {
  let a = P.bh.x;
  let rH = P.bh.y;
  let mode = P.modes.x;

  // Received photon: energy 1, momentum opposite to the viewing direction. Lorentz boost from the
  // camera frame to the ZAMO frame (relativistic aberration + Doppler of the observer's motion).
  let pc = -look;
  let beta = P.boost.xyz;
  let gam = P.boost.w;
  let b2 = dot(beta, beta);
  var Ez = 1.0;
  var pz = pc;
  if (b2 > 1e-10) {
    let bn = beta * inverseSqrt(b2);
    Ez = gam * (1.0 + dot(beta, pc));
    // p = p' + [(γ − 1)(β̂·p') + γ|β| E'] β̂
    pz = pc + ((gam - 1.0) * dot(bn, pc) + gam * sqrt(b2)) * bn;
  }

  // The ray is followed in segments: Kerr (seg 0) and, in the wormhole world, Dneg (seg 1).
  let whOn = P.wh.x > 0.5;
  var seg = 0u;
  var wl = 0.0;          // Dneg segment start: ℓ, rep position and direction,
  var wn = vec3f(0.0);
  var wd = vec3f(0.0);
  var eloc = Ez;         // and the photon energy measured there by static observers
  var whInR = 0.0;       // distance to the hole where the ray entered the Dneg region (0: from our side)
  var whInT = 0.0;       // coordinate time (along the ray, ≤ 0) when it entered
  var E0 = 1.0;          // energy at infinity of a photon the camera measures at energy 1
  var L = 0.0;
  var s: GState;
  if (whOn && P.wh2.x > 0.5) {
    // camera in the wormhole's throat region: vectors are rep vectors, the observer is static
    seg = 1u;
    wl = P.wh2.y;
    wn = P.whN.xyz;
    wd = -pz / Ez;
    if (P.wh2.y > 0.0) { whInR = length(P.whC.xyz + whToWorld(P.whN.xyz * dnegR(P.wh2.y).x)); }
  } else {
    // ZAMO tetrad → covariant Boyer–Lindquist momentum.
    let alpha = P.zamo.x;
    let omega = P.zamo.y;
    let varpi = P.zamo.z;
    let sqrtSig = P.zamo.w;
    let sqrtSigDel = P.zamo2.x;
    let pt = -(alpha * Ez + omega * varpi * pz.z);
    E0 = -pt;
    if (E0 <= 1e-6) {
      // Negative-energy photon (only possible inside the ergosphere): can't come from infinity.
      return traceOut(vec3f(0.0));
    }
    L = varpi * pz.z / E0;
    s.x = vec4f(P.cam.x, P.cam.y, P.cam.z, 0.0);
    s.p = vec2f(sqrtSigDel * pz.x / E0, sqrtSig * pz.y / E0);
  }

  let eps = P.integ.x;
  let maxSteps = u32(P.integ.y);
  let rEsc = P.integ.z;
  let capTol = P.integ.w;
  let diskOn = P.modes.w == 1u;
  let thick = P.ext2.z > 0.0;
  let volOn = P.vol.x > 0.5;
  let jetOn = P.jet.x > 0.5;
  let adaptive = QUALITY_PIPELINE && (P.frame.z & FLAG_ADAPTIVE_RK) != 0u;
  let tol = P.ext.x;
  let rIn = P.bh.z;
  let rOut = P.bh.w;

  var col = vec3f(0.0);
  var crossings = 0u;
  var steps = 0u;
  var evals = 0u;
  var fate = 0u; // 0 = max steps, 1 = horizon, 2 = escaped, 3 = opaque matter
  var gDisk = 0.0;
  var TDisk = 0.0;
  var hitDisk = false;
  var trans = 1.0; // transmittance accumulated front to back
  var hNext = 1e9;
  let radio = P.radio.x > 0.5;
  let spotOn = P.spot.x > 0.5;
  var trans3 = vec3f(1.0); // per-frequency transmittance (radio band)
  var out: TraceOut;
  var kCur: Deriv; // derivative at the current point (FSAL)
  if (seg == 0u) { kCur = geodesicRHS(s.x, s.p, L, a); }
  var comp: GState; // Kahan compensation of the state
  var skyDir = vec3f(0.0);
  var skyG = 1.0;
  var skyId = SKY_NATIVE;
  var thr = vec3f(1.0);  // transmission through the cinematic liquid surface
  var colW = vec3f(0.0); // light gathered before the last pass through the wormhole
  var rayLen = 0.0; // distance travelled by the ray (flat map), for the camera path's tube radius
  var tubeVis = 1.0; // the path's tube is hidden by the disk (opaque for it except in real gaps)

  // Polarization: κ of the two screen axes for this pixel's photon at the camera.
  let polOn = P.pol.x > 0.5;
  var kapX = vec2f(0.0);
  var kapY = vec2f(0.0);
  var stokes = vec2f(0.0);
  if (polOn && seg == 0u) {
    let ex = normalize(P.camRight.xyz - look * dot(look, P.camRight.xyz));
    let ey = normalize(P.camUp.xyz - look * dot(look, P.camUp.xyz) - ex * dot(ex, P.camUp.xyz));
    let kc = vec4f(kCur.dx.w, kCur.dx.x, kCur.dx.y, kCur.dx.z);
    var bx = vec4f(0.0, ex);
    var by = vec4f(0.0, ey);
    if (b2 > 1e-10) {
      let bn = beta * inverseSqrt(b2);
      bx = vec4f(gam * dot(beta, ex), ex + (gam - 1.0) * dot(bn, ex) * bn);
      by = vec4f(gam * dot(beta, ey), ey + (gam - 1.0) * dot(bn, ey) * bn);
    }
    kapX = wpKappa(s.x.x, s.x.y, a, kc, zamoToBL(s.x.x, s.x.y, a, bx));
    kapY = wpKappa(s.x.x, s.x.y, a, kc, zamoToBL(s.x.x, s.x.y, a, by));
  }

  for (var segN = 0u; segN < 6u; segN++) {
  if (seg == 1u) {
    let w = dnegTrace(wl, wn, wd, P.wh2.w, P.whN.w, fract(rnd * 61.8034 + 0.2718 * f32(segN)));
    // light from beyond the liquid surface is tinted by it; what was gathered before is not
    colW += thr * (col + w.glow);
    col = vec3f(0.0);
    thr *= w.tint;
    if (w.side < 0.0) {
      // out of our end of the wormhole: straight on to our sky (g_tt = −1: no frequency shift)
      fate = 2u;
      skyDir = repToHome(w.n, w.d);
      skyG = 1.0 / eloc;
      skyId = SKY_HOME;
      break;
    }
    // out of the far mouth: on through the Kerr metric, from the gluing sphere
    let Xo = P.whC.xyz + whToWorld(w.n * (P.wh2.z * 1.0005));
    if (whInR > 0.0) {
      // came in from the black hole's universe: the local energy follows its potential (weak field),
      // E_loc ∝ 1/α, so the energy at infinity is unchanged across the Dneg region
      eloc *= sqrt(max(1.0 - 2.0 / whInR, 1e-3) / max(1.0 - 2.0 / length(Xo), 1e-3));
    }
    let ks = kerrLaunch(Xo, whToWorld(w.d), eloc, a);
    if (ks.E0 <= 1e-6) { fate = 1u; break; }
    s = ks.s;
    // the ray's clock goes on (backwards) through the wormhole: the disk, the flow and the star are
    // seen at the right emission times behind it (it was reset to 0 here: a visible circle)
    s.x.w = whInT - w.len;
    L = ks.L;
    E0 = ks.E0;
    kCur = geodesicRHS(s.x, s.p, L, a);
    comp = GState();
    hNext = 1e9;
    seg = 0u;
  }
  var entered = false;
  fate = 0u;
  for (var i = 0u; i < maxSteps; i++) {
    steps = i;
    var n: GState;
    var h: f32;
    var kNext: Deriv;
    if (adaptive) {
      // heuristic step only as an upper bound: accuracy is enforced by the error estimate
      var hMax = stepSize(s, L, a, eps * 4.0, rH);
      if (i == 0u) { hMax *= mix(0.2, 1.0, rnd); }
      let st = adaptiveDOPRI(s, kCur, L, a, min(hNext, hMax), hMax, tol);
      let ns = kahanAdd(s, st.d, &comp, P.ext2.w);
      n = wrapPole(ns);
      if (n.x.y != ns.x.y) { comp = GState(); }
      h = st.h;
      hNext = st.hNext;
      evals += st.evals;
      kNext = st.k;
      if (n.x.y != ns.x.y) { kNext = geodesicRHS(n.x, n.p, L, a); evals += 1u; }
    } else {
      h = stepSize(s, L, a, eps, rH);
      // random first step: decorrelates volumetric sampling between pixels / samples
      if (i == 0u) { h *= mix(0.2, 1.0, rnd); }
      let ns = kahanAdd(s, rk4Delta(s, L, a, -h), &comp, P.ext2.w);
      n = wrapPole(ns);
      if (n.x.y != ns.x.y) { comp = GState(); }
      evals += 4u;
    }
    let massive = P.star.x > 0.5 && P.star2.z > 0.0;
    if (massive || whOn) {
      // weak fields added to Kerr — the star's, the wormhole's: trapezoidal kick over the step
      // (backwards in λ: Δp = +h ∂δH/∂x)
      var f = vec3f(0.0);
      if (massive) {
        let back = normalize(blCart(n.x) - blCart(s.x));
        f += starForce(s.x, back) + starForce(n.x, back);
      }
      if (whOn) { f += mouthForce(s.x) + mouthForce(n.x); }
      f *= 0.5 * h;
      n.p += f.xy;
      L += f.z;
      if (adaptive) { kNext = geodesicRHS(n.x, n.p, L, a); evals += 1u; }
    }

    if (P.path.x > 1.5) {
      let q0 = blCart(s.x);
      let q1 = blCart(n.x);
      let pg = pathGlow(q0, q1, rayLen);
      // the disk hides the tube: skip it when it lies beyond a disk crossing in this same step
      var behindDisk = false;
      let cz0 = cos(s.x.y);
      let cz1 = cos(n.x.y);
      if (diskOn && !thick && cz0 * cz1 < 0.0) {
        let ud = cz0 / (cz0 - cz1);
        let rc = mix(s.x.x, n.x.x, ud);
        behindDisk = rc >= rIn && rc <= rOut && pg.w > ud;
      }
      // the star is opaque: it hides the tube beyond its surface in this step (then the ray ends)
      if (P.star.x > 0.5) {
        let ts = sphereHit(q0, q1, starCentre(tNow + n.x.w), P.star.z);
        if (ts >= 0.0 && pg.w > ts) { behindDisk = true; }
      }
      // the wormhole's mouth: beyond its gluing sphere the ray goes through the throat
      if (whOn) {
        let tg = glueHit(q0, q1);
        if (tg >= 0.0 && pg.w > tg) { behindDisk = true; }
      }
      if (!behindDisk) { col += trans * tubeVis * pg.rgb; }
      rayLen += length(q1 - q0);
    }

    if (P.star.x > 0.5) {
      let p0 = blCart(s.x);
      let p1 = blCart(n.x);
      let tEm = tNow + n.x.w;
      let c = starCentre(tEm);
      let t = sphereHit(p0, p1, c, P.star.z);
      if (!radio && length(p1 - c) < 4.0 * P.star.z) {
        // atmosphere in front of the photosphere (midpoint of the step, clipped at the surface)
        let frac = select(1.0, t, t >= 0.0);
        let pm = mix(p0, p1, 0.5 * frac);
        // local path length = (−p·u_ZAMO) dλ for p_t = −1
        col += trans * starGlow(pm, c, starShift(n, L, E0), tEm) * h * frac * zamoEnergy(n.x.x, n.x.y, a, L);
      }
      if (t >= 0.0) {
        let X = mix(p0, p1, t);
        if (!radio) { col += trans * shadeStar(X, c, n, L, E0, backwardDir(n, L, a), tEm); }
        trans = 0.0;
        fate = 3u;
        break;
      }
    }

    if (whOn) {
      // entering the gluing sphere of the far mouth → Dneg segment
      let p0 = blCart(s.x);
      let p1 = blCart(n.x);
      let t = glueHit(p0, p1);
      if (t >= 0.0) {
        let dW = backwardDir(n, L, a);
        wn = normalize(worldToWh(mix(p0, p1, t) - P.whC.xyz));
        wd = worldToWh(dW);
        wl = P.wh2.w;
        eloc = E0 * zamoEnergy(n.x.x, n.x.y, a, L);
        whInR = length(mix(p0, p1, t));
        whInT = mix(s.x.w, n.x.w, t);
        seg = 1u;
        entered = true;
        break;
      }
    }

    if (radio) {
      if (volOn) {
        let rs = radioFlow(n, L, E0);
        if (rs.dens > 0.0) {
          let att = exp(-rs.alpha * h);
          let add = trans * trans3 * rs.S * (vec3f(1.0) - att);
          col += add;
          trans3 *= att;
          if (polOn) {
            let R = n.x.x * sin(n.x.y);
            let m = kerrMetric(n.x.x, n.x.y, a);
            let om = 0.9 / (pow(max(R, 1.0), 1.5) + a);
            let v = sqrt(m.A / m.sig) * sin(n.x.y) * (om - 2.0 * a * n.x.x / m.A) / sqrt(max(m.sig * m.del / m.A, 1e-12));
            let pe = emitterPolarization(n, L, a, vec3f(0.0, 0.0, clamp(v, -0.99, 0.99)), flowField(n.x.y));
            stokes += P.pol.y * pe.w * add.y * stokesDir(pe.kappa, kapX, kapY);
          }
        }
      }
      if (jetOn) {
        // optically thin power law ν^−0.7: T_b ∝ g^{3.7} n ν^{−2.7}
        let j = jetSample(n, L, E0, tNow);
        if (j.n > 0.0) {
          col += trans * trans3 * P.radio2.x * j.n * j.k * h * pow(j.g, 3.7) * pow(RADIO_NU, vec3f(-2.7));
        }
      }
      if (trans * max(trans3.x, max(trans3.y, trans3.z)) < 2e-3) { fate = 3u; break; }
    } else {
      if (volOn) {
        let e = trans * volumeEmission(n, L, E0, h);
        col += e;
        if (polOn && dot(e, e) > 0.0) {
          // synchrotron: E ⟂ B in the gas frame (sub-Keplerian rotation Ω = 0.9 Ω_K)
          let R = n.x.x * sin(n.x.y);
          let m = kerrMetric(n.x.x, n.x.y, a);
          let om = 0.9 / (pow(max(R, 1.0), 1.5) + a);
          let v = sqrt(m.A / m.sig) * sin(n.x.y) * (om - 2.0 * a * n.x.x / m.A) / sqrt(max(m.sig * m.del / m.A, 1e-12));
          let pe = emitterPolarization(n, L, a, vec3f(0.0, 0.0, clamp(v, -0.99, 0.99)), flowField(n.x.y));
          stokes += P.pol.y * pe.w * luminance(e) * stokesDir(pe.kappa, kapX, kapY);
        }
      }
      if (jetOn) {
        let e = trans * jetEmission(n, L, E0, h, tNow);
        col += e;
        if (polOn && dot(e, e) > 0.0) {
          // helical field in the outflow frame: poloidal (along r̂) + toroidal, pitch P.pol.w
          let pe = emitterPolarization(n, L, a, vec3f(P.jet.y, 0.0, 0.0), vec3f(cos(P.pol.w), 0.0, sin(P.pol.w)));
          stokes += P.pol.y * pe.w * luminance(e) * stokesDir(pe.kappa, kapX, kapY);
        }
      }
    }
    if (diskOn && thick) {
      let d = diskVolume(n, L, E0, h, tNow);
      if (d.dtau > 0.0) {
        let att = exp(-d.dtau);
        if (!radio) { col += trans * d.S * (1.0 - att); }
        if (polOn && !radio) {
          let m = kerrMetric(n.x.x, n.x.y, a);
          let R = n.x.x * sin(n.x.y);
          let om = 1.0 / (pow(max(R, 1.0), 1.5) + a);
          let v = sqrt(m.A / m.sig) * sin(n.x.y) * (om - 2.0 * a * n.x.x / m.A) / sqrt(max(m.sig * m.del / m.A, 1e-12));
          let pe = emitterPolarization(n, L, a, vec3f(0.0, 0.0, clamp(v, -0.99, 0.99)), vec3f(0.0, 1.0, 0.0));
          stokes += chandrasekharPol(pe.mu) * trans * luminance(d.S) * (1.0 - att) * stokesDir(pe.kappa, kapX, kapY);
        }
        if (!hitDisk && d.dtau > 0.02) {
          gDisk = d.g;
          TDisk = d.T;
          hitDisk = true;
        }
        tubeVis *= exp(-6.0 * d.dtau);
        trans *= att;
        if (trans < 2e-3) { fate = 3u; break; }
      }
    }

    if (spotOn && !radio) {
      let sp = spotSample(n, L, E0, h, tNow);
      if (sp.dtau > 0.0) {
        let att = exp(-sp.dtau);
        col += trans * sp.S * (1.0 - att);
        trans *= att;
        if (trans < 2e-3) { fate = 3u; break; }
      }
    }

    // Equatorial plane crossing → refine by bisection on cos θ, test the disk annulus.
    let c0 = cos(s.x.y);
    let c1 = cos(n.x.y);
    if (c0 * c1 < 0.0) {
      crossings++;
      let rMin = min(s.x.x, n.x.x);
      let rMax = max(s.x.x, n.x.x);
      if (diskOn && !thick && rMax >= rIn * 0.95 && rMin <= rOut * 1.05) {
        if (!adaptive) {
          // realtime: derivatives at both ends for the Hermite interpolant
          kCur = geodesicRHS(s.x, s.p, L, a);
          kNext = geodesicRHS(n.x, n.p, L, a);
          evals += 2u;
        }
        let m = equatorCrossing(s, n, kCur, kNext, L, a, h);
        evals += 9u;
        let rc = m.x.x;
        if (rc >= rIn && rc <= rOut) {
          let hit = shadeDisk(m, L, E0, tNow);
          // radio: the ~10⁴ K disk is a black occulter next to the ~10¹⁰ K synchrotron flow
          if (!radio) { col += trans * hit.color; }
          if (!radio && QUALITY_PIPELINE && P.ret.x > 0.5 && P.misc.y < 0.5 && P.modes.y == SHIFT_FULL) {
            let u = hash4(vec3u(bitcast<u32>(look.x), bitcast<u32>(look.y), bitcast<u32>(rnd) + crossings)).xy;
            let back = returningRadiation(m, sign(cos(s.x.y)), hit.g, tNow, u);
            col += trans * (1.0 - hit.trans) * P.ret.y * back;
          }
          if (polOn && !radio) {
            // electron-scattering atmosphere: E-vector parallel to the disk surface (⟂ normal and k)
            let mt = kerrMetric(rc, PI * 0.5, a);
            let om = 1.0 / (pow(rc, 1.5) + a);
            let v = sqrt(mt.A / mt.sig) * (om - 2.0 * a * rc / mt.A) / sqrt(max(mt.sig * mt.del / mt.A, 1e-12));
            let pe = emitterPolarization(m, L, a, vec3f(0.0, 0.0, clamp(v, -0.99, 0.99)), vec3f(0.0, 1.0, 0.0));
            stokes += chandrasekharPol(pe.mu) * trans * luminance(hit.color) * stokesDir(pe.kappa, kapX, kapY);
          }
          if (!hitDisk) {
            gDisk = hit.g;
            TDisk = hit.T;
            hitDisk = true;
          }
          trans *= hit.trans;
          tubeVis *= pow(hit.trans, 6.0);
          if (trans < 2e-3) { fate = 3u; break; }
        }
      }
    }

    let r = n.x.x;
    if (r < rH + capTol || isNan(r)) { fate = 1u; break; }
    if (r > rEsc && r > s.x.x) { fate = 2u; s = n; break; }
    s = n;
    kCur = kNext;
  }
  if (entered) { continue; }
  if (fate != 2u) { break; }
  {
    // Asymptotic direction of the (backward) ray = the direction on the sky it came from.
    let d = geodesicRHS(s.x, s.p, L, a);
    let r = s.x.x;
    let st = sin(s.x.y);
    let ct = cos(s.x.y);
    let sp = sin(s.x.z);
    let cp = cos(s.x.z);
    let er = vec3f(st * cp, st * sp, ct);
    let et = vec3f(ct * cp, ct * sp, -st);
    let ep = vec3f(-sp, cp, 0.0);
    let v = normalize(-(d.dx.x * er + r * d.dx.y * et + r * st * d.dx.z * ep));
    // Remaining weak-field deflection from r to infinity along the (nearly straight) outgoing ray:
    // δ = (2M/b)(1 − √(r² − b²)/r), towards the hole (first order in M/r).
    let x = r * er;
    let xperp = x - dot(x, v) * v;
    let b = max(length(xperp), 1e-3);
    let delta = (2.0 / b) * (1.0 - sqrt(max(r * r - b * b, 0.0)) / r);
    let dir = normalize(v - delta * xperp / b);
    if (whOn) {
      // does the outgoing ray run into the far mouth's gluing sphere?
      let f = x - P.whC.xyz;
      let B = dot(f, dir);
      let c = dot(f, f) - P.wh2.z * P.wh2.z;
      if (c > 0.0 && B < 0.0 && B * B > c) {
        let X = x + (-B - sqrt(B * B - c)) * dir;
        whInT = s.x.w - (-B - sqrt(B * B - c));
        wn = normalize(worldToWh(X - P.whC.xyz));
        wd = worldToWh(dir);
        wl = P.wh2.w;
        eloc = E0 / sqrt(max(1.0 - 2.0 / length(X), 1e-3)); // weak field: static observer there
        whInR = length(X);
        seg = 1u;
        continue;
      }
    }
    if (P.path.x > 1.5) {
      // the rest of the (straight) way out, in chords of growing length
      var q = x;
      var dl = max(r, 10.0);
      for (var k = 0u; k < 8u; k++) {
        col += trans * tubeVis * pathGlow(q, q + dir * dl, rayLen).rgb;
        q += dir * dl;
        rayLen += dl;
        dl *= 2.0;
      }
    }
    skyDir = dir;
    skyG = 1.0 / E0;
    if (P.bary.x > 0.0) {
      // The distant sky is at rest in the centre-of-mass frame, which moves at u = q v★ relative to
      // the hole's frame (at the escape time): aberration and Doppler of the photon (p = −dir).
      let c = starCentre(tNow + s.x.w);
      let u = P.bary.x * P.bary.y * vec3f(-c.y, c.x, 0.0);
      let u2 = dot(u, u);
      let gu = inverseSqrt(1.0 - u2);
      let un = u * inverseSqrt(max(u2, 1e-30));
      let p = -dir;
      let E1 = gu * (1.0 - dot(u, p));
      let p1 = p + ((gu - 1.0) * dot(un, p) - gu * sqrt(u2)) * un;
      skyDir = -normalize(p1);
      skyG = 1.0 / (E0 * E1);
    }
    skyId = SKY_NATIVE;
  }
  break;
  } // segments

  col = colW + thr * col;
  out.tint = thr;
  if (fate == 2u) {
    var gBg = skyG;
    if (P.modes.y == SHIFT_NONE) { gBg = 1.0; }
    out.dir = skyDir;
    out.sky = skyId;
    if (radio) {
      // no millimetre sky (the 2.7 K CMB is negligible)
    } else if (mode == MODE_PHYSICAL) {
      out.bgW = trans;
      out.gBg = gBg;
    } else if (mode == MODE_REDSHIFT) {
      col = colormap(0.5 + 0.5 * log2(gBg)) * 0.25;
    } else {
      col = vec3f(0.0);
      out.bgW = 0.5;
      out.gBg = 1.0;
    }
  }
  out.col = col;
  out.qu = stokes;

  if (mode == MODE_REDSHIFT && hitDisk) {
    return traceOut(colormap(0.5 + 0.6 * log2(gDisk)));
  }
  if (mode == MODE_TEMPERATURE && hitDisk) {
    return traceOut(colormap(TDisk / P.disk.x));
  }
  if (mode == MODE_ORDER) {
    if (fate == 1u) { return traceOut(vec3f(0.0)); }
    if (fate == 0u) { return traceOut(vec3f(1.0, 0.0, 1.0)); }
    let base = colormap(f32(crossings) / 5.0);
    return traceOut(base * select(0.35, 1.0, hitDisk));
  }
  if (mode == MODE_STEPS) {
    // derivative evaluations, log scale from 16 to the budget (4 per step of the step limit)
    return traceOut(colormap(log2(max(f32(evals), 16.0) / 16.0) / log2(max(f32(maxSteps) * 0.25, 2.0))));
  }
  return out;
}

// Gaussian pixel filter (σ = 0.42 px, ≈ Blackman–Harris width) by Box–Muller importance sampling.
fn gaussJitter(u: vec2f) -> vec2f {
  let rad = 0.42 * sqrt(-2.0 * log(max(u.x, 1e-7)));
  return rad * vec2f(cos(TAU * u.y), sin(TAU * u.y));
}

fn luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// ---------------------------------------------------------------------------------------------
// Ray footprints on the sky (ray differentials from the neighbouring rays of the workgroup)
// ---------------------------------------------------------------------------------------------
// Every thread of an 8×8 workgroup traces a neighbouring pixel (or realtime block). After a barrier
// each escaped ray reads the sky directions of its escaped neighbours and solves for the Jacobian
// J = ∂(sky direction)/∂(pixel position), i.e. the pixel's footprint on the celestial sphere after
// lensing (like hardware dFdx/dFdy, but across ray jitter and with the best-conditioned pair of
// neighbours). The sky is then pre-filtered over that footprint: stars get their exact lensing
// magnification without sparkling, the Milky Way and images are band-limited.
var<workgroup> wgDir: array<vec4f, 64>; // escape direction, w = sky reached (0: none, 1: native, 2: ours)
var<workgroup> wgPos: array<vec2f, 64>; // sample position in pixels
var<workgroup> wgActive: atomic<u32>;   // pixels of the tile that still need samples

struct Footprint { jx: vec3f, jy: vec3f };

fn skyFootprint(lid: vec2u, d: vec3f, pos: vec2f, sky: f32) -> Footprint {
  var fp: Footprint;
  let nominal = P.camUp.w; // unlensed pixel angle
  var best = 0.0;
  var have = false;
  var dx1 = vec2f(0.0);
  var dD1 = vec3f(0.0);
  for (var sx = -1; sx <= 1; sx += 2) {
    let nx = i32(lid.x) + sx;
    if (nx < 0 || nx > 7) { continue; }
    let ih = u32(nx) + lid.y * 8u;
    if (wgDir[ih].w != sky) { continue; } // neighbours on the same sky only
    let d1 = wgPos[ih] - pos;
    let D1 = wgDir[ih].xyz - d;
    if (!have) { dx1 = d1; dD1 = D1; }
    for (var sy = -1; sy <= 1; sy += 2) {
      let ny = i32(lid.y) + sy;
      if (ny < 0 || ny > 7) { continue; }
      let iv = lid.x + u32(ny) * 8u;
      if (wgDir[iv].w != sky) { continue; }
      let d2 = wgPos[iv] - pos;
      let det = d1.x * d2.y - d2.x * d1.y;
      if (abs(det) > best) {
        best = abs(det);
        let D2 = wgDir[iv].xyz - d;
        fp.jx = (D1 * d2.y - D2 * d1.y) / det;
        fp.jy = (D2 * d1.x - D1 * d2.x) / det;
      }
    }
    have = true;
  }
  if (best > 0.2 * max(dot(dx1, dx1), 1.0)) { return fp; }
  // Fallback: isotropic footprint from one neighbour, or the unlensed pixel size.
  var k = nominal;
  if (have && dot(dx1, dx1) > 0.04) { k = max(length(dD1) / length(dx1), 0.25 * nominal); }
  var t1 = cross(d, vec3f(0.0, 0.0, 1.0));
  if (dot(t1, t1) < 1e-6) { t1 = cross(d, vec3f(1.0, 0.0, 0.0)); }
  t1 = normalize(t1);
  fp.jx = k * t1;
  fp.jy = k * cross(d, t1);
  return fp;
}

// Gaussian sky filter in the tangent plane at d: covariance C = σ² I + J Jᵀ (radians²).
struct SkyFilter { e1: vec3f, e2: vec3f, ci: vec3f, norm: f32, radius: f32 };

fn skyFilter(d: vec3f, fp: Footprint, sigma: f32) -> SkyFilter {
  var f: SkyFilter;
  var t = fp.jx - d * dot(d, fp.jx);
  if (dot(t, t) < 1e-20) {
    t = cross(d, vec3f(0.0, 0.0, 1.0));
    if (dot(t, t) < 1e-6) { t = cross(d, vec3f(1.0, 0.0, 0.0)); }
  }
  f.e1 = normalize(t);
  f.e2 = cross(d, f.e1);
  let a = vec2f(dot(f.e1, fp.jx), dot(f.e2, fp.jx));
  let b = vec2f(dot(f.e1, fp.jy), dot(f.e2, fp.jy));
  let s2 = sigma * sigma;
  let cxx = s2 + a.x * a.x + b.x * b.x;
  let cyy = s2 + a.y * a.y + b.y * b.y;
  let cxy = a.x * a.y + b.x * b.y;
  let det = max(cxx * cyy - cxy * cxy, 1e-30);
  f.ci = vec3f(cyy, cxx, -cxy) / det; // inverse covariance (xx, yy, xy)
  f.norm = 1.0 / (TAU * sqrt(det));
  // largest standard deviation
  let tr = 0.5 * (cxx + cyy);
  f.radius = sqrt(tr + sqrt(max(tr * tr - det, 0.0)));
  return f;
}

fn skyKernel(f: SkyFilter, dv: vec3f) -> f32 {
  let u = dot(dv, f.e1);
  let v = dot(dv, f.e2);
  return exp(-0.5 * (f.ci.x * u * u + f.ci.y * v * v + 2.0 * f.ci.z * u * v)) * f.norm;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u,
        @builtin(local_invocation_index) li: u32) {
  let W = u32(P.res.x);
  let H = u32(P.res.y);
  let flags = P.frame.z;
  let frameStamp = P.frame.x;
  let epoch = P.frame.y;
  let interleaved = (flags & FLAG_INTERLEAVED) != 0u;
  let temporal = (flags & FLAG_TEMPORAL) != 0u;
  let accumulate = P.region.z > 0.5;
  let si = P.res.w;

  // Pixel of this thread. Realtime: one ray per block×block tile, at a rotating offset inside the
  // tile; while the camera is still, successive frames fill every pixel (temporal super-resolution)
  // and the resolve pass reconstructs stale pixels from this frame's samples. Progressive / offline:
  // full resolution, one filtered sample per pixel per pass, in bands of rows.
  var px: u32;
  var py: u32;
  var inRange: bool;
  if (interleaved) {
    let block = u32(P.res.z);
    inRange = gid.x * block < W && gid.y * block < H;
    px = min(gid.x * block + u32(P.ext2.x), W - 1u);
    py = min(gid.y * block + u32(P.ext2.y), H - 1u);
  } else {
    px = gid.x;
    py = gid.y + u32(P.region.x);
    inRange = px < W && py < u32(P.region.y) && py < H;
  }
  let idx = py * W + px;

  // Adaptive sampling, per 8×8 tile: the tile keeps sampling while any of its pixels has a relative
  // standard error of the mean (luminance) above the threshold (keeps ray differentials available).
  if (li == 0u) { atomicStore(&wgActive, 0u); }
  workgroupBarrier();
  var need = inRange;
  if (inRange && !interleaved && accumulate && (flags & FLAG_ADAPTIVE_SPP) != 0u && si >= f32(P.frame.w)) {
    let acc = accum[idx];
    let n = max(acc.a, 1.0);
    let mean = luminance(acc.rgb) / n;
    let variance = max(moments[idx] / n - mean * mean, 0.0);
    need = sqrt(variance / n) >= P.ext.y * (mean + 0.01);
  }
  if (need) { atomicAdd(&wgActive, 1u); }
  workgroupBarrier();
  let sampling = inRange && atomicLoad(&wgActive) > 0u;

  var tr: TraceOut;
  var pos = vec2f(0.0);
  if (sampling) {
    var jit = vec2f(0.0);
    var rnd = 0.0;
    var tSample = P.time.x;
    if (interleaved) {
      let hr = hash4(vec3u(px, py, frameStamp));
      if (temporal) { jit = gaussJitter(hr.xy); }
      rnd = hr.z;
    } else {
      let rot = hash4(vec3u(px, py, 7u));
      let seq = fract(rot + si * vec4f(0.7548776662, 0.5698402910, 0.6180339887, 0.4142135624));
      if (si > 0.0 || accumulate) { jit = gaussJitter(seq.xy); }
      rnd = seq.z;
      // motion blur: sample time uniformly within the shutter interval
      tSample = P.time.x + (seq.w - 0.5) * P.ext.z;
    }
    pos = vec2f(f32(px) + 0.5, f32(py) + 0.5) + jit;
    let ndc = vec2f(2.0 * pos.x / P.res.x - 1.0, 1.0 - 2.0 * pos.y / P.res.y);
    tr = trace(ndc, rnd, tSample);
  }
  wgDir[li] = vec4f(tr.dir, select(0.0, tr.sky, sampling && tr.bgW > 0.0));
  wgPos[li] = pos;
  workgroupBarrier();
  if (!sampling) { return; }

  var col = tr.col;
  if (tr.bgW > 0.0) {
    // pre-filter width relative to the lensed pixel (the jittered samples already apply σ = 0.42 px)
    var fp = skyFootprint(lid.xy, tr.dir, pos, tr.sky);
    let k = select(0.35, 0.5, interleaved);
    fp.jx *= k;
    fp.jy *= k;
    col += tr.bgW * tr.tint * background(tr.dir, tr.gBg, fp, tr.sky);
  }
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }

  var qu = tr.qu;
  if (isNan(qu.x + qu.y)) { qu = vec2f(0.0); }
  let polOn = P.pol.x > 0.5;

  if (interleaved) {
    let old = accum[idx];
    if (temporal && stamps[idx] >= epoch && old.a > 0.0) {
      col = mix(old.rgb / old.a, col, P.ext.w);
      if (polOn) { qu = mix(polAcc[idx] / old.a, qu, P.ext.w); }
    }
    accum[idx] = vec4f(col, 1.0);
    if (polOn) { polAcc[idx] = qu; }
    stamps[idx] = frameStamp;
    return;
  }
  let l = luminance(col);
  if (accumulate) {
    accum[idx] += vec4f(col, 1.0);
    moments[idx] += l * l;
    if (polOn) { polAcc[idx] += qu; }
  } else {
    accum[idx] = vec4f(col, 1.0);
    moments[idx] = l * l;
    if (polOn) { polAcc[idx] = qu; }
  }
  stamps[idx] = frameStamp;
}

// ---------------------------------------------------------------------------------------------
// Light probe: the radiance reaching the camera from every direction, traced like the image, on an
// ENV_W × ENV_H equirectangular map of the camera's rest frame (x right, y up, z forward;
// u = atan2(x, z), v = polar angle from +y). It lights the spaceship the camera is mounted on. The
// sky is pre-filtered over a texel; successive frames are blended (weight P.ext.w-like: env blend).
// ---------------------------------------------------------------------------------------------
const ENV_W = 128u;
const ENV_H = 64u;

@compute @workgroup_size(8, 8)
fn env(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ENV_W || gid.y >= ENV_H) { return; }
  let h = hash4(vec3u(gid.xy, P.frame.x));
  let u = (f32(gid.x) + h.x) / f32(ENV_W);
  let v = (f32(gid.y) + h.y) / f32(ENV_H);
  let ph = (u - 0.5) * TAU;
  let th = v * PI;
  let dl = vec3f(sin(th) * sin(ph), cos(th), sin(th) * cos(ph));
  let look = normalize(dl.x * P.camRight.xyz + dl.y * P.camUp.xyz + dl.z * P.camFwd.xyz);
  let tr = traceLook(look, h.z, P.time.x);
  var col = tr.col;
  if (tr.bgW > 0.0) {
    // footprint of a texel on the sky (along the lensed direction's tangents)
    let t1 = normalize(cross(tr.dir, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(tr.dir.z) > 0.9)));
    let t2 = cross(tr.dir, t1);
    let w = PI / f32(ENV_H);
    col += tr.bgW * tr.tint * background(tr.dir, tr.gBg, Footprint(t1 * w, t2 * w), tr.sky);
  }
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }
  col = min(col, vec3f(60000.0));
  let i = gid.y * ENV_W + gid.x;
  let old = envBuf[i];
  // blend with the previous frames (x: blend weight of the new sample; 1 = replace)
  let k = select(P.envCfg.x, 1.0, old.a <= 0.0);
  envBuf[i] = vec4f(mix(old.rgb, col, k), 1.0);
}

// ---------------------------------------------------------------------------------------------
// Precision probe (validation only, separate pipeline): integrates the rays given in probeBuf with
// the quality integrator — with or without compensated summation — and returns the final states and
// the radii of the first three equatorial crossings found exactly as the renderer finds disk hits
// (Hermite root + RK4 sub-step), for comparison with float64 / closed-form references
// (scripts/precision-probe.ts, src/analytic.ts).
// in:  [r, θ, L, p_r], [p_θ, tolerance, compensated (0/1), 0], [0, 0, 0, 0]
// out: [r, θ, φ, t],   [p_r, p_θ, fate (1 horizon, 2 escape), steps], [r₀, r₁, r₂, crossings]
// ---------------------------------------------------------------------------------------------
@group(0) @binding(12) var<storage, read_write> probeBuf: array<vec4f>;

@compute @workgroup_size(64)
fn probe(@builtin(global_invocation_id) gid: vec3u) {
  let count = arrayLength(&probeBuf) / 3u;
  if (gid.x >= count) { return; }
  let in0 = probeBuf[3u * gid.x];
  let in1 = probeBuf[3u * gid.x + 1u];
  var s: GState;
  s.x = vec4f(in0.x, in0.y, 0.0, 0.0);
  s.p = vec2f(in0.w, in1.x);
  let L = in0.z;
  let tol = in1.y;
  let compensated = in1.z > 0.5;
  let a = P.bh.x;
  let rH = P.bh.y;
  var k = geodesicRHS(s.x, s.p, L, a);
  var hNext = 1e9;
  var comp: GState;
  var fate = 0.0;
  var steps = 0u;
  var cross = vec4f(0.0);
  var nc = 0u;
  for (var i = 0u; i < u32(P.integ.y); i++) {
    steps = i + 1u;
    let hMax = stepSize(s, L, a, P.integ.x * 4.0, rH);
    let st = adaptiveDOPRI(s, k, L, a, min(hNext, hMax), hMax, tol);
    var ns: GState;
    if (compensated) {
      ns = kahanAdd(s, st.d, &comp, P.ext2.w);
    } else {
      ns.x = s.x + st.d.x;
      ns.p = s.p + st.d.p;
    }
    let nw = wrapPole(ns);
    hNext = st.hNext;
    var kn = st.k;
    if (nw.x.y != ns.x.y) {
      comp = GState();
      kn = geodesicRHS(nw.x, nw.p, L, a);
    }
    if (cos(s.x.y) * cos(nw.x.y) < 0.0 && nc < 3u) {
      cross[nc] = equatorCrossing(s, nw, k, kn, L, a, st.h).x.x;
      nc++;
    }
    k = kn;
    let r = nw.x.x;
    let rPrev = s.x.x;
    s = nw;
    if (r < rH + P.integ.w) { fate = 1.0; break; }
    if (r > P.integ.z && r > rPrev) { fate = 2.0; break; }
  }
  cross.w = f32(nc);
  probeBuf[3u * gid.x] = s.x;
  probeBuf[3u * gid.x + 1u] = vec4f(s.p, fate, f32(steps));
  probeBuf[3u * gid.x + 2u] = cross;
}
