import { describe, expect, test } from "bun:test";
import { Frost, sinceWiped, Wiper, wetAfter } from "../src/a320/glass";

// The A320's windshield (docs/PLAN-A320.md, A13 — src/a320/glass.ts): the wipers as FlightGear's channel moves them —
// a stroke out and back at LO in some 0.63 s, faster at HI, finishing to rest once OFF, still without DC 1 —; the time
// since an arm passed a point; the glass wet again after; the frost growing in icing and cleared by the window heat.

describe("A320 windshield", () => {
  test("the wipers: LO, HI, OFF back to rest, no power", () => {
    const W = new Wiper();
    let t = 0,
      peaks = 0,
      was = 0;
    for (; t < 6.33; t += 0.01) {
      const p = W.step(1, true, 0.01);
      if (p >= 0.999 && was < 0.999) peaks++;
      was = p;
    }
    // (LO: 3.167 a second — a stroke out and back each 0.63 s)
    expect(peaks).toBeGreaterThanOrEqual(9);
    expect(peaks).toBeLessThanOrEqual(10);
    const H = new Wiper();
    let hp = 0;
    was = 0;
    for (let k = 0; k < 633; k++) {
      const p = H.step(2, true, 0.01);
      if (p >= 0.999 && was < 0.999) hp++;
      was = p;
    }
    expect(hp).toBeGreaterThan(peaks + 3);
    // (OFF mid-stroke: back to rest, then still)
    const O = new Wiper();
    for (let k = 0; k < 15; k++) O.step(1, true, 0.01);
    expect(O.pos).toBeGreaterThan(0.3);
    for (let k = 0; k < 100; k++) O.step(0, true, 0.01);
    expect(O.pos).toBe(0);
    // (no DC 1: it stops where it is)
    const N = new Wiper();
    for (let k = 0; k < 10; k++) N.step(1, true, 0.01);
    const at = N.pos;
    for (let k = 0; k < 50; k++) N.step(1, false, 0.01);
    expect(N.pos).toBe(at);
  });

  test("the time since a wipe, the glass wet again", () => {
    // (going out at 0.5: a point behind it passed (0.5 − 0.2) / 3.167 s ago, one ahead on the stroke back)
    expect(sinceWiped(0.2, 0.5, 3.167)).toBeCloseTo(0.3 / 3.167, 6);
    expect(sinceWiped(0.8, 0.5, 3.167)).toBeCloseTo(1.3 / 3.167, 6);
    expect(sinceWiped(0.8, 0.5, -3.167)).toBeCloseTo(0.3 / 3.167, 6);
    expect(sinceWiped(0.2, 0.5, -3.167)).toBeCloseTo(1.3 / 3.167, 6);
    expect(sinceWiped(0.3, 0, 0)).toBe(Number.POSITIVE_INFINITY);
    // (parked 2 s ago: the sweep's end wiped 2.3 s ago)
    expect(sinceWiped(1, 0, 102)).toBeCloseTo(2 + 1 / 3.167, 6);
    const W = new Wiper();
    for (let k = 0; k < 70; k++) W.step(1, true, 0.01);
    for (let k = 0; k < 100; k++) W.step(0, true, 0.01);
    expect(W.shaderRate).toBeGreaterThan(100);
    expect(W.shaderRate).toBeLessThan(101);
    // (a downpour wets it again within a second; never wiped: wet)
    expect(wetAfter(0.1, 1)).toBeLessThan(0.3);
    expect(wetAfter(1.5, 1)).toBeGreaterThan(0.95);
    expect(wetAfter(Number.POSITIVE_INFINITY, 0.3)).toBe(1);
  });

  test("the frost: rime in icing, the window heat clears it in a minute", () => {
    const F = new Frost();
    for (let t = 0; t < 120; t += 0.5) F.step({ oatC: -8, wet: 1, heat: false, onGround: false }, 0.5);
    expect(F.ice).toBe(1);
    let t = 0;
    for (; F.ice > 0 && t < 200; t += 0.5) F.step({ oatC: -8, wet: 1, heat: true, onGround: false }, 0.5);
    expect(t).toBeGreaterThan(50);
    expect(t).toBeLessThan(70);
    // (warm and dry: none)
    const G = new Frost();
    for (let k = 0; k < 600; k++) G.step({ oatC: 15, wet: 1, heat: false, onGround: true }, 0.5);
    expect(G.ice).toBe(0);
  });
});
