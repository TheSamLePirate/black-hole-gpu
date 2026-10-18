// A spacecraft's mission plan (docs/PLAN-VAISSEAUX-AAA.md, X1e; game/missiontimeline.ts) — ⇧O, as the F-35's flight
// plan: the plan's timeline — each burn (its time, its Δv, its length at full thrust, its part in the mission), the
// spheres of influence the path enters, an impact, the docking or the orbit the autopilot ends with —, the Δv it asks
// against the tanks' and the margin; executed from here (the autopilot flies its nodes), cleared, or planned again in
// the flight computer (O).

import "./missionplan.css";
import type { CameraController } from "../controls";
import { buildTimeline, type Timeline, type TimelineEvent } from "../game/missiontimeline";
import { t, tf } from "../i18n";
import { BODY_NAMES } from "../targeting";
import { C_MPS, M_SECONDS } from "../units";
import { button, el, h, modal } from "./kit";

export interface MissionPlanHost {
  camera: CameraController;
  toast(s: string): void;
  /** the flight computer's MISSION tab (O) */
  planner(): void;
}

const ROLE: Record<string, string> = {
  depart: t("Departure"),
  circ: t("Circularization"),
  mcc: t("Course correction"),
  capture: t("Capture"),
  mccReturn: t("Return correction"),
  captureHome: t("Capture home"),
  arrive: t("Arrival"),
};
const THEN: Record<string, string> = {
  dock: t("then the docking autopilot"),
  circularize: t("then a circular orbit"),
  approach: t("then the approach"),
  orbit: t("then an orbit about the target"),
};

/** A time from now in words (T−1 h 05 min, T+20 s). */
export function fmtIn(s: number): string {
  if (!Number.isFinite(s)) return "—";
  const a = Math.abs(s);
  const sign = s < 0 ? "T+" : "T−";
  if (a < 60) return `${sign}${Math.round(a)} s`;
  if (a < 3600) return `${sign}${Math.floor(a / 60)} min ${String(Math.round(a % 60)).padStart(2, "0")} s`;
  if (a < 86400 * 3) return `${sign}${Math.floor(a / 3600)} h ${String(Math.floor((a % 3600) / 60)).padStart(2, "0")} min`;
  return `${sign}${(a / 86400).toFixed(1)} d`;
}
/** A burn's length (1 min 05 s, 41 s); none for a burn of nothing. */
export function fmtLen(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s) || s < 0.5) return "—";
  return s < 60
    ? `${Math.round(s)} s`
    : s < 3600
      ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`
      : `${(s / 3600).toFixed(1)} h`;
}
const ms = (v: number) => (!Number.isFinite(v) ? "∞" : v >= 1e4 ? `${(v / 1e3).toFixed(2)} km/s` : `${v.toFixed(v < 10 ? 1 : 0)} m/s`);
const name = (b?: string) => (b ? ((BODY_NAMES as Record<string, string>)[b] ?? b) : "");

export class MissionPlanPanel {
  private close: (() => void) | null = null;
  private body: HTMLElement | null = null;
  private timer = 0;

  constructor(private host: MissionPlanHost) {}

  get isOpen() {
    return !!this.close;
  }

  /** The plan's timeline now (null: not in our universe). */
  timeline(): Timeline | null {
    const c = this.host.camera;
    const i = c.flightInfo();
    const plan = c.plan;
    const now = c.nowTime() * M_SECONDS;
    const b = c.fcBudget();
    return buildTimeline({
      now,
      burns: plan.nodes.map((n) => ({ t: n.t * M_SECONDS, dv: Math.hypot(...n.dv) * C_MPS, role: n.role, body: n.body, label: n.label })),
      path: i.ourPlan
        ? { times: i.ourPlan.times.map((x) => x * M_SECONDS), refs: i.ourPlan.refs, fate: i.ourPlan.fate, hit: i.ourPlan.hit }
        : null,
      then: plan.nodes.at(-1)?.then ?? null,
      dvLeft: b.dv,
      accel: b.accel,
    });
  }

  open() {
    if (this.close) return;
    const root = h("div", { class: "mp" });
    const m = modal({ title: t("Mission plan"), body: [root], cls: "mp-frame", testid: "mission-plan", onClose: () => this.closed() });
    this.close = m.close;
    this.body = root;
    this.refresh();
    this.timer = window.setInterval(() => this.refresh(), 700);
  }

  private closed() {
    this.close = null;
    this.body = null;
    clearInterval(this.timer);
  }

  private refresh() {
    const root = this.body;
    if (!root) return;
    const c = this.host.camera;
    const T = this.timeline();
    const kids: HTMLElement[] = [];
    if (c.plan.note) kids.push(el("div", "mp-note", c.plan.note));
    if (T) {
      const short = T.margin < 0;
      const bar = el("div", "mp-bar");
      const fill = el("i", short ? "short" : "");
      fill.style.width = `${Number.isFinite(T.dvLeft) && T.dvLeft > 0 ? Math.min(100, (100 * T.dv) / T.dvLeft) : 0}%`;
      bar.append(fill);
      const cell = (label: string, v: string, bad = false) => h("div", {}, el("span", "k-label", label), el("b", bad ? "short" : "", v));
      kids.push(
        h(
          "div",
          { class: "mp-budget" },
          cell(t("Δv planned"), ms(T.dv)),
          cell(t("Δv in the tanks"), ms(T.dvLeft)),
          cell(t("Margin"), ms(T.margin), short),
        ),
        bar,
      );
      const list = el("div", "mp-list");
      list.append(
        h(
          "div",
          { class: "mp-row mp-head" },
          el("span"),
          el("span", "", t("Timeline event")),
          el("span", "", t("When")),
          el("span", "", "Δv"),
          el("span", "", t("Burn")),
        ),
      );
      if (!T.events.length)
        list.append(
          el(
            "div",
            "mp-empty",
            t("No plan: the flight computer (O) plans a manoeuvre or a mission; B a rendezvous with the targeted station or craft."),
          ),
        );
      T.events.forEach((e, k) => list.append(this.row(e, k === T.next)));
      kids.push(list);
    } else kids.push(el("div", "mp-empty", t("The mission plan is our solar system's (near Gargantua: the flight computer's burns, O).")));
    const flying = c.pilot.auto === "node" || c.pilot.auto === "burns";
    kids.push(
      h(
        "div",
        { class: "mp-tools" },
        button({
          label: flying ? t("Executing…") : t("Execute"),
          kind: "primary",
          on: flying,
          testid: "mp-execute",
          onClick: () => {
            if (!c.plan.nodes.length) return this.host.toast(t("No plan to execute"));
            if (c.pilot.auto !== "node") c.pilot.setAuto("node");
            this.host.toast(t("Autopilot: executing the plan"));
          },
        }),
        button({
          label: t("Clear"),
          kind: "danger",
          testid: "mp-clear",
          onClick: () => {
            c.clearPlan();
            this.host.toast(t("Plan cleared"));
          },
        }),
        button({ label: t("Flight computer (O)"), testid: "mp-planner", onClick: () => (this.close?.(), this.host.planner()) }),
      ),
    );
    root.replaceChildren(...kids);
  }

  private row(e: TimelineEvent, next: boolean): HTMLElement {
    const what =
      e.kind === "burn"
        ? `${e.label ?? (e.role ? ROLE[e.role] : undefined) ?? t("Burn")}${e.body ? ` · ${name(e.body)}` : ""}`
        : e.kind === "soi"
          ? tf("Into {0}'s sphere", name(e.body))
          : e.kind === "impact"
            ? tf("Impact · {0}", name(e.body))
            : (THEN[e.label ?? ""] ?? e.label ?? "");
    const r = h(
      "div",
      { class: `mp-row ${e.kind}${next ? " next" : ""}`, "data-kind": e.kind },
      el("span", "mp-dot"),
      el("span", "", what),
      el("span", "", fmtIn(e.in)),
      el("span", e.dv === undefined ? "mp-dim" : "", e.dv === undefined ? "—" : ms(e.dv)),
      el("span", "mp-dim", e.kind === "burn" ? fmtLen(e.burnS) : ""),
    );
    return r;
  }
}
