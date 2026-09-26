import { afterEach, describe, expect, test } from "bun:test";
import { GamepadInput } from "../src/gamepad";

type FakePad = { axes: number[]; buttons: { pressed: boolean; value: number }[]; connected: boolean; mapping: string; index: number; id: string };
const pad = (): FakePad => ({
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  connected: true,
  mapping: "standard",
  index: 0,
  id: "Xbox Wireless Controller (STANDARD GAMEPAD)",
});
const nav = globalThis.navigator as unknown as { getGamepads?: () => (FakePad | null)[] };
const original = nav.getGamepads;
afterEach(() => (nav.getGamepads = original));

describe("game controller", () => {
  test("no pad: nothing", () => {
    nav.getGamepads = () => [null, null];
    const g = new GamepadInput();
    expect(g.poll()).toBeNull();
    expect(g.connected).toBe(false);
  });

  test("sticks: dead zone, full deflection = 1, forward is up on the left stick", () => {
    const p = pad();
    nav.getGamepads = () => [p];
    const g = new GamepadInput();
    p.axes = [0.08, -0.08, 0.05, 0]; // inside the radial dead zone (0.14)
    let s = g.poll()!;
    expect(s.move.slice(0, 2)).toEqual([0, 0]);
    expect(s.look).toEqual([0, 0]);
    expect(s.active).toBe(false);
    p.axes = [0, -1, 1, 0]; // left stick up, right stick right
    s = g.poll()!;
    expect(s.move[0]).toBeCloseTo(1, 6);
    expect(s.look[0]).toBeCloseTo(1, 6);
    p.axes = [0, 0, 0, -1]; // right stick up: look up
    expect(g.poll()!.look[1]).toBeCloseTo(1, 6);
    p.axes = [0, 0, 1, -1]; // diagonal: clamped to a unit deflection
    expect(Math.hypot(...g.poll()!.look)).toBeCloseTo(1, 6);
    // gentle curve: half deflection gives less than half
    p.axes = [0.5, 0, 0, 0];
    expect(g.poll()!.move[1]).toBeLessThan(0.5);
  });

  test("triggers and bumpers: up / down, roll", () => {
    const p = pad();
    nav.getGamepads = () => [p];
    const g = new GamepadInput();
    p.buttons[7] = { pressed: true, value: 1 }; // RT
    p.buttons[4] = { pressed: true, value: 1 }; // LB
    const s = g.poll()!;
    expect(s.move[2]).toBeCloseTo(1, 6);
    expect(s.move[3]).toBe(1);
  });

  test("buttons fire once per press", () => {
    const p = pad();
    nav.getGamepads = () => [p];
    const g = new GamepadInput();
    p.buttons[0] = { pressed: true, value: 1 }; // A
    p.buttons[15] = { pressed: true, value: 1 }; // D-pad ▶
    expect(g.poll()!.actions.sort()).toEqual(["focus", "nextTarget"]);
    expect(g.poll()!.actions).toEqual([]); // still held
    p.buttons[0] = { pressed: false, value: 0 };
    g.poll();
    p.buttons[0] = { pressed: true, value: 1 };
    expect(g.poll()!.actions).toEqual(["focus"]);
  });
});

describe("wired Xbox 360 pad over WebHID", () => {
  test("the 20-byte report maps to the standard layout", async () => {
    const { HidPad } = await import("../src/gamepad");
    const pad = new HidPad({ vendorId: 0x045e, productId: 0x028e, productName: "Controller", opened: true, open: async () => {}, addEventListener: () => {} });
    const d = new DataView(new ArrayBuffer(20));
    d.setUint8(0, 0x00);
    d.setUint8(1, 0x14);
    d.setUint8(2, 0x01 | 0x10); // D-pad ▲, Start
    d.setUint8(3, 0x10 | 0x02); // A, RB
    d.setUint8(5, 255); // RT
    d.setInt16(6, 32767, true); // LX right
    d.setInt16(8, 32767, true); // LY up
    d.setInt16(12, -32768, true); // RY down
    pad.update(d);
    const on = pad.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0);
    expect(on).toEqual([0, 5, 7, 9, 12]); // A, RB, RT, Menu, ▲
    expect(pad.buttons[7]!.value).toBeCloseTo(1, 6);
    expect(pad.axes[0]).toBeCloseTo(1, 4);
    expect(pad.axes[1]).toBeCloseTo(-1, 4); // standard: up = −1
    expect(pad.axes[3]).toBeCloseTo(1, 4); // down = +1
    expect(pad.mapping).toBe("standard");
  });
});
