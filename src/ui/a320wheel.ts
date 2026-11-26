// The A320's wheel (docs/PLAN-A320-VOL-AAA.md W1; Sam, 26 Nov 2026: « un mode A320 à la roue (Tab maintenue) avec toutes les
// assistances, réglages d'instruments et modes faciles ; tout doit marcher avec les vrais appareils de l'A320 »). Before it the A320
// was shown the spacecraft's wheel (SAS, orbits…). Every item does what a control of the deck does — FlightGear's own call through
// deckgame.ts deckCall (the FCU's knobs pushed, pulled, turned; its buttons; the EFIS' ND mode and range; the baro's STD) — or what
// the A320's levers do (the gear, the flap lever, the speed brake, the autobrake, the reversers, the parking brake): the FCU's windows,
// the FMA and the deck show it as if pressed there. Pure: the state and the actions in, the items out (ui/wheel.ts draws them).

import type { WheelItem } from "./wheel";

/** What the wheel reads of the A320 now. */
export interface A320WheelState {
  ap: boolean;
  athr: boolean;
  fd: boolean;
  loc: boolean;
  appr: boolean;
  exped: boolean;
  /** the FMA's modes (vertical, lateral), the FCU's windows and whether managed */
  vert: string;
  lat: string;
  spd: number;
  spdManaged: boolean;
  hdg: number;
  alt: number;
  vs: number;
  /** the ALT knob's step [ft]: 100 or 1 000 (its 100/1000 switch) */
  altStep: number;
  /** the flap lever's notch 0…4 (4: FULL), the gear down, the speed brake 0…1, the ground spoilers armed */
  flapLever: number;
  gearDown: boolean;
  speedBrake: number;
  spoilersArmed: boolean;
  /** 0 off, 1 LO, 2 MED, 3 MAX; the reversers out; the parking brake set */
  autobrake: number;
  reverse: boolean;
  park: boolean;
  /** the ND's mode and range [NM], the baro on STD */
  ndMode: string;
  ndRange: number;
  std: boolean;
  /** on the wheels; the easy take-off under way; the assistance level */
  onGround: boolean;
  easyTakeoff: boolean;
  assist: "realistic" | "assisted";
  /** the approach's sector (ui/approach-wheel.ts — the F-35's and the A320's) */
  approach: WheelItem | null;
  /** a flight plan to fly (NAV) */
  route: boolean;
}

/** What its items do (main.ts's). */
export interface A320WheelActions {
  /** a FlightGear call of the deck's, as its control makes it (deckgame.ts deckCall) */
  nasal(fn: string, ...args: (number | string)[]): void;
  /** the FCU's EXPED button (no call of FlightGear's the deck routes: the FMGC's own) */
  exped(): void;
  gear(): void;
  flapLever(notch: number): void;
  speedBrake(v: number): void;
  spoilersArm(): void;
  autobrake(k: number): void;
  reverse(): void;
  park(): void;
  nav(): void;
  easyTakeoff(): void;
  assist(level: "realistic" | "assisted"): void;
  nextView(): void;
}

const pad3 = (n: number) => String(Math.round(n)).padStart(3, "0");
const both = (s: string) => ({ fr: s, en: s });

/** A knob's sub-wheel: turned by the steps given, pushed (managed), pulled (selected) — FlightGear's FCU calls. */
function knob(
  A: A320WheelActions,
  name: "SPD" | "HDG" | "ALT" | "VS",
  label: { fr: string; en: string },
  steps: [number, string][],
  push: { fr: string; en: string },
  pull: { fr: string; en: string },
  on: boolean,
): WheelItem {
  return {
    label,
    on,
    sub: [
      ...steps.map(([n, l]) => ({ label: both(l), run: () => A.nasal(`fcu.FCUController.${name}Adjust`, n) })),
      {
        label: pull,
        hint: { fr: "Tirer le bouton : sélecté", en: "The knob pulled: selected" },
        run: () => A.nasal(`fcu.FCUController.${name}Pull`),
      },
      {
        label: push,
        hint: { fr: "Pousser le bouton : géré", en: "The knob pushed: managed" },
        run: () => A.nasal(`fcu.FCUController.${name}Push`),
      },
    ],
  };
}

/** The wheel of the A320. */
export function a320Wheel(S: A320WheelState, A: A320WheelActions): WheelItem[] {
  const FLAPS = ["0", "1", "2", "3", "FULL"];
  const AB = ["OFF", "LO", "MED", "MAX"];
  const items: WheelItem[] = [
    {
      label: { fr: "Pilote auto", en: "Autopilot" },
      on: S.ap,
      sub: [
        { label: both("AP1"), key: "'", on: S.ap, run: () => A.nasal("fcu.FCUController.AP1") },
        { label: both("A/THR"), key: "⇧'", on: S.athr, run: () => A.nasal("fcu.FCUController.ATHR") },
        { label: both("FD"), on: S.fd, run: () => (A.nasal("fcu.FCUController.FD1"), A.nasal("fcu.FCUController.FD2")) },
        { label: both("LOC"), on: S.loc, run: () => A.nasal("fcu.FCUController.LOCButton") },
        { label: both("APPR"), on: S.appr, run: () => A.nasal("fcu.FCUController.APPRButton") },
        { label: both("EXPED"), on: S.exped, run: () => A.exped() },
        ...(S.route
          ? [{ label: { fr: "NAV (plan de vol)", en: "NAV (flight plan)" }, key: "⇧M", on: S.lat === "NAV", run: () => A.nav() }]
          : []),
      ],
    },
    {
      label: { fr: "FCU", en: "FCU" },
      hint: {
        fr: `${S.spdManaged ? "SPD géré" : `SPD ${S.spd}`} · HDG ${pad3(S.hdg)} · ALT ${S.alt} · V/S ${S.vs}`,
        en: `${S.spdManaged ? "SPD managed" : `SPD ${S.spd}`} · HDG ${pad3(S.hdg)} · ALT ${S.alt} · V/S ${S.vs}`,
      },
      sub: [
        knob(
          A,
          "SPD",
          { fr: `Vitesse ${S.spdManaged ? "(gérée)" : S.spd}`, en: `Speed ${S.spdManaged ? "(managed)" : S.spd}` },
          [
            [10, "+10 kt"],
            [-10, "−10 kt"],
          ],
          { fr: "Gérée", en: "Managed" },
          { fr: "Sélectée", en: "Selected" },
          !S.spdManaged,
        ),
        knob(
          A,
          "HDG",
          { fr: `Cap ${pad3(S.hdg)}`, en: `Heading ${pad3(S.hdg)}` },
          [
            [10, "+10°"],
            [-10, "−10°"],
            [90, "+90°"],
            [-90, "−90°"],
          ],
          { fr: "NAV", en: "NAV" },
          { fr: "Cap sélecté", en: "Heading selected" },
          S.lat === "HDG" || S.lat === "TRK",
        ),
        knob(
          A,
          "ALT",
          { fr: `Altitude ${S.alt}`, en: `Altitude ${S.alt}` },
          S.altStep >= 1000
            ? [
                [1, "+1000 ft"],
                [-1, "−1000 ft"],
                [5, "+5000 ft"],
                [-5, "−5000 ft"],
              ]
            : [
                [10, "+1000 ft"],
                [-10, "−1000 ft"],
                [1, "+100 ft"],
                [-1, "−100 ft"],
              ],
          { fr: "Montée/descente gérée", en: "Managed climb/descent" },
          { fr: "OP CLB / OP DES", en: "OP CLB / OP DES" },
          /OP |EXP /.test(S.vert),
        ),
        knob(
          A,
          "VS",
          { fr: `V/S ${S.vs}`, en: `V/S ${S.vs}` },
          [
            [5, "+500"],
            [-5, "−500"],
          ],
          { fr: "Palier (V/S 0)", en: "Level off (V/S 0)" },
          { fr: "V/S sélecté", en: "V/S selected" },
          S.vert === "V/S" || S.vert === "FPA",
        ),
      ],
    },
    {
      label: { fr: "Configuration", en: "Configuration" },
      hint: {
        fr: `Volets ${FLAPS[S.flapLever]} · train ${S.gearDown ? "sorti" : "rentré"} · autofrein ${AB[S.autobrake]}`,
        en: `Flaps ${FLAPS[S.flapLever]} · gear ${S.gearDown ? "down" : "up"} · autobrake ${AB[S.autobrake]}`,
      },
      sub: [
        { label: { fr: "Train", en: "Gear" }, key: "G", on: S.gearDown, run: () => A.gear() },
        {
          label: { fr: `Volets ${FLAPS[S.flapLever]}`, en: `Flaps ${FLAPS[S.flapLever]}` },
          on: S.flapLever > 0,
          sub: FLAPS.map((f, k) => ({ label: both(k === 1 && S.onGround ? "1+F" : f), on: S.flapLever === k, run: () => A.flapLever(k) })),
        },
        {
          label: { fr: "Aérofreins", en: "Speed brake" },
          on: S.speedBrake > 0,
          sub: [
            { label: { fr: "Rentrés", en: "Retracted" }, on: S.speedBrake === 0, run: () => A.speedBrake(0) },
            { label: { fr: "Moitié", en: "Half" }, on: S.speedBrake > 0 && S.speedBrake < 1, run: () => A.speedBrake(0.5) },
            { label: { fr: "Pleins", en: "Full" }, on: S.speedBrake >= 1, run: () => A.speedBrake(1) },
            { label: { fr: "Armer les spoilers sol", en: "Arm the ground spoilers" }, on: S.spoilersArmed, run: () => A.spoilersArm() },
          ],
        },
        {
          label: { fr: `Autofrein ${AB[S.autobrake]}`, en: `Autobrake ${AB[S.autobrake]}` },
          key: "⇧B",
          on: S.autobrake > 0,
          sub: [1, 2, 3].map((k) => ({ label: both(AB[k]!), on: S.autobrake === k, run: () => A.autobrake(k) })),
        },
        { label: { fr: "Inverseurs", en: "Reversers" }, key: "⇧Z", on: S.reverse, run: () => A.reverse() },
        { label: { fr: "Frein de parc", en: "Parking brake" }, on: S.park, run: () => A.park() },
      ],
    },
    ...(S.approach ? [S.approach] : []),
    {
      label: { fr: "Instruments", en: "Instruments" },
      hint: {
        fr: `ND ${S.ndMode} ${S.ndRange} NM · ${S.std ? "STD" : "QNH"}`,
        en: `ND ${S.ndMode} ${S.ndRange} NM · ${S.std ? "STD" : "QNH"}`,
      },
      sub: [
        { label: { fr: "ND : mode suivant", en: "ND: next mode" }, run: () => A.nasal("fcu.setCptND", 1) },
        { label: { fr: "ND : mode précédent", en: "ND: previous mode" }, run: () => A.nasal("fcu.setCptND", -1) },
        { label: { fr: "ND : échelle ×2", en: "ND: range ×2" }, run: () => A.nasal("fcu.setNDRange", 0, 1) },
        { label: { fr: "ND : échelle ÷2", en: "ND: range ÷2" }, run: () => A.nasal("fcu.setNDRange", 0, -1) },
        { label: { fr: "Baro STD / QNH", en: "Baro STD / QNH" }, on: S.std, run: () => A.nasal("core.toggleSTD") },
      ],
    },
    {
      label: { fr: "Décollage facile", en: "Easy take-off" },
      on: S.easyTakeoff,
      hint: {
        fr: "Aligné : CONF 1+F, TOGA, rotation à VR, train, AP1, CL à 1 500 ft, volets rentrés",
        en: "Lined up: CONF 1+F, TOGA, rotation at VR, gear, AP1, CL at 1,500 ft, flaps up",
      },
      run: () => A.easyTakeoff(),
    },
    {
      label: { fr: "Assistance", en: "Assistance" },
      hint: S.assist === "assisted" ? { fr: "Assisté", en: "Assisted" } : { fr: "Réaliste", en: "Realistic" },
      sub: [
        {
          label: { fr: "Réaliste", en: "Realistic" },
          on: S.assist === "realistic",
          hint: { fr: "Rien n'est fait à la place de l'équipage", en: "Nothing done for the crew" },
          run: () => A.assist("realistic"),
        },
        {
          label: { fr: "Assisté", en: "Assisted" },
          on: S.assist === "assisted",
          hint: { fr: "Train, volets, manettes, AP1, spoilers à leur moment", en: "Gear, flaps, levers, AP1, spoilers at their moment" },
          run: () => A.assist("assisted"),
        },
      ],
    },
    { label: { fr: "Vue", en: "View" }, key: "V", run: () => A.nextView() },
  ];
  return items;
}
