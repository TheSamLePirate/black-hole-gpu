import { afterEach, describe, expect, test } from "bun:test";
import { Fmgc } from "../src/a320/fmgc/fmgc";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The A320's failures flown by the controller (docs/PLAN-A320.md, A11 — src/a320/failures.ts wired in
// controller/a320.ts): an engine failure armed at V1 — the engine out as the speed passes it, the take-off continued on
// one engine at TOGA, the yaw held by the rudder; the green and yellow hydraulics lost in flight — the alternate law,
// the flaps' rate halved, the gear left down by its gravity extension only.

afterEach(resetFlights);

const D = Math.PI / 180;
const YAW = Number(process.env.YAW ?? 1);

describe("A320 failures in flight", () => {
  test("an engine failure at V1: out at V1, the climb on the other at TOGA", () => {
    const g = ourGroundPose("earth", 34.905, -117.884, 0);
    const { c, fly } = flight({ ...g, landed: g.landed }, false, "a320");
    c.s.flightMode = "plane";
    c.airFlight.cfg.flaps = 0.25;
    fly(1);
    const alt0 = c.geoNow()!.alt;
    const F = (c.a320Fmgc ??= new Fmgc());
    Object.assign(F.fms, { v1: 135, vr: 140, v2: 145 });
    c.a320Fail!.arm("eng1-fail", { at: "v1" });
    const fired: string[] = [];
    c.a320Failed = (id) => fired.push(id);
    c.pilot.throttle = 1;
    const input = c.pilotInput.bind(c);
    let outAt: number | null = null;
    let maxBeta = 0;
    let t = 0;
    fly(180, () => {
      t += 1 / 30;
      const I = c.a320FmgcIn;
      const ias = I?.ias ?? 0;
      const on = !!c.rolling || !!c.ourLanded;
      if (outAt === null && !c.a320!.engines[0].running) outAt = ias;
      // (the pilot: the rotation at VR, a pitch of 12°; the rudder against the yaw — the sideslip's)
      const beta = (c.airFlight.last?.out.beta ?? 0) / D;
      if (process.env.TRACE && Math.round(t * 30) % 60 === 0)
        console.log(
          `   t ${t.toFixed(0)} ias ${ias.toFixed(0)} β ${beta.toFixed(1)} h ${((c.geoNow()?.alt ?? 0) - alt0).toFixed(0)} rud ${c.a320!.surfaces.rudder.toFixed(1)} gear ${c.gearExt.toFixed(2)} pitch ${(((c.attitudeNow() as { pitch?: number }).pitch ?? 0) / D).toFixed(1)}`,
        );
      if (!on && (c.geoNow()?.alt ?? 0) - alt0 > 10 && Math.abs(beta) > maxBeta) {
        maxBeta = Math.abs(beta);
        if (process.env.TRACE)
          console.log(
            `   β max ${beta.toFixed(1)} at ${t.toFixed(1)} s, ${ias.toFixed(0)} kt, h ${((c.geoNow()?.alt ?? 0) - alt0).toFixed(1)}`,
          );
      }
      const pitch = (c.attitudeNow() as { pitch?: number }).pitch ?? 0;
      const stick = on ? (ias > 140 ? 0.6 : 0) : Math.max(-0.5, Math.min(0.5, (12 * D - pitch) * 3));
      c.pilotInput = (pad) => ({ ...input(pad), pitch: stick, yaw: ias > 60 ? Math.max(-1, Math.min(1, YAW * beta * 0.3)) : 0 });
      if (!on && c.gearDown) c.gearDown = false;
      return !on && (c.geoNow()?.alt ?? 0) - alt0 > 450;
    });
    c.pilotInput = input;
    const A = c.a320!;
    console.log(
      `  ENG 1 out at ${(outAt ?? Number.NaN).toFixed(0)} kt; at ${((c.geoNow()?.alt ?? 0) - alt0).toFixed(0)} m after ${t.toFixed(0)} s: ENG 2 N1 ${A.engines[1].n1.toFixed(0)}, β max ${maxBeta.toFixed(1)}°`,
    );
    expect(fired).toEqual(["eng1-fail"]);
    expect(outAt).not.toBeNull();
    expect(Math.abs((outAt ?? 0) - 135)).toBeLessThan(8);
    expect(A.engines[0].running).toBeFalse();
    expect(A.engines[1].running).toBeTrue();
    expect(A.engines[1].n1).toBeGreaterThan(85);
    // (the ECAM: ENG 1 FAIL, red or amber, its procedure; the master caution or warning)
    const E = c.a320Ecam!;
    const ewd = E.left().map((l) => l.text.trim());
    console.log(`  E/WD: ${ewd.join(" | ")}`);
    expect(ewd.some((l) => l.startsWith("ENG 1 FAIL"))).toBeTrue();
    expect(E.masterCaution || E.masterWarning).toBeTrue();
    // (climbing on one engine, the sideslip held)
    expect((c.geoNow()?.alt ?? 0) - alt0).toBeGreaterThan(450);
    expect(maxBeta).toBeLessThan(8);
  }, 300_000);

  test("green and yellow lost in flight: alternate law, the flaps slow, the gear by gravity", () => {
    const g = ourGroundPose("earth", 40, -35, 0);
    const X = add(g.X, scale(g.up, 2000 / M_METRES));
    const { c, fly } = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 110 / C_MPS)), landed: undefined }, false, "a320");
    c.s.flightMode = "plane";
    c.gearDown = false;
    c.gearExt = 0;
    c.gearInit = true;
    c.pilot.throttle = 0.62;
    fly(3);
    expect(c.a320!.law).toBe("normal");
    c.a320Fail!.arm("hyd-gy");
    // (the leaks: the reservoirs drained, the pressures fall)
    fly(150, () => c.a320!.law !== "normal");
    console.log(
      `  G ${Number(c.a320Props["systems/hydraulic/green-psi"]).toFixed(0)} Y ${Number(c.a320Props["systems/hydraulic/yellow-psi"]).toFixed(0)} B ${Number(c.a320Props["systems/hydraulic/blue-psi"]).toFixed(0)} psi: ${c.a320!.law}`,
    );
    expect(c.a320!.law).toBe("alternate");
    fly(3);
    const ewd = c.a320Ecam!.left().map((l) => l.text.trim());
    console.log(
      `  E/WD: ${ewd.join(" | ")}; STATUS ${c
        .a320Ecam!.status()
        .right.map((l) => l.text.trim())
        .join(", ")}`,
    );
    expect(ewd.some((l) => l.startsWith("HYD G+Y SYS LO PR"))).toBeTrue();
    expect(c.a320Ecam!.masterWarning).toBeTrue();
    // (the gear: the lever alone does nothing; the gravity extension lowers it)
    c.gearDown = true;
    fly(3);
    expect(c.gearExt).toBeLessThan(0.05);
    c.a320Gravity = true;
    fly(30);
    expect(c.gearExt).toBe(1);
    // (gear down in alternate: the direct law)
    fly(1);
    console.log(
      `  then G ${Number(c.a320Props["systems/hydraulic/green-psi"]).toFixed(0)} Y ${Number(c.a320Props["systems/hydraulic/yellow-psi"]).toFixed(0)}, failures ${[...c.a320Fail!.active].join()}, gear ${c.gearDown} ${c.gearExt}, law ${c.a320!.law}`,
    );
    expect(c.a320!.law).toBe("direct");
  }, 300_000);
});
