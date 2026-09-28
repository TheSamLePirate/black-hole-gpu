import { OUR_TARGETS, type Settings } from "../settings";
import { SOLAR_BODIES } from "../system/solar";
import { MOUNTS } from "../mounts";

/** What a setting affects: a re-trace, only the final resolve, nothing, or the canvas size. */
export type Effect = "scene" | "display" | "none" | "resize";

export type SectionId = "scene" | "matter" | "sky" | "physics" | "render" | "game";

export const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: "scene", label: "Scene", icon: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3 12h3M18 12h3M12 3v3M12 18v3" },
  { id: "matter", label: "Matter", icon: "M3 12c3-4 15-4 18 0c-3 4-15 4-18 0zM12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0" },
  { id: "sky", label: "Sky", icon: "M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" },
  { id: "physics", label: "Physics", icon: "M4 19h16M6 19V9M11 19V5M16 19v-7M21 19V13" },
  { id: "render", label: "Render", icon: "M4 5h16v11H4zM8 20h8M12 16v4" },
  { id: "game", label: "Game", icon: "M12 2l3 7v8l-3 3-3-3V9zM9 13l-4 3v3l4-2M15 13l4 3v3l-4-2M12 9m-1.2 0a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0" },
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
    key: "target", type: "choice", section: "scene", group: "Camera rotation", label: "Target", style: "select", effect: "none",
    options: [
      { value: "hole", label: "Gargantua", hint: "The black hole" },
      { value: "star", label: "Star", hint: "The companion star: the camera rides with it (co-moving) while time runs" },
      { value: "wormhole", label: "Wormhole", hint: "The wormhole's mouth (from the other side, it stands for every body beyond it)" },
      { value: "barycentre", label: "Centre of mass", hint: "Gargantua and the star orbit it (when the star has a mass): the camera stays at rest in its frame" },
      { value: "miller", label: "Miller", hint: "Gargantua system: the ocean planet at r = 10 M" },
      { value: "mann", label: "Mann", hint: "Gargantua system: the ice planet at r = 40 M" },
      { value: "k2", label: "Edmunds' star", hint: "Gargantua system: the K2 dwarf at 2 000 AU" },
      { value: "edmunds", label: "Edmunds", hint: "Gargantua system: the rocky planet around the K2 star" },
      ...OUR_TARGETS.map((id) => ({ value: id, label: SOLAR_BODIES.find((b) => b.id === id)!.name, hint: "Our universe (the solar system, beyond our end of the wormhole)" })),
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
    key: "thrust", type: "number", section: "scene", group: "Flight & gravity", label: "Thrust (Cinema)", min: 0.001, max: 1, scale: "log", unit: "c²/M", precision: 2, effect: "none",
    help: "With gravity on (B), the flight keys fire thrusters: proper acceleration of the camera, ×5 with Shift. Hovering at r against gravity needs about M/r² (0.0025 at 20 M) — and much more near the horizon.",
    keywords: "rocket acceleration gravity thruster",
  },
  {
    key: "engine", type: "choice", section: "scene", group: "Flight & gravity", label: "Ranger engine", style: "segmented", effect: "none",
    options: [
      { value: "cinema", label: "Cinema", hint: "The thrust above: thousands of g for a hole of 10⁸ M☉ — a hypothetical engine, g-load not survivable; burns are quasi-impulsive" },
      { value: "crew", label: "Crew", hint: "0.1–3 g: burns last days, transfers are spirals (the low-thrust autopilot flies them)" },
    ],
    help: "The Ranger's engine. The path stays exact either way (proper acceleration along the Kerr geodesic); only the engine's performance changes. Crew: a few g converted with the hole's mass (1 g = 1.6 × 10⁻⁵ c²/M at 10⁸ M☉) — Gargantua's pull at 60 M is 17 g, so leaving it takes a spiral.",
    keywords: "engine crew cinema thrust g low thrust spiral",
  },
  {
    key: "crewG", type: "number", section: "scene", group: "Flight & gravity", label: "Crew engine", min: 0.1, max: 3, step: 0.1, unit: "g", precision: 1, effect: "none",
    visible: (s) => s.engine === "crew",
    help: "Proper acceleration of the Crew engine, in Earth gravities (what the crew feels at full throttle).",
    keywords: "g acceleration crew",
  },
  {
    key: "fuel", type: "toggle", section: "scene", group: "Flight & gravity", label: "Propellant gauge", effect: "none",
    help: "A relativistic rocket: the tank holds a rapidity budget vₑ ln(m₀/m_dry); every burn spends ∫a dτ of it (m/m₀ = e^(−w/vₑ)). When it is empty the engines stop. The planners show the plan's cost against what is left.",
    keywords: "fuel propellant delta-v budget rocket mass ratio",
  },
  {
    key: "exhaust", type: "number", section: "scene", group: "Flight & gravity", label: "Exhaust speed", min: 0.01, max: 1, scale: "log", unit: "c", precision: 2, effect: "none",
    visible: (s) => s.fuel,
    help: "Effective exhaust speed vₑ (1 c: a photon rocket).",
    keywords: "isp exhaust velocity",
  },
  {
    key: "massRatio", type: "number", section: "scene", group: "Flight & gravity", label: "Mass ratio", min: 1.1, max: 100, scale: "log", precision: 1, effect: "none",
    visible: (s) => s.fuel,
    help: "Initial mass over dry mass m₀/m_dry: the budget is vₑ ln(m₀/m_dry) of rapidity (≈ Δv for small values).",
    keywords: "mass ratio tank",
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
    key: "whRho", type: "number", section: "scene", group: "Interstellar wormhole", label: "Throat radius ρ", min: 0.01, max: 20, scale: "log", unit: "M", precision: 3, enabled: whOn,
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
    key: "whIncl", type: "number", section: "scene", group: "Interstellar wormhole", label: "Far mouth inclination", min: 5, max: 175, step: 0.1, unit: "°", enabled: (s) => whOn(s) && !s.whOrbit,
    help: "Polar angle of the far mouth from the spin axis: the angle at which the black hole is seen through the wormhole.",
  },
  {
    key: "whAzimuth", type: "number", section: "scene", group: "Interstellar wormhole", label: "Far mouth azimuth", min: -180, max: 180, step: 0.1, unit: "°", enabled: (s) => whOn(s) && !s.whOrbit,
  },
  {
    key: "whOrbit", type: "toggle", section: "scene", group: "Interstellar wormhole", label: "Mouth in orbit", enabled: whOn,
    help: "The far mouth as a test particle on a circular equatorial orbit of Kerr at its distance (Ω = 1/(r^3/2 + a)), its axes fixed: light and the camera crossing its gluing sphere are boosted between the mouth's rest frame and the hole's (aberration, Doppler).",
    keywords: "moving orbiting mouth boost lorentz",
  },
  {
    key: "whPhase", type: "number", section: "scene", group: "Interstellar wormhole", label: "Mouth orbital phase", min: 0, max: 360, step: 0.1, unit: "°", enabled: (s) => whOn(s) && s.whOrbit,
    help: "Azimuth of the orbiting mouth at t = 0.",
  },
  {
    key: "journeyDuration", type: "number", section: "scene", group: "Interstellar wormhole", label: "Journey duration", min: 6, max: 120, step: 1, unit: "s", effect: "none",
    help: "Length of the cinematic trip (T): line up with the mouth, cross the throat, then approach the black hole (or, from its universe, the way back).",
  },
  // ------------------------------------------------------------------ scene · spaceship
  {
    key: "ship", type: "toggle", section: "scene", group: "Spaceship", label: "Ranger",
    help: "Fly Interstellar's Ranger, the camera on one of its attach points. A real flight model: the ship follows the Kerr geodesic in the scene's time, its main engine and RCS give it a proper acceleration (Thrust, in Flight & gravity), its attitude has inertia (reaction wheels), with SAS, attitude holds and autopilots (hold position, circularize, approach the target). Flight data, attitude ball, map with the predicted free-fall path. The hull is lit by the light the tracer sees around the camera — the lensed disk, Gargantua, the sky — with a shadow from the dominant light. Shortcut: K (⇧K: next attach point); ? lists the flight keys. Model: “Interstellar Ranger One” by Max Vizell (Sketchfab), CC BY 4.0, modified.",
    keywords: "ranger spaceship ship shuttle vessel endurance mount camera holder attach",
  },
  {
    key: "shipMount", type: "choice", section: "scene", group: "Spaceship", label: "Attach point", enabled: (s) => s.ship,
    options: Object.entries(MOUNTS).map(([value, m]) => ({ value, label: m.label })),
    help: "Where the camera is fixed on the hull.",
  },
  {
    key: "shipLight", type: "number", section: "scene", group: "Spaceship", label: "Lighting", min: 0.3, max: 300, scale: "log", precision: 2, enabled: (s) => s.ship, effect: "display",
    help: "Gain on the light the hull receives. 1 is physical: the hull receives a few hundred times less light than the disk's surface brightness (the disk covers a small part of its sky), so against it the ship is mostly a silhouette with lit edges — the strongest contrasts (default). Films often light it far more.",
    keywords: "ship light exposure fill brightness",
  },
  {
    key: "shipAlbedo", type: "number", section: "scene", group: "Spaceship", label: "Hull brightness", min: 0.02, max: 0.95, step: 0.01, enabled: (s) => s.ship, effect: "display",
    help: "Albedo of the hull plating (panels vary slightly, seams and wear are darker). The Ranger of the film is a light grey.",
  },
  {
    key: "shipMetal", type: "number", section: "scene", group: "Spaceship", label: "Metalness", min: 0, max: 1, step: 0.01, enabled: (s) => s.ship, effect: "display",
    help: "Metalness of the plating: 0 a painted hull, 1 bare metal (mirror-like, coloured reflections of the disk).",
  },
  {
    key: "shipCoat", type: "number", section: "scene", group: "Spaceship", label: "Clear coat", min: 0, max: 1, step: 0.01, enabled: (s) => s.ship, effect: "display",
    help: "A thin glossy varnish over the paint: sharp reflections of the disk on top of the satin plating, strongest at grazing angles (Fresnel).",
    keywords: "varnish gloss lacquer",
  },
  {
    key: "shipRough", type: "number", section: "scene", group: "Spaceship", label: "Roughness", min: 0.1, max: 2.5, step: 0.01, enabled: (s) => s.ship, effect: "display",
    help: "Roughness scale of the plating: lower is glossier (sharper reflections of the disk).",
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
    help: "Fibrous strands, flame-like wisps and dark lanes (the look of Interstellar's Gargantua), carried round on circular Keplerian orbits — each ring at its own rate, no spiral — modulating temperature and density.",
  },
  {
    key: "diskHaze", type: "number", section: "matter", group: "Accretion disk", label: "Haze", min: 0, max: 2, step: 0.01, enabled: diskOn,
    visible: (s) => s.diskThickness > 0,
    help: "A thin scattering mist over the volumetric disk, lit by the disk below it: a faint veil seen from above, a luminous haze over the near side seen along the disk — thickening to the burnt band at its horizon, as in the film.",
    keywords: "haze mist fog glow atmosphere scattering film interstellar",
  },
  {
    key: "diskSmoke", type: "number", section: "matter", group: "Accretion disk", label: "Smoke", min: 0, max: 1, step: 0.01, enabled: diskOn,
    visible: (s) => s.diskThickness > 0,
    help: "Dark clouds of cool, dense gas above the volumetric disk, orbiting with it: sparse patches seen from above, silhouettes against the luminous haze seen along the disk — the near side's dark clouds in the film.",
    keywords: "smoke clouds dark dust foreground film interstellar",
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
    key: "system", type: "choice", section: "matter", group: "Planetary system", label: "System", style: "segmented",
    options: [
      { value: "none", label: "None", hint: "No planets" },
      { value: "gargantua", label: "Gargantua", hint: "Miller (r = 10 M, 1.3 g), Mann (40 M), the mouth orbiting at 300 M, Edmunds and its K2 star at 2 000 AU — the study's system (10⁸ M☉, a* = 0.998)" },
    ],
    help: "Bodies from a registered system (src/system/bodies.ts), on their real orbits: circular Kerr geodesics around the hole, Keplerian around a star. Planets are spheres lit by the accretion disk (or their star); far away they are smaller than a pixel.",
    keywords: "planets miller mann edmunds interstellar system",
  },
  {
    key: "endurance", type: "toggle", section: "matter", group: "Endurance", label: "Endurance",
    help: "Interstellar's ring ship on a circular prograde orbit around the hole, flying along its hub's axis with its ring spinning about it, lit by the disk, as in the film's shots. At its true size (64 m) it would be far below a pixel next to a hole of 10⁸ M☉ (M ≈ 1 AU): it is drawn at a cinematic scale. Not lensed (seen along straight rays from the camera); hidden by the disk's gas in front of it.",
    keywords: "endurance ship ring station interstellar orbit film",
  },
  {
    key: "enduranceOrbit", type: "number", section: "matter", group: "Endurance", label: "Orbit radius", min: 4, max: 200, step: 0.1, unit: "M",
    visible: (s) => s.endurance, help: "Radius of its circular orbit around the hole (it turns at the Keplerian rate).",
  },
  {
    key: "endurancePhase", type: "number", section: "matter", group: "Endurance", label: "Orbit phase", min: -180, max: 180, step: 0.1, unit: "°",
    visible: (s) => s.endurance, help: "Where on its orbit it is at t = 0.",
  },
  {
    key: "enduranceIncl", type: "number", section: "matter", group: "Endurance", label: "Orbit tilt", min: -90, max: 90, step: 0.1, unit: "°",
    visible: (s) => s.endurance, help: "The orbit's inclination to the disk's plane.",
  },
  {
    key: "enduranceNode", type: "number", section: "matter", group: "Endurance", label: "Orbit node", min: -180, max: 180, step: 0.1, unit: "°",
    visible: (s) => s.endurance, advanced: true, help: "Longitude of the orbit's ascending node: it rises above the disk there, highest 90° later.",
  },
  {
    key: "enduranceSize", type: "number", section: "matter", group: "Endurance", label: "Size", min: 0.05, max: 10, step: 0.01, scale: "log", unit: "M",
    visible: (s) => s.endurance, help: "Its ring's diameter — a cinematic scale.",
  },
  {
    key: "enduranceSpin", type: "number", section: "matter", group: "Endurance", label: "Spin period", min: 5, max: 1000, step: 1, scale: "log", unit: "M",
    visible: (s) => s.endurance, advanced: true, help: "One turn of its ring (its artificial gravity), in the scene's time.",
  },
  {
    key: "enduranceLight", type: "number", section: "matter", group: "Endurance", label: "Disk light", min: 0, max: 4, step: 0.01,
    visible: (s) => s.endurance, advanced: true, help: "Scale on the estimated light of the disk falling on it.",
  },
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
    key: "autoExposure", type: "toggle", section: "render", group: "Image", label: "Auto exposure", effect: "display",
    help: "A light meter sets the exposure, as the eye adapts: for the light falling where the camera is (the Sun, a star, the disk), held back when something in view would burn out. Exposure then adds a bias. The sky keeps its look on screen.",
    keywords: "auto exposure eye adaptation meter light sun brightness",
  },
  {
    key: "tonemap", type: "choice", section: "render", group: "Image", label: "Tone map", style: "segmented", effect: "display",
    options: [
      { value: "AgX", label: "AgX" },
      { value: "AgX punchy", label: "Punchy" },
      { value: "ACES", label: "ACES" },
      { value: "clamp", label: "Linear" },
      { value: "Film", label: "Film" },
    ],
    help: "How the scene's radiance becomes the screen's. Film: the look of Interstellar's Gargantua — overexposed by 2 EV over the exposure (the disk's heart burnt out to cream), each channel rolling off on its own (orange turns yellow, then white), saturated orange mid-tones, cool shadows, and the bloom as a strong additive haze over a sharp image.",
    keywords: "tone mapping agx aces film interstellar grade look overexposed",
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
    key: "lensFlare", type: "number", section: "render", group: "Image", label: "Lens flare", min: 0, max: 1, step: 0.01, effect: "display",
    help: "A camera's flare, as in the film: what burns out beyond white is reflected between the lens elements — tinted ghosts mirrored through the image's centre, and a halo ring, violet at its edge.",
    keywords: "flare ghost halo lens camera film interstellar",
  },
  {
    key: "dof", type: "toggle", section: "render", group: "Image", label: "Depth of field", effect: "display",
    help: "A thin lens: what is nearer or farther than the focus is blurred by its circle of confusion, from the depth each ray reached before what it shows became opaque (the Ranger stays sharp). Autofocus on the image's centre, or a set distance.",
    keywords: "depth of field dof bokeh focus blur aperture lens",
  },
  {
    key: "dofAperture", type: "number", section: "render", group: "Image", label: "Aperture", min: 0, max: 2, step: 0.01, effect: "display",
    visible: (s) => s.dof,
    help: "The largest blur (the sky's, when focused near), in units of 3 % of the image's height; twice that for what is much nearer than the focus.",
  },
  {
    key: "dofFocus", type: "number", section: "render", group: "Image", label: "Focus", min: 0, max: 200, step: 0.1, unit: "M", effect: "display",
    visible: (s) => s.dof,
    help: "Focus distance along the rays (0: autofocus on the depth at the image's centre).",
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
    key: "dynamicResolution", type: "toggle", section: "render", group: "Realtime", label: "Dynamic resolution", effect: "none",
    help: "When the realtime subsampling alone cannot keep the frame budget, the render scale is lowered (down to half the pixel ratio), and raised again when the GPU has room. The Game quality turns it on.",
    keywords: "fps performance resolution scale dynamic",
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
  // ---- the game
  {
    key: "turnRate", type: "number", section: "game", group: "Ranger handling", label: "Turn rate", min: 5, max: 180, step: 1, unit: "°/s", effect: "none",
    help: "Top turning rate of the attitude control (SAS, holds, the autopilots' turns).",
    keywords: "attitude rotation speed sas",
  },
  {
    key: "turnAccel", type: "number", section: "game", group: "Ranger handling", label: "Turn acceleration", min: 5, max: 360, step: 1, unit: "°/s²", effect: "none",
    help: "Angular acceleration of the reaction wheels and the RCS: how fast a turn starts and stops.",
    keywords: "attitude angular acceleration reaction wheels",
  },
  {
    key: "rcsFraction", type: "number", section: "game", group: "Ranger handling", label: "RCS authority", min: 0, max: 0.5, step: 0.01, precision: 2, effect: "none",
    help: "RCS translation (IJKL / HN, the autopilots' fine corrections), as a fraction of the main engine's thrust.",
    keywords: "rcs translation thrusters docking",
  },
  {
    key: "shipLookYaw", type: "number", section: "game", group: "Ranger handling", label: "Free look: yaw", min: -170, max: 170, step: 1, unit: "°", effect: "scene", advanced: true,
    help: "The camera turned on its mount (the ship keeps its attitude).",
  },
  {
    key: "shipLookPitch", type: "number", section: "game", group: "Ranger handling", label: "Free look: pitch", min: -85, max: 85, step: 1, unit: "°", effect: "scene", advanced: true,
  },
  {
    key: "crashSpeed", type: "number", section: "game", group: "Ground & air", label: "Crash speed", min: 1, max: 100, step: 1, unit: "m/s", effect: "none",
    help: "Touching the ground faster than this is a crash.",
    keywords: "landing crash touchdown",
  },
  {
    key: "ballistic", type: "number", section: "game", group: "Ground & air", label: "Ballistic coefficient", min: 50, max: 10000, scale: "log", precision: 3, unit: "kg/m²", effect: "none",
    help: "m/(C_D A): how hard the air brakes the ship (lower: more drag). 900: a dense lander.",
    keywords: "drag air atmosphere reentry",
  },
  {
    key: "rangerStatus", type: "toggle", section: "game", group: "Displays", label: "Ranger status", effect: "none",
    help: "The telemetry panel shows what the ship is doing: the body of its sphere of influence, landed / suborbital / in orbit / escaping, its orbit and the target.",
    keywords: "telemetry status orbit soi target",
  },
  {
    key: "pathInView", type: "toggle", section: "game", group: "Displays", label: "Future path in the view", effect: "scene",
    help: "The cyan tube of the ship's predicted path, drawn in the view (Y while flying). The map shows it either way.",
    keywords: "path trajectory tube cyan geodesic prediction",
  },
  {
    key: "soiRings", type: "toggle", section: "game", group: "Displays", label: "Spheres of influence on the map", effect: "none",
    help: "Circles on the map where each body's sphere of influence ends (r = a (m/M)^0.4).",
    keywords: "soi sphere of influence map",
  },
  {
    key: "sound", type: "toggle", section: "game", group: "Sound", label: "Sound", effect: "none",
    help: "Everything synthesized live, no music: the flight computer's beeps and alarms, the main engine (rumble, roar, ignition), the RCS thrusters (hiss, valve pops, panned to the side that fires), the reaction wheels, life support, the wind in an atmosphere, the interface. In vacuum only the hull carries sound: from the cabin-side mounts (dorsal, belly, nose) it is heavy and close, from the outside ones far and muffled. Starts with the first click or key (the browser's rule).",
    keywords: "audio sound effects beeps volume mute engine thrusters rcs alarm",
  },
  {
    key: "soundVolume", type: "number", section: "game", group: "Sound", label: "Volume", min: 0, max: 1, step: 0.01, effect: "none",
    enabled: (s) => s.sound, keywords: "audio master volume",
  },
  {
    key: "soundBeeps", type: "number", section: "game", group: "Sound", label: "Flight computer", min: 0, max: 1, step: 0.01, effect: "none",
    enabled: (s) => s.sound, help: "SAS, holds, autopilots, warp, targets, manoeuvre countdowns, spheres of influence, alarms.", keywords: "audio beeps alarms computer",
  },
  {
    key: "soundEngines", type: "number", section: "game", group: "Sound", label: "Engines & RCS", min: 0, max: 1, step: 0.01, effect: "none",
    enabled: (s) => s.sound, keywords: "audio engine thrusters rcs",
  },
  {
    key: "soundAmbience", type: "number", section: "game", group: "Sound", label: "Cabin & wind", min: 0, max: 1, step: 0.01, effect: "none",
    enabled: (s) => s.sound, keywords: "audio ambience cabin life support wind reaction wheels",
  },
  {
    key: "soundUi", type: "number", section: "game", group: "Sound", label: "Interface", min: 0, max: 1, step: 0.01, effect: "none",
    enabled: (s) => s.sound, keywords: "audio clicks interface buttons",
  },
  {
    key: "autosave", type: "toggle", section: "game", group: "Saved games", label: "Autosave", effect: "none",
    help: "Keeps the flight in this browser (every setting, the time, the pilot, the plan) and resumes it at the next visit. Named saves, files: the game tools (F2).",
    keywords: "save resume persist",
  },
  {
    key: "autosaveEvery", type: "number", section: "game", group: "Saved games", label: "Every", min: 2, max: 120, step: 1, unit: "s", effect: "none",
    enabled: (s) => s.autosave,
  },
  {
    key: "velR", type: "number", section: "scene", group: "Observer motion", label: "Velocity: radial", min: -0.99, max: 0.99, step: 0.0001, precision: 4, unit: "c", advanced: true,
    help: "The camera's (the ship's) velocity relative to the local static observer, along r̂ (our side: the rep frame's axes).",
    keywords: "velocity speed state vector",
  },
  {
    key: "velT", type: "number", section: "scene", group: "Observer motion", label: "Velocity: polar", min: -0.99, max: 0.99, step: 0.0001, precision: 4, unit: "c", advanced: true,
  },
  {
    key: "velP", type: "number", section: "scene", group: "Observer motion", label: "Velocity: azimuthal", min: -0.99, max: 0.99, step: 0.0001, precision: 4, unit: "c", advanced: true,
  },
];

export const SCHEMA_BY_KEY = new Map(SCHEMA.map((d) => [d.key, d]));

/** Keys whose change goes through the quality preset (the quality selector shows "Custom" if edited). */
export const QUALITY_KEYS: (keyof Settings)[] = [
  "realtimeEps", "realtimeSteps", "qualityEps", "qualitySteps", "targetSpp", "adaptiveIntegrator", "integratorTolerance", "noiseThreshold",
];

export type SceneGroup = "game" | "earth" | "gargantua" | "wormhole" | "hole";
export const SCENE_GROUPS: { id: SceneGroup; label: string; hint: string }[] = [
  { id: "game", label: "Game", hint: "Fly the Ranger: the film's journey, missions" },
  { id: "earth", label: "Earth", hint: "Our planet from its ground and its orbits: its air, its night, the Sun, the Moon and the stars" },
  { id: "gargantua", label: "Gargantua", hint: "Interstellar's black hole, its star and planets" },
  { id: "wormhole", label: "Wormhole", hint: "The mouth near Saturn and its lensing" },
  { id: "hole", label: "Black holes", hint: "Kerr physics: disks, jets, observers, instruments" },
];

/** The scenes' names, blurbs, glyphs and groups (the scene gallery); keyed by preset name. */
export const PRESET_INFO: Record<string, { title?: string; description: string; icon: string; group: SceneGroup }> = {
  "Earth: the Blue Marble": { title: "The Blue Marble", description: "The whole day side from 15 000 km: the Americas and the Atlantic under their clouds, the blue of the air along the limb.", icon: "◉", group: "earth" },
  "Earth: sunset from orbit": { title: "Sunset from orbit", description: "2 500 km over the Indian Ocean, the Sun just above the limb: the air's arc, the ocean's glint, the terminator's red.", icon: "◐", group: "earth" },
  "Earth: low orbit over the Amazon": { title: "Low orbit over the Amazon", description: "400 km up: the river's sediment, the cumulus in puffs, the haze thickening towards the horizon.", icon: "≈", group: "earth" },
  "Earth: the night side, Japan's lights": { title: "The night side", description: "800 km over Japan at midnight: the cities' lights, the dark ocean, the stars over the limb.", icon: "✦", group: "earth" },
  "Earth: the Himalaya from orbit": { title: "The Himalaya from orbit", description: "400 km over the Ganges plain, looking north: the range in relief under the afternoon Sun, its snow and shadows.", icon: "▲", group: "earth" },
  "Earth: sunset over the Andes": { title: "Sunset over the Andes", description: "Santiago, the Sun going down behind the coast range: the glow, the sky darkening upwards.", icon: "☀", group: "earth" },
  "Earth: full Moon rising over the Andes": { title: "Full Moon over the Andes", description: "A quarter of an hour after sunset, the full Moon rising over the Andes, reddened, crossed by far clouds (a telephoto).", icon: "●", group: "earth" },
  "Earth: crescent Moon at dusk over the Alps": { title: "Crescent over the Alps", description: "Mont Blanc at dusk: a two-day-old Moon, 4 % lit, low over the afterglow (a telephoto).", icon: "☽", group: "earth" },
  "Earth: first quarter over the Andes": { title: "First quarter", description: "Aconcagua at dusk: the half Moon 34° up, its seas, the deep blue of the evening (a telephoto).", icon: "◑", group: "earth" },
  "Earth: moonlit night at Uluru": { title: "Moonlit night at Uluru", description: "Midnight in the desert under the full Moon: silvered clouds, the red ground, the stars through the blue.", icon: "☾", group: "earth" },
  "Earth: the Milky Way over the Atacama": { title: "The Milky Way over the Atacama", description: "Paranal past midnight, near the new Moon: the Milky Way rising in the east over the desert.", icon: "✧", group: "earth" },
  "Earth: a winter afternoon in Brittany": { title: "A winter afternoon", description: "Brittany at 15:00 in January, the low Sun behind: the clouds lit pink, the green hills, the haze.", icon: "☁", group: "earth" },
  "game:interstellar": { title: "Interstellar — the journey", description: "2067, on the pad at the Kennedy Space Center. Take off, reach Saturn and the wormhole behind it, then Gargantua. Real time, real distances.", icon: "✈", group: "game" },
  "game:artemis": { title: "Artemis II — around the Moon", description: "400 km above the Earth, the Moon targeted: plan a free return with the flight planner (O) and fly it.", icon: "☾", group: "game" },
  "Mission: through the wormhole to the companion star (automatic flight)": { title: "Mission: through the wormhole", description: "An automatic flight in the Ranger: through the throat to Gargantua's companion star.", icon: "⇥", group: "game" },
  "Ranger: approaching Gargantua": { title: "Ranger: approaching Gargantua", description: "The Ranger on a circular orbit, Gargantua ahead — K flies it, ⇧K changes the camera.", icon: "▲", group: "game" },
  "Gargantua system (10⁸ M☉, a* = 0.998)": { title: "The Gargantua system", description: "10⁸ M☉ spinning at a* = 0.998: Miller's and Mann's planets, the orbiting wormhole mouth, the K2 star far out.", icon: "✺", group: "gargantua" },
  "Gargantua system: departure near Saturn": { title: "Departure near Saturn", description: "Our side: sunlit Saturn, the wormhole mouth waiting behind it.", icon: "♄", group: "gargantua" },
  "Interstellar (no shifts)": { title: "Gargantua, as in the film", description: "Doppler and redshift switched off, as the film did: the symmetric, golden Gargantua.", icon: "◎", group: "gargantua" },
  "Interstellar: along the disk (the film's close pass)": { title: "Along the disk, as in the film", description: "Skimming the disk beside the shadow: the lensed far side rises as a wall of hot strands and smoke, the reference view for the disk's look.", icon: "≋", group: "gargantua" },
  "Interstellar: the Endurance before Gargantua": { title: "The Endurance before Gargantua", description: "The film's wide shot: the ring ship on its orbit above the disk, lit by it — at a cinematic scale.", icon: "◍", group: "gargantua" },
  "Companion star close-up": { description: "The orange star: granulation, spots, prominences and corona, Gargantua beyond.", icon: "☼", group: "gargantua" },
  "The star passing Gargantua": { description: "The star in front of Gargantua, both lensed.", icon: "✹", group: "gargantua" },
  "Gargantua under the distant galaxy": { description: "Gargantua without the wormhole, under the far side's nebulae.", icon: "✧", group: "gargantua" },
  "Interstellar: wormhole to Gargantua": { title: "The wormhole to Gargantua", description: "Interstellar's wormhole from our side: Gargantua, its star and a distant galaxy inside. T: the journey.", icon: "⊚", group: "wormhole" },
  "Wormhole: our Milky Way from Gargantua's side": { title: "Our Milky Way, from the far side", description: "In Gargantua's universe, facing the mouth: our whole sky inside it.", icon: "⊙", group: "wormhole" },
  "Cinematic: the liquid wormhole": { title: "The liquid wormhole", description: "An artistic effect: a rippling liquid surface across the throat, a mirror at its rim.", icon: "≈", group: "wormhole" },
  "Wormhole: long throat (images wrapped around it)": { title: "A long throat", description: "2a = 10ρ: the far side repeats in rings, light wrapping round the throat.", icon: "◎", group: "wormhole" },
  "Wormhole: strong lensing (W = 0.43 ρ)": { title: "Strong lensing", description: "A gently flaring mouth: strong lensing of our sky around it.", icon: "◉", group: "wormhole" },
  "The mouth before Gargantua (banking flight)": { title: "The mouth before Gargantua", description: "Free flight with roll: the black mouth in front of Gargantua's shadow.", icon: "⊘", group: "wormhole" },
  "Kerr a=0.94, near edge-on": { title: "Kerr a = 0.94, near edge-on", description: "The default: a fast-spinning hole, translucent disk, jet.", icon: "◐", group: "hole" },
  "Cinematic: volumetric disk + jet": { title: "Volumetric disk & jet", description: "A thick volumetric disk and a jet — the most detailed look.", icon: "✦", group: "hole" },
  "Extreme spin a=0.998, edge-on": { title: "Extreme spin, edge-on", description: "Thorne's limit a = 0.998, in the disk's plane: a strongly flattened shadow.", icon: "◑", group: "hole" },
  "Schwarzschild (no spin → no BZ jet)": { title: "Schwarzschild", description: "A non-rotating hole: symmetric shadow, ISCO at 6M, no jet.", icon: "○", group: "hole" },
  "Luminet 1979 (bolometric)": { title: "Luminet 1979", description: "The first computed black-hole image: bolometric, opaque, smooth disk.", icon: "◍", group: "hole" },
  "Hot disk (T = 50 000 K, UV-bright AGN)": { title: "Hot disk — 50 000 K", description: "Realistic AGN temperatures: a blue-white disk.", icon: "☀", group: "hole" },
  "Face-on (M87*-like hot flow)": { title: "Face-on hot flow", description: "Looking down the axis at a thick hot flow: a photon ring like the EHT image.", icon: "◉", group: "hole" },
  "EHT: M87* at 230 GHz (20 µas beam)": { title: "EHT: M87* at 230 GHz", description: "Millimetre view of an M87*-like hot flow with the EHT beam and polarization ticks.", icon: "◌", group: "hole" },
  "Jet launch (blazar-like, i=20°)": { title: "Jet launch (blazar)", description: "Close to the jet's axis: a Doppler-boosted jet, a faint counter-jet.", icon: "↥", group: "hole" },
  "Jet side view": { description: "The jet and counter-jet seen from the side.", icon: "↕", group: "hole" },
  "Orbiting hot spot (flare, light echoes)": { title: "Orbiting hot spot", description: "A flare orbiting close to the hole: Doppler flashes and lensed echoes.", icon: "✺", group: "hole" },
  "Orbiting at r=8 (aberration)": { title: "Orbiting at r = 8", description: "The camera on a circular orbit: the sky aberrated and Doppler-shifted.", icon: "↻", group: "hole" },
  "Falling in (rain frame)": { title: "Falling in", description: "A freely falling observer close to the horizon (rain frame).", icon: "↓", group: "hole" },
  "Lensing grid + shadow guide": { title: "Lensing grid", description: "A coordinate grid on the sky and the analytic shadow outline.", icon: "▦", group: "hole" },
};
