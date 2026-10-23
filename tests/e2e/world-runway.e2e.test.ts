import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A world runway as the game's own (PLAN-RADAR-AAA RD13): over Toulouse-Blagnac (LFBO — not one of the eight sites,
// OurAirports'), its runways brought in near the eye — graded flat to their measured level, the gear's ground and the
// eye's alike, drawn with their markings and lights —; the F-35's ILS on its longest paved one by its code, the approach
// flown by the systems to a stop on its centreline. (E2E_SHOTS=<dir>: the final, the strip from beside.)

describe.skipIf(!E2E)("a world runway, flat, landed on", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; __bh.settings.weather = "fair"; __bh.settings.wind = 0; return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    // (20 km north-west of Blagnac, 1 200 m up, toward it)
    await app.js(`(() => { __bh.game.flyAt(43.76, 1.18, 1200, 143, 140); const c = __bh.camera;
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); __bh.settings.shipMount = "cockpit"; return 1; })()`);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("LFBO's runways brought in, their levels measured; the ground flat down the longest", async () => {
    await app.waitFor(`__bh.sys.runways().some((r) => r.world?.field === "LFBO" && r.len > 3000)`, 60_000);
    // (its level measured again as the finer relief came: 20 s)
    await Bun.sleep(21_000);
    const r = await app.js<{
      elev: number;
      len: number;
      hw: number;
      heights: number[];
      site: { lat: number; lon: number; rwy: number };
    }>(`(() => {
      const r = __bh.sys.runways().filter((r) => r.world?.field === "LFBO").sort((a, b) => b.len - a.len)[0];
      const D = Math.PI / 180, heights = [];
      for (let k = 0; k <= 8; k++) {
        const a = r.len * k / 8, q = r.origin.map((v, i) => v + r.along[i] * a);
        // (its geodetic place: WGS84's — not the geocentric angle)
        const A = 6378137, F = 1 / 298.257223563, B = A * (1 - F), e2 = F * (2 - F), ep2 = (A * A - B * B) / (B * B);
        const pr = Math.hypot(q[0], q[1]), th = Math.atan2(q[2] * A, pr * B);
        const lat = Math.atan2(q[2] + ep2 * B * Math.sin(th) ** 3, pr - e2 * A * Math.cos(th) ** 3) / D, lon = Math.atan2(q[1], q[0]) / D;
        heights.push(__bh.relief("earth", lat, lon));
      }
      return { elev: r.elev, len: r.len, hw: r.halfWidth, heights, site: { lat: r.site.lat, lon: r.site.lon, rwy: r.site.rwy } };
    })()`);
    console.log(`  LFBO ${r.len} m × ${2 * r.hw} m at ${r.elev} m: down its axis ${r.heights.map((h) => h.toFixed(1)).join(" ")}`);
    const spread = Math.max(...r.heights) - Math.min(...r.heights);
    expect(spread).toBeLessThan(0.5);
    expect(Math.abs(r.heights[4]! - r.elev)).toBeLessThan(0.5);
    expect(r.elev).toBeGreaterThan(120);
    expect(r.elev).toBeLessThan(180);
  }, 120_000);

  test("the ILS on LFBO by its code: flown by the systems to a stop on the centreline", async () => {
    // (on the extended centreline of its longest runway, 18 km out — the initial fix —, some 1 000 m over the ground,
    // its heading the runway's: in front of it)
    const st = await app.js<{ lat: number; lon: number; hdg: number }>(`(() => {
      const r = __bh.sys.runways().filter((r) => r.world?.field === "LFBO").sort((a, b) => b.len - a.len)[0];
      const q = r.origin.map((v, i) => v - r.along[i] * 18000);
      const A = 6378137, F = 1 / 298.257223563, B = A * (1 - F), e2 = F * (2 - F), ep2 = (A * A - B * B) / (B * B);
      const pr = Math.hypot(q[0], q[1]), th = Math.atan2(q[2] * A, pr * B), D = Math.PI / 180;
      return { lat: Math.atan2(q[2] + ep2 * B * Math.sin(th) ** 3, pr - e2 * A * Math.cos(th) ** 3) / D, lon: Math.atan2(q[1], q[0]) / D, hdg: r.site.rwy };
    })()`);
    await app.js(`(() => { __bh.game.flyAt(${st.lat}, ${st.lon}, 1000, ${st.hdg}, 130); const c = __bh.camera;
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); return 1; })()`);
    await Bun.sleep(1500);
    const said = await app.js<string>(`__bh.camera.ilsStart("LFBO")`);
    console.log(`  ${said}`);
    expect(said).not.toMatch(/no runway|aucune piste|in the air|en vol/i);
    await app.waitFor(`!!__bh.camera.ilsRun`, 5000);
    // (the HUD's approach cues: the runway in reach — its name, its own length —, as the sites')
    await app.waitFor(`/LFBO/.test(__bh.camera.runwayView()?.name ?? "")`, 30_000);
    const rv = await app.js<{ name: string; len: number }>(
      `(() => { const r = __bh.camera.runwayView(); return { name: r.name, len: r.len }; })()`,
    );
    console.log(`  the HUD's runway: ${rv.name}, ${rv.len} m`);
    expect(rv.len).toBeGreaterThan(3000);
    // (the final from the cockpit, 6 km out)
    await app.waitFor(`(() => { const R = __bh.camera.ilsRun; return !R || (__bh.camera.ilsInfo()?.dme ?? 1e9) < 6; })()`, 400_000);
    const phase = await app.js<{ phase: string; missed: number }>(
      `({ phase: __bh.camera.ilsRun?.phase, missed: __bh.camera.ilsRun?.missed ?? 0 })`,
    );
    console.log(`  6 km out: ${JSON.stringify(phase)}`);
    expect(phase.missed).toBe(0);
    expect(phase.phase).toMatch(/final|flare/);
    await shot("final");
    await app.waitFor(`!__bh.camera.ilsRun || (__bh.camera.rolling && __bh.camera.geoNow().gs < 15)`, 400_000);
    const end = await app.js<{ landed: boolean; gs: number; off: number | null; last: unknown }>(`(() => {
      const c = __bh.camera, g = c.geoNow();
      const r = __bh.sys.runways().filter((r) => r.world?.field === "LFBO").sort((a, b) => b.len - a.len)[0];
      const D = Math.PI / 180;
      // (across the runway's axis [m]: the ellipsoid's surface point from ours against its frame)
      const la = g.lat * D, lo = g.lon * D, e2 = 0.00669437999014, s = Math.sin(la), N = 6378137 / Math.sqrt(1 - e2 * s * s);
      const p = [N * Math.cos(la) * Math.cos(lo), N * Math.cos(la) * Math.sin(lo), N * (1 - e2) * s];
      const d = p.map((v, i) => v - r.origin[i]);
      const off = d[0] * r.across[0] + d[1] * r.across[1] + d[2] * r.across[2];
      return { landed: !!(c.rolling || c.ourLanded || !c.airFlight.inAir), gs: g.gs, off, last: c.ilsLast };
    })()`);
    console.log(`  ${JSON.stringify(end)}`);
    await shot("stopped");
    // (the tactical map at 2 km, north up: the craft at its centre on the runway it stands on)
    await app.js(`(() => { const m = __bh.flight.hud.tacMap; m.range = 0; m.northUp = true; return 1; })()`);
    await Bun.sleep(1500);
    await shot("stopped-map");
    expect(end.landed).toBe(true);
    expect(Math.abs(end.off ?? 99)).toBeLessThan(25);
  }, 900_000);
});
