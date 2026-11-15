// The match's decisions that touch no page (audit 2026-11-10, QA-10: src/ui/netmatch.ts — 1 165 lines — never imported by a test):
// its clock's figure, a pilot's line in the ranking by the match's mode, a point of the Earth brought into the fight's local frame
// about our craft (east, north, up on the WGS84 normal). Moved out of netmatch.ts as they were, tested in tests/netmatch-pure.test.ts.

import type { MatchMode, PilotScore } from "../game/match";
import { t, tf } from "../i18n";
import { geodeticNormal, WGS84_A, WGS84_F } from "../system/ellipsoid";

/** A clock's figure: minutes and seconds, never negative ("2:05"). */
export const fmtClock = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

/** A pilot's line in the ranking: a race's time, a landing's score, the coop's downed, else kills, deaths and hits. */
export function rankingLine(mode: MatchMode, r: PilotScore): string {
  if (mode === "race")
    return r.result === null || !Number.isFinite(r.result)
      ? t("not finished")
      : `${r.result.toFixed(1)} s${r.medal ? ` · ${r.medal}` : ""}`;
  if (mode === "landing") return r.result === null ? t("not landed") : `${Math.round(r.result)}/100${r.medal ? ` · ${r.medal}` : ""}`;
  if (mode === "coop") return tf("{0} downed · {1} hits", r.ai, r.hits);
  return tf("{0} kills · {1} deaths · {2} hits", r.kills, r.deaths, r.hits);
}

/** A point `at` (body-fixed [m]) seen from `from` (body-fixed [m]): its offset east, north, up — up the WGS84 normal at `from`. */
export function enuOffset(from: readonly number[], at: readonly number[]): [number, number, number] {
  const U = geodeticNormal(WGS84_A, WGS84_F, from as [number, number, number]);
  const el = Math.hypot(U[0], U[1]) || 1;
  const E = [-U[1] / el, U[0] / el, 0];
  const N = [U[1] * E[2]! - U[2] * E[1]!, U[2] * E[0]! - U[0] * E[2]!, U[0] * E[1]! - U[1] * E[0]!];
  const d = [at[0]! - from[0]!, at[1]! - from[1]!, at[2]! - from[2]!];
  const dot = (a: number[]) => d[0]! * a[0]! + d[1]! * a[1]! + d[2]! * a[2]!;
  return [dot(E), dot(N), dot(U)];
}
