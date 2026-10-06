import { describe, expect, test } from "bun:test";
import { brakingAccels, descentCommand, descentCurve, V_TD } from "../src/descent";
import { add, dot, len, scale, sub, type Vec3 } from "../src/math/vec3";

// The powered descent's guidance flown by a point mass: the pilot's velocity law (pilot.ts — the weight held
// first, the velocity's error with what the engine has left, T = 1.2 s) over a round, still body; the
// touchdown judged (its sink, its drift, its distance to the pad), and the engine never pushing the craft
// down.

interface Flight {
  sink: number;
  drift: number;
  miss: number;
  t: number;
  dv: number;
  pushedDown: number;
  maxDown: number;
}

function fly(o: { mu: number; R: number; aT: number; h0: number; v0: Vec3; pad: Vec3 | null; dt?: number; tMax?: number }): Flight {
  const dt = o.dt ?? 0.02;
  const T = 1.2;
  let r: Vec3 = [o.R + o.h0, 0, 0];
  let v: Vec3 = o.v0;
  const padAt = o.pad ? (scale(o.pad, o.R / len(o.pad)) as Vec3) : null;
  let t = 0,
    dv = 0,
    pushedDown = 0,
    maxDown = 0;
  for (; t < (o.tMax ?? 12000); t += dt) {
    const rl = len(r);
    const up = scale(r, 1 / rl);
    const h = rl - o.R;
    const vv = dot(v, up);
    const vhv = sub(v, scale(up, vv));
    const gGrav = o.mu / (rl * rl);
    const gHold = Math.max(gGrav - dot(vhv, vhv) / rl, 0);
    if (h <= 0) {
      if (process.env.TRACE) console.log("TD", JSON.stringify({ sink: -vv, drift: len(vhv), t, dv }));
      return {
        sink: -vv,
        drift: len(vhv),
        miss: padAt ? len(sub(scale(up, o.R), padAt)) : Number.NaN,
        t,
        dv,
        pushedDown,
        maxDown,
      };
    }
    const c = descentCommand({ up, h, v, g: gHold, aT: o.aT, pad: padAt ? sub(padAt, r) : null, orbit: { mu: o.mu, r, vi: v } });
    maxDown = Math.max(maxDown, -vv);
    let A: Vec3 = [0, 0, 0];
    if (c.doi) {
      A = scale(sub(c.doi, v), 1 / T);
      if (len(A) > o.aT) A = scale(A, o.aT / len(A));
    } else if (!c.coast) {
      const want = add(c.vh, scale(up, vv));
      const corr = Math.max((-c.down - vv) / T + c.ffUp, -gHold);
      const ff = add(scale(up, gHold + corr), c.ffH);
      const err = scale(sub(want, v), 1 / T);
      A = add(err, ff);
      if (len(A) > o.aT) {
        const fl = len(ff);
        if (fl >= o.aT) A = scale(ff, o.aT / fl);
        else {
          const ee = dot(err, err),
            fe = dot(ff, err);
          const k = ee > 0 ? (-fe + Math.sqrt(Math.max(fe * fe - ee * (fl * fl - o.aT * o.aT), 0))) / ee : 0;
          A = add(ff, scale(err, Math.min(Math.max(k, 0), 1)));
        }
      }
    }
    if (process.env.TRACE && Math.abs(t / 2 - Math.round(t / 2)) < dt / 4)
      console.log(
        t.toFixed(0),
        h.toFixed(1),
        vv.toFixed(2),
        len(vhv).toFixed(2),
        c.down.toFixed(2),
        c.coast,
        c.dist.toFixed(0),
        c.tGo.toFixed(1),
        len(A).toFixed(2),
      );
    if (dot(A, up) < -1e-9) pushedDown++;
    dv += len(A) * dt;
    v = add(v, scale(add(A, scale(up, -gGrav)), dt));
    r = add(r, scale(v, dt));
  }
  throw new Error("no touchdown");
}

const MOON = { mu: 4.9028e12, R: 1737.4e3 };
const MARS = { mu: 4.2828e13, R: 3389.5e3 };
const at = (R: number, km: number): Vec3 => [Math.cos((km * 1e3) / R), Math.sin((km * 1e3) / R), 0];

describe("the powered descent", () => {
  test("the curves: the touchdown's sink at the ground, a stop in hand above it", () => {
    const { aV } = brakingAccels(19.6, 1.62);
    expect(descentCurve(0, aV)).toBeCloseTo(V_TD, 9);
    // (√(2 a h): the stop at the curve's own deceleration)
    expect(descentCurve(1003, aV)).toBeCloseTo(Math.sqrt(V_TD ** 2 + 2 * aV * 1000), 9);
  });

  test("from a hover 1.5 km over the pad on the Moon: down at the touchdown's sink, on it, never pushed down", () => {
    const f = fly({ ...MOON, aT: 19.6, h0: 1500, v0: [0, 0, 0], pad: [1, 0, 0] });
    expect(f.sink).toBeLessThanOrEqual(1);
    expect(f.drift).toBeLessThan(0.2);
    expect(f.miss).toBeLessThan(2);
    expect(f.pushedDown).toBe(0);
    // (a minute or so: no slow crawl)
    expect(f.t).toBeLessThan(120);
  });

  test("from a hover 1.5 km up, 600 m off the pad: across to it, then down onto it", () => {
    const f = fly({ ...MOON, aT: 19.6, h0: 1500, v0: [0, 0, 0], pad: at(MOON.R, 0.6) });
    expect(f.sink).toBeLessThanOrEqual(1);
    expect(f.drift).toBeLessThan(0.3);
    expect(f.miss).toBeLessThan(3);
    expect(f.pushedDown).toBe(0);
  });

  test("from a 50 km lunar orbit, the pad 210° ahead: the descent orbit, the coast, the braking, on the pad", () => {
    const vc = Math.sqrt(MOON.mu / (MOON.R + 50e3));
    const f = fly({ ...MOON, aT: 19.6, h0: 50e3, v0: [0, vc, 0], pad: at(MOON.R, (210 * Math.PI * MOON.R) / 180e3) });
    expect(f.sink).toBeLessThanOrEqual(1);
    expect(f.drift).toBeLessThan(0.3);
    expect(f.miss).toBeLessThan(5);
    expect(f.pushedDown).toBe(0);
    // (an orbit's speed and some: a sixth more than the impulse — the gravity while braking, the fall from the descent orbit's low point)
    expect(f.dv).toBeLessThan(vc * 1.16);
  });

  test("from a 50 km lunar orbit, here: the speed killed, down where it stops", () => {
    const vc = Math.sqrt(MOON.mu / (MOON.R + 50e3));
    const f = fly({ ...MOON, aT: 19.6, h0: 50e3, v0: [0, vc, 0], pad: null });
    expect(f.sink).toBeLessThanOrEqual(1);
    expect(f.drift).toBeLessThan(1);
    expect(f.pushedDown).toBe(0);
  });

  test("an orbit's low point 2.5 km above the descent orbit's aim (10.5 × 50 km, the pad under it): braked there, not lowered again", () => {
    // (a body's uneven gravity lifts the descent orbit's low point: it was judged high, and lowered again
    // every turn, for ever — Shackleton's descent never began)
    const ra = MOON.R + 50e3,
      rp = MOON.R + 10.5e3;
    const va = Math.sqrt(MOON.mu * (2 / ra - 2 / (ra + rp)));
    const f = fly({ ...MOON, aT: 19.6, h0: 50e3, v0: [0, va, 0], pad: [-1, 0, 0], tMax: 4000 });
    expect(f.sink).toBeLessThanOrEqual(1);
    expect(f.miss).toBeLessThan(5);
    // (within the turn: half of it to the low point, the braking)
    expect(f.t).toBeLessThan(3600);
  });

  test("falling at 240 m/s 20 km up, the pad 130 km ahead (a Lander's entry handed over short): lit as the fall meets its curve, down gently", () => {
    // (coasting towards a far pad, the fall unheeded: the craft hit the ground at 400 m/s)
    const EARTH = { mu: 3.986e14, R: 6371e3 };
    const f = fly({ ...EARTH, aT: 14.7, h0: 20e3, v0: [-240, 650, 0], pad: at(EARTH.R, 130), tMax: 2000 });
    expect(f.sink).toBeLessThanOrEqual(1);
    expect(f.drift).toBeLessThan(0.5);
    expect(f.pushedDown).toBe(0);
  });

  test("the Lander at the end of a Martian entry (Mach 1.4, 9 km up, the site 9 km ahead)", () => {
    const f = fly({ ...MARS, aT: 14.7 * 0.95, h0: 9e3, v0: [-80, 330, 0], pad: at(MARS.R, 9) });
    expect(f.sink).toBeLessThanOrEqual(1);
    expect(f.drift).toBeLessThan(0.3);
    expect(f.miss).toBeLessThan(5);
  });
});
