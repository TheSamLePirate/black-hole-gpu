import { expect, test } from "bun:test";
import { airAt, GASES, GIANT_AIR, giantT } from "../src/aero";

// PLAN-PLANETES-AAA P11 D1: the giants' air — hydrostatic profiles from their measured temperatures, below the 1 bar level
// too — and Galileo's entry into Jupiter flown through it.

const jupiter = { rho0: 0.16, H: 25e3, model: "jupiter" as const, gas: "h2heJ" as const };
const saturn = { rho0: 0.19, H: 50e3, model: "saturn" as const, gas: "h2heS" as const };

test("1 bar at the 1 bar level, its temperature Galileo's and Cassini's; the scale heights ~25 and ~50 km", () => {
  for (const [atm, G, T1, H] of [
    [jupiter, GIANT_AIR.jupiter, 166.1, 25e3],
    [saturn, GIANT_AIR.saturn, 134.8, 52e3],
  ] as const) {
    const a = airAt(atm, 0);
    expect(a.T).toBeCloseTo(T1, 1);
    expect((a.rho * G.R * a.T) / 1e5).toBeCloseTo(1, 3);
    // (the pressure's e-folding over the first kilometres up: R T / g)
    const up = airAt(atm, 5e3);
    const Hm = 5e3 / Math.log((a.rho * a.T) / (up.rho * up.T));
    expect(Math.abs(Hm - H) / H).toBeLessThan(0.15);
  }
});

test("down to 22 bar: Galileo's 428 K, ~130–160 km under the 1 bar level", () => {
  const G = GIANT_AIR.jupiter;
  expect(giantT(G, 21.7)).toBeGreaterThan(420);
  expect(giantT(G, 21.7)).toBeLessThan(436);
  // (the height where the pressure is 21.7 bar)
  let z = 0;
  for (; z > -400e3; z -= 500) {
    const a = airAt(jupiter, z);
    if ((a.rho * G.R * a.T) / 1e5 >= 21.7) break;
  }
  expect(z).toBeLessThan(-120e3);
  expect(z).toBeGreaterThan(-170e3);
  // (monotonic: denser and hotter down)
  expect(airAt(jupiter, -50e3).rho).toBeGreaterThan(airAt(jupiter, 0).rho);
  expect(airAt(jupiter, -50e3).T).toBeGreaterThan(airAt(jupiter, 0).T);
  // (the tropopause the coldest)
  const tropo = Math.min(...Array.from({ length: 40 }, (_, i) => airAt(jupiter, 2e3 * i).T));
  expect(tropo).toBeLessThan(120);
});

test("Galileo's entry, flown through this air: its peak deceleration ~228 g (here ~250: within its stratosphere's spread)", () => {
  // (the probe: 339 kg, 1.26 m across, a 45° sphere-cone Cd ~1.05; 47.4 km/s relative to the air, 8.6° down, at 450 km over
  // the 1 bar level — Seiff et al. 1998: peak 228 g; planar, gravity kept, the planet's curvature over the pass left out)
  const m = 339,
    A = Math.PI * 0.63 ** 2,
    Cd = 1.05,
    g = GIANT_AIR.jupiter.g;
  let x = 0,
    h = 450e3,
    vx = 47.4e3 * Math.cos((8.6 * Math.PI) / 180),
    vz = -47.4e3 * Math.sin((8.6 * Math.PI) / 180);
  let peak = 0;
  const dt = 0.005;
  for (let t = 0; t < 400 && h > -50e3; t += dt) {
    const v = Math.hypot(vx, vz);
    const a = (0.5 * airAt(jupiter, h).rho * v * v * Cd * A) / m;
    peak = Math.max(peak, a);
    vx -= ((a * vx) / v) * dt;
    vz += (-(a * vz) / v - g + (vx * vx) / (71492e3 + h)) * dt;
    x += vx * dt;
    h += vz * dt;
  }
  const gs = peak / 9.80665;
  expect(gs).toBeGreaterThan(180);
  expect(gs).toBeLessThan(280);
  expect(GASES.h2heJ.R).toBeCloseTo(3745, -1);
});
