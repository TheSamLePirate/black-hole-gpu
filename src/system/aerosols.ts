// Q5 C3 — the day's aerosols (docs/PLAN-REFRACTION-HORIZONS.md Q5): the air's haze at a place and hour, its optical depth at
// 550 nm from the Copernicus Atmosphere Monitoring Service's forecasts and analyses (CAMS: 0.4° worldwide, 0.1° over Europe,
// hourly) through Open-Meteo's air-quality API (https://open-meteo.com/en/docs/air-quality-api — free for non-commercial use;
// its credit: CAMS ENSEMBLE and Open-Meteo, shown while it is drawn). The renderer gives it to the air's tables
// (earth-air.ts: the aerosols' extinction scaled to it) when the weather is the real one; else an ordinary day's, τ ≈ 0.028.
// Available from August 2022 (CAMS global) to 7 days ahead; outside, the ordinary day's.

/** the ordinary day's aerosol optical depth at 550 nm (the air's own: its aerosols' extinction 2.33e-5 /m over 1 200 m) */
export const AOD_DEFAULT = 0.028;
const AQ_FROM = Date.UTC(2022, 7, 1);
const DAY = 86400e3;

/** the cell a place's values are asked for: CAMS's global grid's 0.4° */
export function aerosolCell(lat: number, lon: number): { lat: number; lon: number } {
  const q = (v: number) => Math.round(v / 0.4) * 0.4;
  return { lat: +q(lat).toFixed(1), lon: +q(lon).toFixed(1) };
}

/** The air-quality request for a cell's UTC day (null: before CAMS's archive or more than 7 days ahead) */
export function aerosolUrl(lat: number, lon: number, ms: number, now: number): string | null {
  if (ms < AQ_FROM || ms > now + 7 * DAY) return null;
  const day = new Date(Math.floor(ms / DAY) * DAY).toISOString().slice(0, 10);
  return `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=aerosol_optical_depth&start_date=${day}&end_date=${day}&timezone=GMT`;
}

/** The day's hours: their UTC times [ms] and optical depths (the missing left out) */
export function parseAerosols(json: unknown): { t: number; aod: number }[] | null {
  const h = (json as { hourly?: { time?: string[]; aerosol_optical_depth?: (number | null)[] } })?.hourly;
  if (!h?.time || !h.aerosol_optical_depth) return null;
  const out: { t: number; aod: number }[] = [];
  h.time.forEach((s, i) => {
    const v = h.aerosol_optical_depth![i];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out.push({ t: Date.parse(`${s}:00Z`), aod: v });
  });
  return out.length ? out : null;
}

/** The optical depth at a time, between the hours (null: none near) */
export function aodAt(hours: { t: number; aod: number }[], ms: number): number | null {
  let a: { t: number; aod: number } | null = null,
    b: { t: number; aod: number } | null = null;
  for (const h of hours) {
    if (h.t <= ms && (!a || h.t > a.t)) a = h;
    if (h.t >= ms && (!b || h.t < b.t)) b = h;
  }
  if (a && b) return a.t === b.t ? a.aod : a.aod + ((b.aod - a.aod) * (ms - a.t)) / (b.t - a.t);
  const one = a ?? b;
  return one && Math.abs(one.t - ms) < 3 * 3600e3 ? one.aod : null;
}

/** The days asked: one per cell and UTC day, kept for the session (a failure five minutes); one request at a time */
export class AerosolFeed {
  private cache = new Map<string, { at: number; hours: { t: number; aod: number }[] | null; pending?: boolean }>();
  private busy = false;
  constructor(
    private get: (url: string) => Promise<unknown> = (url) =>
      fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    private now: () => number = () => Date.now(),
  ) {}
  /** The optical depth at a place and time if its day is here (null: not yet, or not to be had); asks for it otherwise */
  peek(lat: number, lon: number, ms: number): number | null {
    const c = aerosolCell(lat, lon);
    const url = aerosolUrl(c.lat, c.lon, ms, this.now());
    if (!url) return null;
    const key = `${c.lat},${c.lon},${Math.floor(ms / DAY)}`;
    const hit = this.cache.get(key);
    if (hit?.hours) return aodAt(hit.hours, ms);
    if (hit && (hit.pending || this.now() - hit.at < 5 * 60e3)) return null;
    if (this.busy) return null;
    this.busy = true;
    this.cache.set(key, { at: this.now(), hours: null, pending: true });
    this.get(url)
      .then((j) => parseAerosols(j))
      .catch(() => null)
      .then((hours) => {
        this.cache.set(key, { at: this.now(), hours });
        this.busy = false;
      });
    return null;
  }
}
