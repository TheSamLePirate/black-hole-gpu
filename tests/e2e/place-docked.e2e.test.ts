import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A craft docked to the station, placed elsewhere (the Place panel, TARS's place_ship): it lets go of its
// links and goes — before, it stayed where the station carried it (found by TARS's live eval, A6).

describe.skipIf(!E2E)("placing a docked craft", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1000, height: 700, hash: "scene=Earth: docking to the ISS" });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("docked, then placed near Jupiter: there, undocked", async () => {
    await app.js(`(__bh.game.target("iss"), __bh.camera.pilot.setAuto("dock"), true)`);
    await app.waitFor(`__bh.camera.docked`, 300_000);
    await app.js(`(__bh.game.near("jupiter", { altKm: 50000 }), true)`);
    await Bun.sleep(1500);
    expect(await app.js<boolean>(`__bh.camera.docked`)).toBe(false);
    expect(await app.js<string>(`__bh.game.status().soi`)).toBe("jupiter");
  }, 400_000);
});
