// The radial wheel: Tab held (a tap stays "next target") opens it at the centre of the view; the
// pointer's direction picks a sector, releasing Tab (or a click) does it; a sector with a sub-wheel opens
// it in place (the centre goes back); Escape closes. What it offers is the caller's: the flight's
// holds and autopilots, or the camera's views on foot.

import { tr, type Text } from "../i18n";
import { onEscape } from "./keys";
import { el, h } from "./kit";

export interface WheelItem {
  label: Text;
  /** the key that does it too (shown under the label) */
  key?: string;
  /** engaged now (lit) */
  on?: boolean;
  run?: () => void;
  /** a wheel of its own (the autopilots) */
  sub?: WheelItem[];
}

const R_OUT = 168;
const R_IN = 62;
const NS = "http://www.w3.org/2000/svg";

export class RadialWheel {
  private root: HTMLElement | null = null;
  private items: WheelItem[] = [];
  private stack: { items: WheelItem[]; title: Text }[] = [];
  private title: Text = { fr: "", en: "" };
  private sel = -1;
  private sectors: SVGPathElement[] = [];
  private center!: HTMLElement;
  private unEscape: (() => void) | null = null;

  get isOpen() {
    return !!this.root;
  }

  open(items: WheelItem[], title: Text) {
    this.close();
    this.root = h("div", { class: "rw-root", role: "menu", "aria-label": tr(title), "data-testid": "wheel" });
    document.body.append(this.root);
    this.unEscape = onEscape(() => this.close());
    addEventListener("pointermove", this.onMove);
    this.root.addEventListener("click", this.onClick);
    this.show(items, title);
  }

  private show(items: WheelItem[], title: Text) {
    this.items = items;
    this.title = title;
    this.sel = -1;
    const n = items.length;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `${-R_OUT - 4} ${-R_OUT - 4} ${2 * R_OUT + 8} ${2 * R_OUT + 8}`);
    svg.setAttribute("class", "rw-svg");
    this.sectors = items.map((it, i) => {
      // (sector i centred on the angle i · 360/n, the first at the top, clockwise)
      const a0 = ((i - 0.5) / n) * 2 * Math.PI - Math.PI / 2 + 0.012;
      const a1 = ((i + 0.5) / n) * 2 * Math.PI - Math.PI / 2 - 0.012;
      const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
      const d = `M${p(R_IN, a0)} L${p(R_OUT, a0)} A${R_OUT} ${R_OUT} 0 0 1 ${p(R_OUT, a1)} L${p(R_IN, a1)} A${R_IN} ${R_IN} 0 0 0 ${p(R_IN, a0)}Z`;
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", `rw-sector${it.on ? " on" : ""}`);
      svg.append(path);
      return path;
    });
    const labels = items.map((it, i) => {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2;
      const r = (R_IN + R_OUT) / 2;
      const lab = el("div", `rw-label${it.on ? " on" : ""}${it.sub ? " sub" : ""}`);
      lab.style.left = `calc(50% + ${(r * Math.cos(a)).toFixed(1)}px)`;
      lab.style.top = `calc(50% + ${(r * Math.sin(a)).toFixed(1)}px)`;
      lab.append(el("b", "", tr(it.label) + (it.sub ? " ▸" : "")));
      if (it.key) lab.append(el("small", "", it.key));
      return lab;
    });
    this.center = el("div", "rw-center", tr(title));
    this.root!.replaceChildren(h("div", { class: "rw-ring" }, svg, ...labels, this.center));
  }

  /** The pointer's direction from the centre picks the sector (none within the hub). */
  private onMove = (e: PointerEvent) => {
    if (!this.root) return;
    const dx = e.clientX - innerWidth / 2,
      dy = e.clientY - innerHeight / 2;
    const n = this.items.length;
    let sel = -1;
    if (Math.hypot(dx, dy) > R_IN * 0.7) {
      const a = (Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
      sel = Math.round((a / (2 * Math.PI)) * n) % n;
    }
    this.select(sel);
  };

  /** Selects a sector (−1: none) — the keyboard's and the pad's way too. */
  select(i: number) {
    if (i === this.sel) return;
    this.sel = i;
    this.sectors.forEach((s, k) => s.classList.toggle("hot", k === i));
    const it = this.items[i];
    this.center.textContent = it ? tr(it.label) : this.stack.length ? "◂" : "";
    this.center.classList.toggle("back", !it && this.stack.length > 0);
  }

  private onClick = (e: MouseEvent) => {
    e.stopPropagation();
    this.activate();
  };

  /** Does the sector selected (a sub-wheel opens; the centre, in a sub-wheel, goes back). */
  activate() {
    const it = this.items[this.sel];
    if (!it) {
      const prev = this.stack.pop();
      if (prev) this.show(prev.items, prev.title);
      else this.close();
      return;
    }
    if (it.sub) {
      this.stack.push({ items: this.items, title: this.title });
      this.show(it.sub, it.label);
      return;
    }
    this.close();
    it.run?.();
  }

  /** Released without leaving the hub (or a sub-wheel's back): nothing done. */
  get selected() {
    return this.sel;
  }

  close() {
    if (!this.root) return;
    removeEventListener("pointermove", this.onMove);
    this.unEscape?.();
    this.unEscape = null;
    this.root.remove();
    this.root = null;
    this.stack = [];
  }
}
