// The spacecraft's co-op missions (PLAN-VAISSEAUX N5): flown together in a room, each pilot a role — his craft, his
// start, his objectives in their order —; the mission won when every role is done. A role left by its pilot is free
// for another to take. Pure: the session shares who flies what and how far each has got; the controller flies each
// role as a mission of its own.

import type { SpaceMission, SpaceObjective } from "./spacemissions";
import type { SpaceStart } from "./spacecourse";

export interface CoopRole {
  id: string;
  title: string;
  /** what the role does, said to the one who takes it */
  brief: string;
  start: SpaceStart;
  objectives: SpaceObjective[];
}

export interface CoopMission {
  id: string;
  title: string;
  brief: string;
  roles: CoopRole[];
  /** the time the mission may take [s] (each role's) */
  timeS?: number;
}

export const COOP_MISSIONS: CoopMission[] = [
  {
    id: "coop-moon",
    title: "The Moon together",
    brief: "The Endurance holds orbit above the Moon, its ring spun up for the crew; the Lander goes down to the surface.",
    timeS: 3600,
    roles: [
      {
        id: "endurance",
        title: "Endurance — the orbit",
        brief: "Keep the mothership in a high lunar orbit, the ring spun up past 2 rpm.",
        start: { vessel: "endurance", orbit: { body: "moon", altKm: 120 } },
        objectives: [
          { text: "Spin the ring up past 2 rpm (⇧])", done: { ringAbove: 2 } },
          { text: "Hold the orbit above 100 km", done: { peAbove: 100 } },
        ],
      },
      {
        id: "lander",
        title: "Lander — the descent",
        brief: "From a 50 km orbit, down to the Moon's surface.",
        start: { vessel: "lander", orbit: { body: "moon", altKm: 50 } },
        objectives: [
          { text: "Below 10 km (the descent orbit)", done: { altBelow: 10 } },
          { text: "Landed on the Moon", done: { landed: true } },
        ],
      },
    ],
  },
  {
    id: "coop-rescue",
    title: "The rescue together",
    brief: "The Endurance tumbling 300 km up: one stops its spin from its own controls, the other docks a Ranger to it.",
    timeS: 1800,
    roles: [
      {
        id: "endurance",
        title: "Endurance — stop the tumble",
        brief: "Aboard the tumbling mothership: stop its spin (⇧X), then hold it steady.",
        start: { vessel: "endurance", preset: "Earth: the Endurance tumbling, 300 km up" },
        objectives: [{ text: "Stop the tumble", done: { rateBelow: 0.5 } }],
      },
      {
        id: "ranger",
        title: "Ranger — the docking",
        brief: "Close in on the Endurance and dock once it is steady.",
        start: { vessel: "ranger", preset: "Earth: the Endurance tumbling, 300 km up" },
        objectives: [
          { text: "Within a kilometre of the Endurance", done: { targetBelow: 1000 } },
          { text: "Docked to the Endurance", done: { docked: true } },
        ],
      },
    ],
  },
];

/** A role flown as a mission of its own: its start, its objectives, the mission's time. */
export function roleMission(M: CoopMission, roleId: string): SpaceMission | null {
  const R = M.roles.find((r) => r.id === roleId);
  if (!R) return null;
  return {
    id: `coop:${M.id}:${R.id}`,
    title: R.title,
    brief: R.brief,
    start: R.start,
    objectives: R.objectives,
    budget: M.timeS ? { timeS: M.timeS } : undefined,
  };
}

/** A role's progress as the room hears it. */
export interface RoleState {
  slot: number | null;
  i: number;
  n: number;
  ended: boolean;
  ok: boolean;
}

/** The mission's state: won (every role done), lost (a role ended short), or under way. */
export function coopVerdict(roles: Map<string, RoleState>): "won" | "lost" | "on" {
  const all = [...roles.values()];
  if (all.length && all.every((r) => r.ended && r.ok)) return "won";
  if (all.some((r) => r.ended && !r.ok)) return "lost";
  return "on";
}

/** The roles not flown by anyone (their pilot gone, or never taken). */
export const freeRoles = (roles: Map<string, RoleState>) => [...roles].filter(([, r]) => r.slot === null && !r.ended).map(([k]) => k);
