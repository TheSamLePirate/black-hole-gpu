import type { Vec3 } from "../physics";
import { radius, type Dneg } from "../wormhole";
import { solarBody, spinVector } from "../system/solar";

import type { PoseKeys } from "../controls";

export const POSE_KEYS: PoseKeys[] = ["anchor", "whL", "distance", "inclination", "azimuth", "yaw", "pitch", "roll"];

export const onAxesV = (A: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [
  A[0][0] * v[0] + A[1][0] * v[1] + A[2][0] * v[2],
  A[0][1] * v[0] + A[1][1] * v[1] + A[2][1] * v[2],
  A[0][2] * v[0] + A[1][2] * v[1] + A[2][2] * v[2],
];

/**
 * Free-flight keys, by physical position (KeyboardEvent.code) so that they are Z Q S D / A E / W X on
 * a French AZERTY keyboard and W A S D / Q E / Z X on QWERTY. They are reserved for flight: no other
 * shortcut uses them.
 */
export const FLIGHT_KEYS: Record<string, [number, number, number, number]> = {
  // [forward, right, up, roll]
  KeyW: [1, 0, 0, 0], // Z (AZERTY): forward
  KeyS: [-1, 0, 0, 0], // S: backward
  KeyA: [0, -1, 0, 0], // Q (AZERTY): left
  KeyD: [0, 1, 0, 0], // D: right
  KeyE: [0, 0, 1, 0], // E: up
  KeyQ: [0, 0, -1, 0], // A (AZERTY): down
  KeyZ: [0, 0, 0, 1], // W (AZERTY): roll left
  KeyX: [0, 0, 0, -1], // X: roll right
};

/** The telescope's narrowest field [°] (the tracer's rays in float32: ~10 ulps per pixel at 1080 p) */
export const TELE_MIN = 0.02;
export const MAX_RANGE = 1000; // M: how far free flight may take the camera
export const normalize = (a: Vec3): Vec3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
/** Rotation by `ang` [rad] about the z axis. */
export const rotZ = (v: Vec3, ang: number): Vec3 => [
  v[0] * Math.cos(ang) - v[1] * Math.sin(ang),
  v[0] * Math.sin(ang) + v[1] * Math.cos(ang),
  v[2],
];
/** Components c along the frame (e0, e1, e2) → Cartesian vector. */
export const add3 = (e0: Vec3, e1: Vec3, e2: Vec3, c: Vec3): Vec3 => [
  e0[0] * c[0] + e1[0] * c[1] + e2[0] * c[2],
  e0[1] * c[0] + e1[1] * c[1] + e2[1] * c[2],
  e0[2] * c[0] + e1[2] * c[1] + e2[2] * c[2],
];
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const lerpAngle = (a: number, b: number, k: number) => a + (((((b - a + 540) % 360) + 360) % 360) - 180) * k;
export const smoothstep = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

export function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

/** b − a wrapped to (−180°, 180°]. */
export function angleDiff(a: number, b: number) {
  return ((((b - a + 180) % 360) + 360) % 360) - 180;
}

export function wrapDeg(d: number) {
  return ((((d + 360) % 720) + 720) % 720) - 360;
}

/** Is a key going into a text field? (A slider, a checkbox, a button keep the keys flying.) */
export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === "INPUT") return !/^(range|checkbox|radio|color|button|submit|reset|file|image)$/.test((t as HTMLInputElement).type);
  return t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}

/** A rep pose's distance from the mouth in the home frame */
export function homeOfPose(w: Dneg, p: { l: number; n: Vec3 }) {
  return { r: radius(w, p.l)[0] };
}

export const unitV = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/**
 * A glider's climb angle down to the runway [rad]: the steep path (the Shuttle's ~18°) to the flare,
 * then the flare — the sink rate eased exponentially to a touchdown's ~1 m/s, its time constant set as it
 * starts from the sink it comes down with (≈ 0.4 g of pull: a steep fast final flares from ~500 m, a
 * slow one from ~50 m). `R.flareTau` keeps it; above twice its height again (a go-around), cleared.
 */
export function flareRef(R: { flareTau?: number }, agl: number, steep: number, sp: number, gam: number): number {
  const sink = -sp * Math.sin(gam);
  // (begun at tau × the sink: from a steep final's ~35 m/s some 230 m up — the pull-up within reach)
  const tau = R.flareTau ?? clamp(sink / 5, 4, 7);
  if (R.flareTau === undefined && agl <= Math.max(tau * sink, 40)) R.flareTau = tau;
  else if (R.flareTau !== undefined && agl > 2 * Math.max(tau * sink, 40) + 100) R.flareTau = undefined;
  if (R.flareTau === undefined) return steep;
  return Math.max(steep, -Math.asin(Math.min((0.8 + agl / R.flareTau) / Math.max(sp, 1), 0.5)));
}

/**
 * The final's profile to the touchdown aimed (the Shuttle's, scaled to the Ranger): the steep slope from
 * the craft down to a corner 90 m up, a pull-up at ~0.3 g onto a shallow slope of 1.5° (the speed bled
 * there), and from 12 m a flare — a parabola tangent to the ground at the touchdown, 450 m past the
 * threshold. Along the runway's axis x [m from the threshold], the height h [m] over the ground, the
 * speed v [m/s]: the profile's height and slope there. The steep slope's angle follows the craft (the
 * line from it to the corner, 15° at most) until the pull-up nears; then it and the pull-up's length (its
 * radius v² / 0.3 g) are frozen (`fix`): the touchdown no longer drifts with the speed or the float.
 */
export const LANDING = { td: 450, gi: (1.5 * Math.PI) / 180, hF: 12, hC: 90, goMax: 0.26 };
export type LandingFix = { go: number; lb: number };
export function landingProfile(
  x: number,
  h: number,
  v = 150,
  fixed?: LandingFix,
): {
  h: number;
  slope: number;
  phase: "outer" | "preflare" | "inner" | "flare" | "rollout";
  fix: LandingFix;
  freeze: boolean;
  aim: number;
} {
  const { td, gi, hF, hC, goMax } = LANDING;
  const tgi = Math.tan(gi);
  const LF = (2 * hF) / tgi;
  const xF = td - LF;
  const xC = xF - (hC - hF) / tgi;
  const go = fixed?.go ?? clamp(Math.atan2(h - hC, Math.max(xC - x, 1)), gi + 0.02, goMax);
  const lb = fixed?.lb ?? clamp(((v * v) / (0.3 * 9.81)) * (go - gi), 300, 3000);
  const fix = { go, lb };
  const tgo = Math.tan(go);
  const x0 = xC - lb / 2,
    x2 = xC + lb / 2;
  const aim = xC + hC / tgo;
  const freeze = x > x0 - 600;
  if (x >= td) return { h: 0, slope: 0, phase: "rollout", fix, freeze, aim };
  if (x >= xF) {
    const u = td - x;
    return { h: hF * (u / LF) ** 2, slope: (-2 * hF * u) / (LF * LF), phase: "flare", fix, freeze, aim };
  }
  if (x >= x2) return { h: hF + (xF - x) * tgi, slope: -tgi, phase: "inner", fix, freeze, aim };
  if (x >= x0) {
    // (a quadratic Bézier from the steep slope to the shallow one, through the corner's control point)
    const h0 = hC + (lb / 2) * tgo,
      h2 = hC - (lb / 2) * tgi;
    const u = (x - x0) / lb;
    return {
      h: (1 - u) ** 2 * h0 + 2 * u * (1 - u) * hC + u * u * h2,
      slope: (2 * (1 - u) * (hC - h0) + 2 * u * (h2 - hC)) / lb,
      phase: "preflare",
      fix,
      freeze,
      aim,
    };
  }
  return { h: hC + (xC - x) * tgo, slope: -tgo, phase: "outer", fix, freeze, aim };
}

/** A duration [s], briefly. */
export function fmtDur(s: number): string {
  if (!Number.isFinite(s)) return "—";
  if (s < 59.5) return `${s.toFixed(0)} s`;
  // (rounded first: 17 min 59.6 s is 18 min 0 s, not 17 min 60 s)
  if (s < 3599.5) {
    const r = Math.round(s);
    return `${Math.floor(r / 60)} min ${r % 60} s`;
  }
  if (s < 86400) {
    const m = Math.round(s / 60);
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  return `${(s / 86400).toFixed(1)} d`;
}

/** v turned by ang about the unit axis k (Rodrigues) */
export function rotateAbout(v: Vec3, k: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang),
    s = Math.sin(ang);
  const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x: Vec3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [v[0] * c + x[0] * s + k[0] * kv * (1 - c), v[1] * c + x[1] * s + k[1] * kv * (1 - c), v[2] * c + x[2] * s + k[2] * kv * (1 - c)];
}
export const spinAxis = (id: string) => spinVector(solarBody(id)!);
export const spinRate = (id: string) => Math.hypot(...spinVector(solarBody(id)!));

/** A look's yaw kept in (−180°, 180°]: turning past behind goes on round, no stop. */
export function wrapYaw(y: number): number {
  const w = ((((y + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}
