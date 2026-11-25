import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DETAIL_SURVEY_RES, earthDetail, surveyKept } from "../src/terrain";

// (26 Nov 2026, Sam's decision of 25 Nov) The procedural relief's finest layer (o3: 32 → 8 m, ±3 m on land) faded wherever a survey
// holds the ground finer than it — the coarser layers' rule (octaveKept) —, for the contact (terrain.ts) and the GPU (trace.wgsl) alike:
// it had put ±0.4 m back across the levelled streets of Paris. The global data's ground (res ≥ 25 m) unchanged to the bit.

const D = Math.PI / 180;
const at = (lat: number, lon: number): [number, number, number] => [
  Math.cos(lat * D) * Math.cos(lon * D),
  Math.cos(lat * D) * Math.sin(lon * D),
  Math.sin(lat * D),
];

/** earthDetail before the change (4e95c6bc) at the global data's resolutions: Paris, Mont Faron, Chamonix, the
 *  outback, the Grand Canyon — [lat, lon, h0, res, detail] */
const BEFORE: [number, number, number, number, number][] = [
  [48.8635, 2.3349, 34, 25, -0.2825683640636399],
  [48.8635, 2.3349, 34, 30, -0.24109638394269906],
  [48.8635, 2.3349, 34, 4900, -6.711596360321136],
  [43.135, 5.93, 400, 25, 0.10082242393629207],
  [43.135, 5.93, 400, 30, 0.2426260709344117],
  [43.135, 5.93, 400, 4900, -5.10135919448268],
  [45.9, 6.87, 1800, 25, 0.6097248196515488],
  [45.9, 6.87, 1800, 30, 1.5977521349199084],
  [45.9, 6.87, 1800, 4900, 597.0967407493806],
  [-23.5, 133.9, 600, 25, 0.1760272361752282],
  [-23.5, 133.9, 600, 30, 0.38654732596265745],
  [-23.5, 133.9, 600, 4900, 46.11440457124093],
  [36.1, -112.1, 2100, 25, 2.9996500535153534],
  [36.1, -112.1, 2100, 30, 4.375456947514382],
  [36.1, -112.1, 2100, 4900, 383.199766920254],
];

test("where nothing is surveyed (res ≥ 25 m), the detail as before, to the bit", () => {
  for (const [la, lo, h0, res, v] of BEFORE) expect(earthDetail(at(la, lo), h0, 0.05, res)).toBe(v);
});

test("on a survey's ground (1 m), no procedural relief left; the global data's there had some (the witness)", () => {
  for (const [la, lo, h0] of BEFORE) {
    expect(earthDetail(at(la, lo), h0, 0.05, 1)).toBe(0);
  }
  // (positive witness: the Paris street's, before — the ±0.3 m the contact read across it)
  expect(Math.abs(BEFORE[0]![4])).toBeGreaterThan(0.2);
});

test("the rule: whole on the surveyed ground, none on the global data's, smooth between", () => {
  for (const lam of [31.86, 15.7, 7.7]) {
    for (const res of [25, 30, 100, 4900]) expect(surveyKept(lam, res)).toBe(1);
    // (a survey of 1 m holds every one of these octaves; one of 3 m the 32 and 16 m ones, the 8 m one in part)
    expect(surveyKept(lam, 1)).toBe(0);
  }
  expect(surveyKept(31.86, 3)).toBe(0);
  expect(surveyKept(15.7, 3)).toBe(0);
  expect(surveyKept(7.7, 3)).toBeGreaterThan(0);
  // (continuous across a survey's edge, res from 1 to 30 m)
  let worst = 0;
  for (let r = 1; r < 30; r += 0.05) worst = Math.max(worst, Math.abs(surveyKept(31.86, r + 0.05) - surveyKept(31.86, r)));
  expect(worst).toBeLessThan(0.02);
  expect(DETAIL_SURVEY_RES).toBe(25);
});

test("one rule: the tracer's earthDetail fades its finest layer by the same surveyKept, its constant the same", () => {
  const w = readFileSync(`${import.meta.dir}/../src/shaders/trace.wgsl`, "utf8");
  expect(w).toContain("const DETAIL_SURVEY_RES = 25.0;");
  expect(w).toContain("return 1.0 - (1.0 - smoothstep(0.5 * DETAIL_SURVEY_RES, DETAIL_SURVEY_RES, res)) * (1.0 - octaveKept(lam, res));");
  const det = w.slice(w.indexOf("fn earthDetail("), w.indexOf("fn earthDetail(") + 2000);
  expect(det).toContain("tfbmFs(q * 200000.0 + vec3f(3.0), o3, EARTH_RM / 200000.0, res)");
  const t = readFileSync(`${import.meta.dir}/../src/terrain.ts`, "utf8");
  expect(t).toContain("tfbmFs(sc(q, 200000, 3), o3, EARTH_RM / 200000, res)");
  // (and the global data's resolution the tiles give is that constant)
  expect(readFileSync(`${import.meta.dir}/../src/system/earth-tiles.ts`, "utf8")).toContain("export const TILE_RES_MIN = 25;");
});
