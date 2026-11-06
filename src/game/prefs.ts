// The player's own settings (settings.ts SETTING_KIND "pref": the budget, the display, the sound, the
// HUD's aids) — kept in the browser apart from the saved games, so a save loaded, a scene changed or a
// friend's flight opened leaves them as they are. The first time, they come from the last automatic
// save of a version 1 (which carried every setting).

import { defaultSettings, pickSettings, settingKeys, type Settings } from "../settings";
import { store } from "../util/storage";

const KEY = "kerr.prefs";
const AUTO_KEY = "kerr.autosave";
const NET_SHOWN_KEY = "kerr.prefs.netShown";

/** The player's settings as kept (checked: a value of the wrong kind is left out). */
export function readPrefs(): Partial<Settings> {
  const kept =
    store.getJSON<Record<string, unknown> | null>(KEY, null) ??
    store.getJSON<{ v?: number; settings?: Record<string, unknown> } | null>(AUTO_KEY, null)?.settings ??
    {};
  const d = defaultSettings() as unknown as Record<string, unknown>;
  // (the jet HUD's old choice — its units with it, "aviation" or "metric" —: on; the units now one setting for
  // everything, metric unless imperial is chosen)
  if (kept.hudJet === "aviation" || kept.hudJet === "metric") kept.hudJet = "on";
  // (the network's light and the data's loading in the top-left corner shown again once, whatever was kept: on by default, and
  // to be seen — Sam, 6 Nov 2026 — ; turned off since, they stay off)
  if (store.getJSON<boolean>(NET_SHOWN_KEY, false) !== true) {
    kept.showNetwork = true;
    kept.showLoading = true;
    store.setJSON(NET_SHOWN_KEY, true);
  }
  const out: Record<string, unknown> = {};
  for (const k of settingKeys("pref")) if (k in kept && typeof kept[k] === typeof d[k]) out[k] = kept[k];
  return out as Partial<Settings>;
}

/** Keeps the player's settings (true when the browser took them). */
export function writePrefs(s: Settings) {
  return store.setJSON(KEY, pickSettings(s, "pref"));
}
