// The multiple exposure's dialog (PLAN-CIEL C8–C10): from the photo mode's bar, the eclipse calculator (and
// TARS) — a kind of series (the analemma, an eclipse's phases; the stars' trails, the Moon's way, the
// station's pass in their turn), its settings, the series run (each exposure rendered offline, its progress,
// stopped at will), the image shown with its labels, downloaded as a PNG.

import type { SunMark } from "../photo/plans";
import "./multiexposure.css";
import { tr, type Text } from "../i18n";
import { button, el, h, modal } from "./kit";

export type MxKind = "analemma" | "eclipse" | "trails" | "moon" | "iss";

export interface MxRequest {
  kind: MxKind;
  /** the place [°] */
  lat: number;
  lon: number;
  /** the analemma's clock time [minutes after 00:00 UTC], its first day [ms], its cadence [days] */
  minutesUtc?: number;
  start?: number;
  cadence?: number;
  /** under the series: the landscape at dusk, at that hour, the eclipse's central phase's; none (black) */
  base?: "dusk" | "same" | "central" | "middle" | "none";
  /** the dates written beside the Suns: every one, one a month, none */
  dates?: "all" | "monthly" | "none";
  /** the Sun's place in the sky (azimuth, altitude) beside its label, and the place and hour in a corner */
  position?: boolean;
  /** an eclipse's: of the Sun or the Moon, near which date [ms]; the exposures before and after the central one */
  eclipse?: "solar" | "lunar";
  date?: number;
  before?: number;
  after?: number;
  /** the horizon in the frame, or the sky alone (the discs larger) */
  framing?: "landscape" | "sky";
  /** a clear sky, or the game's weather */
  sky?: "clear" | "game";
  /** each disc's time, its share hidden; the eclipse, its date and the place in a corner */
  times?: boolean;
  share?: boolean;
  caption?: boolean;
  /** star trails: hours of the night, frames, where the tripod looks, its vertical field [°], a comet's tail */
  hours?: number;
  count?: number;
  toward?: "pole" | "north" | "east" | "south" | "west";
  fov?: number;
  comet?: boolean;
  /** the Moon's way: over a night (a frame every `step` min, `span` h about its highest), each day at `minutesUtc`, each lunar day; for `days` */
  mode?: "night" | "daily" | "lunar";
  step?: number;
  span?: number;
  days?: number;
  /** the Moon's lit share written beside each disc */
  lit?: boolean;
  /** the ISS: an interval shooting's dashes (frames of `exposure` s, a second's gap) */
  dashes?: boolean;
  exposure?: number;
  width: number;
  height: number;
  spp: number;
}

/** An eclipse the dialog offers: seen from the place. */
export interface MxEclipse {
  t: number;
  /** its type here (a solar one's: as seen from the place) */
  type: string;
  magnitude?: number;
}

/** An ISS pass the dialog offers: seen from the place. */
export interface MxPass {
  top: number;
  seenFrom: number;
  seenTo: number;
  maxAlt: number;
  mag: number;
}

/** A series' outcome: its image, the discs' places, those behind the ground, the eclipse it shows. */
export interface MxResult {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  rendered: number;
  marks?: SunMark[];
  hidden?: number[];
  eclipse?: { kind: "solar" | "lunar"; type: string; t: number; saros: number; magnitude: number };
  /** the star trails' night span [ms UTC]; the ISS pass shown */
  span?: { from: number; to: number };
  pass?: MxPass;
}

export interface MxDialogHost {
  /** the player's place on the Earth [°] and the game's date [ms UTC] */
  place(): { lat: number; lon: number } | null;
  now(): number;
  /** the series run: its progress, a stop; the image */
  run(r: MxRequest, progress: (p: { done: number; total: number; label: string }) => void, signal: { stop: boolean }): Promise<MxResult>;
  /** the eclipses seen from a place over the years about a date (the calculator's worker) */
  eclipses?(kind: "solar" | "lunar", lat: number, lon: number, around: number): Promise<MxEclipse[]>;
  /** the ISS's passes seen from a place over ten days from a date */
  issPasses?(lat: number, lon: number, from: number): Promise<MxPass[]>;
  /** an image saved (a download) */
  download(blob: Blob, name: string): void;
}

const KINDS: { id: MxKind; name: Text; hint: Text; ready: boolean }[] = [
  {
    id: "analemma",
    name: { fr: "Analemme", en: "Analemma" },
    hint: {
      fr: "Le Soleil à la même heure chaque semaine pendant un an : son huit",
      en: "The Sun at the same time every week for a year: its figure-eight",
    },
    ready: true,
  },
  {
    id: "eclipse",
    name: { fr: "Éclipse", en: "Eclipse" },
    hint: {
      fr: "Les phases avant, la totalité, les phases après, d'un même trépied — chaque disque pris au téléobjectif et posé à sa place",
      en: "The phases before, the totality, the phases after, from one tripod — each disc taken through a telephoto and laid at its place",
    },
    ready: true,
  },
  {
    id: "trails",
    name: { fr: "Filé d'étoiles", en: "Star trails" },
    hint: {
      fr: "Les étoiles tournant autour du pôle pendant des heures d'une nuit noire — chaque étoile prolongée sur son arc jusqu'à la pose suivante",
      en: "The stars turning round the pole over hours of a dark night — each star run on along its arc to the next frame",
    },
    ready: true,
  },
  {
    id: "moon",
    name: { fr: "Trajet de la Lune", en: "The Moon's way" },
    hint: {
      fr: "La Lune au fil d'une nuit, à la même heure jour après jour (ses phases), ou chaque jour lunaire (sa boucle : l'analemme lunaire)",
      en: "The Moon through a night, at the same time day after day (its phases), or each lunar day (its loop: the lunar analemma)",
    },
    ready: true,
  },
  {
    id: "iss",
    name: { fr: "Passage de l'ISS", en: "The ISS's pass" },
    hint: {
      fr: "La station éclairée par le Soleil traversant le ciel de nuit — sa traînée, plus vive à son plus haut, rougissant en entrant dans l'ombre de la Terre",
      en: "The station lit by the Sun crossing the night sky — its trail, brightest at its highest, reddening into the Earth's shadow",
    },
    ready: true,
  },
];

const SIZES: { label: string; w: number; h: number }[] = [
  { label: "1200 × 1600", w: 1200, h: 1600 },
  { label: "1920 × 1080", w: 1920, h: 1080 },
  { label: "2400 × 3200", w: 2400, h: 3200 },
  { label: "3840 × 2160", w: 3840, h: 2160 },
];

const TYPE: Record<string, Text> = {
  total: { fr: "totale", en: "total" },
  annular: { fr: "annulaire", en: "annular" },
  hybrid: { fr: "hybride", en: "hybrid" },
  partial: { fr: "partielle", en: "partial" },
  penumbral: { fr: "par la pénombre", en: "penumbral" },
};

/** An eclipse's name: "Éclipse totale de Soleil" / "Total solar eclipse". */
export function eclipseName(kind: "solar" | "lunar", type: string): string {
  const t = tr(TYPE[type] ?? { fr: type, en: type });
  return kind === "solar"
    ? tr({ fr: `Éclipse ${t} de Soleil`, en: `${cap(t)} solar eclipse` })
    : tr({ fr: `Éclipse ${t} de Lune`, en: `${cap(t)} lunar eclipse` });
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A place written [°]: 42,34° N 3,70° O. */
export function placeText(lat: number, lon: number): string {
  const lang = tr({ fr: "fr-FR", en: "en-GB" });
  const deg = (v: number) => `${Math.abs(v).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}°`;
  return `${deg(lat)} ${lat >= 0 ? "N" : "S"}  ${deg(lon)} ${lon >= 0 ? "E" : tr({ fr: "O", en: "W" })}`;
}

export interface LabelOptions {
  /** which discs get a label: every one, the first of each month (an analemma's), none */
  which: "all" | "monthly" | "none";
  /** its first words: its day (an analemma's), its time (an eclipse's), nothing */
  date: "day" | "time" | null;
  /** its share hidden (an eclipse's), its place in the sky */
  share?: boolean;
  position?: boolean;
  /** beside the disc, out of the figure (an analemma's), or on the outer side of the discs' path (a sequence's) */
  side: "beside" | "path";
  /** written in the bottom-left corner */
  caption?: string;
  /** the discs not laid (behind the ground): no label */
  hidden?: number[];
  /** the central disc's word (an eclipse's): its totality, its ring, its greatest */
  central?: string;
  /** the share's word before its figure (the Moon's: lit) */
  shareWord?: string;
}

/**
 * The labels laid on the composite: each disc's — its day or its time, its share hidden, its place in the
 * sky (azimuth, altitude) —, beside it out of the figure (to the right of its right half, to the left of its
 * left half) or across the discs' path, on its lower side; a dark halo under them, legible over the sky. A
 * caption in the bottom-left corner.
 */
export function drawLabels(g: CanvasRenderingContext2D, marks: SunMark[], o: LabelOptions, W: number, H: number) {
  const lang = tr({ fr: "fr-FR", en: "en-GB" });
  const day = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" });
  const deg = (v: number) => `${v.toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}°`;
  const px = Math.max(11, Math.round(Math.max(W, H) / 150));
  // (the boxes written so far: a label over another is left out — the loops' crowded turns)
  const boxes: [number, number, number, number][] = [];
  const write = (text: string, x: number, y: number, align: CanvasTextAlign, size = px, weight = 600) => {
    g.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
    const w = g.measureText(text).width;
    const x0 = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    const box: [number, number, number, number] = [x0 - 2, y - size * 0.6, x0 + w + 2, y + size * 0.6];
    if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
    boxes.push(box);
    g.textAlign = align;
    g.textBaseline = "middle";
    g.lineWidth = Math.max(2, size / 4);
    g.lineJoin = "round";
    g.strokeStyle = "rgba(0, 0, 0, 0.75)";
    g.strokeText(text, x, y);
    g.fillStyle = "rgba(255, 236, 200, 0.92)";
    g.fillText(text, x, y);
  };
  const shown = marks.filter((m) => !o.hidden?.includes(m.ms));
  if (o.which !== "none" && (o.date || o.share || o.position)) {
    const cx = shown.reduce((s, m) => s + m.x, 0) / Math.max(shown.length, 1);
    let month = -1;
    for (const [i, m] of shown.entries()) {
      const mo = new Date(m.ms).getUTCMonth();
      if (o.which === "monthly" && mo === month) continue;
      month = mo;
      const parts: string[] = [];
      if (o.date === "day") parts.push(day.format(m.ms));
      if (o.date === "time") parts.push(`${new Date(m.ms).toISOString().slice(11, 16)} UTC`);
      if (o.share && m.hidden !== undefined)
        parts.push(
          m.central
            ? (o.central ?? tr({ fr: "maximum", en: "greatest" }))
            : `${o.shareWord ? `${o.shareWord} ` : ""}${Math.round(m.hidden * 100)} %`,
        );
      if (o.position) parts.push(tr({ fr: `az ${deg(m.az)} · h ${deg(m.alt)}`, en: `az ${deg(m.az)} · alt ${deg(m.alt)}` }));
      if (!parts.length) continue;
      const text = parts.join("  ·  ");
      if (o.side === "beside") {
        const left = m.x < cx;
        write(text, m.x + (left ? -1 : 1) * (m.r + px * 0.9), m.y, left ? "right" : "left");
        continue;
      }
      // (across the path: its direction from the neighbours, the side below it)
      const a = shown[Math.max(i - 1, 0)]!,
        b = shown[Math.min(i + 1, shown.length - 1)]!;
      let nx = -(b.y - a.y),
        ny = b.x - a.x;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      if (l === 1 && nx === 0) [nx, ny] = [0, 1];
      if (ny < 0) [nx, ny] = [-nx, -ny];
      const d = m.r * (m.central ? 3.2 : 1.3) + px * 0.8;
      write(text, m.x + nx * d, m.y + ny * d, nx < -0.35 ? "right" : nx > 0.35 ? "left" : "center");
    }
  }
  if (o.caption) write(o.caption, px * 1.4, H - px * 1.6, "left", Math.round(px * 1.15), 500);
}

export class MultiExposureDialog {
  private close: (() => void) | null = null;
  private signal = { stop: false };
  private running = false;
  /** the kinds made ready since (C10) */
  ready = new Set<MxKind>(KINDS.filter((k) => k.ready).map((k) => k.id));

  constructor(private host: MxDialogHost) {}

  get isOpen() {
    return !!this.close;
  }

  /** The dialog, on a kind; its fields filled (the eclipse calculator's), or given and run at once (TARS). */
  open(o: { kind?: MxKind; run?: Partial<MxRequest>; fill?: Partial<MxRequest> } = {}): Promise<{ rendered: number } | null> {
    this.close?.();
    let kind: MxKind = o.kind ?? "analemma";
    // (a request given — TARS's, the calculator's — shown in the fields too)
    const run = { ...o.fill, ...o.run };
    const here = this.host.place() ?? { lat: 48.86, lon: 2.35 };
    const place = { lat: run.lat ?? here.lat, lon: run.lon ?? here.lon };
    const now = new Date(run.start ?? this.host.now());
    const at = run.minutesUtc ?? 720;
    const cards = h("div", { class: "mx-kinds", role: "radiogroup" });
    const form = h("div", { class: "mx-form" });
    const status = el("div", "mx-status");
    const bar = h("div", { class: "mx-progress" }, el("i", ""));
    const preview = h("div", { class: "mx-preview" });
    const actions = h("div", { class: "mx-acts" });
    const field = (label: Text, input: HTMLElement, extra?: HTMLElement) =>
      h("label", { class: "mx-field" }, el("span", "", tr(label)), input, extra ?? null);
    const num = (label: Text, v: number, step: string, min?: number, max?: number, testid?: string) => {
      const i = h("input", {
        type: "number",
        step,
        value: String(v),
        min: min === undefined ? undefined : String(min),
        max: max === undefined ? undefined : String(max),
        "data-testid": testid,
      }) as HTMLInputElement;
      return { el: field(label, i), input: i, get: () => Number(i.value) };
    };
    const select = (options: [string, Text][], value?: string, testid?: string) => {
      const s = h("select", { "data-testid": testid }) as HTMLSelectElement;
      for (const [v, t] of options) s.append(h("option", { value: v }, tr(t)));
      if (value !== undefined) s.value = value;
      return s;
    };
    const check = (label: Text, on: boolean, testid?: string) => {
      const i = h("input", { type: "checkbox", "data-testid": testid }) as HTMLInputElement;
      i.checked = on;
      return { el: h("label", { class: "mx-check-row" }, i, tr(label)), input: i };
    };
    // the place, the size, the quality: every kind's
    const lat = num({ fr: "Latitude (°)", en: "Latitude (°)" }, Math.round(place.lat * 100) / 100, "0.01", -90, 90, "mx-lat");
    const lon = num({ fr: "Longitude (°)", en: "Longitude (°)" }, Math.round(place.lon * 100) / 100, "0.01", -180, 180, "mx-lon");
    const size = h("select", { "data-testid": "mx-size" }) as HTMLSelectElement;
    SIZES.forEach((s, i) => size.append(h("option", { value: String(i) }, s.label)));
    const sizeFor = (k: MxKind) => (size.value = k === "analemma" ? "0" : "1");
    sizeFor(kind);
    const spp = h("select", {}) as HTMLSelectElement;
    for (const v of [2, 4, 8]) spp.append(h("option", { value: String(v) }, `${v} spp`));
    const sppFor = (k: MxKind) => (spp.value = k === "eclipse" || k === "moon" || k === "iss" ? "4" : "2");
    sppFor(kind);
    // the analemma's
    const timeIn = h("input", {
      type: "time",
      value: `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`,
      step: "60",
    }) as HTMLInputElement;
    const dateIn = h("input", { type: "date", value: now.toISOString().slice(0, 10) }) as HTMLInputElement;
    const cadence = h("input", {
      type: "range",
      min: "1",
      max: "10",
      step: "1",
      value: String(run.cadence ?? 7),
      "data-testid": "mx-cadence",
    }) as HTMLInputElement;
    const cadOut = el("output", "mx-val", "");
    const syncCad = () => {
      const c = Number(cadence.value);
      cadOut.textContent = tr({
        fr: `tous les ${c} j · ${Math.floor(365.25 / c) + 1} poses`,
        en: `every ${c} d · ${Math.floor(365.25 / c) + 1} exposures`,
      });
    };
    cadence.addEventListener("input", syncCad);
    syncCad();
    const base = select(
      [
        ["dusk", { fr: "Le paysage au crépuscule", en: "The landscape at dusk" }],
        ["same", { fr: "Le paysage à cette heure", en: "The landscape at that hour" }],
        ["none", { fr: "Aucun (fond noir)", en: "None (black)" }],
      ],
      kind === "analemma" ? run.base : undefined,
    );
    const dates = select(
      [
        ["monthly", { fr: "Une date par mois", en: "One date a month" }],
        ["all", { fr: "Toutes les dates", en: "Every date" }],
        ["none", { fr: "Aucune date", en: "No dates" }],
      ],
      run.dates,
      "mx-dates",
    );
    const position = check({ fr: "azimut, hauteur, lieu", en: "azimuth, altitude, place" }, !!run.position, "mx-position");
    // the eclipse's
    const eKind = select(
      [
        ["solar", { fr: "De Soleil", en: "Solar" }],
        ["lunar", { fr: "De Lune", en: "Lunar" }],
      ],
      run.eclipse ?? "solar",
      "mx-ecl-kind",
    );
    const eList = h("select", { "data-testid": "mx-ecl-list" }) as HTMLSelectElement;
    const eNote = el("p", "mx-hint", "");
    const before = num({ fr: "Avant", en: "Before" }, run.before ?? 5, "1", 0, 10, "mx-before");
    const after = num({ fr: "Après", en: "After" }, run.after ?? 5, "1", 0, 10, "mx-after");
    const framing = select(
      [
        ["landscape", { fr: "Le paysage dessous", en: "The landscape under it" }],
        ["sky", { fr: "Le ciel seul (disques plus grands)", en: "The sky alone (larger discs)" }],
      ],
      run.framing,
      "mx-framing",
    );
    const eBase = select(
      [
        ["central", { fr: "La totalité (son crépuscule, la nuit)", en: "The totality (its twilight, the night)" }],
        ["dusk", { fr: "Le paysage au crépuscule", en: "The landscape at dusk" }],
        ["none", { fr: "Aucun (fond noir)", en: "None (black)" }],
      ],
      kind === "eclipse" ? run.base : undefined,
      "mx-ecl-base",
    );
    const sky = select(
      [
        ["clear", { fr: "Dégagé", en: "Clear" }],
        ["game", { fr: "La météo du jeu", en: "The game's weather" }],
      ],
      run.sky,
      "mx-sky",
    );
    const times = check({ fr: "Heures", en: "Times" }, run.times ?? true, "mx-times");
    const share = check({ fr: "Part cachée", en: "Share hidden" }, !!run.share, "mx-share");
    const ePos = check({ fr: "Position", en: "Position" }, !!run.position, "mx-ecl-position");
    const caption = check({ fr: "Légende", en: "Caption" }, run.caption ?? true, "mx-caption");
    // the night's: the star trails', the Moon's, the station's
    const nightDate = h("input", {
      type: "date",
      value: new Date(run.date ?? this.host.now()).toISOString().slice(0, 10),
      "data-testid": "mx-night",
    }) as HTMLInputElement;
    const hours = num({ fr: "Durée (h)", en: "Length (h)" }, run.hours ?? 3, "0.5", 0.5, 10, "mx-hours");
    const count = select(
      [
        ["40", { fr: "40 poses (rapide)", en: "40 frames (quick)" }],
        ["80", { fr: "80 poses", en: "80 frames" }],
        ["160", { fr: "160 poses (fin)", en: "160 frames (fine)" }],
      ],
      String(run.count ?? 80),
      "mx-count",
    );
    const toward = select(
      [
        ["pole", { fr: "Le pôle céleste", en: "The celestial pole" }],
        ["north", { fr: "Le nord", en: "The north" }],
        ["east", { fr: "L'est", en: "The east" }],
        ["south", { fr: "Le sud", en: "The south" }],
        ["west", { fr: "L'ouest", en: "The west" }],
      ],
      run.toward,
      "mx-toward",
    );
    const fovSel = select(
      [
        ["50", { fr: "50° (normal)", en: "50° (normal)" }],
        ["70", { fr: "70° (grand-angle)", en: "70° (wide)" }],
        ["90", { fr: "90°", en: "90°" }],
        ["110", { fr: "110° (très grand-angle)", en: "110° (ultra-wide)" }],
      ],
      String(run.fov ?? 70),
      "mx-fov",
    );
    const comet = check({ fr: "Queue de comète", en: "Comet tail" }, !!run.comet, "mx-comet");
    const mode = select(
      [
        ["night", { fr: "Au fil d'une nuit", en: "Through a night" }],
        ["daily", { fr: "Chaque jour à la même heure", en: "Each day at the same time" }],
        ["lunar", { fr: "Chaque jour lunaire (sa boucle)", en: "Each lunar day (its loop)" }],
      ],
      run.mode,
      "mx-moon-mode",
    );
    const step = select(
      [
        ["15", { fr: "toutes les 15 min", en: "every 15 min" }],
        ["30", { fr: "toutes les 30 min", en: "every 30 min" }],
        ["60", { fr: "toutes les heures", en: "every hour" }],
        ["120", { fr: "toutes les 2 h", en: "every 2 h" }],
      ],
      String(run.step ?? 60),
      "mx-step",
    );
    const span = num({ fr: "Autour du plus haut (h)", en: "About its highest (h)" }, run.span ?? 6, "1", 2, 12, "mx-span");
    const days = num({ fr: "Jours", en: "Days" }, run.days ?? 30, "1", 3, 60, "mx-days");
    const mBase = select(
      [
        ["middle", { fr: "Le paysage sous la Lune", en: "The landscape under the Moon" }],
        ["dusk", { fr: "Le paysage au crépuscule", en: "The landscape at dusk" }],
        ["none", { fr: "Aucun (fond noir)", en: "None (black)" }],
      ],
      kind === "moon" ? run.base : undefined,
      "mx-moon-base",
    );
    const litChk = check({ fr: "Part éclairée", en: "Share lit" }, run.lit ?? true, "mx-lit");
    const issList = h("select", { "data-testid": "mx-iss-list" }) as HTMLSelectElement;
    const issNote = el("p", "mx-hint", "");
    const dashes = check({ fr: "En pointillés (poses de", en: "Dashed (frames of" }, !!run.dashes, "mx-dashes");
    const expSel = select(
      [
        ["10", { fr: "10 s)", en: "10 s)" }],
        ["15", { fr: "15 s)", en: "15 s)" }],
        ["20", { fr: "20 s)", en: "20 s)" }],
        ["30", { fr: "30 s)", en: "30 s)" }],
      ],
      String(run.exposure ?? 15),
      "mx-exposure",
    );
    let passesFor = "";
    const fillPasses = async () => {
      const key = `${lat.get()} ${lon.get()} ${nightDate.value}`;
      if (key === passesFor || !this.host.issPasses) return;
      passesFor = key;
      issList.replaceChildren(h("option", {}, tr({ fr: "Recherche…", en: "Searching…" })));
      issList.disabled = true;
      try {
        const list = await this.host.issPasses(lat.get(), lon.get(), Date.parse(`${nightDate.value}T00:00:00Z`));
        if (key !== passesFor) return;
        const fmt = new Intl.DateTimeFormat(tr({ fr: "fr-FR", en: "en-GB" }), {
          weekday: "short",
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        });
        issList.replaceChildren(
          ...list.map((p) =>
            h(
              "option",
              { value: String(p.top) },
              `${fmt.format(p.top)} ${new Date(p.seenFrom).toISOString().slice(11, 16)}–${new Date(p.seenTo).toISOString().slice(11, 16)} UTC · ${Math.round(p.maxAlt)}° · mag ${p.mag.toFixed(1)}`,
            ),
          ),
        );
        // (the one asked, else the brightest)
        const pick =
          run.date !== undefined
            ? list.reduce((a, b) => (Math.abs(b.top - run.date!) < Math.abs(a.top - run.date!) ? b : a), list[0]!)
            : list.reduce((a, b) => (b.mag < a.mag ? b : a), list[0]!);
        if (pick) issList.value = String(pick.top);
        issNote.textContent = list.length
          ? ""
          : tr({ fr: "Aucun passage visible d'ici ces dix jours-là.", en: "No pass seen from here over those ten days." });
      } catch (e) {
        issList.replaceChildren(h("option", {}, `⚠ ${String(e)}`));
      } finally {
        issList.disabled = false;
      }
    };
    nightDate.addEventListener("change", () => kind === "iss" && void fillPasses());
    for (const i of [lat.input, lon.input]) i.addEventListener("change", () => kind === "iss" && void fillPasses());
    // (a night's base: the landscape under the Moon; the days' — some in daylight —: the black)
    const syncMoonBase = () => run.base === undefined && (mBase.value = mode.value === "night" ? "middle" : "none");
    syncMoonBase();
    mode.addEventListener("change", () => {
      syncMoonBase();
      drawForm();
    });
    let found: MxEclipse[] = [];
    let listFor = "";
    const fillList = async () => {
      const key = `${eKind.value} ${lat.get()} ${lon.get()}`;
      if (key === listFor || !this.host.eclipses) return;
      listFor = key;
      eList.replaceChildren(h("option", {}, tr({ fr: "Recherche…", en: "Searching…" })));
      eList.disabled = true;
      const want = run.date;
      try {
        const list = await this.host.eclipses(eKind.value as "solar" | "lunar", lat.get(), lon.get(), this.host.now());
        if (key !== listFor) return;
        found = list;
        const fmt = new Intl.DateTimeFormat(tr({ fr: "fr-FR", en: "en-GB" }), {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
        eList.replaceChildren(
          ...list.map((e) =>
            h(
              "option",
              { value: String(e.t) },
              `${fmt.format(e.t)} — ${tr(TYPE[e.type] ?? { fr: e.type, en: e.type })}${e.magnitude !== undefined ? ` (${e.magnitude.toFixed(2)})` : ""}`,
            ),
          ),
        );
        // (the one asked, else the next one to come)
        const now = this.host.now();
        const pick =
          want !== undefined
            ? list.reduce((a, b) => (Math.abs(b.t - want) < Math.abs(a.t - want) ? b : a), list[0]!)
            : list.find((e) => e.t > now);
        if (pick) eList.value = String(pick.t);
        eNote.textContent = list.length
          ? ""
          : tr({ fr: "Aucune éclipse vue d'ici sur ces années.", en: "No eclipse seen from here over these years." });
        syncBase();
      } catch (e) {
        eList.replaceChildren(h("option", {}, `⚠ ${String(e)}`));
      } finally {
        eList.disabled = false;
      }
    };
    // (the totality as the base: only a total one's — else the dusk's)
    const syncBase = () => {
      const e = found.find((x) => String(x.t) === eList.value);
      const total = e?.type === "total";
      (eBase.options[0] as HTMLOptionElement).disabled = !total;
      if (!total && eBase.value === "central") eBase.value = eKind.value === "lunar" ? "none" : "dusk";
    };
    eKind.addEventListener("change", () => void fillList());
    eList.addEventListener("change", syncBase);
    for (const i of [lat.input, lon.input]) i.addEventListener("change", () => kind === "eclipse" && void fillList());
    const drawForm = () => {
      form.replaceChildren();
      const k = KINDS.find((x) => x.id === kind)!;
      form.append(el("p", "mx-hint", tr(k.hint)));
      if (!this.ready.has(kind)) {
        form.append(el("p", "mx-hint soon", tr({ fr: "Bientôt.", en: "Soon." })));
        return;
      }
      if (kind === "analemma")
        form.append(
          h(
            "div",
            { class: "mx-grid" },
            lat.el,
            lon.el,
            field({ fr: "Heure (UTC)", en: "Time (UTC)" }, timeIn),
            field({ fr: "À partir du", en: "From" }, dateIn),
          ),
          field({ fr: "Cadence", en: "Cadence" }, cadence, cadOut),
          h(
            "div",
            { class: "mx-grid" },
            field({ fr: "Dates à côté des Soleils", en: "Dates beside the Suns" }, dates),
            field({ fr: "Position", en: "Position" }, position.el),
          ),
          h(
            "div",
            { class: "mx-grid" },
            field({ fr: "Fond", en: "Base" }, base),
            field({ fr: "Taille", en: "Size" }, size),
            field({ fr: "Qualité", en: "Quality" }, spp),
          ),
        );
      else if (kind === "eclipse") {
        form.append(
          h("div", { class: "mx-grid" }, lat.el, lon.el),
          h(
            "div",
            { class: "mx-grid mx-grid-wide" },
            field({ fr: "Éclipse", en: "Eclipse" }, eKind),
            field({ fr: "Laquelle", en: "Which" }, eList),
          ),
          eNote,
          h("div", { class: "mx-grid" }, before.el, after.el, field({ fr: "Ciel", en: "Sky" }, sky)),
          h("div", { class: "mx-grid" }, field({ fr: "Cadrage", en: "Framing" }, framing), field({ fr: "Fond", en: "Base" }, eBase)),
          field({ fr: "Étiquettes", en: "Labels" }, h("div", { class: "mx-checks" }, times.el, share.el, ePos.el, caption.el)),
          h("div", { class: "mx-grid" }, field({ fr: "Taille", en: "Size" }, size), field({ fr: "Qualité", en: "Quality" }, spp)),
        );
        void fillList();
      } else if (kind === "trails")
        form.append(
          h("div", { class: "mx-grid" }, lat.el, lon.el),
          h("div", { class: "mx-grid" }, field({ fr: "La nuit du", en: "The night of" }, nightDate), hours.el),
          h(
            "div",
            { class: "mx-grid" },
            field({ fr: "Poses", en: "Frames" }, count),
            field({ fr: "Vers", en: "Toward" }, toward),
            field({ fr: "Champ", en: "Field" }, fovSel),
          ),
          h(
            "div",
            { class: "mx-grid" },
            field({ fr: "Ciel", en: "Sky" }, sky),
            field({ fr: "Effet", en: "Effect" }, h("div", { class: "mx-checks" }, comet.el, caption.el)),
          ),
          h("div", { class: "mx-grid" }, field({ fr: "Taille", en: "Size" }, size), field({ fr: "Qualité", en: "Quality" }, spp)),
        );
      else if (kind === "moon") {
        const m = mode.value;
        form.append(
          h("div", { class: "mx-grid" }, lat.el, lon.el),
          h(
            "div",
            { class: "mx-grid mx-grid-wide" },
            field({ fr: "Date", en: "Date" }, nightDate),
            field({ fr: "Suivre", en: "Follow" }, mode),
          ),
          m === "night"
            ? h("div", { class: "mx-grid" }, field({ fr: "Cadence", en: "Cadence" }, step), span.el)
            : m === "daily"
              ? h("div", { class: "mx-grid" }, field({ fr: "Heure (UTC)", en: "Time (UTC)" }, timeIn), days.el)
              : h("div", { class: "mx-grid" }, days.el),
          h(
            "div",
            { class: "mx-grid" },
            field({ fr: "Cadrage", en: "Framing" }, framing),
            field({ fr: "Fond", en: "Base" }, mBase),
            field({ fr: "Ciel", en: "Sky" }, sky),
          ),
          field({ fr: "Étiquettes", en: "Labels" }, h("div", { class: "mx-checks" }, times.el, litChk.el, ePos.el, caption.el)),
          h("div", { class: "mx-grid" }, field({ fr: "Taille", en: "Size" }, size), field({ fr: "Qualité", en: "Quality" }, spp)),
        );
      } else if (kind === "iss") {
        form.append(
          h("div", { class: "mx-grid" }, lat.el, lon.el, field({ fr: "À partir du", en: "From" }, nightDate)),
          field({ fr: "Passage (dix jours)", en: "Pass (ten days)" }, issList),
          issNote,
          h("div", { class: "mx-grid" }, field({ fr: "Cadrage", en: "Framing" }, framing), field({ fr: "Ciel", en: "Sky" }, sky)),
          field({ fr: "Traînée", en: "Trail" }, h("div", { class: "mx-checks" }, dashes.el, expSel)),
          field({ fr: "Étiquettes", en: "Labels" }, h("div", { class: "mx-checks" }, times.el, ePos.el, caption.el)),
          h("div", { class: "mx-grid" }, field({ fr: "Taille", en: "Size" }, size), field({ fr: "Qualité", en: "Quality" }, spp)),
        );
        void fillPasses();
      }
    };
    for (const k of KINDS) {
      const b = h("button", { type: "button", class: "mx-kind", role: "radio", "data-testid": `mx-${k.id}` }, el("b", "", tr(k.name)));
      b.addEventListener("click", () => {
        if (this.running) return;
        kind = k.id;
        for (const x of cards.querySelectorAll<HTMLElement>(".mx-kind")) x.classList.toggle("on", x === b);
        sizeFor(kind);
        sppFor(kind);
        drawForm();
      });
      if (k.id === kind) b.classList.add("on");
      if (!this.ready.has(k.id)) b.classList.add("soon");
      cards.append(b);
    }
    drawForm();
    const request = (): MxRequest => {
      const s = SIZES[Number(size.value)]!;
      const common = { kind, lat: lat.get(), lon: lon.get(), width: s.w, height: s.h, spp: Number(spp.value) };
      if (kind === "eclipse")
        return {
          ...common,
          eclipse: eKind.value as "solar" | "lunar",
          date: eList.value && Number.isFinite(Number(eList.value)) ? Number(eList.value) : (run.date ?? this.host.now()),
          before: before.get(),
          after: after.get(),
          framing: framing.value as MxRequest["framing"],
          base: eBase.value as MxRequest["base"],
          sky: sky.value as MxRequest["sky"],
          times: times.input.checked,
          share: share.input.checked,
          position: ePos.input.checked,
          caption: caption.input.checked,
          ...o.run,
        };
      const [hh, mm] = timeIn.value.split(":").map(Number);
      const night = Date.parse(`${nightDate.value}T00:00:00Z`);
      const labels = { times: times.input.checked, position: ePos.input.checked, caption: caption.input.checked };
      if (kind === "trails")
        return {
          ...common,
          date: night,
          hours: hours.get(),
          count: Number(count.value),
          toward: toward.value as MxRequest["toward"],
          fov: Number(fovSel.value),
          comet: comet.input.checked,
          sky: sky.value as MxRequest["sky"],
          caption: caption.input.checked,
          ...o.run,
        };
      if (kind === "moon")
        return {
          ...common,
          mode: mode.value as MxRequest["mode"],
          date: night,
          step: Number(step.value),
          span: span.get(),
          days: days.get(),
          minutesUtc: (hh ?? 21) * 60 + (mm ?? 0),
          framing: framing.value as MxRequest["framing"],
          base: mBase.value as MxRequest["base"],
          sky: sky.value as MxRequest["sky"],
          lit: litChk.input.checked,
          ...labels,
          ...o.run,
        };
      if (kind === "iss")
        return {
          ...common,
          date: issList.value && Number.isFinite(Number(issList.value)) ? Number(issList.value) : (run.date ?? night),
          dashes: dashes.input.checked,
          exposure: Number(expSel.value),
          framing: framing.value as MxRequest["framing"],
          sky: sky.value as MxRequest["sky"],
          ...labels,
          ...o.run,
        };
      return {
        ...common,
        minutesUtc: (hh ?? 12) * 60 + (mm ?? 0),
        start: Date.parse(`${dateIn.value}T00:00:00Z`),
        cadence: Number(cadence.value),
        base: base.value as MxRequest["base"],
        dates: dates.value as MxRequest["dates"],
        position: position.input.checked,
        ...o.run,
      };
    };
    let resolve: (r: { rendered: number } | null) => void = () => {};
    const done = new Promise<{ rendered: number } | null>((ok) => (resolve = ok));
    const go = async () => {
      if (this.running || !this.ready.has(kind)) return;
      this.running = true;
      this.signal = { stop: false };
      start.disabled = true;
      stop.disabled = false;
      preview.replaceChildren();
      status.textContent = tr({ fr: "Préparation…", en: "Preparing…" });
      try {
        const req = request();
        const r = await this.host.run(
          req,
          (p) => {
            (bar.firstChild as HTMLElement).style.width = `${(100 * p.done) / Math.max(p.total, 1)}%`;
            status.textContent = p.label
              ? tr({ fr: `Pose ${p.done + 1} / ${p.total} — ${p.label}`, en: `Exposure ${p.done + 1} / ${p.total} — ${p.label}` })
              : "";
          },
          this.signal,
        );
        const c = h("canvas", {
          width: String(r.width),
          height: String(r.height),
          class: "mx-image",
          "data-testid": "mx-image",
        }) as HTMLCanvasElement;
        const g = c.getContext("2d")!;
        g.putImageData(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
        if (r.marks) drawLabels(g, r.marks, labelsOf(req, r), r.width, r.height);
        preview.replaceChildren(c);
        const hid = r.hidden?.length ?? 0;
        status.textContent =
          tr({ fr: `${r.rendered} poses fusionnées.`, en: `${r.rendered} exposures blended.` }) +
          (hid
            ? tr({
                fr: ` ${hid} disque${hid > 1 ? "s" : ""} derrière le relief, laissé${hid > 1 ? "s" : ""} de côté.`,
                en: ` ${hid} disc${hid > 1 ? "s" : ""} behind the ground, left out.`,
              })
            : "");
        const save = button({
          label: tr({ fr: "Télécharger le PNG", en: "Download the PNG" }),
          kind: "primary",
          testid: "mx-download",
          onClick: () =>
            c.toBlob((b) => b && this.host.download(b, `kerr-${kind}-${new Date().toISOString().slice(0, 10)}.png`), "image/png"),
        });
        actions.replaceChildren(start, stop, save);
        resolve({ rendered: r.rendered });
      } catch (e) {
        status.textContent = `⚠ ${e instanceof Error ? e.message : String(e)}`;
        resolve(null);
      } finally {
        this.running = false;
        start.disabled = false;
        stop.disabled = true;
      }
    };
    const start = button({ label: tr({ fr: "Lancer", en: "Start" }), kind: "primary", testid: "mx-start", onClick: () => void go() });
    const stop = button({ label: tr({ fr: "Arrêter", en: "Stop" }), testid: "mx-stop", onClick: () => (this.signal.stop = true) });
    stop.disabled = true;
    actions.append(start, stop);
    const m = modal({
      title: tr({ fr: "Surimpression", en: "Multiple exposure" }),
      cls: "mx-frame",
      testid: "multi-exposure",
      body: [
        h(
          "div",
          { class: "mx" },
          cards,
          h("div", { class: "mx-cols" }, h("div", { class: "mx-left" }, form, actions, bar, status), preview),
        ),
      ],
      onClose: () => {
        this.signal.stop = true;
        this.close = null;
        resolve(null);
      },
    });
    this.close = m.close;
    if (o.run) void go();
    return done;
  }
}

/** A request's labels: an analemma's dates beside its Suns; an eclipse's times along its path, its caption;
 *  the star trails' caption; the Moon's times or days and lit shares; the station's times at its ends and highest. */
export function labelsOf(req: MxRequest, r: Pick<MxResult, "hidden" | "eclipse" | "span" | "pass">): LabelOptions {
  const long = new Intl.DateTimeFormat(tr({ fr: "fr-FR", en: "en-GB" }), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const hm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
  if (req.kind === "trails") {
    const sp = r.span;
    return {
      which: "none",
      date: null,
      side: "path",
      caption:
        req.caption === false || !sp
          ? undefined
          : tr({
              fr: `Filé d'étoiles  ·  nuit du ${long.format(req.date ?? sp.from)}  ·  ${hm(sp.from)}–${hm(sp.to)} UTC  ·  ${placeText(req.lat, req.lon)}`,
              en: `Star trails  ·  the night of ${long.format(req.date ?? sp.from)}  ·  ${hm(sp.from)}–${hm(sp.to)} UTC  ·  ${placeText(req.lat, req.lon)}`,
            }),
    };
  }
  if (req.kind === "moon") {
    const what =
      req.mode === "lunar"
        ? tr({ fr: "L'analemme lunaire", en: "The lunar analemma" })
        : req.mode === "daily"
          ? tr({
              fr: `La Lune chaque jour à ${hm((req.minutesUtc ?? 1260) * 60e3)} UTC`,
              en: `The Moon each day at ${hm((req.minutesUtc ?? 1260) * 60e3)} UTC`,
            })
          : tr({ fr: "La Lune au fil de la nuit", en: "The Moon through the night" });
    return {
      which: "all",
      date: req.times === false ? null : req.mode === "night" ? "time" : "day",
      share: req.lit !== false,
      shareWord: "☾",
      position: !!req.position,
      side: "path",
      hidden: r.hidden,
      caption: req.caption === false ? undefined : `${what}  ·  ${long.format(req.date ?? 0)}  ·  ${placeText(req.lat, req.lon)}`,
    };
  }
  if (req.kind === "iss") {
    const p = r.pass;
    return {
      which: "all",
      date: req.times === false ? null : "time",
      position: !!req.position,
      side: "path",
      caption:
        req.caption === false || !p
          ? undefined
          : tr({
              fr: `Passage de l'ISS  ·  ${long.format(p.top)}  ·  ${Math.round(p.maxAlt)}° au plus haut  ·  magnitude ${p.mag.toFixed(1)}  ·  ${placeText(req.lat, req.lon)}`,
              en: `ISS pass  ·  ${long.format(p.top)}  ·  ${Math.round(p.maxAlt)}° at its highest  ·  magnitude ${p.mag.toFixed(1)}  ·  ${placeText(req.lat, req.lon)}`,
            }),
    };
  }
  if (req.kind === "eclipse") {
    const e = r.eclipse;
    const fmt = new Intl.DateTimeFormat(tr({ fr: "fr-FR", en: "en-GB" }), {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    return {
      which: "all",
      date: req.times === false ? null : "time",
      share: !!req.share,
      position: !!req.position,
      side: "path",
      hidden: r.hidden,
      central:
        e?.type === "total"
          ? tr({ fr: "totalité", en: "totality" })
          : e?.type === "annular"
            ? tr({ fr: "anneau", en: "ring" })
            : tr({ fr: "maximum", en: "greatest" }),
      caption:
        req.caption === false || !e
          ? undefined
          : `${eclipseName(e.kind, e.type)}  ·  ${fmt.format(e.t)}  ·  ${placeText(req.lat, req.lon)}${tr({ fr: `  ·  saros ${e.saros}`, en: `  ·  saros ${e.saros}` })}`,
    };
  }
  const m = req.minutesUtc ?? 720;
  return {
    which: req.dates === "none" ? (req.position ? "monthly" : "none") : (req.dates ?? "monthly"),
    date: req.dates === "none" ? null : "day",
    position: !!req.position,
    side: "beside",
    caption: req.position
      ? `${placeText(req.lat, req.lon)}  ·  ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")} UTC`
      : undefined,
  };
}
