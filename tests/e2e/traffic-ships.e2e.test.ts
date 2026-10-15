import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The ships on the sea (docs/PLAN-AVIATION-AAA.md, T3): over the Channel, four ships as their AIS reports them (put
// in the page's feed — a container ship, a ferry, a trawler, a sailing boat, reporting every 10 s on straight
// courses), drawn a minute behind on their way: their meshes at their AIS size, their wakes on the sea, their
// labels; on the radar as surface contacts; by night their navigation lights. (E2E_SHOTS=<dir>: the views.)

const D = Math.PI / 180;
const SEA = { lat: 50.45, lon: 0.35 };
/** the ships: their place now (m east, north of SEA), course [°], speed [m/s], AIS type, length, beam, name */
const SHIPS = [
  { mmsi: 211000001, name: "NORDIC STAR", type: 71, len: 300, beam: 48, e: 0, n: 2600, cog: 70, sog: 9.5 },
  { mmsi: 227000002, name: "COTE D'OPALE", type: 60, len: 186, beam: 31, e: -900, n: 3600, cog: 250, sog: 11 },
  { mmsi: 227000003, name: "MARIE-JO", type: 30, len: 24, beam: 7, e: 700, n: 1600, cog: 20, sog: 4.5 },
  { mmsi: 235000004, name: "SEA BREEZE", type: 36, len: 12, beam: 3.9, e: 300, n: 1300, cog: 120, sog: 3 },
];

describe.skipIf(!E2E)("ships on the sea", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  /** the ships' reports, every 10 s from 5 min before now to 5 min after (their way known whatever the delay) */
  const inject = () =>
    app.js(`(() => {
      const F = __bh.camera.traffic, now = Date.now() / 1000;
      for (const s of ${JSON.stringify(SHIPS)})
        for (let k = -30; k <= 30; k++) {
          const t = now + 10 * k, d = s.sog * 10 * k, c = s.cog * ${D};
          const n = s.n + d * Math.cos(c), e = s.e + d * Math.sin(c);
          F.mergeShip({ mmsi: s.mmsi, name: s.name, type: s.type, len: s.len, beam: s.beam, dest: "", sog: s.sog, cog: s.cog, hdg: s.cog,
            lat: ${SEA.lat} + n / 111195, lon: ${SEA.lon} + e / (111195 * Math.cos(${SEA.lat * D})), t }, now);
        }
      return F.ships.size;
    })()`);
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(
      `(() => { __bh.game.setDate("2026-06-20T10:30:00Z"); Object.assign(__bh.settings, { vessel: "f35", wind: 0, traffic: true, weather: "fair", earthClouds: 0 }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    // (over the Channel at 350 m, flying north towards them)
    await app.js(`(() => { __bh.game.flyAt(${SEA.lat - 0.004}, ${SEA.lon + 0.002}, 500, 5, 150); return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await app.waitFor("!!__bh.camera.traffic", 30_000);
  }, 200_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("four ships drawn at their AIS size on their way, a minute behind; their labels; surface contacts on the radar", async () => {
    expect(await inject()).toBeGreaterThanOrEqual(4);
    await Bun.sleep(1500);
    const seen = await app.js<{ name: string; mesh: string; len: number; sog: number; where: number }[]>(`(() => {
      const now = Date.now() / 1000;
      return __bh.camera.seaNow().map((c) => ({ name: c.name, mesh: c.mesh, len: c.len, sog: c.sog, where: 0 }));
    })()`);
    console.log(`  ${seen.map((s) => `${s.name} (${s.mesh}, ${s.len} m, ${s.sog.toFixed(1)} m/s)`).join(" · ")}`);
    expect(seen.map((s) => s.mesh).sort()).toEqual(["cargo", "ferry", "sailboat", "trawler"]);
    // (a minute behind: the container ship 60 s × 9.5 m/s back from where its report of now puts it)
    const lag = await app.js<number>(`(() => {
      const c = __bh.camera.seaNow().find((x) => x.mmsi === 211000001);
      const T = Date.now() / 1000;
      const q = __bh.camera.traffic.ships.get(211000001).hist.reduce((a, b) => (Math.abs(b.t - T) < Math.abs(a.t - T) ? b : a));
      // (its report of now on the WGS84 ellipsoid, carried to now)
      const D = Math.PI / 180, A = 6378137, e2 = 0.00669437999014;
      const d = q.sog * (T - q.t), la = (q.lat + (d * Math.cos(q.cog * D)) / 111195) * D, lo = (q.lon + (d * Math.sin(q.cog * D)) / (111195 * Math.cos(q.lat * D))) * D;
      const N = A / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
      const X = [N * Math.cos(la) * Math.cos(lo), N * Math.cos(la) * Math.sin(lo), N * (1 - e2) * Math.sin(la)];
      return Math.hypot(X[0] - c.p[0], X[1] - c.p[1], X[2] - c.p[2]);
    })()`);
    console.log(`  the container ship drawn ${lag.toFixed(0)} m behind its report of now (a minute at 9.5 m/s: 570 m)`);
    expect(Math.abs(lag - 570)).toBeLessThan(60);
    await app.waitFor(`__bh.camera.radar.tracks.has("ais:211000001")`, 20_000);
    const T = await app.js<{ iff: string; kind: string }>(
      `(() => { const t = __bh.camera.radar.tracks.get("ais:211000001"); return { iff: t.iff, kind: t.kind }; })()`,
    );
    expect(T.iff).toBe("neutral");
    const labels = await app.js<string[]>(`__bh.camera.seaOverlay((v) => v.toFixed(1) + " m/s").map((m) => m.label)`);
    console.log(`  labels: ${labels.join(" | ")}`);
    expect(labels.some((l) => l.startsWith("NORDIC STAR · cargo"))).toBe(true);
    const wakes = await app.js<number>(`__bh.renderer.seaWakes.length`);
    expect(wakes).toBe(4);
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(2500);
    await shot("ships-chase");
  }, 120_000);

  test("close by: the container ship and its wake, passed at 120 m", async () => {
    // (beside its drawn place: 300 m off its starboard side, 250 m aft of it, flying its way)
    const at = await app.js<{ lat: number; lon: number }>(`(() => {
      const c = __bh.camera.seaNow().find((x) => x.mmsi === 211000001), p = c.p;
      const A = 6378137, e2 = 0.00669437999014, lon = Math.atan2(p[1], p[0]), r = Math.hypot(p[0], p[1]);
      let lat = Math.atan2(p[2], r * (1 - e2));
      for (let i = 0; i < 5; i++) { const N = A / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); lat = Math.atan2(p[2] + e2 * N * Math.sin(lat), r); }
      return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
    })()`);
    const c = 70 * D;
    const off = (de: number, dn: number) => ({ lat: at.lat + dn / 111195, lon: at.lon + de / (111195 * Math.cos(at.lat * D)) });
    // (aft 250 m, to starboard 300 m: starboard is its course + 90°)
    const p = off(-250 * Math.sin(c) + 300 * Math.sin(c + Math.PI / 2), -250 * Math.cos(c) + 300 * Math.cos(c + Math.PI / 2));
    await app.js(`(() => { __bh.game.flyAt(${p.lat}, ${p.lon}, 120, 70, 110); __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(800);
    await app.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); Object.assign(c.outside, { yaw: -100, pitch: 12, dist: 45 }); return 1; })()`,
    );
    await Bun.sleep(1800);
    await shot("ships-close");
  }, 120_000);

  test("seen from above: the container ship and its Kelvin wake; by night their lights", async () => {
    await app.js(`(() => { __bh.game.flyAt(${SEA.lat - 0.004}, ${SEA.lon + 0.002}, 500, 5, 150); return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(800);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 0, pitch: 38, dist: 160 }); return 1; })()`);
    await Bun.sleep(2500);
    await shot("ships-above");
    // (the clock moved, the Earth turned under the craft — kept where it was in space: put back over the Channel)
    await app.js(
      `(() => { __bh.game.setDate("2026-06-20T22:40:00Z"); __bh.game.flyAt(${SEA.lat - 0.004}, ${SEA.lon + 0.002}, 500, 5, 150); return 1; })()`,
    );
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await Bun.sleep(2000);
    const lit = await app.js<number>(`__bh.camera.seaOverlay((v) => v.toFixed(1)).reduce((n, m) => n + m.lights.length, 0)`);
    console.log(`  by night: ${lit} navigation lights`);
    expect(lit).toBeGreaterThanOrEqual(15);
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(2000);
    await shot("ships-night");
  }, 120_000);
});
