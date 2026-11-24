import { describe, expect, test } from "bun:test";
import { joinBridgeHalves, type GeoBridge } from "../src/system/bridge-ports";
import { buildContinuousSliceMesh, computeSlicePlane } from "../src/system/bridge-mesh";
import { BridgeContinuousProfile, type SupportRef, SupportSurfaceRegistry } from "../src/system/bridge-surface-service";
import { SceneryContact } from "../src/system/scenery-contact";
import { DECK_PLANE, packScenery, type Primitive } from "../src/system/scenery-data";
import { polygonPrimitive } from "../src/system/scenery-geometry";
import { BridgeFlag } from "../src/system/street-cells";

/** the steepest grade of a profile, sampled every 0.5 m */
const steepest = (p: BridgeContinuousProfile) => {
  let g = 0;
  for (let s = 0; s + 0.5 <= p.totalLength; s += 0.5) g = Math.max(g, Math.abs(p.elevationAt(s + 0.5) - p.elevationAt(s)) / 0.5);
  return g;
};
/** a straight bridge along x of `length` m, its abutments on ground 0, the ground between them `dip` m lower, every 20 m */
const dipped = (length: number, dip: number): [number, number, number][] => {
  const n = Math.round(length / 20);
  return Array.from({ length: n + 1 }, (_, i) => [i * 20, 0, i === 0 || i === n ? 0 : -dip] as [number, number, number]);
};

describe("review A7 — a bounded vertical curve, not a hump", () => {
  for (const length of [600, 1200]) {
    test(`a ${length} m bridge over a 5 m dip: clears 5.5 m under its intrados on its plateau, ≤ 5 % grade, no hump`, () => {
      const p = new BridgeContinuousProfile({ points: dipped(length, 5), width: 20, thickness: 1.5, clearance: 5.5, maxGrade: 0.05 });
      expect(p.elevationAt(0)).toBeCloseTo(0, 9);
      expect(p.elevationAt(length)).toBeCloseTo(0, 9);
      // (the old envelope: an 18 m / 36 m hump; the plateau now the clearance alone: −5 + 5.5 + 1.5 = 2 m)
      let top = -Infinity;
      for (let s = 0; s <= length; s += 1) top = Math.max(top, p.elevationAt(s));
      expect(top).toBeLessThan(2.5);
      expect(top).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(steepest(p)).toBeLessThanOrEqual(0.05 + 1e-3);
      // (the plateau's intrados over the dip: the clearance kept wherever the ramps are done)
      for (let s = p.rampM; s <= length - p.rampM; s += 5) expect(p.intradosAt(s) - -5).toBeGreaterThanOrEqual(5.5 - 0.05);
    });
  }

  test("a short bridge cannot reach its clearance within its grade: capped, nearly flat (piers carry it, not a hump)", () => {
    const p = new BridgeContinuousProfile({ points: dipped(40, 5), width: 10, thickness: 1.2, clearance: 5.5, maxGrade: 0.08 });
    expect(steepest(p)).toBeLessThanOrEqual(0.08 + 1e-3);
    let top = -Infinity;
    for (let s = 0; s <= 40; s += 0.5) top = Math.max(top, p.elevationAt(s));
    expect(top).toBeLessThan(1.1);
  });

  test("the deck meets its approach roads' grades at its ends (C1 with the road beyond)", () => {
    const pts: [number, number, number][] = [
      [0, 0, 10],
      [100, 0, 2],
      [200, 0, 2],
      [300, 0, 16],
    ];
    const p = new BridgeContinuousProfile({ points: pts, width: 12, approachSlopeA: 0.03, approachSlopeB: -0.02, maxGrade: 0.06 });
    expect(p.slopeAt(0)).toBeCloseTo(0.03, 9);
    expect(p.slopeAt(p.totalLength)).toBeCloseTo(-0.02, 9);
    // (its analytic slope is the curve's: a finite difference agrees)
    for (const s of [0.5, 37, 150, 260, 299.5])
      expect((p.elevationAt(s + 1e-4) - p.elevationAt(s - 1e-4)) / 2e-4).toBeCloseTo(p.slopeAt(s), 4);
  });

  test("an open end — the tile's cut, its other half not read — is held at its clearance, level: never dropped to the ground", () => {
    const pts: [number, number, number][] = [
      [0, 0, 0],
      [100, 0, -6],
      [200, 0, -6],
    ];
    const p = new BridgeContinuousProfile({ points: pts, width: 12, thickness: 1.5, clearance: 5.5, flags: BridgeFlag.OpenB });
    expect(p.elevationAt(200)).toBeCloseTo(-6 + 5.5 + 1.5, 9);
    expect(p.slopeAt(200)).toBeCloseTo(0, 9);
  });
});

describe("review A1 — a bridge cut by a z 14 tile's edge is one profile", () => {
  const lat0 = 48.85,
    lon0 = 2.3;
  const geo = (x: number) => ({ lat: lat0, lon: lon0 + x / (111_320 * Math.cos((lat0 * Math.PI) / 180)) });
  const half = (xs: number[], flags: number, id: number): GeoBridge => ({
    id,
    kind: 1,
    flags,
    width: 14,
    layer: 1,
    crossed: 1,
    clearance: 5.5,
    points: xs.map(geo),
  });

  test("its two halves, each open at the shared point (one reversed), joined into one axis whatever their order", () => {
    // (the west half A → its open end at x 300; the east half written from its abutment back to the edge: open at its B)
    const west = half([0, 100, 200, 300], BridgeFlag.OpenB, 7);
    const east = half([600, 500, 400, 300], BridgeFlag.OpenB | BridgeFlag.Confirmed, 9);
    const other = half([5000, 5100], 0, 3);
    const out = joinBridgeHalves([east, other, west]);
    expect(out.length).toBe(2);
    const j = out.find((b) => b.points.length > 2)!;
    expect(j.points.length).toBe(7);
    const xs = j.points.map((p) => Math.round((p.lon - lon0) * 111_320 * Math.cos((lat0 * Math.PI) / 180)));
    expect(xs[0] === 0 ? xs : [...xs].reverse()).toEqual([0, 100, 200, 300, 400, 500, 600]);
    expect(j.flags & (BridgeFlag.OpenA | BridgeFlag.OpenB)).toBe(0);
    expect(j.flags & BridgeFlag.Confirmed).toBeTruthy();
    expect(j.id).toBe(7);
  });

  test("a road half and a railway half at the same point, or two levels, are never joined", () => {
    const a = half([0, 300], BridgeFlag.OpenB, 1);
    const b = { ...half([300, 600], BridgeFlag.OpenA, 2), kind: 2 };
    const c = { ...half([300, 600], BridgeFlag.OpenA, 3), layer: 2 };
    expect(joinBridgeHalves([a, b]).length).toBe(2);
    expect(joinBridgeHalves([a, c]).length).toBe(2);
  });

  test("the joined profile is continuous to C1 across the former cut (no drop, no kink); the halves alone were not", () => {
    // (a 600 m bridge over a river 8 m below its banks, cut at 300 m)
    const ground = (x: number) => (x === 0 || x === 600 ? 0 : -8);
    const whole = new BridgeContinuousProfile({
      points: [0, 100, 200, 300, 400, 500, 600].map((x) => [x, 0, ground(x)] as [number, number, number]),
      width: 14,
      thickness: 1.5,
      clearance: 5.5,
    });
    const at = 300;
    const zL = whole.elevationAt(at - 1e-3),
      zR = whole.elevationAt(at + 1e-3);
    expect(Math.abs(zL - zR)).toBeLessThan(1e-4);
    expect(Math.abs(whole.slopeAt(at - 1e-3) - whole.slopeAt(at + 1e-3))).toBeLessThan(1e-4);
    expect(whole.elevationAt(at)).toBeGreaterThan(-8 + 5.5 + 1.5 - 1e-6);
    // (positive witness: the west half built alone with its cut taken for an abutment — the old behaviour — ends on the river's ground)
    const westAlone = new BridgeContinuousProfile({
      points: [0, 100, 200, 300].map((x) => [x, 0, ground(x)] as [number, number, number]),
      width: 14,
      thickness: 1.5,
      clearance: 5.5,
    });
    expect(westAlone.elevationAt(300)).toBeCloseTo(-8, 6);
  });
});

describe("review A2 — the contact is the drawn deck", () => {
  test("on a 10 % grade, the contact's height (the slice's plane, scenery-contact.ts topAt) is the mesh's top within 2 cm", () => {
    const pts: [number, number, number][] = Array.from({ length: 11 }, (_, i) => [i * 10, i * 3, i * 10 * 0.1 * Math.hypot(1, 0.3)]);
    const p = new BridgeContinuousProfile({ points: pts, width: 12, thickness: 1.2, clearance: 0, maxGrade: 0.2 });
    // (each slice as scenery-worker.ts deckBridge makes it: its mesh, its plane after its edges)
    const prims: Primitive[] = [],
      meshes: { positions: number[]; triangles: number[] }[] = [];
    for (let k = 0; k + 1 < p.stations.length; k++) {
      const a = p.axisAt(p.stations[k]!),
        b = p.axisAt(p.stations[k + 1]!);
      const top0 = p.deckAt(p.stations[k]!),
        top1 = p.deckAt(p.stations[k + 1]!);
      const m = buildContinuousSliceMesh({ pa: [a.x, a.y, 0], pb: [b.x, b.y, 0], width: 12, top0, top1, thick: 1.2 });
      const v = (i: number) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, 0] as [number, number, number];
      const prim = polygonPrimitive(
        [[v(0), v(3), v(2), v(1), v(0)]],
        Math.min(top0, top1) - 1.2,
        Math.max(top0, top1),
        2,
        [0.1, 0.1, 0.1],
      )!;
      const pl = computeSlicePlane([a.x, a.y, 0], [b.x, b.y, 0], top0, top1);
      prim.data[11] = DECK_PLANE;
      prim.data.push(pl[0], pl[1], pl[2], 1.2);
      prim.mesh = m;
      prims.push(prim);
      meshes.push(m);
    }
    const buf = packScenery(prims, new Uint32Array(512 * 512));
    const c = new SceneryContact({ id: 1, lat: 0, lon: 0 }, buf);
    const f = c.f;
    // (the leaves' records in pack order: their offsets from the BVH's leaves — node hi.w — each the slice whose box holds the point)
    const leaves: number[] = [];
    for (let i = 0; i < f[0]!; i++) {
      const w = f[16 + i * 8 + 7]!;
      if (w >= 0) leaves.push((f[1]! + w) * 4);
    }
    /** the mesh's top (its two top triangles) at (x, y), or null outside */
    const meshTop = (m: { positions: number[] }, x: number, y: number) => {
      const P = (i: number) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!];
      for (const [i, j, k] of [
        [0, 2, 1],
        [0, 3, 2],
      ] as const) {
        const [a, b, cc] = [P(i), P(j), P(k)];
        const d = (b[1]! - cc[1]!) * (a[0]! - cc[0]!) + (cc[0]! - b[0]!) * (a[1]! - cc[1]!);
        const l1 = ((b[1]! - cc[1]!) * (x - cc[0]!) + (cc[0]! - b[0]!) * (y - cc[1]!)) / d;
        const l2 = ((cc[1]! - a[1]!) * (x - cc[0]!) + (a[0]! - cc[0]!) * (y - cc[1]!)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * a[2]! + l2 * b[2]! + l3 * cc[2]!;
      }
      return null;
    };
    let checked = 0,
      worst = 0,
      oldWorst = 0;
    for (let s = 0.3; s < p.totalLength - 0.3; s += 0.7)
      for (const u of [-5.5, -2, 0, 3, 5.5]) {
        const a = p.axisAt(s);
        const x = a.x - a.ty * u,
          y = a.y + a.tx * u;
        for (let i = 0; i < meshes.length; i++) {
          const zm = meshTop(meshes[i]!, x, y);
          if (zm === null) continue;
          const base = leaves.find((b) => Math.abs(f[b]! - prims[i]!.data[0]!) < 1e-3 && Math.abs(f[b + 4]! - prims[i]!.data[4]!) < 1e-3)!;
          worst = Math.max(worst, Math.abs(c.topAt(base, x, y) - zm));
          // (positive witness: the box's flat top — the contact before the review — is a step on this grade)
          oldWorst = Math.max(oldWorst, Math.abs(f[base + 1]! - zm));
          checked++;
          break;
        }
      }
    expect(checked).toBeGreaterThan(500);
    expect(worst).toBeLessThan(0.02);
    expect(oldWorst).toBeGreaterThan(0.5);
  });
});

describe("PR2 — the support service", () => {
  test("cross-section bands match the drawn mesh: the deck's top across its width, the parapets' top within their band", () => {
    const p = new BridgeContinuousProfile({
      points: [
        [0, 0, 20],
        [100, 0, 20],
      ],
      width: 12,
      thickness: 1,
      clearance: 5,
      railW: 0.28,
      railH: 1,
    });
    const z = p.deckAt(50);
    expect(p.sample(50, 0).role).toBe("carriageway");
    expect(p.sample(50, 0).position[2]).toBeCloseTo(z, 9);
    // (a pavement is the deck's top in the mesh: no 0.15 m kerb there)
    expect(p.sample(50, 4.5).role).toBe("sidewalk");
    expect(p.sample(50, 4.5).position[2]).toBeCloseTo(z, 9);
    // (the parapet: its band the drawn rail's 0.28 m, its top 1 m over the deck)
    expect(p.sample(50, 5.85).role).toBe("parapet");
    expect(p.sample(50, 5.85).position[2]).toBeCloseTo(z + 1, 9);
    expect(p.sample(50, 5.7).role).toBe("sidewalk");
    const c = p.sample(50, 0);
    expect(Math.abs(c.normal[0] * c.tangent[0] + c.normal[1] * c.tangent[1] + c.normal[2] * c.tangent[2])).toBeLessThan(1e-9);
  });

  test("multi-level registry with hysteresis: the upper deck apart from the ground beneath", () => {
    const registry = new SupportSurfaceRegistry();
    const bridgeRef: SupportRef = { assetId: "bridge_seine_1", surfaceId: "deck_main", revision: "1" };
    const profile = new BridgeContinuousProfile({
      points: [
        [-50, 0, 35],
        [0, 0, 36.5],
        [50, 0, 35],
      ],
      width: 14,
      thickness: 1.5,
      clearance: 6,
    });
    registry.registerBridge(bridgeRef, profile, 1);
    const deck0 = profile.deckAt(50);
    const onDeck = registry.query([0, 0, deck0], 28, 2);
    expect(onDeck.supportRef?.surfaceId).toBe("deck_main");
    expect(onDeck.elevation).toBeCloseTo(deck0, 6);
    const under = registry.query([0, 0, 28], 28, 2);
    expect(under.surfaceRole).toBe("ground");
    expect(registry.query([10, 0, profile.deckAt(60)], 28, 2, bridgeRef).supportRef?.surfaceId).toBe("deck_main");
    expect(registry.query([10, 0, 28.1], 28, 2, { assetId: "ground", surfaceId: "terrain", revision: "1" }).surfaceRole).toBe("ground");
  });

  test("review A9: without a height, the deck of the asked layer, then the nearest axis — not the first registered", () => {
    const r = new SupportSurfaceRegistry();
    const deck = (y: number, z: number) =>
      new BridgeContinuousProfile({
        points: [
          [-100, y, z],
          [100, y, z],
        ],
        width: 12,
      });
    r.registerBridge({ assetId: "a", surfaceId: "far", revision: "1" }, deck(5, 10), 1);
    const nearDeck = deck(0, 20);
    r.registerBridge({ assetId: "b", surfaceId: "near", revision: "1" }, nearDeck, 1);
    r.registerBridge({ assetId: "c", surfaceId: "upper", revision: "1" }, deck(1, 30), 2);
    expect(r.queryBridgeAt(0, 0.5, { expectedLevel: 1 })?.supportRef?.surfaceId).toBe("near");
    expect(r.queryBridgeAt(0, 0.5, { expectedLevel: 2 })?.supportRef?.surfaceId).toBe("upper");
    expect(r.queryBridgeAt(0, 0.5, { expectedZ: 10.4 })?.supportRef?.surfaceId).toBe("far");
    // (past an end: off the deck)
    expect(r.queryBridgeAt(103, 0)).toBeNull();
    // (a lamp's foot beside the deck brought onto it, inside its parapet)
    const foot = r.snapOnDeck(0, -6.6, { expectedLevel: 1, inset: 0.4 })!;
    expect(foot[1]).toBeCloseTo(-(6 - 0.3 - 0.4), 6);
    // (its height the deck's there — 20 m and its drainage crest of 0.2 % of 200 m at mid-span)
    expect(foot[2]).toBeCloseTo(nearDeck.deckAt(100), 9);
    expect(foot[2]).toBeCloseTo(20.4, 6);
  });
});
