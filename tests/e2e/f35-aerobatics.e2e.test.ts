import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The aerobatic figures in the game (docs/PLAN-AVIATION-AAA.md, V4): the Challenges panel's Aerobatics — a loop
// watched (flown by its program from its card: the F-35 placed at its entry, the cues, its marks /20 on the HUD),
// the box armed for the player (its entry's window on the HUD), the guide shown as the player flies. (E2E_SHOTS=<dir>.)

describe.skipIf(!E2E)("the F-35's aerobatics", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const shot = async (name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await app.shot(`${shots}/${name}.png`);
  };
  const hud = () =>
    app.js<{
      status: string;
      title: string;
      cue: string;
      t: number;
      result: { score: number } | null;
      entry: object | null;
      guide: object | null;
    } | null>(
      `(() => { const a = __bh.camera.aeroHud(); return a && { status: a.status, title: a.title, cue: a.cue, t: a.t, result: a.result, entry: a.entry, guide: a.guide }; })()`,
    );
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

  test("a loop watched from its card: placed at its entry, flown by its program, marked on the HUD", async () => {
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=chp-aero-demo-loop]")`, 5000);
    await app.click(`[data-testid="chp-aero-demo-loop"]`);
    await app.waitFor(`__bh.camera.aero?.status === "fly"`, 10_000);
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    // (over the top: inverted, the cue said)
    await app.waitFor(`(__bh.camera.aero?.mem.loopAng ?? 0) > 2.9`, 60_000);
    const top = await hud();
    console.log(`  over the top: ${top?.cue} — ${top?.t.toFixed(1)} s`);
    await shot("aero-loop-top");
    await app.waitFor(`__bh.camera.aero?.status === "done"`, 60_000);
    const end = await hud();
    console.log(`  ${end?.title}: ${end?.result?.score}/20 in ${end?.t.toFixed(1)} s`);
    await shot("aero-loop-marks");
    expect(end?.result?.score ?? 0).toBeGreaterThanOrEqual(18);
  }, 150_000);

  test("the box armed for the player: its entry's window on the HUD, begun once met, the guide shown", async () => {
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=chp-aero-box]")`, 5000);
    await app.click(`[data-testid="chp-aero-box"]`);
    await app.waitFor(`!!__bh.camera.aero?.seq`, 10_000);
    const armed = await hud();
    console.log(`  box: ${armed?.title} ${armed?.status}`);
    // (placed at the loop's entry: met at once — the guide out, the player's)
    await app.waitFor(`__bh.camera.aero?.status === "fly"`, 10_000);
    await Bun.sleep(1500);
    const flying = await hud();
    console.log(`  flying: guide ${JSON.stringify(flying?.guide)}`);
    await shot("aero-box-guide");
    expect(flying?.guide).not.toBeNull();
    await app.js(`(() => { __bh.camera.aeroStop(); return 1; })()`);
  }, 60_000);
});
