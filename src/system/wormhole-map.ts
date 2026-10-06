// Map coordinates are a projection of the flight, never a replacement for its physical frame.
import { blToCartesian, type CameraFrame } from "../camera";
import type { Settings } from "../settings";
import type { Vec3 } from "../physics";
import { add, dot, scale } from "../math/vec3";
import {
  fromMouth,
  holeToRep,
  mouth,
  projectedRepVelocity,
  radius,
  repToHole,
  repToSide,
  sidePosition,
  sphericalFrame,
  tunnelState,
  type WormholeUniverse,
} from "../wormhole";

export interface WormholeMapPose {
  universe: WormholeUniverse;
  X: Vec3;
  /** Coordinate derivative of X in the map embedding. */
  V: Vec3;
  nose: Vec3;
  look: Vec3;
  /** A physical frame change must invalidate paths even when the map universe is unchanged. */
  context: string;
  tunnel: ReturnType<typeof tunnelState> & { ell: number; speed: number };
}

/** Deterministic entry context for a saved pose in the cylinder; a live flight retains its entry side. */
export function tunnelEntrySide(ell: number, longitudinalSpeed: number): WormholeUniverse {
  return ell < 0 || (ell === 0 && longitudinalSpeed >= 0) ? "ours" : "gargantua";
}

export function wormholeMapPose(s: Settings, cam: CameraFrame, t: number, nose: Vec3, entrySide: WormholeUniverse): WormholeMapPose | null {
  if (!s.wormhole) return null;
  const m = mouth(s, t);
  const ell = cam.region === "throat" ? cam.ell : holeToRep(m, blToCartesian(cam.r, cam.theta, cam.phi)).l;
  const tunnel = tunnelState(m.w, ell);
  const universe = tunnel.universe ?? entrySide;
  const context = [
    universe,
    cam.region,
    tunnel.inside,
    s.system,
    s.spin,
    s.massSolar,
    s.whRho,
    s.whLength,
    s.whLensing,
    s.whDist,
    s.whIncl,
    s.whAzimuth,
    s.whOrbit,
    s.whPhase,
    s.sun,
    s.sunMass,
    s.sunOrbit,
    s.sunPhase,
    s.sunRadius,
    s.disk,
    s.diskOuter,
  ].join(":");
  if (cam.region === "hole") {
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    const f = sphericalFrame(X);
    const W = (v: Vec3) => add(add(scale(f.er, v[0]), scale(f.et, v[1])), scale(f.ep, v[2]));
    const z = cam.zamo;
    const velocity: Vec3 = [
      (cam.beta[0] * z.alpha) / z.sqrtSigOverDel,
      (cam.r * cam.beta[1] * z.alpha) / z.sqrtSig,
      cam.r * Math.sin(cam.theta) * (z.omega + (cam.beta[2] * z.alpha) / z.varpi),
    ];
    return { universe: "gargantua", X, V: W(velocity), nose: W(nose), look: W(cam.fwd), context, tunnel: { ...tunnel, ell, speed: 0 } };
  }
  const n = cam.n;
  // The entire cylinder projects to a mouth sphere. Its longitudinal progress is shown separately.
  const displayEll = universe === "ours" ? -Math.abs(ell) : Math.abs(ell);
  const r = radius(m.w, displayEll)[0];
  const pV = projectedRepVelocity(m.w, ell, n, cam.beta);
  const mirror = (v: Vec3): Vec3 => [v[0], -v[1], v[2]];
  return {
    universe,
    X: universe === "ours" ? scale(sidePosition(-1, n), r) : repToHole(m, displayEll, n),
    V: universe === "ours" ? mirror(pV) : add(m.V, fromMouth(m, pV)),
    nose: universe === "ours" ? repToSide(-1, n, nose) : fromMouth(m, nose),
    look: universe === "ours" ? repToSide(-1, n, cam.fwd) : fromMouth(m, cam.fwd),
    context,
    tunnel: { ...tunnel, ell, speed: dot(cam.beta, n) },
  };
}
