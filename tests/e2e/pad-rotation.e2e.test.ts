import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The pad's Y (« rotation ») on the ground. A craft flown and set down: Y takes the pilot out of it, on foot. A scene's
// tripod on the ground with no craft keeps a rest too (camera.ourLanded): there Y turns the view, as anywhere — it
// once tried the craft's way out (« Fly a landed vessel first. ») and the view never changed while unmoved.
// A pad of the page's own, as in pad.e2e.test.ts.

const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  window.__pad = { id: "e2e pad (STANDARD GAMEPAD)", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [window.__pad];
  return 1;
})()`;

describe.skipIf(!E2E)("the pad's Y on the ground", () => {
  let app: App;
  /** a button pressed for a few frames, then released */
  const press = async (n: number) => {
    await app.js(`(window.__pad.buttons[${n}].pressed = true, 1)`);
    await Bun.sleep(250);
    await app.js(`(window.__pad.buttons[${n}].pressed = false, 1)`);
    await Bun.sleep(120);
  };
  beforeAll(async () => {
    app = await App.boot({ hash: `scene=${encodeURIComponent("Earth: the Blue Marble")}`, width: 960, height: 540, tiles: false });
    await app.js(FAKE_PAD);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("a landscape's tripod, no craft: Y turns the view, nobody gets out", async () => {
    await app.js(`(() => {
      const P = __bh.presets;
      P["e2e pad tripod"] = { ...P["Earth: the Blue Marble"], ship: false, animate: false, pose: { body: "earth", at: [36.06, -112.14], look: "sun" } };
      __bh.preset("e2e pad tripod");
      __bh.touch();
      return 1;
    })()`);
    await app.waitFor(`!!__bh.camera.ourLanded && __bh.settings.rotation === "tripod"`, 10_000);
    expect(await app.js<boolean>("__bh.camera.piloting")).toBe(false);
    await Bun.sleep(500);
    // (unmoved: the scene's rest still held)
    expect(await app.js<boolean>("!!__bh.camera.ourLanded")).toBe(true);
    await press(3); // Y
    await app.waitFor(`__bh.camera.gravity || __bh.settings.rotation !== "tripod"`, 3000);
    expect(await app.js<boolean>("__bh.camera.character.active")).toBe(false);
  });

  test("a craft flown and set down (seen from outside): Y takes the pilot out, on foot", async () => {
    await app.js(`(() => {
      __bh.preset("Earth: the Blue Marble");
      __bh.settings.ship = true;
      __bh.refresh();
      __bh.game.land("moon", 0.674, 23.473);
      // (the outside free view: the pad's own layout, not the spacecraft's — input/spacepad.ts)
      __bh.settings.shipMount = "free";
      __bh.touch();
      return 1;
    })()`);
    await app.waitFor(`__bh.camera.piloting && !!__bh.camera.ourLanded`, 10_000);
    await Bun.sleep(1000);
    expect(await app.js<boolean>("__bh.camera.character.active")).toBe(false);
    await press(3); // Y
    await app.waitFor("__bh.camera.character.active", 5000);
    if (app.cdp.errors.length) console.log(app.cdp.errors.join("\n"));
    expect(app.cdp.errors).toEqual([]);
  });
});
