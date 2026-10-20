// The player's settings (PLAN-TITRE-AAA E9): which of the schema's controls (ui/schema.ts — the one source, no
// setting written twice) the player's screen shows, in which tab and group, in which order. Those it does not
// name stay in the Lab (the drawer of every control: the camera, the scene, the matter, the sky, the physics, the
// advanced rendering). Two rows are the screen's own: the quality (its presets) and the language. A setting that
// can leave the screen unreadable (the render scale, the HDR display, the interface's size) comes back by itself
// after 15 s unless kept. Pure (tests/settings-menu.test.ts: every key placed once, every game control ranked).

import { lang, t, type Text, tr } from "../../i18n";
import type { Settings } from "../../settings";
import { type ControlDef, SCHEMA, SCHEMA_BY_KEY } from "../schema";

export type PlayerTab = "game" | "graphics" | "display" | "audio" | "controls" | "access" | "interface" | "network";

/** the screen's own rows: the quality's presets, the language */
export type SpecialRow = "@quality" | "@language";
export type RowKey = keyof Settings | SpecialRow;

export const PLAYER_TABS: { id: PlayerTab; label: Text }[] = [
  { id: "game", label: { fr: "Jeu", en: "Game" } },
  { id: "graphics", label: { fr: "Graphismes", en: "Graphics" } },
  { id: "display", label: { fr: "Affichage & HUD", en: "Display & HUD" } },
  { id: "audio", label: { fr: "Audio", en: "Audio" } },
  { id: "controls", label: { fr: "Commandes", en: "Controls" } },
  { id: "access", label: { fr: "Accessibilité", en: "Accessibility" } },
  { id: "interface", label: { fr: "Interface", en: "Interface" } },
  { id: "network", label: { fr: "Réseau", en: "Network" } },
];

export interface PlayerGroup {
  tab: PlayerTab;
  title: Text;
  keys: RowKey[];
}

/** The player's screen, tab by tab, group by group — in the order shown. */
export const PLAYER_MENU: PlayerGroup[] = [
  // ---- game
  { tab: "game", title: { fr: "À pied", en: "On foot" }, keys: ["walkSpeed", "runSpeed", "jumpSpeed", "characterDistance"] },
  {
    tab: "game",
    title: { fr: "Vaisseaux", en: "Spacecraft" },
    keys: [
      "vessel",
      "shipMount",
      // (PLAN-VAISSEAUX X0–X3: the assistance, the protections, the systems' realism, the propellant)
      "spaceAssist",
      "spaceAutoProtect",
      "spaceConsumables",
      "spaceFailures",
      "spaceInfinitePropellant",
      "engine",
      "fuel",
      "autoWarp",
      "crewG",
    ],
  },
  {
    tab: "game",
    title: { fr: "Pilotage", en: "Flying" },
    keys: ["flightMode", "turnRate", "gyroscopes", "autoGear", "gearForgiving", "crashSpeed", "wind", "damage", "antigrav"],
  },
  {
    tab: "game",
    title: { fr: "F-35", en: "F-35" },
    keys: [
      "f35Assist",
      "f35Law",
      "f35Variant",
      "f35Instructor",
      "f35AutoProtect",
      "f35GLimit",
      "f35AiSkill",
      "f35EnemyMissiles",
      "f35InfiniteFuel",
      "f35InfiniteAmmo",
      "f35Invulnerable",
      "f35Radar",
      "f35RadarRange",
      "f35ThreatCalls",
      "f35RadioRoles",
    ],
  },
  { tab: "game", title: { fr: "Formation", en: "Formation" }, keys: ["wingmen", "formShape", "formSpacing", "formPos"] },
  { tab: "game", title: { fr: "Trafic réel", en: "Live traffic" }, keys: ["traffic", "trafficDelay"] },
  { tab: "game", title: { fr: "Sauvegardes", en: "Saved games" }, keys: ["autosave", "autosaveEvery"] },
  // ---- graphics
  {
    tab: "graphics",
    title: { fr: "Qualité", en: "Quality" },
    keys: [
      "@quality",
      "pixelRatio",
      "fpsCap",
      "dynamicResolution",
      "realtimeSubsampling",
      "motionDetail",
      "temporalReprojection",
      "showFps",
    ],
  },
  {
    tab: "graphics",
    title: { fr: "Image", en: "Picture" },
    keys: ["autoExposure", "tonemap", "hdr", "hdrPeak", "bloom", "lensFlare", "sharpen", "motionBlur", "denoise", "targetSpp"],
  },
  {
    tab: "graphics",
    title: { fr: "La Terre", en: "The Earth" },
    keys: [
      "volumetricClouds",
      "earthClouds",
      "earthTerrain",
      "earthSurface",
      "earthScenery",
      "detailReach",
      "earthSceneryShadows",
      "earthGrass",
      "earthGrassDensity",
      "seaFft",
      "refraction",
    ],
  },
  // ---- display & HUD
  {
    tab: "display",
    title: { fr: "HUD", en: "HUD" },
    keys: ["hudKind", "hudViews", "hudJet", "keyHints", "cockpitAids", "speedLines", "gVignette"],
  },
  {
    tab: "display",
    title: { fr: "Aides du HUD", en: "HUD aids" },
    keys: [
      "hudHorizon",
      "hudHeading",
      "hudBank",
      "hudMarkers",
      "hudEdge",
      "hudAoA",
      "hudEnergy",
      "hudDirector",
      "hudPath",
      "hudFuture",
      "hudImpact",
      "hudRunway",
      "hudHover",
      "hudBurn",
      "hudDock",
      "hudRelativity",
    ],
  },
  { tab: "display", title: { fr: "Affichages", en: "Displays" }, keys: ["rangerStatus", "pathInView", "soiRings", "showGeodesic"] },
  {
    tab: "display",
    title: { fr: "Casque et écrans du F-35", en: "The F-35's helmet and screens" },
    keys: [
      "f35HmdColor",
      "f35HmdBrightness",
      "f35HmdLook",
      "f35PcdStyle",
      "f35PcdBrightness",
      "f35WeaponPanel",
      "f35Avionics",
      "f35RadarRelief",
    ],
  },
  {
    tab: "display",
    title: { fr: "Cockpit", en: "Cockpit" },
    keys: ["cabinLight", "nightLighting", "navLights", "strobeLights", "landingLights"],
  },
  {
    tab: "display",
    title: { fr: "Effets de caméra", en: "Camera effects" },
    keys: [
      "fov",
      "cineShot",
      "cineDynamicFov",
      "cineShake",
      "flightShake",
      "heatHaze",
      "f35GEffects",
      "f35Breathing",
      "f35Vapour",
      "exhaust",
    ],
  },
  // ---- audio
  {
    tab: "audio",
    title: { fr: "Son", en: "Sound" },
    keys: [
      "sound",
      "soundVolume",
      "soundEngines",
      "soundAmbience",
      "soundBeeps",
      "soundUi",
      "soundHeadphones",
      "music",
      "soundMusic",
      "groundAlerts",
      "voice",
      "soundVoice",
    ],
  },
  {
    tab: "audio",
    title: { fr: "TARS", en: "TARS" },
    keys: ["tarsRemarks", "tarsOnline", "tarsModel", "tarsWake", "tarsHonesty", "tarsHumour", "tarsBudget"],
  },
  {
    tab: "audio",
    title: { fr: "La voix de TARS", en: "TARS's voice" },
    keys: ["tarsVoiceEngine", "tarsVoiceFr", "tarsVoiceEn", "tarsVoiceEffect", "tarsVoiceRate", "tarsVoicePitch"],
  },
  { tab: "audio", title: { fr: "L'oreille de TARS", en: "TARS's ear" }, keys: ["tarsEar", "tarsEarLang", "tarsTalkMode"] },
  // ---- controls (and the controls' own screens: ui/settings/player.ts)
  { tab: "controls", title: { fr: "Retours", en: "Feedback" }, keys: ["haptics"] },
  // ---- accessibility
  { tab: "access", title: { fr: "Lisibilité", en: "Legibility" }, keys: ["uiScale", "hudPalette", "subtitles"] },
  { tab: "access", title: { fr: "Mouvement", en: "Motion" }, keys: ["reduceMotion"] },
  // ---- interface
  { tab: "interface", title: { fr: "Langue et unités", en: "Language and units" }, keys: ["@language", "units"] },
  // ---- network
  {
    tab: "network",
    title: { fr: "Jouer ensemble", en: "Playing together" },
    keys: ["netMenu", "netCrewActions", "netLightDelay", "netFreeFight"],
  },
];

/** The settings that can leave the screen unreadable: back by themselves after REVERT_S unless kept. */
export const RISKY: RowKey[] = ["pixelRatio", "hdr", "uiScale"];
export const REVERT_S = 15;

/**
 * The game's controls the player's screen leaves to the Lab, on purpose: the camera's rig, the craft's look, the
 * fine handling, the TARS and radio voices' engines' details, the free-fall readouts. Every control of the schema's
 * Game section is either on the player's screen or here (the test checks it).
 */
export const LAB_ONLY: (keyof Settings)[] = [
  "characterShoulder",
  "ship",
  "massRatio",
  "camSoft",
  "camBinding",
  "camDampPitch",
  "camDampYaw",
  "camDampRoll",
  "camDampPos",
  "camLookahead",
  "camScreenX",
  "camScreenY",
  "camDutch",
  "camNoise",
  "camNoiseAmp",
  "camNoiseFreq",
  "camImpulse",
  "camBlend",
  "camBlendTime",
  "camSpeedFov",
  "shipLight",
  "shipAlbedo",
  "shipMetal",
  "shipCoat",
  "shipRough",
  "turnAccel",
  "rcsFraction",
  "shipLookYaw",
  "shipLookPitch",
  "ballistic",
  "tarsEarModel",
  "tarsSystemVoice",
  "radioVoiceEngine",
  "radioVoiceFr",
  "radioVoiceEn",
];

/** every key the player's screen shows (the schema's ones: the special rows left out) */
export const playerKeys = (): (keyof Settings)[] =>
  PLAYER_MENU.flatMap((g) => g.keys).filter((k): k is keyof Settings => !k.startsWith("@"));

export const defOf = (k: RowKey): ControlDef | undefined => (k.startsWith("@") ? undefined : SCHEMA_BY_KEY.get(k as keyof Settings));

/** A tab's groups, each with its rows shown now (a control hidden by the state of the game: left out). */
export function rowsOf(tab: PlayerTab, s: Settings): { title: Text; keys: RowKey[] }[] {
  return PLAYER_MENU.filter((g) => g.tab === tab)
    .map((g) => ({ title: g.title, keys: g.keys.filter((k) => k.startsWith("@") || !defOf(k)?.visible || defOf(k)!.visible!(s)) }))
    .filter((g) => g.keys.length);
}

/** A row's label in the interface's language. */
export function labelOf(k: RowKey): string {
  if (k === "@quality") return tr({ fr: "Préréglage de qualité", en: "Quality preset" });
  if (k === "@language") return tr({ fr: "Langue", en: "Language" });
  const d = defOf(k);
  return d ? t(d.label) : k;
}

const fold = (x: string) => x.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/**
 * The search over both screens (⌘K): the player's rows (their tab) first, then the Lab's controls — by a label,
 * a group, a help or a keyword, in both languages.
 */
export function searchSettings(q: string): { player: { key: RowKey; tab: PlayerTab }[]; lab: (keyof Settings)[] } {
  const w = fold(q.trim());
  if (w.length < 2) return { player: [], lab: [] };
  const hit = (d: ControlDef) =>
    [d.label, t(d.label), d.group, t(d.group), d.help ?? "", d.help ? t(d.help) : "", d.keywords ?? "", d.key].some((x) =>
      fold(x).includes(w),
    );
  const placed = new Set<RowKey>(PLAYER_MENU.flatMap((g) => g.keys));
  const player: { key: RowKey; tab: PlayerTab }[] = [];
  for (const g of PLAYER_MENU)
    for (const k of g.keys) {
      const d = defOf(k);
      if ((d && hit(d)) || (!d && fold(labelOf(k)).includes(w))) player.push({ key: k, tab: g.tab });
    }
  const lab = SCHEMA.filter((d) => !placed.has(d.key) && hit(d)).map((d) => d.key);
  return { player, lab };
}

/** the language's names, each in itself */
export const LANGUAGES = [
  { id: "fr" as const, label: "Français" },
  { id: "en" as const, label: "English" },
];
export const languageLabel = (l = lang) => LANGUAGES.find((x) => x.id === l)!.label;
