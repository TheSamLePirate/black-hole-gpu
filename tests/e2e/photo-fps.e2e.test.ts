import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The photo mode left by its own button (no Escape on a tablet), its bar hidden and brought back; the frame
// rate shown when asked (Settings › Render).

describe.skipIf(!E2E)("photo mode, frame rate", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=Earth: the Blue Marble" });
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("photo mode: its bar hidden and brought back, then left by Back to the game", async () => {
    // (the ship off: the toolbar shown — flying, the wheel and the pause menu open it the same way)
    await app.js(`(__bh.settings.ship = false, __bh.touch(), true)`);
    await app.waitFor(`!document.body.classList.contains("piloting")`, 5_000);
    await app.click("#btn-photo");
    await app.waitFor(`document.body.classList.contains("photo")`, 3_000);
    await app.press("KeyH", "h");
    await app.click("[data-testid=photo-peek]");
    expect(await app.js<boolean>(`document.querySelector("[data-testid=photo]").classList.contains("ph-hidden")`)).toBe(false);
    await app.click("[data-testid=photo-back]");
    expect(await app.js<boolean>(`document.body.classList.contains("photo") || !!document.querySelector("[data-testid=photo]")`)).toBe(
      false,
    );
  }, 30_000);

  test("the frame rate: hidden, then shown when asked", async () => {
    expect(await app.js<boolean>(`document.querySelector("[data-testid=fps-meter]").hidden`)).toBe(true);
    await app.js(`(__bh.settings.showFps = true, true)`);
    await app.waitFor(`/\\d+ fps · [\\d.]+ ms/.test(document.querySelector("[data-testid=fps-meter]").textContent)`, 3_000);
    await app.js(`(__bh.settings.showFps = false, true)`);
  }, 30_000);
});
