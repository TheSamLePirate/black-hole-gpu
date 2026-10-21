import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The spacecraft's picture at the crew (PLAN-RADAR-AAA, RD4's leftover): the real simulator's Ranger 300 km from the ISS
// in a room, the crew console (crew/) in a frame of the same page: its snapshot carries the sensors' tracks
// (`spacePic`, the ISS on the LVLH axes, its range the pilot's); the DOCKING view — no port within 5 km — draws the LVLH
// scope and its list; a real click on the ISS's symbol opens its menu (its range, who holds it: Target, no designation);
// Target sets the pilot's target. In French, then in English. (E2E_SHOTS=<dir>: the view in both.)

describe.skipIf(!E2E)("the spacecraft's picture at the crew", () => {
  let app: App;
  const shots = process.env.E2E_SHOTS;
  const crew = (js: string) => `document.querySelector('#crew-frame').contentWindow.${js}`;
  const doc = (js: string) => `document.querySelector('#crew-frame').contentDocument.${js}`;

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.waitFor("__bh.camera.piloting", 120_000);
    await app.js(`(() => { __bh.settings.vessel = "ranger"; __bh.presets["Earth: docking to the ISS"].issDistance = 300000;
      __bh.game.preset("Earth: docking to the ISS"); return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "ranger" && !!__bh.camera.spacePic?.tracks.some((t) => t.id === "iss")`, 30_000);
    // (another target first: the crew's order is what sets the ISS)
    await app.js(`(() => { __bh.settings.target = "moon"; return 1; })()`);
    await app.js("(__bh.net.setName('Cooper'), true)");
    await app.js("__bh.net.create('Endurance crew')");
    const code = await app.js<string>("__bh.net.net.room.code");
    await app.js(
      `(() => { const f = document.createElement('iframe'); f.id = 'crew-frame'; f.src = '/crew/'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:1200px;height:800px;border:0;z-index:99999'; document.body.append(f); return true; })()`,
    );
    await app.waitFor(`!!document.querySelector('#crew-frame').contentWindow?.__crew`, 20_000);
    await app.js(crew(`__crew.setLang("fr")`));
    await app.js(`(${doc(`getElementById("station")`)}.value = "guido", true)`);
    await app.js(crew(`__crew.join('${code}', 'Doyle')`));
    await app.waitFor(crew("__crew.actions.can('space').ok"), 20_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the snapshot's tracks; the DOCKING view's scope; a click on the ISS: its menu, Target", async () => {
    await app.waitFor(`!!${crew(`__crew.model.own()?.snapshot?.spacePic?.tracks.some((t) => t.id === "iss")`)}`, 15_000);
    const T = await app.js<{ ref: string; range: number; sensors: number; pilot: number }>(`(() => {
      const P = ${crew("__crew.model.own().snapshot.spacePic")};
      const T = P.tracks.find((t) => t.id === "iss");
      return { ref: P.ref, range: T.range, sensors: T.sensors, pilot: __bh.camera.spacePic.tracks.find((t) => t.id === "iss").range }; })()`);
    console.log(
      `  crew: ISS about ${T.ref} at ${(T.range / 1000).toFixed(1)} km (pilot ${(T.pilot / 1000).toFixed(1)} km), sensors ${T.sensors}`,
    );
    expect(T.ref).toBe("earth");
    expect(Math.abs(T.range - T.pilot)).toBeLessThan(5000);
    expect(T.sensors & 1).toBe(1);
    // the DOCKING view: the scope drawn, the ISS's symbol a pick
    await app.js(crew(`__crew.setView("dock")`));
    await app.waitFor(`${crew(`__crew.views.picks.some((p) => p.contact === "iss")`)}`, 8000);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await app.shot(`${shots}/crew-lvlh-fr.png`);
    }
    // (a real click on it: the frame's place + the canvas's + the pick's)
    const at = await app.js<{ x: number; y: number }>(`(() => {
      const f = document.querySelector('#crew-frame').getBoundingClientRect();
      const v = ${crew("__crew.views")};
      const c = v.canvas ?? ${doc(`querySelector("canvas")`)};
      const r = c.getBoundingClientRect();
      const p = v.picks.find((q) => q.contact === "iss").point;
      return { x: f.left + r.left + p[0], y: f.top + r.top + p[1] }; })()`);
    await app.mouse("move", at.x, at.y);
    await app.mouse("down", at.x, at.y);
    await app.mouse("up", at.x, at.y);
    await app.waitFor(`!!${doc(`getElementById("ctx-target")`)}`, 5000);
    expect(await app.js<boolean>(`!!${doc(`getElementById("ctx-designate")`)}`)).toBe(false);
    await app.js(`(${doc(`getElementById("ctx-target")`)}.click(), true)`);
    await app.waitFor(`String(__bh.settings.target) === "iss"`, 10_000);
    // (in English: the same view)
    await app.js(crew(`__crew.setLang("en")`));
    await Bun.sleep(800);
    if (shots) await app.shot(`${shots}/crew-lvlh-en.png`);
  }, 120_000);
});
