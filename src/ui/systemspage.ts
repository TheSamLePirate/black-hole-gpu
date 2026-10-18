// A spacecraft's systems on the tablet (docs/PLAN-VAISSEAUX-AAA.md, X3; game/systems.ts, controller/systems.ts): the
// battery and its balance, the oxygen and the hours it leaves the crew, the scrubbers' life; each failure under way
// with its checklist — its steps ticked one by one, its action given only once they are (a crew's discipline) —; and
// the normal checklists of a flight's phases.

import "./systemspage.css";
import type { SystemsInfo } from "../controller/systems";
import { CHECKLISTS, type FailureKind, NORMAL_CHECKLISTS } from "../game/systems";
import { t, tf } from "../i18n";
import { button, el, h } from "./kit";

export interface SystemsDeps {
  info(): SystemsInfo | null;
  fix(kind: FailureKind): string;
  toast(s: string): void;
}

const fmtH = (hrs: number) =>
  !Number.isFinite(hrs) ? "∞" : hrs >= 48 ? `${(hrs / 24).toFixed(0)} d` : `${hrs.toFixed(hrs < 10 ? 1 : 0)} h`;

export class SystemsPage {
  el = h("div", { class: "sy", "data-testid": "systems-page" });
  /** the steps ticked (kind or normal list → their indices) */
  private ticked = new Map<string, Set<number>>();
  private normal = NORMAL_CHECKLISTS[0]!.id;
  private sig = "";

  constructor(private d: SystemsDeps) {}

  live() {
    const I = this.d.info();
    const sig = I
      ? `${Math.round((I.battery / I.batteryKWh) * 100)}|${Math.round(I.o2Hours)}|${Math.round(I.scrubDays)}|${I.failures.map((f) => `${f.kind}${f.fixing}`).join()}|${this.normal}|${[...this.ticked].map(([k, v]) => k + [...v].join("")).join()}`
      : "none";
    if (sig === this.sig) return;
    this.sig = sig;
    if (!I) {
      this.el.replaceChildren(el("div", "sy-none", t("The systems: a spacecraft's (the Ranger, the Lander, the Endurance).")));
      return;
    }
    const bat = I.batteryKWh > 0 ? I.battery / I.batteryKWh : 1;
    const gauge = (label: string, value: string, share: number, sub: string) => {
      const bar = el("div", "sy-bar");
      const fill = el("i", share < 0.1 ? "bad" : share < 0.25 ? "warn" : "");
      fill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
      bar.append(fill);
      return h("div", { class: "sy-g" }, el("small", "", label), el("b", "", value), bar, el("small", "", sub));
    };
    const kids: HTMLElement[] = [
      h(
        "div",
        { class: "sy-gauges" },
        gauge(
          t("BATTERY"),
          `${Math.round(I.battery)} kWh · ${Math.round(bat * 100)} %`,
          bat,
          `${I.balanceKW >= 0 ? "+" : "−"}${Math.abs(I.balanceKW).toFixed(1)} kW`,
        ),
        gauge(
          t("OXYGEN"),
          `${Math.round(I.o2Kg)} kg`,
          Math.min(1, I.o2Hours / (24 * 7)),
          tf("{0} for {1}", fmtH(I.o2Hours), tf("{0} crew", I.crew)),
        ),
        gauge(
          t("CO₂ SCRUBBERS"),
          fmtH(I.scrubDays * 24),
          Math.min(1, I.scrubDays / 14),
          I.engine < 1 ? tf("engine {0} %", Math.round(I.engine * 100)) : t("engine nominal"),
        ),
      ),
      el("div", "sy-h", t("Failures")),
    ];
    if (!I.failures.length) kids.push(el("div", "sy-none", t("None — all systems nominal.")));
    for (const f of I.failures) kids.push(this.list(`f:${f.kind}`, t(CHECKLISTS[f.kind].title), CHECKLISTS[f.kind].steps, f));
    // the normal checklists: one chosen, its steps ticked
    const sel = h("select", { class: "rp-in sy-sel", "data-testid": "systems-normal" }) as HTMLSelectElement;
    for (const c of NORMAL_CHECKLISTS) sel.append(h("option", { value: c.id }, t(c.title)));
    sel.value = this.normal;
    sel.onchange = () => {
      this.normal = sel.value;
      this.sig = "";
      this.live();
    };
    const N = NORMAL_CHECKLISTS.find((c) => c.id === this.normal)!;
    kids.push(el("div", "sy-h", t("Checklists")), sel, this.list(`n:${N.id}`, t(N.title), N.steps, null));
    this.el.replaceChildren(...kids);
  }

  /** A checklist: its steps to tick; a failure's, its action once they all are. */
  private list(key: string, title: string, steps: string[], f: SystemsInfo["failures"][number] | null): HTMLElement {
    const done = this.ticked.get(key) ?? new Set<number>();
    this.ticked.set(key, done);
    const box = h("div", { class: `sy-fail${f?.fixing ? " fixing" : ""}`, ...(f ? { "data-failure": f.kind } : {}) });
    if (!f) box.style.borderColor = "rgba(95, 255, 208, 0.35)";
    box.append(h("h4", {}, title));
    steps.forEach((st, k) => {
      const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = done.has(k);
      const row = h("label", { class: `sy-step${cb.checked ? " done" : ""}` }, cb, el("span", "", t(st)));
      cb.onchange = () => {
        if (cb.checked) done.add(k);
        else done.delete(k);
        this.sig = "";
        this.live();
      };
      box.append(row);
    });
    if (f) {
      const all = steps.every((_, k) => done.has(k));
      const b = button({
        label: f.fixing ? t("Under way…") : t(CHECKLISTS[f.kind].action),
        kind: "primary",
        testid: `systems-fix-${f.kind}`,
        onClick: () => {
          if (!all) return this.d.toast(t("The checklist first: every step ticked"));
          this.d.toast(this.d.fix(f.kind));
          this.sig = "";
        },
      });
      b.disabled = f.fixing || !all;
      box.append(b);
    }
    return box;
  }
}
