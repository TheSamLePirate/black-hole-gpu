import { afterEach, describe, expect, test } from "bun:test";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../src/system/ellipsoid";
import { FEED, TrafficFeed, type Plane, type Ship } from "../src/traffic/feed";
import { FOCUS, type FocusGeo, radiiFor, surfaceM, TrafficFocus } from "../src/traffic/focus";
import { overPlace, resetFlights } from "./helpers/flight";

// The traffic's focus (Sam, 24 Nov 2026: « les avions et les bateaux toujours actifs, même en caméra libre sans appareil »;
// traffic/focus.ts): the flown craft while one is flown, else the view's eye — chosen with hysteresis, re-centred only once
// it has gone a quarter of its radius, its radii by its height —; the feed asked about it (traffic/feed.ts); a free camera
// with no craft at all gets the aircraft and the ships about it, placed, labelled, drawn.

afterEach(resetFlights);

const D = Math.PI / 180;
const SFO = { lat: 37.62, lon: -122.38 };
/** a place `e`, `n` metres east and north of another (flat: a few tens of km) */
const off = (g: FocusGeo, e: number, n: number, alt = g.alt): FocusGeo => ({
  lat: g.lat + n / 111_195,
  lon: g.lon + e / (111_195 * Math.cos(g.lat * D)),
  alt,
});

describe("the focus chosen", () => {
  const here: FocusGeo = { ...SFO, alt: 500 };

  test("piloting: the craft; the free camera with no craft: the view's eye; far from the Earth: none", () => {
    const F = new TrafficFocus();
    expect(F.update({ on: true, craft: here, view: here })).toMatchObject({
      who: "craft",
      lat: here.lat,
      lon: here.lon,
      airR: 120,
      seaR: 60,
    });
    const G = new TrafficFocus();
    const eye = off(here, 3000, 2000, 800);
    expect(G.update({ on: true, craft: null, view: eye })).toMatchObject({ who: "view", lat: eye.lat, lon: eye.lon });
    // (far from the Earth: no place over it — nothing asked)
    expect(G.update({ on: true, craft: null, view: null })).toBeNull();
    expect(G.here).toBeNull();
    // (the setting off: nothing asked, the place still known — the sea's own life is made about it)
    const H = new TrafficFocus();
    expect(H.update({ on: false, craft: null, view: eye })).toBeNull();
    expect(H.here).toEqual(eye);
  });

  test("a spectator gone 60 km from the flown craft: the view; back under 40 km: the craft (none between)", () => {
    const F = new TrafficFocus();
    expect(F.update({ on: true, craft: here, view: off(here, 0, 50_000) })!.who).toBe("craft");
    expect(F.update({ on: true, craft: here, view: off(here, 0, 61_000) })!.who).toBe("view");
    expect(F.update({ on: true, craft: here, view: off(here, 0, 45_000) })!.who).toBe("view");
    expect(F.update({ on: true, craft: here, view: off(here, 0, 39_000) })!.who).toBe("craft");
  });

  test("the view's own focus off above 160 km, on again only under 140 km", () => {
    const F = new TrafficFocus();
    expect(F.update({ on: true, craft: null, view: { ...here, alt: 150_000 } })).not.toBeNull();
    expect(F.update({ on: true, craft: null, view: { ...here, alt: 161_000 } })).toBeNull();
    expect(F.update({ on: true, craft: null, view: { ...here, alt: 150_000 } })).toBeNull();
    expect(F.update({ on: true, craft: null, view: { ...here, alt: 139_000 } })).not.toBeNull();
  });

  test("a free camera flown fast: re-centred once every quarter radius, not each frame; a jump counted", () => {
    const F = new TrafficFocus();
    // (100 km north in 1 000 frames of 100 m — Mach 1 at 30 images/s for 33 s)
    let centres = 0,
      last = "";
    for (let i = 0; i <= 1000; i++) {
      const f = F.update({ on: true, craft: null, view: off(here, 0, i * 100) })!;
      const k = `${f.lat},${f.lon}`;
      if (k !== last) centres++;
      last = k;
      // (never farther than a quarter radius from where it is centred)
      expect(surfaceM(f, off(here, 0, i * 100))).toBeLessThanOrEqual(FOCUS.recentre * f.airR * 1e3 + 1);
    }
    console.log(`  100 km in 1 000 frames: ${centres} centres (each ${FOCUS.recentre * 120} km), ${F.moves} moves`);
    expect(centres).toBe(4);
    expect(F.now!.jumps).toBe(0);
    // (a teleport across the bay and beyond: a jump)
    F.update({ on: true, craft: null, view: off(here, 0, 300_000) });
    expect(F.now!.jumps).toBe(1);
  });

  test("its radii by its height: 120/60 km low, wider up to 160/90 km from high up; a new radius re-centres", () => {
    expect(radiiFor(0)).toEqual({ airR: 120, seaR: 60 });
    expect(radiiFor(1000)).toEqual({ airR: 120, seaR: 60 });
    expect(radiiFor(12_000).airR).toBeGreaterThan(140);
    expect(radiiFor(30_000)).toEqual({ airR: 160, seaR: 90 });
    const F = new TrafficFocus();
    F.update({ on: true, craft: null, view: { ...here, alt: 500 } });
    const m = F.moves;
    F.update({ on: true, craft: null, view: { ...here, alt: 40_000 } });
    expect(F.moves).toBe(m + 1);
    expect(F.now!.airR).toBe(160);
  });
});

/** A relay stub: the URLs asked, an empty answer each. */
function relay() {
  const urls: string[] = [];
  const get = async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ planes: [], ships: [], attribution: "test" }));
  };
  return {
    urls,
    feed: new TrafficFeed(
      () => "http://relay",
      get,
      () => true,
    ),
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the feed asked about the focus", () => {
  test("no craft flown: the free camera's place asked — its radii —; a jump asked at once, within the sources' pace", async () => {
    const { urls, feed } = relay();
    const F = new TrafficFocus();
    const eye: FocusGeo = { ...SFO, alt: 600 };
    feed.tick(1000, F.update({ on: true, craft: null, view: eye }), true);
    await settle();
    expect(urls.length).toBe(2);
    expect(urls[0]).toContain(`/traffic/air?lat=${SFO.lat.toFixed(4)}&lon=${SFO.lon.toFixed(4)}&r=120`);
    expect(urls[1]).toContain(`/traffic/sea?lat=${SFO.lat.toFixed(4)}&lon=${SFO.lon.toFixed(4)}&r=60`);
    // (2 s on, the camera 300 km away: the air waits for adsb.lol's 10 s, the sea for its 5 s — then asked at once there)
    const far = off(eye, 0, 300_000);
    feed.tick(1002, F.update({ on: true, craft: null, view: far }), true);
    await settle();
    expect(urls.length).toBe(2);
    feed.tick(1005, F.update({ on: true, craft: null, view: far }), true);
    await settle();
    expect(urls.at(-1)).toContain(`/traffic/sea?lat=${far.lat.toFixed(4)}`);
    feed.tick(1010, F.update({ on: true, craft: null, view: far }), true);
    await settle();
    expect(urls.at(-1)).toContain(`/traffic/air?lat=${far.lat.toFixed(4)}`);
    // (then the pace's own: nothing more for 15 s / 10 s, however the camera moves within a quarter radius)
    for (let t = 1010.5; t < 1015; t += 0.5) feed.tick(t, F.update({ on: true, craft: null, view: off(far, 0, (t - 1010) * 2000) }), true);
    await settle();
    expect(feed.asks).toEqual({ air: 2, sea: 2, trace: 0 });
    // (off: everything dropped, nothing asked)
    feed.tick(1030, F.update({ on: false, craft: null, view: far }), true);
    expect(feed.status).toBe("off");
    expect(feed.asks.air).toBe(2);
  });

  test("the reports left far behind dropped (a sweep across a continent keeps no thousand aircraft); the one followed kept", async () => {
    const { feed } = relay();
    const p = (id: string, lat: number, lon: number): Plane =>
      ({
        id,
        cs: id,
        reg: "",
        type: "A320",
        cat: "A3",
        lat,
        lon,
        alt: 3000,
        gs: 200,
        trk: 0,
        hdg: null,
        vs: 0,
        roll: null,
        gnd: false,
        t: 1000,
        src: "adsb.lol",
      }) as Plane;
    const ship = (mmsi: number, lat: number, lon: number): Ship =>
      ({ mmsi, name: "", type: 70, len: 100, beam: 20, dest: "", lat, lon, sog: 5, cog: 0, hdg: 0, t: 1000 }) as Ship;
    for (const [id, la] of [
      ["near", SFO.lat + 0.5],
      ["far", SFO.lat + 3],
      ["lead", SFO.lat + 3.1],
    ] as const)
      feed.planes.set(id, { p: p(id, la, SFO.lon), prev: null, hist: [], heard: 1000 });
    feed.ships.set(1, { s: ship(1, SFO.lat + 0.2, SFO.lon), hist: [], heard: 1000 });
    feed.ships.set(2, { s: ship(2, SFO.lat + 2, SFO.lon), hist: [], heard: 1000 });
    feed.focus = "lead";
    feed.tick(1001, { lat: SFO.lat, lon: SFO.lon, airR: 120, seaR: 60 }, true);
    expect([...feed.planes.keys()].sort()).toEqual(["lead", "near"]);
    expect([...feed.ships.keys()]).toEqual([1]);
    expect(FEED.beyond * 120).toBeLessThan(3 * 111);
  });
});

describe("no craft at all: the free camera over the bay", () => {
  test("its place over the WGS84 Earth; the aircraft and the ships about it placed, labelled, drawn from it — no NaN", () => {
    const { c } = overPlace("earth", SFO.lat, SFO.lon, 0.6, true);
    c.setPilot(false);
    expect(c.piloting).toBe(false);
    const g = c.geoNow()!;
    expect(Math.abs(g.lat - SFO.lat)).toBeLessThan(0.01);
    expect(Math.abs(g.lon - SFO.lon)).toBeLessThan(0.01);
    // (the focus about the camera — as main.ts asks it)
    const F = new TrafficFocus();
    const f = F.update({ on: true, craft: c.piloting ? c.geoNow() : null, view: c.viewController().geoNow() })!;
    expect(f.who).toBe("view");
    c.trafficAt = { ...F.here!, airR: f.airR };
    // (an A320 6 km north of the camera at 1 200 m, a container ship 4 km east — their reports' clock the test's)
    const now = 1_800_000_000;
    c.trafficClock = () => now;
    c.s.trafficDelay = 0;
    const plane: Plane = {
      id: "a1b2c3",
      cs: "UAL123",
      reg: "N123UA",
      type: "A320",
      cat: "A3",
      lat: SFO.lat + 6000 / 111_195,
      lon: SFO.lon,
      alt: 1200,
      gs: 80,
      trk: 280,
      hdg: null,
      vs: -4,
      roll: null,
      gnd: false,
      t: now - 2,
      src: "adsb.lol",
    };
    const ship: Ship = {
      mmsi: 366000001,
      name: "BAY STAR",
      type: 71,
      len: 200,
      beam: 32,
      dest: "OAKLAND",
      lat: SFO.lat,
      lon: SFO.lon + 4000 / (111_195 * Math.cos(SFO.lat * D)),
      sog: 6,
      cog: 0,
      hdg: 0,
      t: now - 3,
    } as Ship;
    const T = new TrafficFeed(
      () => "",
      async () => new Response("{}"),
      () => false,
    );
    T.planes.set(plane.id, { p: plane, prev: null, hist: [plane], heard: now });
    T.ships.set(ship.mmsi, { s: ship, hist: [ship], heard: now });
    c.traffic = T;
    const air = c.trafficNow();
    expect(air.length).toBe(1);
    const ga = cartToGeodetic(WGS84_A, WGS84_F, air[0]!.p as [number, number, number]);
    expect(ga.h).toBeCloseTo(1200 - 4 * 2, -1);
    const sea = c.seaNow().filter((x) => x.mmsi === ship.mmsi);
    expect(sea.length).toBe(1);
    // (drawn from the camera's own place — no craft's eye —, on its axes: within their ranges, every figure finite)
    const vc = c.viewController();
    const meshes = [...c.trafficShips(vc), ...c.seaShips(vc)];
    expect(meshes.length).toBeGreaterThanOrEqual(2);
    for (const m of meshes) for (const v of [m.rel, ...m.axes]) for (const x of v) expect(Number.isFinite(x)).toBe(true);
    const d = meshes.map((m) => Math.hypot(...m.rel)).sort((a, b) => a - b);
    console.log(`  free camera, no craft: meshes at ${d.map((x) => `${(x / 1000).toFixed(1)} km`).join(", ")}`);
    expect(d[0]!).toBeGreaterThan(3000);
    expect(d.at(-1)!).toBeLessThan(8000);
    const marks = [...c.trafficOverlay((m) => `${m.toFixed(0)} m`, vc), ...c.seaOverlay((v) => `${v.toFixed(1)} m/s`, vc)];
    console.log(`  labels: ${marks.map((m) => m.label).join(" | ")}`);
    expect(marks.some((m) => m.label.startsWith("UAL123 · N123UA · A320"))).toBe(true);
    expect(marks.some((m) => m.label.startsWith("BAY STAR"))).toBe(true);
    for (const m of marks) for (const x of m.at) expect(Number.isFinite(x)).toBe(true);
    // (the traffic's clock stepped by the frame's own when no flight runs it)
    c.trafficClock = undefined;
    c.trafficT = undefined;
    c.trafficStepped = false;
    c.trafficStep(1 / 30);
    expect(c.trafficStepped).toBe(true);
    expect(Math.abs(c.trafficT! - Date.now() / 1000)).toBeLessThan(2);
  });

  test("no traffic, no Earth: empty lists, never a throw", () => {
    const { c } = overPlace("earth", SFO.lat, SFO.lon, 0.6, true);
    c.setPilot(false);
    c.traffic = null;
    expect(c.trafficNow()).toEqual([]);
    expect(c.trafficShips()).toEqual([]);
    expect(c.trafficOverlay((m) => String(m))).toEqual([]);
    expect(Array.isArray(c.seaNow())).toBe(true);
  });
});
