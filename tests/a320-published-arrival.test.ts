import { afterAll, afterEach, expect, test } from "bun:test";
import { ourGroundPose } from "../src/game/place";
import { onRunway } from "../src/game/ils";
import { add, cross, scale } from "../src/math/vec3";
import { setGroundHeights } from "../src/system/our-surface";
import { C_MPS, M_METRES } from "../src/units";
import { fieldByCode, runwaysRetry } from "../src/world/runways";
import { approachesRetry, loadApproachTile } from "../src/world/approaches";
import { flight, resetFlights } from "./helpers/flight";

// The A320 on a published arrival (docs/PLAN-APPROCHES.md AP3): a plan to San Francisco, its arrival put in by the plan's
// procedures — the FAA's ILS 28R (CIFP 2611), the transition whose first fix is the nearest (ARCHI from the east), its fixes and
// their altitudes —, flown by the FMGC in NAV, the approach engaged at the IF (CEPIN, on the axis): LOC, G/S, LAND, down on 28R.
// The tiles are the repository's (fetch served from assets/), the relief flat at the sea.

const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: string | URL | Request) => {
  const url = String(u instanceof Request ? u.url : u);
  const m = /(runways|approaches)\/v1\/(.+\.json)$/.exec(url);
  if (!m) return new Response("", { status: 404 });
  const f = Bun.file(`assets/${m[1]}/v1/${m[2]}`);
  return (await f.exists()) ? new Response(f) : new Response("", { status: 404 });
}) as typeof fetch;
// (the fetches another test file saw fail — no server there — forgotten: asked again through this one)
runwaysRetry();
approachesRetry();
afterAll(() => {
  globalThis.fetch = realFetch;
});
afterEach(resetFlights);

const D = Math.PI / 180;
const FT = 3.28084;

test("KSFO's published ILS 28R via ARCHI: the plan's fixes, NAV, the approach engaged at CEPIN, landed on 28R", async () => {
  const ksfo = (await fieldByCode("KSFO"))!;
  await loadApproachTile(ksfo.lat, ksfo.lon);
  setGroundHeights("earth", () => 0);
  // (60 km east-south-east, 2 400 m up, flying west at 125 m/s)
  const lat = 37.45,
    lon = -121.7;
  const g = ourGroundPose("earth", lat, lon, 0);
  const east = g.fwd;
  const north = cross(g.up, east);
  const hdg = 285 * D;
  const fwd = add(scale(north, Math.cos(hdg)), scale(east, Math.sin(hdg)));
  const X = add(g.X, scale(g.up, 2400 / M_METRES));
  const { c, fly } = flight({ ...g, X, fwd, vel: add(g.vel, scale(fwd, 125 / C_MPS)), landed: undefined }, false, "a320");
  c.s.flightMode = "plane";
  c.s.weather = "fair";
  c.gearDown = false;
  c.gearExt = 0;
  c.gearInit = true;
  c.pilot.throttle = 0.62;
  fly(6);
  c.approachSelect({ field: "KSFO", approach: "I28R" }, "test");
  const here = c.geoNow()!;
  c.nav.route.wps = [
    { name: "HERE", lat: here.lat, lon: here.lon },
    { name: "KSFO", lat: ksfo.lat, lon: ksfo.lon, field: { icao: "KSFO", elev: ksfo.elev, rwy: 298 } },
  ];
  c.routeChanged();
  const said = c.routeProcedures();
  console.log(`  ${said}`);
  const names = c.nav.route.wps.map((w) => w.name);
  expect(names.slice(-4)).toEqual(["DUMBA", "CEPIN", "AXMUL", "KSFO"]);
  expect(names).toContain("ARCHI");
  // (NAV and AP1, the A/THR — a second after the plan, the FMGC's LNAV in —; the FCU down to the IF's « at or above 3 000 ft »)
  fly(1);
  console.log(`  ${c.a320ApKey("nav")} · ${c.a320ApKey("athr")} · lat ${c.a320Fmgc?.lat} ap ${c.a320Fmgc?.ap} in ${!!c.a320FmgcIn}`);
  const F = c.a320Fmgc!;
  F.alt = 3000;
  F.altPull(c.a320FmgcIn ?? undefined);
  let engagedAt = "";
  let est = Number.NaN;
  const W = { name: "KSFO", icao: "KSFO", lat: 37.61391944, lon: -122.35805833, hdg: 297.8, elev: 4, len: 3600 };
  let k = 0;
  const t = fly(2400, () => {
    if (process.env.TRACE && k++ % 900 === 0) {
      const q = c.geoNow()!;
      console.log(
        `   ${F.lat}/${F.vert} ap ${F.ap} active ${c.nav.last.l?.active} ${c.nav.route.wps[c.nav.last.l?.active ?? 0]?.name} lnav ${c.nav.last.l?.hdg?.toFixed(2)} hdg ${F.hdg} alt ${q.alt.toFixed(0)} pos ${q.lat.toFixed(3)},${q.lon.toFixed(3)} say ${c.nav.say}`,
      );
    }
    if (!engagedAt && c.a320App) engagedAt = c.nav.route.wps[(c.nav.last.l?.active ?? 1) - 1]?.name ?? "?";
    const o = onRunway(W, c.geoNow()!);
    if (Number.isNaN(est) && /^(LOC|LAND)/.test(F.lat) && F.vert.startsWith("G/S")) est = o.along;
    return !!c.ilsLast;
  });
  const L = c.ilsLast;
  console.log(
    `  the approach engaged after ${engagedAt}, established ${(-est / 1000).toFixed(1)} km out, ${L?.rwy} ${L?.score}/20, touchdown ${L?.touch?.along.toFixed(0)} m, ${t.toFixed(0)} s; FCU ${F.alt} ft`,
  );
  expect(engagedAt).toBe("CEPIN");
  expect(L?.rwy).toBe("KSFO 28R");
  expect(est).toBeLessThan(-9300);
  expect(L!.score).toBeGreaterThan(14);
  void FT;
}, 600_000);
