import { expect, test } from "bun:test";
import { ResumePoints } from "../src/game/resume-point";
import type { GameSave } from "../src/game/save";

// The craft lost's Resume (audit FX-10): the points belong to one flight and one craft; an aircraft gets recent ones
// every 10 s of steady flight and resumes from the newest at least 15 s old; the entry's hook, raised every frame of thin
// air, keeps one at most a second.

let n = 0;
const take = () => ({ name: `p${++n}` }) as unknown as GameSave;
/** frames of flight in the air, each settled after its step (as sim.ts afterStep does) */
const fly = (r: ResumePoints, flight: number, s: number, g = 1) => {
  for (let i = 0; i < Math.round(s * 30); i++) {
    r.onAir(flight, "f35", 1 / 30, g);
    r.settle(flight, take);
  }
};

test("a point is the lost flight's own: a new flight or another craft gets none", () => {
  const r = new ResumePoints();
  r.onEntry(1, "ranger");
  // (due, not taken inside the step: taken once it is whole)
  expect(r.pick(1, "ranger")).toBeNull();
  r.settle(1, take);
  expect(r.pick(1, "ranger")?.kind).toBe("entry");
  // (another craft in the same flight — switched to —: not its point)
  expect(r.pick(1, "f35")).toBeNull();
  // (a new flight — a placement, a scene, a load —: the last one's let go)
  expect(r.pick(2, "ranger")).toBeNull();
  r.onAir(2, "f35", 1 / 30, 1);
  r.settle(2, take);
  expect(r.pick(1, "ranger")).toBeNull();
});

test("an aircraft: recent points every 10 s, taken only when steady; the one resumed at least 15 s old", () => {
  const r = new ResumePoints(10, 15, 4);
  fly(r, 5, 9.9);
  expect(r.pick(5, "f35")).toBeNull();
  // (due, but pulling 6 g: waits for steady flight)
  fly(r, 5, 2, 6);
  expect(r.pick(5, "f35")).toBeNull();
  fly(r, 5, 1 / 30);
  expect(r.pick(5, "f35")?.kind).toBe("recent");
  // (35 s flown in all: points near 12, 22, 32 s — the newest ≥ 15 s old is the one near 12 s; at 50 s, the one near 32)
  fly(r, 5, 23);
  expect(r.airTime - r.pick(5, "f35")!.at).toBeGreaterThanOrEqual(15);
  expect(r.airTime - r.pick(5, "f35")!.at).toBeLessThan(25);
  fly(r, 5, 60);
  expect(r.recent.length).toBe(4);
  const age = r.airTime - r.pick(5, "f35")!.at;
  expect(age).toBeGreaterThanOrEqual(15);
  expect(age).toBeLessThan(25);
});

test("the entry's hook every frame keeps one point a second, the latest; the entry's preferred to a recent one", () => {
  const r = new ResumePoints();
  let taken = 0;
  const count = () => (taken++, take());
  for (let i = 0; i < 3 * 30; i++) {
    r.onAir(7, "ranger", 1 / 30, 1);
    r.onEntry(7, "ranger");
    r.settle(7, count);
  }
  expect(taken).toBeGreaterThanOrEqual(3);
  expect(taken).toBeLessThanOrEqual(4);
  for (let i = 0; i < 40 * 30; i++) {
    r.onAir(7, "ranger", 1 / 30, 1);
    r.settle(7, take);
  }
  expect(r.recent.length).toBeGreaterThan(0);
  expect(r.pick(7, "ranger")?.kind).toBe("entry");
});

test("a point resumed is kept for the flight it begins: lost again, resumed again", () => {
  const r = new ResumePoints();
  fly(r, 9, 31);
  const p = r.pick(9, "f35")!;
  // (the load makes a new flight: 10)
  r.adopt(p, 10);
  expect(r.pick(10, "f35")?.save).toBe(p.save);
  expect(r.pick(10, "f35")?.at).toBe(0);
});
