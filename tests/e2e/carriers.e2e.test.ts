import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cartToGeodetic, WGS84_A, WGS84_F } from "../../src/system/ellipsoid";
import { App, E2E, stopServer } from "./lib/app";

// The carriers (docs/PLAN-AVIATION-AAA.md, M2): first the Alps as ever (the image sound); then off Toulon the Gerald
// R. Ford set off ahead of the F-35B, steaming into the wind — seen, its wake; the F-35B set down on its deck,
// carried along at 28 kt; the Kiev and the Implacable at sea. (E2E_SHOTS=<dir>: the views.)

const SEA = { lat: 42.75, lon: 6.1 };

describe.skipIf(!E2E)("the carriers", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  // (the view around the craft set, then the world frozen: the image converges on it)
  const around = async (yaw: number, pitch: number, dist: number) => {
    await app.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(300);
    await app.js(`(() => { Object.assign(__bh.camera.outside, { yaw: ${yaw}, pitch: ${pitch}, dist: ${dist} }); return 1; })()`);
    await Bun.sleep(700);
    await app.js(`(__bh.freeze(true), 1)`);
    await Bun.sleep(600);
  };
  const thaw = () => app.js(`(__bh.freeze(false), 1)`);
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
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("off Toulon the Ford set off ahead, into the wind: seen, its wake; on the radar, friendly", async () => {
    await app.js(
      // (late in the afternoon: the shadows long — the craft's on the deck, the island's, the hull's on the sea)
      `(() => { __bh.game.setDate("2026-07-10T16:30:00Z"); Object.assign(__bh.settings, { wind: 2, earthClouds: 1 });
        __bh.game.flyAt(${SEA.lat}, ${SEA.lon}, 300, 20, 140); return 1; })()`,
    );
    await Bun.sleep(1500);
    await app.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    const said = await app.js<string>(`__bh.camera.carrierSpawn("ford")`);
    console.log(`  ${said}`);
    expect(said).toContain("Gerald R. Ford");
    await app.waitFor(`__bh.camera.radar.tracks.has("cv:ford")`, 20_000);
    expect(await app.js<string>(`__bh.camera.radar.tracks.get("cv:ford").iff`)).toBe("friend");
    await Bun.sleep(1000);
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await shot("ford-ahead");
  }, 120_000);

  test("the F-35B set down on the Ford's deck aft of its island: carried along at 28 kt, where it was set, as it was set — whatever the view", async () => {
    // (the deck's map in: the craft set on it, 10° to port)
    await app.waitFor(`__bh.camera.carrierLand("ford", { x: 10, z: -40, facing: -10 }).startsWith("On")`, 30_000);
    // (its place on the deck [m], its heading on it [°, to starboard +] and its top's tilt off the deck's normal [°])
    const where = `(() => { const c = __bh.camera, P = c.carrierNow()[0].P, o = c.netOwn(), d = [0,1,2].map((i) => o.p[i] - P.p[i]);
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      return [dot(d, P.port), dot(d, P.up), dot(d, P.bow), Math.atan2(-dot(o.fwd, P.port), dot(o.fwd, P.bow)) * 180 / Math.PI, Math.acos(Math.min(1, dot(o.up, P.up))) * 180 / Math.PI]; })()`;
    const w0 = await app.js<number[]>(where);
    // (the views changed on it: the camera's rig moves about the craft, the craft stays — it whirled, carried as the camera)
    let worst = 0;
    for (const mount of ["chase", "around", "cockpit"]) {
      await app.js(`(() => { __bh.settings.shipMount = "${mount}"; return 1; })()`);
      for (let k = 0; k < 6; k++) {
        await Bun.sleep(250);
        const w = await app.js<number[]>(where);
        worst = Math.max(worst, Math.abs(w[3]! + 10), w[4]!);
      }
    }
    const w1 = await app.js<number[]>(where);
    const drift = Math.hypot(w1[0]! - w0[0]!, w1[2]! - w0[2]!);
    console.log(
      `  on the deck 4.5 s at 28 kt, three views: ${drift.toFixed(2)} m from where it was set; its heading ${w1[3]!.toFixed(1)}° (set −10°), tilt ${w1[4]!.toFixed(1)}°, ${worst.toFixed(1)}° off at worst; landed ${await app.js<boolean>("__bh.camera.landed")}`,
    );
    expect(drift).toBeLessThan(1);
    expect(worst).toBeLessThan(0.5);
    await around(140, 18, 70);
    await shot("ford-deck");
    await thaw();
    await around(215, 22, 380);
    await shot("ford-whole");
    await thaw();
    // (low over the sea abeam: the hull, the island and the craft mirrored in it)
    await around(250, 2, 450);
    await shot("ford-sea");
    await thaw();
    // (and in a calm: its image whole, a few bands)
    await app.js(`(() => { __bh.settings.wind = 0; return 1; })()`);
    await Bun.sleep(2000);
    await app.js(`(__bh.freeze(true), 1)`);
    await Bun.sleep(600);
    await shot("ford-sea-calm");
    await thaw();
    await app.js(`(() => { __bh.settings.wind = 2; return 1; })()`);
  }, 120_000);

  test("on the Ford's final, 1.2 km out on its glide path: its deck ahead, the meatball centred", async () => {
    // (from the cockpit — in the chase view the jet hides the deck below its nose —, set before: frozen, a view's
    // rig does not move)
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(500);
    const said = await app.js<string>(`__bh.camera.carrierFinal("ford", 1200)`);
    console.log(`  ${said}`);
    expect(said).toContain("final");
    await Bun.sleep(300);
    await app.js(`(__bh.freeze(true), 1)`);
    await Bun.sleep(600);
    await shot("ford-final");
    await thaw();
  }, 120_000);

  test("at night, on its final: its deck's edge and centreline lights, the meatball and its datum", async () => {
    await app.js(
      `(() => { __bh.camera.carrierClear(); __bh.game.setDate("2026-07-10T21:30:00Z"); __bh.game.flyAt(${SEA.lat}, ${SEA.lon}, 300, 20, 140); return 1; })()`,
    );
    await Bun.sleep(1000);
    await app.js(`__bh.camera.carrierSpawn("ford")`);
    await Bun.sleep(300);
    expect(await app.js<string>(`__bh.camera.carrierFinal("ford", 900)`)).toContain("final");
    await Bun.sleep(300);
    await app.js(`(__bh.freeze(true), 1)`);
    await Bun.sleep(800);
    await shot("ford-night");
    await thaw();
    // (the day back, on the final, 50 m over the sea: the hour changed, the flight does not — the craft over the same
    // sea at the same height and speed, the carrier where it was — the Earth turned under a craft carried in space,
    // it met the water)
    // (its place on the Earth [m] — WGS84 —, its speed over the ground [m/s], the carrier's distance [m])
    const state = async () => {
      const r = await app.js<number[][]>(
        `(() => { const c = __bh.camera, P = c.carrierNow()[0].P, o = c.netOwn(); return [o.p, o.v, P.p]; })()`,
      );
      const g = cartToGeodetic(WGS84_A, WGS84_F, r[0] as [number, number, number]);
      return [
        (g.lat * 180) / Math.PI,
        (g.lon * 180) / Math.PI,
        g.h,
        Math.hypot(...r[1]!),
        Math.hypot(...[0, 1, 2].map((i) => r[0]![i]! - r[2]![i]!)),
      ];
    };
    await app.js(`(__bh.freeze(true), 1)`);
    const a = await state();
    await app.js(`(() => { __bh.game.setDate("2026-07-10T16:30:00Z"); return 1; })()`);
    // (a frame for the craft's clock to follow the scene's)
    await app.waitFor(`!!__bh.camera.netOwn()`, 5_000);
    const b = await state();
    await thaw();
    await Bun.sleep(1500);
    const lost = await app.js<boolean>(`__bh.camera.landed`);
    console.log(
      `  the clock 5 h back on the final: ${(Math.hypot(b[0]! - a[0]!, (b[1]! - a[1]!) * Math.cos((a[0]! * Math.PI) / 180)) * 111_320).toFixed(2)} m over the sea from where it was, ${(b[2]! - a[2]!).toFixed(2)} m higher, ${(b[3]! - a[3]!).toFixed(2)} m/s faster; the carrier ${(b[4]! - a[4]!).toFixed(2)} m nearer; 1.5 s on: landed ${lost}`,
    );
    expect(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) * 111_320).toBeLessThan(1);
    expect(Math.abs(b[2]! - a[2]!)).toBeLessThan(0.5);
    expect(Math.abs(b[3]! - a[3]!)).toBeLessThan(0.5);
    expect(Math.abs(b[4]! - a[4]!)).toBeLessThan(1);
    expect(lost).toBe(false);
  }, 120_000);

  test("the Kiev and the Implacable at sea", async () => {
    for (const k of ["kiev", "implacable"] as const) {
      await app.js(`(() => { __bh.camera.carrierClear(); __bh.game.flyAt(${SEA.lat}, ${SEA.lon}, 300, 20, 140); return 1; })()`);
      await Bun.sleep(600);
      await app.js(`__bh.camera.carrierSpawn("${k}")`);
      await app.waitFor(`__bh.camera.carrierLand("${k}", { x: 0, z: -30 }).startsWith("On")`, 30_000);
      await around(215, 22, k === "kiev" ? 260 : 210);
      await shot(`${k}-whole`);
      await thaw();
    }
  }, 180_000);
});
