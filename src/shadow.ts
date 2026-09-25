import type { CameraFrame } from "./camera";
import type { State, Vec3 } from "./physics";

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Lorentz boost of a photon 4-momentum (E, p) from the ZAMO frame to the moving camera frame. */
function zamoToCamera(E: number, p: Vec3, beta: Vec3, gamma: number): { E: number; p: Vec3 } {
  const b2 = dot(beta, beta);
  if (b2 < 1e-12) return { E, p };
  const bn = beta.map((v) => v / Math.sqrt(b2)) as Vec3;
  const Ec = gamma * (E - dot(beta, p));
  const k = (gamma - 1) * dot(bn, p) - gamma * Math.sqrt(b2) * E;
  return { E: Ec, p: [p[0] + k * bn[0], p[1] + k * bn[1], p[2] + k * bn[2]] };
}

/**
 * Initial conditions of the backward ray for a camera looking along `look` (camera rest frame,
 * components along the ZAMO axes) — a CPU mirror of the shader's ray generation.
 */
export function cameraRay(cam: CameraFrame, look: Vec3): { state: State; L: number; E0: number } | null {
  const pc: Vec3 = [-look[0], -look[1], -look[2]];
  const { beta, gamma } = cam;
  let Ez = 1;
  let pz = pc;
  const b2 = dot(beta, beta);
  if (b2 > 1e-10) {
    const bn = beta.map((v) => v / Math.sqrt(b2)) as Vec3;
    Ez = gamma * (1 + dot(beta, pc));
    const k = (gamma - 1) * dot(bn, pc) + gamma * Math.sqrt(b2);
    pz = [pc[0] + k * bn[0], pc[1] + k * bn[1], pc[2] + k * bn[2]];
  }
  const z = cam.zamo;
  const E0 = z.alpha * Ez + z.omega * z.varpi * pz[2];
  if (E0 <= 1e-9) return null;
  return {
    E0,
    L: (z.varpi * pz[2]) / E0,
    state: { x: [cam.r, cam.theta, cam.phi, 0], p: [(z.sqrtSigOverDel * pz[0]) / E0, (z.sqrtSig * pz[1]) / E0] },
  };
}

/** Normalised device coordinates of a viewing direction (null when behind the camera). */
export function projectLook(cam: CameraFrame, look: Vec3, tanH: number, aspect: number): [number, number] | null {
  const f = dot(look, cam.fwd);
  if (f <= 1e-6) return null;
  return [dot(look, cam.right) / f / (tanH * aspect), dot(look, cam.up) / f / tanH];
}

/**
 * Critical curve (edge of the shadow) as seen by the actual observer, exact in Kerr at any
 * distance and for any observer velocity. Each point is the arrival direction of a photon with
 * the constants of motion (ξ = L/E, η = Q/E²) of an unstable spherical photon orbit of radius r_s
 * (Bardeen 1973; Teo 2003):
 *   ξ = [r²(3 − r) − a²(r + 1)] / [a(r − 1)],   η = r³[4a² − r(r − 3)²] / [a²(r − 1)²].
 * Returns one or more polylines of camera look directions.
 */
export function criticalCurveDirections(cam: CameraFrame, spin: number, samples = 1200): Vec3[][] {
  const a = Math.abs(spin) < 1e-5 ? (spin < 0 ? -1e-5 : 1e-5) : spin;
  const aa = Math.abs(a);
  const rPro = 2 * (1 + Math.cos((2 / 3) * Math.acos(-aa)));
  const rRet = 2 * (1 + Math.cos((2 / 3) * Math.acos(aa)));
  const { r: ro, theta: tho } = cam;
  const so = Math.sin(tho);
  const co = Math.cos(tho);
  const sig = ro * ro + a * a * co * co;
  const del = ro * ro - 2 * ro + a * a;
  const z = cam.zamo;

  const branch = (sign: 1 | -1): Vec3[] => {
    const pts: Vec3[] = [];
    for (let i = 0; i <= samples; i++) {
      // cosine spacing concentrates samples at the turning points of the curve
      const u = 0.5 - 0.5 * Math.cos((Math.PI * i) / samples);
      const rs = rPro + (rRet - rPro) * u;
      const xi = (rs * rs * (3 - rs) - a * a * (rs + 1)) / (a * (rs - 1));
      const eta = (rs ** 3 * (4 * a * a - rs * (rs - 3) ** 2)) / (a * a * (rs - 1) ** 2);
      const Theta = eta + a * a * co * co - (xi * xi * co * co) / (so * so);
      const R = (ro * ro + a * a - a * xi) ** 2 - del * (eta + (xi - a) ** 2);
      if (Theta < 0 || R < 0) continue;
      // photon momentum in the ZAMO frame (outgoing towards the camera), E = 1
      const Ez = (1 - z.omega * xi) / z.alpha;
      const p: Vec3 = [Math.sqrt(R / (sig * del)), (sign * Math.sqrt(Theta)) / Math.sqrt(sig), xi / z.varpi];
      const c = zamoToCamera(Ez, p, cam.beta, cam.gamma);
      const n = Math.hypot(...c.p);
      pts.push([-c.p[0] / n, -c.p[1] / n, -c.p[2] / n]);
    }
    return pts;
  };
  const upper = branch(1);
  const lower = branch(-1).reverse();
  return [upper.concat(lower, upper.slice(0, 1))];
}
