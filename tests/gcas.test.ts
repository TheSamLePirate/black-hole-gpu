import { afterEach, expect, test } from "bun:test";
import { gcasForget } from "../src/controller/gcas";
import { ACAS, acasConflict, GCAS, gcasMargin, gcasRecovery } from "../src/game/gcas";
import { setGroundHeights } from "../src/system/our-surface";
import { cruise, withStick } from "./helpers/envelope";
import { resetFlights } from "./helpers/flight";

// PLAN-AVIATION-AAA A2: the F-35's Auto-GCAS — the recovery foreseen (the roll, the 5 g pull) over the ground, taken
// at the last moment and given back —: a dive held into the sea, the stick pushed all the way; the same on its back;
// a ridge ahead in level flight; with the protection off, the same dive into the sea. The Auto-ACAS: an aircraft
// head-on at our height, escaped — the closest approach kept over 150 m.

afterEach(() => {
  resetFlights();
  setGroundHeights("earth", null);
  gcasForget();
});

const D = Math.PI / 180;
type C = ReturnType<typeof cruise>["c"];
const altOf = (c: C) => c.geoNow()!.alt;

test("the recovery foreseen: high and level clear; low and steep not; the conflicts' closest approach", () => {
  const flat = () => 0;
  expect(gcasRecovery({ alt: 3000, gamma: 0, bank: 0, V: 250 }, flat).clear).toBeGreaterThan(2900);
  // (from −30° at 250 m/s the 5 g pull loses some 250 m)
  const steep = gcasRecovery({ alt: 300, gamma: -30 * D, bank: 0, V: 250 }, flat);
  expect(steep.clear).toBeLessThan(gcasMargin(250));
  // (on its back the roll first: more height lost)
  const inv = gcasRecovery({ alt: 2000, gamma: -20 * D, bank: 180 * D, V: 250 }, flat);
  const up = gcasRecovery({ alt: 2000, gamma: -20 * D, bank: 0, V: 250 }, flat);
  expect(inv.clear).toBeLessThan(up.clear - 50);
  expect(inv.t).toBeCloseTo(GCAS.delay + 1, 5);
  // (a ridge 2 km ahead, 1 500 m up: level at 900 m, the pull not clear by its margin; at 1 600 m, clear)
  const ridge = (x: number) => (x > 2000 && x < 3000 ? 1500 : 0);
  expect(gcasRecovery({ alt: 900, gamma: 0, bank: 0, V: 250 }, ridge).clear).toBeLessThan(gcasMargin(250));
  expect(gcasRecovery({ alt: 1600, gamma: 0, bank: 0, V: 250 }, ridge).clear).toBeGreaterThan(300);
  // ACAS: head-on at our height, 2 km off; crossing 1 km above; diverging
  const head = acasConflict([{ id: "a", name: "A", r: [0, 2000, 0], vRel: [0, -400, 0] }]);
  expect(head?.miss).toBeCloseTo(0, 3);
  expect(head?.t).toBeCloseTo(5, 3);
  expect(acasConflict([{ id: "b", name: "B", r: [0, 2000, 1000], vRel: [0, -400, 0] }])).toBeNull();
  expect(acasConflict([{ id: "c", name: "C", r: [0, 2000, 0], vRel: [0, 400, 0] }])).toBeNull();
  expect(acasConflict([{ id: "d", name: "D", r: [0, 6000, 0], vRel: [0, -400, 0] }])).toBeNull();
  expect(ACAS.miss).toBe(150);
});

/** A dive held: the stick pushed (and rolled if asked), then held there, for `secs`; the lowest height. */
function dive(c: C, fly: (s: number) => number, o: { roll?: number; secs: number }) {
  let low = Infinity;
  const said: string[] = [];
  c.onRadio = (s) => said.push(s);
  if (o.roll) withStick(c, { roll: o.roll }, () => fly(1.1));
  withStick(c, { pitch: o.roll ? 0.6 : -0.8 }, () => {
    for (let i = 0; i < o.secs * 10; i++) {
      fly(0.1);
      low = Math.min(low, altOf(c));
      if (c.airFlight.failure || !c.airFlight.inAir) break;
    }
  });
  return { low, said, crashed: !!c.airFlight.failure || !c.airFlight.inAir };
}

test("a dive held into the sea, the stick forward all the way: the fly-up at the last moment, clear; off, into it", () => {
  const on = cruise(1500, 250, 0.7);
  const r = dive(on.c, on.fly, { secs: 25 });
  console.log(`  on: lowest ${r.low.toFixed(0)} m — ${r.said.join(" · ")}`);
  expect(r.crashed).toBe(false);
  expect(r.low).toBeGreaterThan(20);
  expect(r.said.join(" ")).toMatch(/fly up/);
  resetFlights();
  const off = cruise(1500, 250, 0.7);
  off.c.s.f35AutoProtect = false;
  const r2 = dive(off.c, off.fly, { secs: 25 });
  console.log(`  off: lowest ${r2.low.toFixed(0)} m, ${r2.crashed ? "into the sea" : "still flying"}`);
  expect(r2.low).toBeLessThan(5);
}, 120_000);

test("on its back, the stick pulled — the nose to the sea —: rolled level, then up; clear", () => {
  const { c, fly } = cruise(2500, 250, 0.7);
  const r = dive(c, fly, { roll: 1, secs: 30 });
  console.log(`  inverted: lowest ${r.low.toFixed(0)} m — ${r.said.join(" · ")}`);
  expect(r.crashed).toBe(false);
  expect(r.low).toBeGreaterThan(20);
}, 120_000);

test("level at 700 m toward a 1 200 m ridge: the fly-up over it", () => {
  const { c, fly } = cruise(700, 230, 0.7);
  const g0 = c.geoNow()!;
  // (a ridge across the track, 8 to 10 km ahead — the jet flies east)
  const D2 = Math.PI / 180;
  setGroundHeights("earth", (q) => {
    const lon = Math.atan2(q[1], q[0]) / D2;
    const x = (lon - g0.lon) * D2 * 6_371_008.8 * Math.cos(g0.lat * D2);
    return x > 8000 && x < 10_000 ? 1200 : 0;
  });
  gcasForget();
  c.jetToggle("ap");
  const said: string[] = [];
  c.onRadio = (s) => said.push(s);
  let low = Infinity;
  for (let i = 0; i < 600; i++) {
    fly(0.1);
    const g = c.geoNow()!;
    const x = (g.lon - g0.lon) * D2 * 6_371_008.8 * Math.cos(g0.lat * D2);
    if (x > 8000 && x < 10_000) low = Math.min(low, g.alt - 1200);
    if (process.env.TRACE && i % 5 === 0)
      console.log(
        x.toFixed(0),
        g.alt.toFixed(0),
        ((Math.atan2(g.vs, g.gs) * 180) / Math.PI).toFixed(1),
        c.airFlight.last!.speed.toFixed(0),
        c.gcas?.flyUp,
        c.gcas?.clear.toFixed(0),
      );
    if (c.airFlight.failure || !c.airFlight.inAir) break;
  }
  console.log(`  over the ridge by ${low.toFixed(0)} m at the least — ${said.join(" · ")}`);
  expect(c.airFlight.failure).toBeFalsy();
  expect(low).toBeGreaterThan(20);
}, 120_000);

test("an aircraft head-on at our height: the escape, the closest approach over 150 m", () => {
  const { c, fly } = cruise(4000, 220, 0.7);
  c.jetToggle("ap");
  const fix0 = c.radarFix()!;
  // (a jet 6 km ahead at our height, 220 m/s at us — its place fixed to the Earth, moving)
  const p0 = [0, 1, 2].map((i) => fix0.p[i]! + fix0.E[i]! * 6000) as [number, number, number];
  const v = [0, 1, 2].map((i) => -fix0.E[i]! * 220) as [number, number, number];
  let tt = 0;
  c.radarSources.set("test", (fix) => [
    {
      id: "test:1",
      r: fix.toLocal([p0[0] + v[0] * tt, p0[1] + v[1] * tt, p0[2] + v[2] * tt]),
      v: [-220, 0, 0],
      rcs: 5,
      kind: "air",
      iff: "unknown",
      name: "INTRUDER",
      squawk: true,
    },
  ]);
  const said: string[] = [];
  c.onRadio = (s) => said.push(s);
  let closest = Infinity;
  for (let i = 0; i < 300; i++) {
    fly(0.1);
    tt += 0.1;
    const fix = c.radarFix()!;
    const r = fix.toLocal([p0[0] + v[0] * tt, p0[1] + v[1] * tt, p0[2] + v[2] * tt]);
    closest = Math.min(closest, Math.hypot(...r));
  }
  console.log(`  closest ${closest.toFixed(0)} m — ${said.join(" · ")}`);
  expect(said.join(" ")).toMatch(/Auto-ACAS: INTRUDER/);
  expect(closest).toBeGreaterThan(150);
}, 120_000);
