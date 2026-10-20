// The space flight school (PLAN-VAISSEAUX X9): fifteen lessons for the Ranger, the Lander and the Endurance, each a
// set-up (a scene, an orbit, a ground, a station), its steps — TARS's first, said and flown by the autopilot, then the
// pilot's, watched — and its end. A step is done when what it asks holds (a hold aligned, an orbit reached, docked,
// landed, a failure fixed…) for a moment, or after its time at most (the guard: a lesson never stalls). Three ways to
// take one: guided (TARS, then you), demonstration (TARS flies your steps too — their `auto`), try (your steps
// alone). Pure: the controller feeds the figures, the steps' changes come out. Its words English, translated by t().

export type SpaceLessonId =
  | "attitude"
  | "holds"
  | "orbit-basics"
  | "hohmann"
  | "plane"
  | "rendezvous"
  | "docking"
  | "entry"
  | "glide"
  | "lunar-descent"
  | "ascent"
  | "endurance-dock"
  | "slingshot"
  | "relativity"
  | "emergencies";

/** What the controller does at a step's start (TARS's steps, a demonstration's). */
export type SpaceAct =
  | { sas: boolean }
  | { hold: string }
  | { auto: string }
  | { rcs: "rotate" | "translate" }
  | { fail: string }
  | { fix: string }
  | { maneuver: { op: string; altKm?: number; incDeg?: number; where?: "now" | "pe" | "ap" } }
  | { mission: { target: string; arrival: "orbit" | "flyby" } }
  | { execute: true }
  | { launchGoal: { altKm: number; incDeg: number | null } }
  | { spin: [number, number, number] }
  | { recover: true }
  | { warp: number };

/** What the controller sees each frame (the lesson's figures). */
export interface SpaceFix {
  /** the step's seconds */
  stepT: number;
  /** the orbit about the body of the sphere: its heights [km], eccentricity, inclination [°] (null: none) */
  pe: number | null;
  ap: number | null;
  ecc: number | null;
  inc: number | null;
  /** the hold set, and the nose within 5° of its direction */
  hold: string;
  holdOk: boolean;
  sas: boolean;
  rcs: string;
  auto: string;
  docked: boolean;
  landed: boolean;
  /** the target's distance [m] (null: none) */
  targetM: number | null;
  nodes: number;
  failures: number;
  /** the craft's turn rate [°/s], the nose's turn since the step began [°], the speed changed since then [m/s] */
  rate: number;
  turn: number;
  dv: number;
  lpdMoved: boolean;
  /** the next event of the free path ("enter", "exit", "impact"…; "" none) */
  next: string;
  /** where over its body [°] and how high [km] (null: none — the hole's side), the load felt [g] (the challenges') */
  lat?: number | null;
  lon?: number | null;
  altKm?: number | null;
  g?: number;
  /** the side of the wormhole ("ours", "gargantua", "throat"), the radius from Gargantua [M] (null: ours), the
   *  Endurance's ring [rpm] (null: none) — the missions' (X11) */
  side?: string;
  kerrR?: number | null;
  ringRpm?: number | null;
  /** the body of the sphere the craft is in */
  soi?: string;
}

export type SpaceDone =
  | { time: number }
  | { holdOk: string }
  | { hold: string }
  | { sas: boolean }
  | { rcs: "rotate" | "translate" }
  | { auto: string }
  | { rateBelow: number }
  | { turnAbove: number }
  | { dvAbove: number }
  | { apAbove: number }
  | { apBelow: number }
  | { peAbove: number }
  | { peBelow: number }
  | { circular: number; peAbove?: number }
  | { incNear: number; tol: number }
  | { docked: true }
  | { landed: true }
  | { targetBelow: number }
  | { nodes: number }
  | { fixed: true }
  | { lpdMoved: true }
  | { next: string }
  | { side: string }
  | { kerrBelow: number }
  | { kerrAbove: number }
  | { ringAbove: number }
  | { altBelow: number }
  | { altAbove: number }
  | { soi: string };

export interface SpaceStep {
  who: "tars" | "you";
  name: string;
  say: string;
  act?: SpaceAct[];
  done: SpaceDone;
  /** how long it must hold [s] (default 1.5; a time: none) */
  hold?: number;
  /** at most [s]: then on anyway (the guard) */
  max?: number;
  /** a pilot's step flown by TARS in a demonstration: his acts, his words */
  auto?: SpaceAct[];
  demoSay?: string;
}

/** Where a lesson begins: a scene, an orbit, a ground, a hover, the ISS at a distance, a target, a craft. */
export interface SpaceStart {
  vessel: "ranger" | "lander" | "endurance";
  preset?: string;
  orbit?: { body: string; altKm: number; inc?: number };
  land?: { body: string; lat: number; lon: number };
  hover?: { body: string; lat: number; lon: number; altKm: number };
  /** the ISS this far [m] (its docking scene) */
  iss?: number;
  /** beside a body at rest (ours or Gargantua's: its height [km], or its radius from the hole [M]); before the
   *  wormhole's mouth (the missions' — X11) */
  near?: { body: string; altKm?: number; rM?: number };
  wormhole?: "ours" | "gargantua";
  target?: string;
  /** a flight saved (a mission made where one flew — X11's editor): loaded first */
  save?: import("./save").GameSave;
}

export interface SpaceLesson {
  id: SpaceLessonId;
  title: string;
  summary: string;
  start: SpaceStart;
  steps: SpaceStep[];
  end: string;
}

const LEO: SpaceStart = { vessel: "ranger", orbit: { body: "earth", altKm: 400, inc: 51.6 } };
const TRANQ = { body: "moon", lat: 0.674, lon: 23.473 };

export const SPACE_LESSONS: SpaceLesson[] = [
  {
    id: "attitude",
    title: "Attitude and the RCS",
    summary: "The craft turned by its thrusters, a turn stopped, the RCS's translation: the first hour in orbit.",
    start: LEO,
    steps: [
      {
        who: "tars",
        name: "The SAS off",
        say: "In orbit nothing stops a turn: I switch the SAS off and give us a slow tumble.",
        act: [{ sas: false }, { spin: [0.04, 0.06, 0.02] }],
        done: { time: 6 },
      },
      {
        who: "tars",
        name: "The tumble stopped",
        say: "⇧X: the turn stopped, the craft steady again.",
        act: [{ recover: true }],
        done: { rateBelow: 0.3 },
        max: 30,
      },
      {
        who: "you",
        name: "Turn the nose 90°",
        say: "Your controls. Turn the nose ninety degrees — the arrows or the stick —, then stop it.",
        done: { turnAbove: 85 },
        max: 120,
        auto: [{ hold: "radialOut" }],
        demoSay: "I turn the nose to radial out: ninety degrees from prograde.",
      },
      {
        who: "you",
        name: "Stop the turn",
        say: "Now stop the turn: under half a degree a second.",
        done: { rateBelow: 0.5 },
        max: 60,
        auto: [{ sas: true }],
      },
      {
        who: "you",
        name: "The RCS in translation",
        say: "⇧9: the RCS in translation — the attitude keys now move the craft. Push it up for two seconds.",
        done: { dvAbove: 0.15 },
        max: 90,
        auto: [{ rcs: "translate" }],
        demoSay: "⇧9: translation. W pushes the craft up, without turning it.",
      },
    ],
    end: "That is the RCS: turns, stops, translations. Next: the holds.",
  },
  {
    id: "holds",
    title: "The holds and the SAS",
    summary: "Prograde, retrograde, normal: the flight computer points the craft and keeps it there.",
    start: LEO,
    steps: [
      { who: "tars", name: "The SAS", say: "T: the SAS on — the craft held where it points.", act: [{ sas: true }], done: { time: 4 } },
      {
        who: "tars",
        name: "Prograde",
        say: "1: prograde — the nose along our velocity, the yellow marker in the middle.",
        act: [{ hold: "prograde" }],
        done: { holdOk: "prograde" },
        max: 60,
      },
      {
        who: "you",
        name: "Retrograde",
        say: "Your turn: hold retrograde — key 2.",
        done: { holdOk: "retrograde" },
        max: 120,
        auto: [{ hold: "retrograde" }],
      },
      {
        who: "you",
        name: "Hold normal",
        say: "Now normal — key 5: the magenta triangle, square to the orbit's plane.",
        done: { holdOk: "normal" },
        max: 120,
        auto: [{ hold: "normal" }],
      },
      {
        who: "you",
        name: "Let go",
        say: "Backspace: the hold let go, the SAS keeps the attitude.",
        done: { hold: "none" },
        max: 60,
        auto: [{ hold: "none" }],
      },
    ],
    end: "Holds learnt: they are the start of every burn.",
  },
  {
    id: "orbit-basics",
    title: "Orbital basics: up and down",
    summary: "A prograde burn raises the far side of the orbit, a retrograde one lowers it.",
    start: LEO,
    steps: [
      {
        who: "tars",
        name: "What a burn does",
        say: "Burned prograde here, the orbit rises on the other side — its apoapsis. Watch the Ap on the HUD.",
        act: [{ hold: "prograde" }],
        done: { holdOk: "prograde" },
        max: 60,
      },
      {
        who: "you",
        name: "Raise the apoapsis to 600 km",
        say: "Your controls: prograde, throttle up — Shift —, cut at an apoapsis of 600 km.",
        done: { apAbove: 590 },
        max: 400,
        auto: [{ maneuver: { op: "apoapsis", altKm: 600, where: "now" } }, { execute: true }],
        demoSay: "A burn planned to put the apoapsis at 600 km, flown by the node autopilot.",
      },
      {
        who: "you",
        name: "Bring it back under 450 km",
        say: "Now retrograde: lower the apoapsis under 450 km.",
        done: { apBelow: 450 },
        max: 400,
        auto: [{ maneuver: { op: "apoapsis", altKm: 420, where: "now" } }, { execute: true }],
      },
    ],
    end: "Prograde up, retrograde down — on the far side. That is all of orbital flight.",
  },
  {
    id: "hohmann",
    title: "Circularize and the Hohmann transfer",
    summary: "From 400 to 800 km in two burns: the transfer, then the circle at its top.",
    start: LEO,
    steps: [
      {
        who: "tars",
        name: "The transfer burn",
        say: "The Hohmann transfer: I plan the first burn to put the apoapsis at 800 km, and fly it.",
        act: [{ maneuver: { op: "apoapsis", altKm: 800, where: "now" } }, { execute: true }],
        done: { apAbove: 790 },
        max: 400,
      },
      {
        who: "you",
        name: "Circularize at the top",
        say: "Your part: at the apoapsis, circularize — key 9, or the CIRC button.",
        done: { circular: 0.004, peAbove: 770 },
        hold: 3,
        max: 4000,
        auto: [{ auto: "circularize" }, { warp: 20 }],
        demoSay: "CIRC: the autopilot burns at the apoapsis and stops on the circle.",
      },
    ],
    end: "Two burns, the cheapest way between two circles.",
  },
  {
    id: "plane",
    title: "The plane change",
    summary: "Tilting the orbit at a node: from 51.6° to 45°.",
    start: LEO,
    steps: [
      {
        who: "tars",
        name: "Where to burn",
        say: "A plane changes at a node, where the orbit crosses the plane wanted; normal or anti-normal.",
        act: [{ hold: "normal" }],
        done: { time: 6 },
      },
      {
        who: "you",
        name: "To 45°",
        say: "Plan the plane change to 45° — the map, ORBIT, Inclination — and execute it.",
        done: { incNear: 45, tol: 0.6 },
        max: 6000,
        auto: [{ maneuver: { op: "inclination", incDeg: 45 } }, { execute: true }, { warp: 20 }],
        demoSay: "The burn planned at the next node, flown: 6.6 degrees for about 880 m/s.",
      },
    ],
    end: "Plane changes are dear at orbital speed: plan them high and slow when you can.",
  },
  {
    id: "rendezvous",
    title: "The rendezvous",
    summary: "From 20 km behind the ISS to within a kilometre: the phasing, the approach.",
    start: { vessel: "ranger", preset: "Earth: docking to the ISS", iss: 20_000, target: "iss" },
    steps: [
      {
        who: "tars",
        name: "The target",
        say: "The ISS twenty kilometres ahead. Up close, mechanics turn odd: thrust toward it and you climb and fall behind.",
        done: { time: 8 },
      },
      {
        who: "you",
        name: "Within a kilometre",
        say: "Your part: B — the rendezvous planned and flown —, or by hand. Within a kilometre of the station.",
        done: { targetBelow: 1000 },
        max: 6000,
        auto: [{ auto: "dock" }],
        demoSay: "B: the rendezvous planned and flown by the docking autopilot.",
      },
    ],
    end: "The station reached. Next: docking.",
  },
  {
    id: "docking",
    title: "Docking by hand (six degrees of freedom)",
    summary: "The ISS 60 m off: the axes aligned, the drift killed, closing at 0.1 m/s.",
    start: { vessel: "ranger", preset: "Earth: docking to the ISS", iss: 60, target: "iss" },
    steps: [
      {
        who: "tars",
        name: "The COAS",
        say: "The reticle: a cross on our port's axis, the station's port a circle — green under one degree.",
        act: [{ sas: true }],
        done: { time: 8 },
      },
      {
        who: "you",
        name: "Translation",
        say: "⇧9: the RCS in translation.",
        done: { rcs: "translate" },
        max: 60,
        auto: [{ rcs: "translate" }],
      },
      {
        who: "you",
        name: "Docked",
        say: "Align, kill the drift, close at a tenth of a metre a second. Dock.",
        done: { docked: true },
        max: 900,
        auto: [{ rcs: "rotate" }, { auto: "dock" }],
        demoSay: "The docking autopilot: Waypoint 2, then the final approach.",
      },
    ],
    end: "Hard dock. Closing under 0.3 m/s, within 30 cm of the axis.",
  },
  {
    id: "entry",
    title: "Deorbit and entry",
    summary: "A retrograde burn into the air, the corridor, the plasma.",
    start: LEO,
    steps: [
      {
        who: "tars",
        name: "Retrograde",
        say: "To come home, lower the periapsis into the air: retrograde first.",
        act: [{ hold: "retrograde" }],
        done: { holdOk: "retrograde" },
        max: 90,
      },
      {
        who: "you",
        name: "The deorbit burn",
        say: "Your burn: bring the periapsis under 60 km.",
        done: { peBelow: 60 },
        max: 600,
        auto: [{ maneuver: { op: "periapsis", altKm: 45, where: "now" } }, { execute: true }],
      },
      {
        who: "tars",
        name: "The entry",
        say: "⇧G: I fly the entry — shield first, nose high, the plasma ahead.",
        act: [{ auto: "entry" }, { warp: 10 }],
        done: { landed: true },
        max: 4000,
      },
    ],
    end: "Home. The corridor held: under 4 g, the heat in bounds.",
  },
  {
    id: "glide",
    title: "The glide and the runway (Ranger)",
    summary: "From 25 km over the coast to Kennedy's runway: the energy, the alignment, the flare.",
    start: { vessel: "ranger", preset: "game:artemis" },
    steps: [
      {
        who: "tars",
        name: "A glider",
        say: "Below thirty kilometres the Ranger flies as a glider. I set us up for Kennedy.",
        act: [{ auto: "entry" }],
        done: { time: 10 },
      },
      {
        who: "you",
        name: "On the runway",
        say: "Your controls: fly the approach, gear down by 500 m — G —, flare at 14 m.",
        done: { landed: true },
        max: 1200,
        auto: [{ auto: "entry" }],
        demoSay: "The entry autopilot flies the glide to the runway.",
      },
    ],
    end: "Wheels down — a spacecraft landed like an aeroplane.",
  },
  {
    id: "lunar-descent",
    title: "The lunar powered descent (Lander)",
    summary: "3 km over Tranquility: the landing point designated, the vertical descent, the hover seconds.",
    start: { vessel: "lander", hover: { ...TRANQ, altKm: 3 } },
    steps: [
      {
        who: "tars",
        name: "The landing autopilot",
        say: "F7: the landing autopilot flies the approach. Watch the DESCENT panel's seconds.",
        act: [{ auto: "land" }],
        done: { time: 8 },
      },
      {
        who: "you",
        name: "Designate the point",
        say: "Your part: move the landing point — W A S D — to a flatter spot.",
        done: { lpdMoved: true },
        max: 120,
        auto: [{ auto: "land" }],
        demoSay: "I keep the point the autopilot chose.",
      },
      {
        who: "you",
        name: "Contact",
        say: "Let the autopilot fly it down — or take over. Contact light.",
        done: { landed: true },
        max: 600,
        auto: [{ auto: "land" }],
      },
    ],
    end: "The Lander on the Moon. The seconds counted, the point chosen.",
  },
  {
    id: "ascent",
    title: "Take-off and the ascent",
    summary: "From Tranquility to a 100 km orbit: vertical, pitch over, circularize.",
    start: { vessel: "ranger", land: TRANQ },
    steps: [
      {
        who: "tars",
        name: "The launch goal",
        say: "The goal: a 100 km orbit. U flies the climb, vertical first, then pitching over.",
        act: [{ launchGoal: { altKm: 100, incDeg: null } }],
        done: { time: 6 },
      },
      {
        who: "you",
        name: "In orbit",
        say: "Your part: U — the take-off autopilot —, or fly it by hand. Into orbit above 80 km.",
        done: { peAbove: 80 },
        max: 3000,
        auto: [{ auto: "takeoff" }, { warp: 10 }],
      },
    ],
    end: "In orbit. The ascent's report shows how much of the Δv went into the orbit.",
  },
  {
    id: "endurance-dock",
    title: "Docking to the turning Endurance",
    summary: "The film's scene: the Endurance tumbling, the Ranger matching its spin, then docking.",
    start: { vessel: "ranger", preset: "Mann: the tumbling Endurance" },
    steps: [
      {
        who: "tars",
        name: "Its spin",
        say: "It is not possible. — No, it is necessary. First we turn with it.",
        done: { time: 8 },
      },
      {
        who: "you",
        name: "Docked",
        say: "B: the docking autopilot matches its spin and docks. Or by hand, if you dare.",
        done: { docked: true },
        max: 1200,
        auto: [{ auto: "dock" }],
      },
    ],
    end: "Docked. CASE: that was not possible. Cooper: no, it was necessary.",
  },
  {
    id: "slingshot",
    title: "The gravity assist",
    summary: "A flyby of the Moon: the path bent by its pull, the orbit about the Earth changed for free.",
    start: { vessel: "ranger", preset: "game:artemis", target: "moon" },
    steps: [
      {
        who: "tars",
        name: "The idea",
        say: "Passing behind a moving body, the craft is pulled along: its speed about the Earth grows, at no cost.",
        done: { time: 10 },
      },
      {
        who: "you",
        name: "A flyby planned",
        say: "Plan a flyby of the Moon — the map, MISSION, the Moon, flyby — and execute it.",
        done: { nodes: 1 },
        max: 600,
        auto: [{ mission: { target: "moon", arrival: "flyby" } }],
        demoSay: "The Moon's flyby planned by the mission planner.",
      },
      {
        who: "you",
        name: "Into the Moon's sphere",
        say: "Execute the plan, warp: we enter the Moon's sphere of influence.",
        done: { next: "enter" },
        max: 20_000,
        auto: [{ execute: true }, { warp: 1000 }],
      },
    ],
    end: "The Moon's pull bent the path: a slingshot. The Endurance flew Saturn's to reach the wormhole.",
  },
  {
    id: "relativity",
    title: "Flying near Gargantua",
    summary: "The two clocks: the ship's against the Earth's, near the hole.",
    start: { vessel: "ranger", preset: "Gargantua: the Ranger by the Endurance" },
    steps: [
      {
        who: "tars",
        name: "The clocks",
        say: "Here time runs slower: dτ/dt on the HUD, the ship's clock against the Earth's.",
        done: { time: 10 },
      },
      {
        who: "you",
        name: "Hold prograde",
        say: "Hold prograde — key 1 — and watch the clocks drift apart.",
        done: { holdOk: "prograde" },
        max: 120,
        auto: [{ sas: true }, { hold: "prograde" }],
      },
      {
        who: "tars",
        name: "The cost of an hour",
        say: "Near Miller an hour here is seven years on Earth. Every burn there is paid in years.",
        done: { time: 12 },
      },
    ],
    end: "Relativity is not a figure on a screen here: it is the mission's clock.",
  },
  {
    id: "emergencies",
    title: "Emergencies",
    summary: "A thruster stuck open, the engine out: the alarm, its checklist, its action.",
    start: LEO,
    steps: [
      {
        who: "tars",
        name: "A thruster stuck",
        say: "Master caution: a thruster stuck open. Its checklist is on the HUD and the tablet.",
        act: [{ fail: "rcsStuck" }],
        done: { time: 6 },
      },
      {
        who: "you",
        name: "Isolate the quad",
        say: "Your part: the tablet — M, then Systems —, tick its steps, ISOLATE THE QUAD.",
        done: { fixed: true },
        max: 300,
        auto: [{ fix: "rcsStuck" }],
        demoSay: "The checklist read, the quad isolated.",
      },
      {
        who: "tars",
        name: "Engine out",
        say: "And now the main engine: out. The same discipline.",
        act: [{ fail: "engine" }],
        done: { time: 6 },
      },
      {
        who: "you",
        name: "Relight",
        say: "Its checklist, then RELIGHT.",
        done: { fixed: true },
        max: 300,
        auto: [{ fix: "engine" }],
      },
    ],
    end: "Two failures handled by the book. That is what the checklists are for.",
  },
];

/** A lesson's run: its mode, the step now, how long its condition has held, each pilot's step's outcome. */
export interface SpaceRun {
  lesson: SpaceLesson;
  mode: "guided" | "demo" | "try";
  step: number;
  held: number;
  stepT: number;
  results: { name: string; ok: boolean; s: number }[];
  done: boolean;
}

/** The steps a mode takes: a try only the pilot's. */
export const stepsOf = (L: SpaceLesson, mode: SpaceRun["mode"]) => (mode === "try" ? L.steps.filter((s) => s.who === "you") : L.steps);

export function startRun(L: SpaceLesson, mode: SpaceRun["mode"]): SpaceRun {
  return { lesson: L, mode, step: 0, held: 0, stepT: 0, results: [], done: false };
}

/** Whether a step's condition holds now. */
export function holds(d: SpaceDone, F: SpaceFix): boolean {
  if ("time" in d) return F.stepT >= d.time;
  if ("holdOk" in d) return F.hold === d.holdOk && F.holdOk;
  if ("hold" in d) return F.hold === d.hold;
  if ("sas" in d) return F.sas === d.sas;
  if ("rcs" in d) return F.rcs === d.rcs;
  if ("auto" in d) return F.auto === d.auto;
  if ("rateBelow" in d) return F.rate < d.rateBelow;
  if ("turnAbove" in d) return F.turn > d.turnAbove;
  if ("dvAbove" in d) return F.dv > d.dvAbove;
  if ("apAbove" in d) return F.ap !== null && F.ap > d.apAbove;
  if ("apBelow" in d) return F.ap !== null && F.ap < d.apBelow;
  if ("circular" in d) {
    const min = d.peAbove;
    return F.ecc !== null && F.ecc < d.circular && (min === undefined || (F.pe !== null && F.pe > min));
  }
  if ("peAbove" in d) return F.pe !== null && F.pe > d.peAbove;
  if ("peBelow" in d) return F.pe !== null && F.pe < d.peBelow;
  if ("incNear" in d) return F.inc !== null && Math.abs(F.inc - d.incNear) < d.tol;
  if ("docked" in d) return F.docked;
  if ("landed" in d) return F.landed;
  if ("targetBelow" in d) return F.targetM !== null && F.targetM < d.targetBelow;
  if ("nodes" in d) return F.nodes >= d.nodes;
  if ("fixed" in d) return F.failures === 0;
  if ("lpdMoved" in d) return F.lpdMoved;
  if ("next" in d) return F.next === d.next;
  if ("side" in d) return F.side === d.side;
  if ("kerrBelow" in d) return F.kerrR != null && F.kerrR < d.kerrBelow;
  if ("kerrAbove" in d) return F.kerrR != null && F.kerrR > d.kerrAbove;
  if ("ringAbove" in d) return F.ringRpm != null && F.ringRpm > d.ringAbove;
  if ("altBelow" in d) return F.altKm != null && F.altKm < d.altBelow;
  if ("altAbove" in d) return F.altKm != null && F.altKm > d.altAbove;
  if ("soi" in d) return F.soi === d.soi;
  return false;
}

/** What a frame changes: the step done (ok, or timed out), the next begun, the lesson ended. */
export type SpaceEvent = { kind: "begin"; step: SpaceStep } | { kind: "done"; step: SpaceStep; ok: boolean } | { kind: "end" };

export function stepRun(R: SpaceRun, F: Omit<SpaceFix, "stepT">, dt: number): SpaceEvent[] {
  if (R.done) return [];
  const steps = stepsOf(R.lesson, R.mode);
  const ev: SpaceEvent[] = [];
  const s = steps[R.step];
  if (!s) {
    R.done = true;
    return [{ kind: "end" }];
  }
  if (R.stepT === 0 && R.held === 0) ev.push({ kind: "begin", step: s });
  R.stepT += dt;
  const ok = holds(s.done, { ...F, stepT: R.stepT });
  const need = "time" in s.done ? 0 : (s.hold ?? 1.5);
  R.held = ok ? R.held + dt : 0;
  const timedOut = R.stepT >= (s.max ?? Number.POSITIVE_INFINITY);
  if ((ok && R.held >= need) || timedOut) {
    const success = ok && R.held >= need;
    if (s.who === "you") R.results.push({ name: s.name, ok: success, s: R.stepT });
    ev.push({ kind: "done", step: s, ok: success });
    R.step++;
    R.stepT = 0;
    R.held = 0;
    const next = steps[R.step];
    if (next) ev.push({ kind: "begin", step: next });
    else {
      R.done = true;
      ev.push({ kind: "end" });
    }
    // (the next step's first frame: not its begin again)
    R.held = next ? 1e-9 : 0;
  }
  return ev;
}

/** A lesson's mark: 20 shared by the pilot's steps done (a timed-out one none). */
export function lessonScore(R: SpaceRun): number {
  const n = R.results.length;
  return n ? (20 * R.results.filter((r) => r.ok).length) / n : 20;
}
