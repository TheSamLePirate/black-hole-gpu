import { expect, test } from "bun:test";
import { addOverground, HLOD_MIN, HLOD_Z1, hlodSize, markFine, overground, surveyOnly } from "../src/system/earth-tiles";

const T = 256;

test("the surface's side: twice the texel's below z 13, a top kept of four; the texel's at z 13", () => {
  expect(hlodSize(11)).toBe(512);
  expect(hlodSize(12)).toBe(512);
  expect(hlodSize(HLOD_Z1)).toBe(256);
});

test("the overground on the ground: a tower's top kept whole, the surveys' noise and a crop left out, no slope's bias", () => {
  const n = 512;
  // (flat ground at 40 m; the surface a few decimetres off it, a crop at 1.5 m, one sample a tower 210 m high)
  const ground = new Float32Array(T * T).fill(40);
  const surface = new Float32Array(n * n);
  for (let i = 0; i < surface.length; i++) surface[i] = 40 + 0.3 * Math.sin(i);
  for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) surface[j * n + i] = 41.5;
  surface[300 * n + 301] = 250;
  addOverground(ground, surface, n);
  // (the tower's texel: its top, not a quarter of it)
  expect(ground[150 * T + 150]).toBeCloseTo(250, 3);
  // (its neighbours, and the crop, bare)
  expect(ground[150 * T + 151]).toBe(40);
  expect(ground[5 * T + 5]).toBe(40);
  expect(HLOD_MIN).toBeGreaterThan(1.5);
});

test("a slope's surface the ground itself: nothing added (the surface's top over a texel would be its uphill edge)", () => {
  const n = 512;
  // (a 30 % slope eastwards: 25 m texels, the surface its exact value at each sample's centre)
  const texel = 25;
  const ground = new Float32Array(T * T);
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) ground[j * T + i] = 100 + 0.3 * texel * i;
  const surface = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) surface[j * n + i] = 100 + 0.3 * texel * ((i + 0.5) / 2 - 0.5);
  const before = ground.slice();
  addOverground(ground, surface, n);
  let most = 0;
  for (let i = 0; i < T * T; i++) most = Math.max(most, Math.abs(ground[i]! - before[i]!));
  expect(most).toBe(0);
});

test("over the sea, no overground: the bed's depth no mound, nor the surface model's ramps — a ship's hull not relief either", () => {
  // (a coast's tile: the ground the bathymetry — 30 m under the sea —, the surface model the water a few decimetres about 0 m;
  // one sample a ship's superstructure 12 m over the water. Since T7 (6e4148c0, Sam, 5 Nov 2026) nothing over the sea: the
  // LiDAR HD's surface interpolated over the water stood ramps of tens to hundreds of metres there — a ship is no relief)
  const n = 512;
  const ground = new Float32Array(T * T).fill(-30);
  const surface = new Float32Array(n * n);
  for (let i = 0; i < surface.length; i++) surface[i] = 0.4 * Math.sin(i);
  surface[100 * n + 101] = 12;
  addOverground(ground, surface, n);
  expect(ground[5 * T + 5]).toBe(-30);
  expect(ground[50 * T + 50]).toBe(-30);
});

test("a tile's second pass: the overground over the survey's own ground alone, never over the sea it filled from Terrarium", () => {
  // (the stored ground: the IGN's land on the left half — marked —, the sea on the right filled from Terrarium at 0 — unmarked —;
  // the surface model over the sea a grid of streaks 40 m up, as the IGN's off Bonifacio; a building 30 m on the land)
  const n = 512;
  const ground = new Float32Array(T * T);
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) ground[j * T + i] = i < T / 2 ? 20 : 0;
  for (let j = 0; j < T; j++) {
    const row = ground.subarray(j * T, j * T + T / 2);
    markFine(row, true);
  }
  const surface = new Float32Array(n * n).fill(-15);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (i % 64 < 3 && i >= n / 2) surface[j * n + i] = 40;
  for (let j = 0; j < n; j++) for (let i = 0; i < n / 2; i++) surface[j * n + i] = 20;
  surface[100 * n + 101] = 50;
  const over = overground(surveyOnly(ground), surface, n);
  expect(over[50 * T + 50]).toBeCloseTo(30, 3);
  let sea = 0;
  for (let j = 0; j < T; j++) for (let i = T / 2 + 1; i < T; i++) sea = Math.max(sea, over[j * T + i]!);
  expect(sea).toBe(0);
  // (without the survey's mark — the ground as stored —: the streaks became mounds)
  expect(Math.max(...overground(ground, surface, n))).toBeGreaterThan(30);
});

test("no surface there, or no ground: the ground its own", () => {
  const ground = new Float32Array(T * T).fill(12);
  ground[7] = Number.NaN;
  const surface = new Float32Array(T * T).fill(Number.NaN);
  surface[T * 10 + 10] = 80;
  surface[7] = 90;
  addOverground(ground, surface, T);
  expect(ground[T * 10 + 10]).toBeCloseTo(80, 4);
  expect(ground[7]).toBeNaN();
  expect(ground[T * 20 + 20]).toBe(12);
});

test("a far tile's array: its bare ground first — the CPU's —, its overground after; drawn, their sum", async () => {
  const { drawnHeight } = await import("../src/system/earth-tiles");
  const both = new Float32Array(2 * T * T);
  both[5] = 40;
  both[T * T + 5] = 210;
  expect(drawnHeight(both, 5)).toBe(250);
  const bare = new Float32Array(T * T).fill(12);
  expect(drawnHeight(bare, 5)).toBe(12);
});

test("the surface cache's bake over a survey: its tiles as the pixels read them, not at the node's footprint", async () => {
  const { terrainCacheShader, SURVEY_RES } = await import("../src/system/terrain-cache");
  const bake = terrainCacheShader(await Bun.file(new URL("../src/shaders/trace.wgsl", import.meta.url)).text());
  expect(bake).toContain("let fine = earthH(q, 1.0, false);");
  // (the footprint's reading over the sea's level, as h: the coarse bathymetry never added back under a survey's texel at sea —
  // the needle off Big Sur, 6 Nov 2026)
  expect(bake).toContain(`if (fine.y < ${SURVEY_RES}) { h = max(h + fine.x - max(earthH(q, U.scale.y, false).x, 0.0), 0.0); }`);
  // (a survey's resolution its texel's, under 20 m at the finest held; the global data's never under 25 m: France alone)
  expect(SURVEY_RES).toBeGreaterThan(13);
  expect(SURVEY_RES).toBeLessThan(25);
});
