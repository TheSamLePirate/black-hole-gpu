import { expect, test } from "bun:test";
import { holds, lessonScore, SPACE_LESSONS, type SpaceFix, startRun, stepRun, stepsOf } from "../src/game/spacecourse";

// PLAN-VAISSEAUX X9: the space flight school — fifteen lessons, each with TARS's steps and the pilot's (each pilot's
// step flown by TARS in a demonstration), a step done when its condition holds a moment or after its time (the
// guard); a try only the pilot's steps; the mark shared by the pilot's steps done.

const fix = (o: Partial<SpaceFix> = {}): Omit<SpaceFix, "stepT"> => ({
  pe: 400,
  ap: 400,
  ecc: 0.0005,
  inc: 51.6,
  hold: "none",
  holdOk: false,
  sas: true,
  rcs: "rotate",
  auto: "none",
  docked: false,
  landed: false,
  targetM: null,
  nodes: 0,
  failures: 0,
  rate: 0,
  turn: 0,
  dv: 0,
  lpdMoved: false,
  next: "",
  ...o,
});

test("fifteen lessons, each with a pilot's step, each pilot's step with its demonstration and its guard", () => {
  expect(SPACE_LESSONS.length).toBe(15);
  expect(new Set(SPACE_LESSONS.map((L) => L.id)).size).toBe(15);
  for (const L of SPACE_LESSONS) {
    const you = L.steps.filter((s) => s.who === "you");
    expect(you.length).toBeGreaterThan(0);
    for (const s of you) {
      expect(s.auto?.length ?? 0).toBeGreaterThan(0);
      expect(s.max).toBeGreaterThan(0);
    }
  }
});

test("a step's conditions: the hold aligned, an apoapsis reached, docked, a failure fixed", () => {
  expect(holds({ holdOk: "prograde" }, { ...fix({ hold: "prograde", holdOk: true }), stepT: 1 })).toBe(true);
  expect(holds({ holdOk: "prograde" }, { ...fix({ hold: "prograde", holdOk: false }), stepT: 1 })).toBe(false);
  expect(holds({ apAbove: 590 }, { ...fix({ ap: 600 }), stepT: 1 })).toBe(true);
  expect(holds({ circular: 0.004, peAbove: 770 }, { ...fix({ ecc: 0.002, pe: 790 }), stepT: 1 })).toBe(true);
  expect(holds({ docked: true }, { ...fix({ docked: true }), stepT: 1 })).toBe(true);
  expect(holds({ fixed: true }, { ...fix({ failures: 1 }), stepT: 1 })).toBe(false);
});

test("a guided lesson run: TARS's steps by time, the pilot's held a moment; one timed out — the mark", () => {
  const L = SPACE_LESSONS.find((x) => x.id === "holds")!;
  const R = startRun(L, "guided");
  const events: string[] = [];
  const run = (F: Omit<SpaceFix, "stepT">, secs: number) => {
    for (let t = 0; t < secs; t += 0.1)
      for (const e of stepRun(R, F, 0.1)) events.push(e.kind === "end" ? "end" : `${e.kind}:${e.step.name}`);
  };
  run(fix(), 5); // the SAS: a 4 s step
  run(fix({ hold: "prograde", holdOk: true }), 3); // TARS's prograde, aligned
  run(fix({ hold: "retrograde", holdOk: true }), 3); // the pilot's retrograde
  run(fix({ hold: "normal", holdOk: false }), 125); // normal never aligned: timed out at 120 s
  run(fix({ hold: "none" }), 3); // let go
  expect(events[0]).toBe("begin:The SAS");
  expect(events).toContain("done:Retrograde");
  expect(events.at(-1)).toBe("end");
  expect(R.results.map((r) => r.ok)).toEqual([true, false, true]);
  expect(lessonScore(R)).toBeCloseTo(13.33, 1);
  // (a try: the pilot's steps only)
  expect(stepsOf(L, "try").every((s) => s.who === "you")).toBe(true);
});

test("every lesson's words have their French", async () => {
  const { FRENCH } = await import("../src/i18n");
  const missing: string[] = [];
  for (const L of SPACE_LESSONS)
    for (const w of [L.title, L.summary, L.end, ...L.steps.flatMap((s) => [s.name, s.say, ...(s.demoSay ? [s.demoSay] : [])])])
      if (!FRENCH.has(w)) missing.push(w);
  expect(missing).toEqual([]);
});

test("in flight: the holds lesson demonstrated in low Earth orbit — TARS flies every step, the lesson graded 20", async () => {
  const { ourOrbitPose } = await import("../src/game/place");
  const { rangerStatus } = await import("../src/game/status");
  const { flight, resetFlights } = await import("./helpers/flight");
  try {
    const { c, fly } = flight(ourOrbitPose({ body: "earth", altKm: 400, inc: 51.6 }, 0), false);
    const said: string[] = [];
    const reports: { kind: string; score: number }[] = [];
    c.onLessonSay = (w) => said.push(w);
    c.onFlightReport = (r) => r && reports.push(r);
    c.spaceCourseBegin("holds", "demo");
    let k = 0;
    fly(900, () => {
      if (k++ % 3 === 0) c.spaceCourseFrame(0.1, rangerStatus(c.s, c, c.flightInfo(), c.time));
      return c.spaceCourse === null;
    });
    console.log(`  said: ${said.length} lines · report: ${JSON.stringify(reports.at(-1))}`);
    expect(c.spaceCourse).toBeNull();
    const rep = reports.find((r) => r.kind === "lesson")!;
    expect(rep.score).toBe(20);
    expect(said.length).toBeGreaterThanOrEqual(6);
  } finally {
    resetFlights();
  }
}, 240_000);
