import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The PWA (PLAN-MONDE M1) by a real browser: the Service Worker registered (asked for by `sw=1`: the tests'
// network blocking does not reach a worker), the shell cached as the page loads, the manifest served;
// then the network cut — the page reloads from its cache, the scene playable offline; the Earth's tiles
// kept under their budget. After a single visit, offline, none of the game's own files (hashed maps, meshes, WASM, workers) may fail.
// Duration: ~2 min on kerr-mini
// Done when: the page reloaded offline plays and none of its own files failed

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
    // (the files the workers fetched warmed too — src/pwa/seen.ts: on the first visit the KTX2 transcoder starts before the worker
    // holds the page; 13 Nov 2026 the Earth's, Moon's and Mars's maps were lost, offline the large maps fell back to JPEGs never loaded)
    await app.waitFor(
      `(async () => { for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) if (/\\/earth-[0-9a-z]{8}\\.ktx2$/.test(r.url)) return true; return false; })()`,
      30_000,
    );
  }, 180_000);

  test("offline: the page reloads from its cache and the scene plays", async () => {
    // (the page and its Service Worker cut — lib/cdp.ts offline: the page's alone left the worker's fetches on the network)
    // (what the page asks and does not get, offline: the game's own files — hashed textures, meshes, WASM — must all come from
    // the cache after a single visit; 10 Nov 2026 the bodies' maps and the KTX2 transcoder failed, the world black)
    const asked = new Map<string, string>();
    const lost = new Map<string, number>();
    // (the page's own origin and path — localhost here, the site with E2E_URL: the deployed build checked the same way)
    const base = await app.js<string>(`new URL("./", location.href).href`);
    app.cdp.on("Network.requestWillBeSent", (p) => asked.set(String(p.requestId), String((p.request as { url: string }).url)));
    app.cdp.on("Network.loadingFailed", (p) => {
      const u = asked.get(String(p.requestId)) ?? "?";
      if (!u.startsWith(base)) return;
      const k = `/${u.slice(base.length).replace(/\?.*$/, "")}`;
      lost.set(k, (lost.get(k) ?? 0) + 1);
    });
    await app.offline(true);
    try {
      await app.load("scene=Earth: the Blue Marble");
      await app.offline(true);
      await app.waitFor("__bh.camera.piloting", 90_000);
      expect(await app.js<boolean>("!!navigator.serviceWorker.controller")).toBe(true);
      const t0 = await app.js<number>("__bh.sim.time");
      await Bun.sleep(1500);
      expect(await app.js<number>("__bh.sim.time")).toBeGreaterThan(t0);
      await Bun.sleep(5000);
      const own = [...lost].filter(([k]) => /-[0-9a-z]{8}\.\w+$|\.wasm$|worker[^/]*\.js$/.test(k));
      console.log(
        `  the page's own requests that failed offline (${lost.size} paths): ${[...lost].map(([k, n]) => `${n} × ${k}`).join(" · ") || "none"}`,
      );
      expect(own).toEqual([]);
    } finally {
      await app.offline(false);
    }
  }, 180_000);
});
