import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import {
  AXIS_PILOT_OFF,
  AXIS_PILOT_ON,
  AXIS_WATCH_READ,
  AXIS_WATCH_START,
  type AxisWatch,
  axisWatchProblems,
  expectFlightPhase,
} from "./lib/flight-state";
import { HELD } from "./lib/held";

// PLAN-A320 A13 (the air and the ground): the A320 at Le Bourget, seen from outside — a humid approach in CONF FULL (the
// wing's vapour, the tip and flap-edge vortices); take-off power on the ground in humid air (the inlet vortices, the
// exhausts' heat haze); a touchdown at speed (the tyres' smoke); the take-off roll and the reversers on a wet runway
// (the spray). Each shot taken once the trails are there (the controller's segments), the frame rate with and without.

const shots = process.env.E2E_SHOTS;
const shot = (app: App, name: string) => (shots ? app.shot(`${shots}/${name}.png`) : Promise.resolve());

describe.skipIf(!E2E)("the A320's air and ground effects", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(() => {
      __bh.settings.vessel = "a320";
      __bh.settings.a320Start = "ready";
      __bh.settings.weather = "overcast";
      __bh.settings.wind = 0;
      __bh.refresh();
      __bh.game.setDate("2067-06-01T10:30:00");
      __bh.game.lineUp("Paris – Le Bourget");
      __bh.settings.shipMount = "quarter";
      __bh.refresh();
      return true;
    })()`);
    await app.waitFor("!!__bh.camera.a320Sys", 60_000);
    // (the scene's tracer in, on its progress — not the pill's text: on a still scene it stayed up, 240 s lost each run, 14 Nov 2026)
    await app.settled(60_000);
    await Bun.sleep(3000);
  }, 400_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** the trails' segments of a kind now (the controller's — contrails.ts) */
  const segs = (kind: number) =>
    app.js<number>(`(() => {
      let n = 0;
      for (const t of __bh.camera.contrails.trails) if (t.kind === ${kind}) n += t.pts.length;
      return n;
    })()`);

  test("take-off power on the ground in humid air: the inlet vortices, the heat haze", async () => {
    await app.js(`(() => {
      const c = __bh.camera;
      c.a320Park = true;
      c.pilot.throttle = 1;
      __bh.settings.shipMount = "belly"; __bh.settings.shipLookYaw = -50; __bh.settings.shipLookPitch = 0; __bh.refresh();
      return true;
    })()`);
    await app.waitFor(`__bh.camera.a320.engines[0].n1 > 80`, 30_000);
    await Bun.sleep(2500);
    const cols = await app.js<number>(`__bh.camera.contrails.trails.filter((t) => t.key.startsWith("a320i")).length`);
    console.log(`  inlet vortices: ${cols}`);
    expect(cols).toBe(2);
    await shot(app, "a320-fx-inlet");
    await app.js(
      `(__bh.settings.shipMount = "chase", __bh.settings.shipLookYaw = 0, __bh.settings.shipLookPitch = -4, __bh.refresh(), true)`,
    );
    await Bun.sleep(2500);
    await shot(app, "a320-fx-haze");
    await app.js(`(__bh.camera.pilot.throttle = 0, true)`);
  }, 120_000);

  test("a humid approach in CONF FULL: the wing's vapour, the vortices", async () => {
    const r = await app.js<{ fpsOn: number; fpsOff: number }>(`(async () => {
      const c = __bh.camera;
      __bh.game.flyAt(48.90, 2.44, 350, 270, 66); ${HELD}
      c.gearDown = true; c.gearExt = 1; c.gearInit = true;
      c.airFlight.cfg.flaps = 1;
      c.pilot.throttle = 0.55;
      __bh.settings.shipMount = "quarter"; __bh.settings.shipLookYaw = 0; __bh.settings.shipLookPitch = 0; __bh.refresh();
      await new Promise((ok) => setTimeout(ok, 500));
      c.a320.surfaces.slat = 27; c.a320.surfaces.flap = 40;
      // (a pull: the lift up)
      const input = c.pilotInput.bind(c);
      c.pilotInput = (pad) => ({ ...input(pad), pitch: 0.5 });
      await new Promise((ok) => setTimeout(ok, 2500));
      const fpsOn = Number((document.body.innerText.match(/(\\d+) fps/) ?? [0, 0])[1]);
      c.pilotInput = input;
      return { fpsOn, fpsOff: 0 };
    })()`);
    const sheet = await segs(9);
    const thr = await segs(3);
    console.log(`  vapour points ${sheet}, vortex points ${thr}; ${r.fpsOn.toFixed(0)} fps`);
    expect(sheet + thr).toBeGreaterThan(10);
    await shot(app, "a320-fx-vapour");
    await app.js(`(__bh.settings.shipMount = "chase", __bh.refresh(), true)`);
    await Bun.sleep(1200);
    await shot(app, "a320-fx-vortices");
  }, 120_000);

  test("a touchdown at speed: the tyres' smoke", async () => {
    const r = await app.js<{ smoke: number }>(`(async () => {
      const c = __bh.camera;
      __bh.game.lineUp("Paris – Le Bourget", 900);
      await new Promise((ok) => setTimeout(ok, 800));
      const g = c.geoNow();
      const hdg = (c.attitudeNow().heading * 180) / Math.PI;
      __bh.game.flyAt(g.lat, g.lon, 1.5, hdg, 66);
      c.gearDown = true; c.gearExt = 1; c.gearInit = true;
      c.airFlight.cfg.flaps = 1;
      c.pilot.throttle = 0;
      __bh.settings.shipMount = "quarter"; __bh.settings.shipLookYaw = 0; __bh.settings.shipLookPitch = -6; __bh.settings.fov = 24; __bh.refresh();
      let smoke = 0;
      for (let k = 0; k < 120 && !smoke; k++) {
        await new Promise((ok) => setTimeout(ok, 50));
        smoke = c.contrails.trails.filter((t) => t.kind === 8).length;
      }
      await new Promise((ok) => setTimeout(ok, 350));
      return { smoke };
    })()`);
    console.log(`  tyre smoke trails: ${r.smoke}`);
    expect(r.smoke).toBeGreaterThan(0);
    await shot(app, "a320-fx-touchdown");
    await app.js(`(__bh.settings.fov = 60, __bh.refresh(), true)`);
  }, 120_000);

  test("a wet runway: the spray of the roll, the reversers'", async () => {
    await app.js(`(() => {
      __bh.settings.weather = "rain"; __bh.refresh();
      __bh.game.lineUp("Paris – Le Bourget");
      __bh.settings.shipMount = "quarter"; __bh.refresh();
      return true;
    })()`);
    // (rule 13 of E2E-VOLS: lined up on the axis before the power, held on it through the roll — Sam, 16 Nov 2026: an A320 seen off
    // the axis at its take-off)
    await app.waitFor("!!__bh.camera.a320Sys", 30_000);
    await expectFlightPhase(app, "lineup", { ap: false, athr: false }, "lined up, wet");
    // (the rain's wind, 8 m/s gusting 14 from 334°, right across the 25: a pilot's feet keep it on the axis — nobody on the rudder,
    // the A320 weathervaned 5.9° into it and rolled 12.9 m off the centreline by 45 m/s, kerr-mini 16 Nov 2026)
    await app.js(AXIS_PILOT_ON);
    await app.js(AXIS_WATCH_START);
    await app.js(`(() => { const c = __bh.camera; c.a320Park = false; c.pilot.throttle = 1; return true; })()`);
    await app.waitFor(`(__bh.camera.geoNow()?.gs ?? 0) > 45`, 60_000);
    const axis = await app.js<AxisWatch>(AXIS_WATCH_READ);
    await app.js(AXIS_PILOT_OFF);
    console.log(
      `  the wind on the runway: ${await app.js<string>(`JSON.stringify(__bh.camera.runwayView()?.wind ?? null)`)}; the roll (t s, gs, hdg°, trk°, across m, along m, engine) each second:`,
    );
    for (const r of axis.rows.filter((_, i) => i % 10 === 0)) console.log(`    ${JSON.stringify(r)}`);
    console.log(
      `  the roll's axis: heading ${axis.worstHdg.toFixed(2)}°, across ${axis.worstAcross.toFixed(1)} m at worst (runway ${axis.des}, ${axis.rolled} samples)`,
    );
    expect(axisWatchProblems(axis)).toEqual([]);
    await Bun.sleep(600);
    const spray = await segs(7);
    console.log(`  spray points rolling: ${spray}`);
    expect(spray).toBeGreaterThan(4);
    await shot(app, "a320-fx-spray");
    await app.js(`(() => { const c = __bh.camera; c.pilot.throttle = 0; c.a320ReverseToggle(); return true; })()`);
    await Bun.sleep(4000);
    const rev = await app.js<number>(`__bh.camera.contrails.trails.filter((t) => t.key.startsWith("a320r")).length`);
    console.log(`  reversers' spray trails: ${rev}`);
    expect(rev).toBeGreaterThan(0);
    await shot(app, "a320-fx-reversers");
  }, 150_000);
});
