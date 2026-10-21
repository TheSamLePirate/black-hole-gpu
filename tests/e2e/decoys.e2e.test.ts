import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The decoys seen (PLAN-RADAR-AAA RD8a): in a fight over the Alps, in daylight, flares and chaff dropped on − (real
// keys) — each flare a burning star in the view (the renderer's glares, the lamps' pass) trailing its white smoke, each
// chaff bundle a silver puff; on the HUD's radar scope, the panoramic display's TSD, the FCR (the chaff's echo) and the
// DAS's band (the flares) — the aggressors' own decoys too. (E2E_SHOTS=<dir>: the view from behind, the cockpit.)

describe.skipIf(!E2E)("the decoys seen", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { Object.assign(__bh.settings, { weather: "fair", earthClouds: 0, f35InfiniteAmmo: true });
      __bh.game.flyAt(45.9, 6.9, 4500, 90, 230); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt);
      c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("ap"); c.jetToggle("athr"); __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.click(`[data-testid="chp-fight-drones"]`);
    await app.waitFor(`!!__bh.camera.combat?.last`, 20_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("− drops a flare and chaff: burning stars in the view, their smoke, on every radar", async () => {
    // (the DAS's band and the TSD drawn: their marks counted as the display draws them)
    await app.js(`(() => { const p = __bh.pcd.pcd; const f = p.decoyMark.bind(p); window.__decoyMarks = { flare: 0, chaff: 0 };
      p.decoyMark = (x, y, k, a, s) => { window.__decoyMarks[k]++; return f(x, y, k, a, s); }; return 1; })()`);
    for (let i = 0; i < 3; i++) {
      await app.press("Minus", "-");
      await Bun.sleep(350);
    }
    const r = await app.js<{ decoys: number; glares: number; lit: number; scope: number; trails: number }>(
      `(() => { const c = __bh.camera, W = c.combat.world, R = __bh.renderer;
        return { decoys: W.decoys.length, glares: R.combatGlares.length, lit: R.ship.lampCount,
          scope: c.flightInfo().combat?.radar.decoys?.length ?? 0, trails: (R.shipContrails?.n ?? 0) }; })()`,
    );
    console.log(`  ${JSON.stringify(r)}`);
    expect(r.decoys).toBeGreaterThanOrEqual(4);
    expect(r.glares).toBeGreaterThanOrEqual(1);
    expect(r.lit).toBeGreaterThanOrEqual(r.glares);
    expect(r.scope).toBeGreaterThanOrEqual(4);
    expect(r.trails).toBeGreaterThan(0);
    await shot("cockpit");
    // (from behind and above: the flares falling away, their ropes of smoke, the chaff's puffs)
    // (the view chosen first — it starts afresh —, then turned)
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(400);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 180, pitch: 8, dist: 45 }); return 1; })()`);
    for (let i = 0; i < 3; i++) {
      await app.press("Minus", "-");
      await Bun.sleep(500);
    }
    await Bun.sleep(700);
    await shot("behind");
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await app.waitFor(`window.__decoyMarks.flare > 0 && window.__decoyMarks.chaff > 0`, 10_000);
    console.log(`  marks drawn on the panoramic display: ${JSON.stringify(await app.js("window.__decoyMarks"))}`);
  }, 120_000);

  test("the decoys burn out: gone from the view and the radars after five seconds", async () => {
    await app.waitFor(`__bh.camera.combat.world.decoys.filter((d) => d.t < 5).length === 0`, 20_000);
    const r = await app.js<{ glares: number }>(`({ glares: __bh.renderer.combatGlares.length })`);
    expect(r.glares).toBe(0);
  }, 60_000);
});
