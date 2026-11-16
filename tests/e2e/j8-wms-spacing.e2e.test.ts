import { afterAll, describe, expect, test } from "bun:test";
import { ZONE_PROFILES, zoneChains } from "../../src/system/zones";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-J8 J8-9 — the witness of « the WMS-R's spacing lifted: the data come from the e2e's disk » (the render session's terms, 17 Nov
// 2026): the harness sets it for a Service Worker's boot with the e2e's disk serving (lib/app.ts wmsSpacingLifted, the page global
// `__e2eWmsSpacingLifted`), the zones pass it with each batch (pwa-zones.ts), the worker skips its WMS-R spacing alone (sw.ts gentle).
// The same 200 WMS-R chains of Toulon's relief asked of the worker twice as a zone's batches would be (`zone-fetch`, each link fetched
// again — fresh —), the player's spacing kept, then lifted: the same chains in, the same bytes, none failed — only the time changes
// (kept: ≥ 200 × 125 ms; lifted: a fraction of it).
// Done when: the page global set by the harness, both passes 200 chains in with the same bytes and none failed, the lifted pass under a
// third of the kept one's time.
// Duration: ~1 min.

afterAll(stopServer);
const SOURCES = {
  ortho: false,
  relief: true,
  hlod: false,
  span: 4,
  scenery: { mode: "off" as const, satellite: false, reach: 1, overture: false },
};
const CHAINS = zoneChains(43.124, 5.93, 1000, ZONE_PROFILES.overflight, SOURCES)
  .filter((c) => c[0]!.includes("data.geopf.fr/wms-r"))
  .slice(0, 200);

describe.skipIf(!E2E)("PLAN-J8 J8-9: the WMS-R's spacing lifted for the e2e's disk", () => {
  test("the same 200 WMS-R chains, spaced then lifted: the same chains and bytes, only the time changes", async () => {
    expect(CHAINS.length).toBe(200);
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", sw: true });
    try {
      await app.scenario("Toulon's relief · 200 WMS-R chains, the player's spacing then lifted");
      expect(app.wmsSpacingLifted).toBe(true);
      expect(await app.js<boolean>("window.__e2eWmsSpacingLifted === true")).toBe(true);
      expect(await app.js<boolean>("__bh.pwa.ready()")).toBe(true);
      type Tally = { done: number; bytes: number; none: number; failed: string[][] };
      const pass = async (id: string, lifted: boolean) => {
        const t0 = Date.now();
        const r = await app.js<Tally | null>(
          `__bh.pwa.talk({ type: "zone-fetch", id: "${id}", chains: ${JSON.stringify(CHAINS)}, fresh: true, wmsSpacingLifted: ${lifted} }, 120000)`,
        );
        return { ...r!, failed: r!.failed.length, s: (Date.now() - t0) / 1000 };
      };
      const kept = await pass("e2e-wms-kept", false);
      const lifted = await pass("e2e-wms-lifted", true);
      console.log(`  kept: ${JSON.stringify(kept)}\n  lifted: ${JSON.stringify(lifted)}`);
      for (const id of ["e2e-wms-kept", "e2e-wms-lifted"]) await app.js(`__bh.pwa.talk({ type: "zone-delete", id: "${id}" }, 60000)`);
      expect(kept.done).toBe(200);
      expect(lifted.done).toBe(200);
      expect(lifted.bytes).toBe(kept.bytes);
      expect(lifted.none).toBe(kept.none);
      expect(kept.failed + lifted.failed).toBe(0);
      expect(kept.s).toBeGreaterThan(200 * 0.125 - 1);
      expect(lifted.s).toBeLessThan(kept.s / 3);
      expect(app.cdp.errors).toEqual([]);
    } finally {
      app.close();
    }
  }, 300_000);
});
