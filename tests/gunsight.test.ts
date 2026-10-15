import { describe, expect, test } from "bun:test";
import { GUN, gunLead, segDist } from "../src/game/combat";
import { type GunState, gunFunnel, gunSolution, roundAt, roundStep, SIGHT, trackAccel } from "../src/game/gunsight";

// The gun's sight (docs/PLAN-AVIATION-AAA.md, C3; game/gunsight.ts): the solution meets a straight target and a
// turning one; the bench — a fighter turning at 5 g, tracked from behind with the gun's line on the sight (a
// pilot's wobble on it), the rounds flown as the fight flies them: 60 % of them hit at least, where the old lead
// (its velocity alone) misses; the funnel.

type V3 = [number, number, number];
const G = 9.80665;

describe("the solution", () => {
  test("a target crossing at 250 m/s, 600 m off: the round fired along the solution meets it", () => {
    const S = { p: [0, 0, 3000] as V3, v: [0, 220, 0] as V3 };
    const T = { p: [0, 600, 3000] as V3, v: [250, 0, 0] as V3 };
    const sol = gunSolution(S, T)!;
    const r = roundAt(S.p, S.v, sol.dir, sol.tof);
    const at: V3 = [T.p[0] + T.v[0] * sol.tof, T.p[1], T.p[2]];
    console.log(
      `  tof ${sol.tof.toFixed(3)} s, lead ${(Math.atan2(sol.dir[0], sol.dir[1]) * 1000) | 0} mrad, miss ${Math.hypot(r.p[0] - at[0], r.p[1] - at[1], r.p[2] - at[2]).toFixed(2)} m`,
    );
    expect(Math.hypot(r.p[0] - at[0], r.p[1] - at[1], r.p[2] - at[2])).toBeLessThan(0.5);
    expect(sol.inRange).toBe(true);
    // (aimed above it: the rounds fall)
    expect(sol.dir[2]).toBeGreaterThan(0);
  });

  test("beyond the reach: out of range; beyond the time of flight: none", () => {
    const S = { p: [0, 0, 3000] as V3, v: [0, 220, 0] as V3 };
    expect(gunSolution(S, { p: [0, 1400, 3000], v: [0, 220, 0] })!.inRange).toBe(false);
    expect(gunSolution(S, { p: [0, 4000, 3000], v: [0, 220, 0] })).toBeNull();
  });
});

/** A fighter in a level turn at n g, `v` m/s, about the origin (counter-clockwise from the east), at time t. */
function turning(n: number, v: number, t: number, lagRad = 0) {
  const aLat = G * Math.sqrt(n * n - 1);
  const R = (v * v) / aLat;
  const w = v / R;
  const th = w * t - lagRad;
  return {
    p: [R * Math.cos(th), R * Math.sin(th), 3000] as V3,
    v: [-v * Math.sin(th), v * Math.cos(th), 0] as V3,
    R,
  };
}

/** The bench: the target turning at 5 g, 250 m/s; the shooter on its circle `range` m behind, its gun's line
 *  put on the sight each frame (the target's acceleration measured from its velocity, a pilot's wobble of
 *  `wobble` rad on it), the gun fired 3 s; the share of its rounds that hit. `lead`: the sight's or the old one. */
function bench(range: number, lead: "sight" | "velocity", wobble = 5e-3) {
  const n = 5,
    v = 250;
  const R = turning(n, v, 0).R;
  const lag = 2 * Math.asin(range / (2 * R));
  const dt = 1 / 60;
  const meas = { v: null as V3 | null, a: [0, 0, 0] as V3, t: 0 };
  const rounds: { p: V3; v: V3; t: number }[] = [];
  let fired = 0,
    hits = 0,
    acc = 0;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < 60 * 5.5; i++) {
    const t = i * dt;
    const T = turning(n, v, t);
    const S = turning(n, v, t, lag);
    const a = trackAccel(meas, T.v, t);
    let dir: V3;
    if (lead === "sight") dir = gunSolution(S, { ...T, a })?.dir ?? [0, 1, 0];
    else {
      const L = gunLead({ p: S.p, v: S.v, fwd: [0, 1, 0], up: [0, 0, 1] }, T);
      dir = L?.dir ?? [0, 1, 0];
    }
    // (the pilot's wobble: slow, a few milliradians)
    const wx = wobble * Math.sin(t * 2.3),
      wy = wobble * Math.cos(t * 1.7);
    const right: V3 = [dir[1], -dir[0], 0];
    const rl = Math.hypot(...right) || 1;
    dir = [dir[0] + (right[0] / rl) * wx, dir[1] + (right[1] / rl) * wx, dir[2] + wy];
    // (fired from 1 s to 4 s: the measure settled)
    if (t >= 1 && t < 4) {
      acc += dt * GUN.rate;
      while (acc >= 1) {
        acc -= 1;
        fired++;
        const s = GUN.spread;
        const d: V3 = [dir[0] + rand() * s, dir[1] + rand() * s, dir[2] + rand() * s];
        const dl = Math.hypot(...d);
        const u: V3 = [d[0] / dl, d[1] / dl, d[2] / dl];
        rounds.push({
          p: [S.p[0] + u[0] * 8, S.p[1] + u[1] * 8, S.p[2] + u[2] * 8],
          v: [S.v[0] + u[0] * GUN.muzzle, S.v[1] + u[1] * GUN.muzzle, S.v[2] + u[2] * GUN.muzzle],
          t: 0,
        });
      }
    }
    // (the rounds flown as the fight flies them; a hit: their segment within the hit radius of the target)
    const Tn = turning(n, v, t + dt);
    for (const r of rounds) {
      if (r.t === Infinity) continue;
      const p0 = r.p;
      roundStep(r, dt);
      r.t += dt;
      if (segDist(p0, r.p, Tn.p) < GUN.hitR) {
        hits++;
        r.t = Infinity;
      } else if (r.t > GUN.life) r.t = Infinity;
    }
  }
  return { fired, hits, rate: hits / fired };
}

describe("the bench: a fighter turning at 5 g, 250 m/s", () => {
  for (const range of [400, 700, 1000])
    test(`${range} m behind: the sight's rounds hit 60 % or more; the velocity's lead${range > 500 ? " fewer" : ""}`, () => {
      const s = bench(range, "sight");
      const o = bench(range, "velocity");
      console.log(
        `  ${range} m: the sight ${(s.rate * 100).toFixed(0)} % (${s.hits}/${s.fired}), the velocity alone ${(o.rate * 100).toFixed(0)} %`,
      );
      expect(s.rate).toBeGreaterThanOrEqual(0.6);
      // (close in, the turn's ½ a t² within the hit radius: both hit; farther, only the sight)
      if (range > 500) expect(s.rate).toBeGreaterThan(o.rate + 0.3);
    });
});

describe("the funnel", () => {
  test("the rounds of the last 1.5 s along the gun's line: farther the older, ahead of the craft", () => {
    const hist: GunState[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 60;
      hist.push({ t, p: [0, 220 * t, 3000], v: [0, 220, 0], fwd: [0, 1, 0] });
    }
    const now = 2;
    const F = gunFunnel(hist, now, [0, 440, 3000]);
    expect(F.length).toBeGreaterThanOrEqual(13);
    // (the oldest first: the farthest)
    expect(F[0]!.range).toBeGreaterThan(F[F.length - 1]!.range);
    expect(F[0]!.range).toBeGreaterThan(1000);
    // (each ahead of the craft, fallen below its line)
    for (const x of F) expect(x.p[1]).toBeGreaterThan(440);
    expect(F[0]!.p[2]).toBeLessThan(3000);
    expect(SIGHT.funnelSpan).toBe(1.5);
  });
});
