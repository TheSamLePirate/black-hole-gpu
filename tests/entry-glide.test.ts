import { afterEach, expect, test } from "bun:test";
import { ourGroundPose } from "../src/game/place";
import { SITES } from "../src/game/sites";
import { add, scale } from "../src/math/vec3";
import { entryRecordStart } from "../src/controller/entry-record";
import { APPROACH } from "../src/controller/computer";
import { spinAxis } from "../src/controller/util";
import { M_METRES } from "../src/units";
import { flight, resetFlights, touchdown } from "./helpers/flight";
import { groundVelocity } from "../src/system/our-surface";

// The Ranger's glide from the entry's hand-over to the runway, flown frame by frame by the controller (no page): the approach's
// energy managed — the air brake only past what the way left asks, the shortest way short of it (computer.ts approach). The
// hand-overs of 26 Nov 2026's live flights (kerr-mini, scripts/live-entry.ts): Edwards 83–101 km aside of the runway, 28 km up at
// 1 000 m/s heading away from it — the circuit's air brake full out for four minutes, down 5 to 20 km beside the runway, 4 of 4.

afterEach(resetFlights);

const C = 299792458;

/**
 * The Ranger handed over to its glide at a place in Edwards's runway frame [km: along its landing direction from the threshold,
 * across to its right], `hKm` over the ground, `speed` [m/s] along a heading `psiDeg` from the runway's [° right], falling `vs`.
 */
function glideFrom(o: { alongKm: number; acrossKm: number; hKm: number; speed: number; vs: number; psiDeg: number }) {
  const site = SITES.find((s) => s.name.startsWith("Edwards"))!;
  const D = Math.PI / 180;
  const g = ourGroundPose("earth", site.lat, site.lon, 0);
  const up = g.up;
  // (the site's north and east on its ground)
  const z = spinAxis("earth", 0) as [number, number, number];
  const k = z[0] * up[0] + z[1] * up[1] + z[2] * up[2];
  const nRaw = [z[0] - k * up[0], z[1] - k * up[1], z[2] - k * up[2]] as [number, number, number];
  const north = scale(nRaw, 1 / Math.hypot(...nRaw)) as [number, number, number];
  const east: [number, number, number] = [
    north[1] * up[2] - north[2] * up[1],
    north[2] * up[0] - north[0] * up[2],
    north[0] * up[1] - north[1] * up[0],
  ];
  const hd = (site.rwy ?? 0) * D;
  const along = add(scale(north, Math.cos(hd)), scale(east, Math.sin(hd))) as [number, number, number];
  const right: [number, number, number] = [
    along[1] * up[2] - along[2] * up[1],
    along[2] * up[0] - along[0] * up[2],
    along[0] * up[1] - along[1] * up[0],
  ];
  const X = add(
    add(add(g.X, scale(along, (o.alongKm * 1e3) / M_METRES)), scale(right, (o.acrossKm * 1e3) / M_METRES)),
    scale(up, (o.hKm * 1e3) / M_METRES),
  );
  const ps = o.psiDeg * D;
  const hdir = add(scale(along, Math.cos(ps)), scale(right, Math.sin(ps))) as [number, number, number];
  const vel = add(add(groundVelocity("earth", X, 0), scale(hdir, o.speed / C)), scale(up, o.vs / C));
  // (APPROACH_OFF=1: the approach as before its energy management — the A/B's other side)
  APPROACH.energy = process.env.APPROACH_OFF !== "1";
  // (APPROACH_NO=far,lead,…: those parts of it off)
  for (const k of ["brake", "far", "lead", "low", "high", "spiral"] as const)
    APPROACH[k] = !(process.env.APPROACH_NO ?? "").split(",").includes(k);
  const run = flight({ ...g, X, fwd: hdir, up, vel, landed: undefined }, false, "ranger");
  const { c } = run;
  c.entrySite = site;
  c.pilot.auto = "none";
  c.pilot.setAuto("entry");
  c.entryRun = {
    phase: "glide",
    site,
    tBurn: 0,
    dv: 0,
    done: 0,
    guid: null,
    bank: 0,
    next: Infinity,
    alpha: 0.35,
    gPrev: null,
    short: 90e3,
    handover: 2.5,
  };
  entryRecordStart(c, site, { mach: 2.5, short: 90e3 });
  return run;
}

/** (TRACE=1) the flight's summary and a sample every 15 */
function trace(c: ReturnType<typeof glideFrom>["c"]) {
  console.log(JSON.stringify(c.entryLog!.summary()));
  for (const q of c.entryLog!.samples.filter((_, i) => i % 15 === 0))
    console.log(
      `t ${q.t.toFixed(0)} ${q.leg} h ${((q.agl ?? 0) / 1e3).toFixed(1)} v ${q.v.toFixed(0)} M ${q.mach?.toFixed(2)} | along ${((q.app?.along ?? 0) / 1e3).toFixed(1)} across ${((q.app?.across ?? 0) / 1e3).toFixed(1)} | E ${((q.energy?.e ?? 0) / 1e3).toFixed(1)} need ${((q.energy?.need ?? 0) / 1e3).toFixed(1)} toGo ${((q.energy?.toGo ?? 0) / 1e3).toFixed(0)}${q.energy?.low ? " LOW" : ""} | brake ${q.airBrake.toFixed(2)} α ${q.alpha} γ ${q.gamma} γref ${q.gRef} bank ${q.bank}`,
    );
}

test("the glide from Edwards's live hand-over — 88 km aside, 61 km past the threshold, 28 km up at 1 000 m/s heading away —: onto the runway", () => {
  const { c, msgs, fly } = glideFrom({ alongKm: 61, acrossKm: -88, hKm: 28, speed: 1000, vs: -240, psiDeg: 180 });
  fly(1500, () => !!c.ourLanded || !!c.airFlight.failure);
  const td = touchdown(msgs);
  const s = c.entryLog!.summary();
  if (process.env.TRACE) trace(c);
  expect(c.airFlight.failure).toBeNull();
  expect(td.said).toMatch(/Touchdown on Earth/);
  expect(td.sink!).toBeLessThanOrEqual(1.5);
  // (on the runway: past its threshold, within its half width of the axis)
  expect(s.touchdown).not.toBeNull();
  expect(s.touchdown!.along).toBeGreaterThan(0);
  expect(Math.abs(s.touchdown!.across)).toBeLessThan(30);
}, 600_000);

for (const h of [
  // (26 Nov 2026 with the first side fixed, live on kerr-mini: 6 km aside, 67 km past the threshold, 24 km up; landed)
  {
    name: "Edwards's hand-over with the guidance's first side fixed",
    alongKm: 67,
    acrossKm: -6,
    hKm: 24.4,
    speed: 1058,
    vs: -294,
    psiDeg: 180,
  },
  // (Kennedy's, live the same day: 64 km aside, 8.5 km short of the threshold, 23 km up, 1 080 m/s, heading back towards the axis —
  // landed after a wide turn)
  { name: "a hand-over 64 km aside, short of the threshold", alongKm: -8.5, acrossKm: 64, hKm: 23.4, speed: 1080, vs: -340, psiDeg: -110 },
  // (between them: 40 km aside past the far end heading back along the runway; 50 km aside, 30 km short, heading down it)
  // (synthetic: a go-around allowed — the 40 km one goes round once, 149 m off the axis at the minima out of its spiral: the final's
  // lateral capture, as before the energy management; landed on the second)
  {
    name: "a hand-over 40 km aside past the far end",
    alongKm: 40,
    acrossKm: 40,
    hKm: 26,
    speed: 1030,
    vs: -260,
    psiDeg: 200,
    goAround: true,
  },
  { name: "a hand-over 50 km aside, 30 km short", alongKm: -30, acrossKm: -50, hKm: 25, speed: 1040, vs: -280, psiDeg: 20, goAround: true },
])
  test(`the glide from ${h.name}: onto the runway${"goAround" in h ? "" : " at the first approach"}`, () => {
    const { c, msgs, fly } = glideFrom(h);
    fly(1500, () => !!c.ourLanded || !!c.airFlight.failure);
    const td = touchdown(msgs);
    const s = c.entryLog!.summary();
    if (process.env.TRACE) trace(c);
    expect(c.airFlight.failure).toBeNull();
    expect(td.said).toMatch(/Touchdown on Earth/);
    expect(td.sink!).toBeLessThanOrEqual(1.5);
    expect(s.touchdown!.along).toBeGreaterThan(0);
    expect(Math.abs(s.touchdown!.across)).toBeLessThan(30);
    if (!("goAround" in h)) expect(msgs.some((m) => /Go-around/.test(m))).toBe(false);
  }, 600_000);
