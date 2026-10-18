import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX K6: the spacecraft's crew orders on the real simulator — the Ranger 60 m off the ISS in a room, the
// crew console (crew/) in a frame of the same page joined as EECOM: a failure's checklist ticked from the console's
// Systems pop (the pilot's tablet sees the same ticks) and its action given; station keeping from the Docking pop; a
// body taken for the target from the system map's menu; a burn moved along the orbit. Never the stick nor the throttle.
// ~1 min.
describe.skipIf(!E2E)("the spacecraft's crew orders (K6)", () => {
  let app: App;
  const crew = (js: string) => `document.querySelector('#crew-frame').contentWindow.${js}`;
  const doc = (js: string) => `document.querySelector('#crew-frame').contentDocument.${js}`;
  const click = async (selector: string) => {
    await app.js(`(${doc(`querySelector(${JSON.stringify(selector)})`)}.click(), true)`);
    await app.waitFor(`!${crew("__crew.actions.busy")}`, 6000);
  };
  const lastBoard = () => app.js<{ ok: boolean; what: string; msg: string }>(crew("__crew.actions.board[0]"));

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(`(async () => {
      __bh.setDate(Date.UTC(2026, 9, 1, 12)); __bh.game.preset("Earth: docking to the ISS");
      await new Promise((ok) => setTimeout(ok, 1500)); return true; })()`);
    await app.js("(__bh.net.setName('Cooper'), true)");
    await app.js("__bh.net.create('Endurance crew')");
    const code = await app.js<string>("__bh.net.net.room.code");
    await app.js(
      `(() => { const f = document.createElement('iframe'); f.id = 'crew-frame'; f.src = '/crew/'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:1200px;height:800px;border:0;z-index:99999'; document.body.append(f); return true; })()`,
    );
    await app.waitFor(`!!document.querySelector('#crew-frame').contentWindow?.__crew`, 20_000);
    await app.js(`(${doc(`getElementById("station")`)}.value = "eecom", true)`);
    await app.js(crew(`__crew.join('${code}', 'Doyle')`));
    await app.waitFor(crew("__crew.actions.can('space').ok"), 20_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("EECOM: a failure's checklist ticked from the console — the pilot's ticks the same —, its action given, fixed", async () => {
    await app.js(`(__bh.camera.systemsFail("rcsStuck"), true)`);
    await app.waitFor(`${crew("__crew.model.own()?.snapshot?.sysx?.failures?.length")} === 1`, 8000);
    // (its Systems pop first for EECOM: open it)
    await app.waitFor(`!!${doc(`querySelector('[data-testid="sys-step-rcsStuck-0"]')`)}`, 8000);
    await app.js(`(${doc(`querySelector('.fc-pop.featured')`)}.open = true, true)`);
    // (the action refused before the steps are ticked)
    expect(await app.js<boolean>(`${doc(`querySelector('#sys-fix-rcsStuck')`)}.disabled`)).toBe(true);
    for (let i = 0; i < 3; i++) {
      await app.js(`(${doc(`querySelector('[data-testid="sys-step-rcsStuck-${i}"]')`)}.click(), true)`);
      await app.waitFor(`(__bh.camera.sysTicks.get("f:rcsStuck")?.size ?? 0) === ${i + 1}`, 6000);
    }
    await app.waitFor(`!${doc(`querySelector('#sys-fix-rcsStuck')`)}.disabled`, 6000);
    await app.shot(`${process.env.E2E_SHOTS ?? "remote-results"}/k6-eecom.png`);
    await click("#sys-fix-rcsStuck");
    expect((await lastBoard()).ok).toBe(true);
    await app.waitFor(`__bh.camera.systemsInfo().failures.length === 0`, 20_000);
  }, 90_000);

  test("Docking: station keeping ordered from the console", async () => {
    await app.js(`(${doc(`querySelector('#fc-keep')`)}.closest('details').open = true, true)`);
    await click("#fc-keep");
    await app.waitFor(`__bh.camera.pilot.auto === "keep"`, 6000);
    expect((await lastBoard()).ok).toBe(true);
    await app.js(`(__bh.camera.pilot.setAuto("none"), true)`);
  }, 60_000);

  test("the system map: the Moon touched — its menu — taken for the target", async () => {
    await app.js(crew(`__crew.setView("system")`));
    await app.waitFor(`${crew("__crew.views.mapSpan")} >= 0`, 3000);
    // (the finger's pick: the view's own handler — the body at the menu's place)
    await app.js(crew(`__crew.views.onBody("moon", 300, 300)`));
    await app.waitFor(`!!${doc(`querySelector('[data-act="sp.target"].ctx-body-target, #ctx-body-target')`)}`, 3000);
    await click("#ctx-body-target");
    await app.waitFor(`__bh.settings.target === "moon"`, 6000);
  }, 60_000);

  test("the orbit: a burn moved two minutes later", async () => {
    await app.js(`(__bh.camera.addNode(600 / ${492.55}), true)`);
    await app.waitFor(`__bh.camera.plan.nodes.length === 1`, 5000);
    const t0 = await app.js<number>(`__bh.camera.plan.nodes[0].t`);
    await app.js(crew(`__crew.views.onNodeMove(0, 120)`));
    await app.waitFor(`Math.abs((__bh.camera.plan.nodes[0].t - ${t0}) * 492.55 - 120) < 2`, 6000);
    expect(app.cdp.errors).toEqual([]);
  }, 60_000);
});
