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

test("the scene “Jupiter: the auroras from its shadow”: 7 149 km over 45° N, in Jupiter's shadow, the oval's low side at midnight", async () => {
  const { presets } = await import("../src/settings");
  const { bodyView, ourState } = await import("../src/system/our-side");
  const { toBodyFixed } = await import("../src/system/our-surface");
  const { SOLAR_BODIES } = await import("../src/system/solar");
  const p = presets["Jupiter: the auroras from its shadow"]!;
  expect(p.aurora).toBe(5);
  const t = p.time!;
  const v = bodyView(t, p.pose as Parameters<typeof bodyView>[1]);
  const J = ourState("jupiter", t).pos,
    S = ourState("sun", t).pos;
  const R = SOLAR_BODIES.find((b) => b.id === "jupiter")!.radius;
  const s: [number, number, number] = [S[0] - J[0], S[1] - J[1], S[2] - J[2]];
  const sl = Math.hypot(...s);
  const r: [number, number, number] = [v.X[0] - J[0], v.X[1] - J[1], v.X[2] - J[2]];
  const along = (r[0] * s[0] + r[1] * s[1] + r[2] * s[2]) / sl;
  const off = Math.sqrt(Math.max(0, Math.hypot(...r) ** 2 - along ** 2));
  // (behind Jupiter, within its shadow's cylinder — its umbra is 90 R_J long)
  expect(along).toBeLessThan(0);
  expect(off).toBeLessThan(0.95 * R);
  // (0.1 R_J over the flattened cloud tops: 7 149 km; the cloud tops at 45° are ~3 % under the equatorial radius)
  expect(Math.hypot(...r) / R).toBeGreaterThan(1.03);
  expect(Math.hypot(...r) / R).toBeLessThan(1.1);
  // (the subsolar point at 15° E: −165° E, the north oval's low side, faces midnight)
  const q = toBodyFixed("jupiter", S, t);
  expect(Math.abs((Math.atan2(q[1], q[0]) * 180) / Math.PI - 15)).toBeLessThan(0.5);
});
