import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-TARS T5b: TARS asked by real input — F6 opens his field, a question typed, Enter: his answer from the
// flight's state, subtitled; "honesty 70" sets his setting; typing does not fly the craft; Escape closes.

describe.skipIf(!E2E)("TARS asked", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.js(`(__bh.settings.voice = false, __bh.settings.subtitles = true, __bh.settings.tarsHonesty = 90, true)`);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const sub = () => app.js<string>(`document.querySelector("[data-testid=subtitles] span").textContent`);

  test("F6, a question, Enter: his answer from the flight; his honesty set aloud; the flight untouched by typing", async () => {
    await app.press("F6", "F6");
    expect(await app.js<boolean>(`!document.querySelector("[data-testid=tars-panel]").hidden`)).toBe(true);
    expect(await app.js<boolean>(`document.activeElement === document.querySelector("[data-testid=tars-input]")`)).toBe(true);
    const thr0 = await app.js<number>(`__bh.camera.pilot.throttle`);
    await app.type("Where are we?");
    await app.press("Enter");
    await app.waitFor(`document.querySelector("[data-testid=subtitles]").dataset.speaker === "tars"`, 5_000);
    expect(await sub()).toMatch(/kilometres above Earth|kilomètres au-dessus de/);
    // (typed "w", "z", "x"…: no throttle, no flight key)
    await app.type("zzz wsx");
    expect(await app.js<number>(`__bh.camera.pilot.throttle`)).toBe(thr0);
    await app.js(`(document.querySelector("[data-testid=tars-input]").value = "", true)`);
    await app.type("honesty 70");
    await app.press("Enter");
    await app.waitFor(`__bh.settings.tarsHonesty === 70`, 5_000);
    await app.press("Escape");
    expect(await app.js<boolean>(`document.querySelector("[data-testid=tars-panel]").hidden`)).toBe(true);
    await app.js(`(__bh.settings.tarsHonesty = 90, __bh.voice.stop(), true)`);
  }, 60_000);
});
