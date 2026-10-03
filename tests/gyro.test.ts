import { expect, test } from "bun:test";
import { advance, fromZamo, toZamo } from "../src/geodesic";
import { fourVelocity, kerrMetricBL, spinFromZamo, spinToZamo } from "../src/gyro";

// The ship's axes as gyroscopes near the hole (phase 2, Fermi–Walker): on a circular orbit of
// Schwarzschild the geodetic precession, 2π(1 − √(1 − 3M/r)) a turn in the orbit's sense; in Kerr, on
// an inclined eccentric orbit and under thrust, the axes stay unit and square to the 4-velocity.

const dot4 = (g: number[][], x: number[], y: number[]) => {
  let s = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += g[i]![j]! * x[i]! * y[j]!;
  return s;
};

test("the geodetic precession: a radial gyroscope after a circular turn at 10 M has turned 58.8° forward", () => {
  const r = 10;
  // (circular: v = √(M/(r − 2M)) relative to the static observer, φ̂ the motion)
  const beta: [number, number, number] = [0, 0, Math.sqrt(1 / (r - 2))];
  const st = fromZamo(r, Math.PI / 2, 0, beta, 0);
  const S = spinFromZamo(st, 0, beta, [1, 0, 0]);
  const T = 2 * Math.PI * Math.sqrt(r ** 3);
  const res = advance(st, 0, T, 0.05, 0, [0, 0, 0], undefined, 1e-10, [S]);
  // (back where it started: φ a full turn)
  expect(Math.abs(res.st.ph - 2 * Math.PI)).toBeLessThan(1e-4);
  const s = spinToZamo(res.st, 0, toZamo(res.st, 0), S);
  const psi = Math.atan2(s[2], s[0]);
  const want = 2 * Math.PI * (1 - Math.sqrt(1 - 3 / r));
  expect(Math.abs(psi - want)).toBeLessThan(1e-3);
  expect(Math.hypot(...s)).toBeCloseTo(1, 9);
});

test("in Kerr (a = 0.9), inclined and eccentric, thrust on and off: the axes stay unit and square to u", () => {
  const a = 0.9;
  const beta: [number, number, number] = [0.05, 0.1, 0.3];
  let st = fromZamo(14, 1.1, 0.3, beta, a);
  const sp = [spinFromZamo(st, a, beta, [0, 0.6, 0.8]), spinFromZamo(st, a, beta, [1, 0, 0])];
  let t = 0;
  for (let k = 0; k < 6; k++) {
    const r = advance(st, a, 60, 0.05, k % 2 ? 0.002 : 0, [0.3, 0.5, 0.8], undefined, 1e-9, sp);
    expect(r.stopped).toBe(false);
    st = r.st;
    t += 60;
  }
  const g = kerrMetricBL(st.r, st.th, a);
  const u = fourVelocity(st, a);
  for (const S of sp) {
    expect(Math.abs(dot4(g, u, S))).toBeLessThan(1e-9);
    expect(dot4(g, S, S)).toBeCloseTo(1, 9);
  }
  // (and square to each other: a gyroscope triad stays one)
  expect(Math.abs(dot4(g, sp[0]!, sp[1]!))).toBeLessThan(1e-9);
});
