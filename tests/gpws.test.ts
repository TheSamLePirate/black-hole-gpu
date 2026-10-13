import { describe, expect, test } from "bun:test";
import { Callouts } from "../src/game/callouts";
import { gpws, gpwsOf, terrainAhead } from "../src/game/gpws";

describe("terrainAhead: the straight flight path's time to the ground", () => {
  test("level over flat ground: none", () => {
    expect(terrainAhead(() => 150)).toBe(Infinity);
  });
  test("a ridge rising ahead: met when the path's height falls through it, interpolated", () => {
    // 150 m up at 250 m/s, the ground rising 1 m per 10 m ahead: met at 6 s (1500 m on)
    const t = terrainAhead((s) => 150 - 0.1 * 250 * s);
    expect(t).toBeCloseTo(6, 6);
  });
  test("a dive: met at agl / sink", () => {
    expect(terrainAhead((s) => 200 - 40 * s)).toBeCloseTo(5, 6);
    // (between the coarse samples past 6 s: still interpolated)
    expect(terrainAhead((s) => 300 - 20 * s)).toBeCloseTo(15, 6);
  });
  test("beyond the look-ahead: none", () => {
    expect(terrainAhead((s) => 1000 - 10 * s)).toBe(Infinity);
  });
});

describe("gpws: a jet low on its wings is quiet until the ground really comes", () => {
  const jet = { agl: 150, vz: 0, ahead: Infinity, winged: true, landing: false };
  test("level at 150 m over flat ground: nothing, at every level", () => {
    for (const lvl of ["full", "reduced", "off"] as const) {
      const g = gpws(jet, lvl);
      expect(g.pullUp).toBe(false);
      expect(g.terrain).toBe(false);
    }
  });
  test("a ridge ahead: the caution then the warning by level", () => {
    expect(gpws({ ...jet, ahead: 10 }, "full")).toMatchObject({ pullUp: false, terrain: true });
    expect(gpws({ ...jet, ahead: 10 }, "reduced")).toMatchObject({ pullUp: false, terrain: false });
    expect(gpws({ ...jet, ahead: 5 }, "reduced")).toMatchObject({ pullUp: false, terrain: true });
    expect(gpws({ ...jet, ahead: 3 }, "reduced")).toMatchObject({ pullUp: true });
    expect(gpws({ ...jet, ahead: 3 }, "off")).toMatchObject({ pullUp: false, terrain: false });
    expect(gpws({ ...jet, ahead: 2 }, "off")).toMatchObject({ pullUp: true, terrain: false });
  });
  test("the radio heights and the sink rate: a fighter's only set to land", () => {
    expect(gpws(jet, "reduced")).toMatchObject({ heights: false, sinkRate: false });
    expect(gpws({ ...jet, landing: true }, "reduced")).toMatchObject({ heights: true, sinkRate: true });
    expect(gpws(jet, "full")).toMatchObject({ heights: true, sinkRate: true });
    expect(gpws({ ...jet, landing: true }, "off")).toMatchObject({ heights: false, sinkRate: false });
  });
  test("set to land: the Ranger's steep glide is not a warning, past its envelope it is, the flare never", () => {
    // 300 m, 45 m/s down (inside 1.3 × the envelope's 53 m/s), the ground 6.7 s ahead
    expect(gpws({ agl: 300, vz: -45, ahead: 6.7, winged: true, landing: true }, "full").pullUp).toBe(false);
    expect(gpws({ agl: 300, vz: -75, ahead: 4, winged: true, landing: true }, "reduced").pullUp).toBe(true);
    expect(gpws({ agl: 10, vz: -6, ahead: 1.6, winged: true, landing: true }, "full").pullUp).toBe(false);
  });
  test("falling (not on its wings): the ground's closure counts, not the path ahead", () => {
    expect(gpws({ agl: 100, vz: -40, ahead: Infinity, winged: false, landing: false }, "reduced").pullUp).toBe(true);
    expect(gpws({ agl: 100, vz: -5, ahead: 1, winged: false, landing: false }, "reduced").pullUp).toBe(false);
  });
});

describe("gpwsOf: a frame's flight", () => {
  const frame = (o: { alt?: number; vVert?: number; q?: number; mode?: string; gearDown?: boolean; ahead?: number }) => ({
    surface: { alt: o.alt ?? 150, vVert: o.vVert ?? 0, landed: false, rolling: false },
    air: { inAir: true, q: o.q ?? 30000, stalled: false, mode: o.mode ?? "plane", gearDown: o.gearDown ?? false, flaps: 0 },
    entry: null,
    terrainAhead: o.ahead ?? Infinity,
  });
  test("high: not the ground's business", () => {
    expect(gpwsOf(frame({ alt: 5000, vVert: -200 }), "full").low).toBe(false);
  });
  test("a jet at 150 m, 250 m/s, slightly descending: quiet (the old alarm rang on the free fall's impact)", () => {
    const g = gpwsOf(frame({ vVert: -5 }), "reduced");
    expect(g).toMatchObject({ low: true, pullUp: false, terrain: false, heights: false });
  });
  test("a rocket in the air: its closure", () => {
    expect(gpwsOf(frame({ mode: "rocket", vVert: -50, ahead: 1 }), "reduced").pullUp).toBe(true);
    expect(gpwsOf(frame({ mode: "rocket", vVert: -5, ahead: 1 }), "reduced").pullUp).toBe(false);
  });
  test("the gear down: set to land", () => {
    expect(gpwsOf(frame({ gearDown: true }), "reduced").heights).toBe(true);
  });
});

describe("callouts with the ground's warnings", () => {
  const base = { inAir: true, final: false, dh: 60, alerts: [] };
  test("a low pass at a fighter's level: no heights said, none said on the way back up either", () => {
    const c = new Callouts();
    const quiet = { pullUp: false, sinkRate: false, heights: false };
    const said: string[] = [];
    for (let agl = 400; agl >= 40; agl -= 5) for (const l of c.update({ ...base, agl, vz: -20, gpws: quiet })) said.push(l.id!);
    expect(said).toEqual([]);
  });
  test("set to land: the heights come back", () => {
    const c = new Callouts();
    const landing = { pullUp: false, sinkRate: true, heights: true };
    const said: string[] = [];
    for (let agl = 400; agl >= 40; agl -= 5) for (const l of c.update({ ...base, agl, vz: -5, gpws: landing })) said.push(l.id!);
    expect(said).toEqual(["h-300", "h-100", "h-50", "h-40"]);
  });
  test("the pull-up from the look-ahead, said once while it lasts", () => {
    const c = new Callouts();
    const g = { pullUp: true, sinkRate: false, heights: false };
    expect(c.update({ ...base, agl: 150, vz: 0, gpws: g }).map((l) => l.id)).toEqual(["pull-up"]);
    expect(c.update({ ...base, agl: 150, vz: 0, gpws: g })).toEqual([]);
  });
});
