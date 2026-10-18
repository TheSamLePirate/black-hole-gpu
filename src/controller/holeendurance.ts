// The CameraController — the Endurance on Gargantua's side (docs/PLAN-VAISSEAUX-AAA.md, X2c): the craft the scene draws
// at a cinematic scale on its orbit about the hole (endurance.ts) made a mothership there — at its true size near it
// (64 m: the renderer draws the fleet's mesh within 60 km, the cinematic one beyond), its hub's two ports, docked to as
// the station is on our side: held on its port while docked, its orbit carrying the craft, UNDOCK on the springs.
// Its orbit is the scene's (endurance.ts endurancePose, exact: no integrator drifts it from a craft beside it) — in the
// hole's equatorial plane, where that circle is a Kerr geodesic (Ω = 1/(r^3/2 + a)); a tilted one is not, and stays drawn.
// Everything is measured in the camera's rest frame (local-patch.ts mapToRest): the lengths in metres, the velocities
// as the difference of the two ZAMO velocities — to first order, fair over a few kilometres.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { blToCartesian, cameraFrame, setHolePose } from "../camera";
import { endurancePose } from "../endurance";
import { fleet } from "../fleet";
import { gradeDocking } from "../game/report";
import { recorder } from "../game/recorder";
import { t, tf } from "../i18n";
import { zamoBeta } from "../landing";
import { add, cross, dot, lin, sub } from "../math/vec3";
import type { Vec3 } from "../physics";
import { mapToRest } from "../system/local-patch";
import { C_MPS, M_SECONDS } from "../units";
import { dockedFrame, VESSELS } from "../vessels";
import { nominalDockClosing } from "../docking-guidance";
import type { Want } from "../pilot";
import { sphericalFrame } from "../wormhole";
import { timeRate } from "../clock";
import type { CameraController } from "../controls";

/** Near enough to be drawn at its true size and docked to [m]; the capture's limits (as the station's). */
export const HOLE_DOCK = { near: 60e3, reach: 5000, along: 0.3, lateral: 0.3, angle: 10, speed: 0.5, spin: 3 };

const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The Endurance's docking on Gargantua's side, as the panel shows it (the same figures as our side's DockInfo). */
export interface HoleDock {
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
    /** held on the Endurance's port on Gargantua's side: which port, the flown craft's */
    holeDocked?: { port: number; ownPort: number } | null;
    /** the docking's figures on Gargantua's side this frame (the panel's), null: the Endurance not near */
    holeDock?: HoleDock | null;
    holeEndurance: typeof holeEndurance;
    holeDockStep: typeof holeDockStep;
    flyHoleDocked: typeof flyHoleDocked;
    holeUndock: typeof holeUndock;
    holeCraft: typeof holeCraft;
    holeDockWant: typeof holeDockWant;
    placeByHoleEndurance: typeof placeByHoleEndurance;
  }
}

/** The Endurance on Gargantua's side at t (the hole's map: centre [M], coordinate velocity, axes; the metres a map M
 *  holds), null when the scene has none (or the flown craft is the Endurance itself). */
function holeEndurance(this: CameraController, t: number) {
  const s = this.s;
  // (in the hole's equatorial plane only: there its circle is a geodesic — a craft beside it stays beside it; tilted,
  // the scene's circle is not one — 27 m/s apart in the first fifth of a second —, the Endurance only drawn)
  if (!s.endurance || fleet.active === "endurance" || Math.abs(s.enduranceIncl) > 1e-6) return null;
  const P = endurancePose(s, t);
  // (its turn about its hub's axis — its ports on it: their centres do not circle, the turn is matched to align them)
  const w = lin(P.z as Vec3, (2 * Math.PI) / Math.max(s.enduranceSpin, 2e-4), P.z as Vec3, 0);
  return { C: P.C as Vec3, V: P.V as Vec3, ax: [P.x, P.y, P.z] as [Vec3, Vec3, Vec3], w, mR: 1476.625 * (s.massSolar || 1) };
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
  return { cam, X, toMap, toLocal, rest: (d: Vec3) => mapToRest(d, cam) as Vec3 };
}

/** A frame of the docking on Gargantua's side: the figures for the panel; the capture when the rings meet. */
function holeDockStep(this: CameraController) {
  this.holeDock = null;
  const H = camHole(this);
  if (!H) return;
  const t0 = this.nowTime();
  const E = this.holeEndurance(t0);
  if (!E) return;
  const me = fleet.active;
  const S = this.shipAxesLocal(H.cam).map((a) => H.toMap(a as Vec3)) as [Vec3, Vec3, Vec3];
  const onE = (v: Vec3): Vec3 => lin(lin(E.ax[0], v[0], E.ax[1], v[1]), 1, E.ax[2], v[2]);
  const onMe = (v: Vec3): Vec3 => lin(lin(S[0], v[0], S[1], v[1]), 1, S[2], v[2]);
  // the pair of free ports nearest each other (rest metres)
  let best: HoleDock | null = null;
  const bE = zamoBeta(E.C, E.V, this.s.spin);
  const wMe = this.ownTurn(S);
  VESSELS.endurance.ports.forEach((tp, k) => {
    const cT = add(E.C, lin(onE(tp.centre as Vec3), 1 / E.mR, E.C, 0));
    const aT = unit(H.rest(onE(tp.axis as Vec3)));
    VESSELS[me].ports.forEach((op, j) => {
      const cO = add(H.X, lin(onMe(op.centre as Vec3), 1 / E.mR, H.X, 0));
      // (the ring's velocity: the ship's and its own turn's — turning with a tumbling Endurance, its ring circles)
      const vRing = add(H.cam.beta as Vec3, H.toLocal(cross(wMe, sub(cO, H.X))));
      const vRel: Vec3 = lin(sub(vRing, bE), C_MPS, bE, 0);
      const d = lin(H.rest(sub(cO, cT)), E.mR, cO, 0);
      const range = Math.hypot(...d);
      if (best && range >= best.range) return;
      const along = dot(d, aT);
      const lat = sub(d, lin(aT, along, aT, 0));
      const closing = -dot(vRel, aT);
      const atC = H.rest(sub(cT, H.X));
      best = {
        title: "Endurance",
        name: VESSELS.endurance.ports[k]!.name,
        port: k,
        ownPort: j,
        range,
        along,
        lateral: Math.hypot(...lat),
        closing,
        lateralRate: Math.hypot(...sub(vRel, lin(aT, -closing, aT, 0))),
        // (on the map — both axes there exactly: the rest frame's mapping, at a fifth of light's speed, bends angles)
        angle: (Math.acos(Math.max(-1, Math.min(1, -dot(unit(onMe(op.axis as Vec3)), unit(onE(tp.axis as Vec3)))))) * 180) / Math.PI,
        // (the turns apart: the flown craft's against the Endurance's [deg/s])
        spin: (Math.hypot(...sub(wMe, E.w)) / M_SECONDS) * (180 / Math.PI),
        at: [dot(atC, H.cam.right as Vec3) * E.mR, dot(atC, H.cam.up as Vec3) * E.mR, dot(atC, H.cam.fwd as Vec3) * E.mR],
      };
    });
  });
  const g = best as HoleDock | null;
  if (!g || g.range > HOLE_DOCK.near) return;
  this.holeDock = g.range < HOLE_DOCK.reach ? g : null;
  if (this.holeDocked || g.range > 2) return;
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
    this.holeDocked = { port: g.port, ownPort: g.ownPort };
    if (this.pilot.auto !== "none") this.pilot.setAuto(this.pilot.auto);
    this.onPilotMessage?.(tf("Docked to the Endurance · {0} · {1} m/s", g.name, speed.toFixed(2)));
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

/** Held on the Endurance's port (its orbit carries the craft): placed on it each frame, its velocity its. */
function flyHoleDocked(this: CameraController, dt: number) {
  const s = this.s;
  const D = this.holeDocked!;
  const t0 = this.nowTime();
  const simDt = s.animate ? timeRate(s) * dt : 0;
  const t1 = t0 + simDt;
  const E = this.holeEndurance(t1);
  if (!E) return this.holeUndock();
  const me = fleet.active;
  const F = dockedFrame(VESSELS[me].ports[D.ownPort]!, VESSELS.endurance.ports[D.port]!, [0, 1, 0]);
  const onE = (v: Vec3): Vec3 => lin(lin(E.ax[0], v[0], E.ax[1], v[1]), 1, E.ax[2], v[2]);
  const X = add(E.C, lin(onE(F.c as Vec3), 1 / E.mR, E.C, 0));
  const shipAx = F.ax.map((v) => unit(onE(v as Vec3))) as [Vec3, Vec3, Vec3];
  const Sm = this.shipMatrix();
  const camAx = (k: number) => unit(lin(lin(shipAx[0], Sm[k]![0], shipAx[1], Sm[k]![1]), 1, shipAx[2], Sm[k]![2]));
  const b = zamoBeta(E.C, E.V, s.spin);
  const f = sphericalFrame(X);
  const vel = lin(lin(f.er as Vec3, b[0], f.et as Vec3, b[1]), 1, f.ep as Vec3, b[2]);
  setHolePose(s, X, camAx(2), camAx(1), vel);
  s.motion = "geodesic";
  this.pilot.omega = [0, 0, 0];
  this.properTime += simDt;
  this.shipTime = t1;
  this.sync();
  this.holeDockStep();
}

/** Undocked from the Endurance on Gargantua's side: the springs push the craft off its port at 5 cm/s. */
function holeUndock(this: CameraController) {
  const D = this.holeDocked;
  this.holeDocked = null;
  if (!D) return;
  const H = camHole(this);
  if (!H) return;
  const S = this.shipAxesLocal(H.cam);
  const a = (VESSELS[fleet.active].ports[D.ownPort]?.axis ?? [0, 0, -1]) as Vec3;
  // (the push: along the flown craft's own port's axis, outwards from the port — the craft moves the other way)
  const out = lin(lin(S[0] as Vec3, a[0], S[1] as Vec3, a[1]), 1, S[2] as Vec3, a[2]);
  const b = lin(H.cam.beta as Vec3, 1, out, -0.05 / C_MPS);
  const s = this.s;
  setHolePose(s, H.X, H.toMap(H.cam.fwd as Vec3), H.toMap(H.cam.up as Vec3), H.toMap(b));
  this.sync();
  this.onPilotMessage?.(t("Undocked from the Endurance"));
}

/**
 * The docking autopilot by Gargantua, to the Endurance's nearest free port: the attitude — the flown craft's port
 * facing it, its top to the Endurance's —, the velocity: the Endurance's (both on its geodesic: nothing fed forward)
 * plus the closing along its port's axis (docking-guidance.ts's nominal, 0.1 m/s at the contact) and the offset
 * across taken out; to a point on the axis first when off it. Null when the Endurance is not near (the caller says).
 */
function holeDockWant(this: CameraController, cam: ReturnType<typeof cameraFrame>, say: (t: string) => null): Want | null {
  const H = camHole(this);
  const t0 = this.nowTime();
  const E = H ? this.holeEndurance(t0) : null;
  if (!H || !E) return null;
  const g = this.holeDock;
  if (!g) return say(t("Docking: within 5 km of the Endurance's ports"));
  const me = fleet.active;
  const F = dockedFrame(VESSELS[me].ports[g.ownPort]!, VESSELS.endurance.ports[g.port]!, [0, 1, 0]);
  const onE = (v: Vec3): Vec3 => lin(lin(E.ax[0], v[0], E.ax[1], v[1]), 1, E.ax[2], v[2]);
  const shipAx = F.ax.map((v) => unit(onE(v as Vec3))) as [Vec3, Vec3, Vec3];
  // (the attitude: the ship's nose and top as docked, on the local axes; the Endurance's turn flown ahead — its tumble
  // chased on the error alone is never caught — as the pilot's rates on the ship's axes, per second of its clock)
  const Sm = this.shipAxesLocal(H.cam).map((a) => H.toMap(a as Vec3)) as [Vec3, Vec3, Vec3];
  const rate = Sm.map((x) => -dot(E.w, x) * timeRate(this.s)) as Vec3;
  const att = { nose: unit(H.toLocal(shipAx[2])), up: unit(H.toLocal(shipAx[1])), rate };
  this.dockAuto ??= {
    target: "endurance",
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
  const aT = unit(H.rest(onE(VESSELS.endurance.ports[g.port]!.axis as Vec3)));
  // the ring's offset from the port [m], on the local axes: along its axis, across it
  const lat = g.lateral;
  const along = g.along;
  const cone = 1 + 0.15 * Math.max(along, 0);
  D.corridor = along > -0.5 && lat < (D.corridor ? 1.5 : 1) * cone;
  let want: Vec3; // relative to the Endurance [m/s], local axes
  const cT = add(E.C, lin(onE(VESSELS.endurance.ports[g.port]!.centre as Vec3), 1 / E.mR, E.C, 0));
  const ring = (): Vec3 => {
    const S = this.shipAxesLocal(H.cam).map((a) => H.toMap(a as Vec3)) as [Vec3, Vec3, Vec3];
    const p = VESSELS[me].ports[g.ownPort]!.centre as Vec3;
    return add(H.X, lin(lin(lin(S[0], p[0], S[1], p[1]), 1, S[2], p[2]), 1 / E.mR, H.X, 0));
  };
  const d = lin(H.rest(sub(ring(), cT)), E.mR, cT, 0);
  const latv = sub(d, lin(aT, dot(d, aT), aT, 0));
  if (D.corridor) {
    let vc = nominalDockClosing(along);
    const aligned = lat < 0.1 && g.angle < 2 && g.lateralRate < 0.04;
    D.final = along < 12 && aligned;
    if (along < 12 && !aligned) vc = Math.max(Math.min(vc, 0.05 * (along - 10)), -0.1);
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
  const bE = zamoBeta(E.C, E.V, this.s.spin);
  void cam;
  // (the ring's motion is the ship's and its own turn's: turning with the tumbling Endurance, the ring — a metre off
  // the ship's roll axis — circles; the ship's velocity is the ring's wanted less ω × r, its push less the circle's
  // pull — without, the ring stayed 1.2 m off the axis, held 10 m out for ever)
  const wOwn = this.ownTurn(Sm);
  const rr = sub(ring(), H.X);
  const circ = H.toLocal(cross(wOwn, rr));
  const pull = H.toLocal(cross(wOwn, cross(wOwn, rr)));
  return { beta: lin(lin(bE, 1, want, 1 / C_MPS), 1, circ, -1), ff: lin(pull, -1, pull, 0) };
}

/** The fleet's craft to draw on Gargantua's side near the camera: the Endurance at its true size within 60 km — its
 *  place and axes on the camera's (rest frame) axes [m]; null otherwise (the cinematic one is drawn instead). */
function holeCraft(this: CameraController): { rel: Vec3; axes: [Vec3, Vec3, Vec3] } | null {
  const H = camHole(this);
  if (!H) return null;
  // (read by the renderer, outside the frame's step: the view's clock — where the craft was placed for)
  const E = this.holeEndurance(this.viewTime());
  if (!E) return null;
  const d = H.rest(sub(E.C, H.X));
  const toCam = (v: Vec3): Vec3 => [dot(v, H.cam.right as Vec3), dot(v, H.cam.up as Vec3), dot(v, H.cam.fwd as Vec3)];
  const rel = lin(toCam(d), E.mR, d, 0);
  if (Math.hypot(...rel) > HOLE_DOCK.near) return null;
  return { rel, axes: E.ax.map((a) => unit(toCam(H.rest(a)))) as [Vec3, Vec3, Vec3] };
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
  this.holeDocked = null;
  this.pilot.omega = [0, 0, 0];
  this.sync();
  return tf("{0} m off the Endurance's fore port", m);
}

export function installHoleEndurance(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { holeEndurance, holeDockStep, flyHoleDocked, holeUndock, holeCraft, placeByHoleEndurance, holeDockWant });
}
