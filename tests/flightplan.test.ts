import { expect, test } from "bun:test";
import { bingo, crossTrack, fuelPlan, gcCourse, gcDest, gcDist, Lnav, newPlan, vnav, type FlightPlan } from "../src/game/flightplan";

const D = Math.PI / 180;

test("great circles: Paris to New York's distance and course, a point along, the cross-track", () => {
  const cdg = { lat: 49.0097, lon: 2.5479 },
    jfk = { lat: 40.6413, lon: -73.7781 };
  expect(gcDist(cdg, jfk) / 1000).toBeCloseTo(5837, -1);
  expect(gcCourse(cdg, jfk) / D).toBeCloseTo(291.8, 0);
  const mid = gcDest(cdg, gcCourse(cdg, jfk), 1_000_000);
  expect(Math.abs(crossTrack(cdg, jfk, mid).xtk)).toBeLessThan(5);
  expect(crossTrack(cdg, jfk, mid).atd / 1000).toBeCloseTo(1000, 0);
  // (north of a westbound course: right of it)
  const off = { lat: mid.lat + 0.1, lon: mid.lon };
  expect(crossTrack(cdg, jfk, off).xtk).toBeGreaterThan(5000);
});

/** A plane flown by the guidance: it turns banked 25° at most towards the heading asked, at an airspeed. */
function fly(plan: FlightPlan, start: { lat: number; lon: number }, hdg0: number, gs: number, wind = { e: 0, n: 0 }, tMax = 4000) {
  const L = new Lnav(plan);
  let p = { ...start },
    hdg = hdg0;
  let maxX = 0;
  const seq: number[] = [];
  let t = 0,
    lastSeq = -1e9;
  const rate = (9.80665 * Math.tan(25 * D)) / gs;
  for (; t < tMax; t++) {
    // (the track: the heading's air velocity plus the wind)
    const ve = gs * Math.sin(hdg) + wind.e,
      vn = gs * Math.cos(hdg) + wind.n;
    const track = Math.atan2(ve, vn);
    const o = L.step(p, Math.hypot(ve, vn), track, hdg)!;
    if (o.passed >= 0) {
      seq.push(o.passed);
      lastSeq = t;
    }
    if (o.done) break;
    // (off the leg's line in the turns, by design: measured once on the leg)
    if (t > 300 && t - lastSeq > 120) maxX = Math.max(maxX, Math.abs(o.xtk));
    const dh = Math.atan2(Math.sin(o.hdg - hdg), Math.cos(o.hdg - hdg));
    hdg += Math.max(-rate, Math.min(rate, dh));
    p = gcDest(p, track, Math.hypot(ve, vn));
  }
  return { seq, maxX, t, end: p };
}

test("LNAV: a dog-leg flown, each point sequenced, the legs held within a few hundred metres", () => {
  const plan = newPlan();
  plan.wps = [
    { name: "KEDW", lat: 34.905, lon: -117.884 },
    { name: "WP01", lat: 35.4, lon: -117.3 },
    { name: "WP02", lat: 35.9, lon: -118.1 },
    { name: "WP03", lat: 35.2, lon: -118.6 },
  ];
  const r = fly(plan, plan.wps[0]!, 90 * D, 220);
  expect(r.seq).toEqual([1, 2]);
  expect(gcDist(r.end, plan.wps[3]!)).toBeLessThan(400);
  console.log(`  ${r.t} s, max cross-track ${r.maxX.toFixed(0)} m`);
  expect(r.maxX).toBeLessThan(800);
  // (a crosswind of 30 m/s: the drift corrected)
  const w = fly(plan, plan.wps[0]!, 45 * D, 220, { e: 0, n: 30 });
  expect(w.seq).toEqual([1, 2]);
  expect(gcDist(w.end, plan.wps[3]!)).toBeLessThan(400);
});

test("VNAV: the climb to the level, the descent's top ahead of a low constraint, the 3° path", () => {
  const plan = newPlan();
  plan.cruiseAlt = 9000;
  plan.wps = [
    { name: "A", lat: 35, lon: -118, field: { elev: 700 } },
    { name: "B", lat: 35, lon: -116 },
    { name: "C", lat: 35, lon: -114, alt: 3000 },
  ];
  const dAB = gcDist(plan.wps[0]!, plan.wps[1]!);
  // (just off the field: climbing to the level)
  const c = vnav(plan, 1, dAB - 5000, 1500, 200)!;
  expect(c.phase).toBe("climb");
  expect(c.alt).toBe(9000);
  // (the top of descent: 6000 m to lose at 3° — 114.5 km before C)
  const dBC = gcDist(plan.wps[1]!, plan.wps[2]!);
  const tod = 6000 / Math.tan(3 * D);
  const v = vnav(plan, 2, dBC, 9000, 220)!;
  expect(v.tod).toBeCloseTo(dBC - tod, -2);
  // (past it: on the path, descending)
  const d = vnav(plan, 2, tod - 20_000, 9000, 220)!;
  expect(d.phase).toBe("descent");
  expect(d.alt).toBeCloseTo(3000 + (tod - 20_000) * Math.tan(3 * D), 0);
  expect(d.vs).toBeLessThan(-11);
});

test("fuel: the legs' burn summed, the bingo home with its reserve", () => {
  const plan = newPlan();
  plan.wps = [
    { name: "A", lat: 35, lon: -118 },
    { name: "B", lat: 35, lon: -117 },
    { name: "C", lat: 36, lon: -117 },
  ];
  const burn = () => 1; // 1 kg/s
  const f = fuelPlan(plan, burn);
  expect(f.legs.length).toBe(2);
  expect(f.fuel).toBeCloseTo((gcDist(plan.wps[0]!, plan.wps[1]!) + gcDist(plan.wps[1]!, plan.wps[2]!)) / plan.cruiseSpd, 0);
  expect(bingo(plan, plan.wps[0]!, burn)).toBeCloseTo(gcDist(plan.wps[0]!, plan.wps[2]!) / plan.cruiseSpd + plan.reserveKg, 0);
});

test("the F-35's cruise: its burn at the level and speed of a ferry flight, its best near the tropopause", async () => {
  const { cruiseBurn } = await import("../src/f35/cruise");
  const hi = cruiseBurn(10_000, 240),
    lo = cruiseBurn(300, 240);
  console.log(`  ${(hi * 3600).toFixed(0)} kg/h at FL330, ${(lo * 3600).toFixed(0)} kg/h low`);
  expect(hi * 3600).toBeGreaterThan(900);
  expect(hi * 3600).toBeLessThan(2600);
  expect(lo).toBeGreaterThan(hi * 1.3);
});
