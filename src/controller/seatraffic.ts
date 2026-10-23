// The CameraController — the real ships on the sea (docs/PLAN-AVIATION-AAA.md, T3; traffic/feed.ts their AIS
// reports): each drawn as the aircraft are (controller/traffic.ts), the setting's delay behind the real time, on its
// way rebuilt from its reports (game/flightpath.ts: its speed and course over the ground smoothed, integrated); its
// bow on its true heading (between its reports'), else on its course; moored or at anchor, where it lies. Its mesh
// and size by its AIS type and dimensions (game/shiptypes.ts), rolling, pitching and heaving in the sea; its
// navigation lights at night (masthead, sidelights, stern), its label (name · kind · speed), on the radar as a
// surface contact (neutral), and its wake (the sea's shader: renderer.seaWakes).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import type { ShipTypeId } from "../ship";
import { type FlightKnot, type FlightPath, fitFlight, flightAt } from "../game/flightpath";
import type { RadarObject } from "../game/radar";
import { SHIP_MESH, shipLights, shipMotion, shipRcs, shipSize } from "../game/shiptypes";
import { azAltAt } from "../eclipse/earth-moon";
import { J2000_MS } from "../system/timescale";
import { daysOf } from "../system/solar";
import { earthView } from "./netcraft";
import { enuAt, placeOf, R_EQ, radii, wrap } from "./traffic";
import type { TrafficMark } from "./traffic";
import type { Ship } from "../traffic/feed";
import type { Vec3 } from "../math/vec3";
import type { CameraController } from "../controls";
import { fleet } from "../fleet";
import { geoidDeg } from "../system/geoid-grid";

declare module "../controls" {
  interface CameraController {
    seaNow: typeof seaNow;
    seaShips: typeof seaShips;
    seaOverlay: typeof seaOverlay;
    seaWakes: typeof seaWakes;
    seaStep: typeof seaStep;
    /** the sea's significant wave height about us [m] (M1: the marine forecast's; else the wind's) */
    seaHs?: number;
  }
}

const D = Math.PI / 180;

/** A ship now: who it is, its mesh and size, its place, velocity and axes (fixed to the Earth). */
export interface SeaCraft {
  id: string;
  mmsi: number;
  name: string;
  kind: string;
  dest: string;
  mesh: ShipTypeId;
  len: number;
  beam: number;
  p: number[];
  v: number[];
  fwd: number[];
  up: number[];
  right: number[];
  /** its speed over the ground [m/s]; its report's age [s] */
  sog: number;
  age: number;
}

/** two reports this far apart at most [s] on one way; its reports of the last this many [s]; slower than this
 *  [m/s]: lying still */
const GAP_MAX = 400;
const WINDOW = 900;
const STILL = 0.25;

/** Each ship's way through its reports about `td` (refitted when they change: a report in or out), in the lat/lon
 *  of one scaled to metres. */
const ways = new Map<number, { key: string; F: FlightPath; lat: number; lon: number }>();
function wayOf(hist: readonly Ship[], td: number) {
  const n = hist.length;
  if (n < 2) return null;
  // (its reports from a few minutes before the moment drawn to a few after, none further apart than GAP_MAX)
  let a = 0;
  while (a < n - 1 && hist[a]!.t < td - 0.6 * WINDOW) a++;
  let b = a;
  while (b < n - 1 && b - a < 59 && hist[b + 1]!.t <= td + 0.4 * WINDOW && hist[b + 1]!.t - hist[b]!.t <= GAP_MAX) b++;
  if (b - a < 1) return null;
  const pts = hist.slice(a, b + 1);
  const last = pts.at(-1)!;
  const key = `${pts.length}:${pts[0]!.t}:${last.t}`;
  const W0 = ways.get(last.mmsi);
  if (W0?.key === key) return W0;
  const o = pts[pts.length >> 1]!;
  const c0 = R_EQ * Math.cos(o.lat * D);
  const knots: FlightKnot[] = pts.map((q) => {
    const r = radii(q.lat);
    return {
      t: q.t,
      x: [wrap((q.lon - o.lon) * D) * c0, (q.lat - o.lat) * D * R_EQ, 0],
      gs: q.sog,
      trk: q.cog * D,
      vs: 0,
      ke: c0 / (r.N * Math.cos(q.lat * D)),
      kn: R_EQ / r.M,
    };
  });
  // (a ship's way changes slowly: its course and speed smoothed more than an aircraft's, its places' noise more)
  const W = { key, F: fitFlight(knots, { sPsi: 0.02, lPsi: 3e5, sV: 0.3, lV: 2e3, sX: 20 }), lat: o.lat, lon: o.lon };
  ways.set(last.mmsi, W);
  return W;
}

/** Its heading at `t` [rad]: between its two reports' true headings (the shorter way), else its course. */
function headingAt(hist: readonly Ship[], t: number, course: number): number {
  let i = hist.length - 1;
  while (i > 0 && hist[i]!.t > t) i--;
  const a = hist[i]!,
    b = hist[Math.min(i + 1, hist.length - 1)]!;
  if (a.hdg === null || b.hdg === null) {
    // (its heading unknown: its course — or, the drift its last report showed, kept)
    const q = a.hdg !== null ? a : b.hdg !== null ? b : null;
    return q ? course + wrap((q.hdg! - q.cog) * D) * (q.sog > 1 ? 1 : 0) : course;
  }
  const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  return a.hdg * D + wrap((b.hdg - a.hdg) * D) * f;
}

let cache: { at: number; list: SeaCraft[]; of: unknown } = { at: -1, list: [], of: null };
/** The ships now (the setting's delay behind the real time): each one's place, velocity, axes. Cached a frame. */
function seaNow(this: CameraController): SeaCraft[] {
  const F = this.traffic;
  if (!F || !F.ships.size) return [];
  const now = this.trafficClock ? this.trafficClock() : (this.trafficT ?? Date.now() / 1000);
  if (cache.at === now && cache.of === F) return cache.list;
  const td = now - Math.max(0, this.s.trafficDelay ?? 0);
  const hs = this.seaHs ?? 1;
  const out: SeaCraft[] = [];
  for (const T of F.ships.values()) {
    const s = T.s;
    if (!Number.isFinite(s.lat) || !T.hist.length) continue;
    // (sunk in a fight — controller/fightproxy.ts)
    if (this.seaTaken?.has(String(s.mmsi))) continue;
    const Z = shipSize(s.type, s.len, s.beam);
    const recent = T.hist.slice(-4);
    const still = recent.every((q) => q.sog < STILL);
    let lat: number, lon: number, e: number, n: number, ve: number, vn: number, course: number;
    const W = still ? null : wayOf(T.hist, td);
    const f = W ? flightAt(W.F, td) : null;
    if (W && f) {
      lat = W.lat;
      lon = W.lon;
      e = f.x[0]!;
      n = f.x[1]!;
      const la = lat + n / (D * R_EQ);
      const r = radii(la);
      ve = (f.v[0]! * r.N * Math.cos(la * D)) / (R_EQ * Math.cos(lat * D));
      vn = (f.v[1]! * r.M) / R_EQ;
      course = f.trk;
    } else {
      // (lying still: where its last reports put it; else carried on — or back — from the report nearest)
      const q = still ? recent.at(-1)! : T.hist.reduce((x, y) => (Math.abs(y.t - td) < Math.abs(x.t - td) ? y : x));
      const dt = still ? 0 : Math.max(-GAP_MAX, Math.min(120, td - q.t));
      lat = q.lat;
      lon = q.lon;
      course = q.cog * D;
      const sog = still ? 0 : q.sog;
      ve = sog * Math.sin(course);
      vn = sog * Math.cos(course);
      e = ve * dt;
      n = vn * dt;
    }
    const sog = Math.hypot(ve, vn);
    const head = still ? (s.hdg ?? s.cog) * D : headingAt(T.hist, td, sog > 0.5 ? Math.atan2(ve, vn) : course);
    const m = shipMotion(Z.len, Z.beam, hs, td, s.mmsi);
    // (afloat: the sea's surface at the geoid)
    const P = placeOf(lat, lon, e, n, m.heave + geoidDeg(lat, lon));
    const la = lat + n / (D * R_EQ),
      lo = lon + e / (D * R_EQ * Math.cos(lat * D));
    const L = enuAt(la, lo);
    const h = [0, 1, 2].map((i) => L.E[i]! * Math.sin(head) + L.N[i]! * Math.cos(head));
    const r0 = [0, 1, 2].map((i) => L.E[i]! * Math.cos(head) - L.N[i]! * Math.sin(head));
    // (its pitch — its bow up + — about its beam, then its roll — to starboard + — about its length)
    const cp = Math.cos(m.pitch),
      sp = Math.sin(m.pitch);
    const fwd1 = [0, 1, 2].map((i) => h[i]! * cp + L.U[i]! * sp);
    const up1 = [0, 1, 2].map((i) => L.U[i]! * cp - h[i]! * sp);
    const cr = Math.cos(m.roll),
      sr = Math.sin(m.roll);
    const right = [0, 1, 2].map((i) => r0[i]! * cr - up1[i]! * sr);
    const up = [0, 1, 2].map((i) => up1[i]! * cr + r0[i]! * sr);
    out.push({
      id: String(s.mmsi),
      mmsi: s.mmsi,
      name: s.name,
      kind: Z.kind,
      dest: s.dest,
      mesh: Z.mesh,
      len: Z.len,
      beam: Z.beam,
      p: P,
      v: [0, 1, 2].map((i) => L.E[i]! * ve + L.N[i]! * vn),
      fwd: fwd1,
      up,
      right,
      sog,
      age: now - s.t,
    });
  }
  if (ways.size > 2 * F.ships.size + 50) for (const k of ways.keys()) if (!F.ships.has(k)) ways.delete(k);
  cache = { at: now, list: out, of: F };
  return out;
}

/** A frame of the sea's traffic: its radar source (surface contacts, neutral, their AIS answering). */
function seaStep(this: CameraController) {
  if (!this.traffic?.ships.size) {
    this.radarSources.delete("ais");
    return;
  }
  if (this.radarSources.has("ais")) return;
  const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  this.radarSources.set("ais", (fix) =>
    this.seaNow().map(
      (c): RadarObject => ({
        id: `ais:${c.id}`,
        r: fix.toLocal(c.p as [number, number, number]),
        v: [dot(c.v, fix.E), dot(c.v, fix.N), dot(c.v, fix.U)],
        rcs: shipRcs(c.len),
        kind: "sea",
        iff: "neutral",
        name: c.name || c.id,
        squawk: true,
      }),
    ),
  );
}

/** The ships for the renderer: the nearest eight within 20 km — their place and axes on the camera's, the axes
 *  scaled to their length and beam; hidden under the sea's surface and behind what the image holds nearer. */
function seaShips(
  this: CameraController,
): { id: ShipTypeId; rel: Vec3; axes: [Vec3, Vec3, Vec3]; hidden: boolean; far: boolean; mirror: boolean }[] {
  const list = this.seaNow();
  if (!list.length) return [];
  const E = earthView(this);
  if (!E) return [];
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  const n = (v: Vec3, k: number): Vec3 => {
    const l = Math.hypot(...v) || 1;
    return [(v[0] / l) * k, (v[1] / l) * k, (v[2] / l) * k];
  };
  return list
    .map((c) => ({ c, rel: cam([0, 1, 2].map((k) => c.p[k]! - E.p0[k]!)) }))
    .map((x) => ({ ...x, d: Math.hypot(...x.rel) }))
    .filter((x) => x.d < 20_000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
    .map(({ c, rel }) => {
      const M = SHIP_MESH[c.mesh];
      const kz = c.len / M.len,
        kx = c.beam / M.beam;
      return {
        id: c.mesh,
        rel,
        axes: [n(cam(c.right.map((x) => -x)), kx), n(cam(c.up), Math.sqrt(kx * kz)), n(cam(c.fwd), kz)] as [Vec3, Vec3, Vec3],
        hidden: false,
        far: true,
        mirror: true,
      };
    });
}

/** The ships' wakes for the sea's shader (renderer.seaWakes): the nearest eight under way within 15 km — their
 *  place fixed to the Earth [m], their heading, speed [m/s], length and beam [m]. */
function seaWakes(this: CameraController): { p: Vec3; fwd: Vec3; U: number; len: number; beam: number }[] {
  const list = this.seaNow();
  if (!list.length) return [];
  const E = earthView(this);
  if (!E) return [];
  return list
    .filter((c) => c.sog > 0.8)
    .map((c) => ({ c, d: Math.hypot(...[0, 1, 2].map((k) => c.p[k]! - E.p0[k]!)) }))
    .filter((x) => x.d < 15_000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
    .map(({ c }) => {
      // (its heading on the sea: its bow's way, level)
      const up = unit(c.p);
      const f = c.fwd.map((x, i) => x - up[i]! * (c.fwd[0]! * up[0]! + c.fwd[1]! * up[1]! + c.fwd[2]! * up[2]!));
      return { p: c.p as Vec3, fwd: unit(f) as Vec3, U: c.sog, len: c.len, beam: c.beam };
    });
}
/**
 * The flown craft's own mark on the sea (renderer.seaWakes' first; trace.wgsl seaWake: its downwash, its trail, its spray):
 * its place fixed to the Earth [m] (the eye's — the shader takes the craft's own where it is drawn), its course and speed over the ground (geoNow's track and ground speed), its span as the
 * beam, and — a negative length, the marker of a craft — how much of its weight its jets hold up straight down (−1 − share:
 * an F-35B converted to STOVL, its lift fan and nozzle turned down on the water — controller/stovl.ts: the conversion times
 * the nozzle's swivel —; any other craft none, slow or parked: its engines push aft). None when it is not low over the Earth.
 */
export function ourWake(c: CameraController): { p: Vec3; fwd: Vec3; U: number; len: number; beam: number }[] {
  const g = c.geoNow();
  if (!g || g.alt > 150) return [];
  const E = earthView(c);
  if (!E) return [];
  const p = E.p0 as number[];
  const up = unit(p);
  const east = unit([-up[1]!, up[0]!, 0]);
  const north = [up[1]! * east[2]! - up[2]! * east[1]!, up[2]! * east[0]! - up[0]! * east[2]!, up[0]! * east[1]! - up[1]! * east[0]!];
  const fwd = [0, 1, 2].map((k) => east[k]! * Math.sin(g.track) + north[k]! * Math.cos(g.track)) as Vec3;
  const S = fleet.active === "f35" ? c.stovl : null;
  const hover = S?.on ? Math.min(Math.max(S.conv * Math.max(S.swivel, S.clutch), 0), 1) : 0;
  // (its span: the downwash's and the trail's width — the A320's 35.8 m, the F-35's 10.7)
  return [{ p: [...p] as Vec3, fwd, U: g.gs, len: -1 - hover, beam: fleet.active === "a320" ? 35.8 : 10.7 }];
}
const unit = (a: readonly number[]) => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};

/**
 * The ships' labels within 30 km (the nearest 16: name · kind · speed in the units chosen) and, the Sun down, their
 * navigation lights.
 */
function seaOverlay(this: CameraController, fmtSpd: (ms: number) => string): TrafficMark[] {
  const list = this.seaNow();
  if (!list.length) return [];
  const E = earthView(this);
  if (!E) return [];
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  // (night: the Sun under the horizon where we are)
  const g = this.geoNow();
  const ms = J2000_MS + daysOf(this.nowTime()) * 86400e3;
  const night = g ? azAltAt("sun", g.lat * D, g.lon * D, 0, ms).alt < -1 : false;
  const colours = { white: "rgba(255, 250, 235, 1)", red: "rgba(255, 50, 40, 1)", green: "rgba(60, 255, 120, 1)" };
  const out: TrafficMark[] = [];
  for (const c of list) {
    const rel = cam([0, 1, 2].map((k) => c.p[k]! - E.p0[k]!));
    const dist = Math.hypot(...rel);
    if (dist > 30_000) continue;
    const at = (x: number, y: number, z: number): Vec3 =>
      cam([0, 1, 2].map((k) => c.p[k]! - E.p0[k]! - c.right[k]! * x + c.up[k]! * y + c.fwd[k]! * z));
    const lights = night
      ? shipLights(c.mesh, c.len, c.beam).map((l) => ({
          at: at(l.at[0], l.at[1], l.at[2]),
          colour: colours[l.colour],
          on: true,
          size: l.size,
        }))
      : [];
    const label = [c.name || `MMSI ${c.mmsi}`, c.kind, c.sog > 0.3 ? fmtSpd(c.sog) : null].filter(Boolean).join(" · ");
    out.push({ id: `ais:${c.id}`, at: rel, dist, label, lights });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, 16);
}

export function installSeaTraffic(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { seaNow, seaShips, seaOverlay, seaWakes, seaStep });
}
