import { afterEach, expect, test } from "bun:test";
import { CombatWorld, LOADOUTS, type Player, type V3 } from "../src/game/combat";
import { FREE_FIGHT, FREE_RULES, type Match, ScoreSheet, scenarioOf } from "../src/game/match";
import { Radar, type RadarObject } from "../src/game/radar";
import { proxyStep, worldIdOf } from "../src/controller/fightproxy";
import { fleet } from "../src/fleet";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The free fight (a room's F-35s outside a match): everyone a target — no team, friendly fire on, no score to reach,
// no end —; a co-op match's pilots one side; the radar weapons free (a friend's datalink track locked); an outside
// craft (a real airliner on the radar) taken into the fight as a stand-in — placed from the radar's picture, not
// flown by the fight, not drawn alive —, shot down: the real one gone. The AI's flight smooth: its bank eased in and
// out (a jerk limit), the same path whatever the frame rate; the ground under the fight read between its grid's nodes.

afterEach(() => resetFlights());

const flat = () => 0;
const seeded =
  (s = 1) =>
  () =>
    (s = (s * 16807) % 2147483647) / 2147483647;

test("the free fight's rules: everyone against everyone, friendly fire on, no end; co-op pilots one side", () => {
  const m: Match = { id: "free", mode: "free", def: "free", host: -1, start: 0, rules: FREE_RULES, pilots: [0, 1, 2], teams: {} };
  const S = new ScoreSheet(m);
  expect(S.sameTeam(0, 1)).toBe(false);
  expect(S.over(1e6, 0)).toBeNull();
  expect(FREE_RULES.friendlyFire).toBe(true);
  expect(scenarioOf(m)).toBe(FREE_FIGHT);
  expect(FREE_FIGHT.loadout).toBe("aa");
  // (co-op: the pilots together against the aggressors — not each other's targets)
  const co = new ScoreSheet({ ...m, mode: "coop", def: "drones" });
  expect(co.sameTeam(0, 2)).toBe(true);
  expect(co.sameTeam(0, -1)).toBe(false);
});

test("weapons free: a friend's datalink track locked; otherwise never", () => {
  const R = new Radar();
  const own = { v: [0, 250, 0] as V3, fwd: [0, 1, 0] as V3, right: [1, 0, 0] as V3, up: [0, 0, 1] as V3, alt: 5000, agl: 5000 };
  const friend: RadarObject = {
    id: "wng:2",
    r: [40, -40, 0],
    v: [0, 250, 0],
    rcs: 4,
    kind: "air",
    iff: "friend",
    name: "Two",
    squawk: true,
    offboard: true,
  };
  for (let i = 0; i < 30; i++) R.step(0.1, i * 0.1, own, [friend], () => false);
  expect(R.lockNext()).toBeNull();
  expect(R.lockOn("wng:2")).toBe(false);
  R.weaponsFree = true;
  expect(R.lockNext()).toBe("wng:2");
});

test("an airliner on the radar taken into the free fight, shot down by the gun: the real one gone, the room told", () => {
  const a = cruise(4000, 200, 0.7);
  const c = a.c;
  fleet.fuel.f35 = 5000;
  a.fly(1);
  const g = c.geoNow()!;
  c.combatStart({ ...FREE_FIGHT, anchor: { lat: g.lat, lon: g.lon } }, { host: true, rules: FREE_RULES });
  c.combat!.free = true;
  // (a real airliner 450 m ahead on our heading, as the traffic's radar source would give it)
  let ahead = 450;
  // (its own source's key: the traffic's own is the traffic controller's, cleared with no feed)
  c.radarSources.set("test-trf", (fix) => {
    const f = fix.own.fwd;
    return [
      {
        id: "trf:abc123",
        r: [f[0] * ahead, f[1] * ahead, f[2] * ahead],
        v: [0, 0, 0].map((_, k) => fix.own.v[k]!) as V3,
        rcs: 40,
        kind: "air",
        iff: "neutral",
        name: "AFR123",
        squawk: true,
      },
    ];
  });
  const down: string[] = [];
  c.onProxyDown = (key, name) => down.push(`${key} ${name}`);
  a.fly(1, () => {
    ahead = 450;
    return false;
  });
  const id = c.combat!.proxies?.get("trf:abc123");
  expect(id).toBeDefined();
  const q = c.combat!.world.target(id!)!;
  expect(q.proxy).toBe("trf:abc123");
  expect(q.neutral).toBe(true);
  // (its place the radar's: 450 m ahead of us, not flown by the fight)
  const P = c.combat!.last!;
  expect(Math.abs(Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]) - 450)).toBeLessThan(30);
  // (no double: the fight's radar source leaves it out while alive)
  expect(c.radarObjects.filter((o) => o.id === `cmb:${id}`).length).toBe(0);
  expect(worldIdOf(c, "trf:abc123")).toBe(id!);
  c.gunTrigger = true;
  a.fly(8, () => !q.alive);
  c.gunTrigger = false;
  console.log(`  ${down.join(", ")}; taken: ${[...(c.trafficTaken ?? [])].join(", ")}`);
  expect(q.alive).toBe(false);
  expect(down).toEqual(["trf:abc123 AFR123"]);
  expect(c.trafficTaken?.has("abc123")).toBe(true);
  // (its source gone with it: the wreck the fight's, falling)
  c.radarSources.delete("test-trf");
  proxyStep(c);
  expect(c.combat!.world.target(id!)).toBeDefined();
}, 120_000);

/** A fighter on patrol round its centre, its bank (the angle of its top from the vertical about its nose) each frame. */
function patrolBanks(dts: number[], secs: number) {
  const W = new CombatWorld([{ kind: "fighter", at: [8000, 0, 3000], hdg: 0, speed: 250 }], LOADOUTS.gun, flat, seeded());
  W.opts.enemyMissiles = false;
  // (the player far away: it patrols)
  const P: Player = { p: [0, -200_000, 3000], v: [0, 0, 0], fwd: [0, 1, 0], up: [0, 0, 1] };
  const q = W.targets[0]!;
  const out: { t: number; bank: number; p: V3 }[] = [];
  let t = 0;
  let i = 0;
  while (t < secs) {
    const dt = dts[i++ % dts.length]!;
    W.step(dt, P);
    t += dt;
    const f = q.fwd;
    const hz = Math.hypot(f[0], f[1]) || 1;
    const right: V3 = [f[1] / hz, -f[0] / hz, 0];
    out.push({ t, bank: Math.atan2(q.up[0] * right[0] + q.up[1] * right[1], q.up[2]), p: [...q.p] });
  }
  return out;
}

test("the AI's flight smooth: the bank eased (no snap), the path the same at an uneven frame rate", () => {
  const even = patrolBanks([1 / 60], 60);
  const uneven = patrolBanks([1 / 60, 1 / 30, 1 / 45, 1 / 90], 60);
  // (the bank's rate: under its roll's — never a frame's jump of tens of degrees)
  let worst = 0;
  for (let i = 1; i < uneven.length; i++)
    worst = Math.max(worst, Math.abs(uneven[i]!.bank - uneven[i - 1]!.bank) / (uneven[i]!.t - uneven[i - 1]!.t));
  // (the same place a minute on, whatever the frames)
  const a = even.at(-1)!,
    b = uneven.at(-1)!;
  const gap = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  console.log(`  the bank's rate at most ${((worst * 180) / Math.PI).toFixed(0)}°/s; a minute on, ${gap.toFixed(1)} m apart`);
  expect((worst * 180) / Math.PI).toBeLessThan(200);
  expect(gap).toBeLessThan(150);
});

test("the ground under the fight read between its grid's nodes: no step at a cell's edge", () => {
  const W = new CombatWorld([], LOADOUTS.gun, (e) => (e < 250 ? 0 : 100), seeded());
  const z = [0, 60, 120, 124, 126, 130, 200, 249, 251].map((e) => W.groundZ(e, 0));
  for (let i = 1; i < z.length; i++) expect(z[i]!).toBeGreaterThanOrEqual(z[i - 1]!);
  expect(W.groundZ(125, 0)).toBeCloseTo(50, 0);
});
