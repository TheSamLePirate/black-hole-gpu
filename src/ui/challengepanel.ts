// The F-35's challenges chosen (docs/PLAN-F35.md, F9 — game/challenges.ts, controller/challenge.ts): a card each —
// its name, what it asks, its par, the best kept and its medal —, flown at once: the F-35 placed at its start
// (in the air over the course, on a final, over the pad), its tanks full, the judge running.

import "./challengepanel.css";
import type { CameraController } from "../controls";
import { bests } from "../controller/challenge";
import { combatBests } from "../controller/combat";
import { LOADOUTS } from "../game/combat";
import { SCENARIOS, type Scenario } from "../game/scenarios";
import { fleet } from "../fleet";
import { CHALLENGES, type ChallengeDef } from "../game/challenges";
import type { GameTools } from "../game/tools";
import { t, tf, tr } from "../i18n";
import { VESSELS } from "../vessels";
import { button, el as h, modal } from "./kit";

export interface ChallengeHost {
  tools: GameTools;
  camera: CameraController;
  toast(s: string): void;
}

const MEDAL: Record<string, string> = { gold: "🥇", silver: "🥈", bronze: "🥉" };

export class ChallengePanel {
  private close: (() => void) | null = null;

  constructor(private host: ChallengeHost) {}

  get isOpen() {
    return !!this.close;
  }

  open() {
    if (this.close) return;
    const root = h("div", "chp");
    const m = modal({ title: t("Challenges and fights — F-35B"), body: [root], cls: "chp-frame", testid: "challenge-panel", onClose: () => (this.close = null) });
    this.close = m.close;
    const B = bests();
    for (const d of CHALLENGES) {
      const card = h("div", "chp-card");
      const best = B[d.id];
      const par = d.kind === "gates" ? tf("par {0} s", d.par) : tf("par {0}/100", d.par);
      const bestTxt = best
        ? `${MEDAL[best.medal ?? ""] ?? "·"} ${d.kind === "gates" ? `${best.score.toFixed(1)} s` : `${Math.round(best.score)}/100`}`
        : t("not flown");
      card.append(
        h("b", "chp-name", tr(d.title)),
        h("p", "chp-brief", tr(d.brief)),
        h("span", "chp-par", par),
        h("span", "chp-best", bestTxt),
        button({ label: t("Fly"), kind: "primary", testid: `chp-go-${d.id}`, onClick: () => this.go(d) }),
      );
      root.append(card);
    }
    // the fights
    root.append(h("h4", "chp-h", t("Combat")));
    const CB = combatBests();
    for (const d of SCENARIOS) {
      const card = h("div", "chp-card chp-fight");
      const best = CB[d.id];
      const L = LOADOUTS[d.loadout];
      const load = [L.aim120 && `${L.aim120} AIM-120`, L.aim9x && `${L.aim9x} AIM-9X`, L.jdam && `${L.jdam} GBU-32`, `${L.gun} × 25 mm`].filter(Boolean).join(" · ");
      card.append(
        h("b", "chp-name", tr(d.title)),
        h("p", "chp-brief", tr(d.brief)),
        h("span", "chp-par", load),
        h("span", "chp-best", best ? `${Math.floor(best.time / 60)}:${String(Math.floor(best.time % 60)).padStart(2, "0")}` : t("not flown")),
        button({ label: t("Fight"), kind: "primary", testid: `chp-fight-${d.id}`, onClick: () => this.fight(d) }),
      );
      root.append(card);
    }
    if (this.host.camera.combat?.status === "run")
      root.append(
        button({
          label: t("End the fight"),
          kind: "danger",
          onClick: () => {
            this.host.camera.combatEnd();
            this.close?.();
          },
        }),
      );
    if (this.host.camera.chal?.status === "run")
      root.append(
        button({
          label: t("Abandon the challenge flown"),
          kind: "danger",
          onClick: () => {
            this.host.camera.challengeAbort();
            this.close?.();
          },
        }),
      );
  }

  /** A fight flown: the F-35 at its start over the range, its tanks full, its loadout, the world running. */
  fight(d: Scenario) {
    const T = this.host.tools;
    const C = this.host.camera;
    try {
      if (fleet.active !== "f35") T.set("vessel", "f35");
      C.nav.on = { l: false, v: false };
      C.challengeAbort();
      const D = Math.PI / 180;
      const lat = d.anchor.lat + d.start.n / (D * 6_371_008.8);
      const lon = d.anchor.lon + d.start.e / (D * 6_371_008.8 * Math.cos(d.anchor.lat * D));
      T.flyAt(lat, lon, d.start.agl, d.start.hdg, d.start.speed);
      C.airFlight.cfg.flaps = 0;
      C.pilot.throttle = C.pilot.engineNow = 0.85;
      fleet.fuel.f35 = VESSELS.f35.fuelKg ?? 0;
      C.combatStart(d);
      this.close?.();
    } catch (e) {
      this.host.toast(String((e as Error).message ?? e));
    }
  }

  /** A challenge flown: the F-35 at its start, its tanks full, the judge running. */
  go(d: ChallengeDef) {
    const T = this.host.tools;
    const C = this.host.camera;
    try {
      if (fleet.active !== "f35") T.set("vessel", "f35");
      C.nav.on = { l: false, v: false };
      if (C.combat) C.combatEnd();
      const s = d.start;
      if ("field" in s) {
        // (a final: 3° down to the aim point, at the reference speed, the gear down, full flaps)
        T.glideTo(s.field, s.final, (s.final * 1000 * Math.tan((3 * Math.PI) / 180)) / 1000 + 0.02, 78);
        if (C.pilot.auto !== "none") C.pilot.setAuto(C.pilot.auto);
        C.pilot.auto = "none";
        C.gearInit = true;
        C.gearDown = true;
        C.gearExt = 1;
        C.airFlight.cfg.flaps = 1;
        C.pilot.throttle = C.pilot.engineNow = 0.42;
      } else {
        T.flyAt(s.lat, s.lon, s.agl, s.hdg, s.speed);
        C.airFlight.cfg.flaps = 0;
        C.pilot.throttle = C.pilot.engineNow = d.kind === "vertical" ? 0.55 : 0.85;
        // (the vertical landing: the STOVL mode converting at once — the lift fan's doors open)
        if (d.kind === "vertical") {
          C.stovl.on = true;
          C.gearDown = true;
          C.gearExt = 1;
        }
      }
      fleet.fuel.f35 = VESSELS.f35.fuelKg ?? 0;
      C.challengeStart(d);
      this.close?.();
    } catch (e) {
      this.host.toast(String((e as Error).message ?? e));
    }
  }
}
