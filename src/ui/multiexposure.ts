// The multiple exposure's dialog (PLAN-CIEL C8–C10): from the photo mode's bar (and TARS) — a kind of series
// (the analemma; the eclipse's phases, the stars' trails, the Moon's way, the station's pass in their
// turn), its settings, the series run (each exposure rendered offline, its progress, stopped at will), the
// image shown, downloaded as a PNG.

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
  /** the analemma's clock time [minutes after 00:00 UTC], its first day [ms], its cadence [days], its base */
  minutesUtc?: number;
  start?: number;
  cadence?: number;
  base?: "dusk" | "same" | "none";
  /** the dates written beside the Suns: every one, one a month, none */
  dates?: "all" | "monthly" | "none";
  /** the Sun's place in the sky (azimuth, altitude) beside its date, and the place and hour in a corner */
  position?: boolean;
  width: number;
  height: number;
  spp: number;
}

export interface MxDialogHost {
  /** the player's place on the Earth [°] and the game's date [ms UTC] */
  place(): { lat: number; lon: number } | null;
  now(): number;
  /** the series run: its progress, a stop; the image */
  run(
    r: MxRequest,
    progress: (p: { done: number; total: number; label: string }) => void,
    signal: { stop: boolean },
  ): Promise<{ data: Uint8ClampedArray; width: number; height: number; rendered: number; marks?: SunMark[] }>;
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
    hint: { fr: "5 phases avant, la totalité, 5 après, sur une image", en: "5 phases before, the totality, 5 after, on one image" },
    ready: false,
  },
  {
    id: "trails",
    name: { fr: "Filé d'étoiles", en: "Star trails" },
    hint: { fr: "Les étoiles tournant autour du pôle sur une nuit", en: "The stars turning round the pole over a night" },
    ready: false,
  },
  {
    id: "moon",
    name: { fr: "Trajet de la Lune", en: "The Moon's way" },
    hint: { fr: "La Lune toutes les heures d'une nuit", en: "The Moon every hour of a night" },
    ready: false,
  },
  {
    id: "iss",
    name: { fr: "Passage de l'ISS", en: "The ISS's pass" },
    hint: { fr: "La station traversant le ciel du soir", en: "The station crossing the evening sky" },
    ready: false,
  },
];

const SIZES: { label: string; w: number; h: number }[] = [
  { label: "1200 × 1600", w: 1200, h: 1600 },
  { label: "1920 × 1080", w: 1920, h: 1080 },
  { label: "2400 × 3200", w: 2400, h: 3200 },
  { label: "3840 × 2160", w: 3840, h: 2160 },
];

/**
 * The labels laid on the composite (the analemma's): beside each Sun — every one, or the first of each month —
 * its date and, asked, its place in the sky (azimuth, altitude); to the right of the figure's right half, to
 * the left of its left half (out of it); a dark halo under them, legible over the sky. With the position, the
 * place and the hour written in the bottom-left corner.
 */
export function drawMarks(
  g: CanvasRenderingContext2D,
  marks: SunMark[],
  o: { dates: "all" | "monthly" | "none"; position: boolean; lat: number; lon: number; minutesUtc: number },
  W: number,
  H: number,
) {
  const lang = tr({ fr: "fr-FR", en: "en-GB" });
  const fmt = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" });
  const deg = (v: number, d = 1) => `${v.toLocaleString(lang, { minimumFractionDigits: d, maximumFractionDigits: d })}°`;
  const px = Math.max(11, Math.round(W / 110));
  const write = (text: string, x: number, y: number, align: CanvasTextAlign, size = px, weight = 600) => {
    g.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
    g.textAlign = align;
    g.textBaseline = "middle";
    g.lineWidth = Math.max(2, size / 4);
    g.lineJoin = "round";
    g.strokeStyle = "rgba(0, 0, 0, 0.75)";
    g.strokeText(text, x, y);
    g.fillStyle = "rgba(255, 236, 200, 0.92)";
    g.fillText(text, x, y);
  };
  if (o.dates !== "none" || o.position) {
    const all = o.dates === "all";
    const cx = marks.reduce((s, m) => s + m.x, 0) / Math.max(marks.length, 1);
    let month = -1;
    for (const m of marks) {
      const mo = new Date(m.ms).getUTCMonth();
      if (!all && mo === month) continue;
      month = mo;
      const parts: string[] = [];
      if (o.dates !== "none") parts.push(fmt.format(m.ms));
      if (o.position) parts.push(tr({ fr: `az ${deg(m.az)} · h ${deg(m.alt)}`, en: `az ${deg(m.az)} · alt ${deg(m.alt)}` }));
      const left = m.x < cx;
      write(parts.join("  "), m.x + (left ? -1 : 1) * px * 0.9, m.y, left ? "right" : "left");
    }
  }
  if (o.position) {
    const ns = o.lat >= 0 ? "N" : "S",
      ew = o.lon >= 0 ? "E" : tr({ fr: "O", en: "W" });
    const hh = String(Math.floor(o.minutesUtc / 60)).padStart(2, "0"),
      mm = String(o.minutesUtc % 60).padStart(2, "0");
    write(
      `${deg(Math.abs(o.lat), 2)} ${ns}  ${deg(Math.abs(o.lon), 2)} ${ew}  ·  ${hh}:${mm} UTC`,
      px * 1.4,
      H - px * 1.6,
      "left",
      Math.round(px * 1.15),
      500,
    );
  }
}

export class MultiExposureDialog {
  private close: (() => void) | null = null;
  private signal = { stop: false };
  private running = false;
  /** the kinds made ready since (C9, C10) */
  ready = new Set<MxKind>(KINDS.filter((k) => k.ready).map((k) => k.id));

  constructor(private host: MxDialogHost) {}

  get isOpen() {
    return !!this.close;
  }

  /** The dialog, on a kind (its fields given: the request run at once — TARS). */
  open(o: { kind?: MxKind; run?: Partial<MxRequest> } = {}): Promise<{ rendered: number } | null> {
    this.close?.();
    let kind: MxKind = o.kind ?? "analemma";
    // (a request given — TARS's — shown in the fields too)
    const run = o.run ?? {};
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
    const num = (label: Text, v: number, step: string, min?: number, max?: number) => {
      const i = h("input", {
        type: "number",
        step,
        value: String(v),
        min: min === undefined ? undefined : String(min),
        max: max === undefined ? undefined : String(max),
      }) as HTMLInputElement;
      return { el: h("label", { class: "mx-field" }, el("span", "", tr(label)), i), get: () => Number(i.value) };
    };
    const lat = num({ fr: "Latitude (°)", en: "Latitude (°)" }, Math.round(place.lat * 100) / 100, "0.01", -90, 90);
    const lon = num({ fr: "Longitude (°)", en: "Longitude (°)" }, Math.round(place.lon * 100) / 100, "0.01", -180, 180);
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
    const base = h("select", {}) as HTMLSelectElement;
    for (const [v, t] of [
      ["dusk", { fr: "Le paysage au crépuscule", en: "The landscape at dusk" }],
      ["same", { fr: "Le paysage à cette heure", en: "The landscape at that hour" }],
      ["none", { fr: "Aucun (fond noir)", en: "None (black)" }],
    ] as [string, Text][])
      base.append(h("option", { value: v }, tr(t)));
    const dates = h("select", { "data-testid": "mx-dates" }) as HTMLSelectElement;
    for (const [v, t] of [
      ["monthly", { fr: "Une date par mois", en: "One date a month" }],
      ["all", { fr: "Toutes les dates", en: "Every date" }],
      ["none", { fr: "Aucune date", en: "No dates" }],
    ] as [string, Text][])
      dates.append(h("option", { value: v }, tr(t)));
    const position = h("input", { type: "checkbox", "data-testid": "mx-position" }) as HTMLInputElement;
    position.checked = !!run.position;
    if (run.dates) dates.value = run.dates;
    if (run.base) base.value = run.base;
    const size = h("select", {}) as HTMLSelectElement;
    SIZES.forEach((s, i) => size.append(h("option", { value: String(i) }, s.label)));
    const spp = h("select", {}) as HTMLSelectElement;
    for (const v of [2, 4, 8]) spp.append(h("option", { value: String(v) }, `${v} spp`));
    const field = (label: Text, input: HTMLElement, extra?: HTMLElement) =>
      h("label", { class: "mx-field" }, el("span", "", tr(label)), input, extra ?? null);
    const drawForm = () => {
      form.replaceChildren();
      const k = KINDS.find((x) => x.id === kind)!;
      form.append(el("p", "mx-hint", tr(k.hint)));
      if (!this.ready.has(kind)) {
        form.append(el("p", "mx-hint soon", tr({ fr: "Bientôt.", en: "Soon." })));
        return;
      }
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
          h(
            "label",
            { class: "mx-field mx-check" },
            el("span", "", tr({ fr: "Position", en: "Position" })),
            h("span", {}, position, tr({ fr: " azimut, hauteur, lieu", en: " azimuth, altitude, place" })),
          ),
        ),
        h(
          "div",
          { class: "mx-grid" },
          field({ fr: "Fond", en: "Base" }, base),
          field({ fr: "Taille", en: "Size" }, size),
          field({ fr: "Qualité", en: "Quality" }, spp),
        ),
      );
    };
    for (const k of KINDS) {
      const b = h("button", { type: "button", class: "mx-kind", role: "radio", "data-testid": `mx-${k.id}` }, el("b", "", tr(k.name)));
      b.addEventListener("click", () => {
        if (this.running) return;
        kind = k.id;
        for (const x of cards.querySelectorAll<HTMLElement>(".mx-kind")) x.classList.toggle("on", x === b);
        drawForm();
      });
      if (k.id === kind) b.classList.add("on");
      if (!this.ready.has(k.id)) b.classList.add("soon");
      cards.append(b);
    }
    drawForm();
    const request = (): MxRequest => {
      const s = SIZES[Number(size.value)]!;
      const [hh, mm] = timeIn.value.split(":").map(Number);
      return {
        kind,
        lat: lat.get(),
        lon: lon.get(),
        minutesUtc: (hh ?? 12) * 60 + (mm ?? 0),
        start: Date.parse(`${dateIn.value}T00:00:00Z`),
        cadence: Number(cadence.value),
        base: base.value as MxRequest["base"],
        dates: dates.value as MxRequest["dates"],
        position: position.checked,
        width: s.w,
        height: s.h,
        spp: Number(spp.value),
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
        const r = await this.host.run(
          request(),
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
        const req = request();
        if (r.marks)
          drawMarks(
            g,
            r.marks,
            { dates: req.dates ?? "monthly", position: !!req.position, lat: req.lat, lon: req.lon, minutesUtc: req.minutesUtc ?? 720 },
            r.width,
            r.height,
          );
        preview.replaceChildren(c);
        status.textContent = tr({ fr: `${r.rendered} poses fusionnées.`, en: `${r.rendered} exposures blended.` });
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
        status.textContent = `⚠ ${String(e)}`;
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
