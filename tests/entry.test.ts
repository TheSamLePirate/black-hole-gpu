import { test, expect } from "bun:test";
import {
  CAPSULE,
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
      return g.flown(b, earth, { x, v });
    },
    { handoverMach: 2.5 },
  );
  expect(flown.handover).toBe(true);
  const m = miss(start(), flown.end.x, earth.carry(place, flown.t));
  // (the handover the aim's 40 km short of the place: as far from it, whatever the track's curve)
  expect(Math.abs(m.dist - 40e3) / 1e3).toBeLessThan(10);
  expect(Math.abs(g.lastMiss!.along + 40e3) / 1e3).toBeLessThan(12);
}, 20000);

test("the guidance updated every 2 s: a handful of bank reversals, the load under 2.5 g, the handover on its aim", () => {
  // (the deadband a share of the distance left, as the Shuttle's azimuth's; the bank eased off past 2.4 g:
  // a deadband of 7 × the speed and no limit reversed 16 times, the last at 80° every few seconds, 3.9 g)
  const free = predictEntry(earth, ranger, start(), () => 45 * D, { handoverMach: 2.5 });
  const end = free.end;
  const l = Math.hypot(...end.x);
  const up = end.x.map((c) => c / l) as V3;
  const gr = earth.ground(end.x);
  const va = [end.v[0] - gr[0], end.v[1] - gr[1], end.v[2] - gr[2]] as V3;
  const vu = va[0] * up[0] + va[1] * up[1] + va[2] * up[2];
  const h: V3 = [va[0] - vu * up[0], va[1] - vu * up[1], va[2] - vu * up[2]];
  const f = h.map((c) => c / Math.hypot(...h)) as V3;
  const right: V3 = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
  const place = earth.carry(onGround([0, 1, 2].map((i) => end.x[i]! - 150e3 * f[i]! + 60e3 * right[i]!) as V3), -free.t);
  const g = new EntryGuidance({ handoverMach: 2.5, short: 40e3 });
  let next = 0,
    b = 0,
    flips = 0;
  const flown = predictEntry(
    earth,
    ranger,
    start(),
    (t, x, v) => {
      if (t >= next) {
        const nb = g.update(earth, ranger, { x, v }, earth.carry(place, t));
        if (b !== 0 && Math.sign(nb) !== Math.sign(b) && Math.abs(nb) > 0.1) flips++;
        b = nb;
        next = t + 2;
      }
      return g.flown(b, earth, { x, v });
    },
    { handoverMach: 2.5 },
  );
  expect(flown.handover).toBe(true);
  expect(flips).toBeLessThanOrEqual(6);
  expect(flown.gPeak).toBeLessThan(2.6);
  // (the phugoid damped: past its first pull-out, the fall climbs back no more than 2 km — undamped it
  // bounced 9 km, over the corridor's top)
  const hs = flown.track.map(([, h]) => h);
  const i0 = hs.findIndex((h, i) => i > 0 && h < 85e3 && h <= hs[i - 1]! && h <= (hs[i + 1] ?? h));
  let lo = hs[i0]!,
    rise = 0;
  for (const h of hs.slice(i0)) {
    lo = Math.min(lo, h);
    rise = Math.max(rise, h - lo);
  }
  expect(rise).toBeLessThan(1.2e3);
  const m = miss(start(), flown.end.x, earth.carry(place, flown.t));
  expect(Math.abs(m.dist - 40e3) / 1e3).toBeLessThan(15);
}, 60000);

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

/**
 * The Lander's deorbit and guided entry on a still Earth (no crossrange the ground's turning adds), the
 * site `acrossKm` off the orbit's ground track: from where the hand-over ends to the site [km], and its
 * offset along the track [km] (the aim: 8 km short).
 */
function landerEntry(acrossKm: number, band?: [number, number, number], reach = 150e3) {
  const still: EntryEnv = { ...earth, ground: () => [0, 0, 0], carry: (p) => p };
  const lander: EntryCraft = { aero: VESSELS.lander.aero, mass: VESSELS.lander.mass, alpha: 65 * D };
  const r0 = R + 500e3,
    v0 = Math.sqrt(mu / r0);
  const s0: EntryState = { x: [r0, 0, 0], v: [0, v0, 0] };
  const ang = 120 * D,
    off = (acrossKm * 1e3) / R;
  const p: V3 = [R * Math.cos(ang) * Math.cos(off), R * Math.sin(ang) * Math.cos(off), R * Math.sin(off)];
  const plan = planDeorbit(still, lander, s0, p, { peH: 30e3, handoverMach: 1.4, short: 8e3, orbits: 16, reach })!;
  // the coast to the burn — the trim out of the plane on the way —, the burn against the motion
  let x = s0.x,
    v = s0.v;
  for (let t = 0; t < plan.t; t += 1) {
    if (plan.trim && t <= plan.trim.t && plan.trim.t < t + 1) {
      const n = [x[1] * v[2] - x[2] * v[1], x[2] * v[0] - x[0] * v[2], x[0] * v[1] - x[1] * v[0]] as V3;
      const nl = Math.hypot(...n);
      v = v.map((c, i) => c + (n[i]! / nl) * plan.trim!.dv) as V3;
    }
    const h = Math.min(1, plan.t - t);
    const a = still.gravity(x, v);
    v = [v[0] + (a[0] * h) / 2, v[1] + (a[1] * h) / 2, v[2] + (a[2] * h) / 2];
    x = [x[0] + v[0] * h, x[1] + v[1] * h, x[2] + v[2] * h];
    const a2 = still.gravity(x, v);
    v = [v[0] + (a2[0] * h) / 2, v[1] + (a2[1] * h) / 2, v[2] + (a2[2] * h) / 2];
  }
  const l = Math.hypot(...v);
  v = v.map((c) => c - (c / l) * plan.dv) as V3;
  const g = new EntryGuidance({ handoverMach: 1.4, short: 8e3, gCap: 0.85 * VESSELS.lander.aero.gMax!, band });
  let next = 0,
    b = 0.75;
  const flown = predictEntry(
    still,
    lander,
    { x, v },
    (t, xx, vv) => {
      if (t >= next) {
        b = g.update(still, lander, { x: xx, v: vv }, p);
        next = t + 2;
      }
      return g.flown(b, still, { x: xx, v: vv });
    },
    { handoverMach: 1.4, tMax: 8000 },
  );
  const ue = flown.end.x.map((c) => c / Math.hypot(...flown.end.x)) as V3;
  const dist = (R * Math.acos(Math.min(1, (ue[0] * p[0] + ue[1] * p[1] + ue[2] * p[2]) / R))) / 1e3;
  return { flown, dist, along: miss({ x, v }, flown.end.x, p).along / 1e3, plan };
}

test("the Lander's entry guided under its own load: its hand-over on its aim, not 146 km past it", () => {
  // (held under the Ranger's 2.4 g — a capsule's entry pulls 4–5 —, its bank fell to nothing and the fall
  // overshot)
  const r = landerEntry(0, CAPSULE.band);
  expect(r.flown.handover).toBe(true);
  expect(Math.abs(r.along + 8)).toBeLessThan(5);
  expect(r.flown.gPeak).toBeLessThan(VESSELS.lander.aero.gMax!);
}, 120000);

test("the Lander from a pass 25 km off the site: its own tight deadband brings the hand-over onto its aim", () => {
  // (the Ranger's deadband left it 20 km aside, 30 km from the site; its reach, CAPSULE.reach: 30 km)
  const r = landerEntry(25, CAPSULE.band);
  expect(Math.abs(r.dist - 8)).toBeLessThan(3);
}, 120000);

test("the Lander's deorbit waits for the pass within its reach: days of orbits, not the first within 150 km", () => {
  const lander: EntryCraft = { aero: VESSELS.lander.aero, mass: VESSELS.lander.mass, alpha: 65 * D };
  const r0 = R + 500e3,
    v0 = Math.sqrt(mu / r0),
    inc = 51.6 * D;
  const s0: EntryState = { x: [r0, 0, 0], v: [0, v0 * Math.cos(inc), v0 * Math.sin(inc)] };
  const ang = 120 * D;
  const p = onGround([r0 * Math.cos(ang), r0 * Math.sin(ang) * Math.cos(inc), r0 * Math.sin(ang) * Math.sin(inc)]);
  const o = { peH: 30e3, handoverMach: 1.4, short: 8e3, orbits: 96, reach: CAPSULE.reach };
  const plan = planDeorbit(earth, lander, s0, earth.carry(p, 0), o)!;
  expect(plan).not.toBeNull();
  expect(Math.abs(plan.miss.across)).toBeLessThan(CAPSULE.reach);
}, 120000);

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

test("the corridor's top counts the ground's own speed: flying east, the curve is the speed in space", () => {
  // (330 m/s carried at 6.5 km/s: the lift asked a fifth less, its height ~1.5 km up — an entry flown east
  // rode over the corridor's top drawn from the air's speed alone)
  const [still] = entryCorridor(earth, ranger, [6500]);
  const [east] = entryCorridor(earth, ranger, [6500], 330);
  const [west] = entryCorridor(earth, ranger, [6500], -330);
  expect((east!.hi - still!.hi) / 1e3).toBeGreaterThan(1);
  expect((east!.hi - still!.hi) / 1e3).toBeLessThan(3);
  expect(west!.hi).toBeLessThan(still!.hi);
  expect(east!.lo).toBe(still!.lo);
});

test("the pull-out at a steep bank: the phugoid damped, the fall climbing back under a kilometre", () => {
  // (at 55° — the guidance's bank from the Edwards deorbit — damped alike on the climb and the dive the
  // fall climbed back 2.5 km after its pull-out, over the corridor's top for ten minutes)
  const g = new EntryGuidance({ handoverMach: 2.5, short: 40e3 });
  const r = predictEntry(earth, ranger, start(), (_t, x, v) => g.flown(55 * D, earth, { x, v }), { handoverMach: 2.5, sample: 5 });
  const hs = r.track.map(([, h]) => h);
  const i0 = hs.findIndex((h, i) => i > 0 && h < 85e3 && h <= hs[i - 1]! && h <= (hs[i + 1] ?? h));
  let lo = hs[i0]!,
    rise = 0;
  for (const h of hs.slice(i0)) {
    lo = Math.min(lo, h);
    rise = Math.max(rise, h - lo);
  }
  expect(rise).toBeLessThan(1e3);
});

test("the Lander from a pass 80 km off the site, past its lift's reach: a trim out of the plane, the hand-over on its aim", () => {
  // (the nearest pass in six days of orbits came 85 km aside of Kennedy: the lift's 30 km left it there)
  const r = landerEntry(80, CAPSULE.band, CAPSULE.reach);
  expect(r.plan.trim).not.toBeNull();
  // (a quarter turn before the end: ~0.9 km a m/s — at the deorbit burn it took 200)
  expect(Math.abs(r.plan.trim!.dv)).toBeGreaterThan(30);
  expect(Math.abs(r.plan.trim!.dv)).toBeLessThan(110);
  expect(Math.abs(r.plan.miss.across) / 1e3).toBeLessThan(CAPSULE.reach / 1e3 / 2);
  // (on its aim along the track too: the burn's time found again on the trimmed orbit)
  expect(Math.abs(r.along + 8)).toBeLessThan(4);
  expect(Math.abs(r.dist - 8)).toBeLessThan(5);
}, 120000);
