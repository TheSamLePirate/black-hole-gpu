// The views of the common plan (docs/PLAN-REFRACTION-HORIZONS.md — M0a, M0b and every phase after: decision 36, one shared
// suite): the Earth in the raster pipeline, in the F-35's cockpit, at fixed places and dates, plus the rocky worlds' views
// of PLAN-PLANETES-AAA (tests/e2e/lib/planet-views.ts). tests/e2e/plan-views.e2e.test.ts measures them.

import { SPOTS } from "./planet-views";

/** an Earth view: the craft placed (flyAt: latitude, longitude [°], height over the ground [m], heading [°], speed [m/s])
 *  at a date (UTC); ortho: wait for the IGN's orthophotos (France) */
export type EarthView = {
  name: string;
  what: string;
  date: string;
  at: [number, number, number, number, number];
  ortho?: boolean;
};

export const EARTH_VIEWS: EarthView[] = [
  {
    // (the U10 reference: Paris low, a July morning — the cities, the scenery, the material's cost)
    name: "paris-low",
    what: "Paris, 450 m, a July morning",
    date: "2026-07-10T10:30:00Z",
    at: [48.83, 2.27, 450, 60, 120],
    ortho: true,
  },
  {
    // (the low Sun over the Alps — ~11° up, west-north-west behind the craft: the relief's shadows, its stairs and facets,
    // the rings' seams; as tests/e2e/lowflight-governor.e2e.test.ts's place)
    name: "chamonix-low-sun",
    what: "Chamonix valley, 450 m, the Sun ~11° up",
    date: "2026-07-10T17:50:00Z",
    at: [
      45.92 - (1.1 * Math.cos(Math.PI / 4)) / 111.2,
      6.87 - (1.1 * Math.sin(Math.PI / 4)) / (111.2 * Math.cos((45.92 * Math.PI) / 180)),
      450,
      45,
      120,
    ],
    ortho: true,
  },
  {
    // (gentle slopes on SRTM's metres alone — the Mongolian steppe east of Ulaanbaatar, a low morning Sun: the monotone
    // cubic's stairs, T1)
    name: "srtm-steppe",
    what: "Mongolian steppe (SRTM only), 300 m, the Sun ~20° up",
    date: "2026-07-10T23:15:00Z",
    at: [47.75, 107.2, 300, 300, 120],
  },
  {
    // (the sea at sunset — Biarritz looking west-north-west at the Sun ~2° up: the coast's teeth, the glint's moiré, R3)
    name: "biarritz-sunset",
    what: "Biarritz coast, 1 500 m, sunset (Sun ~2°)",
    date: "2026-06-21T19:45:00Z",
    at: [43.45, -1.52, 1500, 300, 140],
    ortho: true,
  },
];

/** the rocky worlds' views kept for the plan (H, R): their first set of planet-views.ts */
export const WORLD_VIEWS = SPOTS.filter((s) =>
  [
    ["earth", "orbit"],
    ["moon", "cine"],
    ["mercury", "cine"],
    ["ceres", "cine"],
    ["europa", "cine"],
    ["mars", "low"],
  ].some(([b, v]) => s.body === b && s.view === v),
);

/** the game's own settings for the Earth's views, the network's chance left out (no traffic), the F-35 in its cockpit */
export const EARTH_SETTINGS = `{ traffic: false, weather: "fair", earthPipeline: "raster", f35AutoProtect: false, damage: false, crashSpeed: 1e9 }`;

/**
 * The Earth's scenery (trees, buildings — OSM, the IGN's BD TOPO, Overture) in round the camera: its worker done and nothing
 * pending, `timeoutMs` at most — a shot or a frame time without it is of a bare ground (the T4 e2e's first shots, 2 Nov 2026).
 * Its state either way: what it holds, and when not ready, what is missing.
 */
export async function sceneryReady(
  app: { waitFor(expr: string, ms: number): Promise<unknown>; js<T>(expr: string): Promise<T> },
  timeoutMs = 120_000,
): Promise<{ ready: boolean; status: string; trees: number; buildings: number; meshedBuildings: number }> {
  const ready = await app
    .waitFor(`(() => { const s = __bh.renderer.earthScenery?.stats?.(); return !!s && s.status === "ready" && !s.pending; })()`, timeoutMs)
    .then(
      () => true,
      () => false,
    );
  const s = await app.js<{ status: string; trees: number; buildings: number; meshedBuildings: number }>(
    `(() => { const s = __bh.renderer.earthScenery?.stats?.() ?? {}; return { status: String(s.status ?? "none"), trees: s.trees ?? 0, buildings: s.buildings ?? 0, meshedBuildings: s.meshedBuildings ?? 0 }; })()`,
  );
  return { ready, ...s };
}

/** a view made from a scene (M0b — the refraction's, the horizons', the Earth's from a tripod or an orbit): `set` run on the
 *  Blue Marble's page (a preset, or one made at runtime from a base, its pose and time replaced), measured as the worlds';
 *  `shadows`: its relief shadows' share measured too (renderer.liteSkip 4 — the shadows —, 8192 — the Sun's map) */
export type SceneView = { name: string; what: string; set: string; shadows?: boolean };
const M_S = 492.5490947;
/** a date (UTC) as the game's time [M] */
const at = (iso: string) => (Date.parse(iso) - Date.UTC(2067, 0, 1)) / 1000 / M_S;
const HOLDS = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9 });`;
const made = (name: string, base: string, patch: string) =>
  `__bh.presets[${JSON.stringify(name)}] = { ...__bh.presets[${JSON.stringify(base)}], ${patch} }; __bh.game.preset(${JSON.stringify(name)}); ${HOLDS}`;
const cineOf = (b: string) => {
  const v = SPOTS.find((x) => x.body === b && x.view === "cine")!.set;
  return Array.isArray(v) ? v[0]! : v;
};
const scene = (name: string) => `__bh.game.preset(${JSON.stringify(name)}); ${HOLDS}`;

export const SCENE_VIEWS: SceneView[] = [
  // (the rocky worlds of the horizons' track — H —: the shadows' share, the terminator, the pole)
  {
    name: "mercury-cine-sun15",
    what: "Mercury, the cratered plains, the Sun 15° up",
    set: scene("Mercury: the cratered plains"),
    shadows: true,
  },
  // (Ceres has no showcase scene: the ciné view of planet-views.ts, M0a's)
  { name: "ceres-cine", what: "Ceres, M0a's ciné view", set: cineOf("ceres"), shadows: true },
  { name: "europa-cine", what: "Europa, Jupiter over the ice", set: scene("Europa: Jupiter over the ice"), shadows: true },
  {
    name: "moon-terminator-500km",
    what: "the Moon's terminator from 500 km",
    set: made(
      "M0b: the Moon's terminator",
      "Moon: Earthrise",
      `fov: 50, pose: { body: "moon", altKm: 500, phase: 88, look: "moon", tilt: 25 }`,
    ),
    shadows: true,
  },
  {
    name: "moon-south-pole",
    what: "the Moon's south pole on the ground, the Sun grazing",
    set: made(
      "M0b: the Moon's south pole",
      "Moon: Earthrise",
      `fov: 60, pose: { body: "moon", at: [-88.5, 0], sunEl: 1.5, look: "sun", off: [35, -4] }`,
    ),
    shadows: true,
  },
  { name: "mars-ground-sunset", what: "Mars on the ground at sunset", set: scene("Mars: the blue sunset"), shadows: true },
  {
    name: "moon-telescope-first-quarter",
    what: "the first-quarter Moon through a telescope from the Andes (1°)",
    set: made("M0b: the first quarter, telescope", "Earth: first quarter over the Andes", `fov: 1`),
  },
  // (the refraction's track — R —: the Sun at the horizon, the limb from orbit, an eclipsed Moon, a coast's far islands)
  {
    name: "biarritz-sun05-tele",
    what: "Biarritz, 21 June 2026, the Sun ~0.5° up, telephoto 4°",
    set: made(
      "M0b: Biarritz, Sun 0.5°",
      "Earth: sunset over the Andes",
      `fov: 4, earthClouds: 0, time: ${at("2026-06-21T19:41:00Z")}, pose: { at: [43.4832, -1.5586], look: "sun", off: [0, 0] }`,
    ),
  },
  {
    name: "biarritz-sun2-tele",
    what: "Biarritz, 21 June 2026, the Sun ~2° up, telephoto 4°",
    set: made(
      "M0b: Biarritz, Sun 2°",
      "Earth: sunset over the Andes",
      `fov: 4, earthClouds: 0, time: ${at("2026-06-21T19:31:00Z")}, pose: { at: [43.4832, -1.5586], look: "sun", off: [0, 0] }`,
    ),
  },
  // (the Sun at the limb seen from 420 km: ~−19.8° — the limb's dip 20.6° less the refraction —; the phase, the place found by
  // a sweep of the Sun's altitude by phase and longitude — docs/progress/refraction-horizons/M0b.md)
  {
    name: "iss-sunset-equator",
    what: "a sunset from the ISS's height over the equator (420 km)",
    set: made("M0b: ISS sunset, equator", "Earth: sunset from orbit", `pose: { altKm: 420, phase: 109.8, look: "sun", off: [0, -3] }`),
  },
  {
    name: "iss-sunset-north",
    what: "a sunset from the ISS's height above 70° N (420 km)",
    set: made("M0b: ISS sunset, north", "Earth: sunset from orbit", `pose: { altKm: 420, at: [72, 39], look: "sun", off: [0, -3] }`),
  },
  {
    name: "eclipsed-moon-2025-09-07",
    what: "the eclipsed Moon of 7 Sept 2025 at greatest (18:12 UTC) from New Delhi, 2°",
    set: made(
      "M0b: the eclipsed Moon",
      "Earth: first quarter over the Andes",
      `fov: 2, earthClouds: 0, time: ${at("2025-09-07T18:12:00Z")}, pose: { at: [28.61, 77.21], look: "moon" }`,
    ),
  },
  { name: "andes-sunset", what: "the Andes at sunset (Mendoza)", set: scene("Earth: sunset over the Andes") },
  {
    name: "la-hague",
    what: "La Hague, the Nez de Jobourg looking west over the Channel, a June evening",
    set: made(
      "M0b: La Hague",
      "Earth: sunset over the Andes",
      `ship: false, fov: 20, earthClouds: 0, time: ${at("2026-06-21T20:15:00Z")}, pose: { at: [49.676, -1.94], heading: 285, off: [0, -1] }`,
    ),
  },
];

/** M0b's Earth views from the craft: a coast from 6 km offshore (the coast's teeth, the sea against the shore) */
export const M0B_EARTH_VIEWS: EarthView[] = [
  {
    name: "coast-6km",
    what: "the Basque coast from 6 km offshore, 800 m, midday",
    date: "2026-06-21T12:00:00Z",
    at: [43.47, -1.64, 800, 95, 140],
    ortho: true,
  },
];
