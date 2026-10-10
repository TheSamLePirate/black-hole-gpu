// The real weather anywhere on the Earth, at the game's date (PLAN-CIEL C1): Open-Meteo's — free, no key,
// served to any page (access-control-allow-origin: *, checked 10/10/2026). Its forecast reaches 92 days back
// and 15 ahead; its archive (ERA5, the reanalysis) the hours since 1940 (no visibility there: guessed from
// the air's moisture and what falls). One day of hours per cell of 0.25° (the models' own grid), decoded
// at the game's time — between two hours, the weather between — into the weather's state (weather.ts): the
// low clouds' base where the air condenses (125 m per degree between the air and its dew point), the middle
// and high decks, the visibility, the rain (its millimetres an hour), a storm (WMO codes 95–99, the
// convection's energy), fog (45, 48, or under a kilometre), the wind at 10 m and its gusts; and what the
// sky's refraction needs (C3): the air's temperature and pressure at the ground.

import type { CloudLayer, WeatherState } from "./weather";

const DAY = 86400e3;
/** the forecast's reach about today [days] (Open-Meteo's: 92 back, 16 ahead — a margin kept) */
export const FORECAST_BACK = 90;
export const FORECAST_AHEAD = 15;
/** the archive's first day (ERA5) */
export const ARCHIVE_FROM = Date.UTC(1940, 0, 1);

const HOURLY = [
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",
  "visibility",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "temperature_2m",
  "dew_point_2m",
  "surface_pressure",
  "cape",
] as const;

/** One hour of the model at a place. */
export interface ModelHour {
  /** its time [ms, UTC] */
  t: number;
  /** the low, middle and high clouds' cover (0…1) */
  low: number;
  mid: number;
  high: number;
  /** the visibility [m] (null: not given — the archive) */
  vis: number | null;
  /** what falls [mm/h] */
  precip: number;
  /** the WMO weather code (0 clear … 95–99 thunderstorm) */
  code: number;
  /** the wind at 10 m [m/s], where it blows from [°], its gusts [m/s] */
  u10: number;
  dir: number;
  gust: number;
  /** the air at 2 m and its dew point [°C], the pressure at the ground [hPa], the convection's energy [J/kg] */
  T: number;
  Td: number;
  p: number;
  cape: number;
}

/** A place's cell (the models' 0.25° grid): its centre [°]. */
export function cellOf(lat: number, lon: number): { lat: number; lon: number } {
  const r = (x: number) => Math.round(x * 4) / 4;
  return { lat: Math.min(Math.max(r(lat), -90), 90), lon: ((((r(lon) + 180) % 360) + 360) % 360) - 180 };
}

/** A day's UTC date, "YYYY-MM-DD". */
export const isoDay = (ms: number) => new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);

/**
 * Where a day's hours are served for a place: the forecast within its reach of today, the archive before;
 * null: out of reach (before 1940, beyond the forecast — the game's 2067).
 */
export function openMeteoUrl(lat: number, lon: number, ms: number, now: number): { url: string; kind: "forecast" | "archive" } | null {
  const day = Math.floor(ms / DAY) * DAY;
  const today = Math.floor(now / DAY) * DAY;
  if (!(day >= ARCHIVE_FROM) || day > today + FORECAST_AHEAD * DAY) return null;
  const forecast = day >= today - FORECAST_BACK * DAY;
  const host = forecast ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
  const d = isoDay(day);
  const q = `latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&start_date=${d}&end_date=${d}&hourly=${HOURLY.join(",")}&wind_speed_unit=ms&timezone=GMT`;
  return { url: `${host}?${q}`, kind: forecast ? "forecast" : "archive" };
}

/** Open-Meteo's answer read into its hours (a missing value: the hour skipped, or a default where one fits). */
export function parseOpenMeteo(json: unknown): { hours: ModelHour[]; elevation: number } | null {
  const j = json as { hourly?: Record<string, (number | string | null)[]>; elevation?: number; error?: boolean };
  const h = j?.hourly;
  if (!h || j.error || !Array.isArray(h.time)) return null;
  const n = (k: string, i: number) => {
    const v = h[k]?.[i];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const hours: ModelHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = Date.parse(`${h.time[i]}:00Z`);
    const low = n("cloud_cover_low", i),
      u10 = n("wind_speed_10m", i),
      T = n("temperature_2m", i);
    if (!Number.isFinite(t) || low === null || u10 === null || T === null) continue;
    hours.push({
      t,
      low: low / 100,
      mid: (n("cloud_cover_mid", i) ?? 0) / 100,
      high: (n("cloud_cover_high", i) ?? 0) / 100,
      vis: n("visibility", i),
      precip: n("precipitation", i) ?? 0,
      code: n("weather_code", i) ?? 0,
      u10,
      dir: n("wind_direction_10m", i) ?? 0,
      gust: n("wind_gusts_10m", i) ?? u10,
      T,
      Td: n("dew_point_2m", i) ?? T - 8,
      p: n("surface_pressure", i) ?? 1013.25,
      cape: n("cape", i) ?? 0,
    });
  }
  return hours.length ? { hours, elevation: typeof j.elevation === "number" ? j.elevation : 0 } : null;
}

/** The hour at ms: between the two about it, the weather between (the wind's direction the short way round,
 *  the code the nearer hour's); before the first or after the last, that one. */
export function hourAt(hours: ModelHour[], ms: number): ModelHour | null {
  if (!hours.length) return null;
  if (ms <= hours[0]!.t) return hours[0]!;
  const last = hours[hours.length - 1]!;
  if (ms >= last.t) return last;
  let i = 0;
  while (hours[i + 1]!.t < ms) i++;
  const a = hours[i]!,
    b = hours[i + 1]!;
  const f = (ms - a.t) / (b.t - a.t);
  const m = (x: number, y: number) => x + (y - x) * f;
  const dd = ((((b.dir - a.dir) % 360) + 540) % 360) - 180;
  return {
    t: ms,
    low: m(a.low, b.low),
    mid: m(a.mid, b.mid),
    high: m(a.high, b.high),
    vis: a.vis !== null && b.vis !== null ? m(a.vis, b.vis) : (a.vis ?? b.vis),
    precip: m(a.precip, b.precip),
    code: f < 0.5 ? a.code : b.code,
    u10: m(a.u10, b.u10),
    dir: (((a.dir + dd * f) % 360) + 360) % 360,
    gust: m(a.gust, b.gust),
    T: m(a.T, b.T),
    Td: m(a.Td, b.Td),
    p: m(a.p, b.p),
    cape: m(a.cape, b.cape),
  };
}

/** The model's own facts kept with the state it gave: what the panel, TARS and the refraction read. */
export interface ModelFacts {
  provider: "open-meteo";
  kind: "forecast" | "archive";
  /** the cell [°], the hour [ms UTC] */
  lat: number;
  lon: number;
  t: number;
  T: number;
  Td: number;
  p: number;
  high: number;
  code: number;
  precip: number;
}

const STORM = new Set([95, 96, 99]);
const FOG = new Set([45, 48]);

/**
 * An hour of the model as the weather's state: the low deck's base where the air condenses (the lifting
 * condensation level, 125 m per degree of spread, 150 m … 2.5 km), deep as the air is unstable (a towering
 * cumulus with some convective energy, a cumulonimbus in a storm), the middle deck 3–4.5 km, the high one
 * (cirrus, thin) 8–9.5 km when no lower takes its place; the visibility (the archive's guessed: 30 km in dry
 * air, less as it nears saturation and as it rains); the rain 0.3 √(mm/h) (1 mm/h light, 4 moderate, 9 and
 * more heavy); fog lying under a kilometre's visibility or by its code.
 */
export function modelWeather(
  h: ModelHour,
  kind: "forecast" | "archive" = "forecast",
  at: { lat: number; lon: number } = { lat: 0, lon: 0 },
): WeatherState {
  const spread = Math.max(h.T - h.Td, 0);
  const storm = STORM.has(h.code);
  const lcl = Math.min(Math.max(125 * spread, 150), 2500);
  const layers: CloudLayer[] = [];
  if (h.low >= 0.08) {
    const depth = storm ? Math.max(9000 - lcl, 6000) : h.cape > 800 ? 3000 : h.cape > 200 ? 1600 : 700 + 600 * h.low;
    layers.push({ base: Math.round(lcl), top: Math.round(lcl + depth), cover: Math.min(h.low, 1) });
  }
  if (h.mid >= 0.08) layers.push({ base: 3000, top: 4500, cover: Math.min(h.mid, 1) });
  if (h.high >= 0.25 && layers.length < 2) layers.push({ base: 8000, top: 8800, cover: Math.min(h.high, 1) * 0.6 });
  // (the archive has no visibility: 30 km in dry air, a tenth as it saturates, shorter in rain)
  const rh = Math.exp((17.62 * h.Td) / (243.12 + h.Td) - (17.62 * h.T) / (243.12 + h.T));
  let vis = h.vis ?? 30e3 * (1 - 0.9 * Math.max((rh - 0.7) / 0.3, 0) ** 2);
  if (h.vis === null && h.precip > 0) vis = Math.min(vis, 12e3 / (1 + h.precip));
  vis = Math.min(Math.max(vis, 50), 50e3);
  const fog = FOG.has(h.code) || vis < 1000;
  const rain = h.precip >= 0.1 || storm ? Math.min(Math.max(0.3 * Math.sqrt(h.precip), storm ? 0.8 : 0.1), 1) : 0;
  const gust = Math.max(h.gust - h.u10, 0);
  const low = layers.find((l) => l.cover >= 0.75 && l.base < 6000);
  const kindOf: WeatherState["kind"] = storm
    ? "storm"
    : fog
      ? "fog"
      : rain > 0
        ? "rain"
        : low
          ? "overcast"
          : layers.length
            ? "cloudy"
            : h.u10 > 10
              ? "windy"
              : "fair";
  const facts: ModelFacts = {
    provider: "open-meteo",
    kind,
    lat: at.lat,
    lon: at.lon,
    t: h.t,
    T: h.T,
    Td: h.Td,
    p: h.p,
    high: h.high,
    code: h.code,
    precip: h.precip,
  };
  const pct = (x: number) => Math.round(x * 100);
  return {
    source: "model",
    kind: kindOf,
    wind: {
      u10: h.u10,
      from: h.u10 < 0.5 ? null : Math.round(h.dir),
      gust,
      turb: storm ? 3 : h.u10 + gust > 15 ? 3 : h.u10 + gust > 9 ? 2 : h.u10 > 3 ? 1 : 0,
      shear: Math.min(gust * 0.5, 6),
    },
    visibility: Math.round(vis),
    fogTop: fog ? (vis < 400 ? 150 : 80) : 0,
    layers: layers.slice(0, 3),
    rain,
    dust: 0,
    report: `Open-Meteo ${kind === "archive" ? "ERA5" : "forecast"} ${new Date(h.t).toISOString().slice(0, 16)}Z ${at.lat.toFixed(2)},${at.lon.toFixed(2)} — clouds ${pct(h.low)}/${pct(h.mid)}/${pct(h.high)} % · ${h.precip.toFixed(1)} mm/h · wind ${Math.round(h.dir)}° ${h.u10.toFixed(1)} m/s G${h.gust.toFixed(1)} · ${h.T.toFixed(1)}/${h.Td.toFixed(1)} °C · ${Math.round(h.p)} hPa · WMO ${h.code}`,
    model: facts,
  };
}

/**
 * The days fetched: one per cell and UTC day, kept for the session (a forecast's day for today half an
 * hour: it is renewed), a failure five minutes; one request at a time.
 */
export class OpenMeteoFeed {
  private cache = new Map<
    string,
    { at: number; v: { hours: ModelHour[]; kind: "forecast" | "archive" } | null; pending?: Promise<unknown> }
  >();
  private busy = false;
  constructor(
    private get: (url: string) => Promise<unknown> = (url) =>
      fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    private now: () => number = () => Date.now(),
  ) {}

  /** The state at a place and time if its day is here (null: not here, not reachable); fetches it otherwise
   *  (`fetched` resolves when it lands). */
  peek(lat: number, lon: number, ms: number): { state: WeatherState | null; reachable: boolean; fetched?: Promise<unknown> } {
    const c = cellOf(lat, lon);
    const now = this.now();
    const where = openMeteoUrl(c.lat, c.lon, ms, now);
    if (!where) return { state: null, reachable: false };
    const key = `${c.lat},${c.lon},${isoDay(ms)}`;
    const hit = this.cache.get(key);
    const today = Math.abs(ms - now) < 2 * DAY;
    const fresh = hit && !hit.pending && now - hit.at < (hit.v ? (today ? 30 : 1e9) : 5) * 60e3;
    const h = hit?.v ? hourAt(hit.v.hours, ms) : null;
    const state = h && hit?.v ? modelWeather(h, hit.v.kind, c) : null;
    // (a day here, fresh or being renewed: as it is; stale: as it is meanwhile, renewed)
    if (fresh || hit?.pending || this.busy) return { state, reachable: true, fetched: hit?.pending };
    this.busy = true;
    const pending = this.get(where.url)
      .then((j) => parseOpenMeteo(j))
      .catch(() => null)
      .then((p) => {
        this.cache.set(key, { at: this.now(), v: p ? { hours: p.hours, kind: where.kind } : (hit?.v ?? null) });
        this.busy = false;
      });
    this.cache.set(key, { at: now, v: hit?.v ?? null, pending });
    return { state, reachable: true, fetched: pending };
  }
}

/** The model's state at a place and time, waiting for its day to land (a few tries). */
export async function modelWeatherAt(
  feed: OpenMeteoFeed,
  lat: number,
  lon: number,
  ms: number,
): Promise<{ state: WeatherState | null; reachable: boolean }> {
  for (let i = 0; i < 4; i++) {
    const r = feed.peek(lat, lon, ms);
    if (r.state || !r.reachable) return r;
    await (r.fetched ?? new Promise((ok) => setTimeout(ok, 400)));
  }
  return feed.peek(lat, lon, ms);
}
