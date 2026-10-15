// The carrier qualifications (docs/PLAN-AVIATION-AAA.md, M3): a pilot qualifies on a carrier by its passes graded by
// the LSO — four, by day, by night, in a heavy sea —; the F-35C's traps (catapulted off between them), the F-35B's
// vertical recoveries (a short take-off between them, with its bring-back fuel). Pure: the definitions, a pass's
// points, the grade point average and whether it qualifies.

export type QualId = "day" | "night" | "sea";

/** Each qualification: its passes, its hour (local solar time [h]), the wind's level (2: some 9 m/s), a swell's
 *  height imposed [m] (the heavy sea: the deck pitching and heaving, some 4.5 m). */
export const QUALS: Record<QualId, { name: string; passes: number; hour: number; wind: 0 | 1 | 2 | 3; swell: number | null }> = {
  day: { name: "Day", passes: 4, hour: 14, wind: 1, swell: null },
  night: { name: "Night", passes: 4, hour: 23, wind: 1, swell: null },
  sea: { name: "Heavy sea", passes: 4, hour: 11, wind: 2, swell: 4.4 },
};

/** The F-35B's vertical recovery's grade as points (the F-35C's: game/trap.ts GRADE_POINTS). */
export const VL_POINTS: Record<string, number> = { OK: 4, Fair: 3, "No grade": 2 };

/** The grade point average over the passes and whether it qualifies: 3.0 at least, no pass cut. */
export function qualResult(passes: { grade: string; points: number }[]): { gpa: number; qualified: boolean } {
  const gpa = passes.length ? passes.reduce((s, p) => s + p.points, 0) / passes.length : 0;
  return { gpa, qualified: passes.length > 0 && gpa >= 3 && !passes.some((p) => p.grade === "Cut") };
}

/** The scene's UTC hour for a local solar hour at a longitude [°E]. */
export const utcHourAt = (localHour: number, lon: number) => (((localHour - lon / 15) % 24) + 24) % 24;
