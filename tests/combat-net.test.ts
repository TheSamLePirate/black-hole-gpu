import { expect, test } from "bun:test";
import { CombatWorld, LOADOUTS, type Player, type V3 } from "../src/game/combat";

// PLAN-RESEAU R3: the fight's world with other players in it — their craft as targets placed from the network,
// a hit on them sent (not applied here: their damage is theirs), their team-mates not locked nor hurt, the
// aggressors going after the nearest player and their hits on another sent too, another's hit taken, another's
// decoys drawing our missiles, the others' missiles warned of.

const flat = () => 0;
const seeded =
  (s = 1) =>
  () =>
    (s = (s * 16807) % 2147483647) / 2147483647;
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

const peer = (slot: number, p: V3, o: { friendly?: boolean; v?: V3 } = {}) => ({
  slot,
  name: `P${slot}`,
  p,
  v: o.v ?? ([250, 0, 0] as V3),
  fwd: [1, 0, 0] as V3,
  up: [0, 0, 1] as V3,
  alive: true,
  friendly: !!o.friendly,
});

test("the gun on another player 400 m ahead: the hits sent to him, none applied here", () => {
  const W = new CombatWorld([], LOADOUTS.gun, flat, seeded());
  const P = level([0, 0, 3000]);
  let other: V3 = [400, 0, 3000];
  W.setPeers([peer(2, other)]);
  W.firing = true;
  run(W, P, 1.2, () => {
    other = [other[0] + 250 / 60, 0, 3000];
    W.setPeers([peer(2, other)]);
  });
  const hits = W.netHits.filter((h) => h.peer === 2);
  expect(hits.length).toBeGreaterThan(3);
  expect(hits.every((h) => h.by === "gun" && h.damage > 0)).toBe(true);
  expect(W.target(10_002)!.alive).toBe(true);
});

test("a team-mate: never locked, never hurt (friendly fire off); hurt with it on", () => {
  const W = new CombatWorld([], LOADOUTS.aa, flat, seeded());
  const P = level([0, 0, 3000]);
  W.setPeers([peer(1, [3000, 0, 3000], { friendly: true })]);
  W.scan(P);
  expect(W.cycleLock(P)).toBeNull();
  let other: V3 = [400, 0, 3000];
  W.setPeers([peer(1, other, { friendly: true })]);
  W.firing = true;
  run(W, P, 1, () => {
    other = [other[0] + 250 / 60, 0, 3000];
    W.setPeers([peer(1, other, { friendly: true })]);
  });
  expect(W.netHits.length).toBe(0);
  W.opts.friendlyFire = true;
  run(W, P, 1, () => {
    other = [other[0] + 250 / 60, 0, 3000];
    W.setPeers([peer(1, other, { friendly: true })]);
  });
  expect(W.netHits.length).toBeGreaterThan(0);
});

test("the host's aggressor goes after the nearest player — another —, its missile at him, the hit sent", () => {
  const W = new CombatWorld([{ kind: "fighter", at: [6000, 0, 3000], hdg: 270, speed: 260 }], LOADOUTS.aa, flat, seeded());
  // (the host far west, the other player close east of the aggressor, coming at it)
  // (the host far east behind it, the other player west, head-on to it)
  const P = level([40_000, 0, 3000]);
  let other: V3 = [-6000, 0, 3000];
  W.setPeers([peer(3, other, { v: [250, 0, 0] })]);
  const ev = run(W, P, 30, () => {
    other = [other[0] + 250 / 60, 0, 3000];
    W.setPeers([peer(3, other, { v: [250, 0, 0] })]);
  });
  const launch = ev.find((e) => e.kind === "launch" && e.who === "red");
  expect(launch).toBeDefined();
  expect(W.missiles.some((m) => m.owner === "red" && m.target === 10_003) || W.netHits.some((h) => h.peer === 3)).toBe(true);
  expect(W.damage).toBe(0);
});

test("another's hit taken here; invulnerable: counted, no damage", () => {
  const W = new CombatWorld([], LOADOUTS.aa, flat, seeded());
  const ev = W.hurt(40, "aim9x");
  expect(W.damage).toBe(40);
  expect(ev.some((e) => e.kind === "hit" && e.on === "player")).toBe(true);
  W.opts.invulnerable = true;
  W.hurt(40, "gun");
  expect(W.damage).toBe(40);
  W.opts.invulnerable = false;
  const down = W.hurt(70, "aim120");
  expect(down.some((e) => e.kind === "playerDown")).toBe(true);
  W.respawn(LOADOUTS.aa);
  expect(W.damage).toBe(0);
  expect(W.stores.aim120).toBe(4);
});

test("a guest's world: the host's aggressors placed, not stepped; a hit on one sent to the host", () => {
  const W = new CombatWorld([{ kind: "drone", at: [500, 0, 3000], hdg: 90, speed: 120 }], LOADOUTS.gun, flat, seeded());
  W.markRemote();
  const P = level([0, 0, 3000]);
  W.setRemoteTargets([{ id: 1, p: [500, 0, 3000], v: [120, 0, 0], fwd: [1, 0, 0], up: [0, 0, 1], alive: true }]);
  W.firing = true;
  run(W, P, 1);
  expect(W.netHits.some((h) => h.target === 1)).toBe(true);
  expect(W.target(1)!.hp).toBe(30);
  // (not stepped: still where the host put it, plus nothing of its own)
  expect(W.target(1)!.p[0]).toBe(500);
});

test("the others' missiles: one at us warned (the player's threat), carried between samples; gone when no longer sent", () => {
  const W = new CombatWorld([], LOADOUTS.aa, flat, seeded());
  const P = level([0, 0, 3000]);
  W.setRemoteMissiles([{ key: "2:7", kind: "aim9x", p: [2000, 0, 3000], v: [-700, 0, 0], atMe: true, red: true }]);
  run(W, P, 0.5);
  const m = W.missiles.find((x) => x.remote === "2:7")!;
  expect(m.target).toBe(-1);
  expect(m.p[0]).toBeLessThan(1700);
  W.setRemoteMissiles([]);
  expect(W.missiles.some((x) => x.remote)).toBe(false);
});

test("another's decoys draw our IR missile off him (without: it hits)", () => {
  const shot = (k: number, decoys: boolean) => {
    const W = new CombatWorld([], LOADOUTS.aa, flat, seeded(k));
    const P = level([0, 0, 3000]);
    let other: V3 = [2500, 0, 3000];
    W.setPeers([peer(2, other)]);
    W.scan(P);
    W.cycleLock(P);
    W.launch(P, "aim9x");
    run(W, P, 8, (t) => {
      other = [other[0] + 250 / 60, 0, 3000];
      W.setPeers([peer(2, other)]);
      if (decoys && Math.abs(t - 0.5) < 1 / 120) W.addDecoys(other, [250, 0, 0]);
    });
    return W.netHits.some((h) => h.peer === 2);
  };
  const hits = (decoys: boolean) => Array.from({ length: 10 }, (_, k) => shot(k + 1, decoys)).filter(Boolean).length;
  expect(hits(false)).toBe(10);
  expect(hits(true)).toBeLessThan(10);
});
