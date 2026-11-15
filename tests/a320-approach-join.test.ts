import { afterEach, expect, test } from "bun:test";
import type { IlsRunway } from "../src/game/ils";
import { fromRunway, ILS, onRunway } from "../src/game/ils";
import { ourGroundPose } from "../src/game/place";
import { add, cross, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The A320's join (docs/PLAN-APPROCHES.md AP3, controller/a320ap.ts): from the four sides of a runway, high and low, its FCU flown
// along the join planned (game/approach-plan.ts) — straight in from behind, else a downwind on its side and a base —: never over
// the field before the final, LOC and G/S captured outside the final fix, landed in the zone. Before 15 Nov 2026 it flew straight
// to a fixed point 22 km out, 6 km aside: from beyond the field, over it.

afterEach(resetFlights);

const D = Math.PI / 180;
const R: IlsRunway = { name: "TEST", icao: "TEST", lat: 40, lon: -35, hdg: 90, elev: 0, len: 3000 };

function flown(name: string, along: number, across: number, hM: number, rel: number) {
  const p = fromRunway(R, along, across);
  const g = ourGroundPose("earth", p.lat, p.lon, 0);
  const east = g.fwd;
  const north = cross(g.up, east);
  const h = (R.hdg + rel) * D;
  const fwd = add(scale(north, Math.cos(h)), scale(east, Math.sin(h)));
  const X = add(g.X, scale(g.up, hM / M_METRES));
  const { c, fly } = flight({ ...g, X, fwd, vel: add(g.vel, scale(fwd, 125 / C_MPS)), landed: undefined }, false, "a320");
  c.s.flightMode = "plane";
  c.gearDown = false;
  c.gearExt = 0;
  c.gearInit = true;
  c.pilot.throttle = 0.62;
  fly(6);
  c.a320Approach(R);
  let near = Number.POSITIVE_INFINITY;
  let est = Number.NaN;
  let rounds = 0;
  let last = "";
  let k = 0;
  const t = fly(1800, () => {
    const A = c.a320App;
    const F = c.a320Fmgc!;
    const o = onRunway(R, c.geoNow()!);
    if (A && A.leg !== "final") near = Math.min(near, Math.hypot(o.along - R.len / 2, o.across));
    if (Number.isNaN(est) && /^(LOC|LAND)/.test(F.lat) && F.vert.startsWith("G/S")) est = o.along;
    if (A && last === "final" && A.leg === "entry") rounds++;
    if (
      process.env.TRACE &&
      Math.round(c.nowTime()) % 1 === 0 &&
      (k = k + 1) % (process.env.FINE && c.a320App?.join.i === 2 ? 60 : 600) === 0
    )
      console.log(
        `   ${A?.leg} ${F.lat}/${F.vert} i ${A?.join.i} along ${(o.along / 1000).toFixed(1)} across ${(o.across / 1000).toFixed(1)} h ${o.h.toFixed(0)} hdg ${F.hdg} fcuAlt ${F.alt} ias ${c.a320FmgcIn?.ias.toFixed(0)} athr ${F.athr}/${F.athrActive} n1 ${c.a320?.engines[0].n1.toFixed(0)} lever ${c.pilot.throttle.toFixed(2)} flaps ${(c.airFlight.cfg.flaps ?? 0) * 4} gear ${c.gearDown}`,
      );
    last = A?.leg ?? "-";
    return !!c.ilsLast;
  });
  const L = c.ilsLast;
  console.log(
    `  ${name}: ${c.a320App?.join.plan.entry ?? ""} established ${(-est / 1000).toFixed(1)} km out, nearest the field ${(near / 1000).toFixed(1)} km, ${rounds} round(s) again, ${L?.score ?? "-"}/20, touchdown ${L?.touch?.along.toFixed(0)} m, ${t.toFixed(0)} s`,
  );
  return { near, est, rounds, L };
}

const DEPARTURES: [string, number, number, number][] = [
  ["behind the final", -45_000, 4000, 0],
  ["beyond the field", 38_000, -3000, 180],
  ["left, abeam", -2000, -35_000, 90],
  ["right, ahead of the field", -15_000, 40_000, -90],
];

if (process.env.ONLY)
  test.only("one", () => {
    const [n, a, x, h, r] = JSON.parse(process.env.ONLY!);
    flown(n, a, x, h, r);
  }, 900_000);

for (const [high, h] of [
  ["high", 3000],
  ["low", 900],
] as const)
  test(`the A320 from the four sides, ${high} (${h} m): never over the field, established before the final fix, landed`, () => {
    for (const [n, along, across, rel] of DEPARTURES) {
      const r = flown(`${n} ${high}`, along, across, h, rel);
      expect(r.L).toBeTruthy();
      expect(r.near).toBeGreaterThan(3000);
      expect(r.est).toBeLessThan(-ILS.faf);
      expect(r.rounds).toBe(0);
      expect(r.L!.touch!.along).toBeGreaterThan(150);
      expect(r.L!.touch!.along).toBeLessThan(1000);
      expect(r.L!.score).toBeGreaterThan(14);
    }
  }, 900_000);
