import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The pilot's body in the game (docs/PLAN-AVIATION-AAA.md, V5): a 9 g pull held from the cockpit — the view greying,
// narrowing; passed out, black; without the computer past 30°, ANGLE OF ATTACK said — and no page error from the
// breathing, the buffet's rumble or the gamepad's. (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the F-35 pilot's body", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const stick = (s: { pitch?: number } | null) =>
    app.js(`(() => { const c = __bh.camera; c.__input ??= c.pilotInput.bind(c);
      c.pilotInput = ${s ? `(pad) => ({ ...c.__input(pad), ...${JSON.stringify(s)} })` : "c.__input"}; return 1; })()`);
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.wind = 0; __bh.settings.f35GEffects = true; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("9 g held from the cockpit: grey, then the tunnel; passed out: black", async () => {
    await app.js(
      `(() => { __bh.settings.f35GLimit = 9; __bh.settings.shipMount = "cockpit"; __bh.game.flyAt(36.06, -112.14, 4000, 90, 320); return 1; })()`,
    );
    await Bun.sleep(1500);
    await app.js(`(() => { __bh.camera.pilot.throttle = 1; __bh.camera.jetToggle("ab"); return 1; })()`);
    await stick({ pitch: 1 });
    // (the sim's own time: a slow page takes longer — waited for, not timed)
    await app.waitFor(`__bh.camera.gStrain.grey > 0.3`, 45_000).catch(() => {});
    const grey = await app.js<number>(`__bh.camera.gStrain.grey`);
    console.log(`  grey ${grey.toFixed(2)}, felt ${(await app.js<number>(`__bh.camera.gStrain.felt`)).toFixed(1)} g`);
    await shot("body-grey");
    expect(grey).toBeGreaterThan(0.3);
    await app.js(`(() => { __bh.camera.gStrain.out = 8; return 1; })()`);
    await Bun.sleep(600);
    await shot("body-gloc");
    expect(await app.js<boolean>(`__bh.camera.gStrain.gloc`)).toBe(true);
    await stick(null);
    await app.js(`(() => { __bh.camera.gStrain.reset(); __bh.settings.f35GLimit = 7; return 1; })()`);
  }, 60_000);

  test("without the computer past 30°: ANGLE OF ATTACK on the HUD", async () => {
    await app.js(
      `(() => { __bh.settings.f35Law = "direct"; __bh.settings.shipMount = "chase"; __bh.game.flyAt(36.06, -112.14, 5000, 90, 110); __bh.camera.pilot.throttle = 0; return 1; })()`,
    );
    await Bun.sleep(1200);
    await stick({ pitch: 1 });
    await app.waitFor(`__bh.camera.flightInfo().air?.aoaWarn === true`, 10_000);
    await Bun.sleep(400);
    await shot("body-aoa");
    await stick(null);
    await app.js(`(() => { __bh.settings.f35Law = "normal"; return 1; })()`);
  }, 60_000);
});
