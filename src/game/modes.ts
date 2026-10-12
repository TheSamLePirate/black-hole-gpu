// The game's four modes — the ship flown, on foot (the third person), the free camera across the whole system,
// the photo mode (renders) — read from the app's state, and the steps from one to another: one notion of "the
// mode" for the top bar, the keys (F1–F4), TARS, the API and the HUDs, where the state is spread over the
// settings (ship), the controller (piloting, the spectator, the walker) and the photo mode. Pure: the host
// (main.ts) carries the steps out.

export type GameMode = "ship" | "foot" | "free" | "photo";
export const GAME_MODES: GameMode[] = ["ship", "foot", "free", "photo"];

/** What the mode is read from. */
export interface ModeState {
  /** the ship in the scene (settings.ship), flown by the controller (piloting) */
  ship: boolean;
  piloting: boolean;
  /** the spectator out (a free camera, the ship flying on) */
  spectating: boolean;
  /** walking */
  onFoot: boolean;
  /** the photo mode open, the mode it was opened over */
  photo: boolean;
  photoOver: Exclude<GameMode, "photo"> | null;
  /** the flown craft at rest on a ground (it can be left) */
  landedStill: boolean;
  /** a solid world under the camera, near enough to walk on (its id; null: none) */
  groundBelow: string | null;
  /** an offline render running (no mode change then) */
  rendering: boolean;
}

/** The mode now. */
export function modeOf(s: ModeState): GameMode {
  if (s.photo) return "photo";
  if (s.onFoot) return "foot";
  if (s.ship && s.piloting && !s.spectating) return "ship";
  return "free";
}

/** The mode under the photo mode (the one it goes back to). */
export function baseMode(s: ModeState): Exclude<GameMode, "photo"> {
  const m = modeOf({ ...s, photo: false });
  return s.photo && s.photoOver ? s.photoOver : (m as Exclude<GameMode, "photo">);
}

/** One step of a change of mode (main.ts carries it out). */
export type ModeStep =
  | "closePhoto"
  | "openPhoto"
  | "stopSpectator"
  | "startSpectator"
  | "board"
  | "stopWalking"
  | "disembark"
  | "walkHere"
  | "shipOn"
  | "shipOff";

export type ModePlan = { steps: ModeStep[] } | { refused: string };

/**
 * The steps from the state to a mode, or why not (the reason, in English: the host translates it).
 * - ship: back from photo, on board from foot (boarding near the hatch, else back to the craft), back from the
 *   spectator, the ship put in the scene when it was not;
 * - foot: out of the landed craft, or the explorer set down on the world under the camera;
 * - free: the spectator when a ship flies (it flies on), else the camera of the whole system;
 * - photo: over the mode now.
 */
export function planMode(s: ModeState, to: GameMode, near: { hatch: boolean } = { hatch: false }): ModePlan {
  if (s.rendering) return { refused: "An offline render is running: stop it first" };
  const from = modeOf(s);
  if (from === to) return { steps: [] };
  const steps: ModeStep[] = [];
  if (to === "photo") return { steps: ["openPhoto"] };
  if (from === "photo") {
    steps.push("closePhoto");
    if (baseMode(s) === to) return { steps };
  }
  const base = from === "photo" ? baseMode(s) : from;
  switch (to) {
    case "ship":
      // (on foot beside a craft flown: on board at the hatch, else the view carried back to it; walking without
      // one: the walk ended, the ship put in)
      if (base === "foot") steps.push(s.ship && s.piloting && near.hatch ? "board" : "stopWalking");
      else if (s.spectating) steps.push("stopSpectator");
      if (!s.ship) steps.push("shipOn");
      return { steps };
    case "foot":
      // (flying: out of the landed craft; the spectator: down where it looks from — its view the walker's —, else
      // back to the landed craft and out of it; the free camera: down on the world below)
      if (base === "ship" && s.landedStill) return { steps: [...steps, "disembark"] };
      if (s.groundBelow) return { steps: [...steps, "walkHere"] };
      if (s.spectating && s.landedStill) return { steps: [...steps, "stopSpectator", "disembark"] };
      return {
        refused: s.ship
          ? "On foot: land the craft and stop on the ground first — or the Atlas: walk anywhere"
          : "On foot: no ground near the camera — the Atlas puts the explorer anywhere",
      };
    case "free":
      if (base === "foot") steps.push("stopWalking");
      if (s.ship && s.piloting) steps.push("startSpectator");
      return { steps };
  }
  return { steps };
}
