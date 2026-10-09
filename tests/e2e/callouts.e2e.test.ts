import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-TARS T2–T3: the landing's callouts and mission control on a real flight — the entry autopilot's glide onto Edwards, flown at
// fixed steps with the loop's frames between (the callouts are read there): the radio heights going down and
// minimums, in order, never "sink rate" nor "pull up" (a dive's: tests/callouts.test.ts); the tower's clearance
// on the final, Houston's "wheels stop" once stopped.

describe.skipIf(!E2E)("the landing's callouts", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
    await app.js(`(__bh.settings.voice = false, true)`);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the autopilot's landing at Edwards: 300 … 10 and minimums, in order — no sink rate, no pull up", async () => {
    // (stepped in chunks with frames between: the callouts are read on the loop's frames)
    await app.js(
      `(__bh.freeze(true), __bh.settings.wind = 0, __bh.game.glideTo("Edwards", 30, 5, 220), window.__n0 = __bh.voice.asked.length, true)`,
    );
    for (let k = 0; k < 800; k++) {
      const done = await app.js<boolean>(
        `(() => { const c = __bh.camera; for (let i = 0; i < 5; i++) { __bh.step(1 / 30); if (c.ourLanded || c.airFlight.failure) return true; } return false; })()`,
      );
      if (done) break;
      await app.js(`new Promise((r) => requestAnimationFrame(() => r(true)))`);
    }
    // (a few frames on the ground: the report out, then the wheels' stop said)
    for (let k = 0; k < 20; k++) await app.js(`new Promise((r) => requestAnimationFrame(() => r(true)))`);
    const radio = await app.js<[string, string][]>(
      `__bh.voice.asked.slice(window.__n0).filter((l) => l.speaker === "mission" || l.speaker === "tower").map((l) => [l.id, l.speaker])`,
    );
    expect(radio).toEqual([
      ["cleared", "tower"],
      ["wheels", "mission"],
    ]);
    const r = await app.js<{ ids: string[]; landed: boolean }>(
      `(__bh.freeze(false), { ids: __bh.voice.asked.slice(window.__n0).filter((l) => l.speaker === "callout").map((l) => l.id), landed: !!__bh.camera.ourLanded })`,
    );
    expect(r.landed).toBe(true);
    expect(r.ids).toEqual(["h-300", "h-100", "minimums", "h-50", "h-40", "h-30", "h-20", "h-10"]);
  }, 300_000);
});
