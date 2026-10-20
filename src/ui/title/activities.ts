// What the title screen offers (PLAN-TITRE-AAA E2): the four ways to play — on foot, by plane, by ship, the free
// camera — each with the things to launch in it, and the "More…" ones. Data only: each entry's run is handed the
// game (TitleGame) once it is there — a choice made while the game still loads waits for it (ui/title/title.ts).
// E4–E6 will give each mode its launch screen; these are its first, direct entries.

import type { Text } from "../../i18n";

/** The game, as the title screen launches things in it (main.ts implements it once the game is built). */
export interface TitleGame {
  /** into the game behind the screen (the flight saved last, loaded behind it; or the one left) */
  resume(): void;
  /** on foot, there (the ship set down beside) */
  walk(body: string, lat: number, lon: number): void;
  /** the F-35B lined up on a runway */
  jet(): void;
  /** the flight's preparation (field, start, hour, weather) */
  flightHub(): void;
  /** the F-35's challenges, fights and missions */
  challenges(): void;
  /** the flight school's lessons */
  school(): void;
  /** the space missions' briefings */
  missions(): void;
  /** a scene of the gallery */
  scene(name: string): void;
  /** the craft chosen, in a circular orbit about a body */
  orbit(body: string, altKm: number): void;
  /** the craft flown */
  vessel(id: VesselChoice): void;
  /** where to place the ship */
  place(): void;
  /** the maps of the Earth, the Moon, Mars: a place to go */
  atlas(): void;
  /** the gallery of scenes (a group of them) */
  scenes(group?: string): void;
  photo(): void;
  network(): void;
  networkShown(): boolean;
  editor(): void;
  controls(): void;
  settings(): void;
  /** a saved game loaded (its name, or "autosave"): what it says */
  load(name: string): string;
  /** the Kerr Bench (the page reloaded for it) */
  bench(): void;
  /** a message on the screen */
  toast(text: string): void;
}

export type VesselChoice = "ranger" | "lander" | "endurance";
export type ModeId = "foot" | "plane" | "ship" | "free";

export interface Activity {
  id: string;
  title: Text;
  hint: Text;
  /** its picture: a scene's thumbnail (ui/scene-thumbs.ts) */
  art?: string;
  /** a panel opened rather than a place reached (no "launching" said meanwhile) */
  opens?: boolean;
  /** flown in the craft chosen (by ship): its turntable shown, not a picture */
  craft?: boolean;
  run(g: TitleGame, o: { vessel: VesselChoice }): void;
}

export interface Mode {
  id: ModeId;
  title: Text;
  pitch: Text;
  /** the craft is chosen here (by ship) */
  vessels?: boolean;
  activities: Activity[];
}

export const MODES: Mode[] = [
  {
    id: "foot",
    title: { fr: "À pied", en: "On foot" },
    pitch: { fr: "Marcher sur la Lune, la Terre, Mars", en: "Walk the Moon, the Earth, Mars" },
    activities: [
      {
        id: "foot-moon",
        title: { fr: "Lune — mer de la Tranquillité", en: "Moon — the Sea of Tranquility" },
        hint: { fr: "Là où Apollo 11 s'est posé, la Terre haut dans le ciel", en: "Where Apollo 11 set down, the Earth high in the sky" },
        art: "Moon: an afternoon on the plains",
        run: (g) => g.walk("moon", 0.674, 23.473),
      },
      {
        id: "foot-earth",
        title: { fr: "Terre — face au Mont-Blanc", en: "Earth — facing Mont Blanc" },
        hint: { fr: "Le lac Blanc, à 2 352 m, le massif en face", en: "The Lac Blanc, 2 352 m up, the range across" },
        art: "Earth: Mont Blanc from the Lac Blanc",
        run: (g) => g.walk("earth", 45.9794, 6.8908),
      },
      {
        id: "foot-mars",
        title: { fr: "Mars — le cratère Gale", en: "Mars — Gale crater" },
        hint: { fr: "Le terrain de Curiosity, le mont Sharp au loin", en: "Curiosity's ground, Mount Sharp afar" },
        art: "Mars: the blue sunset",
        run: (g) => g.walk("mars", -4.589, 137.441),
      },
      {
        id: "foot-atlas",
        title: { fr: "Choisir sur la carte…", en: "Choose on the map…" },
        hint: { fr: "L'Atlas : la Terre, la Lune, Mars — n'importe où", en: "The Atlas: the Earth, the Moon, Mars — anywhere" },
        opens: true,
        run: (g) => g.atlas(),
      },
    ],
  },
  {
    id: "plane",
    title: { fr: "En avion", en: "By plane" },
    pitch: { fr: "F-35B : vol libre, combat, leçons, défis", en: "F-35B: free flight, combat, lessons, challenges" },
    activities: [
      {
        id: "plane-takeoff",
        title: { fr: "Décoller maintenant", en: "Take off now" },
        hint: { fr: "Le F-35B aligné sur la piste, moteur en route", en: "The F-35B lined up on the runway, engine running" },
        run: (g) => g.jet(),
      },
      {
        id: "plane-prepare",
        title: { fr: "Préparer un vol", en: "Prepare a flight" },
        hint: { fr: "L'aérodrome, le départ, l'heure, la météo", en: "The field, the start, the hour, the weather" },
        opens: true,
        run: (g) => g.flightHub(),
      },
      {
        id: "plane-combat",
        title: { fr: "Combat, défis et missions", en: "Combat, challenges and missions" },
        hint: { fr: "Interceptions, combats tournoyants, frappes, voltige", en: "Intercepts, dogfights, strikes, aerobatics" },
        opens: true,
        run: (g) => g.challenges(),
      },
      {
        id: "plane-school",
        title: { fr: "École de vol", en: "Flight school" },
        hint: { fr: "Démonstrations, leçons guidées, essais notés", en: "Demonstrations, guided lessons, graded tries" },
        opens: true,
        run: (g) => g.school(),
      },
    ],
  },
  {
    id: "ship",
    title: { fr: "En vaisseau", en: "By ship" },
    pitch: { fr: "Ranger, Lander, Endurance : l'orbite, la Lune, Gargantua", en: "Ranger, Lander, Endurance: orbit, the Moon, Gargantua" },
    vessels: true,
    activities: [
      {
        id: "ship-orbit",
        title: { fr: "Orbite basse terrestre", en: "Low Earth orbit" },
        hint: { fr: "400 km au-dessus de la Terre, avec le vaisseau choisi", en: "400 km above the Earth, in the craft chosen" },
        craft: true,
        run: (g, o) => {
          g.vessel(o.vessel);
          g.orbit("earth", 400);
        },
      },
      {
        id: "ship-artemis",
        title: { fr: "Artemis II — autour de la Lune", en: "Artemis II — around the Moon" },
        hint: { fr: "Un retour libre, planifié puis volé", en: "A free return, planned then flown" },
        art: "game:artemis",
        run: (g) => g.scene("game:artemis"),
      },
      {
        id: "ship-iss",
        title: { fr: "Amarrage à l'ISS", en: "Docking to the ISS" },
        hint: { fr: "Soixante mètres, un port, une approche", en: "Sixty metres, a port, an approach" },
        art: "Earth: docking to the ISS",
        run: (g) => g.scene("Earth: docking to the ISS"),
      },
      {
        id: "ship-gargantua",
        title: { fr: "Vers Gargantua", en: "On to Gargantua" },
        hint: { fr: "Le Ranger en orbite au bord du disque", en: "The Ranger orbiting at the disk's edge" },
        art: "Ranger: approaching Gargantua",
        run: (g) => g.scene("Ranger: approaching Gargantua"),
      },
      {
        id: "ship-missions",
        title: { fr: "Toutes les missions…", en: "Every mission…" },
        hint: { fr: "Le voyage, Artemis, le trou de ver, Gargantua", en: "The journey, Artemis, the wormhole, Gargantua" },
        opens: true,
        run: (g) => g.missions(),
      },
      {
        id: "ship-place",
        title: { fr: "Placer le vaisseau…", en: "Place the ship…" },
        hint: { fr: "En orbite, au sol, près d'un corps, au trou de ver", en: "In orbit, on the ground, near a body, at the wormhole" },
        opens: true,
        craft: true,
        run: (g, o) => {
          g.vessel(o.vessel);
          g.place();
        },
      },
    ],
  },
  {
    id: "free",
    title: { fr: "Caméra libre", en: "Free camera" },
    pitch: { fr: "Les trous noirs, le trou de ver, Gargantua", en: "The black holes, the wormhole, Gargantua" },
    activities: [
      {
        id: "free-film",
        title: { fr: "Gargantua — le passage du film", en: "Gargantua — the film's close pass" },
        hint: { fr: "Le long du disque, sa face cachée dressée en mur", en: "Along the disk, its far side raised as a wall" },
        art: "Interstellar: along the disk (the film's close pass)",
        run: (g) => g.scene("Interstellar: along the disk (the film's close pass)"),
      },
      {
        id: "free-kerr",
        title: { fr: "Un trou noir de Kerr", en: "A Kerr black hole" },
        hint: { fr: "a = 0,94, presque par la tranche, son jet", en: "a = 0.94, nearly edge-on, its jet" },
        art: "Kerr a=0.94, near edge-on",
        run: (g) => g.scene("Kerr a=0.94, near edge-on"),
      },
      {
        id: "free-wormhole",
        title: { fr: "Le trou de ver", en: "The wormhole" },
        hint: { fr: "Près de Saturne, la sphère qui mène à Gargantua", en: "By Saturn, the sphere that leads to Gargantua" },
        art: "Interstellar: wormhole to Gargantua",
        run: (g) => g.scene("Interstellar: wormhole to Gargantua"),
      },
      {
        id: "free-system",
        title: { fr: "Le système de Gargantua", en: "The Gargantua system" },
        hint: { fr: "Miller, Mann, Edmunds et leur étoile", en: "Miller, Mann, Edmunds and their star" },
        art: "Gargantua system (10⁸ M☉, a* = 0.998)",
        run: (g) => g.scene("Gargantua system (10⁸ M☉, a* = 0.998)"),
      },
      {
        id: "free-all",
        title: { fr: "Toutes les destinations…", en: "Every destination…" },
        hint: {
          fr: "Les trous noirs, Gargantua, la Terre, le système solaire",
          en: "The black holes, Gargantua, the Earth, the solar system",
        },
        opens: true,
        run: (g) => g.scenes("hole"),
      },
    ],
  },
];

export const VESSELS: { id: VesselChoice; title: string; hint: Text }[] = [
  {
    id: "ranger",
    title: "Ranger",
    hint: { fr: "Le vaisseau à tout faire, de la piste à l'orbite", en: "The all-rounder, from the runway to orbit" },
  },
  { id: "lander", title: "Lander", hint: { fr: "Le module lourd : la Lune, Mars", en: "The heavy module: the Moon, Mars" } },
  { id: "endurance", title: "Endurance", hint: { fr: "L'anneau du film, à 800 km", en: "The film's ring, 800 km up" } },
];

/** "More…": the rest of the game. */
export const MORE: Activity[] = [
  {
    id: "more-scenes",
    title: { fr: "Toutes les scènes", en: "Every scene" },
    hint: {
      fr: "La galerie : la Terre, le système solaire, les trous noirs",
      en: "The gallery: the Earth, the solar system, the black holes",
    },
    opens: true,
    run: (g) => g.scenes(),
  },
  {
    id: "more-photo",
    title: { fr: "Mode photo et rendus", en: "Photo mode and renders" },
    hint: { fr: "La vue seule, le rendu hors ligne, la vidéo", en: "The view alone, the offline render, the video" },
    opens: true,
    run: (g) => g.photo(),
  },
  {
    id: "more-network",
    title: { fr: "Jouer ensemble", en: "Play together" },
    hint: { fr: "Une salle de 2 à 4, en vol ou en combat", en: "A room of 2 to 4, flying or fighting" },
    opens: true,
    run: (g) => g.network(),
  },
  {
    id: "more-editor",
    title: { fr: "Éditeur de missions", en: "Mission editor" },
    hint: { fr: "Faire la sienne, la partager par un lien", en: "Make your own, share it by a link" },
    opens: true,
    run: (g) => g.editor(),
  },
  {
    id: "more-controls",
    title: { fr: "Commandes", en: "Controls" },
    hint: { fr: "Le clavier, la manette, le HOTAS", en: "The keyboard, the gamepad, the HOTAS" },
    opens: true,
    run: (g) => g.controls(),
  },
  {
    id: "more-bench",
    title: { fr: "Kerr Bench", en: "Kerr Bench" },
    hint: { fr: "Mesurer cette machine (la page se recharge)", en: "Measure this machine (the page reloads)" },
    opens: true,
    run: (g) => g.bench(),
  },
];
