// What each cockpit control does (PLAN-COCKPIT K2), and how its tip names it: the flight's own actions —
// those of the keys, through the same handlers (main.ts keyActions) — the lights' settings, the chronometer.

import { t, tf, tr } from "../i18n";
import { keyFor } from "../input/bindings";
import type { KeyAction } from "../input/keymap";
import type { Settings } from "../settings";
import type { Chrono } from "./chrono";
import { CONTROLS, type ControlState } from "./controls";

export interface CockpitDeps {
  settings: Settings;
  chrono: Chrono;
  /** a key's action (main.ts keyActions) */
  key(action: KeyAction, arg?: string): void;
  /** the flaps set (0, ½, 1), the air brake (0…1) */
  setFlaps(v: number): void;
  setAirBrake(v: number): void;
  /** the autopilot and the holds off */
  apOff(): void;
  /** a message to the pilot */
  toast(msg: string): void;
  /** the settings changed (the panel, the saved scene) */
  changed(): void;
}

/** The key each control's action has (its tip shows it). */
const KEYS: Record<string, [KeyAction, string?]> = {
  flaps: ["flaps"],
  airBrake: ["airBrake"],
  sas: ["sas"],
  holdPrograde: ["hold", "prograde"],
  holdRetrograde: ["hold", "retrograde"],
  holdTarget: ["hold", "target"],
  assist: ["assist"],
  autoEntry: ["auto", "entry"],
  autoLand: ["auto", "land"],
};

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** A control worked: set to `value` (a lever, a switch, the knob) or pushed (a button). */
export function cockpitAct(d: CockpitDeps, id: string, value?: number) {
  const S = d.settings;
  const sw = (k: "nightLighting" | "navLights" | "strobeLights" | "landingLights", name: string) => {
    S[k] = (value ?? (S[k] ? 0 : 1)) > 0.5;
    d.toast(`${name} — ${S[k] ? t("ON") : t("OFF")}`);
    d.changed();
  };
  switch (id) {
    case "gear":
      // (the gear is lowered by itself for now: below 600 m and 160 m/s — PLAN-COCKPIT K4 commands it)
      return d.toast(t("Landing gear: lowered by itself below 600 m and 160 m/s"));
    case "flaps":
      return d.setFlaps(value ?? 0);
    case "airBrake":
      return d.setAirBrake(value ?? 0);
    case "dimmer":
      S.cabinLight = Math.min(Math.max(value ?? S.cabinLight, 0), 1);
      return d.changed();
    case "night":
      return sw("nightLighting", t("Night lighting"));
    case "navLights":
      return sw("navLights", t("Navigation lights"));
    case "strobe":
      return sw("strobeLights", t("Strobe lights"));
    case "landingLights":
      return sw("landingLights", t("Landing lights"));
    case "chrono": {
      const was = d.chrono.seconds();
      const r = d.chrono.push();
      return d.toast(r === "started" ? t("Chronometer started") : r === "stopped" ? tf("Chronometer stopped: {0}", fmtClock(was)) : t("Chronometer reset"));
    }
    case "apOff":
      return d.apOff();
    default: {
      const k = KEYS[id];
      if (k) d.key(k[0], k[1]);
    }
  }
}

/** A control's tip: its name, its state now, its key. */
export function controlTip(id: string, st: ControlState | undefined, d: Pick<CockpitDeps, "chrono">): { name: string; state: string; key: string | null } | null {
  const c = CONTROLS.find((x) => x.id === id);
  if (!c) return null;
  const p = st?.pos ?? 0;
  const pct = `${Math.round(p * 100)} %`;
  let state: string;
  if (id === "gear") state = p > 0.5 ? t("down (by itself)") : t("up (by itself)");
  else if (id === "flaps" || id === "airBrake" || id === "dimmer") state = pct;
  else if (id === "chrono") state = `${d.chrono.running ? t("running") : t("stopped")} · ${fmtClock(d.chrono.seconds())}`;
  else if (c.kind === "toggle") state = p > 0.5 ? t("ON") : t("OFF");
  else if (id === "apOff") state = t("push: everything off");
  else state = (st?.lit ?? 0) > 0.5 ? t("ON") : t("OFF");
  const k = KEYS[id];
  return { name: tr(c.name), state, key: k ? keyFor(k[0], k[1]) : null };
}
