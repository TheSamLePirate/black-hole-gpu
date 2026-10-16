import { expect, test } from "bun:test";
import { CombatWorld, fallPoint, gunLead, launchZone, LOADOUTS, type Player, type V3 } from "../src/game/combat";

const flat = () => 0;
/** a seeded random (the tests' draws the same each run) */
const seeded =
  (s = 1) =>
  () =>
    (s = (s * 16807) % 2147483647) / 2147483647;

/** The player flying level east at a speed and height, its nose along. */
const level = (p: V3, speed = 250): Player => ({ p, v: [speed, 0, 0], fwd: [1, 0, 0], up: [0, 0, 1] });

function run(W: CombatWorld, P: Player, secs: number, each?: (t: number) => void) {
  const ev = [];
  for (let t = 0; t < secs; t += 1 / 60) {
    each?.(t);
    P.p = [P.p[0] + P.v[0] / 60, P.p[1] + P.v[1] / 60, P.p[2] + P.v[2] / 60];
    ev.push(...W.step(1 / 60, P));
  }
  return ev;
}

test("the radar sees the drone ahead, locks it; an AIM-120 flies to it by proportional navigation and kills it", () => {
  const W = new CombatWorld([{ kind: "drone", at: [25_000, 3000, 5000], hdg: 0, speed: 120 }], LOADOUTS.aa, flat, seeded());
  const P = level([0, 0, 5000]);
  W.scan(P);
  expect(W.seen.length).toBe(1);
  expect(W.cycleLock(P)).toBe(W.targets[0]!.id);
  expect(W.pick(P)).toBe("aim120");
  expect(launchZone("aim120", P, W.targets[0]!).inRange).toBe(true);
  W.launch(P, "aim120");
  expect(W.stores.aim120).toBe(3);
  const ev = run(W, P, 60);
  expect(ev.some((e) => e.kind === "kill")).toBe(true);
  expect(W.targets[0]!.alive).toBe(false);
});

test("an AIM-9X off the rail at a crossing drone 4 km ahead, no lock: its seeker finds it", () => {
  const W = new CombatWorld([{ kind: "drone", at: [4000, 300, 3000], hdg: 0, speed: 120 }], LOADOUTS.aa, flat, seeded());
  const P = level([0, 0, 3000]);
  expect(W.launch(P, "aim9x")?.target).toBe(W.targets[0]!.id);
  const ev = run(W, P, 20);
  expect(ev.some((e) => e.kind === "kill" && e.by === "aim9x")).toBe(true);
});

test("the gun: aimed on its lead at a drone 600 m ahead, its rounds kill it", () => {
  const W = new CombatWorld([{ kind: "drone", at: [600, 40, 3000], hdg: 90, speed: 120 }], LOADOUTS.gun, flat, seeded());
  const P = level([0, 0, 3000], 200);
  const q = W.targets[0]!;
  const L = gunLead(P, q)!;
  expect(L.tof).toBeLessThan(1);
  P.fwd = L.dir;
  W.firing = true;
  const ev = run(W, P, 1.5, () => {
    const l = gunLead(P, q);
    if (l) P.fwd = l.dir;
  });
  expect(W.stores.gun).toBeLessThan(220);
  expect(ev.filter((e) => e.kind === "hit").length).toBeGreaterThan(2);
  expect(q.alive).toBe(false);
});

test("a JDAM released 4 km short at 6 000 m glides onto the truck", () => {
  const W = new CombatWorld([{ kind: "truck", at: [7000, 200, 0] }], LOADOUTS.ag, flat, seeded());
  const P = level([0, 0, 6000], 230);
  const fp = fallPoint(P, flat);
  expect(fp[0]).toBeGreaterThan(3000);
  W.drop(P, [...W.targets[0]!.p]);
  const ev = run(W, P, 60);
  expect(ev.some((e) => e.kind === "kill" && e.by === "jdam")).toBe(true);
});

test("flares: an R-73 chasing the player is drawn off by some of them", () => {
  let decoyed = 0;
  for (let s = 1; s <= 20; s++) {
    const W = new CombatWorld([{ kind: "fighter", at: [-6000, 0, 4000], hdg: 90, speed: 260 }], LOADOUTS.aa, flat, seeded(s));
    const P = level([0, 0, 4000]);
    W.targets[0]!.ai!.nextShot = 0;
    const ev = run(W, P, 25, (t) => {
      if (W.missiles.some((m) => m.owner === "red") && Math.floor(t * 2) !== Math.floor((t - 1 / 60) * 2)) W.countermeasure(P);
    });
    if (ev.some((e) => e.kind === "decoyed")) decoyed++;
  }
  expect(decoyed).toBeGreaterThan(8);
});

test("an aggressor engages: it turns onto the player, fires its missile, a missile unopposed hits", () => {
  const W = new CombatWorld([{ kind: "fighter", at: [8000, 2000, 4000], hdg: 270, speed: 260 }], LOADOUTS.aa, flat, seeded(3));
  const P = level([0, 0, 4000]);
  const ev = run(W, P, 60);
  expect(ev.some((e) => e.kind === "launch" && e.who === "red")).toBe(true);
  expect(W.damage).toBeGreaterThan(0);
});

test("the SAM site fires at a player high over it, not at one under 150 m", () => {
  const low = new CombatWorld([{ kind: "sam", at: [15_000, 0, 0] }], LOADOUTS.ag, flat, seeded());
  const evLow = run(low, level([0, 0, 100]), 20);
  expect(evLow.some((e) => e.kind === "launch")).toBe(false);
  const high = new CombatWorld([{ kind: "sam", at: [15_000, 0, 0] }], LOADOUTS.ag, flat, seeded());
  const evHigh = run(high, level([0, 0, 4000]), 20);
  expect(evHigh.some((e) => e.kind === "launch" && e.missile === "sam")).toBe(true);
});

test("an aircraft shot down: out of control — falling, its nose dropping, rolling —, its explosion where it hits the ground", () => {
  const W = new CombatWorld([{ kind: "drone", at: [25_000, 3000, 5000], hdg: 0, speed: 120 }], LOADOUTS.aa, flat, seeded());
  const P = level([0, 0, 5000]);
  W.scan(P);
  W.cycleLock(P);
  W.launch(P, "aim120");
  const q = W.targets[0]!;
  // (hit: its damage share; destroyed: the hit's burst — small — and out of control)
  expect(W.damageOf(q)).toBe(0);
  let ev: ReturnType<CombatWorld["step"]> = [];
  for (let t = 0; t < 60 && q.alive; t += 1 / 60) ev.push(...run(W, P, 1 / 60));
  ev.push(...run(W, P, 0.1));
  const kill = ev.findIndex((e) => e.kind === "kill");
  expect(kill).toBeGreaterThanOrEqual(0);
  expect(ev.find((e, i) => i > kill && e.kind === "explode")).toMatchObject({ size: 0.5 });
  expect(W.damageOf(q)).toBe(1);
  expect(q.wreck && Number.isNaN(q.wreck.crashedAt)).toBe(true);
  // (falling: the nose down to where it goes, its top turning round it, never faster than its drag allows)
  let nose = 0,
    vMax = 0,
    turned = 0;
  const up0 = [...q.up];
  ev = run(W, P, 120, () => {
    nose = Math.min(nose, q.fwd[2]);
    vMax = Math.max(vMax, Math.hypot(...q.v));
    turned = Math.max(turned, Math.acos(Math.min(1, up0[0]! * q.up[0] + up0[1]! * q.up[1] + up0[2]! * q.up[2])));
  });
  expect(nose).toBeLessThan(-0.8);
  expect(turned).toBeGreaterThan(1.5);
  expect(vMax).toBeLessThan(200);
  const crash = ev.find((e) => e.kind === "crash");
  expect(crash).toBeDefined();
  expect(ev.find((e) => e.kind === "explode" && e.size > 2)).toBeDefined();
  expect(q.p[2]).toBe(0);
  expect(Number.isNaN(q.wreck!.crashedAt)).toBe(false);
  // (once: no second explosion)
  expect(run(W, P, 5).some((e) => e.kind === "explode")).toBe(false);
});

test("a hit aircraft's damage share: what its hits took of its strength", () => {
  const W = new CombatWorld([{ kind: "fighter", at: [8000, 2000, 4000], hdg: 270, speed: 260 }], LOADOUTS.aa, flat, seeded(3));
  const q = W.targets[0]!;
  q.hp = 40;
  expect(W.damageOf(q)).toBeCloseTo(0.6);
});

test("the fight over, the wreck still falls to its crash", () => {
  const W = new CombatWorld([{ kind: "drone", at: [25_000, 3000, 5000], hdg: 0, speed: 120 }], LOADOUTS.aa, flat, seeded());
  const P = level([0, 0, 5000]);
  W.scan(P);
  W.cycleLock(P);
  W.launch(P, "aim120");
  for (let t = 0; t < 60 && W.targets[0]!.alive; t += 1 / 60) run(W, P, 1 / 60);
  expect(W.falling()).toBe(true);
  const ev = [];
  for (let t = 0; t < 120 && W.falling(); t += 1 / 60) ev.push(...W.stepWrecks(1 / 60));
  expect(W.falling()).toBe(false);
  expect(W.falling(45)).toBe(true);
  expect(ev.some((e) => e.kind === "crash")).toBe(true);
});
