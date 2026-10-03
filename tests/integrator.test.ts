import { expect, test } from "bun:test";
import { symmetricStep, YOSHIDA } from "../src/system/our-predict";

// The coast's integrator (phase 2, audit P6): Yoshida's composition at a step a fraction of the fall
// time. Chosen at the step's start alone the steps break the symplecticity — a transfer orbit's energy
// (e = 0.73) drifts 2e-5 over 200 turns —; symmetrised in time (the fall times at both ends), it holds
// to 1e-9 for the same pulls.

type V = [number, number, number];
const acc = (x: V): V => {
  const k = -1 / Math.hypot(...x) ** 3;
  return [x[0] * k, x[1] * k, x[2] * k];
};
const energy = (x: V, v: V) => (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - 1 / Math.hypot(...x);

function drift(symmetric: boolean, turns = 200, s = 0.02) {
  const e = 0.73;
  let x: V = [1 - e, 0, 0],
    v: V = [0, Math.sqrt((1 + e) / (1 - e)), 0];
  const E0 = energy(x, v);
  let t = 0;
  while (t < 2 * Math.PI * turns) {
    const r = Math.hypot(...x);
    const tDyn = Math.sqrt(r ** 3);
    const tDot = (1.5 * tDyn * (x[0] * v[0] + x[1] * v[1] + x[2] * v[2])) / (r * r);
    const dt = symmetric ? symmetricStep(s, tDyn, tDot) : s * tDyn;
    for (const w of YOSHIDA) {
      const h = w * dt;
      let a = acc(x);
      v = [v[0] + (a[0] * h) / 2, v[1] + (a[1] * h) / 2, v[2] + (a[2] * h) / 2];
      x = [x[0] + v[0] * h, x[1] + v[1] * h, x[2] + v[2] * h];
      a = acc(x);
      v = [v[0] + (a[0] * h) / 2, v[1] + (a[1] * h) / 2, v[2] + (a[2] * h) / 2];
    }
    t += dt;
  }
  return Math.abs((energy(x, v) - E0) / E0);
}

test("a transfer orbit over 200 turns: the symmetric step holds its energy to 1e-8, the one-sided one does not", () => {
  expect(drift(false)).toBeGreaterThan(1e-6);
  expect(drift(true)).toBeLessThan(1e-8);
});
