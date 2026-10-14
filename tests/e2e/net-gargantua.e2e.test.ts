import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-RESEAU R8: together on Gargantua's side — Ana's Ranger in orbit about Miller, Ben's put 200 m off her right
// (Beside, on the hole's map): each sees the other there (the hole's map brought onto the camera's rest frame —
// flat over the metres between them), on the camera's axes. (NET_SHOTS=<dir>: Ana's view.)

describe.skipIf(!E2E)("together by Gargantua", () => {
  let a: App;
  let b: App;
  let sa = 0;
  const shots = process.env.NET_SHOTS;
  const gap = (p: App) => p.js<number>(`Math.hypot(...(__bh.renderer.netOthers[0]?.rel ?? [NaN, NaN, NaN]))`);
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "ranger"; return 1; })()`);
    await a.js(`__bh.net.create("Miller")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "ranger"; return 1; })()`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("Ana in orbit about Miller, Ben 200 m off her right: each sees the other there", async () => {
    console.log(`  ${await a.js<string>(`__bh.game.orbit("miller")`)}`);
    const placed = await a.js<number>(`__bh.sim.time * 492.549`);
    await b.waitFor(
      `(() => { const s = __bh.net.net.remotes.track(${sa})?.latest; return !!s && s.t > ${placed} + 0.2 && s.frame === 2; })()`,
      30_000,
    );
    console.log(`  ${await b.js<string>(`__bh.net.session.teleport(${sa}, 200)`)}`);
    for (const p of [a, b]) await p.waitFor(`__bh.renderer.netOthers.length === 1 && __bh.camera.flightInfo && true`, 30_000);
    await Bun.sleep(3000);
    const [da, db] = [await gap(a), await gap(b)];
    const region = await a.js<string>(`(() => { const c = __bh.camera.frame?.() ?? null; return c ? c.region : "?"; })()`);
    console.log(`  Ana sees Ben ${da.toFixed(0)} m off, Ben sees Ana ${db.toFixed(0)} m off (${region})`);
    expect(da).toBeGreaterThan(150);
    expect(da).toBeLessThan(260);
    expect(db).toBeGreaterThan(150);
    expect(db).toBeLessThan(260);
    if (shots) {
      await Bun.$`mkdir -p ${shots}`;
      await a.js(`(() => { __bh.settings.shipLookYaw = 70; return 1; })()`);
      await Bun.sleep(1500);
      await a.shot(`${shots}/miller-a.png`);
    }
  }, 120_000);
});
