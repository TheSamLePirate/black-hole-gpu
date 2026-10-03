// "Now" on the calendar, for the scenes placed at the real time (the space station, the fleet): the
// wall's date, unless a test fixes it — a scene of "now" then flies the same flight every run.

let fixed: number | null = null;

/** the date now [ms since 1970] */
export const dateNow = () => fixed ?? Date.now();

/** Fixes "now" (tests, golden flights), or frees it (null). */
export function setDateNow(ms: number | null) {
  fixed = ms;
}
