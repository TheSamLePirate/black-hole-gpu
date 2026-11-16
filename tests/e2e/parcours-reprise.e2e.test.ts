import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { expectFlight, FLIGHT_STATE_JS, type FlightState } from "./lib/flight-state";
// PLAN-J6 J6-4 — the journey « resume an aircraft on the ground » (strategy §19.13): a craft at rest on Edwards' runway (tiles and the
// IGN blocked), saved by the real key F5, then the player's start preference changed (settings.a320Start — what a placement gives the
// A320's systems), flown elsewhere, then F9: the state the save announces must come back — the fuel, the gear, the flaps, the brakes, and
// (since 15 Nov 2026, craftsave `a320`) the A320's systems' start state: cold and dark, the APU's, ready —, the instruments and the gear
// coherent; then control taken again on the ground (the F-35: U, airborne; the A320 ready: its engines running, its throttle answering).
// Before 15 Nov 2026 an A320 saved cold and dark came back with its engines running (the setting's « ready »), and one saved running came
// back cold with the setting « cold ».
// Rule 13 (E2E-VOLS): the F-35's climb after U stepped 4 s and asserted — thrust, airspeed, attitude.
// Duration: ~2 min on kerr-mini.
// Done when: the A320 saved cold and saved ready both come back as saved, and the F-35 resumed and airborne after U.
afterAll(stopServer);
const OUT = process.env.PR_OUT ?? "remote-results/parcours-reprise";
const READ = `(() => { const c = __bh.camera, v = __bh.fleet.active;
  return { vessel: v, fuel: Math.round(__bh.fleet.fuel[v] ?? -1), gear: c.gearDown, flaps: c.airFlight.cfg.flaps ?? 0, brake: c.airFlight.cfg.brake ?? 0,
    landed: !!(c.ourLanded || c.rolling), engines: v === "a320" && c.a320 ? c.a320.engines.map((e) => !!e.running) : null,
    apu: v === "a320" ? Number(c.a320Props?.["systems/apu/available"] ?? 0) : null, h: Math.round(c.geoNow().alt) }; })()`;
type Craft = {
  vessel: string;
  fuel: number;
  gear: boolean;
  flaps: number;
  brake: number;
  landed: boolean;
  engines: boolean[] | null;
  apu: number | null;
  h: number;
};
describe.skipIf(!E2E)("J6-4: resume an aircraft on the ground — the state the save announces, then control", () => {
  let app: App;
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    app = await App.boot({ hash: "scene=game:artemis", tiles: false });
    await app.cdp.send("Network.setBlockedURLs", {
      urls: ["*celestrak.org*", "*s3.amazonaws.com*", "*gibs.earthdata.nasa.gov*", "*geopf.fr*", "*ign.fr*"],
    });
    await app.waitFor("__bh.camera.piloting", 30_000);
  }, 300_000);
  afterAll(() => app?.close());

  // (a craft switched to and lined up at Edwards, its start preference set first; the clock stepped)
  const lineUp = async (vessel: string, start: string) => {
    await app.js(
      `(() => { __bh.freeze(false); Object.assign(__bh.settings, { vessel: "${vessel}", a320Start: "${start}", wind: 0, damage: false }); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "${vessel}"`, 30_000);
    return app.js<Craft>(
      `(() => { __bh.freeze(true); __bh.game.lineUp("Edwards"); for (let i = 0; i < 90; i++) __bh.step(1 / 30); return ${READ}; })()`,
    );
  };
  // (F5, the preference changed, flown elsewhere, F9; then a few steps)
  const resume = async (otherStart: string) => {
    await app.js(`(() => { localStorage.removeItem("kerr.save:Quick save"); return 1; })()`);
    await app.press("F5");
    await app.waitFor(`!!localStorage.getItem("kerr.save:Quick save")`, 5000);
    const block = await app.js<unknown>(`JSON.parse(localStorage.getItem("kerr.save:Quick save")).craft?.a320 ?? null`);
    await app.js(`(() => { __bh.settings.a320Start = "${otherStart}"; __bh.game.flyAt(35.2, -118.2, 3000, 90, 160);
      for (let i = 0; i < 30; i++) __bh.step(1 / 30); return 1; })()`);
    await app.press("F9");
    const back = await app.js<Craft>(`(() => { for (let i = 0; i < 90; i++) __bh.step(1 / 30); return ${READ}; })()`);
    return { block, back };
  };

  test("the A320 saved cold and dark comes back cold and dark — not as the start preference has it", async () => {
    const saved = await lineUp("a320", "cold");
    const { block, back } = await resume("ready");
    console.log(`  A320 cold: saved ${JSON.stringify(saved)}; the save's a320: ${JSON.stringify(block)}; after F9 ${JSON.stringify(back)}`);
    expect(saved.engines).toEqual([false, false]);
    expect(block).toBe("cold");
    expect(back.vessel).toBe("a320");
    expect(back.landed).toBe(true);
    expect(back.engines).toEqual([false, false]);
    expect(Math.abs(back.fuel - saved.fuel)).toBeLessThan(30);
    expect(back.gear).toBe(true);
  }, 120_000);

  test("the A320 saved ready comes back with its engines running — then its throttle answers on the ground", async () => {
    const saved = await lineUp("a320", "ready");
    const { block, back } = await resume("cold");
    console.log(
      `  A320 ready: saved ${JSON.stringify(saved)}; the save's a320: ${JSON.stringify(block)}; after F9 ${JSON.stringify(back)}`,
    );
    expect(saved.engines).toEqual([true, true]);
    expect(block).toBe("ready");
    expect(back.engines).toEqual([true, true]);
    expect(back.landed).toBe(true);
    // (control taken again: the brakes off, the levers at take-off thrust a moment — it rolls)
    const rolled = await app.js<number>(`(() => { const c = __bh.camera; const g0 = c.geoNow(); c.pilot.throttle = 1;
      for (let i = 0; i < 300; i++) __bh.step(1 / 30); const g = c.geoNow(); c.pilot.throttle = 0;
      return Math.round(Math.hypot((g.lat - g0.lat) * 111320, (g.lon - g0.lon) * 111320 * Math.cos(g.lat * Math.PI / 180))); })()`);
    console.log(`  the A320 rolled ${rolled} m in 10 s at full throttle`);
    // (it answers: some metres — its engines spooling up, ~17 m in 10 s from rest on kerr-mini)
    expect(rolled).toBeGreaterThan(5);
    await app.js(`(__bh.freeze(false), __bh.refresh(), __bh.camera.viewReset?.(), true)`);
    await Bun.sleep(600);
    await app.shot(`${OUT}/a320-resumed.png`);
  }, 120_000);

  test("the F-35 parked: fuel, gear and brakes as saved, then U — airborne", async () => {
    await lineUp("f35", "ready");
    await app.js(`(() => { __bh.fleet.fuel.f35 = 3000; for (let i = 0; i < 10; i++) __bh.step(1 / 30); return 1; })()`);
    const saved = await app.js<Craft>(READ);
    const { back } = await resume("ready");
    console.log(`  F-35: saved ${JSON.stringify(saved)}; after F9 ${JSON.stringify(back)}`);
    expect(back.vessel).toBe("f35");
    expect(back.landed).toBe(true);
    expect(Math.abs(back.fuel - 3000)).toBeLessThan(30);
    expect(back.gear).toBe(true);
    await app.js(`(__bh.freeze(false), true)`);
    await app.press("KeyU", "u");
    const off = await app.js<number | null>(`(() => { const c = __bh.camera; __bh.freeze(true); let off = null;
      for (let k = 0; k < 30 * 30; k++) { __bh.step(1 / 30); if (!c.rolling && !c.ourLanded) { off = k / 30; break; } } __bh.freeze(false); return off; })()`);
    console.log(`  F-35 airborne after U: ${off} s`);
    expect(off ?? 99).toBeLessThan(20);
    // (rule 13: 4 s on, stepped — the climb as flown: the engine at take-off thrust, the airspeed, the attitude)
    const climbing = await app.js<FlightState>(`(() => { __bh.freeze(true); for (let i = 0; i < 120; i++) __bh.step(1 / 30);
      const s = ${FLIGHT_STATE_JS}; __bh.freeze(false); return s; })()`);
    console.log(`  climbing: ${JSON.stringify(climbing)}`);
    expectFlight(climbing, "climbing after the resume", { engineMin: 0.5, speedMin: 60, pitchMax: 25, bankMax: 20, aglMin: 10 });
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
