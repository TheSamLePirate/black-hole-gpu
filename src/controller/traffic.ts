import { trafficLightVisibility } from "../traffic/lights";
import { trafficContact } from "../traffic/contact";
import { reportAt } from "../traffic/timeline";
import { profileOf } from "../traffic/profile";
import { observedGround } from "../traffic/ground-path";
import type { AirportNet } from "../game/airportnet";
import type { WeatherState } from "../weather";
import type { AirportActivity } from "../traffic/airport-activity";
import { crabStep, trafficWind, windCrab } from "../traffic/attitude";
// The CameraController — the real traffic in the sky (docs/PLAN-AVIATION-AAA.md, T2; traffic/feed.ts its reports):
// each aircraft drawn a minute behind the real time (the setting), on the smoothest path near its reports of the
// last minutes (game/flightpath.ts: a smoothing spline through their places and velocities — its turns and climbs
// as they were, its reports' noise left out, its acceleration continuous); ahead of its last report (live, or its
// reports late), carried on from it — its way along its turn (ADS-B's track rate, else between its last two
// reports), its climb —, its speed's bias along its track learnt. A change of what places it (a new report, its
// path refitted) closed over 5 s, never a jump. Flown by the flight's laws: its coordinated turn's bank (eased, at a
// roll rate an airliner's), its nose above its path by the incidence its lift asks (its weight, its turn, the air's
// density, its flaps when slow). Placed on the WGS84 Earth (its geometric altitude over the ellipsoid; on the
// ground, its wheels on the relief — the ground the player's gear stands on, a runway's graded level —; in the air never
// under them). Against the game's runways (traffic/runway-phase.ts, 24 Nov 2026 — the one owner of its runway, its phase,
// its gear): drawn on the axis of the one it lines up with, onto its glide on its final, rolled out on it; its landing
// made up through the gap in its reports (traffic/landing.ts: lost on short final, heard again taxiing — not across the
// grass); its gear moved by its phase — the A320 family's rig near the view (src/a320/pose.ts), its legs and doors.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { airportState } from "./airportview";
import type { AirlinerId } from "../ship";
import { A320Poser } from "../a320/pose";
import type { Props } from "../a320/rig";
import { ATTACHMENTS, attachmentScale, attachmentOffset } from "../traffic/attachments";
import { airframeOf, MESH, rcsOf } from "../game/airtypes";
import { type FlightKnot, type FlightPath, fitFlight, flightAt, flightLaws } from "../game/flightpath";
import type { FormCraft } from "../game/formation";
import type { RadarObject } from "../game/radar";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { geoidDeg } from "../system/geoid-grid";
import { EARTH_RUNWAYS } from "../game/sites";
import { type Way, withLanding } from "../traffic/landing";
import { FLOOR, GEAR, gearStep, gearTarget, runwayPlace, type TrafficPhase } from "../traffic/runway-phase";
import { earthView } from "./netcraft";
import { type Livery, liveryOf } from "../traffic/livery";
import { formationLabel, formSlotFor } from "./formation";
import { t, tf } from "../i18n";
import type { Plane } from "../traffic/feed";
import type { Vec3 } from "../math/vec3";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    /** the real flights a mission took over (their ICAO hex): left out of the traffic drawn */
    trafficTaken?: Set<string>;
    /** (a measuring lever — tests/e2e/traffic-runways: the rigged A320s' cost) the game's A320 drawn for this many of the traffic's
     *  airliners at most (none set: TRAFFIC_RIG.max) */
    trafficRigMax?: number;
    trafficAirport?: { code: string; net: AirportNet | null; weather: WeatherState | null; activity: AirportActivity | null };
    trafficRigVisible?: (instance: TrafficInstance) => boolean;
    trafficStep: typeof trafficStep;
    trafficNow: typeof trafficNow;
    trafficShips: typeof trafficShips;
    trafficSounds: typeof trafficSounds;
    trafficOverlay: typeof trafficOverlay;
    trafficLead: typeof trafficLead;
    trafficForm: typeof trafficForm;
  }
}

const D = Math.PI / 180;
const geographicOf = (p: readonly number[]) => {
  const g = cartToGeodetic(WGS84_A, WGS84_F, [...p] as Vec3);
  return { lat: g.lat / D, lon: g.lon / D };
};
const G = 9.80665;
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const unit = (a: readonly number[]) => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};
const cross = (a: readonly number[], b: readonly number[]) => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
export const wrap = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

/** A traffic aircraft now: who it is, its mesh and size, its place, velocity and axes (fixed to the Earth). */
export interface TrafficCraft {
  provenance?: "observed" | "reconstructed" | "synthetic";
  airspeed?: number;
  yawRate?: number;
  crab?: number;
  contact?: [number, number, number];
  id: string;
  cs: string;
  reg: string;
  type: string;
  mesh: AirlinerId | null;
  len: number;
  span: number;
  p: number[];
  v: number[];
  fwd: number[];
  up: number[];
  right: number[];
  /** its height over the WGS84 ellipsoid [m] (its place's), over the sea [m] (the geoid taken off: what an altimeter and
   *  its label say — at SFO the ellipsoid lies 32 m under the sea: a final's 15 m over the sea is −17 m over it) */
  alt: number;
  msl: number;
  gnd: boolean;
  /** its bank [rad] (right wing down +), its report's age [s] */
  bank: number;
  age: number;
  /** its wheels' height over the ground [m] (0 on the ground), its nose over its path [rad] and its pitch over the
   *  horizon [rad], how long since it touched down [s] (NaN: in the air, or not seen to) */
  over: number;
  alpha: number;
  pitch: number;
  sinceTd: number;
  /** its phase, its gear's position 0 (up) … 1 (down) and the one wanted (traffic/runway-phase.ts) */
  phase: TrafficPhase;
  gear: number;
  gearWanted: 0 | 1;
  /** the runway it lines up with: its way's key (« KSFO 28L> »), its distance past the threshold and off the axis [m] as
   *  reported, drawn pulled onto it 0…1 (null: none) */
  runway: { key: string; a: number; c: number; pull: number } | null;
  /** where it lands, made up through the gap in its reports (traffic/landing.ts): its runway's way, its touchdown [s,
   *  the traffic's clock] */
  landing: { way: Way; td: number } | null;
}

/** the turn rate kept at most [rad/s]; carried on at most [s] */
const RATE_MAX = 3 * D;
const AHEAD_MAX = 30;

/** The local east, north, up at a geodetic place (WGS84). */
export function enuAt(lat: number, lon: number) {
  const la = lat * D,
    lo = lon * D;
  return {
    E: [-Math.sin(lo), Math.cos(lo), 0],
    N: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    U: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
  };
}

/** a landing carried on past its last report: its rollout's braking [m/s²] */
export const ROLLOUT = 2;

/** A report carried on `dt` [s] (back, before it, when < 0): its place (east, north [m] from its report's, its
 *  altitude [m]), its track [rad] and ground speed [m/s]. `over`: its height over its wheels' rest at its report [m]
 *  — descending, ahead of it (its coverage lost on short final) —: once down at its descent's rate, rolled out, braking
 *  to a stop, not carried on at its approach's speed (nor frozen 30 s on, still at it). */
function carry(p: Plane, rate: number, dt: number, over = Number.NaN) {
  const psi = p.trk * D;
  const land = !p.gnd && dt > 0 && p.vs < -0.5 && Number.isFinite(over);
  // (down: its reported height eased onto the runway — floorOver: twice FLOOR under it, its wheels 0.4 m up)
  const tg = land ? Math.max(0, (over + 2 * FLOOR) / -p.vs) : Number.POSITIVE_INFINITY;
  const t = Math.min(Math.max(dt, -GAP_MAX), land ? Math.max(AHEAD_MAX, tg + p.gs / ROLLOUT) : AHEAD_MAX);
  // (along its way as far as at its speed this long: braking from touchdown)
  const roll = Math.min(Math.max(t - tg, 0), p.gs / ROLLOUT);
  const te = t > tg ? tg + roll - (0.5 * ROLLOUT * roll * roll) / Math.max(p.gs, 1) : t;
  const gs = t > tg ? p.gs - ROLLOUT * roll : p.gs;
  let e: number, n: number;
  if (Math.abs(rate) > 1e-5) {
    const R = p.gs / rate;
    e = R * (Math.cos(psi) - Math.cos(psi + rate * te));
    n = R * (Math.sin(psi + rate * te) - Math.sin(psi));
  } else {
    e = p.gs * Math.sin(psi) * te;
    n = p.gs * Math.cos(psi) * te;
  }
  return { e, n, alt: p.gnd ? 0 : p.alt + p.vs * t, trk: psi + rate * te, gs, down: t > tg };
}

/** Its turn rate [rad/s] from its last two reports (none: straight). */
function rateOf(p: Plane, prev: Plane | null): number {
  if (p.gnd) return 0;
  // (ADS-B's own track rate when it gives one)
  if (Number.isFinite(p.rate ?? Number.NaN)) return Math.max(-RATE_MAX, Math.min(RATE_MAX, (p.rate as number) * D));
  if (!prev) return 0;
  const dt = p.t - prev.t;
  if (!(dt > 0.5 && dt < 30)) return 0;
  return Math.max(-RATE_MAX, Math.min(RATE_MAX, wrap((p.trk - prev.trk) * D) / dt));
}

/** two reports this far apart at most [s] on one path; the path's reports: those of its last this many [s], this
 *  many at most; the bank drawn at most [rad], its roll rate [rad/s] and lag [s] */
const GAP_MAX = 120;
const WINDOW = 200;
const KNOTS_MAX = 100;
const BANK_MAX = 30 * D;

/** the take-off's rotation: the lift-off attitude [rad], VR [m/s] of a long airliner (> 30 m) and a short one, the pitch rate [rad/s] */

const BANK_LAG = 1;
/** under this altitude over the ellipsoid [m] a flying aircraft's ground is asked (none higher: Everest 8 849 m) */
const FLOOR_CHECK = 9000;
export const R_EQ = 6_378_137;
const E2 = WGS84_F * (2 - WGS84_F);

/** The WGS84 radii at a latitude [°]: the meridian's, the prime vertical's [m]. */
export function radii(lat: number) {
  const s = Math.sin(lat * D);
  const w = 1 - E2 * s * s;
  return { M: (WGS84_A * (1 - E2)) / w ** 1.5, N: WGS84_A / Math.sqrt(w) };
}

/**
 * An aircraft's flight through its reports of the last minutes (one run of them, none further apart than GAP_MAX;
 * game/flightpath.ts), in the lat/lon of one of them scaled to metres (east R·cos φ₀·Δλ, north R·Δφ — exactly what
 * `placeOf` undoes; the frame's scale by each report given) — refitted when its reports change, within the frame's
 * fitting budget (fitBudget: else its path as it was, or carried on from its report, until a frame has room). `rest`:
 * its altitude on the ground.
 */
/**
 * A frame's share of time for fitting paths [ms] (24 Nov 2026, the traffic always on): the relay's answer brings a report
 * for every aircraft at once — 200 of them, each path fitted again on the same frame, measured 62 to 68 ms in one frame
 * every 15 s (tests/traffic-perf.test.ts) —; now at least one a frame, the others as long as the frame's share lasts, the
 * rest the next frames (their old path meanwhile: no jump — a new placing is eased over 5 s anyway). One for the aircraft,
 * one for the ships (seatraffic.ts).
 */
export class FitBudget {
  private until = 0;
  private used = 0;
  constructor(private ms: number) {}
  /** a new frame: its share from now */
  start() {
    this.until = performance.now() + this.ms;
    this.used = 0;
  }
  /** a fit allowed now (the first of a frame always) */
  take(): boolean {
    if (this.used > 0 && performance.now() > this.until) return false;
    this.used++;
    return true;
  }
}
export const FIT_MS = 1.5;
const fitBudget = new FitBudget(FIT_MS);
const paths = new Map<string, { key: string; S: FlightPath; t: number[]; lat: number; lon: number; gnd: boolean[] }>();
function pathOf(hist: readonly Plane[], rest: (q: Plane) => number, made = "") {
  const n = hist.length;
  if (n < 2) return null;
  const last = hist[n - 1]!;
  let j = n - 1;
  while (j > 0 && n - j < KNOTS_MAX && hist[j]!.t - hist[j - 1]!.t <= GAP_MAX && last.t - hist[j - 1]!.t <= WINDOW) j--;
  if (n - j < 2) return null;
  const pts = hist.slice(j);
  const key = `${pts.length}:${pts[0]!.t}:${last.t}${made}`;
  const P0 = paths.get(last.id);
  if (P0?.key === key) return P0;
  // (the frame's fitting spent — a batch of reports in at once —: the path it had, the rest next frame)
  if (!fitBudget.take()) return P0 ?? null;
  const o = pts[pts.length >> 1]!;
  const c0 = R_EQ * Math.cos(o.lat * D);
  const knots: FlightKnot[] = pts.map((q) => {
    const r = radii(q.lat);
    return {
      t: q.t,
      x: [wrap((q.lon - o.lon) * D) * c0, (q.lat - o.lat) * D * R_EQ, q.gnd ? rest(q) : q.alt],
      gs: q.gs > 1 || q.gnd ? q.gs : null,
      trk: q.trk * D,
      vs: q.gnd ? 0 : q.vs,
      ke: c0 / (r.N * Math.cos(q.lat * D)),
      kn: R_EQ / r.M,
    };
  });
  const P = { key, S: fitFlight(knots), t: pts.map((q) => q.t), lat: o.lat, lon: o.lon, gnd: pts.map((q) => q.gnd) };
  paths.set(last.id, P);
  return P;
}

/** The place fixed to the Earth [m] of a geodetic place offset east, north [m], at an altitude [m] (WGS84). */
export function placeOf(lat: number, lon: number, e: number, n: number, alt: number): number[] {
  const la = lat + n / (D * R_EQ);
  const lo = lon + e / (D * R_EQ * Math.cos(lat * D));
  return geodeticToCart(WGS84_A, WGS84_F, la * D, lo * D, alt) as number[];
}

/**
 * Its reports with its landing made up through their gap (traffic/landing.ts: lost on short final, heard again off
 * the runway), by aircraft — made again when its reports or the runways about change.
 */
const landings = new Map<string, { n: number; t: number; rn: number; last: unknown; L: ReturnType<typeof withLanding> }>();
function landingOf(T: { p: Plane; hist: readonly Plane[] }, rest: (lat: number, lon: number) => number) {
  // (its reports and the runways as they were: the same — no string made each frame for each aircraft)
  const n = T.hist.length,
    t = T.p.t,
    rn = EARTH_RUNWAYS.length,
    last = EARTH_RUNWAYS[rn - 1];
  const L0 = landings.get(T.p.id);
  if (L0 && L0.n === n && L0.t === t && L0.rn === rn && L0.last === last) return L0.L;
  const L = withLanding(T.hist, EARTH_RUNWAYS, rest);
  landings.set(T.p.id, { n, t, rn, last, L });
  return L;
}

/**
 * The smoothing's state by aircraft: what places it (its report carried on, or its path), the gap left to close
 * (fixed to the Earth [m]) and since when, its speed's bias along its track learnt from its reports' jumps [m/s],
 * where it was drawn last, its velocity and bank then (a new placing joined to it without a jump).
 */
const easing = new Map<
  string,
  {
    key: string;
    off: number[];
    at: number;
    vb: number;
    last: number[] | null;
    v: number[];
    drawn: number;
    bank: number;
    /** its pitch over the horizon the last frame in the air [rad]; when it touched down (NaN: in the air) */
    pitch: number;
    /** its pitch as drawn [rad] (rate-limited) */
    pd: number;
    crab: number;
    tdAt: number;
    /** its phase the frame before (null: none yet), its gear wanted (null: none yet) and its position 0…1 */
    phase: TrafficPhase | null;
    gearT: 0 | 1 | null;
    gear: number;
  }
>();
/** the derotation: the nose held up this long after the mains touch [s], lowered over this long [s] */
const DEROT = { hold: 1.2, down: 3 };
const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
/** the gap's closing time [s]; the speed bias's gain and its bound [m/s] */
const CLOSE = 5;
/** a new placing this long [s] after the last frame drawn — or before it —: a cut, not a gap closed */
const CUT = 2;
const VB_GAIN = 0.3;
const VB_MAX = 15;
/** the runways asked about an aircraft whose wheels are under this over the ground [m] (traffic/runway-phase.ts) */
const RUNWAY_LOW = 1200;

/**
 * The traffic now (the setting's delay behind the real time): each aircraft's place, velocity, axes — on its path
 * at that moment, else carried on from its last report —, flown by the flight's laws; a change of what places it
 * eased out; against the game's runways (traffic/runway-phase.ts: its axis, its glide, its phase, its gear). Cached a
 * frame.
 */
let cache: {
  at: number;
  list: TrafficCraft[];
  of: unknown;
  scene?: object;
  weather?: WeatherState | null;
  net?: AirportNet | null;
  enabled?: boolean;
} = { at: -1, list: [], of: null };
function trafficNow(this: CameraController): TrafficCraft[] {
  const F = this.traffic;
  if (!F || this.s.traffic === false) return [];
  // (the real traffic's time: the wall clock's — a test's own)
  const now = this.trafficClock ? this.trafficClock() : (this.trafficT ?? Date.now() / 1000);
  // (the same moment: the same list — the radar, the renderer and the overlay all read it)
  const scene = this.trafficAirport;
  if (
    cache.at === now &&
    cache.of === F &&
    cache.scene === scene &&
    cache.weather === scene?.weather &&
    cache.net === scene?.net &&
    cache.enabled === scene?.activity?.enabled
  )
    return cache.list;
  const td = now - Math.max(0, this.s.trafficDelay ?? 0);
  const out: TrafficCraft[] = [];
  fitBudget.start();
  const observed = [...F.planes.values()];
  const A = this.trafficAirport;
  const firstWay = [...(airportState()?.ways ?? [])].sort((a, b) => {
    const heading = (w: typeof a) => {
      const f = enuAt(A?.net?.origin.lat ?? 0, A?.net?.origin.lon ?? 0);
      return Math.atan2(dot(w.d, f.E), dot(w.d, f.N)) / D;
    };
    const windFrom = A?.weather?.wind.from ?? 0;
    return Math.cos((heading(b) - windFrom) * D) - Math.cos((heading(a) - windFrom) * D);
  })[0];
  const end = firstWay
    ? {
        ...(() => {
          const g = geographicOf(firstWay.o);
          return g;
        })(),
        hdg:
          Math.atan2(
            dot(firstWay.d, enuAt(A?.net?.origin.lat ?? 0, A?.net?.origin.lon ?? 0).E),
            dot(firstWay.d, enuAt(A?.net?.origin.lat ?? 0, A?.net?.origin.lon ?? 0).N),
          ) / D,
      }
    : null;
  const supplemental =
    (A?.weather && (A.weather.source === "metar" || A.weather.source === "model")
      ? A.activity?.step(
          td,
          observed.map((T) => reportAt(T.hist, T.p, td)),
          end,
          A.weather,
        )
      : undefined) ?? [];
  for (const T of [...observed, ...supplemental]) {
    const p = T.p;
    const timed = reportAt(T.hist, p, td);
    const profile = profileOf(p.type, airframeOf(p.type, p.cat).len);
    // (taken over by a mission — controller/mission.ts —: flown by the game from there, not by its reports)
    if (this.trafficTaken?.has(p.id)) continue;
    const af = airframeOf(p.type, p.cat);
    // (on the ground: its wheels on the relief there — the ground the player's gear stands on, a runway's graded level)
    const wheels = af.mesh ? (MESH[af.mesh].wheels * af.len) / MESH[af.mesh].len : 1.5;
    const restAt = (lat: number, lon: number) => groundRelief("earth", bodyFixedOf("earth", lat, lon, 0)) + wheels;
    const E0 = easing.get(p.id);
    const previousPosition = E0?.last;
    const previousVelocity = E0?.v;
    const previousDrawn = E0?.drawn;
    // (its landing made up through the gap in its reports — onto the runway it lined up with, not across the grass —:
    // flown on its path live too, as far as it goes)
    const H = landingOf(T, restAt);
    const path = td < now || H.key ? pathOf(H.hist, (q) => restAt(q.lat, q.lon), H.key) : null;
    const f = path ? flightAt(path.S, td) : null;
    let L: ReturnType<typeof enuAt>, key: string, gnd: boolean, la: number, lo: number, altR: number, sure: boolean;
    let ve: number, vn: number, vu: number, ae: number, an: number, au: number, omega: number;
    let ramp = 1;
    if (path && f) {
      // (on its path: the spline's place, velocity and acceleration — from its lat/lon scale to metres there)
      let i = 0;
      while (i < path.t.length - 2 && path.t[i + 1]! < td) i++;
      gnd = path.gnd[i]! && path.gnd[i + 1]!;
      la = path.lat + f.x[1]! / (D * R_EQ);
      lo = path.lon + f.x[0]! / (D * R_EQ * Math.cos(path.lat * D));
      altR = f.x[2]!;
      // (its height as made up — its landing through the gap —, or between a report on the ground and one in the air — its
      // touchdown, its lift-off —: its own, trusted to the runway; else a report's, eased onto it)
      sure = td >= H.from || path.gnd[i]! || path.gnd[i + 1]!;
      // (between the ground and the air: its height off the ground eased in from the report on the ground — its lift-off —,
      // out to it — its touchdown —: the smoothing spline passes near its knots, not through them, and the ground's
      // segments are drawn on the ground — no step of metres where they meet)
      if (!gnd && (path.gnd[i]! || path.gnd[i + 1]!)) {
        const u = Math.min(1, Math.max(0, (td - path.t[i]!) / Math.max(path.t[i + 1]! - path.t[i]!, 1e-3)));
        ramp = (path.gnd[i]! ? smooth(u) : 1) * (path.gnd[i + 1]! ? smooth(1 - u) : 1);
      }
      L = enuAt(la, lo);
      const r = radii(la);
      const ke = (r.N * Math.cos(la * D)) / (R_EQ * Math.cos(path.lat * D)),
        kn = r.M / R_EQ;
      [ve, vn, vu] = [f.v[0]! * ke, f.v[1]! * kn, gnd ? 0 : f.v[2]!];
      [ae, an, au] = [f.a[0]! * ke, f.a[1]! * kn, gnd ? 0 : f.a[2]!];
      omega = gnd ? 0 : f.omega;
      key = `s${path.key}`;
    } else {
      // (ahead of its last report: carried on — its speed along its track corrected by what its reports' jumps
      // taught —; before its first, heard too lately for the delay: carried back from it, its path reached in time)
      const first = T.hist[0];
      const back = first !== undefined && td < first.t;
      // (past its made-up landing: from where it left it — braked to a stop on the runway)
      const pl = H.key ? H.hist.at(-1)! : p;
      const q = back ? first : pl;
      const rate = back ? rateOf(q, null) : rateOf(pl, T.prev);
      const pc = E0 && !q.gnd && !back ? { ...q, gs: q.gs + E0.vb } : q;
      const low = !q.gnd && !back && pc.alt < FLOOR_CHECK;
      const c = carry(pc, rate, td - q.t, low ? pc.alt - restAt(q.lat, q.lon) : Number.NaN);
      // (rolled out on the runway: as on the ground — no bank, no climb)
      gnd = q.gnd || c.down;
      sure = false;
      la = q.lat + c.n / (D * R_EQ);
      lo = q.lon + c.e / (D * R_EQ * Math.cos(q.lat * D));
      altR = c.alt;
      L = enuAt(q.lat, q.lon);
      [ve, vn, vu] = [c.gs * Math.sin(c.trk), c.gs * Math.cos(c.trk), gnd ? 0 : q.vs];
      [ae, an, au] = c.down ? [-ROLLOUT * Math.sin(c.trk), -ROLLOUT * Math.cos(c.trk), 0] : [rate * vn, -rate * ve, 0];
      omega = c.down ? 0 : rate;
      key = `${back ? "b" : "c"}${q.t}`;
    }
    const ground = T.groundPose ?? (A?.net ? observedGround(A.net, T.hist, td) : null);
    if (ground) {
      la = ground.lat;
      lo = ground.lon;
      L = enuAt(la, lo);
      ve = ground.ve;
      vn = ground.vn;
      vu = ground.vu ?? 0;
      ae = ground.omega * vn;
      an = -ground.omega * ve;
      au = 0;
      omega = ground.omega;
      gnd = !ground.airborne;
      sure = true;
      altR = restAt(la, lo) + (ground.over ?? 0);
    }
    // (against the runways — traffic/runway-phase.ts, the one owner of its runway, its phase, its gear —: on the axis of
    // the one it lines up with, onto its glide, rolled out on it; its wheels never under the ground — high enough, no
    // ground to ask: Everest 8 849 m)
    const low = gnd || altR < FLOOR_CHECK;
    const g0 = low ? restAt(la, lo) : 0;
    const over0 = gnd ? 0 : !low ? altR : ramp < 1 ? Math.max(altR - g0, 0) * ramp : altR - g0;
    const gsH = Math.hypot(ve, vn);
    const RP = runwayPlace(
      { lat: la, lon: lo, over: over0, gnd, ve, vn, vu, acc: gsH > 0.1 ? (ae * ve + an * vn) / gsH : 0, rotor: !af.mesh, sure },
      low && over0 < RUNWAY_LOW ? EARTH_RUNWAYS : [],
      E0?.phase ?? null,
    );
    const g = RP.lat !== la || RP.lon !== lo ? restAt(RP.lat, RP.lon) : g0;
    const alt = low ? g + RP.over : altR;
    const over = low ? RP.over : altR;
    // (its vertical rate and acceleration as drawn: eased onto the ground, onto the glide)
    au = RP.gnd ? 0 : au * (1 - RP.wV);
    vu = RP.vu;
    gnd = RP.gnd;
    la = RP.lat;
    lo = RP.lon;
    let P = geodeticToCart(WGS84_A, WGS84_F, la * D, lo * D, alt) as number[];
    const v = [0, 1, 2].map((i) => L.E[i]! * ve + L.N[i]! * vn + L.U[i]! * vu);
    // (a new placing: where it was drawn, carried on to now, and where this one puts it — the gap closed over 5 s; a
    // report carried on after another, its along-track part teaching the speed's bias)
    if (!E0 || E0.key !== key) {
      let off = [0, 0, 0];
      let vb = E0?.vb ?? 0;
      // (drawn a moment ago only: after a jump of the traffic's clock — seconds on, or back — a cut, no gap to close)
      const dt = E0 ? now - E0.drawn : Number.NaN;
      if (E0?.last && dt >= 0 && dt < CUT) {
        const was = E0.last.map((x, i) => x + E0.v[i]! * dt);
        off = was.map((x, i) => x - P[i]!);
        if (Math.hypot(...off) > 2000) off = [0, 0, 0];
        else if (!f && E0.key.startsWith("c") && T.prev && !p.gnd) {
          const gs = Math.hypot(ve, vn) || 1;
          const along = -(off[0]! * v[0]! + off[1]! * v[1]! + off[2]! * v[2]!) / gs;
          vb = Math.max(-VB_MAX, Math.min(VB_MAX, vb + (VB_GAIN * along) / Math.max(p.t - T.prev.t, 2)));
        }
      }
      easing.set(p.id, {
        key,
        off,
        at: now,
        vb,
        last: null,
        v: [0, 0, 0],
        drawn: now,
        bank: E0?.bank ?? 0,
        pitch: E0?.pitch ?? 0,
        pd: E0?.pd ?? Number.NaN,
        crab: E0?.crab ?? 0,
        tdAt: E0?.tdAt ?? Number.NaN,
        phase: E0?.phase ?? null,
        gearT: E0?.gearT ?? null,
        gear: E0?.gear ?? Number.NaN,
      });
    }
    const Ez = easing.get(p.id)!;
    // (the clock set back before the gap was opened: none left to close)
    const k = now < Ez.at ? 0 : Math.exp(-(now - Ez.at) / CLOSE);
    // (the gap closed along the ground, never through it: near the ground its part downwards left out — on the ground,
    // low over it, the wheels kept on it)
    let off = Ez.off.map((x) => x * k);
    if (low && over < GEAR.down) {
      const down = Math.min(0, off[0]! * L.U[0]! + off[1]! * L.U[1]! + off[2]! * L.U[2]!);
      if (down < 0) off = off.map((x, i) => x - L.U[i]! * down);
    }
    P = P.map((x, i) => x + off[i]!);
    // (the flight's laws: its coordinated turn's bank — eased, at an airliner's roll rate —, its incidence)
    const wind = trafficWind(A?.weather, over);
    const av = wind ? [ve - wind[0], vn - wind[1], vu] : [ve, vn, vu];
    const airspeed = Math.hypot(...av);
    const laws = flightLaws(av, [ae, an, au], alt, profile.wingLoad, omega);
    // (near the ground: no more bank than its wingtip's height allows)
    const bankMax = Math.min(BANK_MAX, Math.asin(Math.min(1, (Math.max(over, 0) + wheels) / Math.max(af.span / 2, 1))));
    const crossRoll =
      !gnd && wind && vu < -0.3 && over < 25
        ? Math.max(-5 * D, Math.min(5 * D, windCrab(ve, vn, wind) * D * 0.25)) * (1 - Math.min(1, over / 25))
        : 0;
    const bankTo = gnd ? 0 : Math.max(-bankMax, Math.min(bankMax, laws.bank + crossRoll));
    const dt = Math.max(0, now - Ez.drawn);
    const step = (bankTo - Ez.bank) * (1 - Math.exp(-dt / BANK_LAG));
    const bank = Ez.bank + Math.max(-profile.rollRate * D * dt, Math.min(profile.rollRate * D * dt, step));
    // (its nose: above its path by its incidence in the air; down, its mains on the runway first, its nose held up a
    // second and lowered over three — the derotation —, not dropped)
    const gs = Math.hypot(ve, vn);
    const gamma = gs > 1 ? laws.gamma : 0;
    if (!gnd) Ez.tdAt = Number.NaN;
    else if (!Number.isFinite(Ez.tdAt)) Ez.tdAt = dt < 1 && Ez.pitch > 0 ? now : now - DEROT.hold - DEROT.down;
    const sinceTd = gnd ? now - Ez.tdAt : Number.NaN;
    const derot = gnd ? 1 - smooth((sinceTd - DEROT.hold) / DEROT.down) : 0;
    // (a take-off's rotation: on its roll, the nose raised from VR − 10 m/s to VR − 4 — the five seconds before the wheels leave, at its
    // acceleration; the path drawn shows its ground speed a few m/s under the reported one there — to its lift-off attitude; before
    // 26 Nov 2026 a departure rolled flat and lifted off with its climb's attitude in one frame)
    const vr = profile.vr;
    const rot = gnd && RP.phase === "takeoff" ? profile.rotation * D * smooth((airspeed - (vr - 10)) / 6) : 0;
    const alphaT = !af.mesh ? 0 : gnd ? Math.max(Math.max(Ez.pitch, 0) * derot, rot) : laws.alpha;
    // (the nose's attitude moved at an airliner's pitch rate at most: no jump at the lift-off, nor anywhere)
    const pitchT = gamma + alphaT;
    const pd = Number.isFinite(Ez.pd)
      ? Ez.pd + Math.max(-profile.pitchRate * D * dt, Math.min(profile.pitchRate * D * dt, pitchT - Ez.pd))
      : pitchT;
    Ez.pd = pd;
    const alpha = !af.mesh ? 0 : gnd && pd - gamma < 0 ? 0 : pd - gamma;
    if (!gnd) Ez.pitch = gamma + alpha;
    // (its gear: wanted by its phase, moved over its travel — first seen: as wanted)
    const gearT = gearTarget(Ez.gearT, RP.phase, over, vu);
    Ez.gear = Number.isFinite(Ez.gear) ? gearStep(Ez.gear, gearT, Math.min(dt, 10)) : gearT;
    Ez.gearT = gearT;
    Ez.phase = RP.phase;
    Ez.last = P;
    Ez.v = v;
    Ez.drawn = now;
    Ez.bank = bank;
    // (standing: its reported heading)
    const psi = (timed.hdg ?? timed.trk) * D;
    const reversing = gnd && gs < 3 && timed.hdg !== null && Math.abs(wrap((timed.hdg - timed.trk) * D)) > Math.PI / 2;
    const hdir =
      gs > 0.1 && !reversing
        ? [0, 1, 2].map((i) => (L.E[i]! * ve + L.N[i]! * vn) / gs)
        : [0, 1, 2].map((i) => L.E[i]! * Math.sin(psi) + L.N[i]! * Math.cos(psi));
    // (its nose on its reported heading when it has one, its path on its track: a crosswind's crab — the wind's drift, the real one, as
    // its transponder says it — in the air, 20° at most; on the ground none — PLAN-AEROPORT-AAA V17)
    const crabRaw =
      !gnd && gs > 0.1 && Number.isFinite(timed.hdg) && Number.isFinite(timed.trk)
        ? ((((timed.hdg! - timed.trk!) % 360) + 540) % 360) - 180
        : 0;
    const crab = crabStep(Ez.crab, !gnd && wind ? windCrab(ve, vn, wind) : crabRaw, over, gnd, dt, Math.max(0, -vu));
    Ez.crab = crab;
    if (crab) {
      // (the track's direction turned about the local up by the crab: east of it positive — a heading right of the track)
      const ex = [0, 1, 2].map((i) => L.U[(i + 1) % 3]! * hdir[(i + 2) % 3]! - L.U[(i + 2) % 3]! * hdir[(i + 1) % 3]!);
      for (let i = 0; i < 3; i++) hdir[i] = hdir[i]! * Math.cos(crab) - ex[i]! * Math.sin(crab);
    }
    const fwd0 = unit([0, 1, 2].map((i) => hdir[i]! * Math.cos(gamma) + L.U[i]! * Math.sin(gamma)));
    const r0 = unit(cross(fwd0, L.U));
    const u0 = cross(r0, fwd0);
    const right = [0, 1, 2].map((i) => r0[i]! * Math.cos(bank) - u0[i]! * Math.sin(bank));
    const up1 = [0, 1, 2].map((i) => u0[i]! * Math.cos(bank) + r0[i]! * Math.sin(bank));
    // (its nose above its path by its incidence, about its wings' axis)
    const fwd = [0, 1, 2].map((i) => fwd0[i]! * Math.cos(alpha) + up1[i]! * Math.sin(alpha));
    const up = [0, 1, 2].map((i) => up1[i]! * Math.cos(alpha) - fwd0[i]! * Math.sin(alpha));
    const contact = trafficContact(gnd, gamma + alpha, bank, profile.wheelbase, Math.max(1, af.span * 0.12), sinceTd, Math.abs(p.vs));
    if (contact.lift > 0) P = P.map((x, i) => x + L.U[i]! * contact.lift);
    let flownVelocity = v;
    if (previousPosition && previousVelocity && previousDrawn !== undefined && now > previousDrawn && now - previousDrawn < 0.5) {
      const delta = now - previousDrawn;
      const estimate = P.map((x, i) => (x - previousPosition[i]!) / delta);
      const speed = Math.hypot(...estimate),
        before = Math.hypot(...previousVelocity);
      const bounded = Math.max(0, Math.max(before - 4 * delta, Math.min(before + 4 * delta, speed)));
      const blend = 1 - Math.exp(-delta / 0.2);
      const direction = previousVelocity.map((v, i) => v + (estimate[i]! - v) * blend);
      const norm = Math.hypot(...direction);
      flownVelocity = norm > 1e-6 ? direction.map((v) => (v / norm) * bounded) : [0, 0, 0];
    }
    Ez.v = flownVelocity;
    Ez.last = P;
    const drawnGeo = cartToGeodetic(WGS84_A, WGS84_F, P as Vec3);
    out.push({
      provenance:
        T.origin === "synthetic"
          ? "synthetic"
          : ground || (H.td !== undefined && td >= H.from) || td > p.t + 2 || td < (T.hist[0]?.t ?? p.t)
            ? "reconstructed"
            : "observed",
      airspeed,
      yawRate: omega,
      crab,
      contact: contact.comp,
      id: p.id,
      cs: p.cs,
      reg: p.reg,
      type: p.type,
      mesh: af.mesh,
      len: af.len,
      span: af.span,
      p: P,
      v: flownVelocity,
      fwd,
      up,
      right,
      alt: drawnGeo.h,
      msl: drawnGeo.h - geoidDeg(drawnGeo.lat / D, drawnGeo.lon / D),
      gnd,
      bank,
      age: Math.max(0, td - T.p.t),
      over: gnd ? 0 : over,
      alpha,
      pitch: gamma + alpha,
      sinceTd,
      phase: RP.phase,
      gear: Ez.gear,
      gearWanted: gearT,
      runway: RP.rwy ? { key: RP.rwy.way.key, a: RP.rwy.a, c: RP.rwy.c, pull: RP.wLat } : null,
      landing: H.way && H.td !== undefined ? { way: H.way, td: H.td } : null,
    });
  }
  if (easing.size > 4 * F.planes.size + 50)
    for (const k of easing.keys())
      if (!F.planes.has(k)) {
        easing.delete(k);
        paths.delete(k);
        landings.delete(k);
        posers.delete(k);
      }
  cache = { at: now, list: out, of: F, scene, weather: scene?.weather, net: scene?.net, enabled: scene?.activity?.enabled };
  return out;
}

/** Formation on the radar's lock when it is a traffic aircraft (our place in the formation chosen, its span's
 *  clearance): what to say. */
function trafficForm(this: CameraController): string {
  const L = this.radar.lock;
  if (!L?.startsWith("trf:")) return t("Formation on the lock: lock an airliner first (Tab)");
  const id = L.slice(4);
  const c = this.trafficNow().find((x) => x.id === id);
  if (!c) return t("Formation on the lock: lock an airliner first (Tab)");
  if (this.icpt) this.icptOff();
  const S = this.s;
  // (the close formations' gap: both half spans and 15 m — as the room's — over the F-35s' 26 m)
  const kspan = (c.span / 2 + 5.4 + 15) / 26;
  const name = c.cs || c.reg || id.toUpperCase();
  this.form = {
    slot: -1,
    name,
    at: formSlotFor(S.formShape, S.formPos, S.formSpacing, kspan),
    shape: S.formShape,
    pos: S.formPos,
    spacing: S.formSpacing,
    kspan,
    since: performance.now() / 1000,
    armed: false,
    last: null,
    lead: () => this.trafficLead(id),
    trafficId: id,
  };
  this.s.flightMode = "plane";
  return tf("Formation {0} on {1} — #{2}", formationLabel(S.formShape), `${name}${c.reg && c.cs ? ` (${c.reg})` : ""}`, S.formPos);
}

/** A frame of the traffic: the aircraft followed (a formation's lead, the radar's lock, the camera's subject) asked
 *  fresh; its radar source (the aircraft about us, neutral, answering). Run by the flight's step, else by the frame's
 *  own (controller/lens.ts: no craft flown — the free camera —, the traffic flies on all the same). */
function trafficStep(this: CameraController, dt = 0) {
  this.trafficStepped = true;
  // (its clock: on with the frames — paused, the game's frames stop and so does it: every motion still, the image
  // converging —, behind the wall clock after a pause catching it up half again as fast; far behind, set to it)
  const wall = Date.now() / 1000;
  if (this.trafficT === undefined || wall - this.trafficT > 900 || this.trafficT > wall) this.trafficT = wall;
  else {
    this.trafficT += dt;
    this.trafficT += Math.min(Math.max(wall - this.trafficT, 0), 0.5 * dt);
  }
  if (this.traffic) {
    const lock = this.radar.lock?.startsWith("trf:") ? this.radar.lock.slice(4) : null;
    // (the airliner the camera follows — the camera panel's views about a craft, camera/subjectcam.ts —: its trace too)
    const vt = String(this.viewController().s.target);
    const followed = vt.startsWith("trf:") ? vt.slice(4) : null;
    this.traffic.focus = this.form?.trafficId ?? lock ?? followed;
  }
  if (!this.traffic?.planes.size) {
    this.radarSources.delete("trf");
    return;
  }
  if (this.radarSources.has("trf")) return;
  this.radarSources.set("trf", (fix) =>
    this.trafficNow().map(
      (c): RadarObject => ({
        id: `trf:${c.id}`,
        r: fix.toLocal(c.p as [number, number, number]),
        v: [dot(c.v, fix.E), dot(c.v, fix.N), dot(c.v, fix.U)],
        rcs: rcsOf(c.len),
        kind: c.gnd ? "ground" : "air",
        iff: "neutral",
        name: c.cs || c.reg || c.id.toUpperCase(),
        // (its type — the crew's lists; on the ground: said)
        type: c.gnd ? `${c.type} SOL` : c.type,
        squawk: true,
      }),
    ),
  );
}

/** The aircraft `id` as a formation's leader (null: gone). */
function trafficLead(this: CameraController, id: string): FormCraft | null {
  const c = this.trafficNow().find((x) => x.id === id);
  return c ? { p: c.p, v: c.v, fwd: c.fwd, aLat: G * Math.tan(c.bank) } : null;
}

/**
 * The `max` nearest of a list within `range` [m] of a place fixed to the Earth (each one's place `p` there), nearest first:
 * their distances found once, only the near ones sorted — the meshes, the labels and the lights made for those alone.
 * A priority member reserves the first slot even outside range (the airport camera's subject); the total stays bounded.
 */
export function nearest<T extends { p: readonly number[] }>(
  list: readonly T[],
  at: readonly number[],
  range: number,
  max: number,
  priority?: T,
): T[] {
  const near: { c: T; d: number }[] = [];
  const r2 = range * range;
  for (const c of list) {
    if (c === priority) continue;
    const x = c.p[0]! - at[0]!,
      y = c.p[1]! - at[1]!,
      z = c.p[2]! - at[2]!;
    const d = x * x + y * y + z * z;
    if (d < r2) near.push({ c, d });
  }
  near.sort((a, b) => a.d - b.d);
  const out: T[] = priority && max > 0 && list.includes(priority) ? [priority] : [];
  for (let i = 0; i < near.length && out.length < max; i++) out.push(near[i]!.c);
  return out;
}

/** The jets drawn with the A320's mesh (the A320 family, and the others of its size — game/airtypes.ts) near the view:
 *  the game's own A320 instead, its rig moving (its gear, flaps, spoilers, reversers) — within this [m], the nearest this
 *  many (the renderer's rigged slots: ship.ts JET_SLOTS, shared with the F-35s) —; the A320's length [m] and its wheels'
 *  rest under its origin [m] (gear.ts: its belly, 1.59 m over the ground) */
export const TRAFFIC_RIG = { near: 4000, max: 4 } as const;
const A320_LEN = 37.57;
const A320_WHEELS = 1.59;

/** Each rigged airliner's rig (src/a320/pose.ts): its moving parts from its flight. */
const posers = new Map<string, { P: A320Poser; at: number }>();
/**
 * An airliner's moving parts as its flight shows them (src/a320/pose.ts — its actuators' own rates): its gear as its phase
 * wants it (traffic/runway-phase.ts — moved over its travel, its doors in their sequence), its flaps FULL on the approach
 * and on the rollout (CONF 3 above 900 m, CONF 1+F on the take-off roll and the climb-out under 900 m), its landing lights
 * below 3 000 m and rolling on the runway, its ground spoilers out at touchdown, its reversers from a second and a half
 * after it down to 70 kt, its engines' N1 (take-off, approach, reverse, idle), its nose's oleo free while the nose is held
 * up.
 */
/**
 * A traffic airliner's configuration as its crew would set it (its rig's and its effects' — a320/effects.ts): its flap lever (0 … 4:
 * CONF 1+F lined up and rolling for its take-off and climbing under 900 m; 3 then FULL on its approach), its engines' N1 [%] and
 * reversers 0…1, its ground spoilers, lined up on its runway (still or about to roll), its landing lights.
 */
export function trafficConfig(c: TrafficCraft): {
  flapLever: number;
  n1: number;
  rev: number;
  spoil: number;
  nose: boolean;
  lights: boolean;
} {
  const gs = Math.hypot(c.v[0]!, c.v[1]!, c.v[2]!);
  const since = Number.isFinite(c.sinceTd) ? c.sinceTd : Number.POSITIVE_INFINITY;
  const landing = c.phase === "landing";
  const profile = profileOf(c.type, c.len);
  const rev = c.gnd && landing && since > 1.5 && gs > 36 ? 1 : 0;
  const spoil = c.gnd && landing && since > 0.3 && gs > 15 ? 1 : 0;
  const nose = c.gnd && c.alpha < 0.3 * D;
  const out = c.phase === "takeoff" || c.phase === "climb";
  // (lined up on its runway, still or about to roll: configured for its take-off — flaps 1+F, its lights on)
  const linedUp = c.gnd && !landing && !!c.runway && Math.abs(c.runway.c) < 20 && gs < 15 && c.runway.a > -100;
  const flapLever = c.gnd
    ? landing && gs > 20
      ? 4
      : c.phase === "takeoff" || linedUp
        ? 1
        : 0
    : out
      ? c.over < 900
        ? 1
        : 0
      : c.over < 900 && (c.phase === "approach" || landing)
        ? 4
        : c.over < 2000 && c.gearWanted === 1
          ? 3
          : 0;
  const n1 = rev ? 70 : c.phase === "takeoff" ? profile.takeoff : c.gnd ? profile.idle : out ? 85 : c.over < 900 ? 52 : 78;
  return { flapLever, n1, rev, spoil, nose, lights: c.gnd ? c.phase === "takeoff" || landing || linedUp : c.over < 3000 };
}

export function trafficRig(c: TrafficCraft, now: number) {
  let R = posers.get(c.id);
  if (!R) posers.set(c.id, (R = { P: new A320Poser(), at: now - 10 }));
  const dt = Math.min(Math.max(now - R.at, 0), 10);
  R.at = now;
  const gs = Math.hypot(c.v[0]!, c.v[1]!, c.v[2]!);
  const K = trafficConfig(c);
  const { flapLever, rev, spoil, nose } = K;
  return R.P.step({
    dt,
    pitch: Math.max(-0.4, Math.min(0.4, c.alpha / (15 * D))),
    yaw: Math.max(-0.5, Math.min(0.5, (c.crab ?? 0) / (20 * D))),
    roll: Math.max(-1, Math.min(1, -c.bank / (25 * D))),
    trim: 0,
    flapLever,
    ias: ((c.airspeed ?? gs) * Math.exp(-Math.max(0, c.msl) / 17000)) / 0.514444,
    speedBrake: 0,
    groundSpoilers: spoil,
    gear: c.gear,
    comp: c.contact ?? (c.gnd ? [nose ? 0.12 : 0, 0.12, 0.12] : [0, 0, 0]),
    onGround: c.gnd,
    groundSpeed: c.gnd ? gs : 0,
    steer:
      c.gnd && gs > 0.3 ? Math.max(-1, Math.min(1, Math.atan((profileOf(c.type, c.len).wheelbase * (c.yawRate ?? 0)) / gs) / (70 * D))) : 0,
    n1: [K.n1, K.n1],
    reverser: [rev, rev],
    alpha: c.alpha / D,
    landingLights: K.lights,
  });
}

/** An airliner as the renderer draws it: its mesh, its place and axes on the view's camera; the A320's rig moving
 *  (`a320`), and while that mesh comes in, the plain one it stands in for (`alt`). */
export interface TrafficInstance {
  id: AirlinerId | "a320";
  rel: Vec3;
  axes: [Vec3, Vec3, Vec3];
  hidden: boolean;
  far: boolean;
  a320?: { props: Props; spins: Props };
  alt?: { id: AirlinerId; rel: Vec3; axes: [Vec3, Vec3, Vec3] };
  /** the aircraft's own id (its feed's): the renderer's choice of mesh held by it from frame to frame (renderer.trafficRigShare) */
  uid?: string;
  /** on the ground or low over it (its shadow there — ship-casters.ts), its gear 0…1 (the plain meshes' — ship.wgsl
   *  trafficGearPos) and its airline's livery (traffic/livery.ts) */
  cast: boolean;
  traffic: { gear: number; livery: Livery };
}

/** a traffic airliner casts its shadow on the ground under this height of its wheels [m] (ship-casters.ts: within 4 km of the view) */
export const CAST_OVER = 60;

/** The traffic for the renderer: the nearest dozen with a mesh within 25 km of the view (`view`: its controller — a
 *  spectator's, else this one; the free camera with no craft too) — their place and axes on the view's camera's, from its
 *  place, the axes scaled to their type's length; hidden behind what the image holds nearer. The A320's size near the view
 *  (TRAFFIC_RIG): the game's A320, its rig moving — its gear as its phase wants it. */
/**
 * The airliners heard from the view (PLAN-AEROPORT-AAA V16 — audio/engine.ts trafficFrame): the two nearest moving within 4 km of the
 * view's eye — those parked at their stands silent —, each its place on the view's camera [m], its engines' N1 and reversers
 * (trafficConfig), its speed along the line of sight [m/s, away > 0].
 */
function trafficSounds(
  this: CameraController,
  view: CameraController = this,
): { at: [number, number, number]; n1: number; rev: number; vr: number }[] {
  const list = this.trafficNow();
  if (!list.length) return [];
  const E = earthView(view);
  if (!E) return [];
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  const d = (c: TrafficCraft) => Math.hypot(c.p[0]! - E.p0[0], c.p[1]! - E.p0[1], c.p[2]! - E.p0[2]);
  // (the one the airport view films first)
  const filmed = airportState()?.current ?? airportState()?.filler ?? null;
  const rank = (c: TrafficCraft) => d(c) - (c.id === filmed ? 1e9 : 0);
  return list
    .filter((c) => c.mesh && Math.hypot(...c.v) > 2 && d(c) < 4000)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 2)
    .map((c) => {
      const K = trafficConfig(c);
      const r = [c.p[0]! - E.p0[0], c.p[1]! - E.p0[1], c.p[2]! - E.p0[2]];
      const l = Math.hypot(r[0]!, r[1]!, r[2]!) || 1;
      return {
        at: cam(r) as [number, number, number],
        n1: K.n1,
        rev: K.rev,
        vr: (c.v[0]! * r[0]! + c.v[1]! * r[1]! + c.v[2]! * r[2]!) / l,
      };
    });
}

function trafficShips(this: CameraController, view: CameraController = this): TrafficInstance[] {
  const list = this.trafficNow();
  if (!list.length) return [];
  const E = earthView(view);
  if (!E) return [];
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  const n = (v: Vec3, k: number): Vec3 => {
    const l = Math.hypot(...v) || 1;
    return [(v[0] / l) * k, (v[1] / l) * k, (v[2] / l) * k];
  };
  const now = this.trafficClock ? this.trafficClock() : (this.trafficT ?? Date.now() / 1000);
  const out: TrafficInstance[] = [];
  let rigged = 0;
  const filmedId = airportState()?.current ?? airportState()?.filler ?? null;
  for (const c of nearest(
    list.filter((c) => c.mesh),
    E.p0,
    25_000,
    12,
    list.find((c) => c.mesh && c.id === filmedId),
  )) {
    const s = c.len / (c.mesh === "a320t" ? 37.7 : 36.2);
    const plain = {
      id: c.mesh!,
      rel: cam([c.p[0]! - E.p0[0], c.p[1]! - E.p0[1], c.p[2]! - E.p0[2]]),
      axes: [n(cam([-c.right[0]!, -c.right[1]!, -c.right[2]!]), s), n(cam(c.up), s), n(cam(c.fwd), s)] as [Vec3, Vec3, Vec3],
    };
    const d = Math.hypot(c.p[0]! - E.p0[0], c.p[1]! - E.p0[1], c.p[2]! - E.p0[2]);
    // (its gear as its phase wants it, its airline's colours by its callsign — the plain mesh's and the game's A320's alike)
    const own = { cast: c.gnd || c.over < CAST_OVER, traffic: { gear: c.gear, livery: liveryOf(c.cs, c.reg) } };
    // (the one the airport view films: its rig whatever its distance — the tower's long lens, a final 8 km out: its flaps, its gear,
    // its lights moving; the renderer still shows the plain mesh when it is a few pixels on the image — PLAN-AEROPORT-AAA V15)
    const filmed = c.id === filmedId;
    if (c.mesh === "a320t" && (filmed || (d < TRAFFIC_RIG.near && rigged < (this.trafficRigMax ?? TRAFFIC_RIG.max)))) {
      if (!filmed) rigged++;
      // (the game's A320 — its origin its belly, its wheels 1.59 m under it, the plain mesh's 3.9 m —, its rig)
      const k = c.len / A320_LEN;
      const down = (MESH.a320t.wheels * c.len) / MESH.a320t.len - A320_WHEELS * k;
      out.push({
        id: "a320",
        rel: cam([0, 1, 2].map((i) => c.p[i]! - c.up[i]! * down - E.p0[i]!)),
        axes: [n(cam([-c.right[0]!, -c.right[1]!, -c.right[2]!]), k), n(cam(c.up), k), n(cam(c.fwd), k)],
        hidden: false,
        far: true,
        a320: trafficRig(c, now),
        alt: plain,
        uid: c.id,
        ...own,
      });
      continue;
    }
    out.push({ ...plain, hidden: false, far: true, ...own });
  }
  return out;
}

/** A label and its lights for the overlay: on the camera's axes [m] (x right, y up, z ahead). */
export interface TrafficMark {
  id: string;
  at: Vec3;
  dist: number;
  label: string;
  /** its lights: where (the camera's axes [m]), their colour, lit now */
  lights: { at: Vec3; colour: string; on: boolean; size: number }[];
  /** its object's radius [m] (half its length): the overlay's occlusion test (renderer.labelSeen) — none: 25 m */
  r?: number;
}

/** The overlay's aircraft lights' reach [m]: 80 km — from high up (the traffic's focus asked wider: traffic/focus.ts) up to
 *  four fifths of its radius, never beyond the horizon. */
export function lightsReach(alt: number, airR?: number): number {
  if (!airR) return 80_000;
  const h = Math.max(0, alt);
  return Math.max(80_000, Math.min(0.8 * airR * 1e3, Math.sqrt(2 * WGS84_A * h + h * h)));
}

/**
 * The traffic's labels and lights within 80 km of the view (the nearest 24; farther from high up — lightsReach): its
 * callsign, registration, type, altitude over the sea in the units chosen (an altimeter's, not the ellipsoid's); the red and green navigation lights at its wingtips and
 * the white at its tail, the red beacon (a flash a second), the white strobes (two flashes each 1.2 s), its landing
 * lights under 3 000 m. `view`: the view's controller (a spectator's, else this one — the free camera with no craft too).
 */
function trafficOverlay(this: CameraController, fmtAlt: (m: number) => string, view: CameraController = this): TrafficMark[] {
  const list = this.trafficNow();
  if (!list.length) return [];
  const E = earthView(view);
  if (!E) return [];
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  const rigs = new Set(
    this.trafficShips(view)
      .filter((c) => c.a320 && (this.trafficRigVisible?.(c) ?? true))
      .map((c) => c.uid),
  );
  const tNow = performance.now() / 1000;
  const F = this.trafficAt;
  const reach = F ? lightsReach(F.alt, F.airR) : 80_000;
  const out: TrafficMark[] = [];
  const filmedId = airportState()?.current ?? airportState()?.filler ?? null;
  for (const c of nearest(
    list,
    E.p0,
    reach,
    24,
    list.find((c) => c.id === filmedId),
  )) {
    const rel = cam([c.p[0]! - E.p0[0], c.p[1]! - E.p0[1], c.p[2]! - E.p0[2]]);
    const dist = Math.hypot(...rel);
    const A = c.mesh ? attachmentScale(c.mesh, c.len, rigs.has(c.id)) : null;
    const at = (x: number, y: number, z: number): Vec3 => {
      const offset = attachmentOffset({ model: A?.model ?? "a320t", scale: 1, down: A?.down ?? 0 }, [-x, y, z], c.right, c.up, c.fwd);
      return cam(c.p.map((v, k) => v - E.p0[k]! + offset[k]!));
    };
    const ph = (Number.parseInt(c.id.slice(-3), 16) % 1000) / 1000;
    const beacon = (tNow + ph) % 1 < 0.12;
    const st = (tNow + ph * 1.2) % 1.2;
    const strobe = st < 0.05 || (st > 0.15 && st < 0.2);
    // (its lights where its mesh has them, to its size; a helicopter's about its middle)
    const M = A ? ATTACHMENTS[A.model] : null;
    const k = A?.scale ?? 1;
    const tip = M ? M.nav.map((x) => x * k) : [c.span / 2, 0, 0];
    const strobeTip = A?.model === "a320" ? [16.7246 * k, 2.967212 * k, -2.03967 * k] : tip;
    const tail = M ? M.tail.map((x) => x * k) : [0, 0, -c.len / 2];
    const bcn = M ? M.beacon.map((x) => x * k) : [0, 1.5, 0];
    const lower = M ? M.lower.map((x) => x * k) : [0, -1, 0];
    const land = M ? M.landing.map((x) => x * k) : [0, -1, c.len / 2];
    const observer = E.p0.map((x, i) => x - c.p[i]!);
    const visible = trafficLightVisibility(
      Math.atan2(dot(observer, c.right), dot(observer, c.fwd)) / D,
      dot(observer, c.up) / (Math.hypot(...observer) || 1),
    );
    const powered = c.phase !== "parked";
    // (the mesh's x is its left: the left wingtip's light red, the right's green)
    const lights = [
      { at: at(-tip[0]!, tip[1]!, tip[2]!), colour: "rgba(255, 60, 50, 1)", on: visible.port, size: 1 },
      { at: at(tip[0]!, tip[1]!, tip[2]!), colour: "rgba(60, 255, 120, 1)", on: visible.starboard, size: 1 },
      { at: at(tail[0]!, tail[1]!, tail[2]!), colour: "rgba(255, 255, 255, 1)", on: visible.tail, size: 0.8 },
      { at: at(lower[0]!, lower[1]!, lower[2]!), colour: "rgba(255, 40, 30, 1)", on: beacon && powered && visible.lower, size: 1.3 },
      { at: at(bcn[0]!, bcn[1]!, bcn[2]!), colour: "rgba(255, 40, 30, 1)", on: beacon && powered && visible.upper, size: 1.3 },
      { at: at(-strobeTip[0]!, strobeTip[1]!, strobeTip[2]!), colour: "rgba(255, 255, 255, 1)", on: strobe && powered, size: 1.6 },
      { at: at(strobeTip[0]!, strobeTip[1]!, strobeTip[2]!), colour: "rgba(255, 255, 255, 1)", on: strobe && powered, size: 1.6 },
      { at: at(tail[0]!, tail[1]!, tail[2]!), colour: "rgba(255, 255, 255, 1)", on: strobe && powered, size: 1.6 },
      // (its landing lights: low in the air, and rolling down the runway — its take-off, its landing)
      ...((c.gnd ? c.phase === "takeoff" || c.phase === "landing" : c.over < 3000)
        ? [1, -1].map((side) => ({
            at: at(side * land[0]!, land[1]!, land[2]!),
            colour: "rgba(255, 250, 230, 1)",
            on: visible.landing,
            size: 2.2,
          }))
        : []),
    ];
    const label = [
      c.provenance === "synthetic" ? t("Synthetic") : c.provenance === "reconstructed" ? t("Reconstructed") : "",
      c.cs,
      c.reg,
      c.type,
      c.gnd ? "GND" : fmtAlt(c.msl),
    ]
      .filter(Boolean)
      .join(" · ");
    out.push({ id: c.id, at: rel, dist, label, lights, r: c.len / 2 });
  }
  return out;
}

export function installTraffic(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { trafficStep, trafficNow, trafficShips, trafficSounds, trafficOverlay, trafficLead, trafficForm });
}
