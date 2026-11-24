import { describe, expect, test } from "bun:test";
import type { Vec3 } from "../src/physics";
import { NOTABLE_BRIDGES } from "../src/system/bridge-catalogue";
import { BridgePaint, type NotableFrame, notableDeckAxis, notableParts } from "../src/system/bridge-notable";
import { BridgeContinuousProfile } from "../src/system/bridge-surface-service";
import { STRUCT_CABLE, structCableTag } from "../src/system/scenery-data";

// PLAN-PONT-ROUTES-AAA B3 (24 Nov 2026): the catalogue's figures hold together (its towers' main span, its ends beyond them), and the
// structure drawn from it — towers to their tops over the sea, the main cables through the tops with their sag, suspenders vertical,
// stays from the pylons to the deck — is hung on the drivable deck the scene builds (one owner), its feet never under the ground or the
// sea (the geoid added: WGS84 heights).

const D = Math.PI / 180;
/** a flat frame at the bridge's middle (east, north, up [m]); the geoid's N a constant, the ground the sea */
const frameAt = (lat0: number, lon0: number, N = 30): NotableFrame => ({
  local: (lat, lon, h) => [(lon - lon0) * 111_320 * Math.cos(lat0 * D), (lat - lat0) * 111_132, h],
  geoid: () => N,
  ground: () => N,
});
const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((b.lat - a.lat) * 111_132, (b.lon - a.lon) * 111_320 * Math.cos(a.lat * D));

/** each catalogue main span as its sources give it [m] */
const MAIN: Record<string, number> = {
  "golden-gate": 1280,
  "pont-de-normandie": 856,
  "pont-de-tancarville": 608,
  "brooklyn-bridge": 486.3,
  "akashi-kaikyo": 1991,
  "viaduc-de-millau": 342,
};

describe("B3 — the catalogue", () => {
  test("each bridge's towers a main span apart as its sources say (±2 %), its ends beyond its towers, its sources named", () => {
    for (const nb of NOTABLE_BRIDGES) {
      const span = dist(nb.towers[0]!, nb.towers[1]!);
      expect(Math.abs(span - MAIN[nb.id]!) / MAIN[nb.id]!).toBeLessThan(0.03);
      const whole = dist(nb.ends[0], nb.ends[1]);
      expect(whole).toBeGreaterThan(dist(nb.towers[0]!, nb.towers[nb.towers.length - 1]!) - 1);
      expect(dist(nb.ends[0], nb.towers[0]!)).toBeLessThan(dist(nb.ends[0], nb.towers[nb.towers.length - 1]!));
      expect(nb.sources.length).toBeGreaterThan(0);
    }
  });

  test("the Golden Gate's own figures: 227 m towers, International Orange, 27.4 m deck, its crest under 67 m of clearance and its truss", () => {
    const gg = NOTABLE_BRIDGES.find((b) => b.id === "golden-gate")!;
    expect(gg.towerTop).toBe(227);
    expect(gg.towerPaint).toBe(BridgePaint.InternationalOrange);
    expect(gg.deckWidth).toBeCloseTo(27.4, 6);
    expect(gg.deckCrest - gg.girderDepth - 0.6).toBeGreaterThanOrEqual(67.1 + 0.7 - 1);
  });
});

describe("B3 — the structure on the deck", () => {
  const gg = NOTABLE_BRIDGES.find((b) => b.id === "golden-gate")!;
  const mid = { lat: (gg.ends[0].lat + gg.ends[1].lat) / 2, lon: (gg.ends[0].lon + gg.ends[1].lon) / 2 };
  const N = 30;
  const f = frameAt(mid.lat, mid.lon, N);
  const axis = notableDeckAxis(gg, f);
  // (the deck as the worker builds it: its points the roadway, no clearance asked over them, its grade 6.5 %)
  const deck = new BridgeContinuousProfile({
    points: axis as [number, number, number][],
    width: gg.deckWidth,
    thickness: 0.6,
    clearance: -0.6,
    maxGrade: 0.065,
  });
  const parts = notableParts(gg, f, (x) => deck.deckAt(x));

  test("the drivable deck follows the catalogue's roadway: its crest ~77 m over the sea (the geoid's N added)", () => {
    let top = -Infinity;
    for (let s = 0; s <= deck.totalLength; s += 5) top = Math.max(top, deck.deckAt(s));
    expect(top - N).toBeGreaterThan(74);
    expect(top - N).toBeLessThan(80);
    expect(deck.deckAt(0) - N).toBeCloseTo(64, 1);
  });

  test("its towers rise from the sea to 227 m over it; their feet never under the sea's level", () => {
    const towers = parts.solids.filter((p) => p.paint === BridgePaint.InternationalOrange && p.top - N > 226);
    expect(towers.length).toBe(4);
    for (const t of towers) {
      expect(t.top - N).toBeCloseTo(227, 6);
      expect(t.bottom).toBeGreaterThanOrEqual(N - 2 - 1e-9);
    }
  });

  test("its main cables run through the towers' tops and sag to just over the deck in the middle; its suspenders vertical", () => {
    const mains = parts.cables.filter((c) => !c.vertical);
    expect(mains.length).toBe(2);
    for (const c of mains) {
      const zs: number[] = [];
      for (let i = 0; i < c.positions.length; i += 6) zs.push(c.positions[i + 2]!);
      expect(Math.max(...zs) - N).toBeCloseTo(227 - 1.5, 1);
      // (its pairs: each point twice, the raster opens them)
      expect(c.positions.slice(0, 3)).toEqual(c.positions.slice(3, 6));
    }
    const hangers = parts.cables.filter((c) => c.vertical);
    expect(hangers.length).toBeGreaterThan(150);
    for (const h of hangers) {
      expect(h.positions[0]).toBeCloseTo(h.positions[6]!, 9);
      expect(h.positions[1]).toBeCloseTo(h.positions[7]!, 9);
      expect(h.positions[2]!).toBeGreaterThan(h.positions[8]!);
    }
    // (the lowest suspender in the main span: the cable 3 m or so over the roadway there)
    const shortest = Math.min(...hangers.map((h) => h.positions[2]! - h.positions[8]!));
    expect(shortest).toBeLessThan(6);
  });

  test("its suspenders end on the deck the cars drive — the profile's top, not the catalogue's own curve", () => {
    for (const h of parts.cables.filter((c) => c.vertical).slice(0, 40)) {
      const p: Vec3 = [h.positions[6]!, h.positions[7]!, h.positions[8]!];
      const q = deck.project(p[0], p[1]);
      expect(p[2]).toBeCloseTo(deck.deckAt(q.s) + 1, 1);
    }
  });

  test("a cable-stayed bridge's stays join its pylons to its deck: Normandie's 184", () => {
    const nd = NOTABLE_BRIDGES.find((b) => b.id === "pont-de-normandie")!;
    const m = { lat: (nd.ends[0].lat + nd.ends[1].lat) / 2, lon: (nd.ends[0].lon + nd.ends[1].lon) / 2 };
    const fn = frameAt(m.lat, m.lon, 45);
    const ax = notableDeckAxis({ ...nd, deckEnds: [5, 5] }, fn);
    const p = new BridgeContinuousProfile({
      points: ax as [number, number, number][],
      width: nd.deckWidth,
      thickness: 0.6,
      clearance: -0.6,
      maxGrade: 0.065,
    });
    const parts = notableParts({ ...nd, deckEnds: [5, 5] }, fn, (x) => p.deckAt(x));
    expect(parts.cables.length).toBe(184);
    for (const c of parts.cables) expect(c.positions[2]!).toBeGreaterThan(c.positions[8]!);
  });

  test("the cable's tag: its family, vertical bit, paint and diameter in centimetres", () => {
    const t = structCableTag(0.92, false, BridgePaint.InternationalOrange);
    expect((t & 0xffff0000) >>> 0).toBe(STRUCT_CABLE);
    expect(t & 0x7ff).toBe(92);
    expect((t >> 11) & 15).toBe(0);
    expect(structCableTag(0.07, true, BridgePaint.Ochre) & 0x8000).toBe(0x8000);
  });
});
