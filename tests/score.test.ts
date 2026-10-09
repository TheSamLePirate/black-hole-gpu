import { expect, test } from "bun:test";
import { hz, LIFTOFF_S, PIECES, ScoreDirector, type ScoreInput } from "../src/audio/score";

// PLAN-TARS T4: the score — silence by default, a piece at each of the flight's great moments, the gravest
// first; Miller's tick at the film's 1.25 s.

const base: ScoreInput = {
  now: 0,
  mode: "flight",
  stage: "orbit",
  side: "ours",
  plasma: 0,
  final: false,
  agl: Infinity,
  r: Infinity,
  body: "earth",
};

test("silence in orbit, cruising, landed; the lift-off's piece for its minute and a quarter", () => {
  const s = new ScoreDirector();
  expect(s.moment(base)).toBeNull();
  expect(s.moment({ ...base, mode: "landed", stage: "ground" })).toBeNull();
  expect(s.moment({ ...base, now: 1, mode: "flight", stage: "air" })).toBe("liftoff");
  expect(s.moment({ ...base, now: 1 + LIFTOFF_S - 1, stage: "air" })).toBe("liftoff");
  expect(s.moment({ ...base, now: 1 + LIFTOFF_S + 1, stage: "orbit" })).toBeNull();
  // (not in the free camera, the menus)
  expect(s.moment({ ...base, mode: "free" })).toBeNull();
});

test("the gravest first: the throat, the plasma, the final; then Miller and Gargantua", () => {
  const s = new ScoreDirector();
  expect(s.moment({ ...base, side: "throat", plasma: 0.5 })).toBe("wormhole");
  expect(s.moment({ ...base, plasma: 0.5, final: true, agl: 500 })).toBe("entry");
  expect(s.moment({ ...base, final: true, agl: 2000 })).toBe("final");
  expect(s.moment({ ...base, final: true, agl: 5000 })).toBeNull();
  expect(s.moment({ ...base, side: "gargantua", body: "miller", r: 6 })).toBe("miller");
  expect(s.moment({ ...base, side: "gargantua", body: "gargantua", r: 12 })).toBe("gargantua");
  expect(s.moment({ ...base, side: "gargantua", body: "mann", r: 400 })).toBeNull();
});

test("the pieces: playable chords, Miller's tick at 1.25 s, only Miller's", () => {
  for (const [m, p] of Object.entries(PIECES)) {
    expect(p.chords.length).toBeGreaterThanOrEqual(2);
    for (const c of p.chords) for (const n of c) expect(hz(n)).toBeGreaterThan(55), expect(hz(n)).toBeLessThan(1400);
    expect(p.level).toBeLessThanOrEqual(1);
    expect(p.tick).toBe(m === "miller" ? 1.25 : 0);
  }
  expect(hz(69)).toBe(440);
});
