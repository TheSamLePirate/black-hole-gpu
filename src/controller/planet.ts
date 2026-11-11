// The CameraController — a planet's frame: flight by Gargantua's worlds.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { blToCartesian, cameraFrame } from "../camera";
import type { Vec3 } from "../physics";
import { SYSTEM_BODIES, type SystemBody } from "../settings";
import { availableBodies, bodyCentre, BODY_NAMES, type Body, bodyHill } from "../targeting";
import { GARGANTUA_SYSTEM } from "../system/bodies";
import { type Atmosphere, airTop } from "../aero";
import {
  airDensity,
  betaToCoord,
  GEAR,
  groundR,
  localAccel,
  localToZamo,
  planetFrame,
  toGlobal,
  toLocal,
  weightUp,
  zamoBeta,
  type LocalState,
  type PlanetFrame,
} from "../landing";
import { C_MPS, G0 } from "../units";
import { cross, dot as dot3, lin, sub as sub3 } from "../math/vec3";
import { unitV } from "./util";
import { frameRate } from "../game/place";

import type { CameraController } from "../controls";
import type { Want } from "../pilot";

declare module "../controls" {
  interface CameraController {
    poseKeyNow: typeof poseKeyNow;
    localFlight: typeof localFlight;
    surfaceInfo: typeof surfaceInfo;
    surfaceWant: typeof surfaceWant;
  }
}

function poseKeyNow(this: CameraController) {
  const s = this.s;
  return [s.distance, s.inclination, s.azimuth, s.velR, s.velT, s.velP].join();
}

/**
 * The planet frame to fly in now, entering it within half a planet's Hill radius (its sphere of
 * influence) and leaving it beyond 0.6 of it (a margin: no flicker at the edge). Planets of the
 * system only (the classic scenes' star keeps the global integration).
 */
function localFlight(this: CameraController, cam: ReturnType<typeof cameraFrame>, X: Vec3): { F: PlanetFrame; L: LocalState } | null {
  const s = this.s;
  const t = this.nowTime();
  // (the pose changed from elsewhere — a preset, a jump: start again from it)
  if (this.local && this.local.key !== undefined && this.local.key !== this.poseKeyNow()) this.local = null;
  if (this.local) {
    const { F, L } = this.local;
    const hill = bodyHill(s, F.id as Body, t);
    if (Math.hypot(...L.xi) < 0.6 * hill || L.landed) return this.local;
    this.local = null;
    return null;
  }
  if (s.system === "none") return null;
  for (const b of availableBodies(s, cam)) {
    const sb = SYSTEM_BODIES.includes(b as SystemBody) ? GARGANTUA_SYSTEM.bodies.find((q) => q.id === b) : null;
    if (!sb || sb.kind !== "planet" || sb.universe !== "gargantua") continue;
    const C = bodyCentre(s, b, t);
    const d = Math.hypot(X[0] - C[0], X[1] - C[1], X[2] - C[2]);
    if (d > 0.5 * bodyHill(s, b, t)) continue;
    const F = planetFrame(b, t, s.spin, s.massSolar);
    const L = toLocal(F, X, betaToCoord(X, cam.beta, s.spin));
    this.local = { F, L };
    return this.local;
  }
  return null;
}

/** Radar altitude, speeds relative to the ground, thrust-to-weight: the landing HUD. */
function surfaceInfo(this: CameraController) {
  const lf = this.local;
  if (!lf) return this.ourSurfaceInfo();
  const { F, L } = lf;
  const c = C_MPS;
  const d = Math.hypot(...L.xi);
  const up: Vec3 = [L.xi[0] / d, L.xi[1] / d, L.xi[2] / d];
  const vv = dot3(L.w, up);
  const vh = Math.hypot(L.w[0] - vv * up[0], L.w[1] - vv * up[1], L.w[2] - vv * up[2]);
  const g = weightUp(F, L.xi);
  // re-entry glow (visual): the heat flux scale ρ v³ [W/m²], the air's flow in the camera frame
  const rho = airDensity(F, d - F.R);
  const sp = Math.hypot(...L.w);
  const q = rho * (sp * c) ** 3;
  const cam = cameraFrame(this.s);
  const flowZ = sp > 0 ? localToZamo([-L.w[0] / sp, -L.w[1] / sp, -L.w[2] / sp]) : ([0, 0, 0] as Vec3);
  const flow: Vec3 = [dot3(flowZ, cam.right), dot3(flowZ, cam.up), dot3(flowZ, cam.fwd)];
  return {
    plasma: { q, flow, level: Math.min(Math.max((Math.log10(Math.max(q, 1)) - 5.5) / 2.5, 0), 1) },
    body: F.id as Body,
    alt: (d - groundR(F, L.xi)) * F.mPerM - GEAR,
    vVert: vv * c,
    vHor: vh * c,
    gLocal: (g * F.aUnit) / G0,
    twr: this.thrustMax() / Math.max(g, 1e-30),
    landed: L.landed,
    rolling: !!L.rolling,
    air: airDensity(F, d - F.R),
    /** where on the world (its frame's ξ: the HUD's globe) */
    xi: L.xi,
  };
}

/**
 * Landing and take-off, in the planet's frame (landing.ts). Landing: the horizontal speed killed,
 * the descent no faster than half the engine's margin over the local weight can stop, down to
 * 1.5 m/s at touchdown. Take-off: up, turning prograde as it climbs, to the orbit's radius with the
 * circular speed of the turning frame; then the orbit autopilot. The goal velocity (local) is carried
 * to the ZAMO's terms; the feed-forward holds the ship against what gravity and the frame do.
 */
function surfaceWant(this: CameraController, cam: ReturnType<typeof cameraFrame>, say: (t: string) => null): Want | null {
  const P = this.pilot;
  const lf = this.local;
  const what = P.auto === "land" ? "Landing" : "Take-off";
  if (!lf || cam.region !== "hole") return say(`${what}: get into the planet's sphere of influence first (orbit it)`);
  const { F, L } = lf;
  const name = BODY_NAMES[F.id as Body];
  const c = C_MPS;
  const d = Math.hypot(...L.xi);
  const up: Vec3 = [L.xi[0] / d, L.xi[1] / d, L.xi[2] / d];
  const h = d - groundR(F, L.xi) - GEAR / F.mPerM;
  const g = weightUp(F, L.xi);
  const thr = this.thrustMax();
  if (thr < 1.05 * g) {
    const gU = F.aUnit / G0;
    return say(`${what}: the engine (${(thr * gU).toFixed(1)} g) cannot hold the weight on ${name} (${(g * gU).toFixed(2)} g)`);
  }
  let want: Vec3;
  if (P.auto === "land") {
    if (L.landed) {
      P.setAuto("land");
      this.onPilotMessage?.(`Landed on ${name}`);
      return null;
    }
    // vertical speed: what half the margin can stop (v² = 2 a h), no less than a minute from the
    // ground (a Cinema engine could stop far more), 1.5 m/s at the end
    const minute = 60 / (4.925490947e-6 * this.s.massSolar); // [M]
    const vd = -Math.max(Math.min(Math.sqrt(2 * 0.5 * (thr - g) * Math.max(h, 0)), Math.max(h, 0) / minute, 0.02), 1.5 / c);
    want = [up[0] * vd, up[1] * vd, up[2] * vd];
  } else {
    // (on the ground, then up to 200 m: a vertical start on the vectored thrust, level on the heading it stood on — as the
    // Lander's on our side (lowthrust.ts ourSurfaceWant): handed the climb's law at once, the nose was to turn up first and the
    // engine waited for it — on the ground the craft never turns: the Ranger and the Lander sat on Mann's ice, the throttle 0)
    const hm = h * F.mPerM;
    if (L.landed || (this.liftOff && hm < 200)) {
      const upZ = unitV(localToZamo(up));
      if (!this.liftOff) {
        const n0 = this.shipAxesLocal(cam)[2];
        const lv = lin(n0, 1, upZ, -dot3(n0, upZ));
        this.liftOff = Math.hypot(...lv) > 1e-6 ? unitV(lv) : unitV(lin([1, 0, 0], 1, upZ, -upZ[0]));
      }
      const nose = unitV(lin(this.liftOff, 1, upZ, -dot3(this.liftOff, upZ)));
      const vz = Math.min(4 + 0.25 * Math.max(hm, 0), 40) / c;
      const w: Vec3 = [up[0] * vz, up[1] * vz, up[2] * vz];
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      const gW = toGlobal(F, { xi: L.xi, w, landed: false });
      const free = localAccel(F, L.xi, w, [0, 0, 0]);
      return {
        beta: zamoBeta(X, gW.V, this.s.spin),
        ff: localToZamo([-free[0], -free[1], -free[2]]),
        att: { nose, up: upZ, vectored: true },
      };
    }
    this.liftOff = null;
    // up to a low orbit clear of the air (or the launch's goal), turning east as it climbs — then CIRC on that circle (localCircWant).
    // (It aimed at 0.3 of the Hill radius, climbing at kilometres a second: never flown — the craft never left the ground —, it
    // went off on a hyperbola once it did)
    const atm = GARGANTUA_SYSTEM.bodies.find((q) => q.id === F.id)?.surface?.atmosphere as Atmosphere | null | undefined;
    const airKm = atm ? Math.max(100, Math.ceil(airTop(atm) / 1e4) * 10) : 50;
    const ht = (Math.max(this.launchGoal.altKm ?? 0, airKm) * 1e3) / F.mPerM;
    const f = Math.min(Math.max(h / ht, 0), 1);
    let east: Vec3 = [-up[1], up[0], 0];
    const el = Math.hypot(...east);
    east = el > 1e-6 ? [east[0] / el, east[1] / el, 0] : [0, 1, 0];
    if (f > 0.95) {
      // (high enough: the circle there by CIRC — where the climb coasts to, d + v²/2g, already clear of the air: held to the goal's
      // own, or to the distance at the hand-over with the craft still rising, the trim took more than 20 minutes)
      const vv = Math.max(dot3(L.w, up), 0);
      P.setAuto("circularize");
      P.anchor = [d + (vv * vv) / (2 * g), 1, 0];
      return null;
    }
    // (the climb: a vertical speed gravity brings to rest at the goal — 0.9 of √(2 g Δh), 2 m/s at least —; the speed along, the
    // circle's at the goal, given as the craft climbs; in the turning frame: less the frame's own turn, frameRate)
    const vUp = Math.max(0.9 * Math.sqrt(2 * g * Math.max(ht - h, 0)), 2 / c);
    const vci = Math.sqrt(F.m / (F.R + ht));
    const vE = vci * Math.sqrt(f) - frameRate(F) * d;
    want = [up[0] * vUp + east[0] * vE, up[1] * vUp + east[1] * vE, up[2] * vUp + east[2] * vE];
  }
  // to the ZAMO's terms at the ship
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const gW = toGlobal(F, { xi: L.xi, w: want, landed: false });
  const beta = zamoBeta(X, gW.V, this.s.spin);
  // feed-forward: what holds the ship on that velocity against gravity and the frame
  const free = localAccel(F, L.xi, want, [0, 0, 0]);
  return { beta, ff: localToZamo([-free[0], -free[1], -free[2]]) };
}

/**
 * The circularization around the planet the craft is near (its frame — this.local): the circle at the distance it is engaged at,
 * in the planet's orbit's plane the craft flies, its speed √(m/d) about the planet less the frame's turn
 * (game/place.ts frameRate, as game.orbit places a circle) —; the distance closed over a few turns; done on the circle. (Flown in the hole's frame, the planet's speed — a large
 * part of c — added to it as a Galilean sum came out 12 % fast: an orbit of 2 944 × 10 993 km for a circle.)
 */
function localCircWant(this: CameraController, cam: ReturnType<typeof cameraFrame>, say: (t: string) => null) {
  const P = this.pilot;
  const lf = this.local;
  if (!lf || cam.region !== "hole") return say("Circularize: get into the planet's sphere of influence first");
  const { F, L } = lf;
  const name = BODY_NAMES[F.id as Body] ?? F.id;
  const d = Math.hypot(...L.xi);
  const up: Vec3 = [L.xi[0] / d, L.xi[1] / d, L.xi[2] / d];
  // (the distance kept: where it was engaged, clear of the ground and its air)
  if (!P.anchor) P.anchor = [Math.max(d, 1.02 * F.R), 1, 0];
  const d0 = P.anchor[0]!;
  // (the frame turns about z at its proper rate — game/place.ts frameRate, as the orbit's placement: n·ut, the take-off's,
  // leaves out the metric's stretch near Gargantua —: the craft's motion about the planet, in the frame that does not)
  const W = frameRate(F);
  const wIn: Vec3 = [L.w[0] - W * L.xi[1], L.w[1] + W * L.xi[0], L.w[2]];
  let nrm = cross(L.xi, wIn);
  if (Math.hypot(...nrm) < 1e-12 * d * Math.max(Math.hypot(...wIn), 1e-30)) nrm = [0, 0, 1];
  nrm = unitV(nrm);
  const tdir = unitV(cross(nrm, up));
  const vc = Math.sqrt(F.m / d);
  const w0 = vc / d;
  const vr = Math.max(-0.15 * vc, Math.min(0.15 * vc, -(d - d0) * w0 * 0.3));
  const wantIn = lin(tdir, vc, up, vr);
  // (back in the turning frame)
  const want: Vec3 = [wantIn[0] + W * L.xi[1], wantIn[1] - W * L.xi[0], wantIn[2]];
  // (done on the circle: the velocity within 0.2 % of its — the shape —; the height within 3 % of the one aimed at — the climb's
  // hand-over left it 1 % above, closed at 0.3 of the orbit's rate: more than 20 minutes for nothing the orbit shows)
  if (Math.abs(d - d0) < 0.03 * d0 && Math.hypot(...sub3(L.w, want)) < 0.002 * vc) {
    P.setAuto("none");
    this.onPilotMessage?.(`In orbit around ${name}`);
    return null;
  }
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const gW = toGlobal(F, { xi: L.xi, w: want, landed: false });
  const beta = zamoBeta(X, gW.V, this.s.spin);
  const free = localAccel(F, L.xi, want, [0, 0, 0]);
  return { beta, ff: localToZamo([-free[0], -free[1], -free[2]]) };
}

declare module "../controls" {
  interface CameraController {
    localCircWant: typeof localCircWant;
  }
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installPlanet(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { poseKeyNow, localFlight, surfaceInfo, surfaceWant, localCircWant });
}
