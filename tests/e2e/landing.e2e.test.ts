import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The landing (phase 2, the gear and the wind): the entry autopilot's glide from 80 km out onto Edwards's
// runway, the touchdown under 2 m/s, the rollout braked to a stop on the runway — in still air and in the
// default light wind (a moderate one lands 5 times out of 6; a strong crosswind is past the Ranger's limits). One call at fixed steps (the page's own loop between calls would make it vary),
// the Earth's heights in first (the ground under the approach the same each run).

describe.skipIf(!E2E)("landing: the Ranger glides onto Edwards and stops on the runway", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  for (const wind of [0, 1])
    test(`wind ${["calm", "light", "moderate", "strong"][wind]}`, async () => {
      const r = await app.js<{ landed: boolean; fail: string | null; across: number; log: string[] }>(`(() => {
        __bh.freeze(true); __bh.settings.wind = ${wind}; __bh.game.glideTo("Edwards");
        const c = __bh.camera; let across = 0;
        for (let i = 0; i < 30 * 170; i++) {
          __bh.step(1 / 30);
          const A = c.entryRun?.app; if (A && A.along > -500) across = Math.max(across, Math.abs(A.across));
          if (c.ourLanded || c.airFlight.failure) break;
        }
        __bh.freeze(false);
        return { landed: !!c.ourLanded, fail: c.airFlight.failure, across, log: __bh.game.log.events.filter((e) => e.kind === "pilot").map((e) => e.text) };
      })()`);
      expect(r.fail).toBeNull();
      expect(r.landed).toBe(true);
      const td = r.log.find((l) => l.startsWith("Touchdown"));
      expect(td).toBeDefined();
      const sink = Number(td!.match(/· ([-\d.]+) m\/s down/)![1]);
      expect(sink).toBeLessThan(2);
      expect(r.log.some((l) => /Hard landing|collapsed|tipped/.test(l))).toBe(false);
      // (on the runway: within 60 m of its axis at the threshold)
      expect(r.across).toBeLessThan(60);
    }, 120_000);
});
