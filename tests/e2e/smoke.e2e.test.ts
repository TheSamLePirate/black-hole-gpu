import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The app played as a player would — real keys and clicks, each click proven to land — in a headless
// Chrome on a production server. Run with: bun run e2e

describe.skipIf(!E2E)("smoke: in flight (Artemis, low Earth orbit)", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("it starts without an error", async () => {
    expect(await app.js<string>("__bh.game.status().label")).toBe("IN ORBIT");
    expect(app.cdp.errors).toEqual([]);
  });

  test("Escape closes the camera panel and leaves the hold engaged; a second one releases it", async () => {
    await app.press("Digit1");
    expect(await app.js<string>("__bh.camera.pilot.hold")).toBe("prograde");
    await app.js(`(document.getElementById("btn-camera").click(), 1)`);
    await app.waitFor(`!document.getElementById("cam-pop").hidden`);
    await app.press("Escape");
    expect(await app.js<boolean>(`document.getElementById("cam-pop").hidden`)).toBe(true);
    expect(await app.js<string>("__bh.camera.pilot.hold")).toBe("prograde");
    await app.press("Escape");
    expect(await app.js<string>("__bh.camera.pilot.hold")).toBe("none");
  });

  test("toasts stack: three messages in a row, none lost", async () => {
    for (let i = 0; i < 3; i++) await app.press("Backquote");
    await Bun.sleep(300);
    const t = await app.js<string[]>(`[...document.querySelectorAll(".sp-toasts .sp-toast")].map((e) => e.textContent)`);
    expect(t.length).toBe(3);
    expect(new Set(t).size).toBe(3);
    await app.press("Backquote"); // (back to the full HUD)
  });

  test("the map: M opens it full screen, Escape closes it", async () => {
    await app.press("KeyM");
    await app.waitFor(`document.body.classList.contains("map-open")`);
    // (the map takes the pointer: the canvas under the screen's centre, no overlay in the way)
    const top = await app.js<string>(
      `(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return e.tagName + "." + e.className; })()`,
    );
    expect(top).toMatch(/CANVAS/);
    await app.press("Escape");
    expect(await app.js<boolean>(`document.body.classList.contains("map-open")`)).toBe(false);
  });

  test("the help: ? opens the sheet, Escape closes it", async () => {
    await app.press("Slash", "?", { shift: true });
    await app.waitFor(`!!document.querySelector(".sp-modal")`);
    await app.press("Escape");
    expect(await app.js<boolean>(`!!document.querySelector(".sp-modal")`)).toBe(false);
  });

  test("the settings: a real click on the opener opens them, Escape closes them", async () => {
    await app.click(".sp-opener");
    await app.waitFor(`!document.getElementById("panel").classList.contains("collapsed")`);
    await app.press("Escape");
    expect(await app.js<boolean>(`document.getElementById("panel").classList.contains("collapsed")`)).toBe(true);
  });

  test("the Kerr Bench measures a scene", async () => {
    const r = await app.js<{ status: string; fixed?: { mraysPerS: number; fps: number } }>(`__bh.bench.scene("game:artemis", true)`);
    expect(r.status).toBe("ok");
    expect(r.fixed!.mraysPerS).toBeGreaterThan(0);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
