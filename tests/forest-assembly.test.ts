import { expect, test } from "bun:test";
import { cellKey, cellOf, cellOrigin } from "../src/system/building-cells";
import { forestFrame, growForest } from "../src/system/forest";
import { forestWants, preparedForest } from "../src/system/forest-assembly";
import { prepareForestCell } from "../src/system/forest-prep";
import { localPoint, sceneryFrame } from "../src/system/scenery-data";

// PLAN-J8 J8-8b lot (2) — the near scene's forest assembled from its prepared cells (forest-assembly.ts): a frame over several z 15
// cells of Paris, its cells prepared as the forest pool prepares them (forest-prep.ts), read back into the frame's grid; growForest
// given them plants the very trees it plants deciding every case itself — and with a cell missing, its cases decided as before.

const [X, Y] = [16596, 11273];
const o = cellOrigin(X, Y);
const frame = sceneryFrame(o.lat, o.lon);
const local = (lat: number, lon: number, h = 0) => localPoint(frame, lat, lon, h);
// (a forest everywhere but a road's strip — the data's exclusion, in the cells' words —, a varied cover: two classes by longitude)
const cover = (_lat: number, lon: number) => (Math.floor(lon * 2000) % 3 === 0 ? 20 : 10);
const excluded = (_lat: number, lon: number) => Math.abs(lon - o.lon) * 111_320 * Math.cos((o.lat * Math.PI) / 180) < 6;
const io = {
  cover,
  excluded,
  ground: async () => 60,
  groundNow: () => 60,
  sea: () => 45,
  local: (lat: number, lon: number, h: number) => local(lat, lon, h),
};

test("the scene's trees from the prepared cells: the same as deciding every case, a missing cell decided as before", async () => {
  // (a reach over the cell's corner: four cells or more under the frame)
  const f = forestFrame(o.lat, o.lon, 900, (lat, lon) => local(lat, lon));
  const own = await growForest(f, io);
  const cells = new Map<string, ArrayBuffer>();
  const read = async (x: number, y: number) => {
    const k = cellKey(x, y);
    if (!cells.has(k)) cells.set(k, prepareForestCell(x, y, { cover, excluded }, 1, false).buf);
    return cells.get(k)!;
  };
  const p = (await preparedForest(f, read))!;
  expect(p.cells).toBeGreaterThanOrEqual(4);
  expect(p.missing).toBe(0);
  expect(p.complete).toBe(true);
  // (every case of the frame owned by one cell — its grid a strip wider than the reach's disc, all of it under the cells read)
  expect(p.cases).toBe(f.w * f.h);
  const fromCells = await growForest(f, { ...io, prepared: p, excludedLive: () => false });
  expect(own.trees).toBeGreaterThan(5000);
  expect(fromCells.trees).toBe(own.trees);
  expect(Buffer.from(fromCells.cells.buffer).equals(Buffer.from(own.cells.buffer))).toBe(true);

  // (one cell missing — the eye's own —: its cases not covered, decided by the scene; the trees the same)
  const gone = cellOf(o.lat + 1e-4, o.lon + 1e-4);
  const q = (await preparedForest(f, async (x, y) => (x === gone.x && y === gone.y ? null : read(x, y))))!;
  expect(q.missing).toBe(1);
  expect(q.complete).toBe(false);
  expect(q.cases).toBeLessThan(p.cases);
  const partial = await growForest(f, { ...io, prepared: q, excludedLive: () => false });
  expect(Buffer.from(partial.cells.buffer).equals(Buffer.from(own.cells.buffer))).toBe(true);

  // (a live exclusion — a viewpoint's disc, the scene's — refuses covered cases too)
  const near = (lat: number, lon: number) => Math.hypot((lat - o.lat) * 111_320, (lon - o.lon) * 80_000) < 100;
  const cleared = await growForest(f, { ...io, prepared: p, excludedLive: near });
  expect(cleared.trees).toBeLessThan(own.trees);
  console.log(
    `  frame ${f.w}×${f.h}: ${p.cells} cells, ${p.cases} cases covered · ${own.trees} trees either way · ${q.cases} with one missing · ${cleared.trees} with a live exclusion`,
  );
});

test("a missing cell outside the planting disc does not require the building survey", async () => {
  const f = forestFrame(o.lat, o.lon, 560, (lat, lon) => local(lat, lon));
  const corner = await preparedForest(f, async (x, y) =>
    x === X + 1 && y === Y + 1 ? null : prepareForestCell(x, y, { cover, excluded }, 1, false).buf,
  );
  if (!corner) throw new Error("the forest frame is empty");
  expect(corner.missing).toBe(1);
  expect(corner.cases).toBeLessThan(f.w * f.h);
  expect(corner.complete).toBe(true);
  const own = await growForest(f, io);
  const fromCells = await growForest(f, { ...io, prepared: corner, excludedLive: () => false });
  expect(Buffer.from(fromCells.cells.buffer).equals(Buffer.from(own.cells.buffer))).toBe(true);
});

test("the forest cells wanted round the eye: within the reach, the nearest of each class first", () => {
  const eye = { lat: 48.8566, lon: 2.3522, heading: 0, speed: 100, halfFov: Math.PI / 4 };
  const w = forestWants(eye, 7000);
  // (a 7 km disc of ~0.8 km cells: ~240 of them)
  expect(w.length).toBeGreaterThan(200);
  expect(w.length).toBeLessThan(320);
  expect(w.every((c) => c.d <= 7000)).toBe(true);
  const here = cellOf(eye.lat, eye.lon);
  expect(w.some((c) => c.x === here.x && c.y === here.y)).toBe(true);
});

test("a cell made without the canopy left to a scene that has it (its town's trees the canopy's)", async () => {
  const f = forestFrame(o.lat, o.lon, 300, (lat, lon) => local(lat, lon));
  const read = async (x: number, y: number) => prepareForestCell(x, y, { cover, excluded }, 1, false).buf;
  const without = (await preparedForest(f, read))!;
  expect(without.noCanopy).toBe(0);
  expect(without.cases).toBeGreaterThan(0);
  const withCanopy = (await preparedForest(f, read, true))!;
  expect(withCanopy.cells).toBe(0);
  expect(withCanopy.noCanopy).toBeGreaterThan(0);
  expect(withCanopy.cases).toBe(0);
});
