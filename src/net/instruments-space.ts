// The instruments' "space" blocks (PLAN-VAISSEAUX K1): what a spacecraft's crew console shows — the craft flown, its
// state about the body of its sphere of influence, the paths predicted and planned, the burns, the bodies, the target,
// the systems (X3), the clocks, the link to the Earth, the Endurance's ring and ports, the Kerr figures on Gargantua's
// side. Optional blocks of the snapshot v1 (net/instruments.ts): an older console ignores them. Lengths [km], speeds
// [km/s] for the states and paths (relative to their body, on the ICRF's axes — the game's home frame), [m] and [m/s]
// for the target and the burns, times [s] from the snapshot's. Bounded on reading (untrusted room events).

export type V3 = [number, number, number];

/** The craft flown: the console's profile (K2) — a jet's or a spacecraft's. */
export interface InstrumentCraft {
  id: string;
  kind: "jet" | "spacecraft";
  name: string;
  /** it lands (its descent's views), it has a ring (the Endurance) */
  lands: boolean;
  ring: boolean;
}
/** The craft's state about its body: position [km], velocity [km/s], the body's GM [km³/s²], radius and sphere [km]. */
export interface InstrumentState {
  body: string;
  r: V3;
  v: V3;
  mu: number;
  radius: number;
  soi: number;
}
/** A path's piece in one sphere of influence: its points [km] about its body, their times [s from now]. */
export interface InstrumentTrajSeg {
  body: string;
  pts: V3[];
  t: number[];
}
export interface InstrumentTraj {
  free: InstrumentTrajSeg[];
  plan: InstrumentTrajSeg[];
  /** where the free path ends: on ("continues"), "impact" (on hit), "wormhole" */
  fate: string;
  hit: string;
}
/** A burn of the plan: in [s], its Δv along prograde, normal, radial [m/s], its part in a mission. */
export interface InstrumentNode {
  in: number;
  dv: V3;
  role: string;
}
/** A body of the system: its place [km] from the wormhole's mouth (the home frame's origin), its velocity [km/s], GM
 *  [km³/s²], radius [km], parent — its orbit about its parent rebuilt by the console (K3: the map's ellipses). */
export interface InstrumentBody {
  id: string;
  r: V3;
  v?: V3;
  mu?: number;
  radius: number;
  parent: string;
}
/** Gargantua's side (K3): the hole's spin; its worlds [M] (their circle's radius about the hole, 0: none); the craft
 *  and its free-fall path [M] on the flat map of Boyer–Lindquist; the path's fate. */
export interface InstrumentHole {
  spin: number;
  bodies: { id: string; r: V3; radius: number; orbit: number }[];
  craft: V3 | null;
  path: V3[];
  fate: string;
}
/** The target: distance [m], closing rate [m/s, + closing], the closest approach [m] and its time [s]. */
export interface InstrumentTarget {
  id: string;
  name: string;
  dist: number;
  rate: number;
  ca: number;
  caIn: number;
}
/** The systems (X3): the battery's share, its size [kWh] and balance [kW], oxygen [h], scrubbers [days], the crew,
 *  the failures under way. */
export interface InstrumentSysx {
  battery: number;
  kwh: number;
  balance: number;
  o2h: number;
  scrub: number;
  crew: number;
  failures: { kind: string; fixing: boolean }[];
}
/** The clocks: the warp, the room's time [s] (the scene's — the far-away clock, the Earth's), the craft's dτ/dt and
 *  its own clock's time [s] (the gap between the two: the time gone by on the Earth for the crew's hour). */
export interface InstrumentTime {
  warp: number;
  room: number;
  dtau: number;
  tau: number;
  /** the mission's elapsed time [s] (since the flight began) */
  met?: number;
}
/** The link to the Earth: the light's time one way [s]; cut (behind the wormhole: no live link). */
export interface InstrumentLink {
  light: number;
  cut: boolean;
}
/** The docking's geometry (K4): the target and its port, the rings' distance, its part along the port's axis and
 *  across it (the craft's right and up) [m], the closing and drift rates [m/s], the axes apart and the turn against
 *  the target [°, °/s], docked; the autopilot's phase. */
export interface InstrumentDock {
  target: string;
  port: string;
  range: number;
  along: number;
  latX: number;
  latY: number;
  closing: number;
  latRate: number;
  angle: number;
  spin: number;
  docked: boolean;
  phase: string;
}
export interface InstrumentSpace {
  craft?: InstrumentCraft | null;
  /** the craft's attitude: its nose and its up on the home frame's axes (the navball's) */
  att?: { nose: V3; up: V3 } | null;
  dock?: InstrumentDock | null;
  /** the landing point: its name, its place [°] on its body, redesignated by the pilot (the LPD) */
  land?: { body: string; name: string; lat: number; lon: number; moved: boolean } | null;
  state?: InstrumentState | null;
  traj?: InstrumentTraj | null;
  nodes?: InstrumentNode[];
  /** the burn flown now: its Δv left [m/s] */
  burn?: { left: number } | null;
  /** the propellant: the Δv it still holds [m/s] (null: not counted), the tank's share */
  budget?: { dv: number | null; prop: number | null } | null;
  bodies?: InstrumentBody[];
  target?: InstrumentTarget | null;
  sysx?: InstrumentSysx | null;
  time?: InstrumentTime | null;
  link?: InstrumentLink | null;
  ring?: { rpm: number; g: number } | null;
  ports?: { name: string; docked: string }[];
  /** Gargantua's side: radius [M], the energy and angular momentum per mass */
  kerr?: { r: number; E: number; L: number } | null;
  hole?: InstrumentHole | null;
}

/** the bounds: segments, points a segment, nodes, bodies, failures, ports */
export const SPACE_BOUNDS = { segs: 6, pts: 96, nodes: 16, bodies: 32, failures: 8, ports: 6 };

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const label = (x: unknown, n = 32) => (typeof x === "string" ? x.slice(0, n) : "");
const v3 = (x: unknown): x is V3 => Array.isArray(x) && x.length === 3 && x.every(finite);
const num = (x: unknown, d = 0) => (finite(x) ? x : d);

function readSeg(x: unknown): InstrumentTrajSeg | null {
  if (!record(x) || !Array.isArray(x.pts) || !Array.isArray(x.t)) return null;
  const pts: V3[] = [];
  const t: number[] = [];
  const n = Math.min(x.pts.length, x.t.length, SPACE_BOUNDS.pts);
  for (let i = 0; i < n; i++) {
    const p = x.pts[i],
      ti = x.t[i];
    if (v3(p) && finite(ti)) {
      pts.push([p[0], p[1], p[2]]);
      t.push(ti);
    }
  }
  return pts.length ? { body: label(x.body), pts, t } : null;
}
const readSegs = (x: unknown) =>
  Array.isArray(x)
    ? x
        .slice(0, SPACE_BOUNDS.segs)
        .map(readSeg)
        .filter((s): s is InstrumentTrajSeg => !!s)
    : [];

/** The space blocks of an untrusted snapshot, bounded; absent ones left out (an older pilot's). */
export function readSpace(x: Record<string, unknown>): InstrumentSpace {
  const out: InstrumentSpace = {};
  const c = x.craft;
  if (record(c))
    out.craft = {
      id: label(c.id, 16),
      kind: c.kind === "jet" ? "jet" : "spacecraft",
      name: label(c.name),
      lands: c.lands === true,
      ring: c.ring === true,
    };
  const s = x.state;
  if (record(s) && v3(s.r) && v3(s.v) && finite(s.mu))
    out.state = { body: label(s.body), r: [...s.r], v: [...s.v], mu: s.mu, radius: num(s.radius), soi: num(s.soi, Infinity) };
  const tr = x.traj;
  if (record(tr)) out.traj = { free: readSegs(tr.free), plan: readSegs(tr.plan), fate: label(tr.fate, 16), hit: label(tr.hit, 16) };
  if (Array.isArray(x.nodes))
    out.nodes = x.nodes
      .slice(0, SPACE_BOUNDS.nodes)
      .filter((n): n is Record<string, unknown> => record(n) && finite(n.in) && v3(n.dv))
      .map((n) => ({ in: n.in as number, dv: [...(n.dv as V3)], role: label(n.role, 16) }));
  if (record(x.burn) && finite(x.burn.left)) out.burn = { left: x.burn.left };
  if (record(x.budget))
    out.budget = {
      dv: finite(x.budget.dv) ? Math.max(0, x.budget.dv) : null,
      prop: finite(x.budget.prop) ? Math.min(Math.max(x.budget.prop, 0), 1) : null,
    };
  if (Array.isArray(x.bodies))
    out.bodies = x.bodies
      .slice(0, SPACE_BOUNDS.bodies)
      .filter((b): b is Record<string, unknown> => record(b) && v3(b.r) && finite(b.radius))
      .map((b) => ({
        id: label(b.id, 16),
        r: [...(b.r as V3)],
        ...(v3(b.v) ? { v: [...b.v] as V3 } : {}),
        ...(finite(b.mu) && b.mu > 0 ? { mu: b.mu } : {}),
        radius: b.radius as number,
        parent: label(b.parent, 16),
      }));
  const a = x.att;
  if (record(a) && v3(a.nose) && v3(a.up)) out.att = { nose: [...a.nose], up: [...a.up] };
  const d = x.dock;
  if (record(d) && finite(d.range))
    out.dock = {
      target: label(d.target),
      port: label(d.port),
      range: d.range,
      along: num(d.along),
      latX: num(d.latX),
      latY: num(d.latY),
      closing: num(d.closing),
      latRate: num(d.latRate),
      angle: num(d.angle),
      spin: num(d.spin),
      docked: d.docked === true,
      phase: label(d.phase),
    };
  const ld = x.land;
  if (record(ld) && finite(ld.lat) && finite(ld.lon) && Math.abs(ld.lat) <= 90)
    out.land = { body: label(ld.body, 16), name: label(ld.name), lat: ld.lat, lon: ld.lon, moved: ld.moved === true };
  const g = x.target;
  if (record(g) && finite(g.dist))
    out.target = {
      id: label(g.id, 16),
      name: label(g.name),
      dist: g.dist,
      rate: num(g.rate),
      ca: num(g.ca, g.dist),
      caIn: num(g.caIn, NaN),
    };
  const y = x.sysx;
  if (record(y) && finite(y.battery))
    out.sysx = {
      battery: Math.min(Math.max(y.battery, 0), 1),
      kwh: num(y.kwh),
      balance: num(y.balance),
      o2h: num(y.o2h),
      scrub: num(y.scrub),
      crew: Math.max(0, Math.min(99, Math.round(num(y.crew)))),
      failures: Array.isArray(y.failures)
        ? y.failures
            .slice(0, SPACE_BOUNDS.failures)
            .filter(record)
            .map((f) => ({ kind: label(f.kind, 16), fixing: f.fixing === true }))
        : [],
    };
  const ti = x.time;
  if (record(ti) && finite(ti.room))
    out.time = {
      warp: num(ti.warp, 1),
      room: ti.room,
      dtau: num(ti.dtau, 1),
      tau: num(ti.tau, ti.room),
      ...(finite(ti.met) ? { met: Math.max(0, ti.met) } : {}),
    };
  const l = x.link;
  if (record(l) && finite(l.light)) out.link = { light: Math.max(0, l.light), cut: l.cut === true };
  const r = x.ring;
  if (record(r) && finite(r.rpm)) out.ring = { rpm: r.rpm, g: num(r.g) };
  if (Array.isArray(x.ports))
    out.ports = x.ports
      .slice(0, SPACE_BOUNDS.ports)
      .filter(record)
      .map((p) => ({ name: label(p.name), docked: label(p.docked) }));
  const k = x.kerr;
  if (record(k) && finite(k.r)) out.kerr = { r: k.r, E: num(k.E), L: num(k.L) };
  const h = x.hole;
  if (record(h) && finite(h.spin))
    out.hole = {
      spin: Math.max(-1, Math.min(1, h.spin)),
      bodies: Array.isArray(h.bodies)
        ? h.bodies
            .slice(0, SPACE_BOUNDS.bodies)
            .filter((b): b is Record<string, unknown> => record(b) && v3(b.r))
            .map((b) => ({ id: label(b.id, 16), r: [...(b.r as V3)], radius: num(b.radius), orbit: num(b.orbit) }))
        : [],
      craft: v3(h.craft) ? [...h.craft] : null,
      path: Array.isArray(h.path)
        ? h.path
            .slice(0, SPACE_BOUNDS.pts)
            .filter(v3)
            .map((q) => [...q] as V3)
        : [],
      fate: label(h.fate, 16),
    };
  return out;
}
