import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-TARS T4: the score in the game — on Miller its piece and its tick (the film's 1.25 s), heard on the
// music bus; the music switched off: silence; in orbit round the Earth, nothing (silence by default).

describe.skipIf(!E2E)("the score at the great moments", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=Miller: Gargantua over the sea" });
    await app.waitFor("__bh.camera.piloting", 60_000);
    // (the sound starts with a key: the browser's rule)
    await app.press("KeyH", "h");
    await app.waitFor("__sound.ctx?.state === 'running'", 10_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("on Miller: its piece, the tick every 1.25 s, heard", async () => {
    await app.waitFor(`__bh.music.moment === "miller"`, 10_000);
    const t0 = await app.js<number>(`__bh.music.ticks`);
    await Bun.sleep(5000);
    const n = (await app.js<number>(`__bh.music.ticks`)) - t0;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(5);
    expect(await app.js<number>(`__sound.busLevels().music`)).toBeGreaterThan(-50);
  }, 30_000);

  test("the music off: silence", async () => {
    await app.js(`(__bh.settings.music = false, true)`);
    await app.waitFor(`__bh.music.moment === null`, 5_000);
    await Bun.sleep(9000);
    // (its fade-out: 8 s)
    expect(await app.js<number>(`__sound.busLevels().music`)).toBeLessThan(-60);
    await app.js(`(__bh.settings.music = true, true)`);
  }, 30_000);
});
