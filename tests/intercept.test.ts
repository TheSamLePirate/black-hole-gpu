import { afterEach, describe, expect, test } from "bun:test";
import { collisionTime, interceptCues } from "../src/game/intercept";
import type { RadarFix } from "../src/controller/radar";
import { ourGroundPoseOn } from "../src/game/place";
import { SCENARIOS } from "../src/game/scenarios";
import { add, scale } from "../src/math/vec3";
import { groundVelocity } from "../src/system/our-surface";
import { C_MPS, M_METRES } from "../src/units";
import { cruise } from "./helpers/envelope";
import { flight, resetFlights } from "./helpers/flight";

// The intercept (docs/PLAN-AVIATION-AAA.md, C2; game/intercept.ts, controller/intercept.ts): the cues on the
// radar's lock; the INTERCEPT autopilot from 80 km — head on, crossing, from behind — to the shadow 300 m behind
// an airliner on its left, held; a drone turning in its orbit, shadowed too.

afterEach(resetFlights);

const D = Math.PI / 180;

describe("the intercept's cues", () => {
  test("the collision: a target crossing at 230 m/s met at 300 m/s; one that outruns us, never", () => {
    const t = collisionTime([0, 30_000, 0], [230, 0, 0], 300)!;
    // (|(230 t, 30000)| = 300 t)
    expect(t).toBeCloseTo(30_000 / Math.sqrt(300 ** 2 - 230 ** 2), 3);
    expect(collisionTime([0, 30_000, 0], [0, 400, 0], 300)).toBeNull();
  });

  test("the aspect: 180° head on, 0° behind it, 90° abeam on its left; the pursuit lead, pure, lag", () => {
    // (it 40 km north flying south; we fly north at 250)
    const head = interceptCues([0, 40_000, 0], [0, -230, 0], [0, 250, 0]);
    expect(head.aspect).toBeCloseTo(180, 0);
    expect(head.tti).toBeCloseTo(40_000 / 480, 1);
    expect(head.pursuit).toBe("PURE");
    // (it 20 km north flying north: behind it)
    expect(interceptCues([0, 20_000, 0], [0, 230, 0], [0, 250, 0]).aspect).toBeCloseTo(0, 0);
    // (it 20 km north flying east: we are on its right — south of an eastbound track — abeam)
    const beam = interceptCues([0, 20_000, 0], [230, 0, 0], [0, 250, 0]);
    expect(beam.aspect).toBeCloseTo(90, 0);
    expect(beam.side).toBe("R");
    // (we fly north-east, ahead of its line of sight where it goes: lead; north-west: lag)
    expect(interceptCues([0, 20_000, 0], [230, 0, 0], [150, 200, 0]).pursuit).toBe("LEAD");
    expect(interceptCues([0, 20_000, 0], [230, 0, 0], [-150, 200, 0]).pursuit).toBe("LAG");
    expect(beam.collHdg! / D).toBeGreaterThan(0);
  });
});

/** An airliner for the radar (the source "tst"): from the craft's place at the start `along` east and `across`
 *  north [m] and `dh` higher, flying `hdg` [°] at `v` [m/s], level over the curved Earth. */
function airliner(c: ReturnType<typeof cruise>["c"], at: { e: number; n: number; dh: number; hdg: number; v: number }) {
  const fix0 = c.radarFix()!;
  const R = Math.hypot(...fix0.p) + at.dh;
  const p0 = [0, 1, 2].map((k) => fix0.p[k]! + fix0.E[k]! * at.e + fix0.N[k]! * at.n);
  const u0 = p0.map((x) => x / Math.hypot(...p0));
  const pos0 = u0.map((x) => x * R);
  // (its way, flat at its start; along the great circle: its place turned about the axis ⟂ to both)
  const E0 = [-u0[1]!, u0[0]!, 0].map((x, _, a) => x / Math.hypot(a[0]!, a[1]!));
  const N0 = [u0[1]! * E0[2]! - u0[2]! * E0[1]!, u0[2]! * E0[0]! - u0[0]! * E0[2]!, u0[0]! * E0[1]! - u0[1]! * E0[0]!];
  const w = [0, 1, 2].map((k) => Math.sin(at.hdg * D) * E0[k]! + Math.cos(at.hdg * D) * N0[k]!);
  const t0 = c.radarT;
  const truth = () => {
    const a = (at.v * (c.radarT - t0)) / R;
    const p = [0, 1, 2].map((k) => Math.cos(a) * pos0[k]! + Math.sin(a) * R * w[k]!);
    const v = [0, 1, 2].map((k) => at.v * (-Math.sin(a) * u0[k]! + Math.cos(a) * w[k]!));
    return { p, v };
  };
  c.radarSources.set("tst", (fix: RadarFix) => {
    const { p, v } = truth();
    const r = fix.toLocal(p as [number, number, number]);
    const d = (x: number[], y: number[]) => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!;
    return [
      {
        id: "tst:1",
        r,
        v: [d(v, fix.E), d(v, fix.N), d(v, fix.U)],
        rcs: 60,
        kind: "air",
        iff: "neutral",
        name: "AFR123",
        squawk: true,
      },
    ];
  });
  return truth;
}

/** Our F-35 at 9 km, 240 m/s east; an airliner `at`; locked and intercepted. The time to the shadow [s], the
 *  slot held after (its worst [m]), what was said. */
function intercept(at: { e: number; n: number; dh: number; hdg: number; v: number }) {
  const { c, fly, msgs } = cruise(9000, 240, 0.8);
  c.jetToggle("ap");
  c.jetToggle("athr");
  const truth = airliner(c, at);
  fly(2.5);
  const said = c.icptStart();
  const t = fly(900, () => c.icpt?.phase === "shadow");
  let worst = 0;
  const phase0 = c.icpt?.phase;
  // (settled for 10 s, then held for a minute)
  fly(10);
  fly(60, () => {
    worst = Math.max(worst, c.icpt?.last?.dist ?? Infinity);
    return !c.icpt;
  });
  // (behind it on its left: the truth's frame)
  const o = c.netOwn()!;
  const T = truth();
  const rel = [0, 1, 2].map((k) => o.p[k]! - T.p[k]!);
  const up = T.p.map((x) => x / Math.hypot(...T.p));
  const f = T.v.map((x) => x / Math.hypot(...T.v));
  const right = [f[1]! * up[2]! - f[2]! * up[1]!, f[2]! * up[0]! - f[0]! * up[2]!, f[0]! * up[1]! - f[1]! * up[0]!];
  const d = (x: number[], y: number[]) => x[0]! * y[0]! + x[1]! * y[1]! + x[2]! * y[2]!;
  return { c, said, t, phase0, worst, behind: -d(rel, f), left: -d(rel, right), above: d(rel, up), msgs };
}

describe("the INTERCEPT autopilot", () => {
  for (const [name, at] of [
    ["head on, 80 km", { e: 80_000, n: 0, dh: 1500, hdg: 270, v: 230 }],
    // (crossing ahead from right to left: 75 km east, 30 km south, flying north — its beam on us)
    ["crossing, 80 km", { e: 75_000, n: -30_000, dh: 1500, hdg: 0, v: 230 }],
    ["from behind, 60 km", { e: 60_000, n: 0, dh: 1500, hdg: 90, v: 230 }],
  ] as const)
    test(`${name}: the run, the rejoin, the shadow 300 m behind on its left — held`, () => {
      const r = intercept(at);
      console.log(
        `  ${r.said} → shadow in ${r.t.toFixed(0)} s; then ${r.behind.toFixed(0)} m behind, ${r.left.toFixed(0)} m left, ${r.above.toFixed(0)} m above; worst ${r.worst.toFixed(0)} m`,
      );
      expect(r.said).toContain("AFR123");
      expect(r.phase0).toBe("shadow");
      expect(r.t).toBeLessThan(900);
      expect(r.worst).toBeLessThan(40);
      expect(r.behind).toBeGreaterThan(200);
      expect(r.behind).toBeLessThan(400);
      expect(r.left).toBeGreaterThan(20);
      expect(Math.abs(r.above)).toBeLessThan(60);
      // (identified by eye: the IFF known)
      expect(r.c.radar.tracks.get("tst:1")?.iff).toBe("neutral");
    }, 120_000);

  test("the drone hunt's BQM-1, turning in its 5 km orbit: pursued, shadowed, held", () => {
    const sc = SCENARIOS.find((x) => x.id === "drones")!;
    const lat = sc.anchor.lat + sc.start.n / (D * 6_371_008.8);
    const lon = sc.anchor.lon + sc.start.e / (D * 6_371_008.8 * Math.cos(sc.anchor.lat * D));
    const g = ourGroundPoseOn("earth", lat, lon, 0, null, sc.start.hdg);
    const X = add(g.X, scale(g.up, (sc.start.agl + 800) / M_METRES));
    const { c, fly } = flight(
      { ...g, X, vel: add(groundVelocity("earth", X, 0), scale(g.fwd, sc.start.speed / C_MPS)), landed: undefined },
      false,
      "f35",
    );
    c.s.flightMode = "plane";
    c.pilot.throttle = c.pilot.engineNow = 0.85;
    fly(0.5);
    c.combatStart(sc);
    fly(0.3);
    c.combatTrigger("lock");
    c.jetToggle("ap");
    c.jetToggle("athr");
    const said = c.icptStart();
    const t = fly(600, () => c.icpt?.phase === "shadow");
    fly(10);
    let worst = 0;
    fly(60, () => ((worst = Math.max(worst, c.icpt?.last?.dist ?? Infinity)), !c.icpt));
    console.log(`  ${said} → shadow in ${t.toFixed(0)} s; held within ${worst.toFixed(0)} m in its turn`);
    expect(c.icpt?.phase).toBe("shadow");
    expect(t).toBeLessThan(600);
    expect(worst).toBeLessThan(60);
  }, 120_000);
});
