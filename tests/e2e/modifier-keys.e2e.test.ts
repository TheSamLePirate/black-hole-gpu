import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// Shift and Alt by real keys (audit 2026-11-10, FX-01; wave 3.5): an F-35 lined up at Edwards, throttle at idle. ⇧P as a
// hand types it — Shift down, P a moment later, both let go — sets the air brake and leaves the throttle where it was
// (before 13 Nov 2026 it raised it past 5 % and released the brakes); Shift held alone raises it, as it always did.
// Tiles and IGN blocked: the runway's own surface is enough.
// Done when: the air brake toggled with the throttle at 0, then the throttle raised by Shift alone. Duration: ~1 min.

const OUT = "remote-results/modifier-keys";

describe.skipIf(!E2E)("Shift: a shortcut's modifier or the throttle, never both", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*", "*geopf.fr*", "*ign.fr*"],
    });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });
  const state = () =>
    app.js<{ thr: number; brake: number; vessel: string }>(
      `({ thr: __bh.camera.pilot.throttle, brake: __bh.camera.airBrake, vessel: __bh.fleet.active })`,
    );

  test("⇧P on the runway: the air brake out, the throttle still at idle", async () => {
    const v = await app.js<string>(`(() => {
      __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; __bh.settings.wind = 0;
      for (let i = 0; i < 5; i++) __bh.step(1 / 30);
      __bh.game.lineUp("Edwards");
      __bh.camera.pilot.throttle = 0;
      return __bh.fleet.active; })()`);
    expect(v).toBe("f35");
    await app.waitFor("__bh.camera.ourLanded !== null || !!__bh.camera.rolling", 10_000);
    const before = await state();
    // (as a hand does it: Shift down, P 60 ms later, P let go, Shift let go)
    await app.hold("ShiftLeft", 60, async () => {
      await app.press("KeyP", "P", { shift: true });
      await Bun.sleep(400);
    });
    await Bun.sleep(300);
    const after = await state();
    console.log(`  ⇧P: air brake ${before.brake} → ${after.brake}; throttle ${before.thr} → ${after.thr.toFixed(3)}`);
    await app.shot(`${OUT}/1-shift-p.png`);
    expect(after.brake).not.toBe(before.brake);
    expect(after.thr).toBe(0);
    // (a bound: the default 5 s ran out in the screenshot while the page compiled — 13 Nov 2026)
  }, 60_000);

  test("Shift held alone: the throttle, as before", async () => {
    await app.hold("ShiftLeft", 900);
    const s = await state();
    console.log(`  Shift alone 0.9 s: throttle ${s.thr.toFixed(3)}`);
    await app.shot(`${OUT}/2-shift-alone.png`);
    expect(s.thr).toBeGreaterThan(0.2);
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
