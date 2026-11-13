import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The quick load says why it cannot (audit 2026-11-10, AR-17): F5 then F9 by real keys; then the quick save's stored text
// damaged, F9 again; then none at all, F9. Before 13 Nov 2026 every failure was « No quick save yet — F5 makes one », a
// save there but unreadable included.
// Done when: the loaded one said loaded, the damaged one said unreadable (not « none yet »), the missing one « none yet ».
// Duration: ~30 s.

describe.skipIf(!E2E)("the quick load says why it cannot", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, lang: "en", hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** what the game said after a key */
  const said = async (code: string) => {
    const n0 = await app.js<number>(`__bh.game.log.events.length`);
    await app.press(code);
    await Bun.sleep(600);
    return app.js<string[]>(`__bh.game.log.events.slice(${n0}).map((e) => e.text)`);
  };

  test("loaded, unreadable, none — each said as it is", async () => {
    await said("F5");
    const ok = await said("F9");
    await app.js(`(localStorage.setItem("kerr.save:Quick save", "{ not json"), true)`);
    const damaged = await said("F9");
    await app.js(`(localStorage.removeItem("kerr.save:Quick save"), true)`);
    const none = await said("F9");
    console.log(`  loaded: ${JSON.stringify(ok)}\n  damaged: ${JSON.stringify(damaged)}\n  none: ${JSON.stringify(none)}`);
    expect(ok.join(" ")).toMatch(/Quick load/);
    expect(damaged.join(" ")).not.toMatch(/No quick save yet/);
    expect(damaged.join(" ")).toMatch(/cannot be read/i);
    expect(none.join(" ")).toMatch(/No quick save yet/);
  }, 60_000);
});
