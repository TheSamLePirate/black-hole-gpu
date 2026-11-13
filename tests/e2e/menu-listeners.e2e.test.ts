import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The listeners a menu leaves behind (audit 2026-11-10, AR-18: « 418 listeners added, 24 removed — a leak supposed, to
// confirm by a memory profile after 50 openings »). The pause and its settings opened and closed 50 times by real keys
// and clicks; the page's live event listeners, DOM nodes and JS heap (CDP Performance.getMetrics, after a garbage
// collection) read before and after. The probe's witnesses (method rule 3): idle for as long (A/A: nothing grows), and a
// leak injected — one window listener added at each of 20 openings — seen.
// Done when: the three measured and said, 50 openings leaving at most 5 listeners and 50 nodes.
// Duration: ~2 min.

describe.skipIf(!E2E)("the listeners a menu leaves behind", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.cdp.send("Performance.enable", {});
    await app.cdp.send("HeapProfiler.enable", {});
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const metrics = async () => {
    await app.cdp.send("HeapProfiler.collectGarbage", {});
    await Bun.sleep(300);
    await app.cdp.send("HeapProfiler.collectGarbage", {});
    const r = await app.cdp.send<{ metrics: { name: string; value: number }[] }>("Performance.getMetrics", {});
    const m = (n: string) => r.metrics.find((x) => x.name === n)?.value ?? Number.NaN;
    return { listeners: m("JSEventListeners"), nodes: m("Nodes"), heapMb: +(m("JSHeapUsedSize") / 1e6).toFixed(1) };
  };
  /** the pause opened, its settings opened, both closed — by keys and clicks */
  const cycle = async (leak = false) => {
    await app.press("Escape");
    await app.waitFor(`!!document.querySelector("[data-testid=pause-group-settings]")`, 5000);
    await app.click("[data-testid=pause-group-settings]");
    await app.click("[data-testid=pause-settings]");
    await app.waitFor(`!!document.querySelector("[data-testid=settings]")`, 5000);
    if (leak) await app.js(`(addEventListener("resize", () => {}), true)`);
    await app.press("Escape");
    await app.waitFor(`!document.querySelector("[data-testid=settings]") && !!document.querySelector("[data-testid=pause-resume]")`, 5000);
    await app.press("Escape");
    await app.waitFor(`!document.querySelector("[data-testid=pause]")`, 5000);
  };

  test("50 openings of the pause and its settings: what stays", async () => {
    // (one cycle first: what a first opening builds once — kept by design — not counted)
    await cycle();
    const m0 = await metrics();
    // A/A: idle as long as ten cycles take
    await Bun.sleep(8000);
    const mIdle = await metrics();
    for (let i = 0; i < 50; i++) await cycle();
    const m50 = await metrics();
    // the positive witness: 20 openings each leaving one window listener
    for (let i = 0; i < 20; i++) await cycle(true);
    const mLeak = await metrics();
    console.log(
      `  start ${JSON.stringify(m0)}\n  idle (A/A) ${JSON.stringify(mIdle)}\n  after 50 openings ${JSON.stringify(m50)}\n  after 20 more, a leak injected ${JSON.stringify(mLeak)}`,
    );
    // the witnesses: idle nothing grows (±5 listeners: the game's own come and go); the injected 20 seen
    expect(Math.abs(mIdle.listeners - m0.listeners)).toBeLessThanOrEqual(5);
    expect(mLeak.listeners - m50.listeners).toBeGreaterThanOrEqual(18);
    // the measure: what 50 openings leave
    console.log(
      `  50 openings left ${m50.listeners - m0.listeners} listeners, ${m50.nodes - m0.nodes} nodes, ${(m50.heapMb - m0.heapMb).toFixed(1)} MB`,
    );
    // (measured 13 Nov 2026: −1 listener, 0 node, +2.2 MB — the idle drift +1 MB —: no leak; kept as a guard)
    expect(m50.listeners - m0.listeners).toBeLessThanOrEqual(5);
    expect(m50.nodes - m0.nodes).toBeLessThanOrEqual(50);
  }, 400_000);
});
