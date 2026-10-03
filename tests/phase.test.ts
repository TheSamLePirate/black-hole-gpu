import { expect, test } from "bun:test";
import { EventBus } from "../src/game/events";
import { type FlightPhase, type PhaseInput, PhaseWatcher, phaseOf, phaseText } from "../src/game/phase";

const flying: PhaseInput = {
  piloting: true,
  cinematic: null,
  offline: false,
  landed: false,
  docked: false,
  hold: "none",
  auto: "none",
  entry: null,
  inAir: false,
  status: "orbit",
};

test("the phase: the mode first, then who flies and the stage", () => {
  expect(phaseOf({ ...flying, offline: true }).mode).toBe("offline");
  expect(phaseOf({ ...flying, cinematic: "dive" })).toMatchObject({ mode: "cinematic", detail: "dive" });
  expect(phaseOf({ ...flying, piloting: false }).mode).toBe("free");
  expect(phaseOf(flying)).toEqual({ mode: "flight", control: "manual", stage: "orbit", detail: "" });
  expect(phaseOf({ ...flying, hold: "prograde" })).toMatchObject({ control: "hold", detail: "prograde" });
  expect(phaseOf({ ...flying, hold: "prograde", auto: "land" })).toMatchObject({ control: "auto", detail: "land" });
  expect(phaseOf({ ...flying, landed: true, status: "landed" })).toMatchObject({ mode: "landed", stage: "ground" });
  expect(phaseOf({ ...flying, docked: true })).toMatchObject({ mode: "docked", stage: "docking" });
  expect(phaseOf({ ...flying, auto: "entry", entry: "entry", inAir: true }).stage).toBe("entry");
  expect(phaseOf({ ...flying, auto: "entry", entry: "glide", inAir: true }).stage).toBe("approach");
  expect(phaseOf({ ...flying, auto: "entry", entry: "wait" }).stage).toBe("orbit");
  expect(phaseOf({ ...flying, inAir: true, status: "suborbital" }).stage).toBe("air");
  expect(phaseOf({ ...flying, status: "hyperbolic" }).stage).toBe("escape");
  expect(phaseOf({ ...flying, status: "bound" }).stage).toBe("kerr");
  expect(phaseText(phaseOf({ ...flying, auto: "land", status: "suborbital" }))).toBe("On a suborbital arc — autopilot land");
});

test("the watcher: a stage must hold a second; a mode changes at once", () => {
  const seen: [FlightPhase | null, FlightPhase][] = [];
  const w = new PhaseWatcher((a, b) => seen.push([a, b]), 1);
  w.update(phaseOf(flying), 0);
  expect(seen.length).toBe(1);
  // (a periapsis grazing the air: suborbital for half a second, then orbit again — no phase)
  w.update(phaseOf({ ...flying, status: "suborbital" }), 1);
  w.update(phaseOf({ ...flying, status: "suborbital" }), 1.5);
  w.update(phaseOf(flying), 1.6);
  expect(seen.length).toBe(1);
  w.update(phaseOf({ ...flying, status: "suborbital" }), 2);
  w.update(phaseOf({ ...flying, status: "suborbital" }), 3.01);
  expect(seen.length).toBe(2);
  expect(seen[1]![1].stage).toBe("suborbital");
  // (a hold engaged: at once)
  w.update(phaseOf({ ...flying, status: "suborbital", hold: "prograde" }), 3.015);
  expect(seen.length).toBe(3);
  expect(seen[2]![1].control).toBe("hold");
  w.update(phaseOf({ ...flying, status: "suborbital" }), 3.016);
  expect(seen.length).toBe(4);
  // (landing: at once)
  w.update(phaseOf({ ...flying, landed: true }), 3.02);
  expect(seen.length).toBe(5);
  expect(seen[4]![0]!.stage).toBe("suborbital");
});

test("the bus: typed events to their listeners, unsubscribed", () => {
  const bus = new EventBus<{ a: { n: number }; b: string }>();
  const got: number[] = [];
  const off = bus.on("a", ({ n }) => got.push(n));
  bus.emit("a", { n: 1 });
  bus.emit("b", "ignored");
  off();
  bus.emit("a", { n: 2 });
  expect(got).toEqual([1]);
});
