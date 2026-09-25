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
  ext2: vec4f,     // interleave offset x, y, disk scale height H/R (0 = thin slab), unused
  volColor: vec4f, // hot-flow colour: CIE-integrated power law ν^-α (linear sRGB)
  modes: vec4u,    // render mode, shift mode, background mode, disk enabled
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

// Error-controlled Dormand–Prince 5(4) (the integrator of MATLAB ode45 / Hairer's DOPRI5): six new
// derivative evaluations per step, the seventh stage is the derivative at the new point and is
// reused as the first stage of the next step (FSAL). The embedded 4th-order solution gives the
// local error estimate; the 5th-order solution is propagated (local extrapolation).
struct StepOut { s: GState, k: Deriv, h: f32, hNext: f32, evals: u32 };

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
    var y: GState;
    y.x = s.x + hh * (0.09114583333333333 * k1.dx + 0.44923629829290207 * k3.dx + 0.6510416666666666 * k4.dx + -0.322376179245283 * k5.dx + 0.13095238095238096 * k6.dx);
    y.p = s.p + hh * (0.09114583333333333 * k1.dp + 0.44923629829290207 * k3.dp + 0.6510416666666666 * k4.dp + -0.322376179245283 * k5.dp + 0.13095238095238096 * k6.dp);
    let k7 = geodesicRHS(y.x, y.p, L, a);
    out.evals += 6u;
    let ex = hh * (0.0012326388888888888 * k1.dx + -0.0042527702905061394 * k3.dx + 0.03697916666666667 * k4.dx + -0.05086379716981132 * k5.dx + 0.0419047619047619 * k6.dx + -0.025 * k7.dx);
    let ep = hh * (0.0012326388888888888 * k1.dp + -0.0042527702905061394 * k3.dp + 0.03697916666666667 * k4.dp + -0.05086379716981132 * k5.dp + 0.0419047619047619 * k6.dp + -0.025 * k7.dp);
    let err = errorNorm(y, ex, ep);
    if (err <= tol || it == 11 || h <= 1e-5) {
      out.s = y;
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
  return max(h, 1e-5);
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

// Turbulent structure advected with the Keplerian flow; two phases cross-faded so that
// differential rotation never winds the pattern up indefinitely (flow-map technique).
fn diskTurbulence(r: f32, phi: f32, tEm: f32, a: f32, zn: f32) -> f32 {
  let omega = 1.0 / (pow(r, 1.5) + a);
  let period = P.time.y;
  var acc = 0.0;
  for (var k = 0; k < 2; k++) {
    let ph = tEm / period + f32(k) * 0.5;
    let cyc = floor(ph);
    let fr = ph - cyc;
    let w = 1.0 - abs(2.0 * fr - 1.0);
    let ang = phi - omega * fr * period;
    let seed = cyc * 13.37 + f32(k) * 71.3;
    // clumps elongated ~3:1 along the orbit; the Keplerian shear stretches them further in time
    let lr = log(r);
    let q = vec3f(cos(ang) * 2.5, sin(ang) * 2.5, lr * 7.5 + seed);
    let clumps = fbm(q + vec3f(seed * 0.31, zn * 0.45, zn * 0.3), 5);
    let fil = fbm(vec3f(cos(ang) * 1.5, sin(ang) * 1.5, lr * 22.0 + seed * 1.7), 3);
    acc += w * (0.8 * clumps + 0.2 * fil);
  }
  // contrast stretch around the mean of the fBm
  return clamp(0.5 + 1.6 * (acc - 0.5), 0.0, 1.0);
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
fn jetEmission(s: GState, L: f32, E0: f32, dl: f32, tNow: f32) -> vec3f {
  let a = P.bh.x;
  let rH = P.bh.y;
  let r = s.x.x;
  let th = s.x.y;
  let sn = sin(th);
  let z = r * cos(th);
  let az = abs(z);
  let R = r * sn;
  let zMax = P.jet2.x;
  if (az < rH * 1.05 || az > zMax) { return vec3f(0.0); }
  let Rj = jetRadius(az, rH);
  let x = R / Rj;
  if (x > 2.2) { return vec3f(0.0); }

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
  if (n < 1e-6) { return vec3f(0.0); }

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

  // I_obs = g³ j(ν/g) = g^{8/3} x^{1/3} e^{−x/(g ν_c)}: colour from the CIE-integrated LUT
  return syncColor(g * P.jet2.y) * pow(g, 8.0 / 3.0) * n * k * dl * P.jet.w;
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

fn background(d: vec3f, g: f32, fp: Footprint) -> vec3f {
  let mode = P.modes.z;
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
    let shiftc = blackbodyShifted(6500.0, g);
    return tex * shiftc * intensity;
  }
  let filt = skyFilter(d, fp, P.time.w);
  var col = milkyWay(d, g, filt.radius);
  col += starLayer(d, 40.0, 0u, g, filt, 0.30) * 1.0;
  col += starLayer(d, 140.0, 1u, g, filt, 0.25) * 0.08;
  col += starLayer(d, 420.0, 2u, g, filt, 0.20) * 0.012;
  return col * intensity;
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
struct TraceOut { col: vec3f, bgW: f32, dir: vec3f, gBg: f32 };

fn traceOut(col: vec3f) -> TraceOut {
  var o: TraceOut;
  o.col = col;
  return o;
}

fn trace(ndc: vec2f, rnd: f32, tNow: f32) -> TraceOut {
  let a = P.bh.x;
  let rH = P.bh.y;
  let mode = P.modes.x;

  // Direction the camera looks at, in the camera rest frame (components along ZAMO axes).
  let tanH = P.cam.w;
  let aspect = P.camRight.w;
  let look = normalize(P.camFwd.xyz + ndc.x * tanH * aspect * P.camRight.xyz + ndc.y * tanH * P.camUp.xyz);

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

  // ZAMO tetrad → covariant Boyer–Lindquist momentum.
  let alpha = P.zamo.x;
  let omega = P.zamo.y;
  let varpi = P.zamo.z;
  let sqrtSig = P.zamo.w;
  let sqrtSigDel = P.zamo2.x;
  let pt = -(alpha * Ez + omega * varpi * pz.z);
  let E0 = -pt; // energy at infinity of a photon the camera measures at energy 1
  if (E0 <= 1e-6) {
    // Negative-energy photon (only possible inside the ergosphere): can't come from infinity.
    return traceOut(vec3f(0.0));
  }
  let L = varpi * pz.z / E0;
  var s: GState;
  s.x = vec4f(P.cam.x, P.cam.y, P.cam.z, 0.0);
  s.p = vec2f(sqrtSigDel * pz.x / E0, sqrtSig * pz.y / E0);

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
  var out: TraceOut;
  var kCur = geodesicRHS(s.x, s.p, L, a); // derivative at the current point (FSAL)

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
      n = wrapPole(st.s);
      h = st.h;
      hNext = st.hNext;
      evals += st.evals;
      kNext = st.k;
      if (n.x.y != st.s.x.y) { kNext = geodesicRHS(n.x, n.p, L, a); evals += 1u; }
    } else {
      h = stepSize(s, L, a, eps, rH);
      // random first step: decorrelates volumetric sampling between pixels / samples
      if (i == 0u) { h *= mix(0.2, 1.0, rnd); }
      n = wrapPole(rk4(s, L, a, -h));
      evals += 4u;
    }

    if (volOn) {
      col += trans * volumeEmission(n, L, E0, h);
    }
    if (jetOn) {
      col += trans * jetEmission(n, L, E0, h, tNow);
    }
    if (diskOn && thick) {
      let d = diskVolume(n, L, E0, h, tNow);
      if (d.dtau > 0.0) {
        let att = exp(-d.dtau);
        col += trans * d.S * (1.0 - att);
        if (!hitDisk && d.dtau > 0.02) {
          gDisk = d.g;
          TDisk = d.T;
          hitDisk = true;
        }
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
          col += trans * hit.color;
          if (!hitDisk) {
            gDisk = hit.g;
            TDisk = hit.T;
            hitDisk = true;
          }
          trans *= hit.trans;
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

  if (fate == 2u) {
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
    var gBg = 1.0 / E0;
    if (P.modes.y == SHIFT_NONE) { gBg = 1.0; }
    out.dir = dir;
    if (mode == MODE_PHYSICAL) {
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
var<workgroup> wgDir: array<vec4f, 64>; // escape direction, w = 1 if the ray reached the sky
var<workgroup> wgPos: array<vec2f, 64>; // sample position in pixels
var<workgroup> wgActive: atomic<u32>;   // pixels of the tile that still need samples

struct Footprint { jx: vec3f, jy: vec3f };

fn skyFootprint(lid: vec2u, d: vec3f, pos: vec2f) -> Footprint {
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
    if (wgDir[ih].w < 0.5) { continue; }
    let d1 = wgPos[ih] - pos;
    let D1 = wgDir[ih].xyz - d;
    if (!have) { dx1 = d1; dD1 = D1; }
    for (var sy = -1; sy <= 1; sy += 2) {
      let ny = i32(lid.y) + sy;
      if (ny < 0 || ny > 7) { continue; }
      let iv = lid.x + u32(ny) * 8u;
      if (wgDir[iv].w < 0.5) { continue; }
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
  wgDir[li] = vec4f(tr.dir, select(0.0, 1.0, sampling && tr.bgW > 0.0));
  wgPos[li] = pos;
  workgroupBarrier();
  if (!sampling) { return; }

  var col = tr.col;
  if (tr.bgW > 0.0) {
    // pre-filter width relative to the lensed pixel (the jittered samples already apply σ = 0.42 px)
    var fp = skyFootprint(lid.xy, tr.dir, pos);
    let k = select(0.35, 0.5, interleaved);
    fp.jx *= k;
    fp.jy *= k;
    col += tr.bgW * background(tr.dir, tr.gBg, fp);
  }
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }

  if (interleaved) {
    let old = accum[idx];
    if (temporal && stamps[idx] >= epoch && old.a > 0.0) {
      col = mix(old.rgb / old.a, col, P.ext.w);
    }
    accum[idx] = vec4f(col, 1.0);
    stamps[idx] = frameStamp;
    return;
  }
  let l = luminance(col);
  if (accumulate) {
    accum[idx] += vec4f(col, 1.0);
    moments[idx] += l * l;
  } else {
    accum[idx] = vec4f(col, 1.0);
    moments[idx] = l * l;
  }
  stamps[idx] = frameStamp;
}
