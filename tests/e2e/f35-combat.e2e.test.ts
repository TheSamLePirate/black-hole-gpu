import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-F35 F10: a fight flown by the keys — the drone hunt started from its card, the radar's lock on Tab, the
// AIM-120 chosen on =, fired on Enter, the drone splashed; the gun on Space held (rounds spent, the time not
// paused by it); the countermeasures on −; the aggressor's F-35 drawn by the renderer.

describe.skipIf(!E2E)("the F-35's fights", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.freeze(true); __bh.game.setDate("2067-06-21T17:30"); __bh.settings.vessel = "f35";
      for (let i = 0; i < 5; i++) __bh.step(1 / 30); __bh.game.lineUp("Edwards"); for (let i = 0; i < 5; i++) __bh.step(1 / 30); return 1; })()`);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the drone hunt: Tab locks, = picks the AIM-120, Enter fires it, the drone is splashed", async () => {
    await app.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.click(`[data-testid="chp-fight-drones"]`);
    await app.js(`(() => { const c = __bh.camera; for (let i = 0; i < 10; i++) __bh.step(1 / 30); c.jetToggle("ap"); c.jetToggle("athr"); __bh.freeze(false); return 1; })()`);
    await app.press("Tab");
    await app.press("Equal", "=");
    const pre = await app.js<{ lock: number | null; weapon: string }>(`({ lock: __bh.camera.combat.world.lock, weapon: __bh.camera.combat.weapon })`);
    expect(pre.lock).not.toBeNull();
    expect(pre.weapon).toBe("aim120");
    await app.press("Enter");
    const r = await app.js<{ fired: number; log: string[]; kills: number }>(`(() => { __bh.freeze(true); const c = __bh.camera; const W = c.combat.world; const log = [];
      for (let k = 0; k < 60 * 30 && W.targets.every((q) => q.alive); k++) { __bh.step(1 / 30); if (c.combat.say) { log.push(c.combat.say); c.combat.say = null; } }
      return { fired: 4 - W.stores.aim120, log, kills: W.targets.filter((q) => !q.alive).length }; })()`);
    console.log(`  ${r.log.join(" · ")}`);
    expect(r.fired).toBe(1);
    expect(r.kills).toBe(1);
    expect(r.log.some((l) => /Splash|Abattu/.test(l))).toBe(true);
  }, 240_000);

  test("Space held: the gun fires, the time runs on; − a flare and chaff", async () => {
    await app.js(`(() => { __bh.freeze(false); return 1; })()`);
    const t0 = await app.js<number>(`__bh.sim.time`);
    const g0 = await app.js<number>(`__bh.camera.combat.world.stores.gun`);
    await app.hold("Space", 900);
    const g1 = await app.js<number>(`__bh.camera.combat.world.stores.gun`);
    const t1 = await app.js<number>(`__bh.sim.time`);
    await app.press("Minus", "-");
    const cm = await app.js<number>(`__bh.camera.combat.world.stores.flares`);
    console.log(`  rounds ${g0} → ${g1}; flares ${cm}`);
    expect(g1).toBeLessThan(g0 - 10);
    expect(t1).toBeGreaterThan(t0);
    expect(await app.js<boolean>(`__bh.settings.animate !== false`)).toBe(true);
    expect(cm).toBe(29);
  }, 60_000);

  test("the guns duel: the aggressor drawn as an instance before the player", async () => {
    await app.js(`(() => { __bh.camera.combatEnd(); __bh.flight.challenges.open(); return 1; })()`);
    await app.click(`[data-testid="chp-fight-guns"]`);
    const n = await app.js<number>(`(() => { __bh.freeze(true); for (let i = 0; i < 5; i++) __bh.step(1 / 30); return __bh.renderer.combatOthers.length; })()`);
    expect(n).toBe(1);
  }, 60_000);
});
