import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The carrier's recoveries by their case (docs/PLAN-AVIATION-AAA.md, P4): first the Alps as ever; then the F-35C 7 km
// astern of the Ford on its course, Case I — the initial, up the ship's starboard side, the break past the bow, the
// downwind abeam to port, the 180, the groove, the ball — trapped. (Cases II and III flown headless:
// tests/trap.test.ts.) (E2E_SHOTS=<dir>: the views.)

const SEA = { lat: 42.75, lon: 6.1 };

describe.skipIf(!E2E)("the carrier's Case I", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const around = async (yaw: number, pitch: number, dist: number) => {
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(300);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: ${pitch}, dist: ${dist} }); return 1; })()`);
    await Bun.sleep(900);
  };
  const leg = (l: string, ms: number) => app.waitFor(`__bh.camera.trapRun?.leg === "${l}"`, ms);
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0, f35Variant: "C" });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("Case I: the initial, the break, the downwind, the 180, the groove — trapped", async () => {
    await app.js(`(() => { __bh.camera.carrierClear(); __bh.game.flyAt(${SEA.lat}, ${SEA.lon}, 300, 0, 150); return 1; })()`);
    await Bun.sleep(800);
    await app.js(`__bh.camera.carrierSpawn("ford", { lat: ${SEA.lat + 0.05}, lon: ${SEA.lon}, heading: 0 })`);
    await app.waitFor(`!!__bh.camera.carrierNow().length`, 10_000);
    // (7 km astern of it on its course, at the initial's height and speed)
    await app.js(`(() => { const { P, sp } = __bh.camera.carrierNow()[0]; const D = Math.PI / 180, h = sp.heading;
      const lat = P.lat - (7000 * Math.cos(h)) / 111195, lon = P.lon - (7000 * Math.sin(h)) / (111195 * Math.cos(P.lat * D));
      __bh.game.flyAt(lat, lon, 245, h / D, 180); __bh.fleet.fuel.f35 = 3000; __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(500);
    const said = await app.js<string>(`__bh.camera.trapLand("ford", { case: "I" })`);
    console.log(`  ${said}`);
    expect(said).toMatch(/Case I/);
    await leg("upwind", 30_000);
    await leg("break", 60_000);
    await Bun.sleep(4000);
    await around(150, 10, 60);
    await shot("break");
    await leg("downwind", 40_000);
    await Bun.sleep(6000);
    await around(250, 12, 90);
    await shot("downwind");
    await leg("groove", 90_000);
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await app.waitFor(`__bh.camera.trapRun?.ball === true`, 40_000);
    await Bun.sleep(1500);
    await shot("ball");
    await app.waitFor(
      `!!__bh.camera.trapWire || __bh.camera.trapRun?.phase === "bolter" || __bh.camera.trapRun?.phase === "waveoff"`,
      60_000,
    );
    await around(220, 8, 50);
    await Bun.sleep(1500);
    await shot("trapped");
    const L = await app.js<{ wire: number; grade: string } | null>(
      `__bh.camera.trapLast ?? (__bh.camera.trapWire ? { wire: __bh.camera.trapWire.wire, grade: "?" } : null)`,
    );
    console.log(`  Case I: the ${L?.wire}-wire, ${L?.grade}`);
    expect(L?.wire ?? 0).toBeGreaterThan(0);
  }, 300_000);
});
