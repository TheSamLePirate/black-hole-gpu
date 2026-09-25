import { horizon, keplerOmega, zamo, type Vec3 } from "./physics";
import type { Settings } from "./settings";
import {
  fromMouth, holeToRep, mouth, radius, repToHole, repToSide, sidePosition, sideToRep, sphericalFrame, toMouth,
  type Mouth,
} from "./wormhole";

const DEG = Math.PI / 180;

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));

export interface CameraFrame {
  /** "hole": Boyer–Lindquist position, vectors in the ZAMO frame (r̂, θ̂, φ̂).
   *  "throat": inside the wormhole's gluing sphere, Dneg position (ℓ, n̂), rep vectors (see wormhole.ts). */
  region: "hole" | "throat";
  r: number;
  theta: number;
  phi: number;
  ell: number;
  n: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  zamo: ReturnType<typeof zamo>;
  beta: Vec3; // observer velocity in the local static (ZAMO) frame, same components as the vectors
  gamma: number;
  speed: number;
}

/**
 * Camera basis from yaw/pitch/roll, components along (r̂, θ̂, φ̂): yaw = pitch = 0 looks at the
 * centre (−r̂) with the spin axis up; roll turns right/up about the view direction.
 */
export function basis(yawDeg: number, pitchDeg: number, rollDeg = 0) {
  const f0: Vec3 = [-1, 0, 0];
  const u0: Vec3 = [0, -1, 0];
  const r0: Vec3 = [0, 0, 1];
  const y = yawDeg * DEG;
  const p = pitchDeg * DEG;
  const fy = add(scale(f0, Math.cos(y)), scale(r0, Math.sin(y)));
  const right = norm(add(scale(r0, Math.cos(y)), scale(f0, -Math.sin(y))));
  const fwd = norm(add(scale(fy, Math.cos(p)), scale(u0, Math.sin(p))));
  const up = norm(cross(right, fwd));
  if (!rollDeg) return { right, up, fwd };
  const c = Math.cos(rollDeg * DEG);
  const sn = Math.sin(rollDeg * DEG);
  return { right: add(scale(right, c), scale(up, sn)), up: add(scale(up, c), scale(right, -sn)), fwd };
}

/** Inverse of basis(): fwd = (−cos p cos y, −sin p, cos p sin y); roll from the up vector (if given). */
export function yawPitchRoll(f: Vec3, u?: Vec3) {
  const pitch = Math.asin(Math.max(-1, Math.min(1, -f[1]))) / DEG;
  // looking straight along ±θ̂: keep the yaw implied by the up vector (roll = 0)
  const flat = Math.hypot(f[0], f[2]) < 1e-9 && u;
  const yaw = flat ? Math.atan2(-u[2] * Math.sign(-f[1]), u[0] * Math.sign(-f[1])) / DEG : Math.atan2(f[2], -f[0]) / DEG;
  let roll = 0;
  if (u) {
    const b = basis(yaw, pitch);
    roll = Math.atan2(-dot(u, b.right), dot(u, b.up)) / DEG;
  }
  return { yaw, pitch, roll: Math.abs(roll) < 1e-9 ? 0 : roll };
}

const STATIC_ZAMO = { alpha: 1, omega: 0, varpi: 1, sqrtSig: 1, sqrtSigOverDel: 1 };

function withMotion(s: Settings, f: Omit<CameraFrame, "beta" | "gamma" | "speed">, orbital: Vec3 | null): CameraFrame {
  let beta: Vec3 = [0, 0, 0];
  if (orbital) beta = orbital;
  else if (s.motion === "forward") beta = scale(f.fwd, Math.min(s.beta, 0.995));
  const speed = Math.min(Math.hypot(...beta), 0.9999);
  if (speed > 0) beta = scale(norm(beta), speed);
  return { ...f, beta, gamma: 1 / Math.sqrt(1 - speed * speed), speed };
}

/** Never exactly in the equatorial plane (disk crossing test) nor on the axis. */
function safeTheta(deg: number) {
  let theta = Math.min(Math.max(deg, 0.2), 179.8) * DEG;
  if (Math.abs(theta - Math.PI / 2) < 1e-4) theta += 2e-4;
  return theta;
}

/**
 * Observer at Boyer–Lindquist (r, θ, φ). Vectors are expressed in the ZAMO orthonormal frame
 * (r̂, θ̂, φ̂). Default view: looking at the hole (−r̂), with the spin axis up (−θ̂).
 */
function holeFrame(s: Settings): CameraFrame {
  const a = s.spin;
  const rH = horizon(a);
  const r = Math.max(s.distance, rH + 0.02);
  const theta = safeTheta(s.inclination);
  const phi = s.azimuth * DEG;
  const { right, up, fwd } = basis(s.yaw, s.pitch, s.roll);
  const z = zamo(r, theta, a);
  let orbital: Vec3 | null = null;
  if (s.motion === "orbit") {
    // circular prograde orbit (Keplerian Ω), velocity relative to the local ZAMO
    const v = (z.varpi * (keplerOmega(r * Math.sin(theta) || r, a) - z.omega)) / z.alpha;
    orbital = [0, 0, Math.min(Math.max(v, -0.995), 0.995)];
  } else if (s.motion === "infall") {
    // free fall from rest at infinity with zero angular momentum (the "rain" frame): γ = 1/α
    orbital = [-Math.sqrt(Math.max(0, 1 - z.alpha * z.alpha)), 0, 0];
  } else if (s.motion === "geodesic" || s.motion === "comoving") {
    orbital = [s.velR, s.velT, s.velP];
  }
  return withMotion(s, { region: "hole", r, theta, phi, ell: 0, n: [1, 0, 0], right, up, fwd, zamo: z }, orbital);
}

/** A rep pose on the Gargantua side, outside the gluing sphere → black-hole frame (static observer). */
function holeFromRep(s: Settings, m: Mouth, l: number, n: Vec3, v: { right: Vec3; up: Vec3; fwd: Vec3; vel: Vec3 }): CameraFrame {
  const X = repToHole(m, l, n);
  const f = sphericalFrame(X);
  const r = Math.max(f.r, horizon(s.spin) + 0.05);
  const theta = safeTheta(f.th / DEG);
  const comps = (u: Vec3): Vec3 => {
    const W = fromMouth(m, u);
    return [dot(W, f.er), dot(W, f.et), dot(W, f.ep)];
  };
  return withMotion(s, {
    region: "hole", r, theta, phi: f.ph, ell: 0, n: [1, 0, 0],
    right: comps(v.right), up: comps(v.up), fwd: comps(v.fwd), zamo: zamo(r, theta, s.spin),
  }, s.motion === "geodesic" || s.motion === "comoving" ? comps(v.vel) : null);
}

/** Camera orbiting the wormhole: whL is ℓ; inclination/azimuth are angles in the frame of its side. */
function wormholeFrame(s: Settings, m: Mouth): CameraFrame {
  const side = s.whL >= 0 ? 1 : -1;
  const theta = Math.min(Math.max(s.inclination, 0.2), 179.8) * DEG;
  const phi = s.azimuth * DEG;
  const st = Math.sin(theta), ct = Math.cos(theta), sp = Math.sin(phi), cp = Math.cos(phi);
  const er: Vec3 = [st * cp, st * sp, ct];
  const et: Vec3 = [ct * cp, ct * sp, -st];
  const ep: Vec3 = [-sp, cp, 0];
  const n = sidePosition(side, er); // the mirror map is its own inverse
  const b = basis(s.yaw, s.pitch, s.roll);
  const rep = (c: Vec3) => sideToRep(side, n, add(add(scale(er, c[0]), scale(et, c[1])), scale(ep, c[2])));
  const vel = rep([s.velR, s.velT, s.velP]);
  const v = { right: rep(b.right), up: rep(b.up), fwd: rep(b.fwd), vel };
  if (side > 0 && s.whL > m.lGlue) return holeFromRep(s, m, s.whL, n, v);
  return withMotion(s, {
    region: "throat", r: radius(m.w, s.whL)[0], theta, phi, ell: s.whL, n, right: v.right, up: v.up, fwd: v.fwd, zamo: STATIC_ZAMO,
  }, s.motion === "geodesic" || s.motion === "comoving" ? vel : null);
}

export function cameraFrame(s: Settings): CameraFrame {
  if (!s.wormhole) return holeFrame(s);
  const m = mouth(s);
  if (s.anchor === "wormhole") return wormholeFrame(s, m);
  const cam = holeFrame(s);
  // inside the gluing sphere the camera sees through the Dneg metric
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const rep = holeToRep(m, X);
  if (rep.r >= m.rGlue) return cam;
  const f = sphericalFrame(X);
  const toRep = (c: Vec3) => toMouth(m, add(add(scale(f.er, c[0]), scale(f.et, c[1])), scale(f.ep, c[2])));
  return {
    ...cam, region: "throat", ell: rep.l, n: rep.n, zamo: STATIC_ZAMO,
    right: toRep(cam.right), up: toRep(cam.up), fwd: toRep(cam.fwd), beta: toRep(cam.beta),
  };
}

export function blToCartesian(r: number, th: number, ph: number): Vec3 {
  return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
}

// ---------------------------------------------------------------------------------------------
// Poses: the camera expressed in the wormhole's rep coordinates or in the black-hole frame, and
// written back into the settings of either anchor (switching anchors keeps the view unchanged).
// ---------------------------------------------------------------------------------------------

export interface RepPose { l: number; n: Vec3; fwd: Vec3; up: Vec3; vel: Vec3 }

/** Current camera as a rep pose (any position in the wormhole world). */
export function repPose(s: Settings): RepPose {
  const m = mouth(s);
  const cam = cameraFrame(s);
  if (cam.region === "throat") return { l: cam.ell, n: cam.n, fwd: cam.fwd, up: cam.up, vel: cam.beta };
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  const f = sphericalFrame(X);
  const toRep = (c: Vec3) => toMouth(m, add(add(scale(f.er, c[0]), scale(f.et, c[1])), scale(f.ep, c[2])));
  const rep = holeToRep(m, X);
  return { l: rep.l, n: rep.n, fwd: toRep(cam.fwd), up: toRep(cam.up), vel: toRep(cam.beta) };
}

/** Writes a rep pose as a camera orbiting the wormhole (up: keeps the roll; omitted: roll = 0;
 *  vel: the camera's 3-velocity, rep vector). */
export function setRepPose(s: Settings, p: Pick<RepPose, "l" | "n" | "fwd"> & { up?: Vec3; vel?: Vec3 }) {
  const side = p.l >= 0 ? 1 : -1;
  const f = sphericalFrame(sidePosition(side, p.n));
  const comps = (v: Vec3): Vec3 => {
    const vs = repToSide(side, p.n, v);
    return [dot(vs, f.er), dot(vs, f.et), dot(vs, f.ep)];
  };
  const yp = yawPitchRoll(comps(p.fwd), p.up && comps(p.up));
  s.anchor = "wormhole";
  s.whL = p.l;
  s.inclination = Math.min(Math.max(f.th / DEG, 0.2), 179.8);
  s.azimuth = f.ph / DEG;
  s.yaw = yp.yaw;
  s.pitch = yp.pitch;
  s.roll = yp.roll;
  if (p.vel) [s.velR, s.velT, s.velP] = comps(p.vel);
}

/** Writes a black-hole frame position and forward (and up, velocity) vectors as a camera orbiting the hole. */
export function setHolePose(s: Settings, X: Vec3, fwd: Vec3, up?: Vec3, vel?: Vec3) {
  const f = sphericalFrame(X);
  const c = (v: Vec3): Vec3 => [dot(v, f.er), dot(v, f.et), dot(v, f.ep)];
  if (vel) [s.velR, s.velT, s.velP] = c(vel);
  const yp = yawPitchRoll(c(fwd), up && c(up));
  s.anchor = "hole";
  s.distance = f.r;
  s.inclination = Math.min(Math.max(f.th / DEG, 0.2), 179.8);
  s.azimuth = f.ph / DEG;
  s.yaw = yp.yaw;
  s.pitch = yp.pitch;
  s.roll = yp.roll;
}

/** Rep pose on the Gargantua side → black-hole frame position, forward and up vectors. */
export function repToHolePose(s: Settings, p: Pick<RepPose, "l" | "n" | "fwd"> & { up?: Vec3; vel?: Vec3 }) {
  const m = mouth(s);
  return { X: repToHole(m, p.l, p.n), fwd: fromMouth(m, p.fwd), up: p.up && fromMouth(m, p.up), vel: p.vel && fromMouth(m, p.vel) };
}

/** Changes what the camera orbits without moving it. Returns false when impossible (hole from our side). */
export function switchAnchor(s: Settings, to: Settings["anchor"]): boolean {
  if (!s.wormhole) return false;
  const p = repPose(s);
  if (to === "wormhole") {
    setRepPose(s, p);
    return true;
  }
  if (p.l < 0) return false;
  const h = repToHolePose(s, p);
  setHolePose(s, h.X, h.fwd, h.up, h.vel);
  return true;
}
