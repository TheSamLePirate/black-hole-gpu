import { expect, test } from "bun:test";
import { aeroForces, airAt, freeMolecular, type V3 } from "../src/aero";
import { VESSELS } from "../src/vessels";

// The aerodynamics by surfaces (phase 2): the wing's two halves (the roll damped by the wing itself, the
// dihedral's roll away from a sideslip), the fin (the nose turned into the flow), the ground effect,
// the thin air's free molecular regime (ship frame: x left, y up, z nose; moments about the centre of
// mass, right-handed on those axes).

const A = VESSELS.ranger.aero;
const sea = airAt({ rho0: 1.225, H: 8500, model: "us76" }, 0);
const D = Math.PI / 180;
/** The flow seen at α, β (the craft's motion through the air, ship frame) [m/s]. */
const flight = (V: number, alpha: number, beta = 0): V3 => [
  V * Math.sin(beta),
  -V * Math.sin(alpha) * Math.cos(beta),
  V * Math.cos(alpha) * Math.cos(beta),
];

test("symmetric flight: no roll, no yaw", () => {
  const o = aeroForces(A, flight(120, 6 * D), sea);
  expect(Math.abs(o.M[2])).toBeLessThan(1e-6 * Math.abs(o.L));
  expect(Math.abs(o.M[1])).toBeLessThan(1e-6 * Math.abs(o.L));
  expect(o.L).toBeGreaterThan(0);
});

test("rolling: the wing's halves damp it (the moment against the rate)", () => {
  const o = aeroForces(A, flight(120, 6 * D), sea, [0, 0, 0.5]);
  expect(o.M[2]).toBeLessThan(0);
  const back = aeroForces(A, flight(120, 6 * D), sea, [0, 0, -0.5]);
  expect(back.M[2]).toBeGreaterThan(0);
});

test("a sideslip to the left: the dihedral rolls the craft right, the fin turns the nose left into the flow", () => {
  const flat = { ...A, wing: { ...A.wing!, dihedral: 0 }, fin: undefined };
  const o = aeroForces(A, flight(120, 6 * D, 5 * D), sea);
  const o0 = aeroForces(flat, flight(120, 6 * D, 5 * D), sea);
  // (moving to its left: roll about +z — the left wing up — from the dihedral)
  expect(o.M[2] - o0.M[2]).toBeGreaterThan(0);
  // (and a yaw about +y — the nose towards +x, its left — from the fin)
  const noFin = { ...A, fin: undefined };
  expect(aeroForces(A, flight(120, 6 * D, 5 * D), sea).M[1] - aeroForces(noFin, flight(120, 6 * D, 5 * D), sea).M[1]).toBeGreaterThan(0);
});

test("the ground effect: within a span of the ground, the induced drag falls and the lift rises", () => {
  const free = aeroForces(A, flight(100, 8 * D), sea);
  const near = aeroForces(A, flight(100, 8 * D), sea, [0, 0, 0], { agl: 2 });
  expect(near.L).toBeGreaterThan(free.L);
  expect(near.D).toBeLessThan(free.D);
});

test("the free molecular regime: none at sea level, most of it at 160 km; a drag coefficient of ~2.2 there", () => {
  const earth = { rho0: 1.225, H: 8500, model: "us76" as const };
  expect(freeMolecular(sea, A.len)).toBeLessThan(1e-3);
  const high = airAt(earth, 160e3);
  expect(freeMolecular(high, A.len)).toBeGreaterThan(0.9);
  // (belly first, as an entry: the drag over q and the belly's area)
  const o = aeroForces(A, flight(7800, 40 * D), high);
  const proj = A.area[1] * Math.sin(40 * D) + A.area[2] * Math.cos(40 * D);
  expect(o.D / o.q / proj).toBeGreaterThan(1.9);
  expect(o.D / o.q / proj).toBeLessThan(2.4);
  // (the heat bounded by what the molecules bring: ½ ρ V³)
  expect(o.heat).toBeLessThanOrEqual(0.5 * high.rho * 7800 ** 3 * 1.0001);
});
