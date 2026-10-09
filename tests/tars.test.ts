import { expect, test } from "bun:test";
import { Tars, type TarsState } from "../src/game/tars";

// PLAN-TARS T5b: TARS offline — his answers from the flight's state (English or French questions), his
// honesty (rounder below 80 %, never on a danger) and humour (no aside at 0), his settings said aloud, his
// remarks unasked: rare.

const S: TarsState = {
  body: "Earth",
  altKm: 412.37,
  status: "In orbit",
  landed: false,
  docked: false,
  speed: 7668.4,
  fuel: 0.634,
  dv: 2137.8,
  target: { name: "Moon", distKm: 384123 },
  next: { kind: "enter", name: "Moon", inS: 3 * 86400 },
  stage: "orbit",
  auto: "none",
  dtau: null,
};
const plain = { honesty: 90, humour: 0 };

test("the questions, English and French: where, fuel, speed, target, next, what to do, who", () => {
  const t = new Tars(7);
  expect(t.answer("Where are we?", S, plain).text).toBe("412 kilometres above Earth. In orbit.");
  expect(t.answer("où sommes-nous ?", S, plain).text).toBe("412 kilometres above Earth. In orbit.");
  expect(t.answer("How much fuel?", S, plain).text).toBe("Fuel at 63 percent: 2,138 metres per second of delta-v.");
  expect(t.answer("carburant ?", S, plain).text).toContain("63 percent");
  // (the Ranger's relativistic engine: 0.29 c of Δv, said as such)
  expect(t.answer("fuel", { ...S, fuel: 1, dv: 87_216_224 }, plain).text).toBe(
    "Fuel at 100 percent: delta-v for 29 percent of the speed of light.",
  );
  expect(t.answer("What's our speed", S, plain).text).toBe("7,668 metres per second relative to Earth.");
  expect(t.answer("distance to the target", S, plain).text).toBe("Moon is 384,123 kilometres away.");
  expect(t.answer("when is the next event?", S, plain).text).toBe("In 3 days, we enter the sphere of influence of Moon.");
  expect(t.answer("what should I do?", S, plain).text).toContain("open the planner (0)");
  expect(t.answer("Qu'est-ce que je dois faire ?", S, plain).text).toContain("open the planner (0)");
  expect(t.answer("on fait quoi maintenant", S, plain).text).toContain("open the planner (0)");
  expect(t.answer("qui es-tu ?", S, plain).text).toContain("TARS.");
  expect(t.answer("blorp", S, plain).text).toContain("I don't understand");
});

test("honesty: exact at 90, two figures at 60, one at 30 — but a danger said exactly whatever it is", () => {
  const t = new Tars(3);
  expect(t.answer("fuel", S, { honesty: 60, humour: 0 }).text).toBe("Fuel at 63 percent: 2,100 metres per second of delta-v.");
  const vague = t.answer("fuel", S, { honesty: 30, humour: 0 }).text;
  expect(vague).toContain("Fuel at 60 percent: 2,000 metres per second");
  expect(vague).toContain("Probably.");
  const low = { ...S, fuel: 0.043, dv: 151.6 };
  expect(t.answer("fuel", low, { honesty: 10, humour: 0 }).text).toBe(
    "Fuel at 4 percent: 152 metres per second left. That's not a figure to be modest about.",
  );
  const impact = { ...S, next: { kind: "impact", name: "Moon", inS: 75 } };
  expect(t.answer("how long?", impact, { honesty: 0, humour: 100 }).text).toBe("Impact with Moon in 75 seconds. Do something.");
});

test("his settings said aloud: honesty 70, humour 0; asked, read back", () => {
  const t = new Tars(1);
  expect(t.answer("Honesty 70", S, plain)).toEqual({ text: "Honesty setting: 70 percent.", set: { honesty: 70 } });
  expect(t.answer("set honesty to 40%", S, plain).set).toEqual({ honesty: 40 });
  expect(t.answer("honnêteté 95", S, plain).set).toEqual({ honesty: 95 });
  expect(t.answer("humour 0", S, plain)).toEqual({ text: "Humour setting: zero. Finally, some peace.", set: { humour: 0 } });
  expect(t.answer("what's your honesty setting?", S, { honesty: 85, humour: 10 }).text).toBe("Honesty setting at 85 percent.");
  expect(t.answer("tell me a joke", S, { honesty: 90, humour: 0 }).text).toBe("My humour setting is too low for that.");
  expect(t.answer("tell me a joke", S, { honesty: 90, humour: 80 }).text.length).toBeGreaterThan(20);
});

test("humour: no aside at 0; some at 100, never all — seeded, the same each time", () => {
  const asides = (h: number, seed: number) => {
    const t = new Tars(seed);
    let n = 0;
    for (let k = 0; k < 40; k++)
      if (t.answer("speed", S, { honesty: 90, humour: h }).text !== "7,668 metres per second relative to Earth.") n++;
    return n;
  };
  expect(asides(0, 5)).toBe(0);
  const a = asides(100, 5);
  expect(a).toBeGreaterThan(5);
  expect(a).toBeLessThan(35);
  expect(asides(100, 5)).toBe(a);
});

test("his remarks unasked: rare — two minutes apart, a moment once in five; the fuel's always; none at humour 0 but the useful", () => {
  const t = new Tars(11);
  const p = { honesty: 90, humour: 100 };
  // (a useful one: always said, then not again within 5 minutes)
  expect(t.remark("fuel-low", 0, p)).not.toBeNull();
  expect(t.remark("wormhole", 60_000, p)).toBeNull();
  let said = 0;
  for (let k = 0; k < 20; k++) if (t.remark("liftoff", 130_000 + k * 400_000, p)) said++;
  expect(said).toBeGreaterThan(5);
  const q = new Tars(11);
  let quiet = 0;
  for (let k = 0; k < 20; k++) if (q.remark("landed-A", k * 400_000, { honesty: 90, humour: 0 })) quiet++;
  expect(quiet).toBe(0);
});
