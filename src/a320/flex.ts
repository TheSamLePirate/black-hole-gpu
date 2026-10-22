// The A320's wings bending under their load (docs/PLAN-A320.md, A13): the tip's rise [m] from the lift the wings carry
// over the weight — drooping some 15 cm at rest on the ground (their own weight and the fuel's), as built in level
// flight (the model's shape), some 60 cm higher per g more —, followed as a wing does, a spring of its own (its first
// bending mode, ≈ 1.3 Hz, lightly damped: the touchdown's thump, a gust, ring it a few times), the air's turbulence
// shaking it a little more. The shader bends each vertex outboard of the fuselage by it (ship.wgsl a320Flex: the
// span's square). Pure but for the dice.

/** the tip's droop at rest on the ground [m], its rise per g above level flight [m] */
export const DROOP = 0.15;
export const PER_G = 0.6;
/** the wing's first bending mode [Hz] and its damping ratio */
const MODE_HZ = 1.3;
const ZETA = 0.12;

/** The tip's rise wanted [m] for the lift over the weight (1: level flight; 0: on the ground at rest). */
export function tipFor(liftOverWeight: number): number {
  const l = Math.min(Math.max(liftOverWeight, -1.5), 3.5);
  return l < 1 ? -DROOP * (1 - l) : PER_G * (l - 1);
}

/** The bend at a span station [m from the centreline, ship x]: none on the fuselage (|x| < 2 m), the tip's rise ×
 *  the square of the way out to the tip (17 m) — the shader's own (ship.wgsl a320Flex). */
export function bendAt(x: number, tip: number): number {
  const u = Math.min(Math.max((Math.abs(x) - 2) / 15, 0), 1.05);
  return tip * u * u;
}

export class WingFlex {
  /** the tip's rise now [m] and its rate [m/s] */
  tip = 0;
  private v = 0;
  private gust = 0;
  private started = false;

  constructor(private rand: () => number = Math.random) {}

  /** A frame [s]: the lift over the weight, the turbulence's strength [m/s] (the weather's: 0 calm). */
  step(dt: number, liftOverWeight: number, turb = 0): number {
    const want = tipFor(liftOverWeight);
    if (!this.started || !Number.isFinite(this.tip)) {
      this.started = true;
      this.tip = want;
      this.v = 0;
      return this.tip;
    }
    if (dt <= 0) return this.tip;
    // (the turbulence: a slow random push, its tip a few centimetres per m/s of it)
    this.gust += ((this.rand() * 2 - 1) * 0.03 * turb - this.gust) * Math.min(dt * 2, 1);
    const w = 2 * Math.PI * MODE_HZ;
    // (a spring and its damper, in small steps: stable at any frame rate)
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    for (let k = 0; k < n; k++) {
      const a = w * w * (want + this.gust - this.tip) - 2 * ZETA * w * this.v;
      this.v += a * h;
      this.tip += this.v * h;
    }
    return this.tip;
  }
}
