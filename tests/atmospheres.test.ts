import { expect, test } from "bun:test";
import { airAt, airRaw, airTop, type Atmosphere } from "../src/aero";
import type { Vec3 } from "../src/physics";
import { dragAccel, railsDecay } from "../src/system/our-surface";
import { solarBody, solarState } from "../src/system/solar";
import { C_MPS, M_METRES, M_SECONDS } from "../src/units";

// The worlds' measured atmospheres (audit P3) and the thin air's drag on orbits (P7): Venus, Mars and
// Titan from their reference profiles — no more isothermal exponentials orders of magnitude off —, the
// speed of sound with their temperature; above the flight's air, the thermosphere decays an orbit (the
// ISS: about a hundred metres a day), on rails as integrated.

const atm = (id: string) => solarBody(id)!.atmosphere as Atmosphere;

test("Venus, Mars, Titan: their reference densities, decreasing all the way up", () => {
  const near = (x: number, want: number, tol: number) => expect(Math.abs(Math.log(x / want))).toBeLessThan(Math.log(1 + tol));
  near(airRaw(atm("venus"), 0).rho, 64.79, 0.01);
  near(airRaw(atm("venus"), 50e3).rho, 1.61, 0.01);
  near(airRaw(atm("mars"), 0).rho, 0.0146, 0.01);
  near(airRaw(atm("titan"), 0).rho, 5.43, 0.01);
  near(airRaw(atm("titan"), 100e3).rho, 5.7e-3, 0.01);
  // (Venus at 130 km: ~10⁻⁷ kg/m³ — the exponential gave 2·10⁻²)
  const v130 = airRaw(atm("venus"), 130e3).rho;
  expect(v130).toBeGreaterThan(3e-8);
  expect(v130).toBeLessThan(5e-7);
  for (const id of ["venus", "mars", "titan"]) {
    let last = Infinity;
    for (let h = 0; h <= 1.5e6; h += 2e3) {
      const r = airRaw(atm(id), h).rho;
      expect(r).toBeLessThan(last);
      last = r;
    }
  }
});

test("the speed of sound follows the temperature (Venus's clouds: ~290 m/s, not the surface's 410)", () => {
  const a50 = airAt(atm("venus"), 50e3).a;
  expect(a50).toBeGreaterThan(260);
  expect(a50).toBeLessThan(320);
  expect(airAt(atm("venus"), 0).a).toBeGreaterThan(380);
});

test("the air's top where it thins to 10⁻¹⁰ kg/m³: Venus ~190 km, Mars ~160 km, Titan ~950 km", () => {
  const top = (id: string) => airTop(atm(id)) / 1e3;
  expect(top("venus")).toBeGreaterThan(160);
  expect(top("venus")).toBeLessThan(230);
  expect(top("mars")).toBeGreaterThan(130);
  expect(top("mars")).toBeLessThan(200);
  expect(top("titan")).toBeGreaterThan(800);
  expect(top("titan")).toBeLessThan(1100);
  expect(top("earth")).toBeGreaterThan(200);
});

test("the ISS's orbit decays about a hundred metres a day, on rails as integrated", () => {
  const B = 130;
  const mu = solarBody("earth")!.mass;
  const R = solarBody("earth")!.radius;
  const t0 = 0;
  const E = solarState("earth", t0);
  const r0 = R + 400e3 / M_METRES;
  const v0 = Math.sqrt(mu / r0);
  // (relative to the Earth's centre: its pull alone and the drag — the air turning with it —, the code's units)
  let X: Vec3 = [r0, 0, 0];
  let V: Vec3 = [0, v0, 0];
  const acc = (x: Vec3, v: Vec3): Vec3 => {
    const r = Math.hypot(...x);
    const f = dragAccel(
      "earth",
      [E.pos[0] + x[0], E.pos[1] + x[1], E.pos[2] + x[2]],
      [E.vel[0] + v[0], E.vel[1] + v[1], E.vel[2] + v[2]],
      t0,
      B,
    );
    return [(-mu * x[0]) / r ** 3 + f[0], (-mu * x[1]) / r ** 3 + f[1], (-mu * x[2]) / r ** 3 + f[2]];
  };
  const day = 86400 / M_SECONDS,
    n = 20000,
    h = day / n;
  let a = acc(X, V);
  for (let i = 0; i < n; i++) {
    V = [V[0] + (a[0] * h) / 2, V[1] + (a[1] * h) / 2, V[2] + (a[2] * h) / 2];
    X = [X[0] + V[0] * h, X[1] + V[1] * h, X[2] + V[2] * h];
    a = acc(X, V);
    V = [V[0] + (a[0] * h) / 2, V[1] + (a[1] * h) / 2, V[2] + (a[2] * h) / 2];
  }
  const semi = (x: Vec3, v: Vec3) => -mu / (2 * ((v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - mu / Math.hypot(...x)));
  const lostInt = (r0 - semi(X, V)) * M_METRES;
  const k = railsDecay("earth", mu, [r0, 0, 0], [0, v0, 0], day, B);
  const lostRails = (r0 - Math.hypot(...k.r)) * M_METRES;
  expect(lostInt).toBeGreaterThan(40);
  expect(lostInt).toBeLessThan(250);
  expect(Math.abs(lostRails - lostInt) / lostInt).toBeLessThan(0.25);
  expect(C_MPS).toBeGreaterThan(0);
});
