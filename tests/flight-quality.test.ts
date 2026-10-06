import { expect, test } from "bun:test";
import { oscillations } from "./flight/lib/quality";

// The flight lab's measure of α's oscillations: reversals that come in trains, not the manoeuvres a glide
// flies one at a time (a pull-up, a push-over).

const at = (f: (t: number) => number, n = 200) => {
  const t = Array.from({ length: n }, (_, i) => i);
  return { t, v: t.map(f) };
};

test("one pull-up and one push-over, a minute apart: no oscillation", () => {
  const { t, v } = at((s) => (s > 40 && s < 50 ? 12 : s > 110 && s < 118 ? -4 : 6));
  expect(oscillations(t, v, 2)).toBe(0);
});

test("a 6 s oscillation of ±3° for half a minute: counted, each reversal", () => {
  const { t, v } = at((s) => (s > 60 && s < 90 ? 6 + 3 * Math.sin((2 * Math.PI * s) / 6) : 6));
  const n = oscillations(t, v, 2);
  expect(n).toBeGreaterThanOrEqual(8);
  expect(n).toBeLessThanOrEqual(11);
});

test("wiggles under 2°: none", () => {
  const { t, v } = at((s) => 6 + 0.8 * Math.sin(s));
  expect(oscillations(t, v, 2)).toBe(0);
});
