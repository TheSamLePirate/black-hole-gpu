import { expect, test } from "bun:test";
import { CamShake } from "../src/camshake";
import { sheetTrail, trailLook } from "../src/contrails";
import { GStrain } from "../src/ui/speedfx";

// PLAN-F35 F7: the flight's effects — the load felt at the eyes (a brief pull borne, a held one greying the
// view; a red-out under a negative load), the view shaken (the runway, the buffet, a touchdown), the high-g
// vapour sheet over the wing.

test("the load felt: 7 g held greys the edges, a brief 9 g pull does not black out; −3 g reddens", () => {
  const brief = new GStrain();
  for (let i = 0; i < 30; i++) brief.step(9, 1 / 60);
  expect(brief.grey).toBe(0);
  const held = new GStrain();
  for (let i = 0; i < 600; i++) held.step(7, 1 / 60);
  expect(held.grey).toBeGreaterThan(0.3);
  expect(held.grey).toBeLessThan(0.5);
  for (let i = 0; i < 600; i++) held.step(1, 1 / 60);
  expect(held.grey).toBe(0);
  const neg = new GStrain();
  for (let i = 0; i < 600; i++) neg.step(-3, 1 / 60);
  expect(neg.red).toBeGreaterThan(0.6);
});

test("the view shaken: nothing at rest, the runway's roll and the buffet felt, a touchdown's jolt", () => {
  const amp = (f: (k: number) => Parameters<CamShake["step"]>[0]) => {
    const c = new CamShake();
    let m = 0;
    for (let k = 0; k < 240; k++) {
      const s = c.step(f(k));
      m = Math.max(m, Math.abs(s.pitch), Math.abs(s.yaw), Math.abs(s.roll));
    }
    return m;
  };
  const base = { dt: 1 / 60, roll: 0, buffet: 0, transonic: 0, ab: 0, engine: 0, jolt: 0 };
  expect(amp(() => base)).toBe(0);
  const roll = amp(() => ({ ...base, roll: 70 }));
  const buffet = amp(() => ({ ...base, buffet: 1 }));
  const jolt = amp((k) => ({ ...base, jolt: k === 10 ? 3 : 0 }));
  expect(roll).toBeGreaterThan(0.001);
  expect(roll).toBeLessThan(0.01);
  expect(buffet).toBeGreaterThan(roll);
  expect(jolt).toBeGreaterThan(0.01);
});

test("the vapour sheet: only pulling hard at speed in dense warm air, and gone within a second", () => {
  expect(sheetTrail(1.0, 1.2, 290, 200)).toBeGreaterThan(0.9);
  expect(sheetTrail(0.3, 1.2, 290, 200)).toBe(0);
  expect(sheetTrail(1.0, 0.3, 230, 200)).toBe(0);
  // (each of its twelve ribbons faint — overlapping, a translucent sheet —, gone in a fifth of a second)
  expect(trailLook(2, 0.05, 1).tau).toBeGreaterThan(0.1);
  expect(trailLook(2, 0.25, 1).tau).toBe(0);
  // (a fighter's wingtip vortex: a thread, not the Ranger's rope)
  expect(trailLook(3, 0.5, 1).w).toBeLessThan(0.5 * trailLook(1, 0.5, 1).w);
});
