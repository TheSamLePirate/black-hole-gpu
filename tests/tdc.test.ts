import { expect, test } from "bun:test";
import { BINDINGS } from "../src/input/keymap";
import { HELD_DEFAULTS, remappables } from "../src/input/bindings";
import { slewOf, TDC, Tdc, type TdcScreen } from "../src/input/tdc";

// The designation cursor (PLAN-RADAR-AAA constat 29; input/tdc.ts): held on a screen, slewed, kept within it; on the
// scope at its centre first, on a PCD page at the page's; back where it was left on each; off when let go or with no
// screen; the slews of several controls; its bindings (a held key and « designate » — no clash with the flight keys).

const scope: TdcScreen = { kind: "scope" };
const page = (u0: number): TdcScreen => ({ kind: "pcd", page: "TSD", rect: { u0, v0: 0.2, u1: u0 + 0.25, v1: 0.8 } });
const run = (T: Tdc, slew: [number, number], secs: number, w: TdcScreen | null = scope, held = true) => {
  for (let t = 0; t < secs; t += 1 / 60) T.step(held, slew, 1 / 60, w);
};

test("on the scope: at its centre, the stick right moves it right — fine near the stick's centre —, kept in the disc", () => {
  const T = new Tdc();
  run(T, [0, 0], 0.1);
  expect(T.on).toBe(true);
  expect([T.x, T.y]).toEqual([0, 0]);
  run(T, [1, 0], 0.5);
  expect(T.x).toBeCloseTo(0.5 * TDC.scopeSpeed, 1);
  const T2 = new Tdc();
  run(T2, [0.3, 0], 0.5);
  expect(T2.x).toBeLessThan(0.3 * 0.5 * TDC.scopeSpeed);
  expect(T2.x).toBeGreaterThan(0);
  run(T, [1, 1], 5);
  expect(Math.hypot(T.x, T.y)).toBeCloseTo(1, 6);
  // (a stick at rest: still)
  const x = T.x;
  run(T, [0.05, -0.05], 1);
  expect(T.x).toBe(x);
});

test("on a PCD page: at its centre, the stick up moves it up the display, kept in the page; back where it was left", () => {
  const T = new Tdc();
  run(T, [0, 0], 0.1, page(0.5));
  expect(T.x).toBeCloseTo(0.625, 9);
  expect(T.y).toBeCloseTo(0.5, 9);
  run(T, [0, 1], 0.5, page(0.5));
  expect(T.y).toBeLessThan(0.5);
  run(T, [1, 0], 5, page(0.5));
  expect(T.x).toBeCloseTo(0.75, 9);
  const left: [number, number] = [T.x, T.y];
  // (to the scope and back: where it was on that page)
  run(T, [0, 0], 0.1, scope);
  expect([T.x, T.y]).toEqual([0, 0]);
  run(T, [0, 0], 0.1, page(0.5));
  expect([T.x, T.y]).toEqual(left);
  // (another page: its own centre)
  run(T, [0, 0], 0.1, page(0));
  expect(T.x).toBeCloseTo(0.125, 9);
});

test("let go, or no screen: off; held again: back where it was", () => {
  const T = new Tdc();
  run(T, [1, 0], 0.3);
  const x = T.x;
  run(T, [0, 0], 0.1, scope, false);
  expect(T.on).toBe(false);
  expect(T.screen).toBeNull();
  run(T, [0, 0], 0.1, null);
  expect(T.on).toBe(false);
  run(T, [0, 0], 0.05);
  expect(T.x).toBe(x);
  T.reset();
  run(T, [0, 0], 0.05);
  expect(T.x).toBe(0);
});

test("the slew of several controls: on each axis the one moved the most", () => {
  expect(slewOf([0.2, -0.9], null, [-0.5, 0.1], undefined)).toEqual([-0.5, -0.9]);
  expect(slewOf()).toEqual([0, 0]);
});

test("its bindings: a held « tdc » off the flight keys, « designate » on F14 — both a HOTAS button's in the controls", () => {
  expect(HELD_DEFAULTS.tdc).toBe("F15");
  const flightCodes = new Set<string>();
  for (const b of BINDINGS)
    if (b.layer === "flight" || b.layer === "system" || b.layer === "time") for (const c of b.code ?? []) flightCodes.add(c);
  for (const [a, c] of Object.entries(HELD_DEFAULTS)) if (a !== "tdc" && !a.startsWith("cam")) flightCodes.add(c);
  expect(flightCodes.has("F15")).toBe(false);
  // (AZERTY's Z Q S D / A E / W X — by their physical keys — never the TDC's)
  for (const c of ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyZ", "KeyX"]) expect(HELD_DEFAULTS.tdc).not.toBe(c);
  const d = BINDINGS.filter((b) => b.do === "designate");
  expect(d.map((b) => b.code?.[0])).toEqual(["F14"]);
  const r = remappables();
  expect(r.some((x) => x.id === "held:tdc" && x.group === "fly-held")).toBe(true);
  expect(r.some((x) => x.id.startsWith("flight:designate:"))).toBe(true);
});
