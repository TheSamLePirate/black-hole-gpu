export type Motion = "static" | "orbit" | "infall" | "forward" | "geodesic" | "comoving" | "barycentric";
/** Camera rotation: around the selected body, or about the camera itself. */
export type Rotation = "orbit" | "free";
export type Target = "hole" | "star" | "wormhole" | "barycentre";
export type RenderMode = "physical" | "redshift" | "temperature" | "order" | "steps";
export type ShiftMode = "full" | "gravitational" | "noBeaming" | "none";
export type Background = "real" | "stars" | "alien" | "checker" | "image";
export type Tonemap = "AgX" | "AgX punchy" | "ACES" | "clamp";
export type Quality = "low" | "medium" | "high" | "ultra" | "realtime";

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
    pixelRatio: Math.min(globalThis.devicePixelRatio ?? 1, 1.25), denoise: true,
  },
};

export interface Settings {
  spin: number;
  // camera (Boyer–Lindquist position of the observer)
  distance: number;
  inclination: number; // degrees from the spin axis
  azimuth: number; // degrees
  fov: number; // vertical, degrees
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
  thrust: number; // proper acceleration of the flight keys when gravity is on [c²/M]
  showGeodesic: boolean; // draw the camera's predicted free-fall path
  rotation: Rotation; // drag orbits the target, or turns the camera about itself
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
  flowPeriod: number; // M
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
  bloom: number; // fraction of the energy spread by the optical PSF
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
  // companion star on a circular equatorial orbit around the hole
  sun: boolean;
  sunOrbit: number; // orbital radius [M]
  sunRadius: number; // [M]
  sunTemp: number; // photosphere temperature [K]
  sunBrightness: number;
  sunPhase: number; // orbital azimuth at t = 0 [deg]
  sunMass: number; // mass of the star [M]: its weak field bends light and pulls the camera
}

export function defaultSettings(): Settings {
  return {
    spin: 0.94,
    distance: 36,
    inclination: 82,
    azimuth: 0,
    fov: 45,
    yaw: 0,
    pitch: 0,
    roll: 0,
    motion: "static",
    beta: 0.3,
    velR: 0,
    velT: 0,
    velP: 0,
    thrust: 0.02,
    showGeodesic: true,
    rotation: "orbit",
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
    bloom: 0.1,
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
    journeyDuration: 24,
    cinematic: false,
    waterRipples: 1,
    waterMirror: 0,
    waterSpeed: 1,
    waterGlow: 0,
    waterColor: "#3aa6c8",
    waterDensity: 1,
    waterGlowColor: "#6fc4e1",
    sun: false,
    sunOrbit: 70,
    sunRadius: 2.5,
    sunTemp: 4300,
    sunBrightness: 6,
    sunPhase: 0,
    sunMass: 0.1,
  };
}

/** A scene preset: settings, plus optionally the simulation time to start from [M]. */
export type Preset = Partial<Settings> & { time?: number };

const GARGANTUA: Preset = {
  wormhole: true, spin: 0.9, diskTemp: 5200, diskOuter: 18, turbulence: 0.75, diskThickness: 0.03, diskTau: 1.5,
  jet: false, sun: true, sunOrbit: 70, sunRadius: 2.5, sunTemp: 4300, sunBrightness: 6, sunPhase: 0,
};

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
    diskTemp: 4500, diskOuter: 26, turbulence: 0.8, diskEmission: "bolometric", diskTau: 100, jet: false,
  },
  "Interstellar: wormhole to Gargantua": {
    wormhole: true, anchor: "wormhole", target: "wormhole", whL: -4, inclination: 90, azimuth: 0, yaw: 0, pitch: 0, roll: 0, fov: 45,
    spin: 0.9, diskTemp: 5200, diskOuter: 18, turbulence: 0.75, diskThickness: 0.03, diskTau: 1.5, jet: false,
    skyL: 0, skyB: 0, skyRoll: 35, sun: true, sunOrbit: 70, sunRadius: 2.5, sunTemp: 4300, sunBrightness: 6, sunPhase: 0,
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
