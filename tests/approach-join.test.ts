import { afterEach, expect, test } from "bun:test";
import { fleet } from "../src/fleet";
import { floorAt, planJoin } from "../src/game/approach-plan";
import { fromRunway, ILS, ilsReading, type IlsRunway } from "../src/game/ils";
import { ourGroundPose } from "../src/game/place";
import { RUNWAY_LENGTH, SITES } from "../src/game/sites";
import { add, cross, scale } from "../src/math/vec3";
import { bodyFixedOf, groundRelief, setGroundHeights } from "../src/system/our-surface";
import { C_MPS, M_METRES } from "../src/units";
import { flight, resetFlights } from "./helpers/flight";

// The approach's join (docs/PLAN-APPROCHES.md §4.4, AP2), flown headless by the F-35B at Edwards from its four sides, 30 to
// 50 km out, high and low: on the localizer and the glideslope before the final fix, no missed approach, never over the field
// on the way in (no turn back at a fix behind it), down in the touchdown zone. And the plan itself: a downwind on the craft's
// side when it comes from beyond the field, straight in from behind the final, every point clear of a ridge put under its way.
// Before 15 Nov 2026 the jet flew straight to a fixed initial fix on the axis 18.5 km out: from the far side, over the field.

afterEach(() => resetFlights());

const D = Math.PI / 180;
const KEDW = SITES.find((s) => s.icao === "KEDW")!;
const W: IlsRunway = {
  name: KEDW.name,
  icao: "KEDW",
  lat: KEDW.lat,
  lon: KEDW.lon,
  hdg: KEDW.rwy!,
  elev: KEDW.elev!,
  len: KEDW.len ?? RUNWAY_LENGTH,
  des: KEDW.des?.[0],
};
/** (the relief's height there: the pose is on it) */
const groundAt = (p: { lat: number; lon: number }) => groundRelief("earth", bodyFixedOf("earth", p.lat, p.lon, 0));

/** The F-35B in Edwards's runway frame: `along`, `across` [m], `h` over the runway, heading `hdg` [° true], `v` [m/s]. */
function placed(along: number, across: number, h: number, hdg: number, v: number) {
  setGroundHeights("earth", () => W.elev);
  const p = fromRunway(W, along, across);
  const g = ourGroundPose("earth", p.lat, p.lon, 0);
  const east = g.fwd;
  const north = cross(g.up, east);
  const fwd = add(scale(north, Math.cos(hdg * D)), scale(east, Math.sin(hdg * D)));
  const X = add(g.X, scale(g.up, (W.elev + h - groundAt(p)) / M_METRES));
  const run = flight({ ...g, X, fwd, vel: add(g.vel, scale(fwd, v / C_MPS)), landed: undefined }, false, "f35");
  run.c.s.flightMode = "plane";
  run.c.s.weather = "fair";
  run.c.pilot.throttle = run.c.pilot.engineNow = 0.6;
  fleet.fuel.f35 = 3000;
  run.fly(1);
  return run;
}

/** The runway's middle in its frame (the field: within 3 km of it is « over the field »). */
const mid = () => W.len / 2;

interface Flown {
  name: string;
  entry: string;
  established: number;
  nearField: number;
  missed: number;
  score: number;
  touch: number;
  t: number;
}

function flyJoin(name: string, along: number, across: number, h: number, hdg: number): Flown {
  const { c, fly } = placed(along, across, h, hdg, 170);
  const radio: string[] = [];
  c.onRadio = (s) => radio.push(s);
  // (23L asked: from beyond the field the automatic choice takes 05R, in line — the join's worst case asked of it here)
  expect(c.ilsStart("KEDW", { runway: "23L" })).toMatch(/KEDW 23L/);
  let established = Number.NaN;
  let nearField = Number.POSITIVE_INFINITY;
  let entry = "?";
  let missed = 0;
  const t = fly(900, () => {
    const R = c.ilsRun;
    if (!R) return true;
    if (R.join && entry === "?") entry = R.join.plan.entry;
    missed = Math.max(missed, R.missed);
    const r = ilsReading(W, c.geoNow()!);
    if (R.phase === "toIaf" || R.phase === "intercept" || R.phase === "hold")
      nearField = Math.min(nearField, Math.hypot(r.along - mid(), r.across));
    if (Number.isNaN(established) && R.phase === "final") established = r.along;
    return false;
  });
  const L = c.ilsLast;
  const f: Flown = {
    name,
    entry,
    established,
    nearField,
    missed,
    score: L?.score ?? 0,
    touch: L?.touch?.along ?? Number.NaN,
    t,
  };
  console.log(
    `  ${name} (${entry}): established ${(-established / 1000).toFixed(1)} km out, nearest the field ${(nearField / 1000).toFixed(1)} km on the way, ${f.missed} missed, ${f.score}/20, touchdown ${f.touch.toFixed(0)} m in, ${t.toFixed(0)} s · ${radio.join(" · ")}`,
  );
  return f;
}

const DEPARTURES: [string, number, number, number][] = [
  // name, along, across [m], heading off the final's course [°]
  ["behind the final", -45_000, 4000, 0],
  ["beyond the field", 38_000, -3000, 180],
  ["left, abeam", -2000, -35_000, 90],
  ["right, ahead of the field", -15_000, 40_000, -90],
];

for (const [high, h] of [
  ["high", 3000],
  ["low", 700],
] as const) {
  test(`from the four sides, ${high} (${h} m): established before the final fix, never over the field, down`, () => {
    const rows = DEPARTURES.map(([n, along, across, rel]) => flyJoin(`${n} ${high}`, along, across, h, W.hdg + rel));
    for (const f of rows) {
      expect(`${f.name}: missed ${f.missed}`).toBe(`${f.name}: missed 0`);
      expect(f.established).toBeLessThan(-ILS.faf);
      expect(f.nearField).toBeGreaterThan(3000);
      expect(f.touch).toBeGreaterThan(150);
      expect(f.touch).toBeLessThan(900);
      expect(f.score).toBeGreaterThan(14);
    }
  }, 600_000);
}

test("the plan: straight in from behind, a downwind on the craft's side from beyond, a ridge cleared", () => {
  const at = (along: number, across: number, h: number, rel: number) => ({
    ...fromRunway(W, along, across),
    alt: W.elev + h,
    trk: (W.hdg + rel) * D,
  });
  const flat = () => W.elev;
  const behind = planJoin(W, at(-45_000, 4000, 3000, 0), flat);
  expect(behind.entry).toBe("straight");
  expect(behind.pts.at(-1)!.name).toBe("JOIN");
  const beyond = planJoin(W, at(38_000, -3000, 3000, 180), flat);
  expect(beyond.entry).toBe("vectors");
  expect(beyond.pts.map((p) => p.name)).toEqual(["DW", "BASE", "JOIN"]);
  // (the downwind on the craft's side — left of the final —, 6 km off: never over the field)
  for (const p of beyond.pts.slice(0, 2)) expect(p.y).toBeCloseTo(-6000, -1);
  // (a 1 500 m ridge under the downwind's way, 6 km left of the axis: its points raised over it, 300 m clear)
  const ridge = (lat: number, lon: number) => {
    const g = ilsReading(W, { lat, lon, alt: 0 });
    return Math.abs(g.across + 6000) < 2000 ? W.elev + 1500 : W.elev;
  };
  const over = planJoin(W, at(38_000, -3000, 3000, 180), ridge);
  for (const p of over.pts.slice(0, 2)) expect(p.alt).toBeGreaterThanOrEqual(W.elev + 1800);
  // (the join itself under the glideslope, met from below)
  const j = behind.pts.at(-1)!;
  expect(j.alt - W.elev).toBeLessThan((ILS.gpi + 16_000) * Math.tan(ILS.glide * D));
});

test("a ridge under the localizer's outer part (Nice's 22R, 15 Nov 2026): the step-down holds over it, the slope met past it", () => {
  // (a 1 000 m ridge 20–24 km out on the axis — beyond the slope's own check (18.5 km), the slope 60–270 m over it —; the craft
  // on the line, 32 km out, 2 000 m up)
  const ridge = (lat: number, lon: number) => {
    const g = ilsReading(W, { lat, lon, alt: 0 });
    return g.along < -20_000 && g.along > -24_000 && Math.abs(g.across) < 1500 ? W.elev + 1000 : W.elev;
  };
  const p = fromRunway(W, -32_000, 0);
  const plan = planJoin(W, { ...p, alt: W.elev + 2000, trk: W.hdg * D }, ridge);
  expect(plan.entry).toBe("straight");
  expect(floorAt(plan, -25_000)).toBeGreaterThanOrEqual(W.elev + 1300);
  expect(floorAt(plan, -21_000)).toBeGreaterThanOrEqual(W.elev + 1300);
  expect(floorAt(plan, -15_000)).toBeLessThan(W.elev + 400);
  // flown: never under 300 m over the ridge, established before the final fix, down — the ridge as the physics reads the
  // ground (the relief read at the place's geodetic normal: its latitude the normal's)
  const { c, fly } = placed(-32_000, 0, 2000, W.hdg, 170);
  setGroundHeights("earth", (g) => ridge(Math.asin(g[2]) / D, Math.atan2(g[1], g[0]) / D));
  console.log(`  ${c.ilsStart("KEDW", { runway: "23L" })}`);
  let least = Number.POSITIVE_INFINITY;
  let est = Number.NaN;
  fly(900, () => {
    const R = c.ilsRun;
    if (!R) return true;
    const r = ilsReading(W, c.geoNow()!);
    if (r.along < -20_000 && r.along > -24_000) least = Math.min(least, r.h - 1000);
    if (Number.isNaN(est) && R.phase === "final") est = r.along;
    return false;
  });
  console.log(
    `  over the ridge by ${least.toFixed(0)} m at the least, established ${(-est / 1000).toFixed(1)} km out, ${c.ilsLast?.score}/20`,
  );
  expect(least).toBeGreaterThan(250);
  expect(est).toBeLessThan(-ILS.faf);
  expect(c.ilsLast!.touch!.along).toBeLessThan(900);
}, 300_000);
