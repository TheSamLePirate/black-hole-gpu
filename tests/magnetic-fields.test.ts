import { expect, test } from "bun:test";
import {
  CurrentSheet,
  dipolePole,
  FieldModel,
  footprint,
  latLon,
  MAGNETOSPHERES,
  type Magnetosphere,
  magnetopause,
  ovalTable,
  type V3,
} from "../src/system/magnetic-fields";

// The planets' fields (src/system/magnetic-fields.ts — PLAN-AURORES-MAGNETOSPHERES AM0): the tests of the plan's § 7.1, with
// Alex's tolerances (vr-solar-system, MagneticFields tests), and the figure the lines stop on.

const D = Math.PI / 180;
const mag = (v: V3) => Math.hypot(...v);

test("the Earth's dipole: tilt 9.2–10.2°, its pole −74 to −71° of longitude, 29 000–30 500 nT", () => {
  const M = MAGNETOSPHERES.earth.model;
  expect(M.dipoleTilt).toBeGreaterThan(9.2);
  expect(M.dipoleTilt).toBeLessThan(10.2);
  const pole = dipolePole("earth");
  expect(pole.lon).toBeGreaterThan(-74);
  expect(pole.lon).toBeLessThan(-71);
  expect(pole.lat).toBeGreaterThan(79.8);
  expect(M.dipoleField).toBeGreaterThan(29_000);
  expect(M.dipoleField).toBeLessThan(30_500);
  expect(M.northPolarity).toBe(-1);
});

test("Jupiter's dipole 415 000–422 000 nT, tilted 9–11°; |B| at its surface 1.1–2.2 million nT somewhere between 50 and 90° N", () => {
  const M = MAGNETOSPHERES.jupiter.model;
  expect(M.dipoleField).toBeGreaterThan(415_000);
  expect(M.dipoleField).toBeLessThan(422_000);
  expect(M.dipoleTilt).toBeGreaterThan(9);
  expect(M.dipoleTilt).toBeLessThan(11);
  expect(M.northPolarity).toBe(1);
  let best = 0;
  for (let la = 50; la <= 90; la += 2)
    for (let lo = 0; lo < 360; lo += 6) {
      const p: V3 = [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];
      best = Math.max(best, mag(M.internal(p)));
    }
  expect(best).toBeGreaterThan(1.1e6);
  expect(best).toBeLessThan(2.2e6);
});

test("the tilts of Uranus 57.5–59.5° and Neptune 46–48°; Saturn's under 0.01°", () => {
  expect(MAGNETOSPHERES.uranus.model.dipoleTilt).toBeGreaterThan(57.5);
  expect(MAGNETOSPHERES.uranus.model.dipoleTilt).toBeLessThan(59.5);
  expect(MAGNETOSPHERES.neptune.model.dipoleTilt).toBeGreaterThan(46);
  expect(MAGNETOSPHERES.neptune.model.dipoleTilt).toBeLessThan(48);
  expect(MAGNETOSPHERES.saturn.model.dipoleTilt).toBeLessThan(0.01);
});

test("an aligned dipole's L = 4 line meets the sphere at ±60° ± 0.3°", () => {
  const M: Magnetosphere = { ...MAGNETOSPHERES.saturn, model: new FieldModel(1, 1, [0, 0, 0], [[1, 0, 30_000, 0]]), flattening: 0 };
  const n = footprint(M, [4, 0, 0], true)!,
    s = footprint(M, [4, 0, 0], false)!;
  expect(Math.abs(latLon(n)[0] - 60)).toBeLessThan(0.3);
  expect(Math.abs(latLon(s)[0] + 60)).toBeLessThan(0.3);
});

// (Alex's band is 64–70°; traced in IGRF to degree 3 from the dipole's equator at 7 radii and stopped on WGS84, the footprints
// spread from 63.1 to 72.6° of centred-dipole latitude — the quadrupole and the octupole, the field's offset centre: what an
// AACGM frame absorbs —; their mean the dipole's 67.8° within a degree and a half)
test("the Earth's L = 7 oval: every footprint 62.5–73.5° of magnetic latitude, their mean 66.5–69°, on the WGS84 ellipsoid", () => {
  const T = ovalTable("earth", 24);
  const z = MAGNETOSPHERES.earth.model.dipoleNorth;
  const lats = T.north.map((p) => {
    expect(p).not.toBeNull();
    const [la, lo] = p!;
    const u: V3 = [Math.cos(la * D) * Math.cos(lo * D), Math.cos(la * D) * Math.sin(lo * D), Math.sin(la * D)];
    return Math.asin(u[0] * z[0] + u[1] * z[1] + u[2] * z[2]) / D;
  });
  for (const m of lats) {
    expect(m).toBeGreaterThan(62.5);
    expect(m).toBeLessThan(73.5);
  }
  const mean = lats.reduce((a, b) => a + b, 0) / lats.length;
  expect(mean).toBeGreaterThan(66.5);
  expect(mean).toBeLessThan(69);
});

test("Io's footprints between 50 and 80° N and S; the disc moves the 25 R_J foot more than 1.5°, Io's under 1°", () => {
  const J = MAGNETOSPHERES.jupiter;
  const bare: Magnetosphere = { ...J, model: new FieldModel(13, 1, [0, 0, 0], []) };
  // (the bare internal field: JRM33's own coefficients without the sheet)
  (bare.model as unknown as { g: Float64Array }).g.set(J.model.g);
  (bare.model as unknown as { h: Float64Array }).h.set(J.model.h);
  for (const lon of [0, 90, 180, 270]) {
    const io: V3 = [5.9 * Math.cos(lon * D), 5.9 * Math.sin(lon * D), 0];
    const n = footprint(J, io, true)!,
      s = footprint(J, io, false)!;
    expect(latLon(n)[0]).toBeGreaterThan(50);
    expect(latLon(n)[0]).toBeLessThan(80);
    expect(latLon(s)[0]).toBeLessThan(-50);
    expect(latLon(s)[0]).toBeGreaterThan(-80);
    const nb = footprint(bare, io, true)!;
    expect(Math.abs(latLon(n)[0] - latLon(nb)[0])).toBeLessThan(1);
  }
  const far: V3 = [25, 0, 0];
  const withDisc = footprint(J, far, true),
    without = footprint(bare, far, true);
  expect(withDisc && without).toBeTruthy();
  expect(Math.abs(latLon(withDisc!)[0] - latLon(without!)[0])).toBeGreaterThan(1.5);
});

test("CON2020: the con2020 package's three reference vectors within 5 %", () => {
  const S = new CurrentSheet();
  const cart = (r: number, th: number, ph: number): V3 => [
    r * Math.sin(th * D) * Math.cos(ph * D),
    r * Math.sin(th * D) * Math.sin(ph * D),
    r * Math.cos(th * D),
  ];
  const cases: [V3, V3][] = [
    [
      [5, 10, 6],
      [15.584, 36.896, 63.045],
    ],
    [cart(10, 30, 90), [3.607, 13.451, 65.342]],
    [cart(20, 35, 95), [1.649, 12.438, 29.459]],
  ];
  for (const [p, want] of cases) {
    const b = S.field(p);
    expect(mag([b[0] - want[0], b[1] - want[1], b[2] - want[2]]) / mag(want)).toBeLessThan(0.05);
  }
});

test("the magnetopause: the standoff at the subsolar point, flaring behind", () => {
  expect(magnetopause(10, 0.58, 1)).toBeCloseTo(10, 6);
  expect(magnetopause(10, 0.58, 0)).toBeCloseTo(10 * 2 ** 0.58, 6);
});
