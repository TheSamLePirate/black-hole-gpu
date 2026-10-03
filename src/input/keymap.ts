// The keyboard, in one table: what each key does and the help sheet's line that says so. The keydown
// handler (main.ts) dispatches through it and the help (? — ui/panel.ts) is drawn from it, so a key
// cannot do something the sheet does not say, nor the sheet promise a key that does nothing.
//
// A key is matched in layers, in order: "system" (always), "flight" (flying the craft — before
// anything else), "time" (every mode), then — unless the key is a free-flight key (FLIGHT_KEYS: they
// fly, nothing else) — "scene". Within a layer no two bindings may match the same key and Shift state
// (tests/keymap.test.ts), so the order of the rows never decides.
//
// Flight keys go by physical position (KeyboardEvent.code: Z Q S D on AZERTY, W A S D on QWERTY); the
// scene's letters by the character typed (KeyboardEvent.key), as their names say.

export type KeyLayer = "system" | "flight" | "time" | "scene";

export type KeyAction =
  // system
  | "tools"
  | "pause"
  | "quickSave"
  | "quickLoad"
  // flight
  | "held"
  | "throttleFull"
  | "throttleCut"
  | "precision"
  | "sas"
  | "roll"
  | "resetShipView"
  | "hold"
  | "auto"
  | "map"
  | "mount"
  | "vessel"
  | "flightMode"
  | "antigrav"
  | "flaps"
  | "airBrake"
  | "pathInView"
  | "hudDensity"
  | "missions"
  | "stopFlight"
  | "leaveShip"
  // time
  | "playPause"
  | "warp"
  | "realTime"
  // scene
  | "toggleUi"
  | "nextView"
  | "recentre"
  | "target"
  | "png"
  | "fullscreen"
  | "lookAt"
  | "telescope"
  | "autoOrbit"
  | "dive"
  | "journey"
  | "standOn"
  | "fall"
  | "shadowGuide"
  | "constellations"
  | "grids"
  | "jet"
  | "cinema"
  | "ship"
  | "nextMount"
  | "details"
  | "help"
  | "stopCinematic"
  | "quality";

export interface KeyBind {
  layer: KeyLayer;
  /** Physical keys (KeyboardEvent.code)… */
  code?: string[];
  /** …or the character typed (KeyboardEvent.key, letters lower case). */
  key?: string[];
  /** Shift required (true), excluded (false) or either (absent). */
  shift?: boolean;
  /** Not while flying (the scene layer only). */
  ground?: boolean;
  /** A character that does not match (Slash typed as "?" is the help, not real time). */
  notKey?: string;
  do: KeyAction;
  /** The action's argument (which hold, which autopilot, which quality…). */
  arg?: string;
}

export interface KeyRow {
  keys: string;
  text: string;
  bind?: KeyBind[];
}

export interface KeySection {
  title: string;
  rows: KeyRow[];
}

const codes = (layer: KeyLayer, code: string | string[], act: KeyAction, o: Partial<KeyBind> = {}): KeyBind => ({
  layer,
  code: typeof code === "string" ? [code] : code,
  do: act,
  ...o,
});
const fly = (code: string | string[], act: KeyAction, o: Partial<KeyBind> = {}) => codes("flight", code, act, o);
const time = (code: string | string[], act: KeyAction, o: Partial<KeyBind> = {}) => codes("time", code, act, o);
const scene = (key: string | string[], act: KeyAction, o: Partial<KeyBind> = {}): KeyBind => ({
  layer: "scene",
  key: typeof key === "string" ? [key] : key,
  do: act,
  ...o,
});
const off = { shift: false };
const on = { shift: true };

const HOLDS = ["prograde", "retrograde", "radialOut", "radialIn", "normal", "antinormal", "target"];

export const KEYMAP: KeySection[] = [
  {
    title: "Time — every mode",
    rows: [
      {
        keys: "Space",
        text: "Run / pause (paused: everything the time drives holds, the image refines)",
        bind: [time("Space", "playPause")],
      },
      {
        keys: ", · . · /",
        text: "Time warp slower · faster · real time (; : ! on AZERTY)",
        bind: [time("Comma", "warp", { arg: "-1" }), time("Period", "warp", { arg: "1" }), time("Slash", "realTime", { notKey: "?" })],
      },
      { keys: "● on the time bar", text: "Record a take — Render › Video renders it at full quality" },
    ],
  },
  {
    title: "The sky — our side",
    rows: [
      {
        keys: "N · ⇧N",
        text: "Constellations: their figures and names · the bright stars' names",
        bind: [scene("n", "constellations", { ground: true })],
      },
      {
        keys: "U",
        text: "Grids in turn: equatorial (of date) · horizontal (on a world) · both · none",
        bind: [scene("u", "grids", { ground: true })],
      },
      {
        keys: "Sky button",
        text: "The sky chart: every switch, the ecliptic, the opacity, go to a constellation or a star; hover a star for its card",
      },
    ],
  },
  {
    title: "Camera — every mode",
    rows: [
      {
        keys: "V · ⇧V",
        text: "Next · previous view (without the ship: around · follow · free · tripod · free fall; the ship: its views)",
        bind: [scene("v", "nextView")],
      },
      { keys: "C", text: "Look at the target: the view locked on it, wherever the camera goes", bind: [scene("c", "lookAt", off)] },
      { keys: "Y", text: "Telescope: fields down to 0.02°, held on the target (the wheel zooms)", bind: [scene("y", "telescope")] },
      { keys: "Tab · ⇧Tab", text: "Next · previous target (or click it in the view)", bind: [scene("Tab", "target")] },
      { keys: "Drag", text: "Around: orbit the target · else: look around (locked: where the target sits)" },
      { keys: "Right / ⇧ drag", text: "Around: offset the view · Free: roll" },
      { keys: "Wheel · pinch", text: "Around: distance · Free: move forward / back · telescope: zoom" },
      { keys: "Alt + wheel", text: "Lens (field of view, eased)" },
      { keys: "Double-click", text: "Fly to a body and frame it · on the sky: recentre / level" },
      { keys: "R · ⇧R", text: "Next view · recentre / level", bind: [scene("r", "nextView", off), scene("r", "recentre", on)] },
      { keys: "← → ↑ ↓ · + −", text: "Orbit (free: turn) · zoom" },
    ],
  },
  {
    title: "The free camera (no ship)",
    rows: [
      { keys: "Z Q S D (WASD)", text: "Fly forward · left · back · right (⇧ faster)" },
      { keys: "A · E (Q · E)", text: "Down · up" },
      { keys: "W · X (Z · X)", text: "Roll" },
      { keys: "Middle click", text: "Mouse look, game-style (Esc leaves)" },
      { keys: "B", text: "Free fall along the geodesic (the keys thrust) ⟷ free", bind: [scene("b", "fall")] },
      {
        keys: "O · ⇧C · T",
        text: "Auto-orbit · dive to the horizon · wormhole journey (they run with the time)",
        bind: [scene("o", "autoOrbit"), scene("c", "dive", on), scene("t", "journey", off)],
      },
      {
        keys: "⇧T",
        text: "Tripod on the ground: the target's world (else the nearest), level, facing the horizon",
        bind: [scene("t", "standOn", on)],
      },
    ],
  },
  {
    title: "Scene",
    rows: [
      { keys: "J · G", text: "Jet · shadow guide", bind: [scene("j", "jet"), scene("g", "shadowGuide")] },
      { keys: "L", text: "Cinematic mode: liquid wormhole surface", bind: [scene("l", "cinema")] },
      {
        keys: "K · ⇧K",
        text: "Ranger: camera on the spaceship · next view",
        bind: [scene("k", "ship", off), scene("k", "nextMount", on)],
      },
      {
        keys: "1 – 6",
        text: "Quality (5: realtime max, 6: game)",
        bind: ["low", "medium", "high", "ultra", "realtime", "game"].map((q, i) => scene(String(i + 1), "quality", { arg: q })),
      },
      { keys: "⌘K / Ctrl+K", text: "Search the settings" },
    ],
  },
  {
    title: "Flying the Ranger (K) — KSP's layout",
    rows: [
      { keys: "W S · A D · Q E", text: "Pitch · yaw · roll (Z S · Q D · A E on AZERTY)" },
      {
        keys: "⇧ · Alt · ↑ ↓",
        text: "Throttle up · down (held)",
        bind: [fly(["ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"], "held")],
      },
      {
        keys: "Z · X",
        text: "Full throttle · cut (W · X on AZERTY)",
        bind: [fly("KeyZ", "throttleFull"), fly("KeyX", "throttleCut")],
      },
      {
        keys: "I K · J L · H N",
        text: "RCS translation: down/up · left/right · forward/back",
        bind: [fly(["KeyI", "KeyJ", "KeyL", "KeyH", "KeyN"], "held"), fly("KeyK", "held", off)],
      },
      { keys: "Caps Lock", text: "Precision controls (fine rotation, throttle, RCS)", bind: [fly("CapsLock", "precision")] },
      { keys: "T", text: "SAS: stability assist", bind: [fly("KeyT", "sas")] },
      { keys: "R", text: "Roll alignment: wings in the orbital plane while the nose is held", bind: [fly("KeyR", "roll", off)] },
      {
        keys: "1 – 7",
        text: "Hold prograde · retrograde · radial ± · normal ± · target (ANTI, NODE on the panel)",
        bind: HOLDS.map((h, i) => fly(`Digit${i + 1}`, "hold", { arg: h })),
      },
      {
        keys: "8 · 9 · 0 · G · U · B",
        text: "Autopilot: hold position · circularize · approach · land · take off · dock (the ISS within 3 km)",
        bind: [
          fly("Digit8", "auto", { arg: "hover" }),
          fly("Digit9", "auto", { arg: "circularize" }),
          fly("Digit0", "auto", { arg: "approach" }),
          fly("KeyG", "auto", { arg: "land", shift: false }),
          fly("KeyU", "auto", { arg: "takeoff" }),
          fly("KeyB", "auto", { arg: "dock" }),
        ],
      },
      {
        keys: "M · ⇧M",
        text: "3D map (drag: turn · right-drag: pan · wheel: zoom · click: target · double-click: centre) · settings panel",
        bind: [{ layer: "flight", key: ["m"], shift: false, do: "map" }],
      },
      {
        keys: "V · ⇧V",
        text: "Camera: next · previous view — on the hull, around the ship, free, fly-by",
        bind: [fly("KeyV", "mount")],
      },
      {
        keys: "⇧R",
        text: "Camera reset: back to the craft's attach points, looking ahead (the outside views' own places)",
        bind: [fly("KeyR", "resetShipView", on)],
      },
      {
        keys: "View “Cabin”",
        text: "Inside the Ranger: Z Q S D · A E move the camera about the cabin (⇧ faster), the drag or the arrows turn the look — the ship flies on",
      },
      {
        keys: "[ · ]",
        text: "The craft flown: the Ranger, the Lander, the Endurance (the others coast, turning as they were)",
        bind: [fly("BracketLeft", "vessel", { arg: "-1" }), fly("BracketRight", "vessel", { arg: "1" })],
      },
      {
        keys: "F · ⇧F",
        text: "In the air: fly as a rocket · a plane (let go: the flight path held) · with the flight computer (the stick and throttle set the way and the speed) — antigravity",
        bind: [fly("KeyF", "flightMode", off), fly("KeyF", "antigrav", on)],
      },
      { keys: "P · ⇧P", text: "Flaps (up · half · full) · air brake", bind: [fly("KeyP", "flaps", off), fly("KeyP", "airBrake", on)] },
      {
        keys: "⇧G",
        text: "Entry & landing: from orbit the deorbit burn for a site (the flight computer's LAND tab chooses it), the guided entry, the glide and the landing",
        bind: [fly("KeyG", "auto", { arg: "entry", shift: true })],
      },
      { keys: "⇧Y", text: "The future path in the view", bind: [fly("KeyY", "pathInView", on)] },
      { keys: "²  (`)", text: "HUD density: full · minimal · clean view", bind: [fly("Backquote", "hudDensity")] },
      {
        keys: "O",
        text: "The flight computer's MISSION tab, over the map: a destination, a transfer, a rendezvous, through the wormhole — PLAN, then EXECUTE",
        bind: [fly("KeyO", "missions")],
      },
      {
        keys: "⌫ Backspace",
        text: "Releases the controls: stops the mission, the hold and the autopilot",
        bind: [fly("Backspace", "stopFlight")],
      },
      { keys: "⇧K", text: "Leave the Ranger", bind: [fly("KeyK", "leaveShip", on)] },
      { keys: "Drag · double-click", text: "Look around from the attach point · look ahead" },
      {
        keys: "Pad",
        text: "Left stick pitch/yaw · LB RB roll · RT LT throttle · A SAS · X/Y pro/retrograde · B cut · D-pad ▲▼ camera",
      },
    ],
  },
  {
    title: "Controller (Xbox · PlayStation)",
    rows: [
      { keys: "Left stick", text: "Fly: forward · back · sideways (L3 held: boost)" },
      { keys: "Right stick", text: "Around: orbit the target · Free: look" },
      { keys: "RT · LT  (R2 · L2)", text: "Up · down" },
      { keys: "LB · RB  (L1 · R1)", text: "Roll" },
      { keys: "A  (✕)", text: "Fly to the target" },
      { keys: "B · X · Y  (○ □ △)", text: "Free fall · auto-orbit · next view" },
      { keys: "D-pad ◀ ▶ · ▲ ▼", text: "Previous / next target · closer / farther" },
      { keys: "R3 · View · Menu", text: "Recentre · run / pause time · the pause menu (Share · Options)" },
      { keys: "In the menus", text: "D-pad or left stick ▲ ▼ · A choose · B back · Start leaves the pause" },
    ],
  },
  {
    title: "Interface",
    rows: [
      { keys: "M · ⌘K", text: "Settings · search them (flying: ⇧M)" },
      {
        keys: "F2",
        text: "Game tools (developers: a local build or ?dev) — status, placement, targets, time, performance",
        bind: [codes("system", "F2", "tools")],
      },
      { keys: "I", text: "Details & physical readouts", bind: [scene("i", "details")] },
      {
        keys: "H · F · P",
        text: "Hide the interface · fullscreen · save PNG (flying, these keys fly: the toolbar's buttons)",
        bind: [scene("h", "toggleUi"), scene("f", "fullscreen"), scene("p", "png")],
      },
      {
        keys: "Esc",
        text: "Closes the panel on top; with nothing open, the pause menu (the time stops): resume, save, load, settings",
        bind: [codes("system", "Escape", "pause")],
      },
      { keys: "⌫ Backspace", text: "Stops a cinematic (flying: releases the controls)", bind: [scene("Backspace", "stopCinematic")] },
      { keys: "F5 · F9", text: "Quick save · quick load", bind: [codes("system", "F5", "quickSave"), codes("system", "F9", "quickLoad")] },
      { keys: "⌘Z · ⇧⌘Z", text: "Undo · redo" },
      { keys: "?", text: "This sheet", bind: [scene("?", "help")] },
    ],
  },
];

/** Every binding, in the table's order. */
export const BINDINGS: KeyBind[] = KEYMAP.flatMap((s) => s.rows.flatMap((r) => r.bind ?? []));

type KeyLike = Pick<KeyboardEvent, "code" | "key" | "shiftKey">;

const keyOf = (e: KeyLike) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

/** The binding a key press triggers in one layer, if any. */
export function matchIn(layer: KeyLayer, e: KeyLike, flying = false): KeyBind | undefined {
  const k = keyOf(e);
  return BINDINGS.find(
    (b) =>
      b.layer === layer &&
      (b.shift === undefined || b.shift === e.shiftKey) &&
      !(b.ground && flying) &&
      (b.notKey === undefined || b.notKey !== e.key) &&
      (b.code ? b.code.includes(e.code) : b.key!.includes(k)),
  );
}

/**
 * The binding a key press triggers, through the layers in order. `flightKey`: the key is a free-flight
 * key (it flies, nothing in the scene layer).
 */
export function matchKey(e: KeyLike, flying: boolean, flightKey: boolean): KeyBind | undefined {
  return (
    matchIn("system", e) ??
    (flying ? matchIn("flight", e) : undefined) ??
    matchIn("time", e) ??
    (flightKey ? undefined : matchIn("scene", e, flying))
  );
}
