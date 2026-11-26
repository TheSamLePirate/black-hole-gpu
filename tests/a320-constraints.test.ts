import { afterEach, expect, test } from "bun:test";
import { a320Cstr } from "../src/controller/a320ap";
import type { Waypoint } from "../src/game/flightplan";
import { ourGroundPose } from "../src/game/place";
import { add, scale } from "../src/math/vec3";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The managed vertical profile's constraints (docs/PLAN-A320-VOL-AAA.md N3 — controller/a320ap.ts a320Cstr, a320/fmgc/fmgc.ts):
// climbing managed (CLB) towards the FCU's altitude, a SID's « at or below » ahead levels the A320 off at it (ALT CST* then ALT CST),
// then, the point passed, CLB again to the FCU's altitude; descending (DES), a STAR's « at or above » is a floor. Before 26 Nov 2026
// the FMGC was fed `cstr: null`: every constraint of the plan ignored.

afterEach(resetFlights);
const FT = 0.3048;

test("a320Cstr: the first binding constraint ahead — at or below climbing, at or above descending", () => {
  const W = (name: string, lo: number | null, hi: number | null): Waypoint => ({
    name,
    lat: 0,
    lon: 0,
    cstr: [lo === null ? null : lo * FT, hi === null ? null : hi * FT],
  });
  const wps = [W("A", 3000, null), W("B", null, 12000), W("C", null, 14000), W("D", 9000, 9000)];
  // (climbing from 8 000 to FL160: A's « at or above » binds nothing climbing; B's « at or below 12 000 »)
  expect(a320Cstr(wps, 0, 8000, 16000)).toBe(12000);
  // (B passed: C's)
  expect(a320Cstr(wps, 2, 12000, 16000)).toBe(14000);
  // (the FCU at 11 000: B's 12 000 above it binds nothing — D's « at 9 000 » is the first under it)
  expect(a320Cstr(wps, 0, 8000, 11000)).toBe(9000);
  expect(a320Cstr(wps.slice(0, 3), 0, 8000, 11000)).toBeNull();
  // (descending from FL200 to 5 000: D's « at 9 000 » a floor; A's 3 000 under the FCU — none)
  expect(a320Cstr(wps, 3, 20000, 5000)).toBe(9000);
  expect(a320Cstr(wps, 0, 20000, 5000)).toBe(9000);
  expect(a320Cstr(wps, -1, 8000, 16000)).toBeNull();
});

test("flown: CLB to FL160 under a SID's « at or below 12 000 ft » — ALT CST held there, then CLB again past the point", () => {
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, 3048 / M_METRES));
  const { c, fly } = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 130 / C_MPS)), landed: undefined }, false, "a320");
  c.s.flightMode = "plane";
  c.gearDown = false;
  c.gearExt = 0;
  c.gearInit = true;
  c.pilot.throttle = 0.62;
  fly(6);
  const here = c.geoNow()!;
  // (the plan east: a point 45 km on, at or below 12 000 ft, then one 200 km on)
  const east = (km: number) => here.lon + km / (111.32 * Math.cos((here.lat * Math.PI) / 180));
  c.nav.route.wps = [
    { name: "HERE", lat: here.lat, lon: here.lon },
    { name: "CSTR1", lat: here.lat, lon: east(45), cstr: [null, 12000 * FT] },
    { name: "FAR", lat: here.lat, lon: east(200) },
  ];
  c.routeChanged();
  fly(1);
  c.a320ApKey("nav");
  c.a320ApKey("athr");
  const F = c.a320Fmgc!;
  F.alt = 16000;
  F.altPush(c.a320FmgcIn ?? undefined);
  expect(F.vert).toBe("CLB");
  const seen = new Set<string>();
  let held = 0;
  let maxBefore = 0;
  fly(600, () => {
    const i = c.a320FmgcIn!;
    seen.add(F.vert);
    const act = c.nav.route.wps[c.nav.last.l?.active ?? 0]?.name;
    if (act === "CSTR1") {
      maxBefore = Math.max(maxBefore, i.alt);
      if (F.vert === "ALT CST") held++;
    }
    return act === "FAR" && F.vert === "ALT" && Math.abs(i.alt - 16000) < 100;
  });
  const i = c.a320FmgcIn!;
  console.log(
    `  modes ${[...seen].join(" → ")}; before CSTR1 at most ${maxBefore.toFixed(0)} ft, ALT CST ${(held / 60).toFixed(0)} s; now ${i.alt.toFixed(0)} ft ${F.vert}`,
  );
  expect(seen.has("ALT CST")).toBeTrue();
  expect(maxBefore).toBeLessThan(12000 + 150);
  expect(F.vert).toBe("ALT");
  expect(Math.abs(i.alt - 16000)).toBeLessThan(150);
}, 60_000);
