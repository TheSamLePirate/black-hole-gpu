import { expect, test } from "bun:test";
import { BUDGETS, circlePoints, fmtBytes, fmtDuration, nearName, PROFILES, RADII } from "../src/ui/settings/offline";
import { ZONE_PROFILES } from "../src/system/zones";

// Settings › Offline's words (ui/settings/offline.ts): the sizes, the times, a zone's name on the position now.

test("sizes and times in words, French and English", () => {
  expect(fmtBytes(182 * 2 ** 20, "fr")).toBe("182 Mo");
  expect(fmtBytes(1.9 * 2 ** 30, "fr")).toBe("1,9 Go");
  expect(fmtBytes(1.9 * 2 ** 30, "en")).toBe("1.9 GB");
  expect(fmtBytes(BUDGETS[0]!, "en")).toBe("300 MB");
  expect(fmtDuration(45)).toBe("45 s");
  expect(fmtDuration(185)).toBe("3 min");
  expect(fmtDuration(4210)).toBe("1 h 10");
});

test("a zone on the position now named by the Atlas's place nearest within 30 km, else its coordinates", () => {
  expect(nearName(45.912, 6.858)).toMatch(/Mont Blanc/);
  expect(nearName(10, -30)).toMatch(/10\.000° N/);
});

test("the profiles offered are the zones' own, their radii among those offered", () => {
  expect(PROFILES.map((p) => p.id as string).sort()).toEqual(Object.keys(ZONE_PROFILES).sort());
  for (const p of PROFILES) expect(RADII).toContain(p.radiusKm);
});

test("a zone's circle on the map: its rim at its radius from its centre, whatever the latitude", () => {
  const D = Math.PI / 180;
  const dist = (a: [number, number], b: [number, number]) => {
    const h = Math.sin(((b[0] - a[0]) * D) / 2) ** 2 + Math.cos(a[0] * D) * Math.cos(b[0] * D) * Math.sin(((b[1] - a[1]) * D) / 2) ** 2;
    return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
  };
  for (const [lat, lon] of [
    [45.92, 6.87],
    [69.6, 18.9],
    [-33.9, 151.2],
  ] as const) {
    const pts = circlePoints(lat, lon, 10_000, 36);
    expect(pts.length).toBe(37);
    for (const p of pts) expect(Math.abs(dist([lat, lon], p) - 10_000)).toBeLessThan(1);
  }
});
