// The points the "craft lost" screen resumes from (audit 2026-11-10, FX-10): only the flight that was lost — the same
// flight (camera.flightGen: a scene, a placement, a load make a new one) and the same craft —, never another's. Two
// kinds: the last moment before an entry (a spacecraft meeting the air above 1 km/s — piloting.ts onAirEntry, kept at
// most once a second, not every frame of the thin air) and recent ones, kept every `everyS` seconds of steady flight in
// the air (an aircraft never "enters": before 13 Nov 2026 it had no point at all). The recent one resumed is the newest at
// least `minAgeS` old — not the one a few seconds before the loss, already in the turn that broke the craft. A point
// resumed is kept for the flight it begins, so a second loss resumes from it again. The hooks come from inside the
// flight's step (piloting.ts): they only mark a point due; it is taken by `settle`, once the step is whole (sim.ts
// afterStep) — taken mid-step, the camera's settings and the craft disagreed: an F-35 resumed 470 m low.

import type { GameSave } from "./save";
import type { VesselId } from "../vessels";

export interface ResumePoint {
  save: GameSave;
  kind: "entry" | "recent";
  /** the flight it belongs to (camera.flightGen) and its craft */
  flight: number;
  vessel: VesselId;
  /** the flight's air seconds when it was kept */
  at: number;
}

/** A load under which the flight is steady enough to resume from [g]. */
export const STEADY_G = 2.5;

export class ResumePoints {
  entry: ResumePoint | null = null;
  /** the recent points, oldest first (`keep` at most) */
  recent: ResumePoint[] = [];
  /** air seconds since the last recent point; the flight's air seconds */
  private since = 0;
  private airS = 0;
  private flight = -1;
  private entryAt = Number.NEGATIVE_INFINITY;
  /** a point due, taken by settle: the entry's, a recent one */
  private due: { entry: boolean; recent: boolean; vessel: VesselId | null } = { entry: false, recent: false, vessel: null };

  constructor(
    readonly everyS = 10,
    readonly minAgeS = 15,
    readonly keep = 4,
  ) {}

  /** this flight's seconds in the air so far */
  get airTime() {
    return this.airS;
  }

  /** A new flight: the last one's points let go. */
  private follow(flight: number) {
    if (flight === this.flight) return;
    this.flight = flight;
    this.entry = null;
    this.recent = [];
    this.since = this.airS = 0;
    this.entryAt = Number.NEGATIVE_INFINITY;
    this.due = { entry: false, recent: false, vessel: null };
  }

  /** The entry's hook (every frame of thin air above 1 km/s): the latest moment due, at most once a second. */
  onEntry(flight: number, vessel: VesselId) {
    this.follow(flight);
    if (this.airS - this.entryAt < 1 && this.entry) return;
    this.entryAt = this.airS;
    this.due.entry = true;
    this.due.vessel = vessel;
  }

  /** A frame in the air of `dt` flight seconds at a load of `g`: a recent point due every `everyS` s of it, when steady. */
  onAir(flight: number, vessel: VesselId, dt: number, g: number) {
    this.follow(flight);
    if (!(dt > 0)) return;
    this.airS += dt;
    this.since += dt;
    if (this.since < this.everyS || !(g < STEADY_G)) return;
    this.since = 0;
    this.due.recent = true;
    this.due.vessel = vessel;
  }

  /** After a whole step: the points due taken (one snapshot serves both). */
  settle(flight: number, take: () => GameSave) {
    const d = this.due;
    if (!d.entry && !d.recent) return;
    if (flight === this.flight && d.vessel) {
      const save = take();
      if (d.entry) this.entry = { save, kind: "entry", flight, vessel: d.vessel, at: this.airS };
      if (d.recent) {
        this.recent.push({ save, kind: "recent", flight, vessel: d.vessel, at: this.airS });
        if (this.recent.length > this.keep) this.recent.shift();
      }
    }
    this.due = { entry: false, recent: false, vessel: null };
  }

  /** The point to resume this flight's craft from (null: none of its own): the entry's; else the newest recent one at
   *  least `minAgeS` old, else the oldest kept. */
  pick(flight: number, vessel: VesselId): ResumePoint | null {
    const own = (p: ResumePoint | null | undefined) => !!p && p.flight === flight && p.vessel === vessel;
    if (own(this.entry)) return this.entry;
    const mine = this.recent.filter(own);
    for (let i = mine.length - 1; i >= 0; i--) if (this.airS - mine[i]!.at >= this.minAgeS) return mine[i]!;
    return mine[0] ?? null;
  }

  /** A point resumed: kept for the flight it begins (`flight`: the new one), so a second loss resumes from it again. */
  adopt(p: ResumePoint, flight: number) {
    this.follow(flight);
    const q = { ...p, flight, at: 0 };
    if (p.kind === "entry") this.entry = q;
    else this.recent = [q];
  }
}
