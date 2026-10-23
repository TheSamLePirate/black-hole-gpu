import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The spacecraft's sensors (PLAN-RADAR-AAA RD4): the Ranger 300 km from the ISS holds it on its rendezvous radar —
// on its LVLH axes, on the space HUD's scope —; the Lander in lunar orbit holds the Endurance 150 km ahead on its own
// radar (and, the fleet's, by the datalink). (E2E_SHOTS=<dir>: the scope.)

describe.skipIf(!E2E)("the spacecraft's sensors", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the Ranger 300 km from the ISS: held by its rendezvous radar, on the scope", async () => {
    await app.js(`(() => { __bh.settings.vessel = "ranger"; __bh.presets["Earth: docking to the ISS"].issDistance = 300000;
      __bh.game.preset("Earth: docking to the ISS"); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "ranger" && !!__bh.camera.spacePic`, 30_000);
    await app.waitFor(`__bh.camera.spacePic.tracks.some((t) => t.id === "iss")`, 15_000);
    const T = await app.js<{ range: number; sensors: number; lvlh: number[]; ref: string; hud: number }>(`(() => {
      const P = __bh.camera.spacePic, T = P.tracks.find((t) => t.id === "iss");
      return { range: T.range, sensors: T.sensors, lvlh: T.lvlh.map(Math.round), ref: P.ref, hud: (__bh.camera.flightInfo().spacePic ?? []).length }; })()`);
    console.log(`  ISS about ${T.ref}: ${(T.range / 1000).toFixed(1)} km, LVLH ${T.lvlh.join(", ")} m, sensors ${T.sensors}`);
    expect(T.ref).toBe("earth");
    expect(T.range).toBeGreaterThan(250_000);
    expect(T.range).toBeLessThan(350_000);
    expect(T.sensors & 1).toBe(1);
    expect(T.hud).toBeGreaterThan(0);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
      await Bun.sleep(2500);
      await app.shot(`${shots}/space-scope-iss.png`);
    }
  }, 120_000);

  test("the Lander in lunar orbit: the Endurance 150 km ahead held by its radar and the datalink", async () => {
    await app.js(`(() => { __bh.settings.vessel = "lander"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "lander"`, 30_000);
    // (both free: no link between them)
    await app.js(
      `(() => { const F = __bh.fleet; F.links = F.links.filter((l) => ![l.a, l.b].some((x) => x === "lander" || x === "endurance")); return 1; })()`,
    );
    await app.js(`__bh.game.orbit("moon", { altKm: 100 })`);
    await app.waitFor(`__bh.camera.spacePic?.ref === "moon"`, 15_000);
    // (the Endurance 150 km ahead on the Lander's way, coasting at its velocity about the Moon — from our own place about the Moon — the picture's —: 150 km on along our way, at our velocity)
    await app.js(`(() => { const P = __bh.camera.spacePic, M = 1.476625e11, C = 299792458, t = __bh.camera.nowTime();
      const p = P.own.p, v = P.own.v, n = Math.hypot(...v);
      __bh.fleet.free.endurance = { X: p.map((x, j) => P.refPos[j] + (x + (v[j] / n) * 150000) / M), V: v.map((x, j) => P.refVel[j] + x / C),
        ax: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t, ref: "moon" };
      return 1; })()`);
    await app.waitFor(
      `__bh.camera.spacePic?.ref === "moon" && __bh.camera.spacePic.tracks.some((t) => t.id === "endurance" && t.range < 1e6)`,
      15_000,
    );
    const T = await app.js<{ range: number; sensors: number; lvlh: number[] }>(`(() => {
      const T = __bh.camera.spacePic.tracks.find((t) => t.id === "endurance"); return { range: T.range, sensors: T.sensors, lvlh: T.lvlh.map(Math.round) }; })()`);
    console.log(`  Endurance about the Moon: ${(T.range / 1000).toFixed(1)} km, LVLH ${T.lvlh.join(", ")} m, sensors ${T.sensors}`);
    expect(T.range).toBeGreaterThan(120_000);
    expect(T.range).toBeLessThan(180_000);
    expect(T.sensors & 1).toBe(1);
    expect(T.sensors & 4).toBe(4);
    expect(T.lvlh[0]!).toBeGreaterThan(100_000);
    if (shots) {
      await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
      await Bun.sleep(2500);
      await app.shot(`${shots}/space-scope-moon.png`);
    }
  }, 120_000);
});
