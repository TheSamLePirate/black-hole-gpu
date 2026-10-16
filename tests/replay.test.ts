import { expect, test } from "bun:test";
import {
  axesOf,
  bestMoments,
  boomsOnScreen,
  enuToEcef,
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
    const s = T.sampleAt(t)!;
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

test("the explosions on the replay's screen: one ahead of the chase's camera in the middle, one behind it left out", () => {
  const T = fill(20, (t) => ({ s: north(t) }));
  const s = T.at(10)!.s;
  const pose = shotPose(T, startShot(T, "chase", 10), 10)!;
  // (300 m ahead on the path, at the craft's height; 300 m behind)
  const ahead = enuToEcef(s, [0, 300, 0]),
    behind = enuToEcef(s, [0, -300, 0]);
  const B = boomsOnScreen(
    s,
    pose,
    [ahead, behind].map((w) => ({ w, age: 0.5, size: 2 })),
    60,
    1600,
    900,
  );
  expect(B.length).toBe(1);
  expect(B[0]!.x).toBeCloseTo(800, -1);
  expect(Math.abs(B[0]!.y - 450)).toBeLessThan(120);
  expect(B[0]!.depth).toBeGreaterThan(300);
  // (to the craft's right: on the screen's right)
  const right = boomsOnScreen(s, pose, [{ w: enuToEcef(s, [100, 300, 0]), age: 0, size: 1 }], 60, 1600, 900);
  expect(right[0]!.x).toBeGreaterThan(900);
});

test("the replay between its frames: the craft interpolated — played at any rate, no frame twice, none skipped", () => {
  const T = fill(10, (t) => ({ s: north(t) }));
  const a = T.frames[100]!,
    b = T.frames[101]!;
  const m = T.sampleAt((a.t + b.t) / 2)!;
  for (let k = 0; k < 3; k++) expect(m.p[k]).toBeCloseTo((a.s.p[k]! + b.s.p[k]!) / 2, 3);
  // (the chase's eye at 50 Hz: its motion even — the second difference of its place small)
  const st = startShot(T, "chase", 2);
  const eyes: number[] = [];
  for (let t = 2; t < 4; t += 1 / 50) eyes.push(shotPose(T, st, t)!.eye[2]);
  for (let i = 2; i < eyes.length; i++) expect(Math.abs(eyes[i]! - 2 * eyes[i - 1]! + eyes[i - 2]!)).toBeLessThan(0.05);
});

test("the lens on the target: aimed at what was shot down, its field to its distance; the director takes it", () => {
  const T = new FlightTape();
  for (let t = 0; t <= 10; t += 1 / 60) {
    const s = north(t);
    T.push(s, 0, null, t > 4 ? enuToEcef(s, [300, 2000 - 100 * (t - 4), -200]) : undefined);
    T.tick(1 / 60);
  }
  const st = startShot(T, "target", 6);
  const p = shotPose(T, st, 6)!;
  const s = T.sampleAt(6)!;
  const B = boomsOnScreen(s, p, [{ w: T.at(6)!.focus!, age: 0, size: 1 }], p.fov!, 1600, 900);
  expect(B[0]!.x).toBeCloseTo(800, 0);
  expect(B[0]!.y).toBeCloseTo(450, 0);
  expect(p.fov!).toBeLessThan(5);
  expect(directorShot(T, 6, "chase")).toBe("target");
  expect(directorShot(T, 6, "target")).not.toBe("target");
  expect(directorShot(T, 2, null)).not.toBe("target");
});

test("the director: a launch a frame long, 2 s ahead — the chase to see the missile leave", () => {
  const T = fill(20, (t) => ({ s: north(t, { agl: 50, speed: 250 }), ev: Math.abs(t - 7.03) < 0.009 ? EV.LAUNCH : 0 }));
  expect(T.frames.filter((f) => f.ev & EV.LAUNCH).length).toBe(1);
  expect(directorShot(T, 5, null)).toBe("chase");
  expect(directorShot(T, 5, "flyby")).toBe("chase");
});
