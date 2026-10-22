import { afterEach, describe, expect, test } from "bun:test";
import { Fmgc } from "../src/a320/fmgc/fmgc";
import { Fms } from "../src/a320/fmgc/fms";
import { ourGroundPose } from "../src/game/place";
import { flight, resetFlights } from "./helpers/flight";

// The A320's flight management (docs/PLAN-A320.md, A9 — src/a320/fmgc/fms.ts): the V speeds it proposes, VAPP, the
// ECON speeds; then a take-off flown by its data — INIT B's weights, PERF TAKE OFF's V speeds and FLEX —: MAN FLX on
// the runway, SRS from the rotation, LVR CLB past the thrust reduction's height, THR CLB once the levers are in CL,
// CLB at the acceleration's height and the managed 250 kt under FL100.

afterEach(resetFlights);

const KT = 0.514444;

describe("A320 FMS", () => {
  test("the V speeds proposed, VAPP, ECON", () => {
    const F = new Fms();
    const v = F.proposeV(64000, 1);
    console.log(`  64 t CONF 1+F: V1 ${v.v1}, VR ${v.vr}, V2 ${v.v2}`);
    expect(v.v1).toBeLessThanOrEqual(v.vr);
    expect(v.vr).toBeLessThan(v.v2);
    // (an A320 at 64 t, CONF 1+F: V2 ≈ 140 kt)
    expect(Math.abs(v.v2 - 140)).toBeLessThan(10);
    // (heavier: faster)
    expect(F.proposeV(73000, 1).v2).toBeGreaterThan(v.v2);
    // (VAPP at 60 t in FULL: VLS + 5 in still air, more in a head wind — at most 15)
    const calm = F.vapp(60000);
    F.appWind = { dir: 90, kt: 30 };
    expect(F.vapp(60000, 90)).toBe(Math.round(F.vls(60000) + 10));
    expect(calm).toBe(Math.round(F.vls(60000) + 5));
    // (ECON: a higher cost index flies faster)
    F.costIndex = 0;
    const slow = F.econ();
    F.costIndex = 100;
    expect(F.econ().clb).toBeGreaterThan(slow.clb);
    expect(F.econ().crzMach).toBeGreaterThan(slow.crzMach);
  });

  test("a take-off by the FMS's data: MAN FLX, SRS, LVR CLB, THR CLB, CLB at 250 kt", () => {
    const g = ourGroundPose("earth", 34.905, -117.884, 0);
    const { c, fly } = flight({ ...g, landed: g.landed }, false, "a320");
    c.s.flightMode = "plane";
    c.airFlight.cfg.flaps = 0.25;
    fly(1);
    const F = (c.a320Fmgc ??= new Fmgc());
    const M = F.fms;
    M.zfw = 56;
    M.block = 8.2;
    M.toConf = 1;
    const v = M.proposeV((M.tow ?? 64) * 1000, 1);
    Object.assign(M, v, { flex: 45, thrRed: 1000, acc: 1500 });
    F.alt = 15000;
    // (the levers in FLX/MCT: the FADEC at FLEX, the A/THR armed, RWY and SRS)
    c.pilot.throttle = 0.8;
    fly(1);
    expect(F.thrust).toBe("MAN FLX");
    expect(F.vert).toBe("SRS");
    expect(F.athr).toBeTrue();
    const input = c.pilotInput.bind(c);
    const seen = new Set<string>();
    let rotated = false;
    for (let k = 0; k < 30 * 200; k++) {
      const I = c.a320FmgcIn!;
      const on = !!c.rolling || !!c.ourLanded;
      // (the pilot: rotates at VR, hands off once flying; the gear up; the levers to CL at LVR CLB; AP1 at 100 ft;
      // the flaps up past S)
      if (!on && !rotated) rotated = true;
      // (in the air before the autopilot: the flight director's pitch bar followed)
      const fdp = c.a320FmgcOut?.fd?.pitch ?? 0;
      const stick = on ? (I.ias > (M.vr ?? 145) ? 0.5 : 0) : F.ap ? 0 : Math.max(-0.4, Math.min(0.4, 0.08 * fdp));
      c.pilotInput = (pad) => ({ ...input(pad), pitch: stick });
      if (rotated && c.gearDown) c.gearDown = false;
      if (F.thrust === "LVR CLB") c.pilot.throttle = 0.62;
      if (rotated && !F.ap && (I.ra ?? 0) > 120) F.ap1Toggle(I);
      if (rotated && I.ias > I.s + 5 && c.airFlight.cfg.flaps! > 0) c.airFlight.cfg.flaps = 0;
      fly(1 / 30);
      seen.add(`${F.thrust}|${F.vert}`);
      if (process.env.TRACE && k % 60 === 0)
        console.log(
          `   ${F.phase} athr ${F.athr} det ${I.detent} ra ${I.ra} alt ${I.alt.toFixed(0)} elev ${I.elev.toFixed(0)} ${F.thrust}|${F.vert} ias ${I.ias.toFixed(0)}`,
        );
      if (F.vert === "CLB" && Math.abs(c.a320FmgcIn!.ias - 250) < 6 && k > 30 * 60) break;
    }
    c.pilotInput = input;
    const I = c.a320FmgcIn!;
    console.log(`  ${[...seen].join(" → ")}; ${I.alt.toFixed(0)} ft, ${I.ias.toFixed(0)} kt, flex ${c.a320!.flexTemp}`);
    expect(seen.has("MAN FLX|SRS")).toBeTrue();
    expect(seen.has("LVR CLB|SRS")).toBeTrue();
    expect(F.ap1).toBeTrue();
    expect(F.vert).toBe("CLB");
    expect(F.thrust).toBe("THR CLB");
    expect(Math.abs(I.ias - 250)).toBeLessThan(8);
    expect(I.ias).toBeGreaterThan(200 * (KT / KT));
  }, 300_000);
});
