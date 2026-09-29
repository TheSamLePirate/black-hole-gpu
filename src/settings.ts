import type { BodyView } from "./system/our-side";

export type Motion = "static" | "orbit" | "infall" | "forward" | "geodesic" | "comoving" | "barycentric";
/** The camera's placement (controls.ts): around the target, following it, free (carried by the nearest
 *  body; with gravity on, falling freely), on a tripod (fixed on the nearest body, turning with it).
 *  Where it looks is apart (Settings.lookAt): locked on the target, or free. */
export type Rotation = "orbit" | "follow" | "free" | "tripod";
/** Bodies of the registered Gargantua system that can be targeted (src/system/bodies.ts). */
export type SystemBody = "miller" | "mann" | "k2" | "edmunds";
export const SYSTEM_BODIES: SystemBody[] = ["miller", "mann", "k2", "edmunds"];
/** our universe's bodies: the solar system (system/solar.ts) */
export type OurBody =
  | "sun" | "mercury" | "venus" | "earth" | "moon" | "mars" | "phobos" | "deimos" | "ceres" | "jupiter" | "io" | "europa"
  | "ganymede" | "callisto" | "saturn" | "mimas" | "enceladus" | "tethys" | "dione" | "rhea" | "titan" | "iapetus"
  | "uranus" | "neptune" | "triton" | "pluto" | "charon";
export const OUR_TARGETS: OurBody[] = [
  "sun", "mercury", "venus", "earth", "moon", "mars", "phobos", "deimos", "ceres", "jupiter", "io", "europa", "ganymede",
  "callisto", "saturn", "mimas", "enceladus", "tethys", "dione", "rhea", "titan", "iapetus", "uranus", "neptune", "triton",
  "pluto", "charon",
];
export type Target = "hole" | "star" | "wormhole" | "barycentre" | SystemBody | OurBody;
export type RenderMode = "physical" | "redshift" | "temperature" | "order" | "steps";
export type ShiftMode = "full" | "gravitational" | "noBeaming" | "none";
export type Background = "real" | "stars" | "alien" | "checker" | "image";
export type Tonemap = "AgX" | "AgX punchy" | "ACES" | "clamp" | "Film";
export type Quality = "low" | "medium" | "high" | "ultra" | "realtime" | "game";

/** Integration / sampling budgets per quality level. */
type QualityKeys =
  | "realtimeEps" | "realtimeSteps" | "qualityEps" | "qualitySteps" | "targetSpp"
  | "adaptiveIntegrator" | "integratorTolerance" | "noiseThreshold";
export const QUALITY: Record<Quality, Pick<Settings, QualityKeys> & Partial<Settings>> = {
  low: { realtimeEps: 0.12, realtimeSteps: 300, qualityEps: 0.05, qualitySteps: 1500, targetSpp: 16, adaptiveIntegrator: false, integratorTolerance: 1e-4, noiseThreshold: 0.03, realtimeBudget: 30 },
  medium: { realtimeEps: 0.09, realtimeSteps: 450, qualityEps: 0.03, qualitySteps: 3000, targetSpp: 32, adaptiveIntegrator: true, integratorTolerance: 3e-5, noiseThreshold: 0.02, realtimeBudget: 30 },
  high: { realtimeEps: 0.07, realtimeSteps: 600, qualityEps: 0.02, qualitySteps: 4000, targetSpp: 64, adaptiveIntegrator: true, integratorTolerance: 1e-5, noiseThreshold: 0.01, realtimeBudget: 30 },
  ultra: { realtimeEps: 0.05, realtimeSteps: 1000, qualityEps: 0.02, qualitySteps: 8000, targetSpp: 256, adaptiveIntegrator: true, integratorTolerance: 2e-6, noiseThreshold: 0.005, realtimeBudget: 30 },
  // Best image that stays interactive (≈ 15 fps): a 60 ms GPU budget per frame spent on finer
  // blocks and finer realtime steps, a render scale a little under the display's, and reference
  // refinement (ultra) as soon as the view is still.
  realtime: {
    realtimeEps: 0.06, realtimeSteps: 700, qualityEps: 0.02, qualitySteps: 8000, targetSpp: 256, adaptiveIntegrator: true,
    integratorTolerance: 2e-6, noiseThreshold: 0.005, realtimeSubsampling: "auto", realtimeBudget: 60, temporalBlend: 0.5,
    pixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 1.25), denoise: true, dynamicResolution: false,
  },
  // The game's: a fluid frame rate first (≈ 60 fps: a 16 ms GPU budget, two frames in flight), the
  // render scale lowered for it when the subsampling alone is not enough (dynamic resolution), the
  // converged refinement lighter when the view holds still.
  game: {
    realtimeEps: 0.08, realtimeSteps: 500, qualityEps: 0.03, qualitySteps: 3000, targetSpp: 32, adaptiveIntegrator: true,
    integratorTolerance: 3e-5, noiseThreshold: 0.02, realtimeSubsampling: "auto", realtimeBudget: 16, temporalBlend: 0.5,
    pixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 1.25), denoise: true, dynamicResolution: true,
  },
};

export interface Settings {
  spin: number;
  // camera (Boyer–Lindquist position of the observer)
  distance: number;
  inclination: number; // degrees from the spin axis
  azimuth: number; // degrees
  fov: number; // vertical, degrees
  telescope: boolean; // the telephoto / telescope: fields down to 0.02°, the view held on the target, a reticle
  yaw: number;
  pitch: number;
  roll: number;
  motion: Motion;
  beta: number; // only for "forward"
  // "geodesic": the camera is a massive body in free fall (gravity button); its 3-velocity relative
  // to the local static/ZAMO observer, components along the anchor's (r̂, θ̂, φ̂) at the camera
  velR: number;
  velT: number;
  velP: number;
  thrust: number; // proper acceleration of the flight keys when gravity is on [c²/M]; the Cinema engine
  /** the Ranger's engine: Cinema (thrust, quasi-impulsive) or Crew (crewG, long burns) */
  engine: "cinema" | "crew";
  crewG: number; // Crew engine's proper acceleration [g]
  fuel: boolean; // propellant gauge (relativistic rocket)
  exhaust: number; // effective exhaust speed [c]
  massRatio: number; // initial mass over dry mass
  showGeodesic: boolean; // draw the camera's predicted free-fall path
  rotation: Rotation; // the camera's placement: around the target, following it, free, on a tripod
  lookAt: boolean; // the view locked on the target (any placement, the ship's views too; around: always)
  target: Target; // the body orbited / aimed at
  // thin disk
  disk: boolean;
  diskTemp: number; // peak effective temperature, K
  diskOuter: number; // M
  turbulence: number;
  limbDarkening: boolean;
  diskBrightness: number;
  diskEmission: "visible" | "bolometric";
  diskTau: number; // vertical optical depth
  diskThickness: number; // scale height H/R (0 = infinitely thin slab)
  diskHaze: number; // the scattering mist over the volumetric disk (0: none)
  endurance: boolean; // the Endurance on an orbit around the hole (cinematic scale)
  enduranceOrbit: number; // its orbit's radius [M]
  endurancePhase: number; // where on it at t = 0 [deg]
  enduranceIncl: number; // the orbit's tilt to the disk [deg]
  enduranceNode: number; // its ascending node's longitude [deg] (highest 90° after it)
  enduranceSize: number; // its diameter [M] (cinematic: at 64 m it would be far below a pixel)
  enduranceSpin: number; // its ring's turn [M of time]
  enduranceLight: number; // the disk's light on it (× the estimate)
  diskSmoke: number; // dark clouds of cool dense gas above the volumetric disk (0: none)
  flowPeriod: number; // M (no longer a setting: the GPU clock wraps after 1024 of them)
  // relativistic jet
  jet: boolean;
  jetLorentz: number; // bulk Lorentz factor Γ
  jetWidth: number;
  jetLength: number; // M
  jetIntensity: number;
  jetCutoff: number; // synchrotron cutoff frequency / green band
  jetKnots: number;
  // hot flow
  hotFlow: boolean;
  hotFlowHR: number;
  hotFlowAlpha: number;
  hotFlowIntensity: number;
  // sky
  background: Background;
  bgIntensity: number;
  starSize: number;
  starBrightness: number; // catalogue stars relative to the Milky Way map (1 = photometric calibration)
  skyL: number; // galactic longitude behind the hole (default view) [deg]
  skyB: number; // galactic latitude behind the hole [deg]
  skyRoll: number; // tilt of the galactic plane w.r.t. the black hole's equator [deg]
  // time
  animate: boolean;
  timeSpeed: number; // M per second
  // orbiting hot spot (flare)
  hotSpot: boolean;
  spotRadius: number; // orbital radius [M]
  spotSize: number; // Gaussian σ [M]
  spotTau: number; // optical depth through the centre
  spotTemp: number; // K
  spotBrightness: number;
  spotPhase: number; // azimuth at t = 0 [deg]
  spotHeight: number; // above the equatorial plane [M]
  // observation band
  band: "visible" | "230GHz" | "multi";
  radioTau: number; // vertical optical depth of the flow at 230 GHz, at r = 4 M
  radioTe: number; // electron temperature at r = 4 M [10¹⁰ K]
  radioNuS: number; // synchrotron frequency ν_s at r = 4 M, in units of 230 GHz
  radioJet: number; // jet brightness in the radio band
  beamUas: number; // instrument beam FWHM [µas] (0 = perfect resolution)
  radioPeak: number; // brightness temperature shown as white [10¹⁰ K] (230 GHz colour map)
  uasPerM: number; // angular size of GM/c² [µas] (3.8 for M87*, 5.0 for Sgr A*)
  returningRadiation: "off" | "offline" | "always"; // disk self-irradiation (quality passes)
  diskAlbedo: number;
  // polarization (Walker–Penrose transport of the electric vector)
  polarization: boolean;
  polView: "ticks" | "intensity";
  polField: "toroidal" | "radial" | "vertical" | "spiral";
  polFraction: number; // synchrotron polarization fraction (ordered field)
  polJetPitch: number; // jet field pitch angle from the flow direction [deg]
  polTickSize: number; // tick spacing, in pixels of a 1080p image
  // rendering
  renderMode: RenderMode;
  shiftMode: ShiftMode;
  realtimeSubsampling: "auto" | 1 | 2 | 3 | 4 | 6 | 8;
  realtimeBudget: number; // GPU time per realtime frame the automatic subsampling aims for [ms]
  fpsCap: 0 | 30 | 60 | 120; // images rendered per second at most (0: as the display refreshes)
  glassBlur: boolean; // the interface's panels blur the view behind them (the browser redoes it every frame)
  temporalReprojection: boolean; // realtime: the previous frames' image carried over by the camera's rotation
  farFieldLut: boolean; // rays that stay far from the hole read a traced LUT between clean samples
  volumetricClouds: boolean; // the Earth's clouds near: a marched volume (else a textured shell)
  realtimeEps: number;
  realtimeSteps: number;
  qualityEps: number;
  qualitySteps: number;
  targetSpp: number;
  adaptiveIntegrator: boolean; // error-controlled RK4 in the converged pass
  integratorTolerance: number;
  noiseThreshold: number; // adaptive sampling: relative std. error at which a pixel stops (0 = off)
  temporalBlend: number; // weight of a new realtime sample in the temporal accumulation (1 = off)
  denoise: boolean; // variance-guided à-trous filter on accumulated images
  denoiseStrength: number;
  exposure: number; // EV
  autoExposure: boolean; // the light meter sets the exposure (the setting: a bias on top)
  bloom: number; // fraction of the energy spread by the optical PSF
  dof: boolean; // depth of field (a thin lens)
  dofAperture: number; // its largest circle of confusion, in units of 3 % of the image's height
  dofFocus: number; // focus distance [M]; 0: autofocus (the depth at the image's centre)
  lensFlare: number; // strength of the lens's ghosts and halo (0: none)
  tonemap: Tonemap;
  hdr: "auto" | "on" | "off"; // extended-range (EDR/HDR) canvas output
  hdrPeak: number; // brightest displayable value, in units of SDR white
  pixelRatio: number;
  quality: Quality;
  // overlays & physical units
  shadowGuide: boolean;
  massSolar: number; // only used for physical-unit readouts
  cinematicSpeed: number; // orbit: °/s, dive: proper time M/s
  // Interstellar's wormhole (Dneg metric): our universe (ℓ < 0) ↔ the black hole's universe (ℓ > 0)
  wormhole: boolean;
  anchor: "hole" | "wormhole"; // what the camera orbits (distance/inclination/azimuth refer to it)
  whL: number; // camera position ℓ when orbiting the wormhole [M] (< 0: our side)
  whRho: number; // throat radius ρ [M]
  whLength: number; // length of the cylindrical interior over the throat radius, 2a/ρ
  whLensing: number; // lensing width over the throat radius, W/ρ
  whDist: number; // distance of the far mouth from the black hole [M]
  whIncl: number; // polar angle of the far mouth from the spin axis [deg]
  whAzimuth: number; // azimuth of the far mouth [deg]
  whOrbit: boolean; // the far mouth on a circular equatorial Kerr orbit at whDist (else static)
  whPhase: number; // its orbital azimuth at t = 0 [deg]
  journeyDuration: number; // cinematic trip through the wormhole [s]
  // cinematic mode (artistic, not physical): a liquid surface across the wormhole's throat
  cinematic: boolean;
  waterRipples: number; // ripple strength (slopes), 0: a still mirror-flat surface
  waterMirror: number; // reflectance at normal incidence (water: 0.02)
  waterSpeed: number; // pace of the waves (their own clock, independent of the scene's time)
  waterGlow: number; // light scattered by the liquid (crests, sheen towards the rim)
  waterColor: string; // colour of the liquid (sRGB "#rrggbb"): what the light going through is filtered towards
  waterDensity: number; // how strongly it colours that light (0: clear)
  waterGlowColor: string; // colour of the scattered light
  // the spaceship carrying the camera (Interstellar's Ranger)
  ship: boolean;
  shipMount: string; // attach point of the camera (ship.ts MOUNTS)
  shipAlbedo: number; // hull albedo (light grey paint in the film)
  shipMetal: number; // metalness of the plating (0 painted … 1 bare metal)
  shipRough: number; // roughness scale (lower: glossier)
  shipLight: number; // gain on the light the hull receives (1: physical)
  shipCoat: number; // clear coat over the paint (0…1)
  shipLookYaw: number; // free look: the camera turned on its mount [deg]
  shipLookPitch: number;
  // companion star on a circular equatorial orbit around the hole
  sun: boolean;
  sunOrbit: number; // orbital radius [M]
  sunRadius: number; // [M]
  sunTemp: number; // photosphere temperature [K]
  sunBrightness: number;
  sunPhase: number; // orbital azimuth at t = 0 [deg]
  sunMass: number; // mass of the star [M]: its weak field bends light and pulls the camera
  // a planetary system from the body registry (src/system/bodies.ts)
  system: "none" | "gargantua";
  // the game: the Ranger's handling, the ground, the tools
  turnRate: number; // attitude control: top turning rate [°/s]
  turnAccel: number; // attitude control: angular acceleration (reaction wheels + RCS) [°/s²]
  rcsFraction: number; // RCS translation, as a fraction of the main engine's thrust
  crashSpeed: number; // touching the ground faster than this is a crash [m/s]
  ballistic: number; // ballistic coefficient m/(C_D A): how hard the air brakes the ship [kg/m²]
  autosave: boolean; // keep the flight in the browser and resume it at the next visit
  autosaveEvery: number; // [s]
  rangerStatus: boolean; // the Ranger's status (sphere of influence, orbit, target) in the telemetry
  soiRings: boolean; // the spheres of influence on the map
  pathInView: boolean; // the ship's future path drawn in the view (the cyan tube; the map keeps it)
  sound: boolean; // the sound (flight computer, thrusters, cabin, interface)
  soundVolume: number; // master, 0…1
  soundBeeps: number; // the flight computer's beeps and alarms
  soundEngines: number; // the main engine and the RCS
  soundAmbience: number; // the cabin (life support, reaction wheels) and the wind
  soundUi: number; // the interface's clicks
  dynamicResolution: boolean; // lower the render scale when the GPU cannot keep the frame budget
}

export function defaultSettings(): Settings {
  return {
    spin: 0.94,
    distance: 36,
    inclination: 82,
    azimuth: 0,
    fov: 45,
    telescope: false,
    yaw: 0,
    pitch: 0,
    roll: 0,
    motion: "static",
    beta: 0.3,
    velR: 0,
    velT: 0,
    velP: 0,
    thrust: 0.02,
    engine: "cinema",
    crewG: 1,
    fuel: false,
    exhaust: 0.1,
    massRatio: 20,
    showGeodesic: true,
    rotation: "orbit",
    lookAt: false,
    target: "hole",
    disk: true,
    diskTemp: 9000,
    diskOuter: 22,
    turbulence: 0.45,
    limbDarkening: true,
    diskBrightness: 1,
    diskEmission: "visible",
    diskTau: 0.5,
    diskThickness: 0,
    diskHaze: 0,
    endurance: false,
    enduranceOrbit: 24,
    endurancePhase: 0,
    enduranceIncl: 4,
    enduranceNode: 0,
    enduranceSize: 1.2,
    enduranceSpin: 60,
    enduranceLight: 1.5,
    diskSmoke: 0,
    flowPeriod: 90,
    jet: true,
    jetLorentz: 3,
    jetWidth: 1,
    jetLength: 160,
    jetIntensity: 0.25,
    jetCutoff: 8,
    jetKnots: 0.8,
    hotFlow: false,
    hotFlowHR: 0.4,
    hotFlowAlpha: 0.8,
    hotFlowIntensity: 0.6,
    background: "real",
    bgIntensity: 1,
    starSize: 1,
    starBrightness: 1,
    skyL: 0,
    skyB: 0,
    skyRoll: 35,
    animate: true,
    timeSpeed: 6,
    hotSpot: false,
    spotRadius: 7,
    spotSize: 0.7,
    spotTau: 2,
    spotTemp: 15000,
    spotBrightness: 0.25,
    spotPhase: 0,
    spotHeight: 0.6,
    band: "visible",
    radioTau: 0.6,
    radioTe: 5,
    radioNuS: 0.15,
    radioJet: 0.001,
    beamUas: 0,
    radioPeak: 5,
    uasPerM: 3.8,
    returningRadiation: "offline",
    diskAlbedo: 0.5,
    polarization: false,
    polView: "ticks",
    polField: "spiral",
    polFraction: 0.7,
    polJetPitch: 60,
    polTickSize: 24,
    renderMode: "physical",
    shiftMode: "full",
    realtimeSubsampling: "auto",
    realtimeBudget: 30,
    fpsCap: 0,
    glassBlur: false,
    temporalReprojection: true,
    farFieldLut: true,
    volumetricClouds: true,
    realtimeEps: 0.07,
    realtimeSteps: 600,
    qualityEps: 0.02,
    qualitySteps: 4000,
    targetSpp: 64,
    adaptiveIntegrator: true,
    integratorTolerance: 1e-5,
    noiseThreshold: 0.01,
    temporalBlend: 0.5,
    denoise: true,
    denoiseStrength: 1,
    exposure: 0,
    autoExposure: false,
    bloom: 0.1,
    dof: false,
    dofAperture: 0.5,
    dofFocus: 0,
    lensFlare: 0,
    tonemap: "AgX punchy",
    hdr: "auto",
    hdrPeak: 4,
    pixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 1.5),
    quality: "high",
    shadowGuide: false,
    massSolar: 6.5e9,
    cinematicSpeed: 8,
    wormhole: false,
    anchor: "hole",
    whL: -14,
    whRho: 1.5,
    whLength: 0.01,
    whLensing: 0.05,
    whDist: 22,
    whIncl: 70,
    whAzimuth: -160,
    whOrbit: false,
    whPhase: 0,
    journeyDuration: 24,
    cinematic: false,
    waterRipples: 1,
    waterMirror: 0,
    waterSpeed: 1,
    waterGlow: 0,
    waterColor: "#3aa6c8",
    waterDensity: 1,
    waterGlowColor: "#6fc4e1",
    ship: false,
    shipMount: "quarter",
    shipAlbedo: 0.6,
    shipMetal: 0.15,
    shipRough: 1,
    shipLight: 1,
    shipCoat: 1,
    shipLookYaw: 0,
    shipLookPitch: 0,
    sun: false,
    sunOrbit: 70,
    sunRadius: 2.5,
    sunTemp: 4300,
    sunBrightness: 6,
    sunPhase: 0,
    sunMass: 0.1,
    system: "none",
    turnRate: 43,
    turnAccel: 92,
    rcsFraction: 0.08,
    crashSpeed: 12,
    ballistic: 900,
    autosave: true,
    autosaveEvery: 10,
    rangerStatus: true,
    soiRings: true,
    pathInView: true,
    sound: true,
    soundVolume: 0.7,
    soundBeeps: 0.8,
    soundEngines: 0.9,
    soundAmbience: 0.5,
    soundUi: 0.35,
    dynamicResolution: false,
  };
}

/** A scene preset: settings, plus optionally the simulation time to start from [M]. */
/** pose: a camera placement computed when the preset is applied ("saturn": the mission's departure;
 *  "earth": in low Earth orbit; "earthGround": the game's start, on the pad at the Kennedy Space Center;
 *  an EarthView: a view of the Earth — its ground or above it, towards the Moon, the Sun or itself) */
export type Preset = Partial<Settings> & { time?: number; mission?: boolean; pose?: "saturn" | "earth" | "earthGround" | "earthMoon" | BodyView };

const GARGANTUA: Preset = {
  wormhole: true, spin: 0.9, diskTemp: 5200, diskOuter: 18, turbulence: 0.9, diskThickness: 0.02, diskTau: 6,
  jet: false, sun: true, sunOrbit: 70, sunRadius: 2.5, sunTemp: 4300, sunBrightness: 6, sunPhase: 0,
};

// The Earth's scenes: our side in the game's world (the wormhole near Saturn), the Ranger on the ground or
// in orbit (an EarthView: placed, the look turned towards the Moon, the Sun or the Earth), in real time,
// auto exposure; dates from the game's start (2067-01-01 15:00 UTC: a full Moon)
const EARTH_VIEW: Preset = {
  system: "gargantua", massSolar: 1e8, spin: 0.998, diskOuter: 7.5, diskTemp: 4600, turbulence: 0.9, diskThickness: 0.02, diskTau: 6,
  jet: false, sun: false, wormhole: true, whOrbit: true, whDist: 300, whPhase: 327.7, whRho: 0.05, whLength: 0.01, whLensing: 0.05,
  anchor: "wormhole", target: "moon", fov: 60, exposure: 0, bgIntensity: 1, autoExposure: true, ship: true, shipMount: "dorsal",
  engine: "crew", crewG: 2, animate: true, timeSpeed: 1 / 492.5490947, lensFlare: 0,
};
// (the solar system's worlds, Gargantua's: the same system, the Ranger on its orbit, the camera behind its
// cockpit — it moves with them: Miller runs round Gargantua at half the speed of light)
const WORLD_VIEW: Preset = { ...EARTH_VIEW };
const GARGANTUA_WORLD: Preset = { ...EARTH_VIEW, anchor: "hole", fov: 40, time: 109.6 };
/** the game's start [M], a day [M] */
const T0 = 109.6, DAY = 86400 / 492.5490947;
const SANTIAGO: [number, number] = [-33.45, -70.66];

export const presets: Record<string, Preset> = {
  "Kerr a=0.94, near edge-on": {
    spin: 0.94, distance: 36, inclination: 82, fov: 45,
  },
  "Cinematic: volumetric disk + jet": {
    spin: 0.94, distance: 34, inclination: 83, fov: 46, diskThickness: 0.04, diskTau: 1.5, turbulence: 0.6,
    diskTemp: 9500, jet: true, jetIntensity: 0.2,
  },
  "Interstellar (no shifts)": {
    spin: 0.6, distance: 34, inclination: 84, fov: 40, yaw: 0, pitch: 0, shiftMode: "none",
    diskTemp: 4500, diskOuter: 26, turbulence: 0.9, diskEmission: "bolometric", diskThickness: 0.02, diskTau: 6, jet: false,
  },
  // the film's close pass along the disk (the reference view for its look): the lensed far side rising
  // as a wall of strands beside the shadow, the near side below — in the film's grade
  "Interstellar: along the disk (the film's close pass)": {
    spin: 0.6, distance: 17.353, inclination: 84.456, azimuth: 40.467, fov: 45, yaw: 31.427, pitch: 6.397, roll: -4.302,
    motion: "static", shiftMode: "none", diskTemp: 4500, diskOuter: 26, turbulence: 0.95, diskEmission: "bolometric",
    diskThickness: 0.009, diskTau: 59, jet: false, animate: false, time: 1692.84, tonemap: "Film", bloom: 0.5,
    dof: true, dofAperture: 0.3, dofFocus: 0, lensFlare: 0.6, diskHaze: 0.6, diskSmoke: 0.6,
  },
  // (a flight: the image never accumulates — the thin disk, crisp in motion, where the volume would be grainy)
  // the film's wide shot: the Endurance on its orbit just above Gargantua's disk (tilted 9°: ~2.8 M over
  // it at its highest, clear of the haze), coming towards the camera (its ring face-on; cinematic scale: 2.4 M)
  "Interstellar: the Endurance before Gargantua": {
    spin: 0.6, distance: 40.904, inclination: 86.995, azimuth: 10.299, fov: 45, yaw: -3.854, pitch: 4.015, roll: -15.416,
    motion: "static", shiftMode: "none", diskTemp: 4500, diskOuter: 26, turbulence: 0.95, diskEmission: "bolometric",
    diskThickness: 0.009, diskTau: 59, jet: false, animate: false, time: 1692.84, tonemap: "Film", bloom: 0.5,
    dof: false, lensFlare: 0.6, diskHaze: 0.6, diskSmoke: 0.6, exposure: 0, autoExposure: false,
    endurance: true, enduranceOrbit: 18, enduranceIncl: 9, enduranceNode: -144, endurancePhase: 125.82, enduranceSize: 2.4, enduranceLight: 1.5,
  },
  "Ranger: approaching Gargantua": {
    spin: 0.6, distance: 34, inclination: 84, fov: 55, yaw: 0, pitch: 0, roll: 0, shiftMode: "none",
    diskTemp: 4500, diskOuter: 26, turbulence: 0.9, diskEmission: "bolometric", diskThickness: 0, diskTau: 100, jet: false,
    ship: true, shipMount: "quarter",
  },
  "Interstellar: wormhole to Gargantua": {
    wormhole: true, anchor: "wormhole", target: "wormhole", whL: -4, inclination: 90, azimuth: 0, yaw: 0, pitch: 0, roll: 0, fov: 45,
    spin: 0.9, diskTemp: 5200, diskOuter: 18, turbulence: 0.9, diskThickness: 0.02, diskTau: 6, jet: false,
    skyL: 0, skyB: 0, skyRoll: 35, sun: true, sunOrbit: 70, sunRadius: 2.5, sunTemp: 4300, sunBrightness: 6, sunPhase: 0,
  },
  "Gargantua system (10⁸ M☉, a* = 0.998)": {
    system: "gargantua", massSolar: 1e8, spin: 0.998, diskOuter: 7.5, diskTemp: 4600, turbulence: 0.9, diskThickness: 0.02, diskTau: 6,
    jet: false, sun: false, wormhole: true, whOrbit: true, whDist: 300, whPhase: 327.7, whRho: 0.05, whLength: 0.01, whLensing: 0.05,
    anchor: "hole", distance: 60, inclination: 78, azimuth: 146, yaw: 0, pitch: 0, roll: 0, fov: 50,
  },
  // ---- the Earth (group "earth"): its air, clouds, relief and night; the Sun, the Moon and the stars from it
  // the whole day side from 15 000 km: the Americas and the Atlantic, the clouds, the limb's blue
  "Earth: the Blue Marble": { ...EARTH_VIEW, target: "earth", fov: 55, time: T0, pose: { at: [-10, -40], altKm: 15000, look: "earth" } },
  // 2 500 km over the Indian Ocean, the Sun just over the limb: the air's arc, the glint, the terminator
  "Earth: sunset from orbit": { ...EARTH_VIEW, target: "sun", shipMount: "chase", time: T0, pose: { at: [0, 65], altKm: 2500, look: "sun", off: [22, -6] } },
  // 400 km over the Amazon's mouth: its sediment, the cumulus, the haze towards the horizon
  "Earth: low orbit over the Amazon": { ...EARTH_VIEW, target: "earth", time: T0, pose: { at: [-1, -52], altKm: 400, look: "earth", off: [0, 62] } },
  // 800 km over Japan at midnight near the new Moon (15 January): the cities' lights, the night's air on the limb
  "Earth: the night side, Japan's lights": { ...EARTH_VIEW, target: "earth", time: T0 + 14 * DAY, pose: { at: [35, 137], altKm: 800, look: "earth", off: [0, 40] } },
  // the Himalaya from 400 km over the Ganges plain, looking north at the range, the afternoon Sun 11° up
  // there: the ridges in relief, their snow, their shadows
  "Earth: the Himalaya from orbit": { ...EARTH_VIEW, target: "earth", fov: 50, time: T0 - 0.1931 * DAY, pose: { at: [24.5, 86.9], altKm: 400, look: "earth", off: [0, 45] } },
  // Santiago, the Sun setting behind the coast range: the auto exposure on the glow
  "Earth: sunset over the Andes": { ...EARTH_VIEW, target: "sun", fov: 50, time: T0 + 0.358 * DAY, pose: { at: SANTIAGO, look: "sun", off: [0, 6] } },
  // Santiago, a quarter of an hour later: the full Moon rising over the Andes (a telephoto)
  "Earth: full Moon rising over the Andes": { ...EARTH_VIEW, target: "moon", fov: 10, time: T0 + 0.3945 * DAY, pose: { at: SANTIAGO, look: "moon", off: [0, -2] } },
  // Mont Blanc at dusk, 18 January: a two-day-old Moon, 4 % lit, 12° up (a telephoto)
  "Earth: crescent Moon at dusk over the Alps": { ...EARTH_VIEW, target: "moon", fov: 7, time: T0 + 17.071 * DAY, pose: { at: [45.83, 6.86], look: "moon" } },
  // Aconcagua at dusk, 23 January: the first quarter, 34° up (a telephoto)
  "Earth: first quarter over the Andes": { ...EARTH_VIEW, target: "moon", fov: 7, time: T0 + 22.382 * DAY, pose: { at: [-32.65, -70.01], look: "moon" } },
  // Uluru at midnight under the full Moon: moonlit clouds, the stars through the deep blue
  "Earth: moonlit night at Uluru": { ...EARTH_VIEW, target: "moon", time: T0, pose: { at: [-25.34, 131.03], look: "moon", off: [0, -20] } },
  // the Atacama at Paranal, past midnight near the new Moon (16 January): the Milky Way rising in the east
  // over the desert
  "Earth: the Milky Way over the Atacama": { ...EARTH_VIEW, target: "moon", fov: 80, time: T0 + 14.4875 * DAY, pose: { at: [-24.6, -70.4], off: [0, 28] } },
  // Brittany on a winter afternoon (15:00, the Sun low in the south-west behind): the clouds lit pink, the
  // green hills
  "Earth: a winter afternoon in Brittany": { ...EARTH_VIEW, target: "sun", fov: 70, time: T0, pose: { at: [48.4, -4.5], off: [0, 12] } },
  // ---- the solar system's worlds (group "solar"): each from its orbit (placed by its phase: the angle from
  // the point under the Sun) or from its ground; their surfaces from a few tens of km (their maps' detail)
  "Moon: Earthrise": { ...EARTH_VIEW, target: "earth", fov: 35, exposure: 1.5, time: T0 + 13.5 * DAY, pose: { body: "moon", at: [0, 170], look: "earth", off: [0, -4] } },
  "Moon: an afternoon on the plains": { ...EARTH_VIEW, target: "sun", fov: 70, exposure: 2.3, time: T0, pose: { body: "moon", at: [20, 0], sunEl: 18, off: [90, -10] } },
  "Moon: the terminator from orbit": { ...WORLD_VIEW, target: "moon", fov: 60, exposure: 1, time: T0, pose: { body: "moon", altKm: 300, phase: 80, look: "moon", off: [0, 50] } },
  "Moon: the half Moon from orbit": { ...WORLD_VIEW, target: "moon", fov: 50, exposure: 1, time: T0, pose: { tilt: 60, body: "moon", altKm: 4000, phase: 80, look: "moon" } },
  "Mercury: from orbit": { ...WORLD_VIEW, target: "mercury", fov: 50, exposure: 0.7, time: T0, pose: { tilt: 60, body: "mercury", altKm: 5000, phase: 55, look: "mercury" } },
  "Mercury: the cratered plains": { ...EARTH_VIEW, target: "sun", fov: 70, exposure: 1.5, time: T0, pose: { body: "mercury", at: [10, 0], sunEl: 15, off: [90, -8] } },
  "Venus: above the clouds": { ...WORLD_VIEW, target: "venus", fov: 50, time: T0, pose: { tilt: 60, body: "venus", altKm: 15000, phase: 60, look: "venus" } },
  "Mars: from orbit": { ...WORLD_VIEW, target: "mars", fov: 50, time: T0, pose: { tilt: 60, body: "mars", altKm: 6000, phase: 35, look: "mars" } },
  "Mars: the blue sunset": { ...EARTH_VIEW, target: "sun", fov: 50, time: T0, pose: { body: "mars", at: [-4.6, 0], sunEl: 2, look: "sun", off: [0, 4] } },
  "Jupiter: from orbit": { ...WORLD_VIEW, target: "jupiter", fov: 50, time: T0, pose: { tilt: 60, body: "jupiter", altKm: 200000, phase: 30, look: "jupiter" } },
  "Io: Jupiter in the sky": { ...EARTH_VIEW, target: "jupiter", fov: 70, exposure: 1, time: T0 + 0.93 * DAY, pose: { body: "io", at: [10, 18], look: "jupiter", off: [0, -12] } },
  "Europa: Jupiter over the ice": { ...EARTH_VIEW, target: "jupiter", fov: 70, exposure: 1, time: T0 + 0.54 * DAY, pose: { body: "europa", at: [10, -136], look: "jupiter", off: [0, -10] } },
  "Saturn: the rings from above": { ...WORLD_VIEW, target: "saturn", fov: 32, time: T0, pose: { tilt: 60, body: "saturn", altKm: 420000, phase: 40, at: [-30, 0], look: "saturn" } },
  "Saturn: backlit": { ...WORLD_VIEW, target: "saturn", fov: 32, time: T0, pose: { tilt: 60, body: "saturn", altKm: 500000, phase: 155, at: [-12, 0], look: "saturn" } },
  "Titan: the orange haze": { ...WORLD_VIEW, target: "titan", fov: 50, exposure: 0.7, time: T0, pose: { tilt: 60, body: "titan", altKm: 6000, phase: 45, look: "titan" } },
  "Uranus: from orbit": { ...WORLD_VIEW, target: "uranus", fov: 50, time: T0, pose: { tilt: 60, body: "uranus", altKm: 70000, phase: 30, look: "uranus" } },
  "Neptune: from orbit": { ...WORLD_VIEW, target: "neptune", fov: 50, time: T0, pose: { tilt: 60, body: "neptune", altKm: 70000, phase: 30, look: "neptune" } },
  "Pluto: the heart": { ...WORLD_VIEW, target: "pluto", fov: 50, exposure: -0.8, time: T0, pose: { tilt: 60, body: "pluto", altKm: 3000, phase: 25, look: "pluto" } },
  // ---- Gargantua's worlds (group "gargantua"): on an orbit about each, looking down, then towards its horizon
  "Miller: the water world": { ...GARGANTUA_WORLD, target: "miller", pose: { tilt: 60, body: "miller", altKm: 25000, nu: 120 } },
  "Miller: the shallow sea": { ...GARGANTUA_WORLD, target: "miller", fov: 60, pose: { body: "miller", altKm: 3, nu: 120, off: [0, 78] } },
  "Mann: the ice world": { ...GARGANTUA_WORLD, target: "mann", pose: { tilt: 60, body: "mann", altKm: 25000, nu: 210 } },
  "Mann: the glaciers": { ...GARGANTUA_WORLD, target: "mann", fov: 60, pose: { body: "mann", altKm: 3, nu: 225, off: [0, 80] } },
  "Edmunds: the desert world": { ...GARGANTUA_WORLD, target: "edmunds", pose: { tilt: 60, body: "edmunds", altKm: 25000, nu: 225 } },
  "Edmunds: the plains": { ...GARGANTUA_WORLD, target: "edmunds", fov: 60, pose: { body: "edmunds", altKm: 2, nu: 240, off: [0, 80] } },
  // …and on their grounds, Gargantua in their sky: over Miller's sea (10 M from it: its shadow 60° across,
  // the disk's near side beamed by the planet's half light speed), over Mann's ice, low over Edmunds' desert
  "Miller: Gargantua over the sea": { ...GARGANTUA_WORLD, target: "hole", fov: 90, pose: { body: "miller", holeEl: 25, holeAz: 0, off: [0, -18] } },
  "Mann: Gargantua over the ice": { ...GARGANTUA_WORLD, target: "hole", fov: 60, pose: { body: "mann", holeEl: 15, holeAz: 0 } },
  "Edmunds: Gargantua at dusk": { ...GARGANTUA_WORLD, target: "hole", fov: 10, pose: { body: "edmunds", holeEl: 3, holeAz: 0, off: [0, -3] } },
  // the game: the film's journey from the Earth (on the pad at the Kennedy Space Center, 2067-01-01
  // 10:00 local), in real time, the Ranger on the Crew engine at 2 g (a lift-off needs more than 1 g);
  // first objective: orbit, then Saturn and the wormhole behind it
  "game:interstellar": {
    system: "gargantua", massSolar: 1e8, spin: 0.998, diskOuter: 7.5, diskTemp: 4600, turbulence: 0.9, diskThickness: 0.02, diskTau: 6,
    jet: false, sun: false, wormhole: true, whOrbit: true, whDist: 300, whPhase: 327.7, whRho: 0.05, whLength: 0.01, whLensing: 0.05,
    anchor: "wormhole", target: "saturn", fov: 60, exposure: 0, bgIntensity: 1, autoExposure: true, ship: true, shipMount: "chase",
    engine: "crew", crewG: 2, animate: true, timeSpeed: 1 / 492.5490947, ...QUALITY.game, quality: "game", time: 109.6, pose: "earthGround",
  },
  // the game's rehearsal: Artemis II — from a 400 km Earth orbit, round the Moon on a free return
  // and back (O: the planner, the Moon targeted: Free return, PLAN, EXECUTE)
  "game:artemis": {
    system: "gargantua", massSolar: 1e8, spin: 0.998, diskOuter: 7.5, diskTemp: 4600, turbulence: 0.9, diskThickness: 0.02, diskTau: 6,
    jet: false, sun: false, wormhole: true, whOrbit: true, whDist: 300, whPhase: 327.7, whRho: 0.05, whLength: 0.01, whLensing: 0.05,
    anchor: "wormhole", target: "moon", fov: 60, exposure: 0, bgIntensity: 1, autoExposure: true, ship: true, shipMount: "chase",
    engine: "crew", crewG: 2, animate: true, timeSpeed: 1 / 492.5490947, ...QUALITY.game, quality: "game", time: 109.6, pose: "earthMoon",
  },
  // our side: sunlit at 9.5 AU, ~10⁻⁷ of the disk's radiance — auto exposure
  "Gargantua system: departure near Saturn": {
    system: "gargantua", massSolar: 1e8, spin: 0.998, diskOuter: 7.5, diskTemp: 4600, turbulence: 0.9, diskThickness: 0.02, diskTau: 6,
    jet: false, sun: false, wormhole: true, whOrbit: true, whDist: 300, whPhase: 327.7, whRho: 0.05, whLength: 0.01, whLensing: 0.05,
    anchor: "wormhole", target: "wormhole", fov: 50, exposure: 0, bgIntensity: 1, autoExposure: true, pose: "saturn", timeSpeed: 1 / 492.5490947,
  },
  "Mission: through the wormhole to the companion star (automatic flight)": {
    wormhole: true, anchor: "wormhole", target: "wormhole", whL: -16, inclination: 90, azimuth: 0, yaw: 0, pitch: 0, roll: 0, fov: 55,
    spin: 0.9, diskTemp: 5200, diskOuter: 18, turbulence: 0.9, diskThickness: 0.02, diskTau: 6, jet: false,
    skyL: 0, skyB: 0, skyRoll: 35, sun: true, sunOrbit: 70, sunRadius: 2.5, sunTemp: 4300, sunBrightness: 6, sunPhase: 0,
    ship: true, shipMount: "quarter", mission: true,
  },
  "Wormhole: our Milky Way from Gargantua's side": {
    ...GARGANTUA, anchor: "wormhole", target: "wormhole", whL: 6, inclination: 90, azimuth: 0, yaw: 0, pitch: 0, roll: 0, fov: 55,
    skyL: 180, skyB: 0, skyRoll: 35,
  },
  "Cinematic: the liquid wormhole": {
    ...GARGANTUA, anchor: "wormhole", target: "wormhole", whL: 0.9, inclination: 90, azimuth: 0, yaw: 0, pitch: 0, roll: 0, fov: 60,
    skyL: 180, skyB: 0, skyRoll: 35, cinematic: true,
  },
  "Wormhole: long throat (images wrapped around it)": {
    ...GARGANTUA, anchor: "wormhole", target: "wormhole", whLength: 10, whLensing: 0.05, whL: -17, inclination: 90, azimuth: 0, yaw: 0, pitch: 0,
    roll: 0, fov: 50, skyL: 0, skyB: 0, skyRoll: 35,
  },
  "Wormhole: strong lensing (W = 0.43 ρ)": {
    ...GARGANTUA, anchor: "wormhole", target: "wormhole", whLength: 1, whLensing: 0.43, whL: -11, inclination: 90, azimuth: 0, yaw: 0, pitch: 0,
    roll: 0, fov: 55, skyL: 0, skyB: 0, skyRoll: 35,
  },
  "The mouth before Gargantua (banking flight)": {
    ...GARGANTUA, anchor: "hole", target: "wormhole", distance: 34, inclination: 70, azimuth: -150, yaw: -25, pitch: 8, roll: -25, fov: 60,
    time: 0, animate: false,
  },
  "Companion star close-up": {
    ...GARGANTUA, anchor: "hole", target: "star", distance: 74, inclination: 89, azimuth: 3.5, yaw: -20, pitch: -1, roll: 0, fov: 40,
    time: 0, animate: false,
  },
  "The star passing Gargantua": {
    ...GARGANTUA, anchor: "hole", distance: 90, inclination: 86, azimuth: -3, yaw: 6, pitch: 0, roll: 0, fov: 35,
    time: 0, animate: false,
  },
  "Gargantua under the distant galaxy": {
    ...GARGANTUA, wormhole: false, background: "alien", distance: 26, inclination: 80, azimuth: 0, fov: 50, sun: false,
  },
  "Schwarzschild (no spin → no BZ jet)": { spin: 0, distance: 36, inclination: 80, jet: false },
  "Luminet 1979 (bolometric)": {
    spin: 0, distance: 60, inclination: 80, fov: 30, diskEmission: "bolometric", diskTemp: 6000,
    diskOuter: 30, turbulence: 0, limbDarkening: false, exposure: 0.5, diskTau: 100, jet: false,
  },
  "Hot disk (T = 50 000 K, UV-bright AGN)": { diskTemp: 50000, exposure: -2.5 },
  "EHT: M87* at 230 GHz (20 µas beam)": {
    spin: 0.94, distance: 200, inclination: 163, fov: 9, disk: false, hotFlow: true, hotFlowHR: 0.4, jet: true,
    band: "230GHz", beamUas: 20, bloom: 0, radioPeak: 4, polarization: true, polField: "spiral", polTickSize: 40,
  },
  "Orbiting hot spot (flare, light echoes)": {
    spin: 0.9, distance: 30, inclination: 78, fov: 45, jet: false, hotSpot: true, spotRadius: 7, diskBrightness: 0.35,
    turbulence: 0.3, animate: true, timeSpeed: 15,
  },
  "Face-on (M87*-like hot flow)": {
    spin: 0.94, distance: 60, inclination: 17, fov: 30, disk: false, hotFlow: true,
    hotFlowHR: 0.45, hotFlowIntensity: 0.25, jet: false,
  },
  "Jet launch (blazar-like, i=20°)": {
    spin: 0.95, distance: 90, inclination: 20, fov: 50, jetLorentz: 5, jetIntensity: 0.03,
  },
  "Jet side view": {
    spin: 0.95, distance: 110, inclination: 75, fov: 55, jetLorentz: 3, jetLength: 220, diskOuter: 26, jetIntensity: 0.6,
  },
  "Extreme spin a=0.998, edge-on": {
    spin: 0.998, distance: 25, inclination: 89, fov: 38, yaw: 0, pitch: 0, shiftMode: "full",
    disk: true, hotFlow: false, motion: "static",
  },
  "Orbiting at r=8 (aberration)": {
    spin: 0.7, distance: 8, inclination: 80, fov: 75, motion: "orbit", diskOuter: 30, exposure: -1.5,
  },
  "Falling in (rain frame)": {
    spin: 0.7, distance: 6, inclination: 70, fov: 80, motion: "infall", diskOuter: 30, exposure: -1.5,
  },
  "Lensing grid + shadow guide": {
    spin: 0.9, distance: 25, inclination: 75, fov: 50, background: "checker",
    disk: false, jet: false, shadowGuide: true,
  },
};
