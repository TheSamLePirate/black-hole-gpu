import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

const OUT = "remote-results/tars-pcd";

// The F-35's panoramic display through TARS (audit 2026-11-10, TA-17): his tool `pcd` — its pages read, the targeting
// camera (EOTS) shown in the second portal, the right side made one large portal — by the display's own actions
// (f35/pcd.ts show, full), in the cockpit of an F-35 over the Atlantic (tiles off).
// Done when: the display's own pages and halves are what the tool asked, the cockpit shot.
// Duration: ~40 s.

describe.skipIf(!E2E)("the panoramic display through TARS", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => {
      __bh.settings.voice = false; __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane";
      __bh.settings.shipMount = "cockpit";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.flyAt(38.5, -14, 3000, 90, 200);
      __bh.refresh(); __bh.camera.viewReset();
      return true;
    })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const tool = (a: Record<string, unknown>) =>
    app.js<unknown>(
      `Promise.resolve(__bh.tars.tools().find((t) => t.name === "pcd").run(${JSON.stringify(a)}, new AbortController().signal)).then((r) => r, (e) => ({ error: String(e.message ?? e) }))`,
    );

  test("a page shown, a side made one — the display's own", async () => {
    const before = (await tool({ action: "status" })) as { portals: string[] };
    await tool({ action: "show", portal: 2, page: "EOTS" });
    await tool({ action: "full", side: "right", on: true });
    await Bun.sleep(800);
    const pcd = await app.js<{ pages: string[]; halves: string[] }>(
      `({ pages: [...__bh.pcd.pcd.pages], halves: [...__bh.pcd.pcd.halves] })`,
    );
    await app.snap(`${OUT}/cockpit.png`);
    console.log(`  before ${JSON.stringify(before)}\n  after ${JSON.stringify(pcd)}`);
    expect(pcd.pages[1]).toBe("EOTS");
    expect(pcd.halves).toEqual(["split", "full"]);
  }, 60_000);
});
