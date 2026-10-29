// The planets' views of PLAN-PLANETES-AAA (docs/PLAN-PLANETES-AAA.md): every world in the same four views — from orbit, in
// low flight (3 km up, looking at its horizon), on foot (the walker), its showcase scene —, set up the same way for each, the
// clock held and the craft unbreakable. tests/e2e/planets-baseline.e2e.test.ts measures them all, planets-ab two builds.

export type View = "orbit" | "low" | "foot" | "cine";
/** set: the view's setup, or several — the brightest image kept (a world's sunlit side) */
export type Spot = { body: string; view: View; set: string | string[]; foot?: [number, number] };

/** a scene made at runtime from a preset of the same kind, its pose replaced */
// (the Ranger kept, as the scenes have it: without it the Earth's surface does not load near the camera, and Miller and Mann
// are drawn black — their light probe in or not: P0 findings; Gargantua's low views from its cockpit, the look level — its
// hull filled them from outside, ahead of a level craft)
const scene = (name: string, base: string, patch: string) =>
  `__bh.presets[${JSON.stringify(name)}] = { ...__bh.presets[${JSON.stringify(base)}], ${patch} }; __bh.game.preset(${JSON.stringify(name)}); ${HOLD}`;
const NUS = [0, 90, 180, 270];
// (the clock held at once, the craft unbreakable: the Ranger 3 km over Mann fell and crashed while a view was chosen, its
// "craft lost" card then over every view after)
export const HOLD = `Object.assign(__bh.settings, { animate: false, damage: false, crashSpeed: 1e9 });`;
// (the game's start [M], a day [M]: settings.ts T0, DAY at 10⁸ M☉)
const T0 = 109.6;
const DAY = 86400 / (4.925490947e-6 * 1e8);

// our solid worlds: radius [km] (the orbit's height ~1.2 radii: the whole disc), a ground they walk on
const OURS: [string, number][] = [
  ["moon", 1737],
  ["mars", 3390],
  ["mercury", 2440],
  ["venus", 6052],
  ["io", 1822],
  ["europa", 1561],
  ["titan", 2575],
  ["ceres", 470],
  ["pluto", 1188],
];
const GIANTS = ["jupiter", "saturn", "uranus", "neptune"];
export const SHOWCASE: Record<string, string> = {
  // (the Earth at its best: IGN's relief, imagery and buildings — Yosemite, on the global tiles, is far softer)
  earth: "Earth: Saint-Jean-de-Valériscle, the Cévennes",
  moon: "Moon: Earthrise",
  mars: "Mars: the blue sunset",
  mercury: "Mercury: the cratered plains",
  venus: "Venus: above the clouds",
  io: "Io: Jupiter in the sky",
  europa: "Europa: Jupiter over the ice",
  titan: "Titan: the orange haze",
  pluto: "Pluto: the heart",
  jupiter: "Jupiter: from orbit",
  saturn: "Saturn: backlit",
  uranus: "Uranus: from orbit",
  neptune: "Neptune: from orbit",
  miller: "Miller: Gargantua over the sea",
  mann: "Mann: Gargantua over the ice",
  edmunds: "Edmunds: Gargantua at dusk",
};
export const preset = (name: string) => `__bh.game.preset(${JSON.stringify(name)}); ${HOLD}`;

/** every world's views, the Earth's first (the budget) */
export const SPOTS = [
  // the Earth first — the budget, and the sound image the rest is judged against (the Alps, its tiles in)
  {
    body: "earth",
    view: "low",
    // (over the Mont Blanc's massif, 3 km up, a July morning — 10:30 UTC, the Sun ~55° up)
    set: scene(
      "P0 earth low",
      "Earth: low orbit over the Amazon",
      `time: ${T0 + 181 * DAY - (4.5 / 24) * DAY}, earthClouds: 0, pose: { at: [45.85, 6.75], altKm: 3, look: "earth", off: [0, 80] }`,
    ),
  },
  {
    body: "earth",
    view: "orbit",
    set: scene(
      "P0 earth orbit",
      "Earth: low orbit over the Amazon",
      `pose: { tilt: 60, body: "earth", altKm: 7600, phase: 40, look: "earth" }`,
    ),
  },
  { body: "earth", view: "foot", set: "", foot: [45.92, 6.87] },
  { body: "earth", view: "cine", set: preset(SHOWCASE.earth!) },
  // Gargantua's worlds
  ...(["miller", "mann", "edmunds"] as const).flatMap((b): Spot[] => [
    // (on an orbit about the world, 25 000 km up, and 3 km over its ground looking at its horizon: four places round
    // it, its sunlit side kept — Gargantua's disk lights it)
    {
      body: b,
      view: "orbit",
      set: NUS.map((nu) =>
        scene(
          `P0 ${b} orbit ${nu}`,
          "Miller: the water world",
          `target: "${b}", pose: { tilt: 60, body: "${b}", altKm: 25000, nu: ${nu} }`,
        ),
      ),
    },
    {
      body: b,
      view: "low",
      set: NUS.map((nu) =>
        scene(
          `P0 ${b} low ${nu}`,
          "Miller: the shallow sea",
          `target: "${b}", fov: 60, shipMount: "cockpit", pose: { body: "${b}", altKm: 3, nu: ${nu}, off: [0, 92] }`,
        ),
      ),
    },
    { body: b, view: "foot", set: "", foot: [0, 0] },
    { body: b, view: "cine", set: preset(SHOWCASE[b]!) },
  ]),
  // the solar system's solid worlds
  ...OURS.flatMap(([b, rKm]): Spot[] => [
    {
      body: b,
      view: "orbit",
      set: scene(
        `P0 ${b} orbit`,
        "Mars: from orbit",
        `target: "${b}", pose: { tilt: 60, body: "${b}", altKm: ${Math.round(1.2 * rKm)}, phase: 40, look: "${b}" }`,
      ),
    },
    {
      body: b,
      view: "low",
      set: scene(
        `P0 ${b} low`,
        "Mars: from orbit",
        `target: "${b}", fov: 60, pose: { body: "${b}", altKm: 3, phase: 50, look: "${b}", off: [0, 80] }`,
      ),
    },
    // (Venus: no walking under its 90 bar — character.start refuses it)
    ...(b === "venus" ? [] : [{ body: b, view: "foot" as View, set: "", foot: [10, 0] as [number, number] }]),
    { body: b, view: "cine", set: preset(SHOWCASE[b]!) },
  ]),
  // the giants: from orbit, and their showcase
  ...GIANTS.flatMap((b): Spot[] => [
    { body: b, view: "orbit", set: preset(`${b[0]!.toUpperCase()}${b.slice(1)}: from orbit`) },
    ...(SHOWCASE[b] !== `${b[0]!.toUpperCase()}${b.slice(1)}: from orbit`
      ? [{ body: b, view: "cine" as View, set: preset(SHOWCASE[b]!) }]
      : []),
  ]),
] as Spot[];
