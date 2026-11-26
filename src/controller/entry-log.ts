// The entry autopilot's flight recorder (Sam, 26 Nov 2026: « des informations détaillées (visibles ou non) sur le vol, utilisables pour
// les analyses, le plan de vol, les écarts au plan »). From the autopilot's engagement to the craft at rest — or the autopilot let go —:
// the plan (the site, its runway, the deorbit's burn and its predicted heat, load and shield; the hand-over aimed; the approach's gate),
// a sample each second of the flight's own time (each half second under 3 km over the ground) — the phase, the leg, the place, the
// speeds, the angles commanded and flown, the guidance's predicted miss, the approach's energy against what the way left asks, its
// offsets from the runway's axis and from the final's profile —, the events (the autopilot's messages, the phases and legs as they
// change), and the deviations from the plan summed up (summary). Nothing drawn: `__bh.camera.entryLog` (docs/BH-API.md), the live
// flight's log (scripts/live-entry.ts writes it out as JSON). Kept after the flight, until the next engagement.

/** one sample of the flight */
export interface EntrySample {
  /** the flight's own time since the engagement [s] */
  t: number;
  phase: string;
  leg: string | null;
  /** geodetic place [°] and height over the ellipsoid [m]; over the ground [m] (null: not known) */
  lat: number;
  lon: number;
  h: number;
  agl: number | null;
  /** speed over the ground's own turning and through the air [m/s], Mach, vertical speed [m/s] */
  v: number;
  vAir: number | null;
  mach: number | null;
  vs: number;
  /** the flight path's angle [°], the one the autopilot asks (glide) [°] */
  gamma: number;
  gRef: number | null;
  /** the angle of attack asked [°], the bank asked and flown [°] */
  alpha: number;
  bank: number;
  bankFlown: number | null;
  /** the load [g], the dynamic pressure [Pa], the stagnation's heat flux [W/cm²] */
  load: number;
  q: number | null;
  heat: number | null;
  /** the entry guidance's predicted miss at the hand-over [m]: along (from the place; the aim is −short) and across */
  miss: { along: number; across: number } | null;
  /** the approach: along the runway from its threshold, across its axis [m], on the final, the profile's height and the one flown [m] */
  app: { along: number; across: number; final: boolean; profH: number | null; hp: number | null } | null;
  /** the approach's energy height and what the way left asks [m], the way left [m], short of energy */
  energy: { e: number; need: number; toGo: number; low: boolean } | null;
  airBrake: number;
  throttle: number;
  /** the time's warp (×) */
  warp: number;
}

export interface EntryEvent {
  t: number;
  kind: "message" | "phase" | "leg" | "touchdown" | "stopped" | "lost" | "end";
  text: string;
}

export interface EntryPlanRecord {
  site: { name: string; lat: number; lon: number; rwy: number | null; runway: boolean } | null;
  /** the deorbit as planned (its burn's time from the engagement [s], Δv [m/s], the predicted heat [W/cm²], load [g], shield [K]);
   *  re-aimed: the latest */
  deorbit: { tBurn: number; dv: number; heat: number | null; g: number | null; shield: number | null; reaimed: boolean } | null;
  /** the hand-over: at Mach, this far short of the site [m] */
  handover: { mach: number; short: number };
}

/** the deviations from the plan, summed up */
export interface EntrySummary {
  outcome: "landed" | "stopped" | "lost" | "let go" | "flying";
  site: string | null;
  deorbit: { dvPlanned: number | null; dvFlown: number | null; burnLate: number | null } | null;
  handover: {
    t: number;
    along: number;
    across: number;
    agl: number;
    speed: number;
    missAlong: number | null;
    missAcross: number | null;
  } | null;
  peaks: { load: number; heat: number; q: number };
  approach: {
    energyMarginMin: number | null;
    lowEnergyS: number;
    airBrakeS: number;
    legs: string[];
    acrossAtGate: number | null;
    dh: { across: number; dh: number; ga: boolean } | null;
  };
  touchdown: { t: number; along: number; across: number; sink: number; speed: number } | null;
  stop: { along: number; across: number } | null;
}

const D = 180 / Math.PI;
const MAX_SAMPLES = 20000;

export class EntryLog {
  readonly started = Date.now();
  plan: EntryPlanRecord = { site: null, deorbit: null, handover: { mach: 2.5, short: 0 } };
  samples: EntrySample[] = [];
  events: EntryEvent[] = [];
  /** the flight's time last sampled [s], its phase and leg then */
  private tLast = -Infinity;
  private phase = "";
  private leg = "";
  over = false;
  touchdown: EntrySummary["touchdown"] = null;
  stop: EntrySummary["stop"] = null;
  dh: EntrySummary["approach"]["dh"] = null;
  dvFlown: number | null = null;
  burnAt: number | null = null;

  /** a sample due at the flight's time `t` [s] (each second; each half second under 3 km over the ground) */
  due(t: number, agl: number | null): boolean {
    return !this.over && t - this.tLast >= (agl !== null && agl < 3000 ? 0.5 : 1);
  }

  add(s: EntrySample) {
    this.tLast = s.t;
    if (s.phase !== this.phase) {
      this.event(s.t, "phase", s.phase);
      this.phase = s.phase;
    }
    if ((s.leg ?? "") !== this.leg) {
      if (s.leg) this.event(s.t, "leg", s.leg);
      this.leg = s.leg ?? "";
    }
    this.samples.push(s);
    // (a long wait's samples thinned — every other one dropped — past the cap: the fall kept whole)
    if (this.samples.length > MAX_SAMPLES) this.samples = this.samples.filter((_, i) => i % 2 === 0 || this.samples[i]!.phase !== "wait");
  }

  event(t: number, kind: EntryEvent["kind"], text: string) {
    this.events.push({ t, kind, text });
  }

  end(t: number, why: string) {
    if (this.over) return;
    this.event(t, "end", why);
    this.over = true;
  }

  summary(): EntrySummary {
    const S = this.samples;
    const outcome: EntrySummary["outcome"] = this.events.some((e) => e.kind === "lost")
      ? "lost"
      : this.stop
        ? "stopped"
        : this.touchdown
          ? "landed"
          : this.over
            ? "let go"
            : "flying";
    const glide = S.filter((s) => s.phase === "glide");
    const h0 = glide[0];
    const lastEntry = [...S].reverse().find((s) => s.phase === "entry" && s.miss);
    let lowS = 0,
      brakeS = 0,
      marg: number | null = null;
    for (let i = 1; i < glide.length; i++) {
      const dt = glide[i]!.t - glide[i - 1]!.t;
      const e = glide[i]!.energy;
      if (e?.low) lowS += dt;
      if (glide[i]!.airBrake > 0.05) brakeS += dt;
      if (e && !glide[i]!.app?.final) marg = Math.min(marg ?? Infinity, e.e - e.need);
    }
    const legs: string[] = [];
    for (const e of this.events) if (e.kind === "leg" && legs.at(-1) !== e.text) legs.push(e.text);
    const gate = glide.find((s) => s.app?.final);
    const max = (f: (s: EntrySample) => number | null) => S.reduce((m, s) => Math.max(m, f(s) ?? 0), 0);
    return {
      outcome,
      site: this.plan.site?.name ?? null,
      deorbit: this.plan.deorbit
        ? {
            dvPlanned: this.plan.deorbit.dv,
            dvFlown: this.dvFlown,
            burnLate: this.burnAt !== null ? this.burnAt - this.plan.deorbit.tBurn : null,
          }
        : null,
      handover: h0
        ? {
            t: h0.t,
            along: h0.app?.along ?? 0,
            across: h0.app?.across ?? 0,
            agl: h0.agl ?? h0.h,
            speed: h0.vAir ?? h0.v,
            missAlong: lastEntry?.miss?.along ?? null,
            missAcross: lastEntry?.miss?.across ?? null,
          }
        : null,
      peaks: { load: max((s) => s.load), heat: max((s) => s.heat), q: max((s) => s.q) },
      approach: {
        energyMarginMin: marg === Infinity ? null : marg,
        lowEnergyS: lowS,
        airBrakeS: brakeS,
        legs,
        acrossAtGate: gate?.app?.across ?? null,
        dh: this.dh,
      },
      touchdown: this.touchdown,
      stop: this.stop,
    };
  }

  /** the whole record, for a file */
  json() {
    return {
      started: new Date(this.started).toISOString(),
      plan: this.plan,
      summary: this.summary(),
      events: this.events,
      samples: this.samples,
    };
  }

  /** a degree from a radian, rounded to a tenth (the samples' angles) */
  static deg(r: number): number {
    return Math.round(r * D * 10) / 10;
  }
}
