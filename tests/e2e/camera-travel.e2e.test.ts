import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The views moved as far as one wants: the outside free view past its old 50 km leash, the spectator's tripod
// walked by a key held — slow at a tap, fast held (the travel boost) —, no longer snapped back to the ship.

describe.skipIf(!E2E)("the camera's travel", () => {
  let app: App;
  const fwd = async () =>
    app.js<string>(`(() => { const k = Object.entries(__bh.freeCameraKeys ? __bh.freeCameraKeys() : {}); return "KeyW"; })()`);
  beforeAll(async () => {
    app = await App.boot({ width: 1200, height: 800, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the outside free view: a key held carries it beyond 50 km from the ship", async () => {
    await app.js(`(() => { __bh.settings.shipMount = "free"; return 1; })()`);
    await Bun.sleep(1500);
    const d0 = await app.js<number>(`Math.hypot(...__bh.camera.outside.eye)`);
    await app.hold(await fwd(), 15000);
    const d1 = await app.js<number>(`Math.hypot(...__bh.camera.outside.eye)`);
    console.log(`  outside free: ${d0.toFixed(0)} m → ${(d1 / 1000).toFixed(0)} km`);
    expect(d1).toBeGreaterThan(60_000);
    expect(d1).toBeLessThan(5e6);
  }, 60_000);

  test("the spectator's tripod: a tap moves it a little, a long press hundreds of metres; it stays where it went", async () => {
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await app.press("F3");
    await app.waitFor(`__bh.camera.spectating`, 10_000);
    await Bun.sleep(2500);
    // (on the Earth: the target set there — the spectator's ⇧T stands on the target's world)
    await app.js(`(() => { __bh.settings.target = "earth"; __bh.camera.viewController().s.target = "earth"; return 1; })()`);
    await app.press("KeyT", "T", { shift: true });
    await Bun.sleep(1500);
    // (the spectator's view: its place [M, home frame] in metres, its height over the ground [m])
    // (its place on the world's own axes [m]: the tripod's fixed point)
    const pos = `(() => { const v = __bh.camera.viewController(); const F = v.rig.fixed; const mR = 1476.625 * __bh.settings.massSolar;
      return F ? [F[0] * mR, F[1] * mR, F[2] * mR] : null; })()`;
    const at = (a: number[], b: number[]) => Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
    const p0 = await app.js<number[]>(pos);
    expect(p0).not.toBeNull();
    await app.hold(await fwd(), 300);
    await Bun.sleep(400);
    const p1 = await app.js<number[]>(pos);
    await app.hold(await fwd(), 7000);
    await Bun.sleep(500);
    const p2 = await app.js<number[]>(pos);
    const tap = at(p0, p1),
      held = at(p1, p2);
    console.log(`  tripod: a tap ${tap.toFixed(1)} m, 7 s held ${held.toFixed(0)} m`);
    expect(tap).toBeLessThan(5);
    expect(held).toBeGreaterThan(150);
    // (still on the ground there: not taken back to the ship in orbit)
    await Bun.sleep(1500);
    const p3 = await app.js<number[]>(pos);
    expect(at(p2, p3)).toBeLessThan(5);
    expect(await app.js<string>(`__bh.camera.viewController().s.rotation`)).toBe("tripod");
  }, 90_000);
});
