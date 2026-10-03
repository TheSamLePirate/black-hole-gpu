// The game's missions: the scenes one plays, each with its briefing — what it is, what to do, the keys
// that do it — in French and English (ui/missions.ts shows them; a mission is launched by its scene).

import type { Text } from "../i18n";

export interface Mission {
  /** the scene that starts it (settings.ts presets) */
  scene: string;
  title: Text;
  /** a line under the title */
  tagline: Text;
  briefing: Text;
  objectives: Text[];
  /** the keys that matter here: [keys, what they do] */
  keys: [string, Text][];
  /** 1 easy · 2 · 3 demanding */
  difficulty: 1 | 2 | 3;
  /** about how long [min] */
  minutes: number;
}

export const MISSIONS: Mission[] = [
  {
    scene: "game:artemis",
    title: { fr: "Artemis II — autour de la Lune", en: "Artemis II — around the Moon" },
    tagline: { fr: "Un retour libre, planifié puis volé", en: "A free return, planned then flown" },
    briefing: {
      fr: "En orbite basse à 400 km, la Lune en cible. Préparez une trajectoire de retour libre avec l'ordinateur de vol, exécutez l'injection translunaire, puis laissez la mécanique céleste vous ramener.",
      en: "In low orbit at 400 km, the Moon targeted. Plan a free-return trajectory with the flight computer, execute the trans-lunar injection, and let celestial mechanics bring you home.",
    },
    objectives: [
      { fr: "Ouvrir l'onglet MISSION de l'ordinateur de vol (O)", en: "Open the flight computer's MISSION tab (O)" },
      { fr: "Planifier un retour libre, puis EXÉCUTER", en: "Plan a free return, then EXECUTE" },
      { fr: "Passer derrière la Lune et revenir vers la Terre", en: "Swing behind the Moon and back to the Earth" },
    ],
    keys: [
      ["O", { fr: "ordinateur de vol, onglet mission", en: "flight computer, mission tab" }],
      ["M", { fr: "la carte 3D", en: "the 3D map" }],
      ["1 – 7", { fr: "maintiens (prograde, rétrograde…)", en: "holds (prograde, retrograde…)" }],
      [". ,", { fr: "accélérer · ralentir le temps", en: "time warp faster · slower" }],
    ],
    difficulty: 2,
    minutes: 15,
  },
  {
    scene: "Earth: docking to the ISS",
    title: { fr: "Amarrage à l'ISS", en: "Docking to the ISS" },
    tagline: { fr: "Soixante mètres, un port, une approche", en: "Sixty metres, one port, one approach" },
    briefing: {
      fr: "Le Ranger est à 60 m de la station spatiale, sur la même orbite. Alignez-vous sur le port, approchez sous 0,2 m/s et amarrez-vous — à la main avec les propulseurs de translation, ou avec l'autopilote d'amarrage.",
      en: "The Ranger is 60 m from the space station, on the same orbit. Line up with the port, close in under 0.2 m/s and dock — by hand with the translation thrusters, or with the docking autopilot.",
    },
    objectives: [
      { fr: "Aligner le vaisseau sur l'axe du port", en: "Line the ship up with the port's axis" },
      { fr: "Approcher à moins de 0,2 m/s", en: "Close in below 0.2 m/s" },
      { fr: "Toucher le port : amarré", en: "Touch the port: docked" },
    ],
    keys: [
      ["I K · J L · H N", { fr: "translation (RCS)", en: "translation (RCS)" }],
      ["Caps Lock", { fr: "commandes de précision", en: "precision controls" }],
      ["B", { fr: "autopilote d'amarrage", en: "docking autopilot" }],
      ["⌫", { fr: "rendre les commandes", en: "release the controls" }],
    ],
    difficulty: 2,
    minutes: 8,
  },
  {
    scene: "Moon: an afternoon on the plains",
    title: { fr: "Décollage lunaire", en: "Lunar take-off" },
    tagline: { fr: "Des plaines de la Lune à l'orbite", en: "From the Moon's plains to orbit" },
    briefing: {
      fr: "Posé sur une plaine lunaire, en plein après-midi. Décollez, mettez-vous en orbite basse, puis — si le cœur vous en dit — reposez-vous.",
      en: "Landed on a lunar plain, in the afternoon. Take off, reach a low orbit, then — if you feel like it — land again.",
    },
    objectives: [
      { fr: "Décoller (U : l'autopilote, ou à la main)", en: "Take off (U: the autopilot, or by hand)" },
      { fr: "Circulariser en orbite basse (9)", en: "Circularize in a low orbit (9)" },
      { fr: "Se reposer (G)", en: "Land again (G)" },
    ],
    keys: [
      ["U", { fr: "décollage automatique", en: "automatic take-off" }],
      ["9", { fr: "circulariser", en: "circularize" }],
      ["G", { fr: "atterrissage automatique", en: "automatic landing" }],
      ["⇧ · Alt", { fr: "gaz plus · moins", en: "throttle up · down" }],
    ],
    difficulty: 1,
    minutes: 6,
  },
  {
    scene: "game:interstellar",
    title: { fr: "Interstellar — le voyage", en: "Interstellar — the journey" },
    tagline: { fr: "De Cap Canaveral à Gargantua, en temps réel", en: "From Cape Canaveral to Gargantua, in real time" },
    briefing: {
      fr: "2067, sur le pas de tir du Kennedy Space Center. Décollez, atteignez Saturne et le trou de ver qui orbite près d'elle, traversez-le, puis approchez Gargantua. Distances réelles, temps réel — l'accélération du temps est votre alliée.",
      en: "2067, on the pad at the Kennedy Space Center. Take off, reach Saturn and the wormhole orbiting near it, go through, then approach Gargantua. Real distances, real time — the time warp is your friend.",
    },
    objectives: [
      { fr: "Atteindre l'orbite terrestre", en: "Reach Earth orbit" },
      { fr: "Transférer vers Saturne (ordinateur de vol, MISSION)", en: "Transfer to Saturn (flight computer, MISSION)" },
      { fr: "Traverser le trou de ver jusqu'à Gargantua", en: "Go through the wormhole to Gargantua" },
    ],
    keys: [
      ["U", { fr: "décollage", en: "take off" }],
      ["O", { fr: "ordinateur de vol", en: "flight computer" }],
      [". ,", { fr: "accélérer · ralentir le temps", en: "time warp faster · slower" }],
      ["F5", { fr: "sauvegarde rapide", en: "quick save" }],
    ],
    difficulty: 3,
    minutes: 60,
  },
  {
    scene: "Ranger: approaching Gargantua",
    title: { fr: "Ranger : approche de Gargantua", en: "Ranger: approaching Gargantua" },
    tagline: { fr: "Une orbite circulaire au bord du gouffre", en: "A circular orbit at the edge of the abyss" },
    briefing: {
      fr: "Le Ranger sur une orbite circulaire autour de Gargantua, le disque d'accrétion devant. La relativité générale ne pardonne pas : sous l'ISCO, aucune orbite ne tient.",
      en: "The Ranger on a circular orbit about Gargantua, the accretion disk ahead. General relativity does not forgive: below the ISCO, no orbit holds.",
    },
    objectives: [
      { fr: "Observer le disque et l'ombre depuis le cockpit (V)", en: "Watch the disk and the shadow from the cockpit (V)" },
      { fr: "Changer d'orbite sans franchir l'ISCO", en: "Change orbit without crossing the ISCO" },
    ],
    keys: [
      ["V", { fr: "vue suivante", en: "next view" }],
      ["Z · X", { fr: "plein gaz · coupé", en: "full throttle · cut" }],
      ["1 · 2", { fr: "maintien prograde · rétrograde", en: "hold prograde · retrograde" }],
    ],
    difficulty: 2,
    minutes: 10,
  },
  {
    scene: "Mission: through the wormhole to the companion star (automatic flight)",
    title: { fr: "À travers le trou de ver", en: "Through the wormhole" },
    tagline: { fr: "Un vol automatique, à regarder", en: "An automatic flight, to watch" },
    briefing: {
      fr: "Le Ranger vole seul : à travers la gorge du trou de ver jusqu'à l'étoile compagne de Gargantua. Changez de vue, accélérez le temps, regardez le ciel se déformer.",
      en: "The Ranger flies itself: through the wormhole's throat to Gargantua's companion star. Change the view, warp the time, watch the sky bend.",
    },
    objectives: [{ fr: "Regarder — ⌫ reprend les commandes", en: "Watch — ⌫ takes the controls" }],
    keys: [
      ["V", { fr: "vue suivante", en: "next view" }],
      [". ,", { fr: "accélérer · ralentir le temps", en: "time warp faster · slower" }],
      ["⌫", { fr: "reprendre les commandes", en: "take the controls" }],
    ],
    difficulty: 1,
    minutes: 5,
  },
];
