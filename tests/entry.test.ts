import { test, expect } from "bun:test";
import {
  EntryGuidance,
  entryCorridor,
  miss,
  planDeorbit,
  predictEntry,
  type EntryEnv,
  type EntryCraft,
  type EntryState,
} from "../src/entry";
import { VESSELS } from "../src/vessels";
import { solarBody } from "../src/system/solar";
import type { V3 } from "../src/aero";

// the Earth: a sphere turning about z, its standard air
const mu = 3.986004418e14,
  R = 6371e3,
  W = 7.2921159e-5;
const rot = (p: V3, a: number): V3 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
const earth: EntryEnv = {
  R,
  atm: solarBody("earth")!.atmosphere!,
  gravity: (x) => {
    const r = Math.hypot(...x);
    const k = -mu / (r * r * r);
    return [x[0] * k, x[1] * k, x[2] * k];
  },
  ground: (x) => [-W * x[1], W * x[0], 0],
  carry: (p, dt) => rot(p, W * dt),
};
const ranger: EntryCraft = { aero: VESSELS.ranger.aero, mass: VESSELS.ranger.mass, alpha: (40 * Math.PI) / 180 };
const D = Math.PI / 180;
// at 120 km over the equator heading north-east, 7.8 km/s, γ −1.2°
const start = (): EntryState => {
  const r = R + 120e3,
    g = -1.2 * D;
  const fwd: V3 = [0, Math.cos(45 * D), Math.sin(45 * D)];
  return { x: [r, 0, 0], v: [7800 * Math.sin(g), 7800 * Math.cos(g) * fwd[1], 7800 * Math.cos(g) * fwd[2]] };
};
const onGround = (x: V3): V3 => {
  const l = Math.hypot(...x);
  return [(x[0] * R) / l, (x[1] * R) / l, (x[2] * R) / l];
};

test("an entry predicted: Shuttle-like peaks, a handover at Mach 2.5 thousands of km on", () => {
  const r = predictEntry(earth, ranger, start(), () => 50 * D, { handoverMach: 2.5 });
  expect(r.handover).toBe(true);
  expect(r.gPeak).toBeLessThan(3);
  expect(r.heatPeak / 1e4).toBeGreaterThan(30);
  expect(r.shieldPeak).toBeLessThan(VESSELS.ranger.aero.shield!.tMax);
  const range =
    Math.acos(
      Math.min(1, (r.end.x[0] * start().x[0]) / (Math.hypot(...r.end.x) * Math.hypot(...start().x)) + (r.end.x[1] * 0 + r.end.x[2] * 0)),
    ) * R;
  expect(range / 1e3).toBeGreaterThan(1500);
  // more bank, a shorter fall
  const r2 = predictEntry(earth, ranger, start(), () => 75 * D, { handoverMach: 2.5 });
  expect(r2.t).toBeLessThan(r.t);
});

test("the guidance brings the handover over its aim — 400 km on and 120 km across the unguided fall", () => {
  const free = predictEntry(earth, ranger, start(), () => 45 * D, { handoverMach: 2.5 });
  // the place: from the free fall's end, moved along and across the track (carried back to now)
  const end = free.end;
  const up = (() => {
    const l = Math.hypot(...end.x);
    return end.x.map((c) => c / l) as V3;
  })();
  const va = [end.v[0] - earth.ground(end.x)[0], end.v[1] - earth.ground(end.x)[1], end.v[2] - earth.ground(end.x)[2]] as V3;
  const vu = va[0] * up[0] + va[1] * up[1] + va[2] * up[2];
  const f = (() => {
    const h: V3 = [va[0] - vu * up[0], va[1] - vu * up[1], va[2] - vu * up[2]];
    const l = Math.hypot(...h);
    return h.map((c) => c / l) as V3;
  })();
  const right: V3 = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
  const there = onGround([
    end.x[0] + 400e3 * f[0] * -0.4 + 120e3 * right[0],
    end.x[1] + 400e3 * f[1] * -0.4 + 120e3 * right[1],
    end.x[2] + 400e3 * f[2] * -0.4 + 120e3 * right[2],
  ]);
  const place = earth.carry(there, -free.t);
  const g = new EntryGuidance({ handoverMach: 2.5, short: 40e3 });
  let next = 0,
    b = 0;
  const flown = predictEntry(
    earth,
    ranger,
    start(),
    (t, x, v) => {
      if (t >= next) {
        b = g.update(earth, ranger, { x, v }, earth.carry(place, t));
        next = t + 8;
      }
      return b;
    },
    { handoverMach: 2.5 },
  );
  expect(flown.handover).toBe(true);
  const m = miss(start(), flown.end.x, earth.carry(place, flown.t));
  // (the handover the aim's 40 km short of the place: as far from it, whatever the track's curve)
  expect(Math.abs(m.dist - 40e3) / 1e3).toBeLessThan(10);
  expect(Math.abs(g.lastMiss!.along + 40e3) / 1e3).toBeLessThan(12);
}, 20000);

test("the deorbit from a 400 km orbit: a burn found whose entry ends over the place", () => {
  const r0 = R + 400e3,
    v0 = Math.sqrt(mu / r0),
    inc = 51.6 * D;
  const s0: EntryState = { x: [r0, 0, 0], v: [0, v0 * Math.cos(inc), v0 * Math.sin(inc)] };
  // a place under the ground track, a third of a turn on
  const ang = 120 * D;
  const p = onGround([r0 * Math.cos(ang), r0 * Math.sin(ang) * Math.cos(inc), r0 * Math.sin(ang) * Math.sin(inc)]);
  const plan = planDeorbit(earth, ranger, s0, earth.carry(p, 0), { peH: 40e3, handoverMach: 2.5, short: 40e3, orbits: 16, reach: 600e3 });
  expect(plan).not.toBeNull();
  expect(plan!.dv).toBeGreaterThan(50);
  expect(plan!.dv).toBeLessThan(250);
  expect(Math.abs(plan!.miss.along + 40e3) / 1e3).toBeLessThan(5);
  // (the first pass whose crossrange the Ranger's lift reaches)
  expect(Math.abs(plan!.miss.across) / 1e3).toBeLessThan(600);
}, 20000);

test("the entry corridor: the lift's top over the heat's and load's floor; a Ranger's predicted fall within it", () => {
  const C = entryCorridor(earth, ranger, [1000, 3000, 5000, 7000, 7800]);
  for (const c of C) expect(c.hi).toBeGreaterThan(c.lo);
  // (near the orbital speed the curve alone holds the craft: the top is the air's; slower, the lift
  // must, lower down)
  expect(C[4]!.hi).toBeGreaterThan(100e3);
  expect(C[0]!.hi).toBeLessThan(C[3]!.hi);
  // (fast, the heat's floor some tens of km up)
  expect(C[3]!.lo).toBeGreaterThan(20e3);
  const r = predictEntry(earth, ranger, start(), () => 50 * D, { handoverMach: 2.5, sample: 20 });
  expect(r.track.length).toBe(r.path.length);
  const inside = r.track.filter(([v, h]) => {
    const k = C.findIndex((c) => c.v >= v);
    if (k <= 0) return true;
    const a = C[k - 1]!,
      b = C[k]!;
    const u = (v - a.v) / (b.v - a.v);
    return h >= a.lo + u * (b.lo - a.lo) - 2e3 && h <= a.hi + u * (b.hi - a.hi) + 2e3;
  });
  expect(inside.length / r.track.length).toBeGreaterThan(0.8);
});
