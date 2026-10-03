import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The game controller in the menus, with a pad of the page's own (navigator.getGamepads replaced: a
// standard-mapping pad whose buttons the test presses): the D-pad walks the title screen, A chooses,
// B goes back; in the game, Start opens the pause menu and B resumes.

const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  window.__pad = { id: "e2e pad (STANDARD GAMEPAD)", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [window.__pad];
  return 1;
})()`;

describe.skipIf(!E2E)("the game controller in the menus", () => {
  let app: App;
  /** a button pressed for a few frames, then released */
  const press = async (n: number) => {
    await app.js(`(window.__pad.buttons[${n}].pressed = true, 1)`);
    await Bun.sleep(120);
    await app.js(`(window.__pad.buttons[${n}].pressed = false, 1)`);
    await Bun.sleep(120);
  };
  const focused = () => app.js<string>("document.activeElement?.dataset.testid ?? ''");
  beforeAll(async () => {
    app = await App.boot();
    await app.js(FAKE_PAD);
    await app.waitFor(`!!document.querySelector("[data-testid=title]")`, 10_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the D-pad walks the title screen, A chooses, B goes back", async () => {
    expect(await focused()).toBe("title-missions");
    await press(13); // ▼
    expect(await focused()).toBe("title-explore");
    await press(12); // ▲
    expect(await focused()).toBe("title-missions");
    await press(0); // A
    await app.waitFor(`!!document.querySelector("[data-testid=missions]")`);
    await press(1); // B
    await app.waitFor(`!!document.querySelector("[data-testid=title]")`);
  });

  test("A launches a mission; in it, Start pauses and B resumes", async () => {
    await press(0); // A: Missions
    await app.waitFor(`!!document.querySelector("[data-testid=missions]")`);
    await press(0); // A: the mission focused, launched
    await app.waitFor("__bh.camera.piloting", 30_000);
    await press(9); // Start
    await app.waitFor(`!!document.querySelector("[data-testid=pause]")`);
    await press(1); // B
    await app.waitFor(`!document.querySelector("[data-testid=pause]")`);
    expect(app.cdp.errors).toEqual([]);
  });
});
