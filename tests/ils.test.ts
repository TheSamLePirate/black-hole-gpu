import { afterEach, expect, test } from "bun:test";
import { fleet } from "../src/fleet";
import { arrivalFixes, departureFix, fromRunway, ILS, ilsReading, type IlsRunway, onRunway, runwayId } from "../src/game/ils";
import { ourGroundPose } from "../src/game/place";
import { RUNWAY_LENGTH, SITES } from "../src/game/sites";
import { add, cross, scale } from "../src/math/vec3";
import { bodyFixedOf, groundRelief, setGroundHeights } from "../src/system/our-surface";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// PLAN-AVIATION-AAA P4: the ILS — its needles as a receiver reads them (the localizer's antenna beyond the far end, the
// glideslope's 300 m in), the arrival's and departure's fixes; and flown headless by the F-35B from 30 km off,
// across the axis: to the localizer, the glideslope captured from below, the gear out, the decision height stable,
// the flare, down in the touchdown zone on the centreline, braked to a stop; and with a hold asked, a lap of the
// racetrack at the initial fix first.

afterEach(() => resetFlights());

const D = Math.PI / 180;
const KEDW = SITES.find((s) => s.icao === "KEDW")!;
const W: IlsRunway = { name: KEDW.name, icao: "KEDW", lat: KEDW.lat, lon: KEDW.lon, hdg: KEDW.rwy!, elev: KEDW.elev!, len: RUNWAY_LENGTH };

test("the needles: centred on the path, a dot off each way; the fixes on the axis", () => {
  // (a height over the threshold's level plane: over the sea, the Earth's curve added)
  const at = (along: number, across: number, h: number) => ({
    ...fromRunway(W, along, across),
    alt: W.elev + h + (along * along + across * across) / (2 * 6_371_008.8),
  });
  const onPath = (along: number) => (ILS.gpi - along) * Math.tan(ILS.glide * D);
  const r0 = ilsReading(W, at(-9300, 0, onPath(-9300)));
  expect(Math.abs(r0.loc)).toBeLessThan(0.02);
  expect(Math.abs(r0.gs)).toBeLessThan(0.05);
  expect(r0.locIn && r0.gsIn).toBe(true);
  // (right of the course: the needle left; low: the glideslope above — fly up)
  const toLoc = RUNWAY_LENGTH + ILS.locBeyond + 9300;
  const r1 = ilsReading(W, at(-9300, Math.tan(ILS.locDot * D) * toLoc, onPath(-9300) - Math.tan(ILS.gsDot * D) * 9600));
  expect(r1.loc).toBeCloseTo(-1, 1);
  expect(r1.gs).toBeCloseTo(1, 1);
  expect(runwayId(W.hdg)).toBe("22");
  const [iaf, faf] = arrivalFixes(W);
  expect(iaf!.name).toBe("IAF22");
  expect(onRunway(W, { ...iaf!, alt: iaf!.alt }).along).toBeCloseTo(-ILS.iaf, -1);
  expect(faf!.alt - W.elev).toBeCloseTo(onPath(-ILS.faf), 0);
  expect(onRunway(W, { ...departureFix(W), alt: 0 }).along).toBeCloseTo(RUNWAY_LENGTH + 6000, -1);
});

/** The desert at Edwards's level (the relief's tiles are the browser's: headless, a flat plain at the runway's). */
const atEdwards = () => setGroundHeights("earth", () => W.elev);

/** The F-35B over Edwards's approach: `along`, `across` the runway's frame [m], `h` over it, heading `hdg` [°], `v`. */
function approachFrom(along: number, across: number, h: number, hdg: number, v: number) {
  atEdwards();
  const p = fromRunway(W, along, across);
  const g = ourGroundPose("earth", p.lat, p.lon, 0);
  const east = g.fwd;
  const north = cross(g.up, east);
  const fwd = add(scale(north, Math.cos(hdg * D)), scale(east, Math.sin(hdg * D)));
  const X = add(g.X, scale(g.up, (W.elev + h - groundAt(p)) / M_METRES));
  const run = flight({ ...g, X, fwd, vel: add(g.vel, scale(fwd, v / C_MPS)), landed: undefined }, false, "f35");
  run.c.s.flightMode = "plane";
  run.c.pilot.throttle = run.c.pilot.engineNow = 0.6;
  fleet.fuel.f35 = 3000;
  run.fly(1);
  return run;
}
/** (the relief's height there: the pose is on it) */
const groundAt = (p: { lat: number; lon: number }) => groundRelief("earth", bodyFixedOf("earth", p.lat, p.lon, 0));

test("flown from 30 km off: the localizer, the glideslope, the gear, minimums, the flare, stopped on the centreline", () => {
  const { c, fly, msgs } = approachFrom(-30_000, 6000, 1500, W.hdg + 25, 160);
  const radio: string[] = [];
  c.onRadio = (s) => radio.push(s);
  c.s.weather = "fair";
  expect(c.ilsStart("KEDW")).toMatch(/ILS approach: KEDW 22/);
  const t = fly(600, () => {
    const R = c.ilsRun;
    if (process.env.TRACE && R && (R.phase === "flare" || R.phase === "final" || R.phase === "rollout")) {
      const g = c.geoNow()!;
      const r = ilsReading(W, g);
      if (Math.round(R.t * 30) % 15 === 0 && r.along > -2000)
        console.log(
          R.phase,
          r.along.toFixed(0),
          r.h.toFixed(1),
          g.vs.toFixed(2),
          g.gs.toFixed(1),
          c.pilot.throttle.toFixed(2),
          c.rolling ? "R" : "",
          c.ourLanded ? "L" : "",
          (c.gearLast?.contact ?? 0).toFixed(2),
        );
    }
    return !c.ilsRun;
  });
  const L = c.ilsLast;
  console.log(`  ${radio.join(" · ")}`);
  console.log(
    `  done in ${t.toFixed(0)} s: ${L?.score}/20, touchdown ${L?.touch?.along.toFixed(0)} m in, ${L?.touch?.across.toFixed(1)} m off, ${L?.touch?.vs.toFixed(2)} m/s; ${msgs.at(-1)}`,
  );
  expect(L).toBeTruthy();
  expect(radio.join(" ")).toMatch(/localizer captured.*glideslope captured.*Minimums.*Touchdown/is);
  expect(L!.touch!.along).toBeGreaterThan(150);
  expect(L!.touch!.along).toBeLessThan(900);
  expect(Math.abs(L!.touch!.across)).toBeLessThan(6);
  expect(L!.touch!.vs).toBeGreaterThan(-2.5);
  expect(L!.score).toBeGreaterThan(14);
}, 300_000);

test("a hold asked: a lap of the racetrack at the initial fix, then the approach", () => {
  const { c, fly } = approachFrom(-35_000, -4000, 1200, W.hdg, 150);
  const radio: string[] = [];
  c.onRadio = (s) => radio.push(s);
  c.ilsStart("KEDW", { hold: 1 });
  const held = fly(400, () => c.ilsRun?.phase === "hold");
  const lap = fly(600, () => c.ilsRun?.phase === "intercept");
  const t = fly(600, () => !c.ilsRun);
  console.log(`  held after ${held.toFixed(0)} s, a lap in ${lap.toFixed(0)} s, landed ${t.toFixed(0)} s later: ${c.ilsLast?.score}/20`);
  expect(radio.join(" ")).toMatch(/hold at the initial fix.*holding.*localizer captured.*Touchdown/is);
  expect(lap).toBeGreaterThan(90);
  expect(c.ilsLast!.touch!.along).toBeLessThan(900);
}, 300_000);

test("far too high on the glideslope: over the threshold above minimums — the missed approach, round again", () => {
  const { c, fly } = approachFrom(-12_500, 0, 2500, W.hdg, 110);
  const radio: string[] = [];
  c.onRadio = (s) => radio.push(s);
  c.ilsStart("KEDW");
  fly(300, () => {
    if (process.env.TRACE && Math.round((c.ilsRun?.t ?? 0) * 30) % 60 === 0) {
      const g = c.geoNow()!;
      const r = ilsReading(W, g);
      console.log(c.ilsRun?.phase, r.along.toFixed(0), r.h.toFixed(0), r.gs.toFixed(2), g.vs.toFixed(1));
    }
    return (c.ilsRun?.missed ?? 0) > 0 && c.ilsRun?.phase === "toIaf";
  });
  console.log(`  ${radio.join(" · ")}`);
  expect(c.ilsRun?.missed).toBe(1);
  expect(c.ilsRun?.phase).toBe("toIaf");
  expect(radio.join(" ")).toMatch(/Go around/);
}, 300_000);

test("a flight plan to Edwards with its procedures: LNAV to the initial fix, then the ILS — down and stopped", () => {
  const { c, fly } = approachFrom(-60_000, 15_000, 3000, W.hdg - 20, 200);
  const radio: string[] = [];
  c.onRadio = (s) => radio.push(s);
  const g = c.geoNow()!;
  c.nav.route.wps = [
    { name: "HERE", lat: g.lat, lon: g.lon },
    { name: "KEDW", lat: KEDW.lat, lon: KEDW.lon, field: { icao: "KEDW", elev: KEDW.elev!, rwy: KEDW.rwy } },
  ];
  c.routeChanged();
  expect(c.routeProcedures()).toBe("Procedures: IAF22, FAF22");
  expect(c.nav.route.wps.map((w) => w.name)).toEqual(["HERE", "IAF22", "FAF22", "KEDW"]);
  c.navToggle("both");
  const toIls = fly(600, () => !!c.ilsRun);
  const t = fly(600, () => !c.ilsRun);
  console.log(
    `  the ILS from the plan after ${toIls.toFixed(0)} s, down ${t.toFixed(0)} s later: ${c.ilsLast?.score}/20, ${c.ilsLast?.touch?.along.toFixed(0)} m in`,
  );
  expect(c.ilsLast?.rwy).toBe("KEDW 22");
  expect(c.ilsLast!.touch!.along).toBeLessThan(900);
}, 300_000);

test("established on the final already, 5 km out: carried on down, no detour to the initial fix", () => {
  const h = (ILS.gpi + 5000) * Math.tan(ILS.glide * D);
  const { c, fly } = approachFrom(-5000, 40, h, W.hdg, 90);
  c.gearDown = true;
  c.ilsStart("KEDW");
  const t = fly(200, () => !c.ilsRun);
  console.log(`  down and stopped in ${t.toFixed(0)} s: ${c.ilsLast?.score}/20, ${c.ilsLast?.touch?.along.toFixed(0)} m in`);
  expect(t).toBeLessThan(120);
  expect(c.ilsLast!.touch!.along).toBeLessThan(900);
}, 300_000);
