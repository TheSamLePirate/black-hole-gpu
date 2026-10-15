import { afterEach, describe, expect, test } from "bun:test";
import { GStrain } from "../src/game/gstrain";
import { cruise, withStick } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The pilot's body under load (docs/PLAN-AVIATION-AAA.md, V5; game/gstrain.ts): a brief pull borne, a held one
// greying the view — sooner as he tires —, the black-out held: G-LOC, eight seconds out, four coming to; the red-out
// of a push; in the F-35 itself, passed out, his hands off the controls; without the computer past 30°, the warning.

afterEach(resetFlights);

/** The body under a load held `s` seconds, stepped at 30 Hz. */
const held = (B: GStrain, n: number, s: number) => {
  for (let i = 0; i < s * 30; i++) B.step(n, 1 / 30);
  return B;
};

describe("the pilot's body under load", () => {
  test("a brief 7 g pull borne; held, the view greys — and sooner as he tires", () => {
    const brief = held(new GStrain(), 7, 1.5);
    expect(brief.grey).toBeLessThan(0.3);
    expect(brief.black).toBe(0);
    const B = held(new GStrain(), 7, 6);
    const early = B.grey;
    held(B, 7, 25);
    console.log(
      `  7 g: grey ${early.toFixed(2)} at 6 s, ${B.grey.toFixed(2)} at 31 s (tired ${B.fatigue.toFixed(2)} g); black ${B.black.toFixed(2)}`,
    );
    expect(B.grey).toBeGreaterThan(early + 0.15);
    expect(B.black).toBe(0);
    // (rested at 1 g: his tolerance back)
    held(B, 1, 90);
    expect(B.fatigue).toBeLessThan(0.1);
  });

  test("9 g held: the black-out, then G-LOC — eight seconds out, four coming to", () => {
    const B = new GStrain();
    let t = 0;
    while (!B.gloc && t < 20) {
      B.step(9, 1 / 30);
      t += 1 / 30;
    }
    console.log(`  9 g: passed out after ${t.toFixed(1)} s`);
    expect(B.gloc).toBe(true);
    expect(t).toBeGreaterThan(4);
    held(B, 1, 7.5);
    expect(B.gloc).toBe(true);
    held(B, 1, 1);
    expect(B.gloc).toBe(false);
    expect(B.black).toBeGreaterThan(0.5);
    held(B, 1, 4.5);
    expect(B.black).toBeLessThan(0.05);
  });

  test("a push held at −3 g: the red-out", () => {
    const B = held(new GStrain(), -3, 4);
    expect(B.red).toBeGreaterThan(0.5);
    expect(B.grey).toBe(0);
  });
});

describe("in the F-35", () => {
  test("passed out (G-LOC): his hand off the stick — the full aft stick held, the load let go, the law flying on", () => {
    const { c, fly } = cruise(5000, 280, 1);
    c.s.f35GEffects = true;
    let pulled = 0,
      after = 0;
    withStick(c, { pitch: 1 }, () => {
      fly(1.5);
      pulled = c.flightInfo().air!.nz;
      // (his black-out held: out — as the body's model says past 9 g held)
      c.gStrain.out = 8;
      fly(3);
      after = c.flightInfo().air!.nz;
    });
    console.log(`  full aft: ${pulled.toFixed(1)} g; out 3 s, the stick still full aft: ${after.toFixed(1)} g`);
    expect(pulled).toBeGreaterThan(5);
    expect(c.flightInfo().body.gloc).toBe(true);
    expect(after).toBeLessThan(2);
  }, 60_000);

  test("without its computer past 30° of incidence: ANGLE OF ATTACK", () => {
    const { c, fly } = cruise(5000, 110, 0);
    c.s.f35Law = "direct";
    withStick(c, { pitch: 1 }, () => fly(2.5));
    const air = c.flightInfo().air!;
    console.log(`  α ${((air.alpha * 180) / Math.PI).toFixed(0)}°: warning ${air.aoaWarn}`);
    expect(air.aoaWarn).toBe(true);
  }, 60_000);
});
