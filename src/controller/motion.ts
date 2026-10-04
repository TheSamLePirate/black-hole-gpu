// The CameraController — free flight and gravity: the camera's and the ship's integrators.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { GEARS, gearForces, mulM3, tippedOver, touchdownVerdict, worldTensor, type GearOut } from "../gear";
import { tf } from "../i18n";
import { inv3 } from "../pilot";
import { secularZonal } from "../system/geopotential";
import { blToCartesian, cameraFrame, repPose, repToHolePose, setHolePose, setHomePose, setRepPose } from "../camera";
import { TUNING } from "../game/tuning";
import { horizon, type Vec3 } from "../physics";
import { BODY_NAMES, type Body } from "../targeting";
import { advance, fromZamo, toZamo } from "../geodesic";
import { spinFromZamo, spinToZamo } from "../gyro";
import { airTop } from "../aero";
import { GEAR, localToZamo, planetFrame, stepLocal, toGlobal, zamoBeta, zamoToLocal } from "../landing";
import { fleet } from "../fleet";
import { VESSELS } from "../vessels";
import { flyDneg, holeToRep, mouth, radius, repToHole, sphericalFrame, toMouth, type Dneg } from "../wormhole";
import { gravityHome, homeOf, homeToRep, OUR_BODIES, ourGravity, ourState, referenceBody, repToHomeVec, soiOf } from "../system/our-side";
import { symmetricStep, YOSHIDA } from "../system/our-predict";
import { keplerProp } from "../system/our-plan";
import {
  airDensity as ourAir,
  altitudeOver,
  dragAccel,
  figureUp,
  fromBodyFixed,
  railsDecay,
  gearHeight,
  groundUnder,
  heightOverGround,
  groundSpeeds,
  groundVelocity,
  solidBody,
  toBodyFixed,
} from "../system/our-surface";
import { solarBody } from "../system/solar";
import { C_MPS, G0, M_METRES } from "../units";
import { add as axpy, cross, dot as dot3, lin, sub as sub3 } from "../math/vec3";

import type { CameraController } from "../controls";
import { MAX_RANGE, add3, homeOfPose, normalize, rotateAbout, spinAxis, spinRate, unitV } from "./util";

declare module "../controls" {
  interface CameraController {
    fly: typeof fly;
    fall: typeof fall;
    fallStep: typeof fallStep;
    flyHome: typeof flyHome;
    stableOrbit: typeof stableOrbit;
    ourSurfaceInfo: typeof ourSurfaceInfo;
    setOurLanded: typeof setOurLanded;
  }
}

/**
 * Moves the camera along a direction given in its own axes (forward, right, up) at a speed
 * proportional to the distance to the nearest object, keeping its orientation (parallel transport).
 * Near the wormhole: a spatial geodesic of the Dneg metric (it can cross the throat); near the hole:
 * a straight line. The camera re-anchors to the nearest object.
 */
function fly(this: CameraController, local: Vec3, dt: number) {
  const s = this.s;
  const rH = horizon(s.spin);
  const n = Math.hypot(...local);
  const k = n * dt;
  // (near a planet, a moon, a star: its surface's distance too — a metre at least — not the hole's
  // or the mouth's alone, tens of M away: the keys would throw the camera at millions of km/s)
  const near = Math.max(Math.min(this.surfaceDistance(), this.nearShip), 1 / (1476.625 * s.massSolar));
  const c: Vec3 = [local[0] / n, local[1] / n, local[2] / n];
  /** Camera axes in the flat frame of the hole (hole region). */
  const holeAxes = () => {
    const cam = cameraFrame(s);
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    const f = sphericalFrame(X);
    const w = (v: Vec3) => add3(f.er, f.et, f.ep, v);
    const fw = w(cam.fwd),
      rt = w(cam.right),
      up = w(cam.up);
    return { X, r: cam.r, fw, up, d: lin(lin(fw, c[0], rt, c[1]), 1, up, c[2]) };
  };
  if (!s.wormhole) {
    const h = holeAxes();
    const Y = axpy(h.X, h.d, k * Math.min(h.r - rH, 100, near));
    if (Math.hypot(...Y) < rH + 0.3 || Math.hypot(...Y) > MAX_RANGE) return;
    setHolePose(s, Y, h.fw, h.up);
    s.anchor = "hole";
    this.sync();
    return;
  }
  const m = mouth(s);
  const p = repPose(s);
  const rw = radius(m.w, p.l)[0];
  const toHole = p.l > 0 ? Math.hypot(...repToHole(m, p.l, p.n)) : Infinity;
  const ds = k * Math.min(Math.max(Math.min(rw - 0.5 * m.w.rho, toHole - rH), 0.2 * m.w.rho), 100, near);
  const nearMouth = p.l <= 0 || rw < toHole;
  if (nearMouth) {
    const right = cross(p.fwd, p.up);
    const d = normalize(lin(lin(p.fwd, c[0], right, c[1]), 1, p.up, c[2]));
    const q = flyDneg(m.w, p.l, p.n, d, [p.fwd, p.up], ds);
    const pose = { l: q.l, n: q.n, fwd: q.vectors[0]!, up: q.vectors[1]! };
    if (radius(m.w, pose.l)[0] > MAX_RANGE) return;
    if (pose.l > 0) {
      const h = repToHolePose(s, pose);
      const dHole = Math.hypot(...h.X);
      if (dHole < rH + 0.3) return;
      if (dHole < radius(m.w, pose.l)[0]) setHolePose(s, h.X, h.fwd, h.up);
      else setRepPose(s, pose);
    } else setRepPose(s, pose);
  } else {
    const h = holeAxes();
    const Y = axpy(h.X, h.d, ds);
    if (Math.hypot(...Y) < rH + 0.3 || Math.hypot(...Y) > MAX_RANGE) return;
    const rep = holeToRep(m, Y);
    if (rep.r < Math.hypot(...Y)) setRepPose(s, { l: rep.l, n: rep.n, fwd: toMouth(m, h.fw), up: toMouth(m, h.up) });
    else setHolePose(s, Y, h.fw, h.up);
  }
  this.sync();
}

/**
 * Advances the camera as a massive body by simDt of coordinate time (the scene's time): a Kerr
 * geodesic near the hole (thrust = proper acceleration along the camera's axes), inertial motion
 * along the spatial geodesics of the wormhole metric near the mouth (it has no gravity, g_tt = −1).
 * The orientation is kept fixed with respect to the distant stars (a gyroscope, flat far field).
 */
function fall(this: CameraController, simDt: number, keys: Vec3, fast: boolean, acc?: Vec3) {
  // (the ship's clock after the step: the scene's time follows it — see shipClock)
  const t1 = this.nowTime() + simDt;
  this.shipTime = this.fallStep(simDt, keys, fast, acc) ?? t1;
}

function fallStep(this: CameraController, simDt: number, keys: Vec3, fast: boolean, acc?: Vec3): number | undefined {
  const s = this.s;
  const a = s.spin;
  const kn = Math.hypot(...keys);
  // (acc: a proper acceleration given directly, local components — the Ranger's engines)
  const accel = acc ? Math.hypot(...acc) : kn > 0 ? s.thrust * (fast ? 5 : 1) : 0;
  const cam = cameraFrame(s);
  if (cam.region === "hole") {
    const X0 = blToCartesian(cam.r, cam.theta, cam.phi);
    const f0 = sphericalFrame(X0);
    const w0 = (v: Vec3) => add3(f0.er, f0.et, f0.ep, v);
    const dirZ: Vec3 = acc
      ? accel > 0
        ? lin(acc, 1 / accel, acc, 0)
        : [0, 0, 0]
      : kn > 0
        ? normalize(lin(lin(cam.fwd, keys[0], cam.right, keys[1]), 1, cam.up, keys[2]))
        : [0, 0, 0];
    // near a planet: its own frame (landing.ts)
    const lf = this.localFlight(cam, X0);
    if (lf) {
      const t0 = this.nowTime();
      const { F, L } = lf;
      const dtau = simDt / F.ut;
      const was = L.landed;
      // (the flown craft: its own aerodynamics, its axes on the planet's local ones)
      const axL = this.shipAxesLocal(cam).map((v) => zamoToLocal(unitV(v))) as [Vec3, Vec3, Vec3];
      const aero = acc && F.atm ? this.airFlight.forceFn(F.atm, F.id, fleet.massProps().mass, axL, this.spinPhysical()) : undefined;
      const nUp = unitV(L.xi);
      const wheels = acc
        ? {
            side: axL[0],
            level: dot3(axL[1], nUp) > Math.cos((25 * Math.PI) / 180),
            brake: this.pilot.throttle <= 0 && this.pilot.auto === "none",
            lands: VESSELS[fleet.active].lands,
          }
        : undefined;
      const r = stepLocal(F, L, dtau, zamoToLocal(lin(dirZ, accel, dirZ, 0)), aero, wheels);
      const bodyName = BODY_NAMES[F.id as Body];
      if (r.touchdown)
        this.onPilotMessage?.(`Touchdown on ${bodyName} · ${r.touchdown.vn.toFixed(1)} m/s down, ${r.touchdown.vh.toFixed(0)} m/s along`);
      if (r.airborne) this.onPilotMessage?.(`Airborne · ${(Math.hypot(...L.w) * C_MPS).toFixed(0)} m/s`);
      this.properTime += dtau;
      this.landed = L.landed || !!L.rolling;
      const F1 = planetFrame(F.id, t0 + simDt, a, s.massSolar);
      this.local!.F = F1;
      const g = toGlobal(F1, L);
      const b = zamoBeta(g.X, g.V, a);
      const f1 = sphericalFrame(g.X);
      const w1 = (v: Vec3) => add3(f1.er, f1.et, f1.ep, v);
      // (the ship's attitude keeps its components on the ZAMO axes: it turns with the planet)
      setHolePose(s, g.X, w1(cam.fwd), w1(cam.up), w1(b));
      s.motion = "geodesic";
      this.targetDistance = s.distance;
      this.local!.key = this.poseKeyNow();
      if (r.impact !== null && !was) {
        // (the Ranger rests on its belly: levelled on the ground, nose on the horizon)
        this.levelShip(localToZamo([L.xi[0], L.xi[1], L.xi[2]]));
        const name = BODY_NAMES[F.id as Body];
        const v = r.impact;
        this.onPilotMessage?.(
          v > TUNING.crashSpeed ? `Crashed on ${name} at ${v.toFixed(0)} m/s` : `Landed on ${name} · ${v.toFixed(1)} m/s`,
        );
        if (v > TUNING.crashSpeed) this.crashed(`${VESSELS[fleet.active].name}: crashed on ${name} at ${v.toFixed(0)} m/s`);
        if (this.pilot.auto !== "none" && this.pilot.auto !== "takeoff") this.pilot.setAuto(this.pilot.auto);
      }
      return t0 + simDt;
    }
    const st0 = fromZamo(cam.r, cam.theta, cam.phi, cam.beta, a, this.nowTime());
    // (the ship's axes as gyroscopes — Fermi–Walker, gyro.ts —, or held on the distant stars)
    const gyro = s.gyroscopes ? [spinFromZamo(st0, a, cam.beta, cam.fwd), spinFromZamo(st0, a, cam.beta, cam.up)] : undefined;
    const res = advance(st0, a, simDt, 0.05, accel, dirZ, this.lens(), undefined, gyro);
    this.landed = res.landed;
    this.properTime += res.tau;
    const st = res.st;
    const X1 = blToCartesian(st.r, st.th, st.ph);
    const f1 = sphericalFrame(X1);
    const b1 = toZamo(st, a);
    const vel = add3(f1.er, f1.et, f1.ep, b1);
    if (gyro && !res.stopped) {
      const w1 = (v: Vec3) => add3(f1.er, f1.et, f1.ep, v);
      const fw = unitV(spinToZamo(st, a, b1, gyro[0]!));
      const upG = spinToZamo(st, a, b1, gyro[1]!);
      setHolePose(s, X1, w1(fw), w1(unitV(lin(upG, 1, fw, -dot3(upG, fw)))), vel);
    } else setHolePose(s, X1, w0(cam.fwd), w0(cam.up), vel);
    s.motion = "geodesic";
    this.targetDistance = s.distance;
    return st.t;
  }
  // near the wormhole: straight (geodesic) motion at constant speed, thrust changes γβ
  const m = mouth(s);
  const p = repPose(s);
  const right = cross(p.fwd, p.up);
  // (the thrust over a time dt: γβ changed along the thrust's direction — acc is in the camera
  // frame's rep components here, like p.fwd)
  const thrust = (dt: number) => {
    const v = p.vel;
    if (!(accel > 0)) return v;
    const d = acc ? lin(acc, 1 / accel, acc, 0) : normalize(lin(lin(p.fwd, keys[0], right, keys[1]), 1, p.up, keys[2]));
    const g = 1 / Math.sqrt(Math.max(1 - (v[0] ** 2 + v[1] ** 2 + v[2] ** 2), 1e-9));
    const U = lin(v, g, d, accel * dt);
    return lin(U, 1 / Math.sqrt(1 + U[0] ** 2 + U[1] ** 2 + U[2] ** 2), U, 0);
  };
  // our universe: the Newtonian pull of the solar system, in sub-steps short against the time it
  // takes to fall towards its nearest body (a warp beyond them: the ship's clock lags the request)
  const t0 = this.nowTime();
  const ours = p.l < -m.w.a && s.system === "gargantua";
  // (our side: the home frame's Cartesian flight — the planner's — down to 12 throat radii, where
  // the Dneg space is flat to 0.4 %; closer, along the metric's geodesics, through the throat)
  if (ours && homeOfPose(m.w, p).r > 12 * m.w.rho) return this.flyHome(p, thrust(simDt), simDt, t0, m.w, !!acc);
  let steps = 1;
  let span = simDt;
  if (ours) {
    const tDyn = ourGravity(m.w, p.l, p.n, t0).tDyn;
    span = Math.min(simDt, this.subCap * 0.01 * tDyn);
    steps = Math.min(Math.max(Math.ceil(span / (0.01 * tDyn)), 1), this.subCap);
  }
  // (the thrust of the time flown, not of the frame asked: a capped warp gave free Δv)
  let v = thrust(span);
  let pose = { l: p.l, n: p.n, fwd: p.fwd, up: p.up };
  const dt = span / steps;
  for (let i = 0; i < steps; i++) {
    // (kick, drift along the geodesic, kick: second order — the half kicks carried by the geodesic's
    // parallel transport of the velocity)
    if (ours) {
      const g = ourGravity(m.w, pose.l, pose.n, t0 + i * dt);
      if (g.inside) {
        v = homeToRep(m.w, pose.l, pose.n, ourState(g.inside, t0 + i * dt).vel);
        break;
      }
      v = lin(v, 1, g.acc, dt / 2);
    }
    const speed = Math.hypot(...v);
    this.properTime += dt * Math.sqrt(Math.max(1 - speed * speed, 0));
    if (speed >= 1e-12) {
      const q = flyDneg(m.w, pose.l, pose.n, lin(v, 1 / speed, v, 0), [pose.fwd, pose.up], speed * dt);
      pose = { l: q.l, n: q.n, fwd: q.vectors[0]!, up: q.vectors[1]! };
      v = lin(q.dir, speed, q.dir, 0);
    }
    if (ours) {
      const g = ourGravity(m.w, pose.l, pose.n, t0 + (i + 1) * dt);
      if (!g.inside) v = lin(v, 1, g.acc, dt / 2);
      const sp = Math.hypot(...v);
      if (sp > 0.999) v = lin(v, 0.999 / sp, v, 0);
    }
  }
  setRepPose(s, { ...pose, vel: v });
  s.motion = "geodesic";
  this.sync();
  return t0 + span;
}

/**
 * Our universe far from the mouth (flat): velocity Verlet in the home frame's Cartesian
 * coordinates, the attitude fixed against the stars; a body met: the ship rests on it.
 */
function flyHome(this: CameraController, p: ReturnType<typeof repPose>, vRep: Vec3, simDt: number, t0: number, w: Dneg, flown = false) {
  const s = this.s;
  let X = homeOf(w, p.l, p.n);
  let V = repToHomeVec(w, p.l, p.n, vRep);
  let fwd = repToHomeVec(w, p.l, p.n, p.fwd);
  let up = repToHomeVec(w, p.l, p.n, p.up);
  // (this frame's thrust: the velocity change the engines made before the fall)
  const dvT = sub3(V, repToHomeVec(w, p.l, p.n, p.vel));
  // on the ground: carried by the turning body, until the engine lifts the ship
  if (this.ourLanded) {
    const L = this.ourLanded;
    const b = OUR_BODIES.find((q) => q.id === L.body)!;
    // (on the ground as it is known now: a scene placed before the Earth's relief was read back
    // stood at its sphere, inside the mountain — raised onto it once the heights are in)
    const qr = Math.hypot(...L.q);
    const off = GEAR - heightOverGround(L.body, L.q);
    if (Math.abs(off) > 1) {
      const k = 1 + off / M_METRES / qr;
      L.q = [L.q[0] * k, L.q[1] * k, L.q[2] * k];
    }
    const Xg = fromBodyFixed(L.body, L.q, t0);
    const upL = figureUp(L.body, Xg, t0);
    const gSurf = b.mass / Math.hypot(...sub3(Xg, ourState(L.body, t0).pos)) ** 2;
    // (pushed along the ground past the wheels' resistance: rolling)
    const along = Math.hypot(...lin(dvT, 1, upL, -dot3(dvT, upL)));
    const rolls = flown && VESSELS[fleet.active].lands && along > 0.02 * gSurf * simDt;
    if (dot3(dvT, upL) > gSurf * simDt * 1.001 || rolls) {
      this.ourLanded = null;
      this.landed = false;
      X = Xg;
      V = lin(groundVelocity(L.body, Xg, t0), 1, dvT, 1);
      if (rolls && dot3(dvT, upL) <= gSurf * simDt * 1.001) this.rolling = { body: L.body };
      else this.onPilotMessage?.(`Lift-off from ${BODY_NAMES[L.body as Body]}`);
    } else {
      const t1 = t0 + simDt;
      const X1 = fromBodyFixed(L.body, L.q, t1);
      // (the attitude turns with the ground)
      const ang = spinRate(L.body) * simDt;
      const ax = unitV(spinAxis(L.body));
      this.properTime += simDt;
      setHomePose(s, X1, unitV(rotateAbout(fwd, ax, ang)), unitV(rotateAbout(up, ax, ang)), groundVelocity(L.body, X1, t1));
      s.motion = "geodesic";
      this.landed = true;
      this.sync();
      return t1;
    }
  }
  // the ground under the ship: the body of the sphere of influence, if solid (its air: drag)
  const ref = referenceBody(X, t0);
  const ground = solidBody(ref) ? ref : null;
  const atm = ref !== "sun" ? solarBody(ref)?.atmosphere : undefined;
  const airy = !!atm && flown;
  let g = gravityHome(X, t0, V);
  // (the flown craft's own aerodynamics — its attitude, its configuration — in the home frame)
  const right = cross(fwd, up);
  const S = this.shipMatrix();
  const axes = [0, 1, 2].map((i) => unitV(lin(lin(right, S[0]![i]!, up, S[1]![i]!), 1, fwd, S[2]![i]!))) as [Vec3, Vec3, Vec3];
  const aero = airy ? this.airFlight.forceFn(atm, ref, fleet.massProps().mass, axes, this.spinPhysical()) : null;
  const kA = M_METRES / C_MPS ** 2;
  let aAir = 0;
  // the landing gear (gear.ts): the flown craft's legs on a solid ground — springs and dampers along the
  // ground's normal, tyres, brakes —; its torque turns the craft after the frame (this.gearDw)
  const gdef = flown && ground && VESSELS[fleet.active].lands ? GEARS[fleet.active] : undefined;
  const mass = fleet.massProps().mass;
  const secM = M_METRES / C_MPS;
  const Iw = gdef ? worldTensor(fleet.massProps().I, axes) : null;
  // (the centre of mass, from the reference point: the gear's torque about it)
  const comB = fleet.massProps().com;
  const comW = (): Vec3 => lin(lin(axes[0], comB[0], axes[1], comB[1]), 1, axes[2], comB[2]);
  const IwInv = Iw ? inv3(Iw) : null;
  // (the gear's change of the craft's turn over the frame; on the gear, the whole turn is integrated here)
  let gearDw: Vec3 = [0, 0, 0];
  const turnAll = !!gdef && this.turnOnGear;
  let gearOut: GearOut | null = null;
  // (the wheel brakes, the engine idle, once every wheel is down — the nose wheel lowered first: braked
  // on the mains alone at speed, the craft would slam its nose down)
  const allDown = !!gdef && this.gearLast?.contact === gdef.legs.length;
  const brake = this.pilot.throttle <= 0 && this.pilot.auto === "none" && allDown ? 1 : 0;
  const steer = this.noseSteer;
  // (the craft's turn in the home frame: the camera's basis — right = fwd × up — is left-handed there,
  // the pilot's rates turn the other way: ω = −Σ ωᵢ axisᵢ [rad/s])
  const wWorld = (): Vec3 =>
    lin(
      lin(axes[0], -(this.pilot.omega[0] + gearDw[0]), axes[1], -(this.pilot.omega[1] + gearDw[1])),
      1,
      axes[2],
      -(this.pilot.omega[2] + gearDw[2]),
    );
  const gearAt = (Xq: Vec3, Vq: Vec3, tq: number): Vec3 => {
    if (!gdef || !ground) return [0, 0, 0];
    // (cheap far off: the legs reach some metres below the reference point)
    if (gearHeight(ground, Xq, tq) > 12) {
      gearOut = null;
      return [0, 0, 0];
    }
    const gv = groundVelocity(ground, Xq, tq);
    const Vrel = sub3(Vq, gv);
    gearOut = gearForces(
      gdef,
      { mass, X: [0, 0, 0], V: [Vrel[0] * C_MPS, Vrel[1] * C_MPS, Vrel[2] * C_MPS], axes, w: wWorld(), brake, steer, com: comW() },
      groundUnder(ground, Xq, tq),
    );
    return lin(gearOut.F, kA / mass, gearOut.F, 0);
  };
  const accAt = (Xq: Vec3, Vq: Vec3, tq: number, gq: typeof g) => {
    const aG = gearAt(Xq, Vq, tq);
    if (!aero) return lin(gq.acc, 1, aG, 1);
    const h = altitudeOver(ref, Xq, tq);
    // (the wing's height over the ground: its ground effect — the reference point is the gear's height up)
    this.airFlight.cfg.agl = ground ? gearHeight(ground, Xq, tq) + GEAR : undefined;
    // (the air's own motion: the wind — the craft flies through the air, not over the ground)
    const vg = sub3(Vq, groundVelocity(ref, Xq, tq));
    const va = this.windHome ? sub3(vg, this.windHome) : vg;
    const f = aero(h, [va[0] * C_MPS, va[1] * C_MPS, va[2] * C_MPS]);
    const a: Vec3 = [f[0] * kA, f[1] * kA, f[2] * kA];
    aAir = Math.hypot(...a) / (Math.hypot(...va) + 1e-30);
    return lin(lin(gq.acc, 1, a, 1), 1, aG, 1);
  };
  // steps: a small part of the fall time; near the ground, of the time to reach it
  const stepOf = () => {
    // (fourth order in the vacuum: longer steps — the map's prediction's own)
    let dt = airy ? 0.01 * g.tDyn : symmetricStep(0.025, g.tDyn, g.tDot);
    if (ground || airy) {
      const h = Math.max(gearHeight(ref, X, t), 0) / M_METRES;
      const vr = Math.hypot(...sub3(V, groundVelocity(ref, X, t))) + 1e-12;
      dt = Math.min(dt, Math.max((0.1 * h) / vr, 2e-4));
      // (a small part of the time the air takes to change the speed)
      if (aAir > 0) dt = Math.min(dt, Math.max(0.05 / aAir, 1e-6));
      // (on the gear, or about to be: steps of 4 ms — its springs' few hertz)
      if (gdef && gearHeight(ref, X, t) < 12) dt = Math.min(dt, 0.004 / secM);
    }
    return dt;
  };
  let t = t0;
  const tEnd = t0 + simDt;
  // on rails: a stable orbit, the engine off, a frame a good part of a turn — Kepler's orbit
  // around the body, carried along with it (as KSP's time warp)
  const rails = Math.hypot(...dvT) < 1e-15 ? this.stableOrbit(X, V, t0) : null;
  if (rails && simDt > 0.02 * rails.period) {
    const kp = keplerProp(rails.mass, sub3(X, ourState(rails.ref, t0).pos), sub3(V, ourState(rails.ref, t0).vel), simDt);
    // (the body's oblateness: its secular drift — the node's regression, the periapsis's turn)
    const kz = secularZonal(rails.ref, rails.mass, kp.r as Vec3, kp.v as Vec3, simDt, t0);
    // (and the thin air's: the orbit's decay)
    const k = railsDecay(rails.ref, rails.mass, kz.r, kz.v, simDt);
    const B = ourState(rails.ref, tEnd);
    X = lin(B.pos, 1, k.r, 1);
    V = lin(B.vel, 1, k.v, 1);
    this.properTime += simDt * Math.sqrt(Math.max(1 - dot3(V, V), 0));
    setHomePose(s, X, unitV(fwd), unitV(up), V);
    s.motion = "geodesic";
    this.sync();
    return tEnd;
  }
  let a = accAt(X, V, t, g);
  let touched: { speed: number; vh?: number; wheels?: boolean; gear?: "landed" | "hard" | "crashed" | "tipped" } | null = null;
  for (let i = 0; i < this.subCap && t < tEnd - 1e-12; i++) {
    // (the velocity before this step: a touchdown is judged by the sink it came down with, not by what
    // the springs gave back within it)
    const Vin = V;
    const dt = Math.min(stepOf(), tEnd - t);
    // (in the vacuum, clear of the ground: Yoshida's fourth-order composition — the planner's
    // integrator; the flight follows its plans over months)
    let last = dt;
    const tn = t + dt;
    if (!airy && !(ground && gearHeight(ground, X, t) < 1e5)) {
      for (const w of YOSHIDA.slice(0, 2)) {
        const h = w * dt;
        V = lin(V, 1, a, h / 2);
        X = lin(X, 1, V, h);
        t += h;
        g = gravityHome(X, t, V);
        a = g.acc;
        V = lin(V, 1, a, h / 2);
      }
      const h = YOSHIDA[2]! * dt;
      V = lin(V, 1, a, h / 2);
      X = lin(X, 1, V, h);
      t = tn;
      last = h;
      // (the thermosphere, above the flight's air: its drag a small kick each step — an orbit decays)
      if (atm) V = lin(V, 1, dragAccel(ref, X, V, t), dt);
    } else {
      V = lin(V, 1, a, dt / 2);
      X = lin(X, 1, V, dt);
      t = tn;
    }
    g = gravityHome(X, t, V);
    // (found deep in the ground — a scene placed before the relief was known, the relief come in under
    // it —: set on it, its fall stopped, no spring flung from metres down)
    if (gdef && ground && gearHeight(ground, X, t) < -1.5) {
      const n = unitV(sub3(X, ourState(ground, t).pos));
      X = lin(X, 1, n, -gearHeight(ground, X, t) / M_METRES);
      const vr = sub3(V, groundVelocity(ground, X, t));
      if (dot3(vr, n) < 0) V = lin(V, 1, n, -dot3(vr, n));
    }
    // rolling on the ground (no gear of its own: held on it, the wheels' friction along it, the tyres'
    // grip across — a gear's craft is on its springs, below)
    if (!gdef && this.rolling && ground === this.rolling.body) {
      const P = ourState(ground, t).pos;
      const n = unitV(sub3(X, P));
      const gv = groundVelocity(ground, X, t);
      let vr = sub3(V, gv);
      const vn = dot3(vr, n);
      // (pressed on it: the weight less the lift and the turn of the ground's curve)
      const aNow = accAt(X, V, t, g);
      const vt = lin(vr, 1, n, -vn);
      const press = -dot3(aNow, n) - dot3(vt, vt) / Math.hypot(...sub3(X, P)) + dot3(dvT, n) * (-1 / simDt);
      if (press <= 0 && vn >= 0) {
        this.rolling = null;
        this.rollSite = null;
        this.onPilotMessage?.(`Airborne · ${(Math.hypot(...vt) * C_MPS).toFixed(0)} m/s`);
      } else {
        X = lin(X, 1, n, -gearHeight(ground, X, t) / M_METRES);
        vr = vt;
        const sp = Math.hypot(...vr);
        if (sp > 0) {
          // (rolling 0.015, braking 0.3 with the engine at idle; across: the tyres, 0.6)
          const side = unitV(lin(axes[0], 1, n, -dot3(axes[0], n)));
          const vs = dot3(vr, side);
          const fl = Math.max(press, 0) * dt;
          const mu = 0.015 + (this.pilot.throttle <= 0 && this.pilot.auto === "none" ? 0.3 : 0);
          const vsN = Math.sign(vs) * Math.max(Math.abs(vs) - 0.6 * fl, 0);
          let va = lin(vr, 1, side, vsN - vs);
          const sa = Math.hypot(...va);
          if (sa > 0) va = lin(va, Math.max(sa - mu * fl, 0) / sa, va, 0);
          vr = va;
        }
        V = lin(gv, 1, vr, 1);
        // (at rest, the engine idle: standing)
        if (Math.hypot(...vr) * C_MPS < 0.05 && this.pilot.throttle <= 0) {
          this.rolling = null;
          this.rollSite = null;
          this.ourLanded = { body: ground, q: toBodyFixed(ground, X, t) };
          V = gv;
          break;
        }
      }
    }
    // touchdown on a solid ground — coming down onto it (just lifted off, the gear a few mm up and
    // the home ↔ rep round trip as fine as that: climbing, it is no landing)
    else if (
      !gdef &&
      ground &&
      gearHeight(ground, X, t) < 0 &&
      dot3(sub3(V, groundVelocity(ground, X, t)), sub3(X, ourState(ground, t).pos)) < 0
    ) {
      const gv = groundVelocity(ground, X, t);
      const P = ourState(ground, t).pos;
      const n = unitV(sub3(X, P));
      const vr = sub3(V, gv);
      const vn = dot3(vr, n) * C_MPS;
      const vh = Math.hypot(...lin(vr, 1, n, -dot3(vr, n))) * C_MPS;
      // (on its wheels: belly down, wings level enough, not too fast — the vertical speed is the crash)
      const level = dot3(axes[1], n) > Math.cos((25 * Math.PI) / 180);
      const wheels = flown && VESSELS[fleet.active].lands && level && vh > 0.5 && vh < 220;
      touched = { speed: wheels ? -vn : Math.hypot(vn, vh), vh, wheels };
      if (wheels && -vn <= TUNING.crashSpeed) {
        X = lin(X, 1, n, -gearHeight(ground, X, t) / M_METRES);
        V = lin(gv, 1, vr, 1);
        V = lin(V, 1, n, -dot3(vr, n));
        this.rolling = { body: ground };
        continue;
      }
      // (resting on the relief, the gear on it)
      X = lin(X, 1, n, -gearHeight(ground, X, t) / M_METRES);
      V = gv;
      this.ourLanded = { body: ground, q: toBodyFixed(ground, X, t) };
      break;
    }
    if (g.inside) {
      // (into a body with no ground to stand on: resting on its surface, moving with it)
      const b = ourState(g.inside, t);
      const r = OUR_BODIES.find((q) => q.id === g.inside)!.radius;
      const d = lin(X, 1, b.pos, -1);
      X = lin(b.pos, 1, d, (r * 1.0000001) / Math.hypot(...d));
      V = b.vel;
      break;
    }
    a = accAt(X, V, t, g);
    V = lin(V, 1, a, last / 2);
    const sp = Math.hypot(...V);
    if (sp > 0.999) V = lin(V, 0.999 / sp, V, 0);
    // the gear's events: its torque turning the craft, the touchdown judged, a tip-over, at rest, airborne
    if (gdef && ground) {
      const o = gearOut as GearOut | null;
      if (o && o.contact > 0) {
        const al = mulM3(IwInv!, o.M);
        const dtSec = last * secM;
        gearDw = [0, 1, 2].map((i) => gearDw[i]! - dot3(al, axes[i]!) * dtSec) as Vec3;
        // (and the craft turned within the frame — its legs' compression answering its turn: a frame's
        // impulse on a frozen attitude would fling it; on the gear, its whole turn, the pilot's too)
        const wt: Vec3 = turnAll
          ? [this.pilot.omega[0] + gearDw[0], this.pilot.omega[1] + gearDw[1], this.pilot.omega[2] + gearDw[2]]
          : gearDw;
        const wg = lin(lin(axes[0], -wt[0], axes[1], -wt[1]), 1, axes[2], -wt[2]);
        const ang = Math.hypot(...wg) * dtSec;
        if (ang > 1e-12) {
          const k = unitV(wg);
          fwd = rotateAbout(fwd, k, ang);
          up = rotateAbout(up, k, ang);
          for (let j = 0; j < 3; j++) axes[j] = rotateAbout(axes[j]!, k, ang);
        }
        const n = unitV(sub3(X, ourState(ground, t).pos));
        const gv = groundVelocity(ground, X, t);
        const vr = sub3(V, gv);
        if (!this.rolling) {
          const vin = sub3(Vin, gv);
          const sink = -dot3(vin, n) * C_MPS;
          const vh = Math.hypot(...lin(vin, 1, n, -dot3(vin, n))) * C_MPS;
          const verdict = touchdownVerdict(sink, TUNING.crashSpeed, s.gearForgiving);
          touched = { speed: sink, vh, wheels: true, gear: verdict };
          if (verdict === "crashed") {
            X = lin(X, 1, n, -gearHeight(ground, X, t) / M_METRES);
            V = gv;
            this.ourLanded = { body: ground, q: toBodyFixed(ground, X, t) };
            break;
          }
          this.rolling = { body: ground };
          this.rollSince = t;
          // (the ground spoilers out at the touchdown itself — the lift dumped before any bounce)
          if (this.pilot.throttle <= 0) this.groundSpoilers = true;
        } else if (tippedOver(gdef, axes[1], n)) {
          touched = { speed: Math.hypot(...vr) * C_MPS, wheels: true, gear: "tipped" };
          V = gv;
          this.rolling = null;
          this.ourLanded = { body: ground, q: toBodyFixed(ground, X, t) };
          break;
        }
        // (at rest on all its legs, the engine idle, not turning: standing — carried by the ground)
        const still = Math.hypot(...vr) * C_MPS < 0.05 && Math.hypot(...wWorld()) < 0.003;
        if (o.contact === gdef.legs.length && still && this.pilot.throttle <= 0) {
          this.rolling = null;
          this.rollSite = null;
          this.ourLanded = { body: ground, q: toBodyFixed(ground, X, t) };
          V = gv;
          gearDw = [0, 0, 0];
          this.pilot.omega = [0, 0, 0];
          break;
        }
      } else if (this.rolling && (!o || o.contact === 0)) {
        // (off the ground: a bounce says nothing — two seconds on the wheels first —, a lift-off its speed)
        const vt = sub3(V, groundVelocity(ground, X, t));
        const spd = Math.hypot(...vt) * C_MPS;
        if (spd > 20 && (t - this.rollSince) * secM > 2) this.onPilotMessage?.(tf("Airborne · {0} m/s", spd.toFixed(0)));
        this.rolling = null;
        this.rollSite = null;
      }
    }
  }
  // (the gear's torque, over the frame: the pilot's rates turned by it after the flight; its last state,
  // for the displays — each leg's load and compression)
  this.gearDw = gdef ? gearDw : null;
  this.gearLast = gdef ? (gearOut as GearOut | null) : null;
  // (the frame's thrust went in whole before the fall; when the sub-steps ran out short of the
  // frame — the ship's clock lagging a warp — only the part flown counts, as for the propellant)
  if (t < tEnd - 1e-12 && !touched && !this.ourLanded && !g.inside) V = lin(V, 1, dvT, (t - t0) / simDt - 1);
  const speed = Math.hypot(...V);
  this.properTime += (t - t0) * Math.sqrt(Math.max(1 - speed * speed, 0));
  setHomePose(s, X, unitV(fwd), unitV(up), V);
  s.motion = "geodesic";
  this.sync();
  if (touched?.gear) {
    // the gear's verdict (gear.ts): landed, a hard landing that damaged it, a collapse, tipped over
    this.landed = true;
    const name = BODY_NAMES[ground as Body];
    const craft = VESSELS[fleet.active].name;
    const v = touched.speed.toFixed(1);
    if (touched.gear === "landed")
      this.onPilotMessage?.(tf("Touchdown on {0} · {1} m/s down, {2} m/s along", name, v, touched.vh!.toFixed(0)));
    else if (touched.gear === "hard") this.onPilotMessage?.(tf("Hard landing on {0} · {1} m/s down — the gear damaged", name, v));
    else {
      const nav = this.ourNav(cameraFrame(s));
      if (nav && touched.gear === "crashed") this.levelShip(nav.radial);
      const why =
        touched.gear === "tipped"
          ? tf("{0}: tipped over on {1}", craft, name)
          : tf("{0}: the gear collapsed on {1} at {2} m/s", craft, name, touched.speed.toFixed(0));
      this.onPilotMessage?.(why);
      this.crashed(why);
    }
    this.rollSite =
      touched.gear !== "crashed" && touched.gear !== "tipped" && this.rolling && this.pilot.auto === "entry" && this.entryRun?.site?.runway
        ? this.entryRun.site
        : null;
    if (this.pilot.auto !== "none" && this.pilot.auto !== "takeoff") this.pilot.setAuto(this.pilot.auto);
  } else if (touched) {
    this.landed = true;
    const name = BODY_NAMES[ground as Body];
    const v = touched.speed;
    if (touched.wheels && this.rolling)
      this.onPilotMessage?.(`Touchdown on ${name} · ${v.toFixed(1)} m/s down, ${touched.vh!.toFixed(0)} m/s along`);
    else {
      const nav = this.ourNav(cameraFrame(s));
      if (nav) this.levelShip(nav.radial);
      this.onPilotMessage?.(
        v > TUNING.crashSpeed ? `Crashed on ${name} at ${v.toFixed(0)} m/s` : `Landed on ${name} · ${v.toFixed(1)} m/s`,
      );
      if (v > TUNING.crashSpeed) this.crashed(`${VESSELS[fleet.active].name}: crashed on ${name} at ${v.toFixed(0)} m/s`);
    }
    // (the entry's glide down on its runway: the rollout steered along it)
    this.rollSite =
      touched.wheels && this.rolling && this.pilot.auto === "entry" && this.entryRun?.site?.runway ? this.entryRun.site : null;
    if (this.pilot.auto !== "none" && this.pilot.auto !== "takeoff") this.pilot.setAuto(this.pilot.auto);
  }
  if (flown) this.landed = !!this.rolling || !!this.ourLanded;
  return t;
}

/**
 * The ship's orbit round the body of its sphere of influence, when it is one to put on rails: bound,
 * its periapsis clear of the ground and of 30 scale heights of air, its apoapsis well inside the
 * sphere (the other bodies' pulls a small part of it). Null otherwise.
 */
function stableOrbit(this: CameraController, X: Vec3, V: Vec3, t: number) {
  const ref = referenceBody(X, t);
  if (ref === "sun") return null;
  const b = solarBody(ref)!;
  const st = ourState(ref, t);
  const r = sub3(X, st.pos),
    v = sub3(V, st.vel);
  const R = Math.hypot(...r);
  const eps = dot3(v, v) / 2 - b.mass / R;
  if (!(eps < 0)) return null;
  const a = -b.mass / (2 * eps);
  const h = cross(r, v);
  const e = Math.sqrt(Math.max(1 - dot3(h, h) / (b.mass * a), 0));
  const clear = b.radius * 1.01 + airTop(b.atmosphere) / M_METRES;
  if (a * (1 - e) < clear || a * (1 + e) > 0.25 * soiOf(ref, t)) return null;
  return { ref, mass: b.mass, period: 2 * Math.PI * Math.sqrt(a ** 3 / b.mass) };
}

/**
 * Our universe, near a solid body or in its air: the landing figures (ground-relative), as near the
 * hole — height of the gear, vertical and horizontal speeds, local gravity, thrust / weight, the
 * air's density, the re-entry glow's heat flux ρ v³.
 */
function ourSurfaceInfo(this: CameraController) {
  const nav = this.ourNav(cameraFrame(this.s));
  if (!nav || nav.ref === "sun") return null;
  const id = nav.ref;
  const sb = solarBody(id)!;
  const alt = gearHeight(id, nav.X, nav.t);
  if (!(solidBody(id) || ourAir(id, 0) > 0) || alt > Math.max(30 * (sb.atmosphere?.H ?? 0), 0.5 * sb.radius * M_METRES)) return null;
  const sp = groundSpeeds(id, nav.X, nav.V, nav.t);
  const r = Math.hypot(...sub3(nav.X, nav.refPos));
  const g = sb.mass / (r * r);
  const aUnit = C_MPS ** 2 / M_METRES;
  const air = ourAir(id, alt);
  const vAir = Math.hypot(sp.vv, sp.vh);
  // (the stagnation heat flux, Sutton–Graves for air with a 1 m nose: 1.74·10⁻⁴ √ρ v³ [W/m²] —
  // nothing climbing at a few hundred m/s, ~1 MW/m² for a return from orbit at 70 km)
  const q = 1.7415e-4 * Math.sqrt(air) * vAir ** 3;
  const cam = cameraFrame(this.s);
  const fl = nav.toRep(sp.va);
  const fll = Math.hypot(...fl) || 1;
  const flow: Vec3 = [-dot3(fl, cam.right) / fll, -dot3(fl, cam.up) / fll, -dot3(fl, cam.fwd) / fll];
  return {
    plasma: { q, flow, level: Math.min(Math.max((Math.log10(Math.max(q, 1)) - 5) / 1.5, 0), 1) },
    body: id as Body,
    alt: Math.max(alt, 0),
    vVert: sp.vv,
    vHor: sp.vh,
    gLocal: (g * aUnit) / G0,
    twr: this.thrustMax() / Math.max(g, 1e-30),
    landed: !!this.ourLanded,
    rolling: !!this.rolling,
    air,
  };
}

/** Puts the ship down on a body's ground (a scene's start). */
function setOurLanded(this: CameraController, l: { body: string; q: Vec3 } | null) {
  this.ourLanded = l;
  this.rolling = null;
  this.landed = !!l;
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installMotion(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { fly, fall, fallStep, flyHome, stableOrbit, ourSurfaceInfo, setOurLanded });
}
