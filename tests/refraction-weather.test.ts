import { expect, test } from "bun:test";
import { mirageFromWeather } from "../src/system/refraction-weather";

// R6b: the mirage the weather makes plausible — a warm sea's under calm air, an inversion over a cold sea, none when the wind
// mixes the layer or the model shows none; never more than a "medium" confidence.

test("a sea warmer than the air, calm: the warm sea's mirage, its strength with the gap", () => {
  const a = mirageFromWeather({ t2m: 15, sst: 18, wind: 3 });
  const b = mirageFromWeather({ t2m: 15, sst: 21, wind: 3 });
  expect(a.kind).toBe("warmSea");
  expect(b.strength).toBeGreaterThan(a.strength);
  expect(a.confidence).toBe("medium");
});

test("the wind mixes it away", () => {
  expect(mirageFromWeather({ t2m: 15, sst: 21, wind: 12 }).kind).toBe("standard");
});

test("warm air over a cold sea with an inversion aloft, calm: a duct, low confidence", () => {
  const g = mirageFromWeather({ t2m: 18, sst: 12, t950: 20, wind: 2 });
  expect(g.kind).toBe("inversion");
  expect(g.confidence).toBe("low");
  expect(mirageFromWeather({ t2m: 18, sst: 12, t950: 10, wind: 2 }).kind).toBe("standard");
});

test("over the ground: an inversion aloft only; the standard air otherwise", () => {
  expect(mirageFromWeather({ t2m: -5, t950: 3, wind: 1 }).kind).toBe("inversion");
  expect(mirageFromWeather({ t2m: 20, t950: 12, wind: 1 }).kind).toBe("standard");
  for (const w of [
    { t2m: 15, sst: 18, wind: 3 },
    { t2m: -5, t950: 3, wind: 1 },
  ])
    expect(["none", "low", "medium"]).toContain(mirageFromWeather(w).confidence);
});
