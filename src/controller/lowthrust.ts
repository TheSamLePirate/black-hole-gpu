// The CameraController — low thrust, and the views of the flight the interface reads (telemetry, runway, hub, future).
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { nearWormhole, type WormholePath } from "../system/wormhole-predict";
import { tunnelEntrySide, wormholeMapPose } from "../system/wormhole-map";
import { blToCartesian, cameraFrame } from "../camera";
import { horizon, isco, coordToZamo, type Vec3 } from "../physics";
import {
  bodyCentre,
  BODY_NAMES,
  type Body,
  starOrbitRadius,
  bodyVelocity,
  bodyMass,
  bodyRadius,
  bodyHill,
  cameraHome,
  isOurs,
  ourLook,
  ourTarget,
} from "../targeting";
import { fromZamo } from "../geodesic";
import { GARGANTUA_SYSTEM } from "../system/bodies";
import { bodyState } from "../system/ephemeris";
import { accelToG, fuelOn, tank } from "../engine";
import { epicycle, rendezvousPush, type State6 } from "../lowthrust";
import { type Site, SITES } from "../game/sites";
import { elements as kepElements, fromPNR, propagate as kepProp, type V3 as KV3 } from "../fc/kepler";
import { circularize as fcCircularize, type Burn } from "../fc/ops";
import { timeTo as kepTimeTo } from "../fc/kepler";
import { airTopKm } from "../game/place";
import { airTop, entryInterface } from "../aero";
import { AUTO_NAMES, circularSpeed, type Auto, type Want } from "../pilot";
import { fleet } from "../fleet";
import { VESSELS } from "../vessels";
import { mouth, sphericalFrame } from "../wormhole";
import { circularVelocity } from "../system/geopotential";
import { gravityHome, OUR_BODIES, ourState, repToHomeVec, soiOf } from "../system/our-side";
import { predictOurs, type OurPath } from "../system/our-predict";
import { stateAt } from "../system/our-plan";
import { plan as runPlanner } from "../system/plan-client";
import {
  airDensity as ourAir,
  altitudeOver,
  dragAccel,
  figureUp,
  fromBodyFixed,
  gearHeight,
  groundPointOf,
  groundVelocity,
  solidBody,
  toBodyFixed,
} from "../system/our-surface";
import { cartToGeodetic, flatteningOf } from "../system/ellipsoid";
import { bodyAxes, solarBody, solarState } from "../system/solar";
import { C_MPS, DAY_S, G0, M_METRES, M_SECONDS } from "../units";
import { add as axpy, cross, dot as dot3, lin, sub as sub3 } from "../math/vec3";
import { caught } from "../debug";
import { frameNow } from "../frameclock";
import { t, tf } from "../i18n";

import type { CameraController, FutureView, HubInfo, HubRow, LowThrust, RunwayView } from "../controls";
import { LANDING, clamp, fmtDur, landingProfile, smoothstep, spinAxis, unitV, type LandingFix } from "./util";
import { burnGraph, type AssistGraph } from "../ui/hud/graph";
import { entryCorridor, heightOf as heightOfEntry } from "../entry";
import { brakingAccels, descentCommand, descentCurve, V_TD, V_TRANS } from "../descent";

declare module "../controls" {
  interface CameraController {
    planLowThrust: typeof planLowThrust;
    coorbit: typeof coorbit;
    rendezvousGuidance: typeof rendezvousGuidance;
    lineClears: typeof lineClears;
    transferWant: typeof transferWant;
    circularWant: typeof circularWant;
    ourPeriod: typeof ourPeriod;
    targetVelLocal: typeof targetVelLocal;
    maneuverDir: typeof maneuverDir;
    ourWant: typeof ourWant;
    ourSurfaceWant: typeof ourSurfaceWant;
    landWant: typeof landWant;
    levelHeading: typeof levelHeading;
    hubInfo: typeof hubInfo;
    hubCompute: typeof hubCompute;
    climbAssist: typeof climbAssist;
    deorbitAssist: typeof deorbitAssist;
    glideAssist: typeof glideAssist;
    glideCard: typeof glideCard;
    descentAssist: typeof descentAssist;
    approachAssist: typeof approachAssist;
    dockCard: typeof dockCard;
    descentCard: typeof descentCard;
    entryAssist: typeof entryAssist;
    circPlan: typeof circPlan;
    circFlown: typeof circFlown;
    ourCircWant: typeof ourCircWant;
    autopilotWant: typeof autopilotWant;
    predictPath: typeof predictPath;
    driftDir: typeof driftDir;
    runwayView: typeof runwayView;
    runwayCompute: typeof runwayCompute;
    futureView: typeof futureView;
    futureCompute: typeof futureCompute;
    futureSee: typeof futureSee;
    holeLook: typeof holeLook;
    kerrPathFrom: typeof kerrPathFrom;
  }
}

/** Plans a low-thrust transfer (the Crew engine's PLAN TRANSFER); EXECUTE flies it. */
function planLowThrust(this: CameraController, goal: "orbit" | "star" | "wormhole", r2: number, orbitBody: boolean): string {
  const s = this.s;
  const cam = cameraFrame(s);
  if (cam.region !== "hole") return t("Planning works around the black hole");
  const a = this.thrustMax();
  if (!(a > 0)) return t("No thrust: the tank is empty");
  const r0 = cam.r;
  const vc = (r: number) => 1 / Math.sqrt(r);
  const days = (tM: number) => (tM * 4.925490947e-6 * s.massSolar) / 86400;
  let tr: LowThrust;
  let dv = 0;
  let what = "";
  if (goal === "orbit") {
    const rMin = Math.max(isco(s.spin) * 1.02, horizon(s.spin) + 2);
    const r = Math.max(r2, rMin);
    tr = { goal: "orbit", r2: r, stage: "spiral", rs: r };
    dv = Math.abs(vc(r0) - vc(r));
    what = tf("spiral {0} → {1} M, circularize", r0.toFixed(0), r.toFixed(0));
  } else {
    const body: Body =
      goal === "wormhole"
        ? "wormhole"
        : s.system !== "none" && s.target !== "hole" && s.target !== "wormhole" && s.target !== "barycentre"
          ? s.target
          : "star";
    // (tf: `t` is the time in this block)
    if (body === "star" && !s.sun) return tf("No companion star in this scene: select a body (Tab)");
    if (body === "wormhole" && !s.wormhole) return tf("No wormhole in this scene");
    const t = this.nowTime();
    const R = Math.hypot(...bodyCentre(s, body, t));
    const co = 3 / (R * R) >= a; // the hole's pull beats the engine there
    const orbit = orbitBody && bodyMass(s, body) > 0;
    s.target = body;
    if (co) {
      const side = r0 >= R ? 1 : -1;
      tr = { goal: "body", body, orbit, mode: "coorbital", stage: "spiral", rs: R * (1 + 0.1 * side) };
      dv = Math.abs(vc(r0) - vc(R));
      what = tf(
        "spiral {0} → {1} M, phase with {2} (a few more % of Δv), spiral onto its circle",
        r0.toFixed(0),
        (R * (1 + 0.1 * side)).toFixed(1),
        BODY_NAMES[body],
      );
    } else {
      const rFree = Math.min(Math.max(Math.sqrt(3 / a), r0), 0.5 * R);
      const D = R - rFree;
      tr = { goal: "body", body, orbit, mode: "cruise", stage: "spiral", rs: rFree };
      // (and the hole's pull fought along the straight flight: ∫ M/r² dt ≈ (1/r_free − 1/R)/v)
      const vCruise = Math.min(0.05, Math.sqrt(a * D));
      dv = Math.abs(vc(r0) - vc(rFree)) + 2 * vCruise + (1 / rFree - 1 / R) / vCruise;
      what = tf("spiral out to {0} M, then fly {1} M to {2}", rFree.toFixed(0), D.toFixed(0), BODY_NAMES[body]);
    }
    what += orbit ? tf(", orbit it") : tf(", keep station");
  }
  this.plan = { nodes: [], path: null, at: 0, note: "" };
  this.transfer = tr;
  const w = Math.atanh(Math.min(dv, 0.999));
  const budget = fuelOn(s) ? tank(s, this.spent) : null;
  const over = !budget
    ? ""
    : w > budget.left
      ? ` — ⚠ ${tf("over the propellant left ({0})", budget.left.toFixed(3))}`
      : ` — ${tf("≈ {0}% of the tank", Math.round((100 * w) / Math.max(budget.budget, 1e-12)))}`;
  tr.note =
    tf(
      "Low thrust at {0} g: {1} · Δv ≈ {2} c, ≥ {3} d of burning",
      accelToG(a, s).toFixed(1),
      what,
      dv.toFixed(3),
      days(dv / a).toFixed(0),
    ) + over;
  return tf("Plan: {0}", tr.note);
}

/**
 * Meeting a body on its circle around the hole: its radius, the phase it is ahead of the ship, and
 * the angular rate of circles.
 */
function coorbit(this: CameraController, body: Body, cam: ReturnType<typeof cameraFrame>, a: number) {
  const s = this.s;
  const C = bodyCentre(s, body, this.nowTime());
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const R = Math.hypot(...C);
  const om = (x: number) => 1 / (x ** 1.5 + Math.abs(s.spin));
  const dphi = Math.atan2(
    Math.sin(Math.atan2(C[1], C[0]) - Math.atan2(X[1], X[0])),
    Math.cos(Math.atan2(C[1], C[0]) - Math.atan2(X[1], X[0])),
  );
  return {
    R,
    dphi,
    om,
  };
}

/**
 * The last stretch to a body on its circle: the minimum-energy push of the linear relative motion
 * (Kerr's epicycles about the body — the hole's tide and the frame's turning in closed form, see
 * lowthrust.ts), re-solved every frame with the time left; that time is set at the start as the
 * shortest for which the push stays within half the engine. Null once there (the orbit / approach
 * autopilot takes over).
 */
function rendezvousGuidance(this: CameraController, T: LowThrust, cam: ReturnType<typeof cameraFrame>, a: number): Vec3 | null {
  if (T.goal !== "body") return null;
  const s = this.s;
  const t = this.nowTime();
  const C = bodyCentre(s, T.body, t);
  const R = Math.hypot(...C);
  const ep = epicycle(R, Math.abs(s.spin));
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const f = sphericalFrame(X);
  const Vs = this.fromZamo(cam, f, cam.beta);
  // curvilinear coordinates about the body: x = ϖ − R, y = R Δφ, z
  const rc = Math.hypot(X[0], X[1]);
  const eR: Vec3 = [X[0] / rc, X[1] / rc, 0],
    eP: Vec3 = [-X[1] / rc, X[0] / rc, 0];
  const dph = Math.atan2(X[1], X[0]) - Math.atan2(C[1], C[0]);
  const st: State6 = [rc - R, R * Math.atan2(Math.sin(dph), Math.cos(dph)), X[2], dot3(Vs, eR), R * (dot3(Vs, eP) / rc - ep.n), Vs[2]];
  // the meeting point: on the body's circle, a few Hill radii behind or ahead of it (on the ship's
  // side) — at rest there relative to it, where the orbit / approach autopilot takes over
  const Rb = bodyRadius(s, T.body);
  const hill = bodyHill(s, T.body, t) || 3 * Rb;
  const stand = Math.max(1.5 * hill, 15 * Rb);
  if (T.side === undefined) T.side = st[1] >= 0 ? 1 : -1;
  const rs: State6 = [st[0], st[1] - T.side * stand, st[2], st[3], st[4], st[5]];
  const dist = Math.hypot(rs[0], rs[1], rs[2]);
  const rel = Math.hypot(st[3], st[4], st[5]);
  if (dist < 0.5 * stand && rel < Math.max(Math.sqrt(a * stand), 1e-6)) return null;
  const push = (tg: number) => rendezvousPush(ep, rs, tg);
  if (T.tEnd === undefined) {
    let best = Infinity,
      tg0 = 2 / ep.n;
    for (let tg = 0.5 / ep.n; tg < 60 / ep.n; tg *= 1.15) {
      const p = push(tg);
      const m = p ? Math.hypot(...p) : Infinity;
      if (m <= 0.5 * a) {
        tg0 = tg;
        break;
      }
      if (m < best) (best = m), (tg0 = tg);
    }
    T.tEnd = t + tg0;
  }
  const tgo = T.tEnd - t;
  // (the time is up: hand over wherever it is)
  if (tgo < (3 * s.timeSpeed) / 30) return null;
  const A = push(tgo);
  if (!A) return null;
  // local components; coordinate acceleration → proper (× (dt/dτ)² of the body's orbit)
  const Aw = lin(lin(eR, A[0], eP, A[1]), 1, [0, 0, 1], A[2]);
  const k = ep.ut ** 2;
  const loc: Vec3 = [dot3(Aw, f.er) * k, dot3(Aw, f.et) * k, dot3(Aw, f.ep) * k];
  const L = Math.hypot(...loc);
  return L > a ? lin(loc, a / L, loc, 0) : loc;
}

/** The straight segment X → C passes the hole no closer than dMin. */
function lineClears(this: CameraController, X: Vec3, C: Vec3, dMin: number) {
  const d = sub3(C, X);
  const u = clamp(-dot3(X, d) / Math.max(dot3(d, d), 1e-30), 0, 1);
  return Math.hypot(...lin(X, 1, d, u)) >= dMin;
}

/** The transfer's goal for the pilot at this stage (stages advance by themselves). */
function transferWant(
  this: CameraController,
  cam: ReturnType<typeof cameraFrame>,
  say: (t: string) => null,
): { beta: Vec3; ff: Vec3 } | null {
  const s = this.s;
  const T = this.transfer;
  if (!T) return say(t("No low-thrust transfer planned (PLAN with the Crew engine)"));
  if (cam.region !== "hole") return say(t("Low-thrust transfer: only around the black hole"));
  const a = this.thrustMax();
  if (!(a > 0)) return say(t("Transfer stopped: the tank is empty"));
  // (it flies itself at the highest warp the rails allow)
  if (T.warp === undefined) T.warp = s.timeSpeed;
  this.setHubWarp(Math.min(1e5, this.railsLimit(cam).lim));
  const r = cam.r;
  const b = cam.beta;
  // tangential direction (local), in the sense of the motion
  let tv: Vec3 = [0, b[1], b[2]];
  const tl = Math.hypot(...tv);
  tv = tl > 1e-6 ? lin(tv, 1 / tl, tv, 0) : [0, 0, 1];
  const coast = { beta: b, ff: [0, 0, 0] as Vec3 };
  const next = (st: LowThrust["stage"]) => {
    T.stage = st;
    T.gap = undefined;
    T.up = undefined;
    T.tol = undefined;
    T.tEnd = undefined;
  };
  // (a body on Gargantua's equator: the orbit's tilt is damped all along — a push against the
  // vertical velocity, which swings with the tilt twice a turn — so the ship arrives in its plane)
  const tilt = (ff: Vec3): Vec3 => (T.goal !== "body" ? ff : [ff[0], ff[1] - 0.5 * a * clamp(b[1] / 0.005, -1, 1), ff[2]]);
  // a circle's velocity as the goal (its vertical part left to the damping)
  const round = (c: { beta: Vec3; ff: Vec3 }) => (T.goal !== "body" ? c : { beta: [c.beta[0], b[1], c.beta[2]] as Vec3, ff: tilt(c.ff) });
  const finish = (auto: Auto, msg: string) => {
    this.transfer = null;
    // (a cruise still has the long straight flight ahead: the rails keep the warp until the orbit)
    if (T.goal === "body" && T.mode === "cruise") this.warpAfter = Math.min(T.warp ?? 4, 50);
    else this.giveBackWarp(Math.min(T.warp ?? 4, 50));
    this.pilot.auto = "none";
    this.pilot.setAuto(auto);
    this.onPilotMessage?.(msg);
    return null;
  };
  // Newtonian osculating orbit (the spiral's stop: apoapsis or periapsis at the goal when the
  // engine is strong for the place; the radius itself when it is weak and the orbit stays round)
  const osc = () => {
    const vr = b[0],
      vt = tl;
    const e = 0.5 * (vr * vr + vt * vt) - 1 / r;
    if (e >= 0) return { pe: r, ap: Infinity };
    const sma = -1 / (2 * e),
      ecc = Math.sqrt(Math.max(0, 1 + 2 * e * (r * vt) ** 2));
    return { pe: sma * (1 - ecc), ap: sma * (1 + ecc) };
  };
  if (T.stage === "spiral") {
    if (T.up === undefined) T.up = T.rs > r;
    // (the rails slow the last part of a spiral down: it stops within tol of its radius)
    if (T.tol === undefined) T.tol = 0.002 * T.rs;
    const up = T.up;
    const o = osc();
    // (a cruise leaves from where the engine beats the hole: the radius itself must be reached)
    const strong = a > 0.3 / (r * r) && !(T.goal === "body" && T.mode === "cruise");
    // (the radius reached as the circle will round it: the spiral's drift outwards (inwards) still to
    // take out at the engine's acceleration — vr²/2a further —, not where the climb stops: at 2 g the
    // circle once rounded 5 M beyond the 45 asked)
    const run = (b[0] * b[0]) / (2 * Math.max(a, 1e-12));
    const reached = up ? r + run >= T.rs : r - run <= T.rs;
    let done = reached || (strong && (up ? o.ap >= T.rs : o.pe <= T.rs));
    if (done && T.goal === "body" && T.mode === "cruise") {
      // (a cruise also waits, still climbing, for a straight line to the body that clears the hole
      // — at half the way there it stops climbing and waits on its circle)
      const C = bodyCentre(s, T.body, this.nowTime());
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      const clear = this.lineClears(X, C, 0.5 * r);
      if (clear) {
        next("final");
        return { beta: b, ff: [0, 0, 0] };
      }
      done = r >= 0.5 * Math.hypot(...C);
    }
    // (the circle's speed here as the goal — the pilot keeps the orbit round — and the tangential
    // push on top: a spiral of near-circular turns)
    if (!done) {
      const c = this.circularWant(cam);
      // (with the drift a tangential push gives a circular orbit: dr/dt = ±2 a r^{3/2})
      const want: Vec3 = typeof c === "string" ? b : [clamp((up ? 2 : -2) * a * r ** 1.5, -0.1, 0.1), c.beta[1], c.beta[2]];
      return { beta: [want[0], b[1], want[2]], ff: tilt(lin(tv, up ? a : -a, tv, 0)) };
    }
    // (stopped on the orbit's apsis, not on the radius: coast there, then round the orbit)
    if (!reached) {
      const u = !!up;
      next("coast");
      T.up = u;
    } else next("circ");
  }
  if (T.stage === "coast") {
    if (T.up ? b[0] > 0 : b[0] < 0) return { beta: b, ff: tilt([0, 0, 0]) };
    next("circ");
  }
  if (T.stage === "circ") {
    const c0 = this.circularWant(cam);
    if (typeof c0 === "string") return say(c0);
    const c = round(c0);
    const err = Math.hypot(...sub3(c.beta, b));
    if (err > 2e-3 * Math.hypot(...c.beta)) return c;
    if (T.goal === "orbit") return finish("circularize", tf("Transfer done — circular orbit at {0} M", r.toFixed(1)));
    if (T.mode === "cruise") next("wait");
    else {
      // co-orbital: on the body's circle and close enough behind or ahead of it — the final
      // approach; on the circle but far — a parking circle a little off it (lower to catch up,
      // higher to let it come), sized so the drift takes a few turns; off the circle — drift
      // until the spiral back meets the body. Each round shrinks the offset tenfold or so.
      const g = this.coorbit(T.body, cam, a);
      // (the relative guidance re-solves every frame: it can start a little off the circle)
      const near = Math.abs(r - g.R) < 0.05 * g.R;
      if (near && Math.abs(g.dphi) < 0.15) next("rdv");
      else if (!near) next("drift");
      else {
        const d = -Math.sign(g.dphi) * clamp(Math.abs(g.dphi) / (9 * Math.PI), 0.004, 0.1);
        T.rs = g.R * (1 + d);
        next("spiral");
        return c;
      }
    }
  }
  if (T.goal !== "body") return coast;
  if (T.stage === "wait") {
    // (cruise: leave from the body's side of the hole — the straight flight must not pass it)
    const C = bodyCentre(s, T.body, this.nowTime());
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    if (!this.lineClears(X, C, 0.5 * cam.r)) {
      const c = this.circularWant(cam);
      return typeof c === "string" ? coast : round(c);
    }
    next("final");
  }
  if (T.stage === "drift") {
    // the gap left once the spiral back onto the circle has gained its share: start that spiral
    // when it crosses zero (coasting on the parking circle meanwhile)
    const g = this.coorbit(T.body, cam, a);
    const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    const tBack = Math.abs(1 / Math.sqrt(r) - 1 / Math.sqrt(g.R)) / a;
    const gap = wrap(g.dphi - 0.5 * (g.om(r) - g.om(g.R)) * tBack);
    const prev = T.gap;
    T.gap = gap;
    if (!(prev !== undefined && Math.abs(gap) < 0.5 && Math.sign(gap) !== Math.sign(prev))) return { beta: b, ff: tilt([0, 0, 0]) };
    T.rs = g.R;
    next("spiral");
    return { beta: b, ff: [0, 0, 0] };
  }
  if (T.stage === "rdv") {
    const g = this.rendezvousGuidance(T, cam, a);
    if (g) return { beta: b, ff: g };
    next("final");
  }
  if (T.stage === "final") {
    const name = BODY_NAMES[T.body];
    if (T.orbit) return finish("orbit", tf("Transfer done — closing in on {0}, then in orbit", name));
    return finish("approach", tf("Transfer done — closing in on {0}, then station-keeping", name));
  }
  return coast;
}

/** The circular orbit's velocity here, in the plane the ship moves in (or why there is none). */
function circularWant(this: CameraController, cam: ReturnType<typeof cameraFrame>): { beta: Vec3; ff: Vec3 } | string {
  const s = this.s;
  const b = cam.beta;
  let t: Vec3 = [0, b[1], b[2]];
  let tl = Math.hypot(...t);
  if (tl < 1e-4) (t = [0, 0, s.spin >= 0 ? 1 : -1]), (tl = 1);
  t = lin(t, 1 / tl, t, 0);
  const pro = t[2] * (s.spin >= 0 ? 1 : -1) >= 0;
  const v = circularSpeed(cam.r, Math.abs(s.spin), pro, cam.zamo);
  if (v === null) return tf("No circular orbit here: inside the photon orbit");
  // the equatorial formula is only a first guess off the equator: the circular speed is the one
  // whose free fall has no radial acceleration (a_r linear in v² — two probes)
  const v1 = Math.abs(v),
    v2 = Math.min(1.05 * v1, 0.999);
  const a1 = this.freeFallAccel(cam, lin(t, v1, t, 0))[0];
  const a2 = this.freeFallAccel(cam, lin(t, v2, t, 0))[0];
  const vc = a2 !== a1 ? Math.sqrt(clamp(v1 * v1 - (a1 * (v2 * v2 - v1 * v1)) / (a2 - a1), 0, 0.998)) : v1;
  return { beta: lin(t, vc, t, 0), ff: [0, 0, 0] };
}

/** A turn of the ship's orbit around its reference body (the Kepler period; unbound: a day). */
function ourPeriod(this: CameraController, nav: NonNullable<ReturnType<CameraController["ourNav"]>>) {
  const mb = OUR_BODIES.find((b) => b.id === nav.ref)?.mass ?? 1e-8;
  const r = Math.hypot(...sub3(nav.X, nav.refPos));
  const v = sub3(nav.V, nav.refVel);
  const eps = dot3(v, v) / 2 - mb / r;
  return eps < 0 ? 2 * Math.PI * Math.sqrt((-mb / (2 * eps)) ** 3 / mb) : DAY_S / M_SECONDS;
}

/** The target's velocity as a local 3-velocity (ZAMO near the hole, rep on our side). */
function targetVelLocal(this: CameraController, cam: ReturnType<typeof cameraFrame>): Vec3 | null {
  const s = this.s;
  if (s.target === "hole") return [0, 0, 0];
  const nav = this.ourNav(cam);
  if (nav) return nav.toRep(ourTarget(s, s.target, nav.t).vel);
  if (cam.region !== "hole") return null;
  const V = bodyVelocity(s, s.target, this.nowTime());
  const f = sphericalFrame(blToCartesian(cam.r, cam.theta, cam.phi));
  return coordToZamo([dot3(V, f.er), dot3(V, f.et), dot3(V, f.ep)], cam.r, cam.theta, cam.zamo);
}

/** The next manoeuvre node's burn direction (local), for the NODE hold and the navball. */
function maneuverDir(this: CameraController, cam: ReturnType<typeof cameraFrame>): Vec3 | null {
  if (this.nodeBurning && this.burnDir) return this.burnDir;
  const n = this.plan.nodes[0];
  if (!n) return null;
  const v = this.nodeDirLocal ? this.nodeDirLocal(cam, n) : null;
  return v;
}

/**
 * Our universe's autopilots (Newton, home frame; wanted velocities returned as local rep vectors):
 *  - approach: towards the target at the speed that still stops at the stand-off with 60 % of the
 *    engine (accelerate, then brake: a brachistochrone), the side drift cancelled; the warp set for
 *    an arrival in ~8 s, the pilot's given back there; a body with a mass: then its orbit;
 *  - orbit: a circle around the target, at the height it is engaged at (from far: low orbit, above
 *    its air), in the plane of the ship's motion;
 *  - hover: at rest against the reference body where engaged, the pull cancelled.
 */
function ourWant(this: CameraController, cam: ReturnType<typeof cameraFrame>, say: (t: string) => null, T: number): Want | null {
  const s = this.s;
  const P = this.pilot;
  const nav = this.ourNav(cam)!;
  const t = nav.t;
  const g = gravityHome(nav.X, t);
  const thr = this.thrustMax();
  const out = (v: Vec3, ff: Vec3 = [0, 0, 0]) => ({ beta: nav.toRep(v), ff: nav.toRep(ff) });
  if (P.auto === "hover") {
    // (by the mouth — targeted, within a few of its stand-offs: at rest against it)
    const byMouth = !isOurs(s.target) && Math.hypot(...nav.X) < 0.5;
    // low over a ground: the place over it held, carried by the ground's turning (at rest against the
    // body's centre the Moon's ground slides 4.6 m/s under it, the Earth's 400), the craft level on its
    // vectored thrust — a hover before a landing
    if (!byMouth && nav.ref !== "sun" && solidBody(nav.ref) && gearHeight(nav.ref, nav.X, t) < HOVER_LOW) {
      const id = nav.ref;
      const key = `ground:${id}`;
      if (this.ourAnchor?.ref !== key) this.ourAnchor = { ref: key, d: toBodyFixed(id, nav.X, t) };
      const up = figureUp(id, nav.X, t);
      const at = fromBodyFixed(id, this.ourAnchor.d, t);
      const back = sub3(at, nav.X);
      const gv = groundVelocity(id, at, t);
      this.hubNote = { off: Math.hypot(...back) * M_METRES, drift: Math.hypot(...sub3(nav.V, groundVelocity(id, nav.X, t))) * C_MPS };
      const k = Math.min(1 / (4 * T), 0.3 * Math.sqrt(thr / Math.max(Math.hypot(...back), 1e-15)));
      const ff = lin(lin(g.acc, 1, dragAccel(id, nav.X, nav.V, t), 1), -1, g.acc, 0);
      this.ourAnchor.heading ??= this.levelHeading(up);
      const nose = unitV(lin(this.ourAnchor.heading, 1, up, -dot3(this.ourAnchor.heading, up)));
      return { ...out(lin(gv, 1, back, k), ff), att: { nose: unitV(nav.toRep(nose)), up: unitV(nav.toRep(up)), vectored: true } };
    }
    const refId = byMouth ? "mouth" : nav.ref;
    const ref = byMouth ? { pos: [0, 0, 0] as Vec3, vel: [0, 0, 0] as Vec3 } : ourState(nav.ref, t);
    if (!this.ourAnchor || this.ourAnchor.ref !== refId) this.ourAnchor = { ref: refId, d: sub3(nav.X, ref.pos) };
    const back = sub3(lin(ref.pos, 1, this.ourAnchor.d, 1), nav.X);
    this.hubNote = { off: Math.hypot(...back) * M_METRES, drift: Math.hypot(...sub3(nav.V, ref.vel)) * C_MPS };
    const k = Math.min(1 / (4 * T), 0.3 * Math.sqrt(thr / Math.max(Math.hypot(...back), 1e-15)));
    return out(lin(ref.vel, 1, back, k), lin(g.acc, -1, g.acc, 0));
  }
  this.ourAnchor = null;
  if (P.auto === "land" || P.auto === "takeoff") return this.ourSurfaceWant(nav, g, say, out, T);
  if (P.auto === "dock") return this.dockWant(nav, say, out);
  if (P.auto !== "approach" && P.auto !== "orbit" && P.auto !== "circularize")
    return say(tf("{0}: not in our universe (yet)", AUTO_NAMES[P.auto]));
  // (circularize: around the body of the sphere of influence, at the height it is engaged at)
  const circ = P.auto === "circularize";
  const tgt = (circ ? nav.ref : s.target) as Body;
  const Tg = ourTarget(s, tgt, t);
  const d = sub3(Tg.pos, nav.X);
  const D = Math.hypot(...d);
  const dh = lin(d, 1 / Math.max(D, 1e-30), d, 0);
  const rel = sub3(nav.V, Tg.vel);
  const sb = OUR_BODIES.find((b) => b.id === tgt);
  const soi = sb && sb.id !== "sun" ? soiOf(tgt, t) : Infinity;
  const air = GARGANTUA_SYSTEM.bodies.find((b) => b.id === tgt)?.surface?.atmosphere;
  // (a low orbit: 10 % of the radius, above 12 scale heights of air)
  const low = Tg.radius * 1.1 + (air ? (12 * air.H) / M_METRES : 0);
  if (P.auto === "orbit" && !(Tg.mass > 0)) return say(tf("Orbit: select a body with a mass"));
  if (circ) return this.ourCircWant(nav, Tg, say, out);
  const orbiting = P.auto === "orbit" && D < Math.min(soi, 50 * Tg.radius) && D > Tg.radius;
  if (orbiting) {
    // (the height held: where it was engaged, if that orbit is clear — of the ground by 1 %, of the air
    // (aero.ts airTop) —, as the rails judge a stable orbit; it once raised every orbit to the approach's
    // stand-off, 10 % of the radius: the Moon's 100 km to 174, 334 m/s spent)
    const atm = solarBody(tgt)?.atmosphere;
    const clear = Tg.radius * 1.01 + (atm ? airTop(atm) / M_METRES : 0) + (air ? (12 * air.H) / M_METRES : 0);
    // (the circle's own: the body's mean circle through the craft — its oblateness in (geopotential.ts
    // meanCircular), its radius r₀ about which the craft swings —, not √(μ/r) level at r: the Earth's J2
    // had the hold push 57 m/s in two hours against the circle it flies)
    const mean = circularVelocity(tgt, Tg.mass, lin(d, -1, d, 0), rel, t);
    if (!this.ourOrbitR || this.ourOrbitR.body !== tgt)
      this.ourOrbitR = { body: tgt, r: circ ? Math.max(D, Tg.radius * 1.01) : Math.max(mean.r0, clear) };
    const r = this.ourOrbitR.r;
    const Rh = lin(dh, -1, dh, 0);
    let n = cross(Rh, rel);
    if (Math.hypot(...n) < 1e-12 * Math.hypot(...rel) || Math.hypot(...rel) < 1e-15) n = cross(Rh, [0, 0, 1]);
    if (Math.hypot(...n) < 1e-12) n = cross(Rh, [1, 0, 0]);
    n = lin(n, 1 / Math.hypot(...n), n, 0);
    const th = cross(n, Rh);
    const vc = Math.sqrt(Tg.mass / D);
    this.hubNote = { name: BODY_NAMES[tgt] ?? tgt, orbitAlt: (r - Tg.radius) * M_METRES };
    // (the height held: a gentle radial pull back, a small part of the circular speed)
    const vr = Math.max(-0.2, Math.min(0.2, (r - mean.r0) / (0.1 * r))) * vc * 0.5;
    return out(lin(lin(Tg.vel, 1, Math.abs(mean.r0 - r) < 1e-3 * r ? mean.v : lin(th, vc, th, 0), 1), 1, Rh, vr));
  }
  this.ourOrbitR = null;
  // approach: the stand-off, and the speed that still stops there
  const stand = Tg.mass > 0 ? (P.auto === "orbit" ? low : Math.max(3 * Tg.radius, low)) : Math.max(3 * Tg.radius, 1e-5);
  const left = D - stand;
  const a = 0.6 * thr;
  const vmax = s.engine === "crew" ? 0.2 : 0.5;
  const vClose = Math.min(vmax, Math.sqrt(2 * a * Math.max(left, 0)));
  const closing = -dot3(rel, dh);
  // (arrived: within a tenth of the stand-off, slower than a fifth of the orbital speed there — or,
  // no mass, than what the engine stops over a tenth of it)
  const vArrive = Math.max(Math.sqrt(Tg.mass / Math.max(D, 1e-30)), Math.sqrt(2 * 0.6 * thr * 0.1 * stand)) * 0.2;
  if (Math.abs(left) < 0.1 * stand && D > Tg.radius && Math.hypot(...rel) < vArrive) {
    // (the rails forget the approach's warps: not a wish of the pilot's)
    this.giveBackWarp(this.ourWarp ?? s.timeSpeed);
    this.ourWarp = null;
    if (Tg.mass > 0) {
      P.setAuto("orbit");
      this.onPilotMessage?.(tf("In orbit around {0}", BODY_NAMES[tgt]));
    } else {
      P.setAuto("hover");
      this.onPilotMessage?.(tf("Arrived: {0}", BODY_NAMES[tgt]));
    }
    return out(Tg.vel);
  }
  // the warp: an arrival in ~8 s (the rails still hold it near bodies); the pilot's wish kept
  // (no Zeno ending: the last twentieth of the stand-off at the pace of a braking over it)
  const ttg = (Math.abs(left) + 0.05 * stand) / Math.max(Math.abs(closing), vClose * 0.5, Math.sqrt(2 * 0.6 * thr * 0.05 * stand), 1e-12);
  this.hubNote = {
    left: left * M_METRES,
    closing: -closing * C_MPS,
    ttg: ttg * 4.925490947e-6 * s.massSolar,
    stand: stand * M_METRES,
    name: BODY_NAMES[tgt] ?? tgt,
  };
  if (this.ourWarp === null) this.ourWarp = s.timeSpeed;
  this.setHubWarp(Math.min(Math.max(ttg / 8, 1e-4), Math.max(this.railsLimit(cam).lim, 1e-4), 1e5));
  let want = lin(Tg.vel, 1, dh, left >= 0 ? vClose : -Math.min(vmax, Math.sqrt(2 * a * -left)));
  // (never through a planet: near the body of the sphere of influence — not the target — the part
  // of the wanted motion that dives towards it is taken off: the ship climbs, spiralling out)
  if (nav.ref !== tgt && nav.ref !== "sun") {
    const rb = OUR_BODIES.find((b) => b.id === nav.ref)?.radius ?? 0;
    const Rv = sub3(nav.X, nav.refPos);
    const Rd = Math.hypot(...Rv);
    if (Rd < 10 * rb) {
      const Rh = lin(Rv, 1 / Rd, Rv, 0);
      const u = sub3(want, nav.refVel);
      const ur = dot3(u, Rh);
      if (ur < 0) want = lin(want, 1, Rh, -ur);
    }
  }
  return out(want);
}

function ourSurfaceWant(
  this: CameraController,
  nav: NonNullable<ReturnType<CameraController["ourNav"]>>,
  g: ReturnType<typeof gravityHome>,
  say: (t: string) => null,
  out: (v: Vec3, ff?: Vec3) => { beta: Vec3; ff: Vec3 },
  T: number,
) {
  const P = this.pilot;
  const id = nav.ref;
  const what = P.auto === "land" ? t("Landing") : t("Take-off");
  const name = BODY_NAMES[id as Body] ?? id;
  if (id === "sun" || !solidBody(id)) return say(tf("{0}: get near a body with a ground first ({1} has none)", what, name));
  if (!VESSELS[fleet.active].lands)
    return say(tf("{0}: the {1} never lands — it was built in orbit (the Ranger and the Lander land)", what, VESSELS[fleet.active].name));
  const sb = solarBody(id)!;
  const Pb = nav.refPos;
  const r = Math.hypot(...sub3(nav.X, Pb));
  const up = figureUp(id, nav.X, nav.t);
  const h = Math.max(gearHeight(id, nav.X, nav.t), 0) / M_METRES;
  const gw = sb.mass / (r * r);
  const thr = this.thrustMax();
  if (thr < 1.05 * gw) {
    const gU = C_MPS ** 2 / M_METRES / G0;
    return say(
      tf("{0}: the engine ({1} g) cannot hold the weight on {2} ({3} g)", what, (thr * gU).toFixed(1), name, (gw * gU).toFixed(2)),
    );
  }
  // (held against gravity and, in the air, its drag)
  const ff = lin(lin(g.acc, 1, dragAccel(id, nav.X, nav.V, nav.t), 1), -1, g.acc, 0);
  const gv = groundVelocity(id, nav.X, nav.t);
  if (P.auto === "land") {
    if (this.ourLanded) {
      P.setAuto("land");
      this.onPilotMessage?.(tf("Landed on {0}", name));
      return null;
    }
    return this.landWant(nav, g, out, ff, T);
  }
  // take-off
  const LG = this.launchGoal;
  const d0 = climbTop(id, LG.altKm);
  const east = launchEast(id, sub3(nav.X, Pb), LG.incDeg);
  const vc = Math.sqrt(sb.mass / r);
  const vi = sub3(nav.V, nav.refVel);
  // (done: steered, at the top, the speed across the vertical the circular one's to 0.5 % — its east part only,
  // within 8 %, ran the burn on 2 s past it, the apoapsis 50 km high)
  const viH = lin(vi, 1, up, -dot3(vi, up));
  const doneOut =
    steerShare(sb.atmosphere?.H, h * M_METRES, thr, sb.mass / sb.radius ** 2) > 0 &&
    r >= d0 - 0.003 * (d0 - sb.radius) &&
    Math.hypot(...viH) >= 0.995 * vc;
  if (doneOut || (r >= d0 && Math.abs(dot3(vi, east) / vc - 1) < 0.08)) {
    P.auto = "none";
    P.setAuto("circularize");
    this.onPilotMessage?.(tf("In orbit around {0}", name));
    return null;
  }
  // (inertial east speed: the ground already gives its turning at lift-off)
  const vGroundE = dot3(sub3(gv, nav.refVel), east);
  const { vUp, vEastAir, f } = climbCmd(id, thr, this.dragPerMass(), d0, vGroundE, r, h, dot3(vi, east));
  // (an inclination asked: the ground's own turn across the launch's heading taken off as the craft
  // climbs — else it is left in the orbit, which then comes out flatter)
  let want = lin(lin(gv, 1, up, vUp), 1, east, vEastAir);
  // out of the air (steerShare): the thrust steered — the time to the top's circular speed, the climb's
  // acceleration linear in time that brings the craft to the top's height then with no more speed up
  // (steerUp). Flown by the velocity law, the east speed's error (2 km/s) took the thrust and the climb's
  // (500 m/s) almost none: up at 790 m/s past the top, the orbit 409 km for 300
  const w = steerShare(sb.atmosphere?.H, h * M_METRES, thr, sb.mass / sb.radius ** 2);
  let hold = ff;
  if (w > 0) {
    const vcT = Math.sqrt(sb.mass / d0);
    const vh = dot3(vi, east);
    // (the speed still to gain across the vertical: up to the top's circular along the launch's heading, and
    // what lies off its plane taken off — the ground's own turn, an inclination asked)
    const gain = lin(east, vcT, viH, -1);
    const sUp = steerUp(Math.hypot(...gain), thr, d0 - r, dot3(vi, up), Math.max(gw - (vh * vh) / r, 0));
    const dir = lin(up, sUp, unitV(gain), Math.sqrt(1 - sUp * sUp));
    // (a velocity far along it: the whole thrust there)
    const steer = lin(nav.V, 1, dir, Math.max(Math.hypot(...gain), 50 / C_MPS));
    want = lin(want, 1 - w, steer, w);
    hold = lin(ff, 1 - w, ff, 0);
  }
  if (LG.incDeg !== null) {
    const gi = sub3(gv, nav.refVel);
    const across = lin(lin(gi, 1, east, -dot3(gi, east)), 1, up, -dot3(gi, up));
    want = lin(want, 1, across, -f * (1 - w));
  }
  return out(want, hold);
}

/**
 * The powered landing (descent.ts): its pad — the site handed over (the Lander's entry, a descent to a site
 * on an airless world) while within reach, else the place under the craft once it is slow —, the guidance's
 * velocity over the ground flown with the weight held first (and, fast, the motion's own centrifugal
 * taken off it: an orbit holds itself up), the descent rate's correction riding with that hold — never
 * pushing the craft down —, the curves' decelerations fed forward. Far and fast (an orbit) it coasts, the
 * time sped up, its descent orbit burned half a turn before the braking; low and slow the thrust is
 * vectored, the craft level on a heading (its gear under its belly).
 */
function landWant(
  this: CameraController,
  nav: NonNullable<ReturnType<CameraController["ourNav"]>>,
  g: ReturnType<typeof gravityHome>,
  out: (v: Vec3, ff?: Vec3) => { beta: Vec3; ff: Vec3 },
  hold: Vec3,
  T: number,
): Want {
  const id = nav.ref;
  const t0 = nav.t;
  const C = C_MPS;
  const acc = (C * C) / M_METRES; // [m/s² per c²/M]
  const Msec = 4.925490947e-6 * this.s.massSolar;
  const rel = sub3(nav.X, nav.refPos);
  const up = figureUp(id, nav.X, t0);
  const h = Math.max(gearHeight(id, nav.X, t0), 0);
  const gv = groundVelocity(id, nav.X, t0);
  const va = sub3(nav.V, gv);
  const vi = sub3(nav.V, nav.refVel);
  if (this.landRun?.body !== id) this.landRun = { body: id, site: null, q: null, heading: null, cmd: null };
  const L = this.landRun;
  // (a site too far for a hover's translation — and not an orbit's coast — let go: here)
  const sitePlace = (q: { lat: number; lon: number }) => fromBodyFixed(id, groundPointOf(id, q.lat, q.lon), t0);
  const vhSI = Math.hypot(...lin(va, 1, up, -dot3(va, up))) * C;
  if (L.site && vhSI < 200 && Math.hypot(...sub3(sitePlace(L.site), nav.X)) * M_METRES > 30e3) {
    this.onPilotMessage?.(tf("Landing: {0} out of reach — down here", L.site.name));
    L.site = null;
  }
  // (here: the place under the craft held once it is slow)
  if (!L.site && !L.q && vhSI < 3) L.q = toBodyFixed(id, lin(nav.X, 1, up, -h / M_METRES), t0);
  const padX = L.site ? sitePlace(L.site) : L.q ? fromBodyFixed(id, L.q, t0) : null;
  // the weight the engine holds: gravity less the centrifugal of the motion over the body (an orbit's
  // speed holds itself up)
  const vih = lin(vi, 1, up, -dot3(vi, up));
  const centri = dot3(vih, vih) / Math.hypot(...rel);
  const ffHold = lin(hold, 1, up, -centri);
  const gHold = Math.max(dot3(ffHold, up), 0) * acc;
  const cmd = descentCommand({
    up,
    h,
    v: lin(va, C, va, 0),
    g: gHold,
    aT: this.thrustMax() * acc,
    pad: padX ? lin(sub3(padX, nav.X), M_METRES, padX, 0) : null,
    orbit: { mu: solarBody(id)!.mass * acc * M_METRES ** 2, r: lin(rel, M_METRES, rel, 0), vi: lin(vi, C, vi, 0) },
    wasVectored: !!L.cmd?.vectored,
    braking: L.braking,
  });
  L.cmd = cmd;
  // (braking once below the air's top half — an orbit's coast to its braking stays a coast up there)
  if (!cmd.coast && !cmd.doi && h * M_METRES < 30e3) L.braking = true;
  // the time: sped up while it coasts — to some twenty seconds before the braking, or the descent orbit's
  // burn —, real time while it flies
  this.setHubWarp((cmd.coast ? Math.min(1000, Math.max((cmd.tBrake - 25) / 3, 1)) : 1) / Msec);
  // (the burns' attitude: retrograde while it waits — the braking starts with the nose on it)
  const retro = unitV(lin(va, -1, va, 0));
  if (cmd.coast) return { ...out(nav.V), att: { nose: unitV(nav.toRep(retro)), up: unitV(nav.toRep(up)), vectored: false } };
  if (cmd.doi) return out(lin(gv, 1, cmd.doi, 1 / C));
  const vv = dot3(va, up);
  // (the descent rate: its correction with the hold — the engine never pushing down)
  const corr = Math.max((-cmd.down / C - vv) / T + cmd.ffUp / acc, -dot3(ffHold, up));
  const ff = lin(lin(ffHold, 1, up, corr), 1, cmd.ffH, 1 / acc);
  const want = lin(lin(gv, 1, cmd.vh, 1 / C), 1, up, vv);
  if (!cmd.vectored) return out(want, ff);
  // low and slow: level on a heading (the craft coming out of a rocket's braking, nose up: where its belly faced)
  L.heading ??= this.levelHeading(up);
  const nose = unitV(lin(L.heading, 1, up, -dot3(L.heading, up)));
  return { ...out(want, ff), att: { nose: unitV(nav.toRep(nose)), up: unitV(nav.toRep(up)), vectored: true } };
}

/** Below this over a ground [m], the hover holds a place on it (carried by its turning), level. */
const HOVER_LOW = 20e3;

/**
 * The heading a craft levelled now keeps (home frame, horizontal, unit): its nose's over the ground, plus
 * where its belly faces — a craft standing on its tail (a rocket's braking) pitches down the short way, its
 * belly to the ground.
 */
function levelHeading(this: CameraController, up: Vec3): Vec3 {
  const cam = cameraFrame(this.s);
  const ax = this.shipAxesLocal(cam).map((a) => unitV(repToHomeVec(mouth(this.s).w, cam.ell, cam.n, a)));
  const flat = (v: Vec3) => lin(v, 1, up, -dot3(v, up));
  const hd = lin(flat(ax[2]!), 1, flat(ax[1]!), -1);
  return Math.hypot(...hd) > 1e-6 ? unitV(hd) : unitV(flat(cross(up, [0, 0, 1])));
}

/**
 * The take-off's heading from `rel` (the craft − the body's centre): east, or — an inclination asked —
 * the launch azimuth for it (sin az = cos i / cos latitude, prograde), the nearest reachable when the
 * site's latitude is above it. The latitude is the geocentric one — the orbit's plane passes through
 * the centre —, not the figure's geodetic up (0.19° apart at Kennedy on the Earth's ellipsoid).
 */
export function launchEast(id: string, rel: Vec3, incDeg: number | null): Vec3 {
  const up = unitV(rel);
  const pole = unitV(spinAxis(id));
  let east = cross(pole, up);
  if (Math.hypot(...east) < 1e-12) east = cross([0, 0, 1], up);
  east = unitV(east);
  if (incDeg !== null) {
    const north = cross(up, east);
    const cl = Math.sqrt(Math.max(1 - dot3(up, pole) ** 2, 1e-9));
    const sinAz = clamp(Math.cos((incDeg * Math.PI) / 180) / cl, -1, 1);
    const az = Math.asin(sinAz);
    east = unitV(lin(north, Math.cos(az), east, sinAz));
  }
  return east;
}

/** The take-off's top [M from the body's centre]: the height asked, else clear of the air (1.5 × its top) or 3 % of the radius. */
export function climbTop(id: string, altKm: number | null): number {
  const sb = solarBody(id)!;
  const air = sb.atmosphere;
  return sb.radius + Math.max(air ? (1.5 * 12 * air.H) / M_METRES : 0, 0.03 * sb.radius, altKm !== null ? (altKm * 1e3) / M_METRES : 0);
}

/**
 * The take-off's climb as commanded at `r` from the body's centre, `h` over its ground [M]: the vertical
 * speed and the east speed over the ground [c], the share of the climb done. The climb is aimed a little
 * above its top — it slows as it nears it —, its east speed the circular one's √f; in the air the speed
 * through it no more than keeps the craft's own drag (½ ρ v² C_D A / m) under 30 % of the thrust, and the
 * dynamic pressure under 35 kPa (max-Q) — straight up through the thick air first, turning east as it
 * thins (a gravity turn). `thr` the thrust [c²/M], `dragK` the drag per mass, `vGroundE` the ground's east speed.
 */
export function climbCmd(id: string, thr: number, dragK: number, d0: number, vGroundE: number, r: number, h: number, vNowE?: number) {
  const sb = solarBody(id)!;
  const c = C_MPS;
  const minute = 60 / M_SECONDS;
  const gw = sb.mass / (r * r);
  const dAim = d0 + 0.04 * (d0 - sb.radius);
  const f = Math.min(Math.max((r - sb.radius) / (dAim - sb.radius), 0), 1);
  const vc = Math.sqrt(sb.mass / r);
  let vUp = Math.min(Math.sqrt(Math.max(thr - gw, 0) * (d0 - sb.radius)) * 0.5, (d0 - sb.radius) / (3 * minute), 0.02) * (1 - f) + 0.2 / c;
  // (out of the air — between 3 and 7 of its scale heights —, the top's circular speed at once: tied to the
  // height's share, √f, the climb crept up its last 30 km at 7 km/s for 450 s, the thrust holding the craft
  // up — 11.3 km/s spent to a 300 km orbit, 9.4 a rocket's. An airless world keeps its √f: from its ground)
  const out = steerShare(sb.atmosphere?.H, h * M_METRES, thr, sb.mass / sb.radius ** 2);
  const vE = vc * Math.sqrt(f) + (Math.sqrt(sb.mass / d0) - vc * Math.sqrt(f)) * out;
  // (and never faster up than a coast tops out at the top — gravity less the east speed's own lift, a fiftieth
  // of it at least: aimed past it, the climb coasted on, the orbit 4 % high — 105 km for 100; a fifth, near the
  // orbital speed, 409 km for 300); the east speed the craft has now when known, else the command's
  const vh = vNowE ?? vc * Math.sqrt(f);
  const gEff = Math.max(gw - (vh * vh) / r, 0.02 * gw);
  vUp = Math.min(vUp, Math.sqrt(2 * gEff * Math.max(d0 - r, 0)) + 0.2 / c);
  let vEastAir = Math.max(vE, vGroundE * (1 - f)) - vGroundE;
  const rho = ourAir(id, h * M_METRES);
  if (rho > 0) {
    const k = Math.max(dragK, 1e-6);
    const vMax = Math.min(Math.sqrt((0.6 * thr * ((c * c) / M_METRES)) / (rho * k)), Math.sqrt((2 * 35e3) / rho)) / c;
    vUp = Math.min(vUp, vMax);
    const hMax = Math.sqrt(Math.max(vMax * vMax - vUp * vUp, 0));
    vEastAir = Math.max(Math.min(vEastAir, hMax), -hMax);
  }
  return { vUp, vEastAir, f };
}

/**
 * The take-off's steering out of the air: the share of the thrust up (its sine) that brings the craft to its
 * top with no more speed up as it reaches the speed across it still needs (`gain`, at `thr`): the climb's
 * acceleration linear in time over the time to go (6 Δh − 4 v t) / t², the weight less the speed's lift
 * (`gNet`) on top; the time to go on the thrust left across. The share asked falls as the share taken grows
 * (the time to go lengthens): its fixed point by bisection — iterated, it swung between 0.95 and 0.18.
 */
export function steerUp(gain: number, thr: number, dh: number, vz: number, gNet: number) {
  const tgoOf = (s: number) => Math.max(gain / (thr * Math.max(Math.sqrt(1 - s * s), 0.3)), 5 / M_SECONDS);
  const ask = (s: number) => {
    const t = tgoOf(s);
    return clamp(((6 * dh - 4 * vz * t) / (t * t) + gNet) / thr, -0.4, 0.95);
  };
  let lo = -0.4,
    hi = 0.95;
  for (let k = 0; k < 24; k++) {
    const m = (lo + hi) / 2;
    if (ask(m) > m) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * The share of the take-off steered out of the air at a height [m] (`H` the scale height [m]): from 3 to 7 of
 * them — none for a craft whose thrust is past 2.5 × its weight on the ground (the Lander on Mars: its time to
 * the circular speed short, the law asked 1.4 km/s up of it, 727 km for 250 — the climb's speeds kept there).
 */
export function steerShare(H: number | undefined, h: number, thr: number, gGround: number) {
  return H && thr < 2.5 * gGround ? smoothstep((h - 3 * H) / (4 * H)) : 0;
}

/**
 * The take-off's optimum path as its command flies it: the downrange and the height [km] from the pad
 * up to its top (the ground's east speed as at the pad), the time along it [s], and where its gravity
 * turn starts — the path 15° off the vertical — [km]. A point mass flown as the take-off flies
 * (ourSurfaceWant): in the air its speeds commanded, closed over the velocity law's 1.2 s with the weight
 * held and what the thrust leaves; out of it (from 3 to 7 scale heights) the full thrust steered to the
 * top's circular speed, the climb brought to nothing there. (Flown as asked at once, the path drawn ran
 * 150 km ahead of the craft at 100 km up: the speed across takes its time.)
 */
export function climbProfile(id: string, thr: number, dragK: number, d0: number, vGroundE: number) {
  const sb = solarBody(id)!;
  const R = sb.radius;
  const km = M_METRES / 1e3;
  const pts: [number, number][] = [[0, 0]];
  const ts = [0];
  const H = sb.atmosphere?.H;
  const dt = 0.5 / M_SECONDS,
    T = 1.2 / M_SECONDS;
  const vcT = Math.sqrt(sb.mass / d0);
  let x = 0,
    h = 0,
    vz = 0,
    vh = vGroundE,
    turn = Number.NaN;
  for (let k = 1; k <= 6000; k++) {
    const r = R + h;
    const vc = Math.sqrt(sb.mass / r);
    const w = steerShare(H, h * M_METRES, thr, sb.mass / (R * R));
    if (w > 0 && r >= d0 - 0.003 * (d0 - R) && vh >= 0.995 * vc) break;
    if (r >= d0 && Math.abs(vh / vc - 1) < 0.08) break;
    const gNet = sb.mass / (r * r) - (vh * vh) / r;
    // the velocity law: the speeds commanded, the weight held, the rest of the thrust on their error
    const cm = climbCmd(id, thr, dragK, d0, vGroundE, r, h, vh);
    const ez = (cm.vUp - vz) / T,
      eh = (cm.vEastAir + vGroundE - vh) / T;
    const left = Math.sqrt(Math.max(thr * thr - Math.max(gNet, 0) ** 2, 0));
    const ek = Math.min(1, left / Math.max(Math.hypot(ez, eh), 1e-30));
    let az = ez * ek,
      ah = eh * ek;
    // out of the air: the thrust steered (ourSurfaceWant)
    if (w > 0) {
      const sUp = steerUp(vcT - vh, thr, d0 - r, vz, Math.max(gNet, 0));
      az = (1 - w) * az + w * (thr * sUp - gNet);
      ah = (1 - w) * ah + w * thr * Math.sqrt(1 - sUp * sUp);
    }
    vz += az * dt;
    vh += ah * dt;
    h = Math.max(h + vz * dt, 0);
    x += (vh - vGroundE) * dt;
    if (!Number.isFinite(turn) && h > 0 && Math.atan2(vz, Math.abs(vh - vGroundE)) < (75 * Math.PI) / 180) turn = h * km;
    if (k % 4 === 0) {
      pts.push([x * km, h * km]);
      ts.push(k * 0.5);
    }
  }
  return { pts, ts, turn: Number.isFinite(turn) ? turn : 0 };
}

/**
 * The take-off's assistant (C2), our universe: the path flown — the downrange from the pad and the
 * height — against the optimum its command flies (climbProfile) and the corridor about it, the
 * apoapsis it leaves, the height asked; the path's angle and heading, the dynamic pressure and its
 * peak (max-Q); the countdowns to the gravity turn and to the engine's cutoff (MECO). Its rows are
 * added to the card's.
 */
/** A hub card's row, marked past its mark ("warn") or well past it ("bad"). */
const hubRow = (k: string, v: string, q: HubRow[2] | null = null): HubRow => (q ? [k, v, q] : [k, v]);
/** A figure against its marks: beyond the first "warn", beyond the second "bad". */
const mark = (x: number, warn: number, bad: number): HubRow[2] | null => (x > bad ? "bad" : x > warn ? "warn" : null);

function climbAssist(
  this: CameraController,
  nav: NonNullable<ReturnType<CameraController["ourNav"]>>,
  mu: number,
  rows: HubRow[],
): Pick<HubInfo, "graph" | "say"> {
  const id = nav.ref;
  const sb = solarBody(id)!;
  const kmM = M_METRES / 1e3;
  const C = C_MPS;
  const Pb = nav.refPos;
  const rel = sub3(nav.X, Pb);
  const r = Math.hypot(...rel);
  const up = figureUp(id, nav.X, nav.t);
  const h = Math.max(altitudeOver(id, nav.X, nav.t) / 1e3, 0);
  const d0 = climbTop(id, this.launchGoal.altKm);
  const thr = this.thrustMax();
  const dragK = this.dragPerMass();
  // the pad (body-fixed, at the first look), the ground's east speed there
  const q = toBodyFixed(id, nav.X, nav.t);
  const ql = Math.hypot(...q);
  const gv = groundVelocity(id, nav.X, nav.t);
  const pole = unitV(spinAxis(id));
  let eastG = cross(pole, up);
  if (Math.hypot(...eastG) < 1e-12) eastG = cross([0, 0, 1], up);
  eastG = unitV(eastG);
  const north = cross(up, eastG);
  const east = launchEast(id, rel, this.launchGoal.incDeg);
  if (!this.climbRec || this.climbRec.id !== id) {
    const vGroundE = dot3(sub3(gv, nav.refVel), east);
    this.climbRec = { id, pad: lin(q, 1 / ql, q, 0) as Vec3, trace: [], qMax: 0, profile: climbProfile(id, thr, dragK, d0, vGroundE) };
  }
  const R = this.climbRec;
  const cosA = Math.min(Math.max(dot3(R.pad, lin(q, 1 / ql, q, 0)), -1), 1);
  const x = Math.acos(cosA) * sb.radius * kmM;
  const tr = R.trace;
  const last = tr[tr.length - 1];
  // (the trace thinned as it grows by a spacing doubled each time — every other point dropped at each push
  // past 400 kept the last minutes and lost the climb's start: its second point 1 061 km downrange)
  R.step ??= 0.05;
  if (!last || Math.abs(x - last[0]) + Math.abs(h - last[1]) > R.step) {
    tr.push([x, h]);
    if (tr.length > 400) {
      R.step *= 2;
      let p = tr[0]!;
      R.trace = tr.filter((q, i) => {
        if (i === 0 || i === tr.length - 1) return true;
        if (Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]) < R.step!) return false;
        p = q;
        return true;
      });
    }
  }
  // the path: its angle over the ground's horizon, its heading
  const va = sub3(nav.V, gv);
  const vv = dot3(va, up);
  const vhv = lin(va, 1, up, -vv);
  const vh = Math.hypot(...vhv);
  const gam = (Math.atan2(vv, vh) * 180) / Math.PI;
  const az = (v: Vec3) => ((Math.atan2(dot3(v, eastG), dot3(v, north)) * 180) / Math.PI + 360) % 360;
  const hdg = vh * C > 1 ? az(vhv) : NaN;
  // (what the command asks here: its path's angle, its heading)
  const cmd = climbCmd(
    id,
    thr,
    dragK,
    d0,
    dot3(sub3(gv, nav.refVel), east),
    r,
    Math.max(gearHeight(id, nav.X, nav.t), 0) / M_METRES,
    dot3(sub3(nav.V, nav.refVel), east),
  );
  const gamAim = (Math.atan2(cmd.vUp, Math.abs(cmd.vEastAir)) * 180) / Math.PI;
  const hdgAim = az(east);
  const deg3 = (a: number) => (Number.isFinite(a) ? `${a.toFixed(0).padStart(3, "0")}°` : "—");
  // the dynamic pressure and its peak
  const LA = this.airFlight.last;
  const qPa = LA && LA.air.rho > 0 ? LA.out.q : 0;
  R.qMax = Math.max(R.qMax, qPa);
  const passed = R.qMax > 1000 && qPa < 0.97 * R.qMax;
  // the orbit it leaves
  const vi = lin(sub3(nav.V, nav.refVel), C, nav.V, 0) as KV3;
  const e = kepElements(mu, lin(rel, M_METRES, rel, 0) as KV3, vi);
  const axes = bodyAxes(sb, nav.t);
  const apo = axes.map((axis) => -dot3(axis, e.P as Vec3) * e.ra) as Vec3;
  const apKm = e.e < 1 ? cartToGeodetic(sb.radius * M_METRES, flatteningOf(id), apo).h / 1e3 : Infinity;
  const topKm = (d0 - sb.radius) * kmM;
  // the countdowns, along the optimum's own time: to the gravity turn, to the cutoff (MECO) — from where
  // the craft is on it (its height)
  const P = R.profile.pts,
    TS = R.profile.ts;
  const along = (hh: number, k: 0 | 1) => {
    for (let i = 1; i < P.length; i++)
      if (P[i]![1] >= hh) {
        const y0 = P[i - 1]![1],
          y1 = P[i]![1];
        const u = (hh - y0) / Math.max(y1 - y0, 1e-9);
        return k === 0 ? P[i - 1]![0] + (P[i]![0] - P[i - 1]![0]) * u : TS[i - 1]! + (TS[i]! - TS[i - 1]!) * u;
      }
    return k === 0 ? P[P.length - 1]![0] : TS[TS.length - 1]!;
  };
  const tNow = along(h, 1);
  const toTurn = h < R.profile.turn ? along(R.profile.turn, 1) - tNow : NaN;
  const tMeco = Math.max(TS[TS.length - 1]! - tNow, 0);
  const dur = (t: number) => fmtDur(t);
  // (the height over the ground's figure — the card's from the mean sphere, off by kilometres on the Earth's)
  const kmText = (x: number) =>
    x >= 100 ? `${Math.round(x).toLocaleString("en-US")} km` : x >= 1 ? `${x.toFixed(1)} km` : `${Math.round(Math.max(x, 0) * 1e3)} m`;
  rows[0] = [t("Height"), kmText(h)];
  // (the apoapsis over the ground's figure too: from the equator's radius it read −4.7 km on the pad)
  if (rows[1] && Number.isFinite(apKm)) rows[1] = [t("Apoapsis"), kmText(apKm)];
  rows.push(
    // (the path off the command's by 10° once away from the vertical climb: amber; by 20°: red)
    hubRow(t("Path angle"), `${gam.toFixed(0)}° → ${gamAim.toFixed(0)}°`, h > 1 ? mark(Math.abs(gam - gamAim), 10, 20) : null),
    [t("Heading"), `${deg3(hdg)} → ${deg3(hdgAim)}`],
    [R.qMax > 1000 ? t("q · max") : "q", `${(qPa / 1e3).toFixed(1)}${R.qMax > 1000 ? ` · ${(R.qMax / 1e3).toFixed(1)}` : ""} kPa`],
  );
  if (Number.isFinite(toTurn)) rows.push([t("Gravity turn in"), dur(toTurn)]);
  rows.push([t("MECO in"), `~${dur(tMeco)}`]);
  // the graph: the height against the downrange, the optimum, its corridor (15 % of the downrange, 2 km
  // and a fifth of the height either side — the vertical climb drifts); its frame following the climb —
  // 2.5 × the height, the top's at the end
  const ideal = P;
  const slack = (px: number, py: number) => 0.15 * px + 2 + 0.2 * py;
  const lo = P.map(([px, py]) => [px - slack(px, py), py] as [number, number]);
  const hi = P.map(([px, py]) => [px + slack(px, py), py] as [number, number]);
  const xi = along(h, 0);
  const on = Math.abs(x - xi) <= slack(xi, h);
  const yMax = Math.min(Math.max(h * 2.5, 12), topKm * 1.25);
  const graph: AssistGraph = {
    kind: "climb",
    title: t("Ascent"),
    x: { label: t("Downrange"), unit: "km", min: 0, max: Math.max(along(Math.min(yMax, topKm * 0.995), 0) * 1.15 + 2, x * 1.2, 4) },
    y: { label: t("Height"), unit: "km", min: 0, max: yMax },
    ideal,
    lo,
    hi,
    flown: R.trace,
    now: [x, h],
    marks: [],
    levels: [{ y: topKm, label: t("TARGET") }, ...(Number.isFinite(apKm) && apKm > 1 ? [{ y: apKm, label: "Ap" }] : [])],
    state: h < 0.05 ? "wait" : on ? "on" : "off",
    about: t("The height against the downrange: the take-off's optimum path, its corridor; the apoapsis and the height asked as levels"),
    fix:
      x > xi
        ? t("Downrange of the path — too shallow: pitch up to the path angle asked")
        : t("Short of the path — too steep: pitch over to the path angle asked"),
  };
  const say: string[] = [tf("PATH {0}° · HDG {1}°", gamAim.toFixed(0), hdgAim.toFixed(0).padStart(3, "0"))];
  if (Number.isFinite(toTurn)) say.push(tf("GRAVITY TURN IN {0}", fmtDur(toTurn)));
  if (qPa > 1000 && !passed && qPa > 0.9 * R.qMax) say.push(tf("MAX-Q {0} kPa", (qPa / 1e3).toFixed(0)));
  if (h > 0.05) say.push(tf("MECO IN ~{0}", fmtDur(tMeco)));
  return { graph, say };
}

/**
 * The deorbit burn's assistant (C3), as a node's (C1): the Δv left against the time from the burn's
 * centre, its corridor, the trace; the director's cue — the ignition counted down, the Δv left, the cutoff.
 */
function deorbitAssist(this: CameraController, R: NonNullable<CameraController["entryRun"]>, nowS: number): Pick<HubInfo, "graph" | "cue"> {
  const thrSI = this.thrustMax() * (C_MPS ** 2 / (1476.625 * this.s.massSolar));
  const burnT = thrSI > 0 ? R.dv / thrSI : NaN;
  const burning = R.phase === "burn";
  const left = burning ? Math.max(R.dv - R.done, 0) : R.dv;
  const x = nowS - R.tBurn;
  const key = `deorbit:${Math.round(R.tBurn)}`;
  if (this.burnTrace?.key !== key) this.burnTrace = { key, pts: [] };
  const tr = this.burnTrace.pts;
  if (burning && (!tr.length || x > tr[tr.length - 1]![0])) tr.push([x, left]);
  const graph = burnGraph({
    title: t("Deorbit Δv left"),
    dv: R.dv,
    left,
    T: burnT,
    x,
    trace: tr,
    burning,
    labels: { y: t("Δv left"), x: t("from the burn"), ignition: t("IGN"), cutoff: t("CUT"), ...BURN_HELP() },
  });
  const cue = {
    tIgn: burning ? 0 : R.tBurn - burnT / 2 - nowS,
    left,
    dv: R.dv,
    burning,
    cut: burning && left <= Math.max(2e-3 * R.dv, 0.1),
  };
  return { graph, cue };
}

/**
 * The entry's assistant (C3): the corridor in the height–speed plane at the angle of attack held (entry.ts
 * entryCorridor — the lift's top, the heat's and the load's floor), the guidance's predicted fall in it,
 * the path flown; the bank asked and its side, the countdown to its next reversal (the crossrange's drift
 * against the deadband), to the entry interface; the shield's and the load's margins.
 */
function entryAssist(
  this: CameraController,
  R: NonNullable<CameraController["entryRun"]>,
  nowS: number,
  rows: HubRow[],
): Pick<HubInfo, "graph" | "say"> {
  const fr = this.entryFrame(cameraFrame(this.s));
  if (!fr || !fr.env.atm) return {};
  const craft = this.entryCraft();
  const va = sub3(fr.s.v, fr.env.ground(fr.s.x));
  const v = Math.hypot(...va);
  const h = heightOfEntry(fr.env, fr.s.x);
  const top = airTop(fr.env.atm);
  if (!R.corr) {
    const vMax = Math.max(v * 1.05, 2000);
    // (the ground's own speed along the track: the curve the craft falls round is its speed in space)
    const up0 = unitV(fr.s.x);
    const carried = dot3(fr.env.ground(fr.s.x), unitV(lin(va, 1, up0, -dot3(va, up0))));
    R.corr = entryCorridor(
      fr.env,
      craft,
      Array.from({ length: 48 }, (_, i) => 150 + ((vMax - 150) * i) / 47),
      carried,
    );
  }
  const C = R.corr;
  const vMax = C[C.length - 1]!.v;
  // the path flown, in the air
  R.trace ??= [];
  const tr = R.trace;
  const last = tr[tr.length - 1];
  if (h < top && (!last || Math.abs(last[0] - v / 1e3) + Math.abs(last[1] - h / 1e3) > 0.02)) {
    tr.push([v / 1e3, h / 1e3]);
    if (tr.length > 400) R.trace = tr.filter((_, i) => i % 2 === 0 || i === tr.length - 1);
  }
  const at = (k: "lo" | "hi") => {
    for (let i = 1; i < C.length; i++)
      if (C[i]!.v >= v) {
        const a = C[i - 1]!,
          b = C[i]!;
        return a[k] + ((b[k] - a[k]) * (v - a.v)) / Math.max(b.v - a.v, 1e-9);
      }
    return C[C.length - 1]![k];
  };
  const inside = h >= at("lo") - 500 && h <= at("hi") + 500;
  // (above the corridor while falling into it is the way in; above it again after, a skip)
  if (inside) R.inCorr = true;
  const ei = entryInterface(fr.env.atm);
  const pred = (R.guid?.last?.track ?? []).map(([sv, sh]) => [sv / 1e3, Math.max(sh, 0) / 1e3] as [number, number]);
  const graph: AssistGraph = {
    kind: "entry",
    title: t("Entry corridor"),
    x: { label: t("Speed"), unit: "km/s", min: 0, max: (vMax / 1e3) * 1.02 },
    y: { label: t("Height"), unit: "km", min: 0, max: (ei / 1e3) * 1.08 },
    ideal: pred,
    lo: C.map((c) => [c.v / 1e3, c.lo / 1e3] as [number, number]),
    hi: C.map((c) => [c.v / 1e3, c.hi / 1e3] as [number, number]),
    flown: R.trace,
    now: [v / 1e3, h / 1e3],
    marks: [],
    state: inside ? "on" : h > at("hi") && !R.inCorr ? "wait" : "off",
    about: t(
      "The entry corridor: above it the lift cannot hold the fall's curve; below it the shield's heat or the load is too much. Dashed: the guidance's predicted fall",
    ),
    fix:
      h < at("lo")
        ? t("Too deep for the heat or the load: bank less — more of the lift up")
        : t("Above the corridor again — a skip: bank more, less of the lift up"),
  };
  // the bank's reversal: the crossrange (on the bank's side) drifting to the deadband's far edge
  const miss = R.guid?.lastMiss;
  let tRev = NaN;
  // (in the air: above it the guidance holds its nominal — no crossrange to follow)
  if (miss && R.guid && h < ei) {
    const a = miss.across * R.guid.sign;
    // (the guidance's own deadband: the speed's, the way left's, a capsule's tight one)
    const left = R.site ? Math.acos(clamp(dot3(unitV(fr.s.x), unitV(fr.place(R.site))), -1, 1)) * fr.env.R : 0;
    const band = R.guid.deadband(v, left);
    const P = R.rev;
    if (!P) R.rev = { t: nowS, a, rate: 0 };
    else if (nowS - P.t > 0.5 && a !== P.a) {
      const r = (a - P.a) / (nowS - P.t);
      R.rev = { t: nowS, a, rate: P.rate ? 0.75 * P.rate + 0.25 * r : r };
    }
    // (a quarter of each new reading: the guidance's crossrange jumps a little at each update)
    const rate = R.rev!.rate;
    // (past the band's edge already: the guidance reverses at its next update — now)
    if (rate < 0) tRev = Math.max((a + band) / -rate, 0);
  }
  const say: string[] = [];
  const up = fr.env.normal?.(fr.s.x) ?? unitV(fr.s.x);
  const vr = dot3(fr.s.v, up);
  if (h > ei && vr < 0) say.push(tf("ENTRY INTERFACE IN {0}", fmtDur((h - ei) / -vr)));
  else {
    const deg = Math.round((Math.abs(R.bank) * 180) / Math.PI);
    say.push(tf("BANK {0}° {1}", deg, deg < 1 ? "" : R.bank > 0 ? t("RIGHT") : t("LEFT")));
    if (Number.isFinite(tRev) && tRev < 600) say.push(tf("REVERSAL IN ~{0}", fmtDur(tRev)));
  }
  const M = this.airFlight.margins();
  rows.push([t("Shield · load"), `${Math.round(M.shield * 100)} % · ${Math.round(M.g * 100)} %`]);
  if (Number.isFinite(tRev) && tRev < 600) rows.push([t("Reversal in"), `~${fmtDur(tRev)}`]);
  return { graph, say };
}

/**
 * The approach's assistant (C6): the closing rate against the distance to the stand-off, the approach
 * autopilot's own braking curve (a stop at 60 % of the thrust), its corridor (a quarter as fast up to
 * the curve a 90 % burn still stops on — a body's pull may carry the autopilot itself above its own
 * curve), the trace — slower is safe (cyan), past the stop is not (amber) —, the frame following the
 * approach; the director's: the closing rate as flown
 * and as asked, the braking's countdown.
 */
function approachAssist(this: CameraController, leftM: number, closing: number, name: string): Pick<HubInfo, "graph" | "say"> {
  const thrSI = this.thrustMax() * (C_MPS ** 2 / (1476.625 * this.s.massSolar));
  const a = 0.6 * thrSI;
  const want = (d: number) => Math.sqrt(2 * a * Math.max(d, 0));
  const stopAt = (d: number) => Math.sqrt(2 * 0.9 * thrSI * Math.max(d, 0));
  const loAt = (d: number) => Math.min(0.25 * want(d), stopAt(d)),
    hiAt = (d: number) => stopAt(d);
  const left = Math.max(leftM, 0);
  const key = `approach:${name}`;
  if (this.glideTrace?.key !== key) this.glideTrace = { key, pts: [] };
  const tr = this.glideTrace.pts;
  const last = tr[tr.length - 1];
  if (
    !last ||
    Math.abs(last[0] - left / 1e3) > Math.max(left / 1e3, 0.01) * 0.01 ||
    Math.abs(last[1] - closing) > Math.max(closing * 0.01, 0.1)
  ) {
    tr.push([left / 1e3, closing]);
    if (tr.length > 400) this.glideTrace.pts = tr.filter((_, i) => i % 2 === 0 || i === tr.length - 1);
  }
  const xMax = Math.max((left / 1e3) * 1.5, 0.5);
  const ds = Array.from({ length: 48 }, (_, i) => (xMax * 1e3 * i) / 47);
  const graph: AssistGraph = {
    kind: "approach",
    title: t("Approach"),
    x: { label: t("To the stand-off"), unit: "km", min: 0, max: xMax },
    y: { label: t("Closing"), unit: "m/s", min: 0, max: Math.max(closing * 1.3, want(xMax * 1e3) * 1.3, 1) },
    ideal: ds.map((d) => [d / 1e3, want(d)] as [number, number]),
    lo: ds.map((d) => [d / 1e3, loAt(d)] as [number, number]),
    hi: ds.map((d) => [d / 1e3, hiAt(d)] as [number, number]),
    flown: this.glideTrace.pts,
    now: [left / 1e3, Math.max(closing, 0)],
    marks: [],
    state: closing > hiAt(left) + 0.2 ? "off" : closing < loAt(left) - 0.2 ? "wait" : "on",
    about: t(
      "The closing rate against the distance to the stand-off: the approach autopilot's braking curve, its corridor; slower is safe",
    ),
    fix: t("Too fast to stop at the stand-off: brake now — full thrust against the closing"),
  };
  const say = [tf("CLOSING {0} → {1} m/s", closing.toFixed(closing < 100 ? 1 : 0), want(left).toFixed(want(left) < 100 ? 1 : 0))];
  // (the braking — at the autopilot's 60 % — must start when what is left is what it takes, and a tenth)
  if (closing > 0.5) {
    const tB = (left - ((closing * closing) / (2 * a)) * 1.1) / closing;
    say.push(tB <= 0 ? t("BRAKE NOW") : tB < 600 ? tf("BRAKE IN {0}", fmtDur(tB)) : "");
  }
  return { graph, say: say.filter(Boolean) };
}

/**
 * The docking's card and assistant (C7): what the docking autopilot does and why (its phases explained),
 * the range, the distance along the port's axis and across it against the corridor's cone, the closing
 * rate, the ports' angle; the graph: the closing rate against the distance along the axis, the autopilot's
 * own (3 cm/s a metre, 8 cm/s at the ring, 3 m/s at most), the corridor about it — half to half again —,
 * the 10 m hold marked; the director's: the rate as flown and as asked, the offset against the cone, the
 * ports' angle, the hold's or the contact's countdown.
 */
function dockCard(this: CameraController): HubInfo | null {
  const D = this.dockAuto;
  const g = D ? this.dockGeometry({ target: D.target, port: D.port }) : null;
  if (!D || !g) return null;
  const why: Record<string, string> = {
    APPROACH: t("in along the port's axis, slowing as it nears"),
    FINAL: t("the last metres: on the axis, the ports facing — to the capture"),
    "HOLD 10 m": t("held 10 m out until on the axis, the ports facing and the drift still"),
    "TO THE AXIS": t("to a point on the port's axis, off the target"),
  };
  const phase = why[D.phase] ?? (D.blocked ? t("round the target, clear of its hull, to the axis") : t("docking"));
  const along = g.along,
    closing = g.closing;
  const cone = 1 + 0.15 * Math.max(along, 0);
  const want = (x: number) => Math.min(3, 0.08 + 0.012 * Math.max(x, 0));
  const key = `dock:${D.target}:${D.port}`;
  if (this.glideTrace?.key !== key) this.glideTrace = { key, pts: [] };
  const tr = this.glideTrace.pts;
  const last = tr[tr.length - 1];
  if (D.corridor && (!last || Math.abs(last[0] - along) > Math.max(along * 0.01, 0.05) || Math.abs(last[1] - closing) > 0.01)) {
    tr.push([along, closing]);
    if (tr.length > 400) this.glideTrace.pts = tr.filter((_, i) => i % 2 === 0 || i === tr.length - 1);
  }
  const xMax = Math.max(along * 1.4, 20);
  const xs = Array.from({ length: 40 }, (_, i) => (xMax * i) / 39);
  const graph: AssistGraph = {
    kind: "dock",
    title: t("Docking"),
    x: { label: t("Along the axis"), unit: "m", min: 0, max: xMax },
    y: { label: t("Closing"), unit: "m/s", min: 0, max: Math.max(want(xMax) * 1.7, closing * 1.2, 0.2) },
    ideal: xs.map((x) => [x, want(x)] as [number, number]),
    lo: xs.map((x) => [x, want(x) * 0.5] as [number, number]),
    hi: xs.map((x) => [x, want(x) * 1.5] as [number, number]),
    flown: this.glideTrace.pts,
    now: [Math.max(along, 0), Math.max(closing, 0)],
    marks: [{ x: 10, label: t("HOLD") }],
    state: !D.corridor ? "wait" : closing > want(along) * 1.5 + 0.02 ? "off" : closing < want(along) * 0.5 - 0.02 ? "wait" : "on",
    about: t("The closing rate against the distance along the port's axis: the docking autopilot's profile, its corridor"),
    fix: t("Too fast for the distance: brake along the axis — the thrusters back"),
  };
  const say = [tf("CLOSE {0} → {1} m/s", closing.toFixed(2), want(along).toFixed(2))];
  say.push(tf("OFFSET {0} m · CONE {1} m", g.lateral.toFixed(1), cone.toFixed(1)), tf("PORTS {0}°", g.angle.toFixed(1)));
  if (g.spin >= 1) say.push(tf("MATCH ITS TURN · {0}°/s APART", g.spin.toFixed(1)));
  if (D.phase === "HOLD 10 m") say.push(t("HOLD AT 10 m — ALIGN"));
  // (the contact: along the autopilot's profile from here — its rate slows as it nears, a logarithm)
  else if (D.corridor && closing > 0.02) {
    const x = Math.max(along, 0);
    const tC = Math.log1p((0.012 * Math.min(x, 243)) / 0.08) / 0.012 + Math.max(x - 243, 0) / 3;
    say.push(tf("CONTACT IN ~{0}", fmtDur(tC)));
  }
  const m = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} km` : `${x.toFixed(x < 10 ? 2 : 1)} m`);
  return {
    mode: "dock",
    title: "DOCK",
    phase,
    rows: [
      [t("Range"), m(g.range)],
      [t("Along · across"), `${m(along)} · ${m(g.lateral)}`],
      // (past their marks: too fast for the distance — the graph's own "off" —, the ports' axes and the
      // turns apart near the contact, by the flight report's marks)
      hubRow(t("Closing"), `${closing.toFixed(2)} m/s`, mark(closing - want(along), want(along) * 0.25 + 0.01, want(along) * 0.5 + 0.02)),
      hubRow(t("Ports' axes"), `${g.angle.toFixed(1)}°`, along < 30 ? mark(g.angle, 3, 6) : null),
      ...(g.spin >= 0.5 ? [hubRow(t("Turn against it"), `${g.spin.toFixed(1)}°/s`, along < 30 ? mark(g.spin, 1, 2) : null)] : []),
    ],
    next: D.corridor ? `→ ${tf("in the corridor (cone {0} m)", cone.toFixed(1))}` : null,
    bar: null,
    graph,
    say,
  };
}

/** A burn's graph explained: what it shows, what to do behind it or ahead of it. */
const BURN_HELP = () => ({
  about: t(
    "The Δv left against the time from the node: the burn centred on it, its corridor (started up to 15 % of its length early or late)",
  ),
  late: t("Behind the burn: full throttle, the nose on the cue — and cut at the cue"),
  early: t("Ahead of the burn: ease the throttle — the burn is best centred on its node"),
});

/** The surface's figures the descent's assistant reads (planet.ts surfaceInfo): SI, the gravity in g. */
type SurfaceLike = { alt?: number; vVert?: number; vHor?: number; landed?: boolean; twr?: number; gLocal?: number };

/**
 * The vertical descent's assistant (C5): the descent rate against the height, the landing autopilot's
 * own braking curve (half the thrust over the weight's, then a few seconds' fall, 1.5 m/s at the
 * touchdown), the corridor about it — a quarter as fast to a quarter more, never past the curve a 90 % burn
 * still stops on —, the trace: slower than the corridor is safe (cyan, the propellant spent), faster is
 * not (amber); the director's: the rate as flown and as asked (not while a hold hovers), the stop burn's
 * countdown, the drift.
 */
function descentAssist(this: CameraController, sf: SurfaceLike, hold = false): Pick<HubInfo, "graph" | "say"> {
  const alt = Math.max(sf.alt ?? 0, 0);
  const vDown = Math.max(-(sf.vVert ?? 0), 0);
  const vHor = sf.vHor ?? 0;
  const g = (sf.gLocal ?? 1) * G0;
  const thr = (sf.twr ?? 0) * g;
  // (the landing autopilot's own curve: descent.ts)
  const { aV, net } = brakingAccels(thr, g);
  const want = (h: number) => descentCurve(h, aV);
  const stopAt = (h: number) => Math.sqrt(V_TD * V_TD + 2 * 0.9 * net * h);
  const key = `descent:${fleet.active}`;
  if (this.glideTrace?.key !== key) this.glideTrace = { key, pts: [] };
  const tr = this.glideTrace.pts;
  const last = tr[tr.length - 1];
  if (!last || Math.abs(last[0] - vDown) > 0.3 || Math.abs(last[1] - alt) > Math.max(2, alt * 0.01)) {
    tr.push([vDown, alt]);
    if (tr.length > 400) this.glideTrace.pts = tr.filter((_, i) => i % 2 === 0 || i === tr.length - 1);
  }
  const hMax = Math.max(alt * 1.3, ...tr.map((p) => p[1]), 50);
  const hs = Array.from({ length: 48 }, (_, i) => (hMax * i) / 47);
  const loAt = (h: number) => Math.min(want(h) * 0.25, stopAt(h)),
    hiAt = (h: number) => Math.min(want(h) * 1.25, stopAt(h));
  const lo = hs.map((h) => [loAt(h), h] as [number, number]);
  const hi = hs.map((h) => [hiAt(h), h] as [number, number]);
  const graph: AssistGraph = {
    kind: "descent",
    title: t("Vertical descent"),
    x: { label: t("Descent rate"), unit: "m/s", min: 0, max: Math.max(vDown * 1.3, want(hMax) * 1.6, 5) },
    y: { label: t("Height"), unit: "m", min: 0, max: hMax },
    ideal: hs.map((h) => [want(h), h] as [number, number]),
    lo,
    hi,
    flown: this.glideTrace.pts,
    now: [vDown, alt],
    marks: [],
    levels: [],
    state: vDown > hiAt(alt) + 0.3 ? "off" : vDown < loAt(alt) - 0.3 ? "wait" : "on",
    about: t("The descent rate against the height: the landing autopilot's braking curve, its corridor; slower is safe"),
    fix: t("Too fast for the height: full throttle now — past this curve even a 90 % burn no longer stops in time"),
  };
  // (the stop burn at full thrust: when it must start — the HUD's hover scope says it too)
  const stop = (vDown * vDown) / (2 * net);
  const tIn = vDown > 1 ? (alt - stop * 1.1) / vDown : NaN;
  // (the rate the autopilot asks — slower than its curve while it closes on its pad)
  const asked = this.pilot.auto === "land" && this.landRun?.cmd && !this.landRun.cmd.coast ? this.landRun.cmd.down : want(alt);
  const say = hold ? [] : [tf("DESCENT {0} → {1} m/s", vDown.toFixed(1), asked.toFixed(1))];
  if (Number.isFinite(tIn)) say.push(tIn <= 0 ? t("BURN NOW") : tIn < 60 ? tf("BURN IN {0} s", tIn.toFixed(tIn < 10 ? 1 : 0)) : "");
  if (vHor > 1) say.push(tf("DRIFT {0} m/s", vHor.toFixed(vHor < 10 ? 1 : 0)));
  return { graph, say: say.filter(Boolean) };
}

/** A descent on the engines flown by hand (no autopilot): its card — the height, the rates, the stop burn. */
function descentCard(this: CameraController, sf: SurfaceLike): HubInfo {
  const A = this.descentAssist(sf);
  const alt = sf.alt ?? 0;
  const vDown = Math.max(-(sf.vVert ?? 0), 0);
  return {
    mode: "none",
    title: t("DESCENT"),
    phase: t("a descent on the engines — hand-flown, the landing autopilot's curve to follow"),
    rows: [
      [t("Height"), alt >= 1000 ? `${(alt / 1000).toFixed(2)} km` : `${Math.round(alt)} m`],
      ["V/S", `▼ ${vDown.toFixed(1)} m/s`],
      [t("Sideways"), `${(sf.vHor ?? 0).toFixed(1)} m/s`],
    ],
    next: `→ ${tf("touchdown in ~{0}", fmtDur(alt / Math.max(vDown, 0.5)))}`,
    bar: null,
    ...A,
  };
}

/**
 * The final's assistant (C4), the autopilot's glide or a hand-flown one: the height over the ground
 * against the distance to the threshold, the landing profile (its steep slope, the pull-up, the shallow
 * slope, the flare), the PAPI's corridor about it (±1° seen from the touchdown), the trace flown, the flare
 * and the threshold marked; the director's — the glide's error, the flare's countdown.
 */
function glideAssist(this: CameraController, rw: RunwayView): Pick<HubInfo, "graph" | "say"> {
  const fix = rw.fix!;
  const { td, hF, gi } = LANDING;
  const xF = td - (2 * hF) / Math.tan(gi);
  const key = rw.name;
  if (this.glideTrace?.key !== key) this.glideTrace = { key, pts: [] };
  const tr = this.glideTrace.pts;
  const last = tr[tr.length - 1];
  if (!last || Math.abs(last[0] - rw.along / 1e3) > 0.02 || Math.abs(last[1] - rw.agl) > 5) {
    tr.push([rw.along / 1e3, rw.agl]);
    if (tr.length > 400) this.glideTrace.pts = tr.filter((_, i) => i % 2 === 0 || i === tr.length - 1);
  }
  const x0 = Math.min(tr[0]?.[0] ?? rw.along / 1e3, rw.along / 1e3) * 1e3 - 500;
  const sp = Math.max(rw.speed, 50);
  const xs = Array.from({ length: 64 }, (_, i) => x0 + ((td - x0) * i) / 63);
  const prof = (x: number) => landingProfile(x, rw.agl, sp, fix).h;
  const band = (x: number) => Math.tan(Math.PI / 180) * Math.max(td - x, 200);
  const ideal = xs.map((x) => [x / 1e3, prof(x)] as [number, number]);
  const dev = (Math.atan2(rw.agl - prof(rw.along), Math.max(td - rw.along, 200)) * 180) / Math.PI;
  const hTop = Math.max(rw.agl, prof(x0)) * 1.15 + 20;
  const graph: AssistGraph = {
    kind: "glide",
    title: t("Final approach"),
    x: { label: t("To the threshold"), unit: "km", min: x0 / 1e3, max: (td + 300) / 1e3 },
    y: { label: t("Height"), unit: "m", min: 0, max: hTop },
    ideal,
    lo: xs.map((x) => [x / 1e3, Math.max(prof(x) - band(x), 0)] as [number, number]),
    hi: xs.map((x) => [x / 1e3, prof(x) + band(x)] as [number, number]),
    flown: this.glideTrace.pts,
    now: [rw.along / 1e3, rw.agl],
    marks: [
      { x: 0, label: t("THR") },
      { x: xF / 1e3, label: t("FLARE") },
    ],
    state: Math.abs(dev) <= 1 ? "on" : "off",
    about: t("The final's height against the distance to the threshold: the landing profile, the PAPI's ±1° about it"),
    fix:
      dev > 0
        ? t("High on the profile (the PAPI white): steepen — the nose down, the air brake out")
        : t("Low on the profile (the PAPI red): shallow the descent — the nose up, or some thrust"),
  };
  const say: string[] = [tf("GLIDE {0} {1}°", dev >= 0 ? "▲" : "▼", Math.abs(dev).toFixed(1))];
  if (rw.flareIn !== null && rw.flareIn < 60) say.push(tf("FLARE IN {0}", fmtDur(rw.flareIn)));
  return { graph, say };
}

/** A hand-flown final's card (no autopilot): the runway, the distance, the height, the glide, the flare. */
function glideCard(this: CameraController, rw: RunwayView): HubInfo {
  const A = this.glideAssist(rw);
  const dist = Math.max(-rw.along, 0);
  const rows: [string, string][] = [
    [t("To the threshold"), dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`],
    [t("Height"), `${Math.round(rw.agl)} m`],
    [t("Speed"), `${Math.round(rw.speed)} m/s`],
  ];
  if (rw.flareIn !== null) rows.push([t("Flare in"), fmtDur(rw.flareIn)]);
  return {
    mode: "none",
    title: `RWY ${String(Math.round(rw.rwy / 10) % 36 || 36).padStart(2, "0")} · ${rw.name.toUpperCase()}`,
    phase: t("on the final — hand-flown, its profile the autopilot's"),
    rows,
    next: `→ ${tf("touchdown {0} m past the threshold", LANDING.td)}`,
    bar: null,
    ...A,
  };
}

/**
 * The hub's card: the autopilot flying, what it does now, its figures, and what it predicts — the
 * orbit after its burn, the deorbit's heat and load, the touchdown, the arrival. Redone 4 times a
 * second at most. Null: no autopilot.
 */
function hubInfo(this: CameraController): HubInfo | null {
  const now = frameNow();
  if (this.hubCache && now - this.hubCache.at < 250) return this.hubCache.v;
  // (the climb's own record — its pad, its trace, its max-Q — kept while the take-off flies)
  if (this.pilot.auto !== "takeoff") this.climbRec = null;
  let v: HubInfo | null = null;
  try {
    v = this.hubCompute();
  } catch (e) {
    caught("hub", e);
  }
  this.hubCache = { at: now, v };
  return v;
}

function hubCompute(this: CameraController): HubInfo | null {
  const P = this.pilot,
    a = P.auto,
    s = this.s;
  // (no autopilot: a hand-flown final still has its card — the runway, the profile, the graph)
  if (a === "none") {
    const rw = this.runwayView();
    if (rw?.manual) return this.glideCard(rw);
    // (a descent on the engines by hand: low, slow over the ground, coming down — its card and graph)
    const sf = this.surfaceInfo() as SurfaceLike | null;
    if (sf && !sf.landed && sf.alt !== undefined && sf.alt < 5000 && (sf.vHor ?? 0) < 60 && (sf.vVert ?? 0) < -0.5 && (sf.twr ?? 0) > 1)
      return this.descentCard(sf);
    return null;
  }
  const C = C_MPS;
  const Msec = 4.925490947e-6 * s.massSolar;
  const km = (m: number) =>
    !Number.isFinite(m)
      ? "∞"
      : Math.abs(m) >= 1e5
        ? `${Math.round(m / 1e3).toLocaleString("en-US")} km`
        : Math.abs(m) >= 1e3
          ? `${(m / 1e3).toFixed(1)} km`
          : `${Math.round(m)} m`;
  const ms = (x: number) =>
    !Number.isFinite(x) ? "—" : Math.abs(x) >= 1e4 ? `${(x / 1e3).toFixed(2)} km/s` : `${x.toFixed(Math.abs(x) < 10 ? 1 : 0)} m/s`;
  const dur = (x: number) => (!Number.isFinite(x) ? "—" : x < 0 ? t("now") : fmtDur(x));
  const fc = this.fcContext();
  const orbitOf = (r: KV3, v: KV3) => {
    if (!fc) return "";
    const e = kepElements(fc.ctx.mu, r, v, fc.ctx.pole ?? [0, 0, 1]);
    const R = fc.ctx.R;
    return e.e < 1 ? `${km(e.rp - R)} × ${km(e.ra - R)}` : tf("escape · Pe {0}", km(e.rp - R));
  };
  const base = (title: string, phase: string, rows: HubRow[] = [], next: string | null = null, bar: number | null = null): HubInfo => ({
    mode: a,
    title,
    phase,
    rows,
    next,
    bar,
  });
  // a burn planned and flown (the node autopilot; CIRC's own burn)
  if (a === "node" || a === "burns") {
    const pl = this.fcPlan();
    const b = pl?.burns[0];
    if (!pl || !b) return base("NODE", t("no burn left"));
    const circ = !!this.ourCirc;
    const dv = Math.hypot(...b.dv);
    const thrSI = this.thrustMax() * (C ** 2 / (1476.625 * s.massSolar));
    const burnT = thrSI > 0 ? dv / thrSI : NaN;
    const doneM = a === "node" ? this.nodeDone * C : (this.fcBurns[0]?.done ?? 0);
    const burning = a === "node" ? this.nodeBurning : !!this.fcBurns[0]?.firing;
    const start = b.t - burnT / 2;
    const leftM = Math.max(dv - doneM, 0);
    let next: string | null = null;
    let aimed: string | null = null,
      nowOrbit: string | null = null;
    if (fc) {
      // (after the burn, impulsive: the orbit it leaves — burning, what is left of it given now)
      const at = burning ? { r: fc.ctx.r, v: fc.ctx.v } : kepProp(fc.ctx.mu, fc.ctx.r, fc.ctx.v, Math.max(b.t, 0));
      const d = fromPNR(at.r, at.v, b.dv as KV3);
      const k = burning ? leftM / Math.max(dv, 1e-9) : 1;
      aimed = orbitOf(at.r, [at.v[0] + d[0] * k, at.v[1] + d[1] * k, at.v[2] + d[2] * k] as KV3);
      nowOrbit = orbitOf(fc.ctx.r, fc.ctx.v);
      next = circ && this.ourCirc?.altKm !== undefined ? `→ ${tf("circular at {0} km", this.ourCirc.altKm.toFixed(0))}` : `→ ${aimed}`;
    }
    // the graph: the Δv left against the time from the node, its trace kept while it is the same node
    const nowS = this.nowTime() * Msec;
    const key = `${a}:${Math.round(nowS + b.t)}`;
    if (this.burnTrace?.key !== key) this.burnTrace = { key, pts: [] };
    const tr = this.burnTrace.pts;
    const x = -b.t;
    if (burning && (!tr.length || x > tr[tr.length - 1]![0])) {
      tr.push([x, leftM]);
      // (a long burn: every other point dropped past 400)
      if (tr.length > 400) this.burnTrace.pts = tr.filter((_, i) => i % 2 === 0 || i === tr.length - 1);
    }
    const graph = burnGraph({
      title: t("Δv left"),
      dv,
      left: leftM,
      T: burnT,
      x,
      trace: this.burnTrace.pts,
      burning,
      labels: { y: t("Δv left"), x: t("from the node"), ignition: t("IGN"), cutoff: t("CUT"), ...BURN_HELP() },
    });
    // (the director's cue: lit, what is left; done — within what a hand cuts, the engine's run-down
    // anticipated (nodeBurn's) — the engine to cut)
    const cut = burning && leftM - (a === "node" ? this.runDown() * C : 0) <= Math.max(2e-3 * dv, 0.1);
    const cue = { tIgn: burning ? 0 : start, left: leftM, dv, burning, cut };
    const where = circ
      ? this.ourCirc?.where === "pe"
        ? t("the periapsis")
        : t("the apoapsis")
      : pl.burns.length > 1
        ? tf("burn 1 of {0}", pl.burns.length)
        : t("the burn");
    const phase = burning ? t("burning") : start > 120 ? tf("coasting to {0}, the time sped up", where) : tf("turning to {0}", where);
    const rows: [string, string][] = burning
      ? [
          [t("Δv left"), ms(leftM)],
          [t("Burn"), tf("{0} left", leftM / Math.max(thrSI, 1e-9) < 1 ? "< 1 s" : dur(leftM / Math.max(thrSI, 1e-9)))],
        ]
      : [
          [t("Burn in"), dur(start)],
          ["Δv", ms(dv)],
          [t("Duration"), dur(burnT)],
        ];
    if (nowOrbit && aimed && burning) rows.push([t("Orbit now"), nowOrbit]);
    return {
      mode: circ ? "circularize" : a,
      title: circ ? "CIRC" : "NODE",
      phase: cue.cut ? t("Δv delivered — cut the engine") : phase,
      rows,
      next,
      bar: burning ? Math.min(doneM / Math.max(dv, 1e-9), 1) : null,
      graph,
      cue,
    };
  }
  if (a === "circularize") {
    if (fc && this.ourCirc) {
      const r = fc.ctx.r,
        v = fc.ctx.v;
      const rl = Math.hypot(...r);
      const up = r.map((x) => x / rl) as KV3;
      const vr = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
      const vh = v.map((x, i) => x - vr * up[i]!) as KV3;
      const vc = Math.sqrt(fc.ctx.mu / rl);
      const err = Math.hypot(...vh.map((x, i) => x - (vc * x) / Math.hypot(...vh)), vr) || 0;
      return base(
        "CIRC",
        t("trimming to the circle"),
        [
          [t("Error"), ms(err)],
          [t("Orbit"), orbitOf(r, v)],
        ],
        `→ ${tf("circular at {0}", km(rl - fc.ctx.R))}`,
      );
    }
    return base("CIRC", fc?.universe === "ours" ? t("planning the burn") : t("closing on the circular velocity"));
  }
  if (a === "entry") {
    const R = this.entryRun;
    const site = R?.site ? R.site.name.split(",")[0]! : t("the nearest site");
    if (!R) return base("ENTRY", t("starting"));
    if (R.phase === "plan") return base("ENTRY", tf("planning the deorbit to {0}", site));
    const nowS = this.nowTime() * Msec;
    const heat = R.plan
      ? `→ ${tf("then {0} W/cm² · {1} g · shield {2} K, down at {3}", (R.plan.heat / 1e4).toFixed(0), R.plan.g.toFixed(1), Math.round(R.plan.shield), site)}`
      : `→ ${tf("down at {0}", site)}`;
    if (R.phase === "wait")
      return {
        ...base(
          "ENTRY",
          t("coasting to the deorbit burn, the time sped up"),
          [
            [t("Burn in"), dur(R.tBurn - nowS)],
            ["Δv", ms(R.dv)],
            [t("Site"), site],
          ],
          heat,
        ),
        ...this.deorbitAssist(R, nowS),
      };
    if (R.phase === "burn") {
      const D = this.deorbitAssist(R, nowS);
      return {
        ...base(
          "ENTRY",
          D.cue?.cut ? t("Δv delivered — cut the engine") : t("the deorbit burn, retrograde"),
          [
            ["Δv", `${R.done.toFixed(0)} / ${R.dv.toFixed(0)} m/s`],
            [t("Site"), site],
          ],
          heat,
          Math.min(R.done / Math.max(R.dv, 1e-9), 1),
        ),
        ...D,
      };
    }
    const LA = this.airFlight.last;
    if (R.phase === "entry") {
      const miss = R.guid?.lastMiss;
      // (the entry's figures, one card: the site and how far off the heading to it, the flow, the bank asked
      // and flown, the load and its peak, the heat and its trend, the peaks still ahead — the entry's own
      // box once said them again, over the speed tape)
      const D = 180 / Math.PI;
      const side = (rad: number) => (Math.abs(rad * D) < 0.5 ? "" : rad > 0 ? " L" : " R");
      const EI = this.entryInfo();
      const rows: HubRow[] = [[t("Site"), site]];
      if (EI && Number.isFinite(EI.range))
        rows.push([t("Range"), `${km(EI.range)} · Δψ ${Math.abs(EI.dpsi * D).toFixed(1)}°${side(EI.dpsi)}`]);
      // (the flow, the load and the heat once in the air — above it, zeros)
      const inAir = !!LA && LA.out.q > 1;
      if (inAir) rows.push([t("Flow"), `M ${LA.out.mach.toFixed(1)} · q ${(LA.out.q / 1e3).toFixed(1)} kPa`]);
      if (LA) rows.push([t("Height"), km(LA.h)]);
      const bankNow = (this.attitudeNow() as { bank?: number }).bank ?? 0;
      rows.push([
        t("Bank"),
        tf(
          "cmd {0} · now {1}",
          `${Math.round(Math.abs(R.bank * D))}°${side(-R.bank)}`,
          `${Math.round(Math.abs(bankNow * D))}°${side(-bankNow)}`,
        ),
      ]);
      const AF = this.airFlight;
      if (LA && inAir) {
        // (past their marks: the load beyond the flight report's 2.5 g, the heat beyond the peak planned —
        // their trends the card's own, ▲ ▼, as every row's)
        rows.push(hubRow(t("Load"), `${AF.g.toFixed(1)} g · max ${AF.gPeak.toFixed(1)}`, mark(AF.g, 2.5, 4)));
        const q1 = LA.out.heat;
        rows.push(hubRow(t("Heat"), `${(q1 / 1e4).toFixed(q1 < 1e5 ? 1 : 0)} W/cm²`, R.plan ? mark(q1 / R.plan.heat, 1.1, 1.3) : null));
      }
      if (R.plan)
        rows.push([
          t("Peaks ahead"),
          `${(R.plan.heat / 1e4).toFixed(0)} W/cm² · ${Math.round(R.plan.shield)} K · ${R.plan.g.toFixed(1)} g`,
        ]);
      return {
        ...base(
          "ENTRY",
          LA && LA.out.q > 50 ? t("the guided entry — the bank flown to the site") : t("falling to the air"),
          rows,
          miss ? `→ ${tf("hand-over {0} from its aim (Mach {1})", km(miss.dist), R.handover)}` : heat,
        ),
        ...this.entryAssist(R, nowS, rows),
      };
    }
    // the glide
    const app = R.app;
    const legs: Record<string, string> = {
      join: t("joining the runway's axis"),
      toStart: t("to the final's start"),
      downwind: t("downwind"),
      spiral: t("round the alignment circle — too high for the final"),
      turn: t("turning onto the final"),
      final: t("on the final"),
    };
    const profs: Record<string, string> = {
      outer: t("the steep slope"),
      preflare: t("the pull-up"),
      inner: t("the shallow slope"),
      flare: t("the flare"),
      rollout: t("the touchdown"),
    };
    const phase = R.leg === "final" && R.prof ? `${legs.final} — ${profs[R.prof.phase]}` : (legs[R.leg ?? "join"] ?? t("gliding"));
    const rows: HubRow[] = [[t("Site"), site]];
    if (app) {
      rows.push([t("To the threshold"), km(Math.hypot(app.along, app.across))], [t("Height"), km(app.agl)], [t("Speed"), ms(app.speed)]);
      if (R.prof && R.leg === "final")
        rows.push(
          // (off the profile by a fifth of the height (10 m at least): amber; by half of it (30 m): red)
          hubRow(
            t("Profile"),
            `${app.agl - R.prof.h >= 0 ? "+" : "−"}${Math.abs(Math.round(app.agl - R.prof.h))} m`,
            mark(Math.abs(app.agl - R.prof.h), Math.max(10, 0.2 * app.agl), Math.max(30, 0.5 * app.agl)),
          ),
        );
    }
    const td = R.prof?.td ?? LANDING.td;
    const tGo = app ? (td - app.along) / Math.max(app.speed * 0.85, 1) : NaN;
    const rw = R.leg === "final" ? this.runwayView() : null;
    return {
      ...base(
        "ENTRY",
        phase,
        rows,
        app
          ? `→ ${R.leg === "final" && Number.isFinite(tGo) && tGo > 0 ? tf("touchdown {0} m past the threshold in ~{1}", td, dur(tGo)) : tf("touchdown {0} m past the threshold", td)}`
          : null,
      ),
      ...(rw?.final && rw.fix ? this.glideAssist(rw) : {}),
    };
  }
  const sf = this.surfaceInfo() as SurfaceLike | null;
  if (a === "land") {
    if (!sf || sf.alt === undefined) return base("LAND", t("descending"));
    const vs = sf.vVert ?? 0;
    const L = this.landRun;
    const D = L?.cmd ?? null;
    const site = L?.site?.name ?? null;
    // (its phase: the coast to the braking, the descent orbit's burn, the braking, the way to the pad, the touchdown)
    const phase = sf.landed
      ? t("down")
      : D?.coast
        ? site
          ? tf("coasting to the braking for {0}", site)
          : t("coasting")
        : D?.doi
          ? t("the descent orbit's burn: its low point before the pad")
          : (sf.vHor ?? 0) > V_TRANS
            ? site
              ? tf("braking towards {0}", site)
              : t("killing the sideways speed, descending")
            : sf.alt < 30
              ? t("the touchdown")
              : D && Number.isFinite(D.dist) && D.dist > 12
                ? t("across to the pad, descending")
                : t("descending onto the pad");
    const rows: HubRow[] = [];
    if (site) rows.push([t("Site"), site]);
    if (D && Number.isFinite(D.dist)) rows.push([t("To the pad"), km(D.dist)]);
    // (near the ground: falling faster than 3 m/s under 50 m, sliding faster than 2 m/s under 100 m)
    rows.push(
      [t("Height"), km(sf.alt)],
      hubRow("V/S", ms(vs), sf.alt < 50 ? mark(-vs, 2, 3) : null),
      hubRow(t("Sideways"), ms(sf.vHor ?? 0), sf.alt < 100 ? mark(sf.vHor ?? 0, 1, 2) : null),
    );
    if (D?.coast) rows.push([t("Next burn in"), dur(D.tBrake)]);
    const tDown = D && !D.coast && Number.isFinite(D.tGo) ? Math.max(D.tGo, sf.alt / Math.max(-vs, 0.5)) : sf.alt / Math.max(-vs, 0.5);
    const H = base("LAND", phase, rows, sf.landed ? null : `→ ${tf("touchdown in ~{0}, at ~{1} m/s", dur(tDown), V_TD.toFixed(1))}`);
    return sf.landed ? H : { ...H, ...this.descentAssist(sf) };
  }
  if (a === "takeoff") {
    const LG = this.launchGoal;
    const rows: HubRow[] = [];
    // (the height it climbs to: the one asked, else clear of the air — 1.5 × its top — or 3 % of the radius)
    const Rkm = fc ? fc.ctx.R / 1e3 : 0;
    const goal = LG.altKm ?? Math.round(Math.max(1.5 * airTopKm(fc?.body ?? ""), 0.03 * Rkm));
    let next: string | null = `→ ${tf("up to ~{0} km, then CIRC at the apoapsis", goal)}`;
    if (fc) {
      const e = kepElements(fc.ctx.mu, fc.ctx.r, fc.ctx.v, fc.ctx.pole ?? [0, 0, 1]);
      const rl = Math.hypot(...fc.ctx.r);
      rows.push(
        [t("Height"), km(rl - fc.ctx.R)],
        [t("Apoapsis"), e.e < 1 ? km(e.ra - fc.ctx.R) : t("escape")],
        [t("Speed"), tf("{0} % of circular", Math.round((100 * Math.hypot(...fc.ctx.v)) / Math.sqrt(fc.ctx.mu / rl)))],
      );
      if (e.rp > fc.ctx.R) next = `→ ${tf("in orbit: {0} × {1}", km(e.rp - fc.ctx.R), km(e.ra - fc.ctx.R))}`;
    }
    const thick = !!sf && (sf.alt ?? 0) < airTopKm(fc?.body ?? "") * 1e3 * 0.4;
    const H = base("TAKE OFF", thick ? t("climbing through the thick air") : t("the gravity turn, to orbit"), rows, next);
    // our universe: the climb's assistant — the path against its optimum, the countdowns, max-Q
    const nav = this.ourNav(cameraFrame(s));
    if (nav && fc && solidBody(nav.ref)) Object.assign(H, this.climbAssist(nav, fc.ctx.mu, rows));
    return H;
  }
  const N = this.hubNote;
  // (the approach — and the target's orbit on its way there)
  if ((a === "approach" || (a === "orbit" && N.orbitAlt === undefined)) && N.left !== undefined) {
    return {
      ...base(
        a === "orbit" ? "ORBIT" : "APPROACH",
        N.left > 0 ? tf("closing on {0}", N.name ?? "") : t("backing off to the stand-off"),
        [
          [t("To the stand-off"), km(N.left)],
          [t("Closing"), ms(N.closing ?? 0)],
        ],
        `→ ${tf("beside {0} ({1} off) in ~{2}", N.name ?? "", km(N.stand ?? 0), dur(N.ttg ?? NaN))}`,
      ),
      ...this.approachAssist(N.left, N.closing ?? 0, N.name ?? ""),
    };
  }
  if (a === "orbit" && N.orbitAlt !== undefined)
    return base("ORBIT", tf("in orbit around {0}", N.name ?? ""), [[t("Height held"), km(N.orbitAlt)]]);
  if (a === "hover" && N.off !== undefined) {
    const H = base("HOLD POS", t("holding the place"), [
      [t("Off it"), km(N.off)],
      [t("Drift"), ms(N.drift ?? 0)],
    ]);
    // (low over a ground: the descent's graph too — the hold a hover)
    return sf && !sf.landed && sf.alt !== undefined && sf.alt < 5000 ? { ...H, ...this.descentAssist(sf, true) } : H;
  }
  if (a === "dock") return this.dockCard() ?? base("DOCK", this.dockAuto?.phase ?? t("docking"));
  return base(AUTO_NAMES[a].toUpperCase(), t("flying"));
}

/**
 * The circle the pilot asks for: the cheaper of a burn at the next apoapsis and one at the next
 * periapsis — the sooner, both above the air (a hyperbola: its periapsis) —, as the flight computer's
 * circularization (fc/ops.ts). Null: circular already (the trim alone). A string: why not.
 */
function circPlan(
  this: CameraController,
): { burns: Burn[]; note: string; where: "ap" | "pe"; altKm: number; dv: number; t: number } | string | null {
  const fc = this.fcContext();
  if (!fc) return t("Circularize: near a body");
  const c = fc.ctx;
  const el = kepElements(c.mu, c.r, c.v, c.pole ?? [0, 0, 1]);
  const safe = c.R + (airTopKm(fc.body) + 10) * 1e3;
  if (el.e < 1 && el.ra - el.rp < 2e3) return null;
  const cands: { where: "ap" | "pe"; t: number; r: number }[] = [];
  if (el.e < 1 && el.ra > safe) cands.push({ where: "ap", t: kepTimeTo(el, Math.PI), r: el.ra });
  if (el.rp > safe) cands.push({ where: "pe", t: kepTimeTo(el, 0), r: el.rp });
  if (!cands.length)
    return el.e < 1
      ? tf("Circularize: the orbit is in the air (apoapsis {0} km) — raise it first", ((el.ra - c.R) / 1e3).toFixed(0))
      : t("Circularize: the periapsis is in the air or below — no circle on this path");
  // (an apsis half a burn away or passed: the other one, if there is one)
  const ok = cands.filter((q) => Number.isFinite(q.t) && q.t > 20);
  const pick = (ok.length ? ok : cands).sort((a, b) => a.t - b.t)[0]!;
  const r = fcCircularize(c, pick.where);
  if (!r.ok || !r.burns.length) return tf("Circularize: {0}", r.note);
  // (the apsis as the craft will fly to it: the two bodies' of a low Earth orbit is ~10 km and 20 m/s
  // off — the oblateness, the Moon —; their burn kept where the flight's own path is not found)
  const f = this.circFlown(pick.where, r.burns[0]!.t);
  if (f) {
    const burns = [{ ...r.burns[0]!, t: f.t, dv: f.dv }];
    const km = ((f.r - c.R) / 1e3).toFixed(0);
    return { burns, note: tf("Circular at {0} km", km), where: pick.where, altKm: (f.r - c.R) / 1e3, dv: Math.hypot(...f.dv), t: f.t };
  }
  return { burns: r.burns, note: r.note, where: pick.where, altKm: (pick.r - c.R) / 1e3, dv: r.dvTotal, t: r.burns[0]!.t };
}

/**
 * The apsis a circularization burns at, on the path the craft flies (our-predict.ts: the bodies' pulls,
 * the oblateness): the radial rate's turn — downwards at the apoapsis, upwards at the periapsis — nearest
 * the two bodies' time `tS` [s from now]; there, the burn to the mean circle (geopotential.ts
 * meanCircular). Its time [s from now], its Δv (prograde, normal, radial [m/s]) and radius [m]; null:
 * no such turn on the path.
 */
function circFlown(this: CameraController, where: "ap" | "pe", tS: number): { t: number; dv: KV3; r: number } | null {
  const s = this.s;
  const nav = this.ourNav(cameraFrame(s));
  if (!nav || nav.ref === "sun") return null;
  const Msec = 4.925490947e-6 * s.massSolar;
  const path = predictOurs(nav.X, nav.V, nav.t, [], { tMax: (1.3 * tS + 600) / Msec, maxSteps: 20000 });
  const rel = (k: number) => {
    const st = ourState(nav.ref, path.times[k]!);
    const d = sub3(path.pts[k]!, st.pos);
    return { d, v: sub3(path.vels[k]!, st.vel), vr: dot3(d, sub3(path.vels[k]!, st.vel)) / Math.hypot(...d) };
  };
  const want = nav.t + tS / Msec;
  let best: number | null = null;
  let prev = rel(0).vr;
  for (let k = 1; k < path.times.length; k++) {
    const vr = rel(k).vr;
    const turn = where === "ap" ? prev > 0 && vr <= 0 : prev < 0 && vr >= 0;
    if (turn) {
      // (where the rate crosses zero, between the two points)
      const tk = path.times[k - 1]! + ((path.times[k]! - path.times[k - 1]!) * prev) / (prev - vr);
      if (best === null || Math.abs(tk - want) < Math.abs(best - want)) best = tk;
    }
    prev = vr;
  }
  if (best === null || Math.abs(best - want) > (0.25 * Math.max(tS, 600)) / Msec) return null;
  const at = stateAt(path, best);
  if (!at) return null;
  const st = ourState(nav.ref, best);
  const d = sub3(at.X, st.pos),
    v = sub3(at.V, st.vel);
  const g = sub3(circularVelocity(nav.ref, solarBody(nav.ref)!.mass, d, v, best).v, v);
  const P = lin(v, 1 / Math.hypot(...v), v, 0);
  const n = cross(d, v);
  const N = lin(n, 1 / Math.hypot(...n), n, 0);
  const R = cross(N, P);
  return { t: (best - nav.t) * Msec, dv: [dot3(g, P) * C_MPS, dot3(g, N) * C_MPS, dot3(g, R) * C_MPS], r: Math.hypot(...d) * M_METRES };
}

/** The circularization's frame: the plan made (pilot's), or the trim — the circular velocity where it is. */
function ourCircWant(
  this: CameraController,
  nav: NonNullable<ReturnType<CameraController["ourNav"]>>,
  Tg: { pos: Vec3; vel: Vec3; mass: number; radius: number },
  say: (t: string) => null,
  out: (v: Vec3, ff?: Vec3) => { beta: Vec3; ff: Vec3 },
) {
  const P = this.pilot;
  const C = C_MPS;
  const rel = sub3(nav.V, Tg.vel);
  const Rv = sub3(nav.X, Tg.pos);
  const fmtT = (x: number) => (x < 90 ? `${Math.round(x)} s` : x < 5400 ? `${Math.round(x / 60)} min` : `${(x / 3600).toFixed(1)} h`);
  if (!this.ourCirc) {
    const plan = this.circPlan();
    if (typeof plan === "string") return say(plan);
    if (plan) {
      this.fcSetPlan(plan.burns, plan.note);
      const n0 = this.plan.nodes[0] as { then?: string; t: number } | undefined;
      if (n0) n0.then = "circularize";
      this.ourCirc = { mode: "node", where: plan.where, altKm: plan.altKm, dv: plan.dv, tNode: n0?.t, spent0: this.spent };
      P.auto = "none";
      P.setAuto("node");
      this.onPilotMessage?.(
        plan.where === "ap"
          ? tf("Circularize at the apoapsis ({0} km) in {1}: {2} m/s", plan.altKm.toFixed(0), fmtT(plan.t), plan.dv.toFixed(0))
          : tf("Circularize at the periapsis ({0} km) in {1}: {2} m/s", plan.altKm.toFixed(0), fmtT(plan.t), plan.dv.toFixed(0)),
      );
      return out(nav.V);
    }
    this.ourCirc = { mode: "trim", spent0: this.spent };
  }
  // the trim: the circle where the craft is, in its plane — circular in the mean, the body's oblateness
  // in (geopotential.ts meanCircular: the level √(μ/r) swings ~10 km in a low Earth orbit) —, no height held
  const circle = circularVelocity(nav.ref, Tg.mass, Rv, rel, nav.t);
  // (a Hohmann to the height asked being planned: the circle held meanwhile)
  if (this.ourCirc.mode === "await") return out(lin(Tg.vel, 1, circle.v, 1));
  if (this.ourCirc.mode !== "trim") this.ourCirc = { ...this.ourCirc, mode: "trim" };
  const R = this.ourCirc;
  R.since ??= frameNow();
  const err = Math.hypot(...sub3(rel, circle.v)) * C;
  // (done: within 0.2 m/s — or, the trim's minute out, within 2)
  const age = (frameNow() - R.since) / 1000;
  if (err < 0.2 || (age > 60 && err < 2)) {
    const used = (this.spent - (R.spent0 ?? this.spent)) * C;
    this.ourCirc = null;
    P.setAuto("none");
    // (the heights it flies: the mean circle's, its J2 swing about it)
    const km = (r: number) => (((r - Tg.radius) * M_METRES) / 1e3).toFixed(0);
    this.onPilotMessage?.(
      tf("Circular: {0} × {1} km — {2} m/s spent", km(circle.r0 - circle.X), km(circle.r0 + circle.X), used.toFixed(0)),
    );
    // (a mission into orbit, arrived off the height it asked — the aim's miss, a correction flown short:
    // a Hohmann to it, once; the circle held while it is planned — the Moon's mission once circled at
    // 23 km for 100)
    const G = this.heightGoal;
    this.heightGoal = null;
    const meanKm = ((circle.r0 - Tg.radius) * M_METRES) / 1e3;
    if (G && G.body === nav.ref && Math.abs(meanKm - G.altKm) > Math.max(2, 0.01 * G.altKm)) {
      this.ourCirc = { mode: "await", spent0: this.spent };
      P.setAuto("circularize");
      this.onPilotMessage?.(tf("{0} km for the {1} asked: a Hohmann to it", meanKm.toFixed(0), G.altKm.toFixed(0)));
      void this.planOurs("orbit", "orbit", G.altKm, 0).then(() => {
        if (this.ourCirc?.mode !== "await") return;
        this.ourCirc = null;
        if (this.ourMission && this.plan.nodes.length) {
          this.ourMission.trim = true;
          P.auto = "none";
          P.setAuto("node");
        } else P.setAuto("none");
      });
      return out(lin(Tg.vel, 1, circle.v, 1));
    }
    return null;
  }
  return out(lin(Tg.vel, 1, circle.v, 1));
}

function autopilotWant(this: CameraController, cam: ReturnType<typeof cameraFrame>): Want | null {
  const s = this.s;
  const P = this.pilot;
  const say = (t: string) => {
    P.setAuto("none");
    this.onPilotMessage?.(t);
    return null;
  };
  const dtau = cam.region === "hole" ? cam.zamo.alpha / cam.gamma : 1 / cam.gamma;
  const T = Math.max(1.2 * s.timeSpeed * dtau, 1e-3);
  // our universe: Newtonian autopilots in the home frame
  if (this.ourNav(cam)) return this.ourWant(cam, say, T);
  if (P.auto === "dock") return say(tf("Docking: with the ISS, in our solar system"));
  if (P.auto === "hover") {
    if (cam.region !== "hole") return { beta: [0, 0, 0], ff: [0, 0, 0] };
    const z = cam.zamo;
    // a static observer moves at −ωϖ/α relative to the ZAMO; none inside the ergosphere (hold the ZAMO)
    const vs = (-z.omega * z.varpi) / z.alpha;
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    if (!P.anchor) P.anchor = X;
    const f = sphericalFrame(X);
    const d = sub3(P.anchor, X);
    let back: Vec3 = [dot3(d, f.er), dot3(d, f.et), dot3(d, f.ep)];
    const bl = Math.hypot(...back);
    const k = Math.min(1 / (4 * T), 0.08 / Math.max(bl, 1e-9));
    back = lin(back, k, back, 0);
    return { beta: [back[0], back[1], (Math.abs(vs) < 0.99 ? vs : 0) + back[2]], ff: lin(this.freeFallAccel(cam), -1, cam.beta, 0) };
  }
  if (P.auto === "circularize") {
    if (cam.region !== "hole") return say(tf("Circularize: only around the black hole"));
    const c = this.circularWant(cam);
    return typeof c === "string" ? say(c) : c;
  }
  if (P.auto === "transfer") return this.transferWant(cam, say);
  if (P.auto === "land" || P.auto === "takeoff") return this.surfaceWant(cam, say);
  if (P.auto === "orbit") {
    // a circular orbit around the star (in its orbital plane), at the distance it was engaged at
    if (cam.region !== "hole") return say(tf("Orbit: only in the black hole's universe"));
    const mB = bodyMass(s, s.target);
    if (s.target === "hole" || s.target === "barycentre" || !(mB > 0)) return say(tf("Orbit: select a body with a mass (Tab)"));
    if (this.landed) return say(tf("Landed on {0}", BODY_NAMES[s.target]));
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    const f = sphericalFrame(X);
    const t = this.nowTime();
    const C = bodyCentre(s, s.target, t);
    const V = bodyVelocity(s, s.target, t);
    const R = bodyRadius(s, s.target);
    const rel = sub3(X, C);
    const d = Math.hypot(...rel);
    const Vs = this.fromZamo(cam, f, cam.beta);
    // the orbit's plane: the star's (its orbital plane around the hole), or the one the ship is in
    const h0 = cross(rel, sub3(Vs, V));
    const hl = Math.hypot(...h0);
    const n: Vec3 = s.target === "star" || hl < 1e-18 ? [0, 0, 1] : lin(h0, 1 / hl, h0, 0);
    if (!P.anchor) {
      // (the sense it goes round now; the distance now, kept above the surface and well inside the
      // body's Hill sphere, where the hole's tides no longer tear the orbit apart)
      const hill = bodyHill(s, s.target, t);
      const lo = s.target === "star" ? 2.4 * R : 1.03 * R;
      const hi = s.target === "star" ? 0.17 * starOrbitRadius(s) : Math.max(0.3 * hill, 1.1 * lo);
      // (around a planet the plane is the ship's own, n = ĥ: always the positive sense)
      P.anchor = [clamp(d, lo, hi), s.target === "star" ? Math.sign(h0[2]) || 1 : 1, 0];
    }
    const [d0, sense] = P.anchor as [number, number, number];
    const planet = s.target !== "star";
    if (planet && d > 2 * d0) {
      // far from it still (a planet's Hill sphere is a few radii): fly in first — towards a point
      // beside the body at the orbit's radius (the fall then ends in a pericentre there, not on the
      // ground: a weak engine could not stop a fall straight at it — Miller pulls 1.3 g at its
      // surface), at the speed that a braking at half thrust can still kill, its velocity matched
      const rhat0 = lin(rel, 1 / d, rel, 0);
      let across = cross([0, 0, 1], rhat0);
      if (Math.hypot(...across) < 1e-6) across = cross([1, 0, 0], rhat0);
      across = lin(across, 1 / Math.hypot(...across), across, 0);
      const aim = sub3(axpy(C, across, d0), X);
      const to = lin(aim, 1 / Math.hypot(...aim), aim, 0);
      const span = d - d0;
      // (and slow enough that the Coriolis push of the hole's frame, 2Ω v, stays within the engine)
      const thr = this.thrustMax();
      // (the braking left: half the engine less the body's own pull here)
      const brake = Math.max(0.5 * thr - mB / (d * d), 0.1 * thr);
      const vIn = Math.min(0.05, Math.sqrt(2 * brake * span), span / (4 * T), thr / (4 * this.holeOmega(C)));
      const Wa = axpy(V, to, vIn);
      const ba = this.toZamo(cam, f, Wa);
      return { beta: ba, ff: this.followFF(cam, ba) };
    }
    // (the circular speed around it, in its proper time: in the scene's time, × its clock rate dτ/dt)
    // (settled in orbit: the warp a low-thrust cruise ran at is given back)
    if (this.warpAfter !== null && Math.abs(d - d0) < 0.2 * d0) {
      this.giveBackWarp(this.warpAfter);
      this.warpAfter = null;
    }
    const clock = s.target === "star" ? 1 : bodyState(GARGANTUA_SYSTEM, s.target, t).dtau;
    // (around a planet: circular at the distance it is at, spiralling down to d0 over a few turns —
    // the circle of d0 from farther out would fling it back out)
    const dc = planet ? clamp(d, d0, 2 * d0) : d0;
    const vc = Math.sqrt(mB / dc) * clock;
    const w0 = vc / dc;
    const relP = sub3(rel, lin(n, dot3(rel, n), n, 0));
    const tl = Math.hypot(...relP) || 1;
    const tdir = lin(cross(lin(n, sense, n, 0), relP), 1 / tl, n, 0);
    const rhat = lin(rel, 1 / Math.max(d, 1e-30), rel, 0);
    // distance and plane errors closed over a fraction of an orbit
    const vr = planet ? clamp(-(d - d0) * w0 * 0.3, -0.15 * vc, 0.15 * vc) : clamp(-(d - d0) * w0 * 0.6, -0.3 * vc, 0.3 * vc);
    const vz = clamp(-dot3(rel, n) * w0 * 0.6, -0.3 * vc, 0.3 * vc);
    const W = axpy(axpy(axpy(V, tdir, vc), rhat, vr), n, vz);
    const bw = this.toZamo(cam, f, W);
    return { beta: bw, ff: planet ? this.followFF(cam, bw) : [0, 0, 0] };
  }
  if (P.auto === "approach") {
    if (cam.region !== "hole") return say(tf("Approach: only in the black hole's universe"));
    if (s.target === "hole" || s.target === "barycentre") return say(tf("Approach: select a body (Tab)"));
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    const f = sphericalFrame(X);
    const t = this.nowTime();
    const C = bodyCentre(s, s.target, t);
    const mB = bodyMass(s, s.target);
    const star = mB > 0; // a body with its own pull: the star, a planet
    const stand = s.target === "star" ? 4 * s.sunRadius : s.target === "wormhole" ? 1.3 * mouth(s).rGlue : 3 * bodyRadius(s, s.target);
    const away = sub3(X, C);
    const dist = Math.hypot(...away);
    if (this.warpAfter !== null && dist < 3 * stand) {
      this.giveBackWarp(this.warpAfter);
      this.warpAfter = null;
    }
    const goal = axpy(C, away, stand / Math.max(dist, 1e-9));
    const d = sub3(goal, X);
    const dl = Math.hypot(...d);
    // (no faster than a braking at half thrust can kill, nor than the hole's frame lets the engine
    // follow: its Coriolis push 2Ω v)
    const thr = this.thrustMax();
    const close = Math.min(0.25, dl / (5 * T), Math.sqrt(thr * dl), thr / (4 * this.holeOmega(C)));
    const V: Vec3 = bodyVelocity(s, s.target, t);
    const W = axpy(V, d, close / Math.max(dl, 1e-30));
    const loc = this.toZamo(cam, f, W);
    if (star) {
      // the hole's pull is shared with the star (both fall); its own pull is not: cancel it
      if (this.landed) return say(tf("Landed on {0}", BODY_NAMES[s.target]));
      const g = lin(away, mB / Math.max(dist, bodyRadius(s, s.target)) ** 3, away, 0);
      return { beta: loc, ff: [dot3(g, f.er), dot3(g, f.et), dot3(g, f.ep)] };
    }
    // a static mouth is held against gravity; an orbiting one falls freely, and so does the ship
    if (s.whOrbit) return { beta: loc, ff: [0, 0, 0] };
    return { beta: loc, ff: lin(this.freeFallAccel(cam), -1, cam.beta, 0) };
  }
  return null;
}

/**
 * The camera's future free-fall path (no thrust) in the black hole's frame, for the overlay:
 * recomputed at most 4 times a second; near the mouth, a segmented prediction runs at 2 Hz.
 */
function predictPath(this: CameraController) {
  const now = frameNow();
  if (!this.gravity) {
    this.wormholePath = null;
    return (this.path = null);
  }
  const s = this.s;
  const cam = cameraFrame(s);
  const entry = this.tunnelEntry ?? tunnelEntrySide(cam.ell, dot3(cam.beta, cam.n));
  const context = wormholeMapPose(s, cam, this.nowTime(), cam.fwd, entry)?.context ?? "hole";
  if (this.predictionContext !== context) {
    // (the plans worked out in the last frame — a mission previewed, a planner at work, the computer's
    // candidate — no longer apply: said, not dropped silently; the flight plan itself is kept)
    if (this.predictionContext !== "" && (this.pendingMission || this.planBusy || this.fcCand))
      this.onPilotMessage?.(t("Planning dropped: the ship changed frames (the wormhole, or the scene's settings) — plan again"));
    this.predictionContext = context;
    this.predictionGeneration++;
    this.planGen++;
    this.planBusy = false;
    this.pendingMission = null;
    this.fcCand = null;
    this.wormholePath = null;
    this.wormholePathKey = "";
    this.wormholePredictionError = null;
    this.wormholePending = 0;
    this.path = null;
    this.pathKey = "";
    this.ourFree = null;
    this.ourFreeKey = "";
    this.predicting = false;
    this.kerrPending = false;
    this.ourPlan = null;
    this.farPlan = null;
    this.farBusy = false;
  }
  const generation = this.predictionGeneration;
  // same state (e.g. time paused): same path object, so the renderer keeps converging
  const key = [
    s.spin,
    s.anchor,
    s.distance,
    s.inclination,
    s.azimuth,
    s.whL,
    s.velR,
    s.velT,
    s.velP,
    s.wormhole,
    s.whDist,
    s.whIncl,
    s.whAzimuth,
    s.whRho,
    s.whLength,
    s.whLensing,
    s.whOrbit,
    s.whPhase,
    s.massSolar,
    s.system,
    s.sun,
    s.sunMass,
    s.sunOrbit,
    this.nowTime(),
  ].join();
  if (nearWormhole(s, this.nowTime())) {
    this.ourFree = null;
    if (
      this.wormholePending ||
      (this.wormholePathKey !== "" && now - this.wormholePathAt < 500) ||
      (this.wormholePath && this.wormholePathKey === key)
    )
      return (this.path = null);
    const token = (this.wormholePending = generation + 1);
    this.wormholePathKey = key;
    this.wormholePathAt = now;
    runPlanner<WormholePath | { error: string }>({ kind: "wormholePath", s: { ...s }, t: this.nowTime(), entry })
      .then((p) => {
        if (generation !== this.predictionGeneration) return;
        if (p && "samples" in p) {
          this.wormholePath = p;
          this.wormholePredictionError = null;
        } else if (p && "error" in p) this.wormholePredictionError = p.error;
      })
      .catch((error: unknown) => {
        if (generation === this.predictionGeneration) this.wormholePredictionError = String(error);
      })
      .finally(() => {
        if (this.wormholePending === token) this.wormholePending = 0;
      });
    return (this.path = null);
  }
  this.wormholePath = null;
  this.wormholePredictionError = null;
  // (at most 4 times a second, and never more than a fifth of the frame time)
  if (this.path && (key === this.pathKey || now - this.path.at < Math.max(250, 5 * this.pathCost))) return this.path;
  this.pathKey = key;
  // our universe: the Newtonian prediction (the map draws it), no path in the hole's frame
  const nav = this.ourNav(cam);
  if (nav) {
    // (the same throttle: there is no path object on this side to carry its time; computed in the
    // planner's worker — up to ~17 ms a time on the main thread — the first one here)
    if (this.predicting || (this.ourFree && (key === this.ourFreeKey || now - this.ourFreeAt < 250))) return (this.path = null);
    this.ourFreeKey = key;
    this.ourFreeAt = now;
    const mouthR = mouth(s).w.rho;
    // (the first one here, whole: without it the telemetry and the map fall back to costlier work —
    // measured: a 150–220 ms task when it came from the worker a few frames later)
    if (!this.ourFree) {
      this.ourFree = predictOurs(nav.X, nav.V, nav.t, [], { mouthR, drag: this.dragPerMass() });
      return (this.path = null);
    }
    this.predicting = true;
    runPlanner<OurPath>({ kind: "predict", X: nav.X, V: nav.V, t: nav.t, mouthR, drag: this.dragPerMass() }).then(
      (p) => {
        if (generation !== this.predictionGeneration) return;
        this.predicting = false;
        if (p && Array.isArray(p.pts) && this.ourFreeKey === key) this.ourFree = p;
      },
      () => {
        if (generation === this.predictionGeneration) this.predicting = false;
      },
    );
    return (this.path = null);
  }
  this.ourFree = null;
  if (cam.region !== "hole") return (this.path = null);
  // in one of Gargantua's worlds' frames: the orbit about the world (its two bodies), not the hole's
  // geodesic (a world's orbit about the hole, drawn from the ship — meaningless at its scale)
  if (this.local && !this.local.L.landed) {
    const tr = this.localTrack([], 1.05, 240);
    if (tr) {
      this.localGround = tr.rot;
      const p = { pts: tr.pts.slice(1), fate: "local" as const, at: now, dt: tr.dt };
      return (this.path = p);
    }
  }
  const st = fromZamo(cam.r, cam.theta, cam.phi, cam.beta, s.spin, this.nowTime());
  // up to 0.95 of a turn around the hole: a bound orbit shows almost a full revolution without
  // coming back past the camera (a segment that close would sweep across the whole view)
  const tMax = clamp(2 * 2 * Math.PI * cam.r ** 1.5, 300, 60000);
  // (in the planner's worker — 6–12 ms a time here before —: the last path drawn meanwhile)
  if (this.kerrPending) return this.path;
  this.kerrPending = true;
  // (the answer kept — a few hundred ms old at most — unless the ship has left the hole's region: the
  // key holds the clock and the ship's motion, so in flight it is never the same twice — and a path
  // left from elsewhere, old, let every call renew it: every answer was dropped, none drawn)
  runPlanner<{ pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "star" } | { error: string }>({
    kind: "kerrPath",
    s: { ...s },
    st,
    tMax,
  }).then(
    (r) => {
      if (generation !== this.predictionGeneration) return;
      this.kerrPending = false;
      if (!r || "error" in r || cameraFrame(this.s).region !== "hole" || this.ourNav(cameraFrame(this.s))) return;
      this.path = this.kerrPathFrom(r, st, tMax, now);
    },
    () => {
      if (generation === this.predictionGeneration) this.kerrPending = false;
    },
  );
  return this.path;
}

/** The drift over the ground near a world (the horizontal part of the velocity over it), camera
 *  coordinates; null when still or away from the ground. */
function driftDir(this: CameraController, cam: ReturnType<typeof cameraFrame>, C: (v: Vec3) => Vec3 | null): Vec3 | null {
  const fr = this.sfFrame(cam);
  if (!fr) return null;
  const vh = lin(fr.vRel, 1, fr.up, -dot3(fr.vRel, fr.up));
  if (Math.hypot(...vh) < 0.05) return null;
  return C(fr.toLocal(vh));
}

/**
 * The runway in reach (the HUD's H4): the entry's own when it flies to one, else the nearest on this
 * world within 80 km, the craft below 20 km — its outline, its centreline drawn 15 km back, the aim
 * point 2 km short of the threshold (the glide path's), as the eye sees them; the craft's place along
 * it and across it [m], the glide path asked and flown (the approach's, when it flies).
 */
function runwayView(this: CameraController): RunwayView | null {
  const now = frameNow();
  if (this.runwayCache && now - this.runwayCache.at < 100) return this.runwayCache.v;
  const v = this.runwayCompute();
  this.runwayCache = { at: now, v };
  return v;
}

function runwayCompute(this: CameraController): RunwayView | null {
  const cam = cameraFrame(this.s);
  const fr = this.entryFrame(cam);
  if (!fr) return null;
  const x = fr.s.x;
  const R = this.entryRun;
  let site: Site | null = R?.site?.runway ? R.site : null;
  const agl = this.aglNow(cam, Math.hypot(...x) - fr.env.R);
  if (!site) {
    if (agl > 20e3) return null;
    let best = 80e3;
    for (const st of SITES) {
      if (st.body !== fr.body || !st.runway) continue;
      const T = fr.place(st);
      const ang = Math.acos(clamp(dot3(unitV(T), unitV(x)), -1, 1));
      const d = ang * Math.hypot(...T);
      if (d < best) (best = d), (site = st);
    }
  }
  if (!site) return null;
  const C = (v: Vec3): Vec3 => [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)];
  const D = Math.PI / 180;
  const T = fr.place(site);
  const tu = unitV(T);
  const nav = this.ourNav(cam);
  const pole: Vec3 = nav ? unitV(spinAxis(fr.body)) : [0, 0, 1];
  const north = unitV(lin(pole, 1, tu, -dot3(pole, tu)));
  const east = cross(north, tu);
  const hd = (site.rwy ?? 0) * D;
  const along = lin(north, Math.cos(hd), east, Math.sin(hd));
  const rgt = cross(along, tu);
  const see = (P: Vec3) => {
    const d = sub3(P, x);
    return { d: C(fr.toLocal(d)), r: Math.hypot(...d) };
  };
  const L = 4500,
    Wd = 90;
  const at = (a: number, b: number) => lin(lin(T, 1, along, a), 1, rgt, b);
  const rel = sub3(x, T);
  const sAl = dot3(rel, along),
    xt = dot3(rel, rgt);
  const app = R?.app ?? null;
  // the motion over the ground: its speed, its path's angle, its heading against the runway's
  const va = sub3(fr.s.v, fr.env.ground(x));
  const vv = dot3(va, tu);
  const vhv = lin(va, 1, tu, -vv);
  const vh = Math.hypot(...vhv);
  // a hand-flown final (no autopilot on it): on the runway's axis — within a fifth of the distance, 1.5 km
  // at least —, heading down it, below 6 km, within 40 km: the profile the pilot's own, as the
  // autopilot's would be from where the final begins, frozen there — the pilot's drift from it shown.
  // In the air: the wheels down (the autopilot's rollout, handed over at the touchdown), no final — a
  // profile begun there would be one from the ground, its steep slope flat
  const manual =
    this.pilot.auto !== "entry" &&
    !this.rolling &&
    !this.ourLanded &&
    sAl > -40e3 &&
    sAl < LANDING.td &&
    Math.abs(xt) < Math.max(1500, 0.2 * -sAl) &&
    agl < 6000 &&
    vh > 30 &&
    dot3(vhv, along) > 0.85 * vh;
  // (the autopilot's final: its profile from the final's start — the steep slope following the craft, frozen
  // as the pull-up nears —, as the autopilot flies it: shown only once frozen, 5 km out, the final's first
  // minute had no graph, its gates no PAPI)
  let fix: LandingFix | null = app?.final ? (R?.gOuter ?? landingProfile(sAl, agl, Math.max(app.speed, 50)).fix) : null;
  if (manual) {
    const MF = this.manualFix?.site === site.name ? this.manualFix.fix : null;
    const L0 = landingProfile(sAl, agl, Math.max(vh, 50), MF ?? undefined);
    fix = L0.fix;
    if (!MF) this.manualFix = { site: site.name, fix };
  } else if (!app?.final) this.manualFix = null;
  // the final's aids: the landing profile ahead — gates every 1.5 km down it, and the PAPI: the
  // height's deviation from it as an angle seen from the touchdown, in lights
  let papi: number | null = null;
  const gates: { d: Vec3; r: number }[][] = [];
  let gRef: number | null = app?.final ? (app.gRef ?? null) : null;
  let flareIn: number | null = null;
  let aimX = R?.prof?.aim ?? -2000;
  if (fix) {
    const sp = Math.max(app?.final ? app.speed : vh, 50);
    const L = landingProfile(sAl, agl, sp, fix);
    aimX = L.aim;
    if (manual) gRef = Math.atan(L.slope);
    // (the flare's start: twice its height over the inner slope before the touchdown)
    const xF = LANDING.td - (2 * LANDING.hF) / Math.tan(LANDING.gi);
    const vAlong = dot3(vhv, along);
    if (sAl < xF && vAlong > 1) flareIn = (xF - sAl) / vAlong;
    const dev = (Math.atan2(agl - L.h, Math.max(LANDING.td - sAl, 200)) * 180) / Math.PI;
    papi = dev > 1 ? 4 : dev > 0.35 ? 3 : dev >= -0.35 ? 2 : dev >= -1 ? 1 : 0;
    for (let k = 1; k <= 5; k++) {
      const xk = sAl + k * 1500;
      if (xk > LANDING.td - 300) break;
      const hk = landingProfile(xk, agl, sp, fix).h;
      // (the site's frame is in metres: the gate hk up its local vertical)
      const corner = (b: number, dh: number) => see(lin(at(xk, b), 1, tu, hk + dh));
      gates.push([corner(-100, -40), corner(100, -40), corner(100, 40), corner(-100, 40)]);
    }
  }
  return {
    papi,
    gates,
    name: site.name.split(",")[0]!,
    rwy: site.rwy ?? 0,
    along: sAl,
    across: xt,
    agl,
    corners: [at(0, -Wd / 2), at(L, -Wd / 2), at(L, Wd / 2), at(0, Wd / 2)].map(see),
    line: Array.from({ length: 16 }, (_, k) => see(at(-k * 1000, 0))),
    aim: see(at(aimX, 0)),
    gRef,
    gam: app?.final ? (app.gam ?? null) : manual ? Math.atan2(vv, vh) : null,
    final: !!app?.final || manual,
    fix,
    manual,
    speed: vh,
    flareIn,
  };
}

/**
 * The future in the view (the HUD's H3), from the predicted free fall (ours: the n-body path; Gargantua's
 * side: the geodesic, or a world's orbit): what the eye sees of it — each sample's direction (camera
 * coordinates), distance [m], time ahead [s], and whether the body hides it —, the ship's places at
 * the times asked ([s] ahead), and where it meets the ground (on the ground as it turns now — the spot
 * to look at) or the air's top. The path is kept relative to its body (the body's own motion out of it:
 * where the ship goes about the world the eye sees). Recomputed ten times a second at most.
 */
function futureView(this: CameraController, at: number[] = []): FutureView | null {
  const now = frameNow();
  const key = at.join();
  if (this.futureCache && now - this.futureCache.at < 100 && this.futureCache.key === key) return this.futureCache.v;
  const v = this.futureCompute(at);
  this.futureCache = { at: now, key, v };
  return v;
}

function futureCompute(this: CameraController, at: number[]): FutureView | null {
  const s = this.s;
  // (the prediction refreshed here too — throttled —: the HUD needs it with the tube and the map off)
  this.predictPath();
  const cam = cameraFrame(s);
  const C = (v: Vec3): Vec3 => [dot3(v, cam.right), dot3(v, cam.up), dot3(v, cam.fwd)];
  const nav = this.ourNav(cam);
  // the samples: positions (relative to the body, at the body's place now), their times ahead [s]
  let P: Vec3[] = [],
    T: number[] = [],
    eye: Vec3,
    look: (d: Vec3) => Vec3,
    mPer: number;
  let body: { c: Vec3; R: number } | null = null;
  let impact: FutureView["impact"] = null;
  if (nav) {
    const free = this.ourFree;
    if (!free || free.pts.length < 2) return null;
    const ref = free.refs[0] ?? nav.ref;
    const b = solarBody(ref);
    const t0 = nav.t;
    const B0 = solarState(ref, t0).pos;
    // (from where the ship is now: the path's first sample may be seconds ahead)
    P.push(nav.X);
    T.push(0);
    // near the ground, in the air: the path over the ground as it turns (the frame the craft flies
    // in — at Kennedy the Earth's turn is 400 m/s); higher, the orbit as it is (not turning)
    const turn = !!b && b.kind !== "star" && altitudeOver(ref, nav.X, t0) < Math.max(airTop(b.atmosphere), 60e3);
    const A0 = turn ? bodyAxes(b!, t0) : null;
    // (each sample relative to the body at its own time — and on the body's turning axes then: fixed
    // for a path, kept with it, not recomputed ten times a second)
    const rel = relOfPath(free, ref, b);
    for (let j = 0; j < free.pts.length; j++) {
      const t = free.times[j]!;
      if (t <= t0) continue;
      const vb = rel.body[j]!;
      const v = A0 ? lin(lin(A0[0], vb[0], A0[1], vb[1]), 1, A0[2], vb[2]) : rel.v[j]!;
      P.push(lin(v, 1, B0, 1));
      T.push((t - t0) * M_SECONDS);
    }
    eye = cameraHome(s, cam);
    // (the mouth's geometry once for all the points, not once a point)
    const w = mouth(s).w;
    look = (d) => ourLook(s, cam, d, w);
    mPer = M_METRES;
    if (b && b.kind !== "star") {
      body = { c: B0, R: b.radius };
      const top = airTop(b.atmosphere) / M_METRES;
      const axes = bodyAxes(b, t0);
      const alt = (X: Vec3) => cartToGeodetic(b.radius, flatteningOf(ref), axes.map((axis) => dot3(sub3(X, B0), axis)) as Vec3).h;
      // the air's top crossed on the way down (from above it)
      if (top > 0 && P.length && alt(P[0]!) > top) {
        for (let j = 1; j < P.length; j++)
          if (alt(P[j]!) <= top) {
            impact = { kind: "air", t: T[j]!, ...this.futureSee(C, look, eye, P[j]!, mPer, body) };
            break;
          }
      }
      if (free.fate === "impact" && free.hit === ref) {
        // (the ground there, turned back to where it is now: the spot to look at)
        const tI = free.times[free.times.length - 1]!;
        const v = sub3(free.pts[free.pts.length - 1]!, solarState(ref, tI).pos);
        const A1 = bodyAxes(b, tI),
          A0 = bodyAxes(b, t0);
        const vb: Vec3 = [dot3(v, A1[0]), dot3(v, A1[1]), dot3(v, A1[2])];
        const X = lin(lin(lin(A0[0], vb[0], A0[1], vb[1]), 1, A0[2], vb[2]), 1, B0, 1);
        const ground = { kind: "ground" as const, t: (tI - t0) * M_SECONDS, ...this.futureSee(C, look, eye, X, mPer, null) };
        impact = impact && impact.kind === "air" ? { ...impact, ground } : ground;
      }
    }
  } else {
    const path = this.path;
    // (a path left from another place — a world's orbit after leaving it —: none)
    if (!path || cam.region !== "hole" || path.pts.length < 2 || (path.fate === "local") !== !!(this.local && !this.local.L.landed))
      return null;
    const Msec = 4.925490947e-6 * s.massSolar;
    eye = blToCartesian(cam.r, cam.theta, cam.phi);
    const t0 = this.nowTime();
    // (about one of Gargantua's worlds: its orbit relative to it; about the hole: the geodesic as it is)
    const w = this.local && path.fate === "local" ? (this.local.F.id as Body) : null;
    const W0 = w ? bodyCentre(s, w, t0) : null;
    P.push(w ? lin(sub3(eye, bodyCentre(s, w, t0)), 1, W0!, 1) : eye);
    T.push(0);
    path.pts.forEach((X, j) => {
      const t = t0 + (j + 1) * path.dt;
      P.push(w ? lin(sub3(X, bodyCentre(s, w, t)), 1, W0!, 1) : X);
      T.push((j + 1) * path.dt * Msec);
    });
    look = (d) => this.holeLook(cam, d);
    mPer = 1476.625 * s.massSolar;
    body = w ? { c: W0!, R: bodyRadius(s, w) } : { c: [0, 0, 0], R: horizon(s.spin) };
    if (path.fate === "horizon" || path.fate === "star")
      impact = { kind: path.fate, t: T[T.length - 1]!, ...this.futureSee(C, look, eye, P[P.length - 1]!, mPer, null) };
    // (about the hole the seconds are nothing — a sample is minutes to hours —: the path's eighth,
    // quarter and half instead, unless times were asked that it reaches)
    const span = T[T.length - 1]!;
    if (!at.some((t) => t > span * 0.02 && t <= span)) at = [span / 8, span / 4, span / 2];
  }
  const pts = P.map((X, j) => ({ ...this.futureSee(C, look, eye, X, mPer, body), t: T[j]! }));
  // the ship's places at the times asked (interpolated along the path)
  const marks = at
    .filter((t) => t > 0 && t <= T[T.length - 1]!)
    .map((t) => {
      let j = 1;
      while (j < T.length - 1 && T[j]! < t) j++;
      const f = Math.min(Math.max((t - T[j - 1]!) / Math.max(T[j]! - T[j - 1]!, 1e-9), 0), 1);
      return { t, ...this.futureSee(C, look, eye, lin(P[j - 1]!, 1 - f, P[j]!, f), mPer, body) };
    });
  return { pts, marks, impact };
}

/** A free-fall path's samples relative to its body at their own times, and on the body's axes then. */
const relCache = new WeakMap<object, { ref: string; v: Vec3[]; body: Vec3[] }>();
function relOfPath(free: { pts: Vec3[]; times: number[] }, ref: string, b: ReturnType<typeof solarBody>) {
  const hit = relCache.get(free);
  if (hit && hit.ref === ref) return hit;
  const v: Vec3[] = [],
    body: Vec3[] = [];
  for (let j = 0; j < free.pts.length; j++) {
    const t = free.times[j]!;
    const r = sub3(free.pts[j]!, solarState(ref, t).pos);
    v.push(r);
    if (b && b.kind !== "star") {
      const A1 = bodyAxes(b, t);
      body.push([dot3(r, A1[0]), dot3(r, A1[1]), dot3(r, A1[2])]);
    } else body.push(r);
  }
  const out = { ref, v, body };
  relCache.set(free, out);
  return out;
}

/** A point of the future as the eye sees it: its direction (camera coordinates), distance [m], hidden
 *  by the body (its sphere between the eye and the point, or the point inside it). */
function futureSee(
  this: CameraController,
  C: (v: Vec3) => Vec3,
  look: (d: Vec3) => Vec3,
  eye: Vec3,
  X: Vec3,
  mPer: number,
  body: { c: Vec3; R: number } | null,
) {
  const d = sub3(X, eye);
  const l = Math.hypot(...d);
  let hid = false;
  if (body && l > 0) {
    const oc = sub3(body.c, eye);
    const tc = dot3(oc, d) / l;
    const miss2 = dot3(oc, oc) - tc * tc;
    hid = Math.hypot(...sub3(X, body.c)) < body.R * 0.999 || (tc > 0 && tc < l && miss2 < body.R * body.R);
  }
  return { d: l > 0 ? C(look(d)) : ([0, 0, 1] as Vec3), r: l * mPer, hid };
}

/** A direction from the eye in the hole's frame (Cartesian), as the moving ship sees it (local
 *  components, aberration included) — the target's way (targetDir). */
function holeLook(this: CameraController, cam: ReturnType<typeof cameraFrame>, d: Vec3): Vec3 {
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const f = sphericalFrame(X);
  const l = Math.hypot(...d) || 1;
  const n: Vec3 = [dot3(d, f.er) / l, dot3(d, f.et) / l, dot3(d, f.ep) / l];
  const b = cam.beta;
  const b2 = dot3(b, b);
  if (b2 < 1e-12) return n;
  const g = 1 / Math.sqrt(1 - b2);
  const bn = dot3(n, b) / Math.sqrt(b2);
  const w = axpy(axpy(n, b, g), b, ((g - 1) * bn) / Math.sqrt(b2));
  return lin(w, 1 / Math.hypot(...w), w, 0);
}

/** The free-fall path's points (from the worker) cut to what the overlay draws. */
function kerrPathFrom(
  this: CameraController,
  r: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "star" },
  st: ReturnType<typeof fromZamo>,
  tMax: number,
  now: number,
) {
  const s = this.s;
  const p: { pts: Vec3[]; fate: "horizon" | "escape" | "continues" | "wormhole" | "star" } = { pts: r.pts, fate: r.fate };
  // keep at most 0.95 of a turn around the hole (accumulated angle of the position vector)
  let turned = 0;
  for (let i = 1; i < p.pts.length; i++) {
    const u = p.pts[i - 1]!,
      v = p.pts[i]!;
    const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
    turned += Math.acos(Math.min(1, Math.max(-1, c)));
    if (turned > 0.95 * 2 * Math.PI) {
      p.pts = p.pts.slice(0, i);
      p.fate = "continues";
      break;
    }
  }
  if (s.wormhole) {
    // the Kerr prediction stops where the path enters the far mouth (beyond: the other universe)
    const m = mouth(s);
    const i = p.pts.findIndex((q) => Math.hypot(q[0] - m.C[0], q[1] - m.C[1], q[2] - m.C[2]) < m.rGlue);
    if (i >= 0) (p.pts = p.pts.slice(0, Math.max(i + 1, 2))), (p.fate = "wormhole");
  }
  this.pathCost = 0;
  return {
    ...p,
    at: now,
    dt: tMax / 480,
    hit: p.fate === "star" ? this.nearestBody(p.pts.at(-1)!, st.t + p.pts.length * (tMax / 480)) : undefined,
  };
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installLowthrust(C: { prototype: CameraController }) {
  Object.assign(C.prototype, {
    planLowThrust,
    coorbit,
    rendezvousGuidance,
    lineClears,
    transferWant,
    circularWant,
    ourPeriod,
    targetVelLocal,
    maneuverDir,
    ourWant,
    ourSurfaceWant,
    landWant,
    levelHeading,
    hubInfo,
    hubCompute,
    climbAssist,
    deorbitAssist,
    glideAssist,
    glideCard,
    descentAssist,
    approachAssist,
    dockCard,
    descentCard,
    entryAssist,
    circPlan,
    circFlown,
    ourCircWant,
    autopilotWant,
    predictPath,
    driftDir,
    runwayView,
    runwayCompute,
    futureView,
    futureCompute,
    futureSee,
    holeLook,
    kerrPathFrom,
  });
}
