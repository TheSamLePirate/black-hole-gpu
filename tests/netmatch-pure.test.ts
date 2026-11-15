import { expect, test } from "bun:test";
import { setLang } from "../src/i18n";
import { geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { enuOffset, fmtClock, rankingLine } from "../src/ui/netmatch-pure";

// The match's decisions out of src/ui/netmatch.ts (audit 2026-11-10, QA-10): its clock, the ranking's lines by mode, a crash's place
// brought into the fight's frame — the same code, now tested.

const score = { slot: 1, kills: 3, deaths: 1, ai: 2, hits: 7, result: null as number | null, medal: null as string | null };

test("the clock: minutes and seconds, never negative", () => {
  expect(fmtClock(125.9)).toBe("2:05");
  expect(fmtClock(0)).toBe("0:00");
  expect(fmtClock(-4)).toBe("0:00");
});

test("a pilot's line by the match's mode, in English and French", () => {
  setLang("en");
  expect(rankingLine("race", { ...score, result: 83.24, medal: "gold" })).toBe("83.2 s · gold");
  expect(rankingLine("race", score)).toBe("not finished");
  expect(rankingLine("landing", { ...score, result: 87.6 })).toBe("88/100");
  expect(rankingLine("landing", score)).toBe("not landed");
  expect(rankingLine("coop", score)).toBe("2 downed · 7 hits");
  expect(rankingLine("ffa", score)).toBe("3 kills · 1 deaths · 7 hits");
  setLang("fr");
  expect(rankingLine("race", score)).not.toBe("not finished");
  setLang("en");
});

test("a place 500 m north and 40 m up of us, on the WGS84 Earth: east 0, north 500, up 40 (a few cm)", () => {
  const lat = 43.1,
    lon = 6.15,
    D = Math.PI / 180;
  const from = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, 100);
  // (north along the meridian: 500 m of arc at this latitude, its radius of curvature M)
  const e2 = WGS84_F * (2 - WGS84_F);
  const M = (WGS84_A * (1 - e2)) / (1 - e2 * Math.sin(lat * D) ** 2) ** 1.5;
  const at = geodeticToCart(WGS84_A, WGS84_F, (lat + 500 / (M + 100) / D) * D, lon * D, 140);
  const [e, n, u] = enuOffset(from, at);
  expect(Math.abs(e)).toBeLessThan(0.05);
  expect(n).toBeCloseTo(500, 0);
  expect(u).toBeGreaterThan(39.9);
  expect(u).toBeLessThan(40.05);
});
