import { afterEach, describe, expect, test } from "bun:test";
import { type AeroState, FIGURE_ORDER, FIGURES, fitCircle, judgeFigure } from "../src/game/aerobatics";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The aerobatic figures (docs/PLAN-AVIATION-AAA.md, V4): the judge — a circle fitted, a perfect loop marked full and
// a poor one marked down —; each figure flown by its own program in the F-35, frame by frame by the controller, and
// marked 18/20 or more by the judge; the player's figure waiting for its entry.

afterEach(resetFlights);

/** A synthetic loop's trace: radius R, an oval by `egg` (0: round), its exit heading off by `dh` [rad]. */
function loopTrace(R: number, egg = 0, dh = 0): AeroState[] {
  const out: AeroState[] = [];
  const V = 200;
  for (let i = 0; i <= 360; i++) {
    const a = (i / 360) * 2 * Math.PI;
    // (an oval: wider than tall by `egg`)
    const x = R * (1 + egg) * Math.sin(a),
      z = R * (1 - egg) * (1 - Math.cos(a));
    const h = (dh * i) / 360;
    const v: [number, number, number] = [V * Math.cos(a) * Math.sin(h), V * Math.cos(a) * Math.cos(h), V * Math.sin(a)];
    const p: [number, number, number] = [x * Math.sin(h), x * Math.cos(h), z];
    out.push({
      t: (i / 360) * 40,
      p,
      v,
      pa: p,
      fwd: [0, 1, 0],
      up: [0, -Math.sin(a), Math.cos(a)],
      right: [1, 0, 0],
      V,
      alpha: 0.1,
      nz: 4,
      agl: 3000 + z,
      p_: 0,
      q: 0.15,
      r: 0,
      gMax: 7,
      gMin: -3,
      phase: i > 2 && i < 358 ? 1 : 2,
    });
  }
  return out;
}

describe("the aerobatic judge", () => {
  test("a circle fitted through its points: its centre and radius", () => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 50; i++) pts.push([300 + 1200 * Math.cos(i * 0.3), -40 + 1200 * Math.sin(i * 0.3)]);
    const c = fitCircle(pts);
    expect(c.r).toBeCloseTo(1200, 3);
    expect(c.c[0]).toBeCloseTo(300, 3);
    expect(c.c[1]).toBeCloseTo(-40, 3);
  });

  test("a perfect loop marked full, an egg-shaped one and one drifting off its heading marked down", () => {
    const good = judgeFigure("loop", loopTrace(1400));
    const egg = judgeFigure("loop", loopTrace(1400, 0.35));
    const off = judgeFigure("loop", loopTrace(1400, 0, 0.25));
    console.log(`  round ${good.score}/20, egg-shaped ${egg.score}/20 (${egg.notes.join("; ")}), off its heading ${off.score}/20`);
    expect(good.score).toBeGreaterThan(19);
    expect(egg.score).toBeLessThan(16);
    expect(off.score).toBeLessThan(17);
  });
});

describe("the figures flown by their programs", () => {
  for (const id of FIGURE_ORDER) {
    test(`${FIGURES[id].name}: flown, marked 18/20 or more`, () => {
      const F = FIGURES[id];
      const { c, fly } = cruise(F.entry.agl + 800, F.entry.v, 0.8);
      c.aeroStart(id, "demo");
      fly(F.par * 2.6, () => c.aero?.status === "done");
      const A = c.aero!;
      console.log(`  ${A.say} — ${A.t.toFixed(1)} s`);
      expect(A.status).toBe("done");
      expect(A.result).not.toBeNull();
      expect(A.result!.score).toBeGreaterThanOrEqual(18);
      // (its end: the law the player's again, the afterburner and the air brake in)
      expect(c.s.f35Law).toBe("normal");
      expect(c.jetModes.ab).toBe(false);
      expect(c.airBrake).toBe(0);
    }, 120_000);
  }
});

describe("the figures in French", () => {
  test("every name, brief, cue and note has its French", async () => {
    const { FRENCH } = await import("../src/i18n");
    const src = await Bun.file("src/game/aerobatics.ts").text();
    const all = new Set<string>();
    for (const F of Object.values(FIGURES)) for (const x of [F.name, F.brief, ...F.cues]) all.add(x);
    for (const m of src.matchAll(/, \d+, "([^"]+)"\],/g)) all.add(m[1]!);
    expect([...all].filter((en) => !FRENCH.has(en))).toEqual([]);
  });
});

describe("the player's figure", () => {
  test("armed: it waits for its entry — begun once the speed is in its window, level", () => {
    const { c, fly } = cruise(3300, 150, 0.8);
    c.aeroStart("loop", "judge");
    fly(2);
    expect(c.aero!.status).toBe("armed");
    const fast = cruise(3300, 235, 0.95);
    fast.c.aeroStart("loop", "judge");
    fast.fly(1);
    expect(fast.c.aero!.status).toBe("fly");
  }, 60_000);
});
