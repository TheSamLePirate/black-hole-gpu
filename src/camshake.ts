// The camera shaken by the flight (docs/PLAN-F35.md, F7): what a pilot's head and a chase camera feel — the
// runway's roughness under the wheels (its beat with the speed), the buffet as the wing nears its stall, the
// transonic buffet through Mach 1, the afterburner's rumble, a touchdown's jolt. Small turns of the view, each a
// band of noise at its own pace; the setting scales them all. Pure.

/** What shakes it this frame (0 … 1 each, but the speeds [m/s] and the jolt [m/s of sink at the touchdown]). */
export interface ShakeInput {
  dt: number;
  /** on its wheels: the speed over the ground [m/s] (0: in the air or at rest) */
  roll: number;
  /** the buffet: how near the angle of attack is to the craft's limit (0 … 1) */
  buffet: number;
  /** through the transonic band (0 … 1) */
  transonic: number;
  /** the afterburner lit, the engine's power (0 … 1) */
  ab: number;
  engine: number;
  /** a touchdown this frame: its sink [m/s] (0: none) */
  jolt: number;
  /** a spacecraft's (PLAN-VAISSEAUX X7): its rocket's thrust felt through the frame (0 … 1, heavier for a
   *  heavier craft), the re-entry's plasma (0 … 1), the Endurance's ring turning up or down (0 … 1) */
  rocket?: number;
  plasma?: number;
  ring?: number;
  /** an airliner's (the A320's — PLAN-A320 A13): the runway's concrete slabs' joints thumped through the nose gear
   *  (their spacing [m]; none: a fighter's smooth roll), the speed brakes' buffet (0 … 1), the air's turbulence (0 … 1),
   *  its roughness felt softer (× the runway's — a heavier, softer-sprung craft) */
  joints?: number;
  brakes?: number;
  turb?: number;
  soft?: number;
}

/** The view's turn this frame [rad]: about its up (yaw), its right (pitch), its axis (roll). */
export interface Shake {
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * How much of a shake at `f` [Hz] the frames can show at `fps`: all of it up to 0.3 × the frame rate, none from 0.45 × (the
 * Nyquist's 0.5, a margin). Past it a sine sampled by the frames folds back to a slower, erratic one: the engine's 31 Hz hum
 * at 25 frames a second shown as a 6 Hz shiver — what reads as a tremble, not a vibration (docs/progress/JITTER-VOL.md).
 */
export function shownAt(f: number, fps: number) {
  const x = (0.45 * fps - f) / (0.15 * fps);
  const k = Math.min(Math.max(x, 0), 1);
  return k * k * (3 - 2 * k);
}

/** A smooth band of noise in time: a few sines of incommensurate frequencies about `f` [Hz], those the frames cannot show left out. */
function bandAt(t: number, f: number, seed: number, fps = Infinity) {
  return (
    0.5 * shownAt(f, fps) * Math.sin(2 * Math.PI * f * t + seed) +
    0.3 * shownAt(f * 1.73, fps) * Math.sin(2 * Math.PI * f * 1.73 * t + 2.1 * seed) +
    0.2 * shownAt(f * 2.91, fps) * Math.sin(2 * Math.PI * f * 2.91 * t + 3.7 * seed)
  );
}

export class CamShake {
  private t = 0;
  /** the touchdown's jolt, decaying */
  private j = 0;
  /** an airliner's: the way across the current slab (0 … 1), the last joint's thump, decaying */
  private slab = 0;
  private thump = 0;
  /** eased levels (the buffet does not switch on in a frame) */
  private lv = { buffet: 0, transonic: 0, ab: 0 };

  /** the frame rate the shake is shown at, eased (its bands kept under its Nyquist) */
  private fps = 60;

  step(i: ShakeInput, gain = 1): Shake {
    const dt = Math.min(Math.max(i.dt, 0), 0.1);
    this.t += dt;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;
    const t = this.t;
    const fps = this.fps;
    const band = (tt: number, f: number, seed: number) => bandAt(tt, f, seed, fps);
    const ease = (k: keyof CamShake["lv"], v: number, tau: number) => (this.lv[k] += (v - this.lv[k]) * Math.min(1, dt / tau));
    const bf = ease("buffet", i.buffet, 0.25),
      tr = ease("transonic", i.transonic, 0.3),
      ab = ease("ab", i.ab, 0.4);
    if (i.jolt > 0.3) this.j = Math.max(this.j, Math.min(i.jolt / 3, 1.5));
    this.j *= Math.exp(-dt / 0.18);
    // (the runway: its roughness's pace with the speed — 3 Hz at 10 m/s to 14 Hz at 80 —, its size too)
    const rv = Math.min(i.roll / 80, 1.2) * (i.soft ?? 1);
    const rollF = 3 + 11 * Math.min(rv, 1);
    let pitch =
      0.0028 * rv * band(t, rollF, 1.3) + 0.004 * bf * band(t, 7, 4.1) + 0.0022 * tr * band(t, 13, 2.2) + 0.0008 * ab * band(t, 24, 5.5);
    const yaw =
      0.0018 * rv * band(t, rollF * 0.8, 0.7) +
      0.0025 * bf * band(t, 5.3, 1.9) +
      0.0012 * tr * band(t, 11, 3.3) +
      0.0005 * ab * band(t, 21, 6.1);
    let roll = 0.002 * rv * band(t, rollF * 0.6, 2.9) + 0.006 * bf * band(t, 4.1, 0.4) + 0.0015 * tr * band(t, 9, 7.7);
    // (the touchdown: the head pressed down, then a ringing)
    pitch -= 0.022 * this.j * (0.6 + 0.4 * band(t, 9, 8.8));
    roll += 0.006 * this.j * band(t, 6, 3.1);
    // (an airliner's: the slabs' joints — a thump each one the nose wheel crosses, its pace the speed over their
    // spacing —, the speed brakes' buffet, the turbulence's slow lurches)
    if (i.joints && i.roll > 1) {
      this.slab += (i.roll * dt) / i.joints;
      if (this.slab >= 1) {
        this.slab -= Math.floor(this.slab);
        this.thump = Math.min(0.25 + i.roll / 60, 1);
      }
    }
    this.thump *= Math.exp(-dt / 0.06);
    pitch -= 0.0035 * this.thump;
    const sb = i.brakes ?? 0,
      tb = i.turb ?? 0;
    pitch += 0.0018 * sb * band(t, 8.5, 5.1) + 0.004 * tb * band(t, 1.3, 2.4);
    roll += 0.0012 * sb * band(t, 6.2, 1.7) + 0.006 * tb * band(t, 0.9, 6.3);
    // (the engine's own hum through the seat, always a little)
    pitch += 0.00015 * i.engine * band(t, 31, 9.2);
    // (a rocket's roar through the frame, the re-entry's buffeting, the ring's slow groan — X7)
    const rk = i.rocket ?? 0,
      pl = i.plasma ?? 0,
      rg = i.ring ?? 0;
    pitch += 0.0016 * rk * band(t, 17, 6.6) + 0.005 * pl * band(t, 5.7, 1.1);
    roll += 0.0012 * rk * band(t, 13, 4.4) + 0.0035 * pl * band(t, 3.9, 2.6) + 0.004 * rg * band(t, 0.7, 5.2);
    const k = Math.max(gain, 0);
    return { yaw: yaw * k, pitch: pitch * k, roll: roll * k };
  }
}
