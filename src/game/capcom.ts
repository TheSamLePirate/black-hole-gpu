// Mission control (PLAN-TARS T3): Houston's capcom and the runway's tower, by radio, on the flight's own
// moments — the lift-off, a good orbit, the deorbit burn done, the blackout of the entry's plasma (warned
// before it, silent through it, "how do you read?" after), the tower's clearance on the final, the wheels
// stopped (a word on the landing's grade), a docking, the wormhole (the signal lost: no Houston on
// Gargantua's side), an accident. Pure: a frame's state in, the lines out, each with the time it arrives —
// Houston's after the light's delay from the Earth (1.3 s from the Moon, minutes from Mars: none past a
// minute of the wall), the tower's at once. Read from the flight's state, not its messages' (translated) text.

import { t, tf } from "../i18n";
import type { VoiceLine } from "../audio/voice";

export interface CapcomInput {
  /** the wall's clock [ms] */
  now: number;
  /** which universe: Houston hears only ours */
  side: "ours" | "gargantua" | "throat";
  /** the flight's stage and mode (game/phase.ts), null: not flying */
  stage: string | null;
  mode: string | null;
  /** the craft's name (the callsign) */
  callsign: string;
  /** the orbit's figures when in orbit [km] */
  orbit: { apKm: number; peKm: number } | null;
  /** the entry autopilot's phase (plan, wait, burn, entry, glide), null: none; its site */
  entry: string | null;
  site: string | null;
  /** on a runway's final, its heading [°] and the wind there (from [°], speed [m/s]) */
  final: { rwy: number; wind: { from: number; u10: number } | null } | null;
  /** the entry's plasma 0…1 (the director's measure: the air's heating) */
  plasma: number;
  /** stopped on the ground (not rolling) */
  stopped: boolean;
  docked: boolean;
  /** the last landing's grade (A … F), when its report is out */
  grade: string | null;
  /** the craft lost (crashed, burnt up) */
  failed: boolean;
  /** the light's time from the Earth [s] and the flight's time per wall second (the warp) */
  lightS: number;
  warp: number;
}

/** A line and when it arrives [wall ms]. */
export interface Timed {
  line: VoiceLine;
  at: number;
}

/** The plasma's level past which the radio is lost, and below which it comes back. */
const LOS = 0.45;
const AOS = 0.25;
/** Houston's lines past this delay [ms] not said (the Earth too far: the flight goes on without it). */
const MAX_DELAY = 60_000;

export class Capcom {
  private prev: CapcomInput | null = null;
  /** in the plasma's blackout: the lines held till it ends */
  blackout = false;
  private warnedLos = false;
  private held: Timed[] = [];
  private finalSaid = false;
  private wheelsSaid = false;
  private failSaid = false;

  reset() {
    this.prev = null;
    this.blackout = false;
    this.warnedLos = false;
    this.held = [];
    this.finalSaid = this.wheelsSaid = this.failSaid = false;
  }

  update(i: CapcomInput): Timed[] {
    const p = this.prev;
    this.prev = i;
    if (!p) return [];
    const out: Timed[] = [];
    const cs = i.callsign;
    // Houston: by radio, after the light's delay — none on Gargantua's side, none past a minute
    const houston = (id: string, text: string, priority = 2) => {
      if (i.side !== "ours") return;
      const delay = (1000 * i.lightS) / Math.max(i.warp, 1);
      if (delay > MAX_DELAY) return;
      const l: Timed = { line: { id, text, speaker: "mission", priority, radio: true, ttl: 30_000 }, at: i.now + delay };
      (this.blackout ? this.held : out).push(l);
    };
    const tower = (id: string, text: string) =>
      out.push({ line: { id, text, speaker: "tower", priority: 2, radio: true, ttl: 15_000 }, at: i.now });

    // the wormhole: the signal lost going in; back in our universe, found again
    if (p.side === "ours" && i.side !== "ours")
      out.push({
        line: { id: "lost", text: tf("{0}, Houston, we're losing your sig…", cs), speaker: "mission", priority: 2, radio: true },
        at: i.now,
      });
    if (p.side !== "ours" && i.side === "ours") houston("home", tf("{0}… Houston. Is that you? Welcome home.", cs));

    // the blackout: warned as the plasma begins, the radio lost in it, back after it
    if (!this.warnedLos && i.plasma > 0.12 && p.plasma <= 0.12) {
      this.warnedLos = true;
      houston("los-warn", tf("{0}, Houston. Expect loss of signal in the plasma. See you on the other side.", cs));
    }
    if (!this.blackout && i.plasma > LOS) this.blackout = true;
    else if (this.blackout && i.plasma < AOS) {
      this.blackout = false;
      houston("aos", tf("{0}, Houston, how do you read?", cs), 1);
      // (what was said meanwhile: on its way now)
      for (const h of this.held) out.push({ ...h, at: Math.max(h.at, i.now + 4000) });
      this.held = [];
    }
    if (i.plasma < 0.05 && i.stage !== "entry") this.warnedLos = false;

    // the lift-off (off the ground under power), a good orbit, the escape
    if (p.mode === "landed" && i.mode === "flight" && i.stage !== "ground") {
      houston("liftoff", tf("{0}, Houston. Lift-off. You're clear.", cs));
      this.wheelsSaid = false;
      this.finalSaid = false;
    }
    if (i.stage === "orbit" && p.stage !== "orbit" && (p.stage === "air" || p.stage === "suborbital") && i.orbit)
      houston("orbit", tf("{0}, Houston. Good orbit: {1} by {2} kilometres.", cs, Math.round(i.orbit.apKm), Math.round(i.orbit.peKm)));
    if (i.stage === "escape" && p.stage === "orbit") houston("escape", tf("{0}, Houston. You're on your way. Godspeed.", cs));

    // the deorbit burn done: go for the entry
    if (p.entry === "burn" && i.entry === "entry")
      houston(
        "deorbit",
        i.site ? tf("{0}, Houston. Copy the burn. You're go for entry to {1}.", cs, i.site) : tf("{0}, Houston. Copy the burn.", cs),
      );

    // the tower on the final: the runway, the wind, cleared to land
    if (i.final && !this.finalSaid && i.site) {
      this.finalSaid = true;
      const rwy = String(Math.round(i.final.rwy / 10) % 36 || 36).padStart(2, "0");
      const w = i.final.wind;
      const wind =
        !w || w.u10 < 1.5
          ? t("wind calm")
          : tf("wind {0} at {1} knots", String(Math.round(w.from / 10) * 10 || 360).padStart(3, "0"), Math.round(w.u10 * 1.944));
      tower("cleared", tf("{0}, {1} tower. Runway {2}, {3}, cleared to land.", cs, i.site, rwy, wind));
    }

    // the wheels stopped: a word on the landing
    if (i.stopped && i.mode === "landed" && !this.wheelsSaid && i.grade) {
      this.wheelsSaid = true;
      const word: Record<string, string> = {
        A: t("Textbook."),
        B: t("Nice landing."),
        C: t("We'll take it."),
        D: t("That one was firm."),
        F: t("We'll talk about that landing later."),
      };
      houston("wheels", tf("{0}, Houston. Wheels stop. {1}", cs, word[i.grade] ?? ""));
    }

    // docking, undocking
    if (i.docked && !p.docked) houston("dock", tf("{0}, Houston. Hard dock confirmed.", cs));
    if (!i.docked && p.docked) houston("undock", tf("Clean separation, {0}.", cs));

    // the craft lost
    if (i.failed && !this.failSaid) {
      this.failSaid = true;
      houston("lost-craft", tf("{0}, Houston… {0}, do you copy?", cs), 0);
    }
    if (!i.failed) this.failSaid = false;
    return out;
  }
}
