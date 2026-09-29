// The scene's clock seen by the user: real time for the scene's mass, the time warp as a multiple of it,
// its ladder (the keys , . / and the transport bar step along it), and how the clock reads — a date in
// the game's world (the solar system and Gargantua's, 10⁸ M☉), a time in M elsewhere.

import type { Settings } from "./settings";
import { EPOCH_DATE, M_SECONDS } from "./system/solar";

/** Seconds per M = GM/c³ for the scene's mass. */
export const secondsPerM = (s: Pick<Settings, "massSolar">) => 4.925490947e-6 * s.massSolar;
/** The time speed of real time (1 s per s) [M/s]. */
export const realTimeSpeed = (s: Pick<Settings, "massSolar">) => 1 / secondsPerM(s);
/** The time speed as a multiple of real time. */
export const warpFactor = (s: Pick<Settings, "massSolar" | "timeSpeed">) => s.timeSpeed * secondsPerM(s);

/** Above real time, the classic ladder [M/s]; beyond 500 M/s the ship rides on rails (controls.ts). */
const CLASSIC = [0.25, 0.5, 1, 2, 3, 6, 12, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
/** Slow motion and real time's first multiples, below the classic ladder. */
const REAL = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];

/** The warp ladder [M/s], slowest first. */
export function warpLadder(s: Pick<Settings, "massSolar">): number[] {
  const rt = realTimeSpeed(s);
  return [...REAL.map((k) => k * rt).filter((w) => w < 0.9 * CLASSIC[0]!), ...CLASSIC];
}

/** The next time speed along the ladder (dir: +1 faster, −1 slower), from the current one. */
export function stepWarp(s: Pick<Settings, "massSolar" | "timeSpeed">, dir: 1 | -1): number {
  const list = warpLadder(s);
  const i = list.findIndex((w) => w >= s.timeSpeed * (1 - 1e-6));
  const at = i < 0 ? list.length - 1 : i;
  // (between two rungs: the next one in that direction)
  const exact = i >= 0 && Math.abs(list[i]! - s.timeSpeed) <= 1e-6 * s.timeSpeed;
  const j = dir > 0 ? (exact ? at + 1 : at) : at - 1;
  return list[Math.max(0, Math.min(list.length - 1, j))]!;
}

/** A multiple as a short label: ×1, ×2.5, ×250, ×12k, ×3.2M. */
export function fmtFactor(x: number): string {
  if (!(x > 0)) return "×0";
  const r = (v: number) => (v >= 100 ? Math.round(v).toString() : v >= 10 ? v.toFixed(0) : +v.toPrecision(2) + "");
  if (x >= 1e9) return `×${r(x / 1e9)}G`;
  if (x >= 1e6) return `×${r(x / 1e6)}M`;
  if (x >= 1e4) return `×${r(x / 1e3)}k`;
  return `×${r(x)}`;
}

/** The warp as the user reads it: "×1 real time", "×2.5k", "Paused". */
export function fmtWarp(s: Pick<Settings, "massSolar" | "timeSpeed" | "animate">, withPause = true): string {
  if (withPause && !s.animate) return "Paused";
  const x = warpFactor(s);
  return Math.abs(x - 1) < 1e-6 ? "×1 real time" : fmtFactor(x);
}

/** A duration [s] in its largest units: 42 s, 3 min 20 s, 5 h 12 min, 12 d 4 h, 3.2 yr. */
export function fmtSeconds(sec: number): string {
  const a = Math.abs(sec), sg = sec < 0 ? "−" : "";
  if (a < 60) return `${sg}${a < 10 ? a.toFixed(1) : a.toFixed(0)} s`;
  if (a < 3600) return `${sg}${Math.floor(a / 60)} min ${Math.floor(a % 60)} s`;
  if (a < 86400) return `${sg}${Math.floor(a / 3600)} h ${Math.floor((a % 3600) / 60)} min`;
  if (a < 365.25 * 86400) return `${sg}${Math.floor(a / 86400)} d ${Math.floor((a % 86400) / 3600)} h`;
  return `${sg}${(a / (365.25 * 86400)).toPrecision(3)} yr`;
}

/** The game's world: the scene's time is a date (solar.ts: EPOCH_DATE at t = 0, M_SECONDS per M). */
export const hasCalendar = (s: Pick<Settings, "system" | "massSolar">) => s.system === "gargantua" && Math.abs(s.massSolar - 1e8) < 1;

/** The clock's reading: the date and time (UTC) in the game's world, else the time in M and its duration. */
export function fmtClock(s: Pick<Settings, "system" | "massSolar">, t: number): { main: string; sub: string } {
  if (hasCalendar(s)) {
    const d = new Date(EPOCH_DATE + t * M_SECONDS * 1e3);
    const iso = Number.isFinite(d.getTime()) ? d.toISOString() : "";
    return { main: iso.slice(11, 19), sub: `${iso.slice(0, 10)} UTC` };
  }
  return { main: `t = ${t.toFixed(t < 1e4 ? 1 : 0)} M`, sub: fmtSeconds(t * secondsPerM(s)) };
}
