// The sky panel: the sky chart's switches in one place — the constellations (figures, names, the stars'
// names), the grids (equatorial of the date, horizontal where the camera stands over a world, the
// ecliptic), the chart's opacity — and where the camera sees the sky from. Opened by the toolbar's sky
// button; N and U from the keyboard. And the card of what the pointer hovers in the sky.

import type { Settings } from "../settings";
import { onEscape } from "./keys";
import { CONSTELLATIONS, NAMED_STARS, type Constellation, type NamedStar } from "../skychart";
import { el as h } from "./kit";

const ICON = {
  lines:
    '<circle cx="5" cy="17" r="1.6" class="f"/><circle cx="10" cy="8" r="1.6" class="f"/><circle cx="17" cy="11" r="1.6" class="f"/><circle cx="19" cy="4" r="1.2" class="f"/><path d="M5 17l5-9 7 3 2-7"/>',
  names: '<path d="M4 17l4-10 4 10M5.5 13.5h5"/><path d="M14 9h6M14 13h6M14 17h4"/>',
  stars: '<path d="M12 3l2.2 5.6L20 9l-4.5 3.8L17 19l-5-3.2L7 19l1.5-6.2L4 9l5.8-.4z"/>',
  equatorial: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3"/><ellipse cx="12" cy="12" rx="3.5" ry="8.5"/>',
  horizontal: '<path d="M2 17h20"/><path d="M4.5 17a7.5 7.5 0 0 1 15 0"/><path d="M12 9.5V5M12 5l-2 2M12 5l2 2"/>',
  ecliptic: '<circle cx="12" cy="12" r="3" class="f"/><path d="M2.5 15.5C7 9 17 7 21.5 8.5" stroke-dasharray="2.5 2"/>',
};

export interface SkyPanelDeps {
  settings: Settings;
  /** a setting changed (the chart redrawn, the URL saved) */
  changed: (keys: (keyof Settings)[]) => void;
  /** where the sky is seen from: our sky (a world's horizon or space) or the black hole's */
  where: () => { ours: boolean; horizon: string | null };
  /** turns the camera to a constellation or a named star (its index) */
  goTo: (kind: "constellation" | "star", index: number) => void;
}

type Key = "skyLines" | "skyNames" | "starNames" | "gridEquatorial" | "gridHorizontal" | "skyEcliptic";

export class SkyPanel {
  readonly el = h("div");
  readonly card = h("div");
  private lastKey = "";
  private stateText = h("span", "skp-where");
  private query = "";

  constructor(private d: SkyPanelDeps) {
    this.el.id = "sky-pop";
    this.el.hidden = true;
    this.card.id = "sky-card";
    this.card.hidden = true;
    document.body.append(this.el, this.card);
  }
  private unEscape?: () => void;

  get open() {
    return !this.el.hidden;
  }
  /**
   * Into a page of the tablet (ui/tablet.ts) — shown there, no Escape of its own (the map's) — or
   * back to its popover, closed (null).
   */
  embed(into: HTMLElement | null) {
    this.unEscape?.();
    this.unEscape = undefined;
    if (into) into.append(this.el);
    else document.body.append(this.el);
    this.el.classList.toggle("embedded", !!into);
    this.el.hidden = !into;
    this.lastKey = "";
    this.refresh();
  }

  toggle(open = this.el.hidden) {
    this.el.hidden = !open;
    this.unEscape?.();
    this.unEscape = open ? onEscape(() => this.toggle(false)) : undefined;
    this.lastKey = "";
    this.refresh();
  }

  /** Rebuilds the panel when what it shows changed (cheap to call every frame). */
  refresh() {
    if (this.el.hidden) return;
    const s = this.d.settings,
      w = this.d.where();
    const key = [
      s.skyLines,
      s.skyNames,
      s.starNames,
      s.gridEquatorial,
      s.gridHorizontal,
      s.skyEcliptic,
      s.skyChartOpacity,
      w.ours,
      w.horizon,
    ].join();
    if (key === this.lastKey) return;
    this.lastKey = key;
    const el = this.el;
    el.replaceChildren();
    const head = h("div", "fl-title skp-head");
    head.append(h("span", "fl-htext", "Sky chart"));
    const x = h("button", "skp-x", "×");
    x.title = "Close (Esc)";
    x.onclick = () => this.toggle(false);
    head.append(x);
    const st = h("div", "skp-state");
    const chip = h("span", "skp-chip", w.ours ? "Our sky" : "Gargantua's sky");
    this.stateText.textContent = !w.ours
      ? "The chart draws our constellations: go through the wormhole to see them"
      : w.horizon
        ? `Horizon of ${w.horizon} — the horizontal grid is there`
        : "In space — the horizontal grid needs a world under the camera";
    st.append(chip, this.stateText);
    el.append(head, st);

    const tile = (key: Key, icon: string, title: string, sub: string, disabled = false) => {
      const b = h("button", "skp-tile");
      b.classList.toggle("active", !!s[key]);
      b.disabled = disabled;
      const i = h("span", "skp-ti");
      i.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg>`;
      const t = h("span", "skp-tt");
      t.append(h("b", "", title), h("small", "", sub));
      b.append(i, t);
      b.onclick = () => {
        s[key] = !s[key];
        this.d.changed([key]);
        this.refresh();
      };
      return b;
    };
    const sec = (label: string, ...tiles: HTMLElement[]) => {
      const e = h("div", "skp-sec");
      const grid = h("div", "skp-tiles");
      grid.append(...tiles);
      e.append(h("div", "skp-label", label), grid);
      return e;
    };
    el.append(
      sec(
        "Constellations",
        tile("skyLines", ICON.lines, "Figures", "The 88 constellations' lines — hover one"),
        tile("skyNames", ICON.names, "Names", "Written across their figures"),
        tile("starNames", ICON.stars, "Stars", "The bright stars' names — more as you zoom"),
      ),
      sec(
        "Grids",
        tile("gridEquatorial", ICON.equatorial, "Equatorial", "Right ascension, declination (of date)"),
        tile("gridHorizontal", ICON.horizontal, "Horizontal", "Altitude, azimuth, the cardinal points", !w.horizon && !s.gridHorizontal),
        tile("skyEcliptic", ICON.ecliptic, "Ecliptic", "The Sun's path, the planets' road"),
      ),
    );
    // find: a constellation or a star by its name, the camera turned to it
    const find = h("div", "skp-sec");
    const q = h("input", "skp-search") as HTMLInputElement;
    q.type = "search";
    q.placeholder = "Go to a constellation or a star — Orion, Vega, Crux…";
    q.value = this.query;
    const hits = h("div", "skp-hits");
    const list = () => {
      hits.replaceChildren();
      const t = this.query.trim().toLowerCase();
      if (!t) return;
      const found: { kind: "constellation" | "star"; index: number; name: string; sub: string }[] = [];
      CONSTELLATIONS.forEach((c, i) => {
        if (c.name.toLowerCase().includes(t) || c.abbr.toLowerCase() === t)
          found.push({ kind: "constellation", index: i, name: c.name, sub: c.abbr });
      });
      NAMED_STARS.forEach((st, i) => {
        if (st.name.toLowerCase().includes(t))
          found.push({
            kind: "star",
            index: i,
            name: st.name,
            sub: `V ${st.mag.toFixed(1)}${st.constellation >= 0 ? ` · ${CONSTELLATIONS[st.constellation]!.abbr}` : ""}`,
          });
      });
      found.sort(
        (a, b) => Number(!a.name.toLowerCase().startsWith(t)) - Number(!b.name.toLowerCase().startsWith(t)) || a.name.localeCompare(b.name),
      );
      for (const f of found.slice(0, 10)) {
        const b = h("button", `skp-hit ${f.kind}`);
        b.append(h("i"), h("span", "", f.name), h("small", "", f.sub));
        b.onclick = () => this.d.goTo(f.kind, f.index);
        hits.append(b);
      }
      if (!found.length) hits.append(h("span", "skp-none", "Nothing by that name"));
    };
    q.oninput = () => {
      this.query = q.value;
      list();
    };
    q.onkeydown = (e) => {
      if (e.key === "Enter") (hits.querySelector("button") as HTMLButtonElement | null)?.click();
      e.stopPropagation();
    };
    list();
    find.append(h("div", "skp-label", "Go to"), q, hits);
    el.append(find);
    const op = h("div", "skp-sec");
    const row = h("div", "skp-op");
    const range = h("input") as HTMLInputElement;
    range.type = "range";
    range.min = "0.1";
    range.max = "1";
    range.step = "0.01";
    range.value = String(s.skyChartOpacity);
    const val = h("span", "skp-value", `${Math.round(s.skyChartOpacity * 100)} %`);
    range.oninput = () => {
      s.skyChartOpacity = Number(range.value);
      val.textContent = `${Math.round(s.skyChartOpacity * 100)} %`;
      this.lastKey = [
        s.skyLines,
        s.skyNames,
        s.starNames,
        s.gridEquatorial,
        s.gridHorizontal,
        s.skyEcliptic,
        s.skyChartOpacity,
        w.ours,
        w.horizon,
      ].join();
      this.d.changed(["skyChartOpacity"]);
    };
    row.append(range, val);
    op.append(h("div", "skp-label", "Opacity"), row);
    const keys = h("div", "skp-keys");
    keys.innerHTML = "<kbd>N</kbd> constellations · <kbd>⇧N</kbd> star names · <kbd>U</kbd> grids · hover a star for its card";
    el.append(op, keys);
  }

  /** The card of what the pointer hovers (null: hidden), at (x, y) CSS pixels. */
  showCard(
    at: { x: number; y: number } | null,
    what?: {
      star: NamedStar | null;
      constellation: Constellation | null;
      radec: [number, number];
      radecDate: [number, number];
      altaz: [number, number] | null;
    },
  ) {
    const c = this.card;
    if (!at || !what || (!what.star && !what.constellation)) {
      c.hidden = true;
      return;
    }
    const ra = (deg: number) => {
      const s = Math.round((((deg % 360) + 360) % 360) * 240); // seconds of time
      return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
    };
    const dec = (deg: number) => {
      const a = Math.round(Math.abs(deg) * 60);
      return `${deg < 0 ? "−" : "+"}${Math.floor(a / 60)}° ${String(a % 60).padStart(2, "0")}′`;
    };
    const rows: [string, string][] = [];
    if (what.star) rows.push(["Magnitude", `V ${what.star.mag.toFixed(2)}`]);
    rows.push(["RA · Dec J2000", `${ra(what.radec[0])} · ${dec(what.radec[1])}`]);
    rows.push(["RA · Dec of date", `${ra(what.radecDate[0])} · ${dec(what.radecDate[1])}`]);
    if (what.altaz)
      rows.push(["Alt · Az", `${what.altaz[0] >= 0 ? "+" : "−"}${Math.abs(what.altaz[0]).toFixed(1)}° · ${what.altaz[1].toFixed(1)}°`]);
    c.replaceChildren();
    const title = h("div", "sc-title", what.star ? what.star.name : what.constellation!.name);
    const sub = h(
      "div",
      "sc-sub",
      what.star ? (what.constellation ? `Star · in ${what.constellation.name}` : "Star") : `Constellation · ${what.constellation!.abbr}`,
    );
    c.append(title, sub);
    for (const [k, v] of rows) {
      const r = h("div", "sc-row");
      r.append(h("span", "", k), h("b", "", v));
      c.append(r);
    }
    c.hidden = false;
    const w = c.offsetWidth,
      hh = c.offsetHeight;
    const x = Math.min(at.x + 18, innerWidth - w - 8),
      y = Math.min(Math.max(at.y - hh - 14, 8), innerHeight - hh - 8);
    c.style.transform = `translate(${x}px, ${y}px)`;
  }
}
