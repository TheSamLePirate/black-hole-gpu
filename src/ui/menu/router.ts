// The menus' screens (PLAN-TITRE-AAA): a stack — the title, a mode, its launch, a briefing; the pause and its
// drawers; the settings — one shown at a time in a host, each remembering the item that had the focus when it
// was left. Escape or B goes back a screen (a screen may keep it: a confirmation). The change of screen is a
// View Transition where the browser has them (a card growing into its page — CSS view-transition-name), a cut
// with reduced motion. The keys and the pad's are read once here (ui/menu/actions.ts): the arrows move the
// focus in two dimensions, the others go to the screen.

import { onEscape } from "../keys";
import { type MenuAction, menuActionOf } from "./actions";
import { type Dir, focusables, moveFocus } from "./focus";

export interface MenuScreen {
  /** its name (the focus remembered under it, the tests' data-screen) */
  id: string;
  /** its page, built each time it is shown */
  build(router: MenuRouter): HTMLElement;
  /** shown, left (its timers, its subscriptions) */
  enter?(): void;
  leave?(): void;
  /** Escape or B: false keeps the screen (it handled it), anything else goes back */
  back?(): boolean | void;
  /** an action other than a move (tabs, alt, reset): whether it was used */
  action?(a: MenuAction): boolean;
}

/** The stack itself, without the page: which screen is on top, the focus each one left with. */
export class ScreenStack<S extends { id: string }> {
  private list: S[] = [];
  private focus = new Map<string, string>();

  get top(): S | undefined {
    return this.list[this.list.length - 1];
  }
  get depth() {
    return this.list.length;
  }
  ids() {
    return this.list.map((s) => s.id);
  }
  push(s: S) {
    this.list.push(s);
  }
  pop(): S | undefined {
    return this.list.pop();
  }
  /** Down to the screen named (kept); false when it is not in the stack (nothing removed). */
  popTo(id: string): boolean {
    const i = this.list.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this.list.length = i + 1;
    return true;
  }
  clear() {
    this.list.length = 0;
  }
  /** The item focused on a screen as it was left (its data-focus-id, or its place among the items). */
  remember(id: string, key: string) {
    this.focus.set(id, key);
  }
  recall(id: string): string | undefined {
    return this.focus.get(id);
  }
}

const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type ViewTransitionDoc = Document & { startViewTransition?(cb: () => void): { finished: Promise<void> } };

export class MenuRouter {
  readonly stack = new ScreenStack<MenuScreen>();
  private page: HTMLElement | null = null;
  private unEscape: (() => void) | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(
    private host: HTMLElement,
    private o: { onEmpty?(): void; onShow?(id: string): void } = {},
  ) {}

  get isOpen() {
    return this.stack.depth > 0;
  }
  get current() {
    return this.stack.top?.id ?? null;
  }

  /** Over the screen shown (it is kept: back returns to it). */
  push(s: MenuScreen) {
    this.swap("forward", () => this.stack.push(s));
  }
  /** In place of the screen shown. */
  replace(s: MenuScreen) {
    this.swap("forward", () => {
      this.stack.pop();
      this.stack.push(s);
    });
  }
  /** Back a screen (the last one: the menus closed, onEmpty). */
  back() {
    this.swap("back", () => this.stack.pop());
  }
  /** Back to the screen named (still there: nothing done otherwise). */
  backTo(id: string) {
    if (!this.stack.ids().includes(id) || this.current === id) return;
    this.swap("back", () => this.stack.popTo(id));
  }
  /** Every screen closed at once (into the game). */
  close() {
    if (!this.isOpen) return;
    this.swap("back", () => this.stack.clear());
  }
  /** The screen shown built again (its data changed), its focus kept. */
  refresh() {
    const top = this.stack.top;
    if (!top) return;
    this.rememberFocus();
    this.page?.remove();
    this.mount(top);
  }

  /** The stack changed now (isOpen, current: at once); the page swapped in a View Transition where there is one. */
  private swap(dir: "forward" | "back", change: () => void) {
    this.rememberFocus();
    const old = this.stack.top;
    change();
    const top = this.stack.top;
    const render = () => {
      if (old !== top) old?.leave?.();
      this.page?.remove();
      this.page = null;
      this.show(old !== top);
    };
    const doc = document as ViewTransitionDoc;
    if (!this.page || !doc.startViewTransition || reducedMotion()) return render();
    document.documentElement.dataset.menuDir = dir;
    const vt = doc.startViewTransition(render);
    void vt.finished.finally(() => delete document.documentElement.dataset.menuDir);
  }

  /** The item focused on the screen shown, remembered under its name (its data-focus-id, or its place). */
  private rememberFocus() {
    const top = this.stack.top;
    const active = document.activeElement as HTMLElement | null;
    if (!top || !this.page || !active || !this.page.contains(active)) return;
    this.stack.remember(top.id, active.dataset.focusId ?? String(focusables(this.page).indexOf(active)));
  }

  private show(entered: boolean) {
    const top = this.stack.top;
    if (!top) {
      this.unEscape?.();
      this.unEscape = null;
      this.host.removeEventListener("keydown", this.onKey);
      this.o.onEmpty?.();
      return;
    }
    if (!this.unEscape) {
      this.armEscape();
      this.host.addEventListener("keydown", this.onKey);
    }
    this.mount(top);
    if (entered) top.enter?.();
    this.o.onShow?.(top.id);
  }

  private mount(top: MenuScreen) {
    this.page = top.build(this);
    this.page.dataset.screen = top.id;
    this.host.append(this.page);
    this.restoreFocus(top.id);
  }

  private restoreFocus(id: string) {
    const page = this.page!;
    const items = focusables(page);
    const key = this.stack.recall(id);
    const to =
      (key !== undefined && (page.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(key)}"]`) ?? items[Number(key)])) ||
      page.querySelector<HTMLElement>("[data-autofocus]") ||
      items[0];
    to?.focus({ preventScroll: true });
  }

  /** Escape (and B, which ui/padnav.ts sends as Escape) on the game's Escape stack while a screen is up. */
  private armEscape() {
    this.unEscape = onEscape(() => {
      this.unEscape = null;
      const keep = this.stack.top?.back?.() === false;
      if (keep) this.armEscape();
      else this.back();
    });
  }

  private key(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const a = menuActionOf(e);
    if (!a || a === "back") return;
    if (a === "confirm") {
      // (the item focused, here — not left to the browser's activation of a focused button)
      if (t?.tagName === "BUTTON" || t?.tagName === "A") {
        e.preventDefault();
        e.stopPropagation();
        t.click();
      }
      return;
    }
    if (a === "up" || a === "down" || a === "left" || a === "right") {
      // (a range or a select keeps its own arrows across: its value)
      if (t?.tagName === "SELECT" || (a !== "up" && a !== "down" && t?.getAttribute("role") === "slider")) return;
      if (this.page && moveFocus(this.page, a as Dir)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (this.stack.top?.action?.(a)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}
