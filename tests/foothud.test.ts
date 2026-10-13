// The on-foot HUD's compass and figures (ui/foothud.ts, PLAN-MODES-AAA M5).
import { expect, test } from "bun:test";
import { compassTicks, groundDist, onTape } from "../src/ui/foothud";

test("the tape about north: every 5°, the cardinal points named, wrapped through 360", () => {
  const ticks = compassTicks(0, 120);
  expect(ticks.length).toBe(25);
  expect(ticks.find((k) => k.x === 0)).toMatchObject({ deg: 0, label: "N", major: true });
  expect(ticks.find((k) => k.deg === 45)!.label).toBe("NE");
  expect(ticks.find((k) => k.deg === 315)!.label).toBe("NW");
  expect(ticks.find((k) => k.deg === 30)!.label).toBe("030");
  expect(ticks.find((k) => k.deg === 35)!.label).toBeNull();
  expect(ticks[0]!.x).toBeCloseTo(-0.5, 9);
});

test("a mark on the tape, or pinned at the end it is beyond", () => {
  expect(onTape(10, 40, 120)).toEqual({ x: 0.25, off: false });
  expect(onTape(350, 10, 120).x).toBeCloseTo(20 / 120, 9);
  expect(onTape(0, 180, 120)).toEqual({ x: -0.5, off: true });
  expect(onTape(0, 100, 120)).toEqual({ x: 0.5, off: true });
  expect(onTape(0, 260, 120)).toEqual({ x: -0.5, off: true });
});

test("distances on the ground", () => {
  expect(groundDist(42.4)).toBe("42 m");
  expect(groundDist(1240)).toBe("1.24 km");
  expect(groundDist(12_400)).toBe("12.4 km");
  expect(groundDist(1_240_000)).toBe("1 240 km");
});
