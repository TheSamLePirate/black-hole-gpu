import { FLIGHT_KEYS } from "../controls";
import { QUALITY, type Quality, type Settings } from "../settings";
import {
  GROUP_SWITCH,
  PRESET_INFO,
  QUALITY_KEYS,
  SCHEMA,
  SCHEMA_BY_KEY,
  SECTIONS,
  type ChoiceDef,
  type ControlDef,
  type NumberDef,
  type SectionId,
} from "./schema";

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
  loadImage: () => void;
  /** Returns a shareable URL of the current state. */
  shareUrl: () => string;
}

const STORE_PRESETS = "kerr.userPresets.v1";
const STORE_UI = "kerr.panel.v1";

// ------------------------------------------------------------------------------------ helpers
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

function svgIcon(path: string, cls = "ico") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", cls);
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

const ICONS = {
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  menu: "M5 12h.01M12 12h.01M19 12h.01",
  close: "M6 6l12 12M18 6L6 18",
  search: "M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-4.3-4.3",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  plus: "M12 5v14M5 12h14",
  chevron: "M6 9l6 6 6-6",
};

function decimalsFor(step: number) {
  return Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
}

function formatValue(d: NumberDef, v: number): string {
  if (d.offAtZero && v === 0) return "off";
  if (d.scale === "log") {
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(Math.max(0, (d.precision ?? 3) - 1)).replace(/\.?0+e/, "e").replace("e+", "e");
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
    const v = d.min * Math.pow(d.max / d.min, x / 1000);
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

  constructor(root: HTMLElement, options: PanelOptions) {
    this.root = root;
    this.o = options;
    this.s = options.settings;
    this.loadUiState();
    this.tooltip = h("div", { class: "sp-tooltip", role: "tooltip" });
    this.toastEl = h("div", { class: "sp-toast", "aria-live": "polite" });
    document.body.append(this.tooltip, this.toastEl);
    this.build();
    addEventListener("keydown", this.onKey);
    addEventListener("pointerup", () => this.commit());
  }

  // ---------------------------------------------------------------------------------- public
  /** Re-reads every visible control from `settings` (after camera moves, shortcuts, …). */
  refresh() {
    for (const u of this.updaters) u();
    this.updateQuality();
    this.updateHistoryButtons();
  }

  toggle(show?: boolean) {
    const open = show ?? this.root.classList.contains("collapsed");
    this.root.classList.toggle("collapsed", !open);
    this.saveUiState();
  }

  get isOpen() {
    return !this.root.classList.contains("collapsed");
  }

  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    clearTimeout((this.toastEl as unknown as { t: number }).t);
    (this.toastEl as unknown as { t: number }).t = window.setTimeout(() => this.toastEl.classList.remove("show"), 2200);
  }

  undo() {
    this.commit();
    const d = this.undoStack.pop();
    if (!d) return;
    this.redoStack.push(d);
    this.applyValues(d.map((x) => [x.key, x.before]));
    this.toast(`Undo: ${this.describe(d)}`);
  }

  redo() {
    const d = this.redoStack.pop();
    if (!d) return;
    this.undoStack.push(d);
    this.applyValues(d.map((x) => [x.key, x.after]));
    this.toast(`Redo: ${this.describe(d)}`);
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
    if (d.length === 1) return SCHEMA_BY_KEY.get(d[0]!.key)?.label ?? String(d[0]!.key);
    return `${d.length} settings`;
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

    this.undoBtn = h("button", { class: "sp-icon", title: "Undo (⌘Z / Ctrl+Z)", onclick: () => this.undo() }, svgIcon(ICONS.undo));
    this.redoBtn = h("button", { class: "sp-icon", title: "Redo (⇧⌘Z / Ctrl+Y)", onclick: () => this.redo() }, svgIcon(ICONS.redo));
    const menuBtn = h("button", { class: "sp-icon", title: "More", onclick: (e: Event) => this.openMenu(e.currentTarget as HTMLElement) }, svgIcon(ICONS.menu));
    const closeBtn = h("button", { class: "sp-icon", title: "Hide settings (M)", onclick: () => this.toggle(false) }, svgIcon(ICONS.close));
    const opener = h("button", { class: "sp-opener", title: "Settings (M)", onclick: () => this.toggle(true) }, svgIcon(ICONS.gear), h("span", {}, "Settings"));

    this.searchInput = h("input", {
      type: "search",
      placeholder: "Search settings…  /",
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
    const advToggle = h("label", { class: "sp-adv", title: "Show expert integration and sampling parameters" },
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
      "Advanced",
    );

    this.presetsEl = h("div", { class: "sp-presets" });
    this.qualityEl = h("div", { class: "sp-quality" });
    this.tabsEl = h("nav", { class: "sp-tabs", role: "tablist" });
    this.body = h("div", { class: "sp-body" });

    const shell = h("div", { class: "sp-shell glass" },
      h("header", { class: "sp-head" },
        svgIcon(ICONS.gear, "ico sp-logo"),
        h("h2", {}, "Settings"),
        h("div", { class: "sp-head-actions" }, this.undoBtn, this.redoBtn, menuBtn, closeBtn),
      ),
      h("div", { class: "sp-search" }, svgIcon(ICONS.search), this.searchInput, advToggle),
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
    try {
      return JSON.parse(localStorage.getItem(STORE_PRESETS) ?? "{}");
    } catch {
      return {};
    }
  }

  private storeUserPresets(p: Record<string, Partial<Settings>>) {
    try {
      localStorage.setItem(STORE_PRESETS, JSON.stringify(p));
    } catch {
      this.toast("Could not save presets (storage unavailable)");
    }
  }

  private renderPresets() {
    const el = this.presetsEl;
    el.replaceChildren();
    const chips = h("div", { class: "sp-chips" });
    for (const name of this.o.presetNames) {
      const info = PRESET_INFO[name];
      chips.append(
        h("button", {
          class: "sp-chip",
          dataset: { help: info?.description ?? name, helpTitle: name },
          onclick: () => {
            this.begin();
            this.o.applyPreset(name);
            this.commit();
            this.refresh();
            this.toast(`Scene: ${name}`);
          },
        }, h("span", { class: "sp-chip-ico" }, info?.icon ?? "•"), name.replace(/\s*\(.*\)$/, "")),
      );
    }
    const user = this.userPresets();
    const userChips = h("div", { class: "sp-chips" });
    for (const name of Object.keys(user)) {
      const del = h("span", { class: "sp-chip-del", title: "Delete preset" }, "×");
      const chip = h("button", {
        class: "sp-chip user",
        dataset: { help: "Your saved preset. Click to apply.", helpTitle: name },
        onclick: (e: Event) => {
          if (e.target === del) {
            if (chip.classList.contains("confirm")) {
              const all = this.userPresets();
              delete all[name];
              this.storeUserPresets(all);
              this.renderPresets();
              this.toast(`Deleted preset “${name}”`);
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
          this.toast(`Preset: ${name}`);
        },
      }, h("span", { class: "sp-chip-ico" }, "★"), name, del);
      userChips.append(chip);
    }
    const nameIn = h("input", { class: "sp-save-name", placeholder: "Preset name", maxlength: "40" });
    const saveRow = h("div", { class: "sp-save", hidden: true }, nameIn,
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
      this.toast(`Saved preset “${name}”`);
    };
    nameIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") saveRow.hidden = true;
    });
    userChips.append(
      h("button", {
        class: "sp-chip add",
        dataset: { help: "Save every setting that differs from the defaults as a named preset (stored in this browser)." },
        onclick: () => {
          saveRow.hidden = false;
          nameIn.focus();
        },
      }, svgIcon(ICONS.plus), "Save current"),
    );
    el.append(
      h("div", { class: "sp-label" }, "Scenes"),
      chips,
      h("div", { class: "sp-label" }, "My presets"),
      userChips,
      saveRow,
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
    el.replaceChildren(h("div", { class: "sp-label" }, "Quality"));
    const seg = h("div", { class: "sp-seg wide" });
    const levels: [Quality, string, string][] = [
      ["low", "Low", "Fast preview: large RK4 steps, few samples"],
      ["medium", "Medium", "Balanced"],
      ["high", "High", "Error-controlled RK4 (1e-5), 64 spp"],
      ["ultra", "Ultra", "Error-controlled RK4 (2e-6), 256 spp, fine realtime steps"],
      ["realtime", "RT max", "Best interactive image: light realtime rays (small blocks, sharp while moving or animating), render scale ≤ 1.25, ultra refinement when still"],
    ];
    for (const [q, label, help] of levels) {
      seg.append(
        h("button", {
          dataset: { value: q, help, helpTitle: `${label} quality` },
          onclick: () => {
            this.begin();
            Object.assign(this.s, QUALITY[q], { quality: q });
            this.o.onChange([...new Set([...QUALITY_KEYS, ...(Object.keys(QUALITY[q]) as (keyof Settings)[]), "quality" as const])]);
            this.commit();
            this.refresh();
          },
        }, label),
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
        h("button", {
          role: "tab",
          class: sec.id === this.tab ? "on" : "",
          "aria-selected": String(sec.id === this.tab),
          onclick: () => {
            this.tab = sec.id;
            this.saveUiState();
            this.renderTabs();
            this.renderBody();
          },
        }, svgIcon(sec.icon), h("span", {}, sec.label)),
      );
    }
  }

  private matches(d: ControlDef, q: string) {
    const hay = `${d.label} ${d.group} ${d.section} ${d.help ?? ""} ${d.keywords ?? ""} ${String(d.key)}`.toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  private renderBody() {
    this.updaters = [];
    this.body.replaceChildren();
    const searching = this.query.length > 0;
    this.tabsEl.classList.toggle("dim", searching);
    const defs = SCHEMA.filter((d) =>
      searching ? this.matches(d, this.query) : d.section === this.tab && (this.advanced || !d.advanced),
    );
    if (!defs.length) {
      this.body.append(h("div", { class: "sp-empty" }, searching ? `No setting matches “${this.query}”` : "Nothing here."));
      return;
    }
    const groups = new Map<string, ControlDef[]>();
    for (const d of defs) {
      const gk = searching ? `${SECTIONS.find((s) => s.id === d.section)!.label} › ${d.group}` : d.group;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk)!.push(d);
    }
    for (const [title, list] of groups) this.body.append(this.renderGroup(title, list, searching));
    if (!searching && this.tab === "sky") {
      this.body.append(
        h("div", { class: "sp-group" },
          h("div", { class: "sp-rows" },
            h("button", { class: "sp-btn block", onclick: () => this.o.loadImage() }, "Load equirectangular panorama…"),
            h("p", { class: "sp-note" }, "Any 2:1 image (JPEG, PNG, AVIF…). It stays in your browser."),
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
    const titleBtn = h("button", {
      class: "sp-gtitle",
      onclick: () => {
        if (searching) return;
        if (this.collapsedGroups.has(groupName)) this.collapsedGroups.delete(groupName);
        else this.collapsedGroups.add(groupName);
        this.saveUiState();
        group.classList.toggle("collapsed");
      },
    }, svgIcon(ICONS.chevron, "ico chev"), title);
    head.append(titleBtn);
    if (switchKey) {
      const cb = h("input", { type: "checkbox", onchange: (e: Event) => this.set(switchKey, (e.target as HTMLInputElement).checked) });
      head.append(h("label", { class: "sp-toggle", title: `Enable ${groupName.toLowerCase()}` }, cb, h("span", { class: "sp-switch" })));
      this.updaters.push(() => {
        cb.checked = !!this.s[switchKey];
        group.classList.toggle("off", !this.s[switchKey]);
      });
    }
    const resetKeys = list.map((d) => d.key).concat(switchKey ? [switchKey] : []);
    const gReset = h("button", {
      class: "sp-icon small",
      title: `Reset ${groupName.toLowerCase()} to defaults`,
      onclick: () => {
        const d = this.o.defaults();
        this.begin();
        this.applyValues(resetKeys.filter((k) => !sameValue(this.s[k], d[k])).map((k) => [k, d[k]]));
        this.commit();
        this.toast(`Reset ${groupName}`);
      },
    }, svgIcon(ICONS.reset));
    head.append(gReset);
    this.updaters.push(() => {
      const d = this.o.defaults();
      gReset.classList.toggle("hidden", resetKeys.every((k) => sameValue(this.s[k], d[k])));
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
      title: "Modified — click to reset to default",
      onclick: () => this.set(d.key, def()),
    });
    const label = h("span", {
      class: "sp-rlabel",
      dataset: d.help ? { help: d.help, helpTitle: d.label, helpFoot: this.footFor(d) } : { help: this.footFor(d), helpTitle: d.label },
      ondblclick: () => this.set(d.key, def()),
    }, d.label, d.help ? h("i", { class: "sp-info" }, "i") : null);

    let update: () => void;
    if (d.type === "number") update = this.numberControl(d, row, reset, label);
    else if (d.type === "toggle") update = this.toggleControl(d, row, reset, label);
    else update = this.choiceControl(d, row, reset, label);

    this.updaters.push(() => {
      row.hidden = d.visible ? !d.visible(this.s) : false;
      const enabled = d.enabled ? d.enabled(this.s) : true;
      row.classList.toggle("disabled", !enabled);
      for (const el of row.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, .sp-seg button")) el.disabled = !enabled;
      reset.classList.toggle("on", !sameValue(this.s[d.key], def()));
      update();
    });
    return row;
  }

  private footFor(d: ControlDef) {
    const dv = this.o.defaults()[d.key];
    let shown = String(dv);
    if (d.type === "number") shown = `${formatValue(d, dv as number)}${d.unit ? ` ${d.unit}` : ""}`;
    else if (d.type === "choice") shown = d.options.find((o) => o.value === dv)?.label ?? shown;
    else shown = dv ? "on" : "off";
    return `Default: ${shown} · double-click the label to reset`;
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
    const unit = d.unit ? h("span", { class: "sp-unit" }, d.unit) : null;
    const clamp = (v: number) => (d.offAtZero && v <= 0 ? 0 : Math.min(d.max, Math.max(d.min, v)));
    const cur = () => this.s[d.key] as number;

    slider.addEventListener("pointerdown", () => this.begin());
    slider.addEventListener("input", () => this.set(d.key, fromSlider(d, Number(slider.value)), false));
    slider.addEventListener("change", () => this.commit());

    // accepts "36", "1e-5", "6.5×10^9", "36 M", "0,5"; "off" where allowed
    const parse = (text: string): number | null => {
      const t = text.trim().toLowerCase().replace(",", ".").replace(/\s*[×x]\s*10\^/, "e");
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
        if (d.scale === "log") v = clamp((cur() || d.min) * Math.pow(10, 0.02 * dir * mult));
        else v = clamp(cur() + dir * (d.step ?? 0.01) * mult);
        this.set(d.key, d.scale === "log" ? Number(v.toPrecision(d.precision ?? 3)) : Number(v.toFixed(decimalsFor(d.step ?? 0.01))), false);
        val.value = formatValue(d, cur());
      }
    });
    val.addEventListener("blur", () => this.commit());

    row.append(
      h("div", { class: "sp-rhead" }, reset, label, h("div", { class: "sp-valbox" }, val, unit)),
      slider,
    );
    return () => {
      const v = cur();
      if (document.activeElement !== val) val.value = formatValue(d, v);
      if (document.activeElement !== slider || !this.pending) slider.value = String(toSlider(d, v));
      slider.style.setProperty("--p", `${Math.max(0, Math.min(100, sliderPercent(d, v)))}%`);
    };
  }

  private toggleControl(d: ControlDef, row: HTMLElement, reset: HTMLElement, label: HTMLElement) {
    const cb = h("input", { type: "checkbox", "aria-label": d.label, onchange: (e: Event) => this.set(d.key, (e.target as HTMLInputElement).checked) });
    row.append(h("div", { class: "sp-rhead" }, reset, label, h("label", { class: "sp-toggle" }, cb, h("span", { class: "sp-switch" }))));
    return () => {
      cb.checked = !!this.s[d.key];
    };
  }

  private choiceControl(d: ChoiceDef, row: HTMLElement, reset: HTMLElement, label: HTMLElement) {
    const head = h("div", { class: "sp-rhead" }, reset, label);
    row.append(head);
    if (d.style === "segmented") {
      const seg = h("div", { class: "sp-seg" });
      for (const o of d.options) {
        seg.append(
          h("button", {
            dataset: { value: String(o.value), ...(o.hint ? { help: o.hint, helpTitle: o.label } : {}) },
            onclick: () => this.set(d.key, o.value),
          }, o.label),
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
    for (const o of d.options) sel.append(h("option", { value: String(o.value), title: o.hint }, o.label));
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
      h("button", {
        class: `sp-mitem${danger ? " danger" : ""}`,
        onclick: () => {
          this.closeMenu();
          fn();
        },
      }, h("span", {}, label), h("small", {}, hint));
    const menu = h("div", { class: "sp-menu glass", role: "menu" },
      item("Copy share link", "URL with every non-default setting", () => this.copyLink()),
      item("Export settings…", "Download as JSON", () => this.exportJSON()),
      item("Import settings…", "Load a JSON file", () => this.importJSON()),
      h("hr", {}),
      item("Keyboard shortcuts", "", () => this.showShortcuts()),
      h("hr", {}),
      item("Reset everything", "Restore all defaults (undoable)", () => {
        this.applyObject({}, true);
        this.toast("All settings reset — ⌘Z to undo");
      }, true),
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
      this.toast("Link copied to the clipboard");
    } catch {
      prompt("Copy this link:", url);
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
        this.toast(`Imported ${f.name}`);
      } catch (e) {
        this.toast(`Import failed: ${(e as Error).message}`);
      }
    };
    input.click();
  }

  private showShortcuts() {
    const rows: [string, string][] = [
      ["R", "Rotation: around the target ⟷ free"],
      ["Click a body · Tab", "Select the target (its lensed image, even a secondary one) · next target"],
      ["Double-click", "On a body: orbit it and fly the view to it · on the sky: recentre (free: level)"],
      ["Drag", "Around: orbit the target (with momentum) · Free: look around"],
      ["Right / Shift drag", "Around: offset the view from the target · Free: roll"],
      ["Wheel · pinch", "Around: distance to the target · Free: move forward / back"],
      ["Alt + wheel", "Field of view"],
      ["⇧R", "Recentre on the target / level the horizon"],
      ["← → ↑ ↓ · + −", "Orbit (free: turn) / zoom"],
      ["Space", "Animate time"],
      ["O · C · T", "Auto-orbit around the target · free-fall dive (chute) · wormhole journey"],
      ["V", "Game-style flight: the mouse turns, wheel = speed, Esc leaves"],
      ["B", "Gravity: free fall along the camera's Kerr geodesic (keys thrust)"],
      ["Z Q S D (WASD)", "Fly forward · left · back · right (⇧ faster) · with gravity: thrust"],
      ["A · E (Q · E)", "Fly down · up"],
      ["W · X (Z · X)", "Roll left · right"],
      ["J · G", "Jet · shadow guide"],
      ["1 – 5", "Quality level (5: realtime max)"],
      ["M", "Show / hide settings (menu)"],
      ["/", "Search settings"],
      ["⌘Z · ⇧⌘Z", "Undo · redo"],
      ["I · H · F · P", "Readouts · hide UI · fullscreen · PNG"],
    ];
    const dlg = h("div", { class: "sp-modal", onclick: (e: Event) => e.target === dlg && dlg.remove() },
      h("div", { class: "sp-modal-card glass" },
        h("header", {}, h("h3", {}, "Keyboard & mouse"), h("button", { class: "sp-icon", onclick: () => dlg.remove() }, svgIcon(ICONS.close))),
        h("dl", {}, ...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
      ),
    );
    document.body.append(dlg);
  }

  // ---------------------------------------------------------------------------------- keys & state
  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA");
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z" && !typing) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && e.key.toLowerCase() === "y" && !typing) {
      e.preventDefault();
      this.redo();
    } else if (!mod && !typing && e.key === "/") {
      e.preventDefault();
      this.toggle(true);
      this.searchInput.focus();
    } else if (!mod && !typing && (e.key === "m" || e.key === "M") && !(e.code in FLIGHT_KEYS)) {
      this.toggle();
    }
  };

  private loadUiState() {
    try {
      const st = JSON.parse(localStorage.getItem(STORE_UI) ?? "{}");
      if (SECTIONS.some((s) => s.id === st.tab)) this.tab = st.tab;
      this.advanced = !!st.advanced;
      this.collapsedGroups = new Set(st.collapsed ?? []);
      if (st.closed || innerWidth < 800) this.root.classList.add("collapsed");
    } catch {
      /* private mode */
    }
  }

  private saveUiState() {
    try {
      localStorage.setItem(
        STORE_UI,
        JSON.stringify({ tab: this.tab, advanced: this.advanced, collapsed: [...this.collapsedGroups], closed: !this.isOpen }),
      );
    } catch {
      /* private mode */
    }
  }
}
