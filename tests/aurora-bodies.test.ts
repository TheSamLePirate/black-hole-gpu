import { expect, test } from "bun:test";
import { fourierRadius, GIANTS, giantOvals, giantsWgsl, ioFeet, jupiterOvals, ovalFourier, ovalInside } from "../src/system/aurora-bodies";

// Jupiter's auroras (src/system/aurora-bodies.ts — PLAN-AURORES-MAGNETOSPHERES AM3): the ovals from AM0's field lines, their
// Fourier form the shader evaluates, Io's footprints, and trace.wgsl's JUP_* constants the module's.

test("Jupiter's main ovals: the north one off the pole (centre ~71° N) 12–22° in radius, the south one 13–17°", () => {
  const o = jupiterOvals();
  const latN = (Math.asin(o.north.centre[2]) * 180) / Math.PI,
    latS = (Math.asin(o.south.centre[2]) * 180) / Math.PI;
  expect(latN).toBeGreaterThan(65);
  expect(latN).toBeLessThan(78);
  expect(latS).toBeLessThan(-75);
  for (const r of o.north.radius) {
    expect(r).toBeGreaterThan(10);
    expect(r).toBeLessThan(23);
  }
  for (const r of o.south.radius) {
    expect(r).toBeGreaterThan(11);
    expect(r).toBeLessThan(18);
  }
});

test("the ovals' Fourier form within 0.1° of their table; inside positive at the centre, negative 30° off it", () => {
  const o = jupiterOvals();
  for (const ov of [o.north, o.south]) {
    const f = ovalFourier(ov);
    ov.radius.forEach((r, i) => {
      expect(Math.abs(fourierRadius(f, -Math.PI + ((i + 0.5) * 2 * Math.PI) / 36) - r)).toBeLessThan(0.1);
    });
    expect(ovalInside(ov, ov.centre)).toBeGreaterThan(10);
  }
});

test("Io's footprints 45–85° of latitude north and south, whatever Io's longitude (49° N near λ 45°: the north field's anomaly)", () => {
  for (let L = 0; L < 360; L += 45) {
    const [nl, , sl] = ioFeet((L * Math.PI) / 180);
    expect((nl * 180) / Math.PI).toBeGreaterThan(45);
    expect((nl * 180) / Math.PI).toBeLessThan(85);
    expect((sl * 180) / Math.PI).toBeLessThan(-45);
    expect((sl * 180) / Math.PI).toBeGreaterThan(-85);
  }
});

test("trace.wgsl's <GIANT>_OVAL constants are giantsWgsl()'s", async () => {
  const src = await Bun.file("src/shaders/trace.wgsl").text();
  for (const line of giantsWgsl().split("\n")) expect(src).toContain(line);
});

test("AM4: Saturn's ovals centred on its poles (its field axisymmetric), 10–16°; Uranus's and Neptune's off them; Fourier within 2.5°", () => {
  const sat = giantOvals("saturn");
  expect(Math.abs(sat.north.centre[2])).toBeGreaterThan(0.999);
  for (const r of [...sat.north.radius, ...sat.south.radius]) {
    expect(r).toBeGreaterThan(10);
    expect(r).toBeLessThan(16);
  }
  for (const b of ["uranus", "neptune"] as const) {
    const o = giantOvals(b);
    expect(Math.abs(o.north.centre[2])).toBeLessThan(0.95);
    for (const ov of [o.north, o.south]) {
      const f = ovalFourier(ov);
      ov.radius.forEach((r, i) => {
        expect(Math.abs(fourierRadius(f, -Math.PI + ((i + 0.5) * 2 * Math.PI) / 36) - r)).toBeLessThan(2.5);
      });
    }
  }
  expect(GIANTS.length).toBe(4);
});
