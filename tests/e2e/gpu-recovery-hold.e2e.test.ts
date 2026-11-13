import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The flight held while the GPU device is made again (audit 2026-11-10, AR-02; strategy §19.8; wave 4.2): from the loss
// to the new renderer's first image the flight's time does not run — no landing, no crash, no burn without an image —, then
// it goes on where it was. Before 13 Nov 2026 the flight's step ran all through the recovery (`recovering` not read by the
// loop, and let go before the new renderer had drawn). The loss simulated (__bh.gpu.lose()), the page sampled every 25 ms.
// Done when: the scene's time unchanged across the recovery's window, running again after it. Duration: ~1 min.

interface Sample {
  w: number;
  t: number;
  gen: number;
  drawn: boolean;
}

describe.skipIf(!E2E)("the GPU device lost: the flight held until the new renderer draws", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.gpu.frames().completedFrames > 30", 60_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("no flight time from the loss to the new renderer's first image; running again after", async () => {
    const gen0 = await app.js<number>("__bh.gpu.generation()");
    await app.js(`(() => {
      window.__rec = [];
      const s = () => window.__rec.push({ w: performance.now(), t: __bh.time(), gen: __bh.gpu.generation(), drawn: __bh.gpu.frames().firstFrameDoneAt > 0 && !__bh.gpu.lost() });
      window.__recT = setInterval(s, 25); s();
      return true; })()`);
    await Bun.sleep(300);
    await app.js("(__bh.gpu.lose(), true)");
    await app.waitFor(`__bh.gpu.generation() === ${gen0 + 1} && __bh.gpu.frames().completedFrames > 10`, 90_000);
    await Bun.sleep(800);
    const rec = await app.js<Sample[]>(`(clearInterval(window.__recT), window.__rec)`);
    // (the window: from the first sample after the loss to the first of the new generation drawn)
    const lostAt = rec.findIndex((r, i) => i > 0 && r.w >= rec[0]!.w + 300);
    const back = rec.findIndex((r) => r.gen === gen0 + 1 && r.drawn);
    const a = rec[lostAt]!,
      b = rec[back]!;
    const before = rec.slice(0, lostAt);
    const rateBefore = (before.at(-1)!.t - before[0]!.t) / ((before.at(-1)!.w - before[0]!.w) / 1000);
    const after = rec.slice(back);
    const rateAfter = (after.at(-1)!.t - after[0]!.t) / ((after.at(-1)!.w - after[0]!.w) / 1000);
    console.log(
      `  recovery window ${((b.w - a.w) / 1000).toFixed(2)} s: scene time ${a.t.toFixed(4)} → ${b.t.toFixed(4)} (Δ ${(b.t - a.t).toFixed(4)} M); the rate before ${rateBefore.toFixed(4)} M/s, after ${rateAfter.toFixed(4)} M/s`,
    );
    await app.shot("remote-results/gpu-recovery-hold.png");
    expect(back).toBeGreaterThan(lostAt);
    // (held: what ran across the window is at most a frame or two at the rate before)
    expect(b.t - a.t).toBeLessThan(rateBefore * 0.1 + 1e-9);
    // (and going on after)
    expect(rateAfter).toBeGreaterThan(rateBefore * 0.5);
    expect(app.cdp.errors.filter((e) => !/device|lost|destroyed/i.test(String(e)))).toEqual([]);
  }, 180_000);
});
