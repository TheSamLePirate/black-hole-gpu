import { afterAll, expect, test } from "bun:test";
import {
  CAMPAIGN,
  chapterOpen,
  checkSpaceMission,
  doneText,
  objText,
  SPACE_MISSIONS,
  type SpaceMission,
  spaceMissionFromHash,
  spaceMissionToHash,
} from "../src/game/spacemissions";
import fr from "../src/i18n/fr-spacemissions";

// PLAN-VAISSEAUX X11: the spacecraft's missions — the library and the Interstellar campaign (each chapter opened by
// the one before), their texts in French; in flight, the Moon landing's objectives in their order, a failure injected
// at its time, the campaign's progress kept, a budget over → failed.

// (Bun's test runner has no localStorage: a small in-memory stand-in)
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterAll(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
const mem = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
} as unknown as Storage;

test("five library missions, seven chapters in their order, each opened by the one before; every text in French", () => {
  expect(SPACE_MISSIONS.length).toBe(12);
  expect(new Set(SPACE_MISSIONS.map((m) => m.id)).size).toBe(12);
  expect(CAMPAIGN.map((m) => m.chapter)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(chapterOpen(CAMPAIGN[0]!, 0)).toBe(true);
  expect(chapterOpen(CAMPAIGN[1]!, 0)).toBe(false);
  expect(chapterOpen(CAMPAIGN[1]!, 1)).toBe(true);
  expect(chapterOpen(CAMPAIGN[6]!, 5)).toBe(false);
  expect(chapterOpen(SPACE_MISSIONS.find((m) => m.id === "iss")!, 0)).toBe(true);
  for (const M of SPACE_MISSIONS) {
    expect(M.objectives.length).toBeGreaterThan(0);
    for (const s of [M.title, M.brief, ...M.objectives.map((o) => o.text!)]) expect(fr[s as keyof typeof fr]).toBeTruthy();
  }
});

test("a mission made: its link read back (never a chapter), what is wrong in one refused; its objectives' words made", () => {
  const M: SpaceMission = {
    id: "m-test",
    chapter: 3,
    title: "Up and over",
    brief: "",
    start: { vessel: "lander", orbit: { body: "moon", altKm: 50 } },
    objectives: [{ done: { altBelow: 5 } }, { done: { soi: "moon" } }, { done: { landed: true } }],
    budget: { dv: 900, timeS: 1200 },
    says: [{ at: 30, text: "Thirty seconds" }],
  };
  const hash = spaceMissionToHash(M);
  expect(hash).toMatch(/^#smission=[\w-]+$/);
  const back = spaceMissionFromHash(`#scene=x&${hash.slice(1)}`)!;
  expect(back.id).toBe("link-m-test");
  expect(back.chapter).toBeUndefined();
  expect(back.objectives).toEqual(M.objectives);
  expect(back.says).toEqual(M.says);
  expect(spaceMissionFromHash("#scene=x")).toBeNull();
  expect(checkSpaceMission({ ...M, objectives: [{ done: { warp: 1 } }] }).errors).toEqual(["objectives[0]"]);
  expect(checkSpaceMission({ ...M, start: { vessel: "f35" } }).errors).toEqual(["start.vessel"]);
  expect(checkSpaceMission({ ...M, budget: { dv: -1 } }).errors).toEqual(["budget"]);
  expect(doneText({ altBelow: 5 })).toBe("Below 5 km");
  expect(doneText({ soi: "moon" })).toBe("In the sphere of the Moon");
  expect(doneText({ kerrBelow: 8 })).toBe("Inside 8 M of Gargantua");
  expect(objText({ text: "Docked", done: { docked: true } })).toBe("Docked");
});

test("in flight: the Moon landing — below 10 km, then landed by the autopilot; its debrief, a library mission keeps no chapter", async () => {
  const { rangerStatus } = await import("../src/game/status");
  const { overPlace, resetFlights, TRANQUILITY } = await import("./helpers/flight");
  const { campaignDone } = await import("../src/controller/spacemission");
  try {
    const { c, fly } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 3, true, "lander");
    const reports: { kind: string; score: number; lines: { label: string; value: string }[] }[] = [];
    c.onFlightReport = (r) => r && reports.push(r);
    c.spaceMissionBegin("moon-landing");
    c.pilot.setAuto("land");
    let k = 0;
    fly(600, () => {
      if (k++ % 3 === 0) c.spaceMissionFrame(0.1, rangerStatus(c.s, c, c.flightInfo(), c.time));
      return c.spaceMission === null;
    });
    const r = reports.find((x) => x.kind === "mission");
    console.log(`  ${JSON.stringify(r?.lines)}`);
    expect(r).toBeTruthy();
    expect(r!.score).toBe(20);
    expect(r!.lines[0]!.value).toStartWith("✓");
    expect(r!.lines[1]!.label).toBe("Landed on the Moon");
    expect(r!.lines[1]!.value).toStartWith("✓");
    expect(campaignDone()).toBe(0);
  } finally {
    resetFlights();
  }
}, 300_000);

test("a chapter flown whole opens the next; a failure injected at its time; a Δv budget over fails the rest", async () => {
  const { rangerStatus } = await import("../src/game/status");
  const { overPlace, resetFlights, TRANQUILITY } = await import("./helpers/flight");
  const { campaignDone } = await import("../src/controller/spacemission");
  try {
    const { c, fly } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 3, true, "lander");
    const reports: { kind: string; score: number; lines: { label: string; value: string }[] }[] = [];
    c.onFlightReport = (r) => r && reports.push(r);
    const st = () => rangerStatus(c.s, c, c.flightInfo(), c.time);
    const said: string[] = [];
    c.onLessonSay = (w) => said.push(w);
    // (chapter 1, its objective one that holds here: flown whole, chapter 2 opened; a failure at 0.5 s)
    c.spaceMission = {
      M: {
        ...CAMPAIGN[0]!,
        objectives: [{ text: "Below 10 km (the descent orbit)", done: { altBelow: 10 } }],
        failures: [{ at: 0.5, kind: "bus" }],
        says: [{ at: 0.3, text: "Hello" }],
      },
      i: 0,
      t: 0,
      spent0: c.spent,
      held: 0,
      injected: 0,
      said: 0,
      results: [],
    };
    fly(5, () => {
      c.spaceMissionFrame(0.1, st());
      return c.spaceMission === null;
    });
    expect(c.systemsInfo()!.failures.map((f) => f.kind)).toContain("bus");
    expect(said).toContain("Hello");
    expect(reports.at(-1)!.score).toBe(20);
    expect(reports.at(-1)!.lines.some((l) => l.label === "Next chapter" && l.value === "2 · The Endurance")).toBe(true);
    expect(campaignDone()).toBe(1);
    // (a Δv budget already spent: failed at once, its objectives marked missed)
    c.spaceMission = {
      M: { ...SPACE_MISSIONS.find((m) => m.id === "moon-landing")!, budget: { dv: 1 } },
      i: 0,
      t: 0,
      spent0: c.spent - 10 / 299_792_458,
      held: 0,
      injected: 0,
      said: 0,
      results: [],
    };
    c.spaceMissionFrame(0.1, st());
    expect(c.spaceMission).toBeNull();
    const f = reports.at(-1)!;
    expect(f.score).toBe(0);
    expect(f.lines.find((l) => l.label === "Ended")!.value).toBe("Δv budget spent");
    expect(campaignDone()).toBe(1);
  } finally {
    resetFlights();
  }
}, 120_000);
