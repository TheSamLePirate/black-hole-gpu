import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The gun's sight in the game (docs/PLAN-AVIATION-AAA.md, C3): the drone hunt, BQM-1 locked, the F-35 put 450 m
// behind it on its track; the sight's reticle on where to shoot (its turn led), its range bar and IN RANGE; Space
// held: the funnel and the tracers. (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the F-35's gun sight", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.wind = 0; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("450 m behind the drone: the reticle on where to shoot, its range, IN RANGE; Space: the funnel, the tracers", async () => {
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.click(`[data-testid="chp-fight-drones"]`);
    await app.waitFor(`__bh.camera.radar.tracks.size >= 3`, 10_000);
    await app.press("Tab");
    await Bun.sleep(300);
    // (put behind the lock on its track, at its height, a little faster: its east, north, up the fight's)
    const at = await app.js<string>(`(() => {
      const C = __bh.camera.combat, W = C.world, q = W.target(W.lock), a = C.def.anchor;
      const h = Math.hypot(q.v[0], q.v[1]), e = q.p[0] - (q.v[0] / h) * 450, n = q.p[1] - (q.v[1] / h) * 450;
      const lat = a.lat + n / 111195, lon = a.lon + e / (111195 * Math.cos(a.lat * Math.PI / 180));
      // (the nose on where it will be in 3 s: it turns)
      const f = [q.p[0] + q.v[0] * 3 - e, q.p[1] + q.v[1] * 3 - n];
      const hdg = (Math.atan2(f[0], f[1]) * 180 / Math.PI + 360) % 360;
      __bh.settings.shipMount = "cockpit";
      __bh.game.flyAt(lat, lon, q.p[2] - W.groundZ(e, n), hdg, h + 15);
      return q.name + " " + hdg.toFixed(0) + "°";
    })()`);
    console.log(`  behind ${at}`);
    // (placed: the radar starts again — the nearest locked, the drone ahead)
    await app.waitFor(`__bh.camera.radar.tracks.size >= 1 && __bh.camera.airFlight.inAir`, 15_000);
    // (its speed held; the scenery's first arrival let settle)
    await app.js(`(() => { const c = __bh.camera; if (c.jetModes.spd === null) c.jetToggle("athr"); return 1; })()`);
    await Bun.sleep(3000);
    // (the nose put on it again from where we are: the placing's own error, its turn meanwhile)
    await app.js(`(() => {
      const c = __bh.camera, C = c.combat, P = C.last, q = C.world.target(C.world.lock) ?? C.world.targets.find((x) => x.name === "BQM-1");
      const f = [q.p[0] + q.v[0] * 2 - P.p[0], q.p[1] + q.v[1] * 2 - P.p[1]];
      const g = c.geoNow();
      __bh.game.flyAt(g.lat, g.lon, q.p[2] - C.world.groundZ(P.p[0], P.p[1]), (Math.atan2(f[0], f[1]) * 180 / Math.PI + 360) % 360, Math.hypot(q.v[0], q.v[1]) + 15);
      return 1;
    })()`);
    await Bun.sleep(1500);
    if (!(await app.js<boolean>(`!!__bh.camera.radar.lock`))) await app.press("Tab");
    await app.waitFor(`!!__bh.camera.combatHud((v) => v)?.gun`, 15_000);
    await Bun.sleep(500);
    const G = await app.js<{ range: number; tof: number; inRange: boolean }>(`__bh.camera.combatHud((v) => v)?.gun`);
    console.log(`  range ${G.range.toFixed(0)} m, flight ${G.tof.toFixed(2)} s, in range ${G.inRange}`);
    expect(G.inRange).toBe(true);
    await shot("gun-sight");
    let seen = { funnel: 0, tracers: 0 };
    await app.hold("Space", 1200, async () => {
      seen = await app.js<{ funnel: number; tracers: number }>(
        `(() => { const K = __bh.camera.combatHud((v) => v); return { funnel: K.funnel.length, tracers: K.tracers.length }; })()`,
      );
      await shot("gun-firing");
    });
    console.log(`  firing: the funnel ${seen.funnel} points, ${seen.tracers} tracers`);
    expect(seen.funnel).toBeGreaterThan(5);
    expect(seen.tracers).toBeGreaterThan(0);
  }, 120_000);
});
