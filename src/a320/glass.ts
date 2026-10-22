// The A320's windshield from the flight deck (docs/PLAN-A320.md, A13): its wipers — FlightGear's (Systems/a320-fcs.xml
// channel "Wipers": a stroke out and back at the knob's speed, LO 3.167 and HI 4.667 of its travel a second, on DC 1;
// turned OFF, the arm finishes its stroke back to rest), the time since an arm last passed a point of its sweep (the
// glass there wiped, wet again with the rain — ship.wgsl a320Wet, which mirrors it), and the frost on the glass (in
// icing conditions, cleared by the window heat over a minute). Pure.

/** the arms' sweep (the exterior's rig: WindshildWiperL/R, ∓56° about their pivots), their blades' reach [m] */
export const WIPER_SWEEP_DEG = 56;
export const WIPER_REACH: [number, number] = [0.18, 0.86];

/** FlightGear's speeds [travel / s] by the knob (0 OFF, 1 LO, 2 HI) */
const SPEED = [0, 3.167, 4.667];

/** One wiper: FlightGear's channel — its command (out until it has been to the end, then back), its "has been to 1"
 *  latch, its speed (kept while it returns to rest after OFF), its rate-limited actuator. */
export class Wiper {
  pos = 0;
  /** its speed now [travel / s], signed by the stroke (out > 0) */
  rate = 0;
  /** the time it has been at rest [s] (its sweep last wiped then) */
  restFor = 1e4;
  private hasBeen1 = false;
  private speed = 0;

  step(knob: number, powered: boolean, dt: number): number {
    // (has-been-1: set at the stroke's end, cleared back at rest)
    if (this.pos <= 0.001) this.hasBeen1 = false;
    else if (this.pos >= 0.999) this.hasBeen1 = true;
    // (the command: out while not yet at the end and the knob on; back once there)
    const cmd = this.pos > 0.001 && this.hasBeen1 ? 0 : !this.hasBeen1 && knob !== 0 ? 1 : 0;
    // (the speed: the knob's; OFF mid-stroke, the last one kept to rest; no power, none)
    if (!powered) this.speed = 0;
    else if (knob === 1 || knob === 2) this.speed = SPEED[knob]!;
    else if (this.pos < 0.001) this.speed = 0;
    const d = cmd - this.pos;
    const step = Math.min(Math.abs(d), this.speed * dt);
    const was = this.pos;
    this.pos += Math.sign(d) * step;
    // (back within FlightGear's rest band: at rest)
    if (cmd === 0 && this.pos < 0.001) this.pos = 0;
    this.rate = dt > 0 ? (this.pos - was) / dt : 0;
    this.restFor = Math.abs(this.rate) > 1e-3 ? 0 : this.restFor + dt;
    return this.pos;
  }

  /** its motion for the glass's shader (ship.wgsl a320Wet): its rate when it moves, else 100 + its time at rest [s] */
  get shaderRate(): number {
    return Math.abs(this.rate) > 1e-3 ? this.rate : 100 + Math.min(this.restFor, 1e4);
  }
}

/** The time [s] since an arm at `pos`, moving at `rate` [travel / s, out > 0; 100 + its time at rest when parked — the
 *  shader's encoding, Wiper.shaderRate —; 0: never moved], last passed the point `s` of its sweep (0 rest … 1 the end) —
 *  on this stroke, else on the one before. */
export function sinceWiped(s: number, pos: number, rate: number): number {
  // (at rest: its last stroke back — LO's speed — ended `rate − 100` s ago)
  if (rate >= 100) return rate - 100 + s / 3.167;
  const r = Math.abs(rate);
  if (r < 1e-3) return Number.POSITIVE_INFINITY;
  if (rate > 0) return s <= pos ? (pos - s) / r : (s + pos) / r;
  return s >= pos ? (s - pos) / r : (2 - s - pos) / r;
}

/** How wet the glass is a time after a wipe [0 dry … 1 as wet as unwiped]: the rain's drops landing again — within a
 *  second in a downpour, some seconds in a drizzle. */
export function wetAfter(t: number, rain: number): number {
  if (!Number.isFinite(t)) return 1;
  return 1 - Math.exp(-t * (0.25 + 2.2 * Math.max(rain, 0)));
}

/** The frost on the windshield [0 … 1]: rime in icing conditions (below 0 °C in cloud or rain: fast; on the ground in a
 *  cold night, hoar slowly); the window heat clears it in about a minute, the warm air (above +3 °C) slowly. */
export class Frost {
  ice = 0;

  step(o: { oatC: number; wet: number; heat: boolean; onGround: boolean }, dt: number): number {
    let rate = 0;
    if (o.heat) rate = -1 / 60;
    else if (o.oatC < 0 && o.wet > 0.05) rate = (Math.min(-o.oatC, 10) / 10) * (0.2 + o.wet) * (1 / 40);
    else if (o.oatC < -2 && o.onGround) rate = 1 / 900;
    else if (o.oatC > 3) rate = -1 / 300;
    this.ice = Math.min(Math.max(this.ice + rate * dt, 0), 1);
    return this.ice;
  }
}
