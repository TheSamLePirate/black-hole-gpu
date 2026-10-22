import { afterEach, describe, expect, test } from "bun:test";
import { Fmgc } from "../src/a320/fmgc/fmgc";
import { ourGroundPose } from "../src/game/place";
import type { IlsRunway } from "../src/game/ils";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The A320's flight guidance (docs/PLAN-A320.md, A8 — src/a320/fmgc/fmgc.ts, controller/a320ap.ts) flown frame by
// frame by the controller: a selected heading flown at 25° of bank at most; OP CLB to a selected altitude, the thrust
// CLB, the altitude captured and held; the A/THR's SPEED holding the speed selected; an ILS approach armed (APPR),
// LOC and G/S captured, LAND, FLARE, the touchdown and ROLL OUT — the autoland.

afterEach(resetFlights);

const D = Math.PI / 180;
const KT = 0.514444;
const FT = 0.3048;

/** The A320 over the Atlantic heading east: h up [m], v [m/s], the levers at CL, gear up, clean. */
function cruise(h = 3048, v = 128) {
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, h / M_METRES));
  const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, v / C_MPS)), landed: undefined }, false, "a320");
  run.c.s.flightMode = "plane";
  run.c.gearDown = false;
  run.c.gearExt = 0;
  run.c.gearInit = true;
  run.c.pilot.throttle = 0.62;
  run.fly(3);
  return run;
}

describe("A320 flight guidance", () => {
  test("HDG selected, OP CLB to an altitude and its capture, the A/THR's SPEED", () => {
    const { c, fly } = cruise();
    const F = (c.a320Fmgc ??= new Fmgc());
    const i = () => c.a320FmgcIn!;
    // (5 s after the lift-off — the flight placed in the air counts as one)
    fly(6);
    F.athrToggle();
    F.ap1Toggle(i());
    expect(F.ap1).toBeTrue();
    // (the heading pulled at what is flown, then 60° right: the turn at 25° at most)
    F.hdgPull(i());
    const h0 = i().hdg;
    F.hdgTurn(60);
    let bankMax = 0;
    fly(40, () => {
      bankMax = Math.max(bankMax, Math.abs((c.attitudeNow() as { bank: number }).bank));
      return false;
    });
    const dh = ((i().hdg - h0 - 60 + 540) % 360) - 180;
    console.log(`  HDG: ${F.lat}, off ${dh.toFixed(1)}°, bank at most ${(bankMax / D).toFixed(1)}°`);
    expect(F.lat).toBe("HDG");
    expect(Math.abs(dh)).toBeLessThan(3);
    expect(bankMax / D).toBeLessThan(28);
    // (OP CLB to 13 000 ft at 250 kt: the thrust CLB, ALT* then ALT, held)
    F.spdPull(i());
    F.spd = 250;
    F.alt = 13000;
    F.altPull(i());
    expect(F.vert).toBe("OP CLB");
    fly(5);
    expect(F.thrust).toBe("THR CLB");
    let seen = new Set<string>();
    fly(240, () => {
      seen.add(F.vert);
      return F.vert === "ALT" && Math.abs(i().alt - 13000) < 60;
    });
    fly(20);
    console.log(`  climb: ${[...seen].join(" → ")}; ${i().alt.toFixed(0)} ft, ${i().ias.toFixed(0)} kt, ${F.thrust}`);
    expect(seen.has("ALT*")).toBeTrue();
    expect(F.vert).toBe("ALT");
    expect(Math.abs(i().alt - 13000)).toBeLessThan(100);
    // (the speed: the A/THR's SPEED within 5 kt of 250 once level)
    fly(40);
    console.log(`  level: ${F.thrust} ${i().ias.toFixed(1)} kt, ${i().alt.toFixed(0)} ft`);
    expect(F.thrust).toBe("SPEED");
    expect(Math.abs(i().ias - 250)).toBeLessThan(6);
    seen = new Set();
  }, 300_000);

  test("the autoland: APPR armed, LOC and G/S captured, LAND, FLARE, the touchdown, ROLL OUT", () => {
    // (a runway heading east at sea level; the A320 9 NM out, 2 600 ft, on the centreline, CONF FULL, the gear down)
    const R: IlsRunway = { name: "TEST", icao: "TEST", lat: 40, lon: -35, hdg: 90, elev: 0, len: 3000 };
    const back = 9 * 1852;
    const lon0 = R.lon - back / (6371000 * Math.cos(R.lat * D)) / D;
    const g = ourGroundPose("earth", 40, lon0, 0);
    const X = add(g.X, scale(g.up, (2600 * FT) / M_METRES));
    const run = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, (150 * KT) / C_MPS)), landed: undefined }, false, "a320");
    const { c, fly } = run;
    c.s.flightMode = "plane";
    c.gearDown = true;
    c.gearExt = 1;
    c.gearInit = true;
    c.airFlight.cfg.flaps = 1;
    c.pilot.throttle = 0.62;
    c.a320Ils = R;
    // (the slats and flaps out already — they take half a minute —, then 5 s after the "lift-off": the autopilot may
    // engage)
    fly(0.1);
    c.a320!.surfaces.slat = 27;
    c.a320!.surfaces.flap = 35;
    fly(6);
    const F = (c.a320Fmgc ??= new Fmgc());
    const i = () => c.a320FmgcIn!;
    F.athrToggle();
    F.ap1Toggle(i());
    F.hdg = 90;
    F.hdgPull(i());
    F.hdg = 90;
    F.apprToggle();
    const seen: string[] = [];
    let td = null as { vs: number; along: number; across: number } | null;
    let k = 0;
    fly(600, () => {
      const m = `${F.lat}/${F.vert}`;
      if (seen.at(-1) !== m) seen.push(m);
      if (process.env.TRACE && k++ % 90 === 0) {
        const I = i();
        console.log(
          `   ${m} ${I.ias.toFixed(0)}kt ${I.alt.toFixed(0)}ft vs ${I.vs.toFixed(0)} loc ${I.ils?.loc?.toFixed(2)} gs ${I.ils?.gs?.toFixed(2)} trk ${I.trk.toFixed(1)} ra ${I.ra?.toFixed(0)} thr ${F.thrust} n1 ${c.a320?.engines[0].n1.toFixed(0)} ph ${F.phase} gC ${((c.a320FmgcOut?.gammaCmd ?? NaN) * 57.3).toFixed(1)} fpa ${I.fpa.toFixed(1)} prot ${c.pilot.airbusOut?.alphaProt} a ${((c.airFlight.last?.out.alpha ?? 0) * 57.3).toFixed(1)} vls ${I.vls.toFixed(0)} tgt ${F.targetSpeed(I).toFixed(0)}`,
        );
      }
      if (!td && i().onGround) {
        const p = c.geoNow()!;
        const e = (p.lon - R.lon) * D * 6371000 * Math.cos(R.lat * D);
        const n = (p.lat - R.lat) * D * 6371000;
        td = { vs: i().vs, along: e, across: -n };
      }
      return !!td && i().gs < 40;
    });
    console.log(`  modes: ${seen.join(" → ")}`);
    console.log(
      `  touchdown: ${td ? `${td.vs.toFixed(0)} ft/min, ${td.along.toFixed(0)} m past the threshold, ${td.across.toFixed(1)} m off` : "none"}`,
    );
    expect(seen.some((m) => m.startsWith("LOC"))).toBeTrue();
    expect(seen.some((m) => m.endsWith("/G/S"))).toBeTrue();
    expect(seen.some((m) => m === "FLARE/FLARE")).toBeTrue();
    expect(td).not.toBeNull();
    expect(td!.vs).toBeGreaterThan(-600);
    expect(td!.along).toBeGreaterThan(0);
    expect(td!.along).toBeLessThan(1500);
    expect(Math.abs(td!.across)).toBeLessThan(15);
    expect(F.lat).toBe("ROLL OUT");
    // (the roll out: slowed to 40 kt on the runway, on its centreline)
    const p = c.geoNow()!;
    const along = (p.lon - R.lon) * D * 6371000 * Math.cos(R.lat * D);
    const across = -(p.lat - R.lat) * D * 6371000;
    console.log(`  roll out: 40 kt at ${along.toFixed(0)} m, ${across.toFixed(1)} m off, the levers ${c.pilot.throttle}, A/THR ${F.athr}`);
    expect(along).toBeLessThan(R.len);
    expect(Math.abs(across)).toBeLessThan(15);
    expect(F.athr).toBeFalse();
  }, 600_000);
});
