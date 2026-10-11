import { afterEach, expect, test } from "bun:test";
import { CameraController } from "../src/controls";
import { defaultSettings } from "../src/settings";
import { M_METRES } from "../src/system/solar";
import { setSceneTime } from "../src/wormhole";
import { len, sub } from "../src/math/vec3";
import { flight, resetFlights } from "./helpers/flight";
import { ourGroundPose } from "../src/game/place";
import { matchKey } from "../src/input/keymap";
import { checkSave } from "../src/game/save";
function walker(body = "moon", lat = 0, lon = 0) {
  setSceneTime(0);
  const c = new CameraController({} as HTMLCanvasElement, defaultSettings(), () => {}, true);
  expect(c.character.start(body, lat, lon)).toBeNull();
  return c;
}
afterEach(resetFlights);
test("walking is invariant at 30/60/120 Hz and diagonal speed is bounded", () => {
  const results = [];
  for (const hz of [30, 60, 120]) {
    const c = walker();
    const start = [...c.character.q] as [number, number, number];
    c.character.move(1, 1, 10, true);
    for (let i = 0; i < hz * 2; i++) c.character.step(1 / hz, 0, null);
    results.push(len(sub(c.character.q, start)));
    expect(c.character.grounded).toBe(true);
    expect(Math.abs(c.character.height())).toBeLessThan(0.03);
  }
  expect(Math.max(...results) - Math.min(...results)).toBeLessThan(0.003);
  expect(results[0]).toBeLessThan(8.01);
  expect(results[0]).toBeGreaterThan(6.5);
});
test("jump follows lunar and terrestrial gravity and lands", () => {
  const peaks = [];
  for (const body of ["earth", "moon", "mars"]) {
    const c = walker(body);
    c.character.jump();
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      c.character.step(1 / 120, 0, null);
      peak = Math.max(peak, c.character.height());
    }
    peaks.push(peak);
    expect(c.character.grounded).toBe(true);
    expect(Math.abs(c.character.height())).toBeLessThan(0.03);
  }
  expect(peaks[1]!).toBeGreaterThan(peaks[0]! * 4);
  expect(peaks[2]!).toBeGreaterThan(peaks[0]! * 2);
});
test("poles and date line produce finite camera frames and gas bodies are rejected", () => {
  for (const [lat, lon] of [
    [90, 180],
    [-90, -180],
    [0, 180],
  ]) {
    const c = walker("earth", lat, lon);
    c.character.move(1, 0, 1);
    c.character.step(0.1, 0, null);
    const frame = c.character.frame()!;
    expect([...frame.origin, ...frame.axes.flat()].every(Number.isFinite)).toBe(true);
  }
  const c = walker();
  expect(c.character.start("jupiter")).not.toBeNull();
  expect(c.character.start("miller")).not.toBeNull();
});
test("disembark/board preserve a landed vessel and reject distant boarding", () => {
  const { c } = flight(ourGroundPose("moon", 0, 0, 0), false);
  const before = c.activePoseNow()!.X;
  expect(c.character.disembark()).toBeNull();
  expect(c.piloting).toBe(true);
  expect(c.s.ship).toBe(true);
  expect(c.character.accessDistance()).toBeLessThan(0.3);
  expect(c.character.board()).toBeNull();
  expect(c.character.active).toBe(false);
  expect(len(sub(c.activePoseNow()!.X, before)) * M_METRES).toBeLessThan(0.001);
  expect(c.character.disembark()).toBeNull();
  c.character.q[0] += 100;
  expect(c.character.board()).not.toBeNull();
  expect(c.character.active).toBe(true);
});
test("Space jumps only on foot and the boarding shortcut remains available there", () => {
  const e = { code: "Space", key: " ", shiftKey: false };
  expect(matchKey(e, true, false, undefined, true)?.do).toBe("characterJump");
  expect(matchKey(e, true, false)?.do).toBe("playPause");
  expect(matchKey({ code: "KeyK", key: "K", shiftKey: true }, true, false, undefined, true)?.do).toBe("leaveShip");
});
test("save validation rejects malformed character payload before restoring anything", () => {
  const saved = {
    v: 2,
    name: "bad",
    savedAt: 0,
    time: 0,
    settings: {},
    ship: { piloting: false, hold: "none", auto: "none", throttle: 0, landed: null },
    character: { body: "earth", ours: true, q: [NaN, 0, 0] },
  };
  expect(() => checkSave(saved)).toThrow("character");
});

test("Mann and Edmunds use the local proper-length frame and remain grounded", () => {
  for (const body of ["mann", "edmunds"]) {
    const c = walker(body);
    const q = [...c.character.q] as [number, number, number];
    c.character.move(1, 0, 1);
    for (let i = 0; i < 120; i++) c.character.step(1 / 120, 0, null);
    expect(c.character.height()).toBeCloseTo(0.012, 2);
    expect(c.character.frame()!.origin.every(Number.isFinite)).toBe(true);
    expect(len(sub(c.character.q, q))).toBeGreaterThan(0);
  }
});
test("boarding only accepts an access point, not any position at the same distance from the craft", () => {
  const { c } = flight(ourGroundPose("moon", 0, 0, 0), false);
  expect(c.character.disembark()).toBeNull();
  const up = c.character.up();
  const forward = c.character.forward;
  c.character.q = c.character.q.map((v, i) => v + forward[i]! * 18 + up[i]! * 0.1) as [number, number, number];
  expect(c.character.accessDistance()).toBeGreaterThan(10);
  expect(c.character.board()).not.toBeNull();
});

test("shared walking grid publishes the same heights and rejects samples outside its bounded patch", async () => {
  const { WalkingGround } = await import("../src/controller/walking-ground");
  const p = new WalkingGround();
  const raw = (q: [number, number, number]) => q[2] - (q[0] * 0.2 + q[1] * 0.1);
  p.build([0, 0, 0], [0, 0, 1], raw, 1);
  expect(p.ready).toBe(true);
  expect(p.sample([2, 3, 0.7])).toBeCloseTo(0, 4);
  expect(p.sample([100, 100, 0])).toBeNull();
  const before = p.stamp;
  p.build([20, 0, 0], [0, 0, 1], raw, 2);
  expect(p.stamp).toBeGreaterThan(before);
  expect(p.sample([22, 3, 4.7])).toBeCloseTo(0, 4);
  p.clear();
  expect(p.sample([0, 0, 0])).toBeNull();
});

test("an explorer save preserves camera heading after the character turns", () => {
  const c = walker();
  c.character.move(0, 1, 1);
  for (let i = 0; i < 120; i++) c.character.step(1 / 120, 0, null);
  c.character.move(0, 0, 0);
  const saved = c.character.snapshot()!;
  const before = c.character.frame()!;
  c.character.stop();
  expect(c.character.restore(saved)).toBeNull();
  const after = c.character.frame()!;
  expect(len(sub(before.origin, after.origin))).toBeLessThan(0.005);
});

test("on-foot rendering applies grass and quality edits without a physics step", () => {
  const c = walker();
  const before = { anchor: c.viewSettings().anchor, distance: c.viewSettings().distance };
  c.s.earthGrass = "off";
  c.s.realtimeSubsampling = 4;
  expect(c.viewSettings().earthGrass).toBe("off");
  expect(c.viewSettings().realtimeSubsampling).toBe(4);
  expect(c.viewSettings().ship).toBe(false);
  expect(c.viewSettings().anchor).toBe(before.anchor);
  expect(c.viewSettings().distance).toBe(before.distance);
});
