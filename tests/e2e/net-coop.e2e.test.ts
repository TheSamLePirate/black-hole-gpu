import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX N5: a co-op mission with roles, two browsers — Ana proposes "the Moon together" from the missions
// panel as the Endurance (real clicks), Ben takes the Lander from his card: each set at his role's start above the
// Moon. Ana spins the ring up (⇧] at the keyboard) — her objectives done, told to the room —; Ben's (eased: the descent
// is long) done too: the mission won on both screens, its report shared. Then a second one: Ben leaves the room — his
// role free on Ana's Results tab. (NET_SHOTS=<dir>: the roles, the win.) ~3 min.

describe.skipIf(!E2E)("a co-op mission with roles (N5)", () => {
  let a: App;
  let b: App;
  let sb = 0;
  let code = "";
  const shots = process.env.NET_SHOTS;
  const shot = async (p: App, name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "ranger"; return 1; })()`);
    await a.js(`__bh.net.create("Coop")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "ranger"; return 1; })()`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    await b.waitFor(`__bh.net.net.clock.synced`, 30_000);
  }, 360_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("Ana proposes the Moon together as the Endurance; Ben takes the Lander: each at his role's start", async () => {
    await a.js(`(__bh.flight.spaceMissions.open(), 1)`);
    await a.waitFor(`!!document.querySelector('[data-testid="space-coop-coop-moon-endurance"]')`, 5000);
    await a.js(`(document.querySelector('[data-testid="space-coop-coop-moon-endurance"]').scrollIntoView({ block: "center" }), 1)`);
    await a.click('[data-testid="space-coop-coop-moon-endurance"]');
    await b.waitFor(`!!document.querySelector('[data-testid="net-coop"]')`, 10_000);
    expect(await b.js<string>(`document.querySelector('[data-testid="net-coop"] p').textContent`)).toBe(
      "Ana proposes a co-op mission: The Moon together — your role: Lander — the descent",
    );
    await b.click('[data-testid="net-coop-yes"]');
    await a.waitFor(`__bh.camera.spaceMission?.M.id === "coop:coop-moon:endurance" && __bh.settings.vessel === "endurance"`, 30_000);
    await b.waitFor(`__bh.camera.spaceMission?.M.id === "coop:coop-moon:lander" && __bh.settings.vessel === "lander"`, 30_000);
    await a.waitFor(`__bh.net.session.coop?.roles.get("lander").slot === ${sb}`, 10_000);
    expect(await a.js<string>(`__bh.game.status()?.soi`)).toBe("moon");
    expect(await b.js<string>(`__bh.game.status()?.soi`)).toBe("moon");
    await a.js(`(__bh.net.openTab("results"), 1)`);
    await shot(a, "n5-roles");
  }, 90_000);

  test("Ana spins the ring up at the keyboard, Ben's descent eased: both roles done — the mission won on both screens", async () => {
    await a.js(`(__bh.net.closePanel?.(), document.querySelector('[data-testid="net-panel"] .k-close, .k-modal .k-x')?.click(), 1)`);
    for (let k = 0; k < 3; k++) await a.press("BracketRight", "]", { shift: true });
    await a.waitFor(`__bh.net.session.coop.roles.get("endurance").ended`, 180_000);
    await b.js(
      `(() => { const R = __bh.camera.spaceMission; R.M = { ...R.M, objectives: R.M.objectives.map(() => ({ text: "x", done: { time: 1 } })) }; return 1; })()`,
    );
    await a.waitFor(`__bh.net.session.coop.told && __bh.net.session.coop.roles.get("lander").ok`, 60_000);
    await b.waitFor(`__bh.net.session.coop.told`, 10_000);
    const R = await a.js<string>(`document.querySelector('[data-testid="flight-report"]').textContent`);
    console.log(`  ${R.slice(0, 160)}`);
    expect(R).toMatch(/Co-op · The Moon together/);
    expect(R).toMatch(/20\.0 \/ 20/);
    await a.js(`(__bh.net.openTab("results"), 1)`);
    await shot(a, "n5-won");
  }, 300_000);

  test("a second mission: Ben leaves the room — his role free on Ana's Results tab", async () => {
    await a.js(`(() => { __bh.net.session.proposeCoop("coop-rescue", "endurance"); return 1; })()`);
    await b.waitFor(`!!document.querySelector('[data-testid="net-coop"]')`, 10_000);
    await b.click('[data-testid="net-coop-yes"]');
    await a.waitFor(`__bh.net.session.coop?.id === "coop-rescue" && __bh.net.session.coop.roles.get("ranger").slot === ${sb}`, 20_000);
    await b.js(`(() => { __bh.net.leave(); return 1; })()`);
    await a.waitFor(`__bh.net.session.coop.roles.get("ranger").slot === null`, 20_000);
    await a.js(`(__bh.net.openTab("results"), 1)`);
    await a.waitFor(`/free/.test(document.querySelector('[data-testid="net-coop-ranger"]')?.textContent ?? "")`, 5000);
    expect(a.cdp.errors).toEqual([]);
    expect(b.cdp.errors).toEqual([]);
  }, 90_000);
});
