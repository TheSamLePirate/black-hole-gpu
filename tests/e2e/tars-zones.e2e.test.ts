import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The offline zones through TARS (audit 2026-11-10, TA-17): his tool `offline_zones` on the installed game (its service
// worker), the Offline tab's own actions — the zones listed, a zone estimated over Chamonix (its size and time, nothing
// downloaded: no IGN tile asked), a zone unknown refused by name (a removal unconfirmed: tests/tars-tools.test.ts).
// Done when: the list read, the estimate a size in MB and a time, the refusal said.
// Duration: ~40 s.

describe.skipIf(!E2E)("the offline zones through TARS", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", sw: true, tiles: false });
    await app.cdp.send("Network.setBlockedURLs", { urls: ["*geopf.fr*", "*ign.fr*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*"] });
    await app.waitFor("__bh.camera.piloting", 60_000);
    expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
    await app.waitFor("!!__bh.pwa.zones", 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const tool = (a: Record<string, unknown>) =>
    app.js<unknown>(
      `__bh.tars.tools().find((t) => t.name === "offline_zones").run(${JSON.stringify(a)}, new AbortController().signal).then((r) => r, (e) => ({ error: String(e.message ?? e) }))`,
    );

  test("listed, estimated, an unknown zone refused by name", async () => {
    const list = (await tool({ action: "list" })) as { zones: unknown[] };
    const est = (await tool({ action: "estimate", lat: 45.92, lon: 6.87, radiusKm: 10, profile: "valley" })) as {
      sizeMb: number;
      minutes: number;
      tiles: number;
    };
    const unknown = (await tool({ action: "pause", zone: "Nowhere-at-all" })) as { error?: string };
    console.log(`  list ${JSON.stringify(list)}\n  estimate ${JSON.stringify(est)}\n  unknown ${JSON.stringify(unknown)}`);
    expect(Array.isArray(list.zones)).toBe(true);
    expect(est.sizeMb).toBeGreaterThan(1);
    expect(est.minutes).toBeGreaterThanOrEqual(0);
    expect(est.tiles).toBeGreaterThan(10);
    expect(String(unknown.error ?? unknown)).toMatch(/no zone/);
  }, 60_000);
});
