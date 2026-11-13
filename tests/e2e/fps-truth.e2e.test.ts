import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The frame rate shown tells the truth when the frames stall (audit 2026-11-10, AR-06; strategy §19.3; wave 4.2): the main
// thread blocked 400 ms every half second — a stall the loop's step bounds at 0.1 s —, the rate shown (the top bar's, the
// game's `fps()`) against the frames the page really drew (its animation callbacks over the same wall time). Before
// 13 Nov 2026 the rate was the frames over the bounded steps: a 400 ms gap counted for 100 ms, the rate shown optimistic
// exactly when it stutters.
// And under 10 images/s (wave 4.2's last line): the step bounded at 0.1 s, the flight runs slower than the wall's time —
// before 13 Nov 2026 without a word; now said (a toast, the frame-rate meter's « time NN % »).
// Done when: the rate shown (averaged) within 35 % of the frames the renderer finished; at ~6 images/s the flight's own rate
// measured under 90 % and the slowdown said. Duration: ~50 s.

describe.skipIf(!E2E)("the frame rate shown, under stalls", () => {
  let app: App;
  /** the journal's length at the start: the slowdown is said once a minute — the 400 ms stalls of the first test slow the
   *  flight too, and may say it first */
  let log0 = 0;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.gpu.frames().completedFrames > 30", 60_000);
    log0 = await app.js<number>(`__bh.game.log.events.length`);
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

  test("~6 images/s (the main thread blocked 160 ms a frame): the flight slower than the wall's time — said", async () => {
    // (the scene's time against the wall's over 5 s, each frame stalled 160 ms — beyond the step's 0.1 s bound)
    const r = await app.js<{ rate: number; fps: number }>(`new Promise((done) => {
      const t0 = __bh.time(), w0 = performance.now();
      let on = true;
      const stall = () => { if (!on) return; const t = performance.now(); while (performance.now() - t < 160); requestAnimationFrame(stall); };
      requestAnimationFrame(stall);
      const t1 = __bh.time();
      setTimeout(() => {
        on = false;
        const t2 = __bh.time(), w = (performance.now() - w0) / 1000;
        // (the flight's time per wall second, against its own pace before — the scene's rate at ×1)
        done({ rate: (t2 - t0) / w, fps: __bh.game.ctx.fps() });
      }, 5000);
    })`);
    // (its pace unstalled: the same measure, a second without the stall)
    const free = await app.js<number>(
      `new Promise((done) => { const t0 = __bh.time(), w0 = performance.now(); setTimeout(() => done((__bh.time() - t0) / ((performance.now() - w0) / 1000)), 1500); })`,
    );
    const said = await app.js<string[]>(`__bh.game.log.events.slice(${log0}).map((e) => e.text)`);
    const ratio = r.rate / free;
    console.log(
      `  stalled: ${r.fps.toFixed(1)} images/s; the flight at ${(ratio * 100).toFixed(0)} % of its pace; said: ${JSON.stringify(said)}`,
    );
    expect(ratio).toBeLessThan(0.9);
    expect(said.some((s) => /10 images\/s/.test(s))).toBe(true);
  }, 60_000);
});
