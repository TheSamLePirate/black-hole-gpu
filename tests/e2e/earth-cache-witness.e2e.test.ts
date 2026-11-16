import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-T, T0 — before the e2e's Earth data are served from disk (lib/earth-cache.ts): does the harness see every tile request,
// the dedicated workers' too — the scenery's (scenery-worker.js: the BD TOPO's buildings, OpenFreeMap's, WorldCover's ranges) and the
// building cells' (cell-worker.js)? Which worker asked a URL is read from that worker's own session (attached at its birth,
// Target.setAutoAttach flatten: its Network events), whichever session Chrome paused it on (16 Nov 2026, the first run: every request
// paused on the page's — the workers' too). Toulon, the F-35 frozen 500 m over the town at rest (a full scene) and six building cells
// asked (__bh.sys.cells). Two boots on a fresh folder: the first fetches and keeps; the second is **offline** — a tile not on the disk
// fails its request (no network at all for the tiles) — and must make the same scene (Sam: the buildings are what the disk is for).
// Earth data: network (it sets its own mode and folder per boot)
// Done when: at the first boot the scenery worker's BD TOPO tiles fetched and kept; at the second, offline, every one of them asked
// again and served from the disk, no BD TOPO tile missing, the same buildings; the cell worker's tiles too (the rest missing said by host).
// Duration: ~4 min (two boots at Toulon — the IGN's tiles once from the network, one heavy load at a time).

describe.skipIf(!E2E)("PLAN-J8 J8-T T0: the scenery worker's BD TOPO tiles from the disk", () => {
  afterAll(() => {
    stopServer();
  });

  test("a fresh folder: the scenery worker's BD TOPO tiles fetched and kept at the first boot, all from the disk at the second (offline)", async () => {
    const dir = `${tmpdir()}/kerr-earth-witness-${process.pid}`;
    rmSync(dir, { recursive: true, force: true });
    process.env.KERR_EARTH_DATA = dir;
    const one = async (label: string, mode: "on" | "offline") => {
      const a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true, earthData: mode });
      try {
        await a.scenario(`Toulon · ${label}`);
        await a.js(
          `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0 }); return 1; })()`,
        );
        await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
        await a.js(
          `(() => { __bh.freeze(true); __bh.game.flyAt(43.124, 5.93, 500, 0, 0); __bh.settings.shipMount = "cockpit"; return 1; })()`,
        );
        await a.js(`(() => { const n = 2 ** 15, D = Math.PI / 180, x0 = Math.floor(((5.93 + 180) / 360) * n), y0 = Math.floor(((1 - Math.asinh(Math.tan(43.124 * D)) / Math.PI) / 2) * n);
          __bh.sys.cells.want([0, 1, 2].flatMap((i) => [0, 1].map((j) => ({ x: x0 + i, y: y0 + j, priority: 0, d: i + j })))); return 1; })()`);
        await a.waitFor(
          `(() => { const s = __bh.renderer.earthScenery?.stats?.(); return !!s && s.status === "ready" && !s.quick && Math.abs((s.lat ?? 0) - 43.124) < 0.07; })()`,
          240_000,
        );
        const cells = await a.waitOptional(`__bh.sys.cells.got().length >= 6 && __bh.sys.cells.got().length`, 60_000);
        await a.shot(`remote-results/earth-witness/${mode}.png`);
        const st = await a.js<{ buildings: number; bdtopo: number }>(
          `(() => { const s = __bh.renderer.earthScenery.stats(); return { buildings: s.buildings, bdtopo: s.bdtopoBuildings ?? s.ignBuildings ?? -1 }; })()`,
        );
        const at = a.earth!.attribute();
        const c = a.earth!.counts;
        const of = (w: string) => {
          const L = c.log.filter((r) => r.src.startsWith(w) && r.url.includes("/tms/1.0.0/BDTOPO/"));
          return { requests: L.length, fromDisk: L.filter((x) => x.hit).length, fetched: L.filter((x) => !x.hit).length };
        };
        const r = {
          label,
          buildings: st.buildings,
          bdtopoBuildings: st.bdtopo,
          cells,
          hits: c.hits,
          misses: c.misses,
          missing: c.missing.length,
          missingBdtopo: c.missing.filter((u) => u.includes("/tms/1.0.0/BDTOPO/")).length,
          failed: c.failed,
          scenery: of("scenery-worker"),
          cell: of("cell-worker"),
          bdtopoAnySource: c.log.filter((x) => x.url.includes("/tms/1.0.0/BDTOPO/")).length,
          bySource: c.bySource,
          ...at,
        };
        console.log(`  ${label}: ${JSON.stringify(r)}`);
        // (what a boot served from the disk asks that the first did not: said by host — the disk holds only what was asked once)
        const missingBy: Record<string, number> = {};
        for (const u of c.missing) {
          const k = `${new URL(u).hostname}${u.includes("/BDTOPO/") ? " BDTOPO" : ""}`;
          missingBy[k] = (missingBy[k] ?? 0) + 1;
        }
        if (c.missing.length) console.log(`  missing by host: ${JSON.stringify(missingBy)}`);
        c.missing.length = 0; // (said here; the close's offline throw would hide the counts)
        return r;
      } finally {
        a.close();
      }
    };
    const cold = await one("first boot, the folder empty", "on");
    const warm = await one("second boot, the same folder, offline", "offline");
    rmSync(dir, { recursive: true, force: true });
    delete process.env.KERR_EARTH_DATA;
    // (the scenery worker's own BD TOPO tiles: fetched and kept at the first boot; asked again and all from the disk, offline, at the second)
    expect(cold.scenery.fetched).toBeGreaterThan(0);
    expect(warm.scenery.requests).toBeGreaterThan(0);
    expect(warm.scenery.fetched).toBe(0);
    expect(warm.scenery.fromDisk).toBe(warm.scenery.requests);
    // (offline, no BD TOPO tile missing — the others the second boot asks beyond the first's (16 Nov 2026: 108, the globe's coarse
    // GIBS/Terrarium/EOX levels and IGN WMS heights the slow first boot never reached) are said, not failed: the disk holds what was asked)
    expect(warm.missingBdtopo).toBe(0);
    // (the cells' worker too: its own requests, told apart by their request ids)
    expect(cold.cell.requests).toBeGreaterThan(0);
    expect(warm.cell.requests).toBeGreaterThan(0);
    expect(warm.cell.fetched).toBe(0);
    // (the same scene: the disk changes nothing but the wait)
    expect(warm.buildings).toBe(cold.buildings);
  }, 900_000);
});
