import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A part of the frame that fails does not freeze the image (audit 2026-11-10, AR-03; strategy §19.5; wave 4.8 — the frame cut in
// guarded stages, src/game/frame.ts): an exception thrown at every frame by the flight's step — injected: `sim.step` made to
// throw —, then the frames the renderer finishes over 2 s, what the player is told, and the flight back once the step works again.
// Before 13 Nov 2026 the step ran unguarded before the render: the same exception every frame, no image drawn after it.
// Done when: frames still drawn while the step throws, the failure said once, the flight's time running again after. Duration: ~1 min.

describe.skipIf(!E2E)("a stage of the frame that throws", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting && __bh.gpu.frames().completedFrames > 30", 120_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the flight's step throwing every frame: the image goes on, said once; the flight back once it works again", async () => {
    const log0 = await app.js<number>(`__bh.game.log.events.length`);
    await app.js(
      `(() => { const s = __bh.sim; window.__step = s.step; s.step = () => { throw new Error("injected: the flight's step"); }; return 1; })()`,
    );
    await Bun.sleep(300);
    const f0 = await app.js<number>("__bh.gpu.frames().completedFrames");
    await Bun.sleep(2000);
    const drawn = (await app.js<number>("__bh.gpu.frames().completedFrames")) - f0;
    const said = await app.js<string[]>(`__bh.game.log.events.slice(${log0}).map((e) => e.text)`);
    console.log(`  the step throwing: ${drawn} frames drawn in 2 s; said ${JSON.stringify(said)}`);
    // (the step works again: the flight's time runs after the stage's retry)
    await app.js(`(__bh.sim.step = window.__step, 1)`);
    const t0 = await app.js<number>("__bh.time()");
    const back = await app
      .waitFor(`__bh.time() > ${t0}`, 8000)
      .then(() => true)
      .catch(() => false);
    console.log(`  the step restored: the flight's time running again — ${back}`);
    expect(drawn).toBeGreaterThan(20);
    // (said once to the player — a toast —, the journal's error line beside it)
    expect(said.filter((s) => /failed|échoué/.test(s)).length).toBe(1);
    expect(back).toBe(true);
  }, 60_000);
});
