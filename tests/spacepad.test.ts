import { expect, test } from "bun:test";
import type { PadState } from "../src/gamepad";
import type { DeviceSnapshot } from "../src/input/axes";
import { spaceTemplate } from "../src/input/profiles";
import { SPACEPAD, SpacePad } from "../src/input/spacepad";
import { type SpaceWheelActions, type SpaceWheelState, spaceWheel } from "../src/ui/spacewheel";
import type { WheelItem } from "../src/ui/wheel";

// PLAN-VAISSEAUX X5: a spacecraft on a pad (input/spacepad.ts) — the sticks, the buttons' taps and holds, the wheel
// opened by Y held and driven by the pad —; the spacecraft's wheel (ui/spacewheel.ts) per craft; the HOTAS's 6-DOF
// profile (input/profiles.ts spaceTemplate).

const pad = (o: { lx?: number; ly?: number; rx?: number; ry?: number; rt?: number; lt?: number; held?: number[] } = {}): PadState => {
  const held = Array.from({ length: 17 }, (_, i) => (o.held ?? []).includes(i));
  return {
    move: [o.ly ?? 0, o.lx ?? 0, (o.rt ?? 0) - (o.lt ?? 0), (held[4] ? 1 : 0) - (held[5] ? 1 : 0)],
    look: [o.rx ?? 0, o.ry ?? 0],
    zoom: 0,
    fast: false,
    actions: [],
    active: true,
    id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
    held,
  };
};
const run = (P: SpacePad, p: PadState, secs: number) => {
  let out = P.step(p, 1 / 60);
  const acts = [...out.actions];
  for (let t = 1 / 60; t < secs; t += 1 / 60) {
    out = P.step(p, 1 / 60);
    acts.push(...out.actions);
  }
  return { out, acts: acts.map((a) => a.action + (a.arg ? `:${a.arg}` : "")) };
};

test("the sticks: pitch back nose up, yaw, the bumpers roll, the triggers the throttle; the right stick the look", () => {
  const P = new SpacePad();
  const o = P.step(pad({ ly: -0.5, lx: 0.4, rt: 1, rx: 0.3, held: [5] }), 1 / 60);
  expect(o.pitch).toBeCloseTo(0.5);
  expect(o.yaw).toBeCloseTo(0.4);
  expect(o.roll).toBe(1);
  expect(o.throttle).toBe(1);
  expect(o.look).toEqual([0.3, 0]);
});

test("the buttons: A SAS, L3 the RCS mode, the D-pad's holds; B tapped acknowledges, held stops the tumble; X tapped docks, held keeps station", () => {
  const P = new SpacePad();
  expect(run(P, pad({ held: [0] }), 0.05).acts).toEqual(["sas"]);
  run(P, pad(), 0.05);
  expect(run(P, pad({ held: [10] }), 0.05).acts).toEqual(["spaceSystem:rcsMode"]);
  run(P, pad(), 0.05);
  expect(run(P, pad({ held: [12] }), 0.05).acts).toEqual(["hold:prograde"]);
  run(P, pad(), 0.05);
  expect(run(P, pad({ held: [15] }), 0.05).acts).toEqual(["sideHold"]);
  run(P, pad(), 0.05);
  // (tapped: on the release)
  run(P, pad({ held: [1] }), 0.1);
  expect(run(P, pad(), 0.05).acts).toEqual(["ack"]);
  expect(run(P, pad({ held: [1] }), SPACEPAD.hold + 0.1).acts).toEqual(["jetSystem:recover"]);
  expect(run(P, pad(), 0.05).acts).toEqual([]);
  run(P, pad({ held: [2] }), 0.1);
  expect(run(P, pad(), 0.05).acts).toEqual(["auto:dock"]);
  expect(run(P, pad({ held: [2] }), SPACEPAD.hold + 0.1).acts).toEqual(["spaceSystem:keep"]);
});

test("Y held: the wheel — the flight let go, the right stick aims, A does it, B goes back, Y let go does it; tapped: the next target", () => {
  const P = new SpacePad();
  run(P, pad({ held: [3] }), 0.1);
  expect(run(P, pad(), 0.05).acts).toEqual(["nextTarget"]);
  expect(run(P, pad({ held: [3] }), SPACEPAD.hold + 0.1).acts).toEqual(["wheelOpen"]);
  expect(P.wheel).toBe(true);
  // (open: the sticks fly nothing, the right stick aims; A and B the wheel's)
  const o = P.step(pad({ held: [3], ly: 1, rx: 0.9, rt: 1 }), 1 / 60);
  expect([o.pitch, o.throttle]).toEqual([0, 0]);
  expect(o.wheelAim).toEqual([0.9, 0]);
  expect(o.look).toEqual([0, 0]);
  expect(P.step(pad({ held: [3], rx: 0.1 }), 1 / 60).wheelAim).toBeNull();
  expect(run(P, pad({ held: [3, 0] }), 0.05).acts).toEqual(["wheelDo"]);
  expect(run(P, pad({ held: [3, 1] }), 0.05).acts).toEqual(["wheelBack"]);
  expect(run(P, pad(), 0.05).acts).toEqual(["wheelDo"]);
  // (closed by the page: the pad flies again)
  P.wheelClosed();
  expect(P.step(pad({ ly: -1 }), 1 / 60).pitch).toBe(1);
});

const state = (o: Partial<SpaceWheelState> = {}): SpaceWheelState => ({
  vessel: "ranger",
  planeMode: false,
  lands: true,
  sas: true,
  hold: "none",
  auto: "none",
  docked: false,
  rcsTranslate: false,
  gearDown: false,
  navLights: false,
  landingLights: false,
  nodes: 0,
  mapOpen: false,
  ringRpm: null,
  vessels: [
    { id: "ranger", name: "Ranger" },
    { id: "lander", name: "Lander" },
  ],
  assist: "realistic",
  failures: 0,
  course: false,
  challenge: false,
  mission: false,
  route: false,
  ils: false,
  ...o,
});
const said: string[] = [];
const acts = new Proxy({} as SpaceWheelActions, {
  get:
    (_, k) =>
    (...a: unknown[]) =>
      said.push([String(k), ...a.map(String)].join(":")),
});
const labels = (it: WheelItem[]) => it.map((x) => x.label.en);
const sub = (it: WheelItem[], en: string) => it.find((x) => x.label.en === en)?.sub ?? [];

test("the spacecraft's wheel: its eleven sectors; the nine holds; each craft its own (the Endurance's ring, no landing; the Lander's descent)", () => {
  const R = spaceWheel(state(), acts);
  expect(labels(R)).toEqual([
    "SAS",
    "Holds",
    "Autopilots",
    "Flight computer",
    "Systems",
    "Docking",
    "Fleet",
    "Navigation",
    "School & challenges",
    "Camera",
    "Craft",
  ]);
  expect(sub(R, "Holds").length).toBe(10);
  // (the Ranger in space: no aircraft entries; flown as a plane: back)
  expect(labels(sub(R, "Navigation"))).not.toContain("ILS approach");
  expect(labels(sub(spaceWheel(state({ planeMode: true }), acts), "Navigation"))).toContain("ILS approach");
  // (the Endurance: its ring, no gear, no landing autopilot)
  const E = spaceWheel(state({ vessel: "endurance", lands: false, ringRpm: 4 }), acts);
  expect(labels(sub(E, "Systems"))).toContain("Ring + (4.0 rpm)");
  expect(labels(sub(E, "Systems"))).not.toContain("Gear");
  expect(labels(sub(E, "Autopilots"))).not.toContain("Descent & landing");
  // (the Lander: its descent; docked: undock and refuel)
  const L = spaceWheel(state({ vessel: "lander", docked: true }), acts);
  expect(labels(sub(L, "Autopilots"))).toContain("Descent & landing");
  expect(labels(sub(L, "Docking"))).toEqual(["Undock", "Refuel", "Undock, hold 30 m off", "Next target"]);
  // (the items do: a hold, the assistance's level, a craft of the fleet)
  said.length = 0;
  sub(R, "Holds").find((x) => x.label.en === "Normal")!.run!();
  sub(sub(R, "Craft"), "Assistance").find((x) => x.label.en === "Beginner")!.run!();
  sub(R, "Fleet").find((x) => x.label.en === "Lander")!.run!();
  expect(said).toEqual(["hold:normal", "assist:beginner", "vessel:lander"]);
});

test("the HOTAS's 6-DOF: a standard pad's docking layout; a throttle's rocker the RCS's forward–back", () => {
  const dev = (o: Partial<DeviceSnapshot>): DeviceSnapshot => ({
    model: "045e:0b13",
    name: "Xbox",
    standard: true,
    axes: [0, 0, 0, 0],
    buttons: Array(17).fill(0),
    ...o,
  });
  const S = spaceTemplate(dev({}));
  const targets = S.bindings.map((b) => ("target" in b ? b.target : "held" in b ? b.held : b.action));
  expect(targets).toEqual(["pitch", "yaw", "rollLeft", "rollRight", "rcsX", "rcsY", "rcsForward", "rcsBack", "sas"]);
  const T = spaceTemplate(dev({ model: "044f:b687", name: "TWCS Throttle", standard: false, axes: Array(6).fill(0) }));
  const tt = T.bindings.map((b) => ("target" in b ? b.target : ""));
  expect(tt).toContain("rcsZ");
  expect(tt).not.toContain("yaw");
  expect(tt).toContain("rcsX");
});
