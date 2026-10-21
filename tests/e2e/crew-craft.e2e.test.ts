import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { CrewFrame } from "./lib/crew";

// A console for each craft (docs/CREW.md, AUDIT-CREW priority 4), on the real simulator: Ana's Lander over the Moon
// in a room — the crew's Descent view, the landing flown and its point moved from the console (a step, then a place
// touched on the Ground view), the craft landed and said so —; then her Endurance in Earth orbit — its ring's tile, no
// landing in its autopilot, a fleet order from the console to Ben's Ranger, his card —; then Gargantua's side — the
// Kerr orbit, the clocks since the start. Real clicks in the console's frame.
describe.skipIf(!E2E)("crew — a console for each craft", () => {
  let a: App;
  let b: App;
  let crew: CrewFrame;
  let sb = -1;
  const shots = process.env.E2E_SHOTS ?? "remote-results";
  const snap = <T>(path: string) => crew.js<T>(`__crew.model.own()?.snapshot?.${path}`);
  const views = () => crew.js<string[]>(`[...document.querySelectorAll('#views button')].map((b) => b.dataset.view)`);

  beforeAll(async () => {
    a = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "lander"; return 1; })()`);
    await a.js(`__bh.net.create("Crafts")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    crew = new CrewFrame(a);
    await crew.open(code, "Doyle", { w: 1200, h: 820 });
    await a.waitFor(crew.w("__crew.model.own()?.snapshot?.craft?.id === 'lander'"), 30_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("the Lander over the Moon: its Descent view, the landing flown and its point moved from the console", async () => {
    await a.js(`(async () => { __bh.game.hoverOver("moon", 0.674, 23.473, 1.2); return 1; })()`);
    await a.waitFor(crew.w("!!__crew.model.own()?.snapshot?.desc"), 20_000);
    const v = await views();
    console.log(`  the Lander's views: ${v.join(" ")}`);
    expect(v.slice(0, 3)).toEqual(["sdash", "descent", "ground"]);
    await crew.click('#views [data-view="descent"]');
    // (the flight computer: its Descent pop first for a Lander low over a ground)
    await crew.openPop("#fc-land");
    const land = await crew.order("#fc-land");
    console.log(`  ${JSON.stringify(land)}`);
    expect(land.ok).toBe(true);
    await a.waitFor(`__bh.camera.pilot.auto === "land" && !!__bh.camera.landRun?.q`, 15_000);
    await a.waitFor(`(__bh.camera.surfaceInfo()?.alt ?? 1e9) < 4900 && !!__bh.camera.flightInfo().lpd`, 30_000);
    const before = await a.js<number[]>(`[...__bh.camera.landRun.q]`);
    await crew.openPop("#fc-lpd-fwd");
    const step = await crew.order("#fc-lpd-fwd");
    expect(step.ok).toBe(true);
    await a.waitFor(`__bh.camera.flightInfo().lpd?.moved === true`, 5000);
    const after = await a.js<number[]>(`[...__bh.camera.landRun.q]`);
    expect(Math.hypot(after[0]! - before[0]!, after[1]! - before[1]!, after[2]! - before[2]!)).toBeGreaterThan(0);
    await a.waitFor(crew.w("__crew.model.own()?.snapshot?.land?.moved === true"), 5000);
    await a.js(crew.d("querySelectorAll('details[open]').forEach((d) => (d.open = false))"));
    await Bun.sleep(800);
    await a.shot(`${shots}/crew-craft-descent.png`);
    // (the Ground view: a place touched a little north-east of the craft — the point designated there)
    await a.js(crew.d("querySelectorAll('details[open]').forEach((d) => (d.open = false))"));
    await crew.click('#views [data-view="ground"]');
    await Bun.sleep(600);
    await crew.clickAt("#instruments", 0.53, 0.47);
    const touched = await crew.order("#ctx-lpd");
    console.log(`  Ground view: ${JSON.stringify(touched)}`);
    expect(touched.ok).toBe(true);
    await a.shot(`${shots}/crew-craft-ground.png`);
  }, 180_000);

  test("landed: the console says so (the Descent, the Orbit), the craft's state sent", async () => {
    await a.waitFor(
      `__bh.camera.flightInfo().status?.status === "landed" || ${crew.w("__crew.model.own()?.snapshot?.craft?.status")} === "landed"`,
      240_000,
    );
    await a.waitFor(crew.w("__crew.model.own()?.snapshot?.craft?.status === 'landed'"), 10_000);
    expect(await snap<string>("craft.where")).toBe("moon");
    await crew.click('#views [data-view="descent"]');
    await Bun.sleep(700);
    await a.shot(`${shots}/crew-craft-landed.png`);
  }, 300_000);

  test("the Endurance in orbit: its ring's tile, no landing in its autopilot; a fleet order from the console to Ben", async () => {
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "ranger"; return 1; })()`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    const sa = await a.js<number>(`__bh.net.net.room.slot`);
    await a.js(`(() => { __bh.settings.vessel = "endurance"; return 1; })()`);
    await a.waitFor(`__bh.fleet.active === "endurance"`, 20_000);
    await a.js(`(() => { __bh.game.orbit("earth", { altKm: 400, inc: 51.6, raan: 40, nu: 180 }); return 1; })()`);
    await a.waitFor(crew.w("__crew.model.own()?.snapshot?.craft?.id === 'endurance'"), 20_000);
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
    await b.js(`__bh.net.session.placeAtPort(${sa}, 2000, 0)`);
    await a.waitFor(`__bh.net.session.spaceTel.has(${sb})`, 20_000);
    expect(await views()).not.toContain("descent");
    await a.waitFor(crew.d("querySelector('#metrics [data-key=ring]') !== null"), 5000);
    const autos = await crew.js<string[]>(
      `[...document.querySelectorAll('#mcp select')].flatMap((s) => [...s.options].map((o) => o.value))`,
    );
    expect(autos).not.toContain("land");
    expect(autos).toContain("circularize");
    // (the fleet's pop: Ben's Ranger, three orders — "come to me" sent)
    await a.waitFor(crew.d(`querySelector('#fleet-come-${sb}') !== null`), 10_000);
    await crew.openPop(`#fleet-come-${sb}`);
    const r = await crew.order(`#fleet-come-${sb}`);
    console.log(`  ${JSON.stringify(r)}`);
    expect(r.ok).toBe(true);
    await b.waitFor(`!!document.querySelector('[data-testid="net-order"]')`, 10_000);
    const ask = await b.js<string>(`document.querySelector('[data-testid="net-order"] p').textContent`);
    console.log(`  Ben's card: ${ask}`);
    expect(ask).toMatch(/Ana/);
    await a.shot(`${shots}/crew-craft-endurance.png`);
  }, 360_000);

  test("Gargantua's side: the Kerr orbit at the console, the clocks since the start", async () => {
    b?.close();
    await a.js(
      `(async () => { __bh.game.preset("Gargantua: the Ranger by the Endurance"); await new Promise((ok) => setTimeout(ok, 2000)); return 1; })()`,
    );
    await a.waitFor(crew.w("!!__crew.model.own()?.snapshot?.kerr || __crew.model.own()?.snapshot?.link?.cut === true"), 60_000);
    // (aboard: live — the link cut is for the ground)
    const t = await snap<{ since?: number; lag?: number; dtau: number }>("time");
    console.log(`  clocks: ${JSON.stringify(t)} · where ${await snap<string>("craft.where")} · ${await snap<string>("craft.status")}`);
    expect(t.since).toBeGreaterThanOrEqual(0);
    expect(t.lag).toBeGreaterThanOrEqual(0);
    await crew.click('#views [data-view="orbit"]');
    await Bun.sleep(900);
    await a.shot(`${shots}/crew-craft-kerr.png`);
    await crew.click('#views [data-view="rel"]');
    await Bun.sleep(700);
    await a.shot(`${shots}/crew-craft-rel.png`);
    expect(a.cdp.errors).toEqual([]);
  }, 120_000);
});
