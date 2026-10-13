// The Atlas (PLAN-MODES-AAA M6): the Earth, the Moon and Mars as maps, their destinations, the addresses — and the
// game put there. A full page: the worlds' tabs, the search (the destinations by name, the Earth's addresses through
// Photon — game/geocode.ts —, coordinates typed), the kinds to show, the results; the map (ui/mapview.ts) with the
// graticule, the night, the destinations, the landing sites, the landscapes' viewpoints, where the craft, the
// walker and the camera are; a place picked (a mark, or anywhere on the map): its card, and what to do there — in
// orbit over it, the craft set down on it, walk there, the free camera above it, a tripod on it.

import "./atlas.css";
import { compassPoint, fmtLatLon, greatCircle, POINTS } from "../game/geo";
import { geocode, parseCoords, type GeoPlace } from "../game/geocode";
import { isNight, terminatorLat } from "../game/mapproj";
import { POI_KINDS, POIS, searchPois, type Poi, type PoiKind } from "../game/pois";
import { t, tf, tr, type Text } from "../i18n";
import { button, el, h, modal } from "./kit";
import { MapView, type MapBody, type ToScreen } from "./mapview";

export type AtlasAction = "orbit" | "land" | "walk" | "camera" | "tripod";
export const ATLAS_ACTIONS: AtlasAction[] = ["orbit", "land", "walk", "camera", "tripod"];

/** A place of the Atlas: a destination, a landing site, a viewpoint, an address, a point picked. */
export interface AtlasPlace {
  body: MapBody;
  lat: number;
  lon: number;
  name: string;
  detail?: string;
  kind?: string;
  elevM?: number;
  /** a landscape's viewpoint: its scene (the photograph's view, its date and lens) */
  scene?: string;
}

/** A mark of another source: the landing sites, the landscapes' viewpoints (main.ts gives them). */
export interface AtlasMark extends AtlasPlace {
  /** "site": a runway or a pad; "view": a landscape's viewpoint */
  source: "site" | "view";
}

export interface AtlasHost {
  lang(): "fr" | "en";
  /** the subsolar point on a world now (the night drawn), or null */
  subsolar(body: MapBody): { lat: number; lon: number } | null;
  /** where the craft, the walker and the camera are (on our worlds) */
  here(): { body: string; lat: number; lon: number; who: "craft" | "walker" | "camera" }[];
  /** the landing sites and the viewpoints */
  marks(): AtlasMark[];
  /** the game put at a place: why not, or null */
  go(to: AtlasAction, p: AtlasPlace): string | null;
  /** a mission running (it ends: asked first) */
  mission(): string | null;
  /** TARS asked about a place */
  ask?(q: string): void;
  /** a landscape's scene opened (its view as photographed) */
  view?(scene: string): void;
}

const BODIES: { id: MapBody; name: Text }[] = [
  { id: "earth", name: { fr: "Terre", en: "Earth" } },
  { id: "moon", name: { fr: "Lune", en: "Moon" } },
  { id: "mars", name: { fr: "Mars", en: "Mars" } },
];
const RADIUS_M: Record<MapBody, number> = { earth: 6_371_000, moon: 1_737_400, mars: 3_389_500 };

/** Each kind's colour on the map. */
const KIND_COL: Record<PoiKind | "site" | "view" | "address" | "point", string> = {
  launch: "#ff8a5c",
  landmark: "#ffd36b",
  summit: "#e9f2ff",
  nature: "#7be08f",
  observatory: "#b49cff",
  city: "#ffb35c",
  pole: "#9fe3ff",
  landing: "#ffd36b",
  crater: "#d8c7a8",
  sea: "#8fb2d9",
  volcano: "#ff6a4d",
  canyon: "#e0a070",
  site: "#6fd2ff",
  view: "#ff8ce6",
  address: "#ff5a46",
  point: "#ffffff",
};

const ACTION_TEXT: Record<AtlasAction, { label: Text; tip: Text }> = {
  orbit: {
    label: { fr: "En orbite au-dessus", en: "In orbit over it" },
    tip: { fr: "Le vaisseau sur une orbite qui passe au-dessus, maintenant", en: "The craft on an orbit passing over it, now" },
  },
  land: {
    label: { fr: "Y poser le vaisseau", en: "Set the craft down" },
    tip: { fr: "Le vaisseau posé sur le sol, là", en: "The craft landed on the ground there" },
  },
  walk: {
    label: { fr: "Y marcher", en: "Walk there" },
    tip: { fr: "Le vaisseau posé, et vous à pied à côté", en: "The craft landed, and you on foot beside it" },
  },
  camera: {
    label: { fr: "Caméra libre au-dessus", en: "Free camera above" },
    tip: { fr: "La caméra libre au-dessus, regardant le lieu", en: "The free camera above it, looking at the place" },
  },
  tripod: {
    label: { fr: "Trépied sur place", en: "Tripod there" },
    tip: { fr: "La caméra posée sur son trépied, au sol, là", en: "The camera on its tripod, on the ground there" },
  },
};

export class AtlasPage {
  private close: (() => void) | null = null;
  private map = new MapView();
  private body: MapBody = "earth";
  private kinds = new Set<PoiKind | "site" | "view">([...(Object.keys(POI_KINDS) as PoiKind[]), "site", "view"]);
  private query = "";
  private found: GeoPlace[] = [];
  private searching: AbortController | null = null;
  private selected: AtlasPlace | null = null;
  private confirmEnd = false;
  private layers = { grid: true, night: true, names: true };
  private list = el("ol", "at-list");
  private card = el("section", "at-card");
  private input = h("input", { class: "at-input", type: "search", "data-testid": "atlas-search" }) as HTMLInputElement;
  private tabs = new Map<MapBody, HTMLButtonElement>();
  private chips = el("div", "at-kinds");
  private cursor = el("div", "at-cursor");
  private attrib = el("div", "at-attrib");
  private status = el("div", "at-status");

  constructor(private d: AtlasHost) {
    this.map.overlay = (ctx, to, W, H) => this.drawOverlay(ctx, to, W, H);
    this.map.night = (ctx, to, W, H) => this.nightPath(ctx, to, W, H);
    this.map.onPick = (lat, lon) => this.pick(lat, lon);
    this.map.canvas.addEventListener("pointermove", (e) => {
      const r = this.map.canvas.getBoundingClientRect();
      const [lat, lon] = this.map.placeAt(e.clientX - r.left, e.clientY - r.top);
      this.cursor.textContent = fmtLatLon(lat, lon, 4, [t("N"), t("S"), t("E"), t("W")]);
    });
  }

  get isOpen() {
    return !!this.close;
  }

  /** Opened on a world (by default the one the game is on), a search typed, a place selected. */
  open(o: { body?: MapBody; query?: string; place?: AtlasPlace } = {}) {
    if (this.close) this.hide();
    this.selected = null;
    this.found = [];
    const here = this.d.here();
    const body = o.place?.body ?? o.body ?? ((here[0]?.body as MapBody) || "earth");
    const tabs = el("div", "at-bodies");
    tabs.setAttribute("role", "tablist");
    for (const b of BODIES) {
      const btn = button({ label: tr(b.name), testid: `atlas-body-${b.id}`, onClick: () => this.setBody(b.id) });
      btn.setAttribute("role", "tab");
      this.tabs.set(b.id, btn);
      tabs.append(btn);
    }
    this.input.placeholder = t("A destination, an address, coordinates…");
    this.input.value = o.query ?? "";
    this.input.oninput = () => this.search(this.input.value);
    this.input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = this.list.querySelector("button") as HTMLButtonElement | null;
        // (nothing found as one typed: Enter asks again, OpenStreetMap's Nominatim too)
        if (first) first.click();
        else this.search(this.input.value, true);
      }
    };
    const side = h(
      "aside",
      { class: "at-side" },
      tabs,
      h("label", { class: "at-searchbox" }, this.input),
      this.chips,
      this.list,
      this.card,
    );
    const tools = el("div", "at-tools");
    const tool = (label: string, tip: string, fn: () => void, testid?: string) => {
      const b = button({ label, title: tip, testid, onClick: fn });
      b.classList.add("at-tool");
      tools.append(b);
      return b;
    };
    tool("+", t("Zoom in"), () => this.map.zoomAbout(1, this.map.canvas.clientWidth / 2, this.map.canvas.clientHeight / 2));
    tool("−", t("Zoom out"), () => this.map.zoomAbout(-1, this.map.canvas.clientWidth / 2, this.map.canvas.clientHeight / 2));
    tool("◎", t("Where I am"), () => this.centreOnMe(), "atlas-here");
    for (const [k, label] of [
      ["grid", t("Grid")],
      ["night", t("Night")],
      ["names", t("Names")],
    ] as const) {
      const b = tool(label, label, () => {
        this.layers[k] = !this.layers[k];
        b.classList.toggle("on", this.layers[k]);
        this.map.request();
      });
      b.classList.toggle("on", this.layers[k]);
    }
    const mapBox = h("div", { class: "at-map" }, this.map.canvas, tools, this.cursor, this.attrib, this.status);
    const root = h("div", { class: "at" }, side, mapBox);
    const m = modal({ title: t("Atlas"), body: [root], cls: "at-frame", testid: "atlas", onClose: () => this.dispose() });
    this.close = m.close;
    this.setBody(body, false);
    if (o.place) this.select(o.place, true);
    else {
      const me = here.find((p) => p.body === body);
      if (me) this.map.flyTo(me.lat, me.lon, this.body === "earth" ? 5 : 3, 10);
    }
    if (o.query) this.search(o.query, true);
    this.input.focus();
  }

  hide() {
    this.close?.();
  }

  private dispose() {
    this.close = null;
    this.searching?.abort();
    this.tabs.clear();
  }

  private setBody(b: MapBody, fit = true) {
    this.body = b;
    for (const [k, btn] of this.tabs) {
      btn.classList.toggle("on", k === b);
      btn.setAttribute("aria-selected", String(k === b));
    }
    this.map.setBody(b);
    this.attrib.textContent =
      b === "earth"
        ? "NASA GIBS Blue Marble · EOX Sentinel-2 cloudless 2021 (CC BY-NC-SA 4.0) · © OpenStreetMap — Photon, Nominatim"
        : b === "moon"
          ? "NASA LRO LROC WAC · LOLA"
          : "NASA Viking MDIM · MGS MOLA";
    if (fit && this.selected && this.selected.body !== b) this.selected = null;
    this.fillChips();
    this.fillList();
    this.fillCard();
  }

  private fillChips() {
    const present = new Set<string>([
      ...POIS.filter((p) => p.body === this.body).map((p) => p.kind),
      ...this.d
        .marks()
        .filter((m) => m.body === this.body)
        .map((m) => m.source),
    ]);
    this.chips.replaceChildren();
    const names: Record<string, Text> = {
      ...POI_KINDS,
      site: { fr: "Pistes et sites", en: "Runways and sites" },
      view: { fr: "Points de vue", en: "Viewpoints" },
    };
    for (const k of Object.keys(names) as (PoiKind | "site" | "view")[]) {
      if (!present.has(k)) continue;
      const b = el("button", "at-chip");
      b.type = "button";
      b.append(el("i", ""), el("span", "", tr(names[k]!)));
      (b.firstChild as HTMLElement).style.background = KIND_COL[k];
      b.classList.toggle("on", this.kinds.has(k));
      b.onclick = () => {
        if (this.kinds.has(k)) this.kinds.delete(k);
        else this.kinds.add(k);
        b.classList.toggle("on", this.kinds.has(k));
        this.fillList();
        this.map.request();
      };
      this.chips.append(b);
    }
  }

  /** The destinations and marks shown on this world (their kinds on). */
  private visible(): AtlasPlace[] {
    const lang = this.d.lang();
    const pois: AtlasPlace[] = POIS.filter((p) => p.body === this.body && this.kinds.has(p.kind)).map((p) => this.ofPoi(p, lang));
    const marks = this.d.marks().filter((m) => m.body === this.body && this.kinds.has(m.source));
    return [...pois, ...marks.map((m) => ({ ...m, kind: m.source }))];
  }

  private ofPoi(p: Poi, lang: "fr" | "en"): AtlasPlace {
    return { body: p.body, lat: p.lat, lon: p.lon, name: p.name[lang], detail: p.about[lang], kind: p.kind, elevM: p.elevM };
  }

  /**
   * The search: the destinations at once; the Earth's addresses as one types (a second at most between two) —
   * Photon only; `explicit` (Enter, a search given): at once, Nominatim when Photon finds nothing.
   */
  private search(q: string, explicit = false) {
    this.query = q;
    this.searching?.abort();
    this.found = [];
    this.fillList();
    const words = q.trim();
    if (this.body !== "earth" || words.length < 3 || parseCoords(words)) return;
    const ctl = new AbortController();
    this.searching = ctl;
    this.status.textContent = t("Searching the addresses…");
    const centre = this.map.placeAt(this.map.canvas.clientWidth / 2, this.map.canvas.clientHeight / 2);
    // (typing: the request waits for a pause)
    setTimeout(
      () => {
        if (ctl.signal.aborted) return;
        const near = { lat: centre[0], lon: centre[1] };
        void geocode(words, { lang: this.d.lang(), near, signal: ctl.signal, fallback: explicit }).then((r) => {
          if (ctl.signal.aborted) return;
          this.found = r;
          this.status.textContent = r.length ? "" : t("No address found");
          this.fillList();
          this.map.request();
        });
      },
      explicit ? 0 : 350,
    );
  }

  private fillList() {
    const lang = this.d.lang();
    const q = this.query.trim();
    const rows: { place: AtlasPlace; col: string; sub: string }[] = [];
    const coords = q ? parseCoords(q) : null;
    if (coords)
      rows.push({
        place: { body: this.body, ...coords, name: fmtLatLon(coords.lat, coords.lon, 4), kind: "point" },
        col: KIND_COL.point,
        sub: t("Coordinates"),
      });
    const marks = this.d.marks().filter((m) => m.body === this.body);
    const markHits = q
      ? marks.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()))
      : marks.filter((m) => this.kinds.has(m.source));
    for (const p of searchPois(q, POIS, this.body).filter((p) => q || this.kinds.has(p.kind)))
      rows.push({ place: this.ofPoi(p, lang), col: KIND_COL[p.kind], sub: tr(POI_KINDS[p.kind]) });
    for (const m of markHits)
      rows.push({
        place: { ...m, kind: m.source },
        col: KIND_COL[m.source],
        sub: m.source === "site" ? t("Runway or site") : t("Viewpoint"),
      });
    for (const g of this.found)
      rows.push({
        place: { body: "earth", lat: g.lat, lon: g.lon, name: g.name, detail: g.detail, kind: "address" },
        col: KIND_COL.address,
        sub: g.detail || g.kind,
      });
    this.list.replaceChildren();
    for (const r of rows.slice(0, 80)) {
      const b = el("button", "at-item");
      b.type = "button";
      const dot = el("i", "");
      dot.style.background = r.col;
      b.append(dot, h("span", { class: "at-item-text" }, el("b", "", r.place.name), el("small", "", r.sub)));
      b.onclick = () => this.select(r.place, true);
      if (this.selected && this.selected.name === r.place.name && this.selected.lat === r.place.lat) b.classList.add("on");
      const li = el("li", "");
      li.append(b);
      this.list.append(li);
    }
    if (!rows.length && q) this.list.append(h("li", { class: "at-none" }, t("Nothing by that name here")));
  }

  /** A place selected: the map flown to it, its card. */
  select(p: AtlasPlace, fly = false) {
    if (p.body !== this.body) this.setBody(p.body);
    this.selected = p;
    this.confirmEnd = false;
    if (fly) this.map.flyTo(p.lat, p.lon, Math.max(this.map.zoom, p.body === "earth" ? 9 : 4));
    this.fillCard();
    this.fillList();
    this.map.request();
  }

  /** A click on the map: the mark under it, else the place itself. */
  private pick(lat: number, lon: number) {
    const [px, py] = this.map.toScreen(lat, lon);
    let best: AtlasPlace | null = null,
      bd = 12;
    for (const p of this.visible()) {
      const [x, y] = this.map.toScreen(p.lat, p.lon);
      const d = Math.hypot(x - px, y - py);
      if (d < bd) [bd, best] = [d, p];
    }
    for (const g of this.found) {
      const [x, y] = this.map.toScreen(g.lat, g.lon);
      const d = Math.hypot(x - px, y - py);
      if (d < bd) [bd, best] = [d, { body: "earth", lat: g.lat, lon: g.lon, name: g.name, detail: g.detail, kind: "address" }];
    }
    this.select(best ?? { body: this.body, lat, lon, name: fmtLatLon(lat, lon, 4), kind: "point" });
  }

  private centreOnMe() {
    const me = this.d.here().filter((p) => p.body === this.body);
    if (me.length) this.map.flyTo(me[0]!.lat, me[0]!.lon, Math.max(this.map.zoom, this.body === "earth" ? 8 : 4));
    else this.status.textContent = t("You are not on this world");
  }

  private fillCard() {
    const p = this.selected;
    this.card.replaceChildren();
    this.card.hidden = !p;
    if (!p) return;
    const lines: (Node | null)[] = [
      el("h3", "at-card-title", p.name),
      p.detail ? el("p", "at-card-about", p.detail) : null,
      el(
        "p",
        "at-card-place",
        `${fmtLatLon(p.lat, p.lon, 4, [t("N"), t("S"), t("E"), t("W")])}${p.elevM !== undefined ? ` · ${Math.round(p.elevM).toLocaleString("en-US").replace(/,/g, " ")} m` : ""}`,
      ),
    ];
    // (how far the craft or the walker is, and which way)
    const me = this.d.here().find((h) => h.body === p.body);
    if (me) {
      const g = greatCircle(me.lat, me.lon, p.lat, p.lon, RADIUS_M[p.body]);
      const d =
        g.dist < 1000
          ? `${Math.round(g.dist)} m`
          : `${(g.dist / 1000).toLocaleString("en-US", { maximumFractionDigits: g.dist < 1e5 ? 1 : 0 }).replace(/,/g, " ")} km`;
      lines.push(
        el(
          "p",
          "at-card-dist",
          tf(
            "{0} from you, towards {1}",
            d,
            compassPoint(
              g.bearingDeg,
              POINTS.map((x) => t(x)),
            ),
          ),
        ),
      );
    }
    const sun = this.d.subsolar(p.body);
    if (sun) lines.push(el("p", "at-card-sun", isNight(p.lat, p.lon, sun.lat, sun.lon) ? t("Night there now") : t("Day there now")));
    const acts = el("div", "at-actions");
    const mission = this.d.mission();
    if (p.scene && this.d.view)
      acts.append(
        button({
          label: t("This view, as photographed"),
          kind: "primary",
          testid: "atlas-view",
          onClick: () => {
            this.d.view!(p.scene!);
            this.hide();
          },
        }),
      );
    for (const a of ATLAS_ACTIONS) {
      const b = button({
        label: tr(ACTION_TEXT[a].label),
        title: tr(ACTION_TEXT[a].tip),
        kind: a === "walk" ? "primary" : "plain",
        testid: `atlas-go-${a}`,
        onClick: () => {
          // (a mission running ends: said first, a second click goes)
          if (mission && !this.confirmEnd && a !== "camera" && a !== "tripod") {
            this.confirmEnd = true;
            this.status.textContent = tf("This ends the mission “{0}” — click again", mission);
            return;
          }
          const why = this.d.go(a, p);
          if (why) this.status.textContent = why;
          else this.hide();
        },
      });
      acts.append(b);
    }
    if (this.d.ask)
      acts.append(
        button({
          label: t("Ask TARS"),
          testid: "atlas-ask",
          onClick: () => {
            this.d.ask!(
              tf("Tell me about {0} ({1}, {2} on {3}) and what to see there.", p.name, p.lat.toFixed(4), p.lon.toFixed(4), p.body),
            );
            this.hide();
          },
        }),
      );
    this.card.append(...lines.filter((x): x is Node => !!x), acts);
  }

  // ------------------------------------------------------------------ the overlay
  private drawOverlay(ctx: CanvasRenderingContext2D, to: ToScreen, W: number, H: number) {
    const zoom = this.map.zoom;
    // the terminator: the twilight's line (the night itself darkened by the map — its outline: nightPath)
    const sun = this.layers.night ? this.d.subsolar(this.body) : null;
    if (sun) {
      const pts = this.terminator(to, W, H, sun);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.strokeStyle = "rgba(255, 196, 120, 0.6)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    // the graticule, its spacing by the zoom
    if (this.layers.grid) {
      const degPx = this.map.scale() / 360;
      const step =
        [90, 45, 30, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1].find((s) => s * degPx < 140 && s * degPx >= 40) ?? (degPx * 0.1 > 140 ? 0.05 : 90);
      ctx.strokeStyle = "rgba(220, 235, 255, 0.16)";
      ctx.fillStyle = "rgba(220, 235, 255, 0.55)";
      ctx.font = "600 10px 'JetBrains Mono', monospace";
      ctx.lineWidth = 1;
      const [latTop, lonLeft] = this.map.placeAt(0, 0);
      const [latBot, lonRight] = this.map.placeAt(W, H);
      ctx.beginPath();
      for (let la = Math.ceil(latBot / step) * step; la <= latTop; la += step) {
        const y = to(la, 0)[1];
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.fillText(`${Math.abs(+la.toFixed(2))}°${la >= 0 ? "N" : "S"}`, 4, y - 3);
      }
      const lo1 = lonRight <= lonLeft ? lonRight + 360 : lonRight;
      for (let lo = Math.ceil(lonLeft / step) * step; lo <= lo1; lo += step) {
        const x = to(0, lo)[0];
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        const L = ((((lo + 180) % 360) + 360) % 360) - 180;
        ctx.fillText(`${Math.abs(+L.toFixed(2))}°${L >= 0 ? "E" : "W"}`, x + 3, H - 6);
      }
      ctx.stroke();
    }
    // the destinations and the marks; their names when close enough, or selected
    const sel = this.selected;
    // (the names placed without overlapping: the strong ones first take their room, the others where it is left)
    const taken: [number, number, number, number][] = [];
    const label = (p: AtlasPlace, x: number, y: number, col: string, strong = false) => {
      ctx.font = `${strong ? 700 : 600} ${strong ? 12.5 : 11}px Rajdhani, Inter, sans-serif`;
      const w = ctx.measureText(p.name).width;
      const box: [number, number, number, number] = [x + 7, y - 8, x + 11 + w, y + 7];
      if (!strong && taken.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3])) return;
      taken.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
      ctx.strokeText(p.name, x + 9, y + 4);
      ctx.fillStyle = col;
      ctx.fillText(p.name, x + 9, y + 4);
    };
    for (const p of this.visible()) {
      const [x, y] = to(p.lat, p.lon);
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      const col = KIND_COL[(p.kind as keyof typeof KIND_COL) ?? "point"] ?? "#fff";
      ctx.beginPath();
      if (p.kind === "site") {
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 6, y);
        ctx.closePath();
      } else ctx.arc(x, y, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = col;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.lineWidth = 1.6;
      ctx.fill();
      ctx.stroke();
      if (this.layers.names && (zoom > (this.body === "earth" ? 3.6 : 2.6) || p === sel)) label(p, x, y, "#f4f8ff");
    }
    for (const g of this.found) {
      const [x, y] = to(g.lat, g.lon);
      this.pin(ctx, x, y, KIND_COL.address);
      if (this.layers.names) label({ body: "earth", lat: g.lat, lon: g.lon, name: g.name }, x, y - 14, "#ffd1c9");
    }
    // where the craft, the walker, the camera are
    for (const m of this.d.here()) {
      if (m.body !== this.body) continue;
      const [x, y] = to(m.lat, m.lon);
      const col = m.who === "craft" ? "#ffc85a" : m.who === "walker" ? "#63dce8" : "#ffffff";
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(7, 7);
      ctx.lineTo(0, 3);
      ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.strokeStyle = "#04070d";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fill();
      ctx.restore();
      label(
        {
          body: this.body,
          lat: m.lat,
          lon: m.lon,
          name: m.who === "craft" ? t("The craft") : m.who === "walker" ? t("You") : t("The camera"),
        },
        x + 2,
        y + 14,
        col,
        true,
      );
    }
    // the place selected: a pin
    if (sel && sel.body === this.body) {
      const [x, y] = to(sel.lat, sel.lon);
      this.pin(ctx, x, y, "#ffb35c");
      label(sel, x, y - 14, "#ffe2b8", true);
    }
  }

  /** The terminator across the view, its points on the screen (unwrapped east of the antimeridian). */
  private terminator(to: ToScreen, W: number, H: number, sun: { lat: number; lon: number }): [number, number][] {
    const lonA = this.map.placeAt(0, H / 2)[1];
    const span = Math.min(360, W / (this.map.scale() / 360)) + 2;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 180; i++) {
      const lon = lonA - 1 + (i / 180) * span;
      pts.push(to(terminatorLat(lon, sun.lat, sun.lon), lon));
    }
    for (let i = 1; i < pts.length; i++) while (pts[i]![0] < pts[i - 1]![0] - 1) pts[i]![0] += this.map.scale();
    return pts;
  }

  /** The night's outline (the map darkens it, the city lights within): the terminator closed by the dark pole's edge. */
  private nightPath(ctx: CanvasRenderingContext2D, to: ToScreen, W: number, H: number): boolean {
    const sun = this.layers.night ? this.d.subsolar(this.body) : null;
    if (!sun) return false;
    const pts = this.terminator(to, W, H, sun);
    const edge = to(sun.lat >= 0 ? -90 : 90, 0)[1];
    ctx.moveTo(pts[0]![0], edge);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(pts[pts.length - 1]![0], edge);
    ctx.closePath();
    return true;
  }

  private pin(ctx: CanvasRenderingContext2D, x: number, y: number, col: string) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - 8, y - 10, x - 8, y - 20, x, y - 22);
    ctx.bezierCurveTo(x + 8, y - 20, x + 8, y - 10, x, y);
    ctx.fillStyle = col;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - 14, 3, 0, 2 * Math.PI);
    ctx.fillStyle = "#04070d";
    ctx.fill();
  }
}
