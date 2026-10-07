import { expect, test } from "bun:test";
import { quantity, Trends } from "../src/ui/hud/trend";

// The hub card's trends (PLAN-HUB HB2): ▲ ▼ beside a row's value when it moved by its last digit over a second.

test("a row's value read as one quantity — words, several figures, times and written trends left out", () => {
  expect(quantity("24.2 km")).toEqual({ x: 24200, unit: "m", step: 100 });
  expect(quantity("−0.6 m/s")).toEqual({ x: -0.6, unit: "m/s", step: 0.1 });
  expect(quantity("15,672 km")).toEqual({ x: 15672e3, unit: "m", step: 1000 });
  expect(quantity("44.6°")!.unit).toBe("°");
  expect(quantity("13 %")!.x).toBe(13);
  expect(quantity("19.1 m · 4.47 m")).toBeNull();
  expect(quantity("cmd 43° R · now 49° R")).toBeNull();
  expect(quantity("17 min 7 s")).toBeNull();
  expect(quantity("61 W/cm² ▲")).toBeNull();
  expect(quantity("Paris – Le Bourget")).toBeNull();
});

test("the arrow: after a second, by the last digit; held a moment; none for a steady value", () => {
  const T = new Trends();
  expect(T.arrow("Height", "24.2 km", 0)).toBe("");
  expect(T.arrow("Height", "24.1 km", 500)).toBe("");
  expect(T.arrow("Height", "24.0 km", 1100)).toBe("▼");
  // (km to m on the way down: the same unit underneath, the trend kept)
  expect(T.arrow("Height", "980 m", 2200)).toBe("▼");
  const S = new Trends();
  for (let t = 0; t <= 4000; t += 200) expect(S.arrow("Speed", "733 m/s", t)).toBe("");
  // (a rise, then steady: the arrow held 1.5 s past its last sight, then gone)
  const U = new Trends();
  U.arrow("q", "1.0 kPa", 0);
  expect(U.arrow("q", "1.4 kPa", 1000)).toBe("▲");
  for (let t = 1100; t <= 2000; t += 100) U.arrow("q", "1.4 kPa", t);
  expect(U.arrow("q", "1.4 kPa", 4000)).toBe("");
});
