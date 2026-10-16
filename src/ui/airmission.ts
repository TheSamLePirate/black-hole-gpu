// A mission flown (docs/PLAN-AVIATION-AAA.md, P1 — game/mission.ts, controller/mission.ts): begun — the F-35 and its
// variant, its stores, the weather, the hour there, the craft at its start (or on its carrier's deck) —; its briefing
// before (what to do, where, when), its objectives on screen as it is flown, its debrief after (each objective, its
// time, the score out of 20). In a room, the others fly it too, on our wing.

import "./airmission.css";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import { FORMATION_IDS, type FormationId } from "../game/formations";
import type { MissionSpec, ObjState } from "../game/mission";
import { utcHourAt } from "../game/quals";
import type { GameTools } from "../game/tools";
import { t, tf } from "../i18n";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { VESSELS } from "../vessels";
import type { WeatherPreset } from "../weather";
import { button, el as h, modal } from "./kit";

export interface MissionHost {
  tools: GameTools;
  camera: CameraController;
  toast(s: string): void;
}

const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;

/**
 * A mission begun: what flies stopped, the F-35 (its variant, its stores, full), the weather and the hour of the
 * mission, the craft at its start — `side` [m] to its right: another in a room, on our wing —, the mission run.
 * What to say.
 */
export function flyMission(host: MissionHost, spec: MissionSpec, o: { lead?: boolean; side?: number; role?: number } = {}): string {
  const T = host.tools;
  const C = host.camera;
  if (fleet.active !== "f35") T.set("vessel", "f35");
  C.nav.on = { l: false, v: false };
  C.challengeAbort();
  if (C.mission) C.missionAbort();
  if (C.combat) C.combatEnd();
  C.aeroStop();
  if (C.qual) C.qualStop();
  // (a team mission's role — S1 —: its own start over the mission's)
  const role = spec.roles?.length ? Math.min(Math.max(o.role ?? 0, 0), spec.roles.length - 1) : 0;
  const s = { ...spec.start, ...(spec.roles?.[role]?.start ?? {}) };
  if (s.variant) T.set("f35Variant", s.variant);
  // (its AI wingmen and their formation — a display's diamond)
  if (s.wingmen !== undefined) T.set("wingmen", s.wingmen);
  if (s.formation && FORMATION_IDS.includes(s.formation as FormationId)) T.set("formShape", s.formation as FormationId);
  const w = spec.weather;
  if (w?.preset) T.set("weather", w.preset as WeatherPreset);
  if (w?.wind !== undefined) T.set("wind", w.wind);
  if (w?.clouds !== undefined) T.set("earthClouds", w.clouds);
  C.seaSwell = w?.swell ?? null;
  // (its hour: a date, else a local solar hour there on today's date)
  if (spec.time?.utc) T.setDate(spec.time.utc);
  else if (spec.time?.localHour !== undefined) {
    const d = new Date(`${T.date().replace(" ", "T")}Z`);
    d.setUTCHours(0, Math.round(utcHourAt(spec.time.localHour, s.lon) * 60), 0, 0);
    T.setDate(d.toISOString());
  }
  // (a real flight to take over: the traffic heard)
  if (spec.units.some((u) => u.kind === "traffic") && !C.s.traffic) T.set("traffic", true);
  const side = o.side ?? 0;
  const hd = s.hdg * D;
  const lat = s.lat + (-side * Math.sin(hd)) / (D * R_EARTH);
  const lon = s.lon + (side * Math.cos(hd)) / (D * R_EARTH * Math.cos(s.lat * D));
  const ground = Math.max(0, groundRelief("earth", bodyFixedOf("earth", lat, lon, 0)));
  T.flyAt(lat, lon, Math.max(150, (s.alt ?? 1500) - ground), s.hdg, s.speed);
  C.airFlight.cfg.flaps = 0;
  C.pilot.throttle = C.pilot.engineNow = 0.85;
  const full = VESSELS.f35.fuelKg ?? 0;
  fleet.fuel.f35 = s.fuel !== undefined ? Math.min(full, s.fuel <= 1 ? s.fuel * full : s.fuel) : full;
  C.missionStart(spec, { lead: o.lead ?? true, role });
  const R = spec.roles?.[role];
  return R ? tf("Mission: {0} — your role: {1}", spec.title, R.name) : tf("Mission: {0}", spec.title);
}

const MARK: Record<ObjState, string> = { waiting: "◦", active: "•", done: "✓", failed: "✗" };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The briefing: what to do, where, when, with what; Start or not. */
export function briefMission(spec: MissionSpec, go: () => void) {
  const body = h("div", "msn-brief");
  const s = spec.start;
  const facts = [
    `F-35${s.variant ?? ""}`,
    s.loadout === "ag" ? t("air-to-ground") : s.loadout === "gun" ? t("gun only") : s.loadout === "as" ? t("anti-ship") : t("air-to-air"),
    s.wingmen ? tf("{0} AI wingmen", s.wingmen) : null,
    `${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°`,
    spec.time?.localHour !== undefined ? tf("{0} h local", spec.time.localHour) : null,
    spec.limit ? tf("{0} min at most", Math.round(spec.limit / 60)) : null,
  ].filter(Boolean);
  body.append(h("p", "msn-text", spec.brief), h("p", "msn-facts", facts.join(" · ")), h("h4", "msn-h", t("Objectives")));
  const ol = h("ol", "msn-objs");
  const roleName = (id?: string) => spec.roles?.find((r) => r.id === id)?.name;
  for (const ob of spec.objectives)
    ol.append(h("li", ob.optional ? "msn-opt" : "", ob.role ? `[${roleName(ob.role)}] ${ob.text}` : ob.text));
  body.append(ol);
  // (a team mission's roles — S1: in a room the first pilot flies the first, the others the next)
  if (spec.roles?.length) {
    body.append(h("h4", "msn-h", t("Roles")));
    const ul = h("ul", "msn-objs");
    for (const r of spec.roles) ul.append(h("li", "", r.brief ? `${r.name} — ${r.brief}` : r.name));
    body.append(
      ul,
      h(
        "p",
        "msn-facts",
        t("In a room: the one who starts it flies the first role, the others the next ones. Alone: everything is yours."),
      ),
    );
  }
  const m = modal({ title: spec.title, body: [body], cls: "msn-frame", testid: "mission-brief" });
  const row = h("div", "msn-row");
  body.append(row);
  row.append(
    button({ label: t("Cancel"), onClick: () => m.close() }),
    button({
      label: t("Start the mission"),
      kind: "primary",
      testid: "mission-go",
      onClick: () => {
        m.close();
        go();
      },
    }),
  );
}

/** The debrief: the result, each objective and when, the score. */
export function debriefMission(last: NonNullable<CameraController["missionLast"]>) {
  const b = last.brief;
  const body = h("div", "msn-brief");
  body.append(
    h(
      "p",
      `msn-result ${last.status === "won" ? "msn-won" : "msn-lost"}`,
      last.status === "won" ? t("Mission accomplished") : tf("Mission failed: {0}", last.why),
    ),
    h("p", "msn-score", `${b.letter} · ${b.twenty.toFixed(1)}/20 · ${b.score}/${b.of} · ${clock(last.t)}`),
  );
  const ol = h("ul", "msn-objs msn-list");
  for (const l of b.lines)
    ol.append(
      h(
        "li",
        `msn-${l.state}`,
        `${MARK[l.state]} ${l.text}${l.at !== undefined ? ` — ${clock(l.at)}` : ""}${l.points ? ` · +${l.points}` : ""}`,
      ),
    );
  body.append(ol);
  const m = modal({ title: last.spec.title, body: [body], cls: "msn-frame", testid: "mission-debrief" });
  const row = h("div", "msn-row");
  row.append(button({ label: t("Close"), kind: "primary", onClick: () => m.close() }));
  body.append(row);
}

/** The objectives on screen while a mission is flown (top left): each with its state, the clock. */
export class MissionHud {
  private el = h("div", "msn-hud");
  private key = "";

  constructor(
    private camera: CameraController,
    private onMap?: () => void,
  ) {
    this.el.dataset.testid = "mission-hud";
    this.el.hidden = true;
    document.body.append(this.el);
  }

  tick() {
    const M = this.camera.mission;
    if (!M) {
      if (!this.el.hidden) this.el.hidden = true;
      this.key = "";
      return;
    }
    const R = M.run;
    const lim = R.spec.limit;
    const key = `${R.spec.id}|${Object.values(R.state).join()}|${Math.floor(R.t)}|${M.deckStart ?? ""}`;
    if (key === this.key) return;
    this.key = key;
    this.el.hidden = false;
    const map = h("button", "msn-hud-map", t("Map"));
    map.type = "button";
    map.dataset.testid = "mission-hud-map";
    map.onclick = () => this.onMap?.();
    this.el.replaceChildren(
      ...(this.onMap ? [map] : []),
      h("b", "msn-hud-t", R.spec.title),
      " ",
      h("span", "msn-hud-c", M.deckStart ? t("on deck…") : lim ? `${clock(R.t)} / ${clock(lim)}` : clock(R.t)),
      ...R.spec.objectives
        .filter((o) => R.state[o.id] !== "waiting")
        .map((o) => {
          // (a team mission: the objectives of our role marked ours, the others' dimmed)
          const mine = !o.role || o.role === R.spec.roles?.[M.role]?.id;
          const tag = o.role ? `[${R.spec.roles?.find((r) => r.id === o.role)?.name ?? o.role}] ` : "";
          return h(
            "div",
            `msn-hud-o msn-${R.state[o.id]}${o.optional ? " msn-opt" : ""}${mine ? "" : " msn-other"}`,
            `${MARK[R.state[o.id]!]} ${tag}${o.text}`,
          );
        }),
    );
  }
}
