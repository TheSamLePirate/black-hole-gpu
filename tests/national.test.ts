import { expect, test } from "bun:test";
import { IGN, NATIONAL, NATIONAL_BOX, ORTHO_FIT, orthoColour } from "../src/system/earth-tiles";
import { inIgnBox } from "../src/system/ign-canopy";
import {
  insideOutline,
  SWISS_FIT,
  SWISSTOPO,
  sourceAt,
  sourcesBox,
  swissTerrainLevel,
  swissimageUrl,
  tileSource,
} from "../src/system/national";
import { LIECHTENSTEIN, SWITZERLAND } from "../src/system/national-borders";
import { decodeQuantizedMesh, drawMeshes, geodeticTileBox, geodeticTilesOver } from "../src/system/quantized-mesh";

/** a quantized-mesh tile's bytes (the header's heights' range, the vertices zig-zag delta coded, 16-bit HWM indices) */
function encodeMesh(u: number[], v: number[], h: number[], minH: number, maxH: number, tri: number[]): ArrayBuffer {
  const n = u.length;
  const buf = new ArrayBuffer(92 + 6 * n + 4 + 2 * tri.length);
  const dv = new DataView(buf);
  dv.setFloat32(24, minH, true);
  dv.setFloat32(28, maxH, true);
  dv.setUint32(88, n, true);
  let o = 92;
  for (const arr of [u, v, h.map((x) => Math.round(((x - minH) / (maxH - minH)) * 32767))]) {
    let prev = 0;
    for (const a of arr) {
      const d = a - prev;
      prev = a;
      dv.setUint16(o, ((d << 1) ^ (d >> 31)) & 0xffff, true);
      o += 2;
    }
  }
  dv.setUint32(o, tri.length / 3, true);
  o += 4;
  let top = 0;
  for (const i of tri) {
    const code = top - i;
    dv.setUint16(o, code, true);
    o += 2;
    if (code === 0) top++;
  }
  return buf;
}

test("geodetic tiles: level g's 180 / 2^g degrees, row 0 the south; a box's tiles", () => {
  expect(geodeticTileBox(0, 0, 0)).toEqual([-180, -90, 0, 90]);
  expect(geodeticTileBox(0, 1, 0)).toEqual([0, -90, 180, 90]);
  const [x, y] = [Math.floor(((7.9625 + 180) / 360) * 2 ** 17), Math.floor(((46.5367 + 90) / 180) * 2 ** 16)];
  expect(geodeticTilesOver(16, 7.9625, 46.5367, 7.9625001, 46.5367001)).toEqual([[x, y]]);
  // (a Web Mercator z 16 tile at 46.5°: one or two of level 15 under it — its terrain level)
  expect(swissTerrainLevel(16)).toBe(15);
  expect(swissTerrainLevel(18)).toBe(17);
  // (its longitudes the same boundaries: one across, one or two down)
  const n = 2 ** 16,
    mx = Math.floor(((7.9625 + 180) / 360) * n),
    my = Math.floor(((1 - Math.asinh(Math.tan(46.5367 * (Math.PI / 180))) / Math.PI) / 2) * n);
  const lat = (t: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI;
  const t = geodeticTilesOver(15, (mx / n) * 360 - 180, lat(my + 1), ((mx + 1) / n) * 360 - 180, lat(my));
  expect(new Set(t.map((v) => v[0])).size).toBe(1);
  expect(t.length).toBeGreaterThanOrEqual(1);
  expect(t.length).toBeLessThanOrEqual(2);
});

test("a quantized mesh decoded: its vertices on its box, its heights in their range, its triangles' indices", () => {
  const box: [number, number, number, number] = [7, 46, 7.01, 46.01];
  // (two corners, the middle, the other two corners — first used in that order, as the indices' high-water mark wants —;
  // four triangles round the middle)
  const u = [0, 32767, 16384, 32767, 0],
    v = [0, 0, 16384, 32767, 32767],
    h = [1000, 1100, 1300, 1200, 1100];
  const tri = [0, 1, 2, 1, 3, 2, 3, 4, 2, 4, 0, 2];
  const m = decodeQuantizedMesh(encodeMesh(u, v, h, 1000, 1300, tri), box);
  expect(m.lon[1]).toBeCloseTo(7.01, 9);
  expect(m.lat[3]).toBeCloseTo(46.01, 9);
  expect(m.lon[2]).toBeCloseTo(7.005, 6);
  expect(m.h[2]).toBeCloseTo(1300, 1);
  expect(m.h[3]).toBeCloseTo(1200, 1);
  expect(Array.from(m.tri)).toEqual(tri);
});

test("meshes drawn into a grid: each cell its triangle's height at its centre — a plane exact, a peak's top, no hole", () => {
  const box: [number, number, number, number] = [7, 46, 7.01, 46.01];
  // (a plane: h = 1000 + 100 u′ + 200 v′ over the box's fractions)
  const plane = (fu: number, fv: number) => 1000 + 100 * fu + 200 * fv;
  const u = [0, 32767, 16384, 32767, 0],
    v = [0, 0, 16384, 32767, 32767];
  const h = u.map((a, i) => plane(a / 32767, v[i]! / 32767));
  const m = decodeQuantizedMesh(encodeMesh(u, v, h, 1000, 1300, [0, 1, 2, 1, 3, 2, 3, 4, 2, 4, 0, 2]), box);
  const n = 16;
  // (row 0 the north)
  const cell = (lon: number, lat: number): [number, number] => [((lon - box[0]) / 0.01) * n, ((box[3] - lat) / 0.01) * n];
  const g = drawMeshes([m], n, cell);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const fu = (i + 0.5) / n,
        fv = 1 - (j + 0.5) / n;
      expect(g[j * n + i]).toBeCloseTo(plane(fu, fv), 0);
    }
});

test("the national sources: Switzerland swisstopo's though the IGN's box holds it, France the IGN's, the rest none", () => {
  expect(sourceAt(NATIONAL, 46.5367, 7.9625)?.id).toBe("swisstopo"); // the Jungfrau
  expect(sourceAt(NATIONAL, 46.2, 6.15)?.id).toBe("swisstopo"); // Geneva
  expect(sourceAt(NATIONAL, 47.14, 9.52)?.id).toBe("swisstopo"); // Vaduz
  expect(sourceAt(NATIONAL, 45.9237, 6.8694)?.id).toBe("ign"); // Chamonix
  expect(sourceAt(NATIONAL, 48.85, 2.35)?.id).toBe("ign"); // Paris
  expect(sourceAt(NATIONAL, 52.37, 4.9)).toBeNull(); // Amsterdam
  expect(insideOutline(46.95, 7.45, SWITZERLAND)).toBe(true);
  expect(insideOutline(47.75, 7.34, SWITZERLAND)).toBe(false); // Mulhouse
  expect(insideOutline(47.14, 9.52, LIECHTENSTEIN)).toBe(true);
  // (a tile by its centre's)
  const z = 14,
    n = 2 ** z,
    D = Math.PI / 180;
  const x = Math.floor(((7.45 + 180) / 360) * n),
    y = Math.floor(((1 - Math.asinh(Math.tan(46.95 * D)) / Math.PI) / 2) * n);
  expect(tileSource(NATIONAL, n, x, y)?.id).toBe("swisstopo");
  // (their boxes as one: the tracer's)
  expect(NATIONAL_BOX).toEqual(sourcesBox(NATIONAL));
  expect(NATIONAL_BOX.east).toBe(SWISSTOPO.box.east);
  expect(NATIONAL_BOX.west).toBe(IGN.box.west);
  // (the scenery's IGN survey — its canopy, the BD TOPO — not asked over Switzerland)
  expect(inIgnBox(45.92, 6.87)).toBe(true);
  expect(inIgnBox(46.95, 7.45)).toBe(false);
});

test("SWISSIMAGE: its WMTS in Web Mercator; its colours fitted as the IGN's, near them", () => {
  expect(swissimageUrl(17, 68434, 46289)).toBe(
    "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/17/68434/46289.jpeg",
  );
  expect(SWISSTOPO.fit).toBe(SWISS_FIT);
  // (a field, a white roof: graded within a few levels of the IGN's)
  for (const [r, g, bl] of [
    [90, 120, 60],
    [255, 255, 255],
  ]) {
    const a = orthoColour(r!, g!, bl!, SWISS_FIT),
      b = orthoColour(r!, g!, bl!, ORTHO_FIT);
    for (let c = 0; c < 3; c++) expect(Math.abs(a[c]! - b[c]!)).toBeLessThan(12);
  }
});
