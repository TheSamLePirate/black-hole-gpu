// The tablet: the map's left panel (M, flying) holds one device of pages — the flight COMPUTER (its
// ORBIT, TARGET, LAND, MISSION), the SHIP (its state, the orbit, the target, the pilot), the TELEMETRY (the
// flight's curves, its CSV — ui/telemetry-page.ts), the CAMERA and
// the SKY (their panels, moved in from their popovers), the LOG (the journal). One place for what was
// five windows; closing the map gives the camera and the sky back to their popovers.

import { tr, type Text } from "../i18n";
import type { GameLog, LogEvent } from "../game/log";
import { button, el, h } from "./kit";
import { TelemetryPage } from "./telemetry-page";

export type TabletPage = "computer" | "ship" | "telemetry" | "camera" | "sky" | "log";

const PAGES: [TabletPage, Text][] = [
  ["computer", { fr: "Ordinateur", en: "Computer" }],
  ["ship", { fr: "Vaisseau", en: "Ship" }],
  ["telemetry", { fr: "Télémétrie", en: "Telemetry" }],
  ["camera", { fr: "Caméra", en: "Camera" }],
  ["sky", { fr: "Ciel", en: "Sky" }],
  ["log", { fr: "Journal", en: "Log" }],
];

interface Embeddable {
  embed(into: HTMLElement | null): void;
}

export interface TabletDeps {
  /** the ship's state in rows (ui/gametools.ts rangerView) */
  ship(): { el: HTMLElement; live(): void };
  camera: Embeddable;
  sky: Embeddable;
  log: GameLog;
  /** a scene's time as a date */
  dateOf(t: number): string;
}

export class Tablet {
  private strip = h("nav", { class: "tb-tabs", role: "tablist", "aria-label": tr({ fr: "Tablette", en: "Tablet" }) });
  private pageEl = h("div", { class: "tb-page", role: "tabpanel" });
  private btns = new Map<TabletPage, HTMLButtonElement>();
  private page: TabletPage = "computer";
  private visible = false;
  private shipView: { el: HTMLElement; live(): void } | null = null;
  private unLog: (() => void) | null = null;
  private liveAt = 0;
  private telemetry: TelemetryPage | null = null;

  constructor(
    private panel: HTMLElement,
    private d: TabletDeps,
  ) {
    for (const [p, label] of PAGES) {
      const b = button({ label: tr(label), testid: `tablet-${p}` });
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => this.setPage(p));
      this.btns.set(p, b);
      this.strip.append(b);
    }
    // (at the panel's top, above the computer's own head; the page under it)
    panel.prepend(this.strip);
    this.strip.after(this.pageEl);
    this.setPage("computer");
  }

  get current() {
    return this.page;
  }

  /** The map shown or not (each frame): leaving it, the camera and the sky go back to their popovers. */
  setVisible(on: boolean) {
    if (on === this.visible) return;
    this.visible = on;
    if (!on) this.leave();
    else this.enter();
  }

  setPage(p: TabletPage) {
    if (this.visible) this.leave();
    this.page = p;
    for (const [k, b] of this.btns) {
      b.classList.toggle("on", k === p);
      b.setAttribute("aria-selected", String(k === p));
    }
    // (the computer: its own children; any other page: they step aside for the page)
    this.panel.classList.toggle("tb-away", p !== "computer");
    this.pageEl.hidden = p === "computer";
    if (this.visible) this.enter();
  }

  /** A few times a second: the ship's figures. */
  tick(now: number) {
    if (this.visible && this.page === "telemetry") this.telemetry?.draw(now);
    if (!this.visible || this.page !== "ship" || !this.shipView || now - this.liveAt < 250) return;
    this.liveAt = now;
    this.shipView.live();
  }

  private enter() {
    this.pageEl.replaceChildren();
    if (this.page === "ship") {
      this.shipView ??= this.d.ship();
      this.pageEl.append(this.shipView.el);
      this.shipView.live();
    } else if (this.page === "telemetry") {
      this.telemetry ??= new TelemetryPage();
      this.pageEl.append(this.telemetry.el);
    } else if (this.page === "camera") this.d.camera.embed(this.pageEl);
    else if (this.page === "sky") this.d.sky.embed(this.pageEl);
    else if (this.page === "log") this.logPage();
  }

  private leave() {
    if (this.page === "camera") this.d.camera.embed(null);
    else if (this.page === "sky") this.d.sky.embed(null);
    this.unLog?.();
    this.unLog = null;
  }

  private logPage() {
    const list = h("ol", { class: "tb-log", reversed: true });
    const row = (e: LogEvent) => {
      const li = el("li", `tb-log-${e.kind}`);
      li.append(el("small", "", Number.isFinite(e.t) ? this.d.dateOf(e.t) : new Date(e.at).toLocaleTimeString()), el("span", "", e.text));
      return li;
    };
    for (const e of this.d.log.events.slice(-80).reverse()) list.append(row(e));
    if (!list.children.length) list.append(el("li", "tb-log-empty", tr({ fr: "Rien encore.", en: "Nothing yet." })));
    this.unLog = this.d.log.on((e) => {
      list.querySelector(".tb-log-empty")?.remove();
      list.prepend(row(e));
      while (list.children.length > 80) list.lastElementChild!.remove();
    });
    this.pageEl.append(list);
  }
}
