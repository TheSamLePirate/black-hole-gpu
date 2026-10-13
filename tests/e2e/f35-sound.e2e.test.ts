import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-F35 F6: the F-35's turbofan heard — measured at the output: idle, full dry thrust, the afterburner, from the
// seat and from behind; the lift fan's roar added in the STOVL mode; nothing clipped.

describe.skipIf(!E2E)("the F-35's sound", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.press("KeyT");
    await app.press("KeyT");
    await app.waitFor(`__sound.ctx?.state === "running"`, 10_000);
    await app.js(`(() => { __bh.settings.vessel = "f35"; return 1; })()`);
    await app.waitFor(`__bh.game.status().label === "LANDED"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** The output's loudest channel [dBFS] a while after setting the engine (the brakes on: it stays put). */
  const at = (mount: string, js: string) =>
    app.js<{ lvl: number; peak: number }>(`(async () => {
      __bh.settings.shipMount = ${JSON.stringify(mount)}; __bh.refresh();
      const c = __bh.camera; ${js};
      await new Promise((ok) => setTimeout(ok, 2500));
      const L = __sound.levels(), B = __sound.busLevels();
      return { lvl: Math.max(...L), peak: B.peak };
    })()`);

  test("idle < full dry thrust < afterburner, from the seat and from the chase behind; never clipped", async () => {
    const r: Record<string, { lvl: number; peak: number }> = {};
    for (const mount of ["cockpit", "chase"]) {
      r[`${mount} idle`] = await at(mount, "c.pilot.throttle = 0.02; c.jetModes.ab = false;");
      r[`${mount} dry`] = await at(mount, "c.pilot.throttle = 0.94; c.jetModes.ab = false;");
      r[`${mount} wet`] = await at(mount, "c.pilot.throttle = 1; c.jetToggle('ab');");
      await at(mount, "c.pilot.throttle = 0.02; c.jetModes.ab = false;");
    }
    console.log(
      Object.entries(r)
        .map(([k, v]) => `  ${k}: ${v.lvl.toFixed(1)} dB (peak ${v.peak.toFixed(1)})`)
        .join("\n"),
    );
    // (from the seat quieter than behind it)
    expect(r["cockpit wet"]!.lvl).toBeLessThan(r["chase wet"]!.lvl);
    for (const m of ["cockpit", "chase"]) {
      expect(r[`${m} dry`]!.lvl).toBeGreaterThan(r[`${m} idle`]!.lvl + 4);
      expect(r[`${m} wet`]!.lvl).toBeGreaterThan(r[`${m} dry`]!.lvl + 1);
    }
    for (const v of Object.values(r)) expect(v.peak).toBeLessThan(-0.5);
  }, 120_000);
});
