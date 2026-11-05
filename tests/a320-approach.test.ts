import { afterEach, describe, expect, test } from "bun:test";
import type { IlsRunway } from "../src/game/ils";
import { fromRunway, onRunway } from "../src/game/ils";
import { ourGroundPose } from "../src/game/place";
import { add, cross, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The A320's ILS approach as the controller vectors it (controller/a320ap.ts a320Approach — Sam, 5 Nov 2026: the
// approaches of Toulon-Hyères flown by the lab): from 28 km out, 50° off the final's axis, clean at 1 800 m — to the
// entry point, the 30° intercept with APPR armed, LOC and G/S captured, the configuration a step at a time, LAND, FLARE,
// the touchdown on that runway, ROLL OUT to a stop and the approach's grade. Both sides of the axis.

afterEach(resetFlights);

const D = Math.PI / 180;

function approachFrom(off: number) {
  const R: IlsRunway = { name: "TEST", icao: "TEST", lat: 40, lon: -35, hdg: 90, elev: 0, len: 3000 };
  const back = (R.hdg + 180 + off + 360) % 360;
  const p = fromRunway(R, 0, 0);
  const lat = p.lat + (28_000 * Math.cos(back * D)) / 111_320;
  const lon = p.lon + (28_000 * Math.sin(back * D)) / (111_320 * Math.cos(p.lat * D));
  const g = ourGroundPose("earth", lat, lon, 0);
  const east = g.fwd;
  const north = cross(g.up, east);
  const h = ((back + 180) % 360) * D;
  const fwd = add(scale(north, Math.cos(h)), scale(east, Math.sin(h)));
  const X = add(g.X, scale(g.up, 1800 / M_METRES));
  const run = flight({ ...g, X, fwd, vel: add(g.vel, scale(fwd, 120 / C_MPS)), landed: undefined }, false, "a320");
  const { c, fly } = run;
  c.s.flightMode = "plane";
  c.gearDown = false;
  c.gearExt = 0;
  c.gearInit = true;
  c.pilot.throttle = 0.62;
  fly(6);
  const said = c.a320Approach(R);
  const seen: string[] = [];
  let k = 0;
  fly(1500, () => {
    const F = c.a320Fmgc!;
    const m = `${c.a320App?.leg ?? "-"} ${F.lat}/${F.vert}`;
    if (seen.at(-1) !== m) seen.push(m);
    if (process.env.TRACE && k++ % 300 === 0) {
      const q = c.geoNow()!;
      const o = onRunway(R, q);
      console.log(
        `   ${m} along ${(o.along / 1000).toFixed(1)} km across ${(o.across / 1000).toFixed(2)} km h ${o.h.toFixed(0)} m ias ${c.a320FmgcIn?.ias.toFixed(0)} flaps ${(c.airFlight.cfg.flaps ?? 0) * 4} gear ${c.gearDown} hdg ${F.hdg}`,
      );
    }
    return !!c.ilsLast;
  });
  return { c, said, seen };
}

describe("A320 ILS approach (a320Approach)", () => {
  for (const off of [50, -50]) {
    test(`from 28 km, ${off}° off the axis: vectored, captured, landed on that runway`, () => {
      const { c, said, seen } = approachFrom(off);
      console.log(`  ${said}\n  modes: ${seen.join(" → ")}`);
      const L = c.ilsLast;
      console.log(`  ${JSON.stringify(L)}`);
      expect(seen.some((m) => m.includes(" LOC"))).toBeTrue();
      expect(seen.some((m) => m.endsWith("/G/S"))).toBeTrue();
      expect(L).not.toBeNull();
      expect(L!.rwy).toBe("TEST 09");
      expect(L!.touch!.vs).toBeGreaterThan(-3);
      expect(Math.abs(L!.touch!.across)).toBeLessThan(10);
      expect(L!.touch!.along).toBeGreaterThan(100);
      expect(L!.touch!.along).toBeLessThan(1000);
    }, 600_000);
  }
});
