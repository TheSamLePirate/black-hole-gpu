// A free-flight prediction carries its frame at every sample. Different universes are never joined
// by a Cartesian line. The Dneg drift is the same one used by the live ship.
import type { Settings } from "../settings";
import type { Vec3 } from "../physics";
import { blToCartesian, cameraFrame, repPose, setHolePose, setRepPose, type RepPose } from "../camera";
import { fromZamo, toZamo } from "../geodesic";
import { lensesOf } from "../lenses";
import { add, dot, scale } from "../math/vec3";
import { ellOfR, mouth, radius, sphericalFrame, type WormholeUniverse } from "../wormhole";
import { homeOf, repToHomeVec } from "./our-side";
import { predictOurs } from "./our-predict";
import { advanceToMouth, driftDneg, driftToGlue } from "./wormhole-flight";
import { wormholeMapPose } from "./wormhole-map";

export interface WormholeSample {
  t: number;
  universe: WormholeUniverse;
  domain: "hole" | "throat";
  X: Vec3;
  V: Vec3;
  ell: number;
  tunnel: boolean;
}
export interface WormholePath {
  samples: WormholeSample[];
  events: { t: number; kind: "entry" | "centre" | "exit" | "glue"; ell: number }[];
  reason: "horizon" | "stopped" | "step-limit" | "invalid";
}

/** Include the adjacent Kerr approach so its prediction can enter the mouth. */
export function nearWormhole(s: Settings, t: number) {
  if (!s.wormhole) return false;
  const m = mouth(s, t),
    cam = cameraFrame(s, t);
  if (cam.region === "throat") return radius(m.w, cam.ell)[0] <= 12 * m.w.rho;
  const X = blToCartesian(cam.r, cam.theta, cam.phi);
  return Math.hypot(X[0] - m.C[0], X[1] - m.C[1], X[2] - m.C[2]) < 2 * m.rGlue;
}

export function predictWormhole(
  settings: Settings,
  t0: number,
  entry: WormholeUniverse,
  options: { horizon?: number; maxSteps?: number } = {},
): WormholePath {
  const s = { ...settings };
  const m0 = mouth(s, t0);
  let cam = cameraFrame(s, t0);
  let pose: RepPose = cam.region === "throat" ? { l: cam.ell, n: cam.n, fwd: cam.fwd, up: cam.up, vel: cam.beta } : repPose(s, t0);
  const speed = Math.hypot(...cam.beta);
  const horizon =
    options.horizon ?? Math.min(60000, Math.max(300, (1.5 * (Math.abs(pose.l) + m0.lGlue + 12 * m0.w.rho)) / Math.max(speed, 1e-5)));
  const out: WormholePath = { samples: [], events: [], reason: "horizon" };
  let t = t0;
  let side = entry;
  const append = () => {
    const f = cameraFrame(s, t);
    const map = wormholeMapPose(s, f, t, f.fwd, side)!;
    if (map.tunnel.universe) side = map.tunnel.universe;
    out.samples.push({ t, universe: map.universe, domain: f.region, X: map.X, V: map.V, ell: map.tunnel.ell, tunnel: map.tunnel.inside });
  };
  append();
  const maxSteps = options.maxSteps ?? 2048;
  for (let k = 0; k < maxSteps && t < t0 + horizon; k++) {
    cam = cameraFrame(s, t);
    const m = mouth(s, t);
    const sp = Math.max(Math.hypot(...cam.beta), 1e-8);
    let dt = Math.min(horizon / 160, t0 + horizon - t);
    if (cam.region === "throat") {
      pose = { l: cam.ell, n: cam.n, fwd: cam.fwd, up: cam.up, vel: cam.beta };
      if (pose.l < -m.w.a && radius(m.w, pose.l)[0] > 12 * m.w.rho && s.system === "gargantua") {
        const tail = predictOurs(homeOf(m.w, pose.l, pose.n), repToHomeVec(m.w, pose.l, pose.n, pose.vel), t, [], {
          tMax: t0 + horizon - t,
          maxSteps: maxSteps - k,
          mouthR: m.w.rho,
        });
        for (let j = 1; j < tail.times.length; j++)
          out.samples.push({
            t: tail.times[j]!,
            universe: "ours",
            domain: "throat",
            X: tail.pts[j]!,
            V: tail.vels[j]!,
            ell: -ellOfR(m.w, Math.hypot(...tail.pts[j]!)),
            tunnel: false,
          });
        out.reason = tail.fate !== "continues" ? "stopped" : out.samples.at(-1)!.t < t0 + horizon - 1e-8 ? "step-limit" : "horizon";
        break;
      }
      dt = Math.min(dt, Math.max((0.08 * radius(m.w, pose.l)[0]) / sp, 1e-8));
      const boundaries = [-m.w.a, 0, m.w.a, m.lGlue];
      let next = driftDneg(m.w, pose, t, dt, 1, s.system === "gargantua");
      const crossed = boundaries.filter((b) => (pose.l < b && next.l >= b) || (pose.l > b && next.l <= b));
      if (crossed.length) {
        const b = next.l > pose.l ? Math.min(...crossed) : Math.max(...crossed);
        let lo = 0,
          hi = dt;
        for (let j = 0; j < 32; j++) {
          const mid = (lo + hi) / 2;
          const q = driftDneg(m.w, pose, t, mid, 1, s.system === "gargantua");
          const beforeBoundary = pose.l < b;
          if (q.l < b === beforeBoundary) lo = mid;
          else hi = mid;
        }
        dt = hi;
        next = driftDneg(m.w, pose, t, dt, 1, s.system === "gargantua");
        // Exact event coordinates prevent a rounding residual from duplicating a boundary.
        next.l = b;
        out.events.push({
          t: t + dt,
          ell: b,
          kind: b === 0 ? "centre" : b === m.lGlue ? "glue" : b < 0 === dot(next.vel, next.n) > 0 ? "entry" : "exit",
        });
      }
      if (next.l >= m.lGlue && dot(next.vel, next.n) > 0) {
        const glue = driftToGlue(m.w, pose, t, dt, 1, s.system === "gargantua", m.lGlue);
        dt = glue.elapsed;
        next = glue;
      }
      setRepPose(s, next);
    } else {
      const X = blToCartesian(cam.r, cam.theta, cam.phi);
      const dist = Math.hypot(X[0] - m.C[0], X[1] - m.C[1], X[2] - m.C[2]);
      dt = Math.min(dt, Math.max((0.08 * Math.max(dist, m.rGlue)) / sp, 1e-8));
      const st = fromZamo(cam.r, cam.theta, cam.phi, cam.beta, s.spin, t);
      const res = advanceToMouth(s, st, dt, 0, [0, 0, 0], lensesOf(s));
      if (res.stopped || res.landed || !(res.st.t > t)) {
        out.reason = "stopped";
        break;
      }
      dt = res.st.t - t;
      const Y = blToCartesian(res.st.r, res.st.th, res.st.ph);
      const f = sphericalFrame(Y),
        v = toZamo(res.st, s.spin);
      const W = (u: Vec3) => add(add(scale(f.er, u[0]), scale(f.et, u[1])), scale(f.ep, u[2]));
      const f0 = sphericalFrame(X);
      const W0 = (u: Vec3) => add(add(scale(f0.er, u[0]), scale(f0.et, u[1])), scale(f0.ep, u[2]));
      setHolePose(s, Y, W0(cam.fwd), W0(cam.up), W(v));
      if (cameraFrame(s, res.st.t).region === "throat") out.events.push({ t: res.st.t, kind: "glue", ell: m.lGlue });
    }
    if (!(dt > 0) || !Number.isFinite(s.whL) || !Number.isFinite(s.distance)) {
      out.reason = "invalid";
      break;
    }
    t += dt;
    append();
    if (k === maxSteps - 1 && t < t0 + horizon) out.reason = "step-limit";
  }
  return out;
}

export function wormholeSampleAt(path: WormholePath, t: number, universe: WormholeUniverse) {
  const a = path.samples;
  let lo = 0,
    hi = a.length - 1;
  if (!a.length || t < a[0]!.t || t > a[hi]!.t) return null;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (a[m]!.t <= t) lo = m;
    else hi = m;
  }
  const A = a[lo]!,
    B = a[hi]!;
  if (t === A.t && A.universe === universe) return { X: A.X, V: A.V, ell: A.ell, tunnel: A.tunnel };
  if (t === B.t && B.universe === universe) return { X: B.X, V: B.V, ell: B.ell, tunnel: B.tunnel };
  if (A.universe !== universe || B.universe !== universe) return null;
  const f = (t - A.t) / Math.max(B.t - A.t, 1e-30);
  const mix = (a: Vec3, b: Vec3): Vec3 => a.map((v, j) => v + f * (b[j]! - v)) as Vec3;
  return { X: mix(A.X, B.X), V: mix(A.V, B.V), ell: A.ell + f * (B.ell - A.ell), tunnel: A.tunnel || B.tunnel };
}
