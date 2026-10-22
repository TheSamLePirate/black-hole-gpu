import { afterEach, describe, expect, test } from "bun:test";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The A320's ECAM in a flight without failures (docs/PLAN-A320.md, A11 — src/a320/ecam wired in controller/a320.ts):
// ready on the stand — no warning, no caution, its memos —; in cruise, clean — no spurious caution from the inputs
// the game gives FlightGear's FWC.

afterEach(resetFlights);

const lines = (c: { a320Ecam: { left(): { text: string; colour: string }[]; right(): { text: string; colour: string }[] } | null }) => ({
  left: c.a320Ecam!.left().map((l) => `${l.colour}:${l.text.trim()}`),
  right: c.a320Ecam!.right().map((l) => `${l.colour}:${l.text.trim()}`),
});

describe("A320 ECAM, no failure", () => {
  test("ready on the ground: no warning nor caution", () => {
    const g = ourGroundPose("earth", 48.97, 2.44, 0);
    const { c, fly } = flight({ ...g, landed: g.landed }, false, "a320");
    c.s.flightMode = "plane";
    fly(30);
    const L = lines(c);
    console.log(`  ground: ${L.left.join(" | ")} ‖ ${L.right.join(" | ")}`);
    expect(L.left.filter((l) => /^[ra]:/.test(l))).toEqual([]);
    expect(c.a320Ecam!.masterWarning || c.a320Ecam!.masterCaution).toBeFalse();
  }, 120_000);

  test("in cruise: clean", () => {
    const g = ourGroundPose("earth", 40, -35, 0);
    const X = add(g.X, scale(g.up, 3000 / M_METRES));
    const { c, fly } = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 130 / C_MPS)), landed: undefined }, false, "a320");
    c.s.flightMode = "plane";
    c.gearDown = false;
    c.gearExt = 0;
    c.gearInit = true;
    c.pilot.throttle = 0.62;
    fly(60);
    const L = lines(c);
    console.log(`  cruise: ${L.left.join(" | ")} ‖ ${L.right.join(" | ")}`);
    if (process.env.TRACE)
      for (const k of [
        "psi/engine-1-downstream-prv",
        "precooler/ovht-1",
        "precooler/temp-1",
        "warnings/overpress-1-mem",
        "warnings/ovht-1-mem",
      ])
        console.log(`   ${k} ${c.a320Props[`systems/pneumatics/${k}`]}`);
    if (process.env.TRACE)
      console.log(`   eng ${JSON.stringify(c.a320!.engines.map((e) => [e.n1.toFixed(0), e.n2.toFixed(0), e.egt.toFixed(0)]))}`);
    expect(L.left.filter((l) => /^[ra]:/.test(l))).toEqual([]);
    expect(c.a320Ecam!.masterWarning || c.a320Ecam!.masterCaution).toBeFalse();
  }, 120_000);
});
