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
// (the flown ones: ~15 s here, 70 s on the CI's runner — past a 60 s limit, 26 Nov 2026: 240 s each)
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
}, 240_000);

test("flown: the descent armed in cruise, begun at the T/D, the path held (VDEV), at the IF's 3 000 ft, the approach phase at DECEL", () => {
  const g = ourGroundPose("earth", 40, -35, 0);
  const X = add(g.X, scale(g.up, (15000 * FT) / M_METRES));
  const { c, fly } = flight({ ...g, X, vel: add(g.vel, scale(g.fwd, 150 / C_MPS)), landed: undefined }, false, "a320");
  c.s.flightMode = "plane";
  c.gearDown = false;
  c.gearExt = 0;
  c.gearInit = true;
  c.pilot.throttle = 0.62;
  fly(6);
  const here = c.geoNow()!;
  const east = (km: number) => here.lon + km / (111.32 * Math.cos((here.lat * Math.PI) / 180));
  const NMk = 1.852;
  // (the plan east: a fix 20 NM on, the IF 70 NM on at 3 000 ft, the field 80 NM on, at the sea)
  c.nav.route.wps = [
    { name: "HERE", lat: here.lat, lon: here.lon },
    { name: "FIX1", lat: here.lat, lon: east(20 * NMk) },
    {
      name: "IF",
      lat: here.lat,
      lon: east(70 * NMk),
      alt: 3000 * FT,
      cstr: [3000 * FT, 3000 * FT],
      proc: { kind: "arr", approach: "I09", join: true },
    },
    { name: "DEST", lat: here.lat, lon: east(80 * NMk), field: { icao: "DEST", elev: 0 } },
  ];
  c.routeChanged();
  fly(1);
  c.a320ApKey("nav");
  c.a320ApKey("athr");
  const F = c.a320Fmgc!;
  F.fms.crzFl = 150;
  F.alt = 15000;
  F.altPull(c.a320FmgcIn ?? undefined);
  fly(20);
  expect(F.phase).toBe("cruise");
  const td0 = c.a320Vprof!.td!;
  console.log(
    `  cruise ${c.a320FmgcIn!.alt.toFixed(0)} ft ${F.vert}; T/D ${td0.toFixed(1)} NM ahead, DECEL ${c.a320Vprof!.decel?.toFixed(1)} NM`,
  );
  // (the T/D: 37.7 NM of 3° back from the IF's 3 000 to FL150 — about 32 NM on, less the 20 s flown)
  expect(td0).toBeGreaterThan(20);
  expect(td0).toBeLessThan(35);
  // (the FCU set to 3 000 and pushed before the T/D: DES armed, the level kept)
  F.alt = 3000;
  F.altPush(c.a320FmgcIn ?? undefined);
  expect(F.desArmed).toBeTrue();
  fly(2);
  expect(F.fma().vertArmed).toMatch(/DES/);
  expect(F.vert).toMatch(/^ALT/);
  // (flown to the T/D: DES begins there — the T/D still ahead until then)
  let tdAtDes = Number.NaN;
  fly(900, () => {
    if (F.vert === "DES") {
      tdAtDes = c.a320Vprof?.td ?? 0;
      return true;
    }
    return false;
  });
  expect(F.vert).toBe("DES");
  console.log(`  DES begun, the T/D ${tdAtDes.toFixed(2)} NM ahead`);
  expect(Math.abs(tdAtDes)).toBeLessThan(1);
  // (the path held: |VDEV| under 300 ft from a minute after the T/D until the IF; the IF crossed at 3 000 ± 150 ft)
  let vdevMax = 0,
    k = 0;
  let atIf = Number.NaN,
    phaseApp = "",
    spdLow = 0,
    moreDrag = false;
  fly(900, () => {
    k++;
    const v = c.a320Vprof?.vdev;
    if (process.env.TRACE && (k % 1200 === 0 || (k < 1500 && k % 60 === 0))) {
      const i = c.a320FmgcIn!;
      console.log(
        `   t ${(k / 60).toFixed(0)} s: ${i.alt.toFixed(0)} ft path ${c.a320Vprof?.pathAt(0).toFixed(0)} vdev ${v} fpa ${i.fpa.toFixed(1)} ias ${i.ias.toFixed(0)} ${F.thrust}/${F.vert}/${F.lat} ${F.phase} td ${c.a320Vprof?.td} decel ${c.a320Vprof?.decel?.toFixed(1)}`,
      );
    }
    // (on the path while the speed allows — over FL110; under FL100 the 250 kt: the path shallowed, MORE DRAG)
    if (k > 600 && v != null && F.vert === "DES" && c.a320FmgcIn!.alt > 11000) vdevMax = Math.max(vdevMax, Math.abs(v));
    if (c.a320FmgcIn!.alt < 9000 && F.vert === "DES") spdLow = Math.max(spdLow, c.a320FmgcIn!.ias);
    if (F.moreDrag) moreDrag = true;
    if (!phaseApp && F.phase === "approach")
      phaseApp = `${c.nav.route.wps[c.nav.last.l?.active ?? 0]?.name} ${((c.nav.last.l?.dist ?? 0) / 1852).toFixed(1)} NM`;
    if (c.nav.route.wps[c.nav.last.l?.active ?? 0]?.name === "DEST") {
      atIf = c.a320FmgcIn!.alt;
      return true;
    }
    return false;
  });
  console.log(
    `  |VDEV| at most ${vdevMax.toFixed(0)} ft on the path over FL110; under 9 000 ft at most ${spdLow.toFixed(0)} kt, MORE DRAG ${moreDrag}; at the IF ${atIf.toFixed(0)} ft ${F.vert}; approach phase at ${phaseApp}`,
  );
  expect(vdevMax).toBeLessThan(300);
  expect(spdLow).toBeLessThan(275);
  expect(Math.abs(atIf - 3000)).toBeLessThan(150);
  // (DECEL: 5 NM before the IF)
  expect(phaseApp).toMatch(/^IF [4-6]\./);
}, 240_000);
