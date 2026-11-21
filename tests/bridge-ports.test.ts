import { describe, expect, test } from "bun:test";
import { fromCell, toCell } from "../src/system/building-cells";
import { bridgeCanonicalKey, type InterCellPort, matchInterCellPorts } from "../src/system/bridge-ports";
import { BridgeFlag, BridgeKind, type RoadSegmentRecord, SegmentFlag } from "../src/system/street-cells";
import { type BridgePiece, chainBridges } from "../src/system/street-detail-prep";

const makeSeg = (
  a: [number, number],
  b: [number, number],
  cls: RoadSegmentRecord["cls"],
  roadId: number,
  level = 1,
): RoadSegmentRecord => ({
  a,
  b,
  cls,
  roadId,
  width: cls === "rail" ? 7.5 : 8,
  lanes: 2,
  flags: SegmentFlag.Bridge,
  level,
  speed: cls === "rail" ? 0 : 20,
  s0: 0,
});

describe("PR1 — Identity, Ports, Mode Isolation & Multi-Tile Continuity", () => {
  test("mode isolation: coincident road and rail segments at the same level are NEVER chained into one bridge", () => {
    // Road from (0,0) to (50,0); Rail from (50,0) to (100,0) at the same level 1
    const roadPiece: BridgePiece = {
      cell: 0,
      index: 0,
      a: [0, 0],
      b: [50, 0],
      seg: makeSeg([0, 0], [50, 0], "secondary", 101, 1),
    };
    const railPiece: BridgePiece = {
      cell: 0,
      index: 1,
      a: [50, 0],
      b: [100, 0],
      seg: makeSeg([50, 0], [100, 0], "rail", 202, 1),
    };

    const chains = chainBridges([roadPiece, railPiece], [], [], () => false);

    // Must be separated into 2 independent bridges, one Road and one Rail
    expect(chains.length).toBe(2);

    const roadBridge = chains.find((c) => c.bridge.kind === BridgeKind.Road);
    const railBridge = chains.find((c) => c.bridge.kind === BridgeKind.Rail);

    expect(roadBridge).toBeDefined();
    expect(railBridge).toBeDefined();

    expect(roadBridge!.pieces.length).toBe(1);
    expect(roadBridge!.pieces[0]!.seg.cls).toBe("secondary");

    expect(railBridge!.pieces.length).toBe(1);
    expect(railBridge!.pieces[0]!.seg.cls).toBe("rail");
  });

  test("deterministic chaining: arrival order / shuffling does not affect bridge identity or composition", () => {
    const pieces: BridgePiece[] = [
      {
        cell: 0,
        index: 0,
        a: [0, 0],
        b: [30, 0],
        seg: makeSeg([0, 0], [30, 0], "primary", 50, 1),
      },
      {
        cell: 0,
        index: 1,
        a: [30, 0],
        b: [70, 0],
        seg: makeSeg([30, 0], [70, 0], "primary", 50, 1),
      },
      {
        cell: 0,
        index: 2,
        a: [70, 0],
        b: [120, 0],
        seg: makeSeg([70, 0], [120, 0], "primary", 50, 1),
      },
      {
        cell: 0,
        index: 3,
        a: [0, 20],
        b: [60, 20],
        seg: makeSeg([0, 20], [60, 20], "rail", 80, 1),
      },
    ];

    const normal = chainBridges(pieces, [], [], () => false);
    const shuffled = chainBridges([pieces[2]!, pieces[0]!, pieces[3]!, pieces[1]!], [], [], () => false);

    expect(shuffled.length).toBe(normal.length);
    for (let i = 0; i < normal.length; i++) {
      expect(shuffled[i]!.bridge.id).toBe(normal[i]!.bridge.id);
      expect(shuffled[i]!.bridge.kind).toBe(normal[i]!.bridge.kind);
      expect(shuffled[i]!.bridge.length).toBeCloseTo(normal[i]!.bridge.length, 6);
    }
  });

  test("ports & open ends: segments terminating at boundary receive OpenA/OpenB", () => {
    const piece: BridgePiece = {
      cell: 0,
      index: 0,
      a: [0, 0],
      b: [100, 0],
      seg: makeSeg([0, 0], [100, 0], "primary", 10, 1),
    };

    // Open at x=0 (OpenA) and open at x=100 (OpenB)
    const atEdge = (p: [number, number]) => p[0] <= 0 || p[0] >= 100;
    const chains = chainBridges([piece], [], [], atEdge);

    expect(chains.length).toBe(1);
    const b = chains[0]!.bridge;
    expect(b.flags & BridgeFlag.OpenA).toBeTruthy();
    expect(b.flags & BridgeFlag.OpenB).toBeTruthy();
  });

  test("global canonical identity: bridge in two different cell frames produces identical canonical key", () => {
    const origin1 = { lat: 48.858844, lon: 2.294351 };
    const origin2 = { lat: 48.86, lon: 2.3 };

    // The physical bridge first point in WGS84
    const bridgePtWgs84 = { lat: 48.8592, lon: 2.2955 };

    const loc1 = toCell(origin1, bridgePtWgs84.lat, bridgePtWgs84.lon);
    const loc2 = toCell(origin2, bridgePtWgs84.lat, bridgePtWgs84.lon);

    const g1 = fromCell(origin1, loc1.east, loc1.north);
    const g2 = fromCell(origin2, loc2.east, loc2.north);

    const key1 = bridgeCanonicalKey(12345, g1);
    const key2 = bridgeCanonicalKey(12345, g2);

    expect(key1).toBe(key2);
    expect(key1).toBe("bridge:12345:4885920:229550");
  });

  test("inter-cell port matching: matches open ports across cell border with matching mode and level", () => {
    const ports: InterCellPort[] = [
      {
        id: "port_tile1_east",
        bridgeId: 101,
        kind: "road",
        level: 1,
        pointWgs84: { lat: 48.86, lon: 2.3 },
        headingRad: 0,
        width: 10,
        isOpen: true,
      },
      {
        id: "port_tile2_west",
        bridgeId: 102,
        kind: "road",
        level: 1,
        pointWgs84: { lat: 48.860001, lon: 2.300001 }, // ~10 cm away
        headingRad: Math.PI,
        width: 10,
        isOpen: true,
      },
      {
        id: "port_rail_nearby",
        bridgeId: 201,
        kind: "rail",
        level: 1,
        pointWgs84: { lat: 48.86, lon: 2.3 },
        headingRad: Math.PI,
        width: 6,
        isOpen: true,
      },
    ];

    const matches = matchInterCellPorts(ports, 2.0);

    // Road ports match each other
    expect(matches.get("port_tile1_east")).toBe("port_tile2_west");
    expect(matches.get("port_tile2_west")).toBe("port_tile1_east");

    // Rail port cannot match road port even if close
    expect(matches.has("port_rail_nearby")).toBe(false);
  });
});
