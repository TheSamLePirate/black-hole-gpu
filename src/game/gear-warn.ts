// The gear's alarm — « GEAR UP · TOO LOW », « Too low, gear! » —: the GPWS's mode 4A (Honeywell's, simplified — the A320's own
// voice, a320/sound/callouts.ts, has the same): in the air with the gear up, under 500 ft over the ground (152 m) and 190 kt (98 m/s),
// coming down — and never in the take-off's climb, from the lift-off to 1 500 ft (457 m) over the ground. Before 16 Nov 2026 every
// aeroplane under 300 m and 150 m/s with its gear up was warned whatever it did: the F-35 at 34 m climbing out of Toulon-Hyères after
// its automatic take-off, and cruising level 275 m over the hills at 140 m/s (the render session's parcours-*). Pure: a frame's state in,
// the alarm out; its one memory, the climb's top since the wheels left the ground.

export const GEAR_WARN = {
  /** under this height over the ground [m] (500 ft) */
  agl: 152,
  /** under this airspeed [m/s] (190 kt) */
  speed: 98,
  /** the take-off's climb: from the lift-off up to this height over the ground [m] (1 500 ft), no alarm */
  climbOut: 457,
} as const;

export interface GearWarnIn {
  /** in the air (not on the wheels) */
  inAir: boolean;
  /** the gear down (its lever) */
  gearDown: boolean;
  /** the height over the ground [m] */
  agl: number;
  /** the airspeed [m/s] */
  speed: number;
  /** the vertical speed [m/s, up > 0] */
  vs: number;
}

export class GearWarn {
  /** the highest point over the ground since the wheels left it [m] */
  private climbMax = 0;
  /** in the take-off's climb (since a lift-off, below 1 500 ft, the gear up) */
  private climbing = false;
  /** on the wheels at the last frame */
  private wasOnGround = false;

  /** The frame's alarm. */
  step(i: GearWarnIn): boolean {
    if (!i.inAir) {
      this.wasOnGround = true;
      return false;
    }
    if (this.wasOnGround) {
      // (off the wheels: a lift-off — low over the ground —, or a placing in the air from the ground — no climb then)
      this.wasOnGround = false;
      this.climbing = i.agl < 30;
      this.climbMax = 0;
    }
    if (this.climbing) {
      this.climbMax = Math.max(this.climbMax, i.agl);
      // (the climb's end: 1 500 ft reached, or the gear lowered — a circuit flown back to land)
      if (this.climbMax >= GEAR_WARN.climbOut || i.gearDown) this.climbing = false;
    }
    if (this.climbing) return false;
    return !i.gearDown && i.agl < GEAR_WARN.agl && i.speed < GEAR_WARN.speed && i.vs < 0;
  }
}
