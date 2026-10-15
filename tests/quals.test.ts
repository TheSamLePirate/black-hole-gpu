import { afterEach, describe, expect, test } from "bun:test";
import { readDeck } from "../src/game/carrier";
import { putDeck } from "../src/controller/carriers";
import { type QualId, qualResult, utcHourAt } from "../src/game/quals";
import { applyF35Variant } from "../src/f35/variant";
import { fleet } from "../src/fleet";
import { setPlatforms } from "../src/system/our-surface";
import { cruise } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// The carrier qualifications (docs/PLAN-AVIATION-AAA.md, M3; game/quals.ts, controller/quals.ts): four passes graded
// by the LSO, flown by the autopilot — the F-35C off the catapult and back on the wires, by day, by night and in a
// heavy sea; the F-35B's vertical recoveries by day —; the grade point average, qualified at 3.0 without a cut.

afterEach(() => {
  resetFlights();
  setPlatforms("earth", []);
  applyF35Variant("B");
  delete (fleet.fuel as Record<string, number>).f35;
});

const D = Math.PI / 180;

test("the grade point average: qualified at 3.0, never with a cut; the hour's UTC for a local hour", () => {
  expect(
    qualResult([
      { grade: "OK", points: 4 },
      { grade: "Fair", points: 3 },
      { grade: "B", points: 2.5 },
      { grade: "OK", points: 4 },
    ]),
  ).toEqual({ gpa: 3.375, qualified: true });
  expect(
    qualResult([
      { grade: "_OK_", points: 5 },
      { grade: "Cut", points: 0 },
      { grade: "_OK_", points: 5 },
      { grade: "_OK_", points: 5 },
    ]).qualified,
  ).toBe(false);
  expect(
    qualResult([
      { grade: "No grade", points: 2 },
      { grade: "Fair", points: 3 },
    ]).qualified,
  ).toBe(false);
  expect(utcHourAt(23, 6.1)).toBeCloseTo(22.593, 2);
  expect(utcHourAt(2, 60)).toBe(22);
});

/** A qualification flown by the autopilot from 9 km off the Ford in a sea of `hs` [m]. */
async function qualify(id: QualId, variant: "B" | "C", hs: number) {
  putDeck("ford", readDeck(await Bun.file("assets/carriers/ford.deck.bin").arrayBuffer()));
  applyF35Variant(variant);
  const { c, fly } = cruise(300, 140, 0.4);
  c.jetToggle("ap");
  c.jetToggle("athr");
  fleet.fuel.f35 = variant === "C" ? 5000 : 2000;
  c.seaHs = hs;
  const g = c.geoNow()!;
  c.carrierSpawn("ford", {
    lat: g.lat + (9000 * Math.cos(g.track)) / 111_195,
    lon: g.lon + (9000 * Math.sin(g.track)) / (111_195 * Math.cos(g.lat * D)),
    heading: g.track / D + 40,
    speed: 14.4,
  });
  c.carrierStep();
  const radio: string[] = [];
  c.onRadio = (s) => radio.push(s);
  const said = c.qualStart(id, { kind: "ford", auto: true });
  let t = 0;
  while (c.qual && t < 3600) fly(0.5), (t += 0.5);
  const r = c.qualLast!;
  console.log(
    `  ${said} (the F-35${variant}, a ${hs} m sea): ${r.passes.map((p) => (p.wire ? `${p.grade} ${p.wire}-wire` : p.grade)).join(", ")} — ${r.gpa.toFixed(2)}, ${r.qualified ? "qualified" : "not qualified"}, in ${(t / 60).toFixed(0)} min\n    ${radio.filter((x) => x.startsWith("Mother")).join("\n    ")}`,
  );
  return { c, r, t };
}

describe("the qualifications, flown by the autopilot", () => {
  for (const [id, variant, hs] of [
    ["day", "C", 1.5],
    ["night", "C", 1.5],
    ["sea", "C", 4.5],
    ["day", "B", 1.5],
  ] as const)
    test(`${id}, the F-35${variant} in a ${hs} m sea: four passes graded, the average said`, async () => {
      const { r } = await qualify(id, variant, hs);
      // (every pass graded — the qualification's grade —; the autopilot down on the pitching deck: the F-35C on the
      // wires three times in four at least, the F-35B on its spot every time)
      expect(r.passes.length).toBe(4);
      expect(r.passes.every((p) => p.points > 0)).toBe(true);
      expect(r.passes.filter((p) => (variant === "C" ? (p.wire ?? 0) > 0 : p.points >= 3)).length).toBeGreaterThanOrEqual(
        variant === "C" ? 3 : 4,
      );
      expect(r.gpa).toBeGreaterThan(2.5);
    }, 180_000);
});
