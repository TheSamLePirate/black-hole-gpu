// The weather (PLAN-METEO W2): its presets, a draw, the airfields' real one — chosen here (the HUD's Weather
// button, the pause menu); what is in force at the place below read out (the wind, its gusts, the
// visibility, the ceiling, the rain, the flight category as the charts colour it) and drawn as a vertical
// cut (weather-section.ts: the fog, the decks, the wind up the height).

import "./placepanel.css";
import type { Settings } from "../settings";
import { tr } from "../i18n";
import { BODY_NAMES, type Body } from "../targeting";
import { ceilingOf, flightCategory, WEATHER_PRESETS, type WeatherPreset, type WeatherState, weatherAt, windFromAt } from "../weather";
import { drawSection } from "./weather-section";
import { button, el as h, modal } from "./kit";

export interface WeatherHost {
  settings: Settings;
  /** the place whose weather it is (the controller's weatherPlace), or null: no air there */
  place(): { body: string; lat: number; lon: number; days: number; h: number } | null;
  /** the airfields' real weather when it came in, or null */
  real(): WeatherState | null;
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
  dust: { fr: "Poussière (Mars)", en: "Dust (Mars)" },
  random: { fr: "Aléatoire", en: "Random" },
  real: { fr: "Réelle (METAR)", en: "Real (METAR)" },
};

const HINTS: Record<WeatherPreset, { fr: string; en: string }> = {
  fair: {
    fr: "Le temps d'avant : votre vent (Réglages), la carte réelle des nuages",
    en: "As before: your wind (Settings), the real map of clouds",
  },
  cloudy: { fr: "Cumulus épars vers 1 200 m, vent modéré", en: "Scattered cumulus near 1,200 m, a moderate wind" },
  overcast: { fr: "Plafond bas à 600 m, une seconde couche à 4 km", en: "A low ceiling at 600 m, a second deck at 4 km" },
  fog: { fr: "Brouillard au sol, 300 m de visibilité, vent nul", en: "Fog on the ground, 300 m visibility, no wind" },
  rain: { fr: "Pluie sous une couche à 500 m, rafales, cisaillement", en: "Rain under a deck at 500 m, gusts, shear" },
  storm: { fr: "Cumulonimbus jusqu'à 9 km, forte pluie, rafales à 23 m/s", en: "Cumulonimbus to 9 km, heavy rain, gusts to 23 m/s" },
  windy: { fr: "15 m/s au sol, rafales et cisaillement en finale", en: "15 m/s at the ground, gusts and shear on the final" },
  dust: { fr: "Tempête de poussière : le ciel orangé, 2 km de visibilité", en: "A dust storm: an orange sky, 2 km visibility" },
  random: { fr: "Un temps plausible tiré pour le lieu et le jour", en: "A plausible weather drawn for the place and the day" },
  real: { fr: "Le METAR de l'aérodrome le plus proche (réseau)", en: "The nearest airfield's METAR (network)" },
};

/** The flight categories' colours, as the charts have them. */
const CAT_INK = { VFR: "#3ddc84", MVFR: "#4aa8ff", IFR: "#ff5a46", LIFR: "#d86bff" } as const;

export class WeatherPanel {
  private close: (() => void) | null = null;
  private timer = 0;

  constructor(private host: WeatherHost) {}

  get isOpen() {
    return !!this.close;
  }

  open() {
    if (this.close) return;
    const root = h("div", "pp wx");
    const m = modal({
      title: tr({ fr: "Météo", en: "Weather" }),
      body: [root],
      cls: "pp-frame",
      testid: "weather-panel",
      onClose: () => {
        this.close = null;
        clearInterval(this.timer);
      },
    });
    this.close = m.close;
    this.build(root);
  }

  private build(root: HTMLElement) {
    const H = this.host;
    const grid = h("div", "wx-presets");
    const btns = new Map<WeatherPreset, HTMLButtonElement>();
    for (const p of WEATHER_PRESETS) {
      const b = button({
        label: tr(NAMES[p]),
        testid: `weather-${p}`,
        onClick: () => {
          H.settings.weather = p;
          H.changed();
          sync();
        },
      });
      b.title = tr(HINTS[p]);
      btns.set(p, b);
      grid.append(b);
    }
    const where = h("p", "pp-note wx-where");
    const rows = h("div", "wx-rows");
    const cv = h("canvas", "wx-cut") as HTMLCanvasElement;
    cv.dataset.testid = "weather-cut";
    const note = h("p", "pp-note");
    root.append(h("div", "k-label pp-h", tr({ fr: "Le temps", en: "The weather" })), grid, where, rows, cv, note);

    const sync = () => {
      const s = H.settings;
      for (const [p, b] of btns) b.classList.toggle("on", p === s.weather);
      const place = H.place();
      // (no air here — space, Gargantua's side —: the preset shown at the Earth's equator, said so)
      const at = place ?? { body: "earth", lat: 0, lon: 0, days: 0, h: 0 };
      const w = weatherAt(s, at, at.days, H.real());
      const from = windFromAt(w, at, at.days);
      const name = BODY_NAMES[at.body as Body] ?? at.body;
      where.textContent = place
        ? `${name} · ${Math.abs(at.lat).toFixed(1)}° ${at.lat >= 0 ? "N" : "S"} ${Math.abs(at.lon).toFixed(1)}° ${at.lon >= 0 ? "E" : "W"}`
        : tr({
            fr: "Pas d'air ici : le temps choisi vaudra pour le prochain monde à atmosphère",
            en: "No air here: the weather chosen holds for the next world with an atmosphere",
          });
      const ceil = ceilingOf(w);
      const cat = flightCategory(w);
      const vis =
        w.visibility >= 10e3
          ? `${Math.round(w.visibility / 1000)} km`
          : w.visibility >= 1000
            ? `${(w.visibility / 1000).toFixed(1)} km`
            : `${w.visibility} m`;
      const rain =
        w.rain <= 0
          ? "—"
          : tr(
              w.rain >= 0.9
                ? { fr: "forte", en: "heavy" }
                : w.rain >= 0.5
                  ? { fr: "modérée", en: "moderate" }
                  : { fr: "faible", en: "light" },
            );
      const line = (k: string, v: string, attrs = "") => `<span>${k}</span><b${attrs}>${v}</b>`;
      rows.innerHTML =
        line(tr({ fr: "Vent", en: "Wind" }), `${String(Math.round(from)).padStart(3, "0")}° · ${w.wind.u10.toFixed(0)} m/s`) +
        line(tr({ fr: "Rafales", en: "Gusts" }), w.wind.gust > 0 ? `${(w.wind.u10 + w.wind.gust).toFixed(0)} m/s` : "—") +
        line(tr({ fr: "Visibilité", en: "Visibility" }), vis) +
        line(tr({ fr: "Plafond", en: "Ceiling" }), ceil === null ? tr({ fr: "aucun", en: "none" }) : `${ceil} m`) +
        line(tr({ fr: "Pluie", en: "Rain" }), rain) +
        line(tr({ fr: "Catégorie", en: "Category" }), cat, ` style="color:${CAT_INK[cat]}"`);
      rows.dataset.category = cat;
      note.textContent =
        s.weather === "real" && !H.real()
          ? tr({
              fr: "La météo réelle n'est pas encore arrivée : le beau temps en attendant.",
              en: "The real weather has not come in yet: fair weather meanwhile.",
            })
          : s.weather === "dust" && at.body !== "mars"
            ? tr({
                fr: "Une tempête de poussière, c'est sur Mars ; ailleurs, du vent et une visibilité réduite.",
                en: "A dust storm is Mars's; elsewhere, wind and a shorter visibility.",
              })
            : tr(HINTS[w.source === "random" ? "random" : s.weather]);
      drawSection(cv, w, { from, body: at.body });
    };
    sync();
    this.timer = window.setInterval(sync, 500);
  }
}
