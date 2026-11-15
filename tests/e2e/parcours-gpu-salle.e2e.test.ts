import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
// PLAN-J6 J6-6, its second part — the journey « rebuild the GPU » in a network room (strategy §19.13: « in a room, an explicit resync »):
// two pages (tiles off), Ana makes a room, Ben joins it as a pilot; Ben's GPU device lost (__bh.gpu.lose()). Asserted: the room's time
// goes on for Ana while Ben recovers (his recovery does not hold the room — the solo hold, gpu-recovery-hold, is his alone); Ben back on a
// new generation, his scene on the room's hour (net.session.lag under 1 s), said to him; Ben still in the room; no error but the device's.
// Duration: ~3 min on kerr-mini.
// Done when: Ben back on the room's hour, said.
const said = (app: App, from: number) => app.js<string[]>(`__bh.game.log.events.slice(${from}).map((e) => e.text)`);
afterAll(stopServer);
describe.skipIf(!E2E)("J6-6: the GPU lost in a network room — the room goes on, the pilot back on its hour, said", () => {
  let a: App;
  let b: App;
  beforeAll(async () => {
    // (both pages up first, one after the other — hidden-tab's lesson: a second page booted while the first flies stood on its compile)
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting && __bh.gpu.frames().completedFrames > 30", 120_000);
    b = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await b.waitFor("__bh.camera.piloting && __bh.gpu.frames().completedFrames > 30", 120_000);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
  });

  test("Ben's GPU lost: Ana's room time goes on; Ben back on the room's hour, told; still in the room", async () => {
    await a.js(`(() => { __bh.net.setName("Ana"); return 1; })()`);
    await a.js(`__bh.net.create("GPU perdu")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    await b.js(`(() => { __bh.net.setName("Ben"); return 1; })()`);
    await b.js(`__bh.net.join("${code}", "pilot")`);
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.net.net.clock.synced`, 20_000);
    await Bun.sleep(2000);
    const logB = await b.js<number>(`__bh.game.log.events.length`);
    const gen0 = await b.js<number>(`__bh.gpu.generation()`);
    const tA0 = await a.js<number>(`__bh.time()`);
    const w0 = Date.now();
    await b.js(`(__bh.gpu.lose(), true)`);
    // (during Ben's recovery: Ana's room time running)
    await Bun.sleep(1500);
    const tA1 = await a.js<number>(`__bh.time()`);
    await b.waitFor(`__bh.gpu.generation() === ${gen0 + 1} && __bh.gpu.frames().completedFrames > 10`, 90_000);
    const backS = (Date.now() - w0) / 1000;
    await Bun.sleep(2500);
    const r = await b.js<{ lag: number; inRoom: boolean }>(
      `({ lag: __bh.net.session.lag, inRoom: __bh.net?.net?.room?.code === "${code}" })`,
    );
    const toldB = await said(b, logB);
    const rateA = (tA1 - tA0) / 1.5;
    console.log(
      `  Ben's recovery ${backS.toFixed(1)} s; Ana's time across its start ${(tA1 - tA0).toExponential(3)} M (${rateA.toExponential(3)} M/s); Ben ${JSON.stringify(r)}; told ${JSON.stringify(toldB)}`,
    );
    await b.snap("remote-results/parcours-gpu-salle-ben.png");
    expect(tA1).toBeGreaterThan(tA0);
    expect(r.inRoom).toBe(true);
    expect(Math.abs(r.lag)).toBeLessThan(1);
    expect(toldB.some((s) => /room|salle/i.test(s))).toBe(true);
    expect(a.cdp.errors).toEqual([]);
    expect(b.cdp.errors.filter((e) => !/device|lost|destroyed/i.test(String(e)))).toEqual([]);
  }, 180_000);
});
