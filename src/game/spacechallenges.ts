// The spacecraft's challenges (PLAN-VAISSEAUX X10): a start (the school's set-ups), a goal (the school's conditions),
// what is measured — the time, the Δv, the miss from the site, the greatest load —, the medals' marks (lower is
// better), the time at most. The best kept on this device, its medal. Pure: the controller measures, the result out.

import type { SpaceDone, SpaceStart } from "./spacecourse";

export type SpaceChallengeId = "dock-clock" | "lunar-pin" | "mars-pin" | "hoverslam" | "entry-corridor" | "rdv-dv" | "endurance-spin";

export type Metric = "time" | "dv" | "miss" | "gmax";

export interface SpaceChallenge {
  id: SpaceChallengeId;
  title: string;
  brief: string;
  start: SpaceStart;
  goal: SpaceDone;
  metric: Metric;
  /** gold, silver, bronze: the marks under which each is won (the metric's unit) */
  medals: [number, number, number];
  /** at most [s]: then failed */
  max: number;
  /** the site whose miss is measured [°] */
  site?: { lat: number; lon: number };
  /** the engine cut at the start (the hoverslam's fall) */
  freefall?: boolean;
}

const TRANQ = { lat: 0.674, lon: 23.473 };
const JEZERO = { lat: 18.38, lon: 77.58 };

export const SPACE_CHALLENGES: SpaceChallenge[] = [
  {
    id: "dock-clock",
    title: "Docking against the clock",
    brief: "The ISS 60 m off: docked as fast as you can — under the capture's limits.",
    start: { vessel: "ranger", preset: "Earth: docking to the ISS", iss: 60, target: "iss" },
    goal: { docked: true },
    metric: "time",
    medals: [120, 200, 320],
    max: 900,
  },
  {
    id: "lunar-pin",
    title: "Pinpoint landing on the Moon",
    brief: "3 km over Tranquility: land as near the pad as you can.",
    start: { vessel: "lander", hover: { body: "moon", ...TRANQ, altKm: 3 } },
    goal: { landed: true },
    metric: "miss",
    medals: [15, 50, 150],
    max: 600,
    site: TRANQ,
  },
  {
    id: "mars-pin",
    title: "Pinpoint landing on Mars",
    brief: "3 km over Jezero crater: down on the site, the thin air and its winds.",
    start: { vessel: "lander", hover: { body: "mars", ...JEZERO, altKm: 3 } },
    goal: { landed: true },
    metric: "miss",
    medals: [25, 80, 250],
    max: 600,
    site: JEZERO,
  },
  {
    id: "hoverslam",
    title: "The hoverslam",
    brief: "2 km over the Moon, the engine off, falling: light it at the last moment — the least Δv to a safe touchdown.",
    start: { vessel: "lander", hover: { body: "moon", ...TRANQ, altKm: 2 } },
    goal: { landed: true },
    metric: "dv",
    medals: [170, 220, 300],
    max: 300,
    freefall: true,
  },
  {
    id: "entry-corridor",
    title: "The entry corridor",
    brief: "From a 400 km orbit, down through the air: the gentlest entry — the least load at its peak.",
    start: { vessel: "ranger", orbit: { body: "earth", altKm: 400, inc: 51.6 } },
    goal: { landed: true },
    metric: "gmax",
    medals: [3, 4, 5.5],
    max: 8000,
  },
  {
    id: "rdv-dv",
    title: "The rendezvous on the least Δv",
    brief: "The ISS 20 km ahead: within a kilometre of it on as little Δv as you can.",
    start: { vessel: "ranger", preset: "Earth: docking to the ISS", iss: 20_000, target: "iss" },
    goal: { targetBelow: 1000 },
    metric: "dv",
    medals: [25, 50, 100],
    max: 7200,
  },
  {
    id: "endurance-spin",
    title: "The tumbling Endurance",
    brief: "The film's scene: dock to the spinning Endurance before it is lost — the faster the better.",
    start: { vessel: "ranger", preset: "Mann: the tumbling Endurance" },
    goal: { docked: true },
    metric: "time",
    medals: [180, 300, 480],
    max: 1200,
  },
];

export type Medal = "gold" | "silver" | "bronze" | null;

/** The medal a result wins (lower is better). */
export function medalOf(C: SpaceChallenge, score: number): Medal {
  return score <= C.medals[0] ? "gold" : score <= C.medals[1] ? "silver" : score <= C.medals[2] ? "bronze" : null;
}

/** A result in its unit, said short. */
export function scoreText(C: SpaceChallenge, x: number): string {
  if (C.metric === "time")
    return x < 120 ? `${x.toFixed(1)} s` : `${Math.floor(x / 60)} min ${String(Math.round(x % 60)).padStart(2, "0")}`;
  if (C.metric === "dv") return `${x.toFixed(1)} m/s`;
  if (C.metric === "miss") return x >= 1000 ? `${(x / 1000).toFixed(2)} km` : `${x.toFixed(1)} m`;
  return `${x.toFixed(2)} g`;
}

export interface SpaceBest {
  score: number;
  medal: Medal;
  at: number;
}

/** The bests kept, a better one taking a challenge's place (lower is better): whether it is a record. */
export function keepBest(bests: Record<string, SpaceBest>, C: SpaceChallenge, score: number, at: number): boolean {
  const was = bests[C.id];
  if (was && was.score <= score) return false;
  bests[C.id] = { score, medal: medalOf(C, score), at };
  return true;
}
