import { expect, test } from "bun:test";
import {
  challengeItems,
  combatItems,
  cycle,
  FIELDS,
  FIGURE_HOWS,
  flightLine,
  HOURS,
  LESSON_HOWS,
  lastFlight,
  lessonItems,
  STARTS,
  WEATHERS,
} from "../src/ui/title/plane";

// By plane on the title (PLAN-TITRE-AAA E4): the free flight's choices (the Flight hub's own), its line, the
// selectors' round, and the combat, school and challenge tabs' entries, each with the kind its launch reads.

test("the free flight: Edwards on its runway, now, the weather as it is, full — by default", () => {
  const c = lastFlight();
  expect(c).toEqual({ field: "KEDW", start: "runway", hour: "now", weather: null, fuel: 1 });
  expect(FIELDS.length).toBeGreaterThan(5);
  expect(FIELDS.some((f) => f.id === "KEDW")).toBe(true);
  expect(STARTS.map((s) => s.id)).toEqual(["runway", "final", "cruise"]);
  expect(HOURS).toHaveLength(6);
  expect(WEATHERS[0]!.id).toBeNull();
  expect(flightLine(c, "en")).toMatch(/^KEDW · .* — On the runway — Now — As it is — 100 % fuel$/);
  expect(flightLine({ ...c, start: "final", hour: "dusk", weather: "fog", fuel: 0.5 }, "fr")).toMatch(
    /En finale \(15 km\) — Crépuscule — Brouillard — 50 % de carburant$/,
  );
});

test("a selector goes round both ways", () => {
  const xs = ["a", "b", "c"];
  expect(cycle(xs, "c", 1)).toBe("a");
  expect(cycle(xs, "a", -1)).toBe("c");
  expect(cycle(xs, "b", 1)).toBe("c");
  // (a value not in the list: from the first)
  expect(cycle(xs, "z", 1)).toBe("b");
});

test("the tabs' entries: missions then fights, the lessons, the challenges then the figures and the box", () => {
  const combat = combatItems();
  expect(combat.filter((x) => x.id.startsWith("mission:")).length).toBeGreaterThanOrEqual(10);
  expect(combat.filter((x) => x.id.startsWith("fight:")).length).toBeGreaterThanOrEqual(3);
  expect(combat.filter((x) => x.group)).toHaveLength(2);
  const lessons = lessonItems();
  expect(lessons.length).toBeGreaterThanOrEqual(6);
  expect(lessons.every((x) => x.id.startsWith("lesson:") && x.title && x.text)).toBe(true);
  const ch = challengeItems();
  expect(ch.some((x) => x.id.startsWith("challenge:"))).toBe(true);
  expect(ch.some((x) => x.id.startsWith("figure:") && x.id !== "figure:box")).toBe(true);
  expect(ch.at(-1)!.id).toBe("figure:box");
  for (const x of [...combat, ...lessons, ...ch]) expect(x.title.length).toBeGreaterThan(2);
  expect(LESSON_HOWS[0]!.id).toBe("guided");
  expect(FIGURE_HOWS.map((x) => x.id)).toEqual(["fly", "watch"]);
});
