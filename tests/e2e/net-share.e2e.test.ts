import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX N2: what docked spacecraft share, two browsers — Ben's Ranger docked to Ana's Endurance (400 km orbit):
// his battery and oxygen run low; from the Fleet tab (real clicks) he asks her for power, then oxygen: on her screen
// the card, she accepts — his filled, hers lowered by as much (her reserve kept). Then she sends him her target and her
// mission plan: his target hers, his plan her burns at their times. (NET_SHOTS=<dir>: the ask, the plan.) ~2 min.

describe.skipIf(!E2E)("sharing between docked spacecraft (N2)", () => {
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
  const sys = (p: App) =>
    p.js<{ battery: number; o2: number }>(
      `(() => { const S = __bh.camera.systemsOf(__bh.settings.vessel); return { battery: S.battery, o2: S.o2 }; })()`,
    );
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "endurance"; return 1; })()`);
    await a.js(`__bh.net.create("Share")`);
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
    console.log(`  ${await b.js<string>(`__bh.net.session.placeAtPort(${sa}, 3, 0.15)`)}`);
    await b.waitFor(`!!__bh.camera.netDocked`, 60_000);
    await a.waitFor(`__bh.net.session.links.get(${sb})?.host === ${sa}`, 10_000);
  }, 360_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("Ben, low, asks Ana for power then oxygen: accepted — his filled, hers lowered by as much", async () => {
    await b.js(`(() => { const S = __bh.camera.systemsOf("ranger"); S.battery = 10; S.o2 = 5; return 1; })()`);
    const a0 = await sys(a);
    await b.js(`(__bh.net.openTab("fleet"), 1)`);
    await b.waitFor(`!!document.querySelector('[data-testid="net-share-power-${sa}"]')`, 10_000);
    await b.click(`[data-testid="net-share-power-${sa}"]`);
    await a.waitFor(`!!document.querySelector('[data-testid="net-share"]')`, 10_000);
    const ask = await a.js<string>(`document.querySelector('[data-testid="net-share"] p').textContent`);
    console.log(`  Ana: ${ask}`);
    expect(ask).toMatch(/^Ben asks for 5\d kWh$/);
    await shot(a, "n2-ask");
    await a.click('[data-testid="net-share-yes"]');
    await b.waitFor(`__bh.net.session.shared.got > 0`, 10_000);
    const [a1, b1] = [await sys(a), await sys(b)];
    console.log(`  power: Ben ${b1.battery.toFixed(1)} kWh, Ana ${a0.battery.toFixed(0)} → ${a1.battery.toFixed(0)} kWh`);
    expect(b1.battery).toBeGreaterThan(55);
    expect(a0.battery - a1.battery).toBeGreaterThan(45);
    expect(a0.battery - a1.battery).toBeLessThan(60);
    await b.click(`[data-testid="net-share-o2-${sa}"]`);
    await a.waitFor(`!!document.querySelector('[data-testid="net-share"]')`, 10_000);
    await a.click('[data-testid="net-share-yes"]');
    await b.waitFor(`__bh.camera.systemsOf("ranger").o2 > 35`, 10_000);
    console.log(`  oxygen: Ben ${(await sys(b)).o2.toFixed(1)} kg`);
  }, 90_000);

  test("Ana sends her target and her plan: his target hers, his plan her burns at their times", async () => {
    await a.js(`(() => { __bh.camera.selectTarget("moon"); __bh.camera.addNode(); __bh.camera.nudgeNode(0, [1e-6, 0, 0]); return 1; })()`);
    const t0 = await a.js<number>(`__bh.camera.plan.nodes[0].t`);
    await a.js(`(__bh.net.openTab("fleet"), 1)`);
    await a.waitFor(`!!document.querySelector('[data-testid="net-send-plan-${sb}"]')`, 10_000);
    await a.click(`[data-testid="net-send-target-${sb}"]`);
    await b.waitFor(`__bh.settings.target === "moon"`, 10_000);
    await a.click(`[data-testid="net-send-plan-${sb}"]`);
    await b.waitFor(`__bh.camera.plan.nodes.length === 1`, 10_000);
    const t1 = await b.js<number>(`__bh.camera.plan.nodes[0].t`);
    expect(t1).toBe(t0);
    await shot(b, "n2-plan");
    expect(a.cdp.errors).toEqual([]);
    expect(b.cdp.errors).toEqual([]);
  }, 60_000);
});
