import { expect, test } from "bun:test";
import { keepBest, medalOf, scoreText, SPACE_CHALLENGES, type SpaceBest } from "../src/game/spacechallenges";

// PLAN-VAISSEAUX X10: the spacecraft's challenges — their medals (lower is better), their results said, the best kept
// on this device; in flight, a pinpoint landing on the Moon measured from the pad.

const C = (id: string) => SPACE_CHALLENGES.find((x) => x.id === id)!;

test("seven challenges; the medals by their marks; the results in their units; the best kept, a record only when better", () => {
  expect(SPACE_CHALLENGES.length).toBe(7);
  const d = C("dock-clock");
  expect(medalOf(d, 100)).toBe("gold");
  expect(medalOf(d, 150)).toBe("silver");
  expect(medalOf(d, 300)).toBe("bronze");
  expect(medalOf(d, 400)).toBeNull();
  expect(scoreText(d, 95.4)).toBe("95.4 s");
  expect(scoreText(d, 185)).toBe("3 min 05");
  expect(scoreText(C("lunar-pin"), 12.34)).toBe("12.3 m");
  expect(scoreText(C("entry-corridor"), 3.456)).toBe("3.46 g");
  const B: Record<string, SpaceBest> = {};
  expect(keepBest(B, d, 150, 1)).toBe(true);
  expect(keepBest(B, d, 180, 2)).toBe(false);
  expect(keepBest(B, d, 110, 3)).toBe(true);
  expect(B["dock-clock"]).toEqual({ score: 110, medal: "gold", at: 3 });
});

test("in flight: the pinpoint landing at Tranquility — the landing autopilot, the miss from the pad measured, a medal", async () => {
  const { rangerStatus } = await import("../src/game/status");
  const { overPlace, resetFlights, TRANQUILITY } = await import("./helpers/flight");
  try {
    const { c, fly } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 3, true, "lander");
    const reports: { kind: string; lines: { label: string; value: string }[] }[] = [];
    c.onFlightReport = (r) => r && reports.push(r);
    c.spaceChallengeBegin("lunar-pin");
    c.pilot.setAuto("land");
    let k = 0;
    fly(600, () => {
      if (k++ % 3 === 0) c.spaceChallengeFrame(0.1, rangerStatus(c.s, c, c.flightInfo(), c.time));
      return c.spaceChal === null;
    });
    const r = reports.find((x) => x.kind === "challenge");
    console.log(`  ${JSON.stringify(r?.lines)}`);
    expect(r).toBeTruthy();
    const miss = r!.lines.find((l) => l.label === "Result")!.value;
    expect(miss).toMatch(/ m$|km$/);
    // (the autopilot lands on the place under it at the start: within the bronze's 150 m)
    expect(Number.parseFloat(miss)).toBeLessThan(miss.endsWith("km") ? 0.15 : 150);
  } finally {
    resetFlights();
  }
}, 300_000);
