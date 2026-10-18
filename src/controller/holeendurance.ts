// The CameraController — the fleet on Gargantua's side (docs/PLAN-VAISSEAUX-AAA.md, X2c–X2e). The Endurance the scene
// draws at a cinematic scale (endurance.ts) is a mothership there: at its true size near it (64 m: the renderer draws
// the fleet's mesh within 60 km, the cinematic one beyond), its hub's ports docked to as our side's craft are — the
// capture a link of the fleet's (fleet.ts): the flown craft flies the assembly —, flown itself ([ ] between docked or
// near craft), left to coast. Its first orbit is the scene's (endurance.ts endurancePose, exact) — in the hole's
// equatorial plane, where that circle is a Kerr geodesic (Ω = 1/(r^3/2 + a)); a tilted one is not, and stays drawn.
// A craft left on this side coasts on its own geodesic, stepped by the flown craft's own integrator (geodesic.ts
// advance) each frame — a tidal pull of 10⁻⁷ m/s² between two craft 150 m apart there: they stay together.
// Docked craft cross the wormhole with the flown one: the links are the fleet's, on either side.
// Everything near is measured in the camera's rest frame (local-patch.ts mapToRest): the lengths in metres, the
// velocities as the difference of the two ZAMO velocities — to first order, fair over a few kilometres.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { blToCartesian, cameraFrame, setHolePose } from "../camera";
import { timeRate } from "../clock";
import { nominalDockClosing } from "../docking-guidance";
import { endurancePose } from "../endurance";
import { fleet, type HoleFree } from "../fleet";
import { advance, fromZamo, toZamo } from "../geodesic";
import { recorder } from "../game/recorder";
import { gradeDocking } from "../game/report";
import { t, tf } from "../i18n";
import { betaToCoord, zamoBeta } from "../landing";
import { add, cross, dot, lin, sub } from "../math/vec3";
import { setMountVessel } from "../mounts";
import type { Vec3 } from "../physics";
import type { Want } from "../pilot";
import { mapToRest } from "../system/local-patch";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { dockedFrame, VESSELS, type VesselId } from "../vessels";
import { sphericalFrame } from "../wormhole";
import type { CameraController } from "../controls";

/** Near enough to be drawn at its true size and docked to [m]; the capture's limits (as our side's); a craft near
 *  enough to be flown instead ([ ]) [m]. */
export const HOLE_DOCK = { near: 60e3, reach: 5000, along: 0.3, lateral: 0.3, angle: 10, speed: 0.5, spin: 3, switchM: 10e3 };

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A craft of the fleet on Gargantua's side, not flown: the hole's map — centre [M], coordinate velocity, axes (left,
 *  top, nose), its turn [per M of time]. */
export interface HoleCraft {
  id: VesselId;
  C: Vec3;
  V: Vec3;
  ax: [Vec3, Vec3, Vec3];
  w: Vec3;
}

/** The docking on Gargantua's side, as the panel shows it (the same figures as our side's DockInfo). */
export interface HoleDock {
  target: VesselId;
  title: string;
  name: string;
  port: number;
  ownPort: number;
  range: number;
  along: number;
  lateral: number;
  closing: number;
  lateralRate: number;
  angle: number;
  spin: number;
  /** the port seen from the camera (its rest frame's axes: right, up, forward) [m] */
  at: Vec3;
}

declare module "../controls" {
  interface CameraController {
    /** the docking's figures on Gargantua's side this frame (the panel's), null: nothing near */
    holeDock?: HoleDock | null;
    /** the last undocking on this side (the scene's time [M]): no capture for a few seconds after it */
    holeUndockAt?: number;
    holeCrafts: typeof holeCrafts;
    holeEndurance: typeof holeEndurance;
    holeDockStep: typeof holeDockStep;
    holeCraft: typeof holeCraft;
    holeDockWant: typeof holeDockWant;
    holeSwitch: typeof holeSwitch;
    holeUndockLinks: typeof holeUndockLinks;
    placeByHoleEndurance: typeof placeByHoleEndurance;
  }
}

const mRof = (c: CameraController) => 1476.625 * (c.s.massSolar || 1);

/** A free craft's state from its map pose (centre, coordinate velocity, axes) at a time [M]. */
function freeOf(c: CameraController, X: Vec3, V: Vec3, ax: [Vec3, Vec3, Vec3], tt: number): HoleFree {
  const r = Math.hypot(...X);
  const st = fromZamo(r, Math.acos(Math.max(-1, Math.min(1, X[2] / r))), Math.atan2(X[1], X[0]), zamoBeta(X, V, c.s.spin), c.s.spin, tt);
  return { st, ax, t: tt };
}

/** The camera on Gargantua's side: its place on the map [M], its rest frame's mapping, its ZAMO velocity. */
function camHole(c: CameraController) {
  const cam = cameraFrame(c.s);
  if (cam.region !== "hole") return null;
  const X = blToCartesian(cam.r, cam.theta, cam.phi) as Vec3;
  const f = sphericalFrame(X);
  // (a local vector — along the ZAMO's r̂ θ̂ φ̂ — onto the map, and back)
  const toMap = (z: Vec3): Vec3 => lin(lin(f.er as Vec3, z[0], f.et as Vec3, z[1]), 1, f.ep as Vec3, z[2]);
  const toLocal = (v: Vec3): Vec3 => [dot(v, f.er as Vec3), dot(v, f.et as Vec3), dot(v, f.ep as Vec3)];
  const toCam = (v: Vec3): Vec3 => [dot(v, cam.right as Vec3), dot(v, cam.up as Vec3), dot(v, cam.fwd as Vec3)];
  return { cam, X, toMap, toLocal, toCam, rest: (d: Vec3) => mapToRest(d, cam) as Vec3 };
}

/** The flown craft's own pose on the map: its centre [M], coordinate velocity, axes. */
function flownMap(c: CameraController, H: NonNullable<ReturnType<typeof camHole>>) {
  const ax = c.shipAxesLocal(H.cam).map((a) => unit(H.toMap(a as Vec3))) as [Vec3, Vec3, Vec3];
  const V = betaToCoord(H.X, H.cam.beta as Vec3, c.s.spin) as Vec3;
  return { X: H.X, V, ax };
}

/** v turned about the unit axis k by ang (Rodrigues). */
function rotate(v: Vec3, k: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang),
    sn = Math.sin(ang);
  return lin(lin(v, c, cross(k, v), sn), 1, k, dot(k, v) * (1 - c));
}

/**
 * The fleet's craft on Gargantua's side at t, not flown and not docked to the flown one: each left there (coasting on
 * its geodesic), and the scene's Endurance on its first orbit until it is docked to, flown or left (in the hole's
 * equatorial plane only: tilted, its circle is no geodesic — 27 m/s apart in 0.2 s — it stays drawn).
 */
function holeCrafts(this: CameraController, tt: number): HoleCraft[] {
  const s = this.s;
  const mine = new Set(fleet.assembly(fleet.active));
  const out: HoleCraft[] = [];
  for (const [id, F] of Object.entries(fleet.hole) as [VesselId, HoleFree][]) {
    if (!F || mine.has(id)) continue;
    // (stepped to now each frame — holeDockStep —: read as it stands)
    const X = blToCartesian(F.st.r, F.st.th, F.st.ph) as Vec3;
    out.push({ id, C: X, V: betaToCoord(X, toZamo(F.st, s.spin), s.spin) as Vec3, ax: F.ax, w: F.w ?? [0, 0, 0] });
  }
  if (s.endurance && Math.abs(s.enduranceIncl) < 1e-6 && !fleet.hole.endurance && !mine.has("endurance")) {
    const P = endurancePose(s, tt);
    // (its turn about its hub's axis — its ports on it: their centres do not circle, the turn is matched to align them)
    const w = lin(P.z as Vec3, (2 * Math.PI) / Math.max(s.enduranceSpin, 2e-4), P.z as Vec3, 0);
    out.push({ id: "endurance", C: P.C as Vec3, V: P.V as Vec3, ax: [P.x, P.y, P.z] as [Vec3, Vec3, Vec3], w });
  }
  return out;
}

/** The Endurance on Gargantua's side at t, when it is a craft of its own there (not flown, not docked to the flown). */
function holeEndurance(this: CameraController, tt: number): (HoleCraft & { mR: number }) | null {
  const E = this.holeCrafts(tt).find((q) => q.id === "endurance");
  return E ? { ...E, mR: mRof(this) } : null;
}

/**
 * A frame of the fleet on Gargantua's side, at the end of the flown craft's step: the craft left there stepped to now
 * on their geodesics; the docking's figures for the panel (the nearest pair of free ports); the capture when the rings
 * meet — a link of the fleet's, the flown craft then flying the assembly.
 */
function holeDockStep(this: CameraController) {
  this.holeDock = null;
  const H = camHole(this);
  if (!H) return;
  const s = this.s;
  const t0 = this.nowTime();
  for (const F of Object.values(fleet.hole)) {
    if (!F || F.st.t >= t0) continue;
    const t1 = F.st.t;
    F.st = advance(F.st, s.spin, t0 - t1).st;
    // (its turn carried: its axes about its spin by the step's angle)
    if (F.w && Math.hypot(...F.w) > 0) {
      const ang = Math.hypot(...F.w) * (t0 - t1);
      F.ax = F.ax.map((a) => rotate(a, unit(F.w!), ang)) as [Vec3, Vec3, Vec3];
    }
    F.t = t0;
  }
  const mR = mRof(this);
  const me = fleet.active;
  const S = flownMap(this, H).ax;
  const onMe = (v: Vec3): Vec3 => lin(lin(S[0], v[0], S[1], v[1]), 1, S[2], v[2]);
  const wMe = this.ownTurn(S);
  const used = fleet.usedPorts(me);
  let best: HoleDock | null = null;
  for (const T of this.holeCrafts(t0)) {
    const onT = (v: Vec3): Vec3 => lin(lin(T.ax[0], v[0], T.ax[1], v[1]), 1, T.ax[2], v[2]);
    const bT = zamoBeta(T.C, T.V, s.spin);
    VESSELS[T.id].ports.forEach((tp, k) => {
      const cT = add(T.C, lin(onT(tp.centre as Vec3), 1 / mR, T.C, 0));
      const aT = unit(H.rest(onT(tp.axis as Vec3)));
      VESSELS[me].ports.forEach((op, j) => {
        if (used.has(j)) return;
        const cO = add(H.X, lin(onMe(op.centre as Vec3), 1 / mR, H.X, 0));
        const d = lin(H.rest(sub(cO, cT)), mR, cO, 0);
        const range = Math.hypot(...d);
        if (best && range >= best.range) return;
        // (the ring's velocity: the ship's and its own turn's — turning with a tumbling target, its ring circles)
        const vRing = add(H.cam.beta as Vec3, H.toLocal(cross(wMe, sub(cO, H.X))));
        const vRel: Vec3 = lin(sub(vRing, bT), C_MPS, bT, 0);
        const along = dot(d, aT);
        const lat = sub(d, lin(aT, along, aT, 0));
        const closing = -dot(vRel, aT);
        const atC = H.rest(sub(cT, H.X));
        best = {
          target: T.id,
          title: VESSELS[T.id].name,
          name: VESSELS[T.id].ports[k]!.name,
          port: k,
          ownPort: j,
          range,
          along,
          lateral: Math.hypot(...lat),
          closing,
          lateralRate: Math.hypot(...sub(vRel, lin(aT, -closing, aT, 0))),
          // (on the map — both axes there exactly: the rest frame's mapping, at a fifth of light's speed, bends angles)
          angle: (Math.acos(Math.max(-1, Math.min(1, -dot(unit(onMe(op.axis as Vec3)), unit(onT(tp.axis as Vec3)))))) * 180) / Math.PI,
          // (the turns apart: the flown craft's against the target's [deg/s])
          spin: (Math.hypot(...sub(wMe, T.w)) / M_SECONDS) * (180 / Math.PI),
          at: lin(H.toCam(atC), mR, atC, 0),
        };
      });
    });
  }
  const g = best as HoleDock | null;
  if (!g || g.range > HOLE_DOCK.near) return;
  this.holeDock = g.range < HOLE_DOCK.reach ? g : null;
  if (g.range > 2) return;
  // (just let go: no capture for 5 s — the springs push apart; an engine still spooling down would bring it back)
  if (this.holeUndockAt !== undefined && (t0 - this.holeUndockAt) * M_SECONDS < 5) return;
  const speed = Math.hypot(g.closing, g.lateralRate);
  if (
    g.along < HOLE_DOCK.along &&
    g.along > -0.6 &&
    g.lateral < HOLE_DOCK.lateral &&
    g.angle < HOLE_DOCK.angle &&
    g.spin < HOLE_DOCK.spin &&
    speed < HOLE_DOCK.speed &&
    g.closing > -0.02
  ) {
    // the capture: a link of the fleet's (the target the host, the flown craft its guest — rings together, axes facing)
    const F = dockedFrame(VESSELS[me].ports[g.ownPort]!, VESSELS[g.target].ports[g.port]!, [0, 1, 0]);
    fleet.links.push({ a: g.target, b: me, pa: g.port, pb: g.ownPort, c: F.c, ax: F.ax });
    delete fleet.hole[g.target];
    this.holeDock = null;
    if (this.pilot.auto !== "none") this.pilot.setAuto(this.pilot.auto);
    this.onPilotMessage?.(tf("Docked to the {0} · {1} · {2} m/s", g.title, g.name, speed.toFixed(2)));
    const R = recorder.samples;
    this.onFlightReport?.(
      gradeDocking({
        target: g.title,
        port: g.name,
        closing: speed,
        lateral: g.lateral,
        angle: g.angle,
        spin: g.spin,
        dv: this.spent * C_MPS,
        flightS: R.length > 1 ? R[R.length - 1]!.t - R[0]!.t : Number.NaN,
      }),
    );
  }
}

/**
 * Undocked on Gargantua's side (the flown craft's own links): each piece let go coasts on its own geodesic from where
 * the assembly held it, the flown craft pushed off at 5 cm/s along its port's axis. True when it did.
 */
function holeUndockLinks(this: CameraController): boolean {
  const H = camHole(this);
  if (!H) return false;
  const me = fleet.active;
  const mine = fleet.links.filter((l) => l.a === me || l.b === me);
  if (!mine.length) return false;
  const s = this.s;
  const t0 = this.viewTime();
  const mR = mRof(this);
  const P = flownMap(this, H);
  // every piece's place before (rigid on the flown craft: its axes, its links) — [M] from a centre at 0, the map's axes
  const at = fleet.posesFrom(me, { X: [0, 0, 0], V: [0, 0, 0], ax: P.ax }, t0);
  const l0 = mine[0]!;
  const myPort = VESSELS[me].ports[l0.a === me ? l0.pa : l0.pb]!;
  const out = unit(lin(lin(P.ax[0], myPort.axis[0], P.ax[1], myPort.axis[1]), 1, P.ax[2], myPort.axis[2]));
  fleet.links = fleet.links.filter((l) => !mine.includes(l));
  this.holeUndockAt = t0;
  for (const [v, q] of at) {
    if (v === me || v === "iss" || fleet.assembly(v).includes(me)) continue;
    const X = add(P.X, lin(q.X, M_METRES / mR, q.X, 0));
    fleet.hole[v] = freeOf(this, X, P.V, q.ax, t0);
  }
  // (the flown craft pushed off its port: 5 cm/s the other way)
  const b = lin(H.cam.beta as Vec3, 1, H.toLocal(out), -0.05 / C_MPS);
  setHolePose(s, H.X, H.toMap(H.cam.fwd as Vec3), H.toMap(H.cam.up as Vec3), H.toMap(b));
  this.sync();
  const names = mine.map((l) => (l.a === me ? l.b : l.a)).map((v) => VESSELS[v as VesselId].name);
  this.onPilotMessage?.(tf("Undocked from the {0}", names.join(" · ")));
  return true;
}

/**
 * [ ] on Gargantua's side: another craft of the fleet flown — docked to the flown one (its assembly), or left within
 * 10 km. The craft left keeps coasting on its geodesic (or, docked, rides with the new one). Why not, or null.
 */
function holeSwitch(this: CameraController, id: VesselId): string | null {
  const H = camHole(this);
  if (!H) return tf("The other craft are near the Earth — in our solar system");
  const s = this.s;
  const t0 = this.viewTime();
  const mR = mRof(this);
  const me = fleet.active;
  const P = flownMap(this, H);
  let to: { X: Vec3; V: Vec3; ax: [Vec3, Vec3, Vec3] } | null = null;
  if (fleet.assembly(me).includes(id)) {
    // (docked: its place on the assembly, rigid on the flown craft)
    const q = fleet.posesFrom(me, { X: [0, 0, 0], V: [0, 0, 0], ax: P.ax }, t0).get(id);
    if (q) to = { X: add(P.X, lin(q.X, M_METRES / mR, q.X, 0)), V: P.V, ax: q.ax };
  } else {
    const T = this.holeCrafts(t0).find((q) => q.id === id);
    if (!T) return tf("{0}: not on this side of the wormhole", VESSELS[id].name);
    const d = Math.hypot(...H.rest(sub(T.C, H.X))) * mR;
    if (d > HOLE_DOCK.switchM) return tf("The {0} is {1} km away — within 10 km to fly it", VESSELS[id].name, (d / 1000).toFixed(0));
    to = { X: T.C, V: T.V, ax: T.ax };
    // (the craft left: coasting on its geodesic from here; the new one's free state gone — it is flown)
    fleet.hole[me] = freeOf(this, P.X, P.V, P.ax, t0);
    delete fleet.hole[id];
    // (the scene's Endurance taken off its first orbit: a craft of the fleet from now on — flown, never redrawn there)
    if (id === "endurance") s.endurance = false;
  }
  if (!to) return tf("{0}: not found", VESSELS[id].name);
  fleet.active = id;
  s.vessel = id;
  setMountVessel(id);
  this.pilot.auto = "none";
  this.pilot.hold = "none";
  this.pilot.throttle = 0;
  this.pilot.omega = [0, 0, 0];
  s.flightMode = id === "ranger" ? "plane" : "rocket";
  this.plan = { nodes: [], path: null, at: 0, note: "" };
  this.outside.dist = VESSELS[id].viewDist;
  this.local = null;
  // (the new craft's place: the camera's axes from its own through the mount)
  const Sm = this.shipMatrix();
  const camAx = (k: number) => unit(lin(lin(to!.ax[0], Sm[k]![0], to!.ax[1], Sm[k]![1]), 1, to!.ax[2], Sm[k]![2]));
  const b = zamoBeta(to.X, to.V, s.spin);
  const f = sphericalFrame(to.X);
  setHolePose(s, to.X, camAx(2), camAx(1), lin(lin(f.er as Vec3, b[0], f.et as Vec3, b[1]), 1, f.ep as Vec3, b[2]));
  s.motion = "geodesic";
  this.settleMount();
  this.sync();
  const with_ = fleet
    .flownAssembly()
    .filter((v) => v !== id)
    .map((v) => VESSELS[v].name)
    .join(", ");
  this.onPilotMessage?.(
    with_ ? tf("Flying the {0} — docked: {1} with it", VESSELS[id].name, with_) : tf("Flying the {0}", VESSELS[id].name),
  );
  return null;
}

/**
 * The docking autopilot by Gargantua, to the nearest free port: the attitude — the flown craft's port facing it, its
 * top to the target's —, the velocity: the target's (both on their geodesics: nothing fed forward) plus the closing
 * along its port's axis (docking-guidance.ts's nominal, 0.1 m/s at the contact) and the offset across taken out; to a
 * point on the axis first when off it. Null when nothing is near (the caller says).
 */
function holeDockWant(this: CameraController, cam: ReturnType<typeof cameraFrame>, say: (t: string) => null): Want | null {
  const H = camHole(this);
  if (!H) return null;
  void cam;
  const crafts = this.holeCrafts(this.nowTime());
  const g = this.holeDock;
  if (!g) return crafts.length ? say(t("Docking: within 5 km of a craft's free port")) : null;
  const T = crafts.find((q) => q.id === g.target);
  if (!T) return null;
  const mR = mRof(this);
  const me = fleet.active;
  const F = dockedFrame(VESSELS[me].ports[g.ownPort]!, VESSELS[g.target].ports[g.port]!, [0, 1, 0]);
  const onT = (v: Vec3): Vec3 => lin(lin(T.ax[0], v[0], T.ax[1], v[1]), 1, T.ax[2], v[2]);
  const shipAx = F.ax.map((v) => unit(onT(v as Vec3))) as [Vec3, Vec3, Vec3];
  // (the attitude: the ship's nose and top as docked, on the local axes; the target's turn flown ahead — a tumble
  // chased on the error alone is never caught — as the pilot's rates on the ship's axes, per second of its clock)
  const Sm = flownMap(this, H).ax;
  const rate = Sm.map((x) => -dot(T.w, x) * timeRate(this.s)) as Vec3;
  const att = { nose: unit(H.toLocal(shipAx[2])), up: unit(H.toLocal(shipAx[1])), rate };
  this.dockAuto ??= {
    target: g.target,
    port: g.port,
    phase: "",
    att: null,
    warp: this.s.timeSpeed,
    set: Number.NaN,
    corridor: false,
    final: false,
    blocked: false,
    checked: -1e9,
  };
  const D = this.dockAuto;
  D.att = att;
  const aT = unit(H.rest(onT(VESSELS[g.target].ports[g.port]!.axis as Vec3)));
  const lat = g.lateral;
  const along = g.along;
  const cone = 1 + 0.15 * Math.max(along, 0);
  D.corridor = along > -0.5 && lat < (D.corridor ? 1.5 : 1) * cone;
  let want: Vec3; // relative to the target [m/s], local axes
  const cT = add(T.C, lin(onT(VESSELS[g.target].ports[g.port]!.centre as Vec3), 1 / mR, T.C, 0));
  const p = VESSELS[me].ports[g.ownPort]!.centre as Vec3;
  const ring = add(H.X, lin(lin(lin(Sm[0], p[0], Sm[1], p[1]), 1, Sm[2], p[2]), 1 / mR, H.X, 0));
  const d = lin(H.rest(sub(ring, cT)), mR, cT, 0);
  const latv = sub(d, lin(aT, dot(d, aT), aT, 0));
  if (D.corridor) {
    let vc = nominalDockClosing(along);
    // (as our side's: held to the final once in it within 20 cm — at one threshold it flipped between the hold and the
    // final, the ring a steady 10 cm off the axis)
    const aligned = D.final ? lat < 0.2 && g.angle < 5 : lat < 0.1 && g.angle < 2 && g.lateralRate < 0.04;
    D.final = along < 12 && aligned;
    if (along < 12 && !aligned) vc = Math.max(Math.min(vc, 0.05 * (along - 10)), -0.1);
    // (the last metres: slower while the ring is more than 4 cm off the axis)
    if (D.final && along < 3) vc *= Math.min(Math.max((0.1 - lat) / 0.06, 0.25), 1);
    D.phase = along >= 12 ? "APPROACH" : D.final ? "FINAL" : "HOLD 10 m";
    let vl = lin(latv, -0.15, latv, 0);
    const vll = Math.hypot(...vl);
    if (vll > 0.4) vl = lin(vl, 0.4 / vll, vl, 0);
    want = lin(aT, -vc, vl, 1);
  } else {
    // to a point on the axis, 30–200 m out
    const S0 = Math.min(Math.max(along, 30), 200);
    const to = sub(lin(aT, S0, aT, 0), d);
    const dist = Math.hypot(...to);
    const sp = Math.min(3, Math.sqrt(2 * 0.03 * dist), 0.1 * dist);
    want = dist > 1e-6 ? lin(to, sp / dist, to, 0) : [0, 0, 0];
    D.phase = "TO THE AXIS";
  }
  const bT = zamoBeta(T.C, T.V, this.s.spin);
  // (the ring's motion is the ship's and its own turn's: turning with a tumbling target, the ring — a metre off the
  // ship's roll axis — circles; the ship's velocity is the ring's wanted less ω × r, its push less the circle's pull —
  // without, the ring stayed 1.2 m off the axis, held 10 m out for ever)
  const wOwn = this.ownTurn(Sm);
  const rr = sub(ring, H.X);
  const circ = H.toLocal(cross(wOwn, rr));
  const pull = H.toLocal(cross(wOwn, cross(wOwn, rr)));
  return { beta: lin(lin(bT, 1, want, 1 / C_MPS), 1, circ, -1), ff: lin(pull, -1, pull, 0) };
}

/**
 * The fleet's craft to draw on Gargantua's side near the camera — the craft there within 60 km, those docked to the
 * flown one —, each on the camera's (rest frame) axes [m] from the flown craft's origin; whether the cinematic
 * Endurance is to be left out (it is one of them — or flown, docked, left: a craft of the fleet now).
 */
function holeCraft(
  this: CameraController,
): { items: { id: VesselId; rel: Vec3; axes: [Vec3, Vec3, Vec3] }[]; hideCinematic: boolean } | null {
  const H = camHole(this);
  if (!H) return null;
  const mR = mRof(this);
  const tv = this.viewTime();
  const items: { id: VesselId; rel: Vec3; axes: [Vec3, Vec3, Vec3] }[] = [];
  // (read by the renderer, outside the frame's step: the view's clock — where the craft was placed for)
  for (const T of this.holeCrafts(tv)) {
    const d = H.rest(sub(T.C, H.X));
    const rel = lin(H.toCam(d), mR, d, 0);
    if (Math.hypot(...rel) > HOLE_DOCK.near) continue;
    items.push({ id: T.id, rel, axes: T.ax.map((a) => unit(H.toCam(H.rest(a)))) as [Vec3, Vec3, Vec3] });
  }
  // (docked to the flown craft: rigid on it — its axes on the camera's, the links walked from it)
  const me = fleet.active;
  if (fleet.assembly(me).length > 1) {
    const S = this.shipAxesLocal(H.cam).map((a) => unit(H.toCam(a as Vec3))) as [Vec3, Vec3, Vec3];
    for (const [v, q] of fleet.posesFrom(me, { X: [0, 0, 0], V: [0, 0, 0], ax: S }, tv))
      if (v !== me && v !== "iss") items.push({ id: v, rel: lin(q.X, M_METRES, q.X, 0), axes: q.ax });
  }
  const hideCinematic =
    fleet.active === "endurance" ||
    !!fleet.hole.endurance ||
    fleet.assembly(me).includes("endurance") ||
    items.some((q) => q.id === "endurance");
  return items.length || hideCinematic ? { items, hideCinematic } : null;
}

/** The flown craft put `m` metres off the Endurance's fore port on Gargantua's side, on its axis, its own port to it,
 *  at its velocity (the scene's start; a test's). What to say. */
function placeByHoleEndurance(this: CameraController, m = 150, at?: number): string {
  const s = this.s;
  // (the scene's time when given; else the view's — outside the frame's step nowTime is the step's start, a frame
  // behind where the craft is: at a quarter of light's speed, thousands of km)
  const t0 = at ?? this.viewTime();
  const E = this.holeEndurance(t0);
  if (!E) return t("The Endurance: not in this scene (by Gargantua)");
  const me = fleet.active;
  const host = VESSELS.endurance.ports[0]!;
  const F = dockedFrame(VESSELS[me].ports[0]!, host, [0, 1, 0]);
  const onE = (v: Vec3): Vec3 => lin(lin(E.ax[0], v[0], E.ax[1], v[1]), 1, E.ax[2], v[2]);
  const c = lin(F.c as Vec3, 1, host.axis as Vec3, m);
  const X = add(E.C, lin(onE(c), 1 / E.mR, E.C, 0));
  const shipAx = F.ax.map((v) => unit(onE(v as Vec3))) as [Vec3, Vec3, Vec3];
  const Sm = this.shipMatrix();
  const camAx = (k: number) => unit(lin(lin(shipAx[0], Sm[k]![0], shipAx[1], Sm[k]![1]), 1, shipAx[2], Sm[k]![2]));
  const b = zamoBeta(E.C, E.V, s.spin);
  const f = sphericalFrame(X);
  setHolePose(s, X, camAx(2), camAx(1), lin(lin(f.er as Vec3, b[0], f.et as Vec3, b[1]), 1, f.ep as Vec3, b[2]));
  s.motion = "geodesic";
  this.pilot.omega = [0, 0, 0];
  this.sync();
  return tf("{0} m off the Endurance's fore port", m);
}

export function installHoleEndurance(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    holeCrafts,
    holeEndurance,
    holeDockStep,
    holeCraft,
    holeDockWant,
    holeSwitch,
    holeUndockLinks,
    placeByHoleEndurance,
  });
}
