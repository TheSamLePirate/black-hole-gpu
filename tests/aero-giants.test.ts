import { expect, test } from "bun:test";
import { airAt, GASES, GIANT_AIR, giantT, type V3 } from "../src/aero";

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

test("D1b: the giants' air on the bodies — signed heights below 1 bar, G1's winds, the default orbit above the air's top", async () => {
  const { airDensity } = await import("../src/system/our-surface");
  const { giantWindAt } = await import("../src/system/giant-winds");
  const { defaultAltKm } = await import("../src/game/place");
  const { airTop } = await import("../src/aero");
  const { solarBody } = await import("../src/system/solar");
  // (no ground: denser below the 1 bar level, not held at its density)
  expect(airDensity("jupiter", -50e3)).toBeGreaterThan(1.5 * airDensity("jupiter", 0));
  expect(airDensity("saturn", 0)).toBeCloseTo(0.1847, 2);
  // (a solid world's still from its ground up)
  expect(airDensity("earth", -1000)).toBeCloseTo(airDensity("earth", 0), 6);
  // (the zonal winds: Saturn's equatorial jet, Jupiter's 24° N jet; none elsewhere)
  expect(giantWindAt("saturn", 0)).toBeCloseTo(450, 0);
  expect(giantWindAt("jupiter", 23.75)).toBeGreaterThan(100);
  expect(giantWindAt("earth", 0)).toBe(0);
  // (the default orbit clear of the air — its warm thermosphere's top, not 12 scale heights)
  for (const id of ["jupiter", "saturn"]) expect(defaultAltKm(id) * 1e3).toBeGreaterThan(airTop(solarBody(id)!.atmosphere));
});

test("D1c: Galileo's entry heat — its peak ~30 kW/cm², a third of it the hydrogen's radiation; Saturn's entries convective", async () => {
  const { heatFlux } = await import("../src/aero");
  // (the same pass as above: the stagnation point's flux, Rₙ 0.222 m — Milos et al. 1999: peak ~30 kW/cm², ~300 kJ/cm²)
  const m = 339,
    A = Math.PI * 0.63 ** 2,
    Cd = 1.05,
    g = GIANT_AIR.jupiter.g,
    Rn = 0.222;
  let h = 450e3,
    vx = 47.4e3 * Math.cos((8.6 * Math.PI) / 180),
    vz = -47.4e3 * Math.sin((8.6 * Math.PI) / 180);
  let peak = 0,
    peakConv = 0,
    load = 0;
  const dt = 0.005;
  const conv = { ...GASES.h2heJ, h2rad: 0 };
  for (let t = 0; t < 400 && h > -50e3; t += dt) {
    const v = Math.hypot(vx, vz);
    const air = airAt(jupiter, h);
    const q = heatFlux(air, v, Rn);
    peak = Math.max(peak, q);
    peakConv = Math.max(peakConv, heatFlux({ ...air, gas: conv }, v, Rn));
    load += q * dt;
    const a = (0.5 * air.rho * v * v * Cd * A) / m;
    vx -= ((a * vx) / v) * dt;
    vz += (-(a * vz) / v - g + (vx * vx) / (71492e3 + h)) * dt;
    h += vz * dt;
  }
  console.log(
    `  Galileo: peak ${(peak / 1e7).toFixed(1)} kW/cm² (convective ${(peakConv / 1e7).toFixed(1)}), load ${(load / 1e7).toFixed(0)} kJ/cm²`,
  );
  expect(peak / 1e7).toBeGreaterThan(27);
  expect(peak / 1e7).toBeLessThan(33);
  expect(peakConv / peak).toBeGreaterThan(0.55);
  expect(peakConv / peak).toBeLessThan(0.8);
  // (no ablation's blowing here: the load above Galileo's ~300 kJ/cm², below twice it)
  expect(load / 1e7).toBeGreaterThan(300);
  expect(load / 1e7).toBeLessThan(600);
  // (the same probe into Saturn at 26 km/s, 10° down: at its peak the radiation a small part — a Saturn probe's heat shield
  // sized on its convection)
  let hs = 450e3,
    ux = 26e3 * Math.cos((10 * Math.PI) / 180),
    uz = -26e3 * Math.sin((10 * Math.PI) / 180);
  let sPeak = 0,
    sConv = 0;
  for (let t = 0; t < 600 && hs > -50e3; t += dt) {
    const v = Math.hypot(ux, uz);
    const air = airAt(saturn, hs);
    const q = heatFlux(air, v, Rn);
    if (q > sPeak) {
      sPeak = q;
      sConv = heatFlux({ ...air, gas: { ...GASES.h2heS, h2rad: 0 } }, v, Rn);
    }
    const a = (0.5 * air.rho * v * v * Cd * A) / m;
    ux -= ((a * ux) / v) * dt;
    uz += (-(a * uz) / v - GIANT_AIR.saturn.g + (ux * ux) / (60268e3 + hs)) * dt;
    hs += uz * dt;
  }
  console.log(`  Saturn at 26 km/s: peak ${(sPeak / 1e7).toFixed(2)} kW/cm², radiated ${(100 * (1 - sConv / sPeak)).toFixed(1)} %`);
  expect(1 - sConv / sPeak).toBeLessThan(0.15);
});

test("D1c: the crushing — each hull's limit, lower when hot; every craft crushed above the giants' floor, Venus's floor held", async () => {
  const { airPressure, crushLimit } = await import("../src/aero");
  const { VESSELS } = await import("../src/vessels");
  const { solarBody } = await import("../src/system/solar");
  const { deepFloorR, flatteningOf } = await import("../src/system/ellipsoid");
  const R = VESSELS.ranger.aero;
  expect(crushLimit(R, 300)).toBe(R.pMax);
  expect(crushLimit(R, R.hull.tMax)).toBeCloseTo(0.5 * R.pMax, 0);
  // (the depth each craft gives way at, its hull at the air's temperature — the floor far below, at either pole)
  for (const [id, Req] of [
    ["jupiter", 71492e3],
    ["saturn", 60268e3],
  ] as const) {
    const sb = solarBody(id)!;
    const f = flatteningOf(id);
    const floor = Math.min(Req - deepFloorR(id, Req, 0), Req * (1 - f) - deepFloorR(id, Req, 1));
    const out: string[] = [];
    for (const [vid, v] of Object.entries(VESSELS)) {
      let z = 0;
      for (; z > -floor; z -= 1e3) {
        const a = airAt(sb.atmosphere, z);
        if (airPressure(a) > crushLimit(v.aero, a.T)) break;
      }
      out.push(`${vid} ${(z / 1e3).toFixed(0)} km`);
      expect(z).toBeGreaterThan(-floor + 100e3);
    }
    console.log(`  ${id} (floor ${(floor / 1e3).toFixed(0)} km down): ${out.join(", ")}`);
  }
  // (Venus's floor — 92 bar, 737 K —: the Ranger and the Lander rest there under 80 % of their limit, no alarm)
  const ven = airAt(solarBody("venus")!.atmosphere, 0);
  expect(airPressure(ven) / 1e5).toBeCloseTo(92, -1);
  for (const v of [VESSELS.ranger.aero, VESSELS.lander.aero]) expect(airPressure(ven) / crushLimit(v, ven.T)).toBeLessThan(0.8);
});

test("D1c: a craft held in Jupiter's depths is lost to the pressure — with damage; the margin said first", async () => {
  const { AirFlight } = await import("../src/flightair");
  const { solarBody } = await import("../src/system/solar");
  const atm = solarBody("jupiter")!.atmosphere;
  const axes: [V3, V3, V3] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const fly = (h: number, damage: boolean) => {
    const F = new AirFlight();
    F.reset("ranger", 300);
    F.forceFn(atm, "jupiter", 1e4, axes)(h, [0, 0, 5]);
    F.after(0.1, [0, 0, 0], 1e4, 1e5, damage);
    return F;
  };
  // (100 km down: ~14 bar, nothing)
  expect(fly(-100e3, true).failure).toBeNull();
  expect(fly(-100e3, true).margins().p).toBeLessThan(0.2);
  // (deep: crushed — said with its bars; without damage, the margin past 1 and the craft kept)
  const deep = fly(-400e3, true);
  expect(deep.failure).toContain("crushed");
  expect(deep.margins().p).toBeGreaterThan(1);
  expect(fly(-400e3, false).failure).toBeNull();
});
