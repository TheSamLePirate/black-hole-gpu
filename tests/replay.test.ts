import { expect, test } from "bun:test";
import {
  axesOf,
  bestMoments,
  directorShot,
  ecefOf,
  EV,
  FlightTape,
  REPLAY,
  shotPose,
  startShot,
  type TapeSample,
  type V3,
} from "../src/game/replay";

// The replay (game/replay.ts, S3): the tape keeps its last minutes; the cameras on the craft's axes — the chase
// behind and above, the orbit about it, the fly-by standing where it passes (ahead, then behind, its lens long far
// off) —, the horizon level; the best moments found (a kill before a cruise), the director's choices.

/** A craft flying north, level, at `speed` m/s and `agl` m (the ground at 0), from 45° N 6° E. */
const north = (t: number, o: { speed?: number; agl?: number; nz?: number } = {}): TapeSample => {
  const speed = o.speed ?? 200,
    agl = o.agl ?? 1000;
  // (the place along the path: 200 m/s from the start whatever the speed said — no jump where it changes)
  const lat = 45 + (200 * t) / 111_132;
  return {
    p: ecefOf(lat, 6, agl),
    ax: [
      [-1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    lat,
    lon: 6,
    alt: agl,
    agl,
    speed,
    mach: speed / 340,
    nz: o.nz ?? 1,
  };
};
const fill = (secs: number, f: (t: number) => { s: TapeSample; ev?: number }) => {
  const T = new FlightTape();
  for (let t = 0; t <= secs; t += 1 / 60) {
    const x = f(t);
    T.push(x.s, x.ev ?? 0, null);
    T.tick(1 / 60);
  }
  return T;
};

test("the tape: a frame each 60th of a second at most, its last 150 s kept, the frame at a time", () => {
  const T = fill(200, (t) => ({ s: north(t) }));
  expect(T.length).toBeGreaterThan(REPLAY.seconds - 1);
  expect(T.length).toBeLessThan(REPLAY.seconds + 3);
  expect(T.at(T.end - 10)!.t).toBeCloseTo(T.end - 10, 1);
  // (too soon: skipped, its events kept on the last)
  T.push(north(0), 0, null);
  expect(T.push(north(0), EV.FIRE, null)).toBe(false);
  expect(T.frames.at(-1)!.ev & EV.FIRE).toBe(EV.FIRE);
  // (a jump — the craft set 50 km away —: the tape begun afresh)
  T.tick(1 / 60);
  T.push({ ...north(0), p: ecefOf(45.5, 6, 1000) }, 0, null);
  expect(T.frames.length).toBe(1);
});

test("the cameras: the chase behind and above, the orbit about the craft, the horizon level", () => {
  const T = fill(20, (t) => ({ s: north(t) }));
  const chase = shotPose(T, startShot(T, "chase", 10), 10)!;
  expect(chase.eye[2]).toBeLessThan(-20);
  expect(chase.eye[1]).toBeGreaterThan(3);
  expect(chase.up![1]).toBeCloseTo(1, 3);
  const st = startShot(T, "orbit", 5);
  for (const u of [5, 8, 11]) {
    const o = shotPose(T, st, u)!;
    expect(Math.hypot(o.eye[0], o.eye[2])).toBeCloseTo(30, 0);
  }
  // (the cockpit's: the seat given)
  expect(shotPose(T, startShot(T, "cockpit", 5), 5, { eye: [0, 1, 4], aim: [0, 1, 9] })!.eye).toEqual([0, 1, 4]);
});

test("the fly-by: standing aside the path ahead, the craft passing it — the lens long far off, wide close", () => {
  const T = fill(20, (t) => ({ s: north(t, { agl: 80, speed: 250 }) }));
  const st = startShot(T, "flyby", 5);
  const a = shotPose(T, st, 5)!,
    b = shotPose(T, st, 7.5)!,
    c = shotPose(T, st, 10)!;
  // (ahead, then about abeam, then behind; aside; under the craft — a quarter of its height —, above the ground)
  expect(a.eye[2]).toBeGreaterThan(300);
  expect(Math.abs(b.eye[2])).toBeLessThan(10);
  expect(c.eye[2]).toBeLessThan(-300);
  expect(Math.abs(b.eye[0])).toBeGreaterThan(40);
  expect(b.eye[1]).toBeCloseTo(-20, 0);
  expect(a.fov!).toBeLessThan(10);
  expect(b.fov!).toBeGreaterThan(20);
  // (the standing place the same in the world)
  const world = (p: { eye: V3 }, t: number) => {
    const s = T.at(t)!.s;
    const A = axesOf(s);
    return [0, 1, 2].map((k) => s.p[k]! + A[0][k]! * p.eye[0] + A[1][k]! * p.eye[1] + A[2][k]! * p.eye[2]);
  };
  const wa = world(a, 5),
    wc = world(c, 10);
  expect(Math.hypot(wa[0]! - wc[0]!, wa[1]! - wc[1]!, wa[2]! - wc[2]!)).toBeLessThan(0.01);
});

test("the best moments: a kill and a low pass before a cruise, in the order flown; a cruise alone one moment", () => {
  const T = fill(120, (t) => {
    if (t > 20 && t < 30) return { s: north(t, { agl: 60, speed: 260 }) };
    if (t > 70 && t < 74)
      return { s: north(t, { nz: 6.5 }), ev: (t > 71 && t < 72 ? EV.FIRE : 0) | (Math.abs(t - 73) < 0.01 ? EV.BOOM : 0) };
    return { s: north(t) };
  });
  const M = bestMoments(T);
  expect(M.length).toBeGreaterThanOrEqual(2);
  expect(M.map((m) => m.kind)).toContain("kill");
  expect(M.map((m) => m.kind)).toContain("low");
  // (in order, apart)
  for (let i = 1; i < M.length; i++) expect(M[i]!.t0).toBeGreaterThan(M[i - 1]!.t1);
  const kill = M.find((m) => m.kind === "kill")!;
  expect(kill.t0).toBeLessThan(73);
  expect(kill.t1).toBeGreaterThan(73);
  const low = M.find((m) => m.kind === "low")!;
  expect(low.agl).toBeCloseTo(60, 0);
  const calm = bestMoments(fill(60, (t) => ({ s: north(t) })));
  expect(calm.length).toBe(1);
});

test("the director: the fly-by low and fast, the chase for a burst, never the same shot twice", () => {
  const low = fill(20, (t) => ({ s: north(t, { agl: 50, speed: 250 }) }));
  expect(directorShot(low, 5, null)).toBe("flyby");
  expect(directorShot(low, 5, "flyby")).toBe("chase");
  const fire = fill(20, (t) => ({ s: north(t), ev: t > 6 && t < 7 ? EV.FIRE : 0 }));
  expect(directorShot(fire, 5, "orbit")).toBe("chase");
  const pull = fill(20, (t) => ({ s: north(t, { nz: 7 }) }));
  expect(directorShot(pull, 5, "chase")).toBe("orbit");
  for (const prev of ["chase", "orbit", "flyby"] as const) expect(directorShot(pull, 5, prev)).not.toBe(prev);
});
