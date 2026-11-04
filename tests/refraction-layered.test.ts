import { expect, test } from "bun:test";
import { bennett } from "../src/system/refraction";
import {
  airProfile,
  apparentElevation,
  BENNETT_AIR,
  bendingUp,
  ciddorRefractivity,
  limbBending,
  refraction,
  us76Temperature,
} from "../src/system/refraction-layered";

// R1 — the layered air's refraction (src/system/refraction-layered.ts) against its references (docs/PLAN-REFRACTION-HORIZONS.md
// R1's unit tests): Ciddor against NIST's calculator, Bennett within 3 % from 0.5° to 45°, the setting Sun flattened 0.81–0.83,
// a tangent ray at 20 km from orbit 5.57′, the refraction monotonic, a ray under the horizon from a height.

const D = Math.PI / 180;
const AM = (180 * 60) / Math.PI;
const P = airProfile(BENNETT_AIR);

test("Ciddor: NIST's values at 633 nm (dry 15 °C; 20 °C 50 %)", () => {
  // (NIST's Engineering Metrology Toolbox, Ciddor: 2.7653e-4 and 2.7137e-4)
  expect(ciddorRefractivity(101325, 15, 0, 0.633)).toBeCloseTo(2.7653e-4, 7);
  expect(ciddorRefractivity(101325, 20, 0.5, 0.633)).toBeCloseTo(2.7137e-4, 7);
});

test("the standard atmosphere's temperatures; the profile hydrostatic (the pressure halves near 5.5 km)", () => {
  expect(us76Temperature(0)).toBeCloseTo(288.15, 6);
  expect(us76Temperature(15000)).toBeCloseTo(216.65, 6);
  const std = airProfile({ pMsl: 101325, tGround: 15, rh: 0 });
  // (n − 1 ∝ the density; at 5.5 km the density is ~0.56 of the sea's, the pressure ~0.50)
  expect(std.N[550]! / std.N[0]!).toBeGreaterThan(0.54);
  expect(std.N[550]! / std.N[0]!).toBeLessThan(0.58);
});

test("Bennett within 3 % from 0.5° to 45° (10 °C, 1 010 hPa)", () => {
  for (const deg of [0.5, 1, 2, 5, 10, 20, 45]) {
    const r = bendingUp(P, 0, deg * D) / bennett(deg * D);
    expect(r).toBeGreaterThan(0.97);
    expect(r).toBeLessThan(1.03);
  }
});

test("the refraction falls with the elevation, none at the zenith", () => {
  let last = Number.POSITIVE_INFINITY;
  for (let deg = 0; deg <= 90; deg += 2.5) {
    const r = bendingUp(P, 0, deg * D);
    expect(r).toBeLessThan(last);
    last = r;
  }
  expect(bendingUp(P, 0, 90 * D) * AM).toBeLessThan(0.01);
});

test("the setting Sun flattened 0.81–0.83 (its lower limb on the sea's horizon)", () => {
  const disc = 0.5333 * D;
  const trueLow = -(refraction(P, 0, 0) ?? 0);
  const up = apparentElevation(P, trueLow + disc, 0)!;
  expect(up / disc).toBeGreaterThan(0.81);
  expect(up / disc).toBeLessThan(0.83);
});

test("a tangent ray from orbit: 5.57′ at 20 km; ~70′ grazing the sea (twice the horizon's)", () => {
  expect(limbBending(P, 20000) * AM).toBeCloseTo(5.57, 1);
  const grazing = limbBending(P, 0) * AM;
  expect(grazing).toBeGreaterThan(64);
  expect(grazing).toBeLessThan(72);
  expect(Math.abs(grazing / 2 - (refraction(P, 0, 0) ?? 0) * AM)).toBeLessThan(0.01);
});

test("under the horizon from a height: down to its tangent and up — more than the horizon's from the ground; the ground met is null", () => {
  const dip = refraction(P, -2 * D, 10000);
  expect(dip).not.toBeNull();
  expect(dip! * AM).toBeGreaterThan(30);
  expect(refraction(P, -0.5 * D, 0)).toBeNull();
});
