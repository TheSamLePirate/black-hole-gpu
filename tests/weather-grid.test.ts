import { expect, test } from "bun:test";
import { TABLE_WXGRID } from "../src/gpu-tables";
import { gridAt, gridCentre, gridPoints, gridUrl, parseGrid, WeatherGridFeed, WXGRID_N, WXGRID_STEP } from "../src/system/weather-grid";
import { modelWeather, type ModelHour } from "../src/openmeteo";
import { weatherGpu } from "../src/weather";

// Q5 C5 — the real weather's model on a grid about the camera (system/weather-grid.ts; trace.wgsl wxGridCover)
const point = (k: number, low: number) => ({
  hourly: {
    time: ["2026-07-10T12:00", "2026-07-10T13:00"],
    cloud_cover_low: [low, low + 10],
    cloud_cover_mid: [k, k],
    cloud_cover_high: [0, 0],
    visibility: [20000, 30000],
  },
});
const json = Array.from({ length: WXGRID_N * WXGRID_N }, (_, k) => point(k, k * 2));

test("the grid's points: 5 × 5, 125 km apart about a centre snapped to 0.5°, east and north", () => {
  expect(gridCentre(45.92, 6.87)).toEqual({ lat: 46, lon: 7 });
  const p = gridPoints(46, 7);
  expect(p.length).toBe(25);
  expect(p[12]).toEqual({ lat: 46, lon: 7 });
  // (a step north ~1.124°, east ~1.124° / cos 46°)
  expect(p[17]!.lat - 46).toBeCloseTo((WXGRID_STEP / 6371e3) * (180 / Math.PI), 6);
  expect(p[13]!.lon - 7).toBeCloseTo(((WXGRID_STEP / 6371e3) * (180 / Math.PI)) / Math.cos((46 * Math.PI) / 180), 6);
});

test("one request for the 25 points: the forecast near today with the visibility, the ERA5 archive before", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const f = gridUrl(46, 7, now, now)!;
  expect(f.kind).toBe("forecast");
  expect(f.url.split("latitude=")[1]!.split("&")[0]!.split(",").length).toBe(25);
  expect(f.url).toContain("visibility");
  const a = gridUrl(46, 7, Date.parse("2020-07-10T12:00:00Z"), now)!;
  expect(a.kind).toBe("archive");
  expect(a.url).not.toContain("visibility");
  expect(gridUrl(46, 7, Date.parse("1930-01-01T00:00:00Z"), now)).toBeNull();
});

test("the answer read point by point, the hour interpolated", () => {
  const h = parseGrid(json)!;
  expect(h.length).toBe(2);
  const v = gridAt(h, Date.parse("2026-07-10T12:30:00Z"))!;
  // (point 3: low 6 % → 16 %, at half past: 11 %; its middle cover 3 %)
  expect(v[4 * 3]!).toBeCloseTo(0.11, 6);
  expect(v[4 * 3 + 1]!).toBeCloseTo(0.03, 6);
  expect(v[4 * 3 + 3]!).toBeCloseTo(25000, 3);
  expect(parseGrid(json.slice(1))).toBeNull();
});

test("the feed: asked once a centre and a day, the grid then at any hour of it", async () => {
  let asked = 0;
  const feed = new WeatherGridFeed(
    async () => {
      asked++;
      return json;
    },
    () => Date.parse("2026-07-10T12:00:00Z"),
  );
  const ms = Date.parse("2026-07-10T12:30:00Z");
  expect(feed.peek(45.92, 6.87, ms)).toBeNull();
  await new Promise((r) => setTimeout(r, 0));
  const g = feed.peek(45.92, 6.87, ms)!;
  expect(g.centre).toEqual({ lat: 46, lon: 7 });
  expect(feed.peek(46.1, 6.9, ms + 600e3)).not.toBeNull();
  expect(asked).toBe(1);
});

test("the layers' classes, in the order drawn: low, middle, high — the grid's cover for each", () => {
  const h: ModelHour = {
    t: 0,
    low: 0.5,
    mid: 0.4,
    high: 0.1,
    vis: 20000,
    precip: 0,
    code: 2,
    u10: 3,
    dir: 200,
    gust: 4,
    T: 18,
    Td: 10,
    p: 1000,
    cape: 0,
  };
  const w = modelWeather(h);
  expect(w.layers.map((l) => l.cls)).toEqual([0, 1]);
  expect(weatherGpu(w, 0, 0.5).classes).toEqual([0, 1, -1]);
});

test("the shader reads the grid where it is: its offset and its 5 × 5", async () => {
  const wgsl = await Bun.file(new URL("../src/shaders/trace.wgsl", import.meta.url)).text();
  expect(wgsl).toContain(`const WXGRID_OFF = ${TABLE_WXGRID}u;`);
  expect(wgsl).toContain(`(ij.y + o.y) * ${WXGRID_N}u + ij.x + o.x`);
  expect(wgsl).toContain(`/ c.w + ${(WXGRID_N - 1) / 2}.0, vec2f(0.0), vec2f(${WXGRID_N - 1}.0)`);
});
