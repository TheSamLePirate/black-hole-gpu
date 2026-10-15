// The sea's state over the Earth (docs/PLAN-AVIATION-AAA.md, M1): Open-Meteo's marine model (keyless, CORS —
// marine-api.open-meteo.com: the significant height, period and direction of the wind's sea and of the swell, by
// hour, on its grid), a day per cell and UTC day fetched once — or, where it has nothing (inland, offline, the
// game's far dates), the sea the wind raises: a fully developed one (Pierson–Moskowitz: Hs ≈ 0.21 U²/g, Tp ≈ 0.73 U)
// limited by how long the wind has blown, and no swell.

import { cellOf, isoDay } from "../openmeteo";

const DAY = 86400e3;
const G = 9.81;
const HOURLY = [
  "wind_wave_height",
  "wind_wave_direction",
  "wind_wave_peak_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_peak_period",
  "wave_height",
];
/** the marine model's reach: two days back, a week ahead (its archive from 2022 on) */
const BACK = 92,
  AHEAD = 7,
  FROM = Date.UTC(2022, 0, 1);

/** A sea: its wind's sea and its swell — each a significant height [m], a peak period [s], the way it goes
 *  [rad, compass: from the north eastwards — 0 going north]. */
export interface SeaState {
  wind: { hs: number; tp: number; to: number };
  swell: { hs: number; tp: number; to: number };
  /** where it comes from: the marine model, or the wind alone */
  source: "marine" | "wind";
}

interface MarineHour {
  t: number;
  wh: number;
  wd: number;
  wp: number;
  sh: number;
  sd: number;
  sp: number;
}

/** The sea the wind raises: `u10` [m/s] blowing towards `to` [rad], fully developed, no swell. */
export function windSea(u10: number, to: number): SeaState {
  const U = Math.max(0.5, u10);
  return {
    wind: { hs: Math.min((0.21 * (U * U)) / G, 16), tp: Math.max(1.2, 0.73 * U), to },
    swell: { hs: 0, tp: 10, to },
    source: "wind",
  };
}

/** The marine model's URL for a cell and a day (null: out of its reach). */
export function marineUrl(lat: number, lon: number, ms: number, now: number): string | null {
  const day = Math.floor(ms / DAY) * DAY;
  const today = Math.floor(now / DAY) * DAY;
  if (day < FROM || day < today - BACK * DAY || day > today + AHEAD * DAY) return null;
  const d = isoDay(day);
  return `https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&start_date=${d}&end_date=${d}&hourly=${HOURLY.join(",")}&timezone=GMT`;
}

/** Its answer read into hours (a sea none where the model has none: on land, a lake). */
export function parseMarine(json: unknown): MarineHour[] | null {
  const j = json as { hourly?: Record<string, (number | string | null)[]>; error?: boolean };
  const h = j?.hourly;
  if (!h || j.error || !Array.isArray(h.time)) return null;
  const n = (k: string, i: number) => {
    const v = h[k]?.[i];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const out: MarineHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = Date.parse(`${h.time[i]}:00Z`);
    const wh = n("wind_wave_height", i) ?? n("wave_height", i);
    if (!Number.isFinite(t) || wh === null) continue;
    out.push({
      t,
      wh,
      wd: n("wind_wave_direction", i) ?? 0,
      wp: n("wind_wave_peak_period", i) ?? Math.max(2, 3.6 * Math.sqrt(wh)),
      sh: n("swell_wave_height", i) ?? 0,
      sd: n("swell_wave_direction", i) ?? n("wind_wave_direction", i) ?? 0,
      sp: n("swell_wave_peak_period", i) ?? 10,
    });
  }
  return out.length ? out : null;
}

/** The sea at ms between the hours about it (the directions the short way round). Directions in the model are
 *  where the waves come from: turned to where they go. */
export function marineAt(hours: MarineHour[], ms: number): SeaState | null {
  if (!hours.length) return null;
  let i = 0;
  while (i < hours.length - 2 && hours[i + 1]!.t < ms) i++;
  const a = hours[i]!,
    b = hours[Math.min(i + 1, hours.length - 1)]!;
  const f = b.t > a.t ? Math.min(1, Math.max(0, (ms - a.t) / (b.t - a.t))) : 0;
  const m = (x: number, y: number) => x + (y - x) * f;
  const ang = (x: number, y: number) => x + (((((y - x) % 360) + 540) % 360) - 180) * f;
  const to = (fromDeg: number) => (((fromDeg + 180) % 360) * Math.PI) / 180;
  return {
    wind: { hs: m(a.wh, b.wh), tp: Math.max(1.2, m(a.wp, b.wp)), to: to(ang(a.wd, b.wd)) },
    swell: { hs: m(a.sh, b.sh), tp: Math.max(4, m(a.sp, b.sp)), to: to(ang(a.sd, b.sd)) },
    source: "marine",
  };
}

/** The days fetched: one per cell and day, kept (today's renewed each hour, a failure retried in ten minutes);
 *  one request at a time. */
export class MarineFeed {
  private cache = new Map<string, { at: number; hours: MarineHour[] | null; pending?: Promise<unknown> }>();
  private busy = false;
  constructor(
    private get: (url: string) => Promise<unknown> = (url) =>
      fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    private now: () => number = () => Date.now(),
  ) {}

  /** The sea at a place and time if its day is here (null: not yet, or none — the wind's then); asks for it. */
  peek(lat: number, lon: number, ms: number): SeaState | null {
    const c = cellOf(lat, lon);
    const now = this.now();
    const url = marineUrl(c.lat, c.lon, ms, now);
    if (!url) return null;
    const key = `${c.lat},${c.lon},${isoDay(ms)}`;
    const hit = this.cache.get(key);
    const today = Math.abs(ms - now) < 2 * DAY;
    const fresh = hit && !hit.pending && now - hit.at < (hit.hours ? (today ? 60 : 1e9) : 10) * 60e3;
    const state = hit?.hours ? marineAt(hit.hours, ms) : null;
    if (fresh || hit?.pending || this.busy) return state;
    this.busy = true;
    const pending = this.get(url)
      .then((j) => parseMarine(j))
      .catch(() => null)
      .then((hours) => {
        this.cache.set(key, { at: this.now(), hours: hours ?? hit?.hours ?? null });
        this.busy = false;
      });
    this.cache.set(key, { at: now, hours: hit?.hours ?? null, pending });
    return state;
  }
}
