import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-COCKPIT K4b: the landing gear commanded — up high in the air at the flight's start (down started low
// and slow), G lowers it in 8 s
// (drawn coming down), locked down on the ground (G refused there); its alarm low and slow with it up;
// a touchdown with it up on the belly (sliding to a stop, the gear jammed); the cockpit's lever. Flights at
// fixed steps (__bh.step), Edwards's ground in.

describe.skipIf(!E2E)("the landing gear, commanded", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.waitFor(`__bh.relief("earth", 34.905, -117.884) > 100`, 60_000);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("up in the air; G: down in 8 s, drawn coming down; the alarm low and slow with it up", async () => {
    const r = await app.js<{ init: [boolean, number]; half: number; full: number; drawn: number; warnUp: boolean; warnDown: boolean }>(`(() => {
      __bh.freeze(true); __bh.settings.autoGear = false; __bh.settings.wind = 0;
      // (high and fast at the flight's start: the gear up)
      __bh.game.glideTo("Edwards", 30, 3, 200);
      const c = __bh.camera; c.pilot.auto = "none"; c.pilot.hold = "none"; c.pilot.assist = false;
      __bh.step(1 / 30);
      const init = [c.gearDown, c.gearExt];
      // (low and slow — started there the gear would be down: left up for the alarm)
      __bh.game.glideTo("Edwards", 6, 0.25, 120);
      c.pilot.auto = "none"; c.pilot.hold = "none";
      __bh.step(1 / 30);
      c.gearDown = false; c.gearExt = 0;
      __bh.step(1 / 30);
      // (low and slow, the gear up: the alarm)
      const warnUp = c.airInfo().gearWarn;
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", key: "g" }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyG", key: "g" }));
      for (let i = 0; i < 30 * 4; i++) __bh.step(1 / 30);
      const half = c.gearExt, drawn = __bh.renderer.shipGear?.ext ?? -1;
      for (let i = 0; i < 30 * 4.5; i++) __bh.step(1 / 30);
      const full = c.gearExt, warnDown = c.airInfo().gearWarn;
      __bh.freeze(false);
      return { init, half, full, drawn, warnUp, warnDown };
    })()`);
    expect(r.init).toEqual([false, 0]);
    expect(r.warnUp).toBe(true);
    expect(r.half).toBeGreaterThan(0.4);
    expect(r.half).toBeLessThan(0.6);
    expect(r.full).toBe(1);
    expect(r.warnDown).toBe(false);
  });

  test("a touchdown gear up: on the belly, slid to a stop, the gear jammed; G refused", async () => {
    const r = await app.js<{ landed: boolean; fail: string | null; belly: boolean; said: string[]; gearDownAfter: boolean }>(`(() => {
      __bh.freeze(true); __bh.settings.autoGear = false; __bh.settings.wind = 0;
      __bh.game.glideTo("Edwards");
      const c = __bh.camera;
      for (let i = 0; i < 30 * 170; i++) {
        __bh.step(1 / 30);
        // (the gear held up: the autopilot would lower it — kept in, in transit at most)
        c.gearDown = false; c.gearExt = 0;
        if (c.ourLanded || c.airFlight.failure) break;
      }
      // (G on the belly: refused)
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", key: "g" }));
      __bh.freeze(false);
      return { landed: !!c.ourLanded, fail: c.airFlight.failure ?? null, belly: c.onBelly, gearDownAfter: c.gearDown,
        said: __bh.game.log.events.filter((e) => e.kind === "pilot").map((e) => e.text).slice(-4) };
    })()`);
    expect(r.fail).toBeNull();
    expect(r.landed).toBe(true);
    expect(r.belly).toBe(true);
    expect(r.said.some((s) => /Belly landing/.test(s))).toBe(true);
    expect(r.gearDownAfter).toBe(false);
  }, 180_000);

  test("on the ground, landed on its wheels: locked down — G refused", async () => {
    const r = await app.js<{ landed: boolean; before: boolean; after: boolean }>(`(() => {
      __bh.freeze(true); __bh.settings.wind = 0; __bh.game.glideTo("Edwards");
      const c = __bh.camera;
      for (let i = 0; i < 30 * 170; i++) { __bh.step(1 / 30); if (c.ourLanded || c.airFlight.failure) break; }
      const before = c.gearDown;
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG", key: "g" }));
      __bh.step(1 / 30);
      __bh.freeze(false);
      return { landed: !!c.ourLanded, before, after: c.gearDown };
    })()`);
    expect(r.landed).toBe(true);
    expect(r.before).toBe(true);
    expect(r.after).toBe(true);
  }, 180_000);
});
