import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The F-35's fight HUD and its keys (2026-10-14): Tab held opens the wheel without stepping through the
// planets (its repeats swallowed), the wheel the jet's own; the rocket's functions (orbital holds, roll
// alignment) refused; the radar's contacts with their tracks, SHOOT, the avionics' figures; the infinite
// ammunition setting — the gun held and a missile fired, nothing spent.

describe.skipIf(!E2E)("the F-35's HUD and keys", () => {
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

  test("Tab held: the jet's wheel, its repeats not stepping the target; the rocket's holds refused", async () => {
    await app.js(`(() => { __bh.freeze(false); return 1; })()`);
    const t0 = await app.js<string>(`__bh.settings.target`);
    // (held as a keyboard holds it: a press, its auto-repeats, the release)
    const ev = { code: "Tab", key: "Tab", windowsVirtualKeyCode: 9, modifiers: 0 };
    await app.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...ev });
    for (let k = 0; k < 8; k++) {
      await Bun.sleep(50);
      await app.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", autoRepeat: true, ...ev });
    }
    await Bun.sleep(150);
    const w = await app.js<{ open: boolean; labels: string }>(
      `({ open: !!document.querySelector("[data-testid=wheel]"), labels: document.querySelector("[data-testid=wheel]")?.textContent ?? "" })`,
    );
    await app.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...ev });
    await Bun.sleep(100);
    console.log(`  wheel: ${w.labels.slice(0, 160)}`);
    expect(w.open).toBe(true);
    expect(w.labels).toMatch(/Afterburner|Postcombustion/);
    expect(await app.js<string>(`__bh.settings.target`)).toBe(t0);
    // a tap, out of a fight: no planet either
    await app.press("Tab");
    expect(await app.js<string>(`__bh.settings.target`)).toBe(t0);
    // the orbital hold (1) and the roll alignment (R): not the F-35's
    await app.press("Digit1");
    await app.press("KeyR");
    expect(await app.js<string>(`__bh.camera.pilot.hold`)).toBe("none");
  }, 60_000);

  test("a fight: the radar's tracks, SHOOT, the avionics; infinite ammunition spends nothing", async () => {
    await app.js(`(() => { __bh.settings.f35InfiniteAmmo = true; __bh.flight.challenges.open(); return 1; })()`);
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.click(`[data-testid="chp-fight-drones"]`);
    await app.js(
      `(() => { const c = __bh.camera; for (let i = 0; i < 10; i++) __bh.step(1 / 30); c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`,
    );
    await app.press("Tab");
    await app.press("Equal", "=");
    const hud = await app.js<{
      contacts: { trk: number | null; locked: boolean }[];
      shoot: boolean;
      infinite: boolean;
      fuel: number;
      engine: number;
    }>(`(() => { const i = __bh.camera.flightInfo(); const C = i.combat;
      return { contacts: C.radar.contacts, shoot: C.shoot, infinite: C.infinite, fuel: i.avionics.fuel, engine: i.avionics.spool }; })()`);
    console.log(`  ${hud.contacts.length} contacts, shoot ${hud.shoot}, fuel ${Math.round(hud.fuel)} kg`);
    expect(hud.contacts.length).toBeGreaterThan(0);
    expect(hud.contacts.some((c) => c.locked)).toBe(true);
    expect(hud.contacts.every((c) => c.trk === null || Number.isFinite(c.trk))).toBe(true);
    expect(hud.infinite).toBe(true);
    expect(hud.fuel).toBeGreaterThan(1000);
    const s0 = await app.js<{ gun: number; aim120: number }>(`({ ...__bh.camera.combat.world.stores })`);
    await app.hold("Space", 700);
    await app.press("Enter");
    const s1 = await app.js<{ gun: number; aim120: number }>(`({ ...__bh.camera.combat.world.stores })`);
    const fired = await app.js<number>(`__bh.camera.combat.world.missiles.filter((m) => m.owner === "blue").length`);
    console.log(`  rounds ${s0.gun} → ${s1.gun}; AIM-120 ${s0.aim120} → ${s1.aim120}; own missiles in flight ${fired}`);
    expect(s1.gun).toBe(s0.gun);
    expect(s1.aim120).toBe(s0.aim120);
    expect(fired).toBeGreaterThan(0);
  }, 120_000);
});
