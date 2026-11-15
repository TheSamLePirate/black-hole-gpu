// What an approach sounds like in the headset (docs/PLAN-APPROCHES.md AP9, §5.7): the localizer's ident in Morse — the pilot
// identifies the aid before flying it — and the marker beacons over which the final passes — the outer (400 Hz, dashes), the
// middle (1 300 Hz, dot-dash), the inner (3 000 Hz, dots), as ICAO Annex 10 keys them. Their places are nav.dat's (its rows 7–9:
// world/approaches.ts `markers`); the ident its localizer's. Pure: the controller says which, the sound engine plays them.

/** International Morse: letters and digits. */
const MORSE: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
};

/** The localizer's ident's tone [Hz] (the 1 020 Hz of a navaid's ident). */
export const IDENT_HZ = 1020;

/**
 * An ident's keying: each element's start and length [s] from its beginning, at `wpm` words a minute (PARIS: a dot 1.2 / wpm s;
 * a dash three dots; one dot between elements, three between letters). Navaids key at about 7 words a minute.
 */
export function morseTimes(ident: string, wpm = 7): { at: number; dur: number }[] {
  const dot = 1.2 / wpm;
  const out: { at: number; dur: number }[] = [];
  let t = 0;
  for (const ch of ident.toUpperCase()) {
    const code = MORSE[ch];
    if (!code) continue;
    for (const e of code) {
      const dur = e === "-" ? 3 * dot : dot;
      out.push({ at: t, dur });
      t += dur + dot;
    }
    t += 2 * dot;
  }
  return out;
}

export type MarkerKind = "O" | "M" | "I";

/** A marker beacon's tone [Hz] and its keying over one period [s]: its elements' starts and lengths (ICAO Annex 10, 3.1.7). */
export const MARKERS: Record<MarkerKind, { hz: number; period: number; keys: { at: number; dur: number }[] }> = {
  // (the outer: two dashes a second)
  O: { hz: 400, period: 0.5, keys: [{ at: 0, dur: 0.375 }] },
  // (the middle: a dot and a dash, some 95 pairs a minute)
  M: {
    hz: 1300,
    period: 0.63,
    keys: [
      { at: 0, dur: 0.083 },
      { at: 0.167, dur: 0.375 },
    ],
  },
  // (the inner: six dots a second)
  I: { hz: 3000, period: 1 / 6, keys: [{ at: 0, dur: 0.083 }] },
};

const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;

/**
 * The marker heard at a place: one whose fan the craft is in — a narrow beam along the course (±40° from the vertical) and a
 * wide one across it (±75°), from the beacon up —; none: null. `p`: [° , °, m over the sea]; `course` the final's [° true];
 * `elev` the beacons' ground [m over the sea] (the threshold's).
 */
export function markerOver(
  markers: readonly { kind: MarkerKind; lat: number; lon: number }[] | undefined,
  p: { lat: number; lon: number; alt: number },
  course: number,
  elev: number,
): MarkerKind | null {
  if (!markers?.length) return null;
  const h = p.alt - elev;
  if (h < 30) return null;
  const c = course * D;
  for (const m of markers) {
    const e = (p.lon - m.lon) * D * R_EARTH * Math.cos(m.lat * D);
    const n = (p.lat - m.lat) * D * R_EARTH;
    const along = e * Math.sin(c) + n * Math.cos(c);
    const across = e * Math.cos(c) - n * Math.sin(c);
    if (Math.abs(along) <= h * Math.tan(40 * D) && Math.abs(across) <= h * Math.tan(75 * D)) return m.kind;
  }
  return null;
}
