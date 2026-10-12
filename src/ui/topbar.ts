// The top bar (PLAN-MODES-AAA M1): the app's one bar, on screen in every mode — the four modes (F1 ship, F2 on
// foot, F3 the free camera, F4 photo), the mode's own group (the ship's chips, clocks, craft and view; the
// walker's place; the free camera's view), the time (the transport bar), the actions, TARS's emblem (always
// there, breathing at rest, moving with what he does) and a button to hide it — a slim handle, TARS in it,
// brings it back. The actions that do not fit the window's width go, the least used first, into a ⋯ menu.

import type { GameMode } from "../game/modes";
import { GAME_MODES } from "../game/modes";
import { t } from "../i18n";
import { store } from "../util/storage";
import { el as h } from "./kit";
import { TarsEmblem } from "./tars/emblem";

/** The four modes' line icons (24 × 24). */
const MODE_ICONS: Record<GameMode, string> = {
  ship: '<path d="M12 3.5l2.2 6.5 6.3 3.2-6.3 1.6L12 20.5l-2.2-5.7-6.3-1.6 6.3-3.2z"/><circle cx="12" cy="12" r="1.3" class="f"/>',
  foot: '<circle cx="12.5" cy="4.6" r="1.9" class="f"/><path d="M9.5 21l2.2-6.2 2.8 2.4V21M11.7 14.8l.9-5.8 3.4 3 2.5.6M12.6 9L9 10.6 7.6 13.6"/>',
  free: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M6.2 6.2l1.6 1.6M16.2 16.2l1.6 1.6M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6" opacity=".6"/>',
  photo:
    '<circle cx="12" cy="12" r="8"/><path d="M12 4l3.2 6.4M20 12l-6.6 1.6M16 18.9l-4.6-5.3M6.8 18.1l2.6-6.4M4.4 9.6l6.6 0.6M13.6 4.2L10.8 10.6" opacity=".85"/>',
};
const MODE_NAMES: Record<GameMode, () => string> = {
  ship: () => t("Ship"),
  foot: () => t("On foot"),
  free: () => t("Free camera"),
  photo: () => t("Photo"),
};
const MODE_TIPS: Record<GameMode, () => string> = {
  ship: () => t("Ship: fly the craft — its HUD, its autopilots, its views (F1)"),
  foot: () => t("On foot: out of the landed craft, or set down on the world under the camera (F2)"),
  free: () => t("Free camera: anywhere in the system — the ship, if one flies, flies on (F3)"),
  photo: () => t("Photo: the view alone — the lens, the exposure, renders and videos (F4)"),
};
/** The bar's own actions' icons (24 × 24, stroked with the text's colour; `f`: filled). */
export const TB_ICONS = {
  place: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
  weather: '<path d="M7 17h10a4 4 0 0 0 .6-7.96A5.5 5.5 0 0 0 7.1 9.6 3.75 3.75 0 0 0 7 17z"/><path d="M9 20l-1 2M13 20l-1 2M17 20l-1 2"/>',
  eclipse: '<circle cx="12" cy="12" r="7.5"/><path d="M14.6 5.2a7.5 7.5 0 0 1 0 13.6A7.5 7.5 0 0 0 14.6 5.2z" class="f"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" class="f"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" class="f"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  atlas: '<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  skyEvents:
    '<path d="M4.5 19a7.5 7.5 0 0 1 15 0M7.5 19a4.5 4.5 0 0 1 9 0"/><circle cx="12" cy="19" r="1.1" class="f"/><path d="M17.5 3.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z" class="f"/>',
  capture:
    '<path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10.5H4z"/><circle cx="12" cy="13.5" r="3.6"/><circle cx="12" cy="13.5" r="1.2" class="f"/>',
  render: '<rect x="3.5" y="5" width="17" height="12" rx="1.5"/><path d="M8 21h8M12 17v4M9.5 8.5v5l4.5-2.5z"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1.1" class="f"/>',
  tools: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.6 2.6-2.8-.6-.6-2.8z"/>',
} as const;
export const MODE_KEYS: Record<GameMode, string> = { ship: "F1", foot: "F2", free: "F3", photo: "F4" };
/** A mode's name, translated (TARS, the toasts, the API). */
export const modeName = (m: GameMode) => MODE_NAMES[m]();

const HIDDEN_KEY = "kerr.topbar.hidden";

/** An action of the bar: an icon button (or a button already on the page, adopted with its id). */
export interface TopBarAction {
  id: string;
  label: string;
  /** an icon's inner SVG (24 × 24), or the button itself (the page's, its listeners kept) */
  icon?: string;
  button?: HTMLButtonElement;
  key?: string;
  run?: () => void;
  /** how readily it goes into the ⋯ menu when the bar is too wide: 0 never, 1 … 9 (9 first) */
  prio: number;
  /** the modes it shows in (all when absent) */
  modes?: GameMode[];
  testid?: string;
}

/**
 * Which items go into the ⋯ menu so that the bar fits: the highest `prio` first (0: never), among equals the
 * last one; `more` is the ⋯ button's width, counted once anything goes. Pure (tests/topbar.test.ts).
 */
export function overflowed(fixed: number, items: { w: number; prio: number }[], max: number, more: number): boolean[] {
  const out = items.map(() => false);
  let width = fixed + items.reduce((a, i) => a + i.w, 0);
  const order = items
    .map((it, i) => ({ ...it, i }))
    .filter((it) => it.prio > 0)
    .sort((a, b) => b.prio - a.prio || b.i - a.i);
  let any = false;
  for (const it of order) {
    if (width + (any ? more : 0) <= max) break;
    out[it.i] = true;
    width -= it.w;
    any = true;
  }
  return out;
}

export interface TopBarDeps {
  /** a tab clicked: the host changes the mode (or says why not) */
  setMode(m: GameMode): void;
  /** TARS's emblem clicked: his console */
  tars(): void;
}

const svg = (body: string, cls = "tb-ic") => {
  const s = h("span", cls);
  s.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  return s;
};

export class TopBar {
  readonly el = h("header", "tb");
  /** the ship's groups (the flight HUD's chips, clocks, craft and views) */
  readonly shipModes = h("div", "tb-group tb-ship tb-ship-modes");
  readonly shipClocks = h("div", "tb-group tb-ship tb-ship-clocks");
  readonly shipActs = h("div", "tb-group tb-ship tb-ship-acts");
  /** the free camera's group (the camera's button: its mode, its target) */
  readonly freeSlot = h("div", "tb-group tb-free");
  /** the time: the transport bar */
  readonly time = h("div", "tb-group tb-time");
  readonly emblem = new TarsEmblem(22, { ambient: true });
  private handleEmblem = new TarsEmblem(14, { ambient: true });
  private tabs = new Map<GameMode, HTMLButtonElement>();
  private context = h("div", "tb-group tb-context");
  private ctxTitle = h("b");
  private ctxSub = h("span");
  private acts = h("div", "tb-group tb-acts");
  private items: { a: TopBarAction; b: HTMLButtonElement }[] = [];
  private more = h("button", "tb-btn tb-more") as HTMLButtonElement;
  private menu = h("div", "tb-menu");
  private handle = h("button", "tb-handle") as HTMLButtonElement;
  private tarsBtn = h("button", "tb-tars") as HTMLButtonElement;
  private hideBtn = h("button", "tb-btn tb-hide") as HTMLButtonElement;
  private fitAt = 0;
  private lastFit = "";
  mode: GameMode = "free";
  hidden = false;

  constructor(d: TopBarDeps) {
    this.el.id = "topbar";
    this.el.setAttribute("role", "toolbar");
    this.el.setAttribute("aria-label", t("The game's bar"));
    this.el.dataset.testid = "topbar";
    // TARS: his emblem, always there
    this.tarsBtn.type = "button";
    this.tarsBtn.append(this.emblem.el, h("span", "tb-tars-name", "TARS"));
    this.tarsBtn.dataset.tip = t("TARS: ask him anything, or ask him to do it (F6: tap to write, hold to speak)");
    this.tarsBtn.dataset.testid = "topbar-tars";
    this.tarsBtn.onclick = () => d.tars();
    // the modes
    const tabs = h("div", "tb-group tb-modes");
    tabs.setAttribute("role", "tablist");
    for (const m of GAME_MODES) {
      const b = h("button", "tb-tab") as HTMLButtonElement;
      b.type = "button";
      b.setAttribute("role", "tab");
      b.dataset.mode = m;
      b.dataset.testid = `mode-${m}`;
      b.dataset.tip = MODE_TIPS[m]();
      b.dataset.key = MODE_KEYS[m];
      // (the photo tab keeps the old toolbar button's id: the links and the tests that open the photo mode)
      if (m === "photo") b.id = "btn-photo";
      b.append(svg(MODE_ICONS[m]), h("span", "tb-tab-name", MODE_NAMES[m]()));
      b.onclick = () => d.setMode(m);
      this.tabs.set(m, b);
      tabs.append(b);
    }
    this.context.append(this.ctxTitle, this.ctxSub);
    this.context.dataset.testid = "topbar-context";
    // the ⋯ menu: the actions that do not fit
    this.more.type = "button";
    this.more.append(
      svg(
        '<circle cx="5" cy="12" r="1.6" class="f"/><circle cx="12" cy="12" r="1.6" class="f"/><circle cx="19" cy="12" r="1.6" class="f"/>',
      ),
    );
    this.more.dataset.tip = t("More");
    this.more.dataset.testid = "topbar-more";
    this.more.onclick = () => this.toggleMenu();
    this.menu.hidden = true;
    this.menu.setAttribute("role", "menu");
    addEventListener("pointerdown", (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node) && !this.more.contains(e.target as Node)) this.menu.hidden = true;
    });
    // hide, and the handle that brings it back (TARS still in it)
    this.hideBtn.type = "button";
    this.hideBtn.append(svg('<path d="M7 14l5-5 5 5"/>'));
    this.hideBtn.dataset.tip = t("Hide the bar (the handle at the top brings it back)");
    this.hideBtn.dataset.testid = "topbar-hide";
    this.hideBtn.onclick = () => this.hide(true);
    this.handle.type = "button";
    this.handle.append(this.handleEmblem.el, svg('<path d="M7 10l5 5 5-5"/>'));
    this.handle.dataset.tip = t("Show the bar");
    this.handle.dataset.testid = "topbar-handle";
    this.handle.onclick = () => this.hide(false);
    this.el.append(
      this.tarsBtn,
      tabs,
      this.shipModes,
      this.freeSlot,
      this.context,
      this.time,
      this.shipClocks,
      this.shipActs,
      this.acts,
      this.more,
      this.hideBtn,
    );
    document.body.append(this.el, this.handle, this.menu);
    document.body.classList.add("has-topbar");
    this.hide(store.get(HIDDEN_KEY) === "1", false);
    this.setMode("free");
    addEventListener("resize", () => this.fit(true));
  }

  /** The emblems in TARS's state (his console mirrors his to them). */
  get emblems() {
    return [this.emblem, this.handleEmblem];
  }

  /** An action on the bar; a button of the page is moved in with its id and listeners. */
  add(a: TopBarAction) {
    let b = a.button;
    if (!b) {
      b = h("button") as HTMLButtonElement;
      b.type = "button";
      b.id = a.id;
      b.append(svg(a.icon ?? ""));
      if (a.run) b.onclick = a.run;
    }
    b.classList.add("tb-btn", "tb-act");
    b.dataset.tip ??= a.label;
    if (a.key) b.dataset.key = a.key;
    if (a.testid) b.dataset.testid = a.testid;
    b.setAttribute("aria-label", a.label);
    this.items.push({ a, b });
    this.acts.append(b);
    this.fit(true);
    return b;
  }

  /** An action's icon changed (the sound's: on, muted), and whether it is lit. */
  setIcon(id: string, icon: string, off = false) {
    const it = this.items.find(({ a }) => a.id === id);
    if (!it || it.b.dataset.icon === icon) return;
    it.b.dataset.icon = icon;
    it.b.classList.toggle("off", off);
    it.b.replaceChildren(svg(icon));
  }

  /** The mode shown: its tab lit, its groups. */
  setMode(m: GameMode) {
    this.mode = m;
    this.el.dataset.mode = m;
    document.body.dataset.mode = m;
    for (const [k, b] of this.tabs) {
      b.classList.toggle("on", k === m);
      b.setAttribute("aria-selected", String(k === m));
    }
    for (const { a, b } of this.items) b.classList.toggle("tb-off", !!a.modes && !a.modes.includes(m));
    this.fit(true);
  }

  /** The mode's line (on foot: the world and the place; the photo mode: what it does). Empty: none. */
  setContext(title: string, sub = "") {
    if (this.ctxTitle.textContent !== title) this.ctxTitle.textContent = title;
    if (this.ctxSub.textContent !== sub) this.ctxSub.textContent = sub;
    this.context.classList.toggle("empty", !title);
  }

  /** A tab's state: refused now (dimmed, the reason in its tip). */
  setAvailable(m: GameMode, why: string | null) {
    const b = this.tabs.get(m);
    if (!b) return;
    b.classList.toggle("tb-na", !!why);
    const tip = why ? `${MODE_TIPS[m]()} — ${why}` : MODE_TIPS[m]();
    if (b.dataset.tip !== tip) b.dataset.tip = tip;
  }

  /** Hidden: the handle alone (TARS in it); remembered. */
  hide(on: boolean, save = true) {
    this.hidden = on;
    this.el.hidden = on;
    this.handle.hidden = !on;
    this.menu.hidden = true;
    document.body.classList.toggle("topbar-hidden", on);
    if (save) store.set(HIDDEN_KEY, on ? "1" : "0");
    if (!on) this.fit(true);
  }

  /** The actions that fit shown, the rest in the ⋯ menu (measured at most twice a second, or now). */
  fit(now = false) {
    const at = performance.now();
    if (this.hidden || (!now && at - this.fitAt < 500)) return;
    this.fitAt = at;
    const shown = this.items.filter(({ b }) => !b.classList.contains("tb-off"));
    for (const { b } of shown) b.classList.remove("tb-over");
    this.more.hidden = false;
    // (the content's own width: the bar's box is capped at the window's)
    const W = Math.max(this.el.getBoundingClientRect().width, this.el.scrollWidth);
    const max = innerWidth - 16;
    const widths = shown.map(({ b }) => b.getBoundingClientRect().width + 2);
    const fixed = W - widths.reduce((a, w) => a + w, 0) - this.more.getBoundingClientRect().width;
    const over = overflowed(
      fixed,
      shown.map(({ a }, i) => ({ w: widths[i]!, prio: a.prio })),
      max,
      36,
    );
    shown.forEach(({ b }, i) => b.classList.toggle("tb-over", over[i]!));
    this.more.hidden = !over.some(Boolean);
    const sig = over.join();
    if (sig !== this.lastFit) {
      this.lastFit = sig;
      if (!this.menu.hidden) this.fillMenu();
    }
  }

  private toggleMenu() {
    this.menu.hidden = !this.menu.hidden;
    if (this.menu.hidden) return;
    this.fillMenu();
    const r = this.more.getBoundingClientRect();
    this.menu.style.top = `${Math.round(r.bottom + 8)}px`;
    this.menu.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - 248, r.right - 240)))}px`;
  }

  private fillMenu() {
    this.menu.replaceChildren();
    for (const { a, b } of this.items) {
      if (!b.classList.contains("tb-over") || b.classList.contains("tb-off")) continue;
      const i = h("button", "tb-mi") as HTMLButtonElement;
      i.type = "button";
      i.setAttribute("role", "menuitem");
      const ic = b.querySelector("svg")?.cloneNode(true);
      const box = h("span", "tb-ic");
      if (ic) box.append(ic);
      i.append(box, h("span", "tb-mi-name", a.label), h("kbd", "", a.key ?? ""));
      i.onclick = () => {
        this.menu.hidden = true;
        b.click();
      };
      this.menu.append(i);
    }
  }
}
