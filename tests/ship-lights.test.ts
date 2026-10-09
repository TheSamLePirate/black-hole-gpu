import { expect, test } from "bun:test";
import { lampLevels, lampUniform, MAX_LAMPS, placeLamps, RANGER_LAMPS, strobeAt } from "../src/ship-lights";
import { TriBVH } from "../src/system/collide";

// PLAN-COCKPIT K6: the Ranger's own lights — set on its hull (its mesh), lit by the cockpit's switches, the
// strobes' double flash, the uniform the shader reads.

async function hull() {
  const raw = await Bun.file(`${import.meta.dir}/../assets/ranger/ranger.bin`).arrayBuffer();
  const ab = new TextDecoder().decode(new Uint8Array(raw, 0, 4)) === "RNGR" ? raw : Bun.gunzipSync(new Uint8Array(raw)).buffer;
  const u = new Uint32Array(ab, 0, 4);
  const nv = u[2]!,
    ni = u[3]!;
  const src = new Float32Array(ab, 40, nv * 8);
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) pos.set(src.subarray(8 * i, 8 * i + 3), 3 * i);
  return new TriBVH(pos, new Uint32Array(ab, 40 + nv * 32, ni));
}

test("set on the hull: each lamp within a few centimetres of it, where it was meant — red left, green right", async () => {
  const H = await hull();
  const P = placeLamps(H);
  expect(P.length).toBe(RANGER_LAMPS.length);
  for (const L of P) {
    // (on the hull: 3 cm out of where the ray met it, near where it was said)
    expect(Math.hypot(L.p[0] - L.at[0], L.p[1] - L.at[1], L.p[2] - L.at[2])).toBeLessThan(0.6);
    expect(Math.hypot(...L.n)).toBeCloseTo(1, 6);
    expect(L.n[0] * L.out[0] + L.n[1] * L.out[1] + L.n[2] * L.out[2]).toBeGreaterThan(0);
  }
  const by = (id: string) => P.find((l) => l.id === id)!;
  // (the ship's x is to its left: red there, green on the right; the tail light aft)
  expect(by("navLeft").p[0]).toBeGreaterThan(3.8);
  expect(by("navLeft").colour[0]).toBeGreaterThan(by("navLeft").colour[1]);
  expect(by("navRight").p[0]).toBeLessThan(-3.6);
  expect(by("navRight").colour[1]).toBeGreaterThan(by("navRight").colour[0]);
  expect(by("navTail").p[2]).toBeLessThan(-5);
  // (missed: where it was said)
  expect(placeLamps(null)[0]!.p).toEqual(RANGER_LAMPS[0]!.at);
});

test("the switches, the strobes' double flash, the uniform: those lit only", () => {
  const flashes = Array.from({ length: 1200 }, (_, i) => strobeAt(i / 1000));
  // (two 50 ms flashes in each 1.2 s)
  expect(flashes.reduce((a, b) => a + b, 0)).toBe(100);
  expect(strobeAt(0.01)).toBe(1);
  expect(strobeAt(0.1)).toBe(0);
  expect(strobeAt(0.17)).toBe(1);
  expect(strobeAt(1.2 + 0.01)).toBe(1);
  const off = lampLevels(RANGER_LAMPS, { navLights: false, strobeLights: false, landingLights: false }, 0);
  expect(off.every((x) => x === 0)).toBe(true);
  const nav = lampLevels(RANGER_LAMPS, { navLights: true, strobeLights: true, landingLights: false }, 0.5);
  expect(nav).toEqual([1, 1, 1, 0, 0, 0, 0]);
  const P = placeLamps(null);
  const u = lampUniform(P, nav);
  expect(u.length).toBe(4 + MAX_LAMPS * 12);
  expect(u[0]).toBe(3);
  // (the first lit: the red one, all round; then the landing lights' beams when on)
  expect([...u.subarray(4, 8)]).toEqual([...P[0]!.p.map((x) => Math.fround(x)), Math.fround(0.05)]);
  expect(u[15]).toBe(-2);
  const land = lampUniform(P, lampLevels(RANGER_LAMPS, { navLights: false, strobeLights: false, landingLights: true }, 0));
  expect(land[0]).toBe(2);
  expect(land[4 + 11]).toBeGreaterThan(0.9);
  expect(land[4 + 10]).toBeGreaterThan(0.9);
});
