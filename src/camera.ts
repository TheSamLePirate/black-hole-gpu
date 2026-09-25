import { horizon, keplerOmega, zamo, type Vec3 } from "./physics";
import type { Settings } from "./settings";

const DEG = Math.PI / 180;

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));

export interface CameraFrame {
  r: number;
  theta: number;
  phi: number;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  zamo: ReturnType<typeof zamo>;
  beta: Vec3; // observer velocity in the ZAMO frame, components (r̂, θ̂, φ̂)
  gamma: number;
  speed: number;
}

/**
 * Observer at Boyer–Lindquist (r, θ, φ). Vectors are expressed in the ZAMO orthonormal frame
 * (r̂, θ̂, φ̂). Default view: looking at the hole (−r̂), with the spin axis up (−θ̂).
 */
export function cameraFrame(s: Settings): CameraFrame {
  const a = s.spin;
  const rH = horizon(a);
  const r = Math.max(s.distance, rH + 0.02);
  // never exactly in the equatorial plane (disk crossing test) nor on the axis
  let theta = Math.min(Math.max(s.inclination, 0.2), 179.8) * DEG;
  if (Math.abs(theta - Math.PI / 2) < 1e-4) theta += 2e-4;
  const phi = s.azimuth * DEG;

  const f0: Vec3 = [-1, 0, 0];
  const u0: Vec3 = [0, -1, 0];
  const r0: Vec3 = [0, 0, 1];
  const y = s.yaw * DEG;
  const p = s.pitch * DEG;
  const fy = add(scale(f0, Math.cos(y)), scale(r0, Math.sin(y)));
  const right = norm(add(scale(r0, Math.cos(y)), scale(f0, -Math.sin(y))));
  const fwd = norm(add(scale(fy, Math.cos(p)), scale(u0, Math.sin(p))));
  const up = norm(cross(right, fwd));

  const z = zamo(r, theta, a);
  let beta: Vec3 = [0, 0, 0];
  if (s.motion === "orbit") {
    // circular prograde orbit (Keplerian Ω), velocity relative to the local ZAMO
    const v = (z.varpi * (keplerOmega(r * Math.sin(theta) || r, a) - z.omega)) / z.alpha;
    beta = [0, 0, Math.min(Math.max(v, -0.995), 0.995)];
  } else if (s.motion === "infall") {
    // free fall from rest at infinity with zero angular momentum (the "rain" frame): γ = 1/α
    beta = [-Math.sqrt(Math.max(0, 1 - z.alpha * z.alpha)), 0, 0];
  } else if (s.motion === "forward") {
    beta = scale(fwd, Math.min(s.beta, 0.995));
  }
  const speed = Math.min(Math.hypot(...beta), 0.9999);
  if (speed > 0) beta = scale(norm(beta), speed);
  return { r, theta, phi, right, up, fwd, zamo: z, beta, gamma: 1 / Math.sqrt(1 - speed * speed), speed };
}
