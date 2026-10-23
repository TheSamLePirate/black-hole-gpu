import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The IGN's relief switched in flight (settings.earthIgnRelief, src/system/earth-tiles.ts): every terrain tile taken
// again. They once were all dropped at once — the ground under the craft fell back to the global map's, the Chamonix
// valley filled, a jet flying 450 m over its floor hundreds of metres in the ground, flung out by its gear's springs
// at Mach 40: "the hull burnt through at 92650 K". Now the tiles drawn stay the ground until each is in again.
// The F-35 in the valley on its autopilot, the relief switched on, then off: the ground under it sampled every 100 ms.
// (E2E_SHOTS=<dir>: the cockpit view before and after, relief-toggle-before / -on / -off.)
// Duration: ~3 min on kerr-mini.
// Done when: the jet flies on through both switches — not lost, its hull cool, the ground under it never jumping.

describe.skipIf(!E2E)("the IGN's relief switched in flight", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, weather: "fair", earthClouds: 0, dof: false, earthPipeline: "raster", earthOrtho: true, earthIgnRelief: false, earthScenery: false }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const lost = () => app.js<string | null>(`document.querySelector(".craft-lost .cl-why")?.textContent ?? null`);
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/relief-toggle-${name}.png`);
  };
  // (the craft's height over the ground as it flies — the gear's own measure: geodetic, over the relief drawn —, the
  // ground there, its hull's temperature, the ground speed; every 100 ms into window.__rt)
  const record = () =>
    app.js(`(() => {
      clearInterval(window.__rtId);
      window.__rt = [];
      window.__rtId = setInterval(() => {
        const c = __bh.camera, g = c.geoNow();
        if (!g) return;
        const ground = __bh.sys.groundAt(g.lat, g.lon);
        const h = g.alt + __bh.sys.geoid(g.lat, g.lon);
        window.__rt.push({ t: performance.now(), lat: g.lat, lon: g.lon, ground, agl: h - ground, gs: g.gs,
          hull: c.airFlight.skin.hull, fail: c.airFlight.failure, relief: __bh.settings.earthIgnRelief });
      }, 100);
      return 1;
    })()`);
  type Sample = { t: number; ground: number; agl: number; gs: number; hull: number; fail: string | null; relief: boolean };
  const samples = () => app.js<Sample[]>(`window.__rt`);
  // (the ground's largest jump between two samples — 12 m of flight apart —, the lowest height over it, the hottest hull)
  const sum = (s: Sample[]) => {
    let jump = 0;
    for (let i = 1; i < s.length; i++) jump = Math.max(jump, Math.abs(s[i]!.ground - s[i - 1]!.ground));
    return {
      n: s.length,
      jump,
      aglMin: Math.min(...s.map((q) => q.agl)),
      hullMax: Math.max(...s.map((q) => q.hull)),
      gsMin: Math.min(...s.map((q) => q.gs)),
      gsMax: Math.max(...s.map((q) => q.gs)),
      fail: s.find((q) => q.fail)?.fail ?? null,
    };
  };

  test("the F-35 low in the Chamonix valley: the relief switched on, then off — flying on, cool, the ground steady", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:30:00Z"); return 1; })()`);
    await Bun.sleep(1000);
    // (the valley's tiles in first, the scene held: flyAt measures the ground under the place — before them, the global
    // map's, the valley filled, and the jet would fly a kilometre over its floor)
    await app.js(
      `(() => { __bh.game.flyAt(45.912, 6.858, 450, 45, 120); __bh.settings.shipMount = "cockpit"; __bh.freeze(true); return 1; })()`,
    );
    await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 90_000).catch(() => console.log("  (tiles still loading after 90 s)"));
    // (the raster armed again — a small GPU's governor may have given it up while the tiles came —, said beside each figure)
    const pipeline = async () => {
      await app.js(`(() => { __bh.renderer.rasterFellBack = false; return 1; })()`);
      await app.settled();
      return `${await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`)}, view ${await app.js<string>(`__bh.settings.shipMount`)}`;
    };
    const pipe = await pipeline();
    console.log(`  ${pipe}`);
    await shot("before");
    await app.js(`(() => { __bh.freeze(false); __bh.game.flyAt(45.912, 6.858, 450, 45, 120); return 1; })()`);
    await app.waitFor(`!!__bh.camera.jetFigures() && !__bh.camera.rolling`, 10_000);
    await Bun.sleep(1000);
    // (flyAt leaves it by hand: the holds taken as it flies — its altitude, heading and speed)
    console.log(
      `  ${await app.js<string>(`(() => { const c = __bh.camera; return c.jetToggle("ap") + " · " + c.jetToggle("athr"); })()`)}`,
    );
    const modes = await app.js<{ alt: number | null; spd: number | null }>(
      `(() => { const m = __bh.camera.jetModes; return { alt: m.alt, spd: m.spd }; })()`,
    );
    expect(modes.alt).not.toBeNull();
    expect(modes.spd).not.toBeNull();
    // (low in the valley: under the global map's ground there — what the ground fell back to, once, at the switch)
    const low = await app.js<{ agl: number; under: number }>(`(() => {
      const g = __bh.camera.geoNow(), D = Math.PI / 180;
      const q = [Math.cos(g.lat * D) * Math.cos(g.lon * D), Math.cos(g.lat * D) * Math.sin(g.lon * D), Math.sin(g.lat * D)];
      return { agl: g.alt + __bh.sys.geoid(g.lat, g.lon) - __bh.sys.groundAt(g.lat, g.lon), under: __bh.renderer.earthTiles.fallback(q) - g.alt };
    })()`);
    console.log(`  ${low.agl.toFixed(0)} m over the valley's floor, ${low.under.toFixed(0)} m under the global map's ground`);
    expect(low.agl).toBeLessThan(700);
    expect(await lost()).toBeNull();

    for (const on of [true, false]) {
      await app.js(`(() => { __bh.renderer.rasterFellBack = false; return 1; })()`);
      await record();
      await Bun.sleep(2000);
      await app.js(`(() => { __bh.settings.earthIgnRelief = ${on}; return 1; })()`);
      await Bun.sleep(13_000);
      const s = sum(await samples());
      console.log(
        `  relief ${on ? "on" : "off"} (${await app.js<string>(`__bh.renderer.earthPipelineNow(__bh.settings)`)}): ${s.n} samples, the ground's largest jump ${s.jump.toFixed(1)} m, lowest ${s.aglMin.toFixed(0)} m over it, hull ≤ ${s.hullMax.toFixed(0)} K, ground speed ${s.gsMin.toFixed(0)} … ${s.gsMax.toFixed(0)} m/s${s.fail ? ` — ${s.fail}` : ""}`,
      );
      await shot(on ? "on" : "off");
      expect(s.fail).toBeNull();
      expect(await lost()).toBeNull();
      expect(s.n).toBeGreaterThan(50);
      // (a jet at 120 m/s: its skin at the air's temperature, some 290 K — the hull's limit 480 K)
      expect(s.hullMax).toBeLessThan(400);
      expect(s.gsMax).toBeLessThan(250);
      expect(s.gsMin).toBeGreaterThan(90);
      // (the ground under it: a valley's slope over 12 m and the survey's metres against the global data's — once ~1 km)
      expect(s.jump).toBeLessThan(60);
      expect(s.aglMin).toBeGreaterThan(150);
    }
    expect(app.cdp.errors).toEqual([]);
  }, 300_000);
});
