import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-HOTAS: a HOTAS in three pieces, simulated in the page (navigator.getGamepads: a stick, a throttle, rudder
// pedals — no "standard" mapping), read together through their profiles. H2: the stick rolls the ship, the
// lever sets the throttle where it stands — picked up (once the keys set it elsewhere, the lever takes it back
// only passing through it) —, a button fires its keymap action, the pedals' toe brakes are read; the
// standard pad's path leaves the claimed devices alone. H3: without the test's profiles, the three are known by
// their Thrustmaster ids. H4: the controllers screen by real clicks — the devices listed with their profiles,
// the roll's source set by detection (the twist moved), inverted, kept as the player's own; back to the known
// profile.

const FAKE = `(() => {
  const mk = (index, id, axes, n) => ({ index, id, connected: true, mapping: "", timestamp: 0, axes: axes.slice(),
    buttons: Array.from({ length: n }, () => ({ pressed: false, touched: false, value: 0 })), vibrationActuator: null });
  window.__hotas = [
    mk(0, "T.16000M (Vendor: 044f Product: b10a)", [0, 0, 0, 0], 16),
    mk(1, "TWCS Throttle (Vendor: 044f Product: b687)", [0, 0, 1, 0, 0, 0], 14),
    mk(2, "T-Rudder (Vendor: 044f Product: b679)", [-1, -1, 0], 0),
  ];
  navigator.getGamepads = () => window.__hotas;
  window.__press = (d, b, on) => { const x = window.__hotas[d].buttons[b]; x.pressed = on; x.value = on ? 1 : 0; };
  return true;
})()`;

const PROFILES = `(() => {
  const P = {
    "044f:b10a": { model: "044f:b10a", name: "test stick", bindings: [
      { target: "roll", source: { kind: "axis", index: 0 } },
      { target: "pitch", source: { kind: "axis", index: 1 } },
      { target: "yaw", source: { kind: "axis", index: 3 } },
      { action: "sas", source: { kind: "button", index: 0 } } ] },
    "044f:b687": { model: "044f:b687", name: "test throttle", bindings: [
      { target: "throttle", source: { kind: "axis", index: 2 }, shape: { dead: 0, curve: 0, invert: true } } ] },
    "044f:b679": { model: "044f:b679", name: "test pedals", bindings: [
      { target: "yaw", source: { kind: "axis", index: 2 } },
      { target: "brakeL", source: { kind: "axis", index: 0 } },
      { target: "brakeR", source: { kind: "axis", index: 1 } } ] },
  };
  window.__presetKnown = __bh.camera.padControls.presetFor;
  __bh.camera.padControls.presetFor = (d) => P[d.model] ?? null;
  return true;
})()`;

describe.skipIf(!E2E)("a HOTAS in three pieces", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 30_000);
    await app.js(FAKE);
    await app.js(PROFILES);
    await app.js(`(__bh.settings.shipMount = "cockpit", __bh.refresh(), true)`);
  }, 120_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const frame = () => app.js("new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(true))))");

  test("read together: the three devices claimed (none read as a pad), their commands", async () => {
    await frame();
    const r = await app.js<{ devices: { profile: string | null }[]; padConnected: boolean }>(
      "({ devices: __bh.camera.padControls.last.devices, padConnected: __bh.camera.pad.connected })",
    );
    expect(r.devices.map((d) => d.profile)).toEqual(["test stick", "test throttle", "test pedals"]);
    expect(r.padConnected).toBe(false);
  });

  test("the stick rolls the ship; the lever sets the throttle where it stands, the keys between", async () => {
    const r = await app.js<{ roll: number; th: number[] }>(`(async () => {
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      __bh.camera.pilot.auto = "none"; __bh.camera.pilot.hold = "none";
      window.__hotas[0].axes[0] = 1;
      await wait(600);
      const roll = __bh.camera.pilot.omega[2];
      window.__hotas[0].axes[0] = 0;
      const th = [];
      window.__hotas[1].axes[2] = 0; await wait(200); th.push(__bh.camera.pilot.throttle);
      window.__hotas[1].axes[2] = -1; await wait(200); th.push(__bh.camera.pilot.throttle);
      // (the lever still: the throttle the keys'; nudged without passing it: still the keys'; pulled through
      // it, the lever's again)
      __bh.camera.pilot.throttle = 0.2; await wait(200); th.push(__bh.camera.pilot.throttle);
      window.__hotas[1].axes[2] = -0.9; await wait(200); th.push(__bh.camera.pilot.throttle);
      window.__hotas[1].axes[2] = 1; await wait(200); th.push(__bh.camera.pilot.throttle);
      return { roll, th };
    })()`);
    expect(Math.abs(r.roll)).toBeGreaterThan(0.05);
    expect(r.th[0]).toBeCloseTo(0.48, 1);
    expect(r.th[1]).toBeCloseTo(1, 2);
    expect(r.th[2]).toBeCloseTo(0.2, 2);
    expect(r.th[3]).toBeCloseTo(0.2, 2);
    expect(r.th[4]).toBe(0);
  });

  test("a button fires its keymap action once (SAS); the toe brakes are read", async () => {
    const r = await app.js<{ sas: boolean[]; toe: number }>(`(async () => {
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
      const sas = [__bh.camera.pilot.sas];
      window.__press(0, 0, true); await wait(300); sas.push(__bh.camera.pilot.sas);
      window.__press(0, 0, false); await wait(200); sas.push(__bh.camera.pilot.sas);
      window.__hotas[2].axes[1] = 1; await wait(200);
      const toe = __bh.camera.toeBrake;
      window.__hotas[2].axes[1] = -1;
      return { sas, toe };
    })()`);
    expect(r.sas[1]).toBe(!r.sas[0]);
    expect(r.sas[2]).toBe(r.sas[1]);
    expect(r.toe).toBeCloseTo(1, 2);
  });

  test("known by their ids: the T.16000M, the TWCS, the rudder pedals", async () => {
    await app.js("(__bh.camera.padControls.presetFor = window.__presetKnown, true)");
    await frame();
    const names = await app.js<(string | null)[]>("__bh.camera.padControls.last.devices.map((d) => d.profile)");
    expect(names).toEqual(["Thrustmaster T.16000M", "Thrustmaster TWCS Throttle", "Thrustmaster rudder pedals"]);
  });

  test("the controllers screen: listed, a source detected, inverted, kept as mine; back to the known profile", async () => {
    await app.press("Escape");
    await app.click("[data-testid=pause-controls]");
    await app.waitFor(`!!document.querySelector("[data-testid=controls]")`);
    await app.click("[data-testid=controls-pads]");
    await app.waitFor(`!!document.querySelector("[data-testid=pads]")`);
    await app.waitFor(`document.querySelectorAll(".ps-dev").length === 3`, 5000);
    const list = await app.js<string>(`document.querySelector("[data-testid=pads-list]").textContent`);
    expect(list).toContain("Thrustmaster T.16000M");
    expect(list).toContain("Thrustmaster TWCS Throttle");
    // (the stick selected: its first binding, the roll, detected anew — the twist, axis 5, moved one way)
    await app.click('[data-testid="pads-dev-044f:b10a"]');
    await app.click("[data-testid=pads-src-0]");
    await app.js("(window.__hotas[0].axes = [0, 0, 0, 0, 0, 0], true)");
    await Bun.sleep(150);
    await app.js("(window.__hotas[0].axes[5] = 0.9, true)");
    await app.waitFor(`document.querySelector("[data-testid=pads-src-0]")?.textContent.includes("5")`, 5000);
    await app.js("(window.__hotas[0].axes[5] = 0, true)");
    expect(await app.js<string>(`document.querySelector("[data-testid=pads-src-0]").textContent`)).toMatch(/5 \+$/);
    await app.click("[data-testid=pads-inv-0]");
    // (a button pressed while the screen is open: shown, not flown — the SAS as it was)
    const sas0 = await app.js<boolean>("__bh.camera.pilot.sas");
    await app.js("(window.__press(0, 1, true), true)");
    await Bun.sleep(300);
    await app.js("(window.__press(0, 1, false), true)");
    expect(await app.js<boolean>("__bh.camera.pilot.sas")).toBe(sas0);
    const own = await app.js<{ source: { kind: string; index: number; half?: number }; shape?: { invert: boolean } }>(
      `JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith("kerr.pads")))).find((p) => p.model === "044f:b10a").bindings[0]`,
    );
    expect(own.source).toEqual({ kind: "axis", index: 5, half: 1 });
    expect(own.shape?.invert).toBe(true);
    expect(await app.js<string>(`document.querySelector('[data-testid="pads-dev-044f:b10a"]').textContent`)).toMatch(
      /mon profil|my profile/,
    );
    // (the known profile back)
    await app.click("[data-testid=pads-reset]");
    expect(await app.js<string>(`document.querySelector('[data-testid="pads-dev-044f:b10a"]').textContent`)).toContain(
      "Thrustmaster T.16000M",
    );
    await app.click("[data-testid=pads-back]");
    await app.waitFor(`!!document.querySelector("[data-testid=controls]")`);
    await app.press("Escape");
    await app.press("Escape");
  });
});
