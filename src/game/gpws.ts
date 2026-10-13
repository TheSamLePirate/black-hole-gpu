// The ground's warnings for a craft flying on its wings (a GPWS of the modern kind): the ground ahead along its
// flight path — not its free fall's, which a wing never follows: a jet at 150 m on its wings has a ballistic
// impact a few seconds away all the time, and the old alarms rang the whole flight —, the sink rate's envelope
// and the radio heights only when it is set to land (its gear down, its flaps out, on a final), and a level for
// the pilot: "full" (an airliner's: every callout), "reduced" (a fighter's: the ground ahead and the landing's
// calls only), "off" (only the ground about to be hit). Pure: a frame's figures in, what to sound out.

import { sinkLimit } from "./callouts";

/** How much the craft says about the ground: every callout, a fighter's few, or only the last-moment pull-up. */
export type GroundAlerts = "full" | "reduced" | "off";

/** The seconds before the straight flight path meets the ground (Infinity: not within the look-ahead): the
 *  path from the craft along its ground-relative velocity, its height over the ground sampled ahead
 *  (`clearance(t)` [m], the gear's: < 0 under the ground), 0.5 s apart to 6 s, then 1 s apart. */
export function terrainAhead(clearance: (t: number) => number, horizon = 20): number {
  let tPrev = 0,
    hPrev = clearance(0);
  for (let t = 0.5; t <= horizon + 1e-9; t += t < 6 ? 0.5 : 1) {
    const h = clearance(t);
    if (h <= 0) return hPrev > 0 ? tPrev + ((t - tPrev) * hPrev) / (hPrev - h) : t;
    tPrev = t;
    hPrev = h;
  }
  return Infinity;
}

export interface GpwsInput {
  /** the gear's height over the ground [m], its rate [m/s, up > 0] */
  agl: number;
  vz: number;
  /** the straight flight path's time to the ground [s] (terrainAhead) */
  ahead: number;
  /** flying on its wings: in the air, the controls biting (dynamic pressure), not stalled — else it falls, and
   *  the free fall's impact is the one that counts */
  winged: boolean;
  /** set to land: the gear down, flaps out, or on a runway's final */
  landing: boolean;
}
export interface GpwsOutput {
  /** "terrain, pull up": the warning (its alarm and its voice) */
  pullUp: boolean;
  /** the ground coming: the caution (its tone) */
  terrain: boolean;
  /** "sink rate" past the landing's envelope may be said */
  sinkRate: boolean;
  /** the radio heights may be called going down */
  heights: boolean;
}

/** The look-ahead's warning and caution times [s] by level: an airliner's GPWS gives ~20 s and ~10 s of
 *  terrain ahead; a fighter's ground-collision warning, a few seconds — what a pull at 4–6 g needs. */
export const GPWS_TIMES: Record<GroundAlerts, { warn: number; caution: number }> = {
  full: { warn: 7, caution: 14 },
  reduced: { warn: 4, caution: 7 },
  off: { warn: 2.5, caution: 0 },
};

export function gpws(i: GpwsInput, level: GroundAlerts): GpwsOutput {
  const T = GPWS_TIMES[level];
  // straight down: the ground's own closure, under the look-ahead's resolution (a vertical dive, a spin)
  const closure = i.vz < 0 && i.agl < 600 ? i.agl / -i.vz : Infinity;
  const toGround = i.winged ? Math.min(i.ahead, closure) : closure;
  const heights = level === "full" || (level === "reduced" && i.landing);
  if (i.landing) {
    // set to land the ground is meant to come — the Ranger's steep glide has it 4–6 s ahead all the way down —:
    // the landing's envelope (callouts.ts sinkLimit: 1.3 times it, or the ground 2.5 s below — as a GPWS's mode 1),
    // the flight path's ground only when much nearer (a hill under the final); nothing in the flare (15 m)
    const pull = i.agl > 15 && (closure < 2.5 || (i.agl < 500 && -i.vz > 1.3 * sinkLimit(i.agl)) || (i.winged && i.ahead < T.warn / 2));
    return { pullUp: pull, terrain: false, sinkRate: level !== "off", heights };
  }
  return {
    pullUp: toGround < T.warn,
    terrain: level !== "off" && toGround < T.caution,
    sinkRate: level === "full",
    heights,
  };
}

/** What gpwsOf reads of a frame's flight (a subset of CameraController.flightInfo()). */
export interface GpwsFlight {
  surface: { alt: number; vVert: number; landed?: boolean; rolling?: boolean } | null;
  air?: { inAir: boolean; q: number; stalled: boolean; mode?: string; gearDown?: boolean; flaps?: number } | null;
  entry?: { app: { final?: boolean } | null } | null;
  terrainAhead?: number;
}

/** Under this height [m] over the ground the warnings here are the ground's (above, the free fall's impact). */
export const GPWS_CEILING = 3000;

/** A frame's flight → its warnings ("low": within GPWS_CEILING of the ground, in the air — else none). */
export function gpwsOf(f: GpwsFlight, level: GroundAlerts): GpwsOutput & { low: boolean } {
  const sf = f.surface;
  const low = !!sf && !sf.landed && !sf.rolling && Number.isFinite(sf.alt) && sf.alt < GPWS_CEILING;
  if (!low) return { low, pullUp: false, terrain: false, sinkRate: false, heights: false };
  const a = f.air;
  // (on its wings: in the air's grip — 2 kPa, ~60 m/s at sea level —, not stalled, flown as a plane or the sci-fi
  // computer's way; a rocket in the air falls along its free fall's arc)
  const winged = !!a?.inAir && a.q > 2000 && !a.stalled && a.mode !== "rocket";
  const landing = !!a?.gearDown || (a?.flaps ?? 0) > 0 || !!f.entry?.app?.final;
  return { low, ...gpws({ agl: sf!.alt, vz: sf!.vVert, ahead: f.terrainAhead ?? Infinity, winged, landing }, level) };
}
