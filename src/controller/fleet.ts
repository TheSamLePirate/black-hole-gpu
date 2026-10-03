// The CameraController — the fleet: the craft flown and switched.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame, setHomePose } from "../camera";
import type { Vec3 } from "../physics";
import { type Body, onOurSide } from "../targeting";
import { mountPose, setMountVessel, shipToCamera } from "../mounts";
import { fleet, type Pose } from "../fleet";
import { dockedFrame, VESSELS, type VesselId } from "../vessels";
import { mouth } from "../wormhole";
import { repToHomeVec } from "../system/our-side";
import { cockpitHull } from "../system/collide";
import { M_METRES } from "../units";
import { tf } from "../i18n";
import { dot as dot3, lin, sub as sub3 } from "../math/vec3";

import type { CameraController } from "../controls";
import { clamp, onAxesV, unitV } from "./util";

declare module "../controls" {
  interface CameraController {
    activePoseNow: typeof activePoseNow;
    camAxesHome: typeof camAxesHome;
    turnAboutCom: typeof turnAboutCom;
    flyFrom: typeof flyFrom;
    moveCabin: typeof moveCabin;
    placeOnPose: typeof placeOnPose;
    switchVessel: typeof switchVessel;
    placeNearPort: typeof placeNearPort;
    cycleVessel: typeof cycleVessel;
  }
}

/** The flown craft's place now (home): its centre, velocity and axes (fleet.ts reads it). */
function activePoseNow(this: CameraController, evenOff = false): (Pose & { t: number }) | null {
  const s = this.s;
  if (!s.ship && !evenOff) return null;
  const cam = cameraFrame(s);
  const nav = this.ourNav(cam);
  if (!nav) return null;
  const w = mouth(s).w;
  const ax = this.shipAxesLocal({ right: cam.right, up: cam.up, fwd: cam.fwd }).map((a) => unitV(repToHomeVec(w, cam.ell, cam.n, a))) as [
    Vec3,
    Vec3,
    Vec3,
  ];
  return { X: nav.X, V: nav.V, ax, t: nav.t, w: this.spin?.w };
}

/** The camera's axes (right, up, forward) in the home frame (our side), or null. */
function camAxesHome(this: CameraController): [Vec3, Vec3, Vec3] | null {
  const s = this.s;
  const cam = cameraFrame(s);
  if (!onOurSide(s, cam)) return null;
  const w = mouth(s).w;
  return [cam.right, cam.up, cam.fwd].map((a) => unitV(repToHomeVec(w, cam.ell, cam.n, a))) as [Vec3, Vec3, Vec3];
}

/**
 * After a turn of the flown craft (the camera's axes `before` it, home): its centre moved as the
 * assembly's turns about their common centre of mass (`com`, its own frame [m]) — the centre of mass
 * stays put, its velocity too.
 */
function turnAboutCom(this: CameraController, before: [Vec3, Vec3, Vec3] | null, com: Vec3) {
  const after = this.camAxesHome();
  if (!before || !after) return;
  const S = this.shipMatrix();
  const rc: Vec3 = [dot3(S[0], com), dot3(S[1], com), dot3(S[2], com)];
  let d: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) d = lin(d, 1, sub3(before[k]!, after[k]!), rc[k]!);
  if (Math.hypot(...d) < 1e-7) return;
  const nav = this.ourNav(cameraFrame(this.s));
  if (!nav) return;
  setHomePose(this.s, lin(nav.X, 1, d, 1 / M_METRES), after[2], after[1], nav.V);
  this.sync();
}

/** A scene's start: the camera on the flown craft at a pose (home), at its attach point. */
function flyFrom(this: CameraController, p: Pose) {
  setMountVessel(fleet.active);
  this.settleMount();
  this.placeOnPose(p);
}

/**
 * The keys move the camera about the cabin (Z Q S D, A E on AZERTY; Shift faster): along the look,
 * eased (~0.12 s), 1.1 m/s; it glides along what it meets (a 15 cm sphere against the cabin's
 * triangles), within the cabin's box.
 */
function moveCabin(this: CameraController, dt: number, move: number[], fast: boolean) {
  const s = this.s;
  const C = this.cabinCam;
  const e0 = C.eye ?? mountPose("cockpit").eye;
  const S = shipToCamera({ eye: e0, aim: [e0[0], e0[1], e0[2] + 10] }, s.shipLookYaw, s.shipLookPitch).S;
  const v = fast ? 3 : 1.1;
  const want = lin(lin(S[2], move[0]! * v, S[0], move[1]! * v), 1, S[1], move[2]! * v);
  C.vel = lin(C.vel, 1, sub3(want, C.vel), 1 - Math.exp(-dt / 0.12));
  if (Math.hypot(...C.vel) < 1e-3) {
    C.vel = [0, 0, 0];
    return;
  }
  this.activity = performance.now();
  let e: Vec3 = [...e0] as Vec3;
  let d = lin(C.vel, dt, C.vel, 0);
  const R = 0.15;
  const H = cockpitHull;
  for (let k = 0; k < 3 && H.bvh; k++) {
    const len = Math.hypot(...d);
    if (len < 1e-6) break;
    const dir = lin(d, 1 / len, d, 0);
    const hit = H.bvh.segment(e, lin(e, 1, dir, len + R));
    if (!hit) {
      e = lin(e, 1, d, 1);
      d = [0, 0, 0];
      break;
    }
    // (up to the wall, a sphere's radius off it; then along it)
    const go = Math.max(0, hit.t * (len + R) - R);
    e = lin(e, 1, dir, go);
    let n = hit.n;
    if (dot3(n, dir) > 0) n = lin(n, -1, n, 0);
    const rest = lin(d, 1, dir, -go);
    d = lin(rest, 1, n, -dot3(rest, n));
    C.vel = lin(C.vel, 1, n, -dot3(C.vel, n));
  }
  if (!H.bvh) e = lin(e, 1, d, 1);
  // (within the cabin's box)
  if (H.bvh) e = [0, 1, 2].map((i) => clamp(e[i]!, H.lo[i]! + R, H.hi[i]! - R)) as Vec3;
  C.eye = e;
}

/** Puts the camera on the flown craft at a pose (home): the camera's axes from the craft's, through the
 *  attach point. */
function placeOnPose(this: CameraController, p: Pose) {
  const S = this.shipMatrix();
  const cam = (k: number) => lin(lin(p.ax[0], S[k]![0], p.ax[1], S[k]![1]), 1, p.ax[2], S[k]![2]);
  setHomePose(this.s, p.X, unitV(cam(2)), unitV(cam(1)), p.V);
  this.s.motion = "geodesic";
  this.pilot.omega = [0, 0, 0];
  this.sync();
}

/**
 * Flies another craft: the one left coasts on its orbit (or stays docked: the assembly then coasts as
 * it, or is held by the station); the camera onto the new one, at the same kind of attach point. Why
 * not, or null.
 */
function switchVessel(this: CameraController, id: VesselId): string | null {
  const s = this.s;
  if (id === fleet.active) return null;
  const cam = cameraFrame(s);
  const nav = this.ourNav(cam);
  // (tf: `t` is the time in these functions)
  if (!nav) return tf("The other craft are near the Earth — in our solar system");
  const t = nav.t;
  const to = fleet.pose(id, t);
  if (!to) return tf("{0}: not found", VESSELS[id].name);
  const old = fleet.active;
  const me = this.activePoseNow();
  const group = fleet.assembly(old);
  // (the craft left: its assembly coasts as it — unless the new one or the station holds it)
  if (me && !group.includes(id) && !group.includes("iss")) fleet.setFree(old, me, t, this.coastCom());
  for (const v of fleet.assembly(id)) if (v !== "iss") delete fleet.free[v];
  fleet.active = id;
  s.vessel = id;
  setMountVessel(id);
  this.pilot.auto = "none";
  this.pilot.hold = "none";
  this.pilot.throttle = 0;
  this.pilot.omega = [0, 0, 0];
  // (its own way of flying the air: the Ranger as a plane, the Lander as a rocket)
  s.flightMode = id === "ranger" ? "plane" : "rocket";
  this.sfCmd = null;
  this.plan = { nodes: [], path: null, at: 0, note: "" };
  this.issGoal = null;
  this.ourMission = null;
  this.spent = 0;
  this.outside.dist = VESSELS[id].viewDist;
  this.settleMount();
  // (an assembly flown: the camera's velocity its centre of mass's; turning, it keeps turning — the
  // pilot's rates: per second of the pilot's clock, the other way round from the right-hand rule)
  this.placeOnPose(fleet.flownAssembly().length > 1 && to.Vc ? { ...to, V: to.Vc } : to);
  this.spin = null;
  if (to.w && Math.hypot(...to.w) > 0) this.pilot.omega = to.ax.map((a) => -dot3(to.w!, a) * s.timeSpeed) as Vec3;
  this.dockInfo = null;
  // (the target now flown, or docked to it: the body it orbits instead)
  if (fleet.flownAssembly().includes(s.target as VesselId)) this.selectTarget(nav.ref as Body);
  const with_ = fleet
    .flownAssembly()
    .filter((v) => v !== id)
    .map((v) => VESSELS[v].name)
    .join(", ");
  this.onPilotMessage?.(
    fleet.flownAssembly().length > 1
      ? tf("Flying the {0} — docked: {1} with it", VESSELS[id].name, with_)
      : tf("Flying the {0}", VESSELS[id].name),
  );
  return null;
}

/**
 * The flown craft `distM` out on the axis of a free port of another craft (its own port facing it, at
 * rest against it) — a docking's start. Why not, or null.
 */
function placeNearPort(this: CameraController, target: VesselId, distM: number, offset: Vec3 = [0, 0, 0]): string | null {
  const s = this.s;
  const nav = this.ourNav(cameraFrame(s));
  if (!nav) return tf("In our solar system only");
  const t = nav.t;
  const P = fleet.pose(target, t);
  const used = fleet.usedPorts(target);
  const k = VESSELS[target].ports.findIndex((_, i) => !used.has(i));
  if (!P || k < 0 || fleet.flownAssembly().includes(target)) return tf("The {0}: no free port", VESSELS[target].name);
  const host = VESSELS[target].ports[k]!;
  const guest = VESSELS[fleet.active].ports[0]!;
  // (docked there, then backed out along the port's axis)
  const { c, ax } = dockedFrame(guest, host, [0, 1, 0]);
  const cc = lin(lin(c, 1, host.axis, distM), 1, offset, 1);
  this.placeOnPose({
    X: lin(P.X, 1, onAxesV(P.ax, cc), 1 / M_METRES),
    V: P.V,
    ax: ax.map((v) => onAxesV(P.ax, v)) as [Vec3, Vec3, Vec3],
  });
  return null;
}

/** The next (or previous) craft of the fleet. */
function cycleVessel(this: CameraController, dir: 1 | -1) {
  const ids: VesselId[] = ["ranger", "lander", "endurance"];
  const i = ids.indexOf(fleet.active);
  this.s.vessel = ids[(i + dir + ids.length) % ids.length]!;
  return this.s.vessel;
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installFleet(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    activePoseNow,
    camAxesHome,
    turnAboutCom,
    flyFrom,
    moveCabin,
    placeOnPose,
    switchVessel,
    placeNearPort,
    cycleVessel,
  });
}
