import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The GPU device lost (PLAN-MONDE M2, the audit's §3.2 no 4): the flight saved, the renderer made again on a
// new device, the flight going on where it was — no reload. Twice in a minute recovered; a third loss
// within the minute gives up: the image frozen, the reload offered. The loss is simulated
// (__bh.gpu.lose(): the device destroyed, told as a reset). Before: any loss stopped the game for a reload.

interface Seen {
  generation: number;
  lost: string | null;
  frames: number;
  failed: boolean;
  altKm: number;
  time: number;
}

describe.skipIf(!E2E)("the GPU device lost", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
  });
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const seen = () =>
    app.js<Seen>(`(() => ({ generation: __bh.gpu.generation(), lost: __bh.gpu.lost(), frames: __bh.gpu.frames().completedFrames, failed: document.body.classList.contains("gpu-lost"),
      altKm: __bh.game.status().altKm, time: __bh.time() }))()`);
  const loseAndRecover = async () => {
    const before = await seen();
    expect(before.lost).toBeNull();
    await app.js("(__bh.gpu.lose(), true)");
    // (a new renderer behind the same handle — its generation the next —: no loss on it, its own frames drawn)
    await app.waitFor(
      `__bh.gpu.generation() === ${before.generation + 1} && __bh.gpu.lost() === null && __bh.gpu.frames().completedFrames > 30`,
      90_000,
    );
    const after = await seen();
    expect(after.failed).toBe(false);
    // (the same flight: the same height about the Earth, the scene's time gone on from where it was)
    expect(Math.abs(after.altKm - before.altKm)).toBeLessThan(50);
    expect(after.time).toBeGreaterThanOrEqual(before.time);
    return after;
  };

  test("lost: made again on a new device, the flight going on — and again", async () => {
    await app.waitFor("__bh.gpu.frames().completedFrames > 30", 60_000);
    await loseAndRecover();
    await loseAndRecover();
    // (the journal says so; the diagnostic counts both)
    expect(await app.js<boolean>(`document.body.classList.contains("gpu-recovering")`)).toBe(false);
  }, 240_000);

  test("a third loss within the minute: given up, the reload offered", async () => {
    await app.js("(__bh.gpu.lose(), true)");
    await app.waitFor(`document.body.classList.contains("gpu-lost")`, 30_000);
  }, 60_000);
});
