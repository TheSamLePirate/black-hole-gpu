import { describe, expect, test } from "bun:test";
import { F135, fuelFlow, wetThrust } from "../src/f35/engine";
import { VESSELS } from "../src/vessels";
import { FT, G, sustainedG, trim, vMax } from "./helpers/envelope";

// The F-35B's performance (docs/PLAN-F35.md, F3): its aerodynamics (aero.ts, VESSELS.f35.aero) and its engine
// (src/f35/engine.ts) against the real aircraft's published figures — level flight's speeds, the stall, the
// sustained turn, the approach, the endurance. Pure: the forces at trimmed states, no flight flown.

const V = VESSELS.f35;
describe("the F-35B's performance", () => {
  const mTO = V.mass; // 20.9 t: full fuel
  const mMid = V.mass - 3000;
  test("its top speeds: ~Mach 1.6 high on the afterburner, some 0.9 dry; transonic at sea level", () => {
    const hi = vMax(11000, mMid, true);
    const hiDry = vMax(11000, mMid, false);
    const sl = vMax(0, mMid, true);
    console.log(`  top speed: M ${hi.toFixed(2)} at 11 km wet, M ${hiDry.toFixed(2)} dry; M ${sl.toFixed(2)} at sea level wet`);
    expect(hi).toBeGreaterThan(1.45);
    expect(hi).toBeLessThan(1.8);
    expect(hiDry).toBeGreaterThan(0.85);
    expect(hiDry).toBeLessThan(1.1);
    expect(sl).toBeGreaterThan(0.95);
    expect(sl).toBeLessThan(1.3);
  });
  test("its stall: ~125 kt clean at its take-off weight, the approach at ~12° with full flaps", () => {
    let vs = 40;
    while (vs < 150 && !trim(0, vs, mTO).ok) vs += 0.5;
    const app = trim(0, 72, 17500, 1, 1);
    console.log(
      `  stall ${vs.toFixed(1)} m/s (${(vs / 0.5144).toFixed(0)} kt); approach at 140 kt: α ${((app.alpha * 180) / Math.PI).toFixed(1)}°`,
    );
    expect(vs / 0.5144).toBeGreaterThan(110);
    expect(vs / 0.5144).toBeLessThan(145);
    expect((app.alpha * 180) / Math.PI).toBeGreaterThan(8);
    expect((app.alpha * 180) / Math.PI).toBeLessThan(16);
  });
  test("its sustained turn: ~4.5 g at Mach 0.8 and 15 000 ft on the afterburner (DOT&E 2013)", () => {
    const n = sustainedG(15000 * FT, 0.8, mMid);
    console.log(`  sustained ${n.toFixed(2)} g at M 0.8, 15 000 ft`);
    expect(n).toBeGreaterThan(4.3);
    expect(n).toBeLessThan(6.3);
  });
  test("its fuel: three quarters of an hour at full dry thrust, under ten minutes of full afterburner", () => {
    const dry = F135.dry,
      wet = F135.wet;
    const tDry = V.fuelKg! / fuelFlow(F135, dry, dry, 1) / 60;
    const tWet = V.fuelKg! / fuelFlow(F135, wet, dry, 1) / 60;
    console.log(`  ${tDry.toFixed(0)} min at military thrust, ${tWet.toFixed(1)} min wet (sea level, static)`);
    expect(tDry).toBeGreaterThan(30);
    expect(tDry).toBeLessThan(55);
    expect(tWet).toBeGreaterThan(6);
    expect(tWet).toBeLessThan(12);
  });
  test("its thrust over weight at take-off: ~0.85 on the afterburner", () => {
    const tw = wetThrust(F135, 0, 1) / (mTO * G);
    expect(tw).toBeGreaterThan(0.75);
    expect(tw).toBeLessThan(0.95);
  });
});
