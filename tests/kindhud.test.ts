// The Space and Approach HUDs' readouts (ui/hud/kindhud.ts, PLAN-MODES-AAA M4): their lines and deviations.
import { expect, test } from "bun:test";
import { deviationDots, hudDur, hudKm, spaceLines } from "../src/ui/hud/kindhud";

test("durations and heights as the HUD writes them", () => {
  expect(hudDur(42.4)).toBe("42 s");
  expect(hudDur(725)).toBe("12:05");
  expect(hudDur(3 * 3600 + 20 * 60)).toBe("3 h 20");
  expect(hudDur(2.4 * 86400)).toBe("2.4 d");
  expect(hudDur(Number.NaN)).toBe("—");
  expect(hudKm(412.34)).toBe("412.3 km");
  expect(hudKm(38_400)).toBe("38 400 km");
  expect(hudKm(1_234_000)).toBe("1.23 M km");
});

test("the Space HUD: an orbit's apsides and times, the next event, the target closing", () => {
  const L = spaceLines({
    body: "Earth",
    orbit: { apKm: 412.3, peKm: 398, tAp: 1392, tPe: 4120, incDeg: 51.64, ecc: 0.0011, period: 5561 },
    next: { kind: "enter", name: "Moon", inS: 3 * 86400 },
    target: { name: "ISS", distKm: 1.24, rate: -2.4 },
  }).map((l) => l.t);
  expect(L[0]).toBe("ORBIT · EARTH");
  expect(L[1]).toMatch(/^AP +412\.3 km {2}T−23:12$/);
  expect(L[2]).toMatch(/^PE +398\.0 km {2}T−1 h 08$/);
  expect(L[3]).toBe("INC 51.6°  e 0.0011  P 1 h 32");
  expect(L[4]).toBe("SOI MOON  T−3.0 d");
  expect(L[5]).toBe("TGT ISS 1240 m  −2.4 m/s");
});

test("an escape: no apoapsis; an impact in red", () => {
  const L = spaceLines({
    body: "Moon",
    orbit: { apKm: Number.POSITIVE_INFINITY, peKm: -12, tAp: Number.NaN, tPe: 300, incDeg: 3, ecc: 1.3, period: Number.POSITIVE_INFINITY },
    next: { kind: "impact", name: "Moon", inS: 240 },
    target: null,
  });
  expect(L[0]!.t).toBe("ESCAPE · MOON");
  expect(L.some((l) => l.t.startsWith("AP"))).toBe(false);
  expect(L.find((l) => l.t.startsWith("IMPACT"))!.col).toBe("#ff5a46");
  expect(L.find((l) => l.t.startsWith("PE"))!.col).toBe("#ffc85a");
});

test("the deviations: high on the glide, the diamond down; right of the axis, the diamond left; clamped", () => {
  expect(deviationDots({ el: 0.35, az: 0 })).toEqual({ glide: 1, axis: -0 });
  expect(deviationDots({ el: -0.7, az: 2.5 })).toEqual({ glide: -2, axis: -2 });
  expect(deviationDots({ el: 5, az: -10 })).toEqual({ glide: 2.2, axis: 2.2 });
  expect(deviationDots({ el: null, az: null })).toEqual({ glide: null, axis: null });
});
