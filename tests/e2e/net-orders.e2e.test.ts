import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The leader's orders across the room (docs/PLAN-AVIATION-AAA.md, F2): Ana leads on her holds over Edwards, Ben
// Beside her then in Formation (#2). The orders' key on Ana's page: the orders' wheel; "go diamond" — heard on Ben's page,
// his slot moved and flown; "break right" — Ben out of formation, his hard turn; "rejoin" — back on her wing.
// (NET_SHOTS=<dir>: the wheel, Ben's view.)

describe.skipIf(!E2E)("the leader's orders", () => {
  let a: App;
  let b: App;
  let sa = 0;
  const shots = process.env.NET_SHOTS;
  const shot = async (p: App, name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  const benSays = async () =>
    b.js<string>(
      `JSON.stringify({ form: !!__bh.camera.form, dist: __bh.camera.form?.last?.dist, said: __bh.game.log.events.filter((e) => e.kind === "pilot").slice(-4).map((e) => e.text) })`,
    );
  const SETUP = `(() => { __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; __bh.settings.wind = 0; return 1; })()`;
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(SETUP);
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await a.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("Orders")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(SETUP);
    await b.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.formShape = "fingertip"; __bh.settings.formPos = 2; return 1; })()`);
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
    await a.js(`(() => { __bh.game.flyAt(34.95, -117.80, 2300, 90, 220); return 1; })()`);
    await Bun.sleep(1000);
    await a.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 3000; c.jetModes.hdg = Math.PI / 2; c.jetModes.spd = 220; return 1; })()`,
    );
    await b.waitFor(
      `__bh.net.net.remotes.track(${sa})?.latest?.kind === 3 && !(__bh.net.net.remotes.track(${sa}).latest.flags & 1)`,
      30_000,
    );
    // (Ben in formation on her: Beside first — far — then his place)
    console.log(`  Ben: ${await b.js<string>(`__bh.net.formation(${sa})`)}`);
    await b.waitFor(`(__bh.camera.form?.last?.dist ?? 1e9) < 15`, 180_000);
  }, 480_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("F13 on Ana's page (the orders' key): the orders' wheel", async () => {
    // (no field keeps the keys: the room's panel let go)
    await a.js(`(() => { document.activeElement?.blur?.(); return 1; })()`);
    await a.press("F13", "F13");
    await Bun.sleep(400);
    const open = await a.js<boolean>(
      `!!document.querySelector(".wheel, [data-testid=wheel]") && getComputedStyle(document.querySelector(".wheel, [data-testid=wheel]")).display !== "none"`,
    );
    await shot(a, "orders-wheel");
    await a.press("Escape", "Escape");
    expect(open).toBe(true);
  }, 30_000);

  test("go diamond: heard on Ben's page, his slot moved and flown", async () => {
    const said = await a.js<string>(`__bh.camera.flightOrder("shape", "diamond")`);
    console.log(`  Ana: ${said}`);
    await b.waitFor(`__bh.settings.formShape === "diamond"`, 10_000);
    const right = await b.js<number>(`__bh.camera.form.at.right`);
    expect(right).toBeLessThan(0);
    await b.waitFor(`(__bh.camera.form?.last?.dist ?? 1e9) < 15`, 90_000).catch(async (e) => {
      console.log(`  Ben: ${await benSays()}`);
      throw e;
    });
    console.log(`  Ben in the diamond's #2: ${(await b.js<number>(`__bh.camera.form.last.dist`)).toFixed(1)} m off`);
    await shot(b, "ben-diamond");
  }, 120_000);

  test("break right: Ben out of formation, his hard turn; rejoin: back on her wing", async () => {
    const h0 = await b.js<number>(`__bh.camera.jetFigures().hdg`);
    await a.js(`__bh.camera.flightOrder("breakR")`);
    await b.waitFor(`!__bh.camera.form && !!__bh.camera.brk`, 10_000).catch(async (e) => {
      console.log(
        `  Ben: ${await b.js<string>(`JSON.stringify({ form: !!__bh.camera.form, brk: __bh.camera.brk, said: __bh.game.log.events.filter((e) => e.kind === "pilot").slice(-4).map((e) => e.text) })`)}`,
      );
      throw e;
    });
    await b.waitFor(`!__bh.camera.brk`, 60_000);
    const turned = await b.js<number>(
      `(() => { const d = __bh.camera.jetFigures().hdg - ${h0}; return ((d + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI; })()`,
    );
    console.log(`  Ben broke right: ${turned.toFixed(0)}°`);
    expect(turned).toBeGreaterThan(70);
    expect(turned).toBeLessThan(110);
    await a.js(`__bh.camera.flightOrder("rejoin")`);
    await b.waitFor(`__bh.camera.form?.slot === ${sa}`, 10_000);
    await b.waitFor(`(__bh.camera.form?.last?.dist ?? 1e9) < 15`, 240_000).catch(async (e) => {
      console.log(`  Ben: ${await benSays()}`);
      throw e;
    });
    console.log(`  Ben rejoined: ${(await b.js<number>(`__bh.camera.form.last.dist`)).toFixed(1)} m off`);
  }, 360_000);
});
