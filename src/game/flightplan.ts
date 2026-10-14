// A plane's flight plan (docs/PLAN-F35.md, F8): its waypoints over the Earth — a departure, the fixes, an
// arrival —, each with its altitude and speed constraints; the legs between them flown along great circles;
// the lateral guidance (LNAV: the course to the active waypoint, the cross-track error closed by an
// intercept, the turn anticipated so the next leg is joined without overshoot), the vertical (VNAV: the
// climb to the cruise level, the descent's top found from the constraints ahead on a 3° path), the fuel
// planned (each leg's burn at its speed and level) and the bingo — the fuel left that just takes it home
// with its reserve. Pure: the controller (controller/fplan.ts) feeds it the position, the speeds, the fuel.

/** The Earth's mean radius [m] (the legs' great circles: within 0.5 % of the ellipsoid's geodesics). */
export const R_EARTH = 6_371_008.8;
const D = Math.PI / 180;
/** the descent path's angle [rad] (an airliner's 3°) and the bank the turns are anticipated for [rad] */
export const VNAV_PATH = 3 * D;
const TURN_BANK = 25 * D;
const G0 = 9.80665;

export interface Waypoint {
  /** its name (an airfield's ICAO, a fix's 5 letters, a user point's "WP03") */
  name: string;
  /** geodetic latitude, east longitude [°] */
  lat: number;
  lon: number;
  /** its altitude constraint [m above the sea] ("at": flown through at it; none: the cruise level) */
  alt?: number;
  /** its speed constraint [m/s, true airspeed] (none: the cruise speed) */
  spd?: number;
  /** an airfield (the departure, the arrival, a diversion): its runway's level [m] */
  field?: { icao?: string; elev: number; rwy?: number };
}

export interface FlightPlan {
  /** the points in order: the first the departure (or where it was made), the last the arrival */
  wps: Waypoint[];
  /** the cruise level [m] and speed [m/s TAS] */
  cruiseAlt: number;
  cruiseSpd: number;
  /** the reserve to land with [kg] */
  reserveKg: number;
}

export const newPlan = (): FlightPlan => ({ wps: [], cruiseAlt: 9000, cruiseSpd: 240, reserveKg: 900 });

type LL = { lat: number; lon: number };

/** The great-circle distance [m] (haversine). */
export function gcDist(a: LL, b: LL): number {
  const p1 = a.lat * D,
    p2 = b.lat * D;
  const dp = p2 - p1,
    dl = (b.lon - a.lon) * D;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(Math.sqrt(h), 1));
}

/** The initial course from a to b [rad from true north, 0 … 2π]. */
export function gcCourse(a: LL, b: LL): number {
  const p1 = a.lat * D,
    p2 = b.lat * D,
    dl = (b.lon - a.lon) * D;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
}

/** The point at a distance [m] along a course [rad] from a. */
export function gcDest(a: LL, course: number, dist: number): LL {
  const d = dist / R_EARTH,
    p1 = a.lat * D,
    l1 = a.lon * D;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(course));
  const l2 = l1 + Math.atan2(Math.sin(course) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / D, lon: ((((l2 / D + 540) % 360) + 360) % 360) - 180 };
}

/** Points along the great circle a → b (for the maps' lines), every `step` metres at most. */
export function gcLine(a: LL, b: LL, step = 20_000): LL[] {
  const d = gcDist(a, b);
  const n = Math.max(1, Math.ceil(d / step));
  const out: LL[] = [a];
  // (re-aimed from each point: the course changes along a great circle)
  let p = a;
  for (let i = 1; i < n; i++) {
    p = gcDest(p, gcCourse(p, b), gcDist(p, b) / (n - i + 1));
    out.push(p);
  }
  out.push(b);
  return out;
}

/** p off the great circle a → b: its cross-track distance [m, > 0 right of the course] and along-track [m from a]. */
export function crossTrack(a: LL, b: LL, p: LL): { xtk: number; atd: number } {
  const d13 = gcDist(a, p) / R_EARTH;
  const t13 = gcCourse(a, p),
    t12 = gcCourse(a, b);
  const xt = Math.asin(Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(t13 - t12))));
  const at = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.max(Math.cos(xt), 1e-9))));
  return { xtk: xt * R_EARTH, atd: (Math.cos(t13 - t12) < 0 ? -at : at) * R_EARTH };
}

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A leg: from one waypoint to the next, its length [m], its initial course [rad]. */
export interface Leg {
  from: Waypoint;
  to: Waypoint;
  dist: number;
  course: number;
}

export function legs(p: FlightPlan): Leg[] {
  const out: Leg[] = [];
  for (let i = 1; i < p.wps.length; i++) {
    const a = p.wps[i - 1]!,
      b = p.wps[i]!;
    out.push({ from: a, to: b, dist: gcDist(a, b), course: gcCourse(a, b) });
  }
  return out;
}

/** What the lateral guidance gives each frame. */
export interface LnavOut {
  /** the heading to fly [rad from true north] (the course corrected by the intercept and the wind's drift) */
  hdg: number;
  /** the desired track [rad], the cross-track error [m, > 0 right of the course] */
  dtk: number;
  xtk: number;
  /** to the active waypoint: its index, its distance [m], its bearing [rad], the time there [s] (NaN: no speed) */
  active: number;
  dist: number;
  brg: number;
  ete: number;
  /** the plan flown to its end (the arrival passed or reached) */
  done: boolean;
  /** a waypoint sequenced this frame (its index), else −1 */
  passed: number;
}

/** The turn's radius [m] at a ground speed [m/s] banked TURN_BANK. */
export const turnRadius = (gs: number) => (gs * gs) / (G0 * Math.tan(TURN_BANK));

/**
 * The lateral guidance (stateful: the active leg). Each frame: the position, the ground speed [m/s], the
 * track [rad] and the heading [rad] (their difference: the wind's drift, kept in the heading asked). The leg
 * a → b flown: the course at the point abeam on it, the cross-track error closed along an intercept — at
 * most 45°, the asymptotic path ~ a minute and a half's flight long —, the next leg's turn begun at its
 * anticipation distance (the turn's radius by the half course change's tangent).
 */
export class Lnav {
  /** the active waypoint (the leg's "to"): 1 … wps.length − 1; 0: direct to the first */
  active = 1;
  /** a "direct to" asked: the leg from where it was asked */
  private direct: LL | null = null;

  constructor(public plan: FlightPlan) {}

  /** Direct to waypoint i: the leg from here to it. */
  directTo(i: number, here: LL) {
    this.active = Math.max(0, Math.min(i, this.plan.wps.length - 1));
    this.direct = { lat: here.lat, lon: here.lon };
  }

  /** The waypoint nearest ahead from a position: the leg it is on (for an engagement mid-plan) — far off it
   *  (3 km), or its track (rad, when given) turned away from it, the active point flown direct from here. */
  engage(here: LL, track?: number) {
    const L = legs(this.plan);
    let best = 1,
      bd = Infinity;
    L.forEach((g, i) => {
      const { xtk, atd } = crossTrack(g.from, g.to, here);
      const off = Math.abs(xtk) + Math.max(0, -atd) + Math.max(0, atd - g.dist);
      if (off < bd) {
        bd = off;
        best = i + 1;
      }
    });
    this.active = Math.min(best, this.plan.wps.length - 1);
    this.direct = L.length ? null : { lat: here.lat, lon: here.lon };
    const g = L[this.active - 1];
    if (g) {
      const { xtk } = crossTrack(g.from, g.to, here);
      const away = track !== undefined && Math.abs(wrapPi(track - gcCourse(here, g.to))) > Math.PI / 2;
      if (Math.abs(xtk) > 3000 || away) this.direct = { lat: here.lat, lon: here.lon };
    }
  }

  step(here: LL, gs: number, track: number, heading: number): LnavOut | null {
    const W = this.plan.wps;
    if (!W.length) return null;
    if (this.active >= W.length) this.active = W.length - 1;
    let out: LnavOut | null = null;
    let passed = -1;
    // (sequenced at most twice a frame: two close points)
    for (let k = 0; k < 2; k++) {
      const to = W[this.active]!;
      const from: LL = this.direct ?? (this.active > 0 ? W[this.active - 1]! : here);
      const legLen = gcDist(from, to);
      const { xtk, atd } = legLen > 50 ? crossTrack(from, to, here) : { xtk: 0, atd: 0 };
      // (the course at the point abeam: the great circle's, from there to the waypoint)
      const abeam = legLen > 50 ? gcDest(from, gcCourse(from, to), Math.max(0, Math.min(atd, legLen))) : here;
      const dist = gcDist(here, to);
      const dtk = legLen > 50 && dist > 300 ? gcCourse(abeam, to) : gcCourse(here, to);
      const brg = gcCourse(here, to);
      // (the intercept: the cross-track error over a look-ahead of 90 s of flight, 2 km at least)
      const look = Math.max(2000, gs * 90);
      const icpt = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, -Math.atan2(xtk, look)));
      const drift = wrapPi(track - heading);
      const hdg = (dtk + icpt - (gs > 20 ? drift : 0) + 4 * Math.PI) % (2 * Math.PI);
      out = { hdg, dtk, xtk, active: this.active, dist, brg, ete: gs > 1 ? dist / gs : NaN, done: false, passed };
      // (the next leg: its turn anticipated; the last point: passed abeam or reached)
      const next = W[this.active + 1];
      let seq = false;
      if (next) {
        const dc = Math.abs(wrapPi(gcCourse(to, next) - dtk));
        const anticip = Math.min(turnRadius(gs) * Math.tan(Math.min(dc, 2.6) / 2), 15_000);
        seq = dist < Math.max(anticip, 150) || (legLen > 50 && atd > legLen);
      } else if (dist < 300 || (legLen > 50 && atd > legLen)) {
        out.done = true;
      }
      if (!seq) break;
      passed = this.active;
      this.active++;
      // (sequenced far off the leg — kilometres beside it —: the next point flown direct from here, not the
      // next leg's line, joined only after a wide overshoot)
      this.direct = Math.abs(xtk) > 2000 ? { lat: here.lat, lon: here.lon } : null;
      out.passed = passed;
    }
    if (out) out.passed = passed;
    return out;
  }
}

/** The height over an airfield the plan arrives at without a constraint [m] (its circuit's: 1 500 ft). */
export const FIELD_PATTERN = 450;

/** The constraint and cruise altitudes along the plan: the altitude to be at [m] at a waypoint index. */
function wpAlt(p: FlightPlan, i: number): number {
  const w = p.wps[i]!;
  return w.alt ?? (w.field ? w.field.elev + FIELD_PATTERN : p.cruiseAlt);
}

/** What the vertical guidance gives. */
export interface VnavOut {
  /** the altitude to hold now [m], the vertical speed to fly towards it [m/s] */
  alt: number;
  vs: number;
  /** the speed to hold [m/s TAS] */
  spd: number;
  /** before the descent's top: its distance ahead [m] (NaN: none ahead / descending now) */
  tod: number;
  phase: "climb" | "cruise" | "descent";
}

/**
 * The vertical guidance at a point of the plan: the active waypoint i, the distance to it [m], the
 * altitude now [m], the ground speed [m/s]. The ceiling the constraints ahead set — each the altitude at its
 * point plus the 3° path back from it (so a lower one ahead brings the descent's top in time) —, the cruise
 * level and the active point's own; the climb free (to the level, at the engine's best), the descent on the path.
 */
export function vnav(p: FlightPlan, i: number, distTo: number, alt: number, gs: number): VnavOut | null {
  const W = p.wps;
  if (!W.length || i >= W.length) return null;
  const tg = Math.tan(VNAV_PATH);
  // (the highest altitude the constraints ahead allow here, and where the path towards each starts)
  let ceil = p.cruiseAlt;
  let along = distTo;
  let tod = NaN;
  for (let k = i; k < W.length; k++) {
    if (k > i) along += gcDist(W[k - 1]!, W[k]!);
    const a = wpAlt(p, k);
    const lim = a + along * tg;
    if (lim < ceil) ceil = lim;
    // (the descent's top for that constraint, ahead: where its path meets the cruise level)
    const t = along - (p.cruiseAlt - a) / tg;
    if (a < p.cruiseAlt && t > 0 && (isNaN(tod) || t < tod)) tod = t;
  }
  // (the active point's own constraint higher than the level: a climb to it)
  const target = Math.max(Math.min(ceil, Math.max(p.cruiseAlt, wpAlt(p, i))), 0);
  const w = W[i]!;
  const spd = w.spd ?? p.cruiseSpd;
  const descending = target < alt - 30;
  // (descending: on the path — the vertical speed the ground speed's 3°, more if above it)
  const vs = descending
    ? -Math.max(gs * tg, 5) - Math.min((alt - target) * 0.02, 40)
    : target > alt + 30
      ? Math.min((target - alt) * 0.05 + 10, 60)
      : 0;
  return {
    alt: target,
    vs,
    spd,
    tod: descending ? NaN : tod,
    phase: descending ? "descent" : target > alt + 30 ? "climb" : "cruise",
  };
}

/** A burn model: the fuel flow [kg/s] cruising at an altitude [m] and a true airspeed [m/s]. */
export type BurnModel = (alt: number, spd: number) => number;

/** Each leg's fuel and time, and the plan's totals (from the start of the leg `from`). */
export function fuelPlan(p: FlightPlan, burn: BurnModel, from = 0): { legs: { fuel: number; time: number }[]; fuel: number; time: number } {
  const L = legs(p);
  const out: { fuel: number; time: number }[] = [];
  let fuel = 0,
    time = 0;
  for (let i = from; i < L.length; i++) {
    const g = L[i]!;
    const a = (wpAlt(p, i) + wpAlt(p, i + 1)) / 2;
    const lvl = Math.min(p.cruiseAlt, Math.max(a, 0.5 * (p.cruiseAlt + a)));
    const v = g.to.spd ?? p.cruiseSpd;
    const t = g.dist / Math.max(v, 30);
    const f = burn(lvl, v) * t;
    out.push({ fuel: f, time: t });
    fuel += f;
    time += t;
  }
  return { legs: out, fuel, time };
}

/**
 * The bingo: the fuel [kg] that takes the plane from where it is straight to the arrival (or to a field
 * given) at the cruise level and speed, with the reserve — below it, it must turn for home.
 */
export function bingo(p: FlightPlan, here: LL, burn: BurnModel, home?: Waypoint): number {
  const to = home ?? p.wps[p.wps.length - 1];
  if (!to) return p.reserveKg;
  const d = gcDist(here, to);
  return burn(p.cruiseAlt, p.cruiseSpd) * (d / Math.max(p.cruiseSpd, 30)) + p.reserveKg;
}
