// A match in a room (docs/PLAN-RESEAU.md, R3): its mode — the fights flown together against the aggressors
// (coop), everyone against everyone (FFA), two teams, a gate race, a landing contest —, its rules (the same for
// every pilot, locked for its time), its start on the room's clock (a countdown), each pilot's start (spread so
// none collide), its score sheet built from the room's events, its end. Pure: no network, no game state — the
// match controller (ui/netmatch.ts) plays it.

import { CHALLENGES, type ChallengeDef } from "./challenges";
import { SCENARIOS, type Scenario } from "./scenarios";

export type MatchMode = "coop" | "ffa" | "teams" | "race" | "landing" | "free";

export interface MatchRules {
  /** stores never spent */
  infinite: boolean;
  /** hits counted, no damage */
  invulnerable: boolean;
  skill: "easy" | "normal" | "ace";
  enemyMissiles: boolean;
  /** a team-mate hurt by one's shots */
  friendlyFire: boolean;
  /** the match's length [s] (FFA, teams: then the score decides) */
  limit: number;
  /** FFA, teams: the kills that win (0: none — the time alone) */
  scoreLimit: number;
  /** the wait before a pilot shot down flies again [s] */
  respawn: number;
}

export const DEFAULT_RULES: MatchRules = {
  infinite: false,
  invulnerable: false,
  skill: "normal",
  enemyMissiles: true,
  friendlyFire: false,
  limit: 300,
  scoreLimit: 5,
  respawn: 5,
};

export interface Match {
  /** its id (the host's slot and its start) */
  id: string;
  mode: MatchMode;
  /** the scenario (coop) or the challenge (race, landing) flown; "arena" for FFA and teams */
  def: string;
  /** who started it: his world runs the aggressors, he ends it */
  host: number;
  /** the room's time it starts at [s] (after the countdown) */
  start: number;
  rules: MatchRules;
  /** the pilots in it, in the order of their starts; their team (0, 1) in a team match */
  pilots: number[];
  teams: Record<number, number>;
}

/** FFA's and the teams' arena: the drone hunt's range over Rogers Dry Lake, nothing in it but the pilots. */
export const ARENA: Scenario = {
  ...SCENARIOS.find((s) => s.id === "drones")!,
  id: "arena",
  title: { fr: "Arène — lac Rogers", en: "Arena — Rogers Dry Lake" },
  brief: { fr: "Tous contre tous, ou deux équipes", en: "Everyone against everyone, or two teams" },
  targets: [],
  limit: 3600,
};

/** The free fight (a room's F-35s, no match asked): wherever they fly — its frame anchored where it begins —,
 *  everyone a target, a team-mate's fire too; the air-to-air stores. */
export const FREE_FIGHT: Scenario = {
  ...ARENA,
  id: "free",
  title: { fr: "Combat libre", en: "Free fight" },
  brief: { fr: "En réseau, en F-35 : tout le monde est une cible", en: "In a room, in the F-35: everyone is a target" },
  loadout: "aa",
  limit: 1e9,
  mission: true,
};

/** The free fight's rules: no time, no score to reach, every hit counts — a team-mate's, one's own wingman's. */
export const FREE_RULES: MatchRules = { ...DEFAULT_RULES, friendlyFire: true, limit: 1e9, scoreLimit: 0, respawn: 6 };

export const scenarioOf = (m: Pick<Match, "mode" | "def">): Scenario | null =>
  m.mode === "free"
    ? FREE_FIGHT
    : m.mode === "ffa" || m.mode === "teams"
      ? ARENA
      : m.mode === "coop"
        ? (SCENARIOS.find((s) => s.id === m.def) ?? null)
        : null;

export const challengeOf = (m: Pick<Match, "mode" | "def">): ChallengeDef | null =>
  m.mode === "race" || m.mode === "landing" ? (CHALLENGES.find((c) => c.id === m.def) ?? null) : null;

/** The courses a race may fly, the landings a contest may: from the challenges. */
export const RACES = () => CHALLENGES.filter((c) => c.kind === "gates");
export const LANDINGS = () => CHALLENGES.filter((c) => c.kind === "landing" || c.kind === "vertical");

/** Two teams: the pilots dealt in turn. */
export function dealTeams(pilots: number[]): Record<number, number> {
  const t: Record<number, number> = {};
  pilots.forEach((s, i) => (t[s] = i % 2));
  return t;
}

const D = Math.PI / 180;
const R_EARTH = 6_371_008.8;

/** A place east, north [m] of an anchor → latitude, longitude [°] (the fights' flat frame). */
export function enuToLatLon(anchor: { lat: number; lon: number }, e: number, n: number) {
  return { lat: anchor.lat + n / (D * R_EARTH), lon: anchor.lon + e / (D * R_EARTH * Math.cos(anchor.lat * D)) };
}

/**
 * Where a pilot starts (his index among the match's pilots): in the air over the place, its height, heading,
 * speed. FFA: on a ring of 8 km about the arena's middle, facing it; teams: each team abreast on its side, 15 km
 * apart, facing the other; coop: the scenario's start, abreast 400 m apart; a race: the course's start, in
 * echelon 60 m right and 40 m back each; a landing: the final, 2.5 km apart in trail.
 */
export function spawnOf(m: Match, i: number): { lat: number; lon: number; agl: number; hdg: number; speed: number; final?: number } | null {
  const n = Math.max(1, m.pilots.length);
  const sc = scenarioOf(m);
  if (m.mode === "ffa" && sc) {
    const a = (2 * Math.PI * i) / n;
    const e = 8000 * Math.sin(a),
      no = 8000 * Math.cos(a);
    // (facing the middle)
    const hdg = ((a * 180) / Math.PI + 180) % 360;
    return { ...enuToLatLon(sc.anchor, e, no), agl: 4000 + 300 * (i % 2), hdg, speed: 240 };
  }
  if (m.mode === "teams" && sc) {
    const slot = m.pilots[i]!;
    const team = m.teams[slot] ?? 0;
    const k = m.pilots.slice(0, i).filter((s) => (m.teams[s] ?? 0) === team).length;
    const side = team === 0 ? -1 : 1;
    // (abreast 600 m apart, the two lines 15 km apart along east–west)
    return { ...enuToLatLon(sc.anchor, side * 7500, (k - 0.5) * 600), agl: 4000, hdg: team === 0 ? 90 : 270, speed: 240 };
  }
  if (m.mode === "coop" && sc) {
    const h = sc.start.hdg * D;
    const right = [Math.cos(h), -Math.sin(h)];
    const e = sc.start.e + right[0]! * 400 * i,
      no = sc.start.n + right[1]! * 400 * i;
    return { ...enuToLatLon(sc.anchor, e, no), agl: sc.start.agl, hdg: sc.start.hdg, speed: sc.start.speed };
  }
  const ch = challengeOf(m);
  if (!ch) return null;
  const s = ch.start;
  if ("field" in s) return { lat: Number.NaN, lon: Number.NaN, agl: 0, hdg: 0, speed: 78, final: s.final + 2.5 * i };
  // (echelon right: each 60 m to the right of the one before, 40 m behind)
  const h = s.hdg * D;
  const fwd = [Math.sin(h), Math.cos(h)],
    right = [Math.cos(h), -Math.sin(h)];
  const e = right[0]! * 60 * i - fwd[0]! * 40 * i,
    no = right[1]! * 60 * i - fwd[1]! * 40 * i;
  return { ...enuToLatLon({ lat: s.lat, lon: s.lon }, e, no), agl: s.agl, hdg: s.hdg, speed: s.speed };
}

/** The respawn of a pilot shot down (FFA, teams): a place on the ring, his own, a little higher. */
export function respawnOf(m: Match, slot: number, n: number) {
  const i = Math.max(0, m.pilots.indexOf(slot));
  const s = spawnOf({ ...m, mode: m.mode === "teams" ? "teams" : "ffa" }, i);
  return s ? { ...s, agl: s.agl + 500 + 300 * (n % 3) } : null;
}

// ------------------------------------------------------------------------------------------- the score sheet

export interface PilotScore {
  slot: number;
  kills: number;
  deaths: number;
  /** the aggressors downed (coop) */
  ai: number;
  hits: number;
  /** a race's time [s] (its penalties in), a landing's score /100; null: not finished */
  result: number | null;
  medal?: string | null;
}

export type MatchEvent =
  | { kind: "down"; slot: number; by: number | null }
  | { kind: "aiDown"; id: number; by: number | null }
  | { kind: "hit"; from: number }
  | { kind: "result"; slot: number; value: number; medal?: string | null };

export class ScoreSheet {
  readonly rows = new Map<number, PilotScore>();

  constructor(readonly match: Match) {
    for (const s of match.pilots) this.row(s);
  }

  row(slot: number): PilotScore {
    let r = this.rows.get(slot);
    if (!r) this.rows.set(slot, (r = { slot, kills: 0, deaths: 0, ai: 0, hits: 0, result: null }));
    return r;
  }

  apply(e: MatchEvent) {
    if (e.kind === "down") {
      this.row(e.slot).deaths++;
      // (a kill counted to the shooter — a team-mate's own goal not)
      if (e.by !== null && e.by !== e.slot && !this.sameTeam(e.by, e.slot)) this.row(e.by).kills++;
    } else if (e.kind === "aiDown") {
      if (e.by !== null) this.row(e.by).ai++;
    } else if (e.kind === "hit") this.row(e.from).hits++;
    else if (e.kind === "result") {
      const r = this.row(e.slot);
      r.result = e.value;
      r.medal = e.medal ?? null;
    }
  }

  /** On the same side: a team match's team-mates; every pilot of a co-op match (together against the aggressors). */
  sameTeam(a: number, b: number) {
    if (this.match.mode === "coop") return a >= 0 && b >= 0;
    return this.match.mode === "teams" && (this.match.teams[a] ?? -1) === (this.match.teams[b] ?? -2);
  }

  /** each team's kills (teams) */
  teamScore(team: number) {
    let k = 0;
    for (const r of this.rows.values()) if ((this.match.teams[r.slot] ?? -1) === team) k += r.kills;
    return k;
  }

  /** The order: kills (then fewer deaths) — a race: the fastest; a landing: the best score; coop: the aggressors downed. */
  ranking(): PilotScore[] {
    const R = [...this.rows.values()];
    const m = this.match.mode;
    if (m === "race") return R.sort((a, b) => (a.result ?? Infinity) - (b.result ?? Infinity));
    if (m === "landing") return R.sort((a, b) => (b.result ?? -1) - (a.result ?? -1));
    if (m === "coop") return R.sort((a, b) => b.ai - a.ai || b.hits - a.hits);
    return R.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  /**
   * Over now (the host decides — at the room's time `t`, the coop's aggressors all down `aiLeft` 0): the time out,
   * the score limit reached, everyone finished; with why. Null: not yet.
   */
  over(t: number, aiLeft = 1): { why: "time" | "score" | "done" | "cleared" } | null {
    const m = this.match;
    const T = t - m.start;
    if (T < 0 || m.mode === "free") return null;
    if (m.mode === "coop") {
      if (aiLeft === 0) return { why: "cleared" };
      return T > (scenarioOf(m)?.limit ?? 600) ? { why: "time" } : null;
    }
    if (m.mode === "race" || m.mode === "landing") {
      const all = [...this.rows.values()].every((r) => r.result !== null);
      if (all) return { why: "done" };
      // (the last given two minutes after the first finished — a race's, a landing's limit otherwise)
      return T > m.rules.limit ? { why: "time" } : null;
    }
    const L = m.rules.scoreLimit;
    if (L > 0) {
      if (m.mode === "teams" && (this.teamScore(0) >= L || this.teamScore(1) >= L)) return { why: "score" };
      if (m.mode === "ffa" && [...this.rows.values()].some((r) => r.kills >= L)) return { why: "score" };
    }
    return T > m.rules.limit ? { why: "time" } : null;
  }
}
