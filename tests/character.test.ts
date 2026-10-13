import { localPatch } from "../src/system/local-patch";
import type { GpuBody } from "../src/system/scene-bodies";
import { cameraFrame } from "../src/camera";
import { planetFrame, toLocal, toGlobal, betaToCoord } from "../src/landing";
import { afterEach, expect, test } from "bun:test";
import { CameraController } from "../src/controls";
import { defaultSettings } from "../src/settings";
import { M_METRES } from "../src/system/solar";
import { toBodyFixed } from "../src/system/our-surface";
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
  expect(c.character.start("miller")).toBeNull();
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
test("save validation leaves a malformed character payload out before restoring anything", () => {
  const saved = {
    v: 2,
    name: "bad",
    savedAt: 0,
    time: 0,
    settings: {},
    ship: { piloting: false, hold: "none", auto: "none", throttle: 0, landed: null },
    character: { body: "earth", ours: true, q: [NaN, 0, 0] },
  };
  // (the walker dropped and told, the flight still loads with the pilot on board)
  expect(checkSave(saved).character).toBeUndefined();
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
  // (the fine grid is made 1 ms at a time, the one under way finished first: built until the new one is out)
  for (let i = 0; i < 2000 && (p.origin[0] !== 20 || p.size !== 65); i++) p.build([20, 0, 0], [0, 0, 1], raw, 2);
  expect(p.origin[0]).toBe(20);
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

test("walking, running, jump and the camera distance on foot follow their settings", () => {
  setSceneTime(0);
  const s = defaultSettings();
  s.walkSpeed = 2.5;
  s.runSpeed = 6;
  s.jumpSpeed = 2;
  s.characterDistance = 6;
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  expect(c.character.start("earth", 0, 0)).toBeNull();
  expect(c.character.distance).toBe(6);
  c.character.move(1, 0, 3);
  for (let i = 0; i < 240; i++) c.character.step(1 / 120, 0, null);
  expect(len(c.character.velocity)).toBeGreaterThan(2.4);
  expect(len(c.character.velocity)).toBeLessThan(2.6);
  c.character.move(1, 0, 3, true);
  for (let i = 0; i < 300; i++) c.character.step(1 / 120, 0, null);
  expect(len(c.character.velocity)).toBeGreaterThan(5.8);
  expect(len(c.character.velocity)).toBeLessThan(6.2);
  // Launch speed v gives a height v²/2g: 2 m/s rises (2/3.6)² of the 3.6 m/s jump, about 31 %.
  const peak = (speed: number) => {
    const j = new CameraController({} as HTMLCanvasElement, { ...defaultSettings(), jumpSpeed: speed }, () => {}, true);
    j.character.start("earth", 0, 0);
    j.character.jump();
    let top = 0;
    for (let i = 0; i < 600; i++) {
      j.character.step(1 / 120, 0, null);
      top = Math.max(top, j.character.height());
    }
    return top;
  };
  expect(peak(2) / peak(3.6)).toBeGreaterThan(0.25);
  expect(peak(2) / peak(3.6)).toBeLessThan(0.37);
});

test("jumping under a bridge stops the capsule's head and returns to the floor", async () => {
  const { SceneryContact } = await import("../src/system/scenery-contact");
  const { polygonPrimitive } = await import("../src/system/scenery-geometry");
  const { packScenery, sceneryFrame } = await import("../src/system/scenery-data");
  const c = walker("earth");
  const ch = c.character,
    frame = sceneryFrame(0, 0);
  const base = ch.q[0] - frame.origin[0];
  const ring: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ] = [
    [-5, -5, 0],
    [5, -5, 0],
    [5, 5, 0],
    [-5, 5, 0],
    [-5, -5, 0],
  ];
  const deck = polygonPrimitive([ring], base + 2, base + 2.3, 2, [0.1, 0.1, 0.1])!;
  const contact = new SceneryContact({ id: 1, lat: 0, lon: 0 }, packScenery([deck], new Uint32Array(512 * 512)));
  ch.contact = () => contact;
  ch.jump();
  let peak = 0;
  for (let i = 0; i < 480; i++) {
    ch.step(1 / 120, 0, null);
    peak = Math.max(peak, ch.height());
  }
  expect(peak).toBeLessThan(0.3);
  expect(ch.grounded).toBe(true);
  expect(ch.height()).toBeCloseTo(0.012, 2);
});

test("Gargantua on-foot camera shares the world's orbital velocity instead of stopping in the hole frame", () => {
  for (const body of ["mann", "miller", "edmunds"]) {
    const c = walker(body, 15, 45),
      sp = c.spectator!,
      w = sp.rigWorld()!;
    const F = planetFrame(body, 0, c.s.spin, c.s.massSolar),
      L = toLocal(F, w.X, [0, 0, 0]);
    const expected = toGlobal(F, { xi: L.xi, w: [0, 0, 0], landed: true }).V;
    const actual = betaToCoord(w.X, cameraFrame(sp.s).beta, c.s.spin);
    expect(len(sub(actual, expected)) * 299792458).toBeLessThan(0.1);
    expect(Math.abs(c.character.height())).toBeLessThan(0.01);
  }
});

test("Gargantua terrain floating origin uses the same proper local metres as the walker", () => {
  for (const body of ["mann", "miller", "edmunds"]) {
    const c = walker(body, 15, 45),
      sp = c.spectator!,
      cam = cameraFrame(sp.s),
      w = sp.rigWorld()!;
    const F = planetFrame(body, 0, c.s.spin, c.s.massSolar),
      L = toLocal(F, w.X, [0, 0, 0]);
    const b = { id: body, pos: F.C, radius: F.R, parent: -1, kind: 1, where: 0, light: -1 } as GpuBody;
    const patch = localPatch(cam, [b], () => F.V, 1, { time: 0, spin: c.s.spin, massSolar: c.s.massSolar })!;
    expect(patch).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      const bodyEye = -patch.axes[i]!.reduce((sum, x, j) => sum + x * patch.centre[j]!, 0) * F.R;
      expect(Math.abs(bodyEye - L.xi[i]!) * F.mPerM).toBeLessThan(0.01);
    }
    const frame = c.character.frame()!;
    expect(Math.hypot(...frame.origin)).toBeLessThan(10);
  }
});

test("the walk left for the free camera: the walker's view stays where it was, not cut back to the ship", () => {
  const { c } = flight(ourGroundPose("moon", 0, 0, 0), false);
  expect(c.character.disembark()).toBeNull();
  c.character.move(1, 0, 4);
  for (let i = 0; i < 480; i++) c.character.step(1 / 120, 0, null);
  // (on the Moon's ground: its turn and its orbit carry the view)
  const fixed = () => toBodyFixed("moon", c.spectator!.rigWorld()!.X, c.spectator!.nowTime());
  const before = fixed();
  c.character.stop({ keepView: true });
  expect(c.spectator).not.toBeNull();
  // (a second of the scene's time, as the app's frames run it)
  for (let i = 1; i <= 30; i++) c.advanceSpectator(1 / 30, (i / 30) * c.s.timeSpeed, null);
  expect(len(sub(fixed(), before)) * M_METRES).toBeLessThan(0.5);
});

test("a new flight with nobody walking: the character's stop leaves the spectator to the flight", () => {
  const { c } = flight(ourGroundPose("moon", 0, 0, 0), false);
  const sp = new CameraController({} as HTMLCanvasElement, { ...c.s, ship: false }, () => {}, true);
  c.spectator = sp;
  c.character.stop();
  expect(c.spectator).toBe(sp);
  c.newFlight();
  expect(c.spectator).toBeNull();
});
