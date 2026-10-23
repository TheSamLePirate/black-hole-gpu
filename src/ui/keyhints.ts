// Contextual key hints: the three to five keys that matter now — flying by hand in orbit, on an
// autopilot, landed, in the air, docking, on foot — in a small strip that shows when the flight's phase
// changes and fades after a while. The flight keys go by their position: the letter shown is the one
// on this keyboard (the Keyboard Layout Map where the browser has it: W on AZERTY for QWERTY's Z).

import { tr, type Text } from "../i18n";
import type { FlightPhase } from "../game/phase";
import { el, kbd } from "./kit";
import { currentKey, keyLabel, layout } from "../input/bindings";

type Hint = [keys: string, what: Text];

/** A flight key as the player set it, as this keyboard prints it (W on AZERTY for QWERTY's Z). */
const key = (code: string, qwerty: string) => {
  const k = currentKey(code);
  return k.code === code ? (layout.get(code) ?? qwerty) : keyLabel(k);
};

const HINTS = {
  // (the free camera, PLAN-MODES-AAA: its placements, the tripod and the sky's events, the Atlas, the other modes)
  free: (): Hint[] => [
    ["V", { fr: "vue suivante", en: "next view" }],
    ["Tab", { fr: "cible suivante", en: "next target" }],
    ["⇧T · ⇧F8", { fr: "trépied au sol · le ciel d'ici", en: "tripod on the ground · the sky from here" }],
    ["F8", { fr: "Atlas : y aller", en: "Atlas: go there" }],
    ["F1 · F2 · F4", { fr: "vaisseau · à pied · photo", en: "ship · on foot · photo" }],
  ],
  cinematic: (): Hint[] => [
    ["⌫", { fr: "arrêter la cinématique", en: "stop the cinematic" }],
    ["V", { fr: "vue suivante", en: "next view" }],
    [tr({ fr: "Échap", en: "Esc" }), { fr: "pause", en: "pause" }],
  ],
  manual: (): Hint[] => [
    [key("KeyZ", "Z"), { fr: "plein gaz", en: "full throttle" }],
    ["1 – 7", { fr: "maintiens", en: "holds" }],
    ["O", { fr: "ordinateur de vol", en: "flight computer" }],
    ["M", { fr: "carte", en: "map" }],
    [tr({ fr: "Échap", en: "Esc" }), { fr: "pause", en: "pause" }],
  ],
  holding: (): Hint[] => [
    ["⌫", { fr: "rendre les commandes", en: "release the controls" }],
    [key("KeyZ", "Z"), { fr: "plein gaz", en: "full throttle" }],
    [`${key("KeyX", "X")}`, { fr: "couper les gaz", en: "cut the throttle" }],
    ["M", { fr: "carte", en: "map" }],
  ],
  auto: (): Hint[] => [
    ["⌫", { fr: "reprendre les commandes", en: "take the controls" }],
    ["⇧F4", { fr: "assisté : vous pilotez, guidé par l'autopilote", en: "assisted: you fly, the autopilot guiding" }],
    ["F3", { fr: "caméra libre — le vaisseau continue", en: "free camera — the ship flies on" }],
    ["M", { fr: "carte", en: "map" }],
    [". ,", { fr: "accélérer · ralentir le temps", en: "time warp faster · slower" }],
  ],
  landed: (): Hint[] => [
    ["U", { fr: "décollage automatique", en: "automatic take-off" }],
    [key("KeyZ", "Z"), { fr: "plein gaz", en: "full throttle" }],
    ["⇧K", { fr: "sortir du vaisseau", en: "leave the ship" }],
    ["M", { fr: "carte", en: "map" }],
  ],
  air: (): Hint[] => [
    [key("KeyF", "F"), { fr: "loi de vol : fusée · avion · ordinateur", en: "flight law: rocket · plane · computer" }],
    [`${key("KeyP", "P")} · ⇧${key("KeyP", "P")}`, { fr: "volets · aérofreins", en: "flaps · air brake" }],
    [key("KeyG", "G"), { fr: "train d'atterrissage", en: "landing gear" }],
    [`⇧${key("KeyG", "G")}`, { fr: "rentrée et atterrissage guidés", en: "guided entry and landing" }],
    [tr({ fr: "Échap", en: "Esc" }), { fr: "pause", en: "pause" }],
  ],
  docking: (): Hint[] => [
    [
      `${key("KeyI", "I")} ${key("KeyK", "K")} · ${key("KeyJ", "J")} ${key("KeyL", "L")} · ${key("KeyH", "H")} ${key("KeyN", "N")}`,
      { fr: "translation", en: "translation" },
    ],
    ["Caps", { fr: "précision", en: "precision" }],
    [key("KeyB", "B"), { fr: "amarrage automatique", en: "automatic docking" }],
    ["⇧F4", { fr: "assisté : vous pilotez, guidé", en: "assisted: you fly, guided" }],
    ["⌫", { fr: "rendre les commandes", en: "release the controls" }],
  ],
  // (the F-35: its own keys — no rocket's holds, no flight computer)
  jetLanded: (): Hint[] => [
    [key("KeyZ", "Z"), { fr: "plein gaz", en: "full throttle" }],
    [`⇧${key("KeyZ", "Z")}`, { fr: "postcombustion", en: "afterburner" }],
    [`⇧${key("KeyB", "B")}`, { fr: "STOVL", en: "STOVL" }],
    [`⇧${key("KeyO", "O")}`, { fr: "plan de vol", en: "flight plan" }],
    [tr({ fr: "Échap", en: "Esc" }), { fr: "pause", en: "pause" }],
  ],
  jetAir: (): Hint[] => [
    ["' · ⇧'", { fr: "pilote auto · auto-manette", en: "autopilot · autothrottle" }],
    [`⇧${key("KeyM", "M")}`, { fr: "NAV : suivre le plan de vol", en: "NAV: fly the flight plan" }],
    [`⇧${key("KeyZ", "Z")}`, { fr: "postcombustion", en: "afterburner" }],
    [`${key("KeyG", "G")} · ${key("KeyP", "P")}`, { fr: "train · volets", en: "gear · flaps" }],
    [tr({ fr: "Échap", en: "Esc" }), { fr: "pause", en: "pause" }],
  ],
  // (the A320: an airliner's — its reversers, its autobrake, its FCU's keys)
  airlinerLanded: (): Hint[] => [
    [key("KeyZ", "Z"), { fr: "plein gaz", en: "full throttle" }],
    [`⇧${key("KeyZ", "Z")}`, { fr: "inverseurs", en: "reversers" }],
    [`⇧${key("KeyB", "B")}`, { fr: "freinage automatique", en: "autobrake" }],
    [`⇧${key("KeyO", "O")}`, { fr: "plan de vol", en: "flight plan" }],
    [tr({ fr: "Échap", en: "Esc" }), { fr: "pause", en: "pause" }],
  ],
  airlinerAir: (): Hint[] => [
    ["' · ⇧'", { fr: "pilote auto · auto-poussée", en: "autopilot · autothrust" }],
    [`⇧${key("KeyM", "M")}`, { fr: "NAV : suivre le plan de vol", en: "NAV: fly the flight plan" }],
    [`${key("KeyG", "G")} · ${key("KeyP", "P")}`, { fr: "train · volets", en: "gear · flaps" }],
    [tr({ fr: "Échap", en: "Esc" }), { fr: "pause", en: "pause" }],
  ],
  jetFight: (): Hint[] => [
    [tr({ fr: "Espace", en: "Space" }), { fr: "canon (maintenu)", en: "gun (held)" }],
    [tr({ fr: "Entrée", en: "Enter" }), { fr: "tirer l'arme choisie", en: "fire the weapon chosen" }],
    ["Tab", { fr: "verrouiller la cible suivante", en: "lock the next target" }],
    ["= · −", { fr: "arme suivante · leurres", en: "next weapon · decoys" }],
    [tr({ fr: "Échap", en: "Esc" }), { fr: "pause", en: "pause" }],
  ],
  docked: (): Hint[] => [
    ["[ ]", { fr: "changer d'engin", en: "switch craft" }],
    ["O", { fr: "ordinateur de vol", en: "flight computer" }],
    ["M", { fr: "carte", en: "map" }],
  ],
} satisfies Record<string, () => Hint[]>;

/** The hints for a phase (none for an offline render); `jet` the F-35 flown (in a fight or not), the A320. */
export function hintsFor(p: FlightPhase, jet: "plane" | "fight" | "airliner" | null = null): Hint[] {
  if (jet === "airliner" && (p.mode === "flight" || p.mode === "landed"))
    return p.mode === "landed" ? HINTS.airlinerLanded() : HINTS.airlinerAir();
  if (jet && (p.mode === "flight" || p.mode === "landed"))
    return jet === "fight" ? HINTS.jetFight() : p.mode === "landed" ? HINTS.jetLanded() : HINTS.jetAir();
  switch (p.mode) {
    case "offline":
      return [];
    case "free":
      return HINTS.free();
    case "cinematic":
      return HINTS.cinematic();
    case "landed":
      return HINTS.landed();
    case "docked":
      return HINTS.docked();
  }
  if (p.control === "auto") return p.detail === "dock" ? HINTS.docking() : HINTS.auto();
  if (p.stage === "docking") return HINTS.docking();
  if (p.stage === "air" || p.stage === "entry" || p.stage === "approach") return HINTS.air();
  if (p.control === "hold") return HINTS.holding();
  return HINTS.manual();
}

/** How long the hints stay before fading [ms]. */
const SHOW_MS = 9000;

export class KeyHints {
  readonly root = el("div", "kh");
  private sig = "";
  private shownAt = 0;

  constructor() {
    this.root.setAttribute("role", "note");
    this.root.setAttribute("aria-label", tr({ fr: "Touches utiles", en: "Useful keys" }));
    document.body.append(this.root);
  }

  /** The frame's phase (null: nothing to show — hints off, a menu open, the interface hidden). */
  update(p: FlightPhase | null, now: number, jet: "plane" | "fight" | "airliner" | null = null) {
    const hints = p ? hintsFor(p, jet) : [];
    const sig = hints.map(([k, t]) => k + t.en).join("|") + (p?.mode === "flight" ? "f" : "");
    if (sig !== this.sig) {
      this.sig = sig;
      this.root.replaceChildren(
        ...hints.map(([k, t]) => {
          const row = el("div", "kh-row");
          row.append(kbd(k), el("span", "", tr(t)));
          return row;
        }),
      );
      this.root.classList.toggle("flying", p?.mode === "flight" || p?.mode === "landed" || p?.mode === "docked");
      this.shownAt = now;
    }
    this.root.classList.toggle("show", hints.length > 0 && now - this.shownAt < SHOW_MS);
  }
}
