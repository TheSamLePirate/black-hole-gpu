// The real weather (PLAN-METEO W7): an airfield's METAR — metar.vatsim.net's, served to any page
// (access-control-allow-origin: *), no key — decoded into the weather's state (weather.ts): the wind (its
// direction, speed, gusts; VRB: turning), the visibility (metres, statute miles, CAVOK), what falls or hangs
// (RA, DZ, SH, TS, FG, BR, HZ, DU…), the cloud layers (FEW/SCT/BKN/OVC and their bases, CB/TCU, VV: the
// sky hidden). Each runway site's station (sites.ts: icao); the nearest to the craft, cached half an hour.

import { type Site, SITES } from "./game/sites";
import type { CloudLayer, WeatherState } from "./weather";

const FT = 0.3048;
const KT = 0.514444;
const SM = 1609.344;
const COVER: Record<string, number> = { FEW: 0.2, SCT: 0.45, BKN: 0.75, OVC: 1 };

/** A METAR decoded (its body: up to RMK) into a weather state; null: not a METAR. */
export function parseMetar(raw: string): WeatherState | null {
  const text = raw.trim().replace(/\s+/g, " ");
  const tokens = text.split(" ");
  const rmk = tokens.indexOf("RMK");
  const body = (rmk >= 0 ? tokens.slice(0, rmk) : tokens).filter((t) => t !== "$" && t !== "=");
  if (body.length < 3 || !/^[A-Z][A-Z0-9]{3}$/.test(body[0]!)) return null;
  let u10 = 0,
    from: number | null = null,
    gust = 0,
    vis = 15e3,
    fogTop = 0,
    rain = 0,
    dust = 0,
    storm = false,
    fog = false,
    windSeen = false;
  const layers: CloudLayer[] = [];
  for (let i = 1; i < body.length; i++) {
    const t = body[i]!;
    let m: RegExpMatchArray | null;
    if (/^\d{6}Z$/.test(t) || t === "AUTO" || t === "COR" || t === "NOSIG" || /^\d{3}V\d{3}$/.test(t)) continue;
    if ((m = t.match(/^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/))) {
      const k = m[4] === "KT" ? KT : m[4] === "MPS" ? 1 : 1 / 3.6;
      u10 = Number(m[2]) * k;
      from = m[1] === "VRB" || u10 === 0 ? null : Number(m[1]);
      gust = m[3] ? Math.max(Number(m[3]) * k - u10, 0) : 0;
      windSeen = true;
      continue;
    }
    if (t === "CAVOK") {
      vis = 15e3;
      continue;
    }
    if (/^\d{4}$/.test(t)) {
      vis = t === "9999" ? 15e3 : Math.max(Number(t), 50);
      continue;
    }
    // (statute miles: 10SM, P6SM, M1/4SM, 1/2SM — and 1 1/2SM, its whole miles the token before)
    if ((m = t.match(/^([PM])?(\d+)?(?:\/(\d+))?SM$/))) {
      let mi = m[3] ? Number(m[2]) / Number(m[3]) : Number(m[2] ?? 0);
      const prev = body[i - 1]!;
      if (m[3] && /^\d+$/.test(prev)) mi += Number(prev);
      vis = m[1] === "P" ? Math.max(mi * SM, 12e3) : Math.max(mi * SM, 50);
      continue;
    }
    if ((m = t.match(/^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU|\/\/\/)?$/))) {
      const base = Number(m[2]) * 100 * FT;
      const cover = COVER[m[1]!]!;
      // (their tops guessed by kind: a towering cumulonimbus to 9 km, a swelling cumulus 3 km up, a deck ~1 km)
      const top = m[3] === "CB" ? Math.max(9000, base + 6000) : m[3] === "TCU" ? base + 3000 : base + (cover >= 0.75 ? 900 : 800);
      layers.push({ base, top, cover });
      continue;
    }
    if ((m = t.match(/^VV(\d{3}|\/\/\/)$/))) {
      // (the sky hidden: fog up to the vertical visibility)
      fog = true;
      fogTop = Math.max(m[1] === "///" ? 60 : Number(m[1]) * 100 * FT, 30);
      continue;
    }
    if (
      (m = t.match(/^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+)?$/)) &&
      (m[2] || m[3])
    ) {
      if (m[1] === "VC") continue;
      const k = m[1] === "+" ? 1 : m[1] === "-" ? 0.3 : 0.6;
      const ph = m[3] ?? "";
      if (m[2] === "TS") storm = true;
      if (/RA|SN|PL|GR|GS|UP/.test(ph) || (m[2] === "SH" && !ph)) rain = Math.max(rain, k);
      else if (/DZ/.test(ph)) rain = Math.max(rain, 0.25 * k + 0.1);
      if (/FG/.test(ph) && m[2] !== "MI" && m[2] !== "BC" && m[2] !== "PR") fog = true;
      if (/DU|SA|SS|DS/.test(ph)) dust = Math.max(dust, m[1] === "+" ? 1 : 0.6);
      continue;
    }
  }
  if (!windSeen) return null;
  layers.sort((a, b) => a.base - b.base);
  if (fog && fogTop === 0) fogTop = vis < 400 ? 150 : 80;
  if (!fog) fogTop = 0;
  const low = layers.find((l) => l.cover >= 0.75);
  const kind: WeatherState["kind"] = storm
    ? "storm"
    : fog
      ? "fog"
      : rain > 0
        ? "rain"
        : dust > 0
          ? "dust"
          : low
            ? "overcast"
            : layers.length
              ? "cloudy"
              : u10 > 10
                ? "windy"
                : "fair";
  return {
    source: "metar",
    kind,
    wind: { u10, from, gust, turb: u10 + gust > 15 ? 3 : u10 + gust > 9 ? 2 : u10 > 3 ? 1 : 0, shear: Math.min(gust * 0.5, 6) },
    visibility: vis,
    fogTop,
    layers: layers.slice(0, 3),
    rain: storm ? Math.max(rain, 0.8) : rain,
    dust,
    report: text,
  };
}

/** The runway site with a station nearest a place of the Earth [°], and its distance [km]; null: none within `maxKm`. */
export function nearestStation(place: { lat: number; lon: number }, maxKm = 600): { site: Site; icao: string; km: number } | null {
  const D = Math.PI / 180;
  let best: { site: Site; icao: string; km: number } | null = null;
  for (const s of SITES) {
    if (s.body !== "earth" || !s.icao) continue;
    const c =
      Math.sin(place.lat * D) * Math.sin(s.lat * D) + Math.cos(place.lat * D) * Math.cos(s.lat * D) * Math.cos((place.lon - s.lon) * D);
    const km = Math.acos(Math.min(Math.max(c, -1), 1)) * 6371;
    if (km <= maxKm && (!best || km < best.km)) best = { site: s, icao: s.icao, km };
  }
  return best;
}

/**
 * The reports fetched (metar.vatsim.net): each station's kept half an hour, a failure five minutes (no
 * network: the fair weather meanwhile — weather.ts weatherAt).
 */
export class MetarFeed {
  private cache = new Map<string, { at: number; w: WeatherState | null; pending?: Promise<WeatherState | null> }>();
  constructor(
    private get: (url: string) => Promise<string> = (url) =>
      fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))),
    private now: () => number = () => Date.now(),
  ) {}

  /** The station's weather now (cached), or null: no report (none served, no network). */
  async weather(icao: string): Promise<WeatherState | null> {
    const c = this.cache.get(icao);
    const t = this.now();
    if (c?.pending) return c.pending;
    if (c && t - c.at < (c.w ? 30 : 5) * 60e3) return c.w;
    const pending = this.get(`https://metar.vatsim.net/metar.php?id=${encodeURIComponent(icao)}`)
      .then((txt) => parseMetar(txt.split("\n")[0] ?? ""))
      .catch(() => null)
      .then((w) => {
        this.cache.set(icao, { at: this.now(), w });
        return w;
      });
    this.cache.set(icao, { at: t, w: c?.w ?? null, pending });
    return pending;
  }
}
