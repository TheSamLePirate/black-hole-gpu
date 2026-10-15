import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The relief on the F-35's radar scope: first the Alps as ever; then toward the Mont Blanc at 3 600 m — the scope,
// heading up, the massif ahead red over our height, amber just under, the valleys green — at 40 km, then 10 km.
// (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the relief on the radar", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
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
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("toward the Mont Blanc: the massif on the scope, red over our height, at 40 then 10 km", async () => {
    await app.js(`(() => { Object.assign(__bh.settings, { f35Radar: true, f35RadarRelief: true, f35RadarRange: "40", shipMount: "chase" });
      __bh.game.flyAt(46.02, 6.62, 2600, 140, 200); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt); c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("athr"); return 1; })()`);
    await Bun.sleep(3000);
    const R = await app.js<{ alt: number; h: number } | null>(
      `(() => { const r = __bh.camera.flightInfo().relief; return r && { alt: r.alt, h: r.at(45.8326, 6.8652) }; })()`,
    );
    console.log(`  at ${R?.alt.toFixed(0)} m; the Mont Blanc's relief read ${R?.h.toFixed(0)} m`);
    expect(R).not.toBeNull();
    expect(R!.h).toBeGreaterThan(3500);
    await shot("relief-40");
    await app.js(`(() => { __bh.settings.f35RadarRange = "10"; return 1; })()`);
    await Bun.sleep(1500);
    await shot("relief-10");
  }, 90_000);
});
