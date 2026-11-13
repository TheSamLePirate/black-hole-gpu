import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The frame's two descriptions in the game (audit 2026-11-10, AR-07; wave 4.3 — src/game/view-pose.ts): the view's pose and the
// flight's accepted state, made once a frame, frozen, read through __bh.viewPose() / __bh.simState() — the renderer to move onto
// the pose (the render session's lot). In orbit (Artemis), tiles off. Their cost on the main thread read from the CPU profiler.
// Done when: each frame its own pose (its number rising), the pose the view's settings and the scene's time, the state's craft the one
// flown, both frozen; held named when the game is paused. Duration: ~40 s.

describe.skipIf(!E2E)("the frame's view pose and flight state", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting && __bh.gpu.frames().completedFrames > 30", 120_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("made once a frame, the view's and the flight's, frozen", async () => {
    const a = await app.js<{
      frame: number;
      yaw: number;
      vYaw: number;
      time: number;
      t: number;
      frozen: boolean;
      craft: string | null;
      held: string | null;
      gen: number;
      fgen: number;
    }>(`(() => {
      const p = __bh.viewPose(), s = __bh.simState(), v = __bh.camera.viewSettings();
      return { frame: p.frame, yaw: p.yaw, vYaw: v.yaw, time: p.time, t: __bh.time(), frozen: Object.isFrozen(p) && Object.isFrozen(s),
        craft: s.craft?.id ?? null, held: s.held, gen: s.gen, fgen: __bh.camera.flightGen }; })()`);
    await Bun.sleep(500);
    const b = await app.js<number>("__bh.viewPose().frame");
    const cost = await app.js<{ ms: number; worst: number } | null>(
      `(() => { const c = __bh.game.perf({ gpu: false }).cpu.find((x) => x.section.startsWith("frame state")); return c ? { ms: c.ms, worst: c.worst } : null; })()`,
    );
    console.log(
      `  pose frame ${a.frame} → ${b}; yaw ${a.yaw} (view ${a.vYaw}); time ${a.time} (scene ${a.t}); craft ${a.craft}; held ${a.held}; gen ${a.gen}/${a.fgen}; frozen ${a.frozen}; cost ${cost ? `${cost.ms.toFixed(3)} ms (worst ${cost.worst.toFixed(2)})` : "—"}`,
    );
    expect(b).toBeGreaterThan(a.frame);
    expect(a.yaw).toBe(a.vYaw);
    expect(Math.abs(a.time - a.t)).toBeLessThan(0.01);
    expect(a.frozen).toBe(true);
    expect(a.craft).not.toBeNull();
    expect(a.held).toBeNull();
    expect(a.gen).toBe(a.fgen);
    // (paused: the state says what holds the flight)
    await app.press("Escape");
    await app.waitFor(`__bh.simState().held === "paused"`, 5000);
    await app.press("Escape");
    await app.waitFor(`__bh.simState().held === null`, 5000);
  }, 60_000);
});
