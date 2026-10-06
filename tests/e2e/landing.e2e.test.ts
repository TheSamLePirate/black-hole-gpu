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
      const r = await app.js<{
        landed: boolean;
        fail: string | null;
        across: number;
        gMax: number;
        offProfile: number | null;
        manualOnWheels: boolean;
        log: string[];
      }>(`(() => {
        __bh.freeze(true); __bh.settings.wind = ${wind}; __bh.game.glideTo("Edwards");
        const c = __bh.camera; let across = 0, gMax = 0, offProfile = null, manualOnWheels = false;
        for (let i = 0; i < 30 * 170; i++) {
          __bh.step(1 / 30);
          const R = c.entryRun, A = R?.app; if (A && A.along > -500) across = Math.max(across, Math.abs(A.across));
          if (c.airFlight.inAir && !c.rolling) gMax = Math.max(gMax, c.airFlight.g);
          // (the final's profile frozen as the pull-up nears: how far the craft is from it then)
          if (offProfile === null && R?.gOuter && R.prof) offProfile = A.agl - R.prof.h;
          if (c.rolling && c.runwayView()?.manual) manualOnWheels = true;
          if (c.ourLanded || c.airFlight.failure) break;
        }
        __bh.freeze(false);
        return { landed: !!c.ourLanded, fail: c.airFlight.failure, across, gMax, offProfile, manualOnWheels,
          log: __bh.game.log.events.filter((e) => e.kind === "pilot").map((e) => e.text) };
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
      // (flown smoothly: the pull-out from the hand-over's dive under 2.5 g — the stall margin kept in thin
      // air once forced the nose to no lift at all, 3.1 g after —; the final begun on its own profile — the
      // approach's gate once over its steepest slope, 550 m above it at the pull-up)
      expect(r.gMax).toBeLessThan(2.5);
      expect(Math.abs(r.offProfile ?? Infinity)).toBeLessThan(150);
      // (the wheels down: no hand-flown final begun from the ground — its profile flat, the HUD's graph off)
      expect(r.manualOnWheels).toBe(false);
    }, 120_000);

  test("the deorbit planned in real time: engaged at ×1000, the warp held while the worker plans", async () => {
    // (its burn is timed from the state it was given: at ×1000 the orbit ran on past it, the burn fired late)
    const r = await app.js<{ phase: string; warp: number }[]>(`(async () => {
      __bh.game.orbit("earth", { altKm: 400, inc: 40 });
      __bh.game.warp(1000);
      const c = __bh.camera, M = 4.925490947e-6 * __bh.settings.massSolar;
      c.pilot.auto = "none"; c.pilot.setAuto("entry");
      const seen = [];
      for (let k = 0; k < 20 && c.entryRun?.phase === "plan"; k++) {
        await new Promise((ok) => requestAnimationFrame(() => ok(true)));
        if (c.entryRun?.phase === "plan") seen.push({ phase: c.entryRun.phase, warp: __bh.settings.timeSpeed * M });
      }
      c.pilot.setAuto("none");
      return seen;
    })()`);
    expect(r.length).toBeGreaterThan(0);
    for (const s of r) expect(s.warp).toBeLessThanOrEqual(1.001);
  }, 60_000);
});
