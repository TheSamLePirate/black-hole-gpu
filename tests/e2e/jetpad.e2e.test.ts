import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The F-35 on an Xbox 360 pad (input/jetpad.ts), with a pad of the page's own (navigator.getGamepads replaced: a
// standard-mapping pad whose sticks and buttons the test moves): first the Alps as ever; the left stick rolls the jet;
// the right stick turns the head and lets it come back ahead; R3 held zooms and lets the view come back; the D-pad's
// gear; in a guns fight, A fires the gun and Y locks. (E2E_SHOTS=<dir>: the views.)

const FAKE_PAD = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
  window.__pad = { id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)", index: 0, mapping: "standard", connected: true, axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  navigator.getGamepads = () => [window.__pad];
  return 1;
})()`;

describe.skipIf(!E2E)("the F-35 on an Xbox 360 pad", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const axes = (a: number[]) => app.js(`(window.__pad.axes = ${JSON.stringify(a)}, 1)`);
  const hold = (n: number, on: boolean) =>
    app.js(`(window.__pad.buttons[${n}].pressed = ${on}, window.__pad.buttons[${n}].value = ${on ? 1 : 0}, 1)`);
  const press = async (n: number, ms = 120) => {
    await hold(n, true);
    await Bun.sleep(ms);
    await hold(n, false);
    await Bun.sleep(150);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(FAKE_PAD);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 2500, 110, 200); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
    expect(await app.js<boolean>(`!!__bh.camera.jetPadOut`)).toBe(true);
  }, 120_000);

  test("RT throttles up (placed idle by the test's tools)", async () => {
    const t0 = await app.js<number>(`__bh.camera.pilot.throttle`);
    await hold(7, true);
    await Bun.sleep(1600);
    await hold(7, false);
    const t1 = await app.js<number>(`__bh.camera.pilot.throttle`);
    console.log(`  the throttle: ${t0.toFixed(2)} → ${t1.toFixed(2)}`);
    expect(t1).toBeGreaterThan(t0 + 0.5);
  }, 60_000);

  test("the left stick rolls the jet right", async () => {
    await axes([0.7, 0, 0, 0]);
    await Bun.sleep(1500);
    const bank = await app.js<number>(`((__bh.camera.attitudeNow().bank ?? 0) * 180) / Math.PI`);
    await axes([0, 0, 0, 0]);
    console.log(`  banked ${bank.toFixed(0)}° after 1.5 s of the stick right`);
    expect(bank).toBeGreaterThan(20);
    await Bun.sleep(1500);
  }, 60_000);

  test("the right stick turns the head, back ahead when let go; R3 held zooms, the view back when let go", async () => {
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await axes([0, 0, 1, -0.3]);
    await Bun.sleep(800);
    const look = await app.js<{ yaw: number; pitch: number }>(`({ yaw: __bh.settings.shipLookYaw, pitch: __bh.settings.shipLookPitch })`);
    await shot("head-right");
    console.log(`  the head: ${look.yaw.toFixed(0)}°, ${look.pitch.toFixed(0)}°`);
    expect(look.yaw).toBeGreaterThan(120);
    await axes([0, 0, 0, 0]);
    await Bun.sleep(800);
    expect(Math.abs(await app.js<number>(`__bh.settings.shipLookYaw`))).toBeLessThan(1);
    const fov0 = await app.js<number>(`__bh.settings.fov`);
    await hold(11, true);
    await Bun.sleep(700);
    const fovZ = await app.js<number>(`__bh.settings.fov`);
    await shot("zoom");
    await hold(11, false);
    await Bun.sleep(800);
    const fov1 = await app.js<number>(`__bh.settings.fov`);
    console.log(`  the field: ${fov0.toFixed(0)}° → ${fovZ.toFixed(0)}° zoomed → ${fov1.toFixed(0)}°`);
    expect(fovZ).toBeLessThan(fov0 / 2);
    expect(fov1).toBeCloseTo(fov0, 0);
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
  }, 60_000);

  test("the D-pad's gear; in a guns fight, Y locks and A fires the gun", async () => {
    const g0 = await app.js<boolean>(`__bh.camera.gearDown`);
    await press(12);
    expect(await app.js<boolean>(`__bh.camera.gearDown`)).toBe(!g0);
    await press(12);
    await app.js(
      `(async () => { const t = __bh.tars.tools().find((x) => x.name === "f35"); await t.run({ action: "fly", id: "guns" }, new AbortController().signal); return 1; })()`,
    );
    await app.waitFor(`__bh.camera.combat?.status === "run"`, 30_000);
    await Bun.sleep(3000);
    await press(3);
    await Bun.sleep(400);
    const locked = await app.js<string | null>(`__bh.camera.radar.lock`);
    console.log(`  Y: locked ${locked}`);
    expect(locked).not.toBeNull();
    const r0 = await app.js<number>(`__bh.camera.combat.world.stores.gun`);
    await hold(0, true);
    await Bun.sleep(700);
    const firing = await app.js<boolean>(`__bh.camera.combat.world.firing`);
    await shot("gun");
    await hold(0, false);
    const r1 = await app.js<number>(`__bh.camera.combat.world.stores.gun`);
    console.log(`  A: firing ${firing}, rounds ${r0} → ${r1}`);
    expect(firing).toBe(true);
    expect(r1).toBeLessThan(r0);
  }, 120_000);
});
