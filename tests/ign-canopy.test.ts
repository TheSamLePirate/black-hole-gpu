import { expect, test } from "bun:test";
import { RateGate } from "../src/system/earth-tiles";
import {
  CANOPY_MIN,
  canopyKind,
  FOREST_SINK,
  ForestKind,
  forestColumn,
  forestFrame,
  forestJitter,
  forestPlaceOf,
  forestTree,
  growForest,
} from "../src/system/forest";
import {
  blockOf,
  blocksWithin,
  CANOPY_N,
  CANOPY_NEAR,
  CANOPY_Z,
  codeCanopy,
  GROUND_N,
  IGN_MNH,
  IgnLand,
  inIgnBox,
} from "../src/system/ign-canopy";

/** a survey whose canopy is `mnh(i, j)` at each texel of every block (the ground flat at 50 m) */
const survey = async (mnh: (i: number, j: number) => number, box: [number, number, number, number]) => {
  const land = new IgnLand(async (url) => {
    const n = url.includes("WIDTH=512") ? CANOPY_N : GROUND_N;
    const v = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = n === CANOPY_N ? mnh(i, j) : 50;
    return v.buffer;
  }, Infinity);
  await land.prepare((box[1] + box[3]) / 2, (box[0] + box[2]) / 2, 200);
  return land;
};
import { localPoint, sceneryFrame } from "../src/system/scenery-data";

const D = Math.PI / 180;

test("the survey's box and blocks: France in, its neighbours out; a place's block and pixel", () => {
  expect(inIgnBox(49.7, 0.2)).toBe(true);
  expect(inIgnBox(42.7, 9.2)).toBe(true); // Corsica
  expect(inIgnBox(52.4, 4.9)).toBe(false); // Amsterdam
  expect(inIgnBox(40.4, -3.7)).toBe(false); // Madrid
  const b = blockOf(49.7, 0.2, CANOPY_N);
  const t = 2 ** CANOPY_Z;
  expect(b.x).toBe(Math.floor(((0.2 + 180) / 360) * t));
  expect(b.u).toBeGreaterThanOrEqual(-0.5);
  expect(b.u).toBeLessThan(CANOPY_N - 0.5);
  // (a block's texel: ~3 m at 49° — a hedge's width caught)
  expect((2 * Math.PI * 6378137 * Math.cos(49.7 * D)) / t / CANOPY_N).toBeCloseTo(3.1, 1);
});

test("the canopy coded a byte: 0.2 m a step, under 0 none, the no-data and the resampling's junk none at all", () => {
  const c = codeCanopy(new Float32Array([0, 12.34, -0.3, -99999, Number.NaN, 300, 60]));
  expect(Array.from(c)).toEqual([0, 62, 0, 255, 255, 255, 254]);
});

test("a measured canopy's kind: a shrub under 4 m, the climate's tree over it — never none", () => {
  expect(canopyKind(49.7, 50, 3, 0.5)).toBe(ForestKind.shrub);
  expect(canopyKind(49.7, 50, 18, 0.1)).toBe(ForestKind.conifer);
  expect(canopyKind(49.7, 50, 18, 0.9)).toBe(ForestKind.broadleaf);
  // (above the tree line the survey still says something stands)
  expect(canopyKind(45.9, 3500, 6, 0.5)).toBe(ForestKind.shrub);
});

test("the survey's blocks: the canopy and the LiDAR's ground fetched once a block, RGE ALTI where its holes pass 2 %", async () => {
  const urls: string[] = [];
  const blocks = blocksWithin(49.695, 0.205, 1500).length;
  const land = new IgnLand(async (url) => {
    urls.push(url);
    const n = url.includes("WIDTH=512") ? CANOPY_N : GROUND_N;
    const v = new Float32Array(n * n);
    if (url.includes(IGN_MNH)) v.fill(12.3).fill(-99999, 0, 10);
    else if (url.includes("LIDAR-HD_MNT"))
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = i < 8 ? -99999 : 100 + 0.5 * i;
    else for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = 77;
    return v.buffer;
  }, Infinity);
  await land.prepare(49.695, 0.205, 1500);
  // (three a block: the canopy at 512², the LiDAR's terrain at 256², RGE ALTI for its holes)
  expect(land.requests).toBe(3 * blocks);
  expect(urls.filter((u) => u.includes("WIDTH=512") && u.includes(IGN_MNH)).length).toBe(blocks);
  expect(urls.every((u) => u.includes("CRS=EPSG:3857"))).toBe(true);
  // (the canopy: its texel's; the ground: the LiDAR's plane, bilinear, RGE ALTI in the holes)
  const lat = 49.695,
    lon = 0.205;
  expect(land.canopy(lat, lon)).toBeCloseTo(12.4, 5);
  const p = blockOf(lat, lon, GROUND_N);
  if (p.u > 9) expect(land.ground(lat, lon)).toBeCloseTo(100 + 0.5 * p.u, 3);
  // (the canopy's top round a place: 12.4 everywhere here — flat, but over CANOPY_SURE: a wood's)
  expect(land.canopyNear(lat, lon, 3)).toBeCloseTo(12.4, 5);
  // (outside the blocks prepared: nothing)
  expect(land.canopy(48, 2)).toBeNaN();
  expect(land.ground(48, 2)).toBeNaN();
});

test("growing a forest by the survey: the hedge's trees along it and as tall, the wood's clearing bare, the land cover where it has none", async () => {
  const lat0 = 49.7,
    lon0 = 0.2;
  const frame = sceneryFrame(lat0, lon0);
  const ff = forestFrame(lat0, lon0, 400, (la, lo) => localPoint(frame, la, lo, 0));
  const east = (lon: number) => (lon - lon0) * 111_195 * Math.cos(lat0 * D);
  const north = (lat: number) => (lat - lat0) * 111_195;
  // (the survey south of 200 m north; there: grass with a hedge north–south through the middle, a wood 22 m tall
  // between 100 and 250 m east with a 60 m clearing; north of it, no survey — WorldCover's forest)
  const wood = (lat: number, lon: number) => north(lat) < 200 && east(lon) > 100 && east(lon) < 250;
  const clearing = (lat: number, lon: number) => wood(lat, lon) && Math.abs(east(lon) - 175) < 30 && Math.abs(north(lat) + 50) < 30;
  const io = {
    cover: (lat: number, lon: number) => (north(lat) >= 200 || wood(lat, lon) ? 10 : 30),
    excluded: () => false,
    ground: async () => 80,
    local: (lat: number, lon: number, h: number) => localPoint(frame, lat, lon, h),
    canopy: (lat: number, lon: number, r: number) =>
      north(lat) >= 200 ? Number.NaN : Math.abs(east(lon)) < 2 + r ? 8 : clearing(lat, lon) ? 0.2 : wood(lat, lon) ? 22 : 0.3,
  };
  const { cells, trees, surveyed } = await growForest(ff, io);
  let hedge = 0,
    lone = 0,
    inClearing = 0,
    woodTrees = 0,
    unsurveyed = 0,
    unsurveyedCells = 0,
    unsurveyedAll = 0,
    counted = 0;
  for (let j = 0; j < ff.h; j++)
    for (let i = 0; i < ff.w; i++) {
      const t = forestTree(ff, cells[j * ff.w + i]!, i, j);
      const [jx, jy] = forestJitter(forestColumn(ff, i), ff.j0 + j);
      const [lat, lon] = forestPlaceOf(ff.i0 + i + jx, ff.j0 + j + jy, ff.columns);
      if (t) counted++;
      const inside = Math.hypot(east(lon), north(lat)) < 390;
      if (north(lat) >= 200) {
        if (t) unsurveyedAll++;
        if (inside) unsurveyedCells++;
        if (t && inside) unsurveyed++;
        continue;
      }
      if (!t) continue;
      // (its foot on the ground, sunk)
      expect(t.z).toBeCloseTo(localPoint(frame, lat, lon, 80 - FOREST_SINK)[2], 1);
      if (Math.abs(east(lon)) < 2 + ff.cell * 0.47 + 0.01) {
        hedge++;
        expect(t.height).toBeCloseTo(8, 5);
        expect(t.kind).not.toBe(ForestKind.shrub);
      } else if (clearing(lat, lon)) inClearing++;
      else if (wood(lat, lon)) {
        woodTrees++;
        expect(t.height).toBeCloseTo(22, 5);
      } else lone++;
    }
  expect(counted).toBe(trees);
  // (the hedge: 600 m of it — a tree every cell along it, near enough every one)
  expect(hedge).toBeGreaterThan(80);
  // (the grass round it under CANOPY_MIN: no lone tree, though the land cover would draw a few)
  expect(io.canopy(lat0 - 0.001, lon0 + 0.0008, 3)).toBeLessThan(CANOPY_MIN);
  expect(lone).toBe(0);
  // (the clearing bare, though WorldCover calls it forest; the wood round it full)
  expect(inClearing).toBe(0);
  expect(woodTrees).toBeGreaterThan(200);
  expect(surveyed).toBe(trees - unsurveyedAll);
  // (unsurveyed: the land cover's forest as before, its density and understory)
  expect(unsurveyed / unsurveyedCells).toBeGreaterThan(0.85);
});

test("a field's crop at the flight is no hedge: flat under 5 m, none; a hedge's ragged 3 m, kept; a wood's flat 12 m, kept", async () => {
  const box: [number, number, number, number] = [0.2, 49.69, 0.201, 49.691];
  const at = (land: IgnLand) => land.canopyNear(49.6905, 0.2005, 3);
  // (maize at 2.2 m over the whole field)
  expect(at(await survey(() => 2.2, box))).toBe(0);
  // (a thicket 4 m tall, its top ragged by a metre and a half)
  expect(at(await survey((i, j) => 3 + 1.5 * ((i + j) % 2), box))).toBeCloseTo(4.5, 0);
  // (a hedge 3 m tall, a texel in four: its edge at the ground beside it)
  expect(at(await survey((i) => (i % 4 === 0 ? 3 : 0), box))).toBeCloseTo(3, 5);
  expect(at(await survey(() => 12, box))).toBeCloseTo(12, 5);
});

test("the blocks: the forest's disc only, the nearest first; full sides near the centre, half beyond", async () => {
  const lat = 49.1065,
    lon = -1.024;
  const all = blocksWithin(lat, lon, 4750);
  // (a 1.6 km block at 49°: the disc's ~70 km² in ~40 of them, not the box's ~49)
  expect(all.length).toBeGreaterThan(25);
  expect(all.length).toBeLessThan(45);
  expect(all.map((b) => b.d)).toEqual([...all.map((b) => b.d)].sort((a, b) => a - b));
  expect(all[0]!.d).toBe(0);
  const urls: string[] = [];
  const land = new IgnLand(async (url) => {
    urls.push(url);
    const n = Number(/WIDTH=(\d+)/.exec(url)![1]);
    return new Float32Array(n * n).fill(url.includes(IGN_MNH) ? 9 : 120).buffer;
  }, Infinity);
  await land.prepare(lat, lon, 4750);
  const near = all.filter((b) => b.d <= CANOPY_NEAR).length;
  expect(urls.filter((u) => u.includes(IGN_MNH) && u.includes("WIDTH=512")).length).toBe(near);
  expect(urls.filter((u) => u.includes(IGN_MNH) && u.includes("WIDTH=256")).length).toBe(all.length - near);
  // (no holes: no RGE ALTI)
  expect(land.requests).toBe(2 * all.length);
  // (a far block read at its own size)
  const far = all[all.length - 1]!;
  const n = 2 ** CANOPY_Z;
  const flat = (far.y + 0.5) / n,
    fl = Math.atan(Math.sinh(Math.PI * (1 - 2 * flat))) / D;
  expect(land.canopy(fl, ((far.x + 0.5) / n) * 360 - 180)).toBeCloseTo(9, 5);
  expect(land.ground(fl, ((far.x + 0.5) / n) * 360 - 180)).toBeCloseTo(120, 5);
});

test("the rate's gate: requests spaced to its rate, none held under it", async () => {
  const gate = new RateGate(50);
  const t0 = performance.now();
  for (let i = 0; i < 6; i++) await gate.take();
  // (six at 50 a second: the first at once, five 20 ms apart)
  expect(performance.now() - t0).toBeGreaterThan(90);
  expect(performance.now() - t0).toBeLessThan(400);
});
