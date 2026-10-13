import { expect, test } from "bun:test";
import { DEFAULT_MAP, DEFAULT_PREFS, Music } from "../src/audio/music";
import { composeBar } from "../src/audio/music/composer";
import { DEFAULT_MIX } from "../src/audio/music/engine";
import { THEME_BY_ID, THEMES } from "../src/audio/music/themes";
import { CONTEXTS, flightIntensity, hz, LIFTOFF_S, MOMENT_HOLD_S, MOMENTS, ScoreDirector, type ScoreInput } from "../src/audio/score";

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
/** A moment from a director that has seen nothing before (no hold, no hysteresis). */
const fresh = (i: ScoreInput) => new ScoreDirector().moment(i);

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
  expect(fresh({ ...base, side: "throat", plasma: 0.5 })).toBe("wormhole");
  expect(fresh({ ...base, plasma: 0.5, final: true, agl: 500 })).toBe("entry");
  expect(fresh({ ...base, final: true, agl: 2000 })).toBe("final");
  expect(fresh({ ...base, final: true, agl: 5000 })).toBeNull();
  expect(fresh({ ...base, side: "gargantua", body: "miller", r: 6 })).toBe("miller");
  expect(fresh({ ...base, side: "gargantua", body: "gargantua", r: 12 })).toBe("gargantua");
  expect(fresh({ ...base, side: "gargantua", body: "mann", r: 400 })).toBeNull();
});

test("a moment held: wider thresholds to leave it than to enter it, and a while at least once begun", () => {
  const s = new ScoreDirector();
  const low = (now: number, agl: number, airspeed: number) => s.moment({ ...base, now, stage: "air", inAir: true, agl, airspeed });
  expect(low(0, 300, 150)).toBe("lowpass");
  // (on the edge, back and forth: still the pass — not a new track at each flicker)
  expect(low(MOMENT_HOLD_S + 1, 450, 130)).toBe("lowpass");
  expect(low(MOMENT_HOLD_S + 2, 380, 145)).toBe("lowpass");
  // (well out of it: over, but only once it has held its while)
  const t = new ScoreDirector();
  expect(t.moment({ ...base, now: 0, inAir: true, agl: 300, airspeed: 150 })).toBe("lowpass");
  expect(t.moment({ ...base, now: 1, inAir: true, agl: 2000, airspeed: 150 })).toBe("lowpass");
  expect(t.moment({ ...base, now: MOMENT_HOLD_S + 1, inAir: true, agl: 2000, airspeed: 150 })).toBeNull();
  // (a graver one takes over at once)
  expect(t.moment({ ...base, now: MOMENT_HOLD_S + 2, inAir: true, agl: 300, airspeed: 150 })).toBe("lowpass");
  expect(t.moment({ ...base, now: MOMENT_HOLD_S + 3, inAir: true, agl: 300, airspeed: 150, plasma: 0.5 })).toBe("entry");
  // (the plasma: entered over 0.15, left under 0.08)
  expect(t.moment({ ...base, now: 2 * MOMENT_HOLD_S + 4, plasma: 0.1 })).toBe("entry");
  expect(t.moment({ ...base, now: 2 * MOMENT_HOLD_S + 5, plasma: 0.05 })).toBeNull();
  expect(t.moment({ ...base, now: 2 * MOMENT_HOLD_S + 6, plasma: 0.1 })).toBeNull();
});

test("every moment and context has a theme; Miller's ticks at 1.25 s, only Miller's", () => {
  for (const k of [...MOMENTS, ...CONTEXTS]) expect(THEME_BY_ID[DEFAULT_MAP[k]]).toBeDefined();
  expect(THEME_BY_ID[DEFAULT_MAP.miller]!.tick).toBe(1.25);
  for (const k of MOMENTS) if (k !== "miller") expect(THEME_BY_ID[DEFAULT_MAP[k]]!.tick).toBeUndefined();
  expect(hz(69)).toBe(440);
});

test("every theme playable: its pitched notes in an orchestra's range, its levels at most 1, its echoes dying", () => {
  for (const th of THEMES) {
    for (const seed of [0, 7, 413])
      for (const intensity of [0, 0.5, 1]) {
        let prev: number[] | null = null;
        for (let bar = 0; bar < 64; bar++) {
          const p = composeBar(th, bar, intensity, seed, prev);
          prev = p.chord;
          for (const e of p.events) {
            // (the velocity is the note's gain into its instrument's level)
            expect(e.vel).toBeGreaterThan(0);
            expect(e.vel).toBeLessThanOrEqual(1);
            if (e.layer === "perc" && e.note === 0) continue;
            // (the piano's keyboard: A0 to C8 — the boom's and the pedal's lows included)
            expect(hz(e.note)).toBeGreaterThanOrEqual(27.5);
            expect(hz(e.note)).toBeLessThanOrEqual(4186.1);
          }
        }
      }
    expect(th.fx.wet).toBeGreaterThanOrEqual(0);
    expect(th.fx.wet).toBeLessThanOrEqual(1);
    expect(th.fx.feedback).toBeGreaterThanOrEqual(0);
    expect(th.fx.feedback).toBeLessThan(0.9);
    expect((60 / th.bpm) * th.fx.delay).toBeLessThanOrEqual(2.9);
  }
  for (const v of Object.values(DEFAULT_MIX)) expect(v).toBeLessThanOrEqual(1);
});

test("kept preferences checked: unknown themes and sections dropped, numbers clamped, the solo apart from the mutes", () => {
  const p = Music.checked({
    mode: "jukebox" as never,
    map: { ...DEFAULT_MAP, liftoff: "gone", orbit: "deep-space" },
    mix: { ...DEFAULT_MIX, master: 9, perc: Number.NaN },
    muted: ["perc", "drums" as never],
    solo: "guitar" as never,
    playlist: ["ascent", "gone"],
    fade: -3,
  });
  expect(p.mode).toBe(DEFAULT_PREFS().mode);
  expect(p.map.liftoff).toBe(DEFAULT_MAP.liftoff);
  expect(p.map.orbit).toBe("deep-space");
  expect(p.mix.master).toBe(2);
  expect(p.mix.perc).toBe(DEFAULT_MIX.perc);
  expect(p.muted).toEqual(["perc"]);
  expect(p.solo).toBeNull();
  expect(p.playlist).toEqual(["ascent"]);
  expect(p.fade).toBe(0);
  expect(Music.checked({ solo: "brass", muted: ["perc"] }).solo).toBe("brass");
});

test("a docking, a low and fast pass: their moments; between the moments, the flight's context", () => {
  const s = new ScoreDirector();
  expect(fresh({ ...base, docking: true })).toBe("docking");
  expect(fresh({ ...base, stage: "air", inAir: true, agl: 200, airspeed: 250 })).toBe("lowpass");
  expect(fresh({ ...base, stage: "air", inAir: true, agl: 2000, airspeed: 250 })).toBeNull();
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
