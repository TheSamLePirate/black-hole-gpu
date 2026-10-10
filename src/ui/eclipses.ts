// The eclipse calculator's page (PLAN-CIEL C7): every eclipse of the solar system, found by the planner's
// worker (eclipse/search.ts) and drawn —
//   · four tabs: the Sun's and the Moon's (seen from the Earth), the transits of Mercury and Venus, the
//     planets' moons (their eclipses, occultations, transits and shadows, seen from the Earth), the Sun's
//     eclipses seen from another world;
//   · a span of years, the types to show, "seen from here" (the player's place, or one picked on the map);
//   · on the left their timeline, each with its glyph, date, figures and whether it is seen from here;
//   · on the right its sheet: the figures (type, magnitude, gamma, duration, width, saros); a solar one's
//     map — the central path and its limits, the partial zones by their greatest magnitude, the greatest
//     point, the place (a click moves it) — and its look from there: the Moon's way across the Sun, scrubbed
//     or played, the contacts and the Sun's heights; a lunar one's shadow diagram — umbra, penumbra, the
//     Moon's way through them, scrubbed — and where the Moon is up; a transit's way across the Sun;
//   · "Go and see" (the date, the place, the view: the game), "Ask TARS".

import "./eclipses.css";
import earthUrl from "../../assets/planets/earth.jpg";
import { lang, tr, type Text } from "../i18n";
import type { EclipseEvent, EclipseKind, EclipseQuery } from "../eclipse/search";
import type { EclipseDetail, MoonsView, ShadowDiagram, SkyTrack } from "../eclipse/details";
import type { LunarEclipse, SolarEclipse } from "../eclipse/earth-moon";
import type { Transit, WorldEclipse } from "../eclipse/moons";
import { diskShare } from "../system/solar";
import { button, el, h, modal } from "./kit";

export interface EclipseHost {
  /** the game's date [ms UTC] */
  now(): number;
  /** the player's place on the Earth [°] (null: not over the Earth) */
  place(): { lat: number; lon: number } | null;
  search(q: EclipseQuery): Promise<{ events: EclipseEvent[]; clipped: EclipseKind[] } | { error: string }>;
  detail(e: SolarEclipse | LunarEclipse | Transit, place: { lat: number; lon: number } | null): Promise<EclipseDetail | { error: string }>;
  /** the game taken there: the date, the place, the view on it */
  goSee(e: EclipseEvent, place: { lat: number; lon: number } | null): void;
  /** a question to TARS */
  ask(text: string): void;
  /** a planet and its moons as seen from the Earth then */
  moonsView(planet: string, t: number): Promise<MoonsView | { error: string }>;
}

type Tab = "earth" | "transits" | "moons" | "world";

const TABS: { id: Tab; name: Text; glyph: string }[] = [
  { id: "earth", name: { fr: "Soleil & Lune", en: "Sun & Moon" }, glyph: "solar-total" },
  { id: "transits", name: { fr: "Transits", en: "Transits" }, glyph: "transit" },
  { id: "moons", name: { fr: "Satellites", en: "Moons" }, glyph: "phen" },
  { id: "world", name: { fr: "Vu d'un autre monde", en: "From another world" }, glyph: "world" },
];

const PLANETS: { id: string; name: Text }[] = [
  { id: "jupiter", name: { fr: "Jupiter", en: "Jupiter" } },
  { id: "saturn", name: { fr: "Saturne", en: "Saturn" } },
  { id: "neptune", name: { fr: "Neptune", en: "Neptune" } },
  { id: "uranus", name: { fr: "Uranus", en: "Uranus" } },
  { id: "mars", name: { fr: "Mars", en: "Mars" } },
  { id: "pluto", name: { fr: "Pluton", en: "Pluto" } },
];

const WORLDS: { id: string; name: Text }[] = [
  { id: "moon", name: { fr: "la Lune", en: "the Moon" } },
  { id: "mars", name: { fr: "Mars", en: "Mars" } },
  { id: "io", name: { fr: "Io", en: "Io" } },
  { id: "europa", name: { fr: "Europe", en: "Europa" } },
  { id: "ganymede", name: { fr: "Ganymède", en: "Ganymede" } },
  { id: "callisto", name: { fr: "Callisto", en: "Callisto" } },
  { id: "titan", name: { fr: "Titan", en: "Titan" } },
  { id: "jupiter", name: { fr: "Jupiter", en: "Jupiter" } },
  { id: "saturn", name: { fr: "Saturne", en: "Saturn" } },
  { id: "triton", name: { fr: "Triton", en: "Triton" } },
];

const NAMES: Record<string, Text> = Object.fromEntries(
  [...PLANETS, ...WORLDS, { id: "earth", name: { fr: "la Terre", en: "the Earth" } }].map((b) => [b.id, b.name]),
);
const BODY: Record<string, Text> = {
  ...NAMES,
  moon: { fr: "la Lune", en: "the Moon" },
  phobos: { fr: "Phobos", en: "Phobos" },
  deimos: { fr: "Deimos", en: "Deimos" },
  mimas: { fr: "Mimas", en: "Mimas" },
  enceladus: { fr: "Encelade", en: "Enceladus" },
  tethys: { fr: "Téthys", en: "Tethys" },
  dione: { fr: "Dioné", en: "Dione" },
  rhea: { fr: "Rhéa", en: "Rhea" },
  iapetus: { fr: "Japet", en: "Iapetus" },
  charon: { fr: "Charon", en: "Charon" },
  mercury: { fr: "Mercure", en: "Mercury" },
  venus: { fr: "Vénus", en: "Venus" },
};
const nameOf = (id: string) => (BODY[id] ? tr(BODY[id]!) : id);
const bare = (id: string) => nameOf(id).replace(/^(la |le |l'|the )/, "");

const TYPES: Record<string, Text> = {
  "solar-total": { fr: "Éclipse totale de Soleil", en: "Total solar eclipse" },
  "solar-annular": { fr: "Éclipse annulaire de Soleil", en: "Annular solar eclipse" },
  "solar-hybrid": { fr: "Éclipse hybride de Soleil", en: "Hybrid solar eclipse" },
  "solar-partial": { fr: "Éclipse partielle de Soleil", en: "Partial solar eclipse" },
  "lunar-total": { fr: "Éclipse totale de Lune", en: "Total lunar eclipse" },
  "lunar-partial": { fr: "Éclipse partielle de Lune", en: "Partial lunar eclipse" },
  "lunar-penumbral": { fr: "Éclipse de Lune par la pénombre", en: "Penumbral lunar eclipse" },
};

/** The filters of the first tab: the types shown. */
const FILTERS: { key: string; name: Text }[] = [
  { key: "solar-total", name: { fr: "Totales", en: "Total" } },
  { key: "solar-annular", name: { fr: "Annulaires", en: "Annular" } },
  { key: "solar-hybrid", name: { fr: "Hybrides", en: "Hybrid" } },
  { key: "solar-partial", name: { fr: "Partielles", en: "Partial" } },
  { key: "lunar-total", name: { fr: "Lune totale", en: "Lunar total" } },
  { key: "lunar-partial", name: { fr: "Lune partielle", en: "Lunar partial" } },
  { key: "lunar-penumbral", name: { fr: "Pénombre", en: "Penumbral" } },
];

const WHAT: Record<string, Text> = {
  ecl: { fr: "dans l'ombre de", en: "in the shadow of" },
  occ: { fr: "caché derrière", en: "hidden behind" },
  tra: { fr: "passe devant", en: "crosses" },
  sha: { fr: "son ombre sur", en: "its shadow on" },
};
const WHAT_SHORT: Record<string, Text> = {
  ecl: { fr: "Éclipse", en: "Eclipse" },
  occ: { fr: "Occultation", en: "Occultation" },
  tra: { fr: "Passage", en: "Transit" },
  sha: { fr: "Ombre", en: "Shadow" },
};

const DAY = 86400e3;
const locale = () => (lang === "fr" ? "fr-FR" : "en-GB");
const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtTime = (t: number) =>
  Number.isFinite(t)
    ? `${new Date(t).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" })}`
    : "—";
const fmtDur = (s: number) => {
  if (!(s > 0)) return "—";
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = Math.round(s % 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min ${String(r).padStart(2, "0")} s`;
};
const num = (x: number, d = 3) => x.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
const deg = (x: number, d = 1) => `${num(x, d)}°`;
const latLon = (p: { lat: number; lon: number }) =>
  `${num(Math.abs(p.lat), 2)}° ${p.lat >= 0 ? "N" : "S"} · ${num(Math.abs(p.lon), 2)}° ${p.lon >= 0 ? "E" : tr({ fr: "O", en: "W" })}`;

/** An event's type key (its glyph, its name). */
function keyOf(e: EclipseEvent): string {
  if (e.kind === "solar") return `solar-${e.type}`;
  if (e.kind === "lunar") return `lunar-${e.type}`;
  if (e.kind === "transit") return "transit";
  if (e.kind === "phenomenon") return `phen-${e.what}`;
  return "world";
}

/** An eclipse's glyph (SVG, 40 × 40): its look in a few strokes. */
export function glyph(key: string): string {
  const sun = `<circle cx="20" cy="20" r="12" fill="url(#ec-sun)"/>`;
  const defs = `<defs><radialGradient id="ec-sun"><stop offset="0" stop-color="#fff6d6"/><stop offset=".75" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff9c3a"/></radialGradient><radialGradient id="ec-red"><stop offset="0" stop-color="#c2502a"/><stop offset="1" stop-color="#6e1d0e"/></radialGradient><radialGradient id="ec-cor"><stop offset=".55" stop-color="#cfe6ff" stop-opacity=".9"/><stop offset="1" stop-color="#cfe6ff" stop-opacity="0"/></radialGradient></defs>`;
  const body =
    {
      "solar-total": `<circle cx="20" cy="20" r="19" fill="url(#ec-cor)"/><circle cx="20" cy="20" r="11.5" fill="#05070c"/>`,
      "solar-annular": `${sun}<circle cx="20" cy="20" r="9.5" fill="#05070c"/>`,
      "solar-hybrid": `<circle cx="20" cy="20" r="18" fill="url(#ec-cor)"/>${sun}<circle cx="20" cy="20" r="11.6" fill="#05070c"/><path d="M20 8a12 12 0 0 1 0 24" fill="none" stroke="#ffd27a" stroke-width="1.6"/>`,
      "solar-partial": `${sun}<circle cx="27" cy="15" r="11" fill="#05070c"/>`,
      "lunar-total": `<circle cx="20" cy="20" r="12" fill="url(#ec-red)"/>`,
      "lunar-partial": `<circle cx="20" cy="20" r="12" fill="#c9c6bd"/><path d="M20 8a12 12 0 0 0 0 24a8 12 0 0 0 0-24z" fill="url(#ec-red)"/>`,
      "lunar-penumbral": `<circle cx="20" cy="20" r="12" fill="#c9c6bd"/><circle cx="20" cy="20" r="12" fill="#3a3530" opacity=".45"/>`,
      transit: `${sun}<circle cx="25" cy="18" r="1.8" fill="#05070c"/>`,
      "phen-ecl": `<circle cx="17" cy="20" r="11" fill="#d8b98c"/><path d="M6 17h22M7 23h20" stroke="#a87b4f" stroke-width="2"/><circle cx="34" cy="20" r="2.4" fill="#333"/>`,
      "phen-occ": `<circle cx="17" cy="20" r="11" fill="#d8b98c"/><path d="M6 17h22M7 23h20" stroke="#a87b4f" stroke-width="2"/><circle cx="29" cy="20" r="2.4" fill="#e8e8e8" opacity=".35"/>`,
      "phen-tra": `<circle cx="20" cy="20" r="11" fill="#d8b98c"/><path d="M9 17h22M10 23h20" stroke="#a87b4f" stroke-width="2"/><circle cx="23" cy="19" r="2.4" fill="#f4efe6"/>`,
      "phen-sha": `<circle cx="20" cy="20" r="11" fill="#d8b98c"/><path d="M9 17h22M10 23h20" stroke="#a87b4f" stroke-width="2"/><circle cx="17" cy="21" r="2.2" fill="#05070c"/>`,
      world: `${sun}<circle cx="22" cy="21" r="12.5" fill="#1d2a3c"/><path d="M12 30a12 12 0 0 0 20-6" stroke="#6fd2ff" stroke-width="1.2" fill="none" opacity=".7"/>`,
    }[key] ?? sun;
  return `<svg viewBox="0 0 40 40" class="ec-glyph" aria-hidden="true">${defs}${body}</svg>`;
}

/** A row's title (what it is, the bodies). */
function titleOf(e: EclipseEvent): string {
  const k = keyOf(e);
  if (TYPES[k]) return tr(TYPES[k]!);
  if (e.kind === "transit") return tr({ fr: `Transit de ${bare(e.planet)}`, en: `Transit of ${bare(e.planet)}` });
  if (e.kind === "phenomenon")
    return `${bare(e.moon)} — ${tr(WHAT[e.what]!)} ${e.what === "sha" || e.what === "tra" ? bare(e.planet) : bare(e.planet)}`;
  const w = e as WorldEclipse;
  const type = {
    total: { fr: "totale", en: "total" },
    annular: { fr: "annulaire", en: "annular" },
    partial: { fr: "partielle", en: "partial" },
  }[w.type];
  return tr({
    fr: `Le Soleil caché par ${nameOf(w.by)} (${tr(type)})`,
    en: `The Sun hidden by ${nameOf(w.by)} (${tr(type)})`,
  });
}

/** A row's figures in a line. */
function subOf(e: EclipseEvent): string {
  if (e.kind === "solar") {
    const d = e.greatest.duration ? ` · ${fmtDur(e.greatest.duration)}` : "";
    return `Saros ${e.saros} · ${tr({ fr: "grandeur", en: "magnitude" })} ${num(e.magnitude)}${d} · γ ${num(e.gamma, 4)}`;
  }
  if (e.kind === "lunar")
    return `Saros ${e.saros} · ${tr({ fr: "grandeur d'ombre", en: "umbral" })} ${num(e.umbral)}${e.total ? ` · ${tr({ fr: "totalité", en: "totality" })} ${fmtDur(e.total)}` : ""}`;
  if (e.kind === "transit") return `${fmtTime(e.start)} → ${fmtTime(e.end)} UTC · ${num(e.sep, 0)}″`;
  if (e.kind === "phenomenon")
    return `${fmtTime(e.start)} → ${fmtTime(e.end)} UTC${Number.isFinite(e.start) && Number.isFinite(e.end) ? ` · ${fmtDur((e.end - e.start) / 1000)}` : ""}`;
  const w = e as WorldEclipse;
  return `${fmtTime(w.start)} → ${fmtTime(w.end)} UTC · ${fmtDur((w.end - w.start) / 1000)}`;
}

/** The disc covered by another at a separation: the share hidden (an obscuration). */
const hidden = (k: number, sep: number) => 1 - diskShare(1, k, sep);

export class EclipsePage {
  private close: (() => void) | null = null;
  private tab: Tab = "earth";
  private from = 0;
  private to = 0;
  private planet = "jupiter";
  private world = "moon";
  private shown = new Set(FILTERS.map((f) => f.key));
  private hereOnly = false;
  private events: EclipseEvent[] = [];
  private selected: string | null = null;
  /** the place the sheets look from: the player's, or one picked on a map */
  private place: { lat: number; lon: number } | null = null;
  private placePicked = false;
  private earth = new Image();
  private job = 0;
  private els: Record<string, HTMLElement> = {};
  private anim = 0;

  constructor(private host: EclipseHost) {
    this.earth.src = earthUrl;
  }

  get isOpen() {
    return !!this.close;
  }

  /** The page, on a tab and an event (by its id, or the first one after a date). */
  open(o: { tab?: Tab; select?: string; at?: number } = {}) {
    if (this.close) this.dispose();
    const now = this.host.now();
    const y = new Date(o.at ?? now).getUTCFullYear();
    this.tab = o.tab ?? this.tab;
    this.from = y;
    this.to = y + 4;
    this.selected = o.select ?? null;
    if (!this.placePicked) this.place = this.host.place();
    const tabs = h(
      "div",
      { class: "ec-tabs", role: "tablist" },
      ...TABS.map((t) => {
        const b = h("button", { type: "button", role: "tab", class: "ec-tab", "data-tab": t.id, "data-testid": `ec-tab-${t.id}` });
        b.innerHTML = `${glyph(t.glyph)}<span>${tr(t.name)}</span>`;
        b.addEventListener("click", () => {
          this.tab = t.id;
          this.selected = null;
          this.refresh();
        });
        return b;
      }),
    );
    const years = (v: number, set: (n: number) => void, label: Text) => {
      const i = h("input", {
        type: "number",
        min: "1990",
        max: "2150",
        value: String(v),
        class: "ec-year",
        "aria-label": tr(label),
      }) as HTMLInputElement;
      i.addEventListener("change", () => {
        set(Math.min(Math.max(Math.round(Number(i.value)) || v, 1990), 2150));
        this.refresh();
      });
      return i;
    };
    const span = h(
      "div",
      { class: "ec-span" },
      el("span", "ec-lab", tr({ fr: "De", en: "From" })),
      years(this.from, (n) => (this.from = n), { fr: "Année de début", en: "From year" }),
      el("span", "ec-lab", tr({ fr: "à", en: "to" })),
      years(this.to, (n) => (this.to = n), { fr: "Année de fin", en: "To year" }),
    );
    this.els.span = span;
    const placeChip = h("button", { type: "button", class: "ec-place", "data-testid": "ec-place" });
    placeChip.addEventListener("click", () => {
      this.place = this.host.place();
      this.placePicked = false;
      this.refresh();
    });
    this.els.place = placeChip;
    this.els.filters = h("div", { class: "ec-filters" });
    this.els.list = h("div", { class: "ec-list", role: "listbox", "aria-label": tr({ fr: "Les éclipses", en: "The eclipses" }) });
    this.els.sheet = h("div", { class: "ec-sheet", "data-testid": "ec-sheet" });
    this.els.status = el("div", "ec-status");
    const body = h(
      "div",
      { class: "ec" },
      h("div", { class: "ec-bar" }, tabs, span, placeChip),
      this.els.filters,
      h("div", { class: "ec-main" }, h("div", { class: "ec-col" }, this.els.status, this.els.list), this.els.sheet),
    );
    this.els.tabs = tabs;
    const m = modal({
      title: tr({ fr: "Éclipses", en: "Eclipses" }),
      body: [body],
      cls: "ec-frame",
      testid: "eclipses",
      onClose: () => this.dispose(),
    });
    this.close = m.close;
    this.refresh();
  }

  hide() {
    this.close?.();
  }

  private dispose() {
    cancelAnimationFrame(this.anim);
    this.close = null;
    this.job++;
  }

  /** The filters for the tab, then the search. */
  private refresh() {
    for (const b of this.els.tabs!.querySelectorAll<HTMLElement>(".ec-tab")) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
    this.els.place!.innerHTML = this.place
      ? `<b>${tr({ fr: this.placePicked ? "Lieu choisi" : "Ma position", en: this.placePicked ? "Picked place" : "My place" })}</b><span>${latLon(this.place)}</span>`
      : `<b>${tr({ fr: "Hors de la Terre", en: "Off the Earth" })}</b><span>${tr({ fr: "cliquez une carte pour un lieu", en: "click a map for a place" })}</span>`;
    const f = this.els.filters!;
    f.replaceChildren();
    const chip = (label: string, on: boolean, toggle: () => void, cls = "") => {
      const b = h("button", { type: "button", class: `ec-chip${on ? " on" : ""} ${cls}`, "aria-pressed": String(on) }, label);
      b.addEventListener("click", () => {
        toggle();
        this.refresh();
      });
      return b;
    };
    if (this.tab === "earth") {
      for (const x of FILTERS) {
        const c = chip(tr(x.name), this.shown.has(x.key), () => (this.shown.has(x.key) ? this.shown.delete(x.key) : this.shown.add(x.key)));
        c.insertAdjacentHTML("afterbegin", glyph(x.key));
        f.append(c);
      }
      if (this.place)
        f.append(
          chip(tr({ fr: "Visibles d'ici", en: "Seen from here" }), this.hereOnly, () => (this.hereOnly = !this.hereOnly), "ec-here"),
        );
    } else if (this.tab === "moons") {
      for (const p of PLANETS) f.append(chip(tr(p.name), this.planet === p.id, () => (this.planet = p.id)));
      f.append(
        el("span", "ec-note", tr({ fr: "un mois à partir du début (au plus un an)", en: "a month from the start (a year at most)" })),
      );
    } else if (this.tab === "world") {
      for (const w of WORLDS) f.append(chip(bare(w.id), this.world === w.id, () => (this.world = w.id)));
      f.append(
        el("span", "ec-note", tr({ fr: "le Soleil vu de ce monde (deux ans au plus)", en: "the Sun from that world (two years at most)" })),
      );
    } else
      f.append(
        el(
          "span",
          "ec-note",
          tr({ fr: "Mercure et Vénus devant le Soleil, vus de la Terre", en: "Mercury and Venus across the Sun, seen from the Earth" }),
        ),
      );
    void this.search();
  }

  private async search() {
    const job = ++this.job;
    const start = Date.UTC(this.from, 0, 1);
    const kinds: EclipseKind[] =
      this.tab === "earth" ? ["solar", "lunar"] : this.tab === "transits" ? ["transit"] : this.tab === "moons" ? ["phenomena"] : ["world"];
    const end =
      this.tab === "moons"
        ? start + 31 * DAY
        : this.tab === "world"
          ? Math.min(Date.UTC(this.to + 1, 0, 1), start + 2 * 365.25 * DAY)
          : this.tab === "transits"
            ? Date.UTC(Math.max(this.to + 1, this.from + 40), 0, 1)
            : Date.UTC(this.to + 1, 0, 1);
    this.els.status!.textContent = tr({ fr: "Calcul…", en: "Computing…" });
    this.els.list!.classList.add("busy");
    const r = await this.host.search({ from: start, to: end, kinds, planets: [this.planet], world: this.world, place: this.place });
    if (job !== this.job) return;
    this.els.list!.classList.remove("busy");
    if ("error" in r) {
      this.els.status!.textContent = r.error;
      return;
    }
    this.events = r.events;
    this.drawList();
  }

  private visible(): EclipseEvent[] {
    if (this.tab !== "earth") return this.events;
    return this.events.filter((e) => this.shown.has(keyOf(e)) && (!this.hereOnly || e.here?.seen));
  }

  private drawList() {
    const list = this.visible();
    const l = this.els.list!;
    l.replaceChildren();
    this.els.status!.textContent =
      list.length === 0
        ? tr({ fr: "Aucune dans cette période.", en: "None in this span." })
        : tr({ fr: `${list.length} événement${list.length > 1 ? "s" : ""}`, en: `${list.length} event${list.length > 1 ? "s" : ""}` });
    let year = -1;
    for (const e of list) {
      const y = new Date(e.at).getUTCFullYear();
      if (y !== year && this.tab !== "moons") {
        year = y;
        l.append(el("div", "ec-year-head", String(y)));
      }
      const row = h("button", { type: "button", role: "option", class: "ec-row", "data-id": e.id, "data-testid": "ec-row" });
      const here = e.here
        ? e.here.seen
          ? `<i class="ec-seen">${tr({ fr: "visible d'ici", en: "seen from here" })}${e.here.magnitude !== undefined && e.here.magnitude > 0 ? ` · ${num(e.here.magnitude, 2)}` : ""}</i>`
          : `<i class="ec-unseen">${tr({ fr: "pas d'ici", en: "not from here" })}</i>`
        : "";
      const when = e.kind === "solar" || e.kind === "lunar" || e.kind === "world" ? ` · ${fmtTime((e as { t: number }).t)} UTC` : "";
      row.innerHTML = `${glyph(keyOf(e))}<span class="ec-row-t"><b>${titleOf(e)}</b><span>${fmtDate(e.at)}${when}</span><span class="ec-row-s">${subOf(e)}</span>${here}</span>`;
      row.addEventListener("click", () => this.select(e.id));
      l.append(row);
    }
    const sel = list.find((e) => e.id === this.selected) ?? list.find((e) => e.at >= this.host.now()) ?? list[0];
    if (sel) this.select(sel.id);
    else this.els.sheet!.replaceChildren(el("div", "ec-empty", tr({ fr: "Choisissez une période.", en: "Pick a span." })));
  }

  private select(id: string) {
    this.selected = id;
    for (const r of this.els.list!.querySelectorAll<HTMLElement>(".ec-row")) {
      const on = r.dataset.id === id;
      r.classList.toggle("on", on);
      r.setAttribute("aria-selected", String(on));
      if (on) r.scrollIntoView({ block: "nearest" });
    }
    const e = this.events.find((x) => x.id === id);
    if (e) void this.drawSheet(e);
  }

  /** The sheet: the head, the figures, the drawings, the actions. */
  private async drawSheet(e: EclipseEvent) {
    cancelAnimationFrame(this.anim);
    const s = this.els.sheet!;
    s.replaceChildren();
    const head = h("div", { class: "ec-head" });
    head.innerHTML = `${glyph(keyOf(e))}<div><h4>${titleOf(e)}</h4><span>${fmtDate(e.at)}</span></div>`;
    const acts = h(
      "div",
      { class: "ec-acts" },
      button({
        label: tr({ fr: "Aller voir", en: "Go and see" }),
        kind: "primary",
        testid: "ec-go",
        onClick: () => this.host.goSee(e, this.place),
      }),
      button({
        label: tr({ fr: "Demander à TARS", en: "Ask TARS" }),
        testid: "ec-ask",
        onClick: () =>
          this.host.ask(
            tr({
              fr: `Parle-moi de cet événement : ${titleOf(e)}, le ${fmtDate(e.at)} (${e.id}).${this.place ? ` Je suis à ${latLon(this.place)}.` : ""}`,
              en: `Tell me about this event: ${titleOf(e)}, on ${fmtDate(e.at)} (${e.id}).${this.place ? ` I am at ${latLon(this.place)}.` : ""}`,
            }),
          ),
      }),
    );
    head.append(acts);
    s.append(head);
    const figs = h("div", { class: "ec-figs" });
    const fig = (k: Text, v: string) => figs.append(h("div", { class: "ec-fig" }, el("span", "", tr(k)), el("b", "", v)));
    if (e.kind === "solar") {
      fig({ fr: "Maximum", en: "Greatest" }, `${fmtTime(e.t)} UTC`);
      fig({ fr: "Grandeur", en: "Magnitude" }, num(e.magnitude, 4));
      fig({ fr: "Gamma", en: "Gamma" }, num(e.gamma, 4));
      if (e.greatest.duration) fig({ fr: "Durée max.", en: "Max. duration" }, fmtDur(e.greatest.duration));
      if (e.greatest.width) fig({ fr: "Largeur", en: "Path width" }, `${num(e.greatest.width, 0)} km`);
      fig({ fr: "Au maximum", en: "Greatest at" }, latLon(e.greatest));
      fig({ fr: "Saros", en: "Saros" }, String(e.saros));
    } else if (e.kind === "lunar") {
      fig({ fr: "Maximum", en: "Greatest" }, `${fmtTime(e.t)} UTC`);
      fig({ fr: "Grandeur d'ombre", en: "Umbral mag." }, num(e.umbral, 4));
      fig({ fr: "Grandeur pénombre", en: "Penumbral mag." }, num(e.penumbral, 4));
      fig({ fr: "Gamma", en: "Gamma" }, num(e.gamma, 4));
      if (e.total) fig({ fr: "Totalité", en: "Totality" }, fmtDur(e.total));
      if (e.partial) fig({ fr: "Partielle", en: "Partial" }, fmtDur(e.partial));
      fig({ fr: "Saros", en: "Saros" }, String(e.saros));
    } else if (e.kind === "transit") {
      fig({ fr: "Début", en: "Ingress" }, `${fmtTime(e.start)} UTC`);
      fig({ fr: "Maximum", en: "Greatest" }, `${fmtTime(e.t)} UTC`);
      fig({ fr: "Fin", en: "Egress" }, `${fmtTime(e.end)} UTC`);
      fig({ fr: "Durée", en: "Duration" }, fmtDur((e.end - e.start) / 1000));
      fig({ fr: "Plus courte distance", en: "Least separation" }, `${num(e.sep, 0)}″`);
    } else if (e.kind === "phenomenon") {
      fig({ fr: "Phénomène", en: "Phenomenon" }, tr(WHAT_SHORT[e.what]!));
      fig({ fr: "Début", en: "Start" }, `${fmtTime(e.start)} UTC`);
      fig({ fr: "Fin", en: "End" }, `${fmtTime(e.end)} UTC`);
      if (Number.isFinite(e.start) && Number.isFinite(e.end)) fig({ fr: "Durée", en: "Duration" }, fmtDur((e.end - e.start) / 1000));
      s.append(figs);
      s.append(
        el(
          "p",
          "ec-text",
          tr({
            fr: `Vu de la Terre (les instants où sa lumière nous arrive) : ${bare(e.moon)} ${tr(WHAT[e.what]!)} ${bare(e.planet)}. « Aller voir » vous emmène près de ${bare(e.planet)} à ce moment-là.`,
            en: `Seen from the Earth (when its light reaches us): ${bare(e.moon)} ${tr(WHAT[e.what]!)} ${bare(e.planet)}. "Go and see" takes you near ${bare(e.planet)} then.`,
          }),
        ),
      );
      const mid = Number.isFinite(e.start) && Number.isFinite(e.end) ? (e.start + e.end) / 2 : Number.isFinite(e.start) ? e.start : e.end;
      const job = this.job;
      const v = await this.host.moonsView(e.planet, mid);
      if (job !== this.job || this.selected !== e.id || "error" in v) return;
      s.append(this.moonsSvg(e.planet, e.moon, v, mid, e.what));
      return;
    } else {
      const w = e as WorldEclipse;
      fig({ fr: "Début", en: "Start" }, `${fmtTime(w.start)} UTC`);
      fig({ fr: "Maximum", en: "Greatest" }, `${fmtTime(w.t)} UTC`);
      fig({ fr: "Fin", en: "End" }, `${fmtTime(w.end)} UTC`);
      fig({ fr: "Durée", en: "Duration" }, fmtDur((w.end - w.start) / 1000));
      fig({ fr: "Gamma", en: "Gamma" }, num(w.gamma, 3));
      s.append(figs);
      s.append(
        el(
          "p",
          "ec-text",
          tr({
            fr: `Vu de ${nameOf(w.world)}, ${nameOf(w.by)} passe devant le Soleil : son ombre court sur ${nameOf(w.world)}${w.type === "total" ? " — le Soleil y est entièrement caché" : w.type === "annular" ? " — un anneau de Soleil autour d'elle" : ""}.`,
            en: `From ${nameOf(w.world)}, ${nameOf(w.by)} crosses the Sun: its shadow runs over ${nameOf(w.world)}${w.type === "total" ? " — the Sun wholly hidden there" : w.type === "annular" ? " — a ring of Sun round it" : ""}.`,
          }),
        ),
      );
      return;
    }
    s.append(figs);
    const draw = h("div", { class: "ec-draw" }, el("div", "ec-wait", tr({ fr: "Calcul de la carte…", en: "Computing the map…" })));
    s.append(draw);
    const job = this.job;
    const d = await this.host.detail(e as SolarEclipse | LunarEclipse | Transit, this.place);
    if (job !== this.job || this.selected !== e.id) return;
    draw.replaceChildren();
    if ("error" in d) {
      draw.append(el("div", "ec-wait", d.error));
      return;
    }
    if (d.kind === "solar") this.drawSolar(draw, e as SolarEclipse, d);
    else if (d.kind === "lunar") this.drawLunar(draw, e as LunarEclipse, d);
    else draw.append(this.trackSvg(d.track, "transit"));
  }

  /** The globe as a planisphere with the Earth's image (dimmed), its canvas and a click to pick a place. */
  private mapCanvas(paint: (g: CanvasRenderingContext2D, W: number, H: number) => void): HTMLCanvasElement {
    const c = h("canvas", { class: "ec-map", width: "960", height: "480", "data-testid": "ec-map" }) as HTMLCanvasElement;
    const g = c.getContext("2d")!;
    const go = () => {
      g.clearRect(0, 0, 960, 480);
      if (this.earth.complete) g.drawImage(this.earth, 0, 0, 960, 480);
      g.fillStyle = "rgba(4, 8, 16, 0.45)";
      g.fillRect(0, 0, 960, 480);
      paint(g, 960, 480);
      // (the graticule)
      g.strokeStyle = "rgba(160, 210, 255, 0.10)";
      g.lineWidth = 1;
      for (let k = 1; k < 12; k++) {
        g.beginPath();
        g.moveTo((k * 960) / 12, 0);
        g.lineTo((k * 960) / 12, 480);
        g.stroke();
      }
      for (let k = 1; k < 6; k++) {
        g.beginPath();
        g.moveTo(0, (k * 480) / 6);
        g.lineTo(960, (k * 480) / 6);
        g.stroke();
      }
      if (this.place) {
        const [x, y] = this.xy(this.place.lat, this.place.lon, 960, 480);
        g.fillStyle = "#6fd2ff";
        g.strokeStyle = "#04121c";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 6, 0, 2 * Math.PI);
        g.fill();
        g.stroke();
      }
    };
    if (!this.earth.complete) this.earth.addEventListener("load", go, { once: true });
    go();
    c.addEventListener("click", (ev) => {
      const r = c.getBoundingClientRect();
      const lon = ((ev.clientX - r.left) / r.width) * 360 - 180;
      const lat = 90 - ((ev.clientY - r.top) / r.height) * 180;
      this.place = { lat, lon };
      this.placePicked = true;
      this.refresh();
    });
    c.title = tr({ fr: "Cliquez pour voir l'éclipse depuis ce lieu", en: "Click to see the eclipse from this place" });
    return c;
  }

  /** A grid over the globe (w × h cells, the north first) painted smoothed: rgba of each cell. */
  private gridImage(
    g: CanvasRenderingContext2D,
    w: number,
    hh: number,
    W: number,
    H: number,
    rgba: (k: number) => [number, number, number, number],
  ) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = hh;
    const cg = c.getContext("2d")!;
    const img = cg.createImageData(w, hh);
    for (let k = 0; k < w * hh; k++) img.data.set(rgba(k), 4 * k);
    cg.putImageData(img, 0, 0);
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(c, 0, 0, W, H);
    g.restore();
  }

  /** A field's contours over the globe (marching squares, its cells' centres), at the levels given. */
  private contours(g: CanvasRenderingContext2D, w: number, hh: number, W: number, H: number, f: number[], levels: number[], color: string) {
    const cw = W / w,
      ch = H / hh;
    g.strokeStyle = color;
    g.lineWidth = 0.8;
    g.beginPath();
    for (const lv of levels)
      for (let j = 0; j < hh - 1; j++)
        for (let i = 0; i < w - 1; i++) {
          const a = f[j * w + i]!,
            b = f[j * w + i + 1]!,
            c = f[(j + 1) * w + i + 1]!,
            d = f[(j + 1) * w + i]!;
          const pts: [number, number][] = [];
          const cut = (p: number, q: number, x0: number, y0: number, x1: number, y1: number) => {
            if (p >= lv !== q >= lv) {
              const s = (lv - p) / (q - p);
              pts.push([(x0 + (x1 - x0) * s + 0.5) * cw, (y0 + (y1 - y0) * s + 0.5) * ch]);
            }
          };
          cut(a, b, i, j, i + 1, j);
          cut(b, c, i + 1, j, i + 1, j + 1);
          cut(d, c, i, j + 1, i + 1, j + 1);
          cut(a, d, i, j, i, j + 1);
          for (let k = 0; k + 1 < pts.length; k += 2) {
            g.moveTo(...pts[k]!);
            g.lineTo(...pts[k + 1]!);
          }
        }
    g.stroke();
  }

  private xy(lat: number, lon: number, W: number, H: number): [number, number] {
    return [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];
  }

  /** A polyline of [lat, lon] (broken where it crosses ±180°). */
  private line(g: CanvasRenderingContext2D, pts: [number, number][], W: number, H: number) {
    g.beginPath();
    let prev: number | null = null;
    for (const [la, lo] of pts) {
      const [x, y] = this.xy(la, lo, W, H);
      if (prev === null || Math.abs(lo - prev) > 180) g.moveTo(x, y);
      else g.lineTo(x, y);
      prev = lo;
    }
    g.stroke();
  }

  private drawSolar(box: HTMLElement, e: SolarEclipse, d: Extract<EclipseDetail, { kind: "solar" }>) {
    const map = this.mapCanvas((g, W, H) => {
      // (the partial zones: the greatest magnitude, smoothed — amber to red as it deepens — and its
      // contours every 0.2)
      const { w, h: hh, mag } = d.map;
      this.gridImage(g, w, hh, W, H, (k) => {
        const m = mag[k]!;
        return m <= 0 ? [0, 0, 0, 0] : [255, 200 - 130 * Math.min(m, 1), 90 - 70 * Math.min(m, 1), 40 + 120 * Math.min(m, 1)];
      });
      this.contours(g, w, hh, W, H, mag, [0.2, 0.4, 0.6, 0.8], "rgba(255, 220, 160, 0.55)");
      // (the central path: between its limits, dark, outlined; its line red)
      const { centre, north, south } = d.path;
      if (north.length > 1 && south.length > 1) {
        const wraps = (a: [number, number][]) => a.some((p, i) => i > 0 && Math.abs(p[1] - a[i - 1]![1]) > 180);
        if (!wraps(north) && !wraps(south)) {
          g.beginPath();
          north.forEach(([la, lo], i) => {
            const [x, y] = this.xy(la, lo, W, H);
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          });
          for (const [la, lo] of [...south].reverse()) g.lineTo(...this.xy(la, lo, W, H));
          g.closePath();
          g.fillStyle = "rgba(6, 8, 14, 0.62)";
          g.fill();
        }
        g.lineWidth = 1.2;
        g.strokeStyle = "rgba(255, 255, 255, 0.9)";
        this.line(g, north, W, H);
        this.line(g, south, W, H);
        g.strokeStyle = "#ff5a46";
        g.lineWidth = 1.6;
        this.line(g, centre, W, H);
      }
      const [x, y] = this.xy(e.greatest.lat, e.greatest.lon, W, H);
      g.fillStyle = "#ffd27a";
      g.font = "bold 16px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("✶", x, y);
    });
    const legend = h("div", { class: "ec-legend" });
    legend.innerHTML = `<span><i class="sw band"></i>${tr({ fr: "partielle (grandeur 0,2 à 1)", en: "partial (magnitude 0.2 to 1)" })}</span><span><i class="sw path"></i>${tr({ fr: e.type === "annular" ? "bande d'annularité" : "bande de totalité", en: e.type === "annular" ? "path of annularity" : "path of totality" })}</span><span><i class="sw star">✶</i>${tr({ fr: "maximum", en: "greatest" })}</span><span><i class="sw here"></i>${tr({ fr: "lieu (cliquez la carte)", en: "place (click the map)" })}</span>`;
    box.append(map, legend);
    if (!d.here) return;
    const here = d.here;
    const block = h("div", { class: "ec-here-block" });
    const kind = {
      total: { fr: "TOTALE ici", en: "TOTAL here" },
      annular: { fr: "ANNULAIRE ici", en: "ANNULAR here" },
      partial: { fr: "partielle ici", en: "partial here" },
      none: { fr: "pas visible ici", en: "not seen here" },
    }[here.type];
    const rows = here.contacts
      .concat([{ name: "max", t: here.max }])
      .sort((a, b) => a.t - b.t)
      .map((c) => {
        const alt = here.sunAlts.find((a) => a.name === c.name)?.alt ?? 0;
        const label = {
          C1: { fr: "1er contact", en: "1st contact" },
          C2: { fr: "début central", en: "2nd contact" },
          C3: { fr: "fin centrale", en: "3rd contact" },
          C4: { fr: "dernier contact", en: "4th contact" },
          max: { fr: "maximum", en: "greatest" },
        }[c.name] ?? { fr: c.name, en: c.name };
        return `<tr class="${alt < 0 ? "below" : ""}"><td>${tr(label)}</td><td>${fmtTime(c.t)} UTC</td><td>${tr({ fr: "Soleil", en: "Sun" })} ${deg(alt)}</td></tr>`;
      })
      .join("");
    block.innerHTML = `<div class="ec-here-h"><b class="${here.type}">${tr(kind)}</b><span>${tr({ fr: "grandeur", en: "magnitude" })} ${num(here.magnitude, 3)} · ${tr({ fr: "obscuration", en: "obscuration" })} ${num(here.obscuration * 100, 1)} %${here.type === "total" || here.type === "annular" ? ` · ${fmtDur(((here.contacts.find((c) => c.name === "C3")?.t ?? 0) - (here.contacts.find((c) => c.name === "C2")?.t ?? 0)) / 1000)}` : ""}</span></div><table class="ec-contacts">${rows}</table>`;
    const wrap = h("div", { class: "ec-here-wrap" }, block);
    if (here.track) wrap.prepend(this.trackSvg(here.track, "solar"));
    box.append(wrap);
  }

  /** A body's way across a disc (the Moon over the Sun, a planet over it), scrubbed by a slider, played. */
  private trackSvg(tr0: SkyTrack, what: "solar" | "transit"): HTMLElement {
    const S = 120;
    const span = Math.max(1.8, ...tr0.x.map((x, i) => Math.hypot(x, tr0.y[i]!) + tr0.k));
    const sc = S / span;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `${-S} ${-S} ${2 * S} ${2 * S}`);
    svg.setAttribute("class", "ec-track");
    const path = tr0.x.map((x, i) => `${i ? "L" : "M"}${(-x * sc).toFixed(1)} ${(-tr0.y[i]! * sc).toFixed(1)}`).join("");
    svg.innerHTML = `<defs><radialGradient id="ec-tsun"><stop offset="0" stop-color="#fff8e2"/><stop offset=".8" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff9a3a"/></radialGradient><radialGradient id="ec-tcor"><stop offset=".5" stop-color="#d8ecff" stop-opacity=".5"/><stop offset="1" stop-color="#d8ecff" stop-opacity="0"/></radialGradient></defs><circle class="cor" r="${(2.2 * sc).toFixed(1)}" fill="url(#ec-tcor)" opacity="0"/><circle r="${sc.toFixed(1)}" fill="url(#ec-tsun)"/><path d="${path}" class="way"/><circle class="body" r="${Math.max(tr0.k * sc, 2.2).toFixed(1)}"/><text class="lab" x="${(-S + 6).toFixed(0)}" y="${(-S + 16).toFixed(0)}">N ↑ · E ←</text>`;
    const body = svg.querySelector<SVGCircleElement>(".body")!;
    const cor = svg.querySelector<SVGCircleElement>(".cor")!;
    const slider = h("input", {
      type: "range",
      min: "0",
      max: String(tr0.t.length - 1),
      step: "1",
      class: "ec-slider",
      "aria-label": tr({ fr: "Instant", en: "Moment" }),
    }) as HTMLInputElement;
    const read = el("div", "ec-read");
    const set = (i: number) => {
      const x = tr0.x[i]!,
        y = tr0.y[i]!;
      body.setAttribute("cx", (-x * sc).toFixed(1));
      body.setAttribute("cy", (-y * sc).toFixed(1));
      const sep = Math.hypot(x, y);
      const ob = what === "solar" ? hidden(tr0.k, sep) : 0;
      cor.setAttribute("opacity", ob > 0.999 ? "1" : "0");
      read.textContent = `${fmtTime(tr0.t[i]!)} UTC${what === "solar" ? ` · ${tr({ fr: "obscuration", en: "obscuration" })} ${num(ob * 100, 1)} %` : ""}`;
    };
    // (from the greatest: the nearest point)
    let i0 = 0;
    tr0.x.forEach((x, i) => Math.hypot(x, tr0.y[i]!) < Math.hypot(tr0.x[i0]!, tr0.y[i0]!) && (i0 = i));
    slider.value = String(i0);
    set(i0);
    slider.addEventListener("input", () => set(Number(slider.value)));
    let playing = false;
    const play = button({
      label: "▶",
      title: tr({ fr: "Jouer", en: "Play" }),
      onClick: () => {
        playing = !playing;
        if (!playing) return cancelAnimationFrame(this.anim);
        let i = Number(slider.value) >= tr0.t.length - 1 ? 0 : Number(slider.value);
        let last = 0;
        const step = (now: number) => {
          if (!playing) return;
          if (now - last > 60) {
            last = now;
            slider.value = String(i);
            set(i);
            if (++i >= tr0.t.length) return void (playing = false);
          }
          this.anim = requestAnimationFrame(step);
        };
        this.anim = requestAnimationFrame(step);
      },
    });
    return h("div", { class: "ec-trackbox" }, svg as unknown as HTMLElement, h("div", { class: "ec-scrub" }, play, slider), read);
  }

  private drawLunar(box: HTMLElement, e: LunarEclipse, d: Extract<EclipseDetail, { kind: "lunar" }>) {
    box.append(this.shadowSvg(d.diagram, e));
    const map = this.mapCanvas((g, W, H) => {
      const { w, h: hh, alt, altStart, altEnd } = d.map;
      this.gridImage(g, w, hh, W, H, (k) => {
        const all = alt[k]! > 0 && altStart[k]! > 0 && altEnd[k]! > 0;
        const some = alt[k]! > 0 || altStart[k]! > 0 || altEnd[k]! > 0;
        return all ? [255, 120, 70, 80] : some ? [255, 170, 110, 34] : [0, 0, 0, 120];
      });
    });
    const legend = h("div", { class: "ec-legend" });
    legend.innerHTML = `<span><i class="sw all"></i>${tr({ fr: "visible du début à la fin", en: "seen from start to end" })}</span><span><i class="sw some"></i>${tr({ fr: "au lever ou au coucher de la Lune", en: "at moonrise or moonset" })}</span><span><i class="sw none"></i>${tr({ fr: "invisible", en: "not seen" })}</span>`;
    box.append(map, legend);
    if (d.here) {
      const rows = d.here
        .map((c) => {
          const label = {
            P1: { fr: "entrée pénombre", en: "penumbra in" },
            U1: { fr: "entrée ombre", en: "umbra in" },
            U2: { fr: "début totalité", en: "totality begins" },
            max: { fr: "maximum", en: "greatest" },
            U3: { fr: "fin totalité", en: "totality ends" },
            U4: { fr: "sortie ombre", en: "umbra out" },
            P4: { fr: "sortie pénombre", en: "penumbra out" },
          }[c.name] ?? { fr: c.name, en: c.name };
          return `<tr class="${c.moonAlt < 0 ? "below" : ""}"><td>${tr(label)}</td><td>${fmtTime(c.t)} UTC</td><td>${tr({ fr: "Lune", en: "Moon" })} ${deg(c.moonAlt)}</td><td>${tr({ fr: "Soleil", en: "Sun" })} ${deg(c.sunAlt)}</td></tr>`;
        })
        .join("");
      const block = h("div", { class: "ec-here-block" });
      const up = d.here.some((c) => c.moonAlt > 0);
      block.innerHTML = `<div class="ec-here-h"><b class="${up ? "partial" : "none"}">${tr(up ? { fr: "visible ici (Lune levée)", en: "seen here (Moon up)" } : { fr: "pas visible ici", en: "not seen here" })}</b></div><table class="ec-contacts">${rows}</table>`;
      box.append(block);
    }
  }

  /** A planet and its moons as seen from the Earth (north up, east left): the one in the event marked, its
   *  shadow's side shown. */
  private moonsSvg(planet: string, moon: string, v: MoonsView, t: number, what = ""): HTMLElement {
    const span = Math.max(4, ...v.moons.map((m) => Math.abs(m.x) + 1.5));
    const W = 520,
      H = 160;
    const sc = W / 2 / span;
    // (the shadow as seen: foreshortened by the phase — behind the planet at opposition)
    const L = Math.min(W, sc * 80 * Math.sin((v.phase * Math.PI) / 180));
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `${-W / 2} ${-H / 2} ${W} ${H}`);
    svg.setAttribute("class", "ec-moons");
    const bands = [-0.55, -0.25, 0.1, 0.4]
      .map(
        (y) =>
          `<rect x="${-sc}" y="${(y * sc).toFixed(1)}" width="${2 * sc}" height="${(0.12 * sc).toFixed(1)}" fill="rgba(150, 100, 60, 0.35)"/>`,
      )
      .join("");
    const dots = v.moons
      .filter((m) => Math.abs(m.y) * sc < H / 2 && Math.abs(m.x) * sc < W / 2)
      .map((m) => {
        const x = -m.x * sc,
          y = -m.y * sc;
        const hidden = !m.front && Math.hypot(m.x, m.y) < 1;
        const on = m.id === moon;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(m.r * sc, on ? 3.4 : 2.6).toFixed(1)}" class="${on ? "mn on" : "mn"}${hidden ? " hid" : ""}${on && what === "ecl" ? " ecl" : ""}"/><text x="${x.toFixed(1)}" y="${(y + (on ? 16 : -8)).toFixed(1)}" class="${on ? "lab on" : "lab"}">${bare(m.id)}</text>`;
      })
      .join("");
    svg.innerHTML = `<defs><clipPath id="ec-pl"><circle r="${sc.toFixed(1)}"/></clipPath><radialGradient id="ec-plg"><stop offset="0" stop-color="#f1e2c4"/><stop offset="1" stop-color="#b98f62"/></radialGradient></defs><path d="M0 0L${(-v.shadow.x * L).toFixed(0)} ${(-v.shadow.y * L).toFixed(0)}" class="shadow" style="stroke-width:${(2 * sc).toFixed(0)}"/><circle r="${sc.toFixed(1)}" fill="url(#ec-plg)"/><g clip-path="url(#ec-pl)">${bands}</g>${dots}<text x="${(-W / 2 + 6).toFixed(0)}" y="${(-H / 2 + 14).toFixed(0)}" class="lab start">N ↑ · E ← · ${fmtTime(t)} UTC · ${tr({ fr: "vu de la Terre", en: "seen from the Earth" })}</text>`;
    return h(
      "div",
      { class: "ec-moonsbox" },
      svg as unknown as HTMLElement,
      el(
        "div",
        "ec-read",
        tr({
          fr: `${bare(planet)} et ses lunes · l'ombre portée du côté opposé au Soleil`,
          en: `${bare(planet)} and its moons · its shadow cast away from the Sun`,
        }),
      ),
    );
  }

  /** The Earth's shadow at the Moon (penumbra, umbra) and the Moon's way through it, scrubbed. */
  private shadowSvg(dg: ShadowDiagram, e: LunarEclipse): HTMLElement {
    const S = 140;
    const sc = S / (dg.pen + 1.6);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `${-S} ${-S} ${2 * S} ${2 * S}`);
    svg.setAttribute("class", "ec-shadow");
    const way = dg.x.map((x, i) => `${i ? "L" : "M"}${(-x * sc).toFixed(1)} ${(-dg.y[i]! * sc).toFixed(1)}`).join("");
    const marks = e.contacts
      .map((c) => {
        let i = 0;
        dg.t.forEach((t, k) => Math.abs(t - c.t) < Math.abs(dg.t[i]! - c.t) && (i = k));
        return `<circle class="mark" cx="${(-dg.x[i]! * sc).toFixed(1)}" cy="${(-dg.y[i]! * sc).toFixed(1)}" r="${sc.toFixed(1)}"/><text class="lab" x="${(-dg.x[i]! * sc).toFixed(1)}" y="${(-dg.y[i]! * sc - sc - 4).toFixed(1)}">${c.name}</text>`;
      })
      .join("");
    svg.innerHTML = `<defs><radialGradient id="ec-umb"><stop offset="0" stop-color="#5a1408"/><stop offset=".85" stop-color="#8a2a12"/><stop offset="1" stop-color="#3a6f7a"/></radialGradient></defs><circle r="${(dg.pen * sc).toFixed(1)}" class="pen"/><circle r="${(dg.umbra * sc).toFixed(1)}" fill="url(#ec-umb)"/><path d="${way}" class="way"/>${marks}<circle class="moon" r="${sc.toFixed(1)}"/><text class="lab" x="${(-S + 6).toFixed(0)}" y="${(-S + 16).toFixed(0)}">N ↑ · E ←</text>`;
    const moon = svg.querySelector<SVGCircleElement>(".moon")!;
    const slider = h("input", {
      type: "range",
      min: "0",
      max: String(dg.t.length - 1),
      step: "1",
      class: "ec-slider",
      "aria-label": tr({ fr: "Instant", en: "Moment" }),
    }) as HTMLInputElement;
    const read = el("div", "ec-read");
    const set = (i: number) => {
      moon.setAttribute("cx", (-dg.x[i]! * sc).toFixed(1));
      moon.setAttribute("cy", (-dg.y[i]! * sc).toFixed(1));
      const r = Math.hypot(dg.x[i]!, dg.y[i]!);
      const depth = Math.min(Math.max((dg.umbra + 1 - r) / 2, 0), 1);
      moon.style.fill =
        depth >= 1
          ? "#a8381a"
          : depth > 0
            ? `rgb(${200 - depth * 40}, ${196 - depth * 120}, ${189 - depth * 150})`
            : r < dg.pen + 1
              ? "#a9a69f"
              : "#d9d6cd";
      read.textContent = `${fmtTime(dg.t[i]!)} UTC`;
    };
    let i0 = 0;
    dg.t.forEach((t, k) => Math.abs(t - e.t) < Math.abs(dg.t[i0]! - e.t) && (i0 = k));
    slider.value = String(i0);
    set(i0);
    slider.addEventListener("input", () => set(Number(slider.value)));
    return h("div", { class: "ec-trackbox" }, svg as unknown as HTMLElement, h("div", { class: "ec-scrub" }, slider), read);
  }
}
