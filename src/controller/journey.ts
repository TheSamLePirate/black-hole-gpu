// The CameraController — the journey through the wormhole.
// (Its methods, out of controls.ts: installed on its prototype — `this` the controller.)
import { repPose, setRepPose, switchAnchor } from "../camera";
import { horizon } from "../physics";
import type { Settings } from "../settings";
import { mouth, repToHole, sphericalFrame } from "../wormhole";
import { DEG } from "../units";

import type { CameraController, PoseKeys } from "../controls";
import { POSE_KEYS, lerp, lerpAngle, smoothstep, wrapDeg } from "./util";

declare module "../controls" {
  interface CameraController {
    startJourney: typeof startJourney;
    stepJourney: typeof stepJourney;
    stepDive: typeof stepDive;
  }
}

function startJourney(this: CameraController) {
  const s = this.s;
  if (!s.wormhole) {
    s.wormhole = true;
    s.anchor = "wormhole";
    s.whL = -8 * mouth(s).w.rho;
  }
  s.motion = "static";
  const dir = repPose(s).l < 0 ? "out" : "back";
  if (dir === "back") switchAnchor(s, "hole");
  const start = Object.fromEntries(POSE_KEYS.map((k) => [k, s[k]])) as Pick<Settings, PoseKeys>;
  this.journey = { t: 0, dir, start };
}

/**
 * Out: line up with the mouth on our side, fly radially through the throat (the line that leads
 * to the hole), emerge in the black hole's universe facing it, approach and settle into an orbit.
 * Back: fly to the far mouth, through it, and turn round on our side to look back at the mouth.
 */
function stepJourney(this: CameraController, dt: number) {
  const J = this.journey;
  if (!J) return this.setCinematic(null);
  const s = this.s;
  const m = mouth(s);
  const { rho, a } = m.w;
  J.t += dt;
  const x = Math.min(J.t / Math.max(s.journeyDuration, 1), 1);
  const f1 = 0.22;
  const f2 = 0.58;
  const phase = (lo: number, hi: number) => smoothstep((x - lo) / (hi - lo));
  const asinhL = (l: number) => Math.asinh(l / rho);
  const lOut = m.lGlue * 1.15;
  const st = J.start;
  if (J.dir === "out") {
    const lA = -(a + 6 * rho);
    if (x < f1) {
      const k = phase(0, f1);
      s.anchor = "wormhole";
      s.whL = rho * Math.sinh(lerp(asinhL(st.whL), asinhL(lA), k));
      s.inclination = lerp(st.inclination, 90, k);
      s.azimuth = lerpAngle(st.azimuth, 0, k);
      s.yaw = lerpAngle(st.yaw, 0, k);
      s.pitch = lerp(st.pitch, 0, k);
      s.roll = lerpAngle(st.roll, 0, k);
    } else if (x < f2) {
      const l = rho * Math.sinh(lerp(asinhL(lA), asinhL(lOut), phase(f1, f2)));
      setRepPose(s, { l, n: [1, 0, 0], fwd: [1, 0, 0] });
    } else {
      const k = phase(f2, 1);
      const X0 = repToHole(m, lOut, [1, 0, 0]);
      const f = sphericalFrame(X0);
      s.anchor = "hole";
      // pull back a little to reveal the whole disk, then orbit
      s.distance = Math.exp(lerp(Math.log(f.r), Math.log(Math.max(1.25 * f.r, horizon(s.spin) + 10)), k));
      s.inclination = lerp(f.th / DEG, 81, k);
      s.azimuth = f.ph / DEG + 40 * k;
      s.yaw = 0;
      s.pitch = 0;
    }
    if (x >= 1) {
      this.journey = null;
      this.sync();
      s.target = "hole";
      this.setCinematic("orbit");
    }
  } else {
    const lIn = m.lGlue * 1.3;
    const lB = -(a + 10 * rho);
    if (x < f1) {
      const k = phase(0, f1);
      const target = repToHole(m, lIn, [1, 0, 0]);
      const f = sphericalFrame(target);
      s.anchor = "hole";
      s.distance = Math.exp(lerp(Math.log(st.distance), Math.log(f.r), k));
      s.inclination = lerp(st.inclination, f.th / DEG, k);
      s.azimuth = lerpAngle(st.azimuth, f.ph / DEG, k);
      s.yaw = lerpAngle(st.yaw, 180, k);
      s.pitch = lerp(st.pitch, 0, k);
      s.roll = lerpAngle(st.roll, 0, k);
    } else if (x < f2) {
      const l = rho * Math.sinh(lerp(asinhL(lIn), asinhL(lB), phase(f1, f2)));
      setRepPose(s, { l, n: [1, 0, 0], fwd: [-1, 0, 0] });
    } else {
      const k = phase(f2, 1);
      setRepPose(s, { l: rho * Math.sinh(lerp(asinhL(lB), asinhL(lB * 1.4), k)), n: [1, 0, 0], fwd: [-1, 0, 0] });
      s.yaw = lerpAngle(180, 0, k);
    }
    if (x >= 1) {
      this.journey = null;
      this.sync();
      s.target = "wormhole";
      this.setCinematic(null);
    }
  }
}

function stepDive(this: CameraController, dt: number) {
  const s = this.s;
  const a = s.spin;
  const rH = horizon(a);
  const rEnd = rH + 0.04;
  if (s.distance <= rEnd) {
    this.diveHold += dt;
    if (this.diveHold > 2.5) this.setCinematic(null);
    return;
  }
  // proper-time budget this frame, sub-stepped (RK2) so the plunge stays accurate near r+
  let tau = s.cinematicSpeed * dt;
  const th = (s.inclination * Math.PI) / 180;
  const c2 = Math.cos(th) ** 2;
  const deriv = (r: number) => {
    const sig = r * r + a * a * c2;
    const del = r * r - 2 * r + a * a;
    return {
      dr: -Math.sqrt(2 * r * (r * r + a * a)) / sig, // Σ dr/dτ = −√(2r(r²+a²))
      dphi: (2 * a * r) / (sig * del), // Σ dφ/dτ = 2ar/Δ (frame dragging)
    };
  };
  let r = s.distance;
  let phi = (s.azimuth * Math.PI) / 180;
  while (tau > 0 && r > rEnd) {
    const h = Math.min(tau, 0.02 * (r - rH) + 1e-4);
    const k1 = deriv(r);
    const k2 = deriv(Math.max(r + 0.5 * h * k1.dr, rH + 1e-4));
    r += h * k2.dr;
    phi += h * k2.dphi;
    tau -= h;
  }
  s.distance = Math.max(r, rEnd);
  s.azimuth = wrapDeg((phi * 180) / Math.PI);
  this.targetDistance = s.distance;
}

/** Puts these methods on the controller's prototype (controls.ts, once). */
export function installJourney(C: { prototype: CameraController }) {
  Object.assign(C.prototype, { startJourney, stepJourney, stepDive });
}
