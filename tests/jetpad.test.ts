import { expect, test } from "bun:test";
import type { PadState } from "../src/gamepad";
import { JETPAD, JetPad } from "../src/input/jetpad";

// The F-35 on an Xbox 360 pad (input/jetpad.ts): the left stick pitch and roll, the triggers the throttle, the bumpers
// a rudder eased in; the right stick the head — where it points, back ahead when let go —, R3 held the zoom eased in
// and out; the buttons' actions on their press, Y's and Menu's tap or hold.

const pad = (o: { lx?: number; ly?: number; rx?: number; ry?: number; rt?: number; lt?: number; held?: number[] } = {}): PadState => {
  const held = Array.from({ length: 17 }, (_, i) => (o.held ?? []).includes(i));
  return {
    move: [o.ly ? o.ly : 0, o.lx ?? 0, (o.rt ?? 0) - (o.lt ?? 0), (held[4] ? 1 : 0) - (held[5] ? 1 : 0)],
    look: [o.rx ?? 0, o.ry ?? 0],
    zoom: 0,
    fast: false,
    actions: [],
    active: true,
    id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)",
    held,
  };
};
const run = (J: JetPad, p: PadState, secs: number) => {
  let out = J.step(p, 1 / 60);
  const acts = [...out.actions];
  for (let t = 1 / 60; t < secs; t += 1 / 60) {
    out = J.step(p, 1 / 60);
    acts.push(...out.actions);
  }
  return { out, acts: acts.map((a) => a.action + (a.arg ? `:${a.arg}` : "")) };
};

test("the sticks and triggers: pitch back nose up, roll right, the throttle; the rudder eased in, out", () => {
  const J = new JetPad();
  // (stick back: move[0] < 0 — pitch up; right: roll right; RT: throttle up)
  const { out } = run(J, pad({ ly: -0.8, lx: 0.5, rt: 1 }), 0.1);
  expect(out.pitch).toBeCloseTo(0.8);
  expect(out.roll).toBeCloseTo(0.5);
  expect(out.throttle).toBe(1);
  // (RB: the rudder right, a quarter of a second to full)
  const y = run(J, pad({ held: [5] }), 0.1).out.yaw;
  expect(y).toBeGreaterThan(0.3);
  expect(y).toBeLessThan(0.6);
  expect(run(J, pad({ held: [5] }), 0.3).out.yaw).toBe(1);
  expect(run(J, pad(), 0.1).out.yaw).toBeLessThan(1);
  expect(run(J, pad(), 0.3).out.yaw).toBe(0);
});

test("the head: where the right stick points, back ahead as it is let go; R3 held: the zoom in and out", () => {
  const J = new JetPad();
  let { out } = run(J, pad({ rx: 1 }), 0.6);
  expect(out.lookYaw).toBeCloseTo(JETPAD.lookYaw, 0);
  ({ out } = run(J, pad({ ry: 1 }), 0.6));
  expect(out.lookPitch).toBeCloseTo(JETPAD.lookUp, 0);
  expect(Math.abs(out.lookYaw)).toBeLessThan(1);
  ({ out } = run(J, pad({ ry: -1 }), 0.6));
  expect(out.lookPitch).toBeCloseTo(-JETPAD.lookDown, 0);
  // (let go: ahead again within a second)
  ({ out } = run(J, pad(), 1));
  expect(out.lookYaw).toBe(0);
  expect(out.lookPitch).toBe(0);
  ({ out } = run(J, pad({ held: [11] }), 0.6));
  expect(out.zoom).toBeGreaterThan(0.95);
  ({ out } = run(J, pad(), 1));
  expect(out.zoom).toBe(0);
});

test("the buttons: their actions on the press; Y tapped the lock, held the intercept; Menu tapped the holds, held the settings; A the gun held", () => {
  const J = new JetPad();
  const press = (b: number, secs = 0.1) => [...run(J, pad({ held: [b] }), secs).acts, ...run(J, pad(), 0.05).acts];
  expect(press(1)).toEqual(["ack"]);
  expect(press(2)).toEqual(["combat:weapon"]);
  expect(press(12)).toEqual(["gear"]);
  expect(press(13)).toEqual(["flaps"]);
  expect(press(14)).toEqual(["combat:cm"]);
  expect(press(15)).toEqual(["airBrake"]);
  expect(press(8)).toEqual(["mount"]);
  expect(press(10)).toEqual(["jetSystem:ab"]);
  expect(press(3, 0.1)).toEqual(["lock"]);
  expect(press(3, 0.6)).toEqual(["intercept"]);
  expect(press(9, 0.1)).toEqual(["jetSystem:ap"]);
  expect(press(9, 0.8)).toEqual(["settings"]);
  // (held: one action, not one a frame)
  expect(run(J, pad({ held: [12] }), 1).acts).toEqual(["gear"]);
  expect(J.step(pad({ held: [0] }), 1 / 60).gun).toBe(true);
  expect(J.step(pad(), 1 / 60).gun).toBe(false);
});
