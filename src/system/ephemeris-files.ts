// The ephemerides' files (scripts/build-ephemeris.ts: DE440 1990 – 2150, JUP365's Galilean moons 1990 –
// 2100) as the page's bundle serves them — absolute, for the planner's worker too (bundled apart: its
// own copies of these imports would not be served).

import deUrl from "../../assets/ephemeris/de440.bin";
import jupUrl from "../../assets/ephemeris/jup365.bin";

/** The files' URLs: DE440 (the planets, the Moon: 3.3 MB) and JUP365 (Jupiter's centre and its Galilean
 *  moons: 7.5 MB, wanted only about Jupiter — the page fetches it after its first image elsewhere). */
export function ephemerisUrls(which: readonly ("de" | "jup")[] = ["de", "jup"]): string[] {
  return which.map((k) => (k === "de" ? deUrl : jupUrl)).map((u) => (typeof location === "undefined" ? u : new URL(u, location.href).href));
}

/** Jupiter and its moons named (a scene's or a save's) — JUP365 then wanted before the scene is placed. */
export const JOVIAN = /"(jupiter|io|europa|ganymede|callisto)"/;
