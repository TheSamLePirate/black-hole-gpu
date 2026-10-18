// The CameraController — station keeping (docs/PLAN-VAISSEAUX-AAA.md, X1a): the craft held where it is against a
// craft or the station near it (5 km), on the thrusters alone — its place in the target's own frame held (the station
// turns with its orbit: a point on its R-bar or V-bar, as a crew holds before an approach; a craft turning fast: its
// orbital frame, LVLH); the attitude its own (the SAS). Docked, the same key undocks and backs off 30 m along the line from the target's
// centre, then holds there.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { cameraFrame } from "../camera";
import { t, tf } from "../i18n";
import { cross, dot as dot3, lin, sub as sub3 } from "../math/vec3";
import type { Vec3 } from "../physics";
import { fleet } from "../fleet";
import { gravityHome, ourState } from "../system/our-side";
import { BODY_NAMES, type Body, isCraft, isNetTarget } from "../targeting";
import { C_MPS, M_METRES, M_SECONDS } from "../units";
import { VESSELS, type VesselId } from "../vessels";
import type { CameraController, DockTarget } from "../controls";

/** Station keeping's figures: reach [m], the backing off after an undocking [m], the closing speed at most [m/s] and
 *  the braking [m/s²] towards the held point, the warp at most (× real time). */
export const KEEP = { reach: 5000, away: 30, vmax: 1, brake: 0.02, warp: 10, maxRendezvousDv: 10_000 };

declare module "../controls" {
  interface CameraController {
    /** station keeping: what it holds against, the held offset on the target's LVLH axes (radial, along, across) [m] */
    keepRun?: { target: DockTarget; title: string; frame: "body" | "lvlh"; at: Vec3 } | null;
    /** an undocking's backing off asked: the held point that far further out [m] */
    keepAway?: number;
    keepWant: typeof keepWant;
    keepKey: typeof keepKey;
    rendezvousStart: typeof rendezvousStart;
    inApproachEllipsoid: typeof inApproachEllipsoid;
  }
}

/** The target's orbital frame (radial out, along the track, across — the orbit's normal) about its sphere's body, and
 *  its turn [per M of time]. Pure. */
export function lvlhFrame(r: Vec3, v: Vec3): { R: Vec3; T: Vec3; N: Vec3; w: Vec3 } {
  const rl = Math.hypot(...r);
  const R = lin(r, 1 / rl, r, 0);
  let h = cross(r, v);
  const hl = Math.hypot(...h);
  h = hl > 0 ? lin(h, 1 / hl, h, 0) : ([0, 0, 1] as Vec3);
  const T = cross(h, R);
  return { R, T, N: h, w: lin(cross(r, v), 1 / (rl * rl), r, 0) };
}

/** A target turning faster than this [°/s] is held against in its orbital frame, not its own (its own's turn would ask
 *  more than the thrusters: the tumbling Endurance's 18°/s at 150 m are 15 m/s² of pull). */
export const KEEP_SPIN_MAX = 0.2;

/** The frame the offset is held in: the target's own axes and turn (the station's turns with its orbit: its LVLH),
 *  or, turning fast, its orbital frame. */
function keepFrame(
  kind: "body" | "lvlh",
  g: { tgt: { X: Vec3; V: Vec3 }; A: [Vec3, Vec3, Vec3]; om: Vec3 },
  B: { pos: Vec3; vel: Vec3 },
): { ax: [Vec3, Vec3, Vec3]; w: Vec3 } {
  if (kind === "body") return { ax: g.A, w: g.om };
  const F = lvlhFrame(sub3(g.tgt.X, B.pos), sub3(g.tgt.V, B.vel));
  return { ax: [F.R, F.T, F.N], w: F.w };
}

/** The speed towards the held point [m/s]: KEEP.vmax at most, braked at KEEP.brake, a tenth of the gap a second near. */
export function keepSpeed(gap: number): number {
  return Math.min(KEEP.vmax, Math.sqrt(2 * KEEP.brake * gap), 0.1 * gap);
}

/**
 * B (the docking autopilot) with the station or a craft targeted beyond the docking's 3 km: the whole rendezvous —
 * planned (iss-plan.ts: the departure, two corrections, the arrival 200 m off its free port) and flown (the plan's
 * nodes executed), the docking autopilot then taking it to the capture (its waypoints held). What to say; null within
 * 3 km (the docking autopilot itself), or nothing to plan for (it says why).
 */
function rendezvousStart(this: CameraController): string | null {
  const s = this.s;
  const near = this.dockGeometry();
  if (near && near.range <= 3000) return null;
  if (!(s.target === "iss" || isCraft(s.target))) return null;
  const nav = this.ourNav(cameraFrame(s));
  if (!nav) return null;
  const said = this.planIss(nav);
  if (!this.plan.nodes.length) return said;
  // (a plan past any craft's reach — the station's orbit known only near today, its elements propagated decades off:
  // a nonsense of thousands of km/s — refused, said why)
  const dv = this.plan.nodes.reduce((a, n) => a + Math.hypot(...n.dv), 0) * C_MPS;
  if (!(dv < KEEP.maxRendezvousDv)) {
    this.clearPlan();
    return tf("Rendezvous: {0} km/s asked — beyond reach (the station's orbit is known near today's date only)", Math.round(dv / 1e3));
  }
  if (this.pilot.auto !== "node") this.pilot.setAuto("node");
  return tf("Rendezvous: {0} — flown, then docked", said.replace(/^Plan ?: /, ""));
}

/** The station's approach ellipsoid (4 × 2 × 2 km: 2 km along its track, 1 km up, down and across, about its centre
 *  — its LVLH): whether the craft is in it. */
function inApproachEllipsoid(this: CameraController, g: { X: Vec3; tgt: { X: Vec3; V: Vec3 } }): boolean {
  const nav = this.ourNav(cameraFrame(this.s));
  if (!nav) return false;
  const B = ourState(nav.ref, nav.t);
  const F = lvlhFrame(sub3(g.tgt.X, B.pos), sub3(g.tgt.V, B.vel));
  const r = lin(sub3(g.X, g.tgt.X), M_METRES, g.X, 0);
  return (dot3(r, F.T) / 2000) ** 2 + (dot3(r, F.R) / 1000) ** 2 + (dot3(r, F.N) / 1000) ** 2 < 1;
}

/** ⇧8: docked, undock and back off (then hold); else station keeping on or off. What to say. */
function keepKey(this: CameraController): string {
  // (docked: to the station, or a craft of the fleet in one assembly — not another player's: his own undocking)
  const me = fleet.active;
  if ((this.docked || fleet.links.some((l) => l.a === me || l.b === me)) && !this.netDocked) {
    this.undock();
    this.keepAway = KEEP.away;
    this.keepRun = null;
    if (this.pilot.auto !== "keep") this.pilot.setAuto("keep");
    return tf("Undocked — backing off {0} m, then holding", KEEP.away);
  }
  if (this.docked) return t("Docked to another's craft — UNDOCK first");
  this.keepRun = null;
  this.pilot.setAuto("keep");
  return this.pilot.auto === "keep" ? t("Autopilot: station keeping") : t("Autopilot off");
}

/**
 * Station keeping's command (lowthrust.ts ourWant): the velocity that brings the craft back to its held point — the
 * target's centre plus the held offset turned with the target's orbital frame — and the acceleration fed forward (the
 * tide between the two, the frame's turn's pull). Null with a word when nothing is in reach.
 */
function keepWant(
  this: CameraController,
  nav: NonNullable<ReturnType<CameraController["ourNav"]>>,
  say: (t: string) => null,
  out: (v: Vec3, ff?: Vec3) => { beta: Vec3; ff: Vec3 },
): { beta: Vec3; ff: Vec3 } | null {
  const s = this.s;
  const t0 = nav.t;
  if (!this.keepRun) {
    const want = s.target === "iss" || isCraft(s.target) || isNetTarget(s.target) ? (s.target as DockTarget) : null;
    const g0 = (want ? this.dockGeometry({ target: want }) : null) ?? this.dockGeometry();
    if (!g0 || g0.range > KEEP.reach) return say(t("Station keeping: within 5 km of a craft or the station"));
    const frame = (Math.hypot(...g0.om) / M_SECONDS) * (180 / Math.PI) < KEEP_SPIN_MAX ? "body" : "lvlh";
    const F = keepFrame(frame, g0, ourState(nav.ref, t0));
    let rho = lin(sub3(nav.X, g0.tgt.X), M_METRES, nav.X, 0);
    // (after an undocking: the held point further out along the line from the target's centre)
    if (this.keepAway) {
      const rl = Math.hypot(...rho);
      if (rl > 0) rho = lin(rho, (rl + this.keepAway) / rl, rho, 0);
      this.keepAway = 0;
    }
    const title =
      g0.target === "iss" ? "ISS" : isNetTarget(g0.target) ? BODY_NAMES[g0.target as Body] : VESSELS[g0.target as VesselId].name;
    this.keepRun = { target: g0.target, title, frame, at: [dot3(rho, F.ax[0]), dot3(rho, F.ax[1]), dot3(rho, F.ax[2])] };
    this.onPilotMessage?.(tf("Station keeping · {0} · {1} m", title, Math.round(Math.hypot(...rho))));
  }
  const K = this.keepRun;
  const g = this.dockGeometry({ target: K.target });
  if (!g || g.range > 2 * KEEP.reach) return say(tf("Station keeping: the {0} is out of reach", K.title));
  const F = keepFrame(K.frame, g, ourState(nav.ref, t0));
  // the held point now [M], its motion (the frame's turn), the gap to it [m]
  const rhoA = lin(lin(F.ax[0], K.at[0], F.ax[1], K.at[1]), 1 / M_METRES, F.ax[2], K.at[2] / M_METRES);
  const P = lin(g.tgt.X, 1, rhoA, 1);
  const Vp = lin(g.tgt.V, 1, cross(F.w, rhoA), 1);
  const gap = lin(sub3(P, nav.X), M_METRES, P, 0);
  const d = Math.hypot(...gap);
  const sp = keepSpeed(d);
  const want: Vec3 = d > 1e-6 ? lin(gap, sp / d, gap, 0) : [0, 0, 0];
  const ff = lin(sub3(gravityHome(g.tgt.X, t0).acc, gravityHome(nav.X, t0).acc), 1, cross(F.w, cross(F.w, rhoA)), 1);
  this.hubNote = { off: d, drift: Math.hypot(...sub3(nav.V, Vp)) * C_MPS, name: K.title };
  // (the warp no higher than ×10: the thrusters' corrections follow)
  this.setHubWarp(Math.min(s.timeSpeed, KEEP.warp / M_SECONDS));
  return out(lin(Vp, 1, want, 1 / C_MPS), ff);
}

export function installStationKeep(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { keepWant, keepKey, rendezvousStart, inApproachEllipsoid });
}
