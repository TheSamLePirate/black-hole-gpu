import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The assistants' frame (C0) by real input: an autopilot assisted — F4 — works out its commands but
// leaves the ship to the pilot (its director on the HUD), the hub card's button gives it back; an
// alert's line opens its explanation.

describe.skipIf(!E2E)("the flight assistants' frame", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("F4 then hold position: the director shows the burn, the ship left alone; the hub card's button: the autopilot flies", async () => {
    await app.press("F4", "F4");
    expect(await app.js<boolean>("__bh.camera.pilot.assist")).toBe(true);
    const v0 = await app.js<number>("__bh.game.status().speed");
    await app.press("Digit8", "8");
    await app.waitFor(`__bh.camera.pilot.auto === "hover" && !!__bh.camera.pilot.director`);
    await Bun.sleep(1500);
    expect(Math.abs((await app.js<number>("__bh.game.status().speed")) - v0)).toBeLessThan(0.5);
    expect(await app.js<number>("__bh.camera.pilot.throttle")).toBe(0);
    expect(await app.js<string>(`document.querySelector("[data-testid=hub-assist]").textContent`)).toBe("ASSISTED");
    await app.click("[data-testid=hub-assist]");
    expect(await app.js<boolean>("__bh.camera.pilot.assist")).toBe(false);
    // (the autopilot flies: it turns to the burn, then fires — the speed falls)
    await app.waitFor("__bh.camera.pilot.fired.throttle > 0.05", 30_000);
    await app.press("Digit8", "8");
  });

  test("an alert's line opens why it is on and what to do", async () => {
    await app.press("Space", " ");
    await app.waitFor(`!!document.querySelector("[data-alert=paused]")`);
    await app.click("[data-alert=paused]");
    await app.waitFor(`!!document.querySelector(".al-help")`);
    expect((await app.js<string>(`document.querySelector(".al-help").textContent`)).length).toBeGreaterThan(30);
    await app.press("Space", " ");
  });
});
