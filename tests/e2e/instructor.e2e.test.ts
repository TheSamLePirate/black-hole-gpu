import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The instructor and the flight school (docs/PLAN-AVIATION-AAA.md, A4): first the Alps as ever; then the flight
// school's cards — the ILS's opened by a real click, a step picked on its diagram —; tried by hand: the jet left to
// drift off the localizer, the instructor's panel live (the diagram and our trace, the gauges, the call and its fix),
// let go — its debrief with its charts —; then the loop demonstrated, its trace drawn over the figure, debriefed.
// (Measured headless: tests/instructor.test.ts.) (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the instructor and the flight school", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: true });
    await app.js(
      `(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; __bh.settings.f35Instructor = "full"; return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("first the Alps, their relief", async () => {
    await app.js(`(() => { __bh.game.setDate("2026-07-10T11:00:00Z"); Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0 });
      __bh.game.flyAt(45.85, 6.75, 1500, 110, 150); __bh.settings.shipMount = "chase"; return 1; })()`);
    await Bun.sleep(3000);
    await shot("alps");
  }, 120_000);

  test("the flight school: the ILS's card opened by a click, a step picked on its diagram", async () => {
    await app.js(`(() => { __bh.flight.school.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector('[data-testid="flight-school"]')`, 5000);
    await Bun.sleep(500);
    await shot("school");
    await app.click(`[data-testid="lesson-ils"]`);
    await app.waitFor(`!!document.querySelector('[data-testid="lesson-card"]')`, 5000);
    // (its fourth step hovered: ringed on the diagram)
    const p = await app.js<{ x: number; y: number }>(
      `(() => { const b = document.querySelectorAll(".ins-stepitem")[3].getBoundingClientRect(); return { x: b.left + 20, y: b.top + 8 }; })()`,
    );
    await app.mouse("move", p.x, p.y);
    await Bun.sleep(300);
    expect(await app.js<number>(`document.querySelectorAll(".ld-sel").length`)).toBe(1);
    await shot("card");
  }, 60_000);

  test("the ILS tried by hand: the panel live, the drift called with its fix; let go — the debrief and its charts", async () => {
    await app.click(`[data-testid="lesson-try"]`);
    await app.waitFor(`!!__bh.camera.ilsRun && __bh.camera.ilsRun.manual === true`, 10_000);
    // (a little right rudder held: off the centreline)
    await app.js(
      `(() => { const c = __bh.camera; c.jetModes.alt = null; c.jetModes.hdg = (c.attitudeNow().heading + 6 * Math.PI / 180); c.jetModes.spd = 95; return 1; })()`,
    );
    await app.waitFor(`!!__bh.camera.instr && !document.querySelector('[data-testid="instructor-panel"]').hidden`, 20_000);
    await app.waitFor(`!!__bh.camera.instr?.last`, 40_000);
    await Bun.sleep(1500);
    await shot("panel");
    const call = await app.js<string>(`__bh.camera.instr.last.text`);
    console.log(`  the instructor: ${call}`);
    expect(call.length).toBeGreaterThan(3);
    await app.js(`(() => { __bh.camera.ilsOff(); return 1; })()`);
    await app.waitFor(`!!document.querySelector('[data-testid="instructor-debrief"]')`, 10_000);
    await Bun.sleep(600);
    await shot("debrief");
    const n = await app.js<number>(`document.querySelectorAll(".ins-chart").length`);
    expect(n).toBe(2);
    await app.press("Escape");
  }, 120_000);

  test("the loop demonstrated: its trace over the figure, debriefed", async () => {
    await app.js(`(() => { __bh.flight.school.demo("loop"); return 1; })()`);
    await app.waitFor(`__bh.camera.aero?.status === "fly"`, 30_000);
    await Bun.sleep(14_000);
    await shot("loop-panel");
    await app.waitFor(`!!document.querySelector('[data-testid="instructor-debrief"]')`, 60_000);
    await Bun.sleep(600);
    await shot("loop-debrief");
    const s = await app.js<number>(`__bh.camera.instrLast.debrief.score`);
    console.log(`  the loop's debrief: ${s}/20`);
    expect(s).toBeGreaterThan(10);
  }, 120_000);
});
