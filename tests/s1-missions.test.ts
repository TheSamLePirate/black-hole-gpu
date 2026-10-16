import { expect, test } from "bun:test";
import { AIR_MISSIONS } from "../src/game/airmissions";
import { CombatWorld, launchZone, LOADOUTS, loadoutMass, type Player, type V3 } from "../src/game/combat";
import { checkMission, type MissionSpec, type MissionWorld, missionStep, newRun } from "../src/game/mission";

// PLAN-AVIATION-AAA S1: the missions of exception — every one given checks (thirteen); a frigate under way on the sea,
// its own SAMs on what flies above 150 m within their reach, nothing below; the JSM fired only at a ship locked, its
// reach a cruise missile's, flown 70 km by its turbojet to sink a frigate; the display's passes counted only when low
// over the crowd with the diamond in place; a unit near another (the raid near the carrier) failing a mission; a
// qualification's objective passed — or failed; a team mission's roles checked.

const flat = () => 0;
const seeded =
  (s = 1) =>
  () =>
    (s = (s * 16807) % 2147483647) / 2147483647;
const level = (p: V3, speed = 250): Player => ({ p, v: [speed, 0, 0], fwd: [1, 0, 0], up: [0, 0, 1] });
function run(W: CombatWorld, P: Player, secs: number, each?: (t: number) => void) {
  const ev = [];
  for (let t = 0; t < secs; t += 1 / 30) {
    each?.(t);
    P.p = [P.p[0] + P.v[0] / 30, P.p[1] + P.v[1] / 30, P.p[2] + P.v[2] / 30];
    ev.push(...W.step(1 / 30, P));
  }
  return ev;
}

test("the missions given — S1's among them — all check; a team mission's roles and its objectives' roles", () => {
  const ids = AIR_MISSIONS.map((m) => m.id);
  for (const id of [
    "vip-escort",
    "red-air",
    "antiship",
    "qual-day",
    "qual-night",
    "qual-sea",
    "display",
    "team-strike",
    "team-2v2",
    "carrier-defence",
  ])
    expect(ids).toContain(id);
  for (const m of AIR_MISSIONS) expect(checkMission(m.make()).errors).toEqual([]);
  const team = AIR_MISSIONS.find((m) => m.id === "team-strike")!.make();
  expect(team.roles!.map((r) => r.id)).toEqual(["striker", "escort"]);
  expect(team.objectives.filter((o) => o.role === "escort").map((o) => o.id)).toEqual(["air"]);
  const bad = checkMission({ ...team, objectives: [{ ...team.objectives[0]!, role: "nobody" }] });
  expect(bad.errors).toContain("objective sam: no role nobody");
  // (the anti-ship load: two JSMs, their mass carried)
  expect(LOADOUTS.as.jsm).toBe(2);
  expect(loadoutMass(LOADOUTS.as) - loadoutMass({ ...LOADOUTS.as, jsm: 0 })).toBe(832);
});

test("a frigate under way; its SAMs on a jet above 150 m within their reach, none below; the JSM only at a ship, sinking it from 70 km", () => {
  const W = new CombatWorld([{ kind: "ship", at: [0, 70_000, 0], hdg: 270, name: "Frigate" }], LOADOUTS.as, flat, seeded());
  W.opts = { infinite: false, invulnerable: true, skill: "normal", enemyMissiles: true };
  const q = W.targets[0]!;
  // (low over the sea, 60 km off: under its radar's horizon — no shot)
  const P = level([0, 0, 60], 230);
  P.v = [0, 230, 0];
  P.fwd = [0, 1, 0];
  run(W, P, 10);
  expect(q.p[0]).toBeCloseTo(-90, -1);
  expect(W.missiles.length).toBe(0);
  // (the JSM: a ship locked, nothing else)
  W.lock = null;
  expect(W.launch(P, "jsm")).toBeNull();
  W.lock = q.id;
  expect(launchZone("jsm", P, q).inRange).toBe(true);
  const m = W.launch(P, "jsm")!;
  expect(m.kind).toBe("jsm");
  expect(W.stores.jsm).toBe(1);
  // (we turn away, low; it flies on)
  P.v = [0, -230, 0];
  P.fwd = [0, -1, 0];
  let t = 0;
  const ev = run(W, P, 400, (s) => {
    if (q.alive) t = s;
  });
  console.log(`  the JSM hit after ${t.toFixed(0)} s (${(68_000 / t).toFixed(0)} m/s); the frigate ${q.alive ? "afloat" : "sinking"}`);
  expect(q.alive).toBe(false);
  expect(ev.some((e) => e.kind === "kill" && e.by === "jsm")).toBe(true);
  expect(t).toBeGreaterThan(180);
  // (another: a jet at 4 000 m within 25 km — fired at)
  const W2 = new CombatWorld([{ kind: "ship", at: [0, 25_000, 0], hdg: 90, name: "Frigate" }], LOADOUTS.as, flat, seeded());
  W2.opts = { infinite: false, invulnerable: true, skill: "normal", enemyMissiles: true };
  const ev2 = run(W2, level([0, 0, 4000], 0), 15);
  expect(ev2.some((e) => e.kind === "launch" && e.who === "red" && e.missile === "sam")).toBe(true);
});

/** A world by hand. */
const world = (
  own: Partial<MissionWorld["own"]> & { lat: number; lon: number },
  o: Partial<MissionWorld> = {},
  units: Record<string, { lat: number; lon: number; alt: number; alive: boolean }> = {},
): MissionWorld => ({
  own: { alt: 300, landed: false, lost: false, ...own },
  unit: (id) => units[id] ?? null,
  onCarrier: null,
  ...o,
});

test("the display's passes: low over the crowd, the diamond in place — counted as it leaves; a pass high or with a wingman out not", () => {
  const spec = AIR_MISSIONS.find((m) => m.id === "display")!.make();
  const R = newRun(spec);
  const said: string[] = [];
  const at = (lat: number, agl: number, inPlace: number, secs = 3) => {
    for (let i = 0; i < secs * 10; i++)
      for (const o of missionStep(R, world({ lat, lon: 5.1093, agl }, { wingmenInPlace: inPlace }), 0.1)) if ("say" in o) said.push(o.say);
  };
  const crowd = 43.6064;
  at(crowd - 0.05, 200, 3); // (before it)
  at(crowd, 200, 3); // (a good pass)
  at(crowd + 0.05, 200, 3);
  at(crowd, 450, 3); // (too high)
  at(crowd - 0.05, 450, 3);
  at(crowd, 200, 2); // (a wingman out)
  at(crowd + 0.05, 200, 3);
  expect(R.apart.passes).toBe(1);
  at(crowd, 150, 3);
  at(crowd - 0.05, 150, 3);
  at(crowd, 150, 3);
  at(crowd + 0.05, 150, 3);
  console.log(`  ${said.join(" · ")}`);
  expect(R.state.passes).toBe("done");
  expect(R.status).toBe("won");
});

test("a raid near the carrier fails the defence; a qualification's objective passed, or failed", () => {
  const spec = AIR_MISSIONS.find((m) => m.id === "carrier-defence")!.make();
  const R = newRun(spec);
  const ford = { lat: 42.6, lon: 7.4, alt: 20, alive: true };
  missionStep(R, world({ lat: 42.8, lon: 7.5 }, {}, { ford, n1: { lat: 43.0, lon: 8.0, alt: 6000, alive: true } }), 1);
  expect(R.status).toBe("flying");
  // (shot down: no longer a threat, even near)
  missionStep(R, world({ lat: 42.8, lon: 7.5 }, {}, { ford, n1: { lat: 42.65, lon: 7.45, alt: 6000, alive: false } }), 1);
  expect(R.status).toBe("flying");
  missionStep(R, world({ lat: 42.8, lon: 7.5 }, {}, { ford, n2: { lat: 42.7, lon: 7.5, alt: 6000, alive: true } }), 1);
  expect(R.status).toBe("failed");
  expect(R.why).toBe("A raid reached the Ford");
  // (a qualification)
  const q = AIR_MISSIONS.find((m) => m.id === "qual-night")!.make() as MissionSpec;
  const A = newRun(q);
  missionStep(A, world({ lat: 42.6, lon: 7.5 }, { qual: null }), 1);
  expect(A.status).toBe("flying");
  missionStep(A, world({ lat: 42.6, lon: 7.5 }, { qual: { qual: "night", qualified: true, gpa: 3.5 } }), 1);
  expect(A.status).toBe("won");
  const B = newRun(q);
  missionStep(B, world({ lat: 42.6, lon: 7.5 }, { qual: { qual: "night", qualified: false, gpa: 2.25 } }), 1);
  expect(B.status).toBe("failed");
  expect(B.why).toContain("2.25");
});
