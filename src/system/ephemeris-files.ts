// The ephemerides' files (scripts/build-ephemeris.ts: DE440 1990 – 2150, JUP365's Galilean moons 2040 –
// 2100) as the page's bundle serves them — absolute, for the planner's worker too (bundled apart: its
// own copies of these imports would not be served).

import deUrl from "../../assets/ephemeris/de440.bin";
import jupUrl from "../../assets/ephemeris/jup365.bin";

export function ephemerisUrls(): string[] {
  return [deUrl, jupUrl].map((u) => (typeof location === "undefined" ? u : new URL(u, location.href).href));
}
