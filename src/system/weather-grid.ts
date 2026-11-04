// Q5 C5 — the weather spatially consistent and dated (docs/PLAN-REFRACTION-HORIZONS.md Q5): about the camera, the real
// weather's model on a grid — 5 × 5 points 125 km apart (±250 km, the weather's own reach: trace.wgsl wxNear) — at the game's
// hour: the low, middle and high clouds' cover and the visibility, asked of Open-Meteo in one request (its coordinates in lists;
// the forecast within its reach, the ERA5 archive before — openmeteo.ts openMeteoUrl). The weather's layers keep the shape the
// camera's place gives them (their bases and tops, weather.ts); their cover at each point is the grid's there, bilinear
// (trace.wgsl wxGridCover): the clouds where the model has them 100 km away, not the camera's cover carried round it.
// No new binding: the grid in the tracer's table (gpu-tables.ts TABLE_WXGRID).
import { WXGRID_N } from "./weather-grid-layout";

export { WXGRID_N, WXGRID_VEC4S } from "./weather-grid-layout";

/** the points' spacing [m] */
export const WXGRID_STEP = 125e3;
const DAY = 86400e3;
const ARCHIVE_FROM = Date.UTC(1940, 0, 1);
const FORECAST_BACK = 90,
  FORECAST_AHEAD = 15;
const R = 6371e3;

/** A grid's points [°] about its centre: (i, j) i eastwards, j northwards from −2 to 2 — flat local offsets (125 km steps:
 *  the distances a flat east/north frame keeps within 0.2 %) */
export function gridPoints(lat: number, lon: number): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  const h = (WXGRID_N - 1) / 2;
  for (let j = 0; j < WXGRID_N; j++)
    for (let i = 0; i < WXGRID_N; i++) {
      const la = lat + (((j - h) * WXGRID_STEP) / R) * (180 / Math.PI);
      const lo = lon + (((i - h) * WXGRID_STEP) / (R * Math.max(Math.cos((lat * Math.PI) / 180), 0.05))) * (180 / Math.PI);
      out.push({ lat: Math.min(Math.max(la, -89.9), 89.9), lon: ((((lo + 180) % 360) + 360) % 360) - 180 });
    }
  return out;
}

/** A grid's centre: the camera's place snapped to 0.5° (a grid asked again as it leaves it, ~50 km) */
export function gridCentre(lat: number, lon: number): { lat: number; lon: number } {
  return { lat: Math.round(lat * 2) / 2, lon: Math.round(lon * 2) / 2 };
}

/** The request for a grid's UTC day (null: out of the model's reach) */
export function gridUrl(lat: number, lon: number, ms: number, now: number): { url: string; kind: "forecast" | "archive" } | null {
  const day = Math.floor(ms / DAY) * DAY;
  const today = Math.floor(now / DAY) * DAY;
  if (!(day >= ARCHIVE_FROM) || day > today + FORECAST_AHEAD * DAY) return null;
  const forecast = day >= today - FORECAST_BACK * DAY;
  const host = forecast ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
  const d = new Date(day).toISOString().slice(0, 10);
  const p = gridPoints(lat, lon);
  const hourly = forecast
    ? "cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility"
    : "cloud_cover_low,cloud_cover_mid,cloud_cover_high";
  const q = `latitude=${p.map((x) => x.lat.toFixed(2)).join(",")}&longitude=${p.map((x) => x.lon.toFixed(2)).join(",")}&start_date=${d}&end_date=${d}&hourly=${hourly}&timezone=GMT`;
  return { url: `${host}?${q}`, kind: forecast ? "forecast" : "archive" };
}

export interface GridHour {
  t: number;
  /** per point: low, middle, high cover (0…1), visibility [m] (NaN: not given — the archive) */
  v: Float32Array;
}

/** The answer (one structure a point, in the request's order) read into its hours */
export function parseGrid(json: unknown): GridHour[] | null {
  if (!Array.isArray(json) || json.length !== WXGRID_N * WXGRID_N) return null;
  const pts = json as { hourly?: Record<string, (number | string | null)[]> }[];
  const times = pts[0]?.hourly?.time as string[] | undefined;
  if (!times?.length) return null;
  const out: GridHour[] = [];
  for (let k = 0; k < times.length; k++) {
    const v = new Float32Array(4 * pts.length);
    let ok = true;
    pts.forEach((p, i) => {
      const n = (key: string) => {
        const x = p.hourly?.[key]?.[k];
        return typeof x === "number" && Number.isFinite(x) ? x : null;
      };
      const lo = n("cloud_cover_low"),
        mi = n("cloud_cover_mid"),
        hi = n("cloud_cover_high");
      if (lo === null || mi === null || hi === null) ok = false;
      v.set([(lo ?? 0) / 100, (mi ?? 0) / 100, (hi ?? 0) / 100, n("visibility") ?? Number.NaN], 4 * i);
    });
    if (ok) out.push({ t: Date.parse(`${times[k]}:00Z`), v });
  }
  return out.length ? out : null;
}

/** The grid at a time, between its hours (null: no hour within 3 h) */
export function gridAt(hours: GridHour[], ms: number): Float32Array | null {
  let a: GridHour | null = null,
    b: GridHour | null = null;
  for (const h of hours) {
    if (h.t <= ms && (!a || h.t > a.t)) a = h;
    if (h.t >= ms && (!b || h.t < b.t)) b = h;
  }
  if (a && b) {
    if (a.t === b.t) return a.v;
    const f = (ms - a.t) / (b.t - a.t);
    return a.v.map((x, i) => x + (b!.v[i]! - x) * f);
  }
  const one = a ?? b;
  return one && Math.abs(one.t - ms) < 3 * 3600e3 ? one.v : null;
}

/** The days asked: one per centre and UTC day, kept for the session (a failure five minutes); one request at a time */
export class WeatherGridFeed {
  private cache = new Map<string, { at: number; hours: GridHour[] | null; pending?: boolean }>();
  private busy = false;
  constructor(
    private get: (url: string) => Promise<unknown> = (url) =>
      fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    private now: () => number = () => Date.now(),
  ) {}
  /** The grid about a place at a time if its day is here — its centre and its points' values —; asks for it otherwise */
  peek(lat: number, lon: number, ms: number): { centre: { lat: number; lon: number }; v: Float32Array } | null {
    const c = gridCentre(lat, lon);
    const where = gridUrl(c.lat, c.lon, ms, this.now());
    if (!where) return null;
    const key = `${c.lat},${c.lon},${Math.floor(ms / DAY)}`;
    const hit = this.cache.get(key);
    if (hit?.hours) {
      const v = gridAt(hit.hours, ms);
      return v ? { centre: c, v } : null;
    }
    if (hit && (hit.pending || this.now() - hit.at < 5 * 60e3)) return null;
    if (this.busy) return null;
    this.busy = true;
    this.cache.set(key, { at: this.now(), hours: null, pending: true });
    this.get(where.url)
      .then((j) => parseGrid(j))
      .catch(() => null)
      .then((hours) => {
        this.cache.set(key, { at: this.now(), hours });
        this.busy = false;
      });
    return null;
  }
}
