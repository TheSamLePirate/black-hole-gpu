// The radial wheel: Tab held (a tap stays "next target") opens it at the centre of the view; the
// pointer's direction picks a sector, releasing Tab (or a click) does it; a sector with a sub-wheel opens
// it in place (the centre goes back); Escape closes. What it offers is the caller's: the flight's
// holds and autopilots, or the camera's views on foot. Sized by the view (its smaller side: up to 800 px across), its
// labels and the centre's readout in proportion — the selected item's name, its key, whether engaged, the path of
// sub-wheels taken —, read at a glance in flight.

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
  /** a line on what it does (shown in the centre when selected) */
  hint?: Text;
}

const NS = "http://www.w3.org/2000/svg";
const ON: Text = { fr: "engagé", en: "engaged" };

/** The wheel's radii for the view now [px]: its outer ring (the smaller side's 44 %, 150–400), its hub. */
function radii() {
  const R = Math.round(Math.min(400, Math.max(150, 0.44 * Math.min(innerWidth, innerHeight))));
  return { R, r: Math.round(R * 0.36) };
}

export class RadialWheel {
  private root: HTMLElement | null = null;
  private items: WheelItem[] = [];
  private stack: { items: WheelItem[]; title: Text }[] = [];
  private title: Text = { fr: "", en: "" };
  private sel = -1;
  private sectors: SVGPathElement[] = [];
  private center!: HTMLElement;
  private rIn = 60;
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
    const { R, r: R_IN } = radii();
    const R_OUT = R;
    this.rIn = R_IN;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `${-R_OUT - 4} ${-R_OUT - 4} ${2 * R_OUT + 8} ${2 * R_OUT + 8}`);
    svg.setAttribute("class", "rw-svg");
    this.sectors = items.map((it, i) => {
      // (sector i centred on the angle i · 360/n, the first at the top, clockwise)
      const a0 = ((i - 0.5) / n) * 2 * Math.PI - Math.PI / 2 + 0.01;
      const a1 = ((i + 0.5) / n) * 2 * Math.PI - Math.PI / 2 - 0.01;
      const p = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
      const d = `M${p(R_IN, a0)} L${p(R_OUT, a0)} A${R_OUT} ${R_OUT} 0 0 1 ${p(R_OUT, a1)} L${p(R_IN, a1)} A${R_IN} ${R_IN} 0 0 0 ${p(R_IN, a0)}Z`;
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", `rw-sector${it.on ? " on" : ""}${it.sub ? " sub" : ""}`);
      svg.append(path);
      return path;
    });
    // (the type in proportion: 13–20 px for the labels at 150–400 px)
    const font = Math.round(Math.min(20, Math.max(13, R_OUT * 0.05)));
    // (the labels at the ring's middle, as wide as their sector's chord there)
    const rl = (R_IN + R_OUT) / 2;
    const chord = Math.min(2 * rl * Math.sin(Math.PI / Math.max(n, 2)) * 0.9, (R_OUT - R_IN) * 1.25);
    const labels = items.map((it, i) => {
      const a = (i / n) * 2 * Math.PI - Math.PI / 2;
      const lab = el("div", `rw-label${it.on ? " on" : ""}${it.sub ? " sub" : ""}`);
      lab.style.left = `calc(50% + ${(rl * Math.cos(a)).toFixed(1)}px)`;
      lab.style.top = `calc(50% + ${(rl * Math.sin(a)).toFixed(1)}px)`;
      lab.style.maxWidth = `${Math.round(chord)}px`;
      const text = tr(it.label) + (it.sub ? " ▸" : "");
      const b = el("b", "", text);
      // (its longest word on one line: the type made smaller for it — POSTCOMBUSTION was cut in two)
      const longest = Math.max(...text.split(/\s+/).map((w) => w.length));
      const fit = chord / (longest * 0.74);
      if (fit < font) b.style.fontSize = `${Math.max(11, Math.floor(fit))}px`;
      lab.append(b);
      if (it.key) lab.append(el("small", "", it.key));
      return lab;
    });
    this.center = el("div", "rw-center");
    const ring = h("div", { class: "rw-ring" }, svg, ...labels, this.center);
    ring.style.setProperty("--rw-size", `${2 * R_OUT}px`);
    ring.style.setProperty("--rw-hub", `${2 * R_IN - 6}px`);
    ring.style.setProperty("--rw-font", `${font}px`);
    this.root!.replaceChildren(ring);
    this.readout();
  }

  /** The centre: the path taken and the wheel's title, or the item selected — its name, its key, engaged, its line. */
  private readout() {
    const it = this.items[this.sel];
    const path = [...this.stack.map((s) => tr(s.title)), tr(this.title)];
    const c = this.center;
    c.classList.toggle("back", !it && this.stack.length > 0);
    c.classList.toggle("pick", !!it);
    if (!it) {
      c.replaceChildren(
        ...(this.stack.length ? [el("em", "rw-path", path.slice(0, -1).join(" › "))] : []),
        el("b", "rw-title", this.stack.length ? `◂ ${tr(this.title)}` : tr(this.title)),
      );
      return;
    }
    const parts: HTMLElement[] = [el("b", "rw-name", tr(it.label) + (it.sub ? " ▸" : ""))];
    const meta = [it.key, it.on ? tr(ON) : ""].filter(Boolean).join(" · ");
    if (meta) parts.push(el("small", `rw-meta${it.on ? " on" : ""}`, meta));
    if (it.hint) parts.push(el("span", "rw-hint", tr(it.hint)));
    c.replaceChildren(...parts);
  }

  /** The pointer's direction from the centre picks the sector (none within the hub). */
  private onMove = (e: PointerEvent) => {
    if (!this.root) return;
    const dx = e.clientX - innerWidth / 2,
      dy = e.clientY - innerHeight / 2;
    // (a small dead zone at the centre: the direction picks, not the distance)
    this.select(Math.hypot(dx, dy) > Math.min(this.rIn * 0.5, 48) ? this.sectorAt(dx, dy) : -1);
  };

  /** The sector in a direction from the centre (screen axes: right +, down +). */
  private sectorAt(dx: number, dy: number) {
    const n = this.items.length;
    const a = (Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    return Math.round((a / (2 * Math.PI)) * n) % n;
  }

  /** A pad's stick aims (right +, up +); let go (null), the sector stays picked — A does it, B goes back. */
  aim(v: [number, number] | null) {
    if (this.root && v) this.select(this.sectorAt(v[0], -v[1]));
  }

  /** Back a wheel (the pad's B): the parent's, or closed. */
  back() {
    const prev = this.stack.pop();
    if (prev) this.show(prev.items, prev.title);
    else this.close();
  }

  /** Selects a sector (−1: none) — the keyboard's and the pad's way too. */
  select(i: number) {
    if (i === this.sel) return;
    this.sel = i;
    this.sectors.forEach((s, k) => s.classList.toggle("hot", k === i));
    this.root?.querySelectorAll(".rw-label").forEach((l, k) => l.classList.toggle("hot", k === i));
    this.readout();
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
