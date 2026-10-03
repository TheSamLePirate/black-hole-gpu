// The scene gallery: every built-in scene as a card (a picture when there is one, its glyph
// otherwise), by group, with a filter and a search — a vertical grid, so a mouse wheel scrolls it
// everywhere (a horizontal strip does not scroll with a wheel on Windows).

import { PRESET_INFO, SCENE_GROUPS, type SceneGroup } from "./schema";
import { SCENE_THUMBS } from "./scene-thumbs";
import { onEscape } from "./keys";

export interface SceneGalleryOptions {
  names: string[];
  apply: (name: string) => void;
  /** the scene applied last (null: none, or a saved flight) */
  current: () => string | null;
}

export function sceneTitle(name: string) {
  return PRESET_INFO[name]?.title ?? name;
}
export function sceneGroup(name: string): SceneGroup {
  return PRESET_INFO[name]?.group ?? "hole";
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

export class SceneGallery {
  private root: HTMLElement;
  private dialog: HTMLElement;
  private body: HTMLElement;
  private search: HTMLInputElement;
  private filters: HTMLElement;
  private group: SceneGroup | "all" = "all";
  private query = "";
  private returnFocus: HTMLElement | null = null;

  constructor(private o: SceneGalleryOptions) {
    this.search = document.createElement("input");
    this.search.type = "search";
    this.search.placeholder = "Search scenes…";
    this.search.spellcheck = false;
    this.search.setAttribute("aria-label", "Search scenes");
    this.search.oninput = () => {
      this.query = this.search.value.trim().toLowerCase();
      this.render();
    };
    const close = h("button", "sg-close", "✕");
    close.title = "Close (Esc)";
    close.setAttribute("aria-label", "Close");
    close.onclick = () => this.close();
    this.filters = h("nav", "sg-filters");
    this.filters.setAttribute("role", "tablist");
    this.body = h("div", "sg-body");
    const head = h("header", "sg-head", h("h2", "", "Scenes"), h("label", "sg-search", this.search), close);
    this.dialog = h("section", "sg glass", head, this.filters, this.body);
    this.dialog.setAttribute("role", "dialog");
    this.dialog.setAttribute("aria-modal", "true");
    this.dialog.setAttribute("aria-label", "Scenes");
    this.root = h("div", "sg-backdrop", this.dialog);
    this.root.hidden = true;
    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root) this.close();
    });
    // (the gallery is modal: its keys do not reach the flight or the panel)
    this.root.addEventListener("keydown", (e) => this.onKey(e));
    this.root.addEventListener("keyup", (e) => e.stopPropagation());
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /** Opens the gallery (a search typed in, or one group shown — the title screen's Missions). */
  open(query = "", group?: SceneGroup) {
    if (this.isOpen) return;
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.unEscape = onEscape(() => this.close());
    // (a fresh look each time)
    this.search.value = this.query = query.trim().toLowerCase();
    if (query) this.group = "all";
    if (group) this.group = group;
    this.render();
    requestAnimationFrame(() => {
      this.root.classList.add("show");
      const cur = this.body.querySelector<HTMLElement>(".sg-card.current");
      (cur ?? this.body.querySelector<HTMLElement>(".sg-card"))?.focus({ preventScroll: true });
      cur?.scrollIntoView({ block: "center" });
    });
  }

  private unEscape?: () => void;
  close() {
    if (!this.isOpen) return;
    this.unEscape?.();
    this.unEscape = undefined;
    this.root.classList.remove("show");
    setTimeout(() => (this.root.hidden = true), 180);
    this.returnFocus?.focus?.();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  private matches(name: string) {
    const i = PRESET_INFO[name];
    if (this.group !== "all" && sceneGroup(name) !== this.group) return false;
    if (!this.query) return true;
    const hay =
      `${name} ${i?.title ?? ""} ${i?.description ?? ""} ${SCENE_GROUPS.find((g) => g.id === sceneGroup(name))?.label}`.toLowerCase();
    return this.query.split(/\s+/).every((w) => hay.includes(w));
  }

  private render() {
    // filters, with their counts
    this.filters.replaceChildren();
    const count = (g: SceneGroup | "all") => this.o.names.filter((n) => g === "all" || sceneGroup(n) === g).length;
    for (const g of [{ id: "all" as const, label: "All", hint: "Every scene" }, ...SCENE_GROUPS]) {
      const b = h("button", g.id === this.group ? "on" : "", g.label, h("small", "", String(count(g.id))));
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(g.id === this.group));
      b.title = g.hint;
      b.onclick = () => {
        this.group = g.id;
        this.render();
      };
      this.filters.append(b);
    }
    this.body.replaceChildren();
    const current = this.o.current();
    let any = false;
    for (const g of SCENE_GROUPS) {
      // (in the gallery's own order)
      const order = Object.keys(PRESET_INFO);
      const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length);
      const names = this.o.names.filter((n) => sceneGroup(n) === g.id && this.matches(n)).sort((a, b) => rank(a) - rank(b));
      if (!names.length) continue;
      any = true;
      const grid = h("div", "sg-grid");
      for (const name of names) grid.append(this.card(name, name === current));
      this.body.append(h("h3", "sg-gtitle", g.label, h("small", "", g.hint)), grid);
    }
    if (!any) this.body.append(h("p", "sg-empty", `No scene matches “${this.query}”.`));
  }

  private card(name: string, current: boolean) {
    const info = PRESET_INFO[name];
    const group = sceneGroup(name);
    const thumb = h("div", "sg-thumb");
    thumb.dataset.group = group;
    const src = SCENE_THUMBS[name];
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      thumb.append(img);
    } else thumb.append(h("span", "sg-glyph", info?.icon ?? "•"));
    if (current) thumb.append(h("span", "sg-badge", "Current"));
    const card = h(
      "button",
      `sg-card${current ? " current" : ""}`,
      thumb,
      h("span", "sg-text", h("b", "", sceneTitle(name)), h("span", "", info?.description ?? "")),
    );
    card.onclick = () => {
      this.close();
      this.o.apply(name);
    };
    return card;
  }

  private onKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (this.query && document.activeElement === this.search) {
        this.search.value = "";
        this.query = "";
        this.render();
      } else this.close();
      return;
    }
    const typing = document.activeElement === this.search;
    if (e.key === "/" && !typing) {
      e.preventDefault();
      this.search.focus();
      return;
    }
    if (typing && e.key === "ArrowDown") {
      e.preventDefault();
      this.body.querySelector<HTMLElement>(".sg-card")?.focus();
      return;
    }
    // arrows move between the cards (by their positions on screen)
    const cards = [...this.body.querySelectorAll<HTMLElement>(".sg-card")];
    const at = cards.indexOf(document.activeElement as HTMLElement);
    if (at < 0 || !e.key.startsWith("Arrow")) {
      // (typing a letter jumps to the search)
      if (!typing && e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) this.search.focus();
      else if (e.key === "Tab") this.trapTab(e);
      return;
    }
    e.preventDefault();
    const r = cards[at]!.getBoundingClientRect();
    const cx = r.left + r.width / 2,
      cy = r.top + r.height / 2;
    let best: HTMLElement | null = null,
      bestD = Infinity;
    for (const c of cards) {
      if (c === cards[at]) continue;
      const q = c.getBoundingClientRect();
      const dx = q.left + q.width / 2 - cx,
        dy = q.top + q.height / 2 - cy;
      const ok =
        e.key === "ArrowRight"
          ? dx > 4 && Math.abs(dy) < r.height / 2
          : e.key === "ArrowLeft"
            ? dx < -4 && Math.abs(dy) < r.height / 2
            : e.key === "ArrowDown"
              ? dy > 4
              : dy < -4;
      if (!ok) continue;
      const d = e.key === "ArrowUp" || e.key === "ArrowDown" ? Math.abs(dy) * 4 + Math.abs(dx) : Math.abs(dx);
      if (d < bestD) (bestD = d), (best = c);
    }
    if (best) {
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") this.search.focus();
  }

  /** Tab stays in the dialog. */
  private trapTab(e: KeyboardEvent) {
    const f = [...this.dialog.querySelectorAll<HTMLElement>("button, input")].filter((x) => x.offsetParent);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      f[f.length - 1]!.focus();
    } else if (!e.shiftKey && i === f.length - 1) {
      e.preventDefault();
      f[0]!.focus();
    }
  }
}
