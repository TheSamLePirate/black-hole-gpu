import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The HUD's runway where the runway is (PLAN-HUD H4, controller/lowthrust.ts runwayView): on a world runway well over
// the sea (Toulouse-Blagnac, LFBO, 150 m up, the geoid 50 m over the ellipsoid), 6 km out on its axis, the threshold
// the HUD draws seen as far under the horizon as the runway's own — the eye's height over it, the distance —; the view
// turned with the flight paused (its clock stopped): the outline turned with it, not left where it was. (The outline
// was drawn on the ellipsoid's 0 — 200 m under this runway, 2° low 6 km out — and its directions kept 100 ms in the
// camera's axes: behind the horizon in a roll, frozen on the screen in a pause.) E2E_SHOTS=<dir>: the final.

const SEEN = `(() => {
  const c = __bh.camera, v = c.runwayView(), u = __bh.sys.viewUp(), g = c.geoNow();
  if (!v || !u || !g) return null;
  // (the threshold's middle as the HUD has it, camera coordinates [m])
  const a = v.corners[0], b = v.corners[3];
  const P = [0, 1, 2].map((i) => (a.d[i] * a.r + b.d[i] * b.r) / 2), l = Math.hypot(...P);
  const D = 180 / Math.PI;
  const el = Math.asin((P[0] * u[0] + P[1] * u[1] + P[2] * u[2]) / l) * D;
  // (where it is: the eye's height over the runway's level — both over the sea —, the world's curve)
  const dh = g.alt - (v.site.elev ?? 0), hz = Math.sqrt(Math.max(l * l - dh * dh, 1));
  const want = (-Math.atan2(dh, hz) - hz / (2 * 6371e3)) * D;
  return { name: v.name, along: v.along, across: v.across, el, want, az: Math.atan2(P[0], P[2]) * D, dh, l };
})()`;

type Seen = { name: string; along: number; across: number; el: number; want: number; az: number; dh: number; l: number };

describe.skipIf(!E2E)("the HUD's runway on the runway", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; __bh.settings.weather = "fair"; __bh.settings.wind = 0; return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(43.76, 1.18, 1200, 143, 140); const c = __bh.camera;
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); __bh.settings.shipMount = "cockpit"; return 1; })()`);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("6 km out on LFBO's axis: the threshold where it is; the view turned in a pause, the outline with it", async () => {
    await app.waitFor(`__bh.sys.runways().some((r) => r.world?.field === "LFBO" && r.len > 3000)`, 60_000);
    // (its level measured again as the finer relief came: 20 s)
    await Bun.sleep(21_000);
    const st = await app.js<{ lat: number; lon: number; hdg: number }>(`(() => {
      const r = __bh.sys.runways().filter((r) => r.world?.field === "LFBO").sort((a, b) => b.len - a.len)[0];
      const q = r.origin.map((v, i) => v - r.along[i] * 6000);
      const A = 6378137, F = 1 / 298.257223563, B = A * (1 - F), e2 = F * (2 - F), ep2 = (A * A - B * B) / (B * B);
      const pr = Math.hypot(q[0], q[1]), th = Math.atan2(q[2] * A, pr * B), D = Math.PI / 180;
      return { lat: Math.atan2(q[2] + ep2 * B * Math.sin(th) ** 3, pr - e2 * A * Math.cos(th) ** 3) / D, lon: Math.atan2(q[1], q[0]) / D, hdg: r.site.rwy };
    })()`);
    await app.js(`(() => { __bh.game.flyAt(${st.lat}, ${st.lon}, 330, ${st.hdg}, 90); const c = __bh.camera;
      if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); return 1; })()`);
    await app.waitFor(
      `(() => { const v = __bh.camera.runwayView(); return !!v && /LFBO/.test(v.name) && Math.abs(v.across) < 60; })()`,
      30_000,
    );
    await Bun.sleep(2500);
    const a = await app.js<Seen>(SEEN);
    console.log(`  flying: ${JSON.stringify(a)}`);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.shot(`${shots}/hud-runway-final.png`);
    }
    expect(a.along).toBeLessThan(-3000);
    expect(a.dh).toBeGreaterThan(100);
    expect(Math.abs(a.el - a.want)).toBeLessThan(0.08);
    // (paused — the flight's clock stopped —, the head turned 30° right: the threshold 30° further left, still on it)
    await app.js(`(() => { __bh.game.pause(true); __bh.camera.setLook(30, 0); return 1; })()`);
    await Bun.sleep(1500);
    const b = await app.js<Seen>(SEEN);
    console.log(`  paused, looking right: ${JSON.stringify(b)}`);
    if (shots) await app.shot(`${shots}/hud-runway-look.png`);
    expect(Math.abs(Math.abs(b.az - a.az) - 30)).toBeLessThan(2);
    expect(Math.abs(b.el - b.want)).toBeLessThan(0.08);
    await app.js(`(() => { __bh.camera.setLook(0, 0); __bh.game.pause(false); return 1; })()`);
  }, 300_000);
});
