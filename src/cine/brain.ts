// The camera director (Cinemachine's brain and its virtual cameras, for the craft flown — the "Director" view,
// mounts.ts): each shot a virtual camera — its body (where the eye goes), its aim, its lens, its damping —,
// the director choosing among them by the flight's phase (a launch tracked from the ground with a long lens,
// the chase and the fly-by low in the air, the planet's limb behind the craft in orbit, the destination behind
// it in deep space, a slow orbit round it between), each held a while, cut or blended to the next; the lens
// widened with the speed and the afterburner; the airframe's buffeting, the engine's rumble and the hand's
// tremor as noise. Its coordinates: the local frame's axes (quasi-inertial), metres, about the craft's origin.
// Pure: a frame's figures in, the eye, the aim, the up and the field out (controller/cine.ts places them).

import { add3, cross3, dot3, fbm, len3, lerp3, scale3, Spring3, sub3, tangent3, unit3, type V3 } from "./rig";
import { type BlendStyle, blendCurve, blendPose, Impulses, type NoiseProfile, noiseAngles } from "./follow";

export type Shot = "chase" | "orbit" | "pass" | "tracking" | "planet" | "system";
export const SHOTS: Shot[] = ["chase", "orbit", "pass", "tracking", "planet", "system"];

/** What the director reads of the flight (local axes, metres, m/s). */
export interface CineContext {
  /** the craft's axes in the local frame: its left, its up, its nose (unit) */
  ax: [V3, V3, V3];
  /** its centre about its origin (local), the outside views' distance for it [m] */
  centre: V3;
  size: number;
  /** the velocity over the ground (near a world) or in the frame flown in [m/s] */
  vel: V3;
  /** the local vertical (unit; null far from any world) */
  up: V3 | null;
  /** the world near: towards its centre (unit), the distance to it [m], its radius [m] */
  body: { dir: V3; dist: number; radius: number } | null;
  /** towards the Sun, towards the target (unit; null: none) */
  sun: V3 | null;
  target: V3 | null;
  /** the height over the ground [m], the dynamic pressure [Pa], Mach */
  agl: number;
  q: number;
  mach: number;
  /** the engine's level (0 … 1), the afterburner's factor (1: dry) */
  throttle: number;
  boost: number;
  inAir: boolean;
  landed: boolean;
  /** climbing away from the ground on its engine (a take-off, a launch) */
  launch: boolean;
  /** the scene's clock [s] (the noise, the slow orbit) */
  time: number;
}

/** What the player asks: a shot held, or the director choosing; the lens's base field [°]; the noise's amount
 *  (0 … 1); the lens widened with the speed; the distance's factor (the wheel). */
export interface CineAsk {
  shot: Shot | "auto";
  fov: number;
  shake: number;
  dynamicFov: boolean;
  zoom: number;
  /** the blends between moving shots (Cinemachine's default blend: its curve, its time [s]) */
  blend?: { style: BlendStyle; time: number };
  /** the impulses' gain; the noise profile on top of the shot's own, its gains; the dutch [°] */
  impulse?: number;
  noise?: NoiseProfile;
  noiseAmp?: number;
  noiseFreq?: number;
  dutch?: number;
}

export interface CineOut {
  eye: V3;
  aim: V3;
  up: V3;
  fov: number;
  shot: Shot;
}

const D2R = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** The flight's phase, as the director reads it. */
export type CinePhase = "ground" | "launch" | "low" | "air" | "orbit" | "deep";
export function phaseOf(c: CineContext): CinePhase {
  if (c.landed) return "ground";
  if (c.launch && c.agl < 60e3) return "launch";
  if (c.inAir) return c.agl < 3000 ? "low" : "air";
  if (c.body && c.body.dist < 8 * c.body.radius) return "orbit";
  return "deep";
}

/** The shots the director cycles through in each phase (the first: its opening one). */
export const PLAYLIST: Record<CinePhase, Shot[]> = {
  ground: ["orbit", "chase"],
  launch: ["tracking", "chase", "tracking", "orbit"],
  low: ["chase", "pass", "orbit", "chase", "pass"],
  air: ["chase", "orbit", "pass"],
  orbit: ["planet", "chase", "orbit", "planet", "system"],
  deep: ["system", "orbit", "chase"],
};

/** How long a shot is held [s] (the director's; the n-th shot's — a little uneven, as an editor's). */
export function holdFor(shot: Shot, n: number): number {
  const base = shot === "tracking" ? 16 : shot === "pass" ? 14 : shot === "orbit" ? 12 : 10;
  return base * (0.8 + 0.4 * ((n * 0.6180339887) % 1));
}

/** A shot's lens for a subject `size` m at `dist` m, filling `frac` of the frame's height [°], within lo … hi. */
export function lensFor(size: number, dist: number, frac: number, lo: number, hi: number): number {
  return clamp((2 * Math.atan(size / 2 / (Math.max(dist, 1) * frac))) / D2R, lo, hi);
}

/** A shot's wants: where the eye goes, where it aims, the up, the field; the springs' times [s]. */
interface Want {
  eye: V3;
  aim: V3;
  up: V3;
  fov: number;
  tauEye: number;
  tauAim: number;
  /** a long lens's hand-held tremor (the tracking camera on its tripod, the fly-by's) */
  hand: number;
}

export class CineBrain {
  shot: Shot = "chase";
  /** the shot's age [s], its number (the director's cycle), the playlist's place */
  age = 0;
  n = 0;
  private phase: CinePhase | null = null;
  private slot = 0;
  /** a blend from the last frame's view (frozen about the craft), its age, its length [s] */
  private blend: { from: CineOut; t: number; len: number } | null = null;
  private eye = new Spring3();
  private aim = new Spring3();
  private up = new Spring3();
  private fovNow = Number.NaN;
  /** the fixed eye (the fly-by's, the tracking's: still in the world while the craft moves on) */
  private fixed: V3 | null = null;
  private last: CineOut | null = null;
  /** the asked shot last frame (a change: a blend) */
  private asked: Shot | "auto" | null = null;

  reset() {
    this.blend = null;
    this.fixed = null;
    this.last = null;
    this.phase = null;
    this.asked = null;
    this.age = 0;
    this.eye.reset();
    this.aim.reset();
    this.up.reset();
    this.fovNow = Number.NaN;
  }

  /** Cuts or blends to another shot. */
  /** the impulses (touchdowns, booms, latches) */
  readonly impulses = new Impulses();
  private clock = 0;
  private blendStyle: BlendStyle = "easeInOut";
  private blendTime = 1.6;
  /** A jolt (0 … 1). */
  impulse(k: number, decay = 0.5, freq = 9) {
    this.impulses.add(k, this.clock, decay, freq);
  }

  private go(shot: Shot, cut: boolean) {
    if (this.last && !cut && this.blendStyle !== "cut") this.blend = { from: this.last, t: 0, len: this.blendTime };
    else this.blend = null;
    this.shot = shot;
    this.age = 0;
    this.n++;
    this.fixed = null;
    if (cut) {
      this.eye.reset();
      this.aim.reset();
      this.up.reset();
      this.fovNow = Number.NaN;
    }
  }

  /** The next shot in the playlist (the player's "next shot": the director's next). */
  next(c: CineContext) {
    const list = PLAYLIST[phaseOf(c)];
    this.slot = (this.slot + 1) % list.length;
    const s = list[this.slot]!;
    this.go(s === this.shot ? list[(this.slot + 1) % list.length]! : s, true);
  }

  update(c: CineContext, a: CineAsk, dt: number): CineOut {
    this.clock += dt;
    if (a.blend) {
      this.blendStyle = a.blend.style;
      this.blendTime = Math.max(0.05, a.blend.time);
    }
    // ---- the director: which shot
    if (a.shot !== "auto") {
      if (this.asked !== a.shot || this.shot !== a.shot) this.go(a.shot, this.last === null);
    } else {
      const ph = phaseOf(c);
      if (ph !== this.phase) {
        // (a new phase: its opening shot — blended, unless from or to a still camera)
        this.phase = ph;
        this.slot = 0;
        const s = PLAYLIST[ph][0]!;
        if (s !== this.shot || this.last === null)
          this.go(s, this.last === null || s === "pass" || s === "tracking" || this.shot === "pass");
      } else if (this.age > holdFor(this.shot, this.n) || this.passedBy(c)) {
        const list = PLAYLIST[ph];
        this.slot = (this.slot + 1) % list.length;
        let s = list[this.slot]!;
        if (s === this.shot && s !== "pass" && s !== "tracking") s = list[(this.slot + 1) % list.length]!;
        // (the still cameras cut in and out, as a film's do; the moving ones blend)
        this.go(s, s === "pass" || s === "tracking" || this.shot === "pass" || this.shot === "tracking");
      }
    }
    this.asked = a.shot;
    this.age += dt;

    // ---- the shot's wants, damped
    const w = this.want(this.shot, c, a, dt);
    const eye = this.eye.step(w.eye, w.tauEye, dt);
    let aim = this.aim.step(w.aim, w.tauAim, dt);
    const up = unit3(this.up.step(w.up, 0.5, dt), w.up);
    // ---- the noise: the air's buffeting, the engine's rumble, the hand — an angle off the aim, wider lenses
    // shaking less to the eye's angle the same
    const air = 0.55 * smooth(2e3, 40e3, c.q) * (c.mach > 0.85 && c.mach < 1.2 ? 1.6 : 1);
    const engine = 0.3 * c.throttle * (c.inAir || c.launch ? 1 : 0.25) + (c.boost > 1 ? 0.25 : 0);
    const deg = a.shake * ((air + engine) * 0.6 + w.hand) * D2R;
    if (deg > 0) {
      const look = sub3(aim, eye);
      const d = len3(look);
      const f = unit3(look);
      const r = unit3(cross3(f, up), [1, 0, 0]);
      const u = cross3(r, f);
      const t = c.time;
      const fast = 9 + 6 * smooth(0, 1, air);
      const nx = fbm(t, fast, 1.3) + 0.4 * fbm(t, 0.35, 7.1) * (w.hand > 0 ? 1 : 0);
      const ny = fbm(t, fast, 4.9) + 0.4 * fbm(t, 0.3, 2.3) * (w.hand > 0 ? 1 : 0);
      aim = add3(add3(aim, r, Math.tan(deg * nx) * d), u, Math.tan(deg * ny) * d);
    }
    // ---- the profile's noise, the impulses, the dutch: turns about the eye
    const n = noiseAngles(a.noise ?? "none", c.time, a.noiseAmp ?? 1, a.noiseFreq ?? 1);
    const j = this.impulses.angles(this.clock, a.impulse ?? 1);
    const roll = ((a.dutch ?? 0) * Math.PI) / 180 + n[2] + j[2];
    let upOut = up;
    if (n[0] || n[1] || j[0] || j[1] || roll) {
      const look = sub3(aim, eye);
      const d = len3(look);
      const f = unit3(look);
      const r = unit3(cross3(f, up), [1, 0, 0]);
      const u = cross3(r, f);
      aim = add3(add3(aim, r, Math.tan(n[1] + j[1]) * d), u, Math.tan(n[0] + j[0]) * d);
      if (roll) upOut = add3(scale3(u, Math.cos(roll)), r, -Math.sin(roll));
    }
    // ---- the lens
    this.fovNow = Number.isFinite(this.fovNow) ? this.fovNow + (w.fov - this.fovNow) * (1 - Math.exp(-dt / 0.35)) : w.fov;
    let out: CineOut = { eye, aim, up: upOut, fov: this.fovNow, shot: this.shot };
    if (this.blend) {
      const B = this.blend;
      B.t += dt / B.len;
      const k = blendCurve(this.blendStyle, B.t);
      // (swung round the craft, the look slerped: never through the hull, never flipping)
      const p = blendPose(B.from, out, k, c.centre);
      out = { ...p, fov: B.from.fov + (out.fov - B.from.fov) * k, shot: out.shot };
      if (B.t >= 1) this.blend = null;
    }
    this.last = out;
    return out;
  }

  /** The fly-by's craft well past the camera: the director moves on (a held fly-by: planted again). */
  private passedBy(c: CineContext): boolean {
    if (this.shot !== "pass" || !this.fixed) return false;
    const v = len3(c.vel);
    if (v < 1) return false;
    const vh = scale3(c.vel, 1 / v);
    const D = clamp(v * 3.5, 60, 2500);
    return dot3(this.fixed, vh) < -0.9 * D || len3(this.fixed) > 1.8 * D;
  }

  private want(shot: Shot, c: CineContext, a: CineAsk, dt: number): Want {
    const speed = len3(c.vel);
    const vdir = speed > 5 ? scale3(c.vel, 1 / speed) : c.ax[2];
    const worldUp = c.up ?? c.ax[1];
    const shipUp = c.ax[1];
    const ctr = c.centre;
    const D = c.size * 0.9 * a.zoom;
    // (the lens widened with the speed through the air and the afterburner: up to a fifth)
    const kick = a.dynamicFov ? 1 + 0.14 * smooth(0.3, 1.3, c.mach) * (c.inAir ? 1 : 0) + (c.boost > 1 ? 0.07 : 0) : 1;
    // (a side away from the vertical: the chase's and the orbit's horizontal)
    let side = cross3(vdir, worldUp);
    if (len3(side) < 0.2) side = c.ax[0];
    side = unit3(side);
    switch (shot) {
      case "chase": {
        // behind along the way it goes, a little above; leading it; the horizon mostly level in the air
        const lift = c.inAir || c.landed ? worldUp : shipUp;
        return {
          eye: add3(add3(ctr, vdir, -D), lift, 0.24 * D),
          aim: add3(ctr, vdir, 0.35 * D),
          up: unit3(lerp3(worldUp, shipUp, c.inAir ? 0.35 : 1)),
          fov: a.fov * kick,
          tauEye: 0.32,
          tauAim: 0.1,
          hand: 0,
        };
      }
      case "orbit": {
        // a slow turn round the craft (45 s), a little above it
        const th = (2 * Math.PI * c.time) / 45;
        const h1 = unit3(tangent3(vdir, worldUp), c.ax[2]);
        const h2 = unit3(cross3(worldUp, h1), side);
        const R = 1.15 * D;
        return {
          eye: add3(add3(add3(ctr, h1, R * Math.cos(th)), h2, R * Math.sin(th)), worldUp, 0.32 * D),
          aim: ctr,
          up: worldUp,
          fov: a.fov,
          tauEye: 0.5,
          tauAim: 0.2,
          hand: 0,
        };
      }
      case "pass":
      case "tracking": {
        // a still camera in the world: the fly-by's ahead on the way, aside and above it; the tracking's on the
        // ground, a kilometre from where the climb began; its long lens holding the craft a third of the frame
        if (!this.fixed) this.fixed = this.plant(shot, c, vdir, side, worldUp);
        this.fixed = add3(this.fixed, c.vel, -dt);
        if (shot === "pass" && this.passedBy(c) && a.shot !== "auto") this.fixed = this.plant(shot, c, vdir, side, worldUp);
        const dist = len3(sub3(this.fixed, ctr));
        return {
          eye: this.fixed,
          aim: ctr,
          up: worldUp,
          fov: lensFor(c.size * 0.55, dist, shot === "tracking" ? 0.3 : 0.4, shot === "tracking" ? 0.6 : 2, a.fov * 1.1),
          tauEye: 0,
          tauAim: shot === "tracking" ? 0.12 : 0.06,
          hand: shot === "tracking" ? 0.12 : 0.05,
        };
      }
      case "planet": {
        // the world's limb behind the craft: the camera on the far side from it, above and behind, looking down
        // ~20° across the craft at the horizon
        const P = c.body?.dir ?? scale3(worldUp, -1);
        const s = unit3(tangent3(cross3(P, vdir), P), side);
        const back = unit3(tangent3(vdir, P), c.ax[2]);
        const R = 1.6 * D;
        return {
          eye: add3(add3(add3(ctr, P, -0.35 * R), s, 0.6 * R), back, -0.7 * R),
          aim: add3(ctr, P, -0.12 * R),
          up: scale3(P, -1),
          fov: a.fov * 0.9,
          tauEye: 0.6,
          tauAim: 0.3,
          hand: 0,
        };
      }
      case "system": {
        // the destination (the target, else the Sun) behind the craft: a longer lens, the craft in the near third
        const T = c.target ?? c.sun ?? vdir;
        let perp = cross3(T, shipUp);
        if (len3(perp) < 0.2) perp = c.ax[0];
        perp = unit3(perp);
        const u = unit3(cross3(perp, T), shipUp);
        return {
          eye: add3(add3(add3(ctr, T, -1.7 * D), perp, 0.38 * D), u, 0.22 * D),
          aim: add3(ctr, T, 0.6 * D),
          up: u,
          fov: a.fov * 0.7,
          tauEye: 0.8,
          tauAim: 0.4,
          hand: 0,
        };
      }
    }
  }

  /** Where a still camera stands for the fly-by or the tracking shot (about the craft, local metres). */
  private plant(shot: Shot, c: CineContext, vdir: V3, side: V3, worldUp: V3): V3 {
    const speed = len3(c.vel);
    if (shot === "tracking") {
      // on the ground (2 m up), 900 m to the side and 400 m back of where the climb is (a launch's long lens)
      const back = unit3(tangent3(vdir, worldUp), c.ax[2]);
      const down = Number.isFinite(c.agl) ? Math.max(c.agl - 2, 0) : 0;
      return add3(add3(add3(c.centre, worldUp, -down), side, 900), back, -400);
    }
    const D = clamp(speed * 3.5, 60, 2500);
    return add3(add3(add3(c.centre, vdir, D), side, 0.15 * D + 15), worldUp, 0.05 * D + 5);
  }
}
