// The player's settings (PLAN-TITRE-AAA E9): a full screen in the menus' language — its tabs (Game, Graphics,
// Display & HUD, Audio, Controls, Accessibility, Interface, Network: LB / RB, Q / E), a row per setting (a bar for
// a number, ◂ value ▸ for a choice, a dot for a switch: ← → change it, Enter or a click too), beside them the one
// focused explained (what it does, its default, how it applies). A change applies at once; a risky one (the render
// scale, the HDR display, the interface's size) comes back by itself after 15 s unless kept. R (Y) resets the
// tab; ⌘K (or /) searches both screens; LAB › opens the drawer of every control. The controls' own screens (the
// keys, the pads) from its Controls tab. Which settings it shows: ui/settings/menu.ts — the schema the one source.

import { lang, onLangChange, setLang, t, type Text, tr } from "../../i18n";
import { QUALITY, type Quality, type Settings } from "../../settings";
import { button, el, h } from "../kit";
import type { MenuAction } from "../menu/actions";
import { glyph, onInputChange, watchInput } from "../menu/glyphs";
import { type MenuScreen, MenuRouter } from "../menu/router";
import type { ChoiceDef, ControlDef, NumberDef } from "../schema";
import {
  defOf,
  labelOf,
  LANGUAGES,
  languageLabel,
  PLAYER_TABS,
  type PlayerTab,
  REVERT_S,
  RISKY,
  type RowKey,
  rowsOf,
  searchSettings,
} from "./menu";
import { COSTS_MEASURED, SETTING_COSTS } from "./costs";
import { costDots, costShare, formatValue, numberAt, sameValue, sliderPercent, stepNumber } from "./values";

const T = {
  title: { fr: "Réglages", en: "Settings" },
  lab: { fr: "Labo", en: "Lab" },
  labHint: {
    fr: "Tous les contrôles : caméra, scène, matière, ciel, physique, rendu avancé",
    en: "Every control: camera, scene, matter, sky, physics, advanced rendering",
  },
  search: { fr: "Chercher un réglage (ici et au Labo)…", en: "Find a setting (here and in the Lab)…" },
  noHit: { fr: "Aucun réglage trouvé.", en: "No setting found." },
  inLab: { fr: "Au Labo", en: "In the Lab" },
  yes: { fr: "Oui", en: "Yes" },
  no: { fr: "Non", en: "No" },
  custom: { fr: "Personnalisé", en: "Custom" },
  byDefault: { fr: "Par défaut", en: "Default" },
  now: { fr: "S'applique tout de suite.", en: "Applies at once." },
  retrace: { fr: "S'applique tout de suite : l'image se recalcule.", en: "Applies at once: the picture is traced again." },
  risky: { fr: "Revient de lui-même après {0} s si vous ne le gardez pas.", en: "Comes back by itself after {0} s unless you keep it." },
  reload: {
    fr: "Les menus changent tout de suite, sans recharger la page. Le HUD et les panneaux du jeu déjà construits suivront au prochain chargement.",
    en: "The menus change at once, without reloading the page. The game's HUD and panels already built follow at the next load.",
  },
  keep: { fr: "Garder ce réglage ?", en: "Keep this setting?" },
  keepIn: { fr: "retour dans {0} s", en: "back in {0} s" },
  keepIt: { fr: "Garder", en: "Keep" },
  undoIt: { fr: "Revenir", en: "Revert" },
  reset: { fr: "Réinitialiser l'onglet", en: "Reset the tab" },
  resetDone: { fr: "Onglet remis par défaut", en: "Tab reset to its defaults" },
  tab: { fr: "Onglet", en: "Tab" },
  back: { fr: "Retour", en: "Back" },
  change: { fr: "Changer", en: "Change" },
  keys: { fr: "Clavier et souris", en: "Keyboard and mouse" },
  keysHint: { fr: "Chaque touche, remappable ; les profils", en: "Every key, remappable; the profiles" },
  pads: { fr: "Manettes et HOTAS", en: "Gamepads and HOTAS" },
  padsHint: { fr: "Les contrôleurs branchés, leurs axes, leurs boutons", en: "The controllers plugged in, their axes, their buttons" },
  usb: { fr: "Brancher une manette USB", en: "Connect a USB controller" },
  usbHint: {
    fr: "Une manette que le navigateur ne voit pas (Xbox 360 filaire)",
    en: "A controller the browser does not see (wired Xbox 360)",
  },
  cost: { fr: "Coût GPU", en: "GPU cost" },
  costLine: {
    fr: "{0} → {1} : +{2} ms par image (± {5}), +{3} %, vue « {4} »",
    en: "{0} → {1}: +{2} ms a frame (± {5}), +{3} %, view “{4}”",
  },
  costNone: { fr: "négligeable (moins de 3 % de l'image, vue « {0} »)", en: "negligible (under 3 % of the frame, view “{0}”)" },
  costLess: {
    fr: "{0} → {1} : plus léger, −{2} ms par image (−{3} %), vue « {4} »",
    en: "{0} → {1}: lighter, −{2} ms a frame (−{3} %), view “{4}”",
  },
  costWhere: {
    fr: "Mesuré sur {0}, le {1}, à l'image de référence du Kerr Bench (~1,44 Mpx, l'horloge tenue).",
    en: "Measured on {0}, {1}, at the Kerr Bench's reference frame (~1.44 Mpx, the clock held).",
  },
  quality: {
    fr: "Le préréglage d'ensemble : les rayons par image, les échantillons de l'image convergée, l'échelle de rendu. JEU vise la fluidité (≈ 60 i/s), ULTRA la précision.",
    en: "The overall preset: the rays per frame, the converged picture's samples, the render scale. GAME aims at fluidity (≈ 60 fps), ULTRA at precision.",
  },
} satisfies Record<string, Text>;

const QUALITY_LABEL: Record<Quality, Text> = {
  low: { fr: "Basse", en: "Low" },
  medium: { fr: "Moyenne", en: "Medium" },
  high: { fr: "Haute", en: "High" },
  ultra: { fr: "Ultra", en: "Ultra" },
  realtime: { fr: "Temps réel max", en: "Realtime max" },
  game: { fr: "Jeu", en: "Game" },
};

export interface PlayerDeps {
  settings: Settings;
  defaults(): Settings;
  /** a setting changed — through the Lab's panel: its history, its effects */
  set(key: keyof Settings, value: unknown): void;
  setQuality(q: Quality): void;
  /** the quality preset matched now (null: edited by hand) */
  quality(): Quality | null;
  /** the Lab (the drawer of every control), on a search when given */
  lab(query?: string): void;
  /** the keys' screen, the pads' (their back: this screen again) */
  controls(): void;
  pads(): void;
  connectController?(): void;
  /** the simulation held while the screen is up (out of a room) */
  hold(on: boolean): void;
  toast(text: string): void;
}

const fill = (s: string, ...a: string[]) => a.reduce((x, v, i) => x.replace(`{${i}}`, v), s);

export class PlayerSettings {
  private root: HTMLElement | null = null;
  private router: MenuRouter | null = null;
  private unInput: (() => void) | null = null;
  private unLang: (() => void) | null = null;
  private tab: PlayerTab = "game";
  private query = "";
  private onBack: (() => void) | null = null;
  /** a risky change waiting to be kept: its setting, its value before, its countdown */
  private risk: { key: keyof Settings; before: unknown; timer: number; left: number } | null = null;
  private keepEl: HTMLElement | null = null;

  constructor(private d: PlayerDeps) {}

  get isOpen() {
    return !!this.root;
  }
  /** the tab shown, null when closed */
  get tabNow(): PlayerTab | null {
    return this.root ? this.tab : null;
  }

  /** Opened (from the title, the pause, the top bar); `back`: where its Escape goes once closed. */
  open(back?: () => void, o: { tab?: PlayerTab; search?: string } = {}) {
    if (this.root) return;
    watchInput();
    this.onBack = back ?? null;
    if (o.tab) this.tab = o.tab;
    this.query = o.search ?? "";
    this.d.hold(true);
    this.root = h("div", { class: "pls-root", role: "dialog", "aria-modal": "true", "aria-label": tr(T.title), "data-testid": "settings" });
    document.body.append(this.root);
    this.router = new MenuRouter(this.root, { onEmpty: () => this.close(), cut: true });
    this.router.push(this.screen());
    this.unInput = onInputChange(() => {
      for (const e of this.root?.querySelectorAll<HTMLElement & { refill?: () => void }>(".m-prompts") ?? []) e.refill?.();
    });
    // (the language changed — here, by its row —: these settings drawn again in it)
    this.unLang = onLangChange(() => this.router?.refresh());
  }

  /** The search, from ⌘K: the screen opened on it. */
  openSearch() {
    if (!this.root) this.open();
    this.root?.querySelector<HTMLInputElement>(".pls-search")?.focus();
  }

  close() {
    if (!this.root) return;
    this.settleRisk(true);
    const root = this.root;
    this.root = null;
    this.unInput?.();
    this.unInput = null;
    this.unLang?.();
    this.unLang = null;
    const r = this.router;
    this.router = null;
    r?.close(true);
    root.remove();
    this.d.hold(false);
    const back = this.onBack;
    this.onBack = null;
    back?.();
  }

  /** where these settings went back to before leaving for the keys' or the pads' screen (reopen()) */
  private keptBack: (() => void) | null = null;

  /** Leaves for another surface (the Lab, the keys' screen): their back, if any, is reopen(). */
  private leaveFor(fn: () => void) {
    this.keptBack = this.onBack;
    this.onBack = null;
    this.close();
    fn();
  }

  /** Opened again on a tab, going back where they went before (the keys' screen's back). */
  reopen(tab?: PlayerTab) {
    const back = this.keptBack;
    this.keptBack = null;
    this.open(back ?? undefined, { tab });
  }

  // ------------------------------------------------------------------ the screen

  private screen(): MenuScreen {
    return {
      id: "settings",
      build: () => this.build(),
      action: (a) => {
        if (a === "tabPrev" || a === "tabNext") {
          const i = PLAYER_TABS.findIndex((x) => x.id === this.tab);
          this.tab = PLAYER_TABS[(i + (a === "tabNext" ? 1 : PLAYER_TABS.length - 1)) % PLAYER_TABS.length]!.id;
          this.query = "";
          this.router?.refresh();
          return true;
        }
        if (a === "reset") {
          this.resetTab();
          return true;
        }
        return false;
      },
      // (Escape: a risky change waiting comes back first; a search is cleared before leaving)
      back: () => {
        if (this.risk) {
          this.settleRisk(false);
          return false;
        }
        if (this.query) {
          this.query = "";
          this.router?.refresh();
          return false;
        }
        return true;
      },
    };
  }

  private build(): HTMLElement {
    const page = h("div", { class: "tt-page pls-page", "data-tab": this.tab });
    const tabs = h(
      "div",
      { class: "tt-tabs pls-tabs", role: "tablist", "data-nav-skip": "" },
      ...PLAYER_TABS.map((x) => {
        const b = button({ label: tr(x.label), on: !this.query && this.tab === x.id, testid: `settings-tab-${x.id}` });
        b.classList.add("tt-tab");
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(this.tab === x.id));
        b.addEventListener("click", () => {
          this.tab = x.id;
          this.query = "";
          this.router?.refresh();
        });
        return b;
      }),
    );
    const search = h("input", {
      class: "tt-search pls-search",
      type: "search",
      placeholder: tr(T.search),
      "aria-label": tr(T.search),
      "data-testid": "settings-search",
      spellcheck: "false",
      value: this.query,
    }) as HTMLInputElement;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.fillList(list, explain);
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        list.querySelector<HTMLElement>("button")?.focus();
      } else if (e.key === "Escape" && search.value) {
        e.stopPropagation();
        search.value = "";
        this.query = "";
        this.router?.refresh();
      }
    });
    const labBtn = h(
      "button",
      { class: "m-item tt-act pls-lab", type: "button", "data-testid": "settings-lab" },
      h("span", { class: "tt-act-row" }, el("span", "", tr(T.lab)), el("em", "pz-chev", "›")),
      el("small", "", tr(T.labHint)),
    );
    labBtn.addEventListener("click", () => this.leaveFor(() => this.d.lab()));
    const list = h("nav", { class: "pls-list", "aria-label": tr(T.title) });
    const explain = h("aside", { class: "pls-explain", "aria-live": "polite", "data-testid": "settings-explain" });
    this.keepEl = h("div", { class: "pls-keep", hidden: "", role: "alertdialog", "data-testid": "settings-keep" });
    this.fillList(list, explain);
    page.append(
      h("header", { class: "pls-head" }, h("h2", { class: "pz-title" }, tr(T.title)), search),
      tabs,
      h("div", { class: "pls-body" }, h("div", { class: "pls-side" }, list, labBtn), explain),
      this.keepEl,
      this.prompts([
        ["left", T.change],
        ["tabNext", T.tab],
        ["reset", T.reset],
        ["back", T.back],
      ]),
    );
    return page;
  }

  /** The list: the tab's groups and rows — or the search's hits, here and in the Lab. */
  private fillList(list: HTMLElement, explain: HTMLElement) {
    const rows: HTMLElement[] = [];
    let first = true;
    const add = (b: HTMLElement) => {
      if (first) b.dataset.autofocus = "";
      first = false;
      rows.push(b);
    };
    if (this.query.trim()) {
      const r = searchSettings(this.query);
      for (const x of r.player) add(this.row(x.key, explain, PLAYER_TABS.find((p) => p.id === x.tab)!.label));
      if (r.lab.length) {
        rows.push(el("h4", "tt-group", tr(T.inLab)));
        for (const k of r.lab.slice(0, 30)) {
          const d = defOf(k)!;
          const b = h(
            "button",
            { class: "m-item tt-act pls-lab-hit", type: "button", "data-testid": `settings-lab-${k}`, "data-focus-id": `lab-${k}` },
            h("span", { class: "tt-act-row" }, el("span", "", t(d.label)), el("em", "pz-chev", "›")),
            el("small", "", t(d.group)),
          );
          b.addEventListener("click", () => this.leaveFor(() => this.d.lab(t(d.label))));
          b.addEventListener("focus", () => this.explain(explain, k));
          add(b);
        }
      }
      if (!r.player.length && !r.lab.length) rows.push(el("p", "tt-empty", tr(T.noHit)));
    } else {
      if (this.tab === "controls") {
        const screen = (id: string, title: Text, hint: Text, go: () => void) => {
          const b = h(
            "button",
            { class: "m-item tt-act", type: "button", "data-testid": `settings-${id}`, "data-focus-id": id },
            h("span", { class: "tt-act-row" }, el("span", "", tr(title)), el("em", "pz-chev", "›")),
            el("small", "", tr(hint)),
          );
          b.addEventListener("click", go);
          b.addEventListener("focus", () => this.explainText(explain, tr(title), tr(hint)));
          add(b);
        };
        screen("keys", T.keys, T.keysHint, () => this.leaveFor(this.d.controls));
        screen("pads", T.pads, T.padsHint, () => this.leaveFor(this.d.pads));
        if (this.d.connectController) screen("usb", T.usb, T.usbHint, () => this.d.connectController?.());
      }
      for (const g of rowsOf(this.tab, this.d.settings)) {
        rows.push(el("h4", "tt-group", tr(g.title)));
        for (const k of g.keys) add(this.row(k, explain));
      }
    }
    list.replaceChildren(...rows);
    // (the first row explained until another is focused)
    const k = list.querySelector<HTMLElement>("[data-key]")?.dataset.key as RowKey | undefined;
    if (k) this.explain(explain, k);
  }

  // ------------------------------------------------------------------ a row

  /** A setting's row: its label, its value as its kind shows it; ← → (a click) change it. */
  private row(k: RowKey, explain: HTMLElement, chip?: Text): HTMLElement {
    const d = defOf(k);
    const val = h("span", { class: "pls-val" });
    const b = h(
      "button",
      {
        class: `m-item tt-act pls-row${d?.type === "toggle" ? " pls-toggle" : ""}`,
        type: "button",
        role: "slider",
        "aria-label": labelOf(k),
        "data-testid": `setting-${k.replace("@", "")}`,
        "data-focus-id": k,
        "data-key": k,
      },
      h("span", { class: "pls-label" }, el("span", "", labelOf(k)), chip ? el("em", "pls-chip", tr(chip)) : null),
      val,
    );
    const enabled = () => !d?.enabled || d.enabled(this.d.settings);
    const render = () => {
      val.replaceChildren(...this.valueNodes(k));
      b.setAttribute("aria-valuetext", val.textContent ?? "");
      const on = enabled();
      b.classList.toggle("off", !on);
      b.setAttribute("aria-disabled", String(!on));
    };
    const change = (dir: 1 | -1) => {
      if (!enabled()) return;
      this.step(k, dir);
      render();
      this.explain(explain, k);
    };
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      change(e.key === "ArrowRight" ? 1 : -1);
    });
    b.addEventListener("click", (e) => {
      if (!enabled()) return;
      // (a number: the bar's place clicked; a choice: its left part back)
      const r = b.getBoundingClientRect();
      const bar = b.querySelector<HTMLElement>(".pls-bar");
      if (d?.type === "number" && bar && e.clientX > 0) {
        const br = bar.getBoundingClientRect();
        if (e.clientX >= br.left - 8 && e.clientX <= br.right + 8) {
          this.setValue(k as keyof Settings, numberAt(d as NumberDef, (e.clientX - br.left) / br.width));
          render();
          this.explain(explain, k);
          return;
        }
      }
      change(e.clientX > 0 && d?.type !== "toggle" && e.clientX < r.left + r.width * 0.55 ? -1 : 1);
    });
    b.addEventListener("focus", () => this.explain(explain, k));
    b.addEventListener("pointerenter", () => this.explain(explain, k));
    render();
    return b;
  }

  /** a row's value as its kind shows it */
  private valueNodes(k: RowKey): Node[] {
    const s = this.d.settings;
    if (k === "@quality") {
      const q = this.d.quality();
      return [el("i", "", "◂"), el("b", "", q ? tr(QUALITY_LABEL[q]) : tr(T.custom)), el("i", "", "▸")];
    }
    if (k === "@language") return [el("i", "", "◂"), el("b", "", languageLabel()), el("i", "", "▸")];
    const d = defOf(k)!;
    const v = s[d.key];
    if (d.type === "toggle") return [el("span", `pls-dot${v ? " on" : ""}`, ""), el("b", "", tr(v ? T.yes : T.no))];
    if (d.type === "choice") {
      const o = (d as ChoiceDef).options.find((x) => sameValue(x.value, v));
      return [el("i", "", "◂"), el("b", "", o ? t(o.label) : String(v)), el("i", "", "▸")];
    }
    if (d.type === "number") {
      const n = d as NumberDef;
      const pct = Math.min(100, Math.max(0, sliderPercent(n, v as number)));
      const bar = h("span", { class: "pls-bar" }, h("i", { style: `width:${pct.toFixed(1)}%` }));
      const text = formatValue(n, v as number);
      return [bar, el("b", "", `${text === "off" ? tr({ fr: "coupé", en: "off" }) : text}${n.unit && text !== "off" ? ` ${n.unit}` : ""}`)];
    }
    return [el("b", "", String(v))];
  }

  /** a press of ← → on a row */
  private step(k: RowKey, dir: 1 | -1) {
    if (k === "@quality") {
      const qs = Object.keys(QUALITY) as Quality[];
      const now = this.d.quality() ?? this.d.settings.quality;
      const i = Math.max(0, qs.indexOf(now));
      this.d.setQuality(qs[(i + dir + qs.length) % qs.length]!);
      return;
    }
    if (k === "@language") {
      const i = LANGUAGES.findIndex((x) => x.id === lang);
      setLang(LANGUAGES[(i + dir + LANGUAGES.length) % LANGUAGES.length]!.id);
      return;
    }
    const d = defOf(k)!;
    const s = this.d.settings;
    const v = s[d.key];
    if (d.type === "toggle") this.setValue(d.key, !v);
    else if (d.type === "choice") {
      const os = (d as ChoiceDef).options;
      const i = Math.max(
        0,
        os.findIndex((o) => sameValue(o.value, v)),
      );
      this.setValue(d.key, os[(i + dir + os.length) % os.length]!.value);
    } else if (d.type === "number") this.setValue(d.key, stepNumber(d as NumberDef, v as number, dir));
  }

  /** A setting changed — a risky one kept waiting for its confirmation. */
  private setValue(key: keyof Settings, value: unknown) {
    const before = this.d.settings[key];
    if (sameValue(before, value)) return;
    if (RISKY.includes(key) && !this.risk) this.armRisk(key, before);
    else if (this.risk && this.risk.key !== key) this.settleRisk(true);
    this.d.set(key, value);
  }

  // ------------------------------------------------------------------ a risky change: kept, or back by itself

  private armRisk(key: keyof Settings, before: unknown) {
    const left = REVERT_S;
    const timer = window.setInterval(() => {
      if (!this.risk) return;
      this.risk.left--;
      if (this.risk.left <= 0) this.settleRisk(false);
      else this.showKeep();
    }, 1000);
    this.risk = { key, before, timer, left };
    this.showKeep();
  }

  private showKeep() {
    const r = this.risk;
    const el2 = this.keepEl;
    if (!r || !el2) return;
    const keep = button({ label: tr(T.keepIt), kind: "primary", testid: "settings-keep-yes", onClick: () => this.settleRisk(true) });
    const undo = button({ label: tr(T.undoIt), testid: "settings-keep-no", onClick: () => this.settleRisk(false) });
    el2.replaceChildren(
      el("b", "", tr(T.keep)),
      el("span", "", `${labelOf(r.key)} — ${fill(tr(T.keepIn), String(r.left))}`),
      h("div", { class: "pls-keep-acts" }, keep, undo),
    );
    el2.hidden = false;
  }

  /** the risky change kept (true) or put back (false) */
  private settleRisk(keep: boolean) {
    const r = this.risk;
    if (!r) return;
    this.risk = null;
    clearInterval(r.timer);
    if (this.keepEl) this.keepEl.hidden = true;
    if (!keep) {
      this.d.set(r.key, r.before);
      this.router?.refresh();
    }
  }

  // ------------------------------------------------------------------ the explanation, the reset

  private explainText(explain: HTMLElement, title: string, text: string, extra: Node[] = []) {
    explain.replaceChildren(el("h3", "tt-preview-title", title), el("p", "pls-help", text), ...extra);
  }

  private explain(explain: HTMLElement, k: RowKey) {
    if (k === "@quality") return this.explainText(explain, labelOf(k), tr(T.quality), [el("p", "pls-note", tr(T.retrace))]);
    if (k === "@language") return this.explainText(explain, labelOf(k), tr(T.reload));
    const d = defOf(k)!;
    const extra: Node[] = [];
    const def = this.d.defaults()[d.key];
    extra.push(h("p", { class: "pls-default" }, el("span", "pz-k", tr(T.byDefault)), this.plain(d, def)));
    extra.push(el("p", "pls-note", tr(d.effect === "none" || d.effect === "display" ? T.now : T.retrace)));
    if (RISKY.includes(k)) extra.push(el("p", "pls-note pls-risky", fill(tr(T.risky), String(REVERT_S))));
    // (its GPU cost, where it was measured: ui/settings/costs.ts, written by scripts/settings-cost.ts)
    const c = SETTING_COSTS[d.key];
    if (c) {
      const share = costShare(c);
      const n = costDots(share);
      // (a heavy value that costs less — the relief: the rays stop on the ground sooner —: said so)
      const line = n
        ? fill(
            tr(T.costLine),
            this.plain(d, c.light),
            this.plain(d, c.heavy),
            (c.heavyMs - c.lightMs).toFixed(1),
            String(Math.round(100 * share)),
            c.view,
            c.noise.toFixed(1),
          )
        : share <= -0.03
          ? fill(
              tr(T.costLess),
              this.plain(d, c.light),
              this.plain(d, c.heavy),
              (c.lightMs - c.heavyMs).toFixed(1),
              String(Math.round(-100 * share)),
              c.view,
            )
          : fill(tr(T.costNone), c.view);
      extra.push(
        h(
          "p",
          { class: "pls-cost", "data-testid": "settings-cost", "data-dots": String(n) },
          el("span", "pz-k", tr(T.cost)),
          el("b", "pls-dots", "●".repeat(n) + "○".repeat(5 - n)),
          el("span", "", line),
        ),
        el("p", "pls-note", fill(tr(T.costWhere), COSTS_MEASURED.machine, COSTS_MEASURED.date)),
      );
    }
    const opt = d.type === "choice" ? (d as ChoiceDef).options.find((o) => sameValue(o.value, this.d.settings[d.key])) : null;
    const text = [d.help ? t(d.help) : "", opt?.hint ? `${t(opt.label)} : ${t(opt.hint)}` : ""].filter(Boolean).join("\n\n");
    this.explainText(explain, t(d.label), text, extra);
  }

  /** a value in words (the explanation's default) */
  private plain(d: ControlDef, v: unknown): string {
    if (d.type === "toggle") return tr(v ? T.yes : T.no);
    if (d.type === "choice") {
      const o = (d as ChoiceDef).options.find((x) => sameValue(x.value, v));
      return o ? t(o.label) : String(v);
    }
    if (d.type === "number") {
      const n = d as NumberDef;
      return `${formatValue(n, v as number)}${n.unit ? ` ${n.unit}` : ""}`;
    }
    return String(v);
  }

  private resetTab() {
    const defs = this.d.defaults();
    for (const g of rowsOf(this.tab, this.d.settings))
      for (const k of g.keys) {
        const d = defOf(k);
        if (!d || RISKY.includes(k)) continue;
        if (!sameValue(this.d.settings[d.key], defs[d.key])) this.d.set(d.key, defs[d.key]);
      }
    this.d.toast(tr(T.resetDone));
    this.router?.refresh();
  }

  private prompts(list: [MenuAction, Text][]) {
    const ps = h("div", { class: "m-prompts" }) as HTMLElement & { refill?: () => void };
    ps.refill = () =>
      ps.replaceChildren(
        ...list.flatMap(([a, label]) => {
          const g = glyph(a);
          return g ? [h("span", { class: "m-prompt" }, el("span", "m-glyph", g), tr(label))] : [];
        }),
      );
    ps.refill();
    return h("footer", { class: "pz-foot" }, ps);
  }
}
