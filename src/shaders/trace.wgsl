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
  zamo2: vec4f,    // √(Σ/Δ), the aerial table's scale (the frame's pre-exposure: its half floats hold the image's
                   // range, not the raw radiance's — a night's air 2⁻⁴⁰ of a day's; 0: 1), unused ×2
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
  radio2: vec4f,   // jet radio brightness, flow H/R, disk smoke; w: the relief's ceiling round the camera [m] (0: 9 600 — earthTop)
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
  path: vec4f,     // camera free-fall path: point count, tube radius per unit ray length, fate (1 horizon, 2 escape); the bodies listed (+0.5; 0: all — listedBody)
  bary: vec4f,     // Gargantua orbits the centre of mass: q = m/(M + m) (0: no), relative orbit Ω; the auroras (S2:
                   // over the Earth — another scene's bodies never near it): their Kp (0: none), their clock [s, 0…900)
  water: vec4f,    // cinematic liquid throat: on (0/1), ripple strength, reflectance at normal incidence F0, clock [s]
  water2: vec4f,   // splash where the camera went through: centre (rep unit vector), clock at the crossing
  water3: vec4f,   // glow of the liquid, a pixel's footprint on the throat [rad]; zw: the listed bodies' indices (listedBody)
  water4: vec4f,   // absorption of the liquid per unit path (rgb, from its colour and density); w: listed bodies' indices
  water5: vec4f,   // colour of the glow (linear rgb); w: listed bodies' indices
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
  envX: vec4f,     // w: the clock's rate [game s / s] (the giants' eddies held when fast — giantTurb)
  envY: vec4f,
  envZ: vec4f,
  // the Earth (its maps loaded): on (0/1), the clouds' drift about its pole [rad], the city lights'
  // radiance (over the sunlit ground's scale), the relief's strength (its normal map)
  earth: vec4f,
  earth2: vec4f,   // the clouds' height [its radii], their opacity, the ground's albedo over its map, the air's
                   // thickness drawn (its scale heights × k)
  earth3: vec4f,   // the Moon: its direction on the Earth's axes; w: the sunlit share of its disk seen
  earth4: vec4f,   // the night sky's light (EARTH_NIGHT) over its value on the ground; y: the Sun's angular radius
                   // seen from the Earth [rad] (the eclipses); z: Mars's dust; w: the clouds a volume (the camera low)
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
  // longitude, the sine of its latitude, on (0/1) —; per level (z 6 … 14) the reference in its valid
  // rectangle [px], the rectangle's corner in its layer [px]; the rectangle's size [px], the level's
  // pixels per radian, on
  tiles: vec4f,
  tileL: array<vec4f, 24>,
  // the runways near the camera (src/game/sites.ts, at most RWY_MAX): [0].x their count; then each its
  // threshold's geodetic unit direction (w: its length [m]), its landing direction (w: its half width [m]),
  // its right, and the camera from its threshold on the Earth's squashed axes [m] (float64 on the CPU)
  // [17]: a clock for the flashing lights [s, wall time], how poor the visibility there is (0 … 1: the lights
  // at their brightest by day — PLAN-AEROPORTS A1)
  runways: array<vec4f, 18>,
  // the sea's resolved waves near the camera (renderer: seaParams; seaShade): [0] the wind's way at the
  // camera (the Earth's axes), its speed at 10 m; [1] across it, w: their weight (1 under 15 km, 0 above
  // 30); [2] the camera in that frame from an anchor of whole kilometres [m], the anchor in 256 m cells;
  // [3…14] twelve waves: their wavenumber (integers, units of 2π/1024 m: exact from the anchor), slope
  // amplitude, phase now
  sea: array<vec4f, 15>,
  // the near body's measured heights in its finer relief (hd-maps.ts: the Moon's LOLA, Mars's MOLA): on
  // (0/1), their highest and lowest [m] (the relief's shell), the body's radius [m]
  hd2: vec4f,
  // the sky seen through the Earth's air (PLAN-CIEL C3; trace.wgsl airBend): its refractivity at sea level
  // (n − 1, from the air's temperature; 0: no refraction) and at the camera, the Earth's radius and the
  // camera's distance from its centre in the density's scale heights
  sky: vec4f,
  // the shadows our bodies cast on one another (PLAN-CIEL C6, eclipse/shadows-gpu.ts; bodyShadow): three
  // pairs, each in the receiver's turning axes and radii — the occluder (centre, radius), the Sun (centre,
  // radius), (the receiver's index + 1 — 0: none —, the occluder's air bending light into its shadow, 0, 0)
  shade: array<vec4f, 9>,
  // the weather near the camera over the Earth (src/weather.ts, renderer: weatherParams; PLAN-METEO W3): [0]
  // its weight (0: the Earth's own clouds and air alone — the fair weather, and above 30 km), the haze's
  // extinction at the ground beyond the air's own [1/m], the fog's [1/m], its top [m above the sea];
  // [1…3] its cloud layers, the lowest first: base, top [m above the sea], cover (0: none), optical
  // thickness; [4] the ground's height there [m], the clouds' drift with the wind [m, the Earth's axes,
  // modulo the noise's period]; [5] the rain (PLAN-PLUIE P4): the ground's wetness (0…1), the rain now (0…1.3),
  // its clock [s] (held while the time is), unused; [6] a storm's lightning flash (N5, system/lightning.ts): its place from the
  // camera [m, the Earth's axes], its light now (0: none); [7] the ground under it [m], to the ground (1) or in the cloud (0),
  // its seed, its light's reach in the cloud [m]
  wx: array<vec4f, 8>,
  // regional Sentinel-2 / WorldCover: bounds and residency, page grid and gutter, materials and metre scale
  surface: array<vec4f, 7>,
  scenery: array<vec4f, 6>,
  walk: array<vec4f,5>, // camera-relative shared walking heightfield, in the existing table buffer
  // the ships' wakes near the camera (renderer: wakeParams; seaWake): [0] their count; then two each — the ship
  // from the camera on the Earth's axes [m] and its length [m]; its bow's way (its length its beam [m]) and its
  // speed [m/s]
  wake: array<vec4f, 17>,
  // the sea's FFT waves (renderer: seaFftParams; sea/fft-gpu.ts; seaWavesFft): [0] on, choppiness, the height's
  // standard deviation [m], unused; [1] the cascades' periods [m], N; [2] the slopes' variance finer than the
  // cascades (along the wind, across it: Cox–Munk's share the cascades leave), unused ×2; [3] the nearest
  // carrier's sphere in the ship's shadow map (shipShadow: its right half), w its radius (0: none)
  seafft: array<vec4f, 4>,
  // the mountains' warp precomputed (system/warp-grid.ts; earthWarp): [0] the reference — the camera's place —
  // (cos, sin of its longitude, sin, cos of its geodetic latitude); [1…3] each level's window: the reference's place
  // on it in nodes (u east, v north), nodes a radian, on (0/1)
  warp: array<vec4f, 4>,
  // our universe's bodies a ray leaving the mouth's region may meet (renderer: the mouth's list; ourSegment): [0] their
  // indices, 6 bits each, 4 a value (as path.w's list); [1].x their count + 0.5 (0: every body),
  // [1].w: experimental terrestrial height-cache lookup allowed in this realtime frame (0 otherwise)
  mouthList: array<vec4f, 2>,
};

// Pipeline specialisation: the error-controlled integrator is compiled only into the quality
// pipeline, keeping the realtime kernel small (register pressure / occupancy).
override QUALITY_PIPELINE: bool = false;
// Experimental surface cache, compiled out of default and scientific/reference kernels.
override HAS_TERRAIN_CACHE: bool = false;
override HAS_TERRAIN_RASTER: bool = false; // the raster patch's distances (system/terrain-raster-hint.ts): the ground march starts from them
// the near ground's sub-pixel detail (the relief's procedural detail under the map's cell, the scenery's traced trees,
// buildings and their shadows, the sea's waves in relief, the near world mirrored in the sea): off in the raster's
// companion kernels — the raster draws the near ground; the trace draws the sky, the far ground beyond the raster's rings
// (sub-pixel there) and, while the raster's kernels compile, a coarser ground (docs/PLAN-LEAN-TRACER-KERNELS.md P4)
override NEAR_DETAIL: bool = true;
// the relief's procedural detail under the map's cell (earthDetail) alone: off in the raster's leftovers' kernel (shade, the
// material on — renderer.rasterLite): its ground's heights are the terrain cache's, which has it; its marches' steps and the
// relief's shadows then the map's — half its size gone, the scenery's trees and buildings kept
override GROUND_DETAIL: bool = true;
// the body near the camera, for the camera's rays (main, discs): 0 any — both paths —, 1 the Earth, 2 another world with
// air (Mars), 3 a world without air (the Moon, Gargantua's worlds), 4 none, 5 Titan (an air world — 2's paths — whose relief
// is procedural: titanRelief, out of the others' kernels and theirs out of its own — PLAN-PLANETES-AAA P8), 6 Venus (2's paths
// and its cloud deck's slab: AIR_SLAB, out of Mars's and Titan's kernels). The other paths compiled out: the Earth's
// near ground in a Moon scene, the airless worlds' relief in an Earth flight (docs/PLAN-LEAN-TRACER-KERNELS.md P7)
override NEAR_KIND: u32 = 0u;
// (the near body is the Earth — as far as the constants allow: the Earth's own near code out of the other worlds' kernels)
fn nearEarth(k: u32) -> bool { return NEAR_KIND != 2u && NEAR_KIND != 3u && NEAR_KIND != 4u && NEAR_KIND != 5u && NEAR_KIND != 6u && NEAR_KIND != 7u && isEarth(k); }
// (another world with air near: Mars's kind or Titan's — conjunctions, which wgsl-specialise.ts folds: a top-level || it
// leaves alone)
fn nearAirWorld() -> bool { return NEAR_KIND != 0u && NEAR_KIND != 1u && NEAR_KIND != 3u && NEAR_KIND != 4u && NEAR_KIND != 7u; }
// (Venus's cloud slab in this kernel: its own, and those for any near body — not Mars's nor Titan's: register-bound, it cost
// them 4–8 % unused)
fn venusKernel() -> bool { return NEAR_KIND != 1u && NEAR_KIND != 2u && NEAR_KIND != 3u && NEAR_KIND != 4u && NEAR_KIND != 5u && NEAR_KIND != 7u; }
// (an air world whose heights are measured — Mars's kind, Venus's —: its relief marched, its shadows)
fn marsLike() -> bool { return NEAR_KIND != 0u && NEAR_KIND != 1u && NEAR_KIND != 3u && NEAR_KIND != 4u && NEAR_KIND != 5u && NEAR_KIND != 7u; }
// (Titan's relief in this kernel: its own, and those for any near body — the probes', the body raster's library)
fn titanKernel() -> bool { return NEAR_KIND != 1u && NEAR_KIND != 2u && NEAR_KIND != 3u && NEAR_KIND != 4u && NEAR_KIND != 7u; }

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
override HAS_SHADE: bool = true;  // a body's shadow falling on another now (P.shade, PLAN-CIEL C6: out of the kernel when none)
override HAS_SCENERY: bool = true;
override HAS_SURFACE: bool = true;
override HAS_WX: bool = true;     // the weather near the camera (P.wx: its haze, fog, layers — out of the kernel in fair weather)
override HAS_AURORA: bool = true; // the auroras over the Earth (P.bary.zw, S2: out of the kernel when none asked)
// the hole's and the mouth's metrics (O13): off in our universe from afar — the camera beyond the mouth's
// Dneg region, the region under a pixel —, every ray straight through our bodies to our sky, the Kerr and
// Dneg integrators out of the kernel (its registers)
override HAS_KERR: bool = true;
// The cost view (renderer.costView, a debug view: docs/BH-API.md): 0 off — the counters below out of the kernel —;
// 1 every ray's work, 2 … 13 one kind of it alone (cost's k + 2), as a heat map — its counts on a log scale,
// blue few … red many — in place of the image.
override COST_VIEW: u32 = 0u;
// Debug tuning (renderer.tune, a kernel variant of its own: what a loop's count costs and shows): the air's
// samples along a ray (earthAir), the relief's shadow steps and their growth (earthTerrainShadow — the same reach:
// 1.18⁴⁸ ≈ 2 800 × the first step)
override TUNE_AIR_N: u32 = 32u;
// the imagery's anisotropic taps at most (earthImageryAniso: 1 the isotropic read, on the footprint's long axis)
override TUNE_ANISO: u32 = 4u;
// (measures — shadeLite's parts left out: 1 the OSM water, 2 the scenery's shadow maps, 4 the relief's shadow map, 8 the
// regional surface, 16 the mesh's normal (the ellipsoid's), 32 the clouds' shadows, 64 the trees' test, 128 the imagery;
// 256 the trees' grid walked on a miss — off by default; 512 the water's cover drawn red)
override TUNE_LITE: u32 = 0u;
// (TUNE_LITE's bits at run time too — renderer.liteSkip, P.jet2.w (unused there) —: a part of the raster's material cut
// without compiling every kernel again, to measure it — TERRE-UNREAL U6)
fn liteSkip() -> u32 { return TUNE_LITE | u32(max(P.jet2.w, 0.0) + 0.5); }
override TUNE_SHADOW_N: u32 = 48u;
override TUNE_SHADOW_K: f32 = 1.18;
// (the relief's shadow march's reach [m]: beyond it, the ground is taken as lit — a measure of what its far steps cost)
override TUNE_SHADOW_FAR: f32 = 1e9;
// (the relief's shadows: a step at least this share of the ray's clearance over the ground — 0: the growth alone)
override TUNE_SHADOW_RELAX: f32 = 0.3;
// (the realtime geodesics' tolerance far from the hole: × this beyond 20 M, × 1 within 10 M — the photon sphere's rays
// exact; the far field nearly flat: at 3 the images alike to a comparison's own noise, Kerr edge-on's trace −21 %)
override TUNE_EPS_FAR: f32 = 3.0;
// (the realtime steps through the disk's smoke [M]: 0.5 — sampled at a random point of each, a different one each frame,
// the history gathering them: the held image alike to 0.25's, the turning one 29.4 dB against the converged one for
// 29.7; Interstellar's trace −22 %. The refining passes keep 0.1)
override TUNE_SMOKE_STEP: f32 = 0.5;
// (0: the per-step tests of Gargantua's bodies skipped — a measure of what they cost: the bodies then missed)
override TUNE_STEP_BODIES: u32 = 1u;
// (the ground's march: a step's share of the clearance — 0.5, safe for slopes to ~60°; more: a measure)
override TUNE_MARCH_K: f32 = 0.5;
// (a ray rising over the ground — its clearance growing —: its steps' share of the distance (5 %: the shell left in ~150 steps;
// a butte's narrow top, Monument Valley's Mittens, stepped through in bands of sky)
override TUNE_RISE: f32 = 0.05;
// (the relief march's steps at most — 256; a ray out of them still rising is the sky's: one grazing a butte's rounded top
// after its long way over the plain ran out of them, in bands)
override TUNE_MARCH_N: u32 = 256u;
// (the march's longest step: TUNE_STEP_CAP_M [m] or TUNE_STEP_CAP_K of the distance, the longer; 0: none)
override TUNE_STEP_CAP_M: f32 = 0.0;
override TUNE_STEP_CAP_K: f32 = 0.03;
// (the ground's march over-relaxed — Keinert et al. 2014: a step this many times the safe one tried on the way in,
// taken back to the safe one when the next point's clearance shows the two safe reaches leave a gap; 1: none)
override TUNE_RELAX: f32 = 1.6;
// (the same within the margin of the ground — the full heights —: 1 none)
override TUNE_RELAX_BAND: f32 = 1.6;
// (measures of the ground's detail, the image then other: 0 its mountains' warp off)
override TUNE_WARP: u32 = 1u;
// (measures, the image then other — what a block of a sky ray costs: 1 the background (sky and far points), 2 the far
// points alone, 4 ourSegment — 32 its bodies met, 64 its rings, 128 its worlds' air, 256 the corona, 512 the stars'
// discs —, 16 the whole ray past the near world; the Kerr loop's 1024 weak fields' kick, 2048 thick disk, 4096 the
// equatorial crossings; 8192 the Earth's ground shaded flat)
override TUNE_SKIP: u32 = 0u;
// (TERRE-UNREAL U9 — the sky's discs' own kernel: main's layers z ≥ 1 alone (its z = 0 the sky's, returned), without the
// ground's march, its scenery, its sea, its shading — the discs' rays never meet the ground the raster draws (left to it,
// its pixels skipped by the raster's hint) —: the kernel's registers, the Apple GPU's limit, those of the sky's rays)
override DISC_ONLY: bool = false;
// (1: the wormhole's steps on our side merged into straight pieces for ourSegment while the ray holds straight to a
// quarter of its pixel; 0: each step's chord on its own, as before)
override TUNE_MERGE: u32 = 1u;
// (0: the ground's detail off altogether — a measure)
override TUNE_DETAIL: u32 = 1u;
// (1: the tiles' heights always bilinear, never their cubic B-spline — a measure)
override TUNE_CHEAP: u32 = 0u;
// (the relief's tiles magnified: 0 a cubic B-spline over their texels — a butte's wall spread over three of them, its top
// lowered —, 1 an interpolating one — Catmull–Rom: lips over the cliffs —, 2 a monotone one through them, the default and the
// CPU's — earth-tiles.ts sampleLevel)
override TUNE_TILE_CR: u32 = 2u;
// (the camera rays' crowns carved by their leaves within this many metres — forestQuery's detail; 0: the plain shapes, a
// measure of what the carving's sphere tracing costs)
override TUNE_FOREST_DETAIL: f32 = 220.0;
// (the raster's shaded sample's footprint [px]: 0 the square it stands for — √ of its shading rate: 2 at one pixel in 2 × 2,
// its detail filtered to the area it is spread over —; 1 a pixel's own, a measure)
override TUNE_RASTER_FOOT: f32 = 0.0;
// (1: the raster's pixels shade drew coloured by the way their scenery was found — red the tree the instance named, hit;
// blue that tree missed, the grid walked; green no instance, no walk; white the walk as before (no raster scenery) — a measure)
override TUNE_RASTER_PATHS: u32 = 0u;
var<private> RASTER_PATH: u32 = 0u;
// (TUNE_RASTER_PATHS 2: the raster's pixels by how their ground was found — red the hint's bracket refined, green the march
// over the grazing window before it, blue the whole march, the hint not bracketing; their light kept as shading)
var<private> HINT_PATH: u32 = 0u;
// (the raster hint's grazing limit: a ray lower than this sine over the ground below the hint is marched as before — 0: never,
// a measure of what the grazing rays' marches cost, the thin ridges then missed)
override TUNE_HINT_GRAZE: f32 = 0.15;
// (a grazing ray marched over a window before the hint only — earthMarchHinted —; 0: from the camera, as before)
override TUNE_GRAZE_WINDOW: f32 = 1.0;
// (the cloud pass's light marched through the clouds — 1; 0: the column of their cover, as the pixels' own marches have it)
override TUNE_CLOUD_LIGHT: u32 = 1u;
// (the raster hint's refinement: its Illinois steps at most — 10; fewer, a measure of what they cost)
override TUNE_HINT_ITER: u32 = 10u;
// (the far rings' hints — the relief's cache a level coarser each, its cells four times wider: their error over the near
// patch's this many times a level — the bands the hint is trusted within widened as much)
override TUNE_RING_TOL: f32 = 2.5;
// (the far rings' pixels shaded at the raster's rate over this — 2: one cycle of its pattern in two, as sparse as the sky's
// rays at ×4 that found that ground before; 1: as the patch's)
override TUNE_RING_RATE: u32 = 2u;
// (1: Gargantua's bodies far from a step rejected before their place at its end — 0: each worked out, a measure)
override TUNE_BODY_REJECT: u32 = 1u;
// (measures — the Earth's ground shading, a part of it left out: 1 the relief's own normal near, 2 its shadows, 4 the
// near materials (snow, rock), 8 the fine noise's colour and light, 16 the clouds' and the weather's shadows, 32 the
// tiles' imagery, 64 the surface textures, 128 the sea's shading, 256 the scenery's surfaces)
override TUNE_GSKIP: u32 = 0u;
// (the scenery's parts left out, to measure them — tests/e2e/raster-shade-ablation: 1 the camera ray's buildings, 2 the trees'
// look, 4 the OSM surfaces under the ground; 8 the buildings' raster boxes ignored — every ray its BVH, as before)
override TUNE_SC_SKIP: u32 = 0u;
// (the ray's work by kind: 0 the ground's march steps (the Earth's, a world's), 1 the ground's heights read (earthH,
// relief), 2 its shadows' steps, 3 the clouds' steps (the volume's, the weather's), 4 the air's (the auroras'), 5 the
// water's (the sea's surface search, the mirror's march), 6 the scenery's boxes visited, 7 the geodesic integrator's
// tries (adaptiveDOPRI), 8 the noise's octaves (the disk's, the clouds', the relief's), 9 the sky's stars looked at, 10
// the bodies tested along the ray, 11 the main loop's steps (and the wormhole's, the returning light's))
var<private> COST: array<f32, 12>;
fn cost(k: u32) { if (COST_VIEW > 0u) { COST[k] += 1.0; } }
fn costHeat() -> vec3f {
  // (the raw counts, for a readback — renderer.costStats —: 14 the ground's march steps, heights read, shadow steps;
  // 15 the main loop's steps, the bodies tested, the integrator's tries)
  if (COST_VIEW == 14u) { return vec3f(COST[0], COST[1], COST[2]); }
  if (COST_VIEW == 15u) { return vec3f(COST[11], COST[10], COST[7]); }
  // (each kind weighed by what a step of it costs, roughly: a height read the unit)
  let w = array<f32, 12>(0.5, 1.0, 0.5, 3.0, 1.0, 2.0, 0.3, 1.5, 0.3, 0.2, 0.2, 0.5);
  var n = 0.0;
  var top = 2048.0;
  if (COST_VIEW == 1u) {
    for (var k = 0u; k < 12u; k++) { n += COST[k] * w[k]; }
  } else {
    n = COST[min(COST_VIEW - 2u, 11u)];
    top = 512.0;
  }
  let x = clamp(log2(1.0 + n) / log2(1.0 + top), 0.0, 1.0);
  // (black none, blue, cyan, green, yellow, red, white beyond)
  let c = array<vec3f, 6>(vec3f(0.0, 0.0, 0.25), vec3f(0.0, 0.3, 1.0), vec3f(0.0, 0.9, 0.9), vec3f(0.1, 0.9, 0.1),
    vec3f(1.0, 0.9, 0.0), vec3f(1.0, 0.1, 0.0));
  let f = x * 5.0;
  let i = min(u32(f), 4u);
  return mix(c[i], c[i + 1u], f - f32(i));
}

const FLAG_ADAPTIVE_RK = 1u;    // step-doubling error control + Richardson extrapolation
const FLAG_ADAPTIVE_SPP = 2u;   // skip converged pixels (progressive / offline)
const FLAG_TEMPORAL = 4u;       // temporal accumulation of realtime samples
const FLAG_INTERLEAVED = 8u;    // realtime pass: one pixel per block, rotating offset
const FLAG_AERIAL = 64u;        // the aerial perspective's table is there: the camera's rays near a world with air read it (earthLook)
const FLAG_LUT = 32u;           // the far field's LUT is there: rays between clean samples read it (main: farLut)
const FLAG_REPROJECT = 16u;     // realtime under the temporal reprojection: the frames' rays accumulate —
                                // each prefiltered over its pixel (the history supplies the coverage)

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4f>;
@group(0) @binding(3) var bgTex: texture_2d<f32>;
@group(0) @binding(4) var bgSamp: sampler;
@group(0) @binding(5) var<storage, read_write> moments: array<vec2f>; // Σ luminance², depth (the samples' nearest) per pixel
@group(0) @binding(6) var<storage, read_write> stamps: array<u32>;  // frame of the last sample
// the catalogue stars of a realtime frame, splatted where they fall (R8): 3 × u32 per pixel, fixed point
// (radiance × P.camFwd.w — the pre-exposure × 2¹⁶), cleared before the frame (post.wgsl: stars)
@group(0) @binding(7) var<storage, read_write> starSplat: array<atomic<u32>>;
@group(0) @binding(8) var mwTex: texture_2d<f32>;      // Gaia DR2 Milky Way (linear, mip-mapped)
@group(0) @binding(9) var starLodTex: texture_2d<f32>; // catalogue radiance map (large footprints)
// Star catalogue: [magic, grid, count, 0, cellStart[6·grid² + 1], stars (x, y, z, mag|T packed)]
@group(0) @binding(10) var<storage, read> catalogue: array<u32>;
@group(0) @binding(11) var<storage, read_write> polAcc: array<vec2f>; // Σ Stokes Q, U (luminance)
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
// One buffer for the read-only tables (PLAN-MONDE M9: the stage within WebGPU's default 8 storage buffers,
// Android's and Safari's): the bodies [0, SH_BASE), the light probe's harmonics [SH_BASE, LUT_OFF), the
// blackbody's colours (LUT_N) then the synchrotron's (SYNC_N) from LUT_OFF, the camera's path from PATH_OFF
// — 256 points (xyz, fraction along the path), then the bounding spheres of chunks of 16 segments
// (renderer.ts: TABLE_*, the same offsets)
@group(0) @binding(15) var<storage, read> bodies: array<vec4f>;
const BV = 6u; // vec4s per body (src/system/scene-bodies.ts: BODY_VEC4)
const LUT_OFF = 250u; // SH_BASE + 10 harmonics
const PATH_OFF = 1786u; // LUT_OFF + LUT_N + SYNC_N
// the mountains' warp's grids (system/warp-grid.ts: TABLE_WARP — after the walking grid), their levels and nodes a side
const WARP_OFF = 3115u;
// the clear sky's light, physical (gpu-tables.ts TABLE_SKY; kernel skyAmbient writes it, skyIrradiance reads it)
const SKY_OFF = 822856u;
// the geoid's map (gpu-tables.ts TABLE_GEOID, system/geoid-grid.ts): N [m], GEOID_W × GEOID_H nodes, four a vec4
const GEOID_OFF = 822968u;
// Saturn's rings' optical depth every kilometre (gpu-tables.ts TABLE_RING, system/ring-profile.ts — Cassini's): RING_N values
// from RING_R0_KM, four a vec4, −1 where none
const RING_OFF = 1082182u;
const RING_N = 71100u;
const RING_R0_KM = 69800.0;
// the giants' zonal winds (gpu-tables.ts TABLE_WIND, system/giant-winds.ts): 146 values, four a vec4
const WIND_OFF = 1099957u;
const GEOID_W = 1440u;
const GEOID_H = 720u;
// the orthophotos' levels (gpu-tables.ts TABLE_ORTHO, system/earth-tiles.ts orthoParams): three vec4s each
const ORTHO_OFF = 1082168u;
const ORTHO_LEVELS = 4u;
const WARP_LEVELS = 3u;
const WARP_N = 512u;
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
    cost(8u);
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
  return mix(bodies[LUT_OFF + i0], bodies[LUT_OFF + i1], fract(x));
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
  return mix(bodies[LUT_OFF + o + i0].rgb, bodies[LUT_OFF + o + i1].rgb, fract(x));
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
    cost(7u);
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
  // (the realtime passes only: the refining and offline ones keep their tolerance all the way)
  let far = select(1.0, TUNE_EPS_FAR, (P.frame.z & FLAG_INTERLEAVED) != 0u);
  let ef = eps * (1.0 + (far - 1.0) * clamp((r - 10.0) / 10.0, 0.0, 1.0));
  var h = ef * (r - rH) * (1.0 + 0.01 * r);
  h = min(h, ef * sig * sn * sn / (abs(L) + 1e-3));
  h = min(h, ef * sig * max(sn, 0.02) / (abs(s.p.y) + 1e-3));
  let hr = P.ext2.z;
  if (HAS_THICK && hr > 0.0 && P.modes.w == 1u) {
    // volumetric disk: never jump over the layer |z| < 4H (8H with its haze; the smoke's, ~0.5 M above
    // the surface, beyond 8 M), sample it at
    // ≲ 0.4 H across; along it ≲ 0.08 R — ≲ 0.1 M through the smoke (clouds an M across: their
    // outlines drawn, not averaged away, nor stepped — each step only partly opaque; 0.5 M (TUNE_SMOKE_STEP) in the
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
        if (P.radio2.z > 0.0 && R > 8.0) { h = min(h, select(0.1, TUNE_SMOKE_STEP, (P.frame.z & FLAG_INTERLEAVED) != 0u)); }
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
  if (nb > 0u && TUNE_STEP_BODIES > 0u) {
    // never step over a body (nor a star's atmosphere, 3 R); sample a star finely near the limb (the
    // traced ones only: those met on the rays' straight way out — K2, Edmunds, 2 000 AU off — do not
    // bound the steps)
    for (var k = 0u; k < nb; k++) {
      cost(10u);
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
    let sph = bodies[PATH_OFF + PATH_MAX + c];
    let w = sph.xyz - p0;
    let u = clamp(dot(w, dv) / (len * len), 0.0, 1.0);
    let dc = length(w - u * dv);
    if (dc > sph.w + R) { continue; }
    let i0 = c * PATH_CHUNK;
    let i1 = min(n - 1u, i0 + PATH_CHUNK);
    for (var i = i0; i < i1; i++) {
      let a = bodies[PATH_OFF + i];
      let b = bodies[PATH_OFF + i + 1u];
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
// the sea's depth under the point shaded [m] (earthGround: ETOPO's height, negative at sea)
// (the sea's depth under the pixel [m] and how sure — earthGround: seaDepthAt, the near tiles' bathymetry; 0: deep assumed)
var<private> SEA_DEPTH: f32 = 1e4;
var<private> SEA_DEPTH_W: f32 = 0.0;
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
// A world's map at uv: its finer one when the camera is near (its level from the footprint), else its coarse one
fn planetMapAt(m: u32, uv: vec2f) -> vec3f {
  if (i32(m) == i32(P.hd.x)) { return textureSampleLevel(hdColor, bgSamp, uv, hdMapLod(P.hd.w)).rgb; }
  if (m < MAPS_HI) { return textureSampleLevel(mapHi, bgSamp, uv, i32(m), mapLod()).rgb; }
  return textureSampleLevel(mapLo, bgSamp, uv, i32(m - MAPS_HI), max(mapLod() - 1.0, 0.0)).rgb;
}
// The giants' clouds moving (PLAN-PLANETES-AAA P9 G1, G2, G8): each latitude's band carried east by its zonal wind —
// Cassini's profiles, approximated every 2.5° (Jupiter's alternating jets, 170 m/s at 24° N; Saturn's equatorial jet, 450
// m/s), System III —, read in two phases of GIANT_CYCLE seconds half a cycle apart and faded (the map not sheared without
// end); Jupiter's Great Red Spot turning on itself (an anticyclone: anticlockwise in the south, ~6 days at its edge, its core
// slower); and below the map's texel, the turbulence tile (system/giant-tile.ts: a β-plane flow baked into the noise
// texture's second half, its frames in time) — its displacement moving the map's reading by a few texels, its dye adding the
// contrast the map has not there — at two scales, each renewed by its own two phases (Neyret's advected textures: never
// stretched without end), its strength the wind's shear (the jets' flanks roll up, their cores keep smooth). All a function of
// the time alone: the same date, the same clouds.
const GIANT_CYCLE = 36000.0;
const GTILE_Z0 = 131.0;
const GTILE_FRAMES = 128.0;
// Jupiter's or Saturn's albedo at nrm (its axes) moving: two readings of giantFlow half a cycle apart, faded (in one loop:
// every call site is a copy the compiler builds); b2y its albedo's scale
fn giantAlbedo(m: u32, nrm: vec3f, tEm: f32, b2y: f32) -> vec3f {
  let lon = atan2(nrm.y, nrm.x);
  let lat = asin(clamp(nrm.z, -1.0, 1.0));
  let tS = tEm * P.near5.w;
  let ph = fract(tS / GIANT_CYCLE);
  let wind = giantWind(m, lat);
  // (the tile under the map's texel only, as the pixel's footprint resolves it: never from orbit. The footprint the
  // pixel's own — mapLodV unclamped: mapLod() stops at the coarse map's texel, 220 km on Jupiter, above the finer map's)
  let texA = TAU / select(f32(textureDimensions(mapHi).x), P.hd.w, i32(m) == i32(P.hd.x));
  let fpA = exp2(mapLodV) * TAU / 2048.0;
  let wd = clamp(log2(texA / max(fpA, 1e-9)) * 0.5, 0.0, 1.0);
  var t = vec3f(0.0);
  for (var j = 0u; j < 2u; j++) {
    let w = select(1.0 - abs(2.0 * ph - 1.0), abs(2.0 * ph - 1.0), j == 1u);
    let tau = fract(ph + 0.5 * f32(j)) * GIANT_CYCLE;
    let ll = giantFlow(m, lon, lat, tau, wind.x, tS);
    var uv = vec2f(0.5 + ll.x / TAU, 0.5 - ll.y / PI);
    var c = 1.0;
    if (wd > 0.0) {
      // (a named vortex's slow core calm: its collar's shear keeps the tile)
      let d = giantTurb(ll.xy, tS, j, texA, fpA, wind.y) * wd * (1.0 - 0.7 * ll.z);
      uv += d.xy;
      c = 1.0 + d.z;
    }
    t += w * c * planetMapAt(m, uv);
  }
  // (Saturn's north pole: the hexagon's jet a darker lane, the polar cyclone's eye and its bright ring — the map has none)
  if (m == 5u && lat > 1.13) {
    let rho = 1.5707963 - lat;
    t *= 1.0 - 0.22 * exp(-sq((rho - saturnHexRho(lon, tS)) / 0.016)) * smoothstep(1.13, 1.2, lat);
    t *= (1.0 - 0.35 * exp(-sq(rho / 0.0175))) * (1.0 + 0.12 * exp(-sq((rho - 0.035) / 0.01)));
  }
  return min(t * b2y * select(1.0, P.hd.y, i32(m) == i32(P.hd.x)), vec3f(0.95));
}
// Saturn's hexagon (Cassini, Sánchez-Lavega et al. 2014): a Rossby wave of number 6 on the jet near 76° N planetocentric,
// fixed in System III but for its drift (+0.0128°/day, 2008–2014): its colatitude at longitude lon [rad] — the vertices at
// HEX_RHO, the edges' middles nearer the pole
const HEX_RHO = 0.2443;
fn saturnHexRho(lon: f32, tS: f32) -> f32 {
  let th = lon - 2.234e-4 * tS / 86400.0;
  let a = th - 1.0471976 * floor(th / 1.0471976) - 0.5235988;
  return HEX_RHO * 0.8660254 / cos(a);
}
// the zonal wind at lat [m/s] and its shear (its change over 2.5° of latitude, smooth): Cassini's profiles every 2.5°, from
// the tracer's tables (gpu-tables.ts TABLE_WIND — a constant array indexed at run time is copied to every call's stack)
fn giantWind(m: u32, lat: f32) -> vec2f {
  let x = clamp((lat * 57.2957795 + 90.0) / 2.5, 0.0, 71.999);
  let i = u32(x) + select(73u, 0u, m == 4u);
  // (the shear at the nodes — central differences —, interpolated: no step at the table's 2.5°)
  var a: array<f32, 4>;
  for (var n = 0u; n < 4u; n++) {
    let k = clamp(i + n, 1u, 146u) - 1u;
    a[n] = bodies[WIND_OFF + (k >> 2u)][k & 3u];
  }
  return vec2f(mix(a[1], a[2], x - floor(x)), mix(0.5 * (a[2] - a[0]), 0.5 * (a[3] - a[1]), x - floor(x)));
}
// the matter at lon0, lat now (the time tS [s]): where it was τ seconds ago — carried by the zonal wind u [m/s], or turned
// by a named vortex (G8c) — its longitude and latitude; z: in a vortex's slow core (0…1)
fn giantFlow(m: u32, lon0: f32, lat: f32, tau: f32, u: f32, tS: f32) -> vec3f {
  let R = select(60268e3, 71492e3, m == 4u);
  var ll = vec2f(lon0 - u * tau / (R * max(cos(lat), 0.05)), lat);
  var core = 0.0;
  if (m == 4u) {
    // (the Great Red Spot, 22° S 126.4° E in the map, 18° × 10.5°: its high-speed ring ~180 m/s — Wong et al. 2021, HST
    // 2009–2020 —, ~3.4 days round; the Oval BA, 32.1° S 57.7° W, 8.4° × 8°: 135 m/s at its rim — Hueso et al. 2009.
    // Anticyclones: anticlockwise in the south. Their drift in System III a few m/s: none over a phase)
    let V = array<vec4f, 2>(vec4f(2.2066, -0.384, 0.157, 0.0916), vec4f(-1.0071, -0.5603, 0.0733, 0.0698));
    for (var i = 0u; i < 2u; i++) {
      let a = giantVortex(lon0, lat, tau, V[i].xy, V[i].zw, select(135.0, 180.0, i == 0u), R);
      ll = mix(ll, a.xy, a.z);
      core = max(core, a.w);
    }
  } else {
    // (Saturn's north: the polar cyclone — its jet ~150 m/s at 88° N, eastward —; the hexagon's jet, the matter along its
    // sides: on its streamline, its colatitude's departure from the circle carried with it)
    let rho = 1.5707963 - lat;
    if (rho < 0.42) {
      let cm = 0.0349;
      let vp = 150.0 * (rho / cm) * exp(0.5 * (1.0 - sq(rho / cm)));
      let g = exp(-sq((rho - HEX_RHO) / 0.07));
      let lon = lon0 - u * tau / (R * max(sin(rho), 0.05)) - vp * tau / (R * max(sin(rho), 1e-4));
      // (the departure at the matter's longitude then and now — one copy of the hexagon)
      var dh = vec2f(0.0);
      for (var i = 0u; i < 2u; i++) { dh[i] = saturnHexRho(select(lon0, lon, i == 1u), tS) - HEX_RHO; }
      ll = vec2f(lon, 1.5707963 - (rho + g * (dh.y - dh.x)));
    }
  }
  return vec3f(ll, core);
}
// a named vortex at centre c (lon, lat), semi-axes e [rad]: where the matter at lon0, lat was τ seconds ago — turned on its
// ellipse at an angular rate from its tangential speed (peak vm [m/s] on its long side at 0.8 of its radius, the core slower
// as r², fading out by 1.3) —; z its weight (1 inside, 0 beyond 1.3), w its slow core's
fn giantVortex(lon0: f32, lat: f32, tau: f32, c: vec2f, e: vec2f, vm: f32, R: f32) -> vec4f {
  var d = vec2f(lon0 - c.x, lat - c.y);
  d.x -= TAU * round(d.x / TAU);
  let q = d / e;
  let r = length(q);
  if (r >= 1.3) { return vec4f(0.0); }
  let v = vm * select(exp(-sq((r - 0.8) / 0.25)), sq(r / 0.8), r < 0.8);
  let ang = -v * tau / (max(r, 1e-4) * R * max(e.x * cos(c.y), e.y));
  let cs = vec2f(cos(ang), sin(ang));
  let qr = vec2f(q.x * cs.x - q.y * cs.y, q.x * cs.y + q.y * cs.x);
  return vec4f(c + qr * e, smoothstep(1.3, 1.0, r), smoothstep(0.75, 0.4, r));
}
// The turbulence under the map's texel at the matter's place ll (lon, lat) — nrm its direction now —, the time tS [s], in
// the zonal flow's phase j: the map's reading moved (uv) and the dye's contrast (z). Three scales, tile periods 16, 3 and 0.6
// of the map's texels (eddies of 1, 0.2, 0.04 texel): the coarse one renewed with the zonal flow's phases, the others 4 and
// 16 times as often (the smaller eddies turn faster), each by its own two phases. The tile laid on bands of latitude 6°
// high, each its whole number of periods round the planet, its own offset each cycle, its place warped by a slow noise (the
// tile's repetition not seen), blended over their edges; by the pole a plane on the axis' side. Its strength the shear: 0.25 in the bands'
// smooth cores, 1 on the jets' flanks.
fn giantTurb(ll: vec2f, tS: f32, j: u32, texA: f32, fpA: f32, shear: f32) -> vec3f {
  let I = clamp(abs(shear) / 40.0, 0.25, 1.0);
  // (the matter's direction: the polar plane's, and the warp's — a noise on the sphere, no seam)
  let m3 = vec3f(cos(ll.y) * cos(ll.x), cos(ll.y) * sin(ll.x), sin(ll.y));
  // (time faster than ~1 000 ×: the phases would flicker — the eddies held, mid-window, the first cycle's: P.envX.w the
  // clock's rate)
  let fr = smoothstep(1000.0, 3000.0, P.envX.w);
  var r = vec3f(0.0);
  for (var s = 0u; s < 5u; s++) {
    // (s 0: the coarse scale, in the zonal flow's phase j; 1, 2: the middle one's two phases; 3, 4: the fine one's)
    let sc = (s + 1u) / 2u;
    let L = texA * select(select(0.6, 3.0, sc == 1u), 16.0, sc == 0u);
    // (its eddies — a sixteenth of the tile — two pixels or more)
    let ws = clamp(log2(L / (32.0 * max(fpA, 1e-9))), 0.0, 1.0);
    if (ws <= 0.0) { continue; }
    let T = GIANT_CYCLE / select(select(16.0, 4.0, sc == 1u), 1.0, sc == 0u);
    let pk = select(f32((s + 1u) % 2u), f32(j), s == 0u);
    let x = tS / T + 0.5 * pk;
    let tn = mix(fract(x), 0.5, fr);
    let cyc = select(u32(i32(floor(x)) & 0xffff), u32(s), fr > 0.5);
    // (the finer scales' fades; the coarse one's the zonal flow's own, outside)
    let wk = mix(select(1.0 - abs(2.0 * tn - 1.0), 1.0, s == 0u), select(0.0, 1.0, s == 0u || s == 1u || s == 3u), fr);
    // (the tile's lattice broken: its place warped by half a period, over three — the noises' first half, gnoise and the
    // Perlin–Worley)
    let n = textureSampleLevel(noiseTex, noiseSamp, vec3f(m3.xy / (3.3 * L * 32.0), (1.0 + fract(m3.z / (3.3 * L * 32.0)) * 128.0) / NOISE_DZ), 0.0);
    let tile = giantTileAt(ll, m3, L, tn, cyc * 8u + s, 0.5 * vec2f(n.x, 2.0 * n.y - 1.0));
    let amp = ws * wk * I;
    let dlon = tile.x * TAU / tile.w;
    r += amp * vec3f(-dlon / TAU, tile.y * L / PI, tile.z * select(1.0, 0.8, sc == 0u || sc == 2u));
  }
  return r;
}
// the tile (dx, dy, dye — tile periods —; w: the periods round the band, the radians of longitude a period's) at the matter's
// place ll (m3 its direction) for its period L [rad], time in its window tn, salt the cycle and scale's, warp [periods]
fn giantTileAt(ll: vec2f, m3: vec3f, L: f32, tn: f32, salt: u32, warp: vec2f) -> vec4f {
  let z = (GTILE_Z0 + 0.5 + tn * (GTILE_FRAMES - 1.0)) / NOISE_DZ;
  let HB = 0.10472;
  let alat = abs(ll.y);
  var acc = vec4f(0.0);
  var wsum = 0.0;
  // (the bands: this one and the nearer neighbour by its edge; the polar plane from 66° to 74°)
  let fb = (ll.y + 1.5707963) / HB;
  let b0 = floor(fb);
  let e = fract(fb);
  let nb = select(b0 + 1.0, b0 - 1.0, e < 0.5);
  let wn = 0.5 * smoothstep(0.3, 0.0, min(e, 1.0 - e));
  let wpole = smoothstep(1.152, 1.2915, alat);
  for (var q = 0u; q < 3u; q++) {
    var w = select(select(wn, 1.0 - wn, q == 0u), wpole, q == 2u);
    if (q < 2u) { w *= 1.0 - wpole; }
    if (w <= 0.0) { continue; }
    var X: vec2f;
    var K = 1.0;
    let band = select(select(nb, b0, q == 0u), 99.0, q == 2u);
    if (q < 2u) {
      let latc = (band + 0.5) * HB - 1.5707963;
      K = max(round(TAU * cos(latc) / L), 1.0);
      X = vec2f(ll.x / TAU * K, ll.y / L);
    } else {
      X = m3.xy / L;
    }
    let h = pcg(salt * 131u + u32(band + 8.0));
    X += vec2f(f32(h & 0xffffu), f32(h >> 16u)) / 65536.0 + warp;
    let v = textureSampleLevel(noiseTex, noiseSamp, vec3f(X, z), 0.0);
    // (by the pole a period's longitude meaningless: its x displacement read as along the parallel near enough)
    acc += w * vec4f(v.xyz, 0.0);
    wsum += w;
    if (q < 2u) { acc.w += w * K; } else { acc.w += w * TAU * max(cos(ll.y), 0.05) / L; }
  }
  return acc / max(wsum, 1e-6);
}
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
    // (near — the ground's height known, EDM_H —: its strata, bands of rust, cream and grey every ~23 m, seen on the mesas'
    // cliffs and the canyons' walls — PLAN-PLANETES-AAA P5)
    if (EDM_H > -1e8) {
      let band = EDM_H / 23.0 + 0.6 * tfbmF(q * 2000.0 + vec3f(1.3), 2.0);
      let b = fract(band);
      let layer = fract(floor(band) * 0.618);
      let strata = mix(mix(vec3f(0.62, 0.36, 0.22), vec3f(0.78, 0.66, 0.5), smoothstep(0.3, 0.7, layer)), vec3f(0.45, 0.42, 0.4), step(0.85, layer));
      alb = mix(alb, strata, 0.55 * smoothstep(0.0, 0.15, b) * smoothstep(1.0, 0.85, b));
    }
  } else if (surf >= 4u) {
    // its map: longitude about the pole, latitude (linear: an sRGB view; scaled to its albedo)
    let lon = atan2(nrm.y, nrm.x);
    let lat = asin(clamp(nrm.z, -1.0, 1.0));
    let m = surf - 4u;
    let gain = select(1.0, P.hd.y, i32(m) == i32(P.hd.x));
    // (Jupiter's and Saturn's clouds moving: giantAlbedo, where their discs are drawn — planetShade)
    let t = planetMapAt(m, vec2f(0.5 + lon / TAU, 0.5 - lat / PI));
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
// (the footprint across the rings over their width, unclamped: Cassini's kilometre past the map's texel — ringSample)
var<private> ringFootV: f32 = 1.0;
fn mapLod() -> f32 { return clamp(mapLodV, 0.0, 11.0); }
// Retain sub-texel footprints until the actual texture width is known. Clamping the 2K level
// first forced a 6K map to level >= 1.55, throwing away its close-up detail.
fn hdMapLod(width: f32) -> f32 { return max(mapLodV + log2(width / 2048.0), 0.0); }
// fpAngle: the pixel's footprint on the sphere (radians of it); fpRing: across the rings (its radii)
fn setMapLod(fpAngle: f32, fpRing: f32, k: u32) {
  mapLodV = log2(max(fpAngle * 2048.0 / TAU, 1e-6));
  let w = max(bodies[BV * k + 3u].w - bodies[BV * k + 2u].w, 1e-3);
  ringFootV = fpRing / w;
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
  var tau = -log(1.0 - min(t.a, 0.995));
  // (finer than the map's texel — 35 km —: Cassini's kilometre, its ringlets and gaps, as the footprint resolves them —
  // ringFootV, the footprint across the rings over their width; Saturn's rings alone: the profile's span is theirs)
  let fw = clamp(log2(1.0 / (2048.0 * max(ringFootV, 1e-9))) / 3.0, 0.0, 1.0);
  if (fw > 0.0 && abs(ringOuter(k) * 58232.0 - 140900.0) < 1.0) {
    let fine = ringTauFine(rr * 58232.0);
    if (fine >= 0.0) { tau = mix(tau, fine, fw); }
  }
  return vec4f(min(t.rgb * 3.6, vec3f(0.95)), tau);
}
// Cassini's optical depth at a radius [km] (linear between its kilometres), −1 where none
fn ringTauFine(rKm: f32) -> f32 {
  let x = rKm - RING_R0_KM - 0.5;
  if (x < 0.0 || x >= f32(RING_N - 1u)) { return -1.0; }
  let i = u32(x);
  let a = bodies[RING_OFF + i / 4u][i % 4u];
  let b = bodies[RING_OFF + (i + 1u) / 4u][(i + 1u) % 4u];
  if (a < 0.0 || b < 0.0) { return -1.0; }
  return mix(a, b, x - f32(i));
}

// Light scattered by a slab of icy particles towards V, lit along L, N its normal: the reflected radiance
// per unit of the source's F (πF = its irradiance), on the lit face or through the slab to the other;
// w: the slab's opacity along V. q: the point (its radii from the planet's centre), in the planet's
// shadow or not. The particles' phase function two-lobed: the metre-sized blocks of ice throw the light
// back towards the source (Henyey–Greenstein g = −0.3), their dust forward (g = 0.7) — a dust share the
// larger the thinner the ring (the C ring, the Cassini division, the A ring's outer edge: what shines
// backlit; the B ring dark) —, and towards the source the opposition surge (the coherent backscattering
// within a degree, the shadows hidden within several: Cassini's and Hubble's rings ×1.5 at zero phase).
fn ringPhase(ct: f32, tau: f32, spoke: f32) -> f32 {
  let gb = -0.3;
  let gf = 0.7;
  let hb = (1.0 - gb * gb) / pow(1.0 + gb * gb - 2.0 * gb * ct, 1.5);
  let hf = (1.0 - gf * gf) / pow(1.0 + gf * gf - 2.0 * gf * ct, 1.5);
  let dust = min(0.03 + 0.22 * (1.0 - smoothstep(0.05, 0.8, tau)) + spoke, 0.9);
  let alpha = acos(clamp(-ct, -1.0, 1.0)); // (the phase angle: the source and the eye seen from the ring)
  let surge = 1.0 + 0.35 * exp(-alpha / 0.012) + 0.25 * exp(-alpha / 0.1);
  return mix(hb * surge, hf, dust);
}
// Saturn's rings' detail at q seen along V (PLAN-PLANETES-AAA P9 G4): x their optical depth's factor — the A ring's
// self-gravity wakes, clumps canted ~20° to the orbit, gaps between them: its opacity seen along them less than across, the
// quadrupole Cassini and Hubble measured, ±30 % —, y the B ring's spokes — dust lifted over it in radial streaks turning with
// the planet's field, 10.66 h: bright backlit, dark towards the Sun —, a share of fine dust in the phase. (1, 0): none — the
// other rings, the probes' and the Earth's kernels (a conjunction, folded)
fn ringDetail(k: u32, q: vec3f, N: vec3f, V: vec3f) -> vec2f {
  var d = vec2f(1.0, 0.0);
  let rKm = length(q) * 58232.0;
  if (NEAR_DETAIL && NEAR_KIND != 1u && NEAR_KIND != 6u && abs(ringOuter(k) * 58232.0 - 140900.0) < 1.0) {
    if (rKm > 122200.0 && rKm < 136800.0) {
      let vp = V - N * dot(V, N);
      let rp = q - N * dot(q, N);
      let ang = atan2(dot(cross(rp, vp), N), dot(rp, vp));
      d.x = 1.0 + 0.3 * cos(2.0 * (ang - 0.35)) * smoothstep(122200.0, 125000.0, rKm) * smoothstep(136800.0, 133500.0, rKm);
    }
    if (rKm > 100000.0 && rKm < 117000.0) {
      let A = poleAxes(N);
      let az = atan2(dot(q, A[1]), dot(q, A[0])) - P.time.x * max(P.near5.w, 0.0) * TAU / 38362.0;
      // (streaks ~2 000 km wide across the orbit, ~10 000 km long along the radius)
      let n = gnoise(vec3f(cos(az) * 55.0, sin(az) * 55.0, rKm / 9000.0));
      d.y = 0.3 * smoothstep(0.3, 0.75, n) * smoothstep(100000.0, 103000.0, rKm) * smoothstep(117000.0, 112000.0, rKm);
    }
  }
  return d;
}
fn ringLight(k: u32, q: vec3f, N: vec3f, L: vec3f, V: vec3f, det: vec2f) -> vec4f {
  let rr = length(q);
  let smp = ringSample(k, rr);
  let tau = smp.w * det.x;
  if (tau <= 0.0) { return vec4f(0.0); }
  let mu = max(abs(dot(N, V)), 0.01);
  let mu0 = max(abs(dot(N, L)), 0.01);
  let ct = -dot(L, V); // scattering angle: incident −L, out V
  let ph = ringPhase(ct, tau, det.y);
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

// Saturn's rings' blocks of ice, the camera among them (PLAN-PLANETES-AAA P9 G5): within 20 km of their plane the renderer
// anchors their frame (P.fine0: whole metres, its w 2; P.fine1: the camera from it, the body's axes — Saturn's), and the ray
// walks a slab ±15 m thick through three grids — 4 m cells to 120 m, 16 m to 500 m, 64 m to 2 km: far, the small blocks under
// a pixel, the big ones alone —, one block at most in each cell (its odds from the ring's optical depth there, Cassini's),
// lit by the Sun through the slab above it (its optical depth's share), in Saturn's shadow or not, with a little of the
// rings' own light. Out: its radiance per πF and 1; or 0, no block in the slab the ray left within its 2 km — the slab's
// average not added again —; or −1, the slab beyond (ringLight). tMax: the planet's hit [radii]
fn ringBlocks(k: u32, look: vec3f, tMax: f32) -> vec4f {
  let mR = P.near4.w;
  let rd = toBody(look);
  let o = P.fine1.xyz;
  let A = P.fine0.xyz;
  let H = 15.0;
  let zc = o.z + A.z;
  var t0 = 0.0;
  var t1 = 3e38;
  if (abs(rd.z) > 1e-6) {
    let ta = (-H - zc) / rd.z;
    let tb = (H - zc) / rd.z;
    t0 = max(min(ta, tb), 0.0);
    t1 = max(ta, tb);
  } else if (abs(zc) > H) {
    return vec4f(-1.0);
  }
  if (t1 <= t0 || t0 > 2000.0) { return vec4f(-1.0); }
  let tEnd = min(min(t1, 2000.0), tMax * mR);
  let pe = o + rd * t0;
  let smp = ringSample(k, length((A + pe).xy) / mR);
  if (smp.w <= 0.0) { return vec4f(select(-1.0, 0.0, t1 <= 2000.0)); }
  let odds = clamp(1.0 - exp(-0.8 * smp.w), 0.04, 0.85);
  let Lb = toBody(P.near4.xyz);
  for (var L = 0u; L < 3u; L++) {
    let c = array<f32, 3>(4.0, 16.0, 64.0)[L];
    let ba = max(array<f32, 3>(0.0, 120.0, 500.0)[L], t0);
    let bb = min(array<f32, 3>(120.0, 500.0, 2000.0)[L], tEnd);
    if (bb <= ba) { continue; }
    let ac = vec3i(round(A / c));
    let p = o + rd * ba;
    var cell = vec3i(floor(p / c));
    let st = vec3i(sign(rd));
    let inv = 1.0 / select(rd, vec3f(1e-9), abs(rd) < vec3f(1e-9));
    var tm = ((vec3f(cell) + max(vec3f(st), vec3f(0.0))) * c - o) * inv;
    let td = abs(c * inv);
    var t = ba;
    for (var i = 0u; i < 48u; i++) {
      if (t >= bb) { break; }
      // (the cell's block: in it, its centre within the slab)
      let zlo = f32(cell.z) * c + A.z;
      if (zlo < H && zlo + c > -H) {
        let h = hash4(bitcast<vec3u>(cell + ac) ^ vec3u(0x27d4eb2fu * (L + 1u), 0x165667b1u, 0xd3a2646cu));
        if (h.x < odds) {
          let r = c * (0.1 + 0.25 * h.w * h.w);
          let m = 0.5 - r / c;
          var ctr = (vec3f(cell) + 0.5 + (h.yzw - 0.5) * 2.0 * m) * c;
          ctr.z = clamp(ctr.z, max(zlo, -H) + r - A.z, min(zlo + c, H) - r - A.z);
          let oc = o - ctr;
          let b = dot(oc, rd);
          let d = b * b - (dot(oc, oc) - r * r);
          if (d > 0.0) {
            let th = -b - sqrt(d);
            if (th > 0.0 && th < tEnd) {
              let ph = o + rd * th;
              let n = (ph - ctr) / r;
              // (the slab above it towards the Sun: its share of the optical depth; Saturn's shadow)
              let zp = ph.z + A.z;
              let up = select(-1.0, 1.0, Lb.z > 0.0);
              let tr = exp(-smp.w * clamp((H - zp * up) / (2.0 * H), 0.0, 1.0) / max(abs(Lb.z), 0.05));
              let q = (A + ph) / mR;
              let bq = dot(q, Lb);
              let lit = select(1.0, 0.0, bq < 0.0 && dot(q, q) - bq * bq < 1.0);
              let alb = smp.rgb * (0.8 + 0.4 * h.z);
              // (and Saturn's own light on the face turned to it: its day side, a tenth of the Sun's from its distance there,
              // as much as its lit share faces the block)
              let toS = -normalize(A + ph);
              let sat = 0.1 * max(dot(n, toS), 0.0) * max(dot(toS, -Lb) * -1.0 + 0.5, 0.0) / (dot(q, q));
              return vec4f(alb * (max(dot(n, Lb), 0.0) * tr * lit + 0.04 * lit + sat), 1.0);
            }
          }
        }
      }
      // (on to the next cell)
      if (tm.x < tm.y && tm.x < tm.z) {
        t = tm.x;
        tm.x += td.x;
        cell.x += st.x;
      } else if (tm.y < tm.z) {
        t = tm.y;
        tm.y += td.y;
        cell.y += st.y;
      } else {
        t = tm.z;
        tm.z += td.z;
        cell.z += st.z;
      }
    }
  }
  return vec4f(select(-1.0, 0.0, t1 <= 2000.0 || t1 >= tMax * mR));
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
    let rl = ringLight(k, p, vec3f(0.0, 0.0, 1.0), L, -u, vec2f(1.0, 0.0));
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

// The i-th body ourSegment looks at: list 1 the renderer's for the camera's rays (path.w of them; 4 indices of 6 bits a
// value in water3.zw, water4.w, water5.w — whole numbers under 2²⁴, exact in a float — the bodies a ray from the camera
// may meet: those big enough on the image, those with rings, the stars), list 2 its own for the rays from the mouth's
// region (mouthList: the same, seen from the mouth — and those within the region), list 0 every one of ours
fn listedBody(i: u32, list: u32) -> u32 {
  if (list == 0u) { return ourStart() + i; }
  let w = i >> 2u;
  var v = select(select(select(P.water5.w, P.water4.w, w == 2u), P.water3.w, w == 1u), P.water3.z, w == 0u);
  if (list == 2u) { v = P.mouthList[0][w]; }
  return (u32(v) >> (6u * (i & 3u))) & 63u;
}

// Our universe's bodies on a straight piece of a ray (P.ourCam-relative home coordinates): from o
// along the unit direction d, over [0, tMax); travel: the ray's length before o (the pixel's
// footprint). The nearest body stops the ray (a star shines, a planet reflects its star's light);
// rings in front of it add their light and dim what lies behind (tint). Bodies smaller than the
// pixel are left to farPoints. dneg: only those within the Dneg region. gObs: the photon's frequency
// ratio camera / static observer here.
fn ourSegment(o: vec3f, d: vec3f, tMax: f32, out: ptr<function, WhOut>, gObs: f32, travel: f32, dneg: bool) -> bool {
  if ((TUNE_SKIP & 4u) != 0u) { return false; }
  var tBest = tMax;
  var kBest = 0u;
  var hit = false;
  // (only the bodies the renderer listed — those such a ray may meet, by the test below —: from the camera, the camera's
  // list; from the mouth's region — its pieces there, the ray out of it —, the mouth's: a body passing the test below
  // is big enough seen from the region's edge, travel + |c| no less than its distance from there; else all)
  let fromCam = !dneg && travel == 0.0 && all(o == vec3f(0.0));
  let list = select(select(0u, 2u, P.mouthList[1].x > 0.0), select(0u, 1u, P.path.w > 0.0), fromCam);
  let nB = select(select(bodyCount() - ourStart(), u32(P.path.w), list == 1u), u32(P.mouthList[1].x), list == 2u);
  let nB0 = select(nB, 0u, (TUNE_SKIP & 32u) != 0u);
  for (var ki = 0u; ki < nB0; ki++) {
    let k = listedBody(ki, list);
    cost(10u);
    let wk = bodyWhere(k);
    if (!(wk == 4u || (wk == 2u && !dneg))) { continue; }
    let c = bodies[BV * k].xyz - o;
    let R = bodyRadius(k);
    let reach = R * max(ringOuter(k), 1.0);
    let b = dot(c, d);
    if (b + reach < 0.0 || b - reach > tMax) { continue; }
    if (reach < 0.5 * beam() * (travel + length(c))) { continue; }
    let perp = c - b * d;
    // (a dusty airless world's limb its relief's — limbRelief: the Moon's mountains on the Sun's last light)
    let Rl = R * (1.0 + limbAt(k, perp, R));
    let h = Rl * Rl - dot(perp, perp);
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
  for (var ki = 0u; ki < select(nB, 0u, (TUNE_SKIP & 64u) != 0u); ki++) {
    let k = listedBody(ki, list);
    cost(10u);
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
    let rl = ringLight(k, q, N, L, V, ringDetail(k, q, N, V));
    (*out).glow += (*out).tint * rl.rgb * blackbody(src.x * gObs, P.disk.w) * src.y * bodies[BV * k + 3u].y;
    (*out).tint *= 1.0 - rl.w;
  }
  // the Earth (its air in front of what the ray meets — its limb's glow; its ground, clouds and air when
  // it is what the ray meets): one call, the ground or not (every call is a copy the compiler builds)
  {
    for (var ki = 0u; ki < select(nB, 0u, (TUNE_SKIP & 128u) != 0u); ki++) {
      let k = listedBody(ki, list);
      cost(10u);
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
      let e = earthLookFar(k, squashed(A * (-c / R), ab), rd, select(-1.0, tBest * m / R, met), normalize(squashed(A * normalize(bodies[BV * li].xyz - bodies[BV * k].xyz), ab)),
        earthSun(k, gObs), t1, cross(rd, t1), beam() * travel / R, beam(), 0.5, false);
      (*out).glow += (*out).tint * e.col;
      (*out).tint *= e.T;
      if (met) { return true; }
    }
  }
  // our Sun's corona, seen where nothing stands before it (the Moon in front: it hides the corona there
  // too) — only an eclipse shows it: a millionth of the Sun's light, drowned in the day's sky otherwise
  for (var ki = 0u; ki < select(nB, 0u, (TUNE_SKIP & 256u) != 0u); ki++) {
    let k = listedBody(ki, list);
    cost(10u);
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
  for (var ki = 0u; ki < select(nB, 0u, (TUNE_SKIP & 512u) != 0u); ki++) {
    let k = listedBody(ki, list);
    cost(10u);
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
    var cov3 = vec3f(clamp((R - pd) / px + 0.5, 0.0, 1.0));
    // (PLAN-CIEL C4 — through the Earth's air each colour bent its own amount (Edlén's dispersion: red
    // 0.36 % less than the green traced, blue 0.78 % more): the disc seen a little lower in red, higher in
    // blue — at the horizon its top rim green and blue, the blue scattered away by the air: the green flash)
    // (only near its rim, where the colours part: a turn of the direction by ε along the vertical moves the
    // disc's offset by b ε)
    if (REFR_DELTA > 0.0 && abs(R - pd) < px + b * REFR_DELTA * 0.008 && P.near0.w > 0.5) {
      let up = -normalize(bodies[BV * u32(P.near1.w)].xyz - o);
      let w = up - d * dot(up, d);
      let sh = w * (b * REFR_DELTA / max(length(w), 1e-12));
      cov3.x = clamp((R - length(perp - sh * 0.00361)) / px + 0.5, 0.0, 1.0);
      cov3.z = clamp((R - length(perp + sh * 0.0078)) / px + 0.5, 0.0, 1.0);
    }
    let cov = max(cov3.x, max(cov3.y, cov3.z));
    if (cov <= 0.0) { continue; }
    var vis = 1.0;
    // (every body before the star, not the listed ones only: a planet under the pixel crossing the Sun's disc —
    // a transit — takes its share of it)
    for (var ji = 0u; ji < bodyCount() - ourStart(); ji++) {
      let j = ourStart() + ji;
      cost(10u);
      if (j == k) { continue; }
      let wj = bodyWhere(j);
      if (!(wj == 4u || (wj == 2u && !dneg))) { continue; }
      let cj = bodies[BV * j].xyz - o;
      let bj = dot(cj, d);
      if (bj <= 0.0 || bj >= b) { continue; }
      let Rj0 = bodyRadius(j);
      let perpj = cj - bj * d;
      let pj = length(perpj);
      // (its limb's relief: the Sun's light through the Moon's valleys at the second and third contacts — Baily's beads,
      // the diamond ring)
      let Rj = Rj0 * (1.0 + limbAt(j, perpj, Rj0));
      vis *= 1.0 - clamp((Rj - pj) / max(beam() * (travel + bj), 1e-30) + 0.5, 0.0, 1.0);
      if (vis <= 0.0) { break; }
    }
    if (vis <= 0.0) { continue; }
    // (where the ray meets it, or — passing just outside — its limb's nearest point)
    var X = c - perp * (R / max(pd, 1e-30));
    if (pd < R) { X = d * (b - sqrt(R * R - pd * pd)); }
    (*out).glow += (*out).tint * shadeStar(k, X, c, gObs, d, P.time.x) * (cov3 * vis);
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
    col = planetShade(k, nrm, spunAxes(k) * nrm, L, V, P.time.x, gObs, ringShadow(k, nrm, N, L)) * BODY_GAIN;
  }
  (*out).glow += (*out).tint * col;
  (*out).tint = vec3f(0.0);
  return true;
}

// A dusty airless world's limb seen as a silhouette (TERRE-UNREAL U8): its radius's relief where the sight passes at `perp`
// from its centre (the ray's nearest point, R its radius), a fraction of R — the Moon's limb profile ±~2 km (0.12 %:
// Watts's charts, LOLA's —, its mountains and valleys; procedural on the body's own axes, so fixed on it, turned by the
// libration). Only near the limb (0 elsewhere: no cost). At the second and third contacts the Sun's last light through its
// valleys — Baily's beads, the diamond ring —, the chromosphere's pink between its peaks.
const LIMB_RELIEF = 0.0012;
fn limbAt(k: u32, perp: vec3f, R: f32) -> f32 {
  let surf = u32(bodies[BV * k + 2u].z);
  if (bodyKind(k) == 0u || surf < 4u || !regolith(surf - 4u)) { return 0.0; }
  let pd = length(perp);
  if (abs(pd - R) > 2.0 * LIMB_RELIEF * R) { return 0.0; }
  let q = spunAxes(k) * (-perp / max(pd, 1e-30));
  // (ridges and basins at ~200 km, mountains at ~60, peaks at ~20: the beads a few, a few arcseconds apart — waves along
  // fixed directions, not a noise: ourSegment is inlined in every call of it, a three-octave noise there nearly doubled the
  // tracer's compile)
  let n = 0.3 * sin(dot(q, vec3f(7.1, -5.3, 3.2)) + 0.4) + 0.25 * sin(dot(q, vec3f(-4.4, 8.6, 5.9)) + 2.1)
    + 0.17 * sin(dot(q, vec3f(21.0, 17.3, -9.8)) + 1.3) + 0.13 * sin(dot(q, vec3f(-14.2, 23.5, 19.1)) + 4.0)
    + 0.09 * sin(dot(q, vec3f(61.0, -48.0, 39.0)) + 0.7) + 0.06 * sin(dot(q, vec3f(-55.0, 70.0, -47.0)) + 5.2);
  return LIMB_RELIEF * n;
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
  let peak = max(max(textureLoad(hdRelief, vec2i(x0, y0), l).g, textureLoad(hdRelief, vec2i(x1, y0), l).g),
    max(textureLoad(hdRelief, vec2i(x0, y1), l).g, textureLoad(hdRelief, vec2i(x1, y1), l).g));
  // (the Moon's and Mars's tiles' peaks over the global map's means: their windows' rise over it at most — moon-tiles.ts top)
  return peak + select(0.0, P.tileL[16].x, moonTilesOn());
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
var<private> ALB_TINT: vec3f = vec3f(1.0); // (near the Moon, Mars: their tiles' imagery's detail — moonDetail)
// (near the Moon, its tiles drawn: the finer map's normal taken once by shadeNear — moonNormal —, not planetShade's own)
var<private> HD_N: vec3f = vec3f(0.0, 0.0, 1.0);
var<private> HD_N_ON: bool = false;
// (near Mars, its relief marched — earthNear —: the relief's own shadow there, for otherGround)
var<private> REL_SH: f32 = 1.0;
var<private> EDM_H: f32 = -1e9; // (near Edmunds: the ground's height [m] — its strata's colours, planetAlbedo)
var<private> BODYW: mat3x3f = mat3x3f(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);

// Lit by its source alone (the disk seen as one light, or its star): the far view's shading. nrm,
// ldir, view: any one frame; pat: the normal in the black-hole frame (the surface pattern)
// (rs: the sunlight's share through the rings — the direct light's, not the rings' own: their shine)
// The Sun's light the Earth's air bends into its shadow (PLAN-CIEL C6 — the eclipsed Moon's red): seen from
// a point there, the Sun d from the Earth's centre behind it, the Earth ro across. A ray grazing the air at a
// height h is bent by α(h) = 2 N₀ √(πR/2H) e^(−h/H) (~70′ at the sea, C3's model doubled); to reach the point it
// must be bent by the Earth's limb's angle less (near side) or plus (far side) d: its height solved (Newton),
// its light through the air along that grazing path — Rayleigh's red the deepest (the shadow's heart from
// ~2 km: a dark brick red), the dust low down, the ozone's Chappuis band taking the red higher (the rays of
// 15–30 km: the turquoise fringe at the umbra's edge) —, spread by the refraction's own defocusing (1 + D α'/…)
// and gathered by the ring's convergence on the axis (ro / d, held at the Sun's own size). A fraction of
// the Sun's: a ten-thousandth to a millionth.
fn earthRingLight(d: f32, rs: f32, ro: f32) -> vec3f {
  let H = 8.4;
  let R = 6371.0;
  let A0 = 0.0205;
  // (vertical optical depths: Rayleigh at 610, 550, 465 nm; ozone's Chappuis band)
  let tauR = vec3f(0.065, 0.099, 0.197);
  let tauO = vec3f(0.042, 0.027, 0.005);
  var L = vec3f(0.0);
  // (the Sun's disc: its centre and four points 0.7 of its radius off — its far limb, needing less bending,
  // sends rays higher through the air, far clearer: they light the shadow most)
  for (var j = 0; j < 5; j++) {
    let o = select(vec2f(0.0), vec2f(select(0.7, -0.7, j % 2 == 0), 0.0), j > 0 && j < 3) + select(vec2f(0.0), vec2f(0.0, select(0.7, -0.7, j == 3)), j >= 3);
    let dj = length(vec2f(d + o.x * rs, o.y * rs));
    for (var side = 0; side < 2; side++) {
      let sg = select(-1.0, 1.0, side == 0);
      // (the bending needed at the limb: its angle there (the limb ro grown by h) less or plus the Sun's offset)
      let need0 = ro - sg * dj;
      if (need0 >= A0 || need0 <= 0.0) { continue; }
      var h = H * log(A0 / need0);
      for (var i = 0; i < 3; i++) {
        let f = ro * (1.0 + h / R) - sg * dj - A0 * exp(-h / H);
        let df = ro / R + (A0 / H) * exp(-h / H);
        h = clamp(h - f / df, 0.0, 80.0);
      }
      let alpha = A0 * exp(-h / H);
      let tau = tauR * 70.7 * exp(-h / H) + vec3f(0.03 * 183.0 * exp(-h / 1.2)) + tauO * 25.0 * (1.0 - smoothstep(22.0, 40.0, h));
      // (half the ring each side; its convergence on the axis, held at the Sun's size; the refraction's spread)
      let phi = 0.5 * (ro / max(dj, rs)) / (1.0 + alpha * (R / H) / ro);
      L += phi * exp(-tau);
    }
  }
  return L * 0.2;
}

// The sunlight left at a point of body k (its unit normal pat, in its turning axes) by the bodies whose
// shadows fall on it now (P.shade): the share of the Sun's disc each leaves, and the light the Earth's air
// bends into its own shadow. 1: none.
fn bodyShadow(k: u32, pat: vec3f) -> vec3f {
  var T = vec3f(1.0);
  if (!HAS_SHADE) { return T; }
  for (var i = 0u; i < 3u; i++) {
    let hd = P.shade[3u * i + 2u];
    if (u32(hd.x + 0.5) != k + 1u) { continue; }
    let oc = P.shade[3u * i];
    let su = P.shade[3u * i + 1u];
    let o = oc.xyz - pat;
    let sv = su.xyz - pat;
    let dO = length(o);
    let dS = length(sv);
    if (dO >= dS) { continue; }
    let uo = o / dO;
    let us = sv / dS;
    if (dot(uo, us) <= 0.0) { continue; }
    let d = asin(min(length(cross(uo, us)), 1.0));
    let rs = asin(min(su.w / dS, 1.0));
    let ro = asin(min(oc.w / dO, 1.0));
    if (d >= rs + ro) { continue; }
    var t = vec3f(discShare(rs, ro, d));
    if (hd.y > 0.5) { t += earthRingLight(d, rs, ro); }
    T *= t;
  }
  return T;
}

fn planetShade(k: u32, nrm: vec3f, pat: vec3f, ldir: vec3f, view: vec3f, tEm: f32, g: f32, rs0: f32) -> vec3f {
  // (the rings' shadow, and the other bodies' — PLAN-CIEL C6)
  let rs = rs0 * bodyShadow(k, pat);
  let b3 = bodies[BV * k + 3u];
  let src = lightSource(k);
  let Tl = src.x;
  let Bl = src.y;
  // (the finer relief, near: the normal tilted by it)
  var nrmL = nrm;
  // (added to the relief's own normal, near: the map's tilt on it)
  if (isHd(k)) {
    var hn = HD_N;
    if (!HD_N_ON) { hn = hdNormal(k, pat); }
    nrmL = normalize(nrm + BODYW * (hn - pat));
  }
  let cosi = max(dot(nrmL, ldir), 0.0);
  let mu = clamp(dot(nrm, view), 0.0, 1.0);
  // (Jupiter, Saturn: their clouds moving, the scene's clock running — PLAN-PLANETES-AAA P9 —, in place of the fixed map, in
  // the kernels that can draw them big: not the probes' — NEAR_DETAIL 0 —, nor the Earth's, the plain airless worlds',
  // Venus's — a conjunction, folded)
  let s0 = u32(bodies[BV * k + 2u].z);
  let gm = s0 - 4u;
  var A: vec4f;
  if (NEAR_DETAIL && NEAR_KIND != 1u && NEAR_KIND != 3u && NEAR_KIND != 6u && s0 >= 4u && (gm == 4u || gm == 5u) && P.near5.w > 0.0) { A = vec4f(giantAlbedo(gm, pat, tEm, bodies[BV * k + 2u].y), f32(s0)); } else { A = planetAlbedo(k, pat, tEm); }
  A = vec4f(A.rgb * ALB_GAIN * ALB_TINT, A.w);
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
  if (surf >= 4u && regolith(surf - 4u)) {
    f = 2.0 * cosi / max(cosi + mu, 1e-4);
    // (and its opposition surge — Hapke's shadow hiding, B₀ 1, width h 0.06 —: the dust brighter as the light comes from behind
    // the eye, the full Moon's glare, the halo round a walker's shadow; normalised to 1 at a quarter phase — PLAN-PLANETES-AAA P6)
    let ta = tan(0.5 * acos(clamp(dot(ldir, view), -1.0, 1.0)));
    f *= (1.0 + 1.0 / (1.0 + ta / 0.06)) / 1.0566;
  }
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
  // (the helmets' weight 0 under 1.05 radii, the prominences' and the chromosphere's e^(−10) and less past 1.25: their noises
  // not drawn there — the same light, three noises fewer over most of the corona)
  let hw = smoothstep(1.05, 1.6, r);
  var helmets = 1.0;
  if (hw > 0.0) { helmets = mix(1.35, 0.55, smoothstep(0.2, 0.75, lat)) + 0.5 * smoothstep(0.35, 0.9, gnoise(q * 2.2 + vec3f(3.1))); }
  let shape = rays * mix(1.0, helmets, hw);
  let white = blackbodyShifted(5800.0, g) / max(luminance(blackbodyShifted(5800.0, 1.0)), 1e-6);
  var col = white * luminance(disk) * base * shape;
  // the chromosphere (a few thousand km: 0.01 of a radius) and the prominences (Hα red, up to ~0.08)
  let h = r - 1.0;
  if (h < 0.25) {
    let halpha = shiftRatio(3000.0, g) * vec3f(1.0, 0.25, 0.32);
    let loopN = 1.0 - abs(gnoise(q * 9.0 + vec3f(0.0, 0.0, h * 40.0)));
    let region = smoothstep(0.2, 0.5, gnoise(q * 1.7 + vec3f(7.0, 3.0, 1.0)));
    let prom = smoothstep(0.88, 0.97, loopN) * region * exp(-h / 0.025);
    col += halpha * luminance(disk) * (1.5e-4 * exp(-h / 0.004) + 4e-4 * prom);
  }
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
fn dnoise(p: vec3f) -> f32 {
  return textureSampleLevel(noiseTex, noiseSamp, vec3f(p.xy * (1.0 / 32.0), (1.0 + fract(p.z * (1.0 / 32.0)) * 128.0) / NOISE_DZ), 0.0).r;
}
// the clouds' baked noises at p (src/noise3d.ts): r the gradient noise (signed), g the Perlin–Worley, b and a the inverted
// Worley fBms twice and four times finer (0…1) — one fetch
fn cloudNoise(p: vec3f) -> vec4f {
  return textureSampleLevel(noiseTex, noiseSamp, vec3f(p.xy * (1.0 / 32.0), (1.0 + fract(p.z * (1.0 / 32.0)) * 128.0) / NOISE_DZ), 0.0);
}
// (both: the noises in the texture's slices 1–128 between their guards — the giants' tile after them —, z wrapped by hand
// as the sampler's repeat did when they filled it)
const NOISE_DZ = 260.0;

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
    cost(11u);
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
    cost(8u);
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
        cost(9u);
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
  // (the raster's sky — its catalogue stars drawn each by shadeStars at its own pixel, TERRE-UNREAL U8 —: here the Milky Way's
  // map alone; through the block's one ray they flickered and, the filter as wide as the block, blurred into the radiance map)
  if (home && rasterStarsOn()) { return col * 0.5; }
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
        cost(9u);
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
  if ((TUNE_SKIP & 1u) != 0u) { return vec3f(0.0); }
  var pts = vec3f(0.0);
  if (bodyCount() > 0u && P.bodyCfg2.x > 0.0 && (TUNE_SKIP & 2u) == 0u) {
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
  // (the straight piece on our side gathered so far: its start, the travel there; none)
  var segOn = false;
  var q0 = vec3f(0.0);
  var segTravel = 0.0;
  for (var i = 0u; i < 3000u; i++) {
    cost(11u);
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
    // (on our side's region — or just out of it with a piece pending: into the mouth, the step landed on ℓ = −a; out at
    // the far radius —: that last chord ends the piece)
    let onOurs = lPrev < -a && st.l < -a && max(lPrev, st.l) > -lMinus;
    if (ours && (onOurs || segOn)) {
      let p0 = homePoint(lPrev, psiPrev, nA, e2);
      let p1 = homePoint(st.l, st.psi, nA, e2);
      // (its chords merged while the way holds straight — the last point within a quarter of the pixel's footprint of
      // the piece's line —: one look at our bodies for the piece, not one a step; flushed as it bends, as the ray
      // leaves our side's region — out of it, or into the mouth — or as the steps run out)
      if (!segOn) {
        segOn = true;
        q0 = p0;
        segTravel = travel0 + travel - h;
      }
      let L = p1 - q0;
      let lL = length(L);
      let dev = select(0.0, length(cross(p0 - q0, L / max(lL, 1e-30))), lL > 0.0);
      let leaving = !onOurs || st.l <= -lMinus || st.l >= -a || i + 1u >= 3000u;
      if (TUNE_MERGE == 0u || leaving || dev > 0.25 * beam() * (travel0 + travel)) {
        segOn = false;
        if (lL > 0.0 && ourSegment(q0, L / lL, lL, &out, gObs, segTravel, true)) { out.side = -1.0; break; }
      }
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
  var lookSky = look; // (the direction beyond the near body's air: bent by it — airBend)
  REFR_DELTA = 0.0;
  if (NEAR_KIND != 4u && HAS_BODIES && P.near0.w > 0.5) {
    let k = u32(P.near1.w);
    let air = hasAir(k);
    // the body met (its air's own march for a world with air; its relief for the Gargantua planets)
    var hitT = -1.0;
    var hit: NearHit;
    var e: EarthNear;
    // (the two paths apart, each out of the kernels whose near body cannot take it — NEAR_KIND)
    if (NEAR_KIND != 3u && NEAR_KIND != 7u && air) {
      e = earthNear(look, rnd, k);
      hitT = e.t;
    }
    if (NEAR_KIND != 1u && NEAR_KIND != 2u && NEAR_KIND != 5u && NEAR_KIND != 6u && !air) {
      // (the rays the body raster has not met start past half its reach, as Mars's — P8: under an airless world's measured
      // heights, a shell kilometres over the camera, the sky's rays marched from the camera at 2 % of the distance)
      MARCH_T0 = select(0.0, 0.5 * P.tileL[17].x / P.near4.w, rasterPrimary() && P.tileL[17].x > 0.0);
      hit = nearMarch(look);
      MARCH_T0 = 0.0;
      hitT = hit.t;
    }
    // rings in front of the planet (or of the sky): their light, and what they let through
    var ring = vec4f(0.0);
    if (ringOuter(k) > 0.0) {
      let N = P.near3.xyz;
      let dn = dot(look, N);
      let sR = select(-1.0, dot(P.near0.xyz, N) / dn, abs(dn) > 1e-7);
      // (the camera among Saturn's rings' blocks — ringBlocks, P9 G5 —: one met, or none in the slab it crossed — the slab's
      // average then not added again —, or the slab beyond the blocks drawn)
      var blk = vec4f(-1.0);
      if (NEAR_DETAIL && NEAR_KIND != 1u && NEAR_KIND != 3u && NEAR_KIND != 4u && NEAR_KIND != 5u && NEAR_KIND != 6u && NEAR_KIND != 7u &&
        P.fine0.w > 1.5) {
        blk = ringBlocks(k, look, select(3e38, hitT, hitT > 0.0));
      }
      if (blk.w >= 0.0) {
        let src = lightSource(k);
        ring = vec4f(blk.rgb * blackbody(src.x, P.disk.w) * src.y * bodies[BV * k + 3u].y, blk.w);
      } else if (sR > 0.0 && (hitT <= 0.0 || sR < hitT)) {
        let fp = pixFoot() * sR;
        setMapLod(fp, fp / max(abs(dn), 0.05), k);
        let src = lightSource(k);
        let rl = ringLight(k, look * sR - P.near0.xyz, N, P.near4.xyz, -look, ringDetail(k, look * sR - P.near0.xyz, N, -look));
        ring = vec4f(rl.rgb * blackbody(src.x, P.disk.w) * src.y * bodies[BV * k + 3u].y, rl.w);
      }
    }
    if (NEAR_KIND != 3u && NEAR_KIND != 7u && air) {
      if (hitT > 0.0) {
        var o = traceOut(ring.rgb + (1.0 - ring.w) * e.col);
        o.depth = hitT * bodyRadius(k);
        return o;
      }
      pre = ring.rgb + (1.0 - ring.w) * e.col;
      T = (1.0 - ring.w) * e.T;
      veil = e.veil;
      // (what lies beyond the air, seen through it: lower than it looks)
      if (isEarth(k) && P.sky.x > 0.0) { lookSky = airBend(look); }
    }
    if (NEAR_KIND != 1u && NEAR_KIND != 2u && NEAR_KIND != 5u && NEAR_KIND != 6u && !air) {
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
  if ((TUNE_SKIP & 16u) != 0u) { return traceOut(pre); }
  var tr = traceLook(lookSky, rnd, tNow);
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
    cost(8u);
    s += a * gnoise(p);
    n += a;
    p = p * 2.03 + vec3f(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / n;
}

fn reliefMax(surf: u32) -> f32 {
  if (titanKernel() && surf == TITAN_SURF) { return 1100.0; }
  if (surf == 0u) { return 1300.0; }
  if (surf == 1u) { return 4600.0; }
  if (surf == 2u) { return 1800.0; }
  // (the moons' own ground over their craters — moonOwn: Io's massifs up to 8 km; Europa's ridges, Ganymede's grooves,
  // Enceladus's stripes within the craters' 500 m — their rims ~100 m, the swell 90 m —: a higher shell, a longer march)
  if (surf == 14u) { return 8600.0; }
  if (cratered(surf)) { return 500.0; }
  return 0.0;
}
// Titan's ground under its haze (PLAN-PLANETES-AAA P8 T3; terrain.ts titanRelief, the same on the CPU — the walker on it): a
// swell of highlands and basins (±400 m over hundreds of km), ridged hills on the highlands (~300 m over ~40 km), the
// equatorial belt's linear dunes in their seas — east–west, 2.5 km apart, ~90 m tall, Cassini's radar's —, a few metres'
// roughness. Its map's index 19
const TITAN_SURF = 23u;
// (its seas — Kraken, Ligeia, Punga, the lakes; Ontario in the south —: the signed distance [km] to their shores, > 0 in a sea,
// from Cassini's radar — hd-maps.ts, its relief's blue; terrain.ts titanSeaAt, the same —; −100 without its map)
fn titanSea(q: vec3f) -> f32 {
  if (i32(P.hd.x) != 19) { return -100.0; }
  let uv = vec2f(0.5 + atan2(q.y, q.x) / TAU, 0.5 - asin(clamp(q.z, -1.0, 1.0)) / PI);
  return (textureSampleLevel(hdRelief, bgSamp, uv, 0.0).b * 255.0 - 128.0) / 4.0;
}
// (earthNear met a sea of Titan's: otherGround's liquid then)
var<private> TITAN_WET: f32 = 0.0;
// its surface's ripples — mirror-smooth under a wind of a few decimetres a second: centimetres over metres —, a slope at x
// (the camera's metres on the body's axes from the fine ground's anchor), as fine as the pixel's footprint resolves
fn titanRipples(x: vec3f, foot: f32, tSec: f32) -> vec3f {
  var g = vec3f(0.0);
  for (var i = 0u; i < 2u; i++) {
    let lam = select(4.0, 0.7, i == 1u);
    let w = smoothstep(lam * 0.5, lam * 0.1, foot);
    if (w > 0.0) {
      let p = x / lam + vec3f(f32(i) * 7.3, tSec * 0.05 / lam, 0.0);
      g += w * 0.012 * vec3f(gnoise(p), gnoise(p + vec3f(17.1)), gnoise(p + vec3f(31.7)));
    }
  }
  return g;
}
fn titanRelief(q: vec3f, foot: f32, mR: f32) -> f32 {
  var h = tfbm(q * 4.0, max(layerOct(4.0, foot, mR, 4), 1)) * 400.0;
  let hi = smoothstep(0.0, 0.25, tfbm(q * 10.0 + vec3f(3.0), 2));
  let oh = layerOct(60.0, foot, mR, 4);
  if (oh > 0) { h += (ridged(q * 60.0 + vec3f(5.0), oh) - 0.5) * 600.0 * hi; }
  // (the land about its seas above their level, their beds sloping down to ~180 m)
  let sd = titanSea(q);
  if (sd > -80.0) {
    h += (abs(h) * 0.25 + 8.0 - h) * smoothstep(-80.0, -15.0, sd);
    h += (-2.0 - 6.0 * clamp(sd, 0.0, 30.0) - h) * smoothstep(-0.3, 0.3, sd);
  }
  let lat = asin(clamp(q.z, -1.0, 1.0));
  let field = smoothstep(0.45, 0.3, abs(lat)) * smoothstep(-0.05, 0.25, tfbm(q * 12.0 + vec3f(7.0), 2)) * (1.0 - hi);
  if (layerOct(1030.0, foot, mR, 1) > 0 && field > 0.001) {
    let x = fract(lat * mR / 2500.0 + 1.6 * tfbm(q * 150.0 + vec3f(11.0), 2));
    let d = 1.0 - abs(2.0 * x - 1.0);
    h += d * d * (3.0 - 2.0 * d) * 90.0 * field;
  }
  let os = layerOct(8580.0, foot, mR, 3);
  if (os > 0) { h += tfbm(q * 8580.0, os) * 12.0; }
  return h;
}
// the shell of the ground drawn: the relief's, over the measured heights where there are some
fn reliefTop(surf: u32) -> f32 { return reliefMax(surf) + select(0.0, max(P.hd2.y, 0.0), hasDem(surf)); }

// Our airless worlds (the Moon, Mercury, the rocky and icy moons, Ceres, Phobos, Deimos): their ground
// finer than their maps — craters in seven sizes (cells 4 km … 5 m, one crater at most in each: a bowl,
// its raised rim, its ejecta fading out; fresh or worn), a gentle swell. terrain.ts: craterRelief, the
// same on the CPU (the gear on it).
// (and Mars's craters, older and fewer under its dust — PLAN-PLANETES-AAA P7: its map's index 2)
fn cratered(surf: u32) -> bool { return airless(surf) || surf == 6u; }
fn airless(surf: u32) -> bool {
  if (surf < 4u) { return false; }
  let m = surf - 4u;
  return regolith(m) && m != 2u && m != 22u;
}
// how cratered: Io's lava resurfaces it, Europa's ice is young, Enceladus' partly
fn craterDensity(m: u32) -> f32 {
  if (m == 2u) { return 0.35; }
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
  if (!NO_SWELL) { h += airlessSwell(m, q, foot, mR); }
  CRATER_BRIGHT = min(br, 1.0);
  CRATER_GRAD = g;
  return h;
}
// (the shadows' near steps: the swell taken as a plane — nearShadow; far ones past 600 m: the moons' own ground left out)
var<private> NO_SWELL: bool = false;
var<private> NO_OWN: bool = false;
// (the swell at the last normal's point — reliefNormal —: where (xyz) and its height [m] (w), its slope [m per radian])
var<private> SWELL_AT: vec4f = vec4f(0.0, 0.0, 0.0, 0.0);
var<private> SWELL_GRAD: vec3f = vec3f(0.0);
// the swell (a few km) under the craters, and the moons' own ground over it (moonOwn)
fn airlessSwell(m: u32, q: vec3f, foot: f32, mR: f32) -> f32 {
  var h = moonOwn(m, q, foot, mR);
  let os = layerOctF(mR / 3000.0, foot, mR, 5.0);
  if (os > 0.0) { h += tfbmF(q * (mR / 3000.0) + vec3f(f32(m) * 3.7), os) * min(os, 1.0) * 90.0; }
  return h;
}
// a feature of size s [m] faded in as the pixel resolves it (8 … 16 footprints), as the craters are
fn ownFade(s: f32, foot: f32) -> f32 { return clamp(log2(s / (8.0 * max(foot, 0.05))), 0.0, 1.0); }
// The moons' own ground (PLAN-PLANETES-AAA P8 A4; terrain.ts moonOwn, the same — the walker on it), by their map's index:
//   Europa (11): double ridges in three families (40, 14, 5 km), chaos where a broad noise is high — the ridges broken
//   into hummocks;
//   Ganymede (12): grooved lanes on its bright terrain — provinces (a 300 km lattice, warped) each with its grooves' own
//   direction, 4 km apart, V-shaped troughs 500 m deep;
//   Io (10): paterae — flat-floored calderas 0.7–1.6 km deep with steep scarps — and a few massifs 4–8 km high, one at most
//   in each 120 km cell;
//   Enceladus (15): its four tiger stripes about the south pole — troughs 400 m deep, 35 km apart, ~130 km long, flanked by
//   ridges.
// its noises (scale [m], offset, octaves, the feature's size [m] — faded out under the footprint: none read), up to five
fn moonNoise(m: u32, i: u32) -> vec4f {
  if (m == 11u) {
    return array<vec4f, 5>(vec4f(250000.0, 3.3, 1.0, 6000.0), vec4f(40000.0, 0.0, 1.0, 2400.0), vec4f(14000.0, 7.3, 1.0, 840.0), vec4f(5000.0, 2.9, 1.0, 300.0), vec4f(6000.0, 1.1, 2.0, 6000.0))[i];
  }
  if (m == 12u) { return array<vec4f, 5>(vec4f(500000.0, 5.1, 1.0, 4000.0), vec4f(120000.0, 0.0, 1.0, 4000.0), vec4f(120000.0, 4.0, 1.0, 4000.0), vec4f(0.0), vec4f(0.0))[i]; }
  if (m == 10u) { return array<vec4f, 5>(vec4f(20000.0, 0.0, 2.0, 120000.0), vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0))[i]; }
  return vec4f(0.0);
}
fn moonOwn(m: u32, q: vec3f, foot: f32, mR: f32) -> f32 {
  // (only where these moons are drawn: their own kernel — NEAR_KIND 7, the airless worlds' paths — and the general ones; out of
  // the Moon's and Mercury's — they had grown a few per cent — a conjunction, folded)
  if (NEAR_KIND != 0u && NEAR_KIND != 7u) { return 0.0; }
  if (m != 10u && m != 11u && m != 12u && m != 15u) { return 0.0; }
  // (the measure's cut — liteSkip 256: renderer.liteSkip —, what this ground costs; the shadows' far steps — NO_OWN)
  if ((liteSkip() & 256u) != 0u || NO_OWN) { return 0.0; }
  // (the noises in one loop: every call site is a copy the compiler builds)
  var nz = array<f32, 5>(0.0, 0.0, 0.0, 0.0, 0.0);
  // (a feature read only where the pixel resolves it at twice its fade — the shadows' far steps, their footprint coarse —,
  // Europa's chaos's hummocks only where its mask — the first noise — is up: P8's cost)
  for (var i = 0u; i < 5u; i++) {
    let f = moonNoise(m, i);
    let on = f.x > 0.0 && ownFade(0.5 * f.w, foot) > 0.0 && !(m == 11u && i == 4u && nz[0] < 0.25);
    if (on) { nz[i] = tfbm(q * (mR / f.x) + vec3f(f.y), i32(f.z)); }
  }
  if (m == 11u) {
    // (three families of double ridges — 40, 14 and 5 km noises' zero lines: 250, 150, 70 m —, the younger over the older)
    var h = 0.0;
    for (var k = 1u; k < 4u; k++) {
      let w = ownFade(0.5 * moonNoise(m, k).w, foot);
      let a = abs(nz[k]) / 0.06;
      let r = (exp(-a * a) - 0.7 * exp(-9.0 * a * a)) * array<f32, 3>(250.0, 150.0, 70.0)[k - 1u];
      h = max(h, w * r) + min(w * r, 0.0);
    }
    let c = smoothstep(0.25, 0.4, nz[0]);
    let rd = 1.0 - abs(nz[4]);
    return mix(h, (150.0 * rd * rd - 60.0) * ownFade(3000.0, foot), c);
  }
  if (m == 12u) {
    let w = ownFade(2000.0, foot);
    if (w <= 0.0) { return 0.0; }
    let lane = smoothstep(-0.15, 0.05, nz[0]);
    let c = floor(q * (mR / 300000.0) + 0.6 * vec3f(nz[1], nz[2], 0.0));
    let r = hash4(bitcast<vec3u>(vec3i(c)) ^ vec3u(0x2545f491u, 0x68e31da4u, 0xb5297a4du));
    // (its grooves 4 km apart, V-shaped troughs 500 m deep — Ganymede's grooved terrain, slopes up to ~20°)
    let s = dot(q, normalize(r.xyz - 0.5)) * (mR / 4000.0);
    return w * lane * 500.0 * (abs(sin(3.14159265 * s)) - 0.64);
  }
  if (m == 10u) {
    let w = ownFade(60000.0, foot);
    if (w <= 0.0) { return 0.0; }
    let p = q * (mR / 120000.0);
    let c = floor(p);
    let r = hash4(bitcast<vec3u>(vec3i(c)) ^ vec3u(0x9e3779b9u, 0x2545f491u, 0x85ebca6bu));
    let x = length(p - (c + vec3f(0.5) + (r.xyz - 0.5) * 0.1));
    // (a patera: its floor flat, its scarp steep; a massif, its flanks ridged)
    let pat = -(700.0 + 900.0 * fract(r.y * 5.7)) * (1.0 - smoothstep(0.92, 1.05, x / (0.12 + 0.18 * fract(r.x * 7.13))));
    let rd = 1.0 - abs(nz[0]);
    let mas = (4000.0 + 4000.0 * fract(r.x * 11.3)) * smoothstep(1.0, 0.2, x / (0.3 + 0.1 * fract(r.z * 3.1))) * (0.6 + 0.4 * rd * rd);
    return w * select(select(0.0, mas, r.w > 0.95), pat, r.w < 0.35);
  }
  if (q.z < -0.45) {
    let w = ownFade(2000.0, foot);
    let x = q.x * mR;
    let y = q.y * mR;
    let along = x * 0.8253 + y * 0.5646;
    let k = (-x * 0.5646 + y * 0.8253) / 35000.0;
    let n = clamp(round(k - 0.5) + 0.5, -1.5, 1.5);
    let d = (k - n) * 35000.0;
    let ad = abs(d) - 2500.0;
    let prof = -400.0 * exp(-d * d * 1e-6) + 150.0 * exp(-ad * ad * 1e-6);
    return w * prof * smoothstep(75000.0, 55000.0, abs(along + 10000.0 * n)) * smoothstep(-0.45, -0.6, q.z);
  }
  return 0.0;
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
  cost(1u);
  let base = reliefBase(surf, q, foot, mR, tSec);
  if (!hasDem(surf)) { return base; }
  return base + demFine(q, foot, false);
}
fn reliefStep(surf: u32, q: vec3f, foot: f32, mR: f32, tSec: f32) -> f32 {
  cost(1u);
  let base = reliefBase(surf, q, foot, mR, tSec);
  if (!hasDem(surf)) { return base; }
  return base + demFine(q, foot, true);
}
// the relief alone (its normal: the measured heights' is the finer map's, hdNormal)
// foot: the pixel's footprint on the ground [m], mR: metres per radius (the layers' detail)
fn reliefBase(surf: u32, q: vec3f, foot: f32, mR: f32, tSec: f32) -> f32 {
  if (titanKernel() && surf == TITAN_SURF) { return titanRelief(q, foot, mR); }
  if (surf >= 4u) { return select(0.0, craterRelief(surf - 4u, q, foot, mR), cratered(surf)); }
  if (surf == 1u) {
    // Mann: ice sheets, ridges, hills, rubble, its glaciers' crevasses
    // (noise cells: continents 1 000 km, ridges 270 km, mountains 21 km, crags 2 km, rocks 210 m, rubble 21 m)
    let base = 0.5 + 0.5 * tfbm(q * 6.0, max(layerOct(6.0, foot, mR, 5), 1));
    MANN_CREV = mannCrevasse(q, base, foot, mR);
    var h = base * 1400.0 - MANN_CREVASSE_DEPTH * MANN_CREV;
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
    // (mesas: flat tops, steep cliffs — their strata are the albedo's, planetAlbedo: stepped in the relief, a gentle flank drew
    // them as contour lines in shadow — PLAN-PLANETES-AAA P5)
    let om = layerOct(300.0, foot, mR, 3);
    if (om > 0) { h += smoothstep(0.572, 0.588, 0.5 + 0.5 * tfbm(q * 300.0, om)) * 380.0; }
    // (canyons cut into the high plateaus: a network of steep-walled gorges, ~200 m deep)
    let ocn = layerOct(200.0, foot, mR, 4);
    if (ocn > 0) { h -= smoothstep(0.8, 0.95, 1.0 - abs(tfbm(q * 200.0 + vec3f(9.0), ocn))) * 200.0 * smoothstep(0.5, 0.62, base); }
    let oh = layerOct(3000.0, foot, mR, 3);
    if (oh > 0) { h += (0.5 + 0.5 * tfbm(q * 3000.0 + vec3f(3.0), oh)) * 200.0; }
    let ou = layerOct(300000.0, foot, mR, 2);
    if (ou > 0) { h += (0.5 + 0.5 * tfbm(q * 300000.0, ou)) * 3.0; }
    let od = layerOct(30000.0, foot, mR, 1);
    if (od > 0) {
      // (the dunes: their long windward slope, their steep slip face downwind — a fifth of their wavelength)
      let ph = dot(q, vec3f(0.6, 0.8, 0.0)) * 30000.0 + 4.0 * tfbm(q * 80.0, 2);
      let x = fract(ph / TAU);
      let dune = select(smoothstep(1.0, 0.8, x), smoothstep(0.0, 0.8, x), x < 0.8);
      h += dune * 25.0 * smoothstep(0.45, 0.25, base);
    }
    return h;
  }
  if (surf == 0u) { return millerWave(q, foot, mR, tSec).x; }
  return 0.0;
}

// Miller's giant waves (PLAN-PLANETES-AAA P3; terrain.ts millerWave, the same — felt: the ship rides them, the wall breaking
// over it is its end): three trains of crests ~3 700 km apart, each a wall ~1.2 km high — its front face steep (MW_FRONT m from
// the crest down to the sea: up to ~35°), its back a long slope (MW_BACK m) —, moving at ~24–35 m/s, the crest's height varying
// along it. x: the sea's height [m]; y: the tallest wave's crest [m]; z: the point's distance from that crest [m, + ahead: its face]
const MW_HEIGHT = 1200.0;
const MW_FRONT = 2500.0;
const MW_BACK = 18000.0;
const MW_LIP = 400.0;
fn millerWave(q: vec3f, foot: f32, mR: f32, tSec: f32) -> vec3f {
  var h = 0.0;
  var best = 0.0;
  var crest = 0.0;
  var front = 3e38;
  for (var i = 0u; i < 3u; i++) {
    let fi = f32(i);
    let dir = normalize(vec3f(cos(fi * 2.1 + 0.3), sin(fi * 2.1 + 0.3), 0.35 * fi - 0.3));
    let ph = dot(q, dir) * 14.0 + fi * 1.7 - tSec * (4.0e-5 + 1.0e-5 * fi);
    // (the crest at the sine's top — ph = π/2 —; u the phase from it, (−π, π])
    var u = ph - 0.5 * PI;
    u -= TAU * round(u / TAU);
    let sM = u / 14.0 * mR;
    let amp = MW_HEIGHT * (0.65 + 0.35 * tfbm(q * 40.0 + vec3f(fi), max(layerOct(40.0, foot, mR, 5), 1)));
    var prof: f32;
    if (sM >= 0.0) {
      let x = min(sM / MW_FRONT, 1.0);
      prof = (1.0 - x) * (1.0 - x) * (1.0 + 2.0 * x);
    } else {
      prof = exp(-(sM / MW_BACK) * (sM / MW_BACK));
    }
    let hi = amp * prof;
    h += hi;
    if (hi > best) {
      best = hi;
      crest = amp;
      front = sM;
    }
  }
  return vec3f(h, crest, front);
}

// Mann's crevasses (PLAN-PLANETES-AAA P4; terrain.ts mannCrevasse, the same — felt): in its glaciers — the continents' lows —,
// a network of cracks ~4 m wide, ~160 m apart (where a noise crosses zero), resolved from a footprint of ~40 m down; their
// depth's share (0 … 1). The last relief's: MANN_CREV (the ice's blue inside them)
const MANN_CREVASSE_DEPTH = 14.0;
var<private> MANN_CREV: f32 = 0.0;
fn mannCrevasse(q: vec3f, base: f32, foot: f32, mR: f32) -> f32 {
  let fc = clamp(log2(mR / (50000.0 * 4.0 * max(foot, 0.05))), 0.0, 1.0);
  let glacier = smoothstep(0.5, 0.38, base);
  if (fc <= 0.0 || glacier <= 0.0) { return 0.0; }
  let n = gnoise(q * 50000.0 + vec3f(11.0));
  return (1.0 - smoothstep(0.0, 0.03, abs(n))) * glacier * fc;
}
// Mann's frozen clouds (terrain.ts mannCloud, the same — the film's): slabs of ice ~1.8–2.2 km up, in patches tens of km
// across, ~150–500 m thick at their middle, thinning to their edge. x: their bottom, y: their top [m over the sphere], z: how much
// of one is there (0: none)
fn mannCloud(q: vec3f) -> vec3f {
  let mask = smoothstep(0.6, 0.68, 0.5 + 0.5 * tfbm(q * 120.0 + vec3f(31.0), 4));
  let mid = 1950.0 + 400.0 * tfbm(q * 900.0 + vec3f(7.0), 3);
  let half = 0.5 * (150.0 + 350.0 * (0.5 + 0.5 * tfbm(q * 3000.0 + vec3f(5.0), 3))) * mask;
  return vec3f(mid - half, mid + half, mask);
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
// (the march's least step, a share of the distance, and its reach [m]: the airless worlds' 2 %, unbounded; Mars's — earthNear
// —, through its dust, 5 % and 120 km — past which a level sight line keeps a few per cent of the ground, the haze the rest)
var<private> MARCH_LEAST: f32 = 0.02;
var<private> MARCH_REACH: f32 = 3e38;
// (and the footprint its steps take the relief at, over the pixel's — Mars's 4: their craters a size coarser, the crossing
// refined on the pixel's own)
var<private> MARCH_FOOT: f32 = 1.0;
// (and its crossing's bisections: 10; Mars's 6 — a sixty-fourth of its last step, metres at 10 km: its normal taken apart)
var<private> MARCH_BISECT: u32 = 10u;
// (and where it starts [radii]: 0, the camera; Mars's rays the body raster has not met, half its reach — its ground nearer is
// all the raster's: their ~200 steps from a camera 2 m up through the relief's 21 km shell, gone)
var<private> MARCH_T0: f32 = 0.0;
// (Mars's ground met by the body raster — bodyLiteAir —: its distance [radii], earthNear's hit without its march; 0: marched)
var<private> NEAR_T: f32 = 0.0;
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
  var t = max(max(b - sq, 0.0), MARCH_T0);
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
  let least = max(MARCH_LEAST, 2.0 * probeBeam);
  // (from where it enters the relief's shell — or starts: an orbit's rays thousands of km long before the ground)
  let tReach = t + MARCH_REACH / mR;
  for (var i = 0u; i < 220u; i++) {
    cost(0u);
    if (t > tReach) { break; }
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
    let h = reliefStep(surf, qb, reliefFoot(t) * MARCH_FOOT, mR, tSec) / mR;
    let f = hgt - h;
    if (f < 0.0) {
      // bisect between the last point above and this one
      var lo = tPrev;
      var hi = t;
      for (var j = 0u; j < MARCH_BISECT; j++) {
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
    // (the three samples in a loop: one copy of the swell — P9)
    var sw: array<f32, 3>;
    for (var j = 0u; j < 3u; j++) {
      let qj = select(qb, normalize(qb + select(a1, a2, j == 2u) * es), j > 0u);
      sw[j] = airlessSwell(surf - 4u, qj, foot, mR);
    }
    // (the swell's height and slope here kept: the shadows' near plane — nearShadow —, not read three times more)
    SWELL_AT = vec4f(qb, sw[0]);
    SWELL_GRAD = ((sw[1] - sw[0]) * a1 + (sw[2] - sw[0]) * a2) / es;
    let g = gc - qb * dot(gc, qb) + ((sw[1] - sw[0]) * a1 + (sw[2] - sw[0]) * a2) / (es * mR);
    return normalize(fromBody(normalize(qb - g)));
  }
  // (no finer than 10 m: float32 directions on the unit sphere are ~0.4 m apart — finer, the normal
  // is noise in blocks)
  let e = max(t * pixFoot(), 2.0 * max(minFoot, 5.0) / mR);
  let t1 = normalize(cross(qb, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(qb.z) > 0.9)));
  let t2 = cross(qb, t1);
  // (the three samples in a loop: one copy of the relief — P9)
  var hs: array<f32, 3>;
  for (var j = 0u; j < 3u; j++) {
    let qj = select(qb, normalize(qb + select(t1, t2, j == 2u) * e), j > 0u);
    hs[j] = reliefBase(surf, qj, foot, mR, tSec);
  }
  let g = ((hs[1] - hs[0]) * t1 + (hs[2] - hs[0]) * t2) / (e * mR);
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
  // molecules and aerosols scaled by its density, no ozone; the world a sphere. Built whole: the
  // constructor names every field, none left at zero — a zero ab once flattened this air onto the ground)
  AIR = AirSpec(
    1.0, P.near4.w, (P.near5.z - 1.0) * P.near4.w, // ab, rm, top
    P.near5.x, 0.15 * P.near5.x, // hr, hm
    vec3f(5.802e-6, 13.558e-6, 33.1e-6) * P.near5.y, vec3f(0.0), // br, bo
    vec3f(2.1e-5) * P.near5.y, 2.33e-5 * P.near5.y, vec3f(0.8), // bms, bme, g
    1.0, vec3f(0.0), 0.0); // k, sky, moon
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
  // (an airless world's within 20 km: a low Sun's ray climbed through 60 km's highest — kilometres over the plain —, its steps
  // through every lit pixel; a relief past 20 km high enough to hide the Sun there is rare, P8)
  let hmax = select(reliefTop(surf), reliefMax(surf) + demTop(q, select(6.0e4, 2.0e4, airless(surf))), hasDem(surf)) / mR;
  let p0 = q * (1.0 + h / mR);
  if (dot(L, q) < -0.2) { return 0.0; } // (the night side: in the planet's own shadow)
  // (the steps' cheap ground against the point's own: their difference there taken off — no self-shadow)
  var b0 = 0.0;
  if (hasDem(surf)) { b0 = demFine(q, foot, true) - demFine(q, foot, false); }
  // (an airless world's, within 32 m of it — 20 of the steps —: its swell — a noise of five octaves — and its measured heights
  // a plane, their slope there; the craters alone stepped through. Each step read them all: Mercury's frame under a low Sun
  // spent half its time in this march, P8)
  var pl = vec3f(0.0);
  var h0 = 0.0;
  if (airless(surf)) {
    let t1 = normalize(cross(q, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(q.z) > 0.9)));
    let t2 = cross(q, t1);
    let e = 16.0 / mR;
    // (the swell's plane: the normal's — reliefNormal, at this point —, else read here)
    let kept = all(SWELL_AT.xyz == q);
    var hs: array<f32, 3>;
    for (var j = 0u; j < 3u; j++) {
      let qj = select(q, normalize(q + select(t1, t2, j == 2u) * e), j > 0u);
      hs[j] = 0.0;
      if (!kept) { hs[j] = airlessSwell(surf - 4u, qj, foot, mR); }
      if (hasDem(surf)) { hs[j] += demFine(qj, foot, true); }
    }
    h0 = hs[0] - b0 + select(0.0, SWELL_AT.w, kept);
    pl = ((hs[1] - hs[0]) * t1 + (hs[2] - hs[0]) * t2) / e + select(vec3f(0.0), SWELL_GRAD, kept);
  }
  var s = 1.0;
  // (Mars's — earthNear's, NEAR_KIND 2 —: from 8 m, steps a 0.4 longer — its relief has no occluder under a few metres, and a
  // low Sun's ray took its 56 steps through every lit pixel: a third of the frame at sunset)
  var d = max(select(0.5, 8.0, marsLike()), foot) / mR * exp2(0.3 * RND);
  for (var i = 0u; i < 56u; i++) {
    cost(2u);
    let pp = p0 + L * d;
    let r = length(pp);
    if (r - 1.0 > hmax) { break; }
    // (past 32 m — the small craters' sharp shadows nearer —: the ground at a 4 % footprint, steps 1.45 longer — the airless
    // worlds' measured heights made each of 56 steps dearer: half of Mercury's frame under a low Sun, PLAN-PLANETES-AAA P8)
    let far = d * mR > 32.0 && airless(surf);
    let fs = max(foot, d * mR * select(0.02, 0.06, far));
    // (one call of each: every call site is a copy the compiler builds)
    let near = airless(surf) && !far;
    NO_SWELL = near;
    NO_OWN = d * mR > 600.0;
    var hb = reliefBase(surf, pp / r, fs, mR, tSec);
    NO_SWELL = false;
    NO_OWN = false;
    if (near) { hb += h0 + dot(pl, pp / r - q); } else if (hasDem(surf)) { hb += demFine(pp / r, fs, true) - b0; }
    let hh = hb / mR;
    // (its clearance [m], less a bias: the ground there drawn at a coarser footprint than the pixel's)
    let cl = (r - 1.0 - hh) * mR + 0.5 + 0.01 * d * mR;
    s = min(s, smoothstep(-1.0, 1.0, cl / (d * mR * 0.0087)));
    if (s <= 0.0) { break; }
    // (the light probe's texels wide: its shadows coarser)
    d *= select(select(select(select(1.23, 1.3, airless(surf)), 1.6, far), 1.4, marsLike()), 1.6, probeBeam > 0.0);
  }
  return s;
}

// Gradient noise on an integer lattice (base) plus a small offset f: exact far from the body's centre
// (gnoiseI's signed noise brought to [0, 1], about ½)
fn noise01(base: vec3i, f0: vec3f) -> f32 { return clamp(0.5 + 0.5 * gnoiseI(base, f0), 0.0, 1.0); }
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
      // (an if, not a select: a select evaluates both — the measure's cut, liteSkip 4, cut nothing)
      if (!NEAR_SHADOW_OFF) { sh = nearShadow(surf, qb, hit.h, toBody(P.near4.xyz), foot, tSec); }
      // (and the Ranger's, the ground within reach of it)
      sh *= shipShadow(look * t * P.near4.w);
      if (airless(surf)) {
        // (the craters alone, for their brightness: not the measured heights' cubic, nor the swell and the moons' own ground —
        // a pixel's whole relief again, P8)
        NO_SWELL = true;
        _ = reliefBase(surf, qb, foot, P.near4.w, tSec);
        NO_SWELL = false;
        ALB_GAIN = 1.0 + 0.45 * CRATER_BRIGHT;
        if (P.fine0.w > 0.5 && P.fine0.w < 1.5 && foot < 8.0) {
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
        // (the Moon's tiles — PLAN-PLANETES-AAA P6 —: their 118 m relief's normal, Clementine's albedo detail)
        if (moonTilesOn() && hasDem(surf)) {
          HD_N = moonNormal(qb, foot);
          HD_N_ON = true;
          ALB_TINT = moonDetail(qb, foot);
        }
      }
    }
    // (in the shadows the light the lit ground around sheds: a few per cent — and a world's sky's, where it has air: a sixth —
    // PLAN-PLANETES-AAA P5, Edmunds' canyons were black)
    let fill = select(0.03, 0.16, P.near5.y > 0.0);
    EDM_H = select(-1e9, hit.h, surf == 2u);
    let c = planetShade(k, n, qb, P.near4.xyz, -look, P.time.x, 1.0, ringShadow(k, look * t - P.near0.xyz, P.near3.xyz, P.near4.xyz));
    ALB_GAIN = 1.0;
    ALB_TINT = vec3f(1.0);
    EDM_H = -1e9;
    HD_N_ON = false;
    return c * (sh + (1.0 - sh) * fill);
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
    // (inside a crevasse — the last relief's MANN_CREV, PLAN-PLANETES-AAA P4 —: the glacier's deep blue ice, darker down it)
    let crev = MANN_CREV;
    A = vec4f(mix(A.rgb, vec3f(0.12, 0.38, 0.68), crev * 0.85) * (1.0 - 0.55 * crev), A.w);
  } else if (surf == 2u) {
    A = vec4f(A.rgb * mix(1.0, 0.6, smoothstep(0.08, 0.3, slope)), A.w);
  }
  var n = n0;
  var whitecap = 0.0;
  // (the slopes finer than the pixel resolves: their variance roughens the glint)
  var rough = 0.08;
  // (the bed's caustics under knee-deep water: the light focused where the surface converges — its Jacobian under 1 —)
  var caustic = 1.0;
  if (surf == 0u) {
    let foot = reliefFoot(t);
    if (P.sea[1].w > 0.0) {
      // (Miller's sea near — PLAN-PLANETES-AAA P2 —: its wind's chop by FFT, knee-deep under 1.3 g (renderer millerSeaParams,
      // sea/spectrum.ts MILLER_SEA), on the giant waves' slopes; the whitecaps where its crests fold — the Jacobian under its
      // cover's level —, and the foam they leave)
      SEA_D = toBody(look) * (t * P.near4.w);
      let sw = seaWavesFft(qb, P.sea[0].xyz, P.sea[1].xyz, foot);
      n = normalize(n0 + fromBody(sw.n - qb));
      whitecap = clamp(max(P.seafft[2].z - sw.foam, 0.0) / max(P.seafft[2].w, 1e-3), 0.0, 1.0) * 0.6 + 0.5 * sw.res;
      rough = clamp(sqrt(sw.vu + sw.vc + P.seafft[2].x + P.seafft[2].y), 0.03, 0.4);
      caustic = 1.0 + 2.5 * clamp(1.0 - sw.foam, -0.25, 0.5) * smoothstep(0.6, 0.05, foot);
    } else {
      // (far from it: the wind waves and swell on the giant ones as slopes of noise, as fine as the pixel resolves — the sky's
      // reflection broken, glittering)
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
  }
  let E = nearE(n);
  var col = A.rgb / PI * E;
  let mu = clamp(-dot(n, look), 0.0, 1.0);
  if (surf == 0u) {
    // the sea: the bed seen through knee-deep water, the sky's reflection, foam on the crests
    let F = 0.02 + 0.98 * pow(1.0 - mu, 5.0);
    col *= caustic;
    let refl = select(shIrradiance(reflect(look, n)) / PI, probeRadiance(camAxes(reflect(look, n))), ranger);
    col = col * (1.0 - F) + F * refl;
    // (the dominant light's glint — the disk's path of light on the water, Gargantua's or K2's —: GGX over the slopes the pixel
    // does not resolve, Fresnel at the half vector)
    let lt = nearLight(k);
    let hv = normalize(lt.dir - look);
    let nl = dot(n, lt.dir);
    if (nl > 0.0) {
      let nh = max(dot(n, hv), 0.0);
      let a2 = rough * rough;
      let dd = nh * nh * (a2 - 1.0) + 1.0;
      let D = a2 / (PI * dd * dd);
      let Fh = 0.02 + 0.98 * pow(1.0 - clamp(dot(hv, -look), 0.0, 1.0), 5.0);
      col += lt.e * (D * Fh / (4.0 * max(mu, 0.05)));
    }
    // (the giant wall — PLAN-PLANETES-AAA P3 —: its lip breaking white along the crest, the foam it pours down its face in
    // streaks; the light through its thin crest, green, when the light is behind it)
    let mw = millerWave(qb, reliefFoot(t), P.near4.w, tSec);
    let rise = clamp(hit.h / max(mw.y, 1.0), 0.0, 1.0);
    let churn = 0.5 + 0.5 * gnoise(qb * (P.near4.w / 60.0) + vec3f(0.0, 0.0, tSec * 0.4));
    let lip = smoothstep(-0.25 * MW_LIP, 0.1 * MW_LIP, mw.z) * (1.0 - smoothstep(0.7 * MW_LIP, 1.5 * MW_LIP, mw.z)) * smoothstep(0.6, 0.9, rise);
    let streak = 0.5 + 0.5 * gnoise(qb * (P.near4.w / 400.0) * vec3f(1.0, 1.0, 0.15) + vec3f(tSec * 0.01));
    let face = step(0.0, mw.z) * (1.0 - smoothstep(0.6 * MW_FRONT, MW_FRONT, mw.z)) * smoothstep(0.15, 0.6, rise) * smoothstep(0.55, 0.85, streak);
    let foam = max(max(lip * (0.6 + 0.4 * churn), 0.55 * face), whitecap);
    let backlit = pow(max(dot(look, lt.dir), 0.0), 3.0) * smoothstep(0.75, 0.97, rise) * (1.0 - lip);
    col += vec3f(0.12, 0.55, 0.45) * lt.e * (0.25 * backlit / PI);
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
// city lights (r); the clouds of the day (g: PLAN-CIEL C2, system/day-clouds.ts — the real weather's cover
// in the fixed map's units, read instead of the day cube's alpha when P.earth.x is 2; held still: no drift)
@group(0) @binding(20) var earthNight: texture_cube<f32>;
@group(0) @binding(21) var earthElev: texture_2d<f32>;    // the height above the sea [m] (ETOPO 2022), the oceans
// the terrain tiles' levels (rg32uint, 1024² or 2048² — EarthTiles.setReach): their heights' float bits [m]; up to z 8 their imagery
// (rgba8: the day's sRGB, the night's lights; 0: none)
@group(0) @binding(28) var earthTiles: texture_2d_array<u32>;
@group(0) @binding(29) var surfaceColour: texture_2d_array<f32>;
@group(0) @binding(30) var surfaceCover: texture_2d_array<u32>;
@group(0) @binding(31) var surfaceSamp: sampler;
// the sea's FFT waves (M1, sea/fft-gpu.ts): its three cascades' two layers each and their mips, sampled repeating
@group(0) @binding(33) var seaFft: texture_2d_array<f32>;
@group(0) @binding(34) var seaSamp: sampler;
// the body near the camera: its finer colour map and relief (src/system/hd-maps.ts; P.hd)
@group(0) @binding(22) var hdColor: texture_2d<f32>;
@group(0) @binding(23) var hdRelief: texture_2d<f32>;    // normal (east, south), ocean, height
// the Ranger's shadow map (ship.ts: orthographic from its dominant light over its bounding sphere)
@group(0) @binding(26) var shipShadowMap: texture_depth_2d;

// The Ranger's shadow on the ground under it: a point pw from the camera [m, world axes] seen in the
// ship's own shadow map — the view from its light probe's dominant light (shEnv(9)), across its bounding
// sphere (ship.wgsl: lightClip) —; lit where nothing of the hull is between it and the light (3 × 3 taps)
// (the map two side by side — ship.wgsl lightClipB —: the left half about the flown craft, P.shipShadow; the
// right about the nearest carrier, P.seafft[3] — its hull's shadow on the sea)
fn shipShadow(pw: vec3f) -> f32 {
  if (P.shipShadow.w <= 0.0 && P.seafft[3].w <= 0.0) { return 1.0; }
  let dl = shEnv(9u).xyz;
  if (dot(dl, dl) < 1e-12) { return 1.0; }
  let lw = normalize(dl.x * P.envX.xyz + dl.y * P.envY.xyz + dl.z * P.envZ.xyz);
  let l = vec3f(dot(lw, P.camRight.xyz), dot(lw, P.camUp.xyz), dot(lw, P.camFwd.xyz));
  let p = vec3f(dot(pw, P.camRight.xyz), dot(pw, P.camUp.xyz), dot(pw, P.camFwd.xyz));
  let e1 = normalize(cross(l, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(l.y) > 0.9)));
  let e2 = cross(l, e1);
  let dims = vec2i(textureDimensions(shipShadowMap));
  let half = vec2i(dims.x / 2, dims.y);
  var out = 1.0;
  for (var k = 0; k < 2; k++) {
    let b = select(P.shipShadow, P.seafft[3], k == 1);
    let R = b.w;
    if (R <= 0.0) { continue; }
    let q = p - b.xyz;
    let c = vec3f(dot(q, e1) / R, dot(q, e2) / R, 0.5 - 0.5 * dot(q, l) / R);
    if (abs(c.x) >= 1.0 || abs(c.y) >= 1.0) { continue; }
    let x0 = select(0, half.x, k == 1);
    let px = vec2i(vec2f(0.5 + 0.5 * c.x, 0.5 - 0.5 * c.y) * vec2f(half));
    // (the bias: 0.4 % of the craft's depth, 15 cm of the carrier's)
    let bias = select(0.004, 0.15 / (2.0 * R), k == 1);
    var lit = 0.0;
    for (var j = -1; j <= 1; j++) {
      for (var i = -1; i <= 1; i++) {
        let d = textureLoad(shipShadowMap, vec2i(x0, 0) + clamp(px + vec2i(i, j), vec2i(0), half - 1), 0);
        lit += select(0.0, 1.0, d >= 0.9999 || c.z <= d + bias);
      }
    }
    out *= lit / 9.0;
  }
  return out;
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
// The clear sky's irradiance [the scene's units] on a surface of normal n (the Earth's axes) at a height h [m over the
// sea] — the frame's own sky (kernel skyAmbient: its radiance from the air's model — Rayleigh, Mie, ozone, the haze, an
// eclipse — over the hemisphere, at 0, 2, 5 and 10 km above the camera's place, second-order spherical harmonics): its
// colour and its strength with the Sun's height, the altitude and the haze. x < 0: none this frame (the old constant then).
fn skyIrradiance(h: f32, n: vec3f) -> vec3f {
  let f0 = bodies[SKY_OFF];
  if (f0.w < 0.5) { return vec3f(-1.0); }
  let e = bodies[SKY_OFF + 1u].xyz;
  let no = bodies[SKY_OFF + 2u].xyz;
  let hs = bodies[SKY_OFF + 3u];
  let d = normalize(vec3f(dot(n, e), dot(n, no), dot(n, f0.xyz)));
  let y = array<f32, 9>(0.282095, 0.488603 * d.y, 0.488603 * d.z, 0.488603 * d.x, 1.092548 * d.x * d.y, 1.092548 * d.y * d.z,
    0.315392 * (3.0 * d.z * d.z - 1.0), 1.092548 * d.x * d.z, 0.546274 * (d.x * d.x - d.y * d.y));
  let a = array<f32, 9>(PI, 2.0943951, 2.0943951, 2.0943951, 0.7853982, 0.7853982, 0.7853982, 0.7853982, 0.7853982);
  // (between the two altitudes round h)
  var l0 = 0u;
  var w = 0.0;
  if (h >= hs.w) { l0 = 3u; } else if (h > hs.x) {
    l0 = select(select(0u, 1u, h > hs.y), 2u, h > hs.z);
    let lo = select(select(hs.x, hs.y, l0 == 1u), hs.z, l0 == 2u);
    let hi = select(select(hs.y, hs.z, l0 == 1u), hs.w, l0 == 2u);
    w = (h - lo) / max(hi - lo, 1.0);
  }
  let l1 = min(l0 + 1u, 3u);
  var irr = vec3f(0.0);
  for (var i = 0u; i < 9u; i++) {
    let c = mix(bodies[SKY_OFF + 4u + l0 * 9u + i].xyz, bodies[SKY_OFF + 4u + l1 * 9u + i].xyz, w);
    irr += a[i] * y[i] * c;
  }
  return max(irr, vec3f(0.0));
}
// The clear sky's radiance at the sea's level towards d (a unit direction over the horizon), from skyAmbient's 8 × 8 grid —
// the azimuth in eighths, the elevation's sine in squares (denser at the horizon, its bright band) —, bilinear; −1: off.
// The sea's mirror: the harmonics hold the light a surface receives, not the horizon's band a grazing mirror shows.
fn skyMirror(d: vec3f) -> vec3f {
  let f0 = bodies[SKY_OFF];
  if (f0.w < 0.5) { return vec3f(-1.0); }
  let l = vec3f(dot(d, bodies[SKY_OFF + 1u].xyz), dot(d, bodies[SKY_OFF + 2u].xyz), dot(d, f0.xyz));
  let jf = clamp(sqrt(max(l.z, 0.0)) * 8.0 - 0.5, 0.0, 7.0);
  let az = fract(atan2(l.y, l.x) / TAU + 1.0) * 8.0;
  let j0 = u32(floor(jf));
  let j1 = min(j0 + 1u, 7u);
  let i0 = u32(floor(az)) % 8u;
  let i1 = (i0 + 1u) % 8u;
  let fj = jf - f32(j0);
  let fi = az - floor(az);
  let g = SKY_OFF + 40u;
  let a = mix(bodies[g + j0 * 8u + i0].xyz, bodies[g + j0 * 8u + i1].xyz, fi);
  let b = mix(bodies[g + j1 * 8u + i0].xyz, bodies[g + j1 * 8u + i1].xyz, fi);
  return mix(a, b, fj);
}
// the clear sky's light on the flat at a point q (its geodetic direction) and height h, physical when the frame has it, else
// the old bluish tenth of the sun's (E: the sun's irradiance, mu0 its cosine there, sk the eclipse's share of the sky).
// The physical light is the camera's place's (skyAmbient): carried to q by the Sun's height and the eclipse there over theirs
// at the camera's place (the table's mu0 and sk — bodies[SKY_OFF + 1].w, + 2.w) — the Moon's shadow dark seen from outside
// it, the night side unlit from orbit —; where the camera's own is too dim to scale (its night, its totality), the old model.
fn skyFlat(q: vec3f, h: f32, E: vec3f, mu0: f32, sk: f32) -> vec3f {
  let old = E * vec3f(0.06, 0.1, 0.19) * smoothstep(-0.18, 0.25, mu0) * sk;
  let s = skyIrradiance(h, q);
  if (s.x < 0.0) { return old; }
  let wc = smoothstep(-0.18, 0.25, bodies[SKY_OFF + 1u].w);
  let skc = bodies[SKY_OFF + 2u].w;
  let carried = s * (smoothstep(-0.18, 0.25, mu0) / max(wc, 0.02)) * (sk / max(skc, 0.02));
  return mix(old, carried, smoothstep(0.02, 0.1, wc) * smoothstep(0.02, 0.1, skc));
}
// the same over the sun's irradiance E (the clouds' light is written as E × factors)
fn skyFlatFactor(q: vec3f, h: f32, E: vec3f, mu0: f32, sk: f32) -> vec3f {
  return skyFlat(q, h, E, mu0, sk) / max(E, vec3f(1e-30));
}
fn nightFloor(sk: f32, mu0: f32) -> vec3f {
  return EARTH_NIGHT * P.earth4.x * (1.0 - smoothstep(-0.05, 0.1, mu0) * (1.0 - sk));
}
// the full Moon's light at night, over the sunlight's irradiance (drawn far brighter than it is — a
// moonlit landscape shows, silvery), and the moonlight at q: its direction's cosine on the normal n,
// through the air, faded in as the night falls
const EARTH_MOON = vec3f(0.07, 0.085, 0.11);
// A cloud's diffuse transmission through the optical depth τ between a point and its top (or its base): two-stream for a
// thick, forward-scattering water cloud — what reaches a deep cumulus's base of the light falling on its top, ~a tenth (the
// grey, dark undersides; it was 0.3 + 0.7 e^(−τ/4): the bases lit at a third whatever the depth — the user's report, U7)
fn cloudDiffuseT(tau: f32) -> f32 { return 1.0 / (1.0 + 0.3 * max(tau, 0.0)); }
// The cities' light sent up onto a cloud over q (unit): the night ground's lamps averaged over the ~10 km a base sees — the
// night map's coarse level —, as bright and as orange as the ground draws them (shadeLite, earthGround): an irradiance from
// below; nothing by day, nothing over the dark countryside
fn cityGlowUp(q: vec3f, E: vec3f, mu0: f32) -> vec3f {
  let dark = 1.0 - smoothstep(-0.12, 0.06, mu0);
  if (dark <= 0.0 || P.earth.z <= 0.0) { return vec3f(0.0); }
  let lod = max(log2(f32(textureDimensions(earthNight).x) * 10.0 / 10007.0), 0.0);
  let l = textureSampleLevel(earthNight, bgSamp, eCube(geoQ(q)), lod).r;
  let lamp = max(l - 0.07, 0.0) / 0.93;
  // (an orange — the sodium's and the warm LEDs' sky glow —, not the lit streets' whiter heart: a dense city's light whitened the
  // bases cream)
  return vec3f(1.0, 0.6, 0.3) * (pow(lamp, 1.4) * CITY_GLOW_CLOUDS * dark * luminance(E));
}
// (the night's floor on the clouds — the starlight and the airglow drawn brighter than they are, 6–11 % of the sunlight, for
// the ground to show (EARTH_NIGHT) — a sixth and a bit: whole, a moonless night lit them as a full Moon does and far over the
// dark sky behind them — white clouds on a black sky, the user's report; a moonless night's clouds dark masses, the Moon's
// silvery, a city's orange underneath — U7)
const CLOUD_NIGHT_FLOOR = 0.15;
// (the cities' light on the clouds' bases: the lit ground's as it is drawn near it — a twentieth of the orbit's — whatever the
// camera's height (P.earth.z follows it: from orbit the bases would glow twenty times brighter); a base sends back ~its
// albedo of what the city under it gives — a city's overcast dim orange, the countryside's black; 0.12 lit a night's deck as a
// day's, at 0.03 a dense city's bases outshone everything else at night)
const CITY_GLOW_CLOUDS = 0.012;
fn earthMoonlight(q: vec3f, n: vec3f, h: f32, mu0: f32) -> vec3f {
  let Lm = P.earth3.xyz;
  let mz = dot(airPhysicalNormal(q), Lm);
  let night = 1.0 - smoothstep(-0.12, 0.06, mu0);
  if (mz < -0.05 || night <= 0.0 || P.earth3.w <= 0.0) { return vec3f(0.0); }
  return EARTH_MOON * pow(P.earth3.w, 1.5) * night * smoothstep(-0.05, 0.05, mz) * max(dot(airPhysicalNormal(n), Lm), 0.0) * sunThrough(h, mz);
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
// Finite source above an ellipsoid's limb, in physical body axes and equatorial radii.
// The tangent cone intersected with the observer/source plane gives the limb angle exactly.
// Its angular normal accounts for the ellipse's tilt; a locally straight limb clips the small disk.
fn figureSunShare(ro: vec3f, light: vec3f, rs: f32, ab: f32) -> f32 {
  let R = length(ro);
  let radial = ro / max(R, 1e-20);
  let L = normalize(light);
  let cosSep = clamp(dot(-radial, L), -1.0, 1.0);
  let sep = acos(cosSep);
  let lateral = L + radial * cosSep;
  let lateralLength = length(lateral);
  let os = squashed(ro, ab);
  var distance: f32;
  if (dot(os, os) <= 1.0) {
    // (the very centre: no horizon there, the source under the ground — not normalize(0)'s NaN)
    if (R < 1e-15) { return 0.0; }
    let normal = normalize(vec3f(ro.xy, ro.z * ab * ab));
    distance = asin(clamp(dot(normal, L), -1.0, 1.0));
  } else if (lateralLength < 1e-7) {
    return select(1.0, 0.0, cosSep > 0.0);
  } else {
    let tangent = lateral / lateralLength;
    let nr = squashed(radial, ab);
    let er = squashed(tangent, ab);
    let c = dot(os, os) - 1.0;
    let A = dot(nr, nr);
    let B = -dot(nr, er);
    let C = dot(os, er) * dot(os, er) - c * dot(er, er);
    let limb = atan2(A, sqrt(max(B * B - A * C, 0.0)) - B);
    let grazing = -radial * cos(limb) + tangent * sin(limb);
    let gs = squashed(grazing, ab);
    let gradS = dot(os, gs) * os - c * gs;
    let grad = squashed(gradS, ab);
    let angularNormal = normalize(grad - grazing * dot(grad, grazing));
    let towardsSource = radial * sin(limb) + tangent * cos(limb);
    distance = (sep - limb) * abs(dot(angularNormal, towardsSource));
  }
  let x = clamp(distance / max(rs, 1e-8), -1.0, 1.0);
  return 0.5 + (x * sqrt(max(1.0 - x * x, 0.0)) + asin(x)) / PI;
}
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
  ab: f32,     // z scale into this body's atmospheric march space (Earth a/b; spheres 1)
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
  moon: f32,   // the Moon's light scattered too, its eclipses dimming the Sun (the Earth: 1)
};
var<private> AIR: AirSpec;
// a thick haze's many-times scattered light (setAir: Mars's dust storm now — P.earth4.z —, Titan's haze always; 0 none):
// earthAir's diffuse field through it, its weight and its dimming per unit of the haze's depth above, per colour
var<private> AIR_DUST: f32 = 0.0;
var<private> AIR_MSC: vec3f = vec3f(0.22, 0.275, 0.352);
// Venus's cloud deck (setAir): a slab of sulphuric droplets from x to y [m] up, their extinction z [1/m] (ω ≈ 1: as much
// scattered), its edges w [m] wide; z 0: none. Its density at a height and its vertical column above one [m]
var<private> AIR_SLAB: vec4f = vec4f(0.0);
fn slabD(h: f32) -> f32 {
  return smoothstep(AIR_SLAB.x - AIR_SLAB.w, AIR_SLAB.x + AIR_SLAB.w, h) * (1.0 - smoothstep(AIR_SLAB.y - 2.0 * AIR_SLAB.w, AIR_SLAB.y + AIR_SLAB.w, h));
}
const VENUS_W = vec3f(1.0, 0.965, 0.86);
fn slabCol(h: f32) -> f32 { return clamp(AIR_SLAB.y - max(h, AIR_SLAB.x), 0.0, AIR_SLAB.y - AIR_SLAB.x); }
// the maps (solar.ts: MAPS_HI, then MAPS_LO) of the worlds with air
fn airOf(m: u32) -> bool { return m == 0u || m == 2u || m == 4u || m == 5u || m == 6u || m == 19u || m == 20u || m == 21u || m == 22u; }
fn hasAir(k: u32) -> bool {
  let surf = u32(bodies[BV * k + 2u].z);
  return bodyKind(k) != 0u && surf >= 4u && airOf(surf - 4u);
}
fn setAir(k: u32) {
  let m = u32(bodies[BV * k + 2u].z) - 4u;
  AIR_K = k;
  AIR_DUST = 0.0;
  AIR_MSC = vec3f(0.22, 0.275, 0.352);
  AIR_SLAB = vec4f(0.0);
  // the Earth: Rayleigh, ozone, an ordinary day's aerosols (τ ≈ 0.03) — built whole (the constructor
  // names every field: none left at zero), the other worlds' below changing it
  var a = AirSpec(
    squashOf(k), EARTH_RM, 100e3, // ab, rm, top
    8000.0, 1200.0, // hr, hm
    vec3f(5.802e-6, 13.558e-6, 33.1e-6), vec3f(1.22e-6, 3.53e-6, 0.16e-6), // br, bo
    vec3f(2.1e-5), 2.33e-5, vec3f(0.8), // bms, bme, g
    max(P.earth2.w, 1.0), vec3f(0.035, 0.06, 0.12), 1.0); // k, sky, moon
  if (m != 0u) { a.moon = 0.0; }
  if (m == 2u) {
    // Mars: 0.6 % of the Earth's air (CO₂), its dust (τ ≈ 0.4, well mixed): the butterscotch sky, the
    // blue sunset round the sun
    a.rm = 3.3895e6; a.top = 80e3; a.hr = 11100.0; a.hm = 11100.0;
    a.br = vec3f(2.2e-7, 5.2e-7, 1.27e-6); a.bo = vec3f(0.0);
    a.bms = 3.6e-5 * vec3f(0.94, 0.78, 0.6); a.bme = 3.6e-5; a.g = vec3f(0.62, 0.7, 0.8); a.k = 2.0;
    a.sky = vec3f(0.07, 0.045, 0.025);
    // a dust storm (PLAN-METEO W6; P.earth4.z, 0 … 1): its dust ten times thicker (τ ≈ 4 — the 2018 global
    // storm reached ~9), lower (its scale height 7 km), darker in the blue; the sun a dim disc, the sky an
    // opaque orange whose light outdoes the sun's on the ground
    let dust = clamp(P.earth4.z, 0.0, 1.0);
    if (dust > 0.0) {
      a.bme *= 1.0 + 9.0 * dust;
      a.hm = mix(11100.0, 7000.0, dust);
      a.bms = a.bme * mix(vec3f(0.94, 0.78, 0.6), vec3f(0.96, 0.74, 0.5), dust);
      a.g = mix(a.g, vec3f(0.7, 0.72, 0.76), dust);
      a.sky *= 1.0 + 3.0 * dust;
      AIR_DUST = dust * 1.2;
    }
  } else if (m == 6u) {
    // Venus (PLAN-PLANETES-AAA P8 V2): its ground under 92 bar of CO₂ — Rayleigh's τ ≈ 2.5 … 9 down there, the horizon lost
    // in it —, a thin lower haze, and its cloud deck from 47 to 70 km (τ ≈ 30 of sulphuric droplets, ω ≈ 1): bright from
    // space, an orange glow from the ground, ~3 % of the sunlight below — the Veneras' — and no Sun's disc
    a.rm = 6.0518e6; a.top = 90e3; a.hr = 15900.0; a.hm = 12000.0;
    a.br = vec3f(1.6e-4, 3.0e-4, 5.6e-4); a.bo = vec3f(0.0);
    a.bms = 2.0e-6 * vec3f(1.0, 0.85, 0.6); a.bme = 2.0e-6; a.g = vec3f(0.72); a.k = 1.0;
    a.sky = vec3f(0.034, 0.024, 0.011);
    AIR_SLAB = vec4f(47000.0, 70000.0, 1.3e-3, 2000.0);
    AIR_DUST = 2.2;
    AIR_MSC = vec3f(0.07, 0.078, 0.095);
  } else if (m == 19u) {
    // Titan: an orange photochemical haze, optically thick (τ ≈ 4) — the ground barely shows
    a.rm = 2.5747e6; a.top = 500e3; a.hr = 20000.0; a.hm = 60000.0;
    a.br = vec3f(1.2e-5, 2.8e-5, 6.8e-5) * 0.15; a.bo = vec3f(0.0);
    a.bms = 6.7e-5 * vec3f(0.92, 0.66, 0.3); a.bme = 6.7e-5; a.g = vec3f(0.62); a.k = 1.0;
    a.sky = vec3f(0.12, 0.07, 0.025);
    // (its light below the haze scattered many times: the sky an orange glow from the ground — Huygens's —, the disc
    // bright from space; the beam's single scattering alone left both black under τ ≈ 4)
    AIR_DUST = 1.0;
    AIR_MSC = vec3f(0.22, 0.29, 0.4);
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
fn airTop() -> f32 { return 1.0 + AIR.top * AIR.k * AIR.ab / AIR.rm; }
fn airHR() -> f32 { return AIR.hr * AIR.k; }
fn airHM() -> f32 { return AIR.hm * AIR.k; }
// Henyey–Greenstein (Cornette–Shanks) per colour
fn phaseM(g: vec3f, mu: f32) -> vec3f {
  let g2 = g * g;
  return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, vec3f(1.5)));
}

fn earthOn() -> bool { return P.earth.x > 0.5; }
fn dayClouds() -> bool { return P.earth.x > 1.5; }
// the cloud map's raw cover at a direction of the cube (its alpha, or the day's), with the footprint's
// gradients, or at a level
fn cloudRawGrad(c: vec3f, gx: vec3f, gy: vec3f) -> f32 {
  if (dayClouds()) { return textureSampleGrad(earthNight, bgSamp, c, gx, gy).g; }
  return textureSampleGrad(earthCube, bgSamp, c, gx, gy).a;
}
fn cloudRawLevel(c: vec3f, lod: f32) -> f32 {
  if (dayClouds()) {
    let below = log2(f32(textureDimensions(earthCube).x) / f32(textureDimensions(earthNight).x));
    return textureSampleLevel(earthNight, bgSamp, c, max(lod - below, 0.0)).g;
  }
  return textureSampleLevel(earthCube, bgSamp, c, lod).a;
}
fn isEarth(k: u32) -> bool { return bodyKind(k) != 0u && u32(bodies[BV * k + 2u].z) == EARTH_SURF; }
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
  var tau = ((AIR.br + AIR.bo) * airColumn(h, mu, airHR()) + vec3f(AIR.bme * airColumn(h, mu, airHM()))) / airK();
  // (Venus's cloud deck — its column above, slant)
  if (venusKernel() && AIR_SLAB.z > 0.0) { tau += vec3f(AIR_SLAB.z * slabCol(h) / max(mu, 0.03)); }
  return exp(-tau);
}

// Directions transform by the inverse scale; normals by its transpose. Optical lengths are physical.
fn airPhysicalDirection(d: vec3f) -> vec3f { return normalize(vec3f(d.xy, d.z / AIR.ab)); }
fn airPhysicalNormal(n: vec3f) -> vec3f { return normalize(vec3f(n.xy, n.z * AIR.ab)); }
fn airRayScale(rd: vec3f) -> f32 { return length(vec3f(rd.xy, rd.z / AIR.ab)); }
// Same height model as the ground/gear: radial march height projected onto the figure's normal.
fn airHeight(p: vec3f) -> f32 {
  let r = length(p);
  let qz = p.z / max(r, 1e-20);
  return (r - 1.0) * AIR.rm * sqrt(1.0 - (1.0 - 1.0 / (AIR.ab * AIR.ab)) * qz * qz);
}

// The atmospheric march uses squashed axes; eclipse positions and angular radii use physical axes.
// Undo the body's z scale before comparing them (the other worlds' spherical axes stay unchanged).
fn eclipsePhysical(v: vec3f) -> vec3f { return vec3f(v.xy, v.z / AIR.ab); }
// The eclipses: the share of the Sun's disk the Moon leaves uncovered, seen from p (physical Earth
// axes, equatorial radii; the Sun along Ls) — two disks' overlap (angles by their sines: f32 keeps them to 0.1″); the Sun's
// disk uniform (its limb's darkening left out). 1: none.
fn sunSeenPhysical(p: vec3f, Ls: vec3f) -> f32 {
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
// Two discs' overlap: the share of a disc of angular radius rs left uncovered by one of radius ro, their
// centres d apart (all small angles) — a body's shadow, its penumbra by the Sun's own disc.
fn discShare(rs: f32, ro: f32, d: f32) -> f32 {
  if (d >= rs + ro) { return 1.0; }
  if (d <= abs(ro - rs)) { return select(1.0 - (ro * ro) / (rs * rs), 0.0, ro >= rs); }
  let k1 = clamp((d * d + rs * rs - ro * ro) / (2.0 * d * rs), -1.0, 1.0);
  let k2 = clamp((d * d + ro * ro - rs * rs) / (2.0 * d * ro), -1.0, 1.0);
  let k3 = max((-d + rs + ro) * (d + rs - ro) * (d - rs + ro) * (d + rs + ro), 0.0);
  let a = rs * rs * acos(k1) + ro * ro * acos(k2) - 0.5 * sqrt(k3);
  return clamp(1.0 - a / (PI * rs * rs), 0.0, 1.0);
}

// The shadows a world's moons cast on its air, clouds and ground (PLAN-CIEL C6; P.shade, the current air's
// body AIR_K): Phobos's on Mars, Io's on Jupiter, Titan's on Saturn — the share of the Sun's disc each leaves at
// p (the world's own axes and radii). 1: none.
var<private> AIR_K: u32 = 0u;
fn airShade(p: vec3f) -> f32 {
  var lit = 1.0;
  if (!HAS_SHADE) { return lit; }
  for (var i = 0u; i < 3u; i++) {
    let hd = P.shade[3u * i + 2u];
    if (u32(hd.x + 0.5) != AIR_K + 1u) { continue; }
    let oc = P.shade[3u * i];
    let su = P.shade[3u * i + 1u];
    let o = oc.xyz - p;
    let sv = su.xyz - p;
    let dO = length(o);
    let dS = length(sv);
    if (dO >= dS || dot(o, sv) <= 0.0) { continue; }
    let d = asin(min(length(cross(o / dO, sv / dS)), 1.0));
    lit *= discShare(asin(min(su.w / dS, 1.0)), asin(min(oc.w / dO, 1.0)), d);
  }
  return lit;
}
fn sunSeen(p: vec3f, Ls: vec3f) -> f32 {
  return sunSeenPhysical(eclipsePhysical(p), normalize(eclipsePhysical(Ls))) * airShade(eclipsePhysical(p));
}
// The sky's own light at p under an eclipse: the sunlit air around it — the Sun's share seen from p and
// from four places 200 km about it (across the shadow), averaged: at the umbra's heart a thousandth or so
// (the totality's deep blue, the horizon's glow beyond), the day's in the penumbra's outer parts.
fn skySeen(p: vec3f, Ls: vec3f) -> f32 {
  if (P.eclipse.w <= 0.0) { return 1.0; }
  let physicalP = eclipsePhysical(p);
  let physicalLs = normalize(eclipsePhysical(Ls));
  let s0 = sunSeenPhysical(physicalP, physicalLs);
  if (s0 >= 1.0) { return 1.0; }
  let e1 = normalize(cross(physicalLs, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(physicalLs.z) > 0.9)));
  let e2 = cross(physicalLs, e1);
  let L = 200000.0 / EARTH_RM;
  let avg = 0.2 * (s0 + sunSeenPhysical(physicalP + e1 * L, physicalLs) + sunSeenPhysical(physicalP - e1 * L, physicalLs) + sunSeenPhysical(physicalP + e2 * L, physicalLs) + sunSeenPhysical(physicalP - e2 * L, physicalLs));
  // (squared: that light scatters twice, from farther the deeper the shadow — the sky of totality a
  // thousandth of the day's, the inner corona hundreds of times brighter than it)
  return mix(0.0004, 1.0, avg * avg);
}

// ---- The auroras (S2): the oval of light round the geomagnetic poles (the dipole's north at 80.8° N, 72.6° W), its
// arcs at a magnetic latitude ~69° less 1.1° a Kp (64.6° at Kp 4, 59° in a great storm), folded and drifting along the magnetic longitude,
// their curtains streaked by rays; oxygen's green line at 557.7 nm peaking at 110 km and fading above, its red line
// at 630 nm from 200 km up (the storms' crowns). Integrated along the ray through their shell (90 – 330 km above
// the ground): an emission [over the night ground's light, per metre] — no scattering, the air's own transmittance
// applied by the caller. Its samples jittered (`jit`): the accumulation smooths their thin curtains.
const AUR_MAG = vec3f(0.04776, -0.15297, 0.98708);
fn auroraLight(ro: vec3f, rd: vec3f, tEnd: f32, jit: f32) -> vec3f {
  let kp = P.bary.z;
  let ts = P.bary.w;
  let r1 = 1.0 + 90e3 / EARTH_RM;
  let r2 = 1.0 + 330e3 / EARTH_RM;
  let b = dot(ro, rd);
  let c2 = dot(ro, ro);
  let off2 = c2 - b * b;
  let h2 = r2 * r2 - off2;
  if (h2 <= 0.0) { return vec3f(0.0); }
  let sq = sqrt(h2);
  var ta = max(-b - sq, 0.0);
  var tb = min(-b + sq, tEnd);
  // (inside the inner sphere — from the ground —: the shell begins as the ray leaves it; from above, the shell's
  // near side only, down to the inner sphere)
  let hi = r1 * r1 - off2;
  if (hi > 0.0) {
    let sqi = sqrt(hi);
    if (c2 < r1 * r1) { ta = max(ta, -b + sqi); } else if (-b - sqi > ta) { tb = min(tb, -b - sqi); }
  }
  if (tb <= ta) { return vec3f(0.0); }
  let u = normalize(cross(vec3f(0.0, 0.0, 1.0), AUR_MAG));
  let v = cross(AUR_MAG, u);
  let centre = 69.0 - 1.1 * kp;
  let N = 40u;
  let dt = (tb - ta) / f32(N);
  var L = vec3f(0.0);
  for (var i = 0u; i < N; i++) {
    cost(4u);
    let t = ta + (f32(i) + jit) * dt;
    let p = ro + rd * t;
    let q = normalize(vec3f(p.x, p.y, p.z * EARTH_AB));
    let hk = airHeight(p) * 1e-3;
    let m = asin(clamp(dot(q, AUR_MAG), -1.0, 1.0)) * 57.29578;
    let ml = atan2(dot(q, v), dot(q, u));
    // (the arcs: folded along the magnetic longitude, drifting — the main one, a fainter one poleward, one
    // equatorward in a storm)
    let fold = 1.4 * sin(ml * 6.0 + ts * 0.012) + 0.8 * sin(ml * 15.0 - ts * 0.031) + 0.35 * sin(ml * 37.0 + ts * 0.07);
    let x = abs(m) - (centre + fold);
    let arcs = exp(-x * x / 0.08) + 0.55 * exp(-(x - 1.1) * (x - 1.1) / 0.05) + 0.35 * clamp(kp / 6.0, 0.0, 1.0) * exp(-(x + 1.6) * (x + 1.6) / 0.12);
    // (the rays: vertical streaks along the arc, flickering slowly)
    let ray = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(ml * 410.0 + 3.0 * sin(ml * 53.0 + ts * 0.05) + ts * 0.4), 3.0);
    let green = exp(-(hk - 110.0) * (hk - 110.0) / 260.0) + 0.25 * exp(-max(hk - 112.0, 0.0) / 40.0) * step(110.0, hk);
    // (the red tops: faint in a quiet oval, the storms' crowns)
    let red = exp(-(hk - 230.0) * (hk - 230.0) / 1500.0) * (0.006 + 0.008 * kp);
    L += (vec3f(0.11, 1.0, 0.36) * green + vec3f(1.0, 0.1, 0.22) * red) * (arcs * ray);
  }
  // (its strength: a quiet oval faint, a storm's bright — over the night ground's light, per metre of ray)
  return L * dt * EARTH_RM * 8e-6 * (0.25 + 0.3 * kp) * EARTH_NIGHT.g;
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
  let physicalRd = airPhysicalDirection(rd);
  let physicalLs = airPhysicalDirection(Ls);
  let stepScale = airRayScale(rd);
  let mu = dot(physicalRd, physicalLs);
  let pR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  let pM = phaseM(AIR.g, mu);
  // the Moon's light scattered too, where the sun is down (the moonlit sky's blue): its phase functions,
  // its irradiance over the sun's — a third of what lights the ground (EARTH_MOON): the moonlit sky a deep
  // blue, not a day's (Lm: its share — the stars' veil leaves it out: they stay, drawn, under the Moon)
  let Lm = P.earth3.xyz;
  let mm = dot(physicalRd, Lm);
  let pRm = 3.0 / (16.0 * PI) * (1.0 + mm * mm);
  let pMm = phaseM(AIR.g, mm);
  let moonE = 0.3 * EARTH_MOON * pow(max(P.earth3.w, 0.0), 1.5);
  // (from inside the air, samples crowded near the camera: the densest air is there)
  let inside = dot(ro, ro) < airTop() * airTop();
  let N = select(TUNE_AIR_N, AP_N, AP_N > 0u);
  var tau = vec3f(0.0);
  var tPrev = ta;
  var split = tSplit <= ta;
  var tauC = vec3f(0.0);
  var LcS = vec3f(0.0);
  var LcM = vec3f(0.0);
  var fog = vec2f(0.0);
  if (HAS_WX) { fog = wxFog(ro, rd); }
  for (var i = 0u; i < N; i++) {
    cost(4u);
    let u1 = (f32(i) + 1.0) / f32(N);
    let t1 = ta + (tb - ta) * select(u1, u1 * u1, inside);
    // (the fog's share of this step: its stretch under the fog's top)
    let fogIn = select(0.0, max(min(t1, fog.y) - max(tPrev, fog.x), 0.0) / max(t1 - tPrev, 1e-12), HAS_WX);
    let ds = (t1 - tPrev) * AIR.rm * stepScale;
    let t = mix(tPrev, t1, jit);
    tPrev = t1;
    let p = ro + rd * t;
    let r = length(p);
    let h = airHeight(p);
    let dR = exp(-h / airHR()) / airK();
    let dM = exp(-h / airHM()) / airK();
    var ext = (AIR.br + AIR.bo) * dR + vec3f(AIR.bme * dM);
    // (Venus's cloud deck: its droplets' extinction — as much scattered —, forward — g 0.7)
    var dS = 0.0;
    var dW = VENUS_W;
    if (venusKernel() && AIR_SLAB.z > 0.0) {
      dS = AIR_SLAB.z * slabD(h);
      ext += vec3f(dS);
      // (its tops' markings — the coarse map's streaks, Venus's: layer 0 of the small maps — in its droplets' albedo)
      if (dS > 0.0) {
        let qv = p / r;
        let uvv = vec2f(0.5 + atan2(qv.y, qv.x) / TAU, 0.5 - asin(clamp(qv.z, -1.0, 1.0)) / PI);
        let cm = textureSampleLevel(mapLo, bgSamp, uvv, 0, 2.0).rgb;
        dW = VENUS_W * clamp(mix(vec3f(1.0), cm / 0.45, 0.8), vec3f(0.5), vec3f(1.4));
      }
    }
    let normal = airPhysicalNormal(p / r);
    var Ts = sunThrough(h, dot(normal, physicalLs));
    // (multiple scattering, roughly: the light the sunlit sky itself sheds, isotropic — as much again as
    // the molecules' single scattering, a third of the aerosols'; under an eclipse the single scattering
    // needs the Sun seen from there, the multiple the sunlit air around: the totality's sky a deep blue —
    // the Moon's eclipses, in the Earth's axes, its air's alone: another world's would be dimmed by a Moon
    // placed on its own axes)
    let s1 = select(1.0, sunSeen(p, Ls), AIR.moon > 0.5);
    let sM = select(max(s1, skySeen(p, Ls)), 1.0, s1 >= 1.0);
    // (N3: the shafts of light — the clouds' shadows in the air, from their map: the single scattering where the Sun
    // reaches through them, the many-times scattered light left to the decks' veil)
    let csT = select(-1.0, cloudShadowAt(p), (TUNE_GSKIP & 8192u) == 0u && !AIR_NO_CSM);
    let s1c = s1 * select(1.0, csT, csT >= 0.0);
    var sc = AIR.br * dR * (pR * s1c + 0.8 / (4.0 * PI) * sM) + AIR.bms * dM * (pM * s1c + 0.3 / (4.0 * PI) * sM);
    // (its droplets' albedo per colour: the unknown absorber's blue and ultraviolet taken — the pale cream of its disc)
    if (venusKernel() && dS > 0.0) { sc += dS * dW * hgPhase(0.7, mu) * s1c; }
    var Tv = exp(-(tau + 0.5 * ext * ds)) * ds;
    if (HAS_WX && WX_W > 0.0) {
      // the weather: under its decks the sunlight dimmed and spread (the air's own scattering with it);
      // its haze and fog grey droplets — half a forward lobe, half spread by their many scatterings —
      // lit by the sun through the decks' gaps, their diffuse light and the sky's; the haze in the sun's
      // path too. Fog is thick: each step's light integrated exactly over it (τ ≫ 1 in one step)
      let w = wxNear(p / r);
      let vl = wxVeil(h, w, 3u);
      let ew = wxHaze(h, w) + WX_W * P.wx[0].z * fogIn;
      let mu0 = dot(normal, physicalLs);
      Ts *= exp(-w * P.wx[0].y * 1500.0 * exp(-max(h - P.wx[4].x, 0.0) / 1500.0) / max(mu0, 0.05));
      let pW = 0.5 * hgPhase(0.75, mu) + 0.5 / (4.0 * PI);
      // (the diffuse share carries the blue sky's light that fell on the decks: a grey, not the sun's tint)
      if (csT >= 0.0) {
        // (the map's shadow already in the single scattering: the decks' veil on the diffuse share alone)
        sc = AIR.br * dR * (pR * s1c + 0.8 / (4.0 * PI) * sM * vl.y) + AIR.bms * dM * (pM * s1c + 0.3 / (4.0 * PI) * sM * vl.y)
          + 0.95 * ew * (vec3f(pW * s1c) + vec3f(0.88, 0.97, 1.12) * ((vl.y - vl.x + 0.3 * sM * vl.y) / (4.0 * PI)));
      } else {
        sc = sc * vl.y + 0.95 * ew * (vec3f(pW * s1 * vl.x) + vec3f(0.88, 0.97, 1.12) * ((vl.y - vl.x + 0.3 * sM * vl.y) / (4.0 * PI)));
      }
      ext += vec3f(ew);
      let x = ext * ds;
      Tv = exp(-tau) * select(ds * (1.0 - 0.5 * x), (1.0 - exp(-x)) / max(ext, vec3f(1e-30)), x > vec3f(1e-3));
    }
    o.L += sc * Ts * Tv;
    // (a thick air — a dust storm's, Titan's haze: τ ~ 4 —: the light scattered many times, its diffuse field through the
    // haze above far less dimmed than the sun's beam — two-stream, e^(−0.22 τ), redder deeper —: the sky an opaque orange
    // glow, not the black the beam's light alone left. In the weather's kernels and the air worlds' — NEAR_KIND 2 —, and those
    // for every path — 0: the aerial table's, the probes')
    if ((HAS_WX || NEAR_KIND == 0u || nearAirWorld()) && AIR_DUST > 0.0) {
      var tauV = AIR.bme * airColumn(h, 1.0, airHM()) / airK();
      // (Venus: the cloud deck's column above in it, its droplets and its dense CO₂ — Rayleigh's τ of several — sources too)
      var src = AIR.bms * dM;
      if (venusKernel() && AIR_SLAB.z > 0.0) {
        tauV += AIR_SLAB.z * slabCol(h) + (AIR.br.g * airColumn(h, 1.0, airHR()) / airK()) * 3.0;
        src += dS * dW + AIR.br * dR;
      }
      let mz0 = dot(normal, physicalLs);
      let Tdif = exp(-tauV * AIR_MSC) * smoothstep(-0.1, 0.25, mz0) * 0.9;
      o.L += src * (AIR_DUST / (4.0 * PI)) * Tdif * Tv;
    }
    let mz = dot(normal, Lm);
    let nightS = 1.0 - smoothstep(-0.12, 0.06, dot(normal, physicalLs));
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

// ---- The weather near the camera (P.wx; src/weather.ts, PLAN-METEO W3): its haze and fog in the air,
// its cloud layers in place of the Earth's own round the camera, their shade on the ground. Its weight at
// this ray's camera (earthNear sets it over the Earth: P.wx[0].x; elsewhere 0 — every weather term out,
// the image as before) and where it is centred: the camera's place (unit, the Earth's squashed axes).
var<private> WX_W: f32 = 0.0;
var<private> WX_Q: vec3f = vec3f(0.0, 0.0, 1.0);
// (the clear sky's light — skyAmbient —: the air without the clouds' shadows, as without their decks)
var<private> AIR_NO_CSM: bool = false;
// (it holds round the camera to 250 km — beyond the horizon seen from under a deck —, fading into the
// Earth's own by 450 km)
fn wxNear(q: vec3f) -> f32 {
  if (!HAS_WX || WX_W <= 0.0) { return 0.0; }
  return WX_W * (1.0 - smoothstep(250000.0, 450000.0, length(q - WX_Q) * EARTH_RM));
}
// where a weather noise of cell `cell` [m] is read at q: drifting with the wind (P.wx[4].yzw, modulo
// 204.8 km — a whole number of the noise's periods for each cell used: 3 200 m down to 400 m)
fn wxAt(q: vec3f, cell: f32) -> vec3f { return (q * EARTH_RM - P.wx[4].yzw) * (1.0 / cell); }
// layer i's cover at q (0…1): patchy for a scattered sky, whole for an overcast one — a noise of 3.2 km
// cells and two finer octaves (clouds 0.5–3 km across), thresholded at its cover
fn wxLayerA(q: vec3f, i: u32) -> f32 {
  let c = P.wx[1u + i].z;
  let s = wxAt(q, 3200.0) + vec3f(f32(i) * 7.31, f32(i) * 3.17, 0.0);
  let n = 0.5 + 0.5 * (0.6 * dnoise(s) + 0.28 * dnoise(s * 2.0 + vec3f(1.7, 4.1, 2.3)) + 0.12 * dnoise(s * 4.0 + vec3f(3.3, 0.7, 5.9)));
  // (a scattered or broken sky's clouds in clumps and clear stretches tens of km across — not one even scatter to the
  // horizon —, the mean cover kept; an overcast whole)
  let cl = c * (1.0 + 0.35 * dnoise(wxAt(q, 6400.0) + vec3f(f32(i) * 1.3, 5.7, 3.1)) * (1.0 - smoothstep(0.75, 0.95, c)));
  return smoothstep(1.0 - cl - 0.1, 1.0 - cl + 0.12, n);
}
// the sunlight under the layers above a height h [m] (but layer `skip`), the weather's weight w there:
// x what comes straight through their gaps, y all of it — the diffuse light a deck lets through too
// (two-stream: 1 / (1 + 0.75 τ (1 − g)), g 0.85)
fn wxVeil(h: f32, w: f32, skip: u32) -> vec2f {
  var d = 1.0;
  var a = 1.0;
  for (var i = 0u; i < 3u; i++) {
    let L = P.wx[1u + i];
    if (L.z <= 0.0 || i == skip) { continue; }
    let c = L.z * w * (1.0 - smoothstep(L.x, L.y, h));
    d *= 1.0 - c;
    a *= 1.0 - c * (1.0 - 1.0 / (1.0 + 0.1125 * L.w));
  }
  return vec2f(d, a);
}
// the haze's extinction at a height h [m], the weather's weight w there: thinning over 1.5 km above the ground
fn wxHaze(h: f32, w: f32) -> f32 { return w * P.wx[0].y * exp(-max(h - P.wx[4].x, 0.0) / 1500.0); }
// The fog lying on the ground (P.wx[0].z > 0) along ro + t rd: the stretch of the ray under its top
// [t0, t1] (radii), its top heaving by a fifth of its depth where it is met from above — the sheet's
// swell seen from over it. Its thickness is far under a march's step: its depth along each step is
// taken exactly from this stretch (earthAir).
fn wxFog(ro: vec3f, rd: vec3f) -> vec2f {
  if (!HAS_WX || P.wx[0].z <= 0.0 || WX_W <= 0.0) { return vec2f(0.0); }
  let D = P.wx[0].w - P.wx[4].x;
  let b = dot(ro, rd);
  let off2 = dot(ro, ro) - b * b;
  var rF = 1.0 + (P.wx[0].w - 0.1 * D) / EARTH_RM;
  var hF = rF * rF - off2;
  if (hF <= 0.0) { return vec2f(0.0); }
  if (dot(ro, ro) > rF * rF) {
    let t0 = -b - sqrt(hF);
    if (t0 <= 0.0) { return vec2f(0.0); }
    rF += 0.2 * D * dnoise(wxAt(normalize(ro + rd * t0), 400.0)) / EARTH_RM;
    hF = rF * rF - off2;
    if (hF <= 0.0) { return vec2f(0.0); }
  }
  return vec2f(max(-b - sqrt(hF), 0.0), max(-b + sqrt(hF), 0.0));
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
    cost(8u);
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
    cost(8u);
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
    cost(8u);
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
    cost(8u);
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
    cost(8u);
    let fade = clamp(oct - f32(i), 0.0, 1.0);
    if (i >= i0) { s += a * fade * gnoise(p) * octaveKept(lam, res); }
    n += a * fade;
    p = p * 2.03 + vec3f(1.7, 9.2, 3.1);
    a *= 0.5;
    lam /= 2.03;
  }
  return s / max(n, 1e-6);
}
// The mountains' warp at q (a geodetic direction): a smooth field moving the ridged lattice (no regular rows of
// peaks) — 0.7 × three two-octave gradient noises of q × 600 (~10 and 5 km), six noises at every height read. Round
// the camera it is read from grids precomputed on nodes fixed on the Earth (system/warp-grid.ts: 19, 76 and 306 m,
// 512 a side — ±4.9, ±20, ±78 km), bilinear between four of them (the crests moved by 3 cm at most on the finest,
// 0.4 m on the second, 6 m on the third: tests/warp-grid.test.ts), each blended into the next towards its window's
// edge; beyond them, and near the poles, worked out
fn earthWarpExact(q: vec3f) -> vec3f {
  return 0.7 * vec3f(tfbm(q * 600.0 + vec3f(3.1), 2), tfbm(q * 600.0 + vec3f(7.7), 2), tfbm(q * 600.0 + vec3f(1.3), 2));
}
fn warpNode(k: u32, i: vec2i) -> vec3f { return bodies[WARP_OFF + k * WARP_N * WARP_N + u32(i.y) * WARP_N + u32(i.x)].xyz; }
fn earthWarp(q: vec3f) -> vec3f {
  if (P.warp[1].w < 0.5) { return earthWarpExact(q); }
  let r = P.warp[0];
  // (from the reference: the longitude by a turned atan2, the latitude by sin(φ − φ₀) — no float32 cancellation)
  let dlon = atan2(-q.x * r.y + q.y * r.x, q.x * r.x + q.y * r.y);
  let sz = clamp(q.z, -1.0, 1.0);
  let dlat = asin(clamp(sz * r.w - sqrt(max(1.0 - sz * sz, 0.0)) * r.z, -1.0, 1.0));
  var w3 = vec3f(0.0);
  var rem = 1.0;
  for (var k = 0u; k < WARP_LEVELS; k++) {
    let L = P.warp[1u + k];
    if (L.w < 0.5) { continue; }
    let uv = L.xy + vec2f(dlon, dlat) * L.z;
    let e = min(min(uv.x, uv.y), min(f32(WARP_N - 1u) - uv.x, f32(WARP_N - 1u) - uv.y));
    let w = smoothstep(0.0, 48.0, e);
    if (w <= 0.0) { continue; }
    let i0 = vec2i(floor(uv));
    let f = uv - floor(uv);
    let a = mix(warpNode(k, i0), warpNode(k, i0 + vec2i(1, 0)), f.x);
    let b = mix(warpNode(k, i0 + vec2i(0, 1)), warpNode(k, i0 + vec2i(1, 1)), f.x);
    w3 += rem * w * mix(a, b, f.y);
    rem *= 1.0 - w;
    if (rem < 1e-4) { break; }
  }
  if (rem >= 1e-4) { w3 += rem * earthWarpExact(q); }
  return w3;
}
fn earthDetail(q: vec3f, h0: f32, foot: f32, res: f32) -> f32 {
  if (TUNE_DETAIL == 0u) { return 0.0; }
  let mount = smoothstep(300.0, 2500.0, h0);
  let land = smoothstep(0.0, 40.0, h0);
  var h = 0.0;
  // (where the heights are known finer — the terrain tiles: res, their resolution [m] — the octaves they
  // hold fade out: the real ground, the noise only below it)
  // the mountains: a ridged multifractal (ridges ~4 km apart down to ~100 m), its lattice warped by a
  // smooth field (no regular rows of peaks)
  let o1 = layerOctF(1500.0, foot, EARTH_RM, 7.0);
  if (o1 > f32(firstKept(EARTH_RM / 1500.0, res)) && mount > 0.0) {
    var pw = q * 1500.0 + vec3f(11.0);
    if (TUNE_WARP > 0u) { pw += earthWarp(q); }
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
// A runway's flags (sites.ts RunwayFrame.flags, packed with the landing end in across's w): 1 landed the other way,
// its surface's class << 1 (0 paved, 1 grass, 2 dirt, 4 snow), 16 a world runway, 32 lit
fn runwayFlags(k: u32) -> u32 { return u32(P.runways[3u + 4u * k].w + 0.5); }
// How a geodetic direction is graded by the runways near (sites.ts runwayGrade, the same figures): x, flat
// (0…1: the drawn detail off) — from 3 km before a threshold to 3 km past the far end, 280 m either side,
// faded over 300 m along, 60 m across —; y, level (0…1: the relief brought to the runway's level) — the
// strip and 300 m past its ends, 320 m either side, eased back over 600 m along, 300 m across —; z, that level [m].
// WGS84 surface point from its geodetic unit normal, body-fixed metres.
fn earthSurface(g: vec3f) -> vec3f {
  let ba = 1.0 / EARTH_AB;
  let N = EARTH_RM / sqrt(1.0 - (1.0 - ba * ba) * g.z * g.z);
  return N * vec3f(g.xy, g.z * ba * ba);
}
fn runwayGrade(g: vec3f) -> vec3f {
  let point = earthSurface(g);
  var w = 0.0;
  var lv = 0.0;
  var el = 0.0;
  for (var k = 0u; k < rwyCount(); k++) {
    let d = point - earthSurface(P.runways[1u + 4u * k].xyz);
    if (dot(d, d) > 8000.0 * 8000.0) { continue; }
    let a = dot(d, P.runways[2u + 4u * k].xyz);
    let c = abs(dot(d, P.runways[3u + 4u * k].xyz));
    let L = P.runways[1u + 4u * k].w;
    let hw = P.runways[2u + 4u * k].w;
    // (a world runway — OurAirports', PLAN-RADAR-AAA RD13: runwayFlags 16 —: its own width, no made-up apron)
    let world = (runwayFlags(k) & 16u) != 0u;
    // (the clear zone 3 km before either threshold: a runway lands both ways — sites.ts runwayWeight)
    let wa = select(select(1.0, max(0.0, 1.0 - (a - L - 3000.0) / 300.0), a > L + 3000.0), max(0.0, 1.0 + (a + 3000.0) / 300.0), a < -3000.0);
    // (the strip, the taxiway beside it, the apron and the buildings — A2, A3 —: 280 m out of the axis, faded by 340;
    // a world runway's own width and 80 m)
    let side = select(280.0, hw + 80.0, world);
    let wc = select(max(0.0, 1.0 - (c - side) / 60.0), 1.0, c < side);
    // (the level: the strip and its airfield, eased back to the relief — a world runway's width and 100 m, over 200)
    let la = 1.0 - smoothstep(0.0, 1.0, max(max(-300.0 - a, a - L - 300.0), 0.0) / 600.0);
    let lc = 1.0 - smoothstep(0.0, 1.0, (c - select(320.0, hw + 100.0, world)) / select(300.0, 200.0, world));
    if (la * lc > lv) {
      lv = la * lc;
      el = P.runways[4u + 4u * k].w;
    }
    w = max(max(w, wa * wc), la * lc);
  }
  return vec3f(w, lv, el);
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
struct RunwayLook { cover: f32, albedo: vec3f, lamps: vec3f };
// the pixel's footprint on the runway's ground [m, along and across it]: its two axes (earthGround sets it)
var<private> LAMP_F: vec4f = vec4f(1.0, 0.0, 0.0, 1.0);
// A runway lamp's share of the pixel, d [m] from it on the ground (along, across): its flux (a 0.4 m lamp's,
// 1 m² of white) spread over the pixel's own footprint — an ellipse, long down a grazing view: the lamps a
// row of points from km out, not blobs merging into a slab —, or, nearer than a pixel's worth, the lamp itself
fn lampV(d: vec2f) -> f32 {
  let fa = LAMP_F.xy;
  let fb = LAMP_F.zw;
  let det = fa.x * fb.y - fa.y * fb.x;
  // (near: the lamp's own disc, 0.4 m across, its edge a few centimetres soft — a Gaussian's tails, ×3 000 at
  // night, painted metres of glowing ground round each lamp by the runway)
  if (abs(det) < 0.16) { return smoothstep(0.24, 0.16, length(d)); }
  let u = (d.x * fb.y - d.y * fb.x) / det;
  let v = (fa.x * d.y - fa.y * d.x) / det;
  return exp(-0.5 * (u * u + v * v) / 0.36) / (6.2832 * 0.36 * abs(det));
}
// The runway's lights as ICAO lays them (PLAN-AEROPORTS A1), for the end in service (a from its threshold
// [m], c across to the right; L long, hw half wide; fw the pixel's footprint; t a clock [s]): the edges every
// 60 m, white, yellow the last 600 m (the caution zone); the threshold's green bar, the end's red; the
// centreline every 15 m — white, red and white alternating 900 to 300 m from the end, red the last 300 —;
// the touchdown zone's barrettes (three lights, 9 to 12 m out either side, every 30 m to 900 m); the
// approach lights (ALSF) 900 m out — a barrette of five every 30 m, a crossbar 300 m out — and their
// sequenced flashers running to the threshold twice a second (the rabbit); the threshold's identification
// strobes either side, once a second. Each found by rounding to its nearest: a few lamps a pixel.
fn runwayLights(a: f32, c: f32, L: f32, hw: f32, t: f32) -> vec3f {
  let W = vec3f(1.0, 0.93, 0.78);
  let Y = vec3f(1.0, 0.72, 0.22);
  let R = vec3f(1.0, 0.12, 0.08);
  let G = vec3f(0.2, 1.0, 0.4);
  let S = vec3f(0.85, 0.9, 1.0);
  let ac = abs(c);
  var l = vec3f(0.0);
  let ke = round(a / 60.0);
  if (ke >= 0.0 && ke * 60.0 <= L) { l += select(W, Y, ke * 60.0 > L - 600.0) * lampV(vec2f(a - 60.0 * ke, ac - hw - 1.5)); }
  let kc = clamp(round(c / 3.0), -floor(hw / 3.0), floor(hw / 3.0));
  l += G * lampV(vec2f(a + 3.0, c - 3.0 * kc));
  l += R * lampV(vec2f(a - L - 3.0, c - 3.0 * kc));
  if (a > -10.0 && a < L + 10.0) {
    let k = round(a / 15.0);
    let ak = 15.0 * k;
    let toEnd = L - ak;
    let alt = select(W, R, (u32(max(k, 0.0)) & 1u) == 1u);
    let col = select(select(W, alt, toEnd < 900.0), R, toEnd < 300.0);
    if (ak >= 0.0 && ak <= L) { l += 0.8 * col * lampV(vec2f(a - ak, c - 0.6)); }
    let kt = round(a / 30.0);
    if (kt >= 2.0 && kt <= 30.0) {
      let x = clamp(round((ac - 9.0) / 1.5), 0.0, 2.0);
      l += 0.7 * W * lampV(vec2f(a - 30.0 * kt, ac - 9.0 - 1.5 * x));
    }
  }
  if (a < -15.0 && a > -915.0) {
    let ka = round(a / 30.0);
    let x = clamp(round(c), -2.0, 2.0);
    l += 1.5 * W * lampV(vec2f(a - 30.0 * ka, c - x));
    let kx = clamp(round(c / 1.5), -10.0, 10.0);
    l += 1.5 * W * lampV(vec2f(a + 300.0, c - 1.5 * kx));
    // (the flashers: from 900 m out to 300 m, one after another toward the runway, the run twice a second)
    let n = -ka;
    if (n >= 10.0 && n <= 30.0) {
      let lit = 30.0 - floor(fract(t * 2.0) * 21.0);
      l += 25.0 * select(0.0, 1.0, n == lit) * S * lampV(vec2f(a - 30.0 * ka, c));
    }
  }
  let flash = select(0.0, 1.0, fract(t) < 0.06);
  if (flash > 0.0 && a > -40.0 && a < 30.0) {
    l += 30.0 * S * (lampV(vec2f(a + 6.0, c - hw - 12.0)) + lampV(vec2f(a + 6.0, c + hw + 12.0)));
  }
  return l;
}
// The runway under a point at (a, c) [m] of its frame — along from the threshold, across to the right —
// for a pixel of footprint fw [m], seen at an elevation el [rad] (the PAPI's): the paved strip, its
// shoulders and markings (ICAO: threshold bars, centreline, edges, touchdown zone, aiming point), its
// lights — edges white every 60 m, the threshold green, the end red — and the PAPI, set for the
// autopilot's inner glide (1.5° to the touchdown 450 m in: two white, two red on it)
// A seven-segment numeral's paint at (u across to the right, v up the digit) [m] in its 3 × 9 m box —
// segments 0.8 m wide: a runway's designation as it is read from the approach
fn digitPaint(d: u32, u: f32, v: f32, fC: f32, fA: f32) -> f32 {
  // (segments a b c d e f g: top, top right, bottom right, bottom, bottom left, top left, middle)
  let mask = array<u32, 10>(0x3Fu, 0x06u, 0x5Bu, 0x4Fu, 0x66u, 0x6Du, 0x7Du, 0x07u, 0x7Fu, 0x6Fu)[min(d, 9u)];
  let w = 0.8;
  var m = 0.0;
  let hor = bandCover(u, 0.0, 3.0, fC);
  let ver = bandCover(v, 0.0, 9.0, fA);
  if ((mask & 1u) != 0u) { m = max(m, hor * bandCover(v, 9.0 - w, 9.0, fA)); }
  if ((mask & 2u) != 0u) { m = max(m, bandCover(u, 3.0 - w, 3.0, fC) * bandCover(v, 4.5, 9.0, fA)); }
  if ((mask & 4u) != 0u) { m = max(m, bandCover(u, 3.0 - w, 3.0, fC) * bandCover(v, 0.0, 4.5, fA)); }
  if ((mask & 8u) != 0u) { m = max(m, hor * bandCover(v, 0.0, w, fA)); }
  if ((mask & 16u) != 0u) { m = max(m, bandCover(u, 0.0, w, fC) * bandCover(v, 0.0, 4.5, fA)); }
  if ((mask & 32u) != 0u) { m = max(m, bandCover(u, 0.0, w, fC) * bandCover(v, 4.5, 9.0, fA)); }
  if ((mask & 64u) != 0u) { m = max(m, hor * bandCover(v, 4.5 - 0.5 * w, 4.5 + 0.5 * w, fA)); }
  return m * ver;
}
// A runway end's designation (n: 1 … 36) at (a, c) of that end's frame: two digits (or one), 9 m long, past
// its threshold bars (45 to 54 m in), either side of the axis
fn designation(n: u32, a: f32, c: f32, fA: f32, fC: f32) -> f32 {
  if (a < 44.0 || a > 55.0 || abs(c) > 8.0) { return 0.0; }
  let tens = n / 10u;
  let ones = n % 10u;
  if (tens == 0u) { return digitPaint(ones, c + 1.5, a - 45.0, fC, fA); }
  return max(digitPaint(tens, c + 4.5, a - 45.0, fC, fA), digitPaint(ones, c - 1.5, a - 45.0, fC, fA));
}

fn runwayShade(a0: f32, c0: f32, L: f32, hw: f32, fw: vec2f, el: f32, rev: bool, lit0: bool, n0: u32, fl: u32) -> RunwayLook {
  var o: RunwayLook;
  // (the pixel's footprint along the runway and across it [m]: seen down a final, the first a hundred times
  // the second — one figure for both had the width thinner than a pixel, the strip gone into the grass)
  let fA = fw.x;
  let fC = fw.y;
  // (a world runway's surface — runwayFlags —: grass, earth or snow, a plain strip, mown or rolled, its ends
  // marked by no paint; lit only where it is — PLAN-RADAR-AAA RD13)
  let surf = (fl >> 1u) & 7u;
  let world = (fl & 16u) != 0u;
  let lit = lit0 && (!world || (fl & 32u) != 0u);
  if (surf != 0u) {
    let aa = select(a0, L - a0, rev);
    let strip = bandCover(aa, 0.0, L, fA) * bandCover(abs(c0), -1.0, hw, fC);
    o.cover = strip * select(0.85, 0.7, surf == 2u);
    // (mown in bands along it; rolled earth; packed snow)
    let band = stripeCover(c0 + 100.0, 12.0, 6.0, fC);
    o.albedo = select(select(vec3f(0.62, 0.64, 0.66), vec3f(0.3, 0.24, 0.16), surf == 2u), mix(vec3f(0.11, 0.17, 0.06), vec3f(0.15, 0.22, 0.08), band), surf == 1u);
    o.lamps = select(vec3f(0.0), runwayLights(aa, select(c0, -c0, rev), L, hw, P.runways[17].x), lit);
    return o;
  }
  // (landed the other way — PLAN-METEO W4 —: the lights and the PAPI from the far end; the markings both ways)
  let a = select(a0, L - a0, rev);
  let c = select(c0, -c0, rev);
  let ac = abs(c);
  // (the touchdown zone's marks at either end: from the nearer threshold)
  let am = min(a, L - a);
  let paved = bandCover(a, -60.0, L + 60.0, fA) * bandCover(ac, -1.0, hw + 7.5, fC);
  o.cover = paved;
  var alb = mix(vec3f(0.17, 0.165, 0.155), vec3f(0.075, 0.075, 0.08), bandCover(ac, -1.0, hw, fC));
  // (the touchdown zone's rubber: darker in the middle)
  alb *= 1.0 - 0.35 * bandCover(am, 250.0, 1100.0, fA) * bandCover(ac, -1.0, 12.0, fC);
  var m = 0.0;
  // threshold bars: 30 m long, 1.8 m wide, 1.8 m apart, either side of a 3.6 m gap (and at the far end)
  let bars = stripeCover(ac - 1.8, 3.6, 1.8, fC) * bandCover(ac, 1.8, hw - 3.0, fC);
  m = max(m, bars * max(bandCover(a, 6.0, 36.0, fA), bandCover(a, L - 36.0, L - 6.0, fA)));
  // centreline: 36 m dashes, 24 m gaps, 0.9 m wide
  m = max(m, stripeCover(a - 80.0, 60.0, 36.0, fA) * bandCover(c, -0.45, 0.45, fC) * bandCover(a, 80.0, L - 80.0, fA));
  // edges: 0.9 m lines
  m = max(m, bandCover(ac, hw - 1.4, hw - 0.5, fC) * bandCover(a, 0.0, L, fA));
  // aiming point: two 45 m × 9 m blocks 300 m in; touchdown zone: pairs of 22.5 m bars every 150 m
  m = max(m, bandCover(am, 300.0, 345.0, fA) * bandCover(ac, 6.0, 15.0, fC));
  let tz = stripeCover(am - 150.0, 150.0, 22.5, fA) * bandCover(am, 150.0, 922.5, fA) * (1.0 - bandCover(am, 280.0, 360.0, fA));
  m = max(m, tz * stripeCover(ac - 4.5, 3.0, 1.8, fC) * bandCover(ac, 4.5, 12.6, fC));
  // (the designations: the published end's number past its threshold, the other's — 18 more — past its own,
  // turned about: each read from its approach — A2)
  let n1 = (n0 + 17u) % 36u + 1u;
  m = max(m, max(designation(n0, a0, c0, fA, fC), designation(n1, L - a0, -c0, fA, fC)));
  o.albedo = mix(alb, vec3f(0.72, 0.72, 0.7), m * paved);
  // the parallel taxiway (A2; the published frame: 120 m left of the axis, 23 m wide, the runway's length) and
  // its three links (the ends, the middle): darker asphalt, a yellow centreline, the holding lines across
  // each link 60 m out of the runway's edge, blue edge lights every 60 m, green centreline lights every 30
  let tc = c0 + 120.0;
  let onTwy = bandCover(abs(tc), -1.0, 11.5, fC) * bandCover(a0, -12.0, L + 12.0, fA);
  let kl = clamp(round(a0 / (0.5 * L)), 0.0, 2.0);
  let al = a0 - 0.5 * L * kl;
  let onLink = bandCover(abs(al), -1.0, 11.5, fA) * bandCover(c0, -120.0, -hw, fC);
  let twy = max(onTwy, onLink) * (1.0 - paved) * select(1.0, 0.0, world);
  if (twy > 0.0) {
    var ta = vec3f(0.105, 0.1, 0.095);
    let yl = max(bandCover(tc, -0.15, 0.15, fC) * bandCover(a0, 0.0, L, fA), bandCover(al, -0.15, 0.15, fA) * bandCover(c0, -120.0, -hw - 6.0, fC));
    let hold = bandCover(c0, -(hw + 61.5), -(hw + 60.0), fC) * stripeCover(c0 + hw + 62.0, 0.9, 0.45, fC) + bandCover(c0, -(hw + 59.4), -(hw + 58.8), fC);
    ta = mix(ta, vec3f(0.75, 0.55, 0.1), max(yl, hold * onLink));
    o.albedo = mix(o.albedo, ta, twy);
    o.cover = max(o.cover, twy);
  }
  // the apron (A3): concrete beyond the taxiway, before the terminal; a yellow lead-in line to each stand
  let apron = bandCover(c0, -205.0, -143.0, fC) * bandCover(a0, 0.36 * L, 0.4 * L + 175.0, fA) * (1.0 - paved) * select(1.0, 0.0, world);
  if (apron > 0.0) {
    let ks = clamp(round((a0 - 0.4 * L) / 70.0), 0.0, 2.0);
    let lead = bandCover(a0 - 0.4 * L - 70.0 * ks, -0.15, 0.15, fA) * bandCover(c0, -200.0, -143.0, fC);
    o.albedo = mix(o.albedo, mix(vec3f(0.32, 0.32, 0.3), vec3f(0.75, 0.55, 0.1), lead), apron);
    o.cover = max(o.cover, apron);
  }
  // the lights (runwayLights: lit at night, at dusk, in a poor visibility — by day in the clear, too faint to
  // see: not reckoned); the PAPI 20 m left of the edge, 450 m in, day and night
  var lmp = vec3f(0.0);
  if (lit) {
    lmp = runwayLights(a, c, L, hw, P.runways[17].x);
  }
  if (lit && !world) {
    // (the taxiway's: blue at its edges, green down its middle and its links')
    let B = vec3f(0.15, 0.35, 1.0);
    let Gt = vec3f(0.25, 1.0, 0.45);
    let kt = round(a0 / 60.0);
    if (kt >= 0.0 && kt * 60.0 <= L) { lmp += 0.5 * B * lampV(vec2f(a0 - 60.0 * kt, abs(c0 + 120.0) - 12.5)); }
    let kg = round(a0 / 30.0);
    if (kg >= 0.0 && kg * 30.0 <= L) { lmp += 0.4 * Gt * lampV(vec2f(a0 - 30.0 * kg, c0 + 120.0)); }
    let kl2 = clamp(round(a0 / (0.5 * L)), 0.0, 2.0);
    let kc2 = clamp(round((c0 + 120.0) / 15.0), 0.0, floor((120.0 - hw) / 15.0));
    lmp += 0.4 * Gt * lampV(vec2f(a0 - 0.5 * L * kl2, c0 + 120.0 - 15.0 * kc2));
    // (the apron's floodlights — sodium, along its far edge — and the pools of light they lay on it)
    let ka = round((a0 - 0.36 * L) / 60.0);
    if (ka >= 0.0 && 0.36 * L + 60.0 * ka <= 0.4 * L + 175.0) { lmp += 3.0 * vec3f(1.0, 0.72, 0.38) * lampV(vec2f(a0 - 0.36 * L - 60.0 * ka, c0 + 205.0)); }
    lmp += 1e-4 * vec3f(1.0, 0.78, 0.5) * bandCover(c0, -205.0, -143.0, fC) * bandCover(a0, 0.36 * L, 0.4 * L + 175.0, fA);
  }
  let elDeg = el * 57.29578;
  // (the PAPI: a lit runway's — a world one unlit has none)
  for (var i = 0u; i < select(4u, 0u, world && (fl & 32u) == 0u); i++) {
    // (from the runway outwards: white above 2.0°, 1.67°, 1.33°, 1.0°)
    let th = 2.0 - 0.3333 * f32(i);
    let col = select(vec3f(1.0, 0.1, 0.06), vec3f(1.0, 0.97, 0.92), elDeg > th);
    lmp += 2.5 * col * lampV(vec2f(a - 450.0, c + hw + 20.0 + 9.0 * f32(i)));
  }
  o.lamps = lmp;
  return o;
}
// (the hit point from the camera [m, the Earth's squashed axes] — set by earthNear for its ground, w: on)
var<private> RWY_HIT: vec4f = vec4f(0.0);

// The windsocks (PLAN-METEO W4): one beside each end's touchdown zone of the runways near — 300 m in, 70 m
// out on the landing's left —, a 6 m mast and its sock 3.6 m long, five bands orange and white, streaming
// with the wind at 10 m (P.runways[0].yzw, towards), drooping in a light one (full out at 15 kt). Cylinders
// met exactly in the runway's own metres; sub-pixel beyond 3 km (none drawn there).
var<private> WS: vec4f = vec4f(0.0);   // the hit's normal (the Earth's physical axes), w: on
var<private> WS_A: vec3f = vec3f(0.0); // its albedo
var<private> WS_T: vec3f = vec3f(0.0); // the light it lets through (leaves), over its albedo's sense
var<private> WS_S: f32 = 0.0;          // its mirror's share at normal incidence (a window's glass, zinc): the sky's and the Sun's reflection
var<private> WS_AO: f32 = 1.0;         // the sky it sees (a wall half of it, its foot less)
// a ray from o (unit d, metres) against the cylinder from p0 along the unit ax, len long, r wide: x the
// distance to it (−1: none), y along it (0 … 1) — from the ray's closest approach to the axis (the camera
// kilometres away, the metres of the radius kept)
fn cylHit(o: vec3f, d: vec3f, p0: vec3f, ax: vec3f, len: f32, r: f32) -> vec2f {
  let oc = o - p0;
  let dd = d - ax * dot(d, ax);
  let A = dot(dd, dd);
  if (A < 1e-8) { return vec2f(-1.0); }
  let oo = oc - ax * dot(oc, ax);
  let tc = -dot(oo, dd) / A;
  let perp = oo + dd * tc;
  let h2 = r * r - dot(perp, perp);
  if (h2 <= 0.0) { return vec2f(-1.0); }
  let t = tc - sqrt(h2 / A);
  if (t <= 0.0) { return vec2f(-1.0); }
  let s = dot(oc + d * t, ax);
  if (s < 0.0 || s > len) { return vec2f(-1.0); }
  return vec2f(t, s / len);
}
// the nearest windsock along the unit physical ray d [m] (tMax: the ground's), WS and WS_A set when met
fn windsocks(d: vec3f, tMax: f32) -> f32 {
  var best = tMax;
  WS = vec4f(0.0);
  WS_T = vec3f(0.0);
  let wv = P.runways[0].yzw;
  let U = length(wv);
  for (var k = 0u; k < rwyCount(); k++) {
    // (the game's own airfields' alone: a world runway has none made up — PLAN-RADAR-AAA RD13)
    if ((runwayFlags(k) & 16u) != 0u) { continue; }
    let up = P.runways[1u + 4u * k].xyz;
    let along = P.runways[2u + 4u * k].xyz;
    let across = P.runways[3u + 4u * k].xyz;
    let L = P.runways[1u + 4u * k].w;
    let hw = P.runways[2u + 4u * k].w;
    let cam = P.runways[4u + 4u * k].xyz;
    let hg = P.runways[4u + 4u * k].w;
    // (the sock's way: the wind's, level, drooping as it slackens — 75° in a calm)
    let wh = wv - up * dot(wv, up);
    let wl = length(wh);
    let dirH = select(along, wh / max(wl, 1e-6), wl > 0.05);
    let droop = (1.0 - clamp(U / 7.7, 0.0, 1.0)) * 1.3;
    let ax = normalize(dirH * cos(droop) - up * sin(droop));
    for (var e = 0u; e < 2u; e++) {
      let a = select(300.0, L - 300.0, e == 1u);
      let c = select(-(hw + 70.0), hw + 70.0, e == 1u);
      // (its foot on the ground: the threshold's tangent plane brought down by the Earth's curve)
      let foot = along * a + across * c + up * (hg - a * a / (2.0 * EARTH_RM));
      let o = cam - foot;
      if (dot(o, o) > 9e6) { continue; }
      let hp = cylHit(o, d, vec3f(0.0), up, 6.0, 0.07);
      if (hp.x > 0.0 && hp.x < best) {
        best = hp.x;
        let p = o + d * hp.x;
        WS = vec4f(normalize(p - up * dot(p, up)), 1.0);
        WS_A = vec3f(0.45, 0.46, 0.47);
      }
      let top = up * 5.8;
      let hs = cylHit(o, d, top, ax, 3.6, 0.32 - 0.12 * 0.5);
      if (hs.x > 0.0 && hs.x < best) {
        best = hs.x;
        let p = o + d * hs.x - top;
        WS = vec4f(normalize(p - ax * dot(p, ax)), 1.0);
        WS_A = select(vec3f(0.85, 0.85, 0.82), vec3f(0.9, 0.28, 0.04), (u32(floor(hs.y * 5.0)) & 1u) == 0u);
      }
    }
  }
  return best;
}
// a windsock's light at q (its normal WS, albedo WS_A): the sun through the air (and the weather's decks),
// the sky's; an airport's object its own light at night too (WS_E: the tower's cab, the terminal's windows)
fn windsockShade(q: vec3f, Ls: vec3f, E: vec3f, h: f32, view: vec3f) -> vec3f {
  let Lp = airPhysicalDirection(Ls);
  let mu0 = dot(geoQ(q), Lp);
  var vl = wxVeil(h, wxNear(q), 3u);
  // (N3: the sunlight through the clouds as the map has it — the trees in a cloud's shadow, beside one in the sun)
  let csT = select(-1.0, cloudShadowAt(q * (1.0 + h / EARTH_RM)), (TUNE_GSKIP & 8192u) == 0u);
  if (csT >= 0.0) { vl.x = csT * vl.y; }
  let Ts = sunThrough(h, mu0);
  let sky = max(skyFlat(q, h, E, mu0, 1.0), E * nightFloor(1.0, mu0));
  var scShadow = 1.0;
  if (NEAR_DETAIL) { scShadow = sceneryShadow(Lp,WS.xyz); }
  let sun = E * Ts * vl.x * scShadow;
  let lit = sun * max(dot(WS.xyz, Lp), 0.0) + (sky * 0.6 * vl.x + E * Ts * max(mu0, 0.0) * (vl.y - vl.x) * 0.6) * WS_AO;
  // leaves against the Sun: the light through the crown's thin edge, brightest looking into the Sun
  let rim = 1.0 - abs(dot(WS.xyz, view));
  let through = WS_T / PI * E * Ts * vl.x * max(-dot(WS.xyz, Lp), 0.0) * rim * (0.3 + 0.7 * pow(max(dot(view, Lp), 0.0), 4.0));
  // (a window's glass, a zinc roof: the sky mirrored at a grazing look — Schlick's Fresnel — and the Sun's glint)
  var mirror = vec3f(0.0);
  if (WS_S > 0.0) {
    let c = clamp(-dot(view, WS.xyz), 0.0, 1.0);
    let F = WS_S + (1.0 - WS_S) * pow(1.0 - c, 5.0);
    let r = reflect(view, WS.xyz);
    mirror = F * (sky / PI * 1.3 * WS_AO + sun * pow(max(dot(r, Lp), 0.0), 600.0) * 40.0);
  }
  return WS_A / PI * lit + through + mirror + WS_E * (luminance(E) / PI) * 30.0 * (1.0 - smoothstep(-0.12, 0.06, mu0));
}

// ---- The airport's buildings and its parked craft (PLAN-AEROPORTS A3), the published frame of each runway
// near (a along from its threshold, c across to the right, h up from its ground) [m], on its left beyond
// the taxiway: the tower (and its beacon), three hangars, the terminal, three airliners on the apron, their
// vehicles. Boxes and cylinders met exactly; one box round them all first (most rays miss it); none past 6 km
// (sub-pixel there).
var<private> WS_E: vec3f = vec3f(0.0);  // the object's own light (the cab's, the windows'), over E
var<private> BEACON: vec3f = vec3f(0.0); // the rotating beacon's glow along this ray, over E/π
// a ray (o, unit d) against an axis-aligned box of the frame (centre, half sizes): x the distance (−1: none),
// yzw the face's normal
fn boxHit(o: vec3f, d: vec3f, cen: vec3f, hs: vec3f) -> vec4f {
  let inv = 1.0 / select(d, vec3f(1e-9), abs(d) < vec3f(1e-9));
  let t0 = (cen - hs - o) * inv;
  let t1 = (cen + hs - o) * inv;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tn = max(max(tmin.x, tmin.y), tmin.z);
  let tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tn > tf || tn <= 0.0) { return vec4f(-1.0); }
  return vec4f(tn, select(vec3f(0.0), -sign(d), tmin == vec3f(tn)));
}
fn airportScenery(dW: vec3f, tMax: f32) -> f32 {
  var best = tMax;
  BEACON = vec3f(0.0);
  WS_E = vec3f(0.0);
  let t = P.runways[17].x;
  for (var k = 0u; k < rwyCount(); k++) {
    // (the game's own airfields' buildings alone: a world runway's are its scenery's)
    if ((runwayFlags(k) & 16u) != 0u) { continue; }
    let up = P.runways[1u + 4u * k].xyz;
    let al = P.runways[2u + 4u * k].xyz;
    let ac = P.runways[3u + 4u * k].xyz;
    let L = P.runways[1u + 4u * k].w;
    let cam = P.runways[4u + 4u * k].xyz;
    let hg = P.runways[4u + 4u * k].w;
    // (the ray in the runway's frame; the ground there its threshold's tangent plane brought down by the curve)
    let o = vec3f(dot(cam, al), dot(cam, ac), dot(cam, up) - hg);
    let d = vec3f(dot(dW, al), dot(dW, ac), dot(dW, up));
    let mid = vec3f(0.5 * L, -215.0, 22.0);
    if (length(o - mid) > 6000.0) { continue; }
    let bb = boxHit(o, d, mid, vec3f(0.27 * L + 40.0, 85.0, 22.0));
    let inside = all(abs(o - mid) < vec3f(0.27 * L + 40.0, 85.0, 22.0));
    if (bb.x < 0.0 && !inside) { continue; }
    let sag = (0.5 * L) * (0.5 * L) / (2.0 * EARTH_RM);
    let oo = o + vec3f(0.0, 0.0, sag);
    var hit = vec4f(-1.0);
    var alb = vec3f(0.5);
    var emit = vec3f(0.0);
    // the tower: its base, shaft, glass cab (lit at night), roof
    let tw = vec2f(0.5 * L, -235.0);
    let parts = array<vec4f, 4>(vec4f(4.0, 6.0, 6.0, 4.0), vec4f(20.0, 2.5, 2.5, 12.0), vec4f(35.0, 5.0, 5.0, 3.0), vec4f(38.5, 5.5, 5.5, 0.5));
    for (var i = 0u; i < 4u; i++) {
      let pt = parts[i];
      let h = boxHit(oo, d, vec3f(tw, pt.x), pt.yzw);
      if (h.x > 0.0 && h.x < best) {
        best = h.x; hit = h;
        alb = select(vec3f(0.62, 0.6, 0.56), vec3f(0.06, 0.08, 0.1), i == 2u);
        emit = select(vec3f(0.0), vec3f(1.0, 0.85, 0.55) * 0.6, i == 2u && h.w == 0.0);
      }
    }
    // three hangars, their doors toward the runway
    for (var i = 0u; i < 3u; i++) {
      let cen = vec3f(0.3 * L + 75.0 * f32(i), -250.0, 9.0);
      let h = boxHit(oo, d, cen, vec3f(32.0, 25.0, 9.0));
      if (h.x > 0.0 && h.x < best) {
        best = h.x; hit = h;
        let p = oo + d * h.x;
        alb = select(vec3f(0.52, 0.55, 0.58), vec3f(0.26, 0.28, 0.3), h.z > 0.5 && p.z < 13.0 && abs(p.x - cen.x) < 27.0);
        emit = vec3f(0.0);
      }
    }
    // the terminal: a band of windows, lit at night
    {
      let cen = vec3f(0.64 * L, -255.0, 6.0);
      let h = boxHit(oo, d, cen, vec3f(70.0, 18.0, 6.0));
      if (h.x > 0.0 && h.x < best) {
        best = h.x; hit = h;
        let p = oo + d * h.x;
        let win = h.w == 0.0 && p.z > 3.0 && p.z < 5.5 && fract(p.x / 4.0 + p.y / 4.0) < 0.7;
        alb = select(vec3f(0.62, 0.62, 0.6), vec3f(0.08, 0.1, 0.12), win);
        emit = select(vec3f(0.0), vec3f(1.0, 0.9, 0.7) * 0.4, win);
      }
    }
    // three airliners on the apron, nose to the taxiway: a fuselage, its wings, its fin; a vehicle by each
    for (var i = 0u; i < 3u; i++) {
      let ax = 0.4 * L + 70.0 * f32(i);
      let f = cylHit(oo, d, vec3f(ax, -192.0, 4.0), vec3f(0.0, 1.0, 0.0), 34.0, 2.0);
      if (f.x > 0.0 && f.x < best) {
        best = f.x;
        let p = oo + d * f.x - vec3f(ax, -192.0, 4.0);
        hit = vec4f(f.x, normalize(vec3f(p.x, 0.0, p.z)));
        alb = vec3f(0.82, 0.83, 0.85);
        emit = vec3f(0.0);
      }
      let w = boxHit(oo, d, vec3f(ax, -178.0, 3.2), vec3f(17.0, 3.0, 0.3));
      if (w.x > 0.0 && w.x < best) { best = w.x; hit = w; alb = vec3f(0.78, 0.79, 0.8); emit = vec3f(0.0); }
      let fin = boxHit(oo, d, vec3f(ax, -189.0, 8.5), vec3f(0.25, 2.8, 3.5));
      if (fin.x > 0.0 && fin.x < best) { best = fin.x; hit = fin; alb = vec3f(0.1, 0.25, 0.6); emit = vec3f(0.0); }
      let v = boxHit(oo, d, vec3f(ax + 14.0, -168.0, 1.4), vec3f(4.0, 1.3, 1.4));
      if (v.x > 0.0 && v.x < best) {
        best = v.x; hit = v;
        alb = select(vec3f(0.8, 0.6, 0.1), vec3f(0.85, 0.85, 0.85), (i & 1u) == 1u);
        emit = vec3f(0.0);
      }
    }
    if (hit.x > 0.0) {
      WS = vec4f(normalize(al * hit.y + ac * hit.z + up * hit.w), 1.0);
      WS_A = alb;
      WS_E = emit;
    }
    // the beacon on the tower: green and white beams, back to back, sweeping 15 times a minute — the glow
    // of the one turned to the eye, along this ray
    let bp = vec3f(tw, 41.0) - oo;
    let tb = dot(bp, d);
    if (tb > 0.0 && tb < best) {
      let miss = length(bp - d * tb);
      let az = atan2(-bp.y, -bp.x);
      let sweep = t * 6.2831853 * 0.25;
      let beam = exp(-0.5 * sq(atan2(sin(az - sweep), cos(az - sweep)) / 0.12));
      let beam2 = exp(-0.5 * sq(atan2(sin(az - sweep - 3.14159265), cos(az - sweep - 3.14159265)) / 0.12));
      let sg = max(0.6, 0.0015 * tb);
      let glow = exp(-0.5 * miss * miss / (sg * sg)) / (sg * sg);
      BEACON += (vec3f(0.3, 1.0, 0.45) * beam + vec3f(1.0, 0.95, 0.85) * beam2) * glow * 2.0;
    }
  }
  return best;
}

fn earthUV(q: vec3f) -> vec2f {
  return vec2f(0.5 + atan2(q.y, q.x) / TAU, 0.5 - asin(clamp(q.z, -1.0, 1.0)) / PI);
}
// cubic B-spline weights (texels −1 … +2): the map smooth — no facets between its texels
fn bspline4(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4f(1.0 - 3.0 * t + 3.0 * t2 - t3, 4.0 - 6.0 * t2 + 3.0 * t3, 1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3, t3) / 6.0;
}
// an interpolating cubic's weights (Catmull–Rom): through the texels themselves — a cliff kept a cliff, its top its height
fn catmullRom4(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4f(-0.5 * t + t2 - 0.5 * t3, 1.0 - 2.5 * t2 + 1.5 * t3, 0.5 * t + 2.0 * t2 - 1.5 * t3, -0.5 * t2 + 0.5 * t3);
}
// a monotone cubic through four samples at f in [0, 1] between the middle two (Fritsch–Butland's slopes: the harmonic mean of
// the two sides', 0 at an extremum) — through the data, no overshoot: a cliff stays a cliff, no lip above its top
fn monoCubic(p0: f32, p1: f32, p2: f32, p3: f32, f: f32) -> f32 {
  let d0 = p1 - p0;
  let d1 = p2 - p1;
  let d2 = p3 - p2;
  let m1 = select(0.0, 2.0 * d0 * d1 / (d0 + d1), d0 * d1 > 0.0);
  let m2 = select(0.0, 2.0 * d1 * d2 / (d1 + d2), d1 * d2 > 0.0);
  let f2 = f * f;
  let f3 = f2 * f;
  return (2.0 * f3 - 3.0 * f2 + 1.0) * p1 + (f3 - 2.0 * f2 + f) * m1 + (-2.0 * f3 + 3.0 * f2) * p2 + (f3 - f2) * m2;
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
const TILE_LEVELS = 12u; // (z 6 … 17 — the last three over France alone, the IGN's relief: src/system/earth-tiles.ts Z1)
const TILE_RES_MIN = 25.0;
// a survey's own resolution [m] (earth-tiles.ts TILE_RES_FINE: the IGN's)
const TILE_RES_FINE = 1.0;
// a level's texel at i (from its valid rectangle's corner), in its layer (toroidal: modulo its window's side)
fn tileTexel(l: u32, i: vec2i) -> f32 {
  // (a level's window: 4 or 8 tiles a side — EarthTiles.setReach, its fine levels —, its side a power of two in
  // P.tileL[2l + 1].w: wrapped by a mask)
  let t = (vec2i(P.tileL[2u * l].zw) + i) & vec2i(i32(P.tileL[2u * l + 1u].w) - 1);
  return bitcast<f32>(textureLoad(earthTiles, t, l, 0).r);
}
// whether a level's texel at i is a survey's height (the IGN's: its float's last bit — earth-tiles.ts markFine)
fn tileFine(l: u32, i: vec2i) -> bool {
  let t = (vec2i(P.tileL[2u * l].zw) + i) & vec2i(i32(P.tileL[2u * l + 1u].w) - 1);
  return (textureLoad(earthTiles, t, l, 0).r & 1u) == 1u;
}
fn tileImage(l: u32, i: vec2i) -> u32 {
  // (its level's window's side: P.tileL[2l + 1].w — tileTexel)
  let t = (vec2i(P.tileL[2u * l].zw) + i) & vec2i(i32(P.tileL[2u * l + 1u].w) - 1);
  return textureLoad(earthTiles, t, l, 0).g;
}
const TILE_IMG_LEVELS = 9u; // (z 6 … 14: src/system/earth-tiles.ts, IMG_Z1)
// The tiles' imagery at q for a footprint foot [m] (src/system/earth-tiles.ts: GIBS, EOX's Sentinel-2): the finest level
// within the footprint and the next coarser, blended by the footprint and towards their windows' edges
// (as earthH); rgb the day's colour (linear), a the night's lights; w its weight — the global maps' the rest
// (none beyond the windows, nor where a tile's imagery did not come)
// (o: the IGN's orthophotos' share of it — earthGround draws them over the regional pilot's imagery)
struct TileImage { c: vec4f, w: f32, o: f32 };
// an orthophotos' level's texel at i (from its valid rectangle's corner): its 1024² quadrant of its layer, toroidal
fn orthoImage(k: u32, i: vec2i) -> u32 {
  let a = bodies[ORTHO_OFF + 3u * k];
  let c = bodies[ORTHO_OFF + 3u * k + 2u];
  let t = vec2i(c.yz) + ((vec2i(a.zw) + i) & vec2i(1023));
  return textureLoad(earthTiles, t, u32(c.x), 0).g;
}
// (the coarser levels' night lights — their alpha — wanted: the raster's material says when its ground is in the day, the
// orthophotos covering it then all it reads — TERRE-UNREAL U6)
var<private> IMG_LIGHTS: bool = true;
fn earthImagery(q: vec3f, foot: f32) -> TileImage {
  var o: TileImage;
  o.c = vec4f(0.0);
  o.w = 0.0;
  o.o = 0.0;
  if (P.tiles.w < 0.5) { return o; }
  let cosLat = sqrt(max(1.0 - q.z * q.z, 1e-12));
  let tc = tileCoord(q);
  let dlon = tc.x;
  let dM = tc.y;
  let zf = log2(EARTH_RM * TAU * cosLat / (256.0 * max(foot, 0.1)));
  // (over France, finer: the IGN's orthophotos, z 15 … 18 — their colour alone, over the coarser levels' below; the
  // night's lights theirs)
  var fine = vec3f(0.0);
  var wf = 0.0;
  for (var kk = 0; kk < i32(ORTHO_LEVELS); kk++) {
    let k = ORTHO_LEVELS - 1u - u32(kk);
    let a = bodies[ORTHO_OFF + 3u * k];
    let b = bodies[ORTHO_OFF + 3u * k + 1u];
    if (b.w < 0.5) { continue; }
    let wz = clamp(zf - bodies[ORTHO_OFF + 3u * k + 2u].w + 1.0, 0.0, 1.0);
    if (wz <= 0.0) { continue; }
    let p = a.xy + vec2f(dlon, -dM) * b.z;
    let d = min(min(p.x, p.y), min(b.x - p.x, b.y - p.y));
    let w = wz * smoothstep(2.0, 48.0, d);
    if (w <= 0.0) { continue; }
    let x = p - 0.5;
    let i0 = vec2i(floor(x));
    let f = x - floor(x);
    let t00 = orthoImage(k, i0);
    let t10 = orthoImage(k, i0 + vec2i(1, 0));
    let t01 = orthoImage(k, i0 + vec2i(0, 1));
    let t11 = orthoImage(k, i0 + vec2i(1, 1));
    if (min(min(t00, t10), min(t01, t11)) == 0u) { continue; }
    let c = mix(mix(unpack4x8unorm(t00), unpack4x8unorm(t10), f.x), mix(unpack4x8unorm(t01), unpack4x8unorm(t11), f.x), f.y);
    let lin = select(pow((c.rgb + 0.055) / 1.055, vec3f(2.4)), c.rgb / 12.92, c.rgb <= vec3f(0.04045));
    fine += (1.0 - wf) * w * lin;
    wf += (1.0 - wf) * w;
    if (wf > 0.9999) { break; }
  }
  // (the orthophotos covering it all, by day: the coarser levels under them not read — their colour hidden, their alpha the
  // night's lights)
  if (wf > 0.9999 && !IMG_LIGHTS) {
    o.c = vec4f(fine / wf, 0.0);
    o.w = 1.0;
    o.o = 1.0;
    return o;
  }
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
  // (over France, the orthophotos on: the relief's levels' imagery is the IGN's — a photograph as the finer ones, drawn
  // over the regional pilot's 10 m as they are)
  let box = bodies[ORTHO_OFF + 3u * ORTHO_LEVELS];
  if (bodies[ORTHO_OFF + 3u * ORTHO_LEVELS + 1u].x > 0.5 && o.w > 0.0) {
    let lat = asin(clamp(q.z, -1.0, 1.0));
    let lon = atan2(q.y, q.x);
    if (lon > box.x && lon < box.z && lat > box.y && lat < box.w) { o.o = o.w; }
  }
  if (wf > 0.0) {
    // (the orthophotos over the coarser imagery — or over the global maps where none is)
    let w = wf + (1.0 - wf) * o.w;
    o.c = vec4f((fine + (1.0 - wf) * o.w * o.c.rgb) / w, o.c.a);
    o.o = wf + (1.0 - wf) * o.o;
    o.w = w;
  }
  return o;
}
// The tiles' imagery over a pixel's footprint (its axes fx, fy on the unit sphere), filtered anisotropically: read at the
// level of the footprint's short axis, n taps spread along the long one (n its elongation, TUNE_ANISO at most) — one read at
// the long axis's level (the isotropic) blurred a grazing ground both ways: in level flight, the city a kilometre ahead
// drawn as a mush of its average colours, sharp only once a still view had accumulated hundreds of samples
fn earthImageryAniso(gq: vec3f, fx: vec3f, fy: vec3f) -> TileImage {
  // (TERRE-UNREAL U6: the taps' places on the tiles from the centre's and its axis's — linear over a pixel's footprint —, not
  // each from its own atan2 and atanh; each level's window read once for all its taps; the sRGB curve once a level, over the
  // taps' mean)
  let la = length(fx);
  let lb = length(fy);
  let fMaj = max(la, lb);
  let fMin = max(min(la, lb), 1e-12);
  let n = u32(clamp(ceil(fMaj / fMin - 0.25), 1.0, f32(max(TUNE_ANISO, 1u))));
  var o: TileImage;
  o.c = vec4f(0.0);
  o.w = 0.0;
  o.o = 0.0;
  if (P.tiles.w < 0.5) { return o; }
  let ax = select(fy, fx, la >= lb);
  let foot = select(fMaj, max(fMaj / f32(n), fMin), n > 1u) * EARTH_RM;
  let q = gq;
  let cosLat = sqrt(max(1.0 - q.z * q.z, 1e-12));
  let uv0 = imageryUv(q);
  // (along the long axis, across its whole length: the taps at (i + ½)/n − ½ of it — its length on the tiles by their
  // derivatives at the point, d atan2(y, x) and d atanh(z): no difference of two nearby places, their float32 rounding in it)
  var duv = vec2f(0.0);
  if (n > 1u) { duv = vec2f((q.x * ax.y - q.y * ax.x) / max(dot(q.xy, q.xy), 1e-12), -ax.z / max(1.0 - q.z * q.z, 1e-12)); }
  let zf = log2(EARTH_RM * TAU * cosLat / (256.0 * max(foot, 0.1)));
  let nf = f32(n);
  var fine = vec3f(0.0);
  var wf = 0.0;
  for (var kk = 0; kk < i32(ORTHO_LEVELS); kk++) {
    let k = ORTHO_LEVELS - 1u - u32(kk);
    let a = bodies[ORTHO_OFF + 3u * k];
    let b = bodies[ORTHO_OFF + 3u * k + 1u];
    if (b.w < 0.5) { continue; }
    let cc = bodies[ORTHO_OFF + 3u * k + 2u];
    let wz = clamp(zf - cc.w + 1.0, 0.0, 1.0);
    if (wz <= 0.0) { continue; }
    let p0 = a.xy + uv0 * b.z;
    let d = min(min(p0.x, p0.y), min(b.x - p0.x, b.y - p0.y));
    let w = wz * smoothstep(2.0, 48.0, d);
    if (w <= 0.0) { continue; }
    let dp = duv * b.z;
    let base = vec2i(cc.yz);
    let corner = vec2i(a.zw);
    var sum = vec4f(0.0);
    var whole = true;
    for (var i = 0u; i < n; i++) {
      let x = p0 + dp * ((f32(i) + 0.5) / nf - 0.5) - 0.5;
      let i0 = vec2i(floor(x));
      let f = x - floor(x);
      let t00 = textureLoad(earthTiles, base + ((corner + i0) & vec2i(1023)), u32(cc.x), 0).g;
      let t10 = textureLoad(earthTiles, base + ((corner + i0 + vec2i(1, 0)) & vec2i(1023)), u32(cc.x), 0).g;
      let t01 = textureLoad(earthTiles, base + ((corner + i0 + vec2i(0, 1)) & vec2i(1023)), u32(cc.x), 0).g;
      let t11 = textureLoad(earthTiles, base + ((corner + i0 + vec2i(1, 1)) & vec2i(1023)), u32(cc.x), 0).g;
      if (min(min(t00, t10), min(t01, t11)) == 0u) { whole = false; break; }
      sum += mix(mix(unpack4x8unorm(t00), unpack4x8unorm(t10), f.x), mix(unpack4x8unorm(t01), unpack4x8unorm(t11), f.x), f.y);
    }
    if (!whole) { continue; }
    let c = sum / nf;
    let lin = select(pow((c.rgb + 0.055) / 1.055, vec3f(2.4)), c.rgb / 12.92, c.rgb <= vec3f(0.04045));
    fine += (1.0 - wf) * w * lin;
    wf += (1.0 - wf) * w;
    if (wf > 0.9999) { break; }
  }
  if (wf > 0.9999 && !IMG_LIGHTS) {
    o.c = vec4f(fine / wf, 0.0);
    o.w = 1.0;
    o.o = 1.0;
    return o;
  }
  var rem = 1.0;
  for (var li = 0; li < i32(TILE_IMG_LEVELS); li++) {
    let l = TILE_IMG_LEVELS - 1u - u32(li);
    let a = P.tileL[2u * l];
    let b = P.tileL[2u * l + 1u];
    if (b.w < 0.5) { continue; }
    let wz = clamp(zf - f32(TILE_Z0 + l) + 1.0, 0.0, 1.0);
    if (wz <= 0.0) { continue; }
    let p0 = a.xy + uv0 * b.z;
    let d = min(min(p0.x, p0.y), min(b.x - p0.x, b.y - p0.y));
    let w = wz * smoothstep(2.0, 48.0, d);
    if (w <= 0.0) { continue; }
    let dp = duv * b.z;
    let corner = vec2i(a.zw);
    let mask = vec2i(i32(b.w) - 1);
    var sum = vec4f(0.0);
    var whole = true;
    for (var i = 0u; i < n; i++) {
      let x = p0 + dp * ((f32(i) + 0.5) / nf - 0.5) - 0.5;
      let i0 = vec2i(floor(x));
      let f = x - floor(x);
      let t00 = textureLoad(earthTiles, (corner + i0) & mask, l, 0).g;
      let t10 = textureLoad(earthTiles, (corner + i0 + vec2i(1, 0)) & mask, l, 0).g;
      let t01 = textureLoad(earthTiles, (corner + i0 + vec2i(0, 1)) & mask, l, 0).g;
      let t11 = textureLoad(earthTiles, (corner + i0 + vec2i(1, 1)) & mask, l, 0).g;
      if (min(min(t00, t10), min(t01, t11)) == 0u) { whole = false; break; }
      sum += mix(mix(unpack4x8unorm(t00), unpack4x8unorm(t10), f.x), mix(unpack4x8unorm(t01), unpack4x8unorm(t11), f.x), f.y);
    }
    if (!whole) { continue; }
    let c = sum / nf;
    let lin = select(pow((c.rgb + 0.055) / 1.055, vec3f(2.4)), c.rgb / 12.92, c.rgb <= vec3f(0.04045));
    o.c += rem * w * vec4f(lin, c.a);
    o.w += rem * w;
    rem *= 1.0 - w;
    if (rem < 1e-4) { break; }
  }
  if (o.w > 0.0) { o.c /= o.w; }
  let box = bodies[ORTHO_OFF + 3u * ORTHO_LEVELS];
  if (bodies[ORTHO_OFF + 3u * ORTHO_LEVELS + 1u].x > 0.5 && o.w > 0.0) {
    let lat = asin(clamp(q.z, -1.0, 1.0));
    let lon = atan2(q.y, q.x);
    if (lon > box.x && lon < box.z && lat > box.y && lat < box.w) { o.o = o.w; }
  }
  if (wf > 0.0) {
    let w = wf + (1.0 - wf) * o.w;
    o.c = vec4f((fine + (1.0 - wf) * o.w * o.c.rgb) / w, o.c.a);
    o.o = wf + (1.0 - wf) * o.o;
    o.w = w;
  }
  return o;
}
// a direction's place on the tiles' Mercator: its longitude from their anchor's, its Mercator ordinate's from the anchor's,
// negated (earthImagery's dlon, −dM)
fn imageryUv(q: vec3f) -> vec2f {
  let tc = tileCoord(q);
  return vec2f(tc.x, -tc.y);
}
// A point's place on the tiles from their reference — the camera's place —: x its longitude from it [rad], y Mercator's y
// from it. From a unit-sphere point in float32 (~0.4 m: the orthophotos' texel, read a step at a time — the ground near the
// camera in flat squares) the longitude by a turned atan2, Mercator's y by atanh(a) − atanh(b) = atanh((a − b)/(1 − ab)); the
// raster's ground point near the camera from the camera's anchor instead — its place float64 on the CPU (renderer: envY.w,
// envZ.w) — and its small offset from it (tileAnchor): TILE_AT, set by the material kernel round its imagery's and slopes'
// reads of that very point (TILE_AT_ON), off at once after
// (within this of the camera [m]: the levels finer than the float32 point's ~0.4 m read there — further, its footprint coarser)
const TILE_ANCHOR_M = 2000.0;
var<private> TILE_AT: vec2f = vec2f(0.0);
var<private> TILE_AT_ON: bool = false;
fn tileCoord(q: vec3f) -> vec2f {
  if (TILE_AT_ON) { return TILE_AT; }
  return tilePlace(q);
}
// (the heights' — earthH, in every march —: the plain place, the anchor's test left out of their loops; the terrain cache's
// bake its anchored one — terrain-cache.ts)
fn tileHeightCoord(q: vec3f) -> vec2f { return tilePlace(q); }
fn tilePlace(q: vec3f) -> vec2f {
  let sz = clamp(q.z, -0.999999, 0.999999);
  return vec2f(atan2(-q.x * P.tiles.y + q.y * P.tiles.x, q.x * P.tiles.x + q.y * P.tiles.y), atanh((sz - P.tiles.z) / (1.0 - sz * P.tiles.z)));
}
// the place on the tiles of the point rel from the camera's anchor (P.nearCam0) on the squashed axes [radii]: the anchor's
// float64 one plus the offset's, each exact from small numbers — the longitude's turn by atan2(A × r, A · (A + r)), the
// sine of the latitude's change without a difference of nearby ones
fn tileAnchor(rel: vec3f) -> vec2f {
  let A = P.nearCam0.xyz;
  let G = vec3f(A.xy, A.z * EARTH_AB);
  let r = vec3f(rel.xy, rel.z * EARTH_AB);
  let dl = atan2(G.x * r.y - G.y * r.x, dot(G.xy, G.xy) + dot(G.xy, r.xy));
  let m = length(G);
  let n = length(G + r);
  let sA = G.z / m;
  let ds = r.z / n - G.z * (2.0 * dot(G, r) + dot(r, r)) / ((m + n) * n * m);
  return vec2f(P.envY.w + dl, P.envZ.w + atanh(ds / (1.0 - (sA + ds) * sA)));
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
  // (magnified: a cubic over 4 × 4 texels — the B-spline smooth but approximating: a butte's 150 m wall spread into a slope of
  // two or three texels, its top lowered; Catmull–Rom, TUNE_TILE_CR, through the data)
  if (TUNE_TILE_CR == 2u) {
    var rows: array<f32, 4>;
    for (var j = 0; j < 4; j++) {
      rows[j] = monoCubic(tileTexel(l, i0 + vec2i(-1, j - 1)), tileTexel(l, i0 + vec2i(0, j - 1)), tileTexel(l, i0 + vec2i(1, j - 1)),
        tileTexel(l, i0 + vec2i(2, j - 1)), f.x);
    }
    return mix(lin, monoCubic(rows[0], rows[1], rows[2], rows[3], f.y), k);
  }
  let cr = TUNE_TILE_CR > 0u;
  let wx = select(bspline4(f.x), catmullRom4(f.x), cr);
  let wy = select(bspline4(f.y), catmullRom4(f.y), cr);
  var b = 0.0;
  for (var j = 0; j < 4; j++) {
    var row = 0.0;
    for (var i = 0; i < 4; i++) { row += wx[i] * tileTexel(l, i0 + vec2i(i - 1, j - 1)); }
    b += wy[j] * row;
  }
  return mix(lin, b, k);
}
// ---- the Moon's and Mars's relief tiles (PLAN-PLANETES-AAA P6, P7; src/system/moon-tiles.ts: LOLA's 118 m, the HRSC and MOLA
// blend's 200 m in equirectangular levels, the same weights on the CPU — heightAt) through the Earth's tiles' binding and
// params while that world is the near body: P.tiles.w −1 their mark; P.tileL[16]: their windows' rise over the map [m], the
// first relief level (Mars's finer ones carry imagery alone), the coarsest level, the imagery's finest [m]; the world's
// radius P.hd2.w
const MOON_LEVELS = 8u;
fn moonTilesOn() -> bool { return P.tiles.w < -0.5; }
// their height at q (the Moon's axes) for a footprint [m] — the finest level within it and the next coarser, blended by the
// footprint and towards their windows' edges, as earthH — and the weight left to the global map (y)
fn moonH(q: vec3f, foot: f32, cheap: bool) -> vec2f {
  // (from the reference — the camera's place —: the longitude by a turned atan2, the latitude's difference by another, no
  // float32 cancellation near the camera)
  let dlon = atan2(-q.x * P.tiles.y + q.y * P.tiles.x, q.x * P.tiles.x + q.y * P.tiles.y);
  let cosRef = sqrt(max(1.0 - P.tiles.z * P.tiles.z, 0.0));
  let rho = length(q.xy);
  let dlat = atan2(q.z * cosRef - rho * P.tiles.z, rho * cosRef + q.z * P.tiles.z);
  var h = 0.0;
  var rem = 1.0;
  for (var l = u32(P.tileL[16].y); l < MOON_LEVELS; l++) {
    let a = P.tileL[2u * l];
    let b = P.tileL[2u * l + 1u];
    if (b.w < 0.5) { continue; }
    // (its texel R / b.z [m] by the footprint: under half of it, the level left to the coarser one)
    let zf = log2(P.hd2.w / (b.z * max(foot, 0.5)));
    let wz = clamp(zf + 1.0, 0.0, 1.0);
    if (wz <= 0.0) { continue; }
    let p = a.xy + vec2f(dlon, -dlat) * b.z;
    let w = wz * smoothstep(2.0, 48.0, min(min(p.x, p.y), min(b.x - p.x, b.y - p.y)));
    if (w <= 0.0) { continue; }
    h += rem * w * moonSample(l, p, cheap || TUNE_CHEAP > 0u);
    rem *= 1.0 - w;
    if (rem < 1e-4) { break; }
  }
  return vec2f(h, rem);
}
// a level's height at p [its px from the corner] (moon-tiles.ts moonSample, the same): a monotone cubic through its 4 × 4
// texels — a crater's rim kept sharp —, or bilinear (cheap: the marches' steps); in loops, one copy of each read
fn moonSample(l: u32, p: vec2f, cheap: bool) -> f32 {
  let x = p - 0.5;
  let i0 = vec2i(floor(x));
  let f = x - floor(x);
  if (cheap) {
    var c: array<f32, 4>;
    for (var k = 0; k < 4; k++) { c[k] = tileTexel(l, i0 + vec2i(k & 1, k >> 1)); }
    return mix(mix(c[0], c[1], f.x), mix(c[2], c[3], f.x), f.y);
  }
  var rows: array<f32, 4>;
  for (var j = 0; j < 4; j++) {
    var t: array<f32, 4>;
    for (var i = 0; i < 4; i++) { t[i] = tileTexel(l, i0 + vec2i(i - 1, j - 1)); }
    rows[j] = monoCubic(t[0], t[1], t[2], t[3], f.x);
  }
  return monoCubic(rows[0], rows[1], rows[2], rows[3], f.y);
}
// a level's imagery at p [its px] (moon-tiles.ts worldImagery: the Moon's Clementine grey in rgb; Mars's Viking colour in rgb,
// CTX's grey in a), bilinear; −1 where a texel has none
fn moonImg(l: u32, p: vec2f) -> vec4f {
  let x = p - 0.5;
  let i0 = vec2i(floor(x));
  let f = x - floor(x);
  let a = tileImage(l, i0);
  let b = tileImage(l, i0 + vec2i(1, 0));
  let c = tileImage(l, i0 + vec2i(0, 1));
  let d = tileImage(l, i0 + vec2i(1, 1));
  if (a == 0u || b == 0u || c == 0u || d == 0u) { return vec4f(-1.0); }
  let v = mix(mix(unpack4x8unorm(a), unpack4x8unorm(b), f.x), mix(unpack4x8unorm(c), unpack4x8unorm(d), f.x), f.y);
  // (a hole in the finer imagery — Mars's CTX: alpha 0 — at a corner: none here, not a darkened edge)
  let holed = (a >> 24u) == 0u || (b >> 24u) == 0u || (c >> 24u) == 0u || (d >> 24u) == 0u;
  return vec4f(v.rgb, select(v.a, 0.0, holed));
}
// A world's albedo's finer detail at q for a footprint [m] (PLAN-PLANETES-AAA P6, P7): the finest level's imagery over the
// coarsest's, a factor on the calibrated map's colour — its colours' ratio (the Moon's grey, Mars's Viking) times its
// alpha's (Mars's CTX: 1 on the Moon) —; 1 where none, and fading as the footprint outgrows the level or the imagery
fn moonDetail(q: vec3f, foot: f32) -> vec3f {
  if (!moonTilesOn()) { return vec3f(1.0); }
  let dlon = atan2(-q.x * P.tiles.y + q.y * P.tiles.x, q.x * P.tiles.x + q.y * P.tiles.y);
  let cosRef = sqrt(max(1.0 - P.tiles.z * P.tiles.z, 0.0));
  let rho = length(q.xy);
  let dlat = atan2(q.z * cosRef - rho * P.tiles.z, rho * cosRef + q.z * P.tiles.z);
  let lc = u32(P.tileL[16].z);
  let ac = P.tileL[2u * lc];
  let bc = P.tileL[2u * lc + 1u];
  if (bc.w < 0.5) { return vec3f(1.0); }
  let pc = ac.xy + vec2f(dlon, -dlat) * bc.z;
  let ec = smoothstep(2.0, 48.0, min(min(pc.x, pc.y), min(bc.x - pc.x, bc.y - pc.y)));
  let coarse = moonImg(lc, pc);
  if (ec <= 0.0 || coarse.x < 0.0) { return vec3f(1.0); }
  for (var l = 0u; l < lc; l++) {
    let a = P.tileL[2u * l];
    let b = P.tileL[2u * l + 1u];
    if (b.w < 0.5) { continue; }
    let p = a.xy + vec2f(dlon, -dlat) * b.z;
    let e = smoothstep(2.0, 48.0, min(min(p.x, p.y), min(b.x - p.x, b.y - p.y)));
    // (its detail no finer than the imagery's own: faded as the footprint outgrows that, or the level's texel)
    let w = e * clamp(log2(max(P.tileL[16].w, P.hd2.w / b.z) / max(foot, 0.05)) + 1.0, 0.0, 1.0);
    if (w <= 0.0) { continue; }
    let fine = moonImg(l, p);
    // (a level without the finer imagery here — Mars's CTX missing: its alpha 0 —: a coarser one's)
    if (fine.x < 0.0 || fine.a < 0.002) { continue; }
    let ctx = select(1.0, clamp(fine.a / coarse.a, 0.4, 2.5), coarse.a > 0.002);
    let tint = clamp(fine.rgb / max(coarse.rgb, vec3f(0.02)), vec3f(0.4), vec3f(2.5)) * ctx;
    return mix(vec3f(1.0), tint, w * ec);
  }
  return vec3f(1.0);
}
// the Moon's tiles' normal at q (its axes) for a footprint [m] — the near ground's (shadeNear: HD_N), no finer than half
// the finest drawn level's texel (59 m at z 0), from the cubic heights
fn moonNormal(q: vec3f, foot: f32) -> vec3f {
  let R = P.hd2.w;
  var texel = R * TAU / f32(textureDimensions(hdRelief).x);
  for (var l = u32(P.tileL[16].y); l < MOON_LEVELS; l++) {
    let b = P.tileL[2u * l + 1u];
    if (b.w > 0.5) { texel = min(texel, R / b.z); }
  }
  let e = max(foot, 0.5 * texel) / R;
  let t1 = normalize(cross(q, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(q.z) > 0.9)));
  let t2 = cross(q, t1);
  var hs = array<f32, 3>(0.0, 0.0, 0.0);
  for (var i = 0; i < 3; i++) {
    let qi = select(select(q, normalize(q + t1 * e), i == 1), normalize(q + t2 * e), i == 2);
    hs[i] = demFine(qi, foot, false);
  }
  return normalize(q - ((hs[1] - hs[0]) * t1 + (hs[2] - hs[0]) * t2) / (e * R));
}
// the measured heights [m] at q for a footprint: the tiles' over the global map's (demH0; cheap: demStep)
fn demFine(q: vec3f, foot: f32, cheap: bool) -> f32 {
  var t = vec2f(0.0, 1.0);
  if (moonTilesOn()) { t = moonH(q, foot, cheap); }
  if (t.y < 1e-4) { return t.x; }
  var g = 0.0;
  if (cheap) { g = demStep(q, foot); } else { g = demH0(q, foot); }
  return t.x + t.y * g;
}
// The ground's height under the map's finer detail at q for a footprint foot [m]: the tiles' levels — the
// finest within the footprint and the next coarser, blended by the footprint and towards their windows'
// edges — over the global map where they leave off; y: the heights' resolution [m] (earthDetail). cheap:
// bilinear only (the shadows' march)
fn earthH(q: vec3f, foot: f32, cheap: bool) -> vec2f {
  cost(1u);
  let texelA = EARTH_RM * TAU / f32(textureDimensions(earthElev).x);
  if (P.tiles.w < 0.5) { return vec2f(earthH0(q, foot), texelA); }
  let cosLat = sqrt(max(1.0 - q.z * q.z, 1e-12));
  // (from the reference — the camera's place —: tileHeightCoord)
  let tc = tileHeightCoord(q);
  let dlon = tc.x;
  let dM = tc.y;
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
    h += rem * w * tileSample(l, p, select(zf - z, 0.0, cheap || TUNE_CHEAP > 0u));
    // (the data's own resolution: a survey's its texel's, the global data's no finer than SRTM's — the nearest texel's mark)
    res += rem * w * max(EARTH_RM * cosLat / b.z, select(TILE_RES_MIN, TILE_RES_FINE, tileFine(l, vec2i(floor(p)))));
    rem *= 1.0 - w;
    if (rem < 1e-4) { break; }
  }
  if (rem >= 1e-4) {
    h += rem * earthH0(q, foot);
    res += rem * texelA;
  }
  return vec2f(h, res);
}
// The sea's depth at q [m] (geodetic; foot its footprint, unused: the depths are smooth) and how sure it is (0: no tile here —
// the deep sea assumed). Terrarium's bathymetry (ETOPO1, GEBCO) goes up to z 10 alone — finer, SRTM's, the sea a flat 0 —:
// read from the z 10 level's window (~120 m a texel at 36°), else z 9's, z 8's. Its texels at 0 or over are SRTM's sea there
// too, or land — no depth —: the bilinear weights over the others alone; a level without enough of them, or near its window's
// rim, leaves its share to the coarser one (as earthH: no seam where a window ends).
fn seaDepthAt(q: vec3f, foot: f32) -> vec2f {
  if (P.tiles.w < 0.5) { return vec2f(1e4, 0.0); }
  let dlon = atan2(-q.x * P.tiles.y + q.y * P.tiles.x, q.x * P.tiles.x + q.y * P.tiles.y);
  let sz = clamp(q.z, -0.999999, 0.999999);
  let dM = atanh((sz - P.tiles.z) / (1.0 - sz * P.tiles.z));
  var acc = 0.0;
  var wsum = 0.0;
  var rem = 1.0;
  for (var li = 0u; li < 3u; li++) {
    let l = 10u - TILE_Z0 - li;
    let a = P.tileL[2u * l];
    let b = P.tileL[2u * l + 1u];
    if (b.w < 0.5) { continue; }
    let p = a.xy + vec2f(dlon, -dM) * b.z;
    let edge = smoothstep(2.0, 48.0, min(min(p.x, p.y), min(b.x - p.x, b.y - p.y)));
    if (edge <= 0.0) { continue; }
    let x = p - 0.5;
    let i0 = vec2i(floor(x));
    let f = x - floor(x);
    var hv = 0.0;
    var wv = 0.0;
    for (var k = 0; k < 4; k++) {
      let o = vec2i(k & 1, k >> 1);
      let h = tileTexel(l, i0 + o);
      let w = select(1.0 - f.x, f.x, o.x == 1) * select(1.0 - f.y, f.y, o.y == 1);
      if (h < -0.5) {
        hv += w * h;
        wv += w;
      }
    }
    let c = edge * smoothstep(0.25, 0.6, wv);
    if (c > 0.0) {
      acc += rem * c * (-hv / wv);
      wsum += rem * c;
      rem *= 1.0 - c;
      if (rem < 1e-3) { break; }
    }
  }
  if (wsum < 0.05) { return vec2f(1e4, 0.0); }
  return vec2f(acc / wsum, smoothstep(0.05, 0.6, wsum));
}
// The geoid's height N over the ellipsoid [m] at a geodetic direction g (system/geoid.ts geoidN: the same map, read
// the same way): the mean sea's surface, and what the heights above the sea are raised by. 0 until the map is in.
fn geoidNode(x: u32, y: u32) -> f32 {
  let n = y * GEOID_W + x;
  return bodies[GEOID_OFF + n / 4u][n % 4u];
}
fn geoidN(g: vec3f) -> f32 {
  let lat = asin(clamp(g.z, -1.0, 1.0));
  var x = (atan2(g.y, g.x) / TAU + 0.5) * f32(GEOID_W) - 0.5;
  x -= floor(x / f32(GEOID_W)) * f32(GEOID_W);
  let y = clamp((0.5 - lat / PI) * f32(GEOID_H) - 0.5, 0.0, f32(GEOID_H - 1u));
  let x0 = min(u32(floor(x)), GEOID_W - 1u);
  let y0 = min(u32(floor(y)), GEOID_H - 2u);
  let x1 = select(x0 + 1u, 0u, x0 + 1u == GEOID_W);
  let f = vec2f(x - f32(x0), y - f32(y0));
  let a = mix(geoidNode(x0, y0), geoidNode(x1, y0), f.x);
  let b = mix(geoidNode(x0, y0 + 1u), geoidNode(x1, y0 + 1u), f.x);
  return mix(a, b, f.y);
}
fn earthHeightExactG(q: vec3f, foot: f32) -> f32 {
  let hr = earthH(q, foot, false);
  // (a runway's airfield graded: at its level, its detail off — the gear's ground the same)
  var g = vec3f(0.0);
  if (HAS_RWY) { g = runwayGrade(q); }
  let h0 = mix(hr.x, g.z, g.y);
  if (g.x >= 1.0) { return max(h0, 0.0); }
  if (NEAR_DETAIL && GROUND_DETAIL) { return max(h0 + (1.0 - g.x) * earthDetail(q, h0, foot, hr.y), 0.0); }
  return max(h0, 0.0);
}
// BEGIN_TERRAIN_CACHE (system/terrain-cache.ts supplies the existing table lookup)
fn terrainCachedHeight(q: vec3f, foot: f32) -> f32 { return -1.0; }
// END_TERRAIN_CACHE
// (the heights above the sea — the cache's, the exact ones — over the ellipsoid: raised by the geoid)
fn earthHeightG(q: vec3f, foot: f32) -> f32 {
  if (HAS_TERRAIN_CACHE) {
    if (!HAS_RWY || runwayGrade(q).x <= 0.0) {
      let h = terrainCachedHeight(q, foot);
      if (h >= 0.0) { return h + geoidN(q); }
    }
  }
  return earthHeightExactG(q, foot) + geoidN(q);
}
// The ground's height at a unit direction q of the squashed space, as a radial height there [m of a]: the
// relief read at its geodetic direction (src/terrain.ts: earthHeightSampler, the same), over the scale
// (src/system/our-surface.ts: the gear's ground)
fn earthHeight(q: vec3f, foot: f32) -> f32 { return earthHeightG(geoQ(q), foot) / earthSq(q); }
// the same, cheaply, for the march's steps: the map filtered by the hardware, the detail coarser (a
// dispatch that takes seconds loses the GPU) — the crossing then refined on earthHeight
fn earthHeightStep(q: vec3f, foot: f32) -> f32 { let g = geoQ(q); return (earthHeightStepG(g, foot) + geoidN(g)) / earthSq(q); }
// (above the sea: earthHeightStep raises it by the geoid)
fn earthHeightStepG(q: vec3f, foot: f32) -> f32 {
  var g = vec3f(0.0);
  if (HAS_RWY) { g = runwayGrade(q); }
  if (P.tiles.w > 0.5) {
    let hr = earthH(q, foot, true);
    let h1 = mix(hr.x, g.z, g.y);
    if (NEAR_DETAIL && GROUND_DETAIL) { return max(h1 + (1.0 - g.x) * earthDetail(q, h1, max(foot * 4.0, 1.0), hr.y), 0.0); }
    return max(h1, 0.0);
  }
  let texelM = EARTH_RM * TAU / f32(textureDimensions(earthElev).x);
  let h0 = mix(textureSampleLevel(earthElev, bgSamp, earthUV(q), max(log2(max(foot, 1.0) / texelM), 0.0)).r, g.z, g.y);
  if (NEAR_DETAIL && GROUND_DETAIL) { return max(h0 + (1.0 - g.x) * earthDetail(q, h0, max(foot * 4.0, 1.0), texelM), 0.0); }
  return max(h0, 0.0);
}
// the relief's own normal at q, no finer than the footprint
// The relief's slopes from a survey's tiles at q (geodetic, unit) for a footprint foot [m], measured in the finest level's
// own grid — its pixels from the camera's place, no float32 point of the unit sphere (good to ~0.4 m only) between them —:
// x −∂h/∂east, y −∂h/∂north, z the weight (0: no survey's texel there, or no level fine enough — earthNormalAt's own). Down
// to half a metre: the IGN's LiDAR (I3); elsewhere the global data's normals keep their drawn detail.
fn earthSlopeFine(q: vec3f, foot: f32) -> vec3f {
  if (P.tiles.w < 0.5) { return vec3f(0.0); }
  let cosLat = sqrt(max(1.0 - q.z * q.z, 1e-12));
  let tc = tileCoord(q);
  let dlon = tc.x;
  let dM = tc.y;
  for (var li = 0; li < i32(TILE_LEVELS); li++) {
    let l = TILE_LEVELS - 1u - u32(li);
    let a = P.tileL[2u * l];
    let b = P.tileL[2u * l + 1u];
    if (b.w < 0.5) { continue; }
    let p = a.xy + vec2f(dlon, -dM) * b.z;
    let edge = min(min(p.x, p.y), min(b.x - p.x, b.y - p.y));
    if (edge < 4.0) { continue; }
    let texel = EARTH_RM * cosLat / b.z;
    // (the finest level holding q, its texel no coarser than 10 m — coarser, the sphere's three heights are as good)
    if (texel > 10.0) { return vec3f(0.0); }
    if (!tileFine(l, vec2i(floor(p)))) { return vec3f(0.0); }
    // (central differences over the footprint — a texel at least —, bilinear: the pixels' own measure of the ground)
    let k = max(foot / texel, 1.0);
    let he = tileSample(l, p + vec2f(k, 0.0), 0.0) - tileSample(l, p - vec2f(k, 0.0), 0.0);
    let hs = tileSample(l, p + vec2f(0.0, k), 0.0) - tileSample(l, p - vec2f(0.0, k), 0.0);
    // (Mercator's pixels square on the ground: east the same as south — y grows southwards)
    let m = 2.0 * k * texel;
    return vec3f(-he / m, hs / m, smoothstep(4.0, 12.0, edge));
  }
  return vec3f(0.0);
}
fn earthNormalAt(q: vec3f, foot: f32) -> vec3f {
  // (on foot: the shared walking grid's own normal where the ground was met on it, blended out at its rim)
  let walk = walkNormal();
  if (walk.w >= 0.999) { return walk.xyz; }
  // (finer than 10 m over a survey's relief: its slopes in its own grid, down to half a metre — I3)
  if (foot < 10.0) {
    let sf = earthSlopeFine(geoQ(q), foot);
    if (sf.z >= 0.999) {
      var east = vec3f(-q.y, q.x, 0.0);
      east = select(normalize(east), vec3f(0.0, 1.0, 0.0), dot(east, east) < 1e-10);
      let north = cross(q, east);
      let fine = normalize(q + sf.x * east + sf.y * north);
      return select(fine, normalize(mix(fine, walk.xyz, walk.w)), walk.w > 0.0);
    }
  }
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
  let relief = normalize(q - ((hs[1] - hs[0]) * t1 + (hs[2] - hs[0]) * t2) / (e * EARTH_RM));
  return select(relief, normalize(mix(relief, walk.xyz, walk.w)), walk.w > 0.0);
}

// The relief's shadow at a ground point p (its axes, radii) towards the sun Ls: marched up to ~50 km,
// steps growing by a sixth (by a third, a grazing Sun's ray stepped over the crests between them: lit lines
// across the shade), softened by how close the ray passes over the ground (a penumbra); foot [m]
fn earthTerrainShadow(p: vec3f, Ls: vec3f, foot: f32) -> f32 {
  // (the raster's pixels — shade —: the march to the near reach, the relief's shadow map past it, the march resumed where
  // the Sun's ray leaves the map's patch — terrain-raster-hint.ts withSunShadow)
  var far = vec4f(-1.0, 0.0, 0.0, 3e38);
  if (SHADOW_REL_ON) { far = sunShadowFar(SHADOW_REL); }
  let p0 = p * (1.0 + 2.0 / EARTH_RM);
  // (the march's heights are coarser than the ground drawn: measured from their own ground here — else
  // where they stand a metre above it the point is inside its own relief, black patches under a high sun)
  let rp = length(p);
  let bias = earthHeightStep(p / rp, foot) - (rp - 1.0) * EARTH_RM;
  // (the map's shadow, a hint: its relief is the patch's — 150 m cells, a butte a broad mound there, a needle gone —; where it
  // says the Sun is hidden, the exact relief read over a window about the place it stands along the ray (far.w — its cells'
  // error, a little more farther), the shadow its: Monument Valley's buttes had shadows a cell wider than themselves across
  // the plain. TUNE_SC_SKIP 128: trusted as it was)
  if (far.x >= 0.0 && far.x < 1.0 && far.w < 1e37 && (TUNE_SC_SKIP & 128u) == 0u) {
    let W = 200.0 + 0.01 * far.w;
    let ta = max(far.z, far.w - W);
    let tb = far.w + W;
    var sw = 1.0;
    for (var i = 0; i < 12; i++) {
      let t = mix(ta, tb, (f32(i) + 0.5) / 12.0);
      let x = p0 + Ls * (t / EARTH_RM);
      let r = length(x);
      let clear = (r - 1.0) * EARTH_RM - earthHeightStep(x / r, max(0.02 * t, foot)) + bias;
      sw = min(sw, clamp((clear + 0.005 * t) / (0.04 * t) + 0.5, 0.0, 1.0));
      if (sw <= 0.0) { break; }
    }
    far.x = sw;
  }
  if (far.x == 0.0) { return 0.0; }
  let reach = select(1e30, far.z, far.x > 0.0);
  var resumed = far.x < 0.0;
  var t = max(foot, 20.0);
  var sh = 1.0;
  for (var i = 0; i < i32(TUNE_SHADOW_N); i++) {
    cost(2u);
    let x = p0 + Ls * (t / EARTH_RM);
    let r = length(x);
    let hr = (r - 1.0) * EARTH_RM;
    if (hr > earthTop() || t > TUNE_SHADOW_FAR) { break; }
    if (!resumed && t > reach) {
      resumed = true;
      if (far.y > t) { t = far.y; continue; }
    }
    // (+0.5 % of the distance: the march's heights, from coarser levels farther, a few metres off the
    // ground drawn)
    let clear = hr - earthHeightStep(x / r, max(0.05 * t, foot)) + bias;
    let d = clear + 0.005 * t;
    sh = min(sh, clamp(d / (0.04 * t) + 0.5, 0.0, 1.0));
    if (sh <= 0.0) { break; }
    // (high over the ground here — a sunlit slope's ray, a high sun's —: on by a share of its clearance (not of the
    // distance's allowance: steps by it went under the ridges — shadows on a sunlit river at sunset), not by the
    // growth's small steps over it; the penumbra's least ratio taken where the ground comes near)
    t = max(t * TUNE_SHADOW_K, t + TUNE_SHADOW_RELAX * clear);
  }
  return select(sh, min(sh, far.x), far.x >= 0.0);
}

// The ray (its axes, radii) against the relief: marched from the relief's bounding shell, steps a
// fraction of the height above the ground (and of the distance: the far horizon), then bisected; fpK:
// the pixel's footprint per unit distance. < 0: missed.

// where the last march step met the walking grid: its metres along right and forward, its weight (0: off it)
var<private> WALK_AT:vec3f;
// One height of the walking grid, its cell clamped to the grid.
fn walkHeight(x:i32,z:i32)->f32 {
 let size=i32(P.walk[2].w);let at=u32(clamp(z,0,size-1)*size+clamp(x,0,size-1));
 return bodies[u32(P.walk[1].w)+at/4u][at%4u];
}
// CPU and GPU share this local metre grid. No extra storage binding; no per-frame readback.
// The march reads its bilinear heights alone; the normal (walkNormal) only where the ground is shaded.
fn walkDistance(rd:vec3f,t:f32)->vec2f {
 WALK_AT=vec3f(0);
 if(P.walk[0].w<.5){return vec2f(0);}
 let direction=vec3f(rd.xy,rd.z/EARTH_AB);
 let d=P.walk[0].xyz+vec3f(dot(direction,P.walk[1].xyz),dot(direction,P.walk[2].xyz),dot(direction,P.walk[3].xyz))*(t*EARTH_RM);
 if(max(abs(d.x),abs(d.z))>=32){return vec2f(0);}
 let size=u32(P.walk[2].w);let step=P.walk[3].w;let q=(d.xz+32)/step;let cell=min(vec2u(floor(q)),vec2u(size-2u));let f=q-vec2f(cell);
 let x=i32(cell.x);let z=i32(cell.y);
 let h=mix(mix(walkHeight(x,z),walkHeight(x+1,z),f.x),mix(walkHeight(x,z+1),walkHeight(x+1,z+1),f.x),f.y);
 let w=1-smoothstep(30.0,32.0,max(abs(d.x),abs(d.z)));
 WALK_AT=vec3f(d.xz,w);
 return vec2f((d.y-h)/EARTH_RM,w);
}
// The walking grid's normal where the march met it (squashed space; w: its weight, 0 off the grid): the
// heights' slopes at the four corners (central differences) interpolated — smooth across the 1 m cells,
// where the bilinear surface's own normal jumps at each cell's edge (a faceted light near the feet).
fn walkNormal()->vec4f {
 if(P.walk[0].w<.5||WALK_AT.z<=0){return vec4f(0);}
 let size=u32(P.walk[2].w);let step=P.walk[3].w;let q=(WALK_AT.xy+32)/step;let cell=min(vec2u(floor(q)),vec2u(size-2u));let f=q-vec2f(cell);
 let x=i32(cell.x);let z=i32(cell.y);
 var g=array<vec2f,4>();
 for(var k=0;k<4;k++){
  let cx=x+(k&1);let cz=z+(k>>1);
  g[k]=vec2f(walkHeight(cx+1,cz)-walkHeight(cx-1,cz),walkHeight(cx,cz+1)-walkHeight(cx,cz-1))/(2*step);
 }
 let s=mix(mix(g[0],g[1],f.x),mix(g[2],g[3],f.x),f.y);
 let normal=normalize(P.walk[2].xyz-P.walk[1].xyz*s.x-P.walk[3].xyz*s.y);
 return vec4f(normalize(vec3f(normal.xy,normal.z/EARTH_AB)),WALK_AT.z);
}

// The highest the ground round the camera can be [m over the ellipsoid] (renderer: relief-ceiling.ts — the map's and
// the tiles' highest within the horizons' reach and the detail's most over it): the shell the ground's marches work in
fn earthTop() -> f32 { return select(9600.0, P.radio2.w, P.radio2.w > 0.0); }

// BEGIN_TERRAIN_RASTER (system/terrain-raster-hint.ts supplies the lookup where the device takes its texture)
fn terrainRasterHint(px: vec2f) -> f32 { return 0.0; }
fn terrainRasterId(px: vec2f) -> u32 { return 0u; }
fn terrainRasterDepth(px: vec2f) -> f32 { return 0.0; }
fn terrainRasterBuilding(px: vec2f) -> bool { return true; }
fn terrainRasterMesh(px: vec2f) -> bool { return false; }
fn terrainRasterBridge(px: vec2f) -> bool { return false; }
fn terrainRasterLevelStep(px: vec2f) -> f32 { return 0.0; }
fn terrainRasterCloud(px: vec2f) -> bool { return false; }
// END_TERRAIN_RASTER
// BEGIN_CLOUD_PASS (system/cloud-pass.ts withCloudPass supplies the cloud pass's texture reads)
fn cloudsBuffered(px: vec2f, boundM: f32) -> EarthClouds { return EarthClouds(-1.0, vec3f(0.0), -1.0); }
fn cloudsAtPixel(px: vec2f) -> vec4f { return vec4f(-1.0); }
fn cloudDepthAtPixel(px: vec2f) -> f32 { return -1.0; }
// END_CLOUD_PASS
// BEGIN_SUN_SHADOW (system/terrain-raster-hint.ts withSunShadow supplies the relief's shadow map's lookup)
fn sunShadowFar(rel: vec3f) -> vec4f { return vec4f(-1.0, 0.0, 0.0, 3e38); }
// END_SUN_SHADOW
// BEGIN_CLOUD_SHADOW (system/cloud-shadow.ts withCloudShadow supplies the clouds' transmittance map's lookup — N3)
// (the sunlight's share the clouds let through to a point p of the squashed space: −1 where the map has nothing)
fn cloudShadowAt(p: vec3f) -> f32 { return -1.0; }
// END_CLOUD_SHADOW
// BEGIN_TREE_SHADOW (system/tree-shadow.ts withTreeShadow supplies the trees' and buildings' shadow map's lookup)
// (the share of the Sun a scenery-frame point sees past them: −1 where the map has nothing — the rays then, as before)
fn treeShadowAt(p: vec3f) -> f32 { return -1.0; }
fn buildingShadowAt(p: vec3f) -> f32 { return -1.0; }
// END_TREE_SHADOW
// (shade's ground point from the camera, the Earth's axes [m] — the relief's shadow map's lookup —, set by earthNear)
var<private> SHADOW_REL: vec3f = vec3f(0.0);
var<private> SHADOW_REL_ON: bool = false;
// (shade's own rays: their ground point handed to the relief's shadow map)
var<private> RASTER_SHADE: bool = false;
// the raster patch's distance [m] along this sample's ray, 0 where it does not cover it (main sets it)
var<private> RHINT: f32 = 0.0;
// the hint's error over the near patch's (1; its far rings', coarser by 4 a level: TUNE_RING_TOL a level — main and shade set it)
var<private> RHINT_TOL: f32 = 1.0;
fn rasterHintTol(px: vec2f) -> f32 { return pow(TUNE_RING_TOL, terrainRasterLevelStep(px)); }
// The raster's primary visibility (earthPipeline "raster", docs/PLAN-RENDU-RASTER-AAA.md étape 1): the pixels the patch
// covers are shaded one a pixel by the kernel shade, not traced by main (renderer: mouthList[1].y)
fn rasterPrimary() -> bool { return HAS_TERRAIN_RASTER && P.mouthList[1].y > 0.5 && P.walk[0].w < 0.5; }
// moments.x of a pixel shade wrote (post.wgsl gatherH leaves it out of the stale pixels' reconstruction: the ground's
// dense samples bled into the sky's sparse ones at the horizon); above any Σ luminance² a realtime frame writes there
const RASTER_MARK = 1e30;
// The scenery's instance the raster drew at the pixel shade works on (terrainRasterId: a tree, its cell + 1; 0 none) and
// whether the raster drew the scenery at all this frame (then a pixel with none has no tree before its ground — étape 1b)
var<private> RASTER_ID: u32 = 0u;
// (a building's raster box covers this pixel — terrainRasterBuilding —: its BVH tested there alone)
var<private> RASTER_BLD: bool = true;
var<private> RASTER_SCENERY: bool = false;

// The ground's clearance (as the march's f) at t along the ray from ro: the full relief, as the crossing's refinement reads it.
fn marchClear(A: vec3f, o: vec3f, e: f32, rd: vec3f, t: f32, fpK: f32) -> f32 {
  let v = o + rd * t;
  let p = A + v;
  let r = length(p);
  return (e + 2.0 * dot(A, v) + dot(v, v)) / (r + 1.0) - earthHeight(p / r, max(t * fpK * EARTH_RM, 0.05)) / EARTH_RM;
}
// The ground's crossing from the raster patch's distance tM [m] (kM: metres per unit of t): the full relief is read at
// two points either side of it, a few metres apart (a vertical tolerance over the ray's grazing — wider at a low angle),
// and the crossing refined as the march's own. -3: the hint did not bracket the ground (the relief there above the
// patch's, or nothing near): the march is then done as before. What the patch misses between the camera and the hint,
// a thin ridge above its filtered surface, shows as the ground already over the ray at the near end: the same fallback.
fn earthMarchHinted(ro: vec3f, rd: vec3f, fpK: f32, tM: f32, kM: f32) -> f32 {
  let fine = P.nearCam1.w > 0.5;
  let A = select(ro, P.nearCam0.xyz, fine);
  let e = select(dot(ro, ro) - 1.0, P.nearCam0.w, fine);
  let o = select(vec3f(0.0), P.nearCam1.xyz, fine);
  let tH = tM / kM;
  let pH = A + o + rd * tH;
  let sinG = abs(dot(rd, normalize(pH)));
  // (a grazing ray crosses the ground over a long stretch, and the patch's cells — a hundred metres and more — miss the ridges
  // it could pass between: the march keeps those — but only where such a ridge can stand: where the ray is within the patch's
  // error of its surface, h_tol / sinG before the hint (25 m and 0.4 % of the distance: the cells coarsening out); before
  // that it flies higher above the patch than the relief the patch left out can rise. The ray clear at the window's start —
  // else, a ridge there after all: the whole march, as before)
  if (sinG < TUNE_HINT_GRAZE) {
    if (TUNE_GRAZE_WINDOW <= 0.0) { return -3.0; }
    HINT_PATH = 2u;
    let W = (25.0 + 0.004 * tM) * RHINT_TOL / max(sinG, 0.01) * TUNE_GRAZE_WINDOW / kM;
    let ts = tH - W;
    if (ts <= 0.0 || marchClear(A, o, e, rd, ts, fpK) <= 0.0) { return -3.0; }
    return earthMarchFrom(ro, rd, fpK, ts);
  }
  // (a pixel's footprint there, the patch's own few metres: the vertical band the hint is trusted within)
  HINT_PATH = 1u;
  let eps = (5.0 + 2.0 * tM * fpK) * RHINT_TOL;
  let dm = clamp(eps / sinG, 3.0, (0.02 * tM + 3.0) * RHINT_TOL);
  let dt = dm / kM;
  var lo = tH - dt;
  if (lo <= 0.0) { return -3.0; }
  var hi = tH + dt;
  var flo = marchClear(A, o, e, rd, lo, fpK);
  if (flo <= 0.0) { return -3.0; }
  var fhi = marchClear(A, o, e, rd, hi, fpK);
  if (fhi >= 0.0) {
    // (the patch below the relief: once more, farther)
    lo = hi;
    flo = fhi;
    hi = tH + 4.0 * dt;
    fhi = marchClear(A, o, e, rd, hi, fpK);
    if (fhi >= 0.0) { return -3.0; }
  }
  // (Illinois' regula falsi: the retained end's f halved when it stays twice, so a curved ground does not leave one end behind;
  // until the bracket is a tenth of the ray's footprint there — the march's own crossing is bracketed by a step of 0.4 % of
  // the distance and refined three times)
  let tol = max(0.05, 0.1 * tM * fpK) / kM;
  var side = 0;
  for (var j = 0u; j < TUNE_HINT_ITER; j++) {
    if (hi - lo < tol) { break; }
    let m = clamp(lo + (hi - lo) * flo / (flo - fhi), lo + 0.02 * (hi - lo), hi - 0.02 * (hi - lo));
    let fm = marchClear(A, o, e, rd, m, fpK);
    if (fm < 0.0) {
      hi = m;
      fhi = fm;
      if (side == -1) { flo *= 0.5; }
      side = -1;
    } else {
      lo = m;
      flo = fm;
      if (side == 1) { fhi *= 0.5; }
      side = 1;
    }
  }
  return clamp(lo + (hi - lo) * flo / (flo - fhi), lo, hi);
}

fn earthMarch(ro: vec3f, rd: vec3f, fpK: f32) -> f32 { return earthMarchFrom(ro, rd, fpK, 0.0); }
// the same from tStart along the ray (earthMarchHinted's grazing window: what lies before it known clear)
fn earthMarchFrom(ro: vec3f, rd: vec3f, fpK: f32, tStart: f32) -> f32 {
  WALK_AT=vec3f(0);
  let Rs = 1.0 + earthTop() / EARTH_RM;
  let b = dot(ro, rd);
  let off = ro - rd * b;
  let d2 = dot(off, off);
  if (d2 > Rs * Rs) { return -1.0; }
  let sq = sqrt(Rs * Rs - d2);
  let t1 = -b + sq;
  if (t1 <= 0.0) { return -1.0; }
  var t = max(max(-b - sq, 0.0), tStart);
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
  // (the last step's f on the full heights or not: its fall to this one, on the same, is the clearance's rate)
  var prevFull = false;
  // (the clearance growing at the last step: the ray leaving the ground)
  var rising = false;
  // (the over-relaxed steps: the last one was — its safe length then —, and the next not to be, after a step back)
  var relaxedPrev = false;
  var safePrev = 0.0;
  var noRelax = false;
  for (var i = 0u; i < TUNE_MARCH_N; i++) {
    cost(0u);
    let v = o + rd * t;
    let p = A + v;
    let r = length(p);
    let foot = max(t * fpK * EARTH_RM, 0.05);
    let rad = (e + 2.0 * dot(A, v) + dot(v, v)) / (r + 1.0);
    var f = 0.0;
    let walk=walkDistance(rd,t);
    if(walk.y>=.999){f=walk.x;band=true;}
    else if (!band) {
      f = rad - (earthHeightStep(p / r, foot) + 9.0 * foot + 3.0) / EARTH_RM;
      // (an over-relaxed step whose two ends' safe reaches do not meet — or that went under: a ridge may stand in
      // the gap; back to the safe step from the last point, not relaxed)
      if (relaxedPrev && TUNE_MARCH_K * (fPrev + f) < t - tPrev) {
        t = tPrev + safePrev;
        relaxedPrev = false;
        noRelax = true;
        continue;
      }
      band = f <= 0.0;
    }
    if (band && walk.y<.999) {
      f = mix(rad - earthHeight(p / r, foot) / EARTH_RM,walk.x,walk.y);
      // (an over-relaxed step's ends whose safe reaches leave a gap — or under the ground: back to the safe step)
      if (relaxedPrev && TUNE_MARCH_K * (fPrev + f) < t - tPrev) {
        t = tPrev + safePrev;
        relaxedPrev = false;
        noRelax = true;
        continue;
      }
    }
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
        let walkM=walkDistance(rd,m);
        var fm=walkM.x;
        if(walkM.y<.999){fm=mix((e + 2.0 * dot(A, vm) + dot(vm, vm)) / (rm + 1.0) - earthHeight(pm / rm, max(m * fpK * EARTH_RM, 0.05)) / EARTH_RM,walkM.x,walkM.y);}
        if (fm < 0.0) { hi = m; fhi = fm; } else { lo = m; flo = fm; }
      }
      // (the root between the last two: the side above may have closed in on it, the one below not)
      return clamp(lo + (hi - lo) * flo / (flo - fhi), lo, hi);
    }
    // (a grazing ray over gentle ground — a runway seen from the cockpit, any plain to its horizon —: its
    // clearance falls by a thousandth of the distance, and steps of 0.4 % of it took ~600 a decade — it ran out
    // of them short of the ground, which was drawn there: a hump on the horizon, a runway's lines bent. Its
    // clearance's fall since the last step (both on the same heights: the cheap ones and their margin, or
    // the full ones) foretells the crossing: half of that, at most 3 % of the distance — the crossing then
    // bracketed as before)
    // A ray rising from the ground but slowly — just above the horizon, a metre a kilometre — stepped as
    // slowly and ran out of steps a kilometre or two out: that point, in the air, was drawn as the ground —
    // a band of smeared land above the horizon, the runway's mirage in it. Its clearance growing, the
    // relief would have to rise faster than it to meet it: steps of 5 % of the distance (the shell left in
    // ~150 steps); a ridge met is bracketed as any crossing)
    let safe = max(TUNE_MARCH_K * f, 0.004 * t + 1e-9);
    var step = safe;
    // (on the way in — the cheap heights —: the step over-relaxed, checked at the next point)
    let relax = select(TUNE_RELAX, TUNE_RELAX_BAND, band) * TUNE_MARCH_K * f;
    // (not over the shell's end — a step past it ends the ray, unchecked —, nor on the walking grid)
    let tryRelax = !noRelax && walk.y < 0.999 && P.walk[0].w < 0.5 && relax > step && t + relax <= t1;
    if (tryRelax) { step = relax; }
    noRelax = false;
    rising = false;
    if (i > 0u && prevFull == band) {
      if (fPrev > f) { step = max(step, min(0.5 * f * (t - tPrev) / (fPrev - f), 0.03 * t)); } else { step = max(step, TUNE_RISE * t); rising = true; }
    }
    // (relaxed only where the relaxation set the step: the foretold crossings and the rising rays' steps as before)
    // (no step longer than TUNE_STEP_CAP_M or TUNE_STEP_CAP_K of the distance: a ray high over the plain — its clearance
    // hundreds of metres — stepped by a share of it through a butte's top narrower than that, in bands of sky)
    if (TUNE_STEP_CAP_M > 0.0) { step = min(step, max(TUNE_STEP_CAP_M / EARTH_RM, TUNE_STEP_CAP_K * t)); }
    relaxedPrev = tryRelax && step <= relax;
    safePrev = safe;
    prevFull = band;
    tPrev = t;
    fPrev = f;
    t += step;
    if (t > t1) { return -1.0; }
  }
  // (the steps spent still under the relief's shell: a grazing ray, near the ground over tens of km —
  // it meets the far ridges; a miss here showed the sky through the land, in bands. Unless it was
  // leaving the ground — tangent to the Earth, just above the horizon —: it met nothing, the sky)
  if (rising) { return -1.0; }
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
  let base = cloudRawGrad(eCube(q), eCube(rotZ(fx, P.earth.y)), eCube(rotZ(fy, P.earth.y)));
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
  let hc = P.earth2.x * EARTH_RM * earthSq(q);
  let mu0 = dot(geoQ(q), airPhysicalDirection(Ls));
  let Ts = sunThrough(hc, mu0) * sunSeen(q * (1.0 + P.earth2.x), Ls);
  // thick clouds: a diffuse, bright top (a soft terminator: they stand above it), forward scattering
  // round the sun; their base, dimmer
  let wrap = clamp((mu0 + 0.08) / 1.08, 0.0, 1.0);
  let ct = dot(airPhysicalDirection(rd), airPhysicalDirection(Ls));
  let fwd = 0.25 * pow(max(ct, 0.0), 8.0);
  let sk = skySeen(q, Ls);
  let amb = max(0.7 * skyFlatFactor(q, hc, E, mu0, sk), nightFloor(sk, mu0) * CLOUD_NIGHT_FLOOR);
  let top = 0.85 / PI * (E * Ts * (wrap * lit * select(cloudLongShadow(q, Ls), 1.0, below) + fwd) + E * amb + E * earthMoonlight(q, q, hc, mu0));
  // (its base: the top's light through it, and the cities' from below)
  return select(top, top * 0.2 + 0.85 / PI * cityGlowUp(q, E, mu0), below);
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
// (foam: the FFT's surface's Jacobian there — 1 the flat sea, under ~0.5 folding —; h its height [m])
// (res: the foam lying on the surface — the FFT's, left by the crests that broke: 0 none, 1 a white sheet)
struct SeaWaves { n: vec3f, vu: f32, vc: f32, m: f32, foam: f32, h: f32, res: f32 };
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
// The ships' wakes at the point SEA_D (P.wake; controller/seatraffic.ts): g the slope they add (the Earth's axes),
// foam their white water, calm how much they smooth the small waves. Each ship's Kelvin pattern, standing in its
// frame: in the 19.47° wedge aft of its bow, at a point x aft and y abeam (r = |y|/x), the waves of the two angles
// θ the phase is stationary at (2r·tan²θ − tanθ + r = 0 — the transverse waves and the divergent), their phase
// φ = k₀(x cosθ + |y| sinθ)/cos²θ (k₀ = g/U²: the transverse wavelength 2πU²/g), their height falling as
// 1/√(distance), raised along the cusps; faded where the pixel does not resolve them. Behind its stern its
// turbulent wake — a band of foam a beam or two wide, broadening and fading over some lengths — and a smoothed
// strip wider and longer; its bow wave's foam along its sides forward.
// (rough: the slopes' variance a craft's downwash adds — the water ruffled; bub: the air churned into the water by a hull, a
// screw, a jet — the aerated water's pale turquoise under the surface)
struct SeaWake { g: vec3f, foam: f32, calm: f32, rough: f32, bub: f32 };
// A craft low over the sea at the point SEA_D (A: its place from the eye [m], −1 − the share of its weight its jets hold up
// straight down; B: its course × its span, its ground speed): its downwash — the wing's, its trailing vortices', sinking at
// a few m/s; a jet's straight down, fast — meets the water behind it (U h / w), ruffles it in a lane the vortices widen as
// they spread along the surface, the ruffle fading over seconds; ripples running out from its edges; within a span or so
// of the water the spray thrown up — white water, a rooster's tail —; in the hover a ring of spray round the jet's foot and
// the ripples racing out from it.
fn seaCraftWake(o: ptr<function, SeaWake>, A: vec4f, B: vec4f, up: vec3f, footM: f32, anchor: vec3i, tclock: f32, u: f32, c: f32) {
  let span = max(length(B.xyz), 1.0);
  let f = B.xyz / span;
  let U = B.w;
  // (the craft where it is drawn — w under −9.5: its centre in the camera's axes, renderer; an outside view's eye is metres to
  // hundreds of metres off it —, else its place from the eye on the Earth's axes)
  let cam = A.w < -9.5;
  let hover = clamp(-A.w - select(1.0, 11.0, cam), 0.0, 1.0);
  let at = select(A.xyz, toBody(A.x * P.camRight.xyz + A.y * P.camUp.xyz + A.z * P.camFwd.xyz), cam);
  let rel = SEA_D - at;
  let h = -dot(rel, up);
  if (h < -2.0 || h > 4.0 * span + 20.0) { return; }
  let hh = max(h, 0.5);
  let side = normalize(cross(up, f));
  let rh = rel + up * h;
  let x = -dot(rh, f);
  let y = dot(rh, side);
  // (how hard it presses on the water: its downwash's reach, a span or so; the jets' in the hover, farther)
  let s0 = exp(-hh / mix(0.9 * span, 2.5 * span, hover));
  if (s0 < 0.01) { return; }
  // (where it meets the water: behind by the time its downwash takes to sink there — the wing's, ε V = 2 C_L V / (π AR), as
  // 1/V: ~14 m/s for a fighter at 130 m/s —; a jet's in the hover, fast)
  let w = mix(clamp(1800.0 / max(U, 1.0), 8.0, 40.0), 40.0, hover);
  let aft = U * hh / w;
  let age = max(x - aft, 0.0) / max(U, 1.0);
  let r = length(vec2f(x - aft, y));
  // (the lane: the vortices' pair spreading out along the water at ~1.5 m/s, the ruffle fading over ~8 s)
  if (x > aft - span) {
    let half = 0.45 * span + 0.6 * hh + 1.5 * age;
    let lane = smoothstep(half * 1.25, half * 0.6, abs(y)) * smoothstep(aft - span, aft, x) * exp(-age / 8.0) * (1.0 - hover);
    (*o).rough = max((*o).rough, 0.15 * s0 * lane);
    // (the ripples run out from its edges: capillary-gravity waves of ~1.5 m, faded where the pixel does not resolve them)
    let edge = abs(abs(y) - half);
    let k = TAU / 1.5;
    let ripple = sin(k * edge - TAU * 1.0 * tclock) * exp(-edge / 6.0) * smoothstep(3.0, 0.75, footM) * lane;
    (*o).g += 0.08 * s0 * ripple * sign(y) * side;
    // (the spray: within ~0.6 span the sheet thrown up behind it, whitest where the downwash first strikes)
    let spray = smoothstep(1.4 * span, 0.2 * span, hh) * smoothstep(half * 1.1, half * 0.3, abs(y)) * exp(-age / 1.5) * smoothstep(aft - 0.5 * span, aft + span, x);
    let pn = noise01(anchor + vec3i(0, 0, 8), vec3f(x / 3.0, y / 2.0, tclock * 0.6));
    (*o).foam = max((*o).foam, spray * clamp(0.4 + 0.8 * pn, 0.0, 1.0));
    (*o).bub = max((*o).bub, lane * s0 * smoothstep(1.2 * span, 0.3 * span, hh));
  }
  // (the engine's exhaust: its plume — aimed down by the angle of attack, its edge spreading at ~11° — reaches the water some
  // 3.7 h behind the tail, its centreline speed fallen as u₀ 6 D / x (a turbulent jet: ~400 m/s, D 1.2 m): at 15 m still ~30 m/s —
  // a narrow lane of torn spray and churned, aerated water, the trail a fast low pass leaves; above ~40 m too weak to show)
  if (hover < 1.0) {
    let dEx = 3.7 * hh;
    let jet = smoothstep(12.0, 40.0, 2900.0 / max(dEx, 1.0)) * (1.0 - hover);
    if (jet > 0.0 && x > dEx - 15.0) {
      let ageE = max(x - dEx, 0.0) / max(U, 1.0);
      let halfE = 0.12 * dEx + 1.0 + 1.2 * ageE;
      let laneE = smoothstep(1.4 * halfE, 0.35 * halfE, abs(y)) * smoothstep(dEx - 15.0, dEx + 10.0, x) * exp(-ageE / 5.0);
      let pe = 0.6 * noise01(anchor + vec3i(0, 0, 14), vec3f(x / 4.0 - tclock * 3.0, y / 1.5, tclock * 0.8))
        + 0.4 * noise01(anchor + vec3i(0, 0, 15), vec3f(x / 1.2, y / 0.7, tclock * 2.0));
      (*o).rough = max((*o).rough, 0.2 * jet * laneE);
      (*o).foam = max((*o).foam, clamp(jet * laneE * exp(-ageE / 1.5) * (0.2 + 1.1 * pe), 0.0, 1.0));
      (*o).bub = max((*o).bub, jet * laneE * 0.8);
    }
  }
  // (the hover: the jet's foot, a ring of spray thrown out — at 1–3 heights —, the surface flattened then ruffled within,
  // the ripples racing outwards)
  if (hover > 0.0) {
    let rr = length(rh);
    let ring = smoothstep(0.25 * hh, 0.8 * hh, rr) * smoothstep(3.2 * hh + 12.0, 1.3 * hh, rr);
    // (the sheet torn into radial jets of spray, flickering)
    // (its angle as a direction — no seam where atan2 wraps —, the jets running outwards)
    let dir = vec2f(x, y) / max(rr, 0.1);
    let pn = 0.65 * noise01(anchor + vec3i(0, 0, 10), vec3f(rr / 1.5 - tclock * 2.0, 2.5 * dir.x, 2.5 * dir.y + tclock * 0.7))
      + 0.35 * noise01(anchor + vec3i(0, 0, 12), vec3f(x / 0.8, y / 0.8, tclock * 3.0));
    let foot = smoothstep(0.6 * hh, 0.1 * hh, rr) * clamp(0.5 + 0.7 * pn, 0.0, 1.0);
    (*o).foam = max((*o).foam, clamp(hover * s0 * 1.7 * max(ring * clamp(0.25 + pn, 0.0, 1.0), foot), 0.0, 1.0));
    (*o).rough = max((*o).rough, hover * s0 * 0.1 * smoothstep(3.0 * hh + 10.0, 0.5 * hh, rr));
    (*o).bub = max((*o).bub, hover * s0 * smoothstep(2.0 * hh, 0.3 * hh, rr));
    let k = TAU / 2.0;
    let wave = sin(k * rr - TAU * 1.4 * tclock) * exp(-rr / (3.0 * hh + 10.0)) * smoothstep(3.0, 0.75, footM);
    (*o).g += 0.03 * hover * s0 * wave * rh / max(rr, 0.1);
  }
}
fn seaWake(up: vec3f, footM: f32) -> SeaWake {
  var o: SeaWake;
  let n = u32(P.wake[0].x + 0.5);
  if (n == 0u) { return o; }
  let u = dot(SEA_D, P.sea[0].xyz) + P.sea[2].x;
  let c = dot(SEA_D, P.sea[1].xyz) + P.sea[2].y;
  let anchor = vec3i(i32(P.sea[2].z) * 32, i32(P.sea[2].w) * 32, 11);
  let tclock = P.time.x * P.near5.w;
  for (var i = 0u; i < min(n, 8u); i++) {
    let A = P.wake[1u + 2u * i];
    let B = P.wake[2u + 2u * i];
    // (a negative length: a craft low over the sea — seaCraftWake)
    if (A.w < 0.0) {
      seaCraftWake(&o, A, B, up, footM, anchor, tclock, u, c);
      continue;
    }
    let L = A.w;
    let beam = max(length(B.xyz), 1.0);
    let f = B.xyz / beam;
    let U = max(B.w, 0.5);
    let side = normalize(cross(up, f));
    // (from its bow: x aft, y abeam)
    let rel = SEA_D - (A.xyz + f * (0.5 * L));
    let x = -dot(rel, f);
    let y = dot(rel, side);
    let ay = abs(y);
    let reach = 40.0 * L + 2500.0;
    if (x < -0.2 * L || x > reach || ay > 0.42 * max(x, 0.0) + 2.0 * beam + 20.0) { continue; }
    let k0 = 9.81 / (U * U);
    let fr = smoothstep(0.8, 3.0, U);
    // (its white water: a big hull's, under way — a yacht's at a walking pace hardly any)
    let churn = smoothstep(1.5, 6.0, U) * (0.35 + 0.65 * smoothstep(15.0, 80.0, L));
    // the Kelvin waves
    if (x > 0.0) {
      let r = ay / x;
      let a0 = min(0.006 * L + 0.1, 1.6) * fr * sqrt(L / (x + L)) * exp(-x / reach * 2.0);
      let edge = smoothstep(0.40, 0.354, r) * (1.0 + 1.5 * smoothstep(0.29, 0.354, r));
      let disc = sqrt(max(1.0 - 8.0 * r * r, 0.0));
      let rr = max(r, 1e-4);
      for (var j = 0; j < 2; j++) {
        let tt = select((1.0 + disc) / (4.0 * rr), (1.0 - disc) / (4.0 * rr), j == 0);
        let th = atan(tt);
        let ct = cos(th);
        let st = sin(th);
        let kk = k0 / (ct * ct);
        let lam = TAU / kk;
        // (the divergent waves faint on the axis — short there —, both faded where unresolved)
        let res = smoothstep(2.0 * footM, 6.0 * footM, lam) * select(smoothstep(0.05, 0.25, r), 1.0, j == 0);
        let ph = kk * (x * ct + ay * st);
        let a = a0 * edge * res * select(0.7, 1.0, j == 0);
        let dh = -a * sin(ph) * kk;
        // (∂h/∂x, ∂h/∂|y|) → the Earth's axes: x grows aft (−f), y along side
        o.g += dh * (ct * -f + st * sign(y) * side);
      }
    }
    // the turbulent wake aft of the stern and its smoothed strip; the bow wave along its sides
    let xs = x - L;
    if (xs > -0.1 * L) {
      let xw = max(xs, 0.0);
      let w = 0.5 * beam * sqrt(1.0 + xw / (4.0 * beam));
      let life = 3.0 * L + 80.0;
      let pn = gnoiseI(anchor, vec3f(u, c, tclock * 0.05) / 5.0);
      let band = smoothstep(w, 0.45 * w, ay) * exp(-xw / life) * churn;
      // (its white water a lace drawn out along the course — the cells a metre or two, stretched aft — where the pixel
      // resolves it, its mean beyond; the bubbles under it outlast the foam: the wake's pale turquoise lane)
      let lace = noise01(anchor + vec3i(0, 0, 6), vec3f(x / 4.5, y / 1.2, tclock * 0.03));
      let fine = smoothstep(1.5, 0.5, footM);
      let white = band * clamp(0.5 + 0.6 * pn, 0.0, 1.0);
      o.foam = max(o.foam, mix(white * 0.75, white * smoothstep(0.55 - 0.4 * white, 0.9 - 0.3 * white, lace), fine));
      o.bub = max(o.bub, smoothstep(1.3 * w, 0.5 * w, ay) * exp(-xw / (2.5 * life)) * churn);
      o.calm = max(o.calm, smoothstep(1.8 * w, w, ay) * exp(-xw / (2.0 * life)) * churn * 0.7);
    }
    if (x > 0.0 && x < 0.6 * L) {
      let bw = 0.5 * beam + 0.06 * x + 1.0;
      let bow = smoothstep(bw + 3.0 + 0.04 * x, bw, ay) * smoothstep(0.5 * beam - 1.0, 0.5 * beam + 0.5, ay);
      let pn = gnoiseI(anchor + vec3i(0, 0, 4), vec3f(u, c, tclock * 0.1) / 3.0);
      o.foam = max(o.foam, bow * smoothstep(0.6 * L, 0.05 * L, x) * churn * clamp(0.5 + 0.7 * pn, 0.0, 1.0));
    }
  }
  return o;
}

// The FFT's waves at the point SEA_D (M1; sea/fft-gpu.ts — compiled in where the device takes its texture, else
// the trains): the point the crests' sideways displacement brought here found (one step back along the two long
// cascades' displacement), then each cascade's slopes at the mip its footprint asks (its texels a 256th of its
// period): their mean the normal's, their second moment less the mean's square the slopes' variance the pixel
// does not resolve (LEAN); where the surface folds (its Jacobian under ~0.5, the long cascades' summed) the crests
// break white.
// (seaWavesFft begin)
fn seaWavesFft(q: vec3f, tu: vec3f, tc: vec3f, footM: f32) -> SeaWaves {
  var o: SeaWaves;
  o.m = P.sea[1].w;
  var x = vec2f(dot(SEA_D, P.sea[0].xyz) + P.sea[2].x, dot(SEA_D, P.sea[1].xyz) + P.sea[2].y);
  let foot = max(footM, 1e-3);
  var dsum = vec2f(0.0);
  for (var i = 0u; i < 2u; i++) {
    let L = P.seafft[1][i];
    let lod = max(log2(foot * 256.0 / L), 0.0);
    dsum += textureSampleLevel(seaFft, seaSamp, x / L, i32(2u * i), lod).xz;
  }
  x -= dsum * o.m;
  var su = 0.0;
  var sc = 0.0;
  var J = 1.0;
  var h = 0.0;
  for (var i = 0u; i < 3u; i++) {
    let L = P.seafft[1][i];
    let lod = max(log2(foot * 256.0 / L), 0.0);
    let s = textureSampleLevel(seaFft, seaSamp, x / L, i32(2u * i + 1u), lod);
    su += s.x;
    sc += s.y;
    o.vu += max(s.z - s.x * s.x, 0.0);
    o.vc += max(s.w - s.y * s.y, 0.0);
    if (i < 2u) {
      let d = textureSampleLevel(seaFft, seaSamp, x / L, i32(2u * i), lod);
      J += d.w - 1.0;
      h += d.y;
    }
  }
  o.n = normalize(q - (su * tu + sc * tc) * o.m);
  o.vu *= o.m * o.m;
  o.vc *= o.m * o.m;
  o.foam = 1.0 + (J - 1.0) * o.m;
  o.h = h * o.m;
  // (the foam the two long cascades' crests left — sea/fft-gpu.ts, their third layers —, drawn out upwind of where it was
  // made: the crest runs on downwind, its foam stays behind in streaks along the wind — three taps back along it)
  for (var i = 0u; i < 2u; i++) {
    let L = P.seafft[1][i];
    let lod = max(log2(foot * 256.0 / L), 0.0);
    let st = max(2.0, 1.5 * foot);
    var f = 0.0;
    for (var k = 0; k < 3; k++) {
      f += array<f32, 3>(0.5, 0.3, 0.2)[k] * textureSampleLevel(seaFft, seaSamp, (x - vec2f(st * f32(k * k + k), 0.0)) / L, i32(6u + i), lod).x;
    }
    o.res = max(o.res, f * select(0.7, 1.0, i == 0u));
  }
  o.res *= o.m;
  return o;
}
// The sea's height [m] at d from the camera (the Earth's axes [m]), seen from s metres: the two long cascades'.
fn seaHeightAt(d: vec3f, s: f32) -> f32 {
  let x = vec2f(dot(d, P.sea[0].xyz) + P.sea[2].x, dot(d, P.sea[1].xyz) + P.sea[2].y);
  var h = 0.0;
  for (var i = 0u; i < 2u; i++) {
    let L = P.seafft[1][i];
    let lod = max(log2(max(s * 0.0015, 0.05) * 256.0 / L), 0.0);
    h += textureSampleLevel(seaFft, seaSamp, x / L, i32(2u * i), lod).y;
  }
  return h * P.sea[1].w;
}
// The sea as a surface near a low camera (M1: its waves' relief — a crest hides what lies behind it): the ray met
// against the FFT's heights instead of the mean sea, under 600 m and within 4 km — marched from where it is a few
// spreads over the sea to where it is as far under (it must cross it there), the crossing bisected. t, m: the
// distance to the mean sea as earthNear has it and its scale; the distance to the waves returned.
fn seaSurfaceHit(look: vec3f, t: f32, m: f32) -> f32 {
  let lb = toBody(look);
  let up = cross(P.sea[0].xyz, P.sea[1].xyz);
  let D = t / m * P.near4.w;
  let sinE = -dot(lb, up);
  if (sinE <= 1e-4 || D > 4000.0) { return t; }
  let hc = D * sinE;
  if (hc > 600.0) { return t; }
  let Hm = 4.0 * P.seafft[0].z + 0.3;
  let sa = max(D * (1.0 - Hm / hc), 0.0);
  let sb = D * (1.0 + Hm / hc);
  var a = sa;
  for (var i = 1; i <= 24; i++) {
    cost(5u);
    let b = sa + (sb - sa) * f32(i) / 24.0;
    if (hc - b * sinE - seaHeightAt(lb * b, b) <= 0.0) {
      var lo = a;
      var hi = b;
      for (var j = 0; j < 6; j++) {
        cost(5u);
        let mid = 0.5 * (lo + hi);
        if (hc - mid * sinE - seaHeightAt(lb * mid, mid) <= 0.0) { hi = mid; } else { lo = mid; }
      }
      return t * (0.5 * (lo + hi)) / D;
    }
    a = b;
  }
  return t;
}
// (seaWavesFft end)

// calm: inland water (0 the open sea, 1 a sheltered lake: its fetch short — the wind's waves small, no swell,
// no whitecaps); mirror: the world it reflects (waterMirror: rgb radiance, w its weight — the sky the rest)
fn seaShade(q: vec3f, view: vec3f, light: vec3f, Eg: vec3f, sky: vec3f, under: vec3f, footM: f32, calm: f32, mirror: vec4f) -> vec3f {
  let normal = geoQ(q);
  let V = airPhysicalDirection(view);
  let Ls = airPhysicalDirection(light);
  let w = seaWind(normal);
  var U = w.w;
  var tu = w.xyz;
  var n = normal;
  var vu = 0.0;
  var vc = 0.0;
  // (the share of Cox–Munk's variance in slopes finer than the resolved range: half)
  var fine = 1.0;
  var wk: SeaWake;
  // (the Cox–Munk slopes' variance the drawn waves leave: half of it with the trains; with the FFT, the finer
  // than its cascades' — renderer: seaFftParams)
  var tailU = -1.0;
  var tailC = -1.0;
  var crest = 0.0;
  var crestH = 0.0;
  var lying = 0.0;
  if (SEA_ON) {
    // (near: the flight's own wind — the waves and the glint as the pilot feels it —, the trains drawn)
    let b = P.sea[1].w;
    U = mix(U, P.sea[0].w, b);
    tu = P.sea[0].xyz;
    var sw: SeaWaves;
    if (P.seafft[0].x > 0.5) {
      sw = seaWavesFft(normal, tu, P.sea[1].xyz, footM);
      tailU = P.seafft[2].x;
      tailC = P.seafft[2].y;
      // (whitecaps where the surface folds most: its Jacobian under the threshold that gives Monahan's cover at
      // this wind — renderer: seaFftParams —, in streaks along the wind)
      let Jt = P.seafft[2].z;
      let u = dot(SEA_D, tu) + P.sea[2].x;
      let c = dot(SEA_D, P.sea[1].xyz) + P.sea[2].y;
      let st = gnoiseI(vec3i(i32(P.sea[2].z) * 32, i32(P.sea[2].w) * 32, 13), vec3f(u / 9.0, c / 2.5, 0.0));
      crest = smoothstep(Jt + 0.1, Jt - 0.18, sw.foam) * clamp(0.55 + 0.9 * st, 0.0, 1.0) * (1.0 - calm);
      // (the foam left lying: a lace — bubbles gathered in cells and threads a metre or so across, drawn out along the
      // wind — thinning as it fades, its holes opening first)
      let fa = vec3i(i32(P.sea[2].z) * 32, i32(P.sea[2].w) * 32, 21);
      let lace = 0.65 * noise01(fa, vec3f(u / 3.5, c / 0.9, 0.0)) + 0.35 * noise01(fa + vec3i(0, 0, 3), vec3f(u / 1.1, c / 0.45, 0.0));
      let thin = clamp(sw.res * 1.4, 0.0, 1.0);
      // (the lace where a pixel resolves its cells — under ~1 m —, its mean beyond: no grain)
      let fine = smoothstep(1.2, 0.4, footM);
      lying = (smoothstep(1.0 - thin, 1.15 - 0.6 * thin, lace) * thin * fine + sw.res * 0.45 * (1.0 - fine)) * (1.0 - calm);
      crestH = sw.h;
    } else {
      sw = seaWaves(normal, tu, P.sea[1].xyz, footM);
    }
    n = normalize(mix(sw.n, normal, calm));
    vu = sw.vu * (1.0 - calm);
    vc = sw.vc * (1.0 - calm);
    fine = 1.0 - 0.5 * b;
    // (the ships' wakes: their waves, their smoothed strips)
    wk = seaWake(normal, footM);
    n = normalize(n - wk.g * b);
    let sm = 1.0 - 0.6 * wk.calm * b;
    fine *= sm;
    vu *= sm;
    vc *= sm;
    // (a craft's downwash: the water ruffled — its slopes' variance raised, the glint scattered, the lane darker)
    vu += wk.rough * b;
    vc += wk.rough * b;
  }
  // (a lake's wind: the fetch's — a few hundred metres to kilometres — keeps its waves a ripple; cat's paws
  // over it, a breath of wind here and not there — the open sea, calm 0, without its noise; no lakes without
  // the scenery: out of the kernel)
  if (HAS_SCENERY && calm > 0.0) {
    let paws = 0.5 + 0.5 * gnoise(q * (EARTH_RM / 40.0) + vec3f(P.time.x * P.near5.w * 0.02));
    U = mix(U, min(U * 0.3, 2.2) * paws + 0.15, calm);
  }
  var su2 = 0.00316 * U * fine + vu;
  var sc2 = (0.003 + 0.00192 * U) * fine + vc;
  if (tailU >= 0.0) {
    let b = P.sea[1].w;
    su2 = mix(0.00316 * U, tailU, b) * (1.0 - 0.6 * wk.calm * b) + vu;
    sc2 = mix(0.003 + 0.00192 * U, tailC, b) * (1.0 - 0.6 * wk.calm * b) + vc;
  }
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
  var Fv = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  // (the mirror over the slopes the pixel does not resolve — Bruneton, Neyret & Holzschuch 2010 —: their Fresnel averaged, not
  // the mean facet's — the grazing sea no mirror, darker than the sky over its horizon, as seen —; and the facets the eye sees
  // most, turned towards it — those turned away hidden behind the crests —, mirror a higher sky: the mirrored direction lifted
  // by their mean slope towards the eye, a Gaussian's cut at the view's grazing, σ φ(a)/Φ(a))
  let sigV = sqrt(max(0.5 * m2v, 0.0));
  var lift = 0.0;
  if ((TUNE_GSKIP & 2048u) == 0u) {
    Fv = 0.02 + 0.98 * pow(1.0 - nv, 5.0 * exp(-2.69 * sigV)) / (1.0 + 22.7 * pow(sigV, 1.5));
    let cg = clamp(dot(normal, V), 0.0, 1.0);
    let a = cg / max(sqrt(1.0 - cg * cg), 1e-3) / max(sigV, 1e-3);
    lift = 2.0 * atan(sigV * 0.39894 * exp(-0.5 * a * a) * (1.0 + exp(-1.702 * a)));
  }
  // (grazing, capped — no sparks along the limb)
  let glint = Eg * min(D * G * F / (4.0 * nv), 8.0);
  // (the sky it mirrors brighter towards the horizon than overhead — some three times on a clear day —: a wave's
  // face turned to the horizon shines, its back mirrors the darker zenith — what shows the waves from above)
  let rr = reflect(-V, n);
  // (a ray the waves send under the horizon mirrors the horizon's sky; lifted by the unresolved slopes — lift above)
  var rUp = normalize(rr + normal * max(0.02 - dot(rr, normal), 0.0));
  let hzR = rUp - normal * dot(rUp, normal);
  // (straight up along the normal: no horizontal part to lift towards — left as it is)
  if (lift > 0.0 && dot(hzR, hzR) > 1e-12) {
    let e = min(asin(clamp(dot(rUp, normal), -1.0, 1.0)) + lift, 1.5);
    rUp = normalize(hzR) * cos(e) + normal * sin(e);
  }
  var skyR = sky * (1.5 / PI) * (1.75 - 1.15 * sqrt(clamp(dot(rr, normal), 0.0, 1.0)));
  // (the clear sky's own radiance there — skyMirror: its horizon's band, the glow on the Sun's side, the blue overhead —, in
  // the colour of the sky's light here: under the weather's decks their grey, the clear sky's shape kept)
  let clearM = skyMirror(rUp);
  if (clearM.x >= 0.0 && (TUNE_GSKIP & 512u) == 0u) {
    let clearE = skyIrradiance(0.0, normal);
    skyR = clearM * clamp(sky / max(clearE, vec3f(1e-30)), vec3f(0.0), vec3f(2.0));
  }
  var water = under;
  var skyClear = skyR;
  if (SEA_ON) {
    let b = P.sea[1].w;
    // (near: the real sky mirrored — the light probe about the craft, its clouds)
    skyClear = skyR;
    skyR = mix(skyR, probeRadiance(camAxes(fromBody(rUp))), b);
    // (the water's own colour, from the light into it: the open sea's dark blue, its scattering; over a shallow bed —
    // SEA_DEPTH, the tiles' bathymetry — the bed seen through it, the light down to it and back attenuated by the water's
    // absorption — clear coastal water's, the red gone in a few metres, the blue and green in tens —: sand turquoise,
    // rock and weed darker, the deep blue as the bed sinks)
    let Ein = Eg * max(dot(normal, Ls), 0.0) + sky;
    let deep = Ein * vec3f(0.004, 0.017, 0.040) / PI;
    water = mix(under, deep, b);
    if (SEA_DEPTH_W > 0.0 && SEA_DEPTH < 60.0 && (TUNE_GSKIP & 1024u) == 0u) {
      let u = dot(SEA_D, P.sea[0].xyz) + P.sea[2].x;
      let c = dot(SEA_D, P.sea[1].xyz) + P.sea[2].y;
      let anchor = vec3i(i32(P.sea[2].z) * 32, i32(P.sea[2].w) * 32, 17);
      let patchy = smoothstep(0.45, 0.7, noise01(anchor, vec3f(u, c, 0.0) / 40.0) * 0.7 + noise01(anchor + vec3i(0, 0, 2), vec3f(u, c, 0.0) / 9.0) * 0.3);
      let bed = mix(vec3f(0.42, 0.38, 0.28), vec3f(0.07, 0.09, 0.05), patchy * smoothstep(1.5, 6.0, SEA_DEPTH));
      // (the paths in the water: refracted — Snell, n 1.33 —, down from the Sun and the sky, up to the eye)
      let cv = sqrt(max(1.0 - (1.0 - nv * nv) / 1.77, 0.05));
      let cs = sqrt(max(1.0 - (1.0 - nl * nl) / 1.77, 0.3));
      let Kd = vec3f(0.40, 0.065, 0.045);
      let T = exp(-Kd * SEA_DEPTH * (1.0 / cv + 1.0 / cs));
      let Tv = exp(-Kd * SEA_DEPTH * 2.0 / cv);
      let shallow = deep * (1.0 - Tv) + bed / PI * Ein * T;
      // (with confidence alone: along the bathymetry's rim its few valid texels averaged to a metre or so — the bed's sand
      // through a few centimetres of water, a white line round the data's edge)
      water = mix(water, shallow, b * smoothstep(0.6, 1.0, SEA_DEPTH_W));
    }
    // (the aerated water of a wake: the bubbles under the surface scatter the light back — pale turquoise)
    water = mix(water, Ein * vec3f(0.02, 0.075, 0.085) / PI, clamp(wk.bub * b, 0.0, 1.0) * 0.8);
  }
  var refl = mix(skyR, mirror.rgb, mirror.w);
  var ssrW = 0.0;
  // (near, in the raster's image: the world itself mirrored — seaSSR, the cliffs, the coast, the trees, the mountains with
  // their parallax —, along a facet drawn from the unresolved slopes' distribution — the frames' history sums their lobe:
  // sharp on a calm sea, smeared into long streaks under the wind)
  if (SEA_ON && RASTER_SHADE && (TUNE_GSKIP & 4096u) == 0u) {
    let r1 = max(RND, 1e-4);
    let r2 = fract(RND * 91.7 + 0.31);
    let g = sqrt(-2.0 * log(r1)) * vec2f(cos(TAU * r2), sin(TAU * r2));
    let nS = normalize(n - g.x * sqrt(su2) * tun - g.y * sqrt(sc2) * tcn);
    let rS = reflect(-V, nS);
    if (NEAR_DETAIL && dot(rS, normal) > 0.005) {
      let ssr = seaSSR(SEA_D, normalize(vec3f(rS.xy, rS.z * AIR.ab)));
      refl = mix(refl, ssr.rgb, ssr.w * P.sea[1].w);
      ssrW = ssr.w * P.sea[1].w;
    }
  }
  // (the far clouds mirrored — the probe sees them from the craft, not from the sea kilometres off: their parallax wrong
  // there —: the mirrored ray met at each layer's height — the map's at 3 km, the weather's at their middles —, that point
  // found in the cloud pass's image, its clouds taken where they lie that far along the camera's ray; front to back over
  // the clear sky's mirror; the world's own mirror — seaSSR — first)
  if (SEA_ON && (TUNE_GSKIP & 16384u) == 0u) {
    let wss = max(smoothstep(800.0, 4000.0, length(SEA_D)), 1.0 - P.sea[1].w) * (1.0 - ssrW);
    let upq = normalize(q);
    let rq = normalize(vec3f(rUp.xy, rUp.z * AIR.ab));
    let sinE = max(dot(rq, upq), 0.02);
    if (wss > 0.0) {
      var Tr = 1.0;
      var cc = vec3f(0.0);
      var met = false;
      for (var i = 0u; i < 4u; i++) {
        var hc = 3000.0;
        if (i == 0u) {
          if (P.earth2.y <= 0.0) { continue; }
        } else {
          let L = P.wx[i];
          if (!HAS_WX || P.wx[0].x <= 0.0 || L.z <= 0.0) { continue; }
          hc = 0.5 * (L.x + L.y);
        }
        let sM = hc / sinE;
        if (sM > 150000.0) { continue; }
        let sc = seaScreen(SEA_D + rq * sM);
        if (sc.x < 0.0 || sc.x >= P.res.x || sc.y < 0.0 || sc.y >= P.res.y) { continue; }
        let ca = cloudsAtPixel(sc.xy);
        if (ca.a <= 0.02) { continue; }
        if (abs(cloudDepthAtPixel(sc.xy) - sc.z) > 0.35 * sc.z + 500.0) { continue; }
        cc += Tr * ca.a * ca.rgb;
        Tr *= 1.0 - ca.a;
        met = true;
      }
      if (met) { refl = mix(refl, skyClear * Tr + cc, wss); }
    }
  }
  var sea = water * (1.0 - Fv) + glint + Fv * refl;
  // (the light through a wave's crest, green-blue, seen against the Sun: the crest's height over the sea's spread)
  if (tailU >= 0.0 && P.seafft[0].z > 0.0) {
    let back = pow(clamp(dot(V, -Ls) * 0.5 + 0.5, 0.0, 1.0), 4.0);
    let lift = clamp(crestH / (2.0 * P.seafft[0].z), 0.0, 1.0);
    sea += vec3f(0.01, 0.07, 0.06) * Eg * max(dot(normal, Ls), 0.0) * back * lift * (1.0 - Fv);
  }
  // (the foam lit as a diffuse white of reflectance 0.6, by the sun and the sky; near, in patches over
  // ~8 m — on the same anchor —, their mean the cover)
  var W = clamp(3.84e-6 * pow(U, 3.41), 0.0, 0.1) * (1.0 - calm);
  if (SEA_ON) {
    let u = dot(SEA_D, P.sea[0].xyz) + P.sea[2].x;
    let c = dot(SEA_D, P.sea[1].xyz) + P.sea[2].y;
    let pn = gnoiseI(vec3i(i32(P.sea[2].z) * 32, i32(P.sea[2].w) * 32, 7), vec3f(u, c, 0.0) / 8.0);
    let spots = clamp(W * 5.0 * smoothstep(0.35, 0.8, pn), 0.0, 1.0);
    if (tailU >= 0.0) {
      // (the FFT's breaking crests where it resolves them — Monahan's mean cover beyond)
      W = mix(W, max(crest, 0.8 * lying), smoothstep(30.0, 6.0, footM) * P.sea[1].w);
    } else {
      W = mix(W, spots, smoothstep(16.0, 4.0, footM) * P.sea[1].w) * (1.0 - calm);
    }
    W = max(W, wk.foam * P.sea[1].w);
    // (the surf: where the bed rises to some 1.3 significant heights the waves break — depth-limited, γ ≈ 0.78 —, their
    // crests white bands running in at the shallow water's celerity √(g d): on a beach of slope s, a crest reaches the
    // shore from depth d in 2√d / (s √g) — the bands follow the depth's contours, spaced as the period has them, the
    // foam trailing seaward of each front, broken along it; the inner surf, the swash a lasting white)
    if (SEA_DEPTH_W > 0.0 && (TUNE_GSKIP & 1024u) == 0u) {
      let Hs = select(0.021 * U * U, 4.0 * P.seafft[0].z, P.seafft[0].x > 0.5);
      let Tp = select(0.73 * U + 2.0, P.seafft[0].w, P.seafft[0].w > 0.5);
      let dB = 1.3 * Hs + 0.25;
      if (SEA_DEPTH < dB && Hs > 0.05) {
        let tclock = P.time.x * P.near5.w;
        let u = dot(SEA_D, P.sea[0].xyz) + P.sea[2].x;
        let c = dot(SEA_D, P.sea[1].xyz) + P.sea[2].y;
        let anchor = vec3i(i32(P.sea[2].z) * 32, i32(P.sea[2].w) * 32, 19);
        let brk = noise01(anchor, vec3f(u, c, tclock * 0.08) / 7.0);
        let ph = tclock / Tp + 2.0 * sqrt(SEA_DEPTH) / (0.03 * 3.13 * Tp) + 0.35 * gnoiseI(anchor + vec3i(0, 0, 3), vec3f(u, c, 0.0) / 60.0);
        let band = exp(-fract(ph) * 4.0) * clamp(0.35 + 0.9 * brk, 0.0, 1.0);
        let inner = smoothstep(0.45 * dB, 0.1 * dB, SEA_DEPTH) * clamp(0.5 + 0.8 * brk, 0.0, 1.0);
        // (resolved where the bands are a few footprints apart — Tp √(g d) metres —, their mean white beyond)
        let res = smoothstep(0.5, 0.15, footM / max(Tp * sqrt(9.81 * max(SEA_DEPTH, 0.3)), 1.0));
        let surf = max(mix(0.3, band, res), inner) * smoothstep(dB, 0.6 * dB, SEA_DEPTH) * min(Hs / 0.4, 1.0);
        // (only where the depth is known with confidence: along the bathymetry's edge, its few valid texels averaged to a metre
        // or so, the surf drew a white line that followed the data's rim, not a shore)
        W = max(W, surf * P.sea[1].w * smoothstep(0.6, 1.0, SEA_DEPTH_W) * (1.0 - calm));
      }
    }
  }
  let foam = 0.6 / PI * (Eg * nl + sky);
  // (a debug view of the wakes: their foam red, their ruffle green, their bubbles blue — TUNE_GSKIP 32768)
  if ((TUNE_GSKIP & 32768u) != 0u) { return vec3f(wk.foam, wk.rough * 10.0, wk.bub) * luminance(Eg) / PI; }
  return mix(sea, foam, W);
}

// The world mirrored in the sea from the raster's own image (screen-space reflections — the realtime raster pipeline's shade
// kernel alone): from the sea's point D (from the camera, the Earth's axes [m]) along r (the squashed space's), 20 steps
// growing from a metre to 8 km, each projected into the image and met against the raster's nearest surface there
// (terrainRasterDepth); a crossing just behind it — within 8 % or 15 m: not behind a ridge's silhouette — bisected, its
// pixel's colour taken from the image as it stands (accum: the last frame's, a pixel this frame's pattern leaves) where the
// raster shaded it — not the cockpit's, not the sky's —, faded at the image's rim. w 0: nothing met in the image (the sky's mirror, the probe's).
fn seaScreen(X: vec3f) -> vec3f {
  let l = fromBody(X);
  let z = dot(l, P.camFwd.xyz);
  if (z <= 1e-3) { return vec3f(-1.0); }
  let nx = dot(l, P.camRight.xyz) / (z * P.cam.w * P.camRight.w);
  let ny = dot(l, P.camUp.xyz) / (z * P.cam.w);
  return vec3f((nx + 1.0) * 0.5 * P.res.x, (1.0 - ny) * 0.5 * P.res.y, length(X));
}
// The inland water (shadeLite: OSM's rivers and lakes — the sea is seaShade's): its own style, not the sea's calmed. A river:
// a current's ripples, short, drawn out along the way the air moves over it and running with it, turbid green-brown water; a
// lake: near a mirror, its ripples longer and fainter, a breath of wind here and not there (cat's paws), darker water. Both:
// four trains of capillary-gravity ripples (ω² = gk + σk³/ρ) about the wind's way, each faded under the pixel's footprint
// and its slopes' variance then the unresolved roughness; the sky mirrored by Fresnel over the rippled facet (the clear
// sky's radiance there, skyMirror, in this sky's light), the world mirrored near (seaSSR), the Sun's glint (Beckmann).
// q, view, light in the squashed space; SEA_D the point from the camera [m].
fn inlandWater(q: vec3f, view: vec3f, light: vec3f, Eg: vec3f, sky: vec3f, footM: f32, lake: bool) -> vec3f {
  let normal = geoQ(q);
  let V = airPhysicalDirection(view);
  let Ls = airPhysicalDirection(light);
  var tu = P.sea[0].xyz - normal * dot(P.sea[0].xyz, normal);
  tu = select(normalize(tu), normalize(cross(normal, vec3f(0.0, 0.0, 1.0))), dot(tu, tu) < 1e-10);
  let tc = cross(normal, tu);
  // (the surface's own coordinates [m], anchored as the sea's — whole kilometres —: still under the camera's motion)
  let x = vec2f(dot(SEA_D, tu) + P.sea[2].x, dot(SEA_D, tc) + P.sea[2].y);
  let t = P.time.x * P.near5.w;
  let ang = select(vec4f(-0.45, -0.12, 0.18, 0.5), vec4f(-1.0, -0.3, 0.4, 1.1), lake);
  let len = select(vec4f(0.3, 0.55, 1.0, 1.8), vec4f(0.6, 1.1, 2.0, 3.6), lake);
  // (a lake's breath of wind: its ripples over 40 m patches)
  let paws = select(1.0, 0.25 + 0.75 * smoothstep(-0.3, 0.6, gnoise(vec3f(x / 40.0, t * 0.03))), lake);
  let amp = select(vec4f(0.07, 0.06, 0.05, 0.04), vec4f(0.03, 0.03, 0.025, 0.02), lake) * paws;
  var g = vec2f(0.0);
  var m2 = select(0.004, 0.0015, lake) * paws + 0.0005;
  for (var i = 0; i < 4; i++) {
    let d = vec2f(cos(ang[i]), sin(ang[i]));
    let k = TAU / len[i];
    let w = sqrt(9.81 * k + 7.4e-5 * k * k * k);
    let fade = smoothstep(1.0 * footM, 3.0 * footM, len[i]);
    let ph = k * dot(d, x) - w * t + f32(i) * 1.7;
    g += amp[i] * fade * d * cos(ph);
    m2 += 0.5 * amp[i] * amp[i] * (1.0 - fade);
  }
  let n = normalize(normal - g.x * tu - g.y * tc);
  let nv = max(dot(n, V), 0.02);
  let F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  // (the sky it mirrors: brighter towards the horizon; a ray the ripples send under the horizon mirrors the horizon's)
  let rr = reflect(-V, n);
  let rUp = normalize(rr + normal * max(0.02 - dot(rr, normal), 0.0));
  var refl = sky * (1.5 / PI) * (1.75 - 1.15 * sqrt(clamp(dot(rUp, normal), 0.0, 1.0)));
  let clearM = skyMirror(rUp);
  if (clearM.x >= 0.0) { refl = clearM * clamp(sky / max(skyIrradiance(0.0, normal), vec3f(1e-30)), vec3f(0.0), vec3f(2.0)); }
  // (near, the world mirrored — the banks, the bridges, the buildings — from the raster's image)
  if (NEAR_DETAIL && RASTER_SHADE && dot(rUp, normal) > 0.005) {
    let ssr = seaSSR(SEA_D, normalize(vec3f(rUp.xy, rUp.z * AIR.ab)));
    refl = mix(refl, ssr.rgb, ssr.w);
  }
  // (the Sun's glint: Beckmann over the facet's unresolved slopes, Smith's masking)
  let H = normalize(Ls + V);
  let hz = max(dot(n, H), 1e-3);
  let D = exp(-(1.0 - hz * hz) / (hz * hz * m2)) / (PI * m2 * hz * hz * hz * hz);
  let nl = max(dot(n, Ls), 0.0);
  let Gs = smithBeckmann(nl, m2) * smithBeckmann(nv, m2);
  let FH = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  let glint = Eg * min(D * Gs * FH / (4.0 * nv), 8.0);
  // (the water's own colour from the light into it: a river's silt green-brown — turbid, the Seine's: ~5 % sent back, the sunlit
  // water lighter than a bridge's shadow on it —, a lake's deeper green-blue)
  let Ein = Eg * max(dot(normal, Ls), 0.0) + sky;
  let body = Ein * select(vec3f(0.045, 0.05, 0.034), vec3f(0.006, 0.013, 0.015), lake) / PI;
  return body * (1.0 - F) + F * refl + glint;
}

fn seaSSR(D: vec3f, r: vec3f) -> vec4f {
  let d0 = length(D);
  let s0 = 1.0 + 0.004 * d0;
  let k = pow(8000.0 / s0, 1.0 / 19.0);
  var s = s0;
  var sPrev = 0.0;
  for (var i = 0; i < 20; i++) {
    cost(5u);
    let sc = seaScreen(D + r * s);
    if (sc.x < 0.0 || sc.x >= P.res.x || sc.y < 0.0 || sc.y >= P.res.y) { return vec4f(0.0); }
    let dz = terrainRasterDepth(sc.xy);
    if (dz > 0.0 && sc.z > dz) {
      if (sc.z - dz > max(0.08 * dz, 15.0)) { return vec4f(0.0); }
      var lo = sPrev;
      var hi = s;
      for (var j = 0; j < 4; j++) {
        let m = 0.5 * (lo + hi);
        let sm = seaScreen(D + r * m);
        let dm = terrainRasterDepth(sm.xy);
        if (dm > 0.0 && sm.z > dm) { hi = m; } else { lo = m; }
      }
      let sh = seaScreen(D + r * hi);
      var px = vec2u(clamp(sh.xy, vec2f(0.0), P.res.xy - 1.0));
      // (a pixel this frame's shading writes — other threads of this very dispatch — read from its neighbour across, which
      // no rate's pattern shades in the same frame: the last frame's colour, whole, not a value torn mid-write; at every
      // pixel a frame, all are written: the nearest as it stands)
      let rate = rasterRate();
      if (rate > 1u && rasterShaded(px, rate, P.frame.x)) { px.x = select(px.x + 1u, px.x - 1u, px.x + 1u >= u32(P.res.x)); }
      let idx = px.y * u32(P.res.x) + px.x;
      let mk = moments[idx].x;
      if (mk < 1e29 && !(mk < -2.5 && mk > -3.5)) { return vec4f(0.0); }
      let c = accum[idx];
      if (c.a <= 0.0) { return vec4f(0.0); }
      let uv = sh.xy / P.res.xy;
      let rim = smoothstep(0.0, 0.06, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
      return vec4f(c.rgb / c.a, rim);
    }
    sPrev = s;
    s *= k;
  }
  return vec4f(0.0);
}

// The world mirrored in calm water at q (a unit point of the squashed space; rd the camera's ray there): the
// reflected ray over the real relief — its own march from the water, on the Earth's axes (a float keeps
// ~0.4 m of them: enough for a mountain kilometres off) — and the shore's trees (sceneryMirror), the nearer
// of the two lit by the sun on its slope and the sky, hazed by the distance as the air does. w 1 where it
// met something; 0 (the sky's reflection then) where it rose into the sky.
fn waterMirror(q: vec3f, rd: vec3f, Ls: vec3f, E: vec3f, sky: vec3f, footM: f32) -> vec4f {
  let r = reflect(rd, q);
  if (dot(r, q) <= 0.0005) { return vec4f(0.0); }
  let rp = airPhysicalDirection(r);
  let Lp = airPhysicalDirection(Ls);
  // (the water's surface: the relief there, the ray started 1.5 m above it — a float keeps ~0.8 m of a point
  // of the unit sphere, and the march's cheap heights differ from the full ones: from the water itself, a
  // grazing ray would meet it at once)
  let p0 = q * (1.0 + (earthHeight(q, max(footM, 1.0)) + 1.5) / EARTH_RM);
  let trees = sceneryMirror(rp, Ls, E, sky);
  let tEnd = select(25000.0, trees.w, trees.w > 0.0) / EARTH_RM;
  var t = 3.0 / EARTH_RM;
  var tPrev = t;
  var fPrev = -1.0;
  var tHit = -1.0;
  for (var i = 0; i < 64; i++) {
    cost(5u);
    let p = p0 + r * t;
    let rr = length(p);
    let foot = max(footM, t * EARTH_RM * 0.003);
    let f = rr - 1.0 - earthHeightStep(p / rr, foot) / EARTH_RM;
    // (a crossing only once the ray has been above the ground: never the shore's own rounding)
    if (f < 0.0 && fPrev > 0.0) {
      // (bracketed: bisected on the full heights)
      var lo = tPrev;
      var hi = t;
      for (var j = 0; j < 4; j++) {
        let m = 0.5 * (lo + hi);
        let pm = p0 + r * m;
        let rm = length(pm);
        if (rm - 1.0 - earthHeight(pm / rm, max(footM, m * EARTH_RM * 0.003)) / EARTH_RM < 0.0) { hi = m; } else { lo = m; }
      }
      tHit = 0.5 * (lo + hi);
      break;
    }
    tPrev = t;
    fPrev = f;
    t += max(0.6 * abs(f), 0.01 * t + 2.0 / EARTH_RM);
    if (t > tEnd) { break; }
  }
  if (tHit < 0.0) {
    // (no ridge before the trees: the trees, or the sky)
    if (trees.w > 0.0) { return vec4f(mix(trees.rgb, sky * 1.5 / PI, 1.0 - exp(-trees.w / 20000.0)), 1.0); }
    return vec4f(0.0);
  }
  let ph = p0 + r * tHit;
  let qh = normalize(ph);
  let gqh = geoQ(qh);
  let dM = tHit * EARTH_RM;
  let foot = max(footM, dM * 0.003);
  // (its colour as the ground's: the day's map and, near, the tiles' imagery)
  let day = textureSampleLevel(earthCube, bgSamp, eCube(gqh), 0.0);
  let img = earthImagery(gqh, foot);
  let A = mix(day.rgb, img.c.rgb, img.w) * P.earth2.z;
  // (its slope: three heights, as earthNormalAt — not the walking grid's)
  let e = max(foot, 10.0) / EARTH_RM;
  let t1 = normalize(cross(qh, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(qh.z) > 0.9)));
  let t2 = cross(qh, t1);
  let h0 = earthHeight(qh, foot);
  let n = normalize(qh - ((earthHeight(normalize(qh + t1 * e), foot) - h0) * t1 + (earthHeight(normalize(qh + t2 * e), foot) - h0) * t2) / (e * EARTH_RM));
  let nP = airPhysicalNormal(n);
  let mu = dot(gqh, Lp);
  let L = A / PI * (E * sunThrough(max(h0, 0.0), mu) * max(dot(nP, Lp), 0.0) + sky * 0.5 * (1.0 + dot(nP, gqh)));
  return vec4f(mix(L, sky * 1.5 / PI, 1.0 - exp(-dM / 20000.0)), 1.0);
}

struct SurfaceImage { c: vec3f, w: f32, cover: u32 }
// BEGIN_WORLD_SCENERY
var<private> SC_POINT:vec3f=vec3f(0.0);
var<private> SC_DISTANCE:f32=1e9;
var<private> SC_SAMPLE:f32=0.0;
// Worldwide scenery: one bounded storage buffer, stackless BVH; all distances are local metres.
@group(0) @binding(32) var<storage, read> scenery: array<vec4f>;
fn forestData(i:u32)->vec4f { return scenery[i]; }
// BEGIN_FOREST_MODULE (shaders/forest.wgsl set in at load, src/forest-shader.ts: this stub draws no tree)
struct ForestHit { t: f32, n: vec3f, kind: u32, part: u32, base: vec3f, height: f32, seed: f32, ao: f32 };
fn forestQuery(o: vec3f, d: vec3f, tMax: f32, anyHit: bool, detail: f32) -> ForestHit { return ForestHit(tMax, vec3f(0.0), 0u, 0u, vec3f(0.0), 0.0, 0.0, 1.0); }
struct ForestHead { F: u32, w: i32, h: i32, cellsAt: u32, cell: f32, columns: i32, i0: i32, j0: i32, C: vec3f, Dm: vec3f };
fn forestHead(F: u32) -> ForestHead { return ForestHead(F, 0, 0, 0u, 0.0, 1, 0, 0, vec3f(0.0), vec3f(0.0)); }
fn forestCandidate(o: vec3f, d: vec3f, i: i32, j: i32, detail: f32, hd: ForestHead) -> ForestHit { return ForestHit(-1.0, vec3f(0.0), 0u, 0u, vec3f(0.0), 0.0, 0.0, 1.0); }
fn forestCandidateStart(o: vec3f, d: vec3f, i: i32, j: i32, hd: ForestHead) -> f32 { return 0.0; }
fn forestQueryFrom(o: vec3f, d: vec3f, tStart: f32, tMax: f32, anyHit: bool, detail: f32) -> ForestHit { return ForestHit(tMax, vec3f(0.0), 0u, 0u, vec3f(0.0), 0.0, 0.0, 1.0); }
struct ForestLook { albedo: vec3f, through: vec3f };
fn forestLook(h: ForestHit, n: vec3f, p: vec3f, sat: vec4f) -> ForestLook { return ForestLook(vec3f(0.0), vec3f(0.0)); }
// END_FOREST_MODULE
fn sceneryLocal(d:vec3f)->vec3f { return vec3f(dot(d,P.scenery[0].xyz),dot(d,P.scenery[1].xyz),dot(d,P.scenery[2].xyz)); }
fn sceneryGlobal(d:vec3f)->vec3f { return d.x*P.scenery[0].xyz+d.y*P.scenery[1].xyz+d.z*P.scenery[2].xyz; }
fn sceneryColour(at:vec2i,n:u32)->vec3f {
  let p=vec2u(clamp(at,vec2i(0),vec2i(i32(n)-1)));let idx=p.y*n+p.x;
  let packed=bitcast<u32>(scenery[u32(scenery[0].z)+idx/4u][idx%4u]);
  let c=vec3f(f32(packed&255u),f32((packed>>8u)&255u),f32((packed>>16u)&255u))/255.0;
  return select(c/12.92,pow((c+0.055)/1.055,vec3f(2.4)),c>vec3f(0.04045));
}
fn sceneryImage(q:vec3f)->SurfaceImage {
  var o=SurfaceImage(vec3f(0.0),0.0,0u);
  if(!HAS_SCENERY || P.scenery[2].w<0.5 || P.scenery[5].y<0.5 || P.scenery[5].z<0.5){return o;}
  let lon=atan2(q.y,q.x);
  let delta=atan2(sin(lon-P.scenery[4].x),cos(lon-P.scenery[4].x));
  let uv=vec2f(delta*P.scenery[4].z,(P.scenery[4].y-asin(clamp(q.z,-1.0,1.0)))*P.scenery[4].w);
  if(any(uv<vec2f(0.0)) || any(uv>=vec2f(1.0))){return o;}
  let n=u32(scenery[0].w);let at=vec2u(uv*f32(n));
  let idx=at.y*n+at.x;let packed=bitcast<u32>(scenery[u32(scenery[0].z)+idx/4u][idx%4u]);
  o.cover=packed>>24u;
  if((packed&0xffffffu)==0u){return o;}
  let grid=uv*f32(n)-.5;let a=vec2i(floor(grid));let w=fract(grid);
  o.c=mix(mix(sceneryColour(a,n),sceneryColour(a+vec2i(1,0),n),w.x),mix(sceneryColour(a+vec2i(0,1),n),sceneryColour(a+vec2i(1,1),n),w.x),w.y);
  let rim=min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y));
  o.w=smoothstep(0.0,0.04,rim)*P.scenery[3].w;
  return o;
}
// The satellite's colour at a frame point (east, north metres), its weight 0 where the raster has none.
fn sceneryColourAt(xy:vec2f)->vec4f {
  if(P.scenery[5].y<0.5 || P.scenery[5].z<0.5){return vec4f(0.0);}
  let latC=P.scenery[4].y-0.5/P.scenery[4].w;
  let uv=vec2f(0.5+xy.x/(6378137.0*cos(latC))*P.scenery[4].z,0.5-xy.y/6378137.0*P.scenery[4].w);
  if(any(uv<vec2f(0.0)) || any(uv>=vec2f(1.0))){return vec4f(0.0);}
  let n=u32(scenery[0].w);let grid=uv*f32(n)-.5;let a=vec2i(floor(grid));let w=fract(grid);
  let c=mix(mix(sceneryColour(a,n),sceneryColour(a+vec2i(1,0),n),w.x),mix(sceneryColour(a+vec2i(0,1),n),sceneryColour(a+vec2i(1,1),n),w.x),w.y);
  return vec4f(c,select(1.0,0.0,dot(c,vec3f(1.0))<=0.0));
}
// (a building's: geo its geometry's vec4 index, aux a wall's coordinate along it and its length [m])
struct SceneryHit { t:f32, normal:vec3f, albedo:vec3f, kind:f32, root:f32, geo:u32, aux:vec2f };
fn sceneryEllipsoid(o:vec3f,d:vec3f,c:vec3f,r:vec3f)->vec4f {
  let p=(o-c)/r;let v=d/r;let a=dot(v,v);let b=dot(p,v);let det=b*b-a*(dot(p,p)-1.0);
  if(det<0.0){return vec4f(-1.0);}
  var t=(-b-sqrt(det))/a;if(t<0.001){t=(-b+sqrt(det))/a;}
  if(t<0.001){return vec4f(-1.0);}
  return vec4f(t,normalize((o+d*t-c)/(r*r)));
}
fn sceneryPolygon(p:vec2f,base:u32,count:u32)->bool {
  var inside=false;
  for(var i=0u;i<count;i++){
    let e=scenery[base+3u+i];
    if((e.y>p.y)!=(e.w>p.y)){
      let x=e.x+(p.y-e.y)*(e.z-e.x)/(e.w-e.y);
      if(p.x<x){inside=!inside;}
    }
  }
  return inside;
}
fn sceneryQuery(o:vec3f,d:vec3f,limit:f32,shadow:bool)->SceneryHit {
  var out=SceneryHit(limit,vec3f(0.0),vec3f(0.0),-1.0,0.0,0u,vec2f(0.0));
  let inv=1.0/select(d,vec3f(1e-8),abs(d)<vec3f(1e-8));
  let total=u32(scenery[0].x);var i=0u;
  // Stackless escape indices make the CPU/GPU storage bound independent of density.
  while(i<total){
    cost(6u);
    let lo=scenery[4u+i*2u];let hi=scenery[5u+i*2u];
    let a=(lo.xyz-o)*inv;let b=(hi.xyz-o)*inv;
    let near=max(max(min(a,b).x,min(a,b).y),min(a,b).z);
    let far=min(min(max(a,b).x,max(a,b).y),max(a,b).z);
    if(far<max(near,0.0) || near>out.t){i=u32(lo.w);continue;}
    if(hi.w<0.0){i++;continue;}
    let base=u32(scenery[0].y+hi.w);let p=scenery[base];var alb=scenery[base+2u].xyz;
    var h=vec4f(-1.0);var aux=vec2f(-1.0);
    {
      let count=u32(p.z);var best=out.t;
      // (a building's roof — kind 1, docs/PLAN-BATIMENTS-AAA.md B2 —: z = the least of its planes over its footprint, the
      // space under them convex — the ray enters it where the last of the planes it crosses downwards lets it in, a single
      // footprint test there —; the bridges' decks a flat top at p.y)
      let np=select(0u,(u32(scenery[base+2u].w)>>14u)&15u,p.w>.5&&p.w<1.5);
      let R=base+4u+count;
      // (a terrace's parapet: its walls 0.8 m over its roof — scenery-data.ts PARAPET_M —, packed word's bit 22)
      let lip=select(0.0,0.8,np>0u && ((u32(scenery[base+2u].w)>>22u)&1u)==1u);
      if(np>0u){
        var tin=-1e30;var tout=1e30;var nIn=vec3f(0.0,0.0,1.0);
        for(var k=0u;k<np;k++){
          let pl=scenery[R+k];
          let A=pl.x*o.x+pl.y*o.y+pl.z-o.z;let B=pl.x*d.x+pl.y*d.y-d.z;
          if(abs(B)<1e-9){if(A<0.0){tin=1e30;}continue;}
          let tk=-A/B;
          if(B>0.0){if(tk>tin){tin=tk;nIn=vec3f(-pl.x,-pl.y,1.0);}}else{tout=min(tout,tk);}
        }
        if(tin<=tout && tin>0.001 && tin<best){
          let q=o+d*tin;
          if(q.z>=p.x && sceneryPolygon(q.xy,base,count)){best=tin;h=vec4f(tin,normalize(nIn));alb=scenery[R-1u].xyz;aux=vec2f(-1.0);}
        }
        // (its floor, from below alone)
        if(d.z>1e-7 && o.z<p.x){
          let t=(p.x-o.z)/d.z;
          if(t>0.001 && t<best && sceneryPolygon((o+d*t).xy,base,count)){best=t;h=vec4f(t,0.0,0.0,-1.0);}
        }
      }else if(abs(d.z)>1e-7){
        for(var cap=0u;cap<2u;cap++){
          let z=select(p.x,p.y,cap==1u);let t=(z-o.z)/d.z;
          if(t>0.001 && t<best && sceneryPolygon((o+d*t).xy,base,count)){
            best=t;h=vec4f(t,0.0,0.0,select(-1.0,1.0,cap==1u));
          }
        }
      }
      for(var e=0u;e<count;e++){
        let line=scenery[base+3u+e];let v=line.zw-line.xy;let den=d.x*v.y-d.y*v.x;
        if(abs(den)<1e-7){continue;}
        let q=line.xy-o.xy;let t=(q.x*v.y-q.y*v.x)/den;let u=(q.x*d.y-q.y*d.x)/den;
        let z=o.z+d.z*t;
        if(t>0.001 && t<best && u>=0.0 && u<=1.0 && z>=p.x && z<=p.y){
          // (a building's wall up to its roof there: a gable's peak, a mansard's eave)
          var roof=1e30;
          for(var k=0u;k<np;k++){let pl=scenery[R+k];roof=min(roof,pl.x*(o.x+d.x*t)+pl.y*(o.y+d.y*t)+pl.z);}
          let top=min(p.y,roof+lip);
          if(z<=top){let norm=normalize(vec3f(v.y,-v.x,0.0));best=t;h=vec4f(t,select(norm,-norm,dot(norm,d)>0.0));alb=scenery[base+2u].xyz;aux=vec2f(u,1.0)*length(v);}
        }
      }
    }
    if(h.x>0.0 && h.x<out.t){out=SceneryHit(h.x,h.yzw,alb,p.w,select(p.z,p.x,p.w>.5),base,aux);if(shadow){return out;}}
    i++;
  }
  return out;
}
// A building's look (docs/PLAN-BATIMENTS-AAA.md B3): its packed word's materials, storeys and shape (scenery-data.ts
// buildingPacked). Walls: storeys at the data's height (the eave over the storeys), bays of ~3.2 m along the wall itself,
// windows recessed and mirroring the sky, shop fronts at a tall block's foot, a quarter of a home's windows lit at
// night; the stone's courses, the brick's tone. Roofs: tiles' and slates' courses down the slope, zinc's standing seams
// and its sheen, a terrace's gravel; weathering. The detail fades with the distance (no shimmer past ~200 m).
fn buildingLook(hit:SceneryHit,p:vec3f,alb:ptr<function,vec3f>,n:ptr<function,vec3f>) {
  let g=hit.geo;let head=scenery[g];let w=u32(scenery[g+2u].w);
  let roofMat=w&15u;let wallMat=(w>>4u)&15u;let storeys=max(1u,(w>>8u)&63u);
  let base=head.x+1.0;let eave=scenery[g+3u+u32(head.z)].w;
  let near=1.0-smoothstep(120.0,260.0,hit.t);
  let id=g;
  // (a wall's hit has its coordinate along it — a mansard's steep brisis is roof)
  let wall=hit.aux.y>0.0;
  if(wall){
    // (the sky a wall sees: half of it, less at its foot)
    WS_AO=0.55*(0.7+0.3*smoothstep(0.0,4.0,p.z-base));
    let along=hit.aux.x;let len=hit.aux.y;
    // (a storey 2.6–4.2 m: a hall the registry counts one storey still has its windows a storey high)
    let hs=clamp((eave-base)/f32(storeys),2.6,4.2);
    let f=(p.z-base)/hs;let floorI=floor(f);let v=fract(f);
    let bays=max(1.0,round(len/3.2));let bw=len/bays;let u=fract(along/bw);let bay=floor(along/bw);
    // (a curtain wall — Overture's facade_material glass —: its mullions every 1.5 m, a spandrel a storey, the sky mirrored
    // whole; a share of its panes lit at night)
    if(wallMat==7u){
      let mull=fract(along/1.5)<0.05 || v<0.1;
      *alb=select(*alb,vec3f(0.16,0.17,0.18),mull);
      WS_S=select(0.1,0.0,mull);
      let hsh=hash3u(vec3u(id,u32(floorI),u32(floor(along/1.5)+512.0)));
      if(!mull && u2f(hsh)<0.35){WS_E=vec3f(0.95,0.92,0.85)*(0.04+0.06*u2f(pcg(hsh)))*near;}
      return;
    }
    // (the material's own grain: dressed stone's courses, brick's tone, render's stains)
    if(wallMat==1u){*alb*=0.92+0.08*smoothstep(0.0,0.06,fract((p.z-base)/0.45))*near;}
    else if(wallMat==4u){*alb*=0.85+0.3*hash31(vec3f(floor(along/0.25),floor((p.z-base)/0.075),f32(id)))*near;}
    else{*alb*=0.9+0.2*gnoise(p*vec3f(0.15,0.15,0.4));}
    // (above the eave a gable, a party wall's rise: blank)
    // (a chimney stack — shape 5 —: no window)
    if(p.z<eave-0.3 && len>2.4 && near>0.0 && ((w>>18u)&7u)!=5u){
      let shop=floorI<0.5 && storeys>=4u;
      let wu=select(0.26,0.12,shop);let wv0=select(0.28,0.08,shop);let wv1=select(0.86,0.82,shop);
      let inWin=u>wu && u<1.0-wu && v>wv0 && v<wv1 && p.z>base+0.5;
      if(inWin){
        let frame=min(min(u-wu,1.0-wu-u)*bw,min(v-wv0,wv1-v)*hs);
        if(frame>0.06){
          *alb=mix(*alb,vec3f(0.035,0.045,0.055),near);WS_S=0.04*near;
          // (lit at night: a third of a home's, more of a shop's — each its own warmth)
          let hsh=hash3u(vec3u(id,u32(floorI),u32(bay+512.0)));
          if(u2f(hsh)<select(0.28,0.55,shop)){WS_E=vec3f(1.0,0.8,0.52)*(0.05+0.09*u2f(pcg(hsh)))*near;}
        }else{*alb*=0.75;}
      }
      // (a storey's line: the floor's slab, a cornice's shadow)
      *alb*=1.0-0.12*near*(1.0-smoothstep(0.0,0.05,v));
      // (a Haussmann block — dressed stone, six storeys and more —: its wrought-iron balconies running along the 2nd and 5th
      // floors, a dark band at their sills)
      if(wallMat==1u && storeys>=6u && (floorI==2.0 || floorI==5.0) && v>0.22 && v<0.34){*alb=mix(*alb,vec3f(0.03,0.032,0.035),0.8*near);}
    }
  }else{roofLook(hit,p,alb,n,roofMat,(w>>18u)&7u,eave,near,id);}
}
fn roofLook(hit:SceneryHit,p:vec3f,alb:ptr<function,vec3f>,n:ptr<function,vec3f>,roofMat:u32,shape:u32,eave:f32,near:f32,id:u32) {
  if(hit.normal.z>0.98 || hit.normal.z<0.0){
    // (a flat roof: a terrace's gravel and its patches; a zinc terrasson's seams too)
    WS_AO=1.0;
    *alb*=0.85+0.25*gnoise(p*vec3f(0.5,0.5,0.0))*near+0.1*gnoise(p*0.07);
    if(roofMat==3u){*alb*=1.0-0.18*near*(1.0-smoothstep(0.0,0.04,fract(p.x/0.5)));WS_S=0.06*near;}
  }else{
    // (a slope: its courses across the fall line, its tiles or slates staggered along them; zinc's seams down it)
    WS_AO=0.9;
    let fall=normalize(hit.normal.xy);let across=vec2f(-fall.y,fall.x);
    // (along the slope itself: its run over the pitch's cosine)
    let s=dot(p.xy,fall)/max(hit.normal.z,0.2);let c=dot(p.xy,across);
    if(roofMat==3u){
      let seam=1.0-smoothstep(0.0,0.035,abs(fract(c/0.5)-0.5)*0.5);
      *alb*=1.0+0.25*seam*near;WS_S=0.06*near;
    }else if(roofMat==1u || roofMat==2u || roofMat==0u){
      let row=select(0.32,0.21,roofMat==2u);let wide=select(0.25,0.3,roofMat==2u);
      let r=s/row;let ri=floor(r);let t=fract(r);
      let tile=hash31(vec3f(floor(c/wide+0.5*fract(ri*0.5)),ri,f32(id&1023u)));
      // (each course shadowed under the one above it)
      *alb*=mix(1.0,(0.72+0.28*smoothstep(0.0,0.35,t))*(0.85+0.3*tile),near);
      *n=normalize(*n+vec3f(fall*0.25*(t-0.5),0.0)*near);
    }
    // (weathering: moss and soot down the slope)
    *alb*=0.82+0.18*gnoise(vec3f(c*0.4,s*0.15,f32(id&255u)));
    // (a mansard's brisis: its dormers, a bay's window each — their glass mirroring the sky, some lit at night)
    if(shape==3u && hit.normal.z<0.6 && near>0.0){
      let u=fract(c/3.2);let dz=p.z-eave;
      if(u>0.32 && u<0.68 && dz>0.7 && dz<2.5){
        let frame=min(min(u-0.32,0.68-u)*3.2,min(dz-0.7,2.5-dz));
        if(frame>0.08){
          *alb=mix(*alb,vec3f(0.035,0.045,0.055),near);WS_S=0.04*near;
          let hsh=hash3u(vec3u(id,u32(floor(c/3.2)+4096.0),7u));
          if(u2f(hsh)<0.3){WS_E=vec3f(1.0,0.8,0.52)*(0.05+0.09*u2f(pcg(hsh)))*near;}
        }else{*alb=mix(*alb,vec3f(0.42,0.4,0.36),near);}
      }
    }
  }
}
fn worldScenery(dW:vec3f,tMax:f32,rnd:f32)->f32 {
  SC_DISTANCE=1e9;WS_T=vec3f(0.0);
  if(!HAS_SCENERY || P.scenery[0].w<.5 || P.scenery[2].w<.5){return tMax;}
  let d=sceneryLocal(dW);let o=P.scenery[3].xyz;
  SC_SAMPLE=rnd;SC_POINT=o+d*tMax;SC_DISTANCE=tMax;
  // (the raster's buildings — their boxes: a pixel none covers has no building before its ground —; else the BVH walked)
  let bld=!RASTER_SCENERY || RASTER_BLD || (TUNE_SC_SKIP&8u)!=0u;
  // (no building here: a miss at the full reach — the trees' bound —, no BVH walked)
  let lim=min(tMax,P.scenery[1].w);
  var hit=SceneryHit(lim,vec3f(0.0),vec3f(0.0),-1.0,0.0,0u,vec2f(0.0));
  if((TUNE_SC_SKIP&1u)==0u && bld){hit=sceneryQuery(o,d,lim,false);}
  // (the raster's scenery — étape 1b —: the tree its instance drew at this pixel tested alone; a pixel it drew none at has
  // no tree before its ground; the instance's proxy wider than its tree there — a carved crown's gap —: the grid walked)
  var tree=ForestHit(hit.t,vec3f(0.0),0u,0u,vec3f(0.0),0.0,0.0,1.0);
  RASTER_PATH=3u;
  if(RASTER_SCENERY){
    RASTER_PATH=2u;
    if(RASTER_ID>0u){
      let F=u32(forestData(2u).x);
      if(F>0u){
        let hd=forestHead(F);let k=i32(RASTER_ID-1u);
        let c=forestCandidate(o,d,k%max(hd.w,1),k/max(hd.w,1),TUNE_FOREST_DETAIL,hd);
        if(c.t>0.0 && c.t<hit.t){tree=c;RASTER_PATH=0u;}
        else{tree=forestQueryFrom(o,d,forestCandidateStart(o,d,k%max(hd.w,1),k/max(hd.w,1),hd),hit.t,false,TUNE_FOREST_DETAIL);RASTER_PATH=1u;}
      }
    }
  }else{tree=forestQuery(o,d,hit.t,false,TUNE_FOREST_DETAIL);}
  if(tree.kind>0u){
    let p=o+d*tree.t;
    SC_POINT=p;SC_DISTANCE=tree.t;
    var n=tree.n;var alb:vec3f;
    var look=ForestLook(vec3f(0.12,0.16,0.08),vec3f(0.0));
    if((TUNE_SC_SKIP&2u)==0u){look=forestLook(tree,n,p,sceneryColourAt(tree.base.xy));}
    WS_T=look.through;
    if(tree.part==1u){
      // bark: furrowed along the trunk
      alb=look.albedo*(.8+.2*gnoise(p*vec3f(5.0,5.0,.7)));
    }else{
      // (far, where the crown is its plain shape: clumps in the normal stand for the carving)
      let far=smoothstep(150.0,260.0,tree.t);
      let clump=vec3f(gnoise(p*.9),gnoise(p*.9+vec3f(17.1,3.7,-5.3)),gnoise(p*.9+vec3f(-8.3,11.9,2.1)));
      n=normalize(n+.55*far*clump);
      // leaves facing all ways: a fine flicker of their own
      alb=look.albedo*(.8+.2*gnoise(p*5.3));
    }
    WS=vec4f(normalize(sceneryGlobal(n)),1.0);WS_A=alb;WS_E=vec3f(0.0);WS_S=0.0;WS_AO=1.0;
    return tree.t;
  }
  if(hit.kind<0.0){return tMax;}
  let p=o+d*hit.t;
  SC_POINT=p;SC_DISTANCE=hit.t;
  let rough=0.85+0.15*gnoise(p*.65);
  var alb=hit.albedo*rough;
  var n=hit.normal;
  WS_S=0.0;WS_AO=1.0;WS_E=vec3f(0.0);
  if(hit.kind>.5 && hit.kind<1.5){buildingLook(hit,p,&alb,&n);}
  WS=vec4f(normalize(sceneryGlobal(n)),1.0);WS_A=alb;
  return hit.t;
}

// A ray to the finite solar disc: existing temporal accumulation integrates the penumbra.
// Ambient skylight remains present in shadow. Any-hit traversal avoids finding the nearest blocker.
// (a face turned away from the Sun: no ray — the BVH and up to 640 forest steps for a light its cosine
// zeroes anyway — R-M2)
fn sceneryShadow(light:vec3f,normal:vec3f)->f32 {
  if(dot(light,normal)<=0.0){return 1.0;}
  let reach=select(1200.0,2000.0,P.scenery[5].x>.5);
  if(!HAS_SCENERY || P.scenery[0].w<.5 || P.scenery[2].w<.5 || P.scenery[5].w<.5 || SC_DISTANCE>reach || dot(light,P.scenery[2].xyz)<=.015){return 1.0;}
  let sun=sceneryLocal(light);let n=sceneryLocal(normal);
  let fade=smoothstep(reach-200.0,reach,SC_DISTANCE);
  let axis=normalize(cross(sun,select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),abs(sun.z)>.9)));
  let radius=.00465*sqrt(fract(SC_SAMPLE*7.31+.17));let phase=TAU*fract(SC_SAMPLE*13.73+.41);
  let d=normalize(sun+radius*(axis*cos(phase)+cross(sun,axis)*sin(phase)));
  let start=SC_POINT+n*.35+d*.15;let range=select(500.0,900.0,P.scenery[5].x>.5);
  // (past the tallest blocker's height above the ground — a tree's ~35 m, 60 with a slope's margin; a tower's 300 — the ray
  // meets nothing more: its walk no longer than that height over the Sun's sine — tens of metres at midday, not hundreds;
  // TUNE_SC_SKIP 16: the full range, as before)
  let full=(TUNE_SC_SKIP&16u)!=0u;
  let sz=max(d.z,0.06);
  // (the shadow map where it reaches — the trees' layer and the buildings' —; near the camera the buildings by their ray:
  // exact, their edges sharp where the map's ~0.9 m texel spans a dozen pixels, their penumbra the Sun's disc over the
  // frames — from 200 to 300 m a share of the pixels, the hand-over blended over the frames (docs/PLAN-BATIMENTS-AAA.md B8);
  // TUNE_SC_SKIP 64: the map's alone (B2–B5); 32: every ray, as before the map)
  if((TUNE_SC_SKIP&32u)==0u){
    let m=treeShadowAt(SC_POINT+n*.35);
    if(m>=0.0){
      var b=1.0;
      if((TUNE_SC_SKIP&64u)==0u && fract(SC_SAMPLE*5.17+.29)>smoothstep(200.0,300.0,SC_DISTANCE)){
        if(sceneryQuery(start,d,select(min(range,300.0/sz),range,full),true).kind>=0.0){b=0.0;}
      }else{
        let mb=buildingShadowAt(SC_POINT+n*.35);
        b=select(1.0,mb,mb>=0.0);
      }
      return mix(min(m,b),1.0,fade);
    }
  }
  let h=sceneryQuery(start,d,select(min(range,300.0/sz),range,full),true);
  var blocked=h.kind>=0.0;
  if(!blocked){blocked=forestQuery(start,d,select(min(range,60.0/sz),range,full),true,select(0.0,60.0,SC_DISTANCE<180.0)).kind>0u;}
  return mix(select(1.0,0.0,blocked),1.0,fade);
}
struct ScenerySurface { color:vec3f, cover:f32, kind:f32 };
fn scenerySurface(foot:f32)->ScenerySurface {
  var out=ScenerySurface(vec3f(0.0),0.0,0.0);
  if(!HAS_SCENERY || P.scenery[0].w<.5 || P.scenery[2].w<.5 || SC_DISTANCE>P.scenery[1].w){return out;}
  let point=SC_POINT.xy;let aa=max(.12,foot*.75);let header=scenery[1];let total=u32(header.y);var i=0u;var priority=0.0;var dryIsland=false;
  while(i<total){
    cost(6u);
    let lo=scenery[u32(header.x)+i*2u];let hi=scenery[u32(header.x)+i*2u+1u];
    if(any(point<lo.xy-vec2f(aa)) || any(point>hi.xy+vec2f(aa))){i=u32(lo.w);continue;}
    if(hi.w<0.0){i++;continue;}
    let base=u32(header.z+hi.w);let p=scenery[base];let size=scenery[base+1u];var color=scenery[base+2u].xyz;
    var kind=p.w;var cover=0.0;var rank=1.0;
    if(scenery[base+2u].w>.5){
      cover=select(0.0,1.0,sceneryPolygon(point,base,u32(p.z)));
      if(kind==4.0 && cover==0.0 && sceneryPolygon(point,base,u32(scenery[base+2u].w))){dryIsland=true;}
    }else{
      kind=size.y;let line=p.zw-p.xy;let len=max(length(line),.001);let along=clamp(dot(point-p.xy,line)/(len*len),0.0,1.0);
      let distance=length(point-p.xy-line*along);
      cover=1.0-smoothstep(max(0.0,size.x-aa),size.x+aa,distance);
      rank=select(2.0,3.0,kind==2.0);
      if(kind==1.0 && size.x>=3.5 && foot<2.0){
        let stripe=1.0-smoothstep(.09,.09+aa,distance);
        let dash=1.0-smoothstep(3.0-aa,3.0+aa,(along*len)%9.0);
        color=mix(color,vec3f(.65,.64,.56),stripe*dash);
      }
      if(kind==2.0 && foot<1.5){
        let rail=1.0-smoothstep(.06,.06+aa,abs(distance-.72));
        let sleeper=1.0-smoothstep(.18,.18+aa,(along*len)%.7);
        color=mix(color,vec3f(.18,.15,.10),sleeper);color=mix(color,vec3f(.42),rail);
      }
    }
    if(cover>0.0 && (rank>priority || (rank==priority && cover>out.cover))){priority=rank;out=ScenerySurface(color,cover,kind);}
    i++;
  }
  if(dryIsland && out.kind==3.0){out.cover=0.0;}
  out.cover*=P.scenery[3].w*smoothstep(P.scenery[1].w,P.scenery[1].w-300.0,SC_DISTANCE);
  return out;
}

// The shore's trees in calm water (waterMirror): the reflected ray (physical) from the water's point here
// (SC_POINT) through the forest grid, near; their light (the sun on their leaves, the sky) and distance [m]
// (−1: none)
fn sceneryMirror(rp:vec3f,Ls:vec3f,E:vec3f,sky:vec3f)->vec4f {
  if(!HAS_SCENERY || P.scenery[0].w<.5 || P.scenery[2].w<.5 || SC_DISTANCE>2500.0){return vec4f(0.0,0.0,0.0,-1.0);}
  let d=sceneryLocal(rp);
  let h=forestQuery(SC_POINT+vec3f(0.0,0.0,0.05),d,1500.0,false,0.0);
  if(h.kind==0u){return vec4f(0.0,0.0,0.0,-1.0);}
  let p=SC_POINT+d*h.t;
  let look=forestLook(h,h.n,p,sceneryColourAt(h.base.xy));
  let Lp=airPhysicalDirection(Ls);let nG=normalize(sceneryGlobal(h.n));let up=P.scenery[2].xyz;
  let L=look.albedo/PI*(E*sunThrough(max(p.z,0.0),dot(up,Lp))*max(dot(nG,Lp),0.0)+sky*0.5*(1.0+dot(nG,up)));
  return vec4f(L,h.t);
}
// A bridge's deck — any of the scenery's solids — met along the camera's ray dW (the body's axes) before tMax [m]: shadeLite's
// test at a bridge's marked pixel, the deck the rays' kernel's, the water about it its
fn sceneryDeckBefore(dW: vec3f, tMax: f32) -> bool {
  if (P.scenery[0].w < 0.5 || P.scenery[2].w < 0.5) { return false; }
  return sceneryQuery(P.scenery[3].xyz, sceneryLocal(dW), tMax, false).kind >= 0.0;
}
// shadeLite's trees (TERRE-UNREAL U2): the raster's tree at a pixel (its id) tested alone along the physical direction dW —
// its plain shape, the carving's sphere tracing left out (clumps in the normal stand for it, as worldScenery's far trees) —,
// the grid walked from it on a miss (crowns overlap on the screen), before tMax [m]; its look as worldScenery's in WS, WS_A,
// WS_T; the distance [m], −1 none
fn sceneryTreeLite(dW: vec3f, id: u32, tMax: f32) -> f32 {
  WS = vec4f(0.0);
  if (!HAS_SCENERY || P.scenery[0].w < 0.5 || P.scenery[2].w < 0.5 || id == 0u) { return -1.0; }
  let F = u32(forestData(2u).x);
  if (F == 0u) { return -1.0; }
  let d = sceneryLocal(dW);
  let o = P.scenery[3].xyz;
  let hd = forestHead(F);
  let k = i32(id - 1u);
  let ci = k % max(hd.w, 1);
  let cj = k / max(hd.w, 1);
  // (its plain crown whole — detail −1 —: the proxy the raster drew round it covers it, no more; a far crown's shrinking — half
  // its carving — left a ring of it uncovered round each crown, the ground behind there, the trees behind it gone)
  var tree = forestCandidate(o, d, ci, cj, -1.0, hd);
  // (missed — a crown behind it on the screen —: the ground there; the grid walked from it only with TUNE_LITE 256 — 40 % of
  // the material's time over Paris for nothing seen at a pixel's size; near, the rays' kernel's — rasterLiteTakes)
  if (!(tree.t > 0.0 && tree.t < tMax) && (TUNE_LITE & 256u) != 0u) {
    tree = forestQueryFrom(o, d, forestCandidateStart(o, d, ci, cj, hd), tMax, false, 0.0);
  }
  if (tree.kind == 0u || tree.t <= 0.0 || tree.t >= tMax) { return -1.0; }
  let p = o + d * tree.t;
  SC_POINT = p;
  SC_DISTANCE = tree.t;
  var n = tree.n;
  let look = forestLook(tree, n, p, sceneryColourAt(tree.base.xy));
  WS_T = look.through;
  var alb: vec3f;
  if (tree.part == 1u) {
    alb = look.albedo * (0.8 + 0.2 * gnoise(p * vec3f(5.0, 5.0, 0.7)));
  } else {
    let clump = vec3f(gnoise(p * 0.9), gnoise(p * 0.9 + vec3f(17.1, 3.7, -5.3)), gnoise(p * 0.9 + vec3f(-8.3, 11.9, 2.1)));
    n = normalize(n + 0.55 * clump);
    alb = look.albedo * (0.8 + 0.2 * gnoise(p * 5.3));
  }
  WS = vec4f(normalize(sceneryGlobal(n)), 1.0);
  WS_A = alb;
  return tree.t;
}
// The OSM water's cover at a ground point of the scenery's frame (shadeLite: the lakes and rivers its material draws as
// water), the pixel's footprint and distance [m]
// — its own walk of the surfaces, the water's alone, the most cover of them: scenerySurface keeps the surface of the highest
// rank, and a line — a railway, a road in its tunnel, under the river — outranks a polygon: the Seine was cut by dark bands
// along every line crossing it
// x the cover, y the calm of its water (a lake's 0.92, a river's 0.6 — earthGround's; a river: its polygon of a river's class,
// or a waterway's line; the sea's polygon 0: the sea's style)
fn sceneryWaterAt(p: vec3f, foot: f32, dist: f32) -> vec2f {
  if (!HAS_SCENERY || P.scenery[0].w < 0.5 || P.scenery[2].w < 0.5 || dist > P.scenery[1].w) { return vec2f(0.0); }
  let point = p.xy;
  let aa = max(0.12, foot * 0.75);
  // (the water's own tree — scenery-data.ts packScenery: scenery[2].y its nodes, .z their count —, its leaves the surfaces'
  // records: away from the water, a node or two walked, not the city's every road)
  let header = scenery[1];
  let wt = scenery[2];
  let total = u32(wt.z);
  var i = 0u;
  var water = 0.0;
  var dryIsland = false;
  var bank = false;
  var lake = false;
  var ocean = false;
  while (i < total) {
    let lo = scenery[u32(wt.y) + i * 2u];
    let hi = scenery[u32(wt.y) + i * 2u + 1u];
    if (any(point < lo.xy - vec2f(aa)) || any(point > hi.xy + vec2f(aa))) { i = u32(lo.w); continue; }
    if (hi.w < 0.0) { i++; continue; }
    let base = u32(header.z + hi.w);
    let q = scenery[base];
    let size = scenery[base + 1u];
    if (scenery[base + 2u].w > 0.5) {
      if (q.w == 3.0 || q.w == 4.0) {
        if (sceneryPolygon(point, base, u32(q.z))) {
          water = 1.0;
          bank = bank || q.w == 4.0;
          // (a lake's polygon, not a river's — the worker's colour: a river's blue under 0.05 —; the sea's near the coast — its
          // blue under 0.035 —: the sea's style, its calm 0, the waves the same both sides of the scenery's reach)
          lake = lake || scenery[base + 2u].z >= 0.05;
          ocean = ocean || scenery[base + 2u].z < 0.035;
        } else if (q.w == 4.0 && sceneryPolygon(point, base, u32(scenery[base + 2u].w))) { dryIsland = true; }
      }
    } else if (size.y == 3.0 || size.y == 4.0) {
      let line = q.zw - q.xy;
      let len = max(length(line), 0.001);
      let along = clamp(dot(point - q.xy, line) / (len * len), 0.0, 1.0);
      water = max(water, 1.0 - smoothstep(max(0.0, size.x - aa), size.x + aa, length(point - q.xy - line * along)));
    }
    i++;
  }
  // (an island of a river's polygon: dry, whatever other water's outline covers it — scenerySurface's rule)
  if (dryIsland && !bank) { water = 0.0; }
  return vec2f(water * P.scenery[3].w * smoothstep(P.scenery[1].w, P.scenery[1].w - 300.0, dist), select(select(0.6, 0.92, lake), 0.0, ocean));
}
// END_WORLD_SCENERY

fn surfaceImage(q: vec3f, fx: vec3f, fy: vec3f) -> SurfaceImage {
  var out = sceneryImage(q);
  if (!HAS_SURFACE || P.surface[2].w < 0.5) { return out; }
  let grid = vec2f(atan2(q.y, q.x) - P.surface[0].x, P.surface[0].y - asin(clamp(q.z, -1.0, 1.0))) * P.surface[0].z;
  let dims = vec2i(P.surface[1].xy);
  let at = vec2i(floor(grid));
  if (any(at < vec2i(0)) || any(at >= dims)) { return out; }
  let layer = at.y * dims.x + at.x;
  let valid = u32(P.surface[0].w);
  if ((valid & (1u << u32(layer))) == 0u) { return out; }
  let local = fract(grid);
  let uv = local * P.surface[1].w + P.surface[1].z;
  let rho2 = max(dot(q.xy, q.xy), 1e-6);
  let east = vec3f(-q.y, q.x, 0.0) / rho2;
  let latScale = inverseSqrt(max(1.0 - q.z*q.z, 1e-6));
  let gradX = vec2f(dot(east, fx), -fx.z * latScale) * P.surface[0].z * P.surface[1].w;
  let gradY = vec2f(dot(east, fy), -fy.z * latScale) * P.surface[0].z * P.surface[1].w;
  let c = textureSampleGrad(surfaceColour, surfaceSamp, uv, layer, gradX, gradY);
  // Fade across an unresident neighbour; no per-page fade once adjacent pages are resident.
  var edge = 1.0;
  let blend = 2.0 / (P.surface[2].x * P.surface[1].w);
  if (at.x == 0 || (valid & (1u << u32(max(layer-1, 0)))) == 0u) { edge *= smoothstep(0.0, blend, local.x); }
  if (at.x == dims.x-1 || (valid & (1u << u32(layer+1))) == 0u) { edge *= smoothstep(0.0, blend, 1.0-local.x); }
  if (at.y == 0 || (valid & (1u << u32(max(layer-dims.x, 0)))) == 0u) { edge *= smoothstep(0.0, blend, local.y); }
  if (at.y == dims.y-1 || (valid & (1u << u32(layer+dims.x))) == 0u) { edge *= smoothstep(0.0, blend, 1.0-local.y); }
  let rim = min(min(grid.x, grid.y), min(f32(dims.x)-grid.x, f32(dims.y)-grid.y));
  edge *= smoothstep(0.0, 0.025, rim);
  out.c = c.rgb;
  out.cover = textureLoad(surfaceCover, vec2i(uv * P.surface[2].x), layer, 0).r;
  let age = P.surface[2].w - 1.0 - P.surface[3u + u32(layer)/4u][u32(layer)%4u];
  out.w = edge * smoothstep(0.0, 0.35, age) * c.a * select(0.0, 1.0, out.cover > 0u);
  return out;
}

fn surfaceMaterial(q: vec3f, cover: u32, footM: f32) -> vec3f {
  if (P.surface[2].y < 0.5 || footM > 20.0) { return vec3f(1.0); }
  // Class-guided small detail only: preserve the real parcel/road layout in the satellite colour.
  let fine = smoothstep(8.0, 1.0, footM);
  var amplitude = 0.0;
  var scaleM = 2.0;
  if (cover == 10u || cover == 20u || cover == 95u) { amplitude = 0.12; scaleM = 12.0; }
  if (cover == 30u || cover == 40u || cover == 90u || cover == 100u) { amplitude = 0.04 * fine; }
  if (cover == 60u || cover == 70u) { amplitude = 0.07 * fine; }
  if (amplitude == 0.0) { return vec3f(1.0); }
  let filtered = smoothstep(scaleM * 2.0, scaleM * 0.5, footM);
  return vec3f(1.0 + amplitude * filtered * (gnoise(q * (EARTH_RM / scaleM)) * 2.0 - 1.0));
}

// (the camera's own ray's ground point [m, from the camera], for the Ranger's shadow — set by earthNear alone: the
// light probe's rays and a far body's ground, through earthLook too, had the camera's point — zero, or a pixel's
// left over —, and the whole probe's ground took the hull's shadow: the cockpit's ambient black in the sun — R-H1)
var<private> EARTH_SHADOW_POINT:vec3f;
var<private> EARTH_SHADOW_ON: bool = false;
// A runway's paving over the ground — its pavement and markings, flat; its lamps; the paving's cover and the point's place on
// it [m, along and across] (the rain's puddles) —: the tracer's ground (earthGround) and the raster's material (shadeLite).
// hit: the point from the camera [m, the body's physical axes]
struct RwyPave {
  A: vec3f,
  n: vec3f,
  lamps: vec3f,
  paved: f32,
  at: vec2f,
}
fn runwayPave(hit: vec3f, gq: vec3f, q: vec3f, rd: vec3f, Ls: vec3f, fx: vec3f, fy: vec3f, A0: vec3f, nIn: vec3f) -> RwyPave {
  var o = RwyPave(A0, nIn, vec3f(0.0), 0.0, vec2f(0.0));
  for (var k = 0u; k < rwyCount(); k++) {
    let rel = P.runways[4u + 4u * k].xyz + hit;
    let ra = dot(rel, P.runways[2u + 4u * k].xyz);
    let rc = dot(rel, P.runways[3u + 4u * k].xyz);
    let L = P.runways[1u + 4u * k].w;
    let hw = P.runways[2u + 4u * k].w;
    // (the strip and its shoulders; beyond its ends, out to 1 km and 25 m wide, the approach lights alone —
    // lit only: the markings reckoned over those fields cost the final's view 10 %)
    // (the strip, its shoulders and the taxiway left of it — A2)
    let onStrip = ra >= -120.0 && ra <= L + 120.0 && rc <= hw + 60.0 && rc >= -210.0;
    let lit = P.runways[17].y > 0.01 || dot(gq, airPhysicalDirection(Ls)) < 0.06;
    if (!onStrip && !(lit && ra > -1000.0 && ra < L + 1000.0 && abs(rc) < 25.0)) { continue; }
    // (the pixel's footprint on this runway's ground, along and across it [m])
    let ak = P.runways[2u + 4u * k].xyz;
    let ck = P.runways[3u + 4u * k].xyz;
    LAMP_F = vec4f(dot(fx, ak), dot(fx, ck), dot(fy, ak), dot(fy, ck)) * EARTH_RM;
    let fl = runwayFlags(k);
    let rev = (fl & 1u) != 0u;
    if (!onStrip) {
      if ((fl & 16u) == 0u || (fl & 32u) != 0u) { o.lamps += runwayLights(select(ra, L - ra, rev), select(rc, -rc, rev), L, hw, P.runways[17].x); }
      continue;
    }
    // (its published end's designation: packed by fours in runways[17].zw — 37 to a place)
    let pk = select(P.runways[17].z, P.runways[17].w, k >= 2u);
    let n0 = u32(pk / select(1.0, 37.0, (k & 1u) == 1u)) % 37u;
    let fw = max(vec2f(max(abs(LAMP_F.x), abs(LAMP_F.z)), max(abs(LAMP_F.y), abs(LAMP_F.w))), vec2f(0.02));
    let rl = runwayShade(ra, rc, L, hw, fw, asin(clamp(dot(-rd, q), -1.0, 1.0)), rev, lit, n0, fl);
    o.A = mix(o.A, rl.albedo, rl.cover);
    o.n = normalize(mix(o.n, q, rl.cover));
    o.lamps += rl.lamps;
    if (rl.cover > o.paved) {
      o.paved = rl.cover;
      o.at = vec2f(ra, rc);
    }
  }
  return o;
}

fn earthGround(q: vec3f, rd: vec3f, Ls: vec3f, E: vec3f, fx: vec3f, fy: vec3f, hG: f32) -> vec3f {
  if ((TUNE_SKIP & 8192u) != 0u) { return vec3f(0.05) * max(dot(normalize(q), Ls), 0.0); }
  // (the maps at the geodetic latitude — q the squashed space's —, the geometry at q)
  let gq = geoQ(q);
  let day = textureSampleGrad(earthCube, bgSamp, eCube(gq), eCube(fx), eCube(fy));
  let rel = earthRelief(gq, fx, fy);
  // (an airfield levelled — sites.ts runwayGrade —: land, even where the map had the sea — a runway's
  // embankment on the shore, Tanegashima's)
  var lvl = 0.0;
  if (HAS_RWY && RWY_HIT.w > 0.5) { lvl = runwayGrade(gq).y; }
  // (the sea's mask is the global relief map's — a few km a texel —: a ground the fine relief puts over the sea's
  // level — 0 there, its noise off below 40 m — is land whatever it says, and so is what the scenery draws on land —
  // the coast's hills and cliffs, a seaside town's low streets were shaded as the sea)
  var osm=scenerySurface(max(length(fx),length(fy))*EARTH_RM);
  if ((TUNE_SC_SKIP & 4u) != 0u) { osm.cover = 0.0; }
  if ((TUNE_GSKIP & 256u) != 0u) { osm.cover = 0.0; }
  let osmWater=select(0.0,osm.cover,osm.kind==3.0 || osm.kind==4.0);
  let osmLand=select(osm.cover,0.0,osm.kind==3.0 || osm.kind==4.0);
  let overSea = max(smoothstep(0.5, 2.0, hG), osmLand);
  let sea0 = smoothstep(0.35, 0.65, rel.b) * (1.0 - overSea);
  let ocean = max(sea0,osmWater) * (1.0 - lvl);
  // (near, the tiles' imagery over the maps: four to eight times finer)
  var img = earthImageryAniso(gq, fx, fy);
  if ((TUNE_GSKIP & 32u) != 0u) { img.w = 0.0; }
  var A = mix(day.rgb, img.c.rgb, img.w) * P.earth2.z;
  A = mix(A, vec3f(0.11, 0.12, 0.065) * P.earth2.z, sea0 * lvl);
  var surface = surfaceImage(gq, fx, fy);
  if ((TUNE_GSKIP & 64u) != 0u) { surface.w = 0.0; }
  A = mix(A, surface.c * P.earth2.z, surface.w);
  // (the IGN's orthophotos over the regional pilot's 10 m: finer, and a photograph — no drawn cover, snow or rock over
  // them, nor the map's roads)
  A = mix(A, img.c.rgb * P.earth2.z, img.o);
  let photo = max(surface.w, img.o);
  // (the relief: east and north components; the map's is faint — strengthened, P.earth.w)
  var east = vec3f(-q.y, q.x, 0.0);
  east = select(normalize(east), vec3f(0.0, 1.0, 0.0), dot(east, east) < 1e-10);
  let north = cross(q, east);
  let tn = vec2f(rel.r * 2.0 - 1.0, 1.0 - rel.g * 2.0) * P.earth.w * (1.0 - ocean);
  var n = normalize(q + tn.x * east + tn.y * north);
  // (an airfield levelled — sites.ts runwayGrade —: the map's slopes gone with its relief)
  n = normalize(mix(n, q, lvl));
  // (near — a pixel under the map's texel — the relief's own normal: its ridges, crests and rocks)
  let footM = max(length(fx), length(fy)) * EARTH_RM;
  let texelM = EARTH_RM * TAU / f32(textureDimensions(earthElev).x);
  if (footM < texelM && ocean < 1.0 && (TUNE_GSKIP & 1u) == 0u) {
    n = normalize(mix(n, earthNormalAt(q, footM), smoothstep(texelM, 0.3 * texelM, footM) * (1.0 - ocean)));
  }
  // (near: the ground's own materials from its height and slope — snow above the snow line (lower towards
  // the poles, ragged), bare rock on the steep faces of the mountains; blended in as the map's texel
  // grows under the pixel)
  if (footM < texelM && ocean < 1.0 && photo < 0.999 && (TUNE_GSKIP & 4u) == 0u) {
    let k = smoothstep(texelM, 0.3 * texelM, footM) * (1.0 - ocean) * (1.0 - photo);
    let slope = 1.0 - clamp(dot(n, q), 0.0, 1.0);
    let lat = abs(asin(clamp(gq.z, -1.0, 1.0))) * 57.29578;
    let snowLine = snowLineAt(lat) + 300.0 * gnoise(q * 3000.0);
    let snow = smoothstep(snowLine - 250.0, snowLine + 250.0, hG) * (1.0 - smoothstep(0.25, 0.5, slope));
    let rock = smoothstep(0.22, 0.45, slope) * smoothstep(300.0, 1500.0, hG);
    A *= mix(vec3f(1.0), earthCover(q, A, n, hG, footM), k);
    A = mix(A, vec3f(0.16, 0.145, 0.13) * (0.8 + 0.4 * gnoise(q * 40000.0)), rock * k);
    A = mix(A, vec3f(0.82, 0.84, 0.88), snow * k);
  }
  if (surface.w > 0.0) { A *= mix(vec3f(1.0), surfaceMaterial(gq, surface.cover, footM), surface.w * (1.0 - img.o)); }
  A=mix(A,osm.color,osm.cover*(1.0-img.o));
  // (a runway: its pavement and markings over the ground, flat; its lights added below)
  var rwyLamps = vec3f(0.0);
  // (the paving's cover here and its coordinates on its runway [m, along and across]: the rain's puddles
  // and ripples on it — PLAN-PLUIE P4)
  var rwyPaved = 0.0;
  var rwyAt = vec2f(0.0);
  if (HAS_RWY && RWY_HIT.w > 0.5) {
    let rp = runwayPave(RWY_HIT.xyz, gq, q, rd, Ls, fx, fy, A, n);
    A = rp.A;
    n = rp.n;
    rwyLamps = rp.lamps;
    rwyPaved = rp.paved;
    rwyAt = rp.at;
  }
  // (the rain — PLAN-PLUIE P4 —: the ground wet, darker — the soil's pores and the asphalt's filled with water
  // —, and a sheen of the sky, strong at a grazing view; on the paving, water lying in its hollows and the
  // drops' rings spreading on it, near)
  var wetS = 0.0;
  var ripple = 0.0;
  if (HAS_WX && WX_W > 0.0 && P.wx[5].x > 0.0) {
    let wet = P.wx[5].x * WX_W * (1.0 - ocean);
    var pud = 0.0;
    if (HAS_RWY && rwyPaved > 0.0) {
      // (the puddles: the paving's hollows, a few metres long, more of them the harder it rains)
      let pn = vnoise(vec3f(rwyAt.x * 0.08, rwyAt.y * 0.2, 3.0)) * 0.6 + vnoise(vec3f(rwyAt.x * 0.31, rwyAt.y * 0.55, 7.0)) * 0.28
        + vnoise(vec3f(rwyAt.x * 1.3, rwyAt.y * 1.7, 11.0)) * 0.12;
      pud = smoothstep(0.7 - 0.06 * min(P.wx[5].y, 1.0), 0.8 - 0.06 * min(P.wx[5].y, 1.0), pn) * rwyPaved * wet;
      // (the rings: a drop's impact every ~0.3 m about every second, each ring spreading at ~0.35 m/s and
      // fading; seen only near, the pixel under a few centimetres)
      let near = smoothstep(0.1, 0.02, footM) * min(P.wx[5].y, 1.0);
      if (near > 0.0) {
        let cp = rwyAt / 0.3;
        for (var dj = 0; dj < 2; dj++) {
          for (var di = 0; di < 2; di++) {
            let id = floor(cp) + vec2f(f32(di), f32(dj)) - vec2f(0.5);
            let hh = vec2f(hash31(vec3f(id, 11.0)), hash31(vec3f(id, 23.0)));
            let age = fract(P.wx[5].z * (0.9 + 0.5 * hh.x) + hh.y);
            let ctr = (id + 0.5 + 0.5 * (vec2f(hash31(vec3f(id, 5.0)), hash31(vec3f(id, 7.0))) - 0.5)) * 0.3;
            let d = length(rwyAt - ctr);
            let rr = age * 0.11;
            ripple += exp(-pow((d - rr) / 0.006, 2.0)) * (1.0 - age) * (1.0 - age);
          }
        }
        ripple *= near * (0.35 + 0.65 * pud / max(wet, 1e-3));
      }
    }
    A *= mix(vec3f(1.0), vec3f(mix(0.58, 0.7, rwyPaved)), wet);
    A *= 1.0 - 0.35 * pud;
    // (the sheen: rough wet ground a little of the sky's, wet asphalt more, a puddle a mirror)
    wetS = wet * mix(0.08, 0.3, rwyPaved) + pud * 0.4;
  }
  let V = -rd;
  let physicalLs = airPhysicalDirection(Ls);
  let physicalNormal = airPhysicalNormal(n);
  let mu0 = dot(gq, physicalLs);
  // the sunlight at the ground, through the air and under the clouds (their shadow, cast along the
  // sun's slant from their height; softened)
  let hc = P.earth2.x;
  let marchMu = dot(q, Ls);
  let qs = normalize(q + (Ls - q * marchMu) * (hc / max(marchMu, 0.06)));
  var shade = 1.0;
  if ((TUNE_GSKIP & 16u) == 0u) { shade = 1.0 - 0.8 * earthCloud(qs, fx * 3.0, fy * 3.0, Ls).x; }
  // (the weather near the camera: its layers' shadows in place of the map's — each cast from its middle
  // along the sun's slant, through its gaps; the light its decks spread, below with the sky's)
  let wg = wxNear(q);
  var wxVl = vec2f(1.0);
  if (HAS_WX && wg > 0.0 && (TUNE_GSKIP & 16u) == 0u) {
    shade = mix(shade, 1.0, wg);
    for (var i = 0u; i < 3u; i++) {
      let L = P.wx[1u + i];
      if (L.z <= 0.0 || hG >= L.y) { continue; }
      let hm = 0.5 * (L.x + L.y) - hG;
      let qi = normalize(q + (Ls - q * marchMu) * (hm / EARTH_RM / max(marchMu, 0.06)));
      shade *= 1.0 - wg * wxLayerA(qi, i) * (1.0 - exp(-0.5 * L.w / max(marchMu, 0.06)));
    }
    wxVl = wxVeil(hG, wg, 3u);
  }
  // (N3: the clouds' transmittance map where it reaches — every layer's own shadow, where this Sun casts it —, the 2D
  // covers above beyond it)
  let csT = select(-1.0, cloudShadowAt(q * (1.0 + hG / EARTH_RM)), (TUNE_GSKIP & 8192u) == 0u);
  if (csT >= 0.0) { shade = csT; }
  var Eg = E * sunThrough(hG, mu0) * shade * sunSeen(q * (1.0 + hG / (EARTH_RM * earthSq(q))), Ls);
  if (NEAR_DETAIL) { Eg *= sceneryShadow(physicalLs,physicalNormal); }
  if (EARTH_SHADOW_ON) { Eg *= shipShadow(EARTH_SHADOW_POINT); }
  // (near, the mountains' shadows: a peak between the sun and the valley)
  let footS = max(length(fx), length(fy)) * EARTH_RM;
  if (footS < 2.0 * EARTH_RM * TAU / f32(textureDimensions(earthElev).x) && mu0 > -0.05 && ocean < 1.0 && (TUNE_GSKIP & 2u) == 0u) {
    Eg *= mix(1.0, earthTerrainShadow(q * (1.0 + hG / EARTH_RM), Ls, footS), 1.0 - ocean);
  }
  // (near: the land's colour and relief finer than the maps — the noise's slopes facing the sun lit)
  var relLit = 1.0;
  let og = earthOct(fx, fy);
  if (og > 0.0 && ocean < 1.0 && (TUNE_GSKIP & 8u) == 0u) {
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
  var sky = max(skyFlat(q, hG, E, mu0, sk), E * nightFloor(sk, mu0));
  // (under the weather's decks: the blue sky hidden by their cover, their own grey light instead — what
  // comes through them, and for a broken sky what their sunlit sides and bases send down, most at half
  // cover: a cloud's shadow on the ground ~3 times darker than the sun beside it, not black)
  if (HAS_WX && wg > 0.0) {
    let side = 0.5 * wxVl.x * (1.0 - wxVl.x);
    sky = sky * wxVl.x + (E * sunThrough(hG, mu0) * max(mu0, 0.0) * sk + sky) * (wxVl.y - wxVl.x + side);
  }
  // (a lightning flash — N5 —: the clouds' undersides lit, their light on the ground for kilometres round)
  if (HAS_WX && P.wx[6].w > 0.0) {
    let f = flashAt();
    sky += FLASH_TINT * luminance(E) * 0.05 * f.w * exp(-length(q * (1.0 + hG / EARTH_RM) - f.xyz) * EARTH_RM / 10000.0);
  }
  // (a face sees the sky over it and the ground round it — a plane's shares, ½(1 + n·up) and ½(1 − n·up)
  // —: on the steep faces in the shade, the sky's light halved and the light the ground sends back — the
  // sun's and the sky's on it, at an albedo of 0.18: a cliff's shadow 2–3 stops under the sunlit ground,
  // as the eye sees it, not black)
  let up = dot(physicalNormal, gq);
  let bounce = (E * sunThrough(hG, mu0) * shade * max(mu0, 0.0) + sky) * 0.18 * 0.5 * (1.0 - up);
  var col = A / PI * (Eg * max(dot(physicalNormal, physicalLs), 0.0) * relLit + sky * 0.5 * (1.0 + up) + bounce
    + E * earthMoonlight(q, n, hG, mu0) * shade);
  // (the wet ground's sheen: the sky mirrored by the water on it, by Fresnel — a wet runway seen ahead
  // silvery —, the rings breaking it)
  if (wetS > 0.0) {
    let cv = clamp(dot(physicalNormal, airPhysicalDirection(V)), 0.0, 1.0);
    let F = (0.02 + 0.98 * pow(1.0 - cv, 5.0)) * wetS;
    col = col * (1.0 - F) + F * sky * 1.1 / PI * (1.0 + 2.5 * ripple);
    // (a ring catches the sky's light whatever the view: its crest a bright line)
    col += ripple * 0.35 * sky / PI;
  }
  // the sea (seaShade): the sun's glint off its wind-roughened slopes, the sky mirrored, the whitecaps
  if (ocean > 0.0 && (TUNE_GSKIP & 128u) == 0u) {
    // (inland water — OSM's lakes and rivers off the sea's map —: calm, a lake more than a river; near, the
    // world mirrored in it)
    // (HAS_SCENERY: without it the calm is 0 only at run time — 0 · x does not fold without fast-math —, and
    // waterMirror's march, bisection and sceneryMirror stayed in the kernel — R-M1)
    let calm = select(0.0, osmWater * (1.0 - sea0) * select(0.6, 0.92, osm.kind == 4.0), HAS_SCENERY);
    var mirror = vec4f(0.0);
    if (HAS_SCENERY && calm > 0.3 && footM < 40.0) { mirror = waterMirror(q, rd, Ls, E, sky, footM); }
    // (the sea's own footprint: its ellipse's mean axis — not its longest, stretched tens of times at a grazing
    // view, every wave then averaged away —, and of the full image the realtime tiles fill over frames, not of a
    // whole tile)
    let footSea = sqrt(length(fx) * length(fy)) * EARTH_RM / sqrt(max(FOOT, 1.0));
    // (inland water: its depth not in the relief — the lake's surface is —, deep assumed)
    let dw = select(seaDepthAt(gq, footSea), vec2f(1e4, 0.0), calm > 0.0 || !SEA_ON);
    SEA_DEPTH = dw.x;
    SEA_DEPTH_W = dw.y;
    col = mix(col, seaShade(q, V, Ls, Eg, sky, col, footSea, calm, mirror), ocean);
  }
  // the cities at night (sodium's orange, whiter at their hearts), fading into the twilight
  let lights = mix(textureSampleGrad(earthNight, bgSamp, eCube(gq), eCube(fx), eCube(fy)).r, img.c.a, img.w);
  let lamp = max(lights - 0.07, 0.0) / 0.93;
  let dark = 1.0 - smoothstep(-0.12, 0.06, mu0);
  col += mix(vec3f(1.0, 0.55, 0.22), vec3f(1.0, 0.85, 0.6), lamp) * (pow(lamp, 1.4) * P.earth.z * dark * luminance(E) / PI);
  // (the runways' lamps: a sunlit sky's worth by day — barely seen —, far over the night's ground)
  // (by day in a poor visibility — fog, rain: P.runways[17].y — at their brightest, as the tower sets them;
  // at night thousands of times the night's own light: each lamp a point that glows — the bloom's — from km out)
  if (HAS_RWY) { col += rwyLamps * (luminance(E) / PI) * mix(mix(0.6, 8.0, P.runways[17].y), 3000.0, dark); }
  return col;
}

// Another world's ground (or cloud deck) seen through its air: its map (at the footprint's level), lit
// by the sunlight come down through the air (reddened, dimmed low, none in the shadow) and by its sky;
// the giants darkened towards the limb (Minnaert), the dusty worlds as regolith (Lommel–Seeliger)
fn otherGround(k: u32, q: vec3f, rd: vec3f, Ls: vec3f, E: vec3f, fp: f32) -> vec3f {
  setMapLod(fp, fp, k);
  let m = u32(bodies[BV * k + 2u].z) - 4u;
  var A: vec3f;
  // (Jupiter's, Saturn's cloud deck near — under their air: their clouds moving, in place of the fixed map, as planetShade's
  // discs; Mars's kernel carries it, its branch never taken. Only where a giant can be the near body — NEAR_KIND 0, 2 —, and
  // not the Earth's material kernels — NEAR_KIND 0 there, the regional surface's code in: a giant is never near with it)
  if (NEAR_DETAIL && !HAS_SURFACE && NEAR_KIND != 1u && NEAR_KIND != 3u && NEAR_KIND != 4u && NEAR_KIND != 5u && NEAR_KIND != 6u && NEAR_KIND != 7u && (m == 4u || m == 5u) && P.near5.w > 0.0) { A = giantAlbedo(m, q, P.time.x, bodies[BV * k + 2u].y) * ALB_TINT; } else { A = planetAlbedo(k, q, P.time.x).rgb * ALB_TINT; }
  if (isEarth(k)) { A = max(A, vec3f(0.015, 0.04, 0.07)); }
  let mu0 = dot(q, Ls);
  let mu = max(dot(q, -rd), 0.02);
  // (Mars's relief marched: its normal and shadow from earthNear — HD_N, REL_SH)
  var nrm = HD_N;
  if (!HD_N_ON) { nrm = hdNormal(k, q); }
  let cosi = max(dot(nrm, Ls), 0.0);
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
  var direct = 1.0;
  var sky = AIR.sky * smoothstep(-0.15, 0.25, mu0);
  // (Titan: under its haze the sky's light is nearly all of it — a dome brighter towards the Sun, the haze's forward scattering
  // (g ≈ 0.6): the slopes read by it, the dunes' flanks, a pebble's side half lit; flat ground as before)
  if (m == 19u) {
    let dz = normalize(q + 1.5 * Ls);
    let a = (0.5 + 0.5 * dot(nrm, dz)) / (0.5 + 0.5 * dot(q, dz));
    sky *= 0.35 + 0.65 * a * a;
    if (TITAN_WET > 0.5) {
      // (a sea of methane: dark, a mirror — Fresnel's at n 1.29 — of its sky, brighter low and towards the Sun, and the Sun's
      // glint through the haze)
      let r = reflect(rd, nrm);
      let F = 0.016 + 0.984 * pow(1.0 - max(dot(nrm, -rd), 0.0), 5.0);
      let aur = pow(max(dot(r, Ls), 0.0), 12.0);
      let day = smoothstep(-0.15, 0.25, mu0);
      let Lsky = AIR.sky / PI * (1.8 - 1.2 * max(dot(r, q), 0.0) + 4.0 * aur) * day;
      // (the glint's spread: the unresolved slopes' — TITAN_WET over 1 —, a mirror's 900 by default)
      let sp = select(900.0, 2.0 / max((TITAN_WET - 1.0) * (TITAN_WET - 1.0), 1e-4), TITAN_WET > 1.0001);
      let glint = sunThrough(0.0, mu0) * pow(max(dot(r, Ls), 0.0), min(sp, 4000.0)) * (sp + 2.0) / 6.0;
      return E * (F * (Lsky + glint) + (1.0 - F) * 0.015 / PI * AIR.sky * day);
    }
  }
  if (isEarth(k)) {
    direct = sunSeenPhysical(earthSurface(q) / EARTH_RM, Ls);
    sky = max(sky * direct, nightFloor(direct, mu0));
  } else {
    // (a moon's shadow on it — PLAN-CIEL C6: Io's black dot on Jupiter, Phobos's on Mars)
    direct = airShade(q);
    sky *= direct;
    direct *= REL_SH;
  }
  return A / PI * E * (sunThrough(0.0, mu0) * f * rs * direct + sky + shine);
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
  let mu0 = dot(geoQ(q), airPhysicalDirection(Ls));
  let Ts = sunThrough(h * earthSq(q), mu0) * sunSeen(q * (1.0 + h / EARTH_RM), Ls);
  let ct = dot(airPhysicalDirection(rd), airPhysicalDirection(Ls));
  let ph = min(0.75 * hgPhase(0.85, ct) + 0.25 * hgPhase(-0.1, ct), 1.0);
  let sk = skySeen(q, Ls);
  let amb = max(0.7 * skyFlatFactor(q, 9000.0, E, mu0, sk), nightFloor(sk, mu0) * CLOUD_NIGHT_FLOOR);
  return E * (Ts * ph * 4.0 + 0.6 / PI * amb);
}

// The cloud cover smoothed at a map level (lod), on the clouds' drift — the long shadows' heights
fn cloudCoverAt(q0: vec3f, lod: f32) -> f32 {
  let q = rotZ(geoQ(q0), P.earth.y);
  return clamp((cloudRawLevel(eCube(q), lod) - 0.06) * 1.25, 0.0, 1.0);
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
  // (the weather whole round the camera: its layers there, the map's clouds beyond 250 km only)
  if (HAS_WX && WX_W >= 1.0) { t0 = max(t0, 250000.0 / EARTH_RM); }
  if (t1 <= t0) { return o; }
  let N = 16u;
  // (the sun's direction and the ray's metres per squashed radius on the physical axes: the same all along)
  let physicalLs = airPhysicalDirection(Ls);
  let stepM = EARTH_RM * airRayScale(rd);
  let ct = dot(airPhysicalDirection(rd), physicalLs);
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
    cost(3u);
    // (samples crowding near the camera: the near clouds' shapes resolved, the far ones' mean)
    let u1 = (f32(i) + 1.0) / f32(N);
    let tn = t0 + (t1 - t0) * u1 * u1;
    let t = mix(tPrev, tn, jit);
    let dm = (tn - tPrev) * stepM;
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
    let a = earthCloud(q, fx, fy, Ls).x / max(P.earth2.y, 1e-3) * (1.0 - wxNear(q));
    if (a <= 0.01) { continue; }
    let qd = rotZ(q, P.earth.y);
    let x = qd * (EARTH_RM / 2600.0) + vec3f(0.0, 0.0, hn * 2.0);
    // (the Perlin–Worley's domes for the two fine octaves — wxShape's —; TUNE_SC_SKIP 64: the old)
    var sh = 0.6 * dnoise(x);
    if ((TUNE_SC_SKIP & 64u) == 0u) { sh += 0.55 * (2.0 * cloudNoise(x * 2.3 + vec3f(5.1)).g - 1.0); }
    else { sh += 0.3 * dnoise(x * 2.3 + vec3f(5.1)) + 0.1 * dnoise(x * 5.3 + vec3f(1.7)); }
    // (the tops follow the cover smoothed over ~16 texels — tens of km —: gentle domes where the map's
    // cover ends sharply, not walls rising from its edge)
    let qc = rotZ(geoQ(q), P.earth.y);
    let soft = clamp((cloudRawGrad(eCube(qc), eCube(rotZ(fx, P.earth.y)) * 16.0, eCube(rotZ(fy, P.earth.y)) * 16.0) - 0.06) * 1.25, 0.0, 1.0);
    let top = (0.15 + 0.85 * soft) * (0.7 + 0.6 * sh);
    let hp = smoothstep(0.0, 0.05 + 0.12 * sh, hn) * (1.0 - smoothstep(0.45 * top, top, hn));
    let c = a;
    let rho = hp * clamp(1.6 * (a * (0.4 + sh) - 0.2), 0.0, 1.0); // (thin cover eroded to puffs and gaps)
    if (rho <= 0.0) { continue; }
    let sigma = rho * 25.0 / ((ht - hb) * EARTH_RM * max(top, 0.2)); // (per metre: τ ~ 25 through a thick one)
    let mu0 = dot(geoQ(q), physicalLs);
    // the sunlight: through the air to this height, then the cloud above it towards the sun
    let Ts = sunThrough(airHeight(p), mu0) * sunSeen(p, Ls);
    // (the cloud above this point, to its top; the sun's path through it — the clouds broken, it comes in by
    // their sides too: shortened)
    let tauUp = c * 25.0 * max(top - hn, 0.0) / max(top, 0.2);
    let tauSun = 0.4 * tauUp / max(mu0, 0.12);
    let beer = select(exp(-tauSun), 0.0, mu0 < -0.1);
    let powder = 1.0 - exp(-2.0 * sigma * 400.0 - 0.15);
    // (the sky's and the moon's light from above, dimmed by the cloud over it: a grey base, a bright top)
    let over = cloudDiffuseT(tauUp);
    // (the cloud below this point, to its base: the cities' light from below through it)
    let under = cloudDiffuseT(c * 25.0 * hn / max(top, 0.2));
    let sk = skySeen(q, Ls);
    let amb = max(0.7 * skyFlatFactor(q, airHeight(p), E, mu0, sk), nightFloor(sk, mu0) * CLOUD_NIGHT_FLOOR);
    // (the octaves' dimming from one exponential: e^(−0.04 τ), its square, its cube; deep in the cloud — its base — the
    // many-times scattered sunlight dimmed by the depth over it too)
    let e1 = exp(-0.04 * tauSun);
    let e2 = e1 * e1;
    let ms = (ms1 * e2 * e1 + 0.5 * ms2 * e2 + 0.25 * ms3 * e1) / 1.75 * (0.35 + 0.65 * over);
    let Lin = FLASH_TINT * luminance(E) * 0.25 * flashGlow(p) + E * Ts * (hg * beer * powder * 2.5 + 0.25 * ms * smoothstep(-0.1, 0.1, mu0))
      + 0.85 / PI * (over * (E * amb + E * earthMoonlight(q, q, airHeight(p), mu0)) + under * cityGlowUp(q, E, mu0));
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

// The weather's layer i as a volume (P.wx[1 + i]): marched as the Earth's own clouds are — 16 samples
// crowding near the camera, the same light — between its base and top above the sea, its cover from
// wxLayerA (scattered cumulus, a broken or an overcast deck), shaped in height by a 3D noise drifting
// with the wind (flat bases, domed tops; a deck's top heaving), its optical thickness its own (a storm's
// tower ~150: a dark base); the sunlight dimmed by the layers over it too, the blue sky's light on its
// tops spread through it (a deck's base grey, not the sun's own warm tint). Out to 480 km: the weather's
// reach round the camera.
// A weather layer's density at p (its axes, radii): its extinction [1/m] (x) and its height in the layer (y); cheap: the cover
// and one octave of its shape — the light march's (Nubis: the light's samples without the fine detail the eye resolves)
fn wxDensity(p: vec3f, i: u32, cheap: bool) -> vec2f {
  let L = P.wx[1u + i];
  let hb = L.x / EARTH_RM;
  let ht = L.y / EARTH_RM;
  let r = length(p);
  let q = p / r;
  let hn = (r - 1.0 - hb) / (ht - hb);
  if (hn <= 0.0 || hn >= 1.0) { return vec2f(0.0, hn); }
  let w = wxNear(q);
  if (w <= 0.0) { return vec2f(0.0, hn); }
  let s = wxShape(q, i, hn, w, cheap);
  return vec2f(s.x * L.w / ((ht - hb) * EARTH_RM * max(s.y, 0.3)), hn);
}
// A weather layer's clouds at q (unit), its height in it hn (0 base … 1 top), its weight there w (wxNear): their density (x,
// 0…1), the height their tops reach (y) and their cover (z) — N4, the types, told from the layer's own shape (no type is
// given: a thin whole deck is a stratus, a thick one a nimbostratus, kilometres deep a cumulonimbus, the rest cumulus):
// - cumulus: a flat base, domes rising with the cover and the noise, their edges eroded by billows — cauliflowers;
// - stratus, stratocumulus, nimbostratus: a slab, its base ragged, its top heaving gently;
// - cumulonimbus: towers on cells of ~9 km (the cover setting how many), to ~0.85 of the layer, their tops rounded; the
//   anvil spread at the top — wider, flat, drawn downwind by the shear —; the rain shield low round and under them.
// Their shapes evolve slowly (the noise drifting upward: a noise cell a quarter of an hour), the weather's drift carrying them.
fn wxShape(q: vec3f, i: u32, hn: f32, w: f32, cheap: bool) -> vec3f {
  let L = P.wx[1u + i];
  let thick = L.y - L.x;
  let cb = smoothstep(4500.0, 7000.0, thick);
  let st = (1.0 - cb) * smoothstep(0.75, 0.95, L.z);
  let cu = max(1.0 - cb - st, 0.0);
  let tev = P.time.x * P.near5.w / 900.0;
  // (first what may be here — the coarse cover, the storm's cells at this height —: empty, out before the fine noise; most
  // of a stormy sky's samples are between its towers, most of a light march's too)
  var aC = 0.0;
  if (cu + st > 0.0) { aC = wxLayerA(q, i) * w; }
  var cell = 0.0;
  var tower = 0.0;
  var shieldM = 0.0;
  var anvil = 0.0;
  let cellAt = vec3f(f32(i) * 3.7, 1.3, 0.05 * tev);
  if (cb > 0.0) {
    if (hn < 0.92) {
      let c0 = wxAt(q, 9000.0) + cellAt;
      cell = 0.5 + 0.5 * (0.7 * dnoise(c0) + 0.3 * dnoise(c0 * 2.3 + vec3f(4.1)));
      // (a stormy sky's towers a quarter of it at most — gaps between them, their sides seen —, fewer as the cover falls)
      tower = smoothstep(0.62 + 0.2 * (1.0 - L.z), 0.7 + 0.2 * (1.0 - L.z), cell) * w;
      if (hn < 0.4) { shieldM = smoothstep(0.45, 0.6, cell) * w; }
    }
    if (hn > 0.72) {
      // (the anvil: the cells' field drawn downwind with the height — the shear: the weather's drift's way —, wider)
      let dl = length(P.wx[4].yzw);
      let dw = select(vec3f(0.0), P.wx[4].yzw / max(dl, 1e-3), dl > 1.0);
      let ca = (q * EARTH_RM - P.wx[4].yzw - dw * (hn * hn * 15000.0)) * (1.0 / 9000.0) + cellAt;
      let cellA = 0.5 + 0.5 * (0.7 * dnoise(ca) + 0.3 * dnoise(ca * 2.3 + vec3f(4.1)));
      anvil = smoothstep(0.52 + 0.15 * (1.0 - L.z), 0.62 + 0.15 * (1.0 - L.z), cellA) * w;
    }
  }
  if ((cu + st) * aC <= 0.01 && cb * max(max(tower, anvil), shieldM) <= 0.0 && (TUNE_GSKIP & 8388608u) == 0u) { return vec3f(0.0, 1.0, 0.0); }
  let x = wxAt(q, 1600.0) + vec3f(f32(i) * 11.3, f32(i) * 5.9, 0.0) + vec3f(0.0, 0.0, hn * 1.5 + 0.25 * tev);
  // (the shape: the coarse gradient noise, and — the eye's samples, not the light march's — the Perlin–Worley's domes
  // twice finer in place of two more octaves: the cauliflower's lobes; TUNE_SC_SKIP 64: the old octaves)
  var sh = 0.6 * dnoise(x);
  if (!cheap) {
    if ((TUNE_SC_SKIP & 64u) == 0u) { sh += 0.55 * (2.0 * cloudNoise(x * 2.0 + vec3f(5.1)).g - 1.0); }
    else { sh += 0.3 * dnoise(x * 2.0 + vec3f(5.1)) + 0.1 * dnoise(x * 4.0 + vec3f(1.7)); }
  }
  var rho = 0.0;
  var top = 1.0;
  var a = 0.0;
  if (cu + st > 0.0 && aC > 0.01) {
    // (each cloud its own growth — a noise of 6.4 km cells: humilis low and flat beside congestus towering near the layer's
    // top, not all cut at it —, its base wavering by a few % of the layer over kilometres: no ruled ceiling)
    let gC = cloudNoise(wxAt(q, 6400.0) + vec3f(f32(i) * 2.9, 0.7, 0.02 * tev));
    let dev = clamp(0.5 + 0.8 * gC.r, 0.0, 1.0);
    let hb0 = 0.07 * gC.b;
    let topC = clamp((0.45 + 0.5 * dev + 0.3 * sh) * (0.75 + 0.25 * aC), 0.25, 0.97);
    // (the top rounded by a threshold rising with the height, not a fade: only the shape noise's peaks reach it — lumpy domes,
    // not the cut of a plane)
    let u = (hn - hb0) / max(topC - hb0, 0.05);
    let rC = select(0.0, 1.0, u < 1.0) * smoothstep(0.0, 0.04 + 0.1 * max(sh, 0.0), u)
      * clamp(1.4 * (aC * (0.7 + 0.6 * sh) - 0.15 - 0.75 * smoothstep(0.35, 1.0, u)), 0.0, 1.0);
    let topS = clamp(0.85 + 0.15 * sh, 0.6, 1.0);
    let hbS = 0.03 + 0.1 * (gC.b - 0.5);
    let hpS = smoothstep(hbS, hbS + 0.12 + 0.15 * abs(sh), hn) * (1.0 - smoothstep(topS - 0.25, topS, hn));
    let rS = hpS * clamp(1.6 * (aC * (0.85 + 0.3 * sh) - 0.1), 0.0, 1.0);
    let k = 1.0 / max(cu + st, 1e-3);
    rho = (cu * rC + st * rS) * k;
    top = (cu * topC + st * topS) * k;
    a = aC;
  }
  if (cb > 0.0) {
    let hT = smoothstep(0.0, 0.03 + 0.05 * abs(sh), hn) * (1.0 - smoothstep(0.8 + 0.08 * sh, 0.92, hn));
    let towerR = hT * clamp(1.5 * (tower * (0.8 + 0.5 * sh) - 0.1), 0.0, 1.0);
    let hA = smoothstep(0.72, 0.82, hn) * (1.0 - smoothstep(0.94, 0.99, hn));
    let anvR = 0.7 * hA * clamp(1.4 * (anvil * (0.75 + 0.4 * sh) - 0.15), 0.0, 1.0);
    let hS = smoothstep(0.0, 0.08, hn) * (1.0 - smoothstep(0.15, 0.3 + 0.08 * sh, hn));
    let shield = hS * clamp(L.z * (0.55 + 0.4 * sh), 0.0, 1.0) * shieldM;
    rho = mix(rho, max(max(towerR, anvR), shield), cb);
    top = mix(top, 1.0, cb);
    a = mix(a, max(tower, max(0.6 * anvil, shield)), cb);
  }
  // (a layer above ~7 km: ice — cirrostratus, a storm's spread anvil beyond its own —, a thin veil, not a deck)
  rho *= 1.0 - 0.65 * smoothstep(6500.0, 8000.0, L.x);
  // (the billows: the edges eaten by a finer ridged noise — thin parts the most, the cores kept)
  // (the Worley detail — Nubis's erosion —: the thin edges eaten into wisps and curls, the dense cores kept; finer near the
  // top — billows —, wispier under the base)
  if (!cheap && rho > 0.0) {
    if ((TUNE_SC_SKIP & 64u) == 0u) {
      let dn = cloudNoise(x * 4.0 + vec3f(2.3, 7.1, 0.5 * tev));
      let det = mix(dn.b, dn.a, smoothstep(0.2, 0.8, hn));
      rho = clamp((rho - (1.0 - det) * 0.35 * (1.0 - rho)) / max(1.0 - (1.0 - det) * 0.35, 0.3), 0.0, 1.0);
    } else {
      let bil = 1.0 - abs(dnoise(x * 3.1 + vec3f(2.3, 7.1, 0.5 * tev)));
      rho = clamp(rho - (1.0 - bil) * 0.3 * (1.0 - rho), 0.0, 1.0);
    }
  }
  return vec3f(rho, top, a);
}
// (the cloud pass — trace.wgsl clouds —: the sunlight marched through the clouds themselves rather than a column of their cover)
var<private> CLOUD_LIGHT_MARCH: bool = false;
// The optical depth towards the Sun from p through layer i's own density: 6 samples, each step twice the last (60 m … 1.9 km,
// ~3.8 km in all — a deck's depth at a low Sun), the cheap density (docs/PLAN-NUAGES-AAA.md N2)
fn wxLightTau(p: vec3f, i: u32, Ls: vec3f, rnd: f32) -> f32 {
  var tau = 0.0;
  var d = 0.0;
  var st = 60.0;
  for (var k = 0u; k < 6u; k++) {
    let x = p + Ls * ((d + st * (0.35 + 0.3 * rnd)) / EARTH_RM);
    tau += wxDensity(x, i, true).x * st;
    d += st;
    st *= 2.0;
  }
  return tau;
}
fn wxCloud(ro: vec3f, rd: vec3f, tHit: f32, i: u32, Ls: vec3f, E: vec3f, jit: f32) -> CloudVol {
  var o: CloudVol;
  o.t = -1.0;
  let L = P.wx[1u + i];
  if (L.z <= 0.0) { return o; }
  let hb = L.x / EARTH_RM;
  let ht = L.y / EARTH_RM;
  let b = dot(ro, rd);
  let off2 = dot(ro, ro) - b * b;
  let hT = (1.0 + ht) * (1.0 + ht) - off2;
  if (hT <= 0.0) { return o; }
  var t0 = max(-b - sqrt(hT), 0.0);
  var t1 = -b + sqrt(hT);
  let hB = (1.0 + hb) * (1.0 + hb) - off2;
  if (hB > 0.0) {
    let b0 = -b - sqrt(hB);
    let b1 = -b + sqrt(hB);
    if (b0 > t0) { t1 = min(t1, b0); } else if (b1 > t0) { t0 = b1; }
  }
  if (tHit > 0.0) { t1 = min(t1, tHit); }
  t1 = min(t1, 480000.0 / EARTH_RM);
  if (t1 <= t0) { return o; }
  let N = 16u;
  let physicalLs = airPhysicalDirection(Ls);
  let stepM = EARTH_RM * airRayScale(rd);
  let ct = dot(airPhysicalDirection(rd), physicalLs);
  let hg = cloudPhase(ct, 1.0);
  let ms1 = cloudPhase(ct, 0.5) * 4.0 * PI;
  let ms2 = cloudPhase(ct, 0.25) * 4.0 * PI;
  let ms3 = cloudPhase(ct, 0.125) * 4.0 * PI;
  // (the sky's light on the layer, the ground's under it, the eclipse's share: once a ray — at the layer's middle where the ray
  // enters it —, not a sample: the sky's harmonics barely change over the kilometres a ray crosses; TUNE_GSKIP 16777216: each
  // sample its own, as before — the A/B)
  let perSample = (TUNE_GSKIP & 16777216u) != 0u;
  let qE = normalize(ro + rd * t0);
  let mu0E = dot(geoQ(qE), physicalLs);
  let skE = skySeen(qE, Ls);
  let skyLayerE = skyFlatFactor(qE, 0.5 * (L.x + L.y), E, mu0E, skE);
  let skyGroundE = skyFlatFactor(qE, 0.0, E, mu0E, skE);
  let nightE = nightFloor(skE, mu0E);
  var Tv = 1.0;
  var col = vec3f(0.0);
  var tPrev = t0;
  for (var j = 0u; j < N; j++) {
    cost(3u);
    let u1 = (f32(j) + 1.0) / f32(N);
    let tn = t0 + (t1 - t0) * u1 * u1;
    let t = mix(tPrev, tn, jit);
    let dm = (tn - tPrev) * stepM;
    tPrev = tn;
    let p = ro + rd * t;
    let r = length(p);
    let q = p / r;
    let w = wxNear(q);
    if (w <= 0.0) { continue; }
    let hn = (r - 1.0 - hb) / (ht - hb);
    // (the layer's clouds by their type — wxShape, N4)
    let shp = wxShape(q, i, hn, w, false);
    let a = shp.z;
    let top = shp.y;
    let rho = shp.x;
    if (rho <= 0.0) { continue; }
    let sigma = rho * L.w / ((ht - hb) * EARTH_RM * max(top, 0.3));
    let mu0 = dot(geoQ(q), physicalLs);
    let hM = (r - 1.0) * EARTH_RM;
    let veil = wxVeil(hM, w, i).y;
    let Ts = sunThrough(airHeight(p), mu0) * sunSeen(p, Ls) * veil;
    let tauUp = a * L.w * max(top - hn, 0.0) / max(top, 0.3);
    // (the cloud pass: the sunlight's optical depth marched through the layer's own density — cores dark, the gaps between
    // cumulus lit, a tower's shadow on its neighbour; else the column of its cover over the point)
    var tauSun = 0.4 * tauUp / max(mu0, 0.12);
    // (and the converging kernel, the reference the realtime image is held to)
    if (CLOUD_LIGHT_MARCH || (QUALITY_PIPELINE && TUNE_CLOUD_LIGHT > 0u)) { tauSun = wxLightTau(p, i, Ls, fract(jit * 13.7 + f32(j) * 0.618)); }
    let beer = select(exp(-tauSun), 0.0, mu0 < -0.1);
    let powder = 1.0 - exp(-2.0 * sigma * 400.0 - 0.15);
    let over = cloudDiffuseT(tauUp);
    var skyL = skyLayerE;
    var skyG = skyGroundE;
    var night = nightE;
    if (perSample) {
      let sk = skySeen(q, Ls);
      skyL = skyFlatFactor(q, hM, E, mu0, sk);
      skyG = skyFlatFactor(q, 0.0, E, mu0, sk);
      night = nightFloor(sk, mu0);
    }
    let amb = max(0.7 * skyL, night * CLOUD_NIGHT_FLOOR);
    let e1 = exp(-0.04 * tauSun);
    let e2 = e1 * e1;
    let ms = (ms1 * e2 * e1 + 0.5 * ms2 * e2 + 0.25 * ms3 * e1) / 1.75 * (0.35 + 0.65 * over);
    // (the sky's light through the layer's depth over the point — a deck's base the grey of what comes through it, not 60 % of
    // the open sky's: the undersides too bright — U7)
    let skyTop = skyL * (0.1 + 0.9 * cloudDiffuseT(0.4 * tauUp));
    // (the light the ground sends up onto the base — the sun's and the sky's on it, an albedo of 0.18; at night the cities'
    // lamps —, through the cloud below)
    let below = cloudDiffuseT(a * L.w * hn / max(top, 0.3));
    let bounce = 0.18 * (sunThrough(0.0, mu0) * max(mu0, 0.0) + skyG) * below;
    let Lin = FLASH_TINT * luminance(E) * 0.25 * flashGlow(p) + E * Ts * (hg * beer * powder * 2.5 + 0.25 * ms * smoothstep(-0.1, 0.1, mu0))
      + 0.85 / PI * (over * (E * amb + E * earthMoonlight(q, q, airHeight(p), mu0)) + E * skyTop * veil + 0.5 * E * bounce
        + below * cityGlowUp(q, E, mu0));
    let dT = exp(-sigma * dm);
    col += Tv * Lin * (1.0 - dT);
    if (o.t < 0.0) { o.t = t; }
    Tv *= dT;
    if (Tv < 0.01) { break; }
  }
  o.alpha = 1.0 - Tv;
  o.cl = col / max(1.0 - Tv, 1e-4);
  return o;
}

// A lightning flash (N5): its light now and its place (the squashed space), 0 none; its light reaching p inside the clouds
// and the rain — spread by their many scatterings over its reach, a few km —, as a share of the Sun's irradiance (a flash
// in a cloud by night as bright as the day's clouds, a blue-white).
const FLASH_TINT = vec3f(0.78, 0.84, 1.0);
fn flashAt() -> vec4f {
  if (!HAS_WX || P.wx[6].w <= 0.0) { return vec4f(0.0); }
  return vec4f(nearCam() + P.wx[6].xyz / EARTH_RM, P.wx[6].w);
}
fn flashGlow(p: vec3f) -> f32 {
  let f = flashAt();
  if (f.w <= 0.0) { return 0.0; }
  let d = length(p - f.xyz) * EARTH_RM;
  return f.w * exp(-d / max(P.wx[7].w, 500.0));
}
// The channel of a flash to the ground, seen along the ray (ro, rd; met at tEnd — < 0: nothing): six segments down from the
// cloud's base to the ground, jagged by the seed (each kink some hundreds of metres aside); a core metres wide, its glow
// tens — the radiance it adds, a share of the Sun's irradiance per steradian.
fn boltRadiance(ro: vec3f, rd: vec3f, tEnd: f32, E: vec3f) -> vec3f {
  let f = flashAt();
  if (f.w <= 0.0 || P.wx[7].y < 0.5) { return vec3f(0.0); }
  let up = normalize(f.xyz);
  let h0 = (length(f.xyz) - 1.0) * EARTH_RM;
  let hg = P.wx[7].x;
  // (under a pole — no east there —: any horizontal axis)
  let ex = cross(vec3f(0.0, 0.0, 1.0), up);
  let east = select(normalize(ex), vec3f(1.0, 0.0, 0.0), dot(ex, ex) < 1e-12);
  let north = cross(up, east);
  let seed = u32(P.wx[7].z);
  var prev = f.xyz;
  var glow = 0.0;
  for (var i = 1u; i <= 6u; i++) {
    let k = f32(i) / 6.0;
    let hr = hash3u(vec3u(seed, i, 7u));
    let jx = (f32(hr & 0xffffu) / 65535.0 - 0.5) * 500.0 * (1.0 - k * 0.5);
    let jy = (f32(hr >> 16u) / 65535.0 - 0.5) * 500.0 * (1.0 - k * 0.5);
    let h = mix(h0, hg, k);
    var pt = up * (1.0 + h / EARTH_RM) + (east * jx + north * jy) / EARTH_RM;
    if (i == 6u) { pt = up * (1.0 + hg / EARTH_RM); }
    // (the closest approach of the ray and the segment prev → pt)
    let u = pt - prev;
    let w0 = ro - prev;
    let a = dot(rd, rd);
    let b = dot(rd, u);
    let c = dot(u, u);
    let d = dot(rd, w0);
    let e = dot(u, w0);
    let den = max(a * c - b * b, 1e-20);
    let sc = clamp((b * e - c * d) / den, 0.0, 1e9);
    let tc = clamp((a * e - b * d) / den, 0.0, 1.0);
    if (tEnd < 0.0 || sc < tEnd) {
      let dist = length(w0 + rd * sc - u * tc) * EARTH_RM;
      glow += exp(-dist * dist / 9.0) + 0.06 * exp(-dist / 40.0);
    }
    prev = pt;
  }
  return FLASH_TINT * luminance(E) * f.w * glow * 25.0;
}
// The rain's drops' light by the angle from the antisolar point (cos of the angle between the ray and the Sun: ct) — the
// rainbows: the primary at 40.6° (violet) – 42.3° (red), its inside brighter; the secondary at 50.3° (red) – 52.6°
// (violet), fainter, its colours reversed; Alexander's dark band between — over the drops' own phase.
fn rainbowPhase(ct: f32) -> vec3f {
  let a = degrees(acos(clamp(-ct, -1.0, 1.0)));
  let g = vec3f(a) - vec3f(42.3, 41.5, 40.6);
  let p1 = exp(-g * g / vec3f(0.3, 0.3, 0.36));
  let g2 = vec3f(a) - vec3f(50.3, 51.2, 52.6);
  let p2 = 0.43 * exp(-g2 * g2 / vec3f(0.64, 0.64, 0.8));
  let inside = 0.25 * (1.0 - smoothstep(38.5, 41.5, a)) * smoothstep(5.0, 30.0, a);
  return (p1 + p2) * 0.16 + vec3f(inside * 0.04);
}

// The rain under the lowest deck (N5): between the ground and that deck's base, where it rains (P.wx[5].y), the falling
// rain as a medium — heavy rain's ~1/km of extinction (a few km of sight), grey —: in shafts under a cumulonimbus's towers
// (the same cells as wxShape's), a nimbostratus's curtain more even; streaked by a finer noise leaning with the wind (the
// drops blown aside as they fall: their streaks slanting downwind); lit by the sun through the clouds — their shadow map —
// and the dim light under the deck. Ten samples, out to 60 km.
fn wxRainShafts(ro: vec3f, rd: vec3f, tHit: f32, Ls: vec3f, E: vec3f, jit: f32) -> CloudVol {
  var o: CloudVol;
  o.t = -1.0;
  let L = P.wx[1];
  if (L.z <= 0.3) { return o; }
  let rain = P.wx[5].y;
  let hg0 = P.wx[4].x;
  let hb = (hg0 - 50.0) / EARTH_RM;
  let ht = L.x / EARTH_RM;
  if (ht <= hb) { return o; }
  let b = dot(ro, rd);
  let off2 = dot(ro, ro) - b * b;
  let hT = (1.0 + ht) * (1.0 + ht) - off2;
  if (hT <= 0.0) { return o; }
  var t0 = max(-b - sqrt(hT), 0.0);
  var t1 = -b + sqrt(hT);
  let hB = (1.0 + hb) * (1.0 + hb) - off2;
  if (hB > 0.0) {
    let b0 = -b - sqrt(hB);
    let b1 = -b + sqrt(hB);
    if (b0 > t0) { t1 = min(t1, b0); } else if (b1 > t0) { t0 = b1; }
  }
  if (tHit > 0.0) { t1 = min(t1, tHit); }
  t1 = min(t1, t0 + 60000.0 / EARTH_RM);
  if (t1 <= t0) { return o; }
  let cb = smoothstep(4500.0, 7000.0, L.y - L.x);
  let tev = P.time.x * P.near5.w / 900.0;
  let dl = length(P.wx[4].yzw);
  let dw = select(vec3f(0.0), P.wx[4].yzw / max(dl, 1e-3), dl > 1.0);
  let physicalLs = airPhysicalDirection(Ls);
  let stepM = EARTH_RM * airRayScale(rd);
  let ct = dot(airPhysicalDirection(rd), physicalLs);
  let N = 10u;
  var Tv = 1.0;
  var col = vec3f(0.0);
  var tPrev = t0;
  for (var j = 0u; j < N; j++) {
    cost(3u);
    let u1 = (f32(j) + 1.0) / f32(N);
    let tn = t0 + (t1 - t0) * u1 * u1;
    let t = mix(tPrev, tn, jit);
    let dm = (tn - tPrev) * stepM;
    tPrev = tn;
    let p = ro + rd * t;
    let r = length(p);
    let q = p / r;
    let hM = (r - 1.0) * EARTH_RM;
    let w = wxNear(q);
    if (w <= 0.0) { continue; }
    // (where it rains: under the towers' cells — wider than their cores —, or a deck's curtain)
    let c0 = wxAt(q, 9000.0) + vec3f(0.0, 1.3, 0.05 * tev);
    let cell = 0.5 + 0.5 * (0.7 * dnoise(c0) + 0.3 * dnoise(c0 * 2.3 + vec3f(4.1)));
    let curtain = 0.55 + 0.45 * dnoise(wxAt(q, 3000.0) + vec3f(7.7, 2.1, 0.1 * tev));
    var mask = mix(curtain, smoothstep(0.56 + 0.2 * (1.0 - L.z), 0.68 + 0.2 * (1.0 - L.z), cell), cb);
    // (debug — TUNE_GSKIP 262144 —: the rain everywhere, all in the sun: its rainbows whole)
    let dbgRain = (TUNE_GSKIP & 262144u) != 0u;
    if (dbgRain) { mask = 0.5; }
    // (the streaks: a fine noise, its places slanting downwind with the fall — 0.3 m aside for each metre down)
    let fall = max(L.x - hM, 0.0);
    let sx = (q * EARTH_RM - P.wx[4].yzw - dw * (0.3 * fall)) * (1.0 / 400.0);
    let streak = clamp(0.55 + 0.6 * dnoise(vec3f(sx.x, sx.y, sx.z) + vec3f(0.0, 0.0, hM / 4000.0)), 0.0, 1.0);
    let sigma = rain * 1.2e-3 * mask * streak * w * smoothstep(L.x, L.x - 300.0, hM);
    if (sigma <= 1e-7) { continue; }
    let mu0 = dot(geoQ(q), physicalLs);
    let csT = cloudShadowAt(p);
    let Ts = sunThrough(airHeight(p), mu0) * select(select(wxVeil(hM, w, 3u).x, csT, csT >= 0.0), 1.0, dbgRain);
    let sk = skySeen(q, Ls);
    let amb = max(0.7 * skyFlatFactor(q, hM, E, mu0, sk), nightFloor(sk, mu0) * CLOUD_NIGHT_FLOOR) * wxVeil(hM, w, 3u).y;
    // (the drops: a forward lobe — the sun's glow through a shaft against it —, half spread; the rainbows where the Sun is
    // behind — rainbowPhase —; a flash's light)
    let ph = vec3f(0.5 * hgPhase(0.7, ct) + 0.5 / (4.0 * PI)) + select(vec3f(0.0), rainbowPhase(ct), (TUNE_GSKIP & 131072u) == 0u);
    let Lin = E * (Ts * ph * 0.9 + 0.75 / PI * amb) + FLASH_TINT * luminance(E) * 0.15 * flashGlow(p);
    let dT = exp(-sigma * dm);
    col += Tv * Lin * (1.0 - dT);
    if (o.t < 0.0) { o.t = t; }
    Tv *= dT;
    if (Tv < 0.01) { break; }
  }
  o.alpha = 1.0 - Tv;
  o.cl = col / max(1.0 - Tv, 1e-4);
  return o;
}

// ---------------------------------------------------------------------------------------------
// The aerial perspective's table (renderer.ts dispatchTrace; Hillaire 2020's froxels): the air between the camera
// and each distance along its rays — for AP_X × AP_Y directions over the image, AP_Z slices from the camera out to
// beyond the air's end (exponentially spaced: metres near, hundreds of kilometres far) —, written before each
// realtime frame near a world with air, the camera within it: the light the air scatters towards the camera
// (rgb; a: its moonlit share's luminance) and what it lets through (rgb). Each column marched once, its slices one
// after the other (earthAir over each, a few samples, from the slice's start: the light of the ones before dimmed by
// them) — stopped at the world's sphere, no air within the ground. The camera's rays near the world (earthNear →
// earthLook) read it at the ground's distance, the cloud's, the air's end — in place of their own 32 samples.
// ---------------------------------------------------------------------------------------------
@group(1) @binding(4) var apInA: texture_3d<f32>;
@group(1) @binding(5) var apInB: texture_3d<f32>;
@group(1) @binding(6) var apSamp: sampler;
@group(1) @binding(7) var apOutA: texture_storage_3d<rgba16float, write>;
@group(1) @binding(8) var apOutB: texture_storage_3d<rgba16float, write>;
const AP_Z = 32u;
// (earthAir's samples when set: a slice's few; 0 its own)
var<private> AP_N: u32 = 0u;
// (the camera's ray's place on the image [uv] while the table stands for its air; < 0: not)
var<private> AP_UV: vec2f = vec2f(-1.0);
// the slices' nearest distance (≈ 3 m of the Earth's radius) and the farthest: past the air's end along any ray
// from the camera that misses the ground — to its horizon, √(r² − 1), then on to the air's top, √(A² − 1) (a tenth more)
const AP_T0 = 5e-7;
fn apFar(ro: vec3f) -> f32 {
  return 1.1 * (sqrt(max(dot(ro, ro) - 1.0, 0.0)) + sqrt(max(airTop() * airTop() - 1.0, 0.0))) + 1e-6;
}
fn apSliceT(z: u32, tFar: f32) -> f32 {
  if (z == 0u) { return 0.0; }
  return AP_T0 * pow(tFar / AP_T0, f32(z - 1u) / f32(AP_Z - 2u));
}
// (a distance's place among the slices — fractional; t ≥ tFar: the last)
fn apSliceZ(t: f32, tFar: f32) -> f32 {
  if (t <= AP_T0) { return max(t, 0.0) / AP_T0; }
  return min(1.0 + log(t / AP_T0) / log(tFar / AP_T0) * f32(AP_Z - 2u), f32(AP_Z - 1u));
}
// the aerial table's light stored × the frame's pre-exposure (P.zamo2.y): within a half float's range at any EV
fn apScale() -> f32 { return select(1.0, P.zamo2.y, P.zamo2.y > 0.0); }
// the air between the camera and t along the ray at AP_UV: its light (o.L, its moonlit share o.Lm) and its
// transmittance (o.T), as earthAir gives them (t = 3e38: the air's end)
fn apRead(t: f32, tFar: f32) -> EarthAir {
  let z = apSliceZ(min(t, tFar), tFar);
  let uvw = vec3f(AP_UV, (z + 0.5) / f32(AP_Z));
  let a = textureSampleLevel(apInA, apSamp, uvw, 0.0);
  let b = textureSampleLevel(apInB, apSamp, uvw, 0.0);
  var o: EarthAir;
  let k = 1.0 / apScale();
  o.L = max(a.rgb, vec3f(0.0)) * k;
  o.Lm = vec3f(max(a.a, 0.0) * k);
  o.T = clamp(b.rgb, vec3f(0.0), vec3f(1.0));
  return o;
}

// the table holds the air to t at AP_UV: none of the four columns read there ends before half of t (its ray met the
// ground nearer — a hill before the far sea, the sea under a sky pixel at the horizon: their light and transmittance
// stop there, the band at a sunset's horizon too dark); a column ending a little nearer — the next one down a slope —
// kept, as the table's filtering is (t = 3e38: the air's end)
fn apCovers(t: f32, tFar: f32) -> bool {
  let dims = vec2i(textureDimensions(apInB).xy);
  let i0 = vec2i(floor(AP_UV * vec2f(dims) - 0.5));
  var e = 1.0;
  for (var j = 0; j < 2; j++) {
    for (var i = 0; i < 2; i++) {
      e = min(e, textureLoad(apInB, vec3i(clamp(i0 + vec2i(i, j), vec2i(0), dims - 1), 0), 0).a);
    }
  }
  return e * tFar >= 0.5 * min(t, tFar);
}

@compute @workgroup_size(8, 8)
fn aerial(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(apOutA);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  // (the column's ray: the image's at its centre, as trace and earthNear set it)
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims.xy);
  let ndc = vec2f(2.0 * uv.x - 1.0, 1.0 - 2.0 * uv.y);
  let look = normalize(P.camFwd.xyz + ndc.x * P.cam.w * P.camRight.w * P.camRight.xyz + ndc.y * P.cam.w * P.camUp.xyz);
  let k = u32(P.near1.w);
  setAir(k);
  let ab = squashOf(k);
  let ro = nearCam();
  let rd = normalize(squashed(toBody(look), ab));
  WX_W = select(0.0, P.wx[0].x, HAS_WX && isEarth(k) && earthOn());
  WX_Q = normalize(ro);
  let lt = nearLight(k);
  let Ls = normalize(squashed(toBody(lt.dir), ab));
  let tFar = apFar(ro);
  // (no air within the ground: the column ends at the world's sphere)
  let tg = unitHit(ro, rd);
  let tEnd = select(tFar, min(tg, tFar), tg > 0.0);
  var T = vec3f(1.0);
  var L = vec3f(0.0);
  var Lm = 0.0;
  var tPrev = 0.0;
  textureStore(apOutA, vec3u(gid.xy, 0u), vec4f(0.0));
  // (slice 0's alpha: where the column ends, over the table's reach — 1 the air's end; less, its ray met the ground:
  // apCovers)
  textureStore(apOutB, vec3u(gid.xy, 0u), vec4f(1.0, 1.0, 1.0, tEnd / tFar));
  AP_N = 3u;
  for (var z = 1u; z < AP_Z; z++) {
    let t = min(apSliceT(z, tFar), tEnd);
    if (t > tPrev) {
      let e = earthAir(ro + rd * tPrev, rd, t - tPrev, Ls, lt.e, 0.5, 3e38);
      L += T * e.L;
      Lm += luminance(T * e.Lm);
      T *= e.T;
      tPrev = t;
    }
    textureStore(apOutA, vec3u(gid.xy, z), vec4f(L, Lm) * apScale());
    textureStore(apOutB, vec3u(gid.xy, z), vec4f(T, 0.0));
  }
  AP_N = 0u;
}

// The clouds along a camera ray before tHit (the volume's — the map's —, the weather's layers, the cirrus): their cover, their
// light (premultiplied by nothing: their own radiance) and the distance of the nearest; earthLook's, or the cloud pass's
// (the kernel clouds: once a texel of half the image's size, read back by the pixels — docs/PLAN-NUAGES-AAA.md N1)
struct EarthClouds { alpha: f32, cl: vec3f, tc: f32 };
// (the clouds of this pixel already found by the cloud pass — alpha ≥ 0 —: earthLook takes them instead of marching)
var<private> CLOUDS_BUFFERED: EarthClouds = EarthClouds(-1.0, vec3f(0.0), -1.0);
fn earthClouds(k: u32, ro: vec3f, rd: vec3f, tHit: f32, Ls: vec3f, E: vec3f, gx: vec3f, gy: vec3f, fp0: f32, fpK: f32, jit: f32, volume: bool) -> EarthClouds {
  let earth = isEarth(k) && earthOn();
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
  // the weather's layers round the camera (their order along the ray: one way or the other, the lowest
  // first — up from below them, down from above)
  if (HAS_WX && volume && earth && WX_W > 0.0) {
    for (var i = 0u; i < 3u; i++) {
      let lv = wxCloud(ro, rd, tHit, i, Ls, E, jit);
      if (lv.alpha <= 0.0) { continue; }
      if (alpha <= 0.0 || lv.t < tc) {
        cl = (lv.alpha * lv.cl + (1.0 - lv.alpha) * alpha * cl) / max(lv.alpha + (1.0 - lv.alpha) * alpha, 1e-5);
        alpha = lv.alpha + (1.0 - lv.alpha) * alpha;
        tc = lv.t;
      } else {
        cl = (alpha * cl + (1.0 - alpha) * lv.alpha * lv.cl) / max(alpha + (1.0 - alpha) * lv.alpha, 1e-5);
        alpha = alpha + (1.0 - alpha) * lv.alpha;
      }
    }
  }
  // (N5: the rain falling from the lowest deck — its shafts, merged as one more layer)
  if (HAS_WX && volume && earth && WX_W > 0.0 && P.wx[5].y > 0.02 && (TUNE_GSKIP & 65536u) == 0u) {
    let lv = wxRainShafts(ro, rd, tHit, Ls, E, jit);
    if (lv.alpha > 0.0) {
      if (alpha <= 0.0 || lv.t < tc) {
        cl = (lv.alpha * lv.cl + (1.0 - lv.alpha) * alpha * cl) / max(lv.alpha + (1.0 - lv.alpha) * alpha, 1e-5);
        alpha = lv.alpha + (1.0 - lv.alpha) * alpha;
        tc = lv.t;
      } else {
        cl = (alpha * cl + (1.0 - alpha) * lv.alpha * lv.cl) / max(alpha + (1.0 - alpha) * lv.alpha, 1e-5);
        alpha = alpha + (1.0 - alpha) * lv.alpha;
      }
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
        let alt = airHeight(ro);
        let ai = cirrusCover(geoQ(qi), (fp0 + fpK * ti) * EARTH_RM) * mix(1.0, 0.35, smoothstep(20000.0, 100000.0, alt));
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
  return EarthClouds(alpha, cl, tc);
}

// earthLook's sky — the clouds before the ground and the air to it —, its ground, and the two composed: split so that a
// ray that never meets the ground (keyLight's, towards the Sun) does not carry the ground's code — every call is a copy of
// all it calls on D3D12 (docs/PLAN-LEAN-TRACER-KERNELS.md P5)
struct EarthLookSky { air: EarthAir, alpha: f32, cl: vec3f, tc: f32, earth: bool };
fn earthLookSky(k: u32, ro: vec3f, rd: vec3f, tHit: f32, Ls: vec3f, E: vec3f, gx: vec3f, gy: vec3f, fp0: f32, fpK: f32, jit: f32, volume: bool) -> EarthLookSky {
  let earth = isEarth(k) && earthOn();
  var cs: EarthClouds;
  // (the cloud pass's, unless its clouds begin beyond this ray's ground — a ray's pixel the raster does not bound, its
  // texel marched to the sky's end: the clouds behind a far ridge then marched here, before it)
  let buffered = CLOUDS_BUFFERED.alpha >= 0.0 && !(tHit > 0.0 && CLOUDS_BUFFERED.alpha > 0.0 && CLOUDS_BUFFERED.tc > tHit);
  if (buffered) { cs = CLOUDS_BUFFERED; } else { cs = earthClouds(k, ro, rd, tHit, Ls, E, gx, gy, fp0, fpK, jit, volume); }
  let alpha = cs.alpha;
  let cl = cs.cl;
  let tc = cs.tc;
  // the air: to the ground (or out), and to the cloud — seen through the air before it only
  // (the camera's ray, the aerial perspective's table there: read at the ground's distance and the cloud's)
  var air: EarthAir;
  var useAp = AP_UV.x >= 0.0 && dot(ro, ro) < airTop() * airTop();
  var tFar = 0.0;
  if (useAp) {
    tFar = apFar(ro);
    useAp = apCovers(select(3e38, tHit, tHit > 0.0), tFar) && (alpha <= 0.0 || apCovers(tc, tFar));
  }
  if (useAp) {
    air = apRead(select(3e38, tHit, tHit > 0.0), tFar);
    air.Tc = vec3f(1.0);
    air.Lc = vec3f(0.0);
    if (alpha > 0.0) {
      let c = apRead(tc, tFar);
      air.Tc = c.T;
      air.Lc = c.L;
    }
  } else {
    air = earthAir(ro, rd, select(3e38, tHit, tHit > 0.0), Ls, E, jit, select(3e38, tc, alpha > 0.0));
  }
  return EarthLookSky(air, alpha, cl, tc, earth);
}
// The clouds' transmittance for the direct light of what lies beyond them — the Sun's disc, the Moon's, the planets, the stars —
// from their cover: (1 − α)³, the optical depth tripled. A disc is ~10⁵ times brighter than the cloud before it: the cover's
// own 1 − α — the march stopped at 1 %, a cumulus's τ of 5–10, the half-size pass's blending at its edges — let it shine
// through a cloud that looks opaque (its glow, faint, was hidden). A thin veil still shows a watery Sun.
fn cloudsDirectT(alpha: f32) -> f32 {
  let t = clamp(1.0 - alpha, 0.0, 1.0);
  return t * t * t;
}
fn earthLookCompose(ro: vec3f, rd: vec3f, tHit: f32, E: vec3f, jit: f32, s: EarthLookSky, G: vec3f) -> EarthLook {
  var o: EarthLook;
  let air = s.air;
  let alpha = s.alpha;
  o.Lm = air.Lm;
  o.col = (1.0 - alpha) * (air.L + air.T * G) + alpha * (air.Lc + air.Tc * s.cl);
  // (a flash's channel to the ground — N5 —, dimmed by the clouds before it)
  if (HAS_WX && s.earth && P.wx[6].w > 0.0) { o.col += boltRadiance(ro, rd, tHit, E) * air.T * (1.0 - 0.7 * alpha); }
  // the auroras (S2): above the air and the clouds — from under them, hidden by a cloud; from above, before it
  if (HAS_AURORA && s.earth && P.bary.z > 0.0) {
    let aur = auroraLight(ro, rd, select(3e38, tHit, tHit > 0.0), jit);
    o.col += aur * air.T * select(1.0 - alpha, 1.0, airHeight(ro) > 120e3);
  }
  o.T = select(cloudsDirectT(alpha) * air.T, vec3f(0.0), tHit > 0.0);
  return o;
}
fn earthLook(k: u32, ro: vec3f, rd: vec3f, tHit: f32, Ls: vec3f, E: vec3f, gx: vec3f, gy: vec3f, fp0: f32, fpK: f32, jit: f32, volume: bool) -> EarthLook {
  let s = earthLookSky(k, ro, rd, tHit, Ls, E, gx, gy, fp0, fpK, jit, volume);
  var G = vec3f(0.0);
  if (!DISC_ONLY && tHit > 0.0) {
    let ph = ro + rd * tHit;
    let q = normalize(ph);
    let fp = fp0 + fpK * tHit;
    // (WS.w: a windsock, an airport's building — HAS_RWY — or a tree, a building of the world's scenery —
    // HAS_SCENERY — met: without either, windsockShade and all it calls compile out — R-H3)
    if ((HAS_RWY || HAS_SCENERY) && WS.w > 0.5) {
      G = windsockShade(q, Ls, E, max(airHeight(ph) - geoidN(geoQ(q)), 0.0), airPhysicalDirection(rd));
    } else if (s.earth) {
      // (the height above the sea: the sea's surface at the geoid)
      G = earthGround(q, rd, Ls, E, earthFoot(q, rd, gx, fp), earthFoot(q, rd, gy, fp), max(airHeight(ph) - geoidN(geoQ(q)), 0.0));
    } else {
      G = otherGround(k, airPhysicalNormal(q), airPhysicalDirection(rd), airPhysicalDirection(Ls), E, fp);
    }
  }
  return earthLookCompose(ro, rd, tHit, E, jit, s, G);
}
// earthLook for a world with air away from the camera (ourSegment): the Earth's own ground there only when the Earth is not
// the body near the camera — that one is earthNear's, and ourSegment never meets it (bodyWhere 3): an Earth flight's
// kernels then carry no further copy of the Earth's ground (NEAR_KIND, P9)
fn earthLookFar(k: u32, ro: vec3f, rd: vec3f, tHit: f32, Ls: vec3f, E: vec3f, gx: vec3f, gy: vec3f, fp0: f32, fpK: f32, jit: f32, volume: bool) -> EarthLook {
  let s = earthLookSky(k, ro, rd, tHit, Ls, E, gx, gy, fp0, fpK, jit, volume);
  var G = vec3f(0.0);
  if (!DISC_ONLY && tHit > 0.0) {
    let ph = ro + rd * tHit;
    let q = normalize(ph);
    let fp = fp0 + fpK * tHit;
    if ((HAS_RWY || HAS_SCENERY) && WS.w > 0.5) {
      G = windsockShade(q, Ls, E, max(airHeight(ph) - geoidN(geoQ(q)), 0.0), airPhysicalDirection(rd));
    } else if (NEAR_KIND != 1u && s.earth) {
      G = earthGround(q, rd, Ls, E, earthFoot(q, rd, gx, fp), earthFoot(q, rd, gy, fp), max(airHeight(ph) - geoidN(geoQ(q)), 0.0));
    } else {
      G = otherGround(k, airPhysicalNormal(q), airPhysicalDirection(rd), airPhysicalDirection(Ls), E, fp);
    }
  }
  return earthLookCompose(ro, rd, tHit, E, jit, s, G);
}
// (a ray that never meets the ground: the sky's part alone)
fn earthLookNoGround(k: u32, ro: vec3f, rd: vec3f, Ls: vec3f, E: vec3f, gx: vec3f, gy: vec3f, fp0: f32, fpK: f32, jit: f32, volume: bool) -> EarthLook {
  return earthLookCompose(ro, rd, -1.0, E, jit, earthLookSky(k, ro, rd, -1.0, Ls, E, gx, gy, fp0, fpK, jit, volume), vec3f(0.0));
}

// The air's refraction (PLAN-CIEL C3): a ray from the camera that leaves the Earth's air comes out bent
// towards the ground — what it meets beyond (the Sun, the Moon, the stars) lies lower than it looks. The
// bending through an exponential air of refractivity N = N₀ e^(−h/H) (H, the density's scale height:
// 8.4 km) is ∫ (N/H) sin ψ ds — the air's column along the ray (Chapman's grazing function, Schüler's
// form) times N/H and the sine of its angle to the vertical (near 1 at a grazing ray's lowest point,
// where its column lies): from the sea 35′ at the horizon (Bennett's 34.5′), 1′ at 45°, none at the
// zenith; a ray grazing the air from above, twice the horizon's at its lowest point (seen from orbit, the
// setting Sun squashed). The CPU's constants for the camera's height (refraction.ts): P.sky = (N₀, N at
// the camera, the Earth's radius and the camera's distance from its centre in scale heights). The
// direction beyond: the look turned down by it in its vertical plane.
// (the bending of the ray traced now — green light's —, for the Sun's disc in each colour: PLAN-CIEL C4)
var<private> REFR_DELTA: f32 = 0.0;
fn airBend(look: vec3f) -> vec3f {
  let up = normalize(nearCam());
  let rd = toBody(look);
  let mu = dot(rd, up);
  let w = up - mu * rd;
  let wl = length(w);
  let c = sqrt(1.5707963 * P.sky.w);
  var delta = P.sky.y * wl * c / ((c - 1.0) * mu + 1.0);
  if (mu < 0.0) {
    // (below the camera's horizon, not meeting the ground: the whole chord through its lowest point, less
    // the part behind the camera)
    let x0 = P.sky.w * wl;
    delta = 2.0 * P.sky.x * sqrt(1.5707963 * x0) * exp(min(P.sky.z - x0, 0.0)) - P.sky.y * c / ((c - 1.0) * -mu + 1.0);
  }
  delta = clamp(delta, 0.0, 0.03);
  REFR_DELTA = delta;
  return fromBody(rd * cos(delta) - w * (sin(delta) / max(wl, 1e-6)));
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
  // (the discs' kernel: no ground marched — DISC_ONLY)
  if (!DISC_ONLY && nearEarth(k) && earthOn() && length(ro) < 1.5) {
    t = -3.0;
    // (the raster patch's distance, the ground there found by two reads and a refinement instead of a march)
    if (HAS_TERRAIN_RASTER && RHINT > 0.0 && P.walk[0].w < 0.5) {
      t = earthMarchHinted(ro, rd, pixFoot(), RHINT, length(vec3f(rd.xy, rd.z / ab)) * EARTH_RM);
    }
    if (t < -2.5) { HINT_PATH = 3u; t = earthMarch(ro, rd, pixFoot()); }
  }
  // (the windsocks beside the runways near: before the ground, they are what the ray meets)
  WS = vec4f(0.0);
  WS_S = 0.0;
  WS_AO = 1.0;
  if (!DISC_ONLY && HAS_RWY && nearEarth(k) && rwyCount() > 0u) {
    let dp = vec3f(rd.xy, rd.z / ab);
    let kM = length(dp) * EARTH_RM;
    let tw = windsocks(dp / length(dp), select(1e7, t * kM, t > 0.0));
    if (WS.w > 0.5) { t = tw / kM; }
    // (and the airport's buildings and parked craft — A3)
    let ws = WS;
    let wa = WS_A;
    let tm = airportScenery(dp / length(dp), select(1e7, t * kM, t > 0.0));
    if (WS.w > 0.5) { t = tm / kM; } else { WS = ws; WS_A = wa; }
  }
  if (NEAR_DETAIL && !DISC_ONLY && nearEarth(k)) { let dp = vec3f(rd.xy, rd.z / ab); let kM = length(dp) * EARTH_RM; let tm = worldScenery(dp / length(dp), select(1e7, t * kM, t > 0.0),rnd); if (tm < select(1e7, t * kM, t > 0.0)) { t = tm / kM; } }
  if (HAS_RWY) { RWY_HIT = vec4f(vec3f(rd.xy, rd.z / ab) * (t * EARTH_RM), select(0.0, 1.0, nearEarth(k) && t > 0.0 && rwyCount() > 0u && WS.w < 0.5)); }
  let lt = nearLight(k);
  // (another world with air whose heights are measured — Mars, PLAN-PLANETES-AAA P7 —: its relief marched as the airless
  // worlds' is — nearMarch —, not the sphere; its shadows, its finer normal — the tiles', its craters' — and the tiles'
  // imagery handed to otherGround)
  // (renderer.liteSkip: 4 its shadows off, 8 the sphere again, 16 the march's hit shaded plainly — the A/B of their costs)
  // (and Titan's, procedural — titanRelief, P8 —: its normal the relief's own, its shadows left out — under its haze the Sun's
  // beam is a few per cent of its light, the sky's the rest)
  let nsurf = u32(bodies[BV * k + 2u].z);
  let titan = titanKernel() && nsurf == TITAN_SURF;
  // (Titan from over 150 km: its relief and its seas under the haze's τ ≈ 4 unseen — the sphere, not 120 km of march a pixel)
  let titanHigh = titan && (length(ro) - 1.0) * P.near4.w > 1.5e5;
  if (nearAirWorld() && !DISC_ONLY && !isEarth(k) && (titan || (marsLike() && hasDem(nsurf))) && !titanHigh && (liteSkip() & 8u) == 0u) {
    var nh: NearHit;
    if (NEAR_T > 0.0) {
      nh.t = NEAR_T;
      nh.qb = normalize(nearCam() + toBody(look) * NEAR_T);
      nh.h = relief(u32(bodies[BV * k + 2u].z), nh.qb, reliefFoot(NEAR_T), P.near4.w, P.time.x * P.near5.w);
    } else {
      MARCH_LEAST = 0.05;
      MARCH_REACH = 1.2e5;
      MARCH_FOOT = 4.0;
      MARCH_BISECT = 6u;
      MARCH_T0 = select(0.0, 0.5 * P.tileL[17].x / P.near4.w, rasterPrimary() && P.tileL[17].x > 0.0);
      nh = nearMarch(look);
      // (a ray past the march's reach that meets the sphere: the ground there drawn smooth, not gone — the haze hides its relief)
      if (nh.t <= 0.0) {
        let tsph = unitHit(ro, rd);
        if (tsph > 0.0) {
          nh.t = tsph;
          nh.qb = normalize(ro + rd * tsph);
          nh.h = 0.0;
        }
      }
      MARCH_T0 = 0.0;
      MARCH_LEAST = 0.02;
      MARCH_REACH = 3e38;
      MARCH_FOOT = 1.0;
      MARCH_BISECT = 10u;
    }
    t = nh.t;
    // (Titan's seas: their surface — the sphere, their level — met before their bed: the liquid, not the ground)
    if (titan) {
      // (the shore the map's zero line — smooth —, not where the ground's cells cross the sea's level: a ground point the map
      // puts in the sea is under it)
      let ts = unitHit(ro, rd);
      if (ts > 0.0 && (nh.t <= 0.0 || ts < nh.t || titanSea(nh.qb) > 0.0)) {
        let qs = normalize(ro + rd * ts);
        if (titanSea(qs) > 0.0) {
          t = ts;
          nh.t = -1.0;
          TITAN_WET = 1.0;
          if (P.seafft[0].x > 0.5 && P.sea[1].w > 0.0) {
            // (its waves by FFT — the sea's spectrum at its gravity, renderer seaFftParams: Pierson–Moskowitz's, centimetres —,
            // their slopes the pixel does not resolve widening the Sun's glint)
            SEA_D = toBody(look) * (ts * P.near4.w);
            let sw = seaWavesFft(qs, P.sea[0].xyz, P.sea[1].xyz, reliefFoot(ts));
            HD_N = normalize(sw.n);
            TITAN_WET = 1.0 + clamp(sqrt(sw.vu + sw.vc + P.seafft[2].x + P.seafft[2].y), 0.002, 0.3);
          } else {
            let g = titanRipples(toBody(look * ts) * P.near4.w + P.fine1.xyz, reliefFoot(ts), P.time.x * P.near5.w);
            HD_N = normalize(qs + g - qs * dot(g, qs));
          }
          HD_N_ON = true;
        }
      }
    }
    if (nh.t > 0.0 && (liteSkip() & 16u) == 0u) {
      let surf = u32(bodies[BV * k + 2u].z);
      let foot = reliefFoot(nh.t);
      let mR = P.near4.w;
      if (titan) {
        HD_N = toBody(reliefNormal(surf, nh.qb, nh.t, P.time.x * P.near5.w, 0.0));
      } else if (NEAR_KIND != 5u) {
        // (the craters' slope where the relief has them — Mars's; Venus's measured heights alone)
        var gc = vec3f(0.0);
        if (cratered(surf)) {
          _ = craterRelief(surf - 4u, nh.qb, foot, mR);
          gc = CRATER_GRAD - nh.qb * dot(CRATER_GRAD, nh.qb);
        }
        HD_N = normalize(moonNormal(nh.qb, foot) - gc);
      }
      HD_N_ON = true;
      // (Titan's and Venus's: their radar's — no visible albedo, a texture of dunes, channels, lava flows: two thirds of it)
      let md = moonDetail(nh.qb, foot);
      ALB_TINT = select(md, mix(vec3f(1.0), md, 0.65), titan || surf == 10u);
      // (the finest ground, near — fineGround, the airless worlds' —: its slope by differences, its stones lighter)
      if (P.fine0.w > 0.5 && P.fine0.w < 1.5 && foot < 8.0) {
        let x = toBody(look * nh.t) * mR + P.fine1.xyz;
        let a1 = normalize(cross(nh.qb, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(nh.qb.z) > 0.9)));
        let a2 = cross(nh.qb, a1);
        let ef = max(foot, 0.03);
        let h0 = fineGround(x, foot);
        let g = ((fineGround(x + a1 * ef, foot) - h0) * a1 + (fineGround(x + a2 * ef, foot) - h0) * a2) / ef;
        HD_N = normalize(HD_N - g * smoothstep(8.0, 2.0, foot));
        // (Titan's pebbles water ice on its dark sand — Huygens's: far lighter)
        ALB_TINT *= 1.0 + clamp(h0 * select(0.25, 1.2, titan), -0.15, select(0.2, 0.9, titan));
      }
      // (the relief's shadows within 25 km — fading from 15: farther, the dust blurs them, and their march was a fifth of the
      // frame at sunset)
      let dKm = nh.t * mR * 1e-3;
      if ((liteSkip() & 4u) == 0u && dKm < 25.0 && !titan) {
        REL_SH = mix(nearShadow(surf, nh.qb, nh.h, toBody(lt.dir), foot, P.time.x * P.near5.w), 1.0, smoothstep(15.0, 25.0, dKm));
      }
    }
  }
  // (the sea's waves in relief near a low camera — over the sea only: its mean level met, h ≈ 0)
  if (NEAR_DETAIL && !DISC_ONLY && nearEarth(k) && t > 0.0 && P.seafft[0].x > 0.5 && P.sea[1].w > 0.0 && WS.w < 0.5 && earthOn()) {
    let ps = ro + rd * t;
    if (abs(airHeight(ps) - geoidN(geoQ(normalize(ps)))) < 3.0) { t = seaSurfaceHit(look, t, m); }
  }
  SEA_ON = nearEarth(k) && t > 0.0 && P.sea[1].w > 0.0 && WS.w < 0.5;
  SEA_D = toBody(look) * (t / m * P.near4.w);
  WX_W = select(0.0, P.wx[0].x, HAS_WX && nearEarth(k) && earthOn());
  WX_Q = normalize(ro);
  EARTH_SHADOW_POINT=look*(max(t,0.0)/m*P.near4.w);
  EARTH_SHADOW_ON = true;
  SHADOW_REL = toBody(look) * (max(t, 0.0) / m * P.near4.w);
  SHADOW_REL_ON = RASTER_SHADE && t > 0.0;
  let e = earthLook(k, ro, rd, t, normalize(squashed(toBody(lt.dir), ab)), lt.e, squashed(toBody(P.camRight.xyz), ab), squashed(toBody(P.camUp.xyz), ab),
    0.0, pixFoot(), fract(rnd * 7.31 + 0.37), P.earth4.w > 0.5);
  EARTH_SHADOW_ON = false;
  SHADOW_REL_ON = false;
  HD_N_ON = false;
  ALB_TINT = vec3f(1.0);
  REL_SH = 1.0;
  TITAN_WET = 0.0;
  // (the cloud pass's clouds are this camera ray's alone: a reflection's or a probe's march their own)
  CLOUDS_BUFFERED.alpha = -1.0;
  AP_UV = vec2f(-1.0);
  SEA_ON = false;
  WX_W = 0.0;
  WS = vec4f(0.0);
  // the stars behind the sunlit sky: drawn far brighter than they are (the sky's scenes need them), they
  // would shine through a blue sky — faded as the sky's glow here outshines them: gone while it is a
  // hundredth of a white ground in the sun or more (day, sunset), all out below a ten-thousandth (night)
  // (the moonlit share's luminance taken off, not its colour: the aerial table keeps it as a grey luminance — a grey
  // off a blue sky left its blue, and veiled a moonlit night's stars; the same for a ray's own air, linear)
  let s = max(luminance(e.col) - luminance(e.Lm), 0.0) / max(luminance(lt.e) / PI, 1e-30);
  let veil = clamp(log(1e-2 / max(s, 1e-12)) / log(100.0), 0.0, 1.0);
  // (the airport's rotating beacon — A3 —: faint by day, a sweeping flash by night)
  var col = e.col;
  if (HAS_RWY && any(BEACON > vec3f(0.0))) {
    let mz = dot(geoQ(normalize(ro)), airPhysicalDirection(normalize(squashed(toBody(lt.dir), ab))));
    col += BEACON * (luminance(lt.e) / PI) * mix(0.3, 300.0, 1.0 - smoothstep(-0.12, 0.06, mz));
    BEACON = vec3f(0.0);
  }
  return EarthNear(col, e.T, select(t, t / m, t > 0.0), veil * veil);
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
  // (a straight piece through our bodies: 1 the camera's, up to the Dneg region; 2 the one out of our end of the wormhole.
  // Both met at one call site, in the segments' loop: ourSegment is the kernel's largest function, and on D3D12 every
  // call is a copy — docs/PLAN-LEAN-TRACER-KERNELS.md P9)
  var piece = 0u;
  var pieceO = vec3f(0.0);
  var pieceD = vec3f(0.0);
  var pieceT = 0.0;
  var pieceTr = 0.0;
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
        piece = 1u;
        pieceO = vec3f(0.0);
        pieceD = dH;
        pieceT = tEnter;
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
  }
  for (var segN = 0u; segN < 7u; segN++) {
  if (piece != 0u) {
    var wo: WhOut;
    wo.tint = vec3f(1.0);
    let stop = ourSegment(pieceO, pieceD, pieceT, &wo, 1.0 / eloc, pieceTr, false);
    colW += thr * wo.glow;
    thr *= wo.tint;
    if (piece == 2u) {
      if (stop) { thr = vec3f(0.0); }
      break;
    }
    if (stop) { return traceOut(colW); }
    piece = 0u;
  }
  if (straight || segN == 6u) { break; }
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
          piece = 2u;
          pieceO = exitH;
          pieceD = normalize(skyDir);
          pieceT = 3e38;
          pieceTr = skyOrg.w;
          continue;
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
    cost(11u);
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
    if ((massive || whOn) && (TUNE_SKIP & 1024u) == 0u) {
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
        cost(10u);
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
      for (var k = 0u; k < select(0u, ourStart(), TUNE_STEP_BODIES > 0u); k++) {
        cost(10u);
        if (bodyWhere(k) != 0u) { continue; }
        let c0 = bodyCentre(k, tNow + s.x.w);
        let R = bodyRadius(k);
        // (nowhere near the step: its centre farther from the step's start than the step, the body's reach — its
        // star's air 4 R, a point's glow the footprint — and what its orbit moves it over the step (|ω| r, its
        // parent's too): its end not worked out)
        {
          let o0 = bodies[BV * k];
          let o1 = bodies[BV * k + 1u];
          var vm = abs(o1.x) * length(o0.xyz);
          if (o1.y >= 0.0) { vm += abs(bodies[BV * u32(o1.y) + 1u].x) * length(bodies[BV * u32(o1.y)].xyz); }
          if (TUNE_BODY_REJECT > 0u && length(p0 - c0) > len + max(4.0 * R, footprint(travel + len)) + vm * abs(n.x.w - s.x.w)) { continue; }
        }
        let c1 = bodyCentre(k, tEm);
        let q0 = p0 - c0;
        let q1 = p1 - c1;
        let dq1 = q1 - q0;
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
    if (diskOn && thick && (TUNE_SKIP & 2048u) == 0u) {
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
    if (c0 * c1 < 0.0 && (TUNE_SKIP & 4096u) == 0u) {
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

// (a pixel within one of the first `layers` discs' rectangles — the stamps' words past the image, renderer discRects; width
// 0: none)
fn inDiscRect(px: u32, py: u32, W: u32, layers: u32) -> bool {
  let n = arrayLength(&stamps);
  let base0 = W * u32(P.res.y);
  for (var i = 0u; i < layers; i++) {
    let b = base0 + 4u * i;
    if (b + 3u >= n) { break; }
    let w = stamps[b + 2u];
    if (w == 0u) { continue; }
    let rx = stamps[b];
    let ry = stamps[b + 1u];
    if (px >= rx && px < rx + w && py >= ry && py < ry + (stamps[b + 3u] & 0xffffu)) { return true; }
  }
  return false;
}
// (main's disc layers: the body the layer draws — renderer discRects: 0 the Sun, 1 the Moon)
var<private> DISC_KIND: u32 = 0u;
// (its rays a pixel: four for a small disc, its limb antialiased — renderer discRects —, one for a wide one)
var<private> DISC_RAYS: u32 = 1u;
// (a wide disc held still: its pixels a 2 × 2 block's one a frame — main —, this frame's within the block)
var<private> DISC_IL: bool = false;
// (a ray of this disc pixel met the body — or a cloud before it —: its depth DISC_BODY_DEPTH, not the sky's)
var<private> DISC_HIT: bool = false;
const DISC_BODY_DEPTH = 1e8;
const DISC_BODY_W = 1.001;
var<private> DISC_OFF: vec2u = vec2u(0u);
// (the block's side: 1, 2 or 4)
var<private> DISC_ST: u32 = 1u;
// (a body's light's gain this ray — ourSegment's planetShade: the Moon's disc at night, main's disc layers)
var<private> BODY_GAIN: f32 = 1.0;
// the Moon's disc's gain at night (main's disc layers): the night's compression — EARTH_MOON's 8 % of the sunlight for the
// moonlit ground against its real 1/400 000 —, a fraction of it: the disc ~10³ the moonlit ground, past white into the bloom
const MOON_NIGHT_GAIN = 150.0;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u,
        @builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
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
  // (TERRE-UNREAL U8 — a second dispatch of this kernel, its layers z ≥ 1: the sky's bodies' discs — the Moon, the Sun —
  // at one ray a pixel over their footprint (renderer.skyDiscs: the rectangles in the stamps' words past the image, from
  // the ephemerides, the refraction counted). The sky's own rays, one a 16 × 16 block over the raster's ground, caught a
  // 12 px Moon one frame and missed it the next — flickering, blurred; here trace() itself — the same air, clouds, bending,
  // planetShade, shadeStar — each pixel, the discs' kept as fresh samples, the sky's left to the rebuilding)
  // (the workgroup's layer — uniform: the discs' kernel returns its sky's whole groups before their barriers)
  let disc = wid.z >= 1u;
  if (DISC_ONLY && !disc) { return; }
  if (disc) {
    let base = W * H + 4u * (gid.z - 1u);
    let rx = stamps[base];
    let ry = stamps[base + 1u];
    FOOT_NEAR = 1.0;
    FOOT_FAR = 1.0;
    FOOT = 1.0;
    let w4 = stamps[base + 3u];
    DISC_KIND = (w4 >> 16u) & 1u;
    DISC_RAYS = select(1u, 4u, ((w4 >> 17u) & 1u) != 0u);
    // (a wide disc held still in the view — the stabilised telescope's Moon over the image —: one pixel of each 2 × 2 a
    // frame, in turn, the three others kept — re-stamped below —: its full resolution in four frames for a quarter of the
    // rays; a thread a block, the SIMD's lanes all tracing)
    // (4 × 4 for the widest — renderer discRects: the telescope's Sun over the whole field, a sixteenth of its rays a frame)
    DISC_IL = ((w4 >> 18u) & 3u) != 0u;
    let st = select(select(2u, 4u, ((w4 >> 19u) & 1u) != 0u), 1u, !DISC_IL);
    DISC_ST = st;
    // (an interleaved one's pixel four rays too: drawn one frame in four or sixteen, its one ray met or missed the limb — a
    // dotted edge —; four, stratified, its share of the disc at each of its turns)
    if (DISC_IL) { DISC_RAYS = 4u; }
    let ph = frameStamp % (st * st);
    DISC_OFF = select(vec2u(0u), vec2u(ph % st, ph / st), DISC_IL);
    // (the blocks on the image's own grid, not the rectangle's: its corner moves a pixel now and then as the Moon slides over
    // the Sun — on its grid each step shifted the phases, some pixels drawn twice, others not again, kept and re-stamped
    // with their old light: a band smeared along the limb)
    // (one block back: the rectangle's first columns and rows before its first aligned pixel — renderer: the dispatch a
    // block wider)
    let lxi = i32(gid.x * st + (DISC_OFF.x + st - rx % st) % st) - i32(select(0u, st, DISC_IL));
    let lyi = i32(gid.y * st + (DISC_OFF.y + st - ry % st) % st) - i32(select(0u, st, DISC_IL));
    let lx = u32(max(lxi, 0));
    let ly = u32(max(lyi, 0));
    inRange = lxi >= 0 && lyi >= 0 && lx < stamps[base + 2u] && ly < (w4 & 0xffffu) && rx + lx < W && ry + ly < H;
    px = min(rx + lx, W - 1u);
    py = min(ry + ly, H - 1u);
    // (two discs overlapping — an eclipse, the Moon over the Sun —: the pixel the first layer's, not both in one dispatch)
    if (inRange && gid.z > 1u && inDiscRect(px, py, W, gid.z - 1u)) { inRange = false; }
  } else if (interleaved) {
    let block = u32(P.res.z);
    FOOT_NEAR = f32(block);
    FOOT_FAR = select(f32(block), 1.0, (flags & FLAG_REPROJECT) != 0u);
    FOOT = FOOT_NEAR;
    inRange = gid.x * block < W && gid.y * block < H;
    px = min(gid.x * block + u32(P.ext2.x), W - 1u);
    py = min(gid.y * block + u32(P.ext2.y), H - 1u);
    // (a disc's rectangle the disc's layer's alone: two rays on one pixel in one dispatch race, and the sky's, its body at
    // its own gain, caught the limb at the block's pitch — a lattice flickering with the offset)
    if (inRange && inDiscRect(px, py, W, 4u)) { inRange = false; }
  } else {
    px = gid.x;
    py = gid.y + u32(P.region.x);
    inRange = px < W && py < u32(P.region.y) && py < H;
  }
  let idx = py * W + px;
  // (realtime, the cockpit's mask — mask.wgsl: moments.x < 0 — over this ray: the cabin hides it, not traced)
  // (−1: under the cockpit's mask, not traced; −2: the cabin there but traced — mask.wgsl)
  let masked = interleaved && inRange && moments[idx].x < -0.5 && moments[idx].x > -1.5;
  // (the raster's primary visibility: a ray whose pixel the patch covers is shade's, not traced here)
  let rasterAt = vec2f(f32(px), f32(py)) + 0.5;
  // (shade not compiled yet — RASTER_SHADE_LATE_FLAG —: only the material's pixels left, the others traced here)
  let rasterSkip = interleaved && inRange && (rasterPrimary() || DISC_ONLY) && (terrainRasterHint(rasterAt) > 0.0 || terrainRasterId(rasterAt) > 0u) &&
    (DISC_ONLY || !rasterShadeLate() || rasterLiteTakes(rasterAt, u32(P.near1.w)));

  // Adaptive sampling, per 8×8 tile: the tile keeps sampling while any of its pixels has a relative
  // standard error of the mean (luminance) above the threshold (keeps ray differentials available).
  if (li == 0u) { atomicStore(&wgActive, 0u); }
  workgroupBarrier();
  var need = inRange && !masked && !rasterSkip;
  if (inRange && !interleaved && accumulate && (flags & FLAG_ADAPTIVE_SPP) != 0u && si >= f32(P.frame.w)) {
    let acc = accum[idx];
    let n = max(acc.a, 1.0);
    let mean = luminance(acc.rgb) / n;
    let variance = max(moments[idx].x / n - mean * mean, 0.0);
    need = sqrt(variance / n) >= P.ext.y * (mean + 0.01);
  }
  if (need) { atomicAdd(&wgActive, 1u); }
  workgroupBarrier();
  let sampling = inRange && !masked && !rasterSkip && atomicLoad(&wgActive) > 0u;

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
    // (the aerial perspective's table for the air before the near world's ground — earthNear's)
    if ((flags & FLAG_AERIAL) != 0u) { AP_UV = pos / P.res.xy; }
    if (HAS_TERRAIN_RASTER) { RHINT = terrainRasterHint(pos); RHINT_TOL = rasterHintTol(pos); }
    // (the clouds of the cloud pass at this ray's pixel — the raster's frames —, read back instead of marched)
    if (interleaved) { CLOUDS_BUFFERED = cloudsBuffered(rasterAt, terrainRasterDepth(rasterAt)); }
    // (the Moon's disc in a night drawn brighter than it is — the moonlit ground at ~8 % of the sunlight (EARTH_MOON), not
    // 1/400 000 —: its light, lit by the full Sun as it is, given the night's own compression — the ratio to the landscape a
    // real night's: dazzling white, its halo the bloom's —, faded in with the dark, before the air and the clouds before it;
    // by day as it is)
    if (disc && DISC_KIND == 1u && isEarth(u32(P.near1.w))) {
      let kE = u32(P.near1.w);
      let lt = nearLight(kE);
      let dark = 1.0 - smoothstep(-0.12, 0.06, dot(normalize(nearCam()), normalize(squashed(toBody(lt.dir), squashOf(kE)))));
      BODY_GAIN = mix(1.0, MOON_NIGHT_GAIN, dark);
    }
    // (a small disc's pixel: four rays, stratified, their grid turned each frame and pixel, averaged as the eye sees them — weighted by
    // 1/(1 + L), L exposed (white ≈ 1/16 pre-exposed: post.wgsl downShip), Karis's —: a limb pixel its share of a disc far
    // past white, not white or sky as one jittered ray falls. The loop's count a runtime one, around the one call of trace()
    // — a constant four, unrolled, inlined it four times: minutes of compile)
    let k = 16.0 * P.zamo2.y;
    // (the turn the pixel's own: one shared by a frame's pixels shifted each 2 × 2 phase's image as a whole — a checker
    // where the Moon's texture is sharp)
    let turn = hash4(vec3u(px, py, frameStamp ^ 0x9e37u)).xy;
    let rays = select(1u, DISC_RAYS, disc);
    var sum = vec3f(0.0);
    var wsum = 0.0;
    DISC_HIT = false;
    for (var s = 0u; s < rays; s++) {
      var nd = ndc;
      if (disc) {
        let o = fract((vec2f(f32(s & 1u), f32(s >> 1u)) + 0.5) * 0.5 + turn) - 0.5;
        let q = vec2f(f32(px) + 0.5, f32(py) + 0.5) + o;
        nd = vec2f(2.0 * q.x / P.res.x - 1.0, 1.0 - 2.0 * q.y / P.res.y);
      }
      if (disc || (flags & FLAG_LUT) == 0u || !farLut(pos, &tr)) { tr = trace(nd, rnd, tSample); }
      if (disc) {
        var c = tr.col;
        if (isNan(c.r + c.g + c.b)) { c = vec3f(0.0); }
        let w = 1.0 / (1.0 + luminance(c) * k);
        sum += c * w;
        wsum += w;
        if (tr.bgW <= 0.0) { DISC_HIT = true; }
      }
    }
    if (disc) { tr.col = sum / max(wsum, 1e-30); }
    BODY_GAIN = 1.0;
    CLOUDS_BUFFERED.alpha = -1.0;
    RHINT = 0.0;
    AP_UV = vec2f(-1.0);
  }
  wgDir[li] = vec4f(tr.dir, select(0.0, tr.sky, sampling && tr.bgW > 0.0));
  wgPos[li] = pos;
  workgroupBarrier();
  if (!sampling) { return; }

  // (a disc's pixel — the body, what stands before it (a cloud), the sky round it: the rectangle's every pixel —, fresh, as
  // the raster's ground is: kept by the resolve, out of the sky's rebuilding)
  if (disc) {
    var dcol = tr.col;
    if (isNan(dcol.r + dcol.g + dcol.b)) { dcol = vec3f(0.0); }
    let dold = accum[idx];
    // (the history: this epoch's — the camera's —, or for a disc held still in the view (the stabilised telescope: DISC_IL)
    // its own last disc sample whatever the craft did — in flight each frame a new epoch, the limb's one ray a frame unmixed:
    // a staircase flickering along it)
    // (its own stamp, kept by its block's re-stamping below — not its mark: the cockpit's mask (mask.wgsl) rewrites every
    // pixel's moments.x each frame)
    let kept = (stamps[idx] >= epoch || (DISC_IL && stamps[idx] + 4u * DISC_ST * DISC_ST >= frameStamp));
    // (its weight: the frame's — in flight ~1, no history: the camera moved —, a disc held still its own: each pixel drawn
    // one frame in four or sixteen, averaged over a few of its turns)
    let wNew = select(P.ext.w, 0.4, DISC_IL);
    if ((temporal || DISC_IL) && kept && dold.a > 0.0) {
      // (the history mixed as the average above, weighted: a flicker of the limb not a white flash)
      let k = 16.0 * P.zamo2.y;
      let o = dold.rgb / dold.a;
      let a = (1.0 - wNew) / (1.0 + luminance(o) * k);
      let b = wNew / (1.0 + luminance(dcol) * k);
      dcol = (o * a + dcol * b) / max(a + b, 1e-30);
    }
    // (its weight 1, or 1.001 where a ray met the body — the colour the same, the re-stamping below telling body from sky)
    let aw = select(1.0, DISC_BODY_W, DISC_HIT);
    accum[idx] = vec4f(dcol * aw, aw);
    // (its depth: the sky's, 1e9 — the sky's rebuilding round the rectangle may read it (post.wgsl resolve, gatherH: a
    // fresh sky sample) —; where a ray met the body or a cloud before it, DISC_BODY_DEPTH: kept out, as the ground is)
    moments[idx] = vec2f(RASTER_MARK, select(1e9, DISC_BODY_DEPTH, DISC_HIT));
    stamps[idx] = frameStamp;
    if (DISC_IL) {
      // (the block's others, drawn by a disc's ray in the frames before (marked): kept, fresh — the disc still in the view)
      for (var j = 0u; j < DISC_ST; j++) {
        for (var i = 0u; i < DISC_ST; i++) {
          if (i == DISC_OFF.x && j == DISC_OFF.y) { continue; }
          let qx = px - DISC_OFF.x + i;
          let qy = py - DISC_OFF.y + j;
          if (qx >= W || qy >= H) { continue; }
          let qi = qy * W + qx;
          // (kept, fresh, marked again — the cockpit's mask cleared its mark —; not where the cabin hides it (−1) — behind
          // the canopy's glass (−2, traced): kept, the telescope's whole view from the cockpit; a pixel of the rectangle not
          // drawn yet by a disc's ray: its stamp too old, left to the sky's rebuilding)
          if (moments[qi].x > -1.5 && stamps[qi] + 4u * DISC_ST * DISC_ST >= frameStamp) {
            stamps[qi] = frameStamp;
            moments[qi] = vec2f(RASTER_MARK, select(1e9, DISC_BODY_DEPTH, accum[qi].a > 1.0005));
          }
        }
      }
    }
    return;
  }
  var col = tr.col;
  if (COST_VIEW > 0u) { tr.bgW = 0.0; col = costHeat(); }
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
    // (the depth: the nearest of the samples — the opaque one —, not their mean: by a trunk against the sky the
    // mean went towards 5e8 M, and the grass behind showed through a fringe of 1–2 px, the camera held)
    moments[idx] = vec2f(m.x + l * l, select(min(m.y, tr.depth), tr.depth, na < 1.5));
    if (polOn) { polAcc[idx] += qu; }
  } else {
    accum[idx] = vec4f(col, 1.0);
    moments[idx] = vec2f(l * l, tr.depth);
    if (polOn) { polAcc[idx] = qu; }
  }
  stamps[idx] = frameStamp;
}

// The raster's shading rate (earthRasterShading — renderer: mouthList[1].y, 1 every pixel, 2 one in two — a checkerboard —,
// 4 one in 2 × 2) and its pattern, turned each frame: the pixel a packed thread shades, and whether a pixel is shaded.
fn rasterRate() -> u32 { let c = u32(P.mouthList[1].y + 0.5) & 15u; return select(c, 16u, c == 15u); }
// The raster's sub-pixel jitter (renderer.rasterJitter "halton", mouthList[1].y + 16): the same offset for every pixel of a
// frame — the raster's projection moved by it too (renderer: terrainRasterFrame's output.zw) —, Halton (2, 3) over 16
// frames: the visibility and the rays agree at every pixel, and the history gathers the outlines' sub-pixel coverage
// (the image's antialiasing); else each pixel's own random offset, the visibility the pixel's centre's.
fn rasterHalton() -> bool { return (u32(P.mouthList[1].y + 0.5) & 16u) != 0u; }
// The ground's detail at every pixel (renderer.rasterDetail, mouthList[1].y + 64): the orthophoto's albedo read at each raster
// pixel each frame, sharp, while the light is shaded sparsely — post.wgsl resolve and temporal swap it in for the albedo of
// the pixels their colour came from
const RASTER_DETAIL_FLAG = 64u;
fn rasterDetailOn() -> bool { return (u32(P.mouthList[1].y + 0.5) & RASTER_DETAIL_FLAG) != 0u; }
// The albedo's luminance of the ground the raster patch puts under the pixel's centre (its distance along the ray — the same
// point for the shaded pixel and the ones left, so the ratio of two is the texture's alone), filtered to the pixel's
// footprint; 0: none (no imagery, a tree or a building, the ground unlit — the city's lights at night are not its albedo).
// Written in moments.x beside the raster's marks (rasterMark, rasterStale).
fn rasterAlbedo(px: vec2f, k: u32) -> f32 {
  // (not on the far rings: shaded one cycle in TUNE_RING_RATE, their few samples rebuilt over 4 × 4 cells — the albedo's swap
  // drew those cells' crosses bright along the horizon, for detail too small to see there)
  if (!rasterDetailOn() || terrainRasterId(px) != 0u || P.near3.w > 0.5 || terrainRasterLevelStep(px) > 0.5) { return 0.0; }
  let tM = terrainRasterHint(px);
  if (tM <= 0.0) { return 0.0; }
  let ndc = vec2f(2.0 * px.x / P.res.x - 1.0, 1.0 - 2.0 * px.y / P.res.y);
  let look = normalize(P.camFwd.xyz + ndc.x * P.cam.w * P.camRight.w * P.camRight.xyz + ndc.y * P.cam.w * P.camUp.xyz);
  let ab = squashOf(k);
  let rs = squashed(toBody(look), ab);
  let rd = rs / length(rs);
  let kM = length(vec3f(rd.xy, rd.z / ab)) * EARTH_RM;
  let fine = P.nearCam1.w > 0.5;
  let q = normalize(select(nearCam(), P.nearCam0.xyz, fine) + select(vec3f(0.0), P.nearCam1.xyz, fine) + rd * (tM / kM));
  let gq = geoQ(q);
  if (dot(gq, normalize(squashed(toBody(P.near4.xyz), ab))) < 0.03) { return 0.0; }
  // (the pixel's footprint there: a pixel across, 1 / sin of the grazing angle along the ray's way over the ground — read
  // anisotropically, as earthGround reads it)
  let sinG = max(abs(dot(rd, q)), 0.02);
  let pw = tM * P.camUp.w / EARTH_RM;
  let along = rd - q * dot(rd, q);
  let way = select(normalize(along), normalize(cross(q, vec3f(0.0, 0.0, 1.0))), dot(along, along) < 1e-12);
  let img = earthImageryAniso(gq, way * (pw / sinG), cross(q, way) * pw);
  if (img.w < 0.5) { return 0.0; }
  return clamp(luminance(img.c.rgb), 0.004, 1.0);
}
// moments.x of a raster pixel with its albedo a (0: none): shaded this frame — RASTER_MARK and over —, left — RASTER_STALE and
// under (post.wgsl rasterAlb reads it back; their tests are ranges: > 1e29, (−3.5, −2.5))
fn rasterMark(a: f32) -> f32 { return RASTER_MARK * (1.0 + a); }
fn rasterStale(a: f32) -> f32 { return RASTER_STALE - 0.45 * a; }
fn halton(i: u32, b: u32) -> f32 {
  var f = 1.0;
  var r = 0.0;
  var n = i;
  loop {
    if (n == 0u) { break; }
    f /= f32(b);
    r += f * f32(n % b);
    n /= b;
  }
  return r;
}
fn rasterJitter(frame: u32) -> vec2f {
  let i = frame % 16u + 1u;
  return vec2f(halton(i, 2u), halton(i, 3u)) - 0.5;
}
// (1 in 8, 1 in 16 — earthRasterShading "eighth", "sixteenth": blocks of 4 × 2 and 4 × 4, their pixels in an order that puts
// each frame's far from the last's — Bayer's —: every pixel shaded once in 8 or 16 frames, the gaps between a frame's samples
// filled evenly as they come)
fn rasterOffset(rate: u32, f: u32) -> vec2u {
  if (rate >= 16u) {
    return array<vec2u, 16>(vec2u(0u, 0u), vec2u(2u, 2u), vec2u(2u, 0u), vec2u(0u, 2u), vec2u(1u, 1u), vec2u(3u, 3u), vec2u(3u, 1u),
      vec2u(1u, 3u), vec2u(1u, 0u), vec2u(3u, 2u), vec2u(3u, 0u), vec2u(1u, 2u), vec2u(0u, 1u), vec2u(2u, 3u), vec2u(2u, 1u),
      vec2u(0u, 3u))[f % 16u];
  }
  return array<vec2u, 8>(vec2u(0u, 0u), vec2u(2u, 1u), vec2u(2u, 0u), vec2u(0u, 1u), vec2u(1u, 1u), vec2u(3u, 0u), vec2u(3u, 1u),
    vec2u(1u, 0u))[f % 8u];
}
fn rasterBlock(rate: u32) -> vec2u { return select(vec2u(4u, 2u), vec2u(4u, 4u), rate >= 16u); }
fn rasterPixel(g: vec2u, rate: u32, f: u32) -> vec2u {
  if (rate >= 8u) { return g * rasterBlock(rate) + rasterOffset(rate, f); }
  if (rate >= 4u) { return g * 2u + array<vec2u, 4>(vec2u(0u, 0u), vec2u(1u, 1u), vec2u(1u, 0u), vec2u(0u, 1u))[f % 4u]; }
  if (rate >= 2u) { return vec2u(g.x * 2u + ((g.y + f) & 1u), g.y); }
  return g;
}
fn rasterShaded(p: vec2u, rate: u32, f: u32) -> bool {
  if (rate >= 8u) { return all(p % rasterBlock(rate) == rasterOffset(rate, f)); }
  if (rate >= 4u) { return all(p % 2u == array<vec2u, 4>(vec2u(0u, 0u), vec2u(1u, 1u), vec2u(1u, 0u), vec2u(0u, 1u))[f % 4u]); }
  if (rate >= 2u) { return (p.x & 1u) == ((p.y + f) & 1u); }
  return true;
}
// moments.x of a pixel the raster covers and shade left this frame: shadeMark's — post.wgsl resolve rebuilds it from the
// fresh shaded pixels round it on the same surface (their depths alike), moments.y its nearest surface's depth [M]
const RASTER_STALE = -3.0;

// The raster's primary visibility (docs/PLAN-RENDU-RASTER-AAA.md étape 1): one thread a pixel — not one a block —, for
// the pixels the terrain patch covers (its distance, terrainRasterHint), main having left them. The Earth near the
// camera only (earthNear: its ground found from the patch's distance by two reads and a refinement, its air, clouds,
// sea and scenery as main has them), none of the relativistic integrator: the kernel compiles what earthNear calls and
// no more. Written as main writes a realtime ray (accum, moments, stamps), so the reconstruction, the temporal
// reprojection and the light meter read it as they read the rays; moments.x RASTER_MARK keeps it out of gatherH.
// A pixel whose ground the refinement does not find (the hint off the relief, or the sky through a gap) is left
// unwritten: stale, it is rebuilt from the fresh samples round it as main's skipped rays are.
// At a shading rate above 1 (earthRasterShading), a thread a pixel of the frame's pattern only — the threads packed, no
// lane idle beside a shaded one —; the others are shadeMark's.
@compute @workgroup_size(8, 8)
fn shade(@builtin(global_invocation_id) gid: vec3u) {
  let W = u32(P.res.x);
  let H = u32(P.res.y);
  let rate = rasterRate();
  let px = rasterPixel(gid.xy, rate, P.frame.x);
  if (!rasterPrimary() || !HAS_BODIES || P.near0.w < 0.5 || px.x >= W || px.y >= H) { return; }
  let k = u32(P.near1.w);
  if (!isEarth(k) || !hasAir(k) || !earthOn()) { return; }
  let idx = px.y * W + px.x;
  // (the terrain's pixels and the scenery's — a tree against the sky too)
  let centre = vec2f(px) + 0.5;
  RASTER_ID = terrainRasterId(centre);
  RASTER_BLD = terrainRasterBuilding(centre);
  if (terrainRasterHint(centre) <= 0.0 && RASTER_ID == 0u) { return; }
  // (the ground shadeLite shades at every pixel: not here — but a bridge's box: its deck the rays', shadeLite the water about it)
  if (rasterLiteTakes(centre, u32(P.near1.w)) && !terrainRasterBridge(centre)) { return; }
  RASTER_SCENERY = P.mouthList[1].z > 0.5;
  RASTER_SHADE = true;
  // (the clouds before this pixel's surface: the cloud pass's, read back, not marched again)
  CLOUDS_BUFFERED = cloudsBuffered(centre, terrainRasterDepth(centre));
  // (under the cockpit's mask: the cabin there)
  if (moments[idx].x < -0.5 && moments[idx].x > -1.5) { return; }
  let flags = P.frame.z;
  let frameStamp = P.frame.x;
  // (a far ring's pixel — the ground there coarse, far, small —: shaded one cycle of the pattern in TUNE_RING_RATE, its 4 × 4
  // cells taking turns — a checkerboard turned each cycle: as many shaded every frame —, left as shadeMark leaves the
  // others the rest)
  let cell = px / 4u;
  if (TUNE_RING_RATE > 1u && rate > 1u && terrainRasterLevelStep(centre) > 0.5 && RASTER_ID == 0u &&
      (cell.x + cell.y + frameStamp / rate) % TUNE_RING_RATE != 0u) {
    moments[idx] = vec2f(RASTER_STALE, terrainRasterDepth(centre) / EARTH_RM * bodyRadius(k));
    return;
  }
  let temporal = (flags & FLAG_TEMPORAL) != 0u;
  // (the footprint of the square the sample stands for — a pixel at every pixel, 2 × 2 at one in four: its detail filtered to
  // the area its colour is spread over, not a block's)
  let foot = select(sqrt(f32(rate)), TUNE_RASTER_FOOT, TUNE_RASTER_FOOT > 0.0);
  FOOT_NEAR = foot;
  FOOT_FAR = foot;
  FOOT = foot;
  var jit = vec2f(0.0);
  if (temporal) { jit = select(gaussJitter(hash4(vec3u(px, frameStamp)).xy), rasterJitter(frameStamp), rasterHalton()); }
  let rnd = fract(ign(vec2f(px)) + f32(frameStamp % 1024u) * 0.6180339887);
  let pos = vec2f(px) + 0.5 + jit;
  let ndc = vec2f(2.0 * pos.x / P.res.x - 1.0, 1.0 - 2.0 * pos.y / P.res.y);
  let look = normalize(P.camFwd.xyz + ndc.x * P.cam.w * P.camRight.w * P.camRight.xyz + ndc.y * P.cam.w * P.camUp.xyz);
  if ((flags & FLAG_AERIAL) != 0u) { AP_UV = pos / P.res.xy; }
  // (the patch's distance at the pixel's own texel: drawn along this very ray when the raster is jittered with it)
  RHINT = terrainRasterHint(select(pos, centre, rasterHalton()));
  RHINT_TOL = rasterHintTol(select(pos, centre, rasterHalton()));
  RND = fract(rnd * 7.31 + 0.13);
  REFR_DELTA = 0.0;
  let e = earthNear(look, rnd, k);
  RHINT = 0.0;
  RASTER_ID = 0u;
  RASTER_BLD = true;
  RASTER_SCENERY = false;
  RASTER_SHADE = false;
  AP_UV = vec2f(-1.0);
  if (e.t <= 0.0) { return; }
  var col = e.col;
  if (COST_VIEW > 0u) { col = costHeat(); }
  if (TUNE_RASTER_PATHS == 1u) {
    col = array<vec3f, 4>(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), vec3f(1.0))[min(RASTER_PATH, 3u)];
  }
  if (TUNE_RASTER_PATHS == 2u) {
    let tint = array<vec3f, 4>(vec3f(0.6), vec3f(1.0, 0.15, 0.1), vec3f(0.15, 1.0, 0.2), vec3f(0.2, 0.35, 1.0))[min(HINT_PATH, 3u)];
    col = tint * (0.3 + luminance(col));
  }
  HINT_PATH = 0u;
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }
  // (its albedo where the surface shaded is the patch's — not a windsock, a building or a craft the march met before it —, read
  // along its own jittered ray, as its colour: the two of one point — the temporal pass accumulates the albedos' jittered reads,
  // the texture antialiased)
  let dM = e.t * bodyRadius(k);
  let hM = terrainRasterDepth(centre) / EARTH_RM * bodyRadius(k);
  let alb = select(0.0, rasterAlbedo(pos, k), abs(dM - hM) < 0.03 * hM);
  let old = accum[idx];
  if (temporal && stamps[idx] >= P.frame.y && old.a > 0.0) { col = mix(old.rgb / old.a, col, P.ext.w); }
  accum[idx] = vec4f(col, 1.0);
  moments[idx] = vec2f(rasterMark(alb), dM);
  stamps[idx] = frameStamp;
}


// The pixels the raster covers that shade leaves this frame (a shading rate above 1): their nearest surface's depth (the
// visibility target's b, the ground's or a tree's proxy) and the mark that has resolve rebuild them, their colour and stamp
// left as they were. One cheap thread a pixel — every pixel: a mark an earlier frame left where the raster no longer covers
// (the camera turned to the sky) or where shade found no ground this frame (the sky through a gap, a silhouette) is taken
// off — resolve would rebuild that pixel as the ground it showed —, the pixel then the rays' (rebuilt from their samples).
@compute @workgroup_size(8, 8)
fn shadeMark(@builtin(global_invocation_id) gid: vec3u) {
  let W = u32(P.res.x);
  let H = u32(P.res.y);
  if (gid.x >= W || gid.y >= H) { return; }
  let idx = gid.y * W + gid.x;
  let m = moments[idx];
  // (under the cockpit's mask: the mask's own marks)
  if (m.x < -0.5 && m.x > -1.5) { return; }
  let rate = rasterRate();
  let on = rate > 1u && rasterPrimary() && HAS_BODIES && P.near0.w > 0.5;
  let d = select(0.0, terrainRasterDepth(vec2f(gid.xy) + 0.5), on);
  if (d <= 0.0 || rasterShaded(gid.xy, rate, P.frame.x)) {
    if (m.x < -2.5 && m.x > -3.5) { moments[idx] = vec2f(0.0, m.y); }
    return;
  }
  let k = u32(P.near1.w);
  // (the ground shadeLite shades at every pixel: fresh, not left — the Earth's; another world's, bodyLite, at the rate's)
  let body = !hasAir(k) && bodyKind(k) != 0u;
  if (!body && rasterLiteTakes(vec2f(gid.xy) + 0.5, k)) { return; }
  if (body) {
    moments[idx] = vec2f(rasterStale(0.0), d / P.near4.w * bodyRadius(k));
    return;
  }
  // (its albedo read through a jittered point of the pixel, as shade's rays are: the temporal pass accumulates them — read at
  // the centre every frame, the texture aliased, flickering under the motion, the most where the ground grazes, at the horizon)
  var jit = vec2f(0.0);
  if ((P.frame.z & FLAG_TEMPORAL) != 0u) {
    jit = select(gaussJitter(hash4(vec3u(gid.xy, P.frame.x)).xy), rasterJitter(P.frame.x), rasterHalton());
  }
  moments[idx] = vec2f(rasterStale(rasterAlbedo(vec2f(gid.xy) + 0.5 + jit, k)), d / EARTH_RM * bodyRadius(k));
}

// ---------------------------------------------------------------------------------------------------------------------
// The raster's ground at every pixel, every frame — « façon Unreal » (docs/progress/raster-aaa/TERRE-UNREAL.md U1): a
// material evaluated from prepared data, none of the tracer's marches. The surface is the raster patch's own (its nested
// grids 1.2 m … 2.4 km apart: no march from its distance), its normal the mesh's from the neighbouring pixels' distances,
// its colour the imagery read anisotropically, its light the Sun's and the sky's, its shadows read from the maps (the
// relief's, the trees' and buildings', the clouds'), its air from the aerial table, its clouds from the cloud pass. The
// sea and the scenery stay shade's (at the governor's rate).
// renderer.rasterLite, mouthList[1].y + 128.
const RASTER_LITE_FLAG = 128u;
fn rasterLiteOn() -> bool { return (u32(P.mouthList[1].y + 0.5) & RASTER_LITE_FLAG) != 0u; }
// the material's on, the leftovers' kernel (shade) not compiled yet: the pixels the material does not take are main's
const RASTER_SHADE_LATE_FLAG = 1024u;
fn rasterShadeLate() -> bool { return (u32(P.mouthList[1].y + 0.5) & RASTER_SHADE_LATE_FLAG) != 0u; }
// The trees within RASTER_NEAR_TREES_M of the camera the rays' kernel's, not the material's (renderer.nearTreesNow,
// mouthList[1].y + 2048: shade run this frame, the camera low near the scenery)
const RASTER_NEAR_TREES_FLAG = 2048u;
const RASTER_NEAR_TREES_M = 80.0;
fn rasterNearTreesOn() -> bool { return (u32(P.mouthList[1].y + 0.5) & RASTER_NEAR_TREES_FLAG) != 0u; }
struct RasterRay { look: vec3f, rd: vec3f, kM: f32 };
// the camera ray through an image point [px]: its look (the camera's frame), its unit direction in the squashed space, and
// how many metres of the physical ray a unit of it is
fn rasterRay(pos: vec2f, k: u32) -> RasterRay {
  let ndc = vec2f(2.0 * pos.x / P.res.x - 1.0, 1.0 - 2.0 * pos.y / P.res.y);
  let look = normalize(P.camFwd.xyz + ndc.x * P.cam.w * P.camRight.w * P.camRight.xyz + ndc.y * P.cam.w * P.camUp.xyz);
  let ab = squashOf(k);
  let rs = squashed(toBody(look), ab);
  let rd = rs / length(rs);
  return RasterRay(look, rd, length(vec3f(rd.xy, rd.z / ab)) * EARTH_RM);
}
// the point tM metres along it, in the squashed space from the body's centre [radii] (the camera split fine, as the hint's)
fn rasterPoint(r: RasterRay, tM: f32) -> vec3f {
  let fine = P.nearCam1.w > 0.5;
  return select(nearCam(), P.nearCam0.xyz, fine) + select(vec3f(0.0), P.nearCam1.xyz, fine) + r.rd * (tM / r.kM);
}
// the pixel's ground is shadeLite's: the patch's (not a tree's, a building's), not the sea's (its glint, waves, mirror are
// shade's) — the same test in shade, shadeMark and shadeLite
fn rasterLiteTakes(px: vec2f, k: u32) -> bool {
  if (!rasterLiteOn()) { return false; }
  // (a building's own triangles — U2 —: the material's; its box alone — a building without triangles, the box's margin —: the
  // rays', as before)
  if (terrainRasterMesh(px)) { return true; }
  // (a bridge's box: the material's too — shadeLite tests its deck along the ray, leaves the deck to the rays' kernel, draws
  // the water about it: one river, not the kernel's own shading in the box's patch)
  if (terrainRasterBridge(px)) { return terrainRasterHint(px) > 0.0; }
  if (terrainRasterBuilding(px)) { return false; }
  let tM = terrainRasterHint(px);
  if (tM <= 0.0) { return false; }
  // (a tree before the ground — U2 —: the material's; against the sky, the rays'; the ground, the sea's too — its water is the
  // material's, seaShade — ; but near — RASTER_NEAR_TREES_FLAG, the rays' kernel run —, the rays': its crown carved, what
  // stands behind it found — the material tests the proxy's tree alone, the trees and buildings behind it gone in a ring round
  // each crown, glaring close by)
  if (rasterNearTreesOn() && terrainRasterId(px) != 0u && terrainRasterDepth(px) < RASTER_NEAR_TREES_M) { return false; }
  return true;
}
// the mesh's normal at a pixel (the body's physical axes), from its neighbours' distances — none where a neighbour is off
// the surface (a silhouette, the sky): 0
fn rasterNormal(px: vec2f, tM: f32, k: u32) -> vec3f {
  let sx = select(1.0, -1.0, px.x + 1.0 >= P.res.x);
  let sy = select(1.0, -1.0, px.y + 1.0 >= P.res.y);
  let tx = terrainRasterHint(px + vec2f(sx, 0.0));
  let ty = terrainRasterHint(px + vec2f(0.0, sy));
  if (tx <= 0.0 || ty <= 0.0 || abs(tx - tM) > 0.08 * tM || abs(ty - tM) > 0.08 * tM) { return vec3f(0.0); }
  // (not across a seam between two of the relief's rings — their meshes meet within their tolerance, not smoothly: the normal
  // there tipped, a line of false slope along the seam — the cascades' white water drew it over the sea)
  let lv = terrainRasterLevelStep(px);
  if (terrainRasterLevelStep(px + vec2f(sx, 0.0)) != lv || terrainRasterLevelStep(px + vec2f(0.0, sy)) != lv) { return vec3f(0.0); }
  let d0 = toBody(rasterRay(px, k).look);
  let p0 = d0 * tM;
  let ex = toBody(rasterRay(px + vec2f(sx, 0.0), k).look) * tx - p0;
  let ey = toBody(rasterRay(px + vec2f(0.0, sy), k).look) * ty - p0;
  var n = cross(ex, ey);
  if (dot(n, n) < 1e-20) { return vec3f(0.0); }
  n = normalize(n);
  return select(n, -n, dot(n, d0) > 0.0);
}

// The sunlight on a raster pixel's surface (shadeLite, shadeWater): through the air, under the clouds — their map, else the
// cover's shadow along the Sun's slant —, the Sun's disc over the horizon, the relief's shadow map, the trees' and buildings'
// (a building's own face lifted off its triangles, along its normal and towards the Sun)
fn liteSun(q: vec3f, gq: vec3f, hG: f32, Ls: vec3f, Lp: vec3f, Esun: vec3f, fx: vec3f, fy: vec3f, dirW: vec3f, tM: f32, n: vec3f, mesh: bool) -> vec3f {
  // (Esun: E through the air down to the ground — sunThrough, worked out once by the caller: the bounce reads it too)
  var Eg = Esun;
  let csT = select(cloudShadowAt(q * (1.0 + hG / EARTH_RM)), 1.0, (liteSkip() & 32u) != 0u);
  if (csT >= 0.0) {
    Eg *= csT;
  } else {
    let marchMu = dot(q, Ls);
    let qs = normalize(q + (Ls - q * marchMu) * (P.earth2.x / max(marchMu, 0.06)));
    var shade = 1.0 - 0.8 * earthCloud(qs, fx * 3.0, fy * 3.0, Ls).x;
    // (beyond the clouds' map: the weather's layers' shadows, each cast from its middle along the Sun's slant — as the
    // tracer's ground)
    let wg = wxNear(q);
    if (HAS_WX && wg > 0.0) {
      shade = mix(shade, 1.0, wg);
      for (var i = 0u; i < 3u; i++) {
        let L = P.wx[1u + i];
        if (L.z <= 0.0 || hG >= L.y) { continue; }
        let hm = 0.5 * (L.x + L.y) - hG;
        let qi = normalize(q + (Ls - q * marchMu) * (hm / EARTH_RM / max(marchMu, 0.06)));
        shade *= 1.0 - wg * wxLayerA(qi, i) * (1.0 - exp(-0.5 * L.w / max(marchMu, 0.06)));
      }
    }
    Eg *= shade;
  }
  Eg *= sunSeen(q * (1.0 + hG / (EARTH_RM * earthSq(q))), Ls);
  if ((liteSkip() & 4u) == 0u) {
    let far = sunShadowFar(dirW * tM);
    if (far.x >= 0.0) { Eg *= far.x; }
  }
  if (HAS_SCENERY && P.scenery[0].w > 0.5 && P.scenery[2].w > 0.5 && dot(n, Lp) > 0.0 && (liteSkip() & 2u) == 0u) {
    // (the scenery's local frame — sceneryLocal's, written out: compiled out with the scenery)
    let toSc = mat3x3f(P.scenery[0].xyz, P.scenery[1].xyz, P.scenery[2].xyz);
    // (a building's own face — U2 —: its triangles are in the map, the point lifted off them, along its normal and towards
    // the Sun — at 0.35 m its own depth shadowed it, a speckle over the roofs)
    let lift = select(n * 0.35, n * 1.2 + Lp * 1.5, mesh);
    let sp = P.scenery[3].xyz + (dirW * tM + lift) * toSc;
    let m = treeShadowAt(sp);
    let b = buildingShadowAt(sp);
    LITE_SH_DBG = vec2f(m, b);
    var sh = 1.0;
    if (m >= 0.0) { sh = min(sh, m); }
    if (b >= 0.0) { sh = min(sh, b); }
    // (faded out before the map's edge — ±900 m about a centre on a 128 m grid: read to its edge, the shadows there came and
    // went in a block at each of its jumps, every second at 160 m/s)
    Eg *= mix(sh, 1.0, smoothstep(550.0, 750.0, tM));
  }
  return Eg;
}
// (TUNE_LITE 8192 — a measure —: the trees' and buildings' shadow map as liteSun read it at the surface: x trees', y buildings'
// (−1 off the map), drawn instead of the surface: red shadowed, white lit, blue off the map, black not read)
var<private> LITE_SH_DBG: vec2f = vec2f(-2.0);
fn liteShadowDebug(E: vec3f) -> vec3f {
  let v = LITE_SH_DBG;
  if (v.x < -1.5) { return vec3f(0.0); }
  if (min(v.x, v.y) < -0.5) { return vec3f(0.0, 0.0, 0.3) * luminance(E); }
  let s = min(v.x, v.y);
  return vec3f(0.3, 0.3 * s, 0.3 * s) * luminance(E);
}
// The sky's light at a raster pixel's surface (as earthGround's)
fn liteSky(q: vec3f, hG: f32, E: vec3f, Ls: vec3f, mu0: f32) -> vec3f {
  return max(skyFlat(q, hG, E, mu0, skySeen(q, Ls)), E * nightFloor(skySeen(q, Ls), mu0));
}
// A raster pixel's surface radiance G seen through the clouds before it (the cloud pass's) and the air (the aerial table's —
// else marched, as earthLook), blended with its last colour (P.ext.w, temporal: not after shadeLite's own write), written
fn liteFinish(idx: u32, centre: vec2f, pos: vec2f, G: vec3f, rd: vec3f, tH: f32, tM: f32, Ls: vec3f, E: vec3f, k: u32, blend: bool) {
  let flags = P.frame.z;
  let frameStamp = P.frame.x;
  // (liteSkip 2048: no air nor clouds over the surface — a measure)
  if ((liteSkip() & 2048u) != 0u) {
    accum[idx] = vec4f(G, 1.0);
    moments[idx] = vec2f(RASTER_MARK, tM / EARTH_RM * bodyRadius(k));
    stamps[idx] = frameStamp;
    return;
  }
  let ro = nearCam();
  let cs = cloudsBuffered(centre, terrainRasterDepth(centre));
  let alpha = max(cs.alpha, 0.0);
  if ((flags & FLAG_AERIAL) != 0u) { AP_UV = pos / P.res.xy; }
  var air: EarthAir;
  var useAp = AP_UV.x >= 0.0 && dot(ro, ro) < airTop() * airTop();
  var tFar = 0.0;
  if (useAp) {
    tFar = apFar(ro);
    useAp = apCovers(tH, tFar) && (alpha <= 0.0 || apCovers(cs.tc, tFar));
  }
  if (useAp) {
    air = apRead(tH, tFar);
    air.Tc = vec3f(1.0);
    air.Lc = vec3f(0.0);
    if (alpha > 0.0) {
      let c = apRead(cs.tc, tFar);
      air.Tc = c.T;
      air.Lc = c.L;
    }
  } else {
    air = earthAir(ro, rd, tH, Ls, E, fract(ign(centre) + f32(frameStamp % 1024u) * 0.618), select(3e38, cs.tc, alpha > 0.0));
  }
  AP_UV = vec2f(-1.0);
  var col = (1.0 - alpha) * (air.L + air.T * G) + alpha * (air.Lc + air.Tc * cs.cl);
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }
  let old = accum[idx];
  if (blend && (flags & FLAG_TEMPORAL) != 0u && stamps[idx] >= P.frame.y && old.a > 0.0) { col = mix(old.rgb / old.a, col, P.ext.w); }
  accum[idx] = vec4f(col, 1.0);
  moments[idx] = vec2f(RASTER_MARK, tM / EARTH_RM * bodyRadius(k));
  stamps[idx] = frameStamp;
}
// The water split from shadeLite (renderer.rasterWater, mouthList[1].y + 256): shadeLite leaves its water's pixels to
// shadeWater — their surface radiance under the water in accum (before the air), moments.x RASTER_WATER less their kind
// (0 the sea, 1 a river, 2 a lake) and a quarter of their cover —; shadeLite keeps none of the water's code: smaller, quicker
// to compile, lighter on its registers
const RASTER_WATER_FLAG = 256u;
const RASTER_WATER = -5.0;
fn rasterWaterOn() -> bool { return (u32(P.mouthList[1].y + 0.5) & RASTER_WATER_FLAG) != 0u; }
// a raster pixel's frame jitter (shadeLite, shadeWater alike)
fn liteJitter(gid: vec2u) -> vec2f {
  if ((P.frame.z & FLAG_TEMPORAL) == 0u) { return vec2f(0.0); }
  return select(gaussJitter(hash4(vec3u(gid, P.frame.x)).xy), rasterJitter(P.frame.x), rasterHalton());
}

// (bodyLite's relief shadows left out — liteSkip 4: a measure)
var<private> NEAR_SHADOW_OFF: bool = false;
// A world without the Earth's air near (Gargantua's, the Moon, Mercury, the airless moons — the tracer's nearMarch worlds):
// its ground drawn by the raster (system/body-raster.ts, PLAN-PLANETES-AAA P1), shaded here a pixel at a time — the point
// from the raster's distance instead of the march, then the tracer's own shading (shadeNear: the relief's normal and shadows,
// the world's material, its light) and its air (nearAir), as main shades a nearMarch hit
// A frozen cloud's pixel (Mann — PLAN-PLANETES-AAA P4): the slab's normal from the neighbouring pixels' distances, its ice white
// over blue — bluer where thick: its light through it —, lit by the world's probe (its sky, Gargantua's disk), the air before it
fn bodyCloudLite(idx: u32, centre: vec2f, look: vec3f, tR: f32, k: u32) {
  let mR = P.near4.w;
  let p0 = toBody(look) * tR;
  var n = -look;
  let dx = terrainRasterHint(centre + vec2f(1.0, 0.0));
  let dy = terrainRasterHint(centre + vec2f(0.0, 1.0));
  if (dx > 0.0 && dy > 0.0 && terrainRasterCloud(centre + vec2f(1.0, 0.0)) && terrainRasterCloud(centre + vec2f(0.0, 1.0))) {
    let lx = rasterLook(centre + vec2f(1.0, 0.0));
    let ly = rasterLook(centre + vec2f(0.0, 1.0));
    let ex = toBody(lx) * (dx / mR) - p0;
    let ey = toBody(ly) * (dy / mR) - p0;
    let nb = normalize(cross(ex, ey));
    n = fromBody(nb);
    if (dot(n, look) > 0.0) { n = -n; }
  }
  let q = normalize(nearCam() + p0);
  let c = mannCloud(q);
  let thick = clamp((c.y - c.x) / 500.0, 0.0, 1.0);
  let lt = nearLight(k);
  let A = mix(vec3f(0.88, 0.92, 0.96), vec3f(0.55, 0.72, 0.9), thick);
  var col = A / PI * nearE(n);
  // (the light through its thinner edge, from behind it)
  col += vec3f(0.3, 0.55, 0.75) * lt.e * (pow(max(dot(look, lt.dir), 0.0), 4.0) * (1.0 - thick) * 0.15 / PI);
  let nair = nearAir(look, tR, k);
  col = col * nair.T + nair.L;
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }
  let old = accum[idx];
  if ((P.frame.z & FLAG_TEMPORAL) != 0u && stamps[idx] >= P.frame.y && old.a > 0.0) { col = mix(old.rgb / old.a, col, P.ext.w); }
  accum[idx] = vec4f(col, 1.0);
  moments[idx] = vec2f(RASTER_MARK, tR * bodyRadius(k));
  stamps[idx] = P.frame.x;
}
// the camera ray through an image point [px] (the camera's frame)
fn rasterLook(pos: vec2f) -> vec3f {
  let ndc = vec2f(2.0 * pos.x / P.res.x - 1.0, 1.0 - 2.0 * pos.y / P.res.y);
  return normalize(P.camFwd.xyz + ndc.x * P.cam.w * P.camRight.w * P.camRight.xyz + ndc.y * P.cam.w * P.camUp.xyz);
}

// At a shading rate above 1 (the governor's — earthRasterShading), a thread a pixel of the frame's pattern only, the threads
// packed as shade's; the others are shadeMark's, rebuilt by post.wgsl resolve from the fresh ones round them.
fn bodyLite(gid: vec2u, k: u32) {
  let W = u32(P.res.x);
  let px = rasterPixel(gid, rasterRate(), P.frame.x);
  if (px.x >= W || px.y >= u32(P.res.y)) { return; }
  let idx = px.y * W + px.x;
  // (under the cockpit's mask: the cabin there)
  if (moments[idx].x < -0.5 && moments[idx].x > -1.5) { return; }
  let centre = vec2f(px) + 0.5;
  if (terrainRasterHint(centre) <= 0.0) { return; }
  FOOT = 1.0;
  FOOT_NEAR = 1.0;
  FOOT_FAR = 1.0;
  let pos = centre + liteJitter(px);
  var tM = terrainRasterHint(pos);
  if (tM <= 0.0) { tM = terrainRasterHint(centre); }
  let ndc = vec2f(2.0 * pos.x / P.res.x - 1.0, 1.0 - 2.0 * pos.y / P.res.y);
  let look = normalize(P.camFwd.xyz + ndc.x * P.cam.w * P.camRight.w * P.camRight.xyz + ndc.y * P.cam.w * P.camUp.xyz);
  let mR = P.near4.w;
  let tR = tM / mR;
  // (the point on the body's axes from the camera there in float64 — nearCam —; its height the relief's own, not the
  // distance's rounding: a float32 radius is ±0.5 m on an Earth-sized world)
  let surf = u32(bodies[BV * k + 2u].z);
  let tSec = P.time.x * P.near5.w;
  // (Mann's frozen clouds — the raster's slabs, a 1.5 —: ice in the air)
  if (terrainRasterCloud(centre)) {
    bodyCloudLite(idx, centre, look, tR, k);
    return;
  }
  var hit: NearHit;
  hit.t = tR;
  hit.qb = normalize(nearCam() + toBody(look) * tR);
  hit.h = relief(surf, hit.qb, reliefFoot(tR), mR, tSec);
  RND = fract(ign(centre) + f32(P.frame.x % 1024u) * 0.618);
  NEAR_SHADOW_OFF = (liteSkip() & 4u) != 0u;
  // (Gargantua's worlds: the camera white-balanced to their light part of the way — as main's nearMarch hit)
  var wb = vec3f(1.0);
  if (k < ourStart() && bodyKind(k) != 0u) {
    let le = nearLight(k).e;
    let ll = luminance(le);
    if (ll > 0.0) { wb = ll / max(mix(vec3f(ll), le, 0.6), vec3f(1e-30)); }
  }
  let nair = nearAir(look, tR, k);
  setMapLod(pixFoot() * tR, 0.0, k);
  var col = (shadeNear(look, hit) * nair.T + nair.L) * wb;
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }
  let old = accum[idx];
  if ((P.frame.z & FLAG_TEMPORAL) != 0u && stamps[idx] >= P.frame.y && old.a > 0.0) { col = mix(old.rgb / old.a, col, P.ext.w); }
  accum[idx] = vec4f(col, 1.0);
  moments[idx] = vec2f(RASTER_MARK, tR * bodyRadius(k));
  stamps[idx] = P.frame.x;
}

// Mars's ground drawn by the body raster (PLAN-PLANETES-AAA P7): bodyLite's pixels — the rate's pattern, its jitter —, each
// shaded as earthNear shades a hit (its air, its light, its tiles' normal and imagery, its shadows), at the raster's distance
// instead of its march (NEAR_T)
fn bodyLiteAir(gid: vec2u, k: u32) {
  let W = u32(P.res.x);
  let px = rasterPixel(gid, rasterRate(), P.frame.x);
  if (px.x >= W || px.y >= u32(P.res.y)) { return; }
  let idx = px.y * W + px.x;
  // (under the cockpit's mask: the cabin there)
  if (moments[idx].x < -0.5 && moments[idx].x > -1.5) { return; }
  let centre = vec2f(px) + 0.5;
  if (terrainRasterHint(centre) <= 0.0) { return; }
  FOOT = 1.0;
  FOOT_NEAR = 1.0;
  FOOT_FAR = 1.0;
  let pos = centre + liteJitter(px);
  var tM = terrainRasterHint(pos);
  if (tM <= 0.0) { tM = terrainRasterHint(centre); }
  let ndc = vec2f(2.0 * pos.x / P.res.x - 1.0, 1.0 - 2.0 * pos.y / P.res.y);
  let look = normalize(P.camFwd.xyz + ndc.x * P.cam.w * P.camRight.w * P.camRight.xyz + ndc.y * P.cam.w * P.camUp.xyz);
  let tR = tM / P.near4.w;
  let rnd = fract(ign(centre) + f32(P.frame.x % 1024u) * 0.6180339887);
  RND = fract(rnd * 7.31 + 0.13);
  NEAR_T = tR;
  let e = earthNear(look, rnd, k);
  NEAR_T = 0.0;
  var col = e.col;
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }
  let old = accum[idx];
  if ((P.frame.z & FLAG_TEMPORAL) != 0u && stamps[idx] >= P.frame.y && old.a > 0.0) { col = mix(old.rgb / old.a, col, P.ext.w); }
  accum[idx] = vec4f(col, 1.0);
  moments[idx] = vec2f(RASTER_MARK, tR * bodyRadius(k));
  stamps[idx] = P.frame.x;
}

@compute @workgroup_size(8, 8)
fn shadeLite(@builtin(global_invocation_id) gid: vec3u) {
  let W = u32(P.res.x);
  let H = u32(P.res.y);
  if (!rasterPrimary() || !HAS_BODIES || P.near0.w < 0.5) { return; }
  let k = u32(P.near1.w);
  // (another world than the Earth, without its air: the body raster's — bodyLite, its threads the rate's pattern's; compiled out
  // of the Earth's kernel — NEAR_KIND 1 — and the Earth's material out of the worlds' — 3)
  if (NEAR_KIND != 1u && NEAR_KIND != 2u && NEAR_KIND != 5u && NEAR_KIND != 6u && !hasAir(k) && bodyKind(k) != 0u) {
    bodyLite(gid.xy, k);
    return;
  }
  // (Mars — a world with air, not the Earth —: its body raster's ground shaded through earthNear — bodyLiteAir, P7)
  if (nearAirWorld() && !isEarth(k) && hasAir(k) && bodyKind(k) != 0u) {
    bodyLiteAir(gid.xy, k);
    return;
  }
  if (NEAR_KIND == 3u || NEAR_KIND == 7u) { return; }
  if (gid.x >= W || gid.y >= H) { return; }
  if (!isEarth(k) || !hasAir(k) || !earthOn()) { return; }
  let idx = gid.y * W + gid.x;
  // (under the cockpit's mask: the cabin there)
  if (moments[idx].x < -0.5 && moments[idx].x > -1.5) { return; }
  let centre = vec2f(gid.xy) + 0.5;
  if (!rasterLiteTakes(centre, k)) { return; }
  // (liteSkip 1024: the pass alone — its dispatch and what it takes —, a flat grey written: a measure)
  if ((liteSkip() & 1024u) != 0u) {
    accum[idx] = vec4f(0.1, 0.1, 0.1, 1.0);
    moments[idx] = vec2f(RASTER_MARK, 1e-3);
    stamps[idx] = P.frame.x;
    return;
  }
  setAir(k);
  // (the weather round the camera — its decks, haze, fog, rain: wxNear, the air's fallback march —, as the tracer's rays set it)
  WX_W = select(0.0, P.wx[0].x, HAS_WX && earthOn());
  WX_Q = normalize(nearCam());
  FOOT = 1.0;
  FOOT_NEAR = 1.0;
  FOOT_FAR = 1.0;
  // (the jittered ray of the frame — as shade's —: the temporal pass antialiases)
  let pos = centre + liteJitter(gid.xy);
  var tM = terrainRasterHint(pos);
  if (tM <= 0.0) { tM = terrainRasterHint(centre); }
  let ray = rasterRay(pos, k);
  // (a bridge's box here: its deck met before the ground — the exact test, the scenery's BVH —, the rays' kernel's pixel)
  if (HAS_SCENERY && terrainRasterBridge(centre) && sceneryDeckBefore(normalize(toBody(ray.look)), max(tM - 0.3, 0.0))) { return; }
  // (a tree the raster drew here — U2 —: met along the ray before the ground, its point the surface; missed, the ground's)
  var isTree = false;
  let treeId = terrainRasterId(centre);
  if (treeId != 0u && (liteSkip() & 64u) == 0u) {
    let tt = sceneryTreeLite(normalize(toBody(ray.look)), treeId, tM);
    if (tt > 0.0) {
      tM = tt;
      isTree = true;
    }
  }
  let ab = squashOf(k);
  let rd = ray.rd;
  let tH = tM / ray.kM;
  let ph = rasterPoint(ray, tM);
  let q = normalize(ph);
  let gq = geoQ(q);
  // (its place on the tiles from the camera's anchor — tileCoord —, near: its imagery's and slopes' reads below)
  let anchored = tM < TILE_ANCHOR_M && P.nearCam1.w > 0.5 && P.tiles.w > 0.5;
  if (anchored) { TILE_AT = tileAnchor(P.nearCam1.xyz + ray.rd * tH); }
  let hG = max(airHeight(ph) - geoidN(gq), 0.0);
  // (the light: the Sun's — its direction in the squashed space for the air's functions, physical for the surface's —, E)
  let lt = nearLight(k);
  let Ls = normalize(squashed(toBody(lt.dir), ab));
  let Lp = normalize(toBody(lt.dir));
  let E = lt.e;
  // (the pixel's footprint on the ground, its two axes — the imagery's anisotropic read)
  let fp = pixFoot() * tH;
  let fx = earthFoot(q, rd, squashed(toBody(P.camRight.xyz), ab), fp);
  let fy = earthFoot(q, rd, squashed(toBody(P.camUp.xyz), ab), fp);
  // (the colour: the day's map, the tiles' imagery over it, the regional surface, the orthophotos over all)
  let day = textureSampleGrad(earthCube, bgSamp, eCube(gq), eCube(fx), eCube(fy));
  var img: TileImage;
  IMG_LIGHTS = dot(gq, Lp) < 0.1;
  if ((liteSkip() & 128u) == 0u) {
    TILE_AT_ON = anchored;
    img = earthImageryAniso(gq, fx, fy);
    TILE_AT_ON = false;
  }
  var A = mix(day.rgb, img.c.rgb, img.w) * P.earth2.z;
  var surface = SurfaceImage(vec3f(0.0), 0.0, 0u);
  if ((liteSkip() & 8u) == 0u) { surface = surfaceImage(gq, fx, fy); }
  A = mix(A, surface.c * P.earth2.z, surface.w);
  A = mix(A, img.c.rgb * P.earth2.z, img.o);
  if (surface.w > 0.0) { A *= mix(vec3f(1.0), surfaceMaterial(gq, surface.cover, max(length(fx), length(fy)) * EARTH_RM), surface.w * (1.0 - img.o)); }
  // (the normal: the mesh's, else the ellipsoid's; a tree's its own, its colour its look)
  var n = gq;
  if ((liteSkip() & 16u) == 0u) { n = rasterNormal(centre, terrainRasterHint(centre), k); }
  if (dot(n, n) < 0.5) { n = gq; }
  if (isTree) {
    n = WS.xyz;
    A = WS_A;
  }
  let mu0 = dot(gq, Lp);
  let dirW = toBody(ray.look);
  let mesh = terrainRasterMesh(centre);
  // (near, over a survey's relief — the IGN's —: its own slopes, read in its grid at the point's anchored place; the mesh's
  // triangles are flat, their facets a metre each from a person's height, in bands)
  let fpM = fp * EARTH_RM;
  if (!mesh && !isTree && fpM < 10.0 && (liteSkip() & 16u) == 0u) {
    TILE_AT_ON = anchored;
    let sf = earthSlopeFine(gq, fpM);
    TILE_AT_ON = false;
    if (sf.z > 0.0) {
      var east = vec3f(-gq.y, gq.x, 0.0);
      east = select(normalize(east), vec3f(0.0, 1.0, 0.0), dot(east, east) < 1e-10);
      let nf = normalize(gq + sf.x * east + sf.y * cross(gq, east));
      n = normalize(mix(n, nf, sf.z * smoothstep(10.0, 4.0, fpM)));
    }
  }
  // (a runway — its paving, markings and lamps, as the tracer's ground draws them: the material's, compiled in whether a
  // runway is near or not — no other key, nothing compiled in flight —; the ground levelled under it the mesh's)
  var rwyLamps = vec3f(0.0);
  var lvl = 0.0;
  var rwyPaved = 0.0;
  var rwyAt = vec2f(0.0);
  if (!mesh && !isTree && rwyCount() > 0u) {
    let rp = runwayPave(dirW * tM, gq, q, rd, Ls, fx, fy, A, n);
    A = rp.A;
    n = rp.n;
    rwyLamps = rp.lamps;
    rwyPaved = rp.paved;
    rwyAt = rp.at;
    lvl = runwayGrade(gq).y;
  }
  // (liteSkip 4096: the Sun's and the sky's light plain — their transmittances and shadows not read: a measure)
  let plainLight = (liteSkip() & 4096u) != 0u;
  let Esun = E * sunThrough(hG, mu0);
  var Eg = E;
  if (!plainLight) { Eg = liteSun(q, gq, hG, Ls, Lp, Esun, fx, fy, dirW, tM, n, mesh); }
  // (a building's own triangles — U2 —: its roof the orthophoto's — the photograph is the roof seen from above —, its walls
  // stone, a shade a block, with their windows — floors of 3.1 m, bays of 2.6 m on the scenery's frame —, the glass dark,
  // the sky mirrored in it below)
  var glass = 0.0;
  // (a roof: the photograph's light and shade kept, its colour mostly let go — the orthophoto leans, a roof's place on it
  // the street's or a tree's beside it: zinc and slate grey, a fifth of the photograph's hue)
  if (mesh && dot(n, gq) >= 0.35) {
    let l = luminance(A);
    A = mix(vec3f(l), A, 0.2) * vec3f(0.97, 0.99, 1.04);
  }
  if (mesh && dot(n, gq) < 0.35 && HAS_SCENERY && P.scenery[0].w > 0.5) {
    let toB = mat3x3f(P.scenery[0].xyz, P.scenery[1].xyz, P.scenery[2].xyz);
    let spL = P.scenery[3].xyz + (dirW * tM) * toB;
    let nL = n * toB;
    let along = normalize(vec2f(-nL.y, nL.x) + vec2f(1e-6, 0.0));
    let block = hash31(vec3f(floor(spL.xy / 25.0), 3.0));
    A = vec3f(0.5, 0.46, 0.39) * (0.8 + 0.35 * block) * P.earth2.z;
    let fw = fract(dot(spL.xy, along) / 2.6);
    let fz = fract(spL.z / 3.1);
    glass = select(0.0, 1.0, fw > 0.28 && fw < 0.72 && fz > 0.3 && fz < 0.82);
    A = mix(A, vec3f(0.03) * P.earth2.z, glass);
  }
  // (the sky's light — on a slope, a share of it, and the ground's bounce round it — as earthGround's)
  // (the rain — PLAN-PLUIE P4, as the tracer's ground —: the ground wet, darker, a sheen of the sky on it (below); on a
  // runway's paving water lying in its hollows and the drops' rings spreading on it, near)
  var wetS = 0.0;
  var ripple = 0.0;
  if (HAS_WX && WX_W > 0.0 && P.wx[5].x > 0.0 && !isTree) {
    let wet = P.wx[5].x * WX_W;
    var pud = 0.0;
    if (rwyPaved > 0.0) {
      let pn = vnoise(vec3f(rwyAt.x * 0.08, rwyAt.y * 0.2, 3.0)) * 0.6 + vnoise(vec3f(rwyAt.x * 0.31, rwyAt.y * 0.55, 7.0)) * 0.28
        + vnoise(vec3f(rwyAt.x * 1.3, rwyAt.y * 1.7, 11.0)) * 0.12;
      pud = smoothstep(0.7 - 0.06 * min(P.wx[5].y, 1.0), 0.8 - 0.06 * min(P.wx[5].y, 1.0), pn) * rwyPaved * wet;
      let footM = max(length(fx), length(fy)) * EARTH_RM;
      let near = smoothstep(0.1, 0.02, footM) * min(P.wx[5].y, 1.0);
      if (near > 0.0) {
        let cp = rwyAt / 0.3;
        for (var dj = 0; dj < 2; dj++) {
          for (var di = 0; di < 2; di++) {
            let id = floor(cp) + vec2f(f32(di), f32(dj)) - vec2f(0.5);
            let hh = vec2f(hash31(vec3f(id, 11.0)), hash31(vec3f(id, 23.0)));
            let age = fract(P.wx[5].z * (0.9 + 0.5 * hh.x) + hh.y);
            let ctr = (id + 0.5 + 0.5 * (vec2f(hash31(vec3f(id, 5.0)), hash31(vec3f(id, 7.0))) - 0.5)) * 0.3;
            let d = length(rwyAt - ctr);
            ripple += exp(-pow((d - age * 0.11) / 0.006, 2.0)) * (1.0 - age) * (1.0 - age);
          }
        }
        ripple *= near * (0.35 + 0.65 * pud / max(wet, 1e-3));
      }
    }
    // (a roof's slate and a wall's stone darker wet too, less than the soil — their pores fewer)
    A *= mix(vec3f(1.0), vec3f(select(mix(0.58, 0.7, rwyPaved), 0.75, mesh)), wet);
    A *= 1.0 - 0.35 * pud;
    wetS = wet * select(mix(0.08, 0.3, rwyPaved), 0.12, mesh) + pud * 0.4;
  }
  var sky = E * 0.15;
  if (!plainLight) { sky = liteSky(q, hG, E, Ls, mu0); }
  // (under the weather's decks: the blue sky hidden by their cover, their own grey light instead — what comes through them,
  // and for a broken sky what their sunlit sides and bases send down —, as the tracer's ground)
  let wg = wxNear(q);
  // (the Moon's light under the decks: what they let through)
  var moonVeil = 1.0;
  if (HAS_WX && wg > 0.0) {
    let vl = wxVeil(hG, wg, 3u);
    let side = 0.5 * vl.x * (1.0 - vl.x);
    sky = sky * vl.x + (Esun * max(mu0, 0.0) * skySeen(q, Ls) + sky) * (vl.y - vl.x + side);
    moonVeil = vl.y;
  }
  // (a lightning flash — N5 —: its light on the ground for kilometres round)
  if (HAS_WX && P.wx[6].w > 0.0) {
    let f = flashAt();
    sky += FLASH_TINT * luminance(E) * 0.05 * f.w * exp(-length(q * (1.0 + hG / EARTH_RM) - f.xyz) * EARTH_RM / 10000.0);
  }
  let up = dot(n, gq);
  let bounce = (Esun * max(mu0, 0.0) + sky) * 0.18 * 0.5 * (1.0 - up);
  // (the moonlight — the tracer's ground's earthMoonlight: a moonlit landscape silvery —, through the decks)
  var G = A / PI * (Eg * max(dot(n, Lp), 0.0) + sky * 0.5 * (1.0 + up) + bounce + E * earthMoonlight(q, n, hG, mu0) * moonVeil);
  // (a tree: lit as windsockShade lights it — the Sun on its face, six tenths of the sky, not the ground's open sky and
  // bounce: they lit the crowns yellow —, its crown's underside in its own shade (the carving's occlusion, left out here),
  // the light through its thin edge against the Sun)
  if (isTree) {
    let ao = 0.5 + 0.5 * clamp(0.5 + 0.5 * dot(n, gq), 0.0, 1.0);
    let rim = 1.0 - abs(dot(n, dirW));
    G = A / PI * (Eg * max(dot(n, Lp), 0.0) * sqrt(ao) + sky * 0.6 * ao)
      + WS_T / PI * Eg * max(-dot(n, Lp), 0.0) * rim * (0.3 + 0.7 * pow(max(dot(dirW, Lp), 0.0), 4.0));
  }
  if (glass > 0.0) {
    let F = 0.04 + 0.96 * pow(1.0 - clamp(abs(dot(n, dirW)), 0.0, 1.0), 5.0);
    G += glass * F * sky * 1.5 / PI;
  }
  // (the wet ground's sheen: the sky mirrored by the water on it, by Fresnel — a wet runway seen ahead silvery —, the rings
  // breaking it)
  if (wetS > 0.0) {
    let cv = clamp(dot(n, -dirW), 0.0, 1.0);
    let F = (0.02 + 0.98 * pow(1.0 - cv, 5.0)) * wetS;
    G = G * (1.0 - F) + F * sky * 1.1 / PI * (1.0 + 2.5 * ripple);
    G += ripple * 0.35 * sky / PI;
  }
  // (the cities' lights at night)
  let lights = mix(textureSampleGrad(earthNight, bgSamp, eCube(gq), eCube(fx), eCube(fy)).r, img.c.a, img.w);
  let lamp = max(lights - 0.07, 0.0) / 0.93;
  let dark = 1.0 - smoothstep(-0.12, 0.06, mu0);
  G += mix(vec3f(1.0, 0.55, 0.22), vec3f(1.0, 0.85, 0.6), lamp) * (pow(lamp, 1.4) * P.earth.z * dark * luminance(E) / PI);
  G += rwyLamps * (luminance(E) / PI) * mix(mix(0.6, 8.0, P.runways[17].y), 3000.0, dark);
  // (the water — the sea, the lakes and rivers —: found here — its cover sharp, the polygon's edge alone softened; the sea's
  // mask the relief map's over the sea's level, OSM's by the coasts —, drawn by shadeWater: this pixel's surface under it left
  // to it in accum, its kind and cover in moments.x)
  if (!mesh && !isTree && (liteSkip() & 1u) == 0u) {
    let rel0 = earthRelief(gq, fx, fy);
    var sea0 = smoothstep(0.35, 0.65, rel0.b) * (1.0 - smoothstep(0.5, 2.0, hG));
    // (the sea the relief map's coarse mask misses — its texels of kilometres call the sea by a coast land: the water there shaded
    // as ground, black, a staircase across a gulf —: a surface at the sea's level over a bottom the fine bathymetry finds deeper
    // than ~10 m — seaDepthAt, the windows z 10…8 —; a polder, a marsh at the sea's level, a few metres under it: land)
    if (sea0 < 0.99 && hG < 0.3) {
      let dz = seaDepthAt(gq, max(length(fx), length(fy)) * EARTH_RM);
      sea0 = max(sea0, smoothstep(6.0, 12.0, dz.x) * smoothstep(0.0, 0.25, dz.y) * (1.0 - smoothstep(0.1, 0.3, hG)));
    }
    var osm = vec2f(0.0);
    if (HAS_SCENERY && P.scenery[0].w > 0.5 && P.scenery[2].w > 0.5) {
      let toW = mat3x3f(P.scenery[0].xyz, P.scenery[1].xyz, P.scenery[2].xyz);
      osm = sceneryWaterAt(P.scenery[3].xyz + (dirW * tM) * toW, max(length(fx), length(fy)) * EARTH_RM, tM);
      osm.x = smoothstep(0.35, 0.65, osm.x);
    }
    // (an airfield levelled: land, even where the maps had water)
    let water = max(sea0, osm.x) * (1.0 - lvl);
    let calm = osm.x * (1.0 - sea0) * osm.y;
    let kind = select(0.0, select(1.0, 2.0, osm.y > 0.8), calm > 0.0);
    // (TUNE_LITE 512: the water's cover drawn by its kind — red the sea, green a river, blue a lake: a measure)
    if ((liteSkip() & 512u) != 0u) {
      let kc = select(select(vec3f(0.5, 0.0, 0.0), vec3f(0.0, 0.5, 0.0), kind > 0.5), vec3f(0.0, 0.0, 0.6), kind > 1.5);
      G = mix(G, kc * luminance(E), water);
    } else if (water > 0.0 && rasterWaterOn()) {
      accum[idx] = vec4f(G, 1.0);
      moments[idx] = vec2f(RASTER_WATER - kind - 0.25 * water, tM / EARTH_RM * bodyRadius(k));
      stamps[idx] = P.frame.x;
      return;
    }
  }
  if ((liteSkip() & 8192u) != 0u) { G = liteShadowDebug(E); }
  liteFinish(idx, centre, pos, G, rd, tH, tM, Ls, E, k, true);
}

// The image while the scene's tracer compiles (renderer.skyFillOn — its main: two minutes on a Windows PC, the driver's
// compile and DXC's, every launch): the raster's ground by shadeLite as in flight, every other pixel here — the clear air
// along the ray (earthAir, as the ground's), over the day map's Earth where the ray meets it past the rings, the Sun's disc,
// the cloud pass's clouds before them —; no Moon, planets or stars until main lands. A few dozen lines of the tracer's,
// compiled in seconds: the first image no longer waits for the largest kernel.
@compute @workgroup_size(8, 8)
fn skyFill(@builtin(global_invocation_id) gid: vec3u) {
  let W = u32(P.res.x);
  let H = u32(P.res.y);
  if (gid.x >= W || gid.y >= H || !HAS_BODIES || P.near0.w < 0.5) { return; }
  let k = u32(P.near1.w);
  if (!isEarth(k) || !hasAir(k) || !earthOn()) { return; }
  let idx = gid.y * W + gid.x;
  // (under the cockpit's mask: the cabin there)
  if (moments[idx].x < -0.5 && moments[idx].x > -1.5) { return; }
  let centre = vec2f(gid.xy) + 0.5;
  // (the material's pixel: shadeLite's)
  if (rasterPrimary() && rasterLiteTakes(centre, k)) { return; }
  setAir(k);
  let ray = rasterRay(centre, k);
  let ro = nearCam();
  let rd = ray.rd;
  let lt = nearLight(k);
  let Ls = normalize(squashed(toBody(lt.dir), squashOf(k)));
  // (the ground past the rings: the squashed space's unit sphere, its day map lit by the Sun)
  let b = dot(ro, rd);
  let dq = b * b - dot(ro, ro) + 1.0;
  var tEnd = 3e38;
  var G = vec3f(0.0);
  var depth = 1e9;
  if (dq > 0.0 && -b - sqrt(dq) > 0.0) {
    tEnd = -b - sqrt(dq);
    let gq = geoQ(normalize(ro + rd * tEnd));
    let A = textureSampleLevel(earthCube, bgSamp, eCube(gq), 0.0).rgb * P.earth2.z;
    G = A / PI * lt.e * max(dot(gq, normalize(toBody(lt.dir))), 0.0);
    depth = tEnd * ray.kM / EARTH_RM * bodyRadius(k);
  }
  // (the Sun's disc in the open sky — its pixel's share, the rim antialiased: its light through the air, the clouds before it)
  let li = u32(max(i32(bodies[BV * k + 3u].x), 0));
  if (tEnd > 1e37 && li != k) {
    let sunR = bodyRadius(li) / max(length(bodies[BV * li].xyz - bodies[BV * k].xyz), 1e-30);
    let ang = acos(clamp(dot(normalize(ray.look), normalize(lt.dir)), -1.0, 1.0));
    let cov = clamp((sunR - ang) / max(P.camUp.w, 1e-6) + 0.5, 0.0, 1.0);
    G = lt.e * (cov / (PI * sunR * sunR));
  }
  // (the clouds of the cloud pass — compiled before main with the material —, over the air as liteFinish lays them)
  let cs = cloudsBuffered(centre, terrainRasterDepth(centre));
  let alpha = max(cs.alpha, 0.0);
  let air = earthAir(ro, rd, tEnd, Ls, lt.e, ign(centre), select(3e38, cs.tc, alpha > 0.0));
  // (the Sun's disc through the clouds' direct transmittance — earthLookCompose's —, the ground's through their cover)
  let tG = select(cloudsDirectT(alpha), 1.0 - alpha, tEnd < 1e37);
  var col = (1.0 - alpha) * air.L + tG * air.T * G + alpha * (air.Lc + air.Tc * cs.cl);
  if (isNan(col.r + col.g + col.b)) { col = vec3f(0.0); }
  accum[idx] = vec4f(col, 1.0);
  moments[idx] = vec2f(0.0, select(depth, cs.tc / EARTH_RM * bodyRadius(k), alpha > 0.5));
  stamps[idx] = P.frame.x;
}

// The water of the raster's ground (renderer.rasterWater — TERRE-UNREAL U2d): the pixels shadeLite left it, their surface
// under the water in accum. The sea by seaShade — the tracer's own water: its waves (the resolved trains, the FFT's
// cascades near), Cox–Munk's glint, the mirror averaged over the unresolved slopes, the world mirrored in it near (seaSSR),
// the far clouds, the shallow bed, the foam and the surf —; a river or a lake by inlandWater, their own style; a cascade's
// white water where the inland water's ground is steep. Then the air and the clouds, as shadeLite's.
@compute @workgroup_size(8, 8)
fn shadeWater(@builtin(global_invocation_id) gid: vec3u) {
  let W = u32(P.res.x);
  let H = u32(P.res.y);
  if (gid.x >= W || gid.y >= H || !rasterPrimary() || !HAS_BODIES || P.near0.w < 0.5) { return; }
  let idx = gid.y * W + gid.x;
  let mk = moments[idx].x;
  if (!(mk <= RASTER_WATER && mk > RASTER_WATER - 3.0)) { return; }
  let k = u32(P.near1.w);
  setAir(k);
  WX_W = select(0.0, P.wx[0].x, HAS_WX && earthOn());
  WX_Q = normalize(nearCam());
  FOOT = 1.0;
  FOOT_NEAR = 1.0;
  FOOT_FAR = 1.0;
  let code = RASTER_WATER - mk;
  let kind = floor(code + 1e-4);
  let water = clamp((code - kind) * 4.0, 0.0, 1.0);
  let calm = select(0.0, select(0.6, 0.92, kind > 1.5), kind > 0.5);
  let centre = vec2f(gid.xy) + 0.5;
  let pos = centre + liteJitter(gid.xy);
  var tM = terrainRasterHint(pos);
  if (tM <= 0.0) { tM = terrainRasterHint(centre); }
  let ray = rasterRay(pos, k);
  let ab = squashOf(k);
  let rd = ray.rd;
  let tH = tM / ray.kM;
  let ph = rasterPoint(ray, tM);
  let q = normalize(ph);
  let gq = geoQ(q);
  let hG = max(airHeight(ph) - geoidN(gq), 0.0);
  let lt = nearLight(k);
  let Ls = normalize(squashed(toBody(lt.dir), ab));
  let Lp = normalize(toBody(lt.dir));
  let E = lt.e;
  let fp = pixFoot() * tH;
  let fx = earthFoot(q, rd, squashed(toBody(P.camRight.xyz), ab), fp);
  let fy = earthFoot(q, rd, squashed(toBody(P.camUp.xyz), ab), fp);
  var n = rasterNormal(centre, terrainRasterHint(centre), k);
  if (dot(n, n) < 0.5) { n = gq; }
  let dirW = toBody(ray.look);
  let Eg = liteSun(q, gq, hG, Ls, Lp, E * sunThrough(hG, dot(gq, Lp)), fx, fy, dirW, tM, n, false);
  let sky = liteSky(q, hG, E, Ls, dot(gq, Lp));
  var G = accum[idx].rgb;
  let footSea = sqrt(length(fx) * length(fy)) * EARTH_RM;
  SEA_ON = P.sea[1].w > 0.0;
  SEA_D = dirW * tM;
  let dw = select(seaDepthAt(gq, footSea), vec2f(1e4, 0.0), calm > 0.0);
  SEA_DEPTH = dw.x;
  SEA_DEPTH_W = dw.y;
  RND = fract(ign(centre) + f32(P.frame.x % 1024u) * 0.6180339887);
  RASTER_SHADE = true;
  // (the sea's style, or the inland water's — a river's, a lake's: not the sea's calmed)
  var wcol: vec3f;
  if (calm > 0.0) { wcol = inlandWater(q, -rd, Ls, Eg, sky, footSea, kind > 1.5); }
  else {
    wcol = seaShade(q, -rd, Ls, Eg, sky, G, footSea, 0.0, vec4f(0.0));
    // (the sea drawn this frame: its stamp in the stamps' last word — renderer seaSeenStamp: the FFT's waves only while
    // some sea is in view, TERRE-UNREAL U6)
    stamps[arrayLength(&stamps) - 1u] = P.frame.x;
  }
  G = mix(G, wcol, water);
  if ((liteSkip() & 8192u) != 0u) { G = liteShadowDebug(E); }
  RASTER_SHADE = false;
  SEA_ON = false;
  // (falling water — a cascade, a rapid — on the inland water alone (the sea does not fall): where its ground falls steeply —
  // the relief's own heights over ±25 m or two footprints, smooth: the mesh's facets' normals drew white triangles over a gorge
  // and its banks, and over ±8 m the relief's noise under a river — SRTM's, its voids — streaked a river white —, white water, aerated, in streaks drawn down the slope and running down it with the clock, lit as foam;
  // the flat water's look gone with the steepness)
  if (calm > 0.0 && HAS_SCENERY && P.scenery[0].w > 0.5) {
    var east = vec3f(-q.y, q.x, 0.0);
    east = select(normalize(east), vec3f(0.0, 1.0, 0.0), dot(east, east) < 1e-12);
    let north = cross(q, east);
    let ds = max(25.0, 2.0 * footSea);
    let e = ds / EARTH_RM;
    let gE = (earthHeightStep(normalize(q + east * e), ds) - earthHeightStep(normalize(q - east * e), ds)) / (2.0 * ds);
    let gN = (earthHeightStep(normalize(q + north * e), ds) - earthHeightStep(normalize(q - north * e), ds)) / (2.0 * ds);
    let slope = length(vec2f(gE, gN));
    // (from ~17° to ~39° over the ±25 m: the relief's 30 m grid softens a fall's cliff — Niagara's 51 m to a slope of ~0.6)
    var steep = smoothstep(0.3, 0.8, slope) * water;
    let toF = mat3x3f(P.scenery[0].xyz, P.scenery[1].xyz, P.scenery[2].xyz);
    let pL = P.scenery[3].xyz + (dirW * tM) * toF;
    let downW = -(gE * east + gN * north);
    let dL = normalize((downW * toF).xy + vec2f(1e-6, 0.0));
    // (a fall has water above it and below it; a steep bank, land on its upper side — the river's outline over its banks, the
    // relief at 30 m softening them, made their slopes white: the water looked for a few metres up and down the slope)
    if (steep > 0.0) {
      let reach = max(12.0, 3.0 * footSea);
      let above = sceneryWaterAt(vec3f(pL.xy - dL * reach, pL.z), footSea, tM).x;
      let below = sceneryWaterAt(vec3f(pL.xy + dL * reach, pL.z), footSea, tM).x;
      steep *= smoothstep(0.3, 0.8, min(above, below));
    }
    if (steep > 0.0) {
      let along = dot(pL.xy, dL) - pL.z * 0.6;
      let across = dot(pL.xy, vec2f(-dL.y, dL.x));
      let tclock = P.time.x * P.near5.w;
      let streak = 0.5 + 0.5 * (0.65 * gnoise(vec3f(across * 0.9, along * 0.12 - tclock * 2.5, 1.7))
        + 0.35 * gnoise(vec3f(across * 2.7, along * 0.4 - tclock * 4.0, 5.3)));
      let nF = normalize(gq - (gE * east + gN * north));
      let white = 0.72 / PI * (Eg * max(dot(nF, Lp), 0.0) + sky) * (0.75 + 0.35 * streak);
      G = mix(G, white, steep * clamp(0.45 + 0.75 * streak, 0.0, 1.0));
    }
  }
  liteFinish(idx, centre, pos, G, rd, tH, tM, Ls, E, k, false);
}

// The cloud pass (docs/PLAN-NUAGES-AAA.md N1): the clouds along each camera ray marched once a texel of half the image's
// size — a 2 × 2 block of pixels —, before the nearest surface among the block's (the raster's visibility, b), else before
// the ellipsoid: their cover and light (cloudOutA), the nearest's distance along the ray, the bound [m] (−1: the sky) and
// the nearest's depth [M] (cloudOutB). The raster's frames only; shade and main read it back (cloudsBuffered), weighted by the bounds' likeness.
@group(1) @binding(11) var cloudOutA: texture_storage_2d<rgba32float, write>;
@group(1) @binding(12) var cloudOutB: texture_storage_2d<rgba32float, write>;
@compute @workgroup_size(8, 8)
fn clouds(@builtin(global_invocation_id) gid: vec3u) {
  let W = u32(P.res.x);
  let H = u32(P.res.y);
  if (gid.x >= (W + 1u) / 2u || gid.y >= (H + 1u) / 2u) { return; }
  var cs = EarthClouds(0.0, vec3f(0.0), -1.0);
  var bound = -1.0;
  var depthM = -1.0;
  if (HAS_BODIES && P.near0.w > 0.5) {
    let k = u32(P.near1.w);
    if (isEarth(k) && hasAir(k) && earthOn()) {
      let p0 = vec2f(gid.xy * 2u);
      var dmin = 3e38;
      for (var j = 0u; j < 4u; j++) {
        let d = terrainRasterDepth(p0 + vec2f(f32(j & 1u), f32(j >> 1u)) + 0.5);
        if (d > 0.0) { dmin = min(dmin, d); }
      }
      // (a texel's footprint: two pixels)
      FOOT_NEAR = 2.0;
      FOOT_FAR = 2.0;
      FOOT = 2.0;
      let frameStamp = P.frame.x;
      let pos = p0 + 1.0 + gaussJitter(hash4(vec3u(gid.xy, frameStamp)).xy);
      let ndc = vec2f(2.0 * pos.x / P.res.x - 1.0, 1.0 - 2.0 * pos.y / P.res.y);
      let look = normalize(P.camFwd.xyz + ndc.x * P.cam.w * P.camRight.w * P.camRight.xyz + ndc.y * P.cam.w * P.camUp.xyz);
      setAir(k);
      let ab = squashOf(k);
      let ro = nearCam();
      let rs = squashed(toBody(look), ab);
      let m = length(rs);
      let rd = rs / m;
      var tHit = unitHit(ro, rd);
      if (dmin < 3e38) {
        tHit = dmin * m / P.near4.w;
        bound = dmin;
      }
      let lt = nearLight(k);
      WX_W = select(0.0, P.wx[0].x, HAS_WX && earthOn());
      WX_Q = normalize(ro);
      let rnd = fract(ign(vec2f(gid.xy)) + f32(frameStamp % 1024u) * 0.6180339887);
      RND = fract(rnd * 7.31 + 0.13);
      CLOUD_LIGHT_MARCH = TUNE_CLOUD_LIGHT > 0u;
      cs = earthClouds(k, ro, rd, tHit, normalize(squashed(toBody(lt.dir), ab)), lt.e, squashed(toBody(P.camRight.xyz), ab),
        squashed(toBody(P.camUp.xyz), ab), 0.0, pixFoot(), fract(rnd * 7.31 + 0.37), P.earth4.w > 0.5);
      CLOUD_LIGHT_MARCH = false;
      WX_W = 0.0;
      // (the cloud's distance as the image's depths have it [M] — the history's reprojection, post.wgsl cloudTemporal)
      if (cs.tc > 0.0) { depthM = cs.tc / m * bodyRadius(k); }
    }
  }
  // (no light where there is no cover, nor a non-finite one: the history premultiplies it — post.wgsl cloudTemporal)
  let clOk = cs.alpha > 0.0 && !isNan(cs.cl.r + cs.cl.g + cs.cl.b) && all(abs(cs.cl) < vec3f(1e30));
  textureStore(cloudOutA, gid.xy, vec4f(select(vec3f(0.0), cs.cl, clOk), select(0.0, cs.alpha, cs.alpha > 0.0)));
  textureStore(cloudOutB, gid.xy, vec4f(cs.tc, bound, depthM, 0.0));
}

// The clear sky's light (docs/PLAN-NUAGES-AAA.md N2b, read by skyIrradiance: the ground, the scenery, the clouds): at four
// heights over the sea round the camera's place (a workgroup each: 0, 2, 5 and 10 km), the sky's radiance from the air's own
// model (earthAir — the weather's decks left out: their light is their own) along 64 directions of the hemisphere (a
// thread each, a Fibonacci spiral), projected on the second-order spherical harmonics; written with its frame (the place's
// up, east, north) into skyOut, copied into the tracer's table (renderer: TABLE_SKY).
// (a 40 × 1 texture, not a buffer: the tracer's layout already binds every storage buffer a stage may have)
@group(1) @binding(13) var skyOut: texture_storage_2d<rgba32float, write>;
var<workgroup> skyAcc: array<array<vec3f, 9>, 64>;
@compute @workgroup_size(64)
fn skyAmbient(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let hs = vec4f(0.0, 2000.0, 5000.0, 10000.0);
  // (the fifth workgroup: the sea level's radiance on an 8 × 8 grid — skyMirror —, a texel a thread)
  let grid = wid.x == 4u;
  let lv = min(wid.x, 3u);
  var Lg = vec3f(0.0);
  var on = false;
  var c = array<vec3f, 9>();
  var up = vec3f(0.0, 0.0, 1.0);
  var east = vec3f(1.0, 0.0, 0.0);
  var north = vec3f(0.0, 1.0, 0.0);
  var mu0c = 1.0;
  var skc = 1.0;
  if (HAS_BODIES && P.near0.w > 0.5) {
    let k = u32(P.near1.w);
    if (isEarth(k) && hasAir(k) && earthOn()) {
      on = true;
      setAir(k);
      let ab = squashOf(k);
      up = normalize(nearCam());
      east = normalize(cross(vec3f(0.0, 0.0, 1.0), up));
      if (length(cross(vec3f(0.0, 0.0, 1.0), up)) < 1e-4) { east = vec3f(1.0, 0.0, 0.0); }
      north = cross(up, east);
      let lt = nearLight(k);
      let Ls = normalize(squashed(toBody(lt.dir), ab));
      mu0c = dot(up, Ls);
      skc = skySeen(up, Ls);
      // (the direction: z up, the spiral over the hemisphere — equal solid angles)
      var z = (f32(li) + 0.5) / 64.0;
      var ph = f32(li) * 2.399963;
      if (grid) {
        z = (f32(li / 8u) + 0.5) / 8.0;
        z *= z;
        ph = f32(li % 8u) * (TAU / 8.0);
      }
      let rr = sqrt(max(1.0 - z * z, 0.0));
      let dl = vec3f(rr * cos(ph), rr * sin(ph), z);
      let rd = normalize(east * dl.x + north * dl.y + up * dl.z);
      let p = up * (1.0 + select(hs[lv], 0.0, grid) / EARTH_RM);
      WX_W = 0.0;
      AIR_NO_CSM = true;
      let L = earthAir(p, rd, 3e38, Ls, lt.e, 0.5, 3e38).L;
      Lg = L;
      let y = array<f32, 9>(0.282095, 0.488603 * dl.y, 0.488603 * dl.z, 0.488603 * dl.x, 1.092548 * dl.x * dl.y,
        1.092548 * dl.y * dl.z, 0.315392 * (3.0 * dl.z * dl.z - 1.0), 1.092548 * dl.x * dl.z, 0.546274 * (dl.x * dl.x - dl.y * dl.y));
      for (var i = 0u; i < 9u; i++) { c[i] = L * y[i] * (2.0 * PI / 64.0); }
    }
  }
  if (grid) {
    textureStore(skyOut, vec2i(i32(40u + li), 0), vec4f(Lg, 0.0));
    return;
  }
  for (var i = 0u; i < 9u; i++) { skyAcc[li][i] = c[i]; }
  workgroupBarrier();
  if (li == 0u) {
    for (var i = 0u; i < 9u; i++) {
      var sum = vec3f(0.0);
      for (var j = 0u; j < 64u; j++) { sum += skyAcc[j][i]; }
      textureStore(skyOut, vec2i(i32(4u + lv * 9u + i), 0), vec4f(sum, 0.0));
    }
    if (lv == 0u) {
      // (w: the Sun's height's cosine and the eclipse's share of the sky at the place — skyFlat carries the light to other
      // places by theirs)
      textureStore(skyOut, vec2i(0, 0), vec4f(up, select(0.0, 1.0, on)));
      textureStore(skyOut, vec2i(1, 0), vec4f(east, mu0c));
      textureStore(skyOut, vec2i(2, 0), vec4f(north, skc));
      textureStore(skyOut, vec2i(3, 0), hs);
    }
  }
}

// The clouds' extinction at a point p of the squashed space [1/m] (docs/PLAN-NUAGES-AAA.md N3: their shadows' one source):
// the map's layer as its volume shapes it (cloudVolume's — its cover at the level lod, without the fine noise: a shadow map's
// texel is hundreds of metres), scaled by the clouds' opacity setting; the weather's layers (wxDensity, cheap).
fn cloudSigmaAt(p: vec3f, lod: f32) -> f32 {
  let r = length(p);
  let q = p / r;
  var sigma = 0.0;
  let hb = 1500.0 / EARTH_RM;
  let ht = 4500.0 / EARTH_RM;
  let hn = (r - 1.0 - hb) / (ht - hb);
  if (hn > 0.0 && hn < 1.0 && P.earth2.y > 0.0) {
    let a = cloudCoverAt(q, lod) * (1.0 - wxNear(q));
    if (a > 0.01) {
      let x = rotZ(q, P.earth.y) * (EARTH_RM / 2600.0) + vec3f(0.0, 0.0, hn * 2.0);
      let sh = 0.6 * dnoise(x) + 0.3 * dnoise(x * 2.3 + vec3f(5.1));
      let top = (0.15 + 0.85 * a) * (0.7 + 0.6 * sh);
      let hp = smoothstep(0.0, 0.05 + 0.12 * sh, hn) * (1.0 - smoothstep(0.45 * top, top, hn));
      let rho = hp * clamp(1.6 * (a * (0.4 + sh) - 0.2), 0.0, 1.0);
      sigma += P.earth2.y * rho * 25.0 / ((ht - hb) * EARTH_RM * max(top, 0.2));
    }
  }
  if (HAS_WX && WX_W > 0.0) {
    for (var i = 0u; i < 3u; i++) {
      if (P.wx[1u + i].z > 0.0) { sigma += wxDensity(p, i, true).x; }
    }
  }
  return sigma;
}

// The clouds' transmittance map seen from the Sun (N3 — a "Beer shadow map", Frostbite: Hillaire 2016): an orthographic
// view along the sunlight, ±CSM half-width round the ground under the camera (its centre snapped to the texels: no
// shimmer as it moves), a texel a ray from the Sun through the cloud shell (300 m – 13 km) to the ground, 40 steps: the depth
// along the light where the clouds begin (z: towards the Sun, from the plane through the centre [m]), their mean extinction
// over their depth, their whole optical depth — a point's sunlight exp(−min(τ, σ̄ (z_front − z))). Its frame — the centre,
// right, up, towards the Sun, the half-width — into csmHead, copied into the tracer's table (renderer: TABLE_CSM).
@group(1) @binding(14) var csmOut: texture_storage_2d<rgba32float, write>;
@group(1) @binding(15) var csmHead: texture_storage_2d<rgba32float, write>;
override CSM_HALF_M: f32 = 40000.0;
@compute @workgroup_size(8, 8)
fn cloudShadow(@builtin(global_invocation_id) gid: vec3u) {
  let n = textureDimensions(csmOut);
  if (gid.x >= n.x || gid.y >= n.y) { return; }
  var on = false;
  var C = vec3f(0.0, 0.0, 1.0);
  var right = vec3f(1.0, 0.0, 0.0);
  var upP = vec3f(0.0, 1.0, 0.0);
  var toward = vec3f(0.0, 0.0, 1.0);
  let half = CSM_HALF_M / EARTH_RM;
  var outv = vec4f(0.0, 0.0, 0.0, 0.0);
  if (HAS_BODIES && P.near0.w > 0.5) {
    let k = u32(P.near1.w);
    let cam = nearCam();
    // (under 25 km over the ellipsoid — the squashed space's unit sphere, its radial metres to the normal's: earthSq)
    if (isEarth(k) && earthOn() && (length(cam) - 1.0) * EARTH_RM * earthSq(normalize(cam)) < 25000.0) {
      let lt = nearLight(k);
      toward = normalize(squashed(toBody(lt.dir), squashOf(k)));
      let up = normalize(cam);
      if (dot(up, toward) > -0.05) {
        on = true;
        setAir(k);
        WX_W = select(0.0, P.wx[0].x, HAS_WX);
        WX_Q = up;
        right = normalize(cross(toward, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(toward.z) > 0.9)));
        upP = cross(right, toward);
        // (the centre: the ground under the camera, snapped to the map's texels in its plane)
        let texel = 2.0 * half / f32(n.x);
        let cx = dot(up, right);
        let cy = dot(up, upP);
        C = up + right * (round(cx / texel) * texel - cx) + upP * (round(cy / texel) * texel - cy);
        C -= toward * dot(C - up, toward);
        let x = (2.0 * (f32(gid.x) + 0.5) / f32(n.x) - 1.0) * half;
        let y = (1.0 - 2.0 * (f32(gid.y) + 0.5) / f32(n.y)) * half;
        let O = C + right * x + upP * y;
        // (the line O + toward s through the shell: from the top's sphere on the Sun's side down to the ground's or the
        // top's far side)
        let rTop = 1.0 + 13000.0 / EARTH_RM;
        let rBot = 1.0 + 300.0 / EARTH_RM;
        let b = dot(O, toward);
        let c2 = dot(O, O);
        let dT = b * b - (c2 - rTop * rTop);
        if (dT > 0.0) {
          let s1 = -b + sqrt(dT);
          var s0 = -b - sqrt(dT);
          let dB = b * b - (c2 - rBot * rBot);
          if (dB > 0.0) { s0 = max(s0, -b + sqrt(dB)); }
          if (s1 > s0) {
            let lod = max(log2(texel * EARTH_RM / (EARTH_RM * 1.5707963 / f32(textureDimensions(earthCube).x))), 0.0);
            let N = 40u;
            let ds = (s1 - s0) / f32(N);
            let dsM = ds * EARTH_RM;
            var od = 0.0;
            var zF = -1e9;
            var zB = 0.0;
            for (var i = 0u; i < N; i++) {
              let sm = s1 - (f32(i) + 0.5) * ds;
              let sg = cloudSigmaAt(O + toward * sm, lod);
              if (sg > 1e-6) {
                if (zF < -1e8) { zF = (sm + 0.5 * ds) * EARTH_RM; }
                zB = (sm - 0.5 * ds) * EARTH_RM;
                od += sg * dsM;
              }
            }
            if (od > 1e-3) { outv = vec4f(zF, od / max(zF - zB, dsM), od, 1.0); }
          }
        }
        WX_W = 0.0;
      }
    }
  }
  textureStore(csmOut, vec2i(gid.xy), outv);
  if (gid.x == 0u && gid.y == 0u) {
    textureStore(csmHead, vec2i(0, 0), vec4f(C, half));
    textureStore(csmHead, vec2i(1, 0), vec4f(right, 0.0));
    textureStore(csmHead, vec2i(2, 0), vec4f(upP, 0.0));
    textureStore(csmHead, vec2i(3, 0), vec4f(toward, select(0.0, 1.0, on)));
  }
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
    if (alt > earthTop()) { return 1.0; }
    let g = earthHeightStep(c / rc, 2.0) - alt;
    let bias = select(0.0, g, abs(g) < 50.0);
    var t = 20.0;
    var sh = 1.0;
    for (var i = 0; i < 48; i++) {
      let x = c + L * (t / EARTH_RM);
      let r = length(x);
      let hr = (r - 1.0) * EARTH_RM;
      if (hr > earthTop()) { break; }
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
  // Spherical worlds keep their camera-rest-frame coverage (including its aberration).
  let c = P.near0.xyz;
  let dc = length(c);
  let rb = asin(clamp(1.0 / dc, 0.0, 1.0));
  let sep = acos(clamp(dot(L, c / dc), -1.0, 1.0));
  let x = clamp((sep - rb) / rs, -1.0, 1.0);
  var E = lt.e * (0.5 + (x * sqrt(1.0 - x * x) + asin(x)) / PI);
  // Earth's physical geometry is independent of material availability and GPU map quality.
  if (isEarth(kn)) {
    let physicalCamera = vec3f(nearCam().xy, nearCam().z / EARTH_AB);
    E = lt.e * figureSunShare(physicalCamera, toBody(L), rs, EARTH_AB);
  }
  if (hasAir(kn)) {
    setAir(kn);
    let rd = normalize(squashed(toBody(L), squashOf(kn)));
    let g1 = normalize(cross(rd, select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(rd.z) > 0.9)));
    // (N3: the clouds between the craft and the Sun from their map — every layer, the weather's too —, the air's own
    // dimming from the look along the ray with no cloud — CLOUDS_BUFFERED: none —; the map's shell beyond it)
    let csT = select(-1.0, cloudShadowAt(nearCam()), isEarth(kn) && (TUNE_GSKIP & 8192u) == 0u);
    if (csT >= 0.0) { CLOUDS_BUFFERED = EarthClouds(0.0, vec3f(0.0), -1.0); }
    let e = earthLookNoGround(kn, nearCam(), rd, rd, lt.e, g1, cross(rd, g1), 0.0, rs, 0.5, false);
    CLOUDS_BUFFERED = EarthClouds(-1.0, vec3f(0.0), -1.0);
    E *= e.T * select(1.0, csT, csT >= 0.0);
    // (the Moon's shadow — a solar eclipse —: the Sun's share it leaves where the craft is; in totality none —
    // the hull lit by the dark sky's light alone)
    if (isEarth(kn) && P.eclipse.w > 0.0) { E *= sunSeen(nearCam(), rd); }
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

// The catalogue's stars over the raster's sky (renderer: mouthList[1].y + 512 — TERRE-UNREAL U8): a thread a star of the
// 119 614 — HYG/Hipparcos, realSky's catalogue —, each where it shows on the image: its ICRS direction to the camera's axes by
// the renderer's matrix (stamps' words past the image: main.ts starMatrix — the frame's camera, the aberration), raised by the
// Earth's refraction (airBend inverted: the same bending as the rays'), hidden by the raster's ground, its trees, its
// buildings, dimmed by the air to space along it and by the cloud pass's clouds at its pixel; its flux realSky's — a
// blackbody at its B−V temperature —, splatted as splatStar does it (its radiance F / Ω over a 3 × 3 Gaussian, normalized). One
// a frame each, at its own place: neither caught nor missed by a block's ray — no flicker —, nor spread over a block's footprint.
const RASTER_STARS_FLAG = 512u;
fn rasterStarsOn() -> bool { return (u32(P.mouthList[1].y + 0.5) & RASTER_STARS_FLAG) != 0u; }
// the stamps' words of the stars' matrix (renderer: after the discs' rectangles), its three columns
const STARS_WORDS = 16u;
fn starColumn(j: u32) -> vec3f {
  let b = u32(P.res.x) * u32(P.res.y) + STARS_WORDS + 4u * j;
  return vec3f(bitcast<f32>(stamps[b]), bitcast<f32>(stamps[b + 1u]), bitcast<f32>(stamps[b + 2u]));
}
@compute @workgroup_size(64)
fn shadeStars(@builtin(global_invocation_id) gid: vec3u, @builtin(num_workgroups) nw: vec3u) {
  if (!HAS_BODIES || P.near0.w < 0.5) { return; }
  let i = gid.x + gid.y * nw.x * 64u;
  let grid = max(catalogue[1], 1u);
  if (i >= catalogue[4u + 6u * grid * grid]) { return; }
  let k = u32(P.near1.w);
  if (!isEarth(k) || !earthOn()) { return; }
  setAir(k);
  let b = 4u + 6u * grid * grid + 1u + 4u * i;
  let sd = vec3f(bitcast<f32>(catalogue[b]), bitcast<f32>(catalogue[b + 1u]), bitcast<f32>(catalogue[b + 2u]));
  // (on the camera's axes: right, up, forward)
  let c = sd.x * starColumn(0u) + sd.y * starColumn(1u) + sd.z * starColumn(2u);
  let tanH = P.cam.w;
  let asp = P.camRight.w;
  // (out of the field — the refraction's 0.03 rad at most round it —: not drawn)
  if (c.z <= 0.0 || abs(c.x / c.z) > tanH * asp * 1.05 + 0.04 || abs(c.y / c.z) > tanH * 1.05 + 0.04) { return; }
  let mt = unpack2x16float(catalogue[b + 3u]);
  let F = blackbodyShifted(mt.y * 1000.0, 1.0) * (exp2(-1.3287712 * mt.x) * P.skyX.w * 0.5);
  // (where it shows: the true look bent back by the refraction — the apparent a with airBend(a) = t, a few fixed-point steps)
  let t = normalize(c.x * P.camRight.xyz + c.y * P.camUp.xyz + c.z * P.camFwd.xyz);
  var a = t;
  if (P.sky.x > 0.0) {
    for (var it = 0; it < 3; it++) { a = normalize(a + (t - airBend(a))); }
  }
  let f = dot(a, P.camFwd.xyz);
  if (f <= 0.0) { return; }
  let p = vec2f((0.5 + 0.5 * dot(a, P.camRight.xyz) / f / (tanH * asp)) * P.res.x, (0.5 - 0.5 * dot(a, P.camUp.xyz) / f / tanH) * P.res.y);
  let W = i32(P.res.x);
  let H = i32(P.res.y);
  let p0 = vec2i(floor(p));
  if (p0.x < 0 || p0.y < 0 || p0.x >= W || p0.y >= H) { return; }
  let pc = vec2f(p0) + 0.5;
  // (behind the raster's ground, a tree, a building; under the cabin's mask)
  if (terrainRasterHint(pc) > 0.0 || terrainRasterId(pc) > 0u) { return; }
  let mx = moments[u32(p0.y) * u32(W) + u32(p0.x)].x;
  if (mx < -0.5 && mx > -1.5) { return; }
  // (the air to space along it — from the camera, the sun's way's column —, the cloud pass's clouds before it)
  let ro = nearCam();
  var T = sunThrough(airHeight(ro), dot(airPhysicalDirection(normalize(squashed(toBody(a), squashOf(k)))), airPhysicalNormal(normalize(ro))));
  let cs = cloudsBuffered(pc, 3e38);
  if (cs.alpha > 0.0) { T *= 1.0 - cs.alpha; }
  // (the pixel's solid angle there — the plain camera's —, the splat's spread)
  let om = pow(2.0 * tanH / P.res.y, 2.0) * f * f * f;
  let sg = clamp(sqrt(0.1225 + P.time.w * P.time.w / om), 0.5, 1.2);
  let L = T * F * (P.time.z * P.camFwd.w / om);
  if (max(L.r, max(L.g, L.b)) < 0.5) { return; }
  var wt: array<f32, 9>;
  var ws = 0.0;
  for (var q = 0; q < 9; q++) {
    let e = vec2f(p0 + vec2i(q % 3 - 1, q / 3 - 1)) + 0.5 - p;
    wt[q] = exp(-dot(e, e) / (2.0 * sg * sg));
    ws += wt[q];
  }
  for (var q = 0; q < 9; q++) {
    let o = p0 + vec2i(q % 3 - 1, q / 3 - 1);
    if (o.x < 0 || o.y < 0 || o.x >= W || o.y >= H) { continue; }
    let x = L * (wt[q] / ws);
    if (max(x.r, max(x.g, x.b)) < 0.5) { continue; }
    let j = 3u * u32(o.y * W + o.x);
    atomicAdd(&starSplat[j], u32(min(x.r, 4e9) + 0.5));
    atomicAdd(&starSplat[j + 1u], u32(min(x.g, 4e9) + 0.5));
    atomicAdd(&starSplat[j + 2u], u32(min(x.b, 4e9) + 0.5));
  }
}
