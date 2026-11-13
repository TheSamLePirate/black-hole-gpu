import type { CharacterSave } from "../controller/character";
// Saved games: the whole state of a flight (every setting at full precision, the scene's time, the
// pilot's modes, the ground under the ship, the flight plan) — kept in the browser (an automatic save
// resumed at the next visit, named slots), exported and imported as JSON files. The URL no longer
// carries the scene: its six digits put a ship in low orbit a thousand kilometres off.
//
// Versions: a save of an older version is migrated on the way in (MIGRATIONS, one step per version),
// then checked; one of a newer version is refused. v2: the player's own settings (SETTING_KIND
// "pref" — the budget, the display, the sound, the aids) are no longer in the save.

import type { FlightPlan } from "./flightplan";
import { defaultSettings, SETTING_KIND, settingKeys, type Settings } from "../settings";
import { caught } from "../debug";
import { store } from "../util/storage";
import type { ManeuverNode } from "../maneuver";
import type { Hold, Auto } from "../pilot";
import type { DockLink, FreeState } from "../fleet";
import { VESSEL_IDS, type VesselId } from "../vessels";
import { checkCraft, type CraftSave, type SavedActivity } from "../controller/craftsave";

/** The current version of a save. */
export const SAVE_VERSION = 2;

export interface GameSave {
  v: typeof SAVE_VERSION;
  name: string;
  /** Date.now() */
  savedAt: number;
  /** a line: where, doing what */
  summary: string;
  /** the scene it started from (older saves: none) */
  scene?: string | null;
  /** the game's settings: the scene and what it carried (not the player's own) */
  settings: Partial<Settings>;
  time: number;
  character?: CharacterSave | null;
  ship: {
    piloting: boolean;
    sas: boolean;
    hold: Hold;
    auto: Auto;
    throttle: number;
    precision: boolean;
    speedMode: "orbit" | "target";
    landed: { body: string; q: [number, number, number] } | null;
    spent: number;
    /** each craft's propellant spent (the fleet's tanks; older saves: the flown one's alone) */
    spentBy?: Record<string, number>;
    properTime: number;
    tunnelEntry?: "ours" | "gargantua";
    /** the site the entry autopilot flies to (its name; older saves: none — the nearest pass's) */
    entrySite?: string | null;
    /** a plane's flight plan (game/flightplan.ts; PLAN-F35 F8) */
    route?: FlightPlan | null;
    /** the deorbit planned and waited for (the entry frame's seconds): taken up again, not planned anew */
    entryPlan?: {
      tBurn: number;
      dv: number;
      trim: { t: number; dv: number } | null;
      plan: { heat: number; shield: number; g: number } | null;
    } | null;
    /** the camera on the craft (its frame: the eye, the aim, the up) when saved — the craft's attitude is the
     *  camera's through it: a director's shot, a view dragged about the craft are not their defaults (older
     *  saves: none — the attach point's own) */
    view?: { eye: [number, number, number]; aim: [number, number, number]; up?: [number, number, number] } | null;
  };
  /** the fleet: the craft flown, the ones coasting, the docks (older saves: none — the craft the settings
   *  name is the one flown, the others where the scene puts them) */
  fleet?: { active: VesselId; free: Partial<Record<VesselId, FreeState>>; links: DockLink[] };
  plan: { nodes: ManeuverNode[]; note: string; mission: unknown; universe?: "ours" | "gargantua" } | null;
  /** the free camera (no ship): falling freely (older saves: none) */
  camera?: { gravity: boolean };
  /** the craft's own state — the fuel, the gear, the flaps, the brakes, the engine, the jet's holds, the spacecraft's
   *  systems (controller/craftsave.ts, its own version; saves before 13 Nov 2026: none — tanks full, gear by the height) */
  craft?: CraftSave;
  /** the activity under way when saved — a mission, a fight, a challenge, a lesson: named, not resumed (the load says so) */
  activity?: SavedActivity | null;
}

// The browser's storage (audit 2026-11-10, AR-19): one key per save — an interrupted write, a later version's
// text, loses nothing but that save, and its text is kept aside (KEPT), never overwritten in silence; a name
// already taken is replaced only when asked. Before 13 Nov 2026 every save lived in one JSON under LEGACY: read,
// then moved one per key.
const AUTO_KEY = "kerr.autosave";
const SLOT = "kerr.save:";
const LEGACY = "kerr.saves";
/** an unreadable text kept aside: `kerr.kept:<what>@<ms>` (what: "autosave", "save:<name>", "saves") */
const KEPT = "kerr.kept:";

/** A stored save, checked: a corrupted or foreign one is reported and left out, never half-loaded. */
function stored(x: unknown, where: string): GameSave | null {
  if (x === null || x === undefined) return null;
  try {
    return checkSave(x);
  } catch (e) {
    caught(where, e);
    return null;
  }
}

/** A stored text read as a save (null: not one — not JSON, not a save, a later version's). */
function readText(raw: string | null, where: string): GameSave | null {
  if (raw === null) return null;
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch (e) {
    caught(where, e);
    return null;
  }
  return stored(x, where);
}

/** An unreadable text put aside under its own key before its place is written (false: the browser refused —
 *  then nothing is written over it). */
function keepAside(what: string, raw: string): boolean {
  let key = `${KEPT}${what}@${Date.now()}`;
  for (let k = 2; store.get(key) !== null; k++) key = `${KEPT}${what}@${Date.now()}-${k}`;
  const ok = store.set(key, raw);
  caught("save", new Error(ok ? `an unreadable ${what} kept aside as ${key}` : `an unreadable ${what} could not be kept aside`));
  return ok;
}

// (the autosave read as readable once — read or written —: not parsed again at every autosave)
let autoChecked = false;
export const autosave = {
  get: () => {
    const g = readText(store.get(AUTO_KEY), "autosave");
    if (g) autoChecked = true;
    return g;
  },
  /** false: the browser refused (storage full, private mode), or an unreadable autosave could not be kept aside */
  set: (g: GameSave) => {
    if (!autoChecked) {
      const raw = store.get(AUTO_KEY);
      if (raw !== null && !readText(raw, "autosave") && !keepAside("autosave", raw)) return false;
    }
    const ok = store.setJSON(AUTO_KEY, g);
    if (ok) autoChecked = true;
    return ok;
  },
  clear: () => {
    store.remove(AUTO_KEY);
    autoChecked = false;
  },
};

/** The former single key's saves, moved one per key (those already there kept); its text, unreadable, kept aside.
 *  Returns what it still holds (a move the browser refused: read from it until the next try). */
function legacy(): Record<string, unknown> {
  const raw = store.get(LEGACY);
  if (raw === null) return {};
  let all: unknown;
  try {
    all = JSON.parse(raw);
  } catch {
    all = null;
  }
  if (!all || typeof all !== "object" || Array.isArray(all)) {
    if (keepAside("saves", raw)) store.remove(LEGACY);
    return {};
  }
  const left: Record<string, unknown> = {};
  for (const [name, g] of Object.entries(all as Record<string, unknown>))
    if (store.get(SLOT + name) === null && !store.setJSON(SLOT + name, g)) left[name] = g;
  if (Object.keys(left).length) store.setJSON(LEGACY, left);
  else store.remove(LEGACY);
  return left;
}

/** A save's stored text by its name (its key, or the former single key's while it holds it). */
function slotText(name: string, old = legacy()): string | null {
  const raw = store.get(SLOT + name);
  return raw !== null ? raw : name in old ? JSON.stringify(old[name]) : null;
}

/** The outcome of storing a save: stored, refused because the name is taken (replace not asked), refused by the
 *  browser (storage full, private mode — the others untouched). */
export type PutResult = "ok" | "exists" | "refused";

export const slots = {
  /** every save's name, readable or not */
  names: (): string[] => {
    const old = legacy();
    return [...new Set([...store.keys(SLOT).map((k) => k.slice(SLOT.length)), ...Object.keys(old)])];
  },
  list: (): GameSave[] => {
    const old = legacy();
    return slots
      .names()
      .map((name) => readText(slotText(name, old), `save "${name}"`))
      .filter((g): g is GameSave => !!g)
      .sort((a, b) => b.savedAt - a.savedAt);
  },
  get: (name: string) => readText(slotText(name), `save "${name}"`),
  /** a readable save of that name */
  has: (name: string) => !!slots.get(name),
  /** the names stored that cannot be read (kept, not listed: saved again under one, its text is kept aside) */
  unreadable: (): string[] => {
    const old = legacy();
    return slots.names().filter((name) => !readText(slotText(name, old), `save "${name}"`));
  },
  /** `name`, or the first of "name (2)", "name (3)"… not taken */
  free: (name: string) => {
    let k = 2,
      n = name;
    while (slots.has(n)) n = `${name} (${k++})`;
    return n;
  },
  put: (g: GameSave, o: { replace?: boolean } = {}): PutResult => {
    const raw = slotText(g.name);
    if (raw !== null) {
      if (readText(raw, `save "${g.name}"`)) {
        if (!o.replace) return "exists";
      } else if (!keepAside(`save:${g.name}`, raw)) return "refused";
    }
    return store.setJSON(SLOT + g.name, g) ? "ok" : "refused";
  },
  remove: (name: string) => {
    const old = legacy();
    store.remove(SLOT + name);
    if (name in old) {
      delete old[name];
      if (Object.keys(old).length) store.setJSON(LEGACY, old);
      else store.remove(LEGACY);
    }
  },
  /** the unreadable texts kept aside (their keys) */
  kept: () => store.keys(KEPT),
};

/** One step up per version: MIGRATIONS[v] takes a save of version v to version v + 1. */
const MIGRATIONS: Record<number, (g: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: the player's own settings left out of the save
  1: (g) => {
    const set = { ...(g.settings as Record<string, unknown>) };
    for (const k of settingKeys("pref")) delete set[k];
    return { ...g, v: 2, settings: set };
  },
};

/** A save of any known version brought to the current one (unchanged when it is). */
export function migrateSave(x: Record<string, unknown>): Record<string, unknown> {
  let g = x;
  while (typeof g.v === "number" && g.v < SAVE_VERSION && MIGRATIONS[g.v]) g = MIGRATIONS[g.v]!(g);
  return g;
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isVec = (x: unknown) => Array.isArray(x) && x.length === 3 && x.every(isNum);

/**
 * A save checked on the way in (a file, a link, the browser's storage): the fields the game needs, of
 * the kinds it needs — the time, the ship's modes, the ground, the plan (throws with the first fault:
 * a corrupted save must not half-load a flight); settings of the wrong kind repaired to defaults, a malformed
 * walker or fleet left out.
 */
export function checkSave(x: unknown): GameSave {
  const fault = (why: string): never => {
    throw new Error(`not a saved game (${why})`);
  };
  if (!x || typeof x !== "object") fault("not an object");
  const g = migrateSave(x as Record<string, unknown>) as unknown as GameSave;
  if (g.v !== SAVE_VERSION) fault(`version ${String((g as { v?: unknown }).v)}`);
  if (!isNum(g.time)) fault("time");
  if (!g.settings || typeof g.settings !== "object") fault("settings");
  // (a setting of the wrong kind — a NaN saved as null — is repaired to its default, and told: the
  // flight still loads)
  const ref = defaultSettings() as unknown as Record<string, unknown>;
  const set = g.settings as unknown as Record<string, unknown>;
  const repaired: string[] = [];
  // (a setting the game does not know — a later version's, a foreign file's — or the player's own
  // is left out)
  for (const k of Object.keys(set)) if (!(k in SETTING_KIND) || SETTING_KIND[k as keyof Settings] === "pref") delete set[k];
  for (const [k, v] of Object.entries(set)) {
    const want = typeof ref[k];
    if ((want === "number" && !isNum(v)) || (want === "boolean" && typeof v !== "boolean")) {
      set[k] = ref[k];
      repaired.push(k);
    }
  }
  if (repaired.length) caught("save", new Error(`settings repaired to their defaults: ${repaired.join(", ")}`));
  if (g.character) {
    const c = g.character;
    if (
      typeof c.body !== "string" ||
      typeof c.ours !== "boolean" ||
      !isVec(c.q) ||
      !isVec(c.forward) ||
      (c.heading !== undefined && !isVec(c.heading)) ||
      ![c.yaw, c.pitch, c.distance, c.vertical].every(isNum) ||
      c.distance < 0.3 ||
      c.distance > 8
    ) {
      // (a walker that is not one is left out, told: the flight still loads, with the pilot on board)
      caught("save", new Error("the character left out: malformed"));
      delete g.character;
    }
  }
  const sh = g.ship;
  if (!sh || typeof sh !== "object") fault("ship");
  if (typeof sh.piloting !== "boolean" || typeof sh.hold !== "string" || typeof sh.auto !== "string") fault("ship's modes");
  if (!isNum(sh.throttle) || sh.throttle < 0 || sh.throttle > 1) fault("throttle");
  if (sh.landed !== null && (typeof sh.landed?.body !== "string" || !isVec(sh.landed.q))) fault("ground");
  if (g.plan !== null && g.plan !== undefined && !Array.isArray(g.plan.nodes)) fault("plan");
  if (sh.view != null && (!isVec(sh.view.eye) || !isVec(sh.view.aim) || (sh.view.up !== undefined && !isVec(sh.view.up))))
    fault("ship's view");
  if (sh.tunnelEntry !== undefined && sh.tunnelEntry !== "ours" && sh.tunnelEntry !== "gargantua") fault("tunnel entry side");
  if (g.plan?.universe !== undefined && g.plan.universe !== "ours" && g.plan.universe !== "gargantua") fault("plan universe");
  // (a fleet that is not one — a foreign file's — is left out, told: the flight still loads, the others
  // where the scene puts them)
  const F = g.fleet;
  if (F !== undefined && (!F || !VESSEL_IDS.includes(F.active) || typeof F.free !== "object" || !F.free || !Array.isArray(F.links))) {
    caught("save", new Error("the fleet left out: not a fleet"));
    delete g.fleet;
  }
  // (the craft's own state that is not one — a later version's, a foreign file's —: left out, told; the flight loads
  // with its tanks full, as before 13 Nov 2026)
  if (g.craft !== undefined && !checkCraft(g.craft)) {
    caught("save", new Error("the craft's state left out: not one this version reads"));
    delete g.craft;
  }
  const A = g.activity;
  if (A != null && (typeof A !== "object" || typeof A.kind !== "string" || typeof A.title !== "string")) delete g.activity;
  return g;
}

/** A save read from JSON text (a file, a link). */
export function parseSave(json: string): GameSave {
  return checkSave(JSON.parse(json));
}

/** Downloads a save as a JSON file. */
export function downloadSave(g: GameSave) {
  const blob = new Blob([JSON.stringify(g, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${g.name.replace(/[^\w.-]+/g, "_") || "ranger"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A save as a link's hash (#save=…, base64url of its JSON): for sharing, on demand only. */
export function saveToHash(g: GameSave) {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...g, plan: null }));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `#save=${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
export function saveFromHash(hash: string): GameSave | null {
  const m = /[#&]save=([\w-]+)/.exec(hash);
  if (!m) return null;
  const b64 = m[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return parseSave(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}
