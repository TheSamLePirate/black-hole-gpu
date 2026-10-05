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
  camFwd: vec4f,   // w: the catalogue stars splatted (R8): radiance → fixed point (the pre-exposure × 2¹⁶); 0: not
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
  ret: vec4f,      // returning radiation on (0/1), disk albedo, max steps of secondary rays, disk haze
  radio: vec4f,    // band (0 visible, 1 230 GHz, 2 86/230/345 GHz), τ₂₃₀, ν_s(4M)/230 GHz, θ_e(4M)
  radio2: vec4f,   // jet radio brightness, flow H/R, disk smoke, unused
  spot: vec4f,     // hot spot on (0/1), orbit radius [M], size σ [M], optical depth through the centre
  spot2: vec4f,    // temperature [K], brightness, initial azimuth [rad], height above the plane [M]
  wh: vec4f,       // wormhole world on (0/1), throat radius ρ, half length a, lensing mass M (Dneg metric)
  wh2: vec4f,      // camera in the throat region (0/1), camera ℓ, gluing radius, ℓ at the gluing sphere
  whN: vec4f,      // camera n̂ (rep, see wormhole.ts), ℓ where rays leave for our sky
  whC: vec4f,      // centre of the far mouth in the black hole's frame, now; w: its orbital Ω (0: static)
  whX: vec4f,      // mouth frame axes in the black hole's frame (x at the hole, z towards the spin axis)
  whY: vec4f,
  whZ: vec4f,
  bodyCfg: vec4f,  // number of bodies (spheres: stars, planets), index of the massive star (Gargantua orbits the centre of mass with it; −1), mean radiance of the far throat over the Sun's (our side lit by it), temperature of that Sun [K]
  bodyCfg2: vec4f, // point-source scale: sub-pixel bodies drawn at the catalogue stars' flux scale (its ratio to the physical one); radiance of a magnitude −2 point spread over a pixel's glow, and its flux (highlight compression above them); index of our universe's first body (= count: none)
  path: vec4f,     // camera free-fall path: point count, tube radius per unit ray length, fate (1 horizon, 2 escape), unused
  bary: vec4f,     // Gargantua orbits the centre of mass: q = m/(M + m) (0: no), relative orbit Ω, unused, unused
  water: vec4f,    // cinematic liquid throat: on (0/1), ripple strength, reflectance at normal incidence F0, clock [s]
  water2: vec4f,   // splash where the camera went through: centre (rep unit vector), clock at the crossing
  water3: vec4f,   // glow of the liquid, a pixel's footprint on the throat [rad], unused, unused
  water4: vec4f,   // absorption of the liquid per unit path (rgb, from its colour and density), unused
  water5: vec4f,   // colour of the glow (linear rgb), unused
  envCfg: vec4f,   // light probe: reset (1), 2×2 phase, full refresh (0/1), averaging window [samples]
  // local patch (src/system/local-patch.ts): a body near the camera, along straight rays in the
  // camera's rest frame (components along the ZAMO axes, like the look directions), unit = its radius
  near0: vec4f,    // centre; w = on (0/1)
  near1: vec4f,    // the body's own axes seen in the camera frame (x away from its primary, y along
                   // its orbit, z north: fixed on its tidally locked ground); w = body index
  near2: vec4f,    // its y axis; w = radius [M]
  near3: vec4f,    // its z axis; w = lit by its source alone (0), the camera's light probe (1), its own (2)
  near4: vec4f,    // direction of its light source (camera rest frame, aberrated); w = metres per radius
  near5: vec4f,    // its atmosphere: scale height [m], sea-level density / 1.225 kg/m³ (0: none),
                   // top of the air [radii], seconds per M (the waves' clock)
  ourCam: vec4f,   // our universe: the origin of its bodies' places (the camera's place in the home
                   // frame when it is there, else the mouth: 0); w = radius of the Dneg region (r(ℓ_far))
  // the light probe's axes (components along the ZAMO axes, like the look directions): the camera's
  // for a planet's probe; fixed ones for the Ranger's (its texels keep still when the camera turns)
  envX: vec4f,
  envY: vec4f,
  envZ: vec4f,
  // the Earth (its maps loaded): on (0/1), the clouds' drift about its pole [rad], the city lights'
  // radiance (over the sunlit ground's scale), the relief's strength (its normal map)
  earth: vec4f,
  earth2: vec4f,   // the clouds' height [its radii], their opacity, the ground's albedo over its map, the air's
                   // thickness drawn (its scale heights × k)
  earth3: vec4f,   // the Moon: its direction on the Earth's axes; w: the sunlit share of its disk seen
  earth4: vec4f,   // the night sky's light (EARTH_NIGHT) over its value on the ground; y: the Sun's angular radius
                   // seen from the Earth [rad] (the eclipses), unused
  hd: vec4f,       // the finer maps (src/system/hd-maps.ts): the body's map index (−1: none), its brightness
                   // kept (the coarse map's mean over the finer's), its relief's strength (0: none), width
  fine0: vec4f,    // an airless world's ground, finest: an anchor near the camera (whole metres, multiples of
                   // 64, on the body's axes); w: on (0/1)
  fine1: vec4f,    // the camera from the anchor [m] (float64 on the CPU: the ground's centimetres exact)
  shipShadow: vec4f, // the Ranger's bounding sphere in the camera's axes (right, up, forward) [m]; w: radius (0: no shadow)
  eclipse: vec4f,  // the Moon as it shades the Earth: its centre on the Earth's axes [its radii] (where the light
                   // shows it: 1.3 s ago), w: its radius [the Earth's] (0: no eclipse near)
  nearCam0: vec4f, // the camera on the near body's axes [its radii], in float32 (an anchor: the same each frame
                   // while the ground carries the camera); w: its |·|² − 1 (float64 on the CPU)
  nearCam1: vec4f, // the camera from that anchor [radii] (float64's remainder); w: on (0/1)
  // the Earth's terrain tiles near the camera (src/system/earth-tiles.ts): the reference — cos, sin of its
  // longitude, the sine of its latitude, on (0/1) —; per level (z 6 … 13) the reference in its valid
  // rectangle [px], the rectangle's corner in its layer [px]; the rectangle's size [px], the level's
  // pixels per radian, on
  tiles: vec4f,
  tileL: array<vec4f, 16>,
  // the runways near the camera (src/game/sites.ts, at most RWY_MAX): [0].x their count; then each its
  // threshold's geodetic unit direction (w: its length [m]), its landing direction (w: its half width [m]),
  // its right, and the camera from its threshold on the Earth's squashed axes [m] (float64 on the CPU)
  runways: array<vec4f, 17>,
  // the sea's resolved waves near the camera (renderer: seaParams; seaShade): [0] the wind's way at the
  // camera (the Earth's axes), its speed at 10 m; [1] across it, w: their weight (1 under 15 km, 0 above
  // 30); [2] the camera in that frame from an anchor of whole kilometres [m], the anchor in 256 m cells;
  // [3…14] twelve waves: their wavenumber (integers, units of 2π/1024 m: exact from the anchor), slope
  // amplitude, phase now
  sea: array<vec4f, 15>,
  // the near body's measured heights in its finer relief (hd-maps.ts: the Moon's LOLA, Mars's MOLA): on
  // (0/1), their highest and lowest [m] (the relief's shell), the body's radius [m]
  hd2: vec4f,
};

// Pipeline specialisation: the error-controlled integrator is compiled only into the quality
// pipeline, keeping the realtime kernel small (register pressure / occupancy).
override QUALITY_PIPELINE: bool = false;

// Kernel specialisation (renderer.ts: traceVariant): a feature the scene does not use compiled out —
// the uber-kernel's branches and their registers, on the scenes that have none of them (the Gargantua
// system: no radio band, no polarization, no jet, no hot spot, no hot flow). The general pipeline keeps
// them all (true).
override HAS_RADIO: bool = true;
override HAS_POL: bool = true;
override HAS_JET: bool = true;
override HAS_SPOT: bool = true;
override HAS_VOL: bool = true;
override HAS_WH: bool = true;     // the wormhole world
override HAS_THICK: bool = true;  // the volumetric (thick) disk
override HAS_BODIES: bool = true; // planets, moons, stars as bodies (and the near body's ground)
override HAS_RWY: bool = true;    // runways near the camera (their grading and drawing: out of the kernel elsewhere)
// the hole's and the mouth's metrics (O13): off in our universe from afar — the camera beyond the mouth's
// Dneg region, the region under a pixel —, every ray straight through our bodies to our sky, the Kerr and
// Dneg integrators out of the kernel (its registers)
override HAS_KERR: bool = true;

const FLAG_ADAPTIVE_RK = 1u;    // step-doubling error control + Richardson extrapolation
const FLAG_ADAPTIVE_SPP = 2u;   // skip converged pixels (progressive / offline)
const FLAG_TEMPORAL = 4u;       // temporal accumulation of realtime samples
const FLAG_INTERLEAVED = 8u;    // realtime pass: one pixel per block, rotating offset
const FLAG_LUT = 32u;           // the far field's LUT is there: rays between clean samples read it (main: farLut)
const FLAG_REPROJECT = 16u;     // realtime under the temporal reprojection: the frames' rays accumulate —
                                // each prefiltered over its pixel (the history supplies the coverage)

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4f>;
@group(0) @binding(2) var<storage, read> luts: array<vec4f>; // the blackbody's colours (LUT_N), then the synchrotron's (SYNC_N)
@group(0) @binding(3) var bgTex: texture_2d<f32>;
@group(0) @binding(4) var bgSamp: sampler;
@group(0) @binding(5) var<storage, read_write> moments: array<vec2f>; // Σ luminance², depth (mean) per pixel
@group(0) @binding(6) var<storage, read_write> stamps: array<u32>;  // frame of the last sample
// the catalogue stars of a realtime frame, splatted where they fall (R8): 3 × u32 per pixel, fixed point
// (radiance × P.camFwd.w — the pre-exposure × 2¹⁶), cleared before the frame (post.wgsl: stars)
@group(0) @binding(7) var<storage, read_write> starSplat: array<atomic<u32>>;
@group(0) @binding(8) var mwTex: texture_2d<f32>;      // Gaia DR2 Milky Way (linear, mip-mapped)
@group(0) @binding(9) var starLodTex: texture_2d<f32>; // catalogue radiance map (large footprints)
// Star catalogue: [magic, grid, count, 0, cellStart[6·grid² + 1], stars (x, y, z, mag|T packed)]
@group(0) @binding(10) var<storage, read> catalogue: array<u32>;
@group(0) @binding(11) var<storage, read_write> polAcc: array<vec2f>; // Σ Stokes Q, U (luminance)
// camera path: 256 points (xyz, fraction along the path), then bounding spheres of chunks of 16 segments
@group(0) @binding(13) var<storage, read> pathPts: array<vec4f>;
// light probe around the camera (equirectangular, camera rest frame), for the Ranger's lighting
@group(0) @binding(14) var<storage, read_write> envBuf: array<vec4f>;
// Bodies drawn as spheres (src/system/scene-bodies.ts), 6 vec4 each:
//   0: centre now (parent < 0) or offset from the parent's centre now; radius
//   1: Ω (turning rate of its circle about the spin axis), parent index (−1), kind (0 star, 1 planet), mass m [M]
//   2: stars: temperature [K], brightness; planets: albedo (mapped: over its map's mean); surface (0
//      ocean, 1 ice, 2 rock, 3 gas, 4 + n: drawn from map n); seed, or the inner radius of its rings
//   3: planets: light source (body index, −1: the accretion disk), irradiance factor E/(πB);
//      where: 0 traced (within the escape radius), 1 far (met on the rays' straight way out),
//      2 our universe (home coordinates, relative to P.ourCam), 4 the same within the Dneg region,
//      3 drawn in the local patch; outer radius of its rings (its radii; 0: none)
//   4: planets: where its light comes from, as its light probe measured it (black-hole frame, unit);
//      w = its colour temperature [K] when measured, else 0 (the hole's direction, or its star's)
//   5: pole (its universe's frame), turn about it now (radians)
// Places are computed on the CPU in float64 at the frame's time: the GPU only turns them by Ω·Δt for
// the retarded time Δt along the ray (no absolute time in float32).
@group(0) @binding(15) var<storage, read> bodies: array<vec4f>;
const BV = 6u; // vec4s per body (src/system/scene-bodies.ts: BODY_VEC4)
// The solar system's maps (equirectangular, sRGB) and Saturn's rings' radial profile (sRGB + opacity,
// from the inner to the outer radius), mip-mapped (src/system/planet-maps.ts)
@group(0) @binding(16) var mapHi: texture_2d_array<f32>; // 2048 × 1024 (solar.ts: MAPS_HI)
@group(0) @binding(17) var ringTex: texture_2d<f32>;
@group(0) @binding(18) var mapLo: texture_2d_array<f32>; // 1024 × 512 (MAPS_LO)
const MAPS_HI = 6u;

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
// (x² — WGSL's pow is exp2(y·log2 x): undefined for x < 0 on some backends, D3D and Vulkan among them)
fn sq(x: f32) -> f32 { return x * x; }
fn u2f(u: u32) -> f32 { return f32(u >> 8u) * (1.0 / 16777216.0); }
fn hash4(p: vec3u) -> vec4f {
  let h = hash3u(p);
  let h2 = pcg(h);
  let h3 = pcg(h2);
  let h4 = pcg(h3);
  return vec4f(u2f(h), u2f(h2), u2f(h3), u2f(h4));
}
// Interleaved gradient noise (Jimenez 2014): blue-ish in space, cheap — a pixel's value differs from its
// neighbours', so per-pixel randomness reads as fine grain, not clumps
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn hash31(p: vec3f) -> f32 {
  return u2f(hash3u(bitcast<vec3u>(vec3i(floor(p)))));
}

// 3D value noise + fBm
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  // (hash31 at the 8 corners, their z and y stages shared: 14 pcg instead of 24, the same bits)
  let b = bitcast<vec3u>(vec3i(i));
  let z0 = pcg(b.z);
  let z1 = pcg(b.z + 1u);
  let y00 = pcg(b.y ^ z0);
  let y10 = pcg((b.y + 1u) ^ z0);
  let y01 = pcg(b.y ^ z1);
  let y11 = pcg((b.y + 1u) ^ z1);
  let x1 = b.x + 1u;
  let n000 = u2f(pcg(b.x ^ y00));
  let n100 = u2f(pcg(x1 ^ y00));
  let n010 = u2f(pcg(b.x ^ y10));
  let n110 = u2f(pcg(x1 ^ y10));
  let n001 = u2f(pcg(b.x ^ y01));
  let n101 = u2f(pcg(x1 ^ y01));
  let n011 = u2f(pcg(b.x ^ y11));
  let n111 = u2f(pcg(x1 ^ y11));
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
  return mix(luts[i0], luts[i1], fract(x));
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
  let o = u32(LUT_N);
  return mix(luts[o + i0].rgb, luts[o + i1].rgb, fract(x));
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
  return stepSizeAt(s, L, a, eps, rH, blCart(s.x));
}
// (the same, the state's Cartesian place pc given: the tracer keeps it from the step before)
fn stepSizeAt(s: GState, L: f32, a: f32, eps: f32, rH: f32, pc: vec3f) -> f32 {
  let r = s.x.x;
  let sn = max(sin(s.x.y), 1e-6);
  let c = cos(s.x.y);
  let sig = r * r + a * a * c * c;
  var h = eps * (r - rH) * (1.0 + 0.01 * r);
  h = min(h, eps * sig * sn * sn / (abs(L) + 1e-3));
  h = min(h, eps * sig * max(sn, 0.02) / (abs(s.p.y) + 1e-3));
  let hr = P.ext2.z;
  if (HAS_THICK && hr > 0.0 && P.modes.w == 1u) {
    // volumetric disk: never jump over the layer |z| < 4H (8H with its haze; the smoke's, ~0.5 M above
    // the surface, beyond 8 M), sample it at
    // ≲ 0.4 H across; along it ≲ 0.08 R — ≲ 0.1 M through the smoke (clouds an M across: their
    // outlines drawn, not averaged away, nor stepped — each step only partly opaque; 0.25 M in the
    // realtime passes, a block per ray: the refining passes and offline frames take the fine one)
    let R = r * sn;
    if (R > P.bh.z * 0.8 && R < P.bh.w * DISK_REACH * 1.05) {
      let H = hr * R;
      let d = geodesicRHS(s.x, s.p, L, a);
      let zdot = abs(d.dx.x * c - r * sn * d.dx.y) + 1e-4;
      let dist = abs(r * c) - max(select(4.0, 8.0, P.ret.w > 0.0) * H, select(0.0, 2.5 * H + 1.0, P.radio2.z > 0.0 && R > 8.0));
      h = min(h, (max(dist, 0.0) + 0.4 * H) / zdot);
      if (dist < 0.0) {
        h = min(h, 0.08 * R);
        if (P.radio2.z > 0.0 && R > 8.0) { h = min(h, select(0.1, 0.25, (P.frame.z & FLAG_INTERLEAVED) != 0u)); }
      }
    }
  }
  if ((HAS_JET && P.jet.x > 0.5)) {
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
  let nb = ourStart();
  if (nb > 0u) {
    // never step over a body (nor a star's atmosphere, 3 R); sample a star finely near the limb (the
    // traced ones only: those met on the rays' straight way out — K2, Edmunds, 2 000 AU off — do not
    // bound the steps)
    for (var k = 0u; k < nb; k++) {
      if (bodyWhere(k) != 0u) { continue; }
      let R = bodyRadius(k);
      let d = length(pc - bodyCentre(k, P.time.x + s.x.w)) / R;
      let near = (0.03 + 0.12 * max(d - 1.0, 0.0)) * R;
      h = min(h, max(0.7 * (d - 4.0) * R, near));
      // a massive star bends the ray: steps small against the distance to it (kick accuracy)
      if (bodyMass(k) > 0.0) { h = min(h, max(0.3 * d * R, near)); }
    }
  }
  if (HAS_WH && P.wh.x > 0.5) {
    // the wormhole's weak field outside its gluing sphere: steps small against the distance to it
    let dm = length(pc - whCentre(P.time.x + s.x.w));
    h = min(h, max(0.3 * dm, 0.2 * P.wh2.z));
  }
  if ((HAS_SPOT && P.spot.x > 0.5)) {
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
      // close to the camera the minimum radius would make the tube a wide blob (and, seen from the
      // inside — the camera sits on its own path — light every pixel): keep only crossings where
      // the tube has its constant apparent width (radius ∝ distance)
      let dMid = rayLen + 0.5 * (u1 + u2) * len;
      let wgt = min((u2 - u1) * len / (2.0 * R), 1.0) * smoothstep(0.4, 1.0, P.path.y * dMid / 0.004) * smoothstep(6.0, 20.0, dMid / R);
      col += tint * dash * wgt * 0.9;
      uSum += 0.5 * (u1 + u2) * wgt;
      wSum += wgt;
    }
  }
  return vec4f(col, uSum / max(wSum, 1e-6));
}

// Bodies: opaque spheres on circular orbits (around the hole, or around a parent), evaluated at the
// emission time. A star's photosphere is a limb-darkened blackbody with granulation; a planet reflects
// the light of the disk or of its star. Frequency shifts use the orbital motion of the centre (rigid
// rotation Ω around the hole) at the point hit.
fn bodyCount() -> u32 { return select(0u, u32(P.bodyCfg.x), HAS_BODIES); }
// Gargantua's side: bodies [0, ourStart()); ours: [ourStart(), bodyCount())
fn ourStart() -> u32 { return min(u32(P.bodyCfg2.w), bodyCount()); }
fn isOurs(k: u32) -> bool { let w = bodyWhere(k); return w == 2u || w == 4u; }
fn bodyRadius(k: u32) -> f32 { return bodies[BV * k].w; }
fn bodyMass(k: u32) -> f32 { return bodies[BV * k + 1u].w; }
fn bodyKind(k: u32) -> u32 { return u32(bodies[BV * k + 1u].z); }
fn bodyWhere(k: u32) -> u32 { return u32(bodies[BV * k + 3u].z); }
// A pixel's footprint radius at a distance d along its ray (unlensed estimate: the beam of one pixel)
fn footprint(d: f32) -> f32 { return 0.75 * beam() * d; }
// The angle of a sample's beam: the pixel's, or the light probe's texel (its rays stand for a whole
// texel: what is smaller than that is spread over it, not met by chance — see env)
var<private> probeBeam: f32 = 0.0;
// the angle one ray stands for: a pixel — a block of them in the realtime passes (FOOT, set by the main
// kernel: textures, relief and small bodies filtered over what the ray is spread on, not a pixel of it)
var<private> FOOT: f32 = 1.0;
// (the main kernel's choice for the near body met first — its ground — and for the rest: under the
// temporal reprojection the rest is prefiltered over the pixel, the history supplying the coverage,
// the near ground over the block — its parallax and relief defeat the reprojection, it is drawn afresh)
var<private> FOOT_NEAR: f32 = 1.0;
var<private> FOOT_FAR: f32 = 1.0;
// The catalogue stars splatted (R8: realtime under the reprojection, P.camFwd.w > 0): the main kernel's
// ray of a block, at SPLAT_POS [px], owning the block from SPLAT_CELL; its sky light weighed by SPLAT_MUL
// (what lies in front, the sky's share), its footprint over a pixel the sky filter's ÷ SPLAT_K
// (the sea seen near: the point from the camera [m, the Earth's axes, unsquashed] — earthNear sets it)
var<private> SEA_ON: bool = false;
var<private> SEA_D: vec3f;
var<private> SPLAT: bool = false;
var<private> SPLAT_POS: vec2f;
var<private> SPLAT_CELL: vec2f;
var<private> SPLAT_MUL: vec3f;
var<private> SPLAT_K: f32 = 1.0;
fn pixFoot() -> f32 { return P.camUp.w * FOOT; }
fn beam() -> f32 { return max(pixFoot(), probeBeam); }
// The pseudo surface point of a body whose light is spread over rEff > R: the ray passing at qc from
// the centre (|qc| < rEff) sees the point of a sphere of radius rEff above qc — so a sub-pixel planet
// still shows its phase (a crescent a pixel wide), and a star its limb darkening.
fn glowPoint(c: vec3f, qc: vec3f, rEff: f32, R: f32, dW: vec3f) -> vec3f {
  let q = qc / rEff;
  let nrm = normalize(q + sqrt(max(1.0 - dot(q, q), 0.0)) * -dW);
  return c + R * nrm;
}
// Soft uniform disc of radius 1 (area-normalised over the unit disc)
fn glowProfile(q: f32) -> f32 { return (1.0 - smoothstep(0.75, 1.0, q)) * 1.28; }
// Bodies smaller than a pixel are drawn like the sky's catalogue stars: their flux turned into an
// apparent magnitude, then at the catalogue's (photographic) scale — the disk's exposure would hide
// them. The boost fades out as the body grows to a few pixels (R/rEff from ½ to 4), where it is seen
// at the physical scale of the disk.
fn pointBoost(ratio: f32) -> f32 { return exp2(log2(max(P.bodyCfg2.x, 1.0)) * (1.0 - smoothstep(0.5, 4.0, ratio))); }
// Points brighter than magnitude −2 (Jupiter) are compressed logarithmically: the order of the
// brightnesses is kept, a magnitude −10 star no longer floods the frame with its bloom.
fn compressPoint(c: vec3f) -> vec3f {
  let Lm = P.bodyCfg2.y;
  let L = luminance(c);
  if (Lm <= 0.0 || L <= Lm) { return c; }
  return c * (Lm * (1.0 + log(L / Lm)) / L);
}
fn rotZ(p: vec3f, ang: f32) -> vec3f {
  let c = cos(ang);
  let s = sin(ang);
  return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}
// centre at the emission time tEm (P.time.x: now)
fn bodyCentre(k: u32, tEm: f32) -> vec3f {
  let dt = tEm - P.time.x;
  let b0 = bodies[BV * k];
  let b1 = bodies[BV * k + 1u];
  var c = rotZ(b0.xyz, b1.x * dt);
  let par = i32(b1.y);
  if (par >= 0) {
    let q = u32(par);
    c += rotZ(bodies[BV * q].xyz, bodies[BV * q + 1u].x * dt);
  }
  return c;
}
// coordinate velocity of the centre
fn bodyVelocity(k: u32, tEm: f32) -> vec3f {
  let dt = tEm - P.time.x;
  let b0 = bodies[BV * k];
  let b1 = bodies[BV * k + 1u];
  let c = rotZ(b0.xyz, b1.x * dt);
  var v = b1.x * vec3f(-c.y, c.x, 0.0);
  let par = i32(b1.y);
  if (par >= 0) {
    let q = u32(par);
    let cp = rotZ(bodies[BV * q].xyz, bodies[BV * q + 1u].x * dt);
    v += bodies[BV * q + 1u].x * vec3f(-cp.y, cp.x, 0.0);
  }
  return v;
}
// the turning rate of the frame the body is carried in around the hole (its parent's for a moon)
fn bodyOmega(k: u32) -> f32 {
  let par = i32(bodies[BV * k + 1u].y);
  if (par >= 0) { return bodies[BV * u32(par) + 1u].x; }
  return bodies[BV * k + 1u].x;
}
// the far mouth at the emission time (it may orbit the hole), and its velocity
fn whCentre(tEm: f32) -> vec3f { return rotZ(P.whC.xyz, P.whC.w * (tEm - P.time.x)); }
fn whVelocity(tEm: f32) -> vec3f {
  let c = whCentre(tEm);
  return P.whC.w * vec3f(-c.y, c.x, 0.0);
}
// The far throat when it is smaller than the pixel's footprint: the mean radiance of its disk — our
// universe seen through it, dominated by our Sun: B☉ (R☉/d☉)²/4 (P.bodyCfg.z, 0 without a Sun) —
// spread over the footprint around the ray's line (X a point on it, dW its backward direction).
fn throatGlow(X: vec3f, dW: vec3f, C: vec3f, dist: f32, g: f32) -> vec3f {
  if (P.bodyCfg.z <= 0.0) { return vec3f(0.0); }
  let rho = P.wh.y;
  let rEff = footprint(dist);
  if (rho >= rEff) { return vec3f(0.0); }
  let w = C - X;
  let b = length(w - dot(w, dW) * dW);
  if (b >= rEff) { return vec3f(0.0); }
  return compressPoint(blackbody(P.bodyCfg.w * g, P.disk.w) * P.bodyCfg.z * (rho * rho / (rEff * rEff)) * glowProfile(b / rEff) * pointBoost(rho / rEff));
}

// Bodies at a finite distance beyond where the rays leave for their sky (the K2 star and Edmunds on
// Gargantua's side, the Sun on ours): drawn like the catalogue stars — with the sky filter of the
// pixel's lensed footprint (from the neighbouring rays: magnification, anti-aliasing) — around their
// direction seen from the ray's point of departure (parallax), at the retarded time. Flux: B π R²/D²,
// turned to the catalogue's scale (P.bodyCfg2.x), compressed above magnitude −2.
// (the light probes take them at their true flux, uncompressed: the Sun lights the Ranger near Saturn)
var<private> physicalPoints: bool = false;
// (the Ranger's probe with its key light on — the near world's star, analytic: see env — leaves the
// stars out: their light is in the key)
var<private> probeNoStar: bool = false;
// (the light probe: its ray's offset from the texel's centre — the points' filter is taken there, so
// that a texel's share of a point does not depend on where its ray fell)
var<private> probeShift: vec3f = vec3f(0.0);
fn farPoints(side: u32, d: vec3f, org: vec4f, filt: SkyFilter, g: f32) -> vec3f {
  var col = vec3f(0.0);
  let k0 = select(0u, ourStart(), side == 2u);
  let k1 = select(ourStart(), bodyCount(), side == 2u);
  for (var k = k0; k < k1; k++) {
    let ours = side == 2u;
    if (select(bodyWhere(k) != side, !isOurs(k), ours)) { continue; }
    if (probeNoStar && bodyKind(k) == 0u) { continue; }
    var c = bodyCentre(k, org.w);
    if (!ours) { c = bodyCentre(k, org.w - length(c - org.xyz)); }
    let v = c - org.xyz;
    let D = length(v);
    let bd = v / D;
    let R = bodyRadius(k);
    // (ours: only when smaller than the pixel — larger, the rays meet it: ourSegment)
    if (ours && R * max(ringOuter(k), 1.0) >= 0.5 * beam() * (D + org.w)) { continue; }
    // (the filter lives in the tangent plane at d: a point behind the ray would land on its centre)
    if (dot(d, bd) <= 0.0) { continue; }
    let kern = skyKernel(filt, d - probeShift - bd);
    if (kern < 1e-4 * filt.norm) { continue; }
    // the side it shows (a planet's phase, at its sub-observer point), its flux there
    let F = shadeBody(k, c - R * bd, c, g, bd, org.w - D) * (PI * R * R / (D * D));
    // (our universe: at its true flux, like the resolved bodies around it)
    if (physicalPoints || ours) {
      col += F * kern;
      continue;
    }
    let Fs = F * P.bodyCfg2.x;
    let Lm = P.bodyCfg2.z;
    let Lf = luminance(Fs);
    let comp = select(1.0, Lm * (1.0 + log(Lf / max(Lm, 1e-30))) / max(Lf, 1e-30), Lm > 0.0 && Lf > Lm);
    col += Fs * comp * kern;
  }
  return col;
}

// A photon (travel direction d, energy 1) seen from a frame moving at v: its direction there and its
// energy (Doppler factor γ(1 − v·d)). The frames' axes are parallel.
struct Boosted { d: vec3f, e: f32 }
fn boostPhoton(d: vec3f, v: vec3f) -> Boosted {
  let v2 = dot(v, v);
  if (v2 < 1e-14) { return Boosted(d, 1.0); }
  let g = inverseSqrt(1.0 - v2);
  let vn = v * inverseSqrt(v2);
  let e = g * (1.0 - dot(v, d));
  let dp = (d + ((g - 1.0) * dot(d, vn) - g * sqrt(v2)) * vn) / e;
  return Boosted(normalize(dp), e);
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

fn bodyShift(k: u32, n: GState, L: f32, E0: f32) -> f32 {
  let a = P.bh.x;
  let om = bodyOmega(k);
  if (P.modes.y == SHIFT_NONE) { return 1.0; }
  // the light also climbs out of the body's own potential: × (1 + Φ★) = 1 − m/d
  let dS = length(blCart(n.x) - bodyCentre(k, P.time.x + n.x.w));
  let gS = 1.0 - bodyMass(k) / max(dS, bodyRadius(k));
  return gS * (1.0 / E0) / circularEmitterEnergy(max(n.x.x, 1.01 * P.bh.y), n.x.y, a, L, om);
}

// Mass of a body (m): the linearized field of a moving mass,
// h_μν = −2Φ (η_μν + 2 u_μ u_ν) with Φ = −m/d (d measured in the star's rest frame), added to the
// Kerr metric in its flat far-field map. For a photon (p_t = −1) δH = −½ h^μν p_μ p_ν
// = 2Φ γ² (1 − v·p)²: the deflection is 4m/b (twice Newton's) × (1 − v∥) for a star moving along
// the line of sight (Pyne & Birkinshaw 1993). Returns ∂δH/∂(r, θ, φ), which kicks p_r, p_θ and L (no
// longer conserved near the star); `back`: unit direction of the backward ray (p̂ = −back).
fn bodyForce(b: u32, x: vec4f, back: vec3f) -> vec3f {
  let st = sin(x.y);
  let ct = cos(x.y);
  let sp = sin(x.z);
  let cp = cos(x.z);
  let er = vec3f(st * cp, st * sp, ct);
  let tEm = P.time.x + x.w;
  let c = bodyCentre(b, tEm);
  let v = bodyVelocity(b, tEm);
  let m = bodyMass(b);
  let R = bodyRadius(b);
  let g2 = 1.0 / (1.0 - dot(v, v));
  let dv = x.x * er - c;
  let dvv = dot(dv, v);
  let d2 = max(dot(dv, dv) + g2 * dvv * dvv, R * R); // rest-frame distance²
  let k = 1.0 + dot(v, back);                        // 1 − v·p̂
  var g = (2.0 * m * g2 * k * k) * (dv + g2 * dvv * v) / (d2 * sqrt(d2)); // ∇δH
  // The hole's frame falls towards the star (Gargantua orbits the centre of mass) with
  // a = m x★/D³: the uniform "indirect" field, g_tt = −(1 + 2a·x), δH = a·x for light.
  if (i32(b) == i32(P.bodyCfg.y)) {
    let D = length(c);
    g += (m / (D * D * D)) * c;
  }
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
  let dv = x.x * er - whCentre(P.time.x + x.w);
  let d2 = max(dot(dv, dv), P.wh2.z * P.wh2.z);
  let g = (P.wh.w / (d2 * sqrt(d2))) * dv;
  return vec3f(dot(g, er), x.x * dot(g, vec3f(ct * cp, ct * sp, -st)), x.x * st * dot(g, vec3f(-sp, cp, 0.0)));
}

// Photosphere: the emergent temperature falls towards the limb, T(μ) = T (0.2 + 0.8 μ)^¼ (steeper
// than a grey atmosphere, as the visible continuum of the Sun), which gives both the limb darkening
// and the redder limb: a white-hot centre fading to orange and red.
fn shadeStar(k: u32, X: vec3f, c: vec3f, g: f32, dW: vec3f, tEm: f32) -> vec3f {
  let nrm = normalize(X - c);
  let mu = clamp(-dot(nrm, dW), 0.0, 1.0);
  let surf = starSurface(nrm, tEm);
  let b2 = bodies[BV * k + 2u];
  let T = b2.x * pow(0.2 + 0.8 * mu, 0.25) * surf.y;
  return blackbody(T * g, P.disk.w) * b2.y * surf.x;
}

// A planet: reflects the light of the accretion disk (from the hole's direction) or of its star, with
// a surface of its kind (ocean with its glint, ice, rock, banded gas) and a thin atmosphere at the
// limb. The reflected light keeps the source's spectrum: a blackbody at the source temperature, then
// shifted by the planet's motion and the gravity climbed (g), like any emitter.
fn shadePlanet(k: u32, X: vec3f, c: vec3f, g: f32, dW: vec3f, tEm: f32) -> vec3f {
  let nrm = normalize(X - c);
  var ldir = normalize(-X);
  let li = i32(bodies[BV * k + 3u].x);
  if (li >= 0) { ldir = normalize(bodyCentre(u32(li), tEm) - X); }
  // (as its light probe measured it: Miller's light comes from ahead of its motion, aberrated)
  let lm = bodies[BV * k + 4u];
  if (lm.w > 0.5) { ldir = rotZ(lm.xyz, bodyOmega(k) * (tEm - P.time.x)); }
  return planetShade(k, nrm, bodyFixed(k, nrm, tEm), ldir, -dW, tEm, g, 1.0);
}

// A black-hole-frame direction on the body's own axes (x away from its primary, y along its orbit,
// z north): tidally locked, its ground is fixed in them
fn bodyFixed(k: u32, n: vec3f, tEm: f32) -> vec3f {
  if (k >= ourStart()) { return spunAxes(k) * n; }
  var host = vec3f(0.0);
  let par = i32(bodies[BV * k + 1u].y);
  if (par >= 0) { host = bodyCentre(u32(par), tEm); }
  let c = bodyCentre(k, tEm) - host;
  let er = normalize(vec3f(c.xy, 0.0));
  let ep = vec3f(-er.y, er.x, 0.0);
  return vec3f(dot(n, er), dot(n, ep), n.z);
}

// A planet's surface colour at a unit direction on its own axes (albedo rgb; w: surface kind)
fn planetAlbedo(k: u32, qb: vec3f, tEm: f32) -> vec4f {
  let b2 = bodies[BV * k + 2u];
  let nrm = qb;
  let q = qb * 3.0 + vec3f(b2.w);
  let n1 = 0.5 + 0.5 * gnoise(q);
  let n2 = 0.5 + 0.5 * gnoise(q * 3.7 + vec3f(1.7));
  var alb: vec3f;
  let surf = u32(b2.z);
  // (Gargantua's worlds: patterns at every scale the pixel resolves — its footprint from the map's
  // level: fractal noise to as many octaves)
  let fpA = exp2(mapLod()) * TAU / 2048.0;
  let oc = clamp(log2(1.0 / (fpA * 6.0)), 1.0, 11.0);
  if (surf == 0u) {
    // Miller: knee-deep water over a pale bed — blue-green, lighter shoals, darker channels; the giant
    // waves' trains (the relief's: ~2 900 km apart) white with foam along their crests
    let f = tfbmF(q * 2.0 + vec3f(3.3), oc);
    alb = mix(vec3f(0.06, 0.16, 0.22), vec3f(0.32, 0.5, 0.5), smoothstep(-0.35, 0.45, f));
    let tSec = select(0.0, tEm * P.near5.w, u32(P.near1.w) == k);
    var crest = 0.0;
    for (var i = 0u; i < 3u; i++) {
      let fi = f32(i);
      let dir = normalize(vec3f(cos(fi * 2.1 + 0.3), sin(fi * 2.1 + 0.3), 0.35 * fi - 0.3));
      let ph = dot(qb, dir) * 14.0 + fi * 1.7 - tSec * (4.0e-5 + 1.0e-5 * fi);
      crest = max(crest, pow(0.5 + 0.5 * sin(ph), 40.0));
    }
    alb = mix(alb, vec3f(0.7, 0.75, 0.76), crest * 0.22);
  } else if (surf == 1u) {
    // Mann: snowfields, blue glacial ice in the lows, dark rock on the ridges, drifts
    let f = tfbmF(q * 1.5 + vec3f(1.9), oc);
    let r = ridged(q * 3.0 + vec3f(5.0), 4);
    alb = mix(vec3f(0.5, 0.62, 0.75), vec3f(0.82, 0.85, 0.88), smoothstep(-0.3, 0.3, f));
    alb = mix(alb, vec3f(0.25, 0.26, 0.28), smoothstep(0.85, 0.97, r) * 0.6);
    alb *= 0.9 + 0.1 * tfbmF(q * 40.0, max(oc - 2.0, 1.0));
  } else if (surf == 2u) {
    // Edmunds: a desert — ochre, rust, grey rock, pale sand in the basins
    let f1 = tfbmF(q * 1.2 + vec3f(7.1), oc);
    let f2 = tfbmF(q * 4.0 + vec3f(2.3), max(oc - 1.0, 1.0));
    alb = mix(vec3f(0.6, 0.45, 0.29), vec3f(0.52, 0.31, 0.19), smoothstep(-0.25, 0.25, f1));
    alb = mix(alb, vec3f(0.36, 0.34, 0.32), smoothstep(0.2, 0.5, f2) * 0.8);
    alb = mix(alb, vec3f(0.76, 0.7, 0.58), smoothstep(0.25, 0.5, -f1) * 0.7);
    // (near: the rock's own mottling, kilometres down to metres)
    alb *= 0.8 + 0.4 * (0.5 + 0.5 * tfbmF(q * 300.0 + vec3f(4.4), max(oc - 6.0, 0.0)));
  } else if (surf >= 4u) {
    // its map: longitude about the pole, latitude (linear: an sRGB view; scaled to its albedo)
    let lon = atan2(nrm.y, nrm.x);
    let lat = asin(clamp(nrm.z, -1.0, 1.0));
    let uv = vec2f(0.5 + lon / TAU, 0.5 - lat / PI);
    let m = surf - 4u;
    var t: vec3f;
    var gain = 1.0;
    if (i32(m) == i32(P.hd.x)) {
      // (its finer map, the camera near: its level from the footprint, its brightness the coarse map's)
      t = textureSampleLevel(hdColor, bgSamp, uv, hdMapLod(P.hd.w)).rgb;
      gain = P.hd.y;
    } else if (m < MAPS_HI) {
      t = textureSampleLevel(mapHi, bgSamp, uv, i32(m), mapLod()).rgb;
    } else {
      t = textureSampleLevel(mapLo, bgSamp, uv, i32(m - MAPS_HI), max(mapLod() - 1.0, 0.0)).rgb;
    }
    return vec4f(min(t * b2.y * gain, vec3f(0.95)), f32(surf));
  } else {
    let band = 0.5 + 0.5 * sin(nrm.z * 22.0 + 2.0 * gnoise(q * vec3f(1.0, 1.0, 4.0)));
    alb = mix(vec3f(0.72, 0.62, 0.45), vec3f(0.9, 0.84, 0.7), band);
  }
  // (Gargantua's worlds: their albedos as they are; the giants' bands scaled to theirs)
  return vec4f(select(alb * b2.y / 0.25, alb, surf < 3u), f32(surf));
}

// What lights a planet: x = temperature, y = surface brightness of its source — its host star, or
// the disk (its bright inner part dominates what it sheds on the planet; the colour its probe
// measured, Doppler shifted by its motion, when there is one)
fn lightSource(k: u32) -> vec2f {
  let li = i32(bodies[BV * k + 3u].x);
  if (li >= 0) {
    let q = u32(li);
    return bodies[BV * q + 2u].xy;
  }
  let lm = bodies[BV * k + 4u];
  return vec2f(select(0.75 * P.disk.x, lm.w, lm.w > 0.5), P.misc.z);
}

// Saturn's map and rings: mip level from the pixel's footprint (set by the caller before shading)
var<private> mapLodV: f32 = 0.0;
var<private> ringLodV: f32 = 0.0;
fn mapLod() -> f32 { return clamp(mapLodV, 0.0, 11.0); }
// Retain sub-texel footprints until the actual texture width is known. Clamping the 2K level
// first forced a 6K map to level >= 1.55, throwing away its close-up detail.
fn hdMapLod(width: f32) -> f32 { return max(mapLodV + log2(width / 2048.0), 0.0); }
// fpAngle: the pixel's footprint on the sphere (radians of it); fpRing: across the rings (its radii)
fn setMapLod(fpAngle: f32, fpRing: f32, k: u32) {
  mapLodV = log2(max(fpAngle * 2048.0 / TAU, 1e-6));
  let w = max(bodies[BV * k + 3u].w - bodies[BV * k + 2u].w, 1e-3);
  ringLodV = clamp(log2(max(fpRing * 2048.0 / w, 1e-6)), 0.0, 11.0);
}
fn ringOuter(k: u32) -> f32 { return bodies[BV * k + 3u].w; }

// The rings at rr (its radii): albedo of the particles (linear rgb) and normal optical depth τ, from
// the map's profile (opacity 1 − e^(−τ))
fn ringSample(k: u32, rr: f32) -> vec4f {
  let inner = bodies[BV * k + 2u].w;
  let f = (rr - inner) / (ringOuter(k) - inner);
  if (f <= 0.0 || f >= 1.0) { return vec4f(0.0); }
  let t = textureSampleLevel(ringTex, bgSamp, vec2f(clamp(f, 0.5 / 2048.0, 1.0 - 0.5 / 2048.0), 0.5), ringLodV);
  // (the map's colours are an appearance: the B ring's ≈ 0.2 in linear rgb; its icy particles' single
  // scattering albedo is ≈ 0.8)
  return vec4f(min(t.rgb * 3.6, vec3f(0.95)), -log(1.0 - min(t.a, 0.995)));
}

// Light scattered by a slab of icy particles towards V, lit along L, N its normal: the reflected radiance
// per unit of the source's F (πF = its irradiance), on the lit face or through the slab to the other;
// w: the slab's opacity along V. q: the point (its radii from the planet's centre), in the planet's
// shadow or not. The particles' phase function two-lobed: the metre-sized blocks of ice throw the light
// back towards the source (Henyey–Greenstein g = −0.3), their dust forward (g = 0.7) — a dust share the
// larger the thinner the ring (the C ring, the Cassini division, the A ring's outer edge: what shines
// backlit; the B ring dark) —, and towards the source the opposition surge (the coherent backscattering
// within a degree, the shadows hidden within several: Cassini's and Hubble's rings ×1.5 at zero phase).
fn ringPhase(ct: f32, tau: f32) -> f32 {
  let gb = -0.3;
  let gf = 0.7;
  let hb = (1.0 - gb * gb) / pow(1.0 + gb * gb - 2.0 * gb * ct, 1.5);
  let hf = (1.0 - gf * gf) / pow(1.0 + gf * gf - 2.0 * gf * ct, 1.5);
  let dust = 0.03 + 0.22 * (1.0 - smoothstep(0.05, 0.8, tau));
  let alpha = acos(clamp(-ct, -1.0, 1.0)); // (the phase angle: the source and the eye seen from the ring)
  let surge = 1.0 + 0.35 * exp(-alpha / 0.012) + 0.25 * exp(-alpha / 0.1);
  return mix(hb * surge, hf, dust);
}
fn ringLight(k: u32, q: vec3f, N: vec3f, L: vec3f, V: vec3f) -> vec4f {
  let rr = length(q);
  let smp = ringSample(k, rr);
  let tau = smp.w;
  if (tau <= 0.0) { return vec4f(0.0); }
  let mu = max(abs(dot(N, V)), 0.01);
  let mu0 = max(abs(dot(N, L)), 0.01);
  let ct = -dot(L, V); // scattering angle: incident −L, out V
  let ph = ringPhase(ct, tau);
  var R: f32;
  if (dot(N, V) * dot(N, L) > 0.0) {
    R = ph * mu0 / (4.0 * (mu + mu0)) * (1.0 - exp(-tau * (1.0 / mu + 1.0 / mu0)));
  } else if (abs(mu - mu0) < 1e-3) {
    R = ph * tau / (4.0 * mu) * exp(-tau / mu);
  } else {
    R = ph * mu0 / (4.0 * (mu0 - mu)) * (exp(-tau / mu0) - exp(-tau / mu));
  }
  // (the planet's shadow)
  let b = dot(q, L);
  let lit = select(1.0, 0.0, b < 0.0 && dot(q, q) - b * b < 1.0);
  return vec4f(smp.rgb * R * lit, 1.0 - exp(-tau / mu));
}

// Ringshine: the light of the rings on the planet — its night side lit by their sunlit face, or by the
// light they let through: the irradiance at q (its radii, on the planet; n = q, the body's axes, its pole
// z) from the ring plane, in units of the Sun's F (πF its irradiance), from ten patches of the annulus
// facing q — two radii, five azimuths over ±1 rad about q's (the rest behind the planet, or grazing; the
// night side's own azimuths in the planet's shadow: its light comes from the rings seen aslant) —, each
// its radiance (ringLight: the planet's shadow on it, the light through) × cos at q × cos at the ring
// × its area / d². Its level the physics': a few thousandths of the day — seen when the eye adapts to
// the night side.
fn ringShine(k: u32, q: vec3f, L: vec3f) -> vec3f {
  let inner = bodies[BV * k + 2u].w;
  let outer = ringOuter(k);
  let w = outer - inner;
  let az = atan2(q.y, q.x);
  var E = vec3f(0.0);
  for (var i = 0; i < 10; i++) {
    let r = inner + w * (0.25 + 0.5 * f32(i / 5));
    // (the azimuths jittered per ray — the planet's shadow on the rings crossed by a fixed sample made
    // bands on the night —: noise the frames average)
    let a = az + 0.5 * (f32(i % 5 - 2) + RND - 0.5);
    let p = vec3f(r * cos(a), r * sin(a), 0.0);
    let dv = p - q;
    let d2 = dot(dv, dv);
    let u = dv * inverseSqrt(d2);
    let cq = dot(u, q);
    if (cq <= 0.0) { continue; }
    let rl = ringLight(k, p, vec3f(0.0, 0.0, 1.0), L, -u);
    E += rl.rgb * (cq * abs(u.z) * r * 0.5 * w * 0.5 / d2);
  }
  return E;
}

// The rings' shadow on the planet: the sunlight's transmission to the point q (its radii)
fn ringShadow(k: u32, q: vec3f, N: vec3f, L: vec3f) -> f32 {
  if (ringOuter(k) <= 0.0) { return 1.0; }
  let dn = dot(L, N);
  if (abs(dn) < 1e-5) { return 1.0; }
  let sR = -dot(q, N) / dn;
  if (sR <= 0.0) { return 1.0; }
  return exp(-ringSample(k, length(q + sR * L)).w / abs(dn));
}

// Axes of a ringed planet: z its pole, x in the frame's xy plane
fn poleAxes(N: vec3f) -> mat3x3f {
  var ex = cross(N, vec3f(0.0, 0.0, 1.0));
  if (dot(ex, ex) < 1e-8) { ex = vec3f(1.0, 0.0, 0.0); }
  ex = normalize(ex);
  return mat3x3f(ex, cross(N, ex), N);
}

// A body of our universe: its own axes (pole, turned by its rotation), as rows: n ↦ its components
fn spunAxes(k: u32) -> mat3x3f {
  let r5 = bodies[BV * k + 5u];
  let a = poleAxes(r5.xyz);
  let c = cos(r5.w);
  let s = sin(r5.w);
  let ex = c * a[0] + s * a[1];
  let ey = -s * a[0] + c * a[1];
  return transpose(mat3x3f(ex, ey, a[2]));
}

// Our universe's bodies on a straight piece of a ray (P.ourCam-relative home coordinates): from o
// along the unit direction d, over [0, tMax); travel: the ray's length before o (the pixel's
// footprint). The nearest body stops the ray (a star shines, a planet reflects its star's light);
// rings in front of it add their light and dim what lies behind (tint). Bodies smaller than the
// pixel are left to farPoints. dneg: only those within the Dneg region. gObs: the photon's frequency
// ratio camera / static observer here.
fn ourSegment(o: vec3f, d: vec3f, tMax: f32, out: ptr<function, WhOut>, gObs: f32, travel: f32, dneg: bool) -> bool {
  var tBest = tMax;
  var kBest = 0u;
  var hit = false;
  for (var k = ourStart(); k < bodyCount(); k++) {
    let wk = bodyWhere(k);
    if (!(wk == 4u || (wk == 2u && !dneg))) { continue; }
    let c = bodies[BV * k].xyz - o;
    let R = bodyRadius(k);
    let reach = R * max(ringOuter(k), 1.0);
    let b = dot(c, d);
    if (b + reach < 0.0 || b - reach > tMax) { continue; }
    if (reach < 0.5 * beam() * (travel + length(c))) { continue; }
    let perp = c - b * d;
    let h = R * R - dot(perp, perp);
    if (h < 0.0) { continue; }
    var t = b - sqrt(h);
    // (the Earth: its ellipsoid, inside that sphere — on its squashed axes the unit sphere)
    if (isEarth(k)) {
      let A = spunAxes(k);
      let rs = squashed(A * d, EARTH_AB);
      let m = length(rs);
      let te = unitHit(squashed(A * (-c / R), EARTH_AB), rs / m);
      t = select(-1.0, te * R / m, te >= 0.0);
    }
    if (t >= 0.0 && t < tBest) {
      tBest = t;
      kBest = k;
      hit = true;
    }
  }
  let V = -d;
  // rings in front of the nearest body
  for (var k = ourStart(); k < bodyCount(); k++) {
    if (ringOuter(k) <= 0.0 || !isOurs(k) || (dneg && bodyWhere(k) != 4u)) { continue; }
    let c = bodies[BV * k].xyz - o;
    let R = bodyRadius(k);
    let N = bodies[BV * k + 5u].xyz;
    let dn = dot(d, N);
    if (abs(dn) < 1e-9) { continue; }
    let sR = dot(c, N) / dn;
    if (sR < 0.0 || sR >= tBest) { continue; }
    let q = (d * sR - c) / R;
    if (dot(q, q) > ringOuter(k) * ringOuter(k)) { continue; }
    let li = i32(bodies[BV * k + 3u].x);
    let L = normalize(bodies[BV * u32(max(li, 0))].xyz - o - d * sR);
    let src = lightSource(k);
    let fp = beam() * (travel + sR) / R;
    setMapLod(fp, fp / max(abs(dn), 0.05), k);
    let rl = ringLight(k, q, N, L, V);
    (*out).glow += (*out).tint * rl.rgb * blackbody(src.x * gObs, P.disk.w) * src.y * bodies[BV * k + 3u].y;
    (*out).tint *= 1.0 - rl.w;
  }
  // the Earth (its air in front of what the ray meets — its limb's glow; its ground, clouds and air when
  // it is what the ray meets): one call, the ground or not (every call is a copy the compiler builds)
  {
    for (var k = ourStart(); k < bodyCount(); k++) {
      let wk = bodyWhere(k);
      if (!hasAir(k) || !(wk == 4u || (wk == 2u && !dneg))) { continue; }
      setAir(k);
      let R = bodyRadius(k);
      let c = bodies[BV * k].xyz - o;
      let b = dot(c, d);
      let top = airTop() * R;
      if (b + top < 0.0 || b - top > tBest || top < 0.5 * beam() * (travel + length(c))) { continue; }
      let A = spunAxes(k);
      // (on its squashed axes: the Earth's ellipsoid the unit sphere)
      let ab = squashOf(k);
      let rs = squashed(A * d, ab);
      let m = length(rs);
      let rd = rs / m;
      let t1 = normalize(cross(rd, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(rd.z) > 0.9)));
      let li = u32(max(i32(bodies[BV * k + 3u].x), 0));
      let met = hit && k == kBest;
      let e = earthLook(k, squashed(A * (-c / R), ab), rd, select(-1.0, tBest * m / R, met), normalize(squashed(A * normalize(bodies[BV * li].xyz - bodies[BV * k].xyz), ab)),
        earthSun(k, gObs), t1, cross(rd, t1), beam() * travel / R, beam(), 0.5, false);
      (*out).glow += (*out).tint * e.col;
      (*out).tint *= e.T;
      if (met) { return true; }
    }
  }
  // our Sun's corona, seen where nothing stands before it (the Moon in front: it hides the corona there
  // too) — only an eclipse shows it: a millionth of the Sun's light, drowned in the day's sky otherwise
  for (var k = ourStart(); k < bodyCount(); k++) {
    if (bodyKind(k) != 0u || probeNoStar) { continue; }
    let wk = bodyWhere(k);
    if (!(wk == 4u || (wk == 2u && !dneg))) { continue; }
    let c = bodies[BV * k].xyz - o;
    let b = dot(c, d);
    let R = bodyRadius(k);
    if (b <= 0.0 || (hit && tBest < b)) { continue; }
    let r = length(c - b * d) / R;
    if (r <= 1.0 || r > 12.0) { continue; }
    (*out).glow += (*out).tint * sunCorona(k, normalize(d * b - c), r, gObs, P.time.x);
  }
  // our stars' disks, their edges antialiased: a pixel's share of the disk (not a point: in or out as the
  // samples jitter) — the image's brightest light by far, its bloom over the whole frame steady from frame
  // to frame; a body before it (the Moon's limb on the Sun) taking its own share of the pixel
  for (var k = ourStart(); k < bodyCount(); k++) {
    if (bodyKind(k) != 0u || probeNoStar) { continue; }
    let wk = bodyWhere(k);
    if (!(wk == 4u || (wk == 2u && !dneg))) { continue; }
    let c = bodies[BV * k].xyz - o;
    let b = dot(c, d);
    if (b <= 0.0) { continue; }
    let R = bodyRadius(k);
    let perp = c - b * d;
    let pd = length(perp);
    let px = max(beam() * (travel + b), 1e-30);
    let cov = clamp((R - pd) / px + 0.5, 0.0, 1.0);
    if (cov <= 0.0) { continue; }
    var vis = 1.0;
    for (var j = ourStart(); j < bodyCount(); j++) {
      if (j == k) { continue; }
      let wj = bodyWhere(j);
      if (!(wj == 4u || (wj == 2u && !dneg))) { continue; }
      let cj = bodies[BV * j].xyz - o;
      let bj = dot(cj, d);
      if (bj <= 0.0 || bj >= b) { continue; }
      let Rj = bodyRadius(j);
      let pj = length(cj - bj * d);
      vis *= 1.0 - clamp((Rj - pj) / max(beam() * (travel + bj), 1e-30) + 0.5, 0.0, 1.0);
      if (vis <= 0.0) { break; }
    }
    if (vis <= 0.0) { continue; }
    // (where the ray meets it, or — passing just outside — its limb's nearest point)
    var X = c - perp * (R / max(pd, 1e-30));
    if (pd < R) { X = d * (b - sqrt(R * R - pd * pd)); }
    (*out).glow += (*out).tint * shadeStar(k, X, c, gObs, d, P.time.x) * (cov * vis);
  }
  if (!hit) { return false; }
  let k = kBest;
  let c = bodies[BV * k].xyz - o;
  let X = d * tBest;
  let nrm = normalize(X - c);
  var col: vec3f;
  if (bodyKind(k) == 0u) {
    col = vec3f(0.0); // (its light: above, with its edge's share)
  } else {
    let li = i32(bodies[BV * k + 3u].x);
    let L = normalize(bodies[BV * u32(max(li, 0))].xyz - o - X);
    let fp = beam() * (travel + tBest) / bodyRadius(k);
    setMapLod(fp, fp, k);
    let N = bodies[BV * k + 5u].xyz;
    BODYW = transpose(spunAxes(k));
    col = planetShade(k, nrm, spunAxes(k) * nrm, L, V, P.time.x, gObs, ringShadow(k, nrm, N, L));
  }
  (*out).glow += (*out).tint * col;
  (*out).tint = vec3f(0.0);
  return true;
}

// the maps (solar.ts: MAPS_HI, then MAPS_LO) of dusty airless worlds: the Moon, Mars, Mercury; Ceres,
// Phobos, Deimos, the Galilean moons, Saturn's icy moons; Pluto — not the Earth, the giants, Venus, Titan
fn regolith(m: u32) -> bool { return (m >= 1u && m <= 3u) || (m >= 7u && m <= 18u) || m == 22u; }

// The finer relief of the body near the camera (P.hd): its normal at q (its axes), from its normal map
// (red east, green south), at the footprint's level; q itself elsewhere
fn isHd(k: u32) -> bool {
  let surf = u32(bodies[BV * k + 2u].z);
  return P.hd.z > 0.0 && surf >= 4u && i32(surf - 4u) == i32(P.hd.x);
}
fn hdNormal(k: u32, q: vec3f) -> vec3f {
  if (!isHd(k)) { return q; }
  if (P.hd2.x > 0.5) { return demNormal(q); }
  let uv = vec2f(0.5 + atan2(q.y, q.x) / TAU, 0.5 - asin(clamp(q.z, -1.0, 1.0)) / PI);
  let rl = textureSampleLevel(hdRelief, bgSamp, uv, hdMapLod(f32(textureDimensions(hdRelief).x)));
  var east = vec3f(-q.y, q.x, 0.0);
  east = select(normalize(east), vec3f(0.0, 1.0, 0.0), dot(east, east) < 1e-10);
  let north = cross(q, east);
  let tn = vec2f(rl.r * 2.0 - 1.0, 1.0 - rl.g * 2.0) * P.hd.z;
  return normalize(q + tn.x * east + tn.y * north);
}
// The near body's measured heights [m] (P.hd2; hdRelief: half floats, mip-mapped) at q (its axes) for a
// footprint [m]: near, a cubic B-spline over the texels (src/terrain.ts: mapHeightSampler, the same — the
// ground the gear stands on); from afar, the footprint's mip level
fn hasDem(surf: u32) -> bool { return P.hd2.x > 0.5 && surf >= 4u && i32(surf - 4u) == i32(P.hd.x); }
fn demH0(q: vec3f, foot: f32) -> f32 {
  let dim = vec2i(textureDimensions(hdRelief));
  let texelM = P.hd2.w * TAU / f32(dim.x);
  let lod = log2(max(foot, 1.0) / texelM);
  let uv = earthUV(q);
  if (lod > 0.5) { return textureSampleLevel(hdRelief, bgSamp, uv, lod).r; }
  let x = uv.x * f32(dim.x) - 0.5;
  let y = uv.y * f32(dim.y) - 0.5;
  let x0 = floor(x);
  let y0 = floor(y);
  let wx = bspline4(x - x0);
  let wy = bspline4(y - y0);
  var s = 0.0;
  for (var j = 0; j < 4; j++) {
    let yy = clamp(i32(y0) + j - 1, 0, dim.y - 1);
    var row = 0.0;
    for (var i = 0; i < 4; i++) {
      let xx = ((i32(x0) + i - 1) % dim.x + dim.x) % dim.x;
      row += wx[i] * textureLoad(hdRelief, vec2i(xx, yy), 0).r;
    }
    s += wy[j] * row;
  }
  return s;
}
// the same, cheaply (the marches' steps): near, the B-spline from four of the hardware's bilinear reads
// (Sigg & Hadwiger 2005: its weights rounded to 1/256 of a texel — metres off demH0, which refines the
// crossing; a plain bilinear read was tens of metres off it on the crests: the march stopped short there)
fn demStep(q: vec3f, foot: f32) -> f32 {
  let dim = vec2f(textureDimensions(hdRelief));
  let lod = log2(max(foot, 1.0) / (P.hd2.w * TAU / dim.x));
  let uv = earthUV(q);
  if (lod > 0.5) { return textureSampleLevel(hdRelief, bgSamp, uv, lod).r; }
  let x = uv * dim - 0.5;
  let i = floor(x);
  let f = x - i;
  let wx = bspline4(f.x);
  let wy = bspline4(f.y);
  let g0 = vec2f(wx.x + wx.y, wy.x + wy.y);
  let g1 = vec2f(wx.z + wx.w, wy.z + wy.w);
  let p0 = (i - 0.5 + vec2f(wx.y, wy.y) / g0) / dim;
  let p1 = (i + 1.5 + vec2f(wx.w, wy.w) / g1) / dim;
  return g0.y * (g0.x * textureSampleLevel(hdRelief, bgSamp, p0, 0.0).r + g1.x * textureSampleLevel(hdRelief, bgSamp, vec2f(p1.x, p0.y), 0.0).r) +
    g1.y * (g0.x * textureSampleLevel(hdRelief, bgSamp, vec2f(p0.x, p1.y), 0.0).r + g1.x * textureSampleLevel(hdRelief, bgSamp, p1, 0.0).r);
}
// their highest within reach [m] of q (the mips' g: their maximum), from the 2 × 2 texels round it at
// the level whose texel is twice the reach (shrunk towards the poles)
fn demTop(q: vec3f, reach: f32) -> f32 {
  let dim = vec2i(textureDimensions(hdRelief));
  let cosLat = max(sqrt(max(1.0 - q.z * q.z, 0.0)), 0.05);
  let top = i32(textureNumLevels(hdRelief)) - 1;
  let l = clamp(i32(ceil(log2(2.0 * reach / (P.hd2.w * TAU / f32(dim.x) * cosLat)))), 0, top);
  let dl = max(dim >> vec2u(u32(l)), vec2i(1));
  let x = earthUV(q) * vec2f(dl) - 0.5;
  let i = vec2i(floor(x));
  let x0 = (i.x % dl.x + dl.x) % dl.x;
  let x1 = (x0 + 1) % dl.x;
  let y0 = clamp(i.y, 0, dl.y - 1);
  let y1 = clamp(i.y + 1, 0, dl.y - 1);
  return max(max(textureLoad(hdRelief, vec2i(x0, y0), l).g, textureLoad(hdRelief, vec2i(x1, y0), l).g),
    max(textureLoad(hdRelief, vec2i(x0, y1), l).g, textureLoad(hdRelief, vec2i(x1, y1), l).g));
}
// their normal at q (its axes), at the map's footprint (mapLod), no finer than half a texel (the cheap
// heights: a slope's metres off are nothing over a texel)
fn demNormal(q: vec3f) -> vec3f {
  let R = P.hd2.w;
  let foot = R * TAU / 2048.0 * exp2(mapLod());
  let e = max(foot, 0.5 * R * TAU / f32(textureDimensions(hdRelief).x)) / R;
  let t1 = normalize(cross(q, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(q.z) > 0.9)));
  let t2 = cross(q, t1);
  var hs = array<f32, 3>(0.0, 0.0, 0.0);
  for (var i = 0; i < 3; i++) {
    let qi = select(select(q, normalize(q + t1 * e), i == 1), normalize(q + t2 * e), i == 2);
    hs[i] = demStep(qi, foot);
  }
  return normalize(q - ((hs[1] - hs[0]) * t1 + (hs[2] - hs[0]) * t2) / (e * R));
}
// the body's axes in the frame planetShade is called in (columns): set by its callers for our worlds
var<private> ALB_GAIN: f32 = 1.0; // (near: the ground's own brightening — fresh ejecta, regolith)
var<private> BODYW: mat3x3f = mat3x3f(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);

// Lit by its source alone (the disk seen as one light, or its star): the far view's shading. nrm,
// ldir, view: any one frame; pat: the normal in the black-hole frame (the surface pattern)
// (rs: the sunlight's share through the rings — the direct light's, not the rings' own: their shine)
fn planetShade(k: u32, nrm: vec3f, pat: vec3f, ldir: vec3f, view: vec3f, tEm: f32, g: f32, rs: f32) -> vec3f {
  let b3 = bodies[BV * k + 3u];
  let src = lightSource(k);
  let Tl = src.x;
  let Bl = src.y;
  // (the finer relief, near: the normal tilted by it)
  var nrmL = nrm;
  // (added to the relief's own normal, near: the map's tilt on it)
  if (isHd(k)) { nrmL = normalize(nrm + BODYW * (hdNormal(k, pat) - pat)); }
  let cosi = max(dot(nrmL, ldir), 0.0);
  let mu = clamp(dot(nrm, view), 0.0, 1.0);
  var A = planetAlbedo(k, pat, tEm);
  A = vec4f(A.rgb * ALB_GAIN, A.w);
  let surf = u32(A.w);
  var spec = 0.0;
  if (surf == 0u) {
    // the glint of the light source on the water
    let hv = normalize(ldir + view);
    spec = 0.6 * pow(max(dot(nrm, hv), 0.0), 180.0);
  }
  // atmosphere: the sunlit air (Rayleigh blue) over the whole day side, brighter along the limb
  let rim = pow(1.0 - mu, 3.0) * smoothstep(-0.1, 0.4, dot(nrm, ldir));
  let sky = vec3f(0.25, 0.45, 1.0) * (0.06 + 0.6 * rim) * select(1.0, 0.0, surf >= 3u);
  // (an airless world of dust — the Moon, Mercury, the rocky and icy moons, Mars — scatters as its regolith
  // does: Lommel–Seeliger, 2 cos i / (cos i + cos e) — no darkening towards the limb: the full Moon evenly
  // lit, a thin crescent bright; the gas giants, Venus and Titan's haze, as Lambert)
  var f = cosi;
  if (surf >= 4u && regolith(surf - 4u)) { f = 2.0 * cosi / max(cosi + mu, 1e-4); }
  // (a ringed planet's night and twilight: the rings' light — its own axes, pat's: the pole z)
  var shine = vec3f(0.0);
  if (ringOuter(k) > 0.0 && cosi < 0.25) {
    let Lb = spunAxes(k) * ldir;
    shine = ringShine(k, pat, Lb) * (1.0 / PI) * (1.0 - 4.0 * cosi);
  }
  return blackbody(Tl * g, P.disk.w) * Bl * b3.y * (((A.rgb + sky) * f + spec * cosi) * rs + A.rgb * shine);
}

// Optically thin atmosphere above the photosphere (emission per unit length): the pink chromosphere
// rim, prominences (Hα loops standing on the limb) and the white K-corona with radial streamers.
fn shadeBody(k: u32, X: vec3f, c: vec3f, g: f32, dW: vec3f, tEm: f32) -> vec3f {
  if (bodyKind(k) == 0u) { return shadeStar(k, X, c, g, dW, tEm); }
  return shadePlanet(k, X, c, g, dW, tEm);
}

fn starGlow(k: u32, p: vec3f, c: vec3f, g: f32, tEm: f32) -> vec3f {
  let R = bodyRadius(k);
  let dv = p - c;
  let d = length(dv);
  let h = d / R - 1.0; // height above the photosphere, in stellar radii
  if (h < 0.0 || h > 3.0) { return vec3f(0.0); }
  let dir = dv / d;
  let t = tEm * 0.003;
  let b2 = bodies[BV * k + 2u];
  let Is = luminance(blackbody(b2.x * g, P.disk.w)) * b2.y;
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

// Our Sun's corona as it is seen (its light along the sight line): r [its radii] from its centre, dir
// the direction from it. The K and F coronae's mean radiance over the disk's (Baumbach: 10⁻⁶ (0.0532 r^−2.5
// + 1.425 r^−7 + 2.565 r^−17) — a millionth of the Sun, a full Moon's light, all told), streamers along
// its equator (the helmets) and plumes over its poles, fine rays; the chromosphere's pink rim and a few
// prominences at the limb (Hα), for the seconds they show.
fn sunCorona(k: u32, dir: vec3f, r: f32, g: f32, tEm: f32) -> vec3f {
  let b2 = bodies[BV * k + 2u];
  let disk = blackbody(b2.x * 0.97 * g, P.disk.w) * b2.y * 0.84; // (the disk's mean: its limb darkened)
  let base = 1e-6 * (0.0532 * pow(r, -2.5) + 1.425 * pow(r, -7.0) + 2.565 * pow(r, -17.0));
  // (its shape: the Sun's axes — streamers near its equator, rays everywhere, finer close in)
  let q = spunAxes(k) * dir;
  let lat = abs(q.z);
  let rays = 0.55 + 0.9 * smoothstep(-0.3, 0.8, gnoise(q * 7.0 + vec3f(0.0, 0.0, log(r) * 0.6)) + 0.5 * gnoise(q * 23.0));
  let helmets = mix(1.35, 0.55, smoothstep(0.2, 0.75, lat)) + 0.5 * smoothstep(0.35, 0.9, gnoise(q * 2.2 + vec3f(3.1)));
  let shape = rays * mix(1.0, helmets, smoothstep(1.05, 1.6, r));
  let white = blackbodyShifted(5800.0, g) / max(luminance(blackbodyShifted(5800.0, 1.0)), 1e-6);
  var col = white * luminance(disk) * base * shape;
  // the chromosphere (a few thousand km: 0.01 of a radius) and the prominences (Hα red, up to ~0.08)
  let h = r - 1.0;
  let halpha = shiftRatio(3000.0, g) * vec3f(1.0, 0.25, 0.32);
  let loopN = 1.0 - abs(gnoise(q * 9.0 + vec3f(0.0, 0.0, h * 40.0)));
  let region = smoothstep(0.2, 0.5, gnoise(q * 1.7 + vec3f(7.0, 3.0, 1.0)));
  let prom = smoothstep(0.88, 0.97, loopN) * region * exp(-h / 0.025);
  col += halpha * luminance(disk) * (1.5e-4 * exp(-h / 0.004) + 4e-4 * prom);
  return col;
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

// The disk's outer edge: no rim — beyond 0.6 of its outer radius the gas's optical depth falls off
// exponentially, reaching τ = 1 near the outer radius (the e-folding length set by the disk's own
// depth τ₀, so that any disk turns translucent there), traced out to 1.3 of it (DISK_REACH): it fades
// into the dark as the film's disk does — torn into wisps by the turbulence's density over it. A
// factor on the optical depth.
const DISK_REACH = 1.3;
fn diskFade(R: f32, rOut: f32) -> f32 {
  let lam = 0.4 * rOut / max(log(max(P.misc.w, 1.0)), 1.0);
  return exp(-max(R - 0.6 * rOut, 0.0) / lam) * (1.0 - smoothstep(0.85 * DISK_REACH * rOut, DISK_REACH * rOut, R));
}

// Gradient (Perlin) noise in [−1, 1], quintic fade: smoother and less grid-aligned than value noise.
// (the corners' hashes share their z and y stages — hash3u(x, y, z) = pcg(x ^ pcg(y ^ pcg(z))): 14 pcg
// instead of 24, the same bits)
fn gGrad(h: u32, d: vec3f) -> f32 {
  let g = vec3f(f32(h & 0x3ffu), f32((h >> 10u) & 0x3ffu), f32((h >> 20u) & 0x3ffu)) * (2.0 / 1023.0) - 1.0;
  return dot(g, d);
}
fn gnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let b = bitcast<vec3u>(vec3i(i));
  let z0 = pcg(b.z);
  let z1 = pcg(b.z + 1u);
  let y00 = pcg(b.y ^ z0);
  let y10 = pcg((b.y + 1u) ^ z0);
  let y01 = pcg(b.y ^ z1);
  let y11 = pcg((b.y + 1u) ^ z1);
  let x1 = b.x + 1u;
  let n0 = gGrad(pcg(b.x ^ y00), f);
  let n1 = gGrad(pcg(x1 ^ y00), f - vec3f(1.0, 0.0, 0.0));
  let n2 = gGrad(pcg(b.x ^ y10), f - vec3f(0.0, 1.0, 0.0));
  let n3 = gGrad(pcg(x1 ^ y10), f - vec3f(1.0, 1.0, 0.0));
  let n4 = gGrad(pcg(b.x ^ y01), f - vec3f(0.0, 0.0, 1.0));
  let n5 = gGrad(pcg(x1 ^ y01), f - vec3f(1.0, 0.0, 1.0));
  let n6 = gGrad(pcg(b.x ^ y11), f - vec3f(0.0, 1.0, 1.0));
  let n7 = gGrad(pcg(x1 ^ y11), f - vec3f(1.0, 1.0, 1.0));
  return 1.6 * mix(mix(mix(n0, n1, u.x), mix(n2, n3, u.x), u.y),
                   mix(mix(n4, n5, u.x), mix(n6, n7, u.x), u.y), u.z);
}

// gnoise read from the baked texture (trilinear, a quarter-unit lattice): the disk's 20–36 noises a
// sample, one fetch each instead of 8 hashed gradients
fn dnoise(p: vec3f) -> f32 { return textureSampleLevel(noiseTex, noiseSamp, p * (1.0 / 32.0), 0.0).r; }

// The disk's gas (the look of Interstellar's Gargantua: hair-thin hot strands drawn out along the
// orbits, breaking up into turbulent clouds, with dense cool smoke that darkens what lies behind it,
// and open lanes). Two fields: the heat (the strands: temperature) and the density (the clouds and
// the smoke: optical depth) — hot and thin glows, cool and dense hides. The gas orbits: the disk is
// cut into thin rings (NB per unit of ln r, each ~2 % of its radius), each turning rigidly at the
// Keplerian rate of its middle, forever — no spiral winding, no fading between patterns — its
// neighbours blended across it (their difference: the shear, a ring sliding past the next); each
// ring with its own pattern, no structure continued across rings (turned by other angles, it would
// slant). Along the orbits the structures are long, across them thin (the shear has drawn them out:
// the strands ~60 : 1). Evaluated at the retarded time t_em: moving structure is seen where it was
// when the light left it.
const DISK_BANDS = 45.0;
// px: the pixel's footprint in units of ln r — scales finer than it fade to their mean (no sparkle
// from strands a fraction of a pixel wide, seen from afar while the image cannot accumulate)
fn diskStrands(ang0: f32, lr0: f32, zn: f32, ring: f32, px: f32) -> vec2f {
  // (each ring its own gas: a structure continued into the next ring, turned by another angle there,
  // would be drawn slanted across the blend — a spiral arm)
  let lr = lr0 + ring * 1.618;
  // (the strands waver, like hair or flames: locally twisted, not perfect circles — both ways, no
  // spiral at large scale)
  let c0 = vec2f(cos(ang0), sin(ang0));
  let ang = ang0 + 0.08 * dnoise(vec3f(c0 * 3.0, lr * 3.0 + 5.0));
  let c = vec2f(cos(ang), sin(ang));
  let lw = lr + 0.03 * dnoise(vec3f(c * 2.1, lr * 8.0 + 11.0));
  // (height: the structures run through the thin disk, ragged at its surface)
  // wide lanes (open, dark) and full stretches
  let lanes = 0.5 + 0.5 * dnoise(vec3f(c * 1.2, lw * 7.0 + zn * 0.15));
  let lod = 1.0 / max(px, 1e-9);
  // clouds and smoke: fBm, every octave keeping the stretch along the orbit
  var cl = 0.0;
  var amp = 0.5;
  var q = vec3f(c * 3.2, lw * 45.0 + zn * 0.8);
  var cell = 1.0 / 45.0;
  for (var o = 0; o < 4; o++) {
    let w = smoothstep(0.35, 1.2, cell * lod);
    if (w <= 0.0) { break; }
    cl += w * amp * dnoise(q);
    q = q * vec3f(2.17, 2.17, 2.3) + vec3f(1.7, 9.2, 3.1);
    amp *= 0.55;
    cell /= 2.3;
  }
  // (the lanes' edges torn by the clouds: the strands break up into them, no clean ends lining up)
  // (a ring narrower than the pixel: its own lanes, unlike its neighbours', would be noise)
  let wl = smoothstep(0.35, 1.2, lod / DISK_BANDS);
  let body = mix(0.55, smoothstep(0.3, 0.7, lanes + 0.35 * cl), wl);
  // the strands: long, hair-thin ridges — at three widths, the finest one resolved drawn over the
  // coarser (a cascade): seen from afar there are still strands a pixel or two wide, with their
  // contrast, not a flat mean
  var r3 = 0.4;
  let rf = array<f32, 3>(36.0, 90.0, 220.0);
  let ra = array<f32, 3>(1.8, 2.6, 3.5);
  for (var o = 0; o < 3; o++) {
    let wr = smoothstep(0.35, 1.2, lod / rf[o]);
    if (wr <= 0.0) { break; }
    let rq = vec3f(c * ra[o], lw * rf[o] + zn * 1.3 + f32(o) * 7.7);
    let ridge = 1.0 - abs(dnoise(rq) + 0.45 * dnoise(rq * vec3f(2.1, 2.1, 1.7) + vec3f(3.3)));
    r3 = mix(r3, ridge * ridge * ridge, wr);
  }
  let heat = clamp(body * (0.3 + 0.45 * cl + 0.95 * (r3 - 0.15)), 0.0, 1.0);
  let dens = clamp((0.06 + 0.94 * body) * (0.4 + 1.1 * cl + 0.3 * r3), 0.0, 1.0);
  // (the rings finer than the pixel: what keeps the mean light — the emission goes as T⁴, the mean of
  // the strands' T⁴ is that of 0.9 T (h ≈ 0.63), not that of their mean T — and a mean opacity)
  let W = wl;
  return vec2f(mix(0.63, heat * heat * (3.0 - 2.0 * heat), W), mix(0.55, dens, W));
}
// The footprint of a disk sample across the orbits [M]: the pixel's at the ray's length (≈ its time
// |t|) — half the realtime block's when one ray stands for block × block pixels (its rotating offset
// and the temporal blend recover part of the rest; the refining passes, one per pixel, bring the
// fine strands back)
// — and stretched across the orbits by the grazing angle (μ ≈ |p_θ|/r, the gas frame's factor aside)
fn diskFootprint(s: GState) -> f32 {
  let mu = clamp(abs(s.p.y) / max(s.x.x, 1e-3), 0.15, 1.0);
  return footprint(abs(s.x.w)) * max(0.5 * P.res.z, 1.0) / mu;
}
/** x: the heat (temperature factor), y: the density (optical depth factor), both in [0, 1]; fw: the
 *  sample's footprint there [M] (diskFootprint). */
// The large scale of the gas, seen from afar when the strands are finer than a pixel: wide rings
// (DISK_BANDS_C per unit of ln r, ~15 % of r), each orbiting rigidly with its own pattern too — broad
// bright stretches and dark lanes along the orbits, concentric banding across them. Zero mean.
const DISK_BANDS_C = 7.0;
fn diskCoarse(ang: f32, lr0: f32, ring: f32, px: f32) -> f32 {
  let lr = lr0 + ring * 2.71;
  let c = vec2f(cos(ang), sin(ang));
  let lod = 1.0 / max(px, 1e-9);
  var v = 0.0;
  let wl = smoothstep(0.35, 1.2, lod / 4.0);
  if (wl > 0.0) { v += 0.85 * wl * dnoise(vec3f(c * 1.4, lr * 4.0 + 3.0)); }
  let wb = smoothstep(0.35, 1.2, lod / 30.0);
  if (wb > 0.0) { v += 0.75 * wb * dnoise(vec3f(c * 0.7, lr * 30.0 + 7.0)); }
  // (streaks: ridges along the orbits, 12 and 28 per unit of ln r — the strands seen from afar)
  var st = 0.0;
  let sf = array<f32, 2>(12.0, 28.0);
  for (var o = 0; o < 2; o++) {
    let ws = smoothstep(0.35, 1.2, lod / sf[o]);
    if (ws <= 0.0) { break; }
    let q = vec3f(c * (1.1 + 0.6 * f32(o)), lr * sf[o] + 13.0 + f32(o) * 5.3);
    let rg = 1.0 - abs(dnoise(q) + 0.4 * dnoise(q * vec3f(2.0, 2.0, 1.8) + vec3f(4.1)));
    st = mix(st, 2.0 * (rg * rg * rg) - 0.6, ws);
  }
  v += 0.8 * st;
  return clamp(v, -1.0, 1.0);
}
// Two neighbouring rings of a level (n per unit of ln r) at the angle each has turned to by tEm, blended
// across the ring keeping the contrast of one: the fine strands (level 1) or the large scale (0).
struct RingPair { ang0: f32, ang1: f32, ib0: f32, w0: f32, w1: f32 };
fn ringPair(lr: f32, phi: f32, tEm: f32, a: f32, n: f32) -> RingPair {
  let u = lr * n - 0.5;
  let i0 = floor(u);
  let f = u - i0;
  let w1 = f * f * (3.0 - 2.0 * f);
  var o: RingPair;
  o.ib0 = i0;
  let norm = inverseSqrt(max((1.0 - w1) * (1.0 - w1) + w1 * w1, 1e-6));
  o.w0 = (1.0 - w1) * norm;
  o.w1 = w1 * norm;
  for (var k = 0; k < 2; k++) {
    let ib = i0 + f32(k);
    let om = 1.0 / (pow(exp((ib + 0.5) / n), 1.5) + a);
    // (the ring's angle now: its own turns taken out, in f32 over long times)
    let ang = phi - TAU * fract(om * tEm / TAU) + ib * 2.399;
    if (k == 0) { o.ang0 = ang; } else { o.ang1 = ang; }
  }
  return o;
}
fn diskTurbulence(r: f32, phi: f32, tEm: f32, a: f32, zn: f32, fw: f32) -> vec2f {
  let lr = log(r);
  let px = fw / r;
  let pf = ringPair(lr, phi, tEm, a, DISK_BANDS);
  let fine = 0.5 + pf.w0 * (diskStrands(pf.ang0, lr, zn, pf.ib0, px) - 0.5) + pf.w1 * (diskStrands(pf.ang1, lr, zn, pf.ib0 + 1.0, px) - 0.5);
  let pc = ringPair(lr, phi, tEm, a, DISK_BANDS_C);
  let k = pc.w0 * diskCoarse(pc.ang0, lr, pc.ib0, px) + pc.w1 * diskCoarse(pc.ang1, lr, pc.ib0 + 1.0, px);
  // (the large scale over the strands: hotter and denser stretches, darker lanes, streaks — carrying
  // the contrast where the fine rings are finer than the pixel)
  let wf = smoothstep(0.35, 1.2, 1.0 / max(px, 1e-9) / DISK_BANDS);
  let kk = (0.3 + 0.35 * (1.0 - wf)) * k;
  return clamp(vec2f(fine.x + kk, fine.y * (1.0 + 0.7 * k)), vec2f(0.0), vec2f(1.0));
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
  let edge = diskFade(r, rOut);
  // Vertical (grey) optical depth of the slab; turbulence modulates both the heating and the
  // column density, opening optically thin gaps between clumps.
  var tau = P.misc.w * edge;
  let turb = P.disk.z;
  if (turb > 0.0) {
    let n = diskTurbulence(r, s.x.z, tNow + s.x.w, a, 0.0, diskFootprint(s));
    T *= mix(1.0, 0.3 + 0.95 * n.x, turb);
    tau *= mix(1.0, 0.002 + 2.8 * n.y * n.y, turb);
    // (the edge torn into wisps: denser gas reaches farther out)
    tau *= diskFade(r * (1.0 - 0.3 * turb * (n.y - 0.5)), rOut) / max(edge, 1e-6);
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
      if (rc >= rIn && rc <= rOut * DISK_REACH) {
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

// The LTE source of the disk's gas at temperature T seen shifted by g (bolometric or colour).
fn diskSource(T: f32, g: f32) -> vec3f {
  let shift = P.modes.y;
  if (P.misc.y > 0.5) {
    let t = T / P.disk.x;
    var boost = g * g * g * g;
    if (shift == SHIFT_NO_BEAMING) { boost = 1.0; }
    return bbLookup(T * g).rgb * (t * t * t * t) * boost;
  } else if (shift == SHIFT_NO_BEAMING) {
    return bbLookup(T * g).rgb * exp2((bbLookup(T).a - P.disk.w) * 3.32192809489);
  }
  return blackbody(T * g, P.disk.w);
}

// The smoke (P.radio2.z, 0: none): puffy clouds of cool dense gas above the disk's surface (from 1.5 H,
// a soft top ~0.5 M higher),
// in its outer, cooler part (beyond ~10 M), over an M across with a clear outline, orbiting with the
// wide rings (each rigidly, blended across), rising and churning as they go: opaque, their cores at
// ~0.4 of the local temperature,
// their thin edges warmer — dark silhouettes rimmed with orange against the haze, sparse patches from
// above. Its density factor at a point (0 outside the layer).
fn diskSmoke(R: f32, phi: f32, zn: f32, z: f32, tEm: f32, a: f32) -> f32 {
  // (above the surface, up to a soft top ~0.5 M higher — not a thin slab slicing the clouds flat; only
  // in the outer, cooler disk — the inner heat leaves none)
  let za = max(abs(z) - 2.5 * abs(z) / max(abs(zn), 1e-6), 0.0); // (height above 2.5 H)
  let layer = smoothstep(1.2, 2.5, abs(zn)) * exp(-(za * za) / 0.16) * smoothstep(8.0, 14.0, R);
  if (layer <= 0.0) { return 0.0; }
  let pc = ringPair(log(R), phi, tEm, a, DISK_BANDS_C);
  var v = 0.0;
  for (var k = 0; k < 2; k++) {
    let ang = select(pc.ang0, pc.ang1, k == 1);
    // (isotropic puffs: the ring's frame in M, 0.8 cell per M — clouds over an M across; they rise
    // away from the midplane at 0.02 (convection: born low in the layer, thinning out at its top) and
    // churn — a slow swirl warping them, so they boil as they orbit)
    let zr = sign(z) * (abs(z) - 0.02 * tEm);
    var q = vec3f(R * cos(ang), R * sin(ang), zr) * 0.8 + vec3f(0.0, 0.0, (pc.ib0 + f32(k)) * 17.3);
    let tw = 0.015 * tEm;
    q += 0.9 * vec3f(dnoise(q * 0.4 + vec3f(0.0, 0.0, tw)), dnoise(q * 0.4 + vec3f(5.2, 1.3, tw + 7.1)), 0.0);
    var f = 0.0;
    var amp = 0.5;
    for (var o = 0; o < 5; o++) {
      f += amp * dnoise(q);
      q = q * 2.1 + vec3f(3.7, 1.3, 5.1);
      amp *= 0.5;
    }
    v += select(pc.w0, pc.w1, k == 1) * f;
  }
  // (the blend's weights are contrast-keeping, their sum ≥ 1: back to a mean)
  v /= max(pc.w0 + pc.w1, 1e-6);
  // (a steep edge: cumulus-like clouds with a clear outline, not a gradient)
  return layer * smoothstep(0.14, 0.2, v);
}

// The haze (P.ret.w, 0: none): a thin scattering envelope hugging the disk (e^{−|z|/1.5H}, vertical
// depth 0.2 × haze on each side) that sends back the light of the disk below it — seen from above it is a
// faint veil, but along the disk, grazing, the path through it is ~R/H longer: a luminous mist over
// the near side that thickens to the burnt band at the disk's horizon, as in the film. Its light is
// the disk's hot heart's (scattered), brighter than the cooler gas it veils: the near side's
// darker clouds show against it.
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
  let haze = P.ret.w;
  let smoke = P.radio2.z;
  if (R < rIn * 0.85 || R > rOut * DISK_REACH || abs(z) > max(select(4.0, 8.0, haze > 0.0) * H, select(0.0, 2.5 * H + 1.0, smoke > 0.0 && R > 8.0))) { return o; }
  let zn = z / H;
  let edge = smoothstep(rIn * 0.85, rIn * 1.03, R) * diskFade(R, rOut);
  var rho = exp(-0.5 * zn * zn) * 0.3989423 / H * edge;
  let T0 = P.disk.x * pow(max(ntFlux(max(R, rIn), a, rIn) / P.disk.y, 0.0), 0.25);
  var T = T0;
  var hz = haze * 0.2 / (1.5 * H) * exp(-abs(zn) / 1.5) * edge;
  // (the Gaussian's tail, no mist nor smoke there: what the gas could add at most — the turbulence's
  // densest ×2.8, the emitter's energy ≤ 3 — under 1e-4 of optical depth: no turbulence to evaluate)
  if (hz <= 0.0 && !(smoke > 0.0 && R > 8.0) && P.misc.w * rho * 8.4 * dl < 1e-4) { return o; }
  let turb = P.disk.z;
  if (turb > 0.0) {
    let n = diskTurbulence(R, s.x.z, tNow + s.x.w, a, zn, diskFootprint(s));
    T *= mix(1.0, 0.3 + 0.95 * n.x, turb);
    rho *= mix(1.0, 0.002 + 2.8 * n.y * n.y, turb);
    // (the edge torn into wisps: denser gas reaches farther out)
    rho *= diskFade(R * (1.0 - 0.3 * turb * (n.y - 0.5)), rOut) / max(diskFade(R, rOut), 1e-6);
    // (the mist follows the gas below it, loosely)
    hz *= mix(1.0, 0.4 + 1.2 * n.y, turb);
  }
  var sm = 0.0;
  var smD = 0.0;
  if (smoke > 0.0 && R > 8.0) {
    smD = diskSmoke(R, s.x.z, zn, z, tNow + s.x.w, a);
    sm = smoke * 1.5 / H * edge * smD;
  }
  if (rho < 1e-6 && hz <= 0.0 && sm <= 0.0) { return o; }
  let omega = 1.0 / (pow(max(R, 1.0), 1.5) + a);
  let kEm = circularEmitterEnergy(r, th, a, L, omega);
  var g = (1.0 / E0) / kEm;
  let shift = P.modes.y;
  if (shift == SHIFT_GRAV_ONLY) { g = (1.0 / E0) / zamoEnergy(r, th, a, L); }
  if (shift == SHIFT_NONE) { g = 1.0; }
  let dGas = P.misc.w * rho * kEm * dl;
  let dHaze = hz * kEm * dl;
  let dSmoke = sm * kEm * dl;
  // (one source for the two, weighted by their depths — the mist's: the light of the disk's hot heart,
  // falling off as its solid angle, (10/R)²)
  let lit = min(100.0 / (R * R), 1.0);
  o.S = P.misc.z * (diskSource(T, g) * dGas + lit * diskSource(P.disk.x, g) * dHaze + diskSource((0.4 + 0.4 * (1.0 - smD)) * T0, g) * dSmoke) / max(dGas + dHaze + dSmoke, 1e-30);
  o.dtau = dGas + dHaze + dSmoke;
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
  let sheath = exp(-sq((x - 0.75) / 0.22));
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
  let band = exp(-sq(b / 0.16)) * (0.35 + 0.65 * exp(-lc * lc / 1.6));
  let bulge = exp(-(lc * lc + 4.0 * b * b) / 0.09);
  let clouds = fbmLod(q * 5.0, 5, fw * 5.0);
  let fine = fbmLod(q * 22.0 + vec3f(3.0), 4, fw * 22.0);
  let dustN = fbmLod(q * 9.0 + vec3f(11.0), 5, fw * 9.0);
  let dust = smoothstep(0.42, 0.72, dustN) * exp(-sq(b / 0.06));
  let light = (band * (0.45 + 0.9 * clouds * clouds) * (0.6 + 0.8 * fine) * 1.6 + bulge * 1.0)
    * (1.0 - 0.85 * dust);
  let Tgal = mix(6800.0, 4300.0, clamp(bulge * 2.0 + dust, 0.0, 1.0));
  var col = blackbodyShifted(Tgal, g) * light * 0.09;
  // faint emission nebulae (H-α), Doppler-shifted like a 3000 K source
  let neb = smoothstep(0.68, 0.9, fbmLod(q * 7.0 + vec3f(5.0, 1.0, 2.0), 4, fw * 7.0)) * exp(-sq(b / 0.15));
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
// B−V temperature seen at g·T. Directions are rotated into ICRS equatorial coordinates: the black hole's
// universe by the chosen orientation (skyMatrix: the galactic centre behind the hole), ours — the home
// frame on J2000 ecliptic axes — by the obliquity alone: the constellations where they are in our sky
// (they once took the black hole's orientation too, Orion wherever it fell).
fn realSky(dB: vec3f, g: f32, fpB: Footprint, home: bool) -> vec3f {
  var RX = P.skyX.xyz;
  var RY = P.skyY.xyz;
  var RZ = P.skyZ.xyz;
  if (home) {
    // (J2000 ecliptic → ICRS: about x by −ε, ε = 84 381.448″)
    RX = vec3f(1.0, 0.0, 0.0);
    RY = vec3f(0.0, 0.91748206, -0.39777716);
    RZ = vec3f(0.0, 0.39777716, 0.91748206);
  }
  let d = vec3f(dot(RX, dB), dot(RY, dB), dot(RZ, dB));
  var fp: Footprint;
  fp.jx = vec3f(dot(RX, fpB.jx), dot(RY, fpB.jx), dot(RZ, fpB.jx));
  fp.jy = vec3f(dot(RX, fpB.jy), dot(RY, fpB.jy), dot(RZ, fpB.jy));
  // Milky Way map: u = 0.5 − RA/360°, v = (90° − Dec)/180°
  let uv = vec2f(fract(0.5 - atan2(d.y, d.x) / TAU), acos(clamp(d.z, -1.0, 1.0)) / PI);
  let gx = equirectGrad(d, fp.jx) * vec2f(-1.0, 1.0);
  let gy = equirectGrad(d, fp.jy) * vec2f(-1.0, 1.0);
  var col = textureSampleGrad(mwTex, bgSamp, uv, gx, gy).rgb * shiftRatio(5000.0, g);

  // Catalogue stars through the sky filter; beyond ~cell-sized footprints, the catalogue's
  // radiance map (same flux, mip-filtered) takes over.
  // (splatted: the stars of the whole block searched — σ half a block, 1.5 blocks' reach —, each
  // drawn where it falls by the one ray of the block it falls in)
  let fs = select(1.0, 0.5 * P.res.z / SPLAT_K, SPLAT);
  let filt = skyFilter(d, Footprint(fp.jx * fs, fp.jy * fs), P.time.w);
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
        if (SPLAT) {
          let mt = unpack2x16float(catalogue[b + 3u]);
          // (realSky's 0.5 below; the radiance map's share, 1 − w, kept)
          let F = blackbodyShifted(mt.y * 1000.0, g) * (exp2(-1.3287712 * mt.x) * fluxScale * 0.5 * (1.0 - w));
          splatStar(sd - d, fp.jx / SPLAT_K, fp.jy / SPLAT_K, F);
          continue;
        }
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

// the sky's footprint over a pixel (fp ÷ k) within 1.5× of the unlensed pixel's both ways (its singular values)
fn plainFootprint(fp: Footprint, k: f32) -> bool {
  let a = dot(fp.jx, fp.jx);
  let b = dot(fp.jx, fp.jy);
  let c = dot(fp.jy, fp.jy);
  let h = 0.5 * (a + c);
  let r = sqrt(max(0.25 * (a - c) * (a - c) + b * b, 0.0));
  let n2 = P.camUp.w * P.camUp.w * k * k;
  return h + r < 2.25 * n2 && h - r > n2 / 2.25;
}

// A catalogue star's flux F (radiance × sr) splatted where it falls on the image: its offset v from the
// ray's direction through the pixel Jacobian (J v = offset, least squares in the tangent plane), kept
// when it falls in the ray's block (each star drawn once, by one ray); its radiance F / Ω — the lensed
// pixel's solid angle: the magnification — over a 3×3 Gaussian (the star's size, the pixel filter),
// normalized: no flux lost, and its peak steady as it crosses the pixels.
fn splatStar(v: vec3f, jx: vec3f, jy: vec3f, F: vec3f) {
  let a = dot(jx, jx);
  let b = dot(jx, jy);
  let c = dot(jy, jy);
  let det = a * c - b * b;
  if (det <= 0.0) { return; }
  let px = dot(jx, v);
  let py = dot(jy, v);
  let p = SPLAT_POS + vec2f(c * px - b * py, a * py - b * px) / det;
  let q = p - SPLAT_CELL;
  let blk = P.res.z;
  if (q.x < 0.0 || q.y < 0.0 || q.x >= blk || q.y >= blk) { return; }
  let W = i32(P.res.x);
  let H = i32(P.res.y);
  let om = length(cross(jx, jy));
  let sg = clamp(sqrt(0.1225 + P.time.w * P.time.w / om), 0.5, 1.2);
  let L = SPLAT_MUL * F * (P.camFwd.w / om);
  let p0 = vec2i(floor(p));
  var wt: array<f32, 9>;
  var ws = 0.0;
  for (var k = 0; k < 9; k++) {
    let e = vec2f(p0 + vec2i(k % 3 - 1, k / 3 - 1)) + 0.5 - p;
    wt[k] = exp(-dot(e, e) / (2.0 * sg * sg));
    ws += wt[k];
  }
  for (var k = 0; k < 9; k++) {
    let o = p0 + vec2i(k % 3 - 1, k / 3 - 1);
    if (o.x < 0 || o.y < 0 || o.x >= W || o.y >= H) { continue; }
    let x = L * (wt[k] / ws);
    if (max(x.r, max(x.g, x.b)) < 0.5) { continue; }
    let i = 3u * u32(o.y * W + o.x);
    atomicAdd(&starSplat[i], u32(min(x.r, 4e9) + 0.5));
    atomicAdd(&starSplat[i + 1u], u32(min(x.g, 4e9) + 0.5));
    atomicAdd(&starSplat[i + 2u], u32(min(x.b, 4e9) + 0.5));
  }
}

fn background(d: vec3f, g: f32, fp: Footprint, sky: f32, org: vec4f) -> vec3f {
  var pts = vec3f(0.0);
  if (bodyCount() > 0u && P.bodyCfg2.x > 0.0) {
    // (native sky: Gargantua's side; home: ours, through the wormhole)
    pts = farPoints(select(1u, 2u, sky > 1.5), d, org, skyFilter(d, fp, P.time.w), g);
  }
  return pts + backgroundSky(d, g, fp, sky);
}

fn backgroundSky(d: vec3f, g: f32, fp: Footprint, sky: f32) -> vec3f {
  var mode = P.modes.z;
  // wormhole world: the black hole's universe is the distant galaxy, ours is the chosen sky
  if (HAS_WH && P.wh.x > 0.5 && sky < 1.5) { mode = 4u; }
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
    return realSky(d, g, fp, sky > 1.5) * intensity;
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
fn dnegTrace(l0: f32, n0: vec3f, d0: vec3f, lPlus: f32, lMinus: f32, u0: f32, gObs: f32, travel0: f32) -> WhOut {
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
  // our universe's planets (Saturn): home coordinates of the ray's points, their distance
  let ours = ourStart() < bodyCount();
  var travel = 0.0;
  for (var i = 0u; i < 3000u; i++) {
    if (st.l >= lPlus && st.pl > 0.0) { out.side = 1.0; break; }
    if (st.l <= -lMinus && st.pl < 0.0) { out.side = -1.0; break; }
    let r = dnegR(st.l).x;
    var h = min(min(0.05 * r * r / max(b, 1e-3 * rho), 0.25 * r), 0.08 * (max(abs(st.l) - a, 0.0) + M) + 0.006 * rho);
    if (ours && st.l < -a) {
      // (short steps by them: the chord stays on the ray)
      let X = homePoint(st.l, st.psi, nA, e2);
      for (var k = ourStart(); k < bodyCount(); k++) {
        if (bodyWhere(k) != 4u) { continue; }
        let Rb = bodyRadius(k) * max(ringOuter(k), 1.0);
        h = min(h, max(0.5 * (length(X - bodies[BV * k].xyz) - Rb), 0.3 * Rb));
      }
    }
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
    let psiPrev = st.psi;
    let k1 = dnegRHS(st.l, st.pl, b);
    let k2 = dnegRHS(st.l + 0.5 * h * k1.l, st.pl + 0.5 * h * k1.pl, b);
    let k3 = dnegRHS(st.l + 0.5 * h * k2.l, st.pl + 0.5 * h * k2.pl, b);
    let k4 = dnegRHS(st.l + h * k3.l, st.pl + h * k3.pl, b);
    st.l += h / 6.0 * (k1.l + 2.0 * k2.l + 2.0 * k3.l + k4.l);
    st.pl += h / 6.0 * (k1.pl + 2.0 * k2.pl + 2.0 * k3.pl + k4.pl);
    st.psi += h / 6.0 * (k1.psi + 2.0 * k2.psi + 2.0 * k3.psi + k4.psi);
    if (st.l <= a) { out.len += h; }
    travel += h;
    if (ours && lPrev < -a && st.l < -a && max(lPrev, st.l) > -lMinus) {
      let p0 = homePoint(lPrev, psiPrev, nA, e2);
      let p1 = homePoint(st.l, st.psi, nA, e2);
      let dp = p1 - p0;
      let lp = length(dp);
      if (lp > 0.0 && ourSegment(p0, dp / lp, lp, &out, gObs, travel0 + travel - h, true)) { out.side = -1.0; break; }
    }
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
        let crest = sq(clamp(-0.05 * ws.w, 0.0, 3.0));
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

// A point of our side (ℓ < 0, at angle ψ in the plane (nA, e2)) in our universe's home coordinates
fn homePoint(l: f32, psi: f32, nA: vec3f, e2: vec3f) -> vec3f {
  let n = cos(psi) * nA + sin(psi) * e2;
  return dnegR(l).x * vec3f(n.x, -n.y, n.z) - P.ourCam.xyz;
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
fn glueHit(p0: vec3f, p1: vec3f, C: vec3f) -> f32 {
  let R = P.wh2.z;
  let dv = p1 - p0;
  let f = p0 - C;
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
  let band = exp(-sq(bb / 0.24)) * (0.4 + 0.6 * exp(-lc * lc / 1.2));
  let bulge = exp(-(lc * lc + 2.5 * bb * bb) / 0.22);
  let clouds = fbmLod(q * 4.0, 6, fw * 4.0);
  let fine = fbmLod(q * 16.0 + vec3f(3.0, 1.0, 7.0), 5, fw * 16.0);
  let dn = fbmLod(q * 6.5 + vec3f(11.0, 2.0, 5.0), 6, fw * 6.5);
  let ridge = 1.0 - abs(2.0 * dn - 1.0);
  let dust = clamp(smoothstep(0.62, 0.92, ridge) * exp(-sq(bb / 0.16))
    + 0.5 * smoothstep(0.55, 0.8, dn) * exp(-sq(bb / 0.3)), 0.0, 1.0);
  let light = (band * (0.35 + 1.1 * clouds * clouds) * (0.55 + 0.9 * fine) * 1.8 + bulge * 2.2) * (1.0 - 0.9 * dust);
  let Tg = mix(5600.0, 3900.0, clamp(bulge * 1.5 + 0.4 * dust, 0.0, 1.0));
  var col = blackbodyShifted(Tg, g) * light * 0.1;
  // large coloured clouds along and off the band: H II (Hα), O III, blue reflection nebulae
  let m1 = fbmLod(q * 2.3 + vec3f(5.0, 9.0, 1.0), 5, fw * 2.3);
  let m2 = fbmLod(q * 3.1 + vec3f(1.0, 4.0, 8.0), 5, fw * 3.1);
  let lay = exp(-sq(bb / 0.55));
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
// org: where the ray left for its sky (hole's frame, or our universe's home frame through our end of
// the wormhole) and the coordinate time then: bodies at a finite distance beyond are drawn from there.
// depth: how far the ray went [M, its time |t| on the flat map] before what it shows became opaque
// (the transmittance through 1/2) — the depth of field's; 1e9: the sky, the shadow
struct TraceOut { col: vec3f, bgW: f32, dir: vec3f, gBg: f32, qu: vec2f, sky: f32, tint: vec3f, org: vec4f, depth: f32 };

fn traceOut(col: vec3f) -> TraceOut {
  var o: TraceOut;
  o.col = col;
  o.depth = 1e9;
  return o;
}
var<private> rayDepth: f32 = 1e9;
// (the least Boyer–Lindquist r a ray came to, and where it crossed the equator closest: the far-field
// LUT keeps only rays clear of the photon sphere and of the disk's plane within the disk)
var<private> RMIN: f32 = 1e30;
var<private> CROSSMIN: f32 = 1e30;

var<private> RND: f32 = 0.5; // (the sample's random number: jitters the ground's shadow march)
fn trace(ndc: vec2f, rnd: f32, tNow: f32) -> TraceOut {
  RND = fract(rnd * 7.31 + 0.13);
  FOOT = FOOT_NEAR;
  // Direction the camera looks at, in the camera rest frame (components along ZAMO axes).
  let tanH = P.cam.w;
  let aspect = P.camRight.w;
  let look = normalize(P.camFwd.xyz + ndc.x * tanH * aspect * P.camRight.xyz + ndc.y * tanH * P.camUp.xyz);
  // a body near the camera, in front of everything traced (the light probe, traced by traceLook
  // alone, leaves it out: it does not light itself): met — drawn alone; else the light it adds in
  // front of the traced scene (pre) and what it lets through (T). (traceLook, huge, called at one
  // place only: every call is a copy the shader compiler builds)
  var pre = vec3f(0.0);
  var T = vec3f(1.0);
  var veil = 1.0; // (the sky's glow hiding the stars behind it)
  if (HAS_BODIES && P.near0.w > 0.5) {
    let k = u32(P.near1.w);
    let air = hasAir(k);
    // the body met (its air's own march for a world with air; its relief for the Gargantua planets)
    var hitT = -1.0;
    var hit: NearHit;
    var e: EarthNear;
    if (air) {
      e = earthNear(look, rnd, k);
      hitT = e.t;
    } else {
      hit = nearMarch(look);
      hitT = hit.t;
    }
    // rings in front of the planet (or of the sky): their light, and what they let through
    var ring = vec4f(0.0);
    if (ringOuter(k) > 0.0) {
      let N = P.near3.xyz;
      let dn = dot(look, N);
      let sR = select(-1.0, dot(P.near0.xyz, N) / dn, abs(dn) > 1e-7);
      if (sR > 0.0 && (hitT <= 0.0 || sR < hitT)) {
        let fp = pixFoot() * sR;
        setMapLod(fp, fp / max(abs(dn), 0.05), k);
        let src = lightSource(k);
        let rl = ringLight(k, look * sR - P.near0.xyz, N, P.near4.xyz, -look);
        ring = vec4f(rl.rgb * blackbody(src.x, P.disk.w) * src.y * bodies[BV * k + 3u].y, rl.w);
      }
    }
    if (air) {
      if (hitT > 0.0) {
        var o = traceOut(ring.rgb + (1.0 - ring.w) * e.col);
        o.depth = hitT * bodyRadius(k);
        return o;
      }
      pre = ring.rgb + (1.0 - ring.w) * e.col;
      T = (1.0 - ring.w) * e.T;
      veil = e.veil;
    } else {
      // (on Gargantua's worlds the camera white-balances to the light there — the disk's orange, K2's —
      // part of the way: Mann's ice white, Miller's water grey-blue; the sky beyond keeps its colours)
      var wb = vec3f(1.0);
      if (k < ourStart() && bodyKind(k) != 0u) {
        let le = nearLight(k).e;
        let ll = luminance(le);
        if (ll > 0.0) { wb = ll / max(mix(vec3f(ll), le, 0.6), vec3f(1e-30)); }
      }
      let nair = nearAir(look, select(1e30, hitT, hitT > 0.0), k);
      if (hitT > 0.0) {
        setMapLod(pixFoot() * hitT, 0.0, k);
        var o = traceOut(ring.rgb + (1.0 - ring.w) * (shadeNear(look, hit) * nair.T + nair.L) * wb);
        o.depth = hitT * bodyRadius(k);
        return o;
      }
      pre = ring.rgb + (1.0 - ring.w) * nair.L * wb;
      T = (1.0 - ring.w) * nair.T;
    }
  }
  FOOT = FOOT_FAR;
  var tr = traceLook(look, rnd, tNow);
  tr.col = pre + T * tr.col;
  tr.tint *= T * veil;
  return tr;
}

// ---------------------------------------------------------------------------------------------
// Local patch: the body near the camera (unit sphere at P.near0.xyz, camera at the origin)
// ---------------------------------------------------------------------------------------------
// the probe's harmonics (its axes: P.envX…Z), copied after the bodies (MAX_BODIES × BV vec4) on the GPU
const SH_BASE = 240u; // (MAX_BODIES × BV)
fn shEnv(k: u32) -> vec4f { return bodies[SH_BASE + k]; }

// distance along the look direction to the sphere (in radii), −1 when missed (the perpendicular
// offset is formed directly: no cancellation hundreds of radii away)
fn nearHit(look: vec3f) -> f32 {
  let c = P.near0.xyz;
  let b = dot(look, c);
  let off = c - look * b;
  let h = 1.0 - dot(off, off);
  if (h < 0.0 || b <= 0.0) { return -1.0; }
  return b - sqrt(h);
}

// camera-frame vector → the Ranger's probe's axes
fn camAxes(v: vec3f) -> vec3f { return vec3f(dot(v, P.envX.xyz), dot(v, P.envY.xyz), dot(v, P.envZ.xyz)); }

// irradiance E(n) from the probe's harmonics (Ramamoorthi & Hanrahan)
fn shIrradiance(d: vec3f) -> vec3f {
  let b = array<f32, 9>(
    0.282095, 0.488603 * d.y, 0.488603 * d.z, 0.488603 * d.x,
    1.092548 * d.x * d.y, 1.092548 * d.y * d.z, 0.315392 * (3.0 * d.z * d.z - 1.0),
    1.092548 * d.x * d.z, 0.546274 * (d.x * d.x - d.y * d.y));
  let A = array<f32, 9>(PI, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398);
  var e = vec3f(0.0);
  for (var k = 0u; k < 9u; k++) { e += A[k] * b[k] * shEnv(k).rgb; }
  return max(e, vec3f(0.0));
}

// the probe's radiance around a direction (3 × 3 texels: a slightly rough mirror)
fn envTexel(x: i32, y: i32) -> vec3f {
  let yy = clamp(y, 0, i32(ENV_H) - 1);
  let xx = ((x % i32(ENV_W)) + i32(ENV_W)) % i32(ENV_W);
  return envBuf[u32(yy) * ENV_W + u32(xx)].rgb;
}
// (bilinear, four taps a texel apart: smooth, no blocks where a reflection magnifies it)
fn probeRadiance(d: vec3f) -> vec3f {
  let u = atan2(d.x, d.z) / TAU + 0.5;
  let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
  var acc = vec3f(0.0);
  for (var k = 0; k < 4; k++) {
    let fx = u * f32(ENV_W) - 0.5 + select(-0.6, 0.6, (k & 1) == 1);
    let fy = v * f32(ENV_H) - 0.5 + select(-0.6, 0.6, (k & 2) == 2);
    let x0 = i32(floor(fx));
    let y0 = i32(floor(fy));
    let wx = fx - f32(x0);
    let wy = fy - f32(y0);
    acc += mix(mix(envTexel(x0, y0), envTexel(x0 + 1, y0), wx), mix(envTexel(x0, y0 + 1), envTexel(x0 + 1, y0 + 1), wx), wy);
  }
  return acc * 0.25;
}

// ---- relief (the same function in src/terrain.ts: the ship stands on it) ------------------------
// Heights in metres above the sphere, at a unit direction on the body's axes, resolved to `oct`
// octaves. Mann: ice sheets and sharp ridges; Edmunds: plateaus and dunes; Miller: its water is
// flat — but for the giant waves, long crests moving with the tides (drawn, not felt).
fn tfbm(p0: vec3f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  var n = 0.0;
  for (var i = 0; i < oct; i++) {
    s += a * gnoise(p);
    n += a;
    p = p * 2.03 + vec3f(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / n;
}

fn reliefMax(surf: u32) -> f32 {
  if (surf == 0u) { return 1300.0; }
  if (surf == 1u) { return 4600.0; }
  if (surf == 2u) { return 1800.0; }
  if (airless(surf)) { return 500.0; }
  return 0.0;
}
// the shell of the ground drawn: the relief's, over the measured heights where there are some
fn reliefTop(surf: u32) -> f32 { return reliefMax(surf) + select(0.0, max(P.hd2.y, 0.0), hasDem(surf)); }

// Our airless worlds (the Moon, Mercury, the rocky and icy moons, Ceres, Phobos, Deimos): their ground
// finer than their maps — craters in seven sizes (cells 4 km … 5 m, one crater at most in each: a bowl,
// its raised rim, its ejecta fading out; fresh or worn), a gentle swell. terrain.ts: craterRelief, the
// same on the CPU (the gear on it).
fn airless(surf: u32) -> bool {
  if (surf < 4u) { return false; }
  let m = surf - 4u;
  return regolith(m) && m != 2u && m != 22u;
}
// how cratered: Io's lava resurfaces it, Europa's ice is young, Enceladus' partly
fn craterDensity(m: u32) -> f32 {
  if (m == 10u) { return 0.03; }
  if (m == 11u) { return 0.12; }
  if (m == 15u) { return 0.5; }
  if (m == 12u) { return 0.75; }
  return 1.0;
}
var<private> CRATER_BRIGHT: f32 = 0.0; // (the last relief's fresh ejecta: the albedo's)
var<private> CRATER_GRAD: vec3f = vec3f(0.0); // (…and its craters' slope, exact: dh/dq over the radius)
fn craterRelief(m: u32, q: vec3f, foot: f32, mR: f32) -> f32 {
  let dens = craterDensity(m);
  var h = 0.0;
  var br = 0.0;
  var g = vec3f(0.0);
  var cell = 4000.0;
  for (var l = 0u; l < 7u; l++) {
    // (a size fades in as the pixel resolves it: its cell 8 … 16 footprints wide)
    let w = clamp(log2(cell / (8.0 * max(foot, 0.05))), 0.0, 1.0);
    if (w <= 0.0) { break; }
    let p = q * (mR / cell);
    let c = floor(p);
    let r = hash4(bitcast<vec3u>(vec3i(c)) ^ vec3u(m * 7919u, l * 104729u, 0x9e3779b9u));
    if (r.w < dens * 0.55) {
      let r2 = hash4(bitcast<vec3u>(vec3i(c)) ^ vec3u(l * 2654435u, m * 40503u, 0x85ebca6bu));
      // radius [cells] (many small, few large), its reach 1.6 radii kept inside the cell
      let rad = 0.08 + 0.2 * r2.x * r2.x;
      let ctr = c + vec3f(0.5) + (r.xyz - 0.5) * (1.0 - 3.2 * rad);
      let v = p - ctr;
      let x = length(v) / rad;
      if (x < 1.6) {
        let fresh = 0.3 + 0.7 * r2.y;
        let D = 0.4 * rad * cell * fresh;
        let Hr = 0.22 * D;
        var prof: f32;
        var dp: f32; // d prof / dx
        if (x < 1.0) {
          prof = (x * x - 1.0) * D + Hr;
          dp = 2.0 * x * D;
        } else {
          let e = Hr * exp(-4.0 * (x - 1.0));
          let u = clamp((x - 1.6) / (1.15 - 1.6), 0.0, 1.0);
          let sm = u * u * (3.0 - 2.0 * u);
          let dsm = 6.0 * u * (1.0 - u) / (1.15 - 1.6);
          prof = e * sm;
          dp = -4.0 * e * sm + e * dsm;
        }
        h += w * prof;
        // (dh/dq = dprof/dx · v/|v| / rad · mR/cell; over mR: the slope)
        g += w * dp * v / max(length(v) * rad * cell, 1e-9);
        br += w * pow(fresh, 6.0) * smoothstep(1.55, 0.9, x);
      }
    }
    cell *= 0.33333;
  }
  h += airlessSwell(m, q, foot, mR);
  CRATER_BRIGHT = min(br, 1.0);
  CRATER_GRAD = g;
  return h;
}
// the swell (a few km) under the craters
fn airlessSwell(m: u32, q: vec3f, foot: f32, mR: f32) -> f32 {
  let os = layerOctF(mR / 3000.0, foot, mR, 5.0);
  if (os <= 0.0) { return 0.0; }
  return tfbmF(q * (mR / 3000.0) + vec3f(f32(m) * 3.7), os) * min(os, 1.0) * 90.0;
}

// octaves of a layer of base frequency f (cycles per radian) resolved at a footprint (metres)
fn layerOct(f: f32, foot: f32, mR: f32, most: i32) -> i32 {
  return clamp(i32(log2(mR / (f * 4.0 * max(foot, 0.05)))), 0, most);
}

// ridged noise (sharp crests), 0…1
fn ridged(p: vec3f, oct: i32) -> f32 {
  if (oct <= 0) { return 0.5; }
  let r = 1.0 - abs(tfbm(p, oct));
  return r * r;
}

// The ground's height [m] at q: the relief over the measured heights (P.hd2) where there are some; cheap:
// these filtered by the hardware (the marches' steps)
fn relief(surf: u32, q: vec3f, foot: f32, mR: f32, tSec: f32) -> f32 {
  return reliefBase(surf, q, foot, mR, tSec) + select(0.0, demH0(q, foot), hasDem(surf));
}
fn reliefStep(surf: u32, q: vec3f, foot: f32, mR: f32, tSec: f32) -> f32 {
  return reliefBase(surf, q, foot, mR, tSec) + select(0.0, demStep(q, foot), hasDem(surf));
}
// the relief alone (its normal: the measured heights' is the finer map's, hdNormal)
// foot: the pixel's footprint on the ground [m], mR: metres per radius (the layers' detail)
fn reliefBase(surf: u32, q: vec3f, foot: f32, mR: f32, tSec: f32) -> f32 {
  if (surf >= 4u) { return select(0.0, craterRelief(surf - 4u, q, foot, mR), airless(surf)); }
  if (surf == 1u) {
    // Mann: ice sheets, ridges, hills, rubble
    // (noise cells: continents 1 000 km, ridges 270 km, mountains 21 km, crags 2 km, rocks 210 m, rubble 21 m)
    var h = (0.5 + 0.5 * tfbm(q * 6.0, max(layerOct(6.0, foot, mR, 5), 1))) * 1400.0;
    h += ridged(q * 24.0 + vec3f(5.0), layerOct(24.0, foot, mR, 4)) * 900.0;
    let oh = layerOctF(300.0, foot, mR, 5.0);
    if (oh > 0.0) { h += ridgedMF(q * 300.0 + vec3f(2.0), oh) * 1800.0; }
    let oc = layerOct(3000.0, foot, mR, 3);
    if (oc > 0) { h += ridged(q * 3000.0 + vec3f(7.0), oc) * 300.0; }
    let orc = layerOct(30000.0, foot, mR, 3);
    if (orc > 0) { h += (0.5 + 0.5 * tfbm(q * 30000.0, orc)) * 40.0; }
    let ou = layerOct(300000.0, foot, mR, 2);
    if (ou > 0) { h += (0.5 + 0.5 * tfbm(q * 300000.0, ou)) * 4.0; }
    return h;
  }
  if (surf == 2u) {
    // Edmunds: plateaus, mesas, dunes
    let base = 0.5 + 0.5 * tfbm(q * 5.0, max(layerOct(5.0, foot, mR, 5), 1));
    var h = base * 1000.0;
    let om = layerOct(300.0, foot, mR, 3);
    if (om > 0) { h += smoothstep(0.55, 0.62, 0.5 + 0.5 * tfbm(q * 300.0, om)) * 380.0; }
    let oh = layerOct(3000.0, foot, mR, 3);
    if (oh > 0) { h += (0.5 + 0.5 * tfbm(q * 3000.0 + vec3f(3.0), oh)) * 200.0; }
    let ou = layerOct(300000.0, foot, mR, 2);
    if (ou > 0) { h += (0.5 + 0.5 * tfbm(q * 300000.0, ou)) * 3.0; }
    let od = layerOct(30000.0, foot, mR, 1);
    if (od > 0) {
      let dune = 0.5 + 0.5 * sin(dot(q, vec3f(0.6, 0.8, 0.0)) * 30000.0 + 4.0 * tfbm(q * 80.0, 2));
      h += dune * 25.0 * smoothstep(0.45, 0.25, base);
    }
    return h;
  }
  if (surf == 0u) {
    // Miller's giant waves: three trains of crests ~2 900 km apart, 1.2 km high walls ~60 km wide,
    // moving at ~20 m/s (drawn, not felt; terrain.ts: millerWaves, the same)
    var h = 0.0;
    for (var i = 0u; i < 3u; i++) {
      let fi = f32(i);
      let dir = normalize(vec3f(cos(fi * 2.1 + 0.3), sin(fi * 2.1 + 0.3), 0.35 * fi - 0.3));
      let ph = dot(q, dir) * 14.0 + fi * 1.7 - tSec * (4.0e-5 + 1.0e-5 * fi);
      let crest = pow(0.5 + 0.5 * sin(ph), 40.0);
      h += crest * (0.65 + 0.35 * tfbm(q * 40.0 + vec3f(fi), max(layerOct(40.0, foot, mR, 5), 1)));
    }
    return h * 1200.0;
  }
  return 0.0;
}

struct NearHit { t: f32, qb: vec3f, h: f32 };

// the body's own axes of a camera-frame direction
fn toBody(v: vec3f) -> vec3f { return vec3f(dot(v, P.near1.xyz), dot(v, P.near2.xyz), dot(v, P.near3.xyz)); }
fn fromBody(v: vec3f) -> vec3f { return v.x * P.near1.xyz + v.y * P.near2.xyz + v.z * P.near3.xyz; }
// The camera on the near body's axes [its radii]: from the CPU's float64 — turned in float32 here from
// the far frame's axes (the world turning with the ground under the camera), its rounding came out
// differently each frame: the camera 0.4 m up or down, the ground near it shaking
fn nearCam() -> vec3f { return select(toBody(-P.near0.xyz), P.nearCam0.xyz + P.nearCam1.xyz, P.nearCam1.w > 0.5); }

// the pixel's footprint on the ground at a distance t (radii), in metres
fn reliefFoot(t: f32) -> f32 { return max(t * pixFoot() * P.near4.w, 0.05); }

// The ray against the relief: marched from the relief's bounding shell, steps a fraction of the
// height above the ground (and of the distance: the far horizon), then bisected. t < 0: missed.
fn nearMarch(look: vec3f) -> NearHit {
  var o: NearHit;
  o.t = -1.0;
  let k = u32(P.near1.w);
  let surf = u32(bodies[BV * k + 2u].z);
  let c = P.near0.xyz;
  let mR = P.near4.w;
  let tSec = P.time.x * P.near5.w;
  let hmax = reliefTop(surf) / mR;
  let Rs = 1.0 + hmax;
  let b = dot(look, c);
  let off = c - look * b;
  let d2 = dot(off, off);
  if (d2 > Rs * Rs) { return o; }
  let sq = sqrt(Rs * Rs - d2);
  let t1 = b + sq;
  if (t1 <= 0.0) { return o; }
  var t = max(b - sq, 0.0);
  var tPrev = t;
  if (hmax <= 0.0) {
    // no relief (a gas giant): the sphere
    let h = 1.0 - d2;
    if (h < 0.0 || b <= 0.0) { return o; }
    o.t = b - sqrt(h);
    let p = look * o.t - c;
    o.qb = normalize(toBody(p));
    return o;
  }
  // (on the body's axes, from the camera there in float64 — see nearCam — and the height above the sphere
  // to the millimetre: see earthMarch)
  let fine = P.nearCam1.w > 0.5;
  let A = select(toBody(-c), P.nearCam0.xyz, fine);
  let e = select(dot(A, A) - 1.0, P.nearCam0.w, fine);
  let oc = select(vec3f(0.0), P.nearCam1.xyz, fine);
  let rd = toBody(look);
  let dem = hasDem(surf);
  let rmax = reliefMax(surf);
  // (the least step, a share of the distance: two of the probe's beams in the light probe — its texels wide)
  let least = max(0.02, 2.0 * probeBeam);
  for (var i = 0u; i < 220u; i++) {
    let v = oc + rd * t;
    let p = A + v;
    let r = length(p);
    let qb = p / r;
    let hgt = (e + 2.0 * dot(A, v) + dot(v, v)) / (r + 1.0);
    // (over the measured ground: above its highest within a reach growing with the distance, a stride of
    // that reach — or, falling, of what its fall leaves above it. Their shell is their highest anywhere,
    // kilometres over a plain: the rays grazing it took the 220 steps of 2 % of the distance)
    if (dem) {
      let reach = 0.25 * t * mR + 2000.0;
      let above = hgt * mR - demTop(qb, reach) - rmax;
      let rise = dot(p, rd) / r;
      let stride = select(min(reach, above / max(-rise, 1e-6)), reach, rise >= 0.0) / mR;
      // (no shorter than the march's own least step)
      if (above > 0.0 && stride > least * t) {
        t += stride;
        tPrev = t;
        if (t > t1) { break; }
        continue;
      }
    }
    let h = reliefStep(surf, qb, reliefFoot(t), mR, tSec) / mR;
    let f = hgt - h;
    if (f < 0.0) {
      // bisect between the last point above and this one
      var lo = tPrev;
      var hi = t;
      for (var j = 0u; j < 10u; j++) {
        let m = 0.5 * (lo + hi);
        let vm = oc + rd * m;
        let pm = A + vm;
        let rm = length(pm);
        if ((e + 2.0 * dot(A, vm) + dot(vm, vm)) / (rm + 1.0) - relief(surf, pm / rm, reliefFoot(m), mR, tSec) / mR < 0.0) { hi = m; } else { lo = m; }
      }
      o.t = hi;
      o.qb = normalize(A + oc + rd * hi);
      o.h = relief(surf, o.qb, reliefFoot(hi), mR, tSec);
      return o;
    }
    tPrev = t;
    t += max(0.6 * f, least * t + 1e-9);
    if (t > t1) { break; }
  }
  return o;
}

// the relief's normal at qb (body axes) by finite differences, in the camera frame, its detail no
// finer than the pixel's footprint nor than minFoot [m]
fn reliefNormal(surf: u32, qb: vec3f, t: f32, tSec: f32, minFoot: f32) -> vec3f {
  let mR = P.near4.w;
  let foot = max(reliefFoot(t), minFoot);
  if (airless(surf)) {
    // the craters' slope exact (no finite step: sharp down to their smallest), the swell's by differences
    _ = craterRelief(surf - 4u, qb, foot, mR);
    let gc = CRATER_GRAD;
    let es = max(t * pixFoot(), 100.0 / mR);
    let a1 = normalize(cross(qb, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(qb.z) > 0.9)));
    let a2 = cross(qb, a1);
    let s0 = airlessSwell(surf - 4u, qb, foot, mR);
    let s1 = airlessSwell(surf - 4u, normalize(qb + a1 * es), foot, mR);
    let s2 = airlessSwell(surf - 4u, normalize(qb + a2 * es), foot, mR);
    let g = gc - qb * dot(gc, qb) + ((s1 - s0) * a1 + (s2 - s0) * a2) / (es * mR);
    return normalize(fromBody(normalize(qb - g)));
  }
  // (no finer than 10 m: float32 directions on the unit sphere are ~0.4 m apart — finer, the normal
  // is noise in blocks)
  let e = max(t * pixFoot(), 2.0 * max(minFoot, 5.0) / mR);
  let t1 = normalize(cross(qb, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(qb.z) > 0.9)));
  let t2 = cross(qb, t1);
  let h0 = reliefBase(surf, qb, foot, mR, tSec);
  let h1 = reliefBase(surf, normalize(qb + t1 * e), foot, mR, tSec);
  let h2 = reliefBase(surf, normalize(qb + t2 * e), foot, mR, tSec);
  let g = ((h1 - h0) * t1 + (h2 - h0) * t2) / (e * mR);
  return normalize(fromBody(normalize(qb - g)));
}

// The light for the air and the ground: its dominant direction (camera frame) and irradiance
struct NearLight { dir: vec3f, e: vec3f };
fn nearLight(k: u32) -> NearLight {
  var o: NearLight;
  let mode = P.near3.w;
  if (mode > 0.5 && mode < 1.5) {
    let d = shEnv(9u).xyz;
    o.dir = normalize(d.x * P.envX.xyz + d.y * P.envY.xyz + d.z * P.envZ.xyz);
    o.e = shIrradiance(d);
  } else if (mode > 1.5) {
    o.dir = normalize(shEnv(9u).xyz);
    o.e = shIrradiance(o.dir);
  } else {
    o.dir = P.near4.xyz;
    let src = lightSource(k);
    o.e = blackbody(src.x, P.disk.w) * src.y * bodies[BV * k + 3u].y * PI;
  }
  return o;
}

fn nearE(n: vec3f) -> vec3f {
  let mode = P.near3.w;
  if (mode > 0.5 && mode < 1.5) { return shIrradiance(camAxes(n)); }
  return shIrradiance(n);
}

// The air along the look direction up to t (radii): transmittance and the light it scatters to the
// camera (single scattering of the dominant light, Rayleigh and Mie, sea-level coefficients of the
// Earth's air scaled by the density; the light's own path through the air, Chapman-like; the
// planet's shadow).
struct Air { T: vec3f, L: vec3f };
fn nearAir(look: vec3f, tEnd: f32, k: u32) -> Air {
  var o: Air;
  o.T = vec3f(1.0);
  o.L = vec3f(0.0);
  if (P.near5.y <= 0.0) { return o; }
  // (the world's air — its scale height, its density — in the solar system's model: the Earth's
  // molecules and aerosols scaled by its density, no ozone)
  var a: AirSpec;
  a.rm = P.near4.w; a.hr = P.near5.x; a.hm = 0.15 * P.near5.x; a.top = (P.near5.z - 1.0) * P.near4.w;
  a.br = vec3f(5.802e-6, 13.558e-6, 33.1e-6) * P.near5.y; a.bo = vec3f(0.0);
  a.bms = vec3f(2.1e-5) * P.near5.y; a.bme = 2.33e-5 * P.near5.y; a.g = vec3f(0.8); a.k = 1.0;
  a.sky = vec3f(0.0); a.moon = 0.0;
  AIR = a;
  let lt = nearLight(k);
  let e = earthAir(-P.near0.xyz, look, tEnd, lt.dir, lt.e, 0.5, 3e38);
  o.T = e.T;
  o.L = e.L;
  return o;
}

// The relief's shadow at a point of the ground (q: its direction, h: its height [m]) towards the light
// (L: body axes): marched in growing steps from 0.5 m to ~60 km (their start jittered per sample: no
// bands), soft over the source's half degree
fn nearShadow(surf: u32, q: vec3f, h: f32, L: vec3f, foot: f32, tSec: f32) -> f32 {
  let mR = P.near4.w;
  // (the shell: the relief's over the measured heights' highest within the march's reach, ~60 km)
  let hmax = select(reliefTop(surf), reliefMax(surf) + demTop(q, 6.0e4), hasDem(surf)) / mR;
  let p0 = q * (1.0 + h / mR);
  if (dot(L, q) < -0.2) { return 0.0; } // (the night side: in the planet's own shadow)
  // (the steps' cheap ground against the point's own: their difference there taken off — no self-shadow)
  let b0 = select(0.0, demStep(q, foot) - demH0(q, foot), hasDem(surf));
  var s = 1.0;
  var d = max(0.5, foot) / mR * exp2(0.3 * RND);
  for (var i = 0u; i < 56u; i++) {
    let pp = p0 + L * d;
    let r = length(pp);
    if (r - 1.0 > hmax) { break; }
    let hh = (reliefStep(surf, pp / r, max(foot, d * mR * 0.02), mR, tSec) - b0) / mR;
    // (its clearance [m], less a bias: the ground there drawn at a coarser footprint than the pixel's)
    let cl = (r - 1.0 - hh) * mR + 0.5 + 0.01 * d * mR;
    s = min(s, smoothstep(-1.0, 1.0, cl / (d * mR * 0.0087)));
    if (s <= 0.0) { break; }
    // (the light probe's texels wide: its shadows coarser)
    d *= select(1.23, 1.6, probeBeam > 0.0);
  }
  return s;
}

// Gradient noise on an integer lattice (base) plus a small offset f: exact far from the body's centre
fn gnoiseI(base: vec3i, f0: vec3f) -> f32 {
  let i = floor(f0);
  let f = f0 - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var n: array<f32, 8>;
  for (var c = 0u; c < 8u; c++) {
    let o = vec3f(f32(c & 1u), f32((c >> 1u) & 1u), f32((c >> 2u) & 1u));
    let h = hash3u(bitcast<vec3u>(base + vec3i(i + o)));
    let g = vec3f(f32(h & 0x3ffu), f32((h >> 10u) & 0x3ffu), f32((h >> 20u) & 0x3ffu)) * (2.0 / 1023.0) - 1.0;
    n[c] = dot(g, f - o);
  }
  return 1.6 * mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y),
                   mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z);
}
// An airless world's ground at its finest (x: from the anchor [m], body axes): the regolith's roughness,
// 16 m down to 25 cm, and stones — shading only (the relief stops at its 5 m craters)
fn fineGround(x: vec3f, foot: f32) -> f32 {
  let a = vec3i(P.fine0.xyz);
  var h = 0.0;
  for (var k = 0; k < 7; k++) {
    let e = 4 - k; // the octave's cell: 2^e m
    let sc = exp2(f32(e));
    let w = clamp(log2(sc / (2.0 * foot)), 0.0, 1.0);
    if (w <= 0.0) { break; }
    let base = select(a << vec3u(u32(-e)), a >> vec3u(u32(max(e, 0))), e >= 0);
    h += w * 0.035 * sc * gnoiseI(base + vec3i(k * 1013), x / sc);
    if (e <= 1 && e >= -1) {
      // stones: the noise's highest bumps, sharpened
      let st = gnoiseI(base + vec3i(7919 + k), x / sc + vec3f(0.37));
      h += w * 0.35 * sc * smoothstep(0.4, 0.85, st) * smoothstep(0.4, 0.85, st);
    }
  }
  return h;
}

fn shadeNear(look: vec3f, hit: NearHit) -> vec3f {
  let k = u32(P.near1.w);
  let t = hit.t;
  let qb = hit.qb;
  let surf = u32(bodies[BV * k + 2u].z);
  let tSec = P.time.x * P.near5.w;
  let n0 = select(normalize(fromBody(qb)), reliefNormal(surf, qb, t, tSec, 0.0), reliefMax(surf) > 0.0 && bodyKind(k) != 0u);
  if (bodyKind(k) == 0u) {
    // a star: limb darkening in the camera frame, its granulation fixed on it
    let mu = clamp(-dot(n0, look), 0.0, 1.0);
    let sf = starSurface(qb, P.time.x);
    let b2 = bodies[BV * k + 2u];
    return blackbody(b2.x * pow(0.2 + 0.8 * mu, 0.25) * sf.y, P.disk.w) * b2.y * sf.x;
  }
  if (P.near3.w < 0.5) {
    BODYW = mat3x3f(P.near1.xyz, P.near2.xyz, P.near3.xyz);
    var sh = 1.0;
    var n = n0;
    if (reliefTop(surf) > 0.0) {
      // the relief's shadows (a light source: its penumbra half a degree), and on our airless worlds the
      // fresh craters' bright ejecta, the regolith's mottling
      let foot = reliefFoot(t);
      sh = nearShadow(surf, qb, hit.h, toBody(P.near4.xyz), foot, tSec);
      // (and the Ranger's, the ground within reach of it)
      sh *= shipShadow(look * t * P.near4.w);
      if (airless(surf)) {
        _ = relief(surf, qb, foot, P.near4.w, tSec);
        ALB_GAIN = 1.0 + 0.45 * CRATER_BRIGHT;
        if (P.fine0.w > 0.5 && foot < 8.0) {
          // the finest ground, near: its slope by differences (exact: from the anchor), its stones lighter
          let x = toBody(look * t) * P.near4.w + P.fine1.xyz;
          let a1 = normalize(cross(qb, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(qb.z) > 0.9)));
          let a2 = cross(qb, a1);
          let e = max(foot, 0.03);
          let h0 = fineGround(x, foot);
          let g = ((fineGround(x + a1 * e, foot) - h0) * a1 + (fineGround(x + a2 * e, foot) - h0) * a2) / e;
          n = normalize(n - fromBody(g) * smoothstep(8.0, 2.0, foot));
          ALB_GAIN *= 1.0 + clamp(h0 * 0.25, -0.15, 0.2);
        }
      }
    }
    // (in the shadows the light the lit ground around sheds: a few per cent)
    let c = planetShade(k, n, qb, P.near4.xyz, -look, P.time.x, 1.0, ringShadow(k, look * t - P.near0.xyz, P.near3.xyz, P.near4.xyz));
    ALB_GAIN = 1.0;
    return c * (sh + (1.0 - sh) * 0.03);
  }
  // lit by a light probe (the environment of the planet: the lensed disk, Gargantua, the sky):
  // diffuse albedo/π · E(n); water mirroring the environment (Fresnel)
  let ranger = P.near3.w < 1.5;
  var A = planetAlbedo(k, qb, P.time.x);
  let up = normalize(fromBody(qb));
  // (the ground's colour follows the mountains' faces, not the rocks: a normal without the detail
  // finer than 150 m)
  let nm = select(n0, reliefNormal(surf, qb, t, tSec, 150.0), surf != 0u);
  let slope = 1.0 - clamp(dot(nm, up), 0.0, 1.0);
  if (surf == 1u) {
    // ice: blue ice on the steep faces, snow on the heights
    A = vec4f(mix(A.rgb, vec3f(0.45, 0.62, 0.78), smoothstep(0.06, 0.25, slope)) * (0.9 + 0.1 * smoothstep(2400.0, 3600.0, hit.h)), A.w);
  } else if (surf == 2u) {
    A = vec4f(A.rgb * mix(1.0, 0.6, smoothstep(0.08, 0.3, slope)), A.w);
  }
  var n = n0;
  if (surf == 0u) {
    // (the sea's wind waves and swell on the giant ones: slopes of noise, as fine as the pixel resolves
    // — the sky's reflection broken, glittering)
    let foot = reliefFoot(t);
    var g = vec3f(0.0);
    for (var i = 0u; i < 2u; i++) {
      let lam = select(40.0, 400.0, i == 0u);
      let w = smoothstep(lam * 0.5, lam * 0.1, foot);
      if (w > 0.0) {
        let p = qb * (P.near4.w / lam) + vec3f(f32(i) * 7.3, 0.0, tSec * 0.12 / lam);
        g += w * 0.07 * vec3f(gnoise(p), gnoise(p + vec3f(17.1)), gnoise(p + vec3f(31.7)));
      }
    }
    n = normalize(n0 + g - up * dot(g, up));
  }
  let E = nearE(n);
  var col = A.rgb / PI * E;
  let mu = clamp(-dot(n, look), 0.0, 1.0);
  if (surf == 0u) {
    // the sea: the bed seen through knee-deep water, the sky's reflection, foam on the crests
    let F = 0.02 + 0.98 * pow(1.0 - mu, 5.0);
    let refl = select(shIrradiance(reflect(look, n)) / PI, probeRadiance(camAxes(reflect(look, n))), ranger);
    col = col * (1.0 - F) + F * refl;
    let foam = smoothstep(700.0, 1100.0, hit.h) * (0.5 + 0.5 * gnoise(qb * 4000.0));
    col = mix(col, vec3f(0.85) / PI * E, foam * 0.8);
  }
  return col;
}

// ---------------------------------------------------------------------------------------------
// The Earth (src/system/earth-maps.ts): its maps — the day colour and the clouds, the city lights
// (cube maps), the relief and the oceans (equirectangular) — and its air: Rayleigh, Mie and ozone,
// single scattering along the view, the sunlight's way down through the air in closed form (Chapman)
// — the reddened terminator, the planet's shadow; the clouds a thin layer a few km up, casting their
// shadows on the ground; the ocean's glint (GGX, a wind-roughened sea); the cities lit at night.
// Frame: the Earth's own axes (x Greenwich, y 90° E, z north), lengths in its radii.
// ---------------------------------------------------------------------------------------------
@group(0) @binding(19) var earthCube: texture_cube<f32>;  // day colour (sRGB), cloud cover (alpha)
@group(0) @binding(20) var earthNight: texture_cube<f32>; // city lights (r)
@group(0) @binding(21) var earthElev: texture_2d<f32>;    // the height above the sea [m] (ETOPO 2022), the oceans
// the terrain tiles' levels (rg32uint, 1024²): their heights' float bits [m]; up to z 8 their imagery
// (rgba8: the day's sRGB, the night's lights; 0: none)
@group(0) @binding(28) var earthTiles: texture_2d_array<u32>;
// the body near the camera: its finer colour map and relief (src/system/hd-maps.ts; P.hd)
@group(0) @binding(22) var hdColor: texture_2d<f32>;
@group(0) @binding(23) var hdRelief: texture_2d<f32>;    // normal (east, south), ocean, height
// the Ranger's shadow map (ship.ts: orthographic from its dominant light over its bounding sphere)
@group(0) @binding(26) var shipShadowMap: texture_depth_2d;

// The Ranger's shadow on the ground under it: a point pw from the camera [m, world axes] seen in the
// ship's own shadow map — the view from its light probe's dominant light (shEnv(9)), across its bounding
// sphere (ship.wgsl: lightClip) —; lit where nothing of the hull is between it and the light (3 × 3 taps)
fn shipShadow(pw: vec3f) -> f32 {
  let R = P.shipShadow.w;
  if (R <= 0.0) { return 1.0; }
  let dl = shEnv(9u).xyz;
  if (dot(dl, dl) < 1e-12) { return 1.0; }
  let lw = normalize(dl.x * P.envX.xyz + dl.y * P.envY.xyz + dl.z * P.envZ.xyz);
  let l = vec3f(dot(lw, P.camRight.xyz), dot(lw, P.camUp.xyz), dot(lw, P.camFwd.xyz));
  let p = vec3f(dot(pw, P.camRight.xyz), dot(pw, P.camUp.xyz), dot(pw, P.camFwd.xyz));
  let e1 = normalize(cross(l, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(l.y) > 0.9)));
  let e2 = cross(l, e1);
  let q = p - P.shipShadow.xyz;
  let c = vec3f(dot(q, e1) / R, dot(q, e2) / R, 0.5 - 0.5 * dot(q, l) / R);
  if (abs(c.x) >= 1.0 || abs(c.y) >= 1.0) { return 1.0; }
  let dims = vec2i(textureDimensions(shipShadowMap));
  let px = vec2i(vec2f(0.5 + 0.5 * c.x, 0.5 - 0.5 * c.y) * vec2f(dims));
  var lit = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let d = textureLoad(shipShadowMap, clamp(px + vec2i(i, j), vec2i(0), dims - 1), 0);
      lit += select(0.0, 1.0, d >= 0.9999 || c.z <= d + 0.004);
    }
  }
  return lit / 9.0;
}

// the disk's turbulence: gradient noise baked into a tiling texture (noise3d.ts: period 32, 4 texels a unit)
@group(0) @binding(24) var noiseTex: texture_3d<f32>;
@group(0) @binding(25) var noiseSamp: sampler;

const EARTH_SURF = 4u;        // its surface kind: the first map (solar.ts: MAPS_HI)
// the night sky's light on the ground (the stars, the airglow — a moonless night, drawn brighter than
// it is: the ground shows, faintly, cool), over the sunlight's irradiance
const EARTH_NIGHT = vec3f(0.06, 0.075, 0.11);
// The night's light on the ground as the eye sees it (EARTH_NIGHT) — none in the Moon's shadow by day:
// there the sky's own light, the sky seen (sk: skySeen), a ten-thousandth of the day's at the umbra's
// heart (the floor, 6 % of the sunlight, lit the totality's ground above the partial phase's)
fn nightFloor(sk: f32, mu0: f32) -> vec3f {
  return EARTH_NIGHT * P.earth4.x * (1.0 - smoothstep(-0.05, 0.1, mu0) * (1.0 - sk));
}
// the full Moon's light at night, over the sunlight's irradiance (drawn far brighter than it is — a
// moonlit landscape shows, silvery), and the moonlight at q: its direction's cosine on the normal n,
// through the air, faded in as the night falls
const EARTH_MOON = vec3f(0.07, 0.085, 0.11);
fn earthMoonlight(q: vec3f, n: vec3f, h: f32, mu0: f32) -> vec3f {
  let Lm = P.earth3.xyz;
  let mz = dot(q, Lm);
  let night = 1.0 - smoothstep(-0.12, 0.06, mu0);
  if (mz < -0.05 || night <= 0.0 || P.earth3.w <= 0.0) { return vec3f(0.0); }
  return EARTH_MOON * pow(P.earth3.w, 1.5) * night * smoothstep(-0.05, 0.05, mz) * max(dot(n, Lm), 0.0) * sunThrough(h, mz);
}
const EARTH_RM = 6.378137e6;  // metres per radius: WGS84's a, the equator's (src/system/ellipsoid.ts)
// The Earth's figure: the WGS84 ellipsoid, its poles 21 km in. On the Earth's axes squashed — z × a/b —
// it is the unit sphere: its ground, relief, clouds and air are marched there as on a sphere, the rays
// taken there (squashed, renormalised; their lengths back by m), the maps read at the geodetic latitude
const EARTH_AB = 1.0033640898209764;
// a world's z scale into its squashed axes (the others are spheres: 1)
fn squashOf(k: u32) -> f32 { return select(1.0, EARTH_AB, isEarth(k)); }
fn squashed(v: vec3f, ab: f32) -> vec3f { return vec3f(v.x, v.y, v.z * ab); }
// the geodetic direction (the ellipsoid's normal: the maps' latitude) at a unit direction of the squashed space
fn geoQ(q: vec3f) -> vec3f { return normalize(vec3f(q.x, q.y, q.z * EARTH_AB)); }
// the metres along the ground's normal a radial step of the squashed space is, per metre of a
fn earthSq(q: vec3f) -> f32 { return sqrt(1.0 - (1.0 - 1.0 / (EARTH_AB * EARTH_AB)) * q.z * q.z); }
// a ray from ro along rd against the unit sphere (ro outside or in: the near side ahead), −1 when missed
fn unitHit(ro: vec3f, rd: vec3f) -> f32 {
  let b = dot(ro, rd);
  let off = ro - rd * b;
  let h = 1.0 - dot(off, off);
  if (h < 0.0 || b >= 0.0) { return -1.0; }
  return -b - sqrt(h);
}
// A world's air (the Earth's, Mars' dust, Venus' and Titan's hazes, the giants' hydrogen, Pluto's blue
// layers): its size, its scale heights, its molecules' scattering (and the Earth's ozone), its
// aerosols' — coloured: their single-scattering albedo, a Henyey–Greenstein asymmetry per colour (Mars'
// dust throws more blue forwards: its blue sunset) — the sky's light on its ground, and how much
// thicker it is drawn (k: its scale heights × k, its densities / k — the same columns, a limb's glow k
// times as tall). Set for the body being drawn (setAir): the functions below read it.
struct AirSpec {
  rm: f32,     // metres per radius
  top: f32,    // the air's top [m]
  hr: f32,     // scale heights [m]: the molecules, the aerosols
  hm: f32,
  br: vec3f,   // molecular scattering at the ground [1/m]
  bo: vec3f,   // absorption carried with the molecules [1/m] (the Earth's ozone)
  bms: vec3f,  // the aerosols' scattering [1/m] (their albedo × their extinction)
  bme: f32,    // their extinction [1/m]
  g: vec3f,    // their asymmetry, per colour
  k: f32,      // drawn thicker (1: as it is)
  sky: vec3f,  // the sky's light on the ground by day, over the sunlight's irradiance
  moon: f32,   // the Moon's light scattered too (the Earth: 1)
};
var<private> AIR: AirSpec;
// the maps (solar.ts: MAPS_HI, then MAPS_LO) of the worlds with air
fn airOf(m: u32) -> bool { return m == 0u || m == 2u || m == 4u || m == 5u || m == 6u || m == 19u || m == 20u || m == 21u || m == 22u; }
fn hasAir(k: u32) -> bool {
  let surf = u32(bodies[BV * k + 2u].z);
  return bodyKind(k) != 0u && surf >= 4u && airOf(surf - 4u) && (surf != EARTH_SURF || earthOn());
}
fn setAir(k: u32) {
  let m = u32(bodies[BV * k + 2u].z) - 4u;
  var a: AirSpec;
  // the Earth: Rayleigh, ozone, an ordinary day's aerosols (τ ≈ 0.03)
  a.rm = EARTH_RM; a.top = 100e3; a.hr = 8000.0; a.hm = 1200.0;
  a.br = vec3f(5.802e-6, 13.558e-6, 33.1e-6); a.bo = vec3f(1.22e-6, 3.53e-6, 0.16e-6);
  a.bms = vec3f(2.1e-5); a.bme = 2.33e-5; a.g = vec3f(0.8); a.k = max(P.earth2.w, 1.0);
  a.sky = vec3f(0.035, 0.06, 0.12); a.moon = 1.0;
  if (m != 0u) { a.moon = 0.0; }
  if (m == 2u) {
    // Mars: 0.6 % of the Earth's air (CO₂), its dust (τ ≈ 0.4, well mixed): the butterscotch sky, the
    // blue sunset round the sun
    a.rm = 3.3895e6; a.top = 80e3; a.hr = 11100.0; a.hm = 11100.0;
    a.br = vec3f(2.2e-7, 5.2e-7, 1.27e-6); a.bo = vec3f(0.0);
    a.bms = 3.6e-5 * vec3f(0.94, 0.78, 0.6); a.bme = 3.6e-5; a.g = vec3f(0.62, 0.7, 0.8); a.k = 2.0;
    a.sky = vec3f(0.07, 0.045, 0.025);
  } else if (m == 6u) {
    // Venus: above its cloud deck (the drawn ground), CO₂ and a yellowish sulphuric haze
    a.rm = 6.0518e6; a.top = 90e3; a.hr = 15900.0; a.hm = 6000.0;
    a.br = vec3f(1.4e-6, 3.3e-6, 8.0e-6); a.bo = vec3f(0.0);
    a.bms = 1.2e-5 * vec3f(1.0, 0.93, 0.78); a.bme = 1.2e-5; a.g = vec3f(0.72); a.k = 2.0;
    a.sky = vec3f(0.12, 0.1, 0.06);
  } else if (m == 19u) {
    // Titan: an orange photochemical haze, optically thick (τ ≈ 4) — the ground barely shows
    a.rm = 2.5747e6; a.top = 500e3; a.hr = 20000.0; a.hm = 60000.0;
    a.br = vec3f(1.2e-5, 2.8e-5, 6.8e-5) * 0.15; a.bo = vec3f(0.0);
    a.bms = 6.7e-5 * vec3f(0.92, 0.66, 0.3); a.bme = 6.7e-5; a.g = vec3f(0.62); a.k = 1.0;
    a.sky = vec3f(0.12, 0.07, 0.025);
  } else if (m == 4u || m == 5u || m == 20u || m == 21u) {
    // the giants: hydrogen above their clouds (the drawn ground) — a thin haze, bluish on Uranus and
    // Neptune, yellowish on Jupiter and Saturn
    a.rm = select(select(select(2.4622e7, 2.5362e7, m == 20u), 5.8232e7, m == 5u), 6.9911e7, m == 4u);
    a.hr = select(27000.0, 50000.0, m == 5u || m == 20u);
    a.top = 12.0 * a.hr; a.hm = a.hr * 0.7;
    a.br = vec3f(5.802e-6, 13.558e-6, 33.1e-6) * select(0.06, 0.3, m >= 20u); a.bo = vec3f(0.0);
    a.bms = 1.5e-6 * select(vec3f(1.0, 0.95, 0.82), vec3f(0.8, 0.95, 1.0), m >= 20u);
    a.bme = 1.5e-6; a.g = vec3f(0.6); a.k = 1.0;
    a.sky = vec3f(0.0);
  } else if (m == 22u) {
    // Pluto: a tenuous nitrogen air and its blue haze layers
    a.rm = 1.1883e6; a.top = 250e3; a.hr = 50000.0; a.hm = 40000.0;
    a.br = vec3f(0.0); a.bo = vec3f(0.0);
    a.bms = 3.0e-7 * vec3f(0.45, 0.75, 1.3); a.bme = 3.0e-7; a.g = vec3f(0.55); a.k = 1.0;
    a.sky = vec3f(0.0);
  }
  AIR = a;
}
fn airK() -> f32 { return AIR.k; }
fn airTop() -> f32 { return 1.0 + AIR.top * AIR.k / AIR.rm; }
fn airHR() -> f32 { return AIR.hr * AIR.k; }
fn airHM() -> f32 { return AIR.hm * AIR.k; }
// Henyey–Greenstein (Cornette–Shanks) per colour
fn phaseM(g: vec3f, mu: f32) -> vec3f {
  let g2 = g * g;
  return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, vec3f(1.5)));
}

fn earthOn() -> bool { return P.earth.x > 0.5; }
fn isEarth(k: u32) -> bool { return earthOn() && bodyKind(k) != 0u && u32(bodies[BV * k + 2u].z) == EARTH_SURF; }
// its axes → the cube map's direction
fn eCube(q: vec3f) -> vec3f { return vec3f(q.y, q.z, q.x); }

// Chapman's grazing incidence function (Schüler's approximation): the air's column along a ray from
// x (the distance from the centre, in scale heights) upwards at the zenith angle's cosine mu, over
// the vertical one
fn chUp(x: f32, mu: f32) -> f32 {
  let c = sqrt(1.5707963 * x);
  return c / ((c - 1.0) * mu + 1.0);
}
// the air's column [m of air at sea level] along a ray from a height h [m] towards mu, for a scale
// height H: through the ground (mu below its horizon), the column to the shadow — huge
fn airColumn(h: f32, mu: f32, H: f32) -> f32 {
  let X = AIR.rm / H;
  let x = X + h / H;
  if (mu >= 0.0) { return chUp(x, mu) * exp(-h / H) * H; }
  let x0 = x * sqrt(max(1.0 - mu * mu, 0.0));
  return (2.0 * chUp(x0, 0.0) * exp(min(X - x0, 60.0)) - chUp(x, -mu) * exp(-h / H)) * H;
}
// the sunlight's transmission down to a height h [m], the sun at mu from the zenith
fn sunThrough(h: f32, mu: f32) -> vec3f {
  return exp(-((AIR.br + AIR.bo) * airColumn(h, mu, airHR()) + vec3f(AIR.bme * airColumn(h, mu, airHM()))) / airK());
}

// The eclipses: the share of the Sun's disk the Moon leaves uncovered, seen from p (the Earth's axes, its
// radii; the Sun along Ls) — two disks' overlap (angles by their sines: f32 keeps them to 0.1″); the Sun's
// disk uniform (its limb's darkening left out). 1: none.
fn sunSeen(p: vec3f, Ls: vec3f) -> f32 {
  if (P.eclipse.w <= 0.0) { return 1.0; }
  let m = P.eclipse.xyz - p;
  let dm = length(m);
  let u = m / dm;
  if (dot(u, Ls) < 0.995) { return 1.0; }
  let d = asin(min(length(cross(u, Ls)), 1.0));
  let rs = P.earth4.y;
  let rm = asin(min(P.eclipse.w / dm, 1.0));
  if (d >= rs + rm) { return 1.0; }
  var a: f32;
  if (d <= abs(rm - rs)) {
    a = PI * min(rs, rm) * min(rs, rm);
  } else {
    let k1 = clamp((d * d + rs * rs - rm * rm) / (2.0 * d * rs), -1.0, 1.0);
    let k2 = clamp((d * d + rm * rm - rs * rs) / (2.0 * d * rm), -1.0, 1.0);
    let k3 = max((-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm), 0.0);
    a = rs * rs * acos(k1) + rm * rm * acos(k2) - 0.5 * sqrt(k3);
  }
  return clamp(1.0 - a / (PI * rs * rs), 0.0, 1.0);
}
// The sky's own light at p under an eclipse: the sunlit air around it — the Sun's share seen from p and
// from four places 200 km about it (across the shadow), averaged: at the umbra's heart a thousandth or so
// (the totality's deep blue, the horizon's glow beyond), the day's in the penumbra's outer parts.
fn skySeen(p: vec3f, Ls: vec3f) -> f32 {
  if (P.eclipse.w <= 0.0) { return 1.0; }
  let s0 = sunSeen(p, Ls);
  if (s0 >= 1.0) { return 1.0; }
  let e1 = normalize(cross(Ls, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(Ls.z) > 0.9)));
  let e2 = cross(Ls, e1);
  let L = 200000.0 / EARTH_RM;
  let avg = 0.2 * (s0 + sunSeen(p + e1 * L, Ls) + sunSeen(p - e1 * L, Ls) + sunSeen(p + e2 * L, Ls) + sunSeen(p - e2 * L, Ls));
  // (squared: that light scatters twice, from farther the deeper the shadow — the sky of totality a
  // thousandth of the day's, the inner corona hundreds of times brighter than it)
  return mix(0.0004, 1.0, avg * avg);
}

// The air along ro + t rd, t in [0, tEnd): what it lets through (T), and the sunlight it scatters
// towards ro (L; the sun along Ls, its irradiance E); up to tSplit too (Tc, Lc: a cloud there, seen
// through the air before it only). jit: the samples' offset (0…1).
struct EarthAir { T: vec3f, L: vec3f, Lm: vec3f, Tc: vec3f, Lc: vec3f };
fn earthAir(ro: vec3f, rd: vec3f, tEnd: f32, Ls: vec3f, E: vec3f, jit: f32, tSplit: f32) -> EarthAir {
  var o: EarthAir;
  o.T = vec3f(1.0);
  o.L = vec3f(0.0);
  o.Tc = vec3f(1.0);
  let b = dot(ro, rd);
  let off = ro - rd * b;
  let h2 = airTop() * airTop() - dot(off, off);
  if (h2 <= 0.0) { return o; }
  let sq = sqrt(h2);
  let ta = max(-b - sq, 0.0);
  let tb = min(-b + sq, tEnd);
  if (tb <= ta) { return o; }
  let mu = dot(rd, Ls);
  let pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  let pM = phaseM(AIR.g, mu);
  // the Moon's light scattered too, where the sun is down (the moonlit sky's blue): its phase functions,
  // its irradiance over the sun's — a third of what lights the ground (EARTH_MOON): the moonlit sky a deep
  // blue, not a day's (Lm: its share — the stars' veil leaves it out: they stay, drawn, under the Moon)
  let Lm = P.earth3.xyz;
  let mm = dot(rd, Lm);
  let pRm = 3.0 / (16.0 * PI) * (1.0 + mm * mm);
  let pMm = phaseM(AIR.g, mm);
  let moonE = 0.3 * EARTH_MOON * pow(max(P.earth3.w, 0.0), 1.5);
  // (from inside the air, samples crowded near the camera: the densest air is there)
  let inside = dot(ro, ro) < airTop() * airTop();
  let N = 32u;
  var tau = vec3f(0.0);
  var tPrev = ta;
  var split = tSplit <= ta;
  var tauC = vec3f(0.0);
  var LcS = vec3f(0.0);
  var LcM = vec3f(0.0);
  for (var i = 0u; i < N; i++) {
    let u1 = (f32(i) + 1.0) / f32(N);
    let t1 = ta + (tb - ta) * select(u1, u1 * u1, inside);
    let ds = (t1 - tPrev) * AIR.rm;
    let t = mix(tPrev, t1, jit);
    tPrev = t1;
    let p = ro + rd * t;
    let r = length(p);
    let h = (r - 1.0) * AIR.rm;
    let dR = exp(-h / airHR()) / airK();
    let dM = exp(-h / airHM()) / airK();
    let ext = (AIR.br + AIR.bo) * dR + vec3f(AIR.bme * dM);
    let Ts = sunThrough(h, dot(p, Ls) / r);
    // (multiple scattering, roughly: the light the sunlit sky itself sheds, isotropic — as much again as
    // the molecules' single scattering, a third of the aerosols'; under an eclipse the single scattering
    // needs the Sun seen from there, the multiple the sunlit air around: the totality's sky a deep blue)
    let s1 = sunSeen(p, Ls);
    let sM = select(max(s1, skySeen(p, Ls)), 1.0, s1 >= 1.0);
    let sc = AIR.br * dR * (pR * s1 + 0.8 / (4.0 * PI) * sM) + AIR.bms * dM * (pM * s1 + 0.3 / (4.0 * PI) * sM);
    let Tv = exp(-(tau + 0.5 * ext * ds)) * ds;
    o.L += sc * Ts * Tv;
    let mz = dot(p, Lm) / r;
    let nightS = 1.0 - smoothstep(-0.12, 0.06, dot(p, Ls) / r);
    if (nightS > 0.0 && mz > -0.1 && P.earth3.w > 0.0 && AIR.moon > 0.5) {
      let scm = AIR.br * dR * (pRm + 0.8 / (4.0 * PI)) + AIR.bms * dM * (pMm + 0.3 / (4.0 * PI));
      o.Lm += scm * sunThrough(h, mz) * moonE * nightS * Tv;
    }
    tau += ext * ds;
    if (!split && t1 >= tSplit) {
      split = true;
      tauC = tau;
      LcS = o.L;
      LcM = o.Lm;
    }
  }
  if (!split) {
    tauC = tau;
    LcS = o.L;
    LcM = o.Lm;
  }
  o.Lm *= E;
  o.L = o.L * E + o.Lm;
  o.T = exp(-tau);
  o.Tc = exp(-tauC);
  o.Lc = (LcS + LcM) * E;
  return o;
}

// A map lookup's footprint: the pixel's axes gx, gy (unit, ⟂ the ray) at a distance giving fp (its
// radii), laid on the sphere at q along rd
fn earthFoot(q: vec3f, rd: vec3f, g: vec3f, fp: f32) -> vec3f {
  let dn = dot(rd, q);
  let s = select(-0.03, dn, dn < -0.03);
  return (g - rd * (dot(g, q) / s)) * fp;
}

// The equirectangular relief map at q (its footprint's axes fx, fy): the slopes over the footprint
// (−∂h/∂east, −∂h/∂south, as 0.5 + 0.5·slope: central differences of the heights at its mip level), the
// oceans, the height [m]
fn earthRelief(q: vec3f, fx: vec3f, fy: vec3f) -> vec4f {
  let lon = atan2(q.y, q.x);
  let lat = asin(clamp(q.z, -1.0, 1.0));
  let uv = vec2f(0.5 + lon / TAU, 0.5 - lat / PI);
  let rxy2 = max(q.x * q.x + q.y * q.y, 1e-8);
  let rxy = sqrt(rxy2);
  let dx = vec2f((q.x * fx.y - q.y * fx.x) / (rxy2 * TAU), -fx.z / (rxy * PI));
  let dy = vec2f((q.x * fy.y - q.y * fy.x) / (rxy2 * TAU), -fy.z / (rxy * PI));
  let dim = vec2f(textureDimensions(earthElev));
  let lod = max(log2(max(length(dx * dim), length(dy * dim))), 0.0);
  let c = textureSampleLevel(earthElev, bgSamp, uv, lod);
  let e = exp2(floor(lod)) / dim; // (a texel of that level)
  let hE = textureSampleLevel(earthElev, bgSamp, uv + vec2f(e.x, 0.0), lod).r - textureSampleLevel(earthElev, bgSamp, uv - vec2f(e.x, 0.0), lod).r;
  let hS = textureSampleLevel(earthElev, bgSamp, uv + vec2f(0.0, e.y), lod).r - textureSampleLevel(earthElev, bgSamp, uv - vec2f(0.0, e.y), lod).r;
  let dxM = 2.0 * e.x * TAU * EARTH_RM * max(rxy, 1e-3);
  let dyM = 2.0 * e.y * PI * EARTH_RM;
  let sl = clamp(vec2f(-hE / dxM, -hS / dyM), vec2f(-1.0), vec2f(1.0));
  return vec4f(0.5 + 0.5 * sl, c.g, c.r);
}

// ---- the Earth's relief (the same function in src/terrain.ts: earthDetail, earthHeightSampler — the
// ship stands on it): its height map (earthElev: NOAA's ETOPO 2022, metres), ridges on its mountains
// and hills on its land finer than the map; heights [m] at a unit direction on its axes, resolved to a
// footprint foot [m]
// Musgrave's ridged multifractal: sharp crests and smooth valleys between them, each octave's ridges
// weighted by the one above (crests grow on crests, the valleys stay smooth) — mountains, not cones;
// 0 … ~1. oct: the octaves the footprint resolves, fractional — the last one faded in (no seam where
// the distance adds one)
fn ridgedMF(p0: vec3f, oct: f32) -> f32 {
  var p = p0;
  var sig = 1.0 - abs(gnoise(p));
  sig *= sig;
  var sum = sig;
  var amp = 1.0;
  var norm = 1.0;
  for (var i = 1; f32(i) < oct; i++) {
    p = p * 2.03 + vec3f(1.7, 9.2, 3.1);
    let w = clamp(sig * 1.8, 0.0, 1.0);
    amp *= 0.5;
    let fade = clamp(oct - f32(i), 0.0, 1.0);
    sig = 1.0 - abs(gnoise(p));
    sig = sig * sig * w;
    sum += sig * amp * fade;
    norm += amp * fade;
  }
  return sum / norm;
}
// fractal noise with a fractional number of octaves (the last faded in); 0 for none
fn tfbmF(p0: vec3f, oct: f32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  var n = 0.0;
  for (var i = 0; f32(i) < oct; i++) {
    let fade = clamp(oct - f32(i), 0.0, 1.0);
    s += a * fade * gnoise(p);
    n += a * fade;
    p = p * 2.03 + vec3f(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / max(n, 1e-6);
}
// the octaves of a layer of base frequency f resolved at a footprint, fractional
fn layerOctF(f: f32, foot: f32, mR: f32, most: f32) -> f32 {
  return clamp(log2(mR / (f * 4.0 * max(foot, 0.05))), 0.0, most);
}
// (the same two, each octave weighed by what the heights already hold: an octave of wavelength λ [m] —
// lam0 the first's, halved by 2.03 each — drawn where the heights' resolution res is coarser than it, faded
// out where they resolve it (λ > 3 res); centred: ridgedMF − 0.3, tfbmF)
fn octaveKept(lam: f32, res: f32) -> f32 { return 1.0 - smoothstep(res, 3.0 * res, lam); }
// the first octave kept (λ < 3 res) of a ladder from lam0 halved by 2.03: the ones before it not computed
fn firstKept(lam0: f32, res: f32) -> i32 { return max(i32(floor(log2(lam0 / (3.0 * res)) / 1.0215)) + 1, 0); }
fn ridgedMFw(p0: vec3f, oct: f32, lam0: f32, res: f32) -> f32 {
  let i0 = firstKept(lam0, res);
  var p = p0;
  var lam = lam0;
  var amp = 1.0;
  var norm = 1.0;
  // (the octaves the heights hold skipped: their lattice and weights carried, no noise; the first kept
  // one unweighted by those above)
  for (var i = 1; i <= i0; i++) {
    p = p * 2.03 + vec3f(1.7, 9.2, 3.1);
    lam /= 2.03;
    amp *= 0.5;
    norm += amp * clamp(oct - f32(i), 0.0, 1.0);
  }
  if (f32(i0) >= oct) { return 0.0; }
  var sig = 1.0 - abs(gnoise(p));
  sig *= sig;
  // (the first octave whole, as ridgedMF has it; a later one faded in with the footprint)
  var sum = (sig - 0.3) * amp * select(clamp(oct - f32(i0), 0.0, 1.0), 1.0, i0 == 0) * octaveKept(lam, res);
  for (var i = i0 + 1; f32(i) < oct; i++) {
    p = p * 2.03 + vec3f(1.7, 9.2, 3.1);
    lam /= 2.03;
    let w = clamp(sig * 1.8, 0.0, 1.0);
    amp *= 0.5;
    let fade = clamp(oct - f32(i), 0.0, 1.0);
    sig = 1.0 - abs(gnoise(p));
    sig = sig * sig * w;
    sum += (sig - 0.3) * amp * fade * octaveKept(lam, res);
    norm += amp * fade;
  }
  return sum / norm;
}
fn tfbmFw(p0: vec3f, oct: f32, lam0: f32, res: f32) -> f32 {
  let i0 = firstKept(lam0, res);
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  var n = 0.0;
  var lam = lam0;
  for (var i = 0; f32(i) < oct; i++) {
    let fade = clamp(oct - f32(i), 0.0, 1.0);
    if (i >= i0) { s += a * fade * gnoise(p) * octaveKept(lam, res); }
    n += a * fade;
    p = p * 2.03 + vec3f(1.7, 9.2, 3.1);
    a *= 0.5;
    lam /= 2.03;
  }
  return s / max(n, 1e-6);
}
fn earthDetail(q: vec3f, h0: f32, foot: f32, res: f32) -> f32 {
  let mount = smoothstep(300.0, 2500.0, h0);
  let land = smoothstep(0.0, 40.0, h0);
  var h = 0.0;
  // (where the heights are known finer — the terrain tiles: res, their resolution [m] — the octaves they
  // hold fade out: the real ground, the noise only below it)
  // the mountains: a ridged multifractal (ridges ~4 km apart down to ~100 m), its lattice warped by a
  // smooth field (no regular rows of peaks)
  let o1 = layerOctF(1500.0, foot, EARTH_RM, 7.0);
  if (o1 > f32(firstKept(EARTH_RM / 1500.0, res)) && mount > 0.0) {
    let pw = q * 1500.0 + vec3f(11.0) + 0.7 * vec3f(tfbm(q * 600.0 + vec3f(3.1), 2), tfbm(q * 600.0 + vec3f(7.7), 2), tfbm(q * 600.0 + vec3f(1.3), 2));
    h += ridgedMFw(pw, o1, EARTH_RM / 1500.0, res) * 1500.0 * mount;
  }
  // the plains' hills, the rocks
  let o2 = layerOctF(20000.0, foot, EARTH_RM, 3.0);
  if (o2 > 0.0 && land > 0.0) { h += tfbmFw(q * 20000.0 + vec3f(5.0), o2, EARTH_RM / 20000.0, res) * min(o2, 1.0) * 50.0 * land * (1.0 - mount); }
  let o3 = layerOctF(200000.0, foot, EARTH_RM, 3.0);
  if (o3 > 0.0 && land > 0.0) { h += tfbmF(q * 200000.0 + vec3f(3.0), o3) * min(o3, 1.0) * (3.0 + 8.0 * mount) * land; }
  return h;
}
// ---- the runways (src/game/sites.ts: runwayWeight — the same figures, the ground graded alike for the
// gear and for the eye)
const RWY_MAX = 4u;
fn rwyCount() -> u32 { return select(0u, min(u32(P.runways[0].x), RWY_MAX), HAS_RWY); }
// How much of a runway's graded strip a geodetic direction is on (0…1): from 3 km before its threshold to
// 4.5 km past it, 60 m either side — faded over 300 m along, 60 m across. There the drawn detail is off.
fn runwayGrade(g: vec3f) -> f32 {
  var w = 0.0;
  for (var k = 0u; k < rwyCount(); k++) {
    let d = g - P.runways[1u + 4u * k].xyz;
    if (dot(d, d) > 1e-6) { continue; }
    let a = dot(d, P.runways[2u + 4u * k].xyz) * 6371e3;
    let c = abs(dot(d, P.runways[3u + 4u * k].xyz)) * 6371e3;
    let wa = select(select(1.0, max(0.0, 1.0 - (a - 4500.0) / 300.0), a > 4500.0), max(0.0, 1.0 + (a + 3000.0) / 300.0), a < -3000.0);
    let wc = select(max(0.0, 1.0 - (c - 60.0) / 60.0), 1.0, c < 60.0);
    w = max(w, wa * wc);
  }
  return w;
}
// the share of a pixel of footprint fw [m] a band lo…hi along x covers (the band thinner than the pixel:
// its share of it)
fn bandCover(x: f32, lo: f32, hi: f32, fw: f32) -> f32 {
  return clamp((min(x - lo, hi - x) + 0.5 * fw) / fw, 0.0, min(1.0, (hi - lo) / fw));
}
// a periodic band (from 0 each period, w wide): the duty cycle once the pixel spans the period
fn stripeCover(x: f32, period: f32, w: f32, fw: f32) -> f32 {
  let u = x - period * floor(x / period);
  let c = max(bandCover(u, 0.0, w, fw), bandCover(u, period, period + w, fw));
  return mix(c, w / period, smoothstep(0.3 * period, period, fw));
}
// A point light's share of a pixel of footprint fw [m], d [m] from it: its flux spread over the pixel
// (a 0.4 m lamp), so it stays one bright dot from afar
fn lampAt(d: f32, fw: f32) -> f32 {
  let sg = max(0.5 * fw, 0.4);
  return exp(-0.5 * d * d / (sg * sg)) * (0.16 / (sg * sg));
}
struct RunwayLook { cover: f32, albedo: vec3f, lamps: vec3f };
// The runway under a point at (a, c) [m] of its frame — along from the threshold, across to the right —
// for a pixel of footprint fw [m], seen at an elevation el [rad] (the PAPI's): the paved strip, its
// shoulders and markings (ICAO: threshold bars, centreline, edges, touchdown zone, aiming point), its
// lights — edges white every 60 m, the threshold green, the end red — and the PAPI, set for the
// autopilot's inner glide (1.5° to the touchdown 450 m in: two white, two red on it)
fn runwayShade(a: f32, c: f32, L: f32, hw: f32, fw: f32, el: f32) -> RunwayLook {
  var o: RunwayLook;
  let ac = abs(c);
  let paved = bandCover(a, -60.0, L + 60.0, fw) * bandCover(ac, -1.0, hw + 7.5, fw);
  o.cover = paved;
  var alb = mix(vec3f(0.17, 0.165, 0.155), vec3f(0.075, 0.075, 0.08), bandCover(ac, -1.0, hw, fw));
  // (the touchdown zone's rubber: darker in the middle)
  alb *= 1.0 - 0.35 * bandCover(a, 250.0, 1100.0, fw) * bandCover(ac, -1.0, 12.0, fw);
  var m = 0.0;
  // threshold bars: 30 m long, 1.8 m wide, 1.8 m apart, either side of a 3.6 m gap (and at the far end)
  let bars = stripeCover(ac - 1.8, 3.6, 1.8, fw) * bandCover(ac, 1.8, hw - 3.0, fw);
  m = max(m, bars * max(bandCover(a, 6.0, 36.0, fw), bandCover(a, L - 36.0, L - 6.0, fw)));
  // centreline: 36 m dashes, 24 m gaps, 0.9 m wide
  m = max(m, stripeCover(a - 80.0, 60.0, 36.0, fw) * bandCover(c, -0.45, 0.45, fw) * bandCover(a, 80.0, L - 80.0, fw));
  // edges: 0.9 m lines
  m = max(m, bandCover(ac, hw - 1.4, hw - 0.5, fw) * bandCover(a, 0.0, L, fw));
  // aiming point: two 45 m × 9 m blocks 300 m in; touchdown zone: pairs of 22.5 m bars every 150 m
  m = max(m, bandCover(a, 300.0, 345.0, fw) * bandCover(ac, 6.0, 15.0, fw));
  let tz = stripeCover(a - 150.0, 150.0, 22.5, fw) * bandCover(a, 150.0, 922.5, fw) * (1.0 - bandCover(a, 280.0, 360.0, fw));
  m = max(m, tz * stripeCover(ac - 4.5, 3.0, 1.8, fw) * bandCover(ac, 4.5, 12.6, fw));
  o.albedo = mix(alb, vec3f(0.72, 0.72, 0.7), m * paved);
  // the lights: edges, threshold, end; the PAPI 20 m left of the edge, 450 m in
  var lmp = vec3f(0.0);
  let ke = round(a / 60.0);
  if (ke >= 0.0 && ke * 60.0 <= L) { lmp += vec3f(1.0, 0.95, 0.85) * lampAt(length(vec2f(a - 60.0 * ke, ac - hw - 1.5)), fw); }
  let kc = clamp(round(c / 3.0), -floor(hw / 3.0), floor(hw / 3.0));
  lmp += vec3f(0.2, 1.0, 0.4) * lampAt(length(vec2f(a + 3.0, c - 3.0 * kc)), fw);
  lmp += vec3f(1.0, 0.12, 0.08) * lampAt(length(vec2f(a - L - 3.0, c - 3.0 * kc)), fw);
  let elDeg = el * 57.29578;
  for (var i = 0u; i < 4u; i++) {
    // (from the runway outwards: white above 2.0°, 1.67°, 1.33°, 1.0°)
    let th = 2.0 - 0.3333 * f32(i);
    let col = select(vec3f(1.0, 0.1, 0.06), vec3f(1.0, 0.97, 0.92), elDeg > th);
    lmp += 2.5 * col * lampAt(length(vec2f(a - 450.0, c + hw + 20.0 + 9.0 * f32(i))), fw);
  }
  o.lamps = lmp;
  return o;
}
// (the hit point from the camera [m, the Earth's squashed axes] — set by earthNear for its ground, w: on)
var<private> RWY_HIT: vec4f = vec4f(0.0);

fn earthUV(q: vec3f) -> vec2f {
  return vec2f(0.5 + atan2(q.y, q.x) / TAU, 0.5 - asin(clamp(q.z, -1.0, 1.0)) / PI);
}
// cubic B-spline weights (texels −1 … +2): the map smooth — no facets between its texels
fn bspline4(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4f(1.0 - 3.0 * t + 3.0 * t2 - t3, 4.0 - 6.0 * t2 + 3.0 * t3, 1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3, t3) / 6.0;
}
// the map's height: near, a cubic B-spline over its texels; from afar, its mip level from the footprint
fn earthH0(q: vec3f, foot: f32) -> f32 {
  let dim = vec2i(textureDimensions(earthElev));
  let texelM = EARTH_RM * TAU / f32(dim.x);
  let lod = log2(max(foot, 1.0) / texelM);
  let uv = earthUV(q);
  if (lod > 0.5) { return textureSampleLevel(earthElev, bgSamp, uv, lod).r; }
  let x = uv.x * f32(dim.x) - 0.5;
  let y = uv.y * f32(dim.y) - 0.5;
  let x0 = floor(x);
  let y0 = floor(y);
  let wx = bspline4(x - x0);
  let wy = bspline4(y - y0);
  var s = 0.0;
  for (var j = 0; j < 4; j++) {
    let yy = clamp(i32(y0) + j - 1, 0, dim.y - 1);
    var row = 0.0;
    for (var i = 0; i < 4; i++) {
      let xx = ((i32(x0) + i - 1) % dim.x + dim.x) % dim.x;
      row += wx[i] * textureLoad(earthElev, vec2i(xx, yy), 0).r;
    }
    s += wy[j] * row;
  }
  return s;
}
// ---- the terrain tiles (src/system/earth-tiles.ts: the same weights on the CPU, heightAt)
const TILE_Z0 = 6u;
const TILE_LEVELS = 8u;
const TILE_RES_MIN = 25.0;
// a level's texel at i (from its valid rectangle's corner), in its layer (toroidal: modulo 1024)
fn tileTexel(l: u32, i: vec2i) -> f32 {
  let t = (vec2i(P.tileL[2u * l].zw) + i) & vec2i(1023);
  return bitcast<f32>(textureLoad(earthTiles, t, l, 0).r);
}
fn tileImage(l: u32, i: vec2i) -> u32 {
  let t = (vec2i(P.tileL[2u * l].zw) + i) & vec2i(1023);
  return textureLoad(earthTiles, t, l, 0).g;
}
const TILE_IMG_LEVELS = 3u; // (z 6 … 8: src/system/earth-tiles.ts, IMG_Z1)
// The tiles' imagery at q for a footprint foot [m] (src/system/earth-tiles.ts: GIBS): the finest level
// within the footprint and the next coarser, blended by the footprint and towards their windows' edges
// (as earthH); rgb the day's colour (linear), a the night's lights; w its weight — the global maps' the rest
// (none beyond the windows, nor where a tile's imagery did not come)
struct TileImage { c: vec4f, w: f32 };
fn earthImagery(q: vec3f, foot: f32) -> TileImage {
  var o: TileImage;
  o.c = vec4f(0.0);
  o.w = 0.0;
  if (P.tiles.w < 0.5) { return o; }
  let cosLat = sqrt(max(1.0 - q.z * q.z, 1e-12));
  let dlon = atan2(-q.x * P.tiles.y + q.y * P.tiles.x, q.x * P.tiles.x + q.y * P.tiles.y);
  let sz = clamp(q.z, -0.999999, 0.999999);
  let dM = atanh((sz - P.tiles.z) / (1.0 - sz * P.tiles.z));
  let zf = log2(EARTH_RM * TAU * cosLat / (256.0 * max(foot, 0.5)));
  var rem = 1.0;
  for (var li = 0; li < i32(TILE_IMG_LEVELS); li++) {
    let l = TILE_IMG_LEVELS - 1u - u32(li);
    let a = P.tileL[2u * l];
    let b = P.tileL[2u * l + 1u];
    if (b.w < 0.5) { continue; }
    let wz = clamp(zf - f32(TILE_Z0 + l) + 1.0, 0.0, 1.0);
    if (wz <= 0.0) { continue; }
    let p = a.xy + vec2f(dlon, -dM) * b.z;
    let d = min(min(p.x, p.y), min(b.x - p.x, b.y - p.y));
    var w = wz * smoothstep(2.0, 48.0, d);
    if (w <= 0.0) { continue; }
    // (bilinear over its texels, the day's colour in linear light; a texel without imagery: none here)
    let x = p - 0.5;
    let i0 = vec2i(floor(x));
    let f = x - floor(x);
    let t00 = tileImage(l, i0);
    let t10 = tileImage(l, i0 + vec2i(1, 0));
    let t01 = tileImage(l, i0 + vec2i(0, 1));
    let t11 = tileImage(l, i0 + vec2i(1, 1));
    if (min(min(t00, t10), min(t01, t11)) == 0u) { continue; }
    let c = mix(mix(unpack4x8unorm(t00), unpack4x8unorm(t10), f.x), mix(unpack4x8unorm(t01), unpack4x8unorm(t11), f.x), f.y);
    // (the sRGB curve, as the maps' -srgb views decode them: the two meet without a seam)
    let lin = select(pow((c.rgb + 0.055) / 1.055, vec3f(2.4)), c.rgb / 12.92, c.rgb <= vec3f(0.04045));
    o.c += rem * w * vec4f(lin, c.a);
    o.w += rem * w;
    rem *= 1.0 - w;
    if (rem < 1e-4) { break; }
  }
  if (o.w > 0.0) { o.c /= o.w; }
  return o;
}
// a level's height at p [its px from the corner]: bilinear, or — its texel more than twice the footprint
// (mag: by how many octaves larger) — a cubic B-spline over its texels (no facets near), the two blended
// over an octave
fn tileSample(l: u32, p: vec2f, mag: f32) -> f32 {
  let x = p - 0.5;
  let i0 = vec2i(floor(x));
  let f = x - floor(x);
  let k = clamp(mag - 1.0, 0.0, 1.0);
  var lin = 0.0;
  if (k < 1.0) {
    lin = mix(mix(tileTexel(l, i0), tileTexel(l, i0 + vec2i(1, 0)), f.x), mix(tileTexel(l, i0 + vec2i(0, 1)), tileTexel(l, i0 + vec2i(1, 1)), f.x), f.y);
  }
  if (k <= 0.0) { return lin; }
  let wx = bspline4(f.x);
  let wy = bspline4(f.y);
  var b = 0.0;
  for (var j = 0; j < 4; j++) {
    var row = 0.0;
    for (var i = 0; i < 4; i++) { row += wx[i] * tileTexel(l, i0 + vec2i(i - 1, j - 1)); }
    b += wy[j] * row;
  }
  return mix(lin, b, k);
}
// The ground's height under the map's finer detail at q for a footprint foot [m]: the tiles' levels — the
// finest within the footprint and the next coarser, blended by the footprint and towards their windows'
// edges — over the global map where they leave off; y: the heights' resolution [m] (earthDetail). cheap:
// bilinear only (the shadows' march)
fn earthH(q: vec3f, foot: f32, cheap: bool) -> vec2f {
  let texelA = EARTH_RM * TAU / f32(textureDimensions(earthElev).x);
  if (P.tiles.w < 0.5) { return vec2f(earthH0(q, foot), texelA); }
  let cosLat = sqrt(max(1.0 - q.z * q.z, 1e-12));
  // (from the reference — the camera's place —: the longitude by a turned atan2, Mercator's y by
  // atanh(a) − atanh(b) = atanh((a − b)/(1 − ab)): no float32 cancellation near the camera)
  let dlon = atan2(-q.x * P.tiles.y + q.y * P.tiles.x, q.x * P.tiles.x + q.y * P.tiles.y);
  let sz = clamp(q.z, -0.999999, 0.999999);
  let dM = atanh((sz - P.tiles.z) / (1.0 - sz * P.tiles.z));
  let zf = log2(EARTH_RM * TAU * cosLat / (256.0 * max(foot, 0.5)));
  var h = 0.0;
  var res = 0.0;
  var rem = 1.0;
  for (var li = 0; li < i32(TILE_LEVELS); li++) {
    let l = TILE_LEVELS - 1u - u32(li);
    let a = P.tileL[2u * l];
    let b = P.tileL[2u * l + 1u];
    if (b.w < 0.5) { continue; }
    let z = f32(TILE_Z0 + l);
    let wz = clamp(zf - z + 1.0, 0.0, 1.0);
    if (wz <= 0.0) { continue; }
    let p = a.xy + vec2f(dlon, -dM) * b.z;
    let d = min(min(p.x, p.y), min(b.x - p.x, b.y - p.y));
    let w = wz * smoothstep(2.0, 48.0, d);
    if (w <= 0.0) { continue; }
    h += rem * w * tileSample(l, p, select(zf - z, 0.0, cheap));
    res += rem * w * max(EARTH_RM * cosLat / b.z, TILE_RES_MIN);
    rem *= 1.0 - w;
    if (rem < 1e-4) { break; }
  }
  if (rem >= 1e-4) {
    h += rem * earthH0(q, foot);
    res += rem * texelA;
  }
  return vec2f(h, res);
}
fn earthHeightG(q: vec3f, foot: f32) -> f32 {
  let hr = earthH(q, foot, false);
  // (a runway's strip graded: its detail off — the gear's ground the same)
  var flat = 0.0;
  if (HAS_RWY) { flat = runwayGrade(q); }
  if (flat >= 1.0) { return max(hr.x, 0.0); }
  return max(hr.x + (1.0 - flat) * earthDetail(q, hr.x, foot, hr.y), 0.0);
}
// The ground's height at a unit direction q of the squashed space, as a radial height there [m of a]: the
// relief read at its geodetic direction (src/terrain.ts: earthHeightSampler, the same), over the scale
// (src/system/our-surface.ts: the gear's ground)
fn earthHeight(q: vec3f, foot: f32) -> f32 { return earthHeightG(geoQ(q), foot) / earthSq(q); }
// the same, cheaply, for the march's steps: the map filtered by the hardware, the detail coarser (a
// dispatch that takes seconds loses the GPU) — the crossing then refined on earthHeight
fn earthHeightStep(q: vec3f, foot: f32) -> f32 { return earthHeightStepG(geoQ(q), foot) / earthSq(q); }
fn earthHeightStepG(q: vec3f, foot: f32) -> f32 {
  var flat = 0.0;
  if (HAS_RWY) { flat = runwayGrade(q); }
  if (P.tiles.w > 0.5) {
    let hr = earthH(q, foot, true);
    return max(hr.x + (1.0 - flat) * earthDetail(q, hr.x, max(foot * 4.0, 1.0), hr.y), 0.0);
  }
  let texelM = EARTH_RM * TAU / f32(textureDimensions(earthElev).x);
  let h0 = textureSampleLevel(earthElev, bgSamp, earthUV(q), max(log2(max(foot, 1.0) / texelM), 0.0)).r;
  return max(h0 + (1.0 - flat) * earthDetail(q, h0, max(foot * 4.0, 1.0), texelM), 0.0);
}
// the relief's own normal at q, no finer than the footprint
fn earthNormalAt(q: vec3f, foot: f32) -> vec3f {
  // (no finer than 10 m: a float32 point of the unit sphere is good to ~0.4 m — finer differences would
  // show its steps, a grid)
  let e = max(foot, 10.0) / EARTH_RM;
  let t1 = normalize(cross(q, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(q.z) > 0.9)));
  let t2 = cross(q, t1);
  // (three heights, one call: every call site is a copy the compiler builds)
  var hs = array<f32, 3>(0.0, 0.0, 0.0);
  for (var i = 0; i < 3; i++) {
    let qi = select(select(q, normalize(q + t1 * e), i == 1), normalize(q + t2 * e), i == 2);
    hs[i] = earthHeight(qi, foot);
  }
  return normalize(q - ((hs[1] - hs[0]) * t1 + (hs[2] - hs[0]) * t2) / (e * EARTH_RM));
}

// The relief's shadow at a ground point p (its axes, radii) towards the sun Ls: marched up to ~50 km,
// steps growing by a sixth (by a third, a grazing Sun's ray stepped over the crests between them: lit lines
// across the shade), softened by how close the ray passes over the ground (a penumbra); foot [m]
fn earthTerrainShadow(p: vec3f, Ls: vec3f, foot: f32) -> f32 {
  let p0 = p * (1.0 + 2.0 / EARTH_RM);
  // (the march's heights are coarser than the ground drawn: measured from their own ground here — else
  // where they stand a metre above it the point is inside its own relief, black patches under a high sun)
  let rp = length(p);
  let bias = earthHeightStep(p / rp, foot) - (rp - 1.0) * EARTH_RM;
  var t = max(foot, 20.0);
  var sh = 1.0;
  for (var i = 0; i < 48; i++) {
    let x = p0 + Ls * (t / EARTH_RM);
    let r = length(x);
    let hr = (r - 1.0) * EARTH_RM;
    if (hr > 9600.0) { break; }
    // (+0.5 % of the distance: the march's heights, from coarser levels farther, a few metres off the
    // ground drawn)
    let d = hr - earthHeightStep(x / r, max(0.05 * t, foot)) + bias + 0.005 * t;
    sh = min(sh, clamp(d / (0.04 * t) + 0.5, 0.0, 1.0));
    if (sh <= 0.0) { break; }
    t *= 1.18;
  }
  return sh;
}

// The ray (its axes, radii) against the relief: marched from the relief's bounding shell, steps a
// fraction of the height above the ground (and of the distance: the far horizon), then bisected; fpK:
// the pixel's footprint per unit distance. < 0: missed.
fn earthMarch(ro: vec3f, rd: vec3f, fpK: f32) -> f32 {
  let Rs = 1.0 + 9600.0 / EARTH_RM;
  let b = dot(ro, rd);
  let off = ro - rd * b;
  let d2 = dot(off, off);
  if (d2 > Rs * Rs) { return -1.0; }
  let sq = sqrt(Rs * Rs - d2);
  let t1 = -b + sq;
  if (t1 <= 0.0) { return -1.0; }
  var t = max(-b - sq, 0.0);
  var tPrev = t;
  // (the height above the sphere near the camera, r − 1, where float32 keeps 0.8 m of it: from the anchor
  // A and the ray from it v — (|A|² − 1 + 2 A·v + v²) / (r + 1), to the millimetre)
  let fine = P.nearCam1.w > 0.5;
  let A = select(ro, P.nearCam0.xyz, fine);
  let e = select(dot(ro, ro) - 1.0, P.nearCam0.w, fine);
  let o = select(vec3f(0.0), P.nearCam1.xyz, fine);
  // (audit O8: the steps on the cheap heights — the tiles bilinear, the detail two octaves coarser —
  // lifted by what those octaves can add, ~9 footprints (the ridges' slope ~0.35 per wavelength) and 3 m
  // (bilinear against the B-spline); the full heights only within that margin, and for the crossing:
  // three steps of regula falsi on them)
  var fPrev = 1.0;
  // (once within the margin, the full heights to the end: near the ground both would be evaluated)
  var band = false;
  for (var i = 0u; i < 256u; i++) {
    let v = o + rd * t;
    let p = A + v;
    let r = length(p);
    let foot = max(t * fpK * EARTH_RM, 0.05);
    let rad = (e + 2.0 * dot(A, v) + dot(v, v)) / (r + 1.0);
    var f = 0.0;
    if (!band) {
      f = rad - (earthHeightStep(p / r, foot) + 9.0 * foot + 3.0) / EARTH_RM;
      band = f <= 0.0;
    }
    if (band) { f = rad - earthHeight(p / r, foot) / EARTH_RM; }
    if (f < 0.0) {
      // (between the last point above — its full height's f, or the margin's, a lower bound — and this one)
      var lo = tPrev;
      var hi = t;
      var flo = max(fPrev, 1e-9);
      var fhi = f;
      for (var j = 0u; j < 3u; j++) {
        let m = clamp(lo + (hi - lo) * flo / (flo - fhi), lo + 0.05 * (hi - lo), hi - 0.05 * (hi - lo));
        let vm = o + rd * m;
        let pm = A + vm;
        let rm = length(pm);
        let fm = (e + 2.0 * dot(A, vm) + dot(vm, vm)) / (rm + 1.0) - earthHeight(pm / rm, max(m * fpK * EARTH_RM, 0.05)) / EARTH_RM;
        if (fm < 0.0) { hi = m; fhi = fm; } else { lo = m; flo = fm; }
      }
      // (the root between the last two: the side above may have closed in on it, the one below not)
      return clamp(lo + (hi - lo) * flo / (flo - fhi), lo, hi);
    }
    tPrev = t;
    fPrev = f;
    t += max(0.5 * f, 0.004 * t + 1e-9);
    if (t > t1) { return -1.0; }
  }
  // (the steps spent still under the relief's shell: a grazing ray, near the ground over tens of km —
  // it meets the far ridges; a miss here showed the sky through the land, in bands)
  return t;
}

// Detail finer than the maps, the camera near: fractal noise, as many octaves as a texel of the cube
// maps holds pixels (none from afar), faded in — the texel's angle on the sphere, and the octaves
// resolved by a footprint fp (radians)
fn earthTexel() -> f32 { return 1.5707963 / f32(textureDimensions(earthCube).x); }
fn earthOct(fx: vec3f, fy: vec3f) -> f32 { return clamp(log2(earthTexel() / max(max(length(fx), length(fy)), 1e-9)) + 1.0, 0.0, 6.0); }

// The cloud cover at q (x) and the light on its puffs (y: 1 flat); the clouds drift about the pole
// (P.earth.y). Near, the map's soft texels break into puffs and wisps (most at their edges), their
// relief lit from the sun (Ls): denser towards it, this side in the shade.
fn earthCloud(q0: vec3f, fx: vec3f, fy: vec3f, Ls: vec3f) -> vec2f {
  let q = rotZ(geoQ(q0), P.earth.y);
  let base = textureSampleGrad(earthCube, bgSamp, eCube(q), eCube(rotZ(fx, P.earth.y)), eCube(rotZ(fy, P.earth.y))).a;
  var a = clamp((base - 0.06) * 1.25, 0.0, 1.0);
  var lit = 1.0;
  let o = earthOct(fx, fy);
  if (o > 0.0 && a > 0.0) {
    let f = 0.6 / earthTexel();
    // (fractional octaves: the finest fades in with the distance — no pop of detail as the camera nears)
    let oct = max(o, 1.0);
    let k = min(o, 1.0);
    let n = tfbmF(q * f, oct);
    a = clamp(a + k * n * (0.35 + 3.2 * a * (1.0 - a)), 0.0, 1.0);
    // (their edges sharp: dense puffs, not a grey veil)
    a = mix(a, smoothstep(0.04, 0.55, a), k);
    let Lt = rotZ(Ls - q0 * dot(q0, Ls), P.earth.y);
    let lt = length(Lt);
    if (lt > 1e-4) {
      let n2 = tfbmF((q + Lt * (0.35 / (f * lt))) * f, oct);
      lit = clamp(1.0 - k * 2.5 * (n2 - n), 0.45, 1.35);
    }
  }
  return vec2f(a * P.earth2.y, lit);
}

// the clouds' light at q (their top, or their base seen from below), lit through the air
fn earthCloudLight(q: vec3f, rd: vec3f, Ls: vec3f, E: vec3f, below: bool, lit: f32) -> vec3f {
  let hc = P.earth2.x * EARTH_RM;
  let mu0 = dot(q, Ls);
  let Ts = sunThrough(hc, mu0) * sunSeen(q * (1.0 + P.earth2.x), Ls);
  // thick clouds: a diffuse, bright top (a soft terminator: they stand above it), forward scattering
  // round the sun; their base, dimmer
  let wrap = clamp((mu0 + 0.08) / 1.08, 0.0, 1.0);
  let ct = dot(rd, Ls);
  let fwd = 0.25 * pow(max(ct, 0.0), 8.0);
  let sk = skySeen(q, Ls);
  let amb = max(vec3f(0.05, 0.07, 0.11) * smoothstep(-0.2, 0.2, mu0) * sk, nightFloor(sk, mu0));
  let top = 0.85 / PI * (E * Ts * (wrap * lit * select(cloudLongShadow(q, Ls), 1.0, below) + fwd) + E * amb + E * earthMoonlight(q, q, hc, mu0));
  return select(top, top * 0.35, below);
}

// The ground at q (unit), seen along rd; its footprint's axes fx, fy
// Fields: the ground's plan (east, north in metres from the latitude and longitude — good to a metre)
// cut into regions of 15 km, each with its own bearing, strip width (150–380 m) and hedgerows (0 … 1);
// each strip cut into plots 200–800 m long, staggered from strip to strip. x: the plot's hash (0 … 1),
// y: the distance to its edge [m], z: the region's hedgerows, w: along the plot [m] (its furrows)
fn fieldPlot(q: vec3f) -> vec4f {
  let lat = asin(clamp(q.z, -1.0, 1.0));
  let uv = vec2f(atan2(q.y, q.x) * cos(lat), lat) * EARTH_RM;
  let R = 15000.0;
  let rc = floor(uv / R);
  let hr = hash3u(bitcast<vec3u>(vec3i(i32(rc.x), i32(rc.y), 77)));
  let ang = u2f(hr) * PI;
  let rowW = mix(150.0, 380.0, u2f(pcg(hr)));
  let hedge = u2f(pcg(pcg(hr)));
  let d = uv - (rc + 0.5) * R;
  let c = cos(ang);
  let sn = sin(ang);
  let p = vec2f(c * d.x + sn * d.y, -sn * d.x + c * d.y);
  let j = floor(p.y / rowW);
  let hj = pcg(hr ^ (bitcast<u32>(i32(j)) * 2654435761u));
  let len = mix(200.0, 800.0, u2f(hj));
  let x = p.x + u2f(pcg(hj)) * len;
  let i = floor(x / len);
  let fy = p.y / rowW - j;
  let fx = x / len - i;
  // (the region's own border: a lane too)
  let rb = min(min(d.x + 0.5 * R, 0.5 * R - d.x), min(d.y + 0.5 * R, 0.5 * R - d.y));
  let edge = min(min(min(fy, 1.0 - fy) * rowW, min(fx, 1.0 - fx) * len), rb);
  return vec4f(u2f(pcg(hj ^ (bitcast<u32>(i32(i)) * 40503u))), edge, hedge, x);
}

// The land's cover finer than the colour map (a texel: ~2.4 km), near: a factor on the map's colour,
// ~1 on average (from afar the map's own colour). Where the map is green: a patchwork of fields
// (~350 m, warped cells) — crops, stubble, ploughed earth, meadows, their hedgerows — on the plains,
// woods on the slopes; where it is dry: mineral tints and strata following the height. (The map's
// colour tells them by brightness — its linear sum, albedo applied: forests under 0.035 (the Amazon,
// the Congo, the Black Forest, the taiga), farmland 0.05–0.22 (the pampas, the Beauce, Iowa, Ukraine,
// Brittany; dry ones to 0.45), deserts from 0.37 (the Atacama, the Sahara); its hue does not — the dry
// fields are as red as the deserts — sampled from the day cube.) q: the ground
// (unit), A: the map's colour (linear), n: the relief's normal, hG: its height [m], footM: the pixel's
// footprint [m] (the patterns fade as it nears their size)
fn earthCover(q: vec3f, A: vec3f, n: vec3f, hG: f32, footM: f32) -> vec3f {
  let sum = A.r + A.g + A.b;
  let arid = smoothstep(0.33, 0.55, sum);
  let forest = 1.0 - smoothstep(0.03, 0.05, sum);
  let veg = 1.0 - arid;
  let slope = 1.0 - clamp(dot(n, q), 0.0, 1.0);
  var m = vec3f(1.0);
  // the fields: plains and low hills
  let kF = smoothstep(120.0, 25.0, footM) * veg * (1.0 - forest) * (1.0 - smoothstep(0.06, 0.14, slope)) * (1.0 - smoothstep(1200.0, 2000.0, hG));
  if (kF > 0.0) {
    let f = fieldPlot(q);
    let r = f.x;
    var t = vec3f(0.78, 0.92, 0.72);                                  // pasture, dark
    if (r > 0.3) { t = vec3f(0.98, 1.06, 0.82); }                     // green crops
    if (r > 0.55) { t = vec3f(1.22, 1.1, 0.8); }                      // stubble, ripe grain
    if (r > 0.72) { t = vec3f(1.06, 0.9, 0.8); }                      // ploughed earth
    if (r > 0.86) { t = vec3f(0.92, 1.02, 0.88); }                    // meadow
    // (within a plot: the soil's patches; near, its furrows along it — 6 m apart)
    t *= 0.93 + 0.14 * gnoise(q * (EARTH_RM / 90.0));
    t *= 1.0 + 0.06 * sin(f.w * 1.047) * smoothstep(4.0, 1.5, footM);
    // (its edge: a track or, where the region has them, a hedgerow — darker, wider)
    let w = mix(3.0, 9.0, f.z);
    let e = 1.0 - smoothstep(0.4 * w, w, f.y + 0.25 * footM);
    t = mix(t, mix(vec3f(1.05, 0.98, 0.9), vec3f(0.5, 0.6, 0.45), f.z), e);
    m = mix(m, t, kF);
  }
  // the woods: vegetated slopes, darker and grained
  let kW = smoothstep(60.0, 12.0, footM) * veg * max(forest, smoothstep(0.08, 0.18, slope));
  if (kW > 0.0) {
    m = mix(m, vec3f(0.72, 0.8, 0.7) * (0.8 + 0.4 * gnoise(q * (EARTH_RM / 45.0))), kW);
  }
  // dry land: its minerals' tints (~800 m) and strata along the height (~40 m bands, warped)
  let kD = smoothstep(150.0, 30.0, footM) * arid;
  if (kD > 0.0) {
    let g = gnoise(q * (EARTH_RM / 800.0));
    let tint = mix(vec3f(1.12, 0.98, 0.86), vec3f(0.9, 0.96, 1.06), 0.5 + 0.5 * g);
    let strata = 1.0 + 0.1 * sin(hG / 40.0 + 6.0 * gnoise(q * (EARTH_RM / 3000.0))) * smoothstep(0.05, 0.25, slope);
    m = mix(m, tint * strata, kD);
  }
  return m;
}

// The snow line [m] at a latitude [°]: highest in the dry subtropics (the Himalaya's ~5 800 m), ~3 000 m
// in the Alps, 1 500 m at 60°, near the sea in the Arctic
fn snowLineAt(lat: f32) -> f32 {
  if (lat < 28.0) { return mix(4900.0, 5800.0, lat / 28.0); }
  if (lat < 46.0) { return mix(5800.0, 3000.0, (lat - 28.0) / 18.0); }
  if (lat < 60.0) { return mix(3000.0, 1500.0, (lat - 46.0) / 14.0); }
  return mix(1500.0, 500.0, clamp((lat - 60.0) / 12.0, 0.0, 1.0));
}

// The sea's wind at 10 m [m/s] and the way it blows (a unit tangent at q, the Earth's axes): the
// climatology's zonal belts over the oceans — the doldrums' 5 m/s, the trades' 7 from the east, the
// horse latitudes' lull, the westerlies' 9–11 (the Southern Ocean's roaring forties the strongest), the
// polar easterlies — and weather systems over them (±35 %, ±40° of direction, drifting over days)
fn seaWind(q: vec3f) -> vec4f {
  let lat = abs(asin(clamp(q.z, -1.0, 1.0))) * (180.0 / PI);
  let bump = seaBelts(lat);
  let days = P.time.x * P.near5.w / 86400.0;
  let wx = q * 5.0 + vec3f(days * 0.6, 0.0, days * 0.2);
  var U = (5.0 + 2.0 * bump.x - 1.2 * bump.y + select(4.0, 6.0, q.z < 0.0) * bump.z) * (1.0 + 0.35 * gnoise(wx));
  U = clamp(U, 1.0, 20.0);
  let east = normalize(vec3f(-q.y, q.x, 0.0) + vec3f(1e-6, 0.0, 0.0));
  let north = cross(q, east);
  // (towards the west in the trades and the polar easterlies, the east in the westerlies)
  let psi = select(PI, 0.0, lat > 30.0 && lat < 62.0) + 0.7 * gnoise(wx + vec3f(11.0, 5.0, 3.0));
  return vec4f(east * cos(psi) + north * sin(psi), U);
}
// (the belts' weights: the trades ~15°, the horse latitudes ~30°, the westerlies ~50°)
fn seaBelts(lat: f32) -> vec3f {
  let b = vec3f(lat - 15.0, lat - 30.0, lat - 50.0) / vec3f(10.0, 6.0, 12.0);
  return exp(-b * b);
}
// Smith's masking for a Gaussian slope distribution (Walter et al. 2007's rational fit), m² the slopes'
// mean square along the direction (twice the variance), cosine c to the normal
fn smithBeckmann(c: f32, m2: f32) -> f32 {
  let a = c / sqrt(max(m2 * (1.0 - c * c), 1e-8));
  if (a >= 1.6) { return 1.0; }
  return 1.0 / (1.0 + (1.0 - 1.259 * a + 0.396 * a * a) / (3.535 * a + 2.181 * a * a));
}
// The sea seen at q (from V, the sun along Ls, its light at the ground Eg, the sky's sky; under, the
// colour below the surface, col; footM: the pixel's footprint [m]): Cox & Munk's (1954) slopes for the
// wind there — Gaussian, their variance growing with the wind, upwind 0.00316 U and crosswind 0.003 +
// 0.00192 U — the sun's glint their distribution over the half vector, masked and shadowed (Smith),
// Fresnel's; the sky mirrored; the whitecaps' cover (Monahan & O'Muircheartaigh 1980: 3.84·10⁻⁶ U^3.41 —
// 1 % at 10 m/s, 4 % at 15), their foam a diffuse white. Near (seaWaves), the waves longer than a few
// pixels drawn — the surface's normal — and the rest of their slopes' variance left to the glint's (LEAN):
// the same sea, resolved where it can be.
struct SeaWaves { n: vec3f, vu: f32, vc: f32, m: f32 };
// The resolved waves at the point SEA_D: twelve trains (P.sea), their slopes summed where the pixel
// resolves them (longer than ~4 footprints, faded from 6 to 2), their variance kept where it does not.
// Crossing trains alone draw a lattice: their crests bent (the point displaced ±10 m over ~128 m), their
// amplitudes in groups (the long trains' over ~256 m, the short ones' over ~64 m) — noise on the same
// anchor (the trains themselves repeat every kilometre)
fn seaWaves(q: vec3f, tu: vec3f, tc: vec3f, footM: f32) -> SeaWaves {
  var o: SeaWaves;
  let u0 = dot(SEA_D, P.sea[0].xyz) + P.sea[2].x;
  let c0 = dot(SEA_D, P.sea[1].xyz) + P.sea[2].y;
  let base = vec3i(i32(P.sea[2].z), i32(P.sea[2].w), 0);
  let x = vec3f(u0, c0, 0.0);
  let u = u0 + 10.0 * gnoiseI(base * 2 + vec3i(0, 0, 3), x / 128.0);
  let c = c0 + 10.0 * gnoiseI(base * 2 + vec3i(0, 0, 5), x / 128.0);
  let gl = 0.55 + 0.45 * gnoiseI(base, x / 256.0);
  let gs = 0.55 + 0.45 * gnoiseI(base * 4 + vec3i(0, 0, 9), x / 64.0);
  o.m = P.sea[1].w;
  var su = 0.0;
  var sc = 0.0;
  for (var i = 0u; i < 12u; i++) {
    let w = P.sea[3u + i];
    let kv = w.xy * (TAU / 1024.0);
    let kl = length(kv);
    let kd = kv / kl;
    let r = smoothstep(2.0 * footM, 6.0 * footM, TAU / kl);
    let a = w.z * o.m * select(gs, gl, i < 6u);
    let s = a * cos(dot(kv, vec2f(u, c)) - w.w);
    su += r * s * kd.x;
    sc += r * s * kd.y;
    let v = (1.0 - r) * 0.5 * a * a;
    o.vu += v * kd.x * kd.x;
    o.vc += v * kd.y * kd.y;
  }
  o.n = normalize(q - su * tu - sc * tc);
  return o;
}
fn seaShade(q: vec3f, V: vec3f, Ls: vec3f, Eg: vec3f, sky: vec3f, under: vec3f, footM: f32) -> vec3f {
  let w = seaWind(q);
  var U = w.w;
  var tu = w.xyz;
  var n = q;
  var vu = 0.0;
  var vc = 0.0;
  // (the share of Cox–Munk's variance in slopes finer than the resolved range: half)
  var fine = 1.0;
  if (SEA_ON) {
    // (near: the flight's own wind — the waves and the glint as the pilot feels it —, the trains drawn)
    let b = P.sea[1].w;
    U = mix(U, P.sea[0].w, b);
    tu = P.sea[0].xyz;
    let sw = seaWaves(q, tu, P.sea[1].xyz, footM);
    n = sw.n;
    vu = sw.vu;
    vc = sw.vc;
    fine = 1.0 - 0.5 * b;
  }
  let su2 = 0.00316 * U * fine + vu;
  let sc2 = (0.003 + 0.00192 * U) * fine + vc;
  let tun = normalize(tu - n * dot(n, tu));
  let tcn = cross(n, tun);
  let H = normalize(Ls + V);
  let hz = max(dot(n, H), 1e-3);
  let hu = dot(tun, H) / hz;
  let hc = dot(tcn, H) / hz;
  let D = exp(-0.5 * (hu * hu / su2 + hc * hc / sc2)) / (2.0 * PI * sqrt(su2 * sc2) * hz * hz * hz * hz);
  let nl = max(dot(n, Ls), 0.0);
  let nv = max(dot(n, V), 0.02);
  // (the masking along each direction: its slopes' variance there)
  let lu = dot(tun, Ls);
  let lc = dot(tcn, Ls);
  let vvu = dot(tun, V);
  let vvc = dot(tcn, V);
  let m2l = 2.0 * (su2 * lu * lu + sc2 * lc * lc) / max(lu * lu + lc * lc, 1e-6);
  let m2v = 2.0 * (su2 * vvu * vvu + sc2 * vvc * vvc) / max(vvu * vvu + vvc * vvc, 1e-6);
  let G = smithBeckmann(nl, m2l) * smithBeckmann(nv, m2v);
  let F = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  let Fv = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  // (grazing, capped — no sparks along the limb)
  let glint = Eg * min(D * G * F / (4.0 * nv), 8.0);
  let sea = under * (1.0 - Fv) + glint + Fv * sky * 1.5 / PI;
  // (the foam lit as a diffuse white of reflectance 0.6, by the sun and the sky; near, in patches over
  // ~8 m — on the same anchor —, their mean the cover)
  var W = clamp(3.84e-6 * pow(U, 3.41), 0.0, 0.1);
  if (SEA_ON) {
    let u = dot(SEA_D, P.sea[0].xyz) + P.sea[2].x;
    let c = dot(SEA_D, P.sea[1].xyz) + P.sea[2].y;
    let pn = gnoiseI(vec3i(i32(P.sea[2].z) * 32, i32(P.sea[2].w) * 32, 7), vec3f(u, c, 0.0) / 8.0);
    let spots = clamp(W * 5.0 * smoothstep(0.35, 0.8, pn), 0.0, 1.0);
    W = mix(W, spots, smoothstep(16.0, 4.0, footM) * P.sea[1].w);
  }
  let foam = 0.6 / PI * (Eg * nl + sky);
  return mix(sea, foam, W);
}

fn earthGround(q: vec3f, rd: vec3f, Ls: vec3f, E: vec3f, fx: vec3f, fy: vec3f, hG: f32) -> vec3f {
  // (the maps at the geodetic latitude — q the squashed space's —, the geometry at q)
  let gq = geoQ(q);
  let day = textureSampleGrad(earthCube, bgSamp, eCube(gq), eCube(fx), eCube(fy));
  let rel = earthRelief(gq, fx, fy);
  let ocean = smoothstep(0.35, 0.65, rel.b);
  // (near, the tiles' imagery over the maps: four to eight times finer)
  let img = earthImagery(gq, max(length(fx), length(fy)) * EARTH_RM);
  var A = mix(day.rgb, img.c.rgb, img.w) * P.earth2.z;
  // (the relief: east and north components; the map's is faint — strengthened, P.earth.w)
  var east = vec3f(-q.y, q.x, 0.0);
  east = select(normalize(east), vec3f(0.0, 1.0, 0.0), dot(east, east) < 1e-10);
  let north = cross(q, east);
  let tn = vec2f(rel.r * 2.0 - 1.0, 1.0 - rel.g * 2.0) * P.earth.w * (1.0 - ocean);
  var n = normalize(q + tn.x * east + tn.y * north);
  // (near — a pixel under the map's texel — the relief's own normal: its ridges, crests and rocks)
  let footM = max(length(fx), length(fy)) * EARTH_RM;
  let texelM = EARTH_RM * TAU / f32(textureDimensions(earthElev).x);
  if (footM < texelM && ocean < 1.0) {
    n = normalize(mix(n, earthNormalAt(q, footM), smoothstep(texelM, 0.3 * texelM, footM) * (1.0 - ocean)));
  }
  // (near: the ground's own materials from its height and slope — snow above the snow line (lower towards
  // the poles, ragged), bare rock on the steep faces of the mountains; blended in as the map's texel
  // grows under the pixel)
  if (footM < texelM && ocean < 1.0) {
    let k = smoothstep(texelM, 0.3 * texelM, footM) * (1.0 - ocean);
    let slope = 1.0 - clamp(dot(n, q), 0.0, 1.0);
    let lat = abs(asin(clamp(gq.z, -1.0, 1.0))) * 57.29578;
    let snowLine = snowLineAt(lat) + 300.0 * gnoise(q * 3000.0);
    let snow = smoothstep(snowLine - 250.0, snowLine + 250.0, hG) * (1.0 - smoothstep(0.25, 0.5, slope));
    let rock = smoothstep(0.22, 0.45, slope) * smoothstep(300.0, 1500.0, hG);
    A *= mix(vec3f(1.0), earthCover(q, A, n, hG, footM), k);
    A = mix(A, vec3f(0.16, 0.145, 0.13) * (0.8 + 0.4 * gnoise(q * 40000.0)), rock * k);
    A = mix(A, vec3f(0.82, 0.84, 0.88), snow * k);
  }
  // (a runway: its pavement and markings over the ground, flat; its lights added below)
  var rwyLamps = vec3f(0.0);
  if (HAS_RWY && RWY_HIT.w > 0.5) {
    for (var k = 0u; k < rwyCount(); k++) {
      let rel = P.runways[4u + 4u * k].xyz + RWY_HIT.xyz;
      let ra = dot(rel, P.runways[2u + 4u * k].xyz);
      let rc = dot(rel, P.runways[3u + 4u * k].xyz);
      if (ra < -120.0 || ra > P.runways[1u + 4u * k].w + 120.0 || abs(rc) > P.runways[2u + 4u * k].w + 120.0) { continue; }
      let rl = runwayShade(ra, rc, P.runways[1u + 4u * k].w, P.runways[2u + 4u * k].w, max(footM, 0.02), asin(clamp(dot(-rd, q), -1.0, 1.0)));
      A = mix(A, rl.albedo, rl.cover);
      n = normalize(mix(n, q, rl.cover));
      rwyLamps += rl.lamps;
    }
  }
  let V = -rd;
  let mu0 = dot(q, Ls);
  // the sunlight at the ground, through the air and under the clouds (their shadow, cast along the
  // sun's slant from their height; softened)
  let hc = P.earth2.x;
  let qs = normalize(q + (Ls - q * mu0) * (hc / max(mu0, 0.06)));
  let shade = 1.0 - 0.8 * earthCloud(qs, fx * 3.0, fy * 3.0, Ls).x;
  var Eg = E * sunThrough(hG, mu0) * shade * sunSeen(q * (1.0 + hG / EARTH_RM), Ls);
  // (near, the mountains' shadows: a peak between the sun and the valley)
  let footS = max(length(fx), length(fy)) * EARTH_RM;
  if (footS < 2.0 * EARTH_RM * TAU / f32(textureDimensions(earthElev).x) && mu0 > -0.05 && ocean < 1.0) {
    Eg *= mix(1.0, earthTerrainShadow(q * (1.0 + hG / EARTH_RM), Ls, footS), 1.0 - ocean);
  }
  // (near: the land's colour and relief finer than the maps — the noise's slopes facing the sun lit)
  var relLit = 1.0;
  let og = earthOct(fx, fy);
  if (og > 0.0 && ocean < 1.0) {
    let f = 1.0 / earthTexel();
    let oct = max(og, 1.0);
    let k = min(og, 1.0) * (1.0 - ocean);
    let p = q * f + vec3f(17.0, 3.0, 5.0);
    let nd = tfbmF(p, oct);
    A *= 1.0 + k * vec3f(0.4, 0.34, 0.28) * nd;
    let Lt = Ls - q * mu0;
    let lt = length(Lt);
    if (lt > 1e-4) { relLit = clamp(1.0 - k * 1.0 * (tfbmF(p + Lt * (0.3 / lt), oct) - nd), 0.3, 1.6); }
  }
  // the sky's light (blue by day, the twilight's glow)
  // (at night, the stars' and the airglow's: EARTH_NIGHT; on the slopes, less of the sky seen)
  let sk = skySeen(q, Ls);
  // (a clear sky's light on the flat: ~a tenth of the sun's — bluish)
  let sky = E * max(vec3f(0.06, 0.1, 0.19) * smoothstep(-0.18, 0.25, mu0) * sk, nightFloor(sk, mu0));
  // (a face sees the sky over it and the ground round it — a plane's shares, ½(1 + n·up) and ½(1 − n·up)
  // —: on the steep faces in the shade, the sky's light halved and the light the ground sends back — the
  // sun's and the sky's on it, at an albedo of 0.18: a cliff's shadow 2–3 stops under the sunlit ground,
  // as the eye sees it, not black)
  let up = dot(n, q);
  let bounce = (E * sunThrough(hG, mu0) * shade * max(mu0, 0.0) + sky) * 0.18 * 0.5 * (1.0 - up);
  var col = A / PI * (Eg * max(dot(n, Ls), 0.0) * relLit + sky * 0.5 * (1.0 + up) + bounce
    + E * earthMoonlight(q, n, hG, mu0) * shade);
  // the sea (seaShade): the sun's glint off its wind-roughened slopes, the sky mirrored, the whitecaps
  if (ocean > 0.0) {
    col = mix(col, seaShade(q, V, Ls, Eg, sky, col, footM), ocean);
  }
  // the cities at night (sodium's orange, whiter at their hearts), fading into the twilight
  let lights = mix(textureSampleGrad(earthNight, bgSamp, eCube(gq), eCube(fx), eCube(fy)).r, img.c.a, img.w);
  let lamp = max(lights - 0.07, 0.0) / 0.93;
  let dark = 1.0 - smoothstep(-0.12, 0.06, mu0);
  col += mix(vec3f(1.0, 0.55, 0.22), vec3f(1.0, 0.85, 0.6), lamp) * (pow(lamp, 1.4) * P.earth.z * dark * luminance(E) / PI);
  // (the runways' lamps: a sunlit sky's worth by day — barely seen —, far over the night's ground)
  if (HAS_RWY) { col += rwyLamps * (luminance(E) / PI) * mix(0.6, 40.0, dark); }
  return col;
}

// Another world's ground (or cloud deck) seen through its air: its map (at the footprint's level), lit
// by the sunlight come down through the air (reddened, dimmed low, none in the shadow) and by its sky;
// the giants darkened towards the limb (Minnaert), the dusty worlds as regolith (Lommel–Seeliger)
fn otherGround(k: u32, q: vec3f, rd: vec3f, Ls: vec3f, E: vec3f, fp: f32) -> vec3f {
  setMapLod(fp, fp, k);
  let A = planetAlbedo(k, q, P.time.x).rgb;
  let m = u32(bodies[BV * k + 2u].z) - 4u;
  let mu0 = dot(q, Ls);
  let mu = max(dot(q, -rd), 0.02);
  let cosi = max(dot(hdNormal(k, q), Ls), 0.0);
  var f = cosi;
  if (m == 4u || m == 5u || m == 20u || m == 21u) {
    let km = select(0.88, 0.8, m >= 20u);
    f = pow(cosi, km) * pow(mu, km - 1.0);
  } else if (regolith(m)) {
    f = 2.0 * cosi / (cosi + mu);
  }
  // (the rings' shadow: their plane the equator's; their shine on the night and the twilight)
  let rs = ringShadow(k, q, vec3f(0.0, 0.0, 1.0), Ls);
  var shine = vec3f(0.0);
  if (ringOuter(k) > 0.0 && mu0 < 0.25) { shine = ringShine(k, q, Ls) * ((1.0 - 4.0 * max(mu0, 0.0)) / PI); }
  return A / PI * E * (sunThrough(0.0, mu0) * f * rs + AIR.sky * smoothstep(-0.15, 0.25, mu0) + shine);
}

// What a ray sees of the Earth: from ro along rd (its axes; radii), meeting the ground at tHit (< 0:
// it does not); the sun along Ls, its irradiance E; the pixel's axes gx, gy and its footprint fp0 +
// fpK t. col: the light added; T: what shows through of what lies beyond (the ground: none).
struct EarthLook { col: vec3f, T: vec3f, Lm: vec3f };
// The Earth's clouds as a volume (the camera near: the horizon seen from orbit, a sunrise, the sky from
// the ground): a layer from 1.5 km up to a top that rises with the cover (0.25 … 1 of 9 km), marched
// over 12 samples where the ray crosses it — Beer–Lambert, the sunlight through the cloud above
// (its column from the cover) with the powder term, a forward lobe (Henyey–Greenstein) and multiple
// scattering's brightening, the sky's light; x: opacity, rgb in cl: its mean radiance, t: where it starts
struct CloudVol { alpha: f32, cl: vec3f, t: f32 };
// the clouds' phase function: Henyey–Greenstein forward (0.8) and back (−0.2) lobes, 65/35, their
// eccentricities scaled by c (the multiple-scattering octaves: rounder)
fn hgPhase(g: f32, ct: f32) -> f32 { return (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * ct, 1e-4), 1.5)); }
fn cloudPhase(ct: f32, c: f32) -> f32 { return 0.65 * hgPhase(0.8 * c, ct) + 0.35 * hgPhase(-0.2 * c, ct); }

// Cirrus: a shell of ice at 9 km, in streaks along the jet streams (between ~25° and 65° of latitude)
// and the anvils over the tropics' convergence, drifting with the weather; x: its opacity at q (its
// axes), resolved to a footprint fpM [m] (beyond the streaks' scale, their mean)
fn cirrusCover(q: vec3f, fpM: f32) -> f32 {
  let qd = rotZ(q, P.earth.y * 1.3 + 0.7);
  let lat = asin(clamp(qd.z, -1.0, 1.0));
  let band = smoothstep(0.42, 0.62, abs(lat)) * (1.0 - smoothstep(1.0, 1.2, abs(lat))) + 0.6 * exp(-lat * lat / 0.015);
  if (band <= 0.01) { return 0.0; }
  // (fibres a few km wide, tens long: stretched along the east — the noise's northward component seven
  // times finer —, the field of them over ~100 km)
  let e = normalize(vec3f(-qd.y, qd.x, 1e-6));
  let nn = cross(qd, e);
  let s = qd * (EARTH_RM / 12000.0);
  let p = s + nn * dot(s, nn) * 6.0;
  // (the gradient noise baked in its texture, not hashed: the cirrus are drawn on every ray of the sky)
  let field = smoothstep(-0.1, 0.4, dnoise(qd * (EARTH_RM / 100000.0)));
  if (field <= 0.0) { return 0.0; }
  let detail = smoothstep(1500.0, 12000.0, fpM);
  var n = 0.55 * dnoise(p) + 0.3 * dnoise(p * 2.7 + vec3f(3.1, 7.7, 1.3));
  n += (1.0 - detail) * 0.15 * dnoise(p * 7.9 + vec3f(5.5, 1.1, 9.4));
  let a = mix(smoothstep(0.15, 0.6, n), 0.12, detail);
  return 0.3 * band * field * a;
}
// their light at q: thin ice lit through the air at their height — a strong forward lobe (a halo's worth
// round the sun, capped), the sky's light from above
fn cirrusLight(q: vec3f, rd: vec3f, Ls: vec3f, E: vec3f) -> vec3f {
  let h = 9000.0;
  let mu0 = dot(q, Ls);
  let Ts = sunThrough(h, mu0) * sunSeen(q * (1.0 + h / EARTH_RM), Ls);
  let ct = dot(rd, Ls);
  let ph = min(0.75 * hgPhase(0.85, ct) + 0.25 * hgPhase(-0.1, ct), 1.0);
  let sk = skySeen(q, Ls);
  let amb = max(vec3f(0.05, 0.07, 0.11) * smoothstep(-0.2, 0.2, mu0) * sk, nightFloor(sk, mu0));
  return E * (Ts * ph * 4.0 + 0.6 / PI * amb);
}

// The cloud cover smoothed at a map level (lod), on the clouds' drift — the long shadows' heights
fn cloudCoverAt(q0: vec3f, lod: f32) -> f32 {
  let q = rotZ(geoQ(q0), P.earth.y);
  return clamp((textureSampleLevel(earthCube, bgSamp, eCube(q), lod).a - 0.06) * 1.25, 0.0, 1.0);
}
// Seen from orbit near the terminator: the tops' long shadows — the cover taken for height (up to 8 km
// for a thick deck), the sun's slant from the tops 8, 25 and 60 km towards it: a taller cloud between
// shades this one; soft over 1.5 km
fn cloudLongShadow(q: vec3f, Ls: vec3f) -> f32 {
  let mu0 = dot(q, Ls);
  if (mu0 <= -0.02 || mu0 >= 0.3) { return 1.0; }
  let Lt = Ls - q * mu0;
  let lt = length(Lt);
  if (lt < 1e-4) { return 1.0; }
  let dir = Lt / lt;
  let tanE = max(mu0, 0.0) / lt;
  let lod = clamp(log2(25000.0 / EARTH_RM / earthTexel()), 0.0, 8.0);
  let h0 = 8000.0 * cloudCoverAt(q, lod);
  var sh = 1.0;
  for (var i = 0; i < 3; i++) {
    let d = array<f32, 3>(8000.0, 25000.0, 60000.0)[i];
    let qi = normalize(q + dir * (d / EARTH_RM));
    let hi = 8000.0 * cloudCoverAt(qi, lod);
    sh *= 1.0 - 0.6 * smoothstep(0.0, 1500.0, hi - h0 - d * tanE);
  }
  return mix(1.0, sh, smoothstep(0.3, 0.15, mu0));
}

fn cloudVolume(ro: vec3f, rd: vec3f, tHit: f32, Ls: vec3f, E: vec3f, gx: vec3f, gy: vec3f, fp0: f32, fpK: f32, jit: f32) -> CloudVol {
  var o: CloudVol;
  o.t = -1.0;
  let hb = 1500.0 / EARTH_RM;
  let ht = 4500.0 / EARTH_RM;
  let b = dot(ro, rd);
  let off2 = dot(ro, ro) - b * b;
  let hT = (1.0 + ht) * (1.0 + ht) - off2;
  if (hT <= 0.0) { return o; }
  var t0 = max(-b - sqrt(hT), 0.0);
  var t1 = -b + sqrt(hT);
  // (the base's sphere cuts the layer: the part before it, or — from under it — the part after)
  let hB = (1.0 + hb) * (1.0 + hb) - off2;
  if (hB > 0.0) {
    let b0 = -b - sqrt(hB);
    let b1 = -b + sqrt(hB);
    if (b0 > t0) { t1 = min(t1, b0); } else if (b1 > t0) { t0 = b1; }
  }
  if (tHit > 0.0) { t1 = min(t1, tHit); }
  // (no farther than 120 km: the clouds beyond thin into the haze)
  t1 = min(t1, t0 + 250000.0 / EARTH_RM);
  if (t1 <= t0) { return o; }
  let N = 16u;
  let ct = dot(rd, Ls);
  // (the droplets' phase function two-lobed — the silver lining round the sun, a glow away from it —, and
  // the light scattered many times as octaves of it, each fainter, rounder, less dimmed: Wrenninge 2015)
  let hg = cloudPhase(ct, 1.0);
  let ms1 = cloudPhase(ct, 0.5) * 4.0 * PI;
  let ms2 = cloudPhase(ct, 0.25) * 4.0 * PI;
  let ms3 = cloudPhase(ct, 0.125) * 4.0 * PI;
  var Tv = 1.0;
  var col = vec3f(0.0);
  var tPrev = t0;
  for (var i = 0u; i < N; i++) {
    // (samples crowding near the camera: the near clouds' shapes resolved, the far ones' mean)
    let u1 = (f32(i) + 1.0) / f32(N);
    let tn = t0 + (t1 - t0) * u1 * u1;
    let t = mix(tPrev, tn, jit);
    let dm = (tn - tPrev) * EARTH_RM;
    tPrev = tn;
    let p = ro + rd * t;
    let r = length(p);
    let q = p / r;
    let hn = (r - 1.0 - hb) / (ht - hb);
    // the cover as the flat layer draws it (the map and its fine noise), shaped in height by a 3D noise
    // drifting with the clouds: cumulus domes — a base that wavers, a top that rises with the cover and
    // the noise — so their sides are not the map's walls drawn upwards
    let fp = fp0 + fpK * t;
    let fx = earthFoot(q, rd, gx, fp);
    let fy = earthFoot(q, rd, gy, fp);
    let a = earthCloud(q, fx, fy, Ls).x / max(P.earth2.y, 1e-3);
    if (a <= 0.01) { continue; }
    let qd = rotZ(q, P.earth.y);
    let x = qd * (EARTH_RM / 2600.0) + vec3f(0.0, 0.0, hn * 2.0);
    let sh = 0.6 * dnoise(x) + 0.3 * dnoise(x * 2.3 + vec3f(5.1)) + 0.1 * dnoise(x * 5.3 + vec3f(1.7));
    // (the tops follow the cover smoothed over ~16 texels — tens of km —: gentle domes where the map's
    // cover ends sharply, not walls rising from its edge)
    let qc = rotZ(geoQ(q), P.earth.y);
    let soft = clamp((textureSampleGrad(earthCube, bgSamp, eCube(qc), eCube(rotZ(fx, P.earth.y)) * 16.0, eCube(rotZ(fy, P.earth.y)) * 16.0).a - 0.06) * 1.25, 0.0, 1.0);
    let top = (0.15 + 0.85 * soft) * (0.7 + 0.6 * sh);
    let hp = smoothstep(0.0, 0.05 + 0.12 * sh, hn) * (1.0 - smoothstep(0.45 * top, top, hn));
    let c = a;
    let rho = hp * clamp(1.6 * (a * (0.4 + sh) - 0.2), 0.0, 1.0); // (thin cover eroded to puffs and gaps)
    if (rho <= 0.0) { continue; }
    let sigma = rho * 25.0 / ((ht - hb) * EARTH_RM * max(top, 0.2)); // (per metre: τ ~ 25 through a thick one)
    let mu0 = dot(q, Ls);
    // the sunlight: through the air to this height, then the cloud above it towards the sun
    let Ts = sunThrough((r - 1.0) * EARTH_RM, mu0) * sunSeen(p, Ls);
    // (the cloud above this point, to its top; the sun's path through it — the clouds broken, it comes in by
    // their sides too: shortened)
    let tauUp = c * 25.0 * max(top - hn, 0.0) / max(top, 0.2);
    let tauSun = 0.4 * tauUp / max(mu0, 0.12);
    let beer = select(exp(-tauSun), 0.0, mu0 < -0.1);
    let powder = 1.0 - exp(-2.0 * sigma * 400.0 - 0.15);
    // (the sky's and the moon's light from above, dimmed by the cloud over it: a grey base, a bright top)
    let over = 0.3 + 0.7 * exp(-0.25 * tauUp);
    let sk = skySeen(q, Ls);
    let amb = max(vec3f(0.05, 0.07, 0.11) * smoothstep(-0.2, 0.2, mu0) * sk, nightFloor(sk, mu0));
    // (the octaves' dimming from one exponential: e^(−0.04 τ), its square, its cube)
    let e1 = exp(-0.04 * tauSun);
    let e2 = e1 * e1;
    let ms = (ms1 * e2 * e1 + 0.5 * ms2 * e2 + 0.25 * ms3 * e1) / 1.75;
    let Lin = E * Ts * (hg * beer * powder * 2.5 + 0.25 * ms * smoothstep(-0.1, 0.1, mu0))
      + 0.85 / PI * over * (E * amb + E * earthMoonlight(q, q, (r - 1.0) * EARTH_RM, mu0));
    let dT = exp(-sigma * dm);
    col += Tv * Lin * (1.0 - dT);
    if (o.t < 0.0) { o.t = t; }
    Tv *= dT;
    if (Tv < 0.01) { break; }
  }
  o.alpha = (1.0 - Tv) * P.earth2.y;
  o.cl = col / max(1.0 - Tv, 1e-4);
  return o;
}

fn earthLook(k: u32, ro: vec3f, rd: vec3f, tHit: f32, Ls: vec3f, E: vec3f, gx: vec3f, gy: vec3f, fp0: f32, fpK: f32, jit: f32, volume: bool) -> EarthLook {
  var o: EarthLook;
  let earth = isEarth(k);
  // the cloud layer: met from above (on the way to the ground), or from below (in the sky)
  let rc = 1.0 + P.earth2.x;
  let b = dot(ro, rd);
  let off = ro - rd * b;
  let hc2 = rc * rc - dot(off, off);
  var alpha = 0.0;
  var cl = vec3f(0.0);
  var tc = -1.0;
  if (volume && earth && P.earth2.y > 0.0) {
    let cv = cloudVolume(ro, rd, tHit, Ls, E, gx, gy, fp0, fpK, jit);
    alpha = cv.alpha;
    cl = cv.cl;
    tc = cv.t;
  } else if (earth && hc2 > 0.0 && P.earth2.y > 0.0) {
    let below = dot(ro, ro) < rc * rc;
    tc = select(-b - sqrt(hc2), -b + sqrt(hc2), below);
    if (tc > 0.0 && (tHit <= 0.0 || tc < tHit) && !(below && tHit > 0.0)) {
      let qc = normalize(ro + rd * tc);
      let fp = fp0 + fpK * tc;
      let cv = earthCloud(qc, earthFoot(qc, rd, gx, fp), earthFoot(qc, rd, gy, fp), Ls);
      alpha = cv.x;
      cl = earthCloudLight(qc, rd, Ls, E, below, cv.y);
    }
  }
  // the cirrus at 9 km (from far above, a third: the cloud map's own already holds them), before the
  // clouds or behind them
  if (earth && P.earth2.y > 0.0) {
    let ri = 1.0 + 9000.0 / EARTH_RM;
    let hi2 = ri * ri - dot(off, off);
    if (hi2 > 0.0) {
      let under = dot(ro, ro) < ri * ri;
      let ti = select(-b - sqrt(hi2), -b + sqrt(hi2), under);
      if (ti > 0.0 && (tHit <= 0.0 || ti < tHit)) {
        let qi = normalize(ro + rd * ti);
        let alt = (length(ro) - 1.0) * EARTH_RM;
        let ai = cirrusCover(qi, (fp0 + fpK * ti) * EARTH_RM) * mix(1.0, 0.35, smoothstep(20000.0, 100000.0, alt));
        if (ai > 0.0) {
          let ci = cirrusLight(qi, rd, Ls, E);
          if (alpha <= 0.0 || ti < tc) {
            cl = (ai * ci + (1.0 - ai) * alpha * cl) / max(ai + (1.0 - ai) * alpha, 1e-5);
            alpha = ai + (1.0 - ai) * alpha;
            tc = ti;
          } else {
            cl = (alpha * cl + (1.0 - alpha) * ai * ci) / max(alpha + (1.0 - alpha) * ai, 1e-5);
            alpha = alpha + (1.0 - alpha) * ai;
          }
        }
      }
    }
  }
  // the air: to the ground (or out), and to the cloud — seen through the air before it only
  let air = earthAir(ro, rd, select(3e38, tHit, tHit > 0.0), Ls, E, jit, select(3e38, tc, alpha > 0.0));
  o.Lm = air.Lm;
  var G = vec3f(0.0);
  if (tHit > 0.0) {
    let ph = ro + rd * tHit;
    let q = normalize(ph);
    let fp = fp0 + fpK * tHit;
    if (earth) {
      G = earthGround(q, rd, Ls, E, earthFoot(q, rd, gx, fp), earthFoot(q, rd, gy, fp), max((length(ph) - 1.0) * EARTH_RM, 0.0));
    } else {
      G = otherGround(k, q, rd, Ls, E, fp);
    }
  }
  o.col = (1.0 - alpha) * (air.L + air.T * G) + alpha * (air.Lc + air.Tc * cl);
  o.T = select((1.0 - alpha) * air.T, vec3f(0.0), tHit > 0.0);
  return o;
}

// The Earth in the local patch (the camera near it): its ground and air, or the sky behind them
struct EarthNear { col: vec3f, T: vec3f, t: f32, veil: f32 };
fn earthNear(look: vec3f, rnd: f32, k: u32) -> EarthNear {
  setAir(k);
  // (the Earth's relief marched below ~3 000 km: its mountains on the horizon; higher, sub-pixel — the
  // sphere; the other worlds' ground, a sphere)
  // (on its squashed axes — the Earth's ellipsoid the unit sphere; nearCam squashed by the CPU —, the
  // ray's lengths there m times the camera's)
  let ab = squashOf(k);
  let ro = nearCam();
  let rs = squashed(toBody(look), ab);
  let m = length(rs);
  let rd = rs / m;
  var t = unitHit(ro, rd);
  if (isEarth(k) && length(ro) < 1.5) { t = earthMarch(ro, rd, pixFoot()); }
  if (HAS_RWY) { RWY_HIT = vec4f(rd * (t * EARTH_RM), select(0.0, 1.0, isEarth(k) && t > 0.0 && rwyCount() > 0u)); }
  let lt = nearLight(k);
  SEA_ON = isEarth(k) && t > 0.0 && P.sea[1].w > 0.0;
  SEA_D = toBody(look) * (t / m * P.near4.w);
  let e = earthLook(k, ro, rd, t, normalize(squashed(toBody(lt.dir), ab)), lt.e, squashed(toBody(P.camRight.xyz), ab), squashed(toBody(P.camUp.xyz), ab),
    0.0, pixFoot(), fract(rnd * 7.31 + 0.37), P.earth4.w > 0.5);
  SEA_ON = false;
  // the stars behind the sunlit sky: drawn far brighter than they are (the sky's scenes need them), they
  // would shine through a blue sky — faded as the sky's glow here outshines them: gone while it is a
  // hundredth of a white ground in the sun or more (day, sunset), all out below a ten-thousandth (night)
  let s = luminance(max(e.col - e.Lm, vec3f(0.0))) / max(luminance(lt.e) / PI, 1e-30);
  let veil = clamp(log(1e-2 / max(s, 1e-12)) / log(100.0), 0.0, 1.0);
  return EarthNear(e.col, e.T, select(t, t / m, t > 0.0), veil * veil);
}

// The Earth's sunlight in the far view: the irradiance of its source (a blackbody at its temperature,
// shifted by g), and its direction on the Earth's axes
fn earthSun(k: u32, gObs: f32) -> vec3f {
  let src = lightSource(k);
  return blackbody(src.x * gObs, P.disk.w) * src.y * bodies[BV * k + 3u].y * PI;
}

fn traceLook(look: vec3f, rnd: f32, tNow: f32) -> TraceOut {
  rayDepth = 1e9;
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
  let whOn = HAS_WH && P.wh.x > 0.5;
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
    if (P.wh2.y > 0.0) { whInR = length(whCentre(tNow) + whToWorld(P.whN.xyz * dnegR(P.wh2.y).x)); }
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
  let thick = HAS_THICK && P.ext2.z > 0.0;
  let volOn = (HAS_VOL && P.vol.x > 0.5);
  let jetOn = (HAS_JET && P.jet.x > 0.5);
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
  let radio = (HAS_RADIO && P.radio.x > 0.5);
  let spotOn = (HAS_SPOT && P.spot.x > 0.5);
  var trans3 = vec3f(1.0); // per-frequency transmittance (radio band)
  var out: TraceOut;
  var kCur: Deriv; // derivative at the current point (FSAL)
  if (seg == 0u) { kCur = geodesicRHS(s.x, s.p, L, a); }
  var comp: GState; // Kahan compensation of the state
  var skyDir = vec3f(0.0);
  var skyOrg = vec4f(0.0); // where it left for the sky, and when (bodies beyond)
  var skyG = 1.0;
  var skyId = SKY_NATIVE;
  var thr = vec3f(1.0);  // transmission through the cinematic liquid surface
  var colW = vec3f(0.0); // light gathered before the last pass through the wormhole
  var rayLen = 0.0; // distance travelled by the ray (flat map), for the camera path's tube radius
  var travel = 0.0; // the same, always kept when there are bodies (their footprint on the pixel)
  var tubeVis = 1.0; // the path's tube is hidden by the disk (opaque for it except in real gaps)

  // Polarization: κ of the two screen axes for this pixel's photon at the camera.
  let polOn = (HAS_POL && P.pol.x > 0.5);
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

  // Our universe, the camera beyond the Dneg region: the straight piece up to it (or to infinity, when
  // the ray does not come back towards the mouth) meets the solar system's bodies first.
  // A ray passing the mouth wide — beyond B — is not integrated through its Dneg region (5 AU across in
  // the solar system: nearly every sky ray entered it): straight on through our bodies to our sky, bent
  // by the mouth's weak lensing. The Dneg metric's is that of half a point mass M (only space is curved:
  // g_tt = −1): from here to infinity α = (M/b)(1 − s₀/√(s₀² + b²)), b the closest approach, s₀ the camera
  // from it along the ray — measured against the integrator: within 3 % at b = 20ρ, its error falling as
  // 1/b², under a quarter pixel beyond √(0.26 M / pixel) (and 4ρ: the throat's own shape)
  var outward = false; // (the ray never enters the Dneg region: nothing further to meet)
  var straight = !HAS_KERR;
  if (seg == 1u && P.wh2.y < 0.0) {
    let m = -P.ourCam.xyz;
    let R2 = P.ourCam.w * P.ourCam.w;
    if (dot(m, m) > R2) {
      let dH = normalize(repToHome(wn, wd));
      let b = dot(m, dH);
      let perp = m - b * dH;
      let bb = length(perp);
      straight = straight || bb > max(4.0 * P.wh.y, sqrt(0.26 * P.wh.w / P.camUp.w));
      if (ourStart() < bodyCount()) {
        let hh = R2 - bb * bb;
        var tEnter = 3e38;
        if (!straight && hh > 0.0 && b > 0.0) { tEnter = b - sqrt(hh); } else { outward = true; }
        var wo: WhOut;
        wo.tint = vec3f(1.0);
        let stop = ourSegment(vec3f(0.0), dH, tEnter, &wo, 1.0 / eloc, 0.0, false);
        colW += thr * wo.glow;
        thr *= wo.tint;
        if (stop) { return traceOut(colW); }
      }
      if (straight) {
        let al = P.wh.w / max(bb, 1e-9) * (1.0 + b / sqrt(b * b + bb * bb));
        skyDir = normalize(dH * cos(al) + perp * (sin(al) / max(bb, 1e-9)));
      }
    }
  }

  if (straight) {
    // (straight on to our sky — the Earth-only tracer, or a ray passing the mouth wide)
    fate = 2u;
    if (!HAS_KERR && dot(skyDir, skyDir) < 0.5) { skyDir = repToHome(wn, wd); }
    skyG = 1.0 / eloc;
    skyId = SKY_HOME;
    skyOrg = vec4f(0.0);
  } else {
  for (var segN = 0u; segN < 6u; segN++) {
  if (seg == 1u) {
    let w = dnegTrace(wl, wn, wd, P.wh2.w, P.whN.w, fract(rnd * 61.8034 + 0.2718 * f32(segN)), 1.0 / eloc, travel);
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
      // our universe's bodies beyond the Dneg region (straight on), or, smaller than the pixel, with
      // the sky from where the ray left (w: the ray's length there, their footprint)
      if (outward) {
        skyOrg = vec4f(0.0);
      } else {
        let exitH = dnegR(-P.whN.w).x * repToHome(w.n, -w.n) - P.ourCam.xyz;
        skyOrg = vec4f(exitH, travel + length(exitH));
        if (ourStart() < bodyCount()) {
          var wo: WhOut;
          wo.tint = vec3f(1.0);
          let stop = ourSegment(exitH, normalize(skyDir), 3e38, &wo, 1.0 / eloc, skyOrg.w, false);
          colW += thr * wo.glow;
          thr *= wo.tint;
          if (stop) { thr = vec3f(0.0); }
        }
      }
      break;
    }
    travel += w.len;
    // out of the far mouth: on through the Kerr metric, from the gluing sphere
    let tOut = tNow + whInT - w.len;
    let Xo = whCentre(tOut) + whToWorld(w.n * (P.wh2.z * 1.0005));
    if (whInR > 0.0) {
      // came in from the black hole's universe: the local energy follows its potential (weak field),
      // E_loc ∝ 1/α, so the energy at infinity is unchanged across the Dneg region
      eloc *= sqrt(max(1.0 - 2.0 / whInR, 1e-3) / max(1.0 - 2.0 / length(Xo), 1e-3));
    }
    // an orbiting mouth: the photon, known in the mouth's rest frame, seen from the hole's frame
    // (aberration and Doppler; the backward ray is the photon's direction reversed)
    let bo = boostPhoton(-whToWorld(w.d), -whVelocity(tOut));
    eloc *= bo.e;
    let ks = kerrLaunch(Xo, -bo.d, eloc, a);
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
  // (the step's start in Cartesian form and the mouth's pull there: its end's, kept from the step before)
  var pS = blCart(s.x);
  var mfS = vec3f(0.0);
  if (whOn) { mfS = mouthForce(s.x); }
  for (var i = 0u; i < maxSteps; i++) {
    steps = i;
    var n: GState;
    var h: f32;
    var kNext: Deriv;
    if (adaptive) {
      // heuristic step only as an upper bound: accuracy is enforced by the error estimate
      var hMax = stepSizeAt(s, L, a, eps * 4.0, rH, pS);
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
      h = stepSizeAt(s, L, a, eps, rH, pS);
      // random first step: decorrelates volumetric sampling between pixels / samples
      if (i == 0u) { h *= mix(0.2, 1.0, rnd); }
      let ns = kahanAdd(s, rk4Delta(s, L, a, -h), &comp, P.ext2.w);
      n = wrapPole(ns);
      if (n.x.y != ns.x.y) { comp = GState(); }
      evals += 4u;
    }
    let pN = blCart(n.x);
    let massive = P.bodyCfg.y >= 0.0;
    if (massive || whOn) {
      // weak fields added to Kerr — the massive star's, the wormhole's: trapezoidal kick over the
      // step (backwards in λ: Δp = +h ∂δH/∂x)
      var f = vec3f(0.0);
      if (massive) {
        let back = normalize(pN - pS);
        let b = u32(P.bodyCfg.y);
        f += bodyForce(b, s.x, back) + bodyForce(b, n.x, back);
      }
      if (whOn) {
        let mfN = mouthForce(n.x);
        f += mfS + mfN;
        mfS = mfN;
      }
      f *= 0.5 * h;
      n.p += f.xy;
      L += f.z;
      if (adaptive) { kNext = geodesicRHS(n.x, n.p, L, a); evals += 1u; }
    }

    if (P.path.x > 1.5 && probeBeam == 0.0) { // (a drawing on the image: not a light for the probe)
      let q0 = pS;
      let q1 = pN;
      let pg = pathGlow(q0, q1, rayLen);
      // the disk hides the tube: skip it when it lies beyond a disk crossing in this same step
      var behindDisk = false;
      let cz0 = cos(s.x.y);
      let cz1 = cos(n.x.y);
      if (diskOn && !thick && cz0 * cz1 < 0.0) {
        let ud = cz0 / (cz0 - cz1);
        let rc = mix(s.x.x, n.x.x, ud);
        behindDisk = rc >= rIn && rc <= rOut * DISK_REACH && pg.w > ud;
      }
      // bodies are opaque: they hide the tube beyond their surface in this step (then the ray ends)
      for (var k = 0u; k < ourStart(); k++) {
        let ts = sphereHit(q0, q1, bodyCentre(k, tNow + n.x.w), bodyRadius(k));
        if (ts >= 0.0 && pg.w > ts) { behindDisk = true; }
      }
      // the wormhole's mouth: beyond its gluing sphere the ray goes through the throat
      if (whOn) {
        let tg = glueHit(q0, q1, whCentre(tNow + n.x.w));
        if (tg >= 0.0 && pg.w > tg) { behindDisk = true; }
      }
      if (!behindDisk) { col += trans * tubeVis * pg.rgb; }
      rayLen += length(q1 - q0);
    }

    if (bodyCount() > 0u) {
      let p0 = pS;
      let p1 = pN;
      let tEm = tNow + n.x.w;
      let dv = p1 - p0;
      let len = length(dv);
      // (a body moves during the step — Miller at 0.3 c, the step longer than the distance to it up
      // close: its centre goes linearly from the step's start to its end, and the ray is met in the
      // body's frame, where it is still a straight segment: q0 → q1)
      var kC0 = vec3f(0.0);
      var kC1 = vec3f(0.0);
      // the nearest body hit in this step (and the stars' atmospheres in front of it); bodies smaller
      // than the pixel's footprint are spread over it (same flux: lensed images, Einstein rings and
      // magnification then come from the traced rays themselves)
      var tHit = 2.0;
      var kHit = 0u;
      for (var k = 0u; k < ourStart(); k++) {
        if (bodyWhere(k) != 0u) { continue; }
        let c0 = bodyCentre(k, tNow + s.x.w);
        let c1 = bodyCentre(k, tEm);
        let q0 = p0 - c0;
        let q1 = p1 - c1;
        let dq1 = q1 - q0;
        let R = bodyRadius(k);
        let u = clamp(-dot(q0, dq1) / max(dot(dq1, dq1), 1e-30), 0.0, 1.0);
        let c = mix(c0, c1, u);
        let rEff = footprint(travel + u * len);
        if (R < rEff) {
          let qc = q0 + u * dq1;
          let dq = length(qc);
          if (!radio && dq < rEff && u > 0.0 && u < 1.0 && !(probeNoStar && bodyKind(k) == 0u)) {
            let dW = backwardDir(n, L, a);
            let X = glowPoint(c, qc, rEff, R, dW);
            col += trans * compressPoint(shadeBody(k, X, c, bodyShift(k, n, L, E0), dW, tEm) * (R * R / (rEff * rEff)) * glowProfile(dq / rEff) * pointBoost(R / rEff));
          }
          continue;
        }
        let t = sphereHit(q0, q1, vec3f(0.0), R);
        if (!radio && bodyKind(k) == 0u && !probeNoStar && length(q1) < 4.0 * R) {
          // atmosphere in front of the photosphere (midpoint of the step, clipped at the surface)
          let frac = select(1.0, t, t >= 0.0);
          let pm = mix(p0, p1, 0.5 * frac) - mix(c0, c1, 0.5 * frac) + c;
          // local path length = (−p·u_ZAMO) dλ for p_t = −1
          col += trans * starGlow(k, pm, c, bodyShift(k, n, L, E0), tEm) * h * frac * zamoEnergy(n.x.x, n.x.y, a, L);
        }
        if (t >= 0.0 && t < tHit) {
          tHit = t;
          kHit = k;
          kC0 = c0;
          kC1 = c1;
        }
      }
      if (tHit <= 1.0) {
        let X = mix(p0, p1, tHit);
        let c = mix(kC0, kC1, tHit);
        // (lit and patterned at the moment the ray passes it)
        let tHitEm = tNow + mix(s.x.w, n.x.w, tHit);
        if (!radio && !(probeNoStar && bodyKind(kHit) == 0u)) { col += trans * shadeBody(kHit, X, c, bodyShift(kHit, n, L, E0), backwardDir(n, L, a), tHitEm); }
        trans = 0.0;
        fate = 3u;
        break;
      }
    }

    if (whOn) {
      // entering the gluing sphere of the far mouth → Dneg segment
      let p0 = pS;
      let p1 = pN;
      let tEm = tNow + n.x.w;
      let Cm = whCentre(tEm);
      let t = glueHit(p0, p1, Cm);
      if (t >= 0.0) {
        let dW = backwardDir(n, L, a);
        // far away the throat is smaller than a pixel: its light (our universe's, lit by our Sun) is
        // spread over the pixel's footprint around the line through its centre
        if (!radio) { col += trans * throatGlow(mix(p0, p1, t), dW, Cm, travel + t * length(p1 - p0), 1.0 / E0); }
        // an orbiting mouth: the photon in the mouth's rest frame (aberration, Doppler)
        let bo = boostPhoton(-dW, whVelocity(tEm));
        wn = normalize(worldToWh(mix(p0, p1, t) - Cm));
        wd = worldToWh(-bo.d);
        wl = P.wh2.w;
        eloc = E0 * zamoEnergy(n.x.x, n.x.y, a, L) * bo.e;
        whInR = length(mix(p0, p1, t));
        whInT = mix(s.x.w, n.x.w, t);
        seg = 1u;
        entered = true;
        break;
      }
    }
    // the distance the ray has come (flat map): the pixel's footprint on small bodies, the throat
    if (bodyCount() > 0u || whOn) { travel += length(pN - pS); }

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
      // (sampled at a random point of the step — a different one at each step and sample — so that
      // sharp structure along the ray, the smoke's outlines, is not sliced at the steps' spacing)
      var sm = n;
      let js = fract(rnd * 7.13 + f32(i) * 0.6180339887);
      sm.x = mix(s.x, n.x, js);
      sm.p = mix(s.p, n.p, js);
      let d = diskVolume(sm, L, E0, h, tNow);
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
      CROSSMIN = min(CROSSMIN, rMin);
      let rMax = max(s.x.x, n.x.x);
      if (diskOn && !thick && rMax >= rIn * 0.95 && rMin <= rOut * DISK_REACH * 1.05) {
        if (!adaptive) {
          // realtime: derivatives at both ends for the Hermite interpolant
          kCur = geodesicRHS(s.x, s.p, L, a);
          kNext = geodesicRHS(n.x, n.p, L, a);
          evals += 2u;
        }
        let m = equatorCrossing(s, n, kCur, kNext, L, a, h);
        evals += 9u;
        let rc = m.x.x;
        if (rc >= rIn && rc <= rOut * DISK_REACH) {
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

    if (rayDepth > 1e8 && trans < 0.5) { rayDepth = abs(n.x.w); }
    let r = n.x.x;
    RMIN = min(RMIN, r);
    if (r < rH + capTol || isNan(r)) { fate = 1u; break; }
    if (r > rEsc && r > s.x.x) { fate = 2u; s = n; break; }
    s = n;
    kCur = kNext;
    pS = pN;
  }
  // (a step that ended the ray on something opaque)
  if (rayDepth > 1e8 && trans < 0.5) { rayDepth = abs(s.x.w); }
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
      // does the outgoing ray run into the far mouth's gluing sphere? (where the mouth is when the
      // ray gets there: two fixed-point passes on the retarded time for an orbiting one)
      var Cm = whCentre(tNow + s.x.w);
      var hitIt = false;
      var X = x;
      var dist = 0.0;
      for (var it = 0u; it < 3u; it++) {
        let f = x - Cm;
        let B = dot(f, dir);
        let c = dot(f, f) - P.wh2.z * P.wh2.z;
        hitIt = c > 0.0 && B < 0.0 && B * B > c;
        if (!hitIt) { break; }
        dist = -B - sqrt(B * B - c);
        X = x + dist * dir;
        if (P.whC.w == 0.0) { break; }
        Cm = whCentre(tNow + s.x.w - dist);
      }
      if (hitIt) {
        if (!radio) { col += trans * throatGlow(X, dir, Cm, travel + dist, 1.0 / E0); }
        whInT = s.x.w - dist;
        let bo = boostPhoton(-dir, whVelocity(tNow + whInT));
        wn = normalize(worldToWh(X - Cm));
        wd = worldToWh(-bo.d);
        wl = P.wh2.w;
        eloc = E0 / sqrt(max(1.0 - 2.0 / length(X), 1e-3)) * bo.e; // weak field: static observer there
        whInR = length(X);
        seg = 1u;
        continue;
      }
    }
    // (bodies beyond the traced region — the K2 star, Edmunds — are drawn with the sky from here)
    skyOrg = vec4f(x, tNow + s.x.w);
    if (P.path.x > 1.5 && probeBeam == 0.0) { // (a drawing on the image: not a light for the probe)
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
      let u = P.bary.x * bodyVelocity(u32(max(P.bodyCfg.y, 0.0)), tNow + s.x.w);
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
  } // (HAS_KERR)

  col = colW + thr * col;
  out.tint = thr;
  if (fate == 2u) {
    var gBg = skyG;
    if (P.modes.y == SHIFT_NONE) { gBg = 1.0; }
    out.dir = skyDir;
    out.sky = skyId;
    out.org = skyOrg;
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
  out.depth = rayDepth;

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

// ---------------------------------------------------------------------------------------------
// The far field's LUT (scenes with only the hole and its disk: no bodies, jet, wormhole, flows): a ray
// every LUT_CELL pixels traced first; where four neighbours escaped to the sky untouched — no light
// gathered, nothing absorbed — clear of the photon sphere and of the disk's plane (RMIN, CROSSMIN), and the map from the image to
// the sky is smooth over their cell (its bilinear twist under a tenth of a pixel), the rays between them
// are not traced: their sky direction and shift are interpolated. The disk, its images, the photon ring
// and the shadow are always traced.
// ---------------------------------------------------------------------------------------------
const LUT_CELL = 8.0;
@group(1) @binding(0) var lutDirOut: texture_storage_2d<rgba32float, write>;
@group(1) @binding(1) var lutSkyOut: texture_storage_2d<r32float, write>;
@group(1) @binding(2) var lutDirIn: texture_2d<f32>;
@group(1) @binding(3) var lutSkyIn: texture_2d<f32>;

@compute @workgroup_size(8, 8)
fn lut(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(lutDirOut);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let pos = vec2f(gid.xy) * LUT_CELL;
  let ndc = vec2f(2.0 * pos.x / P.res.x - 1.0, 1.0 - 2.0 * pos.y / P.res.y);
  RMIN = 1e30;
  CROSSMIN = 1e30;
  let tr = trace(ndc, 0.5, P.time.x);
  // (clean: to the sky untouched — no light, nothing absorbed —, never near the photon sphere, through
  // the equator only well beyond the disk; its neighbours then cannot meet what it did not)
  let clean = tr.bgW > 0.999 && all(tr.col == vec3f(0.0)) && min(tr.tint.x, min(tr.tint.y, tr.tint.z)) > 0.999
    && RMIN > 6.0 && CROSSMIN > 1.5 * P.bh.w * DISK_REACH;
  textureStore(lutDirOut, gid.xy, vec4f(tr.dir, tr.gBg));
  // (1 + the sky's id where clean — 0: not)
  textureStore(lutSkyOut, gid.xy, vec4f(select(0.0, 1.0 + tr.sky, clean), 0.0, 0.0, 0.0));
}

/** A ray at pos (pixels) from the far field's LUT, when its cell's four corners are clean and smooth. */
fn farLut(pos: vec2f, out: ptr<function, TraceOut>) -> bool {
  let u = pos / LUT_CELL;
  let c0 = vec2i(floor(u));
  let dims = vec2i(textureDimensions(lutSkyIn));
  if (any(c0 < vec2i(0)) || any(c0 + 1 >= dims)) { return false; }
  let s00 = textureLoad(lutSkyIn, c0, 0).r;
  if (s00 <= 0.0 || textureLoad(lutSkyIn, c0 + vec2i(1, 0), 0).r != s00 || textureLoad(lutSkyIn, c0 + vec2i(0, 1), 0).r != s00
    || textureLoad(lutSkyIn, c0 + vec2i(1, 1), 0).r != s00) { return false; }
  let a = textureLoad(lutDirIn, c0, 0);
  let b = textureLoad(lutDirIn, c0 + vec2i(1, 0), 0);
  let c = textureLoad(lutDirIn, c0 + vec2i(0, 1), 0);
  let d = textureLoad(lutDirIn, c0 + vec2i(1, 1), 0);
  // (the bilinear patch's twist: the interpolation's error is a quarter of it at the centre — kept under
  // a tenth of a pixel)
  if (length(a.xyz - b.xyz - c.xyz + d.xyz) > 0.4 * P.camUp.w) { return false; }
  let f = u - floor(u);
  let m = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  var o: TraceOut;
  o.col = vec3f(0.0);
  o.bgW = 1.0;
  o.dir = normalize(m.xyz);
  o.gBg = m.w;
  o.qu = vec2f(0.0);
  o.sky = s00 - 1.0;
  o.tint = vec3f(1.0);
  o.org = vec4f(0.0);
  o.depth = 1e9;
  *out = o;
  return true;
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
    FOOT_NEAR = f32(block);
    FOOT_FAR = select(f32(block), 1.0, (flags & FLAG_REPROJECT) != 0u);
    FOOT = FOOT_NEAR;
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
    let variance = max(moments[idx].x / n - mean * mean, 0.0);
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
      // (the rays' first-step offset — the volumes' sampling —: blue noise in space, a golden-ratio walk
      // in time, not white noise)
      rnd = fract(ign(vec2f(f32(px), f32(py))) + f32(frameStamp % 1024u) * 0.6180339887);
    } else {
      // (R2 / Kronecker sequences per pixel, rotated by a hash — the first-step offset by blue noise)
      var rot = hash4(vec3u(px, py, 7u));
      rot.z = ign(vec2f(f32(px), f32(py)));
      let seq = fract(rot + si * vec4f(0.7548776662, 0.5698402910, 0.6180339887, 0.4142135624));
      if (si > 0.0 || accumulate) { jit = gaussJitter(seq.xy); }
      rnd = seq.z;
      // motion blur: sample time uniformly within the shutter interval
      tSample = P.time.x + (seq.w - 0.5) * P.ext.z;
    }
    pos = vec2f(f32(px) + 0.5, f32(py) + 0.5) + jit;
    let ndc = vec2f(2.0 * pos.x / P.res.x - 1.0, 1.0 - 2.0 * pos.y / P.res.y);
    if ((flags & FLAG_LUT) == 0u || !farLut(pos, &tr)) { tr = trace(ndc, rnd, tSample); }
  }
  wgDir[li] = vec4f(tr.dir, select(0.0, tr.sky, sampling && tr.bgW > 0.0));
  wgPos[li] = pos;
  workgroupBarrier();
  if (!sampling) { return; }

  var col = tr.col;
  if (tr.bgW > 0.0) {
    // pre-filter width relative to the lensed pixel (the jittered samples already apply σ = 0.42 px);
    // realtime, one ray a block: half the block — the gather's own σ — so a star smaller than the
    // rays' spacing is spread over it, not caught by one ray in b² and missed by the rest (strobing)
    var fp = skyFootprint(lid.xy, tr.dir, pos, tr.sky);
    let k = select(0.35, 0.5 * FOOT_FAR, interleaved);
    fp.jx *= k;
    fp.jy *= k;
    // (R8: realtime under the reprojection, the catalogue stars splatted where they fall rather than
    // caught by the block's ray — one frame in b², spread over the block by the gather: squares, strobing.
    // Where the image maps to the sky nearly as a plain camera does — the pixel's footprint within 1.5×
    // of the unlensed one both ways —: there the block's linear map holds; near the hole's critical
    // curves it does not — neighbouring blocks claimed the same star, a string of beads for an arc —, the
    // rays catch them as before and the history gathers the arcs)
    SPLAT = interleaved && P.camFwd.w > 0.0 && !(HAS_POL && P.pol.x > 0.5) && plainFootprint(fp, k);
    SPLAT_POS = pos;
    SPLAT_CELL = vec2f(gid.xy) * P.res.z;
    SPLAT_MUL = tr.bgW * tr.tint * P.time.z; // (× the sky's intensity, as backgroundSky has it)
    SPLAT_K = k;
    col += tr.bgW * tr.tint * background(tr.dir, tr.gBg, fp, tr.sky, tr.org);
    SPLAT = false;
  }
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }

  var qu = tr.qu;
  if (isNan(qu.x + qu.y)) { qu = vec2f(0.0); }
  let polOn = (HAS_POL && P.pol.x > 0.5);

  if (interleaved) {
    let old = accum[idx];
    if (temporal && stamps[idx] >= epoch && old.a > 0.0) {
      col = mix(old.rgb / old.a, col, P.ext.w);
      if (polOn) { qu = mix(polAcc[idx] / old.a, qu, P.ext.w); }
    }
    accum[idx] = vec4f(col, 1.0);
    if (polOn) { polAcc[idx] = qu; }
    moments[idx] = vec2f(0.0, tr.depth);
    stamps[idx] = frameStamp;
    return;
  }
  let l = luminance(col);
  if (accumulate) {
    let na = accum[idx].a + 1.0;
    accum[idx] += vec4f(col, 1.0);
    let m = moments[idx];
    moments[idx] = vec2f(m.x + l * l, mix(m.y, tr.depth, 1.0 / na));
    if (polOn) { polAcc[idx] += qu; }
  } else {
    accum[idx] = vec4f(col, 1.0);
    moments[idx] = vec2f(l * l, tr.depth);
    if (polOn) { polAcc[idx] = qu; }
  }
  stamps[idx] = frameStamp;
}

// ---------------------------------------------------------------------------------------------
// Light probe: the radiance reaching the camera from every direction, traced like the image, on an
// ENV_W × ENV_H equirectangular map of the camera's rest frame (axes P.envX, Y, Z;
// u = atan2(x, z), v = polar angle from +y). It lights the spaceship the camera is mounted on. The
// sky, and whatever is smaller than a texel (the Sun, a far disk's bright core), is pre-filtered over
// a texel: a jittered ray meeting or missing it would make the ship's light flicker. Each frame
// refreshes one texel of every 2×2 block — of every 4×4 when what it sees moves slowly (P.envCfg.y
// picks which; all of them after a reset, P.envCfg.z = 1). Texels keep a running mean over their last P.envCfg.w samples (alpha: count): long
// while what the probe sees holds still (its axes do not turn with the camera), short when it moves.
// ---------------------------------------------------------------------------------------------
const ENV_W = 256u;
const ENV_H = 128u;

// The key light: the near world's star (our Sun, or a star's planet on Gargantua's side), analytic.
// In the probe its disc is a blob three texels wide — no crisp highlight on the hull, no sharp shadow —
// and, a running mean of many frames, it lingered for seconds after the star had set behind the world.
// Here it is the star's irradiance at the camera, its disc's share above the world's limb (the penumbra:
// both discs' sizes), through the world's air (reddened low, dimmed by the clouds), shadowed by the
// relief round the camera (the ship landed in a valley at sunset). Written after the probe's texels
// (ship.ts reads it through the harmonics): direction (probe axes) and the disc's angular radius;
// irradiance, on (0/1).
fn keyLit() -> bool {
  if (!(HAS_BODIES && P.near0.w > 0.5 && P.near3.w < 0.5)) { return false; }
  let kn = u32(P.near1.w);
  return bodyKind(kn) != 0u && i32(bodies[BV * kn + 3u].x) >= 0;
}

// the relief between the camera and the key light (body axes, radii): the Earth's ground and the
// airless worlds' — as the ground's shadows are marched, measured from the ground under the camera when
// it stands on it (within 50 m: the march's coarser heights), from the camera itself when it flies
fn keyRelief(kn: u32, L: vec3f) -> f32 {
  let c = nearCam();
  let rc = length(c);
  let mR = P.near4.w;
  let surf = u32(bodies[BV * kn + 2u].z);
  if (isEarth(kn) && earthOn()) {
    let alt = (rc - 1.0) * EARTH_RM;
    if (alt > 9600.0) { return 1.0; }
    let g = earthHeightStep(c / rc, 2.0) - alt;
    let bias = select(0.0, g, abs(g) < 50.0);
    var t = 20.0;
    var sh = 1.0;
    for (var i = 0; i < 48; i++) {
      let x = c + L * (t / EARTH_RM);
      let r = length(x);
      let hr = (r - 1.0) * EARTH_RM;
      if (hr > 9600.0) { break; }
      let d = hr - earthHeightStep(x / r, max(0.05 * t, 2.0)) + bias + 0.005 * t;
      sh = min(sh, clamp(d / (0.04 * t) + 0.5, 0.0, 1.0));
      if (sh <= 0.0) { break; }
      t *= 1.18;
    }
    return sh;
  }
  if ((airless(surf) || hasDem(surf)) && (rc - 1.0) * mR < 2.0 * reliefTop(surf)) {
    RND = 0.5;
    return nearShadow(surf, c / rc, (rc - 1.0) * mR, L, 0.5, P.time.x * P.near5.w);
  }
  return 1.0;
}

fn keyLight() {
  let kn = u32(P.near1.w);
  let lt = nearLight(kn);
  let L = lt.dir;
  // (the star's angular radius: its irradiance factor is (R/D)²)
  let rs = asin(clamp(sqrt(max(bodies[BV * kn + 3u].y, 0.0)), 1e-5, 1.0));
  // the world's disc before it: the share of the star's above its limb
  let c = P.near0.xyz;
  let dc = length(c);
  let rb = asin(clamp(1.0 / dc, 0.0, 1.0));
  let sep = acos(clamp(dot(L, c / dc), -1.0, 1.0));
  let x = clamp((sep - rb) / rs, -1.0, 1.0);
  // (the area of a disc above a chord at x radii from its centre)
  var E = lt.e * (0.5 + (x * sqrt(1.0 - x * x) + asin(x)) / PI);
  if (hasAir(kn)) {
    setAir(kn);
    let rd = normalize(squashed(toBody(L), squashOf(kn)));
    let g1 = normalize(cross(rd, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(rd.z) > 0.9)));
    let e = earthLook(kn, nearCam(), rd, -1.0, rd, lt.e, g1, cross(rd, g1), 0.0, rs, 0.5, false);
    E *= e.T;
  }
  if (luminance(E) > 0.0) { E *= keyRelief(kn, normalize(squashed(toBody(L), squashOf(kn)))); }
  // (to the probe's axes: the transpose of envX…Z)
  let Lp = vec3f(dot(L, P.envX.xyz), dot(L, P.envY.xyz), dot(L, P.envZ.xyz));
  let n = ENV_W * ENV_H;
  envBuf[n] = vec4f(Lp, rs);
  envBuf[n + 1u] = vec4f(max(E, vec3f(0.0)), 1.0);
}

@compute @workgroup_size(8, 8)
fn env(@builtin(global_invocation_id) gid: vec3u) {
  let key = keyLit();
  // (the planets' probes run this kernel into their own buffer, the probe's texels alone: no key)
  if (all(gid.xy == vec2u(0u)) && arrayLength(&envBuf) >= ENV_W * ENV_H + 2u) {
    if (key) { keyLight(); } else { envBuf[ENV_W * ENV_H + 1u] = vec4f(0.0); }
  }
  probeNoStar = key;
  // (envCfg.z: 1 every texel; 0 one of each 2×2 block, 2 one of each 4×4 — envCfg.y picks which)
  var px = gid.xy;
  if (P.envCfg.z < 0.5 || P.envCfg.z > 1.5) {
    let st = select(2u, 4u, P.envCfg.z > 1.5);
    let q = u32(P.envCfg.y);
    px = gid.xy * st + vec2u(q % st, q / st);
  }
  if (px.x >= ENV_W || px.y >= ENV_H) { return; }
  physicalPoints = true;
  probeBeam = PI / f32(ENV_H);
  let h = hash4(vec3u(px, P.frame.x));
  let u = (f32(px.x) + h.x) / f32(ENV_W);
  let v = (f32(px.y) + h.y) / f32(ENV_H);
  let ph = (u - 0.5) * TAU;
  let th = v * PI;
  let dl = vec3f(sin(th) * sin(ph), cos(th), sin(th) * cos(ph));
  let look = normalize(dl.x * P.envX.xyz + dl.y * P.envY.xyz + dl.z * P.envZ.xyz);
  let phc = ((f32(px.x) + 0.5) / f32(ENV_W) - 0.5) * TAU;
  let thc = (f32(px.y) + 0.5) / f32(ENV_H) * PI;
  let dc = vec3f(sin(thc) * sin(phc), cos(thc), sin(thc) * cos(phc));
  probeShift = look - normalize(dc.x * P.envX.xyz + dc.y * P.envY.xyz + dc.z * P.envZ.xyz);
  // (the Earth near hides what lies beyond it: nothing traced there — the rays going under the ship,
  // half the probe in a low orbit, were traced across the solar system and thrown away)
  let kn = u32(P.near1.w);
  let nearOn = HAS_BODIES && P.near0.w > 0.5 && hasAir(kn);
  // (an airless world near, lit by its star: its ground — the sunlit ground's light on the hull, the
  // sky hidden behind it; a sphere at the probe's resolution)
  let solid = HAS_BODIES && P.near0.w > 0.5 && !nearOn && bodyKind(kn) != 0u && P.near3.w < 0.5;
  // (the Earth on its squashed axes: its ellipsoid — the ray's length there m times the camera's)
  let abn = select(1.0, squashOf(kn), nearOn);
  let rsn = squashed(toBody(look), abn);
  let mn = length(rsn);
  let t = select(-1.0, select(nearHit(look), unitHit(nearCam(), rsn / mn) / mn, nearOn), nearOn || solid);
  var col = vec3f(0.0);
  if (t <= 0.0) {
    let tr = traceLook(look, h.z, P.time.x);
    col = tr.col;
    if (tr.bgW > 0.0) {
      // footprint of a texel on the sky (along the lensed direction's tangents)
      let t1 = normalize(cross(tr.dir, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(tr.dir.z) > 0.9)));
      let t2 = cross(tr.dir, t1);
      let w = PI / f32(ENV_H);
      col += tr.bgW * tr.tint * background(tr.dir, tr.gBg, Footprint(t1 * w, t2 * w), tr.sky, tr.org);
    }
  }
  // the Earth near (the local patch, which traceLook leaves out): its ground, clouds and air around
  // the ship — the sun through the air, reddened low, hidden at night; the sky's blue; its glow
  if (nearOn) {
    setAir(kn);
    let rd = rsn / mn;
    let lt = nearLight(kn);
    let g1 = normalize(cross(rd, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(rd.z) > 0.9)));
    let e = earthLook(kn, nearCam(), rd, select(t, t * mn, t > 0.0), normalize(squashed(toBody(lt.dir), abn)), lt.e, g1, cross(rd, g1), 0.0, PI / f32(ENV_H), h.w, false);
    col = select(col * e.T + e.col, e.col, t > 0.0);
  } else if (solid && t > 0.0) {
    BODYW = mat3x3f(P.near1.xyz, P.near2.xyz, P.near3.xyz);
    let nc = normalize(look * t - P.near0.xyz);
    col = planetShade(kn, nc, toBody(nc), P.near4.xyz, -look, P.time.x, 1.0, ringShadow(kn, look * t - P.near0.xyz, P.near3.xyz, P.near4.xyz));
  }
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }
  col = min(col, vec3f(60000.0));
  let i = px.y * ENV_W + px.x;
  let old = envBuf[i];
  let n = select(min(old.a, P.envCfg.w - 1.0), 0.0, P.envCfg.x >= 1.0 || old.a <= 0.0);
  envBuf[i] = vec4f(mix(old.rgb, col, 1.0 / (n + 1.0)), n + 1.0);
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
