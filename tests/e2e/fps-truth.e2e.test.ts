import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The frame rate shown tells the truth when the frames stall (audit 2026-11-10, AR-06; strategy §19.3; wave 4.2): the main
// thread blocked 400 ms every half second — a stall the loop's step bounds at 0.1 s —, the rate shown (the top bar's, the
// game's `fps()`) against the frames the page really drew (its animation callbacks over the same wall time). Before
// 13 Nov 2026 the rate was the frames over the bounded steps: a 400 ms gap counted for 100 ms, the rate shown optimistic
// exactly when it stutters.
// Done when: the rate shown (averaged) within 35 % of the frames the renderer finished. Duration: ~40 s.

describe.skipIf(!E2E)("the frame rate shown, under stalls", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.gpu.frames().completedFrames > 30", 60_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("400 ms stalls every 500 ms: the rate shown is the frames drawn, not the bounded steps'", async () => {
    // (the frames the renderer finished over the 4 s, against the rate shown sampled through them — the meter's own window is
    // the last half-second: averaged)
    const r = await app.js<{ shown: number; counted: number }>(`new Promise((done) => {
      const f0 = __bh.gpu.frames().completedFrames, t0 = performance.now(), seen = [];
      const stall = setInterval(() => { const t = performance.now(); while (performance.now() - t < 400); }, 500);
      const look = setInterval(() => seen.push(__bh.game.ctx.fps()), 250);
      setTimeout(() => {
        clearInterval(stall); clearInterval(look);
        const counted = (__bh.gpu.frames().completedFrames - f0) / ((performance.now() - t0) / 1000);
        const tail = seen.slice(4);
        done({ shown: tail.reduce((a, b) => a + b, 0) / tail.length, counted });
      }, 4000);
    })`);
    console.log(`  the rate shown ${r.shown.toFixed(1)} /s; the frames drawn ${r.counted.toFixed(1)} /s`);
    expect(Math.abs(r.shown - r.counted) / r.counted).toBeLessThan(0.35);
  }, 60_000);
});
