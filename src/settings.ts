export type Motion = "static" | "orbit" | "infall" | "forward";
export type RenderMode = "physical" | "redshift" | "temperature" | "order" | "steps";
export type ShiftMode = "full" | "gravitational" | "noBeaming" | "none";
export type Background = "real" | "stars" | "checker" | "image";
export type Tonemap = "AgX" | "AgX punchy" | "ACES" | "clamp";
export type Quality = "low" | "medium" | "high" | "ultra";

/** Integration / sampling budgets per quality level. */
type QualityKeys =
  | "realtimeEps" | "realtimeSteps" | "qualityEps" | "qualitySteps" | "targetSpp"
  | "adaptiveIntegrator" | "integratorTolerance" | "noiseThreshold";
export const QUALITY: Record<Quality, Pick<Settings, QualityKeys>> = {
  low: { realtimeEps: 0.12, realtimeSteps: 300, qualityEps: 0.05, qualitySteps: 1500, targetSpp: 16, adaptiveIntegrator: false, integratorTolerance: 1e-4, noiseThreshold: 0.03 },
  medium: { realtimeEps: 0.09, realtimeSteps: 450, qualityEps: 0.03, qualitySteps: 3000, targetSpp: 32, adaptiveIntegrator: true, integratorTolerance: 3e-5, noiseThreshold: 0.02 },
  high: { realtimeEps: 0.07, realtimeSteps: 600, qualityEps: 0.02, qualitySteps: 4000, targetSpp: 64, adaptiveIntegrator: true, integratorTolerance: 1e-5, noiseThreshold: 0.01 },
  ultra: { realtimeEps: 0.05, realtimeSteps: 1000, qualityEps: 0.02, qualitySteps: 8000, targetSpp: 256, adaptiveIntegrator: true, integratorTolerance: 2e-6, noiseThreshold: 0.005 },
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
  motion: Motion;
  beta: number; // only for "forward"
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
  // observation band
  band: "visible" | "230GHz" | "multi";
  radioTau: number; // vertical optical depth of the flow at 230 GHz, at r = 4 M
  radioTe: number; // electron temperature at r = 4 M [10¹⁰ K]
  radioNuS: number; // synchrotron frequency ν_s at r = 4 M, in units of 230 GHz
  radioJet: number; // jet brightness in the radio band
  beamUas: number; // instrument beam FWHM [µas] (0 = perfect resolution)
  radioPeak: number; // brightness temperature shown as white [10¹⁰ K] (230 GHz colour map)
  uasPerM: number; // angular size of GM/c² [µas] (3.8 for M87*, 5.0 for Sgr A*)
  returningRadiation: boolean; // disk self-irradiation (quality passes)
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
  realtimeEps: number;
  realtimeSteps: number;
  qualityEps: number;
  qualitySteps: number;
  targetSpp: number;
  adaptiveIntegrator: boolean; // error-controlled RK4 in the converged pass
  integratorTolerance: number;
  noiseThreshold: number; // adaptive sampling: relative std. error at which a pixel stops (0 = off)
  temporalBlend: number; // weight of a new realtime sample in the temporal accumulation (1 = off)
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
    motion: "static",
    beta: 0.3,
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
    band: "visible",
    radioTau: 0.6,
    radioTe: 5,
    radioNuS: 0.15,
    radioJet: 0.001,
    beamUas: 0,
    radioPeak: 5,
    uasPerM: 3.8,
    returningRadiation: true,
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
    realtimeEps: 0.07,
    realtimeSteps: 600,
    qualityEps: 0.02,
    qualitySteps: 4000,
    targetSpp: 64,
    adaptiveIntegrator: true,
    integratorTolerance: 1e-5,
    noiseThreshold: 0.01,
    temporalBlend: 0.5,
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
  };
}

export const presets: Record<string, Partial<Settings>> = {
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
