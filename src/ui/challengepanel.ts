// The F-35's challenges chosen (docs/PLAN-F35.md, F9 — game/challenges.ts, controller/challenge.ts): a card each —
// its name, what it asks, its par, the best kept and its medal —, flown at once: the F-35 placed at its start
// (in the air over the course, on a final, over the pad), its tanks full, the judge running.

import "./challengepanel.css";
import type { CameraController } from "../controls";
import { bests } from "../controller/challenge";
import { AERO_BOX, aeroBests } from "../controller/aerobatics";
import { combatBests } from "../controller/combat";
import { FIGURE_ORDER, FIGURES, type FigureId } from "../game/aerobatics";
import { LOADOUTS } from "../game/combat";
import { SCENARIOS, type Scenario } from "../game/scenarios";
import { fleet } from "../fleet";
import { CHALLENGES, type ChallengeDef } from "../game/challenges";
import type { GameTools } from "../game/tools";
import { t, tf, tr } from "../i18n";
import { VESSELS } from "../vessels";
import { button, el as h, modal } from "./kit";
import { AIR_MISSIONS } from "../game/airmissions";
import { briefMission, flyMission } from "./airmission";
import type { MissionSpec } from "../game/mission";
import { dropMission, myMissions } from "./missioneditor";

export interface ChallengeHost {
  tools: GameTools;
  camera: CameraController;
  toast(s: string): void;
  /** the mission editor (P3): a mission made, or one edited */
  editMission?(spec?: MissionSpec): void;
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
    const m = modal({
      title: t("Challenges and fights — F-35B"),
      body: [root],
      cls: "chp-frame",
      testid: "challenge-panel",
      onClose: () => (this.close = null),
    });
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
    // the aerobatic figures: watched (flown by their program) or flown, judged; the box
    root.append(h("h4", "chp-h", t("Aerobatics")));
    const AB = aeroBests();
    const box = h("div", "chp-card chp-aero");
    box.append(
      h("b", "chp-name", t("The aerobatic box")),
      h(
        "p",
        "chp-brief",
        t("Five figures in a row — loop, aileron roll, Immelmann, split-S, barrel roll — each judged out of 20: out of 100 together."),
      ),
      h("span", "chp-par", AERO_BOX.map((id) => t(FIGURES[id].name)).join(" · ")),
      h("span", "chp-best", AB.box !== undefined ? `${AB.box.toFixed(1)}/100` : t("not flown")),
      button({ label: t("Fly"), kind: "primary", testid: "chp-aero-box", onClick: () => this.figure("box", "judge") }),
    );
    root.append(box);
    for (const id of FIGURE_ORDER) {
      const F = FIGURES[id];
      const card = h("div", "chp-card chp-aero");
      card.append(
        h("b", "chp-name", t(F.name)),
        h("p", "chp-brief", t(F.brief)),
        h(
          "span",
          "chp-par",
          tf("entry {0} m/s · {1} m", F.entry.v, F.entry.agl) + (F.entry.law === "direct" ? ` · ${t("direct law")}` : ""),
        ),
        h("span", "chp-best", AB[id] !== undefined ? `${AB[id]!.toFixed(1)}/20` : t("not flown")),
        button({ label: t("Watch"), testid: `chp-aero-demo-${id}`, onClick: () => this.figure(id, "demo") }),
        button({ label: t("Fly"), kind: "primary", testid: `chp-aero-${id}`, onClick: () => this.figure(id, "judge") }),
      );
      root.append(card);
    }
    // the missions (PLAN-AVIATION-AAA P1): briefed, then flown; made, edited, kept (P3)
    root.append(h("h4", "chp-h", t("Missions")));
    const edit = this.host.editMission;
    const card = (spec: MissionSpec, mine: boolean) => {
      const c = h("div", "chp-card chp-fight");
      c.append(
        h("b", "chp-name", spec.title),
        h("p", "chp-brief", spec.brief),
        h("span", "chp-par", tf("{0} objectives", spec.objectives.filter((o) => !o.optional).length)),
        h("span", "chp-best", spec.limit ? tf("{0} min", Math.round(spec.limit / 60)) : ""),
        button({ label: t("Briefing"), kind: "primary", testid: `chp-msn-${spec.id}`, onClick: () => this.mission(spec) }),
      );
      if (edit)
        c.append(
          button({
            label: t("Edit"),
            testid: `chp-edit-${spec.id}`,
            onClick: () => {
              this.close?.();
              edit(spec);
            },
          }),
        );
      if (mine)
        c.append(
          button({
            label: t("Remove"),
            kind: "danger",
            onClick: () => {
              dropMission(spec.id);
              c.remove();
            },
          }),
        );
      root.append(c);
    };
    for (const m of AIR_MISSIONS) card(m.make(), false);
    for (const spec of myMissions()) card(spec, true);
    if (edit)
      root.append(
        button({
          label: t("Make a mission"),
          testid: "chp-msn-new",
          onClick: () => {
            this.close?.();
            edit();
          },
        }),
      );
    // the fights
    root.append(h("h4", "chp-h", t("Combat")));
    const CB = combatBests();
    for (const d of SCENARIOS) {
      const card = h("div", "chp-card chp-fight");
      const best = CB[d.id];
      const L = LOADOUTS[d.loadout];
      const load = [L.aim120 && `${L.aim120} AIM-120`, L.aim9x && `${L.aim9x} AIM-9X`, L.jdam && `${L.jdam} GBU-32`, `${L.gun} × 25 mm`]
        .filter(Boolean)
        .join(" · ");
      card.append(
        h("b", "chp-name", tr(d.title)),
        h("p", "chp-brief", tr(d.brief)),
        h("span", "chp-par", load),
        h(
          "span",
          "chp-best",
          best ? `${Math.floor(best.time / 60)}:${String(Math.floor(best.time % 60)).padStart(2, "0")}` : t("not flown"),
        ),
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
    if (this.host.camera.mission)
      root.append(
        button({
          label: t("Abandon the mission"),
          kind: "danger",
          onClick: () => {
            this.host.camera.missionAbort();
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
    try {
      flyFight(this.host, d);
      this.close?.();
    } catch (e) {
      this.host.toast(String((e as Error).message ?? e));
    }
  }

  /** A mission: its briefing, then flown (the panel closed). */
  mission(spec: MissionSpec) {
    this.close?.();
    briefMission(spec, () => {
      try {
        this.host.toast(flyMission(this.host, spec));
      } catch (e) {
        this.host.toast(String((e as Error).message ?? e));
      }
    });
  }

  /** An aerobatic figure — watched or flown —, or the box: the F-35 placed at its entry, the program or the judge on. */
  figure(id: FigureId | "box", mode: "demo" | "judge") {
    try {
      flyFigure(this.host, id, mode);
      this.close?.();
    } catch (e) {
      this.host.toast(String((e as Error).message ?? e));
    }
  }

  /** A challenge flown: the F-35 at its start, its tanks full, the judge running. */
  go(d: ChallengeDef) {
    try {
      flyChallenge(this.host, d);
      this.close?.();
    } catch (e) {
      this.host.toast(String((e as Error).message ?? e));
    }
  }
}

/** A fight flown — the Challenges card and TARS: the F-35 at its start over the range, its tanks full, its loadout. */
export function flyFight(host: ChallengeHost, d: Scenario) {
  const T = host.tools;
  const C = host.camera;
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
}

/** Where the figures are flown: over the Mojave's dry lakes, east, the desert below. */
const AERO_SPOT = { lat: 35.05, lon: -117.75, hdg: 90 };

/** An aerobatic figure — the Challenges card and TARS: the F-35 at its entry (its speed, its height and some), its
 *  tanks full, its law the figure's (the spin's demonstration sets the direct one itself), begun at the next frame. */
export function flyFigure(host: ChallengeHost, id: FigureId | "box", mode: "demo" | "judge") {
  const T = host.tools;
  const C = host.camera;
  if (fleet.active !== "f35") T.set("vessel", "f35");
  C.nav.on = { l: false, v: false };
  if (C.combat) C.combatEnd();
  C.challengeAbort();
  C.aeroStop();
  const F = FIGURES[id === "box" ? AERO_BOX[0]! : id];
  T.flyAt(AERO_SPOT.lat, AERO_SPOT.lon, F.entry.agl + 800, AERO_SPOT.hdg, F.entry.v);
  C.airFlight.cfg.flaps = 0;
  C.gearDown = false;
  C.gearExt = 0;
  C.pilot.throttle = C.pilot.engineNow = 0.85;
  // (the player's spin: the direct law set for its entry)
  if (mode === "judge" && F.entry.law === "direct") C.s.f35Law = "direct";
  fleet.fuel.f35 = VESSELS.f35.fuelKg ?? 0;
  C.aeroPending = { id, mode };
}

/** A challenge flown — the Challenges card and TARS: the F-35 at its start, its tanks full, the judge running. */
export function flyChallenge(host: ChallengeHost, d: ChallengeDef) {
  const T = host.tools;
  const C = host.camera;
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
}
