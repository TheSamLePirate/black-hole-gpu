import { afterEach, expect, test } from "bun:test";
import { effectsOf, failNow, FIX_S, freshSystems, O2_PER_DAY, startFix, stepSystems, SYSTEMS } from "../src/game/systems";
import { alertsOf } from "../src/ui/hud/alerts";
import { overPlace, resetFlights, TRANQUILITY } from "./helpers/flight";
import { fleet, fleetStart } from "../src/fleet";

// PLAN-VAISSEAUX X3: a spacecraft's systems — its consumables (the battery's balance, the crew's oxygen, the
// scrubbers), its failures drawn at the rate set from a seeded generator, their effects, their checklists' fixes.

afterEach(() => {
  resetFlights();
  fleetStart(0, "ranger");
});

const on = { consumables: true, rate: "off" as const };

test("the Ranger's air: 40 kg for four — 11.9 days; its battery: +1.4 kW idle, drawn down under effort", () => {
  const spec = SYSTEMS.ranger;
  expect(spec.o2Kg / (spec.crew * O2_PER_DAY)).toBeCloseTo(11.9, 1);
  const S = freshSystems(spec, 7);
  S.battery = 30;
  stepSystems(spec, S, 3600, { effort: 0 }, on);
  expect(S.battery).toBeCloseTo(31.4, 6);
  stepSystems(spec, S, 3600, { effort: 1 }, on);
  expect(S.battery).toBeCloseTo(26.8, 6);
  expect(S.o2).toBeCloseTo(40 - (2 * 4 * O2_PER_DAY) / 24, 6);
});

test("failures drawn at their rate from the seed: the same seed the same flight; about 0.3 an hour when realistic", () => {
  const draw = (seed: number) => {
    const S = freshSystems(SYSTEMS.ranger, seed);
    const out: string[] = [];
    for (let k = 0; k < 100 * 60; k++) {
      const f = stepSystems(SYSTEMS.ranger, S, 60, { effort: 0 }, { consumables: false, rate: "realistic" });
      if (f) {
        out.push(f.kind);
        f.fixed = true;
      }
    }
    return out;
  };
  const a = draw(42),
    b = draw(42);
  expect(a).toEqual(b);
  console.log(`  100 h realistic: ${a.length} failures (${[...new Set(a)].join(", ")})`);
  expect(a.length).toBeGreaterThan(15);
  expect(a.length).toBeLessThan(50);
});

test("the effects and the fixes: an engine out relit after 30 s (half of it a time in three), a quad isolated — its push gone, a quarter of the authority lost", () => {
  const spec = SYSTEMS.ranger;
  const S = freshSystems(spec, 3);
  failNow(S, "engine");
  expect(effectsOf(S).engine).toBe(0);
  expect(startFix(S, "engine")).toBe(true);
  stepSystems(spec, S, FIX_S.engine - 1, { effort: 0 }, on);
  expect(effectsOf(S).engine).toBe(0);
  stepSystems(spec, S, 2, { effort: 0 }, on);
  expect([0.5, 1]).toContain(effectsOf(S).engine);
  const f = failNow(S, "rcsStuck");
  expect(Math.hypot(...effectsOf(S).push)).toBeCloseTo(1 / 3, 9);
  startFix(S, "rcsStuck");
  stepSystems(spec, S, 3, { effort: 0 }, on);
  expect(f.fixed).toBe(true);
  expect(effectsOf(S).push).toEqual([0, 0, 0]);
  expect(effectsOf(S).rcs).toBe(0.75);
  S.battery = 0;
  expect(effectsOf(S).powerOut).toBe(true);
});

test("in flight: an engine out leaves no thrust until relit; a flat battery no turning; the HUD's alarms with the checklist", () => {
  const { c, fly } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 100, false);
  fly(0.1);
  const thr0 = c.thrustMax();
  expect(c.systemsFail("engine")).toMatch(/MAIN ENGINE OUT/);
  expect(c.thrustMax()).toBe(0);
  const al = alertsOf({ ...(c.flightInfo() as object), animate: true, fmtM: () => "" } as never).find((a) => a.id === "sys-engine")!;
  expect(al.level).toBe("warning");
  expect(al.todo).toMatch(/RELIGHT/);
  expect(c.systemsFix("engine")).toMatch(/RELIGHT: under way/);
  fly(35);
  expect(c.thrustMax()).toBeGreaterThanOrEqual(thr0 * 0.5 - 1e-15);
  // the battery flat: the stick turns nothing
  fleet.systems.ranger!.battery = 0;
  c.pilot.omega = [0, 0, 0];
  c.codes.add("KeyW");
  fly(1);
  c.codes.delete("KeyW");
  console.log(
    `  engine ${thr0.toExponential(2)} → 0 → ${c.thrustMax().toExponential(2)} after the relight; battery flat: ${Math.hypot(...c.pilot.omega).toFixed(4)} rad/s from a second of stick`,
  );
  expect(Math.hypot(...c.pilot.omega)).toBeLessThan(1e-3);
}, 60_000);
