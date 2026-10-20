import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The game controller in the menus, with a pad of the page's own (navigator.getGamepads replaced: a
// standard-mapping pad whose buttons the test presses): the D-pad walks the title screen's cards, A opens a
// mode and launches, B goes back; in the game, Start opens the pause menu and B resumes.

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
    // (held 250 ms: the pad is read once a frame — a slower machine's stalled frame missed a 120 ms press)
    await app.js(`(window.__pad.buttons[${n}].pressed = true, 1)`);
    await Bun.sleep(250);
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

  test("the D-pad walks the title's cards, A opens a mode, B goes back", async () => {
    await app.waitFor(`document.activeElement?.dataset.testid === "title-mode-foot"`, 10_000);
    await press(15); // ▶
    expect(await focused()).toBe("title-mode-plane");
    await press(14); // ◀
    expect(await focused()).toBe("title-mode-foot");
    await press(0); // A
    await app.waitFor(`!!document.querySelector("[data-screen='mode:foot']")`);
    // (the screens' change — a View Transition, the screen's pictures loading — over: a button held 120 ms in a
    // stalled frame is not seen by the pad's poll)
    await Bun.sleep(600);
    await press(1); // B
    await app.waitFor(`!!document.querySelector("[data-screen='title']")`);
    await app.waitFor(`document.activeElement?.dataset.testid === "title-mode-foot"`, 3000);
  });

  test("A launches (by ship, low orbit); in it, Start pauses and B resumes", async () => {
    await press(15); // ▶ by plane
    await press(15); // ▶ by ship
    expect(await focused()).toBe("title-mode-ship");
    await press(0); // A: the mode's screen
    await app.waitFor(`!!document.querySelector("[data-screen='mode:ship']")`);
    await Bun.sleep(600);
    expect(await focused()).toBe("title-ship-dest-earth-orbit");
    await press(0); // A: launched
    await app.waitFor("__bh.camera.piloting", 30_000);
    await press(9); // Start
    await app.waitFor(`!!document.querySelector("[data-testid=pause]")`);
    await press(1); // B
    await app.waitFor(`!document.querySelector("[data-testid=pause]")`);
    if (app.cdp.errors.length) console.log(app.cdp.errors.join("\n"));
    expect(app.cdp.errors).toEqual([]);
  });
});
