import { isTyping } from "../controls";
import { freeCameraKeys } from "../input/bindings";
import { KEYMAP } from "../input/keymap";
import { t, tf } from "../i18n";
import { h, icon, modal } from "./kit";
import { onEscape } from "./keys";
import { QUALITY, type Quality, type Settings } from "../settings";
import { sceneGroup, sceneTitle } from "./scenes";
import {
  GROUP_SWITCH,
  PRESET_INFO,
  QUALITY_KEYS,
  SCENE_GROUPS,
  SCHEMA,
  SCHEMA_BY_KEY,
  SECTIONS,
  type ChoiceDef,
  type ControlDef,
  type NumberDef,
  type SectionId,
} from "./schema";
import { store } from "../util/storage";
import { gameLog } from "../game/log";

type Key = keyof Settings;
type Diff = { key: Key; before: unknown; after: unknown }[];

export interface PanelOptions {
  settings: Settings;
  defaults: () => Settings;
  /** Called after settings were mutated by the panel (values already written). */
  onChange: (keys: Key[]) => void;
  /** Applies a built-in scene preset to `settings` (keeping rendering choices). */
  applyPreset: (name: string) => void;
  presetNames: string[];
  /** the scene applied last (null: none, or a saved flight) */
  currentScene: () => string | null;
  /** opens the scene gallery (searching for `query`) */
  openScenes: (query?: string) => void;
  loadImage: () => void;
  /** Returns a shareable URL of the current state. */
  shareUrl: () => string;
  /** WebHID access to a USB controller the browser does not expose (Chromium + wired Xbox 360 pads). */
  connectController?: () => void;
}

const STORE_PRESETS = "kerr.userPresets.v1";
const STORE_UI = "kerr.panel.v1";

// ------------------------------------------------------------------------------------ helpers
function decimalsFor(step: number) {
  return Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
}

function formatValue(d: NumberDef, v: number): string {
  if (d.offAtZero && v === 0) return "off";
  if (d.scale === "log") {
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3))
      return v
        .toExponential(Math.max(0, (d.precision ?? 3) - 1))
        .replace(/\.?0+e/, "e")
        .replace("e+", "e");
    return String(Number(v.toPrecision(d.precision ?? 3)));
  }
  return v.toFixed(decimalsFor(d.step ?? 0.01));
}

function toSlider(d: NumberDef, v: number): number {
  if (d.scale === "log") {
    if (d.offAtZero && v <= 0) return 0;
    return (Math.log(Math.max(v, d.min) / d.min) / Math.log(d.max / d.min)) * 1000;
  }
  return v;
}

function fromSlider(d: NumberDef, x: number): number {
  if (d.scale === "log") {
    if (d.offAtZero && x <= 0) return 0;
    const v = d.min * (d.max / d.min) ** (x / 1000);
    return Number(v.toPrecision(d.precision ?? 3));
  }
  const step = d.step ?? 0.01;
  return Number((Math.round(x / step) * step).toFixed(decimalsFor(step)));
}

function sliderPercent(d: NumberDef, v: number) {
  const x = toSlider(d, v);
  return d.scale === "log" ? x / 10 : ((x - d.min) / (d.max - d.min)) * 100;
}

function sameValue(a: unknown, b: unknown) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  return a === b;
}

// ------------------------------------------------------------------------------------ panel
export class SettingsPanel {
  private s: Settings;
  private o: PanelOptions;
  private root: HTMLElement;
  private body!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private tabsEl!: HTMLElement;
  private qualityEl!: HTMLElement;
  private presetsEl!: HTMLElement;
  private sceneCard!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private tooltip: HTMLElement;
  private toastEl: HTMLElement;
  private menu: HTMLElement | null = null;

  private tab: SectionId = "scene";
  private query = "";
  private advanced = false;
  private collapsedGroups = new Set<string>();
  private updaters: (() => void)[] = [];

  private undoStack: Diff[] = [];
  private redoStack: Diff[] = [];
  private pending: Settings | null = null;

  /** keys the flight takes over while piloting (the panel then leaves them) */
  flightKeys: ((e: KeyboardEvent) => boolean) | null = null;

  constructor(root: HTMLElement, options: PanelOptions) {
    this.root = root;
    this.o = options;
    this.s = options.settings;
    this.loadUiState();
    this.tooltip = h("div", { class: "sp-tooltip", role: "tooltip" });
    this.toastEl = h("div", { class: "sp-toasts", "aria-live": "polite" });
    document.body.append(this.tooltip, this.toastEl);
    this.build();
    if (this.isOpen) this.unEscape = onEscape(() => this.toggle(false));
    addEventListener("keydown", this.onKey);
    addEventListener("pointerup", () => this.commit());
  }

  // ---------------------------------------------------------------------------------- public
  /** Re-reads every visible control from `settings` (after camera moves, shortcuts, …). */
  refresh() {
    this.updateSceneCard();
    for (const u of this.updaters) u();
    this.updateQuality();
    this.updateHistoryButtons();
  }

  private unEscape?: () => void;
  toggle(show?: boolean) {
    const open = show ?? this.root.classList.contains("collapsed");
    this.root.classList.toggle("collapsed", !open);
    this.unEscape?.();
    this.unEscape = open ? onEscape(() => this.toggle(false)) : undefined;
    this.saveUiState();
  }

  get isOpen() {
    return !this.root.classList.contains("collapsed");
  }

  /** while set, messages wait for it (the loading screen) */
  holdToasts: Promise<void> | null = null;

  toast(msg: string) {
    if (this.holdToasts) {
      this.holdToasts.then(() => this.toast(msg));
      return;
    }
    // (a stack of three at most, the newest below; each shown long enough to be read — 2.2 s, more for
    // a long one —; the same message again refreshes it; all of them in the journal)
    gameLog.add("info", msg);
    const same = [...this.toastEl.children].find((e) => e.textContent === msg) as HTMLElement | undefined;
    const el = same ?? h("div", { class: "sp-toast" }, msg);
    if (!same) {
      this.toastEl.append(el);
      while (this.toastEl.children.length > 3) this.toastEl.firstElementChild!.remove();
      requestAnimationFrame(() => el.classList.add("show"));
    }
    const ms = Math.min(8000, 2200 + Math.max(0, msg.length - 40) * 45);
    clearTimeout((el as unknown as { t: number }).t);
    (el as unknown as { t: number }).t = window.setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 250);
    }, ms);
  }

  undo() {
    this.commit();
    const d = this.undoStack.pop();
    if (!d) return;
    this.redoStack.push(d);
    this.applyValues(d.map((x) => [x.key, x.before]));
    this.toast(tf("Undo: {0}", this.describe(d)));
  }

  redo() {
    const d = this.redoStack.pop();
    if (!d) return;
    this.undoStack.push(d);
    this.applyValues(d.map((x) => [x.key, x.after]));
    this.toast(tf("Redo: {0}", this.describe(d)));
  }

  /** Applies a built-in scene (one undo step). */
  applyScene(name: string) {
    this.begin();
    this.o.applyPreset(name);
    this.commit();
    this.refresh();
    this.toast(tf("Scene: {0}", sceneTitle(name)));
  }

  // ---------------------------------------------------------------------------------- history
  private begin() {
    if (!this.pending) this.pending = structuredClone(this.s);
  }

  private commit() {
    if (!this.pending) return;
    const before = this.pending;
    this.pending = null;
    const diff: Diff = [];
    for (const key of Object.keys(this.s) as Key[]) {
      if (!sameValue(before[key], this.s[key])) diff.push({ key, before: before[key], after: this.s[key] });
    }
    if (!diff.length) return;
    this.undoStack.push(diff);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.updateHistoryButtons();
  }

  private describe(d: Diff) {
    if (d.length === 1) return t(SCHEMA_BY_KEY.get(d[0]!.key)?.label ?? String(d[0]!.key));
    return tf("{0} settings", d.length);
  }

  private applyValues(entries: [Key, unknown][]) {
    const keys: Key[] = [];
    for (const [k, v] of entries) {
      (this.s as unknown as Record<string, unknown>)[k] = v;
      keys.push(k);
    }
    this.o.onChange(keys);
    this.refresh();
  }

  /** Sets one value from a control, with history and change notification. */
  private set(key: Key, value: unknown, commit = true) {
    if (sameValue(this.s[key], value)) return;
    this.begin();
    (this.s as unknown as Record<string, unknown>)[key] = value;
    if (QUALITY_KEYS.includes(key)) this.updateQuality();
    this.o.onChange([key]);
    this.refreshDependents();
    if (commit) this.commit();
  }

  /** Visibility / enabled state and modified markers depend on other values. */
  private refreshDependents() {
    for (const u of this.updaters) u();
    this.updateHistoryButtons();
  }

  private updateHistoryButtons() {
    if (!this.undoBtn) return;
    this.undoBtn.disabled = !this.undoStack.length && !this.pending;
    this.redoBtn.disabled = !this.redoStack.length;
  }

  // ---------------------------------------------------------------------------------- build
  private build() {
    this.root.replaceChildren();
    this.root.classList.add("sp");

    this.undoBtn = h("button", { class: "sp-icon", title: "Undo (⌘Z / Ctrl+Z)", onclick: () => this.undo() }, icon("undo"));
    this.redoBtn = h("button", { class: "sp-icon", title: "Redo (⇧⌘Z / Ctrl+Y)", onclick: () => this.redo() }, icon("redo"));
    const menuBtn = h(
      "button",
      { class: "sp-icon", title: "More", onclick: (e: Event) => this.openMenu(e.currentTarget as HTMLElement) },
      icon("menu"),
    );
    const closeBtn = h("button", { class: "sp-icon", title: "Hide settings (M)", onclick: () => this.toggle(false) }, icon("close"));
    const opener = h(
      "button",
      { class: "sp-opener", title: "Settings (M)", onclick: () => this.toggle(true) },
      icon("gear"),
      h("span", {}, t("Settings")),
    );

    this.searchInput = h("input", {
      type: "search",
      placeholder: t("Search settings…  ⌘K"),
      spellcheck: "false",
      oninput: () => {
        this.query = this.searchInput.value.trim().toLowerCase();
        this.renderBody();
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          this.searchInput.value = "";
          this.query = "";
          this.renderBody();
          this.searchInput.blur();
        }
      },
    });
    const advToggle = h(
      "label",
      { class: "sp-adv", title: "Show expert integration and sampling parameters" },
      h("input", {
        type: "checkbox",
        ...(this.advanced ? { checked: true } : {}),
        onchange: (e: Event) => {
          this.advanced = (e.target as HTMLInputElement).checked;
          this.saveUiState();
          this.renderBody();
        },
      }),
      h("span", { class: "sp-switch" }),
      t("Advanced"),
    );

    this.presetsEl = h("div", { class: "sp-presets" });
    this.qualityEl = h("div", { class: "sp-quality" });
    this.tabsEl = h("nav", { class: "sp-tabs", role: "tablist" });
    this.body = h("div", { class: "sp-body" });

    const shell = h(
      "div",
      { class: "sp-shell glass" },
      h(
        "header",
        { class: "sp-head" },
        icon("gear", "ico sp-logo"),
        h("h2", {}, t("Settings")),
        h("div", { class: "sp-head-actions" }, this.undoBtn, this.redoBtn, menuBtn, closeBtn),
      ),
      h("div", { class: "sp-search" }, icon("search"), this.searchInput, advToggle),
      this.presetsEl,
      this.qualityEl,
      this.tabsEl,
      this.body,
    );
    this.root.append(opener, shell);

    this.renderPresets();
    this.renderQuality();
    this.renderTabs();
    this.renderBody();
    this.updateHistoryButtons();

    // tooltips (delegated)
    this.root.addEventListener("pointerover", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-help]");
      if (t) this.showTooltip(t);
    });
    this.root.addEventListener("pointerout", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-help]");
      if (t && !t.contains(e.relatedTarget as Node)) this.tooltip.classList.remove("show");
    });
  }

  private showTooltip(t: HTMLElement) {
    this.tooltip.innerHTML = "";
    const title = t.dataset.helpTitle;
    if (title) this.tooltip.append(h("b", {}, title));
    this.tooltip.append(h("p", {}, t.dataset.help ?? ""));
    if (t.dataset.helpFoot) this.tooltip.append(h("small", {}, t.dataset.helpFoot));
    const r = t.getBoundingClientRect();
    this.tooltip.classList.add("show");
    const tw = this.tooltip.offsetWidth;
    const th = this.tooltip.offsetHeight;
    let x = r.left - tw - 12;
    if (x < 8) x = Math.min(innerWidth - tw - 8, r.right + 12);
    let y = r.top + r.height / 2 - th / 2;
    y = Math.max(8, Math.min(innerHeight - th - 8, y));
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  // ---------------------------------------------------------------------------------- presets
  private userPresets(): Record<string, Partial<Settings>> {
    return store.getJSON<Record<string, Partial<Settings>>>(STORE_PRESETS, {});
  }

  private storeUserPresets(p: Record<string, Partial<Settings>>) {
    if (!store.setJSON(STORE_PRESETS, p)) this.toast(t("Could not save presets (storage unavailable)"));
  }

  private renderPresets() {
    const el = this.presetsEl;
    el.replaceChildren();
    // the scene: the current one, a click opens the gallery
    this.sceneCard = h("button", {
      class: "sp-scene",
      title: t("All the scenes"),
      onclick: () => this.o.openScenes(),
    });
    this.updateSceneCard();
    const user = this.userPresets();
    const userChips = h("div", { class: "sp-chips" });
    for (const name of Object.keys(user)) {
      const del = h("span", { class: "sp-chip-del", title: "Delete preset" }, "×");
      const chip = h(
        "button",
        {
          class: "sp-chip user",
          dataset: { help: t("Your saved preset. Click to apply."), helpTitle: name },
          onclick: (e: Event) => {
            if (e.target === del) {
              if (chip.classList.contains("confirm")) {
                const all = this.userPresets();
                delete all[name];
                this.storeUserPresets(all);
                this.renderPresets();
                this.toast(tf("Deleted preset “{0}”", name));
              } else {
                chip.classList.add("confirm");
                del.textContent = "delete?";
                setTimeout(() => {
                  chip.classList.remove("confirm");
                  del.textContent = "×";
                }, 2500);
              }
              return;
            }
            this.applyObject(user[name]!, true);
            this.toast(tf("Preset: {0}", name));
          },
        },
        h("span", { class: "sp-chip-ico" }, "★"),
        name,
        del,
      );
      userChips.append(chip);
    }
    const nameIn = h("input", { class: "sp-save-name", placeholder: "Preset name", maxlength: "40" });
    const saveRow = h(
      "div",
      { class: "sp-save", hidden: true },
      nameIn,
      h("button", { class: "sp-btn primary", onclick: () => save() }, "Save"),
      h("button", { class: "sp-btn", onclick: () => (saveRow.hidden = true) }, "Cancel"),
    );
    const save = () => {
      const name = nameIn.value.trim();
      if (!name) return;
      const all = this.userPresets();
      all[name] = this.diffFromDefaults();
      this.storeUserPresets(all);
      this.renderPresets();
      this.toast(tf("Saved preset “{0}”", name));
    };
    nameIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") saveRow.hidden = true;
    });
    userChips.append(
      h(
        "button",
        {
          class: "sp-chip add",
          dataset: { help: t("Save every setting that differs from the defaults as a named preset (stored in this browser).") },
          onclick: () => {
            saveRow.hidden = false;
            nameIn.focus();
          },
        },
        icon("plus"),
        t("Save current"),
      ),
    );
    el.append(h("div", { class: "sp-label" }, "Scene"), this.sceneCard, h("div", { class: "sp-label" }, "My presets"), userChips, saveRow);
  }

  private updateSceneCard() {
    const card = this.sceneCard;
    if (!card) return;
    const name = this.o.currentScene();
    const info = name ? PRESET_INFO[name] : undefined;
    const key = name ?? "";
    if (card.dataset.scene === key) return;
    card.dataset.scene = key;
    card.dataset.group = name ? sceneGroup(name) : "";
    card.replaceChildren(
      h("span", { class: "sp-scene-ico" }, info?.icon ?? "✦"),
      h(
        "span",
        { class: "sp-scene-text" },
        h("b", {}, name ? sceneTitle(name) : t("Your own view")),
        h("small", {}, name ? t(SCENE_GROUPS.find((g) => g.id === sceneGroup(name))!.label) : t("Settings edited, or a saved flight")),
      ),
      h("span", { class: "sp-scene-go" }, "Browse", icon("chevron", "ico")),
    );
  }

  private diffFromDefaults(): Partial<Settings> {
    const d = this.o.defaults();
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(this.s) as Key[]) {
      if (k === "pixelRatio") continue;
      if (!sameValue(this.s[k], d[k])) out[k] = this.s[k];
    }
    return out as Partial<Settings>;
  }

  /** Applies a (partial) settings object on top of the defaults (or of the current state). */
  private applyObject(obj: Partial<Settings>, fromDefaults: boolean) {
    const d = this.o.defaults();
    const target: Record<string, unknown> = fromDefaults ? { ...d, pixelRatio: this.s.pixelRatio } : { ...this.s };
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in d)) continue;
      const dv = (d as unknown as Record<string, unknown>)[k];
      if (k === "realtimeSubsampling" ? v === "auto" || typeof v === "number" : typeof v === typeof dv) target[k] = v;
    }
    this.begin();
    const entries: [Key, unknown][] = [];
    for (const k of Object.keys(target) as Key[]) if (!sameValue(this.s[k], target[k])) entries.push([k, target[k]]);
    this.applyValues(entries);
    this.commit();
  }

  // ---------------------------------------------------------------------------------- quality
  private matchingQuality(): Quality | null {
    const q = this.s.quality;
    const ref = QUALITY[q];
    if (!ref) return null;
    return (Object.keys(ref) as (keyof typeof ref)[]).every((k) => sameValue(ref[k], this.s[k])) ? q : null;
  }

  private renderQuality() {
    const el = this.qualityEl;
    el.replaceChildren(h("div", { class: "sp-label" }, t("Quality")));
    const seg = h("div", { class: "sp-seg wide" });
    const levels: [Quality, string, string][] = [
      ["low", t("Low"), t("Fast preview: large RK4 steps, few samples")],
      ["medium", t("Medium"), t("Balanced")],
      ["high", t("High"), t("Error-controlled RK4 (1e-5), 64 spp")],
      ["ultra", t("Ultra"), t("Error-controlled RK4 (2e-6), 256 spp, fine realtime steps")],
      [
        "realtime",
        "RT max",
        t(
          "Best interactive image: light realtime rays (small blocks, sharp while moving or animating), render scale ≤ 1.25, ultra refinement when still",
        ),
      ],
      [
        "game",
        t("Game"),
        t("Fluid first (≈ 60 fps): a 16 ms frame budget, coarser realtime rays, the render scale lowered when needed (dynamic resolution)"),
      ],
    ];
    for (const [q, label, help] of levels) {
      seg.append(
        h(
          "button",
          {
            dataset: { value: q, help, helpTitle: tf("{0} quality", label) },
            onclick: () => {
              this.begin();
              Object.assign(this.s, QUALITY[q], { quality: q });
              this.o.onChange([...new Set([...QUALITY_KEYS, ...(Object.keys(QUALITY[q]) as (keyof Settings)[]), "quality" as const])]);
              this.commit();
              this.refresh();
            },
          },
          label,
        ),
      );
    }
    seg.append(h("span", { class: "sp-custom", dataset: { help: "Integration or sampling parameters were edited by hand." } }, "Custom"));
    el.append(seg);
    this.updateQuality();
  }

  private updateQuality() {
    const m = this.matchingQuality();
    for (const b of this.qualityEl.querySelectorAll<HTMLElement>("button")) b.classList.toggle("on", b.dataset.value === m);
    this.qualityEl.querySelector(".sp-custom")?.classList.toggle("on", !m);
  }

  // ---------------------------------------------------------------------------------- tabs & body
  private renderTabs() {
    this.tabsEl.replaceChildren();
    for (const sec of SECTIONS) {
      this.tabsEl.append(
        h(
          "button",
          {
            role: "tab",
            class: sec.id === this.tab ? "on" : "",
            "aria-selected": String(sec.id === this.tab),
            onclick: () => {
              this.tab = sec.id;
              this.saveUiState();
              this.renderTabs();
              this.renderBody();
            },
          },
          icon(sec.icon),
          h("span", {}, t(sec.label)),
        ),
      );
    }
  }

  private matches(d: ControlDef, q: string) {
    // (the search finds a setting by its words in either language)
    const hay =
      `${d.label} ${d.group} ${d.section} ${d.help ?? ""} ${d.keywords ?? ""} ${String(d.key)} ${t(d.label)} ${t(d.group)} ${t(d.help ?? "")}`.toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  private renderBody() {
    this.updaters = [];
    this.body.replaceChildren();
    const searching = this.query.length > 0;
    this.tabsEl.classList.toggle("dim", searching);
    const defs = SCHEMA.filter((d) => (searching ? this.matches(d, this.query) : d.section === this.tab && (this.advanced || !d.advanced)));
    // (the scenes match a search too)
    const scenes = searching
      ? this.o.presetNames.filter((n) => {
          const i = PRESET_INFO[n];
          const hay =
            `${n} ${i?.title ?? ""} ${i?.description ?? ""} ${SCENE_GROUPS.find((g) => g.id === sceneGroup(n))?.label}`.toLowerCase();
          return this.query.split(/\s+/).every((w) => hay.includes(w));
        })
      : [];
    if (scenes.length) {
      this.body.append(
        h(
          "div",
          { class: "sp-group" },
          h("header", { class: "sp-ghead" }, h("span", { class: "sp-gtitle" }, `Scenes (${scenes.length})`)),
          h(
            "div",
            { class: "sp-rows sp-scene-hits" },
            ...scenes
              .slice(0, 6)
              .map((n) =>
                h(
                  "button",
                  { class: "sp-scene small", dataset: { group: sceneGroup(n) }, onclick: () => this.applyScene(n) },
                  h("span", { class: "sp-scene-ico" }, PRESET_INFO[n]?.icon ?? "•"),
                  h("span", { class: "sp-scene-text" }, h("b", {}, sceneTitle(n)), h("small", {}, PRESET_INFO[n]?.description ?? "")),
                ),
              ),
            ...(scenes.length > 6
              ? [
                  h(
                    "button",
                    { class: "sp-btn block", onclick: () => this.o.openScenes(this.query) },
                    `All ${scenes.length} in the gallery…`,
                  ),
                ]
              : []),
          ),
        ),
      );
    }
    if (!defs.length && scenes.length) return;
    if (!defs.length) {
      this.body.append(h("div", { class: "sp-empty" }, searching ? tf("No setting matches “{0}”", this.query) : t("Nothing here.")));
      return;
    }
    const groups = new Map<string, ControlDef[]>();
    for (const d of defs) {
      const gk = searching ? `${t(SECTIONS.find((s) => s.id === d.section)!.label)} › ${t(d.group)}` : d.group;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk)!.push(d);
    }
    for (const [title, list] of groups) this.body.append(this.renderGroup(title, list, searching));
    if (!searching && this.tab === "sky") {
      this.body.append(
        h(
          "div",
          { class: "sp-group" },
          h(
            "div",
            { class: "sp-rows" },
            h("button", { class: "sp-btn block", onclick: () => this.o.loadImage() }, t("Load equirectangular panorama…")),
            h("p", { class: "sp-note" }, t("Any 2:1 image (JPEG, PNG, AVIF…). It stays in your browser.")),
          ),
        ),
      );
    }
    this.refreshDependents();
  }

  private renderGroup(title: string, list: ControlDef[], searching: boolean) {
    const groupName = list[0]!.group;
    const switchKey = GROUP_SWITCH[groupName];
    const collapsed = !searching && this.collapsedGroups.has(groupName);
    const rows = h("div", { class: "sp-rows" });
    const head = h("header", { class: "sp-ghead" });
    const titleBtn = h(
      "button",
      {
        class: "sp-gtitle",
        onclick: () => {
          if (searching) return;
          if (this.collapsedGroups.has(groupName)) this.collapsedGroups.delete(groupName);
          else this.collapsedGroups.add(groupName);
          this.saveUiState();
          group.classList.toggle("collapsed");
        },
      },
      icon("chevron", "ico chev"),
      searching ? title : t(title),
    );
    head.append(titleBtn);
    if (switchKey) {
      const cb = h("input", {
        type: "checkbox",
        "aria-label": tf("Enable {0}", t(groupName).toLowerCase()),
        onchange: (e: Event) => this.set(switchKey, (e.target as HTMLInputElement).checked),
      });
      head.append(
        h("label", { class: "sp-toggle", title: tf("Enable {0}", t(groupName).toLowerCase()) }, cb, h("span", { class: "sp-switch" })),
      );
      this.updaters.push(() => {
        cb.checked = !!this.s[switchKey];
        group.classList.toggle("off", !this.s[switchKey]);
      });
    }
    const resetKeys = list.map((d) => d.key).concat(switchKey ? [switchKey] : []);
    const gReset = h(
      "button",
      {
        class: "sp-icon small",
        title: `Reset ${groupName.toLowerCase()} to defaults`,
        onclick: () => {
          const d = this.o.defaults();
          this.begin();
          this.applyValues(resetKeys.filter((k) => !sameValue(this.s[k], d[k])).map((k) => [k, d[k]]));
          this.commit();
          this.toast(tf("Reset {0}", t(groupName)));
        },
      },
      icon("reset"),
    );
    head.append(gReset);
    this.updaters.push(() => {
      const d = this.o.defaults();
      gReset.classList.toggle(
        "hidden",
        resetKeys.every((k) => sameValue(this.s[k], d[k])),
      );
    });

    for (const d of list) rows.append(this.renderControl(d));
    const group = h("section", { class: `sp-group${collapsed ? " collapsed" : ""}` }, head, rows);
    return group;
  }

  // ---------------------------------------------------------------------------------- controls
  private renderControl(d: ControlDef): HTMLElement {
    const row = h("div", { class: `sp-row ${d.type}` });
    const def = () => this.o.defaults()[d.key];
    const reset = h("button", {
      class: "sp-mod",
      title: t("Modified — click to reset to default"),
      onclick: () => this.set(d.key, def()),
    });
    const label = h(
      "span",
      {
        class: "sp-rlabel",
        dataset: d.help
          ? { help: t(d.help), helpTitle: t(d.label), helpFoot: this.footFor(d) }
          : { help: this.footFor(d), helpTitle: t(d.label) },
        ondblclick: () => this.set(d.key, def()),
      },
      t(d.label),
      d.help ? h("i", { class: "sp-info" }, "i") : null,
    );

    let update: () => void;
    if (d.type === "number") update = this.numberControl(d, row, reset, label);
    else if (d.type === "toggle") update = this.toggleControl(d, row, reset, label);
    else if (d.type === "color") update = this.colorControl(d, row, reset, label);
    else update = this.choiceControl(d, row, reset, label);

    this.updaters.push(() => {
      row.hidden = d.visible ? !d.visible(this.s) : false;
      const enabled = d.enabled ? d.enabled(this.s) : true;
      row.classList.toggle("disabled", !enabled);
      for (const el of row.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, .sp-seg button"))
        el.disabled = !enabled;
      reset.classList.toggle("on", !sameValue(this.s[d.key], def()));
      update();
    });
    return row;
  }

  private footFor(d: ControlDef) {
    const dv = this.o.defaults()[d.key];
    let shown = String(dv);
    if (d.type === "number") shown = `${formatValue(d, dv as number)}${d.unit ? ` ${t(d.unit)}` : ""}`;
    else if (d.type === "choice") shown = d.options.find((o) => o.value === dv)?.label ?? shown;
    else if (d.type === "color") shown = String(dv);
    else shown = dv ? "on" : "off";
    return tf("Default: {0} · double-click the label to reset", t(shown));
  }

  private numberControl(d: NumberDef, row: HTMLElement, reset: HTMLElement, label: HTMLElement) {
    const slider = h("input", {
      type: "range",
      min: d.scale === "log" ? 0 : d.min,
      max: d.scale === "log" ? 1000 : d.max,
      step: d.scale === "log" ? 1 : (d.step ?? 0.01),
      "aria-label": d.label,
    });
    const val = h("input", { class: "sp-val", type: "text", inputmode: "decimal", spellcheck: "false", "aria-label": `${d.label} value` });
    const unit = d.unit ? h("span", { class: "sp-unit" }, t(d.unit)) : null;
    const clamp = (v: number) => (d.offAtZero && v <= 0 ? 0 : Math.min(d.max, Math.max(d.min, v)));
    const cur = () => this.s[d.key] as number;

    slider.addEventListener("pointerdown", () => this.begin());
    slider.addEventListener("input", () => this.set(d.key, fromSlider(d, Number(slider.value)), false));
    slider.addEventListener("change", () => this.commit());

    // accepts "36", "1e-5", "6.5×10^9", "36 M", "0,5"; "off" where allowed
    const parse = (text: string): number | null => {
      const t = text
        .trim()
        .toLowerCase()
        .replace(",", ".")
        .replace(/\s*[×x]\s*10\^/, "e");
      if (d.offAtZero && (t === "off" || t === "0")) return 0;
      const v = parseFloat(t);
      return Number.isFinite(v) ? clamp(v) : null;
    };
    val.addEventListener("focus", () => {
      this.begin();
      val.select();
    });
    val.addEventListener("change", () => {
      const v = parse(val.value);
      if (v !== null) this.set(d.key, v);
      else val.value = formatValue(d, cur());
      this.commit();
    });
    val.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        val.blur();
      } else if (e.key === "Escape") {
        val.value = formatValue(d, cur());
        val.blur();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? 1 : -1;
        const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        let v: number;
        if (d.scale === "log") v = clamp((cur() || d.min) * 10 ** (0.02 * dir * mult));
        else v = clamp(cur() + dir * (d.step ?? 0.01) * mult);
        this.set(
          d.key,
          d.scale === "log" ? Number(v.toPrecision(d.precision ?? 3)) : Number(v.toFixed(decimalsFor(d.step ?? 0.01))),
          false,
        );
        val.value = formatValue(d, cur());
      }
    });
    val.addEventListener("blur", () => this.commit());

    row.append(h("div", { class: "sp-rhead" }, reset, label, h("div", { class: "sp-valbox" }, val, unit)), slider);
    return () => {
      const v = cur();
      if (document.activeElement !== val) val.value = formatValue(d, v);
      if (document.activeElement !== slider || !this.pending) slider.value = String(toSlider(d, v));
      slider.style.setProperty("--p", `${Math.max(0, Math.min(100, sliderPercent(d, v)))}%`);
    };
  }

  private toggleControl(d: ControlDef, row: HTMLElement, reset: HTMLElement, label: HTMLElement) {
    const cb = h("input", {
      type: "checkbox",
      "aria-label": d.label,
      onchange: (e: Event) => this.set(d.key, (e.target as HTMLInputElement).checked),
    });
    row.append(h("div", { class: "sp-rhead" }, reset, label, h("label", { class: "sp-toggle" }, cb, h("span", { class: "sp-switch" }))));
    return () => {
      cb.checked = !!this.s[d.key];
    };
  }

  private colorControl(d: ControlDef, row: HTMLElement, reset: HTMLElement, label: HTMLElement) {
    const input = h("input", { type: "color", class: "sp-color", "aria-label": d.label });
    input.addEventListener("pointerdown", () => this.begin());
    input.addEventListener("input", () => this.set(d.key, input.value, false));
    input.addEventListener("change", () => this.commit());
    row.append(h("div", { class: "sp-rhead" }, reset, label, input));
    return () => {
      if (input.value !== this.s[d.key]) input.value = String(this.s[d.key]);
    };
  }

  private choiceControl(d: ChoiceDef, row: HTMLElement, reset: HTMLElement, label: HTMLElement) {
    const head = h("div", { class: "sp-rhead" }, reset, label);
    row.append(head);
    if (d.style === "segmented") {
      const seg = h("div", { class: "sp-seg" });
      for (const o of d.options) {
        seg.append(
          h(
            "button",
            {
              dataset: { value: String(o.value), ...(o.hint ? { help: t(o.hint), helpTitle: t(o.label) } : {}) },
              onclick: () => this.set(d.key, o.value),
            },
            t(o.label),
          ),
        );
      }
      row.append(seg);
      return () => {
        for (const b of seg.querySelectorAll<HTMLElement>("button")) b.classList.toggle("on", b.dataset.value === String(this.s[d.key]));
      };
    }
    const sel = h("select", {
      "aria-label": d.label,
      onchange: (e: Event) => {
        const raw = (e.target as HTMLSelectElement).value;
        const opt = d.options.find((o) => String(o.value) === raw);
        if (opt) this.set(d.key, opt.value);
      },
    });
    for (const o of d.options) sel.append(h("option", { value: String(o.value), title: o.hint ? t(o.hint) : undefined }, t(o.label)));
    head.append(sel);
    return () => {
      sel.value = String(this.s[d.key]);
    };
  }

  // ---------------------------------------------------------------------------------- menu
  private openMenu(anchor: HTMLElement) {
    if (this.menu) {
      this.closeMenu();
      return;
    }
    const item = (label: string, hint: string, fn: () => void, danger = false) =>
      h(
        "button",
        {
          class: `sp-mitem${danger ? " danger" : ""}`,
          onclick: () => {
            this.closeMenu();
            fn();
          },
        },
        h("span", {}, label),
        h("small", {}, hint),
      );
    const menu = h(
      "div",
      { class: "sp-menu glass", role: "menu" },
      item(t("Copy share link"), t("URL with every non-default setting"), () => this.copyLink()),
      item(t("Export settings…"), t("Download as JSON"), () => this.exportJSON()),
      item(t("Import settings…"), t("Load a JSON file"), () => this.importJSON()),
      h("hr", {}),
      item(t("Keyboard shortcuts"), "", () => this.showShortcuts()),
      ...(this.o.connectController
        ? [item(t("Connect a USB controller…"), t("If the browser does not see it"), () => this.o.connectController!())]
        : []),
      h("hr", {}),
      item(
        t("Reset everything"),
        t("Restore all defaults (undoable)"),
        () => {
          this.applyObject({}, true);
          this.toast(t("All settings reset — ⌘Z to undo"));
        },
        true,
      ),
    );
    const r = anchor.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
    document.body.append(menu);
    this.menu = menu;
    setTimeout(() => addEventListener("pointerdown", this.outsideMenu), 0);
  }

  private outsideMenu = (e: PointerEvent) => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
  };

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
    removeEventListener("pointerdown", this.outsideMenu);
  }

  private async copyLink() {
    const url = this.o.shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      this.toast(t("Link copied to the clipboard"));
    } catch {
      prompt(t("Copy this link:"), url);
    }
  }

  private exportJSON() {
    const data = { format: "kerr-gr-settings", version: 1, settings: this.s };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "kerr-settings.json" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  private importJSON() {
    const input = h("input", { type: "file", accept: "application/json,.json" });
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const settings = obj?.settings ?? obj;
        if (typeof settings !== "object" || !settings) throw new Error("not an object");
        this.applyObject(settings, true);
        this.toast(tf("Imported {0}", f.name));
      } catch (e) {
        this.toast(tf("Import failed: {0}", (e as Error).message));
      }
    };
    input.click();
  }

  showShortcuts() {
    this.keysDialog?.close();
    this.keysDialog = modal({
      title: t("Keyboard & mouse"),
      cls: "sp-keys",
      testid: "help",
      onClose: () => (this.keysDialog = null),
      body: [
        // (drawn from the table the keys are dispatched through: input/keymap.ts)
        ...KEYMAP.map(({ title, rows }) =>
          h(
            "section",
            {},
            h("h4", { class: "k-label" }, t(title)),
            h("dl", {}, ...rows.flatMap((r) => [h("dt", {}, t(r.keys)), h("dd", {}, t(r.text))])),
          ),
        ),
        this.o.connectController
          ? h(
              "p",
              { class: "sp-keys-note" },
              t("Controller not detected? Press a button with the page focused. A wired Xbox 360 pad in Chrome, Edge or Arc: "),
              h("button", { class: "sp-link", onclick: () => this.o.connectController!() }, t("connect it (USB)")),
              ".",
            )
          : null,
        h(
          "footer",
          {},
          h("a", { href: "docs/", target: "_blank", rel: "noopener" }, t("Atlas de Kerr — renders & videos ↗")),
          h(
            "span",
            { class: "credit" },
            " · Ranger: ",
            h(
              "a",
              {
                href: "https://sketchfab.com/3d-models/interstellar-ranger-one-77c63df2062d4fd9863cc64711450c6f",
                target: "_blank",
                rel: "noopener",
              },
              "“Interstellar Ranger One” by Max Vizell",
            ),
            ", ",
            h("a", { href: "https://creativecommons.org/licenses/by/4.0/", target: "_blank", rel: "noopener" }, "CC BY 4.0"),
          ),
        ),
      ],
    });
  }
  private keysDialog: { close: () => void } | null = null;

  // ---------------------------------------------------------------------------------- keys & state
  private onKey = (e: KeyboardEvent) => {
    const typing = isTyping(e);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z" && !typing) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && e.key.toLowerCase() === "y" && !typing) {
      e.preventDefault();
      this.redo();
    } else if (mod && e.key.toLowerCase() === "k") {
      // (the settings' search: ⌘K / Ctrl+K — the / key is real time, in every mode)
      e.preventDefault();
      this.toggle(true);
      this.searchInput.focus();
    } else if (!mod && !typing && this.flightKeys?.(e)) {
      // (flying: M is the map — the panel keeps Shift+M)
    } else if (!mod && !typing && (e.key === "m" || e.key === "M") && !(e.code in freeCameraKeys())) {
      this.toggle();
    }
  };

  private loadUiState() {
    const st = store.getJSON<{ tab?: string; advanced?: boolean; collapsed?: string[]; closed?: boolean }>(STORE_UI, {});
    if (SECTIONS.some((s) => s.id === st.tab)) this.tab = st.tab as typeof this.tab;
    this.advanced = !!st.advanced;
    this.collapsedGroups = new Set(st.collapsed ?? []);
    // closed until the user opens it once (the view first)
    if (st.closed !== false || innerWidth < 800) this.root.classList.add("collapsed");
  }

  private saveUiState() {
    store.setJSON(STORE_UI, { tab: this.tab, advanced: this.advanced, collapsed: [...this.collapsedGroups], closed: !this.isOpen });
  }
}
