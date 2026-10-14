import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";

// PLAN-RESEAU R6: together in space — Ana's Ranger in a low orbit, Ben's put 200 m off her right (Beside): each
// sees the other there, coasting (his orbit carries him on her screen between his samples); the room's warp —
// Ana asks ×100: held at ×1 till Ben accepts, then ×100 for both, their clocks together and the formation kept;
// Ben slows: at once for both —; Ben as Ana's target (the HUD's distance, the 3D map), and far: a marker.
// (NET_SHOTS=<dir>: Ana's view of Ben in orbit, her map.)

const M_METRES = 1.476625e11;

describe.skipIf(!E2E)("together in space", () => {
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
  /** the scene's time less the room's [s], at the end of a frame's step (as the page keeps it on the room's) */
  const lag = (p: App) => p.js<number>(`__bh.net.session.lag`);
  const gap = () => a.js<number>(`Math.hypot(...(__bh.renderer.netOthers[0]?.rel ?? [NaN, NaN, NaN]))`);
  beforeAll(async () => {
    a = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: false });
    await a.waitFor("__bh.camera.piloting", 120_000);
    await a.js(`(() => { __bh.net.setName("Ana"); __bh.settings.vessel = "ranger"; return 1; })()`);
    await a.js(`__bh.net.create("Orbit")`);
    await a.waitFor(`!!__bh.net.net?.room`, 20_000);
    const code = await a.js<string>(`__bh.net.net.room.code`);
    b = await App.boot({ width: 1280, height: 800, hash: `scene=game:artemis&join=${code}`, tiles: false });
    await b.waitFor(`__bh.net?.net?.room?.code === "${code}" && __bh.camera.piloting`, 120_000);
    await b.js(`(() => { __bh.net.setName("Ben"); __bh.settings.vessel = "ranger"; return 1; })()`);
    sa = await a.js<number>(`__bh.net.net.room.slot`);
    sb = await b.js<number>(`__bh.net.net.room.slot`);
  }, 300_000);
  afterAll(() => {
    b?.close();
    a?.close();
    stopServer();
  });

  test("Ben put 200 m off Ana's right in orbit: each sees the other there, coasting", async () => {
    await a.js(`(() => { __bh.game.orbit("earth", { altKm: 400, inc: 51.6, raan: 40, nu: 180 }); return 1; })()`);
    // (Ana's samples from her new orbit come to Ben — in the Earth's inertial frame, coasting)
    const placed = await a.js<number>(`__bh.sim.time * 492.549`);
    await b.waitFor(`(__bh.net.net.remotes.track(${sa})?.latest?.t ?? 0) > ${placed} + 0.2`, 30_000);
    await b.waitFor(
      `(() => { const s = __bh.net.net.remotes.track(${sa})?.latest; return !!s && s.frame === 1 && (s.flags & 16) === 16; })()`,
      30_000,
    );
    await b.waitFor(`__bh.net.net.clock.synced && !__bh.net.session.teleport(-1).includes("clock")`, 30_000);
    console.log(`  ${await b.js<string>(`__bh.net.session.teleport(${sa}, 200)`)}`);
    for (const p of [a, b]) await p.waitFor(`__bh.renderer.netOthers.length === 1`, 30_000);
    await Bun.sleep(3000);
    const d = await gap();
    console.log(
      `  Ana sees Ben ${d.toFixed(0)} m off; his samples ${await a.js<string>(`(() => { const s = __bh.net.net.remotes.track(${sb}).latest; return "frame " + s.frame + ", coasting " + !!(s.flags & 16); })()`)}`,
    );
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(260);
    if (shots) {
      // (Ana's look locked on Ben — C —: his Ranger in her view)
      await a.js(`(() => { __bh.camera.selectTarget("net:${sb}"); return 1; })()`);
      await a.press("KeyC");
      await Bun.sleep(2500);
      await shot(a, "orbit-a");
      await a.press("KeyC");
      await a.js(`(() => { __bh.camera.selectTarget("earth"); return 1; })()`);
    }
  }, 120_000);

  test("the room's warp: Ana asks ×100 — held at ×1 till Ben accepts; ×100 for both, together; Ben slows at once", async () => {
    await a.js(`(() => { __bh.game.warp(100); return 1; })()`);
    await b.waitFor(`__bh.net.net.room.wants[${sa}] === 100`, 5000);
    await Bun.sleep(500);
    expect(await b.js<number>(`__bh.net.net.room.clock.warp`)).toBe(1);
    expect(await b.js<number>(`__bh.net.session.offer?.warp ?? 0`)).toBe(100);
    console.log(
      `  Ana's bar: ${await a.js<string>(`[...document.querySelectorAll(".tp-warp")].map((e) => e.textContent).join(" | ")`)} — Ben offered ×${await b.js<number>(`__bh.net.session.offer.warp`)}`,
    );
    // (Ben accepts — warping up)
    await b.js(`(() => { __bh.net.session.acceptWarp(); return 1; })()`);
    for (const p of [a, b]) await p.waitFor(`__bh.net.net.room.clock.warp === 100`, 5000);
    await Bun.sleep(5000);
    const [la, lb] = [await lag(a), await lag(b)];
    const d = await gap();
    console.log(
      `  at ×100 for 5 s (500 s of the scene): Ana ${la.toFixed(2)} s off the room's clock, Ben ${lb.toFixed(2)} s; Ben ${d.toFixed(0)} m off`,
    );
    // (on the room's clock within a tenth of a real second — a frame —, and so together)
    expect(Math.abs(la)).toBeLessThan(10);
    expect(Math.abs(lb)).toBeLessThan(10);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(320);
    // (Ben slows to ×10: at once for both)
    await b.js(`(() => { __bh.game.warp(10); return 1; })()`);
    for (const p of [a, b]) await p.waitFor(`__bh.net.net.room.clock.warp === 10`, 2000);
    await b.js(`(() => { __bh.game.warp(1); return 1; })()`);
    for (const p of [a, b]) await p.waitFor(`__bh.net.net.room.clock.warp === 1`, 2000);
    // (the slowdown set ahead on the server's clock: nobody ran on at the old pace — both still on the room's time)
    await Bun.sleep(1500);
    const [la1, lb1] = [await lag(a), await lag(b)];
    console.log(`  back at ×1: Ana ${la1.toFixed(2)} s, Ben ${lb1.toFixed(2)} s off the room's clock`);
    expect(Math.abs(la1)).toBeLessThan(1);
    expect(Math.abs(lb1)).toBeLessThan(1);
  }, 90_000);

  test("Ben as Ana's target: the HUD's distance, her map; far off, a marker", async () => {
    const id = `net:${sb}`;
    expect(await a.js<boolean>(`__bh.camera.availableTargets().includes("${id}")`)).toBe(true);
    await a.js(`(() => { __bh.camera.selectTarget("${id}"); return 1; })()`);
    await Bun.sleep(500);
    const [hud, seen] = [await a.js<number>(`__bh.camera.flightInfo().targetDist * ${M_METRES}`), await gap()];
    console.log(`  Ana's HUD: Ben ${hud.toFixed(0)} m (her view: ${seen.toFixed(0)} m)`);
    expect(Math.abs(hud - seen)).toBeLessThan(25);
    if (shots) {
      await a.press("KeyM");
      await a.waitFor(`!!document.querySelector(".fl-root.mapview")`, 10_000);
      await Bun.sleep(2500);
      await shot(a, "orbit-a-map");
      await a.press("KeyM");
    }
    // (Ben a quarter of an orbit ahead: beyond any drawing, a marker with his distance)
    await b.js(`(() => { __bh.game.orbit("earth", { altKm: 400, inc: 51.6, raan: 40, nu: 270 }); return 1; })()`);
    await a.waitFor(`__bh.renderer.netOthers.length === 0 && __bh.net.session.tags.some((g) => g.dist > 1e6)`, 20_000);
    const far = await a.js<number>(`__bh.net.session.tags.find((g) => g.slot === ${sb}).dist`);
    console.log(`  Ben a quarter orbit ahead: a marker ${(far / 1000).toFixed(0)} km off`);
    expect(far).toBeGreaterThan(1e6);
    await shot(a, "orbit-a-far");
  }, 90_000);
});
