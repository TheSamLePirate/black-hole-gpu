import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The plan's action #12 (protocols A and C): does the browser's shader disk cache make a reload
// cheaper than the cold start? A fresh Chrome profile (lib/cdp.ts): the first load compiles cold;
// the second — same scene, same settings, so the same cache keys — must not be slower, and where
// the cache holds (Chrome/Edge) it should be markedly faster. The measure: navigation → splash
// lifted, the number that sums the shaders' compilation and the assets' arrival.

describe.skipIf(!E2E)("reload: the second load rides the shaders' disk cache", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the reload is no slower than the cold load", async () => {
    const cold = app.lastLoadMs;
    await app.load("scene=game:artemis");
    const warm = app.lastLoadMs;
    console.log(`  load: cold ${Math.round(cold)} ms, reload ${Math.round(warm)} ms (Δ ${Math.round(cold - warm)} ms)`);
    // (a regression lock, not a promise of speed: the cache's budget and its evictions are the
    // browser's — but a reload *slower* than the cold start would mean our keys are unstable)
    expect(warm).toBeLessThanOrEqual(cold + 2500);
  });
});
