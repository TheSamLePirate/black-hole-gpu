import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// « Go on without damage » on the craft-lost screen (audit 2026-11-10, FX-20): before 13 Nov 2026 it switched the game's damage
// setting off for good — a carried setting, saves included —, said by a toast only. Sam's choice (13 Nov 2026): for this flight
// only. An F-35 over the sea, lost (the controller's own crash), the button clicked for real; then a new flight.
// Done when: the flight goes on without damage, the damage setting still on; the next flight has its damage again.
// Duration: ~40 s.

describe.skipIf(!E2E)("without damage, for this flight", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.js(`(() => { __bh.settings.vessel = "f35"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(42.9, 6.0, 2000, 90, 200); return 1; })()`);
    await Bun.sleep(1000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("lost, on without damage: the setting kept; the next flight damaged again", async () => {
    await app.js(`(__bh.camera.crashed("test: lost"), 1)`);
    await app.waitFor(`!!document.querySelector("[data-testid=cl-undamaged]")`, 5000);
    await app.snap("remote-results/undamaged/lost.png");
    await app.click("[data-testid=cl-undamaged]");
    await Bun.sleep(300);
    const now = await app.js<{ setting: boolean; live: boolean; failure: string | null; animate: boolean }>(
      `({ setting: __bh.settings.damage, live: __bh.camera.airInfo().damage, failure: __bh.camera.airFlight.failure ?? null, animate: __bh.settings.animate })`,
    );
    // (a second crash in this flight: not lost)
    await app.js(`(__bh.camera.crashed("test: again"), 1)`);
    const again = await app.js<string | null>(`__bh.camera.airFlight.failure ?? null`);
    // (a new flight: the craft placed again)
    await app.js(`(() => { __bh.game.flyAt(42.9, 6.1, 2000, 90, 200); return 1; })()`);
    await Bun.sleep(300);
    const next = await app.js<{ setting: boolean; live: boolean }>(
      `({ setting: __bh.settings.damage, live: __bh.camera.airInfo().damage })`,
    );
    console.log(`  on without damage: ${JSON.stringify(now)}; crashed again: ${again}; the next flight: ${JSON.stringify(next)}`);
    expect(now).toMatchObject({ setting: true, live: false, failure: null, animate: true });
    expect(again).toBeNull();
    expect(next).toEqual({ setting: true, live: true });
  }, 60_000);
});
