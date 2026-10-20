// A spacecraft's mission plan as a timeline (docs/PLAN-VAISSEAUX-AAA.md, X1e) — the spacecraft's flight plan, as
// LNAV/VNAV's route is the F-35's: the plan's burns (their Δv, their length at full thrust), the spheres of influence
// the path crosses, an impact, what the autopilot does at the end; the Δv planned against the tanks'. Pure.

/** What the timeline reads: now and the burns' times [s of the scene], their Δv [m/s], the path's points' times [s]
 *  and spheres, its fate, the Δv left in the tanks and the acceleration at full thrust [m/s, m/s²]. */
export interface TimelineInput {
  now: number;
  burns: { t: number; dv: number; role?: string; body?: string; label?: string }[];
  path?: { times: number[]; refs: string[]; fate: string; hit?: string } | null;
  then?: string | null;
  dvLeft: number;
  accel: number;
}

export type TimelineKind = "burn" | "soi" | "impact" | "then";

export interface TimelineEvent {
  kind: TimelineKind;
  /** its time [s of the scene], and from now [s] */
  t: number;
  in: number;
  /** a burn's Δv [m/s] and its length at full thrust [s]; its role in the mission */
  dv?: number;
  burnS?: number;
  role?: string;
  /** the body: a sphere entered, the ground hit, a burn's */
  body?: string;
  /** the flight computer's name for a burn; what the autopilot does at the end */
  label?: string;
}

export interface Timeline {
  events: TimelineEvent[];
  /** the Δv the plan asks, the tanks' left [m/s], what remains after it (negative: short) */
  dv: number;
  dvLeft: number;
  margin: number;
  /** the next burn's index in events (−1: none) */
  next: number;
}

/** The timeline of a plan: its events in time's order, past ones left out. */
export function buildTimeline(I: TimelineInput): Timeline {
  const ev: TimelineEvent[] = [];
  for (const b of I.burns) {
    if (b.t < I.now - 60) continue;
    ev.push({
      kind: "burn",
      t: b.t,
      in: b.t - I.now,
      dv: b.dv,
      burnS: I.accel > 0 ? b.dv / I.accel : Number.POSITIVE_INFINITY,
      role: b.role,
      body: b.body,
      label: b.label,
    });
  }
  const P = I.path;
  if (P && P.times.length) {
    for (let j = 1; j < P.refs.length; j++) {
      if (P.refs[j] === P.refs[j - 1] || P.times[j]! < I.now) continue;
      ev.push({ kind: "soi", t: P.times[j]!, in: P.times[j]! - I.now, body: P.refs[j] });
    }
    const tEnd = P.times[P.times.length - 1]!;
    if (P.fate === "impact") ev.push({ kind: "impact", t: tEnd, in: tEnd - I.now, body: P.hit ?? P.refs[P.refs.length - 1] });
  }
  // (what the autopilot does at the end: right after the last burn)
  if (I.then && I.burns.length) {
    const tLast = Math.max(...I.burns.map((b) => b.t));
    ev.push({ kind: "then", t: tLast, in: tLast - I.now, label: I.then });
  }
  const order: Record<TimelineKind, number> = { burn: 0, then: 1, soi: 2, impact: 3 };
  ev.sort((a, b) => a.t - b.t || order[a.kind] - order[b.kind]);
  const dv = I.burns.filter((b) => b.t >= I.now - 60).reduce((s, b) => s + b.dv, 0);
  return { events: ev, dv, dvLeft: I.dvLeft, margin: I.dvLeft - dv, next: ev.findIndex((e) => e.kind === "burn") };
}
