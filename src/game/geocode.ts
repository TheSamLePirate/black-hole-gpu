// Addresses on the Earth (PLAN-MODES-AAA M6): what the player types turned into places — Photon (komoot, from
// OpenStreetMap: made for search-as-you-type, CORS open), Nominatim (OpenStreetMap's own) when Photon fails. Live
// public sources, no key; at most one search a second (Nominatim's policy), the last words only, answers kept
// for the session. The parsing is pure (tests/geocode.test.ts); the fetch is the browser's.

export interface GeoPlace {
  /** a short name, and the line under it (the city, the region, the country) */
  name: string;
  detail: string;
  lat: number;
  lon: number;
  /** what it is (OpenStreetMap's key and value: "place/city", "natural/peak"…) */
  kind: string;
  /** the box it spans [south, north, west, east], when given */
  box?: [number, number, number, number];
  source: "photon" | "nominatim";
}

export const PHOTON = "https://photon.komoot.io/api/";
export const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** Photon's answer (GeoJSON features) as places. */
export function parsePhoton(json: unknown): GeoPlace[] {
  const f = (json as { features?: unknown[] })?.features;
  if (!Array.isArray(f)) return [];
  const out: GeoPlace[] = [];
  for (const x of f) {
    const g = (x as { geometry?: { coordinates?: number[] } }).geometry?.coordinates;
    const p = (x as { properties?: Record<string, unknown> }).properties ?? {};
    if (!g || g.length < 2 || !Number.isFinite(g[0]) || !Number.isFinite(g[1])) continue;
    const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
    const street = [str("housenumber"), str("street")].filter(Boolean).join(" ");
    const name = str("name") || street || str("city") || str("county") || str("state") || str("country");
    if (!name) continue;
    const detail = [name === street ? "" : street, str("postcode"), str("city") !== name ? str("city") : "", str("state"), str("country")]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(", ");
    const ext = p.extent as number[] | undefined;
    out.push({
      name,
      detail,
      lat: g[1]!,
      lon: g[0]!,
      kind: [str("osm_key"), str("osm_value")].filter(Boolean).join("/"),
      // (Photon's extent: [west, north, east, south])
      box: Array.isArray(ext) && ext.length === 4 ? [ext[3]!, ext[1]!, ext[0]!, ext[2]!] : undefined,
      source: "photon",
    });
  }
  return out;
}

/** Nominatim's answer (jsonv2) as places. */
export function parseNominatim(json: unknown): GeoPlace[] {
  if (!Array.isArray(json)) return [];
  const out: GeoPlace[] = [];
  for (const x of json as Record<string, unknown>[]) {
    const lat = Number(x.lat),
      lon = Number(x.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const full = typeof x.display_name === "string" ? x.display_name : "";
    const name = (typeof x.name === "string" && x.name) || full.split(",")[0]!.trim();
    if (!name) continue;
    const bb = Array.isArray(x.boundingbox) ? (x.boundingbox as string[]).map(Number) : null;
    out.push({
      name,
      detail: full
        .split(",")
        .slice(1)
        .map((s) => s.trim())
        .join(", "),
      lat,
      lon,
      kind: [x.category ?? x.class, x.type].filter((v) => typeof v === "string").join("/"),
      box: bb && bb.length === 4 && bb.every(Number.isFinite) ? [bb[0]!, bb[1]!, bb[2]!, bb[3]!] : undefined,
      source: "nominatim",
    });
  }
  return out;
}

/** Coordinates typed as such ("48.8566, 2.3522", "48°51'N 2°21'E", "-33.86 151.21"): the place, or null. */
export function parseCoords(q: string): { lat: number; lon: number } | null {
  const s = q.trim().toUpperCase().replace(/,/g, " ");
  // (degrees, minutes, seconds, hemispheres)
  const dms =
    /^(\d+(?:\.\d+)?)°\s*(?:(\d+(?:\.\d+)?)['′]\s*)?(?:(\d+(?:\.\d+)?)["″]\s*)?([NS])\s+(\d+(?:\.\d+)?)°\s*(?:(\d+(?:\.\d+)?)['′]\s*)?(?:(\d+(?:\.\d+)?)["″]\s*)?([EWO])$/.exec(
      s,
    );
  if (dms) {
    const deg = (d: string, m?: string, x?: string) => Number(d) + Number(m ?? 0) / 60 + Number(x ?? 0) / 3600;
    const lat = deg(dms[1]!, dms[2], dms[3]) * (dms[4] === "S" ? -1 : 1);
    const lon = deg(dms[5]!, dms[6], dms[7]) * (dms[8] === "W" || dms[8] === "O" ? -1 : 1);
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  }
  const dec = /^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s+(-?\d+(?:\.\d+)?)\s*°?\s*([EWO])?$/.exec(s);
  if (!dec) return null;
  const lat = Number(dec[1]) * (dec[2] === "S" ? -1 : 1);
  const lon = Number(dec[3]) * (dec[4] === "W" || dec[4] === "O" ? -1 : 1);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/** The searches made this session (the same words: the same answer, no second request). */
const kept = new Map<string, GeoPlace[]>();
let lastAt = 0;

/**
 * Places for an address or a name: Photon first, Nominatim when Photon fails or finds nothing. At most one
 * request a second (a newer search supersedes: its `signal`). `near`: the map's centre, to rank the nearby first.
 */
export async function geocode(
  q: string,
  o: { lang: "fr" | "en"; near?: { lat: number; lon: number }; signal?: AbortSignal; limit?: number },
): Promise<GeoPlace[]> {
  const words = q.trim();
  if (words.length < 2) return [];
  const key = `${o.lang}:${words.toLowerCase()}`;
  const have = kept.get(key);
  if (have) return have;
  const wait = 1000 - (Date.now() - lastAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (o.signal?.aborted) return [];
  lastAt = Date.now();
  const limit = o.limit ?? 8;
  let out: GeoPlace[] = [];
  try {
    const u = new URL(PHOTON);
    u.searchParams.set("q", words);
    u.searchParams.set("limit", String(limit));
    // (Photon speaks en, de, fr; the names stay the places' own otherwise)
    u.searchParams.set("lang", o.lang);
    if (o.near) {
      u.searchParams.set("lat", o.near.lat.toFixed(3));
      u.searchParams.set("lon", o.near.lon.toFixed(3));
    }
    const r = await fetch(u, { signal: o.signal });
    if (r.ok) out = parsePhoton(await r.json());
  } catch (e) {
    if (o.signal?.aborted) return [];
    void e;
  }
  if (!out.length && !o.signal?.aborted) {
    try {
      const u = new URL(NOMINATIM);
      u.searchParams.set("format", "jsonv2");
      u.searchParams.set("q", words);
      u.searchParams.set("limit", String(limit));
      u.searchParams.set("accept-language", o.lang);
      const r = await fetch(u, { signal: o.signal });
      if (r.ok) out = parseNominatim(await r.json());
    } catch {
      if (o.signal?.aborted) return [];
    }
  }
  kept.set(key, out);
  return out;
}
