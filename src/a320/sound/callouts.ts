// The A320's automatic callouts (docs/PLAN-A320.md, A12): the radio altitudes going down (2500 — "twenty five hundred"
// —, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10, 5), "RETARD" at 20 ft with the levers still forward (10 ft with
// the autopilot's land), "HUNDRED ABOVE" and "MINIMUM" at the minima the MCDU's PERF APPR set, "V1" on the take-off
// roll; and the EGPWS's: "SINK RATE", "PULL UP", "TERRAIN", "TOO LOW GEAR", "TOO LOW FLAPS", "GLIDESLOPE", "BANK ANGLE",
// "DON'T SINK" — by FlightGear's recordings (Sounds/GPWS/: the names given here, its files'). Pure: a frame's figures
// in, the recordings to play out; each height said once going down (re-armed some way back above it), each warning
// repeated while it lasts as the EGPWS does.

/** A frame's figures. */
export interface CalloutIn {
  /** the radio altitude [ft] (none: above 2500 ft or no ground under), the vertical speed [ft/min] */
  ra: number | null;
  vs: number;
  onGround: boolean;
  /** the indicated airspeed [kt], V1 [kt] (the FMS's — none: no call), the levers' detent (0 IDLE … 6 TOGA) */
  ias: number;
  v1: number | null;
  detent: number;
  /** the autopilot's LAND mode engaged (RETARD at 10 ft), the decision height or the minimum descent altitude [ft
   *  — the radio's for a DH, the baro's for an MDA] (none: no MINIMUM call), the barometric altitude [ft] */
  land: boolean;
  dh: number | null;
  mda: number | null;
  baroFt: number;
  /** the gear down, the flaps' lever (0…4), the glide slope's deviation [dots, fly up > 0 — below the beam] (none:
   *  none received), the bank [deg] */
  gearDown: boolean;
  flapLever: number;
  gsDots: number | null;
  bank: number;
  /** the game's ground warnings (game/gpws.ts): the ground ahead (a pull-up), the sink rate past its envelope */
  pullUp: boolean;
  sinkRate: boolean;
  terrain?: boolean;
  /** the clock [s] */
  t: number;
}

const HEIGHTS: [number, string][] = [
  [2500, "altitude-2500"],
  [1000, "1000"],
  [500, "500"],
  [400, "400"],
  [300, "300"],
  [200, "200"],
  [100, "100"],
  [50, "50"],
  [40, "40"],
  [30, "30"],
  [20, "20"],
  [10, "10"],
  [5, "5"],
];

/** the warnings, their recordings and their repeat [s] (the EGPWS's: while it lasts) */
const WARN: { id: keyof Flags; file: string; every: number }[] = [
  { id: "pullUp", file: "pull-up", every: 1.6 },
  { id: "terrain", file: "terrain", every: 2 },
  { id: "sinkRate", file: "sink-rate", every: 2 },
  { id: "tooLowGear", file: "too-low-gear", every: 3 },
  { id: "tooLowFlaps", file: "too-low-flaps", every: 3 },
  { id: "dontSink", file: "dont-sink", every: 3 },
  { id: "glideslope", file: "glideslope", every: 3 },
  { id: "bankAngle", file: "bank-angle", every: 3 },
];
type Flags = Record<"pullUp" | "terrain" | "sinkRate" | "tooLowGear" | "tooLowFlaps" | "dontSink" | "glideslope" | "bankAngle", boolean>;

export class A320Callouts {
  /** heights: the radio altitudes', the minima's, RETARD and V1 said here too (false: FlightGear's sound files say them
   *  — src/a320/sound/model.ts —, only the EGPWS's warnings here) */
  constructor(private heights = true) {}

  /** the heights said on this descent (each re-armed 10 % back above it) */
  private said = new Set<number>();
  private retardAt = -Infinity;
  private minimum = { hundred: false, at: false };
  private v1Said = false;
  /** each warning's last call [s]; the take-off's highest radio altitude (DON'T SINK: a height lost after it) */
  private last: Partial<Record<keyof Flags, number>> = {};
  private climbMax = 0;

  /** The recordings due this frame (FlightGear's Sounds/GPWS/ names, without ".wav"). */
  step(i: CalloutIn): string[] {
    const out: string[] = [];
    // ---- V1, on the take-off roll
    if (this.heights && i.onGround && i.v1 && i.detent >= 4) {
      if (!this.v1Said && i.ias >= i.v1 - 2) {
        this.v1Said = true;
        out.push("V1");
      }
    } else if (i.onGround && i.ias < 40) this.v1Said = false;
    // ---- the heights, going down (not on the take-off: climbing, or on the ground)
    const ra = i.onGround ? 0 : i.ra;
    if (ra !== null && this.heights) {
      for (const [h] of HEIGHTS) if (ra > h * 1.1 + 5) this.said.delete(h);
      if (!i.onGround && i.vs < -100) {
        // (the highest one crossed this frame said — the others passed with it unsaid)
        const due = HEIGHTS.filter(([h]) => ra <= h && !this.said.has(h));
        for (const [h] of due) this.said.add(h);
        const first = due[0];
        // (the minima's calls take the place of a height's at the same moment)
        const minimaNow = this.minima(i, ra);
        if (minimaNow) out.push(minimaNow);
        else if (first) out.push(first[1]);
        // (RETARD: at 20 ft — 10 with the autopilot's LAND —, the levers above idle; again each 1.5 s until idle)
        const retardH = i.land ? 10 : 20;
        if (ra <= retardH && i.detent > 0 && i.t - this.retardAt > 1.5) {
          this.retardAt = i.t;
          out.push("retard");
        }
      }
    }
    if (i.onGround && i.detent === 0) this.retardAt = -Infinity;
    // ---- the EGPWS's warnings
    const f = this.flags(i);
    for (const w of WARN) if (!f[w.id]) delete this.last[w.id];
    // (one warning at a time: the most urgent, repeated while it lasts)
    const w = WARN.find((x) => f[x.id]);
    if (w) {
      const at = this.last[w.id];
      if (at === undefined || i.t - at >= w.every) {
        this.last[w.id] = i.t;
        out.push(w.file);
      }
    }
    return out;
  }

  /** "HUNDRED ABOVE" 100 ft over the minimum, "MINIMUM" at it (the DH on the radio altitude, the MDA on the baro's). */
  private minima(i: CalloutIn, ra: number): string | null {
    const over = i.dh !== null ? ra - i.dh : i.mda !== null ? i.baroFt - i.mda : null;
    if (over === null) return null;
    if (over > 150) this.minimum = { hundred: false, at: false };
    if (!this.minimum.hundred && over <= 100 && over > 0) {
      this.minimum.hundred = true;
      return "100-above";
    }
    if (!this.minimum.at && over <= 0) {
      this.minimum.at = true;
      return "minimum";
    }
    return null;
  }

  /** The EGPWS's modes (Honeywell's, simplified): 1 the sink rate, 2 the terrain closure (the game's look-ahead), 3 a
   *  height lost after the take-off, 4 too low with the gear or the flaps up, 5 below the glide slope, the bank angle. */
  private flags(i: CalloutIn): Flags {
    const ra = i.onGround ? 0 : (i.ra ?? 99999);
    const air = !i.onGround && ra > 30;
    if (i.onGround) this.climbMax = 0;
    else if (i.vs > 0) this.climbMax = Math.max(this.climbMax, ra);
    const takeoff = !i.onGround && this.climbMax > 0 && this.climbMax < 1500 && !i.gearDown;
    return {
      pullUp: air && i.pullUp,
      terrain: air && !!i.terrain && !i.pullUp,
      sinkRate: air && i.sinkRate && !i.pullUp,
      tooLowGear: air && !takeoff && ra < 500 && !i.gearDown && i.ias < 190 && i.vs < 0,
      tooLowFlaps: air && !takeoff && ra < 245 && i.gearDown && i.flapLever < 3 && i.ias < 159 && i.vs < 0,
      dontSink: air && takeoff && ra < 1500 && i.vs < -300 && ra < this.climbMax - 50,
      glideslope: air && i.gsDots !== null && ra < 1000 && i.gsDots > 1.3 && i.gearDown,
      bankAngle: air && Math.abs(i.bank) > 35,
    };
  }

  reset() {
    this.said.clear();
    this.retardAt = -Infinity;
    this.minimum = { hundred: false, at: false };
    this.v1Said = false;
    this.last = {};
    this.climbMax = 0;
  }
}
