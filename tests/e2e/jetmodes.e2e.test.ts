import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The F-35's new autopilot modes (docs/PLAN-AVIATION-AAA.md, A3): first the Alps as ever; then the terrain following
// at 150 m down the Arve's valley toward Chamonix — the real relief —; an orbit over the Mont Blanc; the tanker set,
// joined to its pre-contact slot. (Measured headless: tests/jetmodes.test.ts.) (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the autopilot's new modes", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const around = async (yaw: number, pitch: number, dist: number) => {
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(300);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: ${pitch}, dist: ${dist} }); return 1; })()`);
    await Bun.sleep(900);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0, f35Variant: "B", f35Assist: "realistic" });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("terrain following at 150 m up the Arve toward Chamonix: the valley followed", async () => {
    // (over Sallanches, heading up the valley — east-south-east —, 300 m over it)
    await app.js(`(() => { __bh.game.flyAt(45.94, 6.63, 300, 105, 200); __bh.fleet.fuel.f35 = 5000; return 1; })()`);
    await Bun.sleep(1000);
    await app.js(
      `(() => { const c = __bh.camera; c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("athr"); return c.tfStart(150); })()`,
    );
    let lo = Infinity,
      hi = 0;
    for (let i = 0; i < 40; i++) {
      await Bun.sleep(500);
      const agl = await app.js<number>(
        `(() => { const g = __bh.camera.geoNow(); return g.alt - __bh.camera.radarFix().own.alt + __bh.camera.radarFix().own.agl; })()`,
      );
      if (i > 8) (lo = Math.min(lo, agl)), (hi = Math.max(hi, agl));
      if (i === 20) {
        await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
        await Bun.sleep(800);
        await shot("tf-cockpit");
      }
    }
    await around(160, 6, 60);
    await shot("tf-valley");
    const failed = await app.js<boolean>(`!!__bh.camera.airFlight.failure`);
    console.log(`  terrain following: ${lo.toFixed(0)}–${hi.toFixed(0)} m over the ground`);
    expect(failed).toBe(false);
    expect(lo).toBeGreaterThan(60);
    await app.js(`(() => { __bh.camera.tfStart(null); return 1; })()`);
  }, 120_000);

  test("an orbit over the Mont Blanc", async () => {
    await app.js(`(() => { __bh.game.flyAt(45.80, 6.80, 1500, 0, 200); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt); c.jetToggle("athr");
      return c.orbitStart({ lat: 45.8326, lon: 6.8652, radius: 5000, dir: 1 }); })()`);
    await Bun.sleep(30_000);
    const r = await app.js<number>(
      `(() => { const g = __bh.camera.geoNow(), D = Math.PI / 180; return Math.hypot((g.lon - 6.8652) * D * 6371008.8 * Math.cos(45.83 * D), (g.lat - 45.8326) * D * 6371008.8); })()`,
    );
    await around(270, 25, 120);
    await shot("orbit");
    console.log(`  orbiting the Mont Blanc at ${r.toFixed(0)} m`);
    expect(Math.abs(r - 5000)).toBeLessThan(600);
    await app.js(`(() => { __bh.camera.modesOff(); return 1; })()`);
  }, 120_000);

  test("the tanker: set, joined to its pre-contact slot", async () => {
    await app.js(
      `(() => { __bh.game.flyAt(43.3, 6.0, 6500, 90, 230); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt); c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("athr"); return 1; })()`,
    );
    await Bun.sleep(800);
    console.log(`  ${await app.js<string>(`__bh.camera.tankerStart()`)}`);
    await app.waitFor(`!!__bh.camera.icpt`, 10_000);
    // (brought 3 km behind it, at its height and speed — the rendezvous's last minutes)
    await app.js(`(() => { const C = __bh.camera.combat, A = C.def.anchor, q = C.world.targets[0], D = Math.PI / 180, R = 6371008.8;
      const h = Math.atan2(q.v[0], q.v[1]), e = q.p[0] - Math.sin(h) * 3000, n = q.p[1] - Math.cos(h) * 3000;
      __bh.game.flyAt(A.lat + n / (D * R), A.lon + e / (D * R * Math.cos(A.lat * D)), q.p[2] - C.world.groundZ(e, n), h / D, 230);
      // (the placing let the intercept go: the rendezvous engaged again)
      __bh.camera.jetModes.alt = Math.round(__bh.camera.geoNow().alt); __bh.camera.jetToggle("athr"); __bh.camera.tankerPending = q.id; return 1; })()`);
    await app.waitFor(`__bh.camera.icpt?.phase === "shadow"`, 120_000);
    await Bun.sleep(4000);
    await around(200, 8, 45);
    await shot("tanker");
    const d = await app.js<number>(
      `(() => { const C = __bh.camera.combat, q = C.world.targets[0], P = C.last; return Math.hypot(q.p[0] - P.p[0], q.p[1] - P.p[1], q.p[2] - P.p[2]); })()`,
    );
    console.log(`  pre-contact: ${d.toFixed(0)} m from the tanker`);
    expect(d).toBeLessThan(90);
  }, 200_000);
});
