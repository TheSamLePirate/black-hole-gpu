import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The player's own settings (SETTING_KIND "pref": the budget, the display, the sound, the HUD's aids)
// are theirs: kept through a reload, a change of scene and a saved game loaded — which carries none.

describe.skipIf(!E2E)("the player's own settings", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("a save carries none of them, and loading one leaves them", async () => {
    const r = await app.js<{ inSave: boolean; spinInSave: boolean; hudBank: boolean; vol: number }>(`(() => {
      const save = __bh.game.snapshot("test");
      __bh.settings.hudBank = false;
      __bh.settings.soundVolume = 0.3;
      __bh.game.load(save, { quiet: true });
      return { inSave: "hudBank" in save.settings || "pixelRatio" in save.settings, spinInSave: "spin" in save.settings,
        hudBank: __bh.settings.hudBank, vol: __bh.settings.soundVolume };
    })()`);
    expect(r).toEqual({ inSave: false, spinInSave: true, hudBank: false, vol: 0.3 });
  });

  test("a change of scene leaves them", async () => {
    await app.js(`(__bh.preset("Moon: an afternoon on the plains"), 1)`);
    expect(await app.js<boolean>("__bh.settings.hudBank")).toBe(false);
    expect(await app.js<number>("__bh.settings.soundVolume")).toBe(0.3);
  });

  test("a reload brings them back", async () => {
    await app.load("");
    expect(await app.js<boolean>("__bh.settings.hudBank")).toBe(false);
    expect(await app.js<number>("__bh.settings.soundVolume")).toBe(0.3);
    expect(app.cdp.errors).toEqual([]);
  });
});
