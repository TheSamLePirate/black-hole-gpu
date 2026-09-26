import type { Settings } from "../settings";

/** What a setting affects: a re-trace, only the final resolve, nothing, or the canvas size. */
export type Effect = "scene" | "display" | "none" | "resize";

export type SectionId = "scene" | "matter" | "sky" | "physics" | "render";

export const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: "scene", label: "Scene", icon: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3 12h3M18 12h3M12 3v3M12 18v3" },
  { id: "matter", label: "Matter", icon: "M3 12c3-4 15-4 18 0c-3 4-15 4-18 0zM12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0" },
  { id: "sky", label: "Sky", icon: "M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" },
  { id: "physics", label: "Physics", icon: "M4 19h16M6 19V9M11 19V5M16 19v-7M21 19V13" },
  { id: "render", label: "Render", icon: "M4 5h16v11H4zM8 20h8M12 16v4" },
];

interface Base<K extends keyof Settings = keyof Settings> {
  key: K;
  label: string;
  section: SectionId;
  group: string;
  help?: string;
  effect?: Effect; // default "scene"
  advanced?: boolean;
  keywords?: string;
  visible?: (s: Settings) => boolean;
  enabled?: (s: Settings) => boolean;
}

export interface NumberDef extends Base {
  type: "number";
  min: number;
  max: number;
  step?: number;
  scale?: "linear" | "log";
  unit?: string;
  /** Value shown as "off" at the bottom of the slider (log sliders starting at 0). */
  offAtZero?: boolean;
  /** Significant digits for display (log scales), or fixed decimals from the step. */
  precision?: number;
}

export interface ToggleDef extends Base {
  type: "toggle";
}

export interface ChoiceDef extends Base {
  type: "choice";
  options: { value: string | number; label: string; hint?: string }[];
  style?: "segmented" | "select";
}

/** A colour, stored as "#rrggbb" (sRGB). */
export interface ColorDef extends Base {
  type: "color";
}

export type ControlDef = NumberDef | ToggleDef | ChoiceDef | ColorDef;

/** Group headers may carry the on/off switch of the physics they contain. */
export const GROUP_SWITCH: Record<string, keyof Settings> = {
  "Accretion disk": "disk",
  "Relativistic jet": "jet",
  "Hot accretion flow": "hotFlow",
  Polarization: "polarization",
  "Hot spot": "hotSpot",
  "Interstellar wormhole": "wormhole",
  "Companion star": "sun",
};

const diskOn = (s: Settings) => s.disk;
const jetOn = (s: Settings) => s.jet;
const flowOn = (s: Settings) => s.hotFlow;
const polOn = (s: Settings) => s.polarization;
const whOn = (s: Settings) => s.wormhole;
const aroundHole = (s: Settings) => !s.wormhole || s.anchor === "hole";

export const SCHEMA: ControlDef[] = [
  // ------------------------------------------------------------------ scene · black hole
  {
    key: "spin", type: "number", section: "scene", group: "Black hole", label: "Spin a/M", min: -0.999, max: 0.999, step: 0.001,
    help: "Dimensionless angular momentum a = J/M. Positive: the disk co-rotates with the hole; negative: retrograde disk. 0 is Schwarzschild. Spin shrinks the horizon and the ISCO, flattens one side of the shadow (frame dragging) and powers the Blandford–Znajek jet.",
    keywords: "kerr angular momentum rotation schwarzschild",
  },
  {
    key: "massSolar", type: "number", section: "scene", group: "Black hole", label: "Mass", min: 1, max: 1e11, scale: "log", unit: "M☉", precision: 3, effect: "none",
    help: "Only sets the physical units of the readouts (km, seconds, Kelvin…). General relativity is scale-free: the image in units of M = GM/c² is identical for any mass. 6.5×10⁹ M☉ is M87*, 4.3×10⁶ M☉ is Sgr A*.",
    keywords: "units m87 sgr solar",
  },
  // ------------------------------------------------------------------ scene · observer
  {
    key: "distance", type: "number", section: "scene", group: "Observer", label: "Distance r", min: 1.1, max: 1000, scale: "log", unit: "M", precision: 3, visible: aroundHole,
    help: "Boyer–Lindquist radius of the camera, in units of M = GM/c². Wheel / pinch on the view to zoom.",
    keywords: "zoom radius camera",
  },
  {
    key: "inclination", type: "number", section: "scene", group: "Observer", label: "Inclination θ", min: 0.2, max: 179.8, step: 0.1, unit: "°",
    help: "Polar angle from the spin axis: 0° looks down the jet (face-on), 90° is edge-on in the disk plane.",
    keywords: "polar angle theta tilt",
  },
  {
    key: "azimuth", type: "number", section: "scene", group: "Observer", label: "Azimuth φ", min: -360, max: 360, step: 0.1, unit: "°",
    help: "Azimuthal position around the spin axis (rotates the sky and the disk pattern; the metric itself is axisymmetric).",
  },
  {
    key: "fov", type: "number", section: "scene", group: "Observer", label: "Field of view", min: 1, max: 150, step: 0.1, unit: "°",
    help: "Vertical field of view of the pinhole camera, in the observer's rest frame (alt + wheel).",
    keywords: "fov zoom lens",
  },
  {
    key: "rotation", type: "choice", section: "scene", group: "Camera rotation", label: "Rotation", style: "segmented", effect: "none",
    options: [
      { value: "orbit", label: "Around the target", hint: "Drag orbits the selected body and the camera keeps it in view (its lensed, light-delayed image)" },
      { value: "free", label: "Free", hint: "Drag turns the camera about itself; the wheel moves it forward / back" },
    ],
    help: "Orbit: drag turns around the target, right-drag offsets the view, the wheel sets the distance; the camera tracks the target's apparent image (bent by the hole, delayed by the light travel time, aberrated). Free: drag looks around, right-drag rolls, the wheel dollies. R switches, click a body to select it, double-click to fly the view to it.",
    keywords: "orbit around free look rotate turntable trackball pivot focus",
  },
  {
    key: "target", type: "choice", section: "scene", group: "Camera rotation", label: "Target", style: "segmented", effect: "none",
    options: [
      { value: "hole", label: "Gargantua", hint: "The black hole" },
      { value: "star", label: "Star", hint: "The companion star: the camera rides with it (co-moving) while time runs" },
      { value: "wormhole", label: "Wormhole", hint: "The wormhole's mouth (the only body from our side of it)" },
      { value: "barycentre", label: "Centre of mass", hint: "Gargantua and the star orbit it (when the star has a mass): the camera stays at rest in its frame" },
    ],
    help: "The body the camera orbits and aims at (Tab cycles, a click on its image selects it — even a lensed secondary image). Orbiting the star follows it along its orbit, co-moving: the camera takes the star's velocity, so the star shows no Doppler shift.",
    keywords: "select body pivot focus star hole wormhole follow",
  },
  {
    key: "yaw", type: "number", section: "scene", group: "Look direction", label: "Yaw", min: -180, max: 180, step: 0.1, unit: "°",
    help: "Turns the camera left/right away from the hole (right-drag on the view).",
  },
  {
    key: "pitch", type: "number", section: "scene", group: "Look direction", label: "Pitch", min: -90, max: 90, step: 0.1, unit: "°",
    help: "Tilts the camera up/down (right-drag on the view).",
  },
  {
    key: "roll", type: "number", section: "scene", group: "Look direction", label: "Roll", min: -180, max: 180, step: 0.1, unit: "°",
    help: "Rotates the camera about its view direction (W / X on AZERTY, Z / X on QWERTY).",
    keywords: "bank tilt horizon",
  },
  {
    key: "motion", type: "choice", section: "scene", group: "Observer motion", label: "Motion", style: "select",
    options: [
      { value: "static", label: "Static (ZAMO)", hint: "Zero-angular-momentum observer: at rest relative to the dragged space" },
      { value: "orbit", label: "Circular orbit", hint: "Keplerian orbit: strong aberration and Doppler of the whole sky" },
      { value: "infall", label: "Free fall (rain frame)", hint: "Falling from rest at infinity, γ = 1/α" },
      { value: "forward", label: "Boost along view", hint: "Arbitrary speed β in the viewing direction" },
      { value: "geodesic", label: "Free fall (gravity)", hint: "The camera follows its own geodesic (Gravity button, B)" },
      { value: "comoving", label: "Co-moving with the star", hint: "Rigid rotation with the star's orbital Ω (set when orbiting the star)" },
      { value: "barycentric", label: "At rest (centre of mass)", hint: "At rest in the frame of the centre of mass, in which Gargantua moves (set in free rotation or when orbiting the centre of mass)" },
    ],
    help: "Velocity of the camera relative to the local zero-angular-momentum observer. Moving observers see relativistic aberration (the sky crowds forward) and Doppler shifts.",
    keywords: "velocity aberration boost orbit fall",
  },
  {
    key: "beta", type: "number", section: "scene", group: "Observer motion", label: "Boost β", min: 0, max: 0.99, step: 0.001, unit: "c",
    visible: (s) => s.motion === "forward",
    help: "Speed of the camera along the viewing direction as a fraction of c.",
  },
  {
    key: "cinematicSpeed", type: "number", section: "scene", group: "Observer motion", label: "Cinematic speed", min: 0.5, max: 60, step: 0.1, effect: "none",
    help: "Orbit mode (O): degrees per second. Dive mode (D): proper time of the falling observer, in M per second.",
  },
  // ------------------------------------------------------------------ scene · flight & gravity
  {
    key: "thrust", type: "number", section: "scene", group: "Flight & gravity", label: "Thrust", min: 0.001, max: 1, scale: "log", unit: "c²/M", precision: 2, effect: "none",
    help: "With gravity on (B), the flight keys fire thrusters: proper acceleration of the camera, ×5 with Shift. Hovering at r against gravity needs about M/r² (0.0025 at 20 M) — and much more near the horizon.",
    keywords: "rocket acceleration gravity thruster",
  },
  {
    key: "showGeodesic", type: "toggle", section: "scene", group: "Flight & gravity", label: "Show free-fall path", effect: "none",
    help: "With gravity on, the camera's predicted geodesic (no thrust, about one orbital period ahead) is drawn in the render as a glowing dashed tube, lensed like everything else (Einstein arcs behind the hole). Red end: it falls into the horizon.",
    keywords: "trajectory orbit geodesic path prediction",
  },
  // ------------------------------------------------------------------ scene · wormhole
  {
    key: "wormhole", type: "toggle", section: "scene", group: "Interstellar wormhole", label: "Wormhole",
    help: "Interstellar's Double Negative wormhole (James, von Tunzelmann, Franklin & Thorne 2015): our universe, with the real sky, on one side; the black hole's universe, with a distant galaxy, on the other. Light and the camera go through it. Fly with W/Z and X, or press T for the journey.",
    keywords: "interstellar wormhole gargantua tunnel other universe travel dneg thorne",
  },
  {
    key: "anchor", type: "choice", section: "scene", group: "Interstellar wormhole", label: "Camera orbits", style: "segmented", enabled: whOn, visible: () => false,
    options: [
      { value: "wormhole", label: "Wormhole", hint: "Drag orbits the mouth; the wheel changes the distance to the throat" },
      { value: "hole", label: "Black hole", hint: "Drag orbits the black hole (only from its universe)" },
    ],
    help: "What the orbit controls turn around. Switching keeps the view unchanged; from our side of the wormhole only the wormhole can be orbited.",
  },
  {
    key: "whL", type: "number", section: "scene", group: "Interstellar wormhole", label: "Position ℓ", min: -200, max: 200, step: 0.01, unit: "M",
    visible: (s) => s.wormhole && s.anchor === "wormhole",
    help: "Proper radial distance through the wormhole: ℓ < 0 on our side, ℓ > 0 in the black hole's universe, |ℓ| < a inside the throat's cylinder.",
    keywords: "ell proper distance through",
  },
  {
    key: "whRho", type: "number", section: "scene", group: "Interstellar wormhole", label: "Throat radius ρ", min: 0.2, max: 20, scale: "log", unit: "M", precision: 3, enabled: whOn,
    help: "Radius of the wormhole's spherical cross sections inside its cylindrical interior (1 km in the film; here in units of the black hole's M).",
  },
  {
    key: "whLength", type: "number", section: "scene", group: "Interstellar wormhole", label: "Length 2a/ρ", min: 0.001, max: 20, scale: "log", precision: 3, enabled: whOn,
    help: "Length of the cylindrical interior relative to the throat radius. The film used a very short wormhole (0.01); longer ones show multiple images of the far side wrapping around the throat.",
  },
  {
    key: "whLensing", type: "number", section: "scene", group: "Interstellar wormhole", label: "Lensing width W/ρ", min: 0.001, max: 2, scale: "log", precision: 3, enabled: whOn,
    help: "Width of the flaring of the mouths, W = 1.42953 M: how gently space turns from the cylinder to the flat exterior, i.e. how strongly the mouth lenses the stars around it (film: 0.05).",
    keywords: "einstein ring lensing mass",
  },
  {
    key: "whDist", type: "number", section: "scene", group: "Interstellar wormhole", label: "Far mouth distance", min: 10, max: 500, scale: "log", unit: "M", precision: 3, enabled: whOn,
    help: "Distance of the far mouth from the black hole. Inside a sphere around the mouth light follows the wormhole metric, outside it the Kerr metric.",
  },
  {
    key: "whIncl", type: "number", section: "scene", group: "Interstellar wormhole", label: "Far mouth inclination", min: 5, max: 175, step: 0.1, unit: "°", enabled: whOn,
    help: "Polar angle of the far mouth from the spin axis: the angle at which the black hole is seen through the wormhole.",
  },
  {
    key: "whAzimuth", type: "number", section: "scene", group: "Interstellar wormhole", label: "Far mouth azimuth", min: -180, max: 180, step: 0.1, unit: "°", enabled: whOn,
  },
  {
    key: "journeyDuration", type: "number", section: "scene", group: "Interstellar wormhole", label: "Journey duration", min: 6, max: 120, step: 1, unit: "s", effect: "none",
    help: "Length of the cinematic trip (T): line up with the mouth, cross the throat, then approach the black hole (or, from its universe, the way back).",
  },
  // ------------------------------------------------------------------ scene · cinematic mode
  {
    key: "cinematic", type: "toggle", section: "scene", group: "Cinematic mode", label: "Liquid wormhole",
    help: "An artistic effect, not physics: a liquid surface stretched across the wormhole's throat, covered in tiny ripples. It only shows up close: each ripple fades out once it spans too few pixels, and from afar the wormhole is the physical one. Rays going through are bent by the ripples (the far universe shimmers), some are reflected back (Fresnel: the rim turns into a mirror of the camera's universe), and the light that crosses is slightly tinted, with caustics. Going through the throat yourself leaves a splash. Shortcut: L.",
    keywords: "water liquid surface ripple wave aqueous interface mirror splash cinematic artistic effect",
  },
  {
    key: "waterRipples", type: "number", section: "scene", group: "Cinematic mode", label: "Ripples", min: 0, max: 3, step: 0.05,
    enabled: (s) => s.cinematic,
    help: "Strength of the ripples (wavelengths of a few hundredths of the throat radius): patchy trains of fine waves, droplets falling now and then, and the splash when you go through. 0: a perfectly still surface.",
  },
  {
    key: "waterMirror", type: "number", section: "scene", group: "Cinematic mode", label: "Reflectance", min: 0, max: 1, step: 0.01,
    enabled: (s) => s.cinematic,
    help: "Reflectance at normal incidence (water 0.02, glass 0.04, mercury ≈ 0.7). It rises towards 1 at grazing incidence, near the rim of the sphere (Schlick's Fresnel). 0: no reflection at all, rim included (the default).",
  },
  {
    key: "waterColor", type: "color", section: "scene", group: "Cinematic mode", label: "Liquid colour",
    enabled: (s) => s.cinematic,
    help: "Colour of the liquid: the light that goes through the surface is filtered towards it (more at grazing incidence, where the path through the liquid is longer).",
    keywords: "water tint colour color hue",
  },
  {
    key: "waterDensity", type: "number", section: "scene", group: "Cinematic mode", label: "Colour density", min: 0, max: 4, step: 0.05,
    enabled: (s) => s.cinematic,
    help: "How strongly the liquid colours the light that goes through it. 0: perfectly clear.",
    keywords: "water tint absorption",
  },
  {
    key: "waterGlow", type: "number", section: "scene", group: "Cinematic mode", label: "Glow", min: 0, max: 3, step: 0.05,
    enabled: (s) => s.cinematic,
    help: "Light scattered inside the liquid: a luminous network on the wave crests, where the caustics focus, and a sheen towards the rim. It makes the surface visible against a dark sky. 0 by default.",
  },
  {
    key: "waterGlowColor", type: "color", section: "scene", group: "Cinematic mode", label: "Glow colour",
    enabled: (s) => s.cinematic,
    help: "Colour of the light scattered in the liquid (shown when the glow is above 0).",
    keywords: "water glow colour color",
  },
  {
    key: "waterSpeed", type: "number", section: "scene", group: "Cinematic mode", label: "Wave speed", min: 0, max: 4, step: 0.05, effect: "none",
    enabled: (s) => s.cinematic,
    help: "Pace of the waves, on their own clock: they move even with time paused. 0 freezes them, so that the view can refine.",
  },
  // ------------------------------------------------------------------ matter · disk
  {
    key: "diskTemp", type: "number", section: "matter", group: "Accretion disk", label: "Peak temperature", min: 1500, max: 100000, scale: "log", unit: "K", precision: 3, enabled: diskOn,
    help: "Maximum effective temperature of the Novikov–Thorne disk (T ∝ F^¼). Real AGN disks reach ~10⁵ K (blue-white); ~9000 K maximises visible Doppler colour contrast.",
    keywords: "novikov thorne colour blackbody",
  },
  {
    key: "diskOuter", type: "number", section: "matter", group: "Accretion disk", label: "Outer radius", min: 3, max: 300, scale: "log", unit: "M", precision: 3, enabled: diskOn,
    help: "Outer edge of the disk. The inner edge is the ISCO, fixed by the spin.",
  },
  {
    key: "diskTau", type: "number", section: "matter", group: "Accretion disk", label: "Optical depth τ", min: 0.01, max: 100, scale: "log", precision: 2, enabled: diskOn,
    help: "Vertical optical depth of the gas. Small τ: translucent, the lensed far side and the sky shine through; τ ≳ 10: opaque. A slab crossed at angle μ transmits e^(−τ/μ).",
    keywords: "transparency opacity transparent",
  },
  {
    key: "diskThickness", type: "number", section: "matter", group: "Accretion disk", label: "Thickness H/R", min: 0, max: 0.25, step: 0.001, enabled: diskOn,
    help: "0: infinitely thin slab (fast). > 0: volumetric Gaussian layer with front-to-back absorption and emission along the geodesic (≈40 % slower).",
    keywords: "volumetric thick scale height",
  },
  {
    key: "turbulence", type: "number", section: "matter", group: "Accretion disk", label: "Turbulence", min: 0, max: 1, step: 0.01, enabled: diskOn,
    help: "Clumps and filaments advected with the Keplerian flow, modulating temperature and density.",
  },
  {
    key: "flowPeriod", type: "number", section: "matter", group: "Accretion disk", label: "Turbulence lifetime", min: 10, max: 400, step: 1, unit: "M", enabled: diskOn, advanced: true,
    help: "Lifetime of turbulent structures before they are replaced (keeps differential rotation from winding them up forever).",
  },
  {
    key: "limbDarkening", type: "toggle", section: "matter", group: "Accretion disk", label: "Limb darkening", enabled: diskOn,
    help: "Chandrasekhar electron-scattering atmosphere I ∝ 1 + 2.06 μ, with the emission angle measured in the fluid frame (thin disk).",
  },
  {
    key: "returningRadiation", type: "choice", section: "matter", group: "Accretion disk", label: "Returning radiation", style: "segmented", enabled: (s) => s.disk && s.diskThickness === 0,
    options: [
      { value: "off", label: "Off" },
      { value: "offline", label: "Offline", hint: "Only in offline renders (it multiplies the converged view's cost by ~6)" },
      { value: "always", label: "Always", hint: "Also in the live converged view" },
    ],
    help: "Disk light bent back onto the disk by the hole (Cunningham 1976), traced with one extra geodesic per disk hit and re-emitted with the albedo below: brightens the inner disk and the far side, strongest at high spin. Thin disk, quality passes; by default only in offline renders.",
    keywords: "self irradiation reflection bounce path tracing cunningham",
  },
  {
    key: "diskAlbedo", type: "number", section: "matter", group: "Accretion disk", label: "Albedo", min: 0, max: 1, step: 0.01,
    enabled: (s) => s.disk && s.returningRadiation !== "off" && s.diskThickness === 0,
    help: "Fraction of the returning radiation scattered back (grey, Lambertian in the gas frame); the rest is absorbed.",
  },
  {
    key: "diskEmission", type: "choice", section: "matter", group: "Accretion disk", label: "Brightness", style: "segmented", enabled: diskOn,
    options: [
      { value: "visible", label: "Visible (CIE)", hint: "Planck spectrum integrated against the eye's colour matching functions" },
      { value: "bolometric", label: "Bolometric", hint: "I ∝ g⁴σT⁴, colour of g·T (Luminet 1979)" },
    ],
    help: "How brightness is computed. Visible: what a human eye would see (exact Planck × CIE 1931). Bolometric: total flux, as in classic GR images.",
  },
  {
    key: "diskBrightness", type: "number", section: "matter", group: "Accretion disk", label: "Emissivity scale", min: 0, max: 4, step: 0.01, enabled: diskOn, advanced: true,
    help: "Artistic multiplier on the disk emission.",
  },
  // ------------------------------------------------------------------ matter · jet
  {
    key: "jetLorentz", type: "number", section: "matter", group: "Relativistic jet", label: "Lorentz factor Γ", min: 1.01, max: 30, scale: "log", precision: 3, enabled: jetOn,
    help: "Bulk Lorentz factor of the outflow. Larger Γ beams the approaching jet (∝ g^{8/3}) and hides the counter-jet; seen close to the axis this makes a blazar.",
    keywords: "blazar beaming speed",
  },
  {
    key: "jetWidth", type: "number", section: "matter", group: "Relativistic jet", label: "Width", min: 0.3, max: 3, step: 0.01, enabled: jetOn,
    help: "Scale of the parabolic jet boundary R ∝ z^0.6 (as measured for M87).",
  },
  {
    key: "jetLength", type: "number", section: "matter", group: "Relativistic jet", label: "Length", min: 20, max: 800, scale: "log", unit: "M", precision: 3, enabled: jetOn,
  },
  {
    key: "jetIntensity", type: "number", section: "matter", group: "Relativistic jet", label: "Intensity", min: 0.001, max: 5, scale: "log", precision: 2, enabled: jetOn,
  },
  {
    key: "jetCutoff", type: "number", section: "matter", group: "Relativistic jet", label: "Synchrotron cutoff ν_c", min: 0.2, max: 30, scale: "log", precision: 2, enabled: jetOn,
    help: "Exponential cutoff of the synchrotron spectrum j_ν ∝ ν^{1/3} e^{−ν/ν_c}, relative to green light. Low values redden the jet; Doppler shifts move the cutoff.",
    keywords: "colour spectrum",
  },
  {
    key: "jetKnots", type: "number", section: "matter", group: "Relativistic jet", label: "Knots / shocks", min: 0, max: 1, step: 0.01, enabled: jetOn,
    help: "Contrast of internal shocks and helical filaments. They move at the bulk speed, so light-travel time makes them appear superluminal.",
  },
  // ------------------------------------------------------------------ matter · hot flow
  {
    key: "hotFlowHR", type: "number", section: "matter", group: "Hot accretion flow", label: "Thickness H/R", min: 0.05, max: 1.5, step: 0.01, enabled: flowOn,
    help: "Geometrically thick, optically thin flow (RIAF/ADAF, like M87* and Sgr A*).",
  },
  {
    key: "hotFlowAlpha", type: "number", section: "matter", group: "Hot accretion flow", label: "Spectral index α", min: -1, max: 3, step: 0.01, enabled: flowOn,
    help: "Power law j_ν ∝ ν^−α; colours come from integrating it against the CIE observer.",
  },
  {
    key: "hotFlowIntensity", type: "number", section: "matter", group: "Hot accretion flow", label: "Intensity", min: 0.001, max: 5, scale: "log", precision: 2, enabled: flowOn,
  },
  // ------------------------------------------------------------------ matter · hot spot
  {
    key: "hotSpot", type: "toggle", section: "matter", group: "Hot spot", label: "Hot spot",
    help: "A hot blob on a circular Keplerian orbit, like the infrared flares of Sgr A* seen by GRAVITY. It is drawn at the retarded time along each ray, so its primary, secondary and photon-ring images appear with their light-travel delays; Doppler boosting makes it flare on the approaching side. Turn on animation to see it orbit.",
    keywords: "flare blob orbit gravity sgr echo time delay",
  },
  {
    key: "spotRadius", type: "number", section: "matter", group: "Hot spot", label: "Orbit radius", min: 1.5, max: 30, step: 0.1, unit: "M", enabled: (s) => s.hotSpot,
    help: "Boyer–Lindquist radius of the circular orbit (Keplerian angular velocity Ω = 1/(r^1.5 + a)).",
  },
  {
    key: "spotSize", type: "number", section: "matter", group: "Hot spot", label: "Size σ", min: 0.1, max: 4, step: 0.01, unit: "M", enabled: (s) => s.hotSpot,
  },
  {
    key: "spotHeight", type: "number", section: "matter", group: "Hot spot", label: "Height", min: -5, max: 5, step: 0.05, unit: "M", enabled: (s) => s.hotSpot,
    help: "Offset above the equatorial plane (a spot inside the disk plane would be hidden by an opaque disk).",
  },
  {
    key: "spotTemp", type: "number", section: "matter", group: "Hot spot", label: "Temperature", min: 1000, max: 1e6, scale: "log", unit: "K", precision: 3, enabled: (s) => s.hotSpot,
  },
  {
    key: "spotBrightness", type: "number", section: "matter", group: "Hot spot", label: "Brightness", min: 0.01, max: 100, scale: "log", precision: 2, enabled: (s) => s.hotSpot,
  },
  {
    key: "spotTau", type: "number", section: "matter", group: "Hot spot", label: "Optical depth", min: 0.01, max: 50, scale: "log", precision: 2, enabled: (s) => s.hotSpot,
  },
  {
    key: "spotPhase", type: "number", section: "matter", group: "Hot spot", label: "Initial azimuth", min: -180, max: 180, step: 1, unit: "°", enabled: (s) => s.hotSpot,
  },
  // ------------------------------------------------------------------ matter · companion star
  {
    key: "sun", type: "toggle", section: "matter", group: "Companion star", label: "Star",
    help: "A star on a circular orbit in the black hole's equatorial plane (in the black hole's frame; with a supermassive hole the star does the orbiting). Opaque limb-darkened blackbody photosphere, seen at the emission time with its orbital Doppler shift and gravitational redshift, and lensed like everything else.",
    keywords: "sun star companion orbit binary",
  },
  {
    key: "sunOrbit", type: "number", section: "matter", group: "Companion star", label: "Orbit radius", min: 8, max: 400, scale: "log", unit: "M", precision: 3, enabled: (s) => s.sun,
  },
  {
    key: "sunRadius", type: "number", section: "matter", group: "Companion star", label: "Radius", min: 0.1, max: 20, scale: "log", unit: "M", precision: 3, enabled: (s) => s.sun,
    help: "Artistic: a Sun-like star next to a 10⁸ M☉ hole would be ~0.005 M across.",
  },
  {
    key: "sunTemp", type: "number", section: "matter", group: "Companion star", label: "Temperature", min: 2500, max: 40000, scale: "log", unit: "K", precision: 3, enabled: (s) => s.sun,
  },
  {
    key: "sunBrightness", type: "number", section: "matter", group: "Companion star", label: "Brightness", min: 0.001, max: 100, scale: "log", precision: 2, enabled: (s) => s.sun,
  },
  {
    key: "sunPhase", type: "number", section: "matter", group: "Companion star", label: "Orbital phase", min: -180, max: 180, step: 1, unit: "°", enabled: (s) => s.sun,
    help: "Azimuth of the star at t = 0 (it then moves at the Keplerian angular velocity).",
  },
  {
    key: "sunMass", type: "number", section: "matter", group: "Companion star", label: "Mass", min: 0, max: 1, scale: "log", offAtZero: true, unit: "M", precision: 2, enabled: (s) => s.sun,
    help: "Mass of the star in units of the black hole's M. Its weak field Φ = −m/d is added to the Kerr metric: light passing it is bent by 4m/b (the background and Gargantua are lensed around the star, an Einstein ring forms behind it), its own light is redshifted by 1 − m/R, and with gravity on (B) the camera is pulled towards it and can orbit it. A real star next to a supermassive hole would weigh ~10⁻⁸ M (invisible). Gargantua and the star then orbit their centre of mass: the relative orbit has Ω² = (M + m)/D³, Gargantua circles at q D (q = m/(M + m)), its frame falls towards the star (the uniform 'indirect' field is added for light and for the camera) and the distant sky, at rest in the centre-of-mass frame, is aberrated by Gargantua's velocity.",
    keywords: "star mass gravity lensing einstein ring weight",
  },
  // ------------------------------------------------------------------ sky
  {
    key: "background", type: "choice", section: "sky", group: "Celestial sphere", label: "Sky", style: "select",
    options: [
      { value: "real", label: "Real sky", hint: "119 614 Hipparcos/HYG stars + the Gaia DR2 Milky Way (NASA Deep Star Maps 2020)" },
      { value: "stars", label: "Procedural", hint: "Blackbody stars + procedural Milky Way" },
      { value: "alien", label: "Distant galaxy", hint: "The galaxy on the far side of Interstellar's wormhole: nearer its centre, nebulae and dust" },
      { value: "checker", label: "Grid", hint: "Latitude/longitude grid: makes the lensing map explicit" },
      { value: "image", label: "Image", hint: "Your own equirectangular panorama" },
    ],
    help: "What lies at infinity. Everything is gravitationally lensed and blue/redshifted for the observer.",
    keywords: "background panorama stars milky way",
  },
  {
    key: "bgIntensity", type: "number", section: "sky", group: "Celestial sphere", label: "Intensity", min: 0.01, max: 50, scale: "log", precision: 2,
    help: "Brightness of the sky relative to the disk (artistic: the real sky is far fainter than an accretion disk).",
  },
  {
    key: "starBrightness", type: "number", section: "sky", group: "Celestial sphere", label: "Star brightness", min: 0.1, max: 30, scale: "log", precision: 2, visible: (s) => s.background === "real",
    help: "Catalogue stars relative to the Milky Way map. 1 = photometric calibration (a V = 0 star against 20 mag/arcsec² star clouds).",
  },
  {
    key: "skyL", type: "number", section: "sky", group: "Orientation", label: "Galactic longitude", min: -180, max: 180, step: 0.1, unit: "°", visible: (s) => s.background === "real",
    help: "Galactic longitude seen behind the hole from the default viewpoint (0° = the Galactic Centre in Sagittarius, 180° = anticentre in Auriga/Taurus, −80° = Carina / Southern Cross region).",
    keywords: "galaxy sagittarius orientation rotate sky",
  },
  {
    key: "skyB", type: "number", section: "sky", group: "Orientation", label: "Galactic latitude", min: -90, max: 90, step: 0.1, unit: "°", visible: (s) => s.background === "real",
    help: "Galactic latitude behind the hole (−33° ≈ Large Magellanic Cloud at l = 280°).",
  },
  {
    key: "skyRoll", type: "number", section: "sky", group: "Orientation", label: "Plane tilt", min: -180, max: 180, step: 0.1, unit: "°", visible: (s) => s.background === "real",
    help: "Angle between the galactic plane and the black hole's equatorial plane.",
  },
  {
    key: "starSize", type: "number", section: "sky", group: "Celestial sphere", label: "Star PSF size", min: 0.3, max: 4, step: 0.01, visible: (s) => s.background === "stars" || s.background === "real",
    help: "Width of the stellar point-spread function in pixels (flux-conserving: lensing still magnifies correctly).",
  },
  // ------------------------------------------------------------------ physics
  {
    key: "shiftMode", type: "choice", section: "physics", group: "Frequency shifts", label: "Shifts", style: "select",
    options: [
      { value: "full", label: "Full (Doppler + gravity + beaming)" },
      { value: "gravitational", label: "Gravitational only", hint: "Emitters replaced by static observers" },
      { value: "noBeaming", label: "Colour shift, no beaming" },
      { value: "none", label: "None (Interstellar look)" },
    ],
    help: "Switch individual effects off to see what each does. Physically everything is on: g = ν_obs/ν_em is exact and I_ν/ν³ is invariant.",
    keywords: "doppler redshift beaming interstellar",
  },
  // ------------------------------------------------------------------ physics · observation band
  {
    key: "band", type: "choice", section: "physics", group: "Observation", label: "Band", style: "segmented",
    options: [
      { value: "visible", label: "Visible", hint: "CIE 1931 colour of the full spectrum" },
      { value: "230GHz", label: "230 GHz", hint: "Event Horizon Telescope band: brightness temperature, afmhot scale" },
      { value: "multi", label: "86/230/345", hint: "Millimetre false colour: red 86, green 230, blue 345 GHz" },
    ],
    help: "Millimetre bands trace the hot flow's thermal synchrotron emission with self-absorption, solved at three frequencies at once: dT_b/ds = α_ν(ν/g)(g·T_e − T_b), Kirchhoff's law in the gas frame. The thin disk (~10⁴ K) is a black occulter there, the sky is dark.",
    keywords: "radio millimetre mm eht submillimetre synchrotron brightness temperature",
  },
  {
    key: "radioTau", type: "number", section: "physics", group: "Observation", label: "τ at 230 GHz", min: 0.01, max: 30, scale: "log", precision: 2,
    visible: (s) => s.band !== "visible",
    help: "Vertical optical depth of the flow at 230 GHz at r = 4 M. Above ~1 the flow hides the photon ring (Sgr A*-like at low frequency).",
  },
  {
    key: "radioTe", type: "number", section: "physics", group: "Observation", label: "Electron temp.", min: 0.5, max: 50, scale: "log", unit: "10¹⁰ K", precision: 2,
    visible: (s) => s.band !== "visible",
    help: "Electron temperature at r = 4 M (θ_e ∝ r^−0.84 elsewhere).",
  },
  {
    key: "radioNuS", type: "number", section: "physics", group: "Observation", label: "ν_s / 230 GHz", min: 0.02, max: 5, scale: "log", precision: 2, advanced: true,
    visible: (s) => s.band !== "visible",
    help: "Characteristic synchrotron frequency ν_s = (2/9)(eB/2πm_ec)θ_e² at r = 4 M, relative to 230 GHz: sets where the spectrum peaks.",
  },
  {
    key: "radioJet", type: "number", section: "physics", group: "Observation", label: "Jet brightness", min: 0, max: 1, scale: "log", offAtZero: true, precision: 2,
    visible: (s) => s.band !== "visible",
  },
  {
    key: "radioPeak", type: "number", section: "physics", group: "Observation", label: "White level", min: 0.1, max: 100, scale: "log", unit: "10¹⁰ K", precision: 2, effect: "display",
    visible: (s) => s.band === "230GHz",
  },
  {
    key: "beamUas", type: "number", section: "physics", group: "Observation", label: "Beam", min: 0, max: 60, step: 0.5, unit: "µas", effect: "display", offAtZero: true,
    visible: (s) => s.band !== "visible",
    help: "Resolution of the interferometer (Gaussian restoring beam, FWHM). The EHT's is ≈ 20 µas at 230 GHz.",
  },
  {
    key: "uasPerM", type: "number", section: "physics", group: "Observation", label: "GM/c² angle", min: 0.1, max: 20, scale: "log", unit: "µas", precision: 2, effect: "display",
    visible: (s) => s.band !== "visible" && s.beamUas > 0,
    help: "Angular size of GM/c² for the source: 3.8 µas for M87*, 5.0 µas for Sgr A*.",
  },
  // ------------------------------------------------------------------ physics · polarization
  {
    key: "polarization", type: "toggle", section: "physics", group: "Polarization", label: "Polarization",
    help: "Linear polarization of every emitter, carried to the camera by the Walker–Penrose constant κ = (A − iB)(r − ia cos θ), which is conserved along Kerr null geodesics: gravitational rotation of the polarization plane, relativistic aberration and the observer's motion are all included exactly. Disk: electron-scattering atmosphere (Chandrasekhar, up to 11.7 % at grazing angles, E-vector parallel to the surface). Hot flow and jet: synchrotron, E ⟂ B in the gas frame.",
    keywords: "evpa stokes q u eht walker penrose electric vector",
  },
  {
    key: "polView", type: "choice", section: "physics", group: "Polarization", label: "Show", style: "segmented", effect: "display", enabled: polOn,
    options: [
      { value: "ticks", label: "Ticks", hint: "EVPA ticks over the image (length and colour: polarization fraction)" },
      { value: "intensity", label: "P", hint: "Polarized intensity √(Q² + U²) with ticks" },
    ],
  },
  {
    key: "polField", type: "choice", section: "physics", group: "Polarization", label: "Flow field", style: "segmented", enabled: polOn,
    options: [
      { value: "spiral", label: "Spiral", hint: "Radial + toroidal (45° pitch), as in magnetically arrested disks" },
      { value: "toroidal", label: "Toroidal" },
      { value: "radial", label: "Radial" },
      { value: "vertical", label: "Vertical" },
    ],
    help: "Magnetic field geometry of the hot accretion flow in the gas frame. The EHT's M87* images favour a spiral field (Event Horizon Telescope Collaboration 2021, Paper VIII).",
  },
  {
    key: "polFraction", type: "number", section: "physics", group: "Polarization", label: "Synchrotron fraction", min: 0, max: 0.75, step: 0.01, enabled: polOn,
    help: "Intrinsic polarization of the synchrotron emitters (0.75 for an ordered field and electron index p = 3; lower = tangled field).",
  },
  {
    key: "polJetPitch", type: "number", section: "physics", group: "Polarization", label: "Jet field pitch", min: 0, max: 90, step: 1, unit: "°", enabled: polOn,
    help: "Angle of the jet's helical field from the flow direction (0° poloidal, 90° toroidal).",
  },
  {
    key: "polTickSize", type: "number", section: "physics", group: "Polarization", label: "Tick spacing", min: 8, max: 80, step: 1, unit: "px", effect: "display", enabled: polOn,
  },
  {
    key: "renderMode", type: "choice", section: "physics", group: "Diagnostics", label: "View", style: "select",
    options: [
      { value: "physical", label: "Physical image" },
      { value: "redshift", label: "Redshift map g = ν_obs/ν_em" },
      { value: "temperature", label: "Disk temperature" },
      { value: "order", label: "Image order (plane crossings)" },
      { value: "steps", label: "Integration cost" },
    ],
    help: "False-colour views of the underlying quantities.",
  },
  {
    key: "shadowGuide", type: "toggle", section: "physics", group: "Diagnostics", label: "Kerr shadow guide", effect: "none",
    help: "Overlay of the analytic critical curve (spherical photon orbits, Bardeen 1973) seen through the actual observer frame — it must match the ray-traced shadow edge. Shortcut G.",
  },
  {
    key: "animate", type: "toggle", section: "physics", group: "Time", label: "Animate", effect: "none",
    help: "Advances coordinate time: the gas orbits, jet knots flow. Shortcut Space.",
  },
  {
    key: "timeSpeed", type: "number", section: "physics", group: "Time", label: "Time speed", min: 0.1, max: 200, scale: "log", unit: "M/s", precision: 2, effect: "none",
    help: "Simulated time per real second, in units of GM/c³ (≈ 9 h for M87*, 21 s for Sgr A*).",
  },
  // ------------------------------------------------------------------ render · image
  {
    key: "exposure", type: "number", section: "render", group: "Image", label: "Exposure", min: -8, max: 8, step: 0.01, unit: "EV", effect: "display",
  },
  {
    key: "tonemap", type: "choice", section: "render", group: "Image", label: "Tone map", style: "segmented", effect: "display",
    options: [
      { value: "AgX", label: "AgX" },
      { value: "AgX punchy", label: "Punchy" },
      { value: "ACES", label: "ACES" },
      { value: "clamp", label: "Linear" },
    ],
  },
  {
    key: "hdr", type: "choice", section: "render", group: "Image", label: "HDR output", style: "segmented", effect: "display",
    options: [
      { value: "auto", label: "Auto", hint: "HDR when the display reports a high dynamic range" },
      { value: "on", label: "On" },
      { value: "off", label: "SDR" },
    ],
    help: "Extended-range canvas (rgba16float, tone mapping 'extended'): on EDR/HDR displays (e.g. Apple XDR) the inner disk, the jet and bright stars exceed SDR white instead of being compressed. PNG exports stay SDR; EXR is always scene-linear.",
    keywords: "edr xdr high dynamic range nits",
  },
  {
    key: "hdrPeak", type: "number", section: "render", group: "Image", label: "HDR peak", min: 1, max: 16, scale: "log", unit: "× SDR", precision: 2, effect: "display",
    visible: (s) => s.hdr !== "off",
    help: "Brightest value sent to the display, in units of SDR white (XDR: ≈ 4 at full brightness indoors, up to 16 with 1600-nit peaks). Highlights roll off smoothly to this level.",
  },
  {
    key: "bloom", type: "number", section: "render", group: "Image", label: "Bloom", min: 0, max: 0.5, step: 0.001, effect: "display",
    help: "Fraction of the light spread by the lens point-spread function (energy-conserving multi-scale glow).",
  },
  {
    key: "pixelRatio", type: "number", section: "render", group: "Image", label: "Pixel ratio", min: 0.25, max: 3, step: 0.05, unit: "×", effect: "resize",
    help: "Internal resolution relative to CSS pixels. Higher = sharper and slower.",
  },
  {
    key: "denoise", type: "toggle", section: "render", group: "Converged image", label: "Denoiser", effect: "display",
    help: "Variance-guided edge-avoiding à-trous filter on accumulated images: a pixel whose Monte Carlo estimate is still noisy (relative standard error above 2 %) is averaged with neighbours whose estimates are statistically compatible with it. Converged pixels, stars and the photon ring are never touched; it fades out by itself as the image converges. Also applied to offline renders and exports.",
    keywords: "noise svgf atrous filter",
  },
  {
    key: "denoiseStrength", type: "number", section: "render", group: "Converged image", label: "Denoiser strength", min: 0.25, max: 4, scale: "log", precision: 2, effect: "display", advanced: true,
    enabled: (s) => s.denoise,
    help: "Compatibility threshold of the edge-stopping test, in combined standard errors (1 = 1.5 σ).",
  },
  // ------------------------------------------------------------------ render · realtime
  {
    key: "realtimeSubsampling", type: "choice", section: "render", group: "Realtime", label: "Subsampling", style: "segmented",
    options: ["auto", 1, 2, 3, 4, 6, 8].map((v) => ({ value: v, label: v === "auto" ? "Auto" : `${v}×` })),
    help: "One ray per N×N pixels while moving. When the camera stops, the image fills in to full resolution over N² frames.",
  },
  {
    key: "realtimeBudget", type: "number", section: "render", group: "Realtime", label: "Frame budget", min: 8, max: 120, step: 1, unit: "ms",
    visible: (s) => s.realtimeSubsampling === "auto", effect: "none",
    help: "GPU time per realtime frame that the automatic subsampling aims for: 30 ms ≈ 30 fps, 60 ms ≈ 15 fps with finer blocks (sharper while moving or while time runs).",
    keywords: "fps frame rate performance speed",
  },
  {
    key: "temporalBlend", type: "number", section: "render", group: "Realtime", label: "Temporal blend", min: 0.05, max: 1, step: 0.01, advanced: true,
    help: "Weight of each new realtime sample (1 = no temporal accumulation). Lower = smoother, more ghosting while animating.",
  },
  {
    key: "realtimeEps", type: "number", section: "render", group: "Realtime", label: "RK4 step ε", min: 0.01, max: 0.3, scale: "log", precision: 2, advanced: true,
    help: "Relative step size of the realtime integrator (step ≈ ε·(r − r₊)).",
  },
  {
    key: "realtimeSteps", type: "number", section: "render", group: "Realtime", label: "Max steps", min: 50, max: 5000, scale: "log", precision: 3, advanced: true,
  },
  // ------------------------------------------------------------------ render · converged
  {
    key: "targetSpp", type: "number", section: "render", group: "Converged image", label: "Samples / pixel", min: 1, max: 4096, scale: "log", precision: 4,
    help: "Samples accumulated when everything is still (Gaussian-filtered, low-discrepancy jitter).",
  },
  {
    key: "adaptiveIntegrator", type: "toggle", section: "render", group: "Converged image", label: "Error-controlled RK4",
    help: "Step doubling + Richardson extrapolation: every step meets the local error tolerance (5th-order accurate).",
  },
  {
    key: "integratorTolerance", type: "number", section: "render", group: "Converged image", label: "RK4 tolerance", min: 1e-7, max: 1e-3, scale: "log", precision: 2,
    enabled: (s) => s.adaptiveIntegrator, advanced: true,
    help: "Maximum local relative error per step.",
  },
  {
    key: "noiseThreshold", type: "number", section: "render", group: "Converged image", label: "Adaptive sampling", min: 0.001, max: 0.1, scale: "log", precision: 2, offAtZero: true,
    help: "Stop sampling a pixel once the relative standard error of its mean drops below this value (slide fully left for off).",
  },
  {
    key: "qualityEps", type: "number", section: "render", group: "Converged image", label: "RK4 step ε", min: 0.002, max: 0.1, scale: "log", precision: 2, advanced: true,
    help: "Fixed-step scale (upper bound on the step when error control is on).",
  },
  {
    key: "qualitySteps", type: "number", section: "render", group: "Converged image", label: "Max steps", min: 200, max: 50000, scale: "log", precision: 3, advanced: true,
  },
];

export const SCHEMA_BY_KEY = new Map(SCHEMA.map((d) => [d.key, d]));

/** Keys whose change goes through the quality preset (the quality selector shows "Custom" if edited). */
export const QUALITY_KEYS: (keyof Settings)[] = [
  "realtimeEps", "realtimeSteps", "qualityEps", "qualitySteps", "targetSpp", "adaptiveIntegrator", "integratorTolerance", "noiseThreshold",
];

export const PRESET_INFO: Record<string, { description: string; icon: string }> = {
  "Kerr a=0.94, near edge-on": { description: "The default: fast-spinning hole, translucent disk, jet.", icon: "◐" },
  "Cinematic: volumetric disk + jet": { description: "Thick volumetric disk and jet — the most detailed look.", icon: "✦" },
  "Interstellar (no shifts)": { description: "Gargantua-like: Doppler and redshift switched off, as in the film.", icon: "◎" },
  "Schwarzschild (no spin → no BZ jet)": { description: "Non-rotating hole: symmetric shadow, ISCO at 6M.", icon: "○" },
  "Luminet 1979 (bolometric)": { description: "The first computed black-hole image: bolometric, opaque, smooth disk.", icon: "◍" },
  "Hot disk (T = 50 000 K, UV-bright AGN)": { description: "Realistic AGN temperatures: blue-white disk.", icon: "☀" },
  "Face-on (M87*-like hot flow)": { description: "Looking down the axis at a thick hot flow: photon ring like the EHT image.", icon: "◉" },
  "Jet launch (blazar-like, i=20°)": { description: "Close to the jet axis: Doppler-boosted jet, faint counter-jet.", icon: "↥" },
  "Jet side view": { description: "Jet and counter-jet seen from the side.", icon: "↕" },
  "Extreme spin a=0.998, edge-on": { description: "Thorne limit, in the disk plane: strongly flattened shadow.", icon: "◑" },
  "Orbiting at r=8 (aberration)": { description: "Camera on a circular orbit: the sky is aberrated and Doppler-shifted.", icon: "↻" },
  "Falling in (rain frame)": { description: "Freely falling observer close to the horizon.", icon: "↓" },
  "Lensing grid + shadow guide": { description: "Coordinate grid on the sky and the analytic shadow outline.", icon: "▦" },
  "EHT: M87* at 230 GHz (20 µas beam)": { description: "Millimetre view of an M87*-like hot flow with the EHT beam and polarization ticks.", icon: "◌" },
  "Orbiting hot spot (flare, light echoes)": { description: "A flare orbiting close to the hole: Doppler flashes and lensed echoes.", icon: "✺" },
  "Interstellar: wormhole to Gargantua": { description: "Interstellar's wormhole from our side: Gargantua, its star and a distant galaxy inside. T: the journey.", icon: "⊚" },
  "Wormhole: our Milky Way from Gargantua's side": { description: "In Gargantua's universe, facing the mouth: our whole sky inside it.", icon: "⊙" },
  "Wormhole: long throat (images wrapped around it)": { description: "2a = 10ρ: the far side repeats in rings, light wrapping round the throat.", icon: "◎" },
  "Wormhole: strong lensing (W = 0.43 ρ)": { description: "A gently flaring mouth: strong lensing of our sky around it.", icon: "◉" },
  "The mouth before Gargantua (banking flight)": { description: "Free flight with roll: the black mouth in front of Gargantua's shadow.", icon: "⊘" },
  "Companion star close-up": { description: "The orange star: granulation, spots, prominences and corona, Gargantua beyond.", icon: "☼" },
  "The star passing Gargantua": { description: "The star in front of Gargantua, both lensed.", icon: "✹" },
  "Gargantua under the distant galaxy": { description: "Gargantua without the wormhole, under the far side's nebulae.", icon: "✧" },
};
