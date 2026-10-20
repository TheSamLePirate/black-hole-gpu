import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-VAISSEAUX N6: time and the rest, three pages — Ana's Endurance in a 400 km orbit, Ben's Ranger 400 m off, and a
// crew screen following Ana. Ben fires his engine: Ana hears it (another's engine, at his place); Ana asks the room for
// ×10: her Network panel says the warp is held by Ben, burning. On the crew screen, Ana's ORBIT view shows Ben's craft
// about the Earth (the room's other spacecraft, in her snapshot). (NET_SHOTS=<dir>: the panel, the crew's orbit.) ~3 min.

describe.skipIf(!E2E)("time and the rest (N6)", () => {
  let a: App;
  let b: App;
  let c: App;
  let sa = 0;
  const shots = process.env.NET_SHOTS;
  const shot = async (p: App, name: string) => {
    if (!shots) return;
    await Bun.$`mkdir -p ${shots}`;
    await p.shot(`${shots}/${name}.png`);
  };
  let code = "";
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "endurance"; return 1; })()`);
    await a.js(`__bh.net.create("Time")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "ranger"; return 1; })()`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    await a.js(`(() => { __bh.game.orbit("earth", { altKm: 400, inc: 51.6, raan: 40, nu: 180 }); return 1; })()`);
    const placed = await a.js<number>(`__bh.sim.time * 492.549`);
    await b.waitFor(
      `(__bh.net.net.remotes.track(${sa})?.latest?.t ?? 0) > ${placed} + 0.2 && __bh.net.net.remotes.track(${sa}).latest.kind === 2`,
      30_000,
    );
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
    console.log(`  ${await b.js<string>(`__bh.net.session.placeAtPort(${sa}, 400, 0)`)}`);
    // (Ana's sound started: a key, the audio's user gesture — twice, the SAS back as it was)
    await a.press("KeyT");
    await a.press("KeyT");
    await a.waitFor(`__sound.ctx?.state === "running"`, 10_000);
  }, 360_000);
  afterAll(() => {
    c?.close();
    b?.close();
    a?.close();
    stopServer();
  });

  test("Ben fires his engine: Ana hears it; she asks for ×10 — held by Ben, burning", async () => {
    await b.js(`(() => { __bh.camera.pilot.throttle = 0.3; return 1; })()`);
    await a.waitFor(`__sound.otherLevel > 0.05`, 15_000);
    console.log(`  Ana hears Ben's engine at ${(await a.js<number>(`__sound.otherLevel`)).toFixed(2)}`);
    await a.js(`(() => { __bh.game.warp(10); return 1; })()`);
    await a.waitFor(`__bh.net.session.warpHolders.some((n) => /Ben \\(burning\\)/.test(n))`, 15_000);
    await a.js(`(__bh.net.open(), 1)`);
    await a.waitFor(`/held by Ben \\(burning\\)/.test(document.querySelector('[data-testid="net-warp-held"]')?.textContent ?? "")`, 5000);
    await shot(a, "n6-held");
    await b.js(`(() => { __bh.camera.pilot.throttle = 0; return 1; })()`);
    await a.waitFor(`__sound.otherLevel < 0.02`, 15_000);
    await a.js(`(() => { __bh.game.warp(1); __bh.net.closePanel?.(); return 1; })()`);
  }, 90_000);

  test("the crew screen following Ana: her ORBIT view shows Ben's craft about the Earth", async () => {
    c = await App.boot({ entry: "crew", width: 1440, height: 900 });
    await c.js(`(document.getElementById("name").value = "", 1)`);
    await c.click("#name");
    await c.type("Romilly");
    await c.click("#code");
    await c.type(code);
    await c.click("#join");
    await c.waitFor(`__crew.net.room?.role === 'instruments'`, 20_000);
    await c.js(`(__crew.model.selected = ${sa}, 1)`);
    await c.waitFor(
      `(__crew.model.crafts().find((k) => k.member.slot === ${sa})?.snapshot?.others ?? []).some((o) => o.name === "Ben" && o.vessel === "Ranger")`,
      20_000,
    );
    const o = await c.js<{ r: number[] }>(`__crew.model.crafts().find((k) => k.member.slot === ${sa}).snapshot.others[0]`);
    const rKm = Math.hypot(...o.r);
    console.log(`  Ben about the Earth: ${rKm.toFixed(0)} km from its centre`);
    expect(rKm).toBeGreaterThan(6700);
    expect(rKm).toBeLessThan(6800);
    await c.js(`(document.querySelector('#views button[data-view="orbit"]')?.click(), 1)`);
    await Bun.sleep(1500);
    await shot(c, "n6-crew-orbit");
    expect(a.cdp.errors).toEqual([]);
    expect(b.cdp.errors).toEqual([]);
    expect(c.cdp.errors).toEqual([]);
  }, 90_000);
});
