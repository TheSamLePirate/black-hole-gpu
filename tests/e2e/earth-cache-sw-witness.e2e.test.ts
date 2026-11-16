import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-6 (b) — Sam's decision of 16 Nov 2026: the e2e's Earth data on disk (lib/earth-cache.ts) serve the Service Worker's own
// fetches too — its target is not the page's child (another DevTools target, attached by its own socket as it appears, Fetch enabled
// there) —, so that an offline zone is downloaded once for every e2e. With the worker registered (`sw: true`) the page's tiles and its
// workers' (the scenery's BD TOPO, the cells') go through it: its fetches are the ones on the wire. The witness, T0's way: a fresh
// folder, two boots at Toulon (the F-35 frozen over the town at rest, a full scene); the first fetches and keeps — the Service
// Worker's requests seen and served —; the second is **offline** (a tile not on the disk fails its request), the worker's requests
// all served from the disk, no BD TOPO tile missing, the same buildings.
// Earth data: network (it sets its own mode and folder per boot)
// Done when: at the first boot requests paused on the Service Worker's own target, fetched and kept; at the second, offline, the
// Service Worker's tile requests served from the disk, no BD TOPO tile missing, the same buildings.
// Duration: ~4 min (two boots at Toulon — the tiles once from the network, one heavy IGN load at a time).

test.skipIf(!E2E)(
  "the Service Worker's fetches from the disk: kept at a first boot, served offline at a second (PLAN-J8 J8-6 b)",
  async () => {
    const dir = `${tmpdir()}/kerr-earth-sw-witness-${process.pid}`;
    rmSync(dir, { recursive: true, force: true });
    process.env.KERR_EARTH_DATA = dir;
    const one = async (label: string, mode: "on" | "offline") => {
      const a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", sw: true, tiles: true, earthData: mode });
      try {
        await a.scenario(`Toulon · ${label}`);
        expect(await a.js<boolean>("__bh.pwa.ready()")).toBe(true);
        // (the far buildings' layer off — J8-4: its ~1 500 cells round Toulon are not this witness's subject, the first boot ends before
        // they are all kept: 8 209 BD TOPO requests missing offline in the run of 16 Nov 2026, 16:06)
        await a.js(
          `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0 }); __bh.renderer.farBuildingsOn = false; return 1; })()`,
        );
        await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
        await a.js(
          `(() => { __bh.freeze(true); __bh.game.flyAt(43.124, 5.93, 500, 0, 0); __bh.settings.shipMount = "cockpit"; return 1; })()`,
        );
        await a.waitFor(
          `(() => { const s = __bh.renderer.earthScenery?.stats?.(); return !!s && s.status === "ready" && !s.quick && Math.abs((s.lat ?? 0) - 43.124) < 0.07; })()`,
          240_000,
        );
        const st = await a.js<{ buildings: number }>(`(() => ({ buildings: __bh.renderer.earthScenery.stats().buildings }))()`);
        const at = a.earth!.attribute();
        const c = a.earth!.counts;
        const sw = c.log.filter((r) => r.src === "service-worker");
        const r = {
          label,
          buildings: st.buildings,
          hits: c.hits,
          misses: c.misses,
          missing: c.missing.length,
          missingBdtopo: c.missing.filter((u) => u.includes("/tms/1.0.0/BDTOPO/")).length,
          serviceWorker: { requests: sw.length, fromDisk: sw.filter((x) => x.hit).length, fetched: sw.filter((x) => !x.hit).length },
          swBdtopo: sw.filter((x) => x.url.includes("/tms/1.0.0/BDTOPO/")).length,
          pausedOn: at.pausedOn,
          workerFetch: at.workerFetch,
        };
        console.log(`  ${label}: ${JSON.stringify(r)}`);
        await a.shot(`remote-results/earth-sw-witness/${mode}.png`);
        c.missing.length = 0; // (said above; the close's offline throw would hide the counts)
        return r;
      } finally {
        a.close();
      }
    };
    try {
      const cold = await one("first boot, the folder empty, the Service Worker on", "on");
      const warm = await one("second boot, offline, the same folder", "offline");
      // (the Service Worker's own target intercepted: its requests paused there, fetched and kept at the first boot)
      expect(cold.workerFetch["service-worker"]).toBe("enabled");
      expect(cold.serviceWorker.fetched).toBeGreaterThan(0);
      expect(cold.swBdtopo).toBeGreaterThan(0);
      // (offline, served from the disk: the worker's requests, none fetched; no BD TOPO tile missing; the same scene)
      expect(warm.serviceWorker.requests).toBeGreaterThan(0);
      expect(warm.serviceWorker.fetched).toBe(0);
      expect(warm.missingBdtopo).toBe(0);
      expect(warm.buildings).toBe(cold.buildings);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.KERR_EARTH_DATA;
      stopServer();
    }
  },
  900_000,
);
