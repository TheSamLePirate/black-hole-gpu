import { describe, expect, test } from "bun:test";
import { airlineOf, LIVERY_AIRLINES, liveryOf, liveryRecord, PATTERN_CODE, TRAFFIC_PAINT_GEO } from "../src/traffic/livery";
import { SHADOW_GROUP, shadowGroup } from "../src/ship-casters";

// The traffic's liveries (src/traffic/livery.ts — Sam, 24 Nov 2026: « les avions proches portent tous la livrée de l'A320 du jeu »)
// and its casters in the shadow map's second half (src/ship-casters.ts).

describe("each airliner its airline's colours, by its callsign", () => {
  test("the ICAO designator: three letters then the flight's digit; a registration, none", () => {
    expect(airlineOf("UAL2623")).toBe("UAL");
    expect(airlineOf(" dal12 ")).toBe("DAL");
    expect(airlineOf("N796UA")).toBe("");
    expect(airlineOf("FGKXA")).toBe("");
    expect(airlineOf("")).toBe("");
  });

  test("the airlines of the table: their own colours — two airlines, two liveries; the same airline, the same", () => {
    const u = liveryOf("UAL1"),
      d = liveryOf("DAL7"),
      u2 = liveryOf("UAL2623");
    expect(u.icao).toBe("UAL");
    expect(u.pattern).toBe("belly");
    expect(u).toEqual(u2);
    expect(u.tail).not.toEqual(d.tail);
    expect(LIVERY_AIRLINES.length).toBeGreaterThan(40);
    // (every colour sRGB 0…255)
    for (const a of LIVERY_AIRLINES) {
      const L = liveryOf(`${a}1`);
      for (const c of [L.tail, L.stripe, L.body, L.engine]) for (const x of c) expect(x >= 0 && x <= 255).toBe(true);
    }
  });

  test("another airline: white, its fin one of a few colours — always the same for the same designator", () => {
    const a = liveryOf("XYZ123"),
      b = liveryOf("XYZ9");
    expect(a.icao).toBe("");
    expect(a.pattern).toBe("tail");
    expect(a).toEqual(b);
    // (the designators spread over several fins)
    const fins = new Set(["AAA1", "BBB1", "CCC1", "DDD1", "EEE1", "FFF1", "GGG1", "HHH1"].map((c) => liveryOf(c).tail.join()));
    expect(fins.size).toBeGreaterThan(2);
  });

  test("the shader's record: the gear, the pattern's code, linear colours where ship.wgsl trafficPaint reads them", () => {
    const L = liveryOf("DAL7");
    const r = liveryRecord(L, 0.4);
    expect(r.length).toBe(20);
    expect(r[0]).toBeCloseTo(0.4, 6);
    expect(r[1]).toBe(PATTERN_CODE.belly);
    // (the fin's red: sRGB 190 → linear 0.515)
    expect(r[4]).toBeCloseTo(0.5149, 3);
    // (the engine's blue: its b in model[1].w)
    expect(r[7]).toBeCloseTo(((80 / 255 + 0.055) / 1.055) ** 2.4, 4);
    // (none: the mesh's own map — pattern 0 —, the gear clamped)
    const z = liveryRecord(null, 3);
    expect(z[0]).toBe(1);
    expect(z[1]).toBe(0);
    // (the places' table: three vec4s for each paint frame, including the shared 777 frame)
    expect(TRAFFIC_PAINT_GEO.length).toBe(72);
  });
});

describe("the traffic's shadows: one group of casters about the one the view looks at, bounded", () => {
  const C = (t: number[], kind: "unit" | "craft" | null = "craft", r = 25) => ({ t, r, kind });

  test("the one nearest the view's centre and those within 300 m of it — an apron's airliners —, not the others", () => {
    const g = shadowGroup([C([0, -30, 800]), C([120, -30, 820]), C([-200, -30, 900]), C([900, -30, 1200]), C([10, -30, 850], null)]);
    expect([...g].sort()).toEqual([0, 1, 2]);
  });

  test("none beyond its reach, none behind the camera, none not a caster: no group", () => {
    expect(shadowGroup([C([0, 0, SHADOW_GROUP.reach + 10])]).size).toBe(0);
    expect(shadowGroup([C([0, -20, -300])]).size).toBe(0);
    expect(shadowGroup([C([0, -20, 300], null)]).size).toBe(0);
  });

  test("its sphere bounded: a caster whose far edge lies beyond maxR of the one looked at is left out", () => {
    // (a big ship 200 m off, its radius 260 m: 460 > 450)
    const g = shadowGroup([C([0, -10, 1000]), C([200, -10, 1000], "craft", 260), C([150, -10, 1000], "craft", 30)]);
    expect([...g].sort()).toEqual([0, 2]);
  });

  test("the war's ground units as before: their tighter 200 m group about the one looked at", () => {
    const g = shadowGroup([C([0, -5, 500], "unit", 6), C([150, -5, 500], "unit", 6), C([250, -5, 500], "unit", 6)]);
    expect([...g].sort()).toEqual([0, 1]);
  });
});
