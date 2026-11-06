import { expect, test } from "bun:test";
import { PbfWriter } from "pbf";
import { L_MAX, roadLightByte, roadLightFromByte, roadMask, spreadLights, tileMetresPerPixel } from "../src/system/night-roads";

// NU1 (docs/PLAN-NUIT-URBAINE.md): the towns' lights along their streets — a vector tile's streets drawn into a mask, VIIRS's
// light spread over it with its mean kept.

/** a vector tile with one `transportation` layer: each street a class and a line (extent 4096) */
function tile(streets: { cls: string; line: [number, number][] }[]): Uint8Array {
  const pbf = new PbfWriter();
  const classes = [...new Set(streets.map((s) => s.cls))];
  pbf.writeMessage(
    3,
    (_: null, p: PbfWriter) => {
      p.writeVarintField(15, 2);
      p.writeStringField(1, "transportation");
      streets.forEach((s) => {
        p.writeMessage(
          2,
          (_: null, f: PbfWriter) => {
            f.writePackedVarint(2, [0, classes.indexOf(s.cls)]);
            f.writeVarintField(3, 2);
            // (MoveTo, LineTo: zigzag deltas)
            const zz = (n: number) => (n << 1) ^ (n >> 31);
            const g: number[] = [(1 << 3) | 1, zz(s.line[0]![0]), zz(s.line[0]![1]), ((s.line.length - 1) << 3) | 2];
            for (let i = 1; i < s.line.length; i++) g.push(zz(s.line[i]![0] - s.line[i - 1]![0]), zz(s.line[i]![1] - s.line[i - 1]![1]));
            f.writePackedVarint(4, g);
          },
          null,
        );
      });
      p.writeStringField(3, "class");
      for (const c of classes) p.writeMessage(4, (_: null, v: PbfWriter) => v.writeStringField(1, c), null);
      p.writeVarintField(5, 4096);
    },
    null,
  );
  return pbf.finish();
}

test("a street drawn into the mask at its place, its class's width and brightness; a path not", () => {
  const raw = tile([
    {
      cls: "primary",
      line: [
        [0, 2056],
        [4096, 2056],
      ],
    },
    {
      cls: "path",
      line: [
        [2048, 0],
        [2048, 4096],
      ],
    },
  ]);
  const m = roadMask(raw, 10)!;
  // (a primary 18 m wide at 10 m a pixel: the darkened map's glow on row 128 — a quarter of its brightness —, its lamps
  // brighter along it; nothing 6 rows off)
  const row = Array.from({ length: 256 }, (_, x) => m[128 * 256 + x]!);
  expect(Math.min(...row)).toBeGreaterThan(0.2);
  // (its lamps beside it — a primary's staggered, 9.6 m off its axis —: points over its glow)
  const near = Array.from({ length: 256 * 3 }, (_, i) => m[127 * 256 + i]!);
  expect(Math.max(...near)).toBeGreaterThan(0.6);
  expect(m[134 * 256 + 60]!).toBe(0);
  // (the path unlit)
  expect(m[40 * 256 + 128]!).toBe(0);
});

test("a coarser tile's quarter: its streets enlarged to the tile", () => {
  const raw = tile([
    {
      cls: "secondary",
      line: [
        [0, 1024],
        [4096, 1024],
      ],
    },
  ]);
  // (the parent's row 64 → in its north-west quarter, row 128)
  const m = roadMask(raw, 10, { k: 1, x: 0, y: 0 })!;
  expect(m[128 * 256 + 10]!).toBeGreaterThan(0.15);
  // (its south quarter has none)
  const s = roadMask(raw, 10, { k: 1, x: 0, y: 1 })!;
  expect(s.reduce((a, b) => a + b, 0)).toBe(0);
});

test("VIIRS's light spread over the streets keeps its mean, brighter on them, a floor off them; none near: as it was", () => {
  const streets = Array.from({ length: 16 }, (_, i) => ({
    cls: "minor",
    line: [
      [0, 128 + i * 256],
      [4096, 128 + i * 256],
    ] as [number, number][],
  }));
  const mpp = 10;
  const m = roadMask(tile(streets), mpp)!;
  const v = new Float32Array(256 * 256).fill(0.5);
  const L = spreadLights(v, m, mpp);
  const mean = L.reduce((a, b) => a + b, 0) / L.length;
  // (kept to the tile's — renormalised —, within the encoding's ceiling)
  expect(mean).toBeGreaterThan(0.49);
  expect(mean).toBeLessThan(0.51);
  // (along its street, brighter than the mean — its lamps the brightest)
  expect(Math.max(...Array.from({ length: 256 }, (_, x) => L[8 * 256 + x]!))).toBeGreaterThan(2);
  // (off them, darker — towards the floor, the sparser the streets the less)
  expect(L[0 * 256 + 100]!).toBeLessThan(0.3);
  // (no street: VIIRS's own)
  const none = spreadLights(v, new Float32Array(256 * 256), mpp);
  expect(none[30000]!).toBeCloseTo(0.5, 5);
  // (dark stays dark)
  expect(spreadLights(new Float32Array(256 * 256), m, mpp)[8 * 256 + 100]).toBe(0);
});

test("the street levels' encoding: 0 none, logarithmic — a yard's hundredth to a lamp's hundredfold within 4 % a step", () => {
  expect(roadLightByte(0)).toBe(0);
  for (const L of [0.02, 0.3, 1, 7, 60]) expect(Math.abs(roadLightFromByte(roadLightByte(L)) / L - 1)).toBeLessThan(0.04);
  expect(roadLightFromByte(roadLightByte(1e4))).toBeCloseTo(L_MAX, 0);
  expect(tileMetresPerPixel(13, 2817)).toBeCloseTo(12.6, 0);
});
