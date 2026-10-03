// The interface's clock: the wall clock, unless a test fixes it (the HUD's blinks drawn the same way
// every run). One rhythm for every blink — 2 Hz, under the 3 Hz that photosensitivity guidance sets.

let fixed: number | null = null;

/** now [ms] for the interface's animations */
export const uiNow = () => fixed ?? performance.now();

/** Fixes the interface's clock (tests), or frees it (null). */
export function setUiClock(ms: number | null) {
  fixed = ms;
}

/** a blink's lit half: true for 250 ms, false for 250 ms */
let steady = false;
/** No blinking (Settings › Accessibility › Reduce motion, or the system's own): what blinks stays lit. */
export const setSteady = (on: boolean) => {
  steady = on;
};
export const blinkOn = () => steady || Math.floor(uiNow() / 250) % 2 === 0;
