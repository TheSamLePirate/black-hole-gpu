import { afterAll, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The HUD's frame data a structuredClone would refuse, craft by craft (hud/clone-probe.ts — before drawing the HUD in a worker,
// docs/progress/j0/FICHE-CPU-kerr-mini-2026-11-14.md): the F-35, the A320, the Ranger and the Lander flown low over the Earth from their
// cockpit, 4 s each with the probe on; the paths found, by craft. The J0 flight (F-35) found one, relief.at — since drawn by the page.
// Duration: ~2 min on kerr-mini
// Done when: each craft flown 4 s with the probe on, its paths logged

afterAll(stopServer);

test.skipIf(!E2E)(
  "the HUD's frame data a worker could not be sent, for each craft",
  async () => {
    const app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    try {
      await app.waitFor("__bh.camera.piloting", 120_000);
      const found: Record<string, string[]> = {};
      for (const v of ["f35", "a320", "ranger", "lander"]) {
        await app.js(`(() => { __bh.settings.vessel = "${v}"; return 1; })()`);
        await app.waitFor(`__bh.fleet.active === "${v}"`, 60_000);
        await app.js(
          `(() => { __bh.game.flyAt(43.1, 6.15, 900, 80, ${v === "lander" ? 30 : 140}); __bh.settings.shipMount = "cockpit"; return 1; })()`,
        );
        await Bun.sleep(1500);
        await app.js(`(() => { globalThis.__hudCloneProbe = new Set(); globalThis.__hudCloneMs = []; return 1; })()`);
        await Bun.sleep(4000);
        found[v] = await app.js<string[]>(
          `(() => { const p = [...globalThis.__hudCloneProbe].sort(); delete globalThis.__hudCloneProbe; return p; })()`,
        );
        // (the clone's cost a frame [ms]: its median and 95th percentile)
        const ms = await app.js<
          number[]
        >(`(() => { const m = (globalThis.__hudCloneMs ?? []).slice().sort((a, b) => a - b); delete globalThis.__hudCloneMs;
          return m.length ? [m.length, m[m.length >> 1], m[Math.floor(0.95 * (m.length - 1))]] : [0, 0, 0]; })()`);
        console.log(
          `  ${v}: ${found[v]!.length ? found[v]!.join(" · ") : "nothing"} — the clone ${ms[1]!.toFixed(3)} ms (p95 ${ms[2]!.toFixed(3)}, ${ms[0]} frames) — mount ${await app.js<string>("__bh.settings.shipMount")}`,
        );
      }
      // (relief.at is still in the data — the page's height sampler, the image now made by the page: listed, not refused)
      expect(Object.keys(found).length).toBe(4);
    } finally {
      app.close();
    }
  },
  300_000,
);
