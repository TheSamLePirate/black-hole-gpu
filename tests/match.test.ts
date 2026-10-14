import { describe, expect, test } from "bun:test";
import { DEFAULT_RULES, dealTeams, type Match, respawnOf, ScoreSheet, spawnOf } from "../src/game/match";

// PLAN-RESEAU R3: a match's starts (spread so none collide), its score sheet (kills, team-mates, the aggressors,
// results), its end (the time, the score, everyone finished, the aggressors cleared).

const match = (o: Partial<Match> = {}): Match => ({
  id: "0-1",
  mode: "ffa",
  def: "arena",
  host: 0,
  start: 100,
  rules: { ...DEFAULT_RULES },
  pilots: [0, 1, 2, 3],
  teams: {},
  ...o,
});
const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111_000, (a.lon - b.lon) * 111_000 * Math.cos((a.lat * Math.PI) / 180));

describe("the starts", () => {
  test("FFA: a ring of 8 km, each facing the middle, kilometres apart", () => {
    const m = match();
    const S = m.pilots.map((_, i) => spawnOf(m, i)!);
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) expect(dist(S[i]!, S[j]!)).toBeGreaterThan(5000);
    // (the first north of the middle, heading south)
    expect(S[0]!.hdg).toBeCloseTo(180, 6);
  });
  test("teams: each team abreast on its side, facing the other", () => {
    const m = match({ mode: "teams", teams: dealTeams([0, 1, 2, 3]) });
    const S = m.pilots.map((_, i) => spawnOf(m, i)!);
    expect(S[0]!.hdg).toBe(90);
    expect(S[1]!.hdg).toBe(270);
    expect(dist(S[0]!, S[2]!)).toBeGreaterThan(300);
    expect(dist(S[0]!, S[2]!)).toBeLessThan(1500);
    expect(dist(S[0]!, S[1]!)).toBeGreaterThan(12_000);
  });
  test("a race: in echelon, 60 m right and 40 m back each; a landing: 2.5 km apart in trail", () => {
    const race = match({ mode: "race", def: "machloop" });
    const a = spawnOf(race, 0)!,
      b = spawnOf(race, 1)!;
    expect(dist(a, b)).toBeGreaterThan(60);
    expect(dist(a, b)).toBeLessThan(80);
    const land = match({ mode: "landing", def: "landing" });
    expect(spawnOf(land, 2)!.final! - spawnOf(land, 0)!.final!).toBeCloseTo(5, 6);
  });
  test("a respawn: one's own place on the ring, higher", () => {
    const m = match();
    expect(respawnOf(m, 2, 1)!.agl).toBeGreaterThan(spawnOf(m, 2)!.agl);
  });
});

describe("the score sheet", () => {
  test("kills, deaths, a team-mate's own goal not counted; the ranking", () => {
    const m = match({ mode: "teams", teams: dealTeams([0, 1, 2, 3]) });
    const S = new ScoreSheet(m);
    S.apply({ kind: "down", slot: 1, by: 0 });
    S.apply({ kind: "down", slot: 3, by: 0 });
    S.apply({ kind: "down", slot: 2, by: 0 }); // (0 and 2: team-mates)
    expect(S.row(0).kills).toBe(2);
    expect(S.row(2).deaths).toBe(1);
    expect(S.teamScore(0)).toBe(2);
    expect(S.ranking()[0]!.slot).toBe(0);
  });
  test("the end: the score limit, the time; coop: cleared; a race: everyone finished", () => {
    const S = new ScoreSheet(match({ rules: { ...DEFAULT_RULES, scoreLimit: 2, limit: 300 } }));
    expect(S.over(150)).toBeNull();
    S.apply({ kind: "down", slot: 1, by: 3 });
    S.apply({ kind: "down", slot: 2, by: 3 });
    expect(S.over(150)?.why).toBe("score");
    expect(new ScoreSheet(match()).over(401)?.why).toBe("time");
    expect(new ScoreSheet(match({ mode: "coop", def: "drones" })).over(150, 0)?.why).toBe("cleared");
    const R = new ScoreSheet(match({ mode: "race", def: "machloop", pilots: [0, 1] }));
    R.apply({ kind: "result", slot: 0, value: 92.4 });
    expect(R.over(150)).toBeNull();
    R.apply({ kind: "result", slot: 1, value: 88.1 });
    expect(R.over(150)?.why).toBe("done");
    expect(R.ranking()[0]!.slot).toBe(1);
  });
});
