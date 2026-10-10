// What TARS shows (PLAN-TARS-AGENT A8): his cards over the view, beside the flight — a chart of the flight's
// recorded figures, live (the altitude and the speed of the last ten minutes), or of figures he works out
// (any series); a card of data he composes (a mission's balance, a comparison, a checklist), its rows
// coloured good / caution / bad. Three at most, the newest on top; each closed by its ×, all by "hide".
// The real screens (the map, the tablet's pages, the cockpit's displays, the flight report) he opens in the
// game itself (game-tools show_screen).

import { CHANNELS, type RecKey, recorder } from "../../game/recorder";
import { tr } from "../../i18n";
import { drawChart, type Series } from "./chart";

export interface DataRow {
  label: string;
  value: string;
  tone?: "good" | "caution" | "bad";
}

export type CardSpec =
  | {
      kind: "chart";
      title: string;
      /** the flight's recorded channels, live, over the last `seconds` */
      live?: { channels: RecKey[]; seconds: number };
      /** or series of his own */
      series?: Series[];
      /** or series computed afresh each time it is drawn (his channels, the hub's graph, the entry's corridor) */
      source?: () => {
        title?: string;
        series: Series[];
        overlay?: boolean;
        band?: [number, number];
        now?: [number, number] | null;
        time?: boolean;
        xLabel?: string;
        yUnit?: string;
      } | null;
      /** its lanes' height, as asked (the overlay: one) */
      lanes?: number;
      xLabel?: string;
      xUnit?: string;
    }
  | { kind: "data"; title: string; rows: DataRow[]; note?: string };

const NAMES: Record<RecKey, { fr: string; en: string }> = {
  alt: { fr: "Altitude", en: "Altitude" },
  speed: { fr: "Vitesse", en: "Speed" },
  vz: { fr: "Vitesse verticale", en: "Vertical speed" },
  g: { fr: "Charge", en: "Load" },
  q: { fr: "Pression dynamique", en: "Dynamic pressure" },
  mach: { fr: "Mach", en: "Mach" },
  heat: { fr: "Flux thermique", en: "Heat flux" },
  throttle: { fr: "Gaz", en: "Throttle" },
  dv: { fr: "Δv dépensé", en: "Δv spent" },
  fuel: { fr: "Propergol", en: "Propellant" },
};

/** The flight's recorded channels as series, over the last `seconds` (x: seconds ago). */
export function liveSeries(channels: RecKey[], seconds: number): Series[] {
  const S = recorder.window(seconds);
  const now = S.at(-1)?.t ?? 0;
  return channels.map((k) => {
    const c = CHANNELS.find((x) => x.key === k)!;
    return {
      label: tr(NAMES[k]),
      unit: c.unit,
      points: S.filter((s) => s[k] !== null && Number.isFinite(s[k] as number)).map(
        (s) => [s.t - now, (s[k] as number) * c.k] as [number, number],
      ),
    };
  });
}

interface Card {
  id: number;
  spec: CardSpec;
  el: HTMLElement;
  cv?: HTMLCanvasElement;
  drawnAt: number;
}

export const CARDS_MAX = 3;
/** a card of data is a snapshot: let go after this long [ms] (the live charts stay until closed) */
export const DATA_TTL = 180_000;

export class TarsDisplay {
  readonly el = document.createElement("div");
  private cards: Card[] = [];
  private next = 1;

  constructor(parent: HTMLElement = document.body) {
    this.el.className = "tars-display";
    this.el.dataset.testid = "tars-display";
    parent.append(this.el);
  }

  get count() {
    return this.cards.length;
  }

  /** A card shown: its id. */
  show(spec: CardSpec): number {
    const id = this.next++;
    const el = document.createElement("section");
    el.className = `tars-card tc-${spec.kind}`;
    el.dataset.testid = "tars-card";
    el.dataset.kind = spec.kind;
    const head = document.createElement("header");
    const tag = document.createElement("small");
    tag.textContent = "TARS";
    const title = document.createElement("h3");
    title.textContent = spec.title;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "tc-x";
    x.textContent = "×";
    x.setAttribute("aria-label", tr({ fr: "Fermer", en: "Close" }));
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide(id);
    });
    head.append(tag, title, x);
    el.append(head);
    const card: Card = { id, spec, el, drawnAt: -1e9 };
    if (spec.kind === "chart") {
      const cv = document.createElement("canvas");
      cv.className = "tc-cv";
      const n = spec.lanes ?? (spec.live ? spec.live.channels.length : (spec.series?.length ?? 1));
      cv.style.height = `${Math.min(4, Math.max(1, n)) * 64 + 22}px`;
      el.append(cv);
      if (spec.live || spec.source) {
        const foot = document.createElement("footer");
        foot.textContent = tr({ fr: "en direct · l'enregistreur du vol", en: "live · the flight recorder" });
        el.append(foot);
      }
      card.cv = cv;
    } else {
      const table = document.createElement("dl");
      for (const r of spec.rows) {
        const dt = document.createElement("dt");
        dt.textContent = r.label;
        const dd = document.createElement("dd");
        dd.textContent = r.value;
        if (r.tone) dd.dataset.tone = r.tone;
        table.append(dt, dd);
      }
      el.append(table);
      if (spec.note) {
        const p = document.createElement("p");
        p.textContent = spec.note;
        el.append(p);
      }
      // (a snapshot: when it was taken, and let go after a while)
      const foot = document.createElement("footer");
      foot.className = "tc-at";
      foot.textContent = tr({
        fr: `relevé à ${new Date().toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" })}`,
        en: `taken at ${new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}`,
      });
      el.append(foot);
      setTimeout(() => this.hide(id), DATA_TTL);
    }
    this.el.prepend(el);
    this.cards.unshift(card);
    while (this.cards.length > CARDS_MAX) this.hide(this.cards.at(-1)!.id);
    requestAnimationFrame(() => {
      el.classList.add("in");
      this.draw(card, performance.now(), true);
    });
    return id;
  }

  /** One card (by id) or all hidden: how many. */
  hide(id?: number): number {
    const gone = this.cards.filter((c) => id === undefined || c.id === id);
    for (const c of gone) {
      c.el.classList.remove("in");
      c.el.classList.add("out");
      setTimeout(() => c.el.remove(), 260);
    }
    this.cards = this.cards.filter((c) => !gone.includes(c));
    return gone.length;
  }

  /** The live charts, a few times a second. */
  update(now: number) {
    for (const c of this.cards) this.draw(c, now, false);
  }

  private draw(c: Card, now: number, force: boolean) {
    if (!c.cv || c.spec.kind !== "chart") return;
    if (!force && ((!c.spec.live && !c.spec.source) || now - c.drawnAt < 250)) return;
    c.drawnAt = now;
    const s = c.spec;
    if (s.source) {
      const d = s.source();
      // (its title following what it shows: the hub's graph changes with the flight's phase)
      if (d?.title) c.el.querySelector("h3")!.textContent = d.title;
      if (d) drawChart(c.cv, d.series, { overlay: d.overlay, band: d.band, now: d.now, time: d.time, xLabel: d.xLabel, yUnit: d.yUnit });
    } else if (s.live) drawChart(c.cv, liveSeries(s.live.channels, s.live.seconds), { time: true });
    else drawChart(c.cv, s.series ?? [], { xLabel: s.xLabel, xUnit: s.xUnit });
  }

  /** What is shown, for the tests and the model. */
  list() {
    return this.cards.map((c) => ({ id: c.id, kind: c.spec.kind, title: c.spec.title }));
  }
}
