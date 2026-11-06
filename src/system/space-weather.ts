// The real space weather for the Earth's auroras (PLAN-AURORES-MAGNETOSPHERES AM1, Sam's decision 2): NOAA SWPC's planetary K
// index — its latest 3-hour estimate — used instead of the "Auroras" setting while the scene's clock is within 3 h of now
// (the setting the fallback: offline, a scene in the past or the future, a feed gone stale). Refreshed every 15 min.
//
// The feed's schema validated, not assumed: since NOAA's 2026 change (SCN 26-21) `products/noaa-planetary-k-index.json` is an
// array of objects {time_tag, Kp, a_running, station_count}; before, an array of arrays under a header row — both read, any
// other refused. Its time_tag UTC (no zone written). Kp is an index on 3 h: a value hours old is its nature, not a fault; past
// 12 h it is dropped.

export const KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
/** how often it is asked again [ms]; past how old its last value is dropped [ms]; how near now the scene must be [ms] */
const REFRESH_MS = 15 * 60_000;
const STALE_MS = 12 * 3_600_000;
export const LIVE_WINDOW_MS = 3 * 3_600_000;

export interface KpReading {
  kp: number;
  /** the value's own time (its 3-hour interval's start, UTC) [ms] */
  at: number;
}

/** The feed's last valid reading, from its JSON — the 2026 objects or the older table —; null: nothing usable. */
export function parseKp(json: unknown): KpReading | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const rows: { t: unknown; kp: unknown }[] = [];
  if (Array.isArray(json[0])) {
    const head = (json[0] as unknown[]).map((x) => String(x).toLowerCase());
    const it = head.indexOf("time_tag"),
      ik = head.indexOf("kp");
    if (it < 0 || ik < 0) return null;
    for (const r of json.slice(1)) if (Array.isArray(r)) rows.push({ t: r[it], kp: r[ik] });
  } else
    for (const r of json)
      if (r && typeof r === "object") rows.push({ t: (r as { time_tag?: unknown }).time_tag, kp: (r as { Kp?: unknown }).Kp });
  for (let i = rows.length - 1; i >= 0; i--) {
    // (an interval not yet measured: its Kp null — Number(null) is 0, a quiet sky that was not)
    const raw = rows[i]!.kp;
    if (raw === null || raw === undefined || raw === "") continue;
    const kp = Number(raw);
    const t =
      typeof rows[i]!.t === "string"
        ? Date.parse(`${(rows[i]!.t as string).replace(" ", "T")}${/Z|[+-]\d\d:?\d\d$/.test(rows[i]!.t as string) ? "" : "Z"}`)
        : Number.NaN;
    if (Number.isFinite(kp) && kp >= 0 && kp <= 9 && Number.isFinite(t)) return { kp, at: t };
  }
  return null;
}

let last: KpReading | null = null;
let askedAt = -Infinity;
let pending = false;
/** the last error said (none: "") */
export let kpError = "";

/** asks the feed again when due (fire and forget) */
export function refreshKp(now = Date.now()) {
  if (pending || now - askedAt < REFRESH_MS || typeof fetch !== "function") return;
  askedAt = now;
  pending = true;
  fetch(KP_URL, { signal: AbortSignal.timeout(20_000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => {
      const k = parseKp(j);
      if (k) {
        last = k;
        kpError = "";
      } else kpError = "the feed's format not understood";
    })
    .catch((e) => (kpError = String((e as Error).message ?? e)))
    .finally(() => (pending = false));
}

/**
 * The Kp to draw at the scene's time `sceneMs` (UTC ms): the live one when the scene is within LIVE_WINDOW_MS of now and the
 * feed's last value is under 12 h old — and where it came from —, else the setting's.
 */
export function kpFor(
  sceneMs: number,
  setting: number,
  live: boolean,
  now = Date.now(),
): { kp: number; source: "live" | "setting"; ageMin?: number } {
  if (live && Math.abs(sceneMs - now) < LIVE_WINDOW_MS) {
    refreshKp(now);
    if (last && now - last.at < STALE_MS) return { kp: last.kp, source: "live", ageMin: Math.round((now - last.at) / 60_000) };
  }
  return { kp: setting, source: "setting" };
}

/** (tests) the reading held, set or cleared */
export function setKpReading(k: KpReading | null) {
  last = k;
  askedAt = k ? Date.now() : -Infinity;
}
