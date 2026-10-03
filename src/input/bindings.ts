// The keys as the player set them: every binding of the keymap (input/keymap.ts) that one key triggers,
// and the keys held to fly (the craft's pitch, yaw, roll, translation, throttle; the free camera's
// moves), can be given another key. The overrides are the player's own (kept in the browser, like the
// other preferences); a key taken from another binding of the same context swaps with it. The keymap's
// dispatch, the controller's held keys and the help all read them from here.

import { tr, type Text } from "../i18n";
import { store } from "../util/storage";
import { BINDINGS, type KeyAction, type KeyBind, type KeyLayer } from "./keymap";

const STORE = "kerr.bindings";

/** A key as a binding takes it: a physical one (code) or a character (key, letters lower case). */
export interface KeyRef {
  code?: string;
  key?: string;
}

/** The keys held to fly: the craft's (flying) and the free camera's (on foot). */
export type HeldAxis =
  | "pitchDown"
  | "pitchUp"
  | "yawLeft"
  | "yawRight"
  | "rollLeft"
  | "rollRight"
  | "rcsDown"
  | "rcsUp"
  | "rcsLeft"
  | "rcsRight"
  | "rcsForward"
  | "rcsBack"
  | "throttleUp"
  | "throttleDown"
  | "camForward"
  | "camBack"
  | "camLeft"
  | "camRight"
  | "camUp"
  | "camDown"
  | "camRollLeft"
  | "camRollRight";

/** The held keys' defaults, by physical position (KSP's layout: W S A D Q E… on QWERTY, Z S Q D A E on AZERTY). */
export const HELD_DEFAULTS: Record<HeldAxis, string> = {
  pitchDown: "KeyW",
  pitchUp: "KeyS",
  yawLeft: "KeyA",
  yawRight: "KeyD",
  rollLeft: "KeyQ",
  rollRight: "KeyE",
  rcsDown: "KeyI",
  rcsUp: "KeyK",
  rcsLeft: "KeyJ",
  rcsRight: "KeyL",
  rcsForward: "KeyH",
  rcsBack: "KeyN",
  throttleUp: "ShiftLeft",
  throttleDown: "AltLeft",
  camForward: "KeyW",
  camBack: "KeyS",
  camLeft: "KeyA",
  camRight: "KeyD",
  camUp: "KeyE",
  camDown: "KeyQ",
  camRollLeft: "KeyZ",
  camRollRight: "KeyX",
};

/** The free camera's moves: [forward, right, up, roll] per held axis. */
const CAM_VECTORS: Partial<Record<HeldAxis, [number, number, number, number]>> = {
  camForward: [1, 0, 0, 0],
  camBack: [-1, 0, 0, 0],
  camLeft: [0, -1, 0, 0],
  camRight: [0, 1, 0, 0],
  camUp: [0, 0, 1, 0],
  camDown: [0, 0, -1, 0],
  camRollLeft: [0, 0, 0, 1],
  camRollRight: [0, 0, 0, -1],
};

let overrides: Record<string, KeyRef> = store.getJSON<Record<string, KeyRef>>(STORE, {});

/** The keyboard's own letters for the physical keys (Keyboard Layout Map, where the browser has it). */
export const layout = new Map<string, string>();
type LayoutNavigator = Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } };
if (typeof navigator !== "undefined")
  void (navigator as LayoutNavigator).keyboard
    ?.getLayoutMap?.()
    .then((m) => m.forEach((v, k) => layout.set(k, v.toUpperCase())))
    .catch(() => {});

/** A binding's stable name (its layer, action, argument and default key). */
export const bindId = (b: KeyBind) => `${b.layer}:${b.do}:${b.arg ?? ""}:${b.code?.[0] ?? b.key?.[0] ?? ""}`;

/** Can the player give it another key (one key triggers it — not a group such as the arrows). */
export const remappable = (b: KeyBind) =>
  (b.code ? b.code.length === 1 : b.key?.length === 1) && !(b.layer === "system" && b.do === "pause") && b.do !== "held";

/** The binding as the player set it (its key, the override's). */
export function effective(b: KeyBind): KeyBind {
  const o = remappable(b) ? overrides[bindId(b)] : undefined;
  if (!o) return b;
  return o.code ? { ...b, code: [o.code], key: undefined } : { ...b, key: [o.key!], code: undefined };
}

/** Every binding of the keymap, as the player set them. */
export const effectiveBindings = () => BINDINGS.map(effective);

/** A held axis's key now. */
export const heldCode = (a: HeldAxis) => overrides[`held:${a}`]?.code ?? HELD_DEFAULTS[a];

/** The key now of what a default flight key does (a held axis's, or a flight binding's): the hints' key. */
export function currentKey(defaultCode: string): KeyRef {
  for (const [a, d] of Object.entries(HELD_DEFAULTS) as [HeldAxis, string][])
    if (d === defaultCode && !a.startsWith("cam")) return { code: heldCode(a) };
  for (const b of BINDINGS)
    if (remappable(b) && b.layer === "flight" && b.code?.[0] === defaultCode) {
      const e = effective(b);
      return e.code ? { code: e.code[0] } : { key: e.key![0] };
    }
  return { code: defaultCode };
}

/** The free camera's held keys now: code → [forward, right, up, roll]. */
export function freeCameraKeys(): Record<string, [number, number, number, number]> {
  const out: Record<string, [number, number, number, number]> = {};
  for (const [a, v] of Object.entries(CAM_VECTORS) as [HeldAxis, [number, number, number, number]][]) out[heldCode(a)] = v;
  return out;
}

/** The overrides' context: a key may serve once in each (flying, on foot — the system and the time in both). */
const context = (layer: KeyLayer | "held-flight" | "held-free"): ("fly" | "foot")[] =>
  layer === "flight" || layer === "held-flight" ? ["fly"] : layer === "scene" || layer === "held-free" ? ["foot"] : ["fly", "foot"];

export interface Remappable {
  id: string;
  label: Text;
  group: "fly-held" | "fly" | "time" | "scene" | "free" | "system";
  /** the key now, and the default */
  now: KeyRef;
  def: KeyRef;
  shift?: boolean;
  ctx: ("fly" | "foot")[];
}

/** Every binding the player may set, with its key now. */
export function remappables(): Remappable[] {
  const out: Remappable[] = [];
  for (const [a, def] of Object.entries(HELD_DEFAULTS) as [HeldAxis, string][]) {
    const free = a.startsWith("cam");
    out.push({
      id: `held:${a}`,
      label: HELD_LABELS[a],
      group: free ? "free" : "fly-held",
      now: { code: heldCode(a) },
      def: { code: def },
      ctx: context(free ? "held-free" : "held-flight"),
    });
  }
  for (const b of BINDINGS) {
    if (!remappable(b)) continue;
    const e = effective(b);
    out.push({
      id: bindId(b),
      label: actionLabel(b),
      group: b.layer === "flight" ? "fly" : b.layer,
      now: e.code ? { code: e.code[0] } : { key: e.key![0] },
      def: b.code ? { code: b.code[0] } : { key: b.key![0] },
      shift: b.shift,
      ctx: context(b.layer),
    });
  }
  return out;
}

const same = (a: KeyRef, b: KeyRef) => (a.code && a.code === b.code) || (a.key && a.key === b.key);
const shiftsMeet = (a?: boolean, b?: boolean) => a === undefined || b === undefined || a === b;

/**
 * Gives a binding a key. Another binding of the same context that had that key gets this one's old key
 * (a swap: nothing is left without a key); returns its label, or null.
 */
export function rebind(id: string, key: KeyRef): Text | null {
  const all = remappables();
  const me = all.find((r) => r.id === id);
  if (!me) return null;
  const other = all.find((r) => r.id !== id && same(r.now, key) && r.ctx.some((c) => me.ctx.includes(c)) && shiftsMeet(r.shift, me.shift));
  set(id, key, me.def);
  if (other) set(other.id, me.now, other.def);
  save();
  return other?.label ?? null;
}

function set(id: string, key: KeyRef, def: KeyRef) {
  if (same(key, def)) delete overrides[id];
  else overrides[id] = key.code ? { code: key.code } : { key: key.key };
}

/** Every key back to its default. */
export function resetBindings() {
  overrides = {};
  save();
}

/** Any key set by the player. */
export const customised = () => Object.keys(overrides).length > 0;

function save() {
  store.setJSON(STORE, overrides);
}

// ------------------------------------------------------------------------------------ the labels

const HELD_LABELS: Record<HeldAxis, Text> = {
  pitchDown: { fr: "Piquer", en: "Pitch down" },
  pitchUp: { fr: "Cabrer", en: "Pitch up" },
  yawLeft: { fr: "Lacet à gauche", en: "Yaw left" },
  yawRight: { fr: "Lacet à droite", en: "Yaw right" },
  rollLeft: { fr: "Roulis à gauche", en: "Roll left" },
  rollRight: { fr: "Roulis à droite", en: "Roll right" },
  rcsDown: { fr: "Translation vers le bas", en: "Translate down" },
  rcsUp: { fr: "Translation vers le haut", en: "Translate up" },
  rcsLeft: { fr: "Translation à gauche", en: "Translate left" },
  rcsRight: { fr: "Translation à droite", en: "Translate right" },
  rcsForward: { fr: "Translation en avant", en: "Translate forward" },
  rcsBack: { fr: "Translation en arrière", en: "Translate back" },
  throttleUp: { fr: "Gaz +", en: "Throttle up" },
  throttleDown: { fr: "Gaz −", en: "Throttle down" },
  camForward: { fr: "Avancer", en: "Forward" },
  camBack: { fr: "Reculer", en: "Back" },
  camLeft: { fr: "À gauche", en: "Left" },
  camRight: { fr: "À droite", en: "Right" },
  camUp: { fr: "Monter", en: "Up" },
  camDown: { fr: "Descendre", en: "Down" },
  camRollLeft: { fr: "Roulis à gauche", en: "Roll left" },
  camRollRight: { fr: "Roulis à droite", en: "Roll right" },
};

const ACTION_LABELS: Partial<Record<KeyAction, Text>> = {
  tools: { fr: "Outils du jeu (dév.)", en: "Game tools (dev)" },
  quickSave: { fr: "Sauvegarde rapide", en: "Quick save" },
  quickLoad: { fr: "Chargement rapide", en: "Quick load" },
  throttleFull: { fr: "Plein gaz", en: "Full throttle" },
  throttleCut: { fr: "Couper les gaz", en: "Cut the throttle" },
  precision: { fr: "Commandes de précision", en: "Precision controls" },
  sas: { fr: "SAS", en: "SAS" },
  roll: { fr: "Alignement en roulis", en: "Roll alignment" },
  resetShipView: { fr: "Recentrer la caméra du vaisseau", en: "Reset the ship's camera" },
  map: { fr: "Carte", en: "Map" },
  mount: { fr: "Vue suivante (vaisseau)", en: "Next view (ship)" },
  flightMode: { fr: "Loi de vol", en: "Flight law" },
  antigrav: { fr: "Antigravité", en: "Antigravity" },
  flaps: { fr: "Volets", en: "Flaps" },
  airBrake: { fr: "Aérofreins", en: "Air brake" },
  pathInView: { fr: "Trajectoire dans la vue", en: "Path in the view" },
  hudDensity: { fr: "Densité du HUD", en: "HUD density" },
  missions: { fr: "Ordinateur de vol (missions)", en: "Flight computer (missions)" },
  stopFlight: { fr: "Rendre les commandes", en: "Release the controls" },
  ack: { fr: "Acquitter l'alarme", en: "Acknowledge the caution" },
  leaveShip: { fr: "Sortir du vaisseau", en: "Leave the ship" },
  playPause: { fr: "Lecture / pause du temps", en: "Run / pause time" },
  realTime: { fr: "Temps réel", en: "Real time" },
  toggleUi: { fr: "Masquer l'interface", en: "Hide the interface" },
  recentre: { fr: "Recentrer / niveler", en: "Recentre / level" },
  target: { fr: "Cible suivante (maintenu : roue)", en: "Next target (held: wheel)" },
  png: { fr: "Enregistrer un PNG", en: "Save a PNG" },
  fullscreen: { fr: "Plein écran", en: "Fullscreen" },
  lookAt: { fr: "Regarder la cible", en: "Look at the target" },
  telescope: { fr: "Télescope", en: "Telescope" },
  autoOrbit: { fr: "Orbite automatique", en: "Auto-orbit" },
  dive: { fr: "Plongée vers l'horizon", en: "Dive to the horizon" },
  journey: { fr: "Voyage par le trou de ver", en: "Wormhole journey" },
  standOn: { fr: "Trépied au sol", en: "Tripod on the ground" },
  fall: { fr: "Chute libre", en: "Free fall" },
  shadowGuide: { fr: "Guide d'ombre", en: "Shadow guide" },
  constellations: { fr: "Constellations", en: "Constellations" },
  grids: { fr: "Grilles du ciel", en: "Sky grids" },
  jet: { fr: "Jet", en: "Jet" },
  cinema: { fr: "Surface liquide", en: "Liquid surface" },
  ship: { fr: "Piloter le Ranger", en: "Fly the Ranger" },
  nextMount: { fr: "Point de vue suivant", en: "Next attach point" },
  details: { fr: "Détails et mesures", en: "Details & readouts" },
  help: { fr: "Aide", en: "Help" },
  stopCinematic: { fr: "Arrêter la cinématique", en: "Stop the cinematic" },
};

const HOLD_LABELS: Record<string, Text> = {
  prograde: { fr: "Maintien prograde", en: "Hold prograde" },
  retrograde: { fr: "Maintien rétrograde", en: "Hold retrograde" },
  radialOut: { fr: "Maintien radial extérieur", en: "Hold radial out" },
  radialIn: { fr: "Maintien radial intérieur", en: "Hold radial in" },
  normal: { fr: "Maintien normal", en: "Hold normal" },
  antinormal: { fr: "Maintien antinormal", en: "Hold antinormal" },
  target: { fr: "Maintien vers la cible", en: "Hold to the target" },
};
const AUTO_LABELS: Record<string, Text> = {
  hover: { fr: "Autopilote : stationnaire", en: "Autopilot: hover" },
  circularize: { fr: "Autopilote : circulariser", en: "Autopilot: circularize" },
  approach: { fr: "Autopilote : approche", en: "Autopilot: approach" },
  land: { fr: "Autopilote : atterrir", en: "Autopilot: land" },
  takeoff: { fr: "Autopilote : décoller", en: "Autopilot: take off" },
  dock: { fr: "Autopilote : amarrer", en: "Autopilot: dock" },
  entry: { fr: "Autopilote : rentrée et atterrissage", en: "Autopilot: entry and landing" },
};

function actionLabel(b: KeyBind): Text {
  if (b.do === "hold") return HOLD_LABELS[b.arg ?? ""] ?? { fr: b.arg ?? "", en: b.arg ?? "" };
  if (b.do === "auto") return AUTO_LABELS[b.arg ?? ""] ?? { fr: b.arg ?? "", en: b.arg ?? "" };
  if (b.do === "warp")
    return b.arg === "1" ? { fr: "Accélérer le temps", en: "Time warp faster" } : { fr: "Ralentir le temps", en: "Time warp slower" };
  if (b.do === "vessel") return b.arg === "1" ? { fr: "Engin suivant", en: "Next craft" } : { fr: "Engin précédent", en: "Previous craft" };
  if (b.do === "quality") return { fr: `Qualité : ${b.arg}`, en: `Quality: ${b.arg}` };
  if (b.do === "nextView")
    return b.shift === false ? { fr: "Vue suivante (R)", en: "Next view (R)" } : { fr: "Vue suivante", en: "Next view" };
  return ACTION_LABELS[b.do] ?? { fr: b.do, en: b.do };
}

/** A key as the keyboard prints it (the layout's letter where the browser knows it). */
export function keyLabel(k: KeyRef): string {
  if (k.key) return k.key.length === 1 ? k.key.toUpperCase() : k.key;
  const c = k.code ?? "";
  const named: Record<string, string> = {
    ShiftLeft: "⇧",
    ShiftRight: "⇧ droit",
    AltLeft: "Alt",
    AltRight: "Alt Gr",
    CapsLock: "Caps",
    Backspace: "⌫",
    Enter: "Entrée",
    Space: "Espace",
    Backquote: "²",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Period: ".",
    Slash: "/",
  };
  // (the digit row by its digits: AZERTY's unshifted & é " ' say nothing)
  if (c.startsWith("Digit")) return c.slice(5);
  return named[c] ?? layout.get(c)?.toUpperCase() ?? (c.startsWith("Key") ? c.slice(3) : c.startsWith("Digit") ? c.slice(5) : c);
}

/** A label in the interface's language. */
export const labelOf = (r: Remappable) => tr(r.label);
