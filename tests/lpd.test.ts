import { afterEach, expect, test } from "bun:test";
import { heldCode } from "../src/input/bindings";
import { LPD } from "../src/controller/lowthrust";
import { apart, overPlace, resetFlights, TRANQUILITY } from "./helpers/flight";
import { toBodyFixed } from "../src/system/our-surface";

// PLAN-VAISSEAUX X1d: the powered landing's point designator (Apollo's LPD) — the stick moves the point the landing
// autopilot flies to (W forward), no farther than the height; the craft lands there.

afterEach(() => resetFlights());

test("the Lander's landing point moved 300 m forward with the stick, landed there", () => {
  const { c, fly, here, msgs } = overPlace("moon", TRANQUILITY.lat, TRANQUILITY.lon, 1.5, true, "lander");
  fly(3);
  c.pilot.setAuto("land");
  // (the point under it taken once slow)
  fly(3, () => !!c.landRun?.q);
  expect(c.landRun?.q).toBeTruthy();
  const q0 = [...c.landRun!.q!];
  const W = heldCode("pitchDown");
  c.codes.add(W);
  fly(4);
  c.codes.delete(W);
  const q1 = [...c.landRun!.q!];
  const moved = apart(q0, q1);
  const info = c.flightInfo();
  fly(240, () => msgs.some((m) => /Touchdown|Landed on/.test(m)));
  const at = here();
  const miss = apart(toBodyFixed("moon", at.q, at.t), q1);
  console.log(
    `  moved ${moved.toFixed(0)} m (LPD ${info.lpd?.moved}, mark ${info.lpd?.dir ? "in view" : "none"}) · landed ${miss.toFixed(1)} m from the point · ${msgs.filter((m) => /Landed|Touchdown/.test(m)).join(" · ")}`,
  );
  expect(moved).toBeGreaterThan(200);
  expect(moved).toBeLessThan(Math.max(LPD.minReach, 1600) + 10);
  expect(info.lpd?.moved).toBe(true);
  expect(msgs.some((m) => /Touchdown on Moon/.test(m))).toBe(true);
  expect(miss).toBeLessThan(30);
}, 240_000);
