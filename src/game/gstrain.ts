// The load at the pilot's eyes (docs/PLAN-F35.md, F7; docs/PLAN-AVIATION-AAA.md, V5): the blood's pressure there
// lags the load — the heart and the anti-g suit catch up in seconds (faster as the load eases) —, so a brief pull is
// borne where a held one greys the view, then narrows it to a tunnel and blacks it out; held long, the pilot tires
// (the straining manoeuvre wears him down: his tolerance falls a little, back as he rests); past the black-out held,
// he loses consciousness (G-LOC) — some eight seconds out, four more coming to. Under a negative load the blood rushes
// to the head: a red-out. With the F-35's suit and a trained pilot's straining: grey from 5.5 g felt, black by 9.5.
// Pure.

const clamp = (x: number, a = 0, b = 1) => Math.min(Math.max(x, a), b);

export class GStrain {
  /** the load felt at the eyes [g] (signed: negative pushes the blood up) */
  felt = 1;
  /** the tiredness [g of tolerance lost], 0…1.2 */
  fatigue = 0;
  /** unconscious [s left], coming to [s left] */
  out = 0;
  waking = 0;
  /** how long the black-out has been held [s] */
  private dark = 0;

  /** A new flight: rested, conscious. */
  reset() {
    this.felt = 1;
    this.fatigue = 0;
    this.out = this.waking = this.dark = 0;
  }

  step(nz: number, dt: number) {
    if (!Number.isFinite(nz) || !(dt > 0)) return this;
    const d = Math.min(dt, 0.2);
    const tau = nz > this.felt ? 2.4 : 0.9;
    this.felt += (nz - this.felt) * Math.min(1, d / tau);
    // (tired by the load held past 5 g — the straining's work —, rested under 3)
    this.fatigue = clamp(this.fatigue + (this.felt > 5 ? 0.03 * (this.felt - 5) : this.felt < 3 ? -0.02 : 0) * d, 0, 1.2);
    if (this.out > 0) {
      this.out -= d;
      if (this.out <= 0) this.waking = 4;
    } else if (this.waking > 0) this.waking = Math.max(0, this.waking - d);
    // (the load's own black-out held a second and a half — not the coming to's —: out)
    this.dark = this.out <= 0 && this.waking <= 0 && this.loadBlack >= 1 ? this.dark + d : 0;
    if (this.dark > 1.5 && this.out <= 0) {
      this.out = 8;
      this.dark = 0;
    }
    return this;
  }

  /** the grey-out 0…1: the colours washed out, the edges dim */
  get grey() {
    return clamp((this.felt - (5.5 - this.fatigue)) / 4);
  }
  /** the black-out the load makes 0…1 */
  private get loadBlack() {
    return clamp((this.felt - (8.4 - this.fatigue)) / 1.1);
  }
  /** the black-out 0…1: the field narrowed to a tunnel, then gone (out: all; coming to: clearing) */
  get black() {
    return this.out > 0 ? 1 : Math.max(this.waking / 4, this.loadBlack);
  }
  /** the red-out 0…1 */
  get red() {
    return clamp((-this.felt - 1.5) / 2);
  }
  /** the straining (the anti-g manoeuvre: its breathing, its grunts) 0…1 */
  get strain() {
    return clamp((this.felt - 4.5) / 3.5);
  }
  /** unconscious: the controls let go */
  get gloc() {
    return this.out > 0;
  }
}
