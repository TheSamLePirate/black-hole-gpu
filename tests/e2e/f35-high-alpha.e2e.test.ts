import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The F-35B at high incidence in the game itself (docs/PLAN-AVIATION-AAA.md, V2): full aft stick on its law — 50°
// held, the buffet, its α in amber on the HUD —; then the direct law ("DIRECT LAW" on the HUD): the stick and the
// rudder held into a spin — the ground turning under the nose —, and its recovery with the controls let go.
// (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the F-35B at high incidence", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  /** the stick held (pitch, roll, yaw: −1…1) — null: let go */
  const stick = (s: { pitch?: number; roll?: number; yaw?: number } | null) =>
    app.js(`(() => { const c = __bh.camera; c.__input ??= c.pilotInput.bind(c);
      c.pilotInput = ${s ? `(pad) => ({ ...c.__input(pad), ...${JSON.stringify(s)} })` : "c.__input"}; return 1; })()`);
  const state = () =>
    app.js<{
      alpha: number;
      beta: number;
      r: number;
      h: number;
      buffet: number;
    }>(`(() => { const L = __bh.camera.airFlight.last, D = Math.PI / 180;
      return { alpha: (L?.out.alpha ?? 0) / D, beta: (L?.out.beta ?? 0) / D, r: __bh.camera.pilot.omega[1] / D, h: L?.h ?? 0, buffet: L?.out.buffet ?? 0 }; })()`);
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; __bh.settings.wind = 0; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("its law: full aft stick at 140 m/s — 50° held, the buffet", async () => {
    await app.js(
      `(() => { __bh.settings.f35Law = "normal"; __bh.game.flyAt(36.06, -112.14, 3000, 90, 140); __bh.settings.shipMount = "chase"; return 1; })()`,
    );
    await Bun.sleep(1500);
    await stick({ pitch: 1 });
    let top = 0;
    let buffet = 0;
    for (let k = 0; k < 16; k++) {
      await Bun.sleep(250);
      const s = await state();
      top = Math.max(top, s.alpha);
      buffet = Math.max(buffet, s.buffet);
      if (k === 12) await shot("f35-alpha50");
    }
    await stick(null);
    console.log(`  α ${top.toFixed(1)}° at most, the buffet ${buffet.toFixed(2)}`);
    expect(top).toBeGreaterThan(45);
    expect(top).toBeLessThan(54);
    expect(buffet).toBeGreaterThan(0.5);
  }, 60_000);

  test("without the computer: aft stick and full rudder — a spin; let go, it recovers", async () => {
    await app.js(
      `(() => { __bh.settings.f35Law = "direct"; __bh.game.flyAt(36.06, -112.14, 5000, 90, 110); __bh.camera.pilot.throttle = 0; return 1; })()`,
    );
    await Bun.sleep(1500);
    await stick({ pitch: 1 });
    await Bun.sleep(4000);
    await stick({ pitch: 1, yaw: 1 });
    const rates: number[] = [];
    for (let k = 0; k < 28; k++) {
      await Bun.sleep(500);
      rates.push(Math.abs((await state()).r));
      if (k === 20) await shot("f35-spin");
    }
    const spin = rates.slice(-10).reduce((a, b) => a + b, 0) / 10;
    await stick(null);
    const t0 = Date.now();
    await app.waitFor(
      `(() => { const L = __bh.camera.airFlight.last; return Math.abs(__bh.camera.pilot.omega[1]) < 0.17 && Math.abs(L.out.alpha) < 0.35; })()`,
      20_000,
    );
    console.log(`  spinning ${spin.toFixed(0)}°/s; recovered ${((Date.now() - t0) / 1000).toFixed(1)} s after letting go`);
    await shot("f35-recovered");
    await app.js(`(() => { __bh.settings.f35Law = "normal"; return 1; })()`);
    expect(spin).toBeGreaterThan(40);
  }, 120_000);
});
