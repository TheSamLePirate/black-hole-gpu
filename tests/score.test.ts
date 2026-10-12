import { expect, test } from "bun:test";
import { DEFAULT_MAP } from "../src/audio/music";
import { THEME_BY_ID } from "../src/audio/music/themes";
import { CONTEXTS, flightIntensity, hz, LIFTOFF_S, MOMENTS, ScoreDirector, type ScoreInput } from "../src/audio/score";

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

test("every moment and context has a theme; Miller's ticks at 1.25 s, only Miller's", () => {
  for (const k of [...MOMENTS, ...CONTEXTS]) expect(THEME_BY_ID[DEFAULT_MAP[k]]).toBeDefined();
  expect(THEME_BY_ID[DEFAULT_MAP.miller]!.tick).toBe(1.25);
  for (const k of MOMENTS) if (k !== "miller") expect(THEME_BY_ID[DEFAULT_MAP[k]]!.tick).toBeUndefined();
  expect(hz(69)).toBe(440);
});

test("a docking, a low and fast pass: their moments; between the moments, the flight's context", () => {
  const s = new ScoreDirector();
  expect(s.moment({ ...base, docking: true })).toBe("docking");
  expect(s.moment({ ...base, stage: "air", inAir: true, agl: 200, airspeed: 250 })).toBe("lowpass");
  expect(s.moment({ ...base, stage: "air", inAir: true, agl: 2000, airspeed: 250 })).toBeNull();
  expect(s.context({ ...base, nearWorld: true })).toBe("orbit");
  expect(s.context({ ...base, nearWorld: false })).toBe("deep");
  expect(s.context({ ...base, inAir: true })).toBe("air");
  expect(s.context({ ...base, mode: "landed" })).toBe("ground");
  expect(s.context({ ...base, onFoot: true })).toBe("onFoot");
});

test("the flight's intensity: calm coasting low, the plasma, a hard pull and an alarm high", () => {
  const calm = flightIntensity({ throttle: 0, plasma: 0, mach: 0, agl: Infinity, g: 1, alarm: false });
  const hard = flightIntensity({ throttle: 1, plasma: 0.8, mach: 1.2, agl: 300, g: 5, alarm: true });
  expect(calm).toBeLessThan(0.4);
  expect(hard).toBe(1);
});
