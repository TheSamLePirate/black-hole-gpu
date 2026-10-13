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
}

/** The view's turn this frame [rad]: about its up (yaw), its right (pitch), its axis (roll). */
export interface Shake {
  yaw: number;
  pitch: number;
  roll: number;
}

/** A smooth band of noise in time: a few sines of incommensurate frequencies about `f` [Hz]. */
function band(t: number, f: number, seed: number) {
  return (
    0.5 * Math.sin(2 * Math.PI * f * t + seed) +
    0.3 * Math.sin(2 * Math.PI * f * 1.73 * t + 2.1 * seed) +
    0.2 * Math.sin(2 * Math.PI * f * 2.91 * t + 3.7 * seed)
  );
}

export class CamShake {
  private t = 0;
  /** the touchdown's jolt, decaying */
  private j = 0;
  /** eased levels (the buffet does not switch on in a frame) */
  private lv = { buffet: 0, transonic: 0, ab: 0 };

  step(i: ShakeInput, gain = 1): Shake {
    const dt = Math.min(Math.max(i.dt, 0), 0.1);
    this.t += dt;
    const t = this.t;
    const ease = (k: keyof CamShake["lv"], v: number, tau: number) => (this.lv[k] += (v - this.lv[k]) * Math.min(1, dt / tau));
    const bf = ease("buffet", i.buffet, 0.25),
      tr = ease("transonic", i.transonic, 0.3),
      ab = ease("ab", i.ab, 0.4);
    if (i.jolt > 0.3) this.j = Math.max(this.j, Math.min(i.jolt / 3, 1.5));
    this.j *= Math.exp(-dt / 0.18);
    // (the runway: its roughness's pace with the speed — 3 Hz at 10 m/s to 14 Hz at 80 —, its size too)
    const rv = Math.min(i.roll / 80, 1.2);
    const rollF = 3 + 11 * Math.min(rv, 1);
    let pitch = 0.0028 * rv * band(t, rollF, 1.3) + 0.004 * bf * band(t, 7, 4.1) + 0.0022 * tr * band(t, 13, 2.2) + 0.0008 * ab * band(t, 24, 5.5);
    let yaw = 0.0018 * rv * band(t, rollF * 0.8, 0.7) + 0.0025 * bf * band(t, 5.3, 1.9) + 0.0012 * tr * band(t, 11, 3.3) + 0.0005 * ab * band(t, 21, 6.1);
    let roll = 0.002 * rv * band(t, rollF * 0.6, 2.9) + 0.006 * bf * band(t, 4.1, 0.4) + 0.0015 * tr * band(t, 9, 7.7);
    // (the touchdown: the head pressed down, then a ringing)
    pitch -= 0.022 * this.j * (0.6 + 0.4 * band(t, 9, 8.8));
    roll += 0.006 * this.j * band(t, 6, 3.1);
    // (the engine's own hum through the seat, always a little)
    pitch += 0.00015 * i.engine * band(t, 31, 9.2);
    const k = Math.max(gain, 0);
    return { yaw: yaw * k, pitch: pitch * k, roll: roll * k };
  }
}
