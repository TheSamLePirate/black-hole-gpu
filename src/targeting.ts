// Bodies the camera can orbit or aim at (the black hole, the companion star, the wormhole's mouth),
// and what the camera sees of them through the curved spacetime:
//  - pick(): the body met first by the backward ray of a pixel (horizon or disk → the hole, star,
//    gluing sphere → the wormhole), so clicking a lensed image — even a secondary one — selects it;
//  - apparentDirection(): the viewing direction of a body's centre, found by shooting rays and
//    correcting them (Gauss–Newton) until one passes through it: light bending, the star's
//    light-travel delay (it is seen where it was) and the camera's aberration are all included.
// A CPU mirror of the shader's ray tracing (same equations and emission-time convention).

import type { CameraFrame } from "./camera";
import { blToCartesian } from "./camera";
import { horizon, isco, rk4, stepSize, zamo, type State, type Vec3 } from "./physics";
import type { Settings } from "./settings";
import { cameraRay, zamoToCamera } from "./shadow";
import { fromMouth, mouth, repToHole, sphericalFrame, toMouth, traceDneg } from "./wormhole";

export type Body = "hole" | "star" | "wormhole" | "barycentre";

export const BODY_NAMES: Record<Body, string> = { hole: "Gargantua", star: "Star", wormhole: "Wormhole", barycentre: "Centre of mass" };

const DEG = Math.PI / 180;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lin = (a: Vec3, ka: number, b: Vec3, kb: number): Vec3 => [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
const norm = (a: Vec3): Vec3 => lin(a, 1 / Math.hypot(...a), a, 0);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ------------------------------------------------------------------------------------ the star
/** Orbital radius of the star, as the shader clamps it. */
export function starOrbitRadius(s: Pick<Settings, "sunOrbit" | "sunRadius" | "spin">) {
  return Math.max(s.sunOrbit, horizon(s.spin) + s.sunRadius + 1);
}
/**
 * Angular velocity of the star's orbit relative to Gargantua: prograde Keplerian, dφ/dt = 1/(r^1.5 + a)
 * for a test mass; a massive star and the hole orbit each other, Ω² = (M + m)/r³ (Newton, with the
 * Kerr correction kept): Ω = 1/(r^1.5/√(1 + m) + a).
 */
export function starOmega(s: Pick<Settings, "sunOrbit" | "sunRadius" | "spin"> & Partial<Pick<Settings, "sun" | "sunMass">>) {
  const m = s.sun === false ? 0 : Math.max(s.sunMass ?? 0, 0);
  return 1 / (starOrbitRadius(s) ** 1.5 / Math.sqrt(1 + m) + s.spin);
}

/** Mass fraction q = m/(M + m): Gargantua's share of the separation (0: it does not move). */
export function baryFraction(s: Settings) {
  return s.sun && s.sunMass > 0 ? s.sunMass / (1 + s.sunMass) : 0;
}

/** The centre of mass in Gargantua's frame (Gargantua is at −this in the centre-of-mass frame). */
export function barycentre(s: Settings, t: number): Vec3 {
  return lin(starCentre(s, t), baryFraction(s), [0, 0, 0], 0);
}

/** Velocity of the centre of mass relative to Gargantua (= −Gargantua's velocity in its frame). */
export function barycentreVelocity(s: Settings, t: number): Vec3 {
  return lin(starVelocity(s, t), baryFraction(s), [0, 0, 0], 0);
}

/** Acceleration of Gargantua's frame (it falls towards the star): a = m x★/D³. */
export function holeAcceleration(s: Settings, t: number): Vec3 {
  if (!baryFraction(s)) return [0, 0, 0];
  const c = starCentre(s, t);
  const D = Math.hypot(...c);
  return lin(c, s.sunMass / D ** 3, c, 0);
}
/** Orbital phase of the star at coordinate time t [rad]. */
export function starPhase(s: Settings, t: number) {
  return s.sunPhase * DEG + t * starOmega(s);
}
/** Centre of the star at coordinate time t (Cartesian map of Boyer–Lindquist, like the shader). */
export function starCentre(s: Settings, t: number): Vec3 {
  const rs = starOrbitRadius(s);
  const ph = starPhase(s, t);
  return [rs * Math.cos(ph), rs * Math.sin(ph), 0];
}

/** Velocity of the star's centre (coordinate time, Cartesian map). */
export function starVelocity(s: Settings, t: number): Vec3 {
  const c = starCentre(s, t);
  const om = starOmega(s);
  return [-om * c[1], om * c[0], 0];
}

/**
 * Weak field of the moving star, h_μν = −2Φ (η_μν + 2 u_μ u_ν), Φ = −m/d_rest (as the shader).
 * Returns ∇δH (Cartesian) for δH = Φ (2γ²(E − v·p)² − μ²)·… : `fac` is 2γ²(E − v·p)² − μ² (photon:
 * 2γ²(1 − v·p̂)²; slow massive body: ≈ 1), times ∇Φ in the rest-frame metric.
 */
export function starGradPhi(s: Settings, X: Vec3, t: number) {
  const c = starCentre(s, t);
  const v = starVelocity(s, t);
  const g2 = 1 / (1 - dot(v, v));
  const dv = sub(X, c);
  const dvv = dot(dv, v);
  const d2 = Math.max(dot(dv, dv) + g2 * dvv * dvv, s.sunRadius * s.sunRadius);
  // ∇Φ = m (dv + γ²(dv·v) v) / d³ (Φ = −m/d_rest)
  return { grad: lin(lin(dv, 1, v, g2 * dvv), s.sunMass / (d2 * Math.sqrt(d2)), dv, 0), v, g2, d: Math.sqrt(d2) };
}

/**
 * ∂δH/∂(r, θ, φ) of a photon (p_t = −1) in the star's field: δH = 2Φ γ² (1 − v·p̂)², so the
 * deflection is 4m/b × (1 − v∥) (Pyne & Birkinshaw 1993). `back`: unit backward ray direction.
 */
export function starForce(s: Settings, r: number, th: number, ph: number, t: number, back: Vec3, indirect = true): Vec3 {
  const st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
  const er: Vec3 = [st * cp, st * sp, ct];
  const f = starGradPhi(s, lin(er, r, er, 0), t);
  const k = 1 + dot(f.v, back);
  // plus the uniform "indirect" field of the hole's falling frame (δH = a·x for light)
  const g = lin(f.grad, 2 * f.g2 * k * k, holeAcceleration(s, t), indirect ? 1 : 0);
  return [dot(g, er), r * dot(g, [ct * cp, ct * sp, -st]), r * st * dot(g, [-sp, cp, 0])];
}

/** Centre of a body at time t (the hole: the origin). */
export function bodyCentre(s: Settings, body: Body, t: number): Vec3 {
  if (body === "star") return starCentre(s, t);
  if (body === "barycentre") return barycentre(s, t);
  if (body === "wormhole") return mouth(s).C;
  return [0, 0, 0];
}

/** Size used to frame a body: horizon, photosphere, throat. */
export function bodyRadius(s: Settings, body: Body) {
  if (body === "star") return s.sunRadius;
  if (body === "barycentre") return 1;
  if (body === "wormhole") return mouth(s).w.rho;
  return horizon(s.spin);
}

/** Angular radius of a body seen from distance d (the hole: its shadow, ≈ 3√3 M far away). */
export function angularRadius(s: Settings, body: Body, d: number) {
  const R = body === "hole" ? 3 * Math.sqrt(3) : body === "wormhole" ? 1.6 * mouth(s).w.rho : body === "barycentre" ? 0.5 : s.sunRadius;
  return Math.asin(Math.min(1, R / Math.max(d, 1e-6)));
}

/** Bodies in the camera's universe: through the wormhole (our side) only the wormhole itself. */
export function availableBodies(s: Settings, cam: CameraFrame): Body[] {
  if (s.wormhole && cam.region === "throat" && cam.ell < 0) return ["wormhole"];
  const list: Body[] = ["hole"];
  if (s.sun) list.push("star");
  if (baryFraction(s) > 0) list.push("barycentre");
  if (s.wormhole) list.push("wormhole");
  return list;
}

/** Camera position in the black hole's Cartesian frame (null on our side of the wormhole). */
export function cameraPosition(s: Settings, cam: CameraFrame): Vec3 | null {
  if (cam.region === "hole") return blToCartesian(cam.r, cam.theta, cam.phi);
  if (cam.ell < 0) return null;
  const m = mouth(s);
  return repToHole(m, cam.ell, cam.n);
}

/** Straight-line distance from the camera to a body's centre (∞ from our side, except the wormhole). */
export function bodyDistance(s: Settings, cam: CameraFrame, body: Body, t: number) {
  if (cam.region === "throat" && cam.ell < 0) return body === "wormhole" ? Math.abs(cam.ell) : Infinity;
  const X = cameraPosition(s, cam)!;
  return Math.hypot(...sub(bodyCentre(s, body, t), X));
}

// ------------------------------------------------------------------------------------ Kerr rays
type Chord = { q0: Vec3; q1: Vec3; t0: number; t1: number; th0: number; th1: number; r0: number; r1: number };

/** Static observer at a Cartesian point (for rays re-entering Kerr from the gluing sphere). */
function staticFrameAt(X: Vec3, a: number): CameraFrame {
  const f = sphericalFrame(X);
  const r = Math.max(f.r, horizon(a) + 1e-3);
  return {
    region: "hole", r, theta: f.th, phi: f.ph, ell: 0, n: [1, 0, 0], right: [0, 0, 1], up: [0, -1, 0], fwd: [-1, 0, 0],
    zamo: zamo(r, f.th, a), beta: [0, 0, 0], gamma: 1, speed: 0,
  };
}

/**
 * Follows a backward ray through Kerr, calling `visit` for each chord (Cartesian end points and
 * coordinate times along the ray, t ≤ 0) until it returns true, or the ray falls in / escapes.
 */
function walkKerr(s: Settings, st0: State, L0: number, visit: (c: Chord) => boolean, maxSteps = 6000, time = 0, noLens = false, indirect = true) {
  const a = s.spin;
  const rH = horizon(a);
  const tol = 0.02 + 0.3 * (1 - Math.sqrt(Math.max(0, 1 - a * a)));
  const star = s.sun ? { rs: starOrbitRadius(s), R: s.sunRadius } : null;
  const m = s.wormhole ? mouth(s) : null;
  let rEsc = 600;
  if (star) rEsc = Math.max(rEsc, star.rs + star.R + 60);
  if (m) rEsc = Math.max(rEsc, Math.hypot(...m.C) + m.rGlue + 60);
  const massive = !!star && s.sunMass > 0 && !noLens;
  let L = L0;
  let st = st0;
  let q0 = blToCartesian(st.x[0], st.x[1], st.x[2]);
  for (let i = 0; i < maxSteps; i++) {
    let h = stepSize(st, L, a, 0.03, rH);
    // never step over the star or the mouth
    if (star) {
      const dRing = Math.hypot(Math.hypot(q0[0], q0[1]) - star.rs, q0[2]);
      h = Math.min(h, Math.max(0.5 * (dRing - star.R), 0.25 * star.R));
      if (massive) h = Math.min(h, Math.max(0.3 * Math.hypot(...sub(q0, starCentre(s, time + st.x[3]))), 0.25 * star.R));
    }
    if (m) {
      const dm = Math.hypot(...sub(q0, m.C));
      h = Math.min(h, Math.max(0.5 * (dm - m.rGlue), 0.25 * m.rGlue));
    }
    let n = rk4(st, L, a, -h);
    if (n.x[1] < 0) n = { x: [n.x[0], -n.x[1], n.x[2] + Math.PI, n.x[3]], p: [n.p[0], -n.p[1]] };
    if (n.x[1] > Math.PI) n = { x: [n.x[0], 2 * Math.PI - n.x[1], n.x[2] + Math.PI, n.x[3]], p: [n.p[0], -n.p[1]] };
    if (massive) {
      // the star's weak field: trapezoidal kick of p_r, p_θ and L (as the shader)
      const qn = blToCartesian(n.x[0], n.x[1], n.x[2]);
      const back = norm(sub(qn, q0));
      const f0 = starForce(s, st.x[0], st.x[1], st.x[2], time + st.x[3], back, indirect);
      const f1 = starForce(s, n.x[0], n.x[1], n.x[2], time + n.x[3], back, indirect);
      n = { x: n.x, p: [n.p[0] + 0.5 * h * (f0[0] + f1[0]), n.p[1] + 0.5 * h * (f0[1] + f1[1])] };
      L += 0.5 * h * (f0[2] + f1[2]);
    }
    if (!Number.isFinite(n.x[0]) || n.x[0] < rH + tol) return "horizon";
    const q1 = blToCartesian(n.x[0], n.x[1], n.x[2]);
    if (visit({ q0, q1, t0: st.x[3], t1: n.x[3], th0: st.x[1], th1: n.x[1], r0: st.x[0], r1: n.x[0] })) return "stopped";
    if (n.x[0] > rEsc && n.x[0] > st.x[0]) return "escape";
    st = n;
    q0 = q1;
  }
  return "maxsteps";
}

/**
 * Backward ray along `look` (camera components) until it escapes: its final direction (Cartesian,
 * from the last chord) and its closest approach to the star's centre (for tests and diagnostics).
 */
export function traceRay(s: Settings, cam: CameraFrame, look: Vec3, time = 0, o: { indirect?: boolean } = {}) {
  const ray = cameraRay(cam, look);
  if (!ray) return null;
  let dir: Vec3 = [0, 0, 0];
  let starMin = Infinity;
  const fate = walkKerr(s, ray.state, ray.L, (c) => {
    dir = sub(c.q1, c.q0);
    if (s.sun) {
      const C = starCentre(s, time + 0.5 * (c.t0 + c.t1));
      const dv = sub(c.q1, c.q0);
      const u = Math.min(1, Math.max(0, dot(sub(C, c.q0), dv) / Math.max(dot(dv, dv), 1e-18)));
      starMin = Math.min(starMin, Math.hypot(...sub(lin(c.q0, 1, dv, u), C)));
    }
    return false;
  }, 20000, time, false, o.indirect ?? true);
  return { fate, dir: norm(dir), starMin };
}

/** First intersection of the chord p0 → p1 with a sphere, as a fraction (−1: none; 0: starts inside). */
export function sphereHit(p0: Vec3, p1: Vec3, c: Vec3, R: number) {
  const dv = sub(p1, p0);
  const f = sub(p0, c);
  const cc = dot(f, f) - R * R;
  const A = dot(dv, dv);
  const B = dot(f, dv);
  if (cc <= 0) return 0;
  const disc = B * B - A * cc;
  if (disc < 0 || B >= 0) return -1;
  const t = (-B - Math.sqrt(disc)) / A;
  return t <= 1 ? t : -1;
}

/** What a Kerr ray meets first. */
function pickKerr(s: Settings, st: State, L: number, time: number, skipGlue = false): Body | null {
  const m = s.wormhole ? mouth(s) : null;
  const rIn = isco(s.spin);
  let outside = !skipGlue;
  let hit: Body | null = null;
  const fate = walkKerr(s, st, L, (c) => {
    let best = Infinity;
    if (s.sun) {
      const f = sphereHit(c.q0, c.q1, starCentre(s, time + 0.5 * (c.t0 + c.t1)), s.sunRadius);
      if (f >= 0 && f < best) (best = f), (hit = "star");
    }
    if (m) {
      const inside = Math.hypot(...sub(c.q0, m.C)) < m.rGlue;
      if (!outside && !inside) outside = true;
      if (outside) {
        const f = sphereHit(c.q0, c.q1, m.C, m.rGlue);
        if (f >= 0 && f < best) (best = f), (hit = "wormhole");
      }
    }
    if (s.disk && (c.th0 - Math.PI / 2) * (c.th1 - Math.PI / 2) < 0) {
      const f = (c.th0 - Math.PI / 2) / (c.th0 - c.th1);
      const r = c.r0 + f * (c.r1 - c.r0);
      if (r > 0.97 * rIn && r < s.diskOuter && f < best) (best = f), (hit = "hole");
    }
    return best < Infinity;
  }, 6000, time);
  if (fate === "horizon") return "hole";
  return fate === "stopped" ? hit : null;
}

/** Look direction (camera rest frame) through a pixel: NDC x right, y up (like the shader). */
export function pixelLook(cam: CameraFrame, ndcX: number, ndcY: number, fovDeg: number, aspect: number): Vec3 {
  const tanH = Math.tan((fovDeg * DEG) / 2);
  return norm(lin(lin(cam.fwd, 1, cam.right, ndcX * tanH * aspect), 1, cam.up, ndcY * tanH));
}

/**
 * The body seen along a look direction (camera components), or null for the sky. From inside the
 * wormhole's gluing sphere the ray is first followed through the Dneg metric.
 */
export function pick(s: Settings, cam: CameraFrame, look: Vec3, time: number): Body | null {
  if (cam.region === "hole") {
    const ray = cameraRay(cam, look);
    return ray ? pickKerr(s, ray.state, ray.L, time) : null;
  }
  const m = mouth(s);
  const end = traceDneg(m.w, cam.ell, cam.n, norm(look), m.lGlue, Math.max(m.lFar, Math.abs(cam.ell) + 1), { maxSteps: 20000 });
  if (cam.ell < 0) return end.side === 1 ? "wormhole" : null; // our side: through the mouth or the sky
  if (end.side !== 1) return "wormhole"; // through to our universe
  // out of the gluing sphere into the black hole's universe
  const X = repToHole(m, end.l, end.n);
  const f = sphericalFrame(X);
  const d = fromMouth(m, end.d);
  const ray = cameraRay(staticFrameAt(X, s.spin), [dot(d, f.er), dot(d, f.et), dot(d, f.ep)]);
  return ray ? pickKerr(s, ray.state, ray.L, time, true) : null;
}

// ------------------------------------------------------------------------------------ aiming
/** Look direction (camera components) of a ZAMO-frame arrival direction `dirZ` (towards the source). */
function aberrate(cam: CameraFrame, dirZ: Vec3): Vec3 {
  const p = norm(dirZ).map((v) => -v) as Vec3; // photon momentum, towards the camera
  const c = zamoToCamera(1, p, cam.beta, cam.gamma);
  return norm(c.p).map((v) => -v) as Vec3;
}

/** Straight-line (unlensed) direction to a point, camera components. */
export function geometricLook(s: Settings, cam: CameraFrame, P: Vec3): Vec3 {
  if (cam.region === "hole") {
    const X = blToCartesian(cam.r, cam.theta, cam.phi);
    const f = sphericalFrame(X);
    const d = sub(P, X);
    return aberrate(cam, [dot(d, f.er), dot(d, f.et), dot(d, f.ep)]);
  }
  const m = mouth(s);
  if (cam.ell < 0) return cam.fwd; // (not used: no Kerr point is visible in a straight line from our side)
  return norm(toMouth(m, sub(P, repToHole(m, cam.ell, cam.n))));
}

/** Closest approach of the backward ray along `look` to a (moving) point: miss vector and distance. */
function closestApproach(s: Settings, cam: CameraFrame, look: Vec3, centre: (t: number) => Vec3, time: number, noLens = false) {
  const ray = cameraRay(cam, look);
  if (!ray) return null;
  let best: Vec3 | null = null;
  let bestD = Infinity;
  let far = 0;
  walkKerr(s, ray.state, ray.L, (c) => {
    const C = centre(time + 0.5 * (c.t0 + c.t1));
    const dv = sub(c.q1, c.q0);
    const u = Math.min(1, Math.max(0, dot(sub(C, c.q0), dv) / Math.max(dot(dv, dv), 1e-18)));
    const miss = sub(lin(c.q0, 1, dv, u), C);
    const d = Math.hypot(...miss);
    if (d < bestD) (bestD = d), (best = miss);
    // well past the closest approach: stop
    far = d > 2 * bestD + 5 ? far + 1 : 0;
    return far > 8;
  }, 4000, time, noLens);
  return best ? { miss: best as Vec3, d: bestD } : null;
}

/**
 * Viewing direction (camera components) of the image of a point `centre(t)` — the primary image,
 * found from `guess` by Gauss–Newton on the miss vector of the traced ray. Null if it fails (e.g.
 * the point is hidden behind the hole's shadow).
 */
export function apparentDirection(
  s: Settings, cam: CameraFrame, centre: (t: number) => Vec3, time: number, guess: Vec3, tol = 1e-3, noLens = false,
): { look: Vec3; miss: number } | null {
  if (cam.region !== "hole") return null;
  let d = norm(guess);
  let res = closestApproach(s, cam, d, centre, time, noLens);
  if (!res) return null;
  for (let it = 0; it < 8 && res.d > tol; it++) {
    const e1 = norm(cross(d, Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const e2 = cross(d, e1);
    const h = 2e-4;
    const r1 = closestApproach(s, cam, norm(lin(d, 1, e1, h)), centre, time, noLens);
    const r2 = closestApproach(s, cam, norm(lin(d, 1, e2, h)), centre, time, noLens);
    if (!r1 || !r2) return null;
    const J1 = lin(r1.miss, 1 / h, res.miss, -1 / h);
    const J2 = lin(r2.miss, 1 / h, res.miss, -1 / h);
    // least squares: (JᵀJ) δ = −Jᵀ r
    const a11 = dot(J1, J1), a12 = dot(J1, J2), a22 = dot(J2, J2);
    const b1 = -dot(J1, res.miss), b2 = -dot(J2, res.miss);
    const det = a11 * a22 - a12 * a12;
    if (!(Math.abs(det) > 1e-30)) return null;
    let du = (b1 * a22 - b2 * a12) / det;
    let dv = (a11 * b2 - a12 * b1) / det;
    const step = Math.hypot(du, dv);
    if (step > 0.3) (du *= 0.3 / step), (dv *= 0.3 / step);
    // backtracking: accept the step only if the miss shrinks
    let k = 1;
    let next = null;
    for (let tries = 0; tries < 5; tries++, k *= 0.5) {
      const dn = norm(lin(lin(d, 1, e1, k * du), 1, e2, k * dv));
      const rn = closestApproach(s, cam, dn, centre, time, noLens);
      if (rn && rn.d < res.d) {
        next = { d: dn, r: rn };
        break;
      }
    }
    if (!next) break;
    d = next.d;
    res = next.r;
  }
  return { look: d, miss: res.d };
}

/**
 * Where a body appears (camera components): its centre's image for the star and the mouth, the
 * direction of the hole's centre (aberrated) for the hole. `guess`: the previous answer (warm start).
 */
export function bodyLook(s: Settings, cam: CameraFrame, body: Body, time: number, guess?: Vec3 | null): { look: Vec3; lensed: boolean } {
  if (cam.region === "throat") {
    if (body === "wormhole") return { look: cam.ell < 0 ? norm(cam.n) : norm(cam.n).map((v) => -v) as Vec3, lensed: false };
    return { look: geometricLook(s, cam, bodyCentre(s, body, time)), lensed: false };
  }
  if (body === "hole") return { look: aberrate(cam, [-1, 0, 0]), lensed: false };
  // the centre of mass is a point, not a light source: aim along the straight line (aberrated)
  if (body === "barycentre") return { look: geometricLook(s, cam, bodyCentre(s, body, time)), lensed: false };
  // the star's own field is symmetric about its centre: it does not move the central ray
  const noLens = body === "star";
  const centre = (t: number) => bodyCentre(s, body, t);
  const geo = geometricLook(s, cam, centre(time));
  const R = bodyRadius(s, body);
  const solve = (g: Vec3) => {
    const r = apparentDirection(s, cam, centre, time, g, 1e-3 * R, noLens);
    return r && r.miss < 0.25 * R ? r.look : null;
  };
  // the primary image is the one closest to the straight line: the warm start may have followed
  // a secondary image (bent around the hole) as the camera moved — then a start from the straight
  // line finds the primary again
  const off = (v: Vec3) => Math.acos(Math.min(1, dot(v, geo)));
  const warm = guess && solve(guess);
  if (warm && off(warm) < 0.035) return { look: warm, lensed: true };
  const direct = solve(geo);
  const best = [warm, direct].filter((v): v is Vec3 => !!v).sort((a, b) => off(a) - off(b))[0];
  if (best) return { look: best, lensed: true };
  // cold start. Behind the hole the straight line falls into the shadow and the image lies around
  // it: seed with the straight line and a ring of directions around the hole, keep the best rays
  const hole = aberrate(cam, [-1, 0, 0]);
  const e1 = norm(cross(hole, Math.abs(hole[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  const e2 = cross(hole, e1);
  const shadow = angularRadius(s, "hole", cam.r);
  const seeds: Vec3[] = [geo];
  for (const k of [1.15, 1.6, 2.5, 4])
    for (let j = 0; j < 8; j++) {
      const ang = Math.min(k * shadow, 3);
      const ph = (j * Math.PI) / 4;
      seeds.push(norm(lin(hole, Math.cos(ang), lin(e1, Math.cos(ph), e2, Math.sin(ph)), Math.sin(ang))));
    }
  const ranked = seeds
    .map((g) => ({ g, d: closestApproach(s, cam, g, centre, time, noLens)?.d ?? Infinity }))
    .sort((a, b) => a.d - b.d);
  const found = ranked.slice(0, 4).map(({ g }) => solve(g)).filter((v): v is Vec3 => !!v);
  if (found.length) return { look: found.sort((a, b) => off(a) - off(b))[0]!, lensed: true };
  return { look: geo, lensed: false };
}

// ------------------------------------------------------------------------------------ orientation
// The camera's orientation relative to an aim direction, as a unit quaternion acting on canonical
// axes: forward (−1, 0, 0), up (0, −1, 0), right (0, 0, 1) — the same convention as basis().

export type Quat = [number, number, number, number]; // w, x, y, z
export const QUAT_ID: Quat = [1, 0, 0, 0];

function quatFromMatrix(m: number[][]): Quat {
  // m[i][j]: row i, column j; the columns are the images of the x, y, z axes
  const e = (i: number, j: number) => m[i]![j]!;
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [e(0, 0), e(0, 1), e(0, 2), e(1, 0), e(1, 1), e(1, 2), e(2, 0), e(2, 1), e(2, 2)];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2;
    q = [0.25 * S, (m21 - m12) / S, (m02 - m20) / S, (m10 - m01) / S];
  } else if (m00 > m11 && m00 > m22) {
    const S = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [(m21 - m12) / S, 0.25 * S, (m01 + m10) / S, (m02 + m20) / S];
  } else if (m11 > m22) {
    const S = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m02 - m20) / S, (m01 + m10) / S, 0.25 * S, (m12 + m21) / S];
  } else {
    const S = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m10 - m01) / S, (m02 + m20) / S, (m12 + m21) / S, 0.25 * S];
  }
  const n = Math.hypot(...q);
  return q.map((v) => v / n) as Quat;
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const u: Vec3 = [x, y, z];
  const t = lin(cross(u, v), 2, v, 0);
  return lin(lin(v, 1, t, w), 1, cross(u, t), 1);
}

export function slerp(a: Quat, b: Quat, k: number): Quat {
  let c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb = c < 0 ? (b.map((v) => -v) as Quat) : b;
  c = Math.abs(c);
  if (c > 0.9995) {
    const q = a.map((v, i) => v + (bb[i]! - v) * k);
    const n = Math.hypot(...q);
    return q.map((v) => v / n) as Quat;
  }
  const th = Math.acos(c);
  const sa = Math.sin((1 - k) * th) / Math.sin(th);
  const sb = Math.sin(k * th) / Math.sin(th);
  return a.map((v, i) => v * sa + bb[i]! * sb) as Quat;
}

/** Angle of a rotation quaternion [rad]. */
export const quatAngle = (q: Quat) => 2 * Math.acos(Math.min(1, Math.abs(q[0])));

/** Aim frame: forward along `aim`, up as close as possible to `upHint`. */
export function aimFrame(aim: Vec3, upHint: Vec3 = [0, -1, 0]) {
  const F = norm(aim);
  let U = lin(upHint, 1, F, -dot(upHint, F));
  if (Math.hypot(...U) < 1e-4) U = lin([0, 0, 1], 1, F, -F[2]);
  U = norm(U);
  const R = cross(F, U);
  return { F, U, R };
}

/** Orientation (fwd, up) relative to the aim frame, as a quaternion on the canonical axes. */
export function offsetFrom(aim: ReturnType<typeof aimFrame>, fwd: Vec3, up: Vec3): Quat {
  const c = (v: Vec3): Vec3 => [-dot(v, aim.F), -dot(v, aim.U), dot(v, aim.R)];
  const f = c(fwd);
  const u = c(up);
  const r = cross(f, u); // right = fwd × up
  // the rotation maps (−1,0,0) → f, (0,−1,0) → u, (0,0,1) → r: its columns are (−f, −u, r)
  const cols = [f.map((v) => -v), u.map((v) => -v), r];
  return quatFromMatrix([0, 1, 2].map((i) => [cols[0]![i]!, cols[1]![i]!, cols[2]![i]!]));
}

/** Inverse of offsetFrom(): the camera's (fwd, up) from the aim frame and the offset. */
export function composeOffset(aim: ReturnType<typeof aimFrame>, q: Quat) {
  const back = (c: Vec3): Vec3 => lin(lin(aim.F, -c[0], aim.U, -c[1]), 1, aim.R, c[2]);
  return { fwd: back(quatRotate(q, [-1, 0, 0])), up: back(quatRotate(q, [0, -1, 0])) };
}
