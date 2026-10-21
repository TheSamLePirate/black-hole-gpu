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
  test("A2 — the flight plan from the crew: a field by its name, a point on the map, its constraint, moved, flown direct", async () => {
    const route = () =>
      app.js<{ name: string; lat: number; lon: number; alt?: number }[]>("__bh.camera.nav.route.wps.map(w => ({ ...w }))");
    await app.js("(() => { const c = __bh.camera; c.nav.route.wps.length = 0; c.routeChanged(); return 1; })()");
    await app.js(crew("__crew.setView('plan')"));
    await app.waitFor(`!!document.querySelector('#crew-frame').contentDocument.querySelector('#plan-query')`, 3000);
    // (Le Bourget by its ICAO, typed and added)
    await app.js(
      `(() => { const d = document.querySelector('#crew-frame').contentDocument; const q = d.querySelector('#plan-query'); q.value = 'LFPB'; return true; })()`,
    );
    await press("#plan-add");
    expect((await route()).map((w) => w.name)).toEqual(["LFPB"]);
    // (a point on the map, from its menu: added at the plan's end)
    await app.js(crew("__crew.setView('map')"));
    await app.js(`(${crew("__crew.views.onGround({ lat: 45.5, lon: 6.2 }, 300, 300)")}, true)`);
    await press("#ctx-append");
    expect((await route()).length).toBe(2);
    expect((await route())[1]).toMatchObject({ lat: 45.5, lon: 6.2 });
    // (its altitude constraint, from the waypoint's menu once the console has the point: 4 000 m)
    await app.waitFor(`${crew("__crew.model.own()?.snapshot?.route.length")} >= 2`, 5000);
    await app.js(`(${crew("__crew.views.onWp(1, 300, 300)")}, true)`);
    await app.js(
      `(() => { const d = document.querySelector('#crew-frame').contentDocument; d.querySelector('.ctx-menu .ctx-row input').value = '4000'; return true; })()`,
    );
    await press("#ctx-alt-set");
    expect((await route())[1]!.alt).toBe(4000);
    // (dragged to a new place: moved, its constraint kept)
    await app.js(`(${crew("__crew.views.onMoveWp(1, { lat: 45.6, lon: 6.3 })")}, true)`);
    await app.waitFor(`!${crew("__crew.actions.busy")}`, 5000);
    expect((await route())[1]).toMatchObject({ lat: 45.6, lon: 6.3, alt: 4000 });
    // (flown direct to it: the guidance's active point)
    await app.js(`(${crew("__crew.views.onWp(1, 300, 300)")}, true)`);
    await press("#ctx-wp-direct");
    expect(await app.js<number>("__bh.camera.nav.lnav?.active ?? -1")).toBe(1);
    expect((await lastBoard()).what).toContain("direct");
    await app.js(crew("__crew.setView('plan')"));
    await app.shot(`${process.env.E2E_SHOTS ?? "remote-results"}/crew-actions-a2.png`);
  }, 60_000);
  test("A3 — the autopilot from the crew's MCP: AP, A/THR, the altitude and heading selected, LNAV, an orbit and off", async () => {
    const modes = () =>
      app.js<{ alt: number | null; hdg: number | null; spd: number | null; order?: string }>("({ ...__bh.camera.jetModes })");
    /** a selector turned by its button, held for n steps (the console's own pointer events) */
    const turn = (key: string, plus: boolean, n: number) =>
      app.js(`(() => { const d = document.querySelector('#crew-frame').contentDocument;
        const b = d.querySelector('.knob[data-key=${key}] .knob-step:${plus ? "last" : "first"}-of-type');
        for (let i = 0; i < ${n}; i++) { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }
        return true; })()`);
    await app.js(crew("__crew.setView('pfd')"));
    await app.waitFor(`!!document.querySelector('#crew-frame').contentDocument.querySelector('#mcp-ap')`, 3000);
    // (the holds engaged from the MCP: the altitude and heading now)
    if ((await modes()).alt === null) await press("#mcp-ap");
    expect((await modes()).alt).not.toBeNull();
    const alt0 = (await modes()).alt!;
    await turn("alt", true, 5);
    // (sent once the finger rests: the selected altitude 500 m higher)
    await app.waitFor(`Math.abs(__bh.camera.jetModes.alt - ${alt0 + 500}) < 11`, 5000);
    const hdg0 = ((await modes()).hdg! * 180) / Math.PI;
    await turn("hdg", false, 20);
    await app.waitFor(
      `Math.abs(((__bh.camera.jetModes.hdg * 180 / Math.PI) - ${(((hdg0 - 20) % 360) + 360) % 360} + 540) % 360 - 180) < 1.5`,
      5000,
    );
    // (the autothrottle engaged, its speed held)
    if ((await modes()).spd === null) await press("#mcp-athr");
    expect((await modes()).spd).not.toBeNull();
    // (LNAV on the plan made in A2, then off)
    await press("#mcp-lnav");
    expect(await app.js<boolean>("__bh.camera.nav.on.l")).toBe(true);
    await press("#mcp-lnav");
    expect(await app.js<boolean>("__bh.camera.nav.on.l")).toBe(false);
    // (an orbit here, then the mode off)
    await press("#mcp-orbit");
    await app.waitFor(`!!__bh.camera.orbitMode`, 3000);
    await press("#mcp-mode-off");
    await app.waitFor(`!__bh.camera.orbitMode`, 3000);
    await app.shot(`${process.env.E2E_SHOTS ?? "remote-results"}/crew-actions-a3.png`);
  }, 60_000);
  test("A4 — the spacecraft's flight computer from the crew: a hold, a manoeuvre previewed with its figures, released", async () => {
    await app.js(`(() => { __bh.game.preset("Earth: docking to the ISS"); return 1; })()`);
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.waitFor(`${crew("__crew.model.own()?.snapshot?.caps?.fam.includes('space')")}`, 20_000);
    await app.js(crew("__crew.setView('pfd')"));
    await app.waitFor(`document.querySelector('#crew-frame').contentDocument.querySelector('#mcp').dataset.kind === 'space'`, 5000);
    // (the hold: prograde)
    await app.js(
      `(() => { const s = document.querySelector('#crew-frame').contentDocument.querySelector('select[aria-label="Tenue d\\'attitude"]'); s.value = 'prograde'; return true; })()`,
    );
    await press("#fc-hold");
    expect(await app.js<string>("__bh.camera.pilot.hold")).toBe("prograde");
    // (a circularization previewed: its Δv in the card, nothing flown)
    await press("#fc-preview");
    const card = await app.js<string>(`document.querySelector('#crew-frame').contentDocument.querySelector('.fc-card').textContent`);
    console.log(`  preview: ${card.replace(/\n/g, " · ")}`);
    expect(card).toMatch(/Δv total/);
    expect(card).not.toMatch(/Refusé/);
    expect(await app.js<string>("__bh.camera.pilot.auto")).not.toBe("node");
    await app.js(
      `(() => { const d = document.querySelector('#crew-frame').contentDocument; d.querySelector('.fc-pop:nth-of-type(3)').open = true; return true; })()`,
    );
    await app.shot(`${process.env.E2E_SHOTS ?? "remote-results"}/crew-actions-a4.png`);
    // (everything released)
    await press("#fc-release");
    expect(await app.js<string>("__bh.camera.pilot.hold")).toBe("none");
  }, 120_000);
  test("A5 — the F-35's weapons from the crew's radar: the weapon, the radar's mode, a lock kept first, decoys, a missile", async () => {
    await app.js(`(() => { __bh.settings.vessel = "f35"; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.flyAt(45.85, 6.75, 3000, 110, 200); return 1; })()`);
    await app.waitFor(`${crew("__crew.model.own()?.snapshot?.caps?.fam.includes('weapons')")}`, 20_000);
    // (the drone hunt: targets to lock and shoot — the room's free fight has none, the traffic off; its card pressed
    // with the crew's frame out of the pointer's way)
    await app.js(
      `(() => { document.querySelector('#crew-frame').style.visibility = 'hidden'; __bh.flight.challenges.open(); return 1; })()`,
    );
    await app.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await app.click(`[data-testid="chp-fight-drones"]`);
    await app.js(`(() => { document.querySelector('#crew-frame').style.visibility = ''; return 1; })()`);
    await app.waitFor(`__bh.camera.combat?.status === "run" && __bh.camera.combat.world.targets.length === 5`, 20_000);
    // (the holds, so it flies straight while the crew works)
    await app.js(
      `(() => { const c = __bh.camera; if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr"); return 1; })()`,
    );
    await app.js(crew("__crew.setView('radar')"));
    await app.waitFor(`!!document.querySelector('#crew-frame').contentDocument.querySelector('#wp-fire')`, 3000);
    await press(`.act-seg[aria-label="Arme"] button:nth-of-type(1)`);
    expect(await app.js<string>("__bh.camera.combat.weapon")).toBe("aim120");
    await press(`.act-seg[aria-label="Radar"] button:nth-of-type(2)`);
    expect(await app.js<string>("__bh.camera.radar.mode")).toBe("TWS");
    // (the lock: the pilot's radar's, the crew's snapshot's, its contact first of the list sent — once it tracks)
    await app.waitFor("__bh.camera.radar.tracks.size > 0", 15_000);
    await press("#wp-lock");
    expect((await lastBoard()).ok).toBe(true);
    expect(await app.js<boolean>("__bh.camera.combat.world.lock !== null")).toBe(true);
    await app.waitFor(`!!${crew("__crew.model.own()?.snapshot?.arms?.lock")}`, 3000);
    await app.waitFor(`${crew("__crew.model.own()?.snapshot?.radar?.contacts[0]?.locked")} === true`, 3000);
    // (the drones on the crew's map: the fight's own side, hostile — sent every snapshot with their speed, RD1)
    await app.waitFor(
      `${crew("__crew.model.own()?.snapshot?.tracks?.filter((t) => t.id.startsWith('f:') && t.side === 'hostile' && t.spd > 0).length")} >= 4`,
      5000,
    );
    await press("#wp-cm");
    expect((await lastBoard()).ok).toBe(true);
    // (the shot: the button held 0.7 s by a real pointer — let go early, nothing)
    const fireAt = await app.js<{ x: number; y: number }>(`(() => {
      const f = document.querySelector('#crew-frame'), F = f.getBoundingClientRect();
      const b = f.contentDocument.querySelector('#wp-fire').getBoundingClientRect();
      return { x: F.left + b.left + b.width / 2, y: F.top + b.top + b.height / 2 };
    })()`);
    const stores0 = await app.js<number>("__bh.camera.combat.world.stores.aim120");
    await app.mouse("move", fireAt.x, fireAt.y);
    await app.mouse("down", fireAt.x, fireAt.y);
    await Bun.sleep(200);
    await app.mouse("up", fireAt.x, fireAt.y);
    await Bun.sleep(500);
    expect((await lastBoard()).what).not.toBe("tir");
    expect(await app.js<number>("__bh.camera.combat.world.stores.aim120")).toBe(stores0);
    await app.mouse("down", fireAt.x, fireAt.y);
    await Bun.sleep(900);
    await app.mouse("up", fireAt.x, fireAt.y);
    await app.waitFor(`!${crew("__crew.actions.busy")}`, 5000);
    const shot = await lastBoard();
    console.log(`  fire: ${JSON.stringify(shot)}`);
    expect(shot.what).toBe("tir");
    expect(shot.ok).toBe(true);
    // (a missile away: the stores one fewer, a blue missile flying)
    expect(await app.js<number>("__bh.camera.combat.world.stores.aim120")).toBe(stores0 - 1);
    expect(await app.js<number>(`__bh.camera.combat.world.missiles.filter((m) => m.owner === "blue").length`)).toBeGreaterThan(0);
    await app.shot(`${process.env.E2E_SHOTS ?? "remote-results"}/crew-actions-a5.png`);
  }, 120_000);

  test("A6 — a track designated to the pilot from the crew's radar: selected on his screens, ringed on the crew's (RD9)", async () => {
    await app.waitFor(`!!${crew("__crew.model.own()?.snapshot?.radar?.contacts.find((c) => !c.locked)")}`, 10_000);
    const id = await app.js<string>(crew("__crew.model.own().snapshot.radar.contacts.find((c) => !c.locked).id"));
    await app.js(crew(`__crew.views.onContact(${JSON.stringify(id)})`));
    await app.waitFor(`!!document.querySelector('#crew-frame').contentDocument.querySelector('#ctx-designate')`, 3000);
    await press("#ctx-designate");
    await app.waitFor(`!${crew("__crew.actions.busy")}`, 5000);
    const b = await lastBoard();
    console.log(`  designated ${id}: ${JSON.stringify(b)}`);
    expect(b.ok).toBe(true);
    expect(await app.js<string | null>("__bh.camera.pictureSelected")).toBe(id);
    // (not locked by it: a designation)
    expect(await app.js<string | null>("__bh.camera.radar.lock")).not.toBe(id);
    await app.waitFor(`${crew("__crew.model.own()?.snapshot?.radar?.selected")} === ${JSON.stringify(id)}`, 3000);
  }, 60_000);
});
