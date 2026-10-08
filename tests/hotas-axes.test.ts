import { expect, test } from "bun:test";
import {
  absolute,
  centred,
  detect,
  deviceModel,
  hatPressed,
  pressedEdges,
  readCommands,
  SHAPE_DEFAULT,
  type DeviceSnapshot,
  type Profile,
} from "../src/input/axes";

// PLAN-HOTAS H1: the controllers' model — devices identified, axes shaped, a throttle read as a lever,
// hats, bindings across several devices, the detection of the axis moved.

test("a device's model from the browser's id: Chrome's, Firefox's, Safari's", () => {
  expect(deviceModel("T.16000M (Vendor: 044f Product: b10a)")).toEqual({ model: "044f:b10a", name: "T.16000M" });
  expect(deviceModel("Xbox 360 Controller (XInput STANDARD GAMEPAD Vendor: 045e Product: 028e)").model).toBe("045e:028e");
  expect(deviceModel("44f-b687-TWCS Throttle")).toEqual({ model: "044f:b687", name: "TWCS Throttle" });
  expect(deviceModel("Saitek Pro Flight Rudder Pedals").model).toBe("name:saitek pro flight rudder pedals");
});

test("a centred axis: its dead zone out, full deflection kept, finer near the centre, inverted", () => {
  const s = { ...SHAPE_DEFAULT, dead: 0.1, curve: 0.5 };
  expect(centred(0.05, s)).toBe(0);
  expect(centred(-0.09, s)).toBe(0);
  expect(centred(1, s)).toBeCloseTo(1, 9);
  expect(centred(-1, s)).toBeCloseTo(-1, 9);
  // (half way out: under half the command — the curve's finesse)
  expect(centred(0.55, s)).toBeLessThan(0.5);
  expect(centred(0.55, s)).toBeGreaterThan(0.2);
  expect(centred(0.5, { ...s, invert: true })).toBeCloseTo(-centred(0.5, s), 9);
  // (calibrated: a stick that only reaches ±0.9 reads full)
  expect(centred(0.9, { ...s, min: -0.9, max: 0.9 })).toBeCloseTo(1, 6);
});

test("a throttle lever, absolute: 0 at the bottom with its idle detent, full at the top, linear between", () => {
  const s = { ...SHAPE_DEFAULT };
  expect(absolute(-1, s)).toBe(0);
  expect(absolute(-0.95, s)).toBe(0);
  expect(absolute(1, s)).toBeCloseTo(1, 9);
  expect(absolute(0, s)).toBeCloseTo((0.5 - 0.04) / 0.96, 6);
  // (inverted: the lever's top at −1 — many throttles report forward as −1)
  expect(absolute(-1, { ...s, invert: true })).toBeCloseTo(1, 9);
});

test("a hat reported as an axis: its eight positions, centred beyond 1", () => {
  expect(hatPressed(-1, "up")).toBe(true);
  // (up-right: both)
  expect(hatPressed(-1 + 2 / 7, "right")).toBe(true);
  expect(hatPressed(-1 + 2 / 7, "up")).toBe(true);
  expect(hatPressed(-1 + 2 / 7, "down")).toBe(false);
  expect(hatPressed(-1 + 4 / 7, "right")).toBe(true);
  expect(hatPressed(-1 + 8 / 7, "down")).toBe(true);
  expect(hatPressed(1, "left")).toBe(true);
  expect(hatPressed(1.28, "up")).toBe(false);
});

const stick: DeviceSnapshot = { model: "044f:b10a", name: "T.16000M", standard: false, axes: [0.5, -1, 0, 0.2], buttons: [1, 0, 0] };
const lever: DeviceSnapshot = { model: "044f:b687", name: "TWCS", standard: false, axes: [0, 0, -0.2], buttons: [0] };
const pedals: DeviceSnapshot = { model: "044f:b679", name: "TFRP", standard: false, axes: [-1, -1, 0.6], buttons: [] };

const profiles = new Map<string, Profile>([
  [
    "044f:b10a",
    {
      model: "044f:b10a",
      name: "T.16000M",
      bindings: [
        { target: "roll", source: { kind: "axis", index: 0 } },
        { target: "pitch", source: { kind: "axis", index: 1 }, shape: { ...SHAPE_DEFAULT, invert: true } },
        { target: "yaw", source: { kind: "axis", index: 3 } },
        { action: "sas", source: { kind: "button", index: 0 } },
      ],
    },
  ],
  [
    "044f:b687",
    {
      model: "044f:b687",
      name: "TWCS",
      bindings: [{ target: "throttle", source: { kind: "axis", index: 2 }, shape: { ...SHAPE_DEFAULT, invert: true } }],
    },
  ],
  [
    "044f:b679",
    {
      model: "044f:b679",
      name: "TFRP",
      bindings: [
        { target: "yaw", source: { kind: "axis", index: 2 } },
        { target: "brakeL", source: { kind: "axis", index: 0 } },
      ],
    },
  ],
]);

test("three devices read together: the stick's roll and pitch, the lever's throttle, the pedals' rudder summed with the twist", () => {
  const c = readCommands([stick, lever, pedals], profiles);
  expect(c.axes.roll).toBeCloseTo(centred(0.5, SHAPE_DEFAULT), 9);
  expect(c.axes.pitch).toBeCloseTo(1, 9);
  expect(c.axes.throttle).toBeCloseTo(absolute(-0.2, { ...SHAPE_DEFAULT, invert: true }), 9);
  expect(c.axes.yaw).toBeCloseTo(Math.min(centred(0.2, SHAPE_DEFAULT) + centred(0.6, SHAPE_DEFAULT), 1), 9);
  // (the toe brake at rest: 0)
  expect(c.axes.brakeL).toBe(0);
  expect(c.actions.get("sas")).toBe(true);
  // (no profile: nothing; no binding: absent)
  expect(readCommands([stick], new Map()).axes.roll).toBeUndefined();
  expect(c.axes.rcsX).toBeUndefined();
});

test("buttons: an action fires once, on the press", () => {
  expect(pressedEdges(new Map([["sas", true]]), new Map([["sas", false]]))).toEqual(["sas"]);
  expect(pressedEdges(new Map([["sas", true]]), new Map([["sas", true]]))).toEqual([]);
});

test("the detection: the axis moved the most — a stick's half, a lever's whole travel, a button", () => {
  const rest: DeviceSnapshot = { model: "m", name: "m", standard: false, axes: [0, 0, -1], buttons: [0, 0] };
  const seen = () => ({ lo: [] as number[], hi: [] as number[] });
  expect(detect(rest, { ...rest, axes: [0.8, 0.1, -1] }, seen())).toEqual({ kind: "axis", index: 0, half: 1 });
  const sw = seen();
  detect(rest, { ...rest, axes: [0.8, 0, -1] }, sw);
  expect(detect(rest, { ...rest, axes: [-0.8, 0, -1] }, sw)).toEqual({ kind: "axis", index: 0 });
  expect(detect(rest, { ...rest, axes: [0, 0, 0.9] }, seen())).toEqual({ kind: "axis", index: 2 });
  expect(detect(rest, { ...rest, buttons: [0, 1] }, seen())).toEqual({ kind: "button", index: 1 });
  expect(detect(rest, { ...rest, axes: [0.2, 0, -1] }, seen())).toBeNull();
});
