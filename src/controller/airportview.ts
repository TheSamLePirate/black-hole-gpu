// The airport view (docs/PLAN-AEROPORT-AAA.md V2, V7): an airport of the world chosen — by its code, or the nearest —,
// the free camera watching each airliner that lands there or takes off from it, one after the other, filmed by the director
// chosen (cine/airport.ts). Its movements: the real traffic (controller/traffic.ts, drawn a minute behind the real time)
// lined up with one of its runways — arrivals on final, descending, or rolling out on it; departures lined up on it, rolling
// for their take-off or climbing out along it —, ordered by the seconds to their touchdown or lift-off; the one filmed held
// until it has rolled out or climbed away, then the next. The traffic asked about the airport while the view is on (not
// about the craft flown). Its caption: the aircraft, its type, its registration, the runway, the seconds to the event.

import { bodyAxes, solarBody } from "../system/solar";
import { bodyFixedOf, fromBodyFixed, groundRelief, groundVelocity } from "../system/our-surface";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { setHomePose } from "../camera";
import { AirportDirector, type AirportMode, type AirportShot, type Lander, type Place, type RunwayWay } from "../cine/airport";
import type { V3 } from "../cine/rig";
import { type Airfield, fieldByCode, fieldsNearAsync } from "../world/runways";
import type { TrafficCraft } from "./traffic";
import type { CameraController } from "../controls";
import { C_MPS, M_METRES } from "../units";

const D = Math.PI / 180;
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const unit = (a: readonly number[]): V3 => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};
const cross = (a: readonly number[], b: readonly number[]): V3 => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

/** A movement: the aircraft, the runway it lands on or takes off from, the seconds to its touchdown or lift-off (< 0: since),
 *  where it is on it; a departure's `dep`. */
export interface Arrival {
  c: TrafficCraft;
  way: RunwayWay;
  eta: number;
  a: number;
  cross: number;
  dep?: boolean;
  /** one chosen in the list in no movement: followed freely (behind it, about it) */
  free?: boolean;
}

export const DEPARTURES = {
  /** lined up: its way (its nose, stopped) within this of the runway's [°], this near its axis on the ground [m], from this
   *  short of the threshold [m]; lined up and still: the seconds to its lift-off guessed (the clearance, the spool-up, the roll) */
  trk: 20,
  cross: 45,
  short: 80,
  waiting: 50,
  /** its roll: lift-off at VR [m/s], accelerating at [m/s²] */
  vr: 74,
  accel: 2,
  /** climbing out: this near its axis [m] widening past the far end, this far past it at most [m]; climbed away past this
   *  height [m] or this long after its lift-off [s] */
  crossAir: 80,
  out: 8000,
  high: 1200,
  done: 55,
} as const;

export const ARRIVALS = {
  /** lined up: its way within this of the runway's [°], this near its axis [m] (wider far out: 6 % of the distance),
   *  this far out at most [m], this high at most [m] */
  trk: 25,
  cross: 300,
  far: 30_000,
  high: 2000,
  /** the touchdown zone [m past the threshold] (its seconds to touchdown, none made up); the steepest slope down to it
   *  [°] and the height over it allowed [m] */
  aim: 400,
  slope: 5,
  margin: 80,
  /** rolled out: slower than this [m/s], or this long after touchdown [s] */
  slow: 20,
  done: 45,
} as const;

interface AirportState {
  code: string;
  name: string;
  lat: number;
  lon: number;
  ways: RunwayWay[];
  dir: AirportDirector;
  /** the one filmed, those done, the arrivals this frame, the shot now */
  current: string | null;
  done: Set<string>;
  queue: Arrival[];
  shot: AirportShot;
  /** the field the view had before [deg] */
  fov0: number | null;
  /** the one filmed still on its runway this long [s] (a departure waiting) */
  still: number;
  obstructed: number;
  /** the one chosen in the list (its id): followed whatever it does, until let go (null: the director's choice) */
  pinned: string | null;
  /** the airliners about the airport in no queue: on its ground (taxiing, parked) or flying near it */
  others: TrafficCraft[];
  /** none due: one of them moving filmed meanwhile (its id — Cinema's waiting shots, V9) */
  filler: string | null;
  /** those seen landing (their id → the view's time [s]): no departure for ten minutes after */
  arrived: Map<string, number>;
  /** the view's own time [s] */
  t: number;
}

let S: AirportState | null = null;
let main: CameraController | null = null;

/** What the game does when the view starts (main.ts sets them): the clock put on the moment the traffic is drawn at — the real
 *  time less its delay: its light the real one's (the traffic is live; the scene's own date — 2067 by default — lit Los Angeles
 *  at a winter dawn under real noon traffic, 26 Nov 2026) —, the clock's speed real time. */
export const airportHooks: { visible: (id: string) => boolean; live: () => void; prepare: (f: Airfield) => Promise<void> } = {
  visible: () => true,
  live: () => {},
  prepare: async () => {},
};

/**
 * The view opened (PLAN-AEROPORT-AAA V14): the game prepared first (main.ts — an A320 parked at the airport when the craft flown is
 * not one near it: the effects' frame, the weather, the distances the traffic's effects are reckoned from are the craft's — with a
 * spacecraft in orbit the airliners had no vapour, no tyre smoke, no spray), then the view started. Its message, or null.
 */
export async function airportLaunch(c: CameraController, f: Airfield, mode: AirportMode, out: () => void): Promise<string | null> {
  await airportHooks.prepare(f).catch(() => {});
  return airportStart(c, f, mode, out);
}

/** The airport view's state (null: off). */
export function airportState() {
  return S;
}

/** Where the traffic is asked about while the view is on (null: off — about the craft flown). */
export function airportCentre(): { lat: number; lon: number } | null {
  return S ? { lat: S.lat, lon: S.lon } : null;
}

/** An airport by its code (ICAO, IATA), else the nearest to the view with a paved runway of 1 800 m (within 80 km). */
export async function airportByCode(c: CameraController, code?: string): Promise<Airfield | null> {
  if (code) return fieldByCode(code.trim().toUpperCase());
  const g = c.geoNow();
  if (!g) return null;
  const near = await fieldsNearAsync(g.lat, g.lon, 80_000, (f) => f.runways.some((r) => r.surface === "paved" && r.len >= 1800));
  const d = (f: Airfield) => Math.hypot(f.lat - g.lat, (f.lon - g.lon) * Math.cos(g.lat * D));
  return near.sort((a, b) => d(a) - d(b))[0] ?? null;
}

/** Its runways as landed on: each paved one 1 200 m long at least, both ways. */
export function waysOf(f: Airfield): RunwayWay[] {
  const out: RunwayWay[] = [];
  for (const r of f.runways) {
    if (r.surface !== "paved" || r.len < 1200) continue;
    const p1 = geodeticToCart(WGS84_A, WGS84_F, r.lat1 * D, r.lon1 * D, 0) as V3,
      p2 = geodeticToCart(WGS84_A, WGS84_F, r.lat2 * D, r.lon2 * D, 0) as V3;
    const len = Math.hypot(...sub(p2, p1));
    for (const [o, e, name, lat, lon] of [
      [p1, p2, r.le, r.lat1, r.lon1],
      [p2, p1, r.he, r.lat2, r.lon2],
    ] as const) {
      const d = unit(sub(e, o));
      const up: V3 = [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
      out.push({ o, d, r: unit(cross(d, up)), up, len, name: `${f.icao || f.ident} ${name}` });
    }
  }
  return out;
}

/** A runway's ground: along it, across it [m], so high over the ground there [m] (the relief as drawn: levelled). */
export function placeOn(W: RunwayWay): Place {
  return (a, c, h) => {
    const q = [0, 1, 2].map((k) => W.o[k]! + W.d[k]! * a + W.r[k]! * c) as V3;
    const g = cartToGeodetic(WGS84_A, WGS84_F, q);
    const gh = groundRelief("earth", bodyFixedOf("earth", g.lat / D, g.lon / D, 0));
    return geodeticToCart(WGS84_A, WGS84_F, g.lat, g.lon, gh + h) as V3;
  };
}

/**
 * The arrivals among the traffic: each lined up with one of the airport's runways — on final (descending, below 2 km,
 * within 30 km) or rolling out on it —, its seconds to touchdown (its landing's made up, else from its speed down the
 * runway to the touchdown zone), in that order.
 */
export function arrivalsOf(list: readonly TrafficCraft[], ways: readonly RunwayWay[], now: number): Arrival[] {
  const out: Arrival[] = [];
  for (const c of list) {
    const speed = Math.hypot(...c.v);
    let best: Arrival | null = null;
    for (const W of ways) {
      const q = sub(c.p, W.o);
      const a = dot(q, W.d),
        cr = dot(q, W.r);
      if (a < -ARRIVALS.far || a > W.len) continue;
      // (its way over the ground along the runway's)
      const vh = sub(
        c.v,
        W.up.map((u) => u * dot(c.v, W.up)),
      );
      if (Math.hypot(...vh) > 5 && dot(unit(vh), W.d) < Math.cos(ARRIVALS.trk * D)) continue;
      let eta: number;
      if (c.gnd) {
        if (a < -100 || Math.abs(cr) > 60 || speed < 8) continue;
        // (a rollout only: touched down not long ago, or in its landing's phase — a take-off's roll is a departure's, 26 Nov 2026)
        if (c.phase === "takeoff" || (!(c.sinceTd < 120) && c.phase !== "landing")) continue;
        eta = Number.isFinite(c.sinceTd) ? -c.sinceTd : -ARRIVALS.done;
      } else {
        if (Math.abs(cr) > ARRIVALS.cross + 0.06 * Math.max(-a, 0) || c.over > ARRIVALS.high || dot(c.v, W.up) > 0.5) continue;
        // (on a slope down to it: not higher than 5° over the way left to the touchdown zone — one lined up but too
        // high for it is passing over, going round, on its downwind: not landing there now)
        if (c.over > Math.max(ARRIVALS.aim - a, 0) * Math.tan(ARRIVALS.slope * D) + ARRIVALS.margin) continue;
        const L = c.landing;
        eta =
          L && dot(L.way.d, W.d) > 0.999 && Math.hypot(...sub(L.way.o, W.o)) < 50
            ? L.td - now
            : etaOf(ARRIVALS.aim - a, Math.max(dot(c.v, W.d), 30), c.over, -dot(c.v, W.up));
      }
      if (!best || Math.abs(cr) < Math.abs(best.cross)) best = { c, way: W, eta, a, cross: cr };
    }
    if (best) out.push(best);
  }
  return out.sort((x, y) => x.eta - y.eta);
}

/**
 * The departures among the traffic: each lined up on one of the airport's runways on the ground — still at its start, or rolling
 * for its take-off (its phase « takeoff »: not a landing's rollout) — or climbing out along it, its seconds to its lift-off (the
 * roll to VR at its acceleration; lined up and still, a guess; < 0: since it, by its height at its climb), in that order.
 */
export function departuresOf(list: readonly TrafficCraft[], ways: readonly RunwayWay[]): Arrival[] {
  const out: Arrival[] = [];
  const P = DEPARTURES;
  for (const c of list) {
    if (c.phase === "landing" || c.phase === "approach" || c.phase === "descent") continue;
    const speed = Math.hypot(...c.v);
    let best: Arrival | null = null;
    for (const W of ways) {
      const q = sub(c.p, W.o);
      const a = dot(q, W.d),
        cr = dot(q, W.r);
      const vh = sub(
        c.v,
        W.up.map((u) => u * dot(c.v, W.up)),
      );
      const along = speed > 3 ? dot(unit(vh), W.d) : dot(c.fwd, W.d);
      if (along < Math.cos(P.trk * D)) continue;
      let eta: number;
      if (c.gnd) {
        if (a < -P.short || a > W.len - 300 || Math.abs(cr) > P.cross) continue;
        // (rolling: its take-off's roll only — one taxiing along the runway, a landing slowing on it, is none)
        if (speed > 3 && c.phase !== "takeoff") continue;
        // (a landing's rollout — touched down not long ago —: not a departure)
        if (Number.isFinite(c.sinceTd) && c.sinceTd < 120) continue;
        eta = speed > 3 ? Math.max(P.vr - speed, 0) / P.accel : P.waiting;
      } else {
        const climb = dot(c.v, W.up);
        // (climbing out: its phase the climb's or the take-off's, clearly off the runway — a landing's reports bouncing a few metres
        // over it once read as a climb-out, 26 Nov 2026)
        if (c.phase !== "climb" && c.phase !== "takeoff") continue;
        if (climb < 1.5 || c.over < 10 || a < 0 || a > W.len + P.out || c.over > P.high) continue;
        if (Math.abs(cr) > P.crossAir + 0.08 * Math.max(a - W.len, 0)) continue;
        eta = -(c.over / Math.max(climb, 3) + 2);
      }
      if (!best || Math.abs(cr) < Math.abs(best.cross)) best = { c, way: W, eta, a, cross: cr, dep: true };
    }
    if (best) out.push(best);
  }
  return out.sort((x, y) => x.eta - y.eta);
}

/** The airport's movements: its arrivals and departures, each aircraft once, by their seconds to the event. */
export function movementsOf(list: readonly TrafficCraft[], ways: readonly RunwayWay[], now: number): Arrival[] {
  const arr = arrivalsOf(list, ways, now);
  const seen = new Set(arr.map((x) => x.c.id));
  return [...arr, ...departuresOf(list, ways).filter((x) => !seen.has(x.c.id))].sort((x, y) => x.eta - y.eta);
}

/**
 * Its seconds to touchdown, none made up: by the way left to the touchdown zone at its speed far out; by its height
 * at its sink close in (its real touchdown point — a displaced threshold, a long landing — the distance's error,
 * not the height's), the two blended from 600 m down to 300 m (the flare's few seconds added).
 */
export function etaOf(way: number, speed: number, over: number, sink: number): number {
  const byWay = way / speed;
  if (!(sink > 1.5)) return byWay;
  const byHeight = (over + 10) / sink + 2;
  const w = Math.min(1, Math.max(0, (600 - over) / 300));
  return byWay * (1 - w) + byHeight * w;
}

/** Done with: an arrival rolled out (slow, or long down, or off the runway); a departure climbed away. */
const finished = (A: Arrival | undefined) =>
  !A ||
  (A.dep
    ? !A.c.gnd && (A.c.over > DEPARTURES.high || A.eta < -DEPARTURES.done)
    : A.c.gnd && (Math.hypot(...A.c.v) < ARRIVALS.slow || A.eta < -ARRIVALS.done));

/** The view on: the airport (its runways), the director's mode; the free camera taken out (`out`: F3's) if it was not. */
export function airportStart(c: CameraController, f: Airfield, mode: AirportMode, out: () => void): string | null {
  const ways = waysOf(f);
  if (!ways.length) return `${f.icao || f.ident}: no paved runway`;
  main = c;
  if (!c.spectating) out();
  if (!c.spectating) return "no free camera";
  const v = c.viewController();
  const dir = new AirportDirector();
  dir.mode = mode;
  S = {
    code: f.icao || f.ident,
    name: f.name,
    lat: f.lat,
    lon: f.lon,
    ways,
    dir,
    current: null,
    done: new Set(),
    queue: [],
    shot: "tower",
    fov0: v.s.fov,
    still: 0,
    obstructed: 0,
    pinned: null,
    others: [],
    filler: null,
    arrived: new Map(),
    t: 0,
  };
  v.s.subjectView = "airport";
  c.s.subjectView = "airport";
  c.setSpectatorFollow(false);
  airportHooks.live();
  return null;
}

/** The view off: the field given back, the free camera left where it is. */
export function airportStop() {
  if (!S || !main) return;
  const v = main.viewController();
  if (S.fov0 !== null) v.fovTarget = S.fov0;
  if (v.s.subjectView === "airport") v.s.subjectView = "around";
  if (main.s.subjectView === "airport") main.s.subjectView = "around";
  S = null;
}

/** The director's mode. */
export function airportMode(m: AirportMode) {
  if (S) S.dir.mode = m;
}

/** The next movement now (the one filmed let go, the one chosen too). */
export function airportNext() {
  if (!S) return;
  if (S.current) S.done.add(S.current);
  S.current = null;
  S.pinned = null;
}

/** An aircraft chosen in the list followed (its id; null: back to the director's choice). */
export function airportFollow(id: string | null) {
  if (!S) return;
  S.pinned = id;
  if (id) {
    S.current = id;
    S.done.delete(id);
  } else S.current = null;
}

/** An aircraft about the airport, as the list shows it (whatever queue it is in). */
export function airportCraft(id: string): TrafficCraft | null {
  if (!S || !main) return null;
  return main.trafficNow().find((c) => c.id === id) ?? null;
}

/** An aircraft's name as shown: its callsign, else its registration (a transponder's « 00000000 » no callsign), else its address. */
export const callsignOf = (c: TrafficCraft) => (c.cs && !/^0+$/.test(c.cs.trim()) ? c.cs.trim() : c.reg || c.id.toUpperCase());

/** about the airport: on its ground within this [m], flying within this [m] and under this height [m] */
const NEAR = { ground: 6000, air: 25_000, high: 3000 } as const;

/**
 * A frame of the view (the free camera's — camera/subjectcam.ts): the arrivals, the one filmed (kept until rolled out,
 * then the soonest of the others), the director's shot placed — its eye, its look, its field. False: the view off.
 */
export function airportStep(view: CameraController, dt: number): boolean {
  if (!S || !main) return false;
  const now = main.trafficClock ? main.trafficClock() : (main.trafficT ?? Date.now() / 1000);
  // (the moment drawn: the traffic's clock less its delay — a made-up landing's touchdown is on the reports' clock)
  const all = main.trafficNow();
  S.t += dt;
  S.queue = movementsOf(all, S.ways, now - Math.max(0, main.s.trafficDelay ?? 0)).filter(
    (x) => !x.dep || !(S!.t - (S!.arrived.get(x.c.id) ?? -1e9) < 600),
  );
  // (those done — rolled out, climbed away — off the lists, but the one filmed)
  S.queue = S.queue.filter((x) => !finished(x) || x.c.id === S!.current);
  // (an arrival past its touchdown — on the ground or still reported airborne —: no departure for it for ten minutes — a go-around's
  // climb, or reports bouncing after a landing made up through their gap, filmed as a « departure » once, 26 Nov 2026)
  for (const x of S.queue) if (!x.dep && (x.c.gnd || x.eta < 0)) S.arrived.set(x.c.id, S.t);
  {
    const inQ = new Set(S.queue.map((x) => x.c.id));
    const o = geodeticToCart(WGS84_A, WGS84_F, S.lat * D, S.lon * D, 0);
    S.others = all
      .filter((c) => !inQ.has(c.id) && c.mesh)
      .filter((c) => {
        const d = Math.hypot(...sub(c.p, o));
        return c.gnd ? d < NEAR.ground : d < NEAR.air && c.over < NEAR.high;
      })
      .sort((a, b) => Math.hypot(...sub(a.p, o)) - Math.hypot(...sub(b.p, o)));
  }
  // (one chosen in the list: followed — in a queue its movement's shots, else behind it and about it —, gone from the traffic:
  // the director's choice again)
  if (S.pinned && !all.some((c) => c.id === S!.pinned)) S.pinned = null;
  if (S.pinned) S.current = S.pinned;
  let A = S.queue.find((x) => x.c.id === S!.current);
  if (S.pinned && !A) {
    const c = all.find((x) => x.id === S!.pinned)!;
    const W0 = [...S.ways].sort((x, y) => Math.hypot(...sub(c.p, x.o)) - Math.hypot(...sub(c.p, y.o)))[0]!;
    A = { c, way: W0, eta: c.gnd ? 999 : -999, a: dot(sub(c.p, W0.o), W0.d), cross: dot(sub(c.p, W0.o), W0.r), free: true };
  }
  if (S.current && !S.pinned && finished(A)) {
    S.done.add(S.current);
    S.current = null;
    A = undefined;
  }
  // (a departure lined up and still for a minute — waiting for its clearance —: given up for a movement due within 20 s, taken
  // again later)
  S.still = A && A.dep && A.c.gnd && Math.hypot(...A.c.v) < 3 ? S.still + dt : 0;
  if (A && S.still > 60) {
    const soon = S.queue.find((x) => x.c.id !== A!.c.id && !S!.done.has(x.c.id) && !finished(x) && x.eta > -2 && x.eta < 20);
    if (soon) {
      S.current = null;
      S.still = 0;
      A = undefined;
    }
  }
  if (!S.current) {
    A = S.queue.find((x) => !S!.done.has(x.c.id) && !finished(x) && x.eta > -2);
    S.current = A?.c.id ?? null;
  }
  // (none due — Cinema —: one of those moving about the airport filmed meanwhile — taxiing, flying near —, the same while it moves)
  const prevFiller = S.filler;
  S.filler = null;
  if (!A && !S.pinned && S.dir.mode === "cinema") {
    const moving = (c: TrafficCraft) => Math.hypot(...c.v) > 3;
    const f = S.others.find((c) => c.id === prevFiller && moving(c)) ?? S.others.find(moving);
    if (f) {
      const W0 = [...S.ways].sort((x, y) => Math.hypot(...sub(f.p, x.o)) - Math.hypot(...sub(f.p, y.o)))[0]!;
      A = { c: f, way: W0, eta: 999, a: dot(sub(f.p, W0.o), W0.d), cross: dot(sub(f.p, W0.o), W0.r), free: true };
      S.filler = f.id;
    }
  }
  // (none landing: the busiest runway — the longest — watched from the tower down its approach)
  const W = A?.way ?? [...S.ways].sort((x, y) => y.len - x.len)[0]!;
  if (A) S.dir.follow(A.c.id);
  const L: Lander | null = A
    ? {
        p: A.c.p as V3,
        v: A.c.v as V3,
        fwd: A.c.fwd as V3,
        up: A.c.up as V3,
        right: A.c.right as V3,
        len: A.c.len,
        gnd: A.c.gnd,
        over: A.c.over,
        eta: A.eta,
        ...(A.dep ? { dep: true } : {}),
        ...(A.free ? { free: true } : {}),
      }
    : null;
  S.obstructed = A && !airportHooks.visible(A.c.id) ? S.obstructed + dt : 0;
  if (S.obstructed > 2) {
    S.dir.avoidObstruction();
    S.obstructed = 0;
  }
  const P = S.dir.step(dt, W, placeOn(W), L);
  const eyeGeo = cartToGeodetic(WGS84_A, WGS84_F, P.eye);
  const floor = groundRelief("earth", bodyFixedOf("earth", eyeGeo.lat / D, eyeGeo.lon / D, 0));
  if (eyeGeo.h < floor + 1.6) P.eye = geodeticToCart(WGS84_A, WGS84_F, eyeGeo.lat, eyeGeo.lon, floor + 1.6) as V3;
  S.shot = P.shot;
  // (into the home frame at the frame's time: the Earth's axes then, its ground's velocity under the eye)
  const t = Number.isFinite(view.frameEnd) ? view.frameEnd : view.nowTime();
  const Ax = bodyAxes(solarBody("earth")!, t);
  const home = (q: readonly number[]): V3 => [0, 1, 2].map((k) => q[0]! * Ax[0][k]! + q[1]! * Ax[1][k]! + q[2]! * Ax[2][k]!) as V3;
  const X = fromBodyFixed("earth", [P.eye[0] / M_METRES, P.eye[1] / M_METRES, P.eye[2] / M_METRES], t) as V3;
  const g = groundVelocity("earth", X, t);
  const vh = home(P.vel);
  const V: V3 = [0, 1, 2].map((k) => g[k]! + vh[k]! / C_MPS) as V3;
  setHomePose(view.s, X, unit(home(sub(P.aim, P.eye))), unit(home(P.up)), V);
  view.s.motion = "geodesic";
  view.fovTarget = P.fov;
  if (P.cut) view.s.fov = P.fov;
  view.sync();
  return true;
}

/** Its caption (the broadcast's lower third): the aircraft, its type and registration; the runway, the seconds to
 *  touchdown (or rolling) — null: none filmed. */
export function airportCaption(): {
  title: string;
  line: string;
  eta: number;
  runway: string;
  shot: AirportShot;
  dep: boolean;
  free: boolean;
} | null {
  if (!S) return null;
  const A = S.queue.find((x) => x.c.id === S!.current);
  if (!A) {
    // (one chosen in no movement: its name, its phase)
    const c = S.pinned ? airportCraft(S.pinned) : S.filler ? airportCraft(S.filler) : null;
    if (!c) return null;
    return {
      title: [callsignOf(c), c.type].filter(Boolean).join(" · "),
      line: c.reg,
      eta: 0,
      runway: "",
      shot: S.shot,
      dep: false,
      free: true,
    };
  }
  const c = A.c;
  return {
    title: [callsignOf(c), c.type].filter(Boolean).join(" · "),
    line: c.reg,
    eta: A.eta,
    runway: A.way.name,
    shot: S.shot,
    dep: !!A.dep,
    free: false,
  };
}
