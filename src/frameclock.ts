// The flight's own clock for its caches and rhythms [ms]: it advances by the wall's time each frame of
// the loop — the same as performance.now() while playing — and by the step when the flight is stepped
// (__bh.step, the tests, a fixed-step loop). The flight's decisions that waited "100 ms" or "a second"
// on the wall then wait as long in the flight's time, however fast or slow the machine steps it: the
// same flight on every machine. (The interface's own animations keep the wall: ui/clock.ts.)

let now = typeof performance !== "undefined" ? performance.now() : 0;

/** the flight's clock now [ms] */
export const frameNow = () => now;

/** Advances it (the loop: the wall's frame time; a step: its length) [ms]. */
export function advanceFrameClock(ms: number) {
  if (ms > 0 && Number.isFinite(ms)) now += ms;
}
