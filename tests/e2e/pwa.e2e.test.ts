import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The PWA (PLAN-MONDE M1) by a real browser: the Service Worker registered (asked for by `sw=1`: the tests'
// network blocking does not reach a worker), the shell cached as the page loads, the manifest served;
// then the network cut — the page reloads from its cache, the scene playable offline; the Earth's tiles
// kept under their budget.

describe.skipIf(!E2E)("the PWA: the app from its cache, offline", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=Earth: the Blue Marble", sw: true, tiles: true });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the worker controls the page, the shell and the tiles are cached, the manifest is served", async () => {
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    expect(await app.js<boolean>("!!navigator.serviceWorker.controller")).toBe(true);
    // (the Earth's tiles stream near the ground: on the pad at the Cape)
    await app.js(`__bh.game.land("earth", 28.573, -80.649)`);
    await app.waitFor("(await __bh.pwa.stats())?.tiles > 5", 120_000);
    const st = await app.js<{ shell: number; tiles: number; tileBytes: number; tileBudget: number }>("__bh.pwa.stats()");
    expect(st.shell).toBeGreaterThan(10);
    expect(st.tileBytes).toBeGreaterThan(0);
    expect(st.tileBytes).toBeLessThan(st.tileBudget);
    // (the shell warmed: the page's own script is in the cache — the first visit loaded it before the
    // worker took over; on the dev server the bundler's chunk, on the build index-<hash>.js)
    await app.waitFor(
      `(async () => { const s = performance.getEntriesByType("resource").map(e => e.name).find(u => /-[a-z0-9]{8}.js$/.test(u) && !/worker/.test(u)); return s && !!(await caches.match(s)); })()`,
      30_000,
    );
    const man = await app.js<{ ok: boolean; name: string }>(
      `fetch("manifest.webmanifest").then(async (r) => ({ ok: r.ok, name: (await r.json()).short_name }))`,
    );
    expect(man).toEqual({ ok: true, name: "Kerr" });
    expect(await app.js<boolean>(`!!document.querySelector('link[rel="manifest"]')`)).toBe(true);
  }, 180_000);

  test("offline: the page reloads from its cache and the scene plays", async () => {
    await app.cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await app.load("scene=Earth: the Blue Marble");
      await app.waitFor("__bh.camera.piloting", 90_000);
      expect(await app.js<boolean>("!!navigator.serviceWorker.controller")).toBe(true);
      const t0 = await app.js<number>("__bh.sim.time");
      await Bun.sleep(1500);
      expect(await app.js<number>("__bh.sim.time")).toBeGreaterThan(t0);
    } finally {
      await app.cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
  }, 180_000);
});
