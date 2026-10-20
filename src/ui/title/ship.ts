// By ship, on the title (PLAN-TITRE-AAA E5): the hangar's three craft — each its sheet (what it is for, its mass, its
// engines' push, whether it lands, whether it flies in the air) —, the missions and scenes flown in it, and the free
// destinations it can reach: the orbits for all, the grounds only for a craft that lands (the Endurance never
// does). Data only: the screen is ui/title/title.ts's, the launches the game's (TitleGame).

import { MISSIONS } from "../../game/missions";
import { lang, type Text, tr } from "../../i18n";
import { VESSELS } from "../../vessels";
import type { TitleGame, VesselChoice } from "./activities";

export interface CraftSheet {
  id: VesselChoice;
  name: string;
  role: Text;
  /** [tonnes] */
  massT: number;
  /** its engines' push against the Ranger's (at full tanks) */
  accel: number;
  lands: boolean;
  flies: boolean;
}

const ROLE: Record<VesselChoice, Text> = {
  ranger: {
    fr: "Le vaisseau à tout faire : il décolle d'une piste, monte en orbite, se pose sur la Lune ou Mars et revient planer jusqu'à une piste.",
    en: "The all-rounder: it takes off from a runway, climbs to orbit, lands on the Moon or Mars and glides back to a runway.",
  },
  lander: {
    fr: "Le module lourd : quatre fois la masse du Ranger, fait pour descendre sur un sol et en repartir — la Lune, Mars.",
    en: "The heavy module: four times the Ranger's mass, made to go down to a ground and leave it again — the Moon, Mars.",
  },
  endurance: {
    fr: "L'anneau du film : 900 t, ses modules en couronne. Il ne se pose jamais : il vit en orbite, d'un monde à l'autre.",
    en: "The film's ring: 900 t, its modules in a crown. It never lands: it lives in orbit, from one world to the next.",
  },
};

/** The three craft's sheets, from their definitions (vessels.ts). */
export const CRAFT: CraftSheet[] = (["ranger", "lander", "endurance"] as const).map((id) => ({
  id,
  name: VESSELS[id].name,
  role: ROLE[id],
  massT: Math.round(VESSELS[id].mass / 1000),
  accel: VESSELS[id].accel,
  lands: VESSELS[id].lands,
  flies: VESSELS[id].flies,
}));

/** A sheet's lines: [what, its value] — in the interface's language. */
export function sheetLines(c: CraftSheet, l = lang): [string, string][] {
  const fr = l === "fr";
  const yes = fr ? "oui" : "yes",
    no = fr ? "non" : "no";
  return [
    [fr ? "Masse" : "Mass", `${c.massT.toLocaleString(fr ? "fr-FR" : "en-GB")} t`],
    [fr ? "Poussée (Ranger = 1)" : "Push (Ranger = 1)", `× ${c.accel.toFixed(2).replace(/\.?0+$/, "")}`],
    [fr ? "Se pose" : "Lands", c.lands ? yes : no],
    [fr ? "Vole dans l'air" : "Flies in the air", c.flies ? yes : no],
  ];
}

/** A launch of By ship: a mission or a scene (its scene), or a free destination (where, in the craft chosen). */
export interface ShipItem {
  id: string;
  title: Text;
  text: Text;
  /** its picture: a scene's thumbnail */
  art?: string;
  /** a mission's or a scene's: launched as it is, its own craft */
  scene?: string;
  /** a free destination's: flown in the craft chosen */
  go?:
    | { kind: "orbit"; body: string; altKm: number }
    | { kind: "land"; body: string; lat: number; lon: number }
    | { kind: "near"; body: string; altKm: number }
    | { kind: "wormhole"; side: "ours" | "gargantua" };
  /** a ground reached: only for a craft that lands */
  ground?: boolean;
  /** a mission's briefing: the preview's text (the list shows its line) */
  brief?: Text;
  /** a mission's: how hard, how long */
  mark?: Text;
  /** why the craft chosen cannot go there (shown, not launched) */
  locked?: Text;
}

const DOTS = (n: number) => "●".repeat(n) + "○".repeat(3 - n);

/** each craft's missions and scenes: the game's missions are the Ranger's (their scenes fly it) */
const SCENES: Record<VesselChoice, ShipItem[]> = {
  ranger: MISSIONS.map((m) => ({
    id: `mission:${m.scene}`,
    title: m.title,
    text: m.tagline,
    brief: m.briefing,
    art: m.scene,
    scene: m.scene,
    mark: { fr: `${DOTS(m.difficulty)} · ~${m.minutes} min`, en: `${DOTS(m.difficulty)} · ~${m.minutes} min` },
  })),
  lander: [
    {
      id: "scene:lander-500",
      title: { fr: "Le Lander à 500 km", en: "The Lander, 500 km up" },
      text: { fr: "En orbite au-dessus de la Terre, prêt à descendre", en: "In orbit above the Earth, ready to go down" },
      art: "Earth: the Lander, 500 km up",
      scene: "Earth: the Lander, 500 km up",
    },
  ],
  endurance: [
    {
      id: "scene:endurance-800",
      title: { fr: "L'Endurance à 800 km", en: "The Endurance, 800 km up" },
      text: { fr: "L'anneau en orbite au-dessus de la Terre", en: "The ring in orbit above the Earth" },
      art: "Earth: the Endurance, 800 km up",
      scene: "Earth: the Endurance, 800 km up",
    },
    {
      id: "scene:endurance-gargantua",
      title: { fr: "L'Endurance devant Gargantua", en: "The Endurance before Gargantua" },
      text: {
        fr: "Le plan large du film : l'anneau sur son orbite, au ras du disque",
        en: "The film's wide shot: the ring on its orbit, just above the disk",
      },
      art: "Interstellar: the Endurance before Gargantua",
      scene: "Interstellar: the Endurance before Gargantua",
    },
  ],
};

/** the free destinations: where any craft can go — the grounds only for one that lands */
export const DESTINATIONS: ShipItem[] = [
  {
    id: "dest:earth-orbit",
    title: { fr: "Orbite basse terrestre", en: "Low Earth orbit" },
    text: { fr: "400 km au-dessus de la Terre", en: "400 km above the Earth" },
    art: "Earth: low orbit over the Amazon",
    go: { kind: "orbit", body: "earth", altKm: 400 },
  },
  {
    id: "dest:moon-orbit",
    title: { fr: "Orbite lunaire", en: "Lunar orbit" },
    text: { fr: "100 km au-dessus de la Lune", en: "100 km above the Moon" },
    art: "Moon: the terminator from orbit",
    go: { kind: "orbit", body: "moon", altKm: 100 },
  },
  {
    id: "dest:moon-ground",
    title: { fr: "Posé sur la Lune", en: "Landed on the Moon" },
    text: { fr: "La mer de la Tranquillité, là où Apollo 11 s'est posé", en: "The Sea of Tranquility, where Apollo 11 set down" },
    art: "Moon: an afternoon on the plains",
    go: { kind: "land", body: "moon", lat: 0.674, lon: 23.473 },
    ground: true,
  },
  {
    id: "dest:mars-orbit",
    title: { fr: "Orbite martienne", en: "Martian orbit" },
    text: { fr: "300 km au-dessus de Mars", en: "300 km above Mars" },
    art: "Mars: from orbit",
    go: { kind: "orbit", body: "mars", altKm: 300 },
  },
  {
    id: "dest:mars-ground",
    title: { fr: "Posé sur Mars", en: "Landed on Mars" },
    text: { fr: "Le cratère Gale, le mont Sharp au loin", en: "Gale crater, Mount Sharp afar" },
    art: "Mars: the blue sunset",
    go: { kind: "land", body: "mars", lat: -4.589, lon: 137.441 },
    ground: true,
  },
  {
    id: "dest:saturn",
    title: { fr: "Près de Saturne", en: "Near Saturn" },
    text: { fr: "Les anneaux à portée, le trou de ver pas loin", en: "The rings at hand, the wormhole not far" },
    art: "Saturn: backlit",
    go: { kind: "near", body: "saturn", altKm: 150000 },
  },
  {
    id: "dest:wormhole",
    title: { fr: "Le trou de ver", en: "The wormhole" },
    text: { fr: "Devant la sphère, de notre côté", en: "Before the sphere, on our side" },
    art: "Interstellar: wormhole to Gargantua",
    go: { kind: "wormhole", side: "ours" },
  },
  {
    id: "dest:gargantua",
    title: { fr: "Du côté de Gargantua", en: "Gargantua's side" },
    text: { fr: "Sorti du trou de ver, Gargantua devant soi", en: "Out of the wormhole, Gargantua ahead" },
    art: "Gargantua system: departure near Saturn",
    go: { kind: "wormhole", side: "gargantua" },
  },
];

const NO_GROUND: Text = { fr: "{0} ne se pose jamais — aucun sol ne lui est ouvert", en: "The {0} never lands — no ground is open to it" };

/** What By ship offers a craft: the destinations (a ground locked for one that does not land), then its missions
 *  and scenes. */
export function shipItems(v: VesselChoice): { destinations: ShipItem[]; missions: ShipItem[] } {
  const c = CRAFT.find((x) => x.id === v)!;
  const locked = (d: ShipItem): ShipItem =>
    d.ground && !c.lands
      ? { ...d, locked: { fr: NO_GROUND.fr.replace("{0}", `L'${c.name}`), en: NO_GROUND.en.replace("{0}", c.name) } }
      : d;
  return { destinations: DESTINATIONS.map(locked), missions: SCENES[v] };
}

/** An entry launched in the craft chosen: a mission's scene as it is; a destination, the craft there. */
export function launchShip(g: TitleGame, x: ShipItem, v: VesselChoice) {
  if (x.locked) throw new Error(tr(x.locked));
  if (x.scene) return g.scene(x.scene);
  const go = x.go!;
  g.vessel(v);
  if (go.kind === "orbit") g.orbit(go.body, go.altKm);
  else if (go.kind === "land") g.land(go.body, go.lat, go.lon);
  else if (go.kind === "near") g.near(go.body, go.altKm);
  else g.wormhole(go.side);
}
