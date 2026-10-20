// The flight's recorder (PLAN-HUB HB4): the flight's figures against the scene's time, kept for the
// tablet's TELEMETRY page (its curves, from a minute to the whole flight) and exported as CSV. A sample at
// most every `step` seconds of the scene's time; full, every other sample let go and the step doubled —
// the whole flight kept, coarser as it grows (a burn's seconds early on, a day's cruise later). A new
// flight, or the time going back (a load, a jump), starts it again.

/** One moment of the flight (SI: m, m/s, W/m², the throttle 0…1). */
export interface RecSample {
  /** the scene's time [s] */
  t: number;
  /** the height above the body's ground [m] (NaN about the hole) */
  alt: number;
  /** the speed the HUD shows [m/s] (the air's or the ground's near a world, the body's in space) */
  speed: number;
  /** the vertical speed [m/s] */
  vz: number;
  /** the load [g] */
  g: number;
  /** the dynamic pressure [Pa], Mach, the heat flux [W/m²] (0 out of the air) */
  q: number;
  mach: number;
  heat: number;
  throttle: number;
  /** the Δv spent since the flight began [m/s] */
  dv: number;
  /** the propellant left (0…1), or null (none counted) */
  fuel: number | null;
  /** a spacecraft's (PLAN-VAISSEAUX X8): the Δv the propellant still holds and the plan's [m/s], the battery's share
   *  and the oxygen's hours, the docking's range [m] and closing rate [m/s], the hours gone by on the Earth beyond
   *  the craft's own [s] — null where they mean nothing */
  dvLeft?: number | null;
  dvPlan?: number | null;
  battery?: number | null;
  o2?: number | null;
  dockRange?: number | null;
  dockClosing?: number | null;
  earthGap?: number | null;
}

export type RecKey = Exclude<keyof RecSample, "t">;

/** The channels the page offers: each its key, unit and scale from SI. */
export const CHANNELS: { key: RecKey; label: string; unit: string; k: number }[] = [
  { key: "alt", label: "Altitude", unit: "km", k: 1e-3 },
  { key: "speed", label: "Speed", unit: "m/s", k: 1 },
  { key: "vz", label: "Vertical speed", unit: "m/s", k: 1 },
  { key: "g", label: "Load", unit: "g", k: 1 },
  { key: "q", label: "Dynamic pressure", unit: "kPa", k: 1e-3 },
  { key: "mach", label: "Mach", unit: "", k: 1 },
  { key: "heat", label: "Heat flux", unit: "W/cm²", k: 1e-4 },
  { key: "throttle", label: "Throttle", unit: "%", k: 100 },
  { key: "dv", label: "Δv spent", unit: "m/s", k: 1 },
  { key: "fuel", label: "Propellant", unit: "%", k: 100 },
  { key: "dvLeft", label: "Δv left", unit: "m/s", k: 1 },
  { key: "dvPlan", label: "Δv of the plan", unit: "m/s", k: 1 },
  { key: "battery", label: "Battery", unit: "%", k: 100 },
  { key: "o2", label: "Oxygen", unit: "h", k: 1 },
  { key: "dockRange", label: "Docking range", unit: "m", k: 1 },
  { key: "dockClosing", label: "Closing rate", unit: "m/s", k: 1 },
  { key: "earthGap", label: "Time gone by on Earth", unit: "h", k: 1 / 3600 },
];

export class FlightRecorder {
  samples: RecSample[] = [];
  /** the least time between two samples [s] — doubled each time the record fills */
  step: number;
  constructor(
    private readonly max = 4000,
    private readonly step0 = 0.5,
  ) {
    this.step = step0;
  }

  reset() {
    this.samples = [];
    this.step = this.step0;
  }

  /** A frame's figures: kept if `step` has passed since the last; the time going back starts afresh. */
  push(s: RecSample) {
    if (!Number.isFinite(s.t)) return;
    const last = this.samples[this.samples.length - 1];
    if (last && s.t < last.t - 1e-6) this.reset();
    else if (last && s.t - last.t < this.step) return;
    this.samples.push(s);
    if (this.samples.length > this.max) {
      // (the first and the latest always kept: the flight's whole span)
      const keep = this.samples.filter((_, i, a) => i % 2 === 0 || i === a.length - 1);
      this.samples = keep;
      this.step *= 2;
    }
  }

  /** The last `seconds` of the flight (Infinity: all of it). */
  window(seconds: number): RecSample[] {
    const n = this.samples.length;
    if (!n || !Number.isFinite(seconds)) return this.samples;
    const t1 = this.samples[n - 1]!.t - seconds;
    let i = n - 1;
    while (i > 0 && this.samples[i - 1]!.t >= t1) i--;
    return this.samples.slice(Math.max(i - 1, 0));
  }

  /** The record as CSV: a header, then a row a sample (SI units, as recorded). */
  csv(): string {
    const keys: (keyof RecSample)[] = [
      "t",
      "alt",
      "speed",
      "vz",
      "g",
      "q",
      "mach",
      "heat",
      "throttle",
      "dv",
      "fuel",
      "dvLeft",
      "dvPlan",
      "battery",
      "o2",
      "dockRange",
      "dockClosing",
      "earthGap",
    ];
    const head =
      "t_s,alt_m,speed_mps,vz_mps,load_g,q_pa,mach,heat_wpm2,throttle,dv_mps,fuel,dv_left_mps,dv_plan_mps,battery,o2_h,dock_range_m,dock_closing_mps,earth_gap_s";
    const cell = (v: number | null | undefined) =>
      v === null || v === undefined || !Number.isFinite(v) ? "" : String(Math.round(v * 1e4) / 1e4);
    return `${head}\n${this.samples.map((s) => keys.map((k) => cell(s[k] as number | null)).join(",")).join("\n")}\n`;
  }
}

/** The flight's one recorder (the HUD feeds it each frame, the tablet reads it). */
export const recorder = new FlightRecorder();
