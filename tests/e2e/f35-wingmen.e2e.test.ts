import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// The AI wingmen in the game (docs/PLAN-AVIATION-AAA.md, F3): Ana's F-35 over Edwards with three — Two, Three,
// Four — mustered in the diamond and held; Ben, in the same room 300 m off her wing, sees them (drawn, on his
// radar by the datalink); the drone hunt: "engage", their missiles, the drones down.
// (E2E_SHOTS=<dir>: the views.)

describe.skipIf(!E2E)("the AI wingmen", () => {
  let a: App;
  let b: App;
  let sa = 0;
  const shots = process.env.E2E_SHOTS;
  const shot = async (p: App, name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  const SETUP = `(() => { __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; __bh.settings.wind = 0; return 1; })()`;
  const worst = () => a.js<number>(`Math.max(...__bh.camera.wing.list.filter((w) => w.alive).map((w) => w.dist))`);
  beforeAll(async () => {
    a = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(SETUP);
    await a.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await a.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("Wingmen")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    await a.js(`(() => { __bh.game.flyAt(34.95, -117.80, 3000, 90, 220); return 1; })()`);
    await Bun.sleep(1500);
    await a.js(
      `(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); c.jetModes.alt = 3700; c.jetModes.hdg = Math.PI / 2; c.jetModes.spd = 220; __bh.settings.formShape = "diamond"; __bh.settings.shipMount = "chase"; return 1; })()`,
    );
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(SETUP);
    await b.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
  }, 420_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("three mustered in the diamond, held", async () => {
    await a.js(`(() => { __bh.settings.wingmen = 3; return 1; })()`);
    await a.waitFor(`__bh.camera.wing?.list.length === 3`, 10_000);
    // (the sim's own time: a slow page takes longer — waited for, not timed)
    await a.waitFor(`Math.max(...__bh.camera.wing.list.map((w) => w.dist)) < 8`, 120_000);
    let w = 0;
    for (let i = 0; i < 20; i++) {
      w = Math.max(w, await worst());
      await Bun.sleep(500);
    }
    const said = await a.js<string[]>(`__bh.game.log.events.filter((e) => e.kind === "pilot").slice(-3).map((e) => e.text)`);
    console.log(`  the diamond held within ${w.toFixed(1)} m over 10 s; ${said.join(" · ")}`);
    expect(w).toBeLessThan(15);
    // (seen from behind and above, 120 m off: the whole diamond)
    await a.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    // (the view's own reset first: then turned and backed off)
    await Bun.sleep(800);
    await a.js(`(() => { Object.assign(__bh.camera.outside, { yaw: 15, pitch: 22, dist: 130 }); return 1; })()`);
    await Bun.sleep(1500);
    await shot(a, "wingmen-diamond");
    await a.js(`(() => { __bh.settings.shipMount = "chase"; return 1; })()`);
  }, 180_000);

  test("Ben, 300 m off Ana's wing: her wingmen drawn and on his radar", async () => {
    console.log(`  Ben: ${await b.js<string>(`__bh.net.session.teleport(${sa}, 300)`)}`);
    await b.waitFor(`(__bh.camera.remoteWings.get(${sa})?.list.length ?? 0) === 3`, 20_000);
    await b.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); __bh.settings.shipMount = "chase"; return 1; })()`);
    await b.waitFor(`[...__bh.camera.radar.tracks.keys()].filter((k) => k.startsWith("rwg:")).length === 3`, 20_000);
    await b.js(`(() => { __bh.settings.shipMount = "around"; return 1; })()`);
    await Bun.sleep(800);
    await b.js(`(() => { Object.assign(__bh.camera.outside, { yaw: -70, pitch: 8, dist: 90 }); return 1; })()`);
    await Bun.sleep(2000);
    await shot(b, "ben-sees-wingmen");
  }, 60_000);

  test("the drone hunt: engage — their missiles, the drones down", async () => {
    await a.js(`(() => { __bh.flight.challenges.open(); return 1; })()`);
    await a.waitFor(`!!document.querySelector("[data-testid=challenge-panel]")`, 5000);
    await a.click(`[data-testid="chp-fight-drones"]`);
    await a.waitFor(`__bh.camera.radar.tracks.size >= 3`, 15_000);
    await a.js(`(() => { const c = __bh.camera; c.jetToggle("ap"); c.jetToggle("athr"); return 1; })()`);
    await a.waitFor(`__bh.camera.wing?.list.length === 3`, 15_000);
    await Bun.sleep(5000);
    console.log(`  Ana: ${await a.js<string>(`__bh.camera.flightOrder("engage")`)}`);
    const alive = () => a.js<number>(`__bh.camera.combat.world.targets.filter((q) => q.alive && q.ai).length`);
    const n0 = await alive();
    await a.waitFor(`__bh.camera.combat.world.missiles.some((m) => m.owner === "blue" && m.from >= 20000)`, 90_000);
    await shot(a, "wingmen-fox");
    await a.waitFor(`__bh.camera.combat.world.targets.filter((q) => q.alive && q.ai).length <= ${n0 - 2}`, 240_000);
    const said = await a.js<string[]>(
      `__bh.game.log.events.filter((e) => e.kind === "pilot" && /Fox|splash|engaged|contact/i.test(e.text)).map((e) => e.text)`,
    );
    console.log(`  ${n0 - (await alive())} drones down; ${said.slice(0, 8).join(" · ")}`);
    expect(said.some((s) => /Fox three/.test(s))).toBe(true);
  }, 300_000);
});
