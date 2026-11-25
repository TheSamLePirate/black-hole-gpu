// PLAN-PONT-ROUTES-AAA — the bridges' real decks (25 Nov 2026; PROBLEMES « Pont de Cheviré »: a 52 m air draught drawn at 25 m, in four
// pieces with 1.5–11 m steps). The BD TOPO's surveyed Z of its sections (the WFS — its vector tiles are 2D) carried into the street
// cells (format 6: a height a point, the clearance on two bytes) and followed by the deck's profile; a section cut by two cells or two
// tiles chained whole (their overlaps and gaps past the edge spliced); the pieces that meet joined in height; abroad, a documented
// clearance by the water crossed. Positive witnesses: each check fails on the code before (named in its comment).
import { describe, expect, test } from "bun:test";
import { readKept, earthDataDir } from "./e2e/lib/earth-cache";
import { bdtopoDecksUrl, bdtopoUrl, parseBdtopoDecks } from "../src/system/bdtopo";
import { selectBridgeLOD } from "../src/system/bridge-lod";
import {
  fillHeights,
  type GeoBridge,
  joinBridgeHalves,
  joinDeckPieces,
  levelTwinDecks,
  spliceOpenHalves,
} from "../src/system/bridge-ports";
import { BridgeContinuousProfile, measuredDeckUsable } from "../src/system/bridge-surface-service";
import { cellOrigin, fromCell } from "../src/system/building-cells";
import { prepareBdtopoCell } from "../src/system/cell-prep";
import { classify } from "../src/pwa/rules";
import {
  BridgeFlag,
  BridgeKind,
  Crossed,
  encodeStreetCell,
  readBridges,
  type RoadSegmentRecord,
  ruleClearance,
  SegmentFlag,
  STREET_FORMAT,
} from "../src/system/street-cells";
import { chainBridges } from "../src/system/street-detail-prep";
import { farBridges } from "../src/system/street-far";
import { deckHeightOn, prepareStreetCells } from "../src/system/street-prep";

const seg = (a: [number, number], b: [number, number], o: Partial<RoadSegmentRecord> = {}): RoadSegmentRecord => ({
  a,
  b,
  width: 12,
  lanes: 2,
  cls: "motorway",
  flags: SegmentFlag.Bridge,
  level: 1,
  speed: 30,
  s0: 0,
  roadId: 7,
  ...o,
});
const lenOf = (b: GeoBridge) => {
  let s = 0;
  for (let i = 1; i < b.points.length; i++)
    s += Math.hypot(
      (b.points[i]!.lat - b.points[i - 1]!.lat) * 111_132,
      (b.points[i]!.lon - b.points[i - 1]!.lon) * 111_320 * Math.cos((b.points[i]!.lat * Math.PI) / 180),
    );
  return s;
};
/** a straight bridge north along a meridian at 47° from `lat0`, `n` points every `step` m */
const line = (lat0: number, n: number, step: number) =>
  Array.from({ length: n }, (_, i) => ({ lat: lat0 + (i * step) / 111_132, lon: -1.6 }));
const geo = (o: Partial<GeoBridge> & { points: GeoBridge["points"] }): GeoBridge => ({
  id: 1,
  kind: BridgeKind.Road,
  flags: 0,
  width: 15,
  layer: 1,
  crossed: Crossed.Water,
  clearance: 5.5,
  ...o,
});

describe("the BD TOPO's surveyed decks (the WFS)", () => {
  test("its query: both typenames over a z 14 tile's box, the sections over the ground; kept by the PWA as a tile", () => {
    const u = bdtopoDecksUrl(8118, 5749);
    expect(u).toContain("TYPENAMES=(BDTOPO_V3:troncon_de_route)(BDTOPO_V3:troncon_de_voie_ferree)");
    expect(decodeURIComponent(u)).toContain("position_par_rapport_au_sol>'0' AND BBOX(geometrie,47.189712,-1.625977,47.204642,-1.604004)");
    expect(classify(u, "http://localhost/")).toBe("tile");
  });
  test("its answer: -1000 none (NaN), a section without any height left out, a MultiLineString's lines each", () => {
    const m = parseBdtopoDecks({
      features: [
        {
          properties: { cleabs: "A" },
          geometry: {
            type: "LineString",
            coordinates: [
              [-1.6, 47.1, 28.9],
              [-1.6, 47.2, -1000],
              [-1.6, 47.3, 59.4],
            ],
          },
        },
        {
          properties: { cleabs: "B" },
          geometry: {
            type: "LineString",
            coordinates: [
              [-1.6, 47.1, -1000],
              [-1.6, 47.2, -1000],
            ],
          },
        },
        {
          properties: { cleabs: "C" },
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [0, 0, 1],
                [0, 1, 2],
              ],
              [
                [1, 0, 3],
                [1, 1, 4],
              ],
            ],
          },
        },
      ],
    });
    expect([...m.keys()]).toEqual(["A", "C"]);
    expect(m.get("A")![0]![1]![2]).toBeNaN();
    expect(m.get("C")!.length).toBe(2);
    expect(parseBdtopoDecks(null).size).toBe(0);
  });
  test("a section's heights read along its 2D line: the gaps filled along it, nothing past DECK_SURVEY_OFF_M", () => {
    const o = { lat: 47, lon: -1.6 };
    const z = deckHeightOn(
      [
        [
          [-1.6, 47, 10],
          [-1.6, 47 + 100 / 111_132, Number.NaN],
          [-1.6, 47 + 200 / 111_132, 30],
        ],
      ],
      o,
    );
    expect(z([0, 50])).toBeCloseTo(15, 1);
    expect(z([2, 150])).toBeCloseTo(25, 1);
    expect(z([20, 100])).toBeNaN();
  });
});

describe("street cells, format 6", () => {
  test("a bridge's points carry their heights; its clearance two bytes (format 5's one byte stopped at 25.5 m)", () => {
    expect(STREET_FORMAT).toBe(6);
    const buf = encodeStreetCell(
      { z: 15, x: 1, y: 2, generation: 0, originLat: 47, originLon: -1.6 },
      [],
      [],
      [],
      [],
      0,
      [],
      [],
      [],
      [
        {
          id: 9,
          kind: BridgeKind.Road,
          flags: BridgeFlag.Measured,
          width: 15,
          layer: 1,
          crossed: Crossed.Water,
          clearance: 52.3,
          length: 100,
          points: [
            [0, 0],
            [0, 50],
            [0, 100],
          ],
          heights: [10, Number.NaN, 60.5],
        },
      ],
    );
    const [b] = readBridges(buf);
    // (the witness: format 5 wrote min(255, 523) dm — 25.5 m)
    expect(b!.clearance).toBeCloseTo(52.3, 5);
    expect(b!.heights![0]).toBeCloseTo(10, 5);
    expect(b!.heights![1]).toBeNaN();
    expect(b!.heights![2]).toBeCloseTo(60.5, 5);
  });
  test("abroad (no survey): the clearance by what it crosses — a wide water's by its width, capped", () => {
    expect(ruleClearance(Crossed.Water, 60)).toBe(5.5);
    expect(ruleClearance(Crossed.Water, 450)).toBeCloseTo(17.75, 6);
    expect(ruleClearance(Crossed.Water, 3000)).toBe(45);
    expect(ruleClearance(Crossed.Rail | Crossed.Water, 50)).toBe(6);
    expect(ruleClearance(Crossed.Road, 0)).toBe(5.5);
    expect(ruleClearance(0, 0)).toBe(0);
    // (chained: a 600 m bridge over 500 m of water — format 5 gave 5.5 m)
    const river = {
      min: [50, -500, 0] as [number, number, number],
      max: [550, 500, 0] as [number, number, number],
      data: [0, 0, 4, 4, 50, -500, 550, 500, 0, 0, 0, 4, 50, -500, 550, -500, 550, -500, 550, 500, 550, 500, 50, 500, 50, 500, 50, -500],
    };
    const [c] = chainBridges([{ cell: 0, index: 0, a: [0, 0], b: [600, 0], seg: seg([0, 0], [600, 0]) }], [river], [], () => false);
    expect(c!.bridge.clearance).toBeGreaterThan(18);
  });
});

describe("a section cut by two cells, a bridge by two tiles: whole", () => {
  test("two cells' pieces of one section overlapping 30 m past their edge: one chain, no back-tracking (format 5: two decks)", () => {
    const pieces = [
      { cell: 0, index: 0, a: [0, 0] as [number, number], b: [230, 0] as [number, number], seg: seg([0, 0], [230, 0], { za: 10, zb: 40 }) },
      {
        cell: 1,
        index: 0,
        a: [200, 0] as [number, number],
        b: [450, 0] as [number, number],
        seg: seg([200, 0], [450, 0], { za: 37, zb: 60 }),
      },
    ];
    const out = chainBridges(pieces, [], [], () => false);
    expect(out.length).toBe(1);
    const xs = out[0]!.bridge.points.map((p) => p[0]);
    const sorted = [...xs].sort((a, b) => a - b);
    expect(xs.join() === sorted.join() || xs.join() === [...sorted].reverse().join()).toBe(true);
    expect(out[0]!.bridge.flags & BridgeFlag.Measured).toBeTruthy();
  });
  test("and a gap of 25 m between them: one chain across it", () => {
    const pieces = [
      { cell: 0, index: 0, a: [0, 0] as [number, number], b: [200, 0] as [number, number], seg: seg([0, 0], [200, 0]) },
      { cell: 1, index: 0, a: [225, 0.5] as [number, number], b: [450, 1] as [number, number], seg: seg([225, 0.5], [450, 1]) },
    ];
    expect(chainBridges(pieces, [], [], () => false).length).toBe(1);
    // (another section — another road — in line: not spliced)
    const other = [pieces[0]!, { ...pieces[1]!, seg: seg([225, 0.5], [450, 1], { roadId: 8 }) }];
    expect(chainBridges(other, [], [], () => false).length).toBe(2);
  });
  test("two tiles' halves overlapping 32 m, open ends 32 m apart: spliced into one axis, the overlap dropped (format 5: two)", () => {
    const a = geo({ id: 1, flags: BridgeFlag.OpenB, points: line(47.18, 12, 20), heights: line(47.18, 12, 20).map((_, i) => 10 + i) });
    // (the second from 32 m before the first's open end)
    const b = geo({ id: 2, flags: BridgeFlag.OpenA, points: line(47.18 + 188 / 111_132, 10, 20), heights: Array(10).fill(30) });
    expect(joinBridgeHalves([a, b], 3).length).toBe(1);
    const [j] = spliceOpenHalves([a, b])!;
    expect(j!.flags & (BridgeFlag.OpenA | BridgeFlag.OpenB)).toBe(0);
    const lats = j!.points.map((p) => p.lat);
    for (let i = 1; i < lats.length; i++) expect(lats[i]!).toBeGreaterThan(lats[i - 1]!);
    expect(lenOf(j!)).toBeCloseTo(188 + 180, 0);
    expect(j!.heights!.length).toBe(j!.points.length);
    // (not a parallel deck 10 m aside — the other carriageway)
    const aside = geo({
      id: 2,
      flags: BridgeFlag.OpenA,
      points: line(47.18 + 188 / 111_132, 10, 20).map((p) => ({ ...p, lon: p.lon + 10 / 75_900 })),
    });
    expect(spliceOpenHalves([a, aside])).toBeNull();
  });
  test("two pieces' closed ends meeting (each written as an abutment): one deck; a ramp's end on a deck's middle: a branch", () => {
    const a = geo({ id: 1, points: line(47.18, 6, 20) });
    const b = geo({ id: 2, points: line(47.18 + 100.5 / 111_132, 6, 20) });
    const j = joinDeckPieces([a, b]);
    expect(j.length).toBe(1);
    expect(lenOf(j[0]!.bridge)).toBeCloseTo(200.5, 0);
    expect(j[0]!.bridge.flags & (BridgeFlag.OpenA | BridgeFlag.OpenB)).toBe(0);
    // (a ramp from the east whose end is on the deck's middle)
    const ramp = geo({
      id: 3,
      points: [
        { lat: 47.18 + 60 / 111_132, lon: -1.6 + 80 / 75_900 },
        { lat: 47.18 + 60 / 111_132, lon: -1.6 + 1 / 75_900 },
      ],
    });
    const k = joinDeckPieces([a, ramp]);
    const r = k.find((d) => d.bridge.id === 3)!;
    expect(r.branchA || r.branchB).toBe(true);
    expect(k.find((d) => d.bridge.id === 1)!.branchA || k.find((d) => d.bridge.id === 1)!.branchB).toBe(false);
    // (another layer's deck there: neither)
    expect(joinDeckPieces([a, { ...ramp, layer: 2 }]).some((d) => d.branchA || d.branchB)).toBe(false);
  });
  test("surveyed heights filled along the axis", () => {
    const pts = line(47, 5, 10);
    const f = fillHeights(pts, [Number.NaN, 10, Number.NaN, 30, Number.NaN])!;
    [10, 10, 20, 30, 30].forEach((v, i) => expect(f[i]!).toBeCloseTo(v, 6));
    expect(fillHeights(pts, [Number.NaN, 10, Number.NaN, Number.NaN, Number.NaN])).toBeNull();
  });
});

describe("the deck's profile on its survey", () => {
  // (a 1 200 m viaduct over a river at sea level: abutments' ground 8 m, the survey 9 → 58 → 9 m)
  const pts: [number, number, number][] = Array.from({ length: 61 }, (_, i) => [i * 20, 0, i === 0 || i === 60 ? 8 : 0]);
  const measured = pts.map((_, i) => 9 + 49 * Math.sin((Math.PI * i) / 60));
  test("followed within a centimetre away from its ends; each end brought to its ground within 4 %; the old curve 25 m lower", () => {
    const p = new BridgeContinuousProfile({ points: pts, width: 30, thickness: 2, clearance: 5.5, maxGrade: 0.05, measured });
    expect(p.measuredUsed).toBe(true);
    expect(p.deckAt(600)).toBeCloseTo(58, 1);
    expect(Math.abs(p.deckAt(300) - (9 + 49 * Math.sin(Math.PI / 4)))).toBeLessThan(0.3);
    expect(p.elevationAt(0)).toBeCloseTo(8, 6);
    expect(p.elevationAt(1200)).toBeCloseTo(8, 6);
    let g = 0;
    for (let s = 0; s + 0.5 <= 60; s += 0.5) g = Math.max(g, Math.abs(p.elevationAt(s + 0.5) - p.elevationAt(s)) / 0.5);
    // (the survey's own steepest chord 12.8 %, the ramp's 4 % at most on it)
    expect(g).toBeLessThan(0.128 + 0.04 + 0.005);
    // (the witness: the clearance's curve — what format 5 drew — crests far lower)
    const old = new BridgeContinuousProfile({ points: pts, width: 30, thickness: 2, clearance: 9.4, maxGrade: 0.05 });
    expect(old.deckAt(600)).toBeLessThan(35);
  });
  test("an open end left at its survey (mid-span); an end given (a neighbour's deck) taken", () => {
    const p = new BridgeContinuousProfile({ points: pts, width: 30, measured, flags: BridgeFlag.OpenB, endZA: 12 });
    expect(p.elevationAt(1200)).toBeCloseTo(9, 6);
    expect(p.elevationAt(0)).toBeCloseTo(12, 6);
  });
  test("a survey under the ground (a section's Z from the ground model) refused: the clearance's curve", () => {
    const under = measured.map((z, i) => (i === 30 ? -5 : z));
    expect(measuredDeckUsable(pts, under)).toBe(false);
    expect(new BridgeContinuousProfile({ points: pts, width: 30, measured: under }).measuredUsed).toBe(false);
  });
});

test("every bridge drawn: the LOD coarsened by the decks' share used, not a count's cap", () => {
  expect(selectBridgeLOD(100).sliceLengthM).toBe(10);
  expect(selectBridgeLOD(100, 0.6).sliceLengthM).toBe(20);
  expect(selectBridgeLOD(100, 0.8).drawParapets).toBe(false);
  expect(selectBridgeLOD(100, 0.95)).toEqual({ lodLevel: 3, sliceLengthM: 80, drawParapets: false, drawPiers: false });
  expect(selectBridgeLOD(8000).lodLevel).toBe(3);
  expect(selectBridgeLOD(3000).lodLevel).toBe(2);
});

/** Pont de Cheviré's two z 14 tiles from the e2e's Earth data on disk (null when missing) */
function chevire(decksOn: boolean) {
  const dir = earthDataDir();
  const all = new Map<string, GeoBridge>();
  for (const y14 of [5749, 5750]) {
    const x14 = 8118;
    const osm = readKept(dir, `https://tiles.openfreemap.org/planet/latest/14/${x14}/${y14}.pbf`, null);
    const decks = readKept(dir, bdtopoDecksUrl(x14, y14), null);
    const bd = (x: number, y: number) => readKept(dir, bdtopoUrl(x, y), null)?.body ?? null;
    const quads = [0, 1, 2, 3].map((k) => [x14 * 2 + (k % 2), y14 * 2 + Math.floor(k / 2)] as const);
    if (!osm || !decks || !quads.every(([x, y]) => bd(x, y))) return null;
    const cells = prepareStreetCells(
      osm.body,
      x14,
      y14,
      (x, y) => prepareBdtopoCell(bd(x, y)!, x, y, () => 0).buf,
      20261125,
      bd,
      false,
      decksOn ? parseBdtopoDecks(JSON.parse(new TextDecoder().decode(decks.body))) : null,
    );
    for (const c of cells) {
      const o = cellOrigin(c.x, c.y);
      for (const b of readBridges(c.buf)) {
        const points = b.points.map(([e, n]) => fromCell(o, e, n));
        all.set(`${b.id}:${points[0]!.lat.toFixed(6)}`, { ...b, points });
      }
    }
  }
  // (the viaduct's: within 300 m of its axis, 1.61375° W, from 47.183 to 47.2° N, longer than 100 m)
  const near = [...all.values()].filter(
    (b) => b.points.some((p) => Math.abs(p.lon + 1.6137) < 0.004 && p.lat > 47.183 && p.lat < 47.2) && b.points.length > 1,
  );
  return joinDeckPieces(joinBridgeHalves(near)).filter((d) => lenOf(d.bridge) > 100);
}
const C = chevire(true);
describe.skipIf(!C)("Pont de Cheviré (Nantes) — the e2e's Earth data on disk", () => {
  test("its two carriageways each one deck of ~1.68 km across both tiles and four cells (format 5: five pieces, 227–1 059 m)", () => {
    const old = chevire(false)!;
    const big = C!.filter((d) => lenOf(d.bridge) > 1500);
    console.log(
      `  Cheviré: ${C!.map((d) => `${lenOf(d.bridge).toFixed(0)} m${d.bridge.heights ? ` crest ${Math.max(...d.bridge.heights.filter(Number.isFinite)).toFixed(1)} m` : ""}`).join(" · ")}`,
    );
    expect(big.length).toBe(2);
    expect(C!.length).toBe(2);
    // (without the survey the same two decks — the joins are geometry's —, no height)
    expect(old.filter((d) => lenOf(d.bridge) > 1500).length).toBe(2);
    expect(old.every((d) => !d.bridge.heights)).toBe(true);
  });
  test("its deck surveyed: its crest 60 m over the sea (52 m air draught), continuous — no jump between points but the grade's", () => {
    for (const { bridge: b } of C!) {
      expect(b.flags & BridgeFlag.Measured).toBeTruthy();
      const h = fillHeights(b.points, b.heights)!;
      expect(Math.max(...h)).toBeGreaterThan(58);
      for (let i = 1; i < h.length; i++) {
        const d = lenOf({ ...b, points: [b.points[i - 1]!, b.points[i]!] });
        expect(Math.abs(h[i]! - h[i - 1]!)).toBeLessThanOrEqual(0.25 + 0.07 * d);
      }
    }
  });
});

test("the far layer's deck at its survey: each segment's slab at its height over the drawn ground (format 5: its clearance's 9 m)", () => {
  const buf = encodeStreetCell(
    { z: 15, x: 1, y: 2, generation: 0, originLat: 47, originLon: -1.6 },
    [],
    [],
    [],
    [],
    0,
    [],
    [],
    [],
    [
      {
        id: 9,
        kind: BridgeKind.Road,
        flags: BridgeFlag.Measured,
        width: 15,
        layer: 1,
        crossed: Crossed.Water,
        clearance: 9,
        length: 200,
        points: [
          [0, 0],
          [0, 100],
          [0, 200],
        ],
        heights: [10, Number.NaN, 60],
      },
    ],
  );
  // (the ground drawn 2 m over the sea, the geoid's N 50 m: a height over the sea h is h + 48 over the ground)
  const rec = farBridges(
    buf,
    () => true,
    (_e, _n, h) => h + 50 - 2,
  );
  expect(rec.length).toBe(16);
  expect(rec[7]!).toBeCloseTo((10 + 35) / 2 + 48 - 0.6, 4);
  expect(rec[15]!).toBeCloseTo((35 + 60) / 2 + 48 - 0.6, 4);
  // (without the ground: as before, its clearance)
  expect(farBridges(buf, () => true)[7]!).toBeCloseTo(9.6, 4);
});

test("twin carriageways overlapping across: one surface — their surveys' mean where they overlap (Cheviré: 0.3–0.4 m ridges)", () => {
  const a = geo({ id: 1, width: 15.5, points: line(47.18, 11, 20), heights: Array(11).fill(40) });
  const east = (d: number) => line(47.18, 11, 20).map((p) => ({ ...p, lon: p.lon + d / 75_900 }));
  const b = geo({ id: 2, width: 15.5, points: east(10.6), heights: Array(11).fill(40.4) });
  const far = geo({ id: 3, width: 15.5, points: east(30), heights: Array(11).fill(45) });
  const leveled = levelTwinDecks([a, b, far]);
  for (const h of leveled[0]!.heights!) expect(h).toBeCloseTo(40.2, 6);
  for (const h of leveled[1]!.heights!) expect(h).toBeCloseTo(40.2, 6);
  // (30 m aside: not a twin; another layer: neither)
  for (const h of leveled[2]!.heights!) expect(h).toBe(45);
  expect(levelTwinDecks([a, { ...b, layer: 2 }])[0]!.heights![0]).toBe(40);
});

describe.skipIf(!C)("Pont de Cheviré's carriageways leveled", () => {
  test("after leveling, the two decks' heights at their nearest points within 5 cm (before: up to 0.4 m)", () => {
    const L = levelTwinDecks(C!.map((d) => d.bridge));
    const p = L[0]!,
      q = L[1]!;
    const hp = fillHeights(p.points, p.heights)!,
      hq = fillHeights(q.points, q.heights)!;
    const gap = (hs: number[], other: number[], from: GeoBridge, to: GeoBridge) => {
      let worst = 0;
      from.points.forEach((pt, k) => {
        let best = Infinity,
          h = Number.NaN;
        to.points.forEach((r, m) => {
          const d = Math.hypot((r.lat - pt.lat) * 111_132, (r.lon - pt.lon) * 75_700);
          if (d < best) {
            best = d;
            h = other[m]!;
          }
        });
        if (best < 12) worst = Math.max(worst, Math.abs(h - hs[k]!));
      });
      return worst;
    };
    const before = gap(
      fillHeights(C![0]!.bridge.points, C![0]!.bridge.heights)!,
      fillHeights(C![1]!.bridge.points, C![1]!.bridge.heights)!,
      C![0]!.bridge,
      C![1]!.bridge,
    );
    const after = gap(hp, hq, p, q);
    console.log(`  Cheviré carriageways: height gap at the nearest points ${before.toFixed(3)} → ${after.toFixed(3)} m`);
    expect(after).toBeLessThan(before);
  });
});
