import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The sea under a flying jet (S2's fix): its waves fixed to the Earth, not carried along under the craft — the camera's
// place on the waves' axes (trace.wgsl Params.sea[2]: its rest from an anchor of whole kilometres, the anchor) moves
// as far as the jet flies along them. It once stayed within metres: those axes were the camera's own tangent plane.
// (E2E_SHOTS=<dir>: two views half a second apart.)

describe.skipIf(!E2E)("the sea under a flying jet", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("its waves stay where they are as the jet flies east over them", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 2, earthClouds: 0 });
      __bh.game.flyAt(42.9, 5.6, 300, 90, 200); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(4000);
    await app.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 300; c.jetModes.spd = 200; return 1; })()`,
    );
    await app.waitFor(`!!__bh.renderer.variants.get(__bh.renderer.featureKey)?.rt`, 120_000);
    await Bun.sleep(5000);
    // (the camera along the waves' first axis [m] — its rest and its anchor —, where the jet is)
    const probe = () =>
      app.js<{
        u: number;
        tuE: number;
        lat: number;
        lon: number;
      }>(`(() => { const f = __bh.renderer.paramsF, b = 416, g = __bh.camera.geoNow();
        return { u: f[b + 8] + 256 * f[b + 10], tuE: f[b + 1], lat: g.lat, lon: g.lon }; })()`);
    const a = await probe();
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.shot(`${shots}/sea-0.png`);
    }
    await Bun.sleep(1500);
    const b = await probe();
    if (shots) await app.shot(`${shots}/sea-1.png`);
    const flown = (b.lon - a.lon) * 111_195 * Math.cos((a.lat * Math.PI) / 180);
    const moved = b.u - a.u;
    console.log(
      `  the jet flew ${flown.toFixed(0)} m east; its place on the waves moved ${moved.toFixed(0)} m (the axis ${(a.tuE * 100).toFixed(0)} % east)`,
    );
    expect(Math.abs(moved)).toBeGreaterThan(0.5 * Math.abs(flown * a.tuE));
  }, 300_000);
});
