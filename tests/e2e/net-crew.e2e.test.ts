import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { CrewFrame } from "./lib/crew";

// PLAN-VAISSEAUX N3: aboard another's spacecraft, two browsers — Ben's Ranger docked to Ana's Endurance (400 km orbit):
// from the Fleet tab (real clicks) he goes aboard — his view hers, her fleet shows him aboard —; as her copilot he
// holds prograde and spins her ring up (carried out on her craft); he asks for the controls, she accepts: he flies
// the Endurance from where it was, she rides with him (her own craft his now: no getting off to it).
// (NET_SHOTS=<dir>: the copilot, the controls taken.) ~2 min.

describe.skipIf(!E2E)("aboard another's spacecraft (N3)", () => {
  let a: App;
  let b: App;
  let sa = 0;
  let sb = 0;
  /** a crew console on Ana's page, following her (AUDIT-CREW priority 5: the handover and a reconnection) */
  let crew: CrewFrame;
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
    await a.js(`__bh.net.create("Crew")`);
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
    crew = new CrewFrame(a);
    await crew.open(code, "Case", { w: 700, h: 500 });
    await a.waitFor(crew.w(`__crew.model.crafts().length === 2`), 20_000);
    await crew.js(`(__crew.model.selected = ${sa}, 1)`);
    await a.waitFor(crew.w(`__crew.model.own()?.member.slot === ${sa} && __crew.model.own()?.snapshot?.craft?.id === "endurance"`), 20_000);
  }, 360_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("Ben goes aboard; as her copilot he holds prograde and spins her ring up", async () => {
    await b.js(`(__bh.net.openTab("fleet"), 1)`);
    await b.waitFor(`!!document.querySelector('[data-testid="net-board-${sa}"]')`, 10_000);
    await b.click(`[data-testid="net-board-${sa}"]`);
    await b.waitFor(`__bh.net.session.follow?.why === "passenger" && !!document.querySelector('[data-testid="net-copilot"]')`, 10_000);
    await a.waitFor(`__bh.net.session.aboard.get(${sb}) === ${sa}`, 10_000);
    await b.click('[data-testid="net-cp-pro"]');
    await a.waitFor(`__bh.camera.pilot.hold === "prograde"`, 10_000);
    // (one order at a time: the crew's pace — the next a moment later)
    await Bun.sleep(1500);
    await b.click('[data-testid="net-cp-ring-up"]');
    await a.waitFor(`(__bh.camera.ringRpm ?? 0) > 0`, 10_000).catch(async (e) => {
      console.log(`  Ana's log: ${await a.js<string>(`__bh.game.log.text().split(String.fromCharCode(10)).slice(-6).join(" | ")`)}`);
      console.log(`  Ben's log: ${await b.js<string>(`__bh.game.log.text().split(String.fromCharCode(10)).slice(-6).join(" | ")`)}`);
      throw e;
    });
    console.log(
      `  Ana's craft: hold ${await a.js<string>(`__bh.camera.pilot.hold`)}, ring asked ${await a.js<number>(`__bh.camera.ringRpm`)} rpm`,
    );
    await shot(b, "n3-copilot");
  }, 60_000);

  test("Ben asks for the controls, Ana accepts: he flies the Endurance from where it was; she rides with him", async () => {
    await a.waitFor(`__bh.net.session.aboard.get(${sb}) === ${sa}`, 5000);
    await b.click('[data-testid="net-helm-ask"]');
    await Bun.sleep(1500);
    console.log(
      `  state: Ben follows ${await b.js<string>(`JSON.stringify(__bh.net.session.follow)`)}, Ana's aboard ${await a.js<string>(`JSON.stringify([...__bh.net.session.aboard])`)}, Ana's card ${await a.js<boolean>(`!!document.querySelector('[data-testid="net-helm"]')`)}`,
    );
    await a.waitFor(`!!document.querySelector('[data-testid="net-helm"]')`, 10_000);
    expect(await a.js<string>(`document.querySelector('[data-testid="net-helm"] p').textContent`)).toBe("Ben asks to take the controls");
    await a.click('[data-testid="net-helm-yes"]');
    await b.waitFor(`__bh.net.session.helmTaken === 1 && __bh.settings.vessel === "endurance" && !__bh.net.session.follow`, 15_000);
    await Bun.sleep(600);
    await a.waitFor(`__bh.net.session.follow?.why === "passenger" && __bh.net.session.follow.slot === ${sb}`, 10_000);
    // (on his page: his craft where hers is carried on along its orbit — her last samples, she flies no more)
    const d = await b.js<number>(
      `(() => { const st = __bh.net.net.remotes.track(${sa}).at(__bh.sim.time * 492.549); const P = __bh.camera.netPlaceBeside(st, 0); const o = __bh.camera.activePoseNow(); return Math.hypot(...[0, 1, 2].map((k) => (P.X[k] - o.X[k]) * 1.476625e11)); })()`,
    );
    console.log(`  Ben's Endurance ${d.toFixed(1)} m from where Ana's is carried on`);
    // (her samples coasting on Kepler, his craft flown on: tens of metres apart at 7.7 km/s — ten milliseconds)
    expect(d).toBeLessThan(200);
    expect(await a.js<string>(`__bh.net.session.boardToggle()`)).toMatch(/theirs now/);
    // (her old craft no more in his world: not drawn, nothing to strike)
    await b.waitFor(`__bh.net.session.handed.has(${sa}) && !__bh.net.session.ships.some((s) => s.slot === ${sa})`, 5000);
    await shot(b, "n3-helm");
    // (the crew console followed the craft, not Ana: Ben flies the Endurance now — RD1)
    await a.waitFor(crew.w(`__crew.model.selected === ${sb}`), 10_000);
    await a.waitFor(crew.w(`__crew.model.own()?.snapshot?.craft?.id === "endurance" && __crew.model.own()?.age < 3`), 10_000);
    // (its own link dropped and taken again: still on Ben, found by his device)
    await crew.js("(__crew.net.link?.close?.(), 1)");
    await a.waitFor(crew.w(`__crew.net.status !== "online"`), 5000);
    await a.waitFor(crew.w(`__crew.net.status === "online" && !!__crew.net.room`), 20_000);
    await a.waitFor(crew.w(`__crew.model.own()?.member.slot === ${sb}`), 10_000);
    expect(a.cdp.errors).toEqual([]);
    expect(b.cdp.errors).toEqual([]);
  }, 60_000);
});
