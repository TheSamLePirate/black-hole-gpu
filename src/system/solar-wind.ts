// The real solar wind at the Earth (RECHERCHE-DONNEES-SCIENTIFIQUES-AAA-2026-11-03 § 4.2, lot C; PLAN-AURORES-MAGNETOSPHERES
// AM7): NOAA SWPC's solar wind measured at L1 and propagated to the Earth's bow shock — its density, speed and IMF Bz (GSM) —,
// which places the magnetopause by Shue et al. 1998 (JGR 103, A8, 17691, doi:10.1029/98JA01103):
//   r0 = (10.22 + 1.29 tanh(0.184 (Bz + 8.14))) · Pd^(−1/6.6),   α = (0.58 − 0.007 Bz) (1 + 0.024 ln Pd),
// Pd the dynamic pressure [nPa] = 1.6726·10⁻⁶ · n [cm⁻³] · v² [km/s]² (protons alone: the model's calibration). The bow shock's
// nose at 1.3 r0 — a typical ratio at high Mach (gas-dynamic), a diagram's value, labelled as such.
//
// The 1-hour product (6–7 kB, already propagated: the L1 → Earth delay is not applied twice) — its legacy table (a header row,
// then rows) and the 2026 object rows (NOAA SCN 26-21: `proton_density`, `proton_speed`, `bz_gsm`) both read. Three states:
// "live" (the scene within 3 h of now, the feed's last row under 3 h old), "stale" (a reading kept past that: not shown as
// live), "typical" (no data: Pd 2 nPa, Bz 0 — never an invented observation).

export const SW_URL = "https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind-1-hour.json";
const REFRESH_MS = 10 * 60_000;
const LIVE_WINDOW_MS = 3 * 3600_000;
const STALE_MS = 3 * 3600_000;

export interface SwReading {
  /** the propagated time [UTC ms]: when this wind reaches the Earth's bow shock */
  t: number;
  n: number;
  v: number;
  bz: number;
}

const num = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : Number.NaN);
const time = (x: unknown) => (typeof x === "string" ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(x) ? x : `${x.replace(" ", "T")}Z`) : Number.NaN);

/** the feed's rows, valid ones only (both formats), oldest first */
export function parseSolarWind(json: unknown): SwReading[] {
  if (!Array.isArray(json) || json.length === 0) return [];
  const out: SwReading[] = [];
  if (Array.isArray(json[0])) {
    const h = (json[0] as unknown[]).map(String);
    const col = (k: string) => h.indexOf(k);
    const [it, ip, id, iv, ib] = [col("time_tag"), col("propagated_time_tag"), col("density"), col("speed"), col("bz")];
    if (id < 0 || iv < 0 || ib < 0 || (ip < 0 && it < 0)) return [];
    for (const r of json.slice(1) as unknown[][]) {
      out.push({ t: time(r[ip >= 0 ? ip : it]), n: num(r[id]), v: num(r[iv]), bz: num(r[ib]) });
    }
  } else {
    for (const r of json as Record<string, unknown>[]) {
      if (r.active === false) continue;
      out.push({
        t: time(r.propagated_time_tag ?? r.time_tag),
        n: num(r.proton_density ?? r.density),
        v: num(r.proton_speed ?? r.speed),
        bz: num(r.bz_gsm ?? r.bz),
      });
    }
  }
  return out
    .filter((r) => Number.isFinite(r.t) && r.n > 0 && r.n < 200 && r.v > 100 && r.v < 3000 && Math.abs(r.bz) < 200)
    .sort((a, b) => a.t - b.t);
}

/** the dynamic pressure [nPa] of a proton wind of density n [cm⁻³] and speed v [km/s] */
export const dynamicPressure = (n: number, v: number) => 1.6726e-6 * n * v * v;

/** Shue et al. 1998: the magnetopause's subsolar distance [R_E] and flaring, for Pd [nPa] and IMF Bz [nT, GSM] */
export function shue98(pd: number, bz: number): { r0: number; alpha: number } {
  const p = Math.max(pd, 0.05);
  return {
    r0: (10.22 + 1.29 * Math.tanh(0.184 * (bz + 8.14))) * p ** (-1 / 6.6),
    alpha: (0.58 - 0.007 * bz) * (1 + 0.024 * Math.log(p)),
  };
}

export interface SolarWindState {
  source: "live" | "stale" | "typical";
  pd: number;
  bz: number;
  n: number;
  v: number;
  /** the magnetopause's nose and flaring, the bow shock's nose [R_E] */
  r0: number;
  alpha: number;
  shock: number;
  /** the reading's age [min] (live, stale) */
  ageMin?: number;
}

let rows: SwReading[] = [];
let askedAt = -Infinity;
let pending = false;
/** the last error said (none: "") */
export let solarWindError = "";

/** asks the feed again when due (fire and forget) */
export function refreshSolarWind(now = Date.now()) {
  if (pending || now - askedAt < REFRESH_MS || typeof fetch !== "function") return;
  askedAt = now;
  pending = true;
  fetch(SW_URL, { signal: AbortSignal.timeout(20_000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => {
      const got = parseSolarWind(j);
      if (got.length) {
        rows = got;
        solarWindError = "";
      } else solarWindError = "the feed's format not understood";
    })
    .catch((e) => (solarWindError = String((e as Error).message ?? e)))
    .finally(() => (pending = false));
}

const state = (source: SolarWindState["source"], n: number, v: number, bz: number, ageMin?: number): SolarWindState => {
  const pd = dynamicPressure(n, v);
  const s = shue98(pd, bz);
  return { source, pd, bz, n, v, r0: s.r0, alpha: s.alpha, shock: 1.3 * s.r0, ageMin };
};

/** the typical wind: 5 cm⁻³ at 400 km/s (Pd 1.34 nPa), Bz 0 */
export const TYPICAL_WIND = state("typical", 5, 400, 0);

/**
 * The solar wind at the Earth at the scene's time `sceneMs` (UTC ms): the feed's row nearest it when the scene is within 3 h of
 * now and the feed's last row is under 3 h old (live); the last reading past that (stale: kept, said so); else the typical.
 */
export function solarWindFor(sceneMs: number, now = Date.now()): SolarWindState {
  if (Math.abs(sceneMs - now) < LIVE_WINDOW_MS) refreshSolarWind(now);
  if (!rows.length) return TYPICAL_WIND;
  const last = rows[rows.length - 1]!;
  let best = last;
  for (const r of rows) if (Math.abs(r.t - sceneMs) < Math.abs(best.t - sceneMs)) best = r;
  const live = Math.abs(sceneMs - now) < LIVE_WINDOW_MS && now - last.t < STALE_MS;
  const age = Math.round((now - best.t) / 60_000);
  return state(live ? "live" : "stale", best.n, best.v, best.bz, age);
}

/** (tests) the rows held, set or cleared */
export function setSolarWindRows(r: SwReading[]) {
  rows = r;
  askedAt = r.length ? Date.now() : -Infinity;
}
