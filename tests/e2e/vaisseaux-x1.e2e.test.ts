import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX X0–X1, the spacecraft's new controls in the real page with real input: the Assistance set in the
// settings panel (the SAS chip says it), ⇧X stops a tumble, ⇧9 the RCS translation mode (W moves the craft), ⇧8
// station keeping near the ISS, B the docking autopilot held at Waypoint 2 (20 m), ⇧O the mission plan's timeline
// (cleared from its button), the Lander's ground protection (the caution, then the hover), F7 + W the landing point
// designator. ~3 min.

const chip = `([...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && /^(RCS TRANSL\\. · )?(SAS|MANUAL)( · [A-Z ]+)?$/.test(e.textContent.trim())).map((e) => e.textContent.trim())[0] ?? "")`;

describe.skipIf(!E2E)("the spacecraft's controls (X0–X1)", () => {
  let app: App;
  beforeAll(async () => {
    app = await App.boot({ hash: "scene=game:artemis" });
    await app.waitFor("__bh.camera.piloting", 60_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  /** The ISS docking scene (a date its orbit is known: the Ranger 60 m off IDA-2). */
  const nearIss = () =>
    app.js(`(async () => {
      __bh.setDate(Date.UTC(2026, 9, 1, 12)); __bh.game.preset("Earth: docking to the ISS");
      await new Promise((ok) => setTimeout(ok, 1500)); return true; })()`);

  test("the Assistance chosen in the settings: the SAS chip says MANUAL; back to Realistic", async () => {
    await nearIss();
    await app.click("[data-testid=topbar-settings]");
    await app.waitFor(`!document.getElementById("panel").classList.contains("collapsed")`);
    await app.click(".sp-search input");
    await app.type("assistance spacecraft");
    await app.waitFor(`!!document.querySelector('#panel .sp-seg button[data-value="manual"]')`, 10_000);
    // (the spacecraft's segmented control: the one with a "manual" choice under the Spacecraft group)
    await app.js(
      `(() => { const b = [...document.querySelectorAll('#panel .sp-seg button[data-value="manual"]')].find((x) => x.closest("#panel")); b.dataset.testid = "x1-manual"; return true; })()`,
    );
    await app.click("[data-testid=x1-manual]");
    await app.waitFor(`__bh.settings.spaceAssist === "manual"`, 5000);
    await app.waitFor(`${chip} === "MANUAL"`, 5000);
    await app.js(`(__bh.settings.spaceAssist = "realistic", __bh.refresh(), true)`);
    await app.click("[data-testid=topbar-settings]");
    await app.waitFor(`${chip} === "SAS"`, 5000);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("⇧X: a tumble with the SAS off stopped", async () => {
    await app.js(`(__bh.camera.pilot.sas = false, __bh.camera.pilot.omega = [0.25, 0.15, 0.1], true)`);
    await app.press("KeyX", "X", { shift: true });
    await app.waitFor(`!!__bh.camera.spaceRecover || Math.hypot(...__bh.camera.pilot.omega) < 0.01`, 3000);
    await app.waitFor(`!__bh.camera.spaceRecover && Math.hypot(...__bh.camera.pilot.omega) < 0.01`, 20_000);
    await app.js(`(__bh.camera.pilot.sas = true, true)`);
  }, 60_000);

  test("⇧9: the RCS translation mode — the chip, W pushes the craft up", async () => {
    await app.press("Digit9", "(", { shift: true });
    await app.waitFor(`${chip}.startsWith("RCS TRANSL.")`, 5000);
    const v0 = await app.js<number[]>(`__bh.camera.dockGeometry().vrel`);
    await app.hold("KeyW", 1500);
    const v1 = await app.js<number[]>(`__bh.camera.dockGeometry().vrel`);
    expect(Math.hypot(v1[0]! - v0[0]!, v1[1]! - v0[1]!, v1[2]! - v0[2]!)).toBeGreaterThan(0.01);
    await app.press("Digit9", "(", { shift: true });
    await app.waitFor(`!${chip}.startsWith("RCS")`, 5000);
  }, 60_000);

  test("⇧8: station keeping against the ISS — the KEEP button lit, held within 2 m", async () => {
    await app.press("Digit8", "*", { shift: true });
    await app.waitFor(`__bh.camera.pilot.auto === "keep"`, 5000);
    const r = await app.js<{ off: number; drift: number }>(`(() => {
      __bh.freeze(true); for (let i = 0; i < 30 * 120; i++) __bh.step(1 / 30); __bh.freeze(false);
      return { off: __bh.camera.hubNote.off, drift: __bh.camera.hubNote.drift }; })()`);
    expect(r.off).toBeLessThan(2);
    expect(r.drift).toBeLessThan(0.05);
    await app.press("Digit8", "*", { shift: true });
    await app.waitFor(`__bh.camera.pilot.auto === "none"`, 5000);
  }, 120_000);

  test("B: the docking autopilot stops at Waypoint 2, 20 m out (the scene starts 60 m off the port)", async () => {
    await app.press("KeyB", "b");
    await app.waitFor(`__bh.camera.pilot.auto === "dock"`, 5000);
    const r = await app.js<{ phase: string; along: number; auto: string; said: string[] }>(`(() => {
      const c = __bh.camera; __bh.freeze(true);
      const said = []; const prev = c.onPilotMessage; c.onPilotMessage = (m) => { said.push(String(m)); prev?.(m); };
      for (let i = 0; i < 30 * 1500 && !/WAYPOINT 2/.test(c.dockAuto?.phase ?? ""); i++) __bh.step(1 / 30);
      __bh.freeze(false); c.onPilotMessage = prev;
      return { phase: c.dockAuto?.phase ?? "", along: c.dockGeometry()?.along ?? NaN, auto: c.pilot.auto, said: said.slice(-5) }; })()`);
    if (r.phase !== "WAYPOINT 2 · HOLD") console.log(r);
    expect(r.phase).toBe("WAYPOINT 2 · HOLD");
    expect(Math.abs(r.along - 20)).toBeLessThan(2.5);
    await app.press("Backspace");
  }, 180_000);

  test("⇧O: the mission plan of a lunar transfer — its burns, the Moon's sphere; cleared from its button", async () => {
    await app.js(`(async () => {
      __bh.game.preset("game:artemis"); await new Promise((ok) => setTimeout(ok, 1500));
      __bh.settings.target = "moon"; await __bh.camera.planOurs("target", "orbit", 100, 200); __bh.camera.missionCommit(); return true; })()`);
    await app.waitFor(`__bh.camera.plan.nodes.length >= 2`, 30_000);
    await app.press("KeyO", "O", { shift: true });
    await app.waitFor(`!!document.querySelector("[data-testid=mission-plan]")`, 5000);
    await app.waitFor(`document.querySelectorAll("[data-testid=mission-plan] .mp-row.burn").length >= 2`, 5000);
    expect(await app.js<number>(`document.querySelectorAll("[data-testid=mission-plan] .mp-row.soi").length`)).toBeGreaterThan(0);
    await app.click("[data-testid=mp-clear]");
    await app.waitFor(`__bh.camera.plan.nodes.length === 0`, 5000);
    await app.click("[data-testid=mission-plan] .k-modal-head .k-btn");
    await app.waitFor(`!document.querySelector("[data-testid=mission-plan]")`, 5000);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);

  test("the Lander falling at the Moon: the caution, then the protection hovers (the HUD's alert)", async () => {
    const r = await app.js<{ warned: boolean; auto: string; alt: number; alert: string }>(`(async () => {
      __bh.settings.vessel = "lander"; await new Promise((ok) => setTimeout(ok, 800));
      __bh.game.hoverOver("moon", 0.674, 23.473, 3); const c = __bh.camera; c.pilot.setAuto("hover");
      __bh.freeze(true); let warned = false;
      for (let i = 0; i < 30 * 120 && c.pilot.auto !== "hover"; i++) { __bh.step(1 / 30); if (c.spaceGuard?.level === "warn") warned = true; }
      for (let i = 0; i < 10; i++) __bh.step(1 / 30);
      __bh.freeze(false); await new Promise((ok) => setTimeout(ok, 500));
      return { warned, auto: c.pilot.auto, alt: c.surfaceInfo()?.alt ?? NaN, alert: document.querySelector("[data-alert=guard-ground]")?.textContent ?? "" }; })()`);
    expect(r.warned).toBe(true);
    expect(r.auto).toBe("hover");
    expect(r.alt).toBeGreaterThan(100);
    expect(r.alert).toMatch(/AUTO-PROTECTION · GROUND/);
  }, 120_000);

  test("F7 then W: the landing point designator moves the point, the HUD marks it", async () => {
    await app.js(`(__bh.game.hoverOver("moon", 0.674, 23.473, 1.2), true)`);
    await app.press("F7", "F7");
    await app.waitFor(`__bh.camera.pilot.auto === "land" && !!__bh.camera.landRun?.q`, 15_000);
    await app.hold("KeyW", 2000);
    await app.waitFor(`__bh.camera.flightInfo().lpd?.moved === true`, 5000);
    expect(app.cdp.errors).toEqual([]);
  }, 120_000);
});
