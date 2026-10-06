import { expect, test } from "bun:test";
import { CameraController } from "../src/controls";
import { fleet } from "../src/fleet";
import { defaultSettings, presets } from "../src/settings";
import { VESSELS } from "../src/vessels";

// The engine throttled back at the structure's limit as the propellant burns: a long low-thrust transfer
// at 2 g, its tanks nearly dry, once reached 9.7 g and broke the Ranger up (flight lab garg-lt-*). The
// Crew engine's thrust now stops at 85 % of the craft's load limit; the Cinema engine's fictional
// thousands of g are borne by nothing (engine.ts loadShare) and stay.

test("the Crew engine at most 85 % of the craft's load limit, its tanks nearly dry; the Cinema engine untouched", () => {
  const s = { ...defaultSettings(), ...presets["game:interstellar"]!, engine: "crew" as const };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  const g = (a: number) => (a * 299792458 ** 2) / (1476.625 * s.massSolar) / 9.80665;
  const full = g(c.thrustMax());
  fleet.tanks = { exhaust: 0.1, massRatio: 20 };
  // (a twentieth of the mass left)
  fleet.spent = { ranger: 0.1 * Math.log(19) };
  try {
    expect(g(c.thrustMax())).toBeLessThanOrEqual(0.85 * VESSELS.ranger.aero.gMax + 1e-9);
    expect(g(c.thrustMax())).toBeGreaterThan(full);
    (s as { engine: string }).engine = "cinema";
    expect(g(c.thrustMax())).toBeGreaterThan(100);
  } finally {
    fleet.tanks = null;
    fleet.spent = {};
  }
});
