// The interface's kit: the few ways an element is made, so that every panel speaks the HUD's language
// (kit.css) — and is reachable by the tests (data-testid) and by a screen reader (names, dialogs).
//
//   el("div", "fc-row", "text")                      an element, a class, a text
//   h("button", { class, title, onclick }, ...kids)  an element, its attributes, its children
//   icon("close")  button({ label, icon, onClick })  kbd("⇧M")  modal({ title, body })

import { onEscape } from "../keys";

type Kid = Node | string | null | undefined | false;

/** An element with a class and a text (the most common, in one line). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/**
 * An element from its attributes and children: `class`, `dataset`, `on…` listeners, booleans as
 * presence (false, null and undefined leave the attribute out).
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v as EventListener);
    else if (k === "dataset") Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** The icons, as 24 × 24 stroked paths. */
export const ICON_PATHS = {
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  menu: "M5 12h.01M12 12h.01M19 12h.01",
  close: "M6 6l12 12M18 6L6 18",
  search: "M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M21 21l-4.3-4.3",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  plus: "M12 5v14M5 12h14",
  chevron: "M6 9l6 6 6-6",
} as const;
export type IconName = keyof typeof ICON_PATHS;

/** An icon (a name of ICON_PATHS, or a path of its own), decorative unless labelled by its button. */
export function icon(name: IconName | string, cls = "ico"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", name in ICON_PATHS ? ICON_PATHS[name as IconName] : name);
  svg.append(p);
  return svg;
}

export interface ButtonOptions {
  /** the visible text (an icon alone: give `title`, it names the button) */
  label?: string;
  icon?: IconName | string;
  title?: string;
  kind?: "plain" | "primary" | "danger";
  on?: boolean;
  testid?: string;
  onClick?: (e: MouseEvent) => void;
}

/** A button in the HUD's language (kit.css .k-btn); an icon-only one is named by its title. */
export function button(o: ButtonOptions): HTMLButtonElement {
  const b = h(
    "button",
    {
      type: "button",
      class: `k-btn${o.kind && o.kind !== "plain" ? ` ${o.kind}` : ""}${o.on ? " on" : ""}`,
      title: o.title,
      "aria-label": !o.label ? o.title : undefined,
      "data-testid": o.testid,
    },
    o.icon ? icon(o.icon) : null,
    o.label ? el("span", "", o.label) : null,
  );
  if (o.onClick) b.addEventListener("click", o.onClick);
  return b;
}

/** A key to press, drawn as a key ("⇧M", "Esc"). */
export const kbd = (keys: string) => el("kbd", "k-kbd", keys);

export interface ModalOptions {
  title: string;
  /** the dialog's content */
  body: Kid[];
  /** extra class on the frame */
  cls?: string;
  /** after it closed (Escape, the close button, a click on the scrim) */
  onClose?: () => void;
  testid?: string;
}

/**
 * A dialog over everything: a scrim, the frame with its title and close button, closed by Escape (the
 * one Escape stack, ui/keys.ts), the close button or a click outside; announced as a modal dialog, the
 * focus inside while it is open and given back after. Returns its close.
 */
export function modal(o: ModalOptions): { root: HTMLElement; close: () => void } {
  const before = document.activeElement as HTMLElement | null;
  const id = `k-modal-${Math.random().toString(36).slice(2, 8)}`;
  let unEscape = () => {};
  const close = () => {
    root.remove();
    unEscape();
    before?.focus?.();
    o.onClose?.();
  };
  const closeBtn = button({ icon: "close", title: "Close (Esc)", onClick: close });
  const frame = h(
    "div",
    { class: `k-frame${o.cls ? ` ${o.cls}` : ""}`, role: "dialog", "aria-modal": "true", "aria-labelledby": id },
    h("header", { class: "k-modal-head" }, h("h3", { class: "k-title", id }, o.title), closeBtn),
    ...o.body,
  );
  const root = h("div", { class: "k-modal", "data-testid": o.testid }, frame);
  root.addEventListener("click", (e) => e.target === root && close());
  document.body.append(root);
  unEscape = onEscape(close);
  closeBtn.focus();
  return { root, close };
}
