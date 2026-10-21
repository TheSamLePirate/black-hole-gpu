import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { CrewFrame } from "./lib/crew";

// The crew console in English (docs/CREW.md, AUDIT-CREW priority 3): an F-35 over the Alps in a room, the console in a
// frame of the same page with English chosen (kerr.crew.lang). Its page, its views, its tiles and panels in English, no
// French left on the screen; an order's journal line and a refusal in English — the pilot answers in the console's
// language —; then the Ranger's spacecraft console in English; the language switched from the header, and back.
describe.skipIf(!E2E)("crew — the console in English", () => {
  let app: App;
  let crew: CrewFrame;
  const shots = process.env.E2E_SHOTS ?? "remote-results";
  /** the console's visible text, the names of the room's members left out */
  const text = () => app.js<string>(crew.d("body.innerText"));
  const french = /[éèêàâçùûôî]|\b(?:le|la|les|du|des|une|aucun|vers|dans|avec)\b/i;

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false, crewLang: "en" });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(45.85, 6.75, 3000, 110, 200); return 1; })()`);
    await app.js("(__bh.net.setName('Ana'), true)");
    await app.js("__bh.net.create('Crew EN')");
    const code = await app.js<string>("__bh.net.net.room.code");
    crew = new CrewFrame(app);
    await crew.open(code, "Ben");
    await app.waitFor(crew.w("__crew.actions.can('config').ok"), 15_000);
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("the page, the views, the tiles in English; no French on the screen", async () => {
    expect(await app.js<string>(crew.d("documentElement.lang"))).toBe("en");
    expect(await crew.js<string>("__crew.lang()")).toBe("en");
    await crew.js("__crew.setView('air')");
    await Bun.sleep(800);
    expect(await app.js<string>(crew.d("getElementById('view-title').textContent"))).toBe("Air mission");
    // (the tiles' names upper-cased by the page's style)
    const t = (await text()).toLowerCase();
    expect(t).toContain("speed");
    expect(t).toContain("flight plan");
    for (const view of ["air", "pfd", "nd", "radar", "schematic", "plan", "telemetry"]) {
      await crew.js(`__crew.setView('${view}')`);
      await Bun.sleep(300);
      const v = await text();
      const hit = v.split("\n").filter((l) => french.test(l) && !/Ana|Ben/.test(l));
      expect({ view, hit }).toEqual({ view, hit: [] });
    }
    await crew.js("__crew.setView('air')");
    await Bun.sleep(800);
    await app.shot(`${shots}/crew-en-air.png`);
  }, 60_000);

  test("an order from the Systems view: its journal line in English, the pilot's refusal in English", async () => {
    await crew.js("__crew.setView('schematic')");
    const r = await crew.order(`[data-act="cfg.gear"]:last-of-type`);
    expect(r.ok).toBe(true);
    expect(r.what).toBe("gear down");
    expect(await app.js<boolean>("__bh.camera.gearDown")).toBe(true);
    // (the pilot's lock: refused, said in English by the pilot)
    await app.js("(__bh.settings.netCrewActions = false, true)");
    await app.waitFor(`${crew.w("__crew.actions.can('config').ok")} === false`, 5000);
    await app.waitFor(`${crew.d("getElementById('act-state').textContent")} === "LOCKED"`, 3000);
    await app.js("(__bh.settings.netCrewActions = true, true)");
    await app.waitFor(crew.w("__crew.actions.can('config').ok"), 5000);
    await Bun.sleep(400);
    await app.shot(`${shots}/crew-en-systems.png`);
  }, 30_000);

  test("the Ranger near the ISS: the spacecraft console in English (dashboard, docking, EECOM)", async () => {
    await app.js(`(async () => { __bh.setDate(Date.UTC(2026, 9, 1, 12)); __bh.game.preset("Earth: docking to the ISS");
      await new Promise((ok) => setTimeout(ok, 1500)); return true; })()`);
    await app.waitFor(`${crew.w("__crew.model.own()?.snapshot?.craft?.id")} === "ranger"`, 30_000);
    await app.waitFor(`${crew.d("getElementById('profile-badge').textContent")}.startsWith("SPACECRAFT")`, 10_000);
    for (const view of ["sdash", "dock", "eecom", "timeline", "rel", "orbit"]) {
      await crew.js(`__crew.setView('${view}')`);
      await Bun.sleep(400);
      const v = await text();
      const hit = v.split("\n").filter((l) => french.test(l) && !/Ana|Ben/.test(l));
      expect({ view, hit }).toEqual({ view, hit: [] });
    }
    await crew.js("__crew.setView('sdash')");
    await Bun.sleep(1000);
    await app.shot(`${shots}/crew-en-space.png`);
  }, 90_000);

  test("the language switched from the header to French — the views' names, the page —, and back", async () => {
    await crew.click("#lang-button");
    await app.waitFor(`${crew.d("documentElement.lang")} === "fr"`, 3000);
    expect(await app.js<string>(crew.d("getElementById('view-title').textContent"))).toBe("Tableau");
    expect(await text()).toContain("Équipage");
    await crew.click("#lang-button");
    await app.waitFor(`${crew.d("documentElement.lang")} === "en"`, 3000);
    expect(await app.js<string>(crew.d("getElementById('view-title').textContent"))).toBe("Dashboard");
  }, 30_000);
});
