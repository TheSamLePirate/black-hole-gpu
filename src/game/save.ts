// Saved games: the whole state of a flight (every setting at full precision, the scene's time, the
// pilot's modes, the ground under the ship, the flight plan) — kept in the browser (an automatic save
// resumed at the next visit, named slots), exported and imported as JSON files. The URL no longer
// carries the scene: its six digits put a ship in low orbit a thousand kilometres off.
//
// Versions: a save of an older version is migrated on the way in (MIGRATIONS, one step per version),
// then checked; one of a newer version is refused. v2: the player's own settings (SETTING_KIND
// "pref" — the budget, the display, the sound, the aids) are no longer in the save.

import { defaultSettings, SETTING_KIND, settingKeys, type Settings } from "../settings";
import { caught } from "../debug";
import { store } from "../util/storage";
import type { ManeuverNode } from "../maneuver";
import type { Hold, Auto } from "../pilot";
import type { DockLink, FreeState } from "../fleet";
import { VESSEL_IDS, type VesselId } from "../vessels";

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
    /** the deorbit planned and waited for (the entry frame's seconds): taken up again, not planned anew */
    entryPlan?: {
      tBurn: number;
      dv: number;
      trim: { t: number; dv: number } | null;
      plan: { heat: number; shield: number; g: number } | null;
    } | null;
  };
  /** the fleet: the craft flown, the ones coasting, the docks (older saves: none — the craft the settings
   *  name is the one flown, the others where the scene puts them) */
  fleet?: { active: VesselId; free: Partial<Record<VesselId, FreeState>>; links: DockLink[] };
  plan: { nodes: ManeuverNode[]; note: string; mission: unknown; universe?: "ours" | "gargantua" } | null;
  /** the free camera (no ship): falling freely (older saves: none) */
  camera?: { gravity: boolean };
}

const AUTO_KEY = "kerr.autosave";
const SLOTS_KEY = "kerr.saves";

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

export const autosave = {
  get: () => stored(store.getJSON<unknown>(AUTO_KEY, null), "autosave"),
  set: (g: GameSave) => store.setJSON(AUTO_KEY, g),
  clear: () => store.remove(AUTO_KEY),
};

const allSlots = () => store.getJSON<Record<string, unknown>>(SLOTS_KEY, {});
export const slots = {
  list: (): GameSave[] =>
    Object.entries(allSlots())
      .map(([name, g]) => stored(g, `save "${name}"`))
      .filter((g): g is GameSave => !!g)
      .sort((a, b) => b.savedAt - a.savedAt),
  get: (name: string) => stored(allSlots()[name], `save "${name}"`),
  put: (g: GameSave) => {
    const all = allSlots();
    all[g.name] = g;
    return store.setJSON(SLOTS_KEY, all);
  },
  remove: (name: string) => {
    const all = allSlots();
    delete all[name];
    return store.setJSON(SLOTS_KEY, all);
  },
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
 * a corrupted save must not half-load a flight); settings of the wrong kind repaired to defaults.
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
  const sh = g.ship;
  if (!sh || typeof sh !== "object") fault("ship");
  if (typeof sh.piloting !== "boolean" || typeof sh.hold !== "string" || typeof sh.auto !== "string") fault("ship's modes");
  if (!isNum(sh.throttle) || sh.throttle < 0 || sh.throttle > 1) fault("throttle");
  if (sh.landed !== null && (typeof sh.landed?.body !== "string" || !isVec(sh.landed.q))) fault("ground");
  if (g.plan !== null && g.plan !== undefined && !Array.isArray(g.plan.nodes)) fault("plan");
  if (sh.tunnelEntry !== undefined && sh.tunnelEntry !== "ours" && sh.tunnelEntry !== "gargantua") fault("tunnel entry side");
  if (g.plan?.universe !== undefined && g.plan.universe !== "ours" && g.plan.universe !== "gargantua") fault("plan universe");
  // (a fleet that is not one — a foreign file's — is left out, told: the flight still loads, the others
  // where the scene puts them)
  const F = g.fleet;
  if (F !== undefined && (!F || !VESSEL_IDS.includes(F.active) || typeof F.free !== "object" || !F.free || !Array.isArray(F.links))) {
    caught("save", new Error("the fleet left out: not a fleet"));
    delete g.fleet;
  }
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
