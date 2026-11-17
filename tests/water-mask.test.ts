import { expect, test } from "bun:test";
import { PbfWriter } from "pbf";
import { waterMask } from "../src/system/water-mask";
import { earthDataDir, readKept } from "./e2e/lib/earth-cache";

// PLAN-J8 J8-E: the inland water of a vector tile — its `water` polygons and `waterway` lines — drawn into a 256² coverage, the sea
// left out, a river under a texel kept as its share of the texel.

type Feat = { type: 2 | 3; cls: string; rings: [number, number][][]; brunnel?: string };
const zz = (n: number) => (n << 1) ^ (n >> 31);
/** a vector tile with `water` and `waterway` layers (extent 4096): each feature a class and its rings (a polygon closed by ClosePath) */
function tile(layers: Record<string, Feat[]>): Uint8Array {
  const pbf = new PbfWriter();
  for (const [name, feats] of Object.entries(layers)) {
    const classes = [...new Set(feats.map((s) => s.cls))];
    const brunnels = [...new Set(feats.flatMap((s) => (s.brunnel ? [s.brunnel] : [])))];
    pbf.writeMessage(
      3,
      (_: null, p: PbfWriter) => {
        p.writeVarintField(15, 2);
        p.writeStringField(1, name);
        for (const s of feats)
          p.writeMessage(
            2,
            (_: null, f: PbfWriter) => {
              f.writePackedVarint(
                2,
                s.brunnel ? [0, classes.indexOf(s.cls), 1, classes.length + brunnels.indexOf(s.brunnel)] : [0, classes.indexOf(s.cls)],
              );
              f.writeVarintField(3, s.type);
              const g: number[] = [];
              let cx = 0,
                cy = 0;
              for (const r of s.rings) {
                g.push((1 << 3) | 1, zz(r[0]![0] - cx), zz(r[0]![1] - cy));
                [cx, cy] = r[0]!;
                g.push(((r.length - 1) << 3) | 2);
                for (let i = 1; i < r.length; i++) {
                  g.push(zz(r[i]![0] - cx), zz(r[i]![1] - cy));
                  [cx, cy] = r[i]!;
                }
                if (s.type === 3) g.push((1 << 3) | 7);
              }
              f.writePackedVarint(4, g);
            },
            null,
          );
        p.writeStringField(3, "class");
        p.writeStringField(3, "brunnel");
        for (const c of [...classes, ...brunnels]) p.writeMessage(4, (_: null, v: PbfWriter) => v.writeStringField(1, c), null);
        p.writeVarintField(5, 4096);
      },
      null,
    );
  }
  return pbf.finish();
}
const at = (m: Float32Array, x: number, y: number) => m[y * 256 + x]!;
const sq = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

test("a lake's polygon covers its texels, its hole and the sea none", () => {
  // (a lake 1024–3072 with an island 1792–2304; the sea's polygon over the left quarter)
  const t = tile({
    water: [
      { type: 3, cls: "lake", rings: [sq(1024, 1024, 3072, 3072), sq(1792, 1792, 2304, 2304)] },
      { type: 3, cls: "ocean", rings: [sq(0, 0, 900, 4096)] },
    ],
  });
  const m = waterMask(t, 10)!;
  expect(at(m, 100, 100)).toBe(1); // the lake
  expect(at(m, 128, 128)).toBe(0); // the island
  expect(at(m, 20, 128)).toBe(0); // the sea: the game's own
  expect(at(m, 250, 10)).toBe(0); // land
  // (its edge anti-aliased: 1024 / 16 = 64 exactly — a whole texel —; 1030 a share)
  const e = waterMask(tile({ water: [{ type: 3, cls: "lake", rings: [sq(1032, 1024, 3072, 3072)] }] }), 10)!;
  expect(at(e, 64, 100)).toBeGreaterThan(0.4);
  expect(at(e, 64, 100)).toBeLessThan(0.6);
});

test("a river's line: its width over the pixel, a stream under a texel its share of it, a tunnel none", () => {
  // (a river across the tile at y 2048; a stream at y 1024; at 10 m a texel a river 40 m wide covers ~4 texels, a stream 4 m 0.4)
  const t = tile({
    waterway: [
      {
        type: 2,
        cls: "river",
        rings: [
          [
            [0, 2048],
            [4096, 2048],
          ],
        ],
      },
      {
        type: 2,
        cls: "stream",
        rings: [
          [
            [0, 1024],
            [4096, 1024],
          ],
        ],
      },
    ],
  });
  const m = waterMask(t, 10)!;
  // (40 m at 10 m a texel: rows 126–129 whole, none two texels past)
  expect(at(m, 100, 127)).toBe(1);
  expect(at(m, 100, 129)).toBeGreaterThan(0.9);
  expect(at(m, 100, 132)).toBe(0);
  // (the stream: at most its share, 0.4, never a whole texel's — the mips fade it, no dotted line)
  // (on the texels' seam: each its half — together its 0.4)
  expect(at(m, 100, 63) + at(m, 100, 64)).toBeCloseTo(0.4, 3);
  expect(Math.max(at(m, 100, 63), at(m, 100, 64))).toBeLessThanOrEqual(0.4 + 1e-6);
  expect(
    waterMask(
      tile({
        waterway: [
          {
            type: 2,
            cls: "river",
            rings: [
              [
                [0, 2048],
                [4096, 2048],
              ],
            ],
          },
        ],
      }),
      10,
    ),
  ).not.toBeNull();
});

test("a z 14 tile from its z 13 parent's quarter; a tile without water layers: null", () => {
  // (the lake in the parent's top-left quarter: its south-east quarter's tile — sub x 1, y 1 — has none)
  const t = tile({ water: [{ type: 3, cls: "lake", rings: [sq(0, 0, 2048, 2048)] }] });
  expect(at(waterMask(t, 5, { k: 1, x: 0, y: 0 })!, 128, 128)).toBe(1);
  expect(at(waterMask(t, 5, { k: 1, x: 1, y: 1 })!, 128, 128)).toBe(0);
  expect(
    waterMask(
      tile({
        transportation: [
          {
            type: 2,
            cls: "minor",
            rings: [
              [
                [0, 0],
                [4096, 4096],
              ],
            ],
          },
        ],
      }),
      10,
    ),
  ).toBeNull();
});

test("J8-RP RP7: a bridge's deck cut out of the water under it — its class's width and parapets; a road beside the water nothing", () => {
  // (a river 40 texels wide — x 100 to 140 — and a secondary road's bridge across it at y 128; mpp 1: the deck 9 + 2 m wide, 11 texels)
  const river: Feat = { type: 3, cls: "river", rings: [sq(100 * 16, 0, 140 * 16, 4096)] };
  const bridge: Feat = {
    type: 2,
    cls: "secondary",
    brunnel: "bridge",
    rings: [
      [
        [90 * 16, 128 * 16],
        [150 * 16, 128 * 16],
      ],
    ],
  };
  const road: Feat = {
    type: 2,
    cls: "secondary",
    rings: [
      [
        [90 * 16, 60 * 16],
        [150 * 16, 60 * 16],
      ],
    ],
  };
  const m = waterMask(tile({ water: [river], transportation: [bridge, road] }), 1)!;
  expect(at(m, 120, 128)).toBeLessThan(0.01);
  expect(at(m, 120, 126)).toBeLessThan(0.01);
  // (beyond the deck's half-width — 5.5 texels —: water again; the road that is no bridge cuts nothing)
  expect(at(m, 120, 120)).toBeGreaterThan(0.99);
  expect(at(m, 120, 60)).toBeGreaterThan(0.99);
  // (no transportation layer: the water whole)
  expect(at(waterMask(tile({ water: [river] }), 1)!, 120, 128)).toBeGreaterThan(0.99);
});

test("J8-RP RP7: the Seine at the pont Alexandre III (OpenFreeMap z 14, the e2e's Earth data on disk) — no water on the deck", () => {
  const k = readKept(earthDataDir(), "https://tiles.openfreemap.org/planet/latest/14/8297/5636.pbf", null);
  if (!k) return;
  const n = 2 ** 14;
  // (a place's texel in the tile 8297/5636)
  const px = (lat: number, lon: number) => {
    const fx = ((lon + 180) / 360) * n - 8297,
      fy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n - 5636;
    return [Math.floor(fx * 256), Math.floor(fy * 256)] as const;
  };
  const mpp = (40_075_016.7 * Math.cos((48.864 * Math.PI) / 180)) / n / 256;
  const m = waterMask(k.body, mpp)!;
  // (the deck's middle over the river — the Seine crosses the tile west to east there, texel rows ~10–26 —; the river 100 m
  // upstream and downstream of it, on the same row: water)
  const [bx, by] = px(48.8637, 2.3136);
  console.log(
    `  the pont Alexandre III's texel ${bx},${by}: ${at(m, bx, by).toFixed(2)} · the Seine at ${bx - 15},${by}: ${at(m, bx - 15, by).toFixed(2)}, at ${bx + 15},${by}: ${at(m, bx + 15, by).toFixed(2)}`,
  );
  expect(at(m, bx - 15, by)).toBeGreaterThan(0.8);
  expect(at(m, bx + 15, by)).toBeGreaterThan(0.8);
  expect(at(m, bx, by)).toBeLessThan(0.2);
});
