import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { CrewFrame } from "./lib/crew";

// The air refuelling from the crew console (docs/CREW.md, AUDIT-CREW priority 2): an F-35B over the Mediterranean at
// 6 000 m in a room, the crew console in a frame of the same page. From its MCP (AAR, real clicks): TEXACO 11 set close
// by behind its right hose; the console shows the tanker in its traffic, the rendezvous, the phases behind the hose,
// the fuel taken (PFD, Systems, the air mission strip); the way it is flown changed from the console; let go from it.
describe.skipIf(!E2E)("crew — air refuelling", () => {
  let app: App;
  let crew: CrewFrame;
  const shots = process.env.E2E_SHOTS ?? "remote-results";
  const aar = () =>
    crew.js<{ stage: string; phase: string; mode: string; given: number; tanker: string } | null>(
      "__crew.model.own()?.snapshot?.aar ?? null",
    );

  beforeAll(async () => {
    app = await App.boot({ width: 1600, height: 1000, hash: "scene=game:artemis", tiles: false });
    await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.traffic = false; return 1; })()`);
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
    await app.js(`(() => { __bh.game.setDate("2026-07-10T10:00:00Z");
      Object.assign(__bh.settings, { weather: "fair", wind: 1, earthClouds: 0, f35Variant: "B", f35Assist: "realistic", f35AarMode: "auto" });
      __bh.game.flyAt(43.0, 6.2, 6000, 90, 215); const c = __bh.camera; c.jetModes.alt = Math.round(c.geoNow().alt);
      c.jetModes.hdg = c.attitudeNow().heading; c.jetToggle("athr"); __bh.fleet.fuel.f35 = 4600; return 1; })()`);
    await app.js("(__bh.net.setName('Ana'), true)");
    await app.js("__bh.net.create('Crew AAR')");
    const code = await app.js<string>("__bh.net.net.room.code");
    crew = new CrewFrame(app);
    await crew.open(code, "Ben");
    await app.waitFor(crew.w("__crew.actions.can('jet').ok"), 15_000);
    await crew.js("__crew.setView('pfd')");
  }, 300_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  test("TEXACO set from the crew's MCP (near, right hose): the order done, the tanker in the console's traffic", async () => {
    await crew.openPop("#mcp-tanker");
    await crew.click("#mcp-tanker-near");
    const r = await crew.order("#mcp-tanker");
    console.log(`  ${JSON.stringify(r)}`);
    expect(r.ok).toBe(true);
    expect(await app.js<boolean>("!!__bh.camera.aar")).toBe(true);
    // (the block at the console: the rendezvous, TEXACO, its mode)
    await app.waitFor(`${crew.w("__crew.model.own()?.snapshot?.aar?.tanker")} === "TEXACO 11"`, 5000);
    expect((await aar())!.mode).toBe("auto");
    // (the tanker in the console's traffic, its airframe named, its speed carried)
    await app.waitFor(
      `${crew.w("__crew.model.contacts().some((c) => c.name === 'TEXACO 11' && c.type === 'A330 MRTT' && c.spd > 100)")}`,
      8000,
    );
  }, 60_000);

  test("behind the hose: the phases at the console (PFD's AAR box), the way it is flown changed from it", async () => {
    await app.waitFor(`__bh.camera.aar?.stage === "hose"`, 180_000);
    await app.waitFor(`${crew.w("__crew.model.own()?.snapshot?.aar?.stage")} === "hose"`, 5000);
    const a = (await aar())!;
    console.log(`  console: ${a.phase} · ${a.mode}`);
    expect(a.phase).toMatch(/PRE-CONTACT|CLEARED|CONTACT|FUEL FLOW/);
    // (the AAR pop closed: the PFD's own box seen)
    await app.js(crew.d("querySelectorAll('details[open]').forEach((d) => (d.open = false))"));
    await Bun.sleep(1500);
    await app.shot(`${shots}/crew-aar-pfd.png`);
    // (assisted from the console, then automatic again)
    await crew.openPop("#mcp-tanker");
    const assisted = await crew.order(`#mcp-aar-mode button:nth-of-type(2)`);
    expect(assisted.ok).toBe(true);
    expect(await app.js<string>("__bh.camera.aar.mode")).toBe("assisted");
    await app.waitFor(`${crew.w("__crew.model.own()?.snapshot?.aar?.mode")} === "assisted"`, 5000);
    const auto = await crew.order(`#mcp-aar-mode button:nth-of-type(1)`);
    expect(auto.ok).toBe(true);
    expect(await app.js<string>("__bh.camera.aar.mode")).toBe("auto");
  }, 240_000);

  test("the contact: the fuel taken shown by the console (Systems), then the refuelling let go from it", async () => {
    // (the fuel aboard as the transfer begins: the tanks then gain what the hose gives, the engine's burn aside)
    await app.waitFor(`__bh.camera.aar?.s.given > 0`, 300_000);
    const fuel0 = await app.js<number>("__bh.fleet.fuel.f35");
    await app.waitFor(`__bh.camera.aar?.s.given > 150`, 120_000);
    await app.waitFor(`${crew.w("__crew.model.own()?.snapshot?.aar?.given")} > 150`, 5000);
    await crew.js("__crew.setView('schematic')");
    await Bun.sleep(1200);
    await app.shot(`${shots}/crew-aar-systems.png`);
    await crew.js("__crew.setView('air')");
    await Bun.sleep(1200);
    await app.shot(`${shots}/crew-aar-air.png`);
    await crew.js("__crew.setView('pfd')");
    await crew.openPop("#mcp-tanker-off");
    const r = await crew.order("#mcp-tanker-off");
    expect(r.ok).toBe(true);
    await app.waitFor(`!__bh.camera.aar`, 3000);
    await app.waitFor(`${crew.w("__crew.model.own()?.snapshot?.aar")} == null`, 5000);
    const fuel = await app.js<number>("__bh.fleet.fuel.f35");
    console.log(`  let go from the console: ${fuel.toFixed(0)} kg aboard`);
    expect(fuel).toBeGreaterThan(fuel0 + 100);
  }, 360_000);
});
