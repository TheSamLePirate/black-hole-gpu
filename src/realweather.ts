// The real weather chosen (PLAN-CIEL C1): where it comes from, for a place and the game's date —
//  - an airfield's METAR (metar.ts) when the game's date is now (within two hours) and a runway's station
//    within 60 km: a measure;
//  - else Open-Meteo's model (openmeteo.ts) anywhere on the Earth, its forecast or its archive since 1940;
//  - out of their reach (before 1940, beyond the forecast: the game's 2067…), and on the other worlds: a
//    plausible weather drawn for the place and the day (weather.ts randomWeather), said so.
// The states it gave are its own (owns): one set by a script (the flight lab's, an e2e's) is kept.

import { MetarFeed, nearestStation } from "./metar";
import { OpenMeteoFeed } from "./openmeteo";
import { randomWeather, type WeatherState } from "./weather";
import type { WindLevel } from "./wind";

const DAY = 86400e3;
const J2000 = Date.UTC(2000, 0, 1, 12);
/** a game's days past J2000 as a UTC time [ms] */
export const msOfDays = (days: number) => J2000 + days * DAY;

/** Why the real weather is what it is. */
export type RealWhy = "metar" | "model" | "pending" | "out-of-range" | "other-world" | "high";

export interface RealInfo {
  why: RealWhy;
  /** the station read (METAR) */
  station?: { icao: string; name: string; km: number };
  /** the game's time it is for [ms UTC] */
  t: number;
}

export class RealWeather {
  private made = new WeakSet<WeatherState>();
  private metarLast = new Map<string, WeatherState | null>();
  /** the last state given, and why */
  last: { state: WeatherState | null; info: RealInfo } = { state: null, info: { why: "pending", t: 0 } };
  /** called when a request lands (the caller asks again) */
  onUpdate: () => void = () => {};

  constructor(
    private metar = new MetarFeed(),
    private model = new OpenMeteoFeed(),
    private now: () => number = () => Date.now(),
  ) {}

  /** The model's weather at another place, the same game's day (the map's stations): fetched when not in;
   *  null meanwhile, or out of its reach. */
  modelAt(lat: number, lon: number, days: number): WeatherState | null {
    const t = Math.round(msOfDays(days) / 600e3) * 600e3;
    const m = this.model.peek(lat, lon, t);
    m.fetched?.then(() => this.onUpdate());
    return m.state;
  }

  /** A state this gave (not one set by a script). */
  owns(w: WeatherState | null): boolean {
    return !!w && this.made.has(w);
  }

  private mine(w: WeatherState): WeatherState {
    this.made.add(w);
    return w;
  }

  /**
   * The real weather at a place (its height over the ground h [m]) and the game's day: the state (null:
   * pending, the fair weather meanwhile) and why. Above 40 km nothing is fetched (the image's weather fades
   * out from 15 km): the last state kept.
   */
  at(
    place: { body: string; lat: number; lon: number; days: number; h: number },
    wind: WindLevel,
  ): { state: WeatherState | null; info: RealInfo } {
    // (the model's hours read at ten minutes' steps: the image not redone each game minute)
    const t = Math.round(msOfDays(place.days) / 600e3) * 600e3;
    const give = (state: WeatherState | null, info: RealInfo) => (this.last = { state, info });
    if (place.body !== "earth")
      return give(this.mine(randomWeather(place.body, place.lat, place.lon, place.days, wind)), { why: "other-world", t });
    if (place.h > 40e3) return give(this.last.state, { ...this.last.info, why: this.last.state ? this.last.info.why : "high", t });
    // (now, near a runway's station: its METAR)
    if (Math.abs(t - this.now()) < 2 * 3600e3) {
      const st = nearestStation(place, 60);
      if (st) {
        // (the feed keeps each report half an hour: asked at each call, told when it changes)
        void this.metar.weather(st.icao).then((w) => {
          const was = this.metarLast.get(st.icao);
          if (this.metarLast.has(st.icao) && w?.report === was?.report) return;
          this.metarLast.set(st.icao, w ? this.mine(w) : null);
          this.onUpdate();
        });
        const w = this.metarLast.get(st.icao);
        if (w) return give(w, { why: "metar", station: { icao: st.icao, name: st.site.name.split(",")[0]!, km: st.km }, t });
      }
    }
    const m = this.model.peek(place.lat, place.lon, t);
    m.fetched?.then(() => this.onUpdate());
    if (!m.reachable) return give(this.mine(randomWeather("earth", place.lat, place.lon, place.days, wind)), { why: "out-of-range", t });
    if (m.state) {
      // (the same hour's state as the last one: that one, the image not redone)
      const prev = this.last.state;
      if (prev && prev.report === m.state.report) return give(prev, { why: "model", t });
      return give(this.mine(m.state), { why: "model", t });
    }
    return give(this.last.info.why === "model" ? this.last.state : null, { why: "pending", t });
  }
}
