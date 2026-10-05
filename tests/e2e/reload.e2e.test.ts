import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A reload must produce a completed GPU image without errors. Timings are observations:
// a fresh browser profile does not control the driver's cache, and HTTP/SW caches also change.
describe.skipIf(!E2E)("reload: completed GPU image and startup timings", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("cold and warm loads both complete without GPU or console errors", async () => {
    const cold = app.lastLoadMs;
    await app.load("scene=game:artemis");
    const warm = app.lastLoadMs;
    console.log(`  load: cold ${Math.round(cold)} ms, reload ${Math.round(warm)} ms (Δ ${Math.round(cold - warm)} ms)`);
    expect(await app.js<number>("__bh.renderer.firstFrameDoneAt")).toBeGreaterThan(0);
    expect(await app.js<number>("__bh.renderer.completedFrames")).toBeGreaterThan(0);
    expect(await app.js<number>("__bh.renderer.gpuErrors")).toBe(0);
    expect(await app.js<string | null>("__bh.renderer.lost")).toBeNull();
    expect(app.cdp.errors).toEqual([]);
  });
});
