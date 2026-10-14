import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// A camera set on the Earth's ground stays there, its look held on the ground, whatever the time warp: the tripod
// (a ship flying on in orbit, or none), the walker's tripod, the free camera carried by the ground — read where the
// frame is drawn (the scene's clock), at ×1 then ×1000.

describe.skipIf(!E2E)("a camera on the ground at time warp", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1000, height: 700, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** The view where the frame is drawn: its geodetic place [°, m] and its look's azimuth and altitude [°]. */
  const view = `(() => {
    const v = __bh.camera.viewController(), w = v.rigWorld(), t = __bh.sim.time, S = __bh.sys;
    const q = S.bodyFixed("earth", w.X, t), f = S.bodyFixed("earth", w.X.map((x, i) => x + w.fwd[i] * 1e-7), t);
    const d = f.map((x, i) => x - q[i]), D = Math.PI / 180;
    const p = Math.hypot(q[0], q[1]), lon = Math.atan2(q[1], q[0]);
    // (the geodetic latitude, WGS84, a few iterations)
    const a = 6378137 / (1476.625 * __bh.settings.massSolar), e2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
    let lat = Math.atan2(q[2], p * (1 - e2));
    for (let k = 0; k < 5; k++) { const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); lat = Math.atan2(q[2] + e2 * N * Math.sin(lat), p); }
    const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    const east = [-Math.sin(lon), Math.cos(lon), 0], north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], n = Math.hypot(...d);
    return { lat: lat / D, lon: lon / D, alt: Math.asin(dot(d, up) / n) / D, az: Math.atan2(dot(d, east), dot(d, north)) / D, t };
  })()`;
  type View = { lat: number; lon: number; alt: number; az: number; t: number };
  const metres = (a: View, b: View) => Math.hypot((b.lat - a.lat) * 111_200, (b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
  const tars = (name: string, args: object) =>
    app.js(`__bh.tars.tools().find((t) => t.name === ${JSON.stringify(name)}).run(${JSON.stringify(args)}, new AbortController().signal)`);

  /** The view sampled at ×1 then ×1000: the most it moved [m] and turned [°] from where it was set. */
  async function held(label: string) {
    await app.js(`(() => { __bh.game.realTime(); __bh.game.pause(false); return 1; })()`);
    await Bun.sleep(1500);
    const v0 = await app.js<View>(view);
    let move = 0,
      turn = 0,
      span = 0;
    for (const warp of [1, 1000]) {
      await app.js(`(() => { __bh.game.warp(${warp}); return 1; })()`);
      for (let i = 0; i < 12; i++) {
        await Bun.sleep(250);
        const v = await app.js<View>(view);
        move = Math.max(move, metres(v0, v));
        turn = Math.max(turn, Math.abs(v.alt - v0.alt), Math.abs(((v.az - v0.az + 540) % 360) - 180));
        span = v.t - v0.t;
      }
    }
    await app.js(`(() => { __bh.game.realTime(); return 1; })()`);
    console.log(`  ${label}: moved ${move.toFixed(2)} m, turned ${turn.toFixed(4)}° over ${span.toFixed(2)} M of scene`);
    return { move, turn };
  }

  test("the tripod, the ship flying on in orbit: held on its ground", async () => {
    await tars("place_ship", { mode: "orbit", body: "earth", altKm: 400 });
    await Bun.sleep(1500);
    expect(await tars("atlas", { action: "go", lat: 48.8582599, lon: 2.2945006, to: "tripod", body: "earth" })).toBeTruthy();
    await Bun.sleep(2500);
    const r = await held("tripod, ship in orbit");
    expect(r.move).toBeLessThan(1);
    expect(r.turn).toBeLessThan(0.01);
  }, 90_000);

  test("the tripod turned by the player at ×10 000: the new look held on the ground, not on the stars", async () => {
    await app.js(`(() => { __bh.game.warp(10000); return 1; })()`);
    await Bun.sleep(800);
    // (a turn of the view — what a drag does: its yaw and pitch written outside the rig)
    await app.js(`(() => { const s = __bh.camera.viewController().s; s.yaw += 25; s.pitch += 10; return 1; })()`);
    await Bun.sleep(600);
    const v0 = await app.js<View>(view);
    let turn = 0,
      move = 0;
    for (let i = 0; i < 12; i++) {
      await Bun.sleep(250);
      const v = await app.js<View>(view);
      move = Math.max(move, metres(v0, v));
      turn = Math.max(turn, Math.abs(v.alt - v0.alt), Math.abs(((v.az - v0.az + 540) % 360) - 180));
    }
    await app.js(`(() => { __bh.game.realTime(); return 1; })()`);
    console.log(`  tripod turned at ×10 000: moved ${move.toFixed(2)} m, turned ${turn.toFixed(4)}° after`);
    expect(move).toBeLessThan(1);
    expect(turn).toBeLessThan(0.01);
  }, 60_000);

  test("the free camera above the ground: carried by it", async () => {
    await tars("atlas", { action: "go", lat: 45.8326, lon: 6.8652, to: "camera", body: "earth" });
    await Bun.sleep(2500);
    const r = await held("free camera, 3 km over the Alps");
    expect(r.move).toBeLessThan(1);
    expect(r.turn).toBeLessThan(0.01);
  }, 90_000);

  test("on foot, standing: held where he stands (his own place — his camera keeps clear of what it meets)", async () => {
    // (the Champ de Mars' lawn: open ground, nothing for the shoulder's camera to keep clear of)
    await tars("place_ship", { mode: "walk", query: "48.8556, 2.2986" });
    await Bun.sleep(3000);
    expect(await app.js<boolean>(`__bh.camera.character.active`)).toBe(true);
    const at = `(() => { const p = __bh.camera.character.place(); return { lat: p.lat, lon: p.lon, alt: 0, az: 0, t: __bh.sim.time }; })()`;
    await Bun.sleep(1500);
    const p0 = await app.js<View>(at);
    let move = 0;
    for (const warp of [1, 1000]) {
      await app.js(`(() => { __bh.game.warp(${warp}); return 1; })()`);
      for (let i = 0; i < 12; i++) {
        await Bun.sleep(250);
        move = Math.max(move, metres(p0, await app.js<View>(at)));
      }
    }
    await app.js(`(() => { __bh.game.realTime(); return 1; })()`);
    console.log(`  on foot: his place moved ${move.toFixed(3)} m`);
    expect(move).toBeLessThan(0.1);
  }, 90_000);
});
