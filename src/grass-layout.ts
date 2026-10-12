// The grass field's density, a smooth function of the distance to the character (no ring where a band ends),
// and the whole blades each 1 m cell carries. Pure: shared by the root generation and its tests.
import { seed } from "./system/scenery-data";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Blades per m² at a distance d (m) from the character: 130 at the centre, falling smoothly to 8 at 16 m and beyond.
 * Its means over the rings are the former bands' (120 within 6 m, 40 from 6 to 16 m, 8 beyond), the total the same. */
export function grassDensity(d: number): number {
  return 8 + 122 * (1 - smoothstep(2, 16, d));
}

/** Whole blades in the cell (hx, hz) for an expected count `want`: the fraction is decided by the cell's own seed,
 * so the same cell carries the same blades every time it is generated. */
export function bladesInCell(want: number, hx: number, hz: number): number {
  const whole = Math.floor(want);
  return whole + (seed(hx * 7 + 3, hz * 5 + 1) < want - whole ? 1 : 0);
}
