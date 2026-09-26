// The local patch: a planet or a star near the camera, drawn around a floating origin.
//
// Traced as a sphere among the geodesics, a body far smaller than its distance to the hole loses its
// shape to float32 near it (at Miller, 10 M out, a float32 place is good to ~10⁻⁶ M — 2 % of its
// radius, tens of pixels in low orbit). Within LOCAL_RANGE of its radii the camera sees it instead
// along straight rays from a floating origin: its centre relative to the camera, in the camera's
// rest frame, computed here in float64 and sent in units of its radius. Over a few hundred radii the
// hole's bending is negligible (Miller: < 10⁻⁴ rad at 300 R): rays are straight in the camera's rest
// frame, and the body is where the camera sees it — its retarded place, with the aberration of their
// relative motion (a co-moving ship: at its true place). The same body is then left out of the traced
// spheres (where = 3).

import { blToCartesian } from "../camera";
import type { CameraFrame } from "../camera";
import { coordToZamo, type Vec3 } from "../physics";
import { sphericalFrame } from "../wormhole";
import type { GpuBody } from "./scene-bodies";

/** Within this many of its radii a body is drawn in the local patch. */
export const LOCAL_RANGE = 300;

export interface LocalPatch {
  /** index in the GPU body list */
  index: number;
  /** centre, camera rest frame (components along the ZAMO axes r̂, θ̂, φ̂), in units of its radius */
  centre: Vec3;
  /** the black-hole frame's x, y, z axes seen in the camera rest frame (for the body's surface pattern) */
  axes: [Vec3, Vec3, Vec3];
  /** where its light comes from (the hole — its disk — or its host star), in the camera's rest frame
   *  (the light's direction aberrated by the camera's motion) */
  light: Vec3;
  radius: number;
  distance: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Absolute place of a GPU body now (a planet's offset from its star added). */
export function bodyPlace(list: GpuBody[], k: number): Vec3 {
  const b = list[k]!;
  if (b.parent < 0) return b.pos;
  const p = list[b.parent]!.pos;
  return [p[0] + b.pos[0], p[1] + b.pos[1], p[2] + b.pos[2]];
}

/** A displacement of the black-hole frame's flat map at the camera, as proper lengths along the ZAMO axes. */
export function mapToZamo(v: Vec3, cam: CameraFrame): Vec3 {
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const f = sphericalFrame(X);
  const z = cam.zamo;
  const st = Math.max(Math.sin(cam.theta), 1e-9);
  return [dot(v, f.er) * z.sqrtSigOverDel, (dot(v, f.et) * z.sqrtSig) / cam.r, (dot(v, f.ep) * z.varpi) / (cam.r * st)];
}

/** The same, then as the camera's rest frame sees a displacement at rest there (a direction). */
export function mapToRest(v: Vec3, cam: CameraFrame): Vec3 {
  const x = mapToZamo(v, cam);
  const b = cam.beta;
  const b2 = dot(b, b);
  if (b2 < 1e-16) return x;
  const g = 1 / Math.sqrt(1 - b2);
  const n = unit(b);
  const k = (g - 1) * dot(x, n);
  return [x[0] + k * n[0], x[1] + k * n[1], x[2] + k * n[2]];
}

/**
 * Where the camera sees a body now, in its rest frame: the event "body at x, ZAMO time 0" (x: ZAMO
 * proper offset, v: its ZAMO velocity) seen from the camera moving at β — Lorentz transformed (its
 * time there is −γ β·x), carried to the camera's time 0 with the body's velocity in the camera frame
 * (relativistic velocity composition), then back along its motion by the light's travel time τ,
 * |x₀ − u τ| = τ (the retarded place: a body sweeping past is seen where it was).
 */
export function seenFrom(x: Vec3, v: Vec3, beta: Vec3): Vec3 {
  const b2 = dot(beta, beta);
  let xr = x, u = v, t = 0;
  if (b2 > 1e-16) {
    const g = 1 / Math.sqrt(1 - b2);
    const n = unit(beta);
    const xn = dot(x, n);
    xr = [x[0] + (g - 1) * xn * n[0], x[1] + (g - 1) * xn * n[1], x[2] + (g - 1) * xn * n[2]];
    t = -g * dot(beta, x);
    const bv = dot(beta, v);
    const vn = dot(v, n);
    const bl = Math.sqrt(b2);
    const k = 1 / (1 - bv);
    // parallel part (vn − |β|)/(1 − β·v), perpendicular part v⊥/(γ (1 − β·v))
    u = [0, 1, 2].map((i) => ((vn - bl) * n[i]! + (v[i]! - vn * n[i]!) / g) * k) as Vec3;
  }
  const x0: Vec3 = [xr[0] - u[0] * t, xr[1] - u[1] * t, xr[2] - u[2] * t];
  const u2 = Math.min(dot(u, u), 0.999999);
  const xu = dot(x0, u);
  // (|x₀ − u τ|² = τ²: (1 − u²) τ² + 2 (x₀·u) τ − |x₀|² = 0, the positive root)
  const tau = (-xu + Math.sqrt(xu * xu + (1 - u2) * dot(x0, x0))) / (1 - u2);
  return [x0[0] - u[0] * tau, x0[1] - u[1] * tau, x0[2] - u[2] * tau];
}

/** Where a source seen in direction l by the ZAMO is seen from a camera moving at β (aberration). */
export function aberrate(l: Vec3, beta: Vec3): Vec3 {
  const b2 = dot(beta, beta);
  if (b2 < 1e-16) return l;
  const g = 1 / Math.sqrt(1 - b2);
  const n = unit(beta);
  // the photon runs along k = −l: k' = [k + ((γ − 1)(k·n̂) − γ|β|) n̂] / (γ (1 − β·k))
  const k: Vec3 = [-l[0], -l[1], -l[2]];
  const c = (g - 1) * dot(k, n) - g * Math.sqrt(b2);
  const kp: Vec3 = [k[0] + c * n[0], k[1] + c * n[1], k[2] + c * n[2]];
  return unit([-kp[0], -kp[1], -kp[2]]);
}

/** The body to draw in the local patch, if the camera is near one (the nearest in its radii). */
export function localPatch(cam: CameraFrame, list: GpuBody[], velocity: (k: number) => Vec3): LocalPatch | null {
  if (cam.region !== "hole") return null;
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  let best: LocalPatch | null = null;
  list.forEach((b, k) => {
    if (b.where === 2) return; // (our universe: through the wormhole only)
    const C = bodyPlace(list, k);
    const d = Math.hypot(C[0] - X[0], C[1] - X[1], C[2] - X[2]);
    if (d > LOCAL_RANGE * b.radius || (best && d / b.radius >= best.distance / best.radius)) return;
    // (its velocity, a coordinate velocity of the map, as the ZAMO here measures it)
    const V = velocity(k);
    const f = sphericalFrame(X);
    const vz = coordToZamo([dot(V, f.er), dot(V, f.et), dot(V, f.ep)], cam.r, cam.theta, cam.zamo);
    const rel = seenFrom(mapToZamo([C[0] - X[0], C[1] - X[1], C[2] - X[2]], cam), vz, cam.beta);
    const host = b.light >= 0 ? bodyPlace(list, b.light) : ([0, 0, 0] as Vec3);
    best = {
      index: k,
      centre: [rel[0] / b.radius, rel[1] / b.radius, rel[2] / b.radius],
      axes: [unit(mapToRest([1, 0, 0], cam)), unit(mapToRest([0, 1, 0], cam)), unit(mapToRest([0, 0, 1], cam))],
      light: aberrate(unit(mapToZamo([host[0] - C[0], host[1] - C[1], host[2] - C[2]], cam)), cam.beta),
      radius: b.radius,
      distance: d,
    };
  });
  return best;
}
