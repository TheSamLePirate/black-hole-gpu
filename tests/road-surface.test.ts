import { describe, expect, test } from "bun:test";
import { cellRoadSurfaces } from "../src/system/cell-roads";
import {
  CELL_SURFACE_SHIFT,
  cellSurfaceOf,
  inferRoadSurface,
  ROAD_SURFACE_UNIT,
  RoadSurface,
  roadSurfaceColour,
  withCellSurface,
} from "../src/system/road-surface";
import {
  encodeStreetCell,
  FurnitureFlag,
  FurnitureKind,
  type JunctionRecord,
  NEXT_NONE,
  type RoadSegmentRecord,
  SegmentFlag,
  type SegmentSurface,
  SurfaceFlag,
} from "../src/system/street-cells";
import { armRoles, segmentSurface, streetFurniture } from "../src/system/street-detail-prep";

// PLAN-PONT-ROUTES-AAA B1/B2 (24 Nov 2026): a road's surface material from the data or the rule (road-surface.ts), carried through a
// street cell's surface flags to the scene's road word; its dashes' phase run on, its bends rounded, its lines ending at a junction by
// its arms' roles, the lines each arm gets (street-detail-prep.ts armRoles, streetFurniture).

const seg = (a: [number, number], b: [number, number], extra: Partial<RoadSegmentRecord> = {}): RoadSegmentRecord => ({
  a,
  b,
  width: 9,
  lanes: 2,
  cls: "secondary",
  flags: SegmentFlag.Urban,
  level: 0,
  speed: 14,
  s0: 0,
  roadId: 1,
  ...extra,
});
const cell = (segs: RoadSegmentRecord[], junctions: JunctionRecord[] = [], next = segs.map(() => ({ a: NEXT_NONE, b: NEXT_NONE }))) =>
  encodeStreetCell(
    { z: 15, x: 1, y: 2, generation: 20261124, originLat: 48.85, originLon: 2.35 },
    [],
    segs,
    junctions,
    [],
    0,
    next,
    [],
    segs.map((s) => ({ ...segmentSurface(s), bridge: 0xff }) as SegmentSurface),
  );

describe("B1 — the surface material", () => {
  test("the data first, then the class, then the place; asphalt else", () => {
    expect(inferRoadSurface({ cls: "track", nature: "Route empierrée" })).toBe(RoadSurface.Gravel);
    expect(inferRoadSurface({ cls: "track", nature: "Chemin" })).toBe(RoadSurface.Earth);
    expect(inferRoadSurface({ cls: "minor", surface: "unpaved" })).toBe(RoadSurface.Gravel);
    expect(inferRoadSurface({ cls: "path", surface: "unpaved" })).toBe(RoadSurface.Earth);
    expect(inferRoadSurface({ cls: "path", subclass: "pedestrian" })).toBe(RoadSurface.Setts);
    expect(inferRoadSurface({ cls: "track", surface: "paved" })).toBe(RoadSurface.Asphalt);
    expect(inferRoadSurface({ cls: "track" })).toBe(RoadSurface.Gravel);
    expect(inferRoadSurface({ cls: "steps" })).toBe(RoadSurface.Concrete);
    // (a North American freeway concrete, a European one asphalt)
    expect(inferRoadSurface({ cls: "motorway", lat: 37.8, lon: -122.4 })).toBe(RoadSurface.Concrete);
    expect(inferRoadSurface({ cls: "motorway", lat: 48.8, lon: 2.3 })).toBe(RoadSurface.Asphalt);
    expect(inferRoadSurface({ cls: "secondary", lat: 37.8, lon: -122.4 })).toBe(RoadSurface.Asphalt);
  });

  test("written in a street cell's surface flags (bits 5–7: material + 1), the markings' bits untouched; a cell before B1 reads null", () => {
    for (const m of [RoadSurface.Asphalt, RoadSurface.Concrete, RoadSurface.Setts, RoadSurface.Gravel, RoadSurface.Earth]) {
      const f = withCellSurface(SurfaceFlag.CentreDashed | SurfaceFlag.Kerb, m);
      expect(f & 31).toBe(SurfaceFlag.CentreDashed | SurfaceFlag.Kerb);
      expect(cellSurfaceOf(f)).toBe(m);
      expect(f >> CELL_SURFACE_SHIFT).toBe(m + 1);
    }
    expect(cellSurfaceOf(SurfaceFlag.Kerb)).toBeNull();
    // (segmentSurface writes the segment's material — a track too, no marking on it)
    expect(cellSurfaceOf(segmentSurface(seg([0, 0], [1, 0], { cls: "track", material: RoadSurface.Gravel })).flags)).toBe(
      RoadSurface.Gravel,
    );
  });

  test("the scene's road word carries it (× 65536) over the markings, the colour its own; an older cell's inferred by class", () => {
    const out = cellRoadSurfaces(
      cell([
        seg([0, 0], [100, 0], { material: RoadSurface.Setts, roadId: 1 }),
        seg([0, 50], [100, 50], { cls: "track", roadId: 2, flags: 0 }),
      ]),
      (e, n) => [e, n, 0],
    );
    const setts = out.find((p) => p.data[1] === 0)!,
      track = out.find((p) => p.data[1] === 50)!;
    expect(Math.floor(setts.data[6]! / ROAD_SURFACE_UNIT)).toBe(RoadSurface.Setts);
    expect(setts.data[6]! & 15).toBe(SurfaceFlag.CentreDashed | SurfaceFlag.Kerb);
    expect(setts.data.slice(8, 11)).toEqual(roadSurfaceColour(RoadSurface.Setts));
    // (no material in the cell — none written —: the class's rule, a track's gravel)
    expect(Math.floor(track.data[6]! / ROAD_SURFACE_UNIT)).toBe(RoadSurface.Gravel);
  });
});

describe("B2 — markings that behave", () => {
  test("the dashes' phase runs on: each piece carries its abscissa along its road (data[11] = −s)", () => {
    const segs = [seg([0, 0], [100, 0], { s0: 250 }), seg([100, 0], [200, 0], { s0: 350 })];
    const next = [
      { a: NEXT_NONE, b: 1 },
      { a: 0, b: NEXT_NONE },
    ];
    const out = cellRoadSurfaces(cell(segs, [], next), (e, n) => [e, n, 0], false, false);
    expect(out.map((p) => -p.data[11]!)).toEqual([250, 350]);
  });

  test("a bend rounded: three pieces on a quadratic curve replace the corner, every piece meeting the next", () => {
    const segs = [seg([0, 0], [100, 0], { s0: 0 }), seg([100, 0], [100 + 100 * Math.cos(0.5), 100 * Math.sin(0.5)], { s0: 100 })];
    const next = [
      { a: NEXT_NONE, b: 1 },
      { a: 0, b: NEXT_NONE },
    ];
    const out = cellRoadSurfaces(cell(segs, [], next), (e, n) => [e, n, 0]);
    expect(out.length).toBe(5);
    for (let k = 0; k + 1 < out.length; k++) {
      expect(out[k]!.data[2]!).toBeCloseTo(out[k + 1]!.data[0]!, 9);
      expect(out[k]!.data[3]!).toBeCloseTo(out[k + 1]!.data[1]!, 9);
    }
    // (the turn spread over the pieces: no single kink of the 28.6° bend)
    const heading = (p: (typeof out)[0]) => Math.atan2(p.data[3]! - p.data[1]!, p.data[2]! - p.data[0]!);
    let worst = 0;
    for (let k = 0; k + 1 < out.length; k++) worst = Math.max(worst, Math.abs(heading(out[k + 1]!) - heading(out[k]!)));
    expect(worst).toBeLessThan(0.2);
    // (the abscissa still continuous along the pieces)
    for (let k = 0; k + 1 < out.length; k++) {
      const L = Math.hypot(out[k]!.data[2]! - out[k]!.data[0]!, out[k]!.data[3]! - out[k]!.data[1]!);
      expect(-out[k + 1]!.data[11]!).toBeCloseTo(-out[k]!.data[11]! + L, 6);
    }
  });

  test("the arms' roles: a through road and the arm that gives way; equals none", () => {
    expect(armRoles([{ cls: "primary" }, { cls: "primary" }, { cls: "minor" }])).toEqual(["major", "major", "minor"]);
    expect(armRoles([{ cls: "minor" }, { cls: "minor" }, { cls: "minor" }, { cls: "minor" }])).toEqual([
      "equal",
      "equal",
      "equal",
      "equal",
    ]);
    // (the highest class on one arm alone: no through road)
    expect(armRoles([{ cls: "primary" }, { cls: "minor" }, { cls: "minor" }])).toEqual(["equal", "equal", "equal"]);
  });

  const tee = (urban: boolean, major = "primary") => {
    const f = urban ? SegmentFlag.Urban : 0;
    return [
      seg([-100, 0], [0, 0], { cls: major as RoadSegmentRecord["cls"], width: 9, roadId: 1, flags: f }),
      seg([0, 0], [100, 0], { cls: major as RoadSegmentRecord["cls"], width: 9, roadId: 2, flags: f }),
      seg([0, 0], [0, 80], { cls: "minor", width: 6, roadId: 3, flags: f }),
    ];
  };
  const J: JunctionRecord[] = [{ east: 0, north: 0, degree: 3, width: 9, flags: 0 }];

  test("a T: the arm that gives way gets its yield line, the through road none; in a town crossings on each arm", () => {
    const f = streetFurniture(tee(true), J, false);
    const lines = f.filter((x) => x.kind === FurnitureKind.StopLine);
    expect(lines.length).toBe(1);
    expect(lines[0]!.flags & FurnitureFlag.Yield).toBeTruthy();
    expect(lines[0]!.east).toBeLessThan(0.01);
    expect(lines[0]!.north).toBeGreaterThan(5);
    expect(f.filter((x) => x.kind === FurnitureKind.Crossing).length).toBe(3);
  });

  test("outside a town: the yield line alone, no crossing; a stop line where the through road is a trunk", () => {
    const f = streetFurniture(tee(false), J, false);
    expect(f.filter((x) => x.kind === FurnitureKind.StopLine).length).toBe(1);
    expect(f.filter((x) => x.kind === FurnitureKind.Crossing).length).toBe(0);
    const t = streetFurniture(tee(false, "trunk"), J, false).filter((x) => x.kind === FurnitureKind.StopLine);
    expect(t.length).toBe(1);
    expect(t[0]!.flags & FurnitureFlag.Yield).toBe(0);
  });

  test("the arm that gives way loses its centre line over its last J.width / 2 + 1 m; the through road keeps its own", () => {
    const segs = tee(true);
    const out = cellRoadSurfaces(cell(segs, J), (e, n) => [e, n, 0], false, false);
    const minor = out.filter((p) => Math.abs(p.data[0]! - p.data[2]!) < 1e-6);
    expect(minor.length).toBe(2);
    const near = minor.find((p) => Math.min(p.data[1]!, p.data[3]!) < 1)!;
    expect(Math.abs(near.data[3]! - near.data[1]!)).toBeCloseTo(9 / 2 + 1, 6);
    expect(near.data[6]! & (2 | 4)).toBe(0);
    const rest = minor.find((p) => p !== near)!;
    // (its kerb and pavement kept on the quiet piece)
    expect(near.data[6]! & SurfaceFlag.Kerb).toBe(rest.data[6]! & SurfaceFlag.Kerb);
    const major = out.filter((p) => Math.abs(p.data[1]! - p.data[3]!) < 1e-6);
    expect(major.length).toBe(2);
    for (const p of major) expect(p.data[6]! & 2).toBe(2);
  });
});
