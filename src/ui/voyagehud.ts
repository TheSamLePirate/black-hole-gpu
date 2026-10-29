// The voyage's card (docs/PLAN-CAMERA-AAA.md CAM5): where one goes, how far along, the speed (β, γ), the proper
// acceleration, and the two clocks — the world's t and the traveller's τ, their gap —, the time left on each. Shown
// while a voyage plays (camera/voyager.ts), hidden otherwise. FR + EN, distances in the units chosen (unitsFor).

import { t, tf } from "../i18n";
import { G_PER_M } from "../camera/voyage";
import { voyageFigures, type Voyage } from "../camera/voyager";
import type { Settings } from "../settings";
import { AU_M, M_METRES } from "../units";
import { unitsFor } from "./unitsys";

/** A duration as one reads it: 42 s, 12 min 03 s, 3 h 05 min, 2.3 d, 4.1 yr. */
export function fmtDuration(s: number): string {
  if (!Number.isFinite(s)) return "—";
  const a = Math.abs(s);
  if (a < 60) return `${a < 10 ? a.toFixed(1) : Math.round(a)} s`;
  if (a < 3600) return `${Math.floor(a / 60)} min ${String(Math.floor(a % 60)).padStart(2, "0")} s`;
  if (a < 86400) return `${Math.floor(a / 3600)} h ${String(Math.floor((a % 3600) / 60)).padStart(2, "0")} min`;
  if (a < 365.25 * 86400) return tf("{0} d", (a / 86400).toFixed(1));
  return tf("{0} yr", (a / (365.25 * 86400)).toFixed(2));
}

/** A distance in space: the units' near, millions of km, au. */
function fmtSpace(s: Settings, m: number) {
  if (m < 1e9) return unitsFor(s).fDist(m, m < 1e5 ? 2 : 0);
  if (m < 0.05 * AU_M) return tf("{0} million km", (m / 1e9).toFixed(1));
  return tf("{0} au", (m / AU_M).toFixed(3));
}

export class VoyageHud {
  private el: HTMLDivElement;
  private shown = false;
  private at = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "voyage-hud";
    this.el.dataset.testid = "voyage-hud";
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  update(v: Voyage | null, s: Settings) {
    if (!v) {
      if (this.shown) (this.el.hidden = true), (this.shown = false);
      return;
    }
    // (ten times a second: the card is read, not watched frame by frame)
    const now = performance.now();
    if (this.shown && now - this.at < 100 && v.state?.phase !== "done") return;
    this.at = now;
    this.shown = true;
    this.el.hidden = false;
    const f = voyageFigures(v);
    const phase =
      f.phase === "accel"
        ? t("accelerating")
        : f.phase === "decel"
          ? t("decelerating")
          : f.phase === "cruise"
            ? t("cruising")
            : f.phase === "bound"
              ? t("held by the nearby world")
              : t("arrived");
    const g = f.a / G_PER_M;
    const pct = Math.round(f.u * 100);
    const row = (k: string, v: string, cls = "") => `<div class="vh-row ${cls}"><span>${k}</span><b>${v}</b></div>`;
    this.el.innerHTML =
      `<div class="vh-head">${tf("Voyage to {0}", f.name || t("the target"))}<i>${phase}</i></div>` +
      `<div class="vh-bar"><div style="width:${pct}%"></div></div>` +
      row("β", `${f.beta < 0.01 ? f.beta.toExponential(1) : f.beta.toFixed(f.beta > 0.99 ? 4 : 3)} c`) +
      row("γ", f.gamma < 1.001 ? f.gamma.toFixed(6) : f.gamma.toFixed(3)) +
      row(t("acceleration"), `${g >= 1e4 ? g.toExponential(1) : Math.round(g)} g`) +
      row(t("distance to go"), fmtSpace(s, f.left * M_METRES)) +
      row(t("world clock t"), `${fmtDuration(f.t)} / ${fmtDuration(f.T)}`, "vh-t") +
      row(t("your clock τ"), `${fmtDuration(f.tau)} / ${fmtDuration(f.Tau)}`, "vh-tau") +
      row(t("gap t − τ"), fmtDuration(f.t - f.tau), "vh-gap") +
      `<div class="vh-hint">${t("drag: look around — G: stop here")}</div>`;
  }
}
