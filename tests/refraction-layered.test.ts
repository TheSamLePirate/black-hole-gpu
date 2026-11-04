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

test("TARS's figures (layeredReport): the horizon's refraction, a low Sun's apparent altitude, in a fraction of a second", async () => {
  const { layeredReport } = await import("../src/system/refraction-layered");
  const { seaRefractivity } = await import("../src/system/refraction");
  const t0 = performance.now();
  const r = layeredReport(seaRefractivity(10), 0, 0.5);
  const ms = performance.now() - t0;
  expect(r.horizonArcmin).toBeGreaterThan(33);
  expect(r.horizonArcmin).toBeLessThan(37);
  // (the Sun's centre 0.5° up: raised by ~28′)
  expect(r.apparentAltDeg! - 0.5).toBeGreaterThan(0.4);
  expect(r.apparentAltDeg! - 0.5).toBeLessThan(0.55);
  expect(r.groundTempC).toBeCloseTo(10, 0);
  expect(ms).toBeLessThan(1500);
  // (from 10 km: the level ray through thinner air — less than from the sea)
  expect(layeredReport(seaRefractivity(10), 10000, -2).horizonArcmin).toBeLessThan(r.horizonArcmin);
});

test("the real weather's air (airOfModel): the sea-level pressure given or reduced from the ground's, the humidity from the dew point", async () => {
  const { airOfModel } = await import("../src/system/refraction-layered");
  const given = airOfModel({ T: 20, Td: 10, p: 950, pMsl: 1015 });
  expect(given.pMsl).toBe(101500);
  expect(given.rh).toBeCloseTo(0.53, 1);
  // (a station 540 m up at 950 hPa: ~1 012 hPa at the sea)
  const reduced = airOfModel({ T: 15, Td: 15, p: 950 }, 540);
  expect(reduced.pMsl / 100).toBeGreaterThan(1005);
  expect(reduced.pMsl / 100).toBeLessThan(1020);
  expect(reduced.rh).toBeCloseTo(1, 3);
});

test("the tables (B_haut, B_limbe) against the integral: within 3″ everywhere sampled, built in well under a few seconds", async () => {
  const { buildTables, tableBendingUp, tableLimb } = await import("../src/system/refraction-layered");
  const t0 = performance.now();
  const T = buildTables(BENNETT_AIR);
  expect(performance.now() - t0).toBeLessThan(5000);
  const AS = (180 * 3600) / Math.PI;
  // (a fixed sequence of points: heights to 30 km, elevations to 90°, dense near the ground and the horizon)
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let worstHaut = 0;
  for (let k = 0; k < 300; k++) {
    const h = rnd() ** 3 * 30000,
      e = rnd() ** 2 * 90 * D;
    worstHaut = Math.max(worstHaut, Math.abs(tableBendingUp(T, h, e) - bendingUp(P, h, e)) * AS);
  }
  let worstLimb = 0;
  for (let k = 0; k < 150; k++) {
    const ht = rnd() ** 2 * 60000;
    worstLimb = Math.max(worstLimb, Math.abs(tableLimb(T, ht) - limbBending(P, ht)) * AS);
  }
  expect(worstHaut).toBeLessThan(3);
  expect(worstLimb).toBeLessThan(3);
}, 30_000);
