// The CameraController — the real traffic in the sky (docs/PLAN-AVIATION-AAA.md, T2; traffic/feed.ts its reports):
// each aircraft drawn a minute behind the real time (the setting), on the smoothest path near its reports of the
// last minutes (game/flightpath.ts: a smoothing spline through their places and velocities — its turns and climbs
// as they were, its reports' noise left out, its acceleration continuous); ahead of its last report (live, or its
// reports late), carried on from it — its way along its turn (ADS-B's track rate, else between its last two
// reports), its climb —, its speed's bias along its track learnt. A change of what places it (a new report, its
// path refitted) closed over 5 s, never a jump. Flown by the flight's laws: its coordinated turn's bank (eased, at a
// roll rate an airliner's), its nose above its path by the incidence its lift asks (its weight, its turn, the air's
// density, its flaps when slow). Placed on the WGS84 Earth (its geometric altitude over the ellipsoid; on the
// ground, its wheels on the relief).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import type { AirlinerId } from "../ship";
import { airframeOf, MESH, rcsOf } from "../game/airtypes";
import { type FlightKnot, type FlightPath, fitFlight, flightAt, flightLaws } from "../game/flightpath";
import type { FormCraft } from "../game/formation";
import type { RadarObject } from "../game/radar";
import { bodyFixedOf, groundRelief } from "../system/our-surface";
import { geodeticToCart, WGS84_A, WGS84_F } from "../system/ellipsoid";
import { earthView } from "./netcraft";
import { formationLabel, formSlotFor } from "./formation";
import { t, tf } from "../i18n";
import type { Plane } from "../traffic/feed";
import type { Vec3 } from "../math/vec3";
import type { CameraController } from "../controls";

declare module "../controls" {
  interface CameraController {
    trafficStep: typeof trafficStep;
    trafficNow: typeof trafficNow;
    trafficShips: typeof trafficShips;
    trafficOverlay: typeof trafficOverlay;
    trafficLead: typeof trafficLead;
    trafficForm: typeof trafficForm;
  }
}

const D = Math.PI / 180;
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
  alt: number;
  gnd: boolean;
  /** its bank [rad] (right wing down +), its report's age [s] */
  bank: number;
  age: number;
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

/** A report carried on `dt` [s] (back, before it, when < 0): its place (east, north [m] from its report's, its
 *  altitude [m]) and its track [rad]. */
function carry(p: Plane, rate: number, dt: number) {
  const psi = p.trk * D;
  const t = Math.min(Math.max(dt, -GAP_MAX), AHEAD_MAX);
  let e: number, n: number;
  if (Math.abs(rate) > 1e-5) {
    const R = p.gs / rate;
    e = R * (Math.cos(psi) - Math.cos(psi + rate * t));
    n = R * (Math.sin(psi + rate * t) - Math.sin(psi));
  } else {
    e = p.gs * Math.sin(psi) * t;
    n = p.gs * Math.cos(psi) * t;
  }
  return { e, n, alt: p.gnd ? 0 : p.alt + p.vs * t, trk: psi + rate * t };
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
const ROLL_RATE = 7 * D;
const BANK_LAG = 1;
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
 * `placeOf` undoes; the frame's scale by each report given) — refitted when its reports change. `rest`: its
 * altitude on the ground.
 */
const paths = new Map<string, { key: string; S: FlightPath; t: number[]; lat: number; lon: number; gnd: boolean[] }>();
function pathOf(hist: readonly Plane[], rest: (q: Plane) => number) {
  const n = hist.length;
  if (n < 2) return null;
  const last = hist[n - 1]!;
  let j = n - 1;
  while (j > 0 && n - j < KNOTS_MAX && hist[j]!.t - hist[j - 1]!.t <= GAP_MAX && last.t - hist[j - 1]!.t <= WINDOW) j--;
  if (n - j < 2) return null;
  const pts = hist.slice(j);
  const key = `${pts.length}:${pts[0]!.t}:${last.t}`;
  const P0 = paths.get(last.id);
  if (P0?.key === key) return P0;
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
 * The smoothing's state by aircraft: what places it (its report carried on, or its path), the gap left to close
 * (fixed to the Earth [m]) and since when, its speed's bias along its track learnt from its reports' jumps [m/s],
 * where it was drawn last, its velocity and bank then (a new placing joined to it without a jump).
 */
const easing = new Map<
  string,
  { key: string; off: number[]; at: number; vb: number; last: number[] | null; v: number[]; drawn: number; bank: number }
>();
/** the gap's closing time [s]; the speed bias's gain and its bound [m/s] */
const CLOSE = 5;
const VB_GAIN = 0.3;
const VB_MAX = 15;

/**
 * The traffic now (the setting's delay behind the real time): each aircraft's place, velocity, axes — on its path
 * at that moment, else carried on from its last report —, flown by the flight's laws; a change of what places it
 * eased out. Cached a frame.
 */
let cache: { at: number; list: TrafficCraft[]; of: unknown } = { at: -1, list: [], of: null };
function trafficNow(this: CameraController): TrafficCraft[] {
  const F = this.traffic;
  if (!F || !F.planes.size) return [];
  // (the real traffic's time: the wall clock's — a test's own)
  const now = this.trafficClock ? this.trafficClock() : (this.trafficT ?? Date.now() / 1000);
  // (the same moment: the same list — the radar, the renderer and the overlay all read it)
  if (cache.at === now && cache.of === F) return cache.list;
  const td = now - Math.max(0, this.s.trafficDelay ?? 0);
  const out: TrafficCraft[] = [];
  for (const T of F.planes.values()) {
    const p = T.p;
    const af = airframeOf(p.type, p.cat);
    // (on the ground: its wheels on the relief there)
    const wheels = af.mesh ? (MESH[af.mesh].wheels * af.len) / MESH[af.mesh].len : 1.5;
    const restAt = (lat: number, lon: number) => groundRelief("earth", bodyFixedOf("earth", lat, lon, 0)) + wheels;
    const E0 = easing.get(p.id);
    const path = td < now ? pathOf(T.hist, (q) => restAt(q.lat, q.lon)) : null;
    const f = path ? flightAt(path.S, td) : null;
    let P: number[], L: ReturnType<typeof enuAt>, alt: number, key: string, gnd: boolean;
    let ve: number, vn: number, vu: number, ae: number, an: number, au: number, omega: number;
    if (path && f) {
      // (on its path: the spline's place, velocity and acceleration — from its lat/lon scale to metres there)
      let i = 0;
      while (i < path.t.length - 2 && path.t[i + 1]! < td) i++;
      gnd = path.gnd[i]! && path.gnd[i + 1]!;
      const la = path.lat + f.x[1]! / (D * R_EQ),
        lo = path.lon + f.x[0]! / (D * R_EQ * Math.cos(path.lat * D));
      alt = gnd ? restAt(la, lo) : f.x[2]!;
      P = placeOf(path.lat, path.lon, f.x[0]!, f.x[1]!, alt);
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
      const q = back ? first : p;
      const rate = back ? rateOf(q, null) : rateOf(p, T.prev);
      const pc = E0 && !q.gnd && !back ? { ...q, gs: q.gs + E0.vb } : q;
      const c = carry(pc, rate, td - q.t);
      gnd = q.gnd;
      alt = q.gnd ? restAt(q.lat, q.lon) : c.alt;
      P = placeOf(q.lat, q.lon, c.e, c.n, alt);
      L = enuAt(q.lat, q.lon);
      [ve, vn, vu] = [pc.gs * Math.sin(c.trk), pc.gs * Math.cos(c.trk), q.gnd ? 0 : q.vs];
      [ae, an, au] = [rate * vn, -rate * ve, 0];
      omega = rate;
      key = `${back ? "b" : "c"}${q.t}`;
    }
    const v = [0, 1, 2].map((i) => L.E[i]! * ve + L.N[i]! * vn + L.U[i]! * vu);
    // (a new placing: where it was drawn, carried on to now, and where this one puts it — the gap closed over 5 s; a
    // report carried on after another, its along-track part teaching the speed's bias)
    if (!E0 || E0.key !== key) {
      let off = [0, 0, 0];
      let vb = E0?.vb ?? 0;
      if (E0?.last) {
        const dt = now - E0.drawn;
        const was = E0.last.map((x, i) => x + E0.v[i]! * dt);
        off = was.map((x, i) => x - P[i]!);
        if (Math.hypot(...off) > 2000) off = [0, 0, 0];
        else if (!f && E0.key.startsWith("c") && T.prev && !p.gnd) {
          const gs = Math.hypot(ve, vn) || 1;
          const along = -(off[0]! * v[0]! + off[1]! * v[1]! + off[2]! * v[2]!) / gs;
          vb = Math.max(-VB_MAX, Math.min(VB_MAX, vb + (VB_GAIN * along) / Math.max(p.t - T.prev.t, 2)));
        }
      }
      easing.set(p.id, { key, off, at: now, vb, last: null, v: [0, 0, 0], drawn: now, bank: E0?.bank ?? 0 });
    }
    const Ez = easing.get(p.id)!;
    const k = Math.exp(-Math.max(0, now - Ez.at) / CLOSE);
    P = P.map((x, i) => x + Ez.off[i]! * k);
    // (the flight's laws: its coordinated turn's bank — eased, at an airliner's roll rate —, its incidence)
    const laws = flightLaws([ve, vn, vu], [ae, an, au], alt, af.len > 30 ? 5500 : af.len > 18 ? 4000 : 1000, omega);
    const bankTo = gnd ? 0 : Math.max(-BANK_MAX, Math.min(BANK_MAX, laws.bank));
    const dt = Math.max(0, now - Ez.drawn);
    const step = (bankTo - Ez.bank) * (1 - Math.exp(-dt / BANK_LAG));
    const bank = Ez.bank + Math.max(-ROLL_RATE * dt, Math.min(ROLL_RATE * dt, step));
    const alpha = gnd || !af.mesh ? 0 : laws.alpha;
    Ez.last = P;
    Ez.v = v;
    Ez.drawn = now;
    Ez.bank = bank;
    const gs = Math.hypot(ve, vn);
    // (standing: its reported heading)
    const psi = (p.hdg ?? p.trk) * D;
    const hdir =
      gs > 0.1
        ? [0, 1, 2].map((i) => (L.E[i]! * ve + L.N[i]! * vn) / gs)
        : [0, 1, 2].map((i) => L.E[i]! * Math.sin(psi) + L.N[i]! * Math.cos(psi));
    const gamma = gs > 1 ? laws.gamma : 0;
    const fwd0 = unit([0, 1, 2].map((i) => hdir[i]! * Math.cos(gamma) + L.U[i]! * Math.sin(gamma)));
    const r0 = unit(cross(fwd0, L.U));
    const u0 = cross(r0, fwd0);
    const right = [0, 1, 2].map((i) => r0[i]! * Math.cos(bank) - u0[i]! * Math.sin(bank));
    const up1 = [0, 1, 2].map((i) => u0[i]! * Math.cos(bank) + r0[i]! * Math.sin(bank));
    // (its nose above its path by its incidence, about its wings' axis)
    const fwd = [0, 1, 2].map((i) => fwd0[i]! * Math.cos(alpha) + up1[i]! * Math.sin(alpha));
    const up = [0, 1, 2].map((i) => up1[i]! * Math.cos(alpha) - fwd0[i]! * Math.sin(alpha));
    out.push({
      id: p.id,
      cs: p.cs,
      reg: p.reg,
      type: p.type,
      mesh: af.mesh,
      len: af.len,
      span: af.span,
      p: P,
      v,
      fwd,
      up,
      right,
      alt,
      gnd,
      bank,
      age: now - p.t,
    });
  }
  if (easing.size > 4 * F.planes.size + 50)
    for (const k of easing.keys())
      if (!F.planes.has(k)) {
        easing.delete(k);
        paths.delete(k);
      }
  cache = { at: now, list: out, of: F };
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

/** A frame of the traffic: the aircraft followed (a formation's lead, the radar's lock) asked fresh; its radar
 *  source (the aircraft about us, neutral, answering). */
function trafficStep(this: CameraController, dt = 0) {
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
    this.traffic.focus = this.form?.trafficId ?? lock;
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

/** The traffic for the renderer: the nearest dozen with a mesh within 25 km — their place and axes on the camera's,
 *  the axes scaled to their type's length; hidden behind what the image holds nearer. */
function trafficShips(this: CameraController): { id: AirlinerId; rel: Vec3; axes: [Vec3, Vec3, Vec3]; hidden: boolean; far: boolean }[] {
  const list = this.trafficNow();
  if (!list.length) return [];
  const E = earthView(this);
  if (!E) return [];
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  const n = (v: Vec3, k: number): Vec3 => {
    const l = Math.hypot(...v) || 1;
    return [(v[0] / l) * k, (v[1] / l) * k, (v[2] / l) * k];
  };
  return list
    .filter((c) => c.mesh)
    .map((c) => ({ t: c, rel: cam([0, 1, 2].map((k) => c.p[k]! - E.p0[k]!)) }))
    .map((x) => ({ ...x, d: Math.hypot(...x.rel) }))
    .filter((x) => x.d < 25_000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 12)
    .map(({ t: c, rel }) => {
      const s = c.len / (c.mesh === "a320" ? 37.7 : 36.2);
      return {
        id: c.mesh!,
        rel,
        axes: [n(cam(c.right.map((x) => -x)), s), n(cam(c.up), s), n(cam(c.fwd), s)] as [Vec3, Vec3, Vec3],
        hidden: false,
        far: true,
      };
    });
}

/** A label and its lights for the overlay: on the camera's axes [m] (x right, y up, z ahead). */
export interface TrafficMark {
  id: string;
  at: Vec3;
  dist: number;
  label: string;
  /** its lights: where (the camera's axes [m]), their colour, lit now */
  lights: { at: Vec3; colour: string; on: boolean; size: number }[];
}

/**
 * The traffic's labels and lights within 80 km (the nearest 24): its callsign, registration, type, altitude in the
 * units chosen; the red and green navigation lights at its wingtips and the white at its tail, the red beacon
 * (a flash a second), the white strobes (two flashes each 1.2 s), its landing lights under 3 000 m.
 */
function trafficOverlay(this: CameraController, fmtAlt: (m: number) => string): TrafficMark[] {
  const list = this.trafficNow();
  if (!list.length) return [];
  const E = earthView(this);
  if (!E) return [];
  const cam = (b: readonly number[]) => E.toCam(E.toHome(b as Vec3));
  const tNow = performance.now() / 1000;
  const out: TrafficMark[] = [];
  for (const c of list) {
    const rel = cam([0, 1, 2].map((k) => c.p[k]! - E.p0[k]!));
    const dist = Math.hypot(...rel);
    if (dist > 80_000) continue;
    const at = (x: number, y: number, z: number): Vec3 =>
      cam([0, 1, 2].map((k) => c.p[k]! - E.p0[k]! + c.right[k]! * x + c.up[k]! * y + c.fwd[k]! * z));
    const ph = (Number.parseInt(c.id.slice(-3), 16) % 1000) / 1000;
    const beacon = (tNow + ph) % 1 < 0.12;
    const st = (tNow + ph * 1.2) % 1.2;
    const strobe = st < 0.05 || (st > 0.15 && st < 0.2);
    // (its lights where its mesh has them, to its size; a helicopter's about its middle)
    const M = c.mesh ? MESH[c.mesh] : null;
    const k = M ? c.len / M.len : 1;
    const tip = M ? M.tip.map((x) => x * k) : [c.span / 2, 0, 0];
    const tail = M ? M.tail.map((x) => x * k) : [0, 0, -c.len / 2];
    const bcn = M ? M.beacon.map((x) => x * k) : [0, 1.5, 0];
    const land = M ? M.landing.map((x) => x * k) : [0, -1, c.len / 2];
    // (the mesh's x is its left: the left wingtip's light red, the right's green)
    const lights = [
      { at: at(-tip[0]!, tip[1]!, tip[2]!), colour: "rgba(255, 60, 50, 1)", on: true, size: 1 },
      { at: at(tip[0]!, tip[1]!, tip[2]!), colour: "rgba(60, 255, 120, 1)", on: true, size: 1 },
      { at: at(tail[0]!, tail[1]!, tail[2]!), colour: "rgba(255, 255, 255, 1)", on: true, size: 0.8 },
      { at: at(bcn[0]!, bcn[1]!, bcn[2]!), colour: "rgba(255, 40, 30, 1)", on: beacon, size: 1.3 },
      { at: at(-tip[0]!, tip[1]!, tip[2]!), colour: "rgba(255, 255, 255, 1)", on: strobe, size: 1.6 },
      { at: at(tip[0]!, tip[1]!, tip[2]!), colour: "rgba(255, 255, 255, 1)", on: strobe, size: 1.6 },
      ...(!c.gnd && c.alt < 3000 ? [{ at: at(land[0]!, land[1]!, land[2]!), colour: "rgba(255, 250, 230, 1)", on: true, size: 2.2 }] : []),
    ];
    const label = [c.cs, c.reg, c.type, c.gnd ? "GND" : fmtAlt(c.alt)].filter(Boolean).join(" · ");
    out.push({ id: c.id, at: rel, dist, label, lights });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, 24);
}

export function installTraffic(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { trafficStep, trafficNow, trafficShips, trafficOverlay, trafficLead, trafficForm });
}
