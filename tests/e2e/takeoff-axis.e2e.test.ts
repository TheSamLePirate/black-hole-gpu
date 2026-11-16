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

// The runway's axis at the take-off (Sam, 16 Nov 2026: « pendant le décollage de l'A320, l'avion n'était pas bien aligné avec la
// piste »; E2E-VOLS rule 13, 44a6606d): the A320 and the F-35 lined up (`__bh.game.lineUp`, named, or none: the nearest runway), the
// heading's error to the runway's and the distance across its centreline read at rest, at the power's application, then each tenth of
// a second through the roll to the rotation's speed (the A320 TOGA in CONF 1+F, to 69 m/s; the F-35 at full dry thrust, to 75 m/s),
// nobody on the rudder in calm air; in the rain's crosswind (8 m/s gusting 14) a pilot's feet on it (lib/flight-state.ts AXIS_PILOT_ON —
// without, the A320 weathervanes: a320-effects). The date 10 Jul 2026, 40 years before the game's clock's epoch: before 16 Nov 2026 its
// rounding let a rolling craft slip 0.2–0.4 m/s against the Earth (8.2 m off Edwards's axis by VR — controller/motion.ts).
// Captures (TA_SHOTS=<dir>): the cockpit at the line-up, outside in the roll.
// Done when: every line-up within 1° and 3 m of the axis, every roll within 3° and 6 m to the rotation (lib/flight-state.ts AXIS_LIMITS).
// Duration: about 4 min (six rolls of ~30 s, real time; Le Bourget's and Edwards's tiles).

const SHOTS = process.env.TA_SHOTS;

describe.skipIf(!E2E)("the runway's axis at the take-off", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(
      `(() => { Object.assign(__bh.settings, { traffic: false, damage: false, weather: "fair", wind: 0 }); __bh.game.setDate("2026-07-10T09:00:00Z"); return 1; })()`,
    );
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** the craft made active, lined up (`where`: a runway's name, or null — the nearest), its data in, frozen meanwhile */
  const lineUp = async (craft: "a320" | "f35", where: string | null, label: string) => {
    await app.js(
      `(() => { __bh.settings.vessel = "${craft}"; ${craft === "a320" ? `__bh.settings.a320Start = "ready";` : ""} return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "${craft}"`, 30_000);
    const said = await app.js<string>(
      `(() => { __bh.freeze(true); const s = __bh.game.lineUp(${where ? JSON.stringify(where) : ""}); for (let i = 0; i < 5; i++) __bh.step(1 / 30); return s; })()`,
    );
    if (craft === "a320") await app.waitFor("!!__bh.camera.a320Sys", 30_000);
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; __bh.refresh(); return 1; })()`);
    await app.settled(60_000).catch(() => {});
    await app.js(`(() => { __bh.freeze(false); return 1; })()`);
    await Bun.sleep(800);
    console.log(`  ${label}: ${said}`);
    if (SHOTS) {
      await Bun.$`mkdir -p ${SHOTS}`;
      await app.shot(`${SHOTS}/${label}-lineup.png`);
    }
    return expectFlightPhase(app, "lineup", { ap: false, athr: false }, `${label}, lined up`).catch((e) => {
      console.log(`  ✗ ${String(e).slice(0, 400)}`);
      return null;
    });
  };

  /** the power applied, nobody on the rudder; the axis watched to the rotation's speed; the throttle back, the brakes */
  const roll = async (craft: "a320" | "f35", label: string, vr: number, feet = false) => {
    if (feet) await app.js(AXIS_PILOT_ON);
    await app.js(AXIS_WATCH_START);
    await app.js(`(() => { const c = __bh.camera;
      ${craft === "a320" ? "c.airFlight.cfg.flaps = 0.25; c.a320Park = false;" : ""}
      c.pilot.throttle = 1; return 1; })()`);
    await Bun.sleep(1500);
    const at = await expectFlightPhase(app, "roll", { ap: false, athr: false }, `${label}, the power on`).catch((e) => {
      console.log(`  ✗ ${String(e).slice(0, 400)}`);
      return null;
    });
    await app.js(`(() => { __bh.settings.shipMount = "chase"; __bh.settings.shipLookPitch = -6; __bh.refresh(); return 1; })()`);
    let shot = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      const v = await app.js<number>(`__bh.camera.airFlight.last?.speed ?? __bh.camera.geoNow()?.gs ?? 0`);
      if (SHOTS && !shot && v > vr * 0.6) {
        await app.shot(`${SHOTS}/${label}-roll.png`);
        shot = true;
      }
      if (v >= vr) break;
      await Bun.sleep(200);
    }
    const w = await app.js<AxisWatch>(AXIS_WATCH_READ);
    await app.js(AXIS_PILOT_OFF);
    if (!w.rolled && craft === "a320")
      console.log(
        `  ${label}, no roll — the A320: ${await app.js<string>(`(() => { const c = __bh.camera; return JSON.stringify({ lever: c.pilot.throttle, park: c.a320Park, engines: (c.a320?.engines ?? []).map((e) => Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v !== "object").slice(0, 8))), fail: c.a320Fail?.active?.() ?? null, pilot: c.pilot.auto, landed: !!c.ourLanded, rolling: !!c.rolling }).slice(0, 900); })()`)}`,
      );
    await app.js(`(() => { const c = __bh.camera; c.pilot.throttle = 0; __bh.settings.shipLookPitch = 0; __bh.refresh(); return 1; })()`);
    const every = w.rows.filter((_, i) => i % 10 === 0);
    console.log(`  ${label} roll (t s, gs, hdg°, trk°, across m, along m, engine) every second:`);
    for (const r of every) console.log(`    ${JSON.stringify(r)}`);
    console.log(
      `  ${label}: worst in the roll — heading ${w.worstHdg.toFixed(2)}°, track ${w.worstTrk.toFixed(2)}°, across ${w.worstAcross.toFixed(1)} m (${w.rolled} samples, runway ${w.des})`,
    );
    return { at, w, problems: axisWatchProblems(w) };
  };

  const results: { label: string; problems: string[] }[] = [];
  const run = async (craft: "a320" | "f35", where: string | null, label: string, vr: number, rain = false) => {
    await app.scenario(`${label} · ${craft === "a320" ? "A320" : "F-35"} · ${where ?? "the nearest runway"}${rain ? " · rain, crosswind, feet on the rudder" : ""}`);
    if (rain) await app.js(`(() => { __bh.settings.weather = "rain"; __bh.refresh(); return 1; })()`);
    const l = await lineUp(craft, where, label);
    if (rain)
      console.log(`  ${label}: the wind on the runway ${await app.js<string>(`JSON.stringify(__bh.camera.runwayView()?.wind ?? null)`)}`);
    const r = await roll(craft, label, vr, rain);
    if (rain) await app.js(`(() => { __bh.settings.weather = "fair"; __bh.refresh(); return 1; })()`);
    const problems = [...(l ? [] : ["line-up off the axis"]), ...(r.at ? [] : ["off the axis at the power"]), ...r.problems];
    results.push({ label, problems });
    console.log(`  ${label}: ${problems.length ? problems.join("; ") : "on the axis throughout"}`);
  };

  test("the A320 at Le Bourget: lined up by name, TOGA, to VR", async () => {
    await run("a320", "Paris – Le Bourget", "a320-lfpb", 69);
  }, 240_000);

  test("the A320 lined up with no name (the nearest runway), TOGA, to VR", async () => {
    await run("a320", null, "a320-nearest", 69);
  }, 240_000);

  test("the A320 at Edwards, TOGA, to VR", async () => {
    await run("a320", "Edwards", "a320-edwards", 69);
  }, 240_000);

  test("the A320 at Le Bourget in the rain's crosswind, a pilot's feet on the rudder, TOGA, to VR", async () => {
    await run("a320", "Paris – Le Bourget", "a320-lfpb-rain", 69, true);
  }, 240_000);

  test("the F-35 at Le Bourget, full dry thrust, to 75 m/s", async () => {
    await run("f35", "Paris – Le Bourget", "f35-lfpb", 75);
  }, 240_000);

  test("the F-35 at Edwards, full dry thrust, to 75 m/s", async () => {
    await run("f35", "Edwards", "f35-edwards", 75);
  }, 240_000);

  test("every take-off on the axis (E2E-VOLS rule 13)", () => {
    const bad = results.filter((r) => r.problems.length);
    for (const r of bad) console.log(`  ✗ ${r.label}: ${r.problems.join("; ")}`);
    expect(bad.map((r) => `${r.label}: ${r.problems.join("; ")}`)).toEqual([]);
  });
});
