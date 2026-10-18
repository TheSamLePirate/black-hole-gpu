import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The crew's orders (docs/PLAN-CREW-ACTIONS.md) on the real simulator: an F-35 flying over the Alps in a room, the
// crew console (crew/) in a frame of the same page joined as instruments — its own buttons pressed — and what the
// pilot's craft does then. Never the stick nor the throttle.
describe.skipIf(!E2E)("crew actions", () => {
  let app: App;
  let code = "";
  /** the crew console's window (the frame's) */
  const crew = (js: string) => `document.querySelector('#crew-frame').contentWindow.${js}`;
  /** a button of the crew console pressed (its own click), then its answer waited for */
  const press = async (selector: string) => {
    await app.js(`(document.querySelector('#crew-frame').contentDocument.querySelector(${JSON.stringify(selector)}).click(), true)`);
    await app.waitFor(`!${crew("__crew.actions.busy")}`, 5000);
  };
  const lastBoard = () => app.js<{ ok: boolean; what: string; msg: string }>(crew("__crew.actions.board[0]"));

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(45.85, 6.75, 3000, 110, 200); return 1; })()`);
    await app.js("(__bh.net.setName('Ana'), true)");
    await app.js("__bh.net.create('Crew actions')");
    code = await app.js<string>("__bh.net.net.room.code");
    await app.js(
      `(() => { const f = document.createElement('iframe'); f.id = 'crew-frame'; f.src = '/crew/'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:1100px;height:760px;border:0;z-index:99999'; document.body.append(f); return true; })()`,
    );
    await app.waitFor(`!!document.querySelector('#crew-frame').contentWindow?.__crew`, 20_000);
    await app.js(crew(`__crew.join('${code}', 'Ben')`));
    await app.waitFor(crew("__crew.actions.can('config').ok"), 15_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("A1 — the configuration from the crew's Systems view: gear, flaps, air brake, SAS; the pilot told", async () => {
    await app.js(crew("__crew.setView('schematic')"));
    await press(`[data-act="cfg.gear"]:last-of-type`);
    expect(await app.js<boolean>("__bh.camera.gearDown")).toBe(true);
    expect((await lastBoard()).ok).toBe(true);
    // (the pilot's toast: who asked)
    await app.waitFor("document.body.innerText.includes('(crew)') || document.body.innerText.includes('(équipage)')", 3000);
    await press(`.act-seg[aria-label="Volets"] button:nth-of-type(2)`);
    expect(await app.js<number>("__bh.camera.airFlight.cfg.flaps")).toBe(0.5);
    await press(`.act-seg[aria-label="Aérofrein"] button:nth-of-type(2)`);
    expect(await app.js<number>("__bh.camera.airBrake")).toBeGreaterThan(0);
    await press(`.act-seg[aria-label="Aérofrein"] button:nth-of-type(1)`);
    expect(await app.js<number>("__bh.camera.airBrake")).toBe(0);
    // (the switches lit as the craft is, from its instruments)
    await app.waitFor(
      `document.querySelector('#crew-frame').contentDocument.querySelector('.act-seg[aria-label="Train"] button:nth-of-type(2)').getAttribute('aria-pressed') === 'true'`,
      3000,
    );
    await app.shot(`${process.env.E2E_SHOTS ?? "remote-results"}/crew-actions-a1.png`);
  }, 60_000);

  test("the pilot's lock: every ordering control disabled, an order refused with its reason", async () => {
    await app.js("(__bh.settings.netCrewActions = false, true)");
    await app.waitFor(`${crew("__crew.actions.can('config').ok")} === false`, 5000);
    await app.waitFor(`document.querySelector('#crew-frame').contentDocument.querySelector('[data-act="cfg.gear"]').disabled`, 3000);
    expect(await app.js<string>(`document.querySelector('#crew-frame').contentDocument.querySelector('#act-state').textContent`)).toContain(
      "VERROUILL",
    );
    const r = await app.js<{ ok: boolean; msg: string }>(crew(`__crew.actions.send('cfg.gear', { down: false })`));
    expect(r.ok).toBe(false);
    expect(await app.js<boolean>("__bh.camera.gearDown")).toBe(true);
    await app.js("(__bh.settings.netCrewActions = true, true)");
    await app.waitFor(crew("__crew.actions.can('config').ok"), 5000);
  }, 30_000);
});
