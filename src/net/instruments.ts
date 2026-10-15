// A display-only snapshot for the independent crew page. SI, degrees for geographic coordinates,
// radians for heading; radar offsets east/north/up in metres. No dependency on the simulator.
export const INSTRUMENT_KEYS = ["alt", "speed", "vz", "g", "q", "mach", "heat", "throttle", "fuel", "tau"] as const;
export type InstrumentKey = (typeof INSTRUMENT_KEYS)[number];
export interface InstrumentContact {
  id: string;
  name: string;
  e: number;
  n: number;
  dz: number;
  iff: string;
  locked: boolean;
}
export interface InstrumentSnapshot {
  v: 1;
  t: number;
  body: string;
  metrics: Partial<Record<InstrumentKey, number>>;
  geo: { lat: number; lon: number; heading: number } | null;
  radar: { mode: string; contacts: InstrumentContact[] } | null;
  route: { lat: number; lon: number; name: string }[];
  ahead: { lat: number; lon: number }[];
}

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const label = (x: unknown) => (typeof x === "string" ? x.slice(0, 64) : "");
const place = (x: unknown): x is { lat: number; lon: number } =>
  record(x) && finite(x.lat) && finite(x.lon) && Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180;

/** Parse untrusted room events, bound all collections, discard unavailable/non-finite readings. */
export function readInstruments(x: unknown): InstrumentSnapshot | null {
  if (!record(x) || x.v !== 1 || !finite(x.t) || !record(x.metrics)) return null;
  const metrics: InstrumentSnapshot["metrics"] = {};
  for (const key of INSTRUMENT_KEYS) if (finite(x.metrics[key])) metrics[key] = x.metrics[key];
  const rawGeo = record(x.geo) ? x.geo : null;
  const heading = rawGeo?.heading;
  const geo = place(rawGeo) && finite(heading) ? { lat: rawGeo.lat, lon: rawGeo.lon, heading } : null;
  let radar: InstrumentSnapshot["radar"] = null;
  if (record(x.radar) && Array.isArray(x.radar.contacts)) {
    radar = { mode: label(x.radar.mode), contacts: [] };
    for (const c of x.radar.contacts.slice(0, 48)) {
      if (!record(c) || !finite(c.e) || !finite(c.n) || !finite(c.dz)) continue;
      radar.contacts.push({ id: label(c.id), name: label(c.name), e: c.e, n: c.n, dz: c.dz, iff: label(c.iff), locked: c.locked === true });
    }
  }
  return {
    v: 1,
    t: x.t,
    body: label(x.body),
    metrics,
    geo,
    radar,
    route: Array.isArray(x.route)
      ? x.route
          .slice(0, 64)
          .filter(place)
          .map((p) => ({ lat: p.lat, lon: p.lon, name: label((p as Record<string, unknown>).name) }))
      : [],
    ahead: Array.isArray(x.ahead)
      ? x.ahead
          .slice(0, 96)
          .filter(place)
          .map((p) => ({ lat: p.lat, lon: p.lon }))
      : [],
  };
}
