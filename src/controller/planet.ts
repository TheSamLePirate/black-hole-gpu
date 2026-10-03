// The CameraController — a planet's frame: flight by Gargantua's worlds.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { blToCartesian, cameraFrame } from "../camera";
import type { Vec3 } from "../physics";
import { SYSTEM_BODIES, type SystemBody } from "../settings";
import { availableBodies, bodyCentre, BODY_NAMES, type Body, bodyHill } from "../targeting";
import { GARGANTUA_SYSTEM } from "../system/bodies";
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
import { dot as dot3 } from "../math/vec3";

import type { CameraController } from "../controls";

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
function surfaceWant(
  this: CameraController,
  cam: ReturnType<typeof cameraFrame>,
  say: (t: string) => null,
): { beta: Vec3; ff: Vec3 } | null {
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
    // up to the orbit the orbit autopilot would keep (0.3 of the Hill radius), turning prograde
    const hill = bodyHill(this.s, F.id as Body, this.nowTime());
    const d0 = Math.max(0.3 * hill, 1.2 * F.R);
    const f = Math.min(Math.max((d - F.R) / (d0 - F.R), 0), 1);
    let east: Vec3 = [-up[1], up[0], 0];
    const el = Math.hypot(...east);
    east = el > 1e-6 ? [east[0] / el, east[1] / el, 0] : [0, 1, 0];
    const vc = Math.sqrt(F.m / d) - F.n * F.ut * d; // circular, in the turning frame
    // (a climb of about three minutes to the orbit's height at most — a Cinema engine could go far
    // faster)
    const minute = 60 / (4.925490947e-6 * this.s.massSolar); // [M]
    const vUp = Math.min(Math.sqrt((thr - g) * (d0 - F.R)) * 0.5, (d0 - F.R) / (3 * minute), 0.02) * (1 - f) + 0.2 / c;
    const vE = vc * Math.sqrt(f);
    if (f > 0.95 && Math.abs((L.w[0] * east[0] + L.w[1] * east[1] + L.w[2] * east[2]) / vc - 1) < 0.1) {
      P.auto = "none";
      P.setAuto("orbit");
      this.onPilotMessage?.(`In orbit around ${name}`);
      return null;
    }
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

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installPlanet(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { poseKeyNow, localFlight, surfaceInfo, surfaceWant });
}
