import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The intercept in the game (docs/PLAN-AVIATION-AAA.md, C2): the drone hunt's nearest drone locked (Tab); its
// cues on the HUD (the collision course's steering cue, INTC/TTI/AA/pursuit/HCA); ⇧Tab the INTERCEPT autopilot —
// ICPT on the HUD's top line —, flown on its own to the shadow 300 m behind the drone on its left, and held.
// (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the F-35's intercept", () => {
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

  test("the lock's cues: the collision course, the merge's time, the aspect, the pursuit", async () => {
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.click(`[data-testid="chp-fight-drones"]`);
    await app.waitFor(`__bh.camera.radar.tracks.size >= 3`, 10_000);
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
    await app.press("Tab");
    await Bun.sleep(600);
    const I = await app.js<{ collHdg: number | null; tti: number | null; aspect: number; pursuit: string } | null>(
      `__bh.camera.radarHud()?.lock?.icpt ?? null`,
    );
    console.log(
      `  INTC ${I && I.collHdg !== null ? Math.round((I.collHdg * 180) / Math.PI) : "---"} TTI ${I?.tti?.toFixed(0)} s AA ${I?.aspect.toFixed(0)} ${I?.pursuit}`,
    );
    expect(I?.collHdg).not.toBeNull();
    expect(I!.tti!).toBeGreaterThan(0);
    await shot("icpt-cues");
  }, 60_000);

  test("⇧Tab: INTERCEPT — flown on its own to the shadow 300 m behind the drone, held", async () => {
    await app.press("Tab", "Tab", { shift: true });
    await Bun.sleep(400);
    const on = await app.js<{ phase: string; name: string } | null>(
      `(() => { const I = __bh.camera.icpt; return I && { phase: I.phase, name: I.name }; })()`,
    );
    console.log(`  ${on?.name}: ${on?.phase}`);
    expect(on).not.toBeNull();
    await Bun.sleep(3000);
    await shot("icpt-run");
    // (the sim's own time: a slow page takes longer — waited for, not timed)
    await app.waitFor(`__bh.camera.icpt?.phase === "shadow"`, 420_000);
    await Bun.sleep(10_000);
    const S = await app.js<{ phase: string; dist: number; ann: string }>(
      `(() => { const I = __bh.camera.icpt; return { phase: I.phase, dist: I.last.dist, ann: __bh.camera.jetModes.icpt }; })()`,
    );
    console.log(`  ${S.ann}: ${S.dist.toFixed(0)} m off the slot`);
    expect(S.phase).toBe("shadow");
    expect(S.dist).toBeLessThan(150);
    await shot("icpt-shadow");
    await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
    await Bun.sleep(1500);
    await shot("icpt-shadow-cockpit");
    await app.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
  }, 480_000);
});
