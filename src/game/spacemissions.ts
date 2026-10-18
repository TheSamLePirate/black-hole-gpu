// The spacecraft's missions (PLAN-VAISSEAUX X11): a start, objectives in their order (the school's conditions), a
// budget (the Δv, the time), failures injected at their times; a library (Artemis II, the ISS, the Moon, Mars, a
// rescue) and the Interstellar campaign, chapter by chapter — launch, the Endurance, the wormhole, Miller, Mann, the
// slingshot about Gargantua, Edmunds —, each chapter opened by the one before. Pure: the controller flies them.

import { t, tf } from "../i18n";
import type { SpaceDone, SpaceStart } from "./spacecourse";

export type SpaceMissionId =
  | "artemis-2"
  | "iss"
  | "moon-landing"
  | "mars-landing"
  | "rescue"
  | "c1-launch"
  | "c2-endurance"
  | "c3-wormhole"
  | "c4-miller"
  | "c5-mann"
  | "c6-slingshot"
  | "c7-edmunds";

export interface SpaceObjective {
  /** its words (none: made from its condition — a mission made in the editor) */
  text?: string;
  done: SpaceDone;
}

export interface SpaceMission {
  id: SpaceMissionId | string;
  title: string;
  brief: string;
  start: SpaceStart;
  objectives: SpaceObjective[];
  /** the Δv it may spend [m/s], the time it may take [s] (none: no limit) */
  budget?: { dv?: number; timeS?: number };
  /** failures at their times [s from the start] */
  failures?: { at: number; kind: string }[];
  /** the Interstellar campaign's chapter (1…), else a library mission */
  chapter?: number;
  /** messages said at their times [s from the start] (the triggers) */
  says?: { at: number; text: string }[];
}

export const SPACE_MISSIONS: SpaceMission[] = [
  {
    id: "artemis-2",
    title: "Artemis II",
    brief:
      "From a 400 km orbit round the Moon and home on a free return: plan it, fly it, enter the Moon's sphere and come back to the Earth's.",
    start: { vessel: "ranger", preset: "game:artemis", target: "moon" },
    objectives: [
      { text: "Plan the free return (the map, MISSION, the Moon, free return)", done: { nodes: 1 } },
      { text: "Enter the Moon's sphere of influence", done: { soi: "moon" } },
      { text: "Back in the Earth's sphere", done: { soi: "earth" } },
    ],
    budget: { dv: 4000 },
  },
  {
    id: "iss",
    title: "To the ISS",
    brief: "20 km behind the station: the rendezvous, then docked — on a frugal budget.",
    start: { vessel: "ranger", preset: "Earth: docking to the ISS", iss: 20_000, target: "iss" },
    objectives: [
      { text: "Within a kilometre of the ISS", done: { targetBelow: 1000 } },
      { text: "Docked", done: { docked: true } },
    ],
    budget: { dv: 150, timeS: 7200 },
  },
  {
    id: "moon-landing",
    title: "Landing on the Moon",
    brief: "The Lander in a 50 km lunar orbit: down to the surface with what its tanks hold.",
    start: { vessel: "lander", orbit: { body: "moon", altKm: 50 } },
    objectives: [
      { text: "Below 10 km (the descent orbit)", done: { altBelow: 10 } },
      { text: "Landed on the Moon", done: { landed: true } },
    ],
    budget: { dv: 2200, timeS: 7200 },
  },
  {
    id: "mars-landing",
    title: "Landing on Mars",
    brief: "The Lander in a 200 km orbit about Mars: through its thin air to the ground.",
    start: { vessel: "lander", orbit: { body: "mars", altKm: 200 } },
    objectives: [
      { text: "Into the air (below 60 km)", done: { altBelow: 60 } },
      { text: "Landed on Mars", done: { landed: true } },
    ],
    budget: { timeS: 7200 },
  },
  {
    id: "rescue",
    title: "The rescue",
    brief: "The Endurance tumbling 300 km up, its systems failing: dock to it before it is lost — a thruster of yours sticking on the way.",
    start: { vessel: "ranger", preset: "Earth: the Endurance tumbling, 300 km up" },
    objectives: [{ text: "Docked to the Endurance", done: { docked: true } }],
    budget: { timeS: 1500 },
    failures: [{ at: 60, kind: "rcsStuck" }],
  },
  // ---- the Interstellar campaign
  {
    id: "c1-launch",
    chapter: 1,
    title: "1 · Lift-off",
    brief: "Cape Canaveral. The Ranger on the pad, the mission's first minutes: through the air into orbit.",
    start: { vessel: "ranger", land: { body: "earth", lat: 28.573, lon: -80.649 } },
    objectives: [
      { text: "Clear the atmosphere (above 100 km)", done: { altAbove: 100 } },
      { text: "Into orbit (periapsis above 150 km)", done: { peAbove: 150 } },
    ],
    budget: { dv: 11_000 },
  },
  {
    id: "c2-endurance",
    chapter: 2,
    title: "2 · The Endurance",
    brief: "Aboard the Endurance, the Ranger and the Lander docked: its ring spun up, the voyage planned.",
    start: { vessel: "endurance", preset: "Earth: the Endurance, 800 km up" },
    objectives: [
      { text: "Spin the ring up past 4 rpm (⇧])", done: { ringAbove: 4 } },
      { text: "Plan the departure (the map, MISSION)", done: { nodes: 1 } },
    ],
  },
  {
    id: "c3-wormhole",
    chapter: 3,
    title: "3 · The wormhole",
    brief: "Near Saturn, before the sphere in space: through it to another galaxy.",
    start: { vessel: "ranger", preset: "game:artemis", wormhole: "ours" },
    objectives: [{ text: "Through the wormhole to Gargantua's side", done: { side: "gargantua" } }],
  },
  {
    id: "c4-miller",
    chapter: 4,
    title: "4 · Miller's planet",
    brief: "Every hour here is seven years on Earth. Down to the sea, back up before the wave.",
    start: { vessel: "ranger", preset: "Gargantua: the Ranger by the Endurance", near: { body: "miller", altKm: 50 } },
    objectives: [
      { text: "Down to the sea (below 5 km)", done: { altBelow: 5 } },
      { text: "Back up, away from the wave (above 60 km)", done: { altAbove: 60 } },
    ],
    budget: { timeS: 1800 },
  },
  {
    id: "c5-mann",
    chapter: 5,
    title: "5 · Mann",
    brief: "The Endurance torn and spinning above Mann's ice: dock to it. It is not possible — no, it is necessary.",
    start: { vessel: "ranger", preset: "Mann: the tumbling Endurance" },
    objectives: [{ text: "Docked to the spinning Endurance", done: { docked: true } }],
    budget: { timeS: 1500 },
  },
  {
    id: "c6-slingshot",
    chapter: 6,
    title: "6 · The slingshot",
    brief: "Too little fuel to reach Edmunds: fall close to Gargantua and let it throw us out.",
    start: { vessel: "endurance", preset: "Gargantua: the Ranger by the Endurance", near: { body: "gargantua", rM: 40 } },
    objectives: [
      { text: "Dive toward Gargantua (inside 8 M)", done: { kerrBelow: 8 } },
      { text: "Thrown out (past 40 M)", done: { kerrAbove: 40 } },
    ],
  },
  {
    id: "c7-edmunds",
    chapter: 7,
    title: "7 · Edmunds",
    brief: "The last world: a desert under a distant sun. Land where Brand waits.",
    start: { vessel: "ranger", preset: "Gargantua: the Ranger by the Endurance", near: { body: "edmunds", altKm: 30 } },
    objectives: [{ text: "Landed on Edmunds' world", done: { landed: true } }],
  },
];

/** The campaign's chapters in their order. */
export const CAMPAIGN = SPACE_MISSIONS.filter((m) => m.chapter).sort((a, b) => a.chapter! - b.chapter!);

/** Whether a chapter is open (the first; or the one before done). */
export const chapterOpen = (M: SpaceMission, done: number) => !M.chapter || M.chapter <= done + 1;

// ------------------------------------------------------------------------------------ missions made

/** The conditions the editor offers, their value's kind: a number in its unit, a body, a side, none. */
export const EDITOR_DONE: { key: string; unit?: "km" | "m" | "M" | "rpm" | "n"; pick?: string[] }[] = [
  { key: "altAbove", unit: "km" },
  { key: "altBelow", unit: "km" },
  { key: "peAbove", unit: "km" },
  { key: "apAbove", unit: "km" },
  { key: "soi", pick: ["earth", "moon", "mars", "venus", "jupiter", "saturn", "miller", "mann", "edmunds"] },
  { key: "targetBelow", unit: "m" },
  { key: "docked" },
  { key: "landed" },
  { key: "nodes", unit: "n" },
  { key: "ringAbove", unit: "rpm" },
  { key: "side", pick: ["ours", "gargantua"] },
  { key: "kerrBelow", unit: "M" },
  { key: "kerrAbove", unit: "M" },
];

const BODY: Record<string, string> = {
  earth: "the Earth",
  moon: "the Moon",
  mars: "Mars",
  venus: "Venus",
  jupiter: "Jupiter",
  saturn: "Saturn",
  miller: "Miller's planet",
  mann: "Mann's planet",
  edmunds: "Edmunds' world",
};

/** A condition said (the words of an objective made in the editor). */
export function doneText(d: SpaceDone): string {
  const k = Object.keys(d)[0] ?? "";
  const v = (d as Record<string, unknown>)[k];
  switch (k) {
    case "altAbove":
      return tf("Above {0} km", v as number);
    case "altBelow":
      return tf("Below {0} km", v as number);
    case "peAbove":
      return tf("Periapsis above {0} km", v as number);
    case "apAbove":
      return tf("Apoapsis above {0} km", v as number);
    case "soi":
      return tf("In the sphere of {0}", t(BODY[v as string] ?? (v as string)));
    case "targetBelow":
      return tf("Within {0} m of the target", v as number);
    case "docked":
      return t("Docked");
    case "landed":
      return t("Landed");
    case "nodes":
      return tf("A manoeuvre planned ({0})", v as number);
    case "ringAbove":
      return tf("The ring past {0} rpm", v as number);
    case "side":
      return v === "gargantua" ? t("On Gargantua's side") : t("On our side");
    case "kerrBelow":
      return tf("Inside {0} M of Gargantua", v as number);
    case "kerrAbove":
      return tf("Past {0} M from Gargantua", v as number);
  }
  return k;
}

/** An objective's words, in the language read. */
export const objText = (O: SpaceObjective) => (O.text ? t(O.text) : doneText(O.done));

const VESSELS = ["ranger", "lander", "endurance"];
const DONE_KEYS = new Set(EDITOR_DONE.map((x) => x.key));

/** A mission from elsewhere (a link) checked: what is wrong in it, else the mission (its own words not
 *  translated: a player's). */
export function checkSpaceMission(x: unknown): { M: SpaceMission | null; errors: string[] } {
  const errors: string[] = [];
  const o = x as Partial<SpaceMission> | null;
  if (!o || typeof o !== "object") return { M: null, errors: ["not a mission"] };
  if (typeof o.title !== "string" || !o.title.trim()) errors.push("title");
  if (!o.start || !VESSELS.includes(o.start.vessel)) errors.push("start.vessel");
  if (!Array.isArray(o.objectives) || !o.objectives.length) errors.push("objectives");
  else
    o.objectives.forEach((ob, i) => {
      const k = ob && typeof ob.done === "object" ? Object.keys(ob.done) : [];
      if (k.length !== 1 || !DONE_KEYS.has(k[0]!)) errors.push(`objectives[${i}]`);
    });
  const num = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v) && v > 0);
  if (o.budget && (!num(o.budget.dv) || !num(o.budget.timeS))) errors.push("budget");
  if (o.says && (!Array.isArray(o.says) || o.says.some((m) => typeof m?.at !== "number" || typeof m?.text !== "string")))
    errors.push("says");
  if (errors.length) return { M: null, errors };
  // (a link's mission: never a chapter of the campaign, never one of ours)
  return {
    M: {
      ...(o as SpaceMission),
      id: `link-${
        String(o.id ?? "")
          .replace(/[^\w-]/g, "")
          .slice(0, 32) || "mission"
      }`,
      chapter: undefined,
    },
    errors,
  };
}

/** A mission as a link's hash (#smission=…, the base64url of its JSON). */
export function spaceMissionToHash(M: SpaceMission): string {
  const bytes = new TextEncoder().encode(JSON.stringify(M));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `#smission=${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** A link's mission (null: none in it); what is wrong in it thrown. */
export function spaceMissionFromHash(hash: string): SpaceMission | null {
  const m = /[#&]smission=([\w-]+)/.exec(hash);
  if (!m) return null;
  const b64 = m[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const { M, errors } = checkSpaceMission(JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))));
  if (!M) throw new Error(errors.join("; "));
  return M;
}
