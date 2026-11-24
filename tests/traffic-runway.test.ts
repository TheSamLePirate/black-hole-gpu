import { afterEach, describe, expect, test } from "bun:test";
import { fromAdsbLol } from "../server/traffic";
import { type RunwayFrame, runwayFrame, setWorldRunways } from "../src/game/sites";
import { cartToGeodetic, geodeticToCart, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { setGroundRelief } from "../src/system/our-surface";
import { type Plane, TrafficFeed } from "../src/traffic/feed";
import { type Way, waysOf } from "../src/traffic/landing";
import { GEAR, gearStep, gearTarget, matchRunway, RUNWAY_PHASE, runwayPlace, type TrafficPhase } from "../src/traffic/runway-phase";
import { TRAFFIC_RIG, trafficRig } from "../src/controller/traffic";
import { geoidDeg } from "../src/system/geoid-grid";
import { overPlace, resetFlights } from "./helpers/flight";

// The real traffic against the game's runways (traffic/runway-phase.ts — Sam, 24 Nov 2026: airliners consistent with the
// in-game runways, those on the ground on it and never under it, taking off from and landing on the runways — not beside
// them, not in the grass, not floating —, their gear down at take-off and landing, up in cruise). San Francisco's runways
// as the game draws them (OurAirports' thresholds, assets/runways/v1 — world/runways3d.ts frameOf): an approach to 28L
// 35 m off its axis and 25 m high (ADS-B's errors), its rollout reported « airborne », a take-off from 01R 15 m off, N796UA
// parked with alt_baro −200 ft; and left alone: a helicopter by the runway, an aircraft over the bay beside the final, one
// crossing the field.

afterEach(() => {
  setGroundRelief("earth", null);
  setWorldRunways([]);
  resetFlights();
});

const D = Math.PI / 180;
/** SFO's ground over the ellipsoid [m]: 4 m over the sea, the geoid 32 m under the ellipsoid there */
const GROUND = -28;
/** a world runway's frame as world/runways3d.ts makes it (its le threshold, its heading, length, half width) */
function worldFrame(field: string, le: string, he: string, lat1: number, lon1: number, hdg: number, len: number, wid: number): RunwayFrame {
  const f = runwayFrame(
    { body: "earth", name: `${field} ${le}`, lat: lat1, lon: lon1, runway: true, rwy: hdg, des: [le, he], icao: field, elev: 4 },
    len,
    wid / 2,
    16 | 32,
  );
  f.world = { field, measuring: false };
  return f;
}
/** KSFO's four runways (OurAirports, assets/runways/v1/t7_-25.json) */
const SFO: RunwayFrame[] = [
  worldFrame("KSFO", "10L", "28R", 37.62874, -122.39341, 117.79, 3618, 61),
  worldFrame("KSFO", "10R", "28L", 37.6263, -122.39312, 117.8, 3469, 61),
  worldFrame("KSFO", "1L", "19R", 37.6079, -122.38295, 27.81, 2331, 61),
  worldFrame("KSFO", "1R", "19L", 37.60633, -122.38106, 27.81, 2638, 61),
];
const way = (key: string): Way => SFO.flatMap(waysOf).find((w) => w.key === key)!;
/** landing 28L: the far (east) end of 10R/28L, westwards */
const W28L = way("KSFO:KSFO 10R<");
/** taking off from 01R: its le end, north-north-east */
const W01R = way("KSFO:KSFO 1R>");

/** a place `a` [m] past a way's threshold, `c` [m] right of its axis */
function at(w: Way, a: number, c: number) {
  const q = [0, 1, 2].map((k) => w.o[k]! + w.d[k]! * a + w.r[k]! * c) as [number, number, number];
  const g = cartToGeodetic(WGS84_A, WGS84_F, q);
  return { lat: g.lat / D, lon: g.lon / D };
}
/** a place's distance past a way's threshold and right of its axis [m] */
function onWay(w: Way, lat: number, lon: number) {
  const q = geodeticToCart(WGS84_A, WGS84_F, lat * D, lon * D, 0);
  const v = [q[0] - w.o[0], q[1] - w.o[1], q[2] - w.o[2]];
  return { a: v[0]! * w.d[0] + v[1]! * w.d[1] + v[2]! * w.d[2], c: v[0]! * w.r[0] + v[1]! * w.r[1] + v[2]! * w.r[2] };
}
/** a velocity east, north [m/s] along a way's heading */
const along = (w: Way, gs: number) => ({ ve: gs * Math.sin(w.hdg * D), vn: gs * Math.cos(w.hdg * D) });
const glide3 = (x: number) => Math.max(0, x) * Math.tan(3 * D);

describe("the owner: a runway, a phase, a gear (pure)", () => {
  test("landing on 28L, 35 m off its axis, 25 m high: on its axis low down, on its glide, its wheels on the runway at touchdown", () => {
    const rows: string[] = [];
    let prev: TrafficPhase | null = null;
    for (const a of [-8000, -4000, -2500, -1500, -800, -300, 0, 150, 300]) {
      const P = at(W28L, a, 35);
      const x = 300 - a;
      const o = runwayPlace({ ...P, over: glide3(x) + 25, gnd: false, ...along(W28L, 70), vu: -3.7, acc: 0 }, SFO, prev);
      const w = onWay(W28L, o.lat, o.lon);
      rows.push(
        `a ${a}: ${o.phase}, off ${w.c.toFixed(1)} m (pull ${o.wLat.toFixed(2)}), over ${o.over.toFixed(1)} m (glide ${glide3(x).toFixed(1)})`,
      );
      prev = o.phase;
      expect(o.rwy?.way.key).toBe(W28L.key);
      expect(o.phase === "approach" || o.phase === "landing").toBe(true);
      expect(gearTarget(null, o.phase, o.over, o.vu)).toBe(1);
      // (far out: as reported; the last 1.5 km to its touchdown: its glide, flared)
      if (a <= -8000) {
        expect(Math.abs(w.c - 35)).toBeLessThan(1);
        expect(o.over).toBeCloseTo(glide3(x) + 25, 3);
      }
      if (a >= -800) expect(Math.abs(w.c)).toBeLessThan(0.5);
      if (x <= RUNWAY_PHASE.glideFull) expect(o.over).toBeLessThanOrEqual(glide3(x) + 0.01);
      if (a >= 300) {
        expect(o.gnd).toBe(true);
        expect(o.over).toBe(0);
      }
    }
    console.log(`  ${rows.join("\n  ")}`);
  });

  test("rolled out on 28L, its report still « airborne » 12 m up, level: on the runway, landing", () => {
    const P = at(W28L, 1200, 8);
    const o = runwayPlace({ ...P, over: 12, gnd: false, ...along(W28L, 50), vu: 0, acc: -2 }, SFO, "approach");
    expect(o.gnd).toBe(true);
    expect(o.over).toBe(0);
    expect(o.phase).toBe("landing");
    expect(Math.abs(onWay(W28L, o.lat, o.lon).c)).toBeLessThan(0.5);
  });

  test("the take-off roll on 01R, 15 m off its axis: on its axis, taking off, gear down; up past 150 m climbing, down never in cruise", () => {
    const P = at(W01R, 900, 15);
    const o = runwayPlace({ ...P, over: 0, gnd: true, ...along(W01R, 60), vu: 0, acc: 2 }, SFO, "taxi");
    expect(o.phase).toBe("takeoff");
    expect(Math.abs(onWay(W01R, o.lat, o.lon).c)).toBeLessThan(0.5);
    expect(gearTarget(1, o.phase, 0, 0)).toBe(1);
    // (climbing out: down to 150 m, up past it; a level-off low keeps it as it was; cruise: up)
    expect(gearTarget(1, "climb", 100, 8)).toBe(1);
    expect(gearTarget(1, "climb", 200, 8)).toBe(0);
    expect(gearTarget(0, "cruise", 400, 0)).toBe(0);
    expect(gearTarget(null, "cruise", 10_000, 0)).toBe(0);
    expect(gearTarget(1, "cruise", 10_000, 0)).toBe(0);
    // (descending low: down; descending high: as it was)
    expect(gearTarget(0, "descent", 550, -4)).toBe(1);
    expect(gearTarget(0, "descent", 1200, -4)).toBe(0);
  });

  test("the gear's travel: GEAR.travel seconds, never past its ends", () => {
    expect(gearStep(1, 0, GEAR.travel / 2)).toBeCloseTo(0.5, 6);
    expect(gearStep(0.5, 0, GEAR.travel)).toBe(0);
    expect(gearStep(0.9, 1, 5)).toBe(1);
    expect(gearStep(0.3, 1, -1)).toBe(0.3);
  });

  test("left alone: a helicopter by the runway, an aircraft over the bay beside the final, one crossing the field", () => {
    // (a helicopter 20 m off 28L's axis, 30 m up, along it)
    const H = at(W28L, 500, 20);
    const h = runwayPlace({ ...H, over: 30, gnd: false, ...along(W28L, 10), vu: 0, acc: 0, rotor: true }, SFO);
    expect(h.phase).toBe("rotor");
    expect([h.lat, h.lon, h.over]).toEqual([H.lat, H.lon, 30]);
    // (over the bay 2 km short of 28L, 600 m north of its final — right of the way landing west —, descending)
    const S = at(W28L, -2000, 600);
    const s = runwayPlace({ ...S, over: 250, gnd: false, ...along(W28L, 75), vu: -3, acc: 0 }, SFO);
    const sw = onWay(W28L, s.lat, s.lon);
    expect(s.wLat).toBe(0);
    expect(s.wV).toBe(0);
    expect(Math.abs(sw.c - 600)).toBeLessThan(0.01);
    expect(s.over).toBe(250);
    // (crossing the field at 100 m, its track 40° off the runways')
    const X = at(W28L, 1500, 0);
    const x = runwayPlace({ ...X, over: 100, gnd: false, ve: 80 * Math.sin(337.8 * D), vn: 80 * Math.cos(337.8 * D), vu: 0, acc: 0 }, SFO);
    expect(x.rwy).toBeNull();
    expect([x.lat, x.lon, x.over]).toEqual([X.lat, X.lon, 100]);
    // (taxiing on a parallel taxiway 180 m south of 28L, along it: not pulled onto the runway)
    const T = at(W28L, 1500, -180);
    expect(runwayPlace({ ...T, over: 0, gnd: true, ...along(W28L, 10), vu: 0, acc: 0 }, SFO).wLat).toBe(0);
    // (a matching runway none: no runways near)
    expect(matchRunway(S.lat, S.lon, W28L.hdg, 75, false, [])).toBeNull();
  });
});

/** a feed of hand-made aircraft (their reports in time's order) for the controller */
function feedOf(planes: Plane[][]): TrafficFeed {
  const m = new Map(planes.map((h) => [h[0]!.id, { p: h.at(-1)!, prev: h.at(-2) ?? null, hist: h, heard: 1e12 }]));
  return { planes: m, ships: new Map(), status: "live", credit: {}, attribution: [] } as unknown as TrafficFeed;
}
const T0 = 1_800_000_000;
const report = (o: Partial<Plane>): Plane => ({
  id: "a1b2c3",
  cs: "TST1",
  reg: "N1TS",
  type: "A320",
  cat: "A3",
  lat: 0,
  lon: 0,
  alt: 0,
  gs: 0,
  trk: 0,
  hdg: null,
  vs: 0,
  roll: null,
  gnd: false,
  t: T0,
  src: "adsb.lol",
  ...o,
});

/** the controller drawing `planes` a minute behind from `t0` to `t1` [s] every `dt`: each frame's craft `id` */
function fly(planes: Plane[][], id: string, t0: number, t1: number, dt = 0.1) {
  setGroundRelief("earth", () => GROUND);
  setWorldRunways(SFO);
  // (a free camera over the bay, 600 m up: SFO in view)
  const { c } = overPlace("earth", 37.62, -122.33, 0.6, true);
  c.setPilot(false);
  c.s.trafficDelay = 60;
  c.traffic = feedOf(planes);
  let now = t0 + 60;
  c.trafficClock = () => now;
  const frames: { t: number; k: ReturnType<typeof c.trafficNow>[number]; h: number; lat: number; lon: number }[] = [];
  for (; now <= t1 + 60; now += dt) {
    const k = c.trafficNow().find((x) => x.id === id)!;
    const g = cartToGeodetic(WGS84_A, WGS84_F, k.p as [number, number, number]);
    frames.push({ t: now - 60, k, h: g.h, lat: g.lat / D, lon: g.lon / D });
  }
  return { c, frames };
}
/** the A320's wheels under its plain mesh's origin [m] (game/airtypes.ts MESH.a320t: 3.9 m at 37.7 m) */
const WHEELS = (3.9 * 37.6) / 37.7;

describe("drawn by the controller (controller/traffic.ts), a minute behind", () => {
  test("an approach to 28L 35 m off and 25 m high, reported every 2 s: on its axis, down onto the runway, no jump, gear down", () => {
    // (a 3° final from 8 km, 70 m/s, its touchdown 300 m past the threshold — reported « ground » only from 700 m on —, its
    // rollout braking 2 m/s² to 15 m/s by 2 700 m)
    const hist: Plane[] = [];
    let t = T0;
    for (let a = -8000; a < 2700; ) {
      const air = a < 700;
      const gs = a < 300 ? 70 : Math.max(15, Math.sqrt(Math.max(0, 70 * 70 - 2 * 2 * (a - 300))));
      const P = at(W28L, a, 35);
      hist.push(
        report({ ...P, alt: GROUND + WHEELS + (air ? glide3(300 - a) + 25 : 0), gs, trk: W28L.hdg, vs: a < 300 ? -3.67 : 0, gnd: !air, t }),
      );
      a += gs * 2;
      t += 2;
    }
    const { frames } = fly([hist], "a1b2c3", T0 + 30, t - 4);
    expect(frames.every((F) => Number.isFinite(F.h))).toBe(true);
    let jump = 0,
      low = 1e9,
      offLow = 0,
      offRoll = 0,
      tdA = Number.NaN,
      gearLow = 1;
    const phases = new Set<string>();
    for (let i = 0; i < frames.length; i++) {
      const F = frames[i]!;
      const w = onWay(W28L, F.lat, F.lon);
      phases.add(F.k.phase);
      low = Math.min(low, F.h - GROUND);
      if (F.k.over < 300) gearLow = Math.min(gearLow, F.k.gear);
      if (F.h - GROUND < WHEELS + 15 && w.a > -800) offLow = Math.max(offLow, Math.abs(w.c));
      if (F.k.gnd) {
        offRoll = Math.max(offRoll, Math.abs(w.c));
        if (Number.isNaN(tdA)) tdA = w.a;
      }
      if (i > 0) {
        const P0 = frames[i - 1]!.k.p,
          P1 = F.k.p;
        const step = Math.hypot(P1[0]! - P0[0]!, P1[1]! - P0[1]!, P1[2]! - P0[2]!);
        jump = Math.max(jump, step - Math.hypot(...F.k.v) * 0.1);
      }
    }
    console.log(
      `  ${frames.length} frames: phases ${[...phases].join(" → ")}; its origin ${low.toFixed(2)} m over the ground at lowest (wheels ${WHEELS.toFixed(2)}); ` +
        `within ${offLow.toFixed(2)} m of the axis the last 15 m down, ${offRoll.toFixed(2)} m rolling; touchdown ${tdA.toFixed(0)} m past the threshold; ` +
        `a frame's step ${jump.toFixed(2)} m past its speed's at most; the gear under 300 m ${gearLow.toFixed(2)} at least`,
    );
    expect(low).toBeGreaterThan(WHEELS - 0.05);
    expect(offLow).toBeLessThan(2);
    expect(offRoll).toBeLessThan(0.5);
    expect(tdA).toBeGreaterThan(150);
    expect(tdA).toBeLessThan(750);
    expect(jump).toBeLessThan(1);
    expect(gearLow).toBe(1);
    expect(phases.has("approach")).toBe(true);
    expect(phases.has("landing")).toBe(true);
  });

  test("a take-off from 01R 15 m off its axis, its climb 20 m high: on its axis rolling, its gear up past 150 m, moved over its travel", () => {
    const hist: Plane[] = [];
    let t = T0,
      a = 0,
      gs = 5,
      h = 0;
    // (the roll: 2 m/s² from its threshold; lift-off at 75 m/s; the climb 8 m/s, reported 20 m high — a report every 3 s)
    for (let k = 0; h < 900; k++) {
      const air = gs >= 75;
      if (k % 6 === 0) {
        const P = at(W01R, a, 15);
        hist.push(
          report({ id: "d4e5f6", ...P, alt: GROUND + WHEELS + (air ? h + 20 : 0), gs, trk: W01R.hdg, vs: air ? 8 : 0, gnd: !air, t }),
        );
      }
      a += gs * 0.5;
      if (air) h += 4;
      else gs = Math.min(75, gs + 1);
      t += 0.5;
    }
    const { frames } = fly([hist], "d4e5f6", T0 + 10, t - 3);
    let offRoll = 0,
      offClimb = 0,
      low = 1e9,
      upAt = Number.NaN,
      wantedUp = Number.NaN,
      jump = 0;
    const phases = new Set<string>();
    for (let i = 0; i < frames.length; i++) {
      const F = frames[i]!;
      phases.add(F.k.phase);
      low = Math.min(low, F.h - GROUND);
      if (F.k.gnd) offRoll = Math.max(offRoll, Math.abs(onWay(W01R, F.lat, F.lon).c));
      // (lifted off, low: still on its axis)
      else if (F.k.over < 100) offClimb = Math.max(offClimb, Math.abs(onWay(W01R, F.lat, F.lon).c));
      if (F.k.gearWanted === 0 && Number.isNaN(wantedUp)) {
        wantedUp = F.t;
        expect(F.k.over).toBeGreaterThan(GEAR.up);
        expect(F.k.gear).toBeGreaterThan(0.95);
      }
      if (F.k.over < GEAR.up && !F.k.gnd) expect(F.k.gear).toBe(1);
      if (F.k.gear === 0 && Number.isNaN(upAt)) upAt = F.t;
      if (i > 0) {
        const P0 = frames[i - 1]!.k.p,
          P1 = F.k.p;
        jump = Math.max(jump, Math.hypot(P1[0]! - P0[0]!, P1[1]! - P0[1]!, P1[2]! - P0[2]!) - Math.hypot(...F.k.v) * 0.1);
      }
    }
    console.log(
      `  phases ${[...phases].join(" → ")}; within ${offRoll.toFixed(2)} m of the axis rolling, ${offClimb.toFixed(2)} m climbing under 100 m; its origin ${low.toFixed(2)} m over the ground at lowest; ` +
        `gear wanted up at ${(wantedUp - T0).toFixed(1)} s, up at ${(upAt - T0).toFixed(1)} s; a frame's step ${jump.toFixed(2)} m past its speed's at most`,
    );
    expect(phases.has("takeoff")).toBe(true);
    expect(phases.has("climb")).toBe(true);
    expect(offRoll).toBeLessThan(0.5);
    expect(offClimb).toBeLessThan(3);
    expect(low).toBeGreaterThan(WHEELS - 0.05);
    expect(upAt - wantedUp).toBeGreaterThan(GEAR.travel - 0.3);
    expect(upAt - wantedUp).toBeLessThan(GEAR.travel + 0.3);
    expect(jump).toBeLessThan(1);
  });

  test("N796UA parked at SFO, alt_baro −200 ft: on the ground — its wheels on the world's, not under it —, parked, gear down", async () => {
    const raw = fromAdsbLol(
      {
        hex: "aad012",
        flight: "UA1",
        r: "N796UA",
        t: "B772",
        category: "A5",
        lat: 37.6152,
        lon: -122.39,
        track: 280,
        gs: 0.7,
        alt_baro: -200,
      },
      T0,
    )!;
    const F = new TrafficFeed(
      () => "http://relay",
      async () => new Response(JSON.stringify({ planes: [raw], attribution: "test" })),
      () => true,
      () => GROUND,
    );
    F.tick(0, { lat: 37.6152, lon: -122.39 }, true);
    for (let i = 0; i < 20 && !F.planes.size; i++) await Bun.sleep(1);
    const p = F.planes.get("aad012")!.p;
    expect(p.gnd).toBe(true);
    const later = { ...p, t: T0 + 15 };
    const { frames } = fly([[p, later]], "aad012", T0 + 2, T0 + 10, 1);
    const k = frames.at(-1)!;
    // (its wheels under its plain mesh's origin: a 777's, 63.7 m long)
    const wheels = (3.9 * k.k.len) / 37.7;
    console.log(
      `  N796UA: reported ${(-200 * 0.3048).toFixed(0)} m baro; drawn ${k.h.toFixed(2)} m over the ellipsoid, the ground at ${GROUND} m, its wheels ${wheels.toFixed(2)} m under its origin — ${k.k.phase}, gear ${k.k.gear}`,
    );
    expect(k.k.gnd).toBe(true);
    expect(k.h - GROUND).toBeCloseTo(wheels, 1);
    expect(k.k.phase).toBe("parked");
    expect(k.k.gear).toBe(1);
  });

  test("UAL2623 on short final to 28L at −17 m over the ellipsoid (campaign 2, kerr-mini): flying, over the runway, gear down, labelled over the sea; at −60 m: not under the ground", async () => {
    for (const [h, id] of [
      [-17, "a0c017"],
      [-60, "a0c060"],
    ] as const) {
      // (its two last reports, 250 m then 110 m short of the threshold, 140 kt, −700 ft/min, its geometric height h)
      const reps: Plane[] = [];
      for (const [k, a] of [
        [0, -250],
        [1, -110],
      ] as const) {
        const P = at(W28L, a, 20);
        const raw = fromAdsbLol(
          {
            hex: id,
            flight: "UAL2623",
            r: "N27266",
            t: "B38M",
            category: "A3",
            lat: P.lat,
            lon: P.lon,
            track: W28L.hdg,
            gs: 140,
            alt_baro: 25,
            alt_geom: (h - 2 * k) / 0.3048,
            geom_rate: -700,
          },
          T0 + 2 * k,
        )!;
        const F = new TrafficFeed(
          () => "http://relay",
          async () => new Response(JSON.stringify({ planes: [raw], attribution: "test" })),
          () => true,
          () => GROUND,
        );
        F.tick(0, P, true);
        for (let i = 0; i < 20 && !F.planes.size; i++) await Bun.sleep(1);
        reps.push(F.planes.get(id)!.p);
      }
      expect(reps.every((p) => !p.gnd)).toBe(true);
      const { frames, c } = fly([reps], id, T0 + 0.5, T0 + 1.5, 0.25);
      const F = frames.at(-1)!;
      const wheels = (3.9 * F.k.len) / 37.7;
      const mark = c.trafficOverlay((m) => `${m.toFixed(0)} m`, c).find((x) => x.id === id);
      console.log(
        `  reported ${h} m over the ellipsoid (the ground at ${GROUND} m): drawn ${F.h.toFixed(1)} m — its wheels ${(F.h - GROUND - wheels).toFixed(1)} m over the runway, ${F.k.phase}, gear ${F.k.gear}; label « ${mark?.label} »`,
      );
      expect(F.k.gnd).toBe(false);
      expect(F.h - GROUND).toBeGreaterThan(wheels - 0.05);
      expect(F.k.phase === "approach" || F.k.phase === "landing").toBe(true);
      expect(F.k.gear).toBe(1);
      expect(F.k.msl).toBeCloseTo(F.k.alt - geoidDeg(F.lat, F.lon), 3);
      // (its label at the moment drawn: its height over the sea, not the ellipsoid's)
      const now = c.trafficNow().find((x) => x.id === id)!;
      expect(mark?.label).toContain(`${now.msl.toFixed(0)} m`);
    }
  });

  test("the rig near the view: the A320's gear as its phase wants it; at most TRAFFIC_RIG.max rigged", () => {
    const { frames } = fly(
      [
        [
          report({ id: "b7c8d9", ...at(W28L, -3000, 0), alt: GROUND + WHEELS + 3000, gs: 200, trk: W28L.hdg, vs: 0 }),
          report({
            id: "b7c8d9",
            ...at(W28L, -3000 + 200 * 15, 0),
            alt: GROUND + WHEELS + 3000,
            gs: 200,
            trk: W28L.hdg,
            vs: 0,
            t: T0 + 15,
          }),
        ],
      ],
      "b7c8d9",
      T0 + 5,
      T0 + 6,
    );
    const k = frames.at(-1)!.k;
    expect(k.phase).toBe("cruise");
    expect(k.gearWanted).toBe(0);
    const R = trafficRig(k, T0 + 100).props;
    expect(Number(R["gear/gear[0]/position-norm"])).toBe(0);
    expect(TRAFFIC_RIG.max).toBeLessThanOrEqual(4);
  });
});
