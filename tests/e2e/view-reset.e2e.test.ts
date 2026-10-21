import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// (the turned look set on the chase view: in the F-35's cockpit the head springs back by itself)
// A view chosen starts afresh, looking ahead (main.ts setMount / setView, controller/piloting.ts viewReset,
// controller/rotation.ts lookAheadLevel): the F-35's views by V and by the camera panel's tiles — the look turned
// away and the target locked beforehand, straight ahead and unlocked after; the same view chosen again resets it
// too; around the craft, behind it again —; the free camera's tripod on the Earth's ground, looking down, laid level
// on the horizon by its tile. Real input (CDP keys, clicks).

describe.skipIf(!E2E)("a view chosen looks ahead", () => {
  let app: App;
  const look = () =>
    app.js<{ yaw: number; pitch: number; lookAt: boolean; mount: string; oyaw: number; opitch: number }>(
      `(() => { const s = __bh.settings, o = __bh.camera.outside; return { yaw: s.shipLookYaw, pitch: s.shipLookPitch, lookAt: s.lookAt, mount: s.shipMount, oyaw: o.yaw, opitch: o.pitch }; })()`,
    );
  // (the look turned away, the outside view swung round; then the target locked — after the measure: the lock turns
  // the look to it)
  const turnAway = () =>
    app.js(`(() => { const c = __bh.camera; c.setLook(55, -25); c.outside.yaw = 140; c.outside.pitch = -30; return 1; })()`);
  const lock = () => app.js(`(() => { __bh.camera.setLookAt(true); return 1; })()`);
  const tarsCamera = (mount: string) =>
    app.js(
      `(() => { const T = __bh.tars.tools().find((x) => x.name === "camera"); return T.run({ mount: ${JSON.stringify(mount)} }); })()`,
    );
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(45.85, 6.75, 2500, 110, 180); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(1500);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("V: the next view, looking ahead, unlocked", async () => {
    await turnAway();
    const before = await look();
    expect(Math.abs(before.yaw)).toBeGreaterThan(40);
    await lock();
    await app.press("KeyV", "v");
    await Bun.sleep(400);
    const after = await look();
    console.log(
      `  ${before.mount} → ${after.mount}: look ${before.yaw.toFixed(0)}°/${before.pitch.toFixed(0)}° → ${after.yaw.toFixed(0)}°/${after.pitch.toFixed(0)}°`,
    );
    expect(after.mount).not.toBe(before.mount);
    expect(Math.abs(after.yaw)).toBeLessThan(0.5);
    expect(Math.abs(after.pitch)).toBeLessThan(0.5);
    expect(after.lookAt).toBe(false);
  }, 60_000);

  test("Around: behind the craft again; the same view chosen again resets it", async () => {
    await tarsCamera("around");
    await Bun.sleep(300);
    await turnAway();
    await lock();
    await tarsCamera("around");
    await Bun.sleep(400);
    const a = await look();
    console.log(`  around chosen again: behind ${a.oyaw.toFixed(0)}°, ${a.opitch.toFixed(0)}° up, look ${a.yaw.toFixed(0)}°`);
    expect(a.mount).toBe("around");
    expect(Math.abs(a.oyaw)).toBeLessThan(0.5);
    expect(a.opitch).toBeGreaterThan(0);
    expect(Math.abs(a.yaw)).toBeLessThan(0.5);
    expect(a.lookAt).toBe(false);
    await tarsCamera("chase");
    await Bun.sleep(300);
    await turnAway();
    await tarsCamera("chase");
    await Bun.sleep(400);
    const c = await look();
    expect(c.mount).toBe("chase");
    expect(Math.abs(c.yaw) + Math.abs(c.pitch)).toBeLessThan(1);
  }, 60_000);

  test("the free camera's tripod, looking down, laid level on the horizon by its tile", async () => {
    // (the free camera with no craft — the ship put away, as the Ranger button does —, a tripod on the Earth's ground
    // under it — ⇧T, the target the Earth —, then pitched 35° down; with a craft flown the free camera is its
    // spectator, whose views are the ship's)
    await app.js(`(() => { __bh.settings.ship = false; __bh.settings.target = "earth"; __bh.touch(); return 1; })()`);
    await app.waitFor(`__bh.mode.get() === "free" && !__bh.camera.spectating`, 10_000);
    await Bun.sleep(800);
    await app.press("KeyT", "T", { shift: true });
    await app.waitFor(`__bh.settings.rotation === "tripod"`, 10_000);
    await Bun.sleep(800);
    await app.js(`(() => { __bh.settings.pitch -= 35; return 1; })()`);
    await Bun.sleep(600);
    const pitchOf = () =>
      app.js<number>(`(() => { const c = __bh.camera, w = c.rigWorld(), t = c.nowTime(), b = c.rigBody(c.rig.ref, w.ours, t) ?? c.rigNearest(w.ours, w.X, t);
        const V = [0, 1, 2].map((k) => w.X[k] - b.C[k]), l = Math.hypot(...V); return Math.asin((w.fwd[0] * V[0] + w.fwd[1] * V[1] + w.fwd[2] * V[2]) / l) * 180 / Math.PI; })()`);
    const before = await pitchOf();
    await app.click("#btn-camera");
    await app.waitFor(`!!document.querySelector("[data-testid=cp-view-tripod]")`, 5000);
    await app.click("[data-testid=cp-view-tripod]");
    await Bun.sleep(800);
    const after = await pitchOf();
    console.log(`  tripod: the gaze ${before.toFixed(1)}° → ${after.toFixed(1)}° to the horizon`);
    expect(before).toBeLessThan(-20);
    expect(Math.abs(after)).toBeLessThan(2);
  }, 90_000);
});
