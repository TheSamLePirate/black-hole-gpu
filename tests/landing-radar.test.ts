import { expect, test } from "bun:test";
import { descentPanel } from "../src/game/craftpanel";
import { LANDER_LR, LANDING_RADARS, landingRadar, lrLock } from "../src/radar/landing";

// The Lander's landing radar (PLAN-RADAR-AAA, RD4's leftover; radar/landing.ts): the altitude locked from 12 km, the
// velocities from 7.5 km, the belly within 50° of the vertical; its figures the probes' (held only when locked); the
// DESCENT panel's LR row.

const at = (h: number, tiltDeg = 0, landed = false) =>
  landingRadar(LANDER_LR, { h, hDot: -20, vFwd: 40, vLat: -2, tilt: (tiltDeg * Math.PI) / 180, landed });

test("the locks by the height: none at 14 km, ALT at 10 km, ALT·VEL at 5 km", () => {
  expect(lrLock(at(14_000))).toBeNull();
  expect(lrLock(at(10_000))).toBe("ALT");
  expect(lrLock(at(5_000))).toBe("ALT·VEL");
  expect(LANDING_RADARS.lander).toBe(LANDER_LR);
  expect(LANDING_RADARS.ranger).toBeUndefined();
});

test("its figures are the probes', held only when locked; the slant along the tilted belly", () => {
  const o = at(5_000, 30);
  expect(o.h).toBe(5_000);
  expect(o.hDot).toBe(-20);
  expect(o.vFwd).toBe(40);
  expect(o.vLat).toBe(-2);
  expect(o.slant!).toBeCloseTo(5_000 / Math.cos(Math.PI / 6), 6);
  const hi = at(10_000);
  expect(hi.h).toBe(10_000);
  expect(hi.hDot).toBeNull();
  expect(hi.vFwd).toBeNull();
});

test("the belly turned away (a pitch-over 60° off the vertical): no lock, whatever the height; landed: locked", () => {
  expect(lrLock(at(2_000, 60))).toBeNull();
  expect(lrLock(at(2_000, 45))).toBe("ALT·VEL");
  expect(lrLock(at(0, 70, true))).toBe("ALT·VEL");
});

test("the DESCENT panel's LR row: ALT · VEL good, ALT warn, NO LOCK · NAV dim high and bad low; none without a radar", () => {
  const base = { h: 2000, hDot: -10, vFwd: 5, vLat: 0, dvLeft: 500, g: 1.62, tank: 0.5 };
  const row = (lr: { alt: boolean; vel: boolean } | null, h = 2000) =>
    descentPanel({ ...base, h, lr }, (s) => s).rows.find((r) => r.label === "LR");
  expect(row({ alt: true, vel: true })).toMatchObject({ value: "ALT · VEL", tone: "good" });
  expect(row({ alt: true, vel: false }, 9000)).toMatchObject({ value: "ALT", tone: "warn" });
  expect(row({ alt: false, vel: false }, 13_000)).toMatchObject({ value: "NO LOCK · NAV", tone: "dim" });
  expect(row({ alt: false, vel: false }, 1000)).toMatchObject({ tone: "bad" });
  expect(row(null)).toBeUndefined();
  // (H stays the panel's first row)
  expect(descentPanel({ ...base, lr: { alt: true, vel: true } }, (s) => s).rows[0]!.label).toBe("H");
});
