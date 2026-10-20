import { expect, test } from "bun:test";
import { idealAscent } from "../src/controller/phasereports";
import { gradeAscent, gradeEntry, gradeInsertion, gradeRendezvous } from "../src/game/report";

// PLAN-VAISSEAUX X8: a spacecraft's phases graded out of 20 — the ascent by its efficiency against the least Δv
// (the energies apart, the ground's turn given), the insertion by its precision, the rendezvous by its Δv against
// the plan's, the entry by its corridor and its site.

test("the least Δv to orbit: a 400 km Earth orbit from Kourou ~7.9 km/s, from the Moon's ground to 100 km ~1.7 km/s", () => {
  const e = idealAscent("earth", (6371 + 400) * 1000, 5.2);
  expect(e).toBeGreaterThan(7600);
  expect(e).toBeLessThan(8200);
  const m = idealAscent("moon", (1737.4 + 100) * 1000, 0);
  expect(m).toBeGreaterThan(1600);
  expect(m).toBeLessThan(1800);
});

test("the grades: an efficient ascent an A, a wasteful one less; an insertion on its aim; a rendezvous within its plan; an entry in its corridor", () => {
  const good = gradeAscent({ body: "Terre", dv: 9300, ideal: 7950, peKm: 395, apKm: 410, flightS: 520, gMax: 3.2 });
  expect(good.letter).toBe("A");
  const poor = gradeAscent({ body: "Terre", dv: 13_000, ideal: 7950, peKm: 395, apKm: 410, flightS: 900, gMax: 6 });
  expect(poor.score).toBeLessThan(good.score);
  expect(gradeInsertion({ body: "Terre", peKm: 399, apKm: 402, incDeg: 51.6, aimKm: 400, aimInc: 51.6 }).score).toBe(20);
  expect(gradeInsertion({ body: "Terre", peKm: 300, apKm: 402, incDeg: 53, aimKm: 400, aimInc: 51.6 }).letter).not.toBe("A");
  expect(gradeRendezvous({ target: "ISS", dv: 110, ideal: 100, flightS: 3600 }).score).toBe(20);
  expect(gradeRendezvous({ target: "ISS", dv: 250, ideal: 100, flightS: 3600 }).score).toBeLessThan(20);
  const entry = gradeEntry({ body: "Terre", site: "KSC", gMax: 3.5, heatMax: 120e4, missM: 800, flightS: 1800 });
  expect(entry.score).toBe(20);
  expect(gradeEntry({ body: "Terre", site: "KSC", gMax: 7, heatMax: 300e4, missM: 30_000, flightS: 1800 }).letter).toBe("F");
});

test("in flight: from Tranquility to a 100 km orbit — the ascent's report once in orbit, the insertion's as CIRC lets go", async () => {
  const { ourGroundPose } = await import("../src/game/place");
  const { rangerStatus } = await import("../src/game/status");
  const { flight, resetFlights, TRANQUILITY } = await import("./helpers/flight");
  try {
    const g = ourGroundPose("moon", TRANQUILITY.lat, TRANQUILITY.lon, 0);
    const { c, fly } = flight({ ...g, landed: g.landed }, false);
    const reports: { kind: string; score: number; title: string; lines: { label: string; value: string }[] }[] = [];
    c.onFlightReport = (r) => r && reports.push(r);
    c.launchGoal = { altKm: 100, incDeg: null };
    c.pilot.auto = "none";
    c.pilot.setAuto("takeoff");
    let k = 0;
    const watch = () => {
      // (the status a few times a second, as the HUD's frames give it)
      if (k++ % 10 === 0) c.phaseReportStep(rangerStatus(c.s, c, c.flightInfo(), c.time));
      return false;
    };
    fly(3 * 3600, () => (watch(), c.pilot.auto === "none" && reports.some((r) => r.kind === "insertion")));
    const asc = reports.find((r) => r.kind === "ascent");
    console.log(
      reports.map((r) => `  ${r.title}: ${r.score.toFixed(1)} — ${r.lines.map((l) => `${l.label} ${l.value}`).join(" · ")}`).join("\n"),
    );
    expect(asc).toBeTruthy();
    expect(asc!.score).toBeGreaterThan(10);
    expect(reports.some((r) => r.kind === "insertion")).toBe(true);
  } finally {
    resetFlights();
  }
}, 180_000);
