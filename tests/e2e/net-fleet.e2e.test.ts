import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX N1: the room's fleet of spacecraft, two browsers — Ana flies the Endurance in a 400 km orbit, Ben a
// Ranger: the Network panel's Fleet tab lists both (craft, where, Δv, how far); Ben put 180 m off closing at 1.5 m/s:
// the proximity warning; Ana, real clicks, orders Ben to dock to her: on his screen the order's card, he accepts —
// his target her craft, his docking autopilot on; on hers, his answer. (NET_SHOTS=<dir>: the fleet, the order.) ~3 min.

describe.skipIf(!E2E)("the room's fleet of spacecraft (N1)", () => {
  let a: App;
  let b: App;
  let sa = 0;
  let sb = 0;
  const shots = process.env.NET_SHOTS;
  const shot = async (p: App, name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "endurance"; return 1; })()`);
    await a.js(`__bh.net.create("Fleet")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "ranger"; return 1; })()`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
    await a.js(`(() => { __bh.game.orbit("earth", { altKm: 400, inc: 51.6, raan: 40, nu: 180 }); return 1; })()`);
    const placed = await a.js<number>(`__bh.sim.time * 492.549`);
    await b.waitFor(
      `(__bh.net.net.remotes.track(${sa})?.latest?.t ?? 0) > ${placed} + 0.2 && __bh.net.net.remotes.track(${sa}).latest.kind === 2`,
      30_000,
    );
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
  }, 360_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("the Fleet tab: both craft, where they fly, their Δv; Ben's range on Ana's", async () => {
    console.log(`  ${await b.js<string>(`__bh.net.session.placeAtPort(${sa}, 2000, 0)`)}`);
    await a.waitFor(`__bh.net.session.spaceTel.size === 2 && __bh.net.session.near.has(${sb})`, 20_000);
    await a.js(`(__bh.net.open(), 1)`);
    await a.click('[data-testid="net-tab-fleet"]');
    await a.waitFor(`!!document.querySelector('[data-testid="net-fleet-${sb}"]')`, 5000);
    const rows = await a.js<string[]>(
      `[...document.querySelectorAll('[data-testid^="net-fleet-"][data-testid$="${sa}"], [data-testid="net-fleet-${sb}"]')].map((e) => e.textContent)`,
    );
    console.log(`  ${rows.join(" ‖ ")}`);
    const ben = await a.js<string>(`document.querySelector('[data-testid="net-fleet-${sb}"]').textContent`);
    expect(ben).toMatch(/Ben/);
    expect(ben).toMatch(/Ranger/);
    expect(ben).toMatch(/in orbit · the Earth · [34]\d\d km/);
    expect(ben).toMatch(/Δv [\d,]+ k?m\/s/);
    expect(ben).not.toMatch(/\d{4,}\.\d m\/s/);
    const range = await a.js<string>(`document.querySelector('[data-testid="net-fleet-range-${sb}"]').textContent`);
    expect(range).toMatch(/^(1\.9|2\.0)\d km/);
    await shot(a, "n1-fleet");
  }, 60_000);

  test("Ben 180 m off, closing at 1.5 m/s: the proximity warning", async () => {
    const before = await b.js<number>(`__bh.net.session.proximityAlerts`);
    await b.js(`__bh.net.session.placeAtPort(${sa}, 180, 1.5)`);
    await b.waitFor(`__bh.net.session.proximityAlerts > ${before}`, 15_000);
    console.log(`  Ben warned (${await b.js<number>(`__bh.net.session.proximityAlerts`)})`);
  }, 30_000);

  test("Ana orders Ben to dock to her: his card, accepted — his autopilot on her craft; her panel says so", async () => {
    await b.js(`__bh.net.session.placeAtPort(${sa}, 40, 0)`);
    await Bun.sleep(1500);
    await a.click(`[data-testid="net-fleet-dock-${sb}"]`);
    await b.waitFor(`!!document.querySelector('[data-testid="net-order"]')`, 10_000);
    const ask = await b.js<string>(`document.querySelector('[data-testid="net-order"] p').textContent`);
    expect(ask).toBe("Ana asks you to dock to their craft");
    await shot(b, "n1-order");
    await b.click('[data-testid="net-order-yes"]');
    await b.waitFor(`__bh.camera.pilot.auto === "dock" && __bh.settings.target === "net:${sa}"`, 5000);
    await a.waitFor(`__bh.net.session.orderAnswers.get(${sb})?.yes === true`, 10_000);
    await a.waitFor(`/accepted/.test(document.querySelector('[data-testid="net-fleet-${sb}"]')?.textContent ?? "")`, 5000);
    expect(a.cdp.errors).toEqual([]);
    expect(b.cdp.errors).toEqual([]);
  }, 60_000);
});
