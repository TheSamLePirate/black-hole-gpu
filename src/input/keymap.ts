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

export type KeyLayer = "system" | "flight" | "time" | "scene" | "character";

export type KeyAction =
  // system
  | "tools"
  | "gameMode"
  | "atlas"
  | "skyEvents"
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
  | "orders"
  | "auto"
  | "map"
  | "mount"
  | "spectator"
  | "assist"
  | "vessel"
  | "flightMode"
  | "antigrav"
  | "flaps"
  | "airBrake"
  | "jetSystem"
  | "spaceSystem"
  | "route"
  | "combat"
  | "cineShot"
  | "gear"
  | "tars"
  | "pathInView"
  | "hudDensity"
  | "hudKind"
  | "missions"
  | "stopFlight"
  | "ack"
  | "leaveShip"
  | "characterJump"
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
  | "observe"
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
    // (not on foot: the walker's camera is its own — over the shoulder, never locked on a target nor a telescope)
    title: "Camera — every mode but on foot",
    rows: [
      {
        keys: "V · ⇧V",
        text: "Next · previous view (without the ship: around · follow · free · tripod · free fall; the ship: its views)",
        bind: [scene("v", "nextView")],
      },
      { keys: "C", text: "Look at the target: the view locked on it, wherever the camera goes", bind: [scene("c", "lookAt", off)] },
      {
        keys: "Y",
        text: "Telescope: fields down to 0.02°, held on the target (the wheel zooms) — on foot, the tripod set where you stand first",
        bind: [scene("y", "telescope", off)],
      },
      {
        keys: "⇧Y",
        text: "The observatory: what to see from the Earth's ground — when it is up, at its best — and the telescope taken to it",
        bind: [scene("y", "observe", on)],
      },
      {
        keys: "Tab · ⇧Tab",
        text: "Next · previous target (or click it in the view) — held: the radial wheel (views, holds, autopilots)",
        bind: [scene("Tab", "target")],
      },
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
        text: "Tripod on the ground: the target's world (else the nearest), level, facing the horizon — on foot, where one stands, looking the same way",
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
    title: "Flying a spacecraft (K) — KSP's layout",
    rows: [
      { keys: "W S · A D · Q E", text: "Pitch · yaw · roll (Z S · Q D · A E on AZERTY)" },
      {
        keys: "⇧ · Alt · ↑ ↓",
        text: "Throttle up · down (held)",
        bind: [fly(["ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"], "held")],
      },
      {
        keys: "Z · X · ⇧X",
        text: "Full throttle · cut (W · X on AZERTY) — on the entry autopilot's approach, full throttle goes around · back to a stable craft: the F-35 wings level, a gentle climb, a safe speed, then the holds; a spacecraft its turn stopped, over a ground a hover, in orbit prograde held",
        bind: [
          fly("KeyZ", "throttleFull", off),
          fly("KeyX", "throttleCut", off),
          fly("KeyX", "jetSystem", { arg: "recover", shift: true }),
        ],
      },
      {
        keys: "⇧Z · ' · ⇧'",
        text: "Plane mode, the jet's systems: afterburner (the throttle full, thrust ×1.5) · autopilot: the altitude and heading held (the stick flies through it; let go, the new ones held) · autothrottle: the speed held (⇧ Alt then set it) (' is ù on AZERTY)",
        bind: [
          fly("KeyZ", "jetSystem", { arg: "ab", shift: true }),
          fly("Quote", "jetSystem", { arg: "ap", shift: false }),
          fly("Quote", "jetSystem", { arg: "athr", shift: true }),
        ],
      },
      {
        keys: "⇧B",
        text: "F-35B: STOVL mode — the lift fan, the nozzle swivelled down; below 65 m/s the hover law: the stick a speed over the ground, ⇧ Alt a vertical speed, let go held in place",
        bind: [fly("KeyB", "jetSystem", { arg: "stovl", shift: true })],
      },
      {
        keys: "⇧M · ⇧O",
        text: "A plane's flight plan: NAV — the autopilot flying it (LNAV the route, VNAV its altitudes and speeds; the stick takes them off) · the flight plan's panel: its waypoints edited on the map, its fuel, the bingo",
        bind: [fly("KeyM", "jetSystem", { arg: "nav", shift: true }), fly("KeyO", "route", { shift: true })],
      },
      {
        keys: "Space · Enter · Tab · = · −",
        text: "In a fight (the F-35's): the gun (held — the pause on Esc then) · the weapon chosen released · the radar's lock on the next target · the next weapon (AIM-9X, AIM-120, JDAM) · a flare and chaff",
        bind: [fly("Equal", "combat", { arg: "weapon" }), fly(["Minus", "IntlBackslash"], "combat", { arg: "cm" })],
      },
      {
        keys: "⇧L",
        text: "In a fight: the head locked on the target (padlock) — it follows the lock, the missile's target, what was shot down falling, its crash, zoomed on it; again: the head free",
        bind: [fly("KeyL", "combat", { arg: "padlock", shift: true })],
      },
      {
        keys: "Tab held › Flight · F13",
        text: "The flight's leader: the orders' wheel (rejoin, formation, tighten, loosen, attack my target, engage, cover me, hold here, RTB, break) — to the room's wingmen and the AI wingmen; its key (F13) given another in the controls, or a HOTAS button",
        bind: [fly("F13", "orders")],
      },
      {
        keys: "I K · J L · H N",
        text: "RCS translation: down/up · left/right · forward/back",
        bind: [fly(["KeyI", "KeyJ", "KeyH", "KeyN"], "held"), fly("KeyL", "held", { shift: false }), fly("KeyK", "held", off)],
      },
      { keys: "Caps Lock", text: "Precision controls (fine rotation, throttle, RCS)", bind: [fly("CapsLock", "precision")] },
      { keys: "T", text: "SAS: stability assist", bind: [fly("KeyT", "sas", { shift: false })] },
      { keys: "R", text: "Roll alignment: wings in the orbital plane while the nose is held", bind: [fly("KeyR", "roll", off)] },
      {
        keys: "1 – 7",
        text: "Hold prograde · retrograde · radial ± · normal ± · target (ANTI, NODE on the panel)",
        bind: HOLDS.map((h, i) => fly(`Digit${i + 1}`, "hold", { arg: h })),
      },
      {
        keys: "8 · 9 · 0 · ⇧0 · F7 · U · B",
        text: "Autopilot: hold position · circularize · approach · orbit the target · land · take off · dock (the ISS within 3 km)",
        bind: [
          fly("Digit8", "auto", { arg: "hover", shift: false }),
          fly("Digit9", "auto", { arg: "circularize", shift: false }),
          fly("Digit0", "auto", { arg: "approach", shift: false }),
          fly("Digit0", "auto", { arg: "orbit", shift: true }),
          fly("F7", "auto", { arg: "land" }),
          fly("KeyU", "auto", { arg: "takeoff" }),
          fly("KeyB", "auto", { arg: "dock", shift: false }),
        ],
      },
      {
        keys: "⇧8 · ⇧9",
        text: "Station keeping: held where it is against the station or a craft within 5 km, on the thrusters (docked: undock, back off 30 m, then hold) · RCS mode: the attitude keys turn the craft, or translate it (W S up · down, A D left · right, ⇧ Alt forward · back; Q E still roll)",
        bind: [fly("Digit8", "spaceSystem", { arg: "keep", shift: true }), fly("Digit9", "spaceSystem", { arg: "rcsMode", shift: true })],
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
        keys: "V (last view)",
        text: "Spectator: a free camera, anywhere — the ship flies on, its autopilots and plan (the Free camera mode, F3; F1 or V: back to it)",
      },
      {
        keys: "⇧F4",
        text: "Autopilot: it flies, or it assists — you fly, its director on the HUD shows where to point, how much throttle",
        bind: [fly("F4", "assist", on)],
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
        keys: "G",
        text: "Landing gear: down · up (8 s; locked down on the ground; an alarm if it is up low and slow)",
        bind: [fly("KeyG", "gear", off)],
      },
      {
        keys: "⇧G",
        text: "Entry & landing: from orbit the deorbit burn for a site (the flight computer's LAND tab chooses it), the guided entry, the glide and the landing",
        bind: [fly("KeyG", "auto", { arg: "entry", shift: true })],
      },
      { keys: "⇧Y", text: "The future path in the view", bind: [fly("KeyY", "pathInView", on)] },
      {
        keys: "\\",
        text: "The Director view's shot: the director chooses · chase · slow orbit · fly-by · ground tracking · the planet's limb · the destination (` on a French Mac keyboard)",
        bind: [fly("Backslash", "cineShot")],
      },
      {
        keys: "²  (`) · ⇧²",
        text: "HUD density: full · minimal · clean view · the HUD: automatic (by the flight) · Atmosphere · Space · Approach",
        bind: [fly("Backquote", "hudDensity", off), fly("Backquote", "hudKind", on)],
      },
      {
        keys: "O",
        text: "The flight computer's MISSION tab, over the map: a destination, a transfer, a rendezvous, through the wormhole — PLAN, then EXECUTE",
        bind: [fly("KeyO", "missions", { shift: false })],
      },
      {
        keys: "⌫ Backspace",
        text: "Releases the controls: stops the mission, the hold and the autopilot",
        bind: [fly("Backspace", "stopFlight")],
      },
      {
        keys: "Enter",
        text: "Acknowledges the master caution: the lamp out, the warning silent (in a fight: the weapon released)",
        bind: [fly("Enter", "ack")],
      },
      { keys: "⇧K", text: "Disembark / board a landed craft (on foot: approach its access)", bind: [fly("KeyK", "leaveShip", on)] },
      { keys: "Drag · double-click", text: "Look around from the attach point · look ahead" },
      {
        keys: "Pad",
        text: "Left stick pitch/yaw · LB RB roll · RT LT throttle · A SAS · X/Y pro/retrograde · B cut · D-pad ▲▼ camera",
      },
    ],
  },
  {
    title: "The F-35 on a controller (Xbox 360 · Xbox · PlayStation)",
    rows: [
      { keys: "Left stick", text: "Pitch (back: nose up) · roll" },
      { keys: "Right stick", text: "Turn the head: look where it points — back ahead when let go" },
      { keys: "R3  (click the right stick)", text: "Zoom the view (held)" },
      { keys: "RT · LT  (R2 · L2)", text: "Throttle up · down" },
      { keys: "LB · RB  (L1 · R1)", text: "Rudder left · right" },
      { keys: "L3  (click the left stick)", text: "Afterburner" },
      { keys: "A  (✕)", text: "Gun (held)" },
      { keys: "B  (○)", text: "Fire the weapon chosen (out of a fight: acknowledge)" },
      { keys: "X  (□)", text: "Next weapon" },
      { keys: "Y  (△)", text: "Tap: lock the next target · hold: the intercept" },
      { keys: "D-pad ▲ ▼ ◀ ▶", text: "Gear · flaps · flares and chaff · airbrake" },
      {
        keys: "View · Menu",
        text: "Tap: the camera's view — hold: the head locked on the target · tap: the autopilot's holds — hold: the settings",
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
        keys: "F1 · F2 · F3 · F4",
        text: "The game's modes: Ship · On foot · Free camera (anywhere in the system; a ship flies on) · Photo (renders, videos) — the top bar's tabs",
        bind: [
          codes("system", "F1", "gameMode", { arg: "ship", shift: false }),
          codes("system", "F2", "gameMode", { arg: "foot", shift: false }),
          codes("system", "F3", "gameMode", { arg: "free", shift: false }),
          codes("system", "F4", "gameMode", { arg: "photo", shift: false }),
        ],
      },
      {
        keys: "F6",
        text: 'TARS, in every mode: tap — write to him; hold — speak to him. Ask him anything, or ask him to do it: land us at Edwards, take us to the Moon, walk here, render this view, warp ×1000… (his honesty and humour: "honesty 70")',
        bind: [codes("system", "F6", "tars")],
      },
      {
        keys: "F8",
        text: "The Atlas: the Earth, the Moon and Mars as maps — destinations, addresses, coordinates; in orbit over a place, landed, on foot, the free camera, a tripod",
        bind: [codes("system", "F8", "atlas", { shift: false })],
      },
      {
        keys: "⇧F8",
        text: "The sky's events from here (on the Earth): star trails, analemma, the Moon, the ISS and its transits, eclipses, selenelion — go there, live it, render it",
        bind: [codes("system", "F8", "skyEvents", { shift: true })],
      },
      {
        keys: "F10",
        text: "Game tools (developers: a local build or ?dev) — status, placement, targets, time, performance",
        bind: [codes("system", "F10", "tools")],
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
KEYMAP.push({
  title: "On foot",
  rows: [
    { keys: "W A S D · Shift", text: "Walk relative to the camera · run (remappable free-camera movement keys)" },
    { keys: "Space", text: "Jump with the local gravity", bind: [codes("character", "Space", "characterJump")] },
    { keys: "Drag · wheel", text: "Orbit the character · camera distance" },
  ],
});
export const BINDINGS: KeyBind[] = KEYMAP.flatMap((s) => s.rows.flatMap((r) => r.bind ?? []));

type KeyLike = Pick<KeyboardEvent, "code" | "key" | "shiftKey">;

const keyOf = (e: KeyLike) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

/** The binding a key press triggers in one layer, if any. */
export function matchIn(layer: KeyLayer, e: KeyLike, flying = false, list: KeyBind[] = BINDINGS): KeyBind | undefined {
  const k = keyOf(e);
  return list.find(
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
 * key (it flies, nothing in the scene layer). `list`: the bindings as the player set them
 * (input/bindings.ts effectiveBindings), the defaults otherwise.
 */
export function matchKey(
  e: KeyLike,
  flying: boolean,
  flightKey: boolean,
  list: KeyBind[] = BINDINGS,
  character = false,
): KeyBind | undefined {
  return (
    matchIn("system", e, false, list) ??
    (character
      ? (matchIn("character", e, false, list) ??
        (["leaveShip", "map"].includes(matchIn("flight", e, false, list)?.do ?? "") ? matchIn("flight", e, false, list) : undefined))
      : flying
        ? matchIn("flight", e, false, list)
        : undefined) ??
    matchIn("time", e, false, list) ??
    (character
      ? matchIn("scene", e, false, list) &&
        ["help", "png", "fullscreen", "details", "toggleUi", "quality", "map", "standOn", "telescope", "observe"].includes(
          matchIn("scene", e, false, list)!.do,
        )
        ? matchIn("scene", e, false, list)
        : undefined
      : flightKey
        ? undefined
        : matchIn("scene", e, flying, list))
  );
}
