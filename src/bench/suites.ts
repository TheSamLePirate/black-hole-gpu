// The Kerr Bench's suites beyond the reference scenes: what a player meets past the score's eight views —
// the heavy worlds (the real ground's tiles: Yosemite, Everest, the Cévennes; the night side, the eclipse,
// Miller's sea, the volumetric disk), the vessels (the station, the Endurance, the Lander, the cabin), the
// weather (each preset, the Ranger hovering 1.5 km over Le Bourget; Mars's dust over Jezero) and the flights
// (the craft flown by its autopilots in real time: the final to Edwards, the entry's glide, a storm at
// Kennedy, fog at Le Bourget, the cabin on the final, a low orbit, a hover over the Moon, an orbit of
// Gargantua). Each item has the least depth that takes it: a quick run measures a few, a full run all.

import type { Text } from "../i18n";
import type { Settings } from "../settings";
import type { WeatherPreset } from "../weather";
import type { BenchMode, SuiteId } from "./report";

/** The depths in order (a run takes the items of its depth and the lesser ones). */
export const DEPTH_RANK: Record<BenchMode, number> = { quick: 0, standard: 1, complete: 2, full: 3 };

/** What a flight's setup drives: the game's tools (game/tools.ts), the relief's state. */
export interface BenchGame {
  glideTo(name: string, distKm?: number, altKm?: number, speed?: number, o?: { acrossKm?: number; headingDeg?: number }): string;
  orbit(body: string, o?: Record<string, unknown>): string;
  hoverOver(body: string, lat: number, lon: number, altKm?: number): string;
}

export interface BenchItem {
  id: string;
  suite: Exclude<SuiteId, "core">;
  /** the least depth that takes it */
  depth: BenchMode;
  title: Text;
  /** the scene it starts from */
  scene: string;
  /** a view (warmed, measured as in the game, then at the fixed setting) or a flight (flown, measured as it flies) */
  kind: "view" | "flight";
  /** the real ground's tiles: their loading waited for longer (the estimate) */
  heavy?: boolean;
  /** settings over the Game quality (the camera's mount, the damage) */
  settings?: Partial<Settings>;
  weather?: WeatherPreset;
  /** after the scene and its assets: the craft placed, its autopilot engaged */
  setup?: (g: BenchGame) => void;
  /** the setup needs the Earth's relief (a glide's height over its ground) */
  relief?: boolean;
}

const view = (
  suite: BenchItem["suite"],
  id: string,
  depth: BenchMode,
  scene: string,
  title: Text,
  o: Partial<BenchItem> = {},
): BenchItem => ({ id, suite, depth, scene, title, kind: "view", ...o });

/** The game's own start (our side, the Gargantua system in the sky): where the flights take off from. */
const GAME = "game:artemis";
/** Flights and hovers: the craft's damage off (the air's limits as alarms: no wreck stops the measure). */
const FLY: Partial<Settings> = { damage: false, shipMount: "chase" };

const weather = (id: string, depth: BenchMode, w: WeatherPreset, title: Text, mars = false): BenchItem => ({
  id,
  suite: "weather",
  depth,
  scene: GAME,
  title,
  kind: "view",
  weather: w,
  settings: FLY,
  relief: true,
  setup: (g) => (mars ? g.hoverOver("mars", 18.44, 77.45, 1.5) : g.hoverOver("earth", 48.96, 2.44, 1.5)),
});

const flight = (id: string, depth: BenchMode, title: Text, setup: (g: BenchGame) => void, o: Partial<BenchItem> = {}): BenchItem => ({
  id,
  suite: "flights",
  depth,
  scene: GAME,
  title,
  kind: "flight",
  settings: FLY,
  relief: true,
  setup,
  ...o,
});

export const BENCH_ITEMS: BenchItem[] = [
  // ---- the heavy worlds
  view(
    "worlds",
    "yosemite",
    "quick",
    "Earth: Yosemite Valley from Tunnel View",
    { fr: "Yosemite (relief réel)", en: "Yosemite (real ground)" },
    { heavy: true },
  ),
  view(
    "worlds",
    "everest",
    "standard",
    "Earth: Everest at sunset from Kala Patthar",
    { fr: "Everest au coucher", en: "Everest at sunset" },
    { heavy: true },
  ),
  view("worlds", "amazon", "standard", "Earth: low orbit over the Amazon", { fr: "Orbite basse, Amazonie", en: "Low orbit, the Amazon" }),
  view("worlds", "miller-sea", "standard", "Miller: the shallow sea", {
    fr: "Miller : la mer peu profonde",
    en: "Miller: the shallow sea",
  }),
  view(
    "worlds",
    "cevennes",
    "complete",
    "Earth: Saint-Jean-de-Valériscle, the Cévennes",
    { fr: "Les Cévennes", en: "The Cévennes" },
    { heavy: true },
  ),
  view("worlds", "japan-night", "complete", "Earth: the night side, Japan's lights", {
    fr: "Nuit, lumières du Japon",
    en: "Night, Japan's lights",
  }),
  view("worlds", "eclipse", "complete", "Earth: total eclipse over Burgos, 12 Aug 2026", {
    fr: "Éclipse totale, Burgos",
    en: "Total eclipse, Burgos",
  }),
  view("worlds", "titan", "complete", "Titan: the orange haze", { fr: "Titan, la brume", en: "Titan, the haze" }),
  view("worlds", "volumetric", "complete", "Cinematic: volumetric disk + jet", {
    fr: "Disque volumétrique + jet",
    en: "Volumetric disk + jet",
  }),
  view("worlds", "himalaya", "full", "Earth: the Himalaya from orbit", { fr: "L'Himalaya depuis l'orbite", en: "The Himalaya from orbit" }),
  view("worlds", "saturn-rings", "full", "Saturn: the rings from above", { fr: "Saturne, les anneaux", en: "Saturn, the rings" }),
  view("worlds", "mars-sunset", "full", "Mars: the blue sunset", { fr: "Mars, le coucher bleu", en: "Mars, the blue sunset" }),
  view("worlds", "mann-glaciers", "full", "Mann: the glaciers", { fr: "Mann, les glaciers", en: "Mann, the glaciers" }),
  view("worlds", "liquid-wormhole", "full", "Cinematic: the liquid wormhole", { fr: "Le trou de ver liquide", en: "The liquid wormhole" }),
  // ---- the vessels
  view("vessels", "iss", "quick", "Earth: docking to the ISS", { fr: "Amarrage à l'ISS", en: "Docking to the ISS" }),
  view(
    "vessels",
    "cabin",
    "standard",
    GAME,
    { fr: "Le Ranger, vue cabine", en: "The Ranger, cabin view" },
    { settings: { shipMount: "cabin" } },
  ),
  view("vessels", "endurance", "standard", "Earth: the Endurance, 800 km up", {
    fr: "L'Endurance, 800 km",
    en: "The Endurance, 800 km up",
  }),
  view("vessels", "endurance-spin", "complete", "Earth: the Endurance tumbling, 300 km up", {
    fr: "L'Endurance en rotation",
    en: "The Endurance tumbling",
  }),
  view("vessels", "endurance-gargantua", "complete", "Interstellar: the Endurance before Gargantua", {
    fr: "L'Endurance devant Gargantua",
    en: "The Endurance before Gargantua",
  }),
  view("vessels", "lander", "full", "Earth: the Lander, 500 km up", { fr: "Le Lander, 500 km", en: "The Lander, 500 km up" }),
  // ---- the weather (the Ranger hovering 1.5 km over Le Bourget)
  weather("wx-fair", "quick", "fair", { fr: "Beau temps", en: "Fair" }),
  weather("wx-storm", "quick", "storm", { fr: "Orage", en: "Thunderstorm" }),
  weather("wx-fog", "standard", "fog", { fr: "Brouillard", en: "Fog" }),
  weather("wx-overcast", "standard", "overcast", { fr: "Couvert", en: "Overcast" }),
  weather("wx-rain", "complete", "rain", { fr: "Pluie", en: "Rain" }),
  weather("wx-cloudy", "complete", "cloudy", { fr: "Nuageux", en: "Cloudy" }),
  weather("wx-windy", "full", "windy", { fr: "Vent fort", en: "Windy" }),
  weather("wx-dust", "full", "dust", { fr: "Poussière sur Mars", en: "Dust on Mars" }, true),
  // ---- the flights (flown in real time by the autopilots)
  flight("final-edwards", "quick", { fr: "Finale sur Edwards", en: "Final to Edwards" }, (g) => g.glideTo("Edwards", 8, 0.8, 170)),
  flight("entry-edwards", "standard", { fr: "Planée d'entrée, 25 km", en: "Entry glide, 25 km up" }, (g) => g.glideTo("Edwards")),
  flight(
    "storm-kennedy",
    "standard",
    { fr: "Finale dans l'orage, Kennedy", en: "Final in a storm, Kennedy" },
    (g) => g.glideTo("Kennedy", 10, 1, 180),
    {
      weather: "storm",
    },
  ),
  flight(
    "fog-bourget",
    "complete",
    { fr: "Finale dans le brouillard, Le Bourget", en: "Final in fog, Le Bourget" },
    (g) => g.glideTo("Bourget", 8, 0.8, 170),
    {
      weather: "fog",
    },
  ),
  flight("cabin-final", "complete", { fr: "Finale en cabine", en: "Final from the cabin" }, (g) => g.glideTo("Edwards", 8, 0.8, 170), {
    settings: { ...FLY, shipMount: "cabin" },
  }),
  flight("leo", "complete", { fr: "Orbite basse, 400 km", en: "Low orbit, 400 km" }, (g) => g.orbit("earth", { altKm: 400, inc: 51.6 })),
  flight("moon-hover", "full", { fr: "Vol stationnaire sur la Lune", en: "Hovering over the Moon" }, (g) =>
    g.hoverOver("moon", 0.674, 23.473, 1.5),
  ),
  flight("gargantua-orbit", "full", { fr: "Orbite de Gargantua", en: "Orbit of Gargantua" }, (g) => g.orbit("gargantua", { rM: 30 }), {
    relief: false,
  }),
];

/** The items a run takes: its depth's and the lesser ones', of the suites chosen. */
export function itemsFor(mode: BenchMode, suites: SuiteId[]): BenchItem[] {
  return BENCH_ITEMS.filter((i) => suites.includes(i.suite) && DEPTH_RANK[i.depth] <= DEPTH_RANK[mode]);
}

/** A view's timing per depth [ms]: warmed, measured as in the game, then warmed and measured at the fixed setting (0: none). */
export const VIEW_TIMING: Record<BenchMode, { warm: number; auto: number; fixedWarm: number; fixed: number }> = {
  quick: { warm: 1500, auto: 3000, fixedWarm: 0, fixed: 0 },
  standard: { warm: 2500, auto: 5000, fixedWarm: 1500, fixed: 3000 },
  complete: { warm: 3000, auto: 7000, fixedWarm: 2000, fixed: 4000 },
  full: { warm: 4000, auto: 10000, fixedWarm: 2500, fixed: 5000 },
};

/** A flight's timing per depth [ms]: flown before measuring, then measured as it flies. */
export const FLIGHT_TIMING: Record<BenchMode, { warm: number; ms: number }> = {
  quick: { warm: 2000, ms: 8000 },
  standard: { warm: 2500, ms: 15000 },
  complete: { warm: 3000, ms: 25000 },
  full: { warm: 3000, ms: 40000 },
};

/** An item's estimated wall time [s]: its timing, the scene's change, its tiles (a guess: the first visit's). */
export function itemSeconds(i: BenchItem, mode: BenchMode): number {
  if (i.kind === "flight") {
    const t = FLIGHT_TIMING[mode];
    return (t.warm + t.ms) / 1000 + 9;
  }
  const t = VIEW_TIMING[mode];
  return (t.warm + t.auto + t.fixedWarm + t.fixed) / 1000 + (i.heavy ? 20 : 7) + (i.relief ? 2 : 0);
}
