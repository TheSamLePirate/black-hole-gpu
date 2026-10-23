// The pause menu's data (PLAN-TITRE-AAA E8): its groups — fewer than ten entries at its first level, the rest in
// drawers —, the context it shows beside (where one is, the mission and its objectives or the flight's figures,
// the time played, the last save, a tip of the mode), and when going back to the title asks first. Pure: the menu
// is ui/pause.ts's, the context main.ts's.

import type { GameMode } from "../game/modes";
import { lang, type Text } from "../i18n";

/** The objectives' states, as the mission runner has them (game/mission.ts) — a listed one: "todo". */
export type ObjectiveState = "done" | "active" | "waiting" | "failed" | "todo";

export interface PauseContext {
  /** the game in a line: the craft (or the walker), where, the date */
  line: string;
  mode: GameMode;
  /** the mission flown, its objectives and their states */
  mission: { title: string; objectives: { text: string; state: ObjectiveState }[] } | null;
  /** without a mission: the flight's (or the place's) figures, [what, value] */
  figures: [string, string][];
  /** the time played this visit [ms] */
  played: number;
  /** the last save (the autosave or one's own) [ms since 1970], null: none */
  savedAt: number | null;
  /** in a room: its common clock does not stop — the game goes on behind the menu */
  room: string | null;
  /** whose tips: the mode's, the F-35's */
  tips: TipSet;
}

export type DrawerId = "capture" | "world" | "sky" | "modes" | "settings";

/** The drawers' entries: their test id (the actions the deps name), their title, their line. */
export const DRAWERS: Record<DrawerId, { title: Text; hint: Text; items: { id: string; title: Text; hint?: Text }[] }> = {
  capture: {
    title: { fr: "Capture", en: "Capture" },
    hint: { fr: "Instant, rendu, photo, surimpression", en: "Instant, render, photo, multiple exposure" },
    items: [
      {
        id: "capture",
        title: { fr: "Capture (rendu hors ligne)", en: "Capture (offline render)" },
        hint: { fr: "La vue de cet instant, rendue sans bruit, en PNG", en: "This instant's view, noise-free, as a PNG" },
      },
      {
        id: "render",
        title: { fr: "Rendu…", en: "Render…" },
        hint: { fr: "Une image ou une vidéo : taille, échantillons, plan", en: "A picture or a video: size, samples, shot" },
      },
      {
        id: "photo",
        title: { fr: "Mode photo", en: "Photo mode" },
        hint: { fr: "La vue seule, l'objectif, l'exposition", en: "The view alone, the lens, the exposure" },
      },
      {
        id: "multi",
        title: { fr: "Surimpression", en: "Multiple exposure" },
        hint: { fr: "Analemme, filé d'étoiles, Lune, éclipse", en: "Analemma, star trails, Moon, eclipse" },
      },
    ],
  },
  world: {
    title: { fr: "Monde", en: "World" },
    hint: { fr: "Atlas, placer, heure, météo", en: "Atlas, place, time, weather" },
    items: [
      {
        id: "atlas",
        title: { fr: "Atlas", en: "Atlas" },
        hint: { fr: "La Terre, la Lune, Mars : y aller", en: "The Earth, the Moon, Mars: go there" },
      },
      {
        id: "place",
        title: { fr: "Placer le vaisseau", en: "Place the ship" },
        hint: { fr: "En orbite, au sol, près d'un corps", en: "In orbit, on the ground, near a body" },
      },
      { id: "time", title: { fr: "Date et heure", en: "Date and time" }, hint: { fr: "L'horloge de la scène", en: "The scene's clock" } },
      {
        id: "weather",
        title: { fr: "Météo", en: "Weather" },
        hint: { fr: "Le ciel de la Terre, réel ou choisi", en: "The Earth's sky, real or chosen" },
      },
      {
        id: "offline",
        title: { fr: "Garder cette zone hors ligne", en: "Keep this zone offline" },
        hint: { fr: "Ses tuiles téléchargées : la voler sans réseau", en: "Its tiles downloaded: fly it without a network" },
      },
    ],
  },
  sky: {
    title: { fr: "Ciel", en: "Sky" },
    hint: { fr: "D'ici, observatoire, éclipses", en: "From here, observatory, eclipses" },
    items: [
      {
        id: "sky",
        title: { fr: "Le ciel d'ici", en: "The sky from here" },
        hint: { fr: "Filés, analemme, ISS, éclipses : les vivre", en: "Trails, analemma, ISS, eclipses: live them" },
      },
      {
        id: "observe",
        title: { fr: "Observatoire", en: "Observatory" },
        hint: { fr: "Ce qu'il y a à voir d'ici, et quand", en: "What to see from here, and when" },
      },
      {
        id: "eclipses",
        title: { fr: "Éclipses", en: "Eclipses" },
        hint: { fr: "Le calculateur : où, quand, combien", en: "The calculator: where, when, how much" },
      },
    ],
  },
  modes: {
    title: { fr: "Changer de mode", en: "Change mode" },
    hint: { fr: "À pied, en avion, en vaisseau, caméra libre", en: "On foot, by plane, by ship, free camera" },
    items: [
      {
        id: "mode-foot",
        title: { fr: "À pied", en: "On foot" },
        hint: { fr: "Un monde, un lieu, une heure", en: "A world, a place, an hour" },
      },
      {
        id: "mode-plane",
        title: { fr: "En avion", en: "By plane" },
        hint: { fr: "Vol libre, combat, école, défis", en: "Free flight, combat, school, challenges" },
      },
      {
        id: "mode-ship",
        title: { fr: "En vaisseau", en: "By ship" },
        hint: { fr: "Le hangar, les missions, les destinations", en: "The hangar, the missions, the destinations" },
      },
      {
        id: "mode-free",
        title: { fr: "Caméra libre", en: "Free camera" },
        hint: { fr: "La galerie : trous noirs, Gargantua…", en: "The gallery: black holes, Gargantua…" },
      },
    ],
  },
  settings: {
    title: { fr: "Réglages", en: "Settings" },
    hint: { fr: "Réglages, commandes, diagnostic", en: "Settings, controls, diagnostic" },
    items: [
      {
        id: "settings",
        title: { fr: "Réglages", en: "Settings" },
        hint: { fr: "L'image, le son, le jeu", en: "The picture, the sound, the game" },
      },
      {
        id: "controls",
        title: { fr: "Commandes", en: "Controls" },
        hint: { fr: "Le clavier, la manette, le HOTAS", en: "The keyboard, the gamepad, the HOTAS" },
      },
      {
        id: "graphics-diagnostic",
        title: { fr: "Diagnostic graphique", en: "Graphics diagnostic" },
        hint: { fr: "Le fichier à joindre à un rapport de bogue", en: "The file to attach to a bug report" },
      },
    ],
  },
};

/** A tip of the mode one plays (one shown each time the menu opens). */
export type TipSet = GameMode | "jet";

export const TIPS: Record<TipSet, Text[]> = {
  jet: [
    {
      fr: "⇧B : le mode STOVL — la soufflante, la tuyère vers le bas, le vol stationnaire",
      en: "⇧B: STOVL mode — the lift fan, the nozzle down, the hover",
    },
    {
      fr: "⇧M : la navigation automatique sur le plan de vol ; ⇧O : le plan de vol",
      en: "⇧M: the autopilot flying the flight plan; ⇧O: the flight plan",
    },
    {
      fr: "En combat : Espace le canon, Entrée l'arme choisie, Tab le verrouillage suivant",
      en: "In a fight: Space the gun, Enter the weapon chosen, Tab the next lock",
    },
    { fr: "⇧L garde la tête sur la cible (padlock)", en: "⇧L keeps the head on the target (padlock)" },
  ],
  ship: [
    {
      fr: "O ouvre l'ordinateur de vol : orbites, manœuvres, rendez-vous",
      en: "O opens the flight computer: orbits, manoeuvres, rendezvous",
    },
    { fr: "M ouvre la carte 3D ; ⇧M les réglages", en: "M opens the 3D map; ⇧M the settings" },
    { fr: "1 à 7 : les maintiens (prograde, rétrograde…)", en: "1 to 7: the holds (prograde, retrograde…)" },
    { fr: ", et . ralentissent et accélèrent le temps", en: ", and . slow down and speed up time" },
  ],
  foot: [
    { fr: "⇧ pour courir, Espace pour sauter", en: "⇧ to run, Space to jump" },
    { fr: "⇧T pose un trépied : le ciel d'ici, à l'heure voulue", en: "⇧T sets a tripod: the sky from here, at any hour" },
    { fr: "⇧K pour remonter à bord", en: "⇧K to board the craft" },
  ],
  free: [
    {
      fr: "Z Q S D et A E pour se déplacer (⇧ plus vite) ; un glisser tourne la vue",
      en: "W A S D and Q E to move (⇧ faster); a drag turns the view",
    },
    { fr: "C garde la cible au centre de la vue", en: "C keeps the target in the middle of the view" },
    { fr: "Y : le télescope", en: "Y: the telescope" },
  ],
  photo: [
    { fr: "La vue se raffine tant que rien ne bouge", en: "The view refines while nothing moves" },
    { fr: "Capture : le même instant, rendu sans bruit", en: "Capture: the same instant, rendered noise-free" },
  ],
};

export const tipOf = (set: TipSet, n: number): Text => {
  const xs = TIPS[set] ?? TIPS.ship;
  return xs[((n % xs.length) + xs.length) % xs.length]!;
};

/** Going back to the title asks first when more than five minutes were played since the last save (or none). */
export const CONFIRM_AFTER_MS = 5 * 60_000;
export function titleNeedsConfirm(c: Pick<PauseContext, "played" | "savedAt">, now: number): boolean {
  if (c.played < CONFIRM_AFTER_MS) return false;
  return c.savedAt === null || now - c.savedAt > CONFIRM_AFTER_MS;
}

/** A duration in a few words: "12 min", "1 h 12", "45 s". */
export function playedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** The objectives' marks: done ✓, failed ✕, the one to do ◇, one still to come · */
export const OBJ_MARK: Record<ObjectiveState, string> = { done: "✓", failed: "✕", active: "◆", todo: "◇", waiting: "·" };

/** "il y a 3 min" / "3 min ago" */
export const agoWords = (ms: number, l = lang) => (l === "fr" ? `il y a ${playedText(ms)}` : `${playedText(ms)} ago`);
