// A display-only snapshot for the independent crew page. SI, degrees for geographic coordinates,
// radians for angles (heading, attitude, track); radar offsets east/north/up in metres. No dependency on the simulator.
// Version 1 grows only by optional blocks: an older console ignores them, a newer one shows what an older pilot sends.
import { type InstrumentSpace, readSpace } from "./instruments-space";
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
/** The flight's state: attitude and path [rad], speeds [m/s], heights [m], loads [g]. */
export interface InstrumentFlight {
  pitch: number;
  bank: number;
  hdg: number;
  track?: number;
  fpa?: number;
  aoa?: number;
  beta?: number;
  tas?: number;
  eas?: number;
  gs?: number;
  /** height over the ground [m] (the radio altimeter's) */
  agl?: number;
  nz?: number;
  gMax?: number;
  buffet?: number;
  stallAoa?: number;
  /** the wind: its speed [m/s], where it blows from [rad] */
  wind?: { spd: number; from: number };
  /** the straight path's seconds to the ground (the GPWS's) */
  terrain?: number;
}
/** The autopilot, its targets (null: not held: the altitude [m], the heading [rad], the speed [m/s]) and the assistance flown. */
export interface InstrumentAuto {
  mode: string;
  assist: string;
  alt: number | null;
  hdg: number | null;
  spd: number | null;
  ab: boolean;
  lnav: boolean;
  vnav: boolean;
  auto: string;
  hold: string;
  sas: boolean;
  order: string;
  hub: { title: string; phase: string; next: string; bar: number | null } | null;
  /** the jet's holds (AP: its altitude or heading held) and autothrottle (its speed held) engaged — the game's own
   *  lamps, its PCD's; absent from an older pilot (the console then reads them off the selectors) */
  ap?: boolean;
  athr?: boolean;
}
/** The flight plan's guidance: to the active waypoint and the vertical profile. */
export interface InstrumentNav {
  active: number;
  dist: number;
  brg: number;
  ete: number | null;
  xtk: number;
  dtk: number;
  phase: string;
  tod: number | null;
  altT: number | null;
  spdT: number | null;
  cruiseAlt: number;
  cruiseSpd: number;
  bingo: number | null;
  /** the plan's remaining fuel burn [kg] and time [s] from the active point to its end */
  fuelToGo: number | null;
  timeToGo: number | null;
}
/** The craft's systems; fractions 0…1, the fuel [kg], its flow [kg/s], the thrust [kN]. */
export interface InstrumentSystems {
  engine: string;
  spool: number | null;
  thrust: number | null;
  ab: number | null;
  flow: number | null;
  fuelKg: number | null;
  fuelFull: number | null;
  gear: number;
  gearDown: boolean;
  flaps: number;
  brake: number;
  stovl: string;
  hull: number | null;
  shield: number | null;
  damage: number | null;
  mass: number | null;
}
/** Everything else about: the real traffic, a mission's or a fight's units, the ships. Heights [m over the
 *  WGS84 ellipsoid], heading [rad], speed [m/s]; side "traffic" (real, ADS-B), hostile, friend, neutral, dead. */
export interface InstrumentTraffic {
  id: string;
  name: string;
  /** a missile, a decoy (a flare, chaff — PLAN-RADAR-AAA RD8's first step: on the crew's screens) */
  kind: "air" | "sea" | "ground" | "missile" | "decoy";
  side: string;
  lat: number;
  lon: number;
  alt: number | null;
  hdg: number | null;
  spd: number | null;
  type: string;
}
/** The air-to-air refuelling (game/aar.ts, controller/aar.ts): the stage (the rendezvous `join`, behind the `hose`),
 *  the HUD's word (JOIN, PRE-CONTACT, CLEARED, CONTACT, FUEL FLOW, FULL, BREAKAWAY, DEPART), the way it is flown (auto,
 *  assisted, manual), the tanker's callsign and the hose's side; the fuel given and asked [kg], a practice's (the tanks
 *  not taking it); the probe's gap to the basket along the hose and off it [m], the closing speed [m/s], the hose
 *  pushed in [m] (locked) and its flow range and breakaway [m]; the pod's lights; the contacts and the misses; the
 *  tanker's distance [m]. */
export interface InstrumentAar {
  stage: "join" | "hose";
  phase: string;
  mode: "auto" | "assisted" | "manual";
  tanker: string;
  side: "left" | "right";
  given: number;
  want: number;
  practice: boolean;
  along: number | null;
  off: number | null;
  closure: number | null;
  takeup: number | null;
  flow: [number, number];
  whip: number;
  lights: "off" | "amber" | "green" | "red";
  contacts: number;
  misses: number;
  dist: number | null;
}
/** A mission's places: the zones to reach, a SAM's reach [m]. */
export interface InstrumentZone {
  lat: number;
  lon: number;
  r: number;
  name: string;
  kind: "zone" | "threat";
  waiting: boolean;
}
export interface InstrumentSnapshot extends InstrumentSpace {
  v: 1;
  t: number;
  body: string;
  metrics: Partial<Record<InstrumentKey, number>>;
  geo: { lat: number; lon: number; heading: number } | null;
  radar: { mode: string; contacts: InstrumentContact[] } | null;
  route: { lat: number; lon: number; name: string; alt?: number; spd?: number }[];
  /** the predicted path; t its seconds from now, h its height [m] when sent */
  ahead: { lat: number; lon: number; t?: number; h?: number }[];
  flight?: InstrumentFlight | null;
  auto?: InstrumentAuto | null;
  nav?: InstrumentNav | null;
  sys?: InstrumentSystems | null;
  ils?: { id: string; loc: number | null; gs: number | null; dme: number; phase: string } | null;
  /** the orbit: apsides' heights [km], inclination [°], eccentricity, period and times to the apsides [s]; the body's
   *  radius and the semi-major axis [km], the apsides' true anomalies [rad] (PLAN-VAISSEAUX K1: the ORBIT card's
   *  figure was the Earth's) */
  orbit?: {
    pe: number;
    ap: number;
    inc: number;
    ecc: number;
    period: number | null;
    tPe: number | null;
    tAp: number | null;
    radius?: number;
    a?: number;
  } | null;
  /** the next event on the free-fall path, and the mission's objective */
  next?: { kind: string; name: string; in: number; body?: string } | null;
  msn?: { name: string; brg: number; dist: number; dz: number } | null;
  /** the alerts lit (STALL, GEAR, PULL UP, BINGO…) */
  warn?: string[];
  /** the F-35's weapons (the crew's backseater — PLAN-CREW-ACTIONS A5): a fight running, the weapon chosen, the stores
   *  left, the radar's mode, its lock's name */
  arms?: { live: boolean; sel: string; stores: Record<string, number>; mode: string; lock: string } | null;
  /** the Sun seen from the body flown about: the point under it [°] on the body's own axes (the globe's day and night) */
  sun?: { lat: number; lon: number } | null;
  /** the air-to-air refuelling engaged (absent: none, or an older pilot) */
  aar?: InstrumentAar | null;
  /** the crew's orders (net/crewcmd.ts): the pilot's lock open, the families that can be done now */
  caps?: {
    on: boolean;
    fam: string[];
    /** the pilot holds the ground stations' orders and messages the light's time himself (AUDIT-CREW priority 6): a
     *  console sends them at once — absent (an older pilot): the console delays them */
    hold?: boolean;
    /** the crew screens the pilot has accepted aboard (their slots): live; the others are on the ground */
    aboard?: number[];
  } | null;
  /** sent once a second at most: absent, the last list stands */
  traffic?: InstrumentTraffic[];
  /** the fight about the pilot every snapshot (RD1): its targets, its missiles, its decoys — newer than `traffic` */
  tracks?: InstrumentTraffic[];
  zones?: InstrumentZone[];
}

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const label = (x: unknown, n = 64) => (typeof x === "string" ? x.slice(0, n) : "");
const num = (x: unknown) => (finite(x) ? x : undefined);
const opt = (x: unknown) => (finite(x) ? x : null);
const place = (x: unknown): x is { lat: number; lon: number } =>
  record(x) && finite(x.lat) && finite(x.lon) && Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180;
/** keep only the finite optional numbers (an object of them) */
function numbers<T>(x: Record<string, unknown>, keys: readonly string[]): Partial<T> {
  const out: Record<string, number> = {};
  for (const k of keys) if (finite(x[k])) out[k] = x[k];
  return out as Partial<T>;
}

function readFlight(x: unknown): InstrumentFlight | null {
  if (!record(x) || !finite(x.pitch) || !finite(x.bank) || !finite(x.hdg)) return null;
  const f: InstrumentFlight = {
    pitch: x.pitch,
    bank: x.bank,
    hdg: x.hdg,
    ...numbers<InstrumentFlight>(x, [
      "track",
      "fpa",
      "aoa",
      "beta",
      "tas",
      "eas",
      "gs",
      "agl",
      "nz",
      "gMax",
      "buffet",
      "stallAoa",
      "terrain",
    ]),
  };
  if (record(x.wind) && finite(x.wind.spd) && finite(x.wind.from)) f.wind = { spd: x.wind.spd, from: x.wind.from };
  return f;
}
function readAuto(x: unknown): InstrumentAuto | null {
  if (!record(x)) return null;
  const h = record(x.hub) ? x.hub : null;
  return {
    mode: label(x.mode, 16),
    assist: label(x.assist, 16),
    alt: opt(x.alt),
    hdg: opt(x.hdg),
    spd: opt(x.spd),
    ab: x.ab === true,
    lnav: x.lnav === true,
    vnav: x.vnav === true,
    auto: label(x.auto, 16),
    hold: label(x.hold, 16),
    sas: x.sas === true,
    order: label(x.order, 16),
    hub: h ? { title: label(h.title), phase: label(h.phase), next: label(h.next, 96), bar: opt(h.bar) } : null,
    ...(typeof x.ap === "boolean" ? { ap: x.ap } : {}),
    ...(typeof x.athr === "boolean" ? { athr: x.athr } : {}),
  };
}
function readNav(x: unknown): InstrumentNav | null {
  if (!record(x) || !finite(x.active) || !finite(x.dist) || !finite(x.brg)) return null;
  return {
    active: Math.max(0, Math.min(63, Math.round(x.active))),
    dist: x.dist,
    brg: x.brg,
    ete: opt(x.ete),
    xtk: num(x.xtk) ?? 0,
    dtk: num(x.dtk) ?? x.brg,
    phase: label(x.phase, 16),
    tod: opt(x.tod),
    altT: opt(x.altT),
    spdT: opt(x.spdT),
    cruiseAlt: num(x.cruiseAlt) ?? 0,
    cruiseSpd: num(x.cruiseSpd) ?? 0,
    bingo: opt(x.bingo),
    fuelToGo: opt(x.fuelToGo),
    timeToGo: opt(x.timeToGo),
  };
}
function readSystems(x: unknown): InstrumentSystems | null {
  if (!record(x)) return null;
  return {
    engine: label(x.engine, 24),
    spool: opt(x.spool),
    thrust: opt(x.thrust),
    ab: opt(x.ab),
    flow: opt(x.flow),
    fuelKg: opt(x.fuelKg),
    fuelFull: opt(x.fuelFull),
    gear: num(x.gear) ?? 0,
    gearDown: x.gearDown === true,
    flaps: num(x.flaps) ?? 0,
    brake: num(x.brake) ?? 0,
    stovl: label(x.stovl, 16),
    hull: opt(x.hull),
    shield: opt(x.shield),
    damage: opt(x.damage),
    mass: opt(x.mass),
  };
}

const AAR_MODES = new Set(["auto", "assisted", "manual"]);
const LIGHTS = new Set(["off", "amber", "green", "red"]);
function readAar(x: unknown): InstrumentAar | null {
  if (!record(x) || !finite(x.given) || !finite(x.want)) return null;
  const fl =
    Array.isArray(x.flow) && finite(x.flow[0]) && finite(x.flow[1]) ? (x.flow as [number, number]) : ([0.9, 4.6] as [number, number]);
  return {
    stage: x.stage === "join" ? "join" : "hose",
    phase: label(x.phase, 16),
    mode: AAR_MODES.has(x.mode as string) ? (x.mode as InstrumentAar["mode"]) : "manual",
    tanker: label(x.tanker, 24),
    side: x.side === "left" ? "left" : "right",
    given: Math.max(0, x.given),
    want: Math.max(0, x.want),
    practice: x.practice === true,
    along: opt(x.along),
    off: opt(x.off),
    closure: opt(x.closure),
    takeup: opt(x.takeup),
    flow: [fl[0], fl[1]],
    whip: num(x.whip) ?? 6.5,
    lights: LIGHTS.has(x.lights as string) ? (x.lights as InstrumentAar["lights"]) : "off",
    contacts: Math.max(0, Math.round(num(x.contacts) ?? 0)),
    misses: Math.max(0, Math.round(num(x.misses) ?? 0)),
    dist: opt(x.dist),
  };
}

const KINDS = new Set(["air", "sea", "ground", "missile", "decoy"]);
function readTraffic(list: unknown[]): InstrumentTraffic[] {
  const out: InstrumentTraffic[] = [];
  for (const t of list.slice(0, 128)) {
    if (!place(t)) continue;
    const r = t as Record<string, unknown>;
    out.push({
      id: label(r.id, 32),
      name: label(r.name, 32),
      kind: KINDS.has(r.kind as string) ? (r.kind as InstrumentTraffic["kind"]) : "air",
      side: label(r.side, 12),
      lat: t.lat,
      lon: t.lon,
      alt: opt(r.alt),
      hdg: opt(r.hdg),
      spd: opt(r.spd),
      type: label(r.type, 16),
    });
  }
  return out;
}

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
  const ils = record(x.ils) && finite(x.ils.dme) ? x.ils : null;
  const orbit = record(x.orbit) && finite(x.orbit.pe) && finite(x.orbit.ap) ? x.orbit : null;
  const next = record(x.next) && finite(x.next.in) ? x.next : null;
  const msn = record(x.msn) && finite(x.msn.brg) && finite(x.msn.dist) ? x.msn : null;
  return {
    ...readSpace(x),
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
          .map((p) => {
            const r = p as Record<string, unknown>;
            return { lat: p.lat, lon: p.lon, name: label(r.name), ...numbers<{ alt: number; spd: number }>(r, ["alt", "spd"]) };
          })
      : [],
    ahead: Array.isArray(x.ahead)
      ? x.ahead
          .slice(0, 96)
          .filter(place)
          .map((p) => ({ lat: p.lat, lon: p.lon, ...numbers<{ t: number; h: number }>(p as Record<string, unknown>, ["t", "h"]) }))
      : [],
    flight: readFlight(x.flight),
    auto: readAuto(x.auto),
    nav: readNav(x.nav),
    sys: readSystems(x.sys),
    ils: ils ? { id: label(ils.id, 32), loc: opt(ils.loc), gs: opt(ils.gs), dme: ils.dme as number, phase: label(ils.phase, 16) } : null,
    orbit: orbit
      ? {
          pe: orbit.pe as number,
          ap: orbit.ap as number,
          inc: num(orbit.inc) ?? 0,
          ecc: num(orbit.ecc) ?? 0,
          period: opt(orbit.period),
          tPe: opt(orbit.tPe),
          tAp: opt(orbit.tAp),
          ...numbers<{ radius: number; a: number }>(orbit, ["radius", "a"]),
        }
      : null,
    next: next
      ? {
          kind: label(next.kind, 16),
          name: label(next.name),
          in: next.in as number,
          ...(typeof next.body === "string" ? { body: label(next.body, 24) } : {}),
        }
      : null,
    msn: msn ? { name: label(msn.name), brg: msn.brg as number, dist: msn.dist as number, dz: num(msn.dz) ?? 0 } : null,
    arms: record(x.arms)
      ? {
          live: x.arms.live === true,
          sel: label(x.arms.sel, 12),
          stores: record(x.arms.stores)
            ? Object.fromEntries(
                Object.entries(x.arms.stores)
                  .slice(0, 8)
                  .filter((e): e is [string, number] => finite(e[1]))
                  .map(([k, v]) => [k.slice(0, 12), v]),
              )
            : {},
          mode: label(x.arms.mode, 8),
          lock: label(x.arms.lock, 32),
        }
      : null,
    ...(x.aar !== undefined ? { aar: readAar(x.aar) } : {}),
    sun: place(x.sun) ? { lat: (x.sun as { lat: number }).lat, lon: (x.sun as { lon: number }).lon } : null,
    caps:
      record(x.caps) && Array.isArray(x.caps.fam)
        ? {
            on: x.caps.on === true,
            fam: x.caps.fam
              .slice(0, 8)
              .filter((f): f is string => typeof f === "string")
              .map((f) => f.slice(0, 12)),
            ...(x.caps.hold === true ? { hold: true } : {}),
            ...(Array.isArray(x.caps.aboard)
              ? { aboard: x.caps.aboard.slice(0, 8).filter((k): k is number => Number.isInteger(k) && k >= 0 && k < 64) }
              : {}),
          }
        : null,
    ...(Array.isArray(x.traffic) ? { traffic: readTraffic(x.traffic) } : {}),
    ...(Array.isArray(x.tracks) ? { tracks: readTraffic(x.tracks.slice(0, 64)) } : {}),
    ...(Array.isArray(x.zones)
      ? {
          zones: x.zones
            .slice(0, 48)
            .filter((z) => place(z) && finite((z as Record<string, unknown>).r))
            .map((z) => {
              const r = z as Record<string, unknown>;
              return {
                lat: r.lat as number,
                lon: r.lon as number,
                r: Math.min(Math.abs(r.r as number), 2e6),
                name: label(r.name),
                kind: r.kind === "threat" ? ("threat" as const) : ("zone" as const),
                waiting: r.waiting === true,
              };
            }),
        }
      : {}),
    warn: Array.isArray(x.warn)
      ? x.warn
          .slice(0, 12)
          .map((w) => label(w, 16))
          .filter(Boolean)
      : [],
  };
}
