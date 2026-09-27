// Saved games: the whole state of a flight (every setting at full precision, the scene's time, the
// pilot's modes, the ground under the ship, the flight plan) — kept in the browser (an automatic save
// resumed at the next visit, named slots), exported and imported as JSON files. The URL no longer
// carries the scene: its six digits put a ship in low orbit a thousand kilometres off.

import type { Settings } from "../settings";
import type { ManeuverNode } from "../maneuver";
import type { Hold, Auto } from "../pilot";

export interface GameSave {
  v: 1;
  name: string;
  /** Date.now() */
  savedAt: number;
  /** a line: where, doing what */
  summary: string;
  /** the scene it started from (older saves: none) */
  scene?: string | null;
  settings: Settings;
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
    properTime: number;
  };
  plan: { nodes: ManeuverNode[]; note: string; mission: unknown } | null;
}

const AUTO_KEY = "kerr.autosave";
const SLOTS_KEY = "kerr.saves";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export const autosave = {
  get: () => read<GameSave | null>(AUTO_KEY, null),
  set: (g: GameSave) => write(AUTO_KEY, g),
  clear: () => {
    try {
      localStorage.removeItem(AUTO_KEY);
    } catch {
      /* private mode */
    }
  },
};

export const slots = {
  list: (): GameSave[] => Object.values(read<Record<string, GameSave>>(SLOTS_KEY, {})).sort((a, b) => b.savedAt - a.savedAt),
  get: (name: string) => read<Record<string, GameSave>>(SLOTS_KEY, {})[name] ?? null,
  put: (g: GameSave) => {
    const all = read<Record<string, GameSave>>(SLOTS_KEY, {});
    all[g.name] = g;
    return write(SLOTS_KEY, all);
  },
  remove: (name: string) => {
    const all = read<Record<string, GameSave>>(SLOTS_KEY, {});
    delete all[name];
    return write(SLOTS_KEY, all);
  },
};

/** A save checked on the way in (a file, a link): the fields the game needs. */
export function parseSave(json: string): GameSave {
  const g = JSON.parse(json) as GameSave;
  if (!g || g.v !== 1 || typeof g.time !== "number" || !g.settings || !g.ship) throw new Error("not a saved game");
  return g;
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
