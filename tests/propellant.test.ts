import { afterEach, expect, test } from "bun:test";
import { propellantKg, spentFor, transfer } from "../src/game/propellant";
import { CameraController } from "../src/controls";
import { fleet, fleetStart } from "../src/fleet";
import { defaultSettings, presets } from "../src/settings";
import { M_SECONDS } from "../src/units";
import { VESSELS } from "../src/vessels";
import { setSceneTime } from "../src/wormhole";

// PLAN-VAISSEAUX X2b: each craft's propellant from the rapidity it spent, and moved between docked craft — the
// Endurance refuelling the Ranger from the docking panel.

const activePose = fleet.activePose;
afterEach(() => {
  fleet.activePose = activePose;
  fleetStart(0, "ranger");
});

const T = { exhaust: 0.015, massRatio: 3 };

test("the propellant from the rapidity spent, and back", () => {
  const full = propellantKg(40e3, T, 0);
  expect(full.kg).toBeCloseTo(40e3 * (2 / 3), 6);
  const half = spentFor(40e3, T, full.full / 2);
  expect(propellantKg(40e3, T, half).kg).toBeCloseTo(full.full / 2, 6);
  expect(propellantKg(40e3, T, 1).kg).toBe(0);
});

test("a transfer: no more than the giver has nor the taker holds; the mass kept", () => {
  const giver = { mass: 900e3, spent: spentFor(900e3, T, 300e3) };
  const taker = { mass: 40e3, spent: spentFor(40e3, T, 5e3) };
  const r = transfer(T, giver, taker);
  expect(r.kg).toBeCloseTo(40e3 * (2 / 3) - 5e3, 3);
  expect(propellantKg(40e3, T, r.toSpent).kg + propellantKg(900e3, T, r.fromSpent).kg).toBeCloseTo(305e3, 2);
  const poor = transfer(T, { mass: 900e3, spent: spentFor(900e3, T, 2e3) }, taker);
  expect(poor.kg).toBeCloseTo(2e3, 3);
});

test("the Ranger docked to the Endurance, half full: REFUEL fills it from the Endurance", () => {
  setSceneTime(0);
  const starts = fleetStart(0, "endurance");
  const s = {
    ...defaultSettings(),
    ...presets["Earth: the Endurance, 800 km up"]!,
    vessel: "endurance" as const,
    timeSpeed: 1 / M_SECONDS,
    animate: true,
    fuel: true,
    engine: "crew" as const,
  };
  const c = new CameraController({} as HTMLCanvasElement, s, () => {}, true);
  fleet.activePose = () => c.activePoseNow();
  c.time = 0;
  c.setPilot(true);
  c.newFlight();
  c.flyFrom(starts.endurance);
  c.settleMount();
  c.sync();
  c.flyShip(1 / 30, null as never);
  expect(c.switchVessel("ranger")).toBeFalsy();
  c.flyShip(1 / 30, null as never);
  const Tk = fleet.tanks!;
  fleet.spent.ranger = spentFor(VESSELS.ranger.mass, Tk, propellantKg(VESSELS.ranger.mass, Tk, 0).full / 2);
  expect(c.propellantOf("ranger")!.share).toBeCloseTo(0.5, 3);
  const said = c.refuelFromDocked();
  console.log(`  ${said}`);
  expect(said).toMatch(/Refuelled from the Endurance/);
  expect(c.propellantOf("ranger")!.share).toBeCloseTo(1, 3);
  expect(c.propellantOf("endurance")!.share).toBeLessThan(1);
  expect(c.flightInfo().ownFuel).toBeCloseTo(1, 3);
  expect(c.refuelFromDocked()).toMatch(/full/);
}, 60_000);
