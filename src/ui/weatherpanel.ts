// The weather (PLAN-METEO W2): chosen here — the HUD's Weather button, the pause menu — and read: cards for
// the presets (an icon, a name, what each would give at the place below: its flight category), the
// conditions in force in large tiles (the wind on a compass, the visibility and the ceiling on gauges
// coloured by the categories' marks, the precipitation, the flight category and what it means), and the
// place's vertical cut alive under them (weather-section.ts).

import type { RealInfo } from "../realweather";
import "./weather.css";
import type { Settings } from "../settings";
import { tr } from "../i18n";
import { BODY_NAMES, type Body } from "../targeting";
import {
  ceilingOf,
  coverWord,
  flightCategory,
  WEATHER_PRESETS,
  type WeatherPreset,
  type WeatherState,
  weatherAt,
  windFromAt,
} from "../weather";
import { Section } from "./weather-section";
import { el as h, modal } from "./kit";

export interface WeatherHost {
  settings: Settings;
  /** the place whose weather it is (the controller's weatherPlace), or null: no air there */
  place(): { body: string; lat: number; lon: number; days: number; h: number } | null;
  /** the real weather when it came in, or null */
  real(): WeatherState | null;
  /** where the real weather comes from (realweather.ts) */
  realInfo?(): RealInfo;
  /** the setting changed: the scene redrawn */
  changed(): void;
}

const NAMES: Record<WeatherPreset, { fr: string; en: string }> = {
  fair: { fr: "Clair", en: "Fair" },
  cloudy: { fr: "Nuageux", en: "Cloudy" },
  overcast: { fr: "Couvert", en: "Overcast" },
  fog: { fr: "Brouillard", en: "Fog" },
  rain: { fr: "Pluie", en: "Rain" },
  storm: { fr: "Orage", en: "Storm" },
  windy: { fr: "Vent fort", en: "Strong wind" },
  dust: { fr: "Poussière", en: "Dust" },
  random: { fr: "Aléatoire", en: "Random" },
  real: { fr: "Réelle", en: "Real" },
};

const HINTS: Record<WeatherPreset, { fr: string; en: string }> = {
  fair: { fr: "Votre vent (Réglages), la carte réelle des nuages", en: "Your wind (Settings), the real map of clouds" },
  cloudy: { fr: "Cumulus épars vers 1 200 m, vent modéré", en: "Scattered cumulus near 1,200 m, a moderate wind" },
  overcast: { fr: "Plafond bas à 600 m, une seconde couche à 4 km", en: "A low ceiling at 600 m, a second deck at 4 km" },
  fog: { fr: "Brouillard au sol, 300 m de visibilité, vent nul", en: "Fog on the ground, 300 m visibility, no wind" },
  rain: { fr: "Pluie sous une couche à 500 m, rafales, cisaillement", en: "Rain under a deck at 500 m, gusts, shear" },
  storm: { fr: "Cumulonimbus jusqu'à 9 km, forte pluie, rafales à 23 m/s", en: "Cumulonimbus to 9 km, heavy rain, gusts to 23 m/s" },
  windy: { fr: "15 m/s au sol, rafales et cisaillement en finale", en: "15 m/s at the ground, gusts and shear on the final" },
  dust: {
    fr: "Tempête de poussière martienne : ciel orangé, 2 km de visibilité",
    en: "A Martian dust storm: an orange sky, 2 km visibility",
  },
  random: { fr: "Des systèmes météo tirés pour le lieu et le jour", en: "Weather systems drawn for the place and the day" },
  real: {
    fr: "La météo réelle à la date du jeu : le METAR d'une piste, le modèle Open-Meteo partout (1940 → J+15)",
    en: "The real weather at the game's date: a runway's METAR, Open-Meteo's model anywhere (1940 → today + 15 d)",
  },
};

/** What a flight category means. */
const CAT_SAYS = {
  VFR: { fr: "Vol à vue", en: "Visual flight" },
  MVFR: { fr: "Vol à vue marginal", en: "Marginal visual" },
  IFR: { fr: "Vol aux instruments", en: "Instrument flight" },
  LIFR: { fr: "Instruments, conditions basses", en: "Low instrument" },
} as const;

/** The presets' icons (24 × 24, stroked in the current colour). */
const ICONS: Record<WeatherPreset, string> = {
  fair: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  cloudy:
    '<circle cx="8.5" cy="8.5" r="3.2"/><path d="M8.5 2.8v1.4M3 8.5h1.4M4.6 4.6l1 1M12.4 4.6l-1 1"/><path d="M9 19.5h9a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.3-.9A4.1 4.1 0 0 0 9 19.5z"/>',
  overcast:
    '<path d="M6.5 15.5h11a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9-.8A3.8 3.8 0 0 0 6.5 15.5z"/><path d="M4.5 19.5h12a3 3 0 0 0 1.6-.5" opacity=".6"/>',
  fog: '<path d="M6.5 12.5h11a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9-.8A3.8 3.8 0 0 0 6.5 12.5z"/><path d="M3.5 16h17M5.5 19.2h13M8 22h8"/>',
  rain: '<path d="M6.5 13.5h11a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9-.8A3.8 3.8 0 0 0 6.5 13.5z"/><path d="M8.5 16.5l-1.2 3M12.5 16.5l-1.2 3M16.5 16.5l-1.2 3"/>',
  storm: '<path d="M6.5 13h11a3.4 3.4 0 0 0 .3-6.8 4.8 4.8 0 0 0-9-.8A3.8 3.8 0 0 0 6.5 13z"/><path d="M12.8 13.5l-2.6 4.2h3.4l-2.4 4.3"/>',
  windy: '<path d="M3 9h11.5a2.6 2.6 0 1 0-2.6-2.6M3 13.5h15.5a2.8 2.8 0 1 1-2.8 2.8M3 18h8"/>',
  dust: '<path d="M4 8.5c3-1.8 6 1.8 9 0s6 1.8 7 0M4 13c3-1.8 6 1.8 9 0s6 1.8 7 0"/><circle cx="7" cy="17.5" r=".9"/><circle cx="12" cy="18.5" r=".9"/><circle cx="17" cy="17" r=".9"/>',
  random:
    '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.1"/><circle cx="15.5" cy="15.5" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="15.5" cy="8.5" r="1.1"/><circle cx="8.5" cy="15.5" r="1.1"/>',
  real: '<path d="M12 11v10M9 21h6M12 11l-3.5 10M12 11l3.5 10"/><circle cx="12" cy="9" r="1.6"/><path d="M8.3 5.6a5 5 0 0 0 0 6.8M15.7 5.6a5 5 0 0 1 0 6.8M5.6 3a8.6 8.6 0 0 0 0 12M18.4 3a8.6 8.6 0 0 1 0 12"/>',
};

const svg = (body: string, cls: string) =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** A visibility or a height as a tile writes it: its figure and its unit apart. */
function dist(m: number): [string, string] {
  if (m >= 10e3) return [`${Math.round(m / 1000)}`, "km"];
  if (m >= 1000) return [(m / 1000).toFixed(1), "km"];
  return [`${Math.round(m)}`, "m"];
}

/**
 * A gauge on a log scale (100 m … 50 km) with the categories' marks coloured (LIFR, IFR, MVFR, VFR: their
 * bounds as the charts set them for the visibility, or the ceiling), the value marked.
 */
function gauge(value: number | null, bounds: [number, number, number]): string {
  const lo = Math.log(100),
    hi = Math.log(50e3);
  const at = (m: number) => (100 * (Math.log(Math.min(Math.max(m, 100), 50e3)) - lo)) / (hi - lo);
  const [a, b, c] = bounds.map(at) as [number, number, number];
  const mark = value === null ? 100 : at(value);
  return `<div class="wx-gauge"><i class="lifr" style="width:${a}%"></i><i class="ifr" style="width:${b - a}%"></i><i class="mvfr" style="width:${c - b}%"></i><i class="vfr" style="width:${100 - c}%"></i><b style="left:${mark}%"></b></div>`;
}

/** What the real weather is said to be: its source, its time, its report. */
function realSays(w: WeatherState | null, info: RealInfo | undefined): string {
  const when = info ? new Date(info.t).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "";
  if (!info) return w?.report ?? "";
  switch (info.why) {
    case "metar":
      return `${tr({ fr: "METAR de", en: "METAR of" })} ${info.station?.name} (${info.station?.icao}), ${Math.round(info.station?.km ?? 0)} km — ${w?.report ?? ""}`;
    case "model": {
      const m = w?.model;
      const src =
        m?.kind === "archive" ? tr({ fr: "l'archive ERA5", en: "the ERA5 archive" }) : tr({ fr: "la prévision", en: "the forecast" });
      return m
        ? tr({
            fr: `Open-Meteo, ${src} — ${when}, maille ${m.lat.toFixed(2)}°, ${m.lon.toFixed(2)}° : ${m.T.toFixed(1)} °C (rosée ${m.Td.toFixed(1)} °C), ${Math.round(m.p)} hPa, ${m.precip.toFixed(1)} mm/h, nuages hauts ${Math.round(m.high * 100)} %.`,
            en: `Open-Meteo, ${src} — ${when}, cell ${m.lat.toFixed(2)}°, ${m.lon.toFixed(2)}°: ${m.T.toFixed(1)} °C (dew point ${m.Td.toFixed(1)} °C), ${Math.round(m.p)} hPa, ${m.precip.toFixed(1)} mm/h, high clouds ${Math.round(m.high * 100)} %.`,
          })
        : (w?.report ?? "");
    }
    case "pending":
      return tr({
        fr: `La météo réelle du ${when} arrive (Open-Meteo) : beau temps en attendant.`,
        en: `The real weather of ${when} is coming in (Open-Meteo): fair weather meanwhile.`,
      });
    case "out-of-range":
      return tr({
        fr: `Pas de météo réelle le ${when.slice(0, 10)} (les mesures commencent en 1940, la prévision s'arrête à J+15) : un temps plausible tiré pour le lieu et le jour.`,
        en: `No real weather on ${when.slice(0, 10)} (the records start in 1940, the forecast ends 15 days ahead): a plausible weather drawn for the place and the day.`,
      });
    case "other-world":
      return tr({
        fr: "Pas de météo réelle sur ce monde : un temps plausible tiré pour le lieu et le jour.",
        en: "No real weather on this world: a plausible weather drawn for the place and the day.",
      });
    case "high":
      return tr({
        fr: "Trop haut pour la météo (au-delà de 40 km) : elle sera lue en descendant.",
        en: "Too high for the weather (above 40 km): it is read on the way down.",
      });
  }
}

export class WeatherPanel {
  private close: (() => void) | null = null;
  private timer = 0;
  private raf = 0;

  constructor(private host: WeatherHost) {}

  get isOpen() {
    return !!this.close;
  }

  open() {
    if (this.close) return;
    const root = h("div", "wx");
    const m = modal({
      title: tr({ fr: "Météo", en: "Weather" }),
      body: [root],
      cls: "wx-frame",
      testid: "weather-panel",
      onClose: () => {
        this.close = null;
        clearInterval(this.timer);
        cancelAnimationFrame(this.raf);
      },
    });
    this.close = m.close;
    this.build(root);
  }

  private build(root: HTMLElement) {
    const H = this.host;
    // ---- the presets: cards
    const grid = h("div", "wx-presets");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", tr({ fr: "Le temps", en: "The weather" }));
    const cards = new Map<WeatherPreset, { b: HTMLButtonElement; sub: HTMLElement }>();
    for (const p of WEATHER_PRESETS) {
      const b = h("button", `wx-card wx-${p}`) as HTMLButtonElement;
      b.type = "button";
      b.dataset.testid = `weather-${p}`;
      b.setAttribute("role", "radio");
      b.title = tr(HINTS[p]);
      b.innerHTML = `${svg(ICONS[p], "wx-ico")}<span class="wx-name">${tr(NAMES[p])}</span>`;
      const sub = h("span", "wx-sub");
      b.append(sub);
      b.onclick = () => {
        H.settings.weather = p;
        H.changed();
        sync();
      };
      cards.set(p, { b, sub });
      grid.append(b);
    }
    // ---- the conditions: tiles
    const head = h("div", "wx-head");
    const where = h("div", "wx-where");
    const says = h("div", "wx-says");
    head.append(where, says);
    const tiles = h("div", "wx-tiles");
    const tile = (cls: string) => {
      const t = h("div", `wx-tile ${cls}`);
      tiles.append(t);
      return t;
    };
    const tWind = tile("wx-t-wind"),
      tVis = tile("wx-t-vis"),
      tCeil = tile("wx-t-ceil"),
      tPrecip = tile("wx-t-precip"),
      tCat = tile("wx-t-cat");
    tCat.dataset.testid = "weather-category";
    // ---- the cut
    const cutBox = h("div", "wx-cutbox");
    const cv = h("canvas", "wx-cut") as HTMLCanvasElement;
    cv.dataset.testid = "weather-cut";
    cutBox.append(cv);
    const section = new Section(cv);
    root.append(grid, head, tiles, cutBox);

    let state: { w: WeatherState; from: number; body: string; craftH: number | null } | null = null;
    const sync = () => {
      const s = H.settings;
      const place = H.place();
      // (no air here — space, Gargantua's side —: the preset shown at the Earth's equator, said so)
      const at = place ?? { body: "earth", lat: 0, lon: 0, days: 0, h: 0 };
      const w = weatherAt(s, at, at.days, H.real());
      const from = windFromAt(w, at, at.days);
      state = { w, from, body: at.body, craftH: place ? place.h : null };
      // the cards: which is on; what each would give here
      for (const [p, { b, sub }] of cards) {
        const on = p === s.weather;
        b.classList.toggle("on", on);
        b.setAttribute("aria-checked", String(on));
        const pw = p === "real" && !H.real() ? null : weatherAt({ ...s, weather: p }, at, at.days, H.real());
        if (pw) {
          const c = flightCategory(pw);
          sub.innerHTML = `<i class="wx-dot ${c.toLowerCase()}"></i>${c}`;
        } else sub.textContent = tr({ fr: "en attente", en: "pending" });
      }
      const name = BODY_NAMES[at.body as Body] ?? at.body;
      where.innerHTML = place
        ? `<b>${name}</b><span>${Math.abs(at.lat).toFixed(2)}° ${at.lat >= 0 ? "N" : "S"} · ${Math.abs(at.lon).toFixed(2)}° ${at.lon >= 0 ? "E" : "W"}</span>`
        : `<b>${tr({ fr: "Pas d'air ici", en: "No air here" })}</b><span>${tr({ fr: "le temps choisi vaudra pour le prochain monde à atmosphère", en: "the weather chosen holds for the next world with an atmosphere" })}</span>`;
      says.textContent =
        s.weather === "real"
          ? realSays(H.real(), H.realInfo?.())
          : s.weather === "dust" && at.body !== "mars"
            ? tr({
                fr: "La poussière, c'est Mars ; ici, du vent et une visibilité réduite.",
                en: "Dust is Mars's; here, wind and a shorter visibility.",
              })
            : at.body === "mars" && (s.weather === "rain" || s.weather === "storm")
              ? tr({
                  fr: "Pas de pluie sur Mars : son air trop mince et trop froid pour l'eau liquide — des nuages de glace, du vent.",
                  en: "No rain on Mars: its air too thin and cold for liquid water — ice clouds, wind.",
                })
              : at.body === "mars" && s.weather === "dust"
                ? tr({
                    fr: "Tempête de poussière : le ciel ocre et opaque, le soleil un disque pâle, l'horizon effacé.",
                    en: "A dust storm: the sky an opaque ochre, the sun a pale disc, the horizon gone.",
                  })
                : tr(HINTS[s.weather]);
      // the wind: a compass, its arrow where it blows to; the speed large; the gusts
      const gust = w.wind.gust > 0 ? `${(w.wind.u10 + w.wind.gust).toFixed(0)}` : "—";
      tWind.innerHTML = `<div class="wx-k">${tr({ fr: "Vent", en: "Wind" })}</div><div class="wx-wind">
        <svg class="wx-rose" viewBox="-30 -30 60 60" aria-hidden="true">
          <circle r="26" class="ring"/>${[0, 90, 180, 270].map((d) => `<line class="tick" x1="0" y1="-26" x2="0" y2="-21" transform="rotate(${d})"/>`).join("")}
          <text y="-14.5" class="n">N</text>
          <g transform="rotate(${(from + 180).toFixed(1)})"><path class="arrow" d="M0 -19 L5 -6 L1.6 -7.5 L1.6 17 L-1.6 17 L-1.6 -7.5 L-5 -6 Z"/></g>
        </svg>
        <div><div class="wx-big">${w.wind.u10.toFixed(0)}<small>m/s</small></div><div class="wx-sm">${String(Math.round(from)).padStart(3, "0")}° · ${tr({ fr: "rafales", en: "gusts" })} ${gust}</div></div></div>`;
      const [vv, vu] = dist(w.visibility);
      tVis.innerHTML = `<div class="wx-k">${tr({ fr: "Visibilité", en: "Visibility" })}</div><div class="wx-big">${vv}<small>${vu}</small></div>${gauge(w.visibility, [1609, 4828, 8047])}`;
      const ceil = ceilingOf(w);
      const deck = w.layers.find((l) => l.base === ceil);
      const [cv0, cu] = ceil === null ? ["—", ""] : dist(ceil);
      tCeil.innerHTML = `<div class="wx-k">${tr({ fr: "Plafond", en: "Ceiling" })}</div><div class="wx-big">${cv0}<small>${cu}</small></div>${gauge(ceil, [152, 305, 914])}<div class="wx-sm">${ceil === null ? tr({ fr: "aucun", en: "none" }) : deck ? coverWord(deck.cover) : tr({ fr: "brouillard", en: "fog" })}</div>`;
      const rainWord =
        w.dust > 0
          ? tr({ fr: "Poussière", en: "Dust" })
          : w.rain <= 0
            ? tr({ fr: "Aucune", en: "None" })
            : tr(
                w.rain >= 0.9
                  ? { fr: "Forte pluie", en: "Heavy rain" }
                  : w.rain >= 0.5
                    ? { fr: "Pluie", en: "Rain" }
                    : { fr: "Bruine", en: "Drizzle" },
              );
      const level = w.dust > 0 ? w.dust : w.rain;
      tPrecip.innerHTML = `<div class="wx-k">${tr({ fr: "Précipitations", en: "Precipitation" })}</div><div class="wx-mid">${rainWord}</div><div class="wx-bars">${[0.25, 0.5, 0.75, 1].map((k) => `<i class="${level >= k - 0.01 ? "on" : ""}${w.kind === "storm" ? " storm" : ""}"></i>`).join("")}</div>`;
      const cat = flightCategory(w);
      tCat.className = `wx-tile wx-t-cat ${cat.toLowerCase()}`;
      tCat.dataset.category = cat;
      tCat.innerHTML = `<div class="wx-k">${tr({ fr: "Catégorie", en: "Category" })}</div><div class="wx-badge">${cat}</div><div class="wx-sm">${tr(CAT_SAYS[cat])}</div>`;
    };
    sync();
    this.timer = window.setInterval(sync, 500);
    const frame = (now: number) => {
      if (state) section.draw(state.w, { from: state.from, body: state.body, craftH: state.craftH }, now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
}
