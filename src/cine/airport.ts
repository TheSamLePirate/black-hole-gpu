// The airport's director (docs/PLAN-AEROPORT-AAA.md V1, V7): each airliner landing on a runway or taking off from it filmed
// as a broadcast would — from the tower with a long lens, from under the approach where it passes overhead (a spotter at the
// threshold), from the runway's side at the touchdown zone, behind it, aboard it, a drone's slow crane about it; a take-off
// from the runway's side where it rotates and from under its climb-out past the far end —, and the "Auto" director cutting
// between them by its phase (an arrival's far final, final, short final, touchdown, rollout; a departure's line-up, roll,
// rotation, climb-out, climb), each shot held three seconds at least. The ground cameras all on one side of the runway (the 180° rule); the lens on a spring
// framing the aircraft, the aim a camera operator's (a fifth of a second behind), the hand-held ones' tremor.
// Pure: the runway's way and the aircraft (metres fixed to the Earth) in, the eye, the aim, the up and the field out.

import { add3, cross3, damp, dot3, fbm, len3, scale3, Spring3, sub3, unit3, type V3 } from "./rig";

export type AirportShot = "tower" | "threshold" | "touchdown" | "rotation" | "climbout" | "chase" | "cockpit" | "drone";
export const AIRPORT_SHOTS: AirportShot[] = ["tower", "threshold", "touchdown", "rotation", "climbout", "chase", "cockpit", "drone"];
export type AirportMode = "auto" | AirportShot;
export const AIRPORT_MODES: AirportMode[] = ["auto", ...AIRPORT_SHOTS];

/** A runway as landed on: its threshold [m, fixed to the Earth], its direction, its right, the local up, its length. */
export interface RunwayWay {
  o: V3;
  d: V3;
  r: V3;
  up: V3;
  len: number;
  /** its name (27R), its airfield's code */
  name: string;
}

/** The aircraft filmed: its place, velocity, axes (nose, up, right — unit), size [m], on the ground, its height over its
 *  wheels' rest [m], the seconds to its touchdown (< 0: since it) — a departure's (`dep`) to its lift-off. */
export interface Lander {
  p: V3;
  v: V3;
  fwd: V3;
  up: V3;
  right: V3;
  len: number;
  gnd: boolean;
  over: number;
  eta: number;
  /** a departure: `eta` the seconds to its lift-off */
  dep?: boolean;
  /** followed freely (one chosen, in no movement): behind it and about it, by turns */
  free?: boolean;
}

/** A frame's shot: the eye and the aim [m, fixed to the Earth], the up, the vertical field [deg], a cut this frame,
 *  the shot. */
export interface AirportView {
  eye: V3;
  aim: V3;
  up: V3;
  fov: number;
  cut: boolean;
  shot: AirportShot;
  /** the eye's velocity over the ground [m/s] (fixed: 0; aboard, behind it: the aircraft's) */
  vel: V3;
}

/** Where on the runway [m]: along it from its threshold, across it (+ its right), over the ground. */
export type Place = (a: number, c: number, h: number) => V3;

export const DIRECTOR = {
  /** a shot held this long at least [s] (Auto) */
  hold: 3,
  /** Auto's phases by the seconds to touchdown: the tower beyond, the chase down to, the threshold down to, the
   *  touchdown zone until this long after the mains touch [s] */
  far: 40,
  final: 18,
  short: 6,
  after: 8,
  /** the ground cameras: the tower's place (along, across [m], height), the spotter's under the approach, the
   *  touchdown zone's */
  tower: [0.45, 520, 42] as const,
  threshold: [-380, 55, 1.7] as const,
  touchdown: [650, 115, 1.7] as const,
  /** a departure's: the runway's side where it rotates (along [m], at most this share of the runway), under its climb-out past
   *  the far end (along past it [m]) */
  rotation: [1500, 0.5, 120, 1.7] as const,
  climbout: [700, 70, 1.7] as const,
  /** a departure's Auto by the seconds to its lift-off: the tower before, the rotation's side down to, under the climb-out
   *  until this long after it, then behind it */
  roll: 14,
  airborne: 4,
  climbed: 26,
  /** the aircraft's share of the frame's height … width (the lens framing it), the operator's lag [s], the lens's [s] */
  frame: 0.42,
  lag: 0.18,
  lens: 0.7,
} as const;

const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const DEG = 180 / Math.PI;

/** The field [deg] that frames something this long [m] at this distance [m] to this share of it, within limits. */
export function framing(size: number, dist: number, share: number, lo: number, hi: number): number {
  return clamp(2 * Math.atan(size / share / 2 / Math.max(dist, 1)) * DEG, lo, hi);
}

/** Auto's shot for the aircraft's phase (the seconds to its touchdown — a departure's to its lift-off —, on the ground). */
export function autoShot(L: Lander, t = 0): AirportShot {
  // (one chosen, in no movement: behind it, then the drone about it, by turns of 12 s)
  if (L.free) return Math.floor(t / 12) % 2 ? "drone" : "chase";
  if (L.dep) {
    if (L.eta > DIRECTOR.roll) return "tower";
    if (L.eta > -DIRECTOR.airborne) return "rotation";
    if (L.eta > -DIRECTOR.climbed) return "climbout";
    return "chase";
  }
  if (L.gnd) return L.eta > -DIRECTOR.after ? "touchdown" : "chase";
  if (L.eta > DIRECTOR.far) return "tower";
  if (L.eta > DIRECTOR.final) return "chase";
  if (L.eta > DIRECTOR.short) return "threshold";
  return "touchdown";
}

export class AirportDirector {
  mode: AirportMode = "auto";
  shot: AirportShot = "tower";
  /** the ground cameras' side of the runway: +1 its right, −1 its left */
  side = 1;
  private since = 1e9;
  private t = 0;
  private fov = 30;
  private aim = new Spring3();
  private chase = new Spring3();
  private subject = "";

  /** A new aircraft: the next shot a cut. */
  follow(id: string) {
    if (id !== this.subject) {
      this.subject = id;
      this.since = 1e9;
      this.aim.reset();
      this.chase.reset();
    }
  }

  /**
   * A frame: `dt` [s], the runway's way, `place` its ground's points, the aircraft (null: none to film — the tower's
   * view down the approach, waiting).
   */
  step(dt: number, W: RunwayWay, place: Place, L: Lander | null): AirportView {
    this.t += dt;
    this.since += dt;
    const D = DIRECTOR;
    const want: AirportShot = !L ? "tower" : this.mode === "auto" ? autoShot(L, this.t) : this.mode;
    let cut = false;
    if (want !== this.shot && (this.mode !== "auto" || this.since >= D.hold)) {
      this.shot = want;
      cut = true;
    }
    if (this.since > 1e8) cut = true;
    if (cut) {
      this.since = 0;
      this.aim.reset();
      this.chase.reset();
    }
    const s = this.side;
    const zero: V3 = [0, 0, 0];
    let eye: V3,
      target: V3,
      fov: number,
      vel: V3 = zero,
      up = W.up,
      tau: number = D.lag,
      hand = 0;
    if (!L) {
      // (none landing: the tower looking down the approach, a wide view)
      eye = place(W.len * D.tower[0], s * D.tower[1], D.tower[2]);
      target = place(-3000, 0, 150);
      fov = 28;
      tau = 0.6;
    } else {
      const centre = add3(L.p, L.up, 0.15 * L.len);
      const dir = unit3(len3(L.v) > 5 ? L.v : L.fwd);
      switch (this.shot) {
        case "tower": {
          eye = place(W.len * D.tower[0], s * D.tower[1], D.tower[2]);
          target = centre;
          fov = framing(L.len, len3(sub3(centre, eye)), D.frame, 1.2, 45);
          break;
        }
        case "threshold": {
          // (the spotter under the approach: it passes overhead, the lens widening as it comes)
          eye = place(D.threshold[0], s * D.threshold[1], D.threshold[2]);
          target = centre;
          fov = framing(L.len, len3(sub3(centre, eye)), 0.55, 4, 78);
          hand = 0.12;
          tau = 0.12;
          break;
        }
        case "touchdown": {
          eye = place(D.touchdown[0], s * D.touchdown[1], D.touchdown[2]);
          target = add3(L.p, L.fwd, 0.1 * L.len);
          fov = framing(L.len, len3(sub3(target, eye)), 0.6, 5, 55);
          hand = 0.08;
          break;
        }
        case "rotation": {
          // (a departure: the runway's side where it rotates, the lens on its nose as it lifts)
          eye = place(Math.min(D.rotation[0], W.len * D.rotation[1]), s * D.rotation[2], D.rotation[3]);
          target = add3(L.p, L.fwd, 0.1 * L.len);
          fov = framing(L.len, len3(sub3(target, eye)), 0.6, 5, 55);
          hand = 0.08;
          break;
        }
        case "climbout": {
          // (under its climb-out past the far end: it comes up the runway, passes overhead, the lens widening as it comes)
          eye = place(W.len + D.climbout[0], s * D.climbout[1], D.climbout[2]);
          target = centre;
          fov = framing(L.len, len3(sub3(centre, eye)), 0.55, 4, 78);
          hand = 0.12;
          tau = 0.12;
          break;
        }
        case "chase": {
          // (behind it and a little above, on the ground cameras' side; its turns followed with a lag)
          const back = add3(add3(scale3(dir, -2.6 * L.len), W.up, 0.32 * L.len), L.right, s * 0.55 * L.len);
          const off = this.chase.step(back, 0.5, dt);
          eye = add3(L.p, off);
          target = add3(L.p, L.fwd, 0.35 * L.len);
          fov = 42;
          vel = L.v;
          tau = 0.05;
          break;
        }
        case "cockpit": {
          eye = add3(add3(L.p, L.fwd, 0.42 * L.len), L.up, 0.04 * L.len + 0.6);
          target = add3(add3(eye, L.fwd, 200), L.up, -6);
          up = L.up;
          fov = 62;
          vel = L.v;
          tau = 0;
          break;
        }
        default: {
          // (the drone: a slow crane about it, rising, a third of a turn a minute)
          const a = 0.6 + this.since * 0.035;
          const h = cross3(W.up, dir);
          const ring = add3(scale3(dir, Math.cos(a) * 3.4 * L.len), h, Math.sin(a) * 3.4 * L.len);
          eye = add3(add3(L.p, ring), W.up, (0.45 + 0.01 * this.since) * L.len);
          target = L.p;
          fov = 40;
          vel = L.v;
          tau = 0.08;
        }
      }
    }
    // (the operator's aim: behind the aircraft by a fraction of a second — none aboard; the hand's tremor)
    let aim = tau > 0 ? this.aim.step(target, tau, dt) : target;
    if (hand > 0) {
      const dist = len3(sub3(aim, eye));
      const side = unit3(cross3(sub3(aim, eye), W.up));
      aim = add3(add3(aim, side, (fbm(this.t, 0.7, 3) * hand * dist) / 57.3), W.up, (fbm(this.t, 0.6, 9) * hand * dist) / 57.3);
    }
    this.fov = cut ? fov : damp(this.fov, fov, D.lens, dt);
    // (its up: the world's, kept square to the look)
    const f = unit3(sub3(aim, eye));
    const u = unit3(sub3(up, scale3(f, dot3(up, f))), W.up);
    return { eye, aim, up: u, fov: this.fov, cut, shot: this.shot, vel };
  }
}
