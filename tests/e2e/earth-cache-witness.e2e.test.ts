import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-T, T0 — before the e2e's Earth data are served from disk: can the harness see every tile request, the dedicated workers'
// too? Chrome's Fetch domain on the page's own session pauses the page's requests; the scenery's worker (scenery-worker.js: the BD
// TOPO's tiles, OpenFreeMap's, WorldCover's ranges), the building cells' (cell-worker.js), the surface's and the KTX transcoder's fetch
// from their own targets — attached here (Target.setAutoAttach, flatten), Fetch enabled on each. Every request paused is let go at once
// (Fetch.continueRequest: no change of behaviour), counted by where it came from (the page, or which worker) and by host; the Network
// domain on each session counts the bytes and the time on the wire. The positive witness: the scenery worker's BD TOPO requests seen.
// Toulon (the F-35 frozen over the town at rest: a full scene) and six building cells asked (__bh.sys.cells). Then the cache itself
// (lib/earth-cache.ts) on a fresh folder, two boots: the scenery worker's BD TOPO tiles fetched and kept at the first, all from the
// disk at the second — the same buildings (Sam: the buildings are what the disk is for).
// Earth data: network
// Done when: the requests seen by source and host, the scenery worker's BD TOPO tiles among them, the bytes and the network's time said;
// at the second boot every BD TOPO tile of the scenery worker from the disk, none fetched, the same buildings.
// Duration: ~5 min (three boots at Toulon — the IGN's tiles twice from the network, one heavy load at a time).

const HOSTS = [
  "*data.geopf.fr*",
  "*s3.amazonaws.com/elevation-tiles*",
  "*tiles.openfreemap.org*",
  "*esa-worldcover*",
  "*tiles.maps.eox.at*",
  "*gibs.earthdata.nasa.gov*",
  "*overturemaps*",
];

describe.skipIf(!E2E)("PLAN-J8 J8-T T0: the tile requests the harness can see — the page's and the workers'", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0 }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("Toulon's scene and six cells: every tile request seen and let go, by source and host; the wire's bytes and time", async () => {
    await app.scenario("Toulon · requests intercepted and let go");
    const sessions = new Map<string, string>(); // sessionId → worker's script
    const seen = new Map<string, number>(); // "source host" → count
    const wire = new Map<string, { bytes: number; ms: number; n: number }>(); // source → bytes, time
    const started = new Map<string, number>(); // requestId → start [s]
    const host = (u: string) => {
      try {
        return new URL(u).hostname;
      } catch {
        return "?";
      }
    };
    const src = (sid?: string) => (sid ? (sessions.get(sid) ?? `worker ${sid.slice(0, 6)}`) : "page");
    const offA = app.cdp.on("Target.attachedToTarget", (p) => {
      const t = p.targetInfo as { type: string; url: string };
      const sid = String(p.sessionId);
      sessions.set(sid, t.url.split("/").pop() ?? t.type);
      void (async () => {
        await app.cdp.sendTo(sid, "Network.enable").catch(() => {});
        await app.cdp
          .sendTo(sid, "Fetch.enable", { patterns: HOSTS.map((urlPattern) => ({ urlPattern, requestStage: "Request" })) })
          .catch(() => {});
        await app.cdp.sendTo(sid, "Runtime.runIfWaitingForDebugger").catch(() => {});
      })();
    });
    const offP = app.cdp.on("Fetch.requestPaused", (p, sid) => {
      const r = p.request as { url: string };
      const k = `${src(sid)} ${host(r.url)}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      const go = { requestId: p.requestId };
      void (sid ? app.cdp.sendTo(sid, "Fetch.continueRequest", go) : app.cdp.send("Fetch.continueRequest", go)).catch(() => {});
    });
    const offS = app.cdp.on("Network.requestWillBeSent", (p, sid) => {
      const r = p.request as { url: string };
      if (HOSTS.some((h) => r.url.includes(h.replaceAll("*", "")))) started.set(`${sid ?? ""}:${p.requestId}`, Number(p.timestamp));
    });
    const offF = app.cdp.on("Network.loadingFinished", (p, sid) => {
      const k = `${sid ?? ""}:${p.requestId}`;
      const t0 = started.get(k);
      if (t0 === undefined) return;
      started.delete(k);
      const w = wire.get(src(sid)) ?? { bytes: 0, ms: 0, n: 0 };
      w.bytes += Number(p.encodedDataLength) || 0;
      w.ms += (Number(p.timestamp) - t0) * 1000;
      w.n++;
      wire.set(src(sid), w);
    });
    await app.cdp.send("Network.enable");
    await app.cdp.send("Fetch.enable", { patterns: HOSTS.map((urlPattern) => ({ urlPattern, requestStage: "Request" })) });
    await app.cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    // (the scene: frozen at rest over Toulon — a full one; and six cells the building workers prepare)
    await app.js(
      `(() => { __bh.freeze(true); __bh.game.flyAt(43.124, 5.93, 500, 0, 0); __bh.settings.shipMount = "cockpit"; return 1; })()`,
    );
    await app.js(`(() => { const n = 2 ** 15, D = Math.PI / 180, x0 = Math.floor(((5.93 + 180) / 360) * n), y0 = Math.floor(((1 - Math.asinh(Math.tan(43.124 * D)) / Math.PI) / 2) * n);
      __bh.sys.cells.want([0, 1, 2].flatMap((i) => [0, 1].map((j) => ({ x: x0 + i, y: y0 + j, priority: 0, d: i + j })))); return 1; })()`);
    await app.waitFor(
      `(() => { const s = __bh.renderer.earthScenery?.stats?.(); return !!s && s.status === "ready" && !s.quick && Math.abs((s.lat ?? 0) - 43.124) < 0.03 && __bh.sys.cells.got().length >= 6; })()`,
      240_000,
    );
    offA();
    offP();
    offS();
    offF();
    const by = [...seen].sort((a, b) => b[1] - a[1]);
    console.log(`  sessions: ${[...new Set(sessions.values())].join(", ")}`);
    console.log(`  paused and let go, by source and host:\n${by.map(([k, n]) => `    ${k}: ${n}`).join("\n")}`);
    console.log(
      `  on the wire: ${[...wire].map(([s, w]) => `${s} ${w.n} requests, ${(w.bytes / 2 ** 20).toFixed(1)} MiB, ${(w.ms / 1000).toFixed(1)} s summed`).join(" · ")}`,
    );
    const st = await app.js<Record<string, unknown>>(
      `(() => { const s = __bh.renderer.earthScenery.stats(); return { buildings: s.buildings, workerMs: s.workerMs, tileNetworkBytes: s.tileNetworkBytes }; })()`,
    );
    console.log(`  the scene: ${JSON.stringify(st)}`);
    // (the positive witness: the scenery worker's own BD TOPO tiles seen)
    expect(by.some(([k]) => k.startsWith("scenery-worker") && k.includes("data.geopf.fr"))).toBe(true);
    expect(by.some(([k]) => k.startsWith("cell-worker") && k.includes("data.geopf.fr"))).toBe(true);
  }, 300_000);

  test("the cache on a fresh folder: the scenery worker's BD TOPO tiles fetched and kept at the first boot, all from the disk at the second", async () => {
    // (Sam, 16 Nov 2026: the buildings are what the disk is for — the scenery worker's own BD TOPO tiles, the decisive witness)
    app.close();
    app = undefined as unknown as App;
    const dir = `${tmpdir()}/kerr-earth-witness-${process.pid}`;
    rmSync(dir, { recursive: true, force: true });
    process.env.KERR_EARTH_DATA = dir;
    const one = async (label: string) => {
      const a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true, earthData: "on" });
      await a.scenario(`Toulon · ${label}`);
      await a.js(
        `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0 }); return 1; })()`,
      );
      await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
      await a.js(
        `(() => { __bh.freeze(true); __bh.game.flyAt(43.124, 5.93, 500, 0, 0); __bh.settings.shipMount = "cockpit"; return 1; })()`,
      );
      await a.waitFor(
        `(() => { const s = __bh.renderer.earthScenery?.stats?.(); return !!s && s.status === "ready" && !s.quick && Math.abs((s.lat ?? 0) - 43.124) < 0.07; })()`,
        240_000,
      );
      const st = await a.js<{ buildings: number; bdtopo: number }>(
        `(() => { const s = __bh.renderer.earthScenery.stats(); return { buildings: s.buildings, bdtopo: s.bdtopoBuildings ?? s.ignBuildings ?? -1 }; })()`,
      );
      const L = a.earth!.counts.log;
      const bd = L.filter((r) => r.src.startsWith("scenery-worker") && r.url.includes("/tms/1.0.0/BDTOPO/"));
      const r = {
        label,
        buildings: st.buildings,
        hits: a.earth!.counts.hits,
        misses: a.earth!.counts.misses,
        bdtopo: { requests: bd.length, fromDisk: bd.filter((x) => x.hit).length, fetched: bd.filter((x) => !x.hit).length },
        bySource: a.earth!.counts.bySource,
      };
      console.log(`  ${label}: ${JSON.stringify(r)}`);
      a.close();
      return r;
    };
    const cold = await one("first boot, the folder empty");
    const warm = await one("second boot, the same folder");
    rmSync(dir, { recursive: true, force: true });
    delete process.env.KERR_EARTH_DATA;
    // (the first boot fetched the scenery worker's BD TOPO tiles and kept them; the second asked them again and got them all from disk)
    expect(cold.bdtopo.fetched).toBeGreaterThan(0);
    expect(warm.bdtopo.requests).toBeGreaterThan(0);
    expect(warm.bdtopo.fetched).toBe(0);
    expect(warm.bdtopo.fromDisk).toBe(warm.bdtopo.requests);
    // (the same scene: the same buildings — the disk changes nothing but the wait)
    expect(warm.buildings).toBe(cold.buildings);
  }, 900_000);
});
