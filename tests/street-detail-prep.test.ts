import { expect, test } from "bun:test";
import type { Primitive } from "../src/system/scenery-data";
import { chainBridges, segmentNexts, segmentSurface, streetFurniture } from "../src/system/street-detail-prep";
import {
  BridgeFlag,
  BridgeKind,
  bridgePiers,
  Crossed,
  drivesLeft,
  FurnitureFlag,
  FurnitureKind,
  JunctionFlag,
  NEXT_ELSEWHERE,
  NEXT_NONE,
  NEXT_REVERSED,
  type RoadClass,
  type RoadSegmentRecord,
  SegmentFlag,
  SurfaceFlag,
} from "../src/system/street-cells";

// PLAN-J8 J8-VB (VB2, VB5a's side, VB6's data, VB7) — a street cell's details (src/system/street-detail-prep.ts, street-cells.ts KSC3's
// rules): the surfaces by class, width, lanes, way and place; the continuations (a road's own next piece, the straightest way a junction
// and the one ways allow, none back, NEXT_ELSEWHERE / NEXT_NONE); the furniture of a crossroads (stop lines on the lanes coming in, crossings,
// signals at the kerb — mirrored where the traffic drives on the left —, a one way going out without its line, a roundabout's yield lines)
// and the guardrails of a fast road outside the towns.

const seg = (a: [number, number], b: [number, number], o: Partial<RoadSegmentRecord> = {}): RoadSegmentRecord => ({
  a,
  b,
  width: 8,
  lanes: 2,
  cls: "secondary",
  flags: SegmentFlag.Urban,
  level: 0,
  speed: 14,
  s0: 0,
  roadId: 1,
  ...o,
});

test("the surfaces (VB2): the markings and kerbs a road's class, width, lanes, way and place call for", () => {
  // (a town's secondary two-way: a dashed centre, a kerb and 3 m pavements, no edge lines)
  const town = segmentSurface(seg([0, 0], [100, 0]));
  expect(town).toEqual({ flags: SurfaceFlag.CentreDashed | SurfaceFlag.Kerb, laneLines: 0, pavement: 3 });
  // (a country primary: edge lines and a dashed centre, no kerb)
  const country = segmentSurface(seg([0, 0], [100, 0], { cls: "primary", flags: 0, width: 7 }));
  expect(country).toEqual({ flags: SurfaceFlag.EdgeLines | SurfaceFlag.CentreDashed, laneLines: 0, pavement: 0 });
  // (a motorway's carriageway — one way, three lanes —: edge lines, two lane lines, no centre)
  const mw = segmentSurface(seg([0, 0], [100, 0], { cls: "motorway", flags: SegmentFlag.OnewayAlong, lanes: 3, width: 11 }));
  expect(mw).toEqual({ flags: SurfaceFlag.EdgeLines, laneLines: 2, pavement: 0 });
  // (a trunk: a solid centre)
  expect(segmentSurface(seg([0, 0], [100, 0], { cls: "trunk", flags: 0, width: 9 })).flags & SurfaceFlag.CentreSolid).toBeTruthy();
  // (a narrow town minor street: a kerb and pavements, no centre under SURFACE_MINOR_CENTRE_M)
  expect(segmentSurface(seg([0, 0], [100, 0], { cls: "minor", width: 5.5 }))).toEqual({
    flags: SurfaceFlag.Kerb,
    laneLines: 0,
    pavement: 2,
  });
  // (a town's service road: a kerb, no pavement; a path, a track, a ford: nothing)
  expect(segmentSurface(seg([0, 0], [100, 0], { cls: "service", lanes: 1, width: 4 }))).toEqual({
    flags: SurfaceFlag.Kerb,
    laneLines: 0,
    pavement: 0,
  });
  for (const cls of ["path", "track", "steps"] as RoadClass[])
    expect(segmentSurface(seg([0, 0], [100, 0], { cls }))).toEqual({ flags: 0, laneLines: 0, pavement: 0 });
  expect(segmentSurface(seg([0, 0], [100, 0], { flags: SegmentFlag.Ford })).flags).toBe(0);
  // (a bridge in a town: its markings, no kerb)
  expect(segmentSurface(seg([0, 0], [100, 0], { flags: SegmentFlag.Urban | SegmentFlag.Bridge })).flags & SurfaceFlag.Kerb).toBe(0);
});

test("the continuations (VB6): a road's next piece, the straightest way through a junction the one ways allow, none back", () => {
  // (a road of two pieces A → B, then a junction at (200, 0): straight on C, right D (going away), left E a one way coming in)
  const segs = [
    seg([0, 0], [100, 0], { roadId: 7 }), // 0
    seg([100, 0], [200, 0], { roadId: 7 }), // 1
    seg([200, 0], [300, 5], { roadId: 8 }), // 2 straight on
    seg([200, 0], [200, -100], { roadId: 9 }), // 3 right
    seg([200, 100], [200, 0], { roadId: 10, flags: SegmentFlag.Urban | SegmentFlag.OnewayAlong }), // 4 left: one way towards the junction
  ];
  const pieces = segs.map((_, i) => ({ a: i !== 1, b: i !== 0 }));
  const nx = segmentNexts(segs, pieces, () => false);
  expect(nx[0]!.b).toBe(1); // (its own road's next piece)
  expect(nx[1]!.a).toBe(0 | NEXT_REVERSED); // (driven back: piece 0 entered at its b)
  expect(nx[1]!.b).toBe(2); // (straight on, not the right)
  // (from the right arm, driven towards the junction — entered at b, driven b → a —: straight would be up the one way, refused: the
  // straightest allowed, which turns onto C or back along B)
  const fromRight = nx[3]!.a;
  expect([2, 1 | NEXT_REVERSED]).toContain(fromRight);
  expect(fromRight).not.toBe(4);
  // (the one way's far end: a dead end — its piece's own, inside the cell —; then at the cell's edge: it goes on elsewhere)
  expect(nx[4]!.a).toBe(NEXT_NONE);
  expect(segmentNexts(segs, pieces, (_e, n) => n > 99)[4]!.a).toBe(NEXT_ELSEWHERE);
  // (an end inside its piece with nothing in the cell: its next segment is a neighbour's)
  const lone = segmentNexts([seg([0, 0], [10, 0])], [{ a: true, b: false }], () => false);
  expect(lone[0]).toEqual({ b: NEXT_ELSEWHERE, a: NEXT_NONE });
  // (another level — a bridge over the junction —: never the next)
  const over = segmentNexts(
    [seg([0, 0], [10, 0]), seg([10, 0], [20, 0], { level: 1 })],
    [
      { a: true, b: true },
      { a: true, b: true },
    ],
    () => false,
  );
  expect(over[0]!.b).toBe(NEXT_NONE);
});

test("the furniture (VB7): a town's crossroads — stop lines on the lanes coming in, crossings, signals at the kerb; mirrored on the left", () => {
  // (four secondary arms, 8 m, 100 m long, round (0, 0))
  const arms = [seg([0, 0], [100, 0]), seg([0, 0], [-100, 0]), seg([0, 0], [0, 100]), seg([0, 0], [0, -100])];
  const J = [{ east: 0, north: 0, degree: 4, width: 8, flags: 0 }];
  const f = streetFurniture(arms, J, false);
  const kind = (k: FurnitureKind) => f.filter((x) => x.kind === k);
  expect(kind(FurnitureKind.StopLine).length).toBe(4);
  expect(kind(FurnitureKind.Crossing).length).toBe(4);
  expect(kind(FurnitureKind.Signal).length).toBe(4);
  expect(f.every((x) => x.flags & FurnitureFlag.Inferred && x.junction === 0)).toBe(true);
  // (the east arm: traffic comes in westwards, its lanes on the north — the right of a car heading west —; the line at 4 + 1 m, half the
  // width; the crossing 3 m beyond, the whole width; the signal at the northern kerb)
  const east = (k: FurnitureKind) => kind(k).find((x) => x.east > 0)!;
  expect(east(FurnitureKind.StopLine).east).toBeCloseTo(5, 5);
  expect(east(FurnitureKind.StopLine).north).toBeCloseTo(2, 5);
  expect(east(FurnitureKind.StopLine).length).toBeCloseTo(4, 5);
  expect(east(FurnitureKind.Crossing).east).toBeCloseTo(8, 5);
  expect(east(FurnitureKind.Crossing).length).toBeCloseTo(8, 5);
  expect(east(FurnitureKind.Signal).north).toBeCloseTo(4.5, 5);
  // (on the left: the same line on the south)
  const left = streetFurniture(arms, J, true).find((x) => x.kind === FurnitureKind.StopLine && x.east > 0)!;
  expect(left.north).toBeCloseTo(-2, 5);
});

test("the furniture (VB7): a one way going out has no line, a roundabout's arms yield, a lane of three arms of minor streets no signal", () => {
  const out = seg([0, 0], [100, 0], { flags: SegmentFlag.Urban | SegmentFlag.OnewayAlong });
  const arms = [out, seg([0, 0], [-100, 0], { cls: "minor" }), seg([0, 0], [0, 100], { cls: "minor" })];
  const f = streetFurniture(arms, [{ east: 0, north: 0, degree: 3, width: 8, flags: 0 }], false);
  expect(f.filter((x) => x.kind === FurnitureKind.StopLine && x.east > 0).length).toBe(0);
  expect(f.filter((x) => x.kind === FurnitureKind.Crossing).length).toBe(3);
  expect(f.filter((x) => x.kind === FurnitureKind.Signal).length).toBe(0);
  // (a roundabout: its own ring's segments nothing, the roads coming in a yield line)
  const ring = [
    seg([0, 0], [30, 0], { flags: SegmentFlag.Urban | SegmentFlag.Roundabout | SegmentFlag.OnewayAlong }),
    seg([-30, 0], [0, 0], { flags: SegmentFlag.Urban | SegmentFlag.Roundabout | SegmentFlag.OnewayAlong }),
    seg([0, -100], [0, 0], { cls: "tertiary" }),
  ];
  const r = streetFurniture(ring, [{ east: 0, north: 0, degree: 3, width: 8, flags: JunctionFlag.Roundabout }], false);
  const lines = r.filter((x) => x.kind === FurnitureKind.StopLine);
  expect(lines.length).toBe(1);
  expect(lines[0]!.flags & FurnitureFlag.Yield).toBeTruthy();
  // (a country junction — no urban arm —: nothing)
  const country = arms.map((s) => ({ ...s, flags: s.flags & ~SegmentFlag.Urban }));
  expect(streetFurniture(country, [{ east: 0, north: 0, degree: 3, width: 8, flags: 0 }], false).length).toBe(0);
});

test("the guardrails (VB7): both sides of a motorway outside the towns, of a bridge; none in a tunnel nor on a town's motorway", () => {
  const mw = seg([0, 0], [200, 0], { cls: "motorway", flags: SegmentFlag.OnewayAlong, width: 11 });
  const g = streetFurniture([mw], [], false);
  expect(g.length).toBe(2);
  expect(g.every((x) => x.kind === FurnitureKind.Guardrail && x.length === 200)).toBe(true);
  expect(g.map((x) => x.north).sort((a, b) => a - b)).toEqual([-6, 6]);
  expect(streetFurniture([{ ...mw, flags: mw.flags | SegmentFlag.Tunnel }], [], false).length).toBe(0);
  expect(streetFurniture([{ ...mw, flags: mw.flags | SegmentFlag.Urban }], [], false).length).toBe(0);
  expect(
    streetFurniture([seg([0, 0], [50, 0], { cls: "tertiary", flags: SegmentFlag.Urban | SegmentFlag.Bridge })], [], false).length,
  ).toBe(2);
});

test("the traffic's side: Great Britain, Ireland, Japan, Australia on the left; France — Calais, Boulogne — on the right", () => {
  for (const [lat, lon] of [
    [51.5, -0.12],
    [53.35, -6.26],
    [35.68, 139.7],
    [-33.87, 151.2],
    [-36.85, 174.76],
  ])
    expect(drivesLeft(lat!, lon!)).toBe(true);
  for (const [lat, lon] of [
    [48.86, 2.35],
    [43.12, 5.93],
    [50.95, 1.85],
    [50.72, 1.61],
    [40.4, -3.7],
  ])
    expect(drivesLeft(lat!, lon!)).toBe(false);
});

test("J8-RP RP4: a tile's bridge pieces chained into one deck — its abutments, width, what it crosses, confirmed, open at the tile's edge", () => {
  const bridge = (a: [number, number], b: [number, number], o: Partial<RoadSegmentRecord> = {}) =>
    seg(a, b, { flags: SegmentFlag.Urban | SegmentFlag.Bridge, level: 1, width: 10, cls: "secondary", ...o });
  // (a 300 m deck in three pieces over a river of 100 m wide, from x 100 to 200; the BD TOPO's « Pont » along it)
  const pieces = [
    { cell: 0, index: 0, a: [100, 0], b: [0, 0], seg: bridge([100, 0], [0, 0], { roadId: 5 }) },
    { cell: 1, index: 3, a: [100, 0], b: [200, 0], seg: bridge([100, 0], [200, 0], { roadId: 6 }) },
    { cell: 1, index: 4, a: [200, 0], b: [300, 0], seg: bridge([200, 0], [300, 0], { roadId: 6 }) },
  ] as const;
  const river: Primitive = {
    min: [100, -500, 0],
    max: [200, 500, 0],
    data: [0, 0, 1, 4, 100, -500, 200, 500, 0, 0, 0, 4, 100, -500, 200, -500, 200, -500, 200, 500, 200, 500, 100, 500, 100, 500, 100, -500],
  };
  const ponts: [[number, number], [number, number]][] = [
    [
      [0, 8],
      [300, 8],
    ],
  ];
  const out = chainBridges(
    pieces.map((p) => ({ ...p, a: [...p.a] as [number, number], b: [...p.b] as [number, number] })),
    [river],
    ponts,
    (p) => p[0] >= 299,
  );
  expect(out.length).toBe(1);
  const b = out[0]!.bridge;
  expect(out[0]!.pieces.length).toBe(3);
  expect(b.points.map((p) => p[0]).sort((x, y) => x - y)).toEqual([0, 100, 200, 300]);
  expect(b.length).toBeCloseTo(300, 6);
  expect(b.width).toBeCloseTo(10 + 2 * 3, 6);
  expect(b.layer).toBe(1);
  expect(b.crossed & Crossed.Water).toBeTruthy();
  expect(b.clearance).toBe(5.5);
  expect(b.flags & BridgeFlag.Confirmed).toBeTruthy();
  expect(b.flags & BridgeFlag.Viaduct).toBe(0);
  // (its end at x 300 cut by the tile's edge: open there, an abutment at x 0)
  const open = b.points[0]![0] === 300 ? BridgeFlag.OpenA : BridgeFlag.OpenB;
  expect(b.flags & open).toBeTruthy();
  expect(b.flags & (BridgeFlag.OpenA | BridgeFlag.OpenB)).toBe(open);
  expect(b.id).toBe(5);
  // (a footbridge over nothing, unconfirmed: kind Foot, no clearance)
  const foot = chainBridges(
    [{ cell: 0, index: 0, a: [0, 0], b: [40, 0], seg: bridge([0, 0], [40, 0], { cls: "path", width: 2, flags: SegmentFlag.Bridge }) }],
    [],
    [],
    () => false,
  )[0]!.bridge;
  expect([foot.kind, foot.crossed, foot.clearance, foot.flags]).toEqual([BridgeKind.Foot, 0, 0, 0]);
  // (another level at the same point: two decks)
  expect(
    chainBridges(
      [
        { cell: 0, index: 0, a: [0, 0], b: [50, 0], seg: bridge([0, 0], [50, 0]) },
        { cell: 0, index: 1, a: [50, 0], b: [100, 0], seg: bridge([50, 0], [100, 0], { level: 2 }) },
      ],
      [],
      [],
      () => false,
    ).length,
  ).toBe(2);
});

test("J8-RP RP4: the piers every ~34 m (a viaduct's ~130 m), none at the abutments", () => {
  expect(bridgePiers(30, false)).toEqual([]);
  const p = bridgePiers(170, false);
  expect(p.length).toBe(4);
  expect(p[0]).toBeCloseTo(34, 6);
  expect(bridgePiers(800, true).length).toBe(5);
});

test("J8-RP RP8: a tunnel's mouths — where a segment out of it meets it, heading in", () => {
  const segs = [seg([0, 0], [100, 0]), seg([100, 0], [400, 0], { flags: SegmentFlag.Tunnel, level: -1 }), seg([400, 0], [500, 0])];
  const m = streetFurniture(segs, [], false).filter((f) => f.kind === FurnitureKind.TunnelPortal);
  expect(m.map((f) => f.east).sort((a, b) => a - b)).toEqual([100, 400]);
  const at100 = m.find((f) => f.east === 100)!;
  expect(Math.cos(at100.heading)).toBeCloseTo(1, 6);
  expect(at100.length).toBe(8);
});

test("J8-RP RP9: a railway's track — electrified or not, no road markings, no stop line on it, never continued by a road", () => {
  const track = (a: [number, number], b: [number, number], o: Partial<RoadSegmentRecord> = {}) =>
    seg(a, b, { cls: "rail", flags: 0, width: 7.5, lanes: 2, speed: 0, roadId: 9, ...o });
  expect(segmentSurface(track([0, 0], [100, 0], { electric: true }))).toEqual({
    flags: SurfaceFlag.Electrified,
    laneLines: 0,
    pavement: 0,
  });
  expect(segmentSurface(track([0, 0], [100, 0]))).toEqual({ flags: 0, laneLines: 0, pavement: 0 });
  // (a level crossing: the track through a town's crossroads — the roads' furniture on their arms only)
  const arms = [seg([0, 0], [100, 0]), seg([0, 0], [-100, 0]), seg([0, 0], [0, 100]), track([0, 0], [0, -100])];
  const f = streetFurniture(arms, [{ east: 0, north: 0, degree: 4, width: 8, flags: 0 }], false);
  expect(f.filter((x) => x.kind === FurnitureKind.Crossing && x.north < -1).length).toBe(0);
  expect(f.filter((x) => x.kind === FurnitureKind.Crossing).length).toBe(3);
  // (the track's continuation another track, never the road beside it)
  const nx = segmentNexts(
    [track([0, 0], [100, 0]), seg([100, 0], [200, 0]), track([100, 0], [200, 5], { roadId: 10 })],
    [
      { a: true, b: true },
      { a: true, b: true },
      { a: true, b: true },
    ],
    () => false,
  );
  expect(nx[0]!.b).toBe(2);
  // (a railway's bridge)
  const rb = chainBridges(
    [{ cell: 0, index: 0, a: [0, 0], b: [60, 0], seg: track([0, 0], [60, 0], { flags: SegmentFlag.Bridge, level: 1 }) }],
    [],
    [],
    () => false,
  )[0]!.bridge;
  expect(rb.kind).toBe(BridgeKind.Rail);
});
