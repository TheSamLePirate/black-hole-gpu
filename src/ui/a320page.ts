// The A320's systems on the tablet (docs/PLAN-A320.md, A11): its failures — each injected now, at V1, at the take-off or
// at a random moment of the next minutes, the ones under way and their clearing (src/a320/failures.ts) —; FlightGear's
// checklists (src/a320/checklists.json: the full procedures and the normal checklists), their items ticked one by one,
// the control each names shown on the deck (a ring over it: its marker — main.ts draws it).

import "./systemspage.css";
import checklists from "../a320/checklists.json";
import { t, tf } from "../i18n";
import { button, el, h } from "./kit";

type V3 = [number, number, number];
interface Item {
  name: string;
  value: string;
  marker?: V3;
}
const GROUPS = (checklists as { groups: { name: string; checklists: { title: string; items: Item[] }[] }[] }).groups;

/** When a failure armed strikes. */
export type FailureWhen = "now" | "v1" | "takeoff" | "random";

export interface A320PageDeps {
  /** the failures (null: not the A320) — the catalogue by category, those under way and those armed */
  failures(): {
    list: { id: string; name: string; cat: string }[];
    active: string[];
    armed: { id: string; when: FailureWhen }[];
  } | null;
  arm(id: string, when: FailureWhen): string;
  clear(id: string): string;
  clearAll(): string;
  /** the gear's gravity extension pulled (its green system lost) */
  gravity(): string;
  /** the control an item names, shown on the deck (null: none) */
  marker(p: V3 | null): void;
  toast(s: string): void;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const WHEN: [FailureWhen, string][] = [
  ["now", "At once"],
  ["v1", "At V1"],
  ["takeoff", "At the take-off"],
  ["random", "Within 10 min"],
];

export class A320Page {
  el = h("div", { class: "sy", "data-testid": "a320-page" });
  private sig = "";
  private cat = "";
  private fail = "";
  private when: FailureWhen = "now";
  private list = `${GROUPS[1]?.name ?? GROUPS[0]!.name}|0`;
  private ticked = new Map<string, Set<number>>();
  private shown = -1;

  constructor(private d: A320PageDeps) {}

  live() {
    const F = this.d.failures();
    const sig = F
      ? `${F.active.join()}|${F.armed.map((a) => a.id + a.when).join()}|${this.cat}|${this.fail}|${this.when}|${this.list}|${this.shown}|${[...this.ticked].map(([k, v]) => k + [...v].join("")).join()}`
      : "none";
    if (sig === this.sig) return;
    this.sig = sig;
    if (!F) {
      this.el.replaceChildren(el("div", "sy-none", t("The A320's systems: fly the A320.")));
      return;
    }
    const redo = () => {
      this.sig = "";
      this.live();
    };
    const name = (id: string) => F.list.find((f) => f.id === id)?.name ?? id;
    const kids: HTMLElement[] = [el("div", "sy-h", t("Failures"))];
    // (under way, armed: each cleared by its button)
    if (!F.active.length && !F.armed.length) kids.push(el("div", "sy-none", t("None — all systems nominal.")));
    for (const id of F.active) {
      const box = h("div", { class: "sy-fail", "data-failure": id }, h("h4", {}, t(name(id))));
      box.append(button({ label: t("Clear"), testid: `a320-clear-${id}`, onClick: () => (this.d.toast(this.d.clear(id)), redo()) }));
      kids.push(box);
    }
    for (const a of F.armed) {
      const box = h(
        "div",
        { class: "sy-fail fixing", "data-armed": a.id },
        h("h4", {}, `${t(name(a.id))} — ${t(WHEN.find((w) => w[0] === a.when)![1])}`),
      );
      box.append(button({ label: t("Disarm"), onClick: () => (this.d.toast(this.d.clear(a.id)), redo()) }));
      kids.push(box);
    }
    // (a new one: its category, itself, when)
    const cats = [...new Set(F.list.map((f) => f.cat))];
    if (!cats.includes(this.cat)) this.cat = cats[0] ?? "";
    const inCat = F.list.filter((f) => f.cat === this.cat);
    if (!inCat.some((f) => f.id === this.fail)) this.fail = inCat[0]?.id ?? "";
    const select = (testid: string, opts: [string, string][], value: string, set: (v: string) => void) => {
      const s = h("select", { class: "rp-in sy-sel", "data-testid": testid }) as HTMLSelectElement;
      for (const [v, l] of opts) s.append(h("option", { value: v }, l));
      s.value = value;
      s.onchange = () => {
        set(s.value);
        redo();
      };
      return s;
    };
    kids.push(
      select(
        "a320-fail-cat",
        cats.map((c) => [c, cap(t(c))]),
        this.cat,
        (v) => (this.cat = v),
      ),
      select(
        "a320-fail",
        inCat.map((f) => [f.id, t(f.name)]),
        this.fail,
        (v) => (this.fail = v),
      ),
      select(
        "a320-fail-when",
        WHEN.map(([w, l]) => [w, t(l)]),
        this.when,
        (v) => (this.when = v as FailureWhen),
      ),
      h(
        "div",
        { class: "sy-row" },
        button({
          label: this.when === "now" ? t("Fail") : t("Arm"),
          kind: "primary",
          testid: "a320-fail-arm",
          onClick: () => (this.d.toast(this.d.arm(this.fail, this.when)), redo()),
        }),
        button({ label: t("Clear all"), testid: "a320-fail-clear", onClick: () => (this.d.toast(this.d.clearAll()), redo()) }),
      ),
      button({ label: t("Gear gravity extension"), testid: "a320-gravity", onClick: () => this.d.toast(this.d.gravity()) }),
    );
    // (the checklists: one chosen, its items ticked; an item with a marker shown on the deck)
    const opts: [string, string][] = [];
    GROUPS.forEach((g) => g.checklists.forEach((c, k) => opts.push([`${g.name}|${k}`, `${t(g.name)} — ${c.title}`])));
    kids.push(
      el("div", "sy-h", t("Checklists")),
      select("a320-checklist", opts, this.list, (v) => ((this.list = v), this.show(-1))),
    );
    const [gn, ck] = this.list.split("|");
    const C = GROUPS.find((g) => g.name === gn)?.checklists[Number(ck)];
    if (C) kids.push(this.items(this.list, C.items));
    this.el.replaceChildren(...kids);
  }

  /** A checklist's items: ticked, the control shown */
  private items(key: string, items: Item[]): HTMLElement {
    const done = this.ticked.get(key) ?? new Set<number>();
    this.ticked.set(key, done);
    const box = h("div", { class: "sy-fail sy-list" });
    items.forEach((it, k) => {
      // (a heading: FlightGear's "===< … >===")
      const head = /^=+</.test(it.name);
      if (head) {
        box.append(h("h4", {}, it.name.replace(/[=<>]/g, "").trim()));
        return;
      }
      const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = done.has(k);
      const row = h(
        "label",
        { class: `sy-step${cb.checked ? " done" : ""}${this.shown === k ? " shown" : ""}` },
        cb,
        el("span", "", `${it.name}${it.value ? ` ……… ${it.value}` : ""}`),
      );
      cb.onchange = () => {
        if (cb.checked) done.add(k);
        else done.delete(k);
        // (the next item's control shown)
        const next = items.findIndex((x, j) => j > k && !done.has(j) && x.marker);
        this.show(cb.checked && next >= 0 ? next : -1, items);
        this.sig = "";
        this.live();
      };
      if (it.marker) {
        const eye = h("button", { class: "sy-eye", title: t("Show it on the deck") }, "◎");
        eye.onclick = (e) => {
          e.preventDefault();
          this.show(this.shown === k ? -1 : k, items);
          this.sig = "";
          this.live();
        };
        row.append(eye);
      }
      box.append(row);
    });
    const left = items.filter((x, k) => !done.has(k) && !/^=+</.test(x.name)).length;
    box.append(el("small", "sy-none", left ? tf("{0} to check", left) : t("Checklist complete")));
    return box;
  }

  private show(k: number, items?: Item[]) {
    this.shown = k;
    this.d.marker(k >= 0 ? (items?.[k]?.marker ?? null) : null);
  }
}
