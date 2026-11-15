// The automatic choice of an approach (docs/PLAN-APPROCHES.md §4.3, AP1), pure: the airfield — the one selected, else the flight
// plan's destination, else the nearest ahead (±60° of the track), else the nearest —, then its end and approach by a score said in
// clear, what a controller would give:
//
// 1. the wind: a tail wind over 10 kt, a cross wind over the craft's limit — out; from 5 kt, the end into the wind first; a built
//    approach whose glideslope is not clear of the relief — out (Nice's 22R over Mont Agel's slopes: 15 Nov 2026);
// 2. the aid: an ILS (its category higher first), then a localizer (LOC, LDA, SDF, IGS), then the built approach;
// 3. the runway's length: a tight one (less than 300 m past the craft's least) paid for;
// 4. the way in: the path to the approach's IF and the turn to it — at equal wind and aid, the end « in line » wins.
//
// Until 15 Nov 2026 the end was always the first one in fair weather (game/sites.ts landingEnd): from the other side, the jet flew
// over the field to the far fix and turned back (Sam: « il ne prend pas la bonne approche »).

import { wgs84Inverse } from "../system/ellipsoid";
import type { Approach } from "../world/approaches";
import type { Airfield } from "../world/runways";

const KT = 0.514444;

/** The wind at the field: where it blows from [° true], its speed [m/s] (0: calm). */
export interface Wind {
  from: number;
  spd: number;
}

/** The craft asking: where it is and goes, what its runway must be. */
export interface Asker {
  lat: number;
  lon: number;
  /** its track over the ground [° true] (NaN: none — slow, hovering) */
  track: number;
  /** the least runway length it lands on [m], whether it needs it paved, its cross-wind limit [m/s] */
  minLen: number;
  paved: boolean;
  xwind: number;
  /** the most tail wind accepted [m/s] (the player's setting — PLAN-APPROCHES AP8); absent: CHOICE.tailMax (10 kt) */
  tailMax?: number;
}

/** The limits of the choice: a tail wind over this out [m/s], the wind counted from this [m/s]. */
export const CHOICE = { tailMax: 10 * KT, windFrom: 5 * KT } as const;

export interface Scored {
  a: Approach;
  /** null: chosen among; else why it is out */
  out: string | null;
  score: number;
  head: number;
  cross: number;
  /** the path to its IF [km] and the turn to it [°] */
  pathKm: number;
  turn: number;
}

export interface Choice {
  a: Approach;
  /** the reasons, in the order they decided: « wind » (head wind m/s), « aid » (kind, category), « way » (path km, turn °) */
  why: { wind: { head: number; cross: number } | null; aid: string; way: { km: number; turn: number } };
  table: Scored[];
}

const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function aidScore(a: Approach): number {
  if (a.kind === "ILS") return 20 + (a.loc?.cat === "III" ? 4 : a.loc?.cat === "II" ? 2 : 0);
  if (a.kind === "VIS") return 0;
  return 10;
}

/**
 * The approach the field's list gives the asker: the best of those not out, or — every one out — the least bad one, said
 * (its reason first). Null: no approach at all.
 */
export function chooseApproach(
  f: Airfield,
  list: readonly Approach[],
  asker: Asker,
  wind: Wind,
  /** a built approach's glideslope under the clearance asked over the relief (game/ils.ts glideClearance « thin ») */
  thin: (a: Approach) => boolean = () => false,
): Choice | null {
  if (!list.length) return null;
  const windy = wind.spd >= CHOICE.windFrom;
  const table: Scored[] = list.map((a) => {
    const rad = ((wind.from - a.crs) * Math.PI) / 180;
    const head = wind.spd * Math.cos(rad),
      cross = Math.abs(wind.spd * Math.sin(rad));
    const rw = f.runways.find((r) => r.le === a.rwy || r.he === a.rwy);
    const iff = a.final[0]!;
    const g = wgs84Inverse(asker.lat, asker.lon, iff.lat!, iff.lon!);
    const brg = ((((g.az * 180) / Math.PI) % 360) + 360) % 360;
    // (the turn to the IF, then the one onto the final there: what joining it costs, besides its distance)
    const turn = Number.isFinite(asker.track) ? angle(asker.track, brg) : 0;
    const onto = angle(brg, a.crs);
    const pathKm = g.d / 1000 + ((turn + onto) / 180) * 6;
    let out: string | null = null;
    if (rw && rw.len < asker.minLen) out = "short";
    else if (rw && asker.paved && rw.surface !== "paved") out = "surface";
    else if (head < -(asker.tailMax ?? CHOICE.tailMax)) out = "tail wind";
    else if (cross > asker.xwind) out = "cross wind";
    // (a real approach is published clear of its obstacles: only a built one is checked — on the relief known)
    else if (a.source === "built" && thin(a)) out = "relief";
    // (a tight runway paid for: its margin past the craft's least counted up to 300 m — beyond, the way in decides)
    const margin = rw ? Math.min(Math.max(rw.len - asker.minLen, 0), 300) / 30 : 0;
    const score = (windy ? head * 4 : 0) + aidScore(a) + margin - (a.approx ? 5 : 0) - pathKm * 0.6;
    return { a, out, score, head, cross, pathKm, turn };
  });
  const ok = table.filter((s) => !s.out);
  const pick = (ok.length ? ok : table).reduce((b, s) => (s.score > b.score ? s : b));
  return {
    a: pick.a,
    why: {
      wind: windy ? { head: pick.head, cross: pick.cross } : null,
      aid: pick.a.kind === "ILS" ? `ILS${pick.a.loc?.cat ? ` CAT ${pick.a.loc.cat}` : ""}` : pick.a.kind === "VIS" ? "built" : pick.a.kind,
      way: { km: Math.round(pick.pathKm), turn: Math.round(pick.turn) },
    },
    table,
  };
}

/** The airfield: the one named among those given, else the nearest ahead (±60° of the track, within `reach` m), else the nearest. */
export function chooseField(fields: readonly Airfield[], asker: Asker, reach = 150_000): { f: Airfield; ahead: boolean } | null {
  let ahead: { f: Airfield; d: number } | null = null,
    any: { f: Airfield; d: number } | null = null;
  for (const f of fields) {
    const g = wgs84Inverse(asker.lat, asker.lon, f.lat, f.lon);
    if (g.d > reach) continue;
    if (!any || g.d < any.d) any = { f, d: g.d };
    const brg = ((((g.az * 180) / Math.PI) % 360) + 360) % 360;
    if (Number.isFinite(asker.track) && angle(brg, asker.track) <= 60 && (!ahead || g.d < ahead.d)) ahead = { f, d: g.d };
  }
  if (ahead) return { f: ahead.f, ahead: true };
  return any ? { f: any.f, ahead: false } : null;
}
