// The formations (docs/PLAN-AVIATION-AAA.md, F1): a flight of two to four, each place numbered — the leader 1,
// his wingman 2, the element's leader 3, his wingman 4 — and each a slot in the leader's frame (to his right,
// behind him, above him [m]) the formation law flies (game/formation.ts). Close ones (echelons, fingertip, vic,
// diamond) a wingspan and a margin apart; tactical ones (line abreast, trail, combat spread) far enough to look
// after each other. Three spacings: tight, normal, wide. Pure.

import type { FormSlot } from "./formation";

export type FormationId = "echelonR" | "echelonL" | "fingertip" | "vic" | "diamond" | "line" | "trail" | "spread";
export type Spacing = "tight" | "normal" | "wide";

export const FORMATION_IDS: FormationId[] = ["echelonR", "echelonL", "fingertip", "vic", "diamond", "line", "trail", "spread"];
export const SPACINGS: Spacing[] = ["tight", "normal", "wide"];

/** Each formation: its names, close or tactical, its places 2, 3, 4 at the normal spacing (right, back, up [m]). */
export const FORMATIONS: Record<FormationId, { fr: string; en: string; close: boolean; slots: [FormSlot, FormSlot, FormSlot] }> = {
  // (each a step back and out to one side: 26 m across — two F-35s' half spans and 15 m —, 15 m back)
  echelonR: {
    fr: "Échelon droite",
    en: "Echelon right",
    close: true,
    slots: [
      { right: 26, back: 15, up: 0 },
      { right: 52, back: 30, up: 0 },
      { right: 78, back: 45, up: 0 },
    ],
  },
  echelonL: {
    fr: "Échelon gauche",
    en: "Echelon left",
    close: true,
    slots: [
      { right: -26, back: 15, up: 0 },
      { right: -52, back: 30, up: 0 },
      { right: -78, back: 45, up: 0 },
    ],
  },
  // (the finger-four: 2 off the leader's left, the element 3 off his right, 4 outside 3)
  fingertip: {
    fr: "Fingertip",
    en: "Fingertip",
    close: true,
    slots: [
      { right: -26, back: 15, up: 0 },
      { right: 26, back: 15, up: 0 },
      { right: 52, back: 30, up: 0 },
    ],
  },
  // (the vic: 2 and 3 a step back on each side, 4 in the slot behind the leader, below his wake)
  vic: {
    fr: "Triangle",
    en: "Vic",
    close: true,
    slots: [
      { right: -26, back: 15, up: 0 },
      { right: 26, back: 15, up: 0 },
      { right: 0, back: 60, up: -8 },
    ],
  },
  // (the diamond: 2 left, 3 right, 4 in the slot — behind the leader, under his tail, closer than the vic's)
  diamond: {
    fr: "Losange",
    en: "Diamond",
    close: true,
    slots: [
      { right: -26, back: 15, up: 0 },
      { right: 26, back: 15, up: 0 },
      { right: 0, back: 32, up: -6 },
    ],
  },
  // (line abreast: each 300 m out, alternately right and left — eyes on each other's six)
  line: {
    fr: "Ligne de front",
    en: "Line abreast",
    close: false,
    slots: [
      { right: 300, back: 0, up: 0 },
      { right: -300, back: 0, up: 0 },
      { right: 600, back: 0, up: 0 },
    ],
  },
  // (trail: each behind the one before, a little below its wake)
  trail: {
    fr: "Colonne",
    en: "Trail",
    close: false,
    slots: [
      { right: 0, back: 250, up: -15 },
      { right: 0, back: 500, up: -30 },
      { right: 0, back: 750, up: -45 },
    ],
  },
  // (combat spread: the element abreast 1.5 km out, a little back and stepped up; each wingman off its leader)
  spread: {
    fr: "Patrouille étalée",
    en: "Combat spread",
    close: false,
    slots: [
      { right: 1500, back: 200, up: 150 },
      { right: -1500, back: 200, up: 150 },
      { right: 1500, back: 600, up: 300 },
    ],
  },
};

/** The spacings' factors on the normal slots: close formations, tactical ones. */
const FACTOR: Record<Spacing, { close: number; far: number }> = {
  tight: { close: 0.75, far: 0.5 },
  normal: { close: 1, far: 1 },
  wide: { close: 1.6, far: 2 },
};

/** the least distance kept between any two places [m] (two F-35s' wingspans: 10.7 m) and its margin */
export const CLEAR = 12;

/** The slot of place `pos` (2…4) in a formation at a spacing, in the leader's frame. */
export function formationSlot(id: FormationId, pos: number, spacing: Spacing = "normal"): FormSlot {
  const F = FORMATIONS[id];
  const s = F.slots[Math.min(Math.max(Math.round(pos), 2), 4) - 2]!;
  const k = F.close ? FACTOR[spacing].close : FACTOR[spacing].far;
  return { right: s.right * k, back: s.back * k, up: s.up * k };
}

/** The formation's name in a language. */
export const formationName = (id: FormationId, lang: "fr" | "en" = "en") => FORMATIONS[id][lang];

/** The next spacing tighter (−1) or wider (+1), kept at the ends. */
export function spacingStep(s: Spacing, d: -1 | 1): Spacing {
  return SPACINGS[Math.min(Math.max(SPACINGS.indexOf(s) + d, 0), SPACINGS.length - 1)]!;
}
