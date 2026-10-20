// The ship's three HUDs and where they show (PLAN-MODES-AAA M4):
// - Atmosphere: a fighter's, in green — the airspeed and altitude tapes, Mach, the load, the incidence, the
//   vertical speed, the radar altitude, the autopilot's modes (hud/jethud.ts), the flight path vector;
// - Space: the orbit — the apsides and their times, the inclination, the period, the next burn and its Δv, the
//   target's range and closing rate, near Gargantua the clocks; the orbital markers, the future;
// - Approach: the runway's guidance or the vertical landing's scope, the radar altitude and the vertical
//   speed large, the glide's and the axis's deviations, the gear and the flaps, the flare.
// Chosen by the flight's phase (game/phase.ts), a change held a moment before it shows (no flicker at a
// boundary); the player may force one. The whole HUD shows in the chase and dorsal views by default
// (settings.hudViews): in the cockpit the cabin's screens are the instruments; the other views keep the
// warnings, the autopilot's card and the docking aid. Pure (tests/hudkind.test.ts).

import { t } from "../i18n";
import type { Stage } from "./phase";

export type HudKind = "atmo" | "space" | "approach";
export const HUD_KINDS: HudKind[] = ["atmo", "space", "approach"];
/** The setting: chosen by the phase, or forced. */
export type HudKindSetting = "auto" | HudKind;
/** Where the whole HUD shows. */
export type HudViews = "chaseDorsal" | "outside" | "all";

export interface HudKindInput {
  /** the flight's stage, its mode (landed, docked…) */
  stage: Stage | null;
  mode: string | null;
  /** on a runway's final */
  final: boolean;
  /** near the ground, low and slow, not landed: a hover, a vertical landing */
  low: boolean;
  /** out of any air (an airless world's: the Moon's) — its "flight" phase is a space flight, not an aircraft's */
  airless?: boolean;
}

/** The HUD the flight calls for now. */
export function hudKindOf(i: HudKindInput): HudKind {
  if (i.mode === "landed" || i.stage === "ground" || i.stage === "approach" || i.final || i.low) return "approach";
  // (over an airless world the phase says "flight" low over it: no air to fly — the space HUD; near the ground the
  // approach's, above. PLAN-VAISSEAUX X4: the Moon's descents showed the aircraft's HUD)
  if (i.stage === "air" && i.airless) return "space";
  if (i.stage === "air" || i.stage === "entry") return "atmo";
  return "space";
}

/** How long a new kind must hold before it shows [s]. */
export const HUD_KIND_HOLD = 1.5;

/** The kind shown: the flight's, once it has held `HUD_KIND_HOLD`; or the forced one at once. */
export class HudKindChooser {
  kind: HudKind | null = null;
  private candidate: HudKind | null = null;
  private since = 0;

  step(i: HudKindInput, nowS: number, setting: HudKindSetting = "auto"): HudKind {
    if (setting !== "auto") {
      this.kind = setting;
      this.candidate = null;
      return setting;
    }
    const want = hudKindOf(i);
    if (this.kind === null || want === this.kind) {
      this.kind = want;
      this.candidate = null;
      return want;
    }
    if (want !== this.candidate) {
      this.candidate = want;
      this.since = nowS;
    } else if (nowS - this.since >= HUD_KIND_HOLD) {
      this.kind = want;
      this.candidate = null;
    }
    return this.kind;
  }
}

/** The next setting in the key's cycle: auto → atmosphere → space → approach → auto. */
export function nextHudKind(s: HudKindSetting): HudKindSetting {
  const order: HudKindSetting[] = ["auto", "atmo", "space", "approach"];
  return order[(order.indexOf(s) + 1) % order.length]!;
}

/**
 * Whether the whole HUD (the symbology, its tapes, the flight's panels) shows in a view: "full", or "bare" —
 * the warnings, the autopilot's card, the docking aid and the key hints only. A spectator out: bare (the
 * ship's mark is its own).
 */
export function hudInView(mount: string, views: HudViews, spectating: boolean): "full" | "bare" {
  if (spectating) return "bare";
  if (views === "all") return "full";
  if (views === "outside") return mount === "cockpit" || mount === "cabin" ? "bare" : "full";
  return mount === "chase" || mount === "dorsal" ? "full" : "bare";
}

/** A kind's name, or the automatic choice's, translated (the toast, the bar's chip, TARS). */
export function hudKindName(k: HudKindSetting): string {
  return { auto: t("automatic"), atmo: t("Atmosphere"), space: t("Space"), approach: t("Approach") }[k];
}
